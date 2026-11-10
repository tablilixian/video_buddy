// 槽位合同校验器（L1 静态层）原型 —— 不落仓，纯 /tmp 验证草案。
// 契约形态：
//   kind:'single'（缺省） 一个槽 = 一份内容，被 0 或 1 条轨消费；容量用 maxChars / maxLines
//   kind:'list'          一个槽 = 一组内容，被 N 条轨消费；容量用 maxCount / maxCharsPerLine / maxLines
// 对应 MotionGit：basic.keyword / basic.explanation / basic.heading = single；basic.points = list
//   （adapter.py limits + points 的 1–5 条 / 每条 ≤2 行 / 每行 ≤18 字的校验口径）

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const lines = (s) => String(s).split('\n');

export function validateSlotContract(manifest, contract) {
  const errors = [];
  const warnings = [];
  const slots = contract?.slots ?? [];
  const content = contract?.content ?? {};

  // ── 0. 合同自身合法性 ────────────────────────────────────────
  const byId = new Map();
  for (const [i, s] of slots.entries()) {
    const at = `slots[${i}]`;
    if (!isRecord(s) || typeof s.id !== 'string' || !s.id.trim()) {
      errors.push(`${at}.id 必须是非空字符串`);
      continue;
    }
    if (byId.has(s.id)) {
      errors.push(`${at}.id 重复（${s.id}）`);
      continue;
    }
    byId.set(s.id, s);
    const kind = s.kind ?? 'single';
    if (!['single', 'list'].includes(kind)) {
      errors.push(`${at}.kind 非法（${String(kind)}）—— 只允许 single / list`);
    }
    if (kind === 'list' && s.maxCount === undefined && s.maxChars === undefined) {
      errors.push(`${at}(${s.id}) 是 list 形态，必须给 maxCount 或 maxChars`);
    }
  }

  // ── 1. 轨 → 槽 的引用完整性 ──────────────────────────────────
  const consumed = new Map(); // slotId -> track[]
  const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
  tracks.forEach((t, i) => {
    const slotId = t?.slot;
    if (slotId === undefined) return;
    if (typeof slotId !== 'string' || !slotId.trim()) {
      errors.push(`tracks[${i}].slot 必须是非空字符串`);
      return;
    }
    if (!byId.has(slotId)) {
      errors.push(`tracks[${i}](${String(t?.id)}) 引用了未声明的槽位 "${slotId}" —— 合同里没有这个槽`);
      return;
    }
    if (!consumed.has(slotId)) consumed.set(slotId, []);
    consumed.get(slotId).push({ track: t, at: `tracks[${i}]` });
  });

  // ── 2. 槽 → 轨 的消费完整性（必填必须有人填）────────────────
  for (const [id, s] of byId) {
    if (s.required !== true) continue;
    const hits = consumed.get(id) ?? [];
    if (hits.length === 0) {
      errors.push(`槽位 "${id}"（${String(s.label ?? '')}）标记为 required，但没有任何轨道消费它 —— 本期内容漏填`);
    }
    if ((s.kind ?? 'single') === 'single' && hits.length > 1) {
      errors.push(`槽位 "${id}" 是 single 形态，却被 ${hits.length} 条轨消费 —— 一槽一份内容，多轨消费请改 kind:'list'`);
    }
  }

  // ── 3. 容量校验 ──────────────────────────────────────────────
  for (const [id, s] of byId) {
    const kind = s.kind ?? 'single';
    const hits = consumed.get(id) ?? [];
    if (hits.length === 0) continue;

    if (kind === 'single') {
      const { track, at } = hits[0];
      const text = track.text;
      if (typeof text !== 'string') continue;
      const ls = lines(text);
      if (s.maxChars !== undefined && text.length > s.maxChars) {
        errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 超字数上限：${text.length} 字 > 上限 ${s.maxChars} 字 —— 改短文案，不要靠缩字号硬塞`);
      }
      if (s.maxLines !== undefined && ls.length > s.maxLines) {
        errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 超行数上限：${ls.length} 行 > 上限 ${s.maxLines} 行 —— 拆段或拆槽`);
      }
      if (s.required === true && !text.trim()) {
        errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 必填但内容为空`);
      }
    }

    if (kind === 'list') {
      if (s.minCount !== undefined && hits.length < s.minCount) {
        errors.push(`槽位 "${id}" 数量不足：${hits.length} 条 < 下限 ${s.minCount} 条`);
      }
      if (s.maxCount !== undefined && hits.length > s.maxCount) {
        errors.push(`槽位 "${id}" 超数量上限：${hits.length} 条 > 上限 ${s.maxCount} 条 —— 加条目不会自动加场景`);
      }
      for (const { track, at } of hits) {
        const text = track.text;
        if (typeof text !== 'string') continue;
        const ls = lines(text);
        if (s.maxCharsPerLine !== undefined) {
          for (const [li, line] of ls.entries()) {
            if (line.length > s.maxCharsPerLine) {
              errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 第 ${li + 1} 行超字数上限：${line.length} 字 > 上限 ${s.maxCharsPerLine} 字`);
            }
          }
        }
        if (s.maxChars !== undefined && text.length > s.maxChars) {
          errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 超字数上限：${text.length} 字 > 上限 ${s.maxChars} 字`);
        }
        if (s.maxLines !== undefined && ls.length > s.maxLines) {
          errors.push(`${at}(${String(track.id)}) 槽位 "${id}" 超行数上限：${ls.length} 行 > 上限 ${s.maxLines} 行`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, consumed: [...consumed.keys()] };
}
