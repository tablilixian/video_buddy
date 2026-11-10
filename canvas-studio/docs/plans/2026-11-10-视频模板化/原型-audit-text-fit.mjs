// 文本容量审计器（可复用模块 + CLI）
//
// 目的：让「模板的第 2 个到第 50 个」不需要人拍 maxChars —— 由排版几何自动反推。
//
// ## 为什么需要单独一个模块
//
// 模板 = manifest 骨架 + slots.json。slots.json 里 `maxChars` 是**硬承诺**：填超过就被拦。
// 人拍这个数字必然偏向乐观（"7 个字应该够吧"），而实际能不能放下取决于
// `box` 几何 + variant 的字号/行数预算。这份逻辑散在四个地方，抄一遍就会漂移：
//
//   src/remotion/components/TextCard.tsx       四个 variant 的预算分支
//   src/remotion/subtitle-fit.ts               subtitle 的宽/高/字号/行数求解
//   src/remotion/data-card-metrics.ts          dataCard 的等比缩放
//   src/remotion/timing.ts                     fitTextPolicy（折行 + 缩字号）
//
// 所以本模块**直接 import 仓库真实函数**，不复制任何公式（只有 `bullets` 的 42px
// 圆点内距是常量，因为组件里也没导出）。
//
// ## 两套排版模型（关键，别用一个函数打天下）
//
// A. flow   —— subtitle / title / bullets：走 `fitTextPolicy`，文字**先折行、放不下再缩字号**。
//              容量 = 二分「字号一分不降」时的最长全角串。
// B. fixed  —— dataCard：**不走** fitTextPolicy。标题 `lines.join(' ')` 拼成一行、
//              字号固定 `40 × scale`、内容宽 `940 × scale` ⇒ 容量 = floor(940/40) = 23，
//              与画布分辨率、box 尺寸**全都无关**（scale 在宽/字号上约掉）。
//              把它按 flow 处理会算出「能折 6 行」的假容量 —— 实测组件根本不折行。
//
// ## 已知偏差（必须知道，否则会误信数字）
//
// 本模块调用 `fitTextPolicy` 时**不传** `measure`（浏览器 Canvas 实测器），走内置估算。
// 真机渲染用实测器，两者对中西混排可能差 ~1 个字宽。所以：
//   · 全中文文案：估算 = 实测（中文字宽恒等于字号），可直接用。
//   · 中英混排：把审计值当**上限**，slots.json 里可再留 1 字余量。
// 这条差异只在真机验证时才能消掉，属于已知残余风险。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 相对定位到 canvas-studio/lib —— 本仓有两份 checkout（开发 / 运行时），
// 硬编码绝对路径会让审计结果来自**另一份代码**，这里的结论就不可信了。
const LIB = path.resolve(HERE, '../../../lib/remotion')

const { subtitleFitBudget } = await import(`${LIB}/subtitle-fit.js`)
const { dataCardMetrics, dataCardDesignHeight, DATA_CARD_CONTENT_WIDTH } = await import(
  `${LIB}/data-card-metrics.js`
)
const { fitTextPolicy } = await import(`${LIB}/timing.js`)

/**
 * 全角字数搜索上界。
 *
 * 不能设小：多行槽位的容量 = maxLines × 每行容量，铺满型 subtitle 是 3×36 = 108，
 * 用 80 会把它截成 80（低估）。400 足够覆盖 1080p 下的所有 variant。
 */
const MAX_AUDIT_CHARS = 400
/** `bullets` 每行圆点占位：点径 18 + 右边距 24（TextCard.tsx 的 bullets 分支内联常量）。 */
const BULLET_GUTTER_PX = 42
/** `bullets` 内层 div 写死的宽（TextCard.tsx:340 `width: 900`）。 */
const BULLETS_FIXED_WIDTH_PX = 900
/**
 * 容器裁切的安全余量（px）。
 *
 * 为什么必须有：`heading` 的 box.w=21.88% 在 1920 下是 420.096px，而 5 个 84px 全角字
 * 正好 420px —— **刚好等于**容器宽。几何上"放得下"，但比例字体的实际字形宽不等于
 * `fontPx`（`fitTextPolicy` 无 measure 时也走估算），零余量必然在真机上裁掉一点。
 *
 * 实测印证：作者手写的 `heading.maxChars` 就是 4 而不是 5。所以这条余量不是保守，
 * 是把"刚好等于"正确地判为"不安全"。
 */
const CLIP_SAFETY_PX = 4
/** `dataCard` 标题设计字号（TextCard.tsx dataCard 分支 `px(40)`）。 */
const DATA_CARD_TITLE_FONT_PX = 40

/**
 * 显示宽度：全角 = 1，半角 = 0.5。
 *
 * 为什么不能按字符数：`01` 是 2 个字符但只占 1 个字宽。用它做上限会把
 * 合法的序号判成超长（实测踩到过，三组内容全红）。
 */
export function displayLen(text) {
  let n = 0
  for (const ch of String(text).replace(/\r?\n/g, '')) {
    n += /[\u0000-\u00ff]/.test(ch) ? 0.5 : 1
  }
  return n
}

/** 从 manifest 取画布尺寸（构建期常量，缺省 1920×1080）。 */
export function canvasOf(manifest) {
  const meta = manifest?.meta ?? {}
  const width = Number.isFinite(meta.width) ? meta.width : 1920
  const height = Number.isFinite(meta.height) ? meta.height : 1080
  return { width, height }
}

/**
 * 求一条文本轨的排版模型（`flow` 或 `fixed`）。
 *
 * 每个分支都标注了 `TextCard.tsx` 的对应行，改动组件时必须同步这里。
 */
export function fitModelOf(track, canvas) {
  const box = track?.box
  const variant = track?.variant
  const W = canvas.width
  const H = canvas.height
  const boxW = box === undefined ? undefined : (box.w / 100) * W
  const boxH = box === undefined ? undefined : (box.h / 100) * H

  if (variant === 'subtitle') {
    // TextCard.tsx:197-243 → subtitleFitBudget。带 box 时 maxWidthPx **已扣** padX 16×2。
    const b = subtitleFitBudget({
      box: box === undefined ? undefined : { w: box.w, h: box.h },
      canvasWidth: W,
      canvasHeight: H,
    })
    return {
      kind: 'flow',
      maxWidthPx: b.maxWidthPx,
      baseFontPx: b.baseFontPx,
      maxLines: b.maxLines,
      // 文字盒就是容器内边，不会额外裁；无 box 时按画布 86% 居中，也不会裁。
      clipWidthPx: undefined,
    }
  }

  if (variant === 'title') {
    // TextCard.tsx:246-261：宽度按画布 90%，**未扣**任何 padding（div 无 padding）。
    // 带 box 时容器收窄到 boxW 且有 overflow:hidden ⇒ 超出部分被裁（不缩字号）。
    return {
      kind: 'flow',
      maxWidthPx: Math.max(240, W * 0.9),
      baseFontPx: 84,
      maxLines: 2,
      clipWidthPx: boxW,
    }
  }

  if (variant === 'dataCard') {
    // TextCard.tsx:272-327：标题 `lines.join(' ')` 单行、字号固定 `40×scale`，
    // 内容宽 `940×scale`。scale 在两者上约掉 ⇒ 容量是常量。
    const titleLines = Array.isArray(track.text) ? track.text.length : String(track.text ?? '').split('\n').length
    const designHeight = dataCardDesignHeight({ titleLines, dataRows: (track.data ?? []).length })
    const metric = dataCardMetrics(box, W, { canvasHeight: H, designHeight })
    const contentWidthPx = DATA_CARD_CONTENT_WIDTH * metric.scale
    const fontPx = DATA_CARD_TITLE_FONT_PX * metric.scale
    return {
      kind: 'fixed',
      contentWidthPx,
      fontPx,
      scale: metric.scale,
      // 组件把多行 join(' ') 拼成单行 ⇒ 物理上只有 1 行。
      maxLines: 1,
    }
  }

  // bullets（以及任何未识别的 variant 兜底）：TextCard.tsx:329-345。
  // 注意 ① 内层 div 写死 width:900，不随画布/box 变（既有瑕疵，见下）；
  //     ② maxWidthPx 未扣每行 42px 圆点 ⇒ 直接用会**偏宽**，必须再扣。
  const rawMaxWidth = Math.min(BULLETS_FIXED_WIDTH_PX, Math.max(300, W * 0.9))
  const containerWidth = Math.min(boxW ?? W, BULLETS_FIXED_WIDTH_PX)
  return {
    kind: 'flow',
    maxWidthPx: Math.max(120, rawMaxWidth - BULLET_GUTTER_PX),
    baseFontPx: 48,
    maxLines: 6,
    clipWidthPx: containerWidth,
  }
}

/**
 * 量一条轨在某段文本下会不会出问题。
 *
 * 判据 = 不溢出（行数够）+ 不被容器裁 + **字号一分不降**。
 *
 * 为什么必须卡字号：`badge` 盒只有 137.9px 宽、基准 19px，放开字号能塞 13 个全角字，
 * 但字会被压到 10.5px（55%）—— 不可读。模板的价值是「审美已验证」，
 * 所以宁可让作者删字，也不让字缩水。
 */
export function measure(track, text, canvas) {
  const model = fitModelOf(track, canvas)
  const str = String(text)

  if (model.kind === 'fixed') {
    const widest = Math.max(
      ...str.split('\n').map((l) => displayLen(l) * model.fontPx),
      0,
    )
    return {
      model,
      overflow: str.split('\n').length > model.maxLines,
      // 安全余量随 scale 走（dataCard 整体等比缩放）
      clipped: widest > model.contentWidthPx - CLIP_SAFETY_PX * model.scale,
      fontPx: model.fontPx,
      baseFontPx: model.fontPx,
      lineCount: str.split('\n').length,
      maxLines: model.maxLines,
    }
  }

  const fitted = fitTextPolicy(str, {
    maxWidthPx: model.maxWidthPx,
    baseFontPx: model.baseFontPx,
    maxLines: model.maxLines,
  })
  const lines = Array.isArray(fitted.lines) ? fitted.lines : String(fitted.lines).split('\n')
  const overflow = lines.length > model.maxLines
  const widestPx = Math.max(...lines.map((l) => displayLen(l) * fitted.fontPx), 0)
  const clipped =
    model.clipWidthPx !== undefined && widestPx > model.clipWidthPx - CLIP_SAFETY_PX
  return {
    model,
    overflow,
    clipped,
    fontPx: fitted.fontPx,
    baseFontPx: model.baseFontPx,
    lineCount: lines.length,
    maxLines: model.maxLines,
  }
}

/** 单条轨的容量：最大能放几个全角字（不缩号、不溢出、不被裁）。 */
export function auditTrack(track, canvas) {
  const model = fitModelOf(track, canvas)

  if (model.kind === 'fixed') {
    // 常量解，不用二分：容量 = 内容宽 / 字号，scale 约掉。
    const maxChars = Math.floor(model.contentWidthPx / model.fontPx)
    // dataCard 会等比缩放：容量恒定，但**字号会变小** ⇒ 容量审计看不见的风险，得单独报。
    // 阈值依据：设计字号 40px；×0.6 = 24px（正文可读下限），×0.4 = 16px
    //（与 subtitle 的 SUBTITLE_MIN_FONT_PX 同值，仓里已认定「再小也不至于不可读」）。
    const warnings = []
    if (model.scale < 0.4) {
      warnings.push({
        level: 'error',
        text: `dataCard 缩放系数 ${model.scale.toFixed(2)} ⇒ 标题字号只剩 ${model.fontPx.toFixed(1)}px，低于 16px 可读下限`,
      })
    } else if (model.scale < 0.6) {
      warnings.push({
        level: 'warn',
        text: `dataCard 缩放系数 ${model.scale.toFixed(2)} ⇒ 标题字号 ${model.fontPx.toFixed(1)}px（<24px），手机上看会偏小`,
      })
    }
    return { maxChars, maxLines: model.maxLines, model, warnings }
  }

  let best = 0
  for (let n = 1; n <= MAX_AUDIT_CHARS; n += 1) {
    const m = measure(track, '测'.repeat(n), canvas)
    // 全扫描取最大值，不用「遇到失败就 break」—— 后者隐含「容量单调」的假设，
    // 而 `title` 带窄 box 时折行可能让行宽反向收敛，届时会低估。
    if (m.overflow || m.clipped || m.fontPx < m.baseFontPx) continue
    best = n
  }
  return { maxChars: best, maxLines: model.maxLines, model, warnings: [] }
}

/** 扫描骨架里的 `{{slot}}` 占位符 → Map<slotId, trackId[]>。 */
export function scanSlots(manifest) {
  const PLACEHOLDER = /^\{\{([^{}]+)\}\}$/
  const used = new Map()
  for (const t of manifest.tracks ?? []) {
    if (t.type !== 'textCard') continue
    const m = PLACEHOLDER.exec(String(t.text))
    if (!m) continue
    const id = m[1]
    if (!used.has(id)) used.set(id, [])
    used.get(id).push(t.id)
  }
  return used
}

/**
 * 审计整份模板骨架。
 *
 * 一槽多轨时取 **min** —— 所有消费该槽位的轨都必须放得下（`badge` 就是两段共用）。
 *
 * @returns {Map<string, {slotId:string, maxChars:number, maxLines:number, trackIds:string[], perTrack:object[], variant:string}>}
 */
export function auditTemplate(manifest) {
  const canvas = canvasOf(manifest)
  const used = scanSlots(manifest)
  const trackById = new Map((manifest.tracks ?? []).map((t) => [t.id, t]))
  const out = new Map()

  for (const [slotId, trackIds] of used) {
    const perTrack = trackIds.map((id) => {
      const t = trackById.get(id)
      const a = auditTrack(t, canvas)
      return { trackId: id, variant: t?.variant ?? '(default)', ...a }
    })
    out.set(slotId, {
      slotId,
      maxChars: Math.min(...perTrack.map((x) => x.maxChars)),
      maxLines: Math.min(...perTrack.map((x) => x.maxLines)),
      trackIds,
      perTrack,
      variant: perTrack.map((x) => x.variant).join('+'),
      warnings: perTrack.flatMap((x) => x.warnings.map((w) => ({ ...w, trackId: x.trackId }))),
    })
  }
  return out
}

/**
 * 审计结果与作者声明的对账。
 *
 * ## 语义（重要，别写成「覆盖」）
 *
 * 审计值 = **几何硬上限**：超过它，文字必然被裁或字号被缩。
 * 作者声明 = **设计判断**：常常故意小于上限（例如 `heading` 几何能放 5 字，
 * 但 usage 写「4 字最稳」；`title` 物理能折 2 行，但主标题不该折行）。
 *
 * 所以三档：
 *   · declared > audited  → **违规**：这个数字写进去一定裁字 ⇒ 必须改成上限
 *   · declared < audited  → **合法收紧**：保留作者值，只提示「还能放宽到 N」
 *   · declared === audited → 一致
 *
 * 返回新对象，不改入参（便于 diff）。
 */
export function reconcile(slotsDoc, audit) {
  const next = JSON.parse(JSON.stringify(slotsDoc))
  const violations = []
  const loosened = []
  const undeclaredInSlots = []

  for (const s of next.slots ?? []) {
    const a = audit.get(s.id)
    if (a === undefined) {
      undeclaredInSlots.push(s.id)
      continue
    }
    for (const field of ['maxChars', 'maxLines']) {
      const declared = s[field]
      const limit = a[field]
      if (!Number.isFinite(declared)) {
        violations.push({ id: s.id, field, from: declared, to: limit, reason: '未声明' })
        s[field] = limit
      } else if (declared > limit) {
        violations.push({ id: s.id, field, from: declared, to: limit, reason: '超过几何上限' })
        s[field] = limit
      } else if (declared < limit) {
        loosened.push({ id: s.id, field, declared, limit })
      }
    }
  }
  const undeclaredInSkeleton = [...audit.keys()].filter((k) => !next.slots.some((s) => s.id === k))
  return { slotsDoc: next, violations, loosened, undeclaredInSlots, undeclaredInSkeleton }
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
/** 模板目录里必须有的两份文件。 */
export const TEMPLATE_FILES = { manifest: 'manifest.template.json', slots: 'slots.json' }

/** 读一个模板目录，返回 { manifest, slotsDoc, dir }。 */
export function loadTemplate(dir) {
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
  return {
    dir,
    manifest: readJson(TEMPLATE_FILES.manifest),
    slotsDoc: readJson(TEMPLATE_FILES.slots),
  }
}

function main() {
  const args = process.argv.slice(2)
  const dirs = args.filter((a) => !a.startsWith('--'))
  const write = args.includes('--write')
  const targets = dirs.length > 0 ? dirs : [path.join(HERE, '原型-template-b1b2')]

  let failed = false
  for (const dir of targets) {
    const { manifest, slotsDoc } = loadTemplate(dir)
    const audit = auditTemplate(manifest)
    const r = reconcile(slotsDoc, audit)

    console.log('='.repeat(78))
    console.log(`模板：${path.basename(dir)}  （${manifest.tracks.length} 轨 / 画布 ${manifest.meta.width}×${manifest.meta.height}）`)
    console.log('='.repeat(78))
    console.log('槽位          变体                  几何上限  声明      消费轨')
    for (const [slotId, a] of audit) {
      const decl = slotsDoc.slots.find((s) => s.id === slotId)
      const mark = r.violations.some((v) => v.id === slotId)
        ? '  ✗ 超过上限'
        : r.loosened.some((v) => v.id === slotId)
          ? '  · 作者收紧'
          : '  ✓'
      const declTxt = decl === undefined ? '—' : `${decl.maxChars}字/${decl.maxLines}行`
      console.log(
        `  ${slotId.padEnd(12)} ${String(a.variant).padEnd(20)} ${String(a.maxChars).padStart(3)}字/${a.maxLines}行 `.padEnd(12)
        + `${declTxt.padStart(9)}  ${a.trackIds.join('+')}${mark}`,
      )
    }

    console.log('')
    if (r.violations.length === 0) {
      console.log('  违规（声明 > 几何上限，一定会裁字/缩号）：0 处 ✓')
    } else {
      failed = true
      console.log(`  违规 ${r.violations.length} 处（必须修，否则填满声明值必然裁字）：`)
      for (const v of r.violations) console.log(`    ✗ ${v.id}.${v.field}: ${v.from} → ${v.to}（${v.reason}）`)
    }
    if (r.loosened.length > 0) {
      console.log(`  合法收紧 ${r.loosened.length} 处（保留作者值，仅提示余量）：`)
      for (const v of r.loosened) console.log(`    · ${v.id}.${v.field}: 声明 ${v.declared} < 上限 ${v.limit}`)
    }
    if (r.undeclaredInSlots.length > 0) {
      failed = true
      console.log(`  ✗ slots.json 声明了骨架里不存在的槽位：${r.undeclaredInSlots.join(', ')}`)
    }
    if (r.undeclaredInSkeleton.length > 0) {
      failed = true
      console.log(`  ✗ 骨架用了但 slots.json 未声明：${r.undeclaredInSkeleton.join(', ')}`)
    }

    const warns = [...audit.values()].flatMap((a) => a.warnings)
    const errs = warns.filter((w) => w.level === 'error')
    if (warns.length > 0) {
      console.log(`  可读性提示 ${warns.length} 条：`)
      for (const w of warns) console.log(`    ${w.level === 'error' ? '✗' : '!'} ${w.trackId}: ${w.text}`)
    }
    if (errs.length > 0) failed = true

    if (write && r.violations.length > 0) {
      fs.writeFileSync(path.join(dir, TEMPLATE_FILES.slots), `${JSON.stringify(r.slotsDoc, null, 2)}\n`, 'utf8')
      console.log(`  已回写 ${TEMPLATE_FILES.slots}：仅修违规项，作者收紧的值与 usage/label/example 全部保留`)
    } else if (r.violations.length > 0) {
      console.log('  （加 --write 可回写：只改违规项）')
    }
    console.log('')
  }
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
