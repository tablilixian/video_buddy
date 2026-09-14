/**
 * DD-08 / R3 侧栏项目卡守卫（relative-time / project-cover / project-row /
 * workflowStateStageLabel）。
 *
 * 这几条是**每次渲染都在跑**的派生逻辑，口径钉在纯函数上，不靠肉眼回归。
 * 每个用例对应一条真实会出错的边界：
 *
 * 1. **非法 / 未来时间戳** —— 显示「Invalid Date」或「-3 分钟前」比不显示更糟。
 *    老记录的 updatedAt 是可选字段（契约里必填，但 registry 里的历史文档未必）。
 * 2. **分档边界** —— 59s/60s、59min/60min、23h/24h、47h/48h、7d 各是一条真边界；
 *    少写一个 `<` 就得到「0 分钟前」或「24 小时前」这种读起来像 bug 的文案。
 * 3. **跨年** —— 去年 12 月的项目显示 `12/20` 会被误读成今年，必须带年份。
 * 4. **代理对** —— `charAt(0)` 会把 emoji 切出半个码点，渲染成豆腐块。
 * 5. **色档由 id 派生** —— 改名后封面不能换色（视觉记忆靠颜色），这是
 *    「按 id 不按名字」的唯一理由，必须被钉住。
 * 6. **档位数量三处同源** —— 纯函数的 COVER_TONES = brand.ts 的令牌数 =
 *    styles.ts 的类数。任一处单独加一档都会让末档项目静默无色块。
 * 7. **阶段词与六段轨道同源** —— 列表说「分镜」轨道就必须说「分镜」；
 *    且 `script_review` 的地板是剧本（待批准不是已完成，不许抢跑一格）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { relativeTime } from '../lib/relative-time.js'
import { COVER_TONES, coverInitial, coverTone, coverToneClass } from '../lib/project-cover.js'
import { projectRowMeta } from '../lib/project-row.js'
import {
  workflowStateStageLabel,
  WORKFLOW_STAGE_LABELS,
} from '../lib/workflow-stage.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 固定的「现在」，所有断言都相对它 —— 绝不取 Date.now()（跨整点会让断言抖动）。 */
const NOW = new Date('2026-09-14T10:00:00')

/** NOW 之前 ms 毫秒的 ISO 串（用绝对时刻回推，绕开本地时区对日期段的干扰）。 */
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString()

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 最小可用项目记录（只填被测字段，其余走契约的必填项）。 */
function project(extra = {}) {
  return {
    id: 'p-1',
    name: '测试项目',
    createdAt: ago(DAY),
    updatedAt: ago(DAY),
    dir: '/tmp/p-1',
    ...extra,
  }
}

/* ---------------- relative-time ---------------- */

test('relativeTime：非法与缺失时间戳返回 null，不吐 Invalid Date', () => {
  assert.equal(relativeTime('not-a-date', NOW), null)
  assert.equal(relativeTime('', NOW), null)
  assert.equal(Date.parse('not-a-date'), Number.NaN, '前提：这个词确实解析不了')
})

test('relativeTime：未来时间戳按「刚刚」处理，不出现负数', () => {
  assert.equal(relativeTime(new Date(NOW.getTime() + 5 * MINUTE).toISOString(), NOW), '刚刚')
  assert.equal(relativeTime(new Date(NOW.getTime() + 30 * DAY).toISOString(), NOW), '刚刚')
})

test('relativeTime：分档边界（59s/60s · 59min/60min · 23h/24h · 47h/48h）', () => {
  assert.equal(relativeTime(ago(0), NOW), '刚刚')
  assert.equal(relativeTime(ago(59_000), NOW), '刚刚')
  assert.equal(relativeTime(ago(MINUTE), NOW), '1 分钟前')
  assert.equal(relativeTime(ago(59 * MINUTE), NOW), '59 分钟前')
  assert.equal(relativeTime(ago(HOUR), NOW), '1 小时前')
  assert.equal(relativeTime(ago(23 * HOUR), NOW), '23 小时前')
  assert.equal(relativeTime(ago(24 * HOUR), NOW), '昨天')
  assert.equal(relativeTime(ago(47 * HOUR), NOW), '昨天')
  assert.equal(relativeTime(ago(48 * HOUR), NOW), '2 天前')
  assert.equal(relativeTime(ago(6 * DAY), NOW), '6 天前')
})

test('relativeTime：满 7 天开始走日期，同自然年省年份、跨年带年份', () => {
  assert.equal(relativeTime(ago(7 * DAY), NOW), '09/07')
  // 跨年：去年 12 月20 日距今 16 天，必须带年份，否则会被读成今年
  const jan = new Date('2026-01-05T10:00:00')
  const then = new Date(jan.getTime() - 16 * DAY).toISOString()
  assert.equal(relativeTime(then, jan), '2025/12/20')
})

/* ---------------- project-cover ---------------- */

test('coverInitial：空/纯空白名字给 ?，不返回空串', () => {
  assert.equal(coverInitial(''), '?')
  assert.equal(coverInitial('   '), '?')
})

test('coverInitial：按码点切首字（代理对不被切半）', () => {
  assert.equal(coverInitial('🎬测试'), '🎬')
  assert.equal(coverInitial('赛博朋克 30s'), '赛')
  assert.equal(coverInitial('  cyberpunk'), 'C')
  assert.equal(Array.from('🎬测试').length, 3, '前提：emoji 是 1 个码点 2 个 UTF-16 单元')
  assert.equal('🎬测试'.charAt(0), '\uD83C', '前提：charAt 会切出半个码点（所以要按码点切）')
})

test('coverTone：档位稳定、落在 1..COVER_TONES、且真的用到全部档位', () => {
  assert.equal(coverTone('p-1'), coverTone('p-1'), '同一 id 两次调用必须同档')
  const seq = []
  for (let i = 0; i < 300; i += 1) seq.push(coverTone(`p-${i}`))
  for (const tone of seq) {
    assert.ok(Number.isInteger(tone) && tone >= 1 && tone <= COVER_TONES, `档位越界：${tone}`)
  }
  // 300 个顺序 id 实测覆盖 1..6 —— 散列退化（例如拿负数取模）会让档位塌缩
  assert.equal(new Set(seq).size, COVER_TONES, `顺序 id 只覆盖了 ${new Set(seq).size} 档`)
  // Host 铸的是 UUID，同样必须覆盖满
  const uuids = []
  for (let i = 0; i < 200; i += 1) uuids.push(coverTone(`3f2a1b4c-0000-4000-8000-${String(i).padStart(12, '0')}`))
  assert.equal(new Set(uuids).size, COVER_TONES, `UUID 只覆盖了 ${new Set(uuids).size} 档`)
})

test('coverTone：色档由 id 派生而不是名字 —— 改名不换色', () => {
  const a = project({ id: 'same-id', name: '旧名字' })
  const b = project({ id: 'same-id', name: '完全不同的新名字' })
  assert.equal(coverTone(a.id), coverTone(b.id))
  assert.equal(coverToneClass(a.id), coverToneClass(b.id))
  assert.equal(coverToneClass('p-1'), `csCoverTone${coverTone('p-1')}`)
})

test('档位数量三处同源：COVER_TONES = brand.ts 令牌数 = styles.ts 类数', () => {
  const brand = readSrc('../src/brand.ts')
  const styles = readSrc('../src/client/styles.ts')
  const tokens = new Set([...brand.matchAll(/--cs-cover-(\d+)/g)].map((m) => Number(m[1])))
  const classes = new Set([...styles.matchAll(/\.csCoverTone(\d+)/g)].map((m) => Number(m[1])))
  assert.equal(tokens.size, COVER_TONES, `brand.ts 定义了 ${tokens.size} 档，纯函数有 ${COVER_TONES} 档`)
  assert.equal(classes.size, COVER_TONES, `styles.ts 定义了 ${classes.size} 档，纯函数有 ${COVER_TONES} 档`)
  for (let i = 1; i <= COVER_TONES; i += 1) {
    assert.ok(tokens.has(i), `brand.ts 缺第 ${i} 档色，末档项目会渲染成无色块`)
    assert.ok(classes.has(i), `styles.ts 缺第 ${i} 档类`)
  }
})

/* ---------------- workflowStateStageLabel ---------------- */

test('workflowStateStageLabel：用六段轨道的同一张词表，不另开第二份文案', () => {
  for (const state of ['drafting', 'script_review', 'awaiting_approval', 'keyframe_review', 'executing']) {
    assert.ok(WORKFLOW_STAGE_LABELS.includes(workflowStateStageLabel(state)), `${state} 的标签不在词表内`)
  }
  assert.equal(workflowStateStageLabel(undefined), '剧本', '缺 workflow 字段（老记录）退回第一段')
})

test('workflowStateStageLabel：待批准站在自己那一段，不抢跑一格', () => {
  // script_review = 剧本待批准，仍站在剧本；误读成「已进分镜」会让轨道凭空前进
  assert.equal(workflowStateStageLabel('script_review'), workflowStateStageLabel('drafting'))
  assert.equal(workflowStateStageLabel('awaiting_approval'), '分镜')
  assert.equal(workflowStateStageLabel('keyframe_review'), '关键帧')
  // executing 是「在拍」，不是「拍完了」—— 成片段需要产物证据，侧栏拿不到就别说
  assert.equal(workflowStateStageLabel('executing'), '镜头')
})

/* ---------------- project-row ---------------- */

test('projectRowMeta：三段各自来自已有字段，零契约改动', () => {
  const meta = projectRowMeta(project({
    updatedAt: ago(3 * HOUR),
    workflow: { mode: 'confirm', state: 'keyframe_review' },
    plan: { aspectRatio: '16:9', targetDuration: 30 },
  }), NOW)
  assert.deepEqual(meta, { stage: '关键帧', plan: '16:9 · 30s', time: '3 小时前' })
})

test('projectRowMeta：未锁规格时 plan 为 null（而不是空串），时间戳坏掉时为 null', () => {
  assert.equal(projectRowMeta(project({ plan: undefined }), NOW).plan, null)
  assert.equal(projectRowMeta(project({ plan: {} }), NOW).plan, null, '空 plan 对象不许拼出空串')
  assert.equal(projectRowMeta(project({ plan: { aspectRatio: '9:16' } }), NOW).plan, '9:16', '只有画幅时不带悬空分隔符')
  assert.equal(projectRowMeta(project({ plan: { targetDuration: 60 } }), NOW).plan, '60s', '只有时长时不带悬空分隔符')
  assert.equal(projectRowMeta(project({ updatedAt: 'bad' }), NOW).time, null)
  assert.equal(projectRowMeta(project({ workflow: undefined }), NOW).stage, '剧本')
})

test('projectRowMeta：读的是 updatedAt（最后动过），不是 createdAt', () => {
  const meta = projectRowMeta(project({ createdAt: ago(10 * DAY), updatedAt: ago(HOUR) }), NOW)
  assert.equal(meta.time, '1 小时前', '拿 createdAt 会显示「10 天前」，与「刚改过」矛盾')
})
