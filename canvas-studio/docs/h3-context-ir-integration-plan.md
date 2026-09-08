# H3 Context-IR 集成方案

## 1. 背景与目标

### 1.1 问题描述

当前 `canvas-studio` 插件生成视频时，直接将用户原始提示词发送给 MiniMax H3 API，没有经过 Context-IR（Context Intermediate Representation）编译。根据 MiniMax 官方文档：

> "H3-Context-IR is critical to quality. Raw text input is out-of-distribution and produces noticeably worse results."

这导致视频生成质量不佳，无法充分发挥 H3 模型的能力。

### 1.2 目标

将 H3 Context-IR 的结构化提示词编写规则集成到现有技能系统中，使生成的提示词符合 H3-Base 训练时的分布，提升视频生成质量。

### 1.3 集成方式

采用 **"嵌入规则"** 方案，将 Context-IR 的格式规范和编写规则直接集成到现有的 `h3-prompt-writing` 技能中，无需外部服务依赖。

---

## 2. 现状分析

### 2.1 当前技能结构

```
minimax-h3/skills/h3-prompt-writing/
├── SKILL.md              # 技能主文件（40行）
├── references/
│   ├── base-en.txt       # 三段式示例（222行）
│   └── ref-en.txt        # 六段式示例（待确认）
└── agents/
    └── openai.yaml       # OpenAI 元数据
```

### 2.2 当前 SKILL.md 的问题

| 问题 | 影响 |
|-----|-----|
| 缺少模式判定规则 | 无法正确区分 T2VA/I2VA/L2VA/FL2VA/Ref2VA |
| 缺少对齐行句式规范 | I2VA/L2VA/FL2VA 的对齐行格式不统一 |
| 缺少分镜与时间戳规则 | Shot 标记和时间戳格式混乱 |
| 缺少运镜词表 | 运镜描述不规范 |
| 缺少 Ref2VA 六段式完整规格 | summary/retention_analysis 格式错误 |
| 缺少验证机制 | 无法在发送前检查 IR 格式 |

### 2.3 参考项目分析

**MiniMax-H3-Context-IR-Skill** 项目提供了完整的解决方案：

| 文件 | 内容 | 行数 |
|-----|------|-----|
| `SKILL.md` | 完整的编写流程（5步） | 239行 |
| `references/format-base.md` | 三段式完整规格 | 待确认 |
| `references/format-ref2va.md` | 六段式完整规格 | 161行 |
| `references/camera-vocabulary.md` | 20个运镜词 | 待确认 |
| `references/examples.md` | 4组官方IR示例 | 120行 |
| `references/chinese-input.md` | 中文输入专项 | 待确认 |
| `scripts/validate.py` | IR格式校验器 | 494行 |

---

## 3. 集成方案

### 3.1 文件变更清单

| 操作 | 源文件 | 目标文件 | 说明 |
|-----|-------|---------|-----|
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/references/format-base.md` | `minimax-h3/skills/h3-prompt-writing/references/format-base.md` | 三段式完整规格 |
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/references/format-ref2va.md` | `minimax-h3/skills/h3-prompt-writing/references/format-ref2va.md` | 六段式完整规格 |
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/references/camera-vocabulary.md` | `minimax-h3/skills/h3-prompt-writing/references/camera-vocabulary.md` | 运镜词表 |
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/references/examples.md` | `minimax-h3/skills/h3-prompt-writing/references/examples.md` | 官方IR示例 |
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/references/chinese-input.md` | `minimax-h3/skills/h3-prompt-writing/references/chinese-input.md` | 中文输入专项 |
| 新增 | `MiniMax-H3-Context-IR-Skill/skills/h3-context-ir/scripts/validate.py` | `minimax-h3/skills/h3-prompt-writing/scripts/validate.py` | IR格式校验器 |
| 修改 | - | `minimax-h3/skills/h3-prompt-writing/SKILL.md` | 增强技能主文件 |

### 3.2 SKILL.md 增强方案

#### 3.2.1 新增内容

```markdown
# H3 Prompt Writing

## Workflow

1. **判定模式**：根据输入素材的角色（不是"有没有素材"）确定模式
   - 只有文本 → T2VA
   - 文本 + 1张图(首帧) → I2VA
   - 文本 + 1张图(尾帧) → L2VA
   - 文本 + 2张图(首尾帧) → FL2VA
   - 文本 + 通用参考素材 → Ref2VA

2. **选择模板**：
   - T2VA/I2VA/L2VA/FL2VA → 三段式（`references/format-base.md`）
   - Ref2VA → 六段式（`references/format-ref2va.md`）

3. **编写主描述**：按分镜展开时间线，包含：
   - [Shot N] 标记与时间戳
   - 运镜描述（使用 `references/camera-vocabulary.md` 中的词表）
   - 说话人与台词（`<d>` 标签）
   - 画面内文字（英文双引号）

4. **编写声音段**：
   - `overall_soundscape`：1-4句环境音
   - `non_diegetic_music`：1-3句配乐

5. **验证格式**：使用 `scripts/validate.py` 检查
   ```bash
   python3 scripts/validate.py brief.txt --mode T2VA --duration 10
   ```

## 模式判定规则（M系列）

| 输入构成 | 模式 | 输出格式 |
|---------|------|---------|
| 只有文本 | T2VA | 三段式，无对齐行 |
| 文本 + 1张图(首帧) | I2VA | 对齐行 + 三段式 |
| 文本 + 1张图(尾帧) | L2VA | 对齐行 + 三段式 |
| 文本 + 2张图(首尾帧) | FL2VA | 对齐行 + 三段式 |
| 文本 + 通用参考素材 | Ref2VA | 六段式，无对齐行 |

**硬约束**：
- FL2VA/I2VA/L2VA 与 Ref2VA 互斥
- 音频不能单独作参考
- 必须有一段非空文本意图

## 对齐行句式（K系列）

### I2VA
```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

### FL2VA
```
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

### L2VA
```
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

⚠️ **注意**：FL2VA 的句式不带尖括号，其他两种带尖括号。

## 分镜与时间戳规则（T系列）

- `[Shot 1]` **不带时间戳**
- 后续镜头：`[Shot N] At MM:SS.mmm, the camera cuts to ...`
- 时间戳**严格递增**，全部**小于目标时长**
- 切镜动词仅限5个：
  - `the camera cuts to`
  - `the shot cuts to`
  - `the shot transitions to`
  - `the shot changes to`
  - `the shot switches to`

## 运镜词表（C系列）

见 `references/camera-vocabulary.md`，共20个词：
- Zoom In/Out, Push In/Pull Out
- Pan Left/Right, Truck Left/Right
- Tilt Up/Down, Pedestal Up/Down
- Arc Shot, Tracking Shot, Static Shot
- Shake Slightly/Strongly, POV
- Roll Clockwise/Counterclockwise

幅度：`with small amplitude` / `with large amplitude`（中等幅度省略）
速度：`at slow speed` / `at fast speed`（正常速度省略）

## Ref2VA 六段式规格

见 `references/format-ref2va.md`，包含：
- `subject_definitions`：引用标签定义
- `summary`：任务类型前缀
- `retention_analysis`：保留度分析
- `detailed_description`：详细描述
- `overall_soundscape`：环境音
- `non_diegetic_music`：配乐

## 自检清单

出稿前逐条过一遍：

- [ ] 第一个字符是对齐行或段名，没有围栏、没有前言
- [ ] 段名齐全、顺序正确
- [ ] `[Shot 1]` 没有时间戳；后续时间戳格式正确
- [ ] 运镜词全部在表内
- [ ] `<d>` 标签闭合，台词逐字未改
- [ ] `overall_soundscape` 1-4句且不含台词
- [ ] `non_diegetic_music` 1-3句且无情绪词
- [ ] Ref2VA：六段齐全，summary 前缀合法
```

---

## 4. 实施步骤

### 阶段一：文件复制（1天）

1. 复制参考文件到目标目录
2. 确认文件完整性
3. 更新 `.gitignore`（如需要）

### 阶段二：SKILL.md 增强（2天）

1. 合并新的工作流程
2. 添加模式判定规则
3. 添加对齐行句式规范
4. 添加分镜与时间戳规则
5. 添加运镜词表引用
6. 添加 Ref2VA 六段式规格
7. 添加自检清单

### 阶段三：验证机制（1天）

1. 集成 `validate.py` 到技能目录
2. 创建验证脚本包装器（可选）
3. 测试验证功能

### 阶段四：测试与调优（2天）

1. 使用 4 组官方 IR 示例测试
2. 使用边界案例测试
3. 修复发现的问题
4. 编写测试文档

---

## 5. 验证方法

### 5.1 单元测试

使用 `validate.py` 的自检功能：

```bash
cd minimax-h3/skills/h3-prompt-writing
python3 scripts/validate.py --self-test
```

预期输出：4/4 官方 IR 示例全部通过。

### 5.2 集成测试

1. 从 `canvas-studio` 插件生成 IR
2. 使用 `validate.py` 验证格式
3. 发送给 H3 API 生成视频
4. 对比集成前后的视频质量

### 5.3 回归测试

确保现有功能不受影响：
- T2VA 模式正常工作
- I2VA 模式正常工作
- Ref2VA 模式正常工作
- 中文输入处理正常

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|-----|-----|-----|
| 格式规范与现有代码不兼容 | 需要修改生成逻辑 | 逐步迁移，先添加验证，再修改生成 |
| 官方规范更新 | 规则失效 | 定期检查 MiniMax 官方文档 |
| 中文输入处理复杂 | 台词丢失 | 使用 `chinese-input.md` 专项指导 |
| 验证器误报 | 阻碍正常流程 | 区分 ERROR 和 WARN，WARN 不阻塞 |

---

## 7. 成功标准

### 7.1 功能标准

- [ ] 所有 5 种模式（T2VA/I2VA/L2VA/FL2VA/Ref2VA）的 IR 格式正确
- [ ] `validate.py` 自检通过 4/4 官方示例
- [ ] 生成的 IR 能被 H3 API 正确解析

### 7.2 质量标准

- [ ] 视频生成质量明显提升（主观评估）
- [ ] 无明显格式错误
- [ ] 中文输入处理正确

### 7.3 文档标准

- [ ] SKILL.md 清晰描述工作流程
- [ ] 参考文件完整
- [ ] 自检清单可操作

---

## 8. 后续优化

### 8.1 短期优化（1个月）

- 收集用户反馈，调整规则
- 优化中文输入处理
- 添加更多边界案例

### 8.2 中期优化（3个月）

- 考虑集成 OpenH3-IR 的 API 作为可选后端
- 添加创意旋钮（导演风格、情绪等）
- 支持批量处理

### 8.3 长期优化（6个月）

- 开发可视化的 IR 编辑器
- 集成自动化测试
- 支持更多 H3 特性

---

## 9. 附录

### 9.1 相关文件

- OpenH3-IR: `/Users/wl/Desktop/job/learn/open-h3-ir/`
- MiniMax-H3-Context-IR-Skill: `/Users/wl/Desktop/job/learn/MiniMax-H3-Context-IR-Skill/`
- 当前项目: `/Users/wl/Desktop/job/learn/video_buddy/`

### 9.2 参考文档

- MiniMax H3 API 文档: https://platform.minimaxi.com/document/H3%20Context-IR
- OpenH3-IR 设计文档: `/Users/wl/Desktop/job/learn/open-h3-ir/docs/design.md`
- Context-IR 格式规范: `/Users/wl/Desktop/job/learn/MiniMax-H3-Context-IR-Skill/docs/RULES-DERIVED.md`

### 9.3 联系方式

如有问题，请联系项目维护者。
