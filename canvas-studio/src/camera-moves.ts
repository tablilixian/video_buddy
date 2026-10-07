/**
 * REQ-031（CV-282 Step 3）：运镜词库与节奏档 —— 一比一转录交互演示
 * `canvas-videonode-inputbox.html` 的 Higgsfield Camera Controls 官方全量预设
 * （33 条，中英文名逐字）与节奏 5 档（名称 / 顺序 / 段数 / 提示逐字）。
 *
 * 为什么是静态常量而不是读 `cinematic-moves` skill：那是一份**创作纪律文档**，
 * 不是结构化词库（方案 §四拍板修正）——面板网格要的是可逐条守卫的数据，
 * skill 继续作 agent 侧运镜纪律，两者不打架。
 *
 * 拍板②：`en` = 官方原名，**注入提示词时用英文名**（演示注入纪律原文）；
 * 点击卡片 = 把 `en` 追加进提示词文本（退格可删），多选有序 = 文本出现顺序。
 * 演示卡片上的 CSS 示意动画（mv-pan 等 keyframes）不迁移——DD-03 动效词汇
 * 只收显影/行进/让位三语义，选中态用 accent 边 + 序号角标表达（偏差登记）。
 */

/** 一条运镜预设（演示 MOTIONS 逐字转录；顺序即演示顺序，守卫逐条比对）。 */
export interface CameraMove {
  readonly id: string
  /** 中文名（面板网格显示）。 */
  readonly name: string
  /** 官方英文名（点击插入提示词的就是它）。 */
  readonly en: string
}

export const CAMERA_MOVES: readonly CameraMove[] = [
  { id: 'snorricam', name: '胸前斯坦尼康', en: 'Snorricam' },
  { id: 'roboarm', name: '机械臂', en: 'Robot Arm' },
  { id: 'tiltup', name: '上摇', en: 'Tilt Up' },
  { id: 'rackfocus', name: '焦点转移', en: 'Rack Focus' },
  { id: 'tiltdown', name: '下摇', en: 'Tilt Down' },
  { id: 'pov', name: '主观视角', en: 'POV' },
  { id: 'panleft', name: '左摇', en: 'Pan Left' },
  { id: 'craneup', name: '摇臂上升', en: 'Crane Up' },
  { id: 'panright', name: '右摇', en: 'Pan Right' },
  { id: 'cranedown', name: '摇臂下降', en: 'Crane Down' },
  { id: 'sidetrack', name: '侧向跟移', en: 'Side Tracking' },
  { id: 'pedestalup', name: '垂直上升', en: 'Pedestal Up' },
  { id: 'pedestaldown', name: '垂直下降', en: 'Pedestal Down' },
  { id: 'handheld', name: '手持', en: 'Handheld' },
  { id: 'tracking', name: '跟拍', en: 'Tracking' },
  { id: 'droneorbit', name: '无人机环绕', en: 'Drone Orbit' },
  { id: 'dollyzoom', name: '推拉变焦', en: 'Dolly Zoom' },
  { id: 'aerialpull', name: '航拍拉远', en: 'Aerial Pullback' },
  { id: 'staticshot', name: '固定机位', en: 'Static Shot' },
  { id: 'bullettime', name: '子弹时间', en: 'Bullet Time' },
  { id: 'whippan', name: '快速甩镜', en: 'Whip Pan' },
  { id: 'slowzoomin', name: '缓慢推近', en: 'Slow Zoom In' },
  { id: 'arcleft', name: '左弧线', en: 'Arc Left' },
  { id: 'slowzoomout', name: '缓慢拉远', en: 'Slow Zoom Out' },
  { id: 'arcright', name: '右弧线', en: 'Arc Right' },
  { id: 'truckright', name: '右横移', en: 'Truck Right' },
  { id: 'dollyin', name: '推进', en: 'Dolly In' },
  { id: 'truckleft', name: '左横移', en: 'Truck Left' },
  { id: 'dollyout', name: '拉远', en: 'Dolly Out' },
  { id: 'sliderright', name: '滑轨右移', en: 'Slider Right' },
  { id: 'crushzoom', name: '急推变焦', en: 'Crush Zoom' },
  { id: 'sliderleft', name: '滑轨左移', en: 'Slider Left' },
  { id: 'helishot', name: '直升机镜头', en: 'Helicopter Shot' },
]

/** 一档节奏（演示 PACES 逐字转录；名称与顺序同 Higgsfield 官方）。 */
export interface FilmPace {
  /** 中文名（轮播大卡 + 底部名称 pill）。 */
  readonly name: string
  readonly en: string
  /** 剪辑率指示条段数 = shot 数量级（0 = 自动，不显示指示条）。 */
  readonly segs: number
  /** 提示文案（逐字取演示）。 */
  readonly tip: string
}

/** 自动档单列常量：越界回退锚点（也是「删键 = 自动」的判空语义锚）。 */
const PACE_AUTO: FilmPace = { name: '自动', en: 'Auto', segs: 0, tip: '由画面内容自行决定剪辑点' }

export const FILM_PACES: readonly FilmPace[] = [
  PACE_AUTO,
  { name: '一镜到底', en: 'Single shot', segs: 1, tip: '单镜头到底，全程不切' },
  { name: '舒缓', en: 'Calm', segs: 3, tip: '长镜头为主，慢切留白' },
  { name: '动感', en: 'Dynamic', segs: 8, tip: '常规快切，节奏推进' },
  { name: '凌厉碎剪', en: 'Chaotic', segs: 12, tip: '极短镜头密集剪切' },
]

/** 越界回退到自动档（下标来自 UI 游标恒在界内；防御手改数据/异常输入）。 */
export function filmPaceAt(index: number): FilmPace {
  return FILM_PACES[index] ?? PACE_AUTO
}

/**
 * 节奏档 → 注入前缀（拍板①：后端无分镜参数，写参数走前缀注入通道，与
 * 风格 / 摄像机同类）。自动档 = 不注入（返回 undefined，UI 侧删键）。
 * 前缀文案由演示档名 + tip 组装（不虚构演示之外的能力描述）。
 */
export function pacingPrefixOf(pace: FilmPace): string | undefined {
  if (pace.segs === 0) return undefined
  return `节奏 ${pace.name}：${pace.tip}`
}

/**
 * 从提示词解析已插入的运镜（按**文本出现顺序**去重保序）——
 * 卡片选中态 / 序号角标 / tab 圆点的唯一事实源（F26：选择状态只体现在
 * 提示词上，反向解析回来；退格删除后回显同步消失）。
 */
export function parseCameraMoves(prompt: string): readonly CameraMove[] {
  return CAMERA_MOVES
    .map(move => ({ move, at: prompt.indexOf(move.en) }))
    .filter((hit): hit is { move: CameraMove; at: number } => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(hit => hit.move)
}
