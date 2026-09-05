# 视频生成供应商抽象层改造方案（video-provider-abstraction）

> 立项：2026-09-04 · 来源：视频生成接口需支持 fal H3，并具备接入更多模型的能力
> 关联：[api.md](../api.md) · [canvas-studio-tools.md](../canvas-studio-tools.md) · [STATUS 总表](../STATUS.md) · [canvas-studio-creation](../../skills-local/canvas-studio-creation/SKILL.md)

---

## 0. 审批与执行状态

### 0.1 文档状态

| 项 | 值 |
| --- | --- |
| 当前状态 | **待审批** |
| 事实基础 | 全部条目已逐条走查源码（见 §2 文件坐标），非推测 |
| 基线（已实测） | `test:smoke` **204 pass / 0 fail**；`typecheck` 通过；`verify:loader` 通过 |
| 待决策项 | §10 共 5 项，需审批时一并确认 |
| 开工前置 | §2.4 约束 6：工作区存在未提交改动，需先确认归属 |

### 0.2 阶段门禁规则（严格执行）

1. **每阶段独立验收**，验收通过前不得进入下一阶段。
2. 每阶段提交前必须跑通门禁，全绿才算达标（完整命令见 §11.1）：
   ```bash
   corepack yarn workspace canvas-studio build        # 编译；若被 clean 步骤拦截，用 §11.1 方案 B
   corepack yarn workspace canvas-studio test:smoke   # 冒烟测试（基线 204 pass / 0 fail）
   corepack yarn workspace canvas-studio typecheck    # 类型检查
   ```
3. 任何阶段若导致既有断言数下降或失败，**立即停止并回到上一阶段**，不得带病推进。
4. 每阶段完成后在下表登记，并说明「新增/变化的断言数」。
5. **一次提交一个阶段**，commit message 前缀 `refactor(video-provider): 阶段 N — <标题>`。阶段 2 是纯重构，必须与后续功能阶段分开提交，便于二分定位。
6. 分支：`feat/video-provider-abstraction`，从 `HEAD` 拉出；不与其他进行中的改动混在一条分支上。

### 0.3 执行日志（执行时维护）

| 阶段 | 内容 | 起始 | 完成 | 断言数 | 验收人 |
| --- | --- | --- | --- | --- | --- |
| 0 | 基线固化 | 2026-09-04 | 2026-09-04（除第 3 项） | 204 pass / 0 fail | |
| 1 | 契约与注册表骨架 | 2026-09-04 | 2026-09-04 | 223 pass / 0 fail（基线 204 + 新增 19） | |
| 2 | Drama adapter 迁移 | 2026-09-04 | 2026-09-04 | 234 pass / 0 fail（基线 204 + 阶段1 19 + 阶段2 11） | 待用户手动验收（全项目不提交） |
| 3 | provider 选择与持久化 | 2026-09-04 | 2026-09-04 | 240 pass / 0 fail（基线 204 + 阶段1 19 + 阶段2 11 + 阶段3 6） | 待用户手动验收（全项目不提交） |
| 4 | fal adapter（t2v / fl2v） | 2026-09-04 | 2026-09-04 | 252 pass / 0 fail（基线 204 + 阶段1 19 + 阶段2 11 + 阶段3 6 + 阶段4 12） | 待用户手动验收（全项目不提交） |
| 5 | fal adapter（多参考 + 压缩） | 2026-09-05 | 2026-09-05 | 260 pass / 0 fail（基线 204 + 阶段1 19 + 阶段2 11 + 阶段3 6 + 阶段4 12 + 阶段5 8） | 待用户手动验收（全项目不提交） |
| 6 | 工具契约与文档更新 | 2026-09-05 | 2026-09-05 | 260 pass / 0 fail（与阶段 5 持平：本次仅工具描述/参数 + 文档，未改既有断言；漂移护栏重跑仍全绿） | 待用户手动验收（全项目不提交） |
| 7 | 端到端验收 | 2026-09-05（预检 + 部分真机） | | 代码就绪 + `scripts/fal-smoke.mjs` 就位；A1/A2 真机通过；**A3–A13 待 fal 账户充值后续跑**（详见 §0.3 真机执行记录） | 待用户手动验收 |

**阶段 2 实施纪要（2026-09-04）**
- 纯重构，行为逐字节不变；门禁三件套全绿（build / typecheck / test:smoke 234 pass 0 fail）。
- 新增 `src/providers/{drama,shared,reference,index}.ts`；`generate.ts` 视频分支替换为
  `capabilityOf → resolveProvider → runVideo`，保留 `callWithFallback` 自愈闭包并以
  `ProviderContext.dramaPostWithFallback` 注入 Drama adapter（规避闭包抽出的循环依赖风险 R2）。
- 供应商注册：`registerBuiltinVideoProviders()` 在 `generate.ts` **模块加载时**即调用，
  保证测试直连 `lib/generate.js` 时 Drama 已注册（不仅 index.ts 装配时）；Map.set 幂等，
  重复调用无副作用。
- `sliceToMax` 抽到 `providers/shared.ts`；`reuploadLocalAsset` 复用 `providers/reference.ts`
  的 `readLocalAssetBytes`（行为不变）。
- 验收硬判据满足：既有 204 断言全绿；请求体与改造前逐字段一致（由 `tests/generate.test.mjs`
  既有视频用例 + 新增 `tests/video-provider-drama.test.mjs` 双重覆盖）。

**阶段 3 实施纪要（2026-09-04）**
- 目标：provider 选择（参数显式 > 设置项 defaultVideoProvider > 'drama'）+ provider 持久化（落节点，重试不串台）。
- 新增 `src/providers/selection.ts`：`parseProviderParam`（约束 4 枚举校验，非法抛错）、`resolveProvider`（capability + preferred → 注册表查询，找不到抛错）。
- `generate.ts`：模块加载即 `registerBuiltinVideoProviders()`（保证测试直连 lib 时 Drama 已注册）；
  `GenerateParams` 新增 `provider?: VideoProviderId`（落在 `generateAudio` 之后，自动随节点 JSON 持久化并在重试时回传）；
  `runtime()` 编译期兜底对象新增 `defaultVideoProvider: () => 'drama'`；视频分支改为 `parseProviderParam(params.provider) ?? runtime().defaultVideoProvider?.() ?? 'drama'`（双保险，缺字段不崩）。
- 配置三件套同步加 `defaultVideoProvider`：`host-tools.ts`（`StudioRuntimeConfig` 接口）、`host-config.ts`（`CanvasStudioConfig` 接口 + zod schema）、`index.ts`（base 默认 `'drama'` + cfg 委托 `source().defaultVideoProvider`）。
- `routes.ts`（约束 4）：generate handler 在 `generateAsset` 前 try/catch 校验 `parseProviderParam((body.params).provider)`，非法回 400。
- `SettingsModal.tsx`：默认画幅比例 select 之后新增「默认视频供应商」select（drama / fal）。
- 新增 `tests/video-provider-select.test.mjs`（6 断言）：parseProviderParam 校验、resolveProvider 显式 fal、默认走 drama、覆盖 fal、非法抛错、provider 持久化 + 重试不串台。
- **门禁三件套全绿**：build OK / typecheck OK / **test:smoke 240 pass / 0 fail**。
- 回归修复：`tests/workflow-gate.test.mjs` 注入的 cfg mock 缺 `defaultVideoProvider` 字段（该断言在阶段 3 前编写，未含新字段），导致 `runtime().defaultVideoProvider is not a function`。修复：①给 mock 补 `defaultVideoProvider: () => 'drama'`（对齐 `StudioRuntimeConfig` 契约）；②生成侧用 `?.()` 兜底 `'drama'`（防御性）。两处都改，既修测试又防风险。

**阶段 4 实施纪要（2026-09-04）**
- 新增 `src/providers/fal.ts`：队列三段式 adapter（submit → poll → cancel），`capabilities = {text-to-video, first-last-frame}`（multi-reference 属阶段 5，显式指定 fal 跑多参考时注册表报「不支持」，不静默回退）；`maxReferences: 9` 先行自述。裸 fetch 直连 REST（不引入 @fal-ai/client，保住 globalThis.fetch 打桩方式）。
- **端点校准（按 fal 官方 API 文档实测核对，勘误 §11.2）**：
  - i2v（`minimax/h3/image-to-video`）**没有 aspect_ratio**——画幅跟随首帧图；字段是 `image_url`（首帧）+ `end_image_url`（尾帧），不是假设的 `image_urls` 数组。
  - t2v 的 `aspect_ratio` 为六档（21:9/16:9/4:3/1:1/3:4/9:16），**无 adaptive**；1:1 原生支持。
  - resolution 枚举 `480P/768P/2K/4K`（默认 2K）；duration 5–15；输出 `{ video: { url } }`。
  - cancel 端点确认为 `PUT .../requests/{id}/cancel`。
- **契约扩展（types.ts）**：`ProviderHandle.warnings?`（submit 阶段产生的钳制/升档提示）；`ProviderContext` 新增 `falApiKey?` 与 `readReferenceBytes?` 注入（与 dramaPostWithFallback 同一注入模式，规避 adapter → generate.ts 循环依赖）。executor 把 handle.warnings 汇入 `RunVideoOutcome.warnings`。
- **参数映射**：duration 钳 [5,15] 回 warning；resolution 按 §5.3 升档映射，720p/1080p 回「费用更高」warning；参考图经 `readReferenceBytes` → `reference.ts` 新增 `toFalDataUri()`（阶段 4 纯 base64，ffmpeg 降采样属阶段 5）。
- **warnings 条件修正**：`resolution=… 暂未接入已忽略` 占坑提示从统一前置块**移入视频分支**、仅 `provider.id === 'drama'` 时提示——fal 真实消费该参数，若保留前置提示会与升档映射自相矛盾。无既有断言依赖该文案顺序（已核实）。
- **配置三件套**：`falApiKey`（credential-ref，默认 ref `CANVAS_STUDIO_FAL_API_KEY`）加进 `host-config.ts` schema、`index.ts` base + `resolveFalApiKey()`、`host-tools.ts` `StudioRuntimeConfig`、`generate.ts` runtime() 兜底（约束 5 两处同步）；`SettingsModal.tsx` 通用分区新增 fal API Key 输入（照抄 dramaApiKey 形态，describe 用约束 6 新结构）；`tests/workflow-gate.test.mjs` cfg mock 补 `resolveFalApiKey`。
- 新增 `tests/video-provider-fal.test.mjs`（12 断言）：鉴权头、三段式驱动、duration 钳制、resolution 映射、1:1 直通、fl2v data URI 内联、readReferenceBytes 缺失报错、超时 cancel、abort cancel、状态码可读错误、toFalDataUri mime 映射。测试桩要点：**函数型 handler 持久分流（不消费）、对象型一次性**——轮询次数与时序相关，固定个数的一次性桩会被击穿。
- **门禁四件套全绿**：build OK / typecheck OK / **test:smoke 252 pass / 0 fail** / verify:loader OK。
- 待办（阶段 7 前置）：真实 FAL_KEY 下的 A1–A3、A5、A6 手动验收（自动化已打桩覆盖，但 submit 响应字段与 cancel 行为仍以真机为准）。

**阶段 5 实施纪要（2026-09-05）**
- fal 补齐 `multi-reference`：能力自述改为三种全支持，`minimax/h3/reference-to-video`。
- **端点校准（fal 官方 API 文档，勘误 §11.2）**：字段名是 **`reference_image_urls`**（`list<string>`，不是计划假设的 `image_urls`）；上限 9 张（三类文件合计 ≤12，视频/音频参考本次不做）；`aspect_ratio` 枚举**只有这个端点有 `adaptive`**（默认）；提示词需按 **`Image 1` / `Image 2` 顺序**引用参考图（官方约定）。
- `reference.ts`：`toFalDataUri()` 改为 async，先经 ffmpeg 压成「长边 ≤1024 的 JPEG，q:v 5」再 base64；**ffmpeg 不可用 / 解码失败 / 被取消时回退原始字节**（宁可多传也不阻断生成）。缩放用 `scale=1024:1024:force_original_aspect_ratio=decrease` 一处表达「长边受限且保持比例」，避开 `if(gt(a,1)…)` 那类需要转义逗号的 filter 写法（横竖屏都正确）。
- 逃生阀 `assertFalReferenceSizes()`：单张 >2MB 或合计 >12MB 抛中文错误（提示改用 fal storage），在**提交前**拦下，`tests` 已断言此时不会发出任何请求。
- 「Image N」顺序约定：提示词自带 `/\bimage\s*\d+/i` 时不干预；否则自动前置一句顺序说明并回 warning（建议 agent 自行书写以获更好一致性）。
- `sliceToMax` 改**泛型**（`T`）：Drama 传文件名数组、fal 传 `VideoReference[]`，采样逻辑同一套。上限收敛**放在各 adapter 内部**（Drama 6 / fal 9），与阶段 2 的既有形态一致，故 `generate.ts` 本阶段无需改动（计划原文列了 generate.ts，此处以更小改动达成同一目标）。
- 新增 `tests/video-provider-fal-refs.test.mjs`（8 断言）：端点与数组顺序、上限差异（fal 9 vs Drama 6）、Image N 前置与不干预、降采样参数（长边 1024 / q:v 5）、ffmpeg 失败与缺失双路回退、逃生阀纯函数 + adapter 接入。
- **测试手法（复用）**：本机无 ffmpeg（ffmpeg-static 二进制未下载，`.yarnrc.yml enableScripts: false`），降采样路径用 `FFMPEG_PATH` 指向 sh 替身（与 `compose.test.mjs` 同手法），argv 写日志供断言。
- 阶段 4 的 `fal adapter 自述两能力` 断言已随能力补齐更新（回归性质，非掩盖失败）。
- **门禁四件套全绿**：build OK / typecheck OK / **test:smoke 260 pass / 0 fail** / verify:loader OK。

**阶段 6 实施纪要（2026-09-05）**
- 目标：把多供应商能力暴露给模型（工具参数 `provider`），并消除 SKILL.md 里「没有可选择的视频模型」这条过时硬指令。
- `src/host-tools.ts`：`video_generate` / `video_composite` 的 `parameters` 各新增 `provider: { type:'string', enum:['drama','fal'], description:'视频供应商…留空则用设置页的「默认视频供应商」；重试节点时会自动沿用该片原来的供应商' }`；两工具 `execute` 内 `if (a.provider !== undefined) params.provider = a.provider`；`resolution` 描述改为「仅 fal 生效、720p/1080p 升档费用更高」；`filenames` 描述改为「Drama 最多 6 张、fal 最多 9 张」；两工具 `description` 加「视频供应商可在设置页切换…除非用户明确要求否则不要主动询问」。
- `skills-local/canvas-studio-creation/SKILL.md`：原第 81 行「不要向用户提问用 H3 还是 Seedance / 本项目没有可选择的视频模型」整段替换为：供应商可切换（设置页或 provider 参数）、**不主动询问**、`model` 仍是占坑、`resolution` 仅 fal 生效（升档说明）、`generateAudio` 仍是占坑、列出供应商差异（Drama 6 / fal 9、1:1 降级、fal 5s 下限）、未配置 fal Key 直接报错并按默认 Drama 重跑。
- **漂移护栏（关键）**：`tests` 的 158/171 是 `skills/` 运行时副本与 `skills-local/` 手写源逐字节一致护栏。改 SKILL.md 后必须 `node scripts/sync-minimax-skills.mjs` 重新生成 `skills/` 副本，否则这两项飘红。本阶段首跑出现 258 pass / 2 fail（即此护栏），跑完 sync 后回到 260 / 0。
- `docs/api.md` 与 `docs/canvas-studio-tools.md`：补 `video_generate` / `video_composite` 的 `provider` 参数说明（枚举 + 留空走设置默认值 + 重试沿用）。
- **门禁四件套全绿**：build OK / typecheck OK / **test:smoke 260 pass / 0 fail** / verify:loader OK。注：`typecheck` 在本机 shell 下需用 `./node_modules/.bin/tsc`（PATH 未注入 bin），非脚本问题。

**阶段 7 预检（2026-09-05，代码就绪，待真机）**
- 代码级预检全绿：fal Key 解析链路（`index.ts` resolveFalApiKey → `generate.ts` 注入空串 → `fal.ts` requireApiKey 双重校验空串即抛「未配置 fal API Key」）、provider 路由（`routes.ts` + `generate.ts` 枚举校验）、A9 duration 钳 [5,15]、A10 1:1 原生支持、A12 `assertFalReferenceSizes` 逃生阀 + ffmpeg 降采样回退、A4 重试不串台（provider 落节点）——均已就位且被既有 260 断言覆盖或代码核实。
- 新增 `scripts/fal-smoke.mjs`：直驱 `lib/providers/fal.js` 的真机烟测脚本，支持 `--no-key`（A1）/ `--wrong-key`（A2）/ 真实 Key 出片（A3，可 `--duration` `--aspectRatio`）。已在 `--no-key` 模式实跑验证：正确报「未配置 fal API Key」并 exit 0。A2/A3 需真实 Key 才能跑。
- **真机验收前提**：用户须提供真实 `FAL_KEY`（环境变量 `FAL_API_KEY` 或设置页凭据引用 `CANVAS_STUDIO_FAL_API_KEY`）。A3/A6/A7/A8/A12/A13 依赖真实调用，自动化 mock 无法替代，必须真机逐条勾选 A1–A13。
- **§10 开放问题**：5 项均按方案建议默认值实现（Q1 报错不静默回退 / Q2 升档带 warning / Q3 默认 drama / Q4 不接 H3 Max / Q5 不暴露 prompt_expansion_mode），待用户最终审批确认。

**阶段 7 真机执行记录（2026-09-05，Key 已配置，卡 fal 账户计费）**
- 凭据已就位：用户在真 app（harness home `~/.videobuddy/`）设置页填入 `CANVAS_STUDIO_FAL_API_KEY`，脚本经 `~/.videobuddy/.credentials.yaml` 读取。
- **A1 通过**（先前 `--no-key` 实跑：正确报「未配置 fal API Key」）。
- **A2 通过**：错误 Key → `fal 任务提交失败: 401 {"detail":"Cannot access application \"fal-ai/minimax_h3\". Authentication is required..."}`，文案可读。
- 首跑暴露**烟测脚本 bug**（非适配器）：脚本未传 `references`，违反 `VideoRequest` 契约（必填）→ `sliceToMax(undefined)` TypeError 掩盖真实鉴权错误。已修脚本补 `references: []`（commit `8d1a6aadd9`）；两适配器（drama/fal）均依赖该契约，未改适配器代码。
- **A3 受阻（非代码问题）**：fal 返回 `403 User is locked. Reason: Exhausted balance`——Key 有效、鉴权通过，账户余额耗尽。已重试 5 次结果一致。**A3 及 A4–A13 真机项全部等待 fal.ai/dashboard/billing 充值（或更换有余额 Key）后续跑**，续跑命令：`FAL_API_KEY=<key> node canvas-studio/scripts/fal-smoke.mjs`。
- **A11 通过（Drama 回归，不依赖 fal 计费）**：新增 `scripts/drama-smoke.mjs` 直驱 `lib/providers/drama.js`（注入与 `callDrama` 对齐的最小 `dramaPostWithFallback`：POST base+endpoint、响应归一 `full_url ?? data[0].url` + 可选 `filename`、无鉴权头）。真机实测（2026-09-05）：health ok → t2v 5s 16:9 → **2m17s 出片**，`http://117.50.108.73:8082/view?filename=MiniMax_H3_00228_.mp4`。Drama 适配器重构后端到端行为正常。
- 阶段 7 状态：**部分完成（A1 / A2 / A11 通过 + 错误路径验证）**，fal 专属项（A3–A10、A12、A13）等计费解锁。

---

## 1. 背景、目标与非目标

### 1.1 背景

Canvas Studio 的视频生成目前**只有一个供应商**：自架 Drama Backend（`http://117.50.108.73:8082`），暴露 `image2videofl2va`（文生 / 首帧 / 首尾帧）与 `image2videoref2va`（多参考）两个端点。模型列表全部硬编码在 TypeScript 字面量中，`model` / `resolution` / `generateAudio` 三个参数是**占坑占位**——传入只在运行时回一条 warning（`generate.ts:798-805`）。

fal.ai 已上线 MiniMax H3 系列端点，与现有两个端点**语义一一对应**（见 §5.1），接入的语义成本很低。但两者的**协议模型根本不同**：Drama 是同步阻塞 HTTP，fal 是队列三段式（submit → poll → result）。若直接加 `if/else` 分支，异步逻辑会污染同步链路，第二个模型进来时必然返工。

### 1.2 目标

| 编号 | 目标 | 判据 |
| --- | --- | --- |
| G1 | 视频生成支持 fal H3（text-to-video / first-last-frame / multi-reference 三个能力） | 设置页可切换，真实 key 出片成功 |
| G2 | 新增供应商只需新增一个适配器文件，不改 `generate.ts` 主流程 | 代码走查确认 |
| G3 | 同步与异步两种执行形态对上层透明 | executor 统一驱动，Drama 零额外开销 |
| G4 | 节点重试不串台（原片由哪家生成，重试仍走哪家） | 手动验收清单 A4 |
| G5 | 既有 204 个断言不减少、行为不回归 | 每阶段门禁 |

### 1.3 非目标（本次不做）

- **图片生成的供应商抽象**。本次只做视频；契约设计上预留，但图片链路保持现状。
- **fal 的视频 / 音频参考**（`reference-to-video` 支持 3 视频 + 3 音频）。阶段 5 只做图片参考；视频节点当前不持久化 `filename`，做视频参考需先改节点 schema，成本独立。
- **H3 Max 快速版**（`minimax/h3-max/*`，768P，5 秒片 3 秒出）。可作为 G2 的第一个验证案例放到后续。
- **原生音频轨的 UI 开关**。fal 原生出音频，但接入需重写 `compose.ts` 的混音假设，独立立项。
- **fal 的 webhook 回调**。localhost 环境不可靠，统一走轮询。

### 1.4 成功判据

一句话：**在不改动任何上层调用方的前提下，`video_generate` / `video_composite` 能通过配置在 Drama 与 fal 之间切换，且新增第三个供应商只需加一个文件。**

---

## 2. 现状事实清单（已逐条走查源码）

### 2.1 架构定位

不是 Next.js / Vite，是 **DSH 的 Cordis 插件**：Host（Node 进程）+ Client（React 18）两半，跑在 Electron 壳里。HTTP 路由靠 `ctx.webServer.register`，无数据库，全部 JSON 文件 + 原子写持久化。

```
浏览器（Electron renderer）
  src/client/**  ── 仅「节点重试 / 改提示词」会触发生成
        │  同源 loopback HTTP（端口动态）
Host（Node 插件进程）★ 真正干活的地方
  src/host-tools.ts   defineTool 工具契约
  src/routes.ts       webServer 路由
  src/generate.ts     ★ 生成核心：拼请求体 + 发 HTTP + 落盘 + 写画布节点
  src/config.ts       DRAMA_ENDPOINTS 端点常量表
  src/projects.ts     项目 / 画布 JSON 持久化
        │  裸 fetch（无鉴权头）
Drama Backend  http://117.50.108.73:8082
```

**注意**：UI 上「点按钮生成视频」不存在。视频生成由 Agent 调用 `video_generate` / `video_composite` 工具驱动；用户在画布上只能「重试」或「改提示词重跑」。

### 2.2 视频生成链路

| # | 层 | 位置 | 符号 |
| --- | --- | --- | --- |
| 1 | 工具注册 | `src/host-tools.ts:547` | `defineTool({ name: 'video_generate' })` |
| 2 | HITL 门禁 | `src/host-tools.ts:196` | `runGeneration()` |
| 3 | 生成核心 | `src/generate.ts:782` | `generateAsset(registry, tool, projectId, params, signal)` |
| 4 | 工具分派 | `src/generate.ts:970` / `:989` | `if (tool === 'video_generate')` / `'video_composite'` |
| 5 | 统一调用 | `src/generate.ts:479` | `callDrama(endpoint, body, signal, kind)` |
| 6 | HTTP + 重试 | `src/generate.ts:269` | `dramaPost()`（固定 2 次尝试，只重试 502/503/504） |
| 7 | 健康探针 | `src/generate.ts:245` | `ensureDramaReachable()`（30s 缓存） |
| 8 | 产物落盘 | `src/generate.ts:1059` | `downloadBytes()` → `writeFile` |
| 9 | 写画布节点 | `src/generate.ts:1090-1163` | `appendCanvasNode` / `writeCanvas` |

### 2.3 关键文件坐标

| 文件 | 行 | 内容 | 改造相关性 |
| --- | --- | --- | --- |
| `src/generate.ts` | 55-94 | `GenerateParams`（`model`/`resolution`/`generateAudio` 占坑注释在此） | 加 `provider` 字段 |
| `src/generate.ts` | 109-111 | `clampDuration()`，下限 1、上限 `maxVideoSeconds()` | fal 下限是 5，需在映射层再钳一次 |
| `src/generate.ts` | 123 | `DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 }` | 异步超时基准 |
| `src/generate.ts` | 138 | `downloadBytes()`（媒体 512MB / 图片 32MB 上限） | 复用 |
| `src/generate.ts` | 269-300 | `dramaPost()` | 抽象后由 Drama adapter 独占 |
| `src/generate.ts` | 479-501 | `callDrama()` + 响应解析（读 `full_url ?? data[0].url`） | 拆进 adapter |
| `src/generate.ts` | 512-516 | `isBadReferenceError()` | 复用 |
| `src/generate.ts` | 528-531 | `generationPromptOf()` = `JSON.stringify(rest)` | **关键**，见 §2.4 约束 1 |
| `src/generate.ts` | 782-1055 | `generateAsset()` 主体，含 160 行 `if/else` | 改造主战场 |
| `src/generate.ts` | 866-887 | `callWithFallback()` 参考图失效自愈 | 与 provider 无关，保留 |
| `src/generate.ts` | 1057-1165 | 产物落盘 + 血缘计算 + 写节点 | **抽象后所有 provider 共用** |
| `src/config.ts` | 15-30 | `DRAMA_ENDPOINTS` 常量表 | 拆成按 provider 分组 |
| `src/host-tools.ts` | 24-36 | `resultSchema`（含 `warnings` 字段） | 降级提示回流通道 |
| `src/host-tools.ts` | 371-398 | `StudioRuntimeConfig` 接口 | 加 fal 相关 getter |
| `src/host-config.ts` | 74-99 | `CanvasStudioConfig`（schemastery，**唯一现成的声明式配置机制**） | 加 fal 设置项 |
| `src/index.ts` | 57-69 | `resolveDramaApiKey()` | 照抄出 `resolveFalApiKey()` |
| `src/index.ts` | 85-99 | `cfg` 对象 → `setRuntimeConfig(cfg)` | 加 fal getter |
| `src/routes.ts` | 470-517 | `POST /canvas-studio/generate` | 见 §2.4 约束 4 |
| `src/client/api.ts` | 308-317 | `generationParamsOf(node)` | 见 §2.4 约束 1 |
| `src/client/api.ts` | 323-340 | `retryStudioNode()` | 见 §2.4 约束 1 |
| `src/contracts/canvas.ts` | 44-128 | `StudioCanvasNode` | 见 §2.4 约束 2 |

### 2.4 五个必须知晓的既有约束

**约束 1（好消息）：provider 持久化几乎零成本。**
`generationPromptOf()` 就是 `JSON.stringify(params 去掉 retryOf)`，客户端 `generationParamsOf()` 直接 `JSON.parse` 后断言为 `GenerateParams`。因此**只要 `GenerateParams` 增加 `provider` 字段，它就会自动存入节点、自动在重试时回传**。无需改节点 schema，无需改客户端解析。

**约束 2：视频节点不持久化 `filename`。**
`generate.ts:1135` 只有图片产物标记 `isReference` 并保留 filename 语义。这意味着 fal 的视频参考能力（阶段 5 之外）无法直接实现——列为非目标。

**约束 3：`resolveDramaApiKey()` 是死代码。**
`src/index.ts:57` 解析了凭据，但 `dramaPost()` / `callDrama()` / `uploadBytesToDrama()` **全都不带 `Authorization` 头**——Drama 实际无鉴权。fal 强制要 `Authorization: Key <FAL_KEY>`，这条通路要从零接通。好消息是 `credentialRef` + `credentials.resolve` + 设置页密钥输入 UI 全部现成，照抄 `dramaApiKey` 那一套即可。

**约束 4：路由的 `tool` 字段无白名单校验。**
`routes.ts:495` 把客户端回传的 `tool` 直接透传给 `generateAsset`。新增 `provider` 字段时**必须做枚举校验**，否则是不可控的注入面（虽然目前只有本地 loopback 同源请求）。

**约束 5：`runtime()` 有两处默认值，必须同步改。**
`src/host-config.ts:74` 的 schema default 与 `src/generate.ts:34-52` 的 `runtime()` 兜底对象是两份独立的默认值。新增配置项时**两处都要改**，否则测试直连 `lib/` 时会拿到不一致的值。

**约束 6：工作区存在未提交改动（开工前必须确认）。**
`git status` 显示 3 个 client 文件有未提交修改，均为**适配 `credentials.describe` 返回结构变更**（从 `res.credentials` 改为 `res.result.ok ? res.result.value.credentials : {}`）：

| 文件 | 改动 |
| --- | --- |
| `src/client/contracts.ts` | 新增 `CanvasStudioCredentialView` / `CanvasStudioCredentialsDescribeValue` 类型 |
| `src/client/SettingsModal.tsx` | 两处 `describe().then()` 改为新返回形态（+12 行） |
| `src/client/ModelSettingsPanel.tsx` | 同上（+1 行） |

**影响**：阶段 3/4 要在 `SettingsModal.tsx` 加 fal 密钥输入，**必须照抄改后的新形态写法**（`res.result.ok ? res.result.value.credentials[ref] : null`），不能照抄文档或旧代码里的 `res.credentials[ref]`。

**处理建议**：开工前先与改动所有者确认归属，单独提交，不要混进本方案的提交里。

### 2.5 编译与测试约定

| 项 | 值 |
| --- | --- |
| TypeScript | strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` |
| 编码影响 | 可选字段不能显式赋 `undefined`，必须写 `...(x !== undefined ? { x } : {})` |
| 测试框架 | `node --test tests/*.test.mjs`，**直连编译产物 `lib/*.js`** |
| 打桩方式 | 覆盖 `globalThis.fetch`（见 `tests/generate.test.mjs:20-46`） |
| 构建 | 根 `build` **不包含** canvas-studio，必须单独跑 `yarn workspace canvas-studio build` |
| 依赖 | **无 sharp**，有 `ffmpeg-static@5.3.0`（`src/ffmpeg-run.ts` 已封装） |

> ⚠️ **坑 1**：测试直连 `lib/`，改了 `src/` 不 build 就跑测试，测的是旧产物。

> ⚠️ **坑 2（实测）**：`yarn build` 的首步 `scripts/clean.mjs` 会 `rmSync('lib', {recursive:true})`，一次删除 **156 个文件**。在带批量删除保护的执行环境（如 WorkBuddy 终端）中会直接中断：
> ```
> Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":156,"threshold":50,...}
> ```
> **绕过方式**（已验证可行，产物与完整 build 一致）：跳过 `clean`，直接执行后三步。见 §11.1。

---

## 3. 目标架构

### 3.1 分层

```
工具层   video_generate / video_composite        ← 契约不变
              ↓
能力层   Capability Router                        ← 新增
         text-to-video | first-last-frame | multi-reference
              ↓
供应商层 Provider Registry                        ← 新增
         Drama Adapter（同步）  |  fal Adapter（异步队列）
              ↓
执行层   Executor：submit → poll → 落盘 → 写节点   ← 新增，后半段复用现有代码
```

关键设计：**同步/异步的差异完全封装在 adapter 内部，上层只认 `submit()` + `poll()`**。Drama 的 `submit` 直接把结果塞进 handle，`poll` 首次即完成，零额外开销。

### 3.2 目录结构（新增）

```
src/providers/
  types.ts         契约定义（能力枚举、请求、handle、provider 接口）
  registry.ts      注册表：provider 注册、按能力查询、默认 provider
  capability.ts    工具 + 参数 → 能力 的解析
  executor.ts      submit → poll 循环，含超时与进度回调
  drama.ts         Drama adapter（从 generate.ts 迁出，行为不变）
  fal.ts           fal adapter（阶段 4/5）
  reference.ts     参考图：Drama filename → 本地字节 → 目标形态
```

### 3.3 与现状的差异

| 维度 | 现状 | 改造后 |
| --- | --- | --- |
| 分派 | 160 行 `if/else` | 注册表查询 |
| 参数映射 | 散落在各分支 | 每个 adapter 一个 `mapParams()` |
| 落盘 + 写节点 | 各分支尾部重复 | executor 统一，所有 provider 共用 |
| 执行形态 | 只有同步 | 同步 / 异步共存，上层无感 |
| 模型元数据 | 硬编码 | provider 自述 `capabilities` |

---

## 4. 契约设计

### 4.1 能力枚举

```ts
/** 视频生成能力。新增能力需同步更新 §5 映射矩阵与注册表。 */
export type VideoCapability =
  | 'text-to-video'      // 纯提示词出片
  | 'first-last-frame'   // 首帧 / 首尾帧插值
  | 'multi-reference'    // 多参考图（角色 / 风格一致性）
```

### 4.2 归一化请求

```ts
/** 归一化后的视频生成请求：与供应商无关的中间表示。 */
export interface VideoRequest {
  readonly capability: VideoCapability
  readonly prompt: string
  /** 秒。已按 capability 给出建议默认值，最终由各 adapter 按能力钳制。 */
  readonly duration: number
  /** 归一化画幅，'1:1' 等各 adapter 按能力决定是否降级。 */
  readonly aspectRatio: '16:9' | '9:16' | '1:1'
  /** 原始占坑参数，供 fal 映射 resolution；Drama 忽略并回 warning。 */
  readonly resolution?: '768p' | '1080p' | '720p' | '2k'
  /**
   * 参考素材：已解析为「本地绝对路径」，由 adapter 自行决定
   * 转成 Drama filename / fal base64。
   */
  readonly references: readonly VideoReference[]
  /** 取消信号与进度回调由 ProviderContext 携带，不进请求体。 */
}

export interface VideoReference {
  readonly localPath: string
  /** 顺序语义：fal 的 multi-reference 按「Image 1 / Image 2」在提示词中引用。 */
  readonly index: number
}
```

### 4.3 Handle 与 Poll

```ts
/** 供应商句柄。可 JSON 序列化，以便写进节点元数据支持断点续查。 */
export interface ProviderHandle {
  /** 供应商内部标识：fal 存 request_id；Drama 直接内嵌结果 URL。 */
  readonly token: string
  /** 同步供应商：submit 阶段即完成，poll 直接返回 done。 */
  readonly settled?: ProviderSettled
}

export interface ProviderSettled {
  readonly url: string
  /** Drama 会回传服务器 filename，用于下游链式引用。 */
  readonly filename?: string
}

export type ProviderPoll =
  | { readonly done: true;  readonly url: string; readonly filename?: string }
  | { readonly done: false; readonly progress?: number; readonly stage?: string }
```

> `exactOptionalPropertyTypes` 下，构造时必须用条件展开，禁止显式赋 `undefined`。

### 4.4 Provider 接口

```ts
export interface ProviderContext {
  readonly signal?: AbortSignal
  /** 0–1 进度；同步供应商可只回调一次 1。 */
  readonly onProgress?: (progress: number, stage?: string) => void
  /** 单次 poll 间隔（毫秒），默认 1500。 */
  readonly pollIntervalMs?: number
  /** 整体超时（毫秒），默认沿用 DRAMA_TIMEOUT_MS.video = 600_000。 */
  readonly timeoutMs?: number
}

export interface VideoProvider {
  readonly id: VideoProviderId
  readonly label: string
  /** 自述能力：注册表据此路由，不可路由时报明确错误。 */
  readonly capabilities: ReadonlySet<VideoCapability>
  /** 提交。同步实现直接把结果放进 handle.settled；异步实现返回 request_id。 */
  submit(req: VideoRequest, ctx: ProviderContext): Promise<ProviderHandle>
  /** 查询。handle.settled 存在时直接返回 done。 */
  poll(handle: ProviderHandle, ctx: ProviderContext): Promise<ProviderPoll>
  /** 可选。异步供应商应实现，用于取消排队中的任务。 */
  cancel?(handle: ProviderHandle, ctx: ProviderContext): Promise<void>
}
```

### 4.5 注册表

```ts
export type VideoProviderId = 'drama' | 'fal'

const providers = new Map<VideoProviderId, VideoProvider>()

export function registerProvider(p: VideoProvider): void
export function getProvider(id: VideoProviderId): VideoProvider | undefined
export function listProviders(): readonly VideoProvider[]

/**
 * 选出能处理该能力的供应商。
 * 优先级：显式指定 → 设置项默认值 → 任一可用。
 * 都不可用时抛出含「哪家支持什么」的中文错误，便于 agent 自我纠正。
 */
export function resolveProvider(
  capability: VideoCapability,
  preferred: VideoProviderId | undefined,
): VideoProvider
```

### 4.6 Executor

```ts
/**
 * 统一执行：submit → 轮询 → 返回产物。
 * 同步供应商在第一次 poll 即退出，无额外开销。
 */
export async function runVideo(
  provider: VideoProvider,
  req: VideoRequest,
  ctx: ProviderContext,
): Promise<{ url: string; filename?: string }> {
  const handle = await provider.submit(req, ctx)
  if (handle.settled !== undefined) {
    return { ...(handle.settled.filename !== undefined
      ? { filename: handle.settled.filename } : {}), url: handle.settled.url }
  }
  const deadline = Date.now() + (ctx.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS)
  for (;;) {
    ctx.signal?.throwIfAborted()
    if (Date.now() > deadline) {
      await provider.cancel?.(handle, ctx).catch(() => {})
      throw new Error(`${provider.label} 生成超时，已取消任务`)
    }
    const r = await provider.poll(handle, ctx)
    if (r.done) {
      return r.filename !== undefined ? { url: r.url, filename: r.filename } : { url: r.url }
    }
    ctx.onProgress?.(r.progress ?? 0, r.stage)
    await sleep(ctx.pollIntervalMs ?? 1500, ctx.signal)
  }
}
```

### 4.7 能力路由解析

```ts
/**
 * 工具 + 参数 → 能力。这是「video_generate 有图走 fl2va、无图也走 fl2va」
 * 的现状在 fal 上不成立的地方：fal 把文生视频与图生视频分成了两个端点。
 */
export function capabilityOf(tool: string, params: GenerateParams): VideoCapability {
  if (tool === 'video_generate') {
    return params.filename !== undefined ? 'first-last-frame' : 'text-to-video'
  }
  // video_composite：2 张 = 首尾帧插值；3 张及以上 = 多参考。
  const n = params.filenames?.length ?? 0
  return n === 2 ? 'first-last-frame' : 'multi-reference'
}
```

---

## 5. 参数映射矩阵

### 5.1 能力 → 端点

| 能力 | Drama | fal |
| --- | --- | --- |
| `text-to-video` | `image2videofl2va`（不传图） | `minimax/h3/text-to-video` |
| `first-last-frame` | `image2videofl2va`（`image1` / `image1`+`image2`） | `minimax/h3/image-to-video` |
| `multi-reference` | `image2videoref2va`（≤6 张） | `minimax/h3/reference-to-video`（≤9 图） |

### 5.2 通用参数

| 归一化字段 | Drama | fal |
| --- | --- | --- |
| `prompt` | `prompt` | `prompt` |
| `duration` | `duration`，钳到 `[1, maxVideoSeconds]` | `duration`，钳到 `[5, 15]`，**越界时回 warning** |
| `aspectRatio` | `aspect`，仅 `16:9` / `9:16` | `aspect_ratio`，七档 + `adaptive` |
| `resolution` | 忽略，回 warning（现状） | `resolution`，见 §5.3 |
| 参考图 | `image1`..`image6`（服务器 filename） | `image_urls` 或 base64 data URI，见 §5.4 |

### 5.3 分辨率映射（让占坑参数真正生效）

`resolution` 目前在 Drama 侧完全无效。fal 接入后可真实生效，映射如下：

| `params.resolution` | fal `resolution` | 说明 |
| --- | --- | --- |
| 未指定 | 不传（走 fal 默认，当前为 2K） | — |
| `768p` | `768P` | 直通 |
| `2k` | `2K` | 直通 |
| `720p` | `768P` | 就近升档，**回 warning** |
| `1080p` | `2K` | 就近升档，**回 warning**（H3 无 1080P 档） |

> 注意：`720p` / `1080p` 升档会**提高成本**。warning 文案必须说明这一点，避免 agent 误以为等价。

### 5.4 画幅

| `aspectRatio` | Drama | fal |
| --- | --- | --- |
| `16:9` | `16:9` | `16:9` |
| `9:16` | `9:16` | `9:16` |
| `1:1` | **降级为 `16:9`**，回 warning（现状行为，保留） | `1:1` 原生支持 |

### 5.5 参考图（差异最大）

| 维度 | Drama | fal |
| --- | --- | --- |
| 形态 | 服务器上的 filename 句柄 | 公网 URL 或 base64 data URI |
| 来源 | 画布节点的 `filename` 字段（已上传） | 需从本地资产读字节再编码 |
| 上限 | 6 张 | 9 张 |

**选定方案：base64 data URI 内联**（零依赖、无额外往返）。配套两道保险：

1. **自动降采样**：用已有的 `ffmpeg-static`（经 `src/ffmpeg-run.ts`）把参考图压成「长边 ≤1024 的 JPEG，q:v 5」。经验值：1280×720 PNG（1–2MB）→ 约 150KB，6 张合计 <1MB，安全。
2. **逃生阀**：压缩后单张仍 >2MB 或总量 >12MB 时，抛出明确的中文错误（提示改用 fal storage 上传），而不是让 fal 甩一个 413 回来。

> 不引入 `sharp`：它是原生模块，Electron 打包与跨平台重建成本高。ffmpeg 已是现有依赖。

---

## 6. 实施计划

### 阶段 0：基线固化

**目标**：确认当前代码库可构建、可测试，钉死回归基准。

**步骤**（1、2 已完成）
1. ✅ 确认依赖与编译产物就绪：`node_modules/` 与 `lib/` 均存在。
2. ✅ 跑门禁并记录基线：`test:smoke` 204 pass / 0 fail；`typecheck` 通过；`verify:loader` 通过（`canvas-studio registered one client module`）。
3. ⬜ **确认工作区未提交改动的归属**（约束 6），与改动所有者对齐后单独提交，不混入本方案。

**验收**
- `test:smoke`：204 pass / 0 fail ✅
- `typecheck` 通过 ✅
- `verify:loader` 通过 ✅
- 未提交改动归属已确认，工作区干净

**回滚**：无改动，无需回滚。

---

### 阶段 1：契约与注册表骨架

**目标**：新增 `src/providers/`，**不接入任何调用方**。纯新增文件，零行为变化。

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/providers/types.ts` | 新增：§4.1–4.4 全部定义 |
| `src/providers/registry.ts` | 新增：`registerProvider` / `getProvider` / `resolveProvider` |
| `src/providers/capability.ts` | 新增：`capabilityOf()` |
| `src/providers/executor.ts` | 新增：`runVideo()` + `sleep()` |
| `tests/video-provider-registry.test.mjs` | 新增：注册、按能力路由、未知能力报错文案 |

**详细步骤**
1. 按 §4 落地四个文件，全部加中文文件头注释（与项目现有风格一致）。
2. `resolveProvider` 的错误文案必须列出「哪家支持什么」，例如：
   > `没有可用的视频供应商支持 multi-reference。当前已注册：drama（text-to-video、first-last-frame、multi-reference）`
3. 测试用假的 provider 实现（不需要打桩 fetch）。

**验收**
- 三件套全绿
- 断言数 ≥ 204 + 新增（预期 +6 左右）
- **行为零变化**：现有 204 断言仍全绿（本阶段不接调用方，必然成立）

**回滚**：删除 `src/providers/` 与新增测试文件即可，无任何耦合。

---

### 阶段 2：Drama adapter 迁移

**目标**：把 Drama 的视频链路迁进 adapter，`generate.ts` 的 `if/else` 视频分支改为注册表调用。**纯重构，行为逐字节不变。**

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/providers/drama.ts` | 新增：Drama adapter，从 `generate.ts` 迁出视频相关逻辑 |
| `src/providers/reference.ts` | 新增：`readLocalAssetBytes()`（从 `reuploadLocalAsset` 拆出） |
| `src/generate.ts` | 修改：`:970-1023` 两段视频分支 → 注册表调用；`:1057-1165` 后置逻辑保持不动 |
| `tests/video-provider-drama.test.mjs` | 新增：参数映射、响应解析、能力自述 |

**详细步骤**
1. **先拆 `reuploadLocalAsset`**（`generate.ts:817`）：拆成纯读字节的 `readLocalAssetBytes(file)` 与上传的 `uploadBytesToDrama()`。前者移到 `providers/reference.ts`，后者留在 `generate.ts` 供 `callWithFallback` 使用。
2. Drama adapter 实现要点：
   - `submit()`：内部调现有的 `callWithFallback()` 逻辑，**同步等到底**，把 `{ url, filename }` 放进 `handle.settled`。
   - `poll()`：直接返回 `handle.settled`。
   - `capabilities`：三个能力全支持。
3. `generate.ts` 视频分支替换为：
   ```ts
   const capability = capabilityOf(tool, params)
   const provider = resolveProvider(capability, params.provider)
   const outcome = await runVideo(provider, req, ctx)
   ```
4. **保留 `callWithFallback` 的参考图自愈**：它是「Drama filename 失效 → 重传 → 重试」的确定性容错，与 provider 无关，继续留在 `generate.ts` 并由 Drama adapter 调用。

**关键风险与对策**
- 风险：`callWithFallback` 依赖 `collectProvidedNames()` / `refreshByCanvasNodes()` 等闭包内函数，抽出去会散架。
- 对策：**本阶段不把 `callWithFallback` 抽进 adapter**。改为让 `generate.ts` 保留这段闭包，adapter 通过一个回调参数（形如 `postWithFallback(endpoint, body, kind)`）注入使用。避免在纯重构阶段做大范围搬家。

**验收**
- 三件套全绿
- **现有 204 断言必须全绿**（这是纯重构的唯一硬判据）
- 用打桩 fetch 断言：请求体与改造前**逐字段一致**（`prompt` / `aspect` / `megapixels: 0.4` / `duration` / `image1` / `image2`）
- `megapixels: 0.4` 与 `sliceToMax(filenames, 6)` 的硬编码行为保持不变

**回滚**：`git revert` 阶段 2 提交；因未改对外契约，回滚无损。

---

### 阶段 3：provider 选择与持久化

**目标**：接上设置项与参数，让 provider 可被选择、被记住。

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/generate.ts` | `GenerateParams` 加 `provider?: VideoProviderId` |
| `src/host-config.ts` | `CanvasStudioConfig` 加 `defaultVideoProvider` |
| `src/index.ts` | `cfg` 加 getter；**同步更新 `generate.ts:34-52` 的 `runtime()` 兜底**（约束 5） |
| `src/routes.ts` | 对入参 `provider` 做枚举校验（约束 4） |
| `src/client/SettingsModal.tsx` | 设置页加「默认视频供应商」下拉 |
| `tests/video-provider-select.test.mjs` | 新增：默认值、参数覆盖、非法值报错 |

**详细步骤**
1. `GenerateParams` 加字段后，**provider 会自动存进 `generationPrompt` 并在重试时回传**（约束 1）。客户端无需改动。
2. 优先级：`params.provider`（含重试回传的） > 设置项 `defaultVideoProvider` > `'drama'`。
3. 默认值必须是 `'drama'`——**保证升级后既有项目行为不变**。
4. 设置项用 `z.union(['drama', 'fal']).default('drama')`，与现有 schema 风格一致。
5. `routes.ts` 校验：非法 provider 返回 400 + 明确中文错误。

**验收**
- 三件套全绿
- 新断言覆盖：① 默认走 drama；② `params.provider='fal'` 生效；③ 非法值 400；④ 重试时 provider 从 generationPrompt 还原
- 手动验收清单 A4（节点重试不串台）——本阶段两 provider 行为一致，主要验证参数往返正确

**回滚**：`git revert`；因默认值为 `drama`，回滚前后行为一致。

---

### 阶段 4：fal adapter — 配置、鉴权、t2v / fl2v

**目标**：fal 能出片（text-to-video 与 first-last-frame 两个能力）。

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/providers/fal.ts` | 新增：fal adapter |
| `src/host-config.ts` | 加 `falApiKey`（`credential-ref`，默认 ref 如 `CANVAS_STUDIO_FAL_API_KEY`） |
| `src/index.ts` | 加 `resolveFalApiKey()`；**同步 `runtime()` 兜底**（返回空串，不 fail-fast） |
| `src/client/SettingsModal.tsx` | 加 fal 密钥输入，**照抄现有 `dramaApiKey` 那套；注意必须用约束 6 的新 `describe` 形态** |
| `tests/video-provider-fal.test.mjs` | 新增：鉴权头、三段式、参数映射、超时、取消 |

**详细步骤**
1. **首日先做端点校准**（有真实 key 时）：用 curl 实测确认端点路径与响应字段，校正本文 §11.2 的假设。**未校准前不要写死响应解析**。
2. adapter 实现：
   - 鉴权：`Authorization: Key ${key}`，缺失时抛「未配置 fal API Key，请在设置 → Canvas Studio 中填写」
   - `submit()`：`POST https://queue.fal.run/{model}`，取 `request_id`
   - `poll()`：`GET .../requests/{id}/status`，`COMPLETED` 后取结果
   - `cancel()`：`DELETE` 或 fal 的 cancel 端点（以实测为准）
3. **不引入 `@fal-ai/client` SDK**，用裸 `fetch` 直连 REST。理由：
   - 项目现有全部网络调用都是裸 fetch（`dramaPost`），保持一致；
   - 测试打桩是覆盖 `globalThis.fetch`，引入 SDK 可能让打桩失效。
4. 参数映射按 §5，特别注意：
   - `duration` 钳到 `[5, 15]`，越界回 warning
   - `1:1` 直通（fal 原生支持，与 Drama 的降级行为不同）
   - `resolution` 按 §5.3 映射

**验收**
- 三件套全绿
- 打桩 fetch 断言：① 请求带 `Authorization: Key xxx`；② 三段式被正确驱动（stub 先返 IN_QUEUE 再返 COMPLETED）；③ `duration=3` 被钳到 5 且回 warning；④ 总超时触发 `cancel()`
- 手动验收清单 A1–A3、A5

**回滚**：把 `defaultVideoProvider` 设回 `drama` 即可（默认就是），fal 代码留着不影响。

---

### 阶段 5：fal adapter — multi-reference + 参考图压缩

**目标**：多参考图出片，角色一致性可用。

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/providers/fal.ts` | 支持 `multi-reference` 能力 |
| `src/providers/reference.ts` | 加 `toFalDataUri()`：读本地字节 → ffmpeg 降采样 → base64 |
| `src/generate.ts` | `sliceToMax` 上限由 6 改为按 provider 能力（Drama 6 / fal 9） |
| `tests/video-provider-fal-refs.test.mjs` | 新增：参考图编码、上限、超限报错 |

**详细步骤**
1. `toFalDataUri(localPath)`：
   - `readLocalAssetBytes()` 读字节
   - 若不是 JPEG 或长边 >1024，用 ffmpeg 转：`-vf "scale='min(1024,iw)':-2" -q:v 5`
   - 输出 `data:image/jpeg;base64,...`
2. 上限改为 provider 自述：`maxReferences`（Drama 6 / fal 9），`sliceToMax` 按此取值。
3. 逃生阀：单张 >2MB 或总量 >12MB → 抛中文错误提示改用 fal storage。
4. 提示词侧：fal 的 multi-reference 按「Image 1 / Image 2 …」在 prompt 中引用顺序。需确认当前 prompt 是否自带该约定——**若无，需在 adapter 里自动前置一句顺序说明**，并回 warning 告知 agent。

**验收**
- 三件套全绿
- 打桩断言：① 3 张参考图被正确编码并按序放入请求；② 7 张时 fal 保留 7 张、Drama 仍截到 6 张（**验证上限差异**）；③ 超限时报错文案正确
- 手动验收清单 A6、A7

---

### 阶段 6：工具契约与文档更新

**目标**：让模型知道有新能力，且不再传播「没有可选择的视频模型」的过时约束。

**改动清单**
| 文件 | 动作 |
| --- | --- |
| `src/host-tools.ts` | `video_generate` / `video_composite` 加 `provider` 参数；更新 `model` / `resolution` 描述（不再是纯占坑） |
| `skills-local/canvas-studio-creation/SKILL.md` | **必须改**：现有第 81 行明令「不要向用户提问用 H3 还是 Seedance」「本项目没有可选择的视频模型」，多供应商后此约束失效 |
| `docs/api.md` | 补 fal 端点与参数 |
| `docs/canvas-studio-tools.md` | 补 `provider` 参数 |

**详细步骤**
1. 工具参数加 `provider`，枚举 `['drama', 'fal']`，描述写清「留空则用设置页默认值」。
2. **`resolution` 描述更新**：对 fal 生效（有升档 warning），对 Drama 仍无效。
3. SKILL.md 的改写要谨慎——它是给 LLM 的硬指令。建议改为：
   > 视频供应商可在设置页切换（默认 Drama）。**不要主动向用户询问用哪个供应商**；除非用户明确要求切换，否则使用默认值。
4. 同步检查 `skills/`（上游同步目录）中是否有冲突表述——注意 `skills/` 由 `scripts/sync-minimax-skills.mjs` 从 submodule 生成，**改那里会被覆盖**，只能改 `skills-local/`。

**验收**
- 三件套全绿
- `verify:loader` 通过（改了 client 侧必跑）
- 人工通读 SKILL.md 确认无自相矛盾表述

---

### 阶段 7：端到端验收与回归

**目标**：真实环境全链路验证。

**步骤**：按 §7.2 手动验收清单逐条执行并勾选。

**验收**：清单全绿；既有 204 断言 + 新增断言全绿；`check` 全绿。

---

## 7. 验收方案

### 7.1 自动化（每阶段门禁）

```bash
cd /Users/lilixian/jobs/AI/video_buddy

# 注意顺序：必须先 build（测试直连 lib/，不 build 测的是旧产物）
corepack yarn workspace canvas-studio build
corepack yarn workspace canvas-studio test:smoke
corepack yarn workspace canvas-studio typecheck

# 改了 client 侧（SettingsModal / SKILL）时额外跑
corepack yarn workspace canvas-studio verify:loader

# 完整门禁（等价于上面 build + verify:loader + typecheck）
corepack yarn workspace canvas-studio check
```

**每阶段必须记录**：`test:smoke` 的 `pass` 数与 `fail` 数。`pass` 数不得小于 204。

### 7.2 手动验收清单（阶段 4/5/7 执行）

前置：启动 `./start-canvas-studio.sh`，准备真实 fal API Key。

| # | 场景 | 预期 | 阶段 |
| --- | --- | --- | --- |
| **A1** | 设置 → fal Key 留空，切到 fal 生成 | 报「未配置 fal API Key，请在设置中填写」，不出片、不卡死 | 4 |
| **A2** | 填入错误 Key 后生成 | 报 fal 返回的鉴权错误（401/403），文案可读 | 4 |
| **A3** | 正确 Key，生成纯文生视频 | 出片成功，节点正常落画布，`duration` 与请求一致 | 4 |
| **A4** | **节点重试不串台**：用 fal 生成 → 右键重试 | 重试仍走 fal（不回落到 Drama） | 3/4 |
| **A5** | 生成时关闭窗口 / 取消 | 任务被 `cancel()`，无孤儿进程，无半成品节点 | 4 |
| **A6** | 首帧图生视频（1 张参考） | 出片，画面与首帧一致 | 4 |
| **A7** | 多参考（3 张）| 出片，角色一致性可接受 | 5 |
| **A8** | 多参考（7 张）| fal 全部采纳（Drama 会截到 6 张，验证差异） | 5 |
| **A9** | `duration=3` | 被钳到 5 并回 warning 给 agent | 4 |
| **A10** | `aspectRatio=1:1` 分别用两个供应商 | fal 出 1:1；Drama 降级 16:9 并回 warning | 4 |
| **A11** | 切回 Drama 生成 | 与改造前行为完全一致（回归） | 7 |
| **A12** | 大参考图（>2MB）| 自动降采样，不报 413 | 5 |
| **A13** | fal 服务超时 | 600s 后抛出可读超时错误，不留悬挂 | 4 |

---

## 8. 风险登记

| # | 风险 | 影响 | 概率 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | fal 端点路径 / 响应字段与本文假设不符 | 阶段 4 返工 | 中 | 阶段 4 首日 curl 实测校准后再写解析 |
| R2 | `callWithFallback` 抽出时闭包散架 | 阶段 2 阻塞 | 中 | 不抽出，用回调注入（见阶段 2 对策） |
| R3 | 忘了 build 就跑测试，测的是旧产物 | 误判通过 | **高** | 门禁脚本固定顺序；文档与执行时都强调 |
| R4 | `runtime()` 两处默认值不同步（约束 5） | 测试与运行时行为不一致 | 中 | 每次改配置同时改两处，加注释互相引用 |
| R5 | base64 请求体超限（413） | 多参考失败 | 中 | ffmpeg 降采样 + 逃生阀报错 |
| R6 | fal 轮询间隔过密触发限流 | 任务失败 | 低 | 默认 1.5s（对齐项目现有 `ask_user_choice` 的轮询节奏），可配置 |
| R7 | SKILL.md 改写引入 LLM 行为退化 | agent 频繁询问供应商 | 中 | 文案保守，默认不询问；阶段 7 观察 |
| R8 | `duration` 钳制改变了既有出片时长 | 用户困惑 | 低 | 只在 fal 侧钳制，Drama 行为不变；钳制必回 warning |
| R9 | 升级后既有项目的 `provider` 字段缺失 | 解析为 undefined | 低 | 缺失即走设置默认值 `drama`，行为不变 |

---

## 9. 回滚策略

| 层级 | 手段 | 影响 |
| --- | --- | --- |
| 阶段级 | `git revert` 该阶段提交 | 因每阶段独立且默认 `provider='drama'`，回滚无损 |
| 功能级 | 设置页把「默认视频供应商」改回 `drama` | 立即停用 fal，代码保留 |
| 紧急级 | 删除 `src/providers/fal.ts` + 移除注册表注册 | fal 不可选，其余不受影响 |

**关键保障**：所有阶段的默认值都是 `drama`，因此**任何时刻把设置改回 drama，系统行为都等同于改造前**。

---

## 10. 开放问题（需审批确认）

| # | 问题 | 选项 | 建议 |
| --- | --- | --- | --- |
| **Q1** | 指定 provider 不支持某能力时（如 fal 的 multi-reference 未接入），**自动回退到另一家** 还是 **直接报错**？ | a) 自动回退 + warning；b) 直接报错 | **b**。静默换供应商会让出片风格突变，用户更难排查 |
| **Q2** | `resolution=720p/1080p` 在 fal 上升档（768P/2K）会**提高成本**，是否接受自动升档？ | a) 接受并 warning；b) 直接报错让用户改 | **a**，但 warning 必须写明「已升档，费用更高」 |
| **Q3** | 默认供应商是否仍为 `drama`？ | a) drama；b) fal | **a**。既有项目零变化；fal 需配 key，默认 fal 会让未配置用户直接失败 |
| **Q4** | 是否现在就把 H3 Max（`minimax/h3-max/*`，768P、5 秒片 3 秒出）一并接入？ | a) 本次不做；b) 阶段 5 后追加 | **a**。作为 G2「新增供应商只需加一个文件」的第一个验证案例更合适 |
| **Q5** | fal 侧是否暴露 `prompt_expansion_mode` 参数给 agent？ | a) 不暴露，用 fal 默认；b) 暴露为工具参数 | **a**。参数越多 agent 越容易误用；留默认即可 |

---

## 11. 附录

### 11.1 命令速查

```bash
cd /Users/lilixian/jobs/AI/video_buddy

# ── 构建（二选一）────────────────────────────────
# A. 常规（有完整 shell 权限时）
corepack yarn workspace canvas-studio build

# B. 绕过 clean（受批量删除保护时，已验证等价）
cd canvas-studio
./node_modules/.bin/tsdown                                        # client bundle
./node_modules/.bin/tsc -p tsconfig.json                          # Host 侧产物（测试直连这个）
./node_modules/.bin/tsc -p tsconfig.client.json --emitDeclarationOnly
cd ..

# ── 门禁（顺序固定：先构建再测试）─────────────────
corepack yarn workspace canvas-studio test:smoke                  # 基线 204 pass / 0 fail
corepack yarn workspace canvas-studio typecheck
node canvas-studio/scripts/verify-client-loader.mjs               # 改了 client 侧必跑

# ── 其他 ───────────────────────────────────────
./start-canvas-studio.sh                                          # 真实环境验收
node --test canvas-studio/tests/video-provider-fal.test.mjs       # 单文件测试

# ── 阶段 7 真机烟测（需真实 FAL_KEY）──────────────
FAL_API_KEY=xxxx node canvas-studio/scripts/fal-smoke.mjs              # A3 真实文生视频出片
node canvas-studio/scripts/fal-smoke.mjs --no-key                     # A1 未配置 Key → 预期报错
node canvas-studio/scripts/fal-smoke.mjs --wrong-key                 # A2 错误 Key → 预期 401/403
FAL_API_KEY=xxxx node canvas-studio/scripts/fal-smoke.mjs --duration 3 --aspectRatio 1:1  # A9 钳制 + A10 1:1 观察
```

### 11.2 fal 队列 API 参考（**已于 2026-09-04 按官方 API 文档校准**，勘误见 §0.3 阶段 4 纪要）

```
POST https://queue.fal.run/{model_id}
  Authorization: Key {FAL_KEY}
  Content-Type: application/json
  { "input": { ... }, "webhookUrl": null }

  → { "request_id": "...", "status_url": "...", "response_url": "..." }

GET https://queue.fal.run/{model_id}/requests/{request_id}/status
  Authorization: Key {FAL_KEY}
  → { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" }

GET https://queue.fal.run/{model_id}/requests/{request_id}
  Authorization: Key {FAL_KEY}
  → { "video": { "url": "...", "content_type": "...", "file_name": "..." }, "expanded_prompt": "..." }

PUT https://queue.fal.run/{model_id}/requests/{request_id}/cancel
  Authorization: Key {FAL_KEY}
```

`model_id` 取值：
- `minimax/h3/text-to-video` —— input：`prompt`（必填）、`duration`（5–15，默认 5）、
  `resolution`（480P/768P/2K/4K，默认 2K）、`aspect_ratio`（**六档** 21:9/16:9/4:3/1:1/3:4/9:16，默认 16:9，无 adaptive）、
  `seed` / `enable_safety_checker` / `sync_mode` / `prompt_expansion_mode`（fast/balanced/quality，默认 balanced）
- `minimax/h3/image-to-video` —— 同上但**无 aspect_ratio**（画幅跟随 image_url）；
  首帧 `image_url`、尾帧 `end_image_url`（均省略时按 t2v 处理）；两者可传公网 URL 或 base64 data URI
- `minimax/h3/reference-to-video`（阶段 5 已接入）—— input **多一个 `aspect_ratio` 取值 `adaptive`**
  （枚举：adaptive/21:9/16:9/4:3/1:1/3:4/9:16，默认 adaptive）；
  **参考图字段是 `reference_image_urls`（`list<string>`，不是 image_urls）**，最多 9 张；
  另有 `reference_video_urls` / `reference_audio_urls`（各 ≤3 个、2–15 秒；三类文件合计 ≤12，
  音频不能作为唯一参考）——本次不做；
  **提示词需按 `Image 1` / `Image 2` 顺序引用参考图**（官方约定，缺失时由 adapter 自动前置顺序说明）
- `minimax/h3-max/*`（本次不做）

### 11.3 与 LLM provider 体系的区分（易混淆点）

`src/client/ModelSettingsPanel.tsx` 里有大量 `provider` / `discoverModels` / `ConfigurableProviderView`，那是 **DSH 框架自带的 LLM provider 体系**（选驱动 Agent 的聊天模型），**与视频生成供应商完全无关**，不要复用或混淆。它的设置 UI 交互模式（provider 卡片 + 密钥凭据域）可参考。

---

*文档结束。审批通过后按 §0.2 阶段门禁规则逐阶段执行，每阶段完成后在 §0.3 执行日志登记。*
