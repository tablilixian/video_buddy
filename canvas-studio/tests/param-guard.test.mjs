/**
 * CV-235：工具入参「占位值」守卫。
 *
 * ## 抓的是什么 bug
 *
 * 模型一次规划多个工具调用时，会给「还没算出来的」引用类入参先填一个占位串顶上。
 * 实测（2026-09-23 用户会话，12 条报错里 7 条源于此）：`upload_image` 收到
 * `{"imageUrl":"placeholder2"}`（一直到 placeholder5）、`character_sheet` 收到
 * `{"filename":"placeholder-will-retry"}`、`video_composite` 收到 `{"prompt":"placeholder"}`。
 * 这些串会一路走到**下载地址安全校验**或后端才被拦下，报出与真因无关的失败。
 *
 * 这一份守四件事，缺一件 bug 就会以另一种形态回来：
 *  ① **判定口径**：实测形态必中，合法句柄必不中（误判比漏判更糟 —— 会拦住合法调用）；
 *  ② **参数分类表双向对账**：工具里出现的每个参数名都必须显式归类（新参数不得静默溜过），
 *     且分类表里不得留下已经不存在于任何工具的残留名字；
 *  ③ **拒收真发生在入口**（`wrapStudioToolDefinition`）：命中的调用不得进入 `execute`；
 *  ④ **事前纪律双向**：有句柄入参的工具描述必须挂上同一句纪律；没有的不得被挂。
 *
 * 静态读源码的地方一律剥注释（本仓踩过一次：`https://` 的 `//` 被当成注释开头）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLACEHOLDER_PARAM_RULE,
  assertNoPlaceholderParams,
  classifiedParamNames,
  exemptReasonOf,
  findPlaceholderParam,
  paramClassOf,
  toolNeedsPlaceholderRule,
  withPlaceholderParamRule,
} from '../lib/param-guard.js'
import { placeholderParamReason } from '../lib/text-guard.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'
import { createStudioTools } from '../lib/host-tools.js'
import { createPlaceholderTools } from '../lib/skills/placeholder-tools.js'
import { codeIsUserFacing, getErrorSpec, routeError, CanvasStudioError } from '../lib/error-system.js'
import '../lib/errors/catalog.js'

/**
 * 实测出现过的占位写法（「先占位、稍后回填」的各种拼法）。
 * `placeholder2`…`placeholder5` 与 `placeholder-will-retry` 是用户会话里的原样取值。
 */
const OBSERVED_STUBS = [
  'placeholder',
  'placeholder2',
  'placeholder3',
  'placeholder4',
  'placeholder5',
  'placeholder-will-retry',
  'placeholder.png',
  'to-be-filled-later',
  '占位',
  '占位1',
  '待补充',
  'TODO',
  'todo',
  'xxx',
  'test',
  'test.png',
]

/**
 * **合法**句柄/地址（都真实出现过或形态真实）。这些一个都不许中 ——
 * 误判的代价是拦住合法调用，比漏判严重得多。
 */
const LEGIT_VALUES = [
  '@ref[女主]',
  '@ref[分镜 1 · 特写]',
  'img_01287_.png',
  'z-image_00031_.png',
  'boogu_01.png',
  'MiniMax_H3_ref2va_00020_.mp4',
  'https://cdn.example.com/a/b.jpg',
  '003417_3c9d17f42a422dda0ec24d673f0a35b9.jpg',
  // 画布节点 id（uuid 形态）与极短合法值：短不是占位
  '9f1c4b2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  'p1',
  '1',
  '无',
  '8 镜',
  'C major',
  'zh',
  '分镜 1 · 特写',
  // 剥掉文件后缀后还剩汉字/字母 ⇒ 放行（这一条正是「剥完只允许剩数字」换来的）
  '女主.png',
  '音乐.png',
]

test('占位判定：实测形态全部命中', () => {
  for (const stub of OBSERVED_STUBS) {
    const reason = placeholderParamReason(stub)
    assert.notEqual(reason, null, `应判为占位：${JSON.stringify(stub)}`)
    assert.ok(reason.length > 0, '原因不得为空串（要能直接拼进给模型的报错）')
  }
})

test('占位判定：合法句柄 / 地址一个都不许中', () => {
  for (const value of LEGIT_VALUES) {
    assert.equal(
      placeholderParamReason(value),
      null,
      `合法取值被误判为占位：${JSON.stringify(value)}（误判会拦住正常调用）`,
    )
  }
})

test('占位判定：短值不因「短」被判占位（那把尺子只属于 write_script 侧）', () => {
  // `isPlaceholderOnlyText`（载入清洗用）会把 1–2 字符的串判成「只有占位词」，
  // 那把尺子**不能**拿来判入参 —— 合法标识符可以极短。这条用例把这个分叉钉住：
  // 谁把入参判定改成调用 isPlaceholderOnlyText，这里立刻变红。
  assert.equal(placeholderParamReason('无'), null)
  assert.equal(placeholderParamReason('8 镜'), null)
  assert.equal(placeholderParamReason('p1'), null)
  assert.equal(placeholderParamReason(''), null)
  assert.equal(placeholderParamReason(undefined), null)
})

test('占位判定：已知漏判（刻意取舍，不是回归）', () => {
  // 「占位图.png」剥掉后缀只剩「图」——不是纯数字 ⇒ 放行。这是「剥完只允许剩数字」
  // 的代价：放宽成「剥完只剩 1–2 个任意字符」虽然能捞到它，但会同时把「音乐.png」
  // 这类**合法中文文件名**误判成占位。取舍方向固定：宁漏判，不误判。
  assert.equal(placeholderParamReason('占位图.png'), null)
})

test('参数分类表：全部工具的实际参数名都已被归类（新参数不得静默溜过）', () => {
  const tools = [...createStudioTools({}, 3000), ...createPlaceholderTools()]
  const actual = new Set()
  for (const tool of tools) {
    // `defineTool` 会把扁平参数表**归一成 JSON Schema**（`{type,properties,required}`）
    // ⇒ 生产与测试看到的都是 `properties` 里的名字。这里刻意自己再写一遍取名字
    // （不从源码 import 那个 helper），这样「归一形态认错了」时本用例才会红。
    for (const name of Object.keys(tool.parameters?.properties ?? tool.parameters ?? {})) actual.add(name)
  }
  const classified = classifiedParamNames()
  const known = new Set([...classified.handle, ...classified.prose, ...classified.exempt])

  const unclassified = [...actual].filter((name) => !known.has(name))
  assert.deepEqual(
    unclassified,
    [],
    `以下入参没有归类：必须判明它是「句柄类」「自由文本」还是「豁免」，`
    + `并在 src/param-guard.ts 里写明理由（豁免也要理由）：\n${unclassified.join('、')}`,
  )

  const stale = [...known].filter((name) => !actual.has(name))
  assert.deepEqual(stale, [], `分类表里这些参数名已不存在于任何工具（改名或删除后忘了同步）：\n${stale.join('、')}`)
})

test('参数分类表：豁免必须写明原因，且分类查询与三张表一致', () => {
  const classified = classifiedParamNames()
  for (const name of classified.exempt) {
    const reason = exemptReasonOf(name)
    assert.ok(
      typeof reason === 'string' && reason.length > 0,
      `豁免参数「${name}」没写原因 —— 豁免必须逐条说明「为什么本守卫管不了它」`,
    )
  }
  for (const name of classified.handle) assert.equal(paramClassOf(name), 'handle', name)
  for (const name of classified.prose) assert.equal(paramClassOf(name), 'prose', name)
  for (const name of classified.exempt) assert.equal(paramClassOf(name), 'exempt', name)
  assert.equal(paramClassOf('谁都没登记过的参数'), undefined)
})

test('findPlaceholderParam：句柄与自由文本两类都查，数组元素带下标', () => {
  const hit = findPlaceholderParam({ imageUrl: 'placeholder2' })
  assert.equal(hit?.name, 'imageUrl')
  assert.equal(hit?.cls, 'handle')

  const arrayHit = findPlaceholderParam({ filenames: ['@ref[女主]', 'placeholder3'] })
  assert.equal(arrayHit?.where, 'filenames[1]', '数组里第几个元素被拒要说清楚')
  assert.equal(arrayHit?.value, 'placeholder3')

  // 自由文本：同一个坏习惯在 prompt / 剧本表上一样会犯
  assert.equal(findPlaceholderParam({ prompt: 'placeholder' })?.name, 'prompt')
  assert.equal(findPlaceholderParam({ storyboard: '占位' })?.name, 'storyboard')

  // 合法入参一律放行
  assert.equal(findPlaceholderParam({ filename: '@ref[女主]', prompt: '雨夜霓虹街道，写实风格' }), null)
  // 非字符串与空数组不是本判定的管辖范围（缺参由 CS-PARAM-001 报）
  assert.equal(findPlaceholderParam({ clipIds: [], duration: 5, generateAudio: true }), null)
  assert.equal(findPlaceholderParam(undefined), null)
})

test('豁免真的免：枚举 / 布尔 / 数值 / 选题标签 / CV-217 专用通路都不拦', () => {
  // 「待定」是合法选项语义（暂不确定），拦它会把正常的点选题拒掉
  assert.equal(findPlaceholderParam({ options: ['待定', '暂无'] }), null)
  assert.equal(findPlaceholderParam({ provider: 'drama', irMode: 'T2VA' }), null)
  assert.equal(findPlaceholderParam({ budget: 2, duration: 5 }), null)
  // script / screenplay 由工具内部的 CV-217 专用守卫处理（那里的文案更具体）：
  // 中央守卫若也拦，会先抛通用文案、把更具体的纠正挤掉。
  assert.equal(findPlaceholderParam({ script: '占位' }), null)
  assert.equal(findPlaceholderParam({ screenplay: '占位' }), null)
})

test('入口拒收：命中占位时 execute 一次都不执行（零副作用）', async () => {
  let calls = 0
  const tool = wrapStudioToolDefinition({
    name: 'upload_image',
    description: 'x',
    parameters: { imageUrl: { type: 'string', required: true } },
    async execute() { calls += 1; return { filename: 'never' } },
  })

  await assert.rejects(
    () => tool.execute({ imageUrl: 'placeholder2' }, {}),
    (err) => {
      // 报错必须指名道姓：哪个工具的哪个参数、填了什么
      assert.equal(err.code, 'CS-PARAM-002')
      assert.match(err.message, /upload_image/)
      assert.match(err.message, /imageUrl/)
      assert.match(err.message, /placeholder2/)
      assert.match(err.message, /本次调用未执行/, '要说清「什么都没发生」，否则模型会以为已经落过盘')
      assert.ok(err.message.includes(PLACEHOLDER_PARAM_RULE), '错误文案与工具描述必须是同一句话')
      return true
    },
  )
  assert.equal(calls, 0, '拒收必须发生在 execute 之前 —— 否则白解析项目、白落节点、白发请求')

  // 反向对照：合法入参照常执行（守卫不得把正常路径一起挡掉）
  const ok = await tool.execute({ imageUrl: '@ref[女主]' }, {})
  assert.equal(calls, 1, '合法入参必须照常执行')
  assert.deepEqual(ok, { filename: 'never' })
})

test('入口拒收：数组参数里混入占位值也拦得住', async () => {
  let calls = 0
  const tool = wrapStudioToolDefinition({
    name: 'video_composite',
    description: 'x',
    parameters: { filenames: { type: 'array', required: true }, prompt: { type: 'string', required: true } },
    async execute() { calls += 1; return {} },
  })
  await assert.rejects(() => tool.execute({ filenames: ['@ref[女主]', 'placeholder4'], prompt: '雨夜' }, {}), /CS-PARAM-002|占位值/)
  assert.equal(calls, 0)
  await assert.rejects(() => tool.execute({ filenames: ['@ref[女主]'], prompt: 'placeholder' }, {}), /占位值/)
  assert.equal(calls, 0)
})

test('事前纪律：有句柄入参的工具挂上，没有的一个字都不加（双向）', () => {
  const withHandle = wrapStudioToolDefinition({
    name: 'upload_image',
    description: '原描述',
    parameters: { imageUrl: { type: 'string' } },
    async execute() { return {} },
  })
  assert.ok(withHandle.description.includes(PLACEHOLDER_PARAM_RULE), '有句柄入参就必须带事前纪律')

  const withoutHandle = wrapStudioToolDefinition({
    name: 'write_script',
    description: '原描述',
    parameters: { script: { type: 'string' } },
    async execute() { return {} },
  })
  assert.equal(withoutHandle.description, '原描述', '没有句柄入参的工具描述不得被挂上（否则每条描述白长一段）')

  // 判据必须从工具自己声明的参数现算
  assert.equal(toolNeedsPlaceholderRule({ filename: {} }), true)
  assert.equal(toolNeedsPlaceholderRule({ script: {}, options: {} }), false)
  assert.equal(toolNeedsPlaceholderRule(undefined), false)
  assert.equal(withPlaceholderParamRule({ description: 'd', parameters: { prompt: {} } }).description, 'd')
})

test('事前纪律：全体工具的描述挂载情况与「是否有句柄入参」完全一致', () => {
  const tools = [...createStudioTools({}, 3000), ...createPlaceholderTools()]
  const mismatched = []
  let carried = 0
  for (const tool of tools) {
    const wrapped = wrapStudioToolDefinition(tool)
    const needs = toolNeedsPlaceholderRule(tool.parameters)
    const has = typeof wrapped.description === 'string' && wrapped.description.includes(PLACEHOLDER_PARAM_RULE)
    if (needs) carried += 1
    if (needs !== has) mismatched.push(`${tool.name}: 需要=${needs} 实际=${has}`)
  }
  assert.deepEqual(mismatched, [], `描述挂载与参数分类不一致：\n${mismatched.join('\n')}`)
  assert.ok(carried >= 10, `带占位纪律的工具太少（${carried} 条），疑似有工具的句柄参数漏了分类`)
})

test('错误码：CS-PARAM-002 已登记、受众含 user、按对话面展示', () => {
  const spec = getErrorSpec('CS-PARAM-002')
  assert.notEqual(spec, undefined, '未登记会在运行时抛「未注册的错误码」这个开发期错误')
  assert.ok(spec.audience.includes('user'), '这条文案是可读可行动的，用户该看到')
  assert.ok(spec.audience.includes('agent'), '模型要据此改参数，必须看到')
  assert.equal(codeIsUserFacing('CS-PARAM-002'), true)
  const action = routeError(new CanvasStudioError(spec), { devMode: false })
  assert.equal(action.kind, 'surface')
  assert.equal(action.channel, 'conversation')
})

test('错误文案：三个占位符都要被真实值填上（不许出现裸 {param} 给用户看）', () => {
  const err = (() => {
    try {
      assertNoPlaceholderParams('upload_image', { imageUrl: 'placeholder2' })
      return null
    } catch (cause) {
      return cause
    }
  })()
  assert.notEqual(err, null)
  assert.ok(!/\{\w+\}/.test(err.message), `文案里还留着未替换的模板变量：${err.message}`)
})

test('错误文案：超长取值要截断（模型可能把整段正文塞进句柄参数）', () => {
  // 破折号会被 compact 剥掉，所以这串压下来仍是 `placeholder2`（命中），
  // 但**回显**用的原始取值有 400 多个字符 —— 正是要截断的情形。
  const long = `placeholder-${'-'.repeat(400)}2`
  const hit = findPlaceholderParam({ filename: long })
  assert.notEqual(hit, null)
  assert.ok(hit.value.length > 60, '前提：取值确实很长')
  const err = (() => {
    try {
      assertNoPlaceholderParams('character_sheet', { filename: long })
      return null
    } catch (cause) {
      return cause
    }
  })()
  assert.ok(err.message.length < 1200, '回显必须截断，否则一条报错就能刷屏')
  assert.ok(err.message.includes('…'), '截断要留痕迹，不能看起来像完整值')
})
