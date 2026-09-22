/**
 * CV-230 视频理解（`video2vl`）提示词与工具行为契约。
 *
 * 这一轮的重点**不是**「端点通不通」（探针已证：`docs/api-probe/video2vl-20260922/`），
 * 而是**输出质量靠什么保证**：后端同事按 Qwen3-VL 实际表现调过的
 * 「角色设定 + 九项字段 + 直接输出收口」必须**原样抵达请求体**。让模型照抄长模板必漂移，
 * 所以模板固化在 `src/video-analysis.ts`，工具侧只暴露 `mode` 开关，本文件守住三件事：
 *
 * 1. 常量内容（九项字段 + 收口句 + 角色设定）齐备 —— 防有人「顺手简化」模板；
 * 2. **默认模式发出的 prompt 就是那段模板**（逐字节），`free` 模式才原样发用户问题；
 * 3. 工具描述里写明「不要自己重写模板」与两种模式 —— 描述每回合都在上下文里，
 *    它是模型唯一能读到的用法说明。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioTools } from '../lib/host-tools.js'
import {
  VIDEO_ANALYST_SYSTEM_PROMPT,
  VIDEO_SHOT_BREAKDOWN_PROMPT,
  VIDEO_SHOT_BREAKDOWN_FOCUS_PREFIX,
} from '../lib/video-analysis.js'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 最小注册表桩：本文件只关心「发出去的请求体」，不碰画布与资产。 */
function stubRegistry() {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: '/tmp', createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => '/tmp',
    readCanvas: async () => ({ version: 4, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
  }
}

/** 捕获 video2vl 的请求体；respond 决定响应。 */
function stubVideo2vl(respond = () => ({ status: 200, json: { output: '分析结果' } })) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url)
    if (!href.includes('/generate/video2vl')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => new Uint8Array() }
    }
    const body = JSON.parse(init.body)
    calls.push(body)
    const spec = respond()
    return {
      ok: spec.status < 400,
      status: spec.status,
      json: async () => spec.json ?? {},
      text: async () => spec.text ?? '',
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const EXEC = { agent: { session: { header: { cwd: '/tmp' } } }, signal: AbortSignal.timeout(5000) }
const V2VL = (registry) => createStudioTools(registry, 3005).find((t) => t.name === 'video2vl')

test('CV-230 常量：角色设定是「电影分镜分析设计师」，模板含九项字段与收口句', () => {
  assert.match(VIDEO_ANALYST_SYSTEM_PROMPT, /分镜分析/u, 'system prompt 必须锚定分镜分析岗位')
  assert.match(VIDEO_ANALYST_SYSTEM_PROMPT, /电影/u)
  // 九项字段：缺任何一项，输出就会退化成「泛泛的剧情复述」
  for (const field of ['时间点', '主体画面内容', '运镜方式', '镜头作用', '运动节奏', '人物与关键物件', '景别', '音效', '切换分镜']) {
    assert.ok(VIDEO_SHOT_BREAKDOWN_PROMPT.includes(field), `模板缺少字段：${field}`)
  }
  // 收口句：没有它，模型会在结果里夹「备注 / 建议」，直接污染下游写 prompt 的输入
  assert.match(VIDEO_SHOT_BREAKDOWN_PROMPT, /直接输出分析结果/u)
  assert.match(VIDEO_SHOT_BREAKDOWN_PROMPT, /不要任何注释/u)
})

test('CV-230 默认模式：不传 prompt 时，发出去的就是官方模板（逐字节）', async () => {
  const { calls, restore } = stubVideo2vl()
  try {
    const tool = V2VL(stubRegistry())
    await tool.execute({ video: 'ref-abc123.mp4' }, EXEC)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].prompt, VIDEO_SHOT_BREAKDOWN_PROMPT, '默认模式必须是模板原文，不能是模型自己写的版本')
    assert.equal(calls[0].system_prompt, VIDEO_ANALYST_SYSTEM_PROMPT, 'system_prompt 缺省即官方角色设定')
    assert.equal(calls[0].video, 'ref-abc123.mp4', '句柄原样透传')
  } finally {
    restore()
  }
})

test('CV-230 shot-breakdown + 额外关注点：模板在前、关注点作末行附句', async () => {
  const { calls, restore } = stubVideo2vl()
  try {
    const tool = V2VL(stubRegistry())
    await tool.execute({ video: 'ref-abc123.mp4', prompt: '尤其注意转场方式' }, EXEC)
    assert.equal(calls[0].prompt, `${VIDEO_SHOT_BREAKDOWN_PROMPT}\n${VIDEO_SHOT_BREAKDOWN_FOCUS_PREFIX}尤其注意转场方式`)
    assert.ok(calls[0].prompt.startsWith(VIDEO_SHOT_BREAKDOWN_PROMPT), '模板必须完整保留在前')
  } finally {
    restore()
  }
})

test('CV-230 free 模式：prompt 原样发出（不套模板）；缺 prompt 明确报错', async () => {
  const { calls, restore } = stubVideo2vl()
  try {
    const tool = V2VL(stubRegistry())
    await tool.execute({ video: 'ref-abc123.mp4', mode: 'free', prompt: '这段片子的运镜适合参考吗？' }, EXEC)
    assert.equal(calls[0].prompt, '这段片子的运镜适合参考吗？')
    assert.equal(calls[0].system_prompt, VIDEO_ANALYST_SYSTEM_PROMPT, 'free 模式仍用官方角色设定做缺省')

    await assert.rejects(
      () => tool.execute({ video: 'ref-abc123.mp4', mode: 'free' }, EXEC),
      /mode=free 必须提供 prompt/u,
      'free 模式缺 prompt 必须报可操作的错，而不是发一个空问题',
    )
    assert.equal(calls.length, 1, '报错时不应发出请求')
  } finally {
    restore()
  }
})

test('CV-230 工具描述：写明两种模式与「不要自己重写模板」', () => {
  const src = readFileSync(join(PKG_ROOT, 'lib', 'host-tools.js'), 'utf8')
  // 锚点取「工具定义本身」而不是首次出现（首处是 import 行），终点取下一个 defineTool ——
  // 编译产物的缩进/引号形态会变，不写死空格数（CV-215 同款教训）。
  const start = src.indexOf("name: 'video2vl'")
  assert.ok(start >= 0, 'lib/host-tools.js 里应能找到 video2vl 的工具定义')
  const next = src.indexOf('defineTool({', start)
  const block = src.slice(start, next > start ? next : start + 5000)
  assert.match(block, /不要自己重写这段模板/u, '描述必须阻止模型照抄/重写模板')
  assert.match(block, /VIDEO_SHOT_BREAKDOWN_PROMPT/u, '描述必须引用常量，而不是内联一份副本（副本必漂移）')
  assert.match(block, /VIDEO_ANALYST_SYSTEM_PROMPT/u, 'system prompt 缺省必须走常量')
  assert.match(block, /shot-breakdown/u)
  assert.match(block, /free/u)
})
