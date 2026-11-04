/**
 * 复刻提效批四守卫：**manifest 字段表必须与源码同步**。
 *
 * 抓的是什么：模型为了确认 manifest 字段名，上一轮会话读 `src/remotion/manifest.ts`
 * 18 次、烧掉 42.8 分钟。手写契约（39.6KB）拦不住它 —— 手写文档会漂，源码不会。
 * 所以改成机器生成 + 门禁：源码一变，生成物不跟着变就红。
 *
 * 三条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出（漂移即红）；
 * 2. 生成物真的覆盖了关键契约（防止脚本「生成成功但什么都没抽到」）；
 * 3. **反向变异**：给一份临时源文件加字段，输出必须跟着变 —— 证明确实是从源码抽的，
 *    不是把内容硬编码在脚本里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderManifestFields, OUTPUT } from '../scripts/gen-manifest-fields.mjs'

test('manifest 字段表与源码一致（改了 manifest.ts 必须重跑 gen-manifest-fields.mjs）', () => {
  const generated = renderManifestFields()
  const onDisk = readFileSync(OUTPUT, 'utf8')
  assert.equal(
    onDisk,
    generated,
    '生成物与 src/remotion/manifest.ts 不一致 —— 跑 node scripts/gen-manifest-fields.mjs 后一起提交。'
    + '（这条守卫的意义：文档一旦与源码脱钩，模型就会回去读源码，那 42.8 分钟就白省了。）',
  )
})

test('字段表覆盖关键契约：接口 / 字段 / 可选性 / 枚举取值都在', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  for (const anchor of ['## CompositionManifest', '## ManifestMeta', '## ManifestBox', '## Animate']) {
    assert.ok(text.includes(anchor), `缺接口小节：${anchor}`)
  }
  // 字段行必须是「`name`?: Type」这种可判读形态
  assert.match(text, /- `tracks`: CompositionTrack\[\]/u)
  assert.match(text, /- `backgroundColor`\?: string/u)
  // 枚举取值表（模型最常猜错的地方）
  assert.match(text, /取值：'draft' \| 'standard' \| 'high'/u)
  assert.ok(text.length > 5000, `生成物过小（${text.length} 字节），脚本可能没抽到东西`)
})

test('反向变异：临时源文件多一个字段，生成结果必须跟着出现', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mf-'))
  const fake = join(dir, 'fake.ts')
  writeFileSync(fake, [
    'export interface Demo {',
    '  /** 甲字段说明 */',
    '  alpha: string',
    '  beta?: number',
    '}',
    "export type DemoKind = 'x' | 'y'",
    '',
  ].join('\n'), 'utf8')
  try {
    const out = renderManifestFields(fake)
    assert.match(out, /## Demo/u)
    assert.match(out, /- `alpha`: string — 甲字段说明/u)
    assert.match(out, /- `beta`\?: number/u)
    assert.match(out, /取值：'x' \| 'y'/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── B-5 / P-02：实现读取的 track.X 必须已登记（「加字段漏登记」机制性免疫）──
// P-02 事故：gaugeMax / palette / sourceRect / hasAlpha 四个被实现真实读取的字段
// 不在 KNOWN_TRACK_KEYS 里 ⇒ 每次使用都被告警「它不会生效」——app 对 agent 谎报。
// 本扫描剥掉字符串与注释后收集 src/ 里全部 `track.<key>` 读取，
// 断言每个键都能在 KNOWN_BASE_TRACK_KEYS ∪ KNOWN_TRACK_KEYS 里找到登记。

import { readdirSync, statSync } from 'node:fs'

function walkSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'build') continue
    const p = join(dir, entry.name)
    if (statSync(p).isDirectory()) walkSources(p, out)
    else if (/\.(ts|tsx)$/u.test(entry.name)) out.push(p)
  }
  return out
}

/** 剥字符串与注释（track.m4a 这类路径串、文档里的 track.X 示例都不算实现读取）。 */
function stripStringsAndComments(src) {
  return src
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

test('P-02 漂移检查：实现里真实读取的 track.X 必须登记进 KNOWN_TRACK_KEYS', async () => {
  const { KNOWN_TRACK_KEYS, KNOWN_BASE_TRACK_KEYS } = await import('../lib/remotion/manifest.js')
  const union = new Set([
    ...KNOWN_BASE_TRACK_KEYS,
    ...Object.values(KNOWN_TRACK_KEYS).flatMap((set) => [...set]),
  ])
  const read = new Set()
  const re = /(?:^|[^.\w])track\.([a-zA-Z]\w*)/g
  for (const file of walkSources(join(import.meta.dirname, '..', 'src'))) {
    const src = stripStringsAndComments(await import('node:fs').then((m) => m.readFileSync(file, 'utf8')))
    let m
    while ((m = re.exec(src))) read.add(m[1])
  }
  assert.ok(read.size > 60, `扫描面过窄（${read.size} 键）——扫描器可能失效`)
  const missing = [...read].filter((k) => !union.has(k))
  assert.deepEqual(missing, [], `实现读取了未登记字段：${missing.join(', ')}——登记进 KNOWN_TRACK_KEYS 对应轨型（P-02），或确认是误匹配再收紧扫描`)
})
