# 会话效率与布局能力优化方案（2026-10-26）

> 来源：2026-10-26 对 DSH 会话 `session.v4 2.jsonl`（code-driven-explainer 智能手表介绍片，空项目起步）的复盘分析，与后续「布局能力如何让 LLM 稳定产出」的方案讨论。
> 性质：方案讨论稿，未领 CV 号；实施时按编号拆 CV。

## 1. 背景：一次会话的时间账

会话 10:20:14 → 10:37:51，总 **17.6 min**，产出仅推进到第一次澄清提问（ask_user_choice），无任何生成类调用。

| 构成 | 耗时 | 占比 |
|---|---|---|
| 44 次工具实际执行（全为 read/grep/cat） | ≈12 s | 1% |
| 模型推理间隔（工具调用之间） | ≈10 min | 57% |
| ask_user_choice 等用户回答 | 3.2 min | 18% |
| 其余小间隔/流式输出 | ~4 min | 24% |

时间全部烧在**模型多轮反复思考**与**等用户**上；工具执行本身可忽略。六个阶段中三处结构性浪费（详见 §2 各优化点）：

1. **执行模式确认 ~5.5 min**：`workflow.mode=confirm` 就在项目记录里，模型却 6 轮推理、查错目录、翻源码才确认。
2. **渲染器能力考古 ~3.3 min**：文档未写明 video/image 无 `box`、textCard 全屏居中，模型直接读 remotion 源码（VideoClip/ImageClip/manifest.ts/TextCard 等）推导分屏做法。
3. **references 分 6 批读取**：13 个文件分散读取，每批之间夹 20–110 s 推理间隔。

## 2. 优化点总表

| 编号 | 优化点 | 层 | 解决的问题 | 预期收益 | 依赖 |
|---|---|---|---|---|---|
| OPT-1 | Runtime context 注入 `workflow.mode` | 平台（host） | 模型不知道 confirm/auto，反复试探 6 轮 | 每会话省 ~4–5 min | 无 |
| OPT-2 | manifest 契约统一 `box` 语义 + validator fail-closed | 平台（contract+renderer+validator） | 布局靠 transform 心算，错误要渲染后才暴露 | 消除整类几何算术错误；布局声明化 | 无 |
| OPT-3 | skill 新增 `layout-recipes.md`（box 标准用法 + 截图） | skill 文档 | 非全屏布局每个会话都重新源码考古 | 每会话省 ~3 min；与 OPT-2 一份成本两份收益 | OPT-2（内容随 box 定稿） |
| OPT-4 | 技能加载后的 references 批量读取指引 | skill prompt | 分 6 批读文档，每批夹一次推理往返 | 省 1–2 min | 无 |
| OPT-5 | Runtime context 注入 projects.json 路径 | 平台（host） | 模型猜错 `~/.videobuddy` 位置（本会话两次） | 免去目录试探 | 无 |
| OPT-6 | 探查类 grep 限定子目录 | skill 文档（约定） | 全仓 `grep -rln` 8.3 s 且噪声大 | 秒级 | 无 |
| OPT-7（缓行） | manifest 级命名布局模板 `layout.preset` | 平台 | 进一步降低布局表达成本 | 待 OPT-2 落地后按使用分布决定 | OPT-2 |

明确**不做**的：不改历史数据/存量项目；不为 ask_user_choice 等待时间做优化（那是用户决策时间，合理成本）。

## 3. 各优化点详情与验收

### OPT-1 Runtime context 注入 `workflow.mode`

**问题**：runtime context 快照（`Current runtime context...` 注入块）含 cwd、file policy、approval policy，但**不含当前项目的 `workflow.mode`**（confirm/auto）。模型无法判断是否该 ask_user_choice，只能翻源码、查 projects.json 反复确认（本会话 S7/S8/S10/S16/S24/S26–S28 共 6 轮）。

**方案**：host 侧组装 runtime context 时，把项目记录中的 `workflow.mode` 及一句话语义注入快照，例如：
`Current canvas workflow mode: "confirm" (step-by-step; use ask_user_choice at clarification and per-stage gates).`
auto 模式对应注明「放手跑，ask_user_choice 不提问不等待」。

**改动落点**：runtime context 组装处（host，dsh-plugin-desktop 侧）；不改项目状态机本身。

**验收**：
1. 单测：组装函数对 `mode=confirm` / `mode=auto` / 缺省三种项目记录，产出的快照文本各含对应 mode 与语义句。
2. 行为断言（守卫可反向变红）：构造无 mode 注入的快照断言其不含「workflow mode」字样。
3. 真机冒烟：新开会话看首屏注入块是否含 mode；观察模型首个 reasoning 不再出现「is it auto or confirm」类试探（对比本会话 6 轮）。

### OPT-2 manifest 契约统一 `box` + validator fail-closed（主体方案）

**问题**：布局原语太低层。video/image track 无定位字段，铺满 AbsoluteFill，分屏只能靠 `transform.scale`+`position` 手算；textCard 全屏居中，需 animate 位移。LLM 做几何心算：单位混乱（比例 vs px）、aspect 换算、出画布、z-order——错误要等一次分钟级渲染才暴露。校验报错是秒级且便宜的，渲染返工是分钟级且贵的；本方案把错误尽量拦在校验层。

**方案**：
1. contract：所有 clip 类型（videoClip/imageClip/textCard/shape）统一支持 `box: {x, y, w, h}`，**全部 0–1 比例值，禁 px**；现有 groups 内 textCard 的 box 语义对齐收敛，不另起炉灶。
2. renderer：`box` 在渲染层 resolve 成现有 transform，渲染代码路径不变，只换声明层。
3. validator（fail-closed）：box 越界（任一分量 <0 或 >1、x+w>1.02 等）、类型错、px 值 → 拒收；每条错误附一句可执行修正指引（「box.w=1.2 超出画布，应为 0–1」），让模型收到 rejection 后无需重读文档即可自纠。
4. 内置 safe-area 检查（如默认安全边距 0.04，`x+w ≤ 0.96`，可显式声明越过）。
5. `transform` 原语保留为逃生舱；「用了 transform 又可用 box」给 warning 引导收敛，**不硬禁**。
6. 明确边界：`box` 只管区域声明，z-order 仍由 track 顺序决定，文档写死这一条。

**改动落点**：`src/contracts/`（manifest 类型 + validator）、`src/remotion/`（VideoClip/ImageClip/TextCard/Shape 各一处 resolve）、对应类型导出。

**验收**：
1. contract 单测：合法 box 各 clip 类型通过；非法值矩阵（越界/负值/px/缺字段）逐条拒收且错误信息含修正指引——**反向变异必须能变红**（删掉任一条校验规则对应测试即红）。
2. resolve 单测：`box={x:0.42,y:0,w:0.58,h:1}` 在 16:9 与 9:16 两种画布下 resolve 出的 transform 数值断言（比例值不受画布尺寸影响）。
3. 渲染验证：一张 split-lr 分屏 manifest 走 verify:loader / 渲染管线出图，目视左文右视频无越界（对照 §OPT-3 配方截图）。
4. 回归：存量不含 box 的 manifest 全部照常渲染（box 可选字段，不破坏现有项目）。
5. 按 T3 级要求：全量 `test:smoke` + verify-previews。

### OPT-3 skill 新增 `layout-recipes.md`

**问题**：renderer 能力（video/image 无 box、textCard 全屏居中、分屏需 transform/box）只存在于源码里，每个做非全屏布局的会话都要重新考古 ~3 min。

**方案**：`canvas-studio-creation`（及 code-driven-explainer 按需引用）新增 reference：每个配方 = 可复制 manifest 片段（参数占位）+ 渲染截图（`assets/layout-demos/`）+ 参数表 + 适配场景。首批配方：`split-lr`（左右分屏讲解）、`split-tb`、`full-bleed`、`picture-in-picture`、`lower-third`。OPT-2 落地前先以 transform 写法给 split-lr 应急版；OPT-2 落地后全部改写为 box 写法并删除 transform 应急段（**保持文档与契约同版本，不出现两套并行写法**）。风格映射的「四处同改」惯例同样适用：recipes.md ↔ 截图 ↔ validator 规则 ↔ contract 示例。

**验收**：
1. 文档评审：每个配方片段可直接通过 OPT-2 validator（或落地前的现有契约校验）。
2. 真机冒烟：新会话只读 recipes 不读源码，产出 split-lr manifest 一次通过校验（对比本会话 3.3 min 考古）。
3. 截图与渲染结果一致（截图即该配方 manifest 的真实渲染产物，非手画）。

### OPT-4 references 批量读取指引

**问题**：模型分 6 批读 13 个 reference，每批之间夹 20–110 s 推理间隔，多付 1–2 min 纯推理往返。

**方案**：技能总纲（canvas-studio-creation 主 SKILL.md 或路由段）加一条工作流约定：加载技能后**按必读清单一次批量读取**（clarification/manifest-contract/toolchain/shot-cards/subtitle-timing + 按场景追加），禁止「读一批→想一轮→再读一批」的串行模式。注意总纲 11KB 硬闸与指针覆盖率 ≥50% 的约束，该指引以一两句指针形式写，不展开。

**验收**：
1. 总纲体积闸通过（`test:smoke` 中 skill 尺寸/覆盖率断言）。
2. 真机冒烟：新会话 reference 读取轮次 ≤2 批（从日志数 tool/call 分批次数，对比本会话 6 批）。

### OPT-5 Runtime context 注入 projects.json 路径

**问题**：模型为找项目记录先后查 `~/.videobuddy/projects.json`、`~/.videobuddy/canvas-studio/projects.json`（均错），最后才定位到 `~/Desktop/job/VideoOut/new222/projects.json`。

**方案**：runtime context 快照加一行项目记录绝对路径（与 OPT-1 同一注入点、同一次改动，建议合并实施）。

**验收**：与 OPT-1 共用注入单测（断言快照含路径行）；真机冒烟确认模型首步即可读到项目记录，无目录试探调用。

### OPT-6 探查类 grep 限定子目录（约定，随手改）

**问题**：`grep -rln "awaitingLanding" --include=*.ts .` 在仓库根全仓扫描，8.3 s 且跨包噪声大。

**方案**：在 skill 工具链文档中加一句约定：探查宿主实现一律限定 `canvas-studio/src` 或明确包目录，不做仓库根全仓 grep。纯文档约定，无代码改动。

**验收**：文档合入即可；后续会话日志抽查（非闸）。

### OPT-7 命名布局模板（缓行，不在本期）

`layout: {preset: "split-lr", params: {...}}`，renderer resolve。等 OPT-2 落地后统计真实会话中 box 使用分布，高频重复组合再固化为 preset。避免过早形式化。

## 4. 实施顺序与拆分建议

| 批次 | 内容 | 说明 |
|---|---|---|
| 批次 1 | OPT-1 + OPT-5（同一注入点）+ OPT-4 + OPT-6 | 低风险、纯增量，先拿走每会话 ~6 min 固定成本 |
| 批次 2 | OPT-2（contract + renderer + validator） | T3 级平台改动，独立立项，按 §3 验收清单走 |
| 批次 3 | OPT-3（recipes 改写为 box 版） | 依赖批次 2 定稿 |
| 缓行 | OPT-7 | 观察后定 |

## 5. 总体验收口径

- 批次 1 后：同类「空项目起步 → 第一次澄清」会话从 ~17.6 min 降到 ~11–12 min（对比口径：同技能、同空项目、同 confirm 模式跑一次冒烟会话，对时间线分阶段计时）。
- 批次 2/3 后：降到 ~7–8 min；且分屏类布局 manifest **首次提交即过校验**（validator 零 rejection 为准），渲染目视无越界/压叠。
- 所有守卫/校验类改动必须可反向变红；验证分层按铁律执行（clean.mjs → tsdown → tsc 双 tsconfig → verify:loader，T3 加全量 test:smoke + verify-previews）。

## 6. 实施记录（2026-10-26，批次 1+2+3 一次性落地，待全量测试）

| 项 | 状态 | 落点 |
|---|---|---|
| OPT-1+5 | ✅ 代码完成 | `src/workflow-mode-prompt.ts`（新，order 155 小节 + agent/created 预热 + 自愈）；`projects.ts` 增公开 `registryFile` getter；`index.ts` 注册；`routes.ts` setMode 成功后 `invalidateWorkflowModeCache()`（热切换不发事件，主动失效） |
| OPT-2 | ✅ 代码完成 | `remotion/manifest.ts`：`ManifestBox` + `BaseTrack.box`（自 ShapeTrack 上提）+ `validateBoxRegion` / `boxPositionConflict` 接入 validateManifest；`VideoClip.tsx` / `ImageClip.tsx`（box → 盒子定位层 + overflow hidden + cover 裁剪，背景色进盒子）；`TextCard.tsx`（layer 改写为盒子定位层，四 variant 共用）；`host-tools.ts` render_composition 描述硬边界⑤改写 |
| OPT-3 | ✅ 文档完成 | `canvas-studio-creation/references/layout-recipes.md`（新：split-lr / split-tb / PiP / lower-third / full-bleed 五配方 + box 速记 + 已知边界；截图待真机渲染补）；`code-driven-explainer/references/manifest-contract.md` 增 box 字段条目 |
| OPT-4 | ✅ | 总纲 SKILL.md「分册一次读全」指针（11KB 闸内：11,255B） |
| OPT-6 | ✅ | `toolchain.md` 平台事实清单第 14 条（grep 限定子目录 + projects.json 路径指路） |
| OPT-7 | 缓行 | 按 §2 原计划 |

**与原方案的偏差（讨论后拍板的实现决策）**：

1. **box 单位 0–1 → 0–100 画布百分比、x/y 为区域中心**：契约里 `shape.box` / `transform.x/y` / `orbit.center` 全部是 0–100 中心语义，引入第二套单位（0–1 左上角）必然被模型混用。铺满 = `{x:50,y:50,w:100,h:100}`。
2. **safe-area 闸不做**，只查出画布（出界 ±0.01 容差拒收）：94% 安全边距硬闸会拒掉合法的全屏轨，且配方文档已给「全屏留安全边」写法。
3. **shape 轨完全豁免新校验**（互斥 + 出画布都不查）：shape 的 box 是存量能力，animate x/y 覆盖 box 落点是契约明文支持的写法、示例本有 `x:0,y:0` 贴边值——收紧会拒掉历史 manifest，违反「不动存量」铁律。新校验只作用于新获得 box 的 video/image/textCard。
4. **与 groups 的关系**：`expandGroups`（2026-10-25）本就消费组内 track.box、展开成绝对坐标后才跑 validateManifest——通用 box 与 groups 天然互补（此前组内 video/image 的 box 展开后渲染器不认，现在真正生效了），无需额外改动。

**已通过的验证**：`tsc` 三份 tsconfig 全绿 + `tsdown` 打包成功；SKILL.md 11KB 闸内（11,255B ≤ 11,264B）、`layout-recipes.md` 已纳入 `skill-catalog.test.mjs` CREATION_BOOKLETS 存在性守卫。**未跑**（等用户决定）：test:smoke 全量、verify:loader、分屏 manifest 实渲截图。
