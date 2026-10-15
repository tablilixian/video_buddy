# 分册：静帧与定格组装（paper-collage-explainer-generator）

> 何时读：写静帧要求、排定格组装顺序、组装运动提示词模板时。

## 1. 静帧要求

每段出一张终帧静帧，这张静帧必须看起来就是未来动画的最后一帧。

- 使用用户指定的画幅；否则默认 16:9 横屏。
- 平涂大胆纸背景 + 细微纤维纹理。
- 三到六个大的可分离物件组（除非已确认的分镜确实需要更多）。
- 清晰的中心主体、强视觉层级、充裕干净负空间、可见的前景/中景/背景分层。
- 以黑白半调摄影剪影作为主要结构，配合丰富但可读、支撑故事节拍的场景道具。
- 只在有助于强化层级的地方使用彩色卡纸点缀。
- 暖奶油描边、柔和物理纸阴影、精致的撕裂边与细微层叠接缝。
- 除用户明确要求外，不出现可读文字、假字母、数字、字幕、UI、水印或 logo。

静帧看起来太杂乱、配色不搭、纸层过多、数字边缘太死板或做旧/棕色纸质过重时，改静帧而不是在视频提示词里救。

## 2. 定格组装默认顺序

把已确认的静帧当作已完成的终帧，为它准备运动方案。默认顺序：

1. 从与已确认静帧主背景一致的干净纸色场起手，不要用不搭的牛皮纸或棕色底。
2. 基础结构以滑入、pop 或按压就位的纸片出现。
3. 角色、卡片、物件或主隐喻元素入场。
4. 次要物件逐个组装，带小回弹、按压平整与停顿节拍。
5. 最终关系锁定到已确认构图。
6. 结尾短暂保持已完成的静帧画面。

## 3. 运动提示词模板

```text
Paper-collage stop-motion assembly. Start on a clean paper field matching the approved still's background color and tone. Assemble the scene piece by piece with tactile stop-motion timing: foreground, midground, and background paper groups appear in a readable order; each paper object appears, slides or pops in, lightly bounces, presses flat, pauses, and locks into place. Preserve the halftone dots, cream keylines, subtle fibrous torn edges, layered paper seams, soft shadows, paper grain, color field, and approved aspect ratio. End by holding the completed composition matching the approved still frame. Sound design: tactile collage SFX only, synchronized to paper-piece motion: soft paper slide, pop-in, press-flat tap, light rustle, and tiny paper snap where appropriate. Default: do not add BGM, voiceover, dialogue, or subtitles unless the user explicitly requested them. No mismatched kraft-paper opening, no brown/yellowed base unless approved, no fast spinning, no chaotic object flight, no smooth digital layer movement, no scene cuts, no camera move, no zoom, no morphing, no new objects, no text, no logos, no watermark, no UI.
```
