# press/ink-open · 纸墨开场(9s)

**来源**:上游 `template/`(Ink Press 36.2s 整片工程)的开场段(0–275f:墨线+字标压印 →
dashboard 全景 → PageCam 2.5D 推近聚光主卡 → 字卡呼吸位 + FlashCut)。Apache-2.0,
手法参考、表达重写、文案中性化。

## SSR → DSL 翻译对照(含整片工程的翻译路径)

| 上游(SSR/TSX) | 我们(manifest DSL) | 保真度 |
|---|---|---|
| **`PageCam` 的 `CAM_KEYS: {frame,cx,cy,zoom,rotX/Y/Z,persp}`** | **`image.camera.keys`(RQ-23)同构字段** —— 换算:`x=(960−cx)×zoom, y=(540−cy)×zoom`(cx/cy 是相机焦点,我们是内容位移) | ✅ 字段级同构;本模板 keys 即按此换算 |
| zoom 0.78 全景(长截图页面缩小于视口) | `zoom:1.0` 铺满 —— **0.78 会露底,长截图(PAGE_H>1080)才能完整还原**;16:9 截图时全景=铺满 | ⚠️ 语义降级(依赖素材长宽比) |
| `rotY:34°` 侧视推近(rotX 8/rotZ 2/persp 1200) | 同名同值进 `camera.keys` | ✅ 伪 3D 全字段直译 |
| `live-layout.json` 元素坐标表(每元素 x/y/w/h) | `box` 百分比 + RQ-24 采集链的 `layout.json.layoutTable`(下游同口径) | ✅ 坐标表链路对位 |
| `PaperTitleCard` 衬线逐词 + accent 琥珀词 | `textCard title` + `maskReveal`/`fadeUp`(per-word 分色降级整行) | ⚠️ 分色降级 |
| `FlashCut` 只盖切点两侧 5f | 白闪 shape 轨 9f `animate opacity 0.9→0` + SFX | ✅ |
| CAPTIONS 底部通栏(绝对帧号表) | 两条 `textCard subtitle` 分段 + exit | ✅ |
| 30+ 条 SFX 钉帧表 | `audio.json.sfx[]`(anchor 锚到轨,编译期注入) | ✅ |
| `Easing.bezier(0.35,0,0.2,1)` 自定义贝塞尔 | `easeInOutCubic`(白名单档位近似) | ⚠️ 曲线族近似 |

**验证结论(最重要的一条)**:上游整片工程的**镜头结构、相机关键帧、字幕表、SFX
钉帧表**都能逐段翻译 —— PageCam 与 RQ-23 的字段级同构不是巧合:两边对「2.5D
页面相机」的需求是同一个。SSR 模板学习的主要损失在:①长截图依赖(全景视差);
②per-word 分色;③自定义贝塞尔曲线族 —— 三者都有已登记的降级路径。
