/**
 * 分辨率三档分级（CV-187）—— 表-码对齐、像素映射、历史值归一。
 *
 * 本文件的定位：**`OUTPUT_SIZE` 是「声明的分辨率 = 真实产物」这条不变式的唯一落点**。
 * 把它改成 `1920×1080`（看起来更「标准」）或 `1280×720`（回到旧值）之后，全仓其余
 * 测试照样全绿，只有画布上多看几 px、详情面板的数字变假 —— 这类静默失败只有断言拦得住。
 * 故期望值**硬编码自 H3 推荐分辨率表，不引用实现**（防「两边一起错」的空绿）。
 *
 * 直连 Host 侧编译产物 lib/*.js。运行：node --test "tests/*.test.mjs"
 *
 * 反向验证（改了实现必须让它红，改完恢复）：
 *   - 把 `fal.ts` 的 `LEGACY_RESOLUTION` 置空 → 「历史值归一」组必须红
 *   - 把 `OUTPUT_SIZE['2k']` 改成 1920×1080 → 「表-码对齐」组必须红
 *   - 把 `generate.ts` 落盘的 `mediaSize` 换回 `size` → I 组必须红（视频侧声明值不得冒充真实产物）
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { constants, readFileSync } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OUTPUT_SIZE, DEFAULT_RESOLUTION, isVideoResolution, sizeForAspectRatio } from '../lib/config.js'
import { createFalProvider, normalizeResolution } from '../lib/providers/fal.js'
import { runVideo } from '../lib/providers/executor.js'
import { probeMediaInfo, resolveFfmpegPath } from '../lib/ffmpeg-run.js'
import { generateAsset } from '../lib/generate.js'

/**
 * H3 推荐分辨率表（megapixels → 输出像素），**硬编码、不引用实现**。
 * 来源：用户 2026-09-15 提供的 H3 视频生成推荐分辨率表，0.4 / 1.0 / 2.0 三行。
 */
const H3_TABLE = {
  '480p': { megapixels: 0.4, width: 864, height: 480 },
  '736p': { megapixels: 0.9, width: 1280, height: 736 },
  '2k': { megapixels: 2.0, width: 1920, height: 1088 },
}

// —— 打桩 fetch（与 tests/video-provider-fal.test.mjs 同一方式）——
function stubFetch(handlers) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }
    calls.push(call)
    const handler = handlers[0]
    if (handler === undefined) throw new Error(`stub fetch 序号越界: ${calls.length} ${call.method} ${call.url}`)
    const res = typeof handler === 'function' ? await handler(call, calls.length) : handlers.shift()
    return { ok: (res.status ?? 200) >= 200 && (res.status ?? 200) < 300, status: res.status ?? 200, text: async () => res.text ?? JSON.stringify(res.json ?? {}) }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}
const KEY_CTX = { falApiKey: async () => 'sk-test' }
const baseReq = (over) => ({ prompt: '一只白猫追蝴蝶', duration: 5, aspectRatio: '16:9', references: [], ...over })
const t2vHandlers = () => [
  { json: { request_id: 'req-1', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-1' } },
  { json: { status: 'IN_QUEUE' } },
  { json: { status: 'IN_PROGRESS' } },
  { json: { status: 'COMPLETED' } },
  { json: { video: { url: 'https://media.example/h3.mp4' } } },
]

let restoreFetch = () => {}
afterEach(() => { restoreFetch() })

// ——————————————————————————————————————————————————————————————
// H 组 · 表-码对齐（本方案最该有的一条）
// ——————————————————————————————————————————————————————————————
test('H 表-码对齐：OUTPUT_SIZE 必须逐字节等于 H3 推荐表，且宽高均为 32 的倍数', () => {
  assert.deepEqual(Object.keys(OUTPUT_SIZE).sort(), ['2k', '480p', '736p'], '档位恰好三档')
  for (const [tier, row] of Object.entries(H3_TABLE)) {
    assert.deepEqual(
      OUTPUT_SIZE[tier],
      { width: row.width, height: row.height },
      `${tier} 必须等于 H3 表输出 ${row.width}×${row.height}（H3 的 multiple=32 规则）`,
    )
    // 视频端点只收 megapixels、不收像素；像素只能由这张表反推。
    // 非 32 倍数会被引擎重采样或补边 ⇒ 首帧与产物规格不一致。
    assert.equal(row.width % 32, 0, `${tier} 宽 ${row.width} 不是 32 的倍数`)
    assert.equal(row.height % 32, 0, `${tier} 高 ${row.height} 不是 32 的倍数`)
  }
})

test('H 默认档与设置项默认值同源（DEFAULT_RESOLUTION 在三档之内）', () => {
  assert.equal(isVideoResolution(DEFAULT_RESOLUTION), true, 'DEFAULT_RESOLUTION 必须是合法档位')
  assert.equal(DEFAULT_RESOLUTION, '736p', '默认档 = 736p（唯一不降低视频/图片任一侧画质的档）')
})

// ——————————————————————————————————————————————————————————————
// D 组 · 画幅 × 档位 的像素映射（图片与视频共用这一份实现）
// ——————————————————————————————————————————————————————————————
test('D sizeForAspectRatio：3 画幅 × 3 档', () => {
  for (const [tier, row] of Object.entries(H3_TABLE)) {
    // 16:9 直给基准表
    assert.deepEqual(sizeForAspectRatio('16:9', tier), { width: row.width, height: row.height }, `16:9 + ${tier}`)
    // 9:16 反宽高
    assert.deepEqual(sizeForAspectRatio('9:16', tier), { width: row.height, height: row.width }, `9:16 + ${tier}`)
    // 1:1 三档共用 1024×1024（方形不是 H3 输出规格，无档位意义）
    assert.deepEqual(sizeForAspectRatio('1:1', tier), { width: 1024, height: 1024 }, `1:1 + ${tier}`)
  }
})

test('E 缺省同源：不传档位 === 显式传 DEFAULT_RESOLUTION；未知画幅落 16:9', () => {
  for (const aspect of ['16:9', '9:16', '1:1', undefined, '4:3']) {
    assert.deepEqual(
      sizeForAspectRatio(aspect),
      sizeForAspectRatio(aspect, DEFAULT_RESOLUTION),
      `画幅 ${String(aspect)} 的缺省档必须等于 DEFAULT_RESOLUTION`,
    )
  }
  assert.deepEqual(sizeForAspectRatio(undefined), sizeForAspectRatio('16:9'), '未知/缺省画幅落 16:9')
})

// ——————————————————————————————————————————————————————————————
// F 组 · 归一函数纯度
// ——————————————————————————————————————————————————————————————
test('F normalizeResolution：三档直通、undefined 不传、脏值不抛', () => {
  for (const tier of Object.keys(H3_TABLE)) assert.equal(normalizeResolution(tier), tier, `${tier} 直通`)
  assert.equal(normalizeResolution(undefined), undefined, 'undefined → undefined（不传，走供应商默认）')
  for (const junk of ['4k', '1080P', '720P', '480P', '', 'giant', '2K']) {
    assert.equal(normalizeResolution(junk), undefined, `未知值 ${junk} 应返回 undefined 而非抛错`)
  }
})

test('B 历史值归一：旧 720p/1080p 就地归一（与旧「升档」行为等义）', () => {
  // 画布节点里的 generationPrompt 是历史数据的真实来源：删掉这两个键后若直接查表，
  // 老节点重试会在 fal.ts 的取值处撞上 undefined 抛 TypeError（整次生成崩掉）。
  assert.equal(normalizeResolution('720p'), '736p', '旧 720p 等价于 736P（旧行为就是升到 736P）')
  assert.equal(normalizeResolution('1080p'), '2k', '旧 1080p 等价于 2K')
})

// ——————————————————————————————————————————————————————————————
// A/B/C 组 · fal 端到端（走 runVideo，验真实请求体 + warnings）
// ——————————————————————————————————————————————————————————————
test('A fal 三档直通：请求体落 fal 原生枚举，且零 warning（不再有隐式升档）', async () => {
  const cases = [['480p', '480P'], ['736p', '736P'], ['2k', '2K']]
  for (const [tier, native] of cases) {
    const { calls, restore } = stubFetch(t2vHandlers())
    restoreFetch = restore
    const outcome = await runVideo(createFalProvider(), baseReq({ capability: 'text-to-video', resolution: tier }), { ...KEY_CTX, pollIntervalMs: 1 })
    assert.equal(calls[0].body.input.resolution, native, `${tier} → ${native}`)
    assert.equal(outcome.warnings, undefined, `${tier} 不应产生 warning`)
  }
})

// ——————————————————————————————————————————————————————————————
// 两处工具参数不许漂移（同一规则只准一份实现）
// ——————————————————————————————————————————————————————————————
test('工具参数守卫：video_generate / video_composite 的 resolution 必须共用同一份 enum 与描述', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'host-tools.ts'), 'utf8')
  // 同一 enum 抄两遍是这类参数最典型的漂移路径：改了 video_generate 忘了 video_composite。
  assert.equal(
    (src.match(/resolution: \{ type: 'string' as const, enum: RESOLUTION_ENUM, description: RESOLUTION_PARAM_DESC \}/g) ?? []).length,
    2,
    '两处 resolution 参数必须共用 RESOLUTION_ENUM / RESOLUTION_PARAM_DESC',
  )
  // 旧枚举不得残留在工具参数里（历史值只在 fal.ts 的 LEGACY_RESOLUTION 里承认）。
  assert.equal(/enum: \['736p', '1080p', '720p', '2k'\]/.test(src), false, 'host-tools.ts 不应残留旧四档 enum')
})

// ——————————————————————————————————————————————————————————————
// I/J 组 · CV-188：视频侧像素以**实测**为准
//
// 为什么需要这两组：`OUTPUT_SIZE` 是「档位 → 像素」的**声明**，而视频端点的像素由
// **供应商**决定 —— Drama 现按档发 `megapixels`（默认 736p→0.9MP），落盘仍以实测为准
//（不采信档位声明值，防御后端实际口径与档位不符时落盘假数字）。把声明值当真实产物落进
// `mediaWidth/mediaHeight`，详情面板就会给
// 每个视频显示一个假数字，且后端哪天改口径这个假数字会**静默**跟着错（客户端只在
// `mediaWidth === undefined` 时用自然尺寸回填 ⇒ 已写入的错值永不被纠正）。
// ——————————————————————————————————————————————————————————————

/**
 * 真 ffmpeg 可执行文件；无则返回 null（用例软跳过）。
 *
 * 解析链落空有两个常见原因，**都不代表本机没有 ffmpeg**：① 进程 PATH 被裁剪
 * （Electron / 沙箱 shell 只继承窄 PATH）；② `ffmpeg-static` 只落了包壳、二进制
 * 未下载。故补一层常见安装位置探测 —— 否则本用例会在有 ffmpeg 的机器上**静默空绿**。
 */
async function findRealFfmpeg() {
  try { return resolveFfmpegPath() } catch { /* 落到常见路径探测 */ }
  const common = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
  for (const candidate of common) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* 试下一个 */ }
  }
  return null
}

/** 用真 ffmpeg 造一个指定尺寸的 mp4（模拟供应商的真实产物）。 */
async function makeClip(ffmpegPath, path, size) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-f', 'lavfi', '-i', `color=c=gray:s=${size}:d=0.3`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path,
    ], { stdio: ['ignore', 'ignore', 'ignore'] })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`造测试产物失败，ffmpeg 退出 ${code}`)))
  })
}

const REAL_FFMPEG_SKIP = process.platform === 'win32' && '依赖 POSIX 行为'

test('J probeMediaInfo：一次探测同时给出时长与分辨率；失败只回 duration 0，不抛也不臆造尺寸', { skip: REAL_FFMPEG_SKIP }, async () => {
  const ffmpegPath = await findRealFfmpeg()
  const dir = await mkdtemp(join(tmpdir(), 'cs-mi-'))
  try {
    const junk = join(dir, 'junk.mp4')
    await writeFile(junk, 'NOT A VIDEO AT ALL')
    // 核心不变量：探测失败 = duration 0 + 尺寸字段缺失（调用方据此回退声明值），
    // 既不抛给生成主路径，也不给出一个臆造的尺寸。
    const failed = await probeMediaInfo(junk)
    assert.equal(failed.duration, 0, '非媒体文件应返回 duration 0')
    assert.equal(failed.width, undefined, '探测失败不得给出宽度')
    assert.equal(failed.height, undefined, '探测失败不得给出高度')
    assert.equal((await probeMediaInfo(join(dir, 'missing.mp4'))).duration, 0, '不存在的路径应返回 duration 0')

    if (ffmpegPath === null) return // 本机无 ffmpeg：失败回退已验，正向留给有 ffmpeg 的环境
    const clip = join(dir, 'clip.mp4')
    await makeClip(ffmpegPath, clip, '864x480')
    const info = await probeMediaInfo(clip, ffmpegPath)
    assert.ok(info.duration > 0, `应探到时长，实得 ${info.duration}`)
    assert.equal(info.width, 864, '宽度必须是实测值')
    assert.equal(info.height, 480, '高度必须是实测值')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('I 视频侧实测为准：Drama 按档发 megapixels（默认 736p→0.9MP），落盘仍取实测 864×480，而非档位声明值 1280×736', { skip: REAL_FFMPEG_SKIP }, async () => {
  const ffmpegPath = await findRealFfmpeg()
  if (ffmpegPath === null) return

  const dir = await mkdtemp(join(tmpdir(), 'cs-restier-'))
  const originalFetch = globalThis.fetch
  // generate.ts 内部按 `resolveFfmpegPath()`（无显式参数）解析，故这里用 FFMPEG_PATH 注入，
  // 让**被测的那条生产路径**真跑到 ffmpeg（与 tests/video-provider-fal-refs.test.mjs 同一手法）。
  const originalFfmpegPath = process.env.FFMPEG_PATH
  process.env.FFMPEG_PATH = ffmpegPath
  try {
    // 「供应商真实产物」：864×480（本用例模拟供应商实际返回；Drama 现按档发 megapixels，
    // 但落盘仍以实测为准，不采信档位声明值）。
    const clip = join(dir, 'drama-product.mp4')
    await makeClip(ffmpegPath, clip, '864x480')
    const bytes = new Uint8Array(await readFile(clip))

    const mediaUrl = 'https://media.example/drama-0.4mp.mp4'
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/api/v1/health')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
      if ((init.method ?? 'GET') === 'POST') return { ok: true, status: 200, json: async () => ({ full_url: mediaUrl }), text: async () => '' }
      if (text === mediaUrl) return { ok: true, status: 200, arrayBuffer: async () => bytes, text: async () => '' }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    }
    restoreFetch = () => { globalThis.fetch = originalFetch }

    const writes = []
    const registry = {
      list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
      assetsDir: () => dir,
      readCanvas: async () => ({ version: 3, nodes: [] }),
      writeCanvas: async (_id, nodes) => { writes.push([...nodes]) },
      appendCanvasNode: async (_id, node) => { writes.push([node]) },
    }

    // 不传 resolution ⇒ 走默认档 736p（声明 1280×736）。
    const result = await generateAsset(registry, 'video_generate', 'p1', { prompt: 'p', aspectRatio: '16:9', duration: 5 })

    const node = writes.flat().find((entry) => entry.kind === 'video')
    assert.ok(node, '应落盘一个视频节点')
    assert.deepEqual(
      { width: node.mediaWidth, height: node.mediaHeight },
      { width: 864, height: 480 },
      '落盘分辨率必须是 ffmpeg 实测的 864×480 —— 真实产物以实测为准，不得回退成档位声明值',
    )
    assert.notDeepEqual(
      { width: node.mediaWidth, height: node.mediaHeight },
      OUTPUT_SIZE[DEFAULT_RESOLUTION],
      '不得回退成档位声明值：那正是「详情面板给每个视频显示假数字」的成因',
    )
    // 工具返回值同样是实测真值（agent 拿它判断产物规格）。
    assert.equal(result.width, 864, '工具返回值宽度应为实测值')
    assert.equal(result.height, 480, '工具返回值高度应为实测值')
  } finally {
    globalThis.fetch = originalFetch
    if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = originalFfmpegPath
    await rm(dir, { recursive: true, force: true })
  }
})

// ——————————————————————————————————————————————————————————————
// K 组 · 客户端自愈：媒体加载后「不一致就纠正」
//
// 为什么需要这条：I 组只管住了**新生成**的节点。已落盘的老节点（CV-188 之前生成的
// 视频）存的是历史假值（1280×720 / 1376×768），而客户端此前**只在 `mediaWidth`
// 缺失时**才用自然尺寸回填 ⇒ 错值永不被纠正 —— 用户打开老项目看到的仍是假数字。
// 这条行为发生在浏览器里（React 组件加载媒体后），单测无法渲染它，故用源码闸 +
// **反向验证**顶替：改回「只在缺失时回填」必须让本组红。
// ——————————————————————————————————————————————————————————————
test('K 客户端自愈：媒体加载后「不一致就纠正」，不得退回「只在缺失时回填」', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'client', 'StudioFrame.tsx'), 'utf8')
  // 剥注释：上面那段说明本身就写着这两个字面量，不剥会把「说明文字」当成实现。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    /target\.mediaWidth\s*!==\s*naturalWidth/.test(code),
    'handleMediaNatural 必须做「不一致就纠正」—— 否则老节点里的假分辨率永远留在画布上',
  )
  assert.equal(
    /target\.mediaWidth\s*===\s*undefined/.test(code),
    false,
    '不得退回「只在缺失时回填」：那正是老节点假数字无法自愈的原因',
  )
})
