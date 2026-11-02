use clap::{Parser, Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::time::Duration;
use url::Url;

#[derive(Debug, Parser)]
#[command(
    name = "exposure",
    version,
    about = "Manage public shares through the exposure-control API"
)]
pub struct Cli {
    /// Private API origin; the in-cluster command uses the pod's loopback API
    #[arg(long, global = true, env = "EXPOSURE_CONTROL_URL", default_value = "https://controlpanel.khzaw.dev", value_parser = parse_origin)]
    url: Url,
    /// Print the API envelope as machine-readable JSON
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// List configured shares
    List {
        /// Include only effectively enabled shares
        #[arg(long)]
        active: bool,
    },
    /// Inspect one share
    Show {
        #[arg(value_parser = service_id)]
        service: String,
    },
    /// Enable a share (default: no auth, until disabled)
    Enable {
        #[arg(value_parser = service_id)]
        service: String,
        /// Expire after 15m to 24h, in 15-minute increments
        #[arg(long = "for", value_parser = duration_hours, conflicts_with = "until_disabled")]
        hours: Option<f64>,
        /// Explicitly enable without expiry (the default)
        #[arg(long)]
        until_disabled: bool,
        /// Authentication enforced by exposure-control
        #[arg(long, value_enum, default_value = "none")]
        auth: AuthMode,
    },
    /// Disable one share
    Disable {
        #[arg(value_parser = service_id)]
        service: String,
    },
    /// Disable every share
    DisableAll {
        /// Confirm disabling every share
        #[arg(long, required = true)]
        yes: bool,
    },
    /// Show recent audit events (newest first)
    Audit {
        #[arg(value_parser = service_id)]
        service: Option<String>,
        /// Number of events from the latest 100 server entries
        #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u16).range(1..=100))]
        limit: u16,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum AuthMode {
    None,
    CloudflareAccess,
}

impl AuthMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::CloudflareAccess => "cloudflare-access",
        }
    }
}

fn service_id(value: &str) -> Result<String, String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("service id must contain lowercase letters, digits, or hyphens".into());
    }
    Ok(value.into())
}

fn parse_origin(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "invalid API origin".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "URL must be an http(s) origin without credentials, path, query, or fragment".into(),
        );
    }
    Ok(url)
}

fn duration_hours(value: &str) -> Result<f64, String> {
    let hours = if let Some(minutes) = value.strip_suffix('m') {
        minutes.parse::<f64>().unwrap_or(f64::NAN) / 60.0
    } else if let Some(hours) = value.strip_suffix('h') {
        hours.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    };
    if !hours.is_finite() || !(0.25..=24.0).contains(&hours) || (hours * 4.0).fract() != 0.0 {
        return Err("duration must be 15m to 24h in 15-minute increments".into());
    }
    Ok(hours)
}

struct Client {
    origin: Url,
    agent: ureq::Agent,
}

impl Client {
    fn new(origin: Url, timeout: Duration) -> Self {
        Self {
            origin,
            agent: ureq::Agent::config_builder()
                .timeout_global(Some(timeout))
                .max_redirects(0)
                .http_status_as_error(false)
                .build()
                .into(),
        }
    }

    fn request(&self, path: &str, body: Option<Value>) -> Result<Value, String> {
        let url = self.origin.join(path).map_err(|error| error.to_string())?;
        let response = match body {
            Some(body) => self
                .agent
                .post(url.as_str())
                .header("accept", "application/json")
                .send_json(body),
            None => self
                .agent
                .get(url.as_str())
                .header("accept", "application/json")
                .call(),
        };
        let mut response = response.map_err(|error| format!("API request failed: {error}"))?;
        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok());
        if !content_type.is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim() == "application/json")
        }) {
            return Err(format!(
                "expected JSON from the private Control Panel API (HTTP {status})"
            ));
        }
        let payload: Value = response
            .body_mut()
            .with_config()
            .limit(1024 * 1024)
            .read_json()
            .map_err(|error| format!("invalid API response: {error}"))?;
        if !status.is_success() {
            return Err(payload
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("HTTP {status}")));
        }
        Ok(payload)
    }
}

fn array<'a>(payload: &'a Value, key: &str) -> Result<&'a [Value], String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| format!("invalid API response: missing {key} array"))
}

pub fn execute(cli: &Cli) -> Result<Value, String> {
    let client = Client::new(cli.url.clone(), Duration::from_secs(10));
    match &cli.command {
        Command::List { active } => {
            let payload = client.request("/api/services", None)?;
            let services = array(&payload, "services")?;
            if *active {
                Ok(
                    json!({ "services": services.iter().filter(|service| service["enabled"] == true).collect::<Vec<_>>() }),
                )
            } else {
                Ok(payload)
            }
        }
        Command::Show { service } => {
            let payload = client.request("/api/services", None)?;
            let found = array(&payload, "services")?
                .iter()
                .find(|item| item["id"] == *service)
                .ok_or_else(|| format!("service not found: {service}"))?;
            Ok(json!({ "service": found }))
        }
        Command::Enable {
            service,
            hours,
            auth,
            ..
        } => client.request(
            &format!("/api/services/{service}/enable"),
            Some(json!({ "hours": hours, "authMode": auth.as_str() })),
        ),
        Command::Disable { service } => {
            client.request(&format!("/api/services/{service}/disable"), Some(json!({})))
        }
        Command::DisableAll { .. } => client.request("/api/admin/disable-all", Some(json!({}))),
        Command::Audit { service, limit } => {
            let payload = client.request("/api/audit", None)?;
            let entries: Vec<_> = array(&payload, "entries")?
                .iter()
                .filter(|entry| service.as_ref().is_none_or(|id| entry["serviceId"] == *id))
                .take(usize::from(*limit))
                .collect();
            Ok(json!({ "entries": entries }))
        }
    }
}

pub fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

fn table(rows: Vec<Vec<String>>) -> String {
    let rows: Vec<Vec<_>> = rows
        .into_iter()
        .map(|row| row.iter().map(|cell| sanitize(cell)).collect())
        .collect();
    let widths: Vec<_> = (0..rows[0].len())
        .map(|i| {
            rows.iter()
                .map(|row| row[i].chars().count())
                .max()
                .unwrap_or(0)
        })
        .collect();
    let mut output = String::new();
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            output.push_str(cell);
            if i + 1 < row.len() {
                output.extend(std::iter::repeat_n(
                    ' ',
                    widths[i] - cell.chars().count() + 2,
                ));
            }
        }
        output.push('\n');
    }
    output
}

pub fn format_output(cli: &Cli, payload: &Value) -> Result<String, String> {
    if cli.json {
        return serde_json::to_string_pretty(payload)
            .map(|json| json + "\n")
            .map_err(|error| error.to_string());
    }
    if matches!(cli.command, Command::Audit { .. }) {
        let mut rows = vec![vec![
            "TIME".into(),
            "ACTION".into(),
            "SERVICE".into(),
            "DETAIL".into(),
        ]];
        for entry in array(payload, "entries")? {
            let mut details = Vec::new();
            if entry["expiryMode"] == "until-disabled" {
                details.push("until disabled".into());
            } else if let Some(hours) = entry.get("hours") {
                details.push(format!("{hours}h"));
            }
            if let Some(auth) = entry.get("authMode").and_then(Value::as_str) {
                details.push(auth.into());
            }
            rows.push(vec![
                text(entry, "ts"),
                text(entry, "action"),
                entry
                    .get("serviceId")
                    .and_then(Value::as_str)
                    .unwrap_or("all")
                    .into(),
                details.join(" · "),
            ]);
        }
        return Ok(table(rows));
    }
    let services = if let Some(service) = payload.get("service").filter(|value| value.is_object()) {
        std::slice::from_ref(service)
    } else {
        array(payload, "services")?
    };
    let mut rows = vec![vec![
        "SERVICE".into(),
        "STATE".into(),
        "AUTH".into(),
        "EXPIRES".into(),
        "URL".into(),
    ]];
    for service in services {
        let enabled = service["enabled"] == true;
        rows.push(vec![
            text(service, "id"),
            if enabled { "public" } else { "off" }.into(),
            text(service, "authMode"),
            if enabled {
                service["expiresAt"].as_str().unwrap_or("until disabled")
            } else {
                "-"
            }
            .into(),
            text(service, "publicUrl"),
        ]);
    }
    let mut output = String::new();
    if matches!(cli.command, Command::DisableAll { .. }) {
        output.push_str(&format!("Disabled {} shares.\n", payload["disabled"]));
    }
    output.push_str(&table(rows));
    if matches!(cli.command, Command::Show { .. }) {
        let service = &payload["service"];
        output.push_str(&sanitize(&format!(
            "{}: {}",
            text(service, "name"),
            text(service, "description")
        )));
        output.push_str(&format!(
            "\nTarget: {}\nUpdated: {}\n",
            sanitize(&text(service, "target")),
            sanitize(&text(service, "updatedAt"))
        ));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_validation() {
        for (duration, expected) in [("15m", 0.25), ("90m", 1.5), ("2h", 2.0), ("24h", 24.0)] {
            assert_eq!(duration_hours(duration), Ok(expected));
        }
        for duration in ["0h", "5m", "16m", "25h", "NaNh", "infh", "2", "-1h"] {
            assert!(duration_hours(duration).is_err(), "{duration}");
        }
    }

    #[test]
    fn origin_validation() {
        for url in [
            "file:///tmp/api",
            "https://user:pass@example.test",
            "https://example.test/api",
            "https://example.test/?a=1",
            "https://example.test/#fragment",
        ] {
            assert!(parse_origin(url).is_err(), "{url}");
        }
        assert!(parse_origin("https://controlpanel.example.test").is_ok());
        assert!(parse_origin("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn terminal_controls_are_removed() {
        assert_eq!(sanitize("Books\n\x1b[31m"), "Books  [31m");
    }

    #[test]
    fn deadline_includes_a_trickling_response_body() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Instant;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n").unwrap();
            for _ in 0..50 {
                if stream.write_all(b" ").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let client = Client::new(origin, Duration::from_millis(120));
        let start = Instant::now();
        assert!(client.request("/api/services", None).is_err());
        assert!(start.elapsed() < Duration::from_millis(800));
        drop(client);
        server.join().unwrap();
    }
}
