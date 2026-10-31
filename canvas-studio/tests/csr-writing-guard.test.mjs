/**
 * CSR 渲染写法护栏 —— web-renderer 的白名单会把"浏览器能画"的写法**静默吞掉**，
 * 本地不报错、成片里就是没有。三条硬约束全部来自能力基准的像素级实证
 * （`scripts/capability-bench/`，产物 `~/Desktop/job/VideoOut/remotion-capability-20261029/`）：
 *
 * 1. `<Audio>` / `<Video>` **必须**从 `@remotion/media` 导入 —— remotion 核心包的同名
 *    组件在 CSR 下直接抛 `<Html5Audio> is not supported`（基准 #06/#05 各踩一次）；
 * 2. `backgroundImage: url()` **不会等待加载** —— 必须同文件配 preload+delayRender 兜底
 *    （先例：`Root.tsx` 的颗粒层 `preloadBackgroundImage`，基准 #09 首跑 A 侧全黑）；
 * 3. `mask-image` 只认 `linear-gradient` / `url()`，`mix-blend-mode` / `perspective()` /
 *    `backdrop-filter` 在 4.0.535 整字段无效 —— 这三条靠 review + 能力基准回归守，
 *    机检不了（值是动态算出来的），别往 `timing.ts` / 组件里新写。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 源码根：src/remotion/**（组件与求值层都归 CSR 渲染写法管）。 */
const SRC_ROOT = new URL('../src/remotion/', import.meta.url).pathname

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield full
    }
  }
}

/** 粗剥离注释 —— 护栏只看代码，不看文档字符串里的示例（否则注释里的反面教材会误报）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

test('CSR 护栏：<Audio>/<Video> 必须从 @remotion/media 导入（remotion 核心版在 CSR 直接抛错）', () => {
  const offenders = []
  for (const file of walk(SRC_ROOT)) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const re = /import\s*\{[^}]*\b(?:Audio|Video)\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/g
    for (const m of code.matchAll(re)) {
      if (m[1] === '@remotion/media') continue
      offenders.push(`${file.replace(SRC_ROOT, 'src/remotion/')} → '${m[1]}'（须改为 '@remotion/media'）`)
    }
  }
  assert.deepEqual(offenders, [], [
    'remotion 核心包的 <Audio>/<Video>（Html5Audio/Html5Video）在 @remotion/web-renderer 下',
    '渲染会直接抛错（能力基准 #06/#05 各踩一次）。一律 import { Audio, Video } from \'@remotion/media\'。',
  ].join('\n'))
})

test('CSR 护栏：backgroundImage url() 必须同文件配 preload/delayRender 兜底（渲染器不等待背景图加载）', () => {
  const offenders = []
  for (const file of walk(SRC_ROOT)) {
    const code = stripComments(readFileSync(file, 'utf8'))
    if (!/backgroundImage\s*:\s*[`'"]?\s*url\(/.test(code)) continue
    if (/preloadBackgroundImage|delayRender/.test(code)) continue
    offenders.push(file.replace(SRC_ROOT, 'src/remotion/'))
  }
  assert.deepEqual(offenders, [], [
    'web-renderer 画 backgroundImage: url() 时不等待图片加载 —— 没配 preload 兜底就是',
    '"本地有图、成片没图"（能力基准 #09 首跑 A 侧全黑）。照 Root.tsx 颗粒层的先例：',
    'preloadBackgroundImage(url) + delayRender 挡首帧，或直接改用白名单内的 <Img>。',
  ].join('\n'))
})
