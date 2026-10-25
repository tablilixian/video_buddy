/**
 * 镜头卡验证样本（REQ-035 / shotcraft 吸收方案 S1 的 PoC）
 *
 * 目的：**用我们自己的渲染器验证**「卡片 = 一段可直接粘进 tracks 的片段」这个形态能不能成立。
 * 每张卡 = 一份完整 manifest（底色 + 该卡的轨），90 帧 / 3 秒，逐张独立渲染。
 *
 * 判定三件事：
 *   ① 结构合法 —— 每张都过 `validateManifest`（run.mjs --check 就会跑）
 *   ② 真能渲出 —— 测试 Electron 上逐张渲染成功
 *   ③ 真的在动 —— entry.tsx 采样三帧亮度，卡必须"非黑 + 随时间变化"
 *
 * ⚠️ 这里**只用现有 manifest 字段**（不新增能力），验证的就是"现有表达力够不够"。
 */
import { REAL_ASSETS, PROJECT_ASSET_PREFIX } from './fixtures.mjs'

export const CARD_FRAMES = 90

const META = (title, frames = CARD_FRAMES, extra = {}) => ({
  title,
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: frames,
  backgroundColor: '#0B1220',
  ...extra,
})

const fullBg = {
  id: 'bg',
  type: 'shape',
  shape: 'gradient',
  color: '#111827',
  box: { x: 50, y: 50, w: 100, h: 100 },
  startFrame: 0,
  durationInFrames: CARD_FRAMES,
  fadeFrames: 0,
}

/** 12+2 张卡：每张只改 tracks，不碰 meta 结构。 */
export const CARDS = [
  {
    id: 'title-mask',
    title: '标题遮罩揭示（maskReveal）',
    why: '大标题/金句最常用的入场',
    tracks: [
      { id: 't', type: 'textCard', variant: 'title', text: '心率监测', anim: 'maskReveal', animOptions: { revealFrames: 24 }, startFrame: 6, durationInFrames: 78, fadeFrames: 0 },
    ],
  },
  {
    id: 'title-typewriter',
    title: '标题逐字打出（typewriter）',
    why: '本片左栏的核心表达',
    tracks: [
      { id: 't', type: 'textCard', variant: 'title', text: '今天，它替你数了一次心跳', anim: 'typewriter', startFrame: 6, durationInFrames: 84, fadeFrames: 0 },
    ],
  },
  {
    id: 'subtitle-typewriter',
    title: '字幕逐字打出（subtitle）',
    why: '旁白对齐时的默认形态',
    tracks: [
      { id: 's', type: 'textCard', variant: 'subtitle', text: '静息心率 62，低于昨日 4 次', anim: 'typewriter', startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  },
  {
    id: 'bullets-stagger',
    title: '要点逐词落位（bullets + wordStagger）',
    why: '功能罗列最稳的写法',
    tracks: [
      { id: 'b', type: 'textCard', variant: 'bullets', text: ['全天心率曲线', '异常自动提醒', '七天趋势对比'], anim: 'wordStagger', animOptions: { wordDelayFrames: 4 }, startFrame: 6, durationInFrames: 84, fadeFrames: 0 },
    ],
  },
  {
    id: 'datacard',
    title: '数据卡（dataCard + 强调色）',
    why: '数字类信息的主形态',
    tracks: [
      { id: 'd', type: 'textCard', variant: 'dataCard', text: '今日概览', data: [{ k: '静息心率', v: '62 bpm' }, { k: '血氧', v: '98%' }], accentColor: '#F59E0B', startFrame: 6, durationInFrames: 84, fadeFrames: 0 },
    ],
  },
  {
    id: 'card-enter',
    title: '卡片入场（shape + animate 上浮缩放）',
    why: 'UI 元素出现的基本功',
    tracks: [
      { id: 'card', type: 'shape', shape: 'rect', color: '#1F2937', box: { x: 50, y: 55, w: 46, h: 30 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0, y: 58, scale: 0.92 }, to: { opacity: 1, y: 55, scale: 1 }, startFrame: 4, durationInFrames: 22, easing: 'easeOut' } },
      { id: 'label', type: 'textCard', variant: 'bullets', text: ['消息提醒 · 已同步'], startFrame: 10, durationInFrames: 80, fadeFrames: 0 },
    ],
  },
  {
    id: 'split-layout',
    title: '左右分栏（bg + 左要点 + 右色块）',
    why: '本片"左讲解右表盘"的结构',
    tracks: [
      { id: 'right', type: 'shape', shape: 'rect', color: '#0E7490', box: { x: 74, y: 50, w: 42, h: 84 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 }, startFrame: 0, durationInFrames: 18, easing: 'easeOut' } },
      { id: 'left', type: 'textCard', variant: 'bullets', text: ['心率 62', '血氧 98%', '睡眠 7h12m'], anim: 'wordStagger', startFrame: 8, durationInFrames: 82, fadeFrames: 0 },
    ],
  },
  {
    id: 'transition-wipe',
    title: '转场（两条卡 + wipeLeft）',
    why: '段落之间不生硬',
    tracks: [
      { id: 'a', type: 'textCard', variant: 'title', text: '数据智能分析', startFrame: 0, durationInFrames: 54, fadeFrames: 0 },
      { id: 'b', type: 'textCard', variant: 'title', text: '七个维度，一次看懂', startFrame: 40, durationInFrames: 50, fadeFrames: 0 },
      { id: 'tr', type: 'transition', effect: 'wipeLeft', fromTrackId: 'a', toTrackId: 'b', startFrame: 40, durationInFrames: 14, fadeFrames: 0 },
    ],
  },
  {
    id: 'path-growth',
    title: '路径生长（shape:path + draw）',
    why: '趋势线/流程示意',
    tracks: [
      { id: 'p', type: 'shape', shape: 'path', color: '#7DD3FC', strokeWidth: 0.8,
        d: 'M 12 74 C 32 40, 58 88, 86 30', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 60, easing: 'easeInOut' } },
    ],
  },
  {
    id: 'orbit-badge',
    title: '公转徽标（shape:circle + orbit）',
    why: '关系类/围绕类表达',
    tracks: [
      { id: 'o', type: 'shape', shape: 'circle', color: '#F59E0B', box: { x: 50, y: 50, w: 10, h: 10 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        orbit: { center: { x: 50, y: 50 }, radius: 22, periodInFrames: 90 } },
      { id: 'core', type: 'shape', shape: 'circle', color: '#1F2937', box: { x: 50, y: 50, w: 16, h: 16 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  },
  {
    id: 'glow-pulse',
    title: '呼吸光效（fx:glow + 往复 animate）',
    why: '强调与环境光',
    tracks: [
      { id: 'g', type: 'shape', shape: 'circle', color: '#0EA5E9', box: { x: 50, y: 50, w: 22, h: 22 }, fx: 'glow', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0.55, scale: 0.94 }, to: { opacity: 1, scale: 1.04 }, startFrame: 0, durationInFrames: 44, easing: 'easeInOut' } },
    ],
  },
  {
    id: 'ken-burns',
    title: '素材推拉（image + kenBurns）',
    why: '实拍/产品图的默认运动',
    requiresAsset: true,
    tracks: [
      // ⚠️ `kenBurns: true` 是**死字段**（类型里有、实现从不读）：实现判的是 `fit === 'kenburns'`。
      { id: 'img', type: 'image', src: `${PROJECT_ASSET_PREFIX}${REAL_ASSETS.image}`, fit: 'kenburns', startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  },
  {
    id: 'chart-bars',
    title: '柱状对比（3 shape + 错峰 animate）',
    why: '数据强调',
    tracks: [
      { id: 'b1', type: 'shape', shape: 'rect', color: '#22D3EE', box: { x: 30, y: 70, w: 10, h: 20 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { scale: 0.35, y: 82 }, to: { scale: 1, y: 70 }, startFrame: 4, durationInFrames: 20, easing: 'easeOut' } },
      { id: 'b2', type: 'shape', shape: 'rect', color: '#38BDF8', box: { x: 50, y: 60, w: 10, h: 40 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { scale: 0.35, y: 82 }, to: { scale: 1, y: 60 }, startFrame: 10, durationInFrames: 20, easing: 'easeOut' } },
      { id: 'b3', type: 'shape', shape: 'rect', color: '#818CF8', box: { x: 70, y: 48, w: 10, h: 64 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { scale: 0.35, y: 82 }, to: { scale: 1, y: 48 }, startFrame: 16, durationInFrames: 20, easing: 'easeOut' } },
    ],
  },
  {
    id: 'outro-fade',
    title: '收尾落版（title + exit 上浮淡出）',
    why: '结尾不做硬消失',
    tracks: [
      { id: 'o', type: 'textCard', variant: 'title', text: '它一直在看', startFrame: 6, durationInFrames: 84, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 44 }, durationInFrames: 12 } },
    ],
  },

  /* ─────── R3 第二批（F 类）：shotcraft 124 卡吸收，白名单字段组合（CV-370） ─────── */

  {
    id: 'scroll-brake',
    title: '长卷急刹（bullets 滚动 + 多段关键帧）',
    why: '长列表快滚→减速急刹，停点抬亮（shotcraft scroll-brake-moves）',
    tracks: [
      { id: 'list', type: 'textCard', variant: 'bullets', text: ['静息心率 62', '深睡 1h42m', '血氧 98%', '压力指数 18', '步数 8,432'], startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: [
          { from: { y: 66 }, to: { y: 40 }, durationInFrames: 10, easing: 'easeOut' },
          { from: { y: 40 }, to: { y: 34 }, durationInFrames: 8, easing: 'easeOut', startAfter: 'previous' },
          { from: { y: 34 }, to: { y: 35 }, durationInFrames: 4, easing: 'easeInOut', startAfter: 'previous' },
        ] },
      { id: 'hl', type: 'shape', shape: 'rect', color: '#F59E0B', box: { x: 50, y: 35, w: 54, h: 13 }, fx: 'stroke', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0 }, to: { opacity: 0.9 }, startFrame: 26, durationInFrames: 8, easing: 'easeOut' } },
      { id: 'tag', type: 'textCard', variant: 'subtitle', text: '第 3 项：血氧 98%，达标', anim: 'typewriter', startFrame: 40, durationInFrames: 50, fadeFrames: 0 },
    ],
  },
  {
    id: 'flyline-arc',
    title: '数据飞线（path 贝塞尔 + draw + glow + 落点脉冲）',
    why: '卡到卡的能量/因果流（shotcraft flyline-arc）',
    tracks: [
      { id: 'a', type: 'shape', shape: 'circle', color: '#0EA5E9', box: { x: 18, y: 64, w: 5, h: 5 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
      { id: 'b', type: 'shape', shape: 'circle', color: '#F59E0B', box: { x: 78, y: 30, w: 7, h: 7 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
      { id: 'fly', type: 'shape', shape: 'path', color: '#7DD3FC', strokeWidth: 0.9, fx: 'glow',
        d: 'M 18 64 C 40 22, 58 72, 78 30', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 40, easing: 'easeInOut' } },
      { id: 'pulse', type: 'shape', shape: 'circle', color: '#F59E0B', box: { x: 78, y: 30, w: 12, h: 12 }, fx: 'glow', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: [
          { from: { opacity: 0, scale: 0.4 }, to: { opacity: 0.9, scale: 1.15 }, durationInFrames: 8, easing: 'easeOut' },
          { from: { opacity: 0.9, scale: 1.15 }, to: { opacity: 0, scale: 1.6 }, durationInFrames: 10, easing: 'easeOut', startAfter: 'previous' },
        ] },
    ],
  },
  {
    id: 'scanline-annotate',
    title: '扫描标注（扫描线过境 + 四角括号 + 打字贴标）',
    why: '逐项识别/体检式揭示（shotcraft scanline-annotate-focus）',
    tracks: [
      { id: 'doc', type: 'shape', shape: 'rect', color: '#16213A', box: { x: 50, y: 46, w: 46, h: 58 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
      { id: 'scan', type: 'shape', shape: 'rect', color: '#7DD3FC', box: { x: 50, y: 17, w: 46, h: 0.8 }, fx: 'glow', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { y: 17 }, to: { y: 75 }, startFrame: 8, durationInFrames: 46, easing: 'easeInOut' } },
      { id: 'c1', type: 'shape', shape: 'path', color: '#F59E0B', strokeWidth: 0.8, d: 'M 27 26 L 27 18 L 35 18', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 6, easing: 'linear' } },
      { id: 'c2', type: 'shape', shape: 'path', color: '#F59E0B', strokeWidth: 0.8, d: 'M 65 18 L 73 18 L 73 26', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 6, easing: 'linear' } },
      { id: 'c3', type: 'shape', shape: 'path', color: '#F59E0B', strokeWidth: 0.8, d: 'M 73 64 L 73 72 L 65 72', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 6, easing: 'linear' } },
      { id: 'c4', type: 'shape', shape: 'path', color: '#F59E0B', strokeWidth: 0.8, d: 'M 35 72 L 27 72 L 27 64', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 6, easing: 'linear' } },
      { id: 'tag', type: 'textCard', variant: 'subtitle', text: '已识别：静息心率 62 bpm', anim: 'typewriter', startFrame: 62, durationInFrames: 28, fadeFrames: 0 },
    ],
  },
  {
    id: 'marker-underline',
    title: '马克笔下划线（标题落定 + 手绘线快描）',
    why: '关键词强调的最便宜形态（shotcraft marker-underline-title）',
    tracks: [
      { id: 't', type: 'textCard', variant: 'title', text: '月亮为什么有阴晴圆缺', anim: 'typewriter', animOptions: { revealFrames: 20 }, startFrame: 4, durationInFrames: 86, fadeFrames: 0 },
      { id: 'u', type: 'shape', shape: 'path', color: '#F59E0B', strokeWidth: 1.4, d: 'M 36 63 C 48 62.2, 62 63.6, 88 62.4', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 12, easing: 'easeOut' } },
    ],
  },
  {
    id: 'lead-word-zoom',
    title: '首词组装（大字缩回落位 + 余词推进）',
    why: '数字/钩子开场（shotcraft lead-word-zoom-assemble）',
    tracks: [
      { id: 'w1', type: 'textCard', variant: 'title', text: '3.8 亿', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { y: 46, scale: 2.2, opacity: 0 }, to: { y: 32, scale: 1, opacity: 1 }, startFrame: 2, durationInFrames: 16, easing: 'easeOut' } },
      { id: 'w2', type: 'textCard', variant: 'title', text: '公里外的光，这样到达地球', anim: 'wordStagger', startFrame: 22, durationInFrames: 68, fadeFrames: 0,
        animate: { from: { y: 66 }, to: { y: 54 }, startFrame: 22, durationInFrames: 14, easing: 'easeOut' } },
    ],
  },
  {
    id: 'pill-slot-cycle',
    title: '词槽轮换（句干钉死 + 同位词卡交替）',
    why: '同句干换词的排比强调（shotcraft pill-slot-cycle）',
    tracks: [
      { id: 'stem', type: 'textCard', variant: 'subtitle', text: '心率自适应，一天比一天——', startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
      { id: 'w1', type: 'textCard', variant: 'title', text: '更快', startFrame: 4, durationInFrames: 30, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 44 }, durationInFrames: 8 } },
      { id: 'w2', type: 'textCard', variant: 'title', text: '更稳', startFrame: 36, durationInFrames: 30, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 44 }, durationInFrames: 8 } },
      { id: 'w3', type: 'textCard', variant: 'title', text: '更准', startFrame: 68, durationInFrames: 22, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 }, startFrame: 68, durationInFrames: 8, easing: 'easeOut' } },
    ],
  },
  {
    id: 'sheen-sweep',
    title: '高光扫过（光带单程擦过主角卡）',
    why: '成果/奖杯时刻的加冕（shotcraft sheen-sweep）',
    tracks: [
      { id: 'hero', type: 'textCard', variant: 'dataCard', text: '今日达成', data: [{ k: '连续达标', v: '7 天' }], accentColor: '#F59E0B', startFrame: 2, durationInFrames: 88, fadeFrames: 0 },
      { id: 'sheen', type: 'shape', shape: 'rect', color: '#F8FAFC', box: { x: 24, y: 50, w: 2.4, h: 36 }, fx: 'glow', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: [
          { from: { x: 24, opacity: 0 }, to: { x: 30, opacity: 0.85 }, durationInFrames: 3, easing: 'easeInOut' },
          { from: { x: 30, opacity: 0.85 }, to: { x: 76, opacity: 0 }, durationInFrames: 12, easing: 'easeInOut', startAfter: 'previous' },
        ] },
    ],
  },
  {
    id: 'strip-away-outro',
    title: 'UI 蒸发收尾（外围错峰淡出 + 中心定版）',
    why: '复杂界面收束到一个结论（shotcraft ui-strip-away-outro）',
    tracks: [
      { id: 'bar', type: 'shape', shape: 'rect', color: '#1F2937', box: { x: 50, y: 16, w: 70, h: 7 }, startFrame: 0, durationInFrames: 44, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 12 }, durationInFrames: 8 } },
      { id: 'l', type: 'textCard', variant: 'bullets', text: ['全天心率曲线', '异常自动提醒'], startFrame: 4, durationInFrames: 54, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 42 }, durationInFrames: 8 } },
      { id: 'r', type: 'shape', shape: 'rect', color: '#0E7490', box: { x: 74, y: 52, w: 34, h: 44 }, startFrame: 0, durationInFrames: 64, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 58 }, durationInFrames: 8 } },
      { id: 's', type: 'textCard', variant: 'subtitle', text: '以上数据已同步至健康档案', startFrame: 8, durationInFrames: 74, fadeFrames: 0,
        exit: { to: { opacity: 0, y: 58 }, durationInFrames: 8 } },
      { id: 'halo', type: 'shape', shape: 'circle', color: '#0EA5E9', box: { x: 50, y: 50, w: 26, h: 26 }, fx: 'glow', startFrame: 62, durationInFrames: 28, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.8 }, to: { opacity: 0.7, scale: 1 }, startFrame: 62, durationInFrames: 12, easing: 'easeOut' } },
      { id: 'end', type: 'textCard', variant: 'title', text: '晚安', anim: 'typewriter', animOptions: { revealFrames: 10 }, startFrame: 68, durationInFrames: 22, fadeFrames: 0 },
    ],
  },
  {
    id: 'timeline-marks',
    title: '里程碑时间轴（轴生长 + 节点错峰脉冲）',
    why: '阶段/进度叙事（shotcraft timeline-travel 的白名单近似）',
    tracks: [
      { id: 'axis', type: 'shape', shape: 'path', color: '#475569', strokeWidth: 0.7, d: 'M 12 72 L 88 72', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 26, easing: 'easeInOut' } },
      { id: 'n1', type: 'shape', shape: 'circle', color: '#22D3EE', box: { x: 30, y: 72, w: 3.4, h: 3.4 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.2 }, to: { opacity: 1, scale: 1 }, startFrame: 8, durationInFrames: 6, easing: 'easeOut' } },
      { id: 'n2', type: 'shape', shape: 'circle', color: '#38BDF8', box: { x: 52, y: 72, w: 3.4, h: 3.4 }, fx: 'glow', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.2 }, to: { opacity: 1, scale: 1 }, startFrame: 16, durationInFrames: 6, easing: 'easeOut' } },
      { id: 'n3', type: 'shape', shape: 'circle', color: '#818CF8', box: { x: 74, y: 72, w: 3.4, h: 3.4 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        animate: { from: { opacity: 0, scale: 0.2 }, to: { opacity: 1, scale: 1 }, startFrame: 24, durationInFrames: 6, easing: 'easeOut' } },
      { id: 'steps', type: 'textCard', variant: 'bullets', text: ['第 1 周：建立基线', '第 4 周：加量 20%', '第 8 周：进入稳态'], anim: 'wordStagger', startFrame: 30, durationInFrames: 60, fadeFrames: 0 },
    ],
  },
  {
    id: 'progress-ring',
    title: '进度环揭晓（弧线 draw + 中心数字打字）',
    why: '达成率/百分比揭晓（数据强调进阶）',
    tracks: [
      { id: 'ring', type: 'shape', shape: 'path', color: '#38BDF8', strokeWidth: 1.6, fx: 'glow',
        d: 'M 50 20 A 30 30 0 1 1 49.9 20', startFrame: 0, durationInFrames: 90, fadeFrames: 0,
        draw: { to: 1, durationInFrames: 56, easing: 'easeInOut' } },
      { id: 'num', type: 'textCard', variant: 'title', text: '87%', anim: 'typewriter', startFrame: 34, durationInFrames: 56, fadeFrames: 0 },
    ],
  },
]

/** 把一张卡组装成完整 manifest（底色 + 卡轨）。 */
export function cardManifest(card, extraMeta = {}) {
  return {
    id: `card-${card.id}`,
    meta: META(card.title, CARD_FRAMES, extraMeta),
    tracks: [{ ...fullBg }, ...card.tracks.map((t) => ({ ...t }))],
  }
}

/* ─────────────── 主题预设 PoC：同一份内容，两套设计语言 ─────────────── */

/**
 * 主题预设的**最小可行形状**（验证用，不是最终实现）。
 *
 * 只做三件事：调色（look）、配色（bg/强调色）、动效基线（easing/duration）。
 * 用来验证：换主题能不能在**不改内容轨**的前提下改变观感。
 */
export const THEMES = {
  'ink-press': {
    label: '墨印（冷调高对比）',
    meta: { backgroundColor: '#06080B', look: { contrast: 1.12, saturation: 0.92, brightness: 0.96, temperature: -0.45, vignette: 0.38, grain: 0.14 } },
    bgColor: '#0B0F14',
    accent: '#E5E7EB',
  },
  'warm-explainer': {
    label: '暖科普（暖调低对比）',
    meta: { backgroundColor: '#1A1207', look: { contrast: 1.02, saturation: 1.06, brightness: 1.06, temperature: 0.5, vignette: 0.16, grain: 0.06 } },
    bgColor: '#241A0E',
    accent: '#F59E0B',
  },
}

/** 用主题展开一份 manifest：只覆盖 meta + 底色/强调色，**不动内容轨结构**。 */
export function applyTheme(manifest, themeId) {
  const theme = THEMES[themeId]
  if (theme === undefined) throw new Error(`未知主题：${themeId}`)
  return {
    ...manifest,
    meta: { ...manifest.meta, ...theme.meta },
    tracks: manifest.tracks.map((track) => {
      if (track.id === 'bg') return { ...track, color: theme.bgColor }
      if (track.type === 'shape' && track.id === 'o') return { ...track, color: theme.accent }
      return track
    }),
  }
}

/** Q12 矩阵：每张卡一次渲染。 */
export function buildCardMatrix() {
  return CARDS.map((card) => ({
    id: `card-${card.id}`,
    title: `${card.title} — ${card.why}`,
    manifest: cardManifest(card),
    quality: 'draft',
    frames: CARD_FRAMES,
    timeoutMs: 90_000,
  }))
}

/** Q13 矩阵：同一张卡（数据卡）在两套主题下各渲一次。 */
export function buildThemeMatrix() {
  const base = CARDS.find((c) => c.id === 'split-layout')
  return Object.keys(THEMES).map((themeId) => ({
    id: `theme-${themeId}`,
    title: `主题预设：${THEMES[themeId].label}`,
    manifest: applyTheme(cardManifest(base), themeId),
    quality: 'draft',
    frames: CARD_FRAMES,
    timeoutMs: 90_000,
  }))
}
