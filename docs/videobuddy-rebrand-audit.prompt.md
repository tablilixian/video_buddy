# VideoBuddy 品牌/配置残留审计 —— 并行对话提示词

> 用途：DSH Desktop 分支正被改造为独立产品 **VideoBuddy**。此文件把"全仓库还有哪些 DSH Desktop 历史配置/品牌痕迹"检查结果 + 分发给并行对话的提示词统一收在一处。**每个区域开一个新对话，复制对应区块的提示词给它即可。所有检查都只读，不修改。**
>
> 范围基线：工作区根 `/Users/wl/Desktop/job/learn/video_buddy`（git `dev` 分支）。

---

## 0. 重要认知（先读，避免误伤）

搜到的很多 `DSH_HOME` / `dsh-desktop` 引用**不是残留、属于合法内部机制，不要当噪音清理**：

- **`DSH_HOME` 环境变量**、`@deepseek-ai/dsh-home-paths`、`$DSH_HOME/profiles|sessions|storages` 等路径 —— 这是**进程内 harness 机制**，VideoBuddy 的 `~/.videobuddy` 隔离逻辑恰好建立在它之上（`src/main.ts` 强制 `process.env[DSH_HOME_ENV] = ~/.videobuddy`）。**必须保留。**
- **`dsh-desktop` settings namespace、URL query param `dsh-desktop-*`、DOM `data-dsh-desktop-*`、CSS 类 `.dshDesktop*`** —— 插件/渲染内部标识，与用户可见品牌无关。
- **`deepseek-harness/**` 内的全部 `DSH_HOME` 与文档** —— 固定上游子模块，**禁止改动任何内部文件**。
- **`.agents/notes/implemented/` 下 2026-08-15 等历史架构/流程笔记**里的大量 "DSH Desktop" 措辞 —— 历史决策存档，默认不改（除非明确要补一条中文对照）。

真正需要关注的是下面 A–D 四类"用户可见或运行行为"的残留。请按分配给你的区域，用 Grep/Glob/Read 精确核对，**只报告 + 说明改动风险，不要动手改**。

---

## 1. 公共搜索线索（每个对话都可用）

仓库根 `/Users/wl/Desktop/job/learn/video_buddy`。建议用内置 Grep 工具搜索（命令行 `rg` 在本环境不可用）。关键词：

- `DSH Desktop`（区分大小写；大小写变体 `DSH-Desktop`、`DSH_Desktop`、`dsh-desktop`、`dsh desktop`）
- `DSH Desktop.exe`、`DSH-Desktop-`（版本前缀）
- `DSH_HOME`、`~/.dsh`、`\.dsh`
- `userData`、`Application Support/DSH`、`LOCALAPPDATA\Programs\DSH`
- `dshdesktop.cn`（旧更新/下载域名）
- `productName`、`AppUserModelId`、`shortcutName`、`artifactName`

排除目录：`node_modules`、`deepseek-harness/**`、`*.map`、`dist/**`（可参照已验证的 Git 忽略项）。

---

## 2. 各区域 + 提示词

### 区域 A —— 仓库根用户可见品牌文案（落地页/文档）

**提示词（复制给对话 A）：**

> 在 `/Users/wl/Desktop/job/learn/video_buddy` 只读检查以下文件里所有把产品叫成 "DSH Desktop"、且是**面向用户而非内部标识**的品牌残留，逐条列出"文件:行号 | 原文 | 属不属于残留/风险"。只报告，不要修改。
>
> 覆盖文件：仓库根 `README.md`、`README.en.md`、`README.zh.md`、`CONTRIBUTING.md`、`CONTRIBUTING.en.md`、`PRIVACY.md`、`PRIVACY.zh.md`、`CODE_OF_CONDUCT.md`、`CODE_OF_CONDUCT.en.md`，以及 `docs/` 下的 `README.en.md`、`FAQ/faq.en.md`、`why-desktop.en.md`、`user-guide.md/.en.md`、`plugin-ecosystem[.en].md`、`plugin-development[.en].md`、`architecture[.en].md`。
>
> 重点核对项（已知线索）：
> - 根 `README.md` 整页标题仍是 `<h1>DSH Desktop</h1>`，且含旧下载链接 `https://www.dshdesktop.cn/api/downloads/mac`、旧仓库 `https://github.com/anywhere-labs/dsh-desktop`、旧的 why/ecosystem 文档链接。
> - `PRIVACY.md/.zh.md` macOS `~/Library/Application Support/DSH Desktop/identity/installation-id`、Windows `%APPDATA%\DSH Desktop\identity`、以及 `$DSH_HOME/...` 数据路径描述。
> - `docs/user-guide.md/.en.md` 第 80 行 `$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe --export-diagnostics`。
> - 所有 `dshdesktop.cn` 链接/域名。
>
> 特别注意：只标记**用户可见文案/链接/路径**；`DSH_HOME`、`$DSH_HOME/...` 这类进程内机制属于合法保留，不要列入残留。对每条给一句话改动提示（改成 VideoBuddy / 新的安装路径或域名，若产品方尚未定新域名则注明"待产品确认"）。

---

### 区域 B —— userData / 数据目录 / 安装目录路径

**提示词（复制给对话 B）：**

> 在 `/Users/wl/Desktop/job/learn/video_buddy` 只读排查所有与**数据目录 / 用户数据目录 / 安装目录**相关的 DSH Desktop 历史路径残留。逐条列出"文件:行号 | 路径/代码 | 是否残留 | 风险"。只报告，不要修改。
>
> 关注的路径形态：
> - `app.getPath('userData')` 的推导（当前由 `main.ts` 的 `PRODUCT_NAME` + `app.setName` 决定为 VideoBuddy；确认没有任何其它地方写死 `'DSH Desktop'` 作为 userData 目录名，例如 crash-evidence、installation-id、logs、profile-selection、runtime-commands 等拼接）。
> - Windows `%APPDATA%\DSH Desktop` / `LOCALAPPDATA\Programs\DSH Desktop`、macOS `Application Support/DSH Desktop`。
> - DSH home：`~/.dsh` vs `~/.videobuddy`（`src/main.ts` 已隔离到 `~/.videobuddy`，确认 `VIDEOBUDDY_HOME` 覆写逻辑与文档一致）。
> - 报告在 `dsh-plugin-desktop/src/**`、`dsh-plugin-desktop/scripts/**`、`dsh-plugin-desktop/tests/**`、`scripts/**`、`canvas-studio/**`、以及根/`docs/**` markdown 里，是否还有把数据 home 显示成 `$DSH_HOME`（而非 `~/.videobuddy`）的地方 —— 注意区分"进程内库内部使用（合法）"与"用户可见描述（若体现 `~/.dsh` 需改）"。
> - 已知线索：`canvas-studio/src/client/SettingsModal.tsx` 与 `host-config.ts`、`canvas-studio/README.md`/`plan.md` 多处显示 `$DSH_HOME/canvas-studio`；`canvas-studio/scripts/dev-install.mjs` 读 `process.env.DSH_HOME`。判断这些是"合法沿用 DSH_HOME env"还是"应改为 VideoBuddy home"。
>
> 对每条说明：是否会导致数据写到错误目录 / 与其它 dsh 客户端共享 / 用户文案误导。

---

### 区域 C —— 产物文件名、可执行名、更新服务端点、打包断言

**提示词（复制给对话 C）：**

> 在 `/Users/wl/Desktop/job/learn/video_buddy` 只读排查会**影响运行/打包行为**的 DSH Desktop 历史残留。逐条列出"文件:行号 | 代码/字符串 | 残留类型 | 改的风险"。只报告，不要修改。
>
> 关注点：
> - **下载/更新文件名**：`src/update-download.ts` 第 164 行 `updateDownloadName` 返回 `DSH-Desktop-${version}-${platformName}.${extension}` → 下载保存文件名仍是旧名。
> - **更新/下载服务域名**：`src/update-checker.ts` 第 10 行 `https://www.dshdesktop.cn/api/desktop/version`、`src/update-download.ts` 第 14-15 行 `dshdesktop.cn/api/downloads/{mac,windows}`。若 VideoBuddy 无自有域名，注明"待产品确认"。
> - **安装脚本/安装器内可执行名**：`build/installer.nsh`（第 31 行附近）、`scripts/reproduce-windows-installer-running-check.ps1`、`scripts/smoke-windows-installer-upgrade.ps1`、`src/desktop-installer-quit.ts` 及其 `tests/desktop-installer-quit.spec.ts` —— 这些匹配 `DSH Desktop.exe` / `DSH-Desktop-*.exe`，与 Windows 安装升级身份耦合，改动需评估兼容性。
> - **打包元数据断言**：`tests/package.spec.ts` 第 756 行 `expect(manifest.build?.productName).toBe('DSH Desktop')`（已知是 mac 打包门禁被 `DSH_PACKAGE_CHECK_ALREADY_RAN=1` 跳过的根因）、第 792/803/805 行已是 `VideoBuddy-*`；`tests/electron-runtime.spec.ts`、`tests/update-download.spec.ts`、`tests/window-options.spec.ts`、`tests/plugin.spec.ts`、`tests/verify-mac-smoke.spec.ts` 等 fixture 里大量 `productName: 'DSH Desktop'`、`DSH-Desktop-<版本>*.dmg/.exe`。
> - **AppUserModelId / productName 现状核对**：`src/main.ts` 已 `app.setAppUserModelId('com.videobuddy.desktop')`、`package.json` `build.productName=VideoBuddy` —— 确认没有其它文件仍写旧 appId/productName。
>
> 对每条给出建议：这些属于"测试夹具（可改可不改）"、"打包门禁硬断言（建议改为 VideoBuddy）"、还是"运行行为（需产品/兼容决策）"。

---

### 区域 D —— 测试与脚本里的 DSH Desktop 夹具（数量盘点 + 分类）

**提示词（复制给对话 D）：**

> 在 `/Users/wl/Desktop/job/learn/video_buddy` 只读盘点 `dsh-plugin-desktop/tests/**`、`dsh-plugin-desktop/scripts/**`、`scripts/**` 下的 .spec.ts / .mjs / .ps1 / .ts 里所有 "DSH Desktop"/"DSH-Desktop-"/"DSH Desktop.exe" 出现点。目标是给一个**分类清单**（不需要逐行，但要精确）。只报告，不要修改。
>
> 分类维度（每处标明属于哪一类）：
> 1. **纯测试夹具/模拟路径**（如 `execPath: 'C:\Program Files\DSH Desktop\DSH Desktop.exe'` 或 `productName:'DSH Desktop'`）—— 只是构造假数据。
> 2. **真实断言 / 行为校验**（如 `package.spec.ts:756` 断言 productName、`desktop-installer-quit.spec.ts`、`update-download.spec.ts` 断言下载文件名）—— 改会改变测试含义，需与产品解耦。
> 3. **运行脚本/安装器耦合**（`reproduce-*.ps1`、`smoke-*.ps1`、`installer.nsh`）—— 与真实 PE 文件名绑定。
>
> 汇总：总计多少处/每个文件多少个；给出"哪些建议一起改为 VideoBuddy"、"哪些属于兼容旧安装需单独决策"。特别标注 `tests/package.spec.ts`、`tests/electron-runtime.spec.ts`、`tests/update-download.spec.ts`、`tests/desktop-installer-quit.spec.ts`、`tests/verify-mac-smoke.spec.ts` 这几个关键文件的条目。

---

### 区域 E —— "勿动清单"复核 + 是否还有遗漏

**提示词（复制给对话 E）：**

> 在 `/Users/wl/Desktop/job/learn/video_buddy` 做一次交叉复核，只报告、不要修改：
> 1. 复核下面这些**应保留、不属于残留**的类别是否全都在预期位置、没有混入真正的用户可见残留：`DSH_HOME`/`$DSH_HOME` 机制、`@deepseek-ai/dsh-home-paths`、`dsh-desktop` settings namespace / URL param / DOM attr / CSS 类、`deepseek-harness/**` 上游文档、`.agents/notes/` 历史笔记。
> 2. 在区域 A–D 之外的**其它目录**（例如 `dsh-community-*`、根 `scripts/**`、`canvas-studio` 其它文件、`docs/evidence/**`）里，确认是否还有遗漏的 DSH Desktop 品牌/配置残留。注意 `docs/evidence/**` 是历史证据存档，通常不改。
> 3. 给出最终结论：**修改前建议先跑 `corepack yarn typecheck + build + vitest run tests/package.spec.ts` 的基线**，提醒哪些改动会先破坏哪些 gate，避免并行对话改出冲突。

---

## 3. 修改前的统一注意事项（各对话都要遵守）

- 本阶段**只检查，不修改**。逐条列出"文件:行号 | 原文 | 类型 | 一句改动建议/风险"即可。
- 不要用命令行 `rg`（本环境不可用），用内置 Grep 工具。
- 必须排除：`node_modules`、`deepseek-harness/**`（上游子模块，**禁止改**）、`*.map`、`dist/**`。
- `docs/evidence/**`、`.agents/notes/**` 里的历史存档措辞默认不改，除非明确要求。
- 遇到"是否改"歧义（如测试夹具、`dshdesktop.cn` 域名），标注"待产品确认"，不要自行决定。
- 最后把清单整理成 markdown 表格，别把合法内部标识列进去。

---

## 4. 交付

请把这份文件对应区域交给各并行对话用。各对话产出清单后，再由一个主对话汇总决定：哪些直接改、哪些需要产品确认、哪些保留。