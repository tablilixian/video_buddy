#!/usr/bin/env node
/**
 * CompositionManifest 生成器（代码驱动科普 · 骨架优先出片）。
 *
 * ## 为什么需要它
 *
 * 真机事故（2026-11-05，3h37m 零成片）：模型手写 60–90 轨 / 60–120KB 的 manifest，
 * 单步输出预算（32,768 token）两次被思考吃满，两次都死在「正要写」的前一格 ——
 * 30 分钟的推理全丢，连草稿都没留下。
 *
 * 根因不是能力：**排版是确定性计算，不该由模型用 token 去算**。所以把它挪到脚本：
 * 模型只交一份「内容表」（每句一行 + 每个视觉元素一条），帧窗、时长自洽、轨 id、
 * 层叠顺序全部由这里算。
 *
 * ## 它保证什么
 *
 * 1. `meta.durationInFrames` **恒等于**最大结束帧（尾部完整性校验的硬约束）；
 * 2. 字幕/文本卡首尾相接，末句吸收舍入误差（不留空白帧）；
 * 3. **段边界冻结**：首次生成把句子帧窗写进 `build/segment-lock.json`，之后每次运行
 *    都比对 —— 改了就是"重排"，直接报错退出。这条是「以第一版为锚点丰富」的技术前提：
 *    追加视觉/动效时帧窗必须一动不动，否则整片要重算，思考雪崩就回来了。
 *
 * ## 用法
 *
 *   node build/manifest-spec.json          # 默认读写 build/manifest.json
 *   node manifest-builder.mjs <spec.json>
 *
 * spec 形状见 `references/manifest-builder.md`。要改一处只改 spec 里那一条，
 * 重跑本脚本，再 `render_composition({ manifestPath, quality:"draft" })`。
 *
 * 零依赖：只用 node 内置模块，可整段复制进项目 `build/` 目录直接跑。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const SIZES = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

/** 默认配色（与 recipes.ts 的 explainer-cards 起点一致；spec.theme 可覆盖）。 */
const DEFAULT_THEME = { background: '#0b1220', layer: '#111827', accent: '#38bdf8' }

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** `box`（BaseTrack 通用键，0–100 双轴百分比、x/y 中心语义）四键齐全才算给了。 */
function isLayoutBox(box) {
  return typeof box === 'object' && box !== null
    && num(box.x, NaN) === box.x && num(box.y, NaN) === box.y
    && num(box.w, NaN) === box.w && num(box.h, NaN) === box.h
}

function loadJson(path) {
  if (!existsSync(path)) fail(`找不到文件：${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    fail(`${path} 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * 内容表 → 句子帧窗。
 *
 * 两条输入通道，二选一（同时给以 `captions` 为准 —— 它已经是真值，不该被秒数覆盖）：
 *  - `captions[]`：`{ id, text, frames, src?, words? }`，帧数直接来自 TTS / list_shots 真值；
 *  - `narration[]`：`{ id, text, seconds }`，按 fps 折算（只用于旁白还没合成时）。
 *
 * CV-447（T0-A1）：`words` 必须原样透传 —— 低层契约支持词级时间戳（`manifest.ts:691`），
 * 此前这里只挑 `{id,text,frames,src}`，导致卡拉 OK 字幕永远走能量包络兜底（真机事故：
 * 字幕整句 dim 0.28，agent 花 7min 才发现是产生路径丢字段）。
 *
 * 排版三键同理必须透传（四季片复盘 P-06 / 复盘 §8 P2-1）：`fontSize` / `widthPercent` /
 * `box` 都是低层契约合法键（`KNOWN_TRACK_KEYS.caption` + BaseTrack `box`，Caption.tsx 消费），
 * 丢了以后模型被迫在项目里外挂 finalize 脚本改写产物 —— 绕过一旦发生，根因就留在库里。
 */
function buildSegments(spec, fps) {
  const captions = Array.isArray(spec.captions) ? spec.captions : []
  const narration = Array.isArray(spec.narration) ? spec.narration : []
  const source = captions.length > 0
    ? captions.map((line, index) => ({
      id: typeof line.id === 'string' && line.id !== '' ? line.id : `V${String(index + 1)}`,
      text: String(line.text ?? '').trim(),
      frames: Math.max(1, Math.round(num(line.frames, 0))),
      ...(typeof line.src === 'string' && line.src !== '' ? { src: line.src } : {}),
      ...(Array.isArray(line.words) && line.words.length > 0 ? { words: line.words } : {}),
      ...(num(line.fontSize, 0) > 0 ? { fontSize: line.fontSize } : {}),
      ...(num(line.widthPercent, 0) > 0 ? { widthPercent: line.widthPercent } : {}),
      ...(isLayoutBox(line.box) ? { box: line.box } : {}),
      ...(num(line.audioFrames, 0) > 0 ? { audioFrames: line.audioFrames } : {}),
    }))
    : narration.map((line, index) => ({
      id: typeof line.id === 'string' && line.id !== '' ? line.id : `V${String(index + 1)}`,
      text: String(line.text ?? '').trim(),
      frames: Math.max(1, Math.round(num(line.seconds, 0) * fps)),
    }))
  if (source.length === 0) fail('spec 里没有任何句子：给 `captions[]`（帧真值）或 `narration[]`（秒）')
  for (const line of source) {
    if (line.text === '') fail(`${line.id} 的 text 是空的（字幕卡不允许空文案）`)
    if (line.text.includes('\n')) fail(`${line.id} 的 text 含换行（单句一条轨，折行交给渲染层）`)
  }
  let cursor = 0
  return source.map((line) => {
    const startFrame = cursor
    cursor += line.frames
    return { ...line, startFrame, durationInFrames: line.frames, endFrame: cursor }
  })
}

/** 句子 id → 段；支持数字帧号直接定位。 */
function resolveAnchor(anchor, segments, at) {
  if (typeof anchor === 'number' && Number.isFinite(anchor)) return anchor
  const hit = segments.find((segment) => segment.id === anchor)
  if (hit === undefined) {
    fail(`${at} 的 at/until 指向不存在的句子 id：${String(anchor)}（可用：${segments.map((s) => s.id).join(' / ')}）`)
  }
  return hit
}

/**
 * 视觉轨的帧窗：`at`（起点）+ `duration` / `until`（终点）/ 缺省跨该句。
 *
 * 三种写法覆盖了绝大多数需求：跟着某句走（默认）、跨多句（until）、固定帧数（duration）。
 */
function visualWindow(visual, segments, index, fps) {
  const at = visual.at ?? segments[0]?.id
  const from = resolveAnchor(at, segments, `visuals[${String(index)}]`)
  const startFrame = typeof from === 'number' ? from : from.startFrame
  let durationInFrames
  if (typeof visual.duration === 'number' && Number.isFinite(visual.duration)) {
    durationInFrames = Math.max(1, Math.round(visual.duration))
  } else if (visual.until !== undefined) {
    const to = resolveAnchor(visual.until, segments, `visuals[${String(index)}].until`)
    const endFrame = typeof to === 'number' ? to : to.endFrame
    durationInFrames = Math.max(1, endFrame - startFrame)
  } else if (typeof from === 'number') {
    durationInFrames = Math.max(1, Math.round(fps * 2))
  } else {
    durationInFrames = from.durationInFrames
  }
  return { startFrame, durationInFrames }
}

/** 段边界指纹（只取字幕/文本卡轨，按起点排序）。与宿主 render-anchor 同口径。 */
function segmentsOf(manifest) {
  const tracks = Array.isArray(manifest.tracks) ? manifest.tracks : []
  const captions = tracks.filter((t) => t.type === 'caption')
  const picked = captions.length > 0 ? captions : tracks.filter((t) => t.type === 'textCard')
  return picked
    .map((t) => ({ id: String(t.id), startFrame: num(t.startFrame, 0), endFrame: num(t.startFrame, 0) + num(t.durationInFrames, 0) }))
    .sort((a, b) => a.startFrame - b.startFrame)
}

function sameSegments(a, b) {
  if (a.length !== b.length) return false
  return a.every((seg, index) => seg.id === b[index].id && seg.startFrame === b[index].startFrame && seg.endFrame === b[index].endFrame)
}

function main() {
  const specPath = resolve(process.argv[2] ?? 'build/manifest-spec.json')
  const spec = loadJson(specPath)
  const root = process.cwd()
  const outPath = resolve(root, typeof spec.out === 'string' && spec.out !== '' ? spec.out : 'build/manifest.json')
  const fps = [24, 25, 30, 60].includes(spec.fps) ? spec.fps : 30
  const aspect = SIZES[spec.aspect] === undefined ? '16:9' : spec.aspect
  const size = SIZES[aspect]
  const theme = { ...DEFAULT_THEME, ...(typeof spec.theme === 'object' && spec.theme !== null ? spec.theme : {}) }
  const title = typeof spec.title === 'string' && spec.title.trim() !== '' ? spec.title.trim() : '未命名'
  const segments = buildSegments(spec, fps)
  const totalFrames = segments[segments.length - 1].endFrame

  const tracks = []
  // ① 底色：铺满全画面的渐变层（box 100×100，占满而非左上四分之一）。
  tracks.push({
    id: 'bg',
    type: 'shape',
    shape: 'gradient',
    color: theme.layer,
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: 0,
    durationInFrames: totalFrames,
    fadeFrames: 0,
  })
  // ② 字幕 / 文本卡：一句一轨、首尾相接。有 src 走 caption（自播旁白），
  //    没有就走 textCard/subtitle（旁白还没合成时的占位，出片后可直接换 caption）。
  for (const segment of segments) {
    tracks.push(segment.src === undefined
      ? {
        id: segment.id,
        type: 'textCard',
        variant: 'subtitle',
        text: segment.text,
        startFrame: segment.startFrame,
        durationInFrames: segment.durationInFrames,
        fadeFrames: 0,
      }
      : {
        id: segment.id,
        type: 'caption',
        src: segment.src,
        text: segment.text,
        startFrame: segment.startFrame,
        durationInFrames: segment.durationInFrames,
        // CV-447（T0-A1）：词级时间戳透传（有就带上，没有不写 —— 渲染层按等分兜底）。
        ...(segment.words !== undefined ? { words: segment.words } : {}),
        // 排版三键透传（四季片复盘 P-06）：fontSize / widthPercent / box。
        ...(segment.fontSize !== undefined ? { fontSize: segment.fontSize } : {}),
        ...(segment.widthPercent !== undefined ? { widthPercent: segment.widthPercent } : {}),
        ...(segment.box !== undefined ? { box: segment.box } : {}),
        // 词级等分的音频真值（D-03）：从 tts_narration 回执的 ffprobe 秒数 × fps 抄入。
        ...(segment.audioFrames !== undefined ? { audioFrames: segment.audioFrames } : {}),
      })
  }
  // ③ 视觉轨：字段一律透传（样板见 references/shot-cards.md），只补 id 与帧窗。
  //    刻意不做「类型 → 字段」的语义转换 —— 那会变成第二份契约，两处漂移比没有更糟。
  const visuals = Array.isArray(spec.visuals) ? spec.visuals : []
  visuals.forEach((visual, index) => {
    if (typeof visual !== 'object' || visual === null) fail(`visuals[${String(index)}] 必须是对象`)
    const type = typeof visual.type === 'string' ? visual.type : ''
    if (type === '') fail(`visuals[${String(index)}] 缺 type（textCard / shape / chart / image / video / callout / dataCard 等）`)
    const { at: _at, until: _until, duration: _duration, ...rest } = visual
    const window = visualWindow(visual, segments, index, fps)
    tracks.push({
      ...rest,
      id: typeof visual.id === 'string' && visual.id !== '' ? visual.id : `v${String(index + 1)}-${type}`,
      startFrame: window.startFrame,
      durationInFrames: window.durationInFrames,
    })
  })
  // ④ 片尾落版（可选）：贴在全片末尾，不吃掉最后一句的字幕窗。
  if (typeof spec.outro === 'object' && spec.outro !== null) {
    const frames = Math.max(1, Math.round(num(spec.outro.frames, Math.round(fps * 2.5))))
    tracks.push({
      id: 'outro',
      type: 'textCard',
      variant: 'title',
      text: String(spec.outro.text ?? title),
      startFrame: Math.max(0, totalFrames - frames),
      durationInFrames: frames,
      fadeFrames: 0,
    })
  }

  // 时长自洽：恒等于最大结束帧（尾部完整性校验的判据；差一帧都会被拒收）。
  const maxEnd = tracks.reduce((max, track) => Math.max(max, num(track.startFrame, 0) + num(track.durationInFrames, 0)), 0)
  const durationInFrames = Math.max(totalFrames, maxEnd)
  const manifest = {
    id: `comp-${Date.now().toString(36)}`,
    meta: {
      title,
      width: size.width,
      height: size.height,
      fps,
      durationInFrames,
      backgroundColor: theme.background,
      // 批 2-1.2（四季片 P-06）：builder 产物标记 —— render 侧对缺标记的手写 manifest
      // 发观察期 warning（拍板②A），引导走 scaffold→spec→builder 正路。
      generatedBy: 'manifest-builder',
    },
    tracks,
    ...(spec.audio === undefined ? {} : { audio: spec.audio }),
  }

  // 段边界冻结：首次写锁，之后只准不变。这是「v1 帧窗不可变」的机器断言。
  const lockPath = resolve(root, typeof spec.lockFile === 'string' && spec.lockFile !== '' ? spec.lockFile : 'build/segment-lock.json')
  const current = segmentsOf(manifest)
  if (spec.lockSegments !== false) {
    if (existsSync(lockPath)) {
      const lock = loadJson(lockPath)
      const expected = Array.isArray(lock.segments) ? lock.segments : []
      if (!sameSegments(expected, current)) {
        const fmt = (list) => list.map((s) => `${s.id}@${String(s.startFrame)}–${String(s.endFrame)}`).join(' | ')
        fail([
          '段边界被改动了 —— 这是「重排」，不是「追加」，已拒绝生成。',
          `冻结值：${fmt(expected)}`,
          `本次值：${fmt(current)}`,
          '若确实要重排（例如旁白重新合成导致帧数变化），删掉 build/segment-lock.json 再跑，并在汇报里说明「本版重排了帧窗」。',
        ].join('\n'))
      }
    } else {
      mkdirSync(dirname(lockPath), { recursive: true })
      writeFileSync(lockPath, `${JSON.stringify({ lockedAt: Date.now(), segments: current }, null, 2)}\n`, 'utf8')
    }
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const seconds = (durationInFrames / fps).toFixed(2)
  console.log(`✔ ${outPath}`)
  console.log(`轨 ${String(tracks.length)} · 总帧 ${String(durationInFrames)}（${seconds}s @${String(fps)}fps）· 段 ${String(segments.length)}`)
  console.log('段表：')
  for (const segment of segments) {
    console.log(`  ${segment.id.padEnd(6)} ${String(segment.startFrame).padStart(5)}–${String(segment.endFrame).padStart(5)}  ${segment.text.slice(0, 28)}`)
  }
  console.log(`断言：段边界${existsSync(lockPath) ? '与冻结值一致' : '已冻结到 ' + lockPath}`)
  console.log(`下一步：render_composition({ manifestPath: "${outPath}", quality: "draft" })`)
}

main()
