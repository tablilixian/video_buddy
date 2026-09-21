import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CHARACTER_PRESETS,
  ENDPOINTS,
  ENDPOINT_GROUPS,
  getEndpoint,
  RES_OPTIONS,
  TEXT_SCENES,
  VID_ASPECT,
  VIDEO_ENDPOINTS,
  type EndpointDef,
  type FieldDef,
} from './endpoints'
import {
  EMPTY_MATRIX,
  MATRIX_DURATIONS,
  MATRIX_IMG_ASPECT,
  TXT2IMAGE_FIX_ID,
  UPLOAD_FIX_ID,
  comboIdSuffix,
  estimateCalls,
  expandMatrix,
  initialValues,
  mergeVals,
  resolveEffective,
  type MatrixSpec,
} from './batch.ts'
import {
  fetchMediaBytes,
  fetchToUpload,
  isAbortError,
  isRetryableStatus,
  proxyCall,
  proxyCallRaw,
  withRetry,
  type CallResult,
} from './api'
import { evaluate, summarize } from './verdict.ts'
import { NEGATIVE_CASES, judgeNegative, negativePath } from './negative.ts'

const DEFAULT_BASE = 'http://117.50.108.73:8082'

import { buildExportJson, buildExportMarkdown, download, exportStamp, truncBody, type Asset, type ExportMeta, type ReportRow } from './report.ts'

interface RunRecord {
  ts: number
  baseUrl: string
  rows: ReportRow[]
  assets: Asset[]
}

const HISTORY_KEY = 'drama-playground-history'
const HISTORY_MAX = 20

function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr = raw ? (JSON.parse(raw) as RunRecord[]) : []
    return Array.isArray(arr) ? arr.map((r) => ({ ...r, assets: Array.isArray(r.assets) ? r.assets : [] })) : []
  } catch {
    return []
  }
}
function saveHistory(recs: RunRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(recs.slice(0, HISTORY_MAX)))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 历史记录的时间戳格式（列表里要省地方）。 */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const ALL_IDS = new Set(ENDPOINTS.map((e) => e.id))

export default function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE)
  const [selectedId, setSelectedId] = useState('health')
  const endpoint = useMemo(() => getEndpoint(selectedId)!, [selectedId])
  // 全局角色入口：选定后所有「角色驱动」的提示词字段都用它。
  const [character, setCharacter] = useState(CHARACTER_PRESETS[0].value)
  // 全局「文字场景」入口：文字修复（image2fix）链路生成基图时用的中文远近景提示词。
  const [textScene, setTextScene] = useState(TEXT_SCENES[0].value)
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(getEndpoint('health')!, CHARACTER_PRESETS[0].value))
  /**
   * 每个端点的表单草稿。
   *
   * 两个作用：① 切端点再切回来不丢编辑；② 批量运行时读的是**用户实际填的值**，
   * 而不是端点里写死的示例 —— 旧实现改完提示词点「运行选中」还是跑示例，很容易
   * 对着报告纳闷「我明明改了」。
   */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  /** 参数矩阵勾选（空数组 = 该轴不参与）。 */
  const [matrix, setMatrix] = useState<MatrixSpec>(EMPTY_MATRIX)
  const [showMatrix, setShowMatrix] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<CallResult | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [report, setReport] = useState<ReportRow[] | null>(null)
  const [runAssets, setRunAssets] = useState<Asset[]>([])
  const [history, setHistory] = useState<RunRecord[]>([])
  // 勾选要测试的端点（默认全选）
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ALL_IDS))
  const [showSelect, setShowSelect] = useState(false)
  // 查看历史运行（ts）；对比时并排显示当前 vs 该历史。
  const [viewTs, setViewTs] = useState<number | null>(null)
  const [compareTs, setCompareTs] = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  // 双击素材放大的灯箱
  const [lightbox, setLightbox] = useState<Asset | null>(null)

  // —— 运行进度 ——
  // 后端是同步单任务，视频端点单次就要 130–200s；没有进度就只能盯着屏幕猜「是不是卡死了」。
  const [progress, setProgress] = useState<{ n: number; total: number; label: string } | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)

  // —— 「随时停止」——
  // 一次运行 / 一次请求独占一个 AbortController：停止时中断在途 fetch，
  // 同时置 stoppedRef 让后续步骤不再发起，并据此把未执行项标成「已停止」而非「失败」。
  const abortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef(false)

  /** 开始一次可中断操作：复位停止标记，换一个新的 controller。 */
  function beginAbortable(): AbortController {
    stoppedRef.current = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    return ctrl
  }

  /** 随时停止：中断在途请求；已完成的步骤仍留在报告里（不丢）。 */
  function stopRun() {
    if (stoppedRef.current) return
    stoppedRef.current = true
    abortRef.current?.abort()
    setNotice('已停止：在途请求已中断，已完成的部分仍保留在报告里。')
  }

  /** 已耗时计时器：只在忙的时候走，闲下来归零。 */
  useEffect(() => {
    if (!busy) {
      setElapsedSec(0)
      return
    }
    const t0 = Date.now()
    setElapsedSec(0)
    const iv = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [busy])

  /** 推进进度条。total 是估算值（含自动前置），实际步骤数可能略有出入。 */
  function reportProgress(n: number, total: number, label: string) {
    setProgress({ n, total, label })
  }

  /** 结束一轮运行：清掉进度条。 */
  function clearProgress() {
    setProgress(null)
  }

  /**
   * 上传（multipart）带自动重试。
   *
   * 实测 ~1MB 文件会偶发 `socket hang up`（后端接了连接但中途断掉），重传即成功；
   * 而上传失败在下游表现为「拿不到句柄」，整条链路连带失败 —— 退避 400ms 重试
   * 远比让用户重跑整轮划算。5xx 才算可重试，4xx 是请求本身的问题。
   */
  async function uploadWithRetry(
    file: File,
    signal: AbortSignal,
  ): Promise<{ r: CallResult; attempts: number; failures: string[] }> {
    const out = await withRetry(() => proxyCall(baseUrl, getEndpoint('upload')!, {}, file, signal), {
      signal,
      retryOnValue: (r) => isRetryableStatus(r.status),
    })
    return { r: out.value, attempts: out.attempts, failures: out.failures }
  }

  /** 转存（fetch-to-upload）带自动重试：同一类网络抖动。 */
  async function convertWithRetry(url: string, signal: AbortSignal): Promise<{ name: string; attempts: number }> {
    const out = await withRetry(() => fetchToUpload(baseUrl, url, signal), { signal })
    return { name: out.value.name, attempts: out.attempts }
  }

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  // 角色变更时，同步到当前端点的「角色驱动」字段（保证表单与全局角色一致）。
  useEffect(() => {
    if (!endpoint.fields.some((f) => f.characterDriven)) return
    setValues((v) => {
      const next = { ...v }
      for (const f of endpoint.fields) {
        if (f.characterDriven) next[f.key] = character
      }
      return next
    })
  }, [character, endpoint])

  // 表单 → 草稿的**唯一**同步点。
  // 不做在 setField / setCharacter 里各自写一遍：那需要在 state updater 里改另一个
  // state（渲染期副作用，StrictMode 下重复执行），且新增的写值入口很容易漏同步。
  // 收敛成一个 effect 后，「表单上看到的就是批量运行会发的」成为结构性保证。
  useEffect(() => {
    setDrafts((d) => ({ ...d, [selectedId]: values }))
  }, [values, selectedId])

  // Esc 关闭灯箱
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  // Esc 也可随时停止正在进行的运行 / 请求（灯箱开着时优先关灯箱）
  useEffect(() => {
    if (!busy || lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopRun()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, lightbox])

  const viewRec = viewTs != null ? history.find((h) => h.ts === viewTs) ?? null : null
  const displayRows = viewRec ? viewRec.rows : report
  const displayAssets = viewRec ? viewRec.assets : runAssets

  /** 当前矩阵勾选展开后的参数组合（空 = 只有一组「默认」，即单次运行）。 */
  const combos = useMemo(() => expandMatrix(matrix), [matrix])
  /** 矩阵预计请求数：组合数 × 每个组合实际会跑到的端点数（含自动前置）。 */
  const matrixCalls = combos.length * estimateCalls(selected)
  const toggleAxis = (axis: keyof MatrixSpec, value: string) =>
    setMatrix((m) => {
      const cur = m[axis]
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return { ...m, [axis]: next }
    })

  function selectEndpoint(id: string) {
    const ep = getEndpoint(id)!
    setSelectedId(id)
    // 有草稿就恢复草稿（切走再切回不丢编辑），没有才用默认值
    setValues(drafts[id] ?? initialValues(ep, character))
    setFile(null)
    setResponse(null)
    setNotice(null)
  }

  function setField(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }))
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleGroup(ids: string[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s)
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next
    })
  }

  function fillFirstEmptyRef(handle: string) {
    const field = endpoint.fields.find((f) => f.refKind && !(values[f.key] || '').trim())
    if (!field) {
      setNotice('当前端点没有空的参考字段可填（已填满或该端点无参考位）。')
      return false
    }
    setValues((v) => ({ ...v, [field.key]: handle }))
    setNotice(null)
    return true
  }

  async function useAsset(a: Asset) {
    if (a.kind === 'handle' && a.handle) {
      fillFirstEmptyRef(a.handle)
      return
    }
    if (a.kind === 'url' && a.url) {
      setBusy(true)
      const ctrl = beginAbortable()
      try {
        const { name } = await convertWithRetry(a.url, ctrl.signal)
        setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, kind: 'handle', handle: name } : x)))
        fillFirstEmptyRef(name)
      } catch (e) {
        setNotice(isAbortError(e) ? '已停止转存。' : `转存失败：${String(e)}`)
      } finally {
        setBusy(false)
      }
    }
  }

  async function convertAsset(a: Asset) {
    if (a.kind === 'url' && a.url) {
      setBusy(true)
      const ctrl = beginAbortable()
      try {
        const { name } = await convertWithRetry(a.url, ctrl.signal)
        setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, kind: 'handle', handle: name } : x)))
        setNotice('已转存为句柄，可直接用作输入。')
      } catch (e) {
        setNotice(isAbortError(e) ? '已停止转存。' : `转存失败：${String(e)}`)
      } finally {
        setBusy(false)
      }
    }
  }

  /** 结果入库，并返回本次新增的素材（供「本次产物」聚合）。prompt 一并记录以便回看。 */
  function pushAssetFromResult(r: CallResult, ep: EndpointDef, prompt?: string): Asset[] {
    const p = prompt && prompt.trim() ? prompt.trim() : undefined
    const next: Asset[] = []
    if (r.handle) {
      next.push({
        id: crypto.randomUUID(),
        kind: 'handle',
        mediaType: null,
        label: r.handle,
        handle: r.handle,
        fromEndpoint: ep.id,
        prompt: p,
      })
    }
    if (r.mediaUrl) {
      next.push({
        id: crypto.randomUUID(),
        kind: 'url',
        mediaType: r.mediaType,
        label: r.mediaUrl.split('/').pop() || r.mediaUrl,
        url: r.mediaUrl,
        fromEndpoint: ep.id,
        prompt: p,
      })
    }
    if (next.length > 0) setAssets((list) => [...list, ...next])
    return next
  }

  function fillSample(f: FieldDef) {
    if (typeof f.default === 'string') setField(f.key, f.default)
  }

  /**
   * 一键准备参考图：txt2image（中文远近景 / 角色）→ 上传拿句柄 → 填入第一个空参考位。
   * 文字修复用「文字场景」基图（近景清晰、远景虚化），其余句柄依赖端点用「角色」。
   */
  async function prepareRefImage() {
    setBusy(true)
    setNotice(null)
    const ctrl = beginAbortable()
    const isFix = endpoint.id === 'image2fix'
    const prompt = isFix ? textScene : character
    try {
      const t2i = getEndpoint('txt2image')!
      const r = await proxyCall(baseUrl, t2i, { prompt, aspectRatio: '16:9', resolution: '736p' }, null, ctrl.signal)
      pushAssetFromResult(r, t2i, prompt)
      if (!r.ok || !r.mediaUrl) throw new Error(`文生图失败 HTTP ${r.status}`)
      const blob = await fetchMediaBytes(baseUrl, r.mediaUrl, ctrl.signal)
      const f = new File([blob], 'fixture.png', { type: blob.type || 'image/png' })
      const { r: up, attempts } = await uploadWithRetry(f, ctrl.signal)
      const h = up.handle
      if (!up.ok || !h) throw new Error(`上传未拿到句柄 HTTP ${up.status}`)
      pushAssetFromResult(up, getEndpoint('upload')!)
      const target = endpoint.fields.find((x) => x.refKind && !(values[x.key] || '').trim())
      if (!target) {
        setNotice(`已生成句柄 ${h}，但当前端点没有空的参考位；可从素材库点「用作输入」手填。`)
        return
      }
      setValues((v) => ({ ...v, [target.key]: h }))
      setNotice(`已生成${isFix ? '中文远近景' : '角色'}基图并填入「${target.label}」：${h}${attempts > 1 ? `（上传重试 ${attempts - 1} 次后成功）` : ''}`)
    } catch (e) {
      setNotice(isAbortError(e) ? '已停止：准备参考图被中断。' : `准备参考图失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 只跑选中的端点；缺前置（生成图 / 上传句柄）时自动补跑并标注。 */
  /**
   * 批量运行。
   *
   * @param ids    要跑的端点
   * @param matrix 参数矩阵；不传 = 单次运行（沿用表单值）。传了则按勾选的轴做笛卡尔积，
   *               每个组合跑一遍完整链路（含前置），报告 id 加 `#组合` 后缀以便同表对照。
   */
  async function runSelected(ids: Set<string>, matrix?: MatrixSpec) {
    if (ids.size === 0) {
      setNotice('没有勾选任何端点。点「选择端点」勾选后再运行。')
      return
    }
    setBusy(true)
    setNotice(null)
    const ctrl = beginAbortable()
    const rep: ReportRow[] = []
    const collected: Asset[] = []
    const trunc = truncBody

    const combos = matrix ? expandMatrix(matrix) : [{}]
    /** 当前组合的 id 后缀。step/log/skipStep 内部统一追加，调用点无需感知多组合。 */
    let sfx = ''

    // —— 依赖解析 ——（算法提到模块级 resolveEffective，UI 估算与运行共用同一份）
    const { effective, prereq } = resolveEffective(ids)
    const want = (id: string) => effective.has(id)
    const pre = (id: string) => (prereq.includes(id) ? '（自动前置：供下游取句柄）' : '')
    // 进度总量：每个组合跑 effective.size 个端点，外加每组合一次健康检查
    const totalSteps = combos.length * (effective.size + 1)

    const log = (id: string, title: string, r: CallResult, note?: string, input?: string, output?: string) => {
      id = id + sfx
      const j = r.json as Record<string, unknown> | null
      const sd = j && typeof j.duration === 'number' ? (j.duration as number) : undefined
      // PASS 判定 = HTTP 2xx **且** 端点声明的结构断言全过（不只是「有响应」）。
      const v = evaluate(id, r.status, j, r.text)
      const base = note ?? (r.ok ? 'OK' : String(r.text || 'fail').slice(0, 160))
      rep.push({
        id,
        title,
        ok: v.pass,
        status: r.status,
        ms: r.ms,
        note: summarize(v, base),
        failures: v.pass ? undefined : v.failures,
        input,
        output: output ? trunc(output) : undefined,
        serverDuration: sd,
      })
    }
    const step = async (id: string, title: string, fn: () => Promise<void>) => {
      // 矩阵模式下 id 带组合后缀，保证多组合的行互不覆盖
      id = id + sfx
      // 进度：「第 N/M 步 · 当前步骤」——视频端点单次 130–200s，没进度就像卡死
      reportProgress(rep.length + 1, totalSteps, combos.length > 1 ? `${title}${sfx}` : title)
      // 已停止：不再发起新请求，直接记为「已停止」
      if (stoppedRef.current) {
        if (!rep.some((x) => x.id === id)) {
          rep.push({ id, title, ok: false, skip: true, status: 0, ms: 0, note: '已手动停止，未执行' })
        }
        return
      }
      try {
        await fn()
      } catch (e) {
        if (!rep.some((x) => x.id === id)) {
          // 区分「用户主动停」与「真失败」：前者标 skip，不污染失败计数
          const stopped = stoppedRef.current || isAbortError(e)
          rep.push({
            id,
            title,
            ok: false,
            skip: stopped,
            status: 0,
            ms: 0,
            note: stopped ? '已手动停止，请求被中断' : String(e),
            input: undefined,
            output: undefined,
          })
        }
      }
    }

    /**
     * 跑**一个参数组合**。矩阵模式下会被依次调用；单次运行只调一次（combo 为空对象）。
     *
     * 组合值通过 `V()` 合并进每次调用（矩阵 > 表单草稿 > 端点默认），
     * 报告 id 统一加 `sfx` 后缀，于是多组合的结果能在同一张表里并排对照。
     */
    const runCombo = async (combo: Record<string, string>) => {
      sfx = comboIdSuffix(combo)
      /** 取该端点在当前组合下的字段值（注入值优先）。 */
      const V = (id: string, extra: Record<string, string> = {}) =>
        mergeVals(getEndpoint(id)!, drafts, combo, character, id, extra)

      let backendOk = true
      let handle: string | null = null
      let mediaUrl: string | null = null
      let fixHandle: string | null = null
      let fixMediaUrl: string | null = null

      // 健康检查：无论是否勾选都作为可达性前置，但仅在勾选时计入报告。
      await step('health', '健康检查', async () => {
        const r = await proxyCall(baseUrl, getEndpoint('health')!, {}, null, ctrl.signal)
        if (want('health')) log('health', '健康检查', r, undefined, 'GET /api/v1/health')
        if (!r.ok) {
          backendOk = false
          throw new Error('后端不可达，后续用例跳过')
        }
      })

      if (backendOk) {
        if (want('txt2image')) {
          await step('txt2image', '文生图', async () => {
            const ep = getEndpoint('txt2image')!
            const v = V('txt2image')
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('txt2image', '文生图', r, pre('txt2image') || undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
            mediaUrl = r.mediaUrl
            if (!r.ok || !r.mediaUrl) throw new Error('未生成图')
          })
        }

        if (want('upload')) {
          await step('upload', '上传文件（自动）', async () => {
            if (!mediaUrl) throw new Error('无图可上传')
            const blob = (await withRetry(() => fetchMediaBytes(baseUrl, mediaUrl!, ctrl.signal), { signal: ctrl.signal })).value
            const f = new File([blob], 'gen.png', { type: blob.type || 'image/png' })
            const { r, attempts } = await uploadWithRetry(f, ctrl.signal)
            log('upload', '上传文件（自动）', r, (r.handle ? `句柄 ${r.handle}` : '未返回 name') + (attempts > 1 ? `（重试 ${attempts - 1} 次）` : '') + pre('upload'), `multipart: file=gen.png (${blob.size}B)`, r.text)
            if (!r.ok || !r.handle) throw new Error('上传未拿到句柄')
            handle = r.handle
          })
        }

        // —— 文字修复基图：中文远近景广告牌（近景清晰 / 远景虚化），与角色基图独立 ——
        if (want(TXT2IMAGE_FIX_ID)) {
          await step(TXT2IMAGE_FIX_ID, '文生图（文字场景基图）', async () => {
            const ep = getEndpoint('txt2image')!
            const v = V('txt2image', { prompt: textScene })
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log(TXT2IMAGE_FIX_ID, '文生图（文字场景基图）', r, pre(TXT2IMAGE_FIX_ID) || undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
            fixMediaUrl = r.mediaUrl
            if (!r.ok || !r.mediaUrl) throw new Error('未生成文字场景基图')
          })
        }

        if (want(UPLOAD_FIX_ID)) {
          await step(UPLOAD_FIX_ID, '上传（文字场景基图）', async () => {
            if (!fixMediaUrl) throw new Error('无图可上传')
            const blob = (await withRetry(() => fetchMediaBytes(baseUrl, fixMediaUrl!, ctrl.signal), { signal: ctrl.signal })).value
            const f = new File([blob], 'fix-scene.png', { type: blob.type || 'image/png' })
            const { r, attempts } = await uploadWithRetry(f, ctrl.signal)
            log(UPLOAD_FIX_ID, '上传（文字场景基图）', r, (r.handle ? `句柄 ${r.handle}` : '未返回 name') + (attempts > 1 ? `（重试 ${attempts - 1} 次）` : '') + pre(UPLOAD_FIX_ID), `multipart: file=fix-scene.png (${blob.size}B)`, r.text)
            if (!r.ok || !r.handle) throw new Error('上传未拿到句柄')
            fixHandle = r.handle
          })
        }

        if (want('txt2imageanime')) {
          await step('txt2imageanime', '卡通文生图', async () => {
            const ep = getEndpoint('txt2imageanime')!
            const v = V('txt2imageanime')
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('txt2imageanime', '卡通文生图', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
          })
        }

        const runIf = async (id: string, title: string, fn: () => Promise<void>) => {
          if (want(id)) await step(id, title, fn)
        }
        const skipStep = (id: string, note: string) => {
          if (want(id)) rep.push({ id: id + sfx, title: getEndpoint(id)!.title, ok: false, skip: true, status: 0, ms: 0, note })
        }

        // ① 角色基图 → 图生图 / 角色四视图
        if (handle) {
          const h = handle
          await runIf('image2image', '图生图', async () => {
            const ep = getEndpoint('image2image')!
            const v = V('image2image', { image1: h })
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('image2image', '图生图', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
          })
          await runIf('image2character', '角色四视图', async () => {
            const ep = getEndpoint('image2character')!
            const v = V('image2character', { filename: h })
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('image2character', '角色四视图', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep))
          })
        } else {
          skipStep('image2image', '缺少句柄（角色基图生成/上传失败），跳过')
          skipStep('image2character', '缺少句柄（角色基图生成/上传失败），跳过')
        }

        // ② 文字修复：优先用「文字场景基图」（中文远近景），缺失时回退角色基图
        if (want('image2fix')) {
          const fh = fixHandle ?? handle
          if (fh) {
            await step('image2fix', '图内文字修复（中文）', async () => {
              const ep = getEndpoint('image2fix')!
              const v = V('image2fix', { filename: fh })
              const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
              log('image2fix', '图内文字修复（中文）', r, fixHandle ? '基图＝文字场景基图（中文远近景）' : '基图＝角色基图（回退）', JSON.stringify(v), r.text)
              collected.push(...pushAssetFromResult(r, ep, v.prompt))
            })
          } else {
            skipStep('image2fix', '缺少句柄（文字场景基图生成/上传失败），跳过')
          }
        }

        // ③ 图片理解：任意图皆可
        if (want('image2vl')) {
          const vh = handle ?? fixHandle
          if (vh) {
            await step('image2vl', '图片理解 VL', async () => {
              const ep = getEndpoint('image2vl')!
              const v = V('image2vl', { filename: vh })
              const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
              log('image2vl', '图片理解 VL', r, undefined, JSON.stringify(v), r.text)
            })
          } else {
            skipStep('image2vl', '无可用句柄，跳过')
          }
        }

        // ④ 视频：用角色基图（放在最后，两个端点最慢）
        if (handle) {
          const h = handle
          await runIf('videoFl2va', '首帧视频', async () => {
            const ep = getEndpoint('videoFl2va')!
            const v = V('videoFl2va', { image1: h })
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('videoFl2va', '首帧视频', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
          })
          await runIf('videoRef2va', '多参考图视频', async () => {
            const ep = getEndpoint('videoRef2va')!
            const v = V('videoRef2va', { image1: h })
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('videoRef2va', '多参考图视频', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.prompt))
          })
        } else {
          skipStep('videoFl2va', '缺少句柄（角色基图生成/上传失败），跳过')
          skipStep('videoRef2va', '缺少句柄（角色基图生成/上传失败），跳过')
        }

        if (want('promptEnhance')) {
          await step('promptEnhance', '提示词增强', async () => {
            const ep = getEndpoint('promptEnhance')!
            const v = V('promptEnhance')
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('promptEnhance', '提示词增强', r, undefined, JSON.stringify(v), r.text)
          })
        }
        if (want('txt2audio')) {
          await step('txt2audio', '文生音频', async () => {
            const ep = getEndpoint('txt2audio')!
            const v = V('txt2audio')
            const r = await proxyCall(baseUrl, ep, v, null, ctrl.signal)
            log('txt2audio', '文生音频', r, undefined, JSON.stringify(v), r.text)
            collected.push(...pushAssetFromResult(r, ep, v.caption_prompt))
          })
        }
      }

      // 停止后：把已勾选但没跑到的端点补一行「已停止」，让报告完整反映「跑到哪一步了」
      if (stoppedRef.current) {
        for (const id of effective) {
          if (!rep.some((x) => x.id === id + sfx)) {
            rep.push({ id: id + sfx, title: getEndpoint(id)?.title ?? id, ok: false, skip: true, status: 0, ms: 0, note: '已手动停止，未执行' })
          }
        }
        setNotice(`已停止：${rep.filter((x) => !x.skip).length} 个步骤已完成并入库，其余标记为「已停止」。`)
      }
      if (stoppedRef.current) return
    }

    // 参数矩阵：逐组合跑；组合之间互不共享句柄（档位变了基图就得重出）
    for (const combo of combos) {
      await runCombo(combo)
      if (stoppedRef.current) break
    }


    setReport([...rep])
    setRunAssets(collected)
    const rec: RunRecord = { ts: Date.now(), baseUrl, rows: rep.map((r) => ({ ...r })), assets: collected }
    setHistory((h) => {
      const next = [rec, ...h].slice(0, HISTORY_MAX)
      saveHistory(next)
      return next
    })
    setViewTs(null)
    setCompareTs(null)
    clearProgress()
    setBusy(false)
  }

  /**
   * 负向用例包：故意发坏请求，期望**被后端挡下**，且 422 的 loc 要指对我们做错的字段。
   *
   * 与批量运行相反的判定，所以不复用 `log`/`step`；但报告行结构、停止语义、
   * 历史入库都与批量运行一致 —— 两种结果要能在同一张表里对照着看。
   */
  async function runNegative() {
    setBusy(true)
    setNotice(null)
    const ctrl = beginAbortable()
    const rep: ReportRow[] = []
    const expectOf = (c: (typeof NEGATIVE_CASES)[number]) =>
      `期望 ${c.expectStatus.join('/')}${c.expectField ? ` · loc=${c.expectField}` : ''}`

    for (const [idx, c] of NEGATIVE_CASES.entries()) {
      reportProgress(idx + 1, NEGATIVE_CASES.length, c.title)
      if (stoppedRef.current) {
        rep.push({ id: c.id, title: c.title, ok: false, skip: true, status: 0, ms: 0, note: '已手动停止，未执行', expect: expectOf(c) })
        continue
      }
      const input = c.multipart ? 'multipart（故意不带 file）' : JSON.stringify(c.body ?? {})
      try {
        const r = await proxyCallRaw(baseUrl, negativePath(c), c.body, c.multipart ?? false, ctrl.signal)
        const v = judgeNegative(c, r.status, r.json)
        const j = r.json as Record<string, unknown> | null
        rep.push({
          id: c.id,
          title: c.title,
          ok: v.pass,
          status: r.status,
          ms: r.ms,
          note: v.pass ? v.note : v.failures.join('；'),
          failures: v.pass ? undefined : v.failures,
          expect: expectOf(c),
          input,
          output: truncBody(r.text),
          serverDuration: j && typeof j.duration === 'number' ? (j.duration as number) : undefined,
        })
      } catch (e) {
        const stopped = stoppedRef.current || isAbortError(e)
        rep.push({
          id: c.id,
          title: c.title,
          ok: false,
          skip: stopped,
          status: 0,
          ms: 0,
          note: stopped ? '已手动停止，请求被中断' : String(e),
          expect: expectOf(c),
          input,
        })
      }
    }

    setReport([...rep])
    setRunAssets([])
    const rec: RunRecord = { ts: Date.now(), baseUrl, rows: rep.map((r) => ({ ...r })), assets: [] }
    setHistory((h) => {
      const next = [rec, ...h].slice(0, HISTORY_MAX)
      saveHistory(next)
      return next
    })
    setViewTs(null)
    setCompareTs(null)
    clearProgress()
    setBusy(false)
    const bad = rep.filter((r) => !r.ok && !r.skip).length
    setNotice(
      stoppedRef.current
        ? `已停止：负向用例跑了 ${rep.filter((r) => !r.skip).length}/${NEGATIVE_CASES.length} 条。`
        : bad === 0
          ? `负向用例 ${rep.length} 条全部如期被挡下。`
          : `⚠️ ${bad} 条负向用例未达预期 —— 后端可能放行了坏请求，或报错定位不准（见报告「预期」列对照）。`,
    )
  }

  async function send() {
    setBusy(true)
    setNotice(null)
    const ctrl = beginAbortable()
    try {
      const r = await proxyCall(baseUrl, endpoint, values, file, ctrl.signal)
      setResponse(r)
      pushAssetFromResult(r, endpoint, values.prompt || values.caption_prompt)
      // 与批量运行同一套判定：HTTP 200 但结构不对时也要说清「哪里不对」。
      const v = evaluate(endpoint.id, r.status, r.json)
      if (!v.pass) {
        setNotice(
          r.ok
            ? `HTTP ${r.status} 但响应结构不符合预期：${v.failures.join('；')}`
            : `请求返回 ${r.status}：${v.failures.join('；')}`,
        )
      }
    } catch (e) {
      const aborted = isAbortError(e)
      setResponse({
        status: 0,
        ok: false,
        ms: 0,
        text: aborted ? '已停止：请求被手动中断。' : String(e),
        json: null,
        mediaUrl: null,
        mediaType: null,
        handle: null,
      })
      setNotice(aborted ? '已停止：请求被手动中断。' : `调用失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // —— 分析数据 ——
  const passed = displayRows?.filter((r) => r.ok).length ?? 0
  const failed = displayRows?.filter((r) => !r.ok && !r.skip).length ?? 0
  const skipped = displayRows?.filter((r) => r.skip).length ?? 0
  const timed = displayRows?.filter((r) => !r.skip && r.ms > 0) ?? []
  const sumMs = timed.reduce((s, r) => s + r.ms, 0)
  const avgMs = timed.length ? Math.round(sumMs / timed.length) : 0
  const maxMs = timed.length ? Math.max(...timed.map((r) => r.ms)) : 0
  const minMs = timed.length ? Math.min(...timed.map((r) => r.ms)) : 0
  const slowest = timed.length ? timed.reduce((a, b) => (b.ms > a.ms ? b : a)) : null
  const total = displayRows?.length ?? 0
  const passRate = total ? Math.round((passed / total) * 100) : 0

  return (
    <div className="app">
      <div className="topbar">
        <h1>Drama API Playground</h1>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Drama Backend base URL"
          spellCheck={false}
        />
        <button className="btn secondary small" onClick={() => setBaseUrl(DEFAULT_BASE)}>
          默认
        </button>
        <span className="spacer" />
        <button className={`btn small ${showSelect ? 'secondary' : ''}`} onClick={() => setShowSelect((s) => !s)} disabled={busy}>
          选择端点 {selected.size}/{ENDPOINTS.length}
        </button>
        <button
          className={`btn small ${showMatrix ? 'secondary' : ''}`}
          onClick={() => setShowMatrix((s) => !s)}
          disabled={busy}
          title="按分辨率档位 / 宽高比 / 时长做笛卡尔积，每组参数各跑一遍选中端点"
        >
          参数矩阵 {combos.length > 1 ? `×${combos.length}` : ''}
        </button>
        <button
          className="btn small secondary"
          onClick={runNegative}
          disabled={busy}
          title={`${NEGATIVE_CASES.length} 条固定坏请求：缺必填 / 非法枚举 / 类型错 / 产物名当句柄 / 不存在的句柄。期望被后端挡下，且 422 的报错要指对字段。`}
        >
          负向用例 {NEGATIVE_CASES.length}
        </button>
        {busy ? (
          <button className="btn small danger" onClick={stopRun} title="随时停止：中断在途请求；已完成的部分会保留在报告里（按 Esc 亦可）">
            停止测试
          </button>
        ) : (
          <button className="btn small" onClick={() => runSelected(new Set(ALL_IDS))}>
            运行全部接口
          </button>
        )}
        {busy ? <span className="tag running">测试中…</span> : <span className="tag">同源代理绕过 CORS</span>}
      </div>

      {/* 运行进度：后端同步单任务，视频端点单次 130–200s —— 没有进度就像卡死 */}
      {busy && progress && (
        <div className="progress" role="status" aria-live="polite">
          <div className="pg-track">
            <div className="pg-fill" style={{ width: `${Math.min(100, Math.round((progress.n / Math.max(1, progress.total)) * 100))}%` }} />
          </div>
          <span className="pg-text">
            第 <b>{progress.n}</b>/{progress.total} 步 · 已耗时 <b>{elapsedSec}s</b>
            <span className="pg-label">{progress.label}</span>
          </span>
        </div>
      )}

      {/* 全局角色入口：选定后所有角色驱动字段（文生图等）都用这个角色 */}
      <div className="charbar">
        <span className="charlabel">角色</span>
        {CHARACTER_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`preset-chip${character === p.value ? ' active' : ''}`}
            onClick={() => setCharacter(p.value)}
            title={p.value}
          >
            {p.label}
          </button>
        ))}
        <span className="char-sep" />
        <input
          className="char-custom"
          value={character}
          onChange={(e) => setCharacter(e.target.value)}
          placeholder="角色描述（务必单个人物）"
          spellCheck={false}
        />
      </div>

      {/* 全局文字场景入口：文字修复（image2fix）基图用——须含远近景中文文字 */}
      <div className="charbar">
        <span className="charlabel">文字场景</span>
        {TEXT_SCENES.map((p) => (
          <button
            key={p.label}
            className={`preset-chip${textScene === p.value ? ' active' : ''}`}
            onClick={() => setTextScene(p.value)}
            title={p.value}
          >
            {p.label}
          </button>
        ))}
        <span className="char-sep" />
        <input
          className="char-custom"
          value={textScene}
          onChange={(e) => setTextScene(e.target.value)}
          placeholder="文字修复基图提示词（须含远近景中文文字）"
          spellCheck={false}
        />
      </div>

      <div className="columns">
        <div className="sidebar">
          {ENDPOINT_GROUPS.map((g) => (
            <div key={g}>
              <div className="group-title">{g}</div>
              {ENDPOINTS.filter((e) => e.group === g).map((e) => (
                <button
                  key={e.id}
                  className={`ep-item${e.id === selectedId ? ' active' : ''}`}
                  onClick={() => selectEndpoint(e.id)}
                >
                  <span className="method">{e.method}</span>
                  {e.title}
                  {VIDEO_ENDPOINTS.includes(e.id) && <span className="tag slow">慢</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="main">
          <h2 className="form-title">{endpoint.title}</h2>
          <p className="form-sub">
            {endpoint.method} {endpoint.path}
          </p>
          {notice && <div className="notice">{notice}</div>}

          {endpoint.fields.map((f) => (
            <FieldInput key={f.key} field={f} value={values[f.key] || ''} onChange={(v) => setField(f.key, v)} onFile={(fl) => setFile(fl)} onClearFile={() => setFile(null)} onSample={() => fillSample(f)} />
          ))}

          <div className="btn-row">
            <button className="btn" onClick={send} disabled={busy}>
              {busy ? '请求中…' : '发送请求'}
            </button>
            {busy && (
              <button className="btn danger" onClick={stopRun} title="随时停止：中断在途请求（按 Esc 亦可）">
                停止
              </button>
            )}
            <button className="btn ghost" onClick={() => selectEndpoint(selectedId)} disabled={busy}>
              重置表单
            </button>
            {endpoint.fields.some((f) => f.refKind) && (
              <button
                className="btn ghost"
                onClick={prepareRefImage}
                disabled={busy}
                title={endpoint.id === 'image2fix' ? '按「文字场景」生成基图 → 上传 → 填入参考句柄' : '按「角色」生成基图 → 上传 → 填入参考句柄'}
              >
                准备参考图
              </button>
            )}
          </div>

          {endpoint.id === 'image2fix' && (
            <p className="form-sub" style={{ marginTop: 10 }}>
              中文文字修复用例：基图取「文字场景」（默认街道广告牌，近景清晰 / 远景虚化）。
              验证点两条 —— <b>近景文字改对</b>、<b>远景虚化文字不被误改</b>。
              当前场景：{TEXT_SCENES.find((s) => s.value === textScene)?.label ?? '自定义'}。
            </p>
          )}

          {endpoint.id === 'health' && (
            <p className="form-sub" style={{ marginTop: 16 }}>
              提示：先点「健康检查」确认后端可达，再调生成端点。生成图/视频会自动进右侧素材库；
              点素材「用作输入」可填入下一步的参考字段。顶栏「选择端点」可勾选只跑其中几项，
              「运行全部接口」会自动跑完整链路（含自动上传拿句柄），并记录每步输入/输出/耗时与产物，存为历史可对比。
              运行期间顶栏按钮会变成「<b>停止测试</b>」，可随时中断（按 <b>Esc</b> 亦可）：
              在途请求立即中断，已完成的部分照常入库，未跑到的端点标为「已停止」。
            </p>
          )}
        </div>

        <div className="right">
          {showMatrix && (
            <div className="selector">
              <div className="section-title">
                参数矩阵 <span className="count">{combos.length} 组 × {estimateCalls(selected)} 端点 = {matrixCalls} 次调用</span>
              </div>
              <div className="mx-body">
                <div className="mx-axis">
                  <span className="mx-label">分辨率档位</span>
                  <div className="mx-chips">
                    {RES_OPTIONS.map((v) => (
                      <label key={v} className={`mx-chip${matrix.resolution.includes(v) ? ' active' : ''}`}>
                        <input type="checkbox" checked={matrix.resolution.includes(v)} onChange={() => toggleAxis('resolution', v)} />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mx-axis">
                  <span className="mx-label">宽高比</span>
                  <div className="mx-chips">
                    {MATRIX_IMG_ASPECT.map((v) => (
                      <label
                        key={v}
                        className={`mx-chip${matrix.aspectRatio.includes(v) ? ' active' : ''}`}
                        title={VID_ASPECT.includes(v) ? undefined : '视频端点只收 16:9 / 9:16，会在该组合下被后端 422 挡下'}
                      >
                        <input type="checkbox" checked={matrix.aspectRatio.includes(v)} onChange={() => toggleAxis('aspectRatio', v)} />
                        {v}
                        {VID_ASPECT.includes(v) ? '' : '（图片）'}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mx-axis">
                  <span className="mx-label">时长(秒)</span>
                  <div className="mx-chips">
                    {MATRIX_DURATIONS.map((v) => (
                      <label key={v} className={`mx-chip${matrix.duration.includes(v) ? ' active' : ''}`}>
                        <input type="checkbox" checked={matrix.duration.includes(v)} onChange={() => toggleAxis('duration', v)} />
                        {v}s
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mx-note">
                只覆盖端点<b>真的有</b>的字段（如 <code>image2fix</code> 没有分辨率字段，勾了也不受影响）。
                每个组合都会重跑一遍前置（档位/宽高比变了，基图必须重出），所以组合数会成倍放大调用次数 ——
                后端是<b>同步单任务</b>，上面的调用数就是你要等的次数。运行中可随时「停止测试」。
              </p>
              <div className="sel-acts">
                <button className="btn small ghost" onClick={() => setMatrix(EMPTY_MATRIX)}>
                  清空矩阵
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => runSelected(selected)}
                  disabled={busy || selected.size === 0}
                >
                  单次运行（不用矩阵）
                </button>
                <button
                  className="btn small"
                  onClick={() => runSelected(selected, matrix)}
                  disabled={busy || selected.size === 0 || combos.length === 0}
                >
                  运行矩阵（{matrixCalls} 次调用）
                </button>
              </div>
            </div>
          )}

          {showSelect && (
            <div className="selector">
              <div className="section-title">
                选择要测试的端点 <span className="count">{selected.size}/{ENDPOINTS.length}</span>
              </div>
              <div className="sel-body">
                {ENDPOINT_GROUPS.map((g) => {
                  const eps = ENDPOINTS.filter((e) => e.group === g)
                  const allSel = eps.every((e) => selected.has(e.id))
                  return (
                    <div key={g} className="sel-group">
                      <label className="sel-ghead">
                        <input type="checkbox" checked={allSel} onChange={() => toggleGroup(eps.map((e) => e.id), !allSel)} />
                        {g}
                      </label>
                      {eps.map((e) => (
                        <label key={e.id} className="sel-item">
                          <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleOne(e.id)} />
                          <span className="sel-title">{e.title}</span>
                          {VIDEO_ENDPOINTS.includes(e.id) && <span className="tag slow">慢</span>}
                          <span className="method">{e.method}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
              <div className="sel-acts">
                <button className="btn small ghost" onClick={() => setSelected(new Set(ALL_IDS))}>全选</button>
                <button className="btn small ghost" onClick={() => setSelected(new Set())}>全不选</button>
                <button className="btn small ghost" onClick={() => setSelected(new Set([selectedId]))}>仅当前</button>
                <button className="btn small ghost" onClick={() => setSelected(new Set(ENDPOINTS.map((e) => e.id).filter((id) => !VIDEO_ENDPOINTS.includes(id))))}>仅快速</button>
                <button className="btn small" onClick={() => runSelected(selected)} disabled={busy || selected.size === 0}>
                  运行选中 {selected.size} 项
                </button>
              </div>
            </div>
          )}

          <div className="section-title">
            素材库 <span className="count">{assets.length}</span>
          </div>
          <div className="assets">
            {assets.length === 0 && <div className="empty">暂无素材。生成结果会自动入库。</div>}
            {assets.map((a) => (
              <div className="asset" key={a.id}>
                {a.mediaType === 'image' && a.url && <img src={a.url} alt={a.label} title="双击放大 · 查看提示词" onDoubleClick={() => setLightbox(a)} />}
                {a.mediaType === 'video' && a.url && <video src={a.url} controls preload="metadata" title="双击放大" onDoubleClick={() => setLightbox(a)} />}
                {a.mediaType === 'audio' && a.url && <audio src={a.url} controls title="双击查看提示词" onDoubleClick={() => setLightbox(a)} />}
                {a.kind === 'handle' ? (
                  <div className="meta">
                    句柄 <span className="kind">{a.handle}</span>
                  </div>
                ) : (
                  <div className="meta">
                    <span className="kind">URL·需转存</span>
                  </div>
                )}
                <div className="meta">{a.label}</div>
                <div className="acts">
                  <button className="btn small" onClick={() => useAsset(a)} disabled={busy}>
                    用作输入
                  </button>
                  {a.kind === 'url' && (
                    <button className="btn small ghost" onClick={() => convertAsset(a)} disabled={busy}>
                      转存
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="section-title">响应</div>
          <div className="response">
            {!response && <div className="empty">尚无响应。</div>}
            {response && (
              <>
                <div className="res-status">
                  <span className={response.ok ? 'ok' : 'err'}>
                    HTTP {response.status} {response.ok ? 'OK' : 'FAIL'}
                  </span>{' '}
                  <span className="ms">· {response.ms} ms</span>
                  {/* 结构断言结论：HTTP 200 但字段缺失时，这里会明确标红 */}
                  {(() => {
                    const v = evaluate(endpoint.id, response.status, response.json)
                    return v.pass ? (
                      <span className="assert ok" title="响应结构断言全部通过">
                        · 断言通过
                      </span>
                    ) : (
                      <span className="assert err" title={v.failures.join('\n')}>
                        · 断言失败 {v.failures.length} 项
                      </span>
                    )
                  })()}
                </div>
                {(() => {
                  const v = evaluate(endpoint.id, response.status, response.json)
                  return v.pass ? null : (
                    <ul className="assert-fails">
                      {v.failures.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )
                })()}
                {response.mediaUrl && (
                  <div className="res-media">
                    {response.mediaType === 'video' && <video src={response.mediaUrl} controls />}
                    {response.mediaType === 'image' && <img src={response.mediaUrl} alt="result" />}
                    {response.mediaType === 'audio' && <audio src={response.mediaUrl} controls />}
                  </div>
                )}
                <pre className="res-body">{response.text || '(空响应体)'}</pre>
              </>
            )}
          </div>

          {displayRows && (
            <>
              <div className="section-title">
                测试报告
                <span className="count">
                  通过 {passed} · 失败 {failed} · 跳过 {skipped}
                </span>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    const meta: ExportMeta = { ts: viewRec ? viewRec.ts : Date.now(), baseUrl, rows: displayRows ?? [], assets: displayAssets }
                    download(`drama-report-${exportStamp(meta.ts)}.json`, buildExportJson(meta), 'application/json')
                  }}
                  title="导出结构化 JSON（含每步输入/输出、判定口径），适合回归对比或贴 issue"
                >
                  导出 JSON
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    const meta: ExportMeta = { ts: viewRec ? viewRec.ts : Date.now(), baseUrl, rows: displayRows ?? [], assets: displayAssets }
                    download(`drama-report-${exportStamp(meta.ts)}.md`, buildExportMarkdown(meta), 'text/markdown')
                  }}
                  title="导出 Markdown 表格（含失败明细），适合直接贴群 / PR"
                >
                  导出 Markdown
                </button>
                <button className="btn small ghost close" onClick={() => { setReport(null); setRunAssets([]); setViewTs(null); setCompareTs(null) }}>
                  关闭
                </button>
              </div>

              <div className="report">
                {viewTs != null && (
                  <div className="hist-banner">
                    正在查看历史运行 · {fmtTime(viewTs)}（只读）
                    <button className="btn small ghost" onClick={() => { setViewTs(null); setCompareTs(null) }}>← 返回当前</button>
                  </div>
                )}

                {/* 分析数据：总/均/最慢/最快/通过率 + 最慢步骤 */}
                <div className="analysis">
                  <div className="an-item"><span className="an-n">{total}</span><span className="an-l">用例</span></div>
                  <div className="an-item"><span className="an-n ok">{passed}</span><span className="an-l">通过</span></div>
                  <div className="an-item"><span className="an-n err">{failed}</span><span className="an-l">失败</span></div>
                  <div className="an-item"><span className="an-n warn">{skipped}</span><span className="an-l">跳过</span></div>
                  <div className="an-item"><span className="an-n">{passRate}%</span><span className="an-l">通过率</span></div>
                  <div className="an-item"><span className="an-n">{sumMs}ms</span><span className="an-l">总耗时</span></div>
                  <div className="an-item"><span className="an-n">{avgMs}ms</span><span className="an-l">平均</span></div>
                  <div className="an-item"><span className="an-n">{minMs}ms</span><span className="an-l">最快</span></div>
                  <div className="an-item"><span className="an-n">{maxMs}ms</span><span className="an-l">最慢</span></div>
                </div>
                {slowest && (
                  <div className="an-note">最慢步骤：<code>{slowest.id}</code> {slowest.ms}ms{slowest.serverDuration ? ` · 服务端生成 ${slowest.serverDuration}s` : ''}</div>
                )}

                {/* 统计图：每步耗时横向条 */}
                <div className="chart">
                  <div className="chart-head">
                    耗时统计图
                    <span className="chart-sum">平均 {avgMs}ms · 最慢 {maxMs}ms · 共 {timed.length} 步计时</span>
                    <button className="btn small ghost" onClick={() => setShowHistory((s) => !s)}>
                      {showHistory ? '隐藏历史' : '历史记录'}
                    </button>
                  </div>
                  <LatencyChart title={viewRec ? `历史 ${fmtTime(viewRec.ts)}` : '当前运行'} rows={displayRows} />
                  {compareTs != null && (() => {
                    const rec = history.find((h) => h.ts === compareTs)
                    if (!rec) return null
                    return (
                      <div className="compare">
                        <LatencyChart title={`对比：历史 ${fmtTime(compareTs)}`} rows={rec.rows} />
                        <button className="btn small ghost" onClick={() => setCompareTs(null)}>取消对比</button>
                      </div>
                    )
                  })()}
                </div>

                {/* 统一产物查看：本次运行产出的图/视频/音频/句柄 */}
                <div className="run-assets">
                  <div className="chart-head">本次运行产物 <span className="count">{displayAssets.length}</span></div>
                  {displayAssets.length === 0 && <div className="empty">本次运行无产物（或均为文本类返回）。</div>}
                  <div className="gallery">
                    {displayAssets.map((a) => (
                      <div className="gal-item" key={a.id}>
                        <div className="gal-media">
                          {a.mediaType === 'image' && a.url ? (
                            <img src={a.url} alt={a.label} title="双击放大 · 查看提示词" onDoubleClick={() => setLightbox(a)} />
                          ) : a.mediaType === 'video' && a.url ? (
                            <video src={a.url} controls preload="metadata" title="双击放大" onDoubleClick={() => setLightbox(a)} />
                          ) : a.mediaType === 'audio' && a.url ? (
                            <audio src={a.url} controls title="双击查看提示词" onDoubleClick={() => setLightbox(a)} />
                          ) : (
                            <div className="gal-handle">句柄</div>
                          )}
                        </div>
                        <div className="gal-meta">
                          <code>{a.fromEndpoint}</code>
                          <span className="gal-label" title={a.handle || a.url || a.label}>{a.handle || a.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 历史记录面板 */}
                {showHistory && (
                  <div className="history">
                    {history.length === 0 && <div className="empty">暂无历史。运行一次后会自动保存。</div>}
                    {history.map((h) => {
                      const p = h.rows.filter((r) => r.ok).length
                      const f = h.rows.filter((r) => !r.ok && !r.skip).length
                      const s = h.rows.filter((r) => r.skip).length
                      return (
                        <div className="hist-item" key={h.ts}>
                          <div className="hist-meta">
                            <span className="hist-time">{fmtTime(h.ts)}</span>
                            <span className="hist-base">{h.baseUrl.replace(/^https?:\/\//, '')}</span>
                            <span className="hist-count">✓{p} ✗{f} ⊘{s} · 产物 {h.assets.length}</span>
                          </div>
                          <div className="hist-acts">
                            <button className="btn small" onClick={() => { setViewTs(h.ts); setCompareTs(null) }}>查看</button>
                            <button className="btn small ghost" disabled={!report} onClick={() => { setCompareTs(h.ts); setViewTs(null) }}>对比</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <table className="report-table">
                  <thead>
                    <tr>
                      <th>接口</th>
                      <th>结果</th>
                      <th>HTTP</th>
                      <th>耗时</th>
                      <th>服务端</th>
                      <th>输入</th>
                      <th>输出</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
                      <tr key={r.id} className={r.skip ? 'skip' : r.ok ? 'ok' : 'fail'}>
                        <td>
                          <code>{r.id}</code>
                          {/* 负向用例：把「期望什么」摆在结果旁边，方便一眼对照 */}
                          {r.expect && <div className="expect">{r.expect}</div>}
                        </td>
                        <td className={r.skip ? 'skip' : r.ok ? 'ok' : 'fail'}>{r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}</td>
                        <td>{r.status || '—'}</td>
                        <td>{r.ms ? `${r.ms}ms` : '—'}</td>
                        <td>{r.serverDuration != null ? `${r.serverDuration}s` : '—'}</td>
                        <td className="io">
                          {r.input ? (
                            <details>
                              <summary>请求体</summary>
                              <pre>{r.input}</pre>
                            </details>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="io">
                          {r.output ? (
                            <details>
                              <summary>响应体</summary>
                              <pre>{r.output}</pre>
                            </details>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="note">
                          {r.failures && r.failures.length > 0 ? (
                            <ul className="assert-fails">
                              {r.failures.map((f, i) => (
                                <li key={i}>{f}</li>
                              ))}
                            </ul>
                          ) : (
                            r.note
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 双击素材 → 灯箱放大 + 展示生成提示词 */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lb-inner" onClick={(e) => e.stopPropagation()}>
            <div className="lb-media">
              {lightbox.mediaType === 'image' && lightbox.url && <img src={lightbox.url} alt={lightbox.label} />}
              {lightbox.mediaType === 'video' && lightbox.url && <video src={lightbox.url} controls autoPlay loop />}
              {lightbox.mediaType === 'audio' && lightbox.url && <audio src={lightbox.url} controls autoPlay />}
            </div>
            <div className="lb-info">
              <div className="lb-row">
                <span className="lb-k">来源端点</span>
                <code>{lightbox.fromEndpoint}</code>
              </div>
              {lightbox.handle && (
                <div className="lb-row">
                  <span className="lb-k">句柄</span>
                  <code>{lightbox.handle}</code>
                </div>
              )}
              <div className="lb-row">
                <span className="lb-k">提示词</span>
                <div className="lb-prompt">{lightbox.prompt ? lightbox.prompt : '（无提示词；以图片为输入）'}</div>
              </div>
              {lightbox.url && (
                <div className="lb-row">
                  <span className="lb-k">URL</span>
                  <a className="lb-url" href={lightbox.url} target="_blank" rel="noreferrer">
                    {lightbox.url}
                  </a>
                </div>
              )}
            </div>
            <button className="lb-close" onClick={() => setLightbox(null)} title="关闭 (Esc)">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 内联 SVG 横向条形图：每个测试步一条，按 ok/fail 着色，标注耗时。无外部图表库。 */
function LatencyChart({ title, rows }: { title: string; rows: ReportRow[] }) {
  const data = rows.filter((r) => !r.skip && r.ms > 0)
  if (data.length === 0) return <div className="chart-title">{title}：无耗时数据</div>
  const max = Math.max(...data.map((r) => r.ms), 1)
  const rowH = 20
  const labelW = 122
  const barMax = 200
  const W = labelW + barMax + 70
  const H = data.length * rowH + 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 420, display: 'block' }} role="img" aria-label={`${title} 耗时图`}>
      <text x={0} y={12} fontSize={11} fill="#9aa0a8" fontWeight={600}>{title}</text>
      {data.map((r, i) => {
        const y = (i + 1) * rowH
        const w = Math.max(2, Math.round((r.ms / max) * barMax))
        const color = r.ok ? '#57c79a' : '#ff6b6b'
        return (
          <g key={r.id}>
            <text x={0} y={y + 13} fontSize={10} fill="#9aa0a8">{r.id}</text>
            <rect x={labelW} y={y + 3} width={w} height={13} rx={3} fill={color} />
            <text x={labelW + w + 5} y={y + 13} fontSize={10} fill="#e3e4e6">{r.ms}ms</text>
          </g>
        )
      })}
    </svg>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  onFile,
  onClearFile,
  onSample,
}: {
  field: FieldDef
  value: string
  onChange: (v: string) => void
  onFile: (f: File | null) => void
  onClearFile: () => void
  onSample: () => void
}) {
  if (field.type === 'file') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <input
          type="file"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
            onFile(f)
          }}
        />
        {field.hint && <div className="hint">{field.hint}</div>}
      </div>
    )
  }
  const hasSample = !field.characterDriven && typeof field.default === 'string' && field.default.length > 0
  return (
    <div className="field">
      <label>
        {field.label}
        {field.required && <span className="req">*</span>}
        {hasSample && (
          <button type="button" className="sample-btn" onClick={onSample} title="填入示例内容，可自由修改">
            填入示例
          </button>
        )}
      </label>
      {field.type === 'textarea' ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      )}
      {field.hint && <div className="hint">{field.hint}</div>}
    </div>
  )
}
