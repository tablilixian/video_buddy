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
  const disposers = MINIMAX_SKILL_NAMES.map((name) => {
    const dir = join(MINIMAX_SKILLS_DIR, name)
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    // CR-037：`description:` 为空串时 `??` 不当缺失 → 用 `||` 让空串回退到 name。
    const description = String(meta.description || meta.name || name).slice(0, 500)
    return ctx.skills.register({
      name,
      description,
      source: 'runtime',
      content: body,
      resourceBase: { kind: 'directory', path: dir },
    })
  })
  return () => { for (const dispose of disposers) dispose() }
}
