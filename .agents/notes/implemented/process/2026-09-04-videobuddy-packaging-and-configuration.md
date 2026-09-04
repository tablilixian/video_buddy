# Agent Note: VideoBuddy packaging and configuration

Status: implemented (partial)

English | [中文](2026-09-04-videobuddy-packaging-and-configuration.zh.md)

## Problem

The DSH Desktop branch is being reshaped into a standalone canvas product named **VideoBuddy**. New users must open the installed DMG directly into the canvas studio interface, and VideoBuddy must coexist on one machine with an already-installed DSH Desktop without touching its data, identity, or app state. This note records the packaging and configuration decisions, what is done, what remains, and the caveats that keep the two products apart.

## Decision

The desktop product owns the entire runtime under the VideoBuddy identity while the pinned upstream `deepseek-harness/` submodule stays read-only. Separation falls into two layers: **data directories** (fully isolated and verified) and **non-data identity/branding** (partially cleaned).

### Product identity
- `dsh-plugin-desktop/package.json`: `build.appId = com.videobuddy.desktop`, `build.productName = VideoBuddy`.
- `dsh-plugin-desktop/src/main.ts:141` `PRODUCT_NAME = 'VideoBuddy'`; `main.ts:1019` `app.setName(PRODUCT_NAME)`; `main.ts:435` Windows `app.setAppUserModelId('com.videobuddy.desktop')`.
- Product version is **2.0.3** (universal macOS DMG).

### Data directory isolation (completed and verified)
- DSH home data: VideoBuddy resolves `~/.videobuddy` (`main.ts:445` `resolveDshHome(join(homedir(), '.videobuddy'))`); DSH Desktop keeps `~/.dsh`.
- Electron `userData`: VideoBuddy uses `~/Library/Application Support/VideoBuddy` (via `PRODUCT_NAME` + `app.setName`); DSH Desktop uses `.../DSH Desktop`.
- Windows `%APPDATA%\VideoBuddy` and Linux `~/.config/VideoBuddy` (`bin.ts:58` `defaultDesktopUserDataDirectory`).
- Terminal shims write to `join(userData, 'runtime-commands')/bin` (VideoBuddy-specific).

### Canvas-first shell (completed)
- `canvas-studio` is added as `canvas-studio: workspace:*` inside `dsh-plugin-desktop/package.json` so it is bundled into the asar / `lib/client.js`.
- `dsh-plugin-desktop/cordis.patch.yml` injects the `canvas-studio` row and disables the upstream `ui-layout` and `ui-sidebar` rows. The `ui-conversation` row stays enabled so the chat renders on the right side of the canvas.
- The canvas `StudioFrame` renders the `conversation` slot natively on the right (`StudioFrame.tsx:898`), so "canvas out of the box" = canvas + built-in chat.
- `StudioLayoutController implements ILayout` (openDetails/closeDetails/toggleSidebar are no-ops) and is provided via `ctx.reflect.provide('layout', ...)`, satisfying the conversation row's layout dependency once the upstream `ui-layout` is disabled.
- `dsh-plugin-desktop/src/profile.ts:89` `DEFAULT_DESKTOP_SHELL_MODE = 'compatibility'`.

### `loader fibers failed` root cause (completed)
The startup `loader fibers failed` was originally misdiagnosed as needing to disable sidebar and conversation together. The verified truth: with `ui-conversation` enabled **and** `ui-layout` disabled, the client boots cleanly because canvas-studio provides `ILayout`. The final config therefore disables only `ui-layout` and `ui-sidebar`, and re-enables `ui-conversation`.

### Non-data branding cleanup (completed)
All user-visible "DSH Desktop" copy changed to "VideoBuddy" across `dsh-plugin-desktop` source and native UI: `setup-wizard-copy.ts`, `client/desktop-settings-locales.ts` (en+zh), `notifications.ts`, `update-lifecycle.ts`, `workspace-admission.ts`, `client/workspace-folder-drop.ts`, `desktop-terminal.ts`, `index.ts`, `native-ui/{recovery,setup-wizard,desktop-dialog}.html` (`<title>`), and `build/assistedMessages.yml`.

## Not completed / deferred

Internal identifiers and functional endpoints are intentionally retained and should NOT be treated as branding leftovers:
- `dsh` CLI and `dsh-desktop` launcher names, terminal feature names ("DSH 终端"/"Dual 终端").
- CSS class names (`dshDesktop*`, `.dshNativeFrame`, `dshDesktopDialogDocument`).
- `dsh-market` / `dsh-community-market` plugin-market names.
- Update-service endpoints pointing at `https://www.dshdesktop.cn/...` (`DESKTOP_VERSION_ENDPOINT`, `update-checker.ts`, `update-download.ts`).
- `build/installer.nsh` and `build/entitlements` still reference the old product name in comments/logic; these are Windows-installer territory outside the current macOS smoke scope.
- Packaging smoke `tests/package.spec.ts` still asserts the old name and is skipped locally via `DSH_PACKAGE_CHECK_ALREADY_RAN=1`; it has not been given a full brand pass.

## Caveats / notes

### Build and package order
- The desktop `dist` script does **not** rebuild `dsh-plugin-desktop`; you must run `corepack yarn workspace dsh-plugin-desktop build` first, or `lib/main.js` (embedded canvas-studio) goes stale.
- Packaging requires the electron/electron-builder binary mirrors on the China network: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` and `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`.
- Gate skip: `DSH_PACKAGE_CHECK_ALREADY_RAN=1` bypasses the macOS packaging gate because `tests/package.spec.ts` still asserts the old "DSH Desktop" name.
- The updated DMG is `dsh-plugin-desktop/dist/mac-smoke/VideoBuddy-2.0.3-universal.dmg`.

### Shell mode
- Only `compatibility` mode is production-safe for VideoBuddy. A stale desktop `settings.yaml` carrying `mode: extended` triggers a second layout registration from `applyExtendedOwnedShell`, colliding with canvas-studio's layout. Fresh installs default to `compatibility` (no clash). Do **not** use `extended` mode.

### Data hygiene
- The clean current data home is `~/.videobuddy`; the previously existing data is backed up at `~/.videobuddy.bak.1788495699` (not deleted).

### Remaining user verification
- Reconfirmed locally that the repackaged app boots with zero new `error.log` lines and a stable process. The end-user visual check of the chat panel appearing on the right side of the canvas after double-clicking the new DMG is still pending.

## Verification
- `corepack yarn workspace canvas-studio typecheck` and `build` pass; `corepack yarn workspace dsh-plugin-desktop typecheck` and `build` pass.
- `DSH_PACKAGE_CHECK_ALREADY_RAN=1` `dist:mac-smoke` with the mirror env completes and the DMG smoke check reports "macOS DMG smoke verification passed".
- Launched the packaged app: process stays alive, `error.log` unchanged.

## Alternatives considered

**Disable conversation too.** That fully sidesteps the layout conflict but removes the chat that VideoBuddy is meant to show beside the canvas; rejected in favor of disabling only `ui-layout` and `ui-sidebar`.
