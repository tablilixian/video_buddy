#!/usr/bin/env node
// status-summary.mjs — 重算并回写 canvas-studio/docs/STATUS.md 的 §1 速览表。
//
// 数据来源（单一事实来源拆分，与文档既有约定一致）：
//   - STATUS.md §4「CV 主线全量表」 = 仍在追踪的活跃条目（唯一加/改入口）
//   - archive-cv-completed.md       = 已结项（已完成）条目的只读归档
//   - STATUS.md §5「已设计但零落地的模块」 = 仅设计模块数
//
// 用法：
//   node scripts/status-summary.mjs          # 重写 §1 速览表
//   node scripts/status-summary.mjs --dry    # 只打印，不落盘
//
// 幂等：首次运行用 HTML 注释标记包住 §1 表格；之后只在标记内替换。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', 'docs');
const statusPath = join(docs, 'STATUS.md');
const archivePath = join(docs, 'archive-cv-completed.md');
const DRY = process.argv.includes('--dry');

const text = readFileSync(statusPath, 'utf8');
const lines = text.split('\n');

// ---------- 解析 §4 活跃表 ----------
const i4 = lines.findIndex((l) => l.startsWith('## 4.'));
const i5 = lines.findIndex((l, idx) => idx > i4 && l.startsWith('## 5.'));
const sec4 = lines.slice(i4 + 1, i5);

// 把状态文案归一化到稳定桶（对齐 §0.1 词汇 + 文档实际用到的几个派生桶）
function norm(raw) {
  const s = raw.replace(/\*\*/g, '').replace(/[🚩✅➡️]/g, '').trim();
  if (/进行中/.test(s)) return '进行中';
  if (/已撤回|误判/.test(s)) return '已撤回（误判）';
  if (/已否决/.test(s)) return '已否决';
  if (/仅设计/.test(s)) return '仅设计';
  if (/待复现/.test(s)) return '待复现';
  if (/待拍板|拟立项|已立项|暂缓/.test(s)) return '待拍板';
  if (/已完成·待验收/.test(s)) return '已完成·待验收';
  if (/待修复/.test(s)) return '已修复·待验收';
  if (/已修复/.test(s)) return '已修复·待验收';
  if (/已完成/.test(s)) return '已完成';
  if (/待处理|远期记录/.test(s)) return '待处理';
  if (/已分配/.test(s)) return '已分配·未登记';
  return 'OTHER:' + s;
}

const entries = new Map(); // cv -> { status, raw }
const dupWarns = [];
for (const l of sec4) {
  const m = l.match(/^\|\s*(CV-\d+[a-z]?)\s*\|\s*(.+?)\s*\|/);
  if (!m) continue;
  const cv = m[1];
  const st = m[2];
  if (/^-+$/.test(st.replace(/\s/g, ''))) continue; // 分隔行
  if (entries.has(cv)) dupWarns.push(cv);
  entries.set(cv, { status: norm(st), raw: st.replace(/\*\*/g, '').trim() });
}

// ---------- 解析 archive（已完成归档，仅补充 §4 没有的号）----------
if (existsSync(archivePath)) {
  const at = readFileSync(archivePath, 'utf8');
  for (const l of at.split('\n')) {
    const m = l.match(/^####\s*(CV-\d+)/);
    if (m && !entries.has(m[1])) entries.set(m[1], { status: '已完成', raw: '已完成（归档）' });
  }
}

// ---------- §5 仅设计模块数 ----------
const i5sec = lines.findIndex((l) => l.startsWith('## 5.'));
const i6 = lines.findIndex((l, idx) => idx > i5sec && l.startsWith('## 6.'));
const sec5 = lines.slice(i5sec + 1, i6);
const designCount = sec5.filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*模块/.test(l)).length;

// ---------- 聚合 ----------
const ORDER = [
  '已完成', '已修复·待验收', '进行中', '已完成·待验收',
  '待处理', '待拍板', '待复现', '仅设计', '已撤回（误判）', '已否决', '已分配·未登记',
];
const buckets = {};
for (const [cv, e] of entries) (buckets[e.status] ||= []).push(cv);

function enumStr(ids) {
  const nums = ids.filter((id) => /^CV-\d+$/.test(id)).map((id) => +id.slice(3)).sort((a, b) => a - b);
  const letters = ids.filter((id) => /^CV-\d+[a-z]$/.test(id)).sort();
  const parts = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    const a = String(nums[i]).padStart(3, '0');
    const b = String(nums[j]).padStart(3, '0');
    if (j - i >= 2) parts.push(`CV-${a}~${b}`);
    else if (j === i) parts.push(`CV-${a}`);
    else { parts.push(`CV-${a}`); parts.push(`CV-${b}`); }
    i = j + 1;
  }
  return [...parts, ...letters].join(', ');
}

const tableRows = [];
for (const b of ORDER) {
  const ids = buckets[b];
  if (!ids || ids.length === 0) continue;
  tableRows.push(`| ${b} | ${ids.length} | ${enumStr(ids)} |`);
}
// 仅设计模块单独成行（来自 §5，不是 CV 号）
tableRows.push(`| 仅设计（零落地） | ${designCount} 大模块 | 见 §5 |`);

// ---------- 输出块 ----------
const block = [
  '<!-- STATUS_SUMMARY_START -->',
  '| 状态 | 数量 | 条目 |',
  '| --- | --- | --- |',
  ...tableRows,
  '<!-- STATUS_SUMMARY_END -->',
];

// ---------- 落盘（幂等替换）----------
const mStart = lines.findIndex((l) => l.includes('<!-- STATUS_SUMMARY_START -->'));
const mEnd = lines.findIndex((l) => l.includes('<!-- STATUS_SUMMARY_END -->'));
let newLines;
if (mStart !== -1 && mEnd !== -1) {
  newLines = [...lines.slice(0, mStart + 1), ...tableRows, ...lines.slice(mEnd)];
} else {
  const sIdx = lines.findIndex((l) => l.trim() === '| 状态 | 数量 | 条目 |');
  if (sIdx === -1) { console.error('找不到 §1 速览表头，中止'); process.exit(1); }
  let eIdx = sIdx;
  while (eIdx + 1 < lines.length && lines[eIdx + 1].trim().startsWith('|')) eIdx++;
  newLines = [...lines.slice(0, sIdx), ...block, ...lines.slice(eIdx + 1)];
}

// ---------- 报告 ----------
const total = entries.size;
const completed = (buckets['已完成'] || []).length;
const active = total - completed;
console.log('=== STATUS 速览重算报告 ===');
console.log(`活跃条目(§4): ${entries.size - completed}　已完成(§4+archive): ${completed}　合计: ${total}`);
console.log(`仅设计模块(§5): ${designCount}`);
console.log('--- 状态分布 ---');
for (const b of ORDER) if (buckets[b]) console.log(`  ${String(buckets[b].length).padStart(3)}  ${b}`);
if (dupWarns.length) console.warn('⚠️ §4 重复编号:', [...new Set(dupWarns)].join(', '));
const unreg = buckets['已分配·未登记'] || [];
if (unreg.length) console.warn('⚠️ 已分配·未登记（需补录）:', unreg.join(', '));
const maxNum = Math.max(...[...entries.keys()].map((k) => +k.replace(/\D/g, '')).filter((n) => !isNaN(n)));
console.log(`编号上限: CV-${String(maxNum).padStart(3, '0')}`);

if (DRY) {
  console.log('\n[--dry] 不落盘。生成内容预览：');
  console.log(block.join('\n'));
} else {
  writeFileSync(statusPath, newLines.join('\n'));
  console.log('\n✅ 已回写 STATUS.md §1 速览表');
}
