/**
 * REQ-036 复刻客户端能力增强批：**复刻链路工具**（media_probe / evidence_grid / download_video）。
 *
 * 为什么独立成文件：`host-tools.ts` 在文件行数棘轮下只准减不准增
 * （`tests/file-size-guard.test.mjs`），按 `host-tools-artifact.ts` 的先例外置：
 * 工厂注入依赖，工具定义全部落在本模块，主文件只留一行 spread。
 *
 * 三条工具的共同点：都是**纯客户端确定性能力**（Host 侧 ffmpeg / 下载），零模型
 * 服务费用，服务「拆解输入质量」与「秒数锚定」两个复刻缺口（渲染与生成侧不动）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sep } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import { throwError } from './error-system.js'
import { renderTextResult } from './tool-result-text.js'
import { probeMedia } from './media-probe.js'
import { generateEvidenceGrid, type SamplingPass } from './evidence-grid.js'
import { downloadVideo, SITE_LABELS } from './video-download.js'
import { saveLocalAssetBytes } from './generate.js'
import { newAssetId } from './config.js'
import { deriveNodePlacement } from './canvas-placement.js'
import { frameSizeOf, DEFAULT_NODE_SIZE } from './canvas-aspect.js'
import type { StudioCanvasNode } from './contracts/canvas.js'

export interface RemakeToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
}

/** 复刻链路工具（`media_probe` / `evidence_grid` / `download_video`）。 */
export function defineRemakeTools(deps: RemakeToolsDeps): ReturnType<typeof defineTool>[] {
  // download_video 用 registry / resolveProjectId 落画布素材区与视频节点。
  const { registry, resolveProjectId } = deps
  return [
    defineTool({
      // 第 39 号工具（REQ-036 C3；编号紧接 teardown_store=38，REQ 文档写作 38/39/40
      // 是因为成文时 teardown_store 尚未占号 —— 按「写号前 grep docs/」惯例顺延）。
      name: 'media_probe',
      description:
        '媒体探针：一条命令摸清本地媒体文件的真实参数 —— 时长（秒）/ 分辨率 / fps / 音轨数 / 容器 / **综合响度（LUFS）**。'
        + '\n\n**什么时候用**：① 拆解表头部（时长/fps/音轨）—— 拆解与映射前先探，别拿声明值当真值（H3 实测请求 5s 出 5.167s，帧级对齐全偏）；'
        + '② **响度对齐**——复刻观感对齐的硬数据（甜品复刻实测：成片 -15.3 LUFS vs 原片 -11.4，无人发现）：先探参考片 LUFS，成片渲完再探一次，差值 >2 LUFS 就调 BGM/旁白音量重渲。'
        + '\n\n**不再临场拼 ffmpeg 命令**——本工具是唯一入口，内部用 ffmpeg -i + ebur128，不需要你写 argv。'
        + '响度只在有音轨时测量；无声 / 测量失败不阻塞探针（如实标注原因）。绝不抛错到「探不出来」之外——文件不存在会明确报错。',
      parameters: {
        videoPath: { type: 'string' as const, required: true, description: '媒体文件绝对路径（画布上传/生成产物的落盘路径；音频文件同样可探）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '逐项参数读数 + 用法指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args) {
        const a = args as { videoPath?: unknown }
        const videoPath = typeof a.videoPath === 'string' ? a.videoPath.trim() : ''
        if (videoPath === '' || !videoPath.startsWith(sep)) {
          throwError('CS-USER-ERR', { message: '缺少 videoPath 或不是绝对路径 —— 媒体要先落盘（画布产物路径即可）。' })
        }
        const result = await probeMedia({ path: videoPath })
        const size = result.width !== undefined && result.height !== undefined ? ` · ${result.width}×${result.height}` : ''
        const fps = result.fps !== undefined ? ` · ${result.fps} fps` : ''
        const container = result.container !== undefined ? result.container : '未知容器'
        const loudness = result.audioLoudnessLufs !== null
          ? `${result.audioLoudnessLufs.toFixed(1)} LUFS`
          : `未测得（${result.loudnessNote ?? '未知原因'}）`
        const lines = [
          `📐 ${container}${size}${fps} · ${result.durationSec.toFixed(2)}s · 视频流 ${result.videoStreams} · 音轨 ${result.audioStreams}`,
          `综合响度：${loudness}`,
        ]
        if (result.hasAudio) {
          lines.push('响度用法：把参考片 LUFS 记进拆解便签；成片渲完 media_probe 一次，差值 >2 LUFS 调音量重渲（SKILL §4 口径）。')
        } else {
          lines.push('本片无音轨 —— 拆解只看画面节奏，不需要响度对齐。')
        }
        return { text: lines.join('\n') }
      },
    }),
    defineTool({
      // 第 40 号工具（REQ-036 C2）。
      name: 'evidence_grid',
      description:
        '证据网格（爆款复刻拆解首选）：**一次调用**产出参考视频的「时间标注网格图 + 结构化清单 + 实测画面切换点」。'
        + '每格烧录实测时间戳；可选叠加该时刻的台词词标签（传 ASR 词级转写 JSON，没有就只出时间戳 —— 能力立即可用）；切点所在格自动红框标记。'
        + '\n\n**为什么必须用它而不是 inspect_image 逐帧轮询**：逐帧轮询几十次调用才拼出一段的画面变化，而且画面与口播对不上；本工具一次拿到「哪一秒画面长什么样 + 画面切换点」，拆解表直接对着网格填。'
        + '\n\n**宽窄两级采样**（与 hypit 同思路）：缺省 = 整片概览 1s/格；看到密集段（红框聚集处）→ 第二次调用传 passes 只采那一小段、interval 0.1–0.3s/格。'
        + '\n\n产物落在跨项目证据目录（teardown_store 同源指纹），路径与结构化清单在返回里，用 write_note 落拆解便签时把页图路径带上。'
        + '\n\n⚠️ 与 `verify_teardown` 的分工：本工具是**拆解证据**（看画面填表）；verify_teardown 是**回核校验**（表填完后机器比对边界）。两者切点口径同源，但一个不替代另一个。'
        + '\n\n版权提示：仅用于用户自备参考素材的拆解复刻，复刻产出默认替换原素材。',
      parameters: {
        videoPath: { type: 'string' as const, required: true, description: '参考视频绝对路径（已落盘的本地文件）' },
        passes: {
          type: 'array' as const,
          description: '可选：采样计划数组 [{start, end, interval}]（秒）。省略 = 整片概览 1s/格；密集段二次调用只传该区间 + interval 0.1–0.3',
          items: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {
              start: { type: 'number' as const, description: '起始秒（含）' },
              end: { type: 'number' as const, description: '结束秒（含，超出片长自动截断）' },
              interval: { type: 'number' as const, description: '采样间隔秒（0.1–0.3 = 密集档，1 = 概览档）' },
            },
          },
        },
        columns: { type: 'number' as const, description: '可选：网格列数，缺省 4' },
        rows: { type: 'number' as const, description: '可选：网格行数，缺省 3' },
        cellPx: { type: 'number' as const, description: '可选：单格边长 px，缺省 480；要看清细节可到 720' },
        transcriptPath: { type: 'string' as const, description: '可选：ASR 词级转写 JSON 绝对路径（后台转写服务产物 schema）；提供时每格下方叠加该时刻的台词词标签（词用【】标记 + 前 8 字上下文）' },
        markCuts: { type: 'boolean' as const, description: '可选：切点所在格红框标记，缺省 true（与 verify_teardown 同一份检测函数）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '页图路径清单 + 实测切点 + 结构化清单位置 + 拆解指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as {
          videoPath?: unknown; passes?: unknown; columns?: unknown; rows?: unknown
          cellPx?: unknown; transcriptPath?: unknown; markCuts?: unknown
        }
        const videoPath = typeof a.videoPath === 'string' ? a.videoPath.trim() : ''
        if (videoPath === '' || !videoPath.startsWith(sep)) {
          throwError('CS-USER-ERR', { message: '缺少 videoPath 或不是绝对路径 —— 参考视频要先落盘（画布上传产物路径即可）。' })
        }
        const passes: SamplingPass[] = []
        if (Array.isArray(a.passes)) {
          for (const raw of a.passes) {
            if (typeof raw !== 'object' || raw === null) continue
            const r = raw as Record<string, unknown>
            if (typeof r.start !== 'number' || typeof r.end !== 'number' || typeof r.interval !== 'number') continue
            passes.push({ start: r.start, end: r.end, interval: r.interval })
          }
        }
        const result = await generateEvidenceGrid({
          videoPath,
          ...(passes.length > 0 ? { passes } : {}),
          ...(typeof a.columns === 'number' ? { columns: a.columns } : {}),
          ...(typeof a.rows === 'number' ? { rows: a.rows } : {}),
          ...(typeof a.cellPx === 'number' ? { cellPx: a.cellPx } : {}),
          ...(typeof a.transcriptPath === 'string' && a.transcriptPath.trim() !== '' ? { transcriptPath: a.transcriptPath.trim() } : {}),
          ...(typeof a.markCuts === 'boolean' ? { markCuts: a.markCuts } : {}),
          signal: exec.signal,
        })
        const pageLines = result.pages.map((p, i) => {
          const file = result.files[i] ?? ''
          return `  第 ${p.page + 1} 页（${p.fromSec.toFixed(1)}–${p.toSec.toFixed(1)}s，${p.cellCount} 格）：${result.dir}/${file}`
        })
        const cuts = result.cutPoints.length > 0
          ? `实测画面切换点（${result.cutPoints.length} 处）：${result.cutPoints.map((c) => `${c.toFixed(2)}s`).join('、')}`
          : '未检出明显画面切换点（长镜头/缓变画面 —— 段落边界按内容节奏划分，回核时 tolerance 收紧）。'
        return { text: [
          `✅ 证据网格 ${result.cellCount} 格 · ${result.pages.length} 页（指纹 key=${result.key}${result.transcriptUsed ? ' · 含台词标注' : ''}）：`,
          ...pageLines,
          cuts,
          `结构化清单（每格 时间戳/页/行/列/台词）：${result.dir}/${result.manifestFile}`,
          '下一步：对照网格填拆解表（六列，见 viral-remake SKILL §1）；密集段（红框聚集处）用 passes 传该区间 + interval 0.1–0.3 二次采样；拆完先 verify_teardown 回核再进映射。',
        ].join('\n') }
      },
    }),
    defineTool({
      // 第 41 号工具（REQ-036 C1）。
      name: 'download_video',
      description:
        '视频页链接 → 参考视频落盘（爆款复刻前置步）：支持**抖音 / B站 / YouTube**（v1 白名单，其他站点明确报错）。'
        + '产物落**画布素材区**（项目资产 + 画布视频节点，与 upload_image 落盘形态一致）并**自动标为参考素材**（素材托盘可见、可直接登记进故事板 §07），返回的 assetPath 可直接喂 media_probe / evidence_grid / verify_teardown / inspect_image 抽帧链路。'
        + '\n\n**什么时候用**：用户发来一条链接说「复刻这条 / 拆解这条」—— 先下载落盘再进拆解，不要让用户自己去导出文件。'
        + '\n\n⚠️ 边界（如实转述给用户）：① 不支持登录态/会员内容（需登录的视频直接报错，让用户自备文件）；② 不做直播流与合集批量；③ 单条视频默认 120s 下载超时。'
        + '\n\n版权提示：仅用于用户自备参考素材的拆解复刻，复刻产出默认替换原素材。'
        + '\n\n首次调用会按需下载 yt-dlp 组件（带版本与 sha256 校验，约 30MB 一次），之后复用。',
      parameters: {
        url: { type: 'string' as const, required: true, description: '视频页链接（http/https；抖音含 v.douyin.com 短链、B站含 b23.tv 短链）' },
        expectedDurationSec: { type: 'number' as const, description: '可选：期望时长（秒），下载后校验（防错下成图集/短预告/合集）；偏差超过 max(2s, 20%) 报错' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '产物路径 / 实测参数 + 拆解下一步指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { url?: unknown; expectedDurationSec?: unknown }
        if (typeof a.url !== 'string' || a.url.trim() === '') {
          throwError('CS-USER-ERR', { message: 'url 不能为空：传视频页 http/https 链接。' })
        }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const result = await downloadVideo(
          {
            url: a.url,
            ...(typeof a.expectedDurationSec === 'number' && Number.isFinite(a.expectedDurationSec)
              ? { expectedDurationSec: a.expectedDurationSec }
              : {}),
            signal: exec.signal,
          },
          {
            saveAsset: (name, bytes) => saveLocalAssetBytes(registry, projectId, name, bytes),
            assetsDir: () => registry.assetsDir(projectId),
            appendNode: async (payload) => {
              const existing = (await registry.readCanvas(projectId)).nodes
              const size = payload.width !== undefined && payload.height !== undefined && payload.width > 0 && payload.height > 0
                ? frameSizeOf({ width: payload.width, height: payload.height })
                : { ...DEFAULT_NODE_SIZE }
              const placement = deriveNodePlacement(existing, [], size.width, size.height)
              const node: StudioCanvasNode = {
                id: newAssetId(),
                kind: 'video',
                title: payload.title,
                url: payload.url,
                ...(payload.duration !== undefined && payload.duration > 0 ? { duration: payload.duration } : {}),
                ...(payload.width !== undefined ? { mediaWidth: payload.width } : {}),
                ...(payload.height !== undefined ? { mediaHeight: payload.height } : {}),
                x: placement.x,
                y: placement.y,
                width: size.width,
                height: size.height,
                createdAt: Date.now(),
                toolName: payload.toolName,
                origin: 'agent',
                sourceIds: [],
                operationType: 'import',
                // REQ-037/CV-405：链接下载的参考视频默认就是「参考素材」——
                // 不标身份就进不了素材托盘与 §07 引用链，用户回看无处可寻（立项痛点）。
                isReference: true,
                referenceRole: 'source',
                generationPrompt: JSON.stringify({ sourceSite: payload.sourceSite }),
              }
              await registry.appendCanvasNode(projectId, node)
              return node.id
            },
          },
        )
        const size = result.width !== undefined && result.height !== undefined ? ` · ${result.width}×${result.height}` : ''
        const audio = result.hasAudio ? '含音轨' : '无音轨'
        return { text: [
          `✅ 已从${SITE_LABELS[result.source]}下载参考视频（${result.durationSec.toFixed(1)}s${size} · ${audio}）：`,
          `  画布节点 id=${result.nodeId}（已标为参考素材，素材托盘与 @ref 可见可用）`,
          `  资产路径：${result.assetPath}`,
          `下一步：media_probe 探时长/响度 → evidence_grid 出证据网格开始拆解（viral-remake SKILL §1）。`,
        ].join('\n') }
      },
    }),
  ]
}
