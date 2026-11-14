/**
 * RQ-R9/P2-c（2026-11-14 复盘 #8 上半，K5 限定）· **字体存在性预检**（宿主侧）。
 *
 * ## 解决什么
 *
 * 纸墨项目的 Noto Serif SC 离线解析把隐藏窗口按死 3 次（进度 50%），换随包字体后
 * 4s 渲完 —— 字体问题在渲染期才暴露的代价太高。本模块把「能零风险查的」前置到
 * 编译/校验回执：声明的字体文件**存在吗**。
 *
 * ## 边界（K5：解析级预检做不了）
 *
 * - 只查**文件存在性**；「文件在但解析挂死」的预检要把解析搬进编译期 = 把渲染期的
 *   卡死搬进编译期，做不了也不该做——那类靠 E2 重试 + `pitfalls.md` §10 文档兜底。
 * - **为什么放宿主侧新文件而不是 fonts.ts**：fonts.ts 被客户端 bundle 引用
 *   （font-context），node:fs 进浏览器包会炸打包（render-forensics 的
 *   UnhandledSchemeError 病史）。
 * - 只报**可验证**的问题：本地绝对路径必查；同源 URL 给了 assetsDir 才查；
 *   `src` 缺省走宿主字体解析表（合法路径，不报）；随包族（Noto Sans SC）不报。
 */

import { existsSync } from 'node:fs'
import { resolveAssetPathIn } from './asset-path.js'

/** 同源资产 URL 前缀（与产品语义一致）：`/canvas-studio/assets/<projectId>/<file>`。 */
const PROJECT_ASSET_URL_PREFIX = '/canvas-studio/assets/'

interface FontEntryShape {
  family?: unknown
  src?: unknown
}

interface GlobalShape {
  fontFamily?: unknown
  fonts?: unknown
}

/**
 * 字体存在性预检（纯读，从不抛）。返回 warning 行（空数组 = 无话可说）。
 *
 * @param global manifest.global（缺省安全）
 * @param assetsDir **该项目的资产目录**（registry.assetsDir(projectId)）；同源 URL 的
 *        `<projectId>/<file>` 段由本函数剥离 `<file>` 再解析；不给则同源 URL 跳过不查
 */
export function fontPresenceWarnings(
  global: GlobalShape | undefined,
  assetsDir?: string,
): string[] {
  const fonts = global?.fonts
  if (!Array.isArray(fonts) || fonts.length === 0) return []
  const warnings: string[] = []
  fonts.forEach((font, index) => {
    const at = `global.fonts[${String(index)}]`
    if (font === null || typeof font !== 'object') return
    const entry = font as FontEntryShape
    const family = typeof entry.family === 'string' ? entry.family : ''
    const src = typeof entry.src === 'string' ? entry.src : undefined
    if (src === undefined) return
    let exists: boolean | undefined
    let illegal: string | undefined
    if (src.startsWith(PROJECT_ASSET_URL_PREFIX)) {
      if (assetsDir === undefined) return
      // 同源 URL 形如 /canvas-studio/assets/<projectId>/<file>：剥离 projectId 段取裸文件名
      //（resolveAssetPathIn 只收裸名，路径分隔符是非法资产名——真机同款校验）
      const file = src.slice(PROJECT_ASSET_URL_PREFIX.length).split('/').pop() ?? ''
      try {
        exists = existsSync(resolveAssetPathIn(assetsDir, file))
      } catch (cause) {
        illegal = cause instanceof Error ? cause.message : String(cause)
      }
    } else if (src.startsWith('/') || src.startsWith('\\')) {
      exists = existsSync(src)
    } else {
      return
    }
    if (illegal !== undefined) {
      warnings.push(`${at}（${family || '未命名族'}）的字体 src 是非法资产文件名：${src} —— ${illegal}；请用 upload_image 产物名或改用随包族`)
      return
    }
    if (exists === false) {
      warnings.push(
        `${at}（${family || '未命名族'}）声明的字体文件不存在：${src} —— 渲染将回落随包族`
          + '（Noto Sans SC），观感会变；确认路径或改用随包族（Noto Serif SC 离线解析案见 pitfalls §10）',
      )
    }
  })
  return warnings
}
