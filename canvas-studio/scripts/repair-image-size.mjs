/**
 * CV-229 历史画布修复：把「从没量过真实分辨率」的图片节点补上尺寸与分辨率。
 *
 * 背景：定妆照（character_sheet）与末帧（extract_last_frame）这两类节点由 Host 创建，
 * 落盘时**没写** mediaWidth/mediaHeight，节点框也只写了占位尺寸（260×228），指望客户端
 * 媒体加载时的「长边 480」校正兜回来。实测那张网没有落地（2026-09-21 17:25 之后创建的
 * 6/6 个此类节点至今 mediaWidth 为 undefined），于是定妆照卡一直比同画布的普通图片卡小
 * 一圈，详情面板也读不到分辨率。CV-229 已在 Host 落盘路径修好（新节点不再依赖那张网），
 * 但这个脚本负责把**已经写坏的历史画布**修回来。
 *
 * 判定（只碰同时满足的节点，避免覆盖用户手动调过的尺寸）：
 *   1. kind === 'image' 且 url 指向本项目的本地资产；
 *   2. **mediaWidth 未定义** —— 说明这张图从没被量过（量过就一定有值）；
 *   3. 资产文件能解析出像素。
 * 命中后：补 mediaWidth/mediaHeight；若节点框仍是占位框且画面比例偏差 > 5%
 * （与客户端 CV-029 同一判据），按 frameSizeOf 重算节点框（长边 480 规则）。
 *
 * 用法：
 *   node scripts/repair-image-size.mjs            # 只报告，不写盘（默认）
 *   node scripts/repair-image-size.mjs --write    # 实际写盘（写前留 canvas.json.bak）
 *   node scripts/repair-image-size.mjs --root <资产库根目录>
 */
import { copyFile, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { frameSizeOf, mediaBoxOf, DEFAULT_NODE_SIZE } from '../lib/canvas-aspect.js'

const args = process.argv.slice(2)
const write = args.includes('--write')
const rootArgIndex = args.indexOf('--root')

/** 资产库根目录：优先 --root，其次 ~/.videobuddy/settings.yaml 的 canvas-studio.assetDir。 */
async function resolveRoot() {
  if (rootArgIndex >= 0 && args[rootArgIndex + 1] !== undefined) return args[rootArgIndex + 1]
  const settings = join(homedir(), '.videobuddy', 'settings.yaml')
  const text = await readFile(settings, 'utf8')
  const match = /assetDir:\s*(\S+)/u.exec(text)
  if (match === null) throw new Error(`未在 ${settings} 找到 canvas-studio.assetDir（可用 --root 指定）`)
  return match[1].replace(/^["']|["']$/gu, '')
}

/** 从字节解析图片像素（PNG IHDR / JPEG SOF / GIF 头）。解析不出返回 null。 */
function imageSizeOf(bytes) {
  // PNG：magic + IHDR，宽高在固定偏移 16/20（大端）。
  if (bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    return width > 0 && height > 0 ? { width, height } : null
  }
  // GIF：宽高在前 10 字节里，小端。
  if (bytes.length >= 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  // JPEG：扫 SOFn 段（跳过 APPn 等非 SOF 段）。
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      const length = bytes.readUInt16BE(offset + 2)
      const isSof = marker !== undefined
        && marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        const height = bytes.readUInt16BE(offset + 5)
        const width = bytes.readUInt16BE(offset + 7)
        return width > 0 && height > 0 ? { width, height } : null
      }
      offset += 2 + length
    }
  }
  return null
}

/** 资产 url（/canvas-studio/assets/<projectId>/<file>）→ 本地绝对路径。urllib 编码需还原。 */
function assetFileOf(assetsDir, url) {
  const match = /^\/canvas-studio\/assets\/[^/]+\/(.+)$/u.exec(url ?? '')
  if (match === null) return null
  return join(assetsDir, decodeURIComponent(match[1]))
}

async function repairProject(projectDir, name) {
  const canvasPath = join(projectDir, 'canvas.json')
  const doc = JSON.parse(await readFile(canvasPath, 'utf8'))
  const assetsDir = join(projectDir, 'assets')
  const changes = []

  for (const node of doc.nodes ?? []) {
    if (node.kind !== 'image' || node.mediaWidth !== undefined) continue
    const file = assetFileOf(assetsDir, node.url)
    if (file === null || !existsSync(file)) continue
    const size = imageSizeOf(await readFile(file))
    if (size === null) continue

    const mediaAspect = size.width / size.height
    // 节点框 → 画面框的逆运算走产品同一个 mediaBoxOf（不在这里另写一遍 -48）。
    const mediaBox = mediaBoxOf(node)
    const boxAspect = mediaBox.width / mediaBox.height
    const isPlaceholder = node.width === DEFAULT_NODE_SIZE.width && node.height === DEFAULT_NODE_SIZE.height
    const offAspect = Math.abs(boxAspect - mediaAspect) / mediaAspect > 0.05
    const next = { mediaWidth: size.width, mediaHeight: size.height }
    if (isPlaceholder && offAspect) {
      const box = frameSizeOf(size)
      next.width = box.width
      next.height = box.height
    }
    changes.push({ node, next })
  }

  if (changes.length === 0) return null
  if (write) {
    await copyFile(canvasPath, `${canvasPath}.bak`)
    const nodes = doc.nodes.map(node => {
      const hit = changes.find(entry => entry.node.id === node.id)
      return hit === undefined ? node : { ...node, ...hit.next }
    })
    const tmpPath = `${canvasPath}.tmp`
    await writeFile(tmpPath, `${JSON.stringify({ ...doc, nodes }, null, 2)}\n`, 'utf8')
    // 原子替换：桌面应用可能正开着这个项目，半截文件比旧值更糟。
    await rename(tmpPath, canvasPath)
  }
  return { name, changes }
}

const root = await resolveRoot()
const projectsDir = join(root, 'projects')
if (!existsSync(projectsDir)) throw new Error(`项目目录不存在：${projectsDir}`)

const entries = await readdir(projectsDir, { withFileTypes: true })
let projects = 0
let nodes = 0
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const result = await repairProject(join(projectsDir, entry.name), entry.name)
  if (result === null) continue
  projects += 1
  nodes += result.changes.length
  console.log(`\n▸ ${result.name}`)
  for (const { node, next } of result.changes) {
    const box = next.width === undefined ? '框不动' : `框 ${node.width}×${node.height} → ${next.width}×${next.height}`
    console.log(`   ${node.toolName ?? node.id.slice(0, 8)}  ${box}  媒体 ${next.mediaWidth}×${next.mediaHeight}`)
  }
}
console.log(`\n${write ? '已修复' : '待修复（未写盘，加 --write 生效）'}：${projects} 个项目 / ${nodes} 个节点`)
if (!write && nodes > 0) console.log('提示：写盘前请先退出桌面应用，避免它内存里的旧画布把修复覆盖回去。')
