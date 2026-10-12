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

/** 参数条读数（顶部一行，打开文档第一眼完成量化对齐）。 */
export interface StoryboardSummary {
  readonly scenes: number
  readonly shots: number
  readonly shotDuration: number
  readonly narrationDuration: number
  readonly characters: number
  readonly constraints: number
}

/** 汇总参数条读数（纯函数，渲染与测试共用）。 */
export function summarizeStoryboard(sections: StoryboardSections): StoryboardSummary {
  let shots = 0
  let shotDuration = 0
  for (const scene of sections['04_storyboard'].scenes) {
    for (const shot of scene.shots) {
      shots += 1
      shotDuration += shot.duration
    }
  }
  const narrationDuration = sections['03_narration'].lines.reduce((sum, line) => sum + line.duration, 0)
  return {
    scenes: sections['04_storyboard'].scenes.length,
    shots,
    shotDuration,
    narrationDuration,
    characters: sections['05_characters'].length,
    constraints: sections['08_constraints'].length,
  }
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
  if (brief === '') return emptySection('还没有写创意理解。这一节决定全片的季节 / 时间 / 地域前提，会贯穿后面所有环节的用词。')
  return `<p class="intro">${marked(ctx, '00 创意理解.创意', escapeHtml(brief))}</p>`
}

function renderFacts(sections: StoryboardSections, ctx: DiffContext): string {
  const facts = sections['01_facts'].facts
  if (facts.length === 0) {
    return emptySection('还没有事实锚点。素材需要从网上搜集时，每条事实都要带来源；搜不到的标「待核实」，不虚构。')
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
 * **点图放大走 `<a target="_blank">`**：故事板产物是刻意的**零 JS** 文档（见文件头注），
 * 所以不给它引脚本 —— 与 §01 来源链接同款，代价是「单击」而非「双击」。URL 与
 * `alt` 一律转义（图源来自 agent 生成，同属内容面）。
 */
function renderLookFigure(lookRef: StoryboardAssetRef | undefined, media: MediaUrl): string {
  if (lookRef === undefined || media === undefined) return ''
  const url = media(lookRef)
  if (url === undefined) return ''
  return `<figure class="look-fig">
      <a class="zoom" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="点开看原图（新窗口打开，可自由缩放）">
        <img src="${escapeHtml(url)}" alt="视觉基调样张" loading="lazy" />
      </a>
      <figcaption>这张样张承载全部 5 维 · <span class="mono-key">${escapeHtml(lookRef.id)}</span></figcaption>
    </figure>`
}

function renderVisual(sections: StoryboardSections, ctx: DiffContext, media: MediaUrl): string {
  const tokens = sections['02_visual'].tokens
  const lookFigure = renderLookFigure(sections['02_visual'].lookRef, media)
  if (tokens.length === 0 && lookFigure === '') {
    return emptySection('还没有视觉规范。这 5 项 tokens（色彩 / 光线 / 材质 / 镜头语汇 / 节奏）会冻结成 Look 卡，此后每一镜都以它开头复用。')
  }
  const tokenCards = tokens.length === 0
    ? ''
    : `<div class="tokens">${tokens.map((token) => `
    <div class="token"><b>${escapeHtml(token.k)}</b>${marked(ctx, `02 视觉规范.${token.k}`, orDash(token.v))}</div>`).join('')}</div>`
  // 有图 → 图文并置（宽栏左右、窄栏上下）；无图 → 纯文字，与旧行为逐字节一致。
  return lookFigure === ''
    ? tokenCards
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

function renderShot(sceneId: string, shot: StoryboardShot, mirror: number, ctx: DiffContext, media: MediaUrl): string {
  const at = (field: string): string => `04 分镜.${sceneId}.${shot.id}.${field}`
  const rows: string[] = []
  rows.push(`<div class="srow"><span class="lab">画面</span><span class="val visual">${marked(ctx, at('画面'), orDash(shot.visual))}</span></div>`)
  rows.push(`<div class="srow"><span class="lab">运镜</span><span class="val"><span class="cam">${marked(ctx, at('运镜'), orDash(shot.camera))}</span></span></div>`)
  rows.push(`<div class="srow"><span class="lab">声音</span><span class="val sound">${marked(ctx, at('声音'), orDash(shot.audio))}</span></div>`)
  if (shot.narrationRef !== undefined && shot.narrationRef !== '') {
    rows.push(`<div class="srow"><span class="lab">旁白</span><span class="val"><span class="vo">${marked(ctx, at('旁白引用'), escapeHtml(shot.narrationRef))}</span></span></div>`)
  }
  const prompt = shot.promptEn === undefined || shot.promptEn.trim() === ''
    ? '<p class="note">未写英文 prompt（promptEn）—— 阶段二组装每镜提示词时缺了基底。</p>'
    : `<details class="prompt"><summary>英文 prompt</summary><pre>${marked(ctx, at('英文 prompt'), escapeHtml(shot.promptEn))}</pre></details>`
  const shotImage = shot.refImage === undefined || media === undefined
    ? ''
    : (() => {
      const url = media(shot.refImage)
      return url === undefined
        ? ''
        : `<figure class="shot-fig"><img src="${escapeHtml(url)}" alt="${escapeHtml(shot.id)} 效果图" /><figcaption>效果图 · <span class="mono-key">${escapeHtml(shot.refImage.id)}</span></figcaption></figure>`
    })()
  return `<article class="shot${shot.backup ? ' backup' : ''}">
    <div class="shot-head">
      <span class="shot-id">${marked(ctx, `04 分镜.${sceneId}.${shot.id}`, `${orDash(shot.id)}（镜 ${String(mirror)}）`)}</span>
      <span class="shot-tc">${num(shot.duration)}s · ${Number.isFinite(shot.frames) ? `${String(shot.frames)}f` : '—'}f</span>
      ${shot.backup ? '<span class="tag-backup">备份拍</span>' : ''}
    </div>
    ${shotImage}
    ${rows.join('')}
    ${prompt}
  </article>`
}

function renderScenes(sections: StoryboardSections, ctx: DiffContext, media: MediaUrl): string {
  const scenes = sections['04_storyboard'].scenes
  if (scenes.length === 0) return emptySection('还没有分镜。')
  let mirror = 0
  return scenes.map((scene) => {
    const shots = scene.shots.map((shot) => { mirror += 1; return { shot, mirror } })
    const duration = scene.shots.reduce((sum, shot) => sum + shot.duration, 0)
    return `<section class="scene">
      <header class="scene-head">
        <span class="scene-id">${orDash(scene.id)}</span>
        <span class="scene-title">${marked(ctx, `04 分镜.${scene.id}.分镜标题`, orDash(scene.title))}</span>
        <span class="scene-narr">${String(scene.shots.length)} 个 shot</span>
        <span class="scene-dur">小计 <b>${num(duration)}s</b></span>
      </header>
      <div class="shots">${shots.map(({ shot, mirror: no }) => renderShot(scene.id, shot, no, ctx, media)).join('')}</div>
    </section>`
  }).join('')
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
  if (assets.length === 0) return emptySection('还没有素材清单。需要上传/搜集的素材写在这里；落画布时只校验引用，不会新造节点。')
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
    return emptySection('还没有硬约束。写在这里的每一条在落地后会注入生成纪律，逐次生成都必须遵守。')
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
--blue:#6fa8dc;--green:#8fbf7f;--red:#d98a80;--red-soft:rgba(217,138,128,.1);--code-bg:#171410;--code-tx:#cfc4ac}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--blue)}
code,pre,.mono-key{font:12px/1.5 "SF Mono",Menlo,monospace}
.mono-key{background:var(--code-bg);border:1px solid var(--line);border-radius:5px;padding:0 5px;color:var(--code-tx)}
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:12px;padding:11px 22px;
background:rgba(15,14,12,.93);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
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
.dotbar{flex:1;min-width:180px;height:5px;border-radius:99px;background:#241f18;overflow:hidden}
.dotbar i{display:block;height:100%;background:linear-gradient(90deg,#c97b2e,#e8a33d)}
.tabs{position:sticky;top:52px;z-index:30;display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;
padding:9px 0;background:rgba(20,18,16,.95);backdrop-filter:blur(8px);margin-bottom:6px}
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
.shots{padding:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(322px,1fr));gap:11px}
.shot{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--card3)}
.shot.backup{background:#161411;border-style:dashed}
.shot-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;flex-wrap:wrap}
.shot-id{font-size:11px;font-weight:700;color:#171310;background:var(--amber);border-radius:5px;padding:1px 7px}
.shot.backup .shot-id{background:#3c352a;color:var(--tx2)}
.shot-tc{font-size:11.5px;color:var(--tx3)}
.tag-backup{font-size:10px;color:#e0b25c;background:rgba(224,178,92,.1);border-radius:4px;padding:0 6px}
.srow{display:flex;gap:10px;margin-bottom:5.5px;font-size:12.8px;line-height:1.62}
.srow .lab{flex:0 0 32px;font-size:11.5px;color:var(--tx3);padding-top:1.5px}
.srow .val{color:var(--tx2);min-width:0}
.srow .val.visual,.srow .val.sound{color:var(--tx)}
.shot-fig,.look-fig{margin:0 0 10px}
.shot-fig img,.look-fig img{width:100%;border-radius:8px;border:1px solid var(--line);display:block}
.shot-fig figcaption,.look-fig figcaption{font-size:11px;color:var(--tx3);margin-top:4px}
/* CV-307：§02 图文混排 —— 宽栏「左图右 tokens」，窄栏（≤620px）降为上下单列。
   图源是 §02 的基调样张（一张承载全部 5 维）；token 本身不带各自的图。 */
.look-row{display:grid;grid-template-columns:minmax(0,1.24fr) minmax(226px,1fr);gap:16px;align-items:start}
.look-row .look-fig{margin:0}
.look-row .tokens{grid-template-columns:1fr}
/* 点图放大：零 JS —— 图外包一层新窗口链接（与 §01 来源链接同款），hover 出角标提示。 */
.look-fig .zoom{display:block;position:relative;border:1px solid var(--line);border-radius:9px;
overflow:hidden;background:var(--code-bg);cursor:zoom-in}
.look-fig .zoom img{border:0;border-radius:0}
.look-fig .zoom::after{content:"点开看原图";position:absolute;right:0;bottom:0;font-size:10.5px;
color:var(--tx);background:rgba(15,14,12,.78);padding:3px 9px;border-top-left-radius:8px;opacity:0;transition:opacity .16s}
.look-fig .zoom:hover::after{opacity:1}
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
.constraint{display:flex;gap:12px;border:1px solid rgba(217,138,128,.28);background:var(--red-soft);
border-radius:10px;padding:12px 15px;margin-bottom:9px;font-size:13.5px;align-items:baseline}
.constraint .no{color:var(--red);font-weight:800;font-size:12px;flex:none}
footer{border-top:1px solid var(--line);margin-top:34px;padding-top:13px;color:var(--tx3);font-size:12px;line-height:1.7}
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
  .shots{grid-template-columns:1fr}
  .roles{grid-template-columns:1fr}
  .cards2{grid-template-columns:1fr}
  .tokens{grid-template-columns:1fr}
  .look-row{grid-template-columns:1fr}
  table.plain{font-size:12.5px}
  table.plain th,table.plain td{padding:6px 7px}
  .scene-head{padding:10px 13px;gap:8px}
}
`

/**
 * 渲染一份完整、自包含的故事版 HTML。
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
  const badge = options.landedVersion === undefined
    ? `<span class="doc-badge">拍摄定稿 · ${escapeHtml(versionLabel)}</span>`
    : `<span class="doc-badge on">已落地 ${escapeHtml(options.landedVersion)} · 只读回看</span>`

  const tabs = STORYBOARD_SECTION_TABS.map((tab, index) => {
    const count = diffCountBySection.get(tab.id) ?? 0
    const badge = count === 0 ? '' : `<span class="badge">▲${String(count)}</span>`
    return `<a class="tab${filled[index] === true ? ' on' : ' miss'}" href="#${tab.id}">${escapeHtml(tab.label)}${badge}</a>`
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
               .map((item) => `<a href="#${item.tab.id}">${escapeHtml(item.tab.label.split(' ')[1] ?? item.tab.label)} <span class="cnt">${String(item.count)}</span></a>`)
               .join(' · ')
           }`}</div></div>`

  const durationNote = summary.shots === 0
    ? ''
    : `<span class="chip">Σ shot <b>${num(summary.shotDuration)}s</b></span>
       <span class="chip">目标 <b>${num(document.meta.targetDuration)}s</b></span>
       <span class="chip">旁白 <b>${num(summary.narrationDuration)}s</b></span>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(document.title)} · 拍摄定稿</title>
<style>${STYLE}</style>
</head>
<body>
<div class="topbar">
  <div class="brand"><div class="logo">⛶</div>${escapeHtml(document.title)}${badge}</div>
  <span class="spacer"></span>
  <span class="vchip">schemaVersion ${String(document.schemaVersion)}</span>
  <span class="vchip">${escapeHtml(versionLabel)}</span>
</div>
<div class="doc">
  <div class="eyebrow">拍摄定稿 · STORYBOARD</div>
  <h1>${escapeHtml(document.title)}<span class="metrics">${
    summary.scenes === 0 ? '尚未成形' : `${String(summary.scenes)} 分镜 · ${String(summary.shots)} shot`
  }</span></h1>
  <p class="intro">这是全片规划的<b>唯一事实源</b>。用户在画布顶条「拍摄定稿」里审阅它，确认后点「确认落地」才会把内容拆成画布节点供生成工具消费。</p>
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
    <p class="sub">两级结构：<b>分镜</b>是叙事单元，<b>shot</b> 是一次连续画面。同镜可多拍一条互为备份，单条重出不牵连。</p>${renderScenes(sections, ctx, options.mediaUrl)}</section>

  <section class="sheet" id="s5"><div class="sec-eyebrow">05</div><h2>角色设定</h2>
    <p class="sub">人读描述与机读生成锚点分离：前者只上这份文档，后者落画布供逐镜复用。</p>${renderCharacters(sections, ctx)}</section>

  <section class="sheet" id="s6"><div class="sec-eyebrow">06</div><h2>声音设计</h2>
    <p class="sub">声音不是「配个 BGM」，而是一份预算表：响度、侧链避让、音效点都要写清。</p>${renderSound(sections, ctx)}</section>

  <section class="sheet" id="s7"><div class="sec-eyebrow">07</div><h2>素材清单</h2>
    <p class="sub">需要上传 / 搜集的素材。<b>只存引用不存副本</b>，落地时只校验引用有效性。</p>${renderAssets(sections, ctx, options.mediaUrl)}</section>

  <section class="sheet" id="s8"><div class="sec-eyebrow">08</div><h2>硬约束</h2>
    <p class="sub">可执行的生成纪律。落地后每一条都会注入 system prompt，逐次生成都必须遵守。</p>${renderConstraints(sections, ctx)}</section>

  <footer>
    本文档由 Host 的 <span class="mono-key">render()</span> 纯函数从 <span class="mono-key">storyboard.json</span> 生成 ·
    ${escapeHtml(versionLabel)}${options.landedVersion === undefined ? '' : ' · 已落地'} ·
    机器事实以 JSON 为准，本页只是渲染视图
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
export function renderStoryboardNotice(title: string, heading: string, detail: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(title)} · 拍摄定稿</title>
<style>
body{margin:0;background:#141210;color:#ece5d8;display:flex;align-items:center;justify-content:center;min-height:100vh;
font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:520px;text-align:center;padding:34px}
h1{font-size:16px;font-weight:700;margin:0 0 8px}
p{color:#b3a892;margin:0}
code{font:12px/1.6 "SF Mono",Menlo,monospace;color:#e8a33d;word-break:break-all}
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
 * 项目还没产出故事版时的占位页。
 */
export function renderStoryboardPlaceholder(title: string): string {
  return renderStoryboardNotice(
    title,
    '还没有拍摄定稿',
    '这个项目还没有产出故事板。等 agent 完成「拍摄定稿」阶段后，这里会展示分镜脚本、角色设定、声音设计等全片总览。',
  )
}

/**
 * 文档损坏时的提示页（storyboard 是创作资产，读坏必须**显式告知 + 留证**，
 * 绝不静默重置）。原文件已被落盘层改名成 `<file>.corrupt`。
 */
export function renderStoryboardCorrupt(title: string, backup: string): string {
  return renderStoryboardNotice(
    title,
    '故事板文件读不出来',
    `原文件不会被覆盖，已留证为：<br /><code>${escapeHtml(backup)}</code><br />请检查该文件后重试，或联系开发者。`,
  )
}
