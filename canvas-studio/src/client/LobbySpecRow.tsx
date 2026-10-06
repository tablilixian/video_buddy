/**
 * REQ-028：首页 Agent 项目创建框 v2 —— 规格选择器（chip 触发器 + 悬浮气泡弹出框）。
 *
 * ## 形态（1:1 复刻演示 video-agent-inputbox.html 的工具行）
 *
 * v1.3 的规格行是 dock 上的一行 chip 摊开组（ProjectSpecChips）；REQ-028 重塑为
 * 演示形态：所有选择项收进**卡片工具行**里的三枚 chip（左组）+ 一枚模式 chip
 * （右组），点开都是统一规格的气泡弹出框（组件见 LobbyPopover.tsx）：
 *
 * - 左组挂 `conversation.input.left`（宿主卡工具行左端，+ / 权限选择之后）：
 *   「MiniMax H3 ▾」（生成模型三选）、「16:9 · 720P ▾」（画幅 + 分辨率合并入口，
 *   同一面板两段两份独立状态）、「15s ▾」（时长三态互不锁定）。
 * - 右组挂 `conversation.input.right`（宿主卡工具行右端、宿主模型座椅 / 发送钮
 *   之前）：「● 自动执行 ▾」（绿点 / 琥珀点读模式；菜单只写模式名，差异写脚注
 *   与 hover 气泡）。
 *
 * 「开始创作」提交钮 = 宿主卡自带的发送按钮（图标圆钮）—— 在 lobby 态由
 * `tagSendButton` 打上 `data-cs-send` 锚，styles.ts 把它重塑为演示的 accent
 * 药丸 + 固定文案「开始创作」（不随模式改写）。锚的写法见该函数注释。
 *
 * ## 为什么挂 `conversation.input.left` / `.right`
 *
 * 演示的工具行长在**卡片内**（textarea 之下）。宿主卡的工具行恰好有两个 list
 * 槽（InputBar 的 leftItems / rightItems），规格 chip 进 left、模式 chip 进 right，
 * 位置即演示位置；dock 槽（v1.3 的落点）在卡片外面，做不到这一点。槽是 session
 * 作用域，work 态也渲染 —— 组件内按 `projectId === null` 条件渲染，非首页返回
 * null，work 态工具行零变化。
 *
 * ## 数据
 *
 * 草稿存 store（`lobbySpec`）：发送拦截分支（DivertConversation 的 lobby 认领）
 * 在组件树之外读它，随创意一起写进新项目 —— 组件 state 根本够不着那条路径。
 * 写走注入回调 `setSpec`（与 MediaUploadBar.dismissUpload 同一约定）；模式默认值
 * 对齐由注册侧 `defaultMode()` 读设置页（CV-196 口径）。类型与映射真值在
 * `src/lobby-spec.ts`（两侧共用，tests/lobby-spec.test.mjs 直连）。
 */
import { useEffect, useRef, type ReactElement } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LobbySpecRowInjected } from './contracts.js'
import type { LobbySpecDraft } from '../lobby-spec.js'
import {
  LOBBY_ASPECTS,
  LOBBY_DURATION_PRESETS,
  LOBBY_MODELS,
  LOBBY_MODE_COPY,
  RESOLUTION_DISPLAY,
  durationChipLabel,
  formatChipLabel,
  lobbyModelLabel,
} from '../lobby-spec.js'
import {
  LobbyCustomRow,
  LobbyDivider,
  LobbyMenuItem,
  LobbyPopFoot,
  LobbyPopHead,
  LobbyRatioCard,
  LobbySel,
} from './LobbyPopover.js'

/** props：注册时声明的 hooks 舱 + 写草稿回调 + 默认模式读取。 */
export type LobbySpecRowProps = InjectFace<LobbySpecRowInjected>

/** caret（9px，展开时旋转 180° —— 旋转由样式读 data-open 完成）。 */
function Caret(): ReactElement {
  return (
    <svg className="csLobbyCaret" width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <path d="M5 9l7 7 7-7" />
    </svg>
  )
}

/** 模型 chip 图标（13px 透镜/十字圆，演示同款）。 */
function ModelGlyph(): ReactElement {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 3.5v17M3.5 12h17" opacity={0.5} />
    </svg>
  )
}

/** 时长 chip 图标（13px 时钟，演示同款）。 */
function ClockGlyph(): ReactElement {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

/**
 * 给宿主发送按钮打「开始创作」重塑锚（data-cs-send）。
 *
 * 演示的提交钮是工具行右端的 accent 药丸（固定文案「开始创作」）；宿主卡的发送
 * 钮是图标圆钮，类名是 CSS Modules 哈希（选不中）。稳定锚只有两层：卡片上的
 * `data-composer-card`（宿主写入）+ 发送钮在卡内的**结构位置**（工具行尾、最后一个
 * button —— hero 态无停止钮，ContextMeter 的环钮在它之前）。本函数在 lobby 态把
 * 卡内最后一个 button 找出来，**核验**其 aria-label 是宿主发送键的双语文案后再打
 * 锚 —— 上游结构一旦变动，核验不中就静默不打（按钮退回原状，绝不误描别的按钮）。
 * work 态不打锚（卡片还原成图标圆钮）。
 */
export function tagSendButton(frame: Element | null): (() => void) | null {
  const card = frame?.closest('[data-composer-card]')
  if (card === null || card === undefined) return null
  const buttons = card.querySelectorAll('button')
  const last = buttons[buttons.length - 1]
  if (last === undefined) return null
  const label = last.getAttribute('aria-label')
  if (label !== '发送消息' && label !== 'Send message') return null
  last.setAttribute('data-cs-send', '')
  // 药丸的可见文案走 ::after（styles.ts），aria-label 同步改写成同一句 ——
  // 视觉读「开始创作」而读屏读「发送消息」是两套标签；还原时摘掉锚与文案一起还原。
  last.setAttribute('aria-label', '开始创作')
  return () => {
    last.removeAttribute('data-cs-send')
    last.setAttribute('aria-label', label)
  }
}

/**
 * 左组三枚规格 chip（挂 `conversation.input.left`）。
 *
 * 进首页按设置页「默认执行模式」对齐一次（CV-196）：只对齐没动过模式的草稿。
 * 依赖里带 spec 引用 —— 用户改画幅/时长会走 setSpec 产生新引用，重跑时若模式
 * 仍是默认则空操作，不会抖。发送钮锚也在本组件挂载时打（左组是工具行里
 * 最先挂载的 lobby 组件，锚打一次就够）。
 */
export function LobbySpecChips(props: LobbySpecRowProps): ReactElement | null {
  const { useStudio, setSpec, defaultMode } = props
  const projectId = useStudio(store => store.selectedProjectId)
  const spec = useStudio(store => store.lobbySpec)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (projectId !== null || spec.modeDirty === true) return
    const fallback = defaultMode()
    if (fallback !== spec.mode) setSpec({ ...spec, mode: fallback })
  }, [projectId, spec, defaultMode, setSpec])

  const tagCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (projectId !== null) return
    // 打锚晚一拍：本 commit 里宿主发送钮必然已在（同树兄弟），但 effects 的
    // 执行顺序按组件树深度，保险起见等下一帧再量一次整卡。
    let raf = 0
    raf = requestAnimationFrame(() => { tagCleanupRef.current = tagSendButton(rootRef.current) })
    return () => {
      cancelAnimationFrame(raf)
      tagCleanupRef.current?.()
      tagCleanupRef.current = null
    }
  }, [projectId])

  if (projectId !== null) return null
  const patch = (part: Partial<LobbySpecDraft>): void => setSpec({ ...spec, ...part })
  return (
    <div ref={rootRef} className="csLobbySpecChips">
      {/* 模型三选（单选面板，选中即关）。SeedDance 两档是路由预留位：选中值
          只活在本草稿里，不落 plan（见 lobby-spec.ts 文件头）。 */}
      <LobbySel
        chipLabel={`生成模型：${lobbyModelLabel(spec.model)}`}
        popWidth={226}
        chip={(
          <>
            <ModelGlyph />
            <span className="csLobbyChipLb">{lobbyModelLabel(spec.model)}</span>
            <Caret />
          </>
        )}
      >
        {close => (
          <>
            <LobbyPopHead>生成模型</LobbyPopHead>
            {LOBBY_MODELS.map(model => (
              <LobbyMenuItem
                key={model.id}
                label={model.label}
                {...(model.meta !== undefined ? { meta: model.meta } : {})}
                selected={spec.model === model.id}
                onSelect={() => { patch({ model: model.id }); close() }}
              />
            ))}
          </>
        )}
      </LobbySel>

      {/* 画幅 + 分辨率合并入口（演示 chip 读数「16:9 · 720P」+ 比例小矩形）。
          合并的是入口不是状态：同一面板两段、两份独立字段，改比例不动档位。
          多字段面板，选中后保持展开。 */}
      <LobbySel
        chipLabel={`画幅与分辨率：${formatChipLabel(spec)}`}
        popWidth={252}
        tip={`当前：${formatChipLabel(spec)}`}
        chip={(
          <>
            <span
              className="csLobbyMiniBox"
              style={miniBoxSize(spec.aspect)}
              role="presentation"
            />
            <span className="csLobbyChipLb">{formatChipLabel(spec)}</span>
            <Caret />
          </>
        )}
      >
        {() => (
          <>
            <LobbyPopHead>画幅比例</LobbyPopHead>
            <div className="csLobbyRatioGrid">
              {LOBBY_ASPECTS.map(aspect => (
                <LobbyRatioCard
                  key={aspect.value}
                  boxWidth={ratioBox(aspect.value).width}
                  boxHeight={ratioBox(aspect.value).height}
                  selected={spec.aspect === aspect.value}
                  label={aspect.value}
                  sub={aspect.label}
                  onSelect={() => patch({ aspect: aspect.value })}
                />
              ))}
            </div>
            <LobbyDivider />
            <LobbyPopHead>输出分辨率</LobbyPopHead>
            {RESOLUTION_DISPLAY.map(item => (
              <LobbyMenuItem
                key={item.value}
                label={item.label}
                meta={item.meta}
                selected={spec.resolution === item.value}
                onSelect={() => patch({ resolution: item.value })}
              />
            ))}
            <LobbyDivider />
            <LobbyPopFoot>画幅与分辨率是同一面板里两份独立状态，改比例不会连带改变像素档位。</LobbyPopFoot>
          </>
        )}
      </LobbySel>

      {/* 时长三态（预设 / 自定义 / 不锁定，互不锁定；多字段面板保持展开，
          面板内不出现耗时预估）。 */}
      <LobbySel
        chipLabel={`目标时长：${durationChipLabel(spec)}`}
        popWidth={268}
        chip={(
          <>
            <ClockGlyph />
            <span className="csLobbyChipLb">{durationChipLabel(spec)}</span>
            <Caret />
          </>
        )}
      >
        {() => (
          <>
            <LobbyPopHead>目标时长</LobbyPopHead>
            {LOBBY_DURATION_PRESETS.map(seconds => (
              <LobbyMenuItem
                key={seconds}
                label={`${String(seconds)} 秒`}
                selected={spec.duration === String(seconds)}
                onSelect={() => patch({ duration: String(seconds) })}
              />
            ))}
            <LobbyMenuItem
              label="不锁定（AI 确定）"
              selected={spec.duration === ''}
              onSelect={() => patch({ duration: '' })}
            />
            <LobbyCustomRow
              selected={spec.duration === 'custom'}
              value={spec.durationCustom}
              onChange={(value) => {
                // 超上限当场夹到 300（chip 读数与落盘真值一致，不给「填了 600
                // 却按 300 建」的错位）；非法输入留在框里，认领时该项被丢弃。
                const parsed = Number.parseInt(value, 10)
                patch({ durationCustom: Number.isFinite(parsed) && parsed > 300 ? '300' : value })
              }}
              onPick={() => patch({ duration: 'custom' })}
            />
          </>
        )}
      </LobbySel>
    </div>
  )
}

/** 比例小矩形尺寸（长边 14；16:9 → 14×7.88，9:16 → 7.88×14）。 */
function miniBoxSize(aspect: LobbySpecDraft['aspect']): { width: number; height: number } {
  return aspect === '16:9' ? { width: 14, height: 7.88 } : { width: 7.88, height: 14 }
}

/** 大卡里的比例矩形（长边 36；演示 36×20.3 / 20.3×36）。 */
function ratioBox(aspect: LobbySpecDraft['aspect']): { width: number; height: number } {
  return aspect === '16:9' ? { width: 36, height: 20.3 } : { width: 20.3, height: 36 }
}

/**
 * 右组执行模式 chip（挂 `conversation.input.right`，宿主模型座椅 / 发送钮之前）。
 *
 * 绿点（自动执行）/ 琥珀点（询问执行）读模式；两项菜单只写模式名，差异写
 * 面板底部脚注与 hover 气泡。默认值对齐**不在这里做** —— 那是 LobbySpecChips
 * 的副作用，两处都跑会对同一草稿写两次。
 */
export function LobbyModeChip(props: LobbySpecRowProps): ReactElement | null {
  const { useStudio, setSpec } = props
  const projectId = useStudio(store => store.selectedProjectId)
  const spec = useStudio(store => store.lobbySpec)
  if (projectId !== null) return null
  const copy = LOBBY_MODE_COPY[spec.mode]
  return (
    <LobbySel
      {...(spec.mode === 'confirm' ? { chipClassName: 'csLobbyChip csLobbyChipAsk' } : {})}
      chipLabel={`执行模式：${copy.name}`}
      popWidth={250}
      align="right"
      tip={`当前：${copy.name}（${copy.reason}）`}
      chip={(
        <>
          <span className="csLobbyDot" role="presentation" />
          <span className="csLobbyChipLb">{copy.name}</span>
          <Caret />
        </>
      )}
    >
      {close => (
        <>
          <LobbyPopHead>执行模式</LobbyPopHead>
          {(Object.keys(LOBBY_MODE_COPY) as Array<keyof typeof LOBBY_MODE_COPY>).map(mode => (
            <LobbyMenuItem
              key={mode}
              label={LOBBY_MODE_COPY[mode].name}
              selected={spec.mode === mode}
              onSelect={() => { setSpec({ ...spec, mode }); close() }}
            />
          ))}
          <LobbyDivider />
          <LobbyPopFoot>{copy.foot}</LobbyPopFoot>
        </>
      )}
    </LobbySel>
  )
}
