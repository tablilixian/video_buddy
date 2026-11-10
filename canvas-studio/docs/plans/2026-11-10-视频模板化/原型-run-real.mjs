import fs from 'node:fs';
import { validateSpecLimits } from './原型-spec-limits-validate.mjs';

const REAL = '/Users/wl/Desktop/job/VideoOut/new3/projects/要求： ① 首轮渲染就用 spotFra 3/build/manifest-spec.json';
const real = JSON.parse(fs.readFileSync(REAL, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// 与本仓版式口径对齐的一套上限（按 variant / 角色声明）
const LIMITS = {
  defaults: { maxChars: 24, maxLines: 2, overflow: 'error' },
  byVariant: {
    title:    { maxChars: 20, maxLines: 2, maxCharsPerLine: 12 },
    bullets:  { maxCharsPerLine: 16, maxLines: 3 },
    dataCard: { maxChars: 12, maxLines: 1 },
    subtitle: { maxChars: 40, maxLines: 2 },
  },
  captions: { maxChars: 34, maxLines: 2, fontSize: 30, widthPercent: 92, overflow: 'error' },
};

const CASES = [
  { name: '① 真实四季 spec（原样，无 limits）', expect: 'ok',
    run: () => clone(real) },
  { name: '② 真实四季 spec + 容量合同（本期内容合规）', expect: 'ok',
    run: () => { const s = clone(real); s.limits = clone(LIMITS); return s; } },
  { name: '③ 标题超字数（20 字 > 上限 20）', expect: 'error',
    run: () => { const s = clone(real); s.limits = clone(LIMITS);
      s.visuals.find((v) => v.id === 'title').text = '为什么地球公转会产生一年四季这样明显的更替变化'; return s; } },
  { name: '④ 字幕折行超限（字数 26 ≤34，但 80px 下折 3 行）', expect: 'error',
    run: () => { const s = clone(real); s.limits = clone(LIMITS);
      s.captions[7].text = '以一九五一到一九八零年为基准二零二五年全球平均气温高出一点一八摄氏度';
      s.captions[7].fontSize = 80; // 字数仍在 34 内，但字号变大导致折 3 行
      return s; } },
  { name: '⑤ bullets 单行超字数（20 字 > 上限 16）', expect: 'error',
    run: () => { const s = clone(real); s.limits = clone(LIMITS);
      s.visuals.find((v) => v.id === 'key-tilt').text = ['关键不在于地球与太阳之间的距离远近', '而是在于地轴相对于轨道面的倾斜角度'];
      return s; } },
  { name: '⑥ dataCard 标签超字数（14 字 > 上限 12）', expect: 'error',
    run: () => { const s = clone(real); s.limits = clone(LIMITS);
      s.visuals.find((v) => v.id === 'gauge-label').text = '太阳直射点纬度的绝对极值位置'; return s; } },
  { name: '⑦ overflow=warn（同一超标内容只告警不阻断）', expect: 'warn',
    run: () => { const s = clone(real); s.limits = clone(LIMITS);
      s.limits.byVariant.title = { maxChars: 6, maxLines: 1, overflow: 'warn' };
      s.visuals.find((v) => v.id === 'title').text = '为什么地球公转会产生四季'; return s; } },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const spec = c.run();
  const r = validateSpecLimits(spec, { canvasWidth: 1280 });
  const got = r.errors.length ? 'error' : (r.warnings.some((w) => w.includes('超')) ? 'warn' : 'ok');
  const hit = got === c.expect;
  hit ? pass++ : fail++;
  console.log(`${hit ? '✅' : '❌'} ${c.name}  → ${got}（期望 ${c.expect}）`);
  for (const e of r.errors) console.log(`      ✗ ${e}`);
  for (const w of r.warnings) console.log(`      ⚠ ${w}`);
}
console.log(`\n通过 ${pass} / ${CASES.length}，失败 ${fail}`);
