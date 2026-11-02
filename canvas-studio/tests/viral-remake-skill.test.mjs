/**
 * viral-remake（爆款复刻）skill 守卫（CV-391，REQ-036 R-1）。
 *
 * 结构门禁（catalog 双向 / platform.yaml 深等 / 12KB 上限 / 审批让位 / 工具引用
 * 真实性）由 skill-catalog / skill-platform-meta / skill-progressive-disclosure /
 * skill-tool-refs 四道既有门覆盖，本文件只守「文档 ↔ 源码」对齐这一层——
 * 这个 skill 本质是一份映射手册，引擎枚举一变它就在撒谎：
 *   1. 分册 §3 转场全表与 src/remotion/manifest.ts 的 EFFECTS 集合**双向**一致
 *      （引擎加了新转场而分册没跟 = 红；分册写了引擎没有的效果 = 红）；
 *   2. 分册覆盖的轨道类型 ⊆ TRACK_TYPES（手册不得指向不存在的轨）；
 *   3. 文字动效与 TextAnimPreset/TEXT_ANIM_PRESETS 双向一致；
 *   4. SKILL.md 立场声明五要素在位（流程与审批让位总纲）。
 *
 * EFFECTS / TRACK_TYPES / TEXT_ANIM_PRESETS 均未从 manifest.ts 导出，故直读源码
 * 文本做集合提取（manifest-contract-doc.test.mjs 同款思路）。
 * 运行：corepack yarn build && corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'viral-remake')
const MANIFEST_SRC = readFileSync(join(ROOT, 'src', 'remotion', 'manifest.ts'), 'utf8')
const SKILL_MD = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
const MAPPING_MD = readFileSync(join(SKILL_DIR, 'references', 'remake-mapping.md'), 'utf8')

/** 从 manifest.ts 源码文本提取一个 `const NAME = new Set([...])` 块里的字符串字面量。 */
function setLiterals(constName) {
  const re = new RegExp(`const ${constName} = new Set(?:<[^>]*>)?\\(\\[([\\s\\S]*?)\\]\\)`)
  const block = re.exec(MANIFEST_SRC)
  assert.ok(block, `manifest.ts 里找不到 ${constName}（源码结构变了，守卫要跟着改）`)
  return [...block[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1])
}

test('CV-391：skill 三件套在位（SKILL.md / platform.yaml / references 分册）', () => {
  assert.ok(existsSync(join(SKILL_DIR, 'SKILL.md')), 'SKILL.md 不存在')
  assert.ok(existsSync(join(SKILL_DIR, 'platform.yaml')), 'platform.yaml 不存在（广场与 catalog 双向门都要它）')
  assert.ok(existsSync(join(SKILL_DIR, 'references', 'remake-mapping.md')), '映射分册不存在')
  const meta = /^name:\s*"([^"]+)"$/m.exec(readFileSync(join(SKILL_DIR, 'platform.yaml'), 'utf8'))
  assert.ok(meta && meta[1] === 'viral-remake', 'platform.yaml 的 name 必须与目录名逐字一致')
})

test('CV-391：分册 §3 转场全表与 manifest EFFECTS 双向一致', () => {
  const effects = setLiterals('EFFECTS')
  assert.ok(effects.length >= 11, `EFFECTS 提取异常（${effects.length} 项），提取器可能失效`)
  const missingInDoc = effects.filter((e) => !MAPPING_MD.includes(`\`${e}\``))
  assert.deepEqual(
    missingInDoc, [],
    '引擎有但映射分册 §3 转场全表没跟上的效果 —— 分册是复刻手册，少一行模型就少一条近似路径：\n'
    + missingInDoc.join('\n'),
  )
  const bogusInDoc = [...MAPPING_MD.matchAll(/`([a-z][a-zA-Z]+)`/g)]
    .map((m) => m[1])
    .filter((name, i, all) => all.indexOf(name) === i)
    // 排除文字动效预设（fadeUp 以 fade 开头，是 textCard 的 anim 值，不是转场）
    .filter((name) => !setLiterals('TEXT_ANIM_PRESETS').includes(name))
    .filter((name) => effects.includes(name) === false && /^(fade|slide|zoom|dissolve|wipe|clock|flip|blur|warp)/.test(name))
  assert.deepEqual(
    bogusInDoc, [],
    '映射分册写成了转场效果名的词在引擎 EFFECTS 里不存在 —— 要么拼错要么引擎没这个效果：\n'
    + bogusInDoc.join('\n'),
  )
})

test('CV-391：分册覆盖全部核心轨道类型，且不指向不存在的轨', () => {
  const tracks = setLiterals('TRACK_TYPES')
  for (const t of ['video', 'image', 'caption', 'textCard', 'chart', 'shape', 'audioViz']) {
    assert.ok(
      tracks.includes(t),
      `守卫期望的轨道 ${t} 在 TRACK_TYPES 里不存在了（引擎改了，守卫要跟）`,
    )
    assert.ok(MAPPING_MD.includes(`\`${t}\``), `映射分册没有覆盖轨道 ${t}（复刻手册少一条主路径）`)
  }
  for (const t of ['transition']) {
    assert.ok(tracks.includes(t), `守卫期望的轨道 ${t} 不在 TRACK_TYPES 里了`)
  }
})

test('CV-391：文字动效与 TEXT_ANIM_PRESETS 双向一致', () => {
  const presets = setLiterals('TEXT_ANIM_PRESETS')
  assert.deepEqual(presets, ['fadeUp', 'maskReveal', 'typewriter', 'wordStagger'])
  for (const p of presets) {
    assert.ok(MAPPING_MD.includes(`\`${p}\``), `映射分册 textCard 行少了动效 ${p}`)
  }
})

test('CV-391：SKILL.md 编排定位在位（决策型：指到总纲与 manifest 契约，不自称知识型让位）', () => {
  // viral-remake 是 decision 型 skill，不得携带知识型的让位声明哨兵（CV-324 会红）。
  assert.ok(!SKILL_MD.includes('流程、审批门禁与工具契约一律以'), '决策型 skill 不得写知识型让位声明（role 自相矛盾）')
  assert.ok(SKILL_MD.includes('canvas-studio-creation'), 'SKILL.md 缺总纲指针（审批节奏与工具用法要跟总纲走）')
  assert.ok(SKILL_MD.includes('manifest-contract.md'), 'SKILL.md 缺 manifest 契约指针')
  assert.ok(SKILL_MD.includes('复刻结构，不复刻素材本身'), 'SKILL.md 缺「复刻结构不复刻素材」核心立场句')
})

test('CV-395：甜品复刻复盘——动效拆解与独立轨铁律在位（防退化成静态轮播）', () => {
  assert.ok(SKILL_MD.includes('元素与动效'), '拆解表缺第 6 列「元素与动效」（只拆版式不拆运动 = 静态轮播复刻）')
  assert.ok(SKILL_MD.includes('独立轨'), 'SKILL.md 缺「每个会动的元素 = 一条独立轨」铁律')
  assert.ok(SKILL_MD.includes('禁止把整帧画面烤成静态图') || MAPPING_MD.includes('禁止把整帧画面烤成静态图'),
    '缺「禁止整帧烤图」边界句（甜品会话 v1-v7 的实际翻车点）')
  assert.ok(MAPPING_MD.includes('`backOut`') && MAPPING_MD.includes('`spring`'),
    '缓动速查缺 backOut/spring（用户纠偏「跳起来的曲线感」= 引擎现成档位）')
  assert.ok(MAPPING_MD.includes('image_matting'), '映射分册缺透明素材路径（伪透明拼贴 = 棋盘格残边）')
  assert.ok(MAPPING_MD.includes("'outline'"), '映射分册缺镂空描边大字（fx:outline，品牌站复刻常态）')
  assert.ok(SKILL_MD.includes('不要读组件源码'), 'SKILL.md 缺「查契约不读源码」纪律（甜品会话两次 grep 源码复发）')
})
