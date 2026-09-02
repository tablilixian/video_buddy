/**
 * 生成 lobby / work 布局静态预览（CV-064）。
 *
 * 直接从 src/client/styles.ts 抽取 STUDIO_STYLES，配一份最小 --dsw-alias-*
 * / --cs-* 令牌表和骨架 DOM，输出单文件 HTML。用途：不开桌面就能肉眼验收
 * 需求 1 的「无项目 → 聊天居中 / 有项目 → 聊天回右栏」，并提供亮/暗与
 * lobby/work 切换开关。
 *
 * 用法：node scripts/preview-lobby.mjs [输出路径]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] ?? join(here, '..', '.workbuddy', 'preview', 'lobby-layout-preview.html')

const source = await readFile(join(here, '..', 'src', 'client', 'styles.ts'), 'utf8')
const start = source.indexOf('const STUDIO_STYLES = `')
if (start < 0) throw new Error('找不到 STUDIO_STYLES')
const from = start + 'const STUDIO_STYLES = `'.length
const end = source.indexOf('\n`\n', from)
if (end < 0) throw new Error('找不到 STUDIO_STYLES 结尾')
const studioStyles = source.slice(from, end)

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · Lobby 布局预览（CV-064）</title>
<style>
  :root {
    --dsw-alias-bg-base: #14151a;
    --dsw-alias-bg-l1: #1b1d24;
    --dsw-alias-bg-l2: #23252e;
    --dsw-alias-bg-l3: #2c2f3a;
    --dsw-alias-border-l2: #34363f;
    --dsw-alias-border-l3: #454855;
    --dsw-alias-label-primary: #e8e9ee;
    --dsw-alias-label-secondary: #a2a5b4;
    --dsw-alias-label-tertiary: #777b8c;
    --dsw-alias-label-warning: #e0a33a;
    --dsw-alias-interactive-bg-hover: #262933;
    --dsw-alias-interactive-bg-active: #30333f;
    --dsw-alias-bg-hover: #262933;
    --dsw-alias-brand: #7c6cff;
    --dsw-alias-focus-ring: #7c6cff;
    --dsw-alias-state-error-border: #d9534f;
    --dsw-alias-state-error-primary: #ff6b6b;
    --dsw-alias-state-success-bg: #1c3326;
    --dsw-alias-state-success-primary: #4ec27a;
    --dsw-alias-scrollbar-bg-l2: #3a3d48;
    --dsw-alias-scrollbar-hover-l2: #4a4d59;
    --cs-accent: #7c6cff;
    --cs-accent-strong: #6a58f5;
    --cs-accent-soft: rgb(124 108 255 / 14%);
    --cs-canvas-bg: #14151a;
    --cs-radius-sm: 5px;
    --cs-radius-md: 8px;
    --cs-radius-lg: 12px;
    --cs-shadow-1: 0 2px 10px rgb(0 0 0 / 25%);
    --cs-shadow-2: 0 10px 40px rgb(0 0 0 / 35%);
  }
  html[data-light] {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-l1: #f7f8fa;
    --dsw-alias-bg-l2: #eef0f4;
    --dsw-alias-bg-l3: #e4e7ee;
    --dsw-alias-border-l2: #dcdfe6;
    --dsw-alias-border-l3: #c8ccd6;
    --dsw-alias-label-primary: #17181d;
    --dsw-alias-label-secondary: #5b6070;
    --dsw-alias-label-tertiary: #8a8f9e;
    --dsw-alias-interactive-bg-hover: #eceef3;
    --dsw-alias-interactive-bg-active: #dfe2ea;
    --dsw-alias-bg-hover: #eceef3;
    --cs-canvas-bg: #ffffff;
    --cs-accent-soft: rgb(124 108 255 / 10%);
    --cs-shadow-1: 0 2px 10px rgb(20 20 30 / 10%);
    --cs-shadow-2: 0 10px 40px rgb(20 20 30 / 14%);
  }
  html, body { height: 100%; margin: 0; }
  body {
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    background: var(--dsw-alias-bg-base);
    color: var(--dsw-alias-label-primary);
  }
  /* 预览外壳：顶栏开关 + 下方 1:1 复刻的 csFrame 区域 */
  .pvShell { display: flex; flex-direction: column; height: 100%; }
  .pvBar {
    display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
    padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-alias-bg-l1);
  }
  .pvBar strong { font-size: 13px; }
  .pvBar .pvSpacer { flex: 1; }
  .pvBar button {
    font: inherit; padding: 4px 12px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l2);
    background: transparent; color: var(--dsw-alias-label-primary);
  }
  .pvBar button.pvOn { background: var(--cs-accent); border-color: transparent; color: #fff; }
  .pvStage { flex: 1; min-height: 0; }
  .pvFrame { height: 100%; }
</style>
<style>
${studioStyles}
</style>
<style>
  /* ---- 预览替身：仅补齐骨架中不由 styles.ts 定义的部分 ---- */
  .csProjectList { display: flex; flex-direction: column; gap: 6px; }
  .csProjectRow {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-l2);
  }
  .csProjectRow.pvSelected { border-color: var(--cs-accent); background: var(--cs-accent-soft); }
  .csProjectRowMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .csProjectRowName { font-size: 12px; }
  .csProjectRowDate { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
  .csProjectNew {
    padding: 7px 12px; font: inherit; border-radius: 8px; cursor: pointer;
    border: 1px dashed var(--dsw-alias-border-l3); background: transparent;
    color: var(--dsw-alias-label-primary);
  }
  .pvToolbarMock {
    display: flex; gap: 6px; padding: 6px 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-l1);
  }
  .pvToolbarMock span {
    padding: 3px 9px; border-radius: 5px; font-size: 12px;
    border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary);
  }
  .pvSurfaceMock {
    flex: 1; min-height: 0; position: relative; overflow: hidden;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .pvNode {
    position: absolute; border-radius: 10px; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-l2);
    display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); font-size: 12px;
  }
  .pvTimeline {
    flex: 0 0 auto; display: flex; gap: 8px; align-items: center;
    padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-l1);
  }
  .pvClip {
    width: 96px; height: 54px; border-radius: 6px; flex: 0 0 auto;
    background: linear-gradient(135deg, var(--cs-accent-soft), var(--dsw-alias-bg-l3));
    border: 1px solid var(--dsw-alias-border-l2);
  }
  /* 对话槽替身：真实运行时由 @deepseek-ai/dsh-client-ui-conversation 注入 */
  .csConversation { display: flex; flex-direction: column; }
  .pvMsgList { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .pvMsg { max-width: 76%; padding: 8px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.6; }
  .pvMsg.pvMe { align-self: flex-end; background: var(--cs-accent); color: #fff; }
  .pvMsg.pvAi { align-self: flex-start; background: var(--dsw-alias-bg-l2); color: var(--dsw-alias-label-primary); }
  .pvComposer { flex: 0 0 auto; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
  .pvComposerBox {
    min-height: 62px; border-radius: 10px; padding: 9px 11px;
    border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
    color: var(--dsw-alias-label-tertiary); font-size: 12.5px;
  }
</style>
</head>
<body>
<div class="pvShell">
  <div class="pvBar">
    <strong>Canvas Studio · Lobby 布局预览</strong>
    <span style="color:var(--dsw-alias-label-tertiary)">CV-064</span>
    <span class="pvSpacer"></span>
    <button type="button" id="pvMode" class="pvOn">lobby（无项目）</button>
    <button type="button" id="pvTheme">切换亮色</button>
  </div>
  <div class="pvStage">
    <div class="csFrame pvFrame" id="pvFrame" data-mode="lobby">
      <aside class="csProjects">
        <div class="csBrandHeader">
          <svg class="csLogoMark" width="22" height="18" viewBox="0 0 118 96" role="img" aria-label="logo">
            <rect x="0" y="0" width="118" height="11" rx="3" fill="#E8E8E8" />
            <rect x="0" y="11" width="46" height="85" fill="#F4F4F6" />
            <rect x="46" y="11" width="72" height="85" fill="var(--cs-accent, #7C6CFF)" />
            <g stroke="var(--cs-accent-deep, #5B4BD6)" stroke-width="13" opacity="0.55">
              <line x1="46" y1="96" x2="82" y2="60" /><line x1="66" y1="96" x2="102" y2="60" />
            </g>
          </svg>
          <div class="csBrandMeta">
            <span class="csBrandName">Canvas Studio</span>
            <span class="csBrandSub">创意工厂</span>
          </div>
        </div>
        <header class="csProjectsHeader"><span>项目</span><button type="button">刷新</button></header>
        <div class="csProjectList">
          <button type="button" class="csProjectNew">+ 新建项目</button>
          <div class="csProjectRow pvSelected" id="pvRow1">
            <div class="csProjectRowMeta"><span class="csProjectRowName">品牌宣传片</span><span class="csProjectRowDate">2026/9/1</span></div>
          </div>
          <div class="csProjectRow"><div class="csProjectRowMeta"><span class="csProjectRowName">手绘风短剧</span><span class="csProjectRowDate">2026/8/30</span></div></div>
          <div class="csProjectRow"><div class="csProjectRowMeta"><span class="csProjectRowName">3D 动画开场</span><span class="csProjectRowDate">2026/8/28</span></div></div>
        </div>
      </aside>

      <main class="csCanvas">
        <div class="csToolbar pvToolbarMock">
          <span>撤销</span><span>重做</span><span>添加</span><span>上传</span><span>自动布局</span><span>图层</span><span>适配</span>
        </div>
        <div class="csWorkflowBar">
          <div class="csWorkflowMode" role="group" aria-label="执行模式">
            <button type="button" class="csActive">逐步确认</button>
            <button type="button">放手跑</button>
          </div>
          <span class="csWorkflowState">制作中</span>
        </div>
        <!-- lobby：品牌条；work：画布 + 时间轴 -->
        <div class="csLobbyHero" id="pvHero">
          <div class="csLobbyBrand">
            <svg class="csLogoMark" width="38" height="31" viewBox="0 0 118 96" role="img" aria-label="logo">
              <rect x="0" y="0" width="118" height="11" rx="3" fill="#E8E8E8" />
              <rect x="0" y="11" width="46" height="85" fill="#F4F4F6" />
              <rect x="46" y="11" width="72" height="85" fill="var(--cs-accent, #7C6CFF)" />
              <g stroke="var(--cs-accent-deep, #5B4BD6)" stroke-width="13" opacity="0.55">
                <line x1="46" y1="96" x2="82" y2="60" /><line x1="66" y1="96" x2="102" y2="60" />
              </g>
            </svg>
            <div class="csLobbyBrandMeta">
              <h1 class="csLobbyTitle">Canvas Studio<span class="csLobbyNameZh">创意工厂</span></h1>
              <p class="csLobbyTagline">From idea to final cut. · 从创意到成片</p>
              <p class="csLobbyHint">在下面描述你的创意 —— 分镜、定妆、场景与成片，agent 替你排好。</p>
            </div>
          </div>
          <div class="csLobbyActions">
            <div class="csLobbyButtons">
              <button type="button" class="csPrimary">+ 新建项目</button>
              <button type="button" class="csWelcomeSample">创建示例项目</button>
            </div>
            <p class="csLobbySampleHint">预置分镜与视频节点，直观感受全链路</p>
          </div>
        </div>
        <div class="csCanvasBody" id="pvCanvasBody" hidden>
          <div class="pvSurfaceMock">
            <div class="pvNode" style="left:40px;top:40px;width:180px;height:120px">分镜 01</div>
            <div class="pvNode" style="left:300px;top:70px;width:180px;height:120px">角色定妆</div>
            <div class="pvNode" style="left:560px;top:40px;width:200px;height:120px">场景概念</div>
            <div class="pvNode" style="left:300px;top:250px;width:200px;height:120px">镜头 01</div>
          </div>
        </div>
        <div class="pvTimeline" id="pvTimeline" hidden>
          <div class="pvClip"></div><div class="pvClip"></div><div class="pvClip"></div><div class="pvClip"></div>
          <span style="color:var(--dsw-alias-label-tertiary);font-size:12px">时间轴（导出成片）</span>
        </div>
      </main>

      <aside class="csChat">
        <section class="csConversation">
          <div class="pvMsgList">
            <div class="pvMsg pvAi">描述你的创意，我来排分镜、定妆、场景，最后合成成片。</div>
            <div class="pvMsg pvMe">做一个 30 秒的品牌宣传片，赛博朋克风。</div>
            <div class="pvMsg pvAi">收到。先出 8 镜分镜表，批准后进入角色定妆与场景概念。</div>
          </div>
          <div class="pvComposer"><div class="pvComposerBox">说说你想做什么…</div></div>
        </section>
      </aside>
    </div>
  </div>
</div>
<script>
  const frame = document.getElementById('pvFrame')
  const hero = document.getElementById('pvHero')
  const body = document.getElementById('pvCanvasBody')
  const timeline = document.getElementById('pvTimeline')
  const row = document.getElementById('pvRow1')
  const modeBtn = document.getElementById('pvMode')
  const themeBtn = document.getElementById('pvTheme')

  const apply = () => {
    const lobby = frame.dataset.mode === 'lobby'
    hero.hidden = !lobby
    body.hidden = lobby
    timeline.hidden = lobby
    row.classList.toggle('pvSelected', !lobby)
    modeBtn.textContent = lobby ? 'lobby（无项目）' : 'work（已开项目）'
    modeBtn.classList.toggle('pvOn', lobby)
  }
  modeBtn.addEventListener('click', () => {
    frame.dataset.mode = frame.dataset.mode === 'lobby' ? 'work' : 'lobby'
    apply()
  })
  themeBtn.addEventListener('click', () => {
    const light = document.documentElement.toggleAttribute('data-light')
    themeBtn.textContent = light ? '切换暗色' : '切换亮色'
  })
  apply()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)
