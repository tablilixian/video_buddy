# Agent Note: VideoBuddy 打包与配置

Status: implemented (partial)

English | [中文](2026-09-04-videobuddy-packaging-and-configuration.zh.md)

## 问题

DSH Desktop 分支正被改造成名为 **VideoBuddy** 的独立画布产品。新用户打开安装 DMG 后应直接进入 canvas-studio 画布界面，且 VideoBuddy 必须与同一台机器上已安装的 DSH Desktop 完全共存，不触碰其数据、标识或应用状态。本笔记记录打包与配置决策、已完成项、待办项，以及保持两者隔离的注意事项。

## 决策

桌面产品在 VideoBuddy 标识下拥有整个运行时，固定的上游 `deepseek-harness/` 子模块保持只读。分离分为两层：**数据目录**（已完全隔离并验证）与**非数据标识/品牌**（部分清理）。

### 产品标识
- `dsh-plugin-desktop/package.json`：`build.appId = com.videobuddy.desktop`、`build.productName = VideoBuddy`。
- `dsh-plugin-desktop/src/main.ts:141` `PRODUCT_NAME = 'VideoBuddy'`；`main.ts:1019` `app.setName(PRODUCT_NAME)`；`main.ts:435` Windows `app.setAppUserModelId('com.videobuddy.desktop')`。
- 产品版本为 **2.0.3**（unversal macOS DMG）。

### 数据目录隔离（已完成并验证）
- DSH home 数据：VideoBuddy 解析到 `~/.videobuddy`（`main.ts:445` `resolveDshHome(join(homedir(), '.videobuddy'))`）；DSH Desktop 保持 `~/.dsh`。
- Electron `userData`：VideoBuddy 使用 `~/Library/Application Support/VideoBuddy`（通过 `PRODUCT_NAME` + `app.setName`）；DSH Desktop 使用 `.../DSH Desktop`。
- Windows `%APPDATA%\VideoBuddy` 与 Linux `~/.config/VideoBuddy`（`bin.ts:58` `defaultDesktopUserDataDirectory`）。
- 终端 shims 写入 `join(userData, 'runtime-commands')/bin`（VideoBuddy 专属）。

### 开箱即画布（已完成）
- `canvas-studio` 作为 `canvas-studio: workspace:*` 加入 `dsh-plugin-desktop/package.json`，从而被打入 asar / `lib/client.js`。
- `dsh-plugin-desktop/cordis.patch.yml` 注入 `canvas-studio` 行，并禁用上游 `ui-layout` 与 `ui-sidebar` 行。`ui-conversation` 保持启用，使聊天渲染在画布右侧。
- canvas `StudioFrame` 原生在右侧渲染 `conversation` 槽（`StudioFrame.tsx:898`），故"开箱即画布"= 画布 + 内置聊天。
- `StudioLayoutController implements ILayout`（openDetails/closeDetails/toggleSidebar 均为 no-op）通过 `ctx.reflect.provide('layout', ...)` 提供，在禁用了上游 `ui-layout` 后满足 conversation 行的 layout 依赖。
- `dsh-plugin-desktop/src/profile.ts:89` `DEFAULT_DESKTOP_SHELL_MODE = 'compatibility'`。

### `loader fibers failed` 根因（已完成）
启动时的 `loader fibers failed` 曾被误判为需要同时禁用 sidebar 与 conversation。验证后的真相：启用 `ui-conversation` **且**禁用 `ui-layout` 时客户端可干净启动，因为 canvas-studio 提供了 `ILayout`。因此最终配置只禁用 `ui-layout` 与 `ui-sidebar`，并重新启用 `ui-conversation`。

### 非数据品牌清理（已完成）
`dsh-plugin-desktop` 源码与原生 UI 中所有用户可见的 "DSH Desktop" 文案均改为 "VideoBuddy"：`setup-wizard-copy.ts`、`client/desktop-settings-locales.ts`（en+zh）、`notifications.ts`、`update-lifecycle.ts`、`workspace-admission.ts`、`client/workspace-folder-drop.ts`、`desktop-terminal.ts`、`index.ts`、`native-ui/{recovery,setup-wizard,desktop-dialog}.html`（`<title>`）以及 `build/assistedMessages.yml`。

## 未完成 / 暂缓

内部标识与功能性端点有意保留，不应当作品牌残留处理：
- `dsh` CLI 与 `dsh-desktop` 启动器名、终端功能名（"DSH 终端"/"Dual 终端"）。
- CSS 类名（`dshDesktop*`、`.dshNativeFrame`、`dshDesktopDialogDocument`）。
- `dsh-market` / `dsh-community-market` 插件市场名。
- 指向 `https://www.dshdesktop.cn/...` 的更新服务端点（`DESKTOP_VERSION_ENDPOINT`、`update-checker.ts`、`update-download.ts`）。
- `build/installer.nsh` 与 `build/entitlements` 的注释/逻辑仍引用旧产品名；属 Windows 安装器范畴，不在当前 macOS smoke 范围内。
- 打包 smoke `tests/package.spec.ts` 仍断言旧名，本地通过 `DSH_PACKAGE_CHECK_ALREADY_RAN=1` 跳过；尚未做全量品牌改造。

## 注意事项

### 构建与打包顺序
- 桌面 `dist` 脚本**不会**重 build `dsh-plugin-desktop`；必须先运行 `corepack yarn workspace dsh-plugin-desktop build`，否则 `lib/main.js`（内嵌 canvas-studio）会过期。
- 打包在中国网络下需 Electron/electron-builder 二进制镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。
- 门禁跳过：`DSH_PACKAGE_CHECK_ALREADY_RAN=1` 绕过 macOS 打包门禁，因为 `tests/package.spec.ts` 仍断言旧名 "DSH Desktop"。
- 最新的 DMG 为 `dsh-plugin-desktop/dist/mac-smoke/VideoBuddy-2.0.3-universal.dmg`。

### Shell 模式
- 对 VideoBuddy 而言只有 `compatibility` 模式生产安全。旧的桌面 `settings.yaml` 若残留 `mode: extended`，会由 `applyExtendedOwnedShell` 触发第二次 layout 注册，与 canvas-studio 的 layout 冲突。全新安装默认 `compatibility`（无冲突）。**不要**使用 `extended` 模式。

### 数据卫生
- 当前生效的干净数据目录为 `~/.videobuddy`；此前数据备份在 `~/.videobuddy.bak.1788495699`（未删除）。

### 待用户确认
- 本地已重新确认重新打包后的应用零新增 `error.log` 行、进程稳定。双击新 DMG 后画布右侧聊天面板是否出现的最终视觉确认仍未完成。

## 验证
- `corepack yarn workspace canvas-studio typecheck` 与 `build` 通过；`corepack yarn workspace dsh-plugin-desktop typecheck` 与 `build` 通过。
- 带镜像 env 的 `DSH_PACKAGE_CHECK_ALREADY_RAN=1` `dist:mac-smoke` 完成，DMG smoke 报告 "macOS DMG smoke verification passed"。
- 启动打包应用：进程存活，`error.log` 无变化。

## 备选方案

**同时禁用 conversation。** 那样完全避开 layout 冲突，但会移除 VideoBuddy 应在画布旁显示的聊天；否决，改为只禁用 `ui-layout` 与 `ui-sidebar`。
