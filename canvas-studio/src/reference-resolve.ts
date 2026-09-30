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
import type { StudioCanvasNode } from './contracts/canvas.js'
import { AssetLibrary, libraryIdOfHandle, materializeLibraryMedia } from './asset-library.js'
import type { LibMedia, LibraryAsset } from './contracts/asset-library.js'
import { findNodeByRef } from './reference-token.js'
import { assetKeyFromUrl, isDramaProductName, promoteAssetFile } from './generate.js'
import { throwError } from './error-system.js'

/**
 * 可被 `@ref` 引用的节点池：**参考优先，普通素材节点兜底**。
 *
 * ⚠️ 2026-09-22：普通素材那一条此前要求**已有 filename**，于是「有 url 无 filename」
 * 的节点根本进不了池、惰性提升分支永远走不到。上传视频不再预上传 Drama 句柄之后
 * （那是关键路径上最慢的一步，见 `video-style.ts` 的 importVideoAsset），这类节点
 * 成了常态 ⇒ 判据放宽到「有 filename **或** 有可提升的项目资产 url」：
 * **能提升的，就必须能被引用到**。
 */
export function refCandidatePool(nodes: readonly StudioCanvasNode[]): StudioCanvasNode[] {
  const references = nodes.filter((node) => node.isReference === true)
  const plainAssets = nodes.filter((node) => node.isReference !== true
    && (typeof node.filename === 'string' && node.filename.length > 0
      || (node.url !== undefined && assetKeyFromUrl(node.url) !== null)))
  return [...references, ...plainAssets]
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
): Promise<string> {
  const id = libraryIdOfHandle(token)
  if (id === undefined) {
    // 不可达防御（分支判据就是 id !== undefined），但句柄拼装错误不该漏到后端。
    throwError('CS-USER-ERR', { message: `资产库引用句柄不合法：${token}`, detail: `bad library handle: ${token}` })
  }
  const asset = await library.require(id)
  const media = pickLibraryMedia(asset)
  const { file } = await materializeLibraryMedia(library, registry, projectId, asset.id, media)
  const filename = await promoteAssetFile(registry, projectId, file)
  void library.recordUsage(asset.id, { projectId }).catch(() => {})
  return filename
}

/** 引用解析挑媒体：image 优先（生成/分析的主消费面），其次 video/audio；无媒体显式报错。 */
function pickLibraryMedia(asset: LibraryAsset): LibMedia {
  const picked = asset.media.find((entry) => entry.kind === 'image')
    ?? asset.media.find((entry) => entry.kind === 'video')
    ?? asset.media.find((entry) => entry.kind === 'audio')
  if (picked === undefined) {
    throwError('CS-USER-ERR', {
      message: `资产库资产「${asset.name}」没有媒体文件（仅元数据），不能作 @ref 文件引用；请改用它的提示词信息，或先给它补一张参考图`,
      detail: `library asset has no media: ${asset.id}`,
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
export async function resolveRefFilenames(registry: ProjectRegistry, projectId: string, tokens: string[], library: AssetLibrary): Promise<string[]> {
  if (tokens.length === 0) return []
  const nodes = (await registry.readCanvas(projectId)).nodes
  // CV-114：匹配池沿用「参考优先、普通素材节点兜底」，句柄按 id 精确匹配、
  // 标题兜底（findNodeByRef）——重名/改名不再让引用指错或失效。
  const pool = refCandidatePool(nodes)
  const out: string[] = []
  for (const token of tokens) {
    // REQ-001 主插入点（§8-D）：`lib:<id>` 走资产库三段式，必须在 findNodeByRef
    // 之前 —— 画布匹配池里没有库条目，落下去只会误报 CS-USER-001「找不到引用」。
    if (libraryIdOfHandle(token) !== undefined) {
      out.push(await resolveLibFilename(registry, library, projectId, token))
      continue
    }
    const node = findNodeByRef(pool, token)
    if (node === undefined) {
      throwError('CS-USER-001', { ref: token, detail: 'findNodeByRef 未命中' })
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
