/**
 * 卡生成器**契约 drift** 守卫（P2-16，2026-11-27 审查）。
 *
 * 抓的是什么：卡生成器写了契约外 / 无意义字段 → 渲染器静默忽略或吃掉 → 视觉错误
 * 靠真机目检才发现。同一个模式在 CV-473 验收里两连发 ——
 * - `dataCard` 传 `background:'transparent'`：`content-spec.ts` 明写「`subtitle` 才有
 *   意义」，dataCard 自带深蓝底不吃 background ⇒ 深橙字压深底近不可读（`e95a59f0ed` 修）；
 * - `draw: { from: 0, … }`：`from` 不在 DrawMotion 契约内，渲染器只 warn（同批修）。
 *
 * 与 `spec-capability-drift` 的反变异纪律对齐：**生成器输出的字段合法性必须有守卫**，
 * 不能只靠「渲染器宽容」。本文件对全部注册卡真跑 `generate()`（mock ctx，主路径），
 * 逐轨断言字段面在契约内 —— 契约外字段即红，逼你在生成器侧改掉。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registeredCardIds, getCard } from '../lib/remotion/recipe-cards-all.js'
import { EASINGS } from '../lib/remotion/timing.js'
import { mockCtx } from '../scripts/gen-card-catalog.mjs'

const EASING_KEYS = new Set(Object.keys(EASINGS))
const DRAW_KEYS = new Set(['to', 'startFrame', 'durationInFrames', 'easing'])
const ANIMATE_KEYS = new Set(['from', 'to', 'startFrame', 'durationInFrames', 'easing', 'spring'])
const EXIT_KEYS = new Set(['to', 'durationInFrames', 'easing', 'gapFrames'])

/** 深遍历（group children 同权 —— 契约外字段藏在子轨里一样是 bug）。 */
function walkTracks(tracks, visit, at = 'tracks') {
  if (!Array.isArray(tracks)) return
  for (const [index, track] of tracks.entries()) {
    if (track === null || typeof track !== 'object') continue
    visit(track, `${at}[${String(index)}]`)
    if (Array.isArray(track.children)) walkTracks(track.children, visit, `${at}[${String(index)}].children`)
  }
}

function assertKeysWithin(object, allowed, at, label) {
  for (const key of Object.keys(object)) {
    assert.ok(allowed.has(key),
      `${at}.${label} 含契约外字段 \`${key}\`（契约 ${[...allowed].join('/')}]）——`
      + '渲染器会静默忽略或吃掉它，视觉错误只在真机才暴露（P2-16）')
  }
}

/** 一组数据通道极值（D5）：把 dataCard / ORB1 / DAT7 的数据路径都驱动到。 */
const DATA_VARIANTS = [
  undefined,
  { periodSec: 1, radiusX: 30, radiusY: 14, bodies: 2, snf: 1.35, periodA: 1, periodB: 1, alignAt: 2 },
  { periodSec: 4, radiusX: 18, radiusY: 9, bodies: 1, snf: 1, periodA: 2, periodB: 3, alignAt: 4 },
]

test('全部注册卡的产物轨字段必须在契约内（draw / animate / exit / background）', () => {
  const ids = registeredCardIds()
  assert.ok(ids.length >= 50, `注册卡数异常（${String(ids.length)}）—— 注册表加载出问题了？`)
  const violations = []
  for (const id of ids) {
    const card = getCard(id)
    for (const [caseIndex, data] of DATA_VARIANTS.entries()) {
      const ctx = { ...mockCtx(card, '契约巡检：甲：乙', 'L'), ...(data === undefined ? {} : { data }) }
      let tracks
      try {
        tracks = card.generate(ctx)
      } catch (cause) {
        // 生成抛错不是本文件的判据（结构自检另有其主），但要可定位。
        violations.push(`${id}#case${String(caseIndex)} 生成抛错：${cause instanceof Error ? cause.message : String(cause)}`)
        continue
      }
      walkTracks(tracks, (track, at) => {
        const where = `${id}#case${String(caseIndex)} ${at}(${String(track.id)})`
        if (track.draw !== undefined && typeof track.draw === 'object' && track.draw !== null) {
          assertKeysWithin(track.draw, DRAW_KEYS, where, 'draw')
          if (track.draw.easing !== undefined) {
            assert.ok(EASING_KEYS.has(String(track.draw.easing)), `${where}.draw.easing=${String(track.draw.easing)} 不在缓动白名单`)
          }
        }
        if (track.animate !== undefined) {
          for (const [ai, seg] of (Array.isArray(track.animate) ? track.animate : [track.animate]).entries()) {
            if (seg === null || typeof seg !== 'object') continue
            assertKeysWithin(seg, ANIMATE_KEYS, `${where}.animate[${String(ai)}]`, 'seg')
            if (seg.easing !== undefined) {
              assert.ok(EASING_KEYS.has(String(seg.easing)), `${where}.animate[${String(ai)}].easing=${String(seg.easing)} 不在缓动白名单`)
            }
          }
        }
        if (track.exit !== undefined && typeof track.exit === 'object' && track.exit !== null) {
          assertKeysWithin(track.exit, EXIT_KEYS, where, 'exit')
        }
        // `background` 在 textCard 上只在**显式** `variant:'subtitle'` 下生效
        // （TextCard.tsx 分支是 strictEqual，缺省 variant 落 bullets 兜底、background
        // 静默忽略 —— 正是 CV-473 DAT7 读数卡近不可读的根因）。其它轨型（chipRow
        // 的 chip 底板等）的 background 是各自契约的合法字段，不在此限。
        if (track.background !== undefined && track.type === 'textCard') {
          assert.ok(track.variant === 'subtitle',
            `${where} 在 variant=${String(track.variant)} 上设 background —— textCard 只有显式 subtitle 吃这个字段，`
            + '其他/缺省 variant 是静默忽略（CV-473 DAT7 读数卡近不可读的根因）')
        }
      })
    }
  }
  assert.deepEqual(violations, [], '有卡在数据通道极值下生成抛错')
})

test('反向变异探针：契约外字段必须被本守卫抓到（守卫自己不能是摆设）', () => {
  // 直接对一个伪造的「坏轨」跑同一套断言 —— 若断言改成永真，这里会红。
  const bad = { id: 'probe', type: 'shape', draw: { from: 0, to: 1, durationInFrames: 30, easing: 'linear' } }
  let caught = false
  try {
    assertKeysWithin(bad.draw, DRAW_KEYS, 'probe', 'draw')
  } catch {
    caught = true
  }
  assert.equal(caught, true, 'draw.from 是契约外字段，断言必须能红')
})
