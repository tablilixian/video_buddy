import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
const entry = new URL('./entry-test.tsx', import.meta.url).pathname
const serveUrl = await bundle({
  entryPoint: entry,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
for (const f of [375, 700, 730]) {
  await renderStill({ composition, serveUrl, frame: f, output: `/tmp/off-${f}.png`, browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', scale: 0.5, imageFormat: 'png' })
  console.log('✔', f)
}
