# Canvas Studio — 交接与开工路线图（2026-10-03 深夜 · 第三版）

> **这是新会话的第一入口**。配套：`bug-report.md`（39 条 Bug 底稿 + §5 对账/修复账）、`requirements.md`（20 条需求底稿 + §六对账）、`../canvas-studio/docs/{bug-tracker,requirement-tracker}.md`（仓内落地映射，BUG-00X/REQ-00X 权威号）、`bug-analysis/`（18 份逐 bug 修复文档）。
> 本版取代第二版：三轮会话（对账 → 六批 bug 修复 → 需求批 D/E/F）已把 39 条 Bug 修到只剩 4 条未修、可开工需求清掉大半，全部落在本地 dev **未 push**。

---

## 一、状态快照（2026-10-03 深夜）

- **dev 领先 origin 17 笔提交**（`61927ac421`..`43f4e6abc6`），工作树干净，**未 push**——运行时 checkout（`~/Desktop/job/git/playsout/videobuddytest`）看不到，要同步先 push。
- **门禁**：每批独立过 typecheck / build / verify:loader / 全量 smoke（失败 0）；本日累计新增约 40 条测试（守卫 + 行为）。
- **全部代码改动均为「已修复·待桌面验收」**，验收通过后才登记 STATUS.md（铁律：不预写）。
- 文档账已同步：bug-report §5.2~5.4、requirement-tracker（REQ-004/015/016/017/019/020）、bug-tracker（BUG-005 定案）。

## 二、已交付总账（按主题）

| 主题 | 内容 | 依据 |
|---|---|---|
| 文档对账 | tracking 三文档对账修订版 + 18 份逐 bug 修复文档（bug-analysis/） | `61927ac421` `dcb6fc02af` |
| A-1 引用一致性 | 槽位媒体类型过滤 + 指名道姓跨类型报错 + 模式读数真值 + 自愈换名三份记录同步 + supersede/覆盖下游改写 | `cdfe097bd9` `267c32c6e2` 批F |
| C-10/加图竞态 | overwriteNodeAsset 下游改写 + appendCanvasNode 走 merge-protect | `267c32c6e2` |
| 编排 | 一个分镜 = 一条视频（C-16/R-P0-11 纪律 + 密度口径） | `936bba50dc` |
| TTS/提示词 | C-5 音色一致性 / C-11 文字单处 / C-6·C-7 BGM 口径 | `75b183920c` `a6d3c8bf9a` |
| 失败卡/报错 | 预检失败不落红卡（C-15/A-12）+ C-4 可行动报错 | `f0bd0c2c6e` |
| 标签/血缘 | D-2 标签语义 + filenameTail 血缘缺口 | `6c30fc71e8` |
| 分辨率 | C-8 三处文案真值 + 源码守卫 | `cdfe097bd9` |
| 文档收口 | REQ-015/016/017/019（GATED_TOOLS 零命中 / tts 反判据 / withtxt 装饰性排除 / drama 档位） | `63524d5407` |
| 画布交互 | R-P0-12 手动连线第一增量（点选断开 + 拖线建点）/ R-P2-01 鼠标操作（滚轮缩放、批量引用、选中强化）/ A-4 占位预连 / A-9 拖入落点 / A-5 文案卡 | `212805da7a` `1cc9b66a98` `65f076ab9a` |
| 删除语义定案 | **用户拍板：删除 = 彻底删除、不回退**——撤销栈清空 / 硬删 + deletedAt / B-4 force 解引用 / A-13 删除前告警 / D-3 supersede 下游改写 | `511afcf51d` |
| 小修 | B-3 视频禁入库 / E-3 目录到秒 / A-11 播放定高 / A-8 镜号校验 / C-9 标签区分 / C-14 描述反例 | `d421fd538e` |

## 三、桌面验收攒批（明天第一件事——一批验完，过了就登记 STATUS）

按主题给最短验收路径（详细步骤在各文档）：

1. **删除语义**（重点）：删被视频引用的图 → 确认框列引用方 → 文件真删（.trash 不再新增）→ Ctrl+Z 不恢复；历史面板删被引用产物 → 409 列名 → force 全流程；改角色形象（重调 character_sheet 同名）→ 旧四视图失效、下游视频 Picture 槽自动换新句柄、重生成用新形象。
2. **画布交互**：点边高亮 → Delete 断开 → Ctrl+Z 恢复；节点右缘拖线到另一节点出线、拖到空白 → 菜单建点自动带线；滚轮缩放手感；Ctrl 多选 → 右键「引用到对话（N 个）」；生成中占位卡在分镜组旁且有边；拖 txt/mp3/mp4 落在松手点；文案卡跟分镜组、长文折叠。
3. **生成正确性**：设置 480p → 出 480p（C-8）；多分镜片按分镜数出片、shot 是节拍（C-16）；30s 旁白全程一个音色（C-5）；预检失败不再堆红卡（C-15）；图片判失效报错可读（C-4）；多参考视频连线标签「参考 N/分镜」（D-2）；带字海报走 withtxt、背景霓虹走 Krea2（REQ-019）。
4. **登录细节**：竖屏视频双击不裁切（A-11）；连续新建项目目录带秒（E-3）；视频右键无「加入资产库」（B-3）；分镜表混策略行 → 指名道姓报错（A-8）。

验收通过 → 按「验收通过后登记」落 STATUS + 两份镜像 + 资料库（带 library skill 同步）。

## 四、未完成 Bug（4 条）与优先级

| 序 | Bug | 状态 | 明天的动作 |
|---|---|---|---|
| 1 | **E-1 首页异常/空项目目录（致命）** | 两个嫌疑点已代码定位（`projects.ts:838` readDocument 硬抛错链；认领失败自增循环 + Windows 路径比对），**需用户提供** `$DSH_HOME/canvas-studio/projects.json` + 插件日志（`CS-DEV-ERR`/「首页准备失败」/「已被占用」）定案 | 先向用户取证；等不及可先做防御性加固（案 A 单条坏记录隔离 / 案 B 路径归一化 + 失败上限，方案见 bug-analysis/E-1.md） |
| 2 | **A-2 大画布性能** | 三热点已代码确证（StudioFrame 全树重渲染+手势回调击穿 memo / CanvasEdges 全量重算 / 废弃素材开关全量重排） | 按 bug-analysis/A-2.md 三步走：useCallback 保 memo（低风险先行）→ 边视口裁剪 → 开关退化纯过滤 |
| 3 | **A-10 分镜组排布** | tidyGroupLayout 加 `mode:'shot'` 角色分列，方案完备 | 照 bug-analysis/A-10.md 做（默认 grid 行为逐字节不变） |
| 4 | **D-1 末帧卡收起** | `auxiliary` 字段 + 渲染过滤 + 工具栏开关，方案完备 | 照 bug-analysis/D-1.md 做 |

行为层定案待证据（代码侧已修）：C-9（agent 为何升级 composite——skill 缺口已补）、C-14（CS-USER-002 复发——描述已修）。C-2/A-7 只差用户验收。

## 五、未完成需求与优先级

**直接可开工（按序）：**
1. **E-2 启动停留首页**（R-P2-02 残余）——homePinned 置位，方案在 bug-analysis/E-2.md，半天。
2. **R-P1-03 提示词按语言呈现 + 模型路由统一决策点**——先出设计（决策点落 param-guard 哪层、语言呈现数据流、路由表留槽），拍板不阻塞框架。顺带吃掉 C-12。
3. **R-P0-12 二增量**——拖线中高亮可落目标、断开生成边的确认提示（见 requirement-tracker REQ-020）。

**等输入：** R-P1-02 lora（先取资料库附件 prompt-sample.txt/skills.zip）；R-P2-03（等 CV-201 出包 + ffprobe）；R-P1-05（等 R-P0-02）。

**拍板闸（卡住什么写在你面前，见 §六）。**

**已销项**（勿再派单）：R-P0-03 主体（剩 Step 4 立项）、R-P0-04、R-P0-05、R-P0-06、R-P0-10 接口本体、R-P1-01、R-P1-04、R-P2-02。已落待验收：R-P0-11、R-P0-12 第一增量、R-P2-01、REQ-015~017/019。

## 六、拍板清单（每条都写了不拍板卡住什么）

1. **Krea2 vs qwen（R-P0-08/09）**——整个模型路由主题的总闸门；不拍板则 R-P1-03 的路由表只能留槽。
2. **R-P0-02 音色资产设计口径**（@引用形态、TTS 接线）——卡 R-P1-05 微信视频。
3. **R-P0-01 两阶段 Storyboard 排期**——产品第一优先级，是否提前于其他一切。
4. **R-P0-07 音频模式标记**（BGM vs 说话参考音的节点侧属性）——卡拖拽音频收尾。
5. **R-P0-03 Step 4（AI 改写）是否立项**。
6. **REQ-018 withtxt 错字路线**（重跑优先 vs image_fix）。

## 七、铁律（动代码前必读）

1. 只修「产生数据的路径」，不动历史数据；**删除已定案为例外**：彻底删除、不可撤销（确认是唯一防线）。
2. 验证分层：T1 视觉 → build+定向+桌面验收；T2 布局纯函数 → build+定向+preview 组；T3 跨进程/守卫/host 边界 → 全量 node --test + verify-previews + 反向变异。基线红以 `tests/baseline-red.json` 为准（当前实测 0 失败）。
3. `deepseek-harness/` 是 pinned submodule，绝不在桌面分支改；pin 更新与行为变更分开提交。
4. 双 checkout：开发 = `~/Desktop/job/learn/video_buddy`，运行时 = `~/Desktop/job/git/playsout/videobuddytest`（不 push 运行时看不到）。
5. 编号 SSOT = `canvas-studio/docs/STATUS.md`（当前上限 CV-276，日常 +1）；文档登记在**验收通过后**落。
6. git insteadOf 会把 https 改写 SSH——比对 remote 的门禁先 `GIT_CONFIG_GLOBAL=/dev/null` 中和。
7. GUI/Electron 注意 `ELECTRON_RUN_AS_NODE=1` 泄漏（启动前 env -u）；universal 构建需用户本机跑；Electron 下载自备镜像变量。
8. 文档四层：资料库（intake SSOT）→ `docs/tracking/` 底稿 → `canvas-studio/docs/{bug-tracker,requirement-tracker}.md`（落地映射）→ STATUS.md（CV 号 SSOT）。

## 八、交接提示词（新会话整段粘贴）

```
续接 Canvas Studio（video_buddy 仓库 dev 分支）。

【现状】docs/tracking/action-plan.md（第三版，2026-10-03 深夜）是唯一入口：
17 笔提交在本地 dev 未 push，全部「待桌面验收」；39 条 Bug 已修 35 条（剩 A-2/A-10/D-1/E-1），
可开工需求剩 E-2、R-P1-03、R-P0-12 二增量；拍板清单在 §六。

【明天顺序】① 先按 §三 桌面验收攒批（一批验完，过了登记 STATUS + 两份镜像）；
② E-1 取证（问用户要 projects.json + 日志）；③ 按序开工：A-2 三步 → A-10/D-1 →
E-2 → R-P1-03（先出设计）→ R-P0-12 二增量。逐 bug 方案都在 docs/tracking/bug-analysis/。

【用户意图】今天开始处理所有未完成的需求与 bug，按 action-plan §四/§五 的优先级派单；
需要拍板的（§六）逐条问用户；每批完成后自测（门禁全绿）并提交，commit 前跑全量 smoke。

【铁律】见 action-plan.md §七（删除已定案「彻底删除不回退」；T1/T2/T3 分层；SSOT；
双 checkout；GIT_CONFIG_GLOBAL 中和；Electron 环境变量）。

【开工指令】直接给条目编号（如「做 A-2」「验收 §三.1」）即可。
```
