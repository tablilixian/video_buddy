/**
 * §07 素材就绪门禁（2026-10-25）：pending 素材从「提示」升成「阻断项」。
 *
 * 病史：素材清单过去只在完成度里展示 —— 落地不读它、出片不读它。结果是素材只能
 * **边做边找**：会话 #5 里 4 次用户纠正全在这里（裁不下来 → 背景色不对 → 换生图工具 →
 * 直接甩一张图给 agent）。改成门禁后，「先备齐再动手」成为结构约束。
 *
 * 两条铁律在这个文件里钉死：
 *   1. pending ⇒ blocker（默认开），但**必须配一条出路** `status:"waived"` ——
 *      只拦不给路的门禁等于功能不可用（CV-367 的教训）；
 *   2. 开关关掉能退回旧行为（素材只提示不拦），便于回滚。
 *
 * 运行：node --test tests/storyboard-asset-gate.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryboard, emptyStoryboardSections, validateForSeed } from '../lib/contracts/storyboard.js'

function docWithAssets(assets) {
  return createStoryboard({
    projectId: 'p1',
    title: '素材门禁',
    meta: { genre: '科普', targetDuration: 10, aspect: '16:9' },
    sections: {
      ...emptyStoryboardSections(),
      '02_visual': { tokens: [{ k: '色彩', v: '冷调' }] },
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '开场',
          shots: [{ id: 'S1-Sh1', duration: 5, frames: 150, camera: '推进', visual: '走廊', audio: '—', backup: false }],
        }],
      },
      '07_assets': assets,
    },
  })
}

const pending = {
  name: '手表效果图',
  type: 'image',
  status: 'pending',
  ref: { kind: 'file', id: '' },
  neededBy: ['S1-Sh1'],
  source: 'user',
}

test('A·①：pending 素材 ⇒ 阻断落地（默认开）', () => {
  const { blockers } = validateForSeed(docWithAssets([pending]))
  assert.equal(blockers.length, 1, '一条 pending 就该拦一条')
  assert.match(blockers[0], /手表效果图/u, '必须点名是哪条素材（否则用户不知道去补哪个）')
  assert.match(blockers[0], /用户提供/u, 'source=user 要说清"要用户给"，而不是笼统"待上传"')
  assert.match(blockers[0], /waived/u, '**必须给出路**：明确放弃的写法')
})

test('A·②：waived 不算 pending —— 唯一合法的「不要了」写法', () => {
  const { blockers } = validateForSeed(docWithAssets([{ ...pending, status: 'waived' }]))
  assert.deepEqual(blockers, [], 'waived 是出路，不能还拦')
})

test('A·③：ready 不拦；开关关掉退回旧行为（只提示）', () => {
  assert.deepEqual(validateForSeed(docWithAssets([{ ...pending, status: 'ready' }])).blockers, [])
  const relaxed = validateForSeed(docWithAssets([pending]), { enforceAssetReadiness: false })
  assert.deepEqual(relaxed.blockers, [], '关闸后不许再拦')
  assert.ok(relaxed.warnings.some((w) => /待上传/u.test(w)), '关闸也要留提示（不能彻底静默）')
})

test('A·④：neededBy 指向不存在的 shot ⇒ warning（清单与分镜脱节要能看出来）', () => {
  const { warnings } = validateForSeed(docWithAssets([{ ...pending, status: 'ready', neededBy: ['S9-Sh9'] }]))
  assert.ok(warnings.some((w) => /S9-Sh9/u.test(w)), '幽灵引用必须报出来')
})

test('A·⑤：source 缺省按 generated 理解（老清单不写 source 也能读）', () => {
  const legacy = { name: 'b-roll', type: 'image', status: 'pending', ref: { kind: 'file', id: '' } }
  const { blockers } = validateForSeed(docWithAssets([legacy]))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /要生成/u, '缺 source 时按 generated（要生成）提示')
})

test('A·⑥：多条 pending ⇒ 逐条点名（不是只报个总数）', () => {
  const { blockers } = validateForSeed(docWithAssets([
    pending,
    { ...pending, name: '背景图', source: 'library' },
  ]))
  assert.equal(blockers.length, 2)
  assert.ok(blockers.some((b) => /背景图/u.test(b) && /资产库/u.test(b)), 'library 要说"从资产库取"')
})
