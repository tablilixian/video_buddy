/**
 * REQ-041 第 2 批 · **N1 `rerender_segment`**（单段重渲入口，2026-11-25）。
 *
 * ## 它只做一件事
 *
 * 「把当前 manifest 的**这一段**重渲一遍并发布段产物」——**不改 spec**。
 * 改 spec 是 `patch_spec_section(shotNodeId)` 的活（改完可 `writeTo` 重编
 * `build/manifest.json`）。agent 处理一句意见时按序调两个工具：
 * `patch_spec_section` → `rerender_segment`。用户只是想重看某屏时直接调本工具。
 *
 * ## 为什么单独立文件
 *
 * `host-tools.ts` 顶在体积/函数长度棘轮上（`tests/file-size-guard.test.mjs`），
 * 而且本工具的逻辑与既有渲染工具**共用** `segment-render.ts` 的内核与
 * `buildShotRenderDeps`（deps 同源，见下）。放这里只留「收参 → 定位 → 调内核 → 回执」。
 *
 * ## 三条硬边界
 *
 * 1. **定位复用唯一判据**：`shotNodeId` 走 `resolveSegmentIdFromNode`（与
 *    `patch_spec_section` 同一套「卡上 segmentRef 是否有效」判定），不造第二套；
 * 2. **作业参数同源**：渲染回调由外部注入的 `buildSegmentRenderIo` 提供，它内部走
 *    `shot-cache.ts` 的纯函数 `segmentRenderOptions`（`frameRange` 闭区间 +
 *    `muteAudio: true`）—— 入口内联拼对象会退化成「渲全片且带声」（C5 真实事故）；
 * 3. **不写画布**：本工具不写 `canvas.json`、不建节点、不进 undo（D15）。
 *
 * ## 结构性意见（拆屏 / 增删屏）
 *
 * 工具层能机械拒收的只有非法定位参数；「把这屏拆成两屏」这类**语义**意图由
 * `description` 明示 agent 拒绝 —— 那是能力边界，别假装工具能判语义。
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectRegistry } from './projects.js'
import type { CompositionManifest, RenderQuality } from './remotion/manifest.js'
import { throwError } from './error-system.js'
import { matchSegmentVoices } from './segment-audio.js'
import { mergeSegmentVoice } from './segment-voice-merge.js'
import { rerenderSegmentArtifact, type SegmentRenderIo } from './segment-render.js'
import { planSegmentTable } from './segment-table.js'
import { mergeProjectOverrides } from './segment-overrides-io.js'
import { prepareRenderManifest } from './prepare-render-manifest.js'
import { renderedManifestPath } from './rendered-manifest.js'
import { segmentRefOf } from './segment-binding.js'
import { resolveSegmentIdFromNode } from './host-tools-spec-patch.js'
import { renderTextResult } from './tool-result-text.js'
import './errors/catalog.js'

/** 工具需要的宿主能力（由 `host-tools.ts` 注入；deps 构造两处共用）。 */
export interface RerenderSegmentContext {
  registry: ProjectRegistry
  resolveProjectId: (cwd: string | undefined) => Promise<string>
  /** 审批门（与 `render_composition` 同口径：审阅期不许偷偷出片）。 */
  assertApprovalAllowed: (projectId: string, tool: string) => Promise<void>
  /**
   * 渲一段的 IO。**必须**与 `render_composition` 的分镜路径同源
   * （`host-tools.ts` 的 `buildShotRenderDeps`）—— 复制注入代码必然在下一次改
   * ffmpeg / 预览闸 / 缓存目录时漂移。
   */
  buildSegmentRenderIo: (input: {
    projectId: string
    manifest: CompositionManifest
    quality: RenderQuality
    signal: AbortSignal
  }) => SegmentRenderIo
}

/** 从 `build/spec.json` 取段 id 表；读不到返回 null（不抛，定位还有 manifest 兜底）。 */
function sectionIdsFromProject(projectDir: string): readonly string[] | null {
  try {
    const parsed = JSON.parse(readFileSync(join(projectDir, 'build', 'spec.json'), 'utf8')) as unknown
    const sections = (parsed as { sections?: unknown }).sections
    if (!Array.isArray(sections)) return null
    const ids = sections
      .map((section) => (section as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
    return ids.length === 0 ? null : ids
  } catch {
    return null
  }
}

/** manifest 自带段表（`meta.segments`）的 id 表；没有返回 null。 */
function declaredIdsOf(manifest: CompositionManifest): readonly string[] | null {
  const declared = manifest.meta?.segments
  if (!Array.isArray(declared) || declared.length === 0) return null
  const ids = declared
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  return ids.length === 0 ? null : ids
}

function readManifestFile(projectDir: string): CompositionManifest {
  const path = renderedManifestPath(projectDir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throwError('CS-USER-ERR', {
      message: `读不到 ${path} —— 单段重渲的前提是有一份「渲过/落过盘」的 manifest。`
        + '先跑 `scaffold_manifest({ writeTo: "build/manifest.json" })` 或'
        + ' `patch_spec_section({ writeTo: "build/manifest.json" })` 落一份，再重试。'
        + '**不要**手写一份新的来顶 —— 帧窗与盘上的段产物对不上，渲出来的画面会错位。',
    })
  }
  try {
    return JSON.parse(raw) as CompositionManifest
  } catch (cause) {
    throwError('CS-USER-ERR', {
      message: `${path} 不是合法 JSON（${cause instanceof Error ? cause.message : String(cause)}）——`
        + '修好这份文件再重渲，本工具不会拿坏文件渲一份看起来正常的旧片。',
    })
  }
}

/** 交付副本的 mtime（清单的 `v` 同口径）；读不到返回 undefined。 */
function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

export function defineRerenderSegmentTool(ctx: RerenderSegmentContext) {
  return defineTool({
    name: 'rerender_segment',
    description:
      '**单段重渲**：把当前 manifest 里**这一屏**重渲并发布段产物（画面 + 旁白副本），其余段一个不动。'
      + '它**不改 spec**：改文案/数据先调 `patch_spec_section`（带 `writeTo` 重编 manifest），紧接着调本工具；'
      + '只想重看某屏就直接调本工具。'
      + '定位二选一：`shotNodeId`（画布分镜卡节点 id）或 `segmentId`（spec 段 id），同时给会被拒收。'
      + '**结构性意见（拆屏 / 增删屏 / 换整片风格）不要调本工具**：那要重排段表，'
      + '之前看过的画面都会变 —— 必须先向用户明示，再走 `scaffold_manifest` 重编。'
      + '返回：段 id / ref / 新副本 URL / 版本号 `v` / 渲染耗时；段渲染失败会显式报错（不静默返回旧片）。',
    parameters: {
      projectId: { type: 'string' as const, description: '可选：目标项目 id；缺省取当前会话项目' },
      shotNodeId: { type: 'string' as const, description: '画布分镜卡节点 id（用户说「这张卡 / 这一屏」时用它）；与 segmentId 二选一' },
      segmentId: { type: 'string' as const, description: 'spec 段 id（scaffold 回执的屏表里有）；与 shotNodeId 二选一' },
      quality: {
        type: 'string',
        enum: ['draft', 'standard', 'high'] as const,
        description: '可选：本次重渲的质量档。draft = 半分辨率快速看画面（迭代用）；standard = 缺省；high = 交付档',
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          text: { type: 'string' as const, description: '回执：换了哪一屏 + 副本 URL + 耗时 + 其余段未动的说明' },
          projectId: { type: 'string' as const, description: '项目 id' },
          segmentId: { type: 'string' as const, description: '段 id（spec 原文）' },
          ref: { type: 'string' as const, description: '段指针（`spec:<段id>`）—— 与卡上 `segmentRef` 等值' },
          url: { type: 'string' as const, description: '新段副本的媒体 URL（带声副本存在时指向它）' },
          v: { type: 'number' as const, description: '副本 mtime（毫秒）—— 清单破缓存用的版本号' },
          renderedMs: { type: 'number' as const, description: '本次段渲染墙钟（毫秒）' },
          startFrame: { type: 'integer' as const, description: '段首帧（绝对帧号）' },
          frames: { type: 'integer' as const, description: '段长（帧）' },
          durationSec: { type: 'number' as const, description: '段时长（秒）' },
          voiced: { type: 'boolean' as const, description: '是否生成了带声副本（false = 这段没有旁白 / 合声失败，卡上播无声版）' },
        },
      },
      render: renderTextResult,
    },
    async execute(args, exec) {
      const a = args as { projectId?: unknown; shotNodeId?: unknown; segmentId?: unknown; quality?: unknown }
      const explicitProjectId = typeof a.projectId === 'string' && a.projectId.length > 0 ? a.projectId : null
      const projectId = explicitProjectId ?? await ctx.resolveProjectId(exec.agent?.session.header.cwd)
      await ctx.assertApprovalAllowed(projectId, 'rerender_segment')

      const nodeId = typeof a.shotNodeId === 'string' ? a.shotNodeId.trim() : ''
      const segmentIdArg = typeof a.segmentId === 'string' ? a.segmentId.trim() : ''
      if (nodeId !== '' && segmentIdArg !== '') {
        throwError('CS-USER-ERR', {
          message: 'shotNodeId 与 segmentId 二选一 —— 两个都给等于两个目标来源，'
            + '一旦它们指向不同的段，「重渲哪一屏」就无解。',
        })
      }
      if (nodeId === '' && segmentIdArg === '') {
        throwError('CS-USER-ERR', {
          message: '必须给 shotNodeId 或 segmentId —— 单段重渲的前提是**唯一确定的目标段**。'
            + '不知道段 id 就先看 scaffold 回执的屏表，或用画布上的分镜卡节点 id。',
        })
      }
      const qualityArg = a.quality
      if (qualityArg !== undefined && qualityArg !== 'draft' && qualityArg !== 'standard' && qualityArg !== 'high') {
        throwError('CS-USER-ERR', { message: `quality 非法（${String(qualityArg)}）—— 只允许 draft / standard / high` })
      }
      const quality: RenderQuality = qualityArg === undefined ? 'standard' : qualityArg

      const projectDir = ctx.registry.projectDir(projectId)
      const assetsDir = ctx.registry.assetsDir(projectId)
      const manifestOnDisk = readManifestFile(projectDir)
      const spec = ((): unknown => {
        try {
          return JSON.parse(readFileSync(join(projectDir, 'build', 'spec.json'), 'utf8')) as unknown
        } catch {
          return null
        }
      })()
      // REQ-041 F6：与 `render_composition` **同一个**合并入口。段缓存的钥匙是合并后轨的
      // hash —— 两条路径各写一遍合并逻辑，一处漏掉 override 就会让同一段算出两个 hash
      // （表现是「改一屏每次整片重渲」，且不报错）。
      const overrides = mergeProjectOverrides({ projectDir, manifest: manifestOnDisk, spec })
      // P1-2（2026-11-27 审查）：合并后必须走**同一套变换管线**（组展开 → 校验 → 素材
      // 物化 → 素材核对 → alpha 标记 → video 时长真值回核）。此前这里把 raw override 轨
      // 直接并回已变换的快照、跳过全部变换 ⇒ 同一条手工轨算出两个 hash（两路径互不命中
      // 还互删缓存）；素材类手工轨的本地路径没物化 ⇒ 单段重渲渲出缺图的段。
      const prepared = await prepareRenderManifest({
        manifest: overrides.manifest,
        assetsDir,
        projectId,
      })
      const manifest = prepared.manifest
      const plan = planSegmentTable({ manifest, spec })
      if (plan === null) {
        throwError('CS-USER-ERR', {
          message: '这份 manifest 切不出段（无可用边界）—— 单段重渲按段表工作，'
            + '先确认 manifest 有 `meta.segments` 或 spec 有屏边界。',
        })
      }

      let segmentId = segmentIdArg
      if (nodeId !== '') {
        const canvas = await ctx.registry.readCanvas(projectId)
        const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
        if (node === undefined) {
          throwError('CS-USER-ERR', {
            message: `画布上没有节点 ${nodeId} —— 节点 id 抄错，或这张卡已被删除。先核对卡 id，不要换一个「看起来像」的 id 重试。`,
          })
        }
        const ids = sectionIdsFromProject(projectDir) ?? declaredIdsOf(manifest)
        if (ids === null) {
          throwError('CS-USER-ERR', {
            message: '既读不到 `build/spec.json` 的屏表，manifest 也没有 `meta.segments` —— '
              + '无法核对这张卡的段指针是否有效。请直接给 `segmentId`。',
          })
        }
        const resolved = resolveSegmentIdFromNode(node, ids)
        if ('reason' in resolved) throwError('CS-USER-ERR', { message: resolved.reason })
        segmentId = resolved.segmentId
      }

      const ref = segmentRefOf(segmentId)
      const artifact = plan.artifacts.find((candidate) => candidate.ref === ref)
      if (artifact === undefined) {
        // 段表没整表对齐时 `ref` 缺失（`planSegmentArtifacts` 只在整表对齐时给）。
        // 这时不能按序号猜 —— 猜错就是「改了第 2 屏、换掉的是第 3 屏的画面」。
        const available = plan.artifacts.map((candidate) => candidate.ref ?? candidate.id).join(' / ')
        const aligned = plan.artifacts.some((candidate) => candidate.ref !== undefined)
        throwError('CS-USER-ERR', {
          message: aligned
            ? `段 ${segmentId} 不在本次渲染的段表里（现有 ${available}）。spec 改过结构后需要重新 scaffold 才能对齐。`
            : '段表与 spec 没整表对齐（段数或帧窗不一致）—— manifest 的 `meta.segments` 是旧的。'
              + `当前只有产物 id：${available}。请先 \`scaffold_manifest({ writeTo: "build/manifest.json" })\` 重建段表，再重渲。`,
        })
      }

      const io = ctx.buildSegmentRenderIo({ projectId, manifest, quality, signal: exec.signal })
      const rerendered = await rerenderSegmentArtifact({ ...io, manifest, plan, artifact })
      if (rerendered.result === null) {
        throwError('CS-USER-ERR', {
          message: `段 ${artifact.id} 重渲失败：${rerendered.failure ?? '未知原因'}。`
            + '本次**没有**改动盘上的段产物，卡上仍是上一版画面（不会给你一份看起来正常的旧片）。',
        })
      }
      const result = rerendered.result
      // 合声：只这一段（清单里 `-voice` 副本优先，重渲后旧副本必须一起换掉）。
      const matches = matchSegmentVoices({ manifest, artifacts: [result.pointer] })
      const match = matches.get(result.pointer.id)
      let voicedFile: string | undefined
      let voiceNote: string | undefined
      if (match !== undefined) {
        const merged = await mergeSegmentVoice({
          projectDir,
          assetsDir,
          projectId,
          id: result.pointer.id,
          silentFile: result.assetFile,
          durationSec: result.pointer.durationSec,
          match,
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
        })
        voicedFile = merged.voiceFile
        voiceNote = merged.note
      }
      const finalFile = voicedFile ?? result.assetFile
      const v = mtimeOf(join(assetsDir, finalFile))
      const url = `/canvas-studio/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(finalFile)}`
      const lines = [
        `🎬 已重渲第 ${String(artifact.index + 1)} 屏（段 ${segmentId}，${quality}）：${(result.renderedMs / 1000).toFixed(1)}s`,
        `副本：${url}${v === undefined ? '' : `（v=${String(Math.round(v))}）`}`,
        voicedFile === undefined
          ? '这段没有可合的旁白 ⇒ 卡上播无声版（画面已换新）。'
          : '已生成带声副本（画面 + 该段旁白），预览听到的就是成片这一段。',
        '其余段未动（文件与 URL 都没变）。结构性改动（拆屏 / 增删屏）请走 scaffold_manifest 重编段表。',
        ...overrides.lines,
        ...(voiceNote === undefined ? [] : [`旁白备注：${voiceNote}`]),
        ...(result.warnings.length === 0 ? [] : [`渲染告警：${result.warnings.join('；')}`]),
      ]
      return {
        text: lines.join('\n'),
        projectId,
        segmentId,
        ref,
        url,
        ...(v === undefined ? {} : { v }),
        renderedMs: result.renderedMs,
        startFrame: result.pointer.startFrame,
        frames: result.pointer.frames,
        durationSec: result.pointer.durationSec,
        voiced: voicedFile !== undefined,
      }
    },
  })
}
