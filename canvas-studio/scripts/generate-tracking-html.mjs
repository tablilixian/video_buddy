#!/usr/bin/env node
/**
 * tracking 总账生成器（SSOT = 条目正文，本脚本产出三样东西）：
 *
 *   1. tracking.md §一/§2 两张索引表 —— 从条目元数据行重算，写回 GENERATED 标记之间；
 *   2. tracking.html —— 可筛选的单文件只读视图（含已终结条目，来自 tracking-closed.md）。
 *
 * 条目正文（tracking.md / tracking-closed.md 的 `### BUG-xxx` / `### REQ-xxx` 区段）是唯一手写点：
 *   - 状态变更只改条目的 `- **当前落地状态**：` 行（索引表勿手改）；
 *   - 条目终态后把全文挪入 tracking-closed.md（索引行保留，本脚本继续生成）。
 * 改完跑：node scripts/generate-tracking-html.mjs
 *
 * 解析器只覆盖账本实际使用的 markdown 子集（标题/表格/列表/引用/分隔线/行内粗体代码链接）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainPath = join(root, 'docs', 'tracking.md')
const closedPath = join(root, 'docs', 'tracking-closed.md')
const outPath = join(root, 'docs', 'tracking.html')

const ENTRY_RE = /^### ((?:BUG|REQ)-\d{3})\s*[—｜]/
const FIELD_RE = /^- \*\*(严重度|优先级|状态\(资料库\)|资料库别名|当前落地状态|归属模块|关联 CV)\*\*：(.*)$/

// ---------- markdown 子集渲染 ----------
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  let h = esc(s)
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`)
  h = h.replace(/`([^`]+)`/g, (_m, c) => {
    if (/^(assets\/|docs\/|effect-tests\/|bug-analysis\/|plans\/|tracking-closed\.md|\.\/)/.test(c)) {
      return `<a class="p" href="${c}"><code>${c}</code></a>`
    }
    return `<code>${c}</code>`
  })
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return h
}

const cell = (s) => (s ?? '').replace(/\|/g, '/')

// ---------- 解析一个 md 文档 → { html 片段, 条目 } ----------
function parseDoc(md, { closed = false } = {}) {
  const lines = md.split('\n')
  const body = []
  const entries = new Map()
  const entryStack = []
  let i = 0

  const closeEntry = () => { while (entryStack.length) body.push(entryStack.pop()) }

  while (i < lines.length) {
    const line = lines[i]

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1])) {
      closeEntry()
      const header = line.split('|').slice(1, -1).map((c) => c.trim())
      i += 2
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      body.push('<div class="tw"><table><thead><tr>')
      for (const h of header) body.push(`<th>${inline(h)}</th>`)
      body.push('</tr></thead><tbody>')
      for (const r of rows) {
        body.push('<tr>')
        for (const c of r) body.push(`<td>${inline(c)}</td>`)
        body.push('</tr>')
      }
      body.push('</tbody></table></div>')
      continue
    }

    const hm = line.match(/^(#{1,4})\s+(.*)$/)
    if (hm) {
      const level = hm[1].length
      const text = hm[2]
      const em = ENTRY_RE.exec(line)
      if (level === 3 && em) {
        closeEntry()
        const id = em[1]
        const entry = { id, heading: text, closed, fields: {} }
        let j = i + 1
        while (j < lines.length && !ENTRY_RE.test(lines[j]) && !/^##\s/.test(lines[j]) && lines[j] !== '---') {
          const fm = FIELD_RE.exec(lines[j])
          if (fm) entry.fields[fm[1]] = fm[2].trim()
          j++
        }
        entries.set(id, entry)
        entryStack.push('</section>')
        body.push(`<section class="entry${closed ? ' is-closed' : ''}" id="${id}" data-closed="${closed ? 1 : 0}" data-search="${esc(text.replace(/[*`]/g, '')).replace(/"/g, '&quot;')}">`)
        body.push(`<h3><a class="anchor" href="#${id}">${inline(text)}</a></h3>`)
        i++
        continue
      }
      closeEntry()
      body.push(`<h${level} id="${esc(text.replace(/[*`\s\/（）]/g, '-').slice(0, 60))}">${inline(text)}</h${level}>`)
      i++
      continue
    }

    if (/^---\s*$/.test(line)) { closeEntry(); body.push('<hr>'); i++; continue }
    if (/^>/.test(line)) {
      const buf = []
      while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      body.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`)
      continue
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const buf = []
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        const indent = (/^\s*/.exec(lines[i]) || [''])[0].length
        buf.push({ indent, content: lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '') })
        i++
      }
      const base = buf[0].indent
      let html = ordered ? '<ol>' : '<ul>'
      let nested = false
      for (const it of buf) {
        if (it.indent > base) {
          if (!nested) { html += '<ul>'; nested = true }
          html += `<li>${inline(it.content)}</li>`
        } else {
          if (nested) { html += '</ul>'; nested = false }
          html += `<li>${inline(it.content)}</li>`
        }
      }
      if (nested) html += '</ul>'
      body.push(html + (ordered ? '</ol>' : '</ul>'))
      continue
    }
    if (!line.trim()) { i++; continue }
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||>|\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    body.push(`<p>${buf.map(inline).join(' ')}</p>`)
  }
  closeEntry()
  return { html: body.join('\n'), entries }
}

const mainMd = readFileSync(mainPath, 'utf8')
const closedMd = readFileSync(closedPath, 'utf8')
const mainParsed = parseDoc(mainMd)
const closed = parseDoc(closedMd, { closed: true })

const all = new Map([...mainParsed.entries, ...closed.entries])
if (all.size !== 87) throw new Error(`条目数应为 87，实得 ${all.size}（BUG ${[...all.keys()].filter(k => k.startsWith('BUG')).length} + REQ ${[...all.keys()].filter(k => k.startsWith('REQ')).length}）`)

// ---------- 重算索引表并写回 tracking.md ----------
function prevRows(md, label) {
  const m = md.match(new RegExp(`<!-- GENERATED:INDEX:${label} BEGIN[^>]* -->\\n([\\s\\S]*?)<!-- GENERATED:INDEX:${label} END -->`))
  if (!m) throw new Error(`找不到 GENERATED:INDEX:${label} 标记——先跑 bootstrap 或手工补标记`)
  const rows = new Map()
  for (const line of m[1].split('\n')) {
    if (!/^\| BUG-|^\| REQ-/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    rows.set(cells[0], cells)
  }
  return rows
}

function buildTable(ids, prev, kind) {
  const head = kind === 'BUG'
    ? ['编号', '标题', '严重度', '状态(资料库)', '资料库别名', '当前落地状态', '归属模块', '关联 CV']
    : ['编号', '标题', '优先级', '状态(资料库)', '资料库别名', '当前落地状态', '归属模块', '关联 CV']
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`]
  for (const id of ids) {
    const e = all.get(id)
    const p = prev.get(id) || []
    const f = (field, col) => {
      if (e.fields[field] !== undefined) return cell(e.fields[field])
      if (p[col] !== undefined) return p[col]
      return '—'
    }
    const title = p[1] || e.heading.replace(/^[^—｜]*[—｜]\s*/, '')
    const sev = kind === 'BUG' ? f('严重度', 2) : f('优先级', 2)
    lines.push(`| ${id} | ${title} | ${sev} | ${f('状态(资料库)', 3)} | ${f('资料库别名', 4)} | ${f('当前落地状态', 5)} | ${f('归属模块', 6)} | ${f('关联 CV', 7)} |`)
  }
  return lines.join('\n')
}

const bugIds = [...all.keys()].filter((k) => k.startsWith('BUG')).sort()
const reqIds = [...all.keys()].filter((k) => k.startsWith('REQ')).sort()
const newBugTable = buildTable(bugIds, prevRows(mainMd, 'BUG-001~055'), 'BUG')
const newReqTable = buildTable(reqIds, prevRows(mainMd, 'REQ-001~032'), 'REQ')

let outMain = mainMd
for (const [label, table] of [['BUG-001~055', newBugTable], ['REQ-001~032', newReqTable]]) {
  const re = new RegExp(`(<!-- GENERATED:INDEX:${label} BEGIN[^>]* -->\\n)[\\s\\S]*?(<!-- GENERATED:INDEX:${label} END -->)`)
  if (!re.test(outMain)) throw new Error(`索引标记缺失：${label}`)
  outMain = outMain.replace(re, `$1${table}\n$2`)
}
const indexChanged = outMain !== mainMd
writeFileSync(mainPath, outMain)

// HTML 一律从写回后的最终内容渲染，避免索引同轮变更时视图滞后一拍
const main = indexChanged ? parseDoc(outMain) : mainParsed

// ---------- 生成 HTML 视图 ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas Studio — 需求与缺陷总账</title>
<style>
  :root { --fg:#1c2130; --muted:#68718a; --line:#dfe3ee; --bg:#f7f8fc; --card:#fff;
          --accent:#8a5cf6; --chip:#eef0f8; }
  * { box-sizing:border-box }
  body { margin:0; font:14px/1.65 -apple-system,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;
         color:var(--fg); background:var(--bg) }
  header.bar { position:sticky; top:0; z-index:10; background:var(--card); border-bottom:1px solid var(--line);
               padding:10px 20px; display:flex; gap:14px; align-items:center; flex-wrap:wrap }
  header.bar h1 { font-size:16px; margin:0 }
  header.bar .ssot { color:var(--muted); font-size:12px }
  #q { flex:1 1 260px; max-width:420px; padding:6px 10px; border:1px solid var(--line); border-radius:8px; font:inherit }
  .chip { border:1px solid var(--line); background:var(--chip); border-radius:999px; padding:3px 12px;
          font-size:12px; cursor:pointer; user-select:none }
  .chip.on { background:var(--accent); color:#fff; border-color:var(--accent) }
  main { max-width:1180px; margin:0 auto; padding:18px 20px 80px }
  h1,h2,h3,h4 { line-height:1.4 }
  h2 { font-size:20px; border-bottom:2px solid var(--accent); padding-bottom:6px; margin-top:34px }
  h3 { font-size:16px; margin-top:26px }
  .entry h3 { background:var(--chip); border-left:4px solid var(--accent); padding:6px 10px; border-radius:0 8px 8px 0 }
  .entry.is-closed h3 { border-left-color:#9aa3b8; opacity:.82 }
  .entry.is-closed h3::after { content:"已终结"; margin-left:10px; font-size:11px; color:var(--muted);
        border:1px solid var(--line); border-radius:999px; padding:1px 8px; vertical-align:2px }
  h4 { font-size:14.5px; color:var(--muted) }
  .entry h3 .anchor { color:inherit; text-decoration:none }
  .tw { overflow-x:auto }
  table { border-collapse:collapse; width:100%; font-size:12.8px; margin:10px 0 }
  th,td { border:1px solid var(--line); padding:5px 9px; text-align:left; vertical-align:top }
  th { background:var(--chip); position:sticky; top:52px }
  tr:hover td { background:#fafbff }
  blockquote { margin:10px 0; padding:8px 14px; border-left:3px solid var(--accent);
               background:var(--card); color:var(--muted); border-radius:0 8px 8px 0 }
  code { background:var(--chip); border-radius:4px; padding:1px 5px; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace }
  a { color:var(--accent); text-decoration:none } a:hover { text-decoration:underline }
  a.p code { color:var(--accent) }
  hr { border:none; border-top:1px dashed var(--line); margin:22px 0 }
  ul,ol { padding-left:22px } li ul { margin-top:4px }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:30px 0 }
  .hidden { display:none !important }
  #count { color:var(--muted); font-size:12px }
</style>
</head>
<body>
<header class="bar">
  <h1>Canvas Studio — 需求与缺陷总账</h1>
  <span class="ssot">SSOT = <a href="tracking.md">docs/tracking.md</a>（本页为生成视图 ${new Date().toISOString().slice(0, 10)}；已终结全文在 <a href="tracking-closed.md">tracking-closed.md</a>）</span>
  <input id="q" type="search" placeholder="搜索：编号 / 标题 / 别名 / 模块 / CV…">
  <span class="chip on" data-f="">全部</span>
  <span class="chip" data-f="!closed">未终结</span>
  <span class="chip" data-f="待">待办/待验收</span>
  <span class="chip" data-f="未">未开始/未修</span>
  <span class="chip" data-f="已">已解决/已实现</span>
  <span id="count"></span>
</header>
<main>
${main.html}
<hr>
<h2>已终结条目全文（沉降档 tracking-closed.md）</h2>
<p>以下条目已终态（桌面验收通过 / 已拍板 / 已销项 / 已解决），全文只进不出；索引表仍在 §一/§二 全量保留。</p>
${closed.html}
<footer>generated by scripts/generate-tracking-html.mjs · 只读视图，请勿手改本文件</footer>
</main>
<script>
const q = document.getElementById('q'), chips = [...document.querySelectorAll('.chip')], count = document.getElementById('count')
let filter = ''
function apply() {
  const kw = q.value.trim().toLowerCase()
  let visible = 0
  const match = (el) => {
    const text = (el.dataset.search || el.textContent).toLowerCase()
    const okKw = !kw || text.includes(kw)
    let okF = !filter
    if (!okF && filter === '!closed') okF = el.dataset.closed !== '1'
    else if (!okF) okF = text.includes(filter)
    return okKw && okF
  }
  document.querySelectorAll('section.entry').forEach((el) => {
    const ok = match(el)
    el.classList.toggle('hidden', !ok)
    if (ok) visible++
  })
  document.querySelectorAll('.tw').forEach((tw) => {
    let shown = 0
    tw.querySelectorAll('tbody tr').forEach((tr) => {
      const ok = match(tr)
      tr.classList.toggle('hidden', !ok)
      if (ok) shown++
    })
    if (shown === 0 && (kw || filter)) tw.classList.add('hidden')
    else tw.classList.remove('hidden')
  })
  count.textContent = '条目 ' + visible + ' / ' + document.querySelectorAll('section.entry').length
}
q.addEventListener('input', apply)
chips.forEach((c) => c.addEventListener('click', () => {
  chips.forEach((x) => x.classList.remove('on')); c.classList.add('on')
  filter = c.dataset.f; apply()
}))
apply()
</script>
</body>
</html>
`
writeFileSync(outPath, html)
console.log(`entries: ${all.size}（open ${main.entries.size} / closed ${closed.entries.size}）`)
console.log(`index tables ${indexChanged ? 'UPDATED' : 'unchanged'}`)
console.log(`written ${outPath} (${(html.length / 1024).toFixed(0)} KB)`)
