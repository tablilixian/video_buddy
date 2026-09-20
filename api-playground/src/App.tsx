import { useMemo, useState } from 'react'
import { ENDPOINTS, ENDPOINT_GROUPS, getEndpoint, type EndpointDef, type FieldDef } from './endpoints'
import { fetchToUpload, proxyCall, type CallResult } from './api'

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
}

interface ReportRow {
  id: string
  title: string
  ok: boolean
  skip?: boolean
  status: number
  ms: number
  note: string
}

function initialValues(ep: EndpointDef): Record<string, string> {
  const v: Record<string, string> = {}
  for (const f of ep.fields) {
    if (f.default !== undefined) v[f.key] = String(f.default)
    else v[f.key] = ''
  }
  return v
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE)
  const [selectedId, setSelectedId] = useState('health')
  const endpoint = useMemo(() => getEndpoint(selectedId)!, [selectedId])
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(getEndpoint('health')!))
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<CallResult | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [report, setReport] = useState<ReportRow[] | null>(null)

  function selectEndpoint(id: string) {
    const ep = getEndpoint(id)!
    setSelectedId(id)
    setValues(initialValues(ep))
    setFile(null)
    setResponse(null)
    setNotice(null)
  }

  function setField(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }))
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
        // 转存成功：更新素材为句柄类，并填入
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

  function pushAssetFromResult(r: CallResult, ep: EndpointDef) {
    const next: Asset[] = []
    if (r.handle) {
      next.push({
        id: crypto.randomUUID(),
        kind: 'handle',
        mediaType: null,
        label: r.handle,
        handle: r.handle,
        fromEndpoint: ep.id,
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
      })
    }
    if (next.length > 0) setAssets((list) => [...list, ...next])
  }

  /** 一键跑完全部接口（含「生成图→句柄→下游参考」串联），产出页内测试报告。 */
  async function runAll() {
    setBusy(true)
    setNotice(null)
    const rep: ReportRow[] = []
    const log = (id: string, title: string, r: CallResult, note?: string) =>
      rep.push({
        id,
        title,
        ok: r.ok,
        status: r.status,
        ms: r.ms,
        note: note ?? (r.ok ? 'OK' : String(r.text || 'fail').slice(0, 160)),
      })
    const step = async (id: string, title: string, fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (e) {
        // 已 log 过的步骤（先记录再抛错）不再重复入表
        if (!rep.some((x) => x.id === id)) rep.push({ id, title, ok: false, status: 0, ms: 0, note: String(e) })
      }
    }

    let handle: string | null = null
    let mediaUrl: string | null = null

    await step('health', '健康检查', async () => {
      const r = await proxyCall(baseUrl, getEndpoint('health')!, {}, null)
      log('health', '健康检查', r)
      if (!r.ok) throw new Error('后端不可达，后续用例跳过')
    })

    if (rep[0].ok) {
      await step('txt2image', '文生图', async () => {
        const ep = getEndpoint('txt2image')!
        const r = await proxyCall(baseUrl, ep, { prompt: 'a lone lighthouse on a cliff at dusk, cinematic, 35mm', aspectRatio: '16:9', resolution: '736p' }, null)
        log('txt2image', '文生图', r)
        pushAssetFromResult(r, ep)
        mediaUrl = r.mediaUrl
        if (!r.ok || !r.mediaUrl) throw new Error('未生成图')
      })

      await step('fetch-to-upload', '生成图 → 句柄', async () => {
        if (!mediaUrl) throw new Error('无图可转存')
        const { name } = await fetchToUpload(baseUrl, mediaUrl)
        handle = name
        log('fetch-to-upload', '生成图 → 句柄', { status: 0, ok: !!name, ms: 0, text: name, json: null, mediaUrl: null, mediaType: null, handle: name }, `句柄 ${name}`)
      })

      if (handle) {
        const h = handle
        await step('image2image', '图生图', async () => {
          const ep = getEndpoint('image2image')!
          const r = await proxyCall(baseUrl, ep, { prompt: 'same scene, moonlight version', aspectRatio: '16:9', resolution: '736p', image1: h }, null)
          log('image2image', '图生图', r)
          pushAssetFromResult(r, ep)
        })
        await step('image2character', '角色四视图', async () => {
          const r = await proxyCall(baseUrl, getEndpoint('image2character')!, { filename: h }, null)
          log('image2character', '角色四视图', r)
        })
        await step('image2fix', '图内文字修复', async () => {
          const r = await proxyCall(baseUrl, getEndpoint('image2fix')!, { prompt: 'add a subtle neon sign saying OPEN, keep font', filename: h }, null)
          log('image2fix', '图内文字修复', r)
        })
        await step('image2vl', '图片理解 VL', async () => {
          const r = await proxyCall(baseUrl, getEndpoint('image2vl')!, { filename: h, prompt: 'describe this image', system_prompt: '你是一位资深电影摄影指导。' }, null)
          log('image2vl', '图片理解 VL', r)
        })
        await step('videoFl2va', '首帧视频', async () => {
          const ep = getEndpoint('videoFl2va')!
          const r = await proxyCall(baseUrl, ep, { prompt: 'slow camera push in', aspectRatio: '16:9', resolution: '736p', duration: '5', image1: h }, null)
          log('videoFl2va', '首帧视频', r)
          pushAssetFromResult(r, ep)
        })
      } else {
        for (const [id, t] of [['image2image', '图生图'], ['image2character', '角色四视图'], ['image2fix', '图内文字修复'], ['image2vl', '图片理解 VL'], ['videoFl2va', '首帧视频']] as const) {
          rep.push({ id, title: t, ok: false, skip: true, status: 0, ms: 0, note: '缺少句柄，跳过' })
        }
      }

      await step('promptEnhance', '提示词增强', async () => {
        const r = await proxyCall(baseUrl, getEndpoint('promptEnhance')!, { prompt: 'a cat sitting on a windowsill, morning light' }, null)
        log('promptEnhance', '提示词增强', r)
      })
      await step('txt2audio', '文生音频', async () => {
        const r = await proxyCall(baseUrl, getEndpoint('txt2audio')!, { caption_prompt: 'calm ocean waves ambience', lyrics_prompt: '', duration: '5' }, null)
        log('txt2audio', '文生音频', r)
      })
    }

    rep.push({ id: 'upload', title: '上传文件（拿句柄）', ok: false, skip: true, status: 0, ms: 0, note: '需手动选文件，页内批量测试跳过；请单独用「上传文件」端点' })
    setReport([...rep])
    setBusy(false)
  }

  async function send() {
    setBusy(true)
    setNotice(null)
    try {
      const r = await proxyCall(baseUrl, endpoint, values, file)
      setResponse(r)
      pushAssetFromResult(r, endpoint)
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
        <button className="btn small" onClick={runAll} disabled={busy}>
          {busy ? '测试中…' : '运行全部接口 · 生成测试报告'}
        </button>
        <span className="tag">同源代理绕过 CORS</span>
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
            <FieldInput key={f.key} field={f} value={values[f.key] || ''} onChange={(v) => setField(f.key, v)} onFile={(fl) => setFile(fl)} onClearFile={() => setFile(null)} />
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
              点素材「用作输入」可填入下一步的参考字段，整条链路即串起来。
            </p>
          )}
        </div>

        <div className="right">
          <div className="section-title">
            素材库 <span className="count">{assets.length}</span>
          </div>
          <div className="assets">
            {assets.length === 0 && <div className="empty">暂无素材。生成结果会自动入库。</div>}
            {assets.map((a) => (
              <div className="asset" key={a.id}>
                {a.mediaType === 'image' && a.url && <img src={a.url} alt={a.label} />}
                {a.mediaType === 'video' && a.url && <video src={a.url} controls preload="metadata" />}
                {a.mediaType === 'audio' && a.url && <audio src={a.url} controls />}
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

          {report && (
            <>
              <div className="section-title">
                测试报告
                <span className="count">
                  通过 {report.filter((r) => r.ok).length} · 失败 {report.filter((r) => !r.ok && !r.skip).length} · 跳过 {report.filter((r) => r.skip).length}
                </span>
                <button className="btn small ghost close" onClick={() => setReport(null)}>
                  关闭
                </button>
              </div>
              <div className="report">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>接口</th>
                      <th>结果</th>
                      <th>HTTP</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.map((r) => (
                      <tr key={r.id} className={r.skip ? 'skip' : r.ok ? 'ok' : 'fail'}>
                        <td>
                          <code>{r.id}</code>
                        </td>
                        <td className={r.skip ? 'skip' : r.ok ? 'ok' : 'fail'}>{r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}</td>
                        <td>{r.status || '—'}</td>
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
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  onFile,
  onClearFile,
}: {
  field: FieldDef
  value: string
  onChange: (v: string) => void
  onFile: (f: File | null) => void
  onClearFile: () => void
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
  return (
    <div className="field">
      <label>
        {field.label}
        {field.required && <span className="req">*</span>}
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
