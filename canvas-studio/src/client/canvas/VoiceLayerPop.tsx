import { layerDims, type AudioDim, type AudioLayer, type VoiceSel } from '../../voice-dims.js'

/**
 * REQ-032 / CV-287 Step 2 · 四层设置面板（演示 `pop-layer` 1:1）。
 *
 * 四层共用**同一个**组件：结构完全由 `DIMS` 生成（演示 `renderPops` 注释
 * 「加一个维度只需改数据」），差异全在数据里。本组件只负责「画 + 报选择」，
 * 不持有选中集也不碰参数 —— 选中集是卡态（`audio.sel`）的单一事实源，
 * 上限 / 互斥 / 分隔符都在 `chooseWord` 一处判定（见 NodeInputCard）。
 *
 * 三种控件（`brand`）：
 * - `seg`  = 单选段（`.seg-pop`）：点击即替换，再点取消 —— 与 `mode:'one'` 同语义，
 *           演示里 seg 无 `mode` 字段但行为等同 one（`chooseWord` 走「else 替换」分支）。
 * - `grid` = 词条网格（`.wgrid`）：`one` 单选 / `many` 多选带上限禁用。
 * - `slide`= 滑杆（`.sl`）：拖到哪档写哪个词，**永不写数字**（档位词就是值）。
 */

/** Props for the voice layer panel (REQ-032 Step 2，演示 pop-layer 1:1)。 */
export interface VoiceLayerPopProps {
  layer: AudioLayer
  sel: VoiceSel
  /** 选一个词（演示 `chooseWord`：上限 / 互斥 / 替换语义全在调用方判定后落 sel）。 */
  onChoose(dimKey: string, word: string): void
  /** 拖动滑杆（演示 `setSlide`：写档位词，非 null）。 */
  onSlide(dimKey: string, stop: string | null): void
  /** 清空本层（演示 `.pclr`）。 */
  onClear(): void
  /** 关闭面板（演示 `.pclose`）。 */
  onClose(): void
}

/** 层色点（演示 `.pophd .pdot`：L1 indigo / L2 green / L3 sky / L4 accent）。 */
const LAYER_DOT: Record<AudioLayer, { color: string; glow: string }> = {
  L1: { color: '#a5b4fc', glow: 'rgba(165,180,252,.7)' },
  L2: { color: '#4ade80', glow: 'rgba(74,222,128,.7)' },
  L3: { color: '#7dd3fc', glow: 'rgba(125,211,252,.7)' },
  L4: { color: '#ffb066', glow: 'rgba(255,176,102,.7)' },
}

/** 「最常漏写」星标（演示 `.h4star`；含义放 <title>，不加可见文字）。 */
const STAR_ICON = (
  <svg className="csAudioPanelStar" viewBox="0 0 24 24" fill="currentColor" role="img">
    <title>最常漏写的一维</title>
    <path d="M12 2.6l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.6l-5.88 3.11 1.12-6.55L2.48 9.52l6.58-.96z" />
  </svg>
)

/** 滑杆最大值 = 档位数 - 1（演示 `max = stops.length - 1`）。 */
function slideMax(d: AudioDim): number {
  return (d.stops?.length ?? 1) - 1
}

/** 当前档位下标（-1 = 未设定）。 */
function slideIndex(d: AudioDim, sel: VoiceSel): number {
  const cur = sel[d.k] ?? []
  if (cur.length === 0) return -1
  return d.stops?.indexOf(cur[0] as string) ?? -1
}

/** 单个维度的控件（seg / grid / slide 三选一）。 */
function DimControl(props: { dim: AudioDim; sel: VoiceSel; onChoose(key: string, word: string): void; onSlide(key: string, stop: string | null): void }) {
  const { dim, sel, onChoose, onSlide } = props
  const cur = sel[dim.k] ?? []
  const full = dim.mode === 'many' && cur.length >= (dim.max ?? 3)

  if (dim.brand === 'slide') {
    const idx = slideIndex(dim, sel)
    const max = slideMax(dim)
    const stops = dim.stops ?? []
    const mid = Math.floor(max / 2)
    const shown = idx < 0 ? mid : idx
    return (
      <div className="csAudioPanelBlk" data-dim={dim.k}>
        <div className="csAudioPanelBlkHd">
          <b>{idx < 0 ? '未设定' : cur[0]}</b>
          <span className="csAudioPanelBMax">{stops.length} 档 · 由慢到快</span>
        </div>
        <input
          type="range"
          className="csAudioPanelSlide"
          min={0}
          max={max}
          step={1}
          value={shown}
          aria-label={dim.n}
          style={{ ['--p' as string]: `${max === 0 ? 0 : (shown / max) * 100}%` }}
          onChange={event => {
            const stop = stops[Number(event.target.value)]
            onSlide(dim.k, stop ?? null)
          }}
        />
        <div className="csAudioPanelTicks">
          <span>{stops[0]}</span>
          <span className="mid">{stops[mid]}</span>
          <span className="end">{stops[stops.length - 1]}</span>
        </div>
      </div>
    )
  }

  if (dim.brand === 'seg') {
    return (
      <div className="csAudioPanelSeg" data-dim={dim.k}>
        {(dim.words ?? []).map(word => (
          <button
            key={word}
            type="button"
            className={cur.includes(word) ? 'csAudioPanelSegB on' : 'csAudioPanelSegB'}
            aria-pressed={cur.includes(word)}
            onClick={() => { onChoose(dim.k, word) }}
          >{word}</button>
        ))}
      </div>
    )
  }

  return (
    <div className="csAudioPanelGrid" data-dim={dim.k}>
      {(dim.words ?? []).map(word => {
        const on = cur.includes(word)
        return (
          <button
            key={word}
            type="button"
            className={on ? 'csAudioPanelW on' : 'csAudioPanelW'}
            disabled={full && !on}
            title={full && !on ? `已达上限 ${dim.max ?? 3} 个，先取消一个` : undefined}
            aria-pressed={on}
            onClick={() => { onChoose(dim.k, word) }}
          >{word}</button>
        )
      })}
    </div>
  )
}

/**
 * 四层设置面板。外层定位（贴 pill 上方 11px / 越界翻转 / 夹取）由
 * `NodeInputCard` 的 `.csAudioLayerPop` 定位类与 useLayoutEffect 负责 ——
 * 本组件只画内容（同 FilmSetupPanel：面板内容与定位分离）。
 */
export function VoiceLayerPop(props: VoiceLayerPopProps) {
  const { layer, sel, onChoose, onSlide, onClear, onClose } = props
  const dot = LAYER_DOT[layer]
  return (
    <div className="csAudioLayerPop" role="dialog" aria-label={`${layer} 层设置`}>
      <div className="csAudioPanelHd">
        <span className="csAudioPanelDot" style={{ background: dot.color, boxShadow: `0 0 8px ${dot.glow}` }} />
        <div className="csAudioPanelHt"><b>{layer === 'L1' ? '身份' : layer === 'L2' ? '语言' : layer === 'L3' ? '声学' : '情境'}</b></div>
        <button type="button" className="csAudioPanelClr" onClick={onClear}>清空</button>
        <button type="button" className="csAudioPanelClose" aria-label="关闭" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="csAudioPanelBody">
        {layerDims(layer).map((d, i) => {
          const many = d.mode === 'many'
          return (
            <div key={d.k}>
              {i > 0 && <div className="csAudioPanelDv" />}
              <h4 className="csAudioPanelH4">
                {d.n}
                {d.star === true && STAR_ICON}
                {many && <span className="csAudioPanelCnt">已选 {(sel[d.k] ?? []).length} / {d.max ?? 3}</span>}
              </h4>
              <DimControl dim={d} sel={sel} onChoose={onChoose} onSlide={onSlide} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
