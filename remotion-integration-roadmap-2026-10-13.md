# Remotion 集成路线图（针对 Canvas Studio 当前架构）

> ⚠️ **2026-10-14 口径声明**：本文件是早期路线图。**Manifest 契约与关键决策已由 `remotion-integration-devdoc-2026-10-14.md`（实现规格 v1）定稿**——本文 §2 阶段 1 的类型草稿、§3 决策点 2 的"先用 A"建议均已被取代（契约以 devdoc §4.2 为准；资产喂法已定方式 B）。阅读顺序建议：先读 devdoc，本文仅作背景与阶段脉络参考。
>
> 🚫 **2026-10-15 失效锚点勘误（重要）**：本文写于按 **Remotion v3 语义**理解 API 的阶段，下列写法**已证实不存在或已移除**，若被照抄会直接跑不起来。**以下述结论为准，勿再从本文复制代码/参数名**：
>
> | 本文的写法 | 实际（Remotion 4.x） |
> |---|---|
> | 阶段 0 装 `@remotion/core` | **无此官方包**（npm 上的 `1.0.0-y.46` 是第三方占位）。官方主包 = `remotion`；视频组件在 `@remotion/media` |
> | `renderMedia({ ffmpegExecutable: resolveFfmpegPath() })`、阶段 0 的"验证用随包 ffmpeg 出片" | **`ffmpegExecutable` / `ffprobeExecutable` 在 v4.0 已移除**。Remotion 自带 `ffmpeg`+`ffprobe`+`libav*`（`@remotion/compositor-<platform>`，≈17MB/平台），**不可逐调用替换** |
> | `renderMedia({ composition })` 传字符串 id | 传 **VideoConfig 对象**：先 `bundle()` → `selectComposition({serveUrl, id, inputProps})` → 再 `renderMedia`；且 **`codec` 必填** |
> | 浏览器路径选项 `chromiumPath` / `chromiumExecutable` | 真名 **`browserExecutable`**；默认浏览器是 **Chrome Headless Shell**（非完整 Chrome），带 `VERSION` 且版本不符会**自动删除重下** |
> | §3 决策点 1「建议 B：复用 Electron 打包的 Chromium（省 150MB）」 | **已排除**：Electron 属 Remotion 官方"未支持环境"（需 `binariesDirectory`），且 Electron 的 Chromium 不是独立 chrome 二进制。「+150MB」也是按完整 Chrome 估的虚高值 |
> | 阶段 3 用 `publicDir` 喂素材 + 阶段 6「预构建 bundle 进包」 | 二者**互斥**：`publicDir` 只在 `bundle()` 时生效（内容被复制进 bundle 目录）⇒ 统一为 devdoc §8.1 的 **`renderDir`** 模型 |
> | 阶段 2「组件单测」隐含的组件级断言方案 | 官方**无** `@remotion/test-renderer`；用纯函数抽离 + 现有 `node --test`，组件级断言走 `<Thumbnail>`+`renderToString`（可选） |
> | 阶段 3「两处文档登记」、阶段 4「按现有 23 个 skill 的约定补齐」 | **登记已是 6 处**（工具表 ×2 + 计数 24→25 + **`platform.yaml`** + **`BUNDLED_CATALOG` 快照** + **`skill-tool-refs` 工具名对账**）；`skills/` 现为 **21 个**，且 `SKILL.md` 入口 **≤12 KB**、**禁 skill 自设审批门**（CV-317~326） |
>
> 另：本文 §3 决策点 3「MVP 先做同步」、决策点 4「范围只做字幕卡/数据卡/转场」与 devdoc 一致，**仍然有效**。

> 前置结论：本项目为**两人公司 → Remotion Free License 覆盖，商业使用零费用**（Free 档门槛是"营利组织 ≤3 人"，见许可原文 Eligibility）。用 LLM 生成 Remotion 代码并**自行服务端渲染**被官方明确允许（`renderMedia()` 正属官方定义的 automation，Free 档同样可跑）。
> ⚠️ **2026-10-15 更正**：原文里写的"唯一禁区＝让用户上传自有 Remotion 代码到你的服务渲染"**在许可原文中找不到依据**。许可原文的 Disallowed 只有一条：**不得复制/修改 Remotion 代码以出售、出租、授权、再授权你自己的 Remotion 衍生品**；另：**Remotion 5.0 将改动许可条款**。原文存档见 `canvas-studio/docs/remotion-license-snapshot-2026-10-15.md`。
> 本报告只规划"官方 Remotion 路线"的落地，不讨论自研/Motion Canvas 备选（见 `openmontage-adoption-analysis-2026-10-13.md` §2 P0）。

---

## 0. 一句话集成画像

Remotion 不是要替换我们现有的"模型驱动生成 + ffmpeg 拼接"主干，而是**在 `compose_video` 旁边并联一个 `render_composition` 工具**：模型生成的 clip 当素材喂给 Remotion 的 `<Video>`，代码生成的卡片/字幕/转场当 React 组件，Remotion 用 Headless Chromium 逐帧渲染 + 复用我们已有的 ffmpeg 二进制编码成 MP4。两条路共用 `ComposeResult` 返回形状，客户端/agent 无感。

```
[Drama 模型生成 clip]  ─┐
                       ├─→  render_composition(Host 工具)  ─→  Remotion bundle + Chromium 逐帧
[代码生成的卡片/字幕/转场] ─┘                                     → 复用 resolveFfmpegPath() 编码
                                                                  → 返回 ComposeResult(url,duration,...)
```

---

## 1. 现有架构里 Remotion 会"插"在哪（已实地核过）

| 现有模块 | 文件 | Remotion 集成方式 |
|---|---|---|
| 工具注册 | `src/host-tools.ts` `createStudioTools()`（L1270，返回 `defineTool[]`） | 新增 `defineTool({ name:'render_composition', ... })` 加入返回数组，镜像 `compose_video` |
| 合成落盘/返回 | `src/compose.ts` `ComposeResult`（L63） | 新工具返回**同形状**对象，客户端零改动 |
| ffmpeg | `src/ffmpeg-run.ts` `resolveFfmpegPath()` | ⚠️ **已失效**：v4 无 `ffmpegExecutable`。本项目 ffmpeg **只用于混音与媒体探测**（`buildAmixArgs` / `probeMediaInfo`）；渲染编码由 Remotion 自带 `@remotion/compositor-<platform>` 负责。详见 devdoc §0 R1 |
| 资产 URL | `webServer` 路由 `/canvas-studio/assets/<projectId>/<file>` | ⚠️ **已改写**：不走直连 URL（跨源），也不走"每次渲染 `publicDir`"；统一为 devdoc §8.1 的 **`renderDir` + `cs-assets/` + `staticFile()`** |
| 质量门禁 | `src/quality-check.ts` `qc_shot` / `runShotQc` | 扩展校验 Remotion 产物（字幕存在性 + 帧采样），复用 `probeMediaInfo`；⚠️ `runShotQc` 面向镜头，对成片是否适配**需先取证**（devdoc §9.1） |
| 审批门 HITL | `assertApprovalAllowed`（host-tools.ts:718 定义，compose_video 调用点 L2303） | 复用：在"manifest 确认"这一 checkpoint 卡一下（注：`submit_storyboard_for_approval` 已随 REQ-022 下线，不再作为范例） |
| 测试纪律 | `tests/skill.test.mjs` 扫 `name:` 并要求 `toolchain.md` + `docs/canvas-studio-tools.md` 各一行登记 | 新工具必须补这两处文档登记（否则测试红） |
| 运行配置 | `StudioRuntimeConfig`（L1221） | 可加 `remotionBundlePath()` 两项（可选）；⚠️ 原写的「`chromiumPath()`」不存在（真名 `browserExecutable`，但本项目不覆盖浏览器路径） |

**关键约束（来自项目铁律）**：新模块作为**独立模块**接入，复用 `ffmpeg-run.ts`，**不动历史数据路径**（遵循"只修产生路径"）；测试归入 T3 分层（跨进程/守卫），渲染真实需要 Chromium → 真跑冒烟判耗时（<5ms 视为空绿，见日常记忆）。

---

## 2. 分阶段路线图

### 阶段 0 — 技术 Spike / 可行性验证（0.5~1 周，**必须先做**）
> ⚠️ **本节 checklist 已被 devdoc §13 阶段 0 取代**（下面的装包名、浏览器策略、ffmpeg 验证项均已失效）。以 devdoc 为准。
目标：确认在本机 Electron 环境下 Remotion 真能渲染，并选定语粒子策略（见 §3 决策点 1）。

- [ ] 在 `canvas-studio/` 下加 `remotion/` 子工程：`remotion.config.ts` + `src/index.ts`（注册一个最小 `<Composition id="studio-composition" ...>` + `calculateMetadata`）+ 一个 `SubtitleCard` 组件。
- [ ] ~~装 `@remotion/core` `@remotion/renderer` `@remotion/cli`（devDeps）~~ → **改为**：deps 装 `remotion` / `@remotion/renderer` / `@remotion/bundler` / `@remotion/media`，devDeps 装 `@remotion/cli`。
- [ ] 本地 `npx remotion render` / `npx remotion still` 跑通最小合成，记录：headless-shell 下载耗时与体积 / 单帧渲染耗时 / 产物 MP4 参数。
- [ ] ~~决策并验证 Chromium 来源：Remotion 自带（+~150MB）vs 复用 Electron 打包的 Chromium（`chromiumPath` 覆盖）~~ → **改为**：浏览器默认走 Remotion 自管的 **Chrome Headless Shell**（不传 `browserExecutable`）；只需实测 ① Electron 主进程里能否跑通（必要时显式 `binariesDirectory`）② headless-shell 真实体积 ③ 随包预置是否可行。「复用 Electron Chromium」**已排除**。
- [ ] ~~验证 `renderMedia({ ffmpegExecutable: ... })`~~ → **改为**：验证 `bundle()` → `selectComposition()` → `renderMedia({composition, codec:'h264'})` 三步链跑通，且 `calculateMetadata` 真的改写了成片时长；**不传** `ffmpegExecutable`（已移除）。
- [ ] 产出：`spike-report.md`（帧耗时基线 + 浏览器策略结论 + 打包体积增量）。

### 阶段 1 — 契约层：定义 `CompositionManifest`（1~2 天）
把"成片结构"显式化（对应旧报告 §2 P1），与现有 storyboard 契约对齐，不另起 YAML manifest。

- [ ] ~~新建 `src/contracts/composition.ts` + 类型草稿~~ **已定稿**：契约以 devdoc §4.2 为准，落地文件为 `src/remotion/manifest.ts`（扁平 `tracks` 联合类型数组，非本文早期的 `tracks.videoClips/cards` 分组式；Remotion 用**固定 composition id**，manifest 整体走 `inputProps`，不用 `compositionId` 字段）。
- [ ] 按 devdoc §4.3 落 `validateManifest` / `deriveAudioComposition` / `collectManifestSourceIds` 纯函数 + 单测。
- [ ] 该类型即 Remotion 的 `inputProps` 形状（零转换），skill/Agent 产出它，新工具消费它。

### 阶段 2 — Remotion 工程：最小组件库（3~5 天，REQ-034 刚需）
在 `remotion/src/compositions/` 实现参数化组件，全部用 `useCurrentFrame()` + `interpolate()` + `spring()`，消费 `CompositionManifest`：

- [ ] `SubtitleCard`（句级字幕；词级 TTS 同步列 P1 二期，见 devdoc §1.2 / §14）
- [ ] `DataCard` / `LowerThird`（数据卡 + 下三分之一条）
- [ ] `KenBurnsImage`（图片推镜，配合模型生成的静态图）
- [ ] `SlideTransition` / `FadeTransition`（精确帧级转场，替代 ffmpeg 的粗淡入淡出）
- [ ] `ProgressBar`（章节进度条）
- [ ] `index.ts` 用 `<Composition>` 注册这些为可渲染条目，`<Video src>` / `<Img src>` / `<Audio src>` 接 manifest 的 `src`（URL 或 `staticFile`）。
- [ ] **构建产物**：加 `scripts/build-remotion.mjs` 调 `@remotion/bundler` 的 `bundle()` 预构建 bundle，供 Host 工具直接 `renderMedia({ bundle })`（避免运行时再 bundle）。

### 阶段 3 — Host 工具 `render_composition`（2~3 天）
镜像 `compose_video` 的 `defineTool` 写法（host-tools.ts L1284 起），加入 `createStudioTools` 返回数组：

- [ ] `parameters`：`manifest`（CompositionManifest 的 JSON Schema）、`outputName?`、`nodeId?`（落画布节点）。
- [ ] `execute`：
  1. 解析 `manifest.tracks.videoClips[*].src` URL → `urlToAssetPath(assetsDir, src)`（复用 compose.ts L118 的现有反查）拿到本地路径；或保证 webServer 同源可直连。
  2. ~~`renderMedia({ bundle, composition: 'studio-composition', inputProps: manifest, ffmpegExecutable: resolveFfmpegPath(), chromiumPath: ... })`~~ → **已失效**，正确三步链见 devdoc §6.3：`serveUrl = renderDir` → `selectComposition({serveUrl, id:'studio-composition', inputProps:{manifest}})` → `renderMedia({ composition, serveUrl, codec:'h264', inputProps, outputLocation, concurrency:1, cancelSignal })`。注：**不传 `ffmpegExecutable` / `ffprobeExecutable`**（v4 已移除）；媒体真值探测复用 `probeMediaInfo`（ffmpeg-run.ts:278，走项目自己的 `ffmpeg -i`）。
  3. 产物落 `assetsDir/export-<uuid>.mp4`（与 compose.ts 同源路由）。
  4. `probeMediaInfo` 探真值 → 组装成 `ComposeResult` 返回（与 compose_video 同形状）。
- [ ] `output.render`：复用 `renderComposeResult`（host-tools.ts L250）或新增一个，保证 agent 看到的返回块一致。
- [ ] **文档登记**（必做，否则 `skill.test.mjs` 红）：在 `toolchain.md` 与 `docs/canvas-studio-tools.md` 各加一行 `render_composition` 登记。⚠️ **v1.2 追加**：新增 skill 侧另有两处（`platform.yaml` + `src/skill-catalog.ts` 的 `BUNDLED_CATALOG` 快照），细则见 devdoc §11 门禁 4/5。
- [ ] `StudioRuntimeConfig` 可选加 `remotionBundlePath()`（可选）；⚠️ 原写的 `chromiumPath()` **不存在**（浏览器路径选项真名 `browserExecutable`，本项目不覆盖它）。

### 阶段 4 — Skill 接入（Agent 面，2~3 天）
> ⚠️ **2026-10-15 追加勘误**：skill 体系在 CV-317~326 被重构，本节三处写法均已过时 —— ① `platform.yaml` **已是必需件**（9 必填字段，含 `role`/`slot`）；② 不能"复用审批门/自建 HITL 确认点"（`skill-progressive-disclosure` 会红）；③ 不是 23 个 skill 而是 **21 个**，且 `SKILL.md` 入口有 **12 KB 上限**。详见 devdoc §0 R8/R9 与 `canvas-studio/docs/skill-expansion-spec.md`。

- [ ] 新建 skill `code-driven-explainer`（或扩展 `paper-collage-explainer-generator` 等现有 explainer skill）：给定脚本，产出 `CompositionManifest` 并调用 `render_composition`。
- [ ] ~~在 manifest 生成后、渲染前插入 **stop-and-confirm checkpoint**（复用现有 `ask_user_choice` / 审批门），让用户确认卡片/字幕/时长编排~~ → **改为**：审批语义归 `canvas-studio-creation` 总纲；本路径放行由 `render_composition` 工具自身调 `assertApprovalAllowed`；skill 侧只用 `ask_user_choice` 做**澄清**（可借它展示轨道时序预览），**不得**写成"确认后才渲染"。
- [ ] ~~skill frontmatter（name/description/trigger-words/compatibility）按现有 23 个 skill 的约定补齐~~ → **改为**：按 `skill-expansion-spec.md` 新规补齐 —— `SKILL.md`（≤12 KB 入口）+ `platform.yaml`（9 必填）+ `references/` 细则下沉；`src/skill-catalog.ts` 的 `BUNDLED_CATALOG` 加快照；跑 `test:smoke` 过 skill 侧四道门禁。

### 阶段 5 — 质量门禁扩展（1~2 天）
- [ ] `quality-check.ts` / `qc_shot` 增加 Remotion 产物校验：① 声明的 `cards` 是否真出现在帧采样里（防"卡片没渲染"）；② 字幕存在性（帧 OCR 或像素检测，复用 `probeMediaInfo` 帧采样）；③ 时长漂移（manifest `durationInFrames/fps` vs 真值）。
- [ ] 复用 `DEFAULT_QC_BUDGET` 与现有 `runShotQc` 骨架，不另造。

### 阶段 6 — 打包与分发（风险最高，预留 1 周 + 用户终端配合）
- [ ] **浏览器进包**：把 Remotion 自管的 Chrome Headless Shell（`node_modules/.remotion/chrome-headless-shell/<platform>/`，**连 `VERSION` 一起**）收进 `extraResources`；**注意本机 env 已知坑**（agent shell 因 `com.apple.provenance` 无法搬运、universal 包须在用户自己终端跑、`ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR` 必须导出）。详见 devdoc §15.3。
- [ ] ~~**ffmpeg 单一来源**：确认 Remotion 用 `resolveFfmpegPath()` 而非自带，避免打两份 ffmpeg~~ → **改为**：确认 `**/@remotion/compositor-*` 走 `asarUnpack`（含动态库，无法从 asar 内加载），并接受它自带的 `ffmpeg`/`libav*`（≈17MB/平台）；**不要试图合并 ffmpeg**（v4 无逐调用替换入口）。详见 devdoc §0 R1 / §15.3。
- [ ] 在用户本机 Electron 实跑一次完整"模型 clip + Remotion 卡片 → 成片"端到端，确认 GUI/渲染层真起得来（agent shell 只够拿主进程日志）。

### 阶段 7 — 测试与纪律（贯穿，T3）
- [ ] **纯函数单测（无 Chromium）**：`CompositionManifest → Remotion inputProps` 映射、组件 props 计算（`interpolate` 边界），直接断言。
- [ ] **集成冒烟（需 Chromium）**：`renderMedia` 渲染一个 1 秒最小合成，断言产物 MP4 存在 + 时长 ≈ 真值。**gate 在"浏览器可用"**，CI/agent shell 无 Chromium 时跳过（仿 ffmpeg 真跑冒烟的"<5ms 空绿"判定）。
- [ ] 反向变异：真改坏一个组件 → 断言产物校验变红 → 还原（遵循 T3 反向变异纪律）。
- [ ] `skill.test.mjs` 扫描通过（新工具已登记）。

---

## 3. 需要你拍板的决策点（建议在阶段 0 前定）

**决策点 1 — 浏览器来源（决定打包复杂度，最关键）**
> ⚠️ **本决策点已被 devdoc §7.5 / §15.1 决策 1 取代**：A 为 MVP 路径，**B 已排除**。以下保留原文仅作脉络记录。

- ~~A. Remotion 自带 Chromium（`ensureBrowser` 下载）~~ → **实际是自管 Chrome Headless Shell**，非完整 Chromium；代价不是"+150MB"（确切值待实测），打包期需联网下载（走镜像，且 agent shell 搬运受限 → 须在用户终端跑打包）。
- ~~B. 复用 Electron 打包的 Chromium（`renderMedia({ chromiumPath })`）~~ → **不可行**：Remotion 对浏览器版本有 pin（带 `VERSION`，版本不符自动删除重下），官方警告勿用 `browserExecutable` 指向不兼容 Chrome；Electron 的 Chromium 也不是独立 chrome 二进制。真正的替身路径是 `binariesDirectory`（官方点名 Electron 属"未支持环境"）。
- **结论**：走 Remotion 自管 headless-shell；可选"随包预置"作为离线确定性方案。

**决策点 2 — 资产喂给 Remotion 的方式（已定：B，v1.1 修订落点）**
- A. 直连 webServer 同源 URL（`/canvas-studio/assets/...`）：Remotion `<Video src="http://localhost:<port>/...">`。~~同进程通常 OK~~ → 实际是**跨源**（Remotion 用自己的 server 提供 bundle），需 `disableWebSecurity` 或 CORS，安全面变大 → **不采用**。
- B. 落地静态目录 + `staticFile()`：更隔离、利于离线。**已定**（devdoc §8 定稿，含 src 重写与 basename 冲突防御）。⚠️ 落点由"每次渲染 `publicDir`"改为 **devdoc §8.1 的 `renderDir` 模型**（`publicDir` 只在 `bundle()` 时生效，与"预构建 bundle"互斥）。

**决策点 3 — 渲染时机：同步工具 vs 异步队列**
- 现有 `compose_video` 是同步工具（Host 内跑 ffmpeg，几十秒）。Remotion 渲染同样几十秒~分钟级，且吃 Chromium。是否接入现有 Drama 任务恢复轮询（`startDramaJobResumeWatcher`，host-tools.ts L1278）做异步 + 断点，还是先做成同步工具（简单，但长片会阻塞 agent 回合）？
- **建议**：MVP 先做同步（镜像 compose_video），长片/批量再接异步队列。

**决策点 4 — 范围**
- MVP（阶段 0~5）：只做"字幕卡/数据卡/转场 + 模型 clip 合成"，达标 REQ-034「低成本科普教育视频」。
- 还是顺带做"LLM 动态生成 Remotion 组件代码"（agentic 角度，但要在 Host 侧沙箱化 eval 生成的 JSX，风险高，建议二期）。

---

## 4. 风险与对策（Remotion 官方路线特有）

| 风险 | 说明 | 对策 |
|---|---|---|
| **Chromium 打包/搬运** | 本机 agent shell 受 `com.apple.provenance` + 沙箱限制，无法搬运带属性的 Chromium；universal 包须用户终端跑 | 阶段 0/6 预留用户终端配合；走 `npmmirror` 镜像；若选 B 复用 Electron Chromium 可规避 |
| **Electron GUI 起不来** | agent shell 带 `ELECTRON_RUN_AS_NODE`、Chromium sandbox 初始化失败 | 渲染验证放用户本机 Electron；agent shell 只拿主进程日志（已有先例） |
| **License** | 两人公司已 Free 覆盖；禁"用户上传自有 Remotion 代码渲染" | 只用 `renderMedia` 服务端渲染 + LLM 生成代码，不开放用户代码上传 |
| **长片阻塞 agent 回合** | Remotion 渲染分钟级，同步工具会卡回合 | 决策点 3：MVP 同步，长片接异步队列 |
| ~~**双 ffmpeg**~~ | **风险已消除（定义变了）**：v4 无 `ffmpegExecutable`，渲染编码由 Remotion 自带 `@remotion/compositor-<platform>`（含 `ffmpeg`+`libav*`≈17MB/平台）负责，项目 ffmpeg 只管混音与探测 —— **两条独立链，不会冲突** | 接受体积（≈17MB/平台，`asarUnpack`）；**不要试图合并** |
| **测试无 Chromium** | CI/agent shell 通常无可用 Chromium | 集成冒烟 gate 在浏览器可用；纯函数单测不依赖浏览器 |

---

## 5. 工作量粗估

| 阶段 | 估值 | 依赖 |
|---|---|---|
| 0 Spike | 0.5~1 周 | — |
| 1 契约 | 1~2 天 | 0 |
| 2 组件库 | 3~5 天 | 0,1 |
| 3 Host 工具 | 2~3 天 | 1,2 |
| 4 Skill | 2~3 天 | 3 |
| 5 质量门禁 | 1~2 天 | 3 |
| 6 打包 | 1 周 + 用户配合 | 0(决策) |
| 7 测试 | 贯穿 | 全部 |

**MVP（阶段 0~5，不含打包联调）≈ 3~4 周** 单人投入，达成"模型 clip + 代码卡片/字幕/转场 → 成片"的 REQ-034 最小闭环。
