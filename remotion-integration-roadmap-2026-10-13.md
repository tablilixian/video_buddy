# Remotion 集成路线图（针对 Canvas Studio 当前架构）

> ⚠️ **2026-10-14 口径声明**：本文件是早期路线图。**Manifest 契约与关键决策已由 `remotion-integration-devdoc-2026-10-14.md`（实现规格 v1）定稿**——本文 §2 阶段 1 的类型草稿、§3 决策点 2 的"先用 A"建议均已被取代（契约以 devdoc §4.2 为准；资产喂法已定方式 B）。阅读顺序建议：先读 devdoc，本文仅作背景与阶段脉络参考。

> 前置结论：本项目为**两人公司 → Remotion Free License 覆盖，商业使用零费用**（Remotion 仅对 4 人及以上公司收费）。用 LLM 生成 Remotion 代码并**自行服务端渲染**被官方明确允许；唯一禁区是"让用户上传自有 Remotion 代码到你的服务渲染"（用 `renderMedia` 服务端渲染不踩这条）。本报告只规划"官方 Remotion 路线"的落地，不讨论自研/Motion Canvas 备选（见 `openmontage-adoption-analysis-2026-10-13.md` §2 P0）。

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
| ffmpeg | `src/ffmpeg-run.ts` `resolveFfmpegPath()` | 传给 `renderMedia({ ffmpegExecutable })`，**复用同一随包二进制（CV-201）**，不另带 ffmpeg；媒体真值探测复用 `probeMediaInfo`（项目无 `resolveFfprobePath`，不传 `ffprobeExecutable`） |
| 资产 URL | `webServer` 路由 `/canvas-studio/assets/<projectId>/<file>` | Remotion `<Video>/<Img>` 直接吃这些 URL（同源 localhost）；或落地阶段拷到 remotion `publicDir` 用 `staticFile()` |
| 质量门禁 | `src/quality-check.ts` `qc_shot` / `runShotQc` | 扩展校验 Remotion 产物（字幕存在性 + 帧采样），复用 `probeMediaInfo` |
| 审批门 HITL | `assertApprovalAllowed`（host-tools.ts:718 定义，compose_video 调用点 L2303） | 复用：在"manifest 确认"这一 checkpoint 卡一下（注：`submit_storyboard_for_approval` 已随 REQ-022 下线，不再作为范例） |
| 测试纪律 | `tests/skill.test.mjs` 扫 `name:` 并要求 `toolchain.md` + `docs/canvas-studio-tools.md` 各一行登记 | 新工具必须补这两处文档登记（否则测试红） |
| 运行配置 | `StudioRuntimeConfig`（L1221） | 可加 `remotionBundlePath()` / `chromiumPath()` 两项（可选） |

**关键约束（来自项目铁律）**：新模块作为**独立模块**接入，复用 `ffmpeg-run.ts`，**不动历史数据路径**（遵循"只修产生路径"）；测试归入 T3 分层（跨进程/守卫），渲染真实需要 Chromium → 真跑冒烟判耗时（<5ms 视为空绿，见日常记忆）。

---

## 2. 分阶段路线图

### 阶段 0 — 技术 Spike / 可行性验证（0.5~1 周，**必须先做**）
目标：确认在本机 Electron 环境下 Remotion 真能渲染，并选定语粒子策略（见 §3 决策点 1）。

- [ ] 在 `canvas-studio/` 下加 `remotion/` 子工程：`remotion.config.ts` + `src/index.ts`（注册一个最小 `<Composition id="card" ...>`）+ 一个 `SubtitleCard` 组件。
- [ ] 装 `@remotion/core` `@remotion/renderer` `@remotion/cli`（devDeps）。
- [ ] 本地 `npx remotion render` 跑通最小合成，记录：Chromium 下载耗时 / 单帧渲染耗时 / 产物 MP4 参数。
- [ ] **决策并验证 Chromium 来源**（§3 决策点 1）：是让 Remotion 自带 Chromium（`ensureBrowser`，+~150MB），还是复用 Electron 打包的 Chromium（`chromiumPath` 覆盖）。两种都在本机 Electron 实跑一遍。
- [ ] 验证 `renderMedia({ ffmpegExecutable: resolveFfmpegPath() })` 能用我们随包 ffmpeg 出片（而不是 Remotion 自带的那份）。
- [ ] 产出：`spike-report.md`（帧耗时基线 + Chromium 策略结论 + 打包体积增量）。

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
  2. `renderMedia({ bundle, composition: 'studio-composition' /* Root.tsx 固定注册 id，≠ manifest.id */, inputProps: manifest, outputLocation, ffmpegExecutable: resolveFfmpegPath(), cancelSignal, chromiumPath?: cfg.chromiumPath() })`。注：**不传 `ffprobeExecutable`**——项目无 `resolveFfprobePath`，媒体真值探测复用 `probeMediaInfo`（ffmpeg-run.ts:278，走 `ffmpeg -i`）。
  3. 产物落 `assetsDir/export-<uuid>.mp4`（与 compose.ts 同源路由）。
  4. `probeMediaInfo` 探真值 → 组装成 `ComposeResult` 返回（与 compose_video 同形状）。
- [ ] `output.render`：复用 `renderComposeResult`（host-tools.ts L250）或新增一个，保证 agent 看到的返回块一致。
- [ ] **文档登记**（必做，否则 `skill.test.mjs` 红）：在 `toolchain.md` 与 `docs/canvas-studio-tools.md` 各加一行 `render_composition` 登记。
- [ ] `StudioRuntimeConfig` 可选加 `remotionBundlePath()` / `chromiumPath()`（阶段 0 决定要不要）。

### 阶段 4 — Skill 接入（Agent 面，2~3 天）
- [ ] 新建 skill `code-driven-explainer`（或扩展 `paper-collage-explainer-generator` 等现有 explainer skill）：给定脚本，产出 `CompositionManifest` 并调用 `render_composition`。
- [ ] 在 manifest 生成后、渲染前插入 **stop-and-confirm checkpoint**（复用现有 `ask_user_choice` / 审批门），让用户确认卡片/字幕/时长编排。
- [ ] skill frontmatter（name/description/trigger-words/compatibility）按现有 23 个 skill 的约定补齐，保证 `routing-prompt` 能命中。

### 阶段 5 — 质量门禁扩展（1~2 天）
- [ ] `quality-check.ts` / `qc_shot` 增加 Remotion 产物校验：① 声明的 `cards` 是否真出现在帧采样里（防"卡片没渲染"）；② 字幕存在性（帧 OCR 或像素检测，复用 `probeMediaInfo` 帧采样）；③ 时长漂移（manifest `durationInFrames/fps` vs 真值）。
- [ ] 复用 `DEFAULT_QC_BUDGET` 与现有 `runShotQc` 骨架，不另造。

### 阶段 6 — 打包与分发（风险最高，预留 1 周 + 用户终端配合）
- [ ] **Chromium 进包**：若阶段 0 选"Remotion 自带 Chromium"，`electron-builder` 需把 Remotion 下载的 Chromium 打进 asar/unpacked；**注意本机 env 已知坑**（见 §3 决策点 1 + 用户记忆：agent shell 因 `com.apple.provenance` 无法搬运、universal 包须在用户自己终端跑、`ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR` 必须导出）。
- [ ] **ffmpeg 单一来源**：确认 Remotion 用 `resolveFfmpegPath()` 而非自带，避免打两份 ffmpeg。
- [ ] 在用户本机 Electron 实跑一次完整"模型 clip + Remotion 卡片 → 成片"端到端，确认 GUI/渲染层真起得来（agent shell 只够拿主进程日志）。

### 阶段 7 — 测试与纪律（贯穿，T3）
- [ ] **纯函数单测（无 Chromium）**：`CompositionManifest → Remotion inputProps` 映射、组件 props 计算（`interpolate` 边界），直接断言。
- [ ] **集成冒烟（需 Chromium）**：`renderMedia` 渲染一个 1 秒最小合成，断言产物 MP4 存在 + 时长 ≈ 真值。**gate 在"浏览器可用"**，CI/agent shell 无 Chromium 时跳过（仿 ffmpeg 真跑冒烟的"<5ms 空绿"判定）。
- [ ] 反向变异：真改坏一个组件 → 断言产物校验变红 → 还原（遵循 T3 反向变异纪律）。
- [ ] `skill.test.mjs` 扫描通过（新工具已登记）。

---

## 3. 需要你拍板的决策点（建议在阶段 0 前定）

**决策点 1 — Chromium 来源（决定打包复杂度，最关键）**
- A. **Remotion 自带 Chromium**（`ensureBrowser` 下载）：最简单、版本解耦，代价 +~150MB 包体、打包时需联网下 Chromium（要走 `npmmirror` 镜像，且 agent shell 搬运受限 → 须在用户终端跑打包）。
- B. **复用 Electron 打包的 Chromium**（`renderMedia({ chromiumPath: electronChromium })`）：零额外体积，但 Remotion 对 Chromium 大版本有耦合，Electron 升级可能 break；且需确认 Electron 的 Chromium 路径在运行时可定位。
- **建议**：阶段 0 两种都实测；若 B 在你们 Electron 版本下稳定，选 B（省 150MB）；否则选 A（稳妥）。

**决策点 2 — 资产喂给 Remotion 的方式（已定：B）**
- A. 直连 webServer 同源 URL（`/canvas-studio/assets/...`）：Remotion `<Video src="http://localhost:<port>/...">`。最省事，但渲染进程要能访问 Host 的 webServer（同进程通常 OK）。
- B. 落地阶段把 clip 拷到 remotion `publicDir` 用 `staticFile()`：更隔离、利于离线，但多一次拷贝 IO。
- **已定**：**方式 B**（devdoc §8 定稿，含 src 重写与 basename 冲突防御），隔离/离线/可复现；阶段 3 落地。

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
| **双 ffmpeg** | Remotion 自带 ffmpeg，可能与随包二进制冲突/重复 | 显式传 `ffmpegExecutable: resolveFfmpegPath()`，禁用 Remotion 自带 |
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
