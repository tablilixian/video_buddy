# 交接文档：0.2.1 桌面启动链修复完成 → canvas-studio 客户端接管待办

日期：2026-10-21　分支：`upgrade/dsh-0.2.1-rc.2`　状态：**启动链已通，等待客户端 UI 接管**

## 一、当前状态（15:15 实测）

✅ 已修好（用户终端实测不再报错）：
- 桌面窗口正常打开，页面加载成功，renderer boot health 正常上报（不再 30s 超时进恢复模式）。
- host 侧日志干净：无 import 失败、无 401/403、无 renderer timeout。

❌ 待解决（本次交接的核心）：
- 页面是**空壳**：只渲染了 desktop framed shell 的底座 + 「打开恢复模式 / Open Recovery Mode」按钮，**canvas-studio 的 StudioFrame 没有接管页面**。
- 用户点「打开恢复模式」进的是手动恢复入口（重启菜单主动进入，非故障）。

## 二、今天已完成的修复（commit）

### `1965087bf0` feat(desktop): adapt profile composition and web seam packages to 0.2.1 seams
之前会话遗留的未提交改动：profileContext 提供（0.2.1 行级 `!!js` 门依赖它）、bundle patch 列表归一化（dsh-web-app 五层 patch）、webRuntime 服务移除后 LAN 地址本地枚举、tinyfish volatile 配置。

### `48321805df` fix(desktop): restore shell boot through the 0.2.1 connection launch token
今天排查出的三个连环根因与修复：

| 根因 | 机制 | 修复 |
|---|---|---|
| 渲染进程无人上报 boot health | 0.2.1 web 首屏要求 `?token=<connection launchToken>` 否则 401 fallback；但 token 兑换后 **303 重定向到干净的 `./`，丢弃全部 query 参数**（含 `dsh-desktop-*` 客户端环境标记）⇒ `parseDesktopClientEnvironment` 失败 ⇒ client apply 早退 ⇒ 上报器没装 | spec 拆 `url`（干净带参）+ `authenticationUrl`（origin+token）；窗口加载前者 |
| 预取请求 403 | `installRendererAccessHeader` 的 webRequest 过滤器**先剥后按条件重加**能力头，条件含 `details.webContentsId === window.webContents.id`（electron-shell-generation.ts:64）；主进程 `session.fetch` 无 webContentsId ⇒ 显式头被剥 ⇒ DesktopWebServer 准入闸 denied | 预取 fetch 挪到过滤器安装**之前**（无过滤器时显式头直达） |
| host 插件 import 失败 | `dsh-tools@0.2.1-rc.2` 新增 peerDep `dsh-sandbox`；`dsh-free-search@0.4.28` 仍 import 已删除的 0.1.x `SettingsProvider` | hybrid 补声明依赖；**web-search-hybrid 行 disabled: true**（用户指令：先跑起来），`web` row 回退 base 默认 provider |

其他：canvas-studio 补 `react-dom@18.3.1`（render-host 外部依赖）；`inject` 声明 `'connection'`（上游 dsh-desktop 仓库同款，参考仓库在 `~/Desktop/job/learn/dsh-desktop`）。

验证基线：typecheck ✅ / verify:loader ✅ / 5 个 spec 文件 108/109（唯一红 = `defaults to compatibility mode and validates both schemas`，0.2.1 Config 改 volatile 的**遗留债**，与本链路无关，建议另立工单）。

## 三、下一步排查（新会话从这里开始）

**问题**：canvas-studio client plugin 未激活/未渲染。blank 页只有 framed shell 底座。

**头号嫌疑**：`canvas-studio/src/client/index.ts:92` 的
`export const inject = ['slots', 'workspaces', 'uiWorkspace', 'uiConversation', 'sessions', 'connection', 'configForms', 'theme']`
——0.2.1 client seams 里任何一个服务缺位/改名（尤其 `uiConversation`、`configForms`、`workspaces` vs `uiWorkspace`），整个 client plugin fiber 永远不进 ACTIVE(2)，StudioFrame 不挂载。参考：desktop client（dsh-plugin-desktop/src/client/index.ts:74）的 inject 已在 commit `086b57f0e4` 迁移到 0.2.1，但 **canvas-studio client 未做同样的迁移审计**。

**诊断方法（已验证可行）**：
```bash
# 用户终端，在 dsh-plugin-desktop 目录：
env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
  ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  --remote-debugging-port=9222 lib/main.js
# 另开终端：探针脚本（列 targets → attach 主窗口 → reload 抓 console → 读 window.__DSH_BOOT__）
node /tmp/cdp-probe.mjs   # 存在于 /tmp，若丢失可按今日日志重写（websocket 连 CDP，Runtime+Log+Page 域）
```
关键观察点：`window.__DSH_BOOT__` 里 canvas-studio client entry 的 fiber state（2=ACTIVE）；console 里 cordis "service not found" / inject 等待信息。

**注意**：agent 受管 shell 里启动 Electron 会卡死在 runtime-bootstrap（沙箱拦 Singleton 文件 unlink + pnpm rename）——**CDP 实测必须在用户终端跑**，agent 侧只能静态分析。

## 四、环境红线（每次开工必读）

- 开发 checkout = `~/Desktop/job/learn/video_buddy`；运行时 profile = `~/.videobuddy/profiles/desktop`（bundles: dsh-base + dsh-web-app；cordis.patch.yml 由 `dsh-plugin-desktop/cordis.patch.yml` 提供 rows）。
- `dsh-plugin-desktop/cordis.patch.yml` 是桌面插件 roster：canvas-studio / web-search-tinyfish / web-search-hybrid（已 disabled）/ ui-layout+ui-sidebar（disabled，StudioFrame 接管）/ web-runtime+web 覆盖。
- git：助手 commit、push 用户手动。跳过工作区垃圾文件：`canvas-studio/mutate-o06.mjs`、`restore-o06.mjs`、`不要提交这个文件.md`。
- 跑 `yarn install` 需 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000`。
- 测试入口 `corepack yarn vitest run`（dsh-plugin-desktop 内）；全量门 `corepack yarn check`（含 canvas-studio gate）。
- 参考仓库（上游已解决同类问题）：`~/Desktop/job/learn/dsh-desktop`（对应 `dsh-plugin-desktop/src/index.ts:84` inject、`electron-shell-generation.ts:81` 预取）。

## 五、后续工作清单（按优先级）

1. **canvas-studio client 迁移审计**：对照 0.2.1 client roster 核对 inject 清单 → StudioFrame 接管页面（对应「编号/文档」铁律：先诊断再改）。
2. web-search-hybrid 恢复：等 dsh-free-search 出 0.2.x 兼容版（当前 0.9.11 peer 声明兼容 `dsh-settings ^0.2.0-rc.1`，但 API 差异需验证）后升级并移除 disabled。
3. schema 遗留债：`defaults to compatibility mode and validates both schemas` 测试红（0.2.1 Config volatile 对齐）。
4. `host-resolved-root-include` 若再现：dsh-base sandbox 行的 peer 解析已随依赖声明修复，观察即可。
