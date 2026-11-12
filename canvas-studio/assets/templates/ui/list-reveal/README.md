# ui/list-reveal · 菜单逐项找位(3.6s)

**来源**:上游 `demos/ui-entrance/list-reveal/ListReveal.tsx`(motion-lab 定稿转原生
Remotion;垂直菜单六项 outBack 找位 + 容器全程线性上漂)。Apache-2.0,手法参考。

## SSR → DSL 翻译对照

| 上游(SSR/TSX) | 我们(manifest DSL) | 保真度 |
|---|---|---|
| 两层运动分离:容器 `translateY(lerp)` + 逐项 `seg(outBack)` | **`group` 容器轨 `animate(linear y)` + 6 条 `textCard` 子轨各自 `animate(spring)`** —— 容器动画与子轨动画天然叠加 | ✅ 双层结构原生保持 |
| `E.outBack` 过冲找位 | `easing:'spring'` + `{stiffness:120,damping:12}`(ζ 调到过冲 ~10%) | ✅(spring 参数族直接对位) |
| `DesignStage` 480×270 等比放大 | `box` 百分比直排 | ✅ |
| HUES 六色 accent 条 | 无 per-item 色条(单色底签) | ⚠️ 降级 |
| 帧确定性设计像素补偿(-0.5px) | 不需要(我们按百分比直排) | ✅ |

**验证结论**:**容器动画 + 子轨动画叠加**是 DSL 的原生能力(group.animate 与子轨
animate 独立生效),SSR 的「嵌套变换」可以直译;SSR 特有的设计像素补偿在百分比
坐标系下天然消失。
