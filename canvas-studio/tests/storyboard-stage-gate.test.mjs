/**
 * CV-304（REQ-022 评审 SB-03 + SB-04）**阶段门禁守卫**：故事板整体重写只准发生在规划期。
 *
 * 两条缺陷同批修，因为它们是同一条门禁的两半：守卫漏了一个态（`keyframe_review`），
 * 而仅有的那句拒绝文案又指路到**不存在的工具**（`revise_storyboard`，REQ-022 P2 才有）。
 * 只收紧守卫会造出「新拦住的 agent 被指进死胡同」，只改文案则挡不住整体重写 ——
 * 所以一个测试文件覆盖两面。
 *
 * 与 `workflow-gate.test.mjs` 同一套手法：**驱动真实工具**（`lib/host-tools.js` +
 * 假 registry），不写字符串级「判定在不在」的软断言 —— 门禁的价值就是拦得住，
 * 拦不住的实现再好看也没用。反向变异验证过（把守卫写回 `=== 'executing'` → 用例②变红）。
 *
 * 运行：corepack yarn test:smoke（需先 build：corepack yarn build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioTools } from '../lib/host-tools.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 剥掉注释再读源码 —— 注释里的示例会把接线断言喂饱。 */
function sourceOf(relative) {
  return readFileSync(join(SRC_DIR, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

const cfg = {
  dramaApiBase: () => 'http://localhost:9999',
  maxVideoSeconds: () => 15,
  resolveDramaApiKey: async () => 'fake',
  resolveFalApiKey: async () => '',
  defaultAspectRatio: () => '16:9',
  defaultVideoProvider: () => 'drama',
  workflowMode: () => 'confirm',
  hitlStoryboard: () => true,
  hitlKeyframe: () => false,
  autoRetry: () => true,
  maxParallel: () => 2,
  assetDir: () => '',
  autoSave: () => true,
  autoSaveInterval: () => 30,
}

/** 只用到 `storyboardFile()` + `getProject()` 的最小 registry 替身（与 store 测试同款）。 */
function makeRegistry({ workflow, dir }) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir,
    createdAt: '1',
    updatedAt: '1',
    ...(workflow === undefined ? {} : { workflow }),
  }
  return {
    list: async () => [project],
    getProject: async () => project,
    storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
    _project: project,
  }
}

const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => {},
})

async function runTool(tools, name, args, cwd) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool.execute(args, EXEC(cwd))
}

/** 首稿最小入参（§00 + meta 就够落盘；完成度只报不拦）。 */
const FIRST_WRITE = {
  title: '《雨夜来信》',
  meta: JSON.stringify({ genre: '民国悬疑', targetDuration: 30, aspect: '16:9' }),
  creative: JSON.stringify({ brief: '门外的人一直在等' }),
}

/** 建项目目录 + 假 registry + 工具集；用完删目录。 */
async function harness(initialWorkflow, body) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sbgate-'))
  try {
    const registry = makeRegistry({ workflow: initialWorkflow, dir })
    await body({ dir, registry, tools: createStudioTools(registry, 0, cfg) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('CV-304 ①：规划期（storyboarding）放行 —— 守卫只该锁住落地之后', async () => {
  await harness({ mode: 'confirm', state: 'storyboarding' }, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', FIRST_WRITE, dir)
    assert.match(result.text, /已落盘/u, '规划期必须能写故事板（这是阶段一的唯一正路）')
    assert.ok(existsSync(registry.storyboardFile('p1')), '规划期落盘必须真的写出 storyboard.json')
  })
})

test('CV-304 ②：keyframe_review 拒 —— 三态迁移漏掉的那个态（SB-03 的病灶）', async () => {
  await harness({ mode: 'confirm', state: 'keyframe_review' }, async ({ dir, registry, tools }) => {
    await assert.rejects(
      () => runTool(tools, 'write_storyboard', FIRST_WRITE, dir),
      /拍摄定稿|整体重写/u,
      'keyframe_review 期关键帧已是画布产物：整体重写故事板会让产物与规划当场失配，必须拒',
    )
    assert.equal(existsSync(registry.storyboardFile('p1')), false,
      '拒绝必须发生在落盘之前（零副作用，别先写后报错）')
  })
})

test('CV-304 ③：executing 拒 —— 落地后是单向终点，行为与本批之前一致', async () => {
  await harness({ mode: 'confirm', state: 'executing' }, async ({ dir, registry, tools }) => {
    await assert.rejects(
      () => runTool(tools, 'write_storyboard', FIRST_WRITE, dir),
      /拍摄定稿|整体重写/u,
    )
    assert.equal(existsSync(registry.storyboardFile('p1')), false, '拒绝必须零副作用')
  })
})

test('CV-304 ④：workflow 缺失（三态之前的老项目）保持放行 —— 不给存量项目造新红字', async () => {
  await harness(undefined, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', FIRST_WRITE, dir)
    assert.match(result.text, /已落盘/u, '老项目 workflow 缺失时不拦（迁移口径见契约 §3.1）')
    assert.ok(existsSync(registry.storyboardFile('p1')))
  })
})

test('CV-304 ⑤：拒绝文案不得指路到不存在的工具（SB-04 的判定面）', async () => {
  await harness({ mode: 'confirm', state: 'executing' }, async ({ dir, tools }) => {
    const error = await runTool(tools, 'write_storyboard', FIRST_WRITE, dir)
      .then(() => null, (cause) => cause)
    assert.ok(error, 'executing 态必须报错（这条用例只为检查文案）')
    const text = String(error.message ?? error)
    assert.doesNotMatch(text, /revise_storyboard/u,
      '`revise_storyboard` 全库无实现：文案提到它，agent 会去找一个查不到的工具、原地绕圈')
    assert.doesNotMatch(text, /结构修订通道|改用结构修订/u,
      '不许再许诺一条尚未上线的通道；只说事实 + 指出唯一出路（交回用户）')
    assert.match(text, /告诉用户/u, '被拦下时必须给 agent 一条真的走得通的路')
  })
})

test('CV-304 ⑥：源码里不许再留 `revise_storyboard` 的「现役工具」口吻（注释同罪）', () => {
  // 注释骗人已经骗过一轮评审（SB-04 正是这么来的），所以这条断言**不剥注释**：
  // 产品代码（含注释）里出现该名字，就必须明说它尚未实现。
  const hostTools = readFileSync(join(SRC_DIR, 'host-tools.ts'), 'utf8')
  assert.equal(/revise_storyboard/.test(sourceOf('host-tools.ts')), false,
    'host-tools.ts 的代码路径里不许出现 revise_storyboard（工具不存在）')
  assert.equal(/revise_storyboard/.test(hostTools), false,
    'host-tools.ts 连注释也不许提名它 —— 等它真上线再补回来')
  // 契约侧：允许提及，但必须带「尚未实现」的定性，否则下一个读它的人照样被误导。
  const contract = readFileSync(join(SRC_DIR, 'contracts/storyboard.ts'), 'utf8')
  if (/revise_storyboard/.test(contract)) {
    assert.match(contract, /revise_storyboard[\s\S]{0,200}?(尚未实现|未实现|排期)/u,
      '契约注释提到 revise_storyboard 时必须同时说明它尚未实现')
  }
})
