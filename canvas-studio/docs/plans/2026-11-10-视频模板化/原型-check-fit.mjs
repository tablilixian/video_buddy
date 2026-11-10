// 用仓库**真实**的 subtitleFitBudget + fitTextPolicy 逐轨验算：
// 每条 subtitle 轨最终字号多少？有没有静默溢出（overflow=true）？
// 这是 P1「把已有 overflow 标志接出来」的最小复现 —— 这里只做验证，不改仓。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本目录（脚本自引用，保证整包可搬移，不依赖 /tmp）。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CS = '/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/lib/remotion';
const { subtitleFitBudget } = await import(`${CS}/subtitle-fit.js`);
const { fitTextPolicy } = await import(`${CS}/timing.js`);

const manifest = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(HERE, '原型-manifest-b1b2.json'), 'utf8'));
const { width: W, height: H } = manifest.meta;

let bad = 0;
for (const t of manifest.tracks) {
  if (t.type !== 'textCard') continue;
  const text = Array.isArray(t.text) ? t.text.join('\n') : String(t.text ?? '');
  const lines = text.split('\n');
  const box = t.box;

  if (t.variant === 'subtitle') {
    const b = subtitleFitBudget({ box: box === undefined ? undefined : { w: box.w, h: box.h }, canvasWidth: W, canvasHeight: H });
    const r = fitTextPolicy(text, { maxWidthPx: b.maxWidthPx, baseFontPx: b.baseFontPx, maxLines: b.maxLines });
    const overflow = r.lines.length > b.maxLines;
    if (overflow) bad++;
    console.log(
      `${overflow ? '❌' : '✅'} ${t.id.padEnd(16)} ${String(r.fontPx).padStart(3)}px  行数 ${r.lines.length}/${b.maxLines}` +
      `  盒 ${box ? `${box.w.toFixed(1)}%×${box.h.toFixed(1)}%` : '铺满'}` +
      (overflow ? '   ← 静默溢出（会被 overflow:hidden 裁掉）' : ''),
    );
  } else if (t.variant === 'title') {
    const r = fitTextPolicy(text, { maxWidthPx: Math.max(240, W * 0.9), baseFontPx: 84, maxLines: 2 });
    const boxW = box ? (box.w / 100) * W : W;
    const clipped = r.lines.length * r.fontPx * 1.15 > (box ? (box.h / 100) * H : H);
    if (clipped) bad++;
    console.log(
      `${clipped ? '❌' : '✅'} ${t.id.padEnd(16)} ${String(r.fontPx).padStart(3)}px  行数 ${r.lines.length}/2` +
      `  盒 ${box ? `${box.w.toFixed(1)}%×${box.h.toFixed(1)}%` : '铺满'}` +
      (r.fontPx * lines.length > boxW ? '   ← 文字宽度超盒宽' : '') +
      (clipped ? '   ← 高度超盒高（会被裁）' : ''),
    );
  }
}
console.log(`\n有问题的轨：${bad}`);
