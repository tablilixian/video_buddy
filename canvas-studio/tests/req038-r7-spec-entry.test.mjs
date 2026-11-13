/**
 * REQ-038 R7（RQ-27）· **起点 D 接线**（`scaffold_manifest({ specPath })`）。
 *
 * 这一层只验「可达性」该有的行为，不重复 RQ-25/26 的几何单测：
 * ① 正常 spec → 产出可过 `validateManifest` 的轨道，且回执里带屏表；
 * ② 坏 spec → **拒收且零副作用**（报错文案带逐条 error，不是「生成后才发现」）；
 * ③ 相对路径 / 不存在的文件 → 明确拒收（歧义读上一版 spec 是最贵的错）。
 *
 * 定向跑：node --test tests/req038-r7-spec-entry.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldFromSpec } from '../lib/host-tools-spec.js'
import { registeredCardIds } from '../lib/remotion/recipe-cards-all.js'

function writeSpec(body) {
  const dir = mkdtempSync(join(tmpdir(), 'r7-spec-'))
  const file = join(dir, 'spec.json')
  writeFileSync(file, JSON.stringify(body, null, 2), 'utf8')
  return file
}

function baseSpec(sections, extra = {}) {
  return { meta: { title: 'R7 可达性', durationSec: 30, fps: 30 }, sections, ...extra }
}

test('specPath：正常 spec 出片骨架，回执带屏表与密度自检', () => {
  const id = registeredCardIds()[0]
  const file = writeSpec(baseSpec([
    { id: 's1', copy: '开场', card: id, durationSec: 10 },
    { id: 's2', copy: '中段', card: id, durationSec: 10 },
    { id: 's3', copy: '收尾', card: id, durationSec: 10 },
  ], { carry: [{ id: 'panel', box: { x: 50, y: 56, w: 84, h: 46 }, color: '#1b2333' }] }))
  const result = scaffoldFromSpec({ specPath: file })
  assert.match(result.text, /屏表/)
  assert.match(result.text, /3 屏/)
  assert.match(result.text, /1 块常驻层/)
  assert.match(result.text, /密度自检/)
  // 回执里的 JSON 必须能被再次解析（模型经常从这里抄）
  const json = result.text.split('```json')[1].split('```')[0]
  const manifest = JSON.parse(json)
  assert.equal(manifest.meta.durationInFrames, 900)
  assert.equal(manifest.meta.generatedBy, 'spec:content-spec')
  assert.ok(manifest.tracks.some((track) => track.id === 'panel'), '常驻层必须进产物')
})

test('specPath：多单元 spec 一屏出多条轨（这是 recipe 做不到的）', () => {
  const id = registeredCardIds()[0]
  const file = writeSpec(baseSpec([{
    id: 's1',
    copy: '左右并置',
    durationSec: 10,
    units: [
      { card: id, copy: '左', cell: { x: 27, y: 50, w: 44, h: 56 } },
      { card: id, copy: '右', cell: { x: 73, y: 50, w: 44, h: 56 } },
    ],
  }]))
  const result = scaffoldFromSpec({ specPath: file })
  const json = result.text.split('```json')[1].split('```')[0]
  const manifest = JSON.parse(json)
  const prefixed = manifest.tracks.filter((track) => /^u\d-/.test(String(track.id)))
  assert.ok(prefixed.length >= 2, `一屏两单元应产出带前缀的多条轨，实际 ${String(prefixed.length)}`)
})

test('specPath：校验失败即拒收，文案列逐条 error', () => {
  const file = writeSpec(baseSpec([{ id: 's1', copy: '' }])) // copy 为空
  assert.throws(
    () => scaffoldFromSpec({ specPath: file }),
    (error) => /spec 校验失败/.test(String(error.message)) && /copy/.test(String(error.message)),
  )
})

test('specPath：相对路径拒收（歧义读上一版是最贵的错）', () => {
  assert.throws(
    () => scaffoldFromSpec({ specPath: 'build/spec.json' }),
    /必须是绝对路径/,
  )
})

test('specPath：文件不存在时给明确路径', () => {
  assert.throws(
    () => scaffoldFromSpec({ specPath: '/tmp/definitely-not-here-r7/spec.json' }),
    /不存在或不可读/,
  )
})

test('specPath：算不出时长时拒收（不瞎猜一个默认值）', () => {
  const id = registeredCardIds()[0]
  const file = writeSpec({ meta: { title: '无时长', fps: 30 }, sections: [{ id: 's1', copy: '一', card: id }] })
  assert.throws(() => scaffoldFromSpec({ specPath: file }), /算不出时长/)
})
