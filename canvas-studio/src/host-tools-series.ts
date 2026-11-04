/**
 * 阶段 3.1（2026-11-04）：短剧 episodic 两工具（`series_manage` / `episode_brief`）
 * —— 与音频 / 数据导入同款外置件模式。方案正本 = `docs/plans/短剧episodic方案-20261104.md`。
 *
 * 口径：**工具给真值、纪律管使用**——episode_brief 只做只读上下文装配（前情 recap +
 * 库内角色句柄），注入到澄清/剧本是 agent 的职责；series_manage 登记当前项目为某集
 * （免 projectId 入参，agent 在该集项目里调用）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SeriesStore, MAX_RECAP_LENGTH } from './series-store.js'
import type { ProjectRegistry } from './projects.js'
import type { AssetLibrary } from './asset-library.js'
import { throwError } from './error-system.js'

export interface SeriesToolsDeps {
  registry: ProjectRegistry
  resolveProjectId: (registry: ProjectRegistry, cwd: string | undefined) => Promise<string>
  library: AssetLibrary
}

/** 短剧 episodic 工具组。 */
export function defineSeriesTools(deps: SeriesToolsDeps): ReturnType<typeof defineTool>[] {
  const { registry, resolveProjectId, library } = deps
  return [
    defineTool({
      name: 'series_manage',
      description:
        `短剧剧集管理（3.1）：系列登记与集绑定。**集 = 项目**——一集就是一个普通项目，本工具只维护注册表级 series.json（有序索引 + 每集前情提要 recap ≤${MAX_RECAP_LENGTH} 字）。`
        + '三个动作：`create` 新建系列；`list` 列出全部系列与集绑定（读取项目名）；`upsert_episode` 把**当前项目**登记为某系列的第 N 集并写 recap（agent 在该集项目里调用；episodeNo 系列内唯一，重跑 = 改登记，title/recap 缺省不改）。'
        + '流程纪律：新集开工前先 episode_brief 拿前情上下文；本集收尾时 upsert_episode 登记本集 recap（给下一集用）。',
      parameters: {
        action: { type: 'string' as const, required: true, enum: ['create', 'list', 'upsert_episode'], description: 'create = 新建系列；list = 列出全部；upsert_episode = 当前项目登记为某集' },
        title: { type: 'string' as const, description: 'create：系列名（全局唯一）；upsert_episode：可选集标题（缺省用项目名）' },
        seriesId: { type: 'string' as const, description: 'upsert_episode：系列 id（来自 list）' },
        episodeNo: { type: 'number' as const, description: 'upsert_episode：集号（1-999，系列内唯一）' },
        recap: { type: 'string' as const, description: `upsert_episode：本集前情提要（给下一集的上下文，≤${MAX_RECAP_LENGTH} 字；缺省不改）` },
      },
      output: { schema: { type: 'object' as const, additionalProperties: true, properties: { ok: { type: 'boolean' as const }, series: { type: 'object' as const, additionalProperties: true }, seriesList: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true } }, episode: { type: 'object' as const, additionalProperties: true }, notes: { type: 'array' as const, items: { type: 'string' as const } } } }, render: (_args, value) => {
        const v = value as {
          ok?: boolean
          series?: { id: string; title: string; episodes: { episodeNo: number; projectId: string; title?: string; recap?: string; projectName?: string }[] }
          seriesList?: { id: string; title: string; episodeCount: number; projectName?: string }[]
          episode?: { episodeNo: number; projectName?: string; recapLength?: number }
          notes?: string[]
        }
        const lines: string[] = []
        if (v.series !== undefined) {
          lines.push(`系列「${v.series.title}」（${v.series.id}）：已登记 ${v.series.episodes.length} 集。`)
          for (const e of v.series.episodes) {
            lines.push(`  第 ${e.episodeNo} 集 → ${e.projectName ?? e.projectId}${e.title ? `（${e.title}）` : ''}${e.recap !== undefined ? ` · recap ${e.recap.length} 字` : ''}`)
          }
        }
        if (v.seriesList !== undefined) {
          lines.push(v.seriesList.length === 0 ? '还没有系列（先 action=create 新建）。' : `共 ${v.seriesList.length} 个系列：`)
          for (const s of v.seriesList) lines.push(`  - ${s.title}（${s.id}）：${s.episodeCount} 集`)
        }
        if (v.episode !== undefined) {
          lines.push(`已登记：第 ${v.episode.episodeNo} 集 → ${v.episode.projectName ?? '?'}${v.episode.recapLength !== undefined ? `（recap ${v.episode.recapLength} 字）` : ''}。下一集开工时用 episode_brief 取前情上下文。`)
        }
        lines.push(...(v.notes ?? []).map((n) => `⚠️ ${n}`))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      async execute(args, exec) {
        const a = args as { action?: string; title?: string; seriesId?: string; episodeNo?: number; recap?: string }
        const store = new SeriesStore(registry.registryRoot)
        if (a.action === 'create') {
          const title = typeof a.title === 'string' ? a.title : ''
          if (title.trim() === '') throwError('CS-USER-ERR', { message: 'create 需要 title（系列名）' })
          const series = await store.create(title)
          return { ok: true, series: { id: series.id, title: series.title, episodes: [] } as unknown as Record<string, JsonValue>, notes: [] }
        }
        if (a.action === 'list') {
          const all = await store.list()
          const projects = await registry.list()
          const nameOf = (id: string): string | undefined => projects.find((p) => p.id === id)?.name
          const seriesList = all.map((s) => ({
            id: s.id,
            title: s.title,
            episodeCount: s.episodes.length,
            ...(s.episodes.length > 0 ? { projectName: nameOf(s.episodes[0]!.projectId) } : {}),
          }))
          const full = all.map((s) => ({
            id: s.id,
            title: s.title,
            episodes: s.episodes.map((e) => ({ ...e, projectName: nameOf(e.projectId) })),
          }))
          return {
            ok: true,
            seriesList: seriesList as unknown as Record<string, JsonValue>[],
            ...(full.length === 1 ? { series: full[0] as unknown as Record<string, JsonValue> } : {}),
            notes: [],
          }
        }
        if (a.action === 'upsert_episode') {
          if (typeof a.seriesId !== 'string' || a.seriesId === '') {
            throwError('CS-USER-ERR', { message: 'upsert_episode 需要 seriesId（来自 list）' })
          }
          if (typeof a.episodeNo !== 'number' || !Number.isFinite(a.episodeNo)) {
            throwError('CS-USER-ERR', { message: 'upsert_episode 需要 episodeNo（1-999）' })
          }
          const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
          const projects = await registry.list()
          const projectName = projects.find((p) => p.id === projectId)?.name
          const updated = await store.upsertEpisode(a.seriesId, {
            episodeNo: a.episodeNo,
            projectId,
            ...(typeof a.title === 'string' && a.title.trim() !== '' ? { title: a.title } : {}),
            ...(typeof a.recap === 'string' && a.recap !== '' ? { recap: a.recap } : {}),
          })
          const episode = updated.episodes.find((e) => e.episodeNo === Math.round(a.episodeNo!))
          return {
            ok: true,
            series: { id: updated.id, title: updated.title, episodes: updated.episodes } as unknown as Record<string, JsonValue>,
            episode: {
              episodeNo: episode?.episodeNo ?? Math.round(a.episodeNo!),
              ...(projectName !== undefined ? { projectName } : {}),
              ...(episode?.recap !== undefined ? { recapLength: episode.recap.length } : {}),
            } as unknown as Record<string, JsonValue>,
            notes: [],
          }
        }
        throwError('CS-USER-ERR', { message: `未知 action：${String(a.action)}（只支持 create / list / upsert_episode）` })
      },
    }),
    defineTool({
      name: 'episode_brief',
      description:
        '短剧新集开工上下文（3.1）：装配「前情提要 + 角色资产清单」给当前项目。返回系列名、本集定位、**前 N 集 recap**（缺省近 2 集）与库内角色资产（name + `lib:` 句柄 + 描述）——把 recap 写进本集澄清/剧本上下文；角色一致性用 `lib:` 句柄走 @ref / 物化（既有资产库链路）。**只读装配，不做管线注入**；系列无前情时如实返回空（第一集没有 recap 是正常态）。',
      parameters: {
        seriesId: { type: 'string' as const, required: true, description: '系列 id（来自 series_manage action=list）' },
        episodeNo: { type: 'number' as const, required: true, description: '本集集号（取其之前各集的 recap 作为前情）' },
        previousCount: { type: 'number' as const, description: '可选：携带前几集 recap（缺省 2，上限 5）' },
      },
      output: { schema: { type: 'object' as const, additionalProperties: true, properties: { seriesTitle: { type: 'string' as const }, episodeNo: { type: 'integer' as const }, previous: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true } }, characterAssets: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true } }, notes: { type: 'array' as const, items: { type: 'string' as const } } } }, render: (_args, value) => {
        const v = value as {
          seriesTitle?: string
          episodeNo?: number
          previous?: { episodeNo: number; title?: string; recap?: string }[]
          characterAssets?: { name: string; refHandle: string; description: string }[]
          notes?: string[]
        }
        const lines: string[] = [
          `系列「${v.seriesTitle ?? '?'}」第 ${v.episodeNo ?? '?'} 集开工上下文：`,
        ]
        if ((v.previous ?? []).length === 0) {
          lines.push('  前情：无（第一集 / 前集未登记 recap——正常态，不是错误）。')
        } else {
          for (const p of v.previous ?? []) {
            lines.push(`  前情 · 第 ${p.episodeNo} 集${p.title ? `（${p.title}）` : ''}：${p.recap ?? '（未写 recap）'}`)
          }
        }
        const chars = v.characterAssets ?? []
        lines.push(chars.length === 0
          ? '  角色资产：库内暂无 character 条目——各集角色一致性问题先问用户要定妆照，入库后此处会给句柄。'
          : `  角色资产 ${chars.length} 条（一致性用 lib: 句柄）：`)
        for (const c of chars) lines.push(`    - ${c.name}（${c.refHandle}）：${c.description}`)
        lines.push(...(v.notes ?? []).map((n) => `⚠️ ${n}`))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      async execute(args) {
        const a = args as { seriesId?: string; episodeNo?: number; previousCount?: number }
        if (typeof a.seriesId !== 'string' || a.seriesId === '') {
          throwError('CS-USER-ERR', { message: '需要 seriesId（来自 series_manage action=list）' })
        }
        if (typeof a.episodeNo !== 'number' || !Number.isFinite(a.episodeNo)) {
          throwError('CS-USER-ERR', { message: '需要 episodeNo（本集集号）' })
        }
        const store = new SeriesStore(registry.registryRoot)
        const series = await store.require(a.seriesId)
        const prevCount = Math.min(5, Math.max(0, Math.round(typeof a.previousCount === 'number' && Number.isFinite(a.previousCount) ? a.previousCount : 2)))
        const projects = await registry.list()
        const nameOf = (id: string): string | undefined => projects.find((p) => p.id === id)?.name
        const previous: Record<string, JsonValue>[] = series.episodes
          .filter((e) => e.episodeNo < a.episodeNo!)
          .sort((x, y) => y.episodeNo - x.episodeNo)
          .slice(0, prevCount)
          .map((e) => ({
            episodeNo: e.episodeNo,
            ...(nameOf(e.projectId) !== undefined ? { projectName: nameOf(e.projectId) as string } : {}),
            ...(e.title !== undefined ? { title: e.title } : {}),
            ...(e.recap !== undefined ? { recap: e.recap } : {}),
          }))
        const characters = await library.list({ category: 'character' })
        const characterAssets: Record<string, JsonValue>[] = characters.slice(0, 12).map((asset) => ({
          name: asset.name,
          refHandle: `lib:${asset.id}`,
          description: asset.description === '' ? '（无描述）' : asset.description,
        }))
        return {
          seriesTitle: series.title,
          episodeNo: Math.round(a.episodeNo),
          previous,
          characterAssets,
          notes: [
            '把 recap 写进本集澄清/剧本上下文；角色一致性用 lib: 句柄（@ref 或物化），别凭记忆描述角色长相。',
          ],
        }
      },
    }),
  ]
}
