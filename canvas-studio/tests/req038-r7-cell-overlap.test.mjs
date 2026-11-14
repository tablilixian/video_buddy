/**
 * REQ-038 R7-R8（A1）· **同屏格位相交分级校验**单测。
 *
 * 四条纪律必须同时成立：
 * ① **分级** —— ≤5% 贴边放行（呼吸位 / 浮点），>5% 无声明即拒收并给两条出路；
 * ② **显式豁免** —— 任一单元写 `overlap: true` 即放行该对（静默遮挡是错，显式声明是设计）；
 * ③ **共享全屏必红** —— 两个 units 都不写 cell（共享 section.cell / 全屏）= 100% 相交，
 *    这是真机「框互相压」的高频写法，必须拦；
 * ④ **合法动效零波及** —— 卡内部动画在格位内部，单卡 section 无成对格位，不受影响；
 *    反向变异：摘掉相交校验，重叠 spec 必然过闸，本文件的多条 error 断言转红。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-cell-overlap.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateContentSpec, cellOverlapPercent, CELL_OVERLAP_TOLERANT_PERCENT } from '../lib/remotion/content-spec.js'

function specWithUnits(units, extraMeta = {}) {
  return {
    meta: { title: 'R8 格位', durationSec: 12, fps: 30, ...extraMeta },
    sections: [{ id: 's1', copy: '一屏', units }],
  }
}

test('共享全屏（两个 units 都不写 cell）= 100% 相交，拒收', () => {
  const check = validateContentSpec(specWithUnits([
    { card: 'A2', copy: '左' },
    { card: 'B1', copy: '右' },
  ]))
  assert.equal(check.ok, false)
  const hit = check.errors.find((error) => error.includes('相交'))
  assert.ok(hit !== undefined, '必须有相交 error：' + JSON.stringify(check.errors))
  assert.match(hit, /相交 100%/)
  assert.match(hit, /错开/)
  assert.match(hit, /"overlap": true/)
})

test('显式重叠格位：报百分比 + 两条出路', () => {
  const check = validateContentSpec(specWithUnits([
    { card: 'DAT2', copy: '1.2 亿', cell: { x: 30, y: 50, w: 60, h: 60 } },
    { card: 'A4', copy: '要点', cell: { x: 55, y: 50, w: 60, h: 60 } },
  ]))
  assert.equal(check.ok, false)
  const hit = check.errors.find((error) => error.includes('相交'))
  assert.ok(hit !== undefined)
  assert.match(hit, /相交 \d+%/)
  assert.match(hit, /错开/)
})

test('overlap: true 显式豁免该对，校验通过', () => {
  const check = validateContentSpec(specWithUnits([
    { card: 'DAT2', copy: '主', cell: { x: 30, y: 50, w: 60, h: 60 } },
    { card: 'A4', copy: '叠层标注', cell: { x: 55, y: 50, w: 60, h: 60 }, overlap: true },
  ]))
  assert.deepEqual(check.errors.filter((error) => error.includes('相交')), [], '声明豁免后不得再有相交 error')
})

test('≤5% 贴边放行，>5% 拒收（阈值钉死，D4 改值只改一处常量）', () => {
  assert.equal(CELL_OVERLAP_TOLERANT_PERCENT, 5, 'D4 标定初值；改值必须回填标定表 §11.6')
  // 角上擦一下的精确构造（A 的右上角 vs B 的左下角）：
  //   B.x=39.9 → 交宽 0.1；B.y=54.9 → 交高 5.1 → 交面积 0.51 / 100 ≈ 0.51% → 放行
  //   B.x=39   → 交宽 1；  B.y=54   → 交高 6   → 交面积 6   / 100 = 6%   → 拒收
  const a = { x: 30, y: 50, w: 10, h: 10 }
  const pctPass = cellOverlapPercent(a, { x: 39.9, y: 54.9, w: 10, h: 10 })
  const pctFail = cellOverlapPercent(a, { x: 39, y: 54, w: 10, h: 10 })
  assert.ok(pctPass > 0 && pctPass <= CELL_OVERLAP_TOLERANT_PERCENT, `贴边构造应落在 (0,5%]，实得 ${String(pctPass)}`)
  assert.ok(pctFail > CELL_OVERLAP_TOLERANT_PERCENT, `超阈构造应 >5%，实得 ${String(pctFail)}`)
  const pass = validateContentSpec(specWithUnits([
    { card: 'B1', copy: '甲', cell: a },
    { card: 'B1', copy: '乙', cell: { x: 39.9, y: 54.9, w: 10, h: 10 } },
  ]))
  assert.deepEqual(pass.errors.filter((error) => error.includes('相交')), [], '≤5% 贴边必须放行')
  const fail = validateContentSpec(specWithUnits([
    { card: 'B1', copy: '甲', cell: a },
    { card: 'B1', copy: '乙', cell: { x: 39, y: 54, w: 10, h: 10 } },
  ]))
  assert.equal(fail.ok, false, '6% 必须拒收')
})

test('相切（共享一条边）放行：相交率 0', () => {
  // 左格位右缘 = 30+5 = 35，右格位左缘 = 35 —— 交宽 0，放行
  const check = validateContentSpec(specWithUnits([
    { card: 'B1', copy: '甲', cell: { x: 30, y: 50, w: 10, h: 10 } },
    { card: 'B1', copy: '乙', cell: { x: 40, y: 50, w: 10, h: 10 } },
  ]))
  assert.deepEqual(check.errors.filter((error) => error.includes('相交')), [], '相切不得报相交')
})

test('overlap 非布尔即拒收', () => {
  const check = validateContentSpec(specWithUnits([
    { card: 'A2', copy: '甲' },
    { card: 'B1', copy: '乙', overlap: 'yes' },
  ]))
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('.overlap 必须是布尔值')))
})

test('单卡 section（无 units）与跨屏格位不受影响（合法动效零波及）', () => {
  const check = validateContentSpec({
    meta: { title: '正常', durationSec: 12, fps: 30 },
    sections: [
      { id: 's1', copy: '单卡', card: 'A2' },
      { id: 's2', copy: '另一屏同格位也没事', card: 'B1' },
    ],
  })
  assert.deepEqual(check.errors, [], JSON.stringify(check.errors))
})

test('反向变异：相交校验若被摘掉，共享全屏 spec 会静默过闸（本文件断言转红）', () => {
  const check = validateContentSpec(specWithUnits([
    { card: 'A2', copy: '左' },
    { card: 'B1', copy: '右' },
  ]))
  assert.equal(check.ok, false, '重叠 spec 必须拒收 —— 摘掉 R8 校验这条先红')
})
