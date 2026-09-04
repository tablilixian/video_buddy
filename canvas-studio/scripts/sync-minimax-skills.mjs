/**
 * Sync MiniMax-H3 upstream skills into canvas-studio as verbatim directory bundles.
 *
 * Copies each enabled skill directory from the pinned `minimax-h3` submodule into
 * `skills/<name>/` byte-for-byte, preserving the upstream h3 layout (SKILL.md,
 * SKILL.cn.md, references/, agents/, meta.yaml). No content generation or
 * inlining happens here.
 *
 * Registration lives in `src/skills/minimax-skills.ts`: it loads
 * `skills/<name>/SKILL.md` at runtime and registers it with a directory
 * `resourceBase`, so the model loads the lean SKILL.md entry on `skill(name)`
 * and reads `references/<file>` on demand through the harness `read` tool
 * (progressive disclosure; reads are not sandboxed, only writes are).
 * Directory membership under `skills/` decides what gets registered —
 * add or remove names in the ENABLED set below and rerun this script.
 *
 * Two sources are merged into `skills/`:
 * 1. Upstream submodule skill directories (ENABLED set below) — verbatim copy.
 * 2. `skills-local/<name>/` — hand-authored skill bundles owned by this repo
 *    (spec: docs/skill-expansion-spec.md). Merged after upstream: files present
 *    in `skills-local/<name>/` override the same-named upstream files
 *    (file-level overlay, e.g. a modified `SKILL.md` or
 *    `references/model-selection.md`), while upstream files without a local
 *    counterpart are kept verbatim. Same-name bundles without an upstream
 *    counterpart (e.g. canvas-studio-creation) are added as new skills.
 *
 * Usage: node scripts/sync-minimax-skills.mjs
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUBMODULE = join(ROOT, '..', 'minimax-h3') // repo-root submodule
const SKILLS_DIR = join(SUBMODULE, 'skills')
const SKILLS_OUT_DIR = join(ROOT, 'skills')
const LOCAL_SKILLS_DIR = join(ROOT, 'skills-local') // hand-authored bundles (merged after upstream)
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

function emit() {
  if (!existsSync(SKILLS_DIR)) {
    console.warn('[sync-minimax-skills] submodule not present, skipping')
    return false
  }
  // Wipe the previous sync so skills removed from ENABLED do not linger.
  rmSync(SKILLS_OUT_DIR, { recursive: true, force: true })
  mkdirSync(SKILLS_OUT_DIR, { recursive: true })
  let copied = 0
  for (const name of [...ENABLED].sort()) {
    const src = join(SKILLS_DIR, name)
    if (!existsSync(join(src, 'SKILL.md'))) {
      console.warn(`[sync-minimax-skills] ${name}: no SKILL.md, skipped`)
      continue
    }
    cpSync(src, join(SKILLS_OUT_DIR, name), { recursive: true })
    copied += 1
    console.log(`[sync-minimax-skills] + ${name} (verbatim directory copy)`)
  }
  if (copied === 0) {
    console.warn('[sync-minimax-skills] no enabled skills found')
    return false
  }
  copied += copyLocalSkills()
  console.log(`[sync-minimax-skills] copied ${copied} skill directories -> skills/`)
  copyStyleDemos()
  return true
}

/**
 * Merge hand-authored `skills-local/<name>/` bundles into `skills/` after the
 * upstream copy. File-level overlay: same-named files override the upstream
 * copy; upstream files without a local counterpart are kept. Entries without
 * a SKILL.md are skipped. Returns the number of merged directories.
 */
function copyLocalSkills() {
  if (!existsSync(LOCAL_SKILLS_DIR)) return 0
  let copied = 0
  for (const entry of readdirSync(LOCAL_SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!existsSync(join(LOCAL_SKILLS_DIR, entry.name, 'SKILL.md'))) {
      console.warn(`[sync-minimax-skills] skills-local/${entry.name}: no SKILL.md, skipped`)
      continue
    }
    if (existsSync(join(SKILLS_OUT_DIR, entry.name))) {
      console.warn(`[sync-minimax-skills] skills-local/${entry.name}: overrides upstream copy`)
    }
    cpSync(join(LOCAL_SKILLS_DIR, entry.name), join(SKILLS_OUT_DIR, entry.name), { recursive: true })
    copied += 1
    console.log(`[sync-minimax-skills] + ${entry.name} (local bundle)`)
  }
  if (copied > 0) console.log(`[sync-minimax-skills] merged ${copied} skills-local bundles -> skills/`)
  return copied
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
