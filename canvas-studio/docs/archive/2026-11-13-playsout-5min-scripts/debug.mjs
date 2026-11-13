import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
const entry = new URL('./entry-test.tsx', import.meta.url).pathname
const serveUrl = await bundle({
  entryPoint: entry,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
await renderStill({ composition, serveUrl, frame: 1050, output: '/tmp/dbg.png', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', scale: 1, imageFormat: 'png' })
console.log('done')
