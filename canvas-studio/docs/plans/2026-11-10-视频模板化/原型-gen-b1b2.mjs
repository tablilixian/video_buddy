// 由 MotionGit B1+B2 的 ground truth 编排规格，反向生成「我们 DSL 的等价 manifest」+「槽位合同」。
// 编排时刻全部来自 core/basic.js 的源码规格（已在成片上像素级验证过）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本目录（脚本自引用，保证整包可搬移，不依赖 /tmp）。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const FPS = 60;
const W = 1920, H = 1080;
const px = (v, span) => +((v / span) * 100).toFixed(2);

// ── 段边界：B1 0–8s，B2 8–18s ─────────────────────────────────
const B1 = 0, B2 = 480, TOTAL = 1080;

// ── 槽位合同（源自 adapter.py 的 limits 与 content.schema.json）──
const slots = [
  { id: 'b1.label',      label: 'B1 / 章节标签',   maxChars: 32, maxLines: 1, required: true,  format: 'text' },
  { id: 'b1.keyword',    label: 'B1 / 关键词',      maxChars: 8,  maxLines: 1, required: true,  format: 'text' },
  { id: 'b1.explanation',label: 'B1 / 解释',        maxChars: 42, maxLines: 2, required: true,  format: 'text' },
  { id: 'b2.label',      label: 'B2 / 章节标签',   maxChars: 32, maxLines: 1, required: true,  format: 'text' },
  { id: 'b2.heading',    label: 'B2 / 标题',        maxChars: 10, maxLines: 1, required: true,  format: 'text' },
  { id: 'b2.points',     label: 'B2 / 要点',        kind: 'list', maxCharsPerLine: 18, maxLines: 2, minCount: 1, maxCount: 5, required: true, format: 'text' },
];

// ── 本期填充值（与 ground truth 完全一致）─────────────────────
const CONTENT = {
  'b1.label': '编排复刻实验',
  'b1.keyword': '从想法开始',
  'b1.explanation': '把你的想法\n变成清晰的视觉故事',
  'b2.label': '编排复刻实验',
  'b2.heading': '三个要点',
  'b2.points': ['结构先固定下来', '动效跟着节奏走', '一次成片可复用'],
};

const BLUE = '#7DB2FF', GOLD = '#E8B26A', SILVER = '#E9ECEF';

const tracks = [];
const push = (t) => { tracks.push(t); return t; };

// ── B1 段（0–8s）──────────────────────────────────────────────
// badge：mask 显入 @+0.12s，d=0.4s
push({
  type: 'textCard', id: 'b1-badge', slot: 'b1.label',
  startFrame: B1 + 7, durationInFrames: B1 + 480 - (B1 + 7),
  variant: 'subtitle', text: CONTENT['b1.label'], accentColor: BLUE,
  anim: 'maskReveal', animOptions: { wordDelayFrames: 0 },
  box: { x: px(256, W), y: px(180, H), w: px(150, W), h: px(32, H) },
});
// keyword：逐字砸下 @+0.5s，d=0.28s，错峰 45ms ≈ 3 帧
push({
  type: 'textCard', id: 'b1-keyword', slot: 'b1.keyword',
  startFrame: B1 + 30, durationInFrames: B1 + 480 - (B1 + 30),
  variant: 'title', text: CONTENT['b1.keyword'],
  anim: 'typewriter', animOptions: { wordDelayFrames: 3 },
  box: { x: px(485, W), y: px(409, H), w: px(590, W), h: px(118, H) },
});
// body：上推 @+1.1s，d=0.6s
push({
  type: 'textCard', id: 'b1-body', slot: 'b1.explanation',
  startFrame: B1 + 66, durationInFrames: B1 + 480 - (B1 + 66),
  variant: 'subtitle', text: CONTENT['b1.explanation'],
  anim: 'fadeUp', animOptions: { offsetY: 14 },
  box: { x: px(640, W), y: px(570, H), w: px(900, W), h: px(105, H) },
});
// path：生长 @+1.25s → +2.45s，easeInOut
push({
  type: 'shape', id: 'b1-path',
  startFrame: B1 + 75, durationInFrames: B1 + 480 - (B1 + 75),
  shape: 'path', color: BLUE, strokeWidth: 0.5,
  d: 'M 34.4 76.9 L 47.9 76.9 Q 52.6 74.1 56.3 69.4',
  draw: { to: 1, durationInFrames: 72, easing: 'easeInOut' },
});

// ── B2 段（8–18s）─────────────────────────────────────────────
push({
  type: 'textCard', id: 'b2-badge', slot: 'b2.label',
  startFrame: B2 + 6, durationInFrames: B2 + 600 - (B2 + 6),
  variant: 'subtitle', text: CONTENT['b2.label'], accentColor: BLUE,
  anim: 'maskReveal', animOptions: { wordDelayFrames: 0 },
  box: { x: px(256, W), y: px(110, H), w: px(150, W), h: px(32, H) },
});
push({
  type: 'textCard', id: 'b2-heading', slot: 'b2.heading',
  startFrame: B2 + 21, durationInFrames: B2 + 600 - (B2 + 21),
  variant: 'title', text: CONTENT['b2.heading'],
  anim: 'fadeUp', animOptions: { offsetY: 14 },
  box: { x: px(366, W), y: px(294, H), w: px(352, W), h: px(88, H) },
});
// 三张卡：逐张从右滑入，间隔 0.16s = 9.6 帧，d=0.55s = 33 帧
CONTENT['b2.points'].forEach((point, i) => {
  const cy = 370 + i * 120;
  const start = B2 + Math.round((0.9 + i * 0.16) * FPS);
  // 玻璃卡底板
  push({
    type: 'shape', id: `b2-card-${i + 1}-bg`,
    startFrame: start, durationInFrames: B2 + 600 - start,
    shape: 'rect', color: '#141B26',
    box: { x: px(645, W), y: px(cy, H), w: px(910, W), h: px(110, H) },
    animate: { from: { x: px(745, W), opacity: 0 }, to: { x: px(645, W), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' },
  });
  // 左边条（交替蓝 / 金）
  push({
    type: 'shape', id: `b2-card-${i + 1}-bar`,
    startFrame: start, durationInFrames: B2 + 600 - start,
    shape: 'rect', color: i % 2 ? GOLD : BLUE,
    box: { x: px(191, W), y: px(cy, H), w: px(3, W), h: px(110, H) },
    animate: { from: { x: px(291, W), opacity: 0 }, to: { x: px(191, W), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' },
  });
  // 编号（模板生成，不是本期内容，不占槽位）
  push({
    type: 'textCard', id: `b2-card-${i + 1}-no`,
    startFrame: start, durationInFrames: B2 + 600 - start,
    variant: 'subtitle', text: String(i + 1).padStart(2, '0'), accentColor: i % 2 ? GOLD : BLUE,
    animate: { from: { x: px(291, W), opacity: 0 }, to: { x: px(251, W), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' },
  });
  // 正文（占 b2.points 槽位）
  push({
    type: 'textCard', id: `b2-card-${i + 1}-txt`, slot: 'b2.points',
    startFrame: start, durationInFrames: B2 + 600 - start,
    variant: 'subtitle', text: point,
    animate: { from: { x: px(1115, W), opacity: 0 }, to: { x: px(1055, W), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' },
  });
});

const manifest = {
  id: 'b1b2-replica',
  meta: {
    title: '编排复刻实验',
    width: W, height: H, fps: FPS, durationInFrames: TOTAL,
    backgroundColor: '#05070B',
    look: { contrast: 1.18, saturation: 0.92, brightness: 1.0, temperature: -0.25, vignette: 0.42, grain: 0.12 },
    lint: 'off',
    generatedBy: 'slot-contract-draft',
  },
  global: { fontFamily: 'Noto Sans SC', brandColor: BLUE },
  tracks,
};

fs.mkdirSync(HERE, { recursive: true });
fs.writeFileSync(path.join(HERE, '原型-manifest-b1b2-测试夹具.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(HERE, '原型-slots-b1b2.json'), JSON.stringify({ slots, content: CONTENT }, null, 2) + '\n');
console.log('tracks:', tracks.length, '| slots:', slots.length);
console.log('已写 ' + path.join(HERE, '原型-manifest-b1b2-测试夹具.json'));
