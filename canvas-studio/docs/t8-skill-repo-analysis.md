# T8 Creative DNA Prompt Library 集成分析

## 1. 仓库概览

### 1.1 基本信息

- **仓库地址**: https://github.com/T8mars/minimax-h3-prompt-skill-T8
- **本地路径**: `/Users/wl/Desktop/job/learn/minimax-h3-prompt-skill-T8`
- **许可证**: MIT + CC BY 4.0
- **定位**: 面向 MiniMax H3 和 Seedance 2.0 的高质量短视频 Creative DNA 案例库

### 1.2 核心内容

| 内容类型 | 数量 | 用途 |
|---------|-----|------|
| 案例库 (catalog/) | 50+ | 浏览案例、Creative DNA、来源和双模型提示词 |
| 技能 (skills/) | 248 | 安装到支持 Skills 的 Agent，直接复用案例机制 |
| 官方技能索引 | 9 | 固定索引 MiniMax 官方仓库收录的 Skills |
| 桌面查看器 | 1 | Electron 应用，支持搜索、筛选、播放、收藏 |

---

## 2. 技能结构分析

### 2.1 技能目录结构

每个技能遵循统一结构：

```
skills/<skill-name>/
├── SKILL.md              # 技能主文件
├── references/           # 参考文件
│   ├── summary.md        # 风格、适用场景、来源限制
│   ├── template.md       # 不变量、变量槽位、消融实验
│   ├── h3-template.md    # H3 编译模板
│   └── seedance-template.md  # Seedance 编译模板
└── agents/
    └── openai.yaml       # OpenAI 元数据（可选）
```

### 2.2 技能分类

#### A. 官方技能伴侣（9个）

这些是 MiniMax 官方技能的 Seedance 2.0 伴侣版本：

| 技能名称 | 官方技能 | 用途 |
|---------|---------|-----|
| `write-seedance-video-prompts` | `h3-prompt-writing` | 通用提示词编写 |
| `direct-seedance-minimalist-product-ad` | `minimalist-product-ad-generator` | 极简产品广告 |
| `direct-seedance-3d-animation` | `3d-animation-short-generator` | 3D 动画短片 |
| `direct-seedance-papercraft-explainer` | `papercraft-stop-motion-explainer` | 纸艺定格科普 |
| `direct-seedance-brand-promo` | `brand-promo-video-generator` | 品牌宣传短片 |
| `direct-seedance-music-typography` | `music-video-subtitle-generator` | 音乐 MV 字幕 |
| `direct-seedance-coop-game-intro` | `co-op-game-intro-generator` | 双人游戏开场 |
| `direct-seedance-paper-collage` | `paper-collage-explainer-generator` | 纸拼贴讲解 |
| `direct-seedance-handdrawn-live-fusion` | `handdrawn-live-video-generator` | 手绘实拍融合 |

#### B. 社区贡献技能（2个）

| 技能名称 | 用途 |
|---------|------|
| `direct-street-interview-video` | 自然街拍互动 |
| `stage-startle-to-truce-encounter` | 突遇惊吓到手势和解 |

#### C. 创意机制技能（237个）

以英文命名的技能，每个代表一种可复用的创意机制，例如：
- `action-buildup-censored-ellipse-aftermath-reveal` - 动作 buildup 到省略到后果揭示
- `asymmetric-scale-evasion-exchange` - 非对称尺度躲避交换
- `break-contained-space-into-impossible-world` - 打破封闭空间进入不可能世界

---

## 3. 与当前项目的兼容性分析

### 3.1 当前项目需求

**video_buddy** 项目的 `canvas-studio` 插件需要：
- 生成 H3 Context-IR 格式的提示词
- 支持 T2VA/I2VA/L2VA/FL2VA/Ref2VA 五种模式
- 集成到现有的技能系统中

### 3.2 T8 仓库的适用性

#### ✅ 优势

1. **双模型支持**：每个技能都提供 H3 和 Seedance 两个版本
2. **丰富的案例库**：50+ 真实案例，包含完整的提示词和视频预览
3. **结构化模板**：每个技能都有明确的模板和验证规则
4. **社区验证**：案例来自真实用户，经过验证和重构
5. **官方对齐**：9 个官方技能伴侣与 MiniMax 仓库保持同步

#### ⚠️ 挑战

1. **技能数量庞大**：248 个技能需要筛选和评估
2. **命名规范不同**：使用英文长横线命名，与当前项目的中文命名不一致
3. **Focus 在 Seedance**：主要面向 Seedance 2.0，H3 是次要目标
4. **缺少验证工具**：没有像 `validate.py` 这样的格式校验器

### 3.3 具体技能评估

#### 高度相关（可直接集成）

| 技能 | 原因 |
|-----|-----|
| `write-seedance-video-prompts` | 通用提示词编写，包含 H3 模板 |
| `direct-street-interview-video` | 包含完整的 H3 编译说明 |
| `stage-startle-to-truce-encounter` | 包含完整的 H3 编译说明 |

#### 中度相关（可参考）

| 技能 | 原因 |
|-----|-----|
| `direct-seedance-brand-promo` | 品牌宣传视频的创意机制 |
| `direct-seedance-3d-animation` | 3D 动画的分镜技巧 |
| 其他 237 个创意机制技能 | 可作为创意灵感来源 |

#### 低度相关（暂不集成）

| 技能 | 原因 |
|-----|-----|
| 纯 Seedance 技能 | 编译目标不同，语法不兼容 |

---

## 4. 集成建议

### 4.1 推荐集成策略

**分阶段集成**：

#### 阶段一：核心技能集成（1-2天）

1. **复制核心技能**：
   - `write-seedance-video-prompts` → 作为通用提示词编写的参考
   - `direct-street-interview-video` → 作为街拍场景的参考
   - `stage-startle-to-truce-encounter` → 作为戏剧场景的参考

2. **提取 H3 模板**：
   - 从每个技能的 `references/h3-template.md` 提取 H3 编译规则
   - 与现有的 `h3-prompt-writing` 技能整合

#### 阶段二：案例库整合（2-3天）

1. **选择高质量案例**：
   - 从 50+ 案例中选择 10-15 个最具代表性的
   - 优先选择包含 H3 提示词的案例

2. **创建案例参考文档**：
   - 将案例整理成 `references/examples.md`
   - 包含输入意图、H3 IR、视频预览链接

#### 阶段三：创意机制库（可选，3-5天）

1. **筛选创意机制**：
   - 从 237 个创意机制中选择 20-30 个最实用的
   - 重点选择与视频生成相关的机制

2. **创建创意机制参考**：
   - 整理成 `references/creative-mechanisms.md`
   - 作为提示词编写的灵感来源

### 4.2 具体文件变更

#### 新增文件

```
minimax-h3/skills/h3-prompt-writing/references/
├── t8-examples.md           # T8 案例库精选
├── creative-mechanisms.md   # 创意机制参考
└── h3-templates/
    ├── street-interview.md  # 街拍 H3 模板
    ├── drama-encounter.md   # 戏剧场景 H3 模板
    └── brand-promo.md       # 品牌宣传 H3 模板
```

#### 修改文件

```
minimax-h3/skills/h3-prompt-writing/SKILL.md
- 添加"创意机制"章节
- 添加"案例参考"章节
- 更新"参考文件"列表
```

### 4.3 不建议集成的内容

1. **Seedance 专用语法**：`{...}`、`<...>`、`（...）`、`【...】` 等标记
2. **桌面查看器**：Electron 应用与当前项目架构不兼容
3. **CI/CD 配置**：GitHub Actions 工作流不需要

---

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|-----|-----|-----|
| 技能数量庞大，筛选耗时 | 延迟集成 | 先集成核心 3 个技能，后续按需添加 |
| 命名规范不一致 | 维护困难 | 统一使用中文命名，保留原始英文作为别名 |
| H3 模板不完整 | 编译效果差 | 优先使用 MiniMax-H3-Context-IR-Skill 的模板 |
| 案例质量参差不齐 | 影响效果 | 只选择经过验证的高质量案例 |

---

## 6. 总结

### 6.1 适用性评估

| 维度 | 评分 | 说明 |
|-----|-----|-----|
| 功能完整性 | ⭐⭐⭐⭐ | 包含 H3 和 Seedance 双版本 |
| 案例质量 | ⭐⭐⭐⭐⭐ | 50+ 真实案例，质量较高 |
| 文档完整性 | ⭐⭐⭐⭐ | 每个技能都有完整的参考文档 |
| 与现有项目兼容性 | ⭐⭐⭐ | 需要适配和整合 |
| 维护成本 | ⭐⭐⭐ | 需要定期同步官方更新 |

### 6.2 推荐行动

**推荐集成**，但需要：

1. **选择性集成**：只集成核心技能和高质量案例
2. **适配改造**：将 Seedance 语法转换为 H3 语法
3. **持续维护**：定期同步官方更新

### 6.3 下一步

1. 确认是否需要集成 T8 仓库的技能
2. 如果需要，制定详细的集成计划
3. 开始阶段一的核心技能集成
