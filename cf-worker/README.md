# Evolve 脚本更新镜像（Cloudflare Worker）

把 GitHub 仓库 `FengBujue0104/evolve-automation-zh` 里的用户脚本按原路径代理出来，并加上 Tampermonkey 需要的 `Content-Type: text/javascript`。`.meta.js` 只返回 `==UserScript==` 头，方便 `@updateURL` 做版本检查。

已部署到自定义域名 **https://scripts.fengbujue.com/**（Worker 名 `evolve-scripts`）。不要把 API token 写进这些文件。一个 Worker 挂全部四个 Evolve 脚本，另在 `/nodeseek/` 下挂三个 NodeSeek 脚本。

## 允许的路径

- `/evolve_automation_zh.user.js` / `.meta.js` — Evolve 自动化（简体中文版）
- `/spire-mech-kit.user.js` / `.meta.js` — 尖塔机甲工具箱
- `/soul-gem-kit.user.js` / `.meta.js` — 尖塔灵魂石工具箱
- `/fasting-kit.user.js` / `.meta.js` — 禁食工具箱

上游：`https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/<file>`

### NodeSeek 脚本（`/nodeseek/` 前缀，第二个仓库）

同一个 Worker、同一个域名，`/nodeseek/` 下的路径代理 `FengBujue0104/nodeseek-scripts`（`wrangler.toml` 里的 `NODESEEK_REPO` / `NODESEEK_REF`）。上面四个 Evolve 路径和根目录索引不受影响。

- `/nodeseek/` — NodeSeek 脚本索引
- `/nodeseek/nodeseek-hotlist.user.js` / `.meta.js` — NodeSeek 热榜插件
- `/nodeseek/nodeseek-pro-max.user.js` / `.meta.js` — NodeSeek Pro Max（cid 改版）
- `/nodeseek/nodeseek-level1.user.js` / `.meta.js` — NodeSeek 一级及以下标记与屏蔽

上游：`https://raw.githubusercontent.com/FengBujue0104/nodeseek-scripts/main/<file>`。两组白名单互不相通：Evolve 文件名放在 `/nodeseek/` 下、NodeSeek 文件名放在根路径下都返回 404。

本地测试默认从 `/workspace/ns-work/repo` 读取 NodeSeek 脚本，可用 `NODESEEK_DIR=<nodeseek-scripts 克隆目录>` 覆盖。

## 本地测试

```bash
cd cf-worker
npm install
npm test                 # 用本地仓库文件做单元测试
LIVE=1 npm test          # 再走一遍真实 raw.githubusercontent.com
npx wrangler dev --port 8787
BASE_URL=http://127.0.0.1:8787 npm test
```

## 部署

账号里已经有 API token 时，在本目录执行：

```bash
npx wrangler deploy
```

也可以在本机跑 `npx wrangler login`（浏览器/设备码授权），或在仪表盘新建带 Workers 编辑权限的 API token，用环境变量 `CLOUDFLARE_API_TOKEN` 提供，不要写入仓库。

部署成功后，workers.dev 地址会是：

`https://evolve-scripts.fengbujue-startpage-worker.workers.dev/`

**注意：`*.workers.dev` 在中国大陆普遍不可达。** 如果主要给国内用户做更新检查，请把 Worker 绑到已接入 Cloudflare 的 `fengbujue.com` 子域（例如尚空闲的 `scripts.fengbujue.com`），在 `wrangler.toml` 里加上：

```toml
[[routes]]
pattern = "scripts.fengbujue.com"
custom_domain = true
```

自定义域名通常比 `workers.dev` 更容易从国内打开，但 Cloudflare 普通免费线路在大陆仍可能慢或不稳，不保证全国可达。

## 建议写入脚本头的地址（部署并确认可达后再改脚本，现在还没改）

把 `BASE` 换成实际上线地址（自定义域名优先，例如 `https://scripts.fengbujue.com`）：

```
// Evolve 自动化（简体中文版）
// @updateURL    BASE/evolve_automation_zh.meta.js
// @downloadURL  BASE/evolve_automation_zh.user.js

// 尖塔机甲工具箱
// @updateURL    BASE/spire-mech-kit.meta.js
// @downloadURL  BASE/spire-mech-kit.user.js

// 尖塔灵魂石工具箱
// @updateURL    BASE/soul-gem-kit.meta.js
// @downloadURL  BASE/soul-gem-kit.user.js

// 禁食工具箱
// @updateURL    BASE/fasting-kit.meta.js
// @downloadURL  BASE/fasting-kit.user.js
```
