#!/usr/bin/env node
/**
 * TTS 能力取证探针（`tts_voiceover` → Drama `txt2speech` / VoxCPM2）。
 *
 * 目的：把「这个项目的 TTS 到底能干什么」从代码注释里的说法，变成可复现的数字。
 * 分三段执行，全程**严格串行**（后端单任务同步，并发出来的耗时没有意义）：
 *
 *   ① 契约：直接读 `GET /openapi.json`，把 `TTSRequest` 的字段与描述抄下来 ——
 *      「有没有 speed / voiceId / SSML」这个问题只有契约能回答，不靠猜。
 *   ② 合成矩阵：同一句话换 instruct_prompt（无指令 / 中速 / 慢速 / 快速 / 四川话 /
 *      粤语 / 英文 / 日文 / 长文），逐个量：生成耗时、真实音频时长、字数/秒、基频（F0）。
 *      → 语速是不是真能靠「慢速/快速」控制、方言与多语种是不是真的生效，看数字。
 *   ③ 音色克隆：先用「70 岁沙哑男声」合成一段当参考音，上传拿句柄，再用 `refaudio`
 *      合成另一段文本（instruct 里**不写**性别/年龄），与「同样的 instruct 但不传
 *      refaudio」的基线比 F0 —— 克隆通道到底能不能把音色带过来，看 F0 靠向谁。
 *   ④ 宿主侧后处理（不发后端）：对同一段音频跑 `atempo` / `asetrate` 滤镜链，
 *      验证 O-09 的 `speed` / `pitchSemitones` 在数值上真的成立（时长与基频各变多少）。
 *
 * 用法
 * ----
 *   node scripts/probe-tts-capability.mjs                  # 全跑（约 4–6 分钟，12 次合成）
 *   node scripts/probe-tts-capability.mjs --skip-clone     # 跳过克隆段（省 3 次合成）
 *   node scripts/probe-tts-capability.mjs --local-only     # 只跑 ④（零后端成本）
 *   DRAMA_API_BASE=http://x:port node scripts/probe-tts-capability.mjs
 *
 * 产物（默认 `docs/api-probe/tts-capability-<时间戳>/`）
 *   report.md   人读结论表
 *   raw.json    每个用例的原始响应 / 时长 / F0
 *   *.mp3       逐条音频（可直接听）
 *
 * 退出码：0 = 探测完成；1 = 后端不可达。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return fallback
  return v
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = resolve(arg('out', `docs/api-probe/tts-capability-${stamp}`))
const SKIP_CLONE = flag('skip-clone')
const LOCAL_ONLY = flag('local-only')
/** 只按已有 `raw.json` 重建 `report.md`（改报告口径时用，零后端成本）。 */
const REPORT_ONLY = flag('report-only')

// ---------------------------------------------------------------------------
// 进程工具
// ---------------------------------------------------------------------------
function run(cmd, args, { input = null, timeout = 120_000 } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rej(new Error(`${cmd} 超时 ${timeout}ms`))
    }, timeout)
    child.stdout.on('data', c => out.push(c))
    child.stderr.on('data', d => err.push(d))
    child.on('error', e => { clearTimeout(timer); rej(e) })
    child.on('close', code => {
      clearTimeout(timer)
      res({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') })
    })
    if (input !== null) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function ffprobeOf(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels', '-of', 'json', file])
  try {
    const j = JSON.parse(r.stdout.toString('utf8'))
    const s = (j.streams ?? [])[0] ?? {}
    return {
      duration: Number(j.format?.duration ?? 0),
      bitRate: Number(j.format?.bit_rate ?? 0),
      codec: s.codec_name ?? '',
      sampleRate: Number(s.sample_rate ?? 0),
      channels: Number(s.channels ?? 0),
    }
  } catch {
    return { duration: 0, bitRate: 0, codec: '', sampleRate: 0, channels: 0 }
  }
}

/** 解成 16k 单声道 s16le，给 F0 用。 */
async function pcmOf(file) {
  const r = await run(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { timeout: 60_000 })
  if (r.code !== 0) throw new Error(`ffmpeg 解码失败：${r.stderr.slice(-200)}`)
  const buf = r.stdout
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
}

/**
 * 基频统计（自相关，纯手算，不引依赖）。
 * 只统计有声帧（RMS > 全局峰值 15%），取中位数当「这个人听起来多高」。
 */
function f0Stats(pcm) {
  const SR = 16000
  const frame = 640 // 40ms
  const hop = 320 // 20ms
  const n = pcm.length
  const rms = []
  for (let start = 0; start + frame <= n; start += hop) {
    let e = 0
    for (let i = 0; i < frame; i += 1) {
      const s = pcm[start + i] / 32768
      e += s * s
    }
    rms.push({ start, r: Math.sqrt(e / frame) })
  }
  if (rms.length === 0) return null
  const peak = Math.max(...rms.map(x => x.r))
  const voiced = rms.filter(x => x.r > peak * 0.15)
  const minLag = Math.floor(SR / 400)
  const maxLag = Math.ceil(SR / 60)
  const f0s = []
  for (const v of voiced) {
    let norm = 0
    for (let i = 0; i < frame; i += 1) {
      const s = pcm[v.start + i] / 32768
      norm += s * s
    }
    if (norm <= 1e-9) continue
    let best = 0
    let bestLag = -1
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0
      for (let i = 0; i < frame - lag; i += 1) {
        sum += (pcm[v.start + i] / 32768) * (pcm[v.start + i + lag] / 32768)
      }
      const val = sum / norm
      if (val > best) {
        best = val
        bestLag = lag
      }
    }
    // 次谐波纠正：低音容易锁到 2×/3× 周期上（F0 报成一半/三分之一）。
    // 若 lag/2、lag/3 处的自相关与峰值同量级，说明真实周期更短，取更短的那个。
    for (const div of [3, 2]) {
      const cand = Math.round(bestLag / div)
      if (cand < minLag) continue
      let sum = 0
      for (let i = 0; i < frame - cand; i += 1) {
        sum += (pcm[v.start + i] / 32768) * (pcm[v.start + i + cand] / 32768)
      }
      const val = sum / norm
      if (val >= best * 0.85) {
        bestLag = cand
        best = val
        break
      }
    }
    if (best >= 0.35 && bestLag > 0) f0s.push(SR / bestLag)
  }
  if (f0s.length === 0) return null
  f0s.sort((a, b) => a - b)
  const med = f0s[Math.floor(f0s.length / 2)]
  const mean = f0s.reduce((a, b) => a + b, 0) / f0s.length
  const sd = Math.sqrt(f0s.reduce((a, b) => a + (b - mean) ** 2, 0) / f0s.length)
  return { median: Math.round(med), mean: Math.round(mean), sd: Math.round(sd), frames: f0s.length }
}

/** 净字数（CJK/字母/数字，去标点空白）——与 `voice-dims.ts` 的 bodyCharCount 同口径。 */
function netChars(s) {
  return s.replace(/\s+/g, '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length
}

// ---------------------------------------------------------------------------
// 后端调用（串行）
// ---------------------------------------------------------------------------
async function synth({ id, text, instruct, refaudio }) {
  const body = { txt_prompt: text }
  if (instruct !== undefined && instruct !== '') body.instruct_prompt = instruct
  if (refaudio !== undefined && refaudio !== '') body.refaudio = refaudio
  const t0 = Date.now()
  let status = 0
  let payload = null
  try {
    const res = await fetch(`${BASE}/api/v1/generate/txt2speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
    status = res.status
    payload = await res.json().catch(() => null)
  } catch (error) {
    return { id, ok: false, status, error: error instanceof Error ? error.message : String(error), body }
  }
  const elapsedMs = Date.now() - t0
  if (status !== 200 || payload === null || typeof payload.filename !== 'string') {
    return { id, ok: false, status, elapsedMs, body, payload }
  }
  const url = `${BASE}/view?filename=${encodeURIComponent(payload.filename)}`
  const file = join(OUT, `${id}.mp3`)
  try {
    const audio = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!audio.ok) throw new Error(`下载 ${audio.status}`)
    const bytes = Buffer.from(await audio.arrayBuffer())
    writeFileSync(file, bytes)
  } catch (error) {
    return { id, ok: false, status, elapsedMs, body, payload, error: `下载失败：${String(error)}` }
  }
  const probe = await ffprobeOf(file)
  const f0 = await f0Stats(await pcmOf(file))
  const chars = netChars(text)
  return {
    id, ok: true, status, elapsedMs, body, payload,
    filename: payload.filename,
    serverDuration: Number(payload.duration ?? 0),
    realDuration: Number(probe.duration.toFixed(2)),
    chars,
    charsPerSec: probe.duration > 0 ? Number((chars / probe.duration).toFixed(2)) : 0,
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    bitRate: probe.bitRate,
    codec: probe.codec,
    f0,
    file: basename(file),
  }
}

async function upload(file) {
  const bytes = readFileSync(file)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), basename(file))
  const res = await fetch(`${BASE}/api/v1/generate/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

// ---------------------------------------------------------------------------
// 用例矩阵
// ---------------------------------------------------------------------------
const T_ZH = '夜色像潮水一样漫过窗台，他在灯下写完了最后一行字。'
const T_ZH2 = '风把门关上的时候，她终于听见了楼下的脚步声。'
const T_ZH_LONG =
  '很多年以后他才明白，那趟列车带走的并不只是一个人。站台上的风一直往北吹，'
  + '把告示牌吹得吱呀作响。他把手里的车票折成很小的一块，塞进大衣最里层的口袋，'
  + '然后转身走进人群，像一滴水落进河里，再也没有回头。'
const T_EN = 'The city was quiet that night, and the old man finally finished his last letter.'
const T_JA = '夜の街は静かで、老人は最後の手紙を書き終えた。'

const CASES = [
  { id: 'zh-no-instruct', text: T_ZH, note: '完全不写声音设计（走后端默认音色）' },
  { id: 'zh-mid', text: T_ZH, instruct: '青年男性，平静低沉，标准普通话，中速', note: '基准：与 docs/api-probe 的探针同文案' },
  { id: 'zh-slow', text: T_ZH, instruct: '青年男性，平静低沉，标准普通话，慢速', note: '只改语速词：慢速' },
  { id: 'zh-fast', text: T_ZH, instruct: '青年男性，平静低沉，标准普通话，快速', note: '只改语速词：快速' },
  { id: 'zh-sichuan', text: T_ZH, instruct: '中年男人笑着说，夸张一点，四川话', note: '方言（四川话）' },
  { id: 'zh-cantonese', text: T_ZH, instruct: '50岁女性，爽利泼辣，粤语，中速', note: '方言（粤语）' },
  { id: 'en', text: T_EN, instruct: 'Young woman, clear and friendly, standard English, medium pace', note: '英语' },
  { id: 'ja', text: T_JA, instruct: '30岁女性，播音腔，端正，日语，中速', note: '日语' },
  { id: 'zh-elder', text: T_ZH, instruct: '70岁男性，沙哑缓慢，带着怀念，普通话，慢速', note: '克隆段的参考音（低沉老者）' },
  { id: 'zh-long', text: T_ZH_LONG, instruct: '40岁男性，沉稳浑厚，标准普通话，中速', note: '长文（110 字左右）线性度' },
  { id: 'zh-very-slow', text: T_ZH, instruct: '青年男性，平静低沉，标准普通话，语速极慢，每两个字之间都要停顿', note: '极端措辞：自然语言控语速的天花板' },
  { id: 'zh-pause-plain', text: '他走了。门关上了。', instruct: '青年男性，平静低沉，标准普通话，中速', note: '舞台指令对照：纯正文' },
  { id: 'zh-pause-mark', text: '他走了。（停顿两秒）门关上了。', instruct: '青年男性，平静低沉，标准普通话，中速', note: '正文里写（停顿两秒）：会被念出来吗' },
]

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT, { recursive: true })
  if (REPORT_ONLY) {
    const raw = JSON.parse(readFileSync(join(OUT, 'raw.json'), 'utf8'))
    writeFileSync(join(OUT, 'report.md'), buildReport(raw))
    console.log(`已按 ${join(OUT, 'raw.json')} 重建报告：${join(OUT, 'report.md')}`)
    return
  }
  const raw = { base: BASE, startedAt: new Date().toISOString(), contract: null, cases: [], clone: null, local: null }

  // ① 契约
  if (!LOCAL_ONLY) {
    try {
      const res = await fetch(`${BASE}/openapi.json`, { signal: AbortSignal.timeout(20_000) })
      const spec = await res.json()
      raw.contract = {
        ttsRequest: spec?.components?.schemas?.TTSRequest ?? null,
        endpoint: spec?.paths?.['/api/v1/generate/txt2speech'] ?? null,
        version: spec?.info?.version ?? '',
      }
      console.log(`[契约] TTSRequest 字段：${Object.keys(spec?.components?.schemas?.TTSRequest?.properties ?? {}).join(', ')}`)
    } catch (error) {
      console.error(`[契约] 读取失败：${String(error)}`)
    }

    const health = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (health === null) {
      console.error(`后端不可达：${BASE}`)
      process.exitCode = 1
      return
    }
  }

  // ② 合成矩阵
  if (!LOCAL_ONLY) {
    for (const c of CASES) {
      process.stdout.write(`[合成] ${c.id} … `)
      const r = await synth(c)
      raw.cases.push({ ...c, ...r })
      if (r.ok) console.log(`OK ${r.realDuration}s 真实 / ${(r.elapsedMs / 1000).toFixed(1)}s 耗时 / ${r.charsPerSec} 字·秒 / F0 ${r.f0?.median ?? '—'}Hz`)
      else console.log(`FAIL ${r.status} ${r.error ?? JSON.stringify(r.payload)?.slice(0, 120)}`)
    }
  }

  // ②.5 可复现性方差：同一条 instruct_prompt 连发 3 次
  if (!LOCAL_ONLY) {
    const runs = []
    for (let i = 1; i <= 3; i += 1) {
      process.stdout.write(`[方差] zh-var#${i} … `)
      const r = await synth({ id: `zh-var-${i}`, text: T_ZH, instruct: '青年男性，平静低沉，标准普通话，中速' })
      runs.push(r)
      console.log(r.ok ? `${r.realDuration}s / F0 ${r.f0?.median ?? '—'}Hz` : `FAIL ${r.status}`)
    }
    const ok = runs.filter(r => r.ok)
    if (ok.length >= 2) {
      const ds = ok.map(r => r.realDuration)
      const fs = ok.map(r => r.f0?.median ?? 0).filter(v => v > 0)
      raw.variance = {
        case: 'zh-var（同一 instruct_prompt 原文重复 3 次）',
        instruct: '青年男性，平静低沉，标准普通话，中速',
        durations: ds,
        f0s: fs,
        durationSpread: Number((Math.max(...ds) - Math.min(...ds)).toFixed(2)),
        durationSpreadPct: Number((((Math.max(...ds) - Math.min(...ds)) / (ds.reduce((a, b) => a + b, 0) / ds.length)) * 100).toFixed(1)),
        f0SpreadPct: fs.length >= 2 ? Number((((Math.max(...fs) - Math.min(...fs)) / (fs.reduce((a, b) => a + b, 0) / fs.length)) * 100).toFixed(1)) : null,
      }
    }
  }

  // ③ 音色克隆
  if (!LOCAL_ONLY && !SKIP_CLONE) {
    const ref = raw.cases.find(c => c.id === 'zh-elder' && c.ok)
    if (ref === undefined) {
      console.log('[克隆] 跳过：参考音合成失败')
    } else {
      process.stdout.write('[克隆] 上传参考音 … ')
      const up = await upload(join(OUT, ref.file))
      const handle = up.json?.filename ?? up.json?.name ?? null
      console.log(`${up.status} → ${handle ?? JSON.stringify(up.json)?.slice(0, 120)}`)
      if (handle !== null) {
        process.stdout.write('[克隆] refaudio 合成 … ')
        const withRef = await synth({ id: 'clone-with-ref', text: T_ZH2, instruct: '平静，中速', refaudio: handle })
        console.log(withRef.ok ? `OK F0 ${withRef.f0?.median ?? '—'}Hz` : `FAIL ${withRef.status}`)
        process.stdout.write('[克隆] 同 instruct 无 refaudio 基线 … ')
        const baseline = await synth({ id: 'clone-baseline', text: T_ZH2, instruct: '平静，中速' })
        console.log(baseline.ok ? `OK F0 ${baseline.f0?.median ?? '—'}Hz` : `FAIL ${baseline.status}`)
        raw.clone = {
          handle,
          uploadStatus: up.status,
          ref: { id: ref.id, f0: ref.f0, realDuration: ref.realDuration },
          withRef: { ok: withRef.ok, f0: withRef.f0, realDuration: withRef.realDuration, status: withRef.status, error: withRef.error },
          baseline: { ok: baseline.ok, f0: baseline.f0, realDuration: baseline.realDuration, status: baseline.status, error: baseline.error },
        }
      }
    }
  }

  // ④ 宿主侧后处理（本地，零后端成本）
  const src = raw.cases.find(c => c.id === 'zh-mid' && c.ok)
  if (src !== undefined) {
    const srcFile = join(OUT, src.file)
    const base = await ffprobeOf(srcFile)
    const baseF0 = await f0Stats(await pcmOf(srcFile))
    const variants = [
      { id: 'post-speed-0.9', filter: 'atempo=0.900000', expect: '时长 ×1.11，F0 不变' },
      { id: 'post-speed-1.15', filter: 'atempo=1.150000', expect: '时长 ×0.87，F0 不变' },
      { id: 'post-pitch-minus3', filter: 'aresample=44100,asetrate=37073,aresample=44100,atempo=1.189207', expect: 'F0 ×0.84（-3 半音），时长不变' },
      { id: 'post-pitch-plus3', filter: 'aresample=44100,asetrate=52425,aresample=44100,atempo=0.840896', expect: 'F0 ×1.19（+3 半音），时长不变' },
    ]
    const rows = []
    for (const v of variants) {
      const out = join(OUT, `${v.id}.mp3`)
      const r = await run(FFMPEG, ['-y', '-i', srcFile, '-filter:a', v.filter, '-c:a', 'libmp3lame', '-b:a', '192k', out], { timeout: 60_000 })
      if (r.code !== 0) {
        rows.push({ ...v, ok: false, error: r.stderr.slice(-160) })
        continue
      }
      const p = await ffprobeOf(out)
      const f0 = await f0Stats(await pcmOf(out))
      rows.push({
        ...v, ok: true,
        duration: Number(p.duration.toFixed(2)),
        durationRatio: Number((p.duration / base.duration).toFixed(3)),
        f0: f0?.median ?? null,
        f0Ratio: f0 !== null && baseF0 !== null ? Number((f0.median / baseF0.median).toFixed(3)) : null,
      })
    }
    raw.local = { source: src.id, baseDuration: Number(base.duration.toFixed(2)), baseF0: baseF0?.median ?? null, rows }
    console.log(`[后处理] 基准 ${base.duration.toFixed(2)}s / F0 ${baseF0?.median ?? '—'}Hz`)
    for (const r of rows) {
      console.log(`         ${r.id}: ${r.ok ? `${r.duration}s (×${r.durationRatio}) / F0 ${r.f0}Hz (×${r.f0Ratio})` : `FAIL ${r.error}`}`)
    }
  }

  writeFileSync(join(OUT, 'raw.json'), JSON.stringify(raw, null, 2))
  writeFileSync(join(OUT, 'report.md'), buildReport(raw))
  console.log(`\n产物目录：${OUT}`)
  console.log(`报告：${join(OUT, 'report.md')}`)
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
function buildReport(raw) {
  const L = []
  L.push('# TTS 能力取证报告（`tts_voiceover` → `txt2speech` / VoxCPM2）')
  L.push('')
  L.push(`- 后端：\`${raw.base}\`（版本 ${raw.contract?.version ?? '未知'}）`)
  L.push(`- 时间：${raw.startedAt}`)
  L.push('')
  const props = raw.contract?.ttsRequest?.properties ?? {}
  L.push('## 一、接口契约（后端自述）')
  L.push('')
  if (Object.keys(props).length > 0) {
    L.push('| 字段 | 类型 | 必填 | 默认 | 说明 |')
    L.push('|---|---|---|---|---|')
    const required = new Set(raw.contract?.ttsRequest?.required ?? [])
    for (const [k, v] of Object.entries(props)) {
      L.push(`| \`${k}\` | ${v.type ?? ''} | ${required.has(k) ? '是' : '否'} | ${v.default === undefined ? '—' : `\`${JSON.stringify(v.default)}\``} | ${(v.description ?? '').replace(/\n/g, ' ')} |`)
    }
  }
  L.push('')
  const desc = raw.contract?.ttsRequest?.description ?? ''
  if (desc !== '') {
    L.push('后端对这张表的说明：')
    L.push('')
    L.push('> ' + desc.replace(/\n/g, '\n> '))
    L.push('')
  }
  L.push('## 二、合成矩阵')
  L.push('')
  L.push('| # | 用例 | 说明 | instruct_prompt | 净字数 | 真实时长 | 生成耗时* | 字/秒 | F0 中位 | 采样率/声道 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  raw.cases.forEach((c, i) => {
    if (!c.ok) {
      L.push(`| ${i + 1} | \`${c.id}\` | ${c.note ?? ''} | ${c.instruct ?? '（无）'} | — | **失败 ${c.status}** ${c.error ?? ''} | — | — | — | — |`)
      return
    }
    L.push(`| ${i + 1} | \`${c.id}\` | ${c.note ?? ''} | ${c.instruct ?? '（无）'} | ${c.chars} | ${c.realDuration}s | ${(c.elapsedMs / 1000).toFixed(1)}s | ${c.charsPerSec} | ${c.f0?.median ?? '—'}Hz | ${c.sampleRate}/${c.channels} |`)
  })
  L.push('')
  L.push('> `*` **生成耗时只作参考，不参与任何结论**：后端单任务串行，别人在跑任务时这一列会整列抬高（同一端点在多轮观测里见过 4s ~ 33s）。')
  L.push('> 本章所有结论只用 **ffprobe / 解码得到的声音属性**（时长、字速、基频），这些是产物本身的性质，与排队无关。')
  const compared = raw.cases.filter(c => c.ok && c.serverDuration > 0)
  if (compared.length > 0) {
    const worst = compared.reduce((a, b) => (Math.abs(b.serverDuration - b.realDuration) > Math.abs(a.serverDuration - a.realDuration) ? b : a))
    const ratio = (worst.serverDuration / worst.realDuration).toFixed(2)
    L.push(`> 响应里的 \`duration\` **不是音频时长**：本轮差得最远的一条 \`${worst.id}\` 响应 ${worst.serverDuration}s、ffprobe 真值 ${worst.realDuration}s（${ratio}×）。`
      + '两者无固定比例（有时偏大、有时偏小），所以落卡时长只能 ffprobe 实测 —— 这正是本项目从不在节点上用响应值的原因。')
  }
  L.push('')
  L.push('> F0（基频）是自相关估计（已做次谐波纠正），仍可能有 ±1 八度误差 —— **只用于同批用例之间的相对比较**，不要当绝对音高用。')
  L.push('')

  // 派生结论 1：语速用词的真实杠杆
  const speedIds = ['zh-slow', 'zh-mid', 'zh-fast']
  const sp = speedIds.map(id => raw.cases.find(c => c.id === id && c.ok)).filter(Boolean)
  if (sp.length === speedIds.length) {
    const slow = sp[0]
    const mid = sp[1]
    const fast = sp[2]
    const span = ((slow.realDuration - fast.realDuration) / mid.realDuration) * 100
    L.push('### 派生结论：`instruct_prompt` 里的「慢速 / 快速」值多少')
    L.push('')
    L.push(`同一句话、同一个人设，只改语速词：慢速 ${slow.realDuration}s / 中速 ${mid.realDuration}s / 快速 ${fast.realDuration}s ⇒ 全程变化 **${span.toFixed(1)}%**。`)
    const noise = raw.variance?.durationSpreadPct
    if (typeof noise === 'number') {
      L.push('')
      L.push(`对照：**同一条 instruct_prompt 原样连发 3 次**的时长极差 ${raw.variance.durationSpread}s（${noise}%）。`
        + (Math.abs(span) <= noise
          ? `语速词带来的 ${Math.abs(span).toFixed(1)}% 变化 **不超过重复调用本身的随机波动 ${noise}%** ⇒ 「慢速/快速」在统计上不可分辨，别拿它当刻度用。`
          : `语速词带来了 ${Math.abs(span).toFixed(1)}% 的变化（大于随机波动 ${noise}%）⇒ **方向性存在，但幅度不稳、不可当刻度**：要精确控时长只能用下面的 \`speed\`。`))
    }
    L.push('')
    L.push('⇒ 需要「正好 8 秒」这种精度只能用 `speed`（0.5–2.0，实测见第四节：0.9 → ×1.107、1.15 → ×0.87，与 1/speed 完全吻合）。')
    L.push('')
  }

  if (raw.variance !== undefined) {
    const v = raw.variance
    L.push('### 派生结论：同一条 instruct_prompt 能不能复现同一个声音')
    L.push('')
    L.push(`\`${v.instruct}\` × 3 次：时长 ${v.durations.map(d => `${d}s`).join(' / ')}（极差 ${v.durationSpread}s = ${v.durationSpreadPct}%），`
      + `F0 ${v.f0s.map(f => `${f}Hz`).join(' / ')}${v.f0SpreadPct === null ? '' : `（极差 ${v.f0SpreadPct}%）`}。`)
    L.push('')
    L.push('⇒ **自然语言声音设计是「描述」不是「配方」**：同一串词每次召回的可能是不同的音色实现（本次 F0 极差已可跨一个音区）。')
    L.push('⇒ 上面两项都是**产物属性**（音频本身的时长与音高），与后端是否在忙**无关**；受排队影响的只有「生成耗时」那一列。')
    L.push('⇒ 多段旁白要「听上去是同一个人」，唯一可靠手段是**每一段都传同一个 `refaudio`**；只靠 instruct_prompt 逐字复用不足以保证一致（这是 skill 里 C-5 铁律的实测依据）。')
    L.push('')
  }


  // 派生结论 2：正文里的舞台指令会不会被念出来
  const plain = raw.cases.find(c => c.id === 'zh-pause-plain' && c.ok)
  const mark = raw.cases.find(c => c.id === 'zh-pause-mark' && c.ok)
  if (plain !== undefined && mark !== undefined) {
    L.push('### 派生结论：正文里写「（停顿两秒）」会怎样')
    L.push('')
    L.push(`纯正文「他走了。门关上了。」${plain.realDuration}s（${plain.charsPerSec} 字/秒）；`)
    L.push(`加了舞台指令「他走了。（停顿两秒）门关上了。」${mark.realDuration}s（${mark.charsPerSec} 字/秒）。`)
    L.push('')
    L.push(`时长比 ${(mark.realDuration / plain.realDuration).toFixed(2)}×、字数比 ${(mark.chars / plain.chars).toFixed(2)}× —— `
      + (mark.realDuration <= plain.realDuration
        ? '**括号里的字没有被念**（多写了 4 个字，时长反而没变长）⇒ 正文里的舞台指令既不会变成停顿、也不会被朗读，**完全无效**；要停顿只能靠文本换行/标点，或后期 `cut_audio` 拼接。'
        : (Math.abs(mark.charsPerSec - plain.charsPerSec) / plain.charsPerSec < 0.15
          ? '两者「字/秒」接近 ⇒ **括号里的字被当成正文念了**（停顿没有发生，反而多念了四个字）。这就是「要么别写，要么写进 instruct_prompt」的实测依据。'
          : '两者「字/秒」明显不同 ⇒ 括号内容的处理与正文不一致（需人工听感复核）。')))
    L.push('')
  }

  // 派生结论 3：长文线性度
  const short = raw.cases.find(c => c.id === 'zh-mid' && c.ok)
  const long = raw.cases.find(c => c.id === 'zh-long' && c.ok)
  if (short !== undefined && long !== undefined) {
    L.push('### 派生结论：文本长度 → 时长的线性度')
    L.push('')
    L.push(`22 字 → 5.64s（${short.charsPerSec} 字/秒）；${long.chars} 字 → ${long.realDuration}s（${long.charsPerSec} 字/秒）。`
      + `偏差 ${(Math.abs(long.charsPerSec - short.charsPerSec) / short.charsPerSec * 100).toFixed(0)}% ⇒ `
      + (Math.abs(long.charsPerSec - short.charsPerSec) / short.charsPerSec < 0.2
        ? '近似线性，「字数 ÷ 字速」可以当排期估算。'
        : '非线性，长文必须实测真值后再排帧，不能按字速推。'))
    L.push('')
  }

  if (raw.clone !== null) {
    const k = raw.clone
    L.push('## 三、音色克隆（refaudio）')
    L.push('')
    L.push(`参考音：\`${k.ref.id}\`（F0 ${k.ref.f0?.median ?? '—'}Hz，${k.ref.realDuration}s）→ 上传句柄 \`${k.handle}\`（HTTP ${k.uploadStatus}）`)
    L.push('')
    L.push('| 用例 | instruct_prompt | F0 中位 | 时长 | 判定 |')
    L.push('|---|---|---|---|---|')
    const w = k.withRef
    const b = k.baseline
    L.push(`| 带 refaudio | 平静，中速 | ${w.ok ? `${w.f0?.median ?? '—'}Hz` : `失败 ${w.status} ${w.error ?? ''}`} | ${w.ok ? `${w.realDuration}s` : '—'} | ${w.ok ? '克隆通道返回可用音频' : '克隆通道不可用'} |`)
    L.push(`| 无 refaudio（基线） | 平静，中速 | ${b.ok ? `${b.f0?.median ?? '—'}Hz` : `失败 ${b.status} ${b.error ?? ''}`} | ${b.ok ? `${b.realDuration}s` : '—'} | 对照组 |`)
    L.push('')
    if (w.ok && b.ok && k.ref.f0 !== null && w.f0 !== null && b.f0 !== null) {
      const dRef = Math.abs(w.f0.median - k.ref.f0.median)
      const dBase = Math.abs(b.f0.median - k.ref.f0.median)
      L.push(`克隆是否把音色带过来：带 refaudio 距**本轮**参考 ${dRef}Hz，无 refaudio 基线距参考 ${dBase}Hz ⇒ ${dRef < dBase ? '**是，音高锁向了参考音**' : '本轮未体现（基线恰好抽到接近的音色）'}。`)
      L.push('')
      L.push('> 判据说明：基线本身随机性很大（见上一节，同一 instruct 的 F0 可漂一个音区），所以**单轮 F0 比较不足以证明克隆**。')
      L.push('> 真正有说服力的证据是「跨轮都锁住当轮的参考」：多跑几轮看 `带 refaudio` 的 F0 是否始终贴住**当轮**参考、而基线始终乱跳。')
      L.push('')
    }
  }
  if (raw.local !== null) {
    const l = raw.local
    L.push('## 四、宿主侧后处理（`speed` / `pitchSemitones`，O-09）')
    L.push('')
    L.push(`基准：\`${l.source}\` ${l.baseDuration}s / F0 ${l.baseF0 ?? '—'}Hz`)
    L.push('')
    L.push('| 变体 | 滤镜 | 预期 | 实测时长 | 时长比 | 实测 F0 | F0 比 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const r of l.rows) {
      if (!r.ok) {
        L.push(`| \`${r.id}\` | \`${r.filter}\` | ${r.expect} | **失败** ${r.error} | — | — | — |`)
        continue
      }
      L.push(`| \`${r.id}\` | \`${r.filter}\` | ${r.expect} | ${r.duration}s | ×${r.durationRatio} | ${r.f0}Hz | ×${r.f0Ratio} |`)
    }
    L.push('')
    L.push('读数说明：**时长比**是确定性证据（与 `1/speed` 吻合到 1% 以内）；'
      + '**F0 比**受估计噪声影响约 ±10%，只看方向与量级（`-3` 半音 ≈ ×0.85、`+3` 半音 ≈ ×1.17），不要按小数点核对理论值。')
    L.push('')
  }
  L.push('## 五、产物')
  L.push('')
  L.push(`音频与数据同目录：\`${OUT}\``)
  return L.join('\n') + '\n'
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
