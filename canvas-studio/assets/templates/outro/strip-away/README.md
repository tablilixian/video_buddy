# outro/strip-away · UI 蒸发落版(5s)

**来源**:上游 `demos/outro/ui-strip-away-outro/UiStripAwayOutro.tsx`(framer-ai
33–36.5s:满屏编辑器 → 点击 Publish → UI 层层错峰蒸发 → 黑场字标)。Apache-2.0,手法参考。

## SSR → DSL 翻译对照

| 上游(SSR/TSX) | 我们(manifest DSL) | 保真度 |
|---|---|---|
| `useStrip()` 逐层 `interpolate`(fade + 定向位移,离场加速) | **`animate` 段 `to:{opacity:0, x/y}` + `easing:'easeIn'`**,每层段起点错峰 4f | ✅(shape 轨 animate x/y 合法) |
| 蒸发层级表(外围先走:sidebar→panels→cards→toolbar) | 9 条 shape 轲段起点 64–84 错峰 | ✅ 节拍逐层对齐 |
| 编辑器 UI 用色块拼(mock) | shape:'rect' 灰阶族(圆角 radius 原语) | ✅ 同为色块 mock |
| `bgDark` 底色渐黑 | `colorShift`(轨级颜色过渡原语) | ✅ |
| Publish 淡出交棒字标 | 按钮/标签轨尾 `animate opacity→0` + 字标 `anim:'fadeUp'` spring 式落定 | ✅ |
| ML-07(峰值 4 层同蒸发) | **`lintSuppress:["ML-07"]`** —— 层窗口 14f × 错峰 4f 的重叠是原拍节奏 | 设计声明 |
| ML-09 曾误报「to.x/y 超画布」 | 体检器语义收窄(2026-11-13):ML-09 只查 **from 端** —— to 超界是退场/过冲的合法演出 | 检测器改进 |

**验证结论**:「多元素错峰退场」类收尾在 DSL 下**完全可表达**;正是它逼出了
ML-09 的语义收窄(to 端超界不报)—— SSR 模板学习反哺了体检器的正确性。
