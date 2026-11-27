// Syncs ../docs into Starlight's generated content and public directories without
// restructuring docs/. Reads existing frontmatter (title, summary, last_reviewed),
// derives sidebar groups directly from docs/README.md, and rewrites relative links.
// Run before every build: `node scripts/sync-docs.mjs [--watch]`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SITE, "..");
const DOCS = path.join(REPO, "docs");
const OUT_MD = path.join(SITE, "src/content/docs");
const OUT_GENERATED = path.join(SITE, "src/generated");
const OUT_STATIC = path.join(SITE, "public");
const STATIC = path.join(SITE, "static");

const GITHUB_REPO = "https://github.com/khzaw/rangoonpulse";
const GITHUB_BRANCH = "master";
const BASE_PATH = "/docs";
const DESCRIPTION_MAX = 180;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const LINK_RE = /(\]\()([^)\s#]+)(#[^)\s]*)?(\))/g;

export function parseFrontMatter(text) {
  const match = FRONT_MATTER_RE.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rawVal = line.slice(colon + 1).trim();
    meta[key] = rawVal.replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length) };
}

export function stripLeadingH1(body) {
  const match = body.match(/^\s*#\s+(.+)\r?\n?/);
  if (!match) return { h1: null, body };
  return {
    h1: match[1].trim(),
    body: body.slice(match[0].length).replace(/^\n+/, ""),
  };
}

export function firstParagraph(md) {
  for (let block of md.split(/\n\s*\n/)) {
    block = block.trim();
    if (!block || "#|-*>!<`[".includes(block[0]) || /^\d+[.)]/.test(block)) continue;
    let text = block.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
    text = text.split(/\s+/).join(" ");
    if (text.length <= DESCRIPTION_MAX) return text;
    return text.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + "…";
  }
  return null;
}

export function docSlug(relDocs) {
  const noExt = relDocs.replace(/\.md$/i, "");
  const parts = noExt.split("/");
  if (parts.at(-1)?.toLowerCase() === "readme") parts.pop();
  return parts.join("/");
}

export function pageUrl(relDocs, basePath = BASE_PATH) {
  const slug = docSlug(relDocs);
  const prefix = basePath.replace(/\/$/, "");
  return slug ? `${prefix}/${slug}/` : `${prefix}/`;
}

export function parseSidebarFromReadme(readmeText, validSlugs) {
  const sections = [];
  const seen = new Set();
  let current = null;

  for (const line of readmeText.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { label: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const linkMatch = line.match(/^\s*-\s+\[[^\]]+\]\(([^)#\s]+)\)/);
    if (!linkMatch) continue;
    const target = linkMatch[1].replace(/^\.\//, "");
    if (!target.endsWith(".md")) continue;
    const slug = docSlug(target);
    if (!slug || !validSlugs.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    current.items.push({ slug });
  }

  const groups = sections.filter((section) => section.items.length > 0);
  const uncategorized = [...validSlugs].filter((slug) => slug && !seen.has(slug)).sort();
  if (uncategorized.length > 0) {
    groups.push({
      label: "Additional Guides",
      items: uncategorized.map((slug) => ({ slug })),
    });
  }

  return [
    {
      label: "Start Here",
      items: [{ label: "Documentation Index", slug: "index" }],
    },
    ...groups,
  ];
}

export function rewriteLinks(md, relFile, opts = {}) {
  const docsDir = opts.docsDir || DOCS;
  const repoDir = opts.repoDir || REPO;
  const basePath = opts.basePath ?? BASE_PATH;
  const hasRepoTree = opts.hasRepoTree ?? fs.existsSync(path.join(repoDir, "flux"));
  const pageDir = path.dirname(path.join(docsDir, relFile));

  const lines = md.split("\n");
  let fence = "";
  const rewritten = lines.map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      const token = marker[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = "";
      return line;
    }
    if (fence) return line;

    return line.replace(LINK_RE, (all, open, rawTarget, hash = "", close) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith("/")) return all;
      const decoded = decodeURI(rawTarget);
      const abs = path.normalize(path.join(pageDir, decoded));
      const relDocs = path.relative(docsDir, abs).split(path.sep).join("/");
      const inDocs = relDocs !== "" && !relDocs.startsWith("..") && !path.isAbsolute(relDocs);

      if (inDocs) {
        if (relDocs.endsWith(".md") && fs.existsSync(abs)) {
          return `${open}${pageUrl(relDocs, basePath)}${hash}${close}`;
        }
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(path.join(abs, "README.md"))) {
          return `${open}${pageUrl(`${relDocs}/README.md`, basePath)}${hash}${close}`;
        }
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const ext = path.extname(relDocs).toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            return `${open}${basePath.replace(/\/$/, "")}/${relDocs}${hash}${close}`;
          }
          return `${open}${GITHUB_REPO}/blob/${GITHUB_BRANCH}/docs/${relDocs}${hash}${close}`;
        }
        // Leave missing in-docs link untouched so starlight-links-validator reports it.
        return all;
      }

      const relRepo = path.relative(repoDir, abs).split(path.sep).join("/");
      if (relRepo.startsWith("..") || path.isAbsolute(relRepo)) return all;

      if (fs.existsSync(abs)) {
        const kind = fs.statSync(abs).isDirectory() ? "tree" : "blob";
        return `${open}${GITHUB_REPO}/${kind}/${GITHUB_BRANCH}/${relRepo}${hash}${close}`;
      }
      if (!hasRepoTree) {
        const isDirHint = rawTarget.endsWith("/") || !path.basename(relRepo).includes(".");
        const kind = isDirHint ? "tree" : "blob";
        return `${open}${GITHUB_REPO}/${kind}/${GITHUB_BRANCH}/${relRepo}${hash}${close}`;
      }
      return all;
    });
  });

  return rewritten.join("\n");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function docsFiles() {
  if (fs.existsSync(path.join(REPO, ".git"))) {
    try {
      const out = execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "docs"],
        { cwd: REPO, encoding: "utf8" },
      );
      return out
        .split("\0")
        .filter(Boolean)
        .map((file) => path.join(REPO, file))
        .filter((file) => fs.existsSync(file));
    } catch {
      // Fall back to walking docs/ when git is unavailable (e.g. Docker build).
    }
  }
  return walk(DOCS);
}

function gitDates() {
  const dates = new Map();
  if (!fs.existsSync(path.join(REPO, ".git"))) return dates;
  try {
    const out = execFileSync(
      "git",
      ["log", "--format=#%cs", "--name-only", "--", "docs"],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 },
    );
    let currentDate = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("#")) currentDate = line.slice(1);
      else if (line && !dates.has(line)) dates.set(line, currentDate);
    }
  } catch {
    // Ignore when git history is unavailable; frontmatter last_reviewed is used.
  }
  return dates;
}

function writeIfChanged(dest, data) {
  const next = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  if (fs.existsSync(dest) && Buffer.compare(fs.readFileSync(dest), next) === 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, next);
}

function prune(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const abs of walk(dir)) {
    if (!keep.has(abs)) fs.rmSync(abs);
  }
}

const yamlString = (value) => JSON.stringify(value);

export function sync() {
  const out = new Map();
  for (const abs of walk(STATIC)) {
    out.set(path.join(OUT_STATIC, path.relative(STATIC, abs)), fs.readFileSync(abs));
  }

  const dates = gitDates();
  const validSlugs = new Set();
  let readmeRaw = "";
  let pageCount = 0;

  for (const abs of docsFiles()) {
    const rel = path.relative(DOCS, abs).split(path.sep).join("/");
    if (!rel.endsWith(".md")) {
      if (IMAGE_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
        out.set(path.join(OUT_STATIC, rel), fs.readFileSync(abs));
      }
      continue;
    }

    const raw = fs.readFileSync(abs, "utf8");
    const isRootReadme = rel === "README.md";
    if (isRootReadme) readmeRaw = raw;

    const { meta, body: withoutFm } = parseFrontMatter(raw);
    const { h1, body: withoutH1 } = stripLeadingH1(withoutFm);
    const title = meta.title || h1 || path.basename(rel, ".md");
    const description = meta.summary || firstParagraph(withoutH1);
    const rewrittenBody = rewriteLinks(withoutH1, rel);

    const fm = [`title: ${yamlString(title)}`];
    if (description) fm.push(`description: ${yamlString(description)}`);

    const gitDate = dates.get(`docs/${rel}`);
    const lastUpdated = gitDate || (/^\d{4}-\d{2}-\d{2}$/.test(meta.last_reviewed || "") ? meta.last_reviewed : null);
    if (lastUpdated) fm.push(`lastUpdated: ${lastUpdated}`);

    fm.push(`editUrl: ${yamlString(`${GITHUB_REPO}/edit/${GITHUB_BRANCH}/docs/${rel}`)}`);

    let finalBody = rewrittenBody;
    if (isRootReadme && fs.existsSync(path.join(DOCS, "diagrams/service-map.png"))) {
      finalBody =
        `[![Service map: cluster workloads and private, public, and temporary-share paths](${BASE_PATH}/diagrams/service-map.png)](${BASE_PATH}/diagrams/service-map.png)\n\n` +
        rewrittenBody;
    }

    const isIndex = path.basename(rel) === "README.md";
    const outRel = isIndex ? rel.replace(/README\.md$/, "index.md") : rel;
    out.set(path.join(OUT_MD, outRel), `---\n${fm.join("\n")}\n---\n\n${finalBody}`);

    const slug = docSlug(rel);
    if (slug) validSlugs.add(slug);
    pageCount++;
  }

  const sidebar = parseSidebarFromReadme(readmeRaw, validSlugs);
  out.set(path.join(OUT_GENERATED, "sidebar.json"), JSON.stringify(sidebar, null, 2) + "\n");
  out.set(path.join(OUT_STATIC, "robots.txt"), "User-agent: *\nDisallow: /\n");

  for (const [dest, data] of out) writeIfChanged(dest, data);
  const keep = new Set(out.keys());
  prune(OUT_MD, keep);
  prune(OUT_GENERATED, keep);
  prune(OUT_STATIC, keep);

  console.log(`sync-docs: ${pageCount} pages, ${sidebar.length} sidebar groups`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.argv.includes("--watch")) {
    sync();
  } else {
    let timer;
    for (const dir of [DOCS, STATIC]) {
      if (!fs.existsSync(dir)) continue;
      fs.watch(dir, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(sync, 150);
      });
    }
  }
}
