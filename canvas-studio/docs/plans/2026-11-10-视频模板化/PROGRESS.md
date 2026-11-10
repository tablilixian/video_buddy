# PROGRESS · 视频模板化（单一进度事实源）

> **接管会话第一步就读这个。** 只记"做到哪了"，不记设计理由（理由在 `决策-模板需求收口.md`）。
> 每完成一个可验证小步**立刻**更新本文件，不要攒到会话末尾。
>
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成且验证过 · `[!]` 卡住（见 `无人值守推进协议.md` §6）

最后更新：2026-11-10 22:50 · 阶段：**0A 进行中（契约+校验完成）**

---

## 前置准备（已完成）

- [x] 需求收口（10 拍板项 + 10 卡点）→ `决策-模板需求收口.md`
- [x] P-3 可运行验证（骨架过校验、逐字节还原、结构 0 差异）→ `原型-compile.mjs`
- [x] 容量审计器（模块 + 19 项自测）→ `原型-audit-text-fit.mjs`
- [x] LLM 填参验证 + 适配闸门（五判据）→ `原型-template-fit-gate.mjs`
- [x] 执行总表 → `执行总表.md`
- [x] **GT 真值持久化** → `gt/{mix-report.json, audio-events-source.json, native_audiolib.py}`（原只存 `/tmp`，会丢）
- [x] **0A §5.1/§5.2 按真值重写**（旧的 8 条事件表是混响尾误检，已废弃）
- [x] **0A 契约决策 1 改为三定位并存**（anchor / startFrame / startSec，互斥）
- [x] **0A 的 SFX 路径改为 `/canvas-studio/remotion/sfx/*`**（原 `/canvas-studio/assets/sfx/*` 必然 404）
- [x] 无人值守推进协议 → `无人值守推进协议.md`

---

## 第一波 A · 0A（SFX 事件轨）

> 与 1C 并行。改 `manifest.ts` + `routes.ts` + 新建 `src/audio-sfx/`、`assets/sfx/`。

- [x] **0A-1 契约**：`ManifestSfx` + `ManifestSfxAnchor` + `resolveSfxStartFrame()` + `SfxResolveContext` 已加入 `src/remotion/manifest.ts`
  - 验收：两个 `tsc` 均 EXIT=0（零错误）· `tests/remotion-sfx.test.mjs` 中 12 条换算断言全绿
- [x] **0A-2 校验**：`KNOWN_AUDIO_KEYS` 加 `sfx`；`KNOWN_SFX_KEYS` / `MAX_SFX_EVENTS=64`；`validateSfxList()` 已接入主链路
  - 覆盖：三定位恰好一个 · anchor.trackId 存在 · anchor.at 枚举 · gain 0–2 · pan −1..1 · 空数组 error · 条数上限 · 外链拒收 · 契约外字段只 warning · 超时长 warning
  - 验收：`tests/remotion-sfx.test.mjs` **33/33 绿**；相邻 `remotion-anchor` + `remotion-render-job` **20/20 绿**
  - **反向变异已做**：`round`→`floor` ⇒ 2 条舍入用例变红；关掉"三定位恰好一个" ⇒ 3 条用例变红 ✅
- [ ] **0A-3 音频区分**（`summarizeManifestAudio` 已计入 sfx；**还差** `audio-compose.ts` 的 `timelineFromManifestAudio` 与 `contracts/canvas.ts:110` 八值枚举）：`summarizeManifestAudio` 计入 sfx；`StudioAudioComposition`（`src/contracts/canvas.ts:110` 八值枚举）加 sfx 位
  - 验收：仅 sfx 的 manifest 不得判为 `none`（否则画布角标显示"无声"）
- [ ] **0A-4 合成库**：新建 `src/audio-sfx/`（DSP：`pan`/`lowpass`/`highpass`/`envelope`/`wav` 写出），照 `gt/native_audiolib.py` 逐原语移植
  - 验收：WAV 头自洽、读回样本数 = 帧数×2、`pan(x,1)` 的 L=0
- [ ] **0A-5 素材产出**：`scripts/build-sfx.mjs` → `assets/sfx/{thud,write,swoosh,card,swipe}.wav`（≥5 个，7 条事件只需 5 个不同素材）
- [ ] **0A-6 只读路由**：`src/routes.ts` 加 `ROUTE_REMOTION_SFX = '/canvas-studio/remotion/sfx'`，照 `ROUTE_REMOTION_FONTS` 抄
  - 验收：`curl` 能取到 wav；`../x/../../etc/passwd` 类越权 400
- [ ] **0A-7 渲染接线**：`AudioTrack.tsx` 消费 `audio.sfx[]`（**纯追加**，不改 bgm/voiceOver 分支）
- [ ] **0A-8 探针验证**：0A 收尾必跑 —— 渲出带音轨 mp4 + 按 §5.2.3 七条断言
  - 卡住按 `无人值守推进协议.md` §3 三级降级

## 第一波 B · 1C（装饰构件层）

> **唯一零冲突包**。只新建 `src/remotion/furniture.ts`，不碰 `manifest.ts`。

- [ ] **1C-1** `furniture.ts` 纯函数（禁 `transition`/`@keyframes`，插值走 `timing.ts`）
- [ ] **1C-2** manifest 接入（可选字段，默认关闭）
- [ ] **1C-3** 构件默认关闭时**逐帧不变**（像素哈希）
  - ⚠️ `msPerFrame` **允许上升**，不要与"逐帧不变"写成互斥目标

---

## 第二波 · 0B（文本溢出上报）

> 抢 `manifest.ts` + `host-tools.ts`，必须等第一波 A 完成。

- [ ] **0B-1** `TextFitPlan` 加 **`renderText`** 字段（未缩号时 = 原文 raw）
- [ ] **0B-2** `TextCard.tsx` 消费 `plan.renderText`（**不要**渲染 `plan.lines`）
- [ ] **0B-3** `report.textFit` 进 `report` schema（`additionalProperties:false`，必须显式加）
- [ ] **0B-4** 顺带修既有缺陷：`title` 的 `maxWidthPx` 不看 `box`；`bullets` 写死 `width:900` 且未扣 42px 圆点
- [ ] **0B-5** 单测 + 反向变异（`renderText`→`lines.join('\n')` 必须让逐像素断言变红）

---

## 第三波 · 1（模板库）

- [ ] **1-0 前置**：`scaffold_manifest` 补写 `meta.generatedBy`（`render-job.ts:1136` 只认 `'manifest-builder'`，不补则模板片全带假告警）
- [ ] **1-1** registry + `list_templates`（带筛选：体裁 / 时长档 / 素材需求）
- [ ] **1-2** `scaffold_manifest({templateId, slots, writeTo})`；与 `recipe` 互斥
- [ ] **1-3** `gateTemplate()` 五判据接入选模板路径；阈值 35% 做成常量；回退**显式告知**
- [ ] **1-4** `contractVersion` 常量（旧版本 warn 不拒收）
- [ ] **1-5** 3 个模板内容：`assets/templates/{science,product,report}/`（`manifest.template.json` + `slots.json` + `meta.json`，**无 spec.json**）
- [ ] **1-6** `skills/code-driven-explainer/references/template-usage.md`（`SKILL.md` 体积不得增加，现 15284/15360）
- [ ] **1-7** 端到端：对话内列候选 → 选 → 填参 → 闸门 → 出片

---

## 收尾

- [ ] 3 个模板各出一支样片（探针）
- [ ] STATUS §4.1 / `cv-details.md` / `changelog.md` 三处登记（CV 从 460 起）
- [ ] 更新本文件为"全部完成"，并整理 §6 待人工清单

---

## 我在哪一步（给接管者的提示）

**下一步就是 0A-1。** 已确认的事实：

- `manifest.ts` 的 `KNOWN_AUDIO_KEYS` 在 974 行附近，7 键
- `validateAssetRefField` / `isAllowedManifestAssetRef` 已存在，sfx 直接复用
- `ROUTE_REMOTION_FONTS` 是只读路由的样板（~35 行）
- `assets/**` 已在 `package.json files` 白名单，无需改
- GT 真值在 `gt/mix-report.json`（7 条），合成原语在 `gt/native_audiolib.py`
