# VideoBuddy 打包脚本

`scripts/package.mjs` 是统一的跨平台打包入口：一条命令完成「重建 + 打包 + 校验」，并在最后打印**产物绝对路径、文件大小、版本、产品名、AppId、架构、时间**等包体常规信息。

## 用法

```sh
# 在当前平台自动选择目标（macOS → mac，Windows → win）
node scripts/package.mjs

# 显式指定目标
node scripts/package.mjs mac            # 无签名 universal macOS DMG（dist/mac-smoke）
node scripts/package.mjs win            # 无签名 Windows x64 NSIS 安装包（dist）
node scripts/package.mjs win-portable   # 无签名 Windows x64 便携 ZIP（dist）

# 可选标记
node scripts/package.mjs mac --skip-build   # 跳过重建（用上次已构建的产物，省时间）
node scripts/package.mjs mac --run-gate     # 同时跑完整打包预检门禁（默认跳过）
node scripts/package.mjs --help             # 打印帮助
```

## 产物位置

| 目标 | 产物 | 输出目录 |
| --- | --- | --- |
| `mac` | `VideoBuddy-<version>-universal.dmg` | `dsh-plugin-desktop/dist/mac-smoke/` |
| `win` | `VideoBuddy-<version>-x64-Setup.exe`（及 `win-unpacked/VideoBuddy.exe`） | `dsh-plugin-desktop/dist/` |
| `win-portable` | `VideoBuddy-<version>-x64-Portable.zip` | `dsh-plugin-desktop/dist/` |

## 脚本做的事

1. **校验环境**：Node 需 `^22.19.0` 或 `>=24.0.0`；mac 目标需原生 macOS 主机、win 目标需原生 Windows 主机（与上游打包脚本约束一致）。
2. **补齐依赖**（首次）：`git submodule update --init --recursive`、`corepack yarn install --immutable`（已装则跳过）。
3. **默认镜像**（中国网络）：当 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 未设置时，自动指向 `npmmirror.com`，可 `--no-mirror` 或手动设置环境变量覆盖。
4. **重建**：`canvas-studio build` → `dsh-plugin-desktop build`（桌面 `dist:*` 脚本不会重建，这一步骤保证打包进最新 canvas 源码；`--skip-build` 可跳过）。
5. **打包**：调用官方根脚本（`dist:mac-smoke` / `dist:win` / `dist:win-portable`），并默认设 `DSH_PACKAGE_CHECK_ALREADY_RAN=1` 跳过重量级打包门禁（`--run-gate` 恢复）。
6. **校验 + 输出**：运行官方 smoke/验证脚本，随后打印产物与元数据。

## 数据目录（隔离）

VideoBuddy 是自包含产品，数据 home 固定为 `~/.videobuddy`（可用环境变量 `VIDEOBUDDY_HOME` 覆写，需绝对或 `~/` 路径）。它**故意不读**用户机器上 `$DSH_HOME`（其它已装的 dsh 客户端可能 export 它）：应用启动时会把进程内 `DSH_HOME` 强制设为 VideoBuddy 自身 home（`src/main.ts` 的 `resolveDesktopDataHome()`），因此**会话、存储、快照、预设等所有数据**都落在 `~/.videobuddy/` 下（如 `~/.videobuddy/sessions/`、`~/.videobuddy/storages/`），与任何其它应用/CLI 完全隔离、互不影响。

- 只改当前进程环境，不写系统变量、不动 `~/.dsh`。
- 历史数据：`~/.dsh` 里的旧数据不会被读取或迁移；VideoBuddy 从该 home 从零累积，之后持续保留（改了 `VIDEOBUDDY_HOME` 才换目录）。

## 应用图标来源

安装包/程序图标（mac Dock 图标、Win .exe/开始菜单、Linux）统一来自 **Canvas Studio 品牌图**
`canvas-studio/assets/brand/png/icon-1024.png`。桌面构建链会把它转成打包源图标，无需手工维护：

1. `dsh-plugin-desktop/scripts/rewrite-app-icon.mjs`：把品牌 `icon-1024.png` 写成
   `build/app-icon.png`，并转成 mac 生成器要求的 **RGBA16 + Display P3 ICC** 格式；
2. `generate-mac-app-icon.mjs`：从 `build/app-icon.png` 派生带安全区缩放的
   `build/app-icon-mac.png`（macOS 系统遮罩裁圆角），供 `build.mac.icon` 使用；
3. `build.win.icon` / `build.linux.icon` 直接读 `build/app-icon.png`（electron-builder 在
   打包时自行转 .ico 等格式）。

换图标只需替换 `canvas-studio/assets/brand/png/icon-1024.png`，重新 `build` 即可。

## 注意事项

- **签名**：以上都是**无签名**产物（mac 未公证、Win 未 Authenticode）。签名发布是单独的凭据步骤：mac 走 `release-mac.ts`（`dist:mac`，需签名/公证凭据），Win 需在打包机上配置证书。本脚本仅用于日常构建/验收/分发无签名包。
- **架构**：mac 产物为 universal（兼容 Intel + Apple Silicon）；win 为 x64。
- **版本号**：产物文件名和 `info` 里的版本来自 `dsh-plugin-desktop/package.json` 的 `version`（当前 `2.0.3`）。
- **无法跨主机**：mac 包只能在 macOS 上打，Windows 包只能在 Windows 上打，这是上游脚本与原生二进制依赖决定的。
- **历史残留**：脚本会兜底识别输出目录里形如 `*.dmg/.exe/.zip` 的产物，正式命名以表中为准。
