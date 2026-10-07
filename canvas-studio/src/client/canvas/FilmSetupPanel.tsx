import { CAMERA_MOVES, FILM_PACES, filmPaceAt, type CameraMove } from '../../camera-moves.js'

/** 影片设置面板的双 Tab（演示 film-seg：运镜多选有序 / 节奏单选）。 */
export type FilmTab = 'moves' | 'pace'

/** Props for the film setup panel (REQ-031 Step 3，演示 pop-film 1:1)。 */
export interface FilmSetupPanelProps {
  tab: FilmTab
  onTabChange(tab: FilmTab): void
  /** 提示词里已插入的运镜（官方英文名，按文本出现顺序）——卡片选中态 / 序号角标 / tab 圆点回显。 */
  selectedMoves: readonly string[]
  /** 点卡片 = 把官方英文名追加进提示词（拍板②文本插入；可重复，数量不限）。 */
  onInsertMove(move: CameraMove): void
  /** 当前节奏档下标（0=自动…4=凌厉碎剪）。 */
  paceIndex: number
  onPaceChange(index: number): void
}

/** 演示运镜卡示意图形（film-strip 线框，`.on` 时按 --anim 摆动）。 */
const MOVE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="6" width="16" height="12" rx="2" /><path d="M4 15l5-4 4 3 3-2 4 3" />
  </svg>
)
/** 节奏卡占位图形（官方演示视频不复用——拍板②置灰偏差，卡面用静态示意）。 */
const PACE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 9h18M7.5 5v4M12 5v4M16.5 5v4" /><path d="m10.5 12.5 4 2.5-4 2.5Z" />
  </svg>
)

/**
 * 影片设置面板（REQ-031 / CV-282 Step 3）—— 演示 `pop-film` 1:1：
 *
 * - **双 Tab 共用固定高度**（切换弹层尺寸零变化）；tab 圆点 = 该侧有选择
 *   （运镜 = 提示词里出现过英文名；节奏 = 非自动档）。
 * - **运镜**（多选有序）：33 词条网格 4 列；点卡片把官方英文名追加进提示词
 *   （可重复、退格可删）；已选回显 = accent 边 + 出现顺序序号（F26，从提示词
 *   反向解析）；悬停荧光绿浮标「添加到提示词」；说明行「建议一 Shot 一运镜」。
 * - **节奏**（单选即时生效）：5 档轮播（‹ › + 中央大卡 + 相邻暗卡）+ 段数
 *   指示条（segs 0/1/3/8/12）+ 档名 pill + tip。
 * - **即时生效、无确定钮**：关闭 = 点外 / Esc / 再点 chip（演示注释原文语义）。
 * - **偏差登记**：官方演示视频（Higgsfield CDN 33+5 个 mp4）不复用第三方素材
 *   （拍板②）——运镜卡保留示意动画、节奏卡静态示意 + title 说明。
 */
export function FilmSetupPanel(props: FilmSetupPanelProps) {
  const { tab, onTabChange, selectedMoves, onInsertMove, paceIndex, onPaceChange } = props
  const selectedOrder = new Map(selectedMoves.map((en, index) => [en, index + 1]))
  const pace = filmPaceAt(paceIndex)
  // 轮播位移：卡宽 300 + 间距 16 = 步长 316；150 = 半卡宽（把当前卡推到舞台正中）。
  const step = 316
  return (
    <>
      <div className="csFilmSeg" role="tablist" aria-label="影片设置">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'moves'}
          className={tab === 'moves' ? 'csFilmSegBtn on' : 'csFilmSegBtn'}
          onClick={() => { onTabChange('moves') }}
        >运镜<span className={selectedOrder.size > 0 ? 'csFilmDot has' : 'csFilmDot'} /></button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pace'}
          className={tab === 'pace' ? 'csFilmSegBtn on' : 'csFilmSegBtn'}
          onClick={() => { onTabChange('pace') }}
        >节奏<span className={pace.segs > 0 ? 'csFilmDot has' : 'csFilmDot'} /></button>
      </div>
      <div className="csFilmBody">
        {tab === 'moves' ? (
          <div className="csFilmPane">
            <div className="csFilmSub">点击运镜添加到提示词，建议一Shot一运镜</div>
            <div className="csMvGrid">
              {CAMERA_MOVES.map(move => {
                const ord = selectedOrder.get(move.en)
                return (
                  <button
                    type="button"
                    className={ord !== undefined ? 'csMvCard on' : 'csMvCard'}
                    key={move.id}
                    title={ord !== undefined ? `${move.en} · 已在提示词中（第 ${ord} 个）` : move.en}
                    onClick={() => { onInsertMove(move) }}
                  >
                    <span className="csMvPh">
                      <span className="csMvIcon">{MOVE_ICON}</span>
                      <span className="csMvAdd">添加到提示词</span>
                      {ord !== undefined && <span className="csMvOrd">{ord}</span>}
                    </span>
                    <span className="csMvNm">{move.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="csFilmPane csFilmPanePace">
            <div className="csPcHd"><b>选择节奏</b><span>决定分镜 Shot 数量和切换频率</span></div>
            <div className="csPcStage" title="官方演示视频不复用（拍板②偏差登记）：卡面为静态示意">
              <div
                className="csPcTrack"
                // 卡片始终全部渲染（相邻暗卡露边是演示的轮播形态）；位移把当前卡推到正中。
                style={{ transform: `translate(${-paceIndex * step - 150}px, -50%)` }}
              >
                {FILM_PACES.map((entry, index) => (
                  <button
                    type="button"
                    className={index === paceIndex ? 'csPcCard on' : 'csPcCard'}
                    key={entry.en}
                    aria-label={entry.name}
                    onClick={() => { onPaceChange(index) }}
                  >
                    <span className="csPcCardBody">
                      <span className="csPcIcon">{PACE_ICON}</span>
                      <span className="csPcEn">{entry.en}</span>
                    </span>
                    <span className="csPcScrim" aria-hidden />
                    {entry.segs > 0 && (
                      <span className="csPcBar" aria-hidden>
                        {Array.from({ length: entry.segs }, (_, seg) => <i key={seg} />)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="csPcName">
              <button
                type="button"
                className="csPcAr"
                aria-label="上一档节奏"
                onClick={() => { onPaceChange((paceIndex - 1 + FILM_PACES.length) % FILM_PACES.length) }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" /></svg>
              </button>
              <span className="csPcVal">{pace.name}</span>
              <button
                type="button"
                className="csPcAr"
                aria-label="下一档节奏"
                onClick={() => { onPaceChange((paceIndex + 1) % FILM_PACES.length) }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" /></svg>
              </button>
            </div>
            <div className="csPcTip"><em>{pace.name}</em>{pace.tip}</div>
          </div>
        )}
      </div>
    </>
  )
}
