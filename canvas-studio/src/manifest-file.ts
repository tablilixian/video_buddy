/**
 * P1-3 · `scaffold_manifest({ writeTo })` 的落盘实现。
 *
 * ## 为什么要有它
 * 真机事故里 205 步工具调用全在绕 `build/manifest.json` 这一个文件：骨架 JSON
 * 只能回显到对话里，模型再**抄一遍**写盘 —— 60KB 级回显、抄错一个括号就整段重来，
 * 而且每次都把上下文预算烧一遍。给了 `writeTo` 就能「生成即落盘」：
 * R0 从「3 次调用 + 60KB 输出」降到「2 次调用 + 1KB 输出」。
 *
 * ## 边界（都写在 `writeManifestFile` 的校验里）
 * - 目标必须落在**本项目的项目目录内**：先 `resolve` 再比 `root + sep`，
 *   不能只比前缀 —— 否则 `<root>-evil` 这种同前缀兄弟目录会被放进来。
 * - 相对路径按项目根解析（模型常写 `build/manifest.json`），随后照样过一遍包含校验。
 * - 拒收时**零副作用**：校验全部通过才 mkdir / write。
 * - 只回显前 40 行：够人核对结构，又不把 60KB 重新塞回上下文。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { throwError } from './error-system.js'

/** 回显行数：骨架前 40 行足够核对 id / meta / 前几轨，再多就变成第二份 60KB。 */
export const MANIFEST_PREVIEW_LINES = 40

export interface ManifestFileWrite {
  /** 落盘的绝对路径（回给模型，下一步 render_composition 直接用它）。 */
  path: string
  /** 字节数（让人一眼判断「这是不是完整那份」）。 */
  bytes: number
  /** 轨数（与 validateManifest 的自检口径一致，便于和后续渲染回报对账）。 */
  trackCount: number
  /** 前 N 行文本（不含围栏，调用方自己加 ```json）。 */
  preview: string
}

/**
 * 目标是否在根目录之内。
 *
 * ⚠️ 必须比 `root + sep`：`/a/proj-evil` 以 `/a/proj` 为前缀但不在其中。
 * 根目录本身不算「之内」（写 `manifest.json` 到项目根可以，但 writeTo 指向目录本身要拒）。
 */
export function isInsideProject(root: string, target: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  if (resolvedRoot === resolvedTarget) return false
  return resolvedTarget.startsWith(resolvedRoot + sep)
}

/** 前 `lines` 行；文件比 40 行短就整份给。 */
export function previewLines(json: string, lines = MANIFEST_PREVIEW_LINES): string {
  return json.split('\n').slice(0, lines).join('\n')
}

/**
 * 落盘。校验全部前置，通过之后才有写动作 —— 「拒收」永远不会留下半个文件。
 *
 * `writeTo` 允许相对路径（按 `projectDir` 解析），但**不允许**逃出项目目录：
 * 相对写法只是省字，不是放宽边界。
 */
export function writeManifestFile(input: {
  projectDir: string
  writeTo: string
  json: string
  trackCount: number
}): ManifestFileWrite {
  const raw = input.writeTo.trim()
  if (raw === '') throwError('CS-USER-ERR', { message: 'writeTo 不能为空' })
  const resolved = resolve(input.projectDir, raw)
  if (!isInsideProject(input.projectDir, resolved)) {
    throwError('CS-USER-ERR', {
      message: `writeTo 必须落在本项目目录内（${input.projectDir}）；收到 ${raw}`
        + ' —— 骨架只写自己项目里的文件，跨项目/跨仓一律拒收。可直接传相对路径 build/manifest.json。',
    })
  }
  const bytes = Buffer.byteLength(input.json, 'utf8')
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, input.json, 'utf8')
  return {
    path: resolved,
    bytes,
    trackCount: input.trackCount,
    preview: previewLines(input.json),
  }
}
