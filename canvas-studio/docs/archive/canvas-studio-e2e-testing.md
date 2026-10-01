# Canvas Studio E2E 自动化测试方案

> 本文档是 Canvas Studio 画布插件 E2E 自动化测试的需求与架构设计。目标：用 Playwright + Electron 模拟完整用户旅程（创建项目 → 输入创意 → 等待生成 → 验证画布 → 交互操作 → 导出成片），输出 HTML 测试报告，降低人工回归测试成本。

## 1. 背景与目标

### 1.1 现状痛点

Canvas Studio 的画布交互（拖拽、缩放、连线、snap 对齐）、生成→合成工作流、辅助面板（图层、时间轴、右键菜单）、错误处理等场景，目前**完全依赖人工验收**。每次功能开发后需要手动走一遍完整流程，耗时且容易遗漏。

### 1.2 目标

建立一套 E2E 自动化测试，满足以下要求：

| 要求 | 说明 |
|------|------|
| **完整用户旅程** | 从创建项目到验证产出，覆盖真实用户的完整操作路径 |
| **真实 API 调用** | 不 mock LLM/生成 API，测试真实生成结果 |
| **画布交互覆盖** | 拖拽、缩放、连线、snap 对齐、undo/redo、键盘快捷键 |
| **辅助面板覆盖** | 图层面板、时间轴、右键菜单、详情面板、小地图 |
| **错误场景覆盖** | 网络异常、生成超时、媒体加载失败、重试流程 |
| **测试报告** | Playwright HTML 报告 + 自定义 JSON/HTML 汇总报告 |
| **运行灵活性** | 手动触发为主，后续可接入 CI/CD |

### 1.3 非目标

- 不替代单元测试（`canvas-studio/tests/*.test.mjs` 仍负责纯函数逻辑验证）
- 不替代桌面集成测试（`dsh-plugin-desktop/tests/*.spec.ts` 仍负责 Electron/Profile/打包验证）
- 不做视觉回归测试（截图仅用于报告，不做像素对比）

## 2. 现有测试景观分析

### 2.1 已有测试层级

| 层级 | 位置 | 框架 | 覆盖范围 | 状态 |
|------|------|------|---------|------|
| 纯函数单元测试 | `canvas-studio/tests/*.test.mjs` (14个) | `node:test` | 布局计算、重试可见性、下载名、编码、几何 | ✅ 已有 |
| 桌面集成测试 | `dsh-plugin-desktop/tests/*.spec.ts` (99个) | Vitest | Electron API、Profile、打包、终端、更新 | ✅ 已有 |
| **画布 UI 交互测试** | 无 | — | 拖拽、缩放、连线、snap | ❌ 空白 |
| **完整流程 E2E** | 无 | — | 创建→生成→验证→导出 | ❌ 空白 |
| **错误场景测试** | 无 | — | 超时、失败、重试 | ❌ 空白 |
| **辅助面板测试** | 无 | — | 图层、时间轴、右键菜单 | ❌ 空白 |

### 2.2 现有测试的局限

- `canvas-studio/tests/` 只测纯函数，不涉及 React 组件渲染和用户交互
- `dsh-plugin-desktop/tests/` 测的是桌面壳层逻辑（Electron API、Profile 管理），不涉及画布 UI
- 两者都无法验证"用户点击画布节点 → 节点被选中 → 右键菜单弹出 → 点击删除 → 节点消失"这样的交互链路

## 3. 测试架构设计

### 3.1 分层策略

```
┌─────────────────────────────────────────────────┐
│                  E2E 全流程层                      │
│  Playwright + Electron · 真实 API · 完整用户旅程    │
│  full-journey / canvas-interaction / error / panels│
├─────────────────────────────────────────────────┤
│               纯函数单元测试层（已有）                │
│  node:test · canvas-view / canvas-actions / ...   │
├─────────────────────────────────────────────────┤
│              桌面集成测试层（已有）                   │
│  Vitest · Electron API / Profile / Package        │
└─────────────────────────────────────────────────┘
```

本方案聚焦**顶层 E2E 全流程层**，与已有两层互补。

### 3.2 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| E2E 驱动 | `@playwright/test` + `_electron` | Playwright 官方支持 Electron，可直接操控 BrowserWindow |
| API 处理 | 真实 API 调用 | 测试真实生成结果，不做 mock |
| 测试环境 | 项目根目录运行 | 需要先 `yarn build` 构建应用 |
| 报告格式 | Playwright HTML + 自定义 JSON/HTML 汇总 | 两种报告互补 |
| 运行方式 | 手动触发 | 后续可接 CI/CD |

### 3.3 关键约束

1. **应用必须先构建**：Playwright 启动的是 `lib/main.js` 编译产物，不是源码
2. **真实 API 有延迟**：生成类操作可能需要 30-120 秒，测试需要合理的超时设置
3. **API Key 管理**：从配置文件读取，不硬编码
4. **结果非确定性**：LLM 生成结果每次不同，断言需检查结构而非具体内容

## 4. 目录结构

```
e2e/
├── playwright.config.ts              # Playwright 配置
├── .env.local                        # API Key 配置（不入库）
├── fixtures/
│   └── electron-fixture.ts           # Electron 生命周期 + 步骤截图
├── helpers/
│   ├── canvas-helpers.ts             # 画布操作封装（拖拽、缩放、连线等）
│   ├── app-helpers.ts                # 应用操作封装（创建项目、输入、等待节点）
│   └── wait-helpers.ts               # 异步等待策略（等待节点出现、等待生成完成）
├── tests/
│   ├── full-journey.spec.ts          # 完整用户旅程
│   ├── canvas-interaction.spec.ts    # 画布交互操作
│   ├── error-scenarios.spec.ts       # 错误场景和容错
│   └── panels-menus.spec.ts          # 辅助面板和菜单
├── reports/
│   └── summary-report.ts             # 自定义汇总报告生成器
├── screenshots/                      # 测试截图（自动生成）
└── package.json                      # E2E 测试依赖
```

## 5. 测试场景详细设计

### 5.1 完整用户旅程（full-journey.spec.ts）

模拟真实用户从零开始的完整操作路径。

```
场景：从创建项目到验证产出
├── Step 1: 启动应用，验证初始状态
├── Step 2: 创建新项目
├── Step 3: 在对话框输入创意
├── Step 4: 等待 Agent 生成分镜节点（真实 API，超时 120s）
├── Step 5: 验证画布节点出现（数量、类型）
├── Step 6: 验证节点属性（kind、url、sourceIds 非空）
├── Step 7: 画布交互 — 拖拽节点
├── Step 8: 画布交互 — 缩放（Ctrl+滚轮）
├── Step 9: 右键菜单 — 打开、验证菜单项、关闭
├── Step 10: 图层面板 — 打开、验证节点列表
├── Step 11: Undo/Redo — 操作后验证状态
├── Step 12: 导出成片（需 ≥2 个视频节点）
├── Step 13: 最终验证 — 所有节点完整
└── 每个关键步骤截图
```

**断言策略**（适配非确定性输出）：
- 节点数量：`≥ N`（N 为预期最小值）
- 节点类型：至少包含一个 `image` 或 `video` 节点
- 节点 URL：非空字符串
- UI 状态：选择态、面板可见性等可精确断言

### 5.2 画布交互操作（canvas-interaction.spec.ts）

专注于画布的基础交互行为。

```
场景：拖拽和 snap 对齐
├── 创建多个节点（不同位置）
├── 拖拽节点 A 到节点 B 附近
├── 验证 snap 对齐线出现
├── 验证节点位置变化
└── 释放后验证最终位置

场景：缩放和平移
├── Ctrl+滚轮缩放
├── 验证缩放比例变化
├── 中键/Shift+左键平移
├── 双击空白适配视野
├── 工具栏缩放按钮
└── 小地图交互

场景：连线（血缘关系）
├── 点击节点连线手柄
├── 拖拽到目标节点
├── 验证贝塞尔边出现
├── 验证 sourceIds 更新

场景：键盘快捷键
├── Delete 删除选中节点
├── Ctrl+C / Ctrl+V 复制粘贴
├── Ctrl+Z / Ctrl+Shift+Z undo/redo
├── Ctrl+A 全选
├── Escape 清除选择
├── 方向键微调节点位置
└── Shift+方向键 10px 步进

场景：节点调整大小
├── 拖拽节点角落手柄
├── 验证宽高变化
└── 最小尺寸限制（50px）
```

### 5.3 错误场景（error-scenarios.spec.ts）

验证应用在异常条件下的行为。

```
场景：生成失败 → 重试
├── 模拟生成失败（通过特定 prompt 触发）
├── 验证失败节点显示错误徽章
├── 验证重试按钮可点击
├── 点击重试
├── 验证重试后节点状态变化

场景：媒体加载失败
├── 使用无效 URL 创建节点
├── 验证"媒体加载失败"提示
└── 验证节点不崩溃

场景：网络断开恢复
├── 生成过程中断开网络
├── 验证超时提示
├── 恢复网络
└── 验证应用可继续操作

场景：大量节点性能
├── 创建 50+ 节点
├── 验证拖拽仍流畅
├── 验证缩放无卡顿
└── 验证内存占用合理
```

### 5.4 辅助面板和菜单（panels-menus.spec.ts）

验证辅助 UI 组件的正确性。

```
场景：右键菜单
├── 右键节点 → 菜单弹出
├── 验证菜单项：重命名、复制、删除、锁定、隐藏、重试
├── 点击菜单项 → 执行对应操作
├── 点击菜单外部 → 菜单关闭
├── Escape → 菜单关闭
└── 右键空白 → 空白菜单弹出

场景：图层面板
├── 打开图层面板
├── 验证节点列表与画布同步
├── 点击图层项 → 选中对应节点
├── 切换可见性 → 节点隐藏/显示
├── 切换锁定 → 节点不可拖拽
├── 排序操作 → 层级变化
└── 关闭面板

场景：时间轴
├── 验证时间轴节点顺序
├── 点击时间轴项 → 画布居中定位
├── 拖拽排序 → 顺序变化
└── 合成按钮状态（视频节点 ≥2 时可用）

场景：详情面板
├── 双击节点 → 详情面板打开
├── 验证节点属性显示（分辨率、类型、来源）
├── 修改标题 → 画布节点同步
├── 调整透明度 → 画布节点同步
├── 翻转操作 → 画布节点同步
└── 关闭面板

场景：小地图
├── 小地图默认可见
├── 切换小地图显示/隐藏
├── 小地图视口框反映当前视野
├── 点击小地图 → 画布跳转
└── 拖拽小地图视口 → 画布平移
```

## 6. 技术实现细节

### 6.1 Electron Fixture（electron-fixture.ts）

核心职责：
- 启动 Electron 进程（`electron.launch()`）
- 等待窗口和画布就绪
- 每个测试步骤自动截图
- 测试结束后清理

```typescript
// 伪代码
test.extend<AppFixtures>({
  appPage: async ({}, use) => {
    const app = await electron.launch({ args: ['lib/main.js'] })
    const window = await app.firstWindow()
    await window.waitForSelector('.csFrame', { timeout: 30000 })
    await use(window)
    await app.close()
  },
})
```

**等待策略**：
- `waitForSelector('.csFrame')` — 应用框架渲染完成
- `waitForSelector('.csCanvasSurface')` — 画布就绪
- `waitForFunction(() => document.querySelectorAll('[data-node-id]').length >= N)` — 等待节点生成

### 6.2 画布操作封装（canvas-helpers.ts）

将常见画布操作封装为可复用的 helper 函数：

| 函数 | 用途 |
|------|------|
| `dragNode(page, nodeId, x, y)` | 拖拽节点到指定位置 |
| `resizeNode(page, nodeId, corner, dx, dy)` | 调整节点大小 |
| `linkNodes(page, sourceId, targetId)` | 连线两个节点 |
| `zoomCanvas(page, factor)` | 缩放画布 |
| `panCanvas(page, dx, dy)` | 平移画布 |
| `selectNode(page, nodeId, multi?)` | 选中节点 |
| `openContextMenu(page, nodeId)` | 打开节点右键菜单 |
| `getCanvasNodes(page)` | 获取所有画布节点信息 |
| `assertNodeCount(page, min)` | 断言节点数量 |
| `assertNodeVisible(page, nodeId)` | 断言节点可见 |

### 6.3 应用操作封装（app-helpers.ts）

| 函数 | 用途 |
|------|------|
| `createProject(page, name)` | 创建新项目 |
| `sendCreative(page, text)` | 在对话框输入创意并发送 |
| `waitForNodeCount(page, min, timeout)` | 等待画布节点数量达到最小值 |
| `waitForNodeReady(page, nodeId, timeout)` | 等待指定节点加载完成 |
| `openLayerPanel(page)` | 打开图层面板 |
| `openTimeline(page)` | 打开时间轴 |
| `composeExport(page)` | 导出成片 |

### 6.4 等待策略（wait-helpers.ts）

真实 API 调用的异步等待是关键挑战：

```typescript
// 等待节点出现（轮询 data-node-id）
await page.waitForFunction(
  (minCount) => document.querySelectorAll('[data-node-id]').length >= minCount,
  minCount,
  { timeout: 120_000 }  // 120 秒超时
)

// 等待节点加载完成（loading overlay 消失）
await page.waitForFunction(
  (id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`)
    return el && !el.classList.contains('csNodeLoading')
  },
  nodeId,
  { timeout: 180_000 }  // 3 分钟超时
)

// 等待错误节点出现（用于错误场景测试）
await page.waitForFunction(
  () => document.querySelector('.csNodeError') !== null,
  { timeout: 60_000 }
)
```

## 7. 配置与运行

### 7.1 API Key 配置

```bash
# e2e/.env.local（不入库）
DEEPSEEK_API_KEY=sk-xxxx
CANVAS_STUDIO_API_BASE=https://api.example.com
```

### 7.2 Playwright 配置

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,          // 5 分钟全局超时（真实 API 需要时间）
  expect: { timeout: 10_000 },
  retries: 0,                // 不重试（真实 API 结果非确定性，重试无意义）
  workers: 1,                // 串行执行（Electron 不支持并发）
  reporter: [
    ['html', { outputFolder: 'reports/playwright' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    screenshot: 'off',       // 由 fixture 手动控制截图时机
    trace: 'on-first-retry',
  },
})
```

### 7.3 运行命令

```bash
# 前置：构建应用
corepack yarn build

# 运行全部 E2E 测试
corepack yarn test:e2e

# 运行指定场景
corepack yarn test:e2e --grep "完整用户旅程"

# 运行指定文件
corepack yarn test:e2e tests/canvas-interaction.spec.ts

# 生成报告
corepack yarn test:e2e --reporter=html,json
```

### 7.4 package.json 脚本

```json
{
  "scripts": {
    "test:e2e": "cd e2e && npx playwright test",
    "test:e2e:report": "cd e2e && npx playwright show-report reports/playwright",
    "test:e2e:build": "yarn build && cd e2e && npx playwright install"
  }
}
```

## 8. 测试报告设计

### 8.1 Playwright HTML 报告（自动生成）

Playwright 内置的 HTML reporter，包含：
- 每个测试的通过/失败状态
- 失败时的错误信息和堆栈
- 每个步骤的截图（由 fixture 自动捕获）
- 执行时间

### 8.2 自定义汇总报告（summary-report.ts）

在 Playwright 测试完成后，读取 `reports/results.json`，生成自定义 HTML 报告：

```json
{
  "summary": {
    "total": 15,
    "passed": 13,
    "failed": 1,
    "skipped": 1,
    "duration": "12m 34s",
    "apiCalls": 42,
    "estimatedCost": "$0.85"
  },
  "suites": [
    {
      "name": "完整用户旅程",
      "tests": [
        {
          "name": "创建项目 → 输入创意 → 生成 → 验证 → 导出",
          "status": "passed",
          "duration": "3m 21s",
          "steps": [
            { "name": "创建项目", "status": "passed", "duration": "2s" },
            { "name": "输入创意", "status": "passed", "duration": "1s" },
            { "name": "等待生成", "status": "passed", "duration": "45s" },
            { "name": "验证节点", "status": "passed", "duration": "0.5s" },
            { "name": "导出成片", "status": "passed", "duration": "60s" }
          ],
          "screenshots": ["01-initial.png", "04-nodes-generated.png", "12-final.png"]
        }
      ]
    }
  ],
  "environment": {
    "node": "v22.19.0",
    "platform": "darwin",
    "electron": "43.4.0",
    "playwright": "1.x.x"
  }
}
```

## 9. 实施计划

### Phase 1：基础框架（预计 1-2 天）

- 创建 `e2e/` 目录结构
- 安装 `@playwright/test` 依赖
- 编写 `electron-fixture.ts`（Electron 启动/关闭/截图）
- 编写 `wait-helpers.ts`（异步等待策略）
- 验证：能启动 Electron 并截图

### Phase 2：Helper 封装（预计 1-2 天）

- 编写 `canvas-helpers.ts`（画布操作封装）
- 编写 `app-helpers.ts`（应用操作封装）
- 验证：能在测试中创建项目、输入创意

### Phase 3：测试场景（预计 2-3 天）

- 编写 `full-journey.spec.ts`（完整用户旅程）
- 编写 `canvas-interaction.spec.ts`（画布交互）
- 编写 `error-scenarios.spec.ts`（错误场景）
- 编写 `panels-menus.spec.ts`（辅助面板）
- 验证：所有测试场景可运行

### Phase 4：报告和文档（预计 1 天）

- 编写 `summary-report.ts`（自定义报告生成器）
- 配置 `playwright.config.ts`
- 更新 `package.json` 脚本
- 编写使用文档
- 验证：测试报告正确生成

### Phase 5：调优和稳定（持续）

- 调整超时参数
- 优化等待策略
- 处理 flaky 场景
- 补充边界用例

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 真实 API 延迟不确定 | 测试超时 | 设置宽松超时（120-300s），分阶段等待 |
| LLM 输出非确定性 | 断言失败 | 断言结构（数量、类型）而非具体内容 |
| Electron 启动慢 | 测试启动耗时长 | 首次启动后复用窗口，减少重启 |
| API Key 泄露 | 安全风险 | `.env.local` 加入 `.gitignore`，不入库 |
| 生成成本 | 经济成本 | 使用简短 prompt，测试场景精简 |
| 网络不稳定 | 测试失败 | 添加重试机制（网络层），测试层不重试 |
| 应用构建失败 | 无法运行测试 | 测试脚本自动检查构建产物 |

## 11. 与现有测试的关系

```
用户修改代码
    │
    ├── 纯函数变更 → 跑 canvas-studio/tests/*.test.mjs（快速反馈）
    │
    ├── 桌面壳层变更 → 跑 dsh-plugin-desktop tests（中速反馈）
    │
    └── 画布 UI / 流程变更 → 跑 e2e tests（慢速但全面反馈）
```

三层测试互补，不重叠。E2E 测试聚焦在"用户视角的完整行为验证"，是最后一道防线。
