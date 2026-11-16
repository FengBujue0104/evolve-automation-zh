# Evolve 自动化脚本（g8hh 简体中文镜像）

适用于 [g8hh Evolve 镜像](https://g8hh.github.io/evolve/) 的三个 Tampermonkey 用户脚本。只匹配 `https://g8hh.github.io/evolve/`，地址带 `index.html` 或查询参数时不会加载。

## 当前版本

- **Evolve 自动化（简体中文版）** `3.3.1.152-zh.9`：[安装脚本](https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/evolve_automation_zh.user.js)
- **尖塔机甲工具箱** `1.5.3`：[安装脚本](https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/spire-mech-kit.user.js)
- **尖塔灵魂石工具箱** `1.2.1`：[安装脚本](https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/soul-gem-kit.user.js)

## 安装

1. 先安装 Tampermonkey（或其他用户脚本管理器）。
2. 如果已经装着英文版 Vollch Evolve-Automation，请先停用或删除，两个同时开会重复运行。
3. 打开上面的安装链接，按提示安装。三个脚本可以同时开启。
4. 打开游戏时请使用不含 `index.html` 和查询参数的地址：[https://g8hh.github.io/evolve/](https://g8hh.github.io/evolve/)。
5. 游戏设置里需要开启「调试模式（expose）」和「预加载标签页内容」，与原版要求相同。

## 说明

中文主脚本基于 [Vollch/Evolve-Automation](https://github.com/Vollch/Evolve-Automation) 3.3.1.152，界面汉化并统一了外观。设置键和导入导出格式与原版兼容，已有设置可以照常导入。

这版会直接屏蔽锅巴汉化加在页面右侧的客服、加群和公众号浮窗。设置里的「通用 → 附加界面」有一个默认关闭的「隐藏底栏」开关，打开后会藏掉页面底部的 Evolve 作者和外链栏，并让游戏画面填满原来底栏占据的空间。zh.9 还会把灵魂石工具箱从主脚本的绿点美化样式里排除，避免开关错位。

尖塔机甲工具箱负责通关后自动换装与补队、搜集机铺满与地狱化升级，以及尖塔四件套（空气净化器、登陆点、登陆营地、机甲舱）的独立建造和供电。四件套由本脚本独立管理，不受主脚本建筑上限和电力控制影响。

尖塔灵魂石工具箱是爬塔时用来拉高灵魂宝石产量的辅助脚本，默认关闭，开始爬塔后可自动启用。开启后会尽量把引诱装置开满、把士兵送进地狱增加巡逻，并接管灵魂宝石三件套和双排桨军舰的供能，避免主脚本抢开关。适时建造默认关闭以节省灵魂宝石；关闭全部掠食者无人机默认开启（只停电、不拆除）。双排桨军舰不会被关掉，补给仍由主脚本的运输船和自动补给管理。

## 存档与配置

- 游戏存档：[saves/cid-latest-1116-2026.txt](saves/cid-latest-1116-2026.txt)
- 主脚本配置：[saves/cid-settings-1116-2026.json](saves/cid-settings-1116-2026.json)

这份存档和配置是在三个脚本都开着时导出的。配置里被灵魂石工具箱临时关掉的开关（例如地狱自动、仙女座舰队，以及三件套和双排桨的供能）已经是关着的。如果需要一份「主脚本全开」的配置，请先关掉灵魂石工具箱、等开关还原后再导出。

## 致谢

主脚本上游来自 TMVictor、Vollch 以及原脚本的各位作者。本仓库是面向 g8hh 镜像的简体中文分支与配套工具箱。
