/**
 * REQ-022（CV-293）storyboard 数据契约的判定测试。
 *
 * 这条判定决定「故事版能不能落到画布」——落地按钮永不 disabled，缺项靠
 * `validateForSeed` 的 blocker 表说话。所以判据必须钉在纯函数上：
 * 放一个漏网进去 = 用户点「确认落地」后才炸；多拦一个 = 用户永远落不下去。
 *
 * 每个用例对应一条真实边界：
 * 1. **损坏 ≠ 空文档** —— 文件根本不是 storyboard 时给 `undefined`，让落盘层走
 *    「显式报错 + `.corrupt` 备份」；storyboard 是用户创作资产，静默重置等于毁稿。
 * 2. **缺节给合法空值** —— 归一化不抛，读侧不用到处判 undefined。
 * 3. **blocker 只答「能不能落地」** —— meta 齐 / ≥1 分镜 / 每 shot 有画面与正时长 /
 *    角色有 lockedPrompt / ≥1 token / 引用有效 / 语义 ID 唯一。
 * 4. **warning 只进确认清单** —— 时长偏差、待核实、缺 promptEn 都不许阻断落地。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStoryboard,
  emptyStoryboardSections,
  normalizeStoryboard,
  validateForSeed,
} from '../lib/contracts/storyboard.js'

/** 一份最小可落地文档（各节齐、引用自洽）。 */
function validSections() {
  const sections = emptyStoryboardSections()
  return {
    ...sections,
    '00_creative': { brief: '雨夜的一封信' },
    '01_facts': { facts: [{ claim: '上海石库门', source: 'https://example.com', status: 'verified' }] },
    '02_visual': { tokens: [{ k: '色彩', v: '青灰冷调 + 钨丝暖点' }] },
    '03_narration': { lines: [{ id: 'V1', text: '那封信来得比雨更冷', duration: 2.5, shotRef: 'S1-Sh1' }] },
    '04_storyboard': {
      scenes: [{
        id: 'S1',
        title: '开场',
        shots: [{
          id: 'S1-Sh1',
          duration: 2.5,
          frames: 60,
          camera: 'Push in',
          visual: '雨夜弄堂，一盏钨丝灯',
          audio: '雨声 + 远处电车',
          narrationRef: 'V1',
          promptEn: 'rainy alley at night, tungsten lamp, push in',
          backup: false,
        }],
      }],
    },
    '05_characters': [{
      id: 'C1',
      label: 'ROLE A',
      name: '苏婉',
      tags: ['女', '26岁'],
      profile: { temperament: '静', face: '鹅蛋脸', costume: '月白旗袍' },
      palette: { base: 'warm ivory', accent: '围巾暗红' },
      appearsIn: ['S1'],
      gen: { lockedPrompt: '26-year-old chinese woman, oval face', negativePrompt: '不改变五官' },
    }],
    '08_constraints': ['每个 shot prompt 只保留一个 camera motion 动词'],
  }
}

function validDoc() {
  return createStoryboard({
    projectId: 'p1',
    title: '《雨夜来信》',
    meta: { genre: '民国悬疑', targetDuration: 2.5, aspect: '16:9' },
    sections: validSections(),
  })
}

test('normalizeStoryboard：非对象 → undefined（走损坏分支，不静默重置）', () => {
  assert.equal(normalizeStoryboard(undefined), undefined)
  assert.equal(normalizeStoryboard(null), undefined)
  assert.equal(normalizeStoryboard('junk'), undefined)
  assert.equal(normalizeStoryboard([1, 2, 3]), undefined)
})

test('normalizeStoryboard：缺节全部降级为合法空值，不抛', () => {
  const doc = normalizeStoryboard({ projectId: 'p1', title: 't' })
  assert.ok(doc !== undefined)
  assert.deepEqual(doc.sections['04_storyboard'].scenes, [])
  assert.deepEqual(doc.sections['05_characters'], [])
  assert.deepEqual(doc.sections['06_sound'].bgm, { bpm: 0, lufs: 0, sidechain: '' })
  assert.deepEqual(doc.sections['02_visual'].tokens, [])
  assert.equal(doc.landed, null)
  assert.deepEqual(doc.bindings, {})
  assert.deepEqual(doc.actuals, {})
})

test('normalizeStoryboard：非法枚举降级（status / type / ref.kind）', () => {
  const doc = normalizeStoryboard({
    projectId: 'p1',
    title: 't',
    sections: {
      '01_facts': { facts: [{ claim: 'a', source: 'b', status: '胡说' }] },
      '07_assets': [{ name: 'x', type: '胡说', status: '胡说', ref: { kind: '胡说', id: 'i' } }],
    },
  })
  assert.equal(doc.sections['01_facts'].facts[0].status, 'pending')
  assert.equal(doc.sections['07_assets'][0].type, 'image')
  assert.equal(doc.sections['07_assets'][0].status, 'pending')
  assert.equal(doc.sections['07_assets'][0].ref.kind, 'file')
})

test('createStoryboard：首稿即 v1 checkpoint，final 尚未冻结', () => {
  const doc = validDoc()
  assert.equal(doc.schemaVersion, 2)
  assert.equal(doc.versions.baseline, 'v1')
  assert.equal(doc.versions.seq, 1)
  assert.equal(doc.versions.history.length, 1)
  assert.equal(doc.versions.history[0].version, 'v1')
  assert.equal(doc.landed, null, '未落地时 landed 必须为空——否则 seed 会拿到不存在的内容')
})

test('validateForSeed：最小合法文档 → 无 blocker', () => {
  const result = validateForSeed(validDoc())
  assert.deepEqual([...result.blockers], [])
})

test('validateForSeed：空文档把该拦的都说清楚（且逐条可定位）', () => {
  const empty = createStoryboard({
    projectId: 'p1',
    title: '',
    meta: { genre: '', targetDuration: 0, aspect: '' },
    sections: emptyStoryboardSections(),
  })
  const { blockers } = validateForSeed(empty)
  const joined = blockers.join('\n')
  assert.ok(joined.includes('title'), '缺标题要报')
  assert.ok(joined.includes('meta.aspect'), '缺画幅要报')
  assert.ok(joined.includes('meta.targetDuration'), '缺目标时长要报')
  assert.ok(joined.includes('§02'), '缺视觉 token 要报')
  assert.ok(joined.includes('§04'), '缺分镜要报')
})

test('validateForSeed：shot 时长必须为正、visual 必须非空', () => {
  const doc = validDoc()
  const shot = { ...doc.sections['04_storyboard'].scenes[0].shots[0], duration: 0, visual: '  ' }
  const sections = {
    ...doc.sections,
    '04_storyboard': { scenes: [{ ...doc.sections['04_storyboard'].scenes[0], shots: [shot] }] },
  }
  const { blockers } = validateForSeed({ ...doc, sections })
  const joined = blockers.join('\n')
  assert.ok(joined.includes('时长必须大于 0'))
  assert.ok(joined.includes('缺少画面描述'))
})

test('validateForSeed：角色缺 lockedPrompt 是 blocker（画布拿不到生成锚点）', () => {
  const doc = validDoc()
  const sections = {
    ...doc.sections,
    '05_characters': [{ ...doc.sections['05_characters'][0], gen: { lockedPrompt: '', negativePrompt: 'x' } }],
  }
  const { blockers } = validateForSeed({ ...doc, sections })
  assert.ok(blockers.join('\n').includes('gen.lockedPrompt'))
})

test('validateForSeed：narrationRef 悬空是 blocker，shotRef 悬空只是 warning', () => {
  const doc = validDoc()
  const scene = doc.sections['04_storyboard'].scenes[0]
  const sections = {
    ...doc.sections,
    '03_narration': { lines: [{ ...doc.sections['03_narration'].lines[0], shotRef: 'S9-Sh9' }] },
    '04_storyboard': {
      scenes: [{ ...scene, shots: [{ ...scene.shots[0], narrationRef: 'V9' }] }],
    },
  }
  const { blockers, warnings } = validateForSeed({ ...doc, sections })
  assert.ok(blockers.join('\n').includes('不存在的旁白句'), 'shot→旁白 悬空必须阻断')
  assert.ok(warnings.join('\n').includes('不存在的 shot'), '旁白→shot 悬空只告警')
})

test('validateForSeed：语义 ID 重复是 blocker（一次铸造、永不复用）', () => {
  const doc = validDoc()
  const scene = doc.sections['04_storyboard'].scenes[0]
  const sections = {
    ...doc.sections,
    '04_storyboard': { scenes: [{ ...scene, shots: [scene.shots[0], scene.shots[0]] }] },
  }
  const { blockers } = validateForSeed({ ...doc, sections })
  assert.ok(blockers.join('\n').includes('语义 ID 重复'))
})

test('validateForSeed：时长偏差 / 待核实 / 缺 promptEn 只进 warning，不阻断落地', () => {
  const doc = validDoc()
  const scene = doc.sections['04_storyboard'].scenes[0]
  const sections = {
    ...doc.sections,
    '01_facts': { facts: [{ claim: 'a', source: '', status: 'pending' }] },
    '04_storyboard': {
      scenes: [{
        ...scene,
        shots: [{ ...scene.shots[0], duration: 30, promptEn: undefined }],
      }],
    },
  }
  const { blockers, warnings } = validateForSeed({ ...doc, sections })
  assert.deepEqual([...blockers], [], '这些都不该阻断落地')
  const joined = warnings.join('\n')
  assert.ok(joined.includes('偏差'), '时长偏差要告警')
  assert.ok(joined.includes('待核实'), '待核实要告警')
  assert.ok(joined.includes('promptEn'), '缺 promptEn 要告警')
})
