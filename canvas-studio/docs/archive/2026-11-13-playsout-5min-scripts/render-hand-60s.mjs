// 手写版前 1800 帧（0–60s：S1 开场 + S2 总盘 KPI 网格）→ 与真机 act1 同内容段对比
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const serveUrl = await bundle({
  entryPoint: new URL('./entry-hand.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({
    ...c,
    resolve: {
      ...c.resolve,
      extensionAlias: { '.js': ['.tsx', '.ts', '.js'] },
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    },
  }),
})
const composition = await selectComposition({ serveUrl, id: 'hand-compare', browserExecutable: CHROME })
console.log('composition', composition.width, 'x', composition.height, 'frames', composition.durationInFrames)

const started = Date.now()
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: '/tmp/hand-1800.mp4',
  browserExecutable: CHROME,
  frameRange: [0, 1799],
  scale: 0.5,
  onProgress: ({ renderedFrames, progress }) => {
    if (renderedFrames % 300 === 0) {
      const sec = (Date.now() - started) / 1000
      console.log(`  ${renderedFrames}f | ${(progress * 100).toFixed(0)}% | ${sec.toFixed(0)}s`)
    }
  },
})
console.log('✔ /tmp/hand-1800.mp4', ((Date.now() - started) / 1000).toFixed(0), 's')
