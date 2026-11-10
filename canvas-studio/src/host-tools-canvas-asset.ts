/**
 * 画布资产登记工具（`attach_canvas_asset`，2026-11-10 香水样本 P0-2 收口）。
 *
 * 为什么独立成文件：`host-tools.ts` 在文件行数棘轮下只准减不准增
 * （`tests/file-size-guard.test.mjs`），与 `host-tools-remake.ts` / `host-tools-data.ts`
 * 同款外置——工厂注入 registry 与项目解析，主文件只留一行 spread。
 *
 * 判据与写入全在 `canvas-asset-attach.ts`：本文件只做「参数收窄 + 回执文案」。
 * 这一层薄不是风格问题：上一轮把 8 行校验内联进 `createStudioTools` 就顶红了函数跨度闸。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectRegistry } from './projects.js'
import { throwError } from './error-system.js'
import { renderTextResult } from './tool-result-text.js'
import { attachCanvasAsset, type AttachCanvasAssetInput } from './canvas-asset-attach.js'

export interface CanvasAssetToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
}

/** 画布资产登记工具组（当前仅 attach_canvas_asset）。 */
export function defineCanvasAssetTools(deps: CanvasAssetToolsDeps): ReturnType<typeof defineTool>[] {
  const { registry, resolveProjectId } = deps
  return [
    defineTool({
      // 工具名写**字面量**：门禁（skill-tool-refs 的幽灵引用扫描 / tool-registry 名单）
      // 按 `name: '…'` 的文本形态提取，写成常量引用会被判成「未注册」。常量
      // `ATTACH_CANVAS_ASSET_TOOL` 只给拒收文案用，两者一致性由 tests/attach-canvas-asset.test.mjs 断言。
      name: 'attach_canvas_asset',
      description:
        '把**已经躺在本地磁盘上的产物**登记成画布节点（图片 / 视频 / 音频）：落进项目资产目录 + 建同源节点，用户立刻能在画布上看到。'
        + '\n\n**什么时候用**：你要给用户看的东西**已经存在**——上一轮合成好的成片、手写脚本产出的 mp4、用户电脑里现成的素材。'
        + '只要「手里有这个文件、想让它出现在画布上」，就用本工具，**不要**去手写 `build/manifest.json`，**更不要**改 `canvas.json`（那是绕开合并保护与资产账的旁路，会丢节点）。'
        + '\n\n**什么时候别用**：① 要让模型重新生成 → `image_generate` / `video_composite` / `render_composition`；'
        + '② 要 Drama 后端句柄做生成输入 → `upload_image`（它只上传、不建节点）；'
        + '③ 视频页链接 → `download_video`；④ 文本 → `write_note`。'
        + '\n\n登记后：节点带同源 URL 与 createdAt，时长/尺寸缺省由 ffmpeg 实测；要进素材托盘与故事板 §07 引用链就传 asReference=true。',
      parameters: {
        path: { type: 'string' as const, required: true, description: '本地文件**绝对路径**（如 /Users/…/build/draft-final-480p.mp4）。不接受 http(s) 链接与相对路径' },
        kind: { type: 'string' as const, description: '可选：image / video / audio。缺省按扩展名判；显式传时须与扩展名一致（不一致即拒收，防按错轨道登记）' },
        title: { type: 'string' as const, description: '可选：画布上显示的标题。缺省用文件名' },
        duration: { type: 'number' as const, description: '可选：媒体时长（秒）。缺省由 ffmpeg 实测；已知时传上可省一次探测' },
        width: { type: 'number' as const, description: '可选：媒体像素宽（用于画布节点比例）。缺省由 ffmpeg 实测' },
        height: { type: 'number' as const, description: '可选：媒体像素高' },
        asReference: { type: 'boolean' as const, description: '可选：标为参考素材（进素材托盘 / 故事板 §07 可引用）。成片与草稿默认不标' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '节点 id / 同源 URL / 实测参数 + 下一步指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as unknown as Partial<AttachCanvasAssetInput>
        if (typeof a.path !== 'string' || a.path.trim() === '') {
          throwError('CS-USER-ERR', { message: 'path 不能为空：传本地产物的绝对路径。' })
        }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const result = await attachCanvasAsset(
          registry,
          projectId,
          {
            path: a.path,
            ...(typeof a.kind === 'string' ? { kind: a.kind } : {}),
            ...(typeof a.title === 'string' ? { title: a.title } : {}),
            ...(typeof a.duration === 'number' ? { duration: a.duration } : {}),
            ...(typeof a.width === 'number' ? { width: a.width } : {}),
            ...(typeof a.height === 'number' ? { height: a.height } : {}),
            ...(a.asReference === true ? { asReference: true } : {}),
          },
          { signal: exec.signal },
        )
        const detail = [
          typeof result.duration === 'number' ? `${result.duration.toFixed(2)}s` : '时长未知',
          `${String(result.width)}×${String(result.height)} 画布框`,
          `${(result.bytes / 1024 / 1024).toFixed(2)}MB`,
          result.probed ? 'ffmpeg 实测' : '按入参/未测',
        ].join(' · ')
        return {
          text: [
            `✅ 已登记到画布：${result.title}（节点 ${result.nodeId}）`,
            `类型：${result.kind} · ${detail}`,
            `同源 URL：${result.url}`,
            '该节点由 Host 经画布唯一写口落盘（合并保护 / 资产账 / 版本齐备）。下一步直接用节点 id 或 URL 引用它，**不要**再手写 manifest 或改 canvas.json。',
            result.kind === 'image'
              ? '要拿 Drama 后端句柄做生成输入时，再对它调 upload_image（本工具只登记、不上传）。'
              : '已经是本地同源资产：合成 / 抽帧 / 对比可直接吃它的路径或 URL。',
          ].join('\n'),
        }
      },
    }),
  ]
}
