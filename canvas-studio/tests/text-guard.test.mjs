/**
 * CV-217：占位载荷守卫。
 *
 * ## 抓的是什么 bug
 *
 * 模型有「先落一个占位节点、稍后回填」的坏习惯。实测两次独立复现
 * （2026-09-20，qwen3.8-flash）：先发 `write_script {"script":"占位"}`，十几分钟
 * 后才发真实文案 —— 而 `write_script` 每次调用都 append 新节点，占位那张没人
 * 替换，永久留在画布上（用户反馈「经常会出现一个占位节点」）。
 *
 * 这一份守三件事，缺一件 bug 就会以另一种形态回来：
 *  ① **写入侧拒收**（`stubTextReason` + 两个工具真的 throw）——否则节点照样落盘；
 *  ② **载入侧清理**（`isStubTextNode` 接进 `setNodes`）——否则用户已有的画布
 *     上那批历史垃圾永远清不掉；光修写入等于只管新项目；
 *  ③ **事前提示**（两个工具的 description 带 `STUB_PAYLOAD_RULE`）——错误文案
 *     只在犯错那一刻出现，模型在没犯错时读不到「本工具不接受占位」。
 *
 * 读源码的静态断言一律剥注释：本文件的否定断言（「不得……」）恰好是注释里
 * 最容易出现的写法。只剥块注释与整行注释，不做行内剥除（`https://` 的 `//`
 * 长在行中间）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STUB_PAYLOAD_RULE,
  isPlaceholderOnlyText,
  isStubTextNode,
  stubPayloadMessage,
  stubTextReason,
} from '../lib/text-guard.js'
import { createStudioTools } from '../lib/host-tools.js'

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

/** 实测出现过的形态：整篇就是「占位」二字。 */
const OBSERVED_STUB = '占位'

/** 一份**合法**的成片文案（覆盖工具要求的五个构成）。 */
const VALID_SCRIPT = [
  '## 广告词',
  '「读武侠，走江湖，地坛书市十年后再见！」',
  '## 对白',
  '主持人：抓一位江湖大佬！',
  '摊主：大佬不敢当。',
  '## BGM',
  '轻快国风市井小调，108 BPM，铺底音量低于对白。',
  '## SFX',
  '集市人群低语、翻书沙沙声、手机扫码「滴」声。',
  '## 字幕',
  '无。',
].join('\n')

test('stubTextReason：占位类载荷全部命中（含实测原样 "占位"）', () => {
  const stubs = [
    OBSERVED_STUB,
    '占位。',
    '（占位）',
    ' 占位 ',
    '**占位**',
    '- 占位',
    '占位文案',
    '占位内容待补充',
    '待补充',
    '待填',
    'TODO',
    'todo',
    'placeholder',
    'xxx',
    '',
    '   ',
  ]
  for (const stub of stubs) {
    assert.notEqual(stubTextReason(stub), null, `应判为占位：${JSON.stringify(stub)}`)
  }
  // 原因文案要能直接拼进给模型的错误里，不能是空串
  for (const stub of stubs) {
    assert.ok(stubTextReason(stub).length > 0, '原因不得为空串')
  }
})

test('stubTextReason：真实文案不误伤 —— 包括正文里出现「占位」二字的叮嘱', () => {
  const legit = [
    VALID_SCRIPT,
    '## 广告词\n「砍价先出招，买单不赊账。」\n## 对白\n无（单镜无对白，仅环境声）\n## BGM\n无\n## SFX\n石板路脚步声',
    // 承重用例：真实文案里**提到**占位词是合法的，口径是「整篇级」而非「包含级」
    '## 备注\n写文案时不要写「占位」这类占位词，画布上显示的就是你写的字。\n## 广告词\n「少侠，扫码还是现金？」',
    '## 字幕\n无字幕，对白以原生语音呈现。',
  ]
  for (const text of legit) {
    assert.equal(stubTextReason(text), null, `不应判为占位：${JSON.stringify(text.slice(0, 30))}…`)
  }
})

test('isPlaceholderOnlyText：比写入守卫更窄 —— 空内容不算占位（用户清空的卡不删）', () => {
  assert.equal(isPlaceholderOnlyText(OBSERVED_STUB), true)
  assert.equal(isPlaceholderOnlyText('占位内容待补充'), true)
  assert.equal(isPlaceholderOnlyText('（占位）'), true)
  // 载入侧是真删节点，用户把卡清空 / 改短属于「过短」档但不算占位 —— 必须放行
  assert.equal(isPlaceholderOnlyText(''), false, '用户清空的卡不能被静默删除')
  assert.equal(isPlaceholderOnlyText('   '), false)
  assert.equal(isPlaceholderOnlyText('无对白'), false, '「过短」只在写入侧拦，不在载入侧删')
  assert.equal(isPlaceholderOnlyText(VALID_SCRIPT), false)
})

test('isStubTextNode：只认 agent 写的「文案 / 剧本」文本节点', () => {
  const base = {
    id: 'n1',
    kind: 'text',
    text: OBSERVED_STUB,
    x: 0,
    y: 0,
    width: 360,
    height: 280,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    toolName: 'write_script',
  }
  assert.equal(isStubTextNode(base), true, '实测的那张卡必须被判出')
  assert.equal(isStubTextNode({ ...base, toolName: 'write_screenplay' }), true, '剧本同罪')
  assert.equal(
    isStubTextNode({ ...base, origin: 'manual' }),
    false,
    '用户手动建的卡是用户自己的笔迹，不许删',
  )
  assert.equal(isStubTextNode({ ...base, toolName: 'user_brief' }), false, '别的工具不归它管')
  assert.equal(isStubTextNode({ ...base, kind: 'image' }), false, '非文本节点不归它管')
  assert.equal(isStubTextNode({ ...base, text: VALID_SCRIPT }), false)
})

/** 建一个够 write_script / write_screenplay 跑通的 registry + exec 夹具。 */
function harness({ nodes = [] } = {}) {
  const writes = []
  const appends = []
  // cwd 必须落在 project.dir 之内，否则 resolveProjectId 会先抛「未绑定项目」，
  // 占位守卫就被绕过去了（测试会变成假绿/假红）。
  const projectDir = '/tmp/cs-text-guard-proj'
  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: projectDir, createdAt: '1', updatedAt: '1' }],
    getProject: async () => ({ id: 'p1', workflow: { mode: 'confirm', state: 'drafting' } }),
    readCanvas: async () => ({ version: 3, nodes }),
    updateWorkflow: async (projectId, patch) => ({ id: projectId, workflow: { mode: 'confirm', ...patch } }),
    writeCanvas: async (_projectId, next) => { writes.push(...next) },
    appendCanvasNode: async (_projectId, node) => { appends.push(node) },
  }
  const exec = {
    agent: { session: { header: { cwd: projectDir } } },
    signal: AbortSignal.timeout(5000),
    concludeTurn: () => {},
  }
  return { registry, exec, writes, appends }
}

test('真跑 write_script：占位载荷被拒收，且一个节点都不落盘', async () => {
  const h = harness()
  const tools = createStudioTools(h.registry, 3000)
  const script = tools.find((tool) => tool.name === 'write_script')
  await assert.rejects(
    () => script.execute({ script: OBSERVED_STUB }, h.exec),
    /文案未落盘/,
    '实测的那种载荷必须被拒收',
  )
  assert.equal(h.appends.length, 0, '拒收的调用不得留下节点 —— 这才是 bug 的止血点')
  assert.equal(h.writes.length, 0)
})

test('真跑 write_script：正常文案照常落盘（拒收不得把正常路径一起挡掉）', async () => {
  const h = harness()
  const tools = createStudioTools(h.registry, 3000)
  const script = tools.find((tool) => tool.name === 'write_script')
  const result = await script.execute({ script: VALID_SCRIPT }, h.exec)
  assert.equal(h.appends.length, 1, '正常文案必须照常落盘')
  assert.equal(h.appends[0].text, VALID_SCRIPT, '落盘内容不得被守卫改写')
  assert.match(result.text, /文案已落到画布/)
})

test('真跑 write_screenplay：占位载荷被拒收，且不覆盖已有剧本', async () => {
  const existing = {
    id: 'sp1',
    kind: 'text',
    title: '剧本',
    text: '# 剧本\n三幕三镜',
    x: 0,
    y: 0,
    width: 360,
    height: 280,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    toolName: 'write_screenplay',
  }
  const h = harness({ nodes: [existing] })
  const tools = createStudioTools(h.registry, 3000)
  const screenplay = tools.find((tool) => tool.name === 'write_screenplay')
  await assert.rejects(
    () => screenplay.execute({ screenplay: OBSERVED_STUB }, h.exec),
    /剧本未落盘/,
  )
  assert.equal(h.writes.length, 0, '剧本是原地更新 —— 占位一旦放行会把真剧本覆盖成两个字')
  assert.equal(h.appends.length, 0)
})

test('接线：两个写入工具的 description 必须带事前纪律（模型在没犯错时也要读到）', () => {
  const src = codeOnly(readSource('../src/host-tools.ts'))
  for (const tool of ['write_script', 'write_screenplay']) {
    const at = src.indexOf(`name: '${tool}'`)
    assert.notEqual(at, -1, `${tool} 工具必须存在`)
    // 取该工具定义起的一段，断言其 description 引用了共享常量（而非各自抄一份文案）
    const segment = src.slice(at, at + 2000)
    assert.ok(
      segment.includes('STUB_PAYLOAD_RULE'),
      `${tool} 的 description 必须挂 STUB_PAYLOAD_RULE（唯一源，防两处措辞漂移）`,
    )
  }
  assert.ok(STUB_PAYLOAD_RULE.includes('必须一次写完整'), '纪律句要给出正确做法而不只是禁令')
})

test('接线：错误文案复用同一句纪律，且带上「没准备好就别调」的出路', () => {
  const message = stubPayloadMessage('文案', '广告词 / 对白 / BGM / SFX / 字幕', '内容为空')
  assert.ok(message.includes(STUB_PAYLOAD_RULE), '错误文案与工具描述必须说同一件事')
  assert.ok(message.includes('文案未落盘'), '要明确「什么都没落」')
  assert.ok(message.includes('不要调用'), '要给出路：没准备好就别调，而不是逼模型编内容')
  assert.ok(message.includes('广告词 / 对白 / BGM / SFX / 字幕'), '要说清该写什么')
})

test('接线：客户端载入清洗必须真的过滤占位节点（光修写入只管新项目）', () => {
  const src = codeOnly(readSource('../src/client/project-store.ts'))
  assert.match(
    src,
    /import\s*\{[^}]*isStubTextNode[^}]*\}\s*from\s*'\.\.\/text-guard\.js'/,
    'project-store 必须从 text-guard 引入判定（不得自己再写一份）',
  )
  // 锚实现签名而不是裸 'setNodes:' —— 后者会先命中接口里的类型声明（:170），
  // 那段里当然没有过滤逻辑，断言会假红。
  const at = src.indexOf('setNodes: (draft, projectId, nodes)')
  assert.notEqual(at, -1, 'setNodes 是读盘唯一入口')
  const segment = src.slice(at, at + 900)
  assert.ok(
    segment.includes('isStubTextNode(node)'),
    'setNodes 的载入清洗必须把占位节点滤掉 —— 否则历史画布上的垃圾卡永远清不掉',
  )
  assert.ok(segment.includes('isTransientNode(node)'), '原有的瞬态清洗不得被这次改动挤掉')
  assert.ok(segment.includes('normalizeGroupBoxes(clean)'), '原有的托盘几何规范化不得被挤掉')
})
