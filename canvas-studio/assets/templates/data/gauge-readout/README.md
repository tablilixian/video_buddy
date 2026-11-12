# data/gauge-readout · 仪表盘扫针(4s)

**来源**:上游 `demos/data/gauge-readout-moves/NeedleSweepSelftest.tsx`(三联 270° 表盘,
指针甩满回落过冲 8° 再回摆)。Apache-2.0,手法参考、表达重写。

## SSR → DSL 翻译对照

| 上游(SSR/TSX) | 我们(manifest DSL) | 保真度 |
|---|---|---|
| `arcPath()` 运行期算 SVG 弧 d | 制作期预烘焙静态 `d`(画布 0-100 椭圆弧 135°→405°) | ✅ |
| 三段 `interpolate` + `Easing.out(cubic)`/`inOut(cubic)` | `animate` 数组三段折线(`easeOutCubic`/`easeInOutCubic`/`easeOutCubic`)—— **多段折线 = 段内变速的通用译法** | ✅(过冲回落拍子完整) |
| 指针 = 细 rect 绕底端旋转 | `shape:'rect'` + `pivot:{x:50,y:100}` + `animate.rotation`(REQ-034 P1 原语) | ✅ |
| 落定同帧数值弹出 | `textCard` + `anim:'fadeUp'`(数值滚动需 dataCard.countUp,小内嵌数值降级静态) | ⚠️ 数字滚动降级 |
| ML-08「无退场」 | **`lintSuppress:["ML-08"]`** —— 仪器面板常驻是原拍设计(上游 f60 后真静止 80f),模板作者声明豁免 | 设计声明 |

**验证结论**:SSR 的分段缓动插值 → animate 数组折线是**无损翻译**(拍子逐帧对齐);
「运行期数学图形」预烘焙后完全等价。体检器的风格建议需要 `lintSuppress` 出口 ——
已落成模板级机制。
