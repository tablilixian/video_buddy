/**
 * REQ-022（CV-293）render(storyboard) → HTML 的判定测试。
 *
 * 这一层唯一的真风险是 **XSS**：页面内容全部来自 agent / 用户（`claim` / `visual` /
 * `promptEn` / 角色 `name`…），任何一个字段漏转义，这段内容就会在覆盖层里执行。
 * 覆盖层是 iframe 同源加载的（与主窗口同源）——漏一个转义等于把主窗口暴露出去，
 * 所以「转义」是硬要求，必须有守卫盯着。
 *
 * 第二条：**v1 与 vN 同构**（req1「稳定转 HTML」）。同一份模板只换数据，所以
 * 断言「两个不同版本的渲染形状一致（标签集合相同）」，防止将来给某一版开小灶。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderStoryboard,
  renderStoryboardPlaceholder,
  renderStoryboardCorrupt,
  summarizeStoryboard,
} from '../lib/storyboard-render.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'

function sectionsWith(overrides = {}) {
  return { ...emptyStoryboardSections(), ...overrides }
}

function docWith(sections) {
  return createStoryboard({
    projectId: 'p1',
    title: '《雨夜来信》',
    meta: { genre: '民国悬疑', targetDuration: 30, aspect: '16:9' },
    sections,
  })
}

test('summarizeStoryboard：分镜 / shot / 时长 / 角色 / 约束都数对', () => {
  const summary = summarizeStoryboard(sectionsWith({
    '03_narration': { lines: [{ id: 'V1', text: 'a', duration: 2.5 }] },
    '04_storyboard': {
      scenes: [
        { id: 'S1', title: '开场', shots: [{ id: 'S1-Sh1', duration: 2.5, frames: 60, camera: 'Push in', visual: 'v', audio: 'a', backup: false }] },
        { id: 'S2', title: '读信', shots: [{ id: 'S2-Sh1', duration: 3, frames: 72, camera: 'Static', visual: 'v', audio: 'a', backup: true }] },
      ],
    },
    '05_characters': [{ id: 'C1' }],
    '08_constraints': ['一条', '两条'],
  }))
  assert.equal(summary.scenes, 2)
  assert.equal(summary.shots, 2)
  assert.equal(summary.shotDuration, 5.5)
  assert.equal(summary.narrationDuration, 2.5)
  assert.equal(summary.characters, 1)
  assert.equal(summary.constraints, 2)
})

test('XSS：各节里的 HTML 元字符一律转义，不进 DOM', () => {
  const payload = '<img src=x onerror="alert(1)">'
  const html = renderStoryboard(docWith(sectionsWith({
    '00_creative': { brief: payload },
    '01_facts': { facts: [{ claim: payload, source: 'javascript:alert(1)', status: 'verified' }] },
    '02_visual': { tokens: [{ k: payload, v: payload }] },
    '03_narration': { lines: [{ id: 'V1', text: payload, duration: 1 }] },
    '04_storyboard': {
      scenes: [{ id: 'S1', title: payload, shots: [{ id: 'S1-Sh1', duration: 1, frames: 24, camera: payload, visual: payload, audio: payload, promptEn: payload, backup: false }] }],
    },
    '05_characters': [{
      id: 'C1', label: payload, name: payload, tags: [payload],
      profile: { temperament: payload, face: payload, costume: payload },
      palette: { base: payload, accent: payload },
      appearsIn: ['S1'],
      gen: { lockedPrompt: payload, negativePrompt: payload },
    }],
    '06_sound': { bgm: { bpm: 52, lufs: -16, sidechain: payload }, sfx: [payload] },
    '07_assets': [{ name: payload, type: 'image', status: 'ready', ref: { kind: 'file', id: payload } }],
    '08_constraints': [payload],
  })))

  assert.ok(!html.includes('<img src=x'), '未转义的标签必须不出现')
  assert.ok(!html.includes('onerror="alert(1)"'), '未转义的事件属性必须不出现')
  assert.ok(html.includes('&lt;img src=x'), '必须出现转义后的形态')
})

test('XSS：来源 URL 走属性转义，引号不能逃逸', () => {
  const html = renderStoryboard(docWith(sectionsWith({
    '01_facts': { facts: [{ claim: 'c', source: 'https://x/" onmouseover="alert(1)', status: 'verified' }] },
  })))
  assert.ok(!html.includes('onmouseover="alert(1)"'), 'URL 里的引号必须被转义')
  assert.ok(html.includes('&quot;'), '必须出现转义后的引号')
})

test('v1 与活副本同构：同一份数据、同一模板，标签形状完全一致', () => {
  const sections = sectionsWith({
    '03_narration': { lines: [{ id: 'V1', text: '旁白', duration: 2.5, shotRef: 'S1-Sh1' }] },
    '04_storyboard': {
      scenes: [{ id: 'S1', title: '开场', shots: [{ id: 'S1-Sh1', duration: 2.5, frames: 60, camera: 'Push in', visual: '雨夜弄堂', audio: '雨声', promptEn: 'rainy alley', backup: false }] }],
    },
    '05_characters': [{
      id: 'C1', label: 'ROLE A', name: '苏婉', tags: ['女'],
      profile: { temperament: '静', face: '鹅蛋脸', costume: '月白旗袍' },
      palette: { base: 'warm ivory', accent: '暗红' },
      appearsIn: ['S1'],
      gen: { lockedPrompt: '26-year-old', negativePrompt: '不改五官' },
    }],
  })
  const base = docWith(sections)
  // 首稿的 v1 快照就是这份 sections —— 指定 v1 渲染必须与活副本形状逐标签一致。
  const tagsOf = (html) => new Set([...html.matchAll(/<\/?([a-z][a-z0-9]*)\b/gu)].map((m) => m[1]))
  assert.deepEqual(
    [...tagsOf(renderStoryboard(base, { version: 'v1' }))].sort(),
    [...tagsOf(renderStoryboard(base))].sort(),
    '同一模板换数据不得改变标签形状',
  )
  const v1 = renderStoryboard(base, { version: 'v1' })
  assert.ok(v1.includes('雨夜弄堂'))
  assert.ok(v1.includes('拍摄定稿 · v1'), '角标必须写所看版本，不能仍写「活副本」')
})

test('版本切换真的换数据（v2 渲染 v2 的内容，而不是活副本）', () => {
  const base = docWith(sectionsWith({ '00_creative': { brief: '活副本的开头' } }))
  const archived = {
    ...base,
    versions: {
      ...base.versions,
      history: [
        ...base.versions.history,
        { version: 'v2', kind: 'manual', label: '黄昏版', createdAt: 2, parent: 'v1', snapshot: sectionsWith({ '00_creative': { brief: '黄昏版的开头' } }) },
      ],
    },
  }
  const v2 = renderStoryboard(archived, { version: 'v2' })
  assert.ok(v2.includes('黄昏版的开头'))
  assert.ok(!v2.includes('活副本的开头'), '指定版本时不得混入活副本内容')
  assert.ok(renderStoryboard(archived).includes('活副本的开头'), '不指定版本时渲染活副本')
})

test('空文档也能渲染（不抛、给出可解释的空态）', () => {
  const html = renderStoryboard(docWith(emptyStoryboardSections()))
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('还没有分镜'))
  assert.ok(html.includes('还没有角色设定'))
})

test('缺失 → 占位页；损坏 → 留证提示页（都不是 404 白屏）', () => {
  assert.ok(renderStoryboardPlaceholder('项目A').includes('还没有拍摄定稿'))
  const corrupt = renderStoryboardCorrupt('项目A', '/tmp/x/storyboard.json.corrupt')
  assert.ok(corrupt.includes('读不出来'))
  assert.ok(corrupt.includes('/tmp/x/storyboard.json.corrupt'), '必须把留证路径告诉用户')
})

test('落地后角标写「已落地 vN」', () => {
  const base = docWith(emptyStoryboardSections())
  const landed = { ...base, landed: { at: 1, sourceVersion: 'v2', sections: base.sections } }
  const html = renderStoryboard(landed, { landedVersion: 'v2' })
  assert.ok(html.includes('已落地 v2'))
})

test('0/9 骨架：渲染「等待创意填充」引导横幅（骨架先行的可见反馈）', () => {
  const html = renderStoryboard(docWith(emptyStoryboardSections()))
  assert.ok(html.includes('等待创意填充'))
  assert.ok(html.includes('已填充 <b>0 / 9</b> 节'))
})

test('已有内容时不渲染引导横幅（避免与正常内容抢注意力）', () => {
  const html = renderStoryboard(docWith(sectionsWith({ '00_creative': { brief: '雨夜' } })))
  assert.ok(!html.includes('等待创意填充'))
})

test('mediaUrl 解析器命中时渲染 shot 效果图与 look 基调样张缩略图', () => {
  const sections = sectionsWith({
    '02_visual': { tokens: [{ k: '色彩', v: '青灰' }], lookRef: { kind: 'canvasNode', id: 'n-look' } },
    '04_storyboard': {
      scenes: [{
        id: 'S1', title: '开场',
        shots: [{ id: 'S1-Sh1', duration: 2.5, frames: 60, camera: 'Push in', visual: 'v', audio: 'a', backup: false, refImage: { kind: 'canvasNode', id: 'n1' } }],
      }],
    },
  })
  const media = (ref) => ref.id === 'n-look' ? '/canvas-studio/assets/p1/look.png' : `/canvas-studio/assets/p1/${ref.id}.png`
  const html = renderStoryboard(docWith(sections), { mediaUrl: media })
  assert.ok(html.includes('src="/canvas-studio/assets/p1/look.png"'), 'look 样张缩略图')
  assert.ok(html.includes('src="/canvas-studio/assets/p1/n1.png"'), 'shot 效果图缩略图')
  assert.ok(html.includes('基调样张'))
  assert.ok(html.includes('效果图'))
})

test('CV-307 §02 图文混排：基调样张大图与 5 条 token 并置，图走 .look-row 且可点开原图', () => {
  const sections = sectionsWith({
    '02_visual': {
      tokens: [{ k: '色彩', v: '青灰冷调' }, { k: '光线', v: '侧逆光' }],
      lookRef: { kind: 'canvasNode', id: 'n-look' },
    },
  })
  const html = renderStoryboard(docWith(sections), { mediaUrl: () => '/canvas-studio/assets/p1/look.png' })
  assert.ok(html.includes('<div class="look-row">'), '有图时必须包一层图文并置容器')
  // 点图放大：零 JS —— 走新窗口链接（与 §01 来源链接同款），不是脚本
  assert.ok(html.includes('<a class="zoom" href="/canvas-studio/assets/p1/look.png" target="_blank" rel="noreferrer"'), '图必须包在新窗口链接里')
  assert.ok(html.includes('cursor:zoom-in'), '链接要有放大光标')
  assert.ok(html.includes('这张样张承载全部 5 维'), '图下一行要说明「一张承载全部 5 维」')
  assert.ok(html.includes('loading="lazy"'), '大图懒加载')
  assert.ok(html.includes('class="tokens"'), 'tokens 与图同框（同一 .look-row 内）')
  assert.ok(!html.includes('<script'), '零 JS 契约不破')
})

test('CV-307 §02 无图时保持纯文字（不占位、不加 .look-row）', () => {
  const sections = sectionsWith({ '02_visual': { tokens: [{ k: '色彩', v: '青灰冷调' }] } })
  const html = renderStoryboard(docWith(sections), { mediaUrl: () => '/a.png' })
  assert.ok(!html.includes('<div class="look-row">'), '没有 lookRef 就不该出现图文并置容器')
  assert.ok(html.includes('class="tokens"'), 'token 仍照常渲染')
  assert.ok(!html.includes('<figure class="look-fig">'), '缺图时不占位')
  assert.ok(!html.includes('class="look-dangling"'), '没有引用时也不该出「引用悬空」提示')
})

test('CV-310 §02 有引用却取不到图 → 显式提示，不退化成「还没有视觉规范」空态', () => {
  const sections = sectionsWith({ '02_visual': { tokens: [], lookRef: { kind: 'canvasNode', id: 'n-gone' } } })
  const html = renderStoryboard(docWith(sections), { mediaUrl: () => undefined })
  assert.ok(html.includes('class="look-dangling"'), '引用在、图取不到 → 必须出提示条')
  assert.ok(html.includes('n-gone'), '提示里要带引用 id，用户能据此定位')
  // 断 §02 空态段落的专属片段：别用「冻结成 Look 卡」（§02 静态副标题里也有这句），
  // 也别用「还没有视觉规范」（内联样式里的注释含这几个字）。
  assert.ok(!html.includes('还没有视觉规范。这 5 项'), '明明挂着引用，不许退化成 §02 空态段落')
  assert.ok(!html.includes('<img'), '取不到图时不渲染 <img>')

  // 有 tokens 时同样要提示 —— 不能因为有文字了就把「图取不到」藏起来。
  const withTokens = renderStoryboard(docWith(sectionsWith({
    '02_visual': { tokens: [{ k: '色彩', v: '青灰' }], lookRef: { kind: 'canvasNode', id: 'n-gone' } },
  })), { mediaUrl: () => undefined })
  assert.ok(withTokens.includes('class="look-dangling"'), 'tokens 在场也要提示')
  assert.ok(withTokens.includes('class="tokens"'), 'tokens 照常渲染')

  // 没有解析器 ⇒ 无法判定（测试 / 预览台 / 路由那条「画布读不出来」的整体降级），保持静默。
  assert.ok(!renderStoryboard(docWith(sections)).includes('class="look-dangling"'), '无解析器时不制造假警报')
})

test('不传 mediaUrl（或解析不到）→ 零 <img>，与旧行为一致', () => {
  const sections = sectionsWith({
    '04_storyboard': {
      scenes: [{
        id: 'S1', title: '开场',
        shots: [{ id: 'S1-Sh1', duration: 2.5, frames: 60, camera: 'Push in', visual: 'v', audio: 'a', backup: false, refImage: { kind: 'canvasNode', id: 'n1' } }],
      }],
    },
  })
  assert.ok(!renderStoryboard(docWith(sections)).includes('<img'))
  const resolved = renderStoryboard(docWith(sections), { mediaUrl: () => undefined })
  assert.ok(!resolved.includes('<img'), '解析不到 URL 时同样不渲染')
})

test('缩略图 URL 走属性转义（引号不能逃逸出 src）', () => {
  const sections = sectionsWith({
    '04_storyboard': {
      scenes: [{
        id: 'S1', title: '开场',
        shots: [{ id: 'S1-Sh1', duration: 1, frames: 1, camera: 'a', visual: 'v', audio: 'a', backup: false, refImage: { kind: 'file', id: 'x' } }],
      }],
    },
  })
  const html = renderStoryboard(docWith(sections), { mediaUrl: () => '/a.png" onerror="alert(1)' })
  assert.ok(html.includes('src="/a.png&quot; onerror=&quot;alert(1)"'))
  assert.ok(!html.includes('onerror="alert(1)"'))
})

test('CV-296 sourceIdea：用户原话渲染进 §00，转义、不计完成度', () => {
  const idea = '小米最新电话手表，帮我制作一段手腕的30秒广告 <script>alert(1)</script>'
  const html = renderStoryboard(docWith(sectionsWith()), { sourceIdea: idea })
  assert.ok(html.includes('你的原始创意'), '原话块标签必须出现')
  assert.ok(html.includes('&lt;script&gt;'), '原话必须转义（内容来自用户，防 XSS 同样适用）')
  assert.ok(!html.includes('<script>'), '未转义脚本不得出现')
  assert.ok(html.includes('已填充 <b>0 / 9</b> 节'), '原话不计入九节完成度')
  // 省略 sourceIdea → 不渲染该块（与旧行为一致）。
  assert.ok(!renderStoryboard(docWith(sectionsWith())).includes('你的原始创意'))
  assert.ok(!renderStoryboard(docWith(sectionsWith()), { sourceIdea: '   ' }).includes('你的原始创意'), '纯空白 = 未传')
})
