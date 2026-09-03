/**
 * 生成左侧栏「用户自定义分组 + 折叠」静态预览（CV-091）。
 *
 * 直接从 src/client/styles.ts 抽取 STUDIO_STYLES（含本轮新增的 csProjectGroup*
 * / csProjectMove / csProjectRowActions / csProjectListActions 等 15 类），配一份
 * 最小 --dsw-alias-* / --cs-* 令牌表与骨架 DOM，输出单文件 HTML。用途：不开
 * 桌面就能肉眼验收分组渲染、折叠持久化（此预览用内存态模拟）、组内新建、
 * 移动到分组、双击改名、删组回落未分组。交互逻辑用轻量 JS 复刻 ProjectList.tsx。
 *
 * 用法：node scripts/preview-groups.mjs [输出路径]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] ?? join(here, '..', '.workbuddy', 'preview', 'groups-preview.html')

const source = await readFile(join(here, '..', 'src', 'client', 'styles.ts'), 'utf8')
const start = source.indexOf('const STUDIO_STYLES = `')
if (start < 0) throw new Error('找不到 STUDIO_STYLES')
const from = start + 'const STUDIO_STYLES = `'.length
const end = source.indexOf('\n`\n', from)
if (end < 0) throw new Error('找不到 STUDIO_STYLES 结尾')
const studioStyles = source.slice(from, end)

// ---- 预览数据模型（复刻 ProjectList.tsx 的投影）----
const state = {
  groups: [
    { id: 'g1', name: '品牌宣传片' },
    { id: 'g2', name: '实验' },
  ],
  // 各分组下的项目
  byGroup: {
    g1: [
      { id: 'p1', name: '赛博朋克 30s', date: '2026/9/1' },
      { id: 'p2', name: '春节贺岁短片', date: '2026/8/30' },
    ],
    g2: [
      { id: 'p3', name: '测试 A', date: '2026/8/28' },
    ],
  },
  // 未分组桶（老项目 + 新建未分组）
  ungrouped: [
    { id: 'p4', name: '老项目-草稿', date: '2026/8/20' },
    { id: 'p5', name: '随手试', date: '2026/8/18' },
  ],
  collapsed: new Set(),
  // 内联表单开合：'newProject:<key>' / 'newGroup' / 'rename:<key>'
  form: null,
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const itemHtml = (proj, groupId) => `
  <div class="csProjectItem" data-id="${proj.id}">
    <span class="csProjectMeta">
      <span class="csProjectName">${esc(proj.name)}</span>
      <span class="csProjectDate">${esc(proj.date)}</span>
    </span>
    <span class="csProjectRowActions">
      <select class="csProjectMove" title="移动到分组" data-id="${proj.id}">
        <option value="">未分组</option>
        ${state.groups.map(g => `<option value="${g.id}"${g.id === groupId ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select>
      <button type="button" class="csProjectDelete" title="删除项目">×</button>
    </span>
  </div>`

const sectionHtml = (key, title, items, groupId, deletable) => {
  const isCollapsed = state.collapsed.has(key)
  const isForm = state.form === `newProject:${key}`
  const renameOpen = state.form === `rename:${key}`
  return `
  <div class="csProjectGroup" data-key="${key}">
    <div class="csProjectGroupHeader">
      <button type="button" class="csProjectGroupToggle" title="${isCollapsed ? '展开' : '折叠'}" data-toggle="${key}">${isCollapsed ? '▸' : '▾'}</button>
      ${renameOpen
        ? `<input class="csProjectGroupNameInput" data-rename="${key}" value="${esc(title)}" />`
        : `<span class="csProjectGroupName" data-rename-open="${key}" title="${deletable ? '双击重命名' : undefined}">${esc(title)} <span class="csProjectGroupCount">(${items.length})</span></span>`}
      <span class="csProjectGroupActions">
        <button type="button" class="csProjectGroupAdd" title="在该分组下新建项目" data-add="${key}">+</button>
        ${deletable ? `<button type="button" class="csProjectGroupDelete" title="删除分组（组内项目回落未分组）" data-del="${key}">×</button>` : ''}
      </span>
    </div>
    ${!isCollapsed ? `
      ${isForm ? `<div class="csProjectForm csProjectFormInline">
        <input class="csProjectNameInput" data-new-project="${key}" placeholder="项目名" />
        <div class="csProjectFormActions">
          <button type="button" data-new-project-ok="${key}">创建</button>
          <button type="button" data-new-project-cancel="${key}">取消</button>
        </div>
      </div>` : ''}
      ${items.length === 0 && !isForm ? `<div class="csProjectGroupEmpty">空</div>` : ''}
      ${items.map(p => itemHtml(p, groupId)).join('')}
    ` : ''}
  </div>`
}

const renderList = () => {
  const newGroupForm = state.form === 'newGroup'
  const ungrouped = state.ungrouped
  const sections = state.groups
    .map(g => sectionHtml(g.id, g.name, state.byGroup[g.id] ?? [], g.id, true))
    .join('')
  return `
  <div class="csProjectList" id="pvList">
    ${!state.form ? `<div class="csProjectListActions">
      <button type="button" class="csProjectNew" data-new-project="__ungrouped__">+ 新建项目</button>
      <button type="button" class="csProjectNew csProjectNewGroup" data-new-group="1">+ 新建分组</button>
    </div>` : ''}
    ${newGroupForm ? `<div class="csProjectForm">
      <input class="csProjectNameInput" data-new-group-input="1" placeholder="分组名" />
      <div class="csProjectFormActions">
        <button type="button" data-new-group-ok="1">创建</button>
        <button type="button" data-new-group-cancel="1">取消</button>
      </div>
    </div>` : ''}
    <div id="pvEmpty"></div>
    ${sectionHtml('__ungrouped__', '未分组', ungrouped, null, false)}
    ${sections}
  </div>`
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 左侧栏分组预览（CV-091）</title>
<style>
  :root {
    --dsw-alias-bg-base: #14151a;
    --dsw-alias-bg-layer-1: #1b1d24;
    --dsw-alias-bg-layer-2: #23252e;
    --dsw-alias-bg-layer-3: #2c2f3a;
    --dsw-alias-border-l2: #34363f;
    --dsw-alias-border-l3: #454855;
    --dsw-alias-label-primary: #e8e9ee;
    --dsw-alias-label-secondary: #a2a5b4;
    --dsw-alias-label-tertiary: #777b8c;
    --dsw-alias-interactive-bg-hover: #262933;
    --dsw-alias-interactive-bg-active: #30333f;
    --dsw-alias-bg-hover: #262933;
    --dsw-alias-state-error-primary: #ff6b6b;
    --cs-accent: #7c6cff;
    --cs-accent-soft: rgb(124 108 255 / 14%);
    --cs-radius-sm: 5px;
    --cs-radius-md: 8px;
  }
  html[data-light] {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #f7f8fa;
    --dsw-alias-bg-layer-2: #eef0f4;
    --dsw-alias-bg-layer-3: #e4e7ee;
    --dsw-alias-border-l2: #dcdfe6;
    --dsw-alias-border-l3: #c8ccd6;
    --dsw-alias-label-primary: #17181d;
    --dsw-alias-label-secondary: #5b6070;
    --dsw-alias-label-tertiary: #8a8f9e;
    --dsw-alias-interactive-bg-hover: #eceef3;
    --dsw-alias-interactive-bg-active: #dfe2ea;
    --dsw-alias-bg-hover: #eceef3;
    --cs-accent-soft: rgb(124 108 255 / 10%);
  }
  html, body { height: 100%; margin: 0; }
  body {
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    background: var(--dsw-alias-bg-base);
    color: var(--dsw-alias-label-primary);
  }
  .pvShell { display: flex; flex-direction: column; height: 100%; }
  .pvBar {
    display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
    padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-alias-bg-layer-1);
  }
  .pvBar strong { font-size: 13px; }
  .pvBar .pvSpacer { flex: 1; }
  .pvBar button {
    font: inherit; padding: 4px 12px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l2);
    background: transparent; color: var(--dsw-alias-label-primary);
  }
  .pvBar button.pvOn { background: var(--cs-accent); border-color: transparent; color: #fff; }
  .pvStage { flex: 1; min-height: 0; display: flex; }
  /* 预览只展示左栏：固定 300px 宽，右侧留说明 */
  .pvSidebar {
    width: 300px; flex: 0 0 auto; height: 100%; overflow-y: auto;
    border-right: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-alias-bg-base); padding: 10px 8px; box-sizing: border-box;
  }
  .pvNotes {
    flex: 1; padding: 16px 20px; color: var(--dsw-alias-label-secondary);
    font-size: 12.5px; line-height: 1.7; overflow-y: auto;
  }
  .pvNotes h2 { color: var(--dsw-alias-label-primary); font-size: 14px; margin: 0 0 8px; }
  .pvNotes li { margin-bottom: 4px; }
  .pvNotes code { color: var(--cs-accent); }
</style>
<style>
${studioStyles}
</style>
</head>
<body>
<div class="pvShell">
  <div class="pvBar">
    <strong>Canvas Studio · 左侧栏分组预览</strong>
    <span style="color:var(--dsw-alias-label-tertiary)">CV-091</span>
    <span class="pvSpacer"></span>
    <button type="button" id="pvTheme">切换亮色</button>
  </div>
  <div class="pvStage">
    <aside class="pvSidebar" id="pvSidebar"></aside>
    <div class="pvNotes">
      <h2>交互说明（复刻 ProjectList.tsx）</h2>
      <ul>
        <li>顶部 <code>+ 新建项目</code> / <code>+ 新建分组</code> 两个按钮。</li>
        <li>分组头 <code>▾/▸</code> 折叠/展开该分组（真实运行时折叠态按 groupId 存 localStorage 刷新保持；此预览用内存态）。</li>
        <li>分组名 <strong>双击</strong> 进入内联改名（回车确认 / Esc 取消）。</li>
        <li>分组头 <code>+</code> 在该分组下就地展开名称输入新建项目（非全屏 modal）。</li>
        <li>分组头 <code>×</code> 删组（confirm 后组内项目回落「未分组」）。</li>
        <li>项目行 hover 出 <code>移动到分组</code> 下拉，选目标分组即归组。</li>
        <li>「未分组」桶常驻兜底，不可删/不可改名。</li>
      </ul>
      <p style="color:var(--dsw-alias-label-tertiary)">本预览仅渲染左侧栏分组区，画布/对话等其余部分不在此复刻。验收通过后 STATUS 状态由「已修复·待验收」翻「已完成」。</p>
    </div>
  </div>
</div>
<script>
  const sidebar = document.getElementById('pvSidebar')
  const mount = () => { sidebar.innerHTML = ${'`'}${'${renderList()}'}${'`'}; bind() }
  const findGroupOf = id => {
    for (const g of state.groups) if ((state.byGroup[g.id] || []).some(p => p.id === id)) return g.id
    if (state.ungrouped.some(p => p.id === id)) return null
    return undefined
  }
  const moveProject = (id, groupId) => {
    const from = findGroupOf(id)
    let proj
    if (from === null) proj = state.ungrouped.splice(state.ungrouped.findIndex(p => p.id === id), 1)[0]
    else { const arr = state.byGroup[from]; proj = arr.splice(arr.findIndex(p => p.id === id), 1)[0] }
    if (groupId === null || groupId === '' || groupId === undefined) state.ungrouped.push(proj)
    else { (state.byGroup[groupId] = state.byGroup[groupId] || []).push(proj) }
    mount()
  }
  const bind = () => {
    sidebar.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.toggle
      if (state.collapsed.has(k)) state.collapsed.delete(k); else state.collapsed.add(k)
      mount()
    }))
    sidebar.querySelectorAll('[data-rename-open]').forEach(s => s.addEventListener('dblclick', () => {
      state.form = 'rename:' + s.dataset.renameOpen; mount()
    }))
    sidebar.querySelectorAll('[data-rename]').forEach(inp => inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const k = inp.dataset.rename; const g = state.groups.find(x => x.id === k); if (g) g.name = inp.value.trim() || g.name; state.form = null; mount() }
      if (e.key === 'Escape') { state.form = null; mount() }
    }))
    sidebar.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      state.form = 'newProject:' + b.dataset.add; mount()
    }))
    sidebar.querySelectorAll('[data-new-project]').forEach(inp => inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const k = inp.dataset.newProject; const name = inp.value.trim(); if (name) { const p = { id: 'np' + Date.now(), name, date: '2026/9/3' }; if (k === '__ungrouped__') state.ungrouped.push(p); else (state.byGroup[k] = state.byGroup[k] || []).push(p) } state.form = null; mount() }
      if (e.key === 'Escape') { state.form = null; mount() }
    }))
    sidebar.querySelectorAll('[data-new-project-ok]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.newProjectOk; const inp = sidebar.querySelector('[data-new-project="' + k + '"]'); const name = inp.value.trim(); if (name) { const p = { id: 'np' + Date.now(), name, date: '2026/9/3' }; if (k === '__ungrouped__') state.ungrouped.push(p); else (state.byGroup[k] = state.byGroup[k] || []).push(p) } state.form = null; mount()
    }))
    sidebar.querySelectorAll('[data-new-project-cancel]').forEach(b => b.addEventListener('click', () => { state.form = null; mount() }))
    sidebar.querySelectorAll('[data-new-group]').forEach(b => b.addEventListener('click', () => { state.form = 'newGroup'; mount() }))
    sidebar.querySelectorAll('[data-new-group-ok]').forEach(b => b.addEventListener('click', () => {
      const inp = sidebar.querySelector('[data-new-group-input]'); const name = inp.value.trim(); if (name) { const id = 'g' + (state.groups.length + 1); state.groups.push({ id, name }); state.byGroup[id] = [] } state.form = null; mount()
    }))
    sidebar.querySelectorAll('[data-new-group-cancel]').forEach(b => b.addEventListener('click', () => { state.form = null; mount() }))
    sidebar.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.del; const g = state.groups.find(x => x.id === k); if (!g) return
      if (!window.confirm('删除分组「' + g.name + '」？组内项目将移至「未分组」。')) return
      state.ungrouped.push(...(state.byGroup[k] || [])); delete state.byGroup[k]
      state.groups = state.groups.filter(x => x.id !== k); state.collapsed.delete(k); state.form = null; mount()
    }))
    sidebar.querySelectorAll('.csProjectMove').forEach(sel => sel.addEventListener('change', () => {
      moveProject(sel.dataset.id, sel.value === '' ? null : sel.value)
    }))
    sidebar.querySelectorAll('.csProjectDelete').forEach(b => b.addEventListener('click', () => {
      const item = b.closest('.csProjectItem'); const id = item.dataset.id; const from = findGroupOf(id)
      if (!window.confirm('删除项目？')) return
      if (from === null) state.ungrouped = state.ungrouped.filter(p => p.id !== id)
      else state.byGroup[from] = (state.byGroup[from] || []).filter(p => p.id !== id)
      mount()
    }))
  }
  document.getElementById('pvTheme').addEventListener('click', () => {
    const light = document.documentElement.toggleAttribute('data-light')
    document.getElementById('pvTheme').textContent = light ? '切换暗色' : '切换亮色'
  })
  mount()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)
