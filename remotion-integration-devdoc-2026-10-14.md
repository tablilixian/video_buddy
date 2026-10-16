# Remotion 集成开发文档（实现规格 v1.6 —— **路线 B / CSR**）

> **文档定位**：本文件是 Remotion 集成（REQ-034）的**唯一实现事实源**——契约、决策、口径均以本文为准。`remotion-integration-roadmap-2026-10-13.md` 是早期路线图，已被本文取代（其顶部有口径声明 + 失效锚点勘误）。精确到文件、函数、类型定义、测试门禁与代码骨架。
>
> **配套可视化参考**：`remotion-integration-demo.html`（已交付，可离线打开）。本文中凡标注「见 demo §X」之处，都对应 HTML 里可点击的那一屏。建议边读文档边对照 HTML 看流程。
>
> **阅读顺序**：§0 修订记录 → §1 定调 → §2 架构（对照 demo §1）→ §4 数据契约（对照 demo §2）→ §6 核心工具（对照 demo §3）→ §11 插入点表（对照 demo §3）→ §13 阶段计划 → §14 缺口（对照 demo §4）→ §17 结论（对照 demo §5）。

> ## 🧭 v1.6 路线声明（2026-10-16，**必读**）
> **本文档的实现规格以「路线 B / CSR（`@remotion/web-renderer`）」为准**（见 §0 R17 / §0.4 R21）。
> **权威章节**：§5（文件树）、§6（工具 + 渲染工单桥）、§7.1/§7.2/§7.3（组件与管线）、§8（资产直取 + 字体）、§11（登记点）、§12.4（冒烟）、§13（阶段 3/6）—— 均已改写为 route B。
> **尚未逐句改写的残留章节**：§2.2、§2.3、§2.4、§3、§4.5、§15、§16、附录 A。其中若出现 **route A 词汇**（`renderDir` / `staticFile()` / `publicDir` / `bundle()` / `selectComposition` / `renderMedia` 三步链 / `makeCancelSignal` / `@remotion/renderer` / `@remotion/bundler` / Chrome Headless Shell / `@remotion/compositor-*` / `binariesDirectory`），**一律以 §6/§8 的 route B 口径为准，那些段落仅作 route A 回退备查**。
> **v1.6 增量（本轮）**：① **§6.5 补漏点 R22**——新增 `render_composition` 时**除了在本文件内调 `assertApprovalAllowed`，还必须把工具名登记进 `src/approval-gate.ts` 的 `FORMAL_TOOLS` 表**，否则审批门形同虚设（详见 §0.5 R22）；② **验收回填**——B3 客户端 CSR 真机渲染已跑通、验收期两枚缺陷已修（§0.5）；③ 校正本文件里 `assertApprovalAllowed` / `compose_video` 调用点的**行号漂移**（718→748 / 2303→2333）；④ 勾选 §13 阶段 2/3/5/7 已完成项。
> **唯一未决**：**S9**（`<Video>`/`<Audio>` 在 CSR 下的音视频 mux，需用户终端验）；证伪则回退 route A（§7.6 决策建议第 4 条）。

---

## 0. 修订记录（v1 → v1.1 → v1.2，2026-10-15；v1.3 → v1.4 → **v1.5 路线 B**，2026-10-16）

**修订动因（v1.1）**：v1（2026-10-14）依据 **Remotion v3 语义**书写。本次按 **Remotion 4.0.535**（核对时最新版）逐条比对官方文档与 npm 包实体后，修正 7 处——**其中 R1–R4 若不改，照抄 v1 的代码骨架会直接跑不起来**。

| # | v1 的写法（错 / 缺失） | v1.1 修订 | 影响章节 |
|---|---|---|---|
| **R1** | `renderMedia({ ffmpegExecutable: resolveFfmpegPath() })`「复用随包 ffmpeg 编码」 | `ffmpegExecutable` / `ffprobeExecutable` **在 v4.0 已被移除**（官方标 removed，非 deprecated）。Remotion 自带 `ffmpeg` + `ffprobe` + 全套 `libav*` 动态库（在 `@remotion/compositor-<platform>`，≈17MB/平台，实测 darwin-arm64 = 18,034,429 B）。⇒ **渲染编码走 Remotion 自带，不再复用项目 ffmpeg**；项目 ffmpeg 只用于**混音与媒体探测**（`buildAmixArgs` / `probeMediaInfo`） | §2.2 §2.3 §3 §6.2 §6.3 §6.4 §7.1 §11 §13 §14 |
| **R2** | `renderMedia({ composition: 'studio-composition' })` | `composition` 收的是 **VideoConfig 对象**，不是字符串 id。正确链：`bundle()` → `selectComposition({serveUrl, id, inputProps})`（**会在此时执行 `calculateMetadata`**）→ `renderMedia({composition, …})`。且 **`codec: 'h264'` 是必填参数**（v1 伪码漏写） | §6.3 §7.1 |
| **R3** | 浏览器参数写作 `chromiumExecutable` / `chromiumPath` | 真名 **`browserExecutable`**。且 Remotion 4.0.247+ 默认使用 **Chrome Headless Shell**（不是完整 Chrome），落在 `node_modules/.remotion/chrome-headless-shell/<platform>/`，带 `VERSION` 文件、**版本不符会自动删除重下**；官方明确警告不要用 `browserExecutable` 指向不兼容的 Chrome。⇒ 决策点 1「复用 Electron 打包的 Chromium」**不可行**，v1 的「+150MB / 可省 150MB」估算同时作废 | §7.5 §13 §15.1 §15.2 |
| **R4** | devDep `@remotion/test-renderer` | **该包在 npm 不存在（E404）**。官方测试路径是 React Testing Library / Happy DOM / `@remotion/player` 的 `<Thumbnail>` + `renderToString`。本项目取「时序与插值抽纯函数 + 现有 `node --test`」，组件级帧断言列为可选 | §5 §12.3 §13 |
| **R5** | 「`Root.tsx` 从 `inputProps.manifest.meta` 读 `durationInFrames/fps/width/height`」——**没给机制** | 必须用 **`<Composition calculateMetadata={…}>`**（v4.0.0+，可异步，收 `{defaultProps, props, abortSignal, compositionId, isRendering}`，返回 `{durationInFrames, fps, width, height, props}`）。不写它，`<Composition>` 的四个元数据只能**静态硬编码**，动态时长设计落不了地 | §7.3 |
| **R6** | 「预构建 bundle 进包」（决策 5）与「每次渲染喂 `publicDir`」（方式 B）**同时成立** | 二者**互斥**：`publicDir` 只在 `bundle()` 调用时生效，其内容被**复制进 bundle 目录**。改为统一**渲染工作目录 `renderDir`** 模型（预构建 bundle 复制/注入 vs 开发态 `bundle({outDir, publicDir})`），§8 重写 | §6.3 §8 §13 §15.1 §15.2 |
| **R7** | `tracks[].durationInFrames` 的**数据来源未定义**（只定义了旁白与成片的"探真值"） | 补口径：**video 轨必须用 `list_shots` 返回的真实时长**（Host 已探过真值），禁止由 LLM 估；image/textCard/shape 轨由 skill 按解说节奏排并在 HITL 预览中可改；渲染前宿主对 video/image 轨做一次「声明 vs 真值」核对（>0.5s 偏差 → warning） | §4.5 §7.3 §10.4（新增） |

### 0.1 v1.2 追加修订（2026-10-15 晚，对齐 skill 体系新规 CV-317~CV-326）

**动因**：同期另一条线落地了 skill 体系重构（提交 `12c2af51a0`，CV-317~326），**改动了新增 skill 的落地规则，并新增一条与本文件 §10.1 原设计直接冲突的硬约束**。已按下列 R8/R9 修订；顺手更新两处被该批改动带漂的锚点（见 R10）。

| # | v1.1 的写法 | v1.2 修订 | 影响章节 |
|---|---|---|---|
| **R8** | 「新工具必须补两处文档登记（`toolchain.md` + `docs/canvas-studio-tools.md`）」，skill 侧无额外要求 | **新增 skill 的门禁从 3 处扩到 6 处**，且多出 2 项产物约束：<br>① `toolchain.md` 工具表行；② `docs/canvas-studio-tools.md` 工具表行；③ `tool-registry.test.mjs` 计数 **24 → 25**；④ **`skills/<name>/platform.yaml` 必需**（CV-324；9 必填字段 `name/title/summary/category/icon/hue/featured/role/slot`，目录名 = platform.yaml.name = SKILL.md frontmatter.name **三方一致**，`role ∈ {knowledge, decision}`，`slot` 合法且 `orchestration` **被总纲独占**）；⑤ **`src/skill-catalog.ts` 的 `BUNDLED_CATALOG` 快照必须与 platform.yaml 逐字段相等**（渲染器无文件系统，用内嵌副本）；⑥ **`skill-tool-refs` 全文对账**——skill 正文里出现的 snake_case 工具名必须在真实注册表里，否则红 ⇒ **工具与 skill 必须同批提交**。<br>另：`SKILL.md` 入口 **≤12 KB**（非总纲），细则下沉 `references/`，分册互引不许断链；`description` 上限是 **1024**（不是 500）；`skills/` 数量现为 **21**（原 23，CV-318 删了两个死 skill） | §5 §10.1 §11 §12.1 §13（阶段 2/4/7） §14 |
| **R9** | 「skill 在 manifest 生成后、渲染前插入 **stop-and-confirm checkpoint**（复用现有 `ask_user_choice` / 审批门）」 | ⚠️ **与 `skill-progressive-disclosure.test.mjs`（CV-322）直接冲突**：该门禁**禁止 skill 自设 HITL 门**（既打退役工具名 `submit_screenplay` / `submit_storyboard_for_approval`，也打"确认后才生成"这类流程门表述），理由是**审批语义只有一处事实源**——`canvas-studio-creation` 总纲。⇒ 本设计的 HITL 落点改为：① **宿主工具级**——`render_composition` 自身调 `assertApprovalAllowed`（与 `compose_video` 同口径，这不是 skill 自设门）；② **skill 侧只做需求澄清**（`ask_user_choice` 展示轨道时序预览供用户调整），措辞不得写成流程门 | §10.1 §10.2 §13（阶段 4） §14 |
| **R10** | `附录 A` 写 `toolchain.md:55` 是 `compose_video` 行；「现有 23 个 skill」 | 该批重写了 `toolchain.md`（现 132 行），**`:55` 已不是工具表行** ⇒ 锚点改为**按行首匹配定位**（`\| \`?compose_video\`? \|`），不再引用行号（工具表还会长）；skill 数量改 **21** | §11 §12.1 §3 附录 A |
| **R11** | 「唯一禁区＝不允许让用户上传自有 Remotion 工程到你的服务渲染」 | **许可原文（`remotion@4.0.535/package/LICENSE.md`，2026-10-15 取包内原文）里没有这一条**。原文 Disallowed 只有一条：**不得复制 / 修改 Remotion 代码以出售、出租、授权、再授权你自己的 Remotion 衍生品**。⇒ 撤回该说法、改引原文口径，并标注"用户上传"属**待核**；同时新增「**Remotion 5.0 将改动许可条款**」风险项。原文已存档 `docs/remotion-license-snapshot-2026-10-15.md` | §0.1 事实 1 §1.3 |

### 0.2 v1.3 追加修订（2026-10-15 深夜，**B0 Spike 实测回填**）

**动因**：B0 Spike 已在 Intel Mac + Node 22.22.2 上把核心链路跑通（报告：`canvas-studio/docs/remotion-spike-report-2026-10-15.md`）。**实测纠正了 3 处纸面推演必错的细节**，并解决了浏览器下载这一最大环境风险。

| # | v1.2 的写法 | v1.3 修订（**实测依据**） | 影响章节 |
|---|---|---|---|
| **R12** | §6.3 伪码 `cancelSignal: signal`（把 `exec.signal` 直接当 `cancelSignal`） | ⚠️ **`CancelSignal` 不是 AbortSignal**，其类型是 `(callback: () => void) => void` 的**订阅函数**。正确用法：`const { cancelSignal, cancel } = makeCancelSignal()`（`@remotion/renderer` 公开导出），再 `exec.signal?.addEventListener('abort', () => cancel(), { once: true })`。中断时抛 `renderMedia() got cancelled`，**且不产出残片 mp4**（实测）。<br>注：`isUserCancelledRender` **不在公开 ESM 导出里**（只在 dist 的 `.d.ts`/内部模块），区分"用户取消"只能按错误信息匹配 `/cancelled/i` 或 CJS 深导入 | §6.2 §6.3 §13（阶段 3） |
| **R13** | §8.1/§8.2 把素材注入 `<renderDir>/cs-assets/<name>` | ⚠️ **`staticFile()` 的解析根是 `<bundle>/public/`，不是 bundle 根**（实测服务路径为 `/public/cs-assets/...`，删掉该文件返回 404）。⇒ 注入落点必须是 **`<renderDir>/public/cs-assets/<name>`**。组件侧 `staticFile('cs-assets/<name>')` **不变**（相对 `public/` 解析）。<br>**同时确认**：§15.1 决策 5 的待验项**成立** —— 复制预构建 bundle 后往 `<renderDir>/public/` 注入素材可被读到 ⇒ **发行版可运行时零 webpack** | §8.1 §8.2 §13（阶段 3/6） §15.1 |
| **R14** | §0 R1「传了会怎样？记录报错文案」 | 实测：**`ffmpegExecutable` 被静默忽略，不报错** —— 传一个**不存在**的路径（`/usr/bin/ffmpeg`，本机确实没有）仍然成功出片。⇒ 这类"看起来生效其实没生效"的写法**只能靠 code review 拦住**，不能靠"跑一次就知道" | §0 R1 §6.4 |
| **R15** | §7.5「headless-shell 确切体积待阶段 0 实测」「构建期需联网下载（走镜像）」 | **已实测并解决**：官方源 `storage.googleapis.com` 本机 **20 KB/s（不可用）**；**npmmirror 的 `chrome-for-testing` 镜像 URL 与官方 1:1 同构**（仅换前缀），实测 **26 MB/s / 104MB / 4s**。预置脚本 + 落地布局见 `canvas-studio/.workbuddy/spike-remotion/pipeline/s0b-prefetch-browser.sh`。体积：**zip 104MB → 解包 210MB**；`ensureBrowser()` 命中后耗时 **0.0s**（`VERSION` 文件写对是关键）。<br>另实测：**本机是 Intel Mac ⇒ 拿到 `compositor-darwin-x64`（25M）**；arm64 需交叉装（`--force --os=darwin --cpu=arm64`，17M）⇒ **通用包要 42M**（此前只写"≈17MB/平台"） | §7.5 §13（阶段 0/6） §15.2 §15.3 附录 A |
| **R16** | §7.5 方案 B「复用 Electron Chromium」仅为**推断**不可行；包体只写"+"未给数 | **S5 已把它变成实证**：传 Electron 的 `MacOS/Electron` 当 `browserExecutable` → **`Timed out … connect to the browser`** 且 hang（`MacOS/Electron` 只是 13KB launcher，真实现是 203MB 共享库，不提供 CDP）。<br>**体积实测**：headless-shell 解包 **210 MB = 187 MB 主二进制（不可裁）+ 11 MB ICU + ~12 MB 其它** ⇒ **无裁减空间**，必须 `asarUnpack`。<br>⇒ 新增 **§7.5.1 包体决策（待拍板）**：① 随包 210MB / ② 随包 zip 104MB + 首启解包 / ③ 不随包首启下载 0MB | §7.5 §7.5.1 §13（阶段 6） §15.1 §15.2 |
| **R17** | 全文只有 **SSR 一条技术路线**（`@remotion/renderer` + headless-shell） | ⚠️ **S6 发现第二条路线：CSR（`@remotion/web-renderer`）；S7 已实测可用（Electron 43 / Chromium 150：真渲 1s mp4 15545 B / 2166 ms，h264+aac 可用）**。可省掉整个 250MB 包体与 webpack/预构建 bundle。<br>依赖链**不含** `@remotion/renderer`/compositor（只 mediabunny + licensing + remotion）；`remotion` 本体零依赖。<br>**固化限制（影响组件设计）**：**`z-index` 不支持 → 组件必须靠 DOM 顺序控层叠**；`object-position`/`writing-mode`/`mix-blend-mode`/`backdrop-filter`/inset 阴影不支持；`<OffthreadVideo>` 不支持（**正好我们已选 `@remotion/media`**）。<br>**新发现的两处风险**：① CSR 走 **OpenH264 软件编码**（`videoBitrate` 类参数可能不生效，画质控制弱于 SSR）；② 默认 `resolvedOutputTarget: "web-fs"` **需用户手势** ⇒ 后台自动落盘必须走 `getBlob()`/`outputWritable` + IPC。<br>⇒ **§7.6 已给出建议：切 CSR，但先补三项补验（字体/性能画质长样/落盘路径）**；当前规格仍按路线 A 写 | §7.5 §7.5.1 §7.6 §13（阶段 6） §15.1 |

> 附：`remotion-integration-roadmap-2026-10-13.md` 顶部已加「失效锚点勘误」（`@remotion/core` 非官方包、`ffmpegExecutable`/`chromiumPath` 不存在、三处登记已过时），避免它作为背景资料被照抄。

### 0.3 v1.4 追加修订（2026-10-16，**B1 契约层落地**）

**动因**：路线拍板走 **CSR（路线 B，`@remotion/web-renderer`）**，B1 契约层（纯数据 + 纯函数，零 Remotion 依赖，两路线通用）先行落地，落地时暴露一处契约缺口并当场补齐。

| # | v1.3 的写法 | v1.4 修订 | 影响章节 |
|---|---|---|---|
| **R18** | §4.2 `BaseTrack.id` 只写「唯一 id」；§4.3 `collectManifestSourceIds(manifest)` 要求产出**画布节点 id** 作血缘 `sourceIds`，但 Manifest 只见轨道局部 id 与资产 URL，**纯函数无法把 URL 反查成 node id** —— 契约自相矛盾 | **拍板约定（用户 2026-10-16 确认）**：**素材轨（`video` / `image`）的 `track.id` 必须填该素材的画布节点 id**；`collectManifestSourceIds` 直接按轨道顺序返回这些去重 id（纯呈现轨 `textCard`/`shape`/`transition` 的 id 为本地 id，不参与血缘；音频只有 URL 无节点 id，不并入）。§4.4 示例里素材轨的 `t0`/`t2` **勘误为节点 id**（`t1`/`t3`/`t4`/`t5` 为呈现/转场轨，保持本地 id）。此约定须同步写进 B4 的 SKILL 字段口径 | §4.2 §4.3 §4.4 §10（B4 待写） |
| **R19** | §7.4 `TextCard` 草图用 `if (local < 0 \|\| local > track.durationInFrames) return null` 判激活 | **`>` 多算一帧**：`local === durationInFrames` 时仍渲染，与该轨在转场/重叠窗口（§4.3 规则 4）使用的**半开区间**口径不一致。抽纯函数时统一为 `[startFrame, startFrame+durationInFrames)`（`isTrackActive`），疏漏会表现为「相邻轨重叠一帧 / 转场边界闪一下」 | §7.3 §7.4 §12.3 |
| **R20** | §7.3「`@remotion/media` 的 `<Video>` + `durationInFrames={track.durationInFrames}`（把 `trimBefore`/时长对齐到 Manifest 声明）」 | **实测 `@remotion/media@4.0.535` 的 `Video` props 里没有 `durationInFrames`**（只有 `trimBefore`/`trimAfter` 与 `<Sequence>` 上界）。段长必须用 **`<Sequence from durationInFrames>` 包住媒体组件**控制（`Root.tsx` 已如此）。「末帧冻结」问题改由 §10.4 的时长核对（声明对齐真值）+ Sequence 上界共同保证 | §7.3 §7.4 §13（阶段 2） |

**B1/B2/B5 落地物**（`canvas-studio/`，零 Remotion 依赖，两条路线通用）：
- `src/remotion/manifest.ts`：§4.2 全部类型 + `validateManifest`（§4.3 规则 1–7 + 轨道 id 唯一 / 类型特有字段 / 音频引用与音量区间）+ `deriveAudioComposition` + `collectManifestSourceIds` + 导出 `isAllowedManifestAssetRef`（规则 7 的判定，B3 render-dir 可复用）。
- `src/remotion/timing.ts`（§12.3 要求的「组件行为 → 纯函数契约」）：`trackLocalFrame` / `isTrackActive`（半开区间，R19）/ `fadeOpacity`（端点 clamp + 短轨折半）/ `deriveSubtitleTiming`（§10.3 字数占比 + 呼吸间隔内扣 + 末句吸收舍入）/ `reconcileVideoDuration` + `reconcileManifestVideoDurations`（§10.4 声明 vs 真值，>0.5s 修正 + warning）/ `trackTransitionWindows` + `transitionOverride`（转场窗口折算成轨道可见性覆盖）。
- `src/remotion/slideshow-risk.ts`（§9.2）：`scoreSlideshowRisk` 6 维评分（权重 30/25/10/15/10/10），score ≥ 60 → warning，不阻断。
- `src/remotion/components/`（B2 组件库，仅 `.tsx`，**不进 Host 构建**——`tsconfig.json` 已 `exclude`）：`Root.tsx`（`<Composition id="studio-composition">` + `calculateMetadata`）、`VideoClip.tsx`（`@remotion/media` 的 `<Video>`，R20）、`ImageClip.tsx`、`TextCard.tsx`（四态）、`Shape.tsx`、`Transition.tsx`（`TransitionShell`，吃 `transitionOverride`）、`index.ts`（`registerRoot` + 导出）。**层叠全靠 DOM 顺序，零 `z-index`**（路线 B 约束）。
- 依赖（§11 阶段 6 的一部分，为走 B 提前落地）：`canvas-studio/package.json` deps 加 `remotion` / `@remotion/media` / `@remotion/web-renderer` **4.0.535**；新增 `tsconfig.remotion.json` 并接进 `typecheck` 脚本。
- `tests/manifest.test.mjs`（16 例）、`tests/remotion-timing.test.mjs`（13 例）、`tests/slideshow-risk.test.mjs`（5 例）。
- 验证：`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.remotion.json` 干净；`test:smoke` **1719 / 1719 · 失败 0 · 名单外新增 0**。

> **尚未落地**：`fonts.ts`（§8.3 需随包字体子集产物）、`render-job.ts` / `client/remotion-render.ts` / `asset-check.ts`（route B 编排层，**§6/§8 已于 v1.5 按 B 改写**）、`render_composition` 工具（阶段 3，route B 后含 8 处登记）、`code-driven-explainer` skill（阶段 4）。组件视觉未验（无 GUI 会话）——待用户终端用 `@remotion/player` 或 `renderStillOnWeb` 出图确认。

### 0.4 v1.5 追加修订（2026-10-16，**route B 规格改写：§5/§6/§7.1/§7.2/§7.3/§7.5/§7.6/§8/§12.4**）

**动因**：B2 组件落地后确认路线 B 的**控制流反转**（渲染在浏览器、工具在宿主），原 §6/§8 的 route A 规格（`bundle`→`selectComposition`→`renderMedia` + `renderDir`/`staticFile`）整段失效，须先改写规格再动 B3 代码。

| # | v1.4 的写法 | v1.5 修订 | 影响章节 |
|---|---|---|---|
| **R21** | §6/§8 全按 **route A（SSR）**写：宿主 `renderMedia` 三步链 + `makeCancelSignal` + `renderDir`/`staticFile`/`publicDir` + 随包 headless-shell/compositor 双决策 | **改按 route B（CSR）**：`render_composition` 工具只做**校验 + 工单编排**，真渲染由**画布客户端**（Electron 渲染进程）跑 `renderMediaOnWeb` 并把 mp4 blob 经 **octet-stream 路由**回写宿主；素材**同源 URL 原样透传**（无 `renderDir`/`staticFile`）；取消用**标准 `AbortSignal`**（非 `makeCancelSignal`）；§7.5/§7.5.1（浏览器/包体决策）整体作废（B 下 +0MB）。**新增机制 = §6.4「渲染工单桥」**，复用现成两套：客户端队列轮询（`pollGenerationQueue`）+ octet-stream 上传（`upload-media` → `saveLocalAssetBytes`） | §5 §6 §7.1 §7.2 §7.3 §7.5 §7.6 §8 §12.4 §13（阶段 3/6） |

**新落点（route B）**：`src/remotion/render-job.ts`（宿主编排：工单状态机 + 结算）、`src/client/remotion-render.ts`（客户端渲染器）、`src/remotion/asset-check.ts`（只核对不拷贝）。`render-dir.ts` / `remotion-render.ts`（route A 名）**取消**。
**未决**：**S9**（`<Video>`/`<Audio>` 在 CSR 下的音视频 mux）仍是唯一未验项，须在用户终端跑；证伪则回退 route A（§7.6 决策建议第 4 条，route A 规格见 git 历史）。

> ⚠️ 环境（非本改动引入）：canvas-studio 客户端 `tsconfig.client.json` 的 typecheck 报 `@supabase/supabase-js` 找不到 —— 该依赖未装进 `canvas-studio/node_modules`（`corepack yarn install` 未跑全）。本批只动 Host 侧 `tsconfig.json`（排除 client），不受影响。

### 0.5 v1.6 追加修订（2026-10-16，**B3 落码 + 桌面验收回填**）

**动因**：B3（`render_composition` + 工单桥 + 客户端 CSR 渲染器）已落码并在桌面真机跑通出片。首次桌面验收暴露**两枚缺陷**，其中一枚是**本文件规格的漏点**（照 §6.5 写会对不上），故立 v1.6 修正规格本身。

| # | v1.5 的写法 | v1.6 修订 | 影响章节 |
|---|---|---|---|
| **R22** | §6.5「复用点清单」只写「复用 `assertApprovalAllowed()` — 审批门，与 compose_video 同口径」；§6.2 伪码也只写「在 `host-tools.ts` 同文件内直接调」 | ⚠️ **只说对了一半**：`render_composition` 虽在 execute 里调了 `assertApprovalAllowed`，但**工具名未登记进 `src/approval-gate.ts` 的 `FORMAL_TOOLS` 表**① 时，`approvalGateMessage()` 对该工具恒返回 `null` ⟹ 生产阶段 / 关键帧审阅期**完全不拦**——**审批门变成后门**（违反验收 Z-3）。⇒ 规格补充：**新增走审批门的工具，除「在 execute 内直接调 `assertApprovalAllowed`」外，还必须把工具名加进 `src/approval-gate.ts` 的 `FORMAL_TOOLS`**（自动并入 `PRODUCING_TOOLS`）。两道**都要做**：前者管「工具自己认不认门」，后者管「门认不认这个工具」 | §6.2 §6.5 §11 §13（阶段 3/7） |

> ① `FORMAL_TOOLS` 在 `canvas-studio/src/approval-gate.ts`（v1.6 时 L65）；`approvalGateMessage` 同文件 L133；`assertApprovalAllowed` 定义 `canvas-studio/src/host-tools.ts:748`（文件私有 async，未导出）。

**验收期另修（非规格漏点，属实现缺陷，记录备查）**：**`projectId` 伪 id 白等超时** —— 首次验收时模型按习惯传 `projectId:"current"`，宿主不校验即建工单；客户端恒用**真实**项目 id 轮询 `/remotion/pending`，`pendingRenderJobFor` 按 id 过滤 ⟹ 对不上 ⟹ 客户端立即停轮询 ⟹ 宿主干等满 `RENDER_JOB_TIMEOUT_MS = 10 min` 报 `CS-RENDER-TIMEOUT`。修法 = 新增导出纯函数 **`assertRenderCompositionProjectId(explicit, knownProjectIds)`**（`host-tools.ts:648`，紧邻 `resolveProjectId`）：显式传入的 id 不在 `(await registry.list()).map(e => e.id)` 内即当场 `CS-USER-ERR`（文案含「请省略 projectId 参数」）；省略则照旧按 cwd 解析。配套 `tests/remotion-render-project-id.test.mjs`（4 例）。

**行号漂移校正**：本文件多处引用的 `assertApprovalAllowed` 定义行 **718 → 748**、`compose_video` 调用点 **2303 → 2333**；`render_composition` 的调用点在 **2424**。

**验收状态**：typecheck 三连 + build + verify:loader + test:smoke **全绿（1729·1729）**；三份 remotion 单测合并 **21·21**；**桌面 CSR 真机渲染跑通出片（2026-10-16，首次端到端，纯卡片 manifest）**。**B4 skill 已落码（2026-10-16，六处 skill 门禁全绿）**；**S9 关闭**——S10 验证器用真组件渲出**带音轨成片**（`scripts/remotion-verify/out/render-with-audio.mp4` = h264+aac，ffprobe 检出 audio 流），证明 CSR 下 `<Video>`/`<Audio>` 音视频 mux 可行。**仍未验 / 未做**：Z 组边界（Z-7 时长校正 / Z-8 缺素材显式失败 / Z-9 幻灯片告警 / Z-11 中断无残留）、**字体（§8.3，`fonts.ts` + 中文子集未落地）**、真素材走完整产品链路（S9 的**工单桥版**）、干净机打包（Z-14）。**剩余工作清单见 `canvas-studio/docs/plans/REQ-034-剩余工作-20261016.md`。**

---

## 0.1 阅读前的四个既定事实（已核实，不再讨论）

1. **许可零成本**：Remotion Free License 覆盖「个人 + **3 人及以下营利组织**」，仅 4 人及以上触发 Company License（另有 Automators $0.01/render、$100/mo 起）。本项目是**两人公司**，商业使用、全功能、无限量均免费；官方 License FAQ 明确「Free 档也可以跑 automation」，而 `renderMedia()` 正属于官方定义的 automation 范畴，故**自行服务端渲染不触边界**。
   - ⚠️ 条款含「团队扩张到 4 人须升级」——团队规模变化时须重估。
   - ⚠️ **引用口径修正（2026-10-15，见 §0 R11）**：许可原文的 Disallowed **只有一条**——「不得复制 / 修改 Remotion 代码以**出售、出租、授权、再授权你自己的 Remotion 衍生品**」。早期文档写的「唯一禁区＝不允许让用户上传自有 Remotion 工程到你的服务渲染」**在许可原文中找不到依据**（疑似源自 FAQ 某条解读），**在核实出处前不要再当事实宣讲**。
   - ⚠️ **Remotion 5.0 将改动许可条款**（LICENSE.md 首行自带声明 + PR 3750）⇒ 「升级 Remotion 版本前先读一遍 `LICENSE.md`」写进升级检查清单。
   - 📁 **原文存档**：`canvas-studio/docs/remotion-license-snapshot-2026-10-15.md`（取自 `remotion@4.0.535` 包内 `LICENSE.md`，即随包发布的那份；GitHub raw 国内不可达）。
2. **API 基线锁定 Remotion 4.0.535**：本文所有 API 名与语义按 4.x 书写。**不写"兼容 v3"的代码骨架**；`@remotion/core` **不是官方包**（npm 上仅有第三方占位 `1.0.0-y.46`），官方主包就是 `remotion`。
3. **集成策略：并联旁路，不替换主干**。Remotion 不会动现有的 `compose_video`（ffmpeg concat 合成）链路，而是在 `createStudioTools()` 里**新增一个 `render_composition` 工具**，返回一个**与 `compose_video` 同形状**的结果。客户端 / agent / 画布节点零改动。
4. **80% 地基已具备**。agentic skill 体系、Drama 模型层、ffmpeg 后期、storyboard 契约、审批门、统一错误系统、资产路由全部现成，Remotion 只补最薄的"逐帧渲染 + 卡片组件"一层。

---

## 1. 目标、范围与许可结论

### 1.1 目标（REQ-034 最小闭环）
为 Canvas Studio 增加"代码驱动合成"能力，先覆盖**低成本科普 / 教育视频**的刚需：
- 字幕卡（subtitle / lower-third）
- 数据卡（data card：图表、数字、要点列表）
- 图文幻灯片（Ken-Burns 图片 + 解说）
- 简单转场（淡入淡出 / 滑入 / 缩放）
- 旁白 / BGM 混音（复用现有 ffmpeg 混音）

### 1.2 范围外（明确不做，避免 scope creep）
- ❌ 复刻 Remotion 全功能引擎（完整 React reconciler + WebGL + 分布式云渲染）。这层直接用免费 Remotion，不自研。
- ❌ LLM 动态生成 Remotion 组件 JSX 并沙箱化 `eval` 执行（agentic 但风险高，留作二期）。
- ❌ 云端批量渲染集群（单机 / Electron 内渲染即可，集群留待商业规模再议）。
- ❌ **词级字幕同步**（KTV 式逐词高亮）。MVP 为**句级字幕**，时序按 §10.3「探真值总时长 + 字数比例分配」派生；词级依赖 TTS 时间戳 / forced alignment（现状 Drama TTS 不返回任何时间戳，已核实），列二期。

### 1.3 许可结论（见 §0.1 事实 1）
- 免费档内，无 License 代码改动需求。
- **真正的边界（许可原文口径）**：不得**复制 / 修改 Remotion 代码以出售、出租、授权、再授权你自己的 Remotion 衍生品**。本项目是"自己写组件 + 自行渲染"，不动 Remotion 本体授权、不转售衍生品 ⇒ 落在 Allowed（"non-commercially or commercially … for the purpose of creating videos and images"）范围内。
- ~~唯一禁区（与本项目模式无关）：不允许让用户上传自有 Remotion 工程到你的服务去渲染~~ → **该说法在许可原文中无依据，已撤回**（§0 R11），改为上面这条原文口径。
- **留证动作（阶段 0，✅ 2026-10-15 已完成）**：原文快照存档 → `docs/remotion-license-snapshot-2026-10-15.md`（含"v5 条款将变"的提示与复核方法）。

### 1.4 验收成功标准（MVP）
> 一个 skill（`code-driven-explainer`）能在 HITL 确认后，把一段"剧本 + 一组模型生成的 clip / 图片"变成一个**带字幕卡、数据卡、转场、混音的成片节点**落画布，全程复用现有审批门与质量校验，且不破坏任何现有 `compose_video` 相关测试。

---

## 2. 架构总览（见 demo §1 流程总览）

### 2.1 现状流水线（A 路，不动）
```
Agent / Skill
  → 模型工具(video_generate / video_composite / image_generate / music_generation / tts_voiceover)
  → Drama 后端（config.ts 解析的 dramaApiBase）或 fal
  → clip / 图片 / 音频 素材节点落画布
  → compose_video（Host 侧 ffmpeg concat + 混音，compose.ts）
  → 成片 video-composite 节点（appendComposedVideoNode）
```

### 2.2 集成后流水线（B 路，新增，绿色描边）
```
Agent / Skill（code-driven-explainer）
  → 产出 CompositionManifest（结构化 JSON，见 §4）
  → render_composition（Host 侧新工具）
       ├─ 渲染工作目录 renderDir（预构建 bundle 复制/注入，或开发态 bundle({outDir})，见 §8）
       ├─ selectComposition()（执行 calculateMetadata → 定 durationInFrames/fps/尺寸）
       ├─ Chrome Headless Shell 逐帧渲染（React 重渲染 + 截屏，共享内存传位图）
       ├─ Remotion 自带 ffmpeg 编码 H.264（v4 不再接受外部 ffmpeg，见 §0 R1）
       └─ 复用项目 ffmpeg 做混音（buildAmixArgs）+ 媒体真值探测（probeMediaInfo）
  → 同形状 ComposeResult → 同 appendComposedVideoNode 落画布
```

### 2.3 关键设计原则（落代码时逐条遵守）
| 原则 | 落地做法 | 现有锚点 |
|---|---|---|
| 新工具返回同形状结果 | `render_composition` 复用 `ComposeResult` + `renderComposeResult` | `compose.ts:63` / `host-tools.ts:67`（`resultSchema`）、`:250`（`renderComposeResult`） |
| **渲染编码不碰我们的 ffmpeg** | Remotion v4 已移除 `ffmpegExecutable`，编码由自带 `@remotion/compositor-<platform>`（含 `ffmpeg`/`ffprobe`/`libav*`）完成；**不要尝试把 `ffmpeg-static` 喂给 Remotion**（缺 `libav*` 目录约定，且官方只支持整体替换 `binariesDirectory`） | — （§0 R1） |
| 复用项目 ffmpeg 做混音与探测 | 渲染产物出来后：`probeMediaInfo` 探真值 → `buildAmixArgs` 混 BGM/旁白 | `ffmpeg-run.ts:128`（`resolveFfmpegPath`）、`:278`（`probeMediaInfo`）、`compose.ts:281`（`buildAmixArgs`） |
| 复用资产路由 | 素材经 `urlToAssetPath` 反查本地路径 → 注入 renderDir（§8）；webServer 资产路由是 URL 的来源 | webServer `/canvas-studio/assets/<projectId>/<file>`（routes.ts:946） |
| 复用 storyboard 契约 | Manifest 由 skill 在 storyboard 落地后派生，不另起 YAML | `contracts/storyboard.ts` |
| 复用 HITL 审批门 | `render_composition` 调 `assertApprovalAllowed` 同 compose_video **+ 登记进 `approval-gate.ts` 的 `FORMAL_TOOLS`** | `host-tools.ts:748`（定义，文件私有）/ `:2333`（compose_video 调用点）/ `:2424`（render_composition 调用点）；门禁表 `approval-gate.ts:65` |
| 复用质量校验 | 产物经 `runShotQc` 同路径（**适配性待阶段 5 取证，见 §9.1**） | `quality-check.ts:217` |

### 2.4 模块依赖（文字图）
```
createStudioTools (host-tools.ts:1270)
  ├─ compose_video         [现有，不动]
  └─ render_composition    [新增] ──┬─> manifest.ts        (校验 CompositionManifest)
                                     ├─> remotion/           (TSX 组件库 + Root.tsx + index.ts)
                                     ├─> remotion-render.ts  (bundle → selectComposition → renderMedia 封装)
                                     ├─> fonts.ts           (字体解析/缓存/fallback，§8)
                                     ├─> resolveFfmpegPath   [复用 ffmpeg-run.ts：只用于混音/探测，不喂 Remotion]
                                     ├─> appendComposedVideoNode [复用 compose.ts]
                                     └─> runShotQc           [复用 quality-check.ts，适配性待取证]
```

---

## 3. 现有地基盘点（不重造，直接复用）

| 能力 | 文件:行 | 复用方式 |
|---|---|---|
| 工具注册框架 `createStudioTools` / `defineTool` | `host-tools.ts:1270` / `:1284` | 新工具镜像 `compose_video` 加进返回数组 |
| 成片结果形状 `ComposeResult` | `compose.ts:63` | 直接作为 `render_composition` 的输出形状 |
| 成片落节点 `appendComposedVideoNode` | `compose.ts:628` | 渲染产物复用此函数落 video-composite 节点 |
| ffmpeg 解析 / 执行 / 超时强杀 | `ffmpeg-run.ts`（全文件） | **混音与媒体探测**复用；渲染编码不走它（§0 R1） |
| 随包 ffmpeg 路径 `resolveFfmpegPath` | `ffmpeg-run.ts:128` | 传给**混音**步骤（`buildAmixArgs`）；**不传给 `renderMedia`**（v4 无 `ffmpegExecutable`） |
| 资产 URL→本地路径 `urlToAssetPath` | `compose.ts:118` | 反查 clip / 图片本地绝对路径，注入渲染工作目录 `renderDir`（§8） |
| Drama 模型驱动层（fl2va / ref2va / txt2speech） | `config.ts:62-84` | 素材生成继续走现有工具，Remotion 只管合成 |
| storyboard 契约 | `contracts/storyboard.ts` | Manifest 的"素材清单"由此派生 |
| 审批门 `assertApprovalAllowed` | `host-tools.ts:748`（定义，未导出；compose_video 调用点 `:2333`；render_composition 调用点 `:2424`） | `render_composition` 在 `host-tools.ts` 同文件内直接调，无需改导出；**另须登记 `approval-gate.ts:65` 的 `FORMAL_TOOLS`（§0.5 R22）** |
| 统一错误系统 `throwError` / `error-system.ts` | 全局 | 渲染失败走中文错误码，不裸 throw |
| 质量校验 `runShotQc` | `quality-check.ts:217` | 成片复用镜头质检 |
| 音频时长探测 `probeMediaDuration` | `ffmpeg-run.ts:299` | 句级字幕时序派生：探旁白真值总长（§10.3） |
| 资产路由（webServer） | `routes.ts:946`（`/canvas-studio/assets` 前缀注册） | 产出同源资产 URL；渲染前经 `urlToAssetPath` 反查本地路径注入 renderDir（§8） |
| 镜头真实时长 `list_shots` | `skills/canvas-studio-creation/references/toolchain.md`（工具表） | **video 轨 `durationInFrames` 的唯一合法来源**（§4.5 / §10.4）：脚本不再自己估时长 |

---

## 4. 数据契约：CompositionManifest（见 demo §2 数据处理）

### 4.1 设计原则
- **成片结构显式化**：把"哪些素材、在什么时间、以什么形态出现"写成结构化 JSON。这是 OpenMontage 模式的核心，也是当前 `compose_video`（只收 clipIds 数组）缺失的能力。
- **不复刻 OpenMontage 的 YAML manifest**：现有 storyboard 契约已成熟，Manifest 是 storyboard 的"渲染层派生"，不是第二套事实源。
- **纯数据、可校验、可序列化**：skill（LLM）产出 JSON 字符串 → 宿主 `manifest.ts` 校验 → 通过才渲染。

### 4.2 TypeScript 类型定义（落地文件：`src/remotion/manifest.ts`）
```ts
// src/remotion/manifest.ts

/** 成片顶层 Manifest（render_composition 的唯一入参结构）。 */
export interface CompositionManifest {
  /** 唯一 id（用 newAssetId() 生成，便于血缘与重试）。 */
  id: string
  meta: ManifestMeta
  /** 时间轴轨道（按 startFrame 排序后渲染；多轨同帧按数组顺序叠放）。 */
  tracks: CompositionTrack[]
  /** 音频层（可选；复用现有 ffmpeg 混音语义）。 */
  audio?: ManifestAudio
  /** 全局样式（字体 / 主题 / 品牌色）。 */
  global?: ManifestGlobal
}

export interface ManifestMeta {
  title: string
  /** 输出像素（与 sizeForAspectRatio 对齐，16:9 默认 1280×720 或 1920×1088）。 */
  width: number
  height: number
  fps: number
  /** 总时长（帧）；= max(track.endFrame)。 */
  durationInFrames: number
  backgroundColor?: string
}

/** 轨道联合类型：视频 / 图片 / 文本卡 / 形状 / 转场。 */
export type CompositionTrack =
  | VideoClipTrack
  | ImageClipTrack
  | TextCardTrack
  | ShapeTrack
  | TransitionTrack

export interface BaseTrack {
  id: string
  startFrame: number
  durationInFrames: number
}

/** 静态变换（百分比坐标系，相对画布；组件用 interpolate 对其做帧级动画）。 */
export interface Transform {
  /** 水平中心位置（0–100，默认 50 居中）。 */
  x?: number
  /** 垂直中心位置（0–100，默认 50 居中）。 */
  y?: number
  /** 缩放倍数，默认 1。 */
  scale?: number
  /** 旋转角度（度），默认 0。 */
  rotation?: number
}

export interface VideoClipTrack extends BaseTrack {
  type: 'video'
  /** 同源资产 URL（/canvas-studio/assets/...）或本地绝对路径。 */
  src: string
  transform?: Transform
  /** 是否启用 Ken-Burns 缓慢推拉（默认 false）。 */
  kenBurns?: boolean
}

export interface ImageClipTrack extends BaseTrack {
  type: 'image'
  src: string
  /** 图片展示形态：cover（默认，填满）/ contain（留边）/ kenburns。 */
  fit?: 'cover' | 'contain' | 'kenburns'
  caption?: string
}

export interface TextCardTrack extends BaseTrack {
  type: 'textCard'
  /** 卡片样式：字幕条 / 数据卡 / 标题卡 / 要点列表。 */
  variant: 'subtitle' | 'dataCard' | 'title' | 'bullets'
  /** 主文本（subtitle / title / bullets 每行一条）。 */
  text: string | string[]
  /** dataCard 专用：键值对（如 [{k:'全球老龄化',v:'16%'}]）。 */
  data?: { k: string; v: string }[]
  accentColor?: string
}

export interface ShapeTrack extends BaseTrack {
  type: 'shape'
  shape: 'rect' | 'circle' | 'line' | 'gradient'
  color: string
  /** 相对画布的百分比坐标（0–100）。 */
  box?: { x: number; y: number; w: number; h: number }
}

export interface TransitionTrack extends BaseTrack {
  type: 'transition'
  /** 作用于相邻两轨的转场类型。 */
  effect: 'fade' | 'slide' | 'zoom' | 'dissolve'
  /** 作用的源轨道 id（前一轨）。 */
  fromTrackId: string
  /** 作用的目标轨道 id（后一轨）。 */
  toTrackId: string
}

export interface ManifestAudio {
  /** BGM 资产 URL（复用 compose_video 的 bgmNodeId 语义）。 */
  bgmUrl?: string
  /** 旁白资产 URL（tts_voiceover 产物）。 */
  voiceOverUrl?: string
  /** 混音音量（0–1），缺省走 BGM_MIX_VOLUME / 1.0。 */
  mix?: { bgmVolume?: number; voiceVolume?: number }
}

export interface ManifestGlobal {
  /** 缺省字体族名；未随包且未缓存时走 §8 解析/下载链。 */
  fontFamily?: string
  /** 可选：动态字体描述（多语言扩展；随包子集未命中时按需下载并缓存，§8）。 */
  fonts?: ManifestFont[]
  theme?: 'light' | 'dark'
  brandColor?: string
}

export interface ManifestFont {
  /** 字体族名（与 CSS font-family / global.fontFamily 对应）。 */
  family: string
  /** 字重，默认 400。 */
  weight?: number
  /** 字体文件同源 URL（同 tracks[].src 约束）；缺省由宿主字体解析表解析（随包子集 → 自托管下载 → fallback）。 */
  src?: string
}
```

> 注：`audioComposition`（`StudioAudioComposition`，`contracts/canvas.ts:102`）**不属于 Manifest 输入**，它是宿主在校验通过后、落节点前**派生**出来的（§4.3 `deriveAudioComposition`）。skill / LLM 不产出该字段，`validateManifest` 也不接受它——避免"模型编一个音轨构成骗过校验"。

### 4.3 校验函数（纯函数，单测可断言）
```ts
// src/remotion/manifest.ts
import type { StudioAudioComposition } from './contracts/canvas.js'

export interface ManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}
export function validateManifest(input: unknown): ManifestValidation {
  // 1) 结构断言（meta 必填、width/height/fps/durationInFrames 为有限正数）
  // 2) 轨道遍历：startFrame>=0、durationInFrames>0、type 合法
  // 3) transition 引用的 fromTrackId / toTrackId 必须存在且不相同
  // 4) transition 窗口内 from/to 两轨必须重叠；首尾相接（无重叠）→ warning（渲染层退化为硬切）；
  //    完全不相交 → error（转场无意义，拒绝渲染）
  // 5) 总时长 = max(startFrame + durationInFrames)；与 meta.durationInFrames 偏差 >1 帧则 warning
  // 6) 任一轨道 endFrame > meta.durationInFrames → warning（渲染层按 meta 裁切，不静默吞）
  // 7) src 与 global.fonts[].src 必须以 /canvas-studio/assets/ 开头或本地绝对路径（防外链泄露）
  // 返回 { ok, errors, warnings }
}

/**
 * 宿主侧派生音轨构成（纯函数，落节点前调用；skill/LLM 不产出此值）。
 * MVP 规则（与 compose.ts 的角标语义对齐）：
 *   - 存在 video 轨（默认带原声）→ 有 bgm 或 voiceOver ? 'native+bgm' : 'native'
 *   - 无 video 轨 → 有 bgm 或 voiceOver ? 'bgm' : 'none'
 * 注：现有角标枚举无"旁白"独立位，voiceOver 并入 'bgm' 位；若未来要区分，
 * 扩展 StudioAudioComposition 枚举（二期，需客户端角标同步）。
 */
export function deriveAudioComposition(manifest: CompositionManifest): StudioAudioComposition { /* ... */ }

/** 收集 Manifest 引用的素材节点 id（= `video`/`image` 轨的 `id`，R18 约定）用于 appendComposedVideoNode 的血缘 sourceIds。 */
export function collectManifestSourceIds(manifest: CompositionManifest): string[] { /* ... */ }
```

### 4.4 假数据示例（30s 科普视频，见 demo §2 数据卡）
```json
{
  "id": "comp-9f3a2b",
  "meta": {
    "title": "为什么我们需要睡眠",
    "width": 1280, "height": 720, "fps": 30, "durationInFrames": 900,
    "backgroundColor": "#0b1020"
  },
  "tracks": [
    { "id": "9f3a-brain-node", "type": "image", "src": "/canvas-studio/assets/p1/brain.png",
      "startFrame": 0, "durationInFrames": 180, "fit": "kenburns",
      "caption": "大脑在睡眠中清理代谢废物" },
    { "id": "t1", "type": "textCard", "variant": "title", "text": "睡眠的科学",
      "startFrame": 180, "durationInFrames": 90 },
    { "id": "9f3a-sleep-clip-node", "type": "video", "src": "/canvas-studio/assets/p1/sleep-clip.mp4",
      "startFrame": 270, "durationInFrames": 264, "kenBurns": true },
    { "id": "t3", "type": "textCard", "variant": "dataCard",
      "text": "成年人每日建议睡眠", "data": [
        { "k": "18-64 岁", "v": "7-9 小时" },
        { "k": "65+ 岁", "v": "7-8 小时" }
      ], "startFrame": 510, "durationInFrames": 180, "accentColor": "#4f9dff" },
    { "id": "t4", "type": "textCard", "variant": "bullets",
      "text": ["记忆巩固", "免疫修复", "情绪调节"],
      "startFrame": 690, "durationInFrames": 210 },
    { "id": "t5", "type": "transition", "effect": "fade",
      "fromTrackId": "9f3a-sleep-clip-node", "toTrackId": "t3",
      "startFrame": 510, "durationInFrames": 24 }
  ],
  "audio": {
    "bgmUrl": "/canvas-studio/assets/p1/bgm.mp3",
    "voiceOverUrl": "/canvas-studio/assets/p1/voice.mp3",
    "mix": { "bgmVolume": 0.35, "voiceVolume": 1.0 }
  },
  "global": { "theme": "dark", "brandColor": "#4f9dff", "fontFamily": "SourceHanSansSC-Subset" }
}
```

> **素材轨 id 约定（R18，2026-10-16 拍板）**：上例中 `image` / `video` 轨的 `id` 是**画布节点 id**（bloodline 锚），故 `t5` 的 `fromTrackId` 指向节点 id；`textCard` / `shape` / `transition` 轨（`t1`/`t3`/`t4`/`t5`）是**本地 id**。`collectManifestSourceIds` 只收前者。

### 4.5 字段逐项说明（落地时照此写 SKILL.md 字段口径）
- `meta.durationInFrames` 是硬约束。落地机制：`<Composition calculateMetadata={…}>` 把它（连同 `fps/width/height`）作为返回值交给 Remotion（**不是**写死在 `<Composition durationInFrames>` 属性上，见 §7.3）；轨道超出会被裁切（校验层报 warning，不静默）。
- **`tracks[].durationInFrames` 的来源按轨类型分档（R7，硬口径）**：

  | 轨类型 | 时长来源 | 允许的偏差 | 违反后果 |
  |---|---|---|---|
  | `video` | **必须**取 `list_shots` 返回的真实时长（Host 已探过真值）折算帧数 | 0（同值折算，仅允许取整 ±1 帧） | LLM 自估时长 → 素材长短不符：声明偏短=截断，声明偏长=**末帧冻结**（静默错误）→ 校验层/宿主核对时判 warning 或 error |
  | `image` / `textCard` / `shape` | skill 按解说节奏与字幕时序（§10.3）自行排布 | 自由（无真值） | — |
  | `transition` | 由相邻两轨重叠窗口决定 | — | 见下文 |

- **渲染前宿主核对（route B：`checkManifestAssets`，§8.2）**：对每条 `video` / `image` 轨调一次 `probeMediaInfo`（`ffmpeg-run.ts:278`），比对「声明帧数 ÷ fps」与真值秒数；偏差 > 0.5s → 计入 `warnings`（视频轨禁止冻结末帧这种静默行为）。图片轨无时长概念，只核对文件存在与尺寸。（route A 的 `prepareRenderDir` 落盘法已作废，§8.2。）
- `tracks[].src`：只接受 `urlToAssetPath` 能反查的同源 URL 或本地路径（§8），拒绝外链。
- `transition` 是"声明式"的：渲染层在 `fromTrackId` 与 `toTrackId` 的**重叠窗口**内做过渡，**不消耗额外时长**。语义精确定义：
  - 转场窗口 = `[startFrame, startFrame + durationInFrames)`；
  - 窗口内 from 轨淡出 / to 轨淡入（fade），或按 effect 做位移/缩放插值；
  - **要求 from/to 两轨在窗口内均存活且重叠**——skill 组装 Manifest 时应把相邻两轨首尾重叠 N 帧（N = 转场时长），校验层对"首尾相接无重叠"给 warning（渲染退化为硬切），对"完全不相交"给 error。
- `audio.bgmUrl` 语义 = `compose_video` 的 `bgmNodeId`；时长守卫逻辑（BGM ≥ 成片真值）**复用 `bgmShortfallMessage`**（compose.ts:253）。
- 音轨构成（`audioComposition`）由宿主 `deriveAudioComposition` 派生（§4.3），不是 Manifest 输入。

### 4.6 与 storyboard 的关系
`code-driven-explainer` skill 在 `write_storyboard` 落地后，把 storyboard 的 `narration.lines` + `storyboard.scenes[].shots` + 已落画布的 clip / 图片节点，组装成 `CompositionManifest` 的 `tracks` 与 `audio`。**storyboard 仍是事实源，Manifest 是渲染层派生**，不双向同步。

---

## 5. 新增模块清单（文件树）

在 `canvas-studio/` 内新增，不影响现有文件（除 §11 列的 **6 处**登记 / 一致性点）：

```
canvas-studio/
├─ src/
│  ├─ host-tools.ts                 [改：createStudioTools 内加 render_composition]
│  ├─ compose.ts                    [不改，复用 ComposeResult / appendComposedVideoNode / urlToAssetPath / buildAmixArgs]
│  ├─ ffmpeg-run.ts                 [不改，复用 resolveFfmpegPath（混音）/ probeMediaInfo / probeMediaDuration]
│  ├─ quality-check.ts              [不改，复用 runShotQc（适配性待 §9.1 取证）]
│  ├─ skill-catalog.ts              [改：BUNDLED_CATALOG 加一条快照，与 platform.yaml 逐字段相等（CV-324 门禁）]
│  ├─ client/
│  │  └─ remotion-render.ts         [★ route B 新增：客户端渲染器（轮询工单 → renderMediaOnWeb → 回写 blob）]
│  └─ remotion/                     [全新目录]
│     ├─ manifest.ts                [§4.2 类型 + §4.3 校验]
│     ├─ render-job.ts              [★ route B：宿主编排 —— 工单状态机 + 存储 + 结算（Host 半）]
│     ├─ asset-check.ts             [§8.2 route B：只核对不拷贝 —— 素材存在性 + 时长核对]
│     ├─ timing.ts                  [纯函数：字幕时序派生（§10.3）+ 组件插值/轨激活窗口/转场覆盖（可 node --test 断言）]
│     ├─ fonts.ts                   [§8 字体解析：随包子集 → 下载缓存 → fallback（清单 + 同源 URL/data: 注入）]
│     ├─ slideshow-risk.ts          [§9.2 6 维评分]
│     └─ components/                [React 组件库（route B：直接被客户端 bundle，无需单独 webpack）]
│        ├─ Root.tsx                [StudioComposition + <Composition calculateMetadata>（供 Studio 预览）]
│        ├─ VideoClip.tsx
│        ├─ ImageClip.tsx           [含 kenburns]
│        ├─ TextCard.tsx            [subtitle / dataCard / title / bullets]
│        ├─ Shape.tsx
│        ├─ Transition.tsx          [TransitionShell：吃 transitionOverride]
│        └─ index.ts                [registerRoot + 导出 StudioComposition]
├─ public/fonts/                    [新增：随包中文字体子集（woff2，构建脚本产出）]
├─ scripts/
│  └─ build-remotion.mjs            [新增：字体子集化（route B 不再需要预构建 Remotion bundle）]
├─ skills/
│  └─ code-driven-explainer/        [全新 skill —— 按 skill-expansion-spec 新规（CV-317~326）]
│     ├─ SKILL.md                   [入口 ≤12 KB；细则下沉 references/（CV-322 门禁）]
│     ├─ platform.yaml              [★ 必需（CV-324）：name/title/summary/category/icon/hue/featured/role/slot]
│     └─ references/                [细则分册；正文用相对路径引用，缺文件即红]
└─ package.json                     [改（已完成）：deps 加 remotion / @remotion/media / @remotion/web-renderer@4.0.535]
                                     [★ route B 不需要 @remotion/renderer / @remotion/bundler / @remotion/cli / compositor-*]
```

> **依赖清单（v1.5 按 route B 修订）**：v1 写过的 `@remotion/test-renderer` **在 npm 不存在**，已删。`@remotion/media` 是 v4 官方推荐的视频组件包（`<Video>`，见 §7.3）。**route B 只装三个**：`remotion` + `@remotion/media` + `@remotion/web-renderer`（`package.json` 已装 4.0.535）；**不装** `@remotion/renderer` / `@remotion/bundler` / `@remotion/cli`，也不随包 `@remotion/compositor-*`（§7.6 正是切 B 的收益）。

**注意（route B 修订）**：`src/remotion/components/*` 是 `.tsx`。**route B 下不再由 Remotion 的 webpack 单独打包**，而是**并入客户端 bundle**，并被 `src/client/remotion-render.ts` 直接 `import`。因此主 `tsconfig` 与 `tsconfig.client.json` 要放行 `tsx` + `jsx`（已加独立 `tsconfig.remotion.json` 隔离校验，Host `tsconfig.json` `exclude` 掉 `src/remotion/components/**`，避免 Node16 解析报错）。

---

## 6. 核心：render_composition 工具规格（见 demo §3 集成插入点）

### 6.0 路线 B（CSR）总览 —— ⚠️ **本节已按路线 B 改写（v1.5，见 §0 R21）**

**结论先行**：走路线 B 后，`renderMediaOnWeb` 是**浏览器 API**（`@remotion/web-renderer`），而 `render_composition` 是**宿主侧 LLM 工具**（`host-tools.ts` 的 `createStudioTools`）。两者不在同一进程 ⇒ **控制流反转**：工具不能自己渲染，必须把「渲染工单」交给画布客户端（Electron 渲染进程）去跑，再把成片字节回写宿主。

这不是新造机制，而是复用已有两套现成的：

| 复用 | 现成物证 | 在本次扮演的角色 |
|---|---|---|
| **客户端轮询宿主队列** | `src/client/index.ts:1265` `pollGenerationQueue`（`QUEUE_POLL_MS=2000`，空闲即停）+ 宿主 `GET /canvas-studio/generate/queue` | 客户端据此**发现待渲染工单**（扩展出一个 `pendingRender` 字段/新路由） |
| **octet-stream 回写宿主** | `POST /canvas-studio/upload-media`（`src/routes.ts:2189`，`readRawBody` `:455`）→ `saveLocalAssetBytes`（`src/generate.ts:1110`） | 客户端把渲染出的 **mp4 blob 回写**宿主资产目录 |

> **为什么不用「隐藏 BrowserWindow」**：S8 spike 的 `app-csr/main.js` 证明「起一个专用窗口加载渲染页」可行且更干净（不占画布 UI、无 `pageResponsiveness`），但**画布插件的 Host 半没有创建 `BrowserWindow` 的能力**（Electron 外壳归 `dsh-plugin-desktop`）。要走这条路得先向 desktop 插件提一个「开隐藏渲染窗」的能力 —— **列为 D1 备选，不进 MVP**。

**谁触发**：两种入口共用同一条工单桥 ——
1. **agent 工具**：`render_composition(manifest)` → 宿主校验 → 建工单 → 等工单结算 → 落节点 → 返回 `ComposeToolResult`（§6.2）。
2. **UI 直接触发**（可选，MVP 不做）：画布上「导出成片」按钮 → 直接建工单。

**§6 的落点从「1 处」变成「3 处」**（§11 的登记表相应从 6 处扩到 8 处，见 §6.5）。

### 6.1 在哪里加
- **宿主工具**：`src/host-tools.ts` 的 `createStudioTools()`（L1270）返回 `defineTool[]`。在 `compose_video`（L2289）之后追加一个 `defineTool({…})`。
- **宿主工单桥**：`src/remotion/render-job.ts`（新）—— 工单状态机 + 存储 + 结算；路由挂在 `src/routes.ts`（`registerStudioRoutes` L542）。
- **客户端渲染器**：`src/client/remotion-render.ts`（新）—— 轮询工单 → `renderMediaOnWeb` → 回写 blob。

### 6.2 完整 defineTool 草稿
```ts
defineTool({
  name: 'render_composition',
  description:
    '用代码驱动合成（Remotion）把 CompositionManifest 渲染成成片——用于「字幕卡 / 数据卡 / 图文幻灯片 / 转场」等模型生成做不到的精确动画与排版。' +
    '它与 compose_video 并列：compose_video 只拼已有视频片段，本工具额外支持文本卡 / 形状 / 转场并逐帧精确控制。' +
    '入参 `manifest` 是一段 JSON 字符串（结构见 SKILL 的 CompositionManifest 字段口径），先经宿主校验、再经审批门（同 compose_video）。' +
    '渲染由画布客户端（Electron 渲染进程，Remotion Web 渲染器）完成，宿主只做校验/编排/落盘；成片作为 video-composite 节点落画布（血缘指向 manifest 引用的素材），返回与 compose_video 同形状的 url / 时长 / 分辨率 / 音轨构成 / nodeId。' +
    '⚠️ 仅当成品需要「非片段拼接」的卡片/动画/转场时才用本工具；纯片段拼接仍用 compose_video。',
  parameters: {
    manifest: { type: 'string' as const, description: 'CompositionManifest JSON 字符串（结构见 SKILL 字段口径）；解析/校验失败会显式报错且不渲染' },
    projectId: { type: 'string' as const, description: '可选：目标项目 id；缺省取当前会话项目' },
  },
  output: { schema: resultSchema, render: renderComposeResult }, // 复用 compose_video 的输出
  async execute(args, exec) {
    const a = args as { manifest: string; projectId?: string }
    const projectId = a.projectId ?? await resolveProjectId(registry, exec.agent?.session.header.cwd)
    await assertApprovalAllowed(registry, projectId, 'render_composition', false) // 复用审批门（host-tools.ts:748，同文件私有函数）
    // ⚠️ 另须把 'render_composition' 加进 src/approval-gate.ts 的 FORMAL_TOOLS（approval-gate.ts:65），否则门不认它 —— §0.5 R22
    // 1) 解析 + 校验（宿主侧纯函数，无浏览器 —— 与路线无关，B1 已完成）
    let parsed: unknown
    try { parsed = JSON.parse(a.manifest) } catch { throwError('CS-USER-ERR', { message: 'manifest 不是合法 JSON' }) }
    const validation = validateManifest(parsed)
    if (!validation.ok) throwError('CS-USER-ERR', { message: `manifest 校验失败：${validation.errors.join('；')}` })
    const manifest = parsed as CompositionManifest
    const audioComposition = deriveAudioComposition(manifest) // 宿主派生，非 Manifest 输入（§4.3）
    // 2) 素材核对（宿主侧，无浏览器，§8.2）：src 能否解析到项目内真实文件 + 真值时长（§10.4 的 warning 来源）
    const pre = await checkManifestAssets(manifest, registry.assetsDir(projectId)) // 复用 urlToAssetPath + probeMediaInfo
    // 3) 建「渲染工单」→ 等画布客户端渲染 → 收成片字节（§6.4 工单桥；★ 渲染发生在客户端，不在宿主）
    const job = await runRenderJob({ registry, projectId, manifest, fps: manifest.meta.fps,
      timeoutMs: 10 * 60_000,   // 工单超时：客户端长时间无响应/无客户端在线 ⇒ CS-RENDER-TIMEOUT
      signal: exec.signal,      // 会话中断 ⇒ 撤单（客户端下一轮轮询读到 cancelled 即 abort）
    })
    // job = { url, width?, height?, duration, warnings } —— 宿主在结算时落盘 + probeMediaInfo 探真值
    // 4) 复用 compose.ts 的落节点逻辑（★ 只在结算处做一次，勿与 runRenderJob 内部重复）
    const composedNode = await appendComposedVideoNode(registry, projectId, {
      url: job.url,
      duration: job.duration,
      audioComposition,
      ...(job.width !== undefined ? { width: job.width } : {}),
      ...(job.height !== undefined ? { height: job.height } : {}),
      sourceIds: collectManifestSourceIds(manifest),
    })
    // 5) 质量护栏：先只做「probe 真值核对 + 风险评分」；runShotQc 对成片是否适配待 §9.1 取证（不适配就走降级预案）
    const risk = scoreSlideshowRisk(manifest)
    const payload: ComposeToolResult = {
      url: job.url,
      width: job.width ?? COMPOSED_FALLBACK.width,
      height: job.height ?? COMPOSED_FALLBACK.height,
      duration: job.duration,
      nodeId: composedNode.id,
      clipCount: manifest.tracks.length,
      skippedCount: 0,
      audioComposition,
      warnings: [
        ...validation.warnings,
        ...(risk.score >= SLIDESHOW_RISK_WARNING_THRESHOLD ? [risk.warning] : []),
        ...pre.warnings,     // 素材缺失 / 时长偏差（§4.5 / §8.2）
        ...job.warnings,     // 渲染期告警（字体降级 / 编码降级 / 音轨缺失）
      ],
    }
    if (payload.warnings.length === 0) delete payload.warnings
    return payload
  },
}),
```

> **超时与撤单（route B 版）**：工单超时走 `throwError('CS-RENDER-TIMEOUT', …)`。撤单 = 宿主把工单置 `cancelled`，客户端下一轮轮询读到后 `AbortController.abort()` 中断 `renderMediaOnWeb` —— **route B 用标准 `AbortSignal`，不是 route A 的 `makeCancelSignal()`**（两套 API，别混用；§7.6 表末行）。
> **随之消失的两套纪律**：① route B 不 spawn headless-shell ⇒「杀残留浏览器进程」的纪律作废；② route B 不写 `renderDir`/不拷素材 ⇒ `finally rm(renderDir)` 的纪律作废（§8.1）。

### 6.3 内部流程（伪码，对应 §2.2）—— 宿主侧编排
```
runRenderJob({ registry, projectId, manifest, fps, signal, timeoutMs })
  1. 建工单（存 <projectDir>/.remotion-jobs/<jobId>.json，同 Drama 异步 jobs.json 的落盘纪律）：
       { id, projectId, manifest, fps, state:'pending', createdAt, warnings:[] }
  2. 循环等客户端（客户端轮询发现后自行渲染，见 §6.4）：
       every 1s: 读工单
         state==='done'     → 走 3)
         state==='cancelled'/超时 → 抛 CS-RENDER-TIMEOUT / CS-USER-ERR
         signal abort        → 写 state='cancelled'，抛中断错误（客户端会 abort）
  3. 结算（宿主侧，无浏览器）：
       a. 客户端已 POST 成片字节到 /canvas-studio/remotion/commit?jobId=…（§6.4 步骤 4）
          → 宿主 saveLocalAssetBytes()（generate.ts:1110）落 assetsDir，得 url
       b. probeMediaInfo(url 的本地路径)（ffmpeg-run.ts:278）探真值时长/分辨率
       c. 声明 vs 真值偏差（§10.4）→ 进 warnings；若 manifest.audio 需要混音，复用 buildAmixArgs/ffmpeg（同 compose_video）
          ⚠️ CSR 的 OpenH264 编码 bitrate 不可控（§7.6）；混音仍走项目随包 ffmpeg（与 Remotion 编码器无关）
       d. 删工单文件
  4. finally：无论成败删工单文件（不留悬挂 pending 工单——客户端空闲时会反复读到它）
  5. 返回 { url, width, height, duration, warnings }
```
> **不变量**：宿主侧**全程不开浏览器、不跑 webpack、不碰 Remotion 编码器**。宿主只做 JSON 校验、文件核对（ffmpeg probe）、工单编排、字节落盘、节点落画布。这是路线 B 的核心分工。

### 6.4 渲染工单桥（宿主 ⇄ 客户端；这是 route B 唯一的新机制）

**为什么需要**：`renderMediaOnWeb` 只在浏览器可用（§7.6），而工具在宿主。桥的三段：

| # | 方向 | 位置 | 动作 |
|---|---|---|---|
| 1 | 宿主建单 | `src/remotion/render-job.ts` | 工具调用时写工单文件（`state:'pending'`），带上`manifest`+`fps`+`jobId` |
| 2 | 客户端取单 | `src/client/index.ts` 扩展 `pollGenerationQueue` + 新路由 `GET /canvas-studio/remotion/pending?projectId=…` | 轮询发现 pending 工单 → 取 manifest → 调 `renderMediaOnWeb`（§6.4 下方代码） |
| 3 | 客户端回写 | `POST /canvas-studio/remotion/commit?jobId=…`（octet-stream，仿 `upload-media` L2189） | 回写 mp4 字节 + `{ width, height, durationSec, warnings }`；宿主落盘并置 `state:'done'` |

**客户端渲染调用（S8 实测用法，选项已验）**：
```ts
// src/client/remotion-render.ts（Electron 渲染进程内）
import { renderMediaOnWeb, renderStillOnWeb, canRenderMediaOnWeb } from '@remotion/web-renderer'
import { StudioComposition, EMPTY_MANIFEST } from '../remotion/components/Root.js'  // 复用同一组件（唯一事实源）

const composition = {                              // ← S8 实测形状：composition 描述符，不是 id 字符串
  id: 'studio-composition',
  component: StudioComposition,
  width: manifest.meta.width,                      // ★ 显式给四元组（route B 无「注册期静态值」问题，§7.2 坑 3 在此不适用）
  height: manifest.meta.height,
  fps: manifest.meta.fps,
  durationInFrames: manifest.meta.durationInFrames,
  defaultProps: { manifest },
  calculateMetadata: null,                         // 时长已算好；不需要在渲染期再跑
}
const ac = new AbortController()                   // 撤单：宿主置 cancelled 时客户端 abort()
const res = await renderMediaOnWeb({
  composition,
  inputProps: { manifest },
  container: 'mp4',
  videoCodec: 'h264',                              // OpenH264 软编；★ bitrate 类参数不生效（§7.6）
  outputTarget: 'arraybuffer',                     // ★ 不回退到 web-fs（web-fs 需用户手势，不能后台自动落盘，§7.6）
  signal: ac.signal,
  onProgress: (p) => reportProgress(p.progress),   // 驱动画布上的进度条/角标
})
const blob = await res.getBlob()                   // 关键帧剧照用 renderStillOnWeb({composition, frame}) → res.blob({format:'png'})
// → POST 到 /canvas-studio/remotion/commit?jobId=…（body = blob）
```
> **`canRenderMediaOnWeb` 预检**：渲染前先跑一次（容器/编码/尺寸），不通过则把原因回写宿主进 `warnings`（不静默）。S7 实测本机 `canRender: true`。
> **`<Video>`/`<Audio>` 仍是唯一未验项（S9）**：CSR 只支持 `@remotion/media` 的这俩组件（我们已选它）；若 S9 证伪，则 route B 出不了带音轨的成片，须回退 route A（§7.6 决策建议第 4 条）。
> **`pageResponsiveness`**：默认会让出主线程（渲染慢但不卡 UI）；route B 的代价就是渲染时占用渲染进程 —— 用进度条 + 让出策略对冲，不追求 route A 的完全隔离。

### 6.5 复用点清单（务必复用，不重新发明）
- `resolveFfmpegPath()` — `ffmpeg-run.ts:128`（**仅用于混音步骤与外层探测**；不喂 Remotion，§0 R1）
- `appendComposedVideoNode()` — `compose.ts:628`（落 video-composite 节点 + 版本链 + 血缘避让）
- `ComposeResult` / `ComposeToolResult` / `renderComposeResult` — `compose.ts:63` / `host-tools.ts:162` / `host-tools.ts:250`（`resultSchema` 在 `:67`）
- `urlToAssetPath()` — `compose.ts:118`（资产反查）
- `bgmShortfallMessage()` / `buildAmixArgs()` — `compose.ts:253 / 281`（混音守卫与参数）
- `assertApprovalAllowed()` — 审批门，与 compose_video 同口径（定义 `host-tools.ts:748`）。⚠️ **光调它不够**：**工具名必须同时登记进 `src/approval-gate.ts` 的 `FORMAL_TOOLS`**（`approval-gate.ts:65`），否则 `approvalGateMessage()` 对该工具恒返回 `null`，审批门形同虚设（**见 §0.5 R22，这是真实踩过的后门**）
- **门禁表登记（新增工具务必照做）** — `src/approval-gate.ts`：`FORMAL_TOOLS`（走审批门的工具名单，自动并入 `PRODUCING_TOOLS`）；配套 `tests/approval-gate.test.mjs` 的 `FORMAL`/`DIRECT` 两个数组需同步加入该工具（该测试第 8 条会**扫源码**逐个验证 `DIRECT` 工具真的调了 `assertApprovalAllowed(registry, projectId, '<tool>'`）
- `probeMediaInfo()` — `ffmpeg-run.ts:278`（成片真值 + 素材轨时长核对，§4.5）
- `list_shots`（工具，非函数） — video 轨时长的唯一合法来源（§4.5）

**不复用（外部自带，别去"优化"它）**：
- 渲染编码器：**route B 用 `@remotion/web-renderer` 的 OpenH264/WASM 软编**（在客户端）。~~route A 的 `@remotion/compositor-<platform>` 平台二进制（自带 ffmpeg+libav*）在 route B 下不再随包~~（§7.6）。
- 浏览器：**route B 复用 Electron 自带 Chromium（150）**，不下 headless-shell、不传 `browserExecutable`（§7.5 已作废，§7.6）。

### 6.6 返回结构
与 `compose_video` **完全相同**（`ComposeToolResult`），客户端零改动即可展示成片节点、时长、分辨率、音轨构成角标。

### 6.7 集成登记点（route B 后从 6 处扩到 8 处）
§11 的原 6 处仍适用（工具表两份 + 计数 24→25 + skill 快照 + STATUS/README 文案），**新增 2 处**：
1. `src/routes.ts` 加 3 条路由常量 + handler（`remotion/pending` / `remotion/commit` / 可选 `remotion/cancel`）。
2. `src/client/index.ts` 的 `pollGenerationQueue` 扩展（待渲染工单并入轮询，**空闲即停**纪律不变 —— 无工单时不发请求）。

---

## 7. Remotion 渲染层实现

### 7.1 渲染管线（技术核心，见 demo §2 关键帧色块示意）—— **route B（CSR）版**

> ⚠️ 本节下方原为 route A（SSR）管线；**已按路线 B 改写**（v1.5，见 §0 R21）。route A 版见 §7.6 表；若要回退，按 §7.6 决策建议第 4 条。

```
组件源码(.tsx)  ← src/remotion/components/**（唯一事实源）
  → 【宿主】render_composition 工具：校验 manifest → 建渲染工单（§6.4）
  → 【客户端 · Electron 渲染进程】轮询发现工单
       → renderMediaOnWeb({ composition: { id:'studio-composition', component: StudioComposition,
            width/height/fps/durationInFrames（取自 manifest.meta）, defaultProps:{manifest} },
            container:'mp4', videoCodec:'h264', outputTarget:'arraybuffer', signal })
            ├─ 无 bundle / 无 webpack（CSR 直接吃 React 组件）
            ├─ 无独立浏览器（复用 Electron Chromium 150）；无 headless-shell
            ├─ 逐帧：设 frame → React 重渲染 → take-screenshot（allowHtmlInCanvas / shared-memory）
            └─ 帧序列 → OpenH264/WASM 软编 → H.264（bitrate 不可控，§7.6）
       → res.getBlob() → POST octet-stream 回写宿主（§6.4 步骤 3）
  → 【宿主】saveLocalAssetBytes 落 assetsDir → probeMediaInfo 探真值 →（如需）项目 ffmpeg 混音 → appendComposedVideoNode
```
**与 route A 的关键差异**：① 无 webpack bundle 步骤；② 无 headless-shell 子进程；③ 渲染在客户端而非宿主（故有工单桥）；④ 素材直接同源取用（无 `renderDir`/`staticFile`，§8.1）；⑤ 渲染显式给 `width/height/fps/durationInFrames`（route A 的 `calculateMetadata` 坑在此不适用，但 `Root.tsx` 仍保留它供 Studio 预览）。

### 7.2 三个必踩的坑（写组件时逐条防）
1. **每帧无状态**：`useState` 永远初始值、`useRef` 跨帧丢失、`useMemo([])` 每帧重算。所有"随时间变化"的状态必须用 `useCurrentFrame()` + 纯函数推导（OpenMontage / Remotion 文档明确）。**route A/B 通用。**
2. **shared-memory capture**：Remotion 4.0.534+ 默认走共享内存把位图直接交给编码器，跳过 JPEG 压缩，速度快且无色差；无需手动配置，但要知道它存在（避免误加 `imageFormat: 'jpeg'` 降质）。需 macOS 15 + Apple Silicon 或较新 Linux glibc 才启用，其余平台自动回退普通截图 —— **不作为正确性依赖**。（route B 下对应 `allowHtmlInCanvas`，S8 实测本机可用。）
3. **动态时长必须显式给对**（§0 R5）：route A 的 `<Composition>` 四元组是**注册期静态值**，只有 `calculateMetadata` 能覆盖 → 漏写就「30s 的 manifest 出 10s 的片」。**route B 的等价纪律**：`renderMediaOnWeb` 的 `composition` 描述符必须**显式传** `width/height/fps/durationInFrames`（取自 `manifest.meta`，见 §6.4）；`calculateMetadata` 置 `null` 以免渲染期再跑。

### 7.3 组件库清单（MVP 最小集）
| 组件 | 职责 | 对应 Manifest track |
|---|---|---|
| `Root.tsx` | 注册**固定 id** 的 `<Composition id="studio-composition">`，并通过 **`calculateMetadata`** 从 `inputProps.manifest.meta` 覆盖 `durationInFrames/fps/width/height`（见下方代码）；`<AbsoluteFill>` 遍历 tracks，按帧激活 | 顶层 |
| `VideoClip.tsx` | **`<Video>` 来自 `@remotion/media`**（v4 官方推荐；不再用 `remotion` 包的 `<Video>`，`<OffthreadVideo>` 属旧路径）+ transform + 可选 Ken-Burns。**★ 段长改用外层 `<Sequence from durationInFrames>` 控制**（R20：该包的 `Video` **没有** `durationInFrames` prop） | `video` |
| `ImageClip.tsx` | `<Img>` + fit(cover/contain) + kenburns + 可选 caption 条 | `image` |
| `TextCard.tsx` | subtitle / dataCard / title / bullets 四态 | `textCard` |
| `Shape.tsx` | rect / circle / line / gradient（百分比坐标） | `shape` |
| `Transition.tsx` | fade / slide / zoom / dissolve（重叠区插值） | `transition` |

> ⚠️ **媒体组件的坑（v1.5 修正，见 §0 R20）**：v1.1 写的「`<Video>` 显式传 `durationInFrames`」**在 `@remotion/media@4.0.535` 上不成立** —— 该组件的 props 里**没有** `durationInFrames`（只有 `trimBefore`/`trimAfter`）。段长由**外层 `<Sequence from durationInFrames>`** 的边界控制（`Root.tsx` 已如此）；「轨道错位 / 末帧冻结」由 §10.4 的时长核对（声明对齐真值）+ Sequence 上界共同保证。这条与路线无关（A/B 都要这么写）。

**`Root.tsx` 关键实现（calculateMetadata，v4.0.0+，§0 R5）**：
```tsx
// src/remotion/components/Root.tsx
import { AbsoluteFill, Composition, getInputProps } from 'remotion'
import type { CompositionManifest } from '../manifest'

const StudioComposition: React.FC<{ manifest: CompositionManifest }> = ({ manifest }) => (
  <AbsoluteFill style={{ backgroundColor: manifest.meta.backgroundColor ?? '#000' }}>
    {/* 遍历 manifest.tracks，按 frame 激活（TextCard / VideoClip / ImageClip / Shape / Transition） */}
  </AbsoluteFill>
)

export const Root: React.FC = () => (
  <Composition
    id="studio-composition"          // ★ 固定 id，与 manifest.id 无关；render_composition 只认它
    component={StudioComposition}
    // 下面四个是「缺省值」，会被 calculateMetadata 的返回值覆盖 —— 但仍必须给（否则 TS/运行时报错）
    durationInFrames={300}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{ manifest: EMPTY_MANIFEST }}
    calculateMetadata={({ props }) => {
      const { meta } = props.manifest
      return {
        durationInFrames: meta.durationInFrames,   // ★ 动态总时长
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
        // 也可顺带 props: 派生值（如预处理后的轨数组）
      }
    }}
  />
)
```
> 该函数**可异步**（收 `{defaultProps, props, abortSignal, compositionId, isRendering}`，返回 `{durationInFrames, fps, width, height, props}`），但**本项目保持同步纯函数**——时长已在 Manifest 里算好，宿主不需要在渲染期再访问网络或文件（异步版会在每个 render worker 里重复执行，官方不推荐）。
> `selectComposition()` 调用时会执行它；`renderMedia()` 消费 `selectComposition` 的返回对象（§6.3 步骤 2–3）。

### 7.4 组件签名草图（节选）
```tsx
// src/remotion/components/TextCard.tsx
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import type { TextCardTrack } from '../manifest'

export const TextCard: React.FC<{ track: TextCardTrack; fps: number }> = ({ track, fps }) => {
  const frame = useCurrentFrame()
  const local = frame - track.startFrame
  // 进入淡入（前 6 帧）、退出淡出（后 6 帧）—— 纯函数派生，无状态
  const opacity = interpolate(local, [0, 6, track.durationInFrames - 6, track.durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (!isTrackActive(track, frame)) return null   // 半开区间，见 §0.3 R19（勿写 local > durationInFrames）
  return (
    <AbsoluteFill style={{ opacity, justifyContent: 'center', alignItems: 'center', background: track.variant === 'title' ? 'rgba(0,0,0,0.55)' : 'transparent' }}>
      {/* subtitle / dataCard / title / bullets 四种布局按 variant 分支渲染 */}
    </AbsoluteFill>
  )
}
```

### 7.5 浏览器来源决策（决定打包复杂度，见 §15）

> 🛑 **本节仅适用于 route A（SSR）。路线已拍板走 B（v1.5，§0 R21）⇒ 本节整体作废**：route B 复用 Electron 自带 Chromium，**不下 headless-shell、不传 `browserExecutable`、无 `ensureBrowser()`**。保留此节仅为「万一 S9 证伪须回退 route A」时备查。

> **v1.1 结论改写（§0 R3）**：v1 的"复用 Electron 打包的 Chromium"方案**不建议再做**，理由三条，全部有官方依据：
> ① Remotion 4.0.247+ 默认使用 **Chrome Headless Shell**（不是完整 Chrome），下载到 `node_modules/.remotion/chrome-headless-shell/<platform>/chrome-headless-shell`，旁边写 `VERSION` 文件；**版本不符时 Remotion 会主动删除并重下** —— 外部塞进来的二进制会被"纠正"掉。
> ② 官方明文警告：不要用 `browserExecutable` 覆盖成不兼容的 Chrome 版本，"rendering behavior may differ … and may be less deterministic"。
> ③ Electron 的 Chromium 不是独立的 chrome 二进制（是 `Electron Framework` 内的库 + 宿主可执行文件），本就不在 Remotion 支持的输入范围内。
> 另外 v1 的「+150MB」是按**完整 Chrome for Testing**估的量级；headless-shell 更小（**确切数值待阶段 0 实测**），所以"省 150MB"这个收益本身也是虚的。

| 来源 | 状态 | 说明 |
|---|---|---|
| **A. Remotion 自管 Chrome Headless Shell（✅ 已定案）** | ✅ 官方支持 | API 侧零配置（**不传** `browserExecutable`）。**实测**：期望版本 **157.0.8080.0**（源码 `TESTED_VERSION`）；zip **104MB → 解包 210MB**；官方源 20 KB/s 不可用 ⇒ 走镜像 |
| **B. 复用 Electron 的 Chromium** | ❌ **已实证不可行（S5，2026-10-15）** | 实测把 Electron 43.4.0 的 `MacOS/Electron` 当 `browserExecutable` 传进去 → **`Timed out after 25000 ms while trying to connect to the browser!`** 且进程 hang。机制层面不成立：`MacOS/Electron` 只是 **13 KB launcher**，实现是 `Electron Framework.framework/.../Electron Framework`（**203 MB 共享库**，非独立可执行文件），被 spawn 后启动的是 Electron 运行时（找 app / 等 GUI），**不提供 CDP 端点** |
| **C. 随包预置 headless-shell** | ⚠️ **可选路径（+体积）** | 即 `spike-remotion/pipeline/s0b-prefetch-browser.sh` 的产物。**体积构成实测（§2.4）**：解包 **210 MB = 187 MB 主二进制（不可裁）+ 11 MB `icudtl.dat` + ~12 MB 其它** ⇒ **无裁减空间**，且必须 `asarUnpack`。**三条降体积路径见 §7.5.1** |

**✅ 阶段 0 已完成（2026-10-15）**：① 镜像方案实测成立（官方源本机 20 KB/s 不可用 → npmmirror 的 `chrome-for-testing` 镜像 **1:1 同构换前缀**，26 MB/s / 4s）；② `ensureBrowser()` 在预置正确后 **0.0s 命中**（关键是 `VERSION` 文件）；③ 落地方案已脚本化（`spike-remotion/pipeline/s0b-prefetch-browser.sh`）；④ **S5 实测：复用 Electron 的 Chromium 不可行**（见上表 B，已有错误证据）。**仅剩**"Electron 主进程内能否跑通 / 是否需显式 `binariesDirectory`"需用户终端验（§13 阶段 0）。

### 7.5.1 包体决策（⚠️ **route A 专用；route B 下不存在此问题**）

> 🛑 **route B 不需要 headless-shell，也不随包 `@remotion/compositor-*`（无 `@remotion/renderer` 依赖链）⇒ 本节四个方案全部作废，包体增量 ≈ +0**（§7.6 表）。仅 route A 回退时参考。

| 方案 | 包体增量 | 代价 / 风险 | 对 NFR-2（离线）的影响 |
|---|---|---|---|
| **① 随包完整 headless-shell** | **+210 MB**（必须 `asarUnpack`，不可压缩） | 包体最大 | ✅ 满分 |
| **② 随包压缩 zip（104 MB）+ 首次启动解包到 `userData`** | **+104 MB**（磁盘仍 +210 MB） | 首次启动多几秒解包；zip 仍需 `asarUnpack` | ✅ 仍离线可用 |
| **③ 不随包，首次运行时从镜像下载** | **+0** | 首次渲染前需联网（镜像 26 MB/s ⇒ 约 4 s） | ⚠️ 需放宽为"**首次联网后**离线可用" |
| ~~④ 复用 Electron Chromium~~ | ~~+0~~ | ❌ **S5 已实证不可行** | — |

> **不要寄希望于**「④ 复用 Electron」（机制不成立）或「裁减 headless-shell」（187 MB 主二进制不可裁）。
> 建议：离线首启为硬需求 → **②**；可接受首次联网 → **③**。
> **另注**：`@remotion/compositor-<platform>` 也要随包（**x64 25M + arm64 17M = 42M**，通用包两份），且**必须 `asarUnpack`**（内含 dylib）。

### 7.6 路线对照与决策（v1.3 新增，见 §0 R17；v1.5 **已拍板 B**）

> ✅ **v1.5 决策已定：走路线 B（CSR / `@remotion/web-renderer`）**，§6/§7.1/§8 均已按 B 改写。唯一残留前置是 **S9（`<Video>`/`<Audio>` 在 CSR 下的表现）须在用户终端验**；若 S9 证伪则按下方第 4 条回退 route A（§6/§8 的 route A 版可从 git 历史取回）。

> ⚠️ **本文 §6/§7.5/§8 的全部实现规格都建立在「路线 A：SSR」之上**（已由 S1–S4 全链路验证）。S6 发现了**路线 B：CSR**，它可能更优，但**尚需在 Electron 里验证**才可切换。

| 维度 | **路线 A：SSR**（`@remotion/renderer`） | **路线 B：CSR**（`@remotion/web-renderer`） |
|---|---|---|
| 验证状态 | ✅ S1–S4 全绿（Intel Mac） | ✅ **S7 实测可用**（Electron 43 / Chromium 150：真渲 1s mp4 15545 B / 2166 ms，h264+aac 可用，`canRender:true`） |
| 浏览器 | headless-shell **+210MB** | **Electron 自带 Chromium（150）+0** |
| 平台二进制 | `@remotion/compositor-*` **+42MB** | **+0**（依赖链不含 `@remotion/renderer`） |
| webpack / 预构建 bundle | 需要 | **不需要**（"No bundling step"） |
| 渲染位置 | Node 侧 + 独立浏览器进程 | **Electron 渲染进程**（会占用 UI，有 `pageResponsiveness`） |
| **性能（实测）** | ~**90 ms/帧** @1280×720（Intel、无 shared-memory capture） | **13 ms/帧** @1280×720（暖机后；225 帧 3.03s）⇒ **快约 7 倍**；30s 片 ≈ 12s（SSR ≈ 75–90s） |
| CSS 能力 | 完整（真截图） | **受限子集**：**`z-index` 不支持**（靠 DOM 顺序）、`object-position`/`writing-mode`/blend/inset 阴影不支持 |
| 编码 | Remotion 自带 ffmpeg + x264（**`videoBitrate` 可控**） | **OpenH264 软件编码**（实测日志有 `bitrate can't be controlled …` ⇒ **bitrate 类参数可能不生效**，画质控制弱） |
| 字体 | 自托管 `@font-face` 可行（§8.3，S1 已验证 `delayRender` 闸门） | ⚠️ SVG 内文本不嵌字体；**HTML 文本待实测**（§九 补验 1） |
| 媒体组件 | 任意（但推荐 `@remotion/media`） | **仅 `@remotion/media`** 的 `<Video>`/`<Audio>`（✅ 我们已选它） |
| 输出 | 直接落盘 mp4 | blob / `outputWritable` 流 ⇒ 需 IPC 回写主进程；**默认 `outputTarget` 是 `web-fs`（需用户手势）⇒ 不可用于后台自动落盘** |
| 包体合计 | **≈ +250MB** | **≈ +0** |
| 取消 | `makeCancelSignal()` 的 `CancelSignal` | **标准 `AbortSignal`**（两套 API 不同，别混用） |

**决策建议（S8 后更新：三项补验全过）**：
1. **✅ 强烈建议切 CSR（路线 B）** —— 三项补验已过（**观感用户认可 + 字体 `loaded:true` + 性能 13 ms/帧，比 SSR 快约 7 倍**），收益叠加：省 250MB 包体 + 去掉 webpack/预构建 bundle/浏览器预置/字体预置一整套 + **渲染快 7 倍**（30s 片 ≈12s，体验从"分钟级等待"变成"十几秒"）。
2. **切换前唯一剩余未验项**：**`<Video>`（模型 clip）+ `<Audio>`（旁白/BGM）** 在 CSR 下的表现（spike 报告 §9.2 的 S9）。CSR 文档声明支持这两个组件，但产品主素材形态必须实测 —— 尤其**音视频 mux 出带音轨的 mp4**。
3. **切换的改造面**（✅ v1.5 已完成）：§6 工具实现（`renderMediaOnWeb` + 工单桥取代三步链）、§7.1 管线、**§7.3 组件（DOM 顺序控层叠、去 z-index —— 本就如此）**、§8（放弃 `renderDir`/`staticFile` 注入 → 客户端同源直取 + blob 回写）、§8.3 字体方案（改 `@font-face` + 同源/内联，链路 S8 已验证）、§12 测试形态（不再需要"浏览器可用"gate）。
4. 若 S9 暴露 `<Video>`/`<Audio>` 不可用 ⇒ 维持路线 A（已全绿）+ §7.5.1 包体三选一。

> **当前实现规格的处置**：✅ **v1.5 已完成**：§6（工具/工单桥/客户端渲染调用）、§7.1（管线）、§8（资产直取 + 字体）已全部改写为**路线 B**；§7.5/§7.5.1 标注为 route-A-only 作废。组件侧本就零 `z-index`（DOM 顺序控层叠），切换无返工。

> **组件设计的防御性建议（无论走哪条路线都做）**：`§7.3` 的组件**不要依赖 `z-index`**，一律用 DOM 顺序控制层叠 —— 这样将来切 CSR 时组件无需返工。

---

## 8. 资产喂入方案（见 demo §2 资产段）—— **route B（CSR）版**（v1.5，见 §0 R21）

> 🛑 **本节原为 route A 的 `renderDir` / `staticFile()` 模型（依赖 `bundle({ publicDir })`），路线 B 下整个作废并改写。** 下面 route-A 残留说明仅作回退备查（折叠保留）。

route B 下渲染发生在 **Electron 渲染进程**，页面与素材**同源**，因此**不需要任何"把素材拷进渲染工作目录"的动作**：

- 组件里的 `src` **直接用 Manifest 里的同源 URL**（`/canvas-studio/assets/<projectId>/<file>`）——`<Img>`、`@remotion/media` 的 `<Video>`/`<Audio>` 都能同源 fetch。原「方式 A 的跨源顾虑」只在 route A 的独立 Chrome（非 Electron、不同端口）下成立；**route B 无此问题**。
- **没有** `renderDir`、**没有** `staticFile()`、**没有** bundle、**没有** `publicDir`。Manifest 的 `src` 原样透传给客户端，宿主不改写。

<details><summary>route A 旧模型（`renderDir` + `staticFile()`，已作废，保留备查）</summary>

- **方式 A（直连 webServer URL）**：route A 下组件 src 指向 `http://127.0.0.1:PORT/...`，与 Remotion 自带 serveUrl 跨源，需 `disableWebSecurity` 或 CORS —— 放弃。
- **方式 B（静态目录 + `staticFile()`）**：把素材用 `urlToAssetPath`（`compose.ts:118`）反查本地路径，落到 `<renderDir>/public/cs-assets/`（`staticFile()` 的解析根是 `<bundle>/public/`，Spike §0 R13 实测），组件写 `staticFile('cs-assets/<name>')`。**route A 选它**：脱离 webServer、可离线、可复现。
  > ⚠️ route A 关键前提：`publicDir` 只在 `bundle()` 时生效 ⇒ 「发行版预构建 bundle」与「每次渲染喂 `publicDir`」不能并存 ⇒ 统一成 `renderDir` 模型。**路线 B 下这套全部不需要。**

</details>

### 8.1 route B 资产模型（替代原 `renderDir`）

```
Manifest（宿主）                         客户端渲染（Electron 渲染进程）
  tracks[].src = "/canvas-studio/assets/p1/x.mp4"  ──原样透传──▶  <Video src={track.src} />   ← 同源 fetch
  audio.bgmUrl / voiceOverUrl                        ──原样透传──▶  <Audio src={…} />          ← 同源 fetch
  global.fonts[].family                              ──同源路由/内联──▶ @font-face { src: url(…) } ← §8.3
```
> **无拷贝、无临时目录** ⇒ route A 的 `link`/`copyFile`/`EXDEV`/`finally rm(renderDir)` 一整套纪律**全部消失**。素材读取由浏览器网络栈负责（宿主资产路由已支持流式/Range，画布预览本就在用）。

### 8.2 落地函数（改为「只核对、不拷贝」）

```ts
// src/remotion/asset-check.ts（宿主侧，无浏览器）
export interface AssetCheck { warnings: string[] }
export async function checkManifestAssets(manifest: CompositionManifest, assetsDir: string): Promise<AssetCheck> {
  const warnings: string[] = []
  for (const track of manifest.tracks) {
    if (!('src' in track) || !track.src.startsWith('/canvas-studio/assets/')) continue
    const local = urlToAssetPath(assetsDir, track.src)        // 复用 compose.ts:118
    if (!existsSync(local)) { warnings.push(`素材缺失：${track.id} → ${track.src}（渲染将失败）`); continue }
    if (track.type === 'video') {                             // 时长核对（§4.5 / §10.4）
      const real = await probeMediaDuration(local).catch(() => undefined)   // ffmpeg-run.ts
      const check = reconcileVideoDuration(track.durationInFrames, real, manifest.meta.fps)
      if (check.warning !== undefined) warnings.push(check.warning)
    }
  }
  return { warnings }
}
```
> **与 route A 的区别**：不再返回 `staged`（src 无需重写）、不再返回 `renderDir`、不再调用 `resolveFonts` 落盘。组件永远只见**原 Manifest**（同源 URL），宿主只提供**告警**。
> **素材缺失**：route A 时 `link` 失败即抛错；route B 无法在宿主侧阻止渲染失败（客户端 fetch 才暴露），故 `checkManifestAssets` 提前把"缺失"作为 warning 抛出（仍会被工具返回，agent/用户可见），是否阻断由 `validateManifest` 阶段决定（§4.3 已按 URL 形态校验，存在性此处补）。

### 8.3 字体方案（已定：方案 C 混合，含多语言扩展；落地模块 `src/remotion/fonts.ts`）

问题背景：headless Chromium 里 `fontFamily: 'PingFang SC'` 在非 macOS / 未装该字体的用户机上会静默 fallback（观感事故）；且产品规划要支持多语言，单一随包字体不够。三方案对比后取 C：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 全随包 | 离线 100% 可用 | 10 种语言字体几十 MB，包体爆炸 |
| B. 纯动态下载 | 包体零增量、语种无限 | 渲染时无网翻车；Google Fonts 国内不稳 |
| **C. 混合（已定）** | 中文离线兜底 + 其他语种灵活可扩展 | 多一套缓存逻辑 |

**方案 C 落地要点**：
1. **随包兜底**：思源黑体（Source Han Sans，**OFL 许可**，允许嵌入与随产品分发）**子集**——按常用字表子集化为 woff2（1–3MB 级），构建脚本产出。**route B**：产物随客户端打包（或由宿主 `/canvas-studio/remotion/fonts/…` 只读路由提供），渲染前 `@font-face` 以同源 URL/`data:` 注入（§8.3 第 4 条）。缺省 `fontFamily` 指向随包子集，保证离线/无网必能出片。
2. **动态下载（多语言扩展）**：Manifest 通过 `global.fonts[]`（§4.2 `ManifestFont`）声明额外字体。宿主解析顺序：
   - 命中随包子集 → 直接用；
   - 未命中 → 从**自托管源**下载（建议 Drama 后端加 `/fonts/<family>-<weight>.woff2` 静态路由，托管 OFL 字体族，如 Noto Sans / Noto Serif 各语种子集）；
   - 下载落盘到应用数据目录字体缓存（Electron `app.getPath('userData')/fonts/`），**命中缓存不重复下载**，二次渲染离线可用；
   - 下载失败 → 随包字体 fallback + warning 进 `ComposeToolResult.warnings`，**不阻断渲染**。
   - 不直接依赖 `@remotion/google-fonts`（其机制可参考——`@font-face` + `delayRender` 等字体就绪再截图——但其打 Google 域名，国内不稳，故自托管等价实现）。
   > ⚠️ **前置依赖标注（v1.1 新增）**：本项**不是本仓可独立完成的闭环**——它依赖「Drama 后端新增 `/fonts/` 静态路由」这条**外部需求**。因此：
   > - **MVP（阶段 0–5）只依赖随包子集**，离线闭环不依赖任何外部改动；
   > - 下载链路整体**不排进 MVP 关键路径**，作为阶段 6 之后的可选增量；未落地时行为 = fallback + warning（已定义，不阻断）；
   > - 若要进 MVP，须先向后端提需求并拿到接口承诺——**别让"字体下载"卡住 render_composition 主体**。
3. **加载闸门**：所有 `@font-face` 声明配 Remotion `delayRender()` / `continueRender()`——字体（含下载中的）未就绪不截图，防空白帧 / 半截字（§7.2 无状态坑的配套纪律）。**route B**：在客户端渲染前 `await document.fonts.load('48px <family>', 探针字)` 再 `continueRender()`（S8 已用此方式换来 `document.fonts.check === true`）。
4. **注入点（route B 改写）**：~~`resolveFonts(staged, targetRoot)` 在 §8.2 `prepareRenderDir` 内落盘~~ → 改为**客户端渲染前置步骤**：`resolveFonts(manifest)` 返回需要的字体清单（随包子集可直接用；额外字体走下载缓存，§8.3 第 2 条），客户端把文件以**同源路由**（`/canvas-studio/remotion/fonts/<name>.woff2`，宿主新增只读路由）或 `data:` URL 注入 `<style>@font-face{src:url(…)}</style>`。下载失败项进 `warnings`（§6.2 并入结果）。
   > ⚠️ 生成的 `@font-face { src: url(…) }` 必须与页面**同源**（route A 是 `staticFile('cs-assets/…')`，route B 是 `/canvas-studio/remotion/fonts/…` 或 data:），否则字体静默 404 → 回退系统字体 → 中文字幕卡观感事故（这是最容易漏的一处）。S8 已用绝对同源路径 `/public/fonts/…` 验证链路成立。
5. **体积纪律**：优先子集化（中文常用字表、拉丁基本区）；全量字体只在用户显式选择时下载，不做全量随包。
6. **许可**：思源黑体 / Noto 系均为 SIL OFL 1.1，允许嵌入、缓存与再分发，无商业限制（与 Remotion License 问题无关，勿混淆）。

---

## 9. 质量门禁扩展（见 demo §4 功能缺口）

### 9.1 复用现有
`quality-check.ts` 的 `runShotQc`（L217）**原本是镜头（shot）质检**，其入参/假设是按"分镜 + 相机运动 + 单镜头时长"设计的；`render_composition` 的产物是**合成成片节点**（video-composite），语义并不天然对齐。

- **阶段 5 前置取证（v1.1 新增，别默认可用）**：先读 `runShotQc` 的实际入参形状与内部假设，确认它对"成片节点"是否①能接受（不抛错）②结论是否有意义（例如它若强依赖分镜元数据，对成片会输出无意义的通过/告警）。
- **降级预案**：若不适配 → 不硬塞。改为「成片只跑 `probeMediaInfo` 真值核对（时长/分辨率/音轨）+ §9.2 风险评分」，`runShotQc` 留给镜头；并在 `ComposeToolResult.warnings` 里如实说明"成片未做镜头级质检"。**绝不允许为了复用而让质检产出假结论。**

### 9.2 新增：幻灯片风险评分（确认缺失项，OpenMontage 6 维）
现状 `quality-check.ts` **没有**"一堆图假装视频"的防呆评分（grep 证实无 `slideshow` / `riskScore`）。新增 `src/remotion/slideshow-risk.ts`：

```ts
// src/remotion/slideshow-risk.ts
export interface SlideshowRisk {
  score: number        // 0–100，越高越像"假视频"
  /** score ≥ 60 时给出的用户可见告警文案（并入 ComposeToolResult.warnings）。 */
  warning?: string
  dims: { name: string; weight: number; hit: boolean; note: string }[]
}
/**
 * OpenMontage 6 维防"幻灯片伪装视频"：
 * 1) 静态占比：图片/文本卡总时长 ÷ 成片时长 > 70% → 高风险
 * 2) 运动密度：video 轨道数 < 1 或总视频时长占比 < 20% → 风险
 * 3) 转场多样性：全部是 fade / 无转场 → 风险
 * 4) 镜头数：shots < 3 → 风险（时长越长阈值越高）
 * 5) 字幕/解说覆盖：无 voiceOver 且无 textCard → 风险
 * 6) 节奏单调：各轨道时长标准差 < 阈值（全是等长卡）→ 风险
 */
export function scoreSlideshowRisk(manifest: CompositionManifest): SlideshowRisk { /* ... */ }
```
阈值建议：score ≥ 60 → warning（"成片偏向幻灯片，建议增加实拍/生成视频片段"）；不阻断，进 `ComposeToolResult.warnings`。

### 9.3 CLI 预合成验证（选做，阶段 5）
`@remotion/cli` 支持不用 Node API 直接验合成是否可渲染，适合做"组件改坏了没有"的快速探针：
```bash
# 用假 manifest 渲第 0 帧（除 Chrome Headless Shell 外无额外依赖），能出 PNG 就说明 bundle + 组件不崩
npx remotion still studio-composition /tmp/probe.png --props=/tmp/fake-manifest.json
```
可加一个 `scripts/verify-composition.mjs` 包住它，供阶段 2/3 快速自检（不进自动门禁：需要浏览器，见 §12.4 gate 口径）。

---

## 10. 新增 skill：code-driven-explainer（见 demo §1 B 路）

### 10.1 SKILL.md 结构（**v1.2 修订，见 §0 R8/R9**）

> ⚠️ **落笔前必读**：新增 skill 现在受 `skill-expansion-spec.md`（CV-317~326 新规）管辖，三道新门禁会直接判红：
> ① **不得自设 HITL 门**（`skill-progressive-disclosure.test.mjs`）——既禁退役工具名 `submit_screenplay` / `submit_storyboard_for_approval`，也禁"确认后才生成"这类**流程门**表述；`ask_user_choice` **只允许用于需求澄清**。
> ② **入口 ≤12 KB**（`SKILL.md` 本体），细则必须下沉 `references/`，且分册之间互引不许断链。
> ③ **工具名对账**（`skill-tool-refs.test.mjs`）——正文出现的 snake_case 工具名必须在真实注册表里 ⇒ **`render_composition` 必须先注册、或与 skill 同批提交**。
>
> 另需 `platform.yaml`（九必填字段）与 `src/skill-catalog.ts` 的 `BUNDLED_CATALOG` 快照，见 §11 门禁 4/5。

- **trigger**：用户意图命中"科普 / 教育 / 数据可视化 / 带字幕卡的视频"。
- **审批语义（改）**：**不在本 skill 里写审批门**。审批唯一事实源是 `canvas-studio-creation` 总纲；本路径的放行由 **`render_composition` 工具自身**调 `assertApprovalAllowed`（与 `compose_video` 同口径）承担。skill 侧只写"用 `ask_user_choice` 澄清时长/字幕粒度/卡片形态"，**不得**出现"确认后才渲染"式表述。
- **流程**：
  1. 确认 storyboard 已落地（`write_storyboard` 已完成）。
  2. 收集素材 + **取真值**：用 `list_shots` 列出已有 clip（**连时长一起取**，这是 video 轨时长的唯一合法来源，§10.4）、`list_references` 取图片与一致性资产；有旁白时探真值总长（§10.3）。
  3. **组装 CompositionManifest JSON**（§4.6）：video 轨时长按 §10.4 填真值，字幕卡时序按 §10.3 派生，字体按 §8 声明（`global.fontFamily` / `global.fonts`）。
  4. **澄清（不是审批门）**：用 `ask_user_choice` 给出成片结构预览（轨道时序表，**video 轨须同时显示「声明时长 / 真值」两列**）+ 可调项（时长档位 / 字幕粒度 / 卡片取舍），让用户挑；措辞按"可选方案"而非"确认后才继续"。
  5. 调 `render_composition({ manifest })` —— 工具内部走宿主审批门放行。
  6. 成片节点落画布 → 跑质量校验（§9.1，含降级预案）→ 展示。
- **落盘清单**：`skills/code-driven-explainer/{SKILL.md, platform.yaml, references/…}` + `src/skill-catalog.ts` 快照一条。
  - `platform.yaml` 建议取值：`role: "decision"`、`slot: "general"`（**不得用 `orchestration`** —— 该槽位由总纲独占，`skill-role-consistency.test.mjs` 会红）；`category` / `icon` 必须取自 `skill-catalog.ts` 已声明的取值域；`title` ≤20 字、`summary` 1–60 字。
  - `description` 上限 **1024** 字符（`DESCRIPTION_LIMIT`；注意 `skill.test.mjs:40` 的测试名仍写"≤500"，那是旧文案）。

### 10.2 与现有 skills 的关系
- 不替换 `canvas-studio-creation`，是它的**一个下游分支**（当用户要"代码合成"而非"纯模型拼接"时启用）。
- 复用全部素材生成工具（video_generate / image_generate / music_generation / tts_voiceover），只新增"合成"这一步。
- **定位补充**：现有 skill 纪律是"默认不把字幕烧进画面"（CV-213，字幕降级为文案节点；`subtitle_burn` 仍是占位工具）。`code-driven-explainer` 是项目**第一个真正把字幕烧进画面**的路径——字幕卡是本 skill 的核心卖点，句级质量必须做扎实。
- **风格路由取舍（建议第一期不登记）**：`style-presets.md` 是"面向终端用户的成片风格"的澄清链路，登记进去会连带触发「11 个风格 skill 立场声明」那套要求（`skill-progressive-disclosure` 的第四条）。本 skill 是**流程型**，第一期不登记 → 用户从技能广场可见并显式调用，但澄清流程不主动推荐。此取舍须在验收前明确。

### 10.3 句级字幕时序口径（MVP 定稿）

**现状约束（已实地核实）**：Drama `txt2speech` 响应只有 `{prompt_id, filename, full_url, duration}`（`docs/api.md:1377`），**无任何字级/句级时间戳**；且其中 `duration` 是服务端**生成耗时**而非音频时长（探针实测差 2.8 倍，`docs/api-probe/txt2speech-20260930/report.md:15`）。仓库亦无 forced-alignment / whisper / SRT 相关代码。因此词级同步无数据源，MVP 句级定稿如下：

**派生流程（skill 组装 Manifest 时执行，纯口径、零新依赖）**：
1. `tts_voiceover` 产出旁白后，用 `probeMediaDuration`（`ffmpeg-run.ts:299`，宿主已有）探**真实音频总时长 T**（秒）——总长是实测值，不靠估算。
2. 按**字数占比**把 T 分配给每句：`句i时长 = (字数i / 总字数) × T`；句间可加固定呼吸间隔（默认 0.15s，**从相邻句时长内扣**，不额外拉长总长）。
3. 折算帧：`startFrame = 累计秒 × fps`（向下取整），`durationInFrames = 句时长 × fps`（向上取整）；**末句吸收舍入误差**，保证末句 endFrame 与旁白总帧对齐。
4. 无旁白（纯 BGM / 无音频轨）时回退**字数 × 0.25s（4 字/秒）**估算——沿用 `voiceover-writing` skill 现行惯例（`skills/voiceover-writing/SKILL.md:12`）。
5. **兜底校验**：末句 endFrame 与旁白总帧偏差 > 0.5s → 进 `ComposeToolResult.warnings`（不阻断渲染）。

**误差预期**：总长精确（实测），误差只在句边界（受语速不均影响，典型 ±0.3s/句），显著优于裸 4 字/秒。

**词级字幕（二期，有前置条件）**：需 Drama TTS 响应增加 word/sentence timestamps，**或**引入 forced alignment（如本地 whisper 转写对齐）。排期前置：先向 Drama 后端提"txt2speech 返回时间戳"需求并拿到接口承诺，再立项（§14 P1）。

### 10.4 素材轨时长口径（v1.1 新增，§0 R7）

**为什么必须写死**：Manifest 的 `tracks[].durationInFrames` 是渲染的硬输入，但 v1 只定义了「旁白探真值」与「成片探真值」，**没定义素材轨的时长从哪来**。若留给 LLM 估，会出现最难查的一类静默错误：
- 声明**偏短** → 素材被截断（画面在动作中途断掉）；
- 声明**偏长** → 渲染器在素材末尾**冻结最后一帧**（Remotion 的行为：视频结束后保持末帧），观众看到"卡住的画面"，且没有任何报错。

**口径（按轨类型分档，与 §4.5 一致）**：

| 轨类型 | 时长来源 | 允许偏差 | 违反判定 |
|---|---|---|---|
| `video` | **`list_shots` 返回的真实时长**（Host 已用 `probeMediaInfo` 探过真值）→ `durationInFrames = round(realSec × fps)` | ±1 帧（取整） | 偏差 > 0.5s：① 宿主在 `checkManifestAssets` 阶段计入 warnings（§8.2，route B 不落盘只核对）；② 若与他轨/转场窗口冲突 → error 拒绝渲染 |
| `image` / `textCard` / `shape` | skill 按解说节奏与字幕时序自主排布（无真值可言） | 自由 | — |
| `transition` | 由相邻两轨的重叠窗口决定（§4.5） | — | 见 §4.3 第 4 条 |

**纪律**：
1. **LLM 不许"目测"视频时长**——必须来自 `list_shots`；没有该字段就先调它，不许编。
2. `meta.durationInFrames` 与 `max(track.endFrame)` 的一致性由 `validateManifest`（§4.3 第 5 条）把守（>1 帧偏差 → warning）。
3. HITL 预览里 video 轨必须同时展示「声明时长 / 真值」两列，让人一眼看出是否被修正过（这是把"宿主静默修正"变成"用户可见决策"的关键）。
4. 阶段 1 的单测要覆盖：video 轨声明 300 帧而真值 240 帧 → 必须产生 warning 且终值取真值。

---

## 11. 集成插入点明细表（见 demo §3）

| 模块 | 文件:行 | 改动 | 工作量 |
|---|---|---|---|
| 新增渲染工具 | `host-tools.ts:1270`（`createStudioTools` 返回数组） | 在 `compose_video` 后加 `render_composition` defineTool（§6.2） | 中（1–2d） |
| 成片落节点 | `compose.ts:628` `appendComposedVideoNode` | **不改**，直接复用 | 0 |
| 复用 ffmpeg（**仅混音/探测**） | `ffmpeg-run.ts:128` `resolveFfmpegPath` | **不改**；用于 `buildAmixArgs` 混音与 `probeMediaInfo`，**不喂 Remotion**（§0 R1） | 0 |
| 资产反查（**仅核对**，route B） | `compose.ts:118` `urlToAssetPath` | **不改**；★ route B 只用于 `asset-check.ts` 核对存在性与 probe 真值，**不再注入 `renderDir/cs-assets`**（素材同源直取，§8.1） | 0 |
| Manifest 类型 + 校验 | `src/remotion/manifest.ts`（新） | 新建（§4.2 / §4.3）✅ 已完成 | 中（1d） |
| 宿主编排（route B） | `src/remotion/render-job.ts` + `asset-check.ts`（新） | 新建（§6.3 / §8.2：工单状态机 + 只核对的素材检查） | 中（1.5d） |
| 客户端渲染器（route B） | `src/client/remotion-render.ts`（新）+ `routes.ts` 三路由 + `client/index.ts` 轮询扩展 | 新建（§6.4：轮询工单 → `renderMediaOnWeb` → octet-stream 回写） | 高（2–3d） |
| ~~渲染封装（route A）~~ | ~~`src/remotion/remotion-render.ts` + `render-dir.ts`~~ | ~~新建~~ ⇒ **route B 取消** | — |
| 组件库 | `src/remotion/components/*`（新） | 新建 6 个组件（§7.3） | 中（2–3d） |
| 风险评分 | `src/remotion/slideshow-risk.ts`（新） | 新建（§9.2） | 低（0.5d） |
| 字体解析/缓存 | `src/remotion/fonts.ts`（新） | 新建（§8.3 方案 C：随包子集 → 下载缓存 → fallback + delayRender 闸门） | 中（1d，含子集构建脚本） |
| 质检扩展 | `quality-check.ts:217` | **不改**，render_composition 调 `runShotQc` | 0 |
| 新 skill | `skills/code-driven-explainer/`（新：`SKILL.md` + `platform.yaml` + `references/`） | 新建（§10.1，含字幕/字体口径；入口 ≤12 KB） | 中（1.5–2d，含 platform.yaml 与合规整改） |
| **登记门禁 1** | `skills/canvas-studio-creation/references/toolchain.md`（工具表内，**按行首匹配定位，勿引行号**——该文件 2026-10-15 被重写、行号已漂） | 在工具表加一行 `\| render_composition \| … \|` | 必做（5min） |
| **登记门禁 2** | `docs/canvas-studio-tools.md` | 在工具表加一行 `render_composition` | 必做（5min） |
| **登记门禁 3** | `tests/tool-registry.test.mjs:36` + `:39–64` | `EXPECTED_TOOL_COUNT` **24 → 25** + 工具名单加名（§12.2） | 必做 |
| **登记门禁 4（新，CV-324）** | `skills/code-driven-explainer/platform.yaml`（新） | 9 必填字段齐全、取值域合法、三方一致（目录名 = platform.yaml.name = SKILL.md frontmatter.name） | 必做 |
| **登记门禁 5（新，CV-324）** | `src/skill-catalog.ts` 的 `BUNDLED_CATALOG` | 加快照一条，与 platform.yaml **逐字段相等**（渲染器无文件系统，用内嵌副本） | 必做 |
| **登记门禁 6（新，CV-317）** | `tests/skill-tool-refs.test.mjs` | skill 正文引用的 snake_case 工具名必须在真实注册表 ⇒ **工具与 skill 同批提交**，否则红 | 必做（约束时序） |
| 依赖 | `canvas-studio/package.json` | deps 加 `remotion` / `@remotion/media` / `@remotion/web-renderer`（**route B**：不装 `@remotion/renderer` / `bundler` / `cli`，无 `@remotion/test-renderer`，§0 R4/R21）✅ 已装 4.0.535 | 低 |
| **登记门禁 7（route B 新）** | `src/routes.ts`（3 条 `remotion/*` 路由常量 + handler） | 新增（§6.7） | 必做 |
| **登记门禁 8（route B 新）** | `src/client/index.ts` `pollGenerationQueue` | 扩展待渲染工单轮询（空闲即停，§6.7） | 必做 |

> ⚠️ **六处登记 / 一致性是硬门禁（v1.2：原为三处；v1.5 route B 另加门禁 7/8 = 路由 + 客户端轮询，共 8 处）**：
> - 门禁 1/2/3 由 `tests/skill.test.mjs`（扫 `host-tools.ts` 的 `name: '…'` 再对账两份工具表）+ `tests/tool-registry.test.mjs`（计数）把守。
> - 门禁 4/5 由 `tests/skill-platform-meta.test.mjs`（platform.yaml 字段齐全 + 三方一致 + `BUNDLED_CATALOG` 快照逐字段相等 + 无槽位冲突）把守。
> - 门禁 6 由 `tests/skill-tool-refs.test.mjs` 把守（对账源 = `host-tools.ts` + `placeholder-tools.ts` 的真实注册表 + 豁免表）。
> - 另有两条 skill 门禁与本设计**直接相关**：`skill-progressive-disclosure.test.mjs`（入口 ≤12 KB、分册互引不断链、**禁自设审批门**）、`skill-role-consistency.test.mjs`（`orchestration` 槽位只有总纲）。
> 改完必须跑 `corepack yarn workspace canvas-studio test:smoke`。

---

## 12. 测试与验收（直接落地的门禁）

### 12.1 必做：注册完整性门禁（最高频踩坑）
**门禁 A（工具登记）** —— `tests/skill.test.mjs:102` 的逻辑：
```js
const hostTools = readFileSync(join(ROOT, 'src', 'host-tools.ts'), 'utf8')
const names = [...hostTools.matchAll(/^ {6}name: '([a-z_0-9]+)'/gmu)].map(m => m[1])
// 每个 name 必须在 toolchain.md 与 docs/canvas-studio-tools.md 各有一行 `| name |`
```
落地动作：
1. `host-tools.ts` 的 `render_composition` defineTool 缩进必须是 6 空格（与 compose_video 一致，否则正则扫不到）。
2. `toolchain.md` 工具表加：`| render_composition | 代码驱动合成（Remotion）：字幕卡/数据卡/转场/图文幻灯片，返回同 compose_video 形状 | manifest、projectId? |`（注意 `manifest` 是**必填**，不带 `?`）。⚠️ **按行首匹配定位该行，不要照抄行号**——该文件 2026-10-15 被重写，`toolchain.md:55` 已不再是工具表行。
3. `docs/canvas-studio-tools.md` 工具表加对应行（注意反引号习惯与另一份不同，正则两种都认）。

**门禁 B–E（v1.2 新增，skill 侧）** —— 新增 skill 现在还要过：
| 门禁 | 由谁把守 | 要求 |
|---|---|---|
| B `platform.yaml` | `tests/skill-platform-meta.test.mjs` | 目录内必须有；9 必填字段 `name/title/summary/category/icon/hue/featured/role/slot`；`role ∈ {knowledge, decision}`；`slot` 合法（`orchestration` 归总纲、`general` 容纳无归属者，另有 6 个能力槽 `video-prompt`/`image-t2i`/`image-edit`/`audio-music`/`audio-voice`/`camera-language`）；**目录名 = platform.yaml.name = SKILL.md frontmatter.name** |
| C `BUNDLED_CATALOG` 快照 | 同上 | `src/skill-catalog.ts` 里加一条，与 `platform.yaml` **逐字段相等**（渲染器无文件系统，只能用内嵌副本；分叉 = 广场少卡）。另受 `tests/skill-catalog.test.mjs`：`title` ≤20 字、`summary` 1–60 字、`category`/`icon` 必须在已声明取值域、`hue` 0–360、`featured` boolean、`demo` 若声明则 GIF 必须存在、`stage` 生命周期合法 |
| D 工具名对账 | `tests/skill-tool-refs.test.mjs` | skill 正文（含 `references/**`、`.yaml`）出现的 snake_case 词若是"工具名候选"，必须在真实注册表（`host-tools.ts` + `plugins/placeholder-tools.ts`）或豁免表里 ⇒ **`render_composition` 必须先注册，或与 skill 同批提交** |
| E 渐进披露 / 不自设门 | `tests/skill-progressive-disclosure.test.mjs` | `SKILL.md` **≤12 KB**（总纲除外）、正文引用的 `references/<file>` 存在（**分册之间互引也不许断链**）、**禁止自设 HITL 门**（禁退役工具名 `submit_screenplay` / `submit_storyboard_for_approval`，禁"确认后才生成"类流程门；`ask_user_choice` 仅限澄清） |

> 相关常量：`DESCRIPTION_LIMIT = 1024`（`src/skills/minimax-skills.ts:84`；`skill.test.mjs:40` 的测试名仍写"≤500"，属旧文案）。`skills/` 目录现为 **21** 个（CV-318 删了两个死 skill）。

### 12.2 工具计数同步
`tests/tool-registry.test.mjs` 的 `EXPECTED_TOOL_COUNT`（L36，当前 24 = 23 真实 + 1 占位）与工具名单（L39–64）直接调 `createStudioTools` 取真实注册面——新增后 **24 → 25**，同步改计数常量与名单，并确认 `STATUS.md §3.4` / `docs/README.md` 的"24 个工具"文案一并更新（按项目文档纪律，新工具入册时同步这些计数）。

### 12.3 单测（直接加文件）
> **测试纪律（项目现状）**：现有测试从 `../lib/*.js` 导入 → **必须先 build 再跑**；跑法走 `test:smoke` 门禁（`node scripts/run-smoke.mjs`，内部 `node --test`，失败集需 ⊆ `tests/baseline-red.json`），**新测试严禁塞进 baseline-red**。`manifest.ts` / `slideshow-risk.ts` / `timing.ts` 是纯 `.ts`，落在 Host `tsconfig` 的 `src/**/*.ts` include 内，build 后即可被 `.mjs` 测试导入。

**必做（纯函数，无浏览器、无新依赖，直接进 `node --test`）**：
- `tests/manifest.test.mjs`：`validateManifest` 的正/反例（缺 meta、坏 src、悬空 transition、转场无重叠/完全不相交、时长漂移、轨道超出总时长）+ `deriveAudioComposition` 四分支 + `collectManifestSourceIds`。
- `tests/slideshow-risk.test.mjs`：`scoreSlideshowRisk` 的 6 维命中。
- `tests/remotion-timing.test.mjs`：**把组件里的时序/插值逻辑抽到 `src/remotion/timing.ts` 后单测** —— 轨激活窗口（`local < 0 || local > durationInFrames` 的边界）、淡入淡出 `interpolate` 的端点与 clamp、字幕时序按字数占比分配（§10.3 的末句吸收舍入误差、总帧对齐）、video 轨时长核对（声明 300 帧 / 真值 240 帧 → warning + 取真值，§10.4）。
  > 这是 v1.1 对 R4 的落地方式：**把"组件行为"变成"纯函数契约"**，才能沿用项目现有的 `node --test` 体系。

**可选（组件级帧断言，不进自动门禁）**：
- 官方没有 `@remotion/test-renderer`（§0 R4）。若确需"渲出来看第 N 帧长什么样"，官方路径是 `@remotion/player` 的 `<Thumbnail>`（v4.0.271+ 支持 `noSuspense`）包上下文 + `renderToString` 断言文本，或 `npx remotion still` 出 PNG 人眼比对。前者要引入 React Testing Library / Happy DOM 一套，**与项目现有测试栈不同，故列为可选、不进门禁**；后者见 §9.3。

### 12.4 端到端冒烟（route B：gate 在「客户端渲染可用」）
- route B 的渲染**只在 Electron 渲染进程**（需 GPU/WebCodecs）。CI / agent shell 无 Electron ⇒ 冒烟分两段：
  - **宿主段（可自动）**：`validateManifest` → `checkManifestAssets` → 建单 → 收假字节 → `saveLocalAssetBytes` → `appendComposedVideoNode` 全链，用**假客户端**（测试里直接 `POST /canvas-studio/remotion/commit`）跑通。这一段**无需浏览器**，应进 `node --test` / 门禁。
  - **客户端段（gate 在「Electron 可用」，桌面人跑）**：真 `renderMediaOnWeb` 出 MP4，断言时长 = `durationInFrames/fps`（验证 §6.4 显式四元组生效）、字节数 > 0、有音轨。无 Electron 环境**必须打印显式 skip 理由并计入报告**（防"空绿"，仿 ffmpeg 真跑冒烟的 <5ms 判据）。
- 用假 manifest（仅 textCard / shape，无 video）先跑通；`<Video>`/`<Audio>` 轨道的真冒烟 = S9 补验，放阶段 6 联调。
- 混音段可复用项目「假 ffmpeg 替身」模式，避免 CI 里再真跑编码。

### 12.5 T3 分层（按项目验证纪律）
- 渲染 / 守卫 / 错误系统属 T3：跑全量 `node --test` + 反向变异（真改坏 `render_composition` 产品码 → 断言变红 → 还原）。
- 视觉/UX 不在自动覆盖内（项目铁律），最终判据是人（你桌面观感）。

---

## 13. 分阶段实现计划（7 阶段，带 checklist + 验收）

### 阶段 0 · Spike —— ✅ **已完成（2026-10-15，Intel Mac / Remotion 4.0.535）**
> **报告**：`canvas-studio/docs/remotion-spike-report-2026-10-15.md`（含全部物证与重放命令）
> **结论**：核心链路**全部跑通**，无需更换技术路线；浏览器来源问题**已解决**；**实测纠正 3 处**（§0 R12/R13/R14）。

| 项 | 结果 |
|---|---|
| `bundle()` → `selectComposition()` → `renderMedia({composition, codec:'h264'})` | ✅ 跑通；`composition` 为 VideoConfig 对象 |
| `calculateMetadata` 真的改变成片时长 | ✅ 声明 3s / 1s → **产物真值 3.000s / 1.000s**（自写 MP4 `mvhd` 解析验真值，不依赖 ffmpeg） |
| 浏览器来源 | ✅ **已解决**：官方源 20 KB/s 不可用 → 镜像 26 MB/s；预置脚本 `spike-remotion/pipeline/s0b-prefetch-browser.sh`；`ensureBrowser()` 命中 0.0s |
| 平台二进制 | ✅ 随包自动装；**本机 Intel ⇒ x64 = 25M**；arm64 = 17M（交叉装）⇒ **通用包 42M** |
| `renderDir` 注入模型 | ✅ **成立**，落点确定为 **`<renderDir>/public/cs-assets/`**（§8.1） |
| `cancelSignal` | ⚠️ **须用 `makeCancelSignal()`**（非 AbortSignal）；中断抛 `renderMedia() got cancelled`，**不留残片** |
| `chromiumOptions.gl` | ✅ angle / swangle / 缺省 **三档均成功** ⇒ 不传 |
| License 快照 | ✅ `docs/remotion-license-snapshot-2026-10-15.md`（含 R11 的原文勘误） |
| **性能基线** | `renderMedia` @1280×720 ≈ **0.08–0.10 s/帧**（Intel，无 shared-memory capture）⇒ 30s 片约 **75–90s** |
| 字体链路 | ⏸ **降级到 B2**（需先有字体子集产物；Spike 已证明 `delayRender`/`cancelRender` 闸门可用） |
| Electron 主进程内渲染 / 残留进程 | ⏸ **本环境无法验证**（无 GUI；`ps` 被沙箱拒）⇒ 需用户终端 |
| arm64 路径 | ⏸ 本机是 Intel，无法执行 arm64 二进制 ⇒ 需 Apple Silicon 机验（**shared-memory capture 亦依赖 Apple Silicon**，本机基线不代表 M 系） |

> **环境注意（仅影响 agent 会话，不影响产品）**：本会话内跑 Remotion 脚本须 `NODE_OPTIONS= node …`（沙箱注入的 `node-language-shim.cjs` 会把"对已存在目录的 mkdir"误判为越权，`bundle()` 会报 `CODEBUDDY_BROKER_DENY`）；且 `bundle({outDir})` 必须显式给。

### 阶段 1 · 契约 + 校验（0.5 周）—— ✅ **已完成（2026-10-16，路线 B / CSR）**
- [x] 写 `src/remotion/manifest.ts`（§4.2 类型 + §4.3 `validateManifest` + `deriveAudioComposition` / `collectManifestSourceIds`）。
- [x] 写 `tests/manifest.test.mjs` 正/反例（16 例）。
- **验收**：`node --test` 绿（16/16）；坏 JSON / 悬空 transition 被拒；派生函数对 `native+bgm` / `bgm-only` / 无音频三态断言正确。落地见 §0.3（R18）。

### 阶段 2 · 组件库最小集（1~1.5 周）—— 🔶 **组件 + 时序纯函数已完成（2026-10-16），字体待做**
- [x] 6 个组件（§7.3）+ `Root.tsx`（**含 `calculateMetadata`**）+ `index.ts`（`registerRoot`）。
- [x] **`src/remotion/timing.ts`**：轨激活窗口、淡入淡出插值、字幕时序派生、video 时长核对、转场覆盖抽成纯函数（组件只做布局），配套 `tests/remotion-timing.test.mjs`（13 例，§12.3）。
- [x] video 组件用 **`@remotion/media` 的 `<Video>`**；段长改用 `<Sequence durationInFrames>`（**R20**：该包的 `Video` 无 `durationInFrames` prop）。
- [ ] `fonts.ts`（§8.3）：随包解析 / 下载缓存 / fallback + `@font-face` 注入 + `delayRender` 闸门。
- [ ] 中文子集构建脚本（常用字表 → woff2，产物进 `public/fonts/`）。
- [x] `remotion/` 独立 tsconfig（隔离 JSX）：`tsconfig.remotion.json`，已接进 `typecheck` 脚本；Host `tsconfig.json` 已 `exclude` `src/remotion/components/**`。
- **验收**：时序纯函数单测绿 ✅（13/13）；`npx remotion still studio-composition` 出图无报错 ⏳（待用户终端）；中文字幕卡出图字体正确不 fallback ⏳（待字体）。
- **可选**：`<Thumbnail>` + `renderToString` 的组件级断言（不进自动门禁，§12.3）。

### 阶段 3 · render_composition 工具 + route B 工单桥（1~1.5 周）—— ✅ **已完成（2026-10-16，CV-327；桌面 CSR 真机渲染跑通出片）**
- [x] `host-tools.ts` 加 defineTool（§6.2，**route B 版**：校验 + `checkManifestAssets` + `runRenderJob` + 落节点），缩进 6 空格。**另加 `assertRenderCompositionProjectId`（显式 `projectId` 必须是注册表真项目，`host-tools.ts:648`，§0.5）。
- [x] `render-job.ts`（§6.3 宿主编排：工单状态机 + 存储 + 结算 + `finally` 清工单）。
- [x] `asset-check.ts`（§8.2：只核对不拷贝，素材存在性 + 时长核对）。
- [x] `client/remotion-render.ts`（§6.4：轮询工单 → `renderMediaOnWeb` → octet-stream 回写）+ `routes.ts` 三条路由 + `client/index.ts` 轮询扩展。
- [x] 复用 `appendComposedVideoNode` / `ComposeResult` / `buildAmixArgs` / `probeMediaInfo` / `saveLocalAssetBytes`（ffmpeg **只用于混音与探测**）。
- [x] **工具侧三处登记**（§11 门禁 1/2/3：两份工具表 + 计数 24→25）；**route B 另加 2 处**（§6.7：路由 + 客户端轮询）。
- [x] **审批门双登记**（§0.5 R22）：`assertApprovalAllowed` + 工具名进 `approval-gate.ts` 的 `FORMAL_TOOLS`；扩 `tests/approval-gate.test.mjs` 的 `FORMAL`/`DIRECT`。
- **验收**：`tests/skill.test.mjs` 绿 ✅；**宿主段冒烟**（假客户端 POST commit）出 MP4 节点 ✅（`tests/remotion-render-job.test.mjs` 6 例）；**客户端段**真渲染 ✅ **已桌面跑通出片（2026-10-16）**。**待补**：Z 组边界（Z-7/Z-8/Z-9/Z-11）。

### 阶段 4 · code-driven-explainer skill（0.5~1 周，v1.2 加合规工作量）—— ✅ **已完成（2026-10-16，CV-327）**
- [x] 写 `SKILL.md`（§10.1）：**入口 5,218 B**（≤12 KB）、细则下沉 5 本 `references/`、流程按"澄清（`ask_user_choice`）而非审批门"写。
- [x] 写 `platform.yaml`（9 必填字段；`role: "decision"` / `slot: "general"`）—— **门禁 4**。
- [x] `src/skill-catalog.ts` 的 `BUNDLED_CATALOG` 加一条快照，与 platform.yaml 逐字段相等 —— **门禁 5**。
- [x] 句级字幕时序派生口径写入 SKILL（§10.3）→ `references/subtitle-timing.md`。
- [x] **素材轨时长口径写入 SKILL（§10.4）**：video 轨必取 `list_shots` 真值、预览表须显示「声明 / 真值」两列 → `references/source-duration.md`。
- [x] 字体声明口径写入 SKILL（`global.fontFamily` / `global.fonts`，§8.3）→ `references/fonts.md`。⚠️ **口径已写、机制未落地**（`fonts.ts` 未做，见阶段 2 遗留 / 剩余工作 R1）。
- [x] **跑 `test:smoke` 确认 skill 侧门禁全绿**（§12.1 门禁 B–E + `skill-role-consistency` / `skill-catalog`）：定向 **43 条全绿**。
- **验收**：`test:smoke` 全绿 ✅；skill 加载后**在澄清环节**能展示 Manifest 时序预览（含字幕卡每句起止帧 + video 轨声明/真值对照），且正文无自设审批门表述 ✅（**桌面观感待验**）。
- **剩余（纳入剩余工作清单）**：字体机制（R1）、成片质量门（R2）、真素材端到端（R3）、Z 组边界（R4）、打包（R5）、总纲路由接线（R6）。见 `canvas-studio/docs/plans/REQ-034-剩余工作-20261016.md`。

### 阶段 5 · 质量门禁扩展（0.5 周）—— 🔶 **评分已接入（2026-10-16），`runShotQc` 适配取证待做**
- [ ] **先取证**：读 `runShotQc` 入参，判定对成片节点是否适配；不适配则按其降级预案执行（§9.1，**不许硬塞出假结论**）。
- [x] `slideshow-risk.ts`（§9.2）+ 测试（`tests/slideshow-risk.test.mjs`，5 例）。
- [x] 风险评分进 `ComposeToolResult.warnings`（`host-tools.ts:2463`，`scoreSlideshowRisk` + `SLIDESHOW_RISK_WARNING_THRESHOLD`，仅提示不阻断）。
- **验收**：纯幻灯片 manifest 触发 warning，不阻断 ✅；成片质检结论的来源（`runShotQc` 或降级方案）在结果里可辨识 ⏳（待取证，见剩余工作 R2）。

### 阶段 6 · 打包分发 + 客户端渲染联调（0.5 周）—— **route B 大幅简化**（⏳ 见剩余工作 R5）
- [x] `package.json` 加 remotion 依赖（已完成：`remotion` / `@remotion/media` / `@remotion/web-renderer`@4.0.535）。
- [x] 确认客户端 bundle 能吃 `@remotion/web-renderer`（React 反复用客户端已装的 React；无 webpack/bundle 步骤）—— build 通过、8.6 MB client bundle 含 remotion/media/web-renderer。
- [x] 确认 Electron 渲染进程满足 CSR 前置：`canRenderMediaOnWeb` 已在 `client/remotion-render.ts:51` 落地（返回 `canRender:false` 即抛 `CS-RENDER-002`）。**无需** `disable-renderer-backgrounding`。
- [ ] ~~预构建 Remotion bundle / headless-shell / `@remotion/compositor-*` asarUnpack~~ —— **route B 全部不需要**（§7.5/§7.5.1 作废）。
- [ ] 随包中文字体（§8.3）走客户端 bundle 或宿主只读路由；确认发行态能读（**= 剩余工作 R1/R5**）。
- [~] 真 video / image + 旁白/BGM 轨道端到端（**= S9**）：**verifier 级已关闭**（S10 出 `render-with-audio.mp4` = h264+aac）；**产品链路（工单桥）级待做**（= 剩余工作 R3）。
- [ ] **体积审计**：包体增量 ≈ **+0**（route B 无浏览器/无编码器二进制）＋ 中文字体子集 1–3MB（= 剩余工作 R5）。
- **验收**：打包产物在干净机跑通 `render_composition`（Z-14；S9 通过是前提）。

### 阶段 7 · T3 测试 + 文档登记（0.5 周）—— ✅ **已完成（2026-10-16，CV-327）**
- [x] 全量 `node --test` 绿（B3：`remotion-timing` 13 + `remotion-render-job` 6 + `remotion-render-project-id` 4 + `approval-gate` 扩表 + `slideshow-risk` 5；全量 **1729·1729、失败 0**）。反向变异留临收口。
- [x] **跑 `corepack yarn workspace canvas-studio test:smoke`，确认 §12.1 六处门禁全绿**（工具登记 ×2 + 计数 + `platform.yaml` + `BUNDLED_CATALOG` 快照 + `skill-tool-refs`，另加 `skill-progressive-disclosure` / `skill-role-consistency` / `skill-catalog`）—— 随 B4 skill 落地已全绿。
- [x] 同步 `STATUS.md §3.4` / `docs/README.md` 工具计数（24 → 25）；登记 CV 编号（**CV-327**）。
- **验收**：proof table 全绿（build / typecheck / test）✅ 当前态。

**MVP 合计 ≈ 3–4 周单人**（不含阶段 6 打包联调的长尾，约 +1 周）。v1.1 的 API 修订不改变量级——省掉了"实测两种 Chromium"与"组件测试栈引入"，抵掉了新增的 renderDir / calculateMetadata 验证项。

---

## 14. 功能缺口清单（P0 / P1 / P2，见 demo §4）

| 优先级 | 缺口 | 影响 | 解决方案 | 阶段 |
|---|---|---|---|---|
| **P0** | 无代码驱动合成引擎 | 字幕卡/数据卡/转场做不了，REQ-034 无法满足 | 本文件 §5–§7 全套新增 | 0–3 |
| **P0** | 无 CompositionManifest 契约 | 成片结构无法显式描述 | §4 manifest.ts + 校验 | 1 |
| **P1** | 浏览器来源（已定：Remotion 自管 headless-shell） | 决定打包体积与国内打包可行性 | §7.5：方案 A 为 MVP 路径，方案 C 为减重增量；**"复用 Electron Chromium"已排除** | 0 / 6 |
| **P1** | 字体方案（已定：混合 C） | headless 环境字体 fallback → 观感事故；多语言扩展需求 | §8.3：随包子集 + 自托管 OFL 下载缓存 + fallback warning；**下载源依赖 Drama 后端新增 `/fonts/` 路由（外部前置，不进 MVP 关键路径）** | 0 / 2 / 6+ |
| **P1** | 字幕时序（句级已定） | 旁白型科普视频的字幕对齐质量 | §10.3 字数比例分配（探真值总时长）；词级二期，前置 Drama TTS 时间戳 or forced alignment | 4 / 二期 |
| **P1** | **素材轨时长口径缺失**（v1.1 补：§10.4） | video 轨声明时长与真值不符 → 截断或末帧冻结（静默错误） | §4.5 + §10.4 口径；宿主在 `checkManifestAssets` 按真值核对 + warning（route B，§8.2） | 3 / 4 |
| **P1** | 长片渲染阻塞 | 30s+ 渲染卡住会话 | MVP 先同步（镜像 compose_video）+ 超时强杀/cancelSignal（§6.2）；二期接 Drama 任务恢复轮询 | 3 / 二期 |
| **P1** | 幻灯片风险评分缺失 | "假视频"防呆无 | §9.2 slideshow-risk.ts | 5 |
| **P1** | 成片质检适配性未取证 | `runShotQc` 面向镜头，对成片可能不适用 | §9.1 前置取证 + 降级预案（禁假结论） | 5 |
| **P1** | **skill 侧新门禁未对齐**（v1.2 新增） | 新 skill 落地会撞 4 道新门禁：`platform.yaml` 必需 / `BUNDLED_CATALOG` 快照 / 工具名对账 / **禁自设审批门 + 入口 ≤12 KB** | §0 R8/R9 + §10.1 + §12.1 门禁 B–E | 4 |
| **P2** | 资产喂法（已定：方式 B → **renderDir 模型**） | 离线/隔离能力 | §8.1/§8.2：`renderDir` + `cs-assets/` + `link` 优先；阶段 3 落地 | 3 |
| **P2** | bundle 时机（已定：预构建进包） | 运行时构建慢 vs 打包复杂度 | §8.1 两种模式的统一口径；**发行版能否注入 bundle 目录 = 阶段 0 待验项**（§15.1 决策 5） | 0 / 6 |
| **P2** | LLM 动态生成组件 JSX | agentic 但高风险 | 二期，沙箱化 eval（不在 MVP） | 二期 |
| **P2** | 云端批量渲染 | 规模扩展 | 商业规模再议 | 二期 |

---

## 15. 风险评估与决策点（见 demo §5）

### 15.1 决策点 + 我的建议（已定 7 项，待 Spike 实测 2 项）
1. **浏览器来源**（§7.5）：✅ **已定案（Spike 实测）** —— Remotion 自管 **Chrome Headless Shell**；"复用 Electron Chromium"**已排除**（§0 R3）。**落地形态 = 从 npmmirror 镜像预置**（实测 26 MB/s；zip 104MB → 解包 210MB；`VERSION` 写对即 0.0s 命中），脚本见 `spike-remotion/pipeline/s0b-prefetch-browser.sh`。**仅剩**"Electron 主进程内可跑 + 是否需显式 `binariesDirectory`"需用户终端验（§13 阶段 0 未验证项）。
2. **资产喂法（已定 + v1.1 修订）**：**方式 B**，但落点由「每渲染 `publicDir`」改为「**统一 `renderDir`**」（§8.1）：组件侧一律 `staticFile('cs-assets/<name>')`，发行版走"复制预构建 bundle + 注入素材"，开发态走"`bundle({outDir, publicDir})`"。**仅剩一个待验项**：预构建 bundle 目录内新增文件能否被 `staticFile()` 读到（§8.1 待验项；不成立则退化为开发态模式）。
3. **渲染时机（已定）**：MVP 同步（镜像 compose_video）+ 超时强杀 / cancelSignal（§6.2）；长片异步留二期。
4. **范围（已定）**：只做 MVP 卡片/字幕/转场（§1.2）；词级字幕与 LLM 动态 JSX 均留二期。
5. **bundle 时机（✅ 已定案，前置已消除）**：发行版预构建 bundle 进包（运行时零 webpack）+ 开发态运行时构建回退（§8.1）。**Spike 已实测注入模型成立**（落点 `<renderDir>/public/cs-assets/`），故本决策**不再有不确定性**；开发态回退仅在"注入失效"时才需要，现已确认不需要。
6. **字体方案（已定）**：混合 C——随包子集中文（离线兜底）+ 自托管 OFL 字体按需下载缓存（多语言扩展）+ fallback warning（§8.3）。**注意：下载源依赖 Drama 后端新增路由，属外部前置，MVP 只走随包子集。**
7. **字幕时序（已定）**：MVP 句级，按 §10.3「probeMediaDuration 探真值 + 字数比例分配」派生；无旁白回退 4 字/秒。**素材轨（video）时长另按 §10.4 取 `list_shots` 真值**。

**待拍板 / 待验（Spike 后更新）**：
- ✅ ~~headless-shell 的落地形态~~ → **已定：镜像预置**（决策 1/5 残留项已消除）。
- ⚠️ **⚠️ 技术路线选型（最高优先，需拍板）**：**路线 B（CSR）已实测可用，且三项补验全过**（S7 可用 / S8：观感用户认可 + 字体 `loaded:true` + **性能 13 ms/帧，比 SSR 快约 7 倍**）⇒ **建议切 CSR**（省 250MB + 一整套构建复杂度 + 渲染快 7 倍）。**切换前唯一剩余未验**：`<Video>`（模型 clip）+ `<Audio>`（旁白/BGM）与**带音轨 mp4 的 mux**（spike 报告 §9.2 的 S9）。若切 ⇒ 改造 §6/§7.3（**去 z-index、改 DOM 顺序**）/§8/§8.3/§12；若不切 ⇒ 走下面这条包体策略。
- ⚠️ **包体策略（若维持路线 A，需产品拍板）**：① 随包 210MB / ② 随包 zip 104MB + 首启解包 / ③ 不随包首启下载 0MB（§7.5.1）。**"复用 Electron Chromium 给 SSR"已实证不可行，不再是选项**（但**走 CSR 就天然复用**了，这正是路线 B 的价值）。
- ⏸ **Electron 主进程内渲染 + `binariesDirectory` 是否需要** → 仅路线 A 需要（路线 B 用渲染进程，无此问题）。
- ⏸ **残留浏览器进程** → 仅路线 A 需要（路线 B 无独立浏览器进程）。
- ⏸ **arm64 路径与通用包体积** → 仅路线 A 需要（路线 B 用 Electron 自带，无平台二进制）。
- **词级字幕二期投入**：前置是 Drama TTS 支持时间戳或引入 forced alignment（§10.3 / §14 P1）。

### 15.2 风险登记册
| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| ~~**Remotion 升级后 headless-shell 版本被自动替换**（本机无网 → 渲染直接失败）~~ ✅ **已解决（Spike 实测）** | 中 | 用户端渲染不可用 | **镜像预置**（`spike-remotion/pipeline/s0b-prefetch-browser.sh`：官方源 20 KB/s → 镜像 26 MB/s；`VERSION` 写对即 0.0s 命中）；把"Remotion 版本 ↔ `TESTED_VERSION`（本题 157.0.8080.0）"写进升级检查清单 |
| ~~**预构建 bundle 无法注入素材**~~ ✅ **已证伪（Spike 实测 S3b）** | — | 决策 5 原本可能失效 | 注入模型成立，落点 `<renderDir>/public/cs-assets/`（§0 R13）；开发态回退**不再需要** |
| **Electron 主进程内渲染未验证** | 中 | 打包后可能起不来 | 需在用户终端实跑一次；若报缺库则显式传 `binariesDirectory` 指向 `node_modules/@remotion/compositor-<platform>`（官方点名 Electron 属"未支持环境"）+ `asarUnpack`（§15.3） |
| **arm64 路径与通用包体积** | 中 | 通用包体积 +42M；M 系性能未取基线 | 已量：compositor x64 25M + arm64 17M；**M 系性能基线需在 Apple Silicon 机另取**（本机 Intel 基线不含 shared-memory capture，不能外推） |
| 打包期 Electron / 依赖下载挂住（国内无 VPN） | 高 | 构建失败 | 导出 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（§15.3）；npm 侧确认走镜像（本项目已用 npmmirror） |
| agent shell 搬运带 provenance 的 Electron 二进制失败 | 中 | 本地打包需用户终端跑 | 让用户在自己终端跑 `electron-builder --universal`（项目已踩实） |
| 逐帧渲染竞态（jank / 错位帧） | 中 | 成片糊 | 组件纯函数化（§7.2）；`concurrency:1`；shared-memory capture（仅新平台，不作为正确性依赖） |
| **`chromiumOptions.gl` 在 macOS + Electron 下不稳定** | 中 | 渲染黑屏 / 崩溃 | 阶段 0 实测 `angle` / `swangle` / 缺省三档；把结论写死进代码注释 |
| **素材轨声明时长与真值不符** | 中 | 截断或末帧冻结（静默错误） | §4.5 + §10.4：口径锁死 `list_shots` 真值 + 宿主核对修正 + warning + HITL 双列展示 |
| 自托管字体源（Drama `/fonts/` 路由）未建 | 中 | 多语言字体下载链路不可用 | MVP 只依赖随包子集（离线闭环）；下载链路后置，缺失时 fallback + warning 不阻断（§8.3） |
| 成片体积/时长超 storyboard 目标 | 低 | 偏离立项 | 复用 `auditTimeline`（compose.ts:356）做时长漂移告警 |

### 15.3 打包期 Electron / Remotion 的具体坑（已核实项目环境）
- **国内无 VPN**：`electron-builder` 从 GitHub 下载 Electron 本体/工具，单个 request 挂满 600s 才超时。复跑前必须导出：
  ```bash
  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```
- **agent shell 搬运限制**：受管 shell 拒绝搬带 `com.apple.provenance` 的文件（如 `app.asar`），`electron-builder --universal` 必失败 → **让用户在自己的终端跑**打包。
- **ELECTRON_RUN_AS_NODE 泄漏**：从 agent shell 启动 GUI/Electron 须 `env -u ELECTRON_RUN_AS_NODE`；渲染验证在用户终端做。

**Remotion 侧新增（v1.1）**：
- **Electron 属"官方未支持环境"**：Remotion 官方对 `binariesDirectory` 的说明明确点名 "*useful in environments where Remotion is not officially supported to run like bundled serverless functions **or Electron**"* ⇒ 打包后若报"找不到平台二进制/共享库"，就在 `renderMedia` / `selectComposition` 里显式传 `binariesDirectory` 指向 `node_modules/@remotion/compositor-<platform>`（asar 场景需 `asarUnpack`）。
- **`@remotion/compositor-<platform>` 必须解包**：它是 `dylib` + 可执行文件（darwin-arm64 = 18,034,429 B，含 13.8MB `libavcodec.dylib`）。打进 asar 会因**动态库无法从 asar 内加载**而失败 → `asarUnpack` 白名单加 `**/@remotion/compositor-*`。
- **headless-shell 的打包位置**：默认在 `node_modules/.remotion/chrome-headless-shell/<platform>/`，**不在** `node_modules` 的常规分发路径上（很多打包配置会漏掉它）→ 随包需显式收进 `extraResources`，且**连 `VERSION` 文件一起**（缺了会被判定为未安装而触发重下）。
- **asar 只读 → renderDir 必须在用户可写目录**：`renderDir` 建在 `tmpdir()`，素材靠 `link`/`copy` 注入，bundle 模板从 `resourcesPath` 复制 —— 这条链**不能**依赖"往 app 包内写文件"。
- **随包字体**：`public/fonts/` 若进 asar，`staticFile()` 读不到（bundle 复制阶段会尝试读源文件）→ 字体要么在**预构建 bundle 阶段就复制进 bundle 产物**（推荐，产物随包即自带），要么 `asarUnpack`。

---

## 16. 工作量估算

| 阶段 | 人天（单人） | 关键产出 |
|---|---|---|
| 0 Spike | 2.5d | **API 骨架跑通记录（R1–R3 修正验证）+ 浏览器来源实测 + renderDir 待验项结论** + 字体链路验证 + License 快照 |
| 1 契约 | 2.5d | manifest.ts + 测试 |
| 2 组件库 | 6d | 6 组件（含 `calculateMetadata`）+ `timing.ts` 纯函数 + 字体加载 fonts.ts |
| 3 工具 | 5d | render_composition + render-dir.ts（含时长核对）+ remotion-render |
| 4 skill | 3d | code-driven-explainer + 字幕时序（§10.3）+ 素材时长口径（§10.4） |
| 5 质检 | 2.5d | runShotQc 适配取证 + slideshow-risk |
| 6 打包 | 5d | 依赖 + 浏览器随包 + asar/二进制联调 + 体积审计 |
| 7 T3+文档 | 2.5d | proof table + 计数同步 |
| **MVP 合计** | **≈ 16–22d（3~4 周）** | 不含阶段 6 长尾约 +5d |

> v1.1 增量与减量相抵：**减**=不再实测两种浏览器、不引入组件测试栈；**增**=`calculateMetadata` / `renderDir` / 素材时长核对三项验证。总量级不变。
> v1.2 追加：**skill 侧合规 +0.5d**（`platform.yaml` + `BUNDLED_CATALOG` 快照 + 两道新门禁整改），B4 由 3d → 3.5d。总量级仍不变。
> **v1.3 实测基线（Intel Mac，无 shared-memory capture）**：`renderMedia` @1280×720 ≈ **0.08–0.10 s/帧**（90 帧 9.3s / 30 帧 2.5s）⇒ **30s 片（900 帧）约 75–90s**；`bundle()` 首次 7.3s。这是"同步工具"决策的量化依据（§15.1 决策 3），也与 `compose_video` 同档。
> **阶段 0 实际耗时**：**1 个工作日内完成**（原估 2.5d）—— 因为镜像预置解决了最大的下载等待，且 S1–S4 脚本一次跑通。

---

## 17. 结论与我的评估（见 demo §5）

### 优势（为什么这件事值得做）
1. **边际成本极低**：80% 地基（agentic skill、Drama 模型层、ffmpeg 后期、storyboard 契约、HITL、错误系统）已具备，Remotion 只补最薄一层。
2. **补齐能力断层**：现有"纯模型驱动"缺"精确动画 / 字幕 / 数据卡 / 批量模板"，这正是 OpenMontage 模式的核心价值，REQ-034 直接受益。
3. **License 零成本**（两人公司），且免费档允许"LLM 生成代码 + 自行渲染"（官方 automation 定义内）。
4. **不破坏主干**：并联旁路工具，返回同形状结果，客户端/agent 零改动，回归风险可控。

### 风险（需要正视）
1. **浏览器与平台二进制是本事项最"环境敏感"的一环**（headless-shell 版本被自动替换、Electron 属官方未支持环境、asar 解包），但路径明确（§7.5 方案 A/C + §15.3），且都在阶段 0/6 有明确验证动作。
2. **逐帧渲染**的工程坑（无状态、竞态）需要组件严格纯函数化，但这是 Remotion 成熟范式，不是新难题。
3. **"静默错误"是这类合成最危险的一类**（漏 `calculateMetadata` → 时长不对；素材时长估错 → 末帧冻结；`publicDir` 与预构建 bundle 冲突 → 素材读不到）。v1.1 已把三处都写成显式机制 + 校验 + warning（§4.5 / §7.2 / §8.1）。
4. 视觉/UX 不在自动覆盖内（项目铁律），最终靠你桌面验收。

### 我的建议
- **按本文件 §13 的 7 阶段推进**；阶段 0 必须**先把 §15.1 的两个待验项跑出结论**（headless-shell 落地形态 + 预构建 bundle 能否注入素材），这两条决定阶段 6 的形态，后面全是增量、可单测、可回滚。
- **不要照搬 OpenMontage 的 YAML manifest**，复用现有 storyboard 契约派生 Manifest（§4.6），避免第二套事实源。
- **MVP 范围守住 §1.2**，LLM 动态 JSX / 云渲染 / 字体下载链路留二期，别在第一步就铺太大。
- **别试图"合并 ffmpeg"**（§0 R1）：Remotion 的编码器与我们的 ffmpeg 在 v4 里是两条独立链，强行合并会踩官方明确的禁区，收益也不成立（那套平台包只有 ~17MB）。

---

## 附录 A：关键文件速查表
| 用途 | 路径 | 行 |
|---|---|---|
| 工具注册入口 | `canvas-studio/src/host-tools.ts` | 1270 |
| compose_video 范本 | `canvas-studio/src/host-tools.ts` | 2290 |
| resultSchema（同形状返回） | `canvas-studio/src/host-tools.ts` | 67 |
| renderComposeResult（落盘命名） | `canvas-studio/src/host-tools.ts` | 250 |
| 审批门 `assertApprovalAllowed` | `canvas-studio/src/host-tools.ts` | 748 |
| 门禁表 `FORMAL_TOOLS`（**登记工具名**） | `canvas-studio/src/approval-gate.ts` | 65 |
| `COMPOSED_FALLBACK` | `canvas-studio/src/host-tools.ts` | 838 |
| `newAssetId` / `sizeForAspectRatio` | `canvas-studio/src/config.ts` | — |
| `StudioAudioComposition` 契约 | `canvas-studio/src/contracts/canvas.ts` | 102 |
| 成片结果形状 | `canvas-studio/src/compose.ts` | 63 |
| 落成片节点 | `canvas-studio/src/compose.ts` | 628 |
| 资产反查 | `canvas-studio/src/compose.ts` | 118 |
| `BGM_MIX_VOLUME` | `canvas-studio/src/compose.ts` | 44 |
| ffmpeg 路径（**仅混音/探测**） | `canvas-studio/src/ffmpeg-run.ts` | 128 |
| 媒体探测 `probeMediaInfo` | `canvas-studio/src/ffmpeg-run.ts` | 278 |
| `probeMediaDuration` | `canvas-studio/src/ffmpeg-run.ts` | 299 |
| 时长漂移校验 | `canvas-studio/src/compose.ts` | 356 |
| BGM 守卫 | `canvas-studio/src/compose.ts` | 253 |
| 混音参数 `buildAmixArgs` | `canvas-studio/src/compose.ts` | 281 |
| 镜头质检 | `canvas-studio/src/quality-check.ts` | 217 |
| Drama 端点 | `canvas-studio/src/config.ts` | 62–84 |
| 工具计数常量 `EXPECTED_TOOL_COUNT` | `canvas-studio/tests/tool-registry.test.mjs` | 36 |
| 工具名单 | `canvas-studio/tests/tool-registry.test.mjs` | 39–64 |
| 注册门禁测试 | `canvas-studio/tests/skill.test.mjs` | 102 |
| 工具表（skill 分册） | `canvas-studio/skills/canvas-studio-creation/references/toolchain.md` | **按行首匹配定位，勿引行号**（2026-10-15 被重写，原 :55 已漂） |
| 新 skill 展示元数据（CV-324） | `canvas-studio/skills/<name>/platform.yaml` | 必需，9 必填字段 |
| 展示元数据快照（CV-324） | `canvas-studio/src/skill-catalog.ts`（`BUNDLED_CATALOG`） | 与 platform.yaml 逐字段相等 |
| skill 合规门禁 | `canvas-studio/tests/`：`skill-platform-meta` / `skill-progressive-disclosure` / `skill-tool-refs` / `skill-catalog` / `skill-role-consistency` | — |
| skill 扩充规范 | `canvas-studio/docs/skill-expansion-spec.md` | 新增 skill 的唯一路径 |
| **B0 Spike 报告** | `canvas-studio/docs/remotion-spike-report-2026-10-15.md` | 含全部物证 + 重放命令（阶段 0 结项件） |
| **License 原文存档** | `canvas-studio/docs/remotion-license-snapshot-2026-10-15.md` | 取自 `remotion@4.0.535` 包内 `LICENSE.md` |
| **Spike 工程（可重放）** | `canvas-studio/.workbuddy/spike-remotion/` | gitignored；`pipeline/s0..s4` + `s0b-prefetch-browser.sh` |
| 工具文档 | `canvas-studio/docs/canvas-studio-tools.md` | — |

**Remotion 侧速查（v1.1 新增，均为核对过的实测/官方结论）**

| 事实 | 值 / 结论 |
|---|---|
| 锁定版本 | `remotion` **4.0.535**（核对时最新）；**无 `@remotion/core`、无 `@remotion/test-renderer`** |
| 运行时包 | `remotion` / `@remotion/renderer` / `@remotion/bundler` / `@remotion/media`；devDep 仅 `@remotion/cli` |
| 编码器 | 自带，位于 `@remotion/compositor-<platform>`；**`ffmpegExecutable`/`ffprobeExecutable` 在 v4 已移除**；整体替换只能靠 `binariesDirectory` |
| 平台包体积 | darwin-arm64 = 18,034,429 B（`libavcodec.dylib` 13.8MB + `ffmpeg` 305KB + `ffprobe` 169KB + `remotion` 1.2MB） |
| 浏览器 | 默认 **Chrome Headless Shell**，落 `node_modules/.remotion/chrome-headless-shell/<platform>/`（带 `VERSION`）；`browserExecutable` 为覆盖入口但**官方警告勿指向不兼容 Chrome**；`chromeMode` 可选 `headless-shell`/`chrome-for-testing` |
| 渲染三步 | `bundle()` → `selectComposition({serveUrl, id, inputProps})` → `renderMedia({composition, serveUrl, codec:'h264', …})` |
| 动态元数据 | `<Composition calculateMetadata={…}>`（v4.0.0+）返回 `{durationInFrames, fps, width, height, props}` |
| 静态资源 | `bundle({publicDir})` 在**bundle 阶段**把文件复制进 bundle 目录；`staticFile()` 相对其解析 |
| 许可 | 个人 / ≤3 人公司 Free License：全功能、商用、可跑 automation；≥4 人须 Company License（含 "团队扩张须升级" 条款） |
| 官方文档锚点 | `remotion.dev/docs/renderer/render-media`、`/renderer/select-composition`、`/bundle`、`/dynamic-metadata`、`/miscellaneous/chrome-headless-shell`、`/license/faq`、`/testing` |

## 附录 B：假数据全流程走通示例（剧本 → 成片，见 demo §2）
1. **剧本**：「做一条 30 秒科普视频，讲睡眠的科学，要有字幕卡、数据卡、一张大脑图做 Ken-Burns、一段实拍睡眠片段、旁白 + BGM。」
2. **素材生成**（复用现有工具）：`image_generate` 出 `brain.png` → `upload_image` → `video_generate` 出 `sleep-clip.mp4` → `tts_voiceover` 出 `voice.mp3` → `music_generation` 出 `bgm.mp3`。各落画布节点。
3. **skill 组装 Manifest**（§4.4 假数据）：有旁白先 `probeMediaDuration` 探真值总长 → 按 §10.3 字数比例分配生成字幕卡时序 → 在 HITL checkpoint 展示时序表（5 轨道 + 1 转场）。
4. **用户批准** → `render_composition({ manifest })`：
   - `validateManifest` 通过 → `prepareRenderDir` 把 4 个素材 `link` 进 `renderDir/cs-assets`（顺带核对 video 轨时长）→ `selectComposition`（执行 `calculateMetadata` 定 900 帧 / 30fps / 1280×720）→ `renderMedia({codec:'h264'})`（Chrome Headless Shell 逐帧 + Remotion 自带编码器）→ `probeMediaInfo` 探真值 30.0s / 1280×720 → `buildAmixArgs` 混 BGM+旁白（守卫 BGM ≥ 30s）→ `appendComposedVideoNode` 落 video-composite 节点。
5. **质检**：`runShotQc` + `scoreSlideshowRisk`（本例 video 占比 29% + 有转场重叠 + 有旁白 → score 低，无 warning）。
6. **成片节点**出现在画布，角标显示「16:9 · 30s · 1280×720 · native+bgm」，血缘指向 4 个素材节点。

> 整个流程除第 4 步的 `render_composition` 是新工具外，其余全部复用现有链路——这正是「并联旁路、80% 复用」策略的体现。
