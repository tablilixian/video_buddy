import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本目录（脚本自引用，保证整包可搬移，不依赖 /tmp）。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { validateSlotContract } from './原型-slot-validate.mjs';

const BASE_MAN = JSON.parse(fs.readFileSync(path.join(HERE, '原型-manifest-b1b2-测试夹具.json'), 'utf8'));
const BASE_CON = JSON.parse(fs.readFileSync(path.join(HERE, '原型-slots-b1b2.json'), 'utf8'));

const clone = (o) => JSON.parse(JSON.stringify(o));
const findTrack = (m, id) => m.tracks.find((t) => t.id === id);

const CASES = [
  {
    name: '① 合规输入（本期真实内容）',
    expect: 'ok',
    run: () => [clone(BASE_MAN), clone(BASE_CON)],
  },
  {
    name: '② keyword 超字数（10 字 > 上限 8）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      findTrack(m, 'b1-keyword').text = '从想法开始就能成片';
      c.content['b1.keyword'] = '从想法开始就能成片';
      return [m, c];
    },
  },
  {
    name: '③ 必填槽漏填（删掉 keyword 轨）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      m.tracks = m.tracks.filter((t) => t.id !== 'b1-keyword');
      return [m, c];
    },
  },
  {
    name: '④ explanation 超行数（3 行 > 上限 2）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      findTrack(m, 'b1-body').text = '把你的想法\n变成清晰的视觉故事\n再导出成片';
      return [m, c];
    },
  },
  {
    name: '⑤ points 超数量（6 条 > 上限 5）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      for (let i = 0; i < 6; i++) {
        m.tracks.push({
          type: 'textCard', id: `b2-card-extra-${i}`, slot: 'b2.points',
          startFrame: 480, durationInFrames: 600, variant: 'subtitle', text: `额外要点${i + 1}`,
        });
      }
      return [m, c];
    },
  },
  {
    name: '⑥ points 单行超字数（20 字 > 上限 18）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      findTrack(m, 'b2-card-1-txt').text = '结构先固定下来然后让动效跟着节奏走并且一次成片可以复用';
      return [m, c];
    },
  },
  {
    name: '⑦ 引用不存在的槽位',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      findTrack(m, 'b2-heading').slot = 'b9.nonexistent';
      return [m, c];
    },
  },
  {
    name: '⑧ single 槽被多轨消费（应改 kind:list）',
    expect: 'error',
    run: () => {
      const m = clone(BASE_MAN), c = clone(BASE_CON);
      m.tracks.push({
        type: 'textCard', id: 'b2-heading-dup', slot: 'b2.heading',
        startFrame: 480, durationInFrames: 600, variant: 'title', text: '三个要点',
      });
      return [m, c];
    },
  },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const [m, contract] = c.run();
  const r = validateSlotContract(m, contract);
  const got = r.ok ? 'ok' : 'error';
  const hit = got === c.expect;
  hit ? pass++ : fail++;
  console.log(`${hit ? '✅' : '❌'} ${c.name}  → ${got}（期望 ${c.expect}）`);
  for (const e of r.errors) console.log(`      ✗ ${e}`);
}
console.log(`\n通过 ${pass} / ${CASES.length}，失败 ${fail}`);
