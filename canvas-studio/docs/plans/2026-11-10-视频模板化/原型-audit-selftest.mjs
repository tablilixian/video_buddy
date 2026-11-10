// 容量审计器自测（不依赖真机、不写产品代码）
//
// 覆盖三件在真实模板里**从未被检验**的事：
//   ① `dataCard` / `bullets` / 无 box 的 `subtitle` —— b1b2 模板只用到 subtitle+title，
//      另外三条分支的公式此前一次也没跑过（我第一版就把 dataCard 错归到 bullets 规则）。
//   ② `dataCard` 的「容量恒定但字会变小」—— 容量审计看不见的风险。
//   ③ 反向变红：声明值超过几何上限时，reconcile 必须报违规。
//
// 跑法：node 原型-audit-selftest.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const {
  auditTrack,
  auditTemplate,
  canvasOf,
  displayLen,
  fitModelOf,
  measure,
  reconcile,
  scanSlots,
  loadTemplate,
} = await import('./原型-audit-text-fit.mjs')

let pass = 0
let fail = 0
const cases = []
function it(name, fn) {
  cases.push({ name, fn })
}

// ── 构造合成轨（只保留 audit 关心的字段） ──────────────────────
const text = (over) => ({ id: 't', type: 'textCard', text: '{{x}}', ...over })

// ─────────────────────────────────────────────────────────────
// ① dataCard：容量 = 940/40 = 23，与 scale 无关
// ─────────────────────────────────────────────────────────────
it('dataCard 容量恒为 23，与画布分辨率无关', () => {
  const box = undefined
  const long = { width: 1920, height: 1080 }
  const short = { width: 864, height: 480 } // 480p 档
  const a = auditTrack(text({ variant: 'dataCard', box }), long)
  const b = auditTrack(text({ variant: 'dataCard', box }), short)
  assert.equal(a.maxChars, 23, '1080p 无 box')
  assert.equal(b.maxChars, 23, '480p 无 box')
  // 两条路径的 scale 不同，但容量相同 —— 这正是「scale 约掉」的证据
  assert.ok(a.model.scale > b.model.scale, 'scale 应随画布变小')
})

it('dataCard 容量恒为 23，与 box 宽度无关', () => {
  const canvas = { width: 1920, height: 1080 }
  for (const w of [30, 55, 80]) {
    const r = auditTrack(text({ variant: 'dataCard', box: { x: 50, y: 50, w, h: 40 } }), canvas)
    assert.equal(r.maxChars, 23, `box.w=${w}`)
  }
})

it('dataCard 矮盒 → 缩到不可读，报 error（容量审计看不见这条）', () => {
  const canvas = { width: 1920, height: 1080 }
  // designHeight(1 行标题, 0 行数据) = 52*2 + 50 + 38 = 192；box.h=5% → 54px
  const r = auditTrack(text({ variant: 'dataCard', box: { x: 50, y: 50, w: 30, h: 5 } }), canvas)
  assert.equal(r.maxChars, 23, '容量仍是 23 —— 这就是危险所在')
  assert.ok(r.model.scale < 0.4, `scale 应 <0.4，实际 ${r.model.scale}`)
  const errs = r.warnings.filter((w) => w.level === 'error')
  assert.equal(errs.length, 1, '必须报 1 条 error')
  assert.ok(errs[0].text.includes('低于 16px'), errs[0].text)
})

it('dataCard 中等盒 → 只报 warn（不阻断）', () => {
  const canvas = { width: 1920, height: 1080 }
  const r = auditTrack(text({ variant: 'dataCard', box: { x: 50, y: 50, w: 30, h: 40 } }), canvas)
  assert.equal(r.maxChars, 23)
  assert.equal(r.warnings.filter((w) => w.level === 'error').length, 0)
  assert.equal(r.warnings.filter((w) => w.level === 'warn').length, 1)
})

// ─────────────────────────────────────────────────────────────
// ② bullets：必须扣每行 42px 圆点，且受写死的 width:900 约束
// ─────────────────────────────────────────────────────────────
it('bullets 容量 = 6 行 × floor(858/48) = 102（已扣圆点 42px）', () => {
  const canvas = { width: 1920, height: 1080 }
  const r = auditTrack(text({ variant: 'bullets' }), canvas)
  assert.equal(r.maxChars, 102)
  // 若不扣 42，会算成 6×18 = 108 —— 多出 6 字，填满必然溢出一行
  assert.notEqual(r.maxChars, 108, '未扣圆点内距的算法会得到 108')
})

it('bullets 窄 box 被裁（写死 width:900 的既有瑕疵）', () => {
  const canvas = { width: 1920, height: 1080 }
  const wide = auditTrack(text({ variant: 'bullets' }), canvas)
  const narrow = auditTrack(text({ variant: 'bullets', box: { x: 50, y: 50, w: 20, h: 40 } }), canvas)
  assert.ok(narrow.maxChars < wide.maxChars, `窄盒 ${narrow.maxChars} 应小于宽盒 ${wide.maxChars}`)
})

// ─────────────────────────────────────────────────────────────
// ③ subtitle / title 的铺满路径
// ─────────────────────────────────────────────────────────────
it('subtitle 无 box = 3 行 × floor(1587.2/44) = 108', () => {
  const canvas = { width: 1920, height: 1080 }
  const r = auditTrack(text({ variant: 'subtitle' }), canvas)
  assert.equal(r.maxChars, 108)
  assert.equal(r.model.maxLines, 3)
})

it('title 无 box = 2 行 × floor(1728/84) = 40', () => {
  const canvas = { width: 1920, height: 1080 }
  const r = auditTrack(text({ variant: 'title' }), canvas)
  assert.equal(r.maxChars, 40)
})

it('title + 窄 box 只容 7 字（折行预算 1728 与容器 640 不一致）', () => {
  const canvas = { width: 1920, height: 1080 }
  const r = auditTrack(text({ variant: 'title', box: { x: 50, y: 50, w: 33.33, h: 12 } }), canvas)
  assert.equal(r.maxChars, 7)
  // 这条同时暴露一个既有缺陷：title 的 maxWidth 用 canvasWidth*0.9，完全不看 box，
  // 而 box 在场的容器是 640px + overflow:hidden ⇒ 文字被裁（不缩号）。
  // 与 subtitle 2026-11-04 修的是同一类事故，title 尚未修。
  assert.ok(Math.abs(r.model.clipWidthPx - (33.33 / 100) * 1920) < 1e-6, `clipWidthPx=${r.model.clipWidthPx}`)
})

// ─────────────────────────────────────────────────────────────
// ④ 安全余量：刚好占满必须判不安全
// ─────────────────────────────────────────────────────────────
it('安全余量：「刚好占满」判为裁切（heading 5 字 = 420px ≈ 容器 420.1px）', () => {
  const canvas = { width: 1920, height: 1080 }
  const box = { x: 50, y: 50, w: 21.88, h: 11.11 }
  const t = text({ variant: 'title', box })
  const model = fitModelOf(t, canvas)
  assert.ok(model.clipWidthPx > 420 && model.clipWidthPx < 421, `clipWidthPx=${model.clipWidthPx}`)
  // 5 字 × 84px = 420px，几何上"放得下"，但零余量 ⇒ 必须判裁
  assert.equal(measure(t, '测'.repeat(5), canvas).clipped, true, '5 字零余量应判裁')
  assert.equal(measure(t, '测'.repeat(4), canvas).clipped, false, '4 字应通过')
  assert.equal(auditTrack(t, canvas).maxChars, 4, '容量必须收敛到 4')
})

it('一槽多轨时容量取 min', () => {
  const manifest = {
    meta: { width: 1920, height: 1080 },
    tracks: [
      { id: 'a', type: 'textCard', variant: 'title', text: '{{s}}' },
      { id: 'b', type: 'textCard', variant: 'subtitle', box: { x: 50, y: 50, w: 8.85, h: 3.89 }, text: '{{s}}' },
    ],
  }
  const audit = auditTemplate(manifest)
  const s = audit.get('s')
  assert.equal(s.trackIds.length, 2)
  assert.equal(s.maxChars, 7, '取两条轨中更小的那个')
})

// ─────────────────────────────────────────────────────────────
// ⑤ 反向变红：声明超过上限必须报违规
// ─────────────────────────────────────────────────────────────
it('reconcile：声明 > 上限 → 违规；声明 < 上限 → 合法收紧', () => {
  const audit = new Map([['s', { slotId: 's', maxChars: 10, maxLines: 2, trackIds: ['t'], perTrack: [], variant: 'title', warnings: [] }]])

  const bad = reconcile({ slots: [{ id: 's', maxChars: 99, maxLines: 5 }] }, audit)
  assert.equal(bad.violations.length, 2, '两个字端都应违规')
  assert.deepEqual(bad.violations.map((v) => v.field).sort(), ['maxChars', 'maxLines'])
  assert.equal(bad.slotsDoc.slots[0].maxChars, 10, '违规项应被夹到上限')

  const good = reconcile({ slots: [{ id: 's', maxChars: 6, maxLines: 1 }] }, audit)
  assert.equal(good.violations.length, 0, '收紧不是违规')
  assert.equal(good.loosened.length, 2)
  assert.equal(good.slotsDoc.slots[0].maxChars, 6, '作者值必须保留')
})

it('reconcile：未声明的上限 → 视为违规（补上）', () => {
  const audit = new Map([['s', { slotId: 's', maxChars: 10, maxLines: 2, trackIds: ['t'], perTrack: [], variant: 'title', warnings: [] }]])
  const r = reconcile({ slots: [{ id: 's' }] }, audit)
  assert.equal(r.violations.length, 2)
  assert.equal(r.slotsDoc.slots[0].maxChars, 10)
})

// ─────────────────────────────────────────────────────────────
// ⑥ displayLen：半角算半个
// ─────────────────────────────────────────────────────────────
it('displayLen：全角 1 / 半角 0.5，换行不计宽', () => {
  assert.equal(displayLen('01'), 1)
  assert.equal(displayLen('中文'), 2)
  assert.equal(displayLen('中A'), 1.5)
  assert.equal(displayLen('一行\n二行'), 4)
})

// ─────────────────────────────────────────────────────────────
// ⑦ 真实模板回归 + 确定性
// ─────────────────────────────────────────────────────────────
it('b1b2 真实模板：0 违规（与手写 slots.json 100% 兼容）', () => {
  const { manifest, slotsDoc } = loadTemplate(path.join(HERE, '原型-template-b1b2'))
  const audit = auditTemplate(manifest)
  const r = reconcile(slotsDoc, audit)
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations))
  assert.equal(r.undeclaredInSlots.length, 0)
  assert.equal(r.undeclaredInSkeleton.length, 0)
  // 合法收紧应是 2 处（keyword.maxLines、heading.maxLines）——
  // maxChars 上 10/10 与作者值一致；只剩 maxLines 是作者主动收紧（主标题不该折行）。
  // 注意 `heading` 的 4 不是巧合：box.w=21.88% → 420.096px，5 个 84px 全角字正好 420px，
  // 零余量会被比例字体的实际字形宽度裁掉，所以安全余量（4px）把它正确地降到 4。
  assert.equal(r.loosened.length, 2, JSON.stringify(r.loosened))
  assert.ok(r.loosened.every((x) => x.field === 'maxLines'), '收紧应只剩 maxLines 语义项')
})

it('确定性：同输入审计两次结果逐字节相同', () => {
  const { manifest } = loadTemplate(path.join(HERE, '原型-template-b1b2'))
  const snap = (m) =>
    JSON.stringify(
      [...auditTemplate(m)].map(([k, v]) => [k, v.maxChars, v.maxLines, v.variant]),
    )
  assert.equal(snap(manifest), snap(JSON.parse(JSON.stringify(manifest))))
})

it('骨架槽位扫描：b1b2 是 10 槽 / 11 轨，badge 一槽两轨', () => {
  const { manifest } = loadTemplate(path.join(HERE, '原型-template-b1b2'))
  const used = scanSlots(manifest)
  assert.equal(used.size, 10)
  assert.equal([...used.values()].flat().length, 11)
  assert.deepEqual(used.get('badge'), ['b1-badge', 'b2-badge'])
})

it('canvasOf 缺省 1920×1080', () => {
  assert.deepEqual(canvasOf({}), { width: 1920, height: 1080 })
  assert.deepEqual(canvasOf({ meta: { width: 864, height: 480 } }), { width: 864, height: 480 })
})

it('fitModelOf：dataCard 是 fixed，其余是 flow', () => {
  const c = { width: 1920, height: 1080 }
  assert.equal(fitModelOf(text({ variant: 'dataCard' }), c).kind, 'fixed')
  for (const v of ['subtitle', 'title', 'bullets', undefined]) {
    assert.equal(fitModelOf(text({ variant: v }), c).kind, 'flow', String(v))
  }
})

// ─────────────────────────────────────────────────────────────
// 跑
// ─────────────────────────────────────────────────────────────
console.log('='.repeat(78))
console.log('容量审计器自测')
console.log('='.repeat(78))
for (const c of cases) {
  try {
    await c.fn()
    pass += 1
    console.log(`  ✓ ${c.name}`)
  } catch (e) {
    fail += 1
    console.log(`  ✗ ${c.name}`)
    console.log(`      ${e.message}`)
  }
}
console.log('='.repeat(78))
console.log(`通过 ${pass} / ${pass + fail}${fail > 0 ? `　失败 ${fail}` : '　全部通过 ✓'}`)
console.log('='.repeat(78))
process.exitCode = fail > 0 ? 1 : 0
