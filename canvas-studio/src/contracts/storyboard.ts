/**
 * REQ-022（CV-293）· `storyboard.json` 的 wire 契约 —— 类型 + 宽松归一化 + `validateForSeed`。
 *
 * 这是「拍摄定稿」阶段产物（storyboard）与画布（canvas）之间唯一的**数据形状事实源**，
 * 设计与字段口径见 `docs/plans/REQ-022-storyboard数据契约.md`（v2.0 定稿）§4/§7.1。
 *
 * ## 三条纪律
 *
 * 1. **storyboard.json 与 canvas.json 同级、独立文件**（`join(dirOf(projectId),'storyboard.json')`）。
 *    它是用户创作资产的 SSOT，读损坏时**显式报错 + `.corrupt` 备份，绝不静默重置**
 *    （与 canvas.json 的「降级空文档」刻意不同）。
 * 2. **本文件只放纯类型与纯函数**：无 IO、无 React、无 cordis —— 与 `contracts/project.ts`
 *    同款（两侧（Host / 浏览器）都能 import，构建期擦除）。落盘与串行队列在
 *    `storyboard-store.ts`。
 * 3. **`validateForSeed` 是唯一完成度判据**（纯函数、全入口共用一份）：blocker 缺一不让落地，
 *    warning 只进确认清单放行。任何新的「能不能落地」判断都必须长在这里，不得旁开第二份。
 *
 * ## 与契约的对应
 *
 * - §4.2 `sections` 九节 → `StoryboardSections`（语义 ID 一次铸造、永不复用）。
 * - §4.3 必填底线 → `validateForSeed` 的 blocker 表。
 * - §4.4 `versions`：全量快照 + `final` 冻结 + `sourceVersion` 审计。
 * - §4.5/§4.6 `bindings` / `actuals`：**版本快照之外**，不进 diff、不进 seed 投影。
 */

/** 当前 schema 版本（写入时固定，读取时只做容忍性检查）。 */
export const STORYBOARD_SCHEMA_VERSION = 1

/** 全片 shot 上限（样板上限口径，契约 §4.2）。超限只告警不阻断——它是预算提示，不是合法性。 */
export const STORYBOARD_MAX_SHOTS = 15

/** 落地偏差容忍度：Σ shot 时长与 `meta.targetDuration` 相对偏差超过此值即告警（契约 §7.1）。 */
export const STORYBOARD_DURATION_TOLERANCE = 0.1

// ────────────────────────────── sections 各节 ──────────────────────────────

/** §01 事实核验状态；`pending` 的条目在 seed 时被显式丢弃（契约 §7.4）。 */
export type StoryboardFactStatus = 'verified' | 'pending'

/** §01 一条事实锚点（搜索核实所得，必须带来源）。 */
export interface StoryboardFact {
  readonly claim: string
  readonly source: string
  readonly status: StoryboardFactStatus
}

/** §02 视觉规范的一个 token（= Look 卡前置）。 */
export interface StoryboardVisualToken {
  readonly k: string
  readonly v: string
}

/** §03 一句旁白（**只写一次**，分镜/shot 引用句号）。 */
export interface StoryboardNarrationLine {
  readonly id: string
  readonly text: string
  readonly duration: number
  readonly shotRef?: string
}

/** §04 一个 shot（一次连续画面）。`backup` 标记备份拍，单条重出不牵连。 */
export interface StoryboardShot {
  readonly id: string
  readonly duration: number
  readonly frames: number
  readonly camera: string
  readonly visual: string
  readonly audio: string
  readonly narrationRef?: string
  readonly promptEn?: string
  readonly backup: boolean
}

/** §04 一个分镜（叙事单元，含 ≥1 shot）。 */
export interface StoryboardScene {
  readonly id: string
  readonly title: string
  readonly shots: readonly StoryboardShot[]
}

/** §05 角色的人读描述 —— **只上 storyboard.html，不上画布**（req3「干净落地」）。 */
export interface StoryboardCharacterProfile {
  readonly temperament: string
  readonly face: string
  readonly costume: string
}

/** §05 角色配色。 */
export interface StoryboardCharacterPalette {
  readonly base: string
  readonly accent: string
}

/** §05 角色的机读生成锚点 —— 落画布、可改可回写（L 类）。 */
export interface StoryboardCharacterGen {
  readonly lockedPrompt: string
  readonly negativePrompt: string
}

/** §05 一个角色（`profile` 人读 / `gen` 机读分离）。 */
export interface StoryboardCharacter {
  readonly id: string
  readonly label: string
  readonly name: string
  readonly tags: readonly string[]
  readonly profile: StoryboardCharacterProfile
  readonly palette: StoryboardCharacterPalette
  readonly appearsIn: readonly string[]
  readonly gen: StoryboardCharacterGen
}

/** §06 BGM 参数（预算表，不是「配个 BGM」）。 */
export interface StoryboardBgm {
  readonly bpm: number
  readonly lufs: number
  readonly sidechain: string
}

/** §06 声音设计。 */
export interface StoryboardSound {
  readonly bgm: StoryboardBgm
  readonly sfx: readonly string[]
}

/** §07 素材类型。 */
export type StoryboardAssetType = 'text' | 'image' | 'video' | 'audio'

/** §07 素材就绪状态。 */
export type StoryboardAssetStatus = 'ready' | 'pending'

/** §07 素材引用（**只存引用不存副本**；seed 不造新节点，只校验引用）。 */
export interface StoryboardAssetRef {
  readonly kind: 'canvasNode' | 'file'
  readonly id: string
}

/** §07 一条素材清单项。 */
export interface StoryboardAsset {
  readonly name: string
  readonly type: StoryboardAssetType
  readonly status: StoryboardAssetStatus
  readonly ref: StoryboardAssetRef
}

/** `sections` 九节（规划内容，**进入版本快照**）。 */
export interface StoryboardSections {
  readonly '00_creative': { readonly brief: string }
  readonly '01_facts': { readonly facts: readonly StoryboardFact[] }
  readonly '02_visual': { readonly tokens: readonly StoryboardVisualToken[] }
  readonly '03_narration': { readonly lines: readonly StoryboardNarrationLine[] }
  readonly '04_storyboard': { readonly scenes: readonly StoryboardScene[] }
  readonly '05_characters': readonly StoryboardCharacter[]
  readonly '06_sound': StoryboardSound
  readonly '07_assets': readonly StoryboardAsset[]
  readonly '08_constraints': readonly string[]
}

// ───────────────────────── 版本 / 关联 / 实况（快照之外） ─────────────────────────

/** 一个历史版本（**全量快照**，非 delta：体量小、`render(version)` 与 diff 最省事）。 */
export interface StoryboardVersion {
  readonly version: string
  readonly label: string
  readonly createdAt: number
  readonly parent?: string
  readonly snapshot: StoryboardSections
}

/** 版本仓库。`final` = 本次落地所选内容的全量快照，落地即冻结。 */
export interface StoryboardVersions {
  readonly current: string
  readonly history: readonly StoryboardVersion[]
  readonly final: StoryboardSections | null
  /** 审计：落的是哪一版（`"v2"` 或 `"live"`）。 */
  readonly sourceVersion: string | null
}

/** 语义 ID ↔ 画布 UUID 的反查项（`bindings` 块，**版本快照之外**）。 */
export interface StoryboardBinding {
  readonly canvasNodeId?: string
  readonly canvasAssetId?: string
  readonly seededFrom?: string
}

/** A 类实况里的质检结论镜像（`qc_shot` 落盘时双写）。 */
export interface StoryboardQc {
  readonly verdict: string
}

/** A 类实况（`actuals` 块，**版本快照之外**，永不触碰 `sections`）。 */
export interface StoryboardActual {
  readonly actualDuration?: number
  readonly qc?: StoryboardQc
  readonly framingNote?: string
}

/** 顶层元信息（参数条的量化对齐来源）。 */
export interface StoryboardMeta {
  readonly genre: string
  readonly targetDuration: number
  readonly aspect: string
  readonly audience?: string
}

/** `storyboard.json` 顶层文档。 */
export interface StoryboardDocument {
  readonly schemaVersion: number
  readonly projectId: string
  readonly title: string
  readonly meta: StoryboardMeta
  readonly sections: StoryboardSections
  readonly versions: StoryboardVersions
  readonly bindings: Readonly<Record<string, StoryboardBinding>>
  readonly actuals: Readonly<Record<string, StoryboardActual>>
}

// ────────────────────────────── 默认构造 ──────────────────────────────

/** 空 `sections`（新建 storyboard 的起点；各节都给出合法空值，避免读侧到处判 undefined）。 */
export function emptyStoryboardSections(): StoryboardSections {
  return {
    '00_creative': { brief: '' },
    '01_facts': { facts: [] },
    '02_visual': { tokens: [] },
    '03_narration': { lines: [] },
    '04_storyboard': { scenes: [] },
    '05_characters': [],
    '06_sound': { bgm: { bpm: 0, lufs: 0, sidechain: '' }, sfx: [] },
    '07_assets': [],
    '08_constraints': [],
  }
}

/**
 * 新建一份 storyboard 文档（首稿）。
 *
 * 首稿即自动 checkpoint v1（契约 §5）：`versions.history` 只放一条 v1，`current='v1'`，
 * `final` 为空（尚未落地）。`bindings` / `actuals` 此刻都是空块 —— 它们要等 seed 才被写。
 */
export function createStoryboard(input: {
  readonly projectId: string
  readonly title: string
  readonly meta: StoryboardMeta
  readonly sections: StoryboardSections
  readonly now?: number
}): StoryboardDocument {
  const now = input.now ?? Date.now()
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    projectId: input.projectId,
    title: input.title,
    meta: input.meta,
    sections: input.sections,
    versions: {
      current: 'v1',
      history: [{ version: 'v1', label: '初稿', createdAt: now, snapshot: input.sections }],
      final: null,
      sourceVersion: null,
    },
    bindings: {},
    actuals: {},
  }
}

// ────────────────────────────── 宽松归一化 ──────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 取字符串字段；非字符串或缺失 → 空串（storyboard 是创作资产，宁可留空让 blocker 说话，也不猜值）。 */
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 取字符串数组；逐项 String 化，非数组 → 空数组。 */
const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : String(item))) : []

/** 取有限数字；非法 → 0。 */
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * 取枚举值；不在允许集合内 → `fallback`。
 *
 * 泛型收口到字面量联合，避免调用方拿到 `string` 后再各自断言。
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function normalizeFact(value: unknown): StoryboardFact {
  const record = isRecord(value) ? value : {}
  return {
    claim: str(record.claim),
    source: str(record.source),
    status: oneOf(record.status, ['verified', 'pending'] as const, 'pending'),
  }
}

function normalizeNarrationLine(value: unknown): StoryboardNarrationLine {
  const record = isRecord(value) ? value : {}
  const shotRef = str(record.shotRef)
  return {
    id: str(record.id),
    text: str(record.text),
    duration: num(record.duration),
    ...(shotRef === '' ? {} : { shotRef }),
  }
}

function normalizeShot(value: unknown): StoryboardShot {
  const record = isRecord(value) ? value : {}
  const narrationRef = str(record.narrationRef)
  const promptEn = str(record.promptEn)
  return {
    id: str(record.id),
    duration: num(record.duration),
    frames: num(record.frames),
    camera: str(record.camera),
    visual: str(record.visual),
    audio: str(record.audio),
    ...(narrationRef === '' ? {} : { narrationRef }),
    ...(promptEn === '' ? {} : { promptEn }),
    backup: record.backup === true,
  }
}

function normalizeScene(value: unknown): StoryboardScene {
  const record = isRecord(value) ? value : {}
  return {
    id: str(record.id),
    title: str(record.title),
    shots: Array.isArray(record.shots) ? record.shots.map(normalizeShot) : [],
  }
}

function normalizeCharacter(value: unknown): StoryboardCharacter {
  const record = isRecord(value) ? value : {}
  const profile = isRecord(record.profile) ? record.profile : {}
  const palette = isRecord(record.palette) ? record.palette : {}
  const gen = isRecord(record.gen) ? record.gen : {}
  return {
    id: str(record.id),
    label: str(record.label),
    name: str(record.name),
    tags: strList(record.tags),
    profile: {
      temperament: str(profile.temperament),
      face: str(profile.face),
      costume: str(profile.costume),
    },
    palette: { base: str(palette.base), accent: str(palette.accent) },
    appearsIn: strList(record.appearsIn),
    gen: { lockedPrompt: str(gen.lockedPrompt), negativePrompt: str(gen.negativePrompt) },
  }
}

function normalizeAsset(value: unknown): StoryboardAsset {
  const record = isRecord(value) ? value : {}
  const ref = isRecord(record.ref) ? record.ref : {}
  return {
    name: str(record.name),
    type: oneOf(record.type, ['text', 'image', 'video', 'audio'] as const, 'image'),
    status: oneOf(record.status, ['ready', 'pending'] as const, 'pending'),
    ref: { kind: oneOf(ref.kind, ['canvasNode', 'file'] as const, 'file'), id: str(ref.id) },
  }
}

/** 归一化 `sections`（缺节给合法空值，不抛）。 */
export function normalizeStoryboardSections(value: unknown): StoryboardSections {
  const record = isRecord(value) ? value : {}
  const creative = isRecord(record['00_creative']) ? record['00_creative'] : {}
  const facts = isRecord(record['01_facts']) ? record['01_facts'] : {}
  const visual = isRecord(record['02_visual']) ? record['02_visual'] : {}
  const narration = isRecord(record['03_narration']) ? record['03_narration'] : {}
  const storyboard = isRecord(record['04_storyboard']) ? record['04_storyboard'] : {}
  const sound = isRecord(record['06_sound']) ? record['06_sound'] : {}
  const bgm = isRecord(sound.bgm) ? sound.bgm : {}
  return {
    '00_creative': { brief: str(creative.brief) },
    '01_facts': { facts: Array.isArray(facts.facts) ? facts.facts.map(normalizeFact) : [] },
    '02_visual': { tokens: Array.isArray(visual.tokens) ? visual.tokens.map((item) => {
      const token = isRecord(item) ? item : {}
      return { k: str(token.k), v: str(token.v) }
    }) : [] },
    '03_narration': { lines: Array.isArray(narration.lines) ? narration.lines.map(normalizeNarrationLine) : [] },
    '04_storyboard': { scenes: Array.isArray(storyboard.scenes) ? storyboard.scenes.map(normalizeScene) : [] },
    '05_characters': Array.isArray(record['05_characters']) ? record['05_characters'].map(normalizeCharacter) : [],
    '06_sound': {
      bgm: { bpm: num(bgm.bpm), lufs: num(bgm.lufs), sidechain: str(bgm.sidechain) },
      sfx: strList(sound.sfx),
    },
    '07_assets': Array.isArray(record['07_assets']) ? record['07_assets'].map(normalizeAsset) : [],
    '08_constraints': strList(record['08_constraints']),
  }
}

function normalizeMeta(value: unknown): StoryboardMeta {
  const record = isRecord(value) ? value : {}
  const audience = str(record.audience)
  return {
    genre: str(record.genre),
    targetDuration: num(record.targetDuration),
    aspect: str(record.aspect),
    ...(audience === '' ? {} : { audience }),
  }
}

function normalizeVersions(value: unknown): StoryboardVersions {
  const record = isRecord(value) ? value : {}
  const history: StoryboardVersion[] = Array.isArray(record.history)
    ? record.history.map((item) => {
      const entry = isRecord(item) ? item : {}
      const parent = str(entry.parent)
      return {
        version: str(entry.version),
        label: str(entry.label),
        createdAt: num(entry.createdAt),
        ...(parent === '' ? {} : { parent }),
        snapshot: normalizeStoryboardSections(entry.snapshot),
      }
    })
    : []
  const final = isRecord(record.final) ? normalizeStoryboardSections(record.final) : null
  const sourceVersion = str(record.sourceVersion)
  return {
    current: str(record.current),
    history,
    final,
    sourceVersion: sourceVersion === '' ? null : sourceVersion,
  }
}

function normalizeBindings(value: unknown): Record<string, StoryboardBinding> {
  if (!isRecord(value)) return {}
  const out: Record<string, StoryboardBinding> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) continue
    const canvasNodeId = str(item.canvasNodeId)
    const canvasAssetId = str(item.canvasAssetId)
    const seededFrom = str(item.seededFrom)
    out[key] = {
      ...(canvasNodeId === '' ? {} : { canvasNodeId }),
      ...(canvasAssetId === '' ? {} : { canvasAssetId }),
      ...(seededFrom === '' ? {} : { seededFrom }),
    }
  }
  return out
}

function normalizeActuals(value: unknown): Record<string, StoryboardActual> {
  if (!isRecord(value)) return {}
  const out: Record<string, StoryboardActual> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) continue
    const framingNote = str(item.framingNote)
    const qc = isRecord(item.qc) ? { verdict: str(item.qc.verdict) } : undefined
    const hasDuration = typeof item.actualDuration === 'number' && Number.isFinite(item.actualDuration)
    out[key] = {
      ...(hasDuration ? { actualDuration: item.actualDuration as number } : {}),
      ...(qc === undefined ? {} : { qc }),
      ...(framingNote === '' ? {} : { framingNote }),
    }
  }
  return out
}

/**
 * 宽松归一化一份未知的 `storyboard.json`。
 *
 * 与 `normalizeWorkflow` 同款取向：**字段级降级、绝不抛**。但有一条刻意不同——
 * 顶层不是对象（即文件根本不是 storyboard）时返回 `undefined`，让调用方走「损坏」
 * 分支（显式报错 + `.corrupt` 备份），而不是静默给一份空文档。
 */
export function normalizeStoryboard(value: unknown): StoryboardDocument | undefined {
  if (!isRecord(value)) return undefined
  const sections = normalizeStoryboardSections(value.sections)
  return {
    schemaVersion: num(value.schemaVersion) || STORYBOARD_SCHEMA_VERSION,
    projectId: str(value.projectId),
    title: str(value.title),
    meta: normalizeMeta(value.meta),
    sections,
    versions: normalizeVersions(value.versions),
    bindings: normalizeBindings(value.bindings),
    actuals: normalizeActuals(value.actuals),
  }
}

// ────────────────────────────── 完成度校验 ──────────────────────────────

/** `validateForSeed` 的结果：blockers 缺一不让落地；warnings 只进确认清单。 */
export interface StoryboardValidation {
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
}

/** 遍历所有分镜与 shot（供校验与 seed 共用，避免两处各写一遍遍历）。 */
export function forEachShot(
  sections: StoryboardSections,
  visit: (shot: StoryboardShot, scene: StoryboardScene) => void,
): void {
  for (const scene of sections['04_storyboard'].scenes) {
    for (const shot of scene.shots) visit(shot, scene)
  }
}

/** 收集全文语义 ID（分镜 / shot / 角色 / 旁白），供唯一性校验与 seed 铸造对照。 */
export function collectSemanticIds(sections: StoryboardSections): string[] {
  const ids: string[] = []
  for (const scene of sections['04_storyboard'].scenes) {
    ids.push(scene.id)
    for (const shot of scene.shots) ids.push(shot.id)
  }
  for (const character of sections['05_characters']) ids.push(character.id)
  for (const line of sections['03_narration'].lines) ids.push(line.id)
  return ids
}

/** 语义 ID 的书写约定（契约 §4.2）：`C1` / `S1` / `S1-Sh1` / `V1`。 */
const ID_PATTERN = /^(?:C\d+|S\d+-Sh\d+|S\d+|V\d+)$/u

/**
 * 落地前的完成度校验（契约 §7.1）。
 *
 * **纯函数、全入口共用一份** —— 修改后实时算、点击落地时兜底、`revise_storyboard` 前置
 * 校验，三处必须同源；旁开第二份迟早一份放过一份拦。
 *
 * 判据只回答「能不能落地」，**不回答「好不好」**：时长偏差、待核实条数、缺 `promptEn`
 * 都是 warning（列进确认清单让用户自己拍板），不是 blocker。
 */
export function validateForSeed(document: StoryboardDocument): StoryboardValidation {
  const blockers: string[] = []
  const warnings: string[] = []
  const { sections, meta, title } = document

  // ── meta / 标题 ──
  if (title.trim() === '') blockers.push('缺少标题（title）')
  if (meta.aspect.trim() === '') blockers.push('缺少画幅（meta.aspect）')
  if (!(meta.targetDuration > 0)) blockers.push('缺少目标时长（meta.targetDuration）')
  if (meta.genre.trim() === '') warnings.push('未填写题材（meta.genre）')

  // ── §02 视觉规范 ──
  const tokens = sections['02_visual'].tokens
  if (tokens.length === 0) blockers.push('§02 视觉规范至少需要 1 个 token（否则 Look 卡无内容）')

  // ── §04 分镜 ──
  const scenes = sections['04_storyboard'].scenes
  if (scenes.length === 0) blockers.push('§04 分镜至少要 1 个分镜（scene）')
  let shotCount = 0
  let totalDuration = 0
  let missingPrompt = 0
  for (const scene of scenes) {
    if (scene.id.trim() === '') blockers.push('存在未编号的分镜（scene.id 为空）')
    if (scene.shots.length === 0) blockers.push(`分镜 ${scene.id || '(未命名)'} 至少要 1 个 shot`)
    for (const shot of scene.shots) {
      shotCount += 1
      totalDuration += shot.duration
      const label = shot.id || '(未编号)'
      if (shot.id.trim() === '') blockers.push(`分镜 ${scene.id || '(未命名)'} 存在未编号的 shot`)
      if (!(shot.duration > 0)) blockers.push(`shot ${label} 的时长必须大于 0`)
      if (shot.visual.trim() === '') blockers.push(`shot ${label} 缺少画面描述（visual）`)
      if (shot.promptEn === undefined || shot.promptEn.trim() === '') missingPrompt += 1
    }
  }
  if (shotCount > STORYBOARD_MAX_SHOTS) {
    warnings.push(`shot 数 ${shotCount} 超过建议上限 ${STORYBOARD_MAX_SHOTS}`)
  }
  if (missingPrompt > 0) warnings.push(`${missingPrompt} 个 shot 缺英文 prompt（promptEn）`)

  // ── §03 旁白引用 ──
  const narrationIds = new Set(sections['03_narration'].lines.map((line) => line.id))
  for (const line of sections['03_narration'].lines) {
    if (line.id.trim() === '') blockers.push('存在未编号的旁白句（§03 id 为空）')
    if (line.text.trim() === '') blockers.push(`旁白 ${line.id || '(未命名)'} 内容为空`)
    if (line.shotRef !== undefined && line.shotRef !== '' && !allShotIds(sections).has(line.shotRef)) {
      warnings.push(`旁白 ${line.id} 引用了不存在的 shot（${line.shotRef}）`)
    }
  }
  forEachShot(sections, (shot) => {
    if (shot.narrationRef !== undefined && shot.narrationRef !== '' && !narrationIds.has(shot.narrationRef)) {
      blockers.push(`shot ${shot.id} 引用了不存在的旁白句（${shot.narrationRef}）`)
    }
  })

  // ── §05 角色 ──
  const sceneIds = new Set(scenes.map((scene) => scene.id))
  for (const character of sections['05_characters']) {
    if (character.id.trim() === '') blockers.push('存在未编号的角色（§05 id 为空）')
    if (character.gen.lockedPrompt.trim() === '') {
      blockers.push(`角色 ${character.label || character.id || '(未命名)'} 缺少锁定提示词（gen.lockedPrompt）`)
    }
    for (const sceneRef of character.appearsIn) {
      if (!sceneIds.has(sceneRef)) warnings.push(`角色 ${character.id} 的 appearsIn 引用了不存在的分镜（${sceneRef}）`)
    }
  }

  // ── 语义 ID 唯一性 / 书写约定 ──
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const id of collectSemanticIds(sections)) {
    if (seen.has(id)) duplicated.add(id)
    seen.add(id)
  }
  for (const id of duplicated) blockers.push(`语义 ID 重复（${id}）——一次铸造、永不复用`)
  for (const id of seen) {
    if (id !== '' && !ID_PATTERN.test(id)) warnings.push(`语义 ID 不符合书写约定（${id}）`)
  }

  // ── 时长预算偏差 ──
  if (meta.targetDuration > 0 && shotCount > 0) {
    const deviation = Math.abs(totalDuration - meta.targetDuration) / meta.targetDuration
    if (deviation > STORYBOARD_DURATION_TOLERANCE) {
      warnings.push(
        `Σ shot 时长 ${totalDuration.toFixed(1)}s 与目标 ${meta.targetDuration.toFixed(1)}s 偏差 ${(deviation * 100).toFixed(0)}%`,
      )
    }
  }

  // ── §01 待核实 / §07 待上传 ──
  const pendingFacts = sections['01_facts'].facts.filter((fact) => fact.status === 'pending').length
  if (pendingFacts > 0) warnings.push(`§01 还有 ${pendingFacts} 条事实待核实（落地时会被丢弃）`)
  const pendingAssets = sections['07_assets'].filter((asset) => asset.status === 'pending').length
  if (pendingAssets > 0) warnings.push(`§07 还有 ${pendingAssets} 条素材待上传`)

  return { blockers, warnings }
}

/** §04 全部 shot id 集合（引用校验用）。 */
function allShotIds(sections: StoryboardSections): Set<string> {
  const ids = new Set<string>()
  forEachShot(sections, (shot) => { if (shot.id !== '') ids.add(shot.id) })
  return ids
}
