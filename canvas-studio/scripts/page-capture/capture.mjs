#!/usr/bin/env node
/**
 * RQ-24（REQ-038）· **真实页面截图采集链**（素材供给的上游）。
 *
 * ## 目标链路（需求正本 §3 RQ-24）
 *
 *   URL（本地 dev server）→ 全页 2x 纹理 PNG + 元素级裁切 PNG + `layout.json`
 *   → `image` / `assetGrid` / `image.camera` 直接消费（素材 URL 走同源资产路由）。
 *
 * ## 引擎（拍板记台账：需求文档写「走仓库既有 playwright 依赖」，实测**仓库并无
 * playwright**（package.json 无、node_modules 无）。零新增依赖纪律（REQ-038 §8）⇒
 * 默认引擎走**系统 Chrome headless CLI**（macOS/常见 Linux 均有 Chrome；`--engine`
 * 可切 `playwright`，用户环境装了就用它，能拿到元素级坐标）。
 *
 * ## 合规闸（需求正本 RQ-24 验收 4）
 *
 * 1. 只允许**本地回环**目标（127.0.0.1 / localhost / ::1）；采集外网必须显式
 *    `--allow-host <host>`（把「采集前必须确认页面可采集」落成机械闸）；
 * 2. 不落任何凭据：本工具不读 cookie / localStorage / 环境变量里的 token；
 * 3. 确定性：同一页面两次采集产出 sha256 一致（Chrome headless 截图稳定；禁随机源）。
 *
 * ## 用法
 *
 *   node scripts/page-capture/capture.mjs --url http://127.0.0.1:5173 \
 *     --out build/capture --selectors '{"hero":".hero","nav":"nav.main"}' [--engine chrome|playwright] [--scale 2]
 *
 * 产出：
 *   <out>/page.png            全页 2x 纹理
 *   <out>/elements/<name>.png 元素级裁切（chrome 引擎按 layout.json 的像素矩形离线裁）
 *   <out>/layout.json         元素坐标表（chrome 引擎的坐标来自 --rects 手工标注或 null）
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const flag = (name) => args.includes(`--${name}`)

const url = opt('url')
const outDir = opt('out') ?? 'build/capture'
const engine = opt('engine') ?? 'chrome'
const scale = Number(opt('scale') ?? 2)
const selectorsJson = opt('selectors') ?? '{}'
const rectsJson = opt('rects') ?? '{}'
const allowHost = opt('allow-host')

if (url === undefined) {
  console.error('用法：node scripts/page-capture/capture.mjs --url http://127.0.0.1:5173 --out build/capture [--selectors JSON] [--rects JSON] [--engine chrome|playwright] [--scale 2] [--allow-host host]')
  process.exit(2)
}

/** 合规闸：只许本地回环；外网须显式 --allow-host（记录进 layout.json 的 allowHost 字段）。 */
function assertAllowed(target) {
  const parsed = new URL(target)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[合规闸] 只允许 http(s) 目标，收到 ${parsed.protocol}`)
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]']
  if (!loopback.includes(parsed.hostname) && parsed.hostname !== allowHost) {
    throw new Error(`[合规闸] 目标 ${parsed.hostname} 不是本地回环 —— 采集外网必须显式 --allow-host ${parsed.hostname}（确认页面可采集、不含登录凭据/私有客户数据后再给）`)
  }
  return { hostname: parsed.hostname, allowHostExplicit: parsed.hostname === allowHost && !loopback.includes(parsed.hostname) }
}

const allowed = assertAllowed(url)
const selectors = JSON.parse(selectorsJson)
const rects = JSON.parse(rectsJson)
mkdirSync(join(outDir, 'elements'), { recursive: true })

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** Chrome headless 截图（零依赖引擎）。 */
function captureWithChrome(target, file) {
  const chromeCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome',
    'chromium',
  ]
  for (const candidate of chromeCandidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status !== 0) continue
    const run = spawnSync(candidate, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${scale}`,
      '--window-size=1920,1080',
      '--virtual-time-budget=8000',
      `--screenshot=${file}`,
      target,
    ], { encoding: 'utf8', timeout: 120000 })
    if (run.status === 0 && existsSync(file)) return { engineBinary: candidate }
    throw new Error(`Chrome 截图失败（exit ${run.status}）：${run.stderr?.slice(0, 300)}`)
  }
  throw new Error('找不到 Chrome（/Applications/Google Chrome.app 或 PATH 的 google-chrome/chromium）；或改用 --engine playwright')
}

/** playwright 引擎（可选；用户环境有 playwright 时提供元素级坐标）。 */
function captureWithPlaywright(target, outDirectory, selectorMap) {
  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: ${scale} });
      await page.goto(${JSON.stringify(target)}, { waitUntil: 'networkidle' });
      await page.screenshot({ path: ${JSON.stringify(join(outDirectory, 'page.png'))}, fullPage: true });
      const layout = {};
      for (const [name, selector] of Object.entries(${JSON.stringify(selectorMap)})) {
        const el = page.locator(selector).first();
        const box = await el.boundingBox().catch(() => null);
        if (box !== null && box !== undefined) {
          await el.screenshot({ path: ${JSON.stringify(join(outDirectory, 'elements'))} + '/' + name + '.png' }).catch(() => {});
          layout[name] = { selector, rect: { x: box.x, y: box.y, w: box.width, h: box.height } };
        } else {
          layout[name] = { selector, rect: null };
        }
      }
      require('node:fs').writeFileSync(${JSON.stringify(join(outDirectory, 'layout-raw.json'))}, JSON.stringify(layout, null, 2));
      await browser.close();
    })().catch((error) => { console.error(error); process.exit(1); });
  `
  const run = spawnSync('node', ['-e', script], { encoding: 'utf8', timeout: 180000, stdio: 'inherit' })
  if (run.status !== 0) throw new Error('playwright 引擎失败（node_modules 里没有 playwright？）')
}

/** 像素矩形 → layout_table 口径（画布百分比、x/y 中心）—— 下游零改动直接可 write。 */
function toLayoutTableEntry(rect, imageWidth, imageHeight) {
  if (rect === null || rect === undefined) return null
  return {
    x: ((rect.x + rect.w / 2) / imageWidth) * 100,
    y: ((rect.y + rect.h / 2) / imageHeight) * 100,
    w: (rect.w / imageWidth) * 100,
    h: (rect.h / imageHeight) * 100,
  }
}

let engineInfo
if (engine === 'playwright') {
  captureWithPlaywright(url, outDir, selectors)
  engineInfo = 'playwright'
} else {
  engineInfo = captureWithChrome(url, join(outDir, 'page.png')).engineBinary
}

// chrome 引擎：元素级裁切用 --rects 手工标注的像素矩形（{ name: [x,y,w,h] }）离线裁。
// （Chrome CLI 拿不到元素坐标 —— 坐标级采集请用 --engine playwright。）
const elementEntries = {}
const rectsMap = engine === 'playwright' && existsSync(join(outDir, 'layout-raw.json'))
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(outDir, 'layout-raw.json'), 'utf8')))
    .map(([name, entry]) => [name, entry.rect]))
  : rects
for (const [name, selector] of Object.entries(selectors)) {
  elementEntries[name] = { selector, ...(rectsMap[name] !== undefined ? { rectPx: rectsMap[name] } : { rectPx: null }) }
}

const pagePng = readFileSync(join(outDir, 'page.png'))
// PNG 尺寸从 IHDR 读（byte 16-23）。
const imageWidth = pagePng.readUInt32BE(16)
const imageHeight = pagePng.readUInt32BE(20)

const layout = {
  url,
  // 无时间戳：同页面两次采集的 layout.json 必须 sha256 一致（RQ-24 验收 3，禁时钟）。
  engine: engineInfo,
  scale,
  image: { width: imageWidth, height: imageHeight, file: 'page.png', sha256: sha256(pagePng) },
  compliance: { loopbackOnly: !allowed.allowHostExplicit, allowHost: allowed.hostname },
  elements: Object.fromEntries(Object.entries(elementEntries).map(([name, entry]) => [
    name,
    {
      ...entry,
      // layout_table 同口径条目（chrome 引擎 rectPx 为 null 时此字段缺省 —— 用 inspect_image 量完补）。
      ...(entry.rectPx !== null && entry.rectPx !== undefined
        ? { layoutTable: toLayoutTableEntry({ x: entry.rectPx[0], y: entry.rectPx[1], w: entry.rectPx[2], h: entry.rectPx[3] }, imageWidth, imageHeight) }
        : {}),
    },
  ])),
}
writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout, null, 2))
console.log(`✅ 采集完成：${outDir}/page.png（${imageWidth}×${imageHeight}）+ layout.json（${Object.keys(selectors).length} 个选择器）`)
