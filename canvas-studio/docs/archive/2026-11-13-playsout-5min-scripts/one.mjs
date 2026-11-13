import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
const entry = new URL('./entry-test.tsx', import.meta.url).pathname
const serveUrl = await bundle({
  entryPoint: entry,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
for (const f of process.argv.slice(2).map(Number)) {
  await renderStill({ composition, serveUrl, frame: f, output: `/tmp/one-${f}.png`, browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', scale: 1, imageFormat: 'png' })
  console.log('✔', f)
}
