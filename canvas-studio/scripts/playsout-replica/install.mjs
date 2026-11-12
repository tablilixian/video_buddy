#!/usr/bin/env node
/**
 * playsout 复刻 · 装机器（install）。
 *
 * 做什么：
 *   ① 把 staging 里的素材（源素材 + 预生成 PNG + 字体）复制进**目标项目的 assets 目录**；
 *   ② 把 manifest 里的资产 URL 前缀从 staging slug 改写成**真机 projectId**：
 *      `/canvas-studio/assets/<slug>/` → `/canvas-studio/assets/<projectId>/`
 *      （产品资产路由只吃 `/<projectId>/<file>` 两段，且 `urlToAssetPath` 只取文件名、
 *      拼**当前项目**的 assetsDir ⇒ URL 里的 projectId 必须等于渲染所在项目）；
 *   ③ 产出「同源 URL 清单」（素材 → URL），供人工核对与复跑；
 *   ④ 用产品的 `validateManifest` 复验改写后的 manifest。
 *
 * 不做的事：不覆盖同名且内容不同的既有素材（避免毁掉用户项目里的文件）—— 冲突会列出来。
 *
 * 用法：
 *   node scripts/playsout-replica/install.mjs \
 *     --project "<项目目录>" --project-id <projectId> [--slug playsout] [--dry-run]
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(name)

const PROJECT_DIR = resolve(argOf('--project', ''))
const PROJECT_ID = argOf('--project-id', '')
const SLUG = argOf('--slug', 'playsout')
const DRY = has('--dry-run')

if (PROJECT_DIR === '' || PROJECT_ID === '') {
  console.error('用法：node install.mjs --project "<项目目录>" --project-id <projectId> [--slug playsout] [--dry-run]')
  process.exit(2)
}

const STAGE = join(REPO, 'build', 'assets', SLUG)
const SRC_MANIFEST = join(REPO, 'build', 'playsout', 'manifest.json')
const ASSETS_OUT = join(PROJECT_DIR, 'assets')
const BUILD_OUT = join(PROJECT_DIR, 'build')
const OLD_PREFIX = `/canvas-studio/assets/${SLUG}/`
const NEW_PREFIX = `/canvas-studio/assets/${PROJECT_ID}/`

const log = (m) => console.log(`[install] ${m}`)
const warn = (m) => console.log(`[install] ! ${m}`)

if (!existsSync(SRC_MANIFEST)) {
  console.error(`[install] 找不到 manifest：${SRC_MANIFEST}（先跑 build-manifest.mjs）`)
  process.exit(1)
}
if (!existsSync(STAGE)) {
  console.error(`[install] 找不到 staging 目录：${STAGE}（先跑 stage-assets.mjs）`)
  process.exit(1)
}

/* ───────────────── ① 铺素材 ───────────────── */

const assetsIndex = JSON.parse(readFileSync(join(STAGE, 'assets.json'), 'utf8'))
const files = assetsIndex.files ?? []

mkdirSync(ASSETS_OUT, { recursive: true })
mkdirSync(BUILD_OUT, { recursive: true })

let copied = 0
let skipped = 0
const conflicts = []
const urlList = []

for (const entry of files) {
  const from = join(STAGE, entry.name)
  const to = join(ASSETS_OUT, entry.name)
  const bytes = statSync(from).size
  const sha = createHash('sha256').update(readFileSync(from)).digest('hex').slice(0, 16)
  let state = 'copied'
  if (existsSync(to)) {
    const before = statSync(to).size
    if (before === bytes) {
      state = 'identical'
      skipped += 1
    } else {
      state = 'conflict'
      conflicts.push({ name: entry.name, have: before, want: bytes })
    }
  }
  if (state === 'copied' && !DRY) copyFileSync(from, to)
  if (state === 'copied') copied += 1
  urlList.push({
    name: entry.name,
    kind: entry.kind,
    bytes,
    sha256_16: sha,
    url: `${NEW_PREFIX}${entry.name}`,
    state,
  })
}

log(`素材：${files.length} 个（复制 ${copied} / 已存在同尺寸 ${skipped} / 冲突 ${conflicts.length}）→ ${ASSETS_OUT}`)
if (conflicts.length > 0) {
  warn(`同名但尺寸不同的既有文件（**未覆盖**）：${conflicts.map((c) => c.name).join('、')}`)
}

/* ───────────────── ② 改写 manifest 的 URL 前缀 ───────────────── */

const manifest = JSON.parse(readFileSync(SRC_MANIFEST, 'utf8'))

let rewritten = 0
const rewrite = (node) => {
  if (typeof node === 'string') {
    if (node.startsWith(OLD_PREFIX)) {
      rewritten += 1
      return NEW_PREFIX + node.slice(OLD_PREFIX.length)
    }
    return node
  }
  if (Array.isArray(node)) return node.map(rewrite)
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) node[key] = rewrite(node[key])
  }
  return node
}
rewrite(manifest)

// 校验：不得再有旧前缀（staging slug 泄漏 = 真机 404）
const leftover = JSON.stringify(manifest).includes(OLD_PREFIX)
if (leftover) {
  console.error('[install] 仍有旧前缀残留，终止')
  process.exit(1)
}

const MANIFEST_OUT = join(BUILD_OUT, 'playsout-manifest.json')
const URLS_OUT = join(BUILD_OUT, 'playsout-assets.json')
if (!DRY) {
  writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 1))
  writeFileSync(URLS_OUT, JSON.stringify({
    projectId: PROJECT_ID,
    projectDir: PROJECT_DIR,
    prefix: NEW_PREFIX,
    files: urlList,
  }, null, 1))
}
log(`manifest：URL 前缀改写 ${rewritten} 处 → ${MANIFEST_OUT}`)
log(`URL 清单：${urlList.length} 条 → ${URLS_OUT}`)

/* ───────────────── ③ 用产品校验器复验 ───────────────── */

const { validateManifest } = await import(join(REPO, 'lib/remotion/manifest.js'))
const v = validateManifest(manifest)
log(`校验：ok=${v.ok} errors=${v.errors.length} warnings=${v.warnings.length}`)
if (!v.ok) {
  for (const e of v.errors.slice(0, 10)) console.error(`  ✗ ${e}`)
  process.exit(1)
}

/* ───────────────── ④ 引用完整性（manifest 引用 vs 磁盘） ───────────────── */

const referenced = new Set()
const collect = (node) => {
  if (typeof node === 'string') {
    if (node.startsWith(NEW_PREFIX)) referenced.add(node.slice(NEW_PREFIX.length))
    return
  }
  if (Array.isArray(node)) { node.forEach(collect); return }
  if (node !== null && typeof node === 'object') Object.values(node).forEach(collect)
}
collect(manifest)
const missing = [...referenced].filter((name) => !existsSync(join(ASSETS_OUT, name)))
log(`引用完整性：manifest 引用 ${referenced.size} 个素材，磁盘缺失 ${missing.length} 个`)
if (missing.length > 0) {
  console.error(`  ✗ 缺失：${missing.join('、')}`)
  process.exit(1)
}

log(`完成。真机出片：render_composition({ manifestPath: "${MANIFEST_OUT}", quality: "draft" })`)
