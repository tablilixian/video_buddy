/**
 * 生成用户卡（CV-069）静态预览：左栏骨架 + 用户条**三态**（本地模式 / 未登录 / 已登录）。
 *
 * 用途：不开桌面就能肉眼验收「面板不透明 / 不被左栏 overflow 裁剪 / 单用户条按钮」，
 * 以及 2026-10-15 登录切换后的三态形态。此前这台子上写死的是**假身份**（林小满 /
 * 假 UID / 个人账号）—— 那正是产品里被删掉的那一套：预览台是「产品长这样」的凭据，
 * 它自己必须先干净。**已登录示例用「演示账号」这种一看就是夹具的名字**，不借真人姓名。
 *
 * 用法：node scripts/preview-user.mjs [输出路径]
 *      ?state=local|signed-out|signed-in   （缺省 signed-in；未知值必须变红）
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  brandTokensCss,
  defaultPresetId,
  readStudioStyles,
  reportTokenCoverage,
  HOST_TOKENS_DARK,
} from './preview-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'user-card-preview.html')
await mkdir(outDir, { recursive: true })

// STUDIO_STYLES 与 --cs-* 令牌都走共享助手（见 preview-tokens.mjs）：令牌一旦手抄，
// 就会随 brand.ts 漂移，预览便安静地显示残缺效果——比脚本报错贵得多。
const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-user', brandCss, HOST_TOKENS_DARK)

const RESERVED = '<span class="csReserved">待接入</span>'
const entry = (label, right) => `
        <button type="button" class="csUserEntry" ${right === undefined ? '' : 'disabled'}>
          <span class="csUserRowLabel">${label}</span>
          <span class="csUserValue">${right}<span class="csUserChevron">›</span></span>
        </button>`

/** 字母头像（与 UserCard.tsx 的 LetterAvatar 同形；渐变 id 每个实例唯一）。 */
const letterAvatar = (initial, size, gid) => `<svg class="csUserAvatar" width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--cs-accent, #6c5ce7)" /><stop offset="100%" stop-color="#3a2fa8" /></linearGradient></defs><circle cx="18" cy="18" r="18" fill="url(#${gid})" /><text x="18" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#fff">${initial}</text></svg>`

/** 无身份头像（与 UserCard.tsx 的 GuestAvatar 同形）：未登录 / 未配置账号体系。 */
const guestAvatar = (size) => `<svg class="csUserAvatar" width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="18" fill="var(--cs-shell-2, var(--dsw-alias-bg-layer-1))" /><circle cx="18" cy="14.4" r="5.2" fill="var(--dsw-alias-label-tertiary)" /><path d="M8.6 31c1.5-5.2 5.1-7.8 9.4-7.8s7.9 2.6 9.4 7.8z" fill="var(--dsw-alias-label-tertiary)" /></svg>`

/** 面板里的公共块（三态只有身份行与退出登录不同）。 */
const themeGroup = () => `
        <div class="csUserGroup">
          <span class="csUserGroupLabel">主题</span>
          <div class="csUserThemeRow">
            <button type="button" class="csUserThemeBtn">浅色</button>
            <button type="button" class="csUserThemeBtn csUserThemeActive">深色</button>
            <button type="button" class="csUserThemeBtn">跟随系统</button>
          </div>
        </div>`

const helpGroup = () => `
        <div class="csUserGroup">
          <span class="csUserGroupLabel">帮助</span>${entry('记忆管理', RESERVED)}
          ${entry('接入飞书 / 微信', '<span class="csUserBadge">未接入</span>')}
          ${entry('教程', RESERVED)}
          ${entry('更新日志', RESERVED)}
        </div>`

const settingsEntry = () => `
        <button type="button" class="csUserEntry csUserSettings">
          <span class="csUserRowLabel">设置</span><span class="csUserChevron">›</span>
        </button>`

const creditsRow = () => `
        <div class="csUserRow">
          <span class="csUserRowLabel">积分余额</span>
          <span class="csUserValue">✦ 2600 ${RESERVED}</span>
        </div>`

/** 三态之一的状态块。`data-state` 是唯一的切换锚点（自检按它判命中数）。 */
const stateBlock = (id, inner) => `
      <div class="csUser" data-state="${id}">${inner}
      </div>`

// 本地模式：自托管 / 未配置 Supabase。身份行只说「未配置」，不留任何 UID。
const localState = stateBlock('local', `
        <button type="button" class="csUserBar" aria-expanded="true">
          ${guestAvatar(30)}
          <span class="csUserBarMeta">
            <span class="csUserBarName">本地模式</span>
            <span class="csUserBarSub">未配置账号体系</span>
          </span>
        </button>
        <div class="csUserPanel" style="left: 12px; bottom: 24px; position: fixed;">
          <div class="csUserHead">
            ${guestAvatar(40)}
            <div class="csUserHeadMeta"><span class="csUserName">本地模式</span><span class="csUserUid">未配置账号体系</span></div>
          </div>
          <div class="csUserRow">
            <span class="csUserRowLabel">账号体系</span>
            <span class="csUserValue"><span class="csUserBadge">未配置</span></span>
          </div>${creditsRow()}
          ${entry('订阅', RESERVED)}${themeGroup()}${helpGroup()}${settingsEntry()}
        </div>`)

// 未登录：账号体系已配置但没登录。用户条整体是「登录 / 注册」，**不渲染面板**。
const signedOutState = stateBlock('signed-out', `
        <button type="button" class="csUserBar csUserBarSignin">
          <span class="csUserBarSigninLabel">登录 / 注册</span>
        </button>`)

// 已登录：夹具身份（演示账号）——明确是夹具，不是某个真人。
const signedInState = stateBlock('signed-in', `
        <button type="button" class="csUserBar" aria-expanded="true">
          ${letterAvatar('演', 30, 'gBar')}
          <span class="csUserBarMeta">
            <span class="csUserBarName">演示账号</span>
            <span class="csUserBarSub">demo@example.test</span>
          </span>
        </button>
        <div class="csUserPanel" style="left: 12px; bottom: 24px; position: fixed;">
          <div class="csUserHead">
            ${letterAvatar('演', 40, 'gHead')}
            <div class="csUserHeadMeta"><span class="csUserName">演示账号</span><span class="csUserUid">UID：demo-user</span></div>
          </div>
          <div class="csUserRow">
            <span class="csUserRowLabel">登录邮箱</span>
            <span class="csUserValue">demo@example.test</span>
          </div>${creditsRow()}
          ${entry('订阅', RESERVED)}${themeGroup()}${helpGroup()}
        <button type="button" class="csUserEntry csUserSignout">
          <span class="csUserRowLabel">退出登录</span><span class="csUserChevron">›</span>
        </button>${settingsEntry()}
        </div>`)

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 用户卡预览（CV-069 · 三态）</title>
<style>
  ${studioStyles}

  /* 真实 --cs-* 令牌：派生自 lib/brand.js（产品里注入的就是这一份），不手抄。
     基块命中明暗两轨、暗色覆盖层由 :not([data-light]) 限定 —— 详见 preview-tokens.mjs。 */
  ${brandCss}

  /* 宿主令牌（宿主契约，插件只读；预览给一份可用的值） */
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
    --dsh-scrollbar-thumb: #3a3d48;
  }
  body { margin: 0; font-family: -apple-system, "PingFang SC", sans-serif; background: #0d0e12; }
  .pvStage { position: relative; display: flex; height: 100vh; overflow: hidden; }
  .pvProjects {
    width: 280px; display: flex; flex-direction: column; gap: 8px; padding: 12px;
    border-right: 1px solid var(--dsw-alias-border-l2);
    overflow-y: auto; color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-bg-base);
  }
  .pvCanvas { flex: 1; background:
    linear-gradient(color-mix(in srgb, #7c6cff 8%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, #7c6cff 8%, transparent) 1px, transparent 1px);
    background-size: 40px 40px; }
  .pvRow {
    display: flex; align-items: center; gap: 8px; padding: 7px 10px;
    border-radius: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary);
  }
  .pvRowActive { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
  .pvHeader { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; padding: 0 4px; }
  .pvFill { flex: 1 1 auto; min-height: 0; }
  .csUser[hidden] { display: none; }
  /* 三态切换条：人来验收时不必手改地址栏（自检仍按 ?state= 判，两者同一来源）。 */
  .pvBar {
    position: absolute; left: 296px; top: 16px; display: flex; gap: 8px; align-items: center;
    font-size: 12px; color: var(--dsw-alias-label-secondary);
  }
  .pvBar button {
    padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l3); background: transparent;
    color: var(--dsw-alias-label-secondary);
  }
  .pvBar button[aria-pressed="true"] {
    border-color: var(--cs-accent); color: var(--dsw-alias-label-primary);
  }
  .pvCheck {
    position: absolute; right: 16px; bottom: 16px; max-width: 460px; margin: 0;
    padding: 12px 14px; font-size: 12px; line-height: 1.7; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
    white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #pvVerdict { display: none; }
</style>
</head>
<body>
<div class="pvStage">
  <aside class="pvProjects">
    <div class="csBrandHeader">
      <svg width="22" height="22" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="var(--cs-accent)"/></svg>
      <div class="csBrandMeta"><span class="csBrandName">Canvas Studio</span><span class="csBrandSub">创意工厂</span></div>
    </div>
    <header class="pvHeader"><span>项目</span><span style="font-weight:400;color:var(--dsw-alias-label-tertiary)">刷新</span></header>
    <div class="pvRow">陀螺仪科普短片</div>
    <div class="pvRow pvRowActive">品牌宣传片 · 春季</div>
    <div class="pvRow">3D 动画样片</div>
    <div class="pvRow">MV 歌词字幕 Demo</div>
    <div class="pvFill"></div>${localState}${signedOutState}${signedInState}
  </aside>
  <main class="pvCanvas"></main>
  <div class="pvBar">
    <span>用户卡三态</span>
    <button type="button" class="pvStateBtn" data-goto="local">本地模式</button>
    <button type="button" class="pvStateBtn" data-goto="signed-out">未登录</button>
    <button type="button" class="pvStateBtn" data-goto="signed-in">已登录</button>
  </div>
  <div class="pvCheck" id="pvCheck">自检运行中…</div>
  <pre id="pvVerdict"></pre>
</div>
<!-- 自带自检的台子**不调 tokenProbe()**：它会再写一个 #pvVerdict，和下面的判决抢
     同一个 id（运行器只读第一个 ⇒ 本台子的断言永远读不到）。令牌覆盖改由生成期的
     reportTokenCoverage 报（见脚本头）。 -->

<script>
(function () {
  'use strict'
  // 三态切换条（人点）与 ?state= 是**同一个来源** —— 按钮只负责改地址栏。
  var current = new URLSearchParams(location.search).get('state') || 'signed-in'
  Array.prototype.forEach.call(document.querySelectorAll('.pvStateBtn'), function (btn) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute('data-goto') === current))
    btn.addEventListener('click', function () {
      var next = new URLSearchParams(location.search)
      next.set('state', btn.getAttribute('data-goto'))
      location.search = next.toString()
    })
  })
})()
</script>

<script>
(function () {
  'use strict'
  // 三态切换：?state= 必须命中**恰好一个**状态块 —— 状态名打错时安静地显示空页，
  // 是最难查的那种失败（变体矩阵里三行都"通过"，页面上什么都没有）。
  var params = new URLSearchParams(location.search)
  var want = params.get('state') || 'signed-in'
  var blocks = Array.prototype.slice.call(document.querySelectorAll('.csUser[data-state]'))
  var shown = blocks.filter(function (node) { return node.getAttribute('data-state') === want })
  blocks.forEach(function (node) {
    if (shown.indexOf(node) === -1) node.setAttribute('hidden', '')
    else node.removeAttribute('hidden')
  })

  var EXPECT = {
    'local': { name: '本地模式', uid: '未配置账号体系', kind: 'bar' },
    'signed-in': { name: '演示账号', uid: 'UID：', kind: 'bar' },
    'signed-out': { name: null, uid: null, kind: 'signin' },
  }

  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  /* 查询一律**限定在当前状态块内**：三态同页，document.querySelector 连 hidden 的块
     一起命中（排在最前的永远是 local），量出来的就不是被验的那一态 —— 这类"测错了
     对象"的台子比没有台子更糟：它会用一个恒真的绿把真实回归盖住。 */
  function elIn(root, selector) { return root.querySelector(selector) }
  function cssOf(el, prop) { return el === null ? null : getComputedStyle(el).getPropertyValue(prop).trim() }
  function textOf(el) { return el === null ? null : (el.textContent || '').trim() }

  try {
    var expect = EXPECT[want]
    check('state 参数命中唯一状态块（未知值不得静默空页）',
      shown.length === 1 && expect !== undefined,
      'state=' + want + ' matched=' + shown.length)

    if (shown.length === 1 && expect !== undefined) {
      var root = shown[0]
      if (expect.kind === 'signin') {
        /* 未登录：只准有「登录 / 注册」按钮，不许有用户条，也不许有面板 ——
           此前那条面板会拿假身份填头部（未登录却顶着别人的名字 + 假 UID）。 */
        check('未登录态只有登录入口，没有用户条 / 面板',
          elIn(root, '.csUserBarSignin') !== null &&
          elIn(root, 'button.csUserBar:not(.csUserBarSignin)') === null &&
          elIn(root, '.csUserPanel') === null)
      } else {
        var barName = textOf(elIn(root, '.csUserBarName'))
        check('用户条主行是预期身份来源', barName === expect.name, '实测 ' + JSON.stringify(barName))
        check('用户条只有一个 button（防两套入口）',
          root.querySelectorAll('button.csUserBar').length === 1)
        // 面板是这台子存在的主要理由：它必须 position:fixed 才能不被左栏 overflow 裁剪。
        check('面板 position:fixed 生效（不被 .csProjects 裁剪）',
          cssOf(elIn(root, '.csUserPanel'), 'position') === 'fixed')
        var uid = textOf(elIn(root, '.csUserUid'))
        if (expect.uid === 'UID：') {
          check('已登录的 UID 行来自会话（以 UID： 开头）',
            String(uid).indexOf('UID：') === 0, '实测 ' + JSON.stringify(uid))
        } else {
          /* 未配置账号体系时**不得出现任何 UID**：UI 行里没有身份数据可显示，
             填一个假 UID 就是旧 mock 那套回来了。 */
          check('本地模式不显示 UID 行（无身份数据可显示）',
            uid === expect.uid, '实测 ' + JSON.stringify(uid))
        }
      }
    }
  } catch (e) {
    fail += 1
    lines.push('THROW 自检中断 \\u2192 ' + (e && e.message ? e.message : 'unknown'))
  }

  // 判决必须**逐行**落进 #pvVerdict：运行器按换行符切出失败明细（挤成一行只剩摘要，
  // 失败时看不到是哪条炸的）。
  var nl = String.fromCharCode(10)
  var verdict = '# 用户卡验收台' + nl + 'state=' + want + nl + lines.join(nl)
  var pre = document.getElementById('pvVerdict')
  if (pre) pre.textContent = verdict
  document.documentElement.setAttribute('data-pv-fail', String(fail))
  var card = document.getElementById('pvCheck')
  if (card) {
    card.textContent = (fail === 0 ? '\\u2705 全部通过' : '\\u274c ' + fail + ' 条失败') +
      nl + 'state=' + want + nl + lines.join(nl)
  }
})()
</script>
</body>
</html>`

await writeFile(outPath, html, 'utf8')
console.log(`✓ ${outPath}`)
