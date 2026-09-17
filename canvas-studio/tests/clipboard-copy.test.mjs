/**
 * CV-198 复制到系统剪贴板（clipboard-copy.ts）判定表 + 接线守卫。
 *
 * 这套断言来自一个**真实的踩坑面**：剪贴板 API 的失败在浏览器里是**静默**的。
 * `writeText` 被拒（非安全上下文 / 没有用户手势 / 权限被撤）时不会有任何界面
 * 反应，于是「点了没反应」成了这条链路的默认表现形态。此前仓里三处复制
 * （@ref 引用降级、技能提示词降级、抽屉提示词按钮）全都各自
 * `navigator.clipboard.writeText(...)`：一处 `.catch(() => {})` 把失败吞掉，
 * 一处根本没 catch（未处理的 rejection，按钮永远不显示「已复制」）。
 *
 * 所以本文件守四件事：
 *
 * 1. **判定表逐格**（纯函数）——哪些节点可复制、复制的是什么、视频/音频必须没有；
 * 2. **PNG 转码方向**——非 PNG 一律要重编码（剪贴板只认 PNG）；
 * 3. **失败分阶段归类 + 文案带下一步**——「取资产失败」与「写入被拒」的补救
 *    办法不同，文案必须指回一定能走通的那条路（下载资产）；
 * 4. **接线真的在、且唯一**——`navigator.clipboard` 只允许出现在
 *    `client/canvas/clipboard-env.ts` 一处；菜单项由计划驱动渲染。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import {
  CLIPBOARD_LABELS,
  clipboardPlanOf,
  clipboardResultMessage,
  clipboardTextOf,
  classifyClipboardFailure,
  copyNodeToClipboard,
  copyTextToClipboard,
  errorTextOf,
  pngTranscodeNeeded,
} from '../lib/clipboard-copy.js'

/** 只剥块注释与整行注释（叮嘱会长在注释里，见 approval-gate.test 同一理由）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** 造一个最小节点（只填本链路关心的字段）。 */
function node(overrides) {
  return { id: 'n1', kind: 'image', x: 0, y: 0, width: 100, height: 100, createdAt: 0, origin: 'agent', sourceIds: [], ...overrides }
}

/** 记录调用的假环境。 */
function fakeEnv(overrides = {}) {
  const calls = []
  const env = {
    calls,
    available: () => true,
    writeText: async (text) => { calls.push(['writeText', text]) },
    writeImage: async (png) => { calls.push(['writeImage', png.type, png.size]) },
    loadBlob: async () => { calls.push(['loadBlob']); return { type: 'image/png', size: 10 } },
    toPng: async (blob) => { calls.push(['toPng', blob.type, blob.size]); return { type: 'image/png', size: 20 } },
    ...overrides,
  }
  return env
}

// ── 一、复制计划（唯一判定） ─────────────────────────────────────────────────

test('计划：文字类节点送正文，图片类节点送 PNG，视频/音频/托盘没有载荷', () => {
  assert.deepEqual(clipboardPlanOf(node({ kind: 'sticky', text: '便签正文' })), { payload: 'text', text: '便签正文', label: CLIPBOARD_LABELS.text })
  assert.deepEqual(clipboardPlanOf(node({ kind: 'text', text: '文本正文' })), { payload: 'text', text: '文本正文', label: CLIPBOARD_LABELS.text })
  assert.deepEqual(clipboardPlanOf(node({ kind: 'prompt', text: '提示词' })), { payload: 'text', text: '提示词', label: CLIPBOARD_LABELS.text })
  assert.deepEqual(clipboardPlanOf(node({ kind: 'image', url: 'http://x/a.png' })), { payload: 'image', text: '', label: CLIPBOARD_LABELS.image })
  // 用户拍板：视频 / 音频**不**进剪贴板，保留「下载资产」。
  assert.equal(clipboardPlanOf(node({ kind: 'video', url: 'http://x/a.mp4' })), null)
  assert.equal(clipboardPlanOf(node({ kind: 'audio', url: 'http://x/a.mp3' })), null)
  assert.equal(clipboardPlanOf(node({ kind: 'group', text: '托盘' })), null)
})

test('计划：没有载荷的一律 null（空便签、没 url 的图片）', () => {
  assert.equal(clipboardPlanOf(node({ kind: 'sticky' })), null)
  assert.equal(clipboardPlanOf(node({ kind: 'sticky', text: '   \n  ' })), null)
  assert.equal(clipboardPlanOf(node({ kind: 'image' })), null)
  assert.equal(clipboardPlanOf(node({ kind: 'image', url: '' })), null)
})

test('正文：text 原样保留（含换行/缩进），全空白退回标题', () => {
  assert.equal(clipboardTextOf(node({ kind: 'sticky', text: '  第一行\n    第二行  ' })), '  第一行\n    第二行  ')
  assert.equal(clipboardTextOf(node({ kind: 'sticky', text: '  ', title: '标题兜底' })), '标题兜底')
  assert.equal(clipboardTextOf(node({ kind: 'sticky', title: '  ' })), '')
  assert.equal(clipboardTextOf(node({ kind: 'sticky' })), '')
})

test('PNG 转码方向：只有 image/png 跳过，其余（含未知类型）一律重编码', () => {
  assert.equal(pngTranscodeNeeded('image/png'), false)
  assert.equal(pngTranscodeNeeded('IMAGE/PNG'), false)
  assert.equal(pngTranscodeNeeded(' image/png '), false)
  assert.equal(pngTranscodeNeeded('image/webp'), true)
  assert.equal(pngTranscodeNeeded('image/jpeg'), true)
  assert.equal(pngTranscodeNeeded(''), true)
})

// ── 二、复制执行（文字 / 图片两条路） ───────────────────────────────────────

test('文字路径：只调 writeText，正文逐字节传下去', async () => {
  const env = fakeEnv()
  const result = await copyNodeToClipboard(node({ kind: 'sticky', text: ' 一字不改\n换行 ' }), env)
  assert.deepEqual(result, { ok: true, payload: 'text' })
  assert.deepEqual(env.calls, [['writeText', ' 一字不改\n换行 ']])
})

test('图片路径：PNG 直接写，webp 先转码再写（顺序与载荷都要对）', async () => {
  const pngEnv = fakeEnv()
  const png = await copyNodeToClipboard(node({ kind: 'image', url: 'u' }), pngEnv)
  assert.deepEqual(png, { ok: true, payload: 'image' })
  // loadBlob 返回 PNG ⇒ 不该出现 toPng
  assert.deepEqual(pngEnv.calls, [['loadBlob'], ['writeImage', 'image/png', 10]])

  const webpEnv = fakeEnv()
  // 覆盖也要记账 —— 顺序断言才不会因为「少记一步」而假绿。
  webpEnv.loadBlob = async () => { webpEnv.calls.push(['loadBlob']); return { type: 'image/webp', size: 30 } }
  const webp = await copyNodeToClipboard(node({ kind: 'image', url: 'u' }), webpEnv)
  assert.deepEqual(webp, { ok: true, payload: 'image' })
  assert.deepEqual(webpEnv.calls, [['loadBlob'], ['toPng', 'image/webp', 30], ['writeImage', 'image/png', 20]])
})

test('没有载荷：直接返回 empty，一个环境调用都不发', async () => {
  const env = fakeEnv()
  assert.deepEqual(await copyNodeToClipboard(node({ kind: 'video', url: 'u' }), env), { ok: false, payload: null, failure: 'empty', detail: 'unknown' })
  assert.deepEqual(env.calls, [])
})

test('环境没有剪贴板能力：判 no-api，不发任何写请求', async () => {
  const env = fakeEnv({ available: () => false })
  const result = await copyNodeToClipboard(node({ kind: 'sticky', text: 'x' }), env)
  assert.equal(result.ok, false)
  assert.equal(result.failure, 'no-api')
  assert.equal(result.payload, 'text')
  assert.deepEqual(env.calls, [])
})

// ── 三、失败分阶段归类（补救办法不同，必须拆开） ────────────────────────────

test('失败归类：按阶段拆开，write 阶段再按标准错误名细分', async () => {
  // 阶段式（不需要错误名）
  assert.equal(classifyClipboardFailure('plan', new Error('x')), 'empty')
  assert.equal(classifyClipboardFailure('load', new Error('HTTP 404')), 'fetch')
  assert.equal(classifyClipboardFailure('encode', new Error('decode')), 'encode')
  // write 阶段
  assert.equal(classifyClipboardFailure('write', new DOMExceptionLike('NotAllowedError')), 'not-allowed')
  assert.equal(classifyClipboardFailure('write', new DOMExceptionLike('SecurityError')), 'no-api')
  assert.equal(classifyClipboardFailure('write', new Error('boom')), 'write')

  const loadFail = await copyNodeToClipboard(node({ kind: 'image', url: 'u' }), fakeEnv({
    loadBlob: async () => { throw new Error('HTTP 404') },
  }))
  assert.equal(loadFail.failure, 'fetch')
  assert.equal(loadFail.detail, 'HTTP 404')

  const encodeFail = await copyNodeToClipboard(node({ kind: 'image', url: 'u' }), fakeEnv({
    loadBlob: async () => ({ type: 'image/webp', size: 1 }),
    toPng: async () => { throw new Error('decode fail') },
  }))
  assert.equal(encodeFail.failure, 'encode')

  const writeFail = await copyNodeToClipboard(node({ kind: 'image', url: 'u' }), fakeEnv({
    writeImage: async () => { throw new DOMExceptionLike('NotAllowedError') },
  }))
  assert.equal(writeFail.failure, 'not-allowed')
})

/** 一个只有 name / message 的错误（Node 里没有 DOMException 的 name 构造）。 */
class DOMExceptionLike extends Error {
  constructor(name) {
    super(name)
    this.name = name
  }
}

test('copyTextToClipboard 走同一口径（技能提示词 / @ref 标记 / 抽屉按钮）', async () => {
  const ok = fakeEnv()
  assert.deepEqual(await copyTextToClipboard('token', ok), { ok: true, payload: 'text' })
  assert.deepEqual(ok.calls, [['writeText', 'token']])

  const empty = fakeEnv()
  assert.equal((await copyTextToClipboard('   ', empty)).failure, 'empty')
  assert.deepEqual(empty.calls, [])

  const denied = fakeEnv({ available: () => false })
  assert.equal((await copyTextToClipboard('token', denied)).failure, 'no-api')

  const rejected = fakeEnv({ writeText: async () => { throw new DOMExceptionLike('NotAllowedError') } })
  assert.equal((await copyTextToClipboard('token', rejected)).failure, 'not-allowed')
})

// ── 四、文案：失败必须带下一步（否则等于没说） ──────────────────────────────

test('文案：成功说清是什么，失败每条都给下一步；图片侧一律指回「下载资产」', () => {
  assert.match(clipboardResultMessage({ ok: true, payload: 'text' }), /已复制文字/)
  assert.match(clipboardResultMessage({ ok: true, payload: 'image' }), /已复制图片/)
  const failures = ['empty', 'no-api', 'fetch', 'encode', 'not-allowed', 'write']
  for (const failure of failures) {
    const message = clipboardResultMessage({ ok: false, payload: 'image', failure, detail: 'HTTP 404' })
    assert.ok(message.length > 6, `${failure} 的文案太短：${message}`)
    assert.ok(!/^(复制)?失败。?$/.test(message), `${failure} 的文案没给下一步：${message}`)
  }
  // 「取资产 / 转码 / 写入」这三类在图片侧都必须指回一定能走通的「下载资产」。
  for (const failure of ['no-api', 'fetch', 'encode', 'write']) {
    assert.match(clipboardResultMessage({ ok: false, payload: 'image', failure }), /下载资产/, `${failure} 没给可执行的退路`)
  }
  // 权限类尤其要说「再点一次」——那是真机上最常见的一次性失败。
  assert.match(clipboardResultMessage({ ok: false, payload: 'image', failure: 'not-allowed' }), /再点一次/)
  // detail 要能被看见（排障留证），空 detail 不该留下空括号。
  assert.match(clipboardResultMessage({ ok: false, payload: 'image', failure: 'fetch', detail: 'HTTP 404' }), /HTTP 404/)
  assert.ok(!clipboardResultMessage({ ok: false, payload: 'image', failure: 'fetch' }).includes('（）'))
})

test('errorTextOf：DOMException / Error / 字符串 / 空都有话说（不许 undefined 漏进文案）', () => {
  assert.equal(errorTextOf(new Error('boom')), 'boom')
  assert.equal(errorTextOf(new DOMExceptionLike('NotAllowedError')), 'NotAllowedError')
  assert.equal(errorTextOf('raw'), 'raw')
  assert.equal(errorTextOf(undefined), 'unknown')
  assert.equal(errorTextOf(null), 'unknown')
})

// ── 五、接线守卫（判定对了但没接 = 等于没做） ───────────────────────────────

test('接线：`navigator.clipboard` 全仓只允许出现在 clipboard-env.ts 一处', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(entry)) continue
      const source = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      if (/navigator\.clipboard|ClipboardItem|execCommand\(/.test(source) && !full.endsWith('client/canvas/clipboard-env.ts')) {
        offenders.push(full.replace(new URL('../', import.meta.url).pathname, ''))
      }
    }
  }
  walk(new URL('../src', import.meta.url).pathname.replace(/\/$/, ''))
  assert.deepEqual(offenders, [], `这些文件绕开了唯一的剪贴板实现：${offenders.join(', ')}`)
})

test('接线：浏览器环境用的是 ClipboardItem + canvas.toBlob(PNG)，没有假降级分支', () => {
  const source = readSource('../src/client/canvas/clipboard-env.ts')
  assert.match(source, /new ClipboardItem\(\{ 'image\/png': png \}\)/)
  assert.match(source, /canvas\.toBlob\(/)
  assert.match(source, /'image\/png'/)
  assert.match(source, /createImageBitmap\(/)
  // 位图不 close 会一直占着解码后的内存。
  assert.match(source, /bitmap\.close\(\)/)
  // available() 必须真的查能力，不能恒 true（否则 no-api 分支成了死代码）。
  assert.match(source, /available\(\): boolean \{/)
  assert.match(source, /typeof navigator\.clipboard\.writeText === 'function'/)
})

test('接线：右键菜单按计划渲染复制项，文案取自计划（不另写一份措辞）', () => {
  const source = readSource('../src/client/canvas/CanvasContextMenu.tsx')
  assert.match(source, /clipboardPlanOf\(node\)/)
  assert.match(source, /clipboardPlan !== null && item\(clipboardPlan\.label/)
  assert.match(source, /onCopyToClipboard\(id: string\): void/)
  // 就地克隆的「复制」必须留在原地 —— 两者是不同动作，不能合并（注释里写清了）。
  assert.match(source, /item\('复制', \(\) => \{ onCopy\(node\.id\) \}\)/)
})

test('接线：StudioFrame 出 toast，抽屉按钮三态反馈（失败不再静默）', () => {
  const frame = readSource('../src/client/StudioFrame.tsx')
  assert.match(frame, /const handleCopyToClipboard = \(node: StudioCanvasNode\): void => \{/)
  assert.match(frame, /copyNodeToClipboard\(node, clipboardEnv\(\)\)/)
  assert.match(frame, /pushToast\(clipboardResultMessage\(result\)\)/)
  assert.match(frame, /onCopyToClipboard=\{id => \{/)
  // 两处降级复制（@ref 引用 / 技能提示词）都必须走同一口径 —— 不许回到 `.catch(() => {})`。
  assert.equal((frame.match(/copyTextToClipboard\(token, clipboardEnv\(\)\)/g) ?? []).length, 2)

  const drawer = readSource('../src/client/canvas/NodeDetailDrawer.tsx')
  assert.match(drawer, /copyTextToClipboard\(first, clipboardEnv\(\)\)/)
  assert.match(drawer, /COPY_STATE_LABELS\[copyState\]/)
  assert.match(drawer, /fail: '复制失败'/)
})

test('守卫自身有效性：反向探针能红（把实现改回直连 cut 一次，接线断言必须失配）', () => {
  // 这条不是测产品，是测**上面几条接线断言的灵敏度** —— 断言依赖的具体字串
  // 一旦被删（哪怕是等价改写），本文件必须跟着红，而不是静默变空。
  const source = readSource('../src/client/canvas/CanvasContextMenu.tsx')
  const mutated = source.replace(/clipboardPlanOf\(node\)/g, 'clipboardPlanOfX(node)')
  assert.notEqual(mutated, source, '菜单里没有 clipboardPlanOf(node) 可改 —— 上面的断言已在测空气')
  assert.equal(/clipboardPlanOf\(node\)/.test(mutated), false)
})
