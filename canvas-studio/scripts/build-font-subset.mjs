#!/usr/bin/env node
/**
 * REQ-034 · R1：随包中文字体子集构建脚本（**产物入库**，CI 不需要跑）。
 *
 * 做什么：把 Google Fonts 版 Noto Sans SC 的静态 TTF 按常用字表子集化为 woff2，
 * 产出 `assets/fonts/noto-sans-sc-<weight>.woff2`（各 ~0.95MB），随包分发，
 * 供 `src/remotion/fonts.ts` 在客户端 CSR 渲染前以**同源路由**注入 `@font-face`。
 *
 * 为什么是 Noto 而不是思源黑体：思源黑体（Source Han Sans）的 OFL 带**保留字体名
 * 'Source'**，子集属 OFL 定义的 Modified Version，严格合规必须重命名族名；而
 * `subset-font` 改不了 name 表（实测 `preserveNameIds: []` 仍保留 nameID 0/1/4/6）。
 * Noto Sans SC 的族名本身不含 'Source'（Google 的派生命名即合规改名）⇒ 无此债。
 *
 * 源字体怎么来：`@expo-google-fonts/noto-sans-sc@0.4.4` 是 npm 上少见的**全量静态 TTF**
 * 包（解包 91MB / 9 个字重，各 10.1MB）。为不让每个 workspace 安装都多下 91MB，这里
 * 只把**两个用到的 TTF** 按 pin 死的 URL 取到本地缓存，并逐个校验 sha256。
 * （fontsource 系是 unicode-range 切片包，没有全量文件，无法子集化。）
 *
 * 用法：
 *   node scripts/build-font-subset.mjs          # 构建（源字体已在缓存则不再下载）
 *   node scripts/build-font-subset.mjs --print  # 只打印体积与字表统计，不写文件
 *
 * 字表 = GB2312 全集（一级 3755 + 二级 3008）+ ASCII 可打印 + 常用中西标点/符号 = 6962 字，
 * 存放于 `scripts/font-subset-chars.txt`（单行、去重、无换行；生成规则见该文件同目录 README）。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')

/** 字表文件（构建输入，入库）。 */
const CHARS_FILE = join(HERE, 'font-subset-chars.txt')
/** 源字体缓存目录（不入库，见根 `.gitignore`）。 */
const CACHE_DIR = join(PKG_ROOT, '.cache', 'font-source')
/** 产物目录：静态资产，`package.json` 的 `files` 已含 `assets/**` ⇒ 随包。 */
const OUT_DIR = join(PKG_ROOT, 'assets', 'fonts')

/**
 * 随包字体族名（`src/remotion/fonts.ts` 的 `BUNDLED_FONT_FAMILY` 必须与此逐字一致，
 * 由 `tests/remotion-fonts.test.mjs` 守住）。
 */
const FAMILY = 'Noto Sans SC'

/** 字表下限：低于此值说明字表文件被截断/替换，直接报错（防「悄悄变小字库」）。 */
const MIN_CHARS = 6000
/** 体积闸：单文件 ≤2MB、合计 ≤3MB（devdoc §8.3 第 5 条「体积纪律」）。 */
const MAX_PER_FILE = 2 * 1024 * 1024
const MAX_TOTAL = 3 * 1024 * 1024

/**
 * 源字体清单（URL 与 sha256 双 pin）。
 * 升级字体版本时：改 URL + 用 `shasum -a 256 <file>` 重算 sha256，二者必须同批改。
 */
const SOURCES = [
  {
    weight: 400,
    file: 'NotoSansSC_400Regular.ttf',
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.4/400Regular/NotoSansSC_400Regular.ttf',
    sha256: 'd45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16',
    bytes: 10559284,
  },
  {
    weight: 700,
    file: 'NotoSansSC_700Bold.ttf',
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.4/700Bold/NotoSansSC_700Bold.ttf',
    sha256: '9a38ae0ab28cd5a256f9ea8e00dedc688aac17f7915fcb000572990afa956b96',
    bytes: 10549020,
  },
]

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`

function fail(message) {
  console.error(`build-font-subset ❌ ${message}`)
  process.exit(1)
}

/** 读字表：单行、去重、无换行；数量不足即报错。 */
async function readCharSet() {
  if (!existsSync(CHARS_FILE)) fail(`字表文件缺失：${relative(PKG_ROOT, CHARS_FILE)}`)
  const raw = await readFile(CHARS_FILE, 'utf8')
  if (/[\r\n]/.test(raw)) fail('字表文件含换行 —— 字表必须是单行（换行符本身会被当成子集字符）')
  const chars = [...raw]
  if (new Set(chars).size !== chars.length) fail('字表文件存在重复字符')
  if (chars.length < MIN_CHARS) fail(`字表只有 ${chars.length} 个字符，少于下限 ${MIN_CHARS}（文件被截断？）`)
  return raw
}

/** 取源字体：命中缓存直接用（仍校验 sha256），否则按 pin 的 URL 下载后落缓存。 */
async function ensureSource(entry) {
  const cached = join(CACHE_DIR, entry.file)
  if (existsSync(cached)) {
    const buffer = await readFile(cached)
    if (buffer.length === entry.bytes && sha256(buffer) === entry.sha256) return { buffer, from: 'cache' }
    console.warn(`build-font-subset ⚠️ 缓存校验失败，重新下载：${entry.file}`)
  }
  await mkdir(CACHE_DIR, { recursive: true })
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) fail(`下载失败（HTTP ${response.status}）：${entry.url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length !== entry.bytes) {
    fail(`${entry.file} 字节数不符：期望 ${entry.bytes}，实得 ${buffer.length}（源被替换？）`)
  }
  const actual = sha256(buffer)
  if (actual !== entry.sha256) {
    fail(`${entry.file} sha256 不符：期望 ${entry.sha256}，实得 ${actual}（源被替换？）`)
  }
  await writeFile(cached, buffer)
  return { buffer, from: 'download' }
}

async function main() {
  const printOnly = process.argv.includes('--print')
  const text = await readCharSet()
  console.log(`build-font-subset · 字表 ${[...text].length} 字符 · 族名 ${FAMILY}`)

  const outputs = []
  for (const entry of SOURCES) {
    const { buffer, from } = await ensureSource(entry)
    const started = Date.now()
    const subset = await subsetFont(buffer, text, { targetFormat: 'woff2' })
    if (subset.subarray(0, 4).toString('ascii') !== 'wOF2') fail('产物不是合法 woff2（magic 不符）')
    if (subset.length > MAX_PER_FILE) {
      fail(`noto-sans-sc-${entry.weight}.woff2 体积 ${mb(subset.length)} 超过单文件闸 ${mb(MAX_PER_FILE)}`)
    }
    const target = join(OUT_DIR, `noto-sans-sc-${entry.weight}.woff2`)
    if (!printOnly) {
      await mkdir(OUT_DIR, { recursive: true })
      await writeFile(target, subset)
    }
    outputs.push({ weight: entry.weight, bytes: subset.length, target })
    console.log(
      `  ${entry.weight}`.padEnd(6)
      + ` ${mb(subset.length).padStart(7)}`
      + ` · 源 ${from === 'cache' ? '缓存' : '下载'}`
      + ` · ${Date.now() - started}ms`
      + ` · ${printOnly ? '(未写盘)' : relative(PKG_ROOT, target)}`,
    )
  }

  const total = outputs.reduce((sum, item) => sum + item.bytes, 0)
  if (total > MAX_TOTAL) fail(`合计体积 ${mb(total)} 超过总闸 ${mb(MAX_TOTAL)}`)
  console.log(`build-font-subset ✅ 合计 ${mb(total)}${printOnly ? '（--print 模式未写盘）' : ''}`)
}

await main()
