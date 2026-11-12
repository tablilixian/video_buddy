/**
 * RQ-01（REQ-038）· **渲染回执协议**：成片字节 + 元数据的 body 帧格式。
 *
 * ## 解决什么（431 根因，需求正本 §3 R0）
 *
 * 旧实现把回执元数据（warnings / metrics JSON）塞进 **URL query**（`api.ts` 的
 * `query.set('warnings', …)`）⇒ 整片 60s / 265 轨的回执 query 实测 **16,239B**，
 * 越过 Node 默认 header 上限 **16,384B**（宿主 webserver 是裸 `createServer`，
 * 无 `maxHeaderSize`）⇒ 服务端回 **431** 并断链，渲染 55s 全部白跑、mp4 永不落盘。
 *
 * ## 帧格式（客户端 / 服务端各一份实现，常量共享本文件）
 *
 * ```
 * ┌──────────┬───────────────┬──────────────────┬──────────────────┐
 * │ magic 8B │ metaLen 4B LE │ metadata JSON    │ 成片字节（mp4）  │
 * │ CSREND01 │               │ {warnings,metrics}│                  │
 * └──────────┴───────────────┴──────────────────┴──────────────────┘
 * ```
 *
 * ## 兼容矩阵（SB-1 拍板：双向兼容）
 *
 * | 客户端 | 服务端（新） | 服务端（旧） |
 * | --- | --- | --- |
 * | 新帧（有元数据） | ✅ 按 magic 判帧拆包 | ❌（整帧被当 mp4 —— 部署必须同步） |
 * | 裸 body（无元数据） | ✅ 走老判定 | ✅ |
 * | query 带 warnings/metrics（旧客户端） | ✅ 兼容读取（帧未命中时回落 query） | ✅ |
 *
 * `metaLen` 上限 8MB（防御：元数据是 warnings + report 的 JSON，正常 ≤ 数百 KB）。
 */
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 帧魔数（8 字节；`CSREND01` = Canvas Studio Render v01）。 */
export const RENDER_COMMIT_MAGIC = 'CSREND01'

/** 帧头长度 = magic 8B + metaLen 4B（LE uint32）。 */
export const RENDER_COMMIT_HEADER_BYTES = 12

/** metadata JSON 长度上限（8MB；超过判坏帧，整个 body 回落按裸 mp4 处理并告警）。 */
export const RENDER_COMMIT_META_MAX_BYTES = 8 * 1024 * 1024

/** 前缀是否命中新帧格式（只看 magic；body 不足一个 header 长度 = 老格式）。 */
export function isRenderCommitFrame(bytes: Uint8Array): boolean {
  if (bytes.length < RENDER_COMMIT_HEADER_BYTES) return false
  for (let i = 0; i < RENDER_COMMIT_MAGIC.length; i += 1) {
    if (bytes[i] !== RENDER_COMMIT_MAGIC.charCodeAt(i)) return false
  }
  return true
}

/** 读帧头的 metadata 长度（LE uint32；调用方先用 `isRenderCommitFrame` 判定）。 */
export function readRenderCommitMetaLength(bytes: Uint8Array): number {
  return bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | (bytes[11]! << 24)
}

/** 拆帧：返回 [metadata JSON 串（可能空串）, 成片字节]。格式非法返回 null（回落老格式）。 */
export function parseRenderCommitFrame(bytes: Uint8Array): { metaJson: string; payload: Uint8Array } | null {
  if (!isRenderCommitFrame(bytes)) return null
  const metaLen = readRenderCommitMetaLength(bytes)
  if (metaLen < 2 || metaLen > RENDER_COMMIT_META_MAX_BYTES) return null
  if (bytes.length < RENDER_COMMIT_HEADER_BYTES + metaLen) return null
  const metaJson = new TextDecoder().decode(bytes.subarray(RENDER_COMMIT_HEADER_BYTES, RENDER_COMMIT_HEADER_BYTES + metaLen))
  return { metaJson, payload: bytes.subarray(RENDER_COMMIT_HEADER_BYTES + metaLen) }
}

/** 组帧（客户端）：元数据 JSON + 成片字节 → 单个 body。 */
export function buildRenderCommitFrame(metaJson: string, payload: Uint8Array): Uint8Array {
  const metaBytes = new TextEncoder().encode(metaJson)
  if (metaBytes.length > RENDER_COMMIT_META_MAX_BYTES) {
    // 开发期防御（元数据超 8MB = 序列化失控），走 error-system（静态守卫：src/ 零裸抛）。
    throwError('CS-DEV-ERR', { detail: `render commit metadata 超过 ${RENDER_COMMIT_META_MAX_BYTES}B 上限（${metaBytes.length}B）` })
  }
  const frame = new Uint8Array(RENDER_COMMIT_HEADER_BYTES + metaBytes.length + payload.length)
  for (let i = 0; i < RENDER_COMMIT_MAGIC.length; i += 1) {
    frame[i] = RENDER_COMMIT_MAGIC.charCodeAt(i)
  }
  const metaLen = metaBytes.length
  frame[8] = metaLen & 0xff
  frame[9] = (metaLen >> 8) & 0xff
  frame[10] = (metaLen >> 16) & 0xff
  frame[11] = (metaLen >> 24) & 0xff
  frame.set(metaBytes, RENDER_COMMIT_HEADER_BYTES)
  frame.set(payload, RENDER_COMMIT_HEADER_BYTES + metaBytes.length)
  return frame
}
