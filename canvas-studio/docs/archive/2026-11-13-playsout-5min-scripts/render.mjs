import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdirSync } from 'node:fs'

const OUT = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/stills'
mkdirSync(OUT, { recursive: true })
const serveUrl = await bundle({
  entryPoint: new URL('./entry-test.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
console.log('composition', composition.width, composition.height, composition.durationInFrames)
for (const frame of [15, 120, 480, 1050, 1300, 1500, 2050, 2900, 3300, 4000, 4700, 5900, 6800, 7600, 8100, 8950]) {
  await renderStill({ composition, serveUrl, frame, output: `${OUT}/f${String(frame).padStart(5, '0')}.png`, browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', imageFormat: 'png', scale: 0.5 })
  console.log('✔', frame)
}
