/**
 * REQ-022（CV-295）· `render(storyboard, version?) → HTML` 纯函数。
 *
 * 契约见 `docs/plans/REQ-022-storyboard数据契约.md` §11：**纯函数、模板化**，
 * v1 与 v5 同构只换数据（这就是 req1「稳定转 HTML」的落点）。
 *
 * ## 形态基准
 *
 * 视觉语言取自拍板体验稿 `docs/plans/R-P0-01-storyboard-stage-demo.html`
 * （暗色 editorial：琥珀主色 + 衬线感标题 + 分节 tab + 两级分镜卡 + 角色 SAME 块）。
 * 这里做两处**刻意的改造**：
 *
 * 1. **零 JS**：产物是「Host 出 HTML → iframe 同源加载」，不引入脚本就没有
 *    跨帧通信与安全面；分节 tab 退化为**锚点跳转**（`href="#s4"`），全部内容
 *    仍然一次渲染出来 —— 对「审阅」这个用途反而更好（不用点九次）。
 * 2. **空节可见**：某一节还没写时给出「本节尚未填充」而不是留白 —— 这是
 *    「一步一步填满」的可视化基础：用户一眼看出 agent 补到哪了、还差哪几节。
 *
 * ## 安全底线
 *
 * 内容全部来自 agent / 用户（`claim` / `visual` / `promptEn` …），**一律转义**。
 * 这是 XSS 的唯一入口，`escapeHtml` 是硬要求，不是可选项（连 `source` URL 也走
 * 转义 + `rel="noreferrer"`）。
 *
 * ## 与 seed 的边界
 *
 * 这里只负责**给人看**。分镜节点的 `text`（带 `【视觉】` 等稳定字段标签、供
 * 反向解析回写）是另一套模板，住在 `storyboard-seed.ts` —— 两者共享同一份字段名
 * 定义，但产物不同：一个是 HTML，一个是节点文本。
 */
import type {
  StoryboardAsset,
  StoryboardAssetRef,
  StoryboardCharacter,
  StoryboardDocument,
  StoryboardSections,
  StoryboardShot,
} from './contracts/storyboard.js'
import type { DiffEntry } from './storyboard-diff.js'
// 时长对齐复用合成侧同一把尺子（CV-142，0.25s）—— 两处各写一个常量迟早会漂。
import { TIMELINE_DRIFT_TOLERANCE_SEC } from './compose.js'

/** 媒体 URL 解析器（渲染保持零 IO，由路由侧提供；缺省 = 不渲染缩略图）。 */
type MediaUrl = ((ref: StoryboardAssetRef) => string | undefined) | undefined

/** HTML 文本转义（内容全部来自 agent / 用户，唯一防 XSS 的地方）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

/** 数字的安全展示（NaN / Infinity 兜底成 `—`，避免把 `NaN` 渲染给用户）。 */
function num(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

/** 空值统一渲染成占位符，让「缺项」在页面上可见（而不是一片空白）。 */
function orDash(value: string): string {
  return value.trim() === '' ? '<span class="dash">—</span>' : escapeHtml(value)
}

/** 节 id / 标题（顺序即 tab 序，与契约 §4.2 的九节一致）。 */
export const STORYBOARD_SECTION_TABS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 's0', label: '00 创意理解' },
  { id: 's1', label: '01 素材与事实' },
  { id: 's2', label: '02 视觉规范' },
  { id: 's3', label: '03 旁白设计' },
  { id: 's4', label: '04 分镜脚本' },
  { id: 's5', label: '05 角色设定' },
  { id: 's6', label: '06 声音设计' },
  { id: 's7', label: '07 素材清单' },
  { id: 's8', label: '08 硬约束' },
]

/**
 * 各节「怎么写」的一句话说明 —— 收进页脚折叠区。
 *
 * 空节正文只留一句「还没有 X。」（交付物正面要干净），写法指导需要时在
 * 「技术说明与各节写法」里展开。顺序必须与 `STORYBOARD_SECTION_TABS` 一一对应。
 */
const SECTION_GUIDE: readonly string[] = [
  '一句话意图 + 季节 / 时间 / 地域前提 —— 它决定后面所有环节的用词。',
  '素材需要从网上搜集时，每条事实都要带来源；搜不到的标「待核实」，不虚构。落地时待核实条会被丢弃。',
  '5 项 tokens（色彩 / 光线 / 材质 / 镜头语汇 / 节奏）会冻结成 Look 卡，此后每一镜的提示词都以它开头逐字节复用。',
  '旁白只在这里写一次，分镜按句号引用 —— 这样就不会出现「分镜表里的旁白与旁白节对不上」。',
  '两级结构：分镜是叙事单元，shot 是一次连续画面。同镜可多拍一条互为备份；备份拍不计入片长。',
  '人读描述（气质 / 面部 / 服装）只上这份文档；落画布的只有机器要吃的「锁定提示词」。',
  '声音不是「配个 BGM」，而是一份预算表：响度、侧链避让、音效点都要写清。',
  '需要上传 / 搜集的素材。只存引用不存副本，落地时只校验引用有效性。',
  '可执行的生成纪律。落地后每一条都会注入 system prompt，逐次生成都必须遵守。',
]

/** 参数条读数（顶部一行，打开文档第一眼完成量化对齐）。 */
export interface StoryboardSummary {
  readonly scenes: number
  readonly shots: number
  /** 备份拍条数（结构上占一行，但不算进片长 —— 它们是同镜的备用拍法）。 */
  readonly backups: number
  /** 时长合计（秒）：**只累加主拍**，备份拍不计入片长。 */
  readonly shotDuration: number
  readonly narrationDuration: number
  readonly characters: number
  readonly constraints: number
}

/**
 * 汇总参数条读数（纯函数，渲染与测试共用）。
 *
 * 备份拍（`shot.backup`）是「同一镜的第二条拍法」，不是额外的银幕时间 —— 片长合计
 * 必须把它排除，否则对齐读数会凭空多出几十秒，用户会以为总时长超了。
 */
export function summarizeStoryboard(sections: StoryboardSections): StoryboardSummary {
  let shots = 0
  let backups = 0
  let shotDuration = 0
  for (const scene of sections['04_storyboard'].scenes) {
    for (const shot of scene.shots) {
      shots += 1
      if (shot.backup) backups += 1
      else shotDuration += shot.duration
    }
  }
  const narrationDuration = sections['03_narration'].lines.reduce((sum, line) => sum + line.duration, 0)
  return {
    scenes: sections['04_storyboard'].scenes.length,
    shots,
    backups,
    shotDuration,
    narrationDuration,
    characters: sections['05_characters'].length,
    constraints: sections['08_constraints'].length,
  }
}

/** tab 上只显示中文名（编号已在节标题出现，这里再写一遍就是噪音）。 */
function tabText(label: string): string {
  return label.replace(/^\d+\s+/u, '')
}

/**
 * 秒 → `mm:ss.d` 时间码（起镜时点，一秒一位小数足够分镜表对齐）。
 * 非有限值 / 负数一律 `—`，不把 `NaN` 印到交付物上。
 */
function timecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/**
 * 画幅 → CSS `aspect-ratio` 值（`16:9` → `16/9`）。
 *
 * 缩略图容器按它预留高度，避免图加载后整页跳动（CLS）。读不出合法比例时回退
 * `16/9` —— 宁可占位比例略偏，也不要留一个会塌的零高度盒子。
 */
function aspectRatioCss(aspect: string): string {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/u.exec(aspect)
  if (match === null) return '16/9'
  const w = Number(match[1])
  const h = Number(match[2])
  return w > 0 && h > 0 ? `${match[1]}/${match[2]}` : '16/9'
}

/**
 * 每节的「是否已填充」判据 —— 驱动顶部完成度条。
 *
 * 这是「一步一步填满」的可视化基础：agent 每写一节，条上就点亮一格。
 * §03 旁白与 §06 声音在**无旁白 / 无 BGM** 的片子里天然为空，所以它们只算
 * 「已处理 / 未处理」而不算「缺失」—— 判据用「是否非空」，不额外惩罚空片。
 */
function sectionFilled(sections: StoryboardSections): readonly boolean[] {
  return [
    sections['00_creative'].brief.trim() !== '',
    sections['01_facts'].facts.length > 0,
    sections['02_visual'].tokens.length > 0,
    sections['03_narration'].lines.length > 0,
    sections['04_storyboard'].scenes.length > 0,
    sections['05_characters'].length > 0,
    sections['06_sound'].bgm.bpm > 0 || sections['06_sound'].sfx.length > 0,
    sections['07_assets'].length > 0,
    sections['08_constraints'].length > 0,
  ]
}

/**
 * 对比模式上下文。`on:false` 时 `marked()` 原样返回，渲染结果与普通模式**逐字节一致**
 * ——这条是「v1 与活副本同构」那条测试的保证，也让对比模式零成本可选。
 */
interface DiffContext {
  readonly on: boolean
  readonly byPath: ReadonlyMap<string, { kind: string; from?: string; to?: string }>
}

const NO_DIFF: DiffContext = { on: false, byPath: new Map() }

/** 给一个已渲染好的值套上差异标记（无差异 / 未开对比时原样返回）。 */
function marked(ctx: DiffContext, path: string, html: string): string {
  if (!ctx.on) return html
  const entry = ctx.byPath.get(path)
  if (entry === undefined) return html
  const tip = entry.kind === 'added'
    ? `新增：${entry.to ?? ''}`
    : entry.kind === 'removed'
      ? `已删除：${entry.from ?? ''}`
      : `${entry.from ?? '—'} → ${entry.to ?? '—'}`
  return `<span class="chg ${escapeHtml(entry.kind)}" title="${escapeHtml(tip)}">${html}</span>`
}

/** 已填充的节数（0..9）—— 版本列表与进度条共用同一判据，不各算一份。 */
export function filledSectionCount(sections: StoryboardSections): number {
  return sectionFilled(sections).filter(Boolean).length
}

/** 空节占位（先说清「这节还没填」，而不是留白让人以为坏了）。 */
function emptySection(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`
}

/** 用户原始创意引用块（有原话才渲染；纯展示，不参与九节完成度与对比模式）。 */
function renderSourceIdea(sourceIdea: string | undefined): string {
  const idea = sourceIdea?.trim() ?? ''
  if (idea === '') return ''
  return `<div class="user-brief"><div class="user-brief-label">你的原始创意 · 一切开始的地方</div><div class="user-brief-text">${escapeHtml(idea)}</div></div>`
}

// ────────────────────────────── 各节渲染 ──────────────────────────────

function renderCreative(sections: StoryboardSections, ctx: DiffContext): string {
  const brief = sections['00_creative'].brief.trim()
  if (brief === '') return emptySection('还没有写创意理解。')
  return `<p class="intro">${marked(ctx, '00 创意理解.创意', escapeHtml(brief))}</p>`
}

function renderFacts(sections: StoryboardSections, ctx: DiffContext): string {
  const facts = sections['01_facts'].facts
  if (facts.length === 0) {
    return emptySection('还没有事实锚点。')
  }
  return `<table class="plain"><thead><tr><th style="width:52%">结论</th><th>来源</th><th style="width:76px">状态</th></tr></thead><tbody>${
    facts.map((fact) => `<tr>
      <td>${marked(ctx, `01 事实.${fact.claim}`, orDash(fact.claim))}</td>
      <td>${marked(ctx, `01 事实.${fact.claim}.来源`, fact.source.trim() === ''
        ? '<span class="dash">—</span>'
        : `<a href="${escapeHtml(fact.source)}" rel="noreferrer" target="_blank">${escapeHtml(fact.source)}</a>`)}</td>
      <td>${marked(ctx, `01 事实.${fact.claim}.状态`, `<span class="pill ${fact.status === 'verified' ? 'ok' : 'todo'}">${fact.status === 'verified' ? '已核实' : '待核实'}</span>`)}</td>
    </tr>`).join('')
  }</tbody></table>`
}

/**
 * 基调样张大图（CV-307）—— 一张图承载全部 5 维，与下方 tokens **并置**成图文混排。
 *
 * **点图放大走 app 内浮层（CV-311）**：故事板产物是刻意的**零 JS** 文档（见文件头注），
 * 所以不给它引脚本 —— 点击由**父层** `StudioFrame` 在同源 iframe 的 document 上
 * 捕获拦截（`a.zoom` 钩子），改开 app 内可缩放浮层 `ImageZoomModal`；锚点上的
 * `target="_blank"` 只作**降级兜底**（父层监听没挂上时退回旧行为，不会比现状更差），
 * 正常路径下被 `preventDefault` 拦下，绝不跳系统浏览器（那条路会被资产路由的
 * loopback authority 403，同 CV-246a 真机结论）。URL 与 `alt` 一律转义
 * （图源来自 agent 生成，同属内容面）。
 *
 * URL 由调用方解析好再传进来（而不是在这里调 `media`）—— 解析结果决定要不要出
 * 「引用悬空」提示（CV-310），两者必须看**同一次**解析，不能各调一次各判一遍。
 */
function renderLookFigure(lookRef: StoryboardAssetRef | undefined, url: string | undefined): string {
  if (lookRef === undefined || url === undefined) return ''
  return `<figure class="look-fig">
      <a class="zoom" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="点开看原图（应用内打开，可缩放）">
        <img src="${escapeHtml(url)}" alt="视觉基调样张" loading="lazy" />
      </a>
      <figcaption>这张样张承载全部 5 维 · <span class="mono-key">${escapeHtml(lookRef.id)}</span></figcaption>
    </figure>`
}

/**
 * 「引用在、图取不到」的显式提示（CV-310）。
 *
 * 以前这种情况会**静默塌回**「还没有视觉规范」空态：§02 明明挂着 `lookRef`，用户
 * 看到的却是「还没有」—— 既不知道样张已经生成过，也不知道该找谁。这与「挂上了却
 * 看不到」是同一类伤害：**展示面必须说出事实，不能替用户把状态抹平**。
 *
 * 只在「解析器在场、却解析不出 URL」时提示 —— `mediaUrl === undefined` 一律视为
 * **无法判定**（既可能是没传解析器，也可能是路由那条「画布读不出来的整体降级」），
 * 此时保持静默，不制造假警报。
 */
function renderLookDangling(lookRef: StoryboardAssetRef): string {
  return `<p class="look-dangling">基调样张引用存在（画布节点 <span class="mono-key">${escapeHtml(lookRef.id)}</span>），但取不到图 —— 该节点可能已被删除，或产物还没落盘。</p>`
}

function renderVisual(sections: StoryboardSections, ctx: DiffContext, media: MediaUrl): string {
  const tokens = sections['02_visual'].tokens
  const lookRef = sections['02_visual'].lookRef
  const lookUrl = lookRef === undefined || media === undefined ? undefined : media(lookRef)
  const lookFigure = renderLookFigure(lookRef, lookUrl)
  const lookDangling = lookRef !== undefined && media !== undefined && lookUrl === undefined
    ? renderLookDangling(lookRef)
    : ''
  if (tokens.length === 0 && lookFigure === '' && lookDangling === '') {
    return emptySection('还没有视觉规范。')
  }
  const tokenCards = tokens.length === 0
    ? ''
    : `<div class="tokens">${tokens.map((token) => `
    <div class="token"><b>${escapeHtml(token.k)}</b>${marked(ctx, `02 视觉规范.${token.k}`, orDash(token.v))}</div>`).join('')}</div>`
  // 有图 → 图文并置（宽栏左右、窄栏上下）；无图 → 纯文字。
  // 无图分两种：本来就没引用（与旧行为逐字节一致）／有引用但取不到图（CV-310 出提示）。
  return lookFigure === ''
    ? `${lookDangling}${tokenCards}`
    : `<div class="look-row">${lookFigure}${tokenCards}</div>`
}

function renderNarration(sections: StoryboardSections, ctx: DiffContext): string {
  const lines = sections['03_narration'].lines
  if (lines.length === 0) return emptySection('本片无旁白（或这一节还没写）。')
  return `<table class="plain"><thead><tr><th style="width:74px">句号</th><th>旁白</th><th style="width:74px">时长</th><th style="width:112px">引用 shot</th></tr></thead><tbody>${
    lines.map((line) => `<tr>
      <td><span class="mono-key">${orDash(line.id)}</span></td>
      <td>${marked(ctx, `03 旁白.${line.id}.文本`, orDash(line.text))}</td>
      <td>${marked(ctx, `03 旁白.${line.id}.时长`, `${num(line.duration)}s`)}</td>
      <td>${line.shotRef === undefined ? '<span class="dash">—</span>' : `<span class="mono-key">${escapeHtml(line.shotRef)}</span>`}</td>
    </tr>`).join('')
  }</tbody></table>
  <p class="note">旁白只在「03 旁白设计」写一次，分镜按句号引用 —— 这样就不会出现「分镜表里的旁白与旁白节对不上」。</p>`
}

/**
 * 一镜（导演分镜表的一行）。`start` 是累计起镜时点，`aspect` 是画幅（缩略图占位比）。
 *
 * 效果图**没有独立列**：有图才在画面下方补一行（`cell-extra`），没图就是干净的表格 ——
 * 「没有图」不该在交付物里占一个空格子。
 */
function renderShot(
  sceneId: string,
  shot: StoryboardShot,
  mirror: number,
  start: number,
  aspect: string,
  ctx: DiffContext,
  media: MediaUrl,
): string {
  const at = (field: string): string => `04 分镜.${sceneId}.${shot.id}.${field}`
  const rawUrl = shot.refImage === undefined || media === undefined ? undefined : media(shot.refImage)
  const figure = rawUrl === undefined || shot.refImage === undefined
    ? ''
    : `<figure class="shot-fig"><img src="${escapeHtml(rawUrl)}" style="--shot-ar:${aspect}" alt="${escapeHtml(shot.id)} 效果图" /><figcaption>效果图 · <span class="mono-key">${escapeHtml(shot.refImage.id)}</span></figcaption></figure>`
  // prompt 写在「画面」格里（可折叠），不额外占一行；缺 promptEn 只留一个小角标，
  // 不把同一句提示重复印满整张表。
  const prompt = shot.promptEn === undefined || shot.promptEn.trim() === ''
    ? '<span class="miss-prompt" title="未写英文 prompt（promptEn）—— 阶段二组装每镜提示词时缺了基底">缺 prompt</span>'
    : `<details class="prompt"><summary>英文 prompt</summary><pre lang="en">${marked(ctx, at('英文 prompt'), escapeHtml(shot.promptEn))}</pre></details>`
  const extra = figure === '' ? '' : `<tr class="cell-extra"><td colspan="7">${figure}</td></tr>`
  const vo = shot.narrationRef === undefined || shot.narrationRef === ''
    ? '<span class="dash">—</span>'
    : `<span class="vo mono-key">${marked(ctx, at('旁白引用'), escapeHtml(shot.narrationRef))}</span>`
  return `<tr${shot.backup ? ' class="backup"' : ''}>
      <th scope="row" class="c-id"><span class="shot-id">${marked(ctx, `04 分镜.${sceneId}.${shot.id}`, orDash(shot.id))}</span>${shot.backup ? ' <span class="tag-backup">备份拍</span>' : ''}</th>
      <td class="c-tc" data-lab="起">${timecode(start)}</td>
      <td class="c-dur" data-lab="时长"><b>${num(shot.duration)}s</b><small>${Number.isFinite(shot.frames) ? `${String(shot.frames)}f` : '—'} · 镜 ${String(mirror)}</small></td>
      <td class="c-visual" data-lab="画面">${marked(ctx, at('画面'), orDash(shot.visual))}${prompt}</td>
      <td class="c-cam" data-lab="运镜">${marked(ctx, at('运镜'), `<span class="cam">${orDash(shot.camera)}</span>`)}</td>
      <td class="c-vo" data-lab="旁白">${vo}</td>
      <td class="c-sound" data-lab="声音">${marked(ctx, at('声音'), orDash(shot.audio))}</td>
    </tr>
    ${extra}`
}

function renderScenes(sections: StoryboardSections, ctx: DiffContext, media: MediaUrl, aspect: string, target: number): string {
  const scenes = sections['04_storyboard'].scenes
  if (scenes.length === 0) return emptySection('还没有分镜。')
  // 片长只算主拍（备份拍是同镜的备选，不占银幕时间）—— 与顶部读数同一口径。
  const primary = scenes.flatMap((scene) => scene.shots.filter((shot) => !shot.backup))
  const total = primary.reduce((sum, shot) => sum + shot.duration, 0)
  const drift = total - target
  const aligned = target <= 0 || Math.abs(drift) <= TIMELINE_DRIFT_TOLERANCE_SEC
  const alignNote = `<div class="align${aligned ? '' : ' warn'}">
      <span>时长对齐：Σ shot <b>${num(total)}s</b> / 目标 <b>${num(target)}s</b></span>
      <span class="${aligned ? 'ok' : 'warn-tx'}">${target <= 0
        ? '未设目标总时长'
        : aligned ? '已对齐' : `相差 ${drift > 0 ? '+' : ''}${num(drift)}s`}</span>
      <span class="spacer"></span>
      <span>${String(scenes.length)} 分镜 / ${String(primary.length)} 主拍${primary.length === totalShots(scenes) ? '' : ` + ${String(totalShots(scenes) - primary.length)} 备份`}</span>
    </div>`
  let mirror = 0
  const body = scenes.map((scene) => {
    let start = 0
    const rows: string[] = []
    for (const shot of scene.shots) {
      mirror += 1
      rows.push(renderShot(scene.id, shot, mirror, start, aspect, ctx, media))
      if (!shot.backup) start += shot.duration
    }
    const sceneDuration = scene.shots.filter((shot) => !shot.backup).reduce((sum, shot) => sum + shot.duration, 0)
    const pct = total > 0 ? Math.round(sceneDuration / total * 100) : 0
    return `<section class="scene shots">
      <div class="scene-head">
        <span class="scene-id">${orDash(scene.id)}</span>
        <span class="scene-title">${marked(ctx, `04 分镜.${scene.id}.分镜标题`, orDash(scene.title))}</span>
        <span class="scene-narr">${String(scene.shots.length)} 镜 · 占全片 ${String(pct)}%</span>
        <span class="scene-dur">小计 <b>${num(sceneDuration)}s</b></span>
      </div>
      <table class="shot-table">
        <caption class="sr-only">分镜 ${escapeHtml(scene.id || '未编号')} 拍摄清单</caption>
        <thead><tr>
          <th scope="col">镜号</th><th scope="col">起</th><th scope="col">时长</th><th scope="col">画面</th><th scope="col">运镜</th><th scope="col">旁白</th><th scope="col">声音</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </section>`
  }).join('')
  return `${alignNote}${body}`
}

/** 分镜总数（含备份拍）—— 顶部「N 主拍 + M 备份」用。 */
function totalShots(scenes: StoryboardSections['04_storyboard']['scenes']): number {
  return scenes.reduce((sum, scene) => sum + scene.shots.length, 0)
}

function renderCharacters(sections: StoryboardSections, ctx: DiffContext): string {
  const characters = sections['05_characters']
  if (characters.length === 0) return emptySection('还没有角色设定。')
  return `<div class="roles">${characters.map((character: StoryboardCharacter) => `
    <article class="role">
      <header class="role-head">
        <div class="role-tag">${orDash(character.label)}</div>
        <div class="role-name">${marked(ctx, `05 角色.${character.id}.姓名`, orDash(character.name))}</div>
        <div class="role-sub"><span class="mono-key">${orDash(character.id)}</span>${
          character.appearsIn.length === 0 ? '' : ` · 出场 ${character.appearsIn.map((id) => escapeHtml(id)).join(' / ')}`}</div>
      </header>
      <div class="role-body">
        ${character.tags.length === 0 ? '' : `<div class="role-tags">${character.tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}</div>`}
        <div class="rrow"><span class="lab">气质</span><span class="val">${marked(ctx, `05 角色.${character.id}.气质`, orDash(character.profile.temperament))}</span></div>
        <div class="rrow"><span class="lab">面部</span><span class="val">${marked(ctx, `05 角色.${character.id}.面部`, orDash(character.profile.face))}</span></div>
        <div class="rrow"><span class="lab">服装</span><span class="val">${marked(ctx, `05 角色.${character.id}.服装`, orDash(character.profile.costume))}</span></div>
        <div class="rrow"><span class="lab">配色</span><span class="val">${marked(ctx, `05 角色.${character.id}.主色`, orDash(character.palette.base))} / ${marked(ctx, `05 角色.${character.id}.点缀色`, orDash(character.palette.accent))}</span></div>
        <div class="same-label">锁定提示词（落画布 · 逐镜逐字节复用）</div>
        <div class="same">${marked(ctx, `05 角色.${character.id}.锁定提示词`, orDash(character.gen.lockedPrompt))}</div>
        ${character.gen.negativePrompt.trim() === '' ? '' : `<div class="rrow" style="margin-top:8px"><span class="lab">负向</span><span class="val">${marked(ctx, `05 角色.${character.id}.负向提示词`, escapeHtml(character.gen.negativePrompt))}</span></div>`}
      </div>
    </article>`).join('')}</div>
    <p class="note">上面「气质 / 面部 / 服装」只在这份文档里给人看，<b>不会落到画布</b> —— 画布只拿生成机器要吃的「锁定提示词」，避免意图文本污染节点。</p>`
}

function renderSound(sections: StoryboardSections, ctx: DiffContext): string {
  const { bgm, sfx } = sections['06_sound']
  const hasBgm = bgm.bpm > 0 || bgm.lufs !== 0 || bgm.sidechain.trim() !== ''
  if (!hasBgm && sfx.length === 0) return emptySection('还没有声音设计。')
  return `<div class="cards2">
    <div class="card"><h4>BGM</h4><ul>
      <li>BPM <b>${marked(ctx, '06 声音.BPM', bgm.bpm > 0 ? String(bgm.bpm) : '—')}</b></li>
      <li>响度 <b>${marked(ctx, '06 声音.响度', bgm.lufs !== 0 ? `${String(bgm.lufs)} LUFS` : '—')}</b></li>
      <li>侧链避让 <b>${marked(ctx, '06 声音.侧链避让', orDash(bgm.sidechain))}</b></li>
    </ul></div>
    <div class="card"><h4>音效点</h4><ul>${
      sfx.length === 0
        ? '<li><span class="dash">—</span></li>'
        : sfx.map((item, index) => `<li>${marked(ctx, `06 声音.音效点[${String(index + 1)}]`, escapeHtml(item))}</li>`).join('')
    }</ul></div>
  </div>`
}

function renderAssets(sections: StoryboardSections, ctx: DiffContext, media: MediaUrl): string {
  const assets = sections['07_assets']
  if (assets.length === 0) return emptySection('还没有素材清单。')
  return `<table class="plain"><thead><tr><th style="width:40%">素材</th><th style="width:78px">类型</th><th style="width:84px">状态</th><th>引用</th></tr></thead><tbody>${
    assets.map((asset: StoryboardAsset) => {
      const url = media === undefined ? undefined : media(asset.ref)
      const thumb = url === undefined ? '' : `<img class="asset-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(asset.name)}" />`
      return `<tr>
      <td>${marked(ctx, `07 素材.${asset.name}`, orDash(asset.name))}${thumb === '' ? '' : `<div>${thumb}</div>`}</td>
      <td>${marked(ctx, `07 素材.${asset.name}.类型`, escapeHtml(asset.type))}</td>
      <td>${marked(ctx, `07 素材.${asset.name}.状态`, `<span class="pill ${asset.status === 'ready' ? 'ok' : 'todo'}">${asset.status === 'ready' ? '已就绪' : '待上传'}</span>`)}</td>
      <td>${marked(ctx, `07 素材.${asset.name}.引用`, `<span class="mono-key">${escapeHtml(asset.ref.kind)}:${escapeHtml(asset.ref.id)}</span>`)}</td>
    </tr>`
    }).join('')
  }</tbody></table>`
}

function renderConstraints(sections: StoryboardSections, ctx: DiffContext): string {
  const constraints = sections['08_constraints']
  if (constraints.length === 0) {
    return emptySection('还没有硬约束。')
  }
  return constraints.map((item, index) => `
    <div class="constraint"><span class="no">${String(index + 1).padStart(2, '0')}</span><span>${marked(ctx, `08 硬约束.硬约束[${String(index + 1)}]`, orDash(item))}</span></div>`).join('')
}

// ────────────────────────────── 文档骨架 ──────────────────────────────

/** 对比模式入参（由 `diffSections` 的结果直接喂进来）。 */
export interface StoryboardDiffView {
  readonly entries: readonly DiffEntry[]
  readonly fromLabel: string
  readonly toLabel: string
}

/** 渲染选项。 */
export interface StoryboardRenderOptions {
  /** 落地状态（角标文案）；未落地时省略。 */
  readonly landedVersion?: string
  /** 只显示某一版（`versions.history` 里的 version 标识）；省略 = 显示活副本 `sections`。 */
  readonly version?: string
  /** 对比模式：有差异的字段就地高亮 + 顶部差异摘要。省略 = 普通渲染（逐字节不变）。 */
  readonly diff?: StoryboardDiffView
  /**
   * 把 `refImage` / `lookRef` / §07 引用解析成可展示的媒体 URL（缩略图）。
   * 省略 = 不渲染任何图（纯文本渲染，与旧行为逐字节一致）。渲染保持零 IO：
   * 由路由侧读画布后提供解析函数。
   */
  readonly mediaUrl?: ((ref: StoryboardAssetRef) => string | undefined) | undefined
  /**
   * 用户原始创意（首条真人消息全文，路由侧从画布 BRIEF 节点读出；省略/空 = 不渲染）。
   * 它是**一切开始的地方**，但不是九节之一：不计入完成度、不参与对比模式、
   * 不进 storyboard.json（文档保持 agent 拥有的 SSOT，用户话只借道展示）。
   */
  readonly sourceIdea?: string | undefined
  /**
   * 主题（`light` / `dark`，缺省 `dark`）。覆盖层与宿主同源，宿主切浅色时由路由把
   * `?theme=light` 透传进来，故事板跟着换色板 —— 一份文档两种色，结构不变。
   * **可选且默认 `dark`**：不传时渲染结果与旧行为逐字节一致（测试钉住）。
   */
  readonly theme?: 'light' | 'dark'
}

/** 取要渲染的 `sections`：指定版本 → 该版快照；否则活副本。 */
function sectionsFor(document: StoryboardDocument, version?: string): StoryboardSections {
  if (version === undefined) return document.sections
  const found = document.versions.history.find((entry) => entry.version === version)
  return found?.snapshot ?? document.sections
}

/** 文档样式（取自拍板体验稿的视觉语言；去掉 JS 与交互态）。 */
const STYLE = `
:root{--bg:#141210;--chrome:#0f0e0c;--card:#1d1a16;--card2:#232019;--card3:#191612;
--line:#2e2921;--line2:#3a3428;--tx:#ece5d8;--tx2:#b3a892;--tx3:#857b66;
--amber:#e8a33d;--amber-soft:rgba(232,163,61,.13);--amber-line:rgba(232,163,61,.35);
--blue:#6fa8dc;--green:#8fbf7f;--red:#d98a80;--red-soft:rgba(217,138,128,.1);--code-bg:#171410;--code-tx:#cfc4ac;
--glass:rgba(15,14,12,.93);--tabs-bg:rgba(20,18,16,.95);--dotbar-bg:#241f18;--zoom-cap:rgba(15,14,12,.78);
--backup-bg:#161411;--backup-id-bg:#3c352a;--sep:rgba(255,255,255,.06);--amber-ink:#171310}
/* 浅色主题：只换变量，不改结构。覆盖层与 iframe 同源同色，主机切浅色时故事板跟着切。 */
:root[data-theme="light"]{--bg:#f7f5ef;--chrome:#efece3;--card:#ffffff;--card2:#faf8f2;--card3:#fdfcf8;
--line:#e3ddd0;--line2:#d2cab8;--tx:#232019;--tx2:#5c5647;--tx3:#8a8272;
--amber:#a96c14;--amber-soft:rgba(169,108,20,.1);--amber-line:rgba(169,108,20,.3);
--blue:#2f6fb0;--green:#4a7d3a;--red:#a8433a;--red-soft:rgba(168,67,58,.08);--code-bg:#f0ece1;--code-tx:#5b5340;
--glass:rgba(239,236,227,.9);--tabs-bg:rgba(247,245,239,.94);--dotbar-bg:#e6e0d2;--zoom-cap:rgba(20,18,16,.78);
--backup-bg:#f4f1e8;--backup-id-bg:#cfc6b3;--sep:rgba(0,0,0,.06);--amber-ink:#fff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--blue)}
code,pre,.mono-key{font:12px/1.5 "SF Mono",Menlo,monospace}
.mono-key{background:var(--code-bg);border:1px solid var(--line);border-radius:5px;padding:0 5px;color:var(--code-tx)}
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:12px;padding:11px 22px;
background:var(--glass);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:14.5px}
.brand .logo{width:27px;height:27px;border-radius:8px;background:linear-gradient(135deg,#e8a33d,#c97b2e);
display:grid;place-items:center;color:#171310;font-size:14px}
.doc-badge{font-size:11.5px;color:var(--amber);background:var(--amber-soft);border:1px solid var(--amber-line);
padding:2px 10px;border-radius:999px;white-space:nowrap}
.doc-badge.on{color:var(--green);background:rgba(143,191,127,.12);border-color:rgba(143,191,127,.4)}
.spacer{flex:1}
.vchip{font-size:11.5px;color:var(--tx3);border:1px solid var(--line);padding:3px 10px;border-radius:999px;white-space:nowrap}
.doc{max-width:1060px;margin:0 auto;padding:30px 34px 120px}
.eyebrow{font-size:12px;color:var(--amber);letter-spacing:.05em;margin-bottom:9px}
h1{font-size:32px;font-weight:800;letter-spacing:-.5px;line-height:1.25}
h1 .metrics{font-size:16px;font-weight:400;color:var(--tx3);letter-spacing:0;margin-left:12px}
.intro{color:var(--tx2);font-size:14.5px;max-width:62em;margin:12px 0 18px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 18px}
.chip{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 14px;font-size:12px;color:var(--tx3)}
.chip b{color:var(--tx);font-size:13.5px;margin-right:6px;font-weight:700}
.progress{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);
border-radius:11px;padding:9px 13px;margin:0 0 20px}
.progress .pct{font-size:12px;color:var(--tx3);white-space:nowrap}
.progress .pct b{color:var(--amber);font-size:13.5px}
.dotbar{flex:1;min-width:180px;height:5px;border-radius:99px;background:var(--dotbar-bg);overflow:hidden}
.dotbar i{display:block;height:100%;background:linear-gradient(90deg,#c97b2e,#e8a33d)}
.tabs{position:sticky;top:52px;z-index:30;display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;
padding:9px 0;background:var(--tabs-bg);backdrop-filter:blur(8px);margin-bottom:6px}
.tabs::-webkit-scrollbar{display:none}
.tab{white-space:nowrap;padding:5.5px 13px;border-radius:999px;font-size:12.5px;color:var(--tx2);
background:var(--card);border:1px solid var(--line);text-decoration:none}
.tab.on{color:var(--amber);background:var(--amber-soft);border-color:var(--amber-line);font-weight:600}
.tab.miss{opacity:.55;border-style:dashed}
section.sheet{margin-top:26px;scroll-margin-top:104px}
.sec-eyebrow{font-size:12px;color:var(--amber);letter-spacing:.05em;margin-bottom:4px}
h2{font-size:23px;font-weight:800;letter-spacing:-.3px;margin-bottom:6px}
.sub{color:var(--tx2);font-size:13px;margin-bottom:16px;max-width:62em}
.empty{color:var(--tx3);font-size:13px;background:var(--card);border:1px dashed var(--line2);
border-radius:10px;padding:12px 15px}
.user-brief{background:var(--card);border:1px solid var(--line2);border-left:3px solid var(--amber);
border-radius:10px;padding:11px 15px;margin:0 0 14px}
.user-brief-label{font-size:10.5px;color:var(--amber);letter-spacing:.08em;font-weight:700;margin-bottom:5px}
.user-brief-text{color:var(--tx2);font-size:13.5px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.waitbanner{background:var(--amber-soft);border:1px solid var(--amber-line);border-radius:12px;
padding:14px 18px;margin:0 0 18px}
.waitbanner b{color:var(--amber);font-size:13.5px;display:block;margin-bottom:4px}
.waitbanner p{color:var(--tx2);font-size:12.8px;margin:0;line-height:1.7}
.note{color:var(--tx3);font-size:12px;margin-top:10px;line-height:1.7}
.note b{color:var(--tx2)}
.dash{color:var(--tx3)}
table.plain{width:100%;border-collapse:collapse;font-size:13px}
table.plain th{text-align:left;color:var(--tx3);font-weight:500;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
table.plain td{padding:9px 10px;border-bottom:1px dashed var(--line);vertical-align:top;color:var(--tx2)}
table.plain td:first-child{color:var(--tx)}
.pill{display:inline-block;font-size:11.5px;padding:1px 9px;border-radius:999px;white-space:nowrap;background:var(--card2);border:1px solid var(--line);color:var(--tx2)}
.pill.ok{color:var(--green);background:rgba(143,191,127,.12);border-color:transparent}
.pill.todo{color:#e0b25c;background:rgba(224,178,92,.1);border-color:transparent}
.tokens{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:10px}
.token{background:var(--amber-soft);border:1px solid var(--amber-line);color:var(--amber);
border-radius:12px;padding:9px 14px;font-size:13px}
.token b{display:block;font-size:11px;color:var(--tx3);font-weight:400;margin-bottom:2px}
.scene{border:1px solid var(--line);border-radius:11px;margin-bottom:18px;overflow:hidden;background:var(--card)}
.scene-head{display:flex;align-items:baseline;gap:12px;padding:12px 18px;background:var(--card2);
border-bottom:1px solid var(--line);flex-wrap:wrap}
.scene-id{font-size:12px;color:var(--amber);font-weight:700;letter-spacing:.04em}
.scene-title{font-weight:700;font-size:14.5px}
.scene-narr{color:var(--tx3);font-size:12.5px;flex:1;min-width:120px}
.scene-dur{font-size:11.5px;color:var(--tx3)}
.scene-dur b{color:var(--amber)}
/* §04 导演分镜表：真正的 table（可打印、可无障碍读屏），窄栏降级成卡片。 */
.align{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--line);border-left:2px solid var(--green);
background:var(--card);border-radius:10px;padding:9px 14px;margin:0 0 14px;font-size:12.5px;color:var(--tx2)}
.align.warn{border-left-color:var(--amber)}
.align b{color:var(--tx)}
.align .spacer{flex:1}
.scene.miss-count .scene-narr{color:var(--amber)}
.shots{margin-bottom:16px}
.shots:last-child{margin-bottom:0}
.shot-table{width:100%;border-collapse:collapse;font-size:12.8px}
.shot-table caption{text-align:left}
.shot-table th,.shot-table td{padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
.shot-table thead th{color:var(--tx3);font-weight:500;font-size:11.5px;white-space:nowrap;border-bottom:1px solid var(--line2)}
.shot-table tbody tr:last-child th,.shot-table tbody tr:last-child td{border-bottom:0}
.shot-table .c-id{white-space:nowrap;width:96px}
.shot-table .c-tc{white-space:nowrap;width:64px}
.shot-table .c-dur{white-space:nowrap;width:64px}
.shot-table .c-cam{width:96px}
.shot-table .c-vo{width:84px}
.shot-table .c-sound{width:118px}
.shot-table .c-tc,.shot-table .c-dur{color:var(--tx3);font-variant-numeric:tabular-nums}
.shot-table .c-dur b{color:var(--tx);font-size:12.5px}
.shot-table .c-dur small{display:block;font-size:10.5px;font-weight:400}
.c-visual{color:var(--tx);min-width:170px}
.shot-id{font:11px/1.5 "SF Mono",Menlo,monospace;font-weight:700;color:var(--amber-ink);background:var(--amber);border-radius:5px;padding:1px 7px;white-space:nowrap}
.shot-table tr.backup td,.shot-table tr.backup th{background:var(--backup-bg)}
.shot-table tr.backup .shot-id{background:var(--backup-id-bg);color:var(--tx2)}
.tag-backup{font-size:10px;color:#e0b25c;background:rgba(224,178,92,.1);border-radius:4px;padding:0 6px;white-space:nowrap}
.miss-prompt{display:inline-block;margin-left:7px;font-size:10px;color:var(--tx3);border:1px dashed var(--line2);border-radius:4px;padding:0 5px;white-space:nowrap}
.cell-extra{background:var(--card3);padding-top:2px}
.shot-fig{margin:9px 0 0}
.shot-fig img{width:100%;max-width:300px;border-radius:8px;border:1px solid var(--line);display:block;
aspect-ratio:var(--shot-ar,16/9);object-fit:cover;background:var(--code-bg)}
.shot-fig figcaption{font-size:11px;color:var(--tx3);margin-top:4px}
.look-fig{margin:0 0 10px}
.look-fig img{width:100%;border-radius:8px;border:1px solid var(--line);display:block}
/* CV-307：§02 图文混排 —— 宽栏「左图右 tokens」，窄栏（≤620px）降为上下单列。
   图源是 §02 的基调样张（一张承载全部 5 维）；token 本身不带各自的图。 */
.look-row{display:grid;grid-template-columns:minmax(0,1.24fr) minmax(226px,1fr);gap:16px;align-items:start}
.look-row .look-fig{margin:0}
.look-row .tokens{grid-template-columns:1fr}
/* 点图放大：零 JS —— 图外包一层链接（CV-311 起由父层 StudioFrame 拦截开 app 内缩放浮层，
   target=_blank 仅降级兜底），hover 出角标提示。 */
.look-fig .zoom{display:block;position:relative;border:1px solid var(--line);border-radius:9px;
overflow:hidden;background:var(--code-bg);cursor:zoom-in}
.look-fig .zoom img{border:0;border-radius:0}
.look-fig .zoom::after{content:"点开看原图";position:absolute;right:0;bottom:0;font-size:10.5px;
color:var(--tx);background:rgba(15,14,12,.78);padding:3px 9px;border-top-left-radius:8px;opacity:0;transition:opacity .16s}
.look-fig .zoom:hover::after{opacity:1}
/* CV-310：有引用却取不到图 —— 显式说出事实，不退化成「还没有视觉规范」空态。 */
.look-dangling{margin:0 0 12px;padding:9px 12px;border:1px solid var(--line);border-left:2px solid var(--amber);
border-radius:8px;background:var(--code-bg);font-size:12px;color:var(--tx2);line-height:1.6}
.asset-thumb{max-width:120px;border-radius:6px;border:1px solid var(--line);margin-top:5px;display:block}
.cam{color:var(--blue);font-weight:600}
.vo{color:var(--amber)}
details.prompt{margin-top:8px}
details.prompt summary{cursor:pointer;color:var(--tx3);font-size:11.5px}
details.prompt pre{margin-top:6px;background:var(--code-bg);border:1px solid var(--line);border-radius:8px;
padding:9px 12px;font-size:11.5px;color:var(--code-tx);white-space:pre-wrap;overflow-wrap:anywhere}
.roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(286px,1fr));gap:12px}
.role{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.role-head{padding:13px 16px 10px;border-bottom:1px solid var(--line)}
.role-tag{font-size:10.5px;color:var(--amber);letter-spacing:.1em;font-weight:700}
.role-name{font-size:16.5px;font-weight:800;margin-top:2px}
.role-sub{font-size:11.5px;color:var(--tx3)}
.role-body{padding:11px 16px 14px}
.role-tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
.rrow{display:flex;gap:10px;margin-bottom:6px;font-size:12.3px;line-height:1.62}
.rrow .lab{flex:0 0 30px;color:var(--tx3);font-size:11.5px;padding-top:1px}
.rrow .val{color:var(--tx2)}
.same-label{font-size:10.5px;color:var(--tx3);margin:9px 0 5px;letter-spacing:.04em}
.same{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:9px 11px;
font:11px/1.65 "SF Mono",Menlo,monospace;color:var(--code-tx);overflow-wrap:anywhere}
.cards2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:14px 17px}
.card h4{font-size:13.5px;margin-bottom:8px}
.card h4::before{content:"● ";color:var(--amber);font-size:10px;vertical-align:1px}
.card ul{list-style:none}
.card li{font-size:12.5px;color:var(--tx2);padding:2.5px 0 2.5px 14px;position:relative}
.card li::before{content:"";position:absolute;left:2px;top:11px;width:4px;height:4px;border-radius:50%;background:var(--tx3)}
.card li b{color:var(--tx)}
.constraint{display:flex;gap:12px;border:1px solid var(--line);border-left:2px solid var(--amber);background:var(--card);
border-radius:10px;padding:12px 15px;margin-bottom:9px;font-size:13.5px;align-items:baseline}
.constraint .no{color:var(--amber);font-weight:800;font-size:12px;flex:none;font-variant-numeric:tabular-nums}
footer{border-top:1px solid var(--line);margin-top:34px;padding-top:13px;color:var(--tx3);font-size:12px;line-height:1.7}
/* 技术说明收进折叠区：交付物正面只留内容，机制/字段名需要时才展开。 */
footer details.about{margin-top:10px}
footer details.about summary{cursor:pointer;color:var(--tx3);font-size:12px;list-style:none}
footer details.about summary::-webkit-details-marker{display:none}
footer details.about summary::before{content:"▸ ";color:var(--tx3)}
footer details.about[open] summary::before{content:"▾ "}
footer details.about[open] summary{color:var(--tx2)}
.about-body{margin-top:8px;color:var(--tx3);font-size:12px;line-height:1.85;max-width:66em}
.about-body b{color:var(--tx2);font-weight:600}
.about-body ul{list-style:none;margin:7px 0 0}
.about-body li{padding:2px 0 2px 14px;position:relative}
.about-body li::before{content:"";position:absolute;left:2px;top:11px;width:4px;height:4px;border-radius:50%;background:var(--tx3)}
/* 分节节奏：相邻 sheet 之间一条细线，让「九节骨架」一眼可数。 */
section.sheet + section.sheet{border-top:1px solid var(--sep);padding-top:26px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
/* 对比模式：差异就地高亮。三色语义与「增/删/改」一一对应，不另设图例色。 */
.chg{border-bottom:1px dashed transparent;border-radius:3px;padding:0 1px}
.chg.changed{background:rgba(224,180,100,.16);border-bottom-color:rgba(224,180,100,.65)}
.chg.added{background:rgba(143,191,127,.16);border-bottom-color:rgba(143,191,127,.65)}
.chg.removed{background:rgba(217,138,128,.16);border-bottom-color:rgba(217,138,128,.65);text-decoration:line-through}
.diffbar{background:var(--card);border:1px solid var(--amber-line);border-radius:11px;padding:11px 14px;margin:0 0 18px}
.diffbar .dh{font-size:13px;color:var(--amber);font-weight:600;margin-bottom:6px}
.diffbar .dc{font-size:12.5px;color:var(--tx2);line-height:1.8}
.diffbar .dc a{color:var(--tx2)}
.diffbar .cnt{color:var(--amber);font-weight:700}
.tab .badge{margin-left:5px;font-size:10.5px;color:var(--amber);background:var(--amber-soft);border-radius:99px;padding:0 5px}
/* 窄栏降级：覆盖层默认只压中栏，正常窗口下中栏可能只有 320–420px。
   媒体查询在 iframe 里按**覆盖层自身宽度**生效，所以这里正好是「给窄覆盖层用」的。
   两处取舍：多列网格全部降为单列；吸顶 tab 取消（顶栏在窄栏里会折行，写死 top
   值必然错位，不如不吸顶）。 */
@media (max-width:620px){
  .topbar{padding:9px 14px;gap:8px;flex-wrap:wrap}
  .doc{padding:20px 16px 90px}
  h1{font-size:24px}
  h1 .metrics{display:block;font-size:13.5px;margin:6px 0 0}
  .chips{gap:6px}
  .chip{padding:5px 10px;font-size:11.5px}
  .progress{padding:8px 11px}
  .dotbar{min-width:120px}
  .tabs{position:static;flex-wrap:wrap;overflow:visible}
  .roles{grid-template-columns:1fr}
  .cards2{grid-template-columns:1fr}
  .tokens{grid-template-columns:1fr}
  .look-row{grid-template-columns:1fr}
  table.plain{font-size:12.5px}
  table.plain th,table.plain td{padding:6px 7px}
  .scene-head{padding:10px 13px;gap:8px}
  /* 导演分镜表在窄栏降级成卡片：每行一块，字段名用 data-lab 回填。 */
  .shot-table,.shot-table thead,.shot-table tbody,.shot-table tr,.shot-table th,.shot-table td{display:block;width:auto}
  .shot-table thead{display:none}
  .shot-table tbody tr{border:1px solid var(--line);border-radius:10px;margin-bottom:10px;padding:10px 12px}
  .shot-table th,.shot-table td{border:0;padding:2px 0}
  .shot-table td::before{content:attr(data-lab);color:var(--tx3);font-size:11px;margin-right:6px}
  .shot-table .c-id{width:auto;margin-bottom:6px}
  .cell-extra{background:transparent;padding-top:6px}
  .shot-fig img{max-width:100%}
}
/* 打印/导出 PDF：交付物形态 —— 去悬浮、去底色、避免分镜卡被切断。 */
@media print{
  :root{--bg:#fff;--card:#fff;--card2:#fff;--card3:#fff;--tx:#111;--tx2:#333;--tx3:#666;--line:#ccc;--line2:#bbb;--sep:#ddd}
  .topbar{position:static;background:#fff;border-bottom:1px solid #ccc}
  .tabs{display:none}
  body{font-size:11.5px}
  .doc{max-width:none;padding:0}
  a{color:inherit;text-decoration:none}
  .shot-table,.shots,.scene,.constraint,.role{break-inside:avoid}
  thead{display:table-header-group}
  details.about{display:none}
  details.prompt[open] summary,details.prompt summary{color:#666}
}
`

/**
 * 渲染一份完整、自包含的故事板 HTML。
 *
 * 自包含 = 无外链、无 CDN、无网络依赖、**无 JS**（Electron 离线也能开）。
 */
export function renderStoryboard(document: StoryboardDocument, options: StoryboardRenderOptions = {}): string {
  const sections = sectionsFor(document, options.version)
  const summary = summarizeStoryboard(sections)
  const filled = sectionFilled(sections)

  // 对比上下文：关闭时 `marked()` 原样返回 ⇒ 普通渲染与改动前**逐字节一致**。
  const diffView = options.diff
  const ctx: DiffContext = diffView === undefined
    ? NO_DIFF
    : { on: true, byPath: new Map(diffView.entries.map((entry) => [entry.path, entry])) }
  const diffCountBySection = new Map<string, number>()
  for (const entry of diffView?.entries ?? []) {
    diffCountBySection.set(entry.section, (diffCountBySection.get(entry.section) ?? 0) + 1)
  }
  const filledCount = filled.filter(Boolean).length
  const versionLabel = options.version ?? '活副本'
  const theme = options.theme ?? 'dark'
  const aspect = aspectRatioCss(document.meta.aspect)
  const badge = options.landedVersion === undefined
    ? `<span class="doc-badge">故事板 · ${escapeHtml(versionLabel)}</span>`
    : `<span class="doc-badge on">已落地 ${escapeHtml(options.landedVersion)} · 只读回看</span>`

  const tabs = STORYBOARD_SECTION_TABS.map((tab, index) => {
    const count = diffCountBySection.get(tab.id) ?? 0
    const badge = count === 0 ? '' : `<span class="badge">▲${String(count)}</span>`
    return `<a class="tab${filled[index] === true ? ' on' : ' miss'}" href="#${tab.id}">${escapeHtml(tabText(tab.label))}${badge}</a>`
  }).join('')

  const diffBar = diffView === undefined
    ? ''
    : `<div class="diffbar"><div class="dh">对比：${escapeHtml(diffView.fromLabel)} → ${escapeHtml(diffView.toLabel)}</div>
       <div class="dc">${diffView.entries.length === 0
         ? '两版内容完全一致，没有差异。'
         : `共 <span class="cnt">${String(diffView.entries.length)}</span> 处差异 —— ${
             STORYBOARD_SECTION_TABS
               .map((tab) => ({ tab, count: diffCountBySection.get(tab.id) ?? 0 }))
               .filter((item) => item.count > 0)
               .map((item) => `<a href="#${item.tab.id}">${escapeHtml(tabText(item.tab.label))} <span class="cnt">${String(item.count)}</span></a>`)
               .join(' · ')
           }`}</div></div>`

  const durationNote = summary.shots === 0
    ? ''
    : `<span class="chip">Σ shot <b>${num(summary.shotDuration)}s</b></span>
       <span class="chip">目标 <b>${num(document.meta.targetDuration)}s</b></span>
       <span class="chip">旁白 <b>${num(summary.narrationDuration)}s</b></span>${
         summary.backups === 0 ? '' : `<span class="chip">备份拍 <b>${String(summary.backups)}</b></span>`
       }`

  const about = `<details class="about"><summary>技术说明与各节写法</summary>
    <div class="about-body">
      <p>这是全片规划的<b>唯一事实源</b>。画布顶条「拍摄定稿」里审阅它，确认后点「确认落地」才会把内容拆成画布节点供生成工具消费。机器事实以 <span class="mono-key">storyboard.json</span> 为准，本页只是渲染视图（Host 的 <span class="mono-key">render()</span> 纯函数生成 · <span class="mono-key">schemaVersion ${String(document.schemaVersion)}</span> · ${escapeHtml(versionLabel)}${options.landedVersion === undefined ? '' : ' · 已落地'}）。</p>
      <ul>${SECTION_GUIDE.map((note, index) => `<li><b>${escapeHtml(tabText(STORYBOARD_SECTION_TABS[index]?.label ?? ''))}</b> —— ${escapeHtml(note)}</li>`).join('')}</ul>
    </div>
  </details>`

  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="${theme}" />
<title>${escapeHtml(document.title)} · 故事板</title>
<style>${STYLE}</style>
</head>
<body style="--shot-ar:${aspect}">
<div class="topbar">
  <div class="brand"><div class="logo">⛶</div>${escapeHtml(document.title)}${badge}</div>
  <span class="spacer"></span>
  <span class="vchip">${escapeHtml(versionLabel)}</span>
</div>
<div class="doc">
  <div class="eyebrow">故事板 · STORYBOARD</div>
  <h1>${escapeHtml(document.title)}<span class="metrics">${
    summary.scenes === 0 ? '尚未成形' : `${String(summary.scenes)} 分镜 · ${String(summary.shots)} shot`
  }</span></h1>
${filledCount === 0 ? `
  <div class="waitbanner">
    <b>等待创意填充</b>
    <p>骨架已建好。agent 会随对话推进逐节写入创意理解、视觉规范、分镜脚本等内容 —— 上方进度条与各节标签会一节一节点亮。生成的效果图也会自动挂到对应分镜上。</p>
  </div>
` : ''}
  <div class="chips">
    <span class="chip">画幅 <b>${orDash(document.meta.aspect)}</b></span>
    <span class="chip">题材 <b>${orDash(document.meta.genre)}</b></span>
    <span class="chip">分镜 <b>${String(summary.scenes)}</b></span>
    <span class="chip">shot <b>${String(summary.shots)}</b></span>
    <span class="chip">角色 <b>${String(summary.characters)}</b></span>
    <span class="chip">硬约束 <b>${String(summary.constraints)}</b></span>
    ${durationNote}
  </div>

  <div class="progress">
    <span class="pct">已填充 <b>${String(filledCount)} / 9</b> 节</span>
    <span class="dotbar"><i style="width:${String(Math.round(filledCount / 9 * 100))}%"></i></span>
    <span class="pct">${
      filledCount === 9 ? '内容已齐' : `还差 ${String(9 - filledCount)} 节`
    }</span>
  </div>

  ${diffBar}

  <nav class="tabs">${tabs}</nav>

  <section class="sheet" id="s0"><div class="sec-eyebrow">00</div><h2>创意理解</h2>
    <p class="sub">一句话意图 + 季节 / 时间 / 地域前提 —— 它决定后面所有环节的用词。</p>${renderSourceIdea(options.sourceIdea)}${renderCreative(sections, ctx)}</section>

  <section class="sheet" id="s1"><div class="sec-eyebrow">01</div><h2>素材与事实</h2>
    <p class="sub">搜索核实来的事实锚点，每条带来源；搜不到的标「待核实」，<b>落地时会被丢弃</b>。</p>${renderFacts(sections, ctx)}</section>

  <section class="sheet" id="s2"><div class="sec-eyebrow">02</div><h2>视觉规范</h2>
    <p class="sub">5 项 tokens 会冻结成 Look 卡，此后每一镜的提示词都以它开头逐字节复用。</p>${renderVisual(sections, ctx, options.mediaUrl)}</section>

  <section class="sheet" id="s3"><div class="sec-eyebrow">03</div><h2>旁白设计</h2>
    <p class="sub">旁白只在这里写一次，分镜按句号引用。</p>${renderNarration(sections, ctx)}</section>

  <section class="sheet" id="s4"><div class="sec-eyebrow">04</div><h2>分镜脚本</h2>
    <p class="sub">导演视图：按镜号、起镜时点、时长、画面、运镜、旁白、声音排列。同镜可多拍一条互为备份，备份拍不计入片长。</p>${renderScenes(sections, ctx, options.mediaUrl, aspect, document.meta.targetDuration)}</section>

  <section class="sheet" id="s5"><div class="sec-eyebrow">05</div><h2>角色设定</h2>
    <p class="sub">人读描述与机读生成锚点分离：前者只上这份文档，后者落画布供逐镜复用。</p>${renderCharacters(sections, ctx)}</section>

  <section class="sheet" id="s6"><div class="sec-eyebrow">06</div><h2>声音设计</h2>
    <p class="sub">声音不是「配个 BGM」，而是一份预算表：响度、侧链避让、音效点都要写清。</p>${renderSound(sections, ctx)}</section>

  <section class="sheet" id="s7"><div class="sec-eyebrow">07</div><h2>素材清单</h2>
    <p class="sub">需要上传 / 搜集的素材。<b>只存引用不存副本</b>，落地时只校验引用有效性。</p>${renderAssets(sections, ctx, options.mediaUrl)}</section>

  <section class="sheet" id="s8"><div class="sec-eyebrow">08</div><h2>硬约束</h2>
    <p class="sub">可执行的生成纪律。落地后每一条都会注入 system prompt，逐次生成都必须遵守。</p>${renderConstraints(sections, ctx)}</section>

  <footer>
    <span>故事板 · ${escapeHtml(versionLabel)}${options.landedVersion === undefined ? '' : ' · 已落地'}</span>
    ${about}
  </footer>
</div>
</body>
</html>
`
}

/**
 * 通用提示页（占位 / 损坏 / 未就绪都复用它，样式只有一份）。
 *
 * 刻意**不是 404**：覆盖层是从画布顶条打开的，打不开会让用户以为「坏了」。给出
 * 一个说清状态的页面，才是可解释的空态（与画布空态同一取向）。
 */
export function renderStoryboardNotice(title: string, heading: string, detail: string, theme: 'light' | 'dark' = 'dark'): string {
  const light = theme === 'light'
  const bg = light ? '#f7f5ef' : '#141210'
  const tx = light ? '#232019' : '#ece5d8'
  const tx2 = light ? '#5c5647' : '#b3a892'
  const amber = light ? '#a96c14' : '#e8a33d'
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="${theme}" />
<title>${escapeHtml(title)} · 故事板</title>
<style>
body{margin:0;background:${bg};color:${tx};display:flex;align-items:center;justify-content:center;min-height:100vh;
font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:520px;text-align:center;padding:34px}
h1{font-size:16px;font-weight:700;margin:0 0 8px}
p{color:${tx2};margin:0}
code{font:12px/1.6 "SF Mono",Menlo,monospace;color:${amber};word-break:break-all}
.logo{width:34px;height:34px;border-radius:10px;margin:0 auto 14px;
background:linear-gradient(135deg,#e8a33d,#c97b2e);display:grid;place-items:center;color:#171310;font-size:17px}
</style></head>
<body><div class="card">
<div class="logo">⛶</div>
<h1>${escapeHtml(heading)}</h1>
<p>${detail}</p>
</div></body></html>
`
}

/**
 * 项目还没产出故事板时的占位页。
 */
export function renderStoryboardPlaceholder(title: string, theme: 'light' | 'dark' = 'dark'): string {
  return renderStoryboardNotice(
    title,
    '还没有故事板',
    '这个项目还没有产出故事板。等 agent 完成「拍摄定稿」阶段后，这里会展示分镜脚本、角色设定、声音设计等全片总览。',
    theme,
  )
}

/**
 * 文档损坏时的提示页（storyboard 是创作资产，读坏必须**显式告知 + 留证**，
 * 绝不静默重置）。原文件已被落盘层改名成 `<file>.corrupt`。
 */
export function renderStoryboardCorrupt(title: string, backup: string, theme: 'light' | 'dark' = 'dark'): string {
  return renderStoryboardNotice(
    title,
    '故事板文件读不出来',
    `原文件不会被覆盖，已留证为：<br /><code>${escapeHtml(backup)}</code><br />请检查该文件后重试，或联系开发者。`,
    theme,
  )
}
