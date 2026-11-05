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
import {
  planGenerationUnits,
  renderPlanMarkdown,
  measureSceneSignatures,
  sceneDistance,
  GEN_METHODS,
  DEFAULT_PLAN_LIMITS,
  MAX_SCENE_SIGNAME_SHOTS,
  type PlanShotInput,
} from './plan-generation-units.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import { makeCompareVideo } from './compare-video.js'

export interface RemakeToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
}

/** 复刻链路工具（`media_probe` / `evidence_grid` / `download_video` / `plan_generation_units` / `make_compare`）。 */
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
        '证据网格（爆款复刻拆解首选）：**一次调用**产出参考视频的「时间标注网格图 + 结构化清单 + 实测画面切换点 + 确定性取证三项」。'
        + '每格烧录实测时间戳；可选叠加该时刻的台词词标签（传 ASR 词级转写 JSON，没有就只出时间戳 —— 能力立即可用）；切点所在格自动红框标记。'
        + '\n\n**确定性取证三项（CV-445）**：① AIGC 元数据（C2PA/生成器签名，出现即一票定案）；② 帧率指纹（重复帧模式 → 判「低帧率源转码」vs「生成直出」）；③ 冻结帧段（静帧/代码画面候选）。结果进结构化清单 `methodEvidence` 字段，给拆解表「制作方式」列供像素级事实 —— VLM 说的不能当事实，事实从像素来。'
        + '\n\n**为什么必须用它而不是 inspect_image 逐帧轮询**：逐帧轮询几十次调用才拼出一段的画面变化，而且画面与口播对不上；本工具一次拿到「哪一秒画面长什么样 + 画面切换点 + 制作方式证据」，拆解表直接对着网格填。'
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
        const me = result.methodEvidence
        const aigcLine = me.aigc.found
          ? `⚠️ AIGC 标记 ${me.aigc.markers.length} 处（${me.aigc.markers.map((m) => m.marker).slice(0, 5).join('、')}）—— 制作方式可一票定案`
          : 'AIGC 标记：未发现（不代表不是 AI 生成，平台常清除）'
        const fr = me.frameRate
        const fpsLine = fr.duplicateRatio === null
          ? `帧率指纹：${fr.verdict}`
          : `帧率指纹：容器 ${fr.containerFps ?? '?'}fps · 重复帧 ${Math.round((fr.duplicateRatio ?? 0) * 100)}%${fr.inferredSourceFps !== null ? ` · 推算源 ≈${fr.inferredSourceFps}fps` : ''}`
        const fz = me.frozen
        const frozenLine = fz.runs.length > 0
          ? `冻结帧：${fz.runs.length} 段（最长 ${fz.longestFreezeSec}s，${fz.runs.slice(0, 3).map((r) => `${r.startSec}-${r.endSec}s`).join('、')}${fz.runs.length > 3 ? ' …' : ''}）—— 静帧/代码画面候选`
          : '冻结帧：无 ≥0.4s 定格段'
        return { text: [
          `✅ 证据网格 ${result.cellCount} 格 · ${result.pages.length} 页（指纹 key=${result.key}${result.transcriptUsed ? ' · 含台词标注' : ''}）：`,
          ...pageLines,
          cuts,
          `确定性取证（拆解表「制作方式」列的像素级事实，详见清单 methodEvidence）：`,
          `  ${aigcLine}`,
          `  ${fpsLine}`,
          `  ${frozenLine}`,
          `结构化清单（每格 时间戳/页/行/列/台词 + 取证）：${result.dir}/${result.manifestFile}`,
          '下一步：对照网格填拆解表（七列，含制作方式，见 viral-remake SKILL §1 + production-method 分册）；密集段（红框聚集处）用 passes 传该区间 + interval 0.1–0.3 二次采样；拆完先 verify_teardown 回核再进映射。',
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
    defineTool({
      // 第 47 号工具（CV-445 S3，rea-video A4 吸收）：生成单元规划 —— 只出计划不代执行。
      name: 'plan_generation_units',
      description:
        '生成单元规划（爆款复刻拆解表的下一步）：把带「制作方式」列的拆解表变成**最少调用次数的生成单元计划** —— 同场景 + 硬切相连的 AI 镜头合并为一次连续生成（剪辑时再按硬切切开），中间插入的代码/录屏/静图不打断分组；单镜超 15s 在动作停顿处切段（后段用前段尾帧，shotTransition:\'chain\'）；相邻单元同场景无缝硬切自动给尾帧衔接说明。'
        + '\n\n**为什么**：逐镜生成多烧调用 —— 8 镜同场景片规划后 3 次调用搞定；提示词按单元拼好（统一风格句 + `<Picture N>`/`<Video N>` 参考行 + 逐镜相对时间行），可直接贴进 `video_composite`。'
        + '\n\n**只出计划不代执行**（付费生成先人工确认）：返回 Markdown 计划，逐单元确认后再调 `video_composite`。'
        + '\n\n场景相似度用首尾帧 HSV 直方图（≤0.5 同景）；镜头数 >60 或帧抽不出时降级为「只按硬切相连合并」并在警告里说明。'
        + '\n\n上限按 `video_composite` 真实规格校验：参考图 ≤9、参考视频 ≤3、参考音频 ≤3、合计 ≤12 文件、单次 ≤15s，超限裁剪并警告（不静默丢语义）。',
      parameters: {
        videoPath: { type: 'string' as const, required: true, description: '参考视频绝对路径（测场景相似度用；evidence_grid 拆解时的同一条片）' },
        shots: {
          type: 'array' as const,
          required: true as const,
          description: '拆解表逐镜数组（按时间排序）：每镜 {index, startSec, endSec, productionMethod, description, transitionIn?, promptEn?}',
          items: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {
              index: { type: 'number' as const, description: '镜序（1 起）' },
              startSec: { type: 'number' as const, description: '起始秒' },
              endSec: { type: 'number' as const, description: '结束秒' },
              productionMethod: { type: 'string' as const, description: '制作方式（A1 分册口径）：ai-video / live-action / code-render / screen-capture / still-motion / static-hold / avatar / other' },
              description: { type: 'string' as const, description: '画面描述（主体+动作+运镜，生成提示词的原料）' },
              transitionIn: { type: 'string' as const, description: '入转场：cut（硬切相连，可合并的必要条件）/ dissolve / fade / other' },
              promptEn: { type: 'string' as const, description: '可选英文描述（拼英文提示词）' },
            },
          },
        },
        styleLine: { type: 'string' as const, description: '可选：全片统一风格句（如「横屏 16:9，电影感暗调，烛光暖光」）—— 每个单元的提示词都会带上，分开生成的单元看起来仍是一条片' },
        referenceAssets: {
          type: 'array' as const,
          description: '可选：用户自备参考素材（跨单元复用，如产品图/人物图）',
          items: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {
              kind: { type: 'string' as const, description: 'image / video / audio' },
              what: { type: 'string' as const, description: '素材说明（进提示词引用行）' },
            },
          },
        },
        maxUnitSec: { type: 'number' as const, description: '可选：单次生成时长上限（出厂 15，对齐 maxVideoSeconds）' },
        minUnitSec: { type: 'number' as const, description: '可选：单元最短生成时长（出厂 4；太短的单镜补到这个长度再剪）' },
        preferSec: { type: 'number' as const, description: '可选：单元内连续硬切的偏好上限（出厂 8，S06）' },
        sameSceneDistance: { type: 'number' as const, description: '可选：同场景判定阈值（HSV 距离 ≤ 此值同景，出厂 0.5）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: 'Markdown 计划：单元表 + 逐单元可贴 video_composite 的提示词 + 警告' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as Record<string, unknown>
        const videoPath = typeof a.videoPath === 'string' ? a.videoPath.trim() : ''
        if (videoPath === '' || !videoPath.startsWith(sep)) {
          throwError('CS-USER-ERR', { message: '缺少 videoPath 或不是绝对路径 —— 参考视频要先落盘。' })
        }
        if (!Array.isArray(a.shots) || a.shots.length < 1) {
          throwError('CS-USER-ERR', { message: 'shots 不能为空 —— 传拆解表逐镜数组（每镜 index/startSec/endSec/productionMethod/description）。' })
        }
        const shots: PlanShotInput[] = []
        for (const raw of a.shots) {
          if (typeof raw !== 'object' || raw === null) continue
          const r = raw as Record<string, unknown>
          const index = typeof r.index === 'number' ? r.index : Number.NaN
          const startSec = typeof r.startSec === 'number' ? r.startSec : Number.NaN
          const endSec = typeof r.endSec === 'number' ? r.endSec : Number.NaN
          const productionMethod = typeof r.productionMethod === 'string' ? r.productionMethod : ''
          const description = typeof r.description === 'string' ? r.description : ''
          if (!Number.isFinite(index) || !Number.isFinite(startSec) || !Number.isFinite(endSec)
            || endSec <= startSec || productionMethod === '') {
            throwError('CS-USER-ERR', {
              message: `第 ${String(r.index ?? '?')} 镜字段非法：需要 index / startSec < endSec / productionMethod（制作方式列，见 production-method 分册）。`,
              detail: 'invalid plan shot',
            })
          }
          const transitionIn = typeof r.transitionIn === 'string' && ['cut', 'dissolve', 'fade', 'other'].includes(r.transitionIn)
            ? (r.transitionIn as PlanShotInput['transitionIn'])
            : undefined
          const shot: PlanShotInput = {
            index, startSec, endSec, productionMethod, description,
          }
          if (transitionIn !== undefined) shot.transitionIn = transitionIn
          if (typeof r.promptEn === 'string' && r.promptEn.trim() !== '') shot.promptEn = r.promptEn
          shots.push(shot)
        }
        const limitsOverride: Partial<typeof DEFAULT_PLAN_LIMITS> = {}
        for (const key of ['maxUnitSec', 'minUnitSec', 'preferSec', 'sameSceneDistance'] as const) {
          const value = a[key]
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) limitsOverride[key] = value
        }
        const referenceAssets: Array<{ kind: 'image' | 'video' | 'audio'; what: string }> = []
        if (Array.isArray(a.referenceAssets)) {
          for (const raw of a.referenceAssets) {
            if (typeof raw !== 'object' || raw === null) continue
            const r = raw as Record<string, unknown>
            if (typeof r.kind === 'string' && ['image', 'video', 'audio'].includes(r.kind)
              && typeof r.what === 'string' && r.what.trim() !== '') {
              referenceAssets.push({ kind: r.kind as 'image' | 'video' | 'audio', what: r.what })
            }
          }
        }

        // 场景相似度：只对可生成镜头测首/尾帧（IO；超上限/失败降级）
        const genShots = shots.filter((s) => GEN_METHODS.includes(s.productionMethod))
        const warnings: string[] = []
        let isSameScene: (a: PlanShotInput, b: PlanShotInput) => boolean = () => true
        if (genShots.length > 1 && genShots.length <= MAX_SCENE_SIGNAME_SHOTS) {
          try {
            const signatures = await measureSceneSignatures(videoPath, genShots, undefined, exec.signal)
            if (signatures.size < genShots.length) {
              warnings.push(`场景签名只测到 ${signatures.size}/${genShots.length} 镜（抽帧失败的不参与同景合并）`)
            }
            const threshold = typeof limitsOverride.sameSceneDistance === 'number'
              ? limitsOverride.sameSceneDistance : DEFAULT_PLAN_LIMITS.sameSceneDistance
            isSameScene = (x, y) => {
              const sx = signatures.get(x.index)
              const sy = signatures.get(y.index)
              return sx !== undefined && sy !== undefined && sceneDistance(sx, sy) <= threshold
            }
          } catch (cause) {
            warnings.push(`场景相似度测量失败（${cause instanceof Error ? cause.message : String(cause)}）—— 降级为「只按硬切相连合并」`)
          }
        } else if (genShots.length > MAX_SCENE_SIGNAME_SHOTS) {
          warnings.push(`AI 镜头 ${genShots.length} 个超过场景测量上限 ${MAX_SCENE_SIGNAME_SHOTS} —— 降级为「只按硬切相连合并」（分组会偏保守）`)
        }

        const plan = planGenerationUnits(shots, {
          ...(Object.keys(limitsOverride).length > 0 ? { limits: limitsOverride } : {}),
          ...(typeof a.styleLine === 'string' && a.styleLine.trim() !== '' ? { styleLine: a.styleLine } : {}),
          ...(referenceAssets.length > 0 ? { referenceAssets } : {}),
          isSameScene,
        })
        const text = renderPlanMarkdown(plan)
        const lines = [text]
        if (warnings.length > 0) {
          // renderPlanMarkdown 已带 warnings；这里只补同景降级提示
          lines.push('', ...warnings.filter((w) => w.includes('降级') || w.includes('失败') || w.includes('测到')).map((w) => `⚠️ ${w}`))
        }
        return { text: lines.join('\n') }
      },
    }),
    defineTool({
      // 第 48 号工具（CV-445 S4，rea-video A6 吸收）：自动对比片。
      name: 'make_compare',
      description:
        '自动对比片（复刻验收）：原片｜复刻片**左右并排**合成一条 compare.mp4（各缩放 640×360 信箱居中、烧录「原片/复刻」标签、音频取复刻片、时长对齐较短者）。'
        + '\n\n**为什么**：五项对照（节奏 ≤0.2s / 转场 / 字幕 / 信息卡 / 整体）光靠文字判据要靠脑补；并排片把「哪一秒没对齐」变成看得见的错位 —— 生成/复刻完先出对比片再看，别靠记忆对。'
        + '\n\n产物默认落在复刻片同目录 `compare.mp4`；纵横向比例不一致的信箱居中不拉伸。仅本地 ffmpeg，零模型费用。',
      parameters: {
        originalPath: { type: 'string' as const, required: true, description: '原片（参考视频）绝对路径' },
        remakePath: { type: 'string' as const, required: true, description: '复刻片（成片）绝对路径' },
        outPath: { type: 'string' as const, description: '可选：产物绝对路径（缺省 <复刻片目录>/compare.mp4）' },
        leftLabel: { type: 'string' as const, description: '可选：左侧标签（缺省「原片」）' },
        rightLabel: { type: 'string' as const, description: '可选：右侧标签（缺省「复刻」）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '产物路径 + 验收用法' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as Record<string, unknown>
        for (const key of ['originalPath', 'remakePath'] as const) {
          const value = a[key]
          if (typeof value !== 'string' || value.trim() === '' || !value.startsWith(sep)) {
            throwError('CS-USER-ERR', { message: `缺少 ${key} 或不是绝对路径。` })
          }
        }
        const result = await makeCompareVideo({
          originalPath: (a.originalPath as string).trim(),
          remakePath: (a.remakePath as string).trim(),
          ...(typeof a.outPath === 'string' && a.outPath.trim() !== '' ? { outPath: a.outPath.trim() } : {}),
          ...(typeof a.leftLabel === 'string' || typeof a.rightLabel === 'string'
            ? {
                labels: {
                  ...(typeof a.leftLabel === 'string' ? { left: a.leftLabel } : {}),
                  ...(typeof a.rightLabel === 'string' ? { right: a.rightLabel } : {}),
                },
              } : {}),
          signal: exec.signal,
        })
        return { text: [
          `✅ 对比片：${result.outPath}（${(result.durationSec ?? 0).toFixed(1)}s，原片左｜复刻右）`,
          '验收用法：对照 viral-remake 五项判据逐项看 —— ① 节奏：同一动作两边出现的秒差 ≤0.2s；② 转场形态一致；③ 字幕落点/时长；④ 信息卡版式；⑤ 整体观感与响度（media_probe 各探一次，差 >2 LUFS 调音量重渲）。',
        ].join('\n') }
      },
    }),
  ]
}
