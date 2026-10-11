/**
 * REQ-022 · 故事版**字段级 diff** —— 纯函数，`diffSections(a, b) → DiffEntry[]`。
 *
 * ## 为什么不用文本 diff
 *
 * 两个版本都是 JSON。对 JSON 做行级/字符级 diff，输出是「哪几个花括号不一样」——
 * 对审阅者毫无用处。用户真正要问的是**「第 3 镜的时长变了吗」「角色卡的锁定提示词
 * 动过没有」**，所以这里按**语义路径逐字段**比，并且每条差异都带人读中文 label。
 *
 * ## 匹配规则
 *
 * - 带语义 ID 的集合（分镜 S / shot / 角色 C / 旁白 V）**按 ID 配对**，所以「第 2 镜
 *   插到第 1 镜前面」不会报成一串 changed（下标配对才会）。
 * - 不带 ID 的集合（§01 事实按 `claim`、§07 素材按 `name`、§02 token 按 `k`）按
 *   **自然键**配对；§08 硬约束与 §06 音效是无键字符串数组，按**下标**配对（这是它唯一
 *   可用的稳定口径，且它们本来就是有序列表）。
 *
 * ## 输出
 *
 * `section` 是分节 id（`s0`..`s8`），供 UI 跳到该节；`path` 是人读定位串
 * （`04 分镜.S1.S1-Sh1.duration`）；`label` 是字段的中文名。
 */
import type { StoryboardSections } from './contracts/storyboard.js'

/** 差异种类。 */
export type DiffKind = 'added' | 'removed' | 'changed'

/** 一条字段级差异。 */
export interface DiffEntry {
  /** 分节 id（`s0`..`s8`），UI 用它跳转。 */
  readonly section: string
  /** 人读定位串，如 `04 分镜.S1.S1-Sh1.duration`。 */
  readonly path: string
  /** 字段中文名，如「时长」。 */
  readonly label: string
  readonly kind: DiffKind
  /** 旧值（`added` 时缺省）。 */
  readonly from?: string
  /** 新值（`removed` 时缺省）。 */
  readonly to?: string
}

/** 值 → 展示串（数字保留原样，字符串原样，其它 JSON 化；空值统一 `—`）。 */
function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.trim() === '' ? '—' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 0)
}

/** 差异收集器（省掉每个比较点重复 five 参数）。 */
class Collector {
  readonly entries: DiffEntry[] = []
  constructor(private readonly section: string, private readonly prefix: string) {}

  /** 比一个标量字段。 */
  field(label: string, from: unknown, to: unknown): void {
    if (show(from) === show(to)) return
    this.entries.push({ section: this.section, path: `${this.prefix}.${label}`, label, kind: 'changed', from: show(from), to: show(to) })
  }

  /** 记录一条新增 / 删除。 */
  mark(kind: 'added' | 'removed', path: string, label: string, value: unknown): void {
    this.entries.push({
      section: this.section,
      path: `${this.prefix}.${path}`,
      label,
      kind,
      ...(kind === 'removed' ? { from: show(value) } : { to: show(value) }),
    })
  }
}

/** 对比两个「按键配对」的集合：只在左 → removed；只在右 → added；都有 → 逐字段比。 */
function compareKeyed<T>(
  collector: Collector,
  left: readonly T[],
  right: readonly T[],
  keyOf: (item: T) => string,
  labelOf: (item: T) => string,
  compare: (a: T, b: T, childPrefix: string) => void,
  /**
   * 增删条目的**路径后缀**（默认 = `keyOf`）。
   *
   * 嵌套实体必须显式给：shot 的差异路径要带分镜前缀（`S1.S1-Sh9`），否则渲染层按
   * `04 分镜.S1.S1-Sh9` 去找锚点时找不到 —— 表现是「摘要说有新增，文档里却一处没高亮」。
   */
  pathOf: (item: T) => string = keyOf,
): void {
  const leftMap = new Map(left.map((item) => [keyOf(item), item]))
  const rightMap = new Map(right.map((item) => [keyOf(item), item]))
  for (const [key, item] of leftMap) {
    if (!rightMap.has(key)) collector.mark('removed', pathOf(item), labelOf(item), labelOf(item))
  }
  for (const [key, item] of rightMap) {
    const prior = leftMap.get(key)
    if (prior === undefined) {
      collector.mark('added', pathOf(item), labelOf(item), labelOf(item))
      continue
    }
    compare(prior, item, key)
  }
}

/** 对比两个无键字符串数组（按下标配对）。 */
function compareLines(collector: Collector, left: readonly string[], right: readonly string[], label: string): void {
  const max = Math.max(left.length, right.length)
  for (let index = 0; index < max; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) collector.mark('added', `${label}[${String(index + 1)}]`, label, b)
    else if (b === undefined) collector.mark('removed', `${label}[${String(index + 1)}]`, label, a)
    else collector.field(`${label}[${String(index + 1)}]`, a, b)
  }
}

/** 计算两版 `sections` 的字段级差异。顺序稳定（按节序 → 实体序 → 字段序）。 */
export function diffSections(
  before: StoryboardSections,
  after: StoryboardSections,
): readonly DiffEntry[] {
  const out: DiffEntry[] = []

  // ── 00 创意理解 ──
  {
    const c = new Collector('s0', '00 创意理解')
    c.field('创意', before['00_creative'].brief, after['00_creative'].brief)
    out.push(...c.entries)
  }

  // ── 01 素材与事实（按 claim 配对）──
  {
    const c = new Collector('s1', '01 事实')
    compareKeyed(c, before['01_facts'].facts, after['01_facts'].facts,
      (fact) => fact.claim, (fact) => fact.claim,
      (a, b, key) => {
        c.field(`${key}.来源`, a.source, b.source)
        c.field(`${key}.状态`, a.status, b.status)
      })
    out.push(...c.entries)
  }

  // ── 02 视觉规范（按 token 键 k 配对）──
  {
    const c = new Collector('s2', '02 视觉规范')
    compareKeyed(c, before['02_visual'].tokens, after['02_visual'].tokens,
      (token) => token.k, (token) => token.k,
      (a, b, key) => { c.field(key, a.v, b.v) })
    out.push(...c.entries)
  }

  // ── 03 旁白（按 V 号配对）──
  {
    const c = new Collector('s3', '03 旁白')
    compareKeyed(c, before['03_narration'].lines, after['03_narration'].lines,
      (line) => line.id, (line) => line.id,
      (a, b, key) => {
        c.field(`${key}.文本`, a.text, b.text)
        c.field(`${key}.时长`, a.duration, b.duration)
        c.field(`${key}.引用 shot`, a.shotRef, b.shotRef)
      })
    out.push(...c.entries)
  }

  // ── 04 分镜脚本（scene 按 S 号 → shot 按 S-Sh 号）──
  {
    const c = new Collector('s4', '04 分镜')
    compareKeyed(c, before['04_storyboard'].scenes, after['04_storyboard'].scenes,
      (scene) => scene.id, (scene) => scene.title.trim() === '' ? scene.id : scene.title,
      (a, b, sceneKey) => {
        c.field(`${sceneKey}.分镜标题`, a.title, b.title)
        compareKeyed(c, a.shots, b.shots,
          (shot) => shot.id, (shot) => shot.id,
          (shotA, shotB, shotKey) => {
            c.field(`${sceneKey}.${shotKey}.时长`, shotA.duration, shotB.duration)
            c.field(`${sceneKey}.${shotKey}.帧数`, shotA.frames, shotB.frames)
            c.field(`${sceneKey}.${shotKey}.运镜`, shotA.camera, shotB.camera)
            c.field(`${sceneKey}.${shotKey}.画面`, shotA.visual, shotB.visual)
            c.field(`${sceneKey}.${shotKey}.声音`, shotA.audio, shotB.audio)
            c.field(`${sceneKey}.${shotKey}.旁白引用`, shotA.narrationRef, shotB.narrationRef)
            c.field(`${sceneKey}.${shotKey}.英文 prompt`, shotA.promptEn, shotB.promptEn)
            c.field(`${sceneKey}.${shotKey}.备份拍`, shotA.backup, shotB.backup)
          },
          (shot) => `${sceneKey}.${shot.id}`)
      },
      (scene) => `${scene.id}.分镜标题`)
    out.push(...c.entries)
  }

  // ── 05 角色（按 C 号配对）──
  {
    const c = new Collector('s5', '05 角色')
    compareKeyed(c, before['05_characters'], after['05_characters'],
      (character) => character.id,
      (character) => character.name.trim() === '' ? character.id : character.name,
      (a, b, key) => {
        c.field(`${key}.标签 ROLE`, a.label, b.label)
        c.field(`${key}.姓名`, a.name, b.name)
        c.field(`${key}.外貌标签`, a.tags.join(' / '), b.tags.join(' / '))
        c.field(`${key}.气质`, a.profile.temperament, b.profile.temperament)
        c.field(`${key}.面部`, a.profile.face, b.profile.face)
        c.field(`${key}.服装`, a.profile.costume, b.profile.costume)
        c.field(`${key}.主色`, a.palette.base, b.palette.base)
        c.field(`${key}.点缀色`, a.palette.accent, b.palette.accent)
        c.field(`${key}.出场分镜`, a.appearsIn.join(' / '), b.appearsIn.join(' / '))
        c.field(`${key}.锁定提示词`, a.gen.lockedPrompt, b.gen.lockedPrompt)
        c.field(`${key}.负向提示词`, a.gen.negativePrompt, b.gen.negativePrompt)
      })
    out.push(...c.entries)
  }

  // ── 06 声音设计 ──
  {
    const c = new Collector('s6', '06 声音')
    c.field('BPM', before['06_sound'].bgm.bpm, after['06_sound'].bgm.bpm)
    c.field('响度', before['06_sound'].bgm.lufs, after['06_sound'].bgm.lufs)
    c.field('侧链避让', before['06_sound'].bgm.sidechain, after['06_sound'].bgm.sidechain)
    compareLines(c, before['06_sound'].sfx, after['06_sound'].sfx, '音效点')
    out.push(...c.entries)
  }

  // ── 07 素材清单（按 name 配对）──
  {
    const c = new Collector('s7', '07 素材')
    compareKeyed(c, before['07_assets'], after['07_assets'],
      (asset) => asset.name, (asset) => asset.name,
      (a, b, key) => {
        c.field(`${key}.类型`, a.type, b.type)
        c.field(`${key}.状态`, a.status, b.status)
        c.field(`${key}.引用`, `${a.ref.kind}:${a.ref.id}`, `${b.ref.kind}:${b.ref.id}`)
      })
    out.push(...c.entries)
  }

  // ── 08 硬约束（有序字符串数组，按下标配对）──
  {
    const c = new Collector('s8', '08 硬约束')
    compareLines(c, before['08_constraints'], after['08_constraints'], '硬约束')
    out.push(...c.entries)
  }

  return out
}

/** 差异按分节汇总（UI 顶部摘要行用它）。 */
export function summarizeDiff(entries: readonly DiffEntry[]): ReadonlyArray<{ section: string; label: string; count: number }> {
  const order: string[] = []
  const byKey = new Map<string, { section: string; label: string; count: number }>()
  for (const entry of entries) {
    const bucket = byKey.get(entry.section)
    if (bucket === undefined) {
      order.push(entry.section)
      byKey.set(entry.section, { section: entry.section, label: entry.path.split('.')[0] ?? entry.section, count: 1 })
      continue
    }
    bucket.count += 1
  }
  return order.map((key) => byKey.get(key)!)
}
