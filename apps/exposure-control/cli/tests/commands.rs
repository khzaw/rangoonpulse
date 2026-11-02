use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Output};
use std::thread::{self, JoinHandle};
use std::time::Duration;

fn command(args: &[&str], origin: Option<&str>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_exposure"));
    command.env_remove("EXPOSURE_CONTROL_URL").args(args);
    if let Some(origin) = origin {
        command.arg("--url").arg(origin);
    }
    command.output().unwrap()
}

fn read_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut byte = [0];
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
    }
    let headers = String::from_utf8(bytes).unwrap();
    let length = headers
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    let mut body = vec![0; length];
    stream.read_exact(&mut body).unwrap();
    headers + &String::from_utf8(body).unwrap()
}

fn server(
    status: u16,
    content_type: &str,
    body: String,
    extra_headers: &str,
) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
        body.len()
    );
    let thread = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_request(&mut stream);
        let _ = stream.write_all(response.as_bytes());
        request
    });
    (origin, thread)
}

fn json_server(body: Value) -> (String, JoinHandle<String>) {
    server(200, "application/json", body.to_string(), "")
}

fn stdout_json(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn enable_defaults_and_explicit_flags_reach_the_api() {
    for (flags, expected) in [
        (vec![], json!({ "hours": null, "authMode": "none" })),
        (
            vec!["--for", "90m"],
            json!({ "hours": 1.5, "authMode": "none" }),
        ),
        (
            vec!["--auth", "cloudflare-access"],
            json!({ "hours": null, "authMode": "cloudflare-access" }),
        ),
        (
            vec!["--until-disabled"],
            json!({ "hours": null, "authMode": "none" }),
        ),
        (
            vec!["--for", "2h", "--auth", "cloudflare-access"],
            json!({ "hours": 2.0, "authMode": "cloudflare-access" }),
        ),
    ] {
        let payload = json!({ "service": { "id": "books", "enabled": true } });
        let (origin, request) = json_server(payload.clone());
        let mut args = vec!["enable", "books", "--json"];
        args.extend(flags);
        assert_eq!(stdout_json(&command(&args, Some(&origin))), payload);
        let request = request.join().unwrap();
        assert!(request.starts_with("POST /api/services/books/enable HTTP/1.1"));
        assert_eq!(
            serde_json::from_str::<Value>(request.split_once("\r\n\r\n").unwrap().1).unwrap(),
            expected
        );
    }
}

#[test]
fn help_and_usage_errors_do_not_require_an_api() {
    for args in [vec!["--help"], vec!["enable", "--help"], vec!["--version"]] {
        assert!(command(&args, Some("http://127.0.0.1:1")).status.success());
    }
    for args in [
        vec!["unknown"],
        vec!["enable"],
        vec!["disable-all"],
        vec!["list", "--for", "1h"],
        vec!["enable", "../bad"],
        vec!["enable", "books", "--auth", "typo"],
        vec!["enable", "books", "--for", "16m"],
        vec!["enable", "books", "--for", "25h"],
        vec!["enable", "books", "--for", "2h", "--until-disabled"],
        vec!["audit", "--limit", "101"],
        vec!["audit", "--limit", "0"],
        vec!["list", "extra"],
    ] {
        let output = command(&args, Some("http://127.0.0.1:1"));
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn list_show_and_audit_preserve_json_envelopes_and_order() {
    let books = json!({ "id": "books", "enabled": true, "expiresAt": null, "authMode": "none", "publicUrl": "https://books.example.test" });
    let photos = json!({ "id": "photos", "enabled": false });
    for (args, expected) in [
        (
            vec!["list", "--active", "--json"],
            json!({ "services": [books.clone()] }),
        ),
        (
            vec!["show", "photos", "--json"],
            json!({ "service": photos.clone() }),
        ),
    ] {
        let (origin, request) = json_server(json!({ "services": [books, photos] }));
        assert_eq!(stdout_json(&command(&args, Some(&origin))), expected);
        assert!(
            request
                .join()
                .unwrap()
                .starts_with("GET /api/services HTTP/1.1")
        );
    }
    let entries = json!([{ "serviceId": "books", "action": "disable" }, { "serviceId": "photos" }, { "serviceId": "books", "action": "enable" }]);
    let (origin, request) = json_server(json!({ "entries": entries }));
    assert_eq!(
        stdout_json(&command(
            &["audit", "books", "--limit", "1", "--json"],
            Some(&origin)
        )),
        json!({ "entries": [entries[0]] })
    );
    assert!(
        request
            .join()
            .unwrap()
            .starts_with("GET /api/audit HTTP/1.1")
    );
}

#[test]
fn human_output_handles_empty_lists_and_indefinite_shares() {
    for services in [
        json!([]),
        json!([{ "id": "books", "enabled": true, "authMode": "none", "expiresAt": null }]),
    ] {
        let (origin, request) = json_server(json!({ "services": services }));
        let output = command(&["list"], Some(&origin));
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("SERVICE"));
        if !services.as_array().unwrap().is_empty() {
            assert!(text.contains("until disabled"));
            assert!(text.contains("public"));
        }
        request.join().unwrap();
    }
}

#[test]
fn origin_environment_and_flag_precedence() {
    for explicit in [false, true] {
        let (origin, request) = json_server(json!({ "services": [] }));
        let mut command = Command::new(env!("CARGO_BIN_EXE_exposure"));
        command.args(["list", "--json"]);
        if explicit {
            command
                .env("EXPOSURE_CONTROL_URL", "http://127.0.0.1:1")
                .args(["--url", &origin]);
        } else {
            command.env("EXPOSURE_CONTROL_URL", origin);
        }
        assert_eq!(
            stdout_json(&command.output().unwrap()),
            json!({ "services": [] })
        );
        request.join().unwrap();
    }
}

#[test]
fn disable_commands_use_the_existing_api() {
    for (args, path) in [
        (
            vec!["disable", "books", "--json"],
            "/api/services/books/disable",
        ),
        (
            vec!["disable-all", "--yes", "--json"],
            "/api/admin/disable-all",
        ),
    ] {
        let payload = json!({ "disabled": 1, "services": [] });
        let (origin, request) = json_server(payload.clone());
        assert_eq!(stdout_json(&command(&args, Some(&origin))), payload);
        assert!(
            request
                .join()
                .unwrap()
                .starts_with(&format!("POST {path} HTTP/1.1"))
        );
    }
}

#[test]
fn api_failures_html_and_invalid_json_exit_nonzero() {
    for (status, content_type, body, expected) in [
        (
            404,
            "application/json",
            "{\"error\":\"service not found\"}",
            "service not found",
        ),
        (200, "text/html", "<html>Sign in</html>", "expected JSON"),
        (200, "application/json", "broken", "invalid API response"),
        (200, "application/json", "{}", "missing services array"),
    ] {
        let (origin, request) = server(status, content_type, body.into(), "");
        let output = command(&["list", "--json"], Some(&origin));
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains(expected));
        request.join().unwrap();
    }
}

#[test]
fn redirects_are_never_followed() {
    let destination = TcpListener::bind("127.0.0.1:0").unwrap();
    let location = format!(
        "Location: http://{}/api/services\r\n",
        destination.local_addr().unwrap()
    );
    let (origin, request) = server(302, "application/json", "{}".into(), &location);
    let output = command(&["list"], Some(&origin));
    assert_eq!(output.status.code(), Some(1));
    request.join().unwrap();
    destination.set_nonblocking(true).unwrap();
    assert_eq!(
        destination.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
