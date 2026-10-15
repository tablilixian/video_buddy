# 分册：提示词脚本与排印纠错（music-video-subtitle-generator）

> 何时读：写多镜提示词脚本、审计提示词、遇到图内文字渲染错误时。

## 1. 创意契约

写最终提示词前先做一份简洁的创意契约：

- 音乐流派、配器、速度/BPM 感、人声模式与情绪温度。
- 歌词来源与锁定歌词。
- 目标时长与多镜拆解（例如 30s 拆成 6 个短镜头）。
- 参考图角色：角色卡、场景卡、排印包装卡。
- 镜头语言、景别、焦点、节拍切密度与转场逻辑。
- 排除项，例如不要淡入淡出、不要光泽 AI 美颜脸、不要单镜过度拉伸导致变形。

## 2. 提示词脚本模板

多镜脚本必须按镜头模块化，带准确时长与音频映射：

```text
[Global Aesthetic & Character Lock]: (global character and aesthetic anchor prompt)

Shot 1 (0.0s - 3.5s)
Vocal Line: "..."
Typography: "..."
Visual & Action: ...
Camera & Motion: ...
Transition Out: hard cut to Shot 2 on bass hit / same-direction whip pan

Shot 2 (3.5s - 7.0s)
Vocal Line: "..."
Typography: "..."
Visual & Action: ...
Camera & Motion: ...
Transition Out: ...
```

## 3. 排印纠错（canvas-studio / image_fix）

MV 排印是本系统文字最密的产物，因此关键帧或海报图上出现错字、糊字形、缺笔画是最可能的缺陷。

静帧里某个词渲染错时（错字 / 乱码字形 / 缺笔画），**不要换种子整张重生成**——那会丢掉已经正确的画面。改用画布 `image_fix` 工具（Boogu Edit 图内文字修复）：

- 构造提示词的方式是**保留原图提示词里锁定文字的句子**——每一处指定文字内容**以及**它在画面里的位置与排布方式（位置、字体、尺寸、颜色、版面）的句子，外加一条约束：每个字形必须精确复现，不得替换、添加或遗漏。
- **丢掉美术指导句**（画幅、材质、光线、色板）。
- **只给一串字符是不够的**：没有位置锚点时模型只能猜最接近的字形——实测 `武仔` 回来变成 `武传`（仍然错），还带出两处凭空发明的文字。证据：`docs/api-probe/image2fix-20260920-text-spec/`。
- 保持不带任何场景/角色/风格描述——这是图像编辑接口，多余描述会破坏画面。
- 修复产物文件名带 `boogu_` 前缀。
