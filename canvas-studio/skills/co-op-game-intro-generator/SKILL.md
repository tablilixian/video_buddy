---
name: co-op-game-intro-generator
description: |
  Style knowledge for two-player co-op game menu and opening animations: a fixed game-UI framework (16:9 main-menu layout, upper-left player card, right-side vertical menu, bottom caution tape, Continue as visual focus, icon row, bold all-caps typography) filled by a user-selected art style, identity mapping from character reference photos without inheriting photographic realism, and repair rules for garbled UI text. Use for game concepts, character-led menus, and social content. Not for playable game development, complex multi-page UI, exact brand-logo replication, or generic character-free title sequences.
compatibility: Requires the MiniMax Hub agent (canvas workspace and MiniMax H3 generation); not portable to generic agent harnesses.
---

# Co-op Game Intro Generator

双人合作游戏主菜单/开场动画的**风格知识库**：固定 UI 骨架、风格填充规则、身份映射与文字纠错。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：用户要做双人合作游戏 intro，希望先确认视觉方向再出片；也适用于游戏概念、角色主导的菜单动效与社媒内容。

**不用**：可玩游戏开发、多页面复杂 UI、精确品牌 logo 复刻、无角色的通用标题片。

## 必读分册（运行时必需输入，不是背景资料）

- `references/h3-confirmation-image-template.md` —— 写确认图提示词时必读。按顺序填模板字段，不得跳过框架、色板、UI、角色、排印、版面或负向约束任一节。
- `references/h3-video-prompt-template.md` —— 填终版 MiniMax H3 视频提示词时必读。按已确认的确认图、玩家/游戏数据、终版 UI 文案、事件时序、动效方向与负向约束填模板。

任一模板不可用时，停下并报告 skill 包不完整，**不要**即兴发明另一套提示词结构。

## 风格知识

### 固定骨架 + 动态风格

确认图由两个独立系统组成：**固定的 UI 框架**与**动态的视觉风格**。

- UI 框架定义版面、构图、信息层级、交互逻辑、阅读动线、菜单结构与可读性，这些元素不随风格改变。
- 风格只控制美术外观：渲染媒介、材质、色彩语言、光线情绪、环境风格、角色设计、服装语言、UI 材质、图标语言、排印外观、装饰母题与整体氛围。
- 换风格应像"同一套专业游戏菜单换了美术指导"，绝不是在重新设计界面。
- 默认描述与所选风格冲突时，**风格优先**，但必须保留 UI 框架。

### 风格优先级最高

用户选定的风格（预设或自定义）控制：补充风格语言、色板语言、背景纹理、角色渲染、表情、服装方向、UI 配色、按钮与图标风格、排印质感。风格变了要重写整体风格、色板、角色风格、背景、游戏 UI、按钮、图标与排印，**不要**去改版面框架。

### 固定骨架要点

1. **整体风格**：保留游戏主菜单 UI、高质量游戏宣传海报、UI 与角色深度融合、现代商业游戏 UI 设计、强视觉冲击、干净构图、不过度装饰。
2. **色板**：`{main_background_color}` 作主色、`{ui_body_color}` 作 UI 主体色、`{text_color}` 作文字色、`{functional_accent_color}` 作功能强调色、红色只用于危险/退出；整体控制在五色以内、高对比色块、清爽现代。后续所有 UI/按钮/图标/文字颜色都必须跟随这套色板。
3. **构图**：固定 16:9 横屏、满幅背景、`{character_count}` 个角色居中作视觉主体、UI 环绕而不遮挡角色、左上玩家卡、右侧竖排菜单、底部警示条、少量角落涂鸦点缀、Z 字形阅读动线、足够负空间、层级清晰、Continue 作视觉焦点。
4. **背景**：纯 `{visual_style}` 背景 + 轻微风格纹理 + 大面积纯色留白，纹理只作细节；避免重脏污/密集划痕/过多墨迹/大面积喷溅，保留少量黑色喷漆边缘细节，走干净现代高级 UI 优先的背景。
5. **光照**：保留顶部主光、左上暖/冷辅光、柔和底部环境反射、柔阴影、接触阴影、轮廓光、高质量 GI、角色与背景自然融合；冷暖由风格决定。
6. **游戏 UI**：保留主机游戏菜单、统一按钮尺寸、圆角矩形、轻微倾斜、少量喷漆/滴挂元素、现代干净的贴纸设计、可读、不过度装饰。按钮主体、描边与辉光颜色跟随色板。
7. **按钮布局**：横向长按钮，宽高与圆角统一、宽度适配文字、标题只允许单行不换行不双行、文字居中、边距与间距一致。Continue 是大号居中高亮按钮并带 hover/click 态；Start New Game 在 Continue 上方；Settings 视觉一致；Exit Game 使用危险/退出提示，允许红色强调。
8. **玩家卡**：左上 `{display_name}`-玩家信息卡，不规则矩形卡、描边、轻微边缘破损、左侧 logo/图标、右侧三级信息（PLAYER 标签、昵称、READY）、粗体无衬线、工业贴纸设计。卡面、描边、READY 色与 logo 风格跟随色板与所选风格。
9. **图标系统**：图标风格由所选风格推导、颜色由色板决定；只允许单行、不换行、不堆叠，每个 UI 区块最多一行、数量克制、尺寸统一，绝不抢焦点。
10. **排印**：粗体无衬线、全大写、Anton/Impact/Burbank/Tungsten 一类字重、紧字距、粗笔画、层级清晰、单行排印不换行、按钮宽度适配文字，绝不出现双行菜单标题。颜色与质感跟随色板与所选风格。

### 角色与身份映射

用户提供角色图时，PLAYER 1 / PLAYER 2 参考图**只用于身份映射**：可辨识的脸部剪影、发型、眼镜、相对五官比例与显著特征。**不要**继承照片写实度、皮肤纹理、真实世界光线、相机画质或原图风格；要把脸重新设计进所选视觉风格，同时保留身份锚点。

角色 A（PLAYER 1）：面部特征来自角色图 1；表情、渲染与服装跟随所选风格；可选兼容服装维度——卡其短夹克、黑色内搭、黑色工装裤、棕色靴子、探险者装扮。固定动作：盘腿、双手撑地、略微后仰、抬头看。

角色 B（PLAYER 2）：面部特征来自角色图 2；表情、渲染与服装跟随所选风格；可选兼容服装维度——绿色厚夹克、酒红色加绒内里、白色内衬、黑裤、厚靴。固定动作：盘腿、双手放在腿前、略微前倾、看镜头。

### 失败修复

- 文字不可读：减少画面内文字量。
- 身份互换：强化姓名、位置与颜色区分。
- 人脸漂移：复用上传的参考图并显式保留身份锚点、发型与服装锚，同时让脸仍渲染在所选视觉风格里。
- 所选风格表现太弱：重写整体风格、色板、角色风格、背景、游戏 UI、按钮、图标与排印，**不要**改版面框架。
- 确认图整体正确但个别文字错（按钮标签或标题的错字/乱码字形）：优先用画布 `image_fix` 修字，提示词**只带文字部分**（准确字符串 + 字体/尺寸/位置锁定，从图像提示词里抽取），不带场景/UI 描述——它是图像编辑接口。修复产物文件名带 `boogu_` 前缀。

## 边界

视频模型固定 MiniMax H3，本项目没有模型选择环节。生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。
