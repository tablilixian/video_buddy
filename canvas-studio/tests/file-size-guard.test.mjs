/**
 * 文件大小守卫（执行计划 T0.1/T0.2，2026-10-28，[plans/2026-10-28-超大文件拆分执行计划.md](../docs/plans/2026-10-28-超大文件拆分执行计划.md)）。
 *
 * ## 为什么需要
 *
 * 本仓库的常态是「一个小模块一件事」（`src/` 下 270 个源文件以 4–16KB 为主）。2026-10 清点
 * 发现 6 个 P0 文件偏离基线（`styles.ts` 10,731 行、`routes.ts` 单函数 2,834 行……），且
 * 「新功能最后都往大文件里塞」是结构性趋势。不立闸，拆完必回涨。本文件是拆分执行的
 * **第一道结构守卫**：先于一切搬动落地。
 *
 * ## 闸规格
 *
 * 1. **单文件 ≤ 1,200 行**；**单函数 ≤ 600 行**（两把尺都过才算过）。
 * 2. **函数跨度 = 真实体量**：单遍词法扫描（状态机 + 帧栈）跳过字符串 / 模板字面量 /
 *    注释 / 正则字面量后，按 `{` 帧与模板帧的进出量出每个声明的真实行数。计量对象：
 *    顶层 `function` / `class`、类成员方法、顶层 `const`（跟随其初始化的模板字面量或
 *    行尾对象体）、`useEffect` / `useLayoutEffect` 块。
 *    一个 3,000 行文件里 30 个 100 行函数，和一个 3,000 行文件里 1 个 2,800 行函数，
 *    维护难度差一个量级 —— 所以两把尺缺一不可。
 * 3. **棘轮**：白名单登记「当前实测值」，实测 > 登记值即红；实测降到闸线以下判红并提示
 *    「请删除条目」（强制收缩，防僵尸豁免）。同名声明取**最大**跨度登记（只高不低，安全方向）。
 * 4. **fail-closed**：扫描器对任何文件失步（EOF 栈非空 / 声明头未落块）即整条红 ——
 *    宁可误报让人扩词法器，不可静默放行巨兽函数。
 * 5. 生成目录跳过：守卫测生成器，不测生成物。
 *
 * ## 度量的已知盲区（全部以「文件闸 ≤1,200」兜底）
 *
 * - 顶层 `const X = someCall(…)` / `= [ … ]`（括号或数组初始化）无量体 —— 巨型 const
 *   数据表（如 `errors/catalog.ts` 的 `SPECS`）由文件闸按文件管住；
 * - 类字段箭头（`handler = (x) => {`）与 `#private` 方法不识别为成员；
 * - 嵌套在 namespace / 非顶层作用域里的声明不计量。
 *
 * ## 变红验证记录（T0.3，2026-10-28）
 *
 * - 给 `src/clipboard-copy.ts` 追加 1,300 行 → 文件闸红；撤销。
 * - 给 `src/host-tools.ts` 的 `createStudioTools` 尾部追加 50 行 → 函数闸红（棘轮生效）；撤销。
 * - 临时删除白名单一条 → 对应文件/函数红（白名单确实在放行）。
 *
 * 运行：node --test tests/file-size-guard.test.mjs（读 src 源码文本，不需要先 build）。
 *
 * desktop / market 各有一份同规格独立实现（`tests/file-size-guard.spec.ts`）——
 * 三包互不 import 是依赖方向规则，这份扫描器有意复制三份，改尺请三处同步。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FILE_LIMIT = 1200
export const FUNC_LIMIT = 600

/** 生成目录（相对包根），产物由脚本生成 —— 守卫不测生成物，测生成器。 */
const GENERATED_DIRS = new Set(['src/contracts/generated'])

/** 文件行数棘轮。键 = `src/...` 相对包根路径，值 = 当前实测行数（拆分时逐段下调，达标即删）。 */
export const FILE_WHITELIST = {
  // CV-384（2026-10-31）：批 1 删 .csNode will-change 净 0（注释等行改写）；
  // 批 3 世界层 will-change → translate3d（提升通道改走 3D 变换），注释换规则行 +3。
  // 订阅与积分（2026-11-02）：订阅页全屏样式（.csBill* 约 250 行）+ 用户卡三行
  // +266，10734 → 11000 显式登记。消化路径：`.csBill*` 段与既有「按域拆 CSS」计划
  // 同批外提，不在本次新立拆分批。
  // REQ-037（2026-11-03）：素材托盘四分区样式（分组/文本展开）+ 待落画布条样式 +67，
  // 11000 → 11067 显式登记。消化路径同上：按域拆 CSS 时随托盘/待落段外提。
  // CV-444（2026-11-05，UI-06/08/09）:root 六档 z-index 令牌 + toast 去重/队列/断行
  // +15，11067 → 11082 补登（CV-444 提交时 test:smoke 未跑成，本批统一验证补登）。
  // 故事板提速 B1（2026-11-05）：字段级意图卡样式 +39（11082 → 11121）显式登记。
  'src/client/styles.ts': 11125,
  // CV-394（2026-11-02）：+image_matting 工具定义 +34 净行（4401 → 4435）显式登记。
  // 复刻提效批（2026-11-02）：spotFrames 工具参数 + spot 载荷分支 + alpha 标记接线
  // +51（4435 → 4486）显式登记。
  // B3 拆解回核（2026-11-02）：+verify_teardown 工具定义 +86（4486 → 4572）显式登记
  // —— 核心算法在 teardown-verify.ts（新文件），这里只是工具壳。
  // 批四（2026-11-02）：+teardown_store 工具（壳，核心在 teardown-store.ts）+ render_composition
  // 的 timingSegments 双闸接线，+120（4572 → 4692）显式登记。
  // REQ-037（2026-11-03）：+ensureExternalImageNode（upload_image 外链落参考节点，
  // 核心判据就近放 backfill 旁）+ 工具描述扩行，+13（4692 → 4705）显式登记。
  // 科普 0.1 验收 P6（2026-11-04）：ask_user_choice 的 catch 分支加**失败兜底**
  // （非 abort 的内部错误不再外抛成 turn 终止，改回默认项继续），+9（4711 → 4720）显式登记。
  // CV-435（2026-11-04）：image2vl 描述保底通道 + 抽帧文案反转，+8（4720 → 4728）补登。
  // CV-437（2026-11-05）：B-1 list_references 本地图提示（D6）+ video2vl 保底描述，+2（4728 → 4730）补登。
  // CV-439（2026-11-05）：B-3 体检回执消费端接线（lint message/lintPath schema + executor 落盘
  // 调用 + 报告/spot 双渲染点 + 折叠行改指渲染报告），+22（4730 → 4752）显式登记；
  // 核心在 lint-report.ts（新文件，65 行），此处只是接线。
  // CV-440（2026-11-05）：B-4 storyboard pending 事实桥 —— 回执 warnings 点名 pending
  // 事实（判据在 data-provenance.ts 新文件），+6（4752 → 4758）显式登记。
  // 骨架优先出片（2026-11-05）：render_composition 成功后落出片锚点（PROGRESS + 版本快照）
  // + M1 首次成片时刻，+52（4758 → 4810）显式登记；核心在 render-anchor.ts（新文件），
  // 这里只是接线 + 一行可见回执。消化路径：随「渲染工具壳拆分」批外提结算段。
  // P1-3 / P1-4（2026-11-05）：scaffold_manifest 落盘分支（writeTo 参数 + hints 复用，
  // 落盘校验与预览在 manifest-file.ts 新文件）+ render_composition 段边界提示接线，
  // +44（4810 → 4854）显式登记。消化路径：随「scaffold 与 render 工具壳拆分」批
  // 外提到 host-tools-remotion.ts（与既有 host-tools-artifact / -data / -series 同路）。
  // 故事板提速 B1（2026-11-05）：+confirm_intent_card 工具定义 +99（4854 → 4953）显式登记；
  // 消化路径随既有「工具壳拆分」批外提到 host-tools-workflow.ts。
  'src/host-tools.ts': 4958,
  // 订阅与积分（2026-11-02）：G1 余额闸（requireCreditsForGeneration + 注释）+37，
  // 3582 → 3619。闸函数刻意就近放在要求鉴权的 dramaPost 旁，不与鉴权闸拆两个文件。
  'src/generate.ts': 3620,
  // CV-382（2026-10-29）：资产路由流式化 +39 净行（52 增 13 删，≤60 预算内），显式登记；
  // 阶段 2 按域拆分时随 routes 段消化。
  // 订阅与积分（2026-11-02）：/canvas-studio/billing 前缀三分派 +105（含 sendBillingFailure），
  // 3531 → 3636。消化路径同上：按域拆路由时随 billing 段外提。
  // +1（3637）：前缀尾段归一化拆成两次 replace（`/^\/+$/` 会把 `/checkout` 留成原样
  // 导致写操作全部落到 404，是 billing-routes.test.mjs 抓出的真实缺陷），单行拆两行。
  // 复刻提效批（2026-11-02）：/remotion/commit 透传 spot=1，+3（3637 → 3640）。
  // REQ-037（2026-11-03）：storyboardCanvasNodeIds（§07 引用失效对账）+ 接线 +14，
  // 3640 → 3654 显式登记。
  'src/routes.ts': 3654,
  // S3（2026-10-28）：混音面板接线 handleNodeAudioTimelineUpdate（+7 行，显式登记的增长）——
  // 阶段 3 拆分（两步走：先展示外提再抽 hooks）时随 hooks 外提消化。
  // 订阅与积分（2026-11-02）：billing 状态订阅 + focus 信号 + 两处入口 + 全屏页挂载
  // +65，3168 → 3233。消化路径：随既有「显示外提 → 抽 hooks」第二阶段一起外提。
  // REQ-037（2026-11-03）：素材托盘重启用 + 待落画布条 JSX + 查看回调 +28，3233 → 3261
  // 显式登记。消化路径同上。
  // CV-444（2026-11-05）：UI-01 ConfirmHost 末尾唯一出口 + UI-13 加载态/计时器接线
  // +26，3261 → 3287 补登（同上，统一验证批补登）。
  // P1-1（2026-11-05）：里程碑状态行接线 +6（import 2 + 工作条内 JSX 4，
  // 判定与配色全在 MilestoneBar/milestone-clock 新文件里），棘轮 3287 → 3293 显式登记。
  // 消化路径同上：随「显示外提 → 抽 hooks」第二阶段一起外提。
  'src/client/StudioFrame.tsx': 3293,
  // REQ-037（2026-11-03）：divertAttachments 改「暂存 + 占位说明」（附件不再发送时
  // 自动落卡）+ LOBBY_LAND_STASH_EVENT 消费监听 +25，2983 → 3008 显式登记。
  // CV-435（2026-11-04）：读图能力恢复的客户端侧措辞接线 +2，3008 → 3010 补登。
  'src/client/index.ts': 3010,
  'src/client/canvas/NodeInputCard.tsx': 2087,
  // chart 轨（2026-10-31，能力基准 #04 收口）：ChartTrack 接口 + 类型集/字段白名单 +
  // 校验分支 ≈ +74 净行。1928 → 2002 显式登记。
  // caption 轨（同日，#05 收口）：CaptionTrack 接口 + 字段白名单 + 校验分支
  // （words 形状/双重播放告警）+ 音轨构成计入 ≈ +104 净行。2002 → 2106 显式登记。
  // A1 audioViz 分频段（同日，#06 收口）：bandSplit/bandColors 校验 +29。2106 → 2135。
  // A2 chart source:'timeline'（同日）：校验分支重构 + source 互斥/无 video 拒收 +22。
  // 2135 → 2157。
  // CV-392（2026-10-31，REQ-036 R-2）：image 轨 sourceRect 精灵图裁切 —— 接口字段
  // + 注释 +8、sprite.js 导入 +2、校验分支 +3（几何/校验主体在新文件 sprite.ts）。
  // 2157 → 2168 显式登记。
  // 复刻提效批（2026-11-02）：image 轨 hasAlpha 字段 + 注释，+7（2168 → 2175）。
  // REQ-036 C4（2026-11-03）：相对锚定 —— KNOWN 键表 +anchor 三处 + anchor 子键扫描 +
  // collectAnchorIssues 集成（校验主体在 anchor.ts 新文件），+12（2175 → 2187）显式登记。
  // 六大体裁路线阶段 1.1：ManifestGlobal.logo 键 + JSDoc，+2（2187 → 2189）显式登记。
  // 六大体裁路线阶段 4.1：ChartTrack pie/donut/gauge 扩型（variant JSDoc + gaugeMax/palette），+7（2189 → 2196）显式登记。
  'src/remotion/manifest.ts': 2196,
  // 批四（2026-11-02）：Q2 时序闸接线 —— commitRenderJob 内 verifyTeardown 调用 +
  // timingSegments 字段三处（options/job/report）+43，1193 → 1236 显式登记。
  // 回核算法在 teardown-verify.ts / timing-segments.ts，这里只是薄接线。
  // 消化路径：随「渲染工单桥拆分」批外提结算段（commit/cancel 各自成模块）。
  'src/remotion/render-job.ts': 1236,
  // CV-384（2026-10-31）：瓦片内存收口 P0 三件套 +61 净行（手势 rAF 合并器接线 +
  // 拖拽态/裁剪/flush 接线），显式登记；func 棘轮 1295 → 1347 同批登记。消化路径：
  // 手势段随既有「手势/命中/渲染三段」拆分计划外提，此处不新立拆分批。
  // 批 2（同日真机迭代）：手势期 cv-auto 抑制 +22 净行（gesturing 态 + 滚轮去抖回落），
  // 1727 → 1749 / func 1347 → 1368。
  'src/client/canvas/CanvasSurface.tsx': 1752,
  'src/client/project-store.ts': 1612,
  'src/projects.ts': 1575,
  // 转场坏点修复（2026-10-31，能力基准 #09 收口）：clock 的 conic mask 在 web-renderer 被
  // 整字段无视 ⇒ 换 clip-path polygon 扇形（clockFanPolygon +22 净行 + 注释），flipX 的
  // perspective() 不被读取 ⇒ 降级 2D 压扁翻面（净 +3）。1315 → 1340 显式登记。
  // 同日批 2：三近似转场 zoomBlur/linearBlur/crossWarp（+44 净行：override.filter 字段 +
  // 三个求值分支 + 注释），1340 → 1384 显式登记。
  // A1 audioViz 分频段（同日，#06 收口）：bandWaveformBars/Smoothed + smoothedBars
  // 泛型抽取，+52 净行。1384 → 1436 显式登记。
  // CV-393（2026-11-02）：`outline` 镂空字 fx 折算分支（+11 净行：FxStyle.textFill 字段
  // + outline case），1436 → 1447 显式登记。
  'src/remotion/timing.ts': 1447,
  // 订阅与积分（2026-11-02）：三个计费请求封装（快照/checkout/portal）+ 错误信封
  // 增加 Retry-After 解析，1268 → 1339。消化路径：client api 按域拆分时随 billing 段外提。
  // 复刻提效批（2026-11-02）：PendingStudioRenderJob.spotFrames + commit spot 参数，+7（1339 → 1346）。
  'src/client/api.ts': 1346,
}

/**
 * 函数跨度棘轮。键 = `src/...#声明名`，值 = `{ lines, note }`（同名多声明取最大跨度登记）。
 * 实测回填于 2026-10-28（PR-0）。拆分推进时逐段下调；达标（≤600）后删除条目。
 */
export const FUNC_WHITELIST = {
  // 订阅与积分（2026-11-02）：订阅页样式段 +266（10717 → 10983），随文件棘轮同批登记。
  // REQ-037（2026-11-03）：素材托盘四分区 + 待落画布条样式 +67（10983 → 11050）。
  'src/client/styles.ts#STUDIO_STYLES': { lines: 11110, note: '整文件 CSS 模板字面量；CV-444 +15 补登；阶段 6 拆分时本条随之消失' },
  // 订阅与积分（2026-11-02）：billing 前缀三分派 +95（2868 → 2963），随文件棘轮同批登记。
  // REQ-037（2026-11-03）：storyboardCanvasNodeIds + 接线 +2（2967 → 2969）。
  'src/routes.ts#registerStudioRoutes': { lines: 2969, note: '阶段 2 按域拆；CV-382 资产路由流式化 +39（2026-10-29）；订阅积分 +95（2026-11-02）；尾段归一化拆行 +1（2026-11-02）；commit spot 透传 +3（2026-11-02）；REQ-037 +2（2026-11-03）' },
  // S3（2026-10-28）：混音面板接线 handleNodeAudioTimelineUpdate（+7 行，显式登记的增长）——阶段 3 拆分时随 hooks 外提消化。
  // 订阅与积分（2026-11-02）：billing 状态/信号/两处入口/全屏页 +54（2764 → 2818）。
  // REQ-037（2026-11-03）：素材托盘重启用 + 待落画布条 +26（2818 → 2844）。
  'src/client/StudioFrame.tsx#StudioFrame': { lines: 2871, note: '阶段 3 两步走（先展示外提再抽 hooks）；含 S3 混音接线 7 行、订阅积分 54 行、REQ-037 26 行、CV-444 +23 补登；P1-1 里程碑行 +4（2867 → 2871）' },
  // REQ-037（2026-11-03）：divertAttachments 暂存改写 + 落卡事件监听 +26（2719 → 2745）。
  // CV-435（2026-11-04）：读图能力恢复客户端侧 +2（2745 → 2747）补登。
  'src/client/index.ts#studioClient': { lines: 2747, note: '阶段 3 同层两半；REQ-037 附件暂存改写 +26；CV-435 +2' },
  // CV-394：+image_matting（func +47：2436 → 2483）显式登记。
  // 复刻提效批（2026-11-02）：spotFrames 参数 + spot 载荷 + alpha 标记接线（func +29：2483 → 2512）。
  // B3 拆解回核（2026-11-02）：+verify_teardown（func +84：2512 → 2596）。
  'src/host-tools.ts#createStudioTools': { lines: 2875, note: '阶段 1 目录化（先搬 inspect 打样）；批四 +teardown_store +timingSegments 接线 2596 → 2712；骨架优先出片（2026-11-05）render_composition 锚点接线 +17 → 2729；P1-3/P1-4 scaffold 落盘分支 + 段边界提示 +42 → 2771' },
  'src/client/canvas/NodeInputCard.tsx#NodeInputCard': { lines: 1747, note: 'P1：6 类节点表单挤在一个组件' },
  // CV-384（2026-10-31）：手势 rAF 合并器接线 +52（applyPointerMove 应用体化 + 合并器/拖拽态/flush 接线），
  // 与文件棘轮同批显式登记；消化路径同上（三段拆分时外提）。批 2 手势期 cv-auto 抑制 +21（1368）。
  'src/client/canvas/CanvasSurface.tsx#CanvasSurface': { lines: 1371, note: 'P1：手势 / 命中 / 渲染三段（forwardRef 内嵌函数）' },
  'src/client/project-store.ts#createProjectStore': { lines: 990, note: 'P1：按域切 store 切片' },
  // 订阅与积分（2026-11-02）：CS-BILL-001（G1 余额闸）+19（990 → 1009）。表不拆，本条只钉不涨。
  'src/errors/catalog.ts#SPECS': { lines: 1009, note: '错误码表 —— 清单判定「一张表」不拆，本条只钉不涨' },
  // CV-384（2026-10-31）：dragging prop + 2D translate + contain-intrinsic-size +8，显式登记。
  'src/client/canvas/CanvasNode.tsx#CanvasNodeInner': { lines: 827, note: 'P1：节点态 / 预览 / 手势' },
  'src/client/ModelSettingsPanel.tsx#ModelSettingsPanel': { lines: 674, note: 'P1' },
}

const RE_TOP_FUNC = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[\w$]+/
const RE_TOP_CLASS = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[\w$]+/
const RE_TOP_CONST = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+/
const RE_MEMBER = /^  (?:(?:public|private|protected|static|readonly|override|get|set)\s+)*(?:async\s+)?[\w$]+\s*\(/
const HOOKS = new Set(['useEffect', 'useLayoutEffect'])

/** 这些词后跟 `(` 是控制流/表达式，不是声明（防止 `if (` / `return (` / `this.foo(` 被当成成员头）。 */
const NON_DECL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'with',
  'await', 'yield', 'throw', 'new', 'typeof', 'delete', 'void', 'in', 'of', 'case',
  'default', 'function', 'const', 'let', 'var', 'class', 'export', 'import', 'super', 'this',
])

/** 上一个有效词是这些关键字时，`/` 是正则字面量开头而不是除号。 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await',
])

const WORD_RE = /[\w$]/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/**
 * 词法扫描：返回每个声明的真实跨度与失步信息。
 * 状态机：code ⇄（行注释 / 块注释 / 字符串 / 模板 / 正则）；`{` 帧栈承载声明开闭；
 * 行首（仅 code 态）识别声明头 → 挂起 → 行尾块体开始符消耗挂起 → 帧弹出时记跨度。
 * 导出仅供诊断脚本使用（`node --input-type=module -e "import('./tests/file-size-guard.test.mjs')"`）。
 */
export function lexFile(text, trace = null) {
  const lines = text.split('\n')
  const decls = []
  const stack = [] // { kind, opener: {name, kind, line} | null, startLine }
  let pendingOpener = null // { name, kind, line }
  let pendingConst = null // { name, line, bracketBase }
  let pendingMember = null // { name, line }
  let awaitingFuncName = false // 行中 `function` 关键字已见，等名字或 `(`（匿名）——覆盖 forwardRef(fn) 形态
  let bracketDepth = 0
  let lastMeaningful = null // { type: 'word' | 'sig', value } —— 最后一个非空白 token（`/` 正则/除号判定的依据）
  let lastSig = ''
  let lastSig2 = ''
  let word = ''
  let lastWord = ''
  let line = 1
  let checkedLine = 0
  let i = 0

  const flushWord = () => {
    if (word !== '') {
      lastWord = word
      word = ''
      lastMeaningful = { type: 'word', value: lastWord }
    }
  }
  const sig = (c) => {
    lastSig2 = lastSig
    lastSig = c
    lastMeaningful = { type: 'sig', value: c }
  }
  const memberHeadOnLine = (idx) => {
    if (idx < 0 || idx >= lines.length) return null
    const l = lines[idx]
    if (!RE_MEMBER.test(l)) return null
    const m = l.match(/^  (?:(?:public|private|protected|static|readonly|override|get|set)\s+)*(?:async\s+)?([\w$]+)/)
    const name = m ? m[1] : null
    return name && !NON_DECL.has(name) ? name : null
  }
  /** 挂起声明头只在「本行最后一个 `{`（或反引号）」处落块：`{ return 1 }` 单行体、
   *  `): { a: T } {` 返回类型对象、行内模板都能各就各位。 */
  const isLastOpenerOnLine = (idx, col) => {
    const l = lines[idx] ?? ''
    return l.indexOf('{', col + 1) === -1
  }
  const popFrame = () => {
    const frame = stack.pop()
    if (!frame) return 'underflow'
    if (frame.opener && frame.opener.kind !== 'class') {
      decls.push({ name: frame.opener.name, kind: frame.opener.kind, line: frame.opener.line, extent: line - frame.opener.line + 1 })
    }
    return null
  }
  const isRegexPosition = () => {
    if (lastMeaningful === null) return true
    if (lastMeaningful.type === 'word') return REGEX_KEYWORDS.has(lastMeaningful.value)
    const c = lastMeaningful.value
    // `}` 后直接跟正则字面量在真实代码中不存在（JSX 自闭合 `/>` 前面常是 `}`），
    // 按除号处理；`{ ( [ , ; = : ! & | ? % ~ ^ < > + - *` 后才是正则位。
    if (c === ')' || c === ']' || c === '}' || c === "'" || c === '"' || c === '`') return false
    return '([{,;=:!&|?%~^<>+-*'.includes(c)
  }
  const isIncrementRun = () => (lastSig === '+' || lastSig === '-') && lastSig2 === lastSig

  /** 行首（code 态）判定：清理已失效的挂起 + 识别本行的声明头。 */
  const lineEntry = (idx) => {
    if (lastSig === ';' || lastSig === '}' || lastSig === '') {
      pendingOpener = null
      pendingConst = null
      pendingMember = null
    }
    if (stack.length !== 0 || bracketDepth !== 0) return // 顶层声明头只在根作用域识别
    const l = lines[idx] ?? ''
    if (RE_TOP_FUNC.test(l)) {
      const m = l.match(/function\s*\*?\s*([\w$]+)/)
      pendingOpener = { name: m ? m[1] : '?', kind: 'function', line: idx + 1 }
      return
    }
    if (RE_TOP_CLASS.test(l)) {
      const m = l.match(/class\s+([\w$]+)/)
      pendingOpener = { name: m ? m[1] : '?', kind: 'class', line: idx + 1 }
      return
    }
    if (RE_TOP_CONST.test(l)) {
      const m = l.match(/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/)
      pendingConst = { name: m ? m[1] : '?', line: idx + 1, bracketBase: bracketDepth }
      return
    }
    const member = memberHeadOnLine(idx)
    if (member) {
      const top = stack[stack.length - 1]
      const inClassBody = top !== undefined && top.kind === 'class'
      if (inClassBody || (HOOKS.has(member) && top !== undefined && top.kind !== 'class')) {
        pendingMember = { name: member, line: idx + 1 }
      }
    }
  }

  const sealWord = () => {
    if (word === '') return
    if (awaitingFuncName) {
      pendingOpener = { name: word, kind: 'function', line }
      awaitingFuncName = false
    } else if (word === 'function') {
      awaitingFuncName = true
    }
    flushWord()
  }

  while (i < text.length) {
    const c = text[i]
    if (c === '\n') {
      sealWord()
      line += 1
      i += 1
      continue
    }
    const top = stack[stack.length - 1]
    const inTemplate = top !== undefined && top.kind === 'template'
    if (!inTemplate && checkedLine !== line) {
      checkedLine = line
      lineEntry(line - 1)
    }
    if (inTemplate) {
      if (c === '\\') {
        i += 2
      } else if (c === '`') {
        const err = popFrame()
        if (err) return { desync: `第 ${line} 行：栈下溢`, decls }
        i += 1
        sig('`')
      } else if (c === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'block', opener: null, startLine: line })
        trace?.push({ ev: 'push', line, kind: 'block', name: undefined })
        i += 2
        sig('{')
      } else {
        i += 1
      }
      continue
    }
    // ---- code 状态 ----
    if (!WORD_RE.test(c)) sealWord() // 非词字符 = 词边界（注释/字符串/模板/正则体在各自分支内消化）
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') line += 1
        i += 1
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      i += 1
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1
        if (text[i] === '\n') return { desync: `第 ${line} 行：字符串未闭合跨行`, decls }
        i += 1
      }
      i += 1
      sig(c)
      continue
    }
    if (c === '`') {
      const col = i - lineStartOffset(text, i)
      let opener = null
      if (pendingConst && bracketDepth === pendingConst.bracketBase && isLastOpenerOnLine(line - 1, col)) {
        opener = { name: pendingConst.name, kind: 'const', line: pendingConst.line }
        pendingConst = null
      }
      // 模板帧一律 kind 'template'（否则模板体被当代码扫）；opener 随帧带出，弹出时记 const 跨度
      stack.push({ kind: 'template', opener, startLine: opener ? opener.line : line })
      i += 1
      sig('`')
      continue
    }
    if (c === '{') {
      const col = i - lineStartOffset(text, i)
      let opener = null
      if (pendingOpener && isLastOpenerOnLine(line - 1, col)) {
        opener = pendingOpener
        pendingOpener = null
      } else if (pendingConst && bracketDepth === pendingConst.bracketBase && isLastOpenerOnLine(line - 1, col)) {
        opener = { name: pendingConst.name, kind: 'const', line: pendingConst.line }
        pendingConst = null
      } else if (pendingMember && isLastOpenerOnLine(line - 1, col)) {
        opener = { name: pendingMember.name, kind: 'method', line: pendingMember.line }
        pendingMember = null
      }
      stack.push(opener ? { kind: opener.kind, opener, startLine: opener.line } : { kind: 'block', opener: null, startLine: line })
      trace?.push({ ev: 'push', line, kind: opener ? opener.kind : 'block', name: opener?.name })
      i += 1
      sig('{')
      continue
    }
    if (c === '}') {
      const err = popFrame()
      trace?.push({ ev: 'pop', line })
      if (err) return { desync: `第 ${line} 行：栈下溢`, decls }
      i += 1
      sig('}')
      continue
    }
    if (c === '/' && text[i - 1] === '<') {
      i += 1 // JSX 闭合标签 `</tag>`（`<` 紧邻 `/`），不是正则
      sig('/')
      continue
    }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i += 1
      continue
    }
    if (c === '/' && isRegexPosition() && !isIncrementRun()) {
      i += 1
      let inClass = false
      let closed = false
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === '\n') break // 正则不跨行 —— 跨行说明是误判，按除号收场
        if (inClass) {
          if (text[i] === ']') inClass = false
        } else if (text[i] === '[') {
          inClass = true
        } else if (text[i] === '/') {
          closed = true
          break
        }
        i += 1
      }
      if (closed) {
        i += 1 // 越过收尾 `/`
        while (i < text.length && /[a-z]/i.test(text[i])) i += 1 // flags
      }
      // 未闭合（跨行误判）时 i 停在 `\n` 上，交给主循环计行 —— 不得吞掉换行
      sig('/')
      continue
    }
    if (c === '(' || c === '[') {
      if (awaitingFuncName) {
        pendingOpener = { name: '(anon)', kind: 'function', line }
        awaitingFuncName = false
      }
      bracketDepth += 1
      i += 1
      sig(c)
      continue
    }
    if (c === ')') {
      awaitingFuncName = false
      bracketDepth = Math.max(0, bracketDepth - 1)
      i += 1
      sig(c)
      continue
    }
    if (c === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      i += 1
      sig(c)
      continue
    }
    if (c === ';') {
      pendingOpener = null
      pendingConst = null
      pendingMember = null
      awaitingFuncName = false
      i += 1
      sig(';')
      continue
    }
    if (WORD_RE.test(c)) {
      word += c
    } else if (c === ' ' || c === '\t' || c === '\r') {
      // 空白只封词，不动 lastMeaningful —— 否则 `re: /^For` 的 `/` 会因前面是空格而被误判成除号
    } else {
      sig(c)
    }
    i += 1
  }
  sealWord()
  if (stack.length !== 0) {
    const frames = stack
      .map((f) => (f.opener ? `${f.opener.kind} ${f.opener.name}@L${f.opener.line}` : `${f.kind}@L${f.startLine}`))
      .join(' ← ')
    return { desync: `EOF 时栈未清空（深 ${stack.length}）：${frames}`, decls }
  }
  if (pendingOpener || pendingMember) {
    const p = pendingOpener ?? pendingMember
    return { desync: `EOF 时声明头未落块：${p.name}（第 ${p.line} 行）`, decls }
  }
  return { desync: null, decls }
}

function lineStartOffset(text, i) {
  let s = text.lastIndexOf('\n', i - 1)
  return s + 1
}

export function scanSource() {
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
  const files = walk(join(pkgRoot, 'src'))
    .map((abs) => ({ abs, path: relative(pkgRoot, abs).replaceAll('\\', '/') }))
    .filter((f) => ![...GENERATED_DIRS].some((d) => f.path === d || f.path.startsWith(d + '/')))
    .sort((a, b) => (a.path < b.path ? -1 : 1))

  const fileLines = []
  const spanMax = new Map()
  const desyncs = []
  for (const { abs, path } of files) {
    const text = readFileSync(abs, 'utf8')
    const raw = text.split('\n')
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop() // 与 wc -l 同口径
    fileLines.push({ path, lines: raw.length })
    const { desync, decls } = lexFile(text)
    if (desync) desyncs.push(`${path}: ${desync}`)
    for (const d of decls) {
      const key = `${path}#${d.name}`
      const prev = spanMax.get(key)
      if (prev === undefined || d.extent > prev.lines) {
        spanMax.set(key, { path, name: d.name, kind: d.kind, start: d.line, lines: d.extent })
      }
    }
  }
  return {
    fileLines,
    spans: [...spanMax.values()].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name)),
    desyncs,
  }
}

function collectRatchetFindings(entries, measured, limit) {
  const over = []
  const stale = []
  const seen = new Set(Object.keys(entries))
  for (const m of measured) {
    const key = `${m.path}#${m.name}`
    const registered = entries[key]
    if (registered === undefined) {
      if (m.lines > limit) over.push(`${key}: 实测 ${m.lines} > ${limit}（未登记白名单）`)
      continue
    }
    seen.delete(key)
    const reg = typeof registered === 'number' ? registered : registered.lines
    if (m.lines > reg) over.push(`${key}: 实测 ${m.lines} > 棘轮登记 ${reg} —— 只准减不准增`)
    else if (m.lines <= limit) stale.push(`${key}: 实测 ${m.lines} 已达标（≤${limit}），请从白名单删除条目`)
  }
  for (const key of seen) stale.push(`${key}: 白名单条目没有对应的实测声明（声明被删/改名），请清理`)
  return { over, stale }
}

function assertClean(findings, limit) {
  const { over, stale } = findings
  const message = [
    ...(over.length ? [`超过闸线（${limit}）或棘轮：`, ...over.map((s) => `  - ${s}`)] : []),
    ...(stale.length ? ['白名单待清理（达标即删，防僵尸豁免）：', ...stale.map((s) => `  - ${s}`)] : []),
  ].join('\n')
  assert.equal(over.length, 0, over.length ? message : undefined)
  assert.equal(stale.length, 0, stale.length ? message : undefined)
}

test('词法扫描器对所有源文件不失步（fail-closed）', () => {
  const { desyncs } = scanSource()
  assert.equal(
    desyncs.length,
    0,
    desyncs.length
      ? ['词法扫描器失步 —— 请先修扫描器（或确认该文件触发了新语法形态），不要用白名单掩盖：', ...desyncs.map((s) => `  - ${s}`)].join('\n')
      : undefined,
  )
})

test('单文件行数 ≤ 1,200（白名单棘轮，只准减不准增）', () => {
  const { fileLines } = scanSource()
  const over = []
  const stale = []
  for (const f of fileLines) {
    const registered = FILE_WHITELIST[f.path]
    if (registered === undefined) {
      if (f.lines > FILE_LIMIT) over.push(`${f.path}: 实测 ${f.lines} > ${FILE_LIMIT}（未登记白名单）`)
      continue
    }
    if (f.lines > registered) over.push(`${f.path}: 实测 ${f.lines} > 棘轮登记 ${registered} —— 只准减不准增`)
    else if (f.lines <= FILE_LIMIT) stale.push(`${f.path}: 实测 ${f.lines} 已达标（≤${FILE_LIMIT}），请从白名单删除条目`)
  }
  for (const key of Object.keys(FILE_WHITELIST)) {
    if (!fileLines.some((f) => f.path === key)) stale.push(`${key}: 白名单条目指向不存在的文件，请清理`)
  }
  assertClean({ over, stale }, FILE_LIMIT)
})

test('单函数跨度 ≤ 600（白名单棘轮，只准减不准增）', () => {
  const { spans } = scanSource()
  assertClean(collectRatchetFindings(FUNC_WHITELIST, spans, FUNC_LIMIT), FUNC_LIMIT)
})
