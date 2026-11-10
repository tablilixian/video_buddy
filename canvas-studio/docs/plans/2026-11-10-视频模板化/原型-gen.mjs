// 生成两份交付物：
//   ① manifest-b1b2.json       —— 可直接交给 render_composition 的干净 manifest（无契约外字段）
//   ② manifest-spec-b1b2.json  —— spec 层：含 limits 容量合同（草案的落点形态）
//
// 编排时刻 100% 来自 MotionGit #385712 core/basic.js 的源码规格，已在 ground truth 成片上像素级验证。
// 单位口径：box.x/y = 区域中心（0–100 画布百分比）；animate.x/y = 0–100 百分比位置（50 = 居中）。
// 画布 1920×1080 @ 60fps，18 秒 1080 帧。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本目录（脚本自引用，保证整包可搬移，不依赖 /tmp）。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const W = 1920, H = 1080, FPS = 60;
const pct = (v, span) => +((v / span) * 100).toFixed(2);
const px = (v) => pct(v, W);
const py = (v) => pct(v, H);

const BLUE = '#7DB2FF', GOLD = '#E8B26A', INK = '#E9ECEF';
const B1 = 0, B2 = 480, END = 1080;

const tracks = [];
const push = (t) => { tracks.push(t); return t; };

// ══ 背景 ═══════════════════════════════════════════════════════
push({ type: 'shape', id: 'bg', startFrame: 0, durationInFrames: END,
  shape: 'gradient', color: '#0B1220', box: { x: 50, y: 50, w: 100, h: 100 }, fadeFrames: 0 });
// 标题区柔光晕（对应 MotionGit 的 radial-gradient 底）
push({ type: 'shape', id: 'bg-glow', startFrame: B1 + 12, durationInFrames: B2 + 30 - (B1 + 12),
  shape: 'circle', color: '#16233A', box: { x: 30, y: 42, w: 58, h: 58 }, fadeFrames: 0,
  animate: { from: { opacity: 0 }, to: { opacity: 0.6 }, durationInFrames: 48, easing: 'easeOutCubic' } });

// ══ B1 段（0–8s）═══════════════════════════════════════════════
// ① 章节标签（MotionGit: badge mask 显入 @+0.12s, d=0.4s）
push({ type: 'textCard', id: 'b1-badge', startFrame: B1 + 7, durationInFrames: B2 - (B1 + 7),
  variant: 'subtitle', text: '编排复刻实验', accentColor: BLUE,
  anim: 'maskReveal', animOptions: { wordDelayFrames: 0 }, fadeFrames: 0,
  box: { x: px(256), y: py(180), w: px(170), h: py(42) } });
// ② 金属大标题（MotionGit: charsAt slam @+0.5s, d=0.28s, 错峰 45ms≈3 帧）
push({ type: 'textCard', id: 'b1-keyword', startFrame: B1 + 30, durationInFrames: B2 - (B1 + 30),
  variant: 'title', text: '从想法开始', anim: 'typewriter',
  animOptions: { wordDelayFrames: 3 }, fadeFrames: 0,
  box: { x: px(485), y: py(409), w: px(640), h: py(130) } });
// ③ 正文（MotionGit: body show up @+1.1s, d=0.6s）
push({ type: 'textCard', id: 'b1-body', startFrame: B1 + 66, durationInFrames: B2 - (B1 + 66),
  variant: 'subtitle', text: '把你的想法\n变成清晰的视觉故事', accentColor: INK,
  anim: 'fadeUp', animOptions: { offsetY: 14 }, fadeFrames: 0,
  box: { x: px(640), y: py(570), w: px(900), h: py(140) } });
// ④ 发光路径生长（MotionGit: svgPath + EZ.inout，@+1.25s → +2.45s，末尾反向收回）
push({ type: 'shape', id: 'b1-path', startFrame: B1 + 75, durationInFrames: B2 - (B1 + 75),
  shape: 'path', color: BLUE, strokeWidth: 0.5, fadeFrames: 0,
  d: 'M 34.4 76.9 L 47.9 76.9 Q 52.6 74.1 56.3 69.4',
  draw: { to: 1, durationInFrames: 72, easing: 'easeInOut' } });

// ══ B2 段（8–18s）══════════════════════════════════════════════
// ⑤ 章节标签（MotionGit: badge @+0.1s）
push({ type: 'textCard', id: 'b2-badge', startFrame: B2 + 6, durationInFrames: END - (B2 + 6),
  variant: 'subtitle', text: '编排复刻实验', accentColor: BLUE,
  anim: 'maskReveal', animOptions: { wordDelayFrames: 0 }, fadeFrames: 0,
  box: { x: px(256), y: py(110), w: px(170), h: py(42) } });
// ⑥ 大标题（MotionGit: charsAt up @+0.35s, d=0.3s）
push({ type: 'textCard', id: 'b2-heading', startFrame: B2 + 21, durationInFrames: END - (B2 + 21),
  variant: 'title', text: '三个要点', anim: 'fadeUp', animOptions: { offsetY: 14 }, fadeFrames: 0,
  box: { x: px(366), y: py(294), w: px(420), h: py(120) } });

// ⑦ 三张卡：MotionGit show(p, T0+0.9+i*0.16, {k:'right', dist:100, d:0.55}) —— 错峰 0.16s
const POINTS = ['结构先固定下来', '动效跟着节奏走', '一次成片可复用'];
POINTS.forEach((point, i) => {
  const cy = 370 + i * 120;              // MotionGit 卡片中心 y（px）
  const start = B2 + Math.round((0.9 + i * 0.16) * FPS);
  // 玻璃卡底板
  push({ type: 'shape', id: `b2-card-${i + 1}-bg`, startFrame: start, durationInFrames: END - start,
    shape: 'rect', color: '#141B26', fadeFrames: 0,
    box: { x: px(645), y: py(cy), w: px(910), h: py(110) },
    animate: { from: { x: px(745), opacity: 0 }, to: { x: px(645), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' } });
  // 左边条（交替蓝 / 金）
  push({ type: 'shape', id: `b2-card-${i + 1}-bar`, startFrame: start, durationInFrames: END - start,
    shape: 'rect', color: i % 2 ? GOLD : BLUE, fadeFrames: 0,
    box: { x: px(191), y: py(cy), w: px(4), h: py(110) },
    animate: { from: { x: px(291), opacity: 0 }, to: { x: px(191), opacity: 1 }, durationInFrames: 33, easing: 'easeOutCubic' } });
  // 编号（模板生成，不是本期内容 → 不占槽位）
  push({ type: 'textCard', id: `b2-card-${i + 1}-no`, startFrame: start, durationInFrames: END - start,
    variant: 'subtitle', text: String(i + 1).padStart(2, '0'), accentColor: i % 2 ? GOLD : BLUE,
    anim: 'fadeUp', animOptions: { offsetY: 8 }, fadeFrames: 0,
    box: { x: px(240), y: py(cy - 20), w: px(90), h: py(110) } });
  // 要点正文（占 b2.points 槽位）
  push({ type: 'textCard', id: `b2-card-${i + 1}-txt`, startFrame: start, durationInFrames: END - start,
    variant: 'subtitle', text: point, accentColor: INK,
    anim: 'fadeUp', animOptions: { offsetY: 10 }, fadeFrames: 0,
    box: { x: px(620), y: py(cy - 20), w: px(700), h: py(110) } });
});

const manifest = {
  id: 'b1b2-motiongit-replica',
  meta: {
    title: '编排复刻实验 · MotionGit B1+B2',
    width: W, height: H, fps: FPS, durationInFrames: END,
    backgroundColor: '#0B1220',
    look: { contrast: 1.16, saturation: 0.94, brightness: 1.02, temperature: -0.22, vignette: 0.4, grain: 0.1 },
    lint: 'off',
    generatedBy: 'motiongit-b1b2-replica',
  },
  global: { fontFamily: 'Noto Sans SC', brandColor: BLUE },
  tracks,
};

// ══ spec 层：草案的容量合同落点形态 ═════════════════════════════
const spec = {
  title: '编排复刻实验 · MotionGit B1+B2',
  fps: FPS,
  aspect: '16:9',
  filmFrames: END,
  theme: { background: '#0B1220', layer: '#141B26', accent: BLUE },
  limits: {
    defaults: { maxChars: 24, maxLines: 2, overflow: 'error' },
    byVariant: {
      title:    { maxChars: 20, maxLines: 2, maxCharsPerLine: 12 },
      subtitle: { maxChars: 40, maxLines: 2 },
      bullets:  { maxCharsPerLine: 16, maxLines: 3 },
      dataCard: { maxChars: 12, maxLines: 1 },
    },
    captions: { maxChars: 34, maxLines: 2, fontSize: 30, widthPercent: 92, overflow: 'error' },
  },
  content: {
    'b1.label': '编排复刻实验',
    'b1.keyword': '从想法开始',
    'b1.explanation': '把你的想法\n变成清晰的视觉故事',
    'b2.label': '编排复刻实验',
    'b2.heading': '三个要点',
    'b2.points': POINTS,
  },
};

fs.mkdirSync(HERE, { recursive: true });
fs.writeFileSync(path.join(HERE, '原型-manifest-b1b2.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(HERE, '原型-manifest-spec-b1b2.json'), JSON.stringify(spec, null, 2) + '\n');
console.log('tracks:', tracks.length, '| frames:', END, '| 时长:', END / FPS + 's');
console.log('已写 原型-manifest-b1b2.json');
console.log('已写 原型-manifest-spec-b1b2.json');
