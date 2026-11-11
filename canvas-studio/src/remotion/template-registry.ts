/**
 * 1（CV-463）· **模板注册表**（宿主侧读盘）。
 *
 * 目录规范（`决策-模板需求收口.md` §2.2）：
 *
 * ```
 * assets/templates/<family>/<id>/
 *   meta.json               # 身份 / 契约版本 / 体裁 / 时长 / 素材需求 / 构件清单
 *   manifest.template.json  # 真实可渲骨架，文本位是 {{slotId}}
 *   slots.json              # 参数合同（对 LLM 的唯一接口）
 *   furniture.json          # 可选：装饰构件声明（1C 的 FurnitureSpec[]）
 *   audio.json              # 可选：音频声明 —— { sfx: ManifestSfx[], bgm: {...} }
 *   frames/                 # 参考帧基线（真机渲染后生成，可空）
 *   README.md               # 给模板作者
 * ```
 *
 * 为什么在 `assets/` 而不是包根 `templates/`：`package.json` 的 `files` 白名单是
 * `[cordis.patch.yml, assets/**, lib/**, skills/**, README.md]` ⇒ 包根目录**不会被打包发布**。
 *
 * ## 设计上的两条克制
 *
 * 1. **读盘失败不抛**（`listTemplateSummaries` 返回 `problems`）：一个坏模板不该让整个
 *    模板库消失 —— 但也不能静默跳过，所以坏的那条要**点名**给模型看；
 * 2. **排序确定**（按 `family/id` 字典序）：`list_templates` 的输出必须可复现，
 *    否则「同一份需求两次列出不同顺序」会让模型的选择看起来随机。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FurnitureSpec } from './furniture.js'
import { MANIFEST_CONTRACT_VERSION, type ManifestSfx } from './manifest.js'
import type { SlotContract } from './slot-contract.js'
import type { TemplateAudio, TemplateBgm, TemplateBundle, TemplateMeta } from './template-compile.js'

/**
 * 模板根目录。模块编译到 `lib/remotion/` ⇒ 上两级 = 包根 ⇒ `assets/templates`。
 * 允许 `opts.root` 覆盖（单测用临时目录，不去碰真模板库）。
 */
export const TEMPLATES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'templates')

export interface TemplateSummary {
  meta: TemplateMeta
  /** 槽位摘要（`list_templates` 直接展示，省得模型再取一次全文）。 */
  slotSummary: {
    id: string
    label: string
    required: boolean
    type: string
    maxChars?: number
    maxLines?: number
    semantic?: string
  }[]
  /** 完整槽位合同（判据要用 `maxChars` 之外的字段，摘要不够）。 */
  slots: SlotContract[]
  /** 模板目录（绝对路径，排查用；不进工具输出）。 */
  dir: string
  /** 契约版本是否与当前渲染器一致（false ⇒ 该模板不可用，必须在清单里标出来）。 */
  contractOk: boolean
}

export interface CatalogProblem {
  dir: string
  reason: string
}

export interface TemplateCatalog {
  items: TemplateSummary[]
  problems: CatalogProblem[]
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function exists(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** 摘要（`list_templates` 的输出项）：只用 `meta.json` + `slots.json`，不读骨架。 */
function summarize(dir: string, meta: TemplateMeta, slots: SlotContract[]): TemplateSummary {
  return {
    meta,
    slotSummary: slots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      required: slot.required === true,
      type: slot.type,
      ...(slot.maxChars === undefined ? {} : { maxChars: slot.maxChars }),
      ...(slot.maxLines === undefined ? {} : { maxLines: slot.maxLines }),
      ...(slot.semantic === undefined ? {} : { semantic: slot.semantic }),
    })),
    slots,
    dir,
    contractOk: meta.contractVersion === MANIFEST_CONTRACT_VERSION,
  }
}

/**
 * 扫全库：`<root>/<family>/<id>/{meta.json,slots.json}`。
 *
 * 只认两层目录（`family/id`）。`meta.json` 里的 `id` 与目录不一致 ⇒ 记为 problem
 * （否则「文件里写 A、目录叫 B」会让排查从第一步就错）。
 */
export function listTemplateSummaries(opts?: { root?: string }): TemplateCatalog {
  const root = opts?.root ?? TEMPLATES_ROOT
  const items: TemplateSummary[] = []
  const problems: CatalogProblem[] = []
  let families: string[]
  try {
    families = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return { items, problems: [{ dir: root, reason: '模板根目录不存在或不可读' }] }
  }
  for (const family of families) {
    const familyDir = join(root, family)
    let ids: string[]
    try {
      ids = readdirSync(familyDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    } catch {
      problems.push({ dir: familyDir, reason: '体裁目录不可读' })
      continue
    }
    for (const id of ids) {
      const dir = join(familyDir, id)
      const metaFile = join(dir, 'meta.json')
      const slotsFile = join(dir, 'slots.json')
      if (!exists(metaFile) || !exists(slotsFile)) {
        problems.push({ dir, reason: '缺 meta.json 或 slots.json（模板目录不完整，已跳过）' })
        continue
      }
      try {
        const meta = readJson(metaFile) as TemplateMeta
        if (typeof meta?.id !== 'string' || meta.id.trim() === '') {
          problems.push({ dir, reason: 'meta.json 缺 id' })
          continue
        }
        if (meta.id !== `${family}/${id}`) {
          problems.push({ dir, reason: `meta.id（${meta.id}）与目录（${family}/${id}）不一致` })
          continue
        }
        const raw = readJson(slotsFile) as { slots?: unknown }
        const slots = Array.isArray(raw?.slots) ? raw.slots as SlotContract[] : []
        items.push(summarize(dir, meta, slots))
      } catch (error) {
        problems.push({ dir, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }
  items.sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0))
  return { items, problems }
}

/**
 * 模板读取失败（目录缺失 / 骨架缺失 / JSON 坏）。
 *
 * 为什么是自定义类而不是 `throw new Error`：`tests/error-system-guards.test.mjs` 禁止
 * `src/**` 出现裸抛（裸抛没有错误码、没有人话文案，上层只能原样透出）。也不用
 * `throwError('CS-…')` —— 那会让这个纯读盘模块反向依赖 error-system，而它要能在
 * 构建脚本 / 测试里单独用。**转换点只有一个**：`template-scaffold.ts` 的 catch
 * 把它变成 `CS-USER-ERR`（带可执行文案）。
 */
export class TemplateRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateRegistryError'
  }
}

/** 按 id 找模板目录（`family/id`）。找不到返回 undefined（调用方给可读的拒收文案）。 */
export function findTemplateDir(id: string, opts?: { root?: string }): string | undefined {
  const root = opts?.root ?? TEMPLATES_ROOT
  const [family, name, ...rest] = id.split('/')
  if (rest.length > 0 || family === undefined || name === undefined || family === '' || name === '') return undefined
  const dir = join(root, family, name)
  return exists(join(dir, 'meta.json')) ? dir : undefined
}

/**
 * `audio.json` → `TemplateAudio`。**两种形状都认**：
 *
 * - 裸数组（1 / CV-463 的写法，只有音效表）⇒ `{ sfx: [...] }` —— 老模板不用改文件；
 * - 对象 `{ sfx?, bgm? }`（A1 起）⇒ 逐字段收，字段类型不对就当没有。
 *
 * 为什么不在这里抛错：音频是**可选增强**，一个 `bgm.prompt` 写错不该让整份模板不可用
 * （骨架和槽位都是好的）。真正影响出片的坏形状会在 `validateManifest` 那里红。
 */
function readAudio(file: string): TemplateAudio | undefined {
  if (!exists(file)) return undefined
  const raw = readJson(file) as unknown
  if (Array.isArray(raw)) return raw.length === 0 ? undefined : { sfx: raw as ManifestSfx[] }
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as { sfx?: unknown; bgm?: unknown }
  const audio: TemplateAudio = {}
  if (Array.isArray(r.sfx) && r.sfx.length > 0) audio.sfx = r.sfx as ManifestSfx[]
  if (r.bgm !== null && typeof r.bgm === 'object') {
    const b = r.bgm as Record<string, unknown>
    if (typeof b.prompt === 'string' && b.prompt.trim() !== '') {
      const bgm: TemplateBgm = { prompt: b.prompt }
      const num = (key: string): number | undefined =>
        typeof b[key] === 'number' && Number.isFinite(b[key] as number) ? b[key] as number : undefined
      const volume = num('volume')
      const fadeInSeconds = num('fadeInSeconds')
      const fadeOutSeconds = num('fadeOutSeconds')
      const durationSeconds = num('durationSeconds')
      if (volume !== undefined) bgm.volume = volume
      if (fadeInSeconds !== undefined) bgm.fadeInSeconds = fadeInSeconds
      if (fadeOutSeconds !== undefined) bgm.fadeOutSeconds = fadeOutSeconds
      if (durationSeconds !== undefined) bgm.durationSeconds = durationSeconds
      audio.bgm = bgm
    }
  }
  return Object.keys(audio).length === 0 ? undefined : audio
}

/**
 * 载入一份完整模板（骨架 + 槽位 + 构件 + 音效/配乐）。缺可选文件按「没有」处理。
 *
 * @throws 骨架缺失 / JSON 坏 —— 这是真错误（模板不可用），必须让调用方看到原因。
 */
export function loadTemplateBundle(id: string, opts?: { root?: string }): { bundle: TemplateBundle; dir: string } {
  const dir = findTemplateDir(id, opts)
  if (dir === undefined) {
    const available = listTemplateSummaries(opts).items.map((item) => item.meta.id)
    throw new TemplateRegistryError(`没有这个模板：${id}。可用：${available.length === 0 ? '（当前模板库为空）' : available.join(' / ')}`)
  }
  const meta = readJson(join(dir, 'meta.json')) as TemplateMeta
  const rawSlots = readJson(join(dir, 'slots.json')) as { slots?: SlotContract[] }
  const skeletonFile = exists(join(dir, 'manifest.template.json'))
    ? join(dir, 'manifest.template.json')
    : join(dir, 'manifest.json')
  if (!exists(skeletonFile)) {
    throw new TemplateRegistryError(`模板 ${id} 缺 manifest.template.json（骨架）—— 目录：${dir}`)
  }
  const skeleton = readJson(skeletonFile)
  const furniture = exists(join(dir, 'furniture.json')) ? (readJson(join(dir, 'furniture.json')) as FurnitureSpec[]) : undefined
  const audio = readAudio(join(dir, 'audio.json'))
  return {
    dir,
    bundle: {
      meta,
      skeleton,
      slots: Array.isArray(rawSlots?.slots) ? rawSlots.slots : [],
      ...(furniture === undefined ? {} : { furniture }),
      ...(audio === undefined ? {} : { audio }),
    },
  }
}
