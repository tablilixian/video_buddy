/**
 * CV-198：`ClipboardEnv` 的浏览器实现 —— **全仓唯一**碰 `navigator.clipboard` 的地方。
 *
 * 判定/文案在 `src/clipboard-copy.ts`（纯逻辑、可单测）；这里只做「跟浏览器打交道」
 * 的三件事：取资产、PNG 重编码、写剪贴板。守卫 `tests/clipboard-copy.test.mjs`
 * 锁住「唯一」这条：`navigator.clipboard` 只允许在**本文件**出现。
 *
 * 实测依据（`scripts/probe-clipboard.mjs`，2026-09-17 · 无头 Chrome）：
 * `ClipboardItem` / `createImageBitmap` / `canvas.toBlob('image/png')` 在目标环境
 * （Electron = Chromium）全部可用，`toBlob` 产出的是真 PNG（magic `89 50 4E 47`）。
 * 因此这里不写 `new Image()` / `execCommand('copy')` 之类的降级分支 —— 降级分支
 * 是**永远跑不到、也测不到**的死代码；真缺能力时 `available()` 会直接判 false，
 * 用户拿到的是「改用下载资产」这条明确的路。
 */
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import type { ClipboardEnv } from '../../clipboard-copy.js'
import { pngTranscodeNeeded } from '../../clipboard-copy.js'
import { throwError } from '../../error-system.js'
import '../../errors/catalog.js'

/** 取节点资产。HTTP 状态要带进错误信息 —— 「取资产失败（HTTP 404）」才可排障。 */
async function loadBlob(node: StudioCanvasNode): Promise<Blob> {
  const url = node.url
  if (typeof url !== 'string' || url.length === 0) throwError('CS-CLIENT-ERR', { message: '节点没有资产地址' })
  const response = await fetch(url)
  if (!response.ok) throwError('CS-CLIENT-ERR', { message: `复制失败：素材下载返回 HTTP ${response.status}`, detail: `HTTP ${response.status}` })
  return await response.blob()
}

/** 位图 → canvas → PNG blob（剪贴板只认 PNG，webp / jpeg 都要走这一步）。 */
function encodePng(bitmap: ImageBitmap): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      reject(new Error('无法创建 2D 画布'))
      return
    }
    ctx.drawImage(bitmap, 0, 0)
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('canvas.toBlob 返回空'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

async function toPng(blob: Blob): Promise<Blob> {
  if (!pngTranscodeNeeded(blob.type)) return blob
  const bitmap = await createImageBitmap(blob)
  try {
    return await encodePng(bitmap)
  } finally {
    // 位图占的是解码后的显存/内存，不 close 会一直留着（一次复制就几百 KB~几 MB）。
    bitmap.close()
  }
}

const BROWSER_ENV: ClipboardEnv = {
  available(): boolean {
    return typeof navigator !== 'undefined'
      && navigator.clipboard !== undefined && navigator.clipboard !== null
      && typeof navigator.clipboard.writeText === 'function'
      && typeof navigator.clipboard.write === 'function'
      && typeof globalThis.ClipboardItem === 'function'
  },
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text)
  },
  async writeImage(png: Blob): Promise<void> {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  },
  loadBlob,
  toPng,
}

/** 共享单例：env 无状态，没必要每次调用新建。 */
export function clipboardEnv(): ClipboardEnv {
  return BROWSER_ENV
}
