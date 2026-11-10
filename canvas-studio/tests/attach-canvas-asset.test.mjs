/**
 * `attach_canvas_asset`（本地现成产物 → 画布节点）行为门禁。
 *
 * ## 为什么有这道门（2026-11-10 香水样本 P0-2，`待验收清账台账-多轮.md` §21.3）
 *
 * 真机会话第 4 轮：用户要看的草稿是本地一个 mp4。当时**没有合规工具**能把它挂上画布
 * （`upload_image` 只传后端不建节点、`download_video` 只吃视频页链接），于是模型：
 * 手写 `build/manifest.json` → 被「先 scaffold_manifest」拒收（护栏对，但**没给出路**）
 * → `cp canvas.json` 备份后 `node -e` 直插 video 节点（nodes 23→24）。
 *
 * 绕开 `writeCanvas` 的代价是**正确性**：没有 merge-protect（并发客户端保存整档覆盖）、
 * 没有 `touchUpdatedAt`、资产不进历史账。所以本文件断的是**行为**，不是「源码里有这行字」：
 *
 *   ① 调一次工具 → 画布节点 +1，节点带 Host 同源 URL 与 `createdAt`，资产文件真落盘；
 *   ② **写口证据（反向变异锚点）**：登记前后 `view` / `assets` 必须原样保留 ——
 *      只有走 `writeCanvas`（merge-protect）才会保住它们；任何 `writeFileSync('canvas.json')`
 *      的旁路都会把这两段丢掉 ⇒ 变异成直写即本用例变红；
 *   ③ 拒收面：非图片交给 `upload_image` 必须**在发请求前**被拒且给出正确工具名；
 *   ④ 错误系统同结论：拒收码过 `codeIsUserFacing()` 为真（路由唯一 `routeError()`）。
 *
 * 前置：先 `yarn build`（本文件 import `lib/**`，只跑 tsdown 会测到旧码）。
 * 运行：只 `corepack yarn workspace canvas-studio test:smoke`（禁裸 node --test 作门禁）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { createStudioTools } from '../lib/host-tools.js'
import {
  ATTACH_CANVAS_ASSET_TOOL,
  attachCanvasAsset,
  fileNameOf,
  nonImageUploadReason,
  sniffMediaKind,
} from '../lib/canvas-asset-attach.js'
import { codeIsUserFacing, routeError } from '../lib/error-system.js'
import '../lib/errors/catalog.js'

/** 一个能骗过魔数判据的最小 mp4 头（`ftyp isom`），后面跟任意字节。 */
function fakeMp4Bytes(extra = 64) {
  const head = Buffer.alloc(12)
  head.writeUInt32BE(24, 0)
  head.write('ftyp', 4, 'latin1')
  head.write('isom', 8, 'latin1')
  return Buffer.concat([head, Buffer.alloc(extra, 0x11)])
}

/** 一个能骗过魔数判据的最小 png 头（8 字节签名 + IHDR 起始）。 */
function fakePngBytes() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(28, 0x22),
  ])
}

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(20_000) })

/** 真 registry + 真画布文件（临时根）；返回项目 id / 目录 / 工具表。 */
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-attach-'))
  const registry = new ProjectRegistry(root)
  // 项目名用 ASCII：受管沙箱的删除守卫对非 ASCII 目录名会拒（EPERM），
  // 那是环境限制不是产品行为 —— 别让它把用例拖红。
  const project = await registry.create('attach-test')
  const tools = createStudioTools(registry, 0)
  const attach = tools.find((tool) => tool.name === ATTACH_CANVAS_ASSET_TOOL)
  assert.ok(attach !== undefined, `${ATTACH_CANVAS_ASSET_TOOL} 必须真实注册（工具表漏了就是 P0-2 原地复发）`)
  return { root, registry, project, attach, projectId: project.id, cwd: project.dir }
}

async function cleanup(fixture) {
  // 临时目录删不掉不是产品缺陷（沙箱守卫），不该把断言结论盖掉。
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {})
}

/** 画布文件路径（与 registry 同源规则：<project.dir>/canvas.json）。 */
function canvasFileOf(fixture) {
  return join(fixture.project.dir, 'canvas.json')
}

async function canvasDocOf(fixture) {
  return JSON.parse(await readFile(canvasFileOf(fixture), 'utf8'))
}

// ── ① 魔数判据（纯函数）────────────────────────────────────────────────

test('sniffMediaKind：认得出真容器头，认不出就返回 null（不瞎猜）', () => {
  assert.equal(sniffMediaKind(fakeMp4Bytes()), 'video')
  assert.equal(sniffMediaKind(fakePngBytes()), 'image')
  assert.equal(sniffMediaKind(Buffer.from('ID3\x04\x00\x00', 'latin1')), 'audio')
  assert.equal(sniffMediaKind(Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'latin1')), 'audio')
  assert.equal(sniffMediaKind(Buffer.from('RIFF\x00\x00\x00\x00AVI ', 'latin1')), 'video')
  assert.equal(sniffMediaKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01])), 'video')
  // 认不出（例：纯文本 / 未知容器）必须返回 null，交给扩展名判据 —— 不能一律当图片。
  assert.equal(sniffMediaKind(Buffer.from('hello world!!!', 'latin1')), null)
  assert.equal(sniffMediaKind(Buffer.from([0x00, 0x01])), null)
})

test('sniffMediaKind：`.png` 名字里装 mp4 时判据不认名字（本仓实测过的形态）', () => {
  // 文件名叫 a.png、内容其实是 mp4 —— 魔数必须说 video。调用方据此拒收（见下一个用例）。
  assert.equal(sniffMediaKind(fakeMp4Bytes()), 'video')
})

// ── ② upload_image 的类型拒收（P2-3）────────────────────────────────────

test('nonImageUploadReason：视频 / 音频 / 文本被拒，图片与无扩展名放行', () => {
  for (const name of ['draft-final-480p.mp4', 'clip.mov', 'boom.webm', 'bgm.mp3', 'voice.wav']) {
    const reason = nonImageUploadReason(`/canvas-studio/assets/p1/${name}`)
    assert.ok(reason !== null, `${name} 应被 upload_image 拒收`)
    assert.ok(
      reason.includes(ATTACH_CANVAS_ASSET_TOOL),
      `${name} 的拒收文案必须给出合法出路（${ATTACH_CANVAS_ASSET_TOOL}）—— 只说「不行」会再逼出一次 node -e 改 canvas.json`,
    )
  }
  for (const name of ['look.png', 'shot.jpg', 'x.webp', 'y.bmp', 'z.gif']) {
    assert.equal(nonImageUploadReason(`/canvas-studio/assets/p1/${name}`), null, `${name} 是图片，必须放行`)
  }
  // 拿不准就不拦：带 query 的外链 / 无扩展名不能被误杀。
  assert.equal(nonImageUploadReason('https://media.example/out?token=abc'), null)
  assert.equal(nonImageUploadReason('https://media.example/download'), null)
})

test('upload_image 收到 mp4：**在发请求与建节点之前**拒收，并指路 attach_canvas_asset', async () => {
  const fixture = await makeFixture()
  const originalFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = async () => { fetched += 1; throw new Error('不该发请求') }
  try {
    const upload = createStudioTools(fixture.registry, 0).find((tool) => tool.name === 'upload_image')
    assert.ok(upload !== undefined)
    const error = await upload.execute({ imageUrl: 'draft-final-480p.mp4' }, EXEC(fixture.cwd))
      .then(() => null, (cause) => cause)
    assert.ok(error !== null, 'mp4 必须被拒收（此前它会「成功」返回一个句柄，制造 5 步无效流程）')
    assert.equal(error.code, 'CS-USER-ERR', `拒收码应为 CS-USER-ERR，实得 ${String(error.code)}`)
    assert.ok(String(error.message ?? '').includes(ATTACH_CANVAS_ASSET_TOOL), '拒收文案必须指路正确工具')
    assert.equal(fetched, 0, '拒收必须发生在任何网络请求之前（先判类型，再上传）')
    // 错误系统同结论：路由唯一 routeError()，且用户可见。
    assert.equal(codeIsUserFacing('CS-USER-ERR'), true, '拒收码必须对用户可见（否则画布不画红标、用户不知道为什么没动）')
    assert.equal(routeError(error, { devMode: false }).kind, 'surface', '该类错误应上抛到会话面')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup(fixture)
  }
})

// ── ③ 登记行为（节点 +1、同源 URL、资产落盘）────────────────────────────

test('attach_canvas_asset：本地 mp4 → 画布节点 +1，带同源 URL / createdAt / toolName', async () => {
  const fixture = await makeFixture()
  try {
    const draft = join(fixture.root, 'draft-final-480p.mp4')
    await writeFile(draft, fakeMp4Bytes(4096))

    const result = await attachCanvasAsset(fixture.registry, fixture.projectId, {
      path: draft,
      title: '草稿 · 一镜到底',
      duration: 15.08,
    })
    assert.equal(result.kind, 'video')
    assert.match(result.url, /^\/canvas-studio\/assets\//u, '必须返回同源资产 URL（而不是原始本地路径）')

    // 资产真的落进了项目资产目录（不是「只写了个节点」）。
    const assets = await readdir(fixture.registry.assetsDir(fixture.projectId))
    assert.ok(assets.includes(result.assetFile), `资产目录应含 ${result.assetFile}，实得 ${assets.join(', ')}`)
    const landed = await stat(join(fixture.registry.assetsDir(fixture.projectId), result.assetFile))
    assert.ok(landed.size > 0, '落盘文件不能是 0 字节')

    const doc = await canvasDocOf(fixture)
    assert.equal(doc.nodes.length, 1, '画布节点数应为 1（登记一次 = 一个节点，不多不少）')
    const node = doc.nodes[0]
    assert.equal(node.id, result.nodeId)
    assert.equal(node.kind, 'video')
    assert.equal(node.url, result.url, '节点 URL 与回执必须同源一致（客户端按它渲染）')
    assert.equal(node.title, '草稿 · 一镜到底')
    assert.equal(node.toolName, ATTACH_CANVAS_ASSET_TOOL, '节点必须带产出工具名（血缘 / 展示表都靠它）')
    assert.equal(typeof node.createdAt, 'number')
    assert.ok(node.createdAt > 0, '节点必须有 createdAt（排序 / 时间轴派生依赖它）')
    assert.equal(node.duration, 15.08, '入参给出的时长应落到节点上')
    assert.notEqual(node.isReference, true, '成片草稿默认不标参考素材（要标得显式传 asReference）')
  } finally {
    await cleanup(fixture)
  }
})

test('attach_canvas_asset：asReference=true 才进参考池（默认不污染 §07 候选）', async () => {
  const fixture = await makeFixture()
  try {
    const png = join(fixture.root, 'look.png')
    await writeFile(png, fakePngBytes())
    await attachCanvasAsset(fixture.registry, fixture.projectId, { path: png, asReference: true })
    const doc = await canvasDocOf(fixture)
    assert.equal(doc.nodes[0].isReference, true)
    assert.equal(doc.nodes[0].referenceRole, 'image')
  } finally {
    await cleanup(fixture)
  }
})

// ── ④ 写口证据：merge-protect 必须生效（反向变异锚点）──────────────────

test('反向变异锚点：登记必须经 writeCanvas 写口 —— view / assets 原样保留，直写 canvas.json 会丢', async () => {
  const fixture = await makeFixture()
  try {
    // 先按客户端保存的形态落一份画布：有视口、有资产卡。
    const view = { x: 120, y: -40, scale: 0.75, layersOpen: true, minimapVisible: false }
    const assetCard = {
      id: 'a1', name: '女主', role: 'character', anchorNodeIds: [], lockedPrompt: 'SAME：黑色短发', createdAt: 1,
    }
    await fixture.registry.writeCanvas(fixture.projectId, [], view, [assetCard])

    const clip = join(fixture.root, 'clip.mp4')
    await writeFile(clip, fakeMp4Bytes(1024))
    await attachCanvasAsset(fixture.registry, fixture.projectId, { path: clip, duration: 3 })

    const doc = await canvasDocOf(fixture)
    assert.equal(doc.nodes.length, 1, '节点应追加进去')
    // 这两条就是「走了唯一写口」的行为证据：writeCanvasLocked 会把上一次的视口与资产
    // 注册表原样带回（`view ?? normalize(existing.view)` / `assets ?? existing.assets`）。
    // 任何 `fs.writeFileSync('canvas.json', JSON.stringify({version, nodes}))` 的旁路都会
    // 把这两段丢掉 —— 那正是 P0-2 事故里 `node -e` 那一手的形态。
    assert.deepEqual(doc.view, view, '视口必须保留：直写 canvas.json 的旁路会把它丢掉 ⇒ 本条即变异哨兵')
    assert.deepEqual(doc.assets, [assetCard], '资产卡注册表必须保留：直写旁路同样会丢')
  } finally {
    await cleanup(fixture)
  }
})

// ── ⑤ 拒收面（判据全在 Host，模型无法用错参数绕过）─────────────────────

test('attach_canvas_asset：链接 / 相对路径 / 扩展名与 kind 打架 / 魔数与名字打架 一律拒收', async () => {
  const fixture = await makeFixture()
  try {
    const cases = [
      { args: { path: 'https://media.example/a.mp4' }, expect: /本地绝对路径/u, label: '外链' },
      { args: { path: 'build/a.mp4' }, expect: /绝对路径/u, label: '相对路径' },
    ]
    for (const item of cases) {
      const error = await attachCanvasAsset(fixture.registry, fixture.projectId, item.args)
        .then(() => null, (cause) => cause)
      assert.ok(error !== null, `${item.label} 应被拒收`)
      assert.match(String(error.message), item.expect)
    }

    // 扩展名与显式 kind 打架：拒绝而不是二选一（二选一必然有一半下游按错类型取用）。
    const mp4 = join(fixture.root, 'm.mp4')
    await writeFile(mp4, fakeMp4Bytes(64))
    const mismatch = await attachCanvasAsset(fixture.registry, fixture.projectId, { path: mp4, kind: 'image' })
      .then(() => null, (cause) => cause)
    assert.ok(mismatch !== null, 'kind 与扩展名不一致必须拒收')
    assert.match(String(mismatch.message), /不一致/u)

    // 名字骗人：`.png` 里装 mp4 —— 魔数复核必须拦（这正是 upload_image 吞 mp4 的同型事故）。
    const liar = join(fixture.root, 'liar.png')
    await writeFile(liar, fakeMp4Bytes(64))
    const sniffed = await attachCanvasAsset(fixture.registry, fixture.projectId, { path: liar })
      .then(() => null, (cause) => cause)
    assert.ok(sniffed !== null, '内容与扩展名不符必须拒收 —— 否则下游按错轨道取用')
    assert.match(String(sniffed.message), /看起来是/u)

    // 一条都不许悄悄落节点（拒收先于任何副作用）。
    const doc = await canvasDocOf(fixture).catch(() => ({ nodes: [] }))
    assert.equal(doc.nodes.length, 0, '被拒收的调用不得留下任何节点')
  } finally {
    await cleanup(fixture)
  }
})

test('fileNameOf：URL 末段去 query / 解码（拒收文案要能说出真实文件名）', () => {
  assert.equal(fileNameOf('/canvas-studio/assets/p1/a%20b.mp4?x=1'), 'a b.mp4')
  assert.equal(fileNameOf('https://media.example/out.png#v=2'), 'out.png')
  assert.equal(fileNameOf('https://media.example'), 'media.example')
})

// ── ⑥ M1 拒收文案必须带合法出路 ─────────────────────────────────────────
//
// 事故链里最致命的一环不是「不许手写 manifest」，而是**只说不行、没说怎么办**：
// 模型被拒后没有第二条路，只能去 `node -e` 改 canvas.json。所以 M1 的文案必须点名
// `attach_canvas_asset` —— 光加禁令不给出路，只会逼出下一种绕法。
//
// 为何这里读源码文本（同 `spec-gate.test.mjs` 的 P-06 口径）：这条断言的被测对象
// **就是那句文案本身**，而触发它需要先把 spec 闸推到「storyboard 落地 + 未 scaffold」
// 状态（要真跑 confirm_intent_card → write_storyboard 全链），代价远大于收益。
test('M1 拒收文案：必须点名 attach_canvas_asset 这条合法出路（不能只说「不要手写」）', async () => {
  const source = await readFile(new URL('../src/tool-error-boundary.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('不要手写 manifest'), 'M1 文案丢了「不要手写 manifest」禁令（P-06）')
  assert.ok(
    source.includes(ATTACH_CANVAS_ASSET_TOOL),
    'M1 文案没给出路 —— 模型被拒后仍会去改 canvas.json（P0-2 事故的最后一环）',
  )
  assert.match(source, /不要手改 `canvas\.json`|不要改 `canvas\.json`/u, 'M1 文案应显式劝阻直改 canvas.json')
})
