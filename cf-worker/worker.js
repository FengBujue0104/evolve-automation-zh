/**
 * Proxy raw GitHub userscripts with Content-Type text/javascript so
 * Tampermonkey @updateURL / @downloadURL can fetch them.
 *
 * Paths:
 *   /                          — index of allowed scripts
 *   /<name>.user.js            — full script
 *   /<name>.meta.js            — ==UserScript== header only (update check)
 *   /nodeseek/                 — index of NodeSeek scripts
 *   /nodeseek/<name>.user.js   — from FengBujue0104/nodeseek-scripts
 *   /nodeseek/<name>.meta.js
 */

export const SCRIPTS = Object.freeze([
  "evolve_automation_zh.user.js",
  "spire-mech-kit.user.js",
  "soul-gem-kit.user.js",
  "fasting-kit.user.js",
]);

const ALLOWED = new Set(SCRIPTS);

// Second repo, served under /nodeseek/. Evolve paths above are unaffected.
const NODESEEK_PREFIX = "/nodeseek/";
export const NODESEEK_SCRIPTS = Object.freeze([
  "nodeseek-hotlist.user.js",
  "nodeseek-pro-max.user.js",
  "nodeseek-level1.user.js",
]);
const NODESEEK_ALLOWED = new Set(NODESEEK_SCRIPTS);

export function extractMeta(source) {
  const match = String(source).match(
    /^[\s\S]*?(\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==)/,
  );
  return match ? match[1] + "\n" : null;
}

function scriptNameFromPath(pathname, allowed = ALLOWED) {
  let name;
  try {
    name = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (name.endsWith(".meta.js")) {
    const user = name.slice(0, -".meta.js".length) + ".user.js";
    return allowed.has(user) ? { file: user, metaOnly: true } : null;
  }
  if (name.endsWith(".user.js") && allowed.has(name)) {
    return { file: name, metaOnly: false };
  }
  return null;
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function textResponse(status, body, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: corsHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    }),
  });
}

function jsResponse(body, filename, { cacheSeconds = 300 } = {}) {
  return new Response(body, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

function indexBody(origin) {
  const lines = [
    "Evolve Automation ZH userscript mirror",
    `source: https://github.com/${"FengBujue0104"}/evolve-automation-zh`,
    "",
    "GET /<name>.user.js   full script",
    "GET /<name>.meta.js   UserScript header only (for @updateURL)",
    "",
  ];
  for (const file of SCRIPTS) {
    const meta = file.replace(/\.user\.js$/, ".meta.js");
    lines.push(`${origin}/${file}`);
    lines.push(`${origin}/${meta}`);
    lines.push("");
  }
  return lines.join("\n");
}

function nodeseekIndexBody(origin) {
  const lines = [
    "NodeSeek userscript mirror",
    "source: https://github.com/FengBujue0104/nodeseek-scripts",
    "",
  ];
  for (const file of NODESEEK_SCRIPTS) {
    lines.push(`${origin}${NODESEEK_PREFIX}${file}`);
    lines.push(`${origin}${NODESEEK_PREFIX}${file.replace(/\.user\.js$/, ".meta.js")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function handleRequest(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (method !== "GET" && method !== "HEAD") {
    return textResponse(405, "Method Not Allowed", { Allow: "GET, HEAD, OPTIONS" });
  }

  if (url.pathname === "/" || url.pathname === "") {
    const body = indexBody(url.origin);
    const res = textResponse(200, body, { "Cache-Control": "public, max-age=60" });
    if (method === "HEAD") return new Response(null, { status: 200, headers: res.headers });
    return res;
  }

  const isNodeseek = url.pathname.startsWith(NODESEEK_PREFIX) || url.pathname === "/nodeseek";
  if (isNodeseek && (url.pathname === "/nodeseek" || url.pathname === NODESEEK_PREFIX)) {
    const res = textResponse(200, nodeseekIndexBody(url.origin), { "Cache-Control": "public, max-age=60" });
    if (method === "HEAD") return new Response(null, { status: 200, headers: res.headers });
    return res;
  }

  const parsed = isNodeseek
    ? scriptNameFromPath(url.pathname.slice(NODESEEK_PREFIX.length), NODESEEK_ALLOWED)
    : scriptNameFromPath(url.pathname);
  if (!parsed) return textResponse(404, "Not Found");

  const owner = env.GITHUB_OWNER || "FengBujue0104";
  const repo = isNodeseek
    ? env.NODESEEK_REPO || "nodeseek-scripts"
    : env.GITHUB_REPO || "evolve-automation-zh";
  const ref = isNodeseek ? env.NODESEEK_REF || "main" : env.GITHUB_REF || "main";
  const upstream = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${parsed.file}`;

  const upstreamRes = await fetchImpl(upstream, {
    headers: {
      "User-Agent": "evolve-scripts-cf-worker/1.0 (+https://github.com/FengBujue0104/evolve-automation-zh)",
      Accept: "text/plain, application/javascript, */*",
    },
    redirect: "follow",
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  if (!upstreamRes.ok) {
    return textResponse(
      upstreamRes.status === 404 ? 404 : 502,
      `Upstream ${upstreamRes.status} for ${parsed.file}`,
    );
  }

  const source = await upstreamRes.text();
  if (parsed.metaOnly) {
    const meta = extractMeta(source);
    if (!meta) return textResponse(502, `No ==UserScript== header in ${parsed.file}`);
    const filename = parsed.file.replace(/\.user\.js$/, ".meta.js");
    const res = jsResponse(meta, filename);
    if (method === "HEAD") return new Response(null, { status: 200, headers: res.headers });
    return res;
  }

  const res = jsResponse(source, parsed.file);
  if (method === "HEAD") return new Response(null, { status: 200, headers: res.headers });
  return res;
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
