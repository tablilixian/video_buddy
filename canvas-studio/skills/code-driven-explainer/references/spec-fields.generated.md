<!-- 机器生成：node scripts/gen-spec-fields.mjs；请勿手改（改 content-spec.ts 后重跑，门禁 tests/spec-fields-drift.test.mjs 会红） -->

# Content Spec 全字段表（从 content-spec.ts 生成）

> **这是 spec 各级对象（ContentSpec / SpecSection / SpecUnit / SpecCarry）字段的唯一权威清单**：
> 字段名、可选性、类型、枚举取值都以此为准，与源码逐字同步（有门禁守着）。
> **不要再 grep `src/remotion/content-spec.ts` 确认「SpecUnit 认哪些键」** —— 答案就在下面。
> 本表只讲「有哪些字段、什么类型」；**怎么填出好画面**看同目录 `content-spec.md`，
> **格位 / 字号怎么算**看 `spec-geometry.generated.md`，**能表达什么**看 `spec-capability.generated.md`。

## SpecUnit
> 一屏内的一个单元（RQ-25）：主视觉 + 文案 + 自己的格位。

- `card`: string — 卡编号或卡名（'A2' / 'A2 标题逐字'）；未注册即回落占位。
- `overlap`?: boolean — **刻意叠层声明**（RQ-R8）：本单元格位与同屏其他单元相交超过容忍阈值时，
- `copy`: string — 该单元的主文案（卡生成器的 copy 槽位）。
- `label`?: string
- `dataSource`?: string — B5（O-10）：数据来源（数据集 + 可复核入口，如 `NASA GISTEMP v4, https://…`；
- `cell`?: CellRect — 该单元独占的格位；缺省 = 该屏的 `sections[].cell`，再缺省 = 全屏。
- `assetSlots`?: Record<string, string>
- `accentColor`?: string
- `highlights`?: Array<{ text: string; color: string }> — R11：单元级分段着色（覆盖屏级；语义同 `sections[].highlights`）。

## SpecCarry
> 跨屏常驻层（RQ-26）：一条非全屏底板，从 fromSection 首帧铺到 toSection 末帧。

- `id`: string
- `box`: CellRect
- `color`: string
- `radius`?: number — 圆角（px）；缺省 0。**仅在无 `text` 时生效**（文字层没有底色可圆角）。
- `fromSection`?: string — 覆盖起点屏 id；缺省 = 第一屏。
- `toSection`?: string — 覆盖终点屏 id；缺省 = 最后一屏。
- `text`?: string — 常驻文字（S-5）：给了它就直接出 `textCard` 轨，不再画形状。
- `variant`?: 'subtitle' | 'dataCard' | 'title' | 'bullets' | 'timecode' — 文字 variant；缺省 `subtitle`。取值同 `textCard.variant`。
- `textColor`?: string — 文字色；缺省白。`color` 仍写作底板色 / 描边色，两者分工与 `textCard` 一致。
- `background`?: string — 文字底板色（`subtitle` 才有意义）；缺省透明。
- `letterSpacingEm`?: number — 字距（em）；缺省 0。分组的全大写标签常用 0.08~0.12。

## ContentSpec
> 内容规格（schema 正本；字段语义见各注释）。

- `meta`: { title: string /** 主题（`themes.ts` 的 id；缺省 cold-tech）。 */ theme?: string /** 帧率（缺省 30）。 */ fps?: number /** 总时长（秒；与 sections 的时长/权重共同定帧）。 */ durationSec?: number /** * B1（RQ-N2）：屏数与节奏交给 `planStages()` 算 —— 屏数 = clamp(round(时长/6.5), 2, 40)， * 单屏 4–10s，屏边界向 TTS 句起点（`stageBoundarySec`）±0.6s 吸附。 * **显式 true 才启用**；缺省/ false = 旧行为逐字段不变（回归纪律）。 * 启用后 sections 只管内容（每段不许带 durationSec/weight），且段数必须等于算出的屏数。 */ autoStages?: boolean /** * B5（O-8）：autoStages 的**目标屏长**（秒）；缺省 6.5（`TARGET_STAGE_SEC`）。 * * 存在的理由：屏数 = round(时长 / 目标屏长)，与信息量无关 —— 20s 知识型片默认 * 3 屏 × 6.7s，实测只有 40 字（2 字/秒）。想更密就写 4（20s → 5 屏）， * 但**必须与 sections 段数同时改**：两处都是「屏数」的事实来源，改一处只会得到 * 一条「屏数与段数不符」的拒收（错误信息会直接把该改成几段算给你）。 */ targetStageSec?: number /** * TTS 句起点（秒，严格升序；来自 tts_narration 回执 `audio.voiceOver[].startSec` 换算）。 * 仅 `autoStages: true` 时参与屏边界吸附；只写本字段不开 autoStages 会被警告「不生效」。 */ stageBoundarySec?: number[] }
- `sections`: Array<{ id: string /** 卡编号或卡名（'A2' / 'A2 标题逐字'）；缺省 = 占位段（回落路径）。 */ card?: string /** * 主文案（卡生成器的 copy 槽位；B1 用 `k:v; k:v` 行内格式）。 * * **`units` 型段可缺省**：一屏多单元时没有「屏级文案槽」，文案在各单元里。 * 旧口径强制非空 ⇒ 真机会话 6f8ba13c 里模型为了过校验，把两个单元的文案拼成 * 一句塞进 `copy`，顺手把 `-60°C` 写成 `-64°C` —— 一个纯格式校验，污染了成片里 * 唯一的数值。缺省时配方切分用各单元文案拼合（只作时长权重参考，不上屏）。 */ copy?: string /** 段时长（秒，显式）；与 weight 二选一，都给时长优先。 */ durationSec?: number /** 时长权重（无显式时长时按权重归一）。 */ weight?: number /** 段标签（eyebrow / dataCard 标题用）。 */ label?: string /** 素材槽位 → 同源 URL（喂生成器）。 */ assetSlots?: Record<string, string> /** 强调色覆盖（缺省统一 #4f9cf9）。 */ accentColor?: string /** * B5（O-10）：该屏的数据来源（units 型屏的每个单元可各自覆盖）。 * 透传到数据轨 `dataSource`；不填则保留既有告警（诚实：没来源就是没来源）。 */ dataSource?: string /** * R11（2026-11-16）：**分段着色** —— 把 `copy` 里出现的子串染成指定颜色。 * * 参照实物（小红书财经科普）：大标题「继续，还是回来」里「继续」橙、「回来」青， * 中间「还是」保持白。这是这类片最强的视觉记忆点，而此前 spec 只能整句一个 * `accentColor`。语义与 `textCard.highlights` 完全一致（`indexOf` 第一处、 * 互不重叠、找不到就 warn），spec 只负责把它送到卡。 */ highlights?: Array<{ text: string; color: string }> /** * 该屏的缺省格位（RQ-25）。给了 `units` 而未逐个给 `cell` 时，所有单元共享它； * 两者都缺省 = 全屏（与今天行为逐字段一致）。 */ cell?: CellRect /** * 一屏多单元（RQ-25）：1–4 个，共享该屏的时间窗、各占自己的格位。 * **与 `card` 互斥**（同给即校验失败）。 */ units?: SpecUnit[] }> — 段序列（每段 = 一屏；一屏可含 1–4 个单元）。
- `captions`?: Array<{ text: string; startSec?: number; endSec?: number }> — 字幕表（可选；词级字幕请走 caption 轨，本表只做占位校对）。
- `sfx`?: Array<{ name: string; startSec?: number; gain?: number }> — 音效钉帧表（可选；由 VO 能量谷推导的工具另行落）。
- `carry`?: SpecCarry[] — 跨屏常驻层（RQ-26）：真机 45s 版为 0 块，手写 60s 版 9 块，差的就是这个字段。

## SpecAssetNeed (extends CardAssetDecl)
> 素材需求清单条目（RQ-21 分流的数据面；比 CardAssetDecl 多 slot 上下文）。

- `segmentId`: string — 需要它的段 id。

## ContentSpecValidation
> spec 校验结论（与 ManifestValidation 同形）。

- `ok`: boolean
- `errors`: string[]
- `warnings`: string[]
