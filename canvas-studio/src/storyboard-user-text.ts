/**
 * 「参考素材」派生节（REQ-037 延伸）的文字读取器。
 *
 * 为什么独立成文件：`routes.ts` 在文件行数棘轮下只准减不准增
 * （`tests/file-size-guard.test.mjs`），读盘型 resolver 落在新文件，
 * routes 只留一行接线。
 *
 * 口径：故事板 §07 里 `source:"user"` 且 `type:"text"` 的 file 引用 → 文件全文，
 * 由「参考素材」节以 `<details>` 内联展示（渲染纯函数零 IO，读盘留在路由侧）。
 * 逐条降级不抛错：文件名非法 / 越界 / 读失败 / 超限都只让该条退回
 * 「只显示引用」，不阻断整个故事板。截断时带一行说明，不让用户把残文当全文。
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { StoryboardDocument } from './contracts/storyboard.js'
import type { ProjectRegistry } from './projects.js'
import { isAssetFileName, resolveAssetPathIn } from './asset-path.js'

/** 文字内联的白名单扩展（与 classifyFile 的 text 类同源，含点小写）。 */
const TEXT_INLINE_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.md', '.json', '.csv', '.log'])
/** 单个文字附件内联进故事板 HTML 的字节上限（超出截断；上传侧 text 上限 5MB，不整读）。 */
const TEXT_INLINE_LIMIT = 256 * 1024

export async function storyboardUserTextResolver(
  registry: ProjectRegistry,
  projectId: string,
  document: StoryboardDocument,
): Promise<((ref: { kind: 'canvasNode' | 'file'; id: string }) => string | undefined) | undefined> {
  const textRefs = document.sections['07_assets']
    .filter((asset) => asset.source === 'user' && asset.type === 'text' && asset.ref.kind === 'file')
    .map((asset) => asset.ref.id)
  if (textRefs.length === 0) return undefined
  const map = new Map<string, string>()
  for (const file of textRefs) {
    if (!isAssetFileName(file)) continue
    if (!TEXT_INLINE_EXTENSIONS.has(extname(file).toLowerCase())) continue
    try {
      const target = resolveAssetPathIn(registry.assetsDir(projectId), file)
      const size = (await stat(target)).size
      if (size > TEXT_INLINE_LIMIT) {
        const buffer = await readFile(target)
        map.set(file, buffer.subarray(0, TEXT_INLINE_LIMIT).toString('utf-8')
          + '\n…（文件较大，已截断展示前 256KB，完整内容见原文件）')
        continue
      }
      map.set(file, await readFile(target, 'utf-8'))
    } catch {
      /* 读失败 = 该条降级为引用行，不阻断渲染 */
    }
  }
  if (map.size === 0) return undefined
  return (ref) => map.get(ref.id)
}
