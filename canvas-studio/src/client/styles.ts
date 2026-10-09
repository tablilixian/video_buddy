/**
 * Studio frame styles, injected as one style element tagged with the plugin
 * id (the client-modules owner tagging pattern). Product copy lives in the
 * components; this file only carries presentation.
 */
import { NODE_HEAD_HEIGHT, NODE_FOOT_HEIGHT } from '../canvas-aspect.js'
import { CHROME_CARD_WIDTH } from '../canvas-aspect.js'

const STUDIO_STYLES = `
/* Presentation follows the official design system: structural / interaction
 * colors come from the --dsw-alias-* semantic tokens owned by
 * @deepseek-ai/dsh-client-ui-theme (imported into the web shell base.css).
 * Those tokens resolve to light or dark values via body[data-ds-dark-theme],
 * so this panel adapts to the app theme automatically.
 *
 * DD-01/DD-02 起是**两层令牌**：宿主语义令牌（文字 / 交互态 / 滚动条）之上，
 * 叠插件自有品牌命名空间 --cs-*（定义在 src/brand.ts，随 body 继承），
 * 承载宿主不表达的概念 —— 制作现场的空间三档（壳 / 画布 / 节点 / 浮层）。
 * 命名空间仍是「语义」而非「色值」：换预设或换明暗主题时令牌自己变，本文件
 * 不出现任何十六进制或 rgb() 字面量。Never hardcode colors or use currentColor. */

.csFrame {
  display: grid;
  /* C9（Q4 拍板：不做断点，改最小窗 + 窄窗降级）：三栏全部弹性化 ——
     宿主允许把窗口拖到 schema 下限（minWidth 可低至 640，默认 900），写死
     280px/480px 会让画布只剩 140px 碎掉。现在窗口收窄时按 minmax 下限收缩：
     200 + 320 + 320 = 840px 是可用下限，再窄由 min-width 兜底横向滚动。
     宽窗口下行为与旧版完全一致（280 / 1fr / 480）。 */
  grid-template-columns: minmax(200px, 280px) minmax(320px, 1fr) minmax(320px, 480px);
  /* C9：比三栏下限之和更窄时允许横向滚动 —— 布局不碎、内容不被裁掉。 */
  min-width: 840px;
  overflow-x: auto;
  height: 100%;
  /* DD-02：壳层 —— 整机最外层底色，与画布拉开一档。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  /* CV-064：lobby ↔ work 切换时列宽平滑过渡。lobby 态保持 3 列（第三列压到
     0px），列数一致才能插值；列数变化会退化成瞬跳。 */
  transition: grid-template-columns var(--cs-duration-slow, 300ms) var(--cs-ease, ease);
}

@media (prefers-reduced-motion: reduce) {
  .csFrame { transition: none; }
}

/* DD-09 / b：右栏（对话区）收起态 —— 第三列压成 56px 轨道，与左栏 R8 完全对称。
 *
 * 位置刻意放在 lobby 三条规则**之前**：.csFrame[data-chat="strip"] 与
 * .csFrame[data-mode="lobby"] 特异度相同（都是 0,2,0），平手时靠源码顺序取胜。
 * 放在前面，lobby 的「第三列 0px」才会赢 —— lobby 态聊天已经挪到中栏，右栏本来
 * 就是 0px，再收一次没有意义（0 比 56 更小，让 lobby 的写法胜出就是正确答案）。
 *
 * min-width 同步下移：三栏下限之和 200 + 320 + 56 = 576px。若留在 840px，
 * 收起右栏反而多出一截横向滚动条（R8 踩过同一个坑）。 */
.csFrame[data-chat="strip"] {
  grid-template-columns: minmax(200px, 280px) minmax(320px, 1fr) 56px;
  min-width: 576px;
}

/* 收起态的对话区：**不卸载、也不用 display:none 藏**。
 *
 * 它是一个滚动容器，而 display:none 会让浏览器把 scrollTop 归零 —— 用户收起右栏
 * 再展开，对话会跳回顶部，而收起本来就是可逆动作。这里改成「脱离文档流 + 保留自身
 * 尺寸 + 隐藏」：宽度写死 480px（右栏上限，任何实际宽度都不超过它，故内部布局一字
 * 不变）、高度撑满，滚动位置完整保留；绝对定位让它不再参与 56px 列的宽度计算
 * （包含块是 .csChat，故 .csChat 必须 position: relative），visibility 让它不可见。
 * 宿主 conversation 组件全程保持挂载 —— 草稿、会话绑定、事件订阅都不受影响。 */
.csFrame[data-chat="strip"] .csConversation {
  position: absolute;
  top: 0;
  left: 0;
  width: 480px;
  height: 100%;
  visibility: hidden;
  pointer-events: none;
}

/* CV-064 lobby 态（无项目）：对话从右栏挪到中栏居中。
 *
 * 实现要点：对话槽（.csChat）**不搬家、不卸载** —— JSX 条件渲染换容器会让
 * 上游 conversation 组件重建，草稿 / 滚动 / 会话绑定全丢。这里只重排 grid：
 * 第三列压 0px，中栏切成「品牌条（auto）/ 聊天（1fr）」两行。
 *
 * 浮层类子元素（.csContextMenu / .csToasts / .csOverlay / 各 Modal）都是
 * position: fixed，不参与 grid 排布，不受 two-row 影响。
 *
 * 例外是 .csDetailDrawer：它改成挂在中栏 .csCanvasBody 内做绝对定位（底边贴
 * 时间轴顶边、宽度随画布），因此**受** two-row 影响 —— 这正是想要的：中栏变矮，
 * 抽屉跟着变矮，它从不越到右栏那一列上去。 */
.csFrame[data-mode="lobby"],
.csFrame[data-mode="lobby-pending"] {
  grid-template-columns: 280px minmax(0, 1fr) 0px;
  /* 第三行（auto）：CV-065 推荐技能横滚，落在聊天卡片下方。 */
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.csFrame[data-mode="lobby"] .csProjects,
.csFrame[data-mode="lobby-pending"] .csProjects { grid-area: 1 / 1 / 4 / 2; }
.csFrame[data-mode="lobby"] .csCanvas,
.csFrame[data-mode="lobby-pending"] .csCanvas { grid-area: 1 / 2 / 2 / 3; }
/* CV-065：lobby 中栏第三行 —— 推荐技能横滚（work 态不渲染，行塌为 0）。 */
.csFrame[data-mode="lobby"] .csLobbyTail,
.csFrame[data-mode="lobby-pending"] .csLobbyTail { grid-area: 3 / 2 / 4 / 3; }
/* 聊天卡片：居中、限宽限高，**读作「还没开拍的画布本体」**。
 *
 * DD-10：此前它是一块扁平白盒 + 1px 描边 + 几乎看不见的阴影。而同一屏里的
 * .csLobbyHero（lobby 态同位置品牌条）**早已**用了画布语言（L1 底色 + 双层
 * 点阵 + accent 光晕，C7/DD-06 做的）—— 一屏两套语言，这才是「跟正式画布不像
 * 一家人」的根因。这里把同一套配方搬过来：卡片读成「画布已经就位、只是还没
 * 开拍」，宿主渲染的 hero 与输入框浮在它上面。位置语义从「一个悬空的表单框」
 * 变成「制作台上摊开的那张画布」。
 *
 * 参数与 .csLobbyHero / .csCanvasSurface 同源（120 主格 / 24 细格，光晕在
 * background-image 第一层）。底色用 --cs-canvas-bg-l1（比最深的画布底色亮一档）
 * 而不是 --cs-canvas-bg —— 画布本体要保持最深，卡片是「画布的内容面」。 */
.csFrame[data-mode="lobby"] .csChat,
.csFrame[data-mode="lobby-pending"] .csChat {
  grid-area: 2 / 2 / 3 / 3;
  justify-self: center;
  align-self: center;
  width: min(880px, calc(100% - 48px));
  /* 高度账（渲染台实测抓到过一版错的）：行高 H，卡片自身高 h，上下各留 12px。
     写成 height: min(560px, 100%) 配 margin: 0 0 12px 时，margin 盒 = H + 12
     > H，align-self: center 只好把它整体上移 6px —— 卡片于是**盖住上一行
     6px**。此前第一行是空的（lobby-pending 不渲染任何东西），看不出来；DD-10
     在第一行放上开拍前条之后，这条底边框就被卡片压掉了中间那一段。
     正解是让 margin 盒**恰好等于行高**：上 12 + 下 12 都从行高里扣，居中就没有
     余数，位置也不再依赖容器的实际高度。 */
  height: min(560px, calc(100% - 24px));
  margin: 12px 0;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 12px);
  background-color: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base));
  background-image:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 100% 100%, 120px 120px, 24px 24px;
  background-position: 0 0, 0 0, 0 0;
  background-repeat: no-repeat, repeat, repeat;
  box-shadow: var(--cs-shadow-2, none);
}

/* ==================== REQ-005 v1.3（变体 A）：lobby 态布局回退 ====================
 *
 * v1.2 曾把中栏换成「品牌条 + 自研 LobbyComposer」，并隐藏整个 .csChat；v1.3
 * 产品拍板回到宿主对话卡（图2 为基底，规格行走 LobbySpecRow 挂宿主槽），这两条
 * 覆盖**整体撤销**：.csCanvas 回到第 1 行（品牌条），.csChat 回到第 2 行居中
 * （上面那组 CV-064/DD-10 规则），对话卡与草稿/会话绑定全程无隐藏。
 *
 * 保留不动：lobby / lobby-pending 态工具栏与工作流条让位（下一组规则）—— 两种
 * 首页形态都没有画布可操作。 */

/* ==================== REQ-005 v1.3 + CV-259：隐藏宿主 hero 态的两个下拉 ====================
 *
 * 「示例项目 ▾」（WorkspaceChip，EmptyHero.tsx）与「标准模式 ▾」（AgentPresetSeat
 * 的 anchor button）都与左栏项目列表 / 我们的「执行模式」语义重复，产品拍板只藏
 * 不改上游。两者都是 CSS Modules 哈希类名（选不中），但共享稳定的行为属性：
 * button + aria-haspopup="menu"，且 heroWorkspaceRow 只在 hero 态渲染
 * （ConversationRoot.tsx:163）。宿主根节点的 data-phase（hero/active/settling）
 * 是稳定钩子 —— 用它收作用域，work 态的命令菜单（aria-haspopup="listbox"，不同
 * 值）与设置页都不受影响。
 *
 * ⚠️ CV-259 修正（原「真机确认项③」已应验）：hero 态卡片内确实有**第三枚**
 * button[aria-haspopup="menu"] —— 宿主输入栏尾部的模型座椅 conversation.input.model
 * （InputBar.tsx:794 的 renderSlot；ModelSelect.tsx:226 的 trigger），它同样命中
 * 上面那条通用隐藏，表现就是「首页/hero 态没有模型选择」。这枚是产品要保留的控件，
 * 故按**槽锚点白名单**放回：[data-slot="…"] 是 ui-renderer 在每个槽渲染点挂的
 * 稳定锚（scoped-slots.tsx:676 SlotOutlet，style=display:contents），与哈希类名
 * 无关，也不受上游改名影响。
 *
 * display 显式写成上游 .trigger 的值（ModelSelect.module.css:10 display:flex）：
 * 被 !important 隐藏后只能靠同等 !important + 更高特异度还原（本条 (0,4,1) >
 * 通用条 (0,3,1)）；revert / unset 都会退回 UA 的 inline-block，chip 的 gap 与
 * 垂直居中会散。若上游改了 .trigger 的 display，改这一行的值即可。
 *
 * ⚠️ REQ-028（2026-10-06）反转模型座椅白名单：交互演示把首页输入卡的工具行定义
 * 为「规格 chips（左）+ 执行模式 + 开始创作（右）」，没有 LLM 模型座椅 —— CV-259
 * 的白名单与新拍板冲突，按后拍板执行：hero 态整个座椅槽隐藏（按槽锚，非通配），
 * **work 态不受影响**（座椅照常可用，模型选择能力没有少，少的只是首页这张脸）。
 * 白名单规则随之删除（留着 = 两条 !important 互相打架的假规则）；CV-259 的守卫
 * 改写为「反转守卫」（见 tests/visual-tokens.test.mjs 同名段）。回退 = 恢复
 * 白名单规则并删掉下面三条 hide。 */
.csChat [data-phase="hero"] button[aria-haspopup="menu"] {
  display: none !important;
}

/* REQ-028 验收截图反馈（2026-10-06）：hero 态藏宿主工具行的三枚通用控件。
 * 演示的工具行只有「规格 chips（左）+ 模式 + 开始创作（右）」，宿主自带的
 * 命令菜单 / 权限选择 / LLM 座椅不在其列，且挤得工具行折成两行（截图实证）。
 * 三枚各自有稳定锚，收在 hero 相位内 —— work 态一律不动：
 * ① 「+」命令菜单：卡内唯一的 button[aria-haspopup="listbox"]（ContextMeter 的
 *    触发器是 "dialog"、模型座椅是 "menu"、我们的 chip 不写 haspopup）；
 * ② 权限选择（Workspace Write）：Menu 触发器无 haspopup，锚 = aria-label 模板
 *    前缀（locales.ts 'input.accessMode' = 「访问模式，当前：{name}」/ 英文取逗号前段
 *    "Access mode"—— host-boundary 红线①的选择器解析按 ASCII 逗号分段，值里带逗号会把
 *    选择器切成无 .cs 前缀的碎片而被拦，
 *    与发送钮锚同一套双语核验手法）；
 * ③ LLM 模型座椅：整槽隐藏（槽锚 [data-slot]，见上方反转说明）。 */
.csChat [data-phase="hero"] [data-composer-card] button[aria-haspopup="listbox"] {
  display: none !important;
}

.csChat [data-phase="hero"] [data-composer-card] button[aria-label^="访问模式，当前"] {
  display: none !important;
}

.csChat [data-phase="hero"] [data-composer-card] button[aria-label^="Access mode"] {
  display: none !important;
}

.csChat [data-phase="hero"] [data-slot="conversation.input.model"] {
  display: none !important;
}

/* ==================== CV-262：对话卡右缘的「幽灵滚动条」（第二轮收尾） ====================
 *
 * 宿主 .scrollBody（ConversationRoot.module.css:230-249）无条件写
 *   overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable;
 * 且 hero 态再补一条（同文件 :361-364）：
 *   .root[data-phase='hero'] .scrollBody { justify-content: center; overflow-y: auto; }
 * 于是右缘那条竖线有**两条来路**，只看其一必然漏：
 *   ① scrollbar-gutter: stable —— 语义是「即便当前不需要滚动也预留油槽」，
 *      空态（没有任何可滚内容）白留一条 ~9–17px 的带；
 *   ② **真溢出** —— hero 态的内容 = 宿主品牌壳 + 本插件挂在 input.dock 的两行
 *      （规格条 + 暂存条）+ 输入卡，窗口一矮就真的超出盒高，画出来的是**真滚动条**
 *      （有滑块、能拖），不是预留的油槽。
 * 上一版只改了 ① 的 scrollbar-gutter，真机截图证明线还在 —— 因为那条
 * 是 ②。这次两条路一起收。
 *
 * 覆盖点用 data-conversation-scroll（ConversationRoot.tsx:189 挂在 .scrollBody 上的
 * 稳定钩子）。**只收 hero / settling 两态的滚动条 chrome，不动 overflow，也不动
 * active 态**：
 *   · hero / settling = 「还没开始对话」的居中舞台，没有任何 transcript 需要读，
 *     油槽与滑块的唯一可见效果就是右缘那条没意义的竖线；收掉 chrome 后滚轮/键盘
 *     仍可滚动（overflow-y 保留），只是不再占位、不再画条。
 *   · active（真对话）一律不碰：宿主刻意用「stable」预留油槽，好让「滚动条出现 /
 *     消失」时输入卡不左右跳（其 decision 注记
 *     2026-08-04-composer-tab-gutter-reservation.md）—— 那层保护不能拿掉。
 *
 * 两条写法都写：scrollbar-width 是标准属性（新版 Chromium / Firefox），
 * ::-webkit-scrollbar 兜住只认伪元素的旧 WebKit；scrollbar-gutter: auto 兜住只认
 * gutter 不认 scrollbar-width 的引擎。特异度 (0,3,0)，与宿主「.root[data-phase='hero']
 * .scrollBody」同级但**声明的是它没声明的属性**，不冲突。
 * （不写 -ms-overflow-style：Electron 只跑 Chromium，那条是 IE 遗留，留着还会让
 * 「本规则不得出现 overflow 字样」的守卫误报。） */
.csChat [data-phase='hero'] [data-conversation-scroll],
.csChat [data-phase='settling'] [data-conversation-scroll] {
  scrollbar-gutter: auto;
  scrollbar-width: none;
}

.csChat [data-phase='hero'] [data-conversation-scroll]::-webkit-scrollbar,
.csChat [data-phase='settling'] [data-conversation-scroll]::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/* lobby / lobby-pending 态没有画布可操作：工具栏与工作流条整体让位给品牌条
   + 聊天。保持挂载（不条件渲染）以保证 work 态 DOM/交互零变化。 */
.csFrame[data-mode="lobby"] .csToolbar,
.csFrame[data-mode="lobby"] .csWorkflowBar,
.csFrame[data-mode="lobby-pending"] .csToolbar,
.csFrame[data-mode="lobby-pending"] .csWorkflowBar {
  display: none;
}

/* DD-08 / R8：左栏收起态 —— 整栏压成一条 56px 的缩略条（项目色块方阵）。
 *
 * 只覆盖 grid-template-columns，不重写 .csFrame 本体：收起是一个**可逆状态**，
 * 把 280px 再写一遍到分支里，两处迟早对不上（改了一处忘另一处，表现为收起后
 * 画布悄悄宽了 4px）。第一列由轨道宽度决定，其余两列按本体同款 minmax 跟随。
 *
 * 位置刻意放在 lobby 三条规则**之后**：.csFrame[data-rail="strip"] 与
 * .csFrame[data-mode="lobby"] 特异度相同（都是 0,2,0），平手时靠源码顺序取胜。
 * 而条+首屏的组合（0,3,0）无论如何都赢，故两种组合都成立。
 *
 * min-width 同步下移：三栏下限之和在收起时是 56 + 320 + 320 = 696px，
 * 若仍留在 840px，收起左栏反而多出一截横向滚动条。 */
.csFrame[data-rail="strip"] {
  grid-template-columns: 56px minmax(320px, 1fr) minmax(320px, 480px);
  min-width: 696px;
}

/* 两栏同时收起：56 + 320 + 56 = 432px 下限。
 *
 * 位置放在下面那条「左栏收起 + lobby」**之前** —— 两者特异度同为 0,3,0，
 * 平手靠源码顺序决出，而 lobby 必须赢（第三列回到 0px 而不是 56px），
 * 否则 lobby 态同时收起两栏会把中栏聊天挤进右边一条 56px 的缝里。
 * 这一条是组合里唯一需要显式写出的：另外三种组合（只收左 / 只收右 / 都不收）
 * 各由单栏规则与本体覆盖，不需要四象限展开。 */
.csFrame[data-rail="strip"][data-chat="strip"] {
  grid-template-columns: 56px minmax(320px, 1fr) 56px;
  min-width: 432px;
}

.csFrame[data-rail="strip"][data-mode="lobby"],
.csFrame[data-rail="strip"][data-mode="lobby-pending"] {
  grid-template-columns: 56px minmax(0, 1fr) 0px;
}

/* P7 创作工作流条：模式开关 + 审批提示，位于工具栏与画布之间。 */
.csWorkflowBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工作流条属于「壳层」的第二档 —— 比工具栏略亮，与画布区分。 */
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csWorkflowMode {
  display: inline-flex;
  /* 顺带修的既有缺陷（不属 DD-02 设计范围，DD-05 仍会整体重做该条）：
     .csWorkflowApproval 带 margin-left:auto，中栏变窄时会把可收缩的模式组一起挤扁，
     按钮文字折成两行（实测中栏 920px 时按钮高 40px = 两行，1100px 起恢复 23px 单行）。
     模式组是固定文案的小控件，不该参与收缩。 */
  flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  overflow: hidden;
}

.csWorkflowMode button {
  padding: 3px 10px;
  font-size: 12px;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csWorkflowMode button + button {
  border-left: 1px solid var(--dsw-alias-border-l2);
}

.csWorkflowMode button.csActive {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

/* CV-052 防御层：当前已激活的模式按钮禁用（路由层已短路，这里是第二道）。 */
.csWorkflowMode button:disabled {
  cursor: default;
}

.csWorkflowMode button.csActive:disabled {
  color: var(--dsw-alias-label-primary);
}

.csWorkflowState {
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}

/* DD-05：五阶段行进指示（需求 → 剧本 → 分镜 → 关键帧 → 制作）。
   只有「行进」语义、不可点击 —— 六阶段轨道可跳转需要阶段模型，工程暂无
   （visual-direction-plan 还原度判定）。方块节点读成一格一格的胶片孔。 */
/* C1 / DD-05：六段制作轨道。每段是**可点的 button**（有产物才可点，判定见
   src/workflow-stage.ts 的 idsByStage）——「能点但没有动作」的假按钮比不可点更糟，
   所以无产物的未来段走 :disabled，不做 hover 反馈。
   连接线与圆点承载「行进」语义：已完成段 = 青（落定），当前段 = accent + 脉冲。 */
.csWorkflowStages {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

/* N4（对齐清单 §8.3）：产出计数（设计稿 wfTime）。等宽数字 —— 数字每生成一个
   就跳一格，比例数字会让整段文本随计数左右抖。 */
.csWorkflowTime {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.csStageLink {
  width: 16px;
  height: 1px;
  flex: 0 0 auto;
  background: var(--cs-line, var(--dsw-alias-border-l2));
}

.csStageLink.csStageLinkDone {
  background: color-mix(in srgb, var(--cs-teal, #35C2A6) 50%, transparent);
}

.csWorkflowStage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: var(--cs-radius-pill, 999px);
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    background var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csWorkflowStage:hover:not(:disabled) {
  color: var(--dsw-alias-label-secondary);
  border-color: var(--cs-line, var(--dsw-alias-border-l2));
}

.csWorkflowStage:disabled {
  cursor: default;
  opacity: 0.55;
}

.csWorkflowStage i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
  flex: 0 0 auto;
}

.csWorkflowStage.csStageDone {
  color: var(--dsw-alias-label-secondary);
}

.csWorkflowStage.csStageDone i {
  background: var(--cs-teal, #35C2A6);
}

.csWorkflowStage.csStageNow {
  color: var(--dsw-alias-label-primary);
  background: var(--cs-accent-soft, transparent);
  border-color: color-mix(in srgb, var(--cs-accent, #6c5ce7) 45%, transparent);
}

.csWorkflowStage.csStageNow i {
  background: var(--cs-accent, #6c5ce7);
  animation: csAdvancePulse 1.6s var(--cs-ease, ease) infinite;
}

/* 行进语义（动效三语义契约之一）：当前段圆点向外扩散的脉冲环。 */
@keyframes csAdvancePulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, transparent); }
  50% { box-shadow: 0 0 0 5px transparent; }
}

/* DD-05：审批条 = 场记板形态 —— 金色拍板条压左缘、顶缘斜纹待打板，
   体块用壳二档托住；gold = HITL 审批的固定功能色（不随预设切换）。 */
.csWorkflowApproval {
  display: flex;
  /* C9：窄窗下审批元素（图标 / 文案 / 驳回输入 / 双按钮）换行而不是把
     六段轨道挤没 —— 工作流条是横向最脆弱的一行。 */
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  position: relative;
  padding: 5px 10px 5px 12px;
  border-radius: 6px;
  border-left: 3px solid var(--cs-gold, #e8b45a);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 7%, var(--cs-shell-2, var(--dsw-alias-bg-layer-1)));
  /* C5：入场 rise（让位语义 —— 审批请求到达，工作流条把注意力让给它）。
     设计稿 .approval 的原节奏：slow + ease，从上方 6px 沉进来。 */
  animation: csYieldRise var(--cs-duration-slow, 320ms) var(--cs-ease, ease);
}

/* C5：场记板图标 —— 打板动作的载体（设计稿 .clap，26px 金色小方块）。
   条到达后补一记合板，把「该你拍板了」做成看得见的动作，而不是又一行字。 */
.csWorkflowClap {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 14%, transparent);
  color: var(--cs-gold, #e8b45a);
  /* rise 落地一小拍之后合板（420ms 是设计稿 .clap.isHit 的原节奏） */
  animation: csDevelopClapHit 420ms var(--cs-ease, ease) var(--cs-duration-fast, 120ms) both;
}

@media (prefers-reduced-motion: reduce) {
  .csWorkflowApproval,
  .csWorkflowClap {
    animation: none;
  }
}

/* C5：显影语义 —— 打板合板。22% 处张到 -13°、48% 回弹 4°，是场记板「咔」的手感。 */
@keyframes csDevelopClapHit {
  0% { transform: rotate(0); }
  22% { transform: rotate(-13deg); }
  48% { transform: rotate(4deg); }
  100% { transform: rotate(0); }
}

/* C5：让位语义 —— 审批条入场。 */
@keyframes csYieldRise {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

/* 场记板顶缘的打板斜纹：3px 高、gold/透明交替，纯装饰。 */
.csWorkflowApproval::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 6px 6px 0 0;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--cs-gold, #e8b45a) 85%, black) 0 5px,
    transparent 5px 10px
  );
  pointer-events: none;
}

/* DD-05：审批消息走 gold 调（向 label 混 25% 保明暗双轨可读）。 */
.csWorkflowApproval .csWorkflowMessage {
  font-size: 12px;
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 75%, var(--dsw-alias-label-primary));
}

.csWorkflowApproval button {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

/* DD-05：批准主按钮 = 打板动作，gold 实底 + 深色字（明暗双轨都成立）。 */
.csWorkflowApproval button.csPrimary {
  background: var(--cs-gold, #e8b45a);
  border-color: var(--cs-gold, #e8b45a);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, black);
}

.csWorkflowApproval button.csPrimary:hover {
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 88%, white);
}

/* R1（G1）：驳回意见输入框——可选填写不满意点，随驳回消息转述给 agent。 */
.csWorkflowApproval input.csRejectInput {
  width: 260px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.csWorkflowApproval input.csRejectInput::placeholder {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

/* P7 点选式澄清卡片：ask_user_choice 弹出的选择题。 */
.csQuestionCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csQuestionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-062：问题头部徽标与操作提示，让点选卡片在对话流里可辨识。 */
.csQuestionIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-3);
  font-size: 11px;
  font-style: normal;
}

.csQuestionHint {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}

/* CV-216 放手跑降级窄条：Host 本回合没提问，只留一行可追溯记录，全不可交互。
   整条弱化（opacity）是为了和上方的「待你作答」卡片一眼区分——用户实测时分不清
   的是「这张卡到底要不要我点」。 */
.csQuestionAuto {
  gap: 4px;
  opacity: 0.8;
}

.csQuestionAutoNote {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.csQuestionOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csQuestionOptions button {
  padding: 6px 16px;
  min-height: 28px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.csQuestionOptions button:hover:not(:disabled) {
  transform: translateY(-1px);
}

/* hover 配色只作用于未选中项——否则会盖掉选中态的反色配色（深底深字不可读）。 */
.csQuestionOptions button:hover:not(:disabled):not(.csSelected) {
  background: var(--dsw-alias-bg-layer-3);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csQuestionOptions button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* CV-062：选中态——实心填充 + ✓ 前缀，一眼可辨。 */
.csQuestionOptions button.csSelected {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}

.csQuestionOptions button.csSelected::before {
  content: "✓ ";
}

/* CV-062：确认按钮（两段式交互的提交步），主按钮样式。 */
.csQuestionConfirm {
  align-self: flex-start;
  padding: 6px 18px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}

.csQuestionConfirm:hover:not(:disabled) {
  transform: translateY(-1px);
}

.csQuestionConfirm:disabled {
  opacity: 0.4;
  cursor: default;
}

/* S3：风格澄清 GIF 预览卡片（ask_user_choice 选项命中风格预设时）。 */
.csStyleDemoGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.csStyleDemoCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  text-align: left;
}

.csStyleDemoCard:hover:not(:disabled):not(.csSelected) {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-2);
}

.csStyleDemoCard:disabled {
  opacity: 0.5;
  cursor: default;
}

.csStyleDemoCard.csSelected {
  border-color: var(--dsw-alias-label-primary);
}

.csStyleDemoCard.csSelected .csStyleDemoName::before {
  content: "✓ ";
  font-weight: 600;
}

.csStyleDemoImg {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
}

/* CV-116：风格已注册但无 GIF 素材时的占位，尺寸与预览图一致以免布局跳动 */
.csStyleDemoFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

.csStyleDemoName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csStyleDemoBadge {
  font-style: normal;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

.csQuestionOther {
  opacity: 0.75;
}

.csQuestionFree {
  display: flex;
  gap: 6px;
}

.csQuestionFree input {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csQuestionFree button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjects {
  display: flex;
  flex-direction: column;
      /* CV-070：拆出 .csProjectsScroll 让「品牌条 / 段头+列表 / 用户卡」三段分别
         自管 padding；侧栏自身不再 overflow，列表仅在列表区滚动，用户卡固定底部。 */
      /* DD-02：左栏属壳层，与中栏画布拉开明度。 */
      background: var(--cs-shell, var(--dsw-alias-bg-base));
      border-right: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  color: var(--dsw-alias-label-primary);
  min-height: 0;
  overflow: hidden;
}

/* DD-08 / R8：收起态的缩略条容器。三段竖列 —— 品牌标（点开）→ 项目色块方阵
   （独立滚动）→ 用户头像（点开）。56px 轨道宽 = 40px 色块 + 两侧各 8px 呼吸。 */
.csRailStrip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--cs-space-2, 8px) 0;
}

.csRailStripBrand,
.csRailStripUser {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csRailStripBrand:hover,
.csRailStripUser:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

.csRailStripList {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csRailStripEmpty {
  padding: var(--cs-space-2, 8px) 0;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  writing-mode: vertical-rl;
  text-align: center;
}

/* 单个项目色块：封面方阵的单元。点击 = 展开左栏 + 打开该项目（一步到位，
   否则「收起状态下点项目」要先展开再点一次，等于把收起态变成单向门）。 */
.csRailChip {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csRailChip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l3));
}

/* 当前选中项目：accent 描边 + 光晕（两步走 —— 只改描边在浅色下几乎读不出）。 */
.csRailChipActive {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow: var(--cs-glow-accent, none);
}

.csRailChipFace {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: var(--cs-fs-sm, 12px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-070：列表区独立滚动容器 —— 段头「项目 + 刷新」与项目行共享同一滚动条，
   不会带飞用户卡。min-height:0 是 flex item 在固定高度父下允许收缩的硬条件。 */
.csProjectsScroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-2, 8px);
  padding: var(--cs-space-2, 8px) var(--cs-space-3, 12px) var(--cs-space-3, 12px);
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csProjectsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cs-space-2, 8px);
  /* REQ-030：段头随 ProjectList 渲染（「＋」要开列表内部的分组名表单）。
     顶部 4px 呼吸沿旧段头保留，确保「＋」不贴滚动容器上缘。 */
  padding: var(--cs-space-1, 4px) 0 2px;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}

/* DD-08 / R1：段头去掉了 text-transform: uppercase 与 letter-spacing —— 文案是
   中文「项目」，两条声明对中文都是空转（只把英文项目名大写了，反而不统一）。 */

/* DD-08 / R8：段头标题必须点名。此前用「直接子 span」兜住唯一那个 span，加了右侧
   动作容器（同样是 span）之后两个都会被拉成 flex:1，刷新按钮会跑到中间去。 */
.csProjectsHeaderTitle {
  flex: 1 1 auto;
}

.csProjectsHeaderActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
}

.csProjectsHeader button {
  font: inherit;
  font-size: var(--cs-fs-sm, 12px);
  display: grid;
  place-items: center;
  padding: 3px 9px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

/* DD-08 / R8：左栏收起的入口**不放这里**。段头（「项目 + ＋」）随列表滚动，
   而收起是一个必须常驻的整栏控制 —— 它属于栏头（品牌条）。见 .csBrandCollapse。 */

.csProjectsHeader button:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

.csProjectsHeader button:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectsEmpty {
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--cs-fs-md, 13px);
  padding: var(--cs-space-5, 24px) var(--cs-space-2, 8px);
  text-align: center;
}

.csProjectList {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  /* CV-070：列表现处于 .csProjectsScroll 滚动容器内，必须按自然高度排布
     （flex:0 0 auto）。若保留 flex:1 1 auto + min-height:0，列表会被压到
     滚动容器高度后再溢出，滚动高度依赖浏览器对 flex item 溢出的计算，
     Chrome/Safari 行为不一致，末尾几行可能滚不到。 */
  flex: 0 0 auto;
}

/* -- CV-069 / CV-070：左栏底部用户卡（固定底部，与上方列表区用顶 border 分隔） -- */
.csUser {
  /* 不再用 margin-top:auto 推底——列表区已独立滚动，卡片始终固定底部，自身
     不参与 flex grow。 */
  flex: 0 0 auto;
  padding: var(--cs-space-2, 8px) var(--cs-space-3, 12px);
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-08 / R1：底色回到壳层令牌 —— 此前写宿主 bg-base，与左栏壳色是同一支的
     两条写法，换主题时两者可能不同步（用户卡会比左栏亮一档）。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
}
/* 单个用户条按钮（点开面板；设置入口在面板内部 .csUserSettings）。 */
.csUserBar {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  width: 100%;
  padding: 6px var(--cs-space-2, 8px);
  border: 1px solid transparent;
  border-radius: var(--cs-radius-lg, 12px);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}
.csUserBar:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}
.csUserAvatar {
  border-radius: 50%;
  flex-shrink: 0;
}
/* DD-08 / R6：名称 + 副行两段竖列。此前用户条只有一行名字（还是 12/600，比项目名
   更响），是栏内最空最抢眼的一块。副行取 USER_MOCK 里**真实存在**的字段（账号
   身份），不编造进度类信息 —— reserved 项仍按 CV-069 的诚实边界留在面板内部。 */
.csUserBarMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}
.csUserBarName {
  font-size: var(--cs-fs-md, 13px);
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csUserBarSub {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* CV-069 修复：position:fixed 逃出 .csProjects 的 overflow 裁剪（坐标由组件
   实测内联注入）；background 用真实存在的 --dsw-alias-bg-base（bg-l1 缩写
   令牌在主题包中不存在，此前面板背景透明）。 */
.csUserPanel {
  position: fixed;
  z-index: 90;
  width: 260px;
  max-height: min(480px, 72vh);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
}
.csUserHead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 10px;
}
.csUserHeadMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.csUserName {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csUserUid {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csUserRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 6px;
}
.csUserRowLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
.csUserValue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csUserBadge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.csUserChevron {
  color: var(--dsw-alias-label-tertiary);
}
.csUserGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csUserGroupLabel {
  padding: 0 6px 4px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: 0.05em;
}
.csUserEntry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.csUserEntry:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserEntry:disabled {
  cursor: default;
}
.csUserSettings {
  margin-top: 6px;
  padding-top: 9px;
  padding-bottom: 9px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0 0 8px 8px;
}
.csUserThemeRow {
  display: flex;
  gap: 6px;
  padding: 2px 6px 6px;
}
.csUserThemeBtn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csUserThemeBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserThemeActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}

/* CV-088：Lobby 个性化问候（LobbyHero 品牌条内）。 */
.csLobbyGreet {
  margin: 0;
  font-size: var(--cs-fs-lg, 14px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* ===== REQ-030：左栏重排（拍板 ①A ②A ③A ④C，2026-10-08） =====
 *
 * 「＋ 创作」主按钮 + 菜单三项（灵感/技能/资产）+ Credits 占位卡。
 * 原「+ 新建项目 / + 新建分组」动作区随重排退役：新建项目入口唯一 =
 * 本按钮跳首页创作台（D4），新建分组入口上移段头「＋」（见 ProjectList.tsx）。
 */

/* 「＋ 创作」主按钮：材料走「壳上一档 chip 实底 + 描边」（与演示稿一致）——
   主按钮的「主」体现在位置与份量，不在强调色；accent 渐变留给 Credits 升级钮。 */
.csRailCreate {
  font: inherit;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--cs-space-2, 8px);
  margin: var(--cs-space-3, 12px) var(--cs-space-3, 12px) var(--cs-space-1, 4px);
  height: 38px;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-md, 10px);
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csRailCreate:hover:not(:disabled) {
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l3));
}

.csRailCreate:disabled {
  opacity: 0.5;
  cursor: default;
}

.csRailCreate svg {
  color: var(--cs-accent-soft, var(--cs-accent));
}

/* 菜单三项（灵感 / 技能 / 资产）。②A 拍板：灵感 = 置灰占位「即将上线」，
   不可点（div + aria-disabled）；技能 / 资产是既有浮层的纯增量入口。 */
.csRailMenu {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--cs-space-1, 4px) var(--cs-space-3, 12px) var(--cs-space-2, 8px);
}

.csRailMenuItem {
  font: inherit;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--cs-radius-md, 9px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: var(--cs-fs-md, 13px);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csRailMenuItem:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csRailMenuItem svg {
  color: var(--cs-accent-soft, var(--cs-accent));
  flex: 0 0 auto;
}

/* ②A：灵感占位态 —— 降透明度、禁 hover 反馈（挂 aria-disabled 的元素）。 */
.csRailMenuItemOff,
.csRailMenuItem[aria-disabled='true'] {
  opacity: 0.38;
  cursor: default;
}

/* Credits 占位卡（口径③已拍 2026-10-07：纯展示，无商业化数据源）。
   余额静态「0 / 1,000」、升级套餐置灰「即将上线」。 */
.csCredits {
  flex: 0 0 auto;
  margin: 0 var(--cs-space-3, 12px);
  padding: 11px 12px;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csCreditsRow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}

.csCreditsRow svg {
  color: var(--cs-accent-soft, var(--cs-accent));
  flex: 0 0 auto;
}

.csCreditsVal {
  margin-left: auto;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

/* 升级套餐：accent 渐变实底（与 hero 发送钮同一配方，文字色走对比令牌 ——
   不写白色字面量）。长期 disabled（商业化后端未接入），打八五折示弱化。 */
.csCreditsUpgrade {
  font: inherit;
  display: grid;
  place-items: center;
  width: 100%;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: var(--cs-radius-md, 9px);
  background: linear-gradient(180deg, var(--cs-accent-strong), var(--cs-accent));
  color: var(--cs-accent-contrast, var(--dsw-alias-label-primary));
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  cursor: default;
  opacity: 0.85;
}

/* 图标按钮：REQ-030 重排后唯一消费者是 dev 自测入口「跑效果测试」（默认不渲染）
   —— 产品动作已全部离开列表顶部（新建=「＋创作」跳首页，建组=段头「＋」）。 */
.csProjectNewIcon {
  font: inherit;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 32px;
  padding: var(--cs-space-2, 8px) 0;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csProjectNewIcon:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l3));
  color: var(--dsw-alias-label-primary);
}

.csProjectNewIcon:disabled {
  opacity: 0.5;
  cursor: default;
}

/* dev 版动作按钮（「跑效果测试」；默认不渲染，见 ProjectList.tsx 的 DEV_TOGGLE_KEY）。
   借用图标按钮的克制外观（透明底 + 细描边），但按文字撑开 —— 打开开关后它也不该
   抢主按钮的实底：它是自测入口，不是第二个产品动作。 */
.csProjectNewWide {
  flex: 1 1 auto;
  width: auto;
  gap: var(--cs-space-1, 4px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.csProjectForm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

/* 一键效果测试：用例勾选行 + 运行进度块（复用侧栏字色与间距节奏）。
   DD-08 / R5：这块的**渲染由 dev 开关控制**（默认不出现在栏面），样式保留 ——
   打开开关后它仍是一块完整可用的面板。 */
.csEffectTestCases {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cs-space-1, 4px) var(--cs-space-3, 12px);
}

.csEffectTestCase {
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  cursor: pointer;
}

.csEffectTestProgress {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px var(--cs-space-2, 8px);
  margin: 2px 0;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-sm, 6px);
  font-size: var(--cs-fs-sm, 12px);
  opacity: 0.9;
}

.csEffectTestTitle {
  font-weight: 600;
}

/* DD-08 / R1：失败色从裸十六进制 #e05252 换成宿主错误色 —— 裸值不随主题切换
   （中红压在近白底上对比不足），且它是全栏唯一一处写死颜色。 */
.csEffectTestFailure {
  color: var(--dsw-alias-state-error-primary);
  word-break: break-all;
}

.csEffectTestSummary {
  opacity: 0.75;
  word-break: break-all;
}


.csProjectNameInput {
  font: inherit;
  font-size: var(--cs-fs-sm, 12px);
  padding: 6px var(--cs-space-2, 8px);
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* 输入面用宿主已有的「弹层」档：它表达的正是「比壳浮起一层」的意图。 */
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

.csProjectFormActions {
  display: flex;
  gap: var(--cs-space-1, 4px);
}

.csProjectFormActions button {
  font: inherit;
  font-size: var(--cs-fs-sm, 12px);
  flex: 1;
  padding: var(--cs-space-1, 4px) var(--cs-space-3, 12px);
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csProjectFormActions button:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csProjectFormActions button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* DD-08 / R3：项目「行」→ 项目「卡」—— 封面（首字色块）+ 名称 + 副行三段横排。
   副行三样信息全部来自**已在 wire 上**的字段（workflow.state / plan / updatedAt），
   零契约改动、零迁移，见 src/project-row.ts。 */
.csProjectItem {
  font: inherit;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: var(--cs-space-2, 8px);
  border-radius: var(--cs-radius-md, 8px);
  /* CV-070：选中态用左侧 accent 边线取代整圈边框，配上轻微底色，活动状态更易扫视。 */
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

/* DD-08 / R1：hover / 选中底色从宿主的交互态令牌换成**壳层第二档**。左栏是壳层，
   行的问题不是「有没有反馈」，而是「反馈与壳色同一档、看不出边界」；换到
   shell-2 之后行才真的浮起来。选中再叠 accent-soft，与 hover 明确区分 ——
   此前 hover 用 interactive-hover、选中用 interactive-active，两档在很多主题包里
   只差百分之几明度，扫视时读不出哪一行是当前项目。 */
.csProjectItem:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

/* 选中态去掉了整圈 border-color（原 CV-070 写法）：卡片有了封面与底色之后，
   整圈描边与封面描边同色同重，读成「两个框」而不是「一行高亮」；左侧 accent
   边线加 accent-soft 底已经足够定位。 */
.csProjectItemActive {
  border-left-color: var(--cs-accent, #6c5ce7);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-active));
}

.csProjectItem:focus-visible {
  outline: 2px solid var(--cs-accent, #6c5ce7);
  outline-offset: -2px;
}

/* DD-08 / R3：封面。34px 略高于「13px 名称行 + 11px 副行」的行盒，封面因此是
   卡片里最高的元素 —— 文字换行或字号微调时卡片高度不跳，列表节奏不断。
   六档底色见下方 .csCoverTone*。 */
.csProjectCover {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  user-select: none;
}

/* DD-08 / R3：六档封面底色。色值全部定义在 brand.ts 的 COVER_TOKENS，从品牌色
   现场混出 —— 明暗两轨、四套预设自动跟随，本文件不出现任何色值字面量。
   消费点在此（棘轮守卫要求 brand.ts 的每个令牌都有 styles.ts 引用）。 */
.csCoverTone1 { background: var(--cs-cover-1); }
.csCoverTone2 { background: var(--cs-cover-2); }
.csCoverTone3 { background: var(--cs-cover-3); }
.csCoverTone4 { background: var(--cs-cover-4); }
.csCoverTone5 { background: var(--cs-cover-5); }
.csCoverTone6 { background: var(--cs-cover-6); }

.csProjectMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.csProjectName {
  font-size: var(--cs-fs-md, 13px);
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 副行 = 阶段 · 规格 · 相对时间。分隔号是**独立元素**而不是写进文本节点：
   任何一段都可能为空（未锁定规格 / 时间戳非法），写进文本会留下悬空的「·」。 */
.csProjectSub {
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.3;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  white-space: nowrap;
}

.csProjectSubSep {
  flex: 0 0 auto;
  opacity: 0.6;
}

/* 阶段词是副行里唯一「有状态」的一段，比规格与时间实一档 —— 这是副行的信息层级，
   三段同重的话等于把三个数字平铺，扫视时抓不到「做到哪了」。 */
.csProjectStage {
  flex: 0 0 auto;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.csProjectSubText {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* DD-08 / R2：kebab 入口（取代常驻 × 与行内原生 select）。
   原生 <select> 是整栏最丑的一处 —— 暗色壳上渲染成亮底浮块，且选中行常驻可见。
   现在所有行内动作（移动到分组 / 删除）都进同一个菜单，菜单语言复用已有的
   .csContextMenu / .csMenuAction 家族，不造第三套菜单。 */
.csProjectMenuBtn {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--cs-fs-md, 13px);
  line-height: 1;
  cursor: pointer;
  /* CV-070：默认隐藏 × 的同一惯例 —— hover/focus 当前行才显出，减少视觉噪音。 */
  opacity: 0;
  transition: opacity var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csProjectItem:hover .csProjectMenuBtn,
.csProjectItem:focus-within .csProjectMenuBtn,
.csProjectMenuBtn:focus-visible,
.csProjectItemActive .csProjectMenuBtn {
  /* 选中行始终可见 —— 用户已经盯着这一行，需要确切的入口 */
  opacity: 1;
}

.csProjectMenuBtn:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

.csProjectMenuBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* -- CV-091：用户自定义分组 + 折叠（沿用 DSW 主题变量，深色/浅色自适应） -- */

/* REQ-030 ①A：未分组平铺区与分组区之间的分隔线（有分组时才渲染）。 */
.csProjectFlatDivider {
  flex: 0 0 auto;
  height: 1px;
  margin: var(--cs-space-2, 8px) 0;
  background: var(--cs-line, var(--dsw-alias-border-l2));
}

.csProjectGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--cs-space-2, 8px);
}

/* DD-08 / R4：折叠箭头从「▸ / ▾」两个字形换成 SVG 三角 —— 文字符的基线与粗细
   随字体变，而且没法做旋转过渡（换字形是瞬跳）。 */
.csProjectGroupHeader {
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-1, 4px) 2px;
}

.csProjectGroupToggle {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

/* 旋转由 aria-expanded 驱动（而不是两个字形互相替换）：收起时箭头转过去，
   读成「同一件事的两态」而不是「换了张图」。 */
.csProjectGroupToggle svg {
  transition: transform var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csProjectGroupToggle[aria-expanded="false"] svg {
  transform: rotate(-90deg);
}

.csProjectGroupToggle:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

/* DD-08 / R1 层级反转：分组名此前是 13/600/label-primary，而它下面的项目名是
   13/500 —— **容器比内容更响**，截图里「未分组」比下面的项目名抢眼就是这么来的。
   现在降到 11/600/label-secondary，项目名成为侧栏唯一的主级文字。 */
.csProjectGroupName {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 可重命名分组的名字（有 title）才显示手型，提示双击改名。 */
.csProjectGroupName[title] {
  cursor: pointer;
}

.csProjectGroupNameInput {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--cs-accent, #6c5ce7);
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
}

/* DD-08 / R4：计数独立成列、右对齐。此前写在名字里（「名称 (8)」），名字一长
   计数先被省略号吃掉，而且 (8) 与名字同字号同色，读起来像名字的一部分。
   tabular-nums 让 8 / 12 / 100 的数字宽度一致，多组并排时右缘不会参差。 */
.csProjectGroupCount {
  flex: 0 0 auto;
  min-width: 14px;
  text-align: right;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.csProjectGroupActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.csProjectGroupAdd,
.csProjectGroupDelete {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--cs-fs-lg, 14px);
  line-height: 1;
  cursor: pointer;
  transition: opacity var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csProjectGroupAdd:hover:not(:disabled),
.csProjectGroupDelete:hover:not(:disabled) {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

/* 删组按钮：默认隐藏，hover/focus 分组头才显出（与项目行 kebab 同惯例）。 */
.csProjectGroupDelete {
  opacity: 0;
}

.csProjectGroupHeader:hover .csProjectGroupDelete,
.csProjectGroupHeader:focus-within .csProjectGroupDelete,
.csProjectGroupDelete:focus-visible {
  opacity: 1;
}

.csProjectGroupDelete:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--cs-line, var(--dsw-alias-border-l2));
}

.csProjectGroupDelete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csProjectGroupEmpty {
  padding: var(--cs-space-1, 4px) var(--cs-space-3, 12px) var(--cs-space-1, 4px) 26px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* DD-08 / R1：本批删除的两条死规则 —— .csProjectSettings（旧的侧栏设置入口）与
   .csProjectFormInline（分组内联表单的旧缩进），全仓均无消费者（含预览脚本）。
   按棘轮纪律删除而不是留着：死规则的真实代价是下一次改这块时有人照着抄一遍。
   同时删除的还有 .csProjectMove 家族（原生 select 的 5 条规则）、.csProjectDelete
   家族与 .csProjectDate —— 它们的职责已由 .csProjectMenuBtn / .csProjectSub 接管。 */

/* DD-08 / R2：行内动作容器 —— 从「原生 select + 常驻 ×」两个控件收成单个 kebab。 */
.csProjectRowActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
}

.csProjectError {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-md, 13px);
  color: var(--dsw-alias-state-error-primary);
}

.csProjectError button {
  font: inherit;
  font-size: var(--cs-fs-sm, 12px);
  align-self: flex-start;
  padding: var(--cs-space-1, 4px) var(--cs-space-3, 12px);
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csCanvas {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  /* DD-02：中栏是「制作现场」——整机最暗一档，让节点与浮层浮起来。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}

/* Middle region between the top toolbar and the bottom timeline: the pannable
 * surface plus the floating layer-list overlay share this positioned box. */
.csCanvasBody {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Infinite canvas surface: grid background pans/zooms with the layer. */
.csCanvasSurface {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  /* CV-174：画布是手势空间，不是文本流。整面禁掉原生文字/图片选区 ——
     否则拖动节点时浏览器会把「路过」的其它节点文字/图片框选高亮（网页框选
     观感），且空白按下本身 preventDefault，浏览器自带的「按下清选区」永远
     不触发，残留高亮只能靠 JS 主动清。输入类控件例外（重命名输入框、正文
     编辑 textarea 必须能选字），见下方覆盖规则。 */
  user-select: none;
  /* DD-02：中栏最暗档，节点与浮层因此「浮」起来。 */
  background-color: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
  /* DD-02 网格：由「两条 1px 直角线」改为**点阵**，并叠出主次两层 ——
     细格 24px 走 --cs-canvas-grid，主格 120px（5 格一跳）走
     --cs-canvas-grid-major。点阵比直角线更弱化网格本身的存在感：直角线在
     大画布上会读成「表格」，点阵则读成「制图台」，节点成为画面主角。
     同时退休 CV-035 的 color-mix 降透明 workaround —— 原实现让网格线与节点
     描边同源（border-l2），只能靠降到 45% 不透明度绕过同色冲突，等于同一件
     事有两套逻辑；现在网格有自己的令牌，绕路直接消失。 */
  background-image:
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 120px 120px, 24px 24px;
  background-position: 0 0, 0 0;
  background-repeat: repeat;
}

.csCanvasSurface:active {
  cursor: grabbing;
}

/* CV-174：输入类控件豁免禁选 —— 重命名输入框、正文编辑 textarea、
   contenteditable 内必须能正常选字/选区。 */
.csCanvasSurface input,
.csCanvasSurface textarea,
.csCanvasSurface [contenteditable='true'] {
  user-select: text;
}

.csCanvasLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  will-change: transform;
}

.csEdges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.csEdge {
  fill: none;
  stroke: var(--dsw-alias-interactive-bg-active);
  stroke-width: 2;
  opacity: 0.8;
}

.csNode {
  position: absolute;
  /* CR-081：位移走 transform（CanvasNode 用 translate3d 定位），提升为合成层，
     拖拽/微调不触发布局重绘。 */
  will-change: transform;
  /* C10：节点是**三段竖列** —— 头（类型 + 标题）/ 体（画面或正文）/ 脚（读数）。
     改前是「一块内容 + 若干绝对定位角标」：height: 100% 的内容区各自为政，
     角标只能浮在画面之上，压画面、压彼此、被圆角裁掉。改成 flex 列之后，
     头脚各占固定高度、体区吃剩余空间，**重叠在结构上不可能发生**，
     也不需要谁来记「哪个角标归哪个角」。 */
  display: flex;
  flex-direction: column;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：节点是空间三档里**最亮**的一档 —— 高于壳层与画布，形成「浮在
     制图台上」的层次。这是本轮的核心改动：改前 .csFrame / .csCanvas /
     .csCanvasSurface / .csNode 四层全部 background: var(--dsw-alias-bg-base)，
     整界面只靠 1px border-l2 切分，节点读起来像「画在纸上的框」而不是
     「摆在台上的卡」。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  overflow: hidden;
  cursor: grab;
  /* N1（对齐清单 §8.3）：入场显影（显影语义，设计稿 .nd.isNew 的 scale .94→1）。
     只动 transform、**不动 opacity** —— 动画期间 opacity 声明会整体覆盖上面的
     DD-03 乘法链，灰显 / 失效节点入场时会先亮一下再跳回灰，是一次刺眼的闪烁。
     消费时机 = 元素挂载（新卡落画布、切阶段显现），动画只播一次不循环。 */
  animation: csDevelopIn var(--cs-duration-base, 200ms) var(--cs-ease, ease) both;
  box-shadow: var(--cs-shadow-1, 0 1px 4px rgb(0 0 0 / 12%));
  /* DD-03：不透明度**只有一条算式**。三个来源各写各的乘数：
     数据层 --cs-node-opacity（inline，来自 node.opacity）
     状态层 --cs-node-state（locked 0.75 / retired 0.45）
     血缘层 --cs-node-dim（聚光生效时为 --cs-dim）
     为什么要改：改前数据层是把 opacity 直接写在 inline style 上的，inline
     永远赢，于是 .csNodeLocked / .csNodeRetired 的 opacity 一直是**死代码**
     —— CV-108 号称「失效版本灰显」，实际只有 grayscale(1) 生效，透明度从未
     降到 0.45。改成变量链后三层按乘法叠加，语义与代码终于一致。 */
  opacity: calc(var(--cs-node-opacity, 1) * var(--cs-node-state, 1) * var(--cs-node-dim, 1));
  transition:
    background-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    border-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    opacity var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}

/* N1：显影语义 —— 节点入场。260ms 是设计稿 .nd.isNew 的原节奏，取 base 档 200ms
   走令牌（差 60ms 在体感阈以下，不值得为它开第四个时长档）。
   N1 修复（2026-09-13 真机验收）：必须用**独立 scale 属性**而不是 transform ——
   节点定位就是 inline transform: translate3d(x,y,0)，而 CSS 动画（含 fill both
   的 to 帧）在 cascade 中优先级高于 inline style，写「to 帧把 transform 归零」
   会把定位永久锁死：所有节点锁在画布原点、拖不动，血缘边却按数据坐标画 →
   箭头全部指向虚空。独立 scale 与 transform 是两个属性（最终变换按
   translate → rotate → scale → transform 组合），scale:1 是恒等项，fill 保持
   也不影响定位。 */
@keyframes csDevelopIn {
  from { scale: 0.94; }
  to { scale: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .csNode {
    animation: none;
  }
}

/* DD-03：悬停 = 节点抬高一档（面 + 描边一起亮），是「这张卡是活的」的最短反馈。
   改前 .csNode 没有任何 hover 规则，鼠标扫过整屏卡片毫无回应。

   ⚠️ 2026-09-13 真机验收（CV-169）：hover **只抬面，不碰描边**。
   :hover 是 (0,2,0)，而选中态 .csNodeSelected 是 (0,1,0) —— 从前这条规则
   一起写 border-color 时，特异度更高的 hover 会打赢选中态：**选中一张卡，
   鼠标刚移上去，紫色选中边框就掉成灰线**（实测 border 由 rgb(91,75,214) →
   rgba(15,17,23,.16)）。用户看到的就是「选中状态自己会变」。
   描边在这里让位给状态层：悬停反馈靠 background 已经足够。 */
.csNode:hover {
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
}

.csNode:hover:not(.csNodeSelected) {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

/* 按下：只改光标 + 给**未选中**的节点补一颗投影（「拿起来了」）。
   ⚠️ CV-169：同上，box-shadow 也不许在选中态下被覆盖 —— :active 是
   (0,2,0)，会打赢 .csNodeSelected (0,1,0) 的选中光晕。改前按住一个已选中的
   节点（Ctrl 加选、拖缩放把手等没有 csNodePrimary 的路径）光晕会被换成
   --cs-shadow-2「普通黑投影」= **看起来根本没选中**（实测）。用户按下准备
   拖动，选中态就先消失一次，松手才回来 —— 这就是「按下/拖动时状态乱了」。 */
.csNode:active {
  cursor: grabbing;
}

.csNode:active:not(.csNodeSelected) {
  box-shadow: var(--cs-shadow-2, 0 4px 12px rgb(0 0 0 / 45%));
}

/* DD-03：成片节点（kind=video + toolName=compose）—— 用青（--cs-teal，品牌里
   「播放 / 预览」的功能色）描出一道细边，把「已经拼好的成品」和「待用的素材」
   分开。描边很淡：成片只是一个身份标记，不该比选中态还跳。 */
.csNodeFilm {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 38%, var(--cs-line, transparent));
}

/* CV-169：成片描边的 hover 同样让位给选中态（同 .csNode:hover 的理由与
   特异度账：:hover 是 (0,2,0)，选中态是 (0,1,0)）。 */
.csNodeFilm:hover:not(.csNodeSelected) {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 60%, var(--cs-line, transparent));
}

/* ==================================================================
   CV-197：节点类型的**色彩身份**（唯一判据 = labels.ts 的 kindAccentOf）

   三色：图 = accent（品牌主色）/ 视频 = teal（播放类功能色）/ 音频 = gold。
   非媒体节点（文本 / 便签 / 提示 / 分组）**不挂这个类** —— 「有彩边 = 有画面」
   要是一条能被信的扫读规则，给没有画面的卡也染色只会把它污染掉。

   ⚠️ 色值只在这里定义一次（--cs-kind / --cs-kind-soft），五处表面各自只
   消费这两个变量。谁都不许再写一遍 HEX —— 本仓已经吃过一次「硬编码 #6c5ce7
   在四个品牌预设下都在悄悄用错色」的教训（见上面 DD-03 的注释）。

   ⚠️ 为什么不给卡片画左缘 3px 条：.csNode 的描边宽度参与几何账（选中环、
   缩放把手贴边），改宽度会让卡片内容整体位移 2px。卡片走**染色描边**（沿用
   .csNodeFilm 的既有做法，零几何影响）；列表类表面（图层行 / 时间轴 chip /
   参考托盘项）本来就是行，左缘条用 inset 内阴影画，同样不动盒模型。
   ================================================================== */
.csKindImage {
  --cs-kind: var(--cs-accent);
  --cs-kind-soft: var(--cs-accent-soft);
}
.csKindVideo {
  --cs-kind: var(--cs-teal);
  --cs-kind-soft: color-mix(in srgb, var(--cs-teal) 16%, transparent);
}
.csKindAudio {
  --cs-kind: var(--cs-gold);
  --cs-kind-soft: color-mix(in srgb, var(--cs-gold) 16%, transparent);
}

/* —— ① 画布卡片：1px 染色描边（不改宽度 = 不动几何）——
   :not(.csNodeFilm) 是让成片保住 DD-03 自己的 38% 青边，不被这里降成 32%：
   成片与普通视频同色是有意的（青 = 视频系），但成片该略重一点。 */
.csNode.csKindImage:not(.csNodeFilm),
.csNode.csKindVideo:not(.csNodeFilm),
.csNode.csKindAudio:not(.csNodeFilm) {
  border-color: color-mix(in srgb, var(--cs-kind) 32%, var(--cs-line, transparent));
}

/* hover 必须跟着本类走：.csNode:hover:not(.csNodeSelected) 是 (0,2,0)，与上面
   同特异度、靠源码顺序分胜负 —— 不显式补这一条，媒体卡悬停时描边会掉回灰线
   （选中态不受影响：它走 box-shadow，不抢 border-color）。 */
.csNode.csKindImage:not(.csNodeFilm):hover:not(.csNodeSelected),
.csNode.csKindVideo:not(.csNodeFilm):hover:not(.csNodeSelected),
.csNode.csKindAudio:not(.csNodeFilm):hover:not(.csNodeSelected) {
  border-color: color-mix(in srgb, var(--cs-kind) 56%, var(--cs-line, transparent));
}

/* —— ② 类型牌（卡片头 / 图层缩略块 / 详情抽屉头）——
   色身份从挂了 .csKind* 的那个祖先继承；**规则本身也要求祖先带类**，所以
   不带身份类的节点（非媒体）与既有验收台骨架的观感逐像素不变 —— 这条很重要：
   台子里的骨架都不带类，一变色就是「未预期回归」。 */
.csKindImage.csNode .csNodeHeadKind,
.csKindVideo.csNode .csNodeHeadKind,
.csKindAudio.csNode .csNodeHeadKind,
.csKindImage.csLayerRow .csLayerThumbKind,
.csKindVideo.csLayerRow .csLayerThumbKind,
.csKindAudio.csLayerRow .csLayerThumbKind {
  background: var(--cs-kind-soft);
  color: var(--cs-kind);
}

/* 详情抽屉头那枚牌面原本是**裸文字**（11px 三级色、无牌面）。既然要它承载
   类型色，就顺手给它一个真正的牌面 —— 同样只在挂了身份类时生效。 */
.csKindImage.csDetailDrawer .csDetailDrawerKind,
.csKindVideo.csDetailDrawer .csDetailDrawerKind,
.csKindAudio.csDetailDrawer .csDetailDrawerKind {
  padding: 1px 7px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-kind-soft);
  color: var(--cs-kind);
  font-weight: 500;
}

/* —— ③ 列表类表面：左缘 3px 色条 ——
   走 inset 内阴影不占盒模型：行高、缩略块宽度、chip 圆角都不动。 */
.csLayerRow.csKindImage,
.csLayerRow.csKindVideo,
.csLayerRow.csKindAudio,
.csTlRefChip.csKindImage,
.csTlRefChip.csKindVideo,
.csTlRefChip.csKindAudio,
.csReferenceItem.csKindImage,
.csReferenceItem.csKindVideo,
.csReferenceItem.csKindAudio {
  box-shadow: inset 3px 0 0 var(--cs-kind);
}

/* 视频的类型牌里那颗常驻 ▶：与「悬停自动播放」（CV-082）互为表里 —— 静止时
   也认得出这是视频，而不是等鼠标扫过去才知道。 */
.csNodeHeadKindMark {
  margin-right: 4px;
  font-size: 9px;
  line-height: 1;
}

/* CV-089：选中态用实色 accent 描边 + 外光晕，去掉「半透明蓝蒙层」观感。
   旧实现用 --dsw-alias-interactive-bg-active（带透明度的浅蓝），在大节点上
   视觉上像「蒙了一层蓝」；改用 --cs-accent 实色双层 box-shadow（外描边 +
   外光晕），节点内容不被覆盖、视觉上明显是「被选中」而非「被蒙层」。
   --cs-accent-soft 在深色主题下 = accentSoft（同色稍降饱和），浅色主题
   下 = accentSoftLight，保证光晕在两种主题里都可见。 */
/* CV-089：主被拖动节点 —— z-index 抬到最上层，避免拖动时被其他选中节点的
   box-shadow 外光晕遮住；同时用更明显的描边宽度区分它与一般选中成员。
   （多选拖拽时所有选中节点都会拿到 csNodeSelected，但只有"用户按下的
   那个"再拿到 csNodePrimary；这样视觉上「主」与「随从」一眼可分。） */
/* DD-03：主节点 = 2px 实色环 + 同一枚光晕令牌（不再手抄一遍 box-shadow）。
   改前这里有 4 处硬编码 var(--cs-accent, #6c5ce7) 兜底 —— #6c5ce7 是旧
   预设的紫，四个品牌预设下都在悄悄用错色。现在全部走令牌。 */
.csNodePrimary.csNodeSelected {
  z-index: 3;
  box-shadow:
    0 0 0 2px var(--cs-accent, #6c5ce7),
    var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* CV-183：托盘豁免「拖动置顶」。
   上面那条 z-index: 3 是给**被拖动的普通卡**用的：置顶它，免得被别的选中卡
   的外光晕压住。但托盘是**容器** —— 成员是画布层的兄弟节点，必须画在托盘
   之上（常态下靠 compareNodes 把托盘排在 zIndex 最低一位实现）。
   一旦按住托盘，primary 把它抬到 3，而托盘本体是**不透明**卡（--cs-node），
   于是整张成员图当场被盖住 —— 用户看到的正是「拖托盘时上面的图片消失，
   松手又回来」。
   豁免只写 z-index 一项：描边仍旧走 primary 的 2px 实色环（拖动反馈要留）。
   ⚠️ 托盘卡的外层标记是 csNodeTray，内层那个布局 div 才叫 csNodeGroup ——
   两者名字接近但挂在不同元素上，别把它们当同一个（CSS 也选不到内层）。 */
.csNodeTray.csNodePrimary.csNodeSelected {
  z-index: auto;
}

/* R-P0-12 二增量：拖线手势的悬停可落目标 —— 虚线 accent 环 + 光晕。
   用虚线与「主拖节点」的实色环（csNodePrimary）区分：实环 = 我被抓着动，
   虚环 = 线松手会落到我这里。高亮与连线共用同一份命中判定（CanvasSurface
   的 linkDropTargetAt），所见即所得。 */
.csNodeLinkTarget {
  outline: 2px dashed var(--cs-accent, #6c5ce7);
  outline-offset: 2px;
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* CV-089：连线和 resize 把手只在 hover/选中 显 —— 之前 link handle 常驻，
   每个媒体节点右缘都挂一个 12px 圆点，叠加在大批节点上视觉上像"蒙了一层"。
   现改为 hover 当前节点或该节点被选中才显出。 */
.csNodeLinkHandle {
  position: absolute;
  /* CV-169：贴内边（原 right: -9px）。12px 圆点挂到框外 9px，而 .csNode
     是 overflow:hidden —— 卡右缘只剩下 3px 的一牙月牙（截图里那个半圆），
     命中区也随之只剩 3px 宽。 */
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--cs-node, var(--dsw-alias-bg-base));
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
  opacity: 0;
  transition: opacity var(--cs-duration-fast, 100ms) var(--cs-ease, ease);
}

.csNode:hover .csNodeLinkHandle,
.csNodeSelected .csNodeLinkHandle {
  opacity: 1;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* CV-089：选中态 —— 实色 accent 描边 + 外光晕。
   【历史】这里曾挂过 .csCanvasSurface[data-dragging="true"] 规则，把「非被拖
   节点」压到 opacity 0.55 / 0.85。那是错的：它不看血缘，点选单张图拖动就会把
   整屏其他节点压暗，看上去像"蒙了一层"。CV-186 起压暗回到**血缘聚光**这一条
   路上（见下面的 .csNodeNear / .csNodeDimmed），data-dragging 规则不再复活。
   拖动本身只给被拖的那个抬 z-index + 加粗描边。

   ⚠️ CV-169：**状态层优先于交互层**。选中态是 (0,1,0)，任何 :hover /
   :active 伪类规则都是 (0,2,0) —— 只要它们也写 border-color / box-shadow，
   就会在悬停/按住时把选中外观顶掉。已实测过两起：
     · .csNode:hover     → 选中后鼠标一进卡片，紫边变灰线
     · .csNode:active    → 按住（Ctrl 加选 / 拖缩放把手）时，光晕变普通投影
   加新规则时的判据：**只改 border-color / box-shadow 的伪类规则必须带
   :not(.csNodeSelected)**（背景、光标、filter 不受此限）。
   守卫见 tests/visual-tokens.test.mjs 的「选中态不可被交互态覆盖」。 */
.csNodeSelected {
  border-color: var(--cs-accent, #6c5ce7);
  /* REQ-004 / R-P2-01（2026-10-03）：「选中效果不明显」——描边从继承宽度提到 2px
     （宽度不与 :hover 的 border-color 特异度冲突，CV-169 判据不受影响）。
     DD-03 光晕令牌保持不动；不引入写死色值（CV-261 守卫）。 */
  border-width: 2px;
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* DD-03 / CV-186：血缘聚光的两个档位 —— 判定口径在 src/canvas-lineage.ts
   （唯一实现），本文件只负责把档位翻成乘数。
   只写乘数，不写 opacity，与数据层/状态层相乘而不是互相覆盖。
   三档：亮档不挂类；near = 隔一层血缘（血缘距离 2）；dim = 更远与无关。
   触发时机是**拖动**（位移越过拖拽阈值），单击选中不压暗。 */
.csNodeNear {
  --cs-node-dim: var(--cs-dim-near, 0.75);
}

.csNodeDimmed {
  --cs-node-dim: var(--cs-dim, 0.42);
}

.csNodeMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* DD-03：媒体窗口的底色 = **画布最深档**，不是壳层底色。图的四周（letterbox
     或加载中）露出的是「工作台面」而不是「卡片面」，这才是片门该有的读数。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}

/* Images stay inert so node dragging owns every pointer; the video keeps
   native controls (play/seek/volume) interactive. */
img.csNodeMedia {
  pointer-events: none;
}

/* CV-128/130：音频节点卡片（画布就地播放）。节点尺寸 260×132（契约常量
   AUDIO_NODE_WIDTH/HEIGHT）：波形 + 播放/进度 + 歌词摘要 —— 标题行与时长
   C10 起由卡片自己的头/脚承载，卡内不再重复一遍。
   颜色走主题 token，深色/浅色自适应（与 .csNode 一致）。overflow:hidden 是必要的
   ——老项目里还留着更矮的节点，内容超出时不能溢出到其它节点上。 */
.csNodeAudioBox {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-2, 8px) var(--cs-space-3, 12px);
  /* C10：与 .csNodeMediaBox 同理 —— 体区吃剩余空间，不再 height: 100%。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  /* DD-03：跟随节点面（改前是宿主 bg-base，与 .csNode 的 --cs-node 不同源，
     音频卡比旁边的图/视频卡整低一档）。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
}

/* C10：音频卡的**内层标题行已删**（原本是 ♪ + 标题 + 时长）。
   三样东西在卡片头部/脚部各有了正式位置：标题进头部标题槽、
   时长进脚部读数、「这是音频」由头部的 BGM 标签回答。留着内层标题行等于
   同一张卡上写两遍标题 —— 而且内层行会跟着卡片高度一起被压缩变形。 */

.csNodeAudioWave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  overflow: hidden;
}

.csNodeAudioBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 1px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

.csNodeAudioControls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csNodeAudioPlay {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--cs-accent, #6c5ce7);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.csNodeAudioPlay:hover {
  filter: brightness(1.08);
}

.csNodeAudioProgress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  /* CV-130：进度条可拖动 —— 命中区比 4px 视觉高度大一圈（上下各 5px 隐形
     内边距），否则 4px 的目标根本点不准。 */
  padding: 5px 0;
  margin: -5px 0;
  box-sizing: content-box;
  background-clip: content-box;
  cursor: pointer;
  touch-action: none;
}

.csNodeAudioProgress:hover .csNodeAudioProgressFill {
  filter: brightness(1.15);
}

.csNodeAudioProgressFill {
  height: 100%;
  background: var(--cs-accent, #6c5ce7);
  border-radius: 2px;
  pointer-events: none;
}

/* CV-130：歌词摘要行（卡片只有一行位置，全文在播放器窗口/详情面板）。
   纯器乐时显示「纯器乐 · 无歌词」，两种情况都占位 → 卡片高度不跳动。 */
.csNodeAudioLyrics {
  font-size: 10px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 隐藏的 <audio> 元素：仅作播放引擎，不渲染控件（控件由上面的按钮+进度条自绘）。 */
.csNodeAudioEl {
  display: none;
}

/* REQ-032 F3：产物后字幕条（描述+正文合成一行，演示 .capstrip 1:1——底部渐变、
   两行 clamp、描述在等宽括号里）。仅产物已落（node.url 有值）时渲染。 */
.csNodeAudioCapstrip {
  font-size: 11px;
  line-height: 1.55;
  color: #c2cad5;
  background: linear-gradient(180deg, transparent, rgba(6, 8, 12, .82));
  padding: 8px 10px 6px;
  margin: 0 -10px -6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  pointer-events: none;
}
.csNodeAudioCapstripParen { color: #9ecbff; font-family: ui-monospace, Consolas, monospace; }
.csNodeAudioCapstripBody { color: var(--dsw-alias-label-secondary); }

/* REQ-032 F1：audio 空态 —— 麦克风图标 + 引导语（演示 1:1，与 video 空态同构）。 */
.csNodeAudioEmpty {
  position: absolute;
  top: ${NODE_HEAD_HEIGHT}px;
  left: 0;
  right: 0;
  bottom: ${NODE_FOOT_HEIGHT}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 0 14px;
  text-align: center;
  background: linear-gradient(160deg, rgba(125, 211, 252, .05), transparent 55%);
}
.csNodeAudioEmptyIcon { display: flex; color: #7dd3fc; }
.csNodeAudioEmptyIcon svg { width: 40px; height: 40px; }
.csNodeAudioEmptyText { font-size: var(--cs-fs-xs, 11px); color: var(--dsw-alias-label-secondary); line-height: 1.5; }

/* 详情面板音频试听控件 + 图层列表音频缩略图。 */
.csDetailAudio {
  width: 100%;
  max-width: 320px;
  height: 32px;
}

.csLayerThumbAudio {
  font-size: 18px;
  color: var(--cs-accent, #6c5ce7);
}

.csNodeText {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-3, 12px);
  /* C10：体区 —— 吃头/脚之外的剩余高度（改前 height: 100%）。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* C2：加载失败卡 —— 卡片里只剩一句说明，居中。
   角标牌面是 inline-flex，在 flex 列里默认被拉伸成满宽，不居中就会读成
   「一行被拉长的字」而不是「这张卡坏了」。 */
.csNodeTextAlert {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.csNodeKind {
  font-size: var(--cs-fs-xs, 11px);
  letter-spacing: 0.02em;
  /* CV-177：这条标签唯一的位置是托盘的抓取带上（accent 12% 底），tertiary
     在带子上读不清；托盘标题要说的是「这一箱是什么」，够二级文字的份量。
     长标题（自动编组用分镜卡标题兜底时可能很长）走省略号，不挤压成员数。 */
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csNodeBody {
  margin: 0;
  font-size: var(--cs-fs-md, 13px);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  /* A-5（2026-10-03）：长文默认折叠 12 行（此前 925 字直接被静默裁掉、无任何
     affordance）；选中态展开可滚（下方 .csNodeSelected 规则解除钳制，与
     CV-081 互斥成立）。高度自适应由 write_script 落卡时按内容量给。 */
  display: -webkit-box;
  -webkit-line-clamp: 12;
  -webkit-box-orient: vertical;
}

/* CV-081：文本类节点选中态正文可滚动（长分镜表/脚本不再截断）。
   滚轮豁免在 CanvasSurface 的 wheel handler 里按「可滚」判定。 */
.csNodeSelected .csNodeBody {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  /* A-5：选中展开——解除折叠钳制（display 恢复块级，行数不限）。 */
  display: block;
  -webkit-line-clamp: unset;
}

/* CV-001：文本类节点内联正文编辑（双击进入，替换只读正文）。 */
.csNodeBodyEdit {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
  border-radius: var(--cs-radius-sm, 4px);
  padding: var(--cs-space-1, 4px) var(--cs-space-2, 8px);
  font: inherit;
  font-size: var(--cs-fs-md, 13px);
  line-height: 1.4;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csTimeline {
  display: none;
  /* display: flex; -- 临时隐藏时间轴（视频/音频轨道编辑区），恢复时改回 flex */
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：时间轴归壳层 —— 与上方画布拉开一档，读成「台面下的导播条」。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* P9.3 合成工具条：片段计数 + 导出按钮。 */
.csTimelineToolbar {
  display: flex;
  /* C9：窄窗下换行（播放 / 计数 / 预计 / BGM / 显示全部 / 导出），不溢出。 */
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

/* N3（对齐清单 §8.3）：播放/暂停。工具条里的最小按钮 —— 素文 + 边框，不抢
   右侧「合成导出成片」主按钮的戏。 */
.csTimelinePlay {
  flex: 0 0 auto;
  padding: 2px 8px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.csTimelinePlay:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csTimelinePlay:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csTimelineCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* DD-04a：旧「等宽 chip 列表」横向滚动条已由三轨时间轴取代（csTlBody 内自管滚动）。 */

.csTimelineEmpty {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-base);
}

/* ==== DD-04a：真时间轴（标尺 + 三轨 + 可拖播放头） ====
   设计稿 docs/visual-direction-preview.html 的 .tl* 规格落到工程令牌：
   片段宽度 = 真实 duration 比例（src/timeline-layout.ts 唯一权威），
   多轨 = 视频轨 / BGM 轨 / 参考·产物轨。标签列宽 56px 与播放头 left 公式同源。 */
.csTlBody {
  padding: 2px 4px 4px;
}

.csTlLanes {
  position: relative;
}

.csTlRuler {
  position: relative;
  height: 14px;
  margin-left: 56px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: ew-resize;
}

.csTlTick {
  position: absolute;
  top: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

.csTlTick::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 3px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlTrack {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  margin-top: var(--cs-space-1, 4px);
}

.csTlTrkLabel {
  flex: 0 0 56px;
  width: 56px;
  box-sizing: border-box;
  padding-right: 8px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  text-align: right;
  white-space: nowrap;
}

/* 轨道底：用 --cs-line（明暗双轨）做极淡的槽底，不引入新令牌也自动跟主题。 */
.csTlLane {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  border-radius: var(--cs-radius-sm, 6px);
  background: color-mix(in srgb, var(--cs-line, var(--dsw-alias-border-l2)) 22%, transparent);
}

.csTlLaneTall {
  height: 38px;
}

.csTlLaneEmpty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

/* 片段 = 定位容器（left/width 由 timeline-layout 算出的百分比）。
   勾选区是它的兄弟绝对定位元素——兄弟互不穿透，点勾选不触发选中/拖拽。 */
.csTlClipWrap {
  position: absolute;
  top: 3px;
  bottom: 3px;
}

.csTlClip {
  position: absolute;
  inset: 0;
  border-radius: var(--cs-radius-sm, 6px);
  overflow: hidden;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: grab;
  transition: border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csTlClip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
}

/* 选中：与画布节点同一份 --cs-glow-accent 光晕（明暗双轨都有定义）。 */
.csTlClipSel {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* 播放头正压着的片段：teal 行进高亮（teal = 播放 / 预览的固定功能色）。 */
.csTlClipHot {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 70%, transparent);
}

.csTlClipExcluded {
  opacity: 0.4;
}

/* P9.1：拖拽排序的插入落点提示。 */
.csTlClipTarget {
  outline: 2px dashed var(--cs-accent, #6c5ce7);
  outline-offset: 1px;
}

.csTlClipArt {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  pointer-events: none;
}

.csTlClipArt img,
.csTlClipArt video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csTlClipLbl {
  position: absolute;
  left: 5px;
  bottom: 3px;
  max-width: calc(100% - 10px);
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  text-shadow: 0 1px 3px rgb(0 0 0 / 90%);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 片段右缘切点：读成「下一段从这里开始」。 */
.csTlClipCut {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
  pointer-events: none;
}

.csTlClipBgm {
  cursor: pointer;
}

/* C3：BGM 真波形条带（use-waveform.ts 的 WaveBars）。铺在 clip 底层当材料，
   歌名 label 叠其上；条形不接交互（选中/点按是 clip 整体的事）。真包络由
   Host ffmpeg 解码，未就绪时是确定性降级条 —— 两种来源同一套样式。 */
.csWaveBars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  padding: 2px 6px;
  pointer-events: none;
}
.csWaveBars i {
  flex: 1 1 0;
  min-width: 1px;
  border-radius: 1px;
  background: var(--cs-accent, currentColor);
  opacity: 0.3;
}
.csTlClipSel .csWaveBars i {
  opacity: 0.5;
}

.csTlCheck {
  position: absolute;
  top: -6px;
  right: -4px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}

.csTlCheckOff {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 参考·产物轨：金色 chip = 素材参考，teal chip = 成片产物（产物 ≠ 素材）。
   文字色向黑混 18%：gold/teal 是固定功能色不分轨，浅色主题下原值对比不足。 */
.csTlRefRow {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: 0 8px;
  overflow-x: auto;
}

.csTlRefChip {
  flex: 0 0 auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 7px;
  font-size: var(--cs-fs-xs, 11px);
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 14%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 82%, black);
  border: 1px solid transparent;
  white-space: nowrap;
  cursor: pointer;
}

.csTlRefChip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlRefChipFilm {
  background: color-mix(in srgb, var(--cs-teal, #35c2a6) 14%, transparent);
  color: color-mix(in srgb, var(--cs-teal, #35c2a6) 82%, black);
}

/* 失效版本 chip：与画布语义一致——保留可回溯，灰显。 */
.csTlRefChipRetired {
  opacity: 0.55;
  text-decoration: line-through;
}

/* 播放头：纵向贯穿三轨；top 15px = 标尺(14px)下沿起。accent 光晕双轨都有。 */
.csTlPlayhead {
  position: absolute;
  top: 15px;
  bottom: 0;
  width: 1px;
  background: var(--cs-accent, #6c5ce7);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cs-accent, #6c5ce7) 70%, transparent);
  pointer-events: none;
  z-index: 8;
}

.csTlPhGrip {
  position: absolute;
  top: 0;
  left: -4px;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  cursor: ew-resize;
  pointer-events: auto;
}

/* 预计成片时长（Σ 参与合成的逐镜片段真值；成片产物与失效版本都不计入）。 */
.csTimelineEst {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

/* CV-160：时间轴上有成片产物时的说明（避免「预计时长对不上」的误解）。 */
.csTimelineHint {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm select {
  max-width: 180px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  padding: 2px 4px;
}

/* BGM 可能短于成片的 amber 软提示（不拦，服务端守卫兜底报精确差额）。 */
.csTimelineWarn {
  font-size: 12px;
  color: var(--dsw-status-warning-fg, #b8860b);
}

.csTimelineToggleAll {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  white-space: nowrap;
}

.csConversation {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* ---- CV-114：素材 chip 的 hover 缩略图浮层 ----
   chip 画在 composer 的镜像层里（不可交互），卡片是我们自己的元素：
   fixed 定位 + 自身可点，点一下打开大图 / 播放器。 */
.csChipPreview {
  position: fixed;
  z-index: 90;
  transform: translateY(-100%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 10px;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  overflow: hidden;
}

.csChipPreviewMedia {
  position: relative;
  width: 100%;
  height: 124px;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
}

.csChipPreviewImage,
.csChipPreviewVideo {
  display: block;
  width: 100%;
  height: 124px;
  object-fit: cover;
  border-radius: 6px;
}

.csChipPreviewEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 124px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.16);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

/* 音频 chip 的 hover 卡：无首帧可取，出音符占位（复用 Media 的盒子尺寸与
   徽标定位 —— Badge/Duration 是 absolute，锚在本元素上）。 */
.csChipPreviewAudio {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(135deg, rgba(122, 162, 247, 0.28), rgba(122, 162, 247, 0.08)),
    #000;
}

.csChipPreviewAudioIcon {
  color: var(--cs-accent, #7aa2f7);
  font-size: 40px;
  line-height: 1;
}

/* CV-124：技能 chip 的 hover 说明卡（无缩略图概念，图标 + 标题 + 一句话说明）。 */
.csChipPreviewSkill {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 2px;
  color: var(--dsw-alias-label-primary);
}

.csChipPreviewSkill > svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--cs-accent, #7aa2f7);
}

.csChipPreviewSkillBody {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csChipPreviewSummary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.csChipPreviewBadge,
.csChipPreviewDuration {
  position: absolute;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.csChipPreviewBadge {
  left: 6px;
}

.csChipPreviewDuration {
  right: 6px;
}

.csChipPreviewFoot {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.csChipPreviewHandle {
  flex: 0 0 auto;
  color: var(--cs-accent, #7aa2f7);
  font-size: 12px;
  font-weight: 600;
}

.csChipPreviewTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

.csOverlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
}

.csOverlay > * {
  pointer-events: auto;
}

/* ---- Canvas toolbar (floating strip above the surface) ---- */
.csToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工具栏归壳层，与下方画布成形明度落差。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  z-index: 5;
}

.csToolbarGroup {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  margin-right: 4px;
  border-right: 1px solid var(--dsw-alias-border-l2);
}

.csToolbarGroup:last-child {
  border-right: none;
  padding-right: 0;
  margin-right: 0;
}

.csToolbarButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.csToolbarButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csToolbarButton:disabled {
  opacity: 0.4;
  cursor: default;
}

.csToolbarZoomValue {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  padding: 0 4px;
  min-width: 40px;
  text-align: center;
  white-space: nowrap;
}

/* ---- Snap alignment guides ---- */
.csGuide {
  position: absolute;
  background: var(--dsw-alias-interactive-bg-active);
  pointer-events: none;
  z-index: 3;
}

.csGuideVertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.csGuideHorizontal {
  left: 0;
  right: 0;
  height: 1px;
}

/* ---- Node visual states ---- */
/* DD-03：locked / retired 只写**状态乘数**，由 .csNode 的 calc 统一乘进
   opacity。改前这里写的是 opacity: 0.75，被 CanvasNode 的 inline opacity
   永久压制（inline 永远赢）—— 这两个数字从来没生效过。 */
.csNodeLocked {
  --cs-node-state: 0.75;
  cursor: not-allowed;
}

.csNodeError {
  border-color: var(--dsw-alias-state-error-primary);
}

.csNodeLoading {
  border-style: dashed;
  border-color: var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
}

/* DD-03：媒体窗口 = 片门。上下各一道 2px 的暗带，把「画面」和「卡片壳」切开
   —— 这是单张卡片看起来像「镜头条」而不是「通用卡片」的关键一笔。
   box-sizing：height:100% 配上下边框，默认 content-box 会把节点撑高 4px 并被
   .csNode 的 overflow:hidden 裁掉底部 2px；border-box 让边框向内吃，画面
   上下各让 2px（对象是 object-fit:cover，读数是「闸门」，不是「画面被裁」）。 */
.csNodeMediaBox {
  position: relative;
  width: 100%;
  /* C10：媒体窗口是**体区** —— 吃头/脚之外的全部剩余高度。
     改前是 height: 100%（占满整张卡）：加头部之后那一份「整张卡」里已经含了
     头脚，100% 就会比实际可用空间高 48px，画面底部被 .csNode 的 overflow 裁掉。
     flex: 1 1 auto + min-height: 0 是 flex 列里「吃掉剩余空间且允许被压缩」的
     标准写法；min-height 若留在 auto，内容的最小尺寸会把卡片顶开。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  border-top: 2px solid var(--cs-gate, #0b0d12);
  border-bottom: 2px solid var(--cs-gate, #0b0d12);
}

/* CV-083 / CV-089：时长（m:ss）与分辨率角标。
   C2：从「媒体框内的绝对定位」并入**底部角标带**（见 .csNodeBadgeBand），
   牌面交回共用规则（--cs-chip-*），这里只留各自不能丢的那一条。搬家的两个理由：
   1. 原先分辨率钉在「媒体框内右下 8px」、音轨构成角标钉在「卡片外右下 8px」，
      两者在视频节点上**互相压住**（实测重叠）；收进同一条带后由 flex 排布，
      重叠在结构上不可能发生。
   2. 媒体框带翻转 transform（node.flipX / node.flipY），挂在它里面的文字会
      跟着镜像 —— 翻转过的视频，时长曾显示成一串反写的数字。角标带挂在卡片上，
      不受翻转影响（画面翻转、读数不翻转，这才是对的）。
   时长数字必须等宽：它每帧都在变（拖播放头 / 播放中），比例数字会让整行左右抖。 */
.csNodeDuration,
.csNodeMediaDims {
  font-variant-numeric: tabular-nums;
}

.csNodeGroup {
  /* CV-177：托盘 = 顶部抓取带 + 主体。改前它是一个居中对齐的行（只放一个
     标签），成员是画布层的兄弟节点、不在这里；现在要的是**列**，好把抓取带
     钉在顶部。padding 一并去掉 —— 留白由「成员与托盘的相对位置」表达
     （canvas-view 的 groupBoxOf），不再由这里的内边距表达。 */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  /* DD-03：分组框也跟品牌走 —— 改前是写死的靛蓝 rgb(99 102 241 / 6%)，
     切到琥珀金预设时分组框还是一片紫。 */
  border: 1px dashed color-mix(in srgb, var(--cs-accent, #7c6cff) 45%, transparent);
  border-radius: var(--cs-radius-md, 8px);
  background: color-mix(in srgb, var(--cs-accent, #7c6cff) 7%, transparent);
}

/* CV-177：抓取带 —— 托盘「从哪儿拖」的唯一答案。
   托盘没有 resize 把手（showResize 只给媒体节点），成员又可能只有一张、
   边环在缩放后只剩几像素，所以这条带子必须是**固定高度、整宽、任何时候
   都在**的。这里的 24px 是跨层几何契约，必须等于 canvas-view.ts 的
   GROUP_HEAD_HEIGHT —— 有测试比对这两个数。之所以写死字面量而不是插值：
   本文件的插值写法被 C10 守卫限定为 canvas-aspect 的导出常量，托盘几何不在
   那里（另注：本文件是模板字面量，注释里出现美元花括号会当场把文件撕裂）。 */
.csGroupHead {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  flex: 0 0 auto;
  height: 24px;
  padding: 0 var(--cs-space-2, 8px);
  box-sizing: border-box;
  border-bottom: 1px solid color-mix(in srgb, var(--cs-accent, #7c6cff) 30%, transparent);
  background: color-mix(in srgb, var(--cs-accent, #7c6cff) 12%, transparent);
}

/* CV-177：成员数贴右 —— 「一张还是多张」正是拖动语义的分界
   （单张时拖成员 = 拖托盘），写出来比让人试出来便宜。 */
.csGroupCount {
  margin-left: auto;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 缩放把手 / 连接把手：几何契约 = **必须完整落在卡片盒子内**。
   ⚠️ 2026-09-13 真机验收（CV-169）：这些把手原先用负偏移挂在框外（-4px），
   而 .csNode 是 overflow: hidden + 圆角 8px —— 于是每个把手都被裁掉一半，
   四个角把手再被圆角吃掉一块。实测：把 .csNodeResizeSE 的**盒中心**
   （布局盒中心，不是可见部分）丢给 elementFromPoint 命中的是
   .csCanvasSurface —— 也就是说那一角根本不在卡片上，按下去会被判成
   「空白按下」→ **清空整个选区 + 开始平移**（用户视角：量着右下角想缩放，
   结果选中没了）。
   修法：把手改为**贴内边**（偏移全非负），不被裁也不被圆角吃掉；
   边缘把手 8px、角把手 10px，中心都可命中。 */
.csNodeResize {
  position: absolute;
  z-index: 4;
}

.csNodeResizeN {
  top: 0;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeS {
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeE {
  top: 8px;
  bottom: 8px;
  right: 0;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeW {
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeNW {
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeNE {
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSW {
  bottom: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSE {
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeN, .csNodeResizeS, .csNodeResizeE, .csNodeResizeW {
  opacity: 0;
}

.csNode:hover .csNodeResize,
.csNodeSelected .csNodeResize {
  opacity: 1;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* DD-03：生成中遮罩 —— 改前是 bg-base + opacity .92 的实心板，浅色主题下
   一块白板、深色下一块黑板，都读成「卡片坏了」。现在是一层**主题感知**的
   纱（--cs-scrim），通透度靠颜色本身给，不再靠 opacity 折中。
   C10：遮罩只盖**体区**（top 让开头部）—— 正在显影的是画面，标题与类型标签
   应该一直读得到；顺带把扫描光带关进片门里，跟设计稿的 .ndScan 一致。
   脚部不遮：那是读数，不是画面。 */
.csNodeOverlay {
  position: absolute;
  top: ${NODE_HEAD_HEIGHT}px;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--cs-scrim, var(--dsw-alias-bg-base));
}

.csNodeOverlayLabel {
  font-size: var(--cs-fs-sm, 12px);
  /* DD-03：MM:SS 计时每秒都在跳，等宽数字才不会让整行左右晃。 */
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}

/* DD-03：生成中 = **显影扫描光带**（设计稿的 develop 语义），不再是横向进度条。
   进度条说的是「还剩多少」（没人知道），扫描光带说的是「正在显影」（一定成立）。
   DOM 不动（.csNodeProgress 仍是那个 <span>，宿主测试与快照不受影响）：把容器
   变成覆盖整张卡的绝对定位层，把内条变成一道自上而下扫过的渐变光带。 */
.csNodeProgress {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  overflow: hidden;
  background: none;
  pointer-events: none;
}

.csNodeProgressBar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: block;
  width: auto;
  /* 40% 高的光带，在 100% 高的容器里自上而下扫 —— 首尾都停在画面外，
     读者看不到「跳回起点」这一帧。 */
  height: 40%;
  border-radius: 0;
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--cs-accent, #7c6cff) 30%, transparent) 50%,
    transparent
  );
  animation: csDevelop 1.6s linear infinite;
}

/* DD-03：显影语义（新内容出现）—— 动效三语义的第一个。
   命名规则：@keyframes 必须归入 develop / advance / yield 其一（守卫断言）。 */
@keyframes csDevelop {
  from { transform: translateY(-110%); }
  to { transform: translateY(360%); }
}

@media (prefers-reduced-motion: reduce) {
  .csNodeProgressBar { animation: none; }
  .csNodeVideoRing { animation: none; }
}

/* ======================= REQ-031 Step 5：video 节点三态（F1/F2/F3） =======================
   橙色 accent 固定 #ffb066 —— 与输入框卡同一偏差登记（演示 1:1，不随外观预设走）。 */
/* F1 空态：橙色摄像机图标 + 引导语（无产物、未在生成时）。 */
.csNodeVideoEmpty {
  position: absolute;
  top: ${NODE_HEAD_HEIGHT}px;
  left: 0;
  right: 0;
  bottom: ${NODE_FOOT_HEIGHT}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 0 14px;
  text-align: center;
  background: linear-gradient(160deg, rgba(255, 176, 102, .05), transparent 55%);
}
.csNodeVideoEmptyIcon { display: flex; color: #ffb066; }
.csNodeVideoEmptyIcon svg { width: 40px; height: 40px; }
.csNodeVideoEmptyText { font-size: var(--cs-fs-xs, 11px); color: var(--dsw-alias-label-secondary); line-height: 1.5; }
/* F2 参数角标：画幅 · 时长 · 清晰度（声明参数读数，钉在脚部读数行上方右缘）。 */
.csNodeVideoBadge {
  position: absolute;
  right: 10px;
  bottom: calc(${NODE_FOOT_HEIGHT}px + 6px);
  z-index: 2;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(8, 10, 14, .68);
  border: 1px solid #2d343f;
  color: #dfe6ee;
  font-size: 10.5px;
  letter-spacing: .3px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
/* F3 进度环：行进语义旋转（环只是动画，无百分比数字——后端无进度回调，拍板③）。 */
.csNodeVideoRing {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid color-mix(in srgb, #ffb066 20%, transparent);
  border-top-color: #ffb066;
  animation: csAdvanceSpin 1s linear infinite;
}
.csNodeVideoRingSub { font-size: var(--cs-fs-xs, 11px); color: var(--dsw-alias-label-secondary); }
@keyframes csAdvanceSpin { to { transform: rotate(360deg); } }

/* CV-010：loading 超时（>3 分钟）的可打断提示。 */
.csNodeOverlayHint {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* ======================= C10：节点镜头条（头 / 脚） ======================= */

/* 规格：头 ${NODE_HEAD_HEIGHT}px / 脚 ${NODE_FOOT_HEIGHT}px，两个数字来自
   src/canvas-aspect.ts 的 NODE_HEAD_HEIGHT / NODE_FOOT_HEIGHT —— 那里也是
   frameSizeOf 算节点框高度的依据。**在这里写死字面量就会漂移**：常量说 48、
   CSS 实际 52，自然尺寸校正每次加载都把卡片高度改错 4px，而画面上只是
   「看着有点挤」，没有任何报错。（tests/visual-tokens.test.mjs 断言此处是插值。） */

/* ---- 头部：「这是什么产物」 ----
   左：类型标签（剧本 / 分镜 / 关键帧 / 角色 / 成片 …）+ 标题；
   右：身份 chips（版本 / 镜号 / 锁）+ 失效标记。
   为什么值得占掉 26px：卡片从此回答「它是哪一步的什么产物」，而不是「一个框里
   有张图」。媒体的尺寸一点没被挤 —— 高度是**加在卡片上**的（见 frameSizeOf）。 */
.csNodeHead {
  flex: 0 0 auto;
  height: ${NODE_HEAD_HEIGHT}px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  padding: 0 var(--cs-space-3, 8px);
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* 头部是**实底**：加载遮罩只盖体区，不盖头部（见 .csNodeOverlay）——
     正在显影的是画面，标题应该一直读得到。实底同时保证遮罩不会从缝隙里透出来。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  /* 头部整条都是拖拽面（改前浮动角标必须 pointer-events: none 才能让出起手区，
     实底之后不必再让）。可点的失败角标自己再收回来。 */
  cursor: grab;
}

/* 类型标签（产物名）。材料走 accent-soft / accent 一对令牌：它们在明暗两轨都是
   为「同主题的面」调的（浅色取 accentDeep 系、深色取 accent 系），所以标签在
   两种主题下都读得清，不需要为明暗各写一遍。 */
.csNodeHeadKind {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* 标题。flex: 1 1 auto + min-width: 0 —— 标题是唯一允许被压缩的成员，
   长标题先省略，而不是把右边的身份 chips 挤出卡片。 */
.csNodeHeadTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csNodeHeadChips {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  min-width: 0;
  /* 标题为空（如 BGM 卡：标题就是类型本身）时，身份 chips 仍要靠在右端 ——
     靠标题的 flex: 1 把它推过去是「碰巧」，标题一没就左移了。 */
  margin-left: auto;
}

/* ---- 脚部：读什么数 ----
   左：读数（时长 / 分辨率 / 音轨构成 / 声明时长 / 字数）；右：素材角色（金色书签）。
   读数是**素文**而不是药丸：C2 时它们压在画面上，必须自带墨底才读得清；搬进
   脚部之后底下就是节点面，再给药丸就是无谓的框套框（设计稿的 .ndFoot 也是素文）。 */
.csNodeFoot {
  flex: 0 0 auto;
  height: ${NODE_FOOT_HEIGHT}px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  padding: 0 var(--cs-space-3, 8px);
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: var(--cs-node, var(--dsw-alias-bg-base));
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

.csNodeFootReadings {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  min-width: 0;
  overflow: hidden;
}

/* 所有会逐帧变化的数字（时长 / 分辨率 / 字数）共用等宽数字：比例数字会让整行
   随播放时间左右抖 —— 脚部在卡片最下方，抖动会被读成「卡片在动」。 */
.csNodeFootReadings,
.csNodeDuration,
.csNodeMediaDims,
.csNodeChars {
  font-variant-numeric: tabular-nums;
}

/* C10：字数读数（文案卡）。与时长/分辨率同属读数族但**不是秒数** ——
   给它自己的类名，将来想弱化它时不用去动数字族共用的规则。 */
.csNodeChars {
  color: var(--dsw-alias-label-tertiary);
}

/* CV-011：参考图的素材角色 —— 脚部右端的一枚**金色书签**，不占读数的地方。
   金色的明度在浅色主题下压不住白底，所以往当前主题的正文色混一档：混的是
   「明暗方向」而不是色相，四种预设下都仍是金。 */
.csNodeRefBadge {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  padding: 1px 7px 1px 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 72%, var(--dsw-alias-label-primary));
  font-size: var(--cs-fs-xs, 11px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csNodeRefDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dsw-alias-border-l3);
}

/* 牌面（头部身份 chips 共用）：版本 / 镜号 / 锁 / 失效 / 音轨构成。
   材料走**宿主交互面**（interactive-bg-hover）而不是自造的墨底 —— 它本来就是
   「当前主题下比卡片面亮一档」的语义，明暗两轨都由宿主保证对比度。
   flex: 0 1 auto + min-width: 0 让长牌面先压缩再省略，而不是被挤出卡片。 */
.csNodeBadge {
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 告警牌面（共用）：头部占标题格的那一枚，与「体区整块坏掉」时居中的那一枚。
   同一个外观必须只写一份 —— 否则两处告警会慢慢长成两种红。 */
.csNodeAlert,
.csNodeHeadAlert {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: var(--cs-fs-xs, 11px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 头部里的那一枚 —— 占**标题那一格**（不是浮在卡片上）。放标题槽有三个好处：
   ① 长标题压不掉它（它是 flex: 1 的成员，不会被省略）；
   ② 不遮画面、不遮类型标签；
   ③ 它可点（重试），而整条头部都是拖拽面 —— 占住标题格就不必再和拖拽抢指针。
   配色：错误色直接压宿主交互面。浅色主题的 error primary 是深红、深色主题下
   偏亮，两轨都够对比，所以不再需要往白里混（那是在墨底上才要做的补救）。 */
.csNodeHeadAlert {
  flex: 1 1 auto;
  min-width: 0;
}

/* CV-018：可重试的失败告警 —— 同一牌面 + 可点 affordance。
   用 <button> 是**功能要求**不是排版选择：CanvasNode 的 isInteractiveTarget 靠
   button / input / [contenteditable] 判定「这一下不是拖拽」，换成 span 会让
   点击重试变成「拖走了节点」。 */
button.csNodeHeadAlert {
  cursor: pointer;
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
}

button.csNodeHeadAlert:hover {
  background: var(--dsw-alias-state-error-primary);
  color: #fff;
}

/* 角色色点：构图=蓝 / 角色=红 / 风格=紫 / 首末帧=青。 */
.csNodeRefBadge[data-role='image'] .csNodeRefDot { background: #4d9fff; }
.csNodeRefBadge[data-role='character'] .csNodeRefDot { background: #ff6b6b; }
.csNodeRefBadge[data-role='style'] .csNodeRefDot { background: #b58cff; }
.csNodeRefBadge[data-role='frame'] .csNodeRefDot { background: #38c9b8; }

/* C2：锁定角标 = 一个图标位（emoji 自己带宽度，横向留白要比文字角标更紧，
   否则在头部一排里显得比邻座胖一圈）。 */
.csNodeBadgeLock {
  padding: 0 5px;
}

/* CV-108：失效版本（被新版取代 / 已作废）——灰显 + 虚线框，保留在画布上可回溯与恢复。
   注意：样式名用连字符，注释里不要写反引号包围的选择器。 */
.csNodeRetired {
  --cs-node-state: 0.45;
  filter: grayscale(1);
}

.csNodeRetired::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--cs-radius-md, 8px);
  pointer-events: none;
}

/* C2：镜号 chip —— 画布与底部成片时间轴之间的那根线。
   画布上摆的是素材，时间轴上排的是成片顺序；卡片带一个与时间轴同号的镜号，
   扫一眼就知道「这张卡最终排在成片的第几段」。编号口径与时间轴同源（都是
   有效片段序），不是各自数出来的第二个真相。
   C10：材料换成 accent-soft / accent —— 它是头部的**身份**标记，不是读数，
   与类型标签同族但更轻（标签实心、它描边），视觉上分得开。 */
.csNodeShotIdx {
  border: 1px solid color-mix(in srgb, var(--cs-accent, #7c6cff) 40%, transparent);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* DD-03：版本 chip 用 accent 底 —— 版本是「镜头条」的身份标记，
   值得比普通角标高一档的识别度，也把「同一镜位出过几版」摆在明面上。
   C2：镜号与版本合成**同一组身份标记**放头部右端 —— 它们是同一件事的两个维度
   （第几段 / 这段的第几版），分开放会让人以为它们无关。 */
.csNodeBadgeVersion {
  border: 1px solid color-mix(in srgb, var(--cs-accent, #7c6cff) 40%, transparent);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}

/* C10：失效版本标记 —— 划掉它。头部底色是节点面，所以压暗要对**主题正文色**
   做，不能再对已删掉的墨色牌面做（那样在浅色主题下会混成一抹灰）。 */
.csNodeBadgeRetired {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}

/* CV-143：成片音轨构成读数 —— 不用回放听就能确认「环境声有没有被丢、
   BGM 有没有混进去」。单镜保留环境声、多镜全丢是自动策略，用户必须能一眼
   看到结论。C10：落到脚部左侧，与时长 / 分辨率排在一起（它们都是「这段素材
   的读数」）。颜色按构成区分：有环境声=青、无声=错误色 —— 同样是往主题正文色
   混一档拿到可读明度，而不是往白里混（脚部底下是节点面）。
   注意：注释里不要写反引号包围的选择器名。 */
.csNodeAudioMix[data-audio='native'],
.csNodeAudioMix[data-audio='native+bgm'] {
  background: color-mix(in srgb, var(--cs-teal, #35c2a6) 16%, transparent);
  color: color-mix(in srgb, var(--cs-teal, #35c2a6) 72%, var(--dsw-alias-label-primary));
}

.csNodeAudioMix[data-audio='none'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.csNodeRename {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  z-index: 5;
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Edge draft line + chip text ---- */
.csEdgeDraft {
  stroke-dasharray: 6 4;
  stroke: var(--dsw-alias-interactive-bg-active);
}

.csEdgeChipText {
  font-family: inherit;
  user-select: none;
}

/* ---- Minimap ---- */
.csMinimap {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 6px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  cursor: grab;
  user-select: none;
}

.csMinimap:active {
  cursor: grabbing;
}

.csMinimap svg {
  display: block;
}

/* ---- BUG-020：画布废弃节点显示开关（右下浮层，屏幕固定层不随缩放） ---- */
.csDeprecatedToggle {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 6; /* 图层面板(10) / 参考托盘(20) 之下，高于节点层 */
  padding: 4px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  user-select: none;
}

.csDeprecatedToggle:hover {
  color: var(--dsw-alias-label-primary);
}

/* ---- Right column (conversation only) ---- */
.csChat {
  /* DD-09 / b：收起态要把 .csConversation 绝对定位出文档流（保滚动位置，见上），
     它需要这里是包含块。展开态无副作用。 */
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* DD-02：右栏与左栏同属壳层（硬约束：不动右侧对话区结构，只对齐底色）。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  border-left: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
}

/* ---- Floating layer-list overlay (inside the canvas body) ---- */
.csCanvasLayers {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  width: 260px;
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* DD-02：图层浮层与检查器同属最亮档（浮层压节点）。
     C4：玻璃化（Q3 拍板：玻璃只给详情面板 + 这块图层浮层，minimap 不给）。 */
  background: color-mix(in srgb, var(--cs-float, var(--dsw-alias-bg-base)) 82%, transparent);
  backdrop-filter: var(--dsw-mask-blur, 12px);
  /* C5：浮层出现 pop（让位语义 —— 画布让位给面板）。scale 从 .96 起：比位移安全
     （fixed 面板位移会甩出视口边缘），比纯透明「出现感」强。base 档 200ms，快得不挡手。 */
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

@media (prefers-reduced-motion: reduce) {
  .csCanvasLayers {
    animation: none;
  }
}

/* C5：让位语义 —— 浮层出现。 */
@keyframes csYieldPop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.csCanvasLayers .csLayerPanel {
  max-height: 320px;
  border-bottom: none;
}

/* ---- Layer panel ---- */
.csLayerPanel {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csLayerPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-weight: 600;
  font-size: 13px;
}

.csLayerSearch {
  font: inherit;
  font-size: 12px;
  flex: 0 0 120px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* 框选退役后的替代品：按类型选择行（下拉 + 反选 + 清除）。 */
.csLayerQuickSelect {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 8px;
}

.csLayerTypeSelect {
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csLayerQuickSelect .csLayerAction {
  flex: 0 0 auto;
  font-size: 12px;
}

.csLayerList {
  overflow-y: auto;
  padding: 0 6px 8px;
}

.csLayerRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.csLayerRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLayerRowActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csLayerThumb {
  flex: 0 0 40px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csLayerThumb img,
.csLayerThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csLayerThumbKind {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}

.csLayerTitle {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csLayerActions {
  display: flex;
  gap: 1px;
  flex: 0 0 auto;
}

.csLayerAction {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 11px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.csLayerAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csLayerActionActive {
  color: var(--dsw-alias-label-primary);
}

.csLayerActionDanger:hover {
  color: var(--dsw-alias-state-error-primary);
}

.csLayerEmpty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Node detail drawer（节点详情：画布内的底部通栏） ----
 *
 * 与旧右上角浮动面板的差别不只是位置。旧写法是
 * position: fixed; top: 64px; right: 12px; width: 320px —— 与节点坐标**毫无关系**：
 * 节点在哪它都飘在右上角（离被查看的对象很远），还盖住宿主右栏的对话区。这里改为
 * 挂在 .csCanvasBody 内做绝对定位 ⇒ 底边 = 容器底边（= 时间轴顶边）、宽度 =
 * 画布宽。「离得远」「压右栏」两条从几何上就不成立，不需要任何「测时间轴高度再减」
 * 的浮点账。
 *
 * 层位沿用原面板的 30：详情是「压节点」的浮层，但仍排在右键菜单（50）与遮罩（70）
 * 之下 —— 它不该盖住用户主动打开的菜单。
 */
.csDetailDrawer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* 只给上缘弧度：底边就贴时间轴，四角都圆会在下缘露出画布，读成「飘着」。 */
  border-radius: var(--cs-radius-lg, 10px) var(--cs-radius-lg, 10px) 0 0;
  /* DD-02：浮层是最亮档 —— 必须高于节点，否则检查器压在节点上会「糊成一片」。
     C4：玻璃化（Q3 拍板：玻璃只给详情面板 + 图层浮层两块）。 */
  background: color-mix(in srgb, var(--cs-float, var(--dsw-alias-bg-base)) 82%, transparent);
  backdrop-filter: var(--dsw-mask-blur, 12px);
  /* C5：浮层出现 pop，与图层浮层同一词汇。缩放原点钉在下缘 —— 抽屉是从下方抽出来
     的，默认的中心缩放会读成「从中间炸开」。 */
  transform-origin: bottom center;
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  overflow: hidden;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

@media (prefers-reduced-motion: reduce) {
  .csDetailDrawer,
  .csErrorCard {
    animation: none;
  }
}

/* C4：blur 不可用时的兜底。半透明底一旦没有模糊配合，会直接透出底下的节点，
   可读性比不玻璃更差 —— 所以必须成对给。支持 backdrop-filter 的浏览器不命中这条。 */
@supports not (backdrop-filter: blur(2px)) {
  .csDetailDrawer,
  .csCanvasLayers {
    background: var(--cs-float, var(--dsw-alias-bg-base));
  }
}

/* 上缘 6px 抓取带（拖动改高度）。做成独立元素而不是「整条表头可拖」：表头里有
   标题按钮与关闭按钮，混在一起会让「想点 × 却把抽屉拉高了」变成常态。 */
.csDetailDrawerGrip {
  flex: 0 0 auto;
  height: 6px;
  cursor: ns-resize;
  background: transparent;
}

.csDetailDrawerGrip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csDetailDrawerHead {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 12px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

/* 类型角标：与卡片头部的 csNodeHeadKind 同一角色（扫一眼知道「这是什么」），
   所以它不参与「标题」的视觉权重。 */
.csDetailDrawerKind {
  flex: 0 0 auto;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* 标题兼重命名入口：样式写成「文本」而不是「按钮」，因为它在 95% 的时间里只是
   一个标题；可点击只由 hover 的下划虚线提示。 */
.csDetailDrawerTitle {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  padding: 0;
  border: none;
  background: none;
  color: var(--dsw-alias-label-primary);
  cursor: text;
}

.csDetailDrawerTitle:hover {
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.csDetailDrawerClose {
  font: inherit;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.csDetailDrawerClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* 主体两栏：左「身份」（只读，扫一眼确认选中了什么）/ 右「内容」（可编辑）。
   右栏拿 minmax(0, 1fr) 无限扩张、左栏可缩到 200px —— 提示词要的是尽量宽，
   身份栏只要一个稳定的短列，两者不该各分一半。 */
.csDetailDrawerBody {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(0, 1fr);
  gap: 0 16px;
  padding: 10px 12px;
  overflow: hidden;
}

.csDetailDrawerCol {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
  font-size: 12px;
}

.csDetailDrawerColMain {
  gap: 10px;
}

.csDetailDrawerColTitle {
  margin: 6px 0 0;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-tertiary);
}

.csDetailBlock {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.csDetailBlock > .csDetailDrawerColTitle {
  margin-top: 0;
}

/* 参数摘要：一行读完（画幅 · 档位 · 时长 …）。它是**读数**不是表单 —— 摊成表格
   只会把右栏的纵向空间吃掉一半，而每个键的原文就在下面的「原始生成参数」里。 */
.csDetailReadouts {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.csDetailDrawerFoot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

/* 危险项靠右（订单 #3）：与常规操作之间用弹性空隙隔开，避免误点删除。 */
.csDetailFootSpacer {
  flex: 1 1 auto;
}

.csDetailRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* CV-001：多行控件（正文 textarea）所在行，标签与内容顶对齐。 */
.csDetailRowTop {
  align-items: flex-start;
}

.csDetailRowTop > .csDetailLabel {
  padding-top: 4px;
}

/* CV-001：详情面板正文编辑区。 */
.csDetailTextarea {
  flex: 1 1 auto;
  min-width: 0;
  resize: vertical;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csDetailLabel {
  flex: 0 0 72px;
  color: var(--dsw-alias-label-tertiary);
}

.csDetailValue {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csDetailInput {
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csDetailRange {
  flex: 1 1 auto;
  accent-color: var(--dsw-alias-interactive-bg-active);
}

.csDetailButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csDetailButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

/* 原始 JSON / 歌词 / 文案的全文块。字号与正文同档（12px）—— 从前这里是 11px +
   word-break: break-all，中英混排的提示词会被从单词中间劈开，读起来比溢出更难认。 */
.csDetailPrompt {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow-y: auto;
  color: var(--dsw-alias-label-secondary);
}

/* 详情面板：生成参数结构化展示（提示词/参考图缩略图/原始 JSON 折叠）。 */
.csDetailRefThumbs {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.csDetailRefThumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
}

/* CV-242：断链参考占位卡——句柄在画布上已无节点持有（节点被删 / 回写被旧副本覆盖）。
   尺寸与缩略图一致，保证「数量与参数句柄数一致」这件事一眼可数。 */
.csDetailRefBroken {
  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 4px;
  border: 1px dashed rgba(128, 128, 128, 0.5);
  font-size: 10px;
  line-height: 1.25;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
}

.csDetailRaw {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.csDetailRaw summary {
  cursor: pointer;
  user-select: none;
}

.csDetailError {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-state-error-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.csDetailActions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1 1 auto;
  justify-content: flex-end;
}

/* ---- 就近操作条（贴在选中节点旁边的工具条） ----
 *
 * 渲染在 .csCanvasLayer 之外的**兄弟层**（同 minimap）⇒ 量取的是布局尺寸、不被
 * 画布 transform 拖变形；视觉上由 JSX 内联 scale 随画布缩放（CV-283，与演示
 * --chrome-scale 同式），位置由 canvas-view.ts 的 nodeActionAnchor 算出。
 *
 * 层叠 8：高于节点（节点在 .csCanvasLayer 内，z-index 自成一档），低于图层面板
 * （10）与参考托盘（20）—— 后两者是常驻工具，不该被一条临时工具条盖住。
 *
 * **刻意不玻璃**：它只有两三个短词，要的是最大笔画对比；详情与图层那两块浮层才玻璃
 * （Q3 拍板），所以这里走 --cs-float 实底，不是「忘了加 backdrop-filter」。
 */
.csNodeActionBar {
  position: absolute;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-float, var(--dsw-alias-bg-base));
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  animation: csYieldPop var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
  /* 恒在节点上方（翻到下方的 placement 已随拍板移除）⇒ 原点在下缘：
     「从节点上边缘抽出来」的读法；scale 由 JSX 内联（--chrome-scale 同式），
     translate -50% 按 anchor.x（节点中心）水平居中 —— 两者是独立属性，与入场
     动画的 transform 槽位互不覆盖。 */
  transform-origin: bottom center;
  translate: -50% 0;
}

@media (prefers-reduced-motion: reduce) {
  .csNodeActionBar {
    animation: none;
  }
}

.csNodeActionBarBtn {
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1;
  white-space: nowrap;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csNodeActionBarBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* ---- 提示词编辑器（三档：就地 / 展开 / 聚焦） ---- */
.csPrompt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.csPromptHead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.csPromptLabel {
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-tertiary);
}

.csPromptCount {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.csPromptTools {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

/* 一档（只读态）：**完整可读的文本区**，不是被截断的一行。
   「详情里的一些操作观看起来不方便」有一半就来自这里 —— 从前提示词挤在标签后约
   180px 的单行里，还得靠 break-all 硬折。 */
.csPromptText {
  margin: 0;
  max-height: 160px;
  overflow-y: auto;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent);
  font-size: 12px;
  line-height: 1.6;
  /* 按**词**断行（overflow-wrap 而不是 word-break:break-all）：提示词是中英混排的
     长句，break-all 会把英文单词从中间劈开，读起来比溢出更难认。 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
  cursor: text;
}

.csPromptText:hover {
  border-color: var(--dsw-alias-border-l2);
}

.csPromptArea {
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  resize: vertical;
  box-sizing: border-box;
}

/* 一档（编辑态）：自增高 —— 高度由 JS 按 scrollHeight 写回，不出现内部滚动条
   （自增高 + 内部滚动条会互相打架：滚动条吃掉宽度，宽度变了又要重新折行）。 */
.csPromptAreaAuto {
  min-height: 64px;
  /* REQ-003 D1：就地档自增高的上限（建议值，真机按「改一个词要不要滚屏」调参）。 */
  max-height: 260px;
  overflow-y: auto;
  resize: none;
}

/* 二档：占满右栏，给足行数 —— 重写一段时不必与滚动条搏斗。
   REQ-003 D2：展开高度有上限（先夹高度 → 再测量 → 再定位），超出内部滚动，
   上下缘渐隐提示「还有内容」（长提示词不再「长出面」）。 */
.csPromptAreaFill {
  flex: 1 1 auto;
  min-height: 180px;
  max-height: min(56vh, 520px);
  overflow-y: auto;
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
}

.csPromptFoot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.csPromptHint {
  margin: 0;
  flex: 1 1 auto;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* 三档：居中大窗。左「已保存基准」/ 右「编辑」并排 —— 大改时最缺的是
   「原来写的是什么」，而不是更大的空白。 */
.csPromptFocusBackdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 40%);
}

.csPromptFocus {
  width: min(1040px, 100%);
  height: min(640px, 100%);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-float, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  overflow: hidden;
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}

@media (prefers-reduced-motion: reduce) {
  .csPromptFocus {
    animation: none;
  }
}

.csPromptFocusHead {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csPromptFocusTitle {
  font-size: 13px;
  font-weight: 600;
  flex: 0 0 auto;
}

.csPromptFocusBody {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding: 12px 14px;
}

.csPromptFocusPane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
}

.csPromptFocusPaneTitle {
  margin: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}

.csPromptTextBench {
  flex: 1 1 auto;
  max-height: none;
}

.csPromptAreaBench {
  flex: 1 1 auto;
}

.csPromptFocusFoot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Node context menu ---- */
/* DD-08 / R2：菜单底色改用**浮层档**（--cs-float，DD-02 定义的四层空间之一）——
   此前写宿主 bg-base，与左栏壳色是同一支的两条写法，菜单贴在左栏上时读不出边界。
   同时加高度上限：项目行的菜单要列出全部「移动到分组」选项，分组一多就会顶出
   窗口底部，而 position: fixed 的菜单不会被父级裁住、只会溢出屏幕外。 */
.csContextMenu {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  max-height: min(60vh, 420px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--cs-space-1, 4px);
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  /* 投影用宿主的浮层档（分轨）：插件自有的 --cs-shadow-* 是暗色优化的，
     浅色下 0.45 的黑影会明显偏重。 */
  box-shadow: var(--dsw-shadow-lv3);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* 菜单项改成 flex 两端对齐：项目行的菜单要在右侧标出「当前所在分组」（✓），
   纯文本排布的菜单项没法表达「这一项就是当前值」。节点的右键菜单只有单段文字，
   space-between 对单段无害。 */
.csMenuAction {
  font: inherit;
  font-size: var(--cs-fs-sm, 12px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cs-space-3, 12px);
  text-align: left;
  padding: 6px 10px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csMenuAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csMenuAction:disabled {
  opacity: 0.4;
  cursor: default;
}

.csMenuActionDanger {
  color: var(--dsw-alias-state-error-primary);
}

.csMenuActionDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* DD-08 / R2：菜单内的分区标题（「移动到分组」这一组选项的名字）。 */
.csMenuLabel {
  padding: 6px 10px 2px;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}

/* 当前值的那一项：accent 着色 + 右侧勾选，与「可以点过去的其它项」区分开。 */
.csMenuActionActive {
  color: var(--cs-accent, #6c5ce7);
  font-weight: 600;
}

.csMenuActionMark {
  flex: 0 0 auto;
  color: var(--cs-accent, #6c5ce7);
}

/* CV-016：空白处右键菜单（复用 csContextMenu 骨架，仅调宽度）。 */
.csBlankMenu {
  min-width: 140px;
}

/* CV-015：非阻塞 toast（底部居中，逐条堆叠）。 */
.csToasts {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: min(480px, calc(100vw - 48px));
}

.csToast {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-line;
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
  /* DD-05：入场动效接动效令牌（行进语义 csToastIn，白名单已归位）。 */
  animation: csToastIn var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csToast-success { border-color: var(--dsw-alias-state-success-primary, var(--dsw-alias-border-l2)); }
.csToast-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }

@keyframes csToastIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- Reference tray (floating overlay on the canvas, not the project list) ---- */
.csReferenceFloat {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 20;
  width: 260px;
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}
.csReferenceTray {
  margin: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}

/* CV-011：参考托盘空态引导卡片。 */
.csReferenceEmpty {
  margin: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}

.csReferenceEmptyTitle {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csReferenceEmptyHint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.csReferenceHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}
.csReferenceToggle {
  font-size: 16px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
}
.csReferenceList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.csReferenceItem {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.csReferenceThumb {
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
  background: #e9e9e9;
}
.csReferenceMeta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.csReferenceTitleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.csReferenceTitle {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csReferenceChip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.csReferenceRange {
  width: 100%;
}
.csReferenceActions {
  display: flex;
  gap: 6px;
}
.csReferenceButton {
  flex: 1 1 auto;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csReferenceButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Detail panel reference section ---- */
.csDetailSelect {
  flex: 1 1 auto;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Canvas toolbar settings button (opens the settings popup) ---- */
.csToolbarGroupEnd {
  margin-left: auto;
}

/* CV-059：右侧图标组按钮（整理布局 / 图层 / 小地图）。 */
.csToolbarIconButton {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}
.csToolbarIconButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
/* 开关态（图层 / 小地图展开时高亮，等价于原「隐藏图层」文案语义）。 */
.csToolbarIconActive {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
}

.csToolbarSettings {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}

.csToolbarSettings:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Settings popup (DeepSeek Harness style: nav rail + content column) ---- */
.csSettingsBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}

.csSettingsModal {
  width: 800px;
  height: min(800px, calc(100vh - 48px));
  max-width: calc(100vw - 48px);
  display: flex;
  border-radius: 24px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv3);
}

/* ---- General modal backdrop (used by create project, video player, image preview) ---- */
.csModalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 40%);
}

.csModal {
  width: min(440px, 100%);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
  overflow: hidden;
}

/* ---- Nav rail (left sidebar) ---- */
.csNav {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 188px;
  padding: 22px 12px 0;
  box-sizing: border-box;
}

.csNavTitle {
  padding: 0 12px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.csNavList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csNavCell {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 9px 16px 9px 12px;
  box-sizing: border-box;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}

.csNavCell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csNavCellActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csNavLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---- Content column (right side) ---- */
.csContent {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.csContentHeader {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  height: 54px;
  padding: 20px 14px 8px 10px;
  box-sizing: border-box;
}

.csContentActions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.csClose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 28px;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
}

.csClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csCloseIcon {
  font-size: 18px;
  line-height: 1;
}

.csContentOptions {
  flex: 1;
  min-height: 0;
  padding: 0 24px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- 弹窗标题栏（视频 / 音频 / 图片三个播放弹窗共用） ----
 *
 * 这两个类**一度被写成 display: none**（提交 df8ad3b2b5「设置页扩展 + 资产库
 * 位置选择」把它们当「legacy 类名」关掉了）。它们不是 legacy：三个播放弹窗都在
 * 用（VideoPlayerModal / AudioPlayerModal / ImagePreviewModal 各自的
 * <header className="csModalHeader"> + × csModalClose），而
 * VideoPlayerModal.tsx 的 max-height: calc(100vh - 140px) 注释还明写
 * 「扣除标题栏(49)」—— 那 49px 一直在被预留、却从来没有画出来。结果是三个弹窗
 * 既没有标题（用户不知道自己在看哪条片、几分钟、多大分辨率），也没有关闭按钮
 * （只能点遮罩关）。CV-092 的新建项目对话框当时确实不想要标题栏，但它的做法是
 * **共用一个全局类名再把它关掉**，于是连带关掉了别人 —— 这类「关全局」的写法
 * 在只有一处消费方时看不出问题，等到第二处出现就已经错了。
 *
 * CV-182 把两者分开：这里恢复播放弹窗的标题栏；当时的新建项目对话框改用一组
 * 自有类（视觉同源、类名独立）。REQ-005 / CV-256 起那组类随弹窗一并删除，这段
 * 只留下教训本身 —— **别再为了一个消费方去关全局类**。 */
.csModalHeader {
  display: flex;
  align-items: flex-start;
  gap: var(--cs-space-3, 12px);
  flex: 0 0 auto;
  padding: 13px var(--cs-space-4, 16px) 12px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
}

.csModalHeader h2 {
  margin: 0;
  font-size: var(--cs-fs-lg, 14px);
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
}

.csModalHeaderText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.csModalHeaderMeta {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csModalHeaderMetaSep {
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.6;
}

/* 关闭按钮：28px 方、圆角与字段盒同档，hover 才出面。
   字号走 18px 而不是 bigger —— 「×」在小盒里靠字形本身居中，不需要额外行高。 */
.csModalClose {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.csModalClose:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csModalClose:disabled {
  opacity: 0.5;
  cursor: default;
}

.csModalBody {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px var(--cs-space-4, 16px);
  overflow-y: auto;
}

.csField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.csFieldLabel {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.csFieldInput {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csFieldInput:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

.csFieldRow {
  display: flex;
  gap: 8px;
}

.csFieldRow .csFieldInput {
  flex: 1 1 auto;
  min-width: 0;
}

.csFieldButton {
  font: inherit;
  font-size: 13px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csFieldButton:disabled {
  opacity: 0.5;
  cursor: default;
}

.csFieldError {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
}

/* ---- Theme option chips (主题分区) ---- */
.csThemeOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csThemeOption {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csThemeOption:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csThemeOptionActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

/* ---- Inline hint text under a settings field ---- */
.csFieldHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Select control (输出/工作流分区) ---- */
.csFieldSelect {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldSelect:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

/* ==================== REQ-028：首页规格选择器 v2 的弹出框材料 ====================
 *
 * 原「新建规格材料」（CV-182 chip 组 .csChoiceRow / .csChoice* 与 .csCreateNote）
 * 随 REQ-028 输入框 v2 整体退役：规格选择从「一行 chips 摊开」改为「chip 触发器 +
 * 悬浮气泡弹出框」（演示形态），材料全部迁往下方 REQ-028 区段。D4 入口唯一纪律
 * 不变 —— 旧壳删除而不是留规则等人复活（「有规则无消费者」= 死样式）。
 *
 * 作用域纪律不变：.csFieldLabel / .csFieldInput / .csFieldSelect 与设置弹窗共用，
 * 观感调整一律挂在自有类下，不下沉到共享类（CV-181「删全局类连累别人」的教训）。 */

/* CV-196：单决策确认弹窗（切到放手跑）。复用整套模态词汇，只调两处 ——
   ① 宽度收窄：一条决策撑满 440px 会显得空，视线在标题与按钮之间来回跑；
   ② 正文节奏压紧：两段话是「会发生什么」的连续陈述，18px 间距会把它们读成两件事。
   确认按钮不涂红（走 --cs-accent）：它不是破坏性动作，红色会误导成「删除」。 */
.csConfirmModal {
  width: min(400px, 100%);
}

.csConfirmBody {
  gap: 10px;
  font-size: var(--cs-fs-md, 13px);
  line-height: 20px;
}

/* 弹窗底部操作区（取消 / 创建）。 */
/* 弹窗底部操作区（取消 / 创建）。底色比正文低一档（壳层第二档）——
   底部动作与表单内容分开，靠的不只是那根 1px 分隔线。 */
.csModalFooter {
  display: flex;
  justify-content: flex-end;
  gap: var(--cs-space-2, 8px);
  flex: 0 0 auto;
  padding: 12px var(--cs-space-4, 16px);
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: var(--cs-shell-2, transparent);
}

.csModalBtnSecondary {
  font: inherit;
  font-size: var(--cs-fs-md, 13px);
  padding: 7px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csModalBtnSecondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModalBtnSecondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.csModalBtnPrimary {
  font: inherit;
  font-size: var(--cs-fs-md, 13px);
  font-weight: 500;
  padding: 7px 20px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid transparent;
  background: var(--cs-accent, #5b4bd6);
  color: #fff;
  cursor: pointer;
  transition: filter var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

/* hover 加一圈 accent-soft 环而不是只提亮：主按钮是这张表的落点，
   提亮在浅色下几乎看不出，环能把它从底色里托起来。 */
.csModalBtnPrimary:hover:not(:disabled) {
  filter: brightness(1.12);
  box-shadow: 0 0 0 3px var(--cs-accent-soft, transparent);
}

.csModalBtnPrimary:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ---- Toggle row (checkbox + label, 工作流/存储分区) ---- */
.csToggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csToggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-interactive-bg-active);
  cursor: pointer;
}

/* ---- "待接入" 标记：字段已落 schema 但当前管线尚未消费 ---- */
.csReserved {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  vertical-align: middle;
}

/* ---- Model settings panel (provider-aware, complete) ---- */
.csModelPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.csModelDefault {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csModelProviders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.csModelCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csModelCardHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csModelCardTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.csModelBadge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.csModelBadgeOn {
  background: var(--dsw-alias-state-success-bg, var(--dsw-alias-interactive-bg-active));
  color: var(--dsw-alias-label-primary);
}

.csModelDiscovered {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csModelDiscoveredList {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  max-height: 140px;
  overflow-y: auto;
}

.csModelCardActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csModelPrimary {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csModelDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.csModelDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModelCustom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 精简模式：未使用官方 provider 的折叠开关条 */
.csModelFold {
  display: flex;
  margin: 8px 0;
}

.csModelFoldToggle {
  width: 100%;
  justify-content: center;
  border-style: dashed;
}

.csModelCustomForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

/* ---- CV-044：视频 / 图片全尺寸预览浮层 ---- */
/* 撑大至接近应用窗口尺寸（max-width 1280 / calc(100vw - 48px)）；视频以真实比例渲染，
   按容器 max-* 自动钳制并保持宽高比，stage 黑底衬出任意比例的 letterbox/pillarbox。 */
.csVideoModalCard {
  width: auto;
  max-width: min(1280px, calc(100vw - 48px));
}
/* CV-044：浮层播放器不挂原生控件（避免原生「双击=全屏」），改点击画面切换
   播放/暂停；stage 相对定位承载居中播放图标。
   高度自适应：卡片沿用 .csModal 的 max-height + overflow:hidden；stage 作为
   唯一可收缩项（min-height:0 让开 flex 自动最小高），把剩余高度让给标题栏
   和控制条。竖屏（高度受限）视频不会把控制条顶出卡片外。 */
.csVideoStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  cursor: pointer;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* A-11（2026-10-03）：stage 必须有**确定高度**——此前卡片高度由内容决定，
     视频 max-height:100% 对 auto 高度父容器解析为 none → 视频按内在尺寸
     渲染，被卡片 overflow:hidden 裁掉上下（竖屏/矮窗口必现）。定高后百分比
     恢复解析：横屏 16:9 恰好铺满，竖屏/更矮比例在黑底内 contain（两侧留黑边）。
     200px ≈ 标题栏 + 控制条 + 背景边距，卡片总高仍落在 .csModal 的 max-height 内。 */
  height: min(calc(100vh - 200px), 56.25vw);
}
.csVideoModalVideo {
  display: block;
  /* 相对 stage 而非 100vh：百分比在 flex 定高后解析，横竖屏共用一条规则。 */
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  background: #000;
}
.csVideoPlayIcon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: rgb(255 255 255 / 85%);
  text-shadow: 0 4px 16px rgb(0 0 0 / 60%);
  pointer-events: none;
}

/* ---- CV-057：视频浮层自绘控制条 ---- */
/* flex:0 0 auto 对齐标题栏：空间不足时只压缩 stage，控制条永不被挤掉。 */
.csVideoControls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csVideoControlButton {
  display: grid;
  place-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.csVideoControlButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.csVideoTime {
  min-width: 44px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  user-select: none;
}
/* 进度条：轨道 + 已播填充；pointer capture 拖动 seek。 */
.csVideoProgress {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3);
  cursor: pointer;
  touch-action: none;
}
.csVideoProgressFill {
  height: 100%;
  border-radius: 3px;
  background: var(--dsw-alias-brand, #4f7cff);
  pointer-events: none;
}
.csVideoVolume {
  width: 72px;
  accent-color: var(--dsw-alias-brand, #4f7cff);
}

/* CV-044 扩展：图片大图预览浮层（与视频浮层同尺寸规则，黑底衬托图片）。 */
.csImagePreviewStage {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  min-height: 240px;
}
.csImagePreviewImg {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 49px);
  width: auto;
  height: auto;
  object-fit: contain;
}

/* 媒体预览（视频 / 图片）加深背景遮罩，与参考 #1 的暗化预览观感一致；不挂在
   .csModalBackdrop 上以免影响 Settings/SkillMarket 等普通弹窗。 */
.csMediaPreviewBackdrop {
  background: rgb(0 0 0 / 78%);
}

/* ===== CV-130：音频播放器窗口（双击音频节点打开） ===== */

/* 卡片宽 560，高度受自适应（歌词多时内部滚动，窗口本身不无限长）。 */
.csAudioModalCard {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
}

/* 舞台：音频没有画面，让位给歌词 / 波形。固定高度让「有词/无词」两种形态
   尺寸一致，切换节点时不跳。 */
.csAudioStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  max-height: calc(100vh - 260px);
  padding: 20px 24px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  overflow: hidden;
}

/* 纯器乐：波形（进度按条数点亮，与卡片同一套语义）。 */
.csAudioStageWave {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 140px;
}

.csAudioStageBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

/* 有歌词：逐行铺开，长词可滚动（overflow-y auto + overscroll 阻断）。 */
.csAudioStageLyrics {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  text-align: center;
  cursor: text;
}

.csAudioLyricLine {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--dsw-alias-label-primary);
}

/* 结构标记（[Verse] / [Chorus - anthemic]）：弱化成小号灰字，不当正文读。 */
.csAudioLyricMarker {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}

/* 空行分隔（段落边界）：保留高度，让歌词段落感不丢。 */
.csAudioLyricGap {
  display: block;
  height: 8px;
}

/* 详情面板里的歌词全文（复用 csDetailPrompt 排版，额外给最大高度避免刷屏）。 */
.csDetailLyrics {
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* ===== 品牌层（--cs-* 令牌由 src/brand.ts 注入，见 brand-inject.ts；叠加 --dsw-alias-*） ===== */

/* 左侧栏品牌条：场记板 logo + Canvas Studio（创意工厂）。
   DD-08 / R8：品牌条即栏头 —— 收起左栏的按钮挂在它右侧（整栏显隐的控制必须常驻，
   不能随列表滚动）。 */
.csBrandHeader {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: var(--cs-space-3, 12px) var(--cs-space-3, 12px) 10px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
}
/* REQ-005 / CV-256：栏头品牌半边 = 「回首页」按钮。
   与 .csBrandMeta 同一条 flex 布局（吃掉剩余宽度、把收起按钮推到最右），
   所以本体只做去默认样式 + 保住 gap；hover 与同栏其它图标按钮同款。 */
.csBrandHome {
  font: inherit;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  min-width: 0;
  padding: 2px;
  margin-left: -2px;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.csBrandHome:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}
/* 收起按钮：与段头「＋」同族的图标按钮，但独立常驻。 */
.csBrandCollapse {
  font: inherit;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}
.csBrandCollapse:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}
/* DD-09 / b：右栏收起按钮 —— 与 .csBrandCollapse 同族同尺寸，位置左右对称
 * （左栏的贴在栏头右端 = 靠画布；右栏的贴在左上角 = 同样靠画布）。
 *
 * 为什么绝对定位，而不是自造一条右栏栏头：右栏顶部是宿主 conversation 自己的
 * 头部（CSS Modules，hash 类名选不中、也不该去改）。塞进宿主头部就是改 dsh、破坏
 * 无缝升级；自造栏头会让右栏顶上多出一条带子、与宿主头部叠成「双层头」。
 * 绝对定位的插件自有元素是唯一既不动宿主、也不挤压宿主布局的落点。
 * 默认低存在感（宿主头部左上角可能有它自己的内容），hover 才实底。 */
.csChatCollapse {
  font: inherit;
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0.55;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              opacity var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}
.csChatCollapse:hover,
.csChatCollapse:focus-visible {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
  opacity: 1;
}

/* DD-09 / b：收起态的缩略条容器。两段竖列 —— 展开按钮（点回对话区）→ 六段轨道
   竖排点。56px 轨道宽 = 40px 控件 + 两侧各 8px 呼吸，与 .csRailStrip 同口径，
   这样左右两条窄轨在视觉上是同一件事的两个方向。 */
.csChatStrip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--cs-space-2, 8px) 0;
}

.csChatStripExpand {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
              color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}
.csChatStripExpand:hover {
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

/* 六段轨道竖排点：与审批条同一套阶段语义（数据同源，不新增模型），只是从横向
   转向纵向。已过段弱亮、当前段 accent + 光晕 —— 与轨道上「当前段脉冲」的用语
   一致（这里不加动画：常驻 56px 的小点上持续脉冲是噪音，且收起态本就该安静）。 */
.csChatStripStages {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: var(--cs-space-1, 4px) 0;
}
.csChatStripDot {
  width: 6px;
  height: 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-line, var(--dsw-alias-border-l2));
}
.csChatStripDotDone {
  /* 不写 fallback：--cs-line-hi 在 brand.ts 有定义，而兜底值若引一个渲染台清单外
     的宿主令牌，每次生成预览都会多一条「宿主令牌缺失」噪音警告（实测报过
     --dsw-alias-border-l1），把真正的问题淹掉。 */
  background: var(--cs-line-hi);
}
.csChatStripDotNow {
  background: var(--cs-accent, #5b4bd6);
  box-shadow: 0 0 0 3px var(--cs-accent-soft, transparent);
}
/* DD-09 / c：制作阶段胶囊（CV-179 起从会话头撤到输入区读数带右端）。
   容器都自带 flex / gap，所以这里**不写**外边距与定位，只做胶囊本体；未选项目时
   父组件整个不渲染。撤出会话头的原因见 index.ts 该注册处的注释 —— 它占的 133px
   把宿主的会话标题挤到只剩三个字，而压窄胶囊救不回来。
   材料全部复用既有令牌（零新增），底色走 --cs-shell-2、描边走 --cs-line ——
   浅色下最容易出的问题是「拿暗色的底硬套」，这两条都随主题。 */
.csStageChip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 22px;
  /* 显式 border-box：默认 content-box 下 height 是**内容**高，上下各 1px 描边会把
     实测高度撑成 24px —— 渲染台第一次跑就抓到了（与节点卡那次「被撑高 4px」同源）。 */
  box-sizing: border-box;
  padding: 0 var(--cs-space-2, 8px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1;
  white-space: nowrap;
  /* 会话头里的读数不是可选文本：拖选会把宿主头部的碎片一起带出来。 */
  user-select: none;
}
.csStageChipDot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-accent, #5b4bd6);
}
.csStageChipLabel {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
/* 进度走等宽数字：2/6 → 3/6 时胶囊宽度不跳。 */
.csStageChipProgress {
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
/* 模式与进度之间用一道细线分区。不用 ::before 分隔符是刻意的 —— 那会多一个
   参与 flex 计算的盒子，间距要再对一次账。 */
.csStageChipMode {
  padding-left: 6px;
  border-left: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  color: var(--dsw-alias-label-tertiary);
}
/* 待拍板：整条换成 gold —— 这是唯一需要打断用户的状态。 与审批条 / 阶段点同一套
   语言（gold = 等你），不新造语义。 */
.csStageChipPending {
  border-color: color-mix(in srgb, var(--cs-gold, #e8b45a) 45%, transparent);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 12%, var(--cs-shell-2, var(--dsw-alias-bg-layer-1)));
}
.csStageChipPending .csStageChipDot {
  background: var(--cs-gold, #e8b45a);
}
.csStageChipPending .csStageChipLabel {
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 75%, var(--dsw-alias-label-primary));
}

/* CV-254：画布「镜 N」chip —— 借 .csStageChip 的圆角 / border-box 语言，琥珀语义
   （镜位 = 琥珀，与 storyboard 血缘边同源）；位于 .csCanvasLayer 内跟随画布缩放，
   画布高恒 22px ≤ 框头 SHOT_BOX_HEAD=28，任意缩放都不压分镜卡文字。定位 left/top
   用画布坐标（inline style），视觉全走本类。 */
.csShotChip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  box-sizing: border-box;
  border-radius: 999px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--cs-gold, #e8b45a) 50%, transparent);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 82%, var(--dsw-alias-label-primary));
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  user-select: none;
}
/* 输入卡片**上方**的「刚拖入 / 上传中的视频」条（2026-09-22）。

   形态向宿主的图片附件 rail 看齐（缩略图 + 文件名 + 状态 + 移除）—— 宿主的附件通道
   只收图片（mediaTypes 固定 png/jpeg/webp/gif），视频进不去，故自绘一条；首帧交给
   <video preload="metadata"> 由浏览器画，不抽帧、不等远端。

   盒子几何与下面的 .csContextBar **同源**（同 max-width / 同侧边距）：两条读数一上
   一下，宽度不齐会显得散。颜色全部取宿主 label-* 与 state-* 语义令牌，明暗两轨
   自动跟随，不需要分叉。 */
.csUploadBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-chat-content-width, 748px);
  margin: 0 auto;
  padding: 4px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 0;
}

.csUploadChip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 280px;
  padding: 5px 6px 5px 5px;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-md, 8px);
  background-color: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csUploadChipArt {
  flex: none;
  display: block;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border-radius: var(--cs-radius-sm, 6px);
  /* 首帧画出来之前不闪白：垫画布最深一档。 */
  background-color: var(--cs-canvas-bg, var(--dsw-alias-bg-layer-2));
}

.csUploadChipVideo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 缩略图不参与交互：整条 chip 的点击语义只留给移除按钮。 */
  pointer-events: none;
}

/* audio/text 的图位：扩展名徽标（CV-247）—— 没有可视帧，给徽标而不是伪造缩略图。 */
.csUploadChipExt {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary));
  /* 与 video 首帧同一纪律：不参与交互。 */
  pointer-events: none;
}

.csUploadChipText {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.csUploadChipName {
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csUploadChipMeta {
  overflow: hidden;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态只改读数颜色、不改盒子尺寸 —— 否则三种状态切换时行高会跳。 */
.csUploadChip.is-ready .csUploadChipMeta { color: var(--dsw-alias-state-success-primary); }
.csUploadChip.is-failed .csUploadChipMeta { color: var(--dsw-alias-state-error-primary); }

.csUploadChipClose {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--cs-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.csUploadChipClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* DD-09 / d（CV-179 升级为「场记板横条」）：输入卡片下方的项目上下文条。
   它与宿主自带的 stats 行同住 conversation.composer.dock，所以**盒子几何刻意
   1:1 镜像**那条行（同宽列、同内边距、同 12px/20px 行高、同样居中）—— 两条读数
   上下叠着，一条居中一条左对齐就会显得散。宿主那一份是 CSS Modules（hash 类名，
   插件选不中也改不了），故这里按 ui-conversation 的 StatsLine.module.css 抄同样的
   量级；宽度与边距走宿主在 ConversationRoot 根上声明的 --dsh-chat-content-width /
   --dsh-composer-side-clearance（自定义属性会继承下来），拿不到时退回同值字面量。
   内部排布从 block+居中改成 flex+居中：**盒子没变**（等宽同轴是契约），变的是行的
   构成方式 —— 立柱 / 名字 / 规格 / 阶段胶囊四类元素，只有 flex 才能让胶囊不被挤扁。
   代价是老约束换了个承担者：原来靠容器的 block + text-overflow 出省略号，现在由
   .csContextBarName 自己带（见下）。
   明暗两轨不需要分叉：颜色全部取宿主 label-* 语义令牌，随主题自动跟随。 */
.csContextBar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-chat-content-width, 748px);
  margin: 0 auto;
  padding: 4px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  /* 读数是不可选文本：拖选会把宿主输入区里的碎片一起带出来。 */
  user-select: none;
}
/* 场记板立柱：名字前那根 2×12 的 accent 竖线。用伪元素而不是真元素 —— 它是纯装饰，
   不该进无障碍树，也不该多一个 DOM 让「没项目时一个节点都不出」的判定变复杂。
   高取 12px（名字的字面高）而不是行高 20px：压满行高会与右侧胶囊打架。 */
.csContextBar::before {
  content: '';
  flex: 0 0 auto;
  width: 2px;
  height: 12px;
  border-radius: 1px;
  background: var(--cs-accent, #5b4bd6);
}
/* 项目名是这条读数的主语，比规格强一档（一级色 + 半粗 + 大一档字阶）。一行里只有
   一个强项 —— 规格与建议镜头数保持与 stats 同级的三级色。
   省略号契约搬到这里：flex 子项默认 min-width:auto **不会缩**，必须显式给 0 才收得
   起省略号，否则长项目名会把整条撑破（外层再 overflow:hidden 也只是硬切）。 */
.csContextBarName {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
}
.csContextBarSpec {
  /* 规格是不许被挤扁的读数：挤成「16:9 · 7…」等于把信息废掉。 */
  flex: 0 0 auto;
  white-space: nowrap;
  /* 等宽数字：换项目 / 换时长时数位对齐，整行不跳（与胶囊进度同一条理由）。 */
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}
/* 分隔符不引宿主的 separator 令牌：它在桌面主题里由宿主运行时供给，本仓（含渲染台）
   查不到定义值，写进来会造出一个「渲染台解析不出、桌面上才生效」的分叉。直接在当前
   颜色上降一档透明度 —— 与 stats 行分隔的观感一致，且零新依赖。
   间距交给容器 gap（两侧各 10px），这里不再自带 margin。 */
.csContextBarSep {
  flex: 0 0 auto;
  opacity: 0.45;
}
.csLogoMark {
  display: block;
  flex: 0 0 auto;
}
.csBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  /* DD-08 / R8：吃掉剩余宽度，把收起按钮推到栏头最右。 */
  flex: 1 1 auto;
}
.csBrandName {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csBrandSub {
  font-size: 11px;
  color: var(--cs-accent, var(--dsw-alias-label-tertiary));
}

/* CV-064：Lobby 态中栏顶部品牌条（横向紧凑版，与下方居中的聊天卡片配套）。
   与画布区空态分开：整屏欢迎卡会把聊天挤出视口。 */
.csLobbyHero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cs-space-5, 24px);
  padding: var(--cs-space-5, 24px) var(--cs-space-6, 32px) var(--cs-space-4, 16px);
  /* C7「未开拍的现场」（DD-06）：lobby 态画布隐藏，hero 就是首屏主体 ——
     直接借用画布的制图台语言：L1 底色（**自然消费 --cs-canvas-bg-l1**，
     D3 空转令牌就此退役）+ 与 .csCanvasSurface 同参数的双层点阵（120 主格 /
     24 细格）+ 一束自顶洒下的低透明度 accent 光晕。层序：光晕最上、主格、细格，
     光落在点阵上而不是点阵压住光。 */
  background-color: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base));
  background-image:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 100% 100%, 120px 120px, 24px 24px;
  background-position: 0 0, 0 0, 0 0;
  background-repeat: no-repeat, repeat, repeat;
}
.csLobbyBrand {
  display: flex;
  align-items: center;
  gap: var(--cs-space-4, 16px);
  min-width: 0;
}
.csLobbyBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.csLobbyTitle {
  margin: 0;
  font-size: var(--cs-fs-xl, 18px);
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csLobbyNameZh {
  margin-left: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-md, 13px);
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyTagline {
  margin: 0;
  font-size: var(--cs-fs-sm, 12px);
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyActions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--cs-space-2, 8px);
}
.csLobbyButtons {
  display: flex;
  gap: var(--cs-space-3, 12px);
}
.csLobbyActions button {
  padding: 7px var(--cs-space-4, 16px);
  font-size: var(--cs-fs-md, 13px);
  border-radius: var(--cs-radius-md, 8px);
  cursor: pointer;
}
/* REQ-005 / CV-256：原来的「+ 新建项目」主按钮（.csPrimary 面）随入口一起删掉了，
   留着这条规则就是「有规则无消费者」。仍然存在的主按钮面只有
   .csWorkflowApproval button.csPrimary（批准 / 确认关键帧）。 */
/* 类名里的 Welcome 是历史来源（原属已删的整屏欢迎卡），唯一消费方是 LobbyHero.tsx。 */
.csLobbyActions .csWelcomeSample {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.csLobbyActions .csWelcomeSample:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csLobbyActions .csWelcomeSample:disabled {
  opacity: 0.55;
  cursor: default;
}
/* 「示例项目」按钮与其短说明（.csLobbySampleHint）暂时隐藏 —— 规则一并删除，
   留着就是「有规则无消费者」（CV-181 同款账）。入口改成空态引导时再回来。 */

/* ==================== REQ-028：首页输入框 v2 ====================
 *
 * 演示（docs/assets/library-2026-10-06/video-agent-inputbox.html）的三块材料：
 * ① dock 行的「参考内容」方框 + 缩略图排队（LobbyStashBar）；② 卡片工具行内的
 * 「chip 触发器 + 悬浮气泡弹出框」（LobbySpecChips / LobbyModeChip，挂宿主
 * input.left / input.right 槽）；③ 宿主发送钮在 lobby 态重塑为「开始创作」药丸。
 *
 * 材料纪律（沿 C7/DD-01）：色值全部走令牌或由令牌 color-mix 派生，hover 面统一
 * 用宿主的 --dsw-alias-interactive-bg-hover（明暗两轨的对比度由宿主保证）；
 * 字号走 --cs-fs-*。演示里的具体色值不照抄 —— 那是单主题评估页，写死会在
 * 浅色主题 / 换预设时消失（DD-01 幽灵令牌同款事故）。 */

/* ---- 卡内参考内容条（LobbyStashBar，动态接管 conversation.input.attachments） ----
 *
 * 渲染点是宿主卡的直接子元素（SlotOutlet 是 display:contents，卡片本身是
 * flex column + 12px gap）：横向 16px 对齐 textarea 的文字缘（宿主 .input 的
 * 左内边距），竖向间距交给卡片的 gap —— 条读作「卡片的第 0 行」，即演示的
 * attach 条位置。接管与退位的机制见 index.ts 的动态桥注释。 */
.csLobbyAttach {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 16px;
}

/* 缩略图外盒（58×58，与 ＋ 方框同高 —— 加素材不跳高度，演示规格注记原文）。
   只做定位上下文：悬停预览浮层（.csLobbyThumbPeek）是它的子元素，若外盒自己
   overflow hidden，浮层会被 58px 的裁切盒整个吞掉 —— 裁切交给内层 clip。 */
.csLobbyThumb {
  position: relative;
  flex: 0 0 auto;
  width: 58px;
  height: 58px;
  box-sizing: border-box;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: 12px;
  background: var(--cs-node, var(--dsw-alias-bg-layer-1));
}

/* 内层裁切盒：58px 画面的圆角裁切（inherit 拿外盒同一半径）。 */
.csLobbyThumbClip {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
}

/* 悬停预览浮层（图片 / 视频）：缩略图**上方**展开放大预览（验收拍板：往下
   会压住正在输入的正文，往上盖住的是 hero 引导区且鼠标离开即消失）。宿主卡
   自身无 overflow（裁切只发生在卡内 .scroll/.backdrop），浮层向上越出卡片是
   允许的；pointer-events none：不挡交互、不产生 hover 抖动；visibility 随
   opacity 一起过渡（隐藏态不接住悬停链）。 */
.csLobbyThumbPeek {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 240px;
  height: 160px;
  box-sizing: border-box;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  box-shadow: var(--cs-shadow-3, none);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transform: translateY(4px);
  transition: opacity var(--cs-duration-fast, 120ms) ease,
    transform var(--cs-duration-fast, 120ms) ease,
    visibility var(--cs-duration-fast, 120ms) ease;
  pointer-events: none;
  z-index: 30;
}

.csLobbyThumb:hover .csLobbyThumbPeek {
  opacity: 1;
  visibility: visible;
  transform: none;
}

.csLobbyThumbPeekMedia {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.csLobbyThumbMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 音频 / 文本的图位：品牌色系对角渐变 + 居中扩展名徽标（演示 .ph 同构，
   色值由 cover 色档同款公式派生）。 */
.csLobbyThumbExt {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary);
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--cs-accent) 26%, var(--cs-shell-2)),
    var(--cs-shell-2, var(--dsw-alias-bg-layer-1)) 55%,
    color-mix(in srgb, var(--cs-gold) 24%, var(--cs-shell-2)));
}

/* 文件名压底条（9px，溢出省略）。 */
.csLobbyThumbFn {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9px;
  line-height: 1.5;
  padding: 2px 4px;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--cs-gate, var(--dsw-alias-bg-base)) 72%, transparent);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* hover 浮出的移除钮（18px 圆；默认透明，悬停显形）。 */
.csLobbyThumbRm {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cs-gate, var(--dsw-alias-bg-base)) 78%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--cs-duration-fast, 120ms) ease;
}

.csLobbyThumb:hover .csLobbyThumbRm {
  opacity: 1;
}

/* 「＋ 参考内容」方框：虚线圆角方框，＋ 居中、文字在 ＋ 下面。外壳整体替换
   （不走 .csLobbyChip 药丸），打开态同步 accent 描边 + 微底色（演示同款）。 */
.csLobbyAttachAdd {
  flex: 0 0 auto;
  width: 58px;
  height: 58px;
  box-sizing: border-box;
  padding: 0;
  border: 1.5px dashed var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color var(--cs-duration-fast, 120ms) ease,
    color var(--cs-duration-fast, 120ms) ease,
    background-color var(--cs-duration-fast, 120ms) ease;
}

.csLobbyAttachAdd:hover {
  border-color: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
}

.csLobbySel[data-open='true'] .csLobbyAttachAdd {
  border-color: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  background: var(--cs-accent-soft, transparent);
}

.csLobbyAttachLb {
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* 隐藏的原生文件选择器（「本地文件」来源项的原生实现；占位为 0 免得在
   flex 行里多出一段间距）。 */
.csLobbyPicker {
  display: none;
}

/* ---- 卡片工具行内的选择器（LobbySpecChips / LobbyModeChip） ---- */

/* 三枚规格 chip 的组（host .tools 的一个 flex 项；组内 7px 同演示 .grp）。 */
.csLobbySpecChips {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

/* 触发器外壳：相对定位（弹出框的包含块）+ 展开态属性锚。 */
.csLobbySel {
  position: relative;
  display: inline-flex;
}

/* 触发 chip（StageChip 家族配方：shell-2 实底 + 无描边 → hover/展开提亮）。 */
.csLobbyChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: var(--cs-fs-sm, 12px);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) ease,
    color var(--cs-duration-fast, 120ms) ease,
    border-color var(--cs-duration-fast, 120ms) ease;
}

.csLobbyChip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* 展开态：触发器同步高亮描边（演示 chip.on）。 */
.csLobbySel[data-open='true'] .csLobbyChip {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csLobbyChipLb {
  font-weight: 500;
}

/* caret：展开时旋转 180°（演示同款）。 */
.csLobbyCaret {
  opacity: 0.7;
  transition: transform var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csLobbySel[data-open='true'] .csLobbyCaret {
  transform: rotate(180deg);
}

/* 执行模式的色点：绿 = 自动执行，琥珀 = 询问执行（--cs-ok / --cs-warn，
   固定功能色，语义读点不随预设换色）。 */
.csLobbyDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cs-ok, var(--dsw-alias-label-primary));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-ok, transparent) 16%, transparent);
  flex: 0 0 auto;
}

.csLobbyChipAsk .csLobbyDot {
  background: var(--cs-warn, var(--dsw-alias-label-primary));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cs-warn, transparent) 16%, transparent);
}

/* 画幅小矩形（chip 内的比例小样，长边 14，按真实比例）。 */
.csLobbyMiniBox {
  display: inline-block;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  opacity: 0.85;
}

/* hover 气泡（「当前：…」；面板展开时自动隐藏）。 */
.csLobbyTip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  white-space: nowrap;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 9px;
  padding: 7px 11px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-primary);
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity var(--cs-duration-fast, 120ms) ease,
    transform var(--cs-duration-fast, 120ms) ease;
  z-index: 36;
}

.csLobbyTip::after {
  content: "";
  position: absolute;
  bottom: -5px;
  left: 16px;
  width: 9px;
  height: 9px;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  border-right: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-bottom: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  transform: rotate(45deg);
}

.csLobbySel:hover .csLobbyTip {
  opacity: 1;
  transform: none;
}

.csLobbySel[data-open='true'] .csLobbyTip {
  opacity: 0;
  transform: translateY(4px);
}

/* 统一弹出框：触发器上方 11px 向上展开；opacity 0→1 + translateY(6px→0)
   150ms；10×10 方块旋转 45° 做小尖角（距左 20px，同底色同描边）。
   data-align="right" 右对齐（右缘的执行模式）；data-expand="below" 向下展开
   （参考内容方框在输入框顶部），尖角翻到上沿。 */
.csLobbyPop {
  position: absolute;
  bottom: calc(100% + 11px);
  left: 0;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 12px);
  padding: 6px;
  box-shadow: var(--cs-shadow-3, none);
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  z-index: 40;
}

.csLobbyPop::after {
  content: "";
  position: absolute;
  bottom: -6px;
  left: 20px;
  width: 10px;
  height: 10px;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  border-right: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-bottom: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  transform: rotate(45deg);
  border-bottom-right-radius: 2px;
}

.csLobbySel[data-open='true'] .csLobbyPop {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.csLobbySel[data-align='right'] .csLobbyPop {
  left: auto;
  right: 0;
}

.csLobbySel[data-align='right'] .csLobbyPop::after {
  left: auto;
  right: 20px;
}

.csLobbySel[data-expand='below'] .csLobbyPop {
  top: calc(100% + 11px);
  bottom: auto;
}

.csLobbySel[data-expand='below'] .csLobbyPop::after {
  top: -6px;
  bottom: auto;
  border: 0;
  border-top: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-left: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 2px 0 0 0;
  transform: rotate(45deg);
}

/* 面板小节标题（10.5px 字距放大写风格）。 */
.csLobbyPopHead {
  margin: 0;
  padding: 7px 9px 5px;
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.6px;
  color: var(--dsw-alias-label-tertiary);
}

/* 统一菜单行：固定 34px 行高 = 左勾 13px + 主文案 + 右 meta；选中态 =
   勾亮起 + 文案提亮 + meta 变琥珀（color-mix 派生，随预设/主题走）。 */
.csLobbyMi {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background-color 120ms ease;
}

.csLobbyMi:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLobbyMiChk {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  opacity: 0;
  transition: opacity 120ms ease;
}

.csLobbyMi[aria-pressed='true'] .csLobbyMiChk {
  opacity: 1;
}

.csLobbyMiLb {
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csLobbyMi[aria-pressed='true'] .csLobbyMiLb {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.csLobbyMiMeta {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  flex: 0 0 auto;
}

.csLobbyMi[aria-pressed='true'] .csLobbyMiMeta {
  color: color-mix(in srgb, var(--cs-accent, transparent) 72%, var(--dsw-alias-label-secondary));
}

.csLobbyDv {
  height: 1px;
  background: var(--cs-line, var(--dsw-alias-border-l2));
  margin: 5px 8px;
}

.csLobbyPopFoot {
  margin: 0;
  padding: 6px 9px 3px;
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

/* 画幅大卡（面板上段两卡；下段走 .csLobbyMi）。 */
.csLobbyRatioGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 0 2px 2px;
}

.csLobbyRatio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 3px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  cursor: pointer;
  font-family: inherit;
  transition: background-color var(--cs-duration-fast, 120ms) ease,
    border-color var(--cs-duration-fast, 120ms) ease;
}

.csLobbyRatio:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLobbyRatio[aria-pressed='true'] {
  border-color: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
  background: var(--cs-accent-soft, transparent);
}

.csLobbyRatioBw {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.csLobbyRatioBox {
  border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-radius: 3px;
}

.csLobbyRatio[aria-pressed='true'] .csLobbyRatioBox {
  border-color: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
}

.csLobbyRatioLb {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-secondary);
  line-height: 1.25;
  text-align: center;
}

.csLobbyRatio[aria-pressed='true'] .csLobbyRatioLb {
  color: var(--dsw-alias-label-primary);
}

/* 时长面板的「自定义」行：输入框未激活时呈静默态（无描边、降透明、
   不可键入不可 Tab 聚焦——disabled 属性），点行才激活。 */
.csLobbySblock {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 9px;
  border-radius: 9px;
  cursor: pointer;
  transition: background-color var(--cs-duration-fast, 120ms) ease;
}

.csLobbySblock:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLobbySblock[aria-pressed='true'] .csLobbyMiChk {
  opacity: 1;
}

.csLobbySlabel {
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
  flex: 1 1 auto;
}

.csLobbySblock[aria-pressed='true'] .csLobbySlabel {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.csLobbyNumwrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 8px;
  padding: 4px 8px;
  transition: border-color var(--cs-duration-fast, 120ms) ease,
    background-color var(--cs-duration-fast, 120ms) ease;
}

.csLobbySblock[aria-pressed='true'] .csLobbyNumwrap:focus-within {
  border-color: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
}

.csLobbySblock:not([aria-pressed='true']) .csLobbyNumwrap {
  background: transparent;
  border-color: transparent;
}

.csLobbySblock:not([aria-pressed='true']) .csLobbySlabel,
.csLobbySblock:not([aria-pressed='true']) .csLobbyNumwrap {
  opacity: 0.5;
}

.csLobbyNumInput {
  width: 44px;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: var(--cs-fs-sm, 12px);
  text-align: right;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
}

.csLobbyNumInput:disabled {
  pointer-events: none;
}

.csLobbyNumInput::-webkit-outer-spin-button,
.csLobbyNumInput::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.csLobbyNumUnit {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* ---- 宿主发送钮 → 「开始创作」药丸（仅 lobby/hero + 打锚后生效） ----
 *
 * 锚由 LobbySpecRow.tagSendButton 在 lobby 态打到宿主发送钮上（找钮 + 核验
 * 的可靠性讨论见该函数注释）；样式只认锚，不猜哈希类名。演示药丸：accent
 * 纵向渐变实底 + 固定文案「开始创作」（不随模式改写），host 的 34px 圆形
 * 几何与 -2px 上移一并接管。上游还原（work 态 / 未打锚）= 图标圆钮原状。 */
.csChat [data-phase='hero'] [data-composer-card] [data-cs-send] {
  width: auto;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: linear-gradient(180deg, var(--cs-accent-strong), var(--cs-accent));
  /* accent 实底上的文字色走预设令牌（紫/蓝白字、琥珀金墨色，见 brand.ts 注）。 */
  color: var(--cs-accent-contrast, var(--dsw-alias-label-primary));
  transform: none;
}

.csChat [data-phase='hero'] [data-composer-card] [data-cs-send]:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--cs-accent), var(--cs-accent-strong));
}

/* 空草稿的禁用态：演示是「灰实底 + 弱化字」而不是 accent 打四折 —— 打折的
 * 渐变在深色卡上读成一团糊紫（验收截图实证），实底弱化才读作「未激活」。
 * opacity 拉回 1（覆盖宿主 .primary:disabled 的 0.4），材料全走令牌。 */
.csChat [data-phase='hero'] [data-composer-card] [data-cs-send]:disabled {
  opacity: 1;
  background: var(--cs-node, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-tertiary);
}

.csChat [data-phase='hero'] [data-composer-card] [data-cs-send]::after {
  content: '开始创作';
  font-size: var(--cs-fs-sm, 12px);
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* ---- hero 态卡片正下方的快捷键脚注（验收拍板） ----
 *
 * 「Enter 提交 · Shift + Enter 换行」是宿主输入框的**既有行为**（InputBar 对
 * Shift+Enter 无条件放行为原生换行、Enter 进提交流程），演示把它写成卡片
 * 正下方的一行提示。hero 态宿主不渲染卡片下方唯一的槽（composer.dock 只在
 * 非 hero 渲染），没有落点 —— 按槽锚 + ::after 伪元素补画（与 data-cs-send
 * 药丸同一族手法）。absolute 不占布局：卡片高度不变；hero 态卡片下的 32px
 * 底部留白（composerHero padding-bottom）正好放下这行，不被滚动容器裁掉。 */
.csChat [data-phase='hero'] [data-composer-card]::after {
  content: 'Enter 提交 · Shift + Enter 换行';
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  font-size: var(--cs-fs-xs, 11px);
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  pointer-events: none;
}

/* ==================== DD-10：中栏「开拍前条」（lobby-pending） ====================
 *
 * lobby-pending = 项目已选定、还没有第一轮对话。此时中栏第一行**本来什么都不
 * 渲染**（画布只在 work 态出现），于是整屏只剩中间那张对话卡：用户看不到这个
 * 项目锁了什么规格、走到六段的哪一段。
 *
 * 而 work 态的中栏顶部是有东西的：工具栏 + P7 工作流条。两者位置相同、语义也
 * 接得上（「这台制作台现在什么状态」），所以这里补一条同位置的带子，让中栏顶部
 * 在两态之间连续 —— 这是「跟正式画布和谐」里最实的一块，也是本批唯一新增的
 * 内容（其余都是把已有语言补齐）。
 *
 * 载体沿用 C7 首屏那套画布配方（L1 底色 + 顶部 accent 光晕），于是它与同位置的
 * .csLobbyHero 看起来是同一个「制作台顶栏」，lobby 与 lobby-pending 的区别只剩
 * 里面写什么。数据全部来自 deriveProjectContextView（与输入区读数带同一个判定
 * 入口，零新判定），条子本身不读 store。 */
.csSlateBar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  box-sizing: border-box;
  padding: 9px var(--cs-space-5, 24px);
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background-color: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base));
  background-image: radial-gradient(70% 150% at 50% 0%, var(--cs-accent-soft, transparent), transparent 72%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  font-size: var(--cs-fs-md, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  /* 纯读数带，不是文本流 —— 拖选会把隔壁块的碎片一起带出来（与 .csContextBar 同理）。 */
  user-select: none;
}

/* 状态词：accent-soft 底的小胶囊，是这条带子里唯一的「徽标」，也是最早被看到的
   一格 —— 「还没开拍」是这一屏最重要的信息，比项目名更该先入眼。 */
.csSlateTag {
  flex: 0 0 auto;
  padding: 0 var(--cs-space-2, 8px);
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-accent-soft, transparent);
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 500;
  line-height: 18px;
  letter-spacing: 0.02em;
}

/* 项目名：这条带子的主语，比规格强一档（一级色 + 半粗）。省略号靠 min-width: 0
   —— flex 子项默认 min-width: auto 不会缩（CV-181 在左栏副行踩到过同一个坑）。 */
.csSlateName {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
}

/* 规格：不许被挤扁的读数（挤成「16:9 · 7…」等于把信息废掉），等宽数字让换项目 /
   换时长时数位不跳 —— 与输入区读数带同一条理由。 */
.csSlateSpec {
  flex: 0 0 auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}

.csSlateSep {
  flex: 0 0 auto;
  opacity: 0.45;
}

/* 把阶段胶囊推到右端：左边「我是谁 / 锁了什么」（稳定），右边「走到哪一步」（动态）
   —— 与输入区读数带完全同一条分工，两处读起来是同一个东西。 */
.csSlateSpacer {
  flex: 1 1 auto;
  min-width: var(--cs-space-2, 8px);
}

/* 画布中心空态引导（不挡画布交互）。 */
.csCanvasEmptyHint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 80%);
  padding: 18px 22px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  text-align: center;
  pointer-events: none;
  box-shadow: var(--cs-shadow-1, none);
}
.csCanvasEmptyHintTitle {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.csCanvasEmptyHintText {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/* C8（DD-06）：空画布「预演」—— 幽灵流水线（分镜 → 定妆 → 镜头 → 成片）。
   极淡材料：虚线胶囊 + 虚线连接线，终点「成片」用 accent-soft 微光收束。
   静态不挂动画 —— 预演是常驻的舞台指示，不该每次清空画布都闪一遍。 */
.csGhostPipeline {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--cs-space-2, 8px);
  margin-top: var(--cs-space-3, 12px);
}
.csGhostNode {
  padding: 3px 12px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  border: 1px dashed var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: 999px;
  background: var(--cs-accent-soft, transparent);
}
.csGhostLink {
  width: 26px;
  border-top: 1px dashed var(--cs-line, var(--dsw-alias-border-l2));
}
.csGhostNodeFinal {
  border-style: solid;
  border-color: color-mix(in srgb, var(--cs-accent, transparent) 45%, transparent);
  color: var(--dsw-alias-label-secondary);
}

/* 通用加载卡。 */
.csLoadingCard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
}
.csLoadingText {
  font-size: 12px;
}
.csLogoMarkPulse {
  animation: csLogoPulse 1.6s ease-in-out infinite;
}
@keyframes csLogoPulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

/* 错误三级处置卡。 */
.csErrorCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-1);
  /* C8：错误卡出现走浮层词汇 pop（与详情面板 / 图层浮层一致）。 */
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}
/* C8 三级视觉分级：左缘 3px 色条 + 标题色随级走，梯度 = 越严重越往宿主错误色靠。
   可重试 = accent（中性、可行动）；缺配置 = gold（缺料、要去拍板）；服务不可达 =
   宿主错误色（真故障，重）。左缘条语言与审批条的 gold 拍板条同源。 */
.csErrorKindRetryable {
  border-left: 3px solid var(--cs-accent, var(--dsw-alias-state-error-border));
}
.csErrorKindRetryable .csErrorTitle {
  color: var(--cs-accent, var(--dsw-alias-state-error-primary));
}
.csErrorKindConfig {
  border-left: 3px solid var(--cs-gold, var(--dsw-alias-state-error-border));
}
.csErrorKindConfig .csErrorTitle {
  color: var(--cs-gold, var(--dsw-alias-state-error-primary));
}
.csErrorKindUnreachable {
  border-left: 3px solid var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-border));
}
.csErrorTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}
.csErrorMessage {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.csErrorHint {
  margin: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csErrorActions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.csErrorAction {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csErrorAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csErrorActionPrimary {
  border-color: transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csErrorActionPrimary:hover {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* 设置页「外观」区：品牌配色预设 swatch。 */
.csBrandSwatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.csBrandSwatch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csBrandSwatch:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csBrandSwatchActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  box-shadow: 0 0 0 1px var(--cs-accent-soft, transparent);
}
.csBrandSwatchChip {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgb(0 0 0 / 25%);
  display: inline-block;
}
.csBrandSwatchName {
  font-size: 12px;
}

/* ==================== CV-065 技能广场 ====================
   组件：SkillCarousel（lobby 横滚）/ SkillMarket（全屏）/ SkillCard（卡）。
   「使用」= 提示词插进对话输入框，不做其它副作用。 */

/* -- lobby 第三行：推荐技能横滚 -- */
.csLobbyTail {
  padding: var(--cs-space-1, 4px) var(--cs-space-5, 24px) var(--cs-space-4, 16px);
  overflow: hidden;
}
.csLobbyTailHead {
  display: flex;
  align-items: baseline;
  gap: var(--cs-space-3, 12px);
  margin-bottom: var(--cs-space-2, 8px);
}
/* DD-10：加一根 accent 立柱。此前「推荐技能」是裸文字 —— 与同屏的输入区读数带、
   对话框标题、开拍前条都不成体系，而它们讲的是同一件事（这一段是什么）。
   立柱是这套界面里成本最低的统一符号：2px / radius 1px，已经出现三次。 */
.csLobbyTailHead::before {
  content: '';
  flex: 0 0 auto;
  align-self: center;
  width: 2px;
  height: 12px;
  border-radius: 1px;
  background: var(--cs-accent, #5b4bd6);
}
.csLobbyTailHead > span:first-child {
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csLobbyTailHint {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* -- 横滚条 -- */
.csSkillCarousel {
  display: flex;
  align-items: center;
  gap: 10px;
}
.csCarouselTrack {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 2px 6px;
  scroll-behavior: smooth;
}
.csCarouselTrack::-webkit-scrollbar {
  display: none;
}
.csCarouselItem {
  flex: 0 0 auto;
  width: 264px;
}
.csCarouselNav {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.csCarouselNav:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csCarouselMore {
  flex: 0 0 auto;
  margin-left: 4px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.csCarouselMore:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* -- 技能卡 --
   DD-10：材料从宿主弹层令牌（border-l2 / bg-layer-1）换成画布族的节点档
   （--cs-line / --cs-node）—— 卡片于是与画布里的节点同一种「面」，而不是
   一个通用弹层里的盒子。缩略图本身是 9:16 深色海报，在浅色背景上边缘很硬，
   换成交互族描边（比 border-l2 轻）之后它读成「海报贴在卡上」而不是「一块
   贴片浮在页面上」。hover 用 --cs-glow-accent（与画布选中节点同一个光晕），
   一套材料两处复用。
   注意：本组件也被 SkillMarket（全屏技能广场）复用 —— 这是有意为之，
   两处是同一张卡的两个容器。 */
.csSkillCard {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--cs-node, var(--dsw-alias-bg-layer-1));
  overflow: hidden;
}
.csSkillCard:hover {
  border-color: var(--cs-accent-soft, var(--dsw-alias-border-l2));
  box-shadow: var(--cs-glow-accent, var(--cs-shadow-1, none));
}
.csSkillThumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 110px;
  color: rgb(255 255 255 / 92%);
}

/* CV-070：默认显示的动态演示 GIF（盖在渐变缩略图上；无 demo 则不渲染）。
   prefers-reduced-motion 降级为静态渐变（不动画敏感用户不强制播）。 */
.csSkillThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillThumbGif {
    display: none;
  }
}

/* CV-076：H3 能力角标（左上角，真实信息）。 */
.csSkillH3 {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 82%, transparent);
  pointer-events: none;
}

/* CV-118 语义修订（2026-09-09）：试跑期角标（卡片右上 absolute；弹窗标题内 static）。 */
.csSkillPreviewBadge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgb(128 128 128 / 30%)) 88%, transparent);
  border: 1px solid var(--dsw-alias-border-l2);
  pointer-events: none;
}
.csSkillDetailTitle .csSkillPreviewBadge {
  position: static;
  align-self: center;
}

/* CV-071：hover 浮层「查看详情」。 */
.csSkillHover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, #000 45%, transparent);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.csSkillCard:hover .csSkillHover,
.csSkillCard:focus-within .csSkillHover {
  opacity: 1;
  pointer-events: auto;
}
.csSkillHoverBtn {
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 90%, transparent);
  cursor: pointer;
}
/* CV-071：次要操作（查看详情）用 ghost 变体，避免与主操作「使用」抢视觉。 */
.csSkillHoverGhost {
  background: color-mix(in srgb, rgb(255 255 255 / 14%) 100%, transparent);
  border: 1px solid color-mix(in srgb, #fff 42%, transparent);
}
.csSkillHoverGhost:hover {
  background: color-mix(in srgb, rgb(255 255 255 / 24%) 100%, transparent);
}
.csSkillHoverBtn:hover {
  filter: brightness(1.1);
}

/* CV-072：广场右上搜索框。 */
.csSkillSearch {
  width: 200px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillSearch:focus {
  outline: none;
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
}

/* CV-074：官方精选 / 其他技能 分区标题。 */
.csSkillSectionTitle {
  margin: 4px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-077：仅显示未装载 过滤行。 */
.csSkillOnlyInactive {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
}

/* CV-073：我的 Skill 清单。 */
.csSkillContent {
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px 16px;
}
.csSkillMine {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.csSkillMineRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMineTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillMineName {
  flex: 1;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillMineRemove {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillMineRemove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-border-l2);
}
.csSkillEmpty {
  padding: 32px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* CV-078：创作者社区收尾卡（reserved 纯展示）。 */
.csSkillCommunity {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  padding: 12px;
}
.csSkillCommunity h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.csSkillCommunity p {
  margin: 0;
  font-size: 11px;
}
.csSkillCommunityIcon {
  font-size: 16px;
}

/* CV-071：技能详情弹窗。 */
.csSkillDetailBackdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 50%, transparent);
}
.csSkillDetail {
  display: flex;
  gap: 14px;
  width: min(460px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-2, none);
}
.csSkillDetailThumb {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
  width: 132px;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  color: rgb(255 255 255 / 92%);
}
/* CV-112：详情弹窗缩略图 GIF（与卡片默认显示的 csSkillThumbGif 一致——盖在渐变上）。 */
.csSkillDetailThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillDetailThumbGif {
    display: none;
  }
}
.csSkillDetailBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.csSkillDetailTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillDetailTitle .csSkillH3 {
  position: static;
}
.csSkillDetailCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillDetailSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.csSkillDetailName {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillDetailActions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.csSkillDetailUse {
  padding: 5px 14px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  color: #fff;
  background: var(--cs-accent, #6c5ce7);
  cursor: pointer;
}
.csSkillDetailClose {
  padding: 5px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  flex: 1;
}
.csSkillTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csSkillSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.csSkillFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.csSkillCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
}
.csSkillUse {
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-md, 8px);
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
  cursor: pointer;
}
.csSkillUse:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* -- 全屏技能广场（覆盖层） -- */
.csSkillMarket {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.csSkillMarketBar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMarketBack {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.csSkillMarketBack:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillMarketTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.csSkillMarketCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillMarketSpacer {
  flex: 1;
}
.csSkillMarketCreate {
  position: relative;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: default;
  opacity: 0.6;
}
.csSkillMarketCreate .csReserved {
  margin-left: 6px;
}
.csSkillMarketBody {
  display: flex;
  flex: 1;
  min-height: 0;
}
.csSkillRail {
  flex: 0 0 190px;
  padding: 10px 8px;
  border-right: 1px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.csSkillRailItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.csSkillRailItem:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillRailActive {
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.csSkillRailCount {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillRailActive .csSkillRailCount {
  color: inherit;
}
.csSkillGrid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
  align-content: start;
}

/* -- CV-066：work 态已装载技能 chip 行 -- */
.csSkillChips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillChipsLabel {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-right: 2px;
}
.csSkillChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border: 1px solid var(--cs-accent-soft, var(--dsw-alias-border-l2));
  border-radius: 999px;
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-size: 12px;
}
.csSkillChipName {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillChipRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.csSkillChipRemove:hover {
  background: rgb(0 0 0 / 12%);
}

/* ---- REQ-001：全局资产库（全屏 overlay 照 csSkillMarket；抽屉照 HistoryDrawer）---- */
.csLibOverlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.csLibBar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csLibPrimary {
  padding: 6px 14px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  background: var(--cs-accent, var(--dsw-alias-label-primary));
  /* 主按钮文字压在 accent 底上 —— 现有 primary 面
     （.csWorkflowApproval button.csPrimary）同款用白字，不另造 accent-contrast
     令牌（禁幽灵令牌守卫）。 */
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.csLibPrimary:disabled {
  opacity: 0.55;
  cursor: default;
}
.csLibCatDot {
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.csLibRailHint {
  margin: 10px 4px 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}
.csLibContent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px 40px;
}
.csLibFilterRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.csLibSortChip {
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  cursor: pointer;
}
.csLibSortChip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.csLibSortActive {
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.csLibGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 14px;
}
.csLibCard {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease;
}
.csLibCard:hover {
  transform: translateY(-2px);
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}
.csLibCover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-3);
}
/* REQ-001 图片适配（用户 2026-09-28 拍板 A3+B2）：
   卡片封面与抽屉大图一律 object-fit:contain —— 竖/横/方图都完整可见，
   留白底色由外层盒统一提供（--dsw-alias-bg-layer-3），网格观感不花。
   cover 会裁掉竖图主体（角色卡切头），已废弃。 */
.csLibCover img,
.csLibCover video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.csLibPreview {
  display: block;
  width: 100%;
  /* B2：高度封顶（55vh，且不超 480px）——竖图不再撑满整个抽屉；min-height
     兜音频 glyph 盒（csLibPreview.csLibCoverGlyph 组合时无固有高度）。 */
  max-height: min(55vh, 480px);
  min-height: 120px;
  object-fit: contain;
  border-radius: var(--cs-radius-lg, 10px);
  margin-bottom: 12px;
  background: var(--dsw-alias-bg-layer-3);
}
.csLibCoverGlyph {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  font-size: 30px;
  font-weight: 800;
  color: var(--dsw-alias-label-primary);
}
/* 入库对话框：上传前本地预览缩略图（objectURL，contain 防裁切）。 */
.csLibUploadPreview {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  margin-bottom: 8px;
}
.csLibCoverBadge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(0 0 0 / 45%);
  color: #fff;
  font-size: 11px;
}
.csLibCardMeta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px;
}
.csLibCardName {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  font-weight: 600;
}
.csLibCardSub {
  overflow: hidden;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csLibEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 90px 0;
  color: var(--dsw-alias-label-tertiary);
}
.csLibEmptyIcon {
  font-size: 40px;
  opacity: 0.65;
}
.csLibEmptySub {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.8;
}
/* 详情抽屉：overlay 内右侧浮层（宽度略宽于 HistoryDrawer，容纳元数据行）。 */
.csLibDrawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: 360px;
  border-left: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  animation: csYieldPop 160ms ease-out;
}
.csLibDrawerHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  font-size: 14px;
  font-weight: 600;
}
.csLibDrawerBody {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.csLibDrawerTitle {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 10px;
  font-size: 18px;
}
.csLibPill {
  padding: 1px 9px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
}
.csLibRow {
  display: flex;
  gap: 10px;
  margin-top: 9px;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
}
.csLibRow b {
  flex: none;
  min-width: 40px;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
}
.csLibHandle {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--cs-accent, var(--dsw-alias-label-primary));
}
.csLibLocked {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.csLibNotice {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--cs-radius-md, 8px);
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-size: 12px;
  line-height: 1.6;
}
.csLibThumbs {
  display: flex;
  gap: 6px;
  margin: -4px 0 12px;
}
.csLibThumb {
  width: 40px;
  height: 30px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  cursor: pointer;
}
.csLibThumbOn {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
}
.csLibField {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}
.csLibFieldLabel {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
}
.csLibInput {
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  outline: none;
}
.csLibInput:focus {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
}
.csLibTextarea {
  resize: vertical;
  font-family: inherit;
  line-height: 1.55;
}
.csLibCategoryRow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.csLibDrawerActs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csLibConfirmText {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.csLibDanger {
  padding: 7px 12px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  /* 危险色直取字面量 —— brand.ts 无 danger 令牌，禁幽灵令牌守卫禁 var 引用。 */
  background: #f25a5a;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.csLibDangerGhost {
  padding: 7px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: #f25a5a;
  font-size: 12.5px;
  cursor: pointer;
}
.csLibDangerGhost:hover:not(:disabled) {
  background: rgb(242 90 90 / 12%);
}
/* 入库对话框（画布入库 / 上传图片共用）。 */
.csLibDialogBackdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}
.csLibDialog {
  width: 400px;
  max-height: 86%;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.csLibDialogTitle {
  margin: 0 0 14px;
  font-size: 15px;
}

/* ---- CV-246：生成历史抽屉（画布右侧滑出浮层） ---- */
.csHistoryDrawer {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 10;
  width: 300px;
  display: flex;
  flex-direction: column;
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* C4：历史抽屉**不玻璃**（backdrop-filter 配额 3 已满：settings 遮罩 + 详情
     面板 + 图层浮层；抽屉面积大，blur 是持续合成开销）。底色用浮层令牌高不
     透明度派生 —— 无 blur 时半透明比不玻璃更难读（C4 兜底同理）。 */
  background: color-mix(in srgb, var(--cs-float, var(--dsw-alias-bg-base)) 94%, transparent);
  color: var(--dsw-alias-label-primary);
  animation: csYieldPop 160ms ease-out;
}
.csHistHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 0;
}
.csHistTitle {
  font-size: 14px;
  font-weight: 500;
}
.csHistCount {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, inherit);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  padding: 0 8px;
}
.csHistClose {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.csHistClose:hover {
  background: rgb(127 127 127 / 18%);
}
.csHistHint {
  margin: 4px 14px 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.csHistTabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
}
.csHistTab,
.csHistTabActive {
  flex: 1;
  height: 26px;
  border-radius: 7px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
}
.csHistTabActive {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-accent-soft, rgb(127 127 127 / 14%));
  color: var(--dsw-alias-label-primary);
}
.csHistError {
  margin: 0 14px 6px;
  font-size: 12px;
  color: var(--dsw-alias-danger, #e24b4a);
}
.csHistGrid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-content: start;
  padding: 2px 14px 14px;
}
.csHistEmpty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, inherit);
  padding: 28px 0;
}
.csHistCard {
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--cs-node-hi, rgb(127 127 127 / 8%));
  padding: 8px;
}
.csHistThumb {
  position: relative;
  display: block;
  width: 100%;
  height: 76px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--cs-node-hi, rgb(127 127 127 / 14%));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}
.csHistThumb:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}
.csHistLightbox {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgb(0 0 0 / 72%);
  cursor: zoom-out;
}
.csHistLightboxBar {
  position: absolute;
  top: 10px;
  left: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: rgb(255 255 255 / 88%);
}
.csHistLightbox img,
.csHistLightbox video {
  max-width: 88%;
  max-height: 84%;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  cursor: default;
}
.csHistThumb img,
.csHistThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.csHistExt {
  position: absolute;
  right: 5px;
  bottom: 4px;
  font-size: 11px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(0 0 0 / 45%);
  color: rgb(255 255 255 / 92%);
}
.csHistMeta {
  margin-top: 7px;
}
.csHistBadge {
  display: inline-block;
  font-size: 11px;
  border-radius: 4px;
  padding: 0 5px;
}
.csHistBadge-canvas {
  color: var(--dsw-alias-success, #639922);
  background: color-mix(in srgb, var(--dsw-alias-success, #639922) 14%, transparent);
}
.csHistBadge-retired {
  color: var(--dsw-alias-warning, #ba7517);
  background: color-mix(in srgb, var(--dsw-alias-warning, #ba7517) 14%, transparent);
}
.csHistBadge-orphan {
  color: var(--dsw-alias-label-secondary, inherit);
  background: rgb(127 127 127 / 14%);
}
.csHistLabel {
  margin: 5px 0 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
}
.csHistWhen {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.csHistActions,
.csHistConfirm {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.csHistActions {
  visibility: hidden;
}
.csHistCard:hover .csHistActions {
  visibility: visible;
}
.csHistConfirm,
.csHistCancel,
.csHistAsk,
.csHistDelete {
  height: 24px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.csHistConfirm .csHistDelete,
.csHistConfirm .csHistCancel {
  flex: 1;
}
.csHistCancel {
  flex: 1;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
}
.csHistAsk {
  border: none;
  padding: 0 8px;
  background: color-mix(in srgb, var(--dsw-alias-danger, #e24b4a) 22%, transparent);
  color: var(--dsw-alias-danger, #e24b4a);
}
.csHistConfirm .csHistDelete {
  border: none;
  background: var(--dsw-alias-danger, #e24b4a);
  color: rgb(255 255 255 / 94%);
}
/* CV-277：批量清理失效产物。按钮挂在 hint 下方、tabs 上方——不进卡内操作区
   （那是「单条定位/删除」的位置），它清的是整个项目。 */
.csHistPrune {
  display: block;
  width: 100%;
  height: 26px;
  margin: 0 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 12px;
  cursor: pointer;
}
.csHistPrune:hover {
  border-color: var(--dsw-alias-danger, #e24b4a);
  color: var(--dsw-alias-danger, #e24b4a);
}
.csHistConfirmBar {
  align-items: center;
  margin: 0 0 8px;
}
.csHistConfirmText {
  flex: 1;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, inherit);
}
.csHistConfirmBar .csHistDelete,
.csHistConfirmBar .csHistCancel {
  flex: 0 0 auto;
  padding: 0 10px;
}
.csHistDelete:disabled {
  opacity: 0.6;
  cursor: default;
}
.csHistFoot {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 8px 14px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, inherit);
}
@media (prefers-reduced-motion: reduce) {
  .csHistoryDrawer {
    animation: none;
  }
}

/* ===== REQ-008：对话流工具行三档（A 展示级 / B 流程级 / C 内部级） ===== */
/* 行容器：A/B 卡片式；C 由 .csToolRowC 覆盖为无卡片极简态。 */
.csToolRow {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #e3e6ea);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
  padding: 7px 10px;
  min-width: 0;
}
.csToolRowIcon {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8a93a0) 14%, transparent);
}
.csToolRowTitle {
  flex: none;
  font-weight: 600;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #1a1d21);
}
.csToolRowSummary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #5b6470);
}
.csToolRowMeta {
  flex: none;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
}
/* A 展示级：更醒目（升底色、大字、强调图标）。 */
.csToolRowA {
  padding: 9px 10px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.csToolRowA .csToolRowTitle {
  font-size: 14px;
}
.csToolRowA .csToolRowIcon {
  width: 20px;
  height: 20px;
  color: var(--dsw-alias-brand, #2f6fed);
  background: color-mix(in srgb, var(--dsw-alias-brand, #2f6fed) 14%, transparent);
}
/* B 流程级：虚线弱化。 */
.csToolRowB {
  border-style: dashed;
  padding: 5px 10px;
}
.csToolRowB .csToolRowTitle {
  font-weight: 500;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #5b6470);
}
/* C 内部级：极简灰字（无卡片），整行按钮可点开详情。 */
.csToolRowC {
  border: none;
  background: transparent;
  padding: 0;
  border-radius: 6px;
  display: block;
}
.csToolRowC:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
}
.csToolRowLine {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 3px 6px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.csToolRowC .csToolRowTitle {
  font-weight: 500;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
}
.csToolRowC .csToolRowSummary {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
}
.csToolRowCaret {
  flex: none;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
  transition: transform var(--cs-duration-fast, 0.15s) var(--cs-ease, ease);
}
.csToolRowCaret[data-open] {
  transform: rotate(90deg);
}
/* 状态：成功 / 失败 / 取消。 */
.csToolRowOk .csToolRowMeta {
  color: var(--dsw-alias-state-success-primary, #1f9d55);
}
.csToolRowErr {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d43d3d) 55%, var(--dsw-alias-border-l2, #e3e6ea));
}
.csToolRowErr .csToolRowTitle,
.csToolRowErr .csToolRowIcon {
  color: var(--dsw-alias-state-error-primary, #d43d3d);
}
.csToolRowErr .csToolRowSummary {
  color: var(--dsw-alias-state-error-primary, #d43d3d);
}
.csToolRowErr .csToolRowMeta {
  color: var(--dsw-alias-state-error-primary, #d43d3d);
}
/* 取消（interrupted）是中性态：灰字 + 划线，绝不能画成红色失败。 */
.csToolRowStopped .csToolRowTitle,
.csToolRowStopped .csToolRowSummary,
.csToolRowStopped .csToolRowMeta,
.csToolRowStopped .csToolRowIcon {
  color: var(--dsw-alias-label-tertiary, #8a93a0);
}
.csToolRowStopped .csToolRowSummary {
  text-decoration: line-through;
}
/* 运行中：左缘扫光（C 档无卡片，同样生效在行容器上）。 */
.csToolRowRunning::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, transparent, var(--dsw-alias-brand, #2f6fed), transparent);
  animation: csAdvanceToolRowSweep 1.2s linear infinite;
}
@keyframes csAdvanceToolRowSweep {
  0% { transform: translateY(-60%); }
  100% { transform: translateY(60%); }
}
/* C 档展开详情：参数原文 + 结果文本，限高滚动。 */
.csToolRowDetail {
  margin: 4px 6px 6px 26px;
  border: 1px solid var(--dsw-alias-border-l2, #e3e6ea);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
  padding: 8px 10px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* CV-264：A/B 档 error/stopped 态整行可点开 —— 卡片自身就是点击目标，详情
   贴卡片内缘排；可展开行给手型与键盘焦点环。 */
.csToolRowA .csToolRowDetail,
.csToolRowB .csToolRowDetail {
  margin: 8px 2px 2px;
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
}
.csToolRow[data-expandable] {
  cursor: pointer;
}
.csToolRow[data-expandable]:focus-visible {
  outline: 1px solid var(--dsw-alias-brand, #2f6fed);
  outline-offset: 1px;
}
.csToolRowSection {
  min-width: 0;
}
.csToolRowKey {
  display: block;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8a93a0);
  margin-bottom: 2px;
}
.csToolRowPre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-secondary, #5b6470);
}
.csToolRowPath {
  align-self: flex-start;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-brand, #2f6fed);
  cursor: pointer;
  text-decoration: underline;
}
@media (prefers-reduced-motion: reduce) {
  .csToolRowRunning::before {
    animation: none;
  }
}

/* ==================== REQ-003：参考图编辑区（生成时用的参考图） ====================
 *
 * 改前这里是一行只读缩略图（.csDetailRefThumb）：删不掉断链那张、换不了图、也看不出
 * 位次。位次不是装饰 —— video_composite 的数组顺序就是提示词里 Picture N 的编号
 * （1 张=首帧 I2VA / 2 张=首尾帧 FL2VA / >=3 张=多参考 Ref2VA）。
 *
 * 布局：卡片网格（图 + 位次徽标 + 悬浮工具 + 名字），末尾是添加位。参考区不设固定
 * 高度：张数多时靠换行，面板高度不随参考数量增长（REQ-003 方案 F4 的同一条账）。
 */
.csRefHead { display: flex; align-items: center; gap: var(--cs-space-2, 8px); }
.csRefHead .csDetailDrawerColTitle { margin: 0; }
.csRefMeta { margin-left: auto; display: inline-flex; align-items: center; gap: var(--cs-space-1, 4px); }
.csRefPill { padding: 0 7px; border-radius: var(--cs-radius-pill, 999px); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: var(--cs-fs-xs, 11px); line-height: 17px; white-space: nowrap; }
.csRefPillMode { background: var(--cs-accent-soft); color: var(--cs-accent); }
.csRefList { display: flex; flex-wrap: wrap; gap: var(--cs-space-2, 8px); }
.csRefCard { display: flex; flex-direction: column; gap: 2px; width: 76px; }
.csRefBox { position: relative; width: 76px; height: 58px; border-radius: var(--cs-radius-sm, 6px); overflow: hidden; border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2)); background: var(--cs-canvas-bg, var(--dsw-alias-bg-base)); }
.csRefThumb { display: block; width: 100%; height: 100%; object-fit: cover; }
.csRefIdx { position: absolute; top: 2px; left: 2px; padding: 0 5px; border-radius: var(--cs-radius-pill, 999px); background: var(--cs-gate, var(--dsw-alias-bg-base)); color: #fff; font-size: 10px; line-height: 15px; }
.csRefTools { position: absolute; right: 2px; top: 2px; display: none; gap: 2px; }
.csRefBox:hover .csRefTools, .csRefBox:focus-within .csRefTools { display: flex; }
.csRefTool { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border-radius: 4px; border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2)); background: var(--cs-float, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--cs-fs-xs, 11px); line-height: 1; cursor: pointer; }
.csRefTool:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.csRefTool:disabled { opacity: 0.4; cursor: not-allowed; }
.csRefToolDanger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary); border-color: transparent; color: #fff; }
.csRefMove { display: flex; gap: 2px; }
.csRefMove button { flex: 1 1 auto; height: 16px; display: grid; place-items: center; padding: 0; border-radius: 3px; border: 1px solid var(--cs-line, var(--dsw-alias-border-l2)); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 10px; line-height: 1; cursor: pointer; }
.csRefMove button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.csRefMove button:disabled { opacity: 0.3; cursor: not-allowed; }
.csRefName { font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.csRefAdd { width: 76px; height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: var(--cs-radius-sm, 6px); border: 1px dashed var(--cs-line-hi, var(--dsw-alias-border-l2)); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 10px; cursor: pointer; }
.csRefAdd:hover:not(:disabled) { border-color: var(--cs-accent); color: var(--cs-accent); background: var(--cs-accent-soft); }
.csRefAdd:disabled { opacity: 0.45; cursor: not-allowed; }
.csRefAddPlus { font-size: 15px; line-height: 1; }
.csRefNote { font-size: var(--cs-fs-xs, 11px); color: var(--dsw-alias-label-tertiary); }
.csRefError { font-size: var(--cs-fs-xs, 11px); color: var(--dsw-alias-state-error-primary); }
.csRefPicker { display: flex; flex-direction: column; gap: var(--cs-space-2, 8px); padding: var(--cs-space-2, 8px); border-radius: var(--cs-radius-sm, 6px); border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2)); background: var(--cs-shell-2, var(--dsw-alias-bg-base)); }
.csRefPickerHead { display: flex; align-items: center; gap: var(--cs-space-2, 8px); font-size: var(--cs-fs-xs, 11px); }
.csRefPickerCancel { margin-left: auto; }
.csRefPickerList { display: flex; flex-wrap: wrap; gap: var(--cs-space-2, 8px); max-height: 168px; overflow-y: auto; }
.csRefCandidate { width: 72px; display: flex; flex-direction: column; gap: 2px; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 10px; text-align: left; cursor: pointer; }
.csRefCandidate:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.csRefCandidate:disabled { opacity: 0.5; cursor: not-allowed; }
.csRefCandidateThumb { width: 72px; height: 54px; object-fit: cover; border-radius: var(--cs-radius-sm, 6px); border: 1px solid var(--cs-line, var(--dsw-alias-border-l2)); }
.csRefCandidateName { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.csRefCandidateSrc { color: var(--dsw-alias-label-tertiary); }

/* ---- REQ-003 Step 2：就地提示词编辑浮层（B/C 组）----
   REQ-029 拍板⑧（CV-281 Step 5）：浮层已退役删除 —— 节点输入框卡（.csNodeInputCard）
   成为唯一编辑面，两入口与单击节点都打开它（能力迁移对照见方案 §6.2）。 */

/* ---- D5/F5：「未保存」徽标（amber）---- */
.csPromptDirtyPill { flex: 0 0 auto; padding: 1px 7px; border-radius: var(--cs-radius-pill, 999px); background: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, transparent); color: var(--cs-gold, #e8b45a); font-size: 10px; white-space: nowrap; }

/* ---- F2/F3/F8：Picture N 编号一致性警告条 + 中性回执 ---- */
.csPromptWarnbar { display: flex; align-items: center; gap: var(--cs-space-2, 8px); flex-wrap: wrap; margin: 0 var(--cs-space-3, 12px); padding: 6px 9px; border-radius: var(--cs-radius-sm, 6px); border: 1px solid color-mix(in srgb, var(--cs-gold, #e8b45a) 38%, transparent); background: color-mix(in srgb, var(--cs-gold, #e8b45a) 12%, transparent); font-size: var(--cs-fs-xs, 11px); }
.csPromptWarnbarText { flex: 1 1 160px; min-width: 0; color: var(--dsw-alias-label-primary); }
/* 中性回执：动作已执行、只告知 + 留撤销入口（撤销不随警告一起收走 —— F8）。 */
.csPromptWarnbarNeutral { border-color: var(--cs-line-hi, var(--dsw-alias-border-l2)); background: var(--dsw-alias-interactive-bg-hover, transparent); }

/* ---- D1：长提示词只读档 —— 读数 + 前 3 行预览（不硬撑全文）---- */
.csPromptLongRead { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.csPromptLongMeta { align-self: flex-start; padding: 1px 7px; border-radius: var(--cs-radius-pill, 999px); background: var(--dsw-alias-interactive-bg-hover, transparent); color: var(--dsw-alias-label-secondary); font-size: 10px; white-space: nowrap; }
.csPromptLongPreview { margin: 0; max-height: 74px; overflow: hidden; cursor: pointer; }
.csPromptLongPreview:hover { border-color: var(--cs-line-hi, var(--dsw-alias-border-l2)); }
.csPromptLongTools { display: flex; gap: 6px; }

/* ---- D3：结构化提示词分段折叠（段名常显、段体可编辑）---- */
.csPromptSegs { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.csPromptSeg { border: 1px solid var(--cs-line, var(--dsw-alias-border-l2)); border-radius: var(--cs-radius-sm, 6px); overflow: hidden; }
.csPromptSegHead { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; font: inherit; font-size: var(--cs-fs-xs, 11px); text-align: left; background: var(--cs-shell-2, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-secondary); border: none; cursor: pointer; }
.csPromptSegHead:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); color: var(--dsw-alias-label-primary); }
.csPromptSegMark { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.csPromptSegName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.csPromptSegCount { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.csPromptSegBody { padding: 6px 8px; border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2)); }
.csPromptAreaSeg { min-height: 54px; max-height: 200px; overflow-y: auto; }

/* ---- F1：选中参考的参数行（role / 强度 = 节点既有字段）---- */
.csRefBox { cursor: pointer; }
.csRefBoxPicked { border-color: var(--cs-accent); box-shadow: 0 0 0 2px var(--cs-accent-soft); cursor: pointer; }
.csRefParams { display: flex; align-items: center; gap: var(--cs-space-2, 8px); padding: 6px 8px; border-radius: var(--cs-radius-sm, 6px); background: var(--cs-shell-2, var(--dsw-alias-bg-base)); border: 1px solid var(--cs-line, var(--dsw-alias-border-l2)); font-size: var(--cs-fs-xs, 11px); }
.csRefParamsName { flex: 0 0 auto; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.csRefParamsValue { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.csRefParams .csDetailSelect { flex: 0 0 auto; max-width: 116px; }

/* ---- F4：参考区不撑高 —— 超过 6 张换单行横滚 ---- */
.csRefListScroll { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }

/* ---- REQ-021：应用内自动测试浮窗（右下角；testMode 开关控制挂载）---- */
.csAutoTestPanel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  width: 288px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: var(--cs-radius-md, 10px);
  background: var(--cs-shell, var(--dsw-alias-bg-raised));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-size: var(--cs-fs-sm, 12px);
  overflow-y: auto;
}
.csAutoTestHead { display: flex; align-items: center; gap: 8px; }
.csAutoTestTitle { font-weight: 600; flex: 1 1 auto; }
.csAutoTestBadge {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--cs-fs-xs, 11px);
}
.csAutoTestBadgeRunning { color: var(--cs-accent); border-color: var(--cs-accent); }
.csAutoTestWarning { margin: 0; color: var(--dsw-alias-state-error-primary); font-weight: 600; }
.csAutoTestHint { margin: 0; opacity: 0.75; }
.csAutoTestScenarios { display: flex; flex-direction: column; gap: 4px; }
.csAutoTestScenarioRow { display: flex; align-items: center; gap: 8px; }
.csAutoTestScenarioName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.csAutoTestRunBtn, .csAutoTestStopBtn, .csAutoTestActionBtn {
  flex: 0 0 auto;
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  padding: 3px 10px;
  border-radius: var(--cs-radius-pill, 999px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
  color: var(--cs-accent, inherit);
  cursor: pointer;
}
.csAutoTestRunBtn:disabled, .csAutoTestStopBtn:disabled, .csAutoTestActionBtn:disabled { opacity: 0.5; cursor: default; }
.csAutoTestStopBtn { width: 100%; color: var(--dsw-alias-state-error-primary, inherit); }
.csAutoTestActions { display: flex; flex-wrap: wrap; gap: 6px; }
.csAutoTestConfirm { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--dsw-alias-state-error-primary, var(--cs-line, var(--dsw-alias-border-l2))); border-radius: var(--cs-radius-sm, 6px); }
.csAutoTestStopInline { width: auto; }
.csAutoTestStep { margin: 0; opacity: 0.85; }
.csAutoTestLog { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; }
.csAutoTestLogLine { word-break: break-all; opacity: 0.85; }
.csAutoTestLog-pass { color: var(--dsw-alias-state-success-primary, var(--cs-accent)); }
.csAutoTestLog-fail { color: var(--dsw-alias-state-error-primary); }
.csAutoTestSummary { margin: 0; word-break: break-all; }
.csAutoTestSummaryFail { color: var(--dsw-alias-state-error-primary); }

/* ================= REQ-029 / CV-281 Step 2：节点输入框卡 =================
   1:1 还原演示 canvas-imagenode-inputbox.html（用户硬要求：布局/颜色/交互；
   色值照抄演示 —— 画布内新面 accent 固定 #ffb066，不随预设，偏差登记见方案 §九）。
   类名映射：.panel→.csNodeInputCard / .p-act→.csInputCardAct / .ib→.csInputCardIb /
   .refs→.csInputCardRefs / .ref-add→.csRefAdd / .p-foot→.csInputCardFoot /
   .pill→.csInputPill / .credit→.csInputCredits / .send→.csInputSend。 */

.csNodeInputCard {
  position: absolute; z-index: 13;
  /* 760 插值 CHROME_CARD_WIDTH（canvas-view，演示 .panel 同值）—— 写死数字会与
     卡内联布局宽（layoutWidth 按 effScale 反推的上限）静默漂移，守卫钉住插值。 */
  width: min(${CHROME_CARD_WIDTH}px, 92vw);
  background: linear-gradient(180deg, #161a1f 0%, #12151a 100%);
  border: 1px solid #252a33; border-radius: 20px;
  padding: 12px 14px;
  box-shadow: 0 26px 70px rgba(0, 0, 0, .62), inset 0 1px 0 color-mix(in srgb, var(--cs-line-hi, #f2f4f8) 9%, transparent);
  /* 随画布缩放的 scale 属性由 JSX 内联写入（演示 --chrome-scale），刻意不进
     transition —— 缩放要即时跟随滚轮，只有入场动画吃 transition。水平居中走
     独立 translate 属性（在 scale 外侧，视觉中心恒等于 left，与演示同式）。 */
  translate: -50% 0; transform-origin: 50% 0;
  opacity: 0; transform: translateY(16px);
  transition: transform .28s cubic-bezier(.22, .9, .3, 1), opacity .28s ease;
  display: flex; flex-direction: column;
}
.csNodeInputCard.csNodeInputCardIn { opacity: 1; transform: translateY(0); }
.csInputCardAct { position: absolute; top: 13px; right: 13px; display: flex; align-items: center; gap: 2px; z-index: 5; }
.csInputCardIb {
  width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent;
  color: #6b737f; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: .15s; font-size: 15px; line-height: 1; font-family: inherit; padding: 0;
}
.csInputCardIb:hover { background: #242a33; color: #e9ecf1; }
.csInputCardRefs { display: flex; align-items: center; gap: 9px; padding: 2px 46px 11px 0; flex-wrap: wrap; }
.csRefStrip { display: flex; gap: 9px; }
.csRefAdd {
  width: 52px; height: 52px; flex: 0 0 auto; border-radius: 11px;
  border: 1.5px dashed #333a45; background: transparent; color: #6b737f;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  transition: border-color .15s, color .15s; font-family: inherit;
}
.csRefAdd .csRefAddPlus { font-size: 15px; line-height: 1; }
.csRefAdd .csRefAddCount { font-size: 9.5px; letter-spacing: .2px; }
.csRefAdd.full { border-style: solid; border-color: #2a3038; color: #525a66; cursor: not-allowed; }
.csRefAdd.full:hover { border-color: #2a3038; color: #525a66; }
.csRefAdd:hover { border-color: #ffb066; color: #ffb066; }
/* Step 3 转真：52px 缩略图（位次角标 + 悬停放大镜 + × 移除）—— 演示 .thumb 族。 */
.csRefItem {
  position: relative; width: 52px; height: 52px; border-radius: 11px; flex: 0 0 auto;
  border: 1px solid #252a33; background: #0f1115;
}
.csRefItemFill { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; display: block; }
.csRefItemBroken { display: flex; align-items: center; justify-content: center; text-align: center; font-size: 9.5px; color: #6b737f; }
.csRefItemIx {
  position: absolute; left: 0; right: 0; bottom: 0; font-size: 9px; text-align: center;
  padding: 2px 0; color: #dfe6ee; background: rgba(8, 10, 14, .66); letter-spacing: .3px;
  border-radius: 0 0 inherit inherit; transition: opacity .16s ease; z-index: 1;
}
.csRefItemPv {
  position: absolute; inset: 0; padding: 0; border: 0; border-radius: inherit; cursor: pointer;
  background: rgba(6, 8, 12, .52); display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .16s ease; z-index: 2; font-family: inherit;
}
.csRefItemPv:disabled { cursor: default; }
.csRefItem:hover .csRefItemPv:not(:disabled), .csRefItemPv:focus-visible { opacity: 1; }
.csRefItem:hover .csRefItemIx { opacity: 0; }
.csRefItemRing {
  width: 25px; height: 25px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 0; color: #fff; filter: drop-shadow(0 1px 4px rgba(0, 0, 0, .92));
  transition: color .15s, transform .15s;
}
.csRefItemPv:hover .csRefItemRing { color: #ffb066; transform: scale(1.1); }
.csRefItemRm {
  position: absolute; top: 3px; right: 3px; width: 17px; height: 17px; border-radius: 50%; z-index: 3;
  border: 0; background: rgba(6, 8, 11, .8); color: #e9ecf1; font-size: 12px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: .15s; padding: 0; font-family: inherit;
}
.csRefItem:hover .csRefItemRm:not(:disabled) { opacity: 1; }
.csRefItemRm:disabled { cursor: default; }
/* 三来源菜单（演示 .pop.ref-menu：向下弹出、168px、尖角朝上）。 */
.csRefMenuPop {
  position: absolute; top: calc(100% + 11px); left: 0; width: 168px; z-index: 40;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px; padding: 5px;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .74);
  display: flex; flex-direction: column; gap: 2px;
}
.csRefMenuPop::after {
  content: ""; position: absolute; top: -6px; left: 21px; width: 10px; height: 10px;
  background: #1a1e25; border-left: 1px solid #2d343f; border-top: 1px solid #2d343f;
  transform: rotate(45deg); border-top-left-radius: 2px;
}
.csRefMenuHead { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; font-size: 11px; color: #9aa2ae; }
.csRefMenuHead .csInputCardIb { width: 24px; height: 24px; }
.csRefMenuItem {
  height: 33px; display: flex; align-items: center; gap: 9px; padding: 0 8px; border-radius: 8px;
  border: 0; background: transparent; color: #e9ecf1; font-size: 13px; font-weight: 500;
  cursor: pointer; font-family: inherit; text-align: left; min-width: 0;
}
.csRefMenuItem:hover:not(:disabled) { background: #262c35; }
.csRefMenuItem:disabled { color: #525a66; cursor: not-allowed; }
.csRefMenuItemThumb { width: 20px; height: 20px; border-radius: 5px; object-fit: cover; flex: 0 0 auto; }
.csRefMenuItemLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csRefMenuHint { font-size: 10.5px; color: #6b737f; letter-spacing: .3px; padding: 7px 9px 4px; }
.csRefMenuError { font-size: 11px; color: #fbbf24; padding: 4px 2px 0; }
.csInputCardPromptWrap { position: relative; }
/* 卡内 PromptEditor 适配演示规格：透明大正文（14.5px/1.68）、5 行滚动；
   只作用于卡片作用域，不动浮层/详情抽屉里的既有规格。 */
.csNodeInputCard .csPrompt { display: flex; flex-direction: column; }
.csNodeInputCard .csPromptArea { font-size: 14.5px; line-height: 1.68; background: transparent; min-height: 70px; max-height: calc(1.68em * 5 + 12px); overflow-y: auto; padding: 2px 2px 10px; }
.csInputCardFoot { display: flex; align-items: center; gap: 6px; padding-top: 10px; border-top: 1px solid #1c2027; flex-wrap: wrap; }
.csInputCardFootLeft { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.csInputCardFootRight { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.csInputPill {
  font-size: 12.5px; color: #9aa2ae; background: #1e222a;
  border: 1px solid transparent; border-radius: 999px; height: 30px; padding: 0 11px;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: default;
}
.csInputPillCaret { opacity: .7; font-size: 10px; }
.csInputPillIcon { width: 30px; padding: 0; justify-content: center; flex: 0 0 auto; color: #6b737f; }
.csInputCredits { color: #ffd3a6; background: rgba(255, 176, 102, .13); border-color: rgba(255, 176, 102, .32); }
.csInputCredits .csInputCreditsNum { color: #ffb066; font-variant-numeric: tabular-nums; }
.csInputSend {
  width: 34px; height: 34px; border-radius: 50%; border: 0; background: #ffb066; color: #161a1f;
  cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
  box-shadow: 0 4px 14px rgba(255, 176, 102, .35); font-family: inherit; padding: 0;
}
.csInputSend:disabled { opacity: .55; cursor: default; box-shadow: none; }
/* ================= REQ-031 / CV-282 Step 1：video 形态（模式 Tab + 分类托盘） =================
   1:1 还原演示 canvas-videonode-inputbox.html（色板与 image 演示同一套，accent 固定）。 */

/* 头部：模式 Tab（白底选中态）+ 原生音频开关（带点）+ 模式说明行。 */
.csInputCardHead { display: flex; align-items: center; gap: 8px; padding: 2px 46px 10px 0; }
.csModeTabs { display: flex; gap: 2px; background: #1e222a; border-radius: 9px; padding: 3px; flex: 0 0 auto; }
.csModeTab {
  height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent;
  color: #9aa2ae; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.csModeTab:hover { color: #e9ecf1; }
.csModeTab.on { background: #eef1f5; color: #161a1f; }
.csAudioChip {
  height: 26px; padding: 0 9px; border-radius: 999px; border: 1px solid #2d343f;
  background: transparent; color: #9aa2ae; font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px; font-family: inherit; flex: 0 0 auto;
}
.csAudioChip:hover { color: #e9ecf1; }
.csAudioChip.on { color: #ffd3a6; background: rgba(255, 176, 102, .13); border-color: rgba(255, 176, 102, .32); }
.csAudioDot { width: 5px; height: 5px; border-radius: 50%; background: #4ade80; }
.csAudioChip.on .csAudioDot { background: #ffb066; }
.csTrayHint { font-size: 11px; color: #6b737f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 分类托盘：fl 双槽 / omni 三分类——每组（标签+计数）+ 缩略条 + 添加瓦片。 */
.csVideoTray { flex-wrap: wrap; row-gap: 8px; }
.csTrayGroup { display: flex; align-items: center; gap: 8px; position: relative; }
.csTrayGroupLabel { font-size: 11px; color: #9aa2ae; flex: 0 0 auto; }
.csTrayGroupLabel b { color: #6b737f; font-weight: 500; font-variant-numeric: tabular-nums; }
.csTrayGroup .csRefMenuPop { left: 0; }
/* 音频参考瓦片：播放/暂停试听（演示「音频可试听」）。 */
.csAudioTile { display: flex; align-items: center; justify-content: center; border: 0; cursor: pointer; background: #12151a; color: #9aa2ae; font-family: inherit; }
.csAudioTile:hover { color: #ffb066; }
.csAudioIcon { display: flex; }
/* ================= REQ-031 / CV-282 Step 2：video 底栏 chips ================= */

/* 模型弹层（演示 312px：勾选行 = 名称 + cap + 基准积分 meta；未上线行置灰）。 */
.csModelPop { width: 312px; }
.csModelCheck { width: 15px; flex: 0 0 auto; color: #ffb066; font-size: 12px; }
.csModelRow { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.csModelCap { font-size: 10.5px; color: #6b737f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.csChipMenuItemOff { color: #525a66; cursor: not-allowed; }
.csChipMenuItemOff .csChipMenuItemLabel, .csChipMenuItemOff .csModelCap { color: #525a66; }

/* 积分明细弹层（演示 popCredit 290px：costRows 逐行 + 本次消耗 + 脚注）。 */
.csCreditPop { width: 290px; }
.csCreditRow { display: flex; align-items: center; justify-content: space-between; padding: 5px 9px; font-size: 12px; color: #e9ecf1; }
.csCreditRowLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csCreditRowValue { color: #ffb066; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.csCreditRowTotal { border-top: 1px solid #2d343f; margin-top: 3px; padding-top: 8px; color: #ffd3a6; }
.csCreditRowTotal .csCreditRowValue { font-size: 14px; font-weight: 600; }
.csCreditFoot { font-size: 10px; color: #6b737f; padding: 6px 9px 2px; line-height: 1.5; }

/* 摄像机标记 chip（演示 cam-chip：开启后挂输入框上方，悬停出 × 移除）。 */
.csCamMarkerRow { display: flex; padding: 0 0 8px; }
.csCamMarker {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px;
  border-radius: 999px; background: rgba(255, 176, 102, .13); border: 1px solid rgba(255, 176, 102, .32);
  color: #ffd3a6; font-size: 12px;
}
.csCamMarkerLbl { pointer-events: none; }
.csCamMarkerSliders { opacity: .72; font-size: 11px; pointer-events: none; }
.csCamMarkerX {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: inherit; background: rgba(255, 154, 138, .16); color: #ff9a8a;
  opacity: 0; transition: opacity .14s; cursor: pointer; font-size: 13px; font-family: inherit;
}
.csCamMarker:hover .csCamMarkerX { opacity: 1; }
/* Step 4 转真：chip 弹出层（演示 .pop：向上弹出、238px、尖角朝下）+ 摄像机面板。 */
.csInputSel { position: relative; display: inline-flex; }
.csInputPill { cursor: pointer; font-family: inherit; }
.csInputPillOn { background: #2b323d; color: #e9ecf1; border-color: #39424f; }
.csInputPillAccent { color: #ffd3a6; background: rgba(255, 176, 102, .13); border-color: rgba(255, 176, 102, .32); }
.csChipPop {
  position: absolute; bottom: calc(100% + 11px); left: 0; width: 238px; z-index: 40;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px; padding: 6px;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .74);
  display: flex; flex-direction: column; gap: 2px;
}
.csChipPop::after {
  content: ""; position: absolute; bottom: -6px; left: 20px; width: 10px; height: 10px;
  background: #1a1e25; border-right: 1px solid #2d343f; border-bottom: 1px solid #2d343f;
  transform: rotate(45deg); border-bottom-right-radius: 2px;
}
.csChipPopSection { font-size: 10.5px; color: #6b737f; letter-spacing: .3px; padding: 7px 9px 2px; }
.csChipPopSub { font-size: 10.5px; color: #6b737f; padding: 0 9px 6px; }
.csChipMenuItem {
  height: 33px; display: flex; align-items: center; justify-content: space-between; gap: 9px;
  padding: 0 8px; border-radius: 8px; border: 0; background: transparent;
  color: #e9ecf1; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; min-width: 0;
}
.csChipMenuItem:hover:not(:disabled) { background: #262c35; }
.csChipMenuItemOn { background: #2b323d; }
.csChipMenuItemLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csChipMenuItemHint { font-size: 10.5px; color: #6b737f; flex: 0 0 auto; }
/* 摄像机面板（演示 .cam 面板：四列步进 + 当前配置 + 重置/总开关）。 */
.csChipPopCamera { width: 264px; padding: 8px; }
.csCameraCols { display: flex; }
.csChipPopCamera { display: flex; flex-direction: column; }
.csCameraCol { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1 1 0; min-width: 0; }
.csCameraColLabel { font-size: 10px; color: #9aa2ae; }
.csCameraStep {
  width: 100%; height: 18px; border: 0; border-radius: 6px; background: transparent;
  color: #6b737f; cursor: pointer; font-size: 12px; line-height: 1; padding: 0; font-family: inherit;
}
.csCameraStep:hover { background: #262c35; color: #ffb066; }
.csCameraValue {
  width: 100%; height: 52px; border-radius: 9px; border: 1px solid #252a33; background: #12151a;
  color: #ffb066; font-size: 11px; display: flex; align-items: center; justify-content: center;
  text-align: center; padding: 2px; overflow: hidden;
}
.csCameraConfig { margin-top: 8px; border: 1px solid #252a33; border-radius: 9px; padding: 6px 9px; display: flex; flex-direction: column; gap: 2px; }
.csCameraConfigLabel { font-size: 9.5px; color: #6b737f; letter-spacing: .3px; }
.csCameraConfigValue { font-size: 11.5px; color: #e9ecf1; }
.csCameraFoot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.csInputPillIconWide { height: 26px; font-size: 11.5px; background: transparent; }
.csCameraToggle {
  width: 40px; height: 22px; border-radius: 999px; border: 0; background: #2a3038;
  position: relative; cursor: pointer; padding: 0; transition: background .15s;
}
.csCameraToggleOn { background: #ffb066; }
.csCameraToggleKnob {
  position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: #e9ecf1; transition: transform .15s;
}
.csCameraToggleOn .csCameraToggleKnob { transform: translateX(18px); }

/* ================= REQ-031 / CV-282 Step 3：影片设置面板（演示 pop-film 1:1） ================= */

/* 面板 688px、居中于 chip（演示注释：弹层比 pill 到面板两侧的距离都大，箭头不再指向 pill）。 */
.csFilmPop { width: 688px; max-width: calc(100vw - 24px); left: 50%; transform: translateX(-50%); padding: 0; gap: 0; }
.csFilmPop::after { display: none; }
/* 双 Tab 共用固定高度：切换时弹层尺寸零变化（高度不一致会整块跳——演示注释原文）。 */
.csFilmSeg { display: flex; gap: 2px; margin: 12px 14px 0; background: #151a21; border: 1px solid #242b34; border-radius: 9px; padding: 2px; }
.csFilmSegBtn {
  flex: 1 1 0; height: 28px; border: 0; background: transparent; color: #9aa2ae; border-radius: 7px;
  font-size: 12.5px; font-family: inherit; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 5px; transition: .14s;
}
.csFilmSegBtn:hover { background: #1e242c; color: #e9ecf1; }
.csFilmSegBtn.on { background: #242a33; color: #e9ecf1; }
.csFilmDot { width: 5px; height: 5px; border-radius: 50%; background: #ffb066; opacity: 0; transition: .14s; }
.csFilmDot.has { opacity: 1; }
.csFilmBody { height: 466px; max-height: min(64vh, 470px); overflow: hidden; display: flex; flex-direction: column; }
.csFilmPane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; padding: 12px 14px 14px; }
.csFilmPanePace { justify-content: center; }
.csFilmSub { font-size: 12px; color: #6b737f; padding: 0 0 10px; }
/* 运镜网格：minmax(0,1fr) 自适应列宽（演示注释：多 1px padding 都会顶出横向滚动条）。 */
.csMvGrid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain; align-content: start;
}
.csMvGrid::-webkit-scrollbar { width: 6px; }
.csMvGrid::-webkit-scrollbar-thumb { background: #39424f; border-radius: 3px; }
.csMvCard { cursor: pointer; user-select: none; border: 0; background: transparent; padding: 0; font-family: inherit; min-width: 0; }
.csMvPh {
  position: relative; display: flex; align-items: center; justify-content: center;
  aspect-ratio: 1 / 1; border-radius: 10px; background: #12161c; border: 1px solid #171a20;
  overflow: hidden; transition: .15s;
}
.csMvCard:hover .csMvPh { border-color: #4a5563; }
.csMvCard.on .csMvPh { border-color: #ffb066; background: rgba(255, 176, 102, .07); }
.csMvIcon { display: flex; color: #6b737f; transition: .15s; }
.csMvIcon svg { width: 32px; height: 32px; }
.csMvCard:hover .csMvIcon { color: #9aa2ae; }
.csMvCard.on .csMvIcon { color: #ffb066; }
/* 荧光绿浮标（演示 .add：#d8ff3e，悬停出现，pointer-events none）。 */
.csMvAdd {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  background: #d8ff3e; color: #1a2200; font-size: 11px; font-weight: 600;
  padding: 3px 9px; border-radius: 99px; opacity: 0; transition: .15s; white-space: nowrap; pointer-events: none;
}
.csMvCard:hover .csMvAdd { opacity: 1; }
/* 已选序号角标（F26：从提示词解析的出现顺序）。 */
.csMvOrd {
  position: absolute; left: 6px; top: 6px; width: 17px; height: 17px; border-radius: 50%;
  background: #ffb066; color: #2a1704; font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.csMvNm { display: block; text-align: center; font-size: 12px; color: #9aa2ae; padding: 5px 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.csMvCard.on .csMvNm { color: #e9ecf1; }
/* 节奏轮播（演示 pc-*：中央大卡 + 相邻暗卡 + 底部 ‹ 名称 pill ›）。 */
.csPcHd { padding: 0 4px 11px; margin: 0 0 14px; border-bottom: 1px solid #171a20; }
.csPcHd b { display: block; font-size: 14px; font-weight: 600; color: #e9ecf1; letter-spacing: .3px; }
.csPcHd span { display: block; font-size: 11.5px; color: #6b737f; margin-top: 3px; letter-spacing: .2px; }
.csPcStage {
  position: relative; height: 200px; overflow: hidden; flex: 0 0 auto;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 84px, #000 calc(100% - 84px), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 84px, #000 calc(100% - 84px), transparent 100%);
}
.csPcTrack { position: absolute; left: 50%; top: 50%; display: flex; gap: 16px; transition: transform .32s ease; will-change: transform; }
.csPcCard {
  position: relative; width: 300px; height: 169px; border-radius: 18px; overflow: hidden;
  background: #12161c; border: 1px solid transparent; flex: 0 0 auto; cursor: pointer; padding: 0; font-family: inherit;
  opacity: .26; transform: scale(.72); filter: saturate(.55) brightness(.5);
  transition: opacity .32s ease, transform .32s ease, filter .32s ease, border-color .32s ease, border-radius .32s ease;
}
.csPcCard:hover { opacity: .5; filter: saturate(.8) brightness(.72); }
.csPcCard.on { opacity: 1; transform: scale(1); filter: none; border-radius: 22px; border-color: color-mix(in srgb, var(--cs-line-hi, #f2f4f8) 16%, transparent); box-shadow: 0 16px 40px rgba(0, 0, 0, .6); }
.csPcCard.on:hover { opacity: 1; }
/* 官方演示视频不复用（拍板②置灰偏差）：静态示意卡面（胶片框 + 官方英文名）。 */
.csPcCardBody {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  background: linear-gradient(160deg, #171d26 0%, #10141a 100%);
}
.csPcIcon { color: #3d4653; display: flex; }
.csPcIcon svg { width: 44px; height: 44px; }
.csPcCard.on .csPcIcon { color: #59636f; }
.csPcEn { font-size: 11px; color: #59636f; letter-spacing: .4px; }
.csPcCard.on .csPcEn { color: #9aa2ae; }
.csPcScrim { position: absolute; left: 0; right: 0; bottom: 0; height: 58px; pointer-events: none; background: linear-gradient(180deg, transparent, rgba(6, 8, 12, .62)); }
/* 卡内剪辑率指示条：段数 = segs（演示口径：一镜到底 = 1 整根不断裂）。 */
.csPcBar { position: absolute; left: 16px; right: 16px; bottom: 14px; display: flex; gap: 5px; }
.csPcBar > i { flex: 1 1 0; height: 3px; border-radius: 2px; background: #d8ff3e; opacity: .9; }
.csPcName { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 16px 0 0; }
.csPcAr {
  width: 32px; height: 32px; border-radius: 50%; border: 1px solid #252a33; background: #161b22; color: #9aa2ae;
  display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; transition: .15s; padding: 0;
}
.csPcAr svg { width: 15px; height: 15px; }
.csPcAr:hover { color: #e9ecf1; border-color: #4a5563; background: #1c222a; }
.csPcVal { min-width: 118px; text-align: center; font-size: 14px; font-weight: 600; letter-spacing: .2px; color: #e9ecf1; background: #1a2027; border: 1px solid #2b323c; border-radius: 99px; padding: 9px 20px; }
.csPcTip { margin: 11px 0 0; text-align: center; font-size: 11.5px; color: #6b737f; letter-spacing: .2px; }
.csPcTip em { font-style: normal; color: #9aa2ae; font-weight: 600; margin-right: 5px; }
@media (prefers-reduced-motion: reduce) {
  .csPcTrack { transition: none; }
  .csPcCard { transition: none; }
}
/* ================= REQ-032 / CV-287 Step 1：audio 形态（音色设计 / 语音生成 / 音乐生成） =================
   类名映射（演示 canvas-audionode-inputbox.html → 本表）：
   .cap-wrap→.csAudioCapWrap / #caption→chips+.csAudioCapFree / .tok→.csAudioTok /
   .body-wrap→.csAudioBodyWrap / #bodyText→.csAudioBodyText /
   .music-wrap→.csAudioMusicWrap / #musicDesc→.csAudioMusicDesc /
   .fmenus→.csAudioFnMenus / .fbtn→.csAudioFnBtn / .fpop→.csAudioFnPop / .fitem→.csAudioFnItem /
   .lyr-sel→.csAudioLyricSel / .lyr-sw→.csAudioLyricSwitch / #popLyr→.csAudioLyrPop /
   .lyr-hd→.csAudioLyrHead / #lyrText→.csAudioLyrText / .lyr-ft→.csAudioLyrFoot /
   .lyr-hint→.csAudioLyrHint / .lyr-ok→.csAudioLyrOk / .layer-row→.csAudioLayerRow。
   accent 渐变 #ffb066→#ff8f3c 与演示 --accent/--accent-2 同值（hex 字面量）。 */

/* 卡主体（演示 .p-body：垂直列，音乐/语音两种模式切换不换布局骨架）。 */
.csAudioBody { display: flex; flex-direction: column; min-height: 0; flex: 0 1 auto; }

/* 描述区（演示 .cap-wrap：圆括号括起词条+自由段；margin 与演示同 32px 2px 9px）。
   与演示的结构差：演示用 contenteditable 让词条与自由文本真·同行混排；React 下
   textarea 不能内嵌 chips，改为 chips 行在上、textarea 整行在下（flex-wrap 换行）。 */
.csAudioCapWrap {
  position: relative; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 0 9px;
  margin: 32px 2px 9px; padding: 9px 11px 9px 26px;
  background: #141920; border: 1px solid #1c2027; border-radius: 12px;
  transition: border-color .16s;
}
.csAudioCapWrap:focus-within { border-color: #39424f; }
/* 左括号固定在 padding 区；右括号绝对定位（textarea 变高时它留在底部）。 */
.csAudioCapWrap::before {
  content: "("; position: absolute; left: 4px; top: 9px;
  color: #9ecbff; font-family: ui-monospace, Consolas, monospace; font-size: 19px; font-weight: 600; line-height: 1.3;
  user-select: none; pointer-events: none;
}
.csAudioCapWrap::after {
  content: ")"; position: absolute; right: 9px; bottom: 5px;
  color: #9ecbff; font-family: ui-monospace, Consolas, monospace; font-size: 19px; font-weight: 600; line-height: 1;
  user-select: none; opacity: .4; pointer-events: none;
}
/* 自由段 textarea（flex-basis 100% 强制换行到词条行之下；chips 行独占第一行）。 */
.csAudioCapFree {
  flex: 1 1 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #e9ecf1;
  font-size: 14px; line-height: 1.85; font-family: inherit;
  min-height: 64px; max-height: 150px; overflow-y: auto; cursor: text; resize: none; padding: 0; margin: 0;
}
.csAudioCapFree::placeholder { color: #6b737f; }
/* 词条 chip（演示 .tok：蓝系底、悬停浮出 ×；× 走按钮而非伪元素——可访问性）。 */
.csAudioTok {
  display: inline-flex; align-items: center; gap: 4px; height: 21px; padding: 0 5px; margin: 2px;
  border-radius: 6px; background: rgba(96, 165, 250, .10); border: 1px solid rgba(96, 165, 250, .34);
  color: #9ecbff; font-size: 12.5px; line-height: 1; white-space: nowrap; user-select: none;
}
.csAudioTok:hover { background: rgba(96, 165, 250, .18); }
.csAudioTokX {
  width: 14px; height: 14px; border-radius: 50%; border: 0; padding: 0; background: transparent;
  color: #9ecbff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  margin-right: -2px; opacity: 0; transition: opacity .13s; font-size: 12px; line-height: 1; font-family: inherit;
}
.csAudioTok:hover .csAudioTokX { opacity: 1; }
.csAudioTokX:hover { color: #ff7b7b; background: rgba(255, 123, 123, .15); }
/* 分隔符（层内「，」/跨层「；」）：与正文同色同字号。 */
.csAudioSep { color: #e9ecf1; font-size: 14px; line-height: 1.85; align-self: center; }

/* 正文区（演示 .body-wrap / #bodyText：语音/音色设计的必填正文）。 */
.csAudioBodyWrap {
  position: relative; display: flex; margin: 0 2px; padding: 9px 13px 9px 35px;
  background: #141920; border: 1px solid #1c2027; border-radius: 12px; transition: border-color .16s;
}
.csAudioBodyWrap:focus-within { border-color: #39424f; }
.csAudioBodyText {
  flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: #e9ecf1;
  font-size: 14px; line-height: 1.78; font-family: inherit;
  min-height: 52px; max-height: 130px; overflow-y: auto; cursor: text; resize: none; padding: 0; margin: 0;
}
.csAudioBodyText::placeholder { color: #6b737f; }

/* 音乐描述（演示 .music-wrap / #musicDesc：音乐生成下唯一的文本入口）。 */
.csAudioMusicWrap {
  position: relative; display: flex; margin: 32px 2px 0; padding: 9px 13px;
  background: #141920; border: 1px solid #1c2027; border-radius: 12px; transition: border-color .16s;
}
.csAudioMusicWrap:focus-within { border-color: #39424f; }
.csAudioMusicDesc {
  flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: #e9ecf1;
  font-size: 14px; line-height: 1.78; font-family: inherit;
  min-height: 64px; max-height: 150px; overflow-y: auto; cursor: text; resize: none; padding: 0; margin: 0;
}
.csAudioMusicDesc::placeholder { color: #6b737f; }

/* 底栏左区（演示 .pf-left：fn 菜单 + 歌词选择 + 四层层 pill，同一行不换行）。 */
.csAudioFootLeft { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.csAudioLayerRow { display: flex; align-items: center; gap: 6px; min-width: 0; }

/* 节点功能菜单（演示 .fmenus / .fbtn / .fpop / .fitem：渐变主钮 + 向上弹出三项）。 */
.csAudioFnMenus { position: relative; flex: 0 0 auto; }
.csAudioFnBtn {
  font-family: inherit; height: 32px; padding: 0 11px 0 10px; border: 0; border-radius: 999px; cursor: pointer;
  background: linear-gradient(180deg, #ffb066, #ff8f3c); color: #2a1704;
  display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; letter-spacing: .2px;
  /* 演示原值 inset 0 1px 0 rgba(255,255,255,.26)——白色字面量在浅色主题下不可见，
     按 CV-261 材料纪律改走 --cs-line-hi 的 color-mix（与 .csNodeInputCard 同法）。 */
  box-shadow: 0 6px 16px rgba(0, 0, 0, .34), inset 0 1px 0 color-mix(in srgb, var(--cs-line-hi, #f2f4f8) 26%, transparent);
  transition: filter .15s;
}
.csAudioFnBtn:hover { filter: brightness(1.06); }
.csAudioFnIcon { display: flex; flex: 0 0 auto; }
.csAudioFnCaret { width: 11px; height: 11px; flex: 0 0 auto; opacity: .78; transition: transform .18s; }
.csAudioFnMenus.open .csAudioFnCaret { transform: rotate(180deg); }
.csAudioFnPop {
  position: absolute; left: 0; bottom: calc(100% + 8px); min-width: 100%; z-index: 40;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px; padding: 5px;
  box-shadow: 0 26px 60px rgba(0, 0, 0, .72);
  display: flex; flex-direction: column; gap: 2px;
}
.csAudioFnItem {
  width: 100%; font-family: inherit; font-size: 13px; height: 34px; padding: 0 13px; border: 0; border-radius: 9px;
  background: transparent; color: #9aa2ae; cursor: pointer; text-align: left; white-space: nowrap;
  display: flex; align-items: center; transition: .13s;
}
.csAudioFnItem:hover { background: #242a33; color: #e9ecf1; }
.csAudioFnItem.on { background: linear-gradient(180deg, #ffb066, #ff8f3c); color: #2a1704; font-weight: 600; }
.csAudioFnItem.on:hover { filter: brightness(1.05); }

/* 人声歌词选择（演示 .lyr-sel：pill + 侧拨开关；仅音乐生成渲染）。 */
.csAudioLyricSel { display: inline-flex; align-items: center; gap: 6px; position: relative; }
.csAudioLyricSwitch {
  width: 34px; height: 19px; border-radius: 999px; border: 0; background: #333b46; cursor: pointer;
  position: relative; transition: background .18s; flex: 0 0 auto; padding: 0; align-self: center;
}
.csAudioLyricSwitch i {
  position: absolute; top: 2.5px; left: 2.5px; width: 14px; height: 14px; border-radius: 50%;
  background: #aab3c0; transition: .18s;
}
.csAudioLyricSwitch.on { background: #ffb066; }
.csAudioLyricSwitch.on i { left: 17.5px; background: #2a1704; }
/* 歌词弹层（演示 #popLyr：344px 上弹；尖角对齐 pill）。 */
.csAudioLyrPop {
  position: absolute; bottom: calc(100% + 11px); left: 0; width: 344px; padding: 0; z-index: 40;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .74);
  display: flex; flex-direction: column;
}
.csAudioLyrPop::after {
  content: ""; position: absolute; bottom: -6px; left: 20px; width: 10px; height: 10px;
  background: #1a1e25; border-right: 1px solid #2d343f; border-bottom: 1px solid #2d343f;
  transform: rotate(45deg); border-bottom-right-radius: 2px;
}
.csAudioLyrHead { font-size: 12.5px; font-weight: 600; color: #e9ecf1; padding: 12px 13px 9px; }
.csAudioLyrText {
  display: block; width: calc(100% - 26px); margin: 0 13px; height: 118px; resize: none;
  background: #141920; border: 1px solid #1c2027; border-radius: 10px; color: #e9ecf1;
  font-family: inherit; font-size: 13px; line-height: 1.7; padding: 9px 11px; outline: 0;
}
.csAudioLyrText:focus { border-color: #39424f; }
.csAudioLyrText::placeholder { color: #6b737f; }
.csAudioLyrFoot { display: flex; align-items: center; gap: 8px; padding: 10px 13px 12px; }
.csAudioLyrHint { font-size: 11px; color: #6b737f; margin-right: auto; }
.csAudioLyrOk {
  height: 28px; padding: 0 15px; border: 0; border-radius: 999px; cursor: pointer;
  background: linear-gradient(180deg, #ffb066, #ff8f3c); color: #2a1704;
  font-family: inherit; font-size: 12px; font-weight: 600; transition: filter .15s;
}
.csAudioLyrOk:hover { filter: brightness(1.06); }

/* ============ 四层设置面板（REQ-032 / CV-287 Step 2，演示 .pop-layer / .pophd / .set-body 1:1）============
   四层共用同一结构（VoiceLayerPop），差异全在 DIMS 数据里。定位贴 pill 上方、
   越界翻转与视口夹取由组件的 useLayoutEffect + 定位类负责（同 placeChrome 口径）。 */
.csAudioLayerPop {
  position: absolute; left: 0; bottom: calc(100% + 11px); width: 432px; z-index: 40;
  max-width: calc(100vw - 24px); padding: 0;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .74);
  display: flex; flex-direction: column;
}
.csAudioLayerPop::after {
  content: ""; position: absolute; bottom: -6px; left: 20px; width: 10px; height: 10px;
  background: #1a1e25; border-right: 1px solid #2d343f; border-bottom: 1px solid #2d343f;
  transform: rotate(45deg); border-bottom-right-radius: 2px;
}
/* 头部（演示 .pophd：色点 + 层名 + 清空 + 关闭）。 */
.csAudioPanelHd {
  display: flex; align-items: center; gap: 8px; padding: 12px 13px;
  border-bottom: 1px solid #1c2027; flex: 0 0 auto;
}
.csAudioPanelDot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.csAudioPanelHt { flex: 1 1 auto; min-width: 0; }
.csAudioPanelHt b { font-size: 13px; color: #e9ecf1; font-weight: 600; }
.csAudioPanelClr {
  font-family: inherit; height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid #2d343f; color: #9aa2ae; font-size: 11.5px;
  transition: .13s; flex: 0 0 auto;
}
.csAudioPanelClr:hover { background: #262c35; color: #e9ecf1; }
.csAudioPanelClose {
  width: 28px; height: 28px; border-radius: 8px; cursor: pointer; flex: 0 0 auto;
  background: transparent; border: 0; color: #6b737f;
  display: flex; align-items: center; justify-content: center; transition: .13s;
}
.csAudioPanelClose:hover { background: #262c35; color: #e9ecf1; }
/* 滚动主体（演示 .set-body：max-height min(62vh,452px) + 底部内边距）。 */
.csAudioPanelBody {
  max-height: min(62vh, 452px); overflow-y: auto; padding: 0 8px 8px; flex: 1 1 auto;
}
/* 维度分组头（演示 .h4 + .h4star + .h4cnt）。 */
.csAudioPanelH4 {
  display: flex; align-items: center; gap: 5px; margin: 11px 3px 7px;
  font-size: 11.5px; font-weight: 600; color: #9aa2ae; letter-spacing: .3px;
}
.csAudioPanelStar { width: 11px; height: 11px; color: #ffb066; flex: 0 0 auto; }
.csAudioPanelCnt { margin-left: auto; font-size: 10.5px; color: #6b737f; font-weight: 500; }
/* 分隔线（演示 .dv）。 */
.csAudioPanelDv { height: 1px; background: #1c2027; margin: 10px 3px; }
/* 词条网格（演示 .wgrid：auto-fill 到 ~92px，多选带上限禁用）。 */
.csAudioPanelGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }
.csAudioPanelW {
  font-family: inherit; height: 32px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  background: #1e222a; border: 1px solid #2d343f; color: #9aa2ae;
  font-size: 12.5px; transition: .13s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.csAudioPanelW:hover:not(:disabled) { background: #262c35; color: #e9ecf1; }
.csAudioPanelW.on { background: #2b323d; border-color: #39424f; color: #e9ecf1; font-weight: 600; }
.csAudioPanelW:disabled { opacity: .45; cursor: not-allowed; }
/* 单选段（演示 .seg / .seg-b：选中亮底）。 */
.csAudioPanelSeg { display: flex; gap: 6px; flex-wrap: wrap; }
.csAudioPanelSegB {
  font-family: inherit; height: 32px; padding: 0 13px; border-radius: 8px; cursor: pointer;
  background: #1e222a; border: 1px solid #2d343f; color: #9aa2ae; font-size: 12.5px; transition: .13s;
}
.csAudioPanelSegB:hover { background: #262c35; color: #e9ecf1; }
.csAudioPanelSegB.on { background: #eef1f5; border-color: #eef1f5; color: #14171c; font-weight: 600; }
/* 滑杆（演示 input[type=range].sl：档位词作值，拖到哪写哪个词，永不写数字）。 */
.csAudioPanelBlk { padding: 4px 3px 2px; }
.csAudioPanelBlkHd { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; }
.csAudioPanelBlkHd b { font-size: 12.5px; color: #e9ecf1; font-weight: 600; }
.csAudioPanelBMax { font-size: 10.5px; color: #6b737f; margin-left: auto; }
.csAudioPanelSlide {
  -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 999px; outline: 0;
  background: linear-gradient(90deg, #ffb066 var(--p, 50%), #333b46 var(--p, 50%)); cursor: pointer;
}
.csAudioPanelSlide::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: #ffb066; border: 0; cursor: pointer;
}
.csAudioPanelSlide::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%; background: #ffb066; border: 0; cursor: pointer;
}
.csAudioPanelTicks {
  display: flex; justify-content: space-between; margin-top: 5px;
  font-size: 10.5px; color: #6b737f;
}
.csAudioPanelTicks .mid { color: #9aa2ae; }
/* 选中 pill 的 accent 高亮（演示 .lpill.has）。 */
.csAudioLayerPillHas {
  color: #ffd3a6; background: rgba(255, 176, 102, .13); border-color: rgba(255, 176, 102, .32);
}

/* ===================== 参考音色槽（REQ-032 Step 3，演示 .ref-slot :604）=====================
   住在描述框左上：+ 空态 ↔ 已选（波形 art + title）；× 清除；三来源内联菜单。 */
.csAudioRefSlotWrap { position: relative; display: inline-flex; flex: 0 0 auto; margin-right: 6px; align-self: flex-start; }
.csAudioRefSlot {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px;
  border: 1px dashed #39424f; border-radius: 7px; background: transparent; color: #9aa2ae;
  font-family: inherit; font-size: 11.5px; cursor: pointer; transition: border-color .15s, color .15s;
}
.csAudioRefSlot:hover { border-color: #ffb066; color: #e9ecf1; }
.csAudioRefPlus { font-size: 16px; line-height: 1; font-weight: 500; }
.csAudioRefLb { font-size: 9px; letter-spacing: 0; line-height: 1.15; white-space: nowrap; }
.csAudioRefWave { display: flex; align-items: flex-end; gap: 2px; height: 15px; overflow: hidden; border-radius: 3px; }
.csAudioRefWave.sm { height: 11px; }
.csAudioRefWave i { display: block; width: 2px; border-radius: 1px; background: #7dd3fc; }
.csAudioRefWave i:nth-child(1) { height: 30%; } .csAudioRefWave i:nth-child(2) { height: 60%; }
.csAudioRefWave i:nth-child(3) { height: 90%; } .csAudioRefWave i:nth-child(4) { height: 50%; }
.csAudioRefWave i:nth-child(5) { height: 100%; } .csAudioRefWave i:nth-child(6) { height: 70%; }
.csAudioRefWave i:nth-child(7) { height: 40%; } .csAudioRefWave i:nth-child(8) { height: 80%; }
.csAudioRefSlot.has { border-style: solid; border-color: rgba(255, 176, 102, .5); color: #ffb066; }
.csAudioRefX {
  display: none; width: 15px; height: 15px; border-radius: 50%; cursor: pointer;
  background: #2b323d; color: #9aa2ae; font-style: normal; font-size: 12px; line-height: 15px;
  text-align: center; margin-left: 2px; transition: background .15s, color .15s;
}
.csAudioRefSlot.has:hover .csAudioRefX { display: inline-block; }
.csAudioRefX:hover { background: #ff7b7b; color: #1c1410; }
/* 三来源内联菜单（沿 image/video 三来源口径；演示是模态 pk，产品一致性优先 §八）。 */
.csAudioRefPop {
  position: absolute; top: calc(100% + 6px); left: 0; width: 236px; z-index: 40;
  background: #1a1e25; border: 1px solid #2d343f; border-radius: 12px; padding: 6px;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .74); display: flex; flex-direction: column; gap: 2px;
}
.csAudioRefPop::after {
  content: ""; position: absolute; top: -5px; left: 20px; width: 10px; height: 10px;
  background: #1a1e25; border-left: 1px solid #2d343f; border-top: 1px solid #2d343f;
  transform: rotate(45deg); border-top-left-radius: 2px;
}
.csAudioRefPopHead {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 11.5px; color: #6b737f; padding: 5px 9px 6px;
}
.csAudioRefPopItem {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 9px; border: 0; border-radius: 8px;
  background: transparent; color: #9aa2ae; font-family: inherit; font-size: 12.5px; cursor: pointer;
  text-align: left; transition: background .13s, color .13s;
}
.csAudioRefPopItem:hover:not(:disabled) { background: #262c35; color: #e9ecf1; }
.csAudioRefPopItem:disabled { opacity: .45; cursor: not-allowed; }
.csAudioRefPopItem.on { background: #2b323d; color: #e9ecf1; font-weight: 600; }
.csAudioRefPopLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csAudioRefPopHint { font-size: 10.5px; color: #6b737f; padding: 4px 9px 5px; }
.csAudioRefPopEmpty { font-size: 12px; color: #6b737f; text-align: center; padding: 22px 9px; }
`

/** Inject the studio stylesheet once per browser lifetime. */
export function installStudioStyles(): () => void {
  const element = document.createElement('style')
  element.setAttribute('data-plugin', 'canvas-studio')
  element.textContent = STUDIO_STYLES
  document.head.appendChild(element)
  return () => { element.remove() }
}