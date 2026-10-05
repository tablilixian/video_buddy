/**
 * auto-test-report 报告构造单测（node:test 直连 lib 纯函数）。
 *
 * 钉住执行日志落盘节（P0-a）：「## 执行日志（浮窗留痕）」逐行 = UTC 时钟 + 文本，
 * fail 行显式标注 [FAIL] —— 报告自包含后，排障不再依赖去翻会话转录（R001 实证）。
 * 另钉 BUG-015 同源口径：产物索引的小写 qwen 产物名（QWEN_TEXT_RENDER_PREFIX）
 * 不得漏。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAutoTestReport } from '../lib/auto-test-report.js'

const T0 = Date.parse('2026-10-05T10:04:44.000Z')

function reportInput(overrides = {}) {
  return {
    scenarioId: 'shangu-chenguang-15s',
    scenarioLabel: '《山谷晨光》15s 全链',
    scenarioVersion: 1,
    round: 'R001',
    projectName: '效果验证-R001-山谷晨光',
    projectDir: '/root/projects/效果验证-R001-山谷晨光',
    startedAt: T0,
    finishedAt: T0 + 49 * 60_000,
    appVersion: 'canvas-studio client (dev)',
    effective: { aspectRatio: '16:9', videoProvider: 'drama', imageResolution: '736p', videoResolution: '480p' },
    results: [
      { turn: 0, id: 'videos-active', label: '镜位视频 = 3 且全部 active', pass: true, evidence: '视频 3 条' },
    ],
    snapshots: {
      project: {
        id: 'p-1',
        name: '效果验证-R001-山谷晨光',
        createdAt: '2026-10-05T10:00:00.000Z',
        updatedAt: '2026-10-05T10:20:00.000Z',
        dir: '/root/projects/效果验证-R001-山谷晨光',
      },
      nodes: [
        {
          id: 'poster-1', kind: 'image', url: '/canvas-studio/assets/p-1/poster', x: 0, y: 0,
          width: 260, height: 228, createdAt: 1, origin: 'agent', sourceIds: [],
          toolName: 'image_generate', filename: 'qwen_image_2.1_00060.png',
        },
      ],
      history: [],
      queue: { active: null, waiting: [], resumedJobs: 0 },
      expectedImageResolution: '736p',
      expectedVideoResolution: '480p',
    },
    sentTurns: ['拍一条 15 秒……'],
    ...overrides,
  }
}

test('执行日志落盘：逐行时钟 + 文本，fail 行标注 [FAIL]', () => {
  const markdown = buildAutoTestReport(reportInput({
    logs: [
      { at: T0 + 1_000, text: '项目已创建：效果验证-R001-山谷晨光（放手跑模式）', kind: 'info' },
      { at: T0 + 2_000, text: '[FAIL] 镜位视频 = 3（实际 0）', kind: 'fail' },
      { at: T0 + 3_000, text: '执行中断：等待 agent 回合结束超时', kind: 'fail' },
    ],
  }))
  assert.ok(markdown.includes('## 执行日志（浮窗留痕）'), '报告必须含执行日志节')
  const section = markdown.slice(markdown.indexOf('## 执行日志'), markdown.indexOf('## 创作过程留档'))
  assert.ok(section.includes('- 10:04:45 项目已创建：效果验证-R001-山谷晨光（放手跑模式）'), `info 行 = 时钟 + 文本：${section}`)
  assert.ok(section.includes('- 10:04:46 [FAIL] 镜位视频'), '文本自带 [FAIL] 的断言行不重复标注')
  assert.ok(section.includes('- 10:04:47 [FAIL] 执行中断'), '非断言类失败（执行中断）必须被标注')
})

test('旧调用方兼容：不传 logs 不输出执行日志节（报告其余结构不变）', () => {
  const markdown = buildAutoTestReport(reportInput())
  assert.equal(markdown.includes('## 执行日志（浮窗留痕）'), false)
  assert.ok(markdown.includes('## 机器断言'))
  assert.ok(markdown.includes('## 产物索引'))
  assert.ok(markdown.includes('## 创作过程留档'))
  assert.ok(markdown.includes('## 内容评估指引'))
})

test('BUG-015 同源：产物索引认识小写 qwen 产物名（QWEN_TEXT_RENDER_PREFIX 唯一实现）', () => {
  const markdown = buildAutoTestReport(reportInput())
  assert.ok(
    markdown.includes('- 海报（Qwen 含字链路）：/canvas-studio/assets/p-1/poster · qwen_image_2.1_00060.png'),
    `小写 qwen 产物名必须出现在产物索引：${markdown.slice(markdown.indexOf('## 产物索引'), markdown.indexOf('## 创作过程留档'))}`,
  )
})
