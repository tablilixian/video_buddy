/**
 * REQ-034 · R1：随包中文字体 —— 解析纯函数 + 产物结构守卫。
 *
 * 锁住四类事实（都不是「源码里有这行字」式的断言）：
 *   1. **产物真的在、体积在闸内**：`assets/fonts/*.woff2` 存在、magic = wOF2、单文件 ≤2MB / 合计 ≤3MB；
 *   2. **产物真的带着我们声明的族名**：解出 woff2 的表流（brotli）后在 `name` 表里找 UTF-16BE 的
 *      族名字符串 —— 带**两条反向对照**（不得含 `Source Han Sans` / `Noto Sans TC`），
 *      证明这不是「恒真」的断言；
 *   3. `resolveFonts` 四态：缺省命中随包 / 显式声明随包族（含引号包装）/ 声明未随包且无 src（回退 +
 *      warning）/ 声明带同源 src（直接用，零下载）；
 *   4. 字表文件本身没被截断（≥6000 字、单行、去重）。
 *
 * ⚠️ 本文件**不**校验组件是否真的用了 context 提供的族名 —— 那需要真渲染，属 Z-6 桌面验收；
 * 运行时还有一道自动检测：客户端渲染前置的 `document.fonts.load` 命中不到字体面时会往
 * 成片结果写 warning（`client/remotion-render.ts`），族名不一致会在工具结果里直接现形。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_FONT_FAMILY,
  BUNDLED_FONT_FILES,
  BUNDLED_FONT_WEIGHTS,
  REMOTION_FONT_ROUTE_PREFIX,
  fontFamilyStack,
  resolveFonts,
} from '../lib/remotion/fonts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const FONT_DIR = join(PKG_ROOT, 'assets', 'fonts')
const CHARS_FILE = join(PKG_ROOT, 'scripts', 'font-subset-chars.txt')
const BUILD_SCRIPT = join(PKG_ROOT, 'scripts', 'build-font-subset.mjs')

const MAX_PER_FILE = 2 * 1024 * 1024
const MAX_TOTAL = 3 * 1024 * 1024

/** 造一个最小合法 manifest（`tracks` 与本组断言无关，留空）。 */
function manifestWith(global) {
  return {
    id: 'font-probe',
    meta: { title: '字体探针', width: 1280, height: 720, fps: 30, durationInFrames: 30 },
    tracks: [],
    ...(global === undefined ? {} : { global }),
  }
}

/**
 * 解出 woff2 的表流（brotli 压缩块）用于查 `name` 表内容。
 *
 * 起点不用 header 的 `totalCompressedSize` 直接算：harfbuzz 写出的 woff2 该字段与实际布局
 * 差 2 字节（实测 400/700 两份都是），故在推导值附近开一个小窗扫描，取第一个能解出
 * (>64KB) 的流作为真流；扫不到即抛错（说明格式变了，守卫必须重新对口径而不是静默放过）。
 */
function woff2TableStream(file) {
  const buf = readFileSync(file)
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'wOF2', `${file} 不是 woff2`)
  assert.equal(buf.readUInt32BE(8), buf.length, `${file} header.length 与实际字节数不一致`)
  const compressedSize = buf.readUInt32BE(20)
  const derived = buf.length - compressedSize
  for (let start = derived - 6; start <= derived + 6; start += 1) {
    if (start < 48) continue
    try {
      const raw = brotliDecompressSync(buf.subarray(start, start + compressedSize))
      if (raw.length > 65536) return raw
    } catch {
      // 不是真流起点，继续扫
    }
  }
  throw new Error(`${file} 找不到可解压的表流（起点推导值 ${derived}）—— woff2 布局变了？`)
}

/** `name` 表里的字符串是 UTF-16BE；node 只给 utf16le，故 swap16 转过来。 */
const utf16be = (text) => Buffer.from(text, 'utf16le').swap16()

test('随包字体产物存在、是 woff2，且体积在闸内（单文件 ≤2MB / 合计 ≤3MB）', () => {
  let total = 0
  for (const weight of BUNDLED_FONT_WEIGHTS) {
    const file = join(FONT_DIR, BUNDLED_FONT_FILES[weight])
    assert.ok(existsSync(file), `缺产物：assets/fonts/${BUNDLED_FONT_FILES[weight]}`)
    const bytes = statSync(file).size
    assert.ok(bytes <= MAX_PER_FILE, `${BUNDLED_FONT_FILES[weight]} 体积 ${bytes}B 超单文件闸`)
    total += bytes
  }
  assert.ok(total <= MAX_TOTAL, `字体合计 ${total}B 超总闸 ${MAX_TOTAL}B`)
  assert.ok(existsSync(join(FONT_DIR, 'OFL.txt')), 'OFL 许可全文必须随包（assets/fonts/OFL.txt）')
})

test('产物真的带着声明的族名（行为断言 + 两条反向对照）', () => {
  for (const weight of BUNDLED_FONT_WEIGHTS) {
    const raw = woff2TableStream(join(FONT_DIR, BUNDLED_FONT_FILES[weight]))
    assert.ok(raw.includes(utf16be(BUNDLED_FONT_FAMILY)),
      `${BUNDLED_FONT_FILES[weight]} 的 name 表里没有族名「${BUNDLED_FONT_FAMILY}」`
      + ' —— @font-face 的 family 与字体实际族名不一致，渲染会静默回退系统字体')
    // 反向对照：这些名字**不该**出现（前者＝已被我们排除的思源黑体，后者＝同厂不同语种）
    assert.ok(!raw.includes(utf16be('Source Han Sans')), '产物不该带思源黑体族名（OFL 保留字体名风险）')
    assert.ok(!raw.includes(utf16be('Noto Sans TC')), '产物不该带 Noto Sans TC 族名（反向对照失效）')
  }
})

test('构建脚本的族名常量与运行时常量一致（防「一处改了另一处没改」）', () => {
  const source = readFileSync(BUILD_SCRIPT, 'utf8')
  const matched = source.match(/const FAMILY = '([^']+)'/u)
  assert.ok(matched !== null, 'build-font-subset.mjs 里找不到 FAMILY 常量')
  assert.equal(matched[1], BUNDLED_FONT_FAMILY,
    '构建脚本的 FAMILY 与 src/remotion/fonts.ts 的 BUNDLED_FONT_FAMILY 不一致')
})

test('字表文件没被截断：≥6000 字、单行、去重', () => {
  const raw = readFileSync(CHARS_FILE, 'utf8')
  assert.ok(!/[\r\n]/u.test(raw), '字表必须是单行（换行符会被当成子集字符）')
  const chars = [...raw]
  assert.ok(chars.length >= 6000, `字表只有 ${chars.length} 字，少于 6000（被截断？）`)
  assert.equal(new Set(chars).size, chars.length, '字表有重复字符')
})

test('resolveFonts：未声明 → 命中随包，注入 400/700 两个面、无告警', () => {
  const resolved = resolveFonts(manifestWith(undefined))
  assert.deepEqual(resolved.warnings, [])
  assert.equal(resolved.defaultFamily, BUNDLED_FONT_FAMILY)
  assert.deepEqual(
    resolved.entries.map((entry) => [entry.family, entry.weight, entry.url]),
    BUNDLED_FONT_WEIGHTS.map((weight) => [
      BUNDLED_FONT_FAMILY,
      weight,
      `${REMOTION_FONT_ROUTE_PREFIX}/${BUNDLED_FONT_FILES[weight]}`,
    ]),
  )
})

test('resolveFonts：显式声明随包族（含引号包装）同样命中随包', () => {
  for (const value of [BUNDLED_FONT_FAMILY, `"${BUNDLED_FONT_FAMILY}"`, `'${BUNDLED_FONT_FAMILY}'`]) {
    const resolved = resolveFonts(manifestWith({ fontFamily: value }))
    assert.equal(resolved.defaultFamily, BUNDLED_FONT_FAMILY, `${value} 应命中随包族`)
    assert.equal(resolved.entries.length, BUNDLED_FONT_WEIGHTS.length)
    assert.deepEqual(resolved.warnings, [])
  }
})

test('resolveFonts：声明未随包且无 src → warning + 回退随包（本版无下载链）', () => {
  const resolved = resolveFonts(manifestWith({
    fontFamily: '思源宋体',
    fonts: [{ family: '思源宋体', weight: 400 }],
  }))
  assert.equal(resolved.defaultFamily, BUNDLED_FONT_FAMILY, '未随包族必须回退随包，保证离线出片')
  assert.equal(resolved.warnings.length, 1, `应恰好一条告警，实得：${JSON.stringify(resolved.warnings)}`)
  assert.match(resolved.warnings[0], /思源宋体/u)
  assert.match(resolved.warnings[0], new RegExp(BUNDLED_FONT_FAMILY, 'u'))
  assert.equal(resolved.entries.length, BUNDLED_FONT_WEIGHTS.length, '回退后仍须注入随包两个面')
})

test('resolveFonts：声明带同源 src → 直接用该面，且不再注入随包面', () => {
  const resolved = resolveFonts(manifestWith({
    fontFamily: 'My Sans',
    fonts: [{ family: 'My Sans', weight: 500, src: '/canvas-studio/remotion/fonts/noto-sans-sc-400.woff2' }],
  }))
  assert.deepEqual(resolved.warnings, [])
  assert.equal(resolved.defaultFamily, 'My Sans')
  assert.deepEqual(resolved.entries, [{
    family: 'My Sans',
    weight: 500,
    url: '/canvas-studio/remotion/fonts/noto-sans-sc-400.woff2',
  }])
})

test('resolveFonts：声明的随包族面不重复注入（去重）', () => {
  const resolved = resolveFonts(manifestWith({
    fonts: [{ family: BUNDLED_FONT_FAMILY, weight: 400 }, { family: BUNDLED_FONT_FAMILY, weight: 700 }],
  }))
  assert.equal(resolved.entries.length, BUNDLED_FONT_WEIGHTS.length)
})

test('fontFamilyStack：随包族带 sans-serif 兜底；自定义族仍保留随包兜底', () => {
  assert.equal(fontFamilyStack(BUNDLED_FONT_FAMILY), `"${BUNDLED_FONT_FAMILY}", sans-serif`)
  const custom = fontFamilyStack('My Sans')
  assert.match(custom, /^"My Sans", "Noto Sans SC", sans-serif$/u)
})
