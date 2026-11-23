/**
 * Proxy raw GitHub userscripts with Content-Type text/javascript so
 * Tampermonkey @updateURL / @downloadURL can fetch them.
 *
 * Paths:
 *   /                          — index of allowed scripts
 *   /<name>.user.js            — full script
 *   /<name>.meta.js            — ==UserScript== header only (update check)
 */

export const SCRIPTS = Object.freeze([
  "evolve_automation_zh.user.js",
  "spire-mech-kit.user.js",
  "soul-gem-kit.user.js",
  "fasting-kit.user.js",
]);

const ALLOWED = new Set(SCRIPTS);

export function extractMeta(source) {
  const match = String(source).match(
    /^[\s\S]*?(\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==)/,
  );
  return match ? match[1] + "\n" : null;
}

function scriptNameFromPath(pathname) {
  const name = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (name.endsWith(".meta.js")) {
    const user = name.slice(0, -".meta.js".length) + ".user.js";
    return ALLOWED.has(user) ? { file: user, metaOnly: true } : null;
  }
  if (name.endsWith(".user.js") && ALLOWED.has(name)) {
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

  const parsed = scriptNameFromPath(url.pathname);
  if (!parsed) return textResponse(404, "Not Found");

  const owner = env.GITHUB_OWNER || "FengBujue0104";
  const repo = env.GITHUB_REPO || "evolve-automation-zh";
  const ref = env.GITHUB_REF || "main";
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
