/**
 * 生成用户卡（CV-069）静态预览：左栏骨架 + 用户条（面板打开态）。
 *
 * 用途：不开桌面就能肉眼验收「面板不透明 / 不被左栏 overflow 裁剪 / 单用户
 * 条按钮」。输出单文件 HTML，配合浏览器截图自查。
 *
 * 用法：node scripts/preview-user.mjs [输出路径]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'user-card-preview.html')
await mkdir(outDir, { recursive: true })

const source = await readFile(join(here, '..', 'src', 'client', 'styles.ts'), 'utf8')
const start = source.indexOf('const STUDIO_STYLES = `')
if (start < 0) throw new Error('找不到 STUDIO_STYLES')
const from = start + 'const STUDIO_STYLES = `'.length
const end = source.indexOf('\n`\n', from)
if (end < 0) throw new Error('找不到 STUDIO_STYLES 结尾')
const studioStyles = source.slice(from, end)

const RESERVED = '<span class="csReserved">待接入</span>'
const entry = (label, right) => `
  <button type="button" class="csUserEntry" ${right === undefined ? '' : 'disabled'}>
    <span class="csUserRowLabel">${label}</span>
    <span class="csUserValue">${right}<span class="csUserChevron">›</span></span>
  </button>`

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 用户卡预览（CV-069）</title>
<style>
  ${studioStyles}
  /* 预览令牌（与 preview-lobby 同表，bg 缩写已修正为 layer） */
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
    --cs-accent: #7c6cff;
    --cs-accent-soft: rgb(124 108 255 / 14%);
    --cs-radius-md: 8px;
    --cs-radius-lg: 12px;
    --cs-shadow-1: 0 2px 10px rgb(0 0 0 / 25%);
    --cs-shadow-2: 0 10px 40px rgb(0 0 0 / 35%);
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
    <div class="pvFill"></div>
    <div class="csUser">
      <button type="button" class="csUserBar">
        <svg class="csUserAvatar" width="28" height="28" viewBox="0 0 36 36"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--cs-accent)"/><stop offset="100%" stop-color="#3a2fa8"/></linearGradient></defs><circle cx="18" cy="18" r="18" fill="url(#g)"/><text x="18" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#fff">林</text></svg>
        <span class="csUserBarName">林小满</span>
      </button>
      <div class="csUserPanel" style="left: 12px; bottom: 24px; position: fixed;">
        <div class="csUserHead">
          <svg class="csUserAvatar" width="40" height="40" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="url(#g)"/><text x="18" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#fff">林</text></svg>
          <div class="csUserHeadMeta"><span class="csUserName">林小满</span><span class="csUserUid">UID：467368332739416065</span></div>
        </div>
        <div class="csUserRow"><span class="csUserRowLabel">个人账号</span><span class="csUserValue"><span class="csUserBadge">默认</span></span></div>
        <div class="csUserRow"><span class="csUserRowLabel">积分余额</span><span class="csUserValue">✦ 2600 ${RESERVED}</span></div>
        ${entry('订阅', RESERVED)}
        <div class="csUserGroup">
          <span class="csUserGroupLabel">主题</span>
          <div class="csUserThemeRow">
            <button type="button" class="csUserThemeBtn">浅色</button>
            <button type="button" class="csUserThemeBtn csUserThemeActive">深色</button>
            <button type="button" class="csUserThemeBtn">跟随系统</button>
          </div>
        </div>
        <div class="csUserGroup">
          <span class="csUserGroupLabel">帮助</span>
          ${entry('记忆管理', RESERVED)}
          ${entry('接入飞书 / 微信', '<span class="csUserBadge">未接入</span>')}
          ${entry('教程', RESERVED)}
          ${entry('更新日志', RESERVED)}
        </div>
        <button type="button" class="csUserEntry csUserSettings">
          <span class="csUserRowLabel">设置</span><span class="csUserChevron">›</span>
        </button>
      </div>
    </div>
  </aside>
  <main class="pvCanvas"></main>
</div>
</body>
</html>`

await writeFile(outPath, html)
console.log(`user-card preview written: ${outPath}`)
