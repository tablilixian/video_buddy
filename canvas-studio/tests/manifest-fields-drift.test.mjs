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
