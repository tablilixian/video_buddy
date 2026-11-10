// 容量合同校验器原型（对齐 manifest-spec.json 层的「limits」）—— 不落仓。
//
// 设计取舍（与 MotionGit 对照）：
//   MotionGit params.schema.json  →  每个字段一个 maxLength（按字段逐个声明）
//   我们的 manifest-spec.json     →  按「版式角色」声明（title / bullets / dataCard / captions）
//   理由：我们的内容角色由 textCard variant + 轨型决定，不是任意命名的字段；
//         按 variant 声明，改版式时只动一处，不用给每个文本轨单独写上限。
//
// 两层校验（对应 MotionGit 的两段式）：
//   L1 静态（本文件）：字数 / 行数 —— 纯字符计数，无字体依赖，Node 侧可跑
//   L2 预检（渲染前）：canvas measureText 实测折行 —— 本原型用中文字宽≈fontSize 估算折行
//
// overflow 语义：error（默认，硬失败）/ warn —— 与本仓「不静默截断」纪律一致。

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const lines = (s) => String(s).split('\n');

/** 取某个 variant 的上限；先查 byVariant，再回落 defaults。 */
function limitsFor(limits, variant) {
  const d = isRecord(limits?.defaults) ? limits.defaults : {};
  const v = isRecord(limits?.byVariant) ? (limits.byVariant[variant] ?? {}) : {};
  return { ...d, ...v };
}

/** 估算文本在给定宽度/字号下折成几行（中文按 1 字 ≈ 1 字号宽；西文按 0.55 估）。 */
function estimateLines(text, fontSize, widthPercent, canvasWidth) {
  const boxPx = (canvasWidth * widthPercent) / 100;
  const perChar = (ch) => (ch.codePointAt(0) > 0x2e80 ? fontSize : fontSize * 0.55);
  let total = 0;
  for (const line of lines(text)) {
    let w = 0;
    for (const ch of line) w += perChar(ch);
    total += Math.max(1, Math.ceil(w / boxPx));
  }
  return total;
}

export function validateSpecLimits(spec, opts = {}) {
  const errors = [];
  const warnings = [];
  const limits = spec?.limits;
  const canvasWidth = opts.canvasWidth ?? spec?.width ?? 1280;

  if (!isRecord(limits)) {
    return { ok: true, errors: [], warnings: ['spec 未声明 limits —— 容量合同缺省不生效（本仓纪律：不静默截断 ⇒ 建议显式声明）'], skipped: true };
  }

  const push = (severity, msg) => (severity === 'error' ? errors : warnings).push(msg);

  // ── visuals[]：按 variant 取上限 ──────────────────────────────
  for (const [i, vis] of (spec?.visuals ?? []).entries()) {
    if (!isRecord(vis) || vis.text === undefined) continue;
    const id = String(vis.id ?? `visuals[${i}]`);
    const variant = String(vis.variant ?? 'title');
    const lim = limitsFor(limits, variant);
    const text = vis.text;
    const isArray = Array.isArray(text);
    const ls = isArray ? text : [text];

    if (isArray) {
      // 数组 = 作者**显式分行**（对齐 MotionGit basic.points：每条 1–2 显式行、每行限长）
      if (lim.maxLines !== undefined && ls.length > lim.maxLines) {
        push(lim.overflow ?? 'error',
          `${id}（variant:${variant}）显式分行数超上限：${ls.length} 行 > 上限 ${lim.maxLines} 行 —— 拆段或改版式`);
      }
      ls.forEach((line, li) => {
        if (typeof line !== 'string') return;
        const cap = lim.maxCharsPerLine ?? lim.maxChars;
        if (cap !== undefined && line.length > cap) {
          push(lim.overflow ?? 'error',
            `${id}[${li}]（variant:${variant}）单行超字数上限：${line.length} 字 > 上限 ${cap} 字`);
        }
      });
    } else {
      // 字符串 = 一整块文本（内部 \n 属意外折行；对齐 MotionGit basic.explanation）
      const totalLines = lines(text).length;
      if (lim.maxChars !== undefined && text.length > lim.maxChars) {
        push(lim.overflow ?? 'error',
          `${id}（variant:${variant}）超字数上限：${text.length} 字 > 上限 ${lim.maxChars} 字 —— 改短文案，不要靠缩字号硬塞`);
      }
      if (lim.maxLines !== undefined && totalLines > lim.maxLines) {
        push(lim.overflow ?? 'error',
          `${id}（variant:${variant}）超行数上限：${totalLines} 行 > 上限 ${lim.maxLines} 行 —— 拆段或改版式`);
      }
    }
  }

  // ── captions[]：字数 + 折行估算 ─────────────────────────────
  const capLim = isRecord(limits.captions) ? limits.captions : {};
  for (const [i, c] of (spec?.captions ?? []).entries()) {
    if (!isRecord(c) || typeof c.text !== 'string') continue;
    const id = String(c.id ?? `captions[${i}]`);
    const fontSize = c.fontSize ?? capLim.fontSize ?? 30;
    const widthPercent = c.widthPercent ?? capLim.widthPercent ?? 92;

    if (capLim.maxChars !== undefined && c.text.length > capLim.maxChars) {
      push(capLim.overflow ?? 'error',
        `${id} 字幕超字数上限：${c.text.length} 字 > 上限 ${capLim.maxChars} 字 —— 改写或拆成两条字幕`);
    }
    const est = estimateLines(c.text, fontSize, widthPercent, canvasWidth);
    if (capLim.maxLines !== undefined && est > capLim.maxLines) {
      push(capLim.overflow ?? 'error',
        `${id} 字幕折行数超上限：按 ${fontSize}px / ${widthPercent}% 宽估算需 ${est} 行 > 上限 ${capLim.maxLines} 行 —— 字幕轨高度装不下，会被裁`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, skipped: false };
}
