/**
 * B-6（CV-442）六体裁推广的**通用护栏** —— 工程改动那半边的守卫。
 *
 * 六个编排壳（L2）与五个 executor 的 SKILL.md 必须带统一的「工程纪律」：
 * 画面判据三层取证（read_image 首选 / inspect_image 数值 / VLM 保底不可当事实）、
 * 交付前复述未决项、数据溯源判据。缺任何一条 = 新体裁接不上工程能力，这里红。
 *
 * 注意：这是**在场性**守卫（关键词必须出现），不锁全文措辞 —— 分册措辞演进
 * 不该被逐字断言卡死；真正的契约锁在 toolchain §7 与 manifest-contract 的断言里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p) => readFileSync(join(import.meta.dirname, '..', 'skills', p), 'utf8')

const SHELLS = [
  'explainer-format-director',
  'brand-format-director',
  'product-format-director',
  'data-viz-format-director',
  'social-ad-format-director',
  'drama-format-director',
]

const EXECUTORS = [
  'drama-episode-executor',
  'brand-promo-video-generator',
  'minimalist-product-ad-generator',
  'mv-production',
  'viral-remake',
]

test('B-6 六壳：三层取证层级 + 交付复述纪律在位', () => {
  for (const name of SHELLS) {
    const s = read(`${name}/SKILL.md`)
    for (const marker of ['read_image(file_path', 'inspect_image', '不可当事实', '复述未决项', '体检']) {
      assert.ok(s.includes(marker), `${name}/SKILL.md 缺工程纪律标记「${marker}」（B-6 统一节被删了？）`)
    }
    assert.ok(s.includes('toolchain.md` §7'), `${name} 缺 toolchain §7 指针（全契约唯一权威）`)
  }
})

test('B-6 五 executor：read_image 首选 + 禁 manifest 自证在位', () => {
  for (const name of EXECUTORS) {
    const s = read(`${name}/SKILL.md`)
    assert.ok(s.includes('read_image(file_path'), `${name}/SKILL.md 缺 read_image 首选项`)
    assert.ok(s.includes('禁拿 manifest 字段自证'), `${name}/SKILL.md 缺「禁 manifest 自证」`)
  }
})

test('B-6 数据体裁壳：dataSource / baseline / pending 三判据在位', () => {
  const s = read('data-viz-format-director/SKILL.md')
  for (const marker of ['dataSource', 'baseline', 'pending', 'observed']) {
    assert.ok(s.includes(marker), `data-viz 壳缺数据判据「${marker}」`)
  }
})

test('B-6 体积闸：六壳 + 五 executor 全部 ≤ 40KB（纪律节不得把分册撑爆；2026-11-05 →15KB，2026-11-11 →20KB，2026-11-12 开发期临时 →40KB）', () => {
  for (const name of [...SHELLS, ...EXECUTORS]) {
    const size = Buffer.byteLength(read(`${name}/SKILL.md`))
    assert.ok(size <= 40 * 1024, `${name}/SKILL.md ${size}B > 40KB 闸`)
  }
})
