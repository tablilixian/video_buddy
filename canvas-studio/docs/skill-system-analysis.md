# Canvas Studio Skill 系统设计分析

> 分析日期：2026-09-09
> 分析范围：skill 注册机制、skill 内容结构、skill ↔ H3 能力链路、设计合理性评估
> 基于分支：`dev` @ `2b1088f4c8`

---

## 一、整体架构

画布的 skill 系统是**三层金字塔 + 两个辅助层**：

```
┌──────────────────────────────────────────────────────────────────┐
│  canvas-studio-creation（创作总纲·本地自研，skills-local/）          │
│  「先加载我，再干别的」—— SK-01 常驻 systemPrompt 硬指令           │
└──────────────────────────────────────────────────────────────────┘
                              ↓ 风格追问后路由到
┌──────────────────────────────────────────────────────────────────┐
│  9 个 H3 风格 skill（3D动画/品牌/极简产品/合作游戏/手绘实景融合/  │
│  纸拼贴/纸艺定格/街采/惊吓遭遇）                                  │
│  每个 skill 自带领域工作流 STEP 0~N                                │
└──────────────────────────────────────────────────────────────────┘
                              ↓ 写视频 prompt 时必加载
┌──────────────────────────────────────────────────────────────────┐
│  h3-prompt-writing（H3 提示词专才·唯一有客观校验器的 skill）        │
│  5 模式 × 2 模板（3段/6段）+ 8 个 references + 校验器            │
└──────────────────────────────────────────────────────────────────┘

辅助层：
  · z-image-prompt-writing / qwen-image-edit-writing（图像提示词）
  · effect-test-runner（放手跑自动化测试器）

支撑层：
  · 能力路由抽象（src/providers/）：工具+参数 → VideoCapability → 供应商适配器
  · 一致性闭环 C1–C5（资产卡/注入纪律/尾帧链/VLM质检/合成调色）
```

### 注册机制：目录即注册

- `scripts/sync-minimax-skills.mjs` 从上游 `minimax-h3` submodule + 本地 `skills-local/` 合并出 `skills/<name>/`
  - 上游 skill：逐字节 verbatim 复制（ENABLED Set 控制）
  - `skills-local/`：file-level overlay，同名文件覆盖上游
- `src/skills/minimax-skills.ts`：扫描 `SKILL.md` frontmatter，description 截断到 1024 字符
- `resourceBase: { kind: 'directory', path }`：harness 原生渐进披露，SKILL.md 精简入口 + `references/` 按需 read
- 新增 skill = 在 ENABLED Set 加一行，注册代码零改动

---

## 二、设计强项

### 1. 零改编原则

`skill-expansion-spec.md` 第 1 条明确规定：上游 skill 逐字节同步，不翻译、不裁剪、不改写。

效果：规避了"主分支被本地化污染、回归上游困难"的经典陷阱；上游 skill 发版后，重跑 sync 脚本即可。

### 2. 渐进披露做得扎实

| skill | SKILL.md 行数 | references 数量 | 按需读取 |
|---|---|---|---|
| h3-prompt-writing | 89 | 8 | 按模式读 format-base / format-ref2va / camera-vocabulary / creative-mechanisms 等 |
| 3d-animation-short-generator | 247 | 5 | shot-table-spec / storyboard-guidelines / model-selection / fallback / qc-checklist |
| canvas-studio-creation | ~290 | 0 | 无子文件，全量在 SKILL.md |

### 3. H3-Context-IR 是唯一有客观校验器的 skill

`src/h3-ir-validate.ts`（484 行，TS 移植自 upstream validate.py）覆盖 14 个官方夹具，对以下全部硬约束：

- 运镜词表 20 词（`zoom in` / `push in` 等）之外的词报错
- 切镜动词封闭集 5 个（`the camera cuts to` 等）
- I2VA/FL2VA/L2VA 对齐行三套句式逐字匹配（官方原文不一致，不能统一）
- 时间戳严格递增、小于 duration
- `<d>` 标签闭合、台词逐字保留
- Ref2VA 六段齐全、summary 前缀六选一、retention 档位合法
- 官方 IR 输出 100% 通过（tests/fixtures/official_ir.json）

**验收记录**：实跑 4 段 IR 全部 0 error PASS（见 `docs/skill-features-inventory.md` §四）。

### 4. 能力抽象层解耦了"模型=端点"假设

```
VideoProvider 接口：submit() + poll() + cancel()
  · drama（同步）：submit 内等到底，handle.settled 直接填充
  · fal（H3 异步）：submit 返回 request_id，poll 轮询直到 done

capabilityOf(tool, params) 显式路由：
  video_generate + 无 filename → text-to-video
  video_generate + 有 filename → first-last-frame
  video_composite + 2张 → first-last-frame（首尾帧插值）
  video_composite + ≥3张 → multi-reference
```

新增模型 = 新增 adapter，`generate.ts` 零改动。

### 5. C1–C5 一致性闭环全部落地

| 编号 | 机制 | 关键文件 |
|---|---|---|
| C1 | 资产卡：character_sheet 四视图 + lockedPrompt 冻结，同名整体覆盖 | host-tools.ts |
| C2 | 注入纪律：所有含该角色的 prompt 以 lockedPrompt 原样开头 | canvas-studio-creation/SKILL.md |
| C3 | 尾帧链：extract_last_frame + shotTransition(chain/cut/bridge) | host-tools.ts |
| C4 | VLM 质检：qc_shot + 预算熔断 2 次 | quality-check.ts |
| C5 | 合成调色：contrast=1.03:saturation=1.02 + BGM 淡入淡出 | compose.ts |

### 6. 路由硬指令（SK-01）

早期版本把"先加载总纲"写在 skill description 里，结果模型凭直觉追问 3 轮才想起来加载。

改进方案：在 `systemPrompt.section(order: 150)` 注册常驻小节——每轮上下文前缀都有，不依赖模型自觉；用条件式措辞（仅创作任务生效），避免污染非创作会话。

### 7. 占位工具的诚实边界

三个占位工具（music_generation / tts_voiceover / subtitle_burn）拦截上游 skill 期望但 canvas-studio 不具备的能力，返回可操作降级路径：

- music_generation → "请引导用户上传 BGM 音频到画布，时间轴出现该节点后用 compose_video bgmNodeId"
- tts_voiceover → "用 write_script 落文案节点，prompt 里用 says in an off-screen voiceover while his lips remain completely closed"
- subtitle_burn → "用 write_script 落文案节点成片详情展示，或在 H3 prompt 里用英文双引号让模型生成画面内文字"

---

## 三、H3 能力发挥评估

### ✅ 充分用上的能力

| H3 能力 | 画布落地方式 |
|---|---|
| H3-Context-IR 格式 | h3-prompt-writing 完整五步流程 + 校验器 |
| T2VA / I2VA / FL2VA | video_generate + video_composite 路由 |
| Ref2VA（多参考） | video_composite ≥3 张图走 drama ref2va / fal reference-to-video |
| 角色一致性 | C1 资产卡 + C2 lockedPrompt 注入纪律 |
| 跨镜头接续 | C3 extract_last_frame + shotTransition |
| 官方创意机制库 | creative-mechanisms.md 收录 30 个 T8 机制 |
| 固定 H3 模型 | 3d-animation-short-generator 显式禁止模型选择卡 |
| 多分辨率 | fal H3 支持 480P/768P/2K/4K，720p/1080p 升档并回 warning |
| 多画幅 | fal: 21:9/16:9/4:3/1:1/3:4/9:16；drama: 16:9+9:16，1:1 降级 16:9 |

### ⚠️ 未充分使用或被降级的能力

| H3 能力 | 现状 | 影响 |
|---|---|---|
| audio 原生音轨 | generateAudio 仍是占坑，drama/fal 均不出原生音频 | MV/对白场景无法开箱即用 |
| TTS | 无语音合成工具 | 旁白/对白场景需用户自备音频 |
| 音乐生成 | 无音乐生成工具 | 品牌/3D动画等风格 skill 的 STEP 8 BGM 只能用户上传 |
| L2VA（尾帧锚定） | 5 种 IR 模式之一，但无独立工具入口 | 用户想"从尾帧向前推"时语义不清晰 |
| video continuation / video editing | IR 支持但工具层不接 \<Video N\> 标签 | "续写"类场景无法实现 |
| T2VA 真正端点 | drama 实际走 FL2VA 端点，T2VA 和 FL2VA 路由到同一后端 | H3 模式判定和后端执行不对齐 |
| model 切换 | drama/fal 均不支持，UI 强制默认 H3 | 用户无法选择 Seedance 等备选模型 |
| h3-ir-validate 集成 | 校验器存在但不在 video_generate/composite 调用前触发 | IR 写错直接 POST 后端，出片差才反馈 |

### 🔴 设计与工程矛盾

#### 矛盾 1：风格 skill 与总纲职责重叠

每个风格 skill（8 个）都重写了完整工作流：项目简报 → 大纲 → 角色/场景卡 → 分镜 → 视频 → 成片。但 `canvas-studio-creation` 总纲已经把主流程定义得很细。

实际比例估算：
- 风格 skill 中"标准工作流复制"：~80%
- 真正"风格化"的部分（Pixar 风视觉约束 / 纸艺质感词 / 手绘发光参数）：~20%

维护成本：改动主流程需要同步修改 9 个文件（总纲 + 8 个风格 skill）。

#### 矛盾 2：creative-mechanisms 机制库沉睡

`h3-prompt-writing/references/creative-mechanisms.md` 收录了 30 个 T8 官方验证的创意机制（悬疑张力/双人关系/叙事结构/微表情），但风格 skill 没有引用它们。

例如：
- `direct-street-interview-video` 没有引用 `pursuit-route-collapse-remote-survivor-reframe` 等纪录片机制
- `stage-startle-to-truce-encounter` 没有引用 `offscreen-cue-progressive-tightening-unrevealed-source` 等惊悚张力机制

30 个机制在仓库里"睡大觉"，没有转化为出片质量。

#### 矛盾 3：H3 模式（5 个）与工具能力（3 个）不对齐

```
H3 IR 模式:   T2VA  I2VA  L2VA  FL2VA  Ref2VA
VideoCapability:  T2V         FL2V（合并 I/L/FL）  Ref2V
工具入口:         video_generate + video_composite
```

- I2VA / L2VA / FL2VA 全部落到 first-last-frame，没有区分首帧/尾帧语义
- L2VA 没有独立工具入口（用户想"从尾帧倒推"时没有显式路径）
- T2VA 和 FL2VA 在 drama 后端走同一个 FL2VA 端点

#### 矛盾 4：占位工具的"诚实" vs 用户预期

放手跑模式下，用户跑了 MV 字幕 skill 之后发现：
- 歌词字幕是"文案节点"（成片详情展示），**不烧进画面**
- BGM 是用户自己上传的音频节点，不是自动生成的

这些在 skill 里有说明，但用户对"一站式成片"的预期和实际能力有落差。

#### 矛盾 5：校验器存在但未接入工具执行链路

`h3-ir-validate.ts` 校验逻辑完整，但 `video_generate` / `video_composite` 工具的 execute 实现里没有预检步骤。

理想路径：工具 execute 内先跑 validateH3Ir，ERROR 立即抛回给 agent，但当前没有这个集成。

#### 矛盾 6：H3 端点语义与 Drama 端点不一致

- fal H3 有三个独立端点：`text-to-video` / `image-to-video` / `reference-to-video`
- drama 用一个 `image2videofl2va` 端点，capability 路由是抽象的，但端点层无法对应 IR 模式语义

---

## 四、设计合理性总评

| 维度 | 评分 | 说明 |
|---|---|---|
| 可维护性 | ★★★★★ | 零改编 + 目录即注册 + 渐进披露，DSH 插件式 skill 系统的样板实现 |
| 一致性保障 | ★★★★★ | C1–C5 全部落地，资产卡 + 注入纪律 + VLM 质检形成闭环 |
| H3 能力利用率 | ★★★☆☆ | IR 格式 + 一致性 + 基础模式已充分；audio/T2VA真端点/video continuation/L2VA 未被激活 |
| 文档质量 | ★★★★★ | 方案文档 / 交接文档 / 功能清单 / 回归矩阵完备 |
| 测试覆盖 | ★★★★☆ | h3-ir-validate 14 夹具通过；effect-test-runner 自动化用例；smoke test 门禁 |
| 工具预检 | ★★☆☆☆ | 校验器未集成到工具调用前，错格式直接打到后端 |

**综合判断**：工程实现极其成熟（★★★★★），但 H3 能力发挥偏保守（★★★☆☆）。最大杠杆点在不增加后端依赖的情况下就能推动。

---

## 五、可推进方向

按"低垂果实优先"排序：

### 优先级 A：creative-mechanisms 按风格打通（无后端依赖）

为每个风格 skill 梳理"该用哪些机制"，在 style 章节引用 `references/creative-mechanisms.md` 的具体条目。

预期收益：风格 skill 的创意质量系统性提升，30 个沉睡机制转化为实际出片效果。

风险：低。需要逐风格梳理机制映射。

### 优先级 B：h3-ir-validate 集成到工具预检（无后端依赖）

在 `video_generate` / `video_composite` 工具 execute 的参数解析后、API 调用前，增加 validateH3Ir 调用，ERROR 级 findings 直接抛回给 agent。

预期收益：IR 格式错误当场拦截，节省一次无效后端调用，提升出片成功率。

风险：增加 ~20ms 校验开销（可接受）；需要处理"agent 还未写完 IR prompt"的边界情况（validate 应当在 agent 调用 tool 时触发，此时 IR 应已写完）。

### 优先级 C：风格 skill 去重（中等工作量）

让 `canvas-studio-creation` 独家管主流程，风格 skill 只补：
1. 风格化视觉约束（H3 prompt 前缀）
2. 领域机制引用（creative-mechanisms 具体条目）
3. 特殊审批门（如 3D 动画的"定妆照确认图"、品牌宣传的"Logo 确认"）

预期收益：维护成本下降 70%，风格 skill 可读性提升，主流程改动只需改一个文件。

风险：需要重写 8 个风格 skill，迁移成本中等。

### 优先级 D：补 L2VA 独立工具入口（需后端确认）

新增 `video_from_endframe` 工具，语义为"以尾帧为锚点向前推"，在 fal H3 走 `image-to-video` 端点。

预期收益：5 个 IR 模式在工具层全部对齐，语义清晰。

风险：需要 fal H3 支持尾帧指定（需 API 文档确认）；Drama 后端不一定支持。

### 优先级 E：H3 audio 真实接入（需后端能力确认）

接入 fal H3 原生音轨或 drama 音频端点，替换 music_generation / tts_voiceover 占位工具。

预期收益：MV 字幕 / 旁白对白 / 品牌 BGM 场景一站式可用。

风险：需要确认 fal H3 audio API 可用性；改动工具接口和风格 skill STEP 8。

---

## 六、关键文件索引

| 文件 | 作用 |
|---|---|
| `src/skills/minimax-skills.ts` | skill 注册核心：扫目录、解析 frontmatter、截断 description |
| `src/skills/placeholder-tools.ts` | 占位工具：music_generation / tts_voiceover / subtitle_burn |
| `src/skills/routing-prompt.ts` | SK-01 路由硬指令（systemPrompt 小节） |
| `src/skill-catalog.ts` | 技能广场展示元数据（与 upstream 零改编原则一致） |
| `scripts/sync-minimax-skills.mjs` | 同步脚本：上游 verbatim 复制 + skills-local 覆盖合并 |
| `src/h3-ir-validate.ts` | H3-Context-IR 校验器（14 夹具，官方 IR 100% PASS） |
| `src/providers/types.ts` | VideoProvider 接口：submit/poll/cancel 三段式 |
| `src/providers/capability.ts` | 工具+参数 → VideoCapability 路由 |
| `src/providers/drama.ts` | Drama 同步供应商适配器 |
| `src/providers/fal.ts` | fal H3 异步供应商适配器 |
| `src/quality-check.ts` | C4 VLM 质检闭环 |
| `src/reference-handle.ts` | 短引用句柄（img-01 / vid-02）与 @ref[显示名] 解析 |
| `docs/skill-expansion-spec.md` | skill 扩充规范（零改编原则 / 目录格式 / 路径 A/B） |
| `docs/skill-features-inventory.md` | 功能清单与验收状态（统一验收用） |
| `docs/h3-context-ir-integration-plan.md` | H3 Context-IR 集成方案 |
