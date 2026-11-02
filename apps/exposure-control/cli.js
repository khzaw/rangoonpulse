#!/usr/bin/env node
const { parseArgs } = require("node:util");
const { createExposureClient, createHttpRequest } = require("./exposure-client.js");

const HELP = `Usage: exposure <command> [service] [options]

Commands:
  list                         List configured shares
  show <service>               Inspect one share
  enable <service>             Enable with the server's default duration and auth
  disable <service>            Disable one share
  disable-all --yes            Disable every share
  audit [service]              Show recent audit events (newest first)

Options:
  --for <duration>             Enable for 15m to 24h, in 15-minute increments
  --until-disabled             Enable without expiry
  --auth <mode>                none or cloudflare-access
  --active                     List only enabled shares
  --limit <count>              Show 1 to 100 audit events (default: 20)
  --json                       Print machine-readable JSON
  --url <origin>               Private API origin (or EXPOSURE_CONTROL_URL)
  -h, --help                   Show this help

Default API: https://controlpanel.khzaw.dev (LAN or Tailscale required)
Examples:
  exposure enable bookorbit --for 2h --auth none
  exposure enable immich --until-disabled --auth cloudflare-access
  exposure list --active --json
`;

class UsageError extends Error {}

function durationHours(value) {
  const match = /^(\d+(?:\.\d+)?)(m|h)$/.exec(value);
  const hours = match ? Number(match[1]) / (match[2] === "m" ? 60 : 1) : NaN;
  if (!Number.isFinite(hours) || hours < 0.25 || hours > 24 || !Number.isInteger(hours * 4)) {
    throw new UsageError("--for must be 15m to 24h in 15-minute increments");
  }
  return hours;
}

function parseCommand(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      help: { type: "boolean", short: "h" }, json: { type: "boolean" },
      url: { type: "string" }, for: { type: "string" }, auth: { type: "string" },
      "until-disabled": { type: "boolean" }, active: { type: "boolean" },
      limit: { type: "string" }, yes: { type: "boolean" },
    } });
  } catch (err) { throw new UsageError(err.message); }
  const { values, positionals } = parsed;
  if (values.help || !positionals.length) return { help: true };
  const [command, id] = positionals;
  const commandOptions = {
    list: ["active"], show: [], enable: ["for", "until-disabled", "auth"],
    disable: [], "disable-all": ["yes"], audit: ["limit"],
  };
  if (!Object.hasOwn(commandOptions, command)) throw new UsageError("unknown command: " + command);
  const needsId = ["show", "enable", "disable"].includes(command);
  if ((needsId && !id) || positionals.length > (needsId || command === "audit" ? 2 : 1)) {
    throw new UsageError("usage: exposure " + command + (needsId ? " <service>" : command === "audit" ? " [service]" : ""));
  }
  if (id && !/^[a-z0-9-]+$/.test(id)) throw new UsageError("invalid service id: " + id);
  for (const key of Object.keys(values)) {
    if (!["help", "json", "url", ...commandOptions[command]].includes(key)) {
      throw new UsageError("--" + key + " is not supported by " + command);
    }
  }
  if (values.for !== undefined && values["until-disabled"]) throw new UsageError("choose --for or --until-disabled");
  if (values.auth !== undefined && !["none", "cloudflare-access"].includes(values.auth)) {
    throw new UsageError("--auth must be none or cloudflare-access");
  }
  const options = {};
  if (values.for !== undefined) options.hours = durationHours(values.for);
  if (values["until-disabled"]) options.hours = null;
  if (values.auth !== undefined) options.authMode = values.auth;
  const limit = values.limit === undefined ? 20 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new UsageError("--limit must be 1 to 100");
  if (command === "disable-all" && !values.yes) throw new UsageError("disable-all requires --yes");
  return { command, id, values, options, limit };
}

function table(rows) {
  const clean = rows.map((row) => row.map((value) => String(value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ")));
  const widths = clean[0].map((_, i) => Math.max(...clean.map((row) => row[i].length)));
  return clean.map((row) => row.map((cell, i) => i === row.length - 1 ? cell : cell.padEnd(widths[i])).join("  ")).join("\n");
}

function serviceTable(services) {
  return table([["SERVICE", "STATE", "AUTH", "EXPIRES", "URL"], ...services.map((service) => [
    service.id, service.enabled ? "public" : "off", service.authMode,
    service.enabled ? service.expiresAt || "until disabled" : "-", service.publicUrl,
  ])]);
}

async function runCli(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr,
  fetchImpl = globalThis.fetch } = {}) {
  try {
    const parsed = parseCommand(argv);
    if (parsed.help) { stdout.write(HELP); return 0; }
    const { command, id, values, options, limit } = parsed;
    const client = createExposureClient({ request: createHttpRequest({
      baseUrl: values.url ?? env.EXPOSURE_CONTROL_URL ?? "https://controlpanel.khzaw.dev", fetchImpl,
    }) });
    let payload;
    if (command === "list" || command === "show") {
      payload = await client.list();
      if (command === "show") {
        const service = payload.services.find((item) => item.id === id);
        if (!service) throw new Error("service not found: " + id);
        payload = { service };
      } else if (values.active) payload = { services: payload.services.filter((item) => item.enabled) };
    } else if (command === "enable") payload = await client.enable(id, options);
    else if (command === "disable") payload = await client.disable(id);
    else if (command === "disable-all") payload = await client.disableAll();
    else {
      const { entries } = await client.audit();
      payload = { entries: entries.filter((entry) => !id || entry.serviceId === id).slice(0, limit) };
    }
    if (values.json) stdout.write(JSON.stringify(payload, null, 2) + "\n");
    else if (command === "audit") stdout.write(table([["TIME", "ACTION", "SERVICE", "DETAIL"],
      ...payload.entries.map((entry) => [entry.ts, entry.action, entry.serviceId || "all",
        entry.expiryMode || (entry.hours !== undefined ? entry.hours + "h" : entry.authMode || "")])]) + "\n");
    else {
      if (command === "disable-all") stdout.write("Disabled " + payload.disabled + " shares.\n");
      stdout.write(serviceTable(payload.service ? [payload.service] : payload.services) + "\n");
      if (command === "show" && !values.json) {
        stdout.write("\n" + (payload.service.name || id) + ": " + payload.service.description + "\n" +
          "Target: " + payload.service.target + "\nUpdated: " + (payload.service.updatedAt || "-") + "\n");
      }
    }
    return 0;
  } catch (err) {
    const cause = err.cause?.message;
    stderr.write("exposure: " + err.message + (cause ? " (" + cause + ")" : "") + "\n");
    return err instanceof UsageError ? 2 : 1;
  }
}

if (require.main === module) runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { runCli };
