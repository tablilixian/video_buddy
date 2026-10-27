/**
 * 分辨率三档分级 —— 表-码对齐、像素映射、历史值归一、四层决策。
 *
 * 本文件的定位：**`RESOLUTION_TIERS` 是「声明的分辨率 = 真实产物 = 后台真值」这条不变式
 * 的唯一落点**。把它改成 `1920×1080`（看起来更「标准」）或 `1280×720`（回到旧值）之后，
 * 全仓其余测试照样全绿，只有画布上多看几 px、详情面板的数字变假 —— 这类静默失败只有
 * 断言拦得住。故期望值**硬编码自 H3 推荐分辨率表，不引用实现**（防「两边一起错」的空绿）。
 *
 * 2026-10-27 拍板后的口径：
 *   - 内部键 / 显示名 / 真值三者同表：`480p → 480P → 0.4MP → 864×480`、
 *     `720p → 720P → 1.0MP → 1376×768`、`1080p → 1080P → 2.0MP → 1920×1088`。
 *   - 旧键 `736p`（当时 0.9MP / 1280×736）与 `2k` 只作**读路径别名**存在，写路径永不产生。
 *
 * 直连 Host 侧编译产物 lib/*.js。运行：yarn test:smoke
 *
 * 反向验证（改了实现必须让它红，改完恢复）：
 *   - 把 `RESOLUTION_TIERS` 里 720p 的 megapixels 改回 0.9 → H 组必须红
 *   - 把 `RESOLUTION_TIERS` 里 720p 的 deprecatedAliases 清空 → B 组必须红
 *   - 把 `resolveResolution` 的 plan 层删掉 → R 组必须红
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
import { MEGAPIXELS_BY_RESOLUTION } from '../lib/output-size.js'
import { RESOLUTION_TIERS, RESOLUTION_IDS, normalizeResolutionId, resolutionIdsFor, isResolutionIdFor, resolutionLabelOf } from '../lib/resolution-tiers.js'
import { resolveResolution } from '../lib/resolution-resolve.js'
import { RESOLUTION_DISPLAY, RESOLUTION_OPTIONS, resolutionOptionsWith, resolutionUpgradeTargets } from '../lib/resolution-display.js'
import { normalizePlan } from '../lib/contracts/project.js'
import { resolveStudioDefaults } from '../lib/studio-defaults.js'
import { createFalProvider, normalizeResolution } from '../lib/providers/fal.js'
import { runVideo } from '../lib/providers/executor.js'
import { probeMediaInfo, resolveFfmpegPath } from '../lib/ffmpeg-run.js'
import { generateAsset } from '../lib/generate.js'

/**
 * H3 推荐分辨率表（megapixels → 输出像素），**硬编码、不引用实现**。
 * 来源：H3 官方视频生成推荐分辨率表，0.4 / 1.0 / 2.0 三行；宽高均为 32 的倍数。
 */
const H3_TABLE = {
  '480p': { megapixels: 0.4, width: 864, height: 480, label: '480P' },
  '720p': { megapixels: 1.0, width: 1376, height: 768, label: '720P' },
  '1080p': { megapixels: 2.0, width: 1920, height: 1088, label: '1080P' },
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
test('H 表-码对齐：档位表必须逐字节等于 H3 推荐表，且宽高均为 32 的倍数', () => {
  assert.deepEqual(Object.keys(OUTPUT_SIZE).sort(), ['1080p', '480p', '720p'], '档位恰好三档（规范键）')
  for (const [tier, row] of Object.entries(H3_TABLE)) {
    assert.deepEqual(
      OUTPUT_SIZE[tier],
      { width: row.width, height: row.height },
      `${tier} 必须等于 H3 表输出 ${row.width}×${row.height}（H3 的 multiple=32 规则）`,
    )
    // 视频端点只收 megapixels、不收像素；像素只能由这张表反推。
    assert.equal(MEGAPIXELS_BY_RESOLUTION[tier], row.megapixels, `${tier} 的 megapixels 必须等于 H3 表 ${row.megapixels}`)
    // 非 32 倍数会被引擎重采样或补边 ⇒ 首帧与产物规格不一致。
    assert.equal(row.width % 32, 0, `${tier} 宽 ${row.width} 不是 32 的倍数`)
    assert.equal(row.height % 32, 0, `${tier} 高 ${row.height} 不是 32 的倍数`)
  }
})

test('H 单一事实源：显示口径 / 设置项 / 标签 / 枚举全部派生自同一张表', () => {
  assert.deepEqual([...RESOLUTION_IDS], ['480p', '720p', '1080p'], '规范键顺序 = 菜单顺序')
  assert.deepEqual(
    RESOLUTION_DISPLAY.map(entry => ({ value: entry.value, label: entry.label })),
    Object.entries(H3_TABLE).map(([value, row]) => ({ value, label: row.label })),
    'RESOLUTION_DISPLAY 必须与表逐项一致（漂移即两种说法）',
  )
  // 设置页下拉**必须带真实像素**：光写「720P」会让人以为产物是 1280×720。
  assert.deepEqual(
    RESOLUTION_OPTIONS.map(option => option.text),
    Object.entries(H3_TABLE).map(([, row]) => `${row.label} · ${row.width}×${row.height}`),
    '设置项文案必须是「通用称呼 · 真实像素」',
  )
  for (const tier of RESOLUTION_TIERS) {
    assert.equal(resolutionLabelOf(tier.id), tier.label, `${tier.id} 的显示名取自同表`)
  }
})

test('H 默认档与设置项默认值同源（DEFAULT_RESOLUTION 在三档之内且为 720p）', () => {
  assert.equal(isVideoResolution(DEFAULT_RESOLUTION), true, 'DEFAULT_RESOLUTION 必须是合法档位')
  assert.equal(DEFAULT_RESOLUTION, '720p', '默认档 = 720p（H3 官方推荐档，1.0MP / 1376×768）')
})

test('H 旧键零残留：写路径不得再出现 736p / 2k（只允许作为读路径别名存在）', () => {
  const aliases = RESOLUTION_TIERS.flatMap(tier => [...tier.deprecatedAliases])
  assert.deepEqual(aliases.sort(), ['2k', '736p'], '历史别名必须且只能是这两个')
  // 写路径 = OutputSize 的键。别名一旦混进键里，新生成就会写出旧键。
  for (const legacy of aliases) {
    assert.equal(Object.hasOwn(OUTPUT_SIZE, legacy), false, `${legacy} 不得作为写路径键存在`)
  }
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
  for (const junk of ['4k', '1080P', '720P', '480P', '', 'giant', '2K', '736P']) {
    assert.equal(normalizeResolution(junk), undefined, `未知值 ${junk} 应返回 undefined 而非抛错`)
  }
})

test('B 历史值归一：旧 736p / 2k 就地归一（老节点重试不得崩）', () => {
  // 画布节点里的 generationPrompt 是历史数据的真实来源：删掉这两个别名后若直接查表，
  // 老节点重试会在 fal.ts 的取值处撞上 undefined 抛 TypeError（整次生成崩掉）。
  assert.equal(normalizeResolution('736p'), '720p', '旧 736p 归一到 720P（H3 官方 1.0MP 档）')
  assert.equal(normalizeResolution('2k'), '1080p', '旧 2k 归一到 1080P')
  assert.equal(normalizeResolutionId('736p'), '720p', 'resolve 层的归一同源')
})

// ——————————————————————————————————————————————————————————————
// R 组 · 四层决策（节点 > 项目预置 > 设置页 > 出厂）
//
// 为什么要有这一组：改造前三处 UI 各有各的 fallback（输入框 `|| '736p'`、画布角标
// `|| '480p'`），于是同一个视频节点在三处显示三个档位、实际出片又是第四个数。
// 决策收口到 resolveResolution 之后，UI 与生成链读的是同一个函数 —— 本组锁住它的层级
// 与来源，改了顺序（比如让设置页盖过项目预置）必须红。
// ——————————————————————————————————————————————————————————————
test('R resolveResolution：四层优先且带来源', () => {
  const all = { nodeValue: '1080p', planValue: '480p', settingValue: '720p' }
  assert.deepEqual(resolveResolution(all), { id: '1080p', source: 'node' }, '节点显式最优先')
  assert.deepEqual(
    resolveResolution({ planValue: '480p', settingValue: '720p' }),
    { id: '480p', source: 'plan' },
    '项目预置次之（首页锁定的档位必须盖过设置页）',
  )
  assert.deepEqual(resolveResolution({ settingValue: '720p' }), { id: '720p', source: 'settings' }, '设置页再次')
  assert.deepEqual(resolveResolution({}), { id: DEFAULT_RESOLUTION, source: 'fallback' }, '全缺省落出厂默认')
})

test('R resolveResolution：脏值逐层丢弃、不阻断后续层', () => {
  // 一个坏字段不该让整条链失效（老项目里 plan.resolution 可能是 null / 数字 / 旧拼写）。
  assert.deepEqual(
    resolveResolution({ nodeValue: 'giant', planValue: 1080, settingValue: '480p' }),
    { id: '480p', source: 'settings' },
    '节点与项目层的脏值必须继续往下落，而不是被当成"已指定"',
  )
  // 历史键在任一层的归一时机必须一致。
  assert.deepEqual(resolveResolution({ nodeValue: '736p' }), { id: '720p', source: 'node' }, '节点旧键按节点层归一')
  assert.deepEqual(resolveResolution({ planValue: '2k' }), { id: '1080p', source: 'plan' }, '项目旧键按项目层归一')
  assert.deepEqual(resolveResolution({ nodeValue: null, planValue: '' }), { id: DEFAULT_RESOLUTION, source: 'fallback' }, '空串 / null 视为未指定')
})

// ——————————————————————————————————————————————————————————————
// A/B/C 组 · fal 端到端（走 runVideo，验真实请求体 + warnings）
// ——————————————————————————————————————————————————————————————
test('A fal 三档直通：请求体落 fal 原生枚举，且零 warning（不再有隐式升档）', async () => {
  // fal 官方端点 schema 只有 480P / 768P / 2K / 4K 四个枚举 —— 不存在 `736P`。
  // 故 720p 必须映射到 768P（原生生成档）；写成 736P 会被端点 422。
  const cases = [['480p', '480P'], ['720p', '768P'], ['1080p', '2K']]
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
    '两处视频 resolution 参数必须共用 RESOLUTION_ENUM / RESOLUTION_PARAM_DESC',
  )
  // 枚举派生自 OUTPUT_SIZE 的键，不得手抄字面量数组。
  assert.ok(
    /const RESOLUTION_ENUM = Object\.keys\(OUTPUT_SIZE\)/.test(src),
    'RESOLUTION_ENUM 必须派生自 OUTPUT_SIZE（手抄数组会与档位表漂移）',
  )
  // 旧档位不得残留在工具参数里（历史值只在 resolution-tiers.ts 的 deprecatedAliases 里承认）。
  for (const legacy of ['736p', '2k']) {
    assert.equal(new RegExp(`enum: \\[[^\\]]*'${legacy}'`).test(src), false, `host-tools.ts 不应残留旧档位 ${legacy}`)
  }
})

// ——————————————————————————————————————————————————————————————
// I/J 组 · 视频侧像素以**实测**为准
//
// 为什么需要这两组：`OUTPUT_SIZE` 是「档位 → 像素」的**声明**，而视频端点的像素由
// **供应商**决定 —— Drama 现按档发 `megapixels`（默认 720p→1.0MP），落盘仍以实测为准
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

test('I 视频侧实测为准：落盘取实测 864×480，而非档位声明值 1376×768', { skip: REAL_FFMPEG_SKIP }, async () => {
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
      // 后端 0.5.0：视频提交 202 + job_id，状态/结果走 /api/v1/jobs/*。
      if ((init.method ?? 'GET') === 'POST' && text.includes('image2video')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ job_id: 'job-restier', status: 'pending', status_url: '/api/v1/jobs/job-restier', cancel_url: '/api/v1/jobs/job-restier/cancel', result_url: '/api/v1/jobs/job-restier/result' }),
          text: async () => '',
        }
      }
      if (text.includes('/api/v1/jobs/job-restier/result')) {
        return { ok: true, status: 200, json: async () => ({ prompt_id: 'job-restier', filename: 'drama.mp4', full_url: mediaUrl, duration: 8.5 }), text: async () => '' }
      }
      if (text.includes('/api/v1/jobs/job-restier')) {
        return { ok: true, status: 200, json: async () => ({ job_id: 'job-restier', status: 'completed', create_time: 1, execution_end_time: 2, execution_error: null }), text: async () => '' }
      }
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

    // 不传 resolution ⇒ 走默认档 720p（声明 1376×768）。
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
    /if\s*\(\s*target\.mediaWidth\s*===\s*undefined/.test(code),
    false,
    '不得把回填门收窄为「只在缺失时回填」：那正是老节点假数字无法自愈的原因',
  )
  // CV-284 懒迁移：从未量过分辨率的节点（旧规则框）必须在首次加载时按自然
  // 像素重设 —— neverMeasured 与比例偏差共用同一条 resize 出口。
  assert.ok(
    /const neverMeasured = target\.mediaWidth === undefined \|\| target\.mediaHeight === undefined/.test(code),
    '懒迁移分支必须在位：缺 mediaWidth/Height 的节点首次加载即重设尺寸',
  )
  assert.ok(
    /if \(neverMeasured \|\| ratioOff\)/.test(code),
    '重设出口必须同时覆盖懒迁移与比例偏差两条触发',
  )
})

// ——————————————————————————————————————————————————————————————
// M 组 · 三处读数一致（本次改造的核心不变式）
//
// 改造前的病不是「文案写错」，而是**有三份判定**：输入卡 `|| '736p'`、画布角标
// `|| '480p'`、生成链读设置页 —— 同一个视频节点在三处显示三个档位，实际出片是第四个。
// 所以「都调了 resolveResolution」比「显示对了」更重要：显示对了可以靠改文案骗过去，
// 判定同源才是结构上不可能漂移。
// 反向验证：把任一处改回字面量 fallback → 本组必须红。
// ——————————————————————————————————————————————————————————————
test('M 三处读数同源：输入卡 / 画布角标 / 生成链都走唯一 resolver', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const sites = [
    ['src/generate.ts', '生成链（resolutionOf）'],
    ['src/client/canvas/NodeInputCard.tsx', '节点输入卡 chip'],
    ['src/client/canvas/CanvasNode.tsx', '画布角标'],
  ]
  for (const [rel, label] of sites) {
    const code = readFileSync(join(here, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(code, /resolveResolution\(\{/, `${label} 必须走 resolveResolution（三份判定就是歧义的根因）`)
    // 反向：任何一档被写死成 fallback，就等于重新长出第二份判定。
    for (const legacy of ["'480p'", "'720p'", "'1080p'", "'736p'", "'2k'"]) {
      assert.equal(
        new RegExp(`(\\|\\||\\?\\?)\\s*${legacy}`).test(code),
        false,
        `${label} 不得写死 \`|| ${legacy}\` 兜底 —— 那正是「同一节点三处显示三个档位」的成因`,
      )
    }
  }
})

test('M 详情面板显示名过展示口径：内部键不得糊到用户脸上', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const drawer = readFileSync(join(here, '..', 'src', 'client', 'canvas', 'NodeDetailDrawer.tsx'), 'utf8')
  assert.match(
    drawer,
    /resolutionDisplay\(value\)\.label/,
    '详情面板的「声明档位」必须经 resolutionDisplay 归一（否则老节点会显示「736p」而角标显示「720P」）',
  )
})

test('M 设置项 schema 收留历史键（老配置不许因一个旧值整页读不出来）', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'host-config.ts'), 'utf8')
  assert.match(
    src,
    /const RESOLUTION_SETTING_KEYS = \[\n\s*\.\.\.RESOLUTION_IDS,\n\s*\.\.\.RESOLUTION_TIERS\.flatMap\(tier => tier\.deprecatedAliases\),\n\s*\]/,
    'RESOLUTION_SETTING_KEYS 必须 = 规范键 + 历史别名（派生，不手抄）',
  )
  // 设置项默认值也必须取自表，不许再写裸字面量（改造前两处各写一遍）。
  assert.match(
    src,
    /defaultImageResolution: z\.union\(RESOLUTION_SETTING_KEYS\)\.default\(DEFAULT_RESOLUTION\)/,
    '图片默认档的用户默认值必须取 DEFAULT_RESOLUTION（= 表里的出厂默认 720P）',
  )
  assert.match(
    src,
    /defaultVideoResolution: z\.union\(RESOLUTION_SETTING_KEYS\)\.default\(DEFAULT_VIDEO_RESOLUTION_ID\)/,
    '视频默认档必须引用 DEFAULT_VIDEO_RESOLUTION_ID（= 表里的 480p，不再写裸字面量）',
  )
})

// ——————————————————————————————————————————————————————————————
// L C-8 文案真值闸（2026-10-02）：视频出厂默认是 480p（defaultVideoResolution），
// 与图片默认 720p 分设。工具描述曾把某档标成「视频默认」，agent 照做显式传值，
// 静默盖过用户的设置（Bug C-8）。这类文案没有类型系统可拦，用源码闸钉住：再写错直接红。
// ——————————————————————————————————————————————————————————————
test('L C-8 视频描述真值：写明出厂 480P 与「传参即显式覆盖」，不得把任何一档标成默认', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'host-tools.ts'), 'utf8')
  const videoDesc = src.slice(src.indexOf('const RESOLUTION_PARAM_DESC'), src.indexOf('const IMAGE_RESOLUTION_PARAM_DESC'))
  assert.ok(
    !/\(\s*\d+×\d+\s*[，,]\s*默认\s*\)/.test(videoDesc),
    '视频描述不得把任何一档标成「默认」——视频出厂默认是 480p（C-8）',
  )
  assert.ok(
    videoDesc.includes('出厂 480P'),
    '视频描述必须写明出厂默认 480P（若默认档真要改，同步改 host-config 与本闸）',
  )
  assert.ok(
    videoDesc.includes('显式覆盖'),
    '视频描述必须讲清「传参即显式覆盖用户设置」，否则 agent 会替用户做分辨率决定',
  )
  // 缺省顺序必须写全三层，否则 agent 不知道项目预置优先。
  assert.ok(
    /项目预置.*设置页.*出厂/.test(videoDesc),
    '视频描述必须写全缺省顺序：项目预置 → 设置页 → 出厂',
  )
  const imageDesc = src.slice(src.indexOf('const IMAGE_RESOLUTION_PARAM_DESC'), src.indexOf('const QUESTION_WAIT_MS'))
  assert.ok(
    imageDesc.includes('出厂 720P'),
    '图片描述保留出厂默认口径（图片出厂默认是 720P，此处改动需同步 host-config）',
  )
})

test('L C-8 设置 UI 真值：图片下拉走 image 视图、视频下拉走 video 视图（都派生自档位表）', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const name of ['SettingsModal.tsx', 'FirstRunSettings.tsx']) {
    const src = readFileSync(join(here, '..', 'src', 'client', name), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 手写 <option> 是这里最典型的漂移路径：改了档位表忘了这个 <select>。
    // 2026-10-27「图片下限 720P」后两侧不再共用同一份常量：图片必须走
    // `resolutionOptionsWith('image', …)`（它还会把存量 480p 补进列表，否则
    // `<select>` 找不到当前值会渲染成空白），视频走 RESOLUTION_OPTIONS。
    assert.equal(
      (code.match(/\{resolutionOptionsWith\('image'/g) ?? []).length,
      1,
      `${name}：图片下拉必须由 resolutionOptionsWith('image', …) 派生（含存量值兜底）`,
    )
    assert.equal(
      (code.match(/\{RESOLUTION_OPTIONS\.map\(/g) ?? []).length,
      1,
      `${name}：视频下拉必须由 RESOLUTION_OPTIONS 派生`,
    )
    // 内部键裸名（736p / 2k）不得再出现在用户可见的 option 里。
    for (const legacy of ['736p', '2k']) {
      assert.equal(
        new RegExp(`value="${legacy}"`).test(code),
        false,
        `${name}：不得再出现旧档位 ${legacy} 的 option 值`,
      )
    }
  }
})

// ——————————————————————————————————————————————————————————————
// N 适用范围（2026-10-27 二次拍板：图片下限 720P、项目预置只管视频）
//
// 这一组守的是**产品口径**不是实现细节：480P 从图片菜单里消失、且不因为首页
// 选了清晰度就偷偷回到图片链路上。反向验证：把 `480p.scopes` 改回
// `['image','video']` → N 组必须红；把 `studio-defaults` 的 image 分支加回
// `planValue` → N5 必须红。
// ——————————————————————————————————————————————————————————————
test('N1 图片下限 720P：480P 只对视频开放，项目预置视图已并入视频视图', () => {
  assert.deepEqual([...resolutionIdsFor('image')], ['720p', '1080p'], '图片只有两档（480P 不得出现）')
  assert.deepEqual([...resolutionIdsFor('video')], ['480p', '720p', '1080p'], '视频三档全开（480P 是出厂默认）')
  assert.equal(isResolutionIdFor('480p', 'image'), false, '480P 对图片非法')
  assert.equal(isResolutionIdFor('480p', 'video'), true)
  assert.equal(isResolutionIdFor('720p', 'image'), true)
  // 旧键经归一后按规范档判（存量 736p 的图片节点仍算 720p，合法）。
  assert.equal(isResolutionIdFor('736p', 'image'), true, '历史键归一后不越界')
  // 脏值一律不合法（菜单不该被 undefined 撑出一格）。
  assert.equal(isResolutionIdFor('whatever', 'video'), false)
  // 读路径仍然宽容：存量 480P 图片节点必须能读、能重放（只修产生路径，不动存量）。
  assert.equal(normalizeResolutionId('480p'), '480p')
})

test('N2 升档候选：只列严格更高的档，像素按节点画幅算', () => {
  // 480P 出发：720P / 1080P 两档可升。
  const from480 = resolutionUpgradeTargets('480p', '16:9')
  assert.deepEqual(from480.map(t => t.value), ['720p', '1080p'])
  assert.deepEqual([from480[0].frame.width, from480[0].frame.height], [1376, 768], '16:9 的 720P 是 1376×768')
  assert.equal(from480[0].action, '升 720P 重出 · 1376×768')
  // 竖屏取反宽高 —— 显示 16:9 的像素就是在骗人。
  const portrait = resolutionUpgradeTargets('480p', '9:16')
  assert.deepEqual([portrait[0].frame.width, portrait[0].frame.height], [768, 1376], '9:16 的 720P 是 768×1376')
  // 已经是最高档：没有可升项（不能出现「升 1080P」这种空转）。
  assert.deepEqual([...resolutionUpgradeTargets('1080p', '16:9')], [])
  // 中间档只剩更高的一档。
  assert.deepEqual(resolutionUpgradeTargets('720p', '16:9').map(t => t.value), ['1080p'])
  // 历史键当规范档比大小（存量 736p 节点不该把 720P 又列成可升项）。
  assert.deepEqual(resolutionUpgradeTargets('736p', '16:9').map(t => t.value), ['1080p'])
  // 未知值 → 全档可升（没有当前档就没有「向上」的基线）。
  assert.equal(resolutionUpgradeTargets(undefined, '16:9').length, 3)
})

test('N3 下拉选项保证当前值在列表里（否则 <select> 渲染空白＝对用户说谎）', () => {
  // 图片侧正常值：不追加。
  assert.deepEqual(resolutionOptionsWith('image', '720p').map(o => o.value), ['720p', '1080p'])
  // 图片侧躺着已停用的 480p：必须补一行并标注，否则下拉显示空白。
  const stale = resolutionOptionsWith('image', '480p')
  assert.deepEqual(stale.map(o => o.value), ['720p', '1080p', '480p'], '存量值必须出现在列表里')
  assert.match(stale[2].text, /已停用/u, '而且要标明它已停用（不许看起来像个正常选项）')
  // 视频侧三档全在，任何历史值归一后都命中，不追加。
  assert.deepEqual(resolutionOptionsWith('video', '736p').map(o => o.value), ['480p', '720p', '1080p'])
  assert.deepEqual(resolutionOptionsWith('video', 'whatever').map(o => o.value), ['480p', '720p', '1080p'])
})

test('N4 项目预置键名 = videoResolution，旧键 resolution 仅作读路径兼容', () => {
  // 新键读入。
  assert.deepEqual(normalizePlan({ videoResolution: '720p' }), { videoResolution: '720p' })
  // 旧键（2026-10-27 当日短暂存在）照读，并落到新键上。
  assert.deepEqual(normalizePlan({ resolution: '1080p' }), { videoResolution: '1080p' }, '旧键必须归一为新键名')
  // 两个都在：新键优先。
  assert.deepEqual(normalizePlan({ resolution: '480p', videoResolution: '720p' }), { videoResolution: '720p' })
  // 历史档位键同样归一。
  assert.deepEqual(normalizePlan({ resolution: '736p' }), { videoResolution: '720p' })
  // 脏值丢弃该项但不牵连其他项。
  assert.deepEqual(normalizePlan({ videoResolution: 'junk', aspectRatio: '9:16' }), { aspectRatio: '9:16' })
  // 全空 → undefined（调用方据此「不写该字段」）。
  assert.equal(normalizePlan({ resolution: 'junk' }), undefined)
})

test('N5 生效链路：图片不读项目预置，视频才读（scope 硬边界）', () => {
  const plan = { videoResolution: '1080p' }
  // 视频：预置压过设置页。
  const video = resolveStudioDefaults({ plan, settings: { defaultVideoResolution: '480p', defaultImageResolution: '720p' } })
  assert.equal(video.videoResolution, '1080p')
  assert.equal(video.videoResolutionSource, 'plan')
  // 图片：预置**不参与**，仍是设置页的值。
  assert.equal(video.imageResolution, '720p', '项目预置只作用于视频，图片走设置页')
  assert.equal(video.imageResolutionSource, 'settings')
  // 图片没设置时落到出厂 720P（不是 480P —— 图片下限就是 720P）。
  const bare = resolveStudioDefaults({ plan, settings: {} })
  assert.equal(bare.imageResolution, '720p')
  assert.equal(bare.imageResolutionSource, 'fallback')
})
