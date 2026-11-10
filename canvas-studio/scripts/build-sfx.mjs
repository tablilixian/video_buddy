/**
 * 生成音效素材（0A · CV-460）：`assets/sfx/*.wav` + `assets/sfx/manifest.json`。
 *
 * 为什么是构建期脚本、而不是运行期合成：
 * - 浏览器里没有这套 DSP，且实时合成无法保证确定性（Remotion 要求同输入同帧同像素）；
 * - 素材入库后可随插件升级、可被 LLM 通过 `type`/`label` 选型，不必每次重算。
 *
 * 为什么零依赖、手写 WAV：与 `scripts/build-grain-tile.mjs` 同因 —— 沙箱装不了
 * 库，而 WAV 头只有 44 字节，自己写比引依赖更可控。
 *
 * 用法：
 *   node scripts/build-sfx.mjs            # 增量（字节相同则不写，保持 mtime）
 *   node scripts/build-sfx.mjs --force    # 强制重写
 *   node scripts/build-sfx.mjs --check    # 只校验磁盘与配方是否一致，不写（CI 用）
 *
 * ⚠️ 改动任何配方或 DSP ⇒ **必须**同时把 `SFX_ASSET_VERSION` 加 1，
 * 否则 `--check` 判不出差异、`manifest.json` 也不会重写。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const outDir = join(packageRoot, 'assets', 'sfx')
const outManifest = join(outDir, 'manifest.json')

const force = process.argv.includes('--force')
const checkOnly = process.argv.includes('--check')

const lib = await import(pathToFileURL(join(packageRoot, 'lib', 'audio-sfx', 'index.js')).href)
const { SFX_VOICES, SFX_ASSET_VERSION, SFX_SAMPLE_RATE, SFX_URL_PREFIX } = lib
const { renderVoice, normalizePeak, paneSplit, peakOf, encodeWavStereo, readWavHeader } = lib

if (!Array.isArray(SFX_VOICES) || SFX_VOICES.length === 0) {
  console.error('build-sfx: lib/audio-sfx 没有导出 SFX_VOICES —— 先 npx tsc -p tsconfig.json')
  process.exit(1)
}

/** 归一化目标峰值：−1 dBFS。留 1dB 余量给下游 gain（manifest 的 gain 上限是 2）。 */
const TARGET_PEAK = 0.891

if (!checkOnly) mkdirSync(outDir, { recursive: true })

let written = 0
let skipped = 0
let drift = 0
const entries = []

for (const voice of SFX_VOICES) {
  const mono = renderVoice(voice)
  // 峰值归一：GT 的系数（.55/.12/.9）带着下游总线增益的前提，单拿出来偏小。
  // 归一到同一峰值后，事件之间的相对音量由 manifest 的 gain 决定（那才是模型的调音位）。
  const normalized = normalizePeak(mono, TARGET_PEAK)
  // MVP 只出中置版本（决策日志 D-09）。paneSplit 全量实现，将来要复刻 ±0.2 声像只改这里。
  const [left, right] = paneSplit(normalized, 0)
  const bytes = encodeWavStereo(left, SFX_SAMPLE_RATE, right)
  const header = readWavHeader(bytes)
  const file = `sfx/${voice.id}.wav`
  const target = join(outDir, `${voice.id}.wav`)

  const exists = existsSync(target)
  const same = exists && !force && Buffer.compare(readFileSync(target), Buffer.from(bytes)) === 0

  if (checkOnly) {
    if (!exists) {
      console.error(`build-sfx --check: 缺 ${file}`)
      drift += 1
    } else if (!same) {
      console.error(`build-sfx --check: ${file} 与配方不一致（配方改过但没重跑脚本，或忘了 +VERSION）`)
      drift += 1
    }
  } else if (same) {
    skipped += 1
  } else {
    writeFileSync(target, bytes)
    written += 1
  }

  entries.push({
    id: voice.id,
    label: voice.label,
    file,
    url: `${SFX_URL_PREFIX}/${voice.id}.wav`,
    bytes: bytes.byteLength,
    frames: header.frames,
    durationSec: Math.round((header.frames / header.sampleRate) * 1000) / 1000,
    sampleRate: header.sampleRate,
    peak: Math.round(peakOf(normalized) * 1000) / 1000,
    recipe: voice.id,
  })

  const dur = (header.frames / header.sampleRate).toFixed(3)
  console.log(
    `  ${voice.id.padEnd(8)} ${String(header.frames).padStart(6)} 帧  ${dur}s  `
    + `${(bytes.byteLength / 1024).toFixed(1)} KB  peak ${peakOf(normalized).toFixed(3)}`
    + (checkOnly ? (same ? '  ✓' : '  ✗') : (same ? '  (skip)' : '  (write)')),
  )
}

const manifest = {
  version: SFX_ASSET_VERSION,
  generatedBy: 'build-sfx',
  sampleRate: SFX_SAMPLE_RATE,
  normalizePeak: TARGET_PEAK,
  voices: entries,
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`

if (checkOnly) {
  const onDisk = existsSync(outManifest) ? readFileSync(outManifest, 'utf8') : null
  if (onDisk !== manifestText) {
    console.error('build-sfx --check: manifest.json 与配方不一致')
    drift += 1
  }
  if (drift > 0) {
    console.error(`build-sfx --check ❌ ${drift} 处漂移`)
    process.exit(1)
  }
  console.log(`build-sfx --check ✓ ${entries.length} 支素材与配方一致`)
} else {
  const onDisk = existsSync(outManifest) ? readFileSync(outManifest, 'utf8') : null
  if (onDisk !== manifestText) writeFileSync(outManifest, manifestText)
  console.log(
    `build-sfx ✓ ${entries.length} 支：写入 ${written} / 跳过 ${skipped}（字节未变）`
    + ` ⇒ assets/sfx/`,
  )
}
