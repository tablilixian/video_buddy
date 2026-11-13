import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
const OUT = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/stills'
const serveUrl = await bundle({
  entryPoint: new URL('./entry-test.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }, extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] } }),
})
const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
for (const f of process.argv.slice(2).map(Number)) {
  await renderStill({ composition, serveUrl, frame: f, output: `${OUT}/f${String(f).padStart(5, '0')}.png`, browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', scale: 0.5, imageFormat: 'png' })
  console.log('✔', f)
}
