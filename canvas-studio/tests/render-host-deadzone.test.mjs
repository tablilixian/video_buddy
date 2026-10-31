/**
 * 隐藏渲染窗口「取单后一帧不出」的**判死口径**（2026-10-30 会话复盘的可执行台帐）。
 *
 * 复盘对象：`~/Downloads/session.v4 8.jsonl`（45 轮 / 97 次 `render_composition`），
 * 账是 66 成功 / 31 失败，其中**唯一还活着的故障**是 21 次
 * 「隐藏渲染窗口已取单但 30.0–31.3s 内一帧都没渲染」。本文件把**宿主侧的判死逻辑**
 * 拆成 S-1..S-7 一组可机器判定的结论，跑一遍就等于把复盘重放一遍 —— 不启浏览器。
 *
 * ⚠️ 边界（读完再看下面的结论）：本文件**不能**证明那 21 次的成因，它只钉住「宿主在
 * 什么条件下会把一张单判死、判死时说了什么、判死后做什么」。真机成因由
 * `scripts/probe/render-host-stall.probe.mjs` 用**真实 Remotion 渲染**给出，2026-10-30
 * 实测三组数据（63 轨 / 5415 帧 / 26 段真视频 / draft）：
 *
 *   | 场景 | 结果 |
 *   |---|---|
 *   | 同一个隐藏窗口连续渲 | 第 1 单 102.8s 成交；**第 2 单取单后 11 拍心跳到 10s，之后心跳全停、139s 零帧**；第 3 单连单都取不走 |
 *   | 每单换一扇新窗口 | 3/3 全部成交（首帧前 10.8–10.9s、心跳空档 1.0s、18.9ms/帧、102.2s、字节数三次完全相同） |
 *
 * ⇒ 真成因是**窗口复用后第二单在首帧阶段把主线程按住（心跳同时停）**，不是「首帧前
 * 30s 预算太短」（真机首帧前只有 ~11s，且心跳稳在 1s 一拍）。所以下面 S-1/S-3 描述的
 * 「判死不对称」是**真实存在但不致命**的口径问题；致命的是 `S-5` 那条：判死才丢窗口，
 * 于是「丢窗 → 新窗能渲 → 又复用 → 又死」。
 *
 * 🛠 2026-10-31 已按这个结论改掉「重建策略」：**一扇窗只渲一单** —— 结算时打标
 * （`markRenderHostServedJob`），下一次派单前回收并立刻重建（`recycleRenderHostIfServed`
 * → `disposeRenderHost` → `warmRenderHost`），回收**不吃**失败重置的 30s 节流。
 * 所以 S-5 的断言已经从「第二次失败不再重置 ⇒ 在旧窗上再死一遍」改写为
 * 「第二张单永远从新窗口开始」；S-7 是把这条策略钉死的四条守恒。S-1 的文案也分开了
 * （「渲染器被卡住」 vs 「窗口已退出」）。
 *
 * 逐条结论（用例钉住的是**代码行为**，不是猜测）：
 *
 *   S-1 判死只需「心跳与进度双双超阈值」，被杀的窗口在那一刻**确实没有任何活性证据**。
 *       文案曾经与会话里那 21 次逐字相同（「渲染窗口异常，请重试」）、只有 detail 说得出
 *       「heartbeat lost」；现在正文点明「渲染器被卡住」，与「窗口已退出」分开。
 *   S-2 判死口径是 `min(心跳年龄, 距上次进度)`：**任一方新鲜就算活**。这是现有实现里
 *       唯一正确的部分 —— 修口径时不能把它改成「只看心跳」（那会连进度通道一起废掉）。
 *   S-3 两条路不对称：同一时刻、同样的「无进度」状态，`client` 单因为有
 *       `renderHostCanTakeOver()` 豁免而活着，`render-host` 单**照样被杀**。
 *       在「窗口复用必挂」的真机事实下，这条不对称反而让 host 单死得更快、更该保留。
 *   S-4 阈值是**单相、且与规模无关**：70 轨 / 1 轨、出过帧 / 没出帧，四张单的判死时刻
 *       落在同一个 tick 里。⇒ 会话里「轨数越多失败率越高」不是阈值看轨数，而是
 *       「轨数 ↑ ⇒ 首帧前耗时 ↑ ⇒ 撞上窗口复用挂死的概率 ↑」。
 *   S-5 判死顺手丢窗口；**而且下一单派单前一定再回收一次（绕过节流）** ⇒ 第二张单永远
 *       从新窗开始。真机对照「换新窗 3/3 成功」就是这条的验收口径。
 *   S-7 回收策略的四条守恒：①窗口单结算后下一单派单前回收、client 单不碰窗口；
 *       ②窗口正被在飞的单用着时不得回收（否则掐掉正在渲的那张）；③回收绕过节流；
 *       ④排队单在**拿到槽位那一刻**补回收（否则它接的就是上一单那扇脏窗）。
 *   S-6 同一份 manifest 重放：静默窗口必死、持续自报的窗口活到成交。⇒ 是**概率性挂起**，
 *       不是「内容太大 / 5415 帧超限」。
 *
 * ⚠️ 本文件是**现状台帐**：S-1 / S-3 / S-4 / S-5 / S-7 钉的是当前实现，改判死口径或改
 * 重建策略都会让它们变红 —— 这是设计如此（逼修复者显式改写这几条，而不是悄悄改掉行为）。
 * S-2 / S-6 是**修复后也必须成立**的不变量，越改越应该绿。
 *
 * 从 `../lib/*.js` 导入 —— 先 build（`yarn workspace canvas-studio build`）再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activeRenderJobCount,
  cancelRenderJob,
  claimRenderJobFor,
  commitRenderJob,
  listRenderJobViews,
  reportRenderJobProgress,
  runRenderJob,
} from '../lib/remotion/render-job.js'
import {
  RENDER_HOST_HEARTBEAT_MS,
  RENDER_HOST_STALE_MS,
  recordRenderHostReport,
  renderHostCanTakeOver,
  resetRenderHostReport,
} from '../lib/render-host/status.js'
import {
  RENDER_HOST_RESET_MIN_INTERVAL_MS,
  markRenderHostServedJob,
  recycleRenderHostIfServed,
  resetRenderHostDispatch,
  setRenderHostLauncher,
  setRenderHostResetter,
  warmRenderHost,
} from '../lib/render-host/dispatch.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { ProjectRegistry } from '../lib/projects.js'
import '../lib/errors/catalog.js'

/** 把 30s 压成 400ms：判死结论与真实阈值同构，只是跑得快（看门狗 tick 会是 200ms）。 */
const STALE = 400

/** 非空字节即可：`saveLocalAssetBytes` 按扩展名分类，`probeMediaInfo` 对坏文件回落 duration 0。 */
const FAKE_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 会话里那份片子的形状：26 段视频 + 36~37 张字幕卡 ≈ 63~70 轨、5415 帧。
 * 这里用不依赖素材的 textCard 撑出同样的**轨数**（判死逻辑不看轨类型）。
 */
function manifestWithTracks(count, { durationInFrames = 900 } = {}) {
  return {
    id: `m-${String(count)}-tracks`,
    meta: { title: `S-${String(count)} 轨`, width: 864, height: 480, fps: 30, durationInFrames },
    tracks: Array.from({ length: count }, (_, i) => ({
      id: `t-${String(i)}`,
      type: 'textCard',
      variant: i === 0 ? 'title' : 'subtitle',
      text: `字幕 ${String(i + 1)}`,
      startFrame: i * 10,
      durationInFrames: 80,
    })),
  }
}

/** 最新一张单的 id（`views` 按 seq 升序且保留已结算的单）。 */
function newestJobId(projectId) {
  const views = listRenderJobViews(projectId)
  assert.ok(views.length > 0, '工单必须同步入表')
  return views[views.length - 1].jobId
}

async function withProject(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-deadzone-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('死区取证')
    await run({ registry, project })
  } finally {
    resetRenderHostReport()
    resetRenderHostDispatch()
    await rm(dir, { recursive: true, force: true })
  }
}

/** 结算一个 Promise，失败时**返回**错误对象（取证要比对 `code` / `detail` / `params.job`）。 */
function settled(promise) {
  return promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
}

/**
 * 起一张**归隐藏窗口**的单，并让窗口「取一次单 + 自报一拍 `rendering`」——
 * 这一拍就是会话里那 21 次失败前**最后一帧活性证据**：主线程随即被
 * `pageResponsiveness: 'disabled'` 按住，`setInterval(beat)` 再也不触发。
 *
 * @returns `{ jobId, dispatchedAt }`；窗口从此静默，直到用例自己再报。
 */
function startHostJobInDeadZone(project, manifest, options = {}) {
  const job = runRenderJob({
    projectId: project.id,
    manifest,
    executor: 'render-host',
    heartbeatStaleMs: STALE,
    // 3s 而不是工具侧的 90s：死区在 400ms 就判死，这个预算只兜「万一没判死」——
    // 反向变异时红得快，不必白等半分钟。
    timeoutMs: 3_000,
    ...options,
  })
  const jobId = newestJobId(project.id)
  // 窗口真的取走了这张单（会打 `claimedAt`，但**不会**打 `clientClaimedAt`）。
  const pending = claimRenderJobFor(null, 'render-host')
  assert.notEqual(pending, null, '窗口必须能取到归自己的单')
  assert.equal(pending.jobId, jobId)
  recordRenderHostReport({ state: 'rendering', jobId })
  return { job, settled: settled(job), jobId, dispatchedAt: Date.now() }
}

// ─────────────────────── S-1：复现「首帧前死区」 ───────────────────────

test('S-1：窗口取单后只报得出一拍 rendering ⇒ 在阈值处被判「失联」杀掉，签名与会话那 21 次一致', async () => {
  await withProject(async ({ project }) => {
    const { settled: result, dispatchedAt } = startHostJobInDeadZone(project, manifestWithTracks(63))
    const outcome = await result
    const elapsed = Date.now() - dispatchedAt

    assert.equal(outcome.ok, false, '死区里不可能成交')
    const err = outcome.error
    assert.equal(err.code, 'CS-RENDER-002')
    // 模型看到的就是这一句 —— 与那 21 次完全相同，但现在它**自己就说清了死法**：
    // 「渲染器被卡住」（窗口还在、主线程停了）而不是「窗口已退出」（进程没了）。
    assert.match(err.message, /渲染窗口异常/u)
    assert.match(err.message, /渲染器被卡住/u, `判死文案必须点明「卡住」而不是笼统的「异常」：${err.message}`)
    assert.match(err.message, /请重试/u)
    // 诊断字段才说真话：心跳丢失（而不是「内容太大」「帧数超限」）。
    // `detail` 落在 `params`，由 catalog 的 devMessage 模板消费（`routeError` 在 devMode 下才用它）。
    assert.match(String(err.params?.detail), /render host heartbeat lost for \d+s/u, `detail 必须点明心跳丢失：${String(err.params?.detail)}`)

    // 工单签名 = 取过单、一帧未出。这正是复盘里 21 次失败的原样。
    const diag = err.params?.job
    assert.ok(diag, '必须带工单快照')
    assert.notEqual(diag.claimedAt, null, '窗口取过这张单')
    assert.equal(diag.firstFrameAt, null, '一帧都没出过（首帧前死区）')
    assert.equal(diag.maxProgress, 0)
    assert.equal(diag.path, 'render-host')

    // 判死时刻只由阈值决定：阈值 400ms ⇒ 不可能撑到「规模预算」那种 60s 以上。
    assert.ok(elapsed >= STALE - 20, `不得早于阈值判死（实际 ${String(elapsed)}ms）`)
    assert.ok(elapsed < STALE + 800, `不得晚于阈值 + 一个 tick 判死（实际 ${String(elapsed)}ms）`)
  })
})

// ─────────────────── S-2：判死口径 = min(心跳, 进度) ───────────────────

test('S-2①：一帧未出但心跳在拍 ⇒ 永远活着（修死区的方向必须保住这条）', async () => {
  await withProject(async ({ project }) => {
    const { settled: result } = startHostJobInDeadZone(project, manifestWithTracks(63))
    // 撑过 2.5 个阈值仍活着 —— 在现状下这只能靠心跳，因为根本没有进度。
    const beat = setInterval(() => { recordRenderHostReport({ state: 'rendering' }) }, Math.floor(STALE / 3))
    try {
      await sleep(STALE * 2.5)
      assert.equal(activeRenderJobCount(), 1, '心跳新鲜 ⇒ 不得判死（这条是 Worker 心跳方案的成立前提）')
    } finally {
      clearInterval(beat)
    }
    // 心跳一停 ⇒ 立刻回到死区（证明「活着」确实是被心跳救的，不是别的原因）。
    const outcome = await result
    assert.equal(outcome.ok, false)
    assert.match(String(outcome.error.params?.detail), /heartbeat lost/u)
  })
})

test('S-2②：心跳全无但进度在报 ⇒ 同样活着（进度是另一条独立证据）', async () => {
  await withProject(async ({ project }) => {
    const { settled: result, jobId } = startHostJobInDeadZone(project, manifestWithTracks(63))
    // 从这一刻起窗口彻底静默，只有进度通道还能说话（`progress=0` 也算报活）。
    resetRenderHostReport()
    const beat = setInterval(() => { reportRenderJobProgress(jobId, 0) }, Math.floor(STALE / 3))
    try {
      await sleep(STALE * 2.5)
      assert.equal(activeRenderJobCount(), 1, '心跳缺失但进度在报 ⇒ 也不得判死（min 的另一半）')
    } finally {
      clearInterval(beat)
    }
    const outcome = await result
    assert.equal(outcome.ok, false)
  })
})

// ────────────────── S-3：两条路的豁免不对称（根因） ──────────────────

test('S-3：同样的「无进度」，能兜底的 client 单被豁免、不能兜底的 host 单照杀', async () => {
  await withProject(async ({ project }) => {
    // 前提：窗口活着且空闲 ⇒ `renderHostCanTakeOver()` 为真（"待会儿能干活"）。
    recordRenderHostReport({ state: 'idle' })
    assert.equal(renderHostCanTakeOver(), true, '前提：窗口具备兜底能力')

    // ① client 单：claim 后一帧不动，越过 claimStallMs 之后**必须还活着**（豁免）。
    const clientJob = runRenderJob({
      projectId: project.id,
      manifest: manifestWithTracks(63),
      executor: 'client',
      clientClaimStallMs: STALE,
      clientClaimStallNoHostMs: STALE,
      timeoutMs: 3_000,
    })
    const clientSettled = settled(clientJob)
    const clientJobId = newestJobId(project.id)
    assert.notEqual(claimRenderJobFor(project.id, 'client'), null, '画布页取单（打 clientClaimedAt）')
    await sleep(STALE * 3)
    assert.equal(activeRenderJobCount(), 1, 'client 单在有窗口可兜底时必须被豁免 —— 否则改派机会被自己掐掉')
    // 收尾（撤单），别把它拖进下一条断言。
    cancelRenderJob(clientJobId, { reason: 'S-3 收尾' })
    await clientSettled

    // ② host 单：同一时刻、同样的零进度 ⇒ 没有任何豁免，杀掉。
    recordRenderHostReport({ state: 'idle' })
    assert.equal(renderHostCanTakeOver(), true)
    const { settled: hostResult } = startHostJobInDeadZone(project, manifestWithTracks(63))
    const hostOutcome = await hostResult
    assert.equal(hostOutcome.ok, false, '⭐ 这就是不对称：同样是「还没出帧」，host 单没有 takeover 豁免')
    assert.match(String(hostOutcome.error.params?.detail), /heartbeat lost/u)
    assert.equal(activeRenderJobCount(), 0)
  })
})

// ───────── S-4：阈值单相，且与轨数 / 是否出帧 / 片长无关 ─────────

test('S-4：70 轨 / 1 轨 / 出过帧 / 没出帧 —— 四张单都在同一档阈值被判死（没有分相，也不看规模）', async () => {
  await withProject(async ({ project }) => {
    /** 量一张 host 单从「最后一次活性证据」到被判死的耗时。 */
    async function deathLatency(manifest, { withProgress }) {
      resetRenderHostReport()
      const { settled: result, jobId } = startHostJobInDeadZone(project, manifest)
      const lastAliveAt = Date.now()
      if (withProgress) reportRenderJobProgress(jobId, 0.4) // 出过帧：`maxProgress > 0`
      const startedAt = withProgress ? Date.now() : lastAliveAt
      const outcome = await result
      assert.equal(outcome.ok, false, '这四种情形在现状下都必须死（否则本用例前提不成立）')
      return Date.now() - startedAt
    }

    const bigNoFrame = await deathLatency(manifestWithTracks(70), { withProgress: false })
    const smallNoFrame = await deathLatency(manifestWithTracks(1), { withProgress: false })
    const smallWithFrame = await deathLatency(manifestWithTracks(1), { withProgress: true })
    const bigWithFrame = await deathLatency(manifestWithTracks(70), { withProgress: true })

    const latencies = { bigNoFrame, smallNoFrame, smallWithFrame, bigWithFrame }
    const values = Object.values(latencies)
    const spread = Math.max(...values) - Math.min(...values)
    // 一个 tick 的抖动（200ms）+ 调度毛刺；超过就说明阈值真的在按规模/相位分档了。
    assert.ok(
      spread < STALE,
      `判死时刻必须与轨数、是否出帧无关（现状是单相 30s 一刀切），实测：${JSON.stringify(latencies)}`,
    )
    for (const value of values) {
      assert.ok(value >= STALE - 20 && value < STALE + 900, `单张单的判死时刻也要贴着阈值：${String(value)}ms`)
    }
  })
})

test('S-4 附：阈值常量本身是「1s 心跳 / 30s 判死」= 连丢 30 拍才算死，且没有按相位分开的第二档', () => {
  assert.equal(RENDER_HOST_HEARTBEAT_MS, 1_000)
  assert.equal(RENDER_HOST_STALE_MS, 30_000)
  // 这条是**台账**：现状只有一个常量（不分「首帧前 / 出帧后」）。分相改造后本断言会红，
  // 届时把它改成两条常量各自的期望值 —— 别删，删了就没人记得这里原本只有一档。
  assert.equal(typeof RENDER_HOST_STALE_MS, 'number', '阈值是一个常数，不是 f(轨数, 是否出帧)')
})

// ─── S-5：判死丢窗 + 每单派单前回收（「越试越死」被掐断的地方） ───

test('S-5：判死会丢窗，且下一单派单前**再回收一次**（不吃 30s 节流）⇒ 第二张单永远从新窗口开始', async () => {
  await withProject(async ({ project }) => {
    const resets = []
    setRenderHostResetter((reason) => { resets.push(reason) })

    const first = await startHostJobInDeadZone(project, manifestWithTracks(63)).settled
    assert.equal(first.ok, false)
    assert.equal(resets.length, 1, '第一次判死必须丢掉这扇窗（否则下一单继续踩坏状态）')
    assert.match(resets[0], /heartbeat|stalled/u, `重置理由要能对上判死原因：${resets[0]}`)

    const resetAt = Date.now()
    // 第二张单：派单前必须先把「上一单用过的窗」回收掉 —— 真机实测复用窗口渲第二单必挂。
    const { settled: second, jobId: secondId } = startHostJobInDeadZone(project, manifestWithTracks(63))
    const recycled = resets.filter((reason) => /one window per render job/u.test(reason))
    assert.equal(recycled.length, 1, `第二单起渲之前必须回收上一扇窗，实际重置序列：${JSON.stringify(resets)}`)
    // ⭐ 关键：这次回收发生在失败重置的 30s 节流窗口**之内**仍照常执行 —— 这正是「一次失败
    // 被放大成连续失败」的断点。回收若也吃节流，第二单就只能在旧窗上再死一遍。
    assert.ok(
      Date.now() - resetAt < RENDER_HOST_RESET_MIN_INTERVAL_MS,
      '用例必须落在节流窗口内，否则这条断言证明不了「回收绕过了节流」',
    )
    assert.ok(RENDER_HOST_RESET_MIN_INTERVAL_MS > STALE * 10, '节流窗口远大于一次渲染的判死时长，所以「连死」时只会重置一次')

    // 第二张单照旧死在死区里（这里没有真窗口），但它是死在一扇**新窗**上。
    const outcome = await second
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.params?.job?.path, 'render-host')
    assert.equal(activeRenderJobCount(), 0, `收尾：${secondId} 必须出表`)
  })
})

// ─── S-7：一扇窗只渲一单（2026-10-30 真机结论的代码侧守恒） ───

test('S-7①：窗口单结算 ⇒ 下一单派单前回收；client 单结算则不动窗口', async () => {
  await withProject(async ({ project }) => {
    const resets = []
    setRenderHostResetter((reason) => { resets.push(reason) })

    // ① client 单结算：窗口没有服务过这一单，不该被回收。
    const clientJob = settled(runRenderJob({
      projectId: project.id,
      manifest: manifestWithTracks(1),
      executor: 'client',
      timeoutMs: 3_000,
    }))
    const clientId = newestJobId(project.id)
    cancelRenderJob(clientId, { reason: 'S-7① 收尾' })
    await clientJob
    assert.deepEqual(resets, [], 'client 单没碰过隐藏窗口，回收它属于误伤（会让下一次派单白等一次冷启）')

    // ② host 单结算 ⇒ 下一单派单前的第一件事就是回收。
    await startHostJobInDeadZone(project, manifestWithTracks(1)).settled
    assert.equal(resets.length >= 1, true, '失败结算本身就会重置（B2-2）')
    resets.length = 0
    const next = settled(runRenderJob({
      projectId: project.id,
      manifest: manifestWithTracks(1),
      executor: 'render-host',
      heartbeatStaleMs: STALE,
      timeoutMs: 3_000,
    }))
    assert.equal(resets.length, 1, `派单前必须回收上一扇窗，实际：${JSON.stringify(resets)}`)
    assert.match(resets[0], /one window per render job/u)
    cancelRenderJob(newestJobId(project.id), { reason: 'S-7① 收尾' })
    await next
  })
})

test('S-7②：窗口正被一张在飞的单用着 ⇒ 即便已标脏也不得回收（否则掐掉正在渲的那张单）', async () => {
  await withProject(async ({ project }) => {
    const resets = []
    setRenderHostResetter((reason) => { resets.push(reason) })

    // ① 第一张单在飞（死区里，尚未结算）。
    const inFlight = startHostJobInDeadZone(project, manifestWithTracks(1))
    resets.length = 0
    // ② 模拟「更早的一张单刚结算」留下的脏标记（真实路径：`settleAndForget` 打标，
    //    回收推迟到下一次派单）。此刻窗口仍被 ① 用着 —— 这是唯一该跳过的情形。
    markRenderHostServedJob()

    // ③ 第二张单起单：不许回收，否则 ① 的渲染页会被扯掉。
    const second = settled(runRenderJob({
      projectId: project.id,
      manifest: manifestWithTracks(1),
      executor: 'render-host',
      heartbeatStaleMs: STALE,
      timeoutMs: 3_000,
    }))
    assert.deepEqual(resets, [], '并发=1 时第二单会排队，窗口仍是第一单的 —— 回收会打断它')

    cancelRenderJob(newestJobId(project.id), { reason: 'S-7② 收尾' })
    await second
    await inFlight.settled
    assert.equal(activeRenderJobCount(), 0)
  })
})

test('S-7④：排队单拿到槽位那一刻换新窗（此时上一单刚结束，窗口才变脏）', async () => {
  await withProject(async ({ project }) => {
    const resets = []
    const launches = []
    setRenderHostResetter((reason) => { resets.push(reason) })
    setRenderHostLauncher(() => { launches.push(Date.now()); return true })

    // ① A 占住唯一槽位。
    const first = startHostJobInDeadZone(project, manifestWithTracks(1))
    // ② B 同一时刻起单 ⇒ 排队（建单时窗口还被 A 用着，那时回收不成立）。
    const queued = settled(runRenderJob({
      projectId: project.id,
      manifest: manifestWithTracks(1),
      executor: 'render-host',
      heartbeatStaleMs: STALE,
      timeoutMs: 3_000,
    }))
    assert.equal(activeRenderJobCount(), 2, '前提：A 在跑、B 在排队')
    resets.length = 0
    launches.length = 0

    // ③ A 死在死区 ⇒ 槽位交给 B。
    await first.settled
    await sleep(50)

    const recycled = resets.filter((reason) => /one window per render job/u.test(reason))
    assert.equal(
      recycled.length,
      1,
      `B 拿到槽位时必须换新窗，否则它接的就是 A 用过的窗（真机：复用窗口渲第二单必挂）。实际重置：${JSON.stringify(resets)}`,
    )
    assert.equal(launches.length, 1, '换窗之后必须真的拉起新窗，否则 B 会挂在一扇不存在的窗口上白等一个判死周期')

    cancelRenderJob(newestJobId(project.id), { reason: 'S-7④ 收尾' })
    await queued
  })
})

test('S-7③：回收后下一次派单立刻拉起新窗，不被 2s 暖启防抖吞掉（吞掉 = 派给空气）', async () => {
  resetRenderHostDispatch()
  const launches = []
  setRenderHostLauncher(() => { launches.push(Date.now()); return true })
  try {
    warmRenderHost(1_000_000)
    warmRenderHost(1_000_001)
    assert.equal(launches.length, 1, '前提：暖启本身有 2s 防抖（连着调只拉一次）')

    markRenderHostServedJob()
    assert.equal(recycleRenderHostIfServed('S-7③ recycle'), false, '没登记重置钩子时回收是空操作')
    // 没有钩子也必须在「标志已消费」上保持守恒：否则真机上会一直以为窗口还干净。
    assert.equal(recycleRenderHostIfServed('S-7③ again'), false)

    markRenderHostServedJob()
    setRenderHostResetter(() => {})
    assert.equal(recycleRenderHostIfServed('S-7③ recycle#2'), true)
    warmRenderHost(1_000_002)
    assert.equal(
      launches.length,
      2,
      '回收必须顺手清掉暖启防抖，否则下一单在「窗口不存在」的状态下被派出去（28s 后报「从未取单」）',
    )
  } finally {
    resetRenderHostDispatch()
  }
})

// ───── S-6：同一 manifest 重放 —— 静默必死，自报就活到成交 ─────

test('S-6：同一份 63 轨 manifest，静默窗口必死、持续自报的窗口活到成交 ⇒ 是概率性挂起', async () => {
  await withProject(async ({ registry, project }) => {
    const manifest = manifestWithTracks(63)
    assert.deepEqual(validateManifest(manifest).errors, [], '取证用的 manifest 必须本身合法（排除「内容不合法」这条解释）')

    // ① 静默窗口：必死（同一份 manifest 的第一次）。
    const dead = await startHostJobInDeadZone(project, manifest).settled
    assert.equal(dead.ok, false)
    assert.match(String(dead.error.params?.detail), /heartbeat lost/u)

    // ② 同一份 manifest（逐字节相同），窗口只是"还在拍心跳"⇒ 活过 2.5 个阈值并成交。
    resetRenderHostReport()
    const { settled: result, jobId } = startHostJobInDeadZone(project, manifest)
    const beat = setInterval(() => { recordRenderHostReport({ state: 'rendering', jobId }) }, Math.floor(STALE / 3))
    try {
      await sleep(STALE * 2.5)
      assert.equal(activeRenderJobCount(), 1, '同一份 manifest 在有心跳时根本不会被判死')
      const committed = await commitRenderJob(registry, jobId, { bytes: FAKE_MP4 })
      assert.equal(committed.ok, true)
      assert.match(committed.assetFile, /\.mp4$/)
    } finally {
      clearInterval(beat)
    }
    const outcome = await result
    assert.equal(outcome.ok, true, '同一份 manifest、同一执行者、同一阈值 —— 只差心跳，结果就从死变活')
    assert.equal(activeRenderJobCount(), 0)
  })
})

/**
 * 反向变异（改完必须逐条手工验红，全部在 `lib/` 上做即可，不必改 src）。2026-10-31 实测：
 * 每条都单独跑、各自变红（M-A 例外，见下）：
 *
 * 1. `silenceOf` 的 host 分支改成只看心跳（`renderHostHealth(now).ageMs`）⇒ S-2② 红；
 * 2. 同一分支改成只看进度（`now - lastProgressAt`）⇒ S-2① 红；
 * 3. host 分支加一句 `if (renderHostCanTakeOver(now)) return null` ⇒ S-3 的 ② 变绿、S-1 红；
 * 4. host 分支按 `manifest.tracks.length` 放宽阈值 ⇒ S-4 红（spread 超限）；
 * 5. 把 `job.heartbeatStaleMs` 换成常量 `RENDER_HOST_STALE_MS` ⇒ S-1 红（要等 30s 才死）；
 * 6. 删掉 `resetRenderHostAfterFailure` 调用 ⇒ S-5 第一条红；
 * 7. 让 `reportRenderJobProgress` 不刷 `lastProgressAt` ⇒ S-2② / S-6 红；
 * 8. 结算处删掉 `markRenderHostServedJob()` ⇒ S-5 / S-7① / S-7② / S-7④ 全红；
 * 9. `recycleRenderHostIfServed` 改成走 30s 节流的 `resetRenderHostAfterFailure` ⇒ S-5 红
 *    （那条「回收发生在节流窗口内仍照常执行」的断言就是为这一刀写的）；
 * 10. `recycleRenderHost` 里删掉 `lastWarmAt = 0` ⇒ S-7③ 红（回收后派给空气）；
 * 11. `recycleServedRenderHost` 的守卫改成恒假 ⇒ S-7② / S-7④ 红（会掐掉在飞的单）；
 * 12. `armTimeout` 里的那句 `recycleServedRenderHost(job.jobId)` 删掉 ⇒ S-7④ 红；
 * 13. 判死文案删掉「渲染器被卡住」⇒ S-1 红。
 *
 * M-A（删掉 `runRenderJob` 开头那句回收）**不会变红**：`armTimeout` 里还有一处，顺序渲染时
 * 两者等价。保留两句是因为开头那句让 `pickExecutor` 在干净状态上决定执行者；真正的守门
 * 断言在 `armTimeout` 那一处（变异 12）。
 */
