# 项目图片资源分析表

本仓库（DSH Desktop / VideoBuddy）共发现 **107** 个图片文件，分布在 8 个目录组中。按用途分为以下六大类：

---

## 一、品牌标识（Brand Identity）

### 1. Canvas Studio 插件 — `canvas-studio/assets/brand/`（35 个文件）

| 文件名 | 格式 | 引用位置 / 使用方式 |
|--------|------|---------------------|
| `logo.svg` | SVG | `src/client/brand/LogoMark.tsx` 的几何参考源；品牌主标识 |
| `logo-on-light.svg` | SVG | 浅色背景下的 logo 变体 |
| `logo-mono.svg` | SVG | 单色版 logo（currentColor） |
| `logo-ocean-blue.svg` | SVG | 海洋蓝预设配色版本 |
| `logo-amber-creative.svg` | SVG | 琥珀创意预设配色版本 |
| `logo-ember-violet.svg` | SVG | 炽焰紫预设配色版本 |
| `icon.svg` | SVG | 1024×1024 应用图标源文件 |
| `favicon.svg` | SVG | favicon 源文件（32 网格简化形） |
| `favicon.ico` | ICO | Windows 浏览器标签页 favicon |
| `lockup.svg` | SVG | 横版品牌锁定组合图 |
| `lockup-mono.svg` | SVG | 横版单色锁定图 |
| `lockup-on-light.svg` | SVG | 横版浅色底锁定图 |
| `icon-mono.svg` | SVG | 应用图标单色版 |
| `png/icon-16.png` ~ `png/icon-1024.png`（7 个） | PNG | 各尺寸应用图标：16/32/64/128/256/512/1024px |
| `png/logo-16.png` ~ `png/logo-1024.png`（7 个） | PNG | 各尺寸 logo：16/32/64/128/256/512/1024px |
| `png/favicon-16.png`, `favicon-32.png` | PNG | favicon 位图回退版本 |
| `png/preset-ocean-blue.png` | PNG | 海洋蓝预设展示缩略图 |
| `png/preset-amber-creative.png` | PNG | 琥珀创意预设展示缩略图 |
| `png/preset-ember-violet.png` | PNG | 炽焰紫预设展示缩略图 |
| `png/preset-cinema-violet.png` | PNG | 电影紫预设展示缩略图（默认） |

**代码引用链：**
- `src/brand.ts` → `FAVICON_DATA_URL`：将 favicon SVG 内联为 data: URL，零外部请求注入浏览器标签页
- `src/client/brand-inject.ts` → `installBrandFavicon()`：运行时创建 `<link>` 元素并设置 href 为 FAVICON_DATA_URL
- `src/client/brand/LogoMark.tsx`：React 组件直接内联 SVG 路径，颜色走 CSS 令牌 `--cs-accent` / `--cs-accent-deep`
- `scripts/build-brand-assets.mjs`：几何单一来源生成脚本，从 `BRAND_PRESETS` 解析配色不复制色值

---

### 2. DSH Desktop 插件 — `dsh-plugin-desktop/build/`（9 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `app-icon.png` | Windows & Linux 应用图标；electron-builder manifest `build.win.icon` / `build.linux.icon` |
| `app-icon-mac.png` | macOS 应用图标（由 `scripts/generate-mac-app-icon.mjs` 生成，824×824 居中在透明 1024×1024 画布上）；manifest `build.mac.icon` |
| `tray-icon.svg` | tray 图标的 SVG 源文件（测试中校验其存在和内容） |
| `tray-iconTemplate.png` + `@2x` | macOS 菜单栏 tray 图标（模板模式，自动适配明暗主题）；manifest `trayIcons.templatePath` |
| `tray-icon-blue.png` + `@1.25x`, `@1.5x`, `@2x` | Windows/Linux tray 彩色图标多倍率版本；manifest `trayIcons.bluePath` |

**代码引用链：**
- `dsh-plugin-desktop/package.json` → manifest.build.mac/win/linux.icon
- `dsh-plugin-desktop/tests/plugin.spec.ts:289-291`：验证 harness shell iconPath 和 trayIcons 路径
- `dsh-plugin-desktop/tests/verify-packaged-runtime.spec.ts:225-226`：打包后运行时校验图标存在
- `dsh-plugin-desktop/tests/package.spec.ts:768-940`：完整 manifest 断言 + sharp 元数据校验

---

## 二、文档与 README（Documentation）

### 3. 项目根目录 — `assets/`（11 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `desktop-hero-zh.png` | `README.md:12` — 中文 Hero Banner，宽 100% |
| `desktop-hero-en.png` | 英文 README Hero Banner（对应英文版） |
| `desktop-preview.png` | `README.md:25` — 界面预览截图，宽 100% |
| `community-wechat-group.png` | `README.md:190` — 企业微信二维码，180×180px |
| `community-qq-group.jpg` | `README.md:191` — QQ群二维码，180×180px（唯一 JPG） |
| `community-wechat-official-account.png` | 微信公众号二维码（README 社区区块引用） |
| `community-wecom-assistant.png` | 企业微信助手二维码 |
| `community-wecom-survey.png` | 企业微信问卷图片 |
| `sponsors/88api-logo.png` | `README.md:57` — 赞助商 Logo，120px 宽 |
| `sponsors/astraflow-logo.png` | `README.md:50` — UCloud AstraFlow 赞助商 Logo，96px 宽 |

---

### 4. MiniMax H3 Skill — `minimax-h3/assets/`（10 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `minimax-h3-header.gif` | `README.zh-CN.md:2`, `README.ko.md:2` — 页面顶部 Header Banner，宽 100% |
| `overview.png` | `README.zh-CN.md:87`, `README.ko.md:87` — 系统总览图 |
| `full-arch.png` | `README.zh-CN.md:114`, `README.ko.md:114` — 完整架构图 |
| `minimalist-product-ad-generator.gif` | `README.zh-CN.md:43`, `skills/README.md:38` — Skill 预览卡片，240px 宽 |
| `3d-animation-short-generator.gif` | `README.zh-CN.md:44`, `skills/README.md:48` — Skill 预览卡片 |
| `papercraft-stop-motion-explainer.gif` | `README.zh-CN.md:45`, `skills/README.md:58` — Skill 预览卡片 |
| `brand-promo-video-generator.gif` | `README.zh-CN.md:46`, `skills/README.md:68` — Skill 预览卡片 |
| `music-video-subtitle-generator.gif` | `README.zh-CN.md:49`, `skills/README.md:78` — Skill 预览卡片 |
| `co-op-game-intro-generator.gif` | `README.zh-CN.md:50`, `skills/README.md:88` — Skill 预览卡片 |
| `paper-collage-explainer-generator.gif` | `README.zh-CN.md:51`, `skills/README.md:98` — Skill 预览卡片 |
| `handdrawn-live-video-generator.gif` | `README.zh-CN.md:52`, `skills/README.md:108` — Skill 预览卡片 |

> **注意**：这 8 个 Skill GIF 同时被复制到 `canvas-studio/assets/style-demos/`（见下文第五类），两处内容一致，前者是源、后者是 canvas-studio skill 系统的运行时引用。

---

### 5. Windows Installer 证据 — `docs/evidence/assets/`（2 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `windows-installer-reproduction.png` | `docs/evidence/windows-installer-upgrade-2026-08-25.md:14` — Bug 复现截图 |
| `windows-installer-upgrade-smoke.png` | `docs/evidence/windows-installer-upgrade-2026-08-25.md:18` — 升级冒烟测试验证截图 |

---

## 三、Canvas Studio Skill 系统（Runtime）

### 6. Style Demos — `canvas-studio/assets/style-demos/`（8 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `music-video-subtitle-generator.gif` | `docs/skill-expansion-spec.md:90` 提及：放在此目录即可在澄清第③步渲染预览卡片；上游 skill GIF 由同步脚本从 submodule assets/ 自动复制 |
| `co-op-game-intro-generator.gif` | 同上 — Skill 风格演示 GIF，用于 UI 预览卡 |
| `paper-collage-explainer-generator.gif` | 同上 |
| `3d-animation-short-generator.gif` | 同上 |
| `minimalist-product-ad-generator.gif` | 同上 |
| `handdrawn-live-video-generator.gif` | 同上 |
| `papercraft-stop-motion-explainer.gif` | 同上 |
| `brand-promo-video-generator.gif` | 同上 |

> **与 minimax-h3/assets/ 的 8 个同名 GIF 内容一致**，canvas-studio 侧是运行时消费方。

---

### 7. Effect Test Runner — `canvas-studio/skills/effect-test-runner/assets/`（3 个文件）+ `skills-local/`（镜像副本，共 6 个）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `official-fl2va-keyframe.png` | effect-test-runner skill 的参考关键帧图（FL2VA 官方样张） |
| `character-anchor.png` | 角色锚点参考图，用于测试中比对一致性 |
| `scene-concept.png` | 场景概念参考图 |

> `canvas-studio/skills-local/effect-test-runner/assets/` 是上述 3 个文件的本地镜像副本。

---

## 四、上游子模块（DeepSeek Harness Submodule）

### 8. Website & Docs — `deepseek-harness/website/public/` + `docs/user/guide/`（6 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `wordmark.svg` | DeepSeek Harness 官网 wordmark 标识 |
| `favicon.svg`（×2，website/public + apps/web/public） | Web 应用浏览器标签页 favicon |
| `providers-models-page.png` / `.zh.png` | 用户文档：Provider 模型选择页面截图（EN/ZH） |
| `providers-custom-form.png` / `.zh.png` | 用户文档：自定义 Provider 表单截图（EN/ZH） |

---

### 9. Test Fixtures & Snapshots — `deepseek-harness/`（5 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `examples/acp-agent/tests/snapshots/read-image/workspace/red.png` | ACP Agent read_image 测试快照：红色图片，验证读取正确性 |
| `examples/acp-agent/tests/snapshots/read-image-dimension/workspace/wide.png` | ACP Agent 图片维度测试快照：宽图，验证尺寸解析 |
| `examples/acp-agent/tests/snapshots/read-image-text-route/workspace/red.png` | ACP Agent read_image_text_route 测试快照 |
| `packages/llm/llm-pi-ai/tests/fixtures/qr-code.png` | LLM Pi-AI QR code 识别测试 fixture |
| `packages/skill/skill-badge/assets/dsh-badge.png` | Skill badge 组件展示图片（DSH Badge） |

---

### 10. E2E Test Screenshots — `e2e/shots/`（9 个文件）

| 文件名 | 引用位置 / 使用方式 |
|--------|---------------------|
| `p0-before.png` | P0 测试场景：操作前状态截图 |
| `p0-1-sent.png` | P0 测试步骤 1：消息已发送状态 |
| `p0-1-done.png` | P0 测试步骤 1：完成状态 |
| `p0-2-sent.png` | P0 测试步骤 2：消息已发送状态 |
| `p0-2-approved.png` | P0 测试步骤 2：审批通过状态 |
| `p0-2-steer.png`, `p0-2-steer2.png` | P0 测试步骤 2：引导/转向操作截图（两次） |
| `p0-2-confirmed.png` | P0 测试步骤 2：确认状态 |
| `p0-2-keyframes-done.png` | P0 测试步骤 2：关键帧完成状态 |
| `p0-2-anomaly.png` | P0 测试步骤 2：异常状态截图 |

---

## 汇总统计

| 类别 | 目录 | 文件数 | 主要用途 |
|------|------|--------|----------|
| **品牌标识** | canvas-studio/assets/brand/ + dsh-plugin-desktop/build/ | 44 | Logo、图标、Favicon、Tray、应用图标 |
| **文档配图** | assets/ + minimax-h3/assets/ + docs/evidence/assets/ | 23 | README Banner、社区二维码、赞助商 Logo、Skill 预览 GIF、架构图 |
| **Canvas Studio Skill** | canvas-studio/assets/style-demos/ + skills*/effect-test-runner/assets/ | 14 | Skill 风格演示 GIF（×8）、效果测试参考图（×6） |
| **上游子模块** | deepseek-harness/ (website + docs + tests) | 11 | 官网标识、文档截图、测试 fixture/snapshot |
| **E2E 测试** | e2e/shots/ | 9 | E2E 自动化测试步骤截图 |

> **总计：~107 个图片文件**（部分 PNG 为同一源图的不同尺寸派生）
