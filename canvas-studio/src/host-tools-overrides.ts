/**
 * REQ-041 F6 · **`patch_segment_tracks`** —— 段级手工轨的**唯一写入口**。
 *
 * ## 为什么必须有这个工具（而不是让模型手写 JSON）
 *
 * 真机会话（2026-11-25 超级月亮）里，模型为了给第 2 屏加椭圆轨道**手改了
 * `build/manifest.json`**，下一次 `scaffold_manifest(writeTo)` 整份覆盖，手工轨静默消失，
 * 它只好靠记性「重编后恢复第 2 屏的椭圆轨道和音频」。
 *
 * 手改的第二个问题更隐蔽：**没有校验**。时间窗越出本段、box 出画布、orbit 与 box 同时写
 * —— 这些错误要到渲染时才炸，而那时画面已经错了。本工具在**写入时**就拒收：
 * 判据只有一份（`segment-overrides.ts` 的 `validateOverrideTracks`），合并时再跑同一份。
 *
 * ## 它不改 spec、不改 manifest
 *
 * 手工轨落在 `build/overrides/<ref>.json`（不在 spec 产物里，scaffold 碰不到）。
 * 想改 spec 产出的那条轨请改 spec —— 这里**只做新增**（同 id 冲突会被拒收并说明原因）。
 *
 * ## 动作序列
 *
 * 「这一屏效果改成动画」= `patch_segment_tracks` → `rerender_segment`（只重渲这一段）。
 * `patch_segment_tracks` 本身不出片、不写画布、不动 undo。
 */
import { readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectRegistry } from './projects.js'
import type { CompositionManifest } from './remotion/manifest.js'
import { throwError } from './error-system.js'
import { readProjectSpec } from './shot-render.js'
import { planSegmentTable } from './segment-table.js'
import { renderedManifestPath } from './rendered-manifest.js'
import { segmentIdFromRef } from './segment-binding.js'
import { renderTextResult } from './tool-result-text.js'
import {
  MAX_OVERRIDE_TRACKS,
  SEGMENT_OVERRIDES_DIR,
  SEGMENT_OVERRIDES_VERSION,
  mergeOverrideTracks,
  normalizeOverrideRef,
  overrideFileName,
  overrideIssueSummary,
  validateOverrideTracks,
  type SegmentOverride,
} from './segment-overrides.js'
import {
  readProjectOverrides,
  removeProjectOverride,
  writeProjectOverride,
} from './segment-overrides-io.js'
import './errors/catalog.js'

export interface PatchSegmentTracksContext {
  registry: ProjectRegistry
  resolveProjectId: (cwd: string | undefined) => Promise<string>
}

type Mode = 'set' | 'add' | 'remove' | 'clear' | 'show'

const MODES = new Set<Mode>(['set', 'add', 'remove', 'clear', 'show'])

/** 手工轨的一行人读摘要（回执里逐条列出，模型据此核对 id 与窗口）。 */
function describeTrack(track: unknown): string {
  const t = (track ?? {}) as { id?: unknown; type?: unknown; startFrame?: unknown; durationInFrames?: unknown; shape?: unknown }
  const start = typeof t.startFrame === 'number' ? t.startFrame : 0
  const duration = typeof t.durationInFrames === 'number' ? t.durationInFrames : 0
  const kind = typeof t.type === 'string' ? t.type : '?'
  const shape = typeof t.shape === 'string' ? `/${t.shape}` : ''
  return `${String(t.id)}（${kind}${shape}）第 ${String(start)}–${String(start + duration)} 帧`
}

/** 读 `build/manifest.json`（本工具只认盘上那一份 —— 它才是段表的来源）。 */
function readManifestOrExplain(projectDir: string): CompositionManifest {
  const path = renderedManifestPath(projectDir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throwError('CS-USER-ERR', {
      message: `读不到 ${path} —— 手工轨要按段挂，而段表来自这份 manifest。`
        + '先跑 `scaffold_manifest({ writeTo: "build/manifest.json" })` 落一份（spec 通道同理），再重试。',
    })
  }
  try {
    return JSON.parse(raw) as CompositionManifest
  } catch (cause) {
    throwError('CS-USER-ERR', {
      message: `${path} 不是合法 JSON（${cause instanceof Error ? cause.message : String(cause)}）—— 先修好这份文件。`,
    })
  }
}

export function definePatchSegmentTracksTool(ctx: PatchSegmentTracksContext) {
  return defineTool({
    name: 'patch_segment_tracks',
    description:
      '**给某一屏加手工轨**（spec 表达不了的那些效果：沿路径运动 / 分段停顿 / 引线标注），存进 '
      + `\`${SEGMENT_OVERRIDES_DIR}/\` —— **重编 manifest 不会丢**，这与手改 build/manifest.json 的本质区别。`
      + '定位三选一：`ref`（`spec:s2` 或裸 `s2`）/ `segmentId` / `shotNodeId`（画布分镜卡节点 id）。'
      + '模式：`set` 整份替换该段手工轨（缺省）/ `add` 追加或按 id 覆盖同一条手工轨 / '
      + '`remove` 按 `ids` 删几条 / `clear` 全删 / `show` 只看不改。'
      + '**只做新增**：id 不能与 manifest 里既有的轨同名（spec 产出的轨请改 spec）。'
      + '轨的时间窗必须落在**本段内**（绝对帧号，回执会告你段窗），类型沿用 manifest 已知轨型；'
      + '`orbit` / `animate` / `exit` / `reveal` 都是轨级字段，可以放心写在手工轨上。'
      + '写完**画面不会自己变**：紧接着调 `rerender_segment` 只重渲这一段（其余段不动）。'
      + '不做：可视化轨道编辑器、任意 Remotion 组件、改 spec 产出的轨。',
    parameters: {
      projectId: { type: 'string' as const, description: '可选：目标项目 id；缺省取当前会话项目' },
      ref: { type: 'string' as const, description: '段指针 `spec:<段id>`（卡上【段】行那个值）；也接受裸段 id。与 segmentId / shotNodeId 三选一' },
      segmentId: { type: 'string' as const, description: 'spec 段 id（scaffold 回执的屏表里有）；与 ref / shotNodeId 三选一' },
      shotNodeId: { type: 'string' as const, description: '画布分镜卡节点 id（用户说「这张卡」时用它）；与 ref / segmentId 三选一' },
      mode: {
        type: 'string',
        enum: ['set', 'add', 'remove', 'clear', 'show'] as const,
        description: '可选：set（缺省，整份替换）/ add（追加或覆盖同 id 手工轨）/ remove（按 ids 删）/ clear（全删）/ show（只看）',
      },
      tracks: {
        type: 'array' as const,
        items: { type: 'object' as const, additionalProperties: true },
        description: `手工轨数组（manifest 轨形状；最多 ${String(MAX_OVERRIDE_TRACKS)} 条）。set / add 必填；`
          + '每条必须有 id / type / startFrame / durationInFrames（绝对帧号，窗口落在本段内）',
      },
      ids: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '可选（mode=remove）：要删掉的手工轨 id',
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          text: { type: 'string' as const, description: '回执：改了哪一屏 / 现在有几条手工轨 / 落盘路径 / 下一步' },
          projectId: { type: 'string' as const, description: '项目 id' },
          ref: { type: 'string' as const, description: '段指针（`spec:<段id>`）' },
          mode: { type: 'string' as const, description: '本次动作' },
          tracks: { type: 'integer' as const, description: '该段当前手工轨条数' },
          path: { type: 'string' as const, description: 'override 文件相对项目根的路径（无文件 = 空串）' },
        },
      },
      render: renderTextResult,
    },
    async execute(args, exec) {
      const a = args as {
        projectId?: unknown
        ref?: unknown
        segmentId?: unknown
        shotNodeId?: unknown
        mode?: unknown
        tracks?: unknown
        ids?: unknown
      }
      const explicitProjectId = typeof a.projectId === 'string' && a.projectId.length > 0 ? a.projectId : null
      const projectId = explicitProjectId ?? await ctx.resolveProjectId(exec.agent?.session.header.cwd)
      const projectDir = ctx.registry.projectDir(projectId)

      const modeRaw = typeof a.mode === 'string' ? a.mode : 'set'
      if (!MODES.has(modeRaw as Mode)) {
        throwError('CS-USER-ERR', { message: `mode 只能是 set / add / remove / clear / show（收到 ${JSON.stringify(a.mode)}）` })
      }
      const mode = modeRaw as Mode

      // ── 定位：ref / segmentId / shotNodeId 三选一 ───────────────────────────
      const given = [
        typeof a.ref === 'string' && a.ref.trim() !== '' ? 'ref' : null,
        typeof a.segmentId === 'string' && a.segmentId.trim() !== '' ? 'segmentId' : null,
        typeof a.shotNodeId === 'string' && a.shotNodeId.trim() !== '' ? 'shotNodeId' : null,
      ].filter((value): value is string => value !== null)
      if (given.length === 0) {
        throwError('CS-USER-ERR', {
          message: '必须给 `ref`（`spec:s2`）/ `segmentId` / `shotNodeId` 之一 —— 手工轨挂在**确定的某一段**上，'
            + '不知道段 id 就看 scaffold 回执的屏表，或卡正文的【段】行。',
        })
      }
      if (given.length > 1) {
        throwError('CS-USER-ERR', {
          message: `${given.join(' / ')} 只能给一个 —— 多个目标一旦指向不同的段，「改哪一屏」就无解。`,
        })
      }

      let ref = ''
      if (typeof a.ref === 'string') ref = normalizeOverrideRef(a.ref)
      else if (typeof a.segmentId === 'string') ref = normalizeOverrideRef(a.segmentId)
      else {
        const nodeId = (a.shotNodeId as string).trim()
        const canvas = await ctx.registry.readCanvas(projectId)
        const node = canvas.nodes.find((candidate) => candidate.id === nodeId)
        if (node === undefined) {
          throwError('CS-USER-ERR', { message: `画布上没有节点 ${nodeId} —— 节点 id 抄错，或这张卡已被删除。` })
        }
        const nodeRef = (node as { segmentRef?: unknown }).segmentRef
        if (typeof nodeRef !== 'string' || nodeRef === '') {
          throwError('CS-USER-ERR', {
            message: `卡 ${nodeId} 上没有段指针（\`segmentRef\`）—— 它可能不是分镜卡，或故事板落地时没对上位。`
              + '请改用 `segmentId`（scaffold 回执的屏表里有）。',
          })
        }
        ref = normalizeOverrideRef(nodeRef)
      }
      const segmentId = segmentIdFromRef(ref)
      if (segmentId === null) {
        throwError('CS-USER-ERR', { message: `段指针不合法：${JSON.stringify(ref)} —— 形如 \`spec:s2\`。` })
      }

      const manifest = readManifestOrExplain(projectDir)
      const spec = readProjectSpec(projectDir)
      const plan = planSegmentTable({ manifest, spec })
      if (plan === null) {
        throwError('CS-USER-ERR', {
          message: '这份 manifest 切不出段（既没有 `meta.segments` 也没有 spec 屏边界）—— 手工轨按段定位，'
            + '没有段就无处可挂。先 scaffold 重编段表。',
        })
      }
      const artifact = plan.artifacts.find((candidate) => candidate.ref === ref)
      if (artifact === undefined) {
        const available = plan.artifacts.map((candidate) => candidate.ref ?? candidate.id).join(' / ')
        throwError('CS-USER-ERR', {
          message: `段表里没有 ${ref}（现有 ${available}）。`
            + '段表与 spec 未整表对齐时 ref 会缺失 —— 先 `scaffold_manifest({ writeTo: "build/manifest.json" })` 重建段表。',
        })
      }

      const { overrides } = readProjectOverrides(projectDir)
      const current = overrides.find((override) => override.ref === ref)
      const currentTracks = current?.tracks ?? []
      const segWindow = `${String(artifact.startFrame)}–${String(artifact.startFrame + artifact.frames)}`
      // 文件名只在这一处派生（`overrideFileName`）—— 回执里显示的路径必须与真正落盘的一致。
      const path = `${SEGMENT_OVERRIDES_DIR}/${overrideFileName(ref)}`

      // ── show：只看不改 ──────────────────────────────────────────────────
      if (mode === 'show') {
        const lines = currentTracks.length === 0
          ? [`第 ${String(artifact.index + 1)} 屏（${ref}）当前没有手工轨。段窗 ${segWindow}（帧）。`]
          : [
            `第 ${String(artifact.index + 1)} 屏（${ref}）现有 ${String(currentTracks.length)} 条手工轨（段窗 ${segWindow} 帧）：`,
            ...currentTracks.map((track) => `- ${describeTrack(track)}`),
            current === undefined
              ? ''
              : `写于 ${new Date(current.updatedAt).toISOString()}；文件 ${path}`,
          ].filter((line) => line !== '')
        return { text: lines.join('\n'), projectId, ref, mode, tracks: currentTracks.length, path: currentTracks.length === 0 ? '' : path }
      }

      // ── clear：删文件 ──────────────────────────────────────────────────
      if (mode === 'clear') {
        const removed = removeProjectOverride(projectDir, ref)
        return {
          text: removed
            ? `已清空 ${ref} 的手工轨（${String(currentTracks.length)} 条）—— 下次渲染/重渲这一段就不再带它们。`
              + '\n要看到画面变化，紧接着 `rerender_segment` 重渲这一段。'
            : `${ref} 本来就没有手工轨（无文件可删）。`,
          projectId,
          ref,
          mode,
          tracks: 0,
          path: '',
        }
      }

      // ── set / add / remove：先算下一版轨，再校验、再写盘 ──────────────────
      let nextTracks: unknown[]
      if (mode === 'remove') {
        const ids = Array.isArray(a.ids) ? a.ids.filter((id): id is string => typeof id === 'string' && id !== '') : []
        if (ids.length === 0) {
          throwError('CS-USER-ERR', { message: 'mode=remove 必须给 `ids`（要删掉的手工轨 id 数组）。全删用 mode="clear"。' })
        }
        nextTracks = currentTracks.filter((track) => !ids.includes((track as { id?: string }).id ?? ''))
        const removedCount = currentTracks.length - nextTracks.length
        if (removedCount === 0) {
          throwError('CS-USER-ERR', {
            message: `这一段没有这些手工轨：${ids.join('、')}（现有 ${currentTracks.map((track) => (track as { id?: string }).id ?? '?').join('、') || '无'}）。`,
          })
        }
      } else {
        if (!Array.isArray(a.tracks)) {
          throwError('CS-USER-ERR', { message: `mode=${mode} 必须给 \`tracks\` 数组（每条含 id / type / startFrame / durationInFrames）。` })
        }
        const incoming = a.tracks as CompositionManifest['tracks']
        nextTracks = mode === 'add'
          ? mergeOverrideTracks(currentTracks, incoming)
          : incoming
      }

      if (nextTracks.length === 0) {
        removeProjectOverride(projectDir, ref)
        return {
          text: `该段手工轨已清空（${ref}）—— 文件已删除，下次渲染不带任何手工轨。`,
          projectId,
          ref,
          mode,
          tracks: 0,
          path: '',
        }
      }

      const check = validateOverrideTracks({ manifest, artifacts: plan.artifacts, ref, tracks: nextTracks })
      if (!check.ok) {
        throwError('CS-USER-ERR', {
          message: `${overrideIssueSummary(check.issues)}\n本段帧窗：${segWindow} 帧（${ref}）。`,
        })
      }

      const override: SegmentOverride = {
        version: SEGMENT_OVERRIDES_VERSION,
        ref,
        anchor: { startFrame: artifact.startFrame, frames: artifact.frames },
        updatedAt: Date.now(),
        tracks: check.tracks,
      }
      const written = writeProjectOverride({ projectDir, override })
      const lines = [
        `🎛 ${mode === 'remove' ? '已更新' : '已存'}第 ${String(artifact.index + 1)} 屏的手工轨（${ref}，段窗 ${segWindow} 帧）：`
          + `${String(check.tracks.length)} 条 → ${written.relPath}`,
        ...check.tracks.map((track) => `- ${describeTrack(track)}`),
        '下一步：`rerender_segment({ ref: ' + JSON.stringify(ref) + ' })` 只重渲这一段看效果（其余段不动）。',
        `这一层**不在 spec 里**：改 spec / 重编 manifest 都不会丢它；下次 \`render_composition\` 自动带上。`
          + `要改就再调本工具（\`mode: "add"\` 追加、\`"remove"\` 删指定 id、\`"clear"\` 全删）。`,
        ...(written.backup === null ? [] : [`旧版已留档：\`${SEGMENT_OVERRIDES_DIR}/versions/${written.backup}\``]),
      ]
      return {
        text: lines.join('\n'),
        projectId,
        ref,
        mode,
        tracks: check.tracks.length,
        path: written.relPath,
      }
    },
  })
}
