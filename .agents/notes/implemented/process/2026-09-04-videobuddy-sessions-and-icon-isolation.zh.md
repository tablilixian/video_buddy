# VideoBuddy 数据 home 隔离、品牌应用图标与会话存储

[English](2026-09-04-videobuddy-sessions-and-icon-isolation.md) | 中文

记录本工作批次合入的三项桌面改动：（1）与用户已装的 DeepSeek Harness CLI 完全隔离的数据 home；
（2）安装包应用图标改用 Canvas Studio 品牌标记；（3）本批次早前引入的可复现一键打包脚本。

## 1. 数据 home 完全自包含（DSH_HOME 强制指向 VideoBuddy home）

上游 `@deepseek-ai/dsh-home-paths` 解析优先级为「显式参数 > $DSH_HOME 环境变量 > ~/.dsh」。
此前桌面只在侧把 `~/.videobuddy` 作为局部 `resolveDshHome(configured)` 参数传入，并且只给
`settings` 行配置打了 `dshHome: home` 补丁；而进程内其它所有 harness 消费点
（`session-persistence-jsonl` root、`storage-json` root、快照、预设、`llm-deepseek/upload-index` 等）
经 `dshHomePath()`/`resolveDshHome()` 解析，该函数读 `process.env` 的 `$DSH_HOME` 或回退到
`~/.dsh`。因此在用户装过 dsh CLI 并 export 了 `DSH_HOME` 的机器上，VideoBuddy 的会话和存储会落到
`~/.dsh`，可能与其它应用冲突。

修复（`dsh-plugin-desktop/src/main.ts`）：
- 新增 `VIDEOBUDDY_HOME` 环境变量与 `resolveDesktopDataHome()`：显式 `$VIDEOBUDDY_HOME` 优先，
  否则用专有目录 `~/.videobuddy`。VideoBuddy 从不采纳用户提供的 `$DSH_HOME`。
- 在 `homeDir` 解析后、harness `boot()` 之前设置 `process.env[DSH_HOME_ENV] = homeDir`。
  这会让进程内所有 harness `resolveDshHome()`/`dshHomePath()` 指向 VideoBuddy 专属目录；由于该赋值
  发生在 VideoBuddy 自己的 Electron 进程里，会覆盖启动 shell 继承来的任何 `$DSH_HOME`。其它已装的
  dsh 客户端及其 `~/.dsh` 数据不受影响。
- 旧的 `~/.dsh` 历史数据既不读取也不迁移；VideoBuddy 从干净的起点开始，在 `~/.videobuddy` 下
  （`~/.videobuddy/sessions/`、`~/.videobuddy/storages/` 等）持续累积。

验证：模拟 `$DSH_HOME=~/.dsh` 时，覆盖前解析器返回 `~/.dsh`；覆盖 `DSH_HOME=~/.videobuddy` 后，
`dshHomePath("sessions")` 与 `dshHomePath("storages")` 均解析到 `~/.videobuddy` 下。编译产物
`lib/main.js` 含该赋值。

## 2. 安装包应用图标改用 Canvas Studio 品牌标记

`dsh-plugin-desktop/scripts/rewrite-app-icon.mjs`（新增）：读取
`canvas-studio/assets/brand/png/icon-1024.png`，写出 `build/app-icon.png`，并转成 RGBA16 +
Display P3 ICC——即 `generate-mac-app-icon.mjs` 强制要求的格式。它被接入桌面 `build` 链的第一步
（在 `generate-mac-app-icon.mjs` 之前），因此每次构建都会从品牌源重新生成图标，且幂等（输出哈希一致）。
各消费点本就指向正确的文件：mac `build.mac.icon` → `app-icon-mac.png`（含 Dock 安全区缩放），
win/linux → `build/app-icon.png`。

验证：`typecheck` + `build` 通过；打包出的 mac DMG 中 `icon.icns` 携带品牌标记（透明安全区边角、
深色 `#1A1D29→#0F1117` 背景、紫色 `#795CF7` 标记）。Windows/portable 的 `.ico` 生成只能在原生
Windows 主机上确认。

### macOS Dock 图标圆角

macOS（Big Sur–Sequoia）**不像 iOS 那样**自动给应用图标裁圆角：它原样渲染你提供的图稿。品牌标记
是满出血、不透明的深色方块，若直接缩放会得到直角方块，Dock 里就显示尖角。需要两件事同时成立：

- **居中安全区几何**——824 图稿居中于 1024 画布，四边各留 100px 透明内边距（`generate-mac-app-icon.mjs`
  本就做到）。此前「不居中」的读数其实是测量 bug：该 PNG 是 RGBA16（每像素 8 字节），用 8 位 alpha
  解析会读错；用基于 sharp 的正确测量，内边距恰为 `{left:100,top:100,right:100,bottom:100}`。
- **连续圆角 squircle 遮罩**——一个居中的纯方块四角像素仍不透明，macOS 仍画成直角。修复：在 extend
  之前用 Apple 的连续圆角 squircle 遮罩 824 图稿。新增辅助 `squirclePath(side, radius, smoothing)`，
  移植自按 Apple 系统图标实测的 chartr 网格（`RADIUS_RATIO = 0.225`、`CORNER_SMOOTHING = 0.7`），
  并以 `dest-in` 合成应用。结果：四个角像素 `(100,100)/(923,100)/(100,923)/(923,923)` 完全透明，
  边中点保持不透明。已在一整次 `build` 后在像素级验证。

## 3. 一键打包脚本

`scripts/package.mjs` 通过单条命令产出无签名 mac/win/win-portable 包并打印产物路径与包体元数据；
`VIDEOBUDDY_HOME` 已写入 `scripts/package.README.md`。根目录新增 `yarn package:build` 别名。

## 跨切面注意事项

- 未改动固定上游 `deepseek-harness/` 子模块内部任何文件。
- 图标重写把 Display P3 ICC 配置内嵌为 base64 常量（536 字节，md5 `ecfda38e388547c36db4bd4f7ada182f`，
  与既有管线一致）。
- Windows 品牌（`package.json`/win 校验 spec）已在本工作批次中改为 VideoBuddy。
