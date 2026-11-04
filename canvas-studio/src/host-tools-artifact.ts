/**
 * 复刻提效批二/三：**素材加工与过程便签**类 Host 工具。
 *
 * 为什么独立成文件：`host-tools.ts` 在「文件行数 ≤1200 白名单棘轮」与「单函数跨度
 * ≤600 棘轮」双重约束下（`tests/file-size-guard.test.mjs`，只准减不准增）。本轮
 * 新增 `image_crop` / `write_note` 让主文件从 4692 涨到 4882 行、`createStudioTools`
 * 从 2712 涨到 2900 —— 直接红。按 `host-tools-audio.ts` 的先例外置：工厂注入
 * `registry` 与 `resolveProjectId`，工具定义原样搬过来。
 *
 * 三个工具的共同点：都只操作**本地素材 / 画布节点**，不调 Drama 后端：
 * - `image_crop`   —— 拼贴/精灵图裁出子图（治「模型自写 52 次 PIL 脚本」）。
 * - `image_matting` —— 纯色底抠透明底（CV-394），本轮补上数值自检。
 * - `write_note`   —— 过程便签（治「173 步 0 可见文本 + 拆解成果没处落」）。
 *
 * 共享的 `renderTextResult` 已提到 `tool-result-text.ts`（三个工具模块同一份实现）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import { throwError } from './error-system.js'
import { newAssetId } from './config.js'
import { deriveNodePlacement } from './canvas-placement.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import { stubPayloadMessage, stubTextReason } from './text-guard.js'
import { renderTextResult } from './tool-result-text.js'
import { saveLocalAssetBytes } from './generate.js'
import { alphaDestPath, auditMattingFile, auditVerdict, runImageMatting } from './image-matting.js'
import { cropScratchPath, discardScratch, ensureAssetsDir, resolveCropSource, runImageCrop, type CropGrid, type CropRect } from './image-crop.js'

export interface ArtifactToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
}

/** 素材加工 / 便签类工具（`image_crop` / `image_matting` / `write_note`）。 */
export function defineArtifactTools(deps: ArtifactToolsDeps): ReturnType<typeof defineTool>[] {
  const { registry, resolveProjectId } = deps
  return [
    defineTool({
      name: 'image_matting',
      description:
        '纯色底图抠透明底（alpha PNG，内置 ffmpeg colorkey）。把「白底/纯色底的产品图、logo、精灵图」转成真透明素材，供 render_composition 的 image 轨直接引用 —— 解决生图模型不吐 alpha 的缺口（甜品复刻会话实测：伪透明拼贴会在成片留棋盘格残边）。'
        + '用法：生图时提示词固定「纯白背景」（或绿底绿幕）→ 本工具抠掉底色 → 产物 `<原名>-alpha.png` 落同目录，image 轨 src 直接引用。'
        + '边界：抠的是**单一底色**（相似度阈值），毛发/透明玻璃等软边题材质量一般；复杂底用外部工具处理后 upload_image。key 色支持 white/black/green/magenta/#RRGGBB。'
        + '\n\n**返回自带数值自检**（你不需要看图）：透明率 / 不透明区残留底色 / 四角 alpha / colorType，并直接给「通过 | 未通过 + 该怎么调」。判「抠干净没有」的正解是**残留底色**，不是四角 alpha —— 圆角白卡的角本来就该不透明，别用它判失败（复刻会话踩过的坑）。',
      parameters: {
        filePath: { type: 'string' as const, description: '源图绝对路径（png/jpg/webp；纯色底）' },
        key: { type: 'string' as const, description: '要抠掉的底色：white / black / green / magenta / #RRGGBB（生图白底场景缺省 white 可不传）' },
        similarity: { type: 'number' as const, description: '可选：抠取宽度 0–1（与底色多近算命中），缺省 0.28；底色不纯（压缩噪点）提到 0.35–0.5，边缘误伤就降' },
        blend: { type: 'number' as const, description: '可选：边缘羽化 0–1，缺省 0.12' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '抠图产物路径 + 复查与调参指引' },
          },
        },
        render: renderTextResult,
      },
      execute: async ({ filePath, key, similarity, blend }: { filePath?: string; key?: string; similarity?: number; blend?: number }) => {
        if (typeof filePath !== 'string' || filePath.trim() === '') {
          throwError('CS-USER-ERR', { message: 'filePath 不能为空：传源图的绝对路径（画布资产或项目资产目录内）', detail: 'empty filePath' })
        }
        const srcPath = filePath
        const destPath = alphaDestPath(srcPath)
        let result
        try {
          result = await runImageMatting({
            srcPath,
            destPath,
            key: typeof key === 'string' && key.trim() !== '' ? key : 'white',
            similarity: typeof similarity === 'number' ? similarity : undefined,
            blend: typeof blend === 'number' ? blend : undefined,
          })
        } catch (error) {
          throwError('CS-USER-ERR', { message: error instanceof Error ? error.message : String(error), detail: 'image_matting failed' })
        }
        // 2026-11-02 复刻真机复盘：质量自查从「目视边缘」改成数值自检 —— 当时模型行
        // 未声明 image input，read_image 会报错。2026-11-04 已补声明、可直接读图，
        // 但数值自检仍是更可复算的客观判据（alpha / 残留底色），不随能力恢复而删。
        const audit = auditMattingFile(result.destPath, result.key)
        const verdict = audit === null ? null : auditVerdict(audit)
        const lines = [
          `抠图完成：${result.destPath}（${(result.bytes / 1024).toFixed(0)} KB，key=${result.key} similarity=${result.similarity} blend=${result.blend}）`,
        ]
        if (audit !== null && verdict !== null) {
          lines.push(
            `数值自检 ${verdict.ok ? '通过' : '未通过'}：${verdict.note}`,
            `原始指标：${audit.width}×${audit.height} colorType=${audit.colorType}（6=RGBA）｜透明率 ${audit.alphaPct.toFixed(1)}% ｜不透明区残留底色 ${audit.keyResiduePct.toFixed(1)}% ｜四角 alpha ${audit.corners.join('/')}`,
          )
          if (!verdict.ok) {
            lines.push('⚠️ 自检未通过就先别往下走：按上面那条建议调参重抠一次（同一个源图重跑，产物会覆盖）。四角 alpha 只是辅助线索 —— 圆角白卡的角本来就该不透明，判「抠干净没有」只看残留底色。')
          }
        } else {
          lines.push('数值自检不可用（产物解不成 PNG）；改用 inspect_image mode:"profile" 核对 colorType=6（RGBA）。')
        }
        lines.push('下一步：image 轨 src 直接引用产物 PNG；要再进生图/视频参考，先 upload_image 传它拿后端 filename。')
        return { text: lines.join('\n') }
      },
    }),
    defineTool({
      name: 'image_crop',
      description:
        '从整图 / 拼贴图里裁出一块子图，落为**项目资产**（可被 upload_image / image_matting / inspect_image / render 轨直接引用）。'
        + '\n\n**什么时候用**：一张图里含多个独立素材（六格拼贴、精灵图、九宫格、扫描件多联页），而下游每一条（生图参考 / 抠图 / 上传 / 轨引用）都要独立文件时。'
        + '\n⚠️ **不要再写 Python/PIL/numpy 裁切脚本** —— 这条路径既慢（甜品复刻会话实测：模型自写 52 次像素脚本，占全会话 28% 的模型时间）、产物又没有血缘（手搓文件名塞 assets，GC 与历史面板都看不见）。'
        + '\n\n**两种定位，必须给且只给一个**：'
        + '① `grid` —— 按行列均分（rows×cols，row/col **从 1 起**），拼贴图首选，不用自己算像素；'
        + '② `rect` —— 像素矩形（x/y 是**左上角**，w/h 是宽高）。'
        + '\n⚠️ `rect` 与 `inspect_image` 的 `region` **不是同一套坐标**：region 是画布百分比中心语义（结果直接填 render 轨 transform），rect 是图片像素左上角语义（裁的是物理像素）。'
        + '\n\n**返回带自证数字**（你看不见图，靠这些判断裁对没有）：产物尺寸 / 四边平均色 / 主色 top3 / 8×4 亮度字符图。四边接近 #FFFFFF = 白底产品区；某边明显偏暗 = 格子边界切到相邻内容，改 row/col 或 rect 重裁。'
        + '\n\n越界不会静默修正：rect 超出源图会直接报错并给出**源图尺寸与当前 x/y 下的最大 w/h**，按数字改一次即可。',
      parameters: {
        source: { type: 'string' as const, required: true, description: '源图：项目资产目录内的**绝对路径**，或画布资产 URL（/canvas-studio/assets/...）。跨项目素材先导入本项目' },
        grid: {
          type: 'object' as const,
          additionalProperties: false,
          description: '可选（与 rect 二选一）：按行列均分取格。例：1280×480 的六格拼贴是 rows:2 cols:3，第 2 行第 3 列 → {rows:2,cols:3,row:2,col:3}',
          properties: {
            rows: { type: 'number' as const, description: '纵向格数（1–24）' },
            cols: { type: 'number' as const, description: '横向格数（1–24）' },
            row: { type: 'number' as const, description: '取第几行，**从 1 起**' },
            col: { type: 'number' as const, description: '取第几列，**从 1 起**' },
          },
        },
        rect: {
          type: 'object' as const,
          additionalProperties: false,
          description: '可选（与 grid 二选一）：像素矩形。x/y 是**左上角**（不是中心），w/h 是宽高；必须完整落在源图内',
          properties: {
            x: { type: 'number' as const, description: '左上角 x（像素，0 起）' },
            y: { type: 'number' as const, description: '左上角 y（像素，0 起）' },
            w: { type: 'number' as const, description: '宽（像素）' },
            h: { type: 'number' as const, description: '高（像素）' },
          },
        },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '产物文件名 / 绝对路径 / 资产 URL + 自证数字（尺寸、四边色、主色、亮度图）' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { source?: string; grid?: CropGrid; rect?: CropRect }
        if (typeof a.source !== 'string' || a.source.trim() === '') {
          throwError('CS-USER-ERR', { message: 'source 不能为空：传源图绝对路径或画布资产 URL（/canvas-studio/assets/...）' })
        }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const srcPath = resolveCropSource(a.source, registry, projectId)
        const assetsDir = registry.assetsDir(projectId)
        await ensureAssetsDir(assetsDir)
        const scratch = cropScratchPath(assetsDir, newAssetId())
        try {
          const { bytes, outcome } = await runImageCrop({
            srcPath,
            grid: a.grid,
            rect: a.rect,
            scratchPath: scratch,
            signal: exec.signal,
          })
          // 落资产走唯一入口（资产历史 + 历史保护名单）；绝不手搓落盘名。
          const saved = await saveLocalAssetBytes(registry, projectId, 'crop.png', bytes)
          const absPath = join(assetsDir, saved.assetFile)
          const { rect, provenance: p } = outcome
          const locator = a.grid === undefined
            ? 'rect'
            : `grid ${a.grid.rows}×${a.grid.cols} 第 ${a.grid.row} 行第 ${a.grid.col} 列`
          const lines = [
            `裁切完成：${saved.assetFile}（${p.width}×${p.height}，${locator}）`,
            `源图 ${outcome.sourceWidth}×${outcome.sourceHeight} ⇒ rect x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`,
            `绝对路径：${absPath}`,
            `资产 URL：${saved.url}`,
            `自证｜透明 ${p.alphaPct.toFixed(1)}% ｜ 四边 上${p.edges.top} 下${p.edges.bottom} 左${p.edges.left} 右${p.edges.right} ｜ 主色 ${p.topColors.length > 0 ? p.topColors.join(' ') : 'n/a'}`,
          ]
          if (p.luminanceRows.length > 0) {
            lines.push(`亮度图（8 列 × 4 行，字符越靠后越亮，空格=最暗）：\n${p.luminanceRows.join('\n')}`)
          }
          lines.push(
            '自证怎么看：四边接近 #ffffff = 这一格是白底产品区；某一边明显偏暗 = 边界切到了相邻内容（改 row/col 或 rect 重裁，别带着错素材往下走）。',
            '下一步：upload_image 传上面的资产 URL 拿后端 filename（给 image_generate / video_generate）；或把绝对路径直接喂 image_matting / inspect_image。',
          )
          return { text: lines.join('\n') }
        } finally {
          await discardScratch(scratch)
        }
      },
    }),
    defineTool({
      name: 'write_note',
      description:
        '往画布上写一张**便签**（kind=sticky），用于把中间成果摊给用户看：参考片拆解表、镜头映射草案、素材清单、假设与风险。'
        + '\n\n**为什么必须用它，而不是在回复里说一段话**：便签是画布上**持久可见**的卡片 —— 用户能看、能改、能据此叫你返工；你的聊天文本在长回合里会被淹掉。'
        + '同时它是你**自己的读回通道**：`list_references` 的 `notes` 会把这些便签原样读回来（含 write_script 文案、分镜表），所以下一个阶段不用重新推理「上一轮结论是什么」。'
        + '\n\n**什么时候用**：① 参考片/爆款拆解完成后（段表 + 时长 + 内容）—— 这是复刻流程的**强制检查点**；② 每个阶段收尾时把「本轮做了什么、下一轮要做什么、还有哪些待定」写一张；③ 需要用户拍板的前置信息。'
        + '\n⚠️ 与 `write_script` 的区别：write_script 是**成片文案**（会被 compose_video 当 scriptId 消费，且受故事板落地闸约束）；本工具是**过程便签**，不参与渲染、不受任何闸约束，随时可写。'
        + '\n\n每次调用新建一张便签（不覆盖旧的）；要改就再写一张并说明「取代上一张」，不要指望同一张自动更新。',
      parameters: {
        title: { type: 'string' as const, required: true, description: '便签标题（短，≤20 字；如「参考片拆解（7 段）」『镜头映射草案』）' },
        text: { type: 'string' as const, required: true, description: '正文（Markdown 风格纯文本；段表用逐行「段名 | 起-止 | 时长 | 内容」这种一行一条的形式，便于用户对照）' },
        anchorNodeId: { type: 'string' as const, description: '可选：把这便签落在哪个画布节点的右侧（节点 id，来自生成工具结果或 list_shots）。不传则落在画布当前最下方' },
        sourceIds: { type: 'array' as const, description: '可选：关联的画布节点 id 数组（画血缘箭头，如「这张拆解便签基于哪个参考视频节点」）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '落盘结果说明（含便签节点 id）' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { title?: string; text?: string; anchorNodeId?: string; sourceIds?: unknown[] }
        const title = typeof a.title === 'string' ? a.title.trim() : ''
        const body = typeof a.text === 'string' ? a.text.trim() : ''
        if (title === '') throwError('CS-USER-ERR', { message: 'title 不能为空：便签需要一个短标题（≤20 字）' })
        // 与 write_script 同一把尺子：占位载荷拒收（模型爱先发 {"text":"待补充"} 占位，
        // 便签是 append-only，占位卡会永久留在画布上没人替换）。
        const stubReason = stubTextReason(body)
        if (stubReason !== null) {
          throwError('CS-USER-ERR', { message: stubPayloadMessage('便签', '拆解表 / 映射草案 / 假设与风险', stubReason) })
        }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const existing = (await registry.readCanvas(projectId)).nodes
        const sourceIds: string[] = []
        if (Array.isArray(a.sourceIds)) {
          for (const raw of a.sourceIds) {
            if (typeof raw !== 'string') continue
            const hit = existing.find((node) => node.id === raw)
            if (hit !== undefined && !sourceIds.includes(hit.id)) sourceIds.push(hit.id)
          }
        }
        if (typeof a.anchorNodeId === 'string' && a.anchorNodeId.trim() !== '') {
          const anchorId = a.anchorNodeId.trim()
          const anchor = existing.find((node) => node.id === anchorId)
          if (anchor === undefined) {
            throwError('CS-USER-ERR', {
              message: `anchorNodeId 指向不存在的节点：${anchorId}；用 list_shots / list_references 查真实节点 id，或干脆不传（便签落在画布最下方）`,
            })
          }
          if (!sourceIds.includes(anchor.id)) sourceIds.push(anchor.id)
        }
        const width = 340
        // 高度按正文量自适应（一行约 28 个汉字宽度），上限 640 防长文撑爆画布。
        const height = Math.min(180 + Math.ceil(body.length / 28) * 20, 640)
        const placement = deriveNodePlacement(existing, sourceIds, width, height)
        const node: StudioCanvasNode = {
          id: newAssetId(),
          kind: 'sticky',
          title,
          text: body,
          x: placement.x,
          y: placement.y,
          width,
          height,
          createdAt: Date.now(),
          toolName: 'write_note',
          origin: 'agent',
          sourceIds,
        }
        await registry.appendCanvasNode(projectId, node)
        return {
          text: `便签「${title}」已落到画布（节点 id=${node.id}，位置 ${Math.round(placement.x)},${Math.round(placement.y)}）。`
            + '用户可以在这张卡上直接看到内容；你后续可以用 list_references 的 notes 把它读回来。'
            + '若这是流程检查点：请在回复里用一两句话说明「这一步得出了什么、下一步要做什么」再继续。',
        }
      },
    }),
  ]
}
