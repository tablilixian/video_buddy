#!/usr/bin/env node
/**
 * 生成 docs/tracking.html —— 需求与缺陷总账（docs/tracking.md）的可筛选单文件 HTML 视图。
 *
 * SSOT 始终是 docs/tracking.md；本脚本只是渲染视图。tracking.md 改动后重跑：
 *   node scripts/generate-tracking-html.mjs
 *
 * 解析器只覆盖 tracking.md 实际使用的 markdown 子集：
 *   # / ## / ### / #### 标题、| 表格 |、- 与 1. 列表、> 引用、--- 分隔线、
 *   行内 **加粗** / `代码` / [链接](url)。不支持的语法按纯文本兜底。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs', 'tracking.md')
const out = join(root, 'docs', 'tracking.html')

const md = readFileSync(src, 'utf8')

// ---------- 行内渲染 ----------
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  let h = esc(s)
  // 链接（先于代码，避免吞掉 code 里的括号场景——tracking.md 链接不含反引号）
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`)
  // 行内代码
  h = h.replace(/`([^`]+)`/g, (_m, c) => {
    // 图证/文档相对路径变成可点链接（HTML 与 md 同目录，相对路径直接可用）
    if (/^(assets\/|docs\/|effect-tests\/|bug-analysis\/|plans\/|\.\/)/.test(c)) {
      return `<a class="p" href="${c}"><code>${c}</code></a>`
    }
    return `<code>${c}</code>`
  })
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return h
}

// ---------- 块级解析 ----------
const lines = md.split('\n')
const body = []
let i = 0
let entryDepth = 0 // 当前是否处于 ### 条目内（用于过滤容器）
const entryStack = []

function closeEntry() {
  while (entryStack.length) body.push(entryStack.pop())
  entryDepth = 0
}

while (i < lines.length) {
  const line = lines[i]

  // 表格
  if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1])) {
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

  // 标题
  const hm = line.match(/^(#{1,4})\s+(.*)$/)
  if (hm) {
    const level = hm[1].length
    const text = hm[2]
    if (level <= 2) closeEntry()
    if (level === 3 && /^(BUG|REQ)-\d{3}/.test(text)) {
      closeEntry()
      entryDepth = 1
      entryStack.push('</section>')
      const id = text.match(/^((?:BUG|REQ)-\d{3})/)[1]
      body.push(`<section class="entry" id="${id}" data-search="${esc(text.replace(/[*`]/g, '')).replace(/"/g, '&quot;')}">`)
      body.push(`<h3><a class="anchor" href="#${id}">${inline(text)}</a></h3>`)
      i++
      continue
    }
    body.push(`<h${level} id="${esc(text.replace(/[*`\s\/（）]/g, '-').slice(0, 60))}">${inline(text)}</h${level}>`)
    i++
    continue
  }

  // 分隔线 / 引用 / 列表 / 空行 / 段落
  if (/^---\s*$/.test(line)) { closeEntry(); body.push('<hr>'); i++; continue }
  if (/^>/.test(line)) {
    const buf = []
    while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
    body.push(`<blockquote>${buf.map((l) => inline(l)).join('<br>')}</blockquote>`)
    continue
  }
  if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
    const ordered = /^\s*\d+\./.test(line)
    const buf = []
    while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
      const indent = (/^\s*/.exec(lines[i]) || [''])[0].length
      const content = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
      buf.push({ indent, content })
      i++
    }
    // 两层列表：外层（首行缩进为基准）+ 嵌套子列表挂在前一项下
    const base = buf[0].indent
    let html = ordered ? '<ol>' : '<ul>'
    let nestedOpen = false
    for (const it of buf) {
      if (it.indent > base) {
        if (!nestedOpen) { html += '<ul>'; nestedOpen = true }
        html += `<li>${inline(it.content)}</li>`
      } else {
        if (nestedOpen) { html += '</ul>'; nestedOpen = false }
        html += `<li>${inline(it.content)}</li>`
      }
    }
    if (nestedOpen) html += '</ul>'
    html += ordered ? '</ol>' : '</ul>'
    body.push(html)
    continue
  }
  if (!line.trim()) { i++; continue }
  // 普通段落（连续非空行合并）
  const buf = [line]
  i++
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||>|\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])) {
    buf.push(lines[i]); i++
  }
  body.push(`<p>${buf.map(inline).join(' ')}</p>`)
}
closeEntry()

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas Studio — 需求与缺陷总账</title>
<style>
  :root { --fg:#1c2130; --muted:#68718a; --line:#dfe3ee; --bg:#f7f8fc; --card:#fff;
          --accent:#8a5cf6; --ok:#177e4d; --warn:#a05a00; --bad:#b3372c; --chip:#eef0f8; }
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
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 22px; margin:14px 0 }
  h1,h2,h3,h4 { line-height:1.4 }
  h2 { font-size:20px; border-bottom:2px solid var(--accent); padding-bottom:6px; margin-top:34px }
  h3 { font-size:16px; margin-top:26px }
  .entry h3 { background:var(--chip); border-left:4px solid var(--accent); padding:6px 10px; border-radius:0 8px 8px 0 }
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
  ul,ol { padding-left:22px } li.sub { list-style-type:circle; margin-left:14px }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:30px 0 }
  .hidden { display:none !important }
  #count { color:var(--muted); font-size:12px }
</style>
</head>
<body>
<header class="bar">
  <h1>Canvas Studio — 需求与缺陷总账</h1>
  <span class="ssot">SSOT = <a href="tracking.md">docs/tracking.md</a>（本页为生成视图 ${new Date().toISOString().slice(0, 10)}）</span>
  <input id="q" type="search" placeholder="搜索：编号 / 标题 / 别名 / 模块 / CV…">
  <span class="chip on" data-f="">全部</span>
  <span class="chip" data-f="待">待办/待验收</span>
  <span class="chip" data-f="未">未开始/未修</span>
  <span class="chip" data-f="已">已解决/已实现</span>
  <span id="count"></span>
</header>
<main>
${body.join('\n')}
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
    const okF = !filter || text.includes(filter)
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
    const head = tw.closest('.card, section') || tw
    head.classList.toggle('hidden', shown === 0 && !kw && !filter)
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
writeFileSync(out, html)
console.log(`written ${out} (${(html.length / 1024).toFixed(0)} KB)`)
