// 5 分钟汇报片整片渲染（或按帧段渲染），供真机/视觉验收用。
// 用法：
//   node render-mp4.mjs                        # 整片 → build-5min/out/5min.mp4
//   node render-mp4.mjs 1500 2100 /tmp/s3.mp4  # 只渲某段（起点含、终点不含）
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DIR = '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min'

const from = process.argv[2] !== undefined ? Number(process.argv[2]) : null
const to = process.argv[3] !== undefined ? Number(process.argv[3]) : null
const out = process.argv[4] ?? path.join(DIR, 'out', '5min.mp4')
mkdirSync(path.dirname(out), { recursive: true })

const serveUrl = await bundle({
  entryPoint: new URL('./entry-test.tsx', import.meta.url).pathname,
  webpackOverride: (c) => ({
    ...c,
    resolve: {
      ...c.resolve,
      extensionAlias: { '.js': ['.tsx', '.ts', '.js'] },
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    },
  }),
})

const composition = await selectComposition({ serveUrl, id: 'studio-composition', browserExecutable: CHROME })
console.log('composition', composition.width, 'x', composition.height, 'frames', composition.durationInFrames)

const started = Date.now()
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: out,
  browserExecutable: CHROME,
  ...(from !== null && to !== null ? { frameRange: [from, to - 1] } : {}),
  onProgress: ({ renderedFrames, encodedFrames, progress }) => {
    if (renderedFrames % 150 === 0) {
      const sec = (Date.now() - started) / 1000
      console.log(`  ${renderedFrames} 帧 / ${encodedFrames} 编码 | ${(progress * 100).toFixed(1)}% | ${sec.toFixed(0)}s | ${(renderedFrames / sec).toFixed(2)} 帧/秒`)
    }
  },
})
console.log('✔ 输出', out, '耗时', ((Date.now() - started) / 1000).toFixed(0), 's')
