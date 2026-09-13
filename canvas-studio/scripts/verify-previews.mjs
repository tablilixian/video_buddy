/**
 * 预览验收台的一键无头验证 —— 把 `preview-*.mjs` 的产物丢进真实浏览器跑一遍，
 * 读页内自检的判决并汇总成一张表。
 *
 * ## 它守的是什么
 *
 * `preview-*.mjs` 生成时只做**静态**检查（令牌在 CSS 文本里齐不齐）。静态检查
 * 抓不到「令牌齐了但一条都不生效」—— 选择器锚点写错时全部声明仍在文件里，页面
 * 靠 `styles.ts` 的 `var(--cs-teal, #35C2A6)` 之类兜底值看着差不多对。2026-09-12
 * 的基块锚点 bug 就是这样：静态全绿，暗色下金/青/字阶/间距/阴影/缓动整批消失。
 * 这个脚本把 `getComputedStyle` 的实测结果变成退出码。
 *
 * ## 为什么不属于 `yarn check`
 *
 * 它依赖本机固定路径的 Chrome。AGENTS.md 要求构建 / typecheck / 单测 / Loader
 * smoke 必须 headless-safe —— 把「必须有 Chrome」塞进闸门会破坏这条。所以它是一个
 * **独立可选**脚本：找不到 Chrome 就打印跳过说明并以 0 退出，不阻塞任何人。
 *
 * ## Chrome 定位
 *
 * 优先环境变量 `CHROME_PATH`，否则按常见路径探测。没有视觉回归基线时，
 * 这个脚本判的是「语义是否发生」，不是「像素是否一致」。
 *
 * 用法：
 *   node scripts/verify-previews.mjs            # 先重新生成四个预览，再验证
 *   node scripts/verify-previews.mjs --no-gen   # 用现有产物验证（快）
 */

import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { brandPresetIds } from './preview-tokens.mjs'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, '.workbuddy', 'preview')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

/** 页内自检吐出的判决都落在这两个地方（见 preview-visual.mjs / tokenProbe()）。 */
const VERDICT_RE = /<pre id="pvVerdict">([\s\S]*?)<\/pre>/
const FAIL_RE = /data-pv-fail="(\d+)"/

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate)
      return candidate
    } catch { /* 试下一个 */ }
  }
  return null
}

/** 打开一个本地 HTML，把页内自检的判决读回来。 */
async function runVerdict(chrome, file, query) {
  const url = pathToFileURL(join(outDir, file)).href + query
  let dom
  try {
    const { stdout } = await execFileAsync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      // 自检读 computedStyle 且要等字体/布局稳定，给足虚拟时间。
      '--virtual-time-budget=8000',
      '--dump-dom',
      url,
    ], { maxBuffer: 64 * 1024 * 1024 })
    dom = stdout
  } catch (err) {
    return { ok: false, line: `Chrome 调用失败：${err.message}` }
  }

  const verdict = dom.match(VERDICT_RE)
  const failCount = dom.match(FAIL_RE)
  if (!failCount) {
    // 连 data-pv-fail 都没有 = 页内脚本没跑到收尾。绝大多数是自检自己抛错，
    // 这属于「静默失败」，必须显式报出来而不是当成通过。
    return { ok: false, line: '自检未产生判决 —— 页内脚本没跑到收尾（多半是自检自身抛错）' }
  }
  const fails = Number(failCount[1])
  const text = verdict ? verdict[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') : ''
  const firstLine = text.split('\n')[0] || '(空判决)'
  const failedLines = text.split('\n').slice(1).filter(line => /^(FAIL|THROW)/.test(line))
  return { ok: fails === 0, line: firstLine, failedLines }
}

async function generate(name) {
  await execFileAsync(process.execPath, [join(here, name)], { cwd: root })
}

const noGen = process.argv.includes('--no-gen')

const chrome = await findChrome()
if (chrome === null) {
  console.log('未找到 Chrome —— 跳过浏览器实测（本脚本是可选项，不进 yarn check）。')
  console.log('如需运行，设置 CHROME_PATH=/path/to/Chrome 后重试。')
  process.exit(0)
}
console.log(`Chrome: ${chrome}`)
console.log(noGen ? '（--no-gen：用现有产物）' : '（重新生成四个预览）')
console.log()

// 变体矩阵：preview-visual 支持 ?theme= / ?preset=；另外三个只有主题按钮，
// 无头默认就是暗色，故各跑一次。
const presetIds = await brandPresetIds()
const TARGETS = [
  {
    gen: 'preview-visual.mjs',
    file: 'visual-direction-preview.html',
    label: '视觉升维验收台',
    variants: [
      ...presetIds.flatMap(id => [
        { query: `?theme=dark&preset=${id}`, label: `暗色 · ${id}` },
        { query: `?theme=light&preset=${id}`, label: `浅色 · ${id}` },
      ]),
      // 未知预设名必须变红（防「选择器匹配空集」再度伪装成通过）。
      { query: '?theme=dark&preset=__unknown__', label: '未知预设（应失败）', expectFail: true },
      // C10 负向对照：把头/脚还原成「浮在卡片上的绝对定位条」（C2 角标带的状态），
      // 「头/体/脚纵向不交叠」「卡片纵向只有三段」两条结构断言必须变红。跑了它才能
      // 说这两条断言真的有判别力，而不是恒真。
      { query: '?theme=dark&card=legacy', label: '镜头条旧写法（应失败）', expectFail: true },
    ],
  },
  { gen: 'preview-lobby.mjs', file: 'lobby-layout-preview.html', label: 'lobby 布局', variants: [{ query: '', label: '暗色' }] },
  { gen: 'preview-groups.mjs', file: 'groups-preview.html', label: '左侧栏分组', variants: [{ query: '', label: '暗色' }] },
  { gen: 'preview-user.mjs', file: 'user-card-preview.html', label: '用户卡', variants: [{ query: '', label: '暗色' }] },
]

if (!noGen) {
  for (const target of TARGETS) {
    try {
      await generate(target.gen)
    } catch (err) {
      console.error(`✗ ${target.gen} 生成失败：${err.message}`)
      process.exit(1)
    }
  }
}

let passed = 0
let failed = 0
for (const target of TARGETS) {
  console.log(`── ${target.label}  (${target.file})`)
  for (const variant of target.variants) {
    const result = await runVerdict(chrome, target.file, variant.query)
    // expectFail 的用例：红了才算对（用来证明断言真的会响）。
    const good = variant.expectFail ? !result.ok : result.ok
    if (good) passed++
    else failed++
    const mark = good ? '✅' : '❌'
    console.log(`   ${mark} ${variant.label.padEnd(26)} ${result.line}`)
    for (const line of result.failedLines ?? []) console.log(`        ${line}`)
  }
}

console.log()
console.log(`合计 ${passed + failed} 组：${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
