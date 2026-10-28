/**
 * 参考句柄解析：`@ref[显示名]` / 裸 `lib:<id>` → **可直接下发给后端的** Drama 文件名。
 *
 * ## 为什么从 `host-tools.ts` 抽出来（REQ-003 §4.3）
 *
 * REQ-003 要让 UI 也能"把某个画布节点加成参考图"。而画布节点上的 `filename` 经常
 * 是**后端产物名**（`img_*` / `z-image_*`），直接当参考传回去约 0.1s 内 500
 * （CV-155 实测）—— 真正可用的是 `ref-*` 上传句柄，要靠这里的惰性提升现造。
 * 于是需要一条**路由**（`POST /canvas-studio/resolve-refs`）给 UI 用；但
 * `routes.ts` 不 import `host-tools.ts`（那会把整个工具层连带 DSH 依赖拖进路由
 * 模块）。抽出成本模块后，工具侧与路由侧共用**同一份**实现 —— 不新增第二套口径。
 *
 * 抽取是纯搬家：函数体逐字未改，`tests/filename-consumability.test.mjs`（引用
 * `refCandidatePool`）与 `tests/reference.test.mjs` / `tests/lib-ref-resolve.test.mjs`
 * 就是这次搬家的回归网。
 */
import type { ProjectRegistry } from './projects.js'
import { isShotCard, type StudioCanvasNode, type StudioCanvasNodeKind } from './contracts/canvas.js'
import { AssetLibrary, libraryIdOfHandle, materializeLibraryMedia } from './asset-library.js'
import type { LibMedia, LibraryAsset } from './contracts/asset-library.js'
import { findNodeByRef, suggestRefCandidates } from './reference-token.js'
import { assetKeyFromUrl, isDramaProductName, promoteAssetFile } from './generate.js'
import { throwError } from './error-system.js'

/**
 * 参考参数期望的媒体类型（A-1 复核 2026-10-02）。
 *
 * `filenames` / `audioRefs` / `videoRefs` 三类参数共用同一条解析链，但**槽位语义
 * 不同**：图片槽只收图，audioRefs 只收音频，videoRefs 只收视频。不过滤时，
 * `@ref[标题]` 标题兜底（findNodeByRef）会把视频/文本节点解析进图片槽提交——
 * 这正是 A-1「图生图连的文本/图参考缺失」的成因之一。过滤必须**按参数选择性
 * 开启**（不传 = 旧行为，CV-231 全量池），因为「上传视频不预提升」的设计里
 * 视频节点本来就该能被解析（videoRefs 槽）。
 */
export type RefExpectKind = Extract<StudioCanvasNodeKind, 'image' | 'audio' | 'video'>

const KIND_LABEL: Record<StudioCanvasNodeKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  sticky: '便签',
  text: '文本',
  prompt: '提示词',
  group: '分组',
}

/**
 * 可被 `@ref` 引用的节点池：**参考优先，普通素材节点兜底**。
 *
 * ⚠️ 2026-09-22：普通素材那一条此前要求**已有 filename**，于是「有 url 无 filename」
 * 的节点根本进不了池、惰性提升分支永远走不到。上传视频不再预上传 Drama 句柄之后
 * （那是关键路径上最慢的一步，见 `video-style.ts` 的 importVideoAsset），这类节点
 * 成了常态 ⇒ 判据放宽到「有 filename **或** 有可提升的项目资产 url」：
 * **能提升的，就必须能被引用到**。
 */
export function refCandidatePool(nodes: readonly StudioCanvasNode[], expectKind?: RefExpectKind): StudioCanvasNode[] {
  const references = nodes.filter((node) => node.isReference === true
    && (expectKind === undefined || node.kind === expectKind))
  const plainAssets = nodes.filter((node) => node.isReference !== true
    && (expectKind === undefined || node.kind === expectKind)
    && (typeof node.filename === 'string' && node.filename.length > 0
      || (node.url !== undefined && assetKeyFromUrl(node.url) !== null)))
  return [...references, ...plainAssets]
}

/**
 * 类型不匹配的**指名道姓**报错：`@ref[标题]` 命中了节点、但媒体类型与槽位不符。
 *
 * 不做这一步，过滤池会让这类引用落进笼统的 CS-USER-001「找不到引用」——模型看到
 * 「找不到」只会换个标题重试，永远到不了「换参数」这个正解（A-1 复核的教训：
 * 错误信息必须指向可行动的出路）。
 */
function throwRefKindMismatch(token: string, expectKind: RefExpectKind, actualKind: StudioCanvasNodeKind): never {
  const advice = expectKind === 'image'
    ? actualKind === 'video'
      ? '视频参考请走 videoRefs 参数（Drama 通道）；要作画面参考请先抽帧成图片'
      : actualKind === 'audio'
        ? '音频参考请走 audioRefs 参数'
        : '文本内容请直接写进提示词，不要作图片参考'
    : `本参数只收${KIND_LABEL[expectKind]}参考`
  throwError('CS-USER-ERR', {
    message: `「${token}」是${KIND_LABEL[actualKind]}节点，不能作${KIND_LABEL[expectKind]}参考——${advice}。`,
    detail: `reference kind mismatch: token=${token} expect=${expectKind} actual=${actualKind}`,
  })
}

/**
 * `lib:<id>` → Drama filename 的三段式（方案 §3.4）：
 *
 *  1. 解析：`library.require(id)`，未知 id → `CS-LIB-001`；
 *  2. 物化：`materializeLibraryMedia` 把库文件拷进当前项目 `assets/`
 *     （contentHash / 确定性名两档去重）—— `promoteAssetFile` 只从项目 assetsDir
 *     读盘，够不着 `library/<id>/`，这一步是必经中转（§8-C）；
 *  3. promote：既有 Drama 注册 + reference-manifest 记账，回传可用 filename。
 *
 * 成功后回写 `usage`（幂等；回写失败不阻断解析 —— usage 只服务「被引用处」展示）。
 */
async function resolveLibFilename(
  registry: ProjectRegistry,
  library: AssetLibrary,
  projectId: string,
  token: string,
  expectKind?: RefExpectKind,
): Promise<string> {
  const id = libraryIdOfHandle(token)
  if (id === undefined) {
    // 不可达防御（分支判据就是 id !== undefined），但句柄拼装错误不该漏到后端。
    throwError('CS-USER-ERR', { message: `资产库引用句柄不合法：${token}`, detail: `bad library handle: ${token}` })
  }
  const asset = await library.require(id)
  const media = pickLibraryMedia(asset, expectKind)
  const { file } = await materializeLibraryMedia(library, registry, projectId, asset.id, media)
  const filename = await promoteAssetFile(registry, projectId, file)
  void library.recordUsage(asset.id, { projectId }).catch(() => {})
  return filename
}

/**
 * 引用解析挑媒体：指定 `expectKind` 时**必须**有该类媒体（音频槽引用到只有图的
 * 库资产，落成图文件进音频槽是静默错配，必须报错）；未指定时沿用旧序
 * （image 优先——生成/分析的主消费面，其次 video/audio），无媒体显式报错。
 */
function pickLibraryMedia(asset: LibraryAsset, expectKind?: RefExpectKind): LibMedia {
  const picked = expectKind !== undefined
    ? asset.media.find((entry) => entry.kind === expectKind)
    : asset.media.find((entry) => entry.kind === 'image')
      ?? asset.media.find((entry) => entry.kind === 'video')
      ?? asset.media.find((entry) => entry.kind === 'audio')
  if (picked === undefined) {
    throwError('CS-USER-ERR', {
      message: expectKind !== undefined
        ? `资产库资产「${asset.name}」没有${KIND_LABEL[expectKind]}类媒体，不能作${KIND_LABEL[expectKind]}参考；请改用它的提示词信息，或先补一份${KIND_LABEL[expectKind]}素材`
        : `资产库资产「${asset.name}」没有媒体文件（仅元数据），不能作 @ref 文件引用；请改用它的提示词信息，或先给它补一张参考图`,
      detail: `library asset has no usable media: ${asset.id}${expectKind === undefined ? '' : ` (expect ${expectKind})`}`,
    })
  }
  return picked
}

/**
 * 把 `@ref[显示名]` token 解析成对应的 Drama Backend 文件名。
 *
 * 匹配池见 `refCandidatePool`（参考托盘优先，其次是未标记参考的普通素材节点 ——
 * 对话附件旁路落卡即普通节点，isReference 只是托盘展示语义，引用句柄以
 * title + filename 为准）。命中节点还没有 filename（提升未完成）时，若其 url 指向
 * 项目 assets 落盘文件，则现场读盘上传 Drama（惰性兜底）并回写 canvas.json ——
 * 正确性与上传进度解耦；已提升则直接复用（`promoteAssetFile` 内 in-flight 去重，
 * 防与并发调用重复上传）。
 */
export async function resolveRefFilenames(
  registry: ProjectRegistry,
  projectId: string,
  tokens: string[],
  library: AssetLibrary,
  expectKind?: RefExpectKind,
): Promise<string[]> {
  if (tokens.length === 0) return []
  const nodes = (await registry.readCanvas(projectId)).nodes
  // CV-114：匹配池沿用「参考优先、普通素材节点兜底」，句柄按 id 精确匹配、
  // 标题兜底（findNodeByRef）——重名/改名不再让引用指错或失效。
  // A-1 复核：图片/音频/视频槽各传各的 expectKind，标题兜底不再跨类型误配。
  const pool = refCandidatePool(nodes, expectKind)
  const out: string[] = []
  for (const token of tokens) {
    // REQ-001 主插入点（§8-D）：`lib:<id>` 走资产库三段式，必须在 findNodeByRef
    // 之前 —— 画布匹配池里没有库条目，落下去只会误报 CS-USER-001「找不到引用」。
    if (libraryIdOfHandle(token) !== undefined) {
      out.push(await resolveLibFilename(registry, library, projectId, token, expectKind))
      continue
    }
    const node = findNodeByRef(pool, token)
    if (node === undefined) {
      // 类型不匹配要指名道姓（见 throwRefKindMismatch）：只说「找不到」会把模型
      // 引去换标题重试，而不是换正确的参数通道。
      if (expectKind !== undefined) {
        const stray = findNodeByRef(nodes, token)
        if (stray !== undefined) throwRefKindMismatch(token, expectKind, stray.kind)
      }
      throwError('CS-USER-001', {
        ref: token,
        detail: 'findNodeByRef 未命中',
        hint: candidateHint(suggestRefCandidates(pool, token)),
      })
    }
    if (node.filename === undefined || node.filename === null || node.filename.length === 0) {
      // 惰性兜底：节点已落盘（有项目资产 url）但 Drama 提升未完成 → 现场提升并回写。
      const assetKey = node.url === undefined ? null : assetKeyFromUrl(node.url)
      if (assetKey === null || !assetKey.startsWith(`${projectId}/`)) {
        throwError('CS-USER-ERR', { message: `参考图 @ref[${token}] 尚未上传到 Drama Backend（缺少 filename），且该节点不是画布资产。请先调 upload_image 取得文件名，或直接在参数里粘贴该文件名。`, detail: `未上传 filename: ${token}` })
      }
      const filename = await promoteAssetFile(registry, projectId, assetKey.slice(projectId.length + 1))
      const doc = await registry.readCanvas(projectId)
      await registry.writeCanvas(projectId, doc.nodes.map((entry) => (entry.id === node.id ? { ...entry, filename } : entry)))
      out.push(filename)
      continue
    }
    // CV-155：生成类节点的 filename 是**后端产物名**（`img_*` / `z-image_*`），作带
    // 文件端点入参会**约 0.1s 内 500** —— 不换名就必然失败，所以这里不等失败：形态
    // 命中产物名且本地资产可达时，直接重传换成可用句柄并回写节点（与上面「有 url 无
    // filename」分支同一不变式：节点 filename 恒为后端当前可用的名字）。
    // 本地资产不可达时退回产物名，由消费端（analyzeImage 等）的失败自愈兜底。
    if (isDramaProductName(node.filename)) {
      const assetKey = node.url === undefined ? null : assetKeyFromUrl(node.url)
      if (assetKey !== null && assetKey.startsWith(`${projectId}/`)) {
        const filename = await promoteAssetFile(registry, projectId, assetKey.slice(projectId.length + 1))
        const doc = await registry.readCanvas(projectId)
        await registry.writeCanvas(projectId, doc.nodes.map((entry) => (entry.id === node.id ? { ...entry, filename } : entry)))
        out.push(filename)
        continue
      }
    }
    out.push(node.filename)
  }
  return out
}

/**
 * 候选提示的拼装（`CS-USER-001` 的 `{hint}` 占位）——空候选返回空串，模板里
 * 就什么也不多出来。
 *
 * 为什么要给候选：转录实测里 18 次 `CS-USER-001` 全集中在几个分镜批次，
 * 文案只说「未找到」时模型只会换参数绕道；给出最接近的 3 条，它下一轮能照抄改对。
 */
function candidateHint(titles: readonly string[]): string {
  if (titles.length === 0) return ''
  return `\n最接近的候选：${titles.map((title) => `「${title}」`).join('、')} —— 照抄其中一条重试，或改用节点 id。`
}

/** 分镜卡标题的分段符（与 `reference-token.ts` 的 `TITLE_SEPARATOR` 同形）。 */
const SHOT_TITLE_SEPARATOR = '·'

/** 分镜卡匹配的最短前缀长度（同 `reference-token` 的口径：少于 4 字不参与前缀）。 */
const SHOT_MIN_PREFIX_LENGTH = 4

/** 标题去尾部省略号（模型常把被截断的标题连 `…` 一起抄回来）。 */
function bareTitleOf(title: string): string {
  return title.trim().replace(/(?:…|\.\.\.)+$/u, '').trim()
}

/**
 * 分镜卡匹配强度：`0` = 不命中，数值越小证据越强。
 *
 * 1. 节点 id 全等；
 * 2. 卡片标题全等；
 * 3. `sbRef` 全等或**末段**全等 —— `04:SC1/shots/S1-Sh1` 的 `S1-Sh1` 就是 shot.id，
 *    是模型从 `write_storyboard` 返回里直接拿到的**最权威结构化标识**（storyboard-seed
 *    把它写在卡上，但此前查找函数根本不看它）；
 * 4. 标题分段全等 —— `分镜 1` / `S1-Sh1` / `缓慢推进` 各自都能命中同一张卡；
 * 5. `分镜N`（无空格）按镜号正则命中；
 * 6. 标题前缀（较短一方 ≥4）。
 *
 * 旧实现只有 1/2/5 三档，于是 `shotRefs: ['S1-Sh1']` 必然失败（转录实测）。
 */
function shotMatchTier(node: StudioCanvasNode, token: string): number {
  if (node.id === token) return 1
  const title = (node.title ?? '').trim()
  if (title !== '' && title === token) return 2
  const sbRef = (node.sbRef ?? '').trim()
  if (sbRef !== '') {
    if (sbRef === token) return 3
    const tail = sbRef.split('/').filter((part) => part !== '').pop()
    if (tail !== undefined && tail === token) return 3
  }
  const bareToken = bareTitleOf(token)
  if (bareToken !== '' && title.split(SHOT_TITLE_SEPARATOR).map((part) => part.trim()).includes(bareToken)) return 4
  const byNumber = /^分镜\s*(\d+)$/u.exec(bareToken)
  if (byNumber !== null && new RegExp(`^分镜 ${byNumber[1]}(?:\\s|·|$)`, 'u').test(title)) return 5
  const bareTitle = bareTitleOf(title)
  if (bareToken !== '' && bareTitle !== '' && bareToken !== bareTitle) {
    const shorter = bareToken.length <= bareTitle.length ? bareToken : bareTitle
    if (shorter.length >= SHOT_MIN_PREFIX_LENGTH
      && (bareToken.startsWith(bareTitle) || bareTitle.startsWith(bareToken))) return 6
  }
  return 0
}

/** 按 `shotMatchTier` 取最强一张；同档取数组首个（= 画布创建顺序）。 */
function pickShotCard(cards: readonly StudioCanvasNode[], token: string): StudioCanvasNode | undefined {
  let best: { node: StudioCanvasNode; tier: number } | undefined
  for (const card of cards) {
    const tier = shotMatchTier(card, token)
    if (tier === 0) continue
    if (best === undefined || tier < best.tier) best = { node: card, tier }
    if (tier <= 3) break // id / 标题全等 / sbRef 命中最强，直接收工
  }
  return best?.node
}

/**
 * `shotRefs` → 分镜卡节点 id（CV-027 起；CV-376 补齐 sbRef/分段/前缀三档）。
 *
 * 为什么从 `host-tools.ts` 搬到这里：① 它本就是引用解析的一部分，与 `@ref` 同源；
 * ② `host-tools.ts` 已顶到文件行数棘轮（4401/4401），一行都加不动。
 *
 * 找不到时抛**可操作**报错：写法清单 + 最接近的候选 + 「未落地就停手」的出路。
 * 光说「未找到」会让模型换参数绕道（2026-10-22 真机教训）。
 */
export async function resolveShotRefs(
  registry: ProjectRegistry,
  projectId: string,
  refs: readonly unknown[],
): Promise<string[]> {
  const cards = (await registry.readCanvas(projectId)).nodes.filter((node) => isShotCard(node))
  const out: string[] = []
  for (const ref of refs) {
    const raw = String(ref).trim()
    if (raw === '') continue
    const hit = pickShotCard(cards, raw)
    if (hit === undefined) {
      const candidates = suggestRefCandidates(cards, raw)
      const hint = cards.length === 0
        ? '画布上目前没有可用的分镜卡。'
        : candidates.length === 0
          ? ''
          : `最接近的候选：${candidates.map((title) => `「${title}」`).join('、')} —— 照抄其中一条重试。`
      throwError('CS-USER-ERR', {
        message: `分镜卡「${raw}」未找到：先核对写法（卡片标题如「分镜 1 · 特写」、镜号「分镜 1」、sbRef 里的镜号「S1-Sh1」，或节点 id）。${hint}若项目尚未落地（用户还没在覆盖层点「确认落地」），分镜卡还不存在 —— 请停止逐镜出图，等待用户落地后再试；不要换别的参数绕道重试。`,
        detail: `shot card ref not found: ${raw}; cards=${String(cards.length)}`,
      })
    }
    if (!out.includes(hit.id)) out.push(hit.id)
  }
  return out
}
