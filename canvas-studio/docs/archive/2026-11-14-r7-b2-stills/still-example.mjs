// B2 样例静帧 · SSR 渲 3 张（s1 标题 / s3 双单元数据屏 / s6 收尾）。
// 39s @ 30fps = 1170 帧，6 屏 × 195 帧；屏中点帧 = 97 / 487 / 1072。
// 用法：cd canvas-studio && NODE_OPTIONS= node docs/archive/2026-11-14-r7-b2-stills/still-example.mjs
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdirSync } from 'node:fs'

const OUT = new URL('.', import.meta.url).pathname
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(OUT, { recursive: true })

const serveUrl = await bundle({
  entryPoint: new URL('./entry-example.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: CHROME })
console.log('composition', composition.width, 'x', composition.height, 'frames', composition.durationInFrames)

const FRAMES = { s1: 97, s3: 487, s6: 1072 }
for (const [screen, frame] of Object.entries(FRAMES)) {
  const out = `${OUT}screen-plan-example-${screen}.png`
  await renderStill({ composition, serveUrl, frame, output: out, browserExecutable: CHROME, scale: 0.5, imageFormat: 'png' })
  console.log('✔', screen, frame, out)
}
