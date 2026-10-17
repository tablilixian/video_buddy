/**
 * 无头渲染取证脚本（Node + @remotion/renderer + 本机 Chrome）。
 *
 * 为什么需要它：桌面验证台 `verify.mjs` 走 Electron 渲染进程（CSR），**必须有 GUI**；
 * agent 会话没有 GUI，看不到成片。这条链路用 `@remotion/renderer` 直接驱动本机 Chrome
 * 渲染同一个产品组件 `StudioComposition`，让 agent 能自己出片、抽帧、看效果。
 *
 * 跑法：
 *   NODE_OPTIONS= node scripts/remotion-verify/render-headless.mjs
 *
 * 产物：`out/render-orbit-v2.mp4`（公转）+ `out/render-flow.mp4`（旋转+流动）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(HERE, 'headless-entry.tsx')
const OUT_DIR = join(HERE, 'out')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const { bundle } = await import('@remotion/bundler')
const { selectComposition, renderMedia } = await import('@remotion/renderer')
const { manifestOrbit } = await import('./orbit-demo.mjs')
const { manifestFlow } = await import('./flow-demo.mjs')

const TARGETS = [
  { name: 'orbit', manifest: manifestOrbit(), out: join(OUT_DIR, 'render-orbit-v2.mp4') },
  { name: 'flow', manifest: manifestFlow(), out: join(OUT_DIR, 'render-flow.mp4') },
]

const serveUrl = await bundle({
  entryPoint: ENTRY,
  outDir: join(OUT_DIR, 'bundle-headless'),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...(config.resolve ?? {}),
      extensionAlias: {
        ...((config.resolve && config.resolve.extensionAlias) || {}),
        '.js': ['.ts', '.tsx', '.js'],
      },
    },
  }),
})
console.log('[headless] bundled ->', serveUrl)

for (const target of TARGETS) {
  const inputProps = { manifest: target.manifest }
  const composition = await selectComposition({
    serveUrl,
    id: 'studio-composition',
    inputProps,
    browserExecutable: CHROME,
  })
  console.log(
    `[headless] ${target.name}:`,
    composition.width,
    'x',
    composition.height,
    '@',
    composition.fps,
    'fps,',
    composition.durationInFrames,
    'frames',
  )
  const started = Date.now()
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: target.out,
    inputProps,
    browserExecutable: CHROME,
    onProgress: ({ progress, renderedFrames }) => {
      if (renderedFrames % 30 === 0) {
        process.stdout.write(
          `\r[headless:${target.name}] ${Math.round(progress * 100)}% (${renderedFrames}/${composition.durationInFrames})`,
        )
      }
    },
  })
  console.log(`\n[headless:${target.name}] done in ${Math.round((Date.now() - started) / 1000)}s -> ${target.out}`)
}

