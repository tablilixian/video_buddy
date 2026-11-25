/**
 * 分镜审阅闸门 · 推演驱动
 *
 * 一句话：**按新流程跑一遍** —— spec（带 claim）→ 产品编译链 → 真实 StudioComposition
 * → G1 每屏静帧 / G2 draft 成片。产物直接喂给审阅面板。
 *
 * 跑法：
 *   cd canvas-studio
 *   node scripts/storyboard-demo/run.mjs stills   # 只出每屏静帧（G1 用）
 *   node scripts/storyboard-demo/run.mjs draft    # 再出一版 draft 成片（G2 用）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const ENTRY = join(HERE, 'entry.tsx')
const OUT = join(HERE, 'out')
const MANIFEST = join(HERE, 'build', 'manifest.json')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MODE = process.argv[2] ?? 'stills'

const log = (...a) => console.log('[demo]', ...a)

function browserExecutable() {
  if (existsSync(CHROME)) return CHROME
  return null
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const segments = manifest.meta.segments ?? []
  log(`manifest 轨数 ${manifest.tracks.length} · 段数 ${segments.length} · ${manifest.meta.durationInFrames} 帧`)

  const { bundle } = await import('@remotion/bundler')
  const { selectComposition, renderStill, renderMedia } = await import('@remotion/renderer')

  const started = Date.now()
  // 产品源码内部一律写 `./x.js`（tsc 口径），webpack 需要 extensionAlias 才认 .ts/.tsx
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    onProgress: (p) => {
      if (p % 25 === 0) log(`bundle ${p}%`)
    },
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] },
      },
    }),
  })
  log(`bundle 完成 ${Date.now() - started}ms`)

  const composition = await selectComposition({
    serveUrl,
    id: 'moon',
    browserExecutable: browserExecutable(),
  })
  log(`composition ${composition.width}x${composition.height} ${composition.durationInFrames}f`)

  if (MODE === 'stills') {
    const rows = []
    for (const seg of segments) {
      // 取段首 +1.5s：避开入场动效的最低点，也避开转场黑场
      const frame = Math.min(seg.startFrame + 45, seg.startFrame + seg.frames - 1)
      const file = join(OUT, `${seg.id}.png`)
      await renderStill({
        composition,
        serveUrl,
        output: file,
        frame,
        browserExecutable: browserExecutable(),
      })
      rows.push({ id: seg.id, frame, file, startFrame: seg.startFrame, frames: seg.frames })
      log(`静帧 ${seg.id} @${frame} → ${file}`)
    }
    writeFileSync(join(OUT, 'stills.json'), JSON.stringify(rows, null, 2))
    log('完成')
    return
  }

  if (MODE === 'draft') {
    const file = join(OUT, 'draft.mp4')
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: file,
      browserExecutable: browserExecutable(),
      muted: true,
    })
    log(`draft 成片 → ${file}`)
  }
}

main().catch((error) => {
  console.error('[demo] 失败：', error?.stack ?? error)
  process.exit(1)
})
