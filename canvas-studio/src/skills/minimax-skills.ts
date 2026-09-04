/**
 * MiniMax-H3 upstream skills registration.
 *
 * Skill bodies come verbatim from the pinned `minimax-h3` submodule via
 * `scripts/sync-minimax-skills.mjs`, which copies each enabled skill directory
 * into `skills/<name>/` with the upstream h3 layout preserved (SKILL.md +
 * references/). This module reads `skills/<name>/SKILL.md` from disk at
 * registration time and registers each skill with a directory `resourceBase`:
 * the model loads the lean SKILL.md entry on `skill(name)`, and the rendered
 * `<skill_resources>` hint tells it to resolve `references/<file>` against the
 * base directory and load those files on demand through the harness `read`
 * tool (progressive disclosure; fs reads are not sandboxed — only writes are).
 *
 * Directory membership under `skills/` decides what is registered; content is
 * never adapted here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'

/** Package-root `skills/` directory (populated by scripts/sync-minimax-skills.mjs). */
export const MINIMAX_SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')

/** Registry-valid kebab-case names of upstream skills present under skills/. */
export const MINIMAX_SKILL_NAMES = existsSync(MINIMAX_SKILLS_DIR)
  ? readdirSync(MINIMAX_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(MINIMAX_SKILLS_DIR, entry.name, 'SKILL.md')))
      .map((entry) => entry.name)
      .sort()
  : []

/** Parsed leading YAML frontmatter (name/description only, no yaml dep). */
function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md)
  if (match === null) return { meta: {}, body: md.trimStart() }
  const lines = match[1]?.split(/\r?\n/) ?? []
  const meta: Record<string, string> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv === null) { i += 1; continue }
    const key = kv[1]
    const rawValue = kv[2]
    if (key === undefined || rawValue === undefined) { i += 1; continue }
    let value = rawValue.trim()
    i += 1
    // CR-036：`|`（literal）/`>`（folded）折行标量都收集后续缩进行，注册
    // description 统一折叠成单行；顺带剥离两端引号（`description: "..."`）。
    if (value === '|' || value === '>') {
      const parts: string[] = []
      while (i < lines.length) {
        const next = lines[i]
        if (next === undefined || !/^\s+\S/.test(next)) break
        parts.push(next.trim())
        i += 1
      }
      value = parts.join(' ')
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }
  return { meta, body: md.slice(match[0]?.length ?? 0).trimStart() }
}

/**
 * description 注册上限（字符）。
 *
 * SK-04：取值依据 = 实测 `skills/` 下 13 个 skill 的 frontmatter description，
 * 最长者 `papercraft-stop-motion-explainer` 为 914 字符，故取 914 + 约 100 buffer。
 * **不要随手调小**——description 是模型在 catalog 中选择 skill 的唯一依据，
 * 截断会静默砍掉排在最末的负向路由语（如 "Not for KOC talking-head ads…" 这类
 * 能力边界限定），且改动前后都无日志，故障极难发现。
 * 调整本值须同步更新 `tests/minimax-skill.test.mjs` 的长度快照断言。
 */
export const DESCRIPTION_LIMIT = 1024

/** description 截断结果。 */
export interface TruncatedDescription {
  text: string
  truncated: boolean
  /** 被丢弃的字符数（未截断时为 0）。 */
  dropped: number
}

/**
 * 截断 skill description（纯函数，无副作用，便于单测）。
 * 恰好等于 limit 时不截断、不计为截断。
 * @param raw - frontmatter 中的原始 description。
 * @param limit - 上限，缺省用 {@link DESCRIPTION_LIMIT}。
 */
export function truncateDescription(raw: string, limit = DESCRIPTION_LIMIT): TruncatedDescription {
  if (raw.length <= limit) return { text: raw, truncated: false, dropped: 0 }
  return { text: raw.slice(0, limit), truncated: true, dropped: raw.length - limit }
}

/** 单个 skill 的读取结果：description 统计 + 去掉 frontmatter 的正文。 */
export interface SkillStat {
  /** skill 注册名（同 skills/<name>/ 目录名）。 */
  name: string
  /** skills/<name>/ 绝对路径（即 resourceBase.path）。 */
  dir: string
  /** 截断前的原始 description。 */
  rawDescription: string
  /** 截断后实际注册给 harness 的 description。 */
  description: string
  /** rawDescription 的字符数。 */
  length: number
  truncated: boolean
  dropped: number
  /** SKILL.md 正文（已剥离 frontmatter）。 */
  body: string
}

/**
 * 读取 `skills/` 下全部 skill 的 description 统计与正文（纯读盘，无副作用）。
 * 供注册流程与单测共用，避免测试侧重复实现 frontmatter 解析而漂移。
 */
export function collectSkillStats(): readonly SkillStat[] {
  return MINIMAX_SKILL_NAMES.map((name) => {
    const dir = join(MINIMAX_SKILLS_DIR, name)
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    // CR-037：`description:` 为空串时 `??` 不当缺失 → 用 `||` 让空串回退到 name。
    const rawDescription = String(meta.description || meta.name || name)
    const { text, truncated, dropped } = truncateDescription(rawDescription)
    return {
      name,
      dir,
      rawDescription,
      description: text,
      length: rawDescription.length,
      truncated,
      dropped,
      body,
    }
  })
}

/**
 * Register every synced upstream skill into the host registry with a directory
 * resource base for on-demand `references/` reads.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all skills.
 */
export function registerMinimaxSkills(ctx: Context): () => void {
  if (MINIMAX_SKILL_NAMES.length === 0) {
    console.warn('[canvas-studio] minimax skills dir missing or empty — run scripts/sync-minimax-skills.mjs')
    return () => { }
  }
  const stats = collectSkillStats()
  // SK-04：截断不再静默——每个被砍的 skill 都留一行 warn。
  for (const stat of stats) {
    if (stat.truncated) {
      console.warn(`[canvas-studio] skill ${stat.name} description truncated: dropped ${stat.dropped} chars`)
    }
  }
  const disposers = stats.map((stat) =>
    ctx.skills.register({
      name: stat.name,
      description: stat.description,
      source: 'runtime',
      content: stat.body,
      resourceBase: { kind: 'directory', path: stat.dir },
    }),
  )
  // SK-08：注册汇总——让「有多少 skill 的路由语被截断、各丢了多少」在启动时
  // 直接可见，而不是只能事后翻 session jsonl 才发现。
  const truncated = stats.filter((stat) => stat.truncated)
  console.info(
    `[canvas-studio] skills registered: ${stats.length} total, ${truncated.length} description truncated` +
      (truncated.length > 0 ? ` → ${truncated.map((stat) => `${stat.name} -${stat.dropped}`).join(', ')}` : ''),
  )
  return () => { for (const dispose of disposers) dispose() }
}
