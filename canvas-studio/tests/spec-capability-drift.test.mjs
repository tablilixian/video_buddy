/**
 * S-2 守卫：**表达力边界表必须与实测行为一致**。
 *
 * 抓的是什么：2026-11-16 第二轮真机会话 +46.7 分钟才发现「`carry` 只能画形状、
 * 放不了文字」，之后 7 分钟在原地打转找「合法的手搓出口」—— 而这条事实一条类型
 * 声明就能说清。表达力边界是**负面清单**，手写必然漏（写文档的人在描述「能做什么」
 * 时心情好，不会系统列「不能做什么」），所以结论全部由探测产出。
 *
 * 四条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出。
 * 2. 每条「能 / 不能」都带探测证据（防止有人手写一行结论混进来）。
 * 3. **反向变异**：注入一个「5 个单元也放行」的假校验，生成器必须抛 —— 证明结论
 *    真是探测出来的，不是硬编码的字面量。
 * 4. 独立复探：测试自己再验两条最容易变的事实（units 上限、carry 轨型），
 *    即使有人手动改了生成物也躲不过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderSpecCapability, OUTPUT } from '../scripts/gen-spec-capability.mjs'
import { validateContentSpec, planFromSpec } from '../lib/remotion/content-spec.js'

const text = () => readFileSync(OUTPUT, 'utf8')

test('表达力边界表与实测行为一致（改了校验 / carry 语义必须重跑 gen-spec-capability.mjs）', () => {
  assert.equal(
    text(),
    renderSpecCapability(),
    '生成物与实测行为不一致 —— 跑 `yarn build && node scripts/gen-spec-capability.mjs` 后一起提交。'
    + '（这条守卫的意义：边界表一旦说谎，模型就会重新去读源码验证，那 18 次读文件就白省了。）',
  )
})

test('每条「能 / 不能」都必须带探测证据（不准手写结论混进表里）', () => {
  const body = text()
  const rows = body.split('\n').filter((line) => line.startsWith('| ') && line.includes(' | '))
  const factRows = rows.filter((line) => line.includes('探测：'))
  assert.ok(factRows.length >= 8, `事实行只有 ${factRows.length} 条 —— 探测面变窄了，可能有一行被手写替代`)
  const suspicious = rows.filter((line) => !line.includes('探测：') && !line.startsWith('| 能力') && !line.startsWith('|---|---'))
  // 「做不到清单」那张表是判断行，允许无探测证据；事实表不允许
  const factSection = body.split('## 1. 能 / 不能（实测）')[1]?.split('## 2.')[0] ?? ''
  const factWithoutEvidence = factSection.split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| 能力') && !line.startsWith('|---'))
    .filter((line) => !line.includes('探测：'))
  assert.deepEqual(factWithoutEvidence, [], `事实表里有不带探测证据的行：\n${factWithoutEvidence.join('\n')}`)
  assert.ok(suspicious.length > 0, '扫描面异常（连判断表都没扫到）')
})

test('反向变异：假校验放行 5 个单元时，生成器必须抛（结论不是硬编码）', () => {
  const fakeDeps = {
    validateContentSpec: (spec) => {
      const real = validateContentSpec(spec)
      // 只放行「单元过多」这一条，其余照旧 —— 模拟「有人把上限调成 5 却没重生成文档」
      return { ...real, ok: true, errors: real.errors.filter((message) => !message.includes('个单元')) }
    },
    planFromSpec,
  }
  assert.throws(
    () => renderSpecCapability(fakeDeps),
    /探测失败/u,
    '上限被改成放行 5 个时生成器没有报错 —— 说明「最多 4 个」是硬编码的字面量，不是探测结论',
  )
})

test('独立复探：units 上限与 carry 轨型（即使有人手改了生成物也躲不过）', () => {
  const meta = { title: 'probe', width: 1080, height: 1920, fps: 30, durationSec: 6 }
  const band = (i) => ({ id: `u${i}`, card: 'A1', copy: `第${i}句`, cell: { x: 50, y: 12 + i * 24, w: 90, h: 22 } })
  const five = { meta, sections: [{ id: 's1', label: '甲', units: [0, 1, 2, 3, 4].map(band) }] }
  const errors = validateContentSpec(five).errors
  const unitError = errors.find((message) => message.includes('个单元'))
  assert.ok(unitError !== undefined, '5 个单元不再被拒收 —— 边界表该重写了')
  const limit = Number(unitError.match(/最多 (\d+) 个单元/u)?.[1])
  assert.ok(Number.isFinite(limit), `拒收文案里读不到上限数字：${unitError}`)
  assert.ok(text().includes(`**最多 ${limit} 个**`), `边界表写的上限与实测（${limit}）不一致`)

  const spec = {
    meta,
    sections: [
      { id: 's1', label: '甲', card: 'A1', copy: '一句话', cell: { x: 50, y: 50, w: 90, h: 40 } },
      { id: 's2', label: '乙', card: 'A1', copy: '另一句', cell: { x: 50, y: 50, w: 90, h: 40 } },
    ],
    carry: [{ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222', text: '常驻文案' }],
  }
  const out = planFromSpec(spec, 180).tracks.find((item) => item.id === 'band')
  assert.ok(out !== undefined, 'carry 没有出轨')
  const body = text()
  if (out.type === 'textCard') {
    assert.match(body, /`carry` 里写 `text` 会怎样 \| \*\*出文字轨\*\*/u, 'carry 已支持文字，但边界表还写着「被忽略」')
  } else {
    assert.match(body, /`carry` 里写 `text` 会怎样 \| \*\*被忽略\*\*/u, 'carry 仍不支持文字，但边界表不是这么写的')
  }
})

test('D5 独立复探：data 形状校验拒收坏值，且边界表有 data 事实行', () => {
  const meta = { title: 'probe', width: 1080, height: 1920, fps: 30, durationSec: 6 }
  const nan = { meta, sections: [{ id: 's1', label: '甲', card: 'A1', copy: '一句', data: { v: Number.NaN } }] }
  assert.ok(
    validateContentSpec(nan).errors.some((message) => message.includes('.data')),
    'NaN 的 data 没被拒收 —— 形状校验失效',
  )
  const emptyKey = { meta, sections: [{ id: 's1', label: '甲', card: 'A1', copy: '一句', data: { '': 1 } }] }
  assert.ok(
    validateContentSpec(emptyKey).errors.some((message) => message.includes('键不能为空')),
    '空键的 data 没被拒收',
  )
  const tooLong = { meta, sections: [{ id: 's1', label: '甲', card: 'A1', copy: '一句', data: { v: 'x'.repeat(201) } }] }
  assert.ok(
    validateContentSpec(tooLong).errors.some((message) => message.includes('短字符串')),
    '超长字符串的 data 没被拒收',
  )
  assert.match(text(), /`data`（D5 结构化数值）怎么进卡/u, '边界表缺 data 事实行（生成器没跑或被手改）')
})
