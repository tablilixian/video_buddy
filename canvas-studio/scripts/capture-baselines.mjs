/**
 * D1（DD-07 工程收尾）：三张视觉回归截图基线 —— 画布 / 时间轴 / 审批条。
 *
 * 对 preview-visual.mjs 产物按锚点截图，存 docs/baselines/（文件名含批次号），
 * 供人工对照（本仓库无图像 diff 依赖，基线对照是「肉眼 + git diff 图片」级别）。
 *
 * - 锚点：preview-visual.mjs 骨架里的 #pvBaselineCanvas / #pvBaselineTimeline /
 *   #pvBaselineApproval；Chrome --screenshot 配 fragment 导航滚动到位。
 * - ?screenshot=1：页内禁全部入场动画（headless virtual-time 不推进动画时钟，
 *   fill both 入场会冻在 scale(0.94) 首帧 —— 见 preview-visual.mjs 样式块）。
 * - 验证链不变：本脚本是**可选项**，不进 yarn check；找不到 Chrome 时 exit 0
 *   （headless-safe 闸门不受影响，与 verify-previews.mjs 同约定）。
 *
 * 用法：node scripts/capture-baselines.mjs [--preset cinema-violet] [--theme dark]
 *   [--batch C3] [--out docs/baselines]
 */
import { mkdir, access, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { brandPresetIds } from './preview-tokens.mjs'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const previewFile = join(root, '.workbuddy', 'preview', 'visual-direction-preview.html')

// --- 参数 ---------------------------------------------------------------
function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}
const preset = argOf('preset', 'cinema-violet')
const theme = argOf('theme', 'dark')
const batch = argOf('batch', 'C3')
const outDir = join(root, argOf('out', 'docs/baselines'))

if (!(await brandPresetIds()).includes(preset)) {
  console.error(`未知预设：${preset}（可选：${brandPresetIds.join(' / ')}）`)
  process.exit(1)
}
if (theme !== 'dark' && theme !== 'light') {
  console.error(`未知主题：${theme}（dark / light）`)
  process.exit(1)
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate)
      return candidate
    } catch { /* 试下一个 */ }
  }
  return null
}

const chrome = await findChrome()
if (chrome === null) {
  console.log('未找到 Chrome —— 跳过基线截图（本脚本是可选项，不进 yarn check）。')
  console.log('如需运行，设置 CHROME_PATH=/path/to/Chrome 后重试。')
  process.exit(0)
}

// 预览产物必须先重新生成 —— 基线必须对应「当前代码」的预览，不能用上批旧页。
await execFileAsync(process.execPath, [join(here, 'preview-visual.mjs')], { cwd: root })

// 视图口径：锚点 + 视口高度。审批条 / 时间轴较矮，画布区 830px 高 ——
// 视口统一 1440×900（与桌面默认窗口宽度对齐），fragment 滚动到锚点顶部。
const VIEWS = [
  { id: 'canvas', anchor: 'pvBaselineCanvas' },
  { id: 'timeline', anchor: 'pvBaselineTimeline' },
  { id: 'approval', anchor: 'pvBaselineApproval' },
]

await mkdir(outDir, { recursive: true })
const url = pathToFileURL(previewFile).href
let failed = 0
for (const view of VIEWS) {
  const out = join(outDir, `${view.id}-${preset}-${theme}-${batch}.png`)
  const target = `${url}?screenshot=1&view=${view.id}&preset=${encodeURIComponent(preset)}&theme=${theme}`
  try {
    // 不传 --user-data-dir：本机 Chrome 带该参数会整体挂起（与运行中的主实例
    // 冲突）。代价是默认 profile 有单例锁 —— 连续截图偶发截到未合成的纯底色
    // （极小文件），用「验大小 + 重试」兜底：纯色 1440×900 PNG < 10KB。
    let attempt = 0
    for (;;) {
      attempt += 1
      await execFileAsync(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=1440,900',
        '--virtual-time-budget=8000',
        `--screenshot=${out}`,
        target,
      ], { maxBuffer: 16 * 1024 * 1024 })
      const size = (await stat(out)).size
      if (size >= 10_000 || attempt >= 3) break
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    console.log(`✅ ${view.id} → ${out}`)
  } catch (cause) {
    failed += 1
    console.error(`❌ ${view.id} 截图失败：${cause.message}`)
  }
}

// 清单落盘：基线是「跨批次人工对照」的锚，必须可追溯是哪天 / 哪批 / 哪个预设。
const manifest = {
  batch,
  preset,
  theme,
  capturedAt: new Date().toISOString(),
  views: VIEWS.map((view) => `${view.id}-${preset}-${theme}-${batch}.png`),
  note: '人工对照基线（无自动 diff）。重截同批文件会覆盖；跨批次请换 --batch。',
}
await writeFile(join(outDir, `manifest-${preset}-${theme}-${batch}.json`), JSON.stringify(manifest, null, 2))
console.log(failed === 0
  ? `基线齐全（${VIEWS.length}/${VIEWS.length}），清单已写 manifest-${preset}-${theme}-${batch}.json`
  : `${failed} 张截图失败 —— 基线不齐全，请修复后重跑`)
process.exit(failed === 0 ? 0 : 1)
