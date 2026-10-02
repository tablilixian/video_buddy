/**
 * REQ-003 Step 1（A 组）：图片参考位的槽位表 + 读写纯函数。
 *
 * 这两条是「参考图可增删换重排」的地基，且**必须唯一**：写坏一份 generationPrompt
 * 等于把重放参数弄丢（重试就会按错的参数出图）。所以这里锁的不是 UI，而是：
 *   1. 槽位表覆盖哪些工具、每个工具的键/上限/位次语义；
 *   2. 读路径对历史键（styleFilename）宽容、对坏数据返回空；
 *   3. 写路径的归一化（1 张写 filename、多张写 filenames、必填槽拒绝清空、超限拒绝、
 *      历史键一律删掉、其余重放键原样保留）。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REFERENCE_SLOTS,
  audioVideoRefCountOf,
  referenceModeLabel,
  referenceNamesOf,
  referenceSlotOf,
  withReferenceNames,
} from '../lib/node-params.js'

const params = (value) => JSON.stringify(value)

test('REQ-003 槽位表：覆盖六个带图片参考的工具，未知工具与无 toolName 一律 null', () => {
  for (const tool of ['image_generate', 'video_composite', 'video_generate', 'image_fix', 'character_generate', 'character_sheet']) {
    assert.notEqual(referenceSlotOf({ toolName: tool }), null, `${tool} 必须在槽位表里`)
    assert.ok(REFERENCE_SLOTS[tool], `${tool} 槽位缺失`)
  }
  // 分析类 / 音乐类节点不出参考编辑区（它们的 filename 不是图片参考位）。
  for (const tool of ['qc_shot', 'music_generation', 'extract_last_frame', 'submit_storyboard_for_approval']) {
    assert.equal(referenceSlotOf({ toolName: tool }), null, `${tool} 不该出参考编辑区`)
  }
  assert.equal(referenceSlotOf({}), null, '无 toolName 的节点不该出参考编辑区')
})

test('REQ-003 槽位表：键/上限/位次语义与 host-tools 的入参描述一致', () => {
  assert.deepEqual(REFERENCE_SLOTS.image_generate?.keys, ['filename', 'filenames'])
  assert.equal(REFERENCE_SLOTS.image_generate?.max, 4)
  assert.equal(REFERENCE_SLOTS.image_generate?.ordered, false)

  // video_composite：顺序即 <Picture N> 位次，1/2/>=3 三种模式，上限 9。
  assert.deepEqual(REFERENCE_SLOTS.video_composite?.keys, ['filenames'])
  assert.equal(REFERENCE_SLOTS.video_composite?.max, 9)
  assert.equal(REFERENCE_SLOTS.video_composite?.ordered, true)
  assert.equal(REFERENCE_SLOTS.video_composite?.required, true)

  // 必填单槽：只换不空。
  for (const tool of ['image_fix', 'character_generate', 'character_sheet']) {
    assert.equal(REFERENCE_SLOTS[tool]?.max, 1)
    assert.equal(REFERENCE_SLOTS[tool]?.required, true, `${tool} 必须标必填`)
  }
  // 可选单槽：video_generate 的首帧可以清空（清空 = 纯文生视频）。
  assert.equal(REFERENCE_SLOTS.video_generate?.required, false)
})

test('REQ-003 读路径：filename → 历史键 → filenames 保序去重；坏数据返回空', () => {
  assert.deepEqual(referenceNamesOf(params({ filename: 'a.png' })), ['a.png'])
  assert.deepEqual(referenceNamesOf(params({ filenames: ['a.png', 'b.png'] })), ['a.png', 'b.png'])
  // 历史键（CV-147 收敛工具后退役的生产者）必须仍被读到，否则老节点的参考图会凭空消失。
  assert.deepEqual(referenceNamesOf(params({ styleFilename: 's.png' })), ['s.png'])
  // 顺序：filename 在前，filenames 依次；重复只留一次。
  assert.deepEqual(
    referenceNamesOf(params({ filename: 'a.png', styleFilename: 's.png', filenames: ['a.png', 'b.png'] })),
    ['a.png', 's.png', 'b.png'],
  )
  for (const bad of [undefined, '', 'not json', '[]', 'null', '42']) {
    assert.deepEqual(referenceNamesOf(bad), [], `坏数据 ${String(bad)} 必须返回空`)
  }
})

test('REQ-003 写路径：1 张写 filename、多张写 filenames，另一个键与历史键都删掉', () => {
  const slot = REFERENCE_SLOTS.image_generate
  const before = params({ prompt: 'p', filename: 'old.png', filenames: ['old.png', 'x.png'], styleFilename: 'legacy.png' })

  const one = JSON.parse(withReferenceNames(before, slot, ['new.png']))
  assert.equal(one.filename, 'new.png')
  assert.equal('filenames' in one, false, '1 张时必须删掉 filenames（两个键二选一）')
  assert.equal('styleFilename' in one, false, '历史键必须删掉，否则刚删掉的那张会复活')
  assert.equal(one.prompt, 'p', '其余重放键必须原样保留')

  const many = JSON.parse(withReferenceNames(before, slot, ['a.png', 'b.png', 'c.png']))
  assert.deepEqual(many.filenames, ['a.png', 'b.png', 'c.png'], '多张保序')
  assert.equal('filename' in many, false, '多张时必须删掉 filename')
  assert.equal(many.prompt, 'p')
})

test('REQ-003 写路径：只有 filenames 键的槽（video_composite）1 张也写数组', () => {
  const slot = REFERENCE_SLOTS.video_composite
  const one = JSON.parse(withReferenceNames(params({ prompt: 'p' }), slot, ['only.png']))
  assert.deepEqual(one.filenames, ['only.png'], '不能写成字符串 —— 后端要的是数组')
  const two = JSON.parse(withReferenceNames(params({ prompt: 'p' }), slot, ['first.png', 'last.png']))
  assert.deepEqual(two.filenames, ['first.png', 'last.png'])
})

test('REQ-003 写路径：清空的两种命运（可选槽允许 / 必填槽拒绝）', () => {
  const optional = REFERENCE_SLOTS.image_generate
  const cleared = JSON.parse(withReferenceNames(params({ prompt: 'p', filename: 'a.png' }), optional, []))
  assert.equal('filename' in cleared, false)
  assert.equal(cleared.prompt, 'p')

  // 必填单槽删成空 ⇒ 拒绝写入（返回 null），UI 据此把「删除」禁用并说明原因。
  for (const tool of ['image_fix', 'character_generate', 'character_sheet', 'video_composite']) {
    assert.equal(withReferenceNames(params({ prompt: 'p', filename: 'a.png' }), REFERENCE_SLOTS[tool], []), null, `${tool} 不该允许清空`)
  }
})

test('REQ-003 写路径：超上限与不可解析一律拒绝（不静默截断）', () => {
  const slot = REFERENCE_SLOTS.image_generate
  assert.equal(withReferenceNames(params({ prompt: 'p' }), slot, ['1', '2', '3', '4', '5']), null, '超上限必须拒绝')
  // 边界：正好等于上限要放行。
  assert.notEqual(withReferenceNames(params({ prompt: 'p' }), slot, ['1', '2', '3', '4']), null)
  for (const bad of [undefined, '', 'not json', '[]']) {
    assert.equal(withReferenceNames(bad, slot, ['a.png']), null, `坏数据 ${String(bad)} 必须拒绝写入`)
  }
})

test('REQ-003 写路径：重复句柄去重保序（同一个节点不该占两个位次）', () => {
  const slot = REFERENCE_SLOTS.video_composite
  const out = JSON.parse(withReferenceNames(params({ prompt: 'p' }), slot, ['a.png', 'b.png', 'a.png']))
  assert.deepEqual(out.filenames, ['a.png', 'b.png'])
})

test('REQ-003 位次读数：只有位次有语义的槽才出模式名', () => {
  assert.equal(referenceModeLabel(false, 3), null, '顺序无语义的槽不该硬报模式')
  assert.equal(referenceModeLabel(true, 0), '0 张 · 首帧 I2VA')
  assert.equal(referenceModeLabel(true, 1), '1 张 · 首帧 I2VA')
  assert.equal(referenceModeLabel(true, 2), '2 张 · 首尾帧 FL2VA')
  assert.equal(referenceModeLabel(true, 3), '3 张 · 多参考 Ref2VA')
  assert.equal(referenceModeLabel(true, 9), '9 张 · 多参考 Ref2VA')
})

test('A-1 复核 hotfix ②：模式读数把 audioRefs/videoRefs 计入（带音/视频参考一律多参考 r2v）', () => {
  // capabilityOf 的路由规则：audioRefs/videoRefs 非空即 multi-reference，与图片
  // 张数无关——读数只按张数算就会「2 图 + 1 音显示 FL2VA 实际走 r2v」。
  assert.equal(referenceModeLabel(true, 2, 1), '2 图 + 1 段音/视频 · 多参考 Ref2VA')
  assert.equal(referenceModeLabel(true, 1, 2), '1 图 + 2 段音/视频 · 多参考 Ref2VA')
  assert.equal(referenceModeLabel(true, 0, 1), '0 图 + 1 段音/视频 · 多参考 Ref2VA')
  // 不传 avCount = 旧口径（纯图片张数），既有调用与断言不受影响。
  assert.equal(referenceModeLabel(true, 2), '2 张 · 首尾帧 FL2VA')
  assert.equal(referenceModeLabel(false, 2, 1), null, '位次无语义的槽照旧不报模式')
})

test('A-1 复核 hotfix ②：audioVideoRefCountOf 读 generationPrompt 的音/视频参考段数', () => {
  assert.equal(
    audioVideoRefCountOf(params({ prompt: 'p', filenames: ['a.png', 'b.png'], audioRefs: ['m.mp3'], videoRefs: ['v.mp4', 'w.mp4'] })),
    3,
    'audioRefs + videoRefs 合计段数',
  )
  assert.equal(audioVideoRefCountOf(params({ prompt: 'p', filenames: ['a.png'] })), 0, '纯图片参考 = 0')
  assert.equal(audioVideoRefCountOf(params({ prompt: 'p', audioRefs: [] })), 0, '空数组 = 0')
  assert.equal(audioVideoRefCountOf(undefined), 0, '无参数 = 0')
  assert.equal(audioVideoRefCountOf('不是 JSON'), 0, '坏数据 = 0（读路径对坏数据宽容）')
})

test('REQ-003 读写往返：写进去的形态能被读回来（同一份规则的闭环）', () => {
  const slot = REFERENCE_SLOTS.image_generate
  const raw = withReferenceNames(params({ prompt: 'p' }), slot, ['a.png', 'b.png'])
  assert.notEqual(raw, null)
  assert.deepEqual(referenceNamesOf(raw), ['a.png', 'b.png'])
  const raw2 = withReferenceNames(raw, slot, ['b.png'])
  assert.deepEqual(referenceNamesOf(raw2), ['b.png'])
})
