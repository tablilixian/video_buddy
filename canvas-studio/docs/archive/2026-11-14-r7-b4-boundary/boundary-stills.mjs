// B4 段间转场 · SSR 抽帧回读（D5 准验收）：39s 样例的 s1→s2 边界在 195 帧（叠化窗 [185,195]）。
// 渲 180/185/190/200 四帧，用 ffmpeg PSNR 对证：
//   - 185≈180（窗前纯 s1，控制组，PSNR 高）
//   - 190 是 50% 叠化帧 ⇒ 与 185 / 200 都明显不同（PSNR 低 ⇒ 渐变在发生，不是硬切）
// 用法：cd canvas-studio && NODE_OPTIONS= node docs/archive/2026-11-14-r7-b4-boundary/boundary-stills.mjs
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const OUT = new URL('.', import.meta.url).pathname
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(OUT, { recursive: true })

const serveUrl = await bundle({
  entryPoint: new URL('../2026-11-14-r7-b2-stills/entry-example.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: CHROME })
console.log('composition frames', composition.durationInFrames)

for (const frame of [180, 185, 190, 200]) {
  await renderStill({ composition, serveUrl, frame, output: `${OUT}b4-${frame}.png`, browserExecutable: CHROME, scale: 0.5, imageFormat: 'png' })
  console.log('✔', frame)
}

const psnr = (a, b) => {
  const res = spawnSync('ffmpeg', ['-v', 'info', '-i', `${OUT}b4-${a}.png`, '-i', `${OUT}b4-${b}.png`, '-filter_complex', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /average:(\d+\.\d+)/.exec(res.stderr)
  return m === null ? NaN : Number(m[1])
}
console.log('PSNR 185vs180（控制组，期望高）:', psnr(185, 180))
console.log('PSNR 190vs185（中点 vs 窗前，期望低）:', psnr(190, 185))
console.log('PSNR 190vs200（中点 vs 窗后，期望低）:', psnr(190, 200))
