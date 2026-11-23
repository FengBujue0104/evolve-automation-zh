#!/usr/bin/env node
/**
 * Local tests for the userscript proxy worker.
 * 1) Unit tests with a stub fetch that serves files from a local repo clone.
 * 2) Optional live test against wrangler dev if BASE_URL is set, or against
 *    the worker calling real raw.githubusercontent.com (LIVE=1).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest, extractMeta, SCRIPTS, NODESEEK_SCRIPTS } from "./worker.js";

const here = dirname(fileURLToPath(import.meta.url));
const localRepo = process.env.SCRIPT_DIR || "/workspace/evolve-automation-zh";
const nodeseekRepo = process.env.NODESEEK_DIR || "/workspace/ns-work/repo";
const env = {
  GITHUB_OWNER: "FengBujue0104",
  GITHUB_REPO: "evolve-automation-zh",
  GITHUB_REF: "main",
  NODESEEK_REPO: "nodeseek-scripts",
  NODESEEK_REF: "main",
};

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok  " + msg);
  else {
    failed += 1;
    console.error("  FAIL " + msg);
  }
}

function stubFetch(dir) {
  return async (url) => {
    const u = String(url);
    const file = u.split("/").pop();
    const path = join(dir, file);
    if (!existsSync(path)) return new Response("missing " + file, { status: 404 });
    return new Response(readFileSync(path, "utf8"), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
}

async function call(path, { method = "GET", fetchImpl } = {}) {
  const req = new Request("https://evolve-scripts.example.workers.dev" + path, { method });
  return handleRequest(req, env, { fetchImpl });
}

function headerVersion(text) {
  const m = String(text).match(/\/\/\s*@version\s+(\S+)/);
  return m ? m[1] : null;
}

console.log("== unit: extractMeta / routing (stub upstream) ==");
const fetchImpl = stubFetch(localRepo);

for (const file of SCRIPTS) {
  const local = readFileSync(join(localRepo, file), "utf8");
  const expectedVer = headerVersion(local);
  const metaName = file.replace(/\.user\.js$/, ".meta.js");

  const userRes = await call("/" + file, { fetchImpl });
  const userBody = await userRes.text();
  assert(userRes.status === 200, `${file} status 200 (got ${userRes.status})`);
  assert(
    (userRes.headers.get("Content-Type") || "").startsWith("text/javascript"),
    `${file} Content-Type text/javascript (got ${userRes.headers.get("Content-Type")})`,
  );
  assert(headerVersion(userBody) === expectedVer, `${file} @version ${expectedVer}`);
  assert(userBody === local, `${file} body matches local file`);

  const metaRes = await call("/" + metaName, { fetchImpl });
  const metaBody = await metaRes.text();
  assert(metaRes.status === 200, `${metaName} status 200 (got ${metaRes.status})`);
  assert(
    (metaRes.headers.get("Content-Type") || "").startsWith("text/javascript"),
    `${metaName} Content-Type text/javascript`,
  );
  assert(headerVersion(metaBody) === expectedVer, `${metaName} @version ${expectedVer}`);
  assert(metaBody.includes("// ==UserScript=="), `${metaName} has opening header`);
  assert(metaBody.includes("// ==/UserScript=="), `${metaName} has closing header`);
  assert(!metaBody.includes("function "), `${metaName} does not include script body`);
  assert(extractMeta(local) === metaBody, `${metaName} equals extractMeta()`);

  const headRes = await call("/" + file, { method: "HEAD", fetchImpl });
  const headBody = await headRes.text();
  assert(headRes.status === 200, `HEAD ${file} status 200`);
  assert(headBody === "", `HEAD ${file} empty body`);
  assert(
    (headRes.headers.get("Content-Type") || "").startsWith("text/javascript"),
    `HEAD ${file} Content-Type text/javascript`,
  );
}

const miss = await call("/not-a-script.user.js", { fetchImpl });
assert(miss.status === 404, "unknown script 404");
const traversal = await call("/../package.json", { fetchImpl });
assert(traversal.status === 404, "path traversal 404");
const idx = await call("/", { fetchImpl });
assert(idx.status === 200, "index 200");
const idxBody = await idx.text();
assert(idxBody.includes("evolve_automation_zh.user.js"), "index lists main script");


console.log("\n== unit: /nodeseek/ prefix (second repo) ==");
const seen = [];
const routedFetch = async (url) => {
  const u = String(url);
  seen.push(u);
  const evo = "https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/";
  const ns = "https://raw.githubusercontent.com/FengBujue0104/nodeseek-scripts/main/";
  const dir = u.startsWith(ns) ? nodeseekRepo : u.startsWith(evo) ? localRepo : null;
  const file = dir && u.slice((u.startsWith(ns) ? ns : evo).length);
  if (!dir || file.includes("/") || !existsSync(join(dir, file))) return new Response("missing", { status: 404 });
  return new Response(readFileSync(join(dir, file), "utf8"), { status: 200 });
};
for (const file of SCRIPTS) {
  seen.length = 0;
  const res = await call("/" + file, { fetchImpl: routedFetch });
  assert(res.status === 200 && seen[0] === `https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/${file}`,
    `evolve ${file} still proxies evolve-automation-zh`);
  assert((await res.text()) === readFileSync(join(localRepo, file), "utf8"), `evolve ${file} body unchanged`);
}
for (const file of NODESEEK_SCRIPTS) {
  const local = readFileSync(join(nodeseekRepo, file), "utf8");
  const ver = headerVersion(local);
  seen.length = 0;
  const res = await call("/nodeseek/" + file, { fetchImpl: routedFetch });
  const body = await res.text();
  assert(res.status === 200, `/nodeseek/${file} 200 (got ${res.status})`);
  assert(seen[0] === `https://raw.githubusercontent.com/FengBujue0104/nodeseek-scripts/main/${file}`, `/nodeseek/${file} upstream URL`);
  assert((res.headers.get("Content-Type") || "").startsWith("text/javascript"), `/nodeseek/${file} Content-Type`);
  assert(body === local, `/nodeseek/${file} body matches`);
  const meta = await call("/nodeseek/" + file.replace(/\.user\.js$/, ".meta.js"), { fetchImpl: routedFetch });
  const metaBody = await meta.text();
  assert(meta.status === 200 && headerVersion(metaBody) === ver, `/nodeseek/ meta ${file} @version ${ver}`);
  assert(metaBody === extractMeta(local), `/nodeseek/ meta ${file} header only`);
  assert(metaBody.includes(`https://scripts.fengbujue.com/nodeseek/${file}`), `${file} @downloadURL points to /nodeseek/`);
  const cross = await call("/" + file, { fetchImpl: routedFetch });
  assert(cross.status === 404, `/${file} without prefix 404`);
}
for (const file of SCRIPTS) {
  const r = await call("/nodeseek/" + file, { fetchImpl: routedFetch });
  assert(r.status === 404, `/nodeseek/${file} (evolve name under prefix) 404`);
}
for (const bad of ["/nodeseek/x/nodeseek-hotlist.user.js", "/nodeseek/%2e%2e%2fnodeseek-hotlist.user.js", "/nodeseek/%E0%A4%A.user.js"]) {
  const r = await call(bad, { fetchImpl: routedFetch });
  assert(r.status === 404, `bad path ${bad} 404 (got ${r.status})`);
}
const nsIdx = await call("/nodeseek/", { fetchImpl: routedFetch });
const nsIdxBody = await nsIdx.text();
assert(nsIdx.status === 200 && nsIdxBody.includes("/nodeseek/nodeseek-pro-max.user.js"), "/nodeseek/ index lists scripts");
assert(!idxBody.includes("nodeseek"), "root index unchanged (no nodeseek entries)");

if (process.env.LIVE === "1") {
  console.log("\n== live: worker fetch of raw.githubusercontent.com ==");
  for (const file of SCRIPTS) {
    const res = await call("/" + file);
    const body = await res.text();
    const ver = headerVersion(body);
    assert(res.status === 200, `live ${file} status 200 (got ${res.status})`);
    assert(
      (res.headers.get("Content-Type") || "").startsWith("text/javascript"),
      `live ${file} Content-Type`,
    );
    assert(!!ver, `live ${file} has @version (${ver})`);
    const meta = await call("/" + file.replace(/\.user\.js$/, ".meta.js"));
    const metaBody = await meta.text();
    assert(meta.status === 200, `live meta ${file} 200`);
    assert(headerVersion(metaBody) === ver, `live meta @version matches ${ver}`);
  }
  for (const file of NODESEEK_SCRIPTS) {
    const res = await call("/nodeseek/" + file);
    const body = await res.text();
    const ver = headerVersion(body);
    assert(res.status === 200 && !!ver, `live /nodeseek/${file} 200 (${ver})`);
    const meta = await call("/nodeseek/" + file.replace(/\.user\.js$/, ".meta.js"));
    assert(headerVersion(await meta.text()) === ver, `live /nodeseek/ meta ${file} @version ${ver}`);
  }
}

if (process.env.BASE_URL) {
  const base = process.env.BASE_URL.replace(/\/$/, "");
  console.log(`\n== wrangler dev: ${base} ==`);
  for (const file of SCRIPTS) {
    const res = await fetch(base + "/" + file, {
      headers: { "User-Agent": "evolve-scripts-local-test/1.0" },
    });
    const body = await res.text();
    const ver = headerVersion(body);
    const localVer = headerVersion(readFileSync(join(localRepo, file), "utf8"));
    assert(res.status === 200, `dev ${file} status 200 (got ${res.status})`);
    assert(
      (res.headers.get("Content-Type") || "").startsWith("text/javascript"),
      `dev ${file} Content-Type (${res.headers.get("Content-Type")})`,
    );
    assert(ver === localVer, `dev ${file} @version ${ver} == local ${localVer}`);

    const metaRes = await fetch(base + "/" + file.replace(/\.user\.js$/, ".meta.js"), {
      headers: { "User-Agent": "evolve-scripts-local-test/1.0" },
    });
    const metaBody = await metaRes.text();
    assert(metaRes.status === 200, `dev meta ${file} 200`);
    assert(
      (metaRes.headers.get("Content-Type") || "").startsWith("text/javascript"),
      `dev meta Content-Type`,
    );
    assert(headerVersion(metaBody) === localVer, `dev meta @version ${localVer}`);
  }
  for (const file of NODESEEK_SCRIPTS) {
    const localVer = headerVersion(readFileSync(join(nodeseekRepo, file), "utf8"));
    for (const name of [file, file.replace(/\.user\.js$/, ".meta.js")]) {
      const res = await fetch(base + "/nodeseek/" + name, { headers: { "User-Agent": "evolve-scripts-local-test/1.0" } });
      const body = await res.text();
      assert(res.status === 200, `dev /nodeseek/${name} 200 (got ${res.status})`);
      assert((res.headers.get("Content-Type") || "").startsWith("text/javascript"), `dev /nodeseek/${name} Content-Type (${res.headers.get("Content-Type")})`);
      assert(headerVersion(body) === localVer, `dev /nodeseek/${name} @version ${headerVersion(body)} == local ${localVer}`);
    }
  }
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
