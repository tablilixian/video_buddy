/**
 * Sync MiniMax-H3 skills into a generated TypeScript asset module.
 *
 * Reads `minimax-h3/skills/<name>/SKILL.cn.md` (fallback SKILL.md) from the pinned
 * submodule and emits `src/skills/generated/minimax-skills.ts` with the skill
 * content verbatim (zero adaptation). Only skills listed in ENABLED are
 * emitted; enable more by editing the set and rerunning this script.
 *
 * Usage: node scripts/sync-minimax-skills.mjs
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUBMODULE = join(ROOT, '..', 'minimax-h3') // repo-root submodule
const SKILLS_DIR = join(SUBMODULE, 'skills')
const OUT_DIR = join(ROOT, 'src', 'skills', 'generated')
const OUT_FILE = join(OUT_DIR, 'minimax-skills.ts')
const STYLE_DEMO_DIR = join(ROOT, 'assets', 'style-demos') // 风格澄清 GIF 预览资产

/** Skills actually registered. All 9 upstream skills (h3-prompt-writing + 8 style generators). */
const ENABLED = new Set([
  'h3-prompt-writing',
  '3d-animation-short-generator',
  'brand-promo-video-generator',
  'co-op-game-intro-generator',
  'handdrawn-live-video-generator',
  'minimalist-product-ad-generator',
  'music-video-subtitle-generator',
  'paper-collage-explainer-generator',
  'papercraft-stop-motion-explainer',
])

/** Parse leading YAML frontmatter (name/description only, no yaml dep). */
function parseFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md)
  if (match === null) return { meta: {}, body: md.trimStart() }
  const lines = match[1].split(/\r?\n/)
  const meta = {}
  let i = 0
  while (i < lines.length) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (kv === null) { i += 1; continue }
    const key = kv[1]
    let value = kv[2].trim()
    i += 1
    if (value === '|') {
      const parts = []
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        parts.push(lines[i].trim())
        i += 1
      }
      value = parts.join(' ')
    }
    meta[key] = value
  }
  return { meta, body: md.slice(match[0].length).trimStart() }
}

/**
 * Inline `references/` assets that the skill body explicitly reads.
 *
 * Upstream skills reference relative files like `references/base-en.txt`;
 * `ctx.skills.register({ content })` registers a plain markdown body with no
 * filesystem access, so those reads would fail at runtime. Instead of wiring a
 * runtime `resourceBase` (path resolution breaks after bundling), we inline the
 * referenced file verbatim into the content: the `references/<file>` token in
 * the body is rewritten to `<file>` and the file text is appended at the end
 * under a clearly marked "Inline skill attachments" section. Files present in
 * `references/` but never referenced by the body are skipped (warned, not
 * inlined — keeps the body lean).
 */
function inlineReferences(name, body, referencesDir) {
  if (!existsSync(referencesDir)) return { body, inlined: [], skipped: [] }
  const files = readdirSync(referencesDir).filter((f) => f.endsWith('.txt') || f.endsWith('.md')).sort()
  const inlined = []
  const skipped = []
  const attachments = []
  let next = body
  for (const file of files) {
    const token = `references/${file}`
    if (next.includes(token)) {
      const raw = readFileSync(join(referencesDir, file), 'utf8')
      attachments.push(`## Inline skill attachment: references/${file}\n\n${raw.trim()}`)
      next = next.split(token).join(file)
      inlined.push(file)
    } else {
      skipped.push(file)
    }
  }
  if (attachments.length > 0) {
    const section = [
      '',
      '---',
      '',
      '## Inline skill attachments (references/)',
      '',
      'The upstream reference file(s) below are inlined so this skill works without filesystem access:',
      '',
      attachments.join('\n\n---\n\n'),
      '',
    ].join('\n')
    next = `${next.trim()}\n${section}`
  }
  return { body: next, inlined, skipped }
}

function emit() {
  if (!existsSync(SKILLS_DIR)) {
    console.warn('[sync-minimax-skills] submodule not present, skipping')
    return false
  }
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const assets = []
  for (const name of entries) {
    if (!ENABLED.has(name)) continue
    const dir = join(SKILLS_DIR, name)
    const cnPath = join(dir, 'SKILL.cn.md')
    const enPath = join(dir, 'SKILL.md')
    const mdPath = existsSync(cnPath) ? cnPath : (existsSync(enPath) ? enPath : null)
    if (mdPath === null) {
      console.warn(`[sync-minimax-skills] ${name}: no SKILL.cn.md / SKILL.md, skipped`)
      continue
    }
    const raw = readFileSync(mdPath, 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const description = String(meta.description ?? meta.name ?? name).slice(0, 500)
    const referencesDir = join(dir, 'references')
    const { body: inlinedBody, inlined, skipped } = inlineReferences(name, body, referencesDir)
    assets.push({ name: meta.name ?? name, description, content: inlinedBody })
    const notes = []
    if (inlined.length > 0) notes.push(`inlined references: ${inlined.join(', ')}`)
    if (skipped.length > 0) notes.push(`references NOT inlined (unreferenced): ${skipped.join(', ')}`)
    const suffix = notes.length > 0 ? ` [${notes.join(' | ')}]` : ''
    console.log(`[sync-minimax-skills] + ${name} (${inlinedBody.length} chars, from ${mdPath.endsWith('SKILL.cn.md') ? 'SKILL.cn.md' : 'SKILL.md'})${suffix}`)
  }
  if (assets.length === 0) {
    console.warn('[sync-minimax-skills] no enabled skills found')
    return false
  }
  const body = `/**
 * AUTO-GENERATED by scripts/sync-minimax-skills.mjs — do not edit by hand.
 * Source: minimax-h3 submodule (skills/<name>/SKILL.cn.md, fallback SKILL.md).
 * Content is verbatim upstream; adaptation lives in src/skills/minimax-skills.ts.
 * references/ assets explicitly read by a skill body are inlined into its
 * content (see "Inline skill attachments" section) so no filesystem access is
 * needed at runtime; unreferenced references/ files are NOT inlined.
 */
export interface MinimaxSkillAsset {
  name: string
  description: string
  content: string
}

export const MINIMAX_SKILL_ASSETS: MinimaxSkillAsset[] = ${JSON.stringify(assets, null, 2)}
`
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, body)
  console.log(`[sync-minimax-skills] wrote ${OUT_FILE} (${assets.length} skills)`)
  copyStyleDemos()
  return true
}

/** Copy upstream style demo GIFs (assets/<skill>.gif) into the plugin bundle. */
function copyStyleDemos() {
  const upstreamAssets = join(SUBMODULE, 'assets')
  if (!existsSync(upstreamAssets)) return
  mkdirSync(STYLE_DEMO_DIR, { recursive: true })
  let copied = 0
  for (const name of ENABLED) {
    const src = join(upstreamAssets, `${name}.gif`)
    if (!existsSync(src)) continue
    copyFileSync(src, join(STYLE_DEMO_DIR, `${name}.gif`))
    copied += 1
  }
  console.log(`[sync-minimax-skills] copied ${copied} style demo GIFs -> assets/style-demos/`)
}

emit()
