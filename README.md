# Evolve 自动化脚本（g8hh 简体中文镜像）

适用于 [g8hh Evolve 镜像](https://g8hh.github.io/evolve/) 的两个 Tampermonkey 用户脚本。只匹配 `https://g8hh.github.io/evolve/`，地址带 `index.html` 或查询参数时不会加载。

## 当前版本

- **Evolve 自动化（简体中文版）** `3.3.1.152-zh.8`：[安装脚本](https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/evolve_automation_zh.user.js)
- **尖塔机甲工具箱** `1.5.3`：[安装脚本](https://raw.githubusercontent.com/FengBujue0104/evolve-automation-zh/main/spire-mech-kit.user.js)

## 安装

1. 先安装 Tampermonkey（或其他用户脚本管理器）。
2. 如果已经装着英文版 Vollch Evolve-Automation，请先停用或删除，两个同时开会重复运行。
3. 打开上面的安装链接，按提示安装。
4. 打开游戏时请使用不含 `index.html` 和查询参数的地址：[https://g8hh.github.io/evolve/](https://g8hh.github.io/evolve/)。
5. 游戏设置里需要开启「调试模式（expose）」和「预加载标签页内容」，与原版要求相同。

## 说明

中文主脚本基于 [Vollch/Evolve-Automation](https://github.com/Vollch/Evolve-Automation) 3.3.1.152，界面汉化并统一了外观。设置键和导入导出格式与原版兼容，已有设置可以照常导入。

这版会直接屏蔽锅巴汉化加在页面右侧的客服、加群和公众号浮窗。设置里的「通用 → 附加界面」有一个默认关闭的「隐藏底栏」开关，打开后会藏掉页面底部的 Evolve 作者和外链栏，并让游戏画面填满原来底栏占据的空间。

尖塔机甲工具箱负责通关后自动换装与补队、搜集机铺满与地狱化升级，以及尖塔四件套（空气净化器、登陆点、登陆营地、机甲舱）的自动建造和供电。四件套由本脚本独立管理，不受主脚本建筑上限和电力控制影响。

## 致谢

主脚本上游来自 TMVictor、Vollch 以及原脚本的各位作者。本仓库是面向 g8hh 镜像的简体中文分支与配套机甲工具箱。
