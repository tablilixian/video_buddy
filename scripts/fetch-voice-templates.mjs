#!/usr/bin/env node
/**
 * 音色模板抓取器（个人研究用）。
 *
 * 为什么存在：真机测 TTS 克隆时，需要一批「语言 × 性别 × 年龄段」覆盖、命名统一、
 * 时长可用的参考音。整包数据集动辄几百 GB，且多数要签授权表；本脚本只从可匿名
 * 访问的镜像里挑**单条**音频，转成 24 kHz 单声道 wav，并按
 * `canvas-studio/docs/voice-templates/<lang>/<lang>-<f|m>-<age>-<nn>.wav` 落盘。
 *
 * 源（均为单文件可下载，不拉整包）：
 * - Common Voice 22.0（镜像 `fsicoli/common_voice_22_0`，CC0）：130+ 语言，
 *   transcript 自带 age / gender；单条 2–10 秒。train 没凑齐时依次扫描
 *   dev / test / other 分片——部分语言（如 hi、vi）的女性录音只在后几个分片里。
 * - AISHELL-3（镜像 `AISHELL/AISHELL-3`，Apache-2.0）：中文 44.1 kHz 录音棚，
 *   spk-info.txt 标注 A(<14) / B(14-25) / C(26-40) / D(>41) 与性别。
 *
 * 用法：
 *   node scripts/fetch-voice-templates.mjs                 # 全量（约 57 条）
 *   node scripts/fetch-voice-templates.mjs --langs=zh,en   # 只跑指定语言
 *   node scripts/fetch-voice-templates.mjs --out=/tmp/vt   # 换输出目录
 *
 * 依赖：node >= 22（内置 fetch）、ffmpeg / ffprobe 在 PATH 上。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HF = 'https://hf-mirror.com'
const CV_REPO = 'fsicoli/common_voice_22_0'
const AISHELL_REPO = 'AISHELL/AISHELL-3'

const OUT = argValue('--out') ?? join(ROOT, 'canvas-studio/docs/voice-templates')
// 源元数据（transcript / clip_durations）合计 1GB+，放画布插件既有忽略目录，不进库。
const CACHE = join(ROOT, 'canvas-studio/.cache/voice-templates')
const TMP = join(CACHE, 'tmp')
const LANGS = argValue('--langs')?.split(',').map((s) => s.trim()).filter(Boolean)
const FORCE = process.argv.includes('--force')

/** 目标槽位：一条语言 × 性别 × 年龄段。 */
const TARGETS = [
  { lang: 'zh', src: 'aishell3', slots: [
    ['female', 'child'], ['male', 'child'], ['female', 'teen'], ['male', 'teen'],
    ['female', 'mid'], ['male', 'mid'], ['female', 'senior'], ['male', 'senior'],
  ] },
  { lang: 'zh-CN', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'zh-TW', src: 'cv', slots: [['female', 'young'], ['male', 'mid']] },
  { lang: 'yue', src: 'cv', slots: [['female', 'young'], ['male', 'mid']] },
  { lang: 'en', src: 'cv', slots: [['female', 'teen'], ['male', 'young'], ['female', 'mid'], ['male', 'senior'], ['female', 'elder']] },
  { lang: 'ja', src: 'cv', slots: [['female', 'young'], ['male', 'young'], ['female', 'mid'], ['male', 'senior']] },
  { lang: 'ko', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'de', src: 'cv', slots: [['female', 'young'], ['male', 'mid'], ['male', 'senior']] },
  { lang: 'fr', src: 'cv', slots: [['female', 'young'], ['male', 'young'], ['female', 'senior']] },
  { lang: 'es', src: 'cv', slots: [['female', 'young'], ['male', 'mid'], ['female', 'elder']] },
  { lang: 'it', src: 'cv', slots: [['female', 'young'], ['male', 'mid']] },
  { lang: 'pt', src: 'cv', slots: [['female', 'young'], ['male', 'mid']] },
  { lang: 'ru', src: 'cv', slots: [['female', 'young'], ['male', 'young'], ['female', 'senior']] },
  { lang: 'ar', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'hi', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'tr', src: 'cv', slots: [['female', 'young'], ['male', 'mid']] },
  // vi 的 train 女性标注为空；女性只在 test/other 的 twenties 里出现，50+ 女声不存在。
  { lang: 'vi', src: 'cv', slots: [['male', 'senior'], ['female', 'young'], ['female', 'senior']] },
  { lang: 'th', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'id', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
  { lang: 'nl', src: 'cv', slots: [['female', 'mid'], ['male', 'mid']] },
  { lang: 'pl', src: 'cv', slots: [['female', 'young'], ['male', 'young']] },
]

/** Common Voice 分片扫描顺序：train 覆盖大部分槽位，其余分片用来补稀有性别/年龄。 */
const CV_SPLITS = ['train', 'dev', 'test', 'other']

/** 年龄段 → Common Voice 的 age 取值（CV 最小是 teens，没有 child）。 */
const CV_AGE = {
  child: [],
  teen: ['teens'],
  young: ['twenties'],
  mid: ['thirties', 'fourties'],
  senior: ['fifties'],
  elder: ['sixties', 'seventies', 'eighties', 'nineties'],
}
/** 取不到就顺次降级，保证每个槽位尽量都有产物。 */
const AGE_FALLBACK = {
  child: ['teen', 'young'],
  teen: ['young', 'mid'],
  young: ['teen', 'mid'],
  mid: ['young', 'senior'],
  senior: ['mid', 'elder'],
  elder: ['senior', 'mid'],
}
const AGE_CN = {
  child: '儿童', teen: '少年', young: '青年', mid: '中年', senior: '中老年', elder: '老年',
}
const GENDER_CN = { female: '女', male: '男' }

const manifest = []
const failed = []

main().catch((error) => {
  console.error('\n[fatal]', error?.stack ?? error)
  process.exitCode = 1
})

async function main() {
  await mkdir(CACHE, { recursive: true })
  await mkdir(TMP, { recursive: true })
  await assertFfmpeg()
  manifest.push(...(await loadStored()))
  failed.push(...(await loadStoredFailures()))

  const targets = LANGS === undefined ? TARGETS : TARGETS.filter((t) => LANGS.includes(t.lang))
  if (targets.length === 0) {
    console.error(`没有匹配的语言：${LANGS?.join(',')}`)
    process.exitCode = 1
    return
  }

  for (const target of targets) {
    const dir = join(OUT, target.lang.toLowerCase())
    await mkdir(dir, { recursive: true })
    console.log(`\n== ${target.lang} (${target.src})`)

    // 清单生成机制之前落盘的文件不会出现在 manifest 里，先按文件名补录，
    // 否则它们会被当成「已有」却永远不进 manifest.csv。
    const known = new Set(manifest.map((entry) => entry.file))
    for (const [gender, age] of target.slots) {
      const prefix = slotPrefix(target.lang, gender, age)
      const names = (await readdir(dir).catch(() => []))
        .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.wav'))
      for (const name of names) {
        const relative = `${target.lang.toLowerCase()}/${name}`
        if (known.has(relative)) continue
        known.add(relative)
        manifest.push(row({
          file: join(dir, name),
          lang: target.lang,
          gender,
          age,
          source: target.src === 'aishell3' ? 'AISHELL-3' : 'Common Voice 22.0',
          license: target.src === 'aishell3' ? 'Apache-2.0' : 'CC0-1.0',
          sourceId: '',
          cvAge: '',
          note: '既有文件补录（早于清单记录）',
        }))
      }
    }
    await saveStored()

    const pending = []
    for (const [gender, age] of target.slots) {
      const prefix = slotPrefix(target.lang, gender, age)
      if (!FORCE && (await hasSlot(dir, prefix))) {
        console.log(`   have ${prefix}-*.wav`)
        continue
      }
      pending.push([gender, age])
    }
    if (pending.length === 0) continue

    if (target.src === 'aishell3') {
      for (const [gender, age] of pending) {
        try {
          const row = await fetchAishell3(target.lang, gender, age, dir)
          manifest.push(row)
          await saveStored()
          console.log(`   ok  ${row.file}  ${row.source}  ${row.note.slice(0, 40)}`)
        } catch (error) {
          await recordFailure(target.lang, gender, age, error)
        }
      }
      continue
    }

    const result = await fetchCommonVoiceBatch(target.lang, pending, dir)
    for (const row of result.rows) {
      manifest.push(row)
      await saveStored()
      console.log(`   ok  ${row.file}  ${row.durationSec}s  ${row.source}  ${row.note.slice(0, 40)}`)
    }
    for (const failure of result.failures) {
      await recordFailure(failure.lang, failure.gender, failure.age, new Error(failure.reason))
    }
    await sleep(600)
  }

  await writeManifest()
  await rm(TMP, { recursive: true, force: true })
  console.log(`\n完成：${manifest.length} 条成功，${failed.length} 条跳过。`)
  console.log(`目录：${OUT}`)
}

/* ------------------------------------------------------------------ 源适配 */

/**
 * Common Voice 的音频在镜像里是 1–2 GB 的 `.tar`（没有单文件直链），所以这里
 * **流式抽前 N 个成员**（`extract_tar_samples.py`，拿到就断开），再按
 * transcript 的 gender / age 标签认领槽位——不落整包，也不靠猜文件名。
 */
async function fetchCommonVoiceBatch(lang, slots, dir) {
  const durations = await loadCvDurations(lang)
  const pending = slots.map(([gender, age]) => ({ gender, age }))
  const best = new Map()
  const out = []
  const scanned = []

  for (const split of CV_SPLITS) {
    if (pending.length === 0) break
    const tars = (await listTree(CV_REPO, `audio/${lang}/${split}`).catch(() => []))
      .filter((path) => path.endsWith('.tar'))
    if (tars.length === 0) continue
    const rows = await loadCvTranscript(lang, split)
    const byPath = new Map(rows.map((r) => [r.path, r]))

    // 元数据里就没有匹配标注的分片直接跳过，别白下 tar（hi/vi 的 train 都是全男）。
    const femaleAges = new Set()
    const maleAges = new Set()
    for (const meta of rows) {
      if (meta.gender.startsWith('female')) femaleAges.add(meta.age)
      else if (meta.gender.startsWith('male')) maleAges.add(meta.age)
    }
    const useful = pending.some((slot) =>
      pickAges(slot.age).some((age) => (slot.gender === 'male' ? maleAges : femaleAges).has(age)))
    if (!useful) continue

    for (const tar of tars.slice(0, 6)) {
      if (pending.length === 0) break
      const stage = join(TMP, `${lang}-${tar.split('/').pop().replace(/\.tar$/, '')}`)
      await rm(stage, { recursive: true, force: true })
      const names = await extractTar(tarUrl(tar), stage, tars.length === 1 ? 100 : 40, 'spread')
      scanned.push(split)

      for (const name of names) {
        const meta = byPath.get(name)
        if (meta === undefined) continue
        const duration = (durations.get(name) ?? 0) / 1000
        if (duration > 0 && duration < 3) continue
        for (const slot of pending) {
          const want = slot.gender === 'male' ? 'male' : 'female'
          if (!meta.gender.startsWith(want)) continue
          if (!pickAges(slot.age).includes(meta.age)) continue
          const key = slotKey(slot)
          const score = scoreDuration(duration)
          const previous = best.get(key)
          if (previous === undefined || score > previous.score) {
            best.set(key, { slot, meta, file: name, duration, score })
          }
        }
      }

      for (const [key, candidate] of [...best]) {
        if (candidate.score === 0) continue
        const index = pending.findIndex((slot) => slotKey(slot) === key)
        if (index === -1) continue

        const outFile = nextName(dir, lang, candidate.slot.gender, candidate.slot.age)
        await transcode(join(stage, candidate.file), outFile, candidate.duration > 0 && candidate.duration <= 14 ? undefined : 15)
        const actual = await probe(outFile)
        best.delete(key)
        if (actual < 3) {
          await rm(outFile, { force: true })
          continue
        }
        pending.splice(index, 1)
        out.push(row({
          file: outFile,
          lang,
          gender: candidate.slot.gender,
          age: candidate.slot.age,
          source: 'Common Voice 22.0',
          license: 'CC0-1.0',
          sourceId: candidate.file,
          note: candidate.meta.sentence,
          cvAge: candidate.meta.age,
          durationSec: Number(actual.toFixed(2)),
        }))
      }

      await rm(stage, { recursive: true, force: true })
      if (pending.length > 0) await sleep(300)
    }
  }

  const splits = [...new Set(scanned)]
  const failures = pending.map((slot) => ({
    lang,
    gender: slot.gender,
    age: slot.age,
    reason: `扫了 ${scanned.length} 个分片（${splits.join('/')}）没找到匹配片段`,
  }))
  return { rows: out, failures }
}

function tarUrl(path) {
  return `${HF}/datasets/${CV_REPO}/resolve/main/${path.split('/').map(encodeURIComponent).join('/')}`
}

async function extractTar(url, outdir, limit, mode = 'head') {
  const helper = join(ROOT, 'scripts', 'extract_tar_samples.py')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await run('python3', [helper, url, outdir, String(limit), mode], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      })
      return JSON.parse(stdout.trim() || '[]')
    } catch (error) {
      if (attempt === 1) throw error
      await sleep(1500)
    }
  }
  return []
}

async function recordFailure(lang, gender, age, error) {
  failed.push({ lang, gender, age, reason: String(error?.message ?? error) })
  await saveStoredFailures()
  console.warn(`   skip ${lang} ${gender}/${age}: ${error?.message ?? error}`)
}

function slotKey(slot) {
  return `${slot.gender}-${slot.age}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchAishell3(lang, gender, age, dir) {
  const [speakers, dirs] = await Promise.all([loadAishellSpeakers(), listTree(AISHELL_REPO, 'train/wav')])
  const group = ageGroupOf(age)
  const available = new Set(dirs.map((path) => path.split('/').pop()))
  const pool = speakers
    .filter((s) => s.gender === gender && s.group === group && available.has(s.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (pool.length === 0) {
    const groupPool = speakers.filter((s) => s.group === group && available.has(s.id))
    throw new Error(`AISHELL-3 ${group} 组无 ${gender} 说话人（该组共 ${groupPool.length} 人）`)
  }

  // 同一槽位固定取同一个说话人，但不同槽位错开，避免整批都是前几个人。
  const speaker = pool[hash(`${lang}-${gender}-${age}`) % pool.length]
  const files = (await listTree(AISHELL_REPO, `train/wav/${speaker.id}`)).slice(0, 8)
  if (files.length === 0) throw new Error(`说话人 ${speaker.id} 无音频`)

  const picked = []
  let total = 0
  for (const file of files) {
    if (picked.length >= 3 || total >= 9) break
    const raw = join(TMP, sanitize(file.split('/').pop()))
    await download(`${HF}/datasets/${AISHELL_REPO}/resolve/main/${encodeURI(file)}`, raw)
    const duration = await probe(raw)
    if (duration < 1.5) { await rm(raw, { force: true }); continue }
    picked.push({ raw, duration })
    total += duration
  }
  if (picked.length === 0) throw new Error('AISHELL-3 音频全部不可用')

  const out = nextName(dir, lang, gender, age)
  if (picked.length === 1) {
    await transcode(picked[0].raw, out, picked[0].duration > 15 ? 15 : undefined)
  } else {
    const list = join(TMP, `concat-${hash(out)}.txt`)
    await writeFile(list, picked.map((p) => `file '${p.raw.replaceAll("'", "'\\''")}'`).join('\n'))
    await transcodeConcat(list, out)
  }
  for (const p of picked) await rm(p.raw, { force: true })
  return row({
    file: out,
    lang,
    gender,
    age,
    source: 'AISHELL-3',
    license: 'Apache-2.0',
    sourceId: speaker.id,
    note: `${speaker.accent}口音 · ${group} 组（${picked.length} 段拼接）`,
    cvAge: '',
  })
}

/* -------------------------------------------------------------- 元数据缓存 */

async function loadCvTranscript(lang, split = 'train') {
  const cache = join(CACHE, split === 'train' ? `cv-${lang}.tsv` : `cv-${lang}-${split}.tsv`)
  if (!existsSync(cache)) {
    await download(`${HF}/datasets/${CV_REPO}/resolve/main/transcript/${encodeURIComponent(lang)}/${split}.tsv`, cache)
  }
  const text = await readFile(cache, 'utf8')
  const lines = text.split('\n')
  const header = lines[0].split('\t')
  const index = Object.fromEntries(header.map((h, i) => [h, i]))
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].length === 0) continue
    const cells = lines[i].split('\t')
    rows.push({
      path: cells[index.path] ?? '',
      sentence: cells[index.sentence] ?? '',
      up_votes: cells[index.up_votes] ?? '0',
      age: (cells[index.age] ?? '').trim(),
      gender: (cells[index.gender] ?? '').trim(),
    })
  }
  return rows
}

async function loadCvDurations(lang) {
  const cache = join(CACHE, `cv-${lang}-durations.tsv`)
  if (!existsSync(cache)) {
    await download(`${HF}/datasets/${CV_REPO}/resolve/main/transcript/${encodeURIComponent(lang)}/clip_durations.tsv`, cache)
  }
  const text = await readFile(cache, 'utf8')
  const map = new Map()
  for (const line of text.split('\n').slice(1)) {
    if (line.length === 0) continue
    const [clip, ms] = line.split('\t')
    if (clip !== undefined && ms !== undefined) map.set(clip, Number(ms))
  }
  return map
}

async function loadAishellSpeakers() {
  const cache = join(CACHE, 'aishell3-speakers.txt')
  if (!existsSync(cache)) {
    await download(`${HF}/datasets/${AISHELL_REPO}/resolve/main/spk-info.txt`, cache)
  }
  const text = await readFile(cache, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.startsWith('SSB'))
    .map((line) => {
      const [id, group, gender, accent] = line.split('\t')
      return { id, group, gender, accent }
    })
}

async function listTree(repo, path = '') {
  const suffix = path === '' ? '' : `/${path.split('/').map(encodeURIComponent).join('/')}`
  const data = JSON.parse(await get(`${HF}/api/datasets/${repo}/tree/main${suffix}`))
  return data.map((entry) => entry.path)
}

/* ------------------------------------------------------------------ 工具 */

async function transcode(input, output, seconds) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le']
  if (seconds !== undefined) args.push('-t', String(Math.round(seconds)))
  args.push(output)
  await run('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 })
}

async function transcodeConcat(listFile, output) {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
    '-t', '15', output], { maxBuffer: 8 * 1024 * 1024 })
}

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file])
  const value = Number.parseFloat(stdout.trim())
  return Number.isFinite(value) ? value : 0
}

async function download(url, destination) {
  if (existsSync(destination)) return
  const bytes = await get(url, 'buffer')
  await writeFile(destination, bytes)
}

async function get(url, as = 'text') {
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'voice-template-fetch/1.0' } })
      if (response.status === 429) throw new Error(`HTTP 429 ${url}`)
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
      return as === 'buffer' ? Buffer.from(await response.arrayBuffer()) : await response.text()
    } catch (error) {
      lastError = error
      // 429 要退得更狠：镜像按分钟限流，短退避只会把窗口继续打满。
      const wait = String(error?.message ?? '').includes('429')
        ? 5000 * (attempt + 1)
        : 800 * (attempt + 1)
      await sleep(wait)
    }
  }
  throw lastError
}

async function assertFfmpeg() {
  try {
    await run('ffmpeg', ['-version'])
    await run('ffprobe', ['-version'])
  } catch {
    throw new Error('找不到 ffmpeg / ffprobe，请先安装（brew install ffmpeg）')
  }
}

function pickAges(age) {
  const chain = [age, ...AGE_FALLBACK[age]]
  return chain.flatMap((key) => CV_AGE[key] ?? [])
}

function ageGroupOf(age) {
  return { child: 'A', teen: 'B', young: 'B', mid: 'C', senior: 'D', elder: 'D' }[age] ?? 'B'
}

function scoreDuration(seconds) {
  // 0 = clip_durations 里查不到，时长未知：中性分，靠转码后的实测再淘汰。
  if (seconds <= 0) return 1
  if (seconds >= 6 && seconds <= 12) return 3
  if (seconds > 12 && seconds <= 16) return 2
  if (seconds >= 4) return 1
  return 0
}

function slotPrefix(lang, gender, age) {
  return `${lang.toLowerCase()}-${gender === 'female' ? 'f' : 'm'}-${age}`
}

async function hasSlot(dir, prefix) {
  const names = await readdir(dir).catch(() => [])
  return names.some((name) => name.startsWith(`${prefix}-`) && name.endsWith('.wav'))
}

function nextName(dir, lang, gender, age) {
  const prefix = slotPrefix(lang, gender, age)
  let index = 1
  let file = join(dir, `${prefix}-01.wav`)
  while (existsSync(file)) {
    index += 1
    file = join(dir, `${prefix}-${String(index).padStart(2, '0')}.wav`)
  }
  return file
}

function row({ file, lang, gender, age, source, license, sourceId, note, cvAge }) {
  return {
    file: file.slice(OUT.length + 1),
    lang,
    gender,
    age,
    ageCn: AGE_CN[age],
    genderCn: GENDER_CN[gender],
    source,
    license,
    sourceId,
    cvAge,
    durationSec: 0,
    note: (note ?? '').replaceAll(/\s+/g, ' ').trim(),
  }
}

async function loadStored() {
  const file = join(CACHE, 'manifest.json')
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function saveStored() {
  const seen = new Map()
  for (const entry of manifest) seen.set(entry.file, entry)
  manifest.length = 0
  manifest.push(...seen.values())
  await writeFile(join(CACHE, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

async function saveStoredFailures() {
  const seen = new Map()
  for (const entry of failed) seen.set(`${entry.lang}-${entry.gender}-${entry.age}`, entry)
  failed.length = 0
  failed.push(...seen.values())
  await writeFile(join(CACHE, 'failed.json'), JSON.stringify(failed, null, 2))
}

async function loadStoredFailures() {
  const file = join(CACHE, 'failed.json')
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeManifest() {
  await saveStored()
  for (const entry of manifest) {
    entry.durationSec = Number((await probe(join(OUT, entry.file))).toFixed(2))
  }
  const header = ['file', 'lang', 'gender', 'genderCn', 'age', 'ageCn', 'cvAge', 'durationSec', 'source', 'license', 'sourceId', 'note']
  const lines = [header.join(',')]
  for (const entry of manifest.sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(header.map((key) => csv(entry[key])).join(','))
  }
  await writeFile(join(OUT, 'manifest.csv'), `${lines.join('\n')}\n`)
  const targetSlots = new Set(TARGETS.flatMap((target) =>
    target.slots.map(([gender, age]) => `${target.lang}-${gender}-${age}`)))
  const stillFailed = []
  for (const entry of failed) {
    // 槽位配置改过之后，旧记录不应继续出现在 failed.csv 里。
    if (!targetSlots.has(`${entry.lang}-${entry.gender}-${entry.age}`)) continue
    const slotDir = join(OUT, entry.lang.toLowerCase())
    if (await hasSlot(slotDir, slotPrefix(entry.lang, entry.gender, entry.age))) continue
    stillFailed.push(entry)
  }
  if (stillFailed.length > 0) {
    const rows = ['lang,gender,age,reason', ...stillFailed.map((f) => [f.lang, f.gender, f.age, csv(f.reason)].join(','))]
    await writeFile(join(OUT, 'failed.csv'), `${rows.join('\n')}\n`)
  } else {
    await rm(join(OUT, 'failed.csv'), { force: true })
  }
}

function csv(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function sanitize(name) {
  return name.replaceAll(/[^A-Za-z0-9._-]/g, '_')
}

function hash(text) {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) >>> 0
  return value
}

function argValue(flag) {
  const hit = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  return hit?.slice(flag.length + 1)
}
