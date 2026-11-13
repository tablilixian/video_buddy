import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const serveUrl = await bundle({
  entryPoint: new URL('./chart-entry.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'chart-acceptance', browserExecutable: CHROME })
console.log('composition', composition.width, composition.height, composition.durationInFrames)
for (const f of process.argv.slice(2).map(Number)) {
  await renderStill({ composition, serveUrl, frame: f, output: `/tmp/chart-acc-${f}.png`, browserExecutable: CHROME, imageFormat: 'png', scale: 0.75 })
  console.log('✔', f)
}
