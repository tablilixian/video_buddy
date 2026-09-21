import { useEffect, useMemo, useState } from 'react'
import {
  CHARACTER_PRESETS,
  ENDPOINTS,
  ENDPOINT_GROUPS,
  getEndpoint,
  HANDLE_DEPENDENT,
  SAMPLES,
  VIDEO_ENDPOINTS,
  type EndpointDef,
  type FieldDef,
} from './endpoints'
import { fetchMediaBytes, fetchToUpload, proxyCall, type CallResult } from './api'

const DEFAULT_BASE = 'http://117.50.108.73:8082'

type AssetKind = 'handle' | 'url'
interface Asset {
  id: string
  kind: AssetKind
  mediaType: 'image' | 'video' | 'audio' | null
  label: string
  url?: string
  handle?: string
  fromEndpoint: string
  /** 生成该产物所用的提示词（双击放大时展示）。 */
  prompt?: string
}

interface ReportRow {
  id: string
  title: string
  ok: boolean
  skip?: boolean
  status: number
  ms: number
  note: string
  /** 该步实际发出的请求体（或说明），用于回看每次输入。 */
  input?: string
  /** 该步实际拿到的响应（截断），用于回看每次输出。 */
  output?: string
  /** 后端返回的 duration（服务端生成耗时，秒），非媒体时长。 */
  serverDuration?: number
}

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

function initialValues(ep: EndpointDef, character: string): Record<string, string> {
  const v: Record<string, string> = {}
  for (const f of ep.fields) {
    if (f.characterDriven) v[f.key] = character
    else if (f.default !== undefined) v[f.key] = String(f.default)
    else v[f.key] = ''
  }
  return v
}

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
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(getEndpoint('health')!, CHARACTER_PRESETS[0].value))
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

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  // 角色变更时，同步到当前端点的「角色驱动」字段（保证表单与全局角色一致）。
  useEffect(() => {
    if (!endpoint.fields.some((f) => f.characterDriven)) return
    setValues((v) => {
      let changed = false
      const next = { ...v }
      for (const f of endpoint.fields) {
        if (f.characterDriven && next[f.key] !== character) {
          next[f.key] = character
          changed = true
        }
      }
      return changed ? next : v
    })
  }, [character, endpoint])

  // Esc 关闭灯箱
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const viewRec = viewTs != null ? history.find((h) => h.ts === viewTs) ?? null : null
  const displayRows = viewRec ? viewRec.rows : report
  const displayAssets = viewRec ? viewRec.assets : runAssets

  function selectEndpoint(id: string) {
    const ep = getEndpoint(id)!
    setSelectedId(id)
    setValues(initialValues(ep, character))
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
      try {
        const { name } = await fetchToUpload(baseUrl, a.url)
        setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, kind: 'handle', handle: name } : x)))
        fillFirstEmptyRef(name)
      } catch (e) {
        setNotice(`转存失败：${String(e)}`)
      } finally {
        setBusy(false)
      }
    }
  }

  async function convertAsset(a: Asset) {
    if (a.kind === 'url' && a.url) {
      setBusy(true)
      try {
        const { name } = await fetchToUpload(baseUrl, a.url)
        setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, kind: 'handle', handle: name } : x)))
        setNotice('已转存为句柄，可直接用作输入。')
      } catch (e) {
        setNotice(`转存失败：${String(e)}`)
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

  /** 只跑选中的端点；缺前置（生成图 / 上传句柄）时自动补跑并标注。 */
  async function runSelected(ids: Set<string>) {
    if (ids.size === 0) {
      setNotice('没有勾选任何端点。点「选择端点」勾选后再运行。')
      return
    }
    setBusy(true)
    setNotice(null)
    const rep: ReportRow[] = []
    const collected: Asset[] = []
    const trunc = (s: string, n = 1600) => (s.length > n ? `${s.slice(0, n)}\n…(已省略 ${s.length - n} 字)` : s)

    // —— 依赖解析：勾了需要句柄的端点（或 upload）时，自动前置 txt2image + upload ——
    const effective = new Set(ids)
    const prereq: string[] = []
    const addPrereq = (id: string) => {
      if (!effective.has(id)) {
        effective.add(id)
        prereq.push(id)
      }
    }
    const needsHandle = HANDLE_DEPENDENT.some((id) => effective.has(id))
    if (needsHandle) addPrereq('upload')
    if (needsHandle || effective.has('upload')) addPrereq('txt2image')
    const want = (id: string) => effective.has(id)
    const pre = (id: string) => (prereq.includes(id) ? '（自动前置：供下游取句柄）' : '')

    const log = (id: string, title: string, r: CallResult, note?: string, input?: string, output?: string) => {
      const j = r.json as Record<string, unknown> | null
      const sd = j && typeof j.duration === 'number' ? (j.duration as number) : undefined
      rep.push({
        id,
        title,
        ok: r.ok,
        status: r.status,
        ms: r.ms,
        note: note ?? (r.ok ? 'OK' : String(r.text || 'fail').slice(0, 160)),
        input,
        output: output ? trunc(output) : undefined,
        serverDuration: sd,
      })
    }
    const step = async (id: string, title: string, fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (e) {
        if (!rep.some((x) => x.id === id)) {
          rep.push({ id, title, ok: false, status: 0, ms: 0, note: String(e), input: undefined, output: undefined })
        }
      }
    }

    let backendOk = true
    let handle: string | null = null
    let mediaUrl: string | null = null

    // 健康检查：无论是否勾选都作为可达性前置，但仅在勾选时计入报告。
    await step('health', '健康检查', async () => {
      const r = await proxyCall(baseUrl, getEndpoint('health')!, {}, null)
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
          const v = { prompt: character, aspectRatio: '16:9', resolution: '736p' }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('txt2image', '文生图', r, pre('txt2image') || undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, character))
          mediaUrl = r.mediaUrl
          if (!r.ok || !r.mediaUrl) throw new Error('未生成图')
        })
      }

      if (want('upload')) {
        await step('upload', '上传文件（自动）', async () => {
          if (!mediaUrl) throw new Error('无图可上传')
          const blob = await fetchMediaBytes(baseUrl, mediaUrl)
          const f = new File([blob], 'gen.png', { type: blob.type || 'image/png' })
          const ep = getEndpoint('upload')!
          const r = await proxyCall(baseUrl, ep, {}, f)
          log('upload', '上传文件（自动）', r, (r.handle ? `句柄 ${r.handle}` : '未返回 name') + pre('upload'), `multipart: file=gen.png (${blob.size}B)`, r.text)
          if (!r.ok || !r.handle) throw new Error('上传未拿到句柄')
          handle = r.handle
        })
      }

      if (want('txt2imageanime')) {
        await step('txt2imageanime', '卡通文生图', async () => {
          const ep = getEndpoint('txt2imageanime')!
          const v = { prompt: character, aspectRatio: '16:9', resolution: '736p' }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('txt2imageanime', '卡通文生图', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, character))
        })
      }

      const handleSteps = HANDLE_DEPENDENT.filter((id) => want(id))
      if (handle) {
        const h = handle
        const runIf = async (id: string, title: string, fn: () => Promise<void>) => {
          if (want(id)) await step(id, title, fn)
        }
        await runIf('image2image', '图生图', async () => {
          const ep = getEndpoint('image2image')!
          const v = { prompt: SAMPLES.image2image, aspectRatio: '16:9', resolution: '736p', image1: h }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('image2image', '图生图', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, SAMPLES.image2image))
        })
        await runIf('image2character', '角色四视图', async () => {
          const ep = getEndpoint('image2character')!
          const v = { filename: h }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('image2character', '角色四视图', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep))
        })
        await runIf('image2fix', '图内文字修复', async () => {
          const ep = getEndpoint('image2fix')!
          const v = { prompt: 'add a subtle neon sign saying OPEN, keep font', filename: h }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('image2fix', '图内文字修复', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, v.prompt))
        })
        await runIf('image2vl', '图片理解 VL', async () => {
          const ep = getEndpoint('image2vl')!
          const v = { filename: h, prompt: 'describe this image', system_prompt: '你是一位资深电影摄影指导。' }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('image2vl', '图片理解 VL', r, undefined, JSON.stringify(v), r.text)
        })
        await runIf('videoFl2va', '首帧视频', async () => {
          const ep = getEndpoint('videoFl2va')!
          const v = { prompt: 'slow camera push in', aspectRatio: '16:9', resolution: '736p', duration: '5', image1: h }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('videoFl2va', '首帧视频', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, v.prompt))
        })
        await runIf('videoRef2va', '多参考图视频', async () => {
          const ep = getEndpoint('videoRef2va')!
          const v = { prompt: 'keep character consistent', aspectRatio: '16:9', resolution: '736p', duration: '5', image1: h }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('videoRef2va', '多参考图视频', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, v.prompt))
        })
      } else {
        for (const id of handleSteps) {
          rep.push({ id, title: getEndpoint(id)!.title, ok: false, skip: true, status: 0, ms: 0, note: '缺少句柄（上传失败），跳过' })
        }
      }

      if (want('promptEnhance')) {
        await step('promptEnhance', '提示词增强', async () => {
          const ep = getEndpoint('promptEnhance')!
          const v = { prompt: 'a cat sitting on a windowsill, morning light' }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('promptEnhance', '提示词增强', r, undefined, JSON.stringify(v), r.text)
        })
      }
      if (want('txt2audio')) {
        await step('txt2audio', '文生音频', async () => {
          const ep = getEndpoint('txt2audio')!
          const v = { caption_prompt: 'calm ocean waves ambience', lyrics_prompt: '', duration: '5' }
          const r = await proxyCall(baseUrl, ep, v, null)
          log('txt2audio', '文生音频', r, undefined, JSON.stringify(v), r.text)
          collected.push(...pushAssetFromResult(r, ep, v.caption_prompt))
        })
      }
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
    setBusy(false)
  }

  async function send() {
    setBusy(true)
    setNotice(null)
    try {
      const r = await proxyCall(baseUrl, endpoint, values, file)
      setResponse(r)
      pushAssetFromResult(r, endpoint, values.prompt || values.caption_prompt)
      if (!r.ok) setNotice(`请求返回 ${r.status}，查看右侧响应体。`)
    } catch (e) {
      setResponse({
        status: 0,
        ok: false,
        ms: 0,
        text: String(e),
        json: null,
        mediaUrl: null,
        mediaType: null,
        handle: null,
      })
      setNotice(`调用失败：${String(e)}`)
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
        <button className="btn small" onClick={() => runSelected(new Set(ALL_IDS))} disabled={busy}>
          {busy ? '测试中…' : '运行全部接口'}
        </button>
        <span className="tag">同源代理绕过 CORS</span>
      </div>

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
            <button className="btn ghost" onClick={() => selectEndpoint(selectedId)} disabled={busy}>
              重置表单
            </button>
          </div>

          {endpoint.id === 'health' && (
            <p className="form-sub" style={{ marginTop: 16 }}>
              提示：先点「健康检查」确认后端可达，再调生成端点。生成图/视频会自动进右侧素材库；
              点素材「用作输入」可填入下一步的参考字段。顶栏「选择端点」可勾选只跑其中几项，
              「运行全部接口」会自动跑完整链路（含自动上传拿句柄），并记录每步输入/输出/耗时与产物，存为历史可对比。
            </p>
          )}
        </div>

        <div className="right">
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
                </div>
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
                        <td className="note">{r.note}</td>
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
