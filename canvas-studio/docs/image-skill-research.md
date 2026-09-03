# 图像侧 Skill 调研与方案建议（2026-09-03）

> 背景：视频侧已有 `h3-prompt-writing` 提示词规范 skill 与 8 个 H3 风格 skill，图像侧目前是空白。
> 本文盘点「工具 → 端点 → 模型」映射、两个开源模型的能力与提示词规范，指出当前链路的冲突，并给出 skill 方案选项。
>
> **状态（2026-09-03 更新）**：已拍板并落地为 **CV-095**（见文末「已拍板结论」）。方案 A 两个 skill 已建；`inpaint`/`style_transfer` 维持禁用；`negativePrompt` 参数保留但规范内禁止使用；`prompt_enhance` 交由模型自决。遗留一项待后端确认：图生图端点底层模型。

---

## 一、现状盘点：工具 → 端点 → 模型

| 暴露给 Agent 的工具 | Drama 端点 | 底层模型 / 工作流 | 状态 |
|---|---|---|---|
| `image_generate`（纯文生图） | `txt2image` | Z-Image（Z-Image-Turbo，6B S3-DiT） | ✅ 可用 |
| `image_generate`（`style=anime`） | `txt2imageanime` | 卡通/日式动漫分支 | ✅ 仅纯文生图 |
| `image_generate`（传参考图） | `image2image`（1–3 张） | 图生图 | ✅ 可用（anime 会回退写实） |
| `character_generate` | `image2character` | `qwen_4view_char_2step` | ✅ 可用（不接受 prompt） |
| `inpaint` | `image2inpaint` | `qwen_edit_inpainting` | ❌ 禁用（`host-tools.ts:75`） |
| `style_transfer` | `image2styletransfer` | 风格迁移 | ❌ 禁用（`host-tools.ts:75`） |
| `prompt_enhance` | `image2promptenhance` | 提示词扩写 | ✅ 可用（上次会话被跳过） |

代码位置：端点表 `src/config.ts:16-30`；工具定义 `src/host-tools.ts:405-433`（image_generate）、`434-454`（character_generate）；禁用集合 `src/host-tools.ts:71-81`。

**关键结论：改图（qwen）能力目前只通过 `character_generate` 三视图露出，通用改图（局部重绘 / 风格迁移）工具是禁用的。**

### ⚠️ 遗留待确认：图生图（`image2image`）走哪个模型

代码注释对其他端点都写明了工作流名 —— `txt2image` = `nunchaku-z-image-turbo`、`txt2imageanime` = `z-anime-aio`、`image2character` = `qwen_4view_char_2step`、`image2inpaint` = `qwen_edit_inpainting`（见 `src/generate.ts:889-965`）—— **唯独 `image2image` 未标注**。

- Drama Backend 的 OpenAPI（`http://117.50.108.73:8082/openapi.json`）同样未标注模型：`Image2ImageRequest` 只有 `prompt` / `width` / `height` / `image1~3`，无 model 字段。
- **间接证据指向 Qwen 系列**：`image2image` 接受 1–3 张参考图融合，而 Z-Image-Turbo 是纯文生图模型、不接受参考图输入；多图参考正是 Qwen-Image-Edit 的能力特征。
- **验证方法**（任选其一）：① 直接问后端 `image2image` 的工作流名；② 对比耗时 —— Z-Image-Turbo 约 8 步、秒级出图，Qwen 系列步数高、明显更慢；③ 传一张参考图 + 描述式提示词，若结果完全重画而非在原图基础上改，说明偏文生图分支。
- **当前处理**：`qwen-image-edit-writing` 的写法对两者都成立（保留子句 + 目标明确），skill 内未写死模型名，确认后再回填。

---

## 二、Z-Image-Turbo（文生图）能力与规范

**模型定位**：6B 参数单流扩散 Transformer（S3-DiT），few-step 蒸馏版，约 8 步出图；中英双语训练，原生文字渲染能力强（海报/招牌/字幕类需求天然适配）。

### 直接影响提示词写法的三条硬约束

1. **不支持 negative prompt**：官方推理 `guidance_scale=0`，模型完全忽略负向提示词。所有约束必须写进正向提示词。
   - 「不要模糊」→ 「锐利对焦、细节清晰」
   - 「不要杂乱」→ 「干净背景、元素精简」
   - 「不要畸形」→ 「比例自然、结构准确」
2. **偏好长而具体的提示词**：官方推荐详细长提示词，甜点区约 80–250 词（默认 512 token，可放宽到 1024）。官方提供 Prompt Enhancer 扩写短提示词 —— 项目里对应 `prompt_enhance` 工具与 `image2promptenhance` 端点。
3. **不支持 CFG / 步数调节**：Turbo 固定少量步数、无 CFG。可控变量在提示词本身，不在参数。

### 推荐结构（九段式，按需取用）

```
[镜头与主体] + [年龄/外观] + [服装/配色] + [环境/背景]
+ [打光] + [情绪/氛围] + [风格/媒介] + [技术细节] + [约束]
```

- **打光词敏感度极高**：soft diffused daylight / cinematic warm key light / studio portrait lighting / rim lighting / noir high-contrast lighting。
- **风格/媒介必须锁定**：realistic photography / flat vector illustration / watercolor / manga page / pixel art —— 不写模型会自己猜。
- **技术细节**：镜头焦段（50mm）、景深、胶片型号、4K、锐度。
- **文字渲染**：直接引用要出现的确切字符串并指定字体与排版，例：`把标题 "SUMMER SALE" 以粗体无衬线居中排布`。

### 分辨率

原生 1024×1024；项目侧 `sizeForAspectRatio`（`src/config.ts:31-38`）：16:9 → 1280×720，9:16 → 720×1280，1:1 → 1024×1024。

---

## 三、Qwen-Image-Edit（改图）能力与规范

**模型定位**：指令式图像编辑，不是 img2img。提示词描述的是「对这张图做什么操作」，而不是「想要的成图长什么样」。用描述式提示词会让模型无视输入图、凭空重画。

### 四段式公式（官方/社区一致推荐）

```
操作（动词）+ 目标（具体部位/对象）+ 规格（改成什么样）+ 保留子句（什么不许动）
```

例：`把前景的狗替换成金毛犬，保持打光与背景完全一致。`

- **保留子句是最关键的一段**。没有它模型会过度改动。一句「其余元素全部保持不变」能挡掉大部分漂移。
- **一次只做一个操作**。「改发型 + 换背景 + 加墨镜」写在一起会互相干扰 → 复杂改动拆成链式多步，每步都重申约束。
- **文字编辑**（旗舰能力，中英文均支持且保持原字体/字号/风格）：
  `把标题文字「春季促销」改成「夏季大促」，保持字体风格、大小、颜色和位置不变，其他部分尽量不变` —— 新旧文本都必须加引号，且显式锁定字体属性。
- **材质替换**：需同时给出材质与光照方向，例：换成雾面金属，保留刻线与阴影关系，光线方向不变。
- **目标消歧**：画面有同类物体时用位置锁定，如「左边第二个人」「伞下的蓝衣男子」。
- **多图输入**：支持（如两张参考图合成合照，各自保持身份特征）。

### 参数（与 Z-Image 相反，这些是生效的）

| 参数 | 默认 | 建议 |
|---|---|---|
| `negative_prompt` | — | 支持且有效：`low quality, noise, extra elements` |
| `steps` | 40 | 追求细节可到 70；快速迭代可降 |
| `guidance_scale` | 4 | 强 adherence 可到 8 |
| `seed` | 随机 | 固定 seed 便于对照迭代 |
| 输入尺寸 | — | ≥512×512 保细节 |

> 注意：以上参数当前**未暴露给 Agent**（`inpaint` 工具被禁用），仅作为解禁后 skill 内容的依据。

---

## 四、当前链路的 4 处冲突（重要）

| # | 冲突 | 位置 | 影响 |
|---|---|---|---|
| 1 | `image_generate` 暴露了 `negativePrompt` 参数，但 Z-Image-Turbo **官方忽略负向提示词** | `host-tools.ts:415` | Agent 写了也是白写，还占用 token。需后端确认，无效则从 schema 移除或在 skill 里明令禁止 |
| 2 | `style=anime` **仅纯文生图**，传参考图会静默回退写实 | `generate.ts:889-916` | 需要参考图保持角色一致性时拿不到动漫风格，是静默降级 |
| 3 | 通用改图能力 `inpaint` / `style_transfer` 被禁用 | `host-tools.ts:75` | qwen 改图模型目前只能走三视图；改图 skill 写出来也没有工具可用 |
| 4 | `character_generate` 不接受 prompt（`params.prompt=''`） | `host-tools.ts:448` | 三视图质量完全取决于设计图质量，无法用提示词纠偏 |
| 5 | `prompt_enhance` 存在但上次会话被跳过 | `generate.ts:726-735` | Z-Image 官方明确推荐 PE 扩写短提示词，这是性价比最高的一步 |

---

## 五、Skill 方案选项

| 方案 | 内容 | 体量 | 优点 | 缺点 |
|---|---|---|---|---|
| **A（推荐）** 拆两个独立 skill | `z-image-prompt-writing`（文生图规范）+ `qwen-image-edit-writing`（改图四段式） | 各 ~4-5KB | 与 `h3-prompt-writing` 粒度一致；按需加载，纯生图任务不加载改图规范 | catalog 多占一条描述 |
| B 合并一个 skill | `image-prompt-writing` 两章并列 | ~9KB | 少一条 catalog，一次加载拿全 | 纯生图任务要多付一半 token |
| C 并入总纲 | 塞进 `canvas-studio-creation` 工具链章节 | +6KB | 无新增 skill | 总纲已 28.9KB，更臃肿；两条模型的写法互斥易混 |

**推荐 A。** 定名规则与现有 skill 一致（小写 kebab-case，模型名 + 用途）。

### 配套要做的事（否则 skill 落不了地）

1. **总纲加调度规则**：`image_generate` 之前必须先 `prompt_enhance` 扩写（对齐 Z-Image 官方 PE 建议）；禁止在 Z-Image 路径用 `negativePrompt`，把约束改写成正向表述。
2. **解禁决策**：改图 skill 是否有价值，取决于 `inpaint`（qwen_edit_inpainting）要不要重新开放。建议先解禁 `inpaint`，`style_transfer` 可继续禁用。
3. **工具描述补模型信息**：`image_generate` / `character_generate` 的 description 里点明底层模型（Z-Image / Qwen-Edit），让 Agent 在拿到工具清单时就知道该加载哪个规范 skill —— 这是最便宜的一步。

---

## 六、已拍板结论（2026-09-03，落地为 CV-095）

| # | 议题 | 结论 | 落地位置 |
|---|---|---|---|
| 1 | 是否新增、用哪个方案 | **方案 A**：拆两个 skill —— `z-image-prompt-writing` + `qwen-image-edit-writing` | `skills-local/` 两个新目录 + `skills/` 同步副本 |
| 2 | `inpaint` 是否解禁 | **不解禁**，`inpaint` / `style_transfer` 维持禁用 | 改图 skill 内明确「禁止调用 + 替代路径」；总纲固化该硬约束 |
| 3 | `negativePrompt` 参数 | **保留参数，规范内禁止使用**（文生图路径） | `z-image-prompt-writing` 正向改写表 + 总纲硬约束 1 |
| 4 | `prompt_enhance` 是否强制 | **由模型自决**，skill 只写适用性判断 | `z-image-prompt-writing`「提示词增强」一节 |

配套落地：总纲新增「图像提示词写法」小节做调度指引（出图前必须加载对应规范）；`src/skill-catalog.ts` 补两条 `prompting` 分类条目并标 `hidden: true`。

### 遗留待办

1. **图生图端点模型确认**（见第一节末尾）—— 确认后回填 skill 与本文档。
2. 验收：重启桌面 → 新会话出图，看模型是否在 `image_generate` 前加载了两个新 skill 之一，且文生图未传 `negativePrompt`。

---

## 附：信息来源

- Z-Image Turbo Prompting Guide（社区整理，含官方 HF 讨论引用）：https://gist.github.com/illuminatianon/c42f8e57f1e3ebf037dd58043da9de32
- fal.ai Z-Image Turbo Prompt Guide：https://fal.ai/learn/devs/z-image-turbo-prompt-guide
- Z-Image-Turbo 能力说明（8 步 / 双语 / 文字渲染 / 无负向无 CFG）：https://seedreamplus.com/ai-image-generator/z-image-turbo
- Qwen-Image-Edit 官方提示词指南：https://qw-image.com/blog/qwen-image-edit-prompting-guide
- Qwen Image Edit Plus 提示词结构（四段式 + 案例）：https://deapi.ai/blog/qwen-image-edit-plus-prompting-guide-how-to-write-edit-instructions-that-actually-work
- Qwen-Image-Edit 能力与参数（steps/guidance/输入尺寸）：https://segmind.com/models/qwen-image-edit
