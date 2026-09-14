/**
 * DD-08 / R2：项目行的 kebab 菜单（取代行内原生 `<select>` 与常驻 ×）。
 *
 * ## 为什么换掉原生 select
 *
 * 原实现是「移动到分组」直接摆一个 `<select>` 在行里。两个问题：
 * 1. **外观**：原生控件由操作系统绘制，暗色壳上渲染成一块亮底浮块，且它不吃
 *    插件的任何令牌 —— 四套预设、明暗两轨都影响不到它。截图里最刺眼的那块灰
 *    就是它。
 * 2. **语义**：它是行内**常驻**控件。一行里同时出现「移动到分组」+「×」两个
 *    常驻控件，而项目列表的默认动作是「打开项目」——次要动作比主要动作响。
 *
 * 现在全部行内动作收进一个菜单，且菜单语言复用既有的 `.csContextMenu` /
 * `.csMenuAction` 家族（`CanvasContextMenu.tsx` 已建立这套语言），不造第三套。
 *
 * ## 关闭语义
 *
 * 复用 CV-167 的结论：window 上挂 **pointerdown** 而不是 mousedown。画布表面在
 * pointerdown 上 `preventDefault()`，按规范会抑制随后的兼容性 mousedown ——
 * 挂 mousedown 的关闭监听永远等不到事件（右键菜单点空白关不掉的根因）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { StudioProject, StudioProjectGroup } from '../contracts/project.js'

/** 菜单与触发按钮之间的间距（px）。 */
const MENU_GAP = 4
/** 视口边缘留白（px）—— 贴边会被读成「菜单被裁了一半」。 */
const VIEWPORT_PAD = 8
/** 首次渲染的高度估算：真实高度在 paint 前实测修正（这一步只为避免首帧闪跳）。 */
const MENU_HEIGHT_GUESS = 240

export interface ProjectRowMenuProps {
  project: StudioProject
  /** 全部用户分组（渲染成「移动到分组」的候选）。 */
  groups: readonly StudioProjectGroup[]
  /** 触发按钮的实测视口坐标（由调用方在打开时量好）。 */
  anchor: { left: number; top: number; bottom: number }
  /** 有创建/改名等写操作在飞时，菜单项禁用（避免并发写同一份 registry）。 */
  creating: boolean
  onClose(): void
  onMoveToGroup(projectId: string, groupId: string | null): void
  onDelete(projectId: string): void
}

export function ProjectRowMenu(props: ProjectRowMenuProps): ReactElement {
  const { project, groups, anchor, creating, onClose, onMoveToGroup, onDelete } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: anchor.left,
    top: anchor.bottom + MENU_GAP,
  }))

  // paint 前把菜单夹进视口：下方放不下就翻到按钮上方，右侧放不下就左移。
  // 用实测高度而不是估算值 —— 分组数量决定菜单高度，估错了翻页位置就是错的。
  useLayoutEffect(() => {
    const element = menuRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const height = rect.height === 0 ? MENU_HEIGHT_GUESS : rect.height
    const below = anchor.bottom + MENU_GAP
    const top = below + height <= window.innerHeight - VIEWPORT_PAD
      ? below
      : Math.max(VIEWPORT_PAD, anchor.top - height - MENU_GAP)
    const left = Math.min(anchor.left, Math.max(VIEWPORT_PAD, window.innerWidth - rect.width - VIEWPORT_PAD))
    setPos({ left, top })
  }, [anchor.left, anchor.top, anchor.bottom])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const moveItem = (label: string, groupId: string | null): ReactElement => {
    const active = (project.groupId ?? null) === groupId
    return (
      <button
        key={groupId ?? '__ungrouped__'}
        type="button"
        className={active ? 'csMenuAction csMenuActionActive' : 'csMenuAction'}
        disabled={creating}
        // 当前项点了不写回（避免无意义的 registry 写 + updatedAt 抖动）。
        onClick={() => { onClose(); if (!active) onMoveToGroup(project.id, groupId) }}
      >
        <span>{label}</span>
        {active && <span className="csMenuActionMark" aria-hidden="true">✓</span>}
      </button>
    )
  }

  return (
    <div
      ref={menuRef}
      className="csContextMenu"
      role="menu"
      aria-label={`项目「${project.name}」的操作`}
      style={{ left: pos.left, top: pos.top }}
    >
      <span className="csMenuLabel">移动到分组</span>
      {moveItem('未分组', null)}
      {groups.map(group => moveItem(group.name, group.id))}
      <button
        type="button"
        className="csMenuAction csMenuActionDanger"
        disabled={creating}
        onClick={() => {
          onClose()
          if (window.confirm(`确定删除项目「${project.name}」？该操作会同时删除其目录与画布，不可恢复。`)) {
            onDelete(project.id)
          }
        }}
      >
        <span>删除项目</span>
      </button>
    </div>
  )
}
