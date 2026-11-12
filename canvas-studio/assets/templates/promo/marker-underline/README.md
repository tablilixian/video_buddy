# promo/marker-underline · 马克笔大字标题(2.5s)

**来源**:上游 `demos/typography/marker-underline-title/MarkerUnderlineTitle.tsx`
(对标 notion-ai.mp4 2.3–3.6s 的马克笔下划线镜头)。Apache-2.0,只取手法与参数,
表达重写、文案中性化。

## SSR → DSL 翻译对照(本模板是「运行期计算 → 制作期预烘焙」的样板)

| 上游(SSR/TSX) | 我们(manifest DSL) | 保真度 |
|---|---|---|
| `mulberry32(77)` 运行期生成毛糙笔形多边形 | **制作期跑同款算法把中轴线预烘焙成静态 `d`**(含微歪/缓波),写死进模板 | 笔形一致;「粗细起伏」降级为均匀粗描边(笔形多边形是 fill,我们的 path 是 stroke 语义) |
| `interpolate(frame,[0,22])` + `1-(1-t)^3` | `animate easing:'backOut'` + scale/opacity 弹入 | ✅ 等价(backOut ≈ easeOutBack) |
| `clipPath` rect 从左到右揭示 | `shape:'path'` + `draw{startFrame:32,durationInFrames:10}`(原生描画) | ✅ 更简洁(原生 draw) |
| 斜体 "new" 分色 | 整行单色(DSL 无 per-word 样式) | ⚠️ 降级,已知边界 |
| `letterSpacing:'-0.02em'` | `letterSpacingEm:-0.02` | ✅(REQ-038 RQ-02 原语) |

**验证结论**:SSR 的「运行期确定性计算」可以**在模板制作期预烘焙**进 DSL 数据 ——
这是普适技巧(伪随机装饰、复杂路径、粒子初始位形都适用)。真正的表达缺口只有
per-word 分色类(已知暂缓)。
