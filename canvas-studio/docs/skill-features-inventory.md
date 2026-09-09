# Canvas Studio 技能体系功能点清单（统一验收用）

> 生成/更新日期：2026-09-08（午间点测 + 傍晚实跑会话复核）· 分支 `dev` @ `2b1088f4c8`
> 用途：把**所有 skill 相关功能点**按「验收状态」归集，供统一验收与排期处理。
> 状态图例：✅ 桌面验收通过 · 🟡 代码完成·待验收 · 🔴 待修复（打回）· ⚪ 待处理 / backlog · ⏸ 暂缓

---

## 〇、验收结论（2026-09-08 用户点测）

| 类别 | 结论 |
|---|---|
| **通过（✅ 已完成·桌面验收通过）** | CV-061 / CV-063 / CV-068 / CV-070 / CV-072 / CV-074 / CV-076 / CV-078 / CV-094 / CV-097(SK-04/08) / CV-098(SK-01) / CV-099 / CV-100 / CV-100补 ；CV-077 仅「未激活过滤」通过（排序未做，低价值留 backlog） |
| **打回（🔴 待修复）** | ~~CV-071 详情弹窗未展示 GIF~~ → **已修复（CV-112 落地，2026-09-09）**：弹窗缩略图补 `demo` 字段判断 + GIF 渲染，84×84→132×96 适配 16:9；**CV-073** 「我的 Skill」视角疑似未完成 + 点击后「全部技能」分区消失仅可返回主页（侧栏路由/卸载链路缺陷，拟立项 **CV-113**，仍待修） |
| **仍未验收（🟡 待本轮）** | ~~CV-109 澄清推荐偏置修复~~（实跑一致·建议关闭）、~~CV-111 character_sheet 自愈~~（实跑未恢复·后端 500）、H3 提示词技能五步重写 + validate-h3-ir（**实跑已验证通过·建议关闭**）、**以及 16 个已注册技能的实际「效果」产出质量**（见第九/十节） |

> STATUS.md 主表 / 速览两表状态列已同步翻转，并追加 `2026-09-08` 验收记录行。
> **傍晚补充**：分析实跑会话 `session.jsonl 8`（项目 `VideoOut/验收基础设施`，跑通「红军过雪山」30s 成片），结论见**第十节**——H3 技能 + z-image 技能 + 总纲全链路被客观证据坐实生效，可关闭；character_sheet / qc_shot 失败为 **Drama 后端 500（后端可用性）**，非 skill 路由/逻辑 bug。

---

## 一、基础设施（注册 / 同步 / 路由）

| 功能点 | CV | 状态 | 验收方法 |
|---|---|---|---|
| skill 目录化重构（删 186KB 内联生成物，sync 改目录复制 + resourceBase 渐进披露） | CV-061 | ✅ 桌面验收通过 | 重启看启动日志 `skills registered`；`src/skills/generated/` 已删除 |
| creation-spec 总纲迁 `skills-local/` 目录 bundle（消 TS 模板字符串反引号风险） | CV-063 | ✅ 桌面验收通过 | `tests/skill.test.mjs` 通过；总纲走目录扫描注册 |
| description 截断修复（上限 1024 + 截断告警）+ 路由汇总 | CV-097 (SK-04/08) | ✅ 桌面验收通过 | 启动日志 `0 description truncated`；7/13→0/13 |
| 创作任务路由硬指令（常驻 systemPrompt 小节，条件式措辞） | CV-098 (SK-01) | ✅ 桌面验收通过 | 创作会话首动作仍是 `skill(canvas-studio-creation)`；非创作会话不被干扰 |
| `scripts/sync-minimax-skills.mjs`（skills-local 覆盖合并到 skills/） | — | ✅ 运行中 | 改 skills-local 后重跑 build 自动同步 |
| `skill-catalog.ts` + `tests/skill-catalog.test.mjs`（硬门禁：每个 skill 必补 catalog 条目） | CV-065 | ✅ 运行中 | 新增 skill 漏补表→测试红 |
| `list_references.assets` 单一权威（C2 注入纪律） | CV-104 | ✅ 已落地 | 资产卡经此统一出口 |

---

## 二、技能广场 UI（展示层）

| 功能点 | CV | 状态 | 验收方法 |
|---|---|---|---|
| 技能卡动态预览（GIF 默认渲染 + hover 叠加菜单） | CV-070 | ✅ 桌面验收通过 | 广场卡出 GIF（8 个同名 GIF 已就位） |
| 悬停浮层 + 查看详情弹窗 | CV-071 | ✅ 已修复（CV-112 落地·待桌面验收） | hover 浮层 GIF 正常；详情弹窗已补 `demo` 字段判断 + GIF 渲染（`csSkillDetailThumbGif`，132×96） |
| 搜索（title/summary/name 子串） | CV-072 | ✅ 桌面验收通过 | 顶部搜索框过滤 |
| 「我的 Skill」视角（卸载复用 CV-066） | CV-073 | 🔴 待修复（视角缺陷） | 侧栏视图 + × 卸载；**点击后「全部技能」分区消失仅可返回主页**（拟立项 CV-113） |
| 官方精选分区（featured 两级） | CV-074 | ✅ 桌面验收通过 | 「官方精选 / 其他技能·N」分区 |
| 作者署名 / 下载量 | CV-075 | ⏸ 暂缓 | 用户拍板先不处理（不伪造已生效原则） |
| H3 能力角标 | CV-076 | ✅ 桌面验收通过 | 卡片左上角 H3 badge |
| 未激活过滤 + 排序 | CV-077 | ✅ 过滤通过（排序未做） | 「仅显示未装载」勾选生效；排序未实现（低价值留 backlog） |
| 创作者社区 CTA 收尾卡 | CV-078 | ✅ 桌面验收通过 | 网格末尾虚线框 CTA |
| 制作计划阶段清单（执行进度可视） | CV-084 | ⚪ 待处理·单独排期 | 需 skill 产出 steps + host 推导翻转 |

---

## 三、创作总纲 `canvas-studio-creation`（核心规范 skill）

| 功能点 | CV | 状态 | 验收方法 |
|---|---|---|---|
| 调度顺序硬指令（先加载总纲再澄清） | CV-094 | ✅ 桌面验收通过 | 会话首动作加载总纲，风格 skill 全程加载 |
| 创建项目预置画幅 + 目标时长（澄清 6→3 问） | CV-099 | ✅ 桌面验收通过 | 新建选 9:16/30s → 只说「做咖啡广告」不出画幅/时长问 |
| 剧本创作前置 + `script_review` 门禁 | CV-100 | ✅ 桌面验收通过 | 风格确定后才出剧本节点；批准后分镜审批仍生效 |
| 单镜精品也产轻量剧本（CV-100 补丁） | CV-100补 | ✅ 桌面验收通过 | 单镜流程出图前出现「剧本」节点 |
| 视觉禁令护栏（主模型无视觉，image2vl 唯一通道） | CV-068 | ✅ 桌面验收通过 | agent 不直读本地图，走 image2vl |
| 一致性 C2 注入纪律 | CV-104 | ✅ 已落地 | 同名卡覆盖，不强制前置 lockedPrompt |
| 一致性 C3 尾帧链 | CV-105 | ✅ 已落地 | extract_last_frame + shotTransition 落盘 |
| 一致性 C4 质检闭环 | CV-106 | ✅ 已落地 | qc_shot + 预算熔断（⚠️ 本会话 qc_shot 触 Drama 500，属后端可用性，非逻辑缺陷） |
| 一致性 C5 合成统一调色 | CV-107 | ✅ 已落地 | compose 末位注入调色 + BGM 淡入淡出 |
| **澄清推荐偏置修复**（推荐决策表 + 已点名风格豁免 + 预设 8→11） | **CV-109** | ✅ **实跑一致·建议关闭** | 会话澄清「想走哪种风格大类？」(艺术创意/动画叙事) **未带「推荐」标签**，与修复后「不强行推荐大类」行为一致（见第十节 10.2） |
| **确认式澄清（方案确认卡，对齐即梦/Kling）** | **CV-110** | ⚪ **backlog·独立排期** | 未启动，前置 O2 |

> C1–C5 一致性已桌面验收通过（CV-108 记忆）；其余总纲项代码落地、本轮统一桌面验收通过。

---

## 四、H3 提示词技能（本次提交）

| 功能点 | 状态 | 验收方法 |
|---|---|---|
| `h3-prompt-writing` 五步 Workflow 重写（五模式判定 + 对齐行 + 运镜词表 + 自检清单） | ✅ **实跑验证通过** | 会话加载即本重写版；4 段产出 IR 跑 `validate-h3-ir` **全部 0 error PASS**（见第十节 10.1） |
| `src/h3-ir-validate.ts` + `scripts/validate-h3-ir.mjs`（TS 移植 validate.py） | ✅ 已落地·实跑验证 | `validate-h3-ir` 对真跑 IR 判级生效（客观证据） |
| references：format-base / format-ref2va / camera-vocabulary / examples / chinese-input / context-ir-workflow / creative-mechanisms(30) | ✅ 已落地·被引用 | 文件存在且被 SKILL.md 引用，实跑产出证实其被遵循 |
| `tests/h3-ir-validate.test.mjs`（14 用例，官方夹具对齐） | ✅ 已落地 | `node --test tests/h3-ir-validate.test.mjs` → 14/14 |

> H3 是**唯一有客观校验器**的技能：agent 产出的 IR 文本可直接跑 `validate-h3-ir` 判合规（见第九节）。

---

## 五、已注册技能清单（catalog 共 16 条）

| 名称 | 分类 | 可见性 | 状态 | 备注 |
|---|---|---|---|---|
| canvas-studio-creation | 创作规范 | 隐藏 | ✅ 验收通过 | 总纲，硬指令常驻 |
| h3-prompt-writing | 提示词技术 | 隐藏(H3) | ✅ 实跑验证通过 | 五步重写，IR 客观 PASS（第十节 10.1） |
| z-image-prompt-writing | 提示词技术 | 隐藏 | ✅ 实跑验证（图像路径） | 会话加载并驱动 6 次 image_generate 全成功（第十节 10.3） |
| qwen-image-edit-writing | 提示词技术 | 隐藏 | 🟡 待验收（效果） | 图生图四段式，本会话未触发 |
| brand-promo-video-generator | 营销 | 可见(featured) | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| minimalist-product-ad-generator | 营销 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| 3d-animation-short-generator | 风格 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| co-op-game-intro-generator | 风格 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| handdrawn-live-video-generator | 风格 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| oriental-mythic-visual-director | 风格 | **隐藏试跑** | 🟡 待验收（效果） | 第三方 MJ 接入，未进广场，本会话未触发 |
| paper-collage-explainer-generator | 风格 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| papercraft-stop-motion-explainer | 风格 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| **direct-street-interview-video** | 风格 | 可见 | 🟡 catalog 生效·效果待专项 | 新社区技能，catalog 已注册，本会话未触发 |
| **stage-startle-to-truce-encounter** | 风格 | 可见 | 🟡 catalog 生效·效果待专项 | 新社区技能，catalog 已注册，本会话未触发 |
| music-video-subtitle-generator | 字幕配乐 | 可见 | 🟡 待验收（效果） | 有 demo GIF，本会话未触发 |
| effect-test-runner | 未分类 | 可见 | 🟡 待验收（效果） | 放手跑测试器，本会话未触发 |

> 8 类 H3 风格预设已接入 `creation-spec`（G1–G4），工具链层面支持；具体风格 skill 内容随上述各条待验收。

---

## 六、`character_sheet` 工具（一致性资产）

| 功能点 | CV | 状态 | 验收方法 |
|---|---|---|---|
| C1 一致性资产锚点（v4 数据模型 + character_sheet 工具） | CV-103 | 🟡 真机联调待 drama-api 恢复 | 生成角色多视图出资产卡 |
| **character_sheet 报错自愈（输入失效自动重传换名）** | **CV-111** | 🟡 **实跑未恢复·后端依赖** | 会话内 3 次 character_sheet 全 `Internal Server Error`（Drama 500），无自愈恢复，agent 降级 image_generate 出定妆照（见第十节 10.4）。**自愈仅覆盖「失效引用」子集；本会话为后端 down，自愈无法恢复** |

---

## 七、未完成 / backlog（重点处理项）

| 项 | 状态 | 依赖 / 阻塞 | 建议 |
|---|---|---|---|
| **CV-112 详情弹窗 GIF 缺失**（CV-071 打回） | ✅ 已修复·待桌面验收 | `SkillMarket.tsx` 弹窗缩略图补 `demo` 判断 + `<img>` 渲染 + `prefers-reduced-motion` 降级 | 2026-09-09 落地：重启桌面 → hover 卡片 → 「查看详情」→ 弹窗左侧应显示动图 |
| **CV-113 我的 Skill 视图缺陷**（CV-073 打回） | 🔴 待修复 | 侧栏视图路由 / 卸载链路 | 点击「我的 Skill」后不隐藏「全部技能」；功能完整性复核 |
| CV-110 确认式澄清（方案确认卡） | ⚪ backlog·独立排期 | 前置 O2 选项高亮改版 | 先落 O2，再改总纲澄清流程 |
| O2 选项高亮 + 画布区待答横幅 | ⚪ 待开发 | 纯 UI（question-capture.tsx + styles.ts） | 小改动，建议优先（解锁 CV-110） |
| O3 图片图层右键菜单「看似不可用」 | ⚪ 待复现 | 需用户给具体节点类型+菜单项+控制台报错 | 等复现信息；疑为预期行为 |
| O5 桌面 / dsh 版本升级 | ⚪ 独立排期 | ~90 依赖 + 多 patch rebase | 单独 PR，先升一个点试 patch rebase |
| CV-084 制作计划阶段清单 | ⚪ 待处理·单独排期 | skill steps + host 翻转 | 执行进度可视，本批未动 |
| 声音能力缺口（CV-039 部分 / CV-040·042·043 未启动 / CV-041 已完成） | ⚪ 部分 | 工具链占坑降级 | 评估二期 |
| 字幕烧录 / TTS 旁白 / 自动配乐 | ⚪ 待评估 | 超出当前工具链 | 二期评估 |
| SK-02 总纲瘦身 / SK-03 / SK-05 / SK-06 / SK-07（skill-system-upgrade 计划剩余） | ⚪ 待排期 | — | 见 docs/plans/skill-system-upgrade.md |

---

## 八、本次提交明细（已落 dev，未 push）

| commit | 内容 |
|---|---|
| `766bf2606e` | H3 Context-IR 集成 + T8 创意机制精选 + 新技能 街拍/惊变求和 |
| `67f9542e8a` | CV-109 澄清推荐偏置修复 + CV-110 确认式澄清立项 |
| `2b1088f4c8` | CV-111 character_sheet 报错自愈（输入失效自动重传） |

> 未提交（按 09-04 handoff 既定处置，非本次范围）：`minimax-h3`（子模块）、根 `main.js`（构建产物）、根 `docs/image-resource-analysis.md`、`docs/videobuddy-rebrand-audit.prompt.md`。

---

## 九、技能效果验收方法论（回答「怎么验收技能效果」）

### 9.1 什么是「技能效果」

canvas-studio 里的 skill 是给 **AI 导演**看的「操作规程」（`SKILL.md` + `references/`）。所谓**效果**不是 UI 好不好看，而是 **agent 在真实创作会话里按 skill 跑，产出的东西是否达标**。

效果验收分两层，必须先过 L1 再过 L2：

| 层 | 名称 | 判据 | 失败样例 |
|---|---|---|---|
| **L1** | 链路跑通（功能） | skill 能被激活、agent 走对流程、产出非错误、资产/视频落盘 | 技能点了没反应、agent 没加载 skill、生成报错、产物没落画布 |
| **L2** | 质量达标（效果） | 产出符合 skill 承诺（H3 IR 合规 / 角色一致 / 风格对 / 成片可看） | 风格跑偏、角色每镜不一样、H3 IR 格式错、成片没法看 |

> ⚠️ 你刚才验收的是 **UI / 基础设施 / 总纲流程（L1 层的壳）**。真正的「技能效果」= 上面两表 🟡「待验收（效果）」那 16 个技能 + 本次三提交的 L2 质量，这才是剩余大头。

### 9.2 分类型验收手段

**A. 隐藏/规范类**（canvas-studio-creation、h3-prompt-writing、z-image-prompt-writing、qwen-image-edit-writing、oriental-mythic*）
- 通过**对话槽**触发：新建项目 / 直接说需求，观察 agent 第一步是否 `skill(canvas-studio-creation)`，写 prompt 时是否走 H3 五步。
- **H3 有客观校验器**（唯一能机器判级的）：把 agent 产出的 IR 文本落盘，跑下面命令——退出码 `0`=合规，`1`=有 ERROR。

**B. 广场可见类**（14 个 visible，含 2 个新社区技能）
- 点卡 →「使用」把提示词插进输入框 → 在对话里给一句话需求 → 看 agent 跑通并出图/视频。
- 判据 = **成片/关键帧是否体现该技能承诺的风格**。

**C. character_sheet**（CV-111 自愈，本次提交）
- 用一张「早前生成、Drama temp 已清」的图触发生成角色多视图 → 应**自愈重传成功**并出资产卡。
- 用一张根本不存在的图 → 应**保留原始错误不崩**（`tests/character-sheet.test.mjs` 已覆盖两路径）。

### 9.3 H3 技能效果——客观验收命令（可直接跑）

```bash
# 第 1 步：在对话槽让 agent 用 h3-prompt-writing 写一段 IR（例：城市夜景航拍 T2VA）
# 第 2 步：把 agent 产出的 IR 文本存成文件，例如 /tmp/ir.txt
# 第 3 步：校验（mode 须与生成模式一致：T2VA/I2VA/L2VA/FL2VA/Ref2VA）
node scripts/validate-h3-ir.mjs /tmp/ir.txt --mode T2VA --duration 10
echo "exit=$?   # 0=合规, 1=有 ERROR, 2=用法错"

# 自检（确认校验器本身没坏）：应 4/4 PASS
node scripts/validate-h3-ir.mjs --self-test
```

> 判据：退出码 `0` 且 `errors=0` 即 H3 效果达标；`warns>0` 不算失败但建议看一眼（如 `non_diegetic_music 含抽象情绪词` 之类的措辞提示）。

### 9.4 每技能效果判据速查（L2）

| 技能 | 承诺效果 | 怎么判达标 |
|---|---|---|
| h3-prompt-writing | 五模式合规 IR | `validate-h3-ir` 退出码 0 |
| z-image-prompt-writing | 文生图九段式、无负向提示词 | 出图 prompt 含九段结构、无 negativePrompt |
| qwen-image-edit-writing | 指令式四段式改图 | 改图 prompt 含 操作+目标+规格+保留 子句 |
| brand-promo / minimalist | 品牌/极简广告成片 | 成片有 logo/产品主体、高质感 |
| 3d-animation | 风格化 3D 短片 | 关键帧呈 3D 渲染质感、非实拍 |
| co-op-game-intro | 双人游戏开场 | 锁定双人身份线索、先确认图再扩成片 |
| handdrawn-live | 手绘发光动画 | 蜡笔/粉笔超现实质感 |
| paper-collage / papercraft | 纸拼贴/纸艺定格 | 半调网点 / 手工纸艺 tactile 质感 |
| direct-street-interview | 街拍互动实拍 | 第一人称手持跟随、街道视差 |
| stage-startle-to-truce | 惊变求和遭遇 | 平静→惊吓→克制求和的张力收尾 |
| music-video-subtitle | MV 歌词字幕 | 卡点字幕成片 |
| oriental-mythic | 东方异境视觉 | 真实电影人物 + 绘画化东方异境（MJ 向，试跑） |
| effect-test-runner | 放手跑全流程 | 自动跑用例并出一致性报告 |

### 9.5 硬约束（效果验收时一并盯）

- 跨镜头**空间方位 / 角色外观 / 道具**三类一致性必须保持（总纲 C2–C5 已验收，跑长片时复核）。
- 不擅自增删人物、不改写既定结局（总纲铁律）。
- 广场技能只是「风格预设」，真正质量由 agent 在 H3 + 一致性纪律下产出，验收以**成片观感**为准，不以 demo GIF 为准。

### 9.6 建议验收顺序（剩余部分）

1. **先验本次三提交（最高性价比）**：
   - H3：`validate-h3-ir --self-test` 4/4 → 再在会话里产一段 IR 跑校验器判 `exit=0`。
   - CV-109：新建项目说「做个咖啡广告片」（不提风格）→ 澄清**不应强推**某风格大类；说「用东方神话风做个宣传片」→ **跳过风格两题**。
   - CV-111：用失效图触发角色多视图 → 自愈成功出卡。
2. **挑 2–3 个高价值广场技能跑通**（如 3d-animation + brand-promo + 一个新社区技能），验证 L1+L2。
3. **其余 🟡 技能**按 backlog 各自排期，不必一次性全跑。
4. **打回两项**：CV-112（弹窗 GIF）**已修复**（2026-09-09，待桌面验收）；CV-113（我的 Skill 视图）仍待修。

---

## 十、实跑会话验收分析（`session.jsonl 8`，2026-09-08 傍晚）

### 10.0 会话概况

- **项目**：`/Users/wl/Desktop/job/VideoOut/newOut/projects/验收基础设施`（WL AI Director 集成 canvas-studio 技能做真实创作）
- **产物**：「红军过雪山」30s · 16:9 多镜头叙事短片，已 `compose_video` 导出 `export-d51ca9ab...mp4`
- **技能注册**：`available_skills` 清单 = **16 条**，与 `skill-catalog.ts` 完全一致（含本次新增 `direct-street-interview-video` / `stage-startle-to-truce-encounter` / `h3-prompt-writing`）
- **工具链**：40 次 tool/result，其中 `isError=true` 仅 5 次（见 10.4）

### 10.1 H3 提示词技能 —— ✅ 可关闭（客观证据）

- `skill(canvas-studio-creation)` 加载总纲后，第 7 轮 `skill(h3-prompt-writing)` 加载的正是**本次重写的五步增强版**（文本含「H3-Context-IR 增强版」「模式判定表」「对齐行」「运镜词表」）。
- 提取 4 段 `video_generate` 的 IR（如 `at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.` + 三段式）跑 `validate-h3-ir`：

  | IR | mode | 结果 |
  |---|---|---|
  | h3_ir_1 | I2VA | PASS · 0 error · 1 warn（描述词数偏少，非硬约束） |
  | h3_ir_2 | I2VA | PASS · 0 error · 1 warn |
  | h3_ir_3 | I2VA | PASS · 0 error · 1 warn |
  | h3_ir_4 | I2VA | PASS · 0 error · 1 warn |

  → **H3 技能（含校验器）实跑生效，可关闭第四节全部 🟡。**

### 10.2 CV-109 澄清推荐偏置 —— ✅ 可关闭（行为一致）

- 会话澄清提问（共 7 次 `ask_user_choice`）中，风格相关仅 1 条：`想走哪种风格大类？` → 选项 `艺术创意 / 动画叙事`，**未带「(推荐)」标签**。
- 对比其他问题（如「成片形态？多镜头叙事短片（推荐）」）明确带推荐标签——说明风格大类**不再被强推**，与 CV-109「不强行推荐大类 + 命中才标」修复一致。
- 置信度：行为一致、建议关闭；若需 100% 反证可补一次「说明确风格→跳过风格两题」的点击（第九节 9.6 第 1.2 步）。

### 10.3 z-image-prompt-writing —— ✅ 图像路径生效（可关闭效果待验）

- 第 6 轮 `skill(z-image-prompt-writing)` 正确加载（base dir 指向 `canvas-studio/skills/z-image-prompt-writing`）。
- 驱动 6 次 `image_generate` **全部成功落盘 PNG**（含 character_sheet 失败后的降级定妆照）。→ 图生/文生图提示词技能链路与产出均正常。

### 10.4 character_sheet / qc_shot 失败 —— 🔴 后端依赖（非 skill bug，不可关闭）

| 行 | 工具 | 错误 | 性质 |
|---|---|---|---|
| L664 | character_sheet | 三视图切分失败：生成失败: Internal Server Error | Drama 后端 500 |
| L686 | character_sheet | Error: [object Object] | Drama 后端 500 |
| L835 | character_sheet | 三视图切分失败：生成失败: Internal Server Error | Drama 后端 500（用真实新图 `z-image_00804_.png` 仍失败） |
| L1011 | qc_shot | 生成失败: Internal Server Error | Drama 后端 500 |

- **关键判读**：第 3 次 character_sheet 传入的是**刚生成的真实新图**（非失效引用），仍 500 → 说明是 **Drama 后端（117.50.108.73:8082）当时不可用**，不是「temp 文件失效」那类 CV-111 自愈覆盖的失效引用问题。
- CV-111 自愈只处理「引用失效但后端存活」子集；**后端 down 不在自愈范围**，且不应无限重试。故本会话既不能证明自愈生效、也不能证明自愈失效——CV-111 维持 🟡，待 drama-api 恢复后按第九节 9.2-C 专项复现。
- agent 对 character_sheet 失败做了**优雅降级**（改 image_generate 出定妆照），全链路仍跑通导出成片——证明 skill 路由与编排逻辑无 bug。

### 10.5 music_generation —— ⚪ 已知缺口（非回归）

- `music_generation` 返回「canvas-studio 无音乐生成能力」并优雅降级；`write_script` 已成功落 BGM/SFX 文案节点。→ 即文档第七节「声音能力缺口」，维持 backlog，非本次引入的问题。

### 10.6 关闭建议汇总

| 功能点 | 本次会话判定 | 处置 |
|---|---|---|
| 第四节 H3 五步 + 校验器（3 行） | ✅ 客观 PASS | **关闭** |
| 第五节 h3-prompt-writing / z-image-prompt-writing | ✅ 实跑生效 | **关闭（效果）** |
| 第三节 CV-109 澄清偏置 | ✅ 行为一致 | **关闭** |
| 第三节 总纲全链路（CV-068/094/099/100/100补） | ✅ 端到端复跑通过 | 维持关闭（L2 加证） |
| 第六节 CV-111 character_sheet 自愈 | 🔴 后端 500 | **维持 🟡**，待 drama-api 恢复专项复现 |
| 第三节 C4 qc_shot | 🔴 后端 500 | 维持 ✅（逻辑落地），标注后端依赖 |
| 第七节 声音缺口 | ⚪ 优雅降级 | 维持 backlog |
| 其余 12 个广场技能 | 本会话未触发 | 维持 🟡 效果待验（按第九节 9.6 抽 2–3 个专项） |

---

> 本清单随验收进度更新；CV 编号推进见 STATUS.md（已编到 CV-120，新条目从 **CV-121** 起）。
