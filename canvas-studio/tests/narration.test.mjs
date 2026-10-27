/**
 * 多段旁白批量合成（`src/narration.ts`）的编排守卫。
 *
 * ## 抓的是三种「静默错」
 *
 * 批量合成里最贵的错误都不报错，只是结果不对：
 *  ① **锚没传下去**：每段各抽一个音色（实测同一 instruct 连发 3 次基频极差 45%），
 *     听感上像换了三个人在念，画布上却一切正常；
 *  ② **锚传了但传错**：第一段带参考音（它自己还没有锚）、后面不带（等于没锚）；
 *  ③ **失败后不留证据**：第 3 段挂了直接上抛「网络错误」，模型看不到前 2 段已花掉的
 *     额度，下一步必然整批重跑。
 *
 * 所以这里用一个**假合成器**（固定时长、记录每次入参）把「谁带了哪个 refaudio」
 * 与「失败时报错里有没有已完成节点」逐条钉死 —— 不碰网络、不碰 ffprobe。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateNarration } from '../lib/narration.js'
import { MAX_NARRATION_LINES } from '../lib/voice-timeline.js'

/**
 * 假合成器：第 i 段返回 `aud_<i+1>`、时长取 `durations[i]`、URL 用同源形态。
 * `calls` 记录每次真实入参（断言锚与 instruct 的传递）。
 */
function fakeDeps(durations, options = {}) {
  const calls = []
  let seq = 0
  return {
    calls,
    deps: {
      async synthesize(params) {
        calls.push(params)
        const index = seq
        seq += 1
        if (options.failAt === index) throw new Error(options.failMessage ?? 'boom')
        const nodeId = `aud_${index + 1}`
        const duration = durations[index] ?? 1
        return {
          url: `/canvas-studio/assets/p1/${nodeId}.mp3`,
          filename: `voxcpm_${index + 1}.mp3`,
          nodeId,
          duration,
          text: params.text,
          ...(index === 0 && options.warn === true ? { warnings: ['语速被夹到 0.5'] } : {}),
        }
      },
      async resolveHandle(nodeId) {
        return `handle-of-${nodeId}`
      },
    },
  }
}

test('锚：不给 voice.refaudio 时拿第一段当锚，后续每段都带同一个句柄', async () => {
  const { calls, deps } = fakeDeps([2, 1, 1.5])
  const result = await generateNarration(deps, {
    lines: [{ text: '一' }, { text: '二' }, { text: '三' }],
    voice: { instructPrompt: '30岁女性，低沉，普通话' },
    fps: 30,
  })

  assert.equal(calls[0].refaudio, undefined, '第一段自己还没有锚，不能带 refaudio')
  assert.equal(calls[1].refaudio, 'handle-of-aud_1', '第二段必须克隆第一段')
  assert.equal(calls[2].refaudio, 'handle-of-aud_1', '第三段用**同一个**句柄（不是第二段的）')
  assert.equal(result.anchorSource, 'first-line')
  assert.equal(result.anchorNodeId, 'aud_1')

  // instruct 全片一份，逐段一致（不许每段各写一个声音设计）
  assert.deepEqual(calls.map((call) => call.instructPrompt), ['30岁女性，低沉，普通话', '30岁女性，低沉，普通话', '30岁女性，低沉，普通话'])
})

test('锚：给了 voice.refaudio 时每段（含第一段）都用它', async () => {
  const { calls, deps } = fakeDeps([1, 1])
  const result = await generateNarration(deps, {
    lines: [{ text: '一' }, { text: '二' }],
    voice: { refaudio: 'ref-anchor-handle' },
    fps: 30,
  })
  assert.deepEqual(calls.map((call) => call.refaudio), ['ref-anchor-handle', 'ref-anchor-handle'])
  assert.equal(result.anchorSource, 'given')
  assert.equal(result.anchorNodeId, 'aud_1', 'given 时锚节点仍报第一段产物（画布上能定位）')
})

test('instruct：段级覆盖整片设定，未写的段落落在整片设定上', async () => {
  const { calls, deps } = fakeDeps([1, 1, 1])
  await generateNarration(deps, {
    lines: [{ text: '一' }, { text: '二（耳语）', instructPrompt: '同一个女人，耳语' }, { text: '三' }],
    voice: { instructPrompt: '30岁女性，低沉' },
    fps: 30,
  })
  assert.deepEqual(calls.map((call) => call.instructPrompt), ['30岁女性，低沉', '同一个女人，耳语', '30岁女性，低沉'])
})

test('排期：voiceOver 的 src 是同源 URL、startFrame 由真值算出（不是模型手算）', async () => {
  const { deps } = fakeDeps([2, 1, 1.5])
  const result = await generateNarration(deps, {
    lines: [{ text: '一' }, { text: '二' }, { text: '三' }],
    fps: 30,
  })
  // 2s→60 帧、1s→30 帧、1.5s→45 帧；gap 0.4s=12 帧
  assert.deepEqual(result.voiceOver, [
    { src: '/canvas-studio/assets/p1/aud_1.mp3', startFrame: 0 },
    { src: '/canvas-studio/assets/p1/aud_2.mp3', startFrame: 72 },
    { src: '/canvas-studio/assets/p1/aud_3.mp3', startFrame: 114 },
  ])
  assert.deepEqual(result.clips.map((clip) => clip.endFrame), [60, 102, 159])
  assert.equal(result.totalFrames, 159)
  assert.equal(result.fps, 30)
})

test('失败：第 2 段挂掉时报错必须点名已完成节点并禁止整批重跑', async () => {
  const { deps } = fakeDeps([1, 1], { failAt: 1, failMessage: '后端 500' })
  await assert.rejects(
    () => generateNarration(deps, { lines: [{ text: '一' }, { text: '二' }], fps: 30 }),
    (error) => {
      assert.match(error.message, /第 2\/2 段失败/u, '要点名第几段')
      assert.match(error.message, /后端 500/u, '要带真实原因')
      assert.match(error.message, /已落画布且额度已花/u, '要讲清额度已花')
      assert.match(error.message, /aud_1/u, '要给出已完成的节点 id')
      assert.match(error.message, /不要整批重跑/u, '要明确禁止整批重跑')
      return true
    },
  )
})

test('失败：第一段就挂时不该谎称「有段落已完成」', async () => {
  const { deps } = fakeDeps([1], { failAt: 0 })
  await assert.rejects(
    () => generateNarration(deps, { lines: [{ text: '一' }, { text: '二' }], fps: 30 }),
    (error) => {
      assert.match(error.message, /还没有任何段落落卡/u)
      assert.doesNotMatch(error.message, /已落画布/u)
      return true
    },
  )
})

test('参数拒收：空文本 / 空 lines / 超上限 / 非法 fps 都在合成之前拦下', async () => {
  const ok = fakeDeps([1, 1])
  await assert.rejects(
    () => generateNarration(ok.deps, { lines: [{ text: '一' }, { text: '   ' }], fps: 30 }),
    /第 2 段旁白的 text 为空/u,
  )
  assert.equal(ok.calls.length, 0, '空文本必须在第一次合成之前就拦下（别烧额度）')

  await assert.rejects(() => generateNarration(ok.deps, { lines: [], fps: 30 }), /lines 为空/u)
  await assert.rejects(
    () => generateNarration(ok.deps, { lines: Array.from({ length: MAX_NARRATION_LINES + 1 }, () => ({ text: '一' })), fps: 30 }),
    /最多 32 段/u,
  )
  await assert.rejects(() => generateNarration(ok.deps, { lines: [{ text: '一' }], fps: 29 }), /fps 必须是/u)
})

test('warnings：单段后处理提示与时长探测失败都要带出来（模型必须转告用户）', async () => {
  const { deps } = fakeDeps([0, 1], { warn: true })
  const result = await generateNarration(deps, { lines: [{ text: '一' }, { text: '二' }], fps: 30 })
  assert.ok(result.warnings.some((line) => /第 1 段：语速被夹/u.test(line)), '后处理 warning 要带段号')
  assert.ok(result.warnings.some((line) => /第 1 段时长探测失败/u.test(line)), '探测失败必须提示（不能当它占满整句）')
})
