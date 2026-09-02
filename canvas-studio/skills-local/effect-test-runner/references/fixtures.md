# 效果测试固定输入（fixtures）

> 本文件是 effect-test-runner 的用例数据源：每条用例的固定需求文本（假数据）、预期清单、image2vl 比对 prompt。**执行时逐字使用，不要即兴改需求**——固定输入是长期对比可比性的前提。
>
> **通用预设答案表**（上游 skill 提问时按此直接推进，不调 ask_user_choice）：成片时长=用例各自指定；画幅=用例各自指定；风格=按 fixtures 需求文本中的风格描述；其余未列出的确认项一律取推荐项并在报告备注。

## 通用 image2vl 比对 prompt（两段，逐字使用）

- **角色特征提取**：`List this person's visual features as short tags: hair (style/color/length), face shape, clothing (type/color), shoes, and any accessories. Output tags only, one per line.`
- **场景特征提取**：`List this scene's visual features as short tags: landmarks, ground/road type, light direction and color, weather effects, and notable props. Output tags only, one per line.`

比对规则：各镜输出取交集，交集占比 < 70% 记「漂移」，并在报告列出漂移的具体标签。

---

## T1 · Ref2VA 基础烟雾（含 T2 采集项）

**固定需求文本**（放手跑模式下作为用户需求逐字注入）：

> 单镜精品短片，8 秒，16:9，写实风格：一个穿深蓝色风衣、黑色短发的年轻男人在雨夜的城市街道上奔跑，霓虹灯倒映在湿漉漉的柏油路面上，镜头从中景推近到近景。不要对白，紧张配乐。

**预期清单（自动判定）**：

1. 视频走 `video_composite` 且 `filenames` 恰为 2 张（定妆照 + 场景概念图），不是 1 张首帧
2. prompt 六段齐全且按序：`subject_definitions:` / `summary:` / `retention_analysis:` / `detailed_description:` / `overall_soundscape:` / `non_diegetic_music:`
3. `summary` 以 `[reference generation]` 开头
4. `subject_definitions` 中出现 `<Subject 1>`（角色）与 `<Subject 2>`（场景），且编号在全文一致
5. `detailed_description` 为具体画面/动作/运镜描述（含时间轴或过程性描写），非情节摘要
6. 时长描述 ≈ 8 秒（±2s 内不判错，明显超出判错）
7. 全文不出现 `<Video N>` 或 `<Audio N>`（本项目无视频/音频参考）
8. `retention_analysis` 使用四个标记之一（fully_preserved / partially_preserved / attribute_transfer / weak_reference）

**画面质量（T1 的最终判定）留人工**：报告附产物 url，C 维度留空待评。

---

## T1b · 固定参考图烟雾（跨轮可比性用）

**与 T1 的差异**：不现场生成定妆照/场景概念图，改用本 skill 资源目录内的固定素材——`assets/character-anchor.png`（深蓝风衣男主定妆照）与 `assets/scene-concept.png`（雨夜霓虹街道场景图）。**执行步骤**：先把两张固定图分别调 `upload_image(imageUrl=<本 skill 资源目录的绝对路径>/assets/character-anchor.png 与 …/scene-concept.png)` 拿 filename，再以固定需求文本走 Ref2VA 直出。

**固定需求文本**：与 T1 逐字相同。

**预期清单（自动判定）**：

1. `video_composite` 的 `filenames` 恰为这 2 张固定图（按上传返回的 filename 核对）
2. T1 预期清单第 2–8 项全部适用（六段式结构检查同 T1）

**用途**：消除「锚点图每次重新生成」的方差——跨轮跑 T1b，产物差异纯归因于 skill 改动。锚点生成质量由 T3 间接覆盖。

---

## T3 · 关键帧组合参考一致性

**固定需求文本**：

> 多镜头叙事短片，30 秒，16:9，写实风格：一位扎马尾、穿米色风衣的年轻女研究员在晨雾笼罩的山村考察——镜 1 远景村庄全貌，镜 2 中景她走过石板路查看老屋，镜 3 近景她俯身拾起陶片端详，镜 4 全景她望向山口晨雾散开。环境音为主，舒缓弦乐。

**预期清单（自动判定）**：

1. 每镜 `image_generate` 的 `filenames` 均为 2 张（定妆照 + 场景概念图）
2. 分镜表 4 镜，关键帧成功产出 ≥3 张（T3 只测到关键帧确认前即可停止，**不跑视频生成**——控制成本，视频层一致性由 T4 人工对比覆盖）
3. 对每张关键帧分别调 image2vl 角色 prompt + 场景 prompt，产出跨镜特征词表；角色标签交集 ≥70% 且场景标签交集 ≥70% 判通过

**停止点**：跑完关键帧即写报告结束本用例（auto 模式下 submit_keyframes_for_approval 直接放行，无需等确认，但也不继续生成视频）。

---

## T5 · FL2VA 首尾帧路由回归

**固定需求文本**：

> 多镜头叙事短片中的单镜，8 秒，16:9，写实风格：书桌上的牛皮纸信封从完全合上到完全展开露出信纸，桌面暖黄台灯，镜头缓慢俯推。环境音为主，无对白。

**前置**：该项目需已有定妆照/场景图可作参考（无则按创作规范先出图，但本用例重点是路由判定）。

**预期清单（自动判定）**：

1. 该镜视频走 `video_composite` 且 `filenames` 恰为 2 张（首帧状态图 + 尾帧状态图），不是 3+ 张多参考
2. prompt 首行为 FL2VA 对齐指令：`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark...`（前缀匹配即可）
3. prompt 主体为三字段结构（`integrated_multimodal_description:` / `overall_soundscape:` / `non_diegetic_music:`），而非六段式
4. 会话记录显示模型读的是 h3-prompt-writing 的 `base-en.txt` 而非 `ref-en.txt`（从 skill 加载与 read 行为判断，读不到就标「无法确认」）

---

## T6 · 单镜模式端到端

**固定需求文本**：

> 社媒传播的单条 15s 精品短片，9:16，写实风格：雨夜霓虹街头，一只橘猫蜷在便利店门口的纸箱里，抬头望向镜头，尾巴轻摆，霓虹灯在它眼睛里反光。环境音为主，慵懒爵士。

**预期清单（自动判定）**：

1. 流程为单镜简化路径：未调用 `storyboard_generate` / `storyboard_split` / `compose_video`
2. 节奏/镜头数要素未被询问（放手跑下本就不问——核对假设清单里是否注明跳过）
3. 单镜方案经 `submit_storyboard_for_approval` 提交后（auto 模式直接放行）视频工具成功出片
4. 产物为 1 段 ≤15s 视频，未经 compose_video 拼接
5. 用户要求重试时：同 prompt 再次生成，画布出现并列候选节点（此子项仅在用户显式要求时执行）

**留人工**：逐步确认（confirm）模式下的门禁放行兼容性（自动化只覆盖 auto 模式）。

---

## 不自动化用例的原因备忘（用户问起时回答）

- **T4（AB 对比）**：需要旧版 SKILL.md 生成对照臂 + 人工按量表评分，自动化只能做采集臂；版本切换（stash/切 commit/重建）有破坏工作区的风险，必须人来操作。
- **T7（降级路径）**：前置是改名 `skills/h3-prompt-writing` 目录并重建——影响全局注册，自动化执行风险高；人工改名后可让执行器跑 T1 流程观察降级行为。
- **T8（澄清序号）**：被测行为是逐步确认模式下 ask_user_choice 的提问顺序，与放手跑模式互斥；人工开 confirm 模式走一轮即可。
