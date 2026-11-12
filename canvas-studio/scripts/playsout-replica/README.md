# playsout 复刻（60s 产品宣传片 · 12 镜头）

把已做好的 60s 产品宣传片 `playsout-promo`（12 镜头）**等价复刻**成一份
**manifest 驱动的成片**（不是 agent 手写 TSX）：脚本生成 manifest → 走产品真实链路渲染。

- 产物形态：`CompositionManifest`（174 条顶层轨 + 79 条 group 子轨 / 1800 帧 / 1920×1080@30）
- 素材：源工程 `public/` 的 239 个素材 + 40 张预生成 PNG + 4 个字体面（HarfBuzz 精确排版用）
- 校验：产品 `validateManifest` **ok=true / errors=0**
- 实渲：取证台走产品 `renderManifestOnWeb` **1800 帧 / ≈49s / 27.6ms 每帧 / raf 60Hz**

## 目录

| 文件 | 作用 |
| --- | --- |
| `lib/png.mjs` | 零依赖 RGBA→PNG 编码器（预生成素材的底座） |
| `lib/theme.mjs` | 主题 token / 画布 / 时间轴 / 12 镜头分镜 / logo 墙几何 |
| `lib/spec.mjs` | 分镜内容与时序（VO、字幕、46 条 SFX 钉帧、标题卡、相机关键帧、卡片数据…） |
| `lib/metrics.mjs` | **真实字宽**：`fontverter`(woff2→sfnt) + `harfbuzzjs` 取 advance 宽 |
| `stage-assets.mjs` | ① 铺素材到 staging ② 生成灰阶 logo / 光晕 / 压暗条等预生成 PNG ③ 出素材清单 |
| `build-manifest.mjs` | 组装 manifest（几何、字宽反推、分镜时序、动画链） |
| `preview-shot.mjs` | 裁单镜 manifest（时间轴归零）供快速迭代 |
| `install.mjs` | 装机：铺进目标项目 assets 目录 + 改写 URL 前缀 + 出同源 URL 清单 + 复验 |

## 复跑（三条命令）

```sh
cd canvas-studio

# ① 素材 staging（239 源素材 + 21 灰阶 logo + 19 预生成 PNG + assets.json）
NODE_OPTIONS= node scripts/playsout-replica/stage-assets.mjs

# ② 组装 manifest（174 顶层轨 + 79 group 子轨 / 1800 帧）
NODE_OPTIONS= node scripts/playsout-replica/build-manifest.mjs

# ③ 装机到目标项目（铺素材 + 改写 URL 前缀为真机 projectId + 出清单 + 复验）
NODE_OPTIONS= node scripts/playsout-replica/install.mjs \
  --project "/Users/wl/Desktop/job/VideoOut/new3/projects/做一条 45 秒科普动画：主题 [DNS 2" \
  --project-id db4464df-b8a4-4b55-80f9-e76de376e5db
```

装机后产物：

- `<项目>/build/playsout-manifest.json` —— 真机 manifest（资产 URL 前缀 = `/canvas-studio/assets/<projectId>/`）
- `<项目>/build/playsout-assets.json` —— 同源 URL 清单（279 条：文件名 / 字节 / sha256 前 16 / URL / 状态）
- `<项目>/assets/` —— 279 个素材文件（115 个被 manifest 引用）

真机出片：

```sh
render_composition({ manifestPath: "<项目>/build/playsout-manifest.json", quality: "draft" })
```

## 本地实渲（取证台，走产品渲染路径）

```sh
# 全片（1800 帧）
RF_MANIFEST="$PWD/build/playsout/manifest.json" NODE_OPTIONS= \
  node scripts/render-forensics/run.mjs --only=Q10 --windows=hidden

# 单镜（150 帧 ≈ 5–7s）
node scripts/playsout-replica/preview-shot.mjs t1
RF_MANIFEST="$PWD/build/playsout/preview-t1.json" NODE_OPTIONS= \
  node scripts/render-forensics/run.mjs --only=Q10 --windows=hidden

# 抽帧目视
ffmpeg -y -v error -i <成片>.mp4 -vf "select='not(mod(n\,60))',scale=480:-1,tile=6x5" -frames:v 1 /tmp/sheet.png
```

改过 `src/**` 后必须先 `touch scripts/render-forensics/entry.tsx`（bundle 复用只看入口 mtime）。

## 这套做法为什么是「脚本生成 manifest」

手写 60–120KB 的 JSON 必然出错（2026-11-05 有 3h37m 零成片的前车之鉴）。
脚本化之后**规格（`lib/spec.mjs`）与产物（manifest）分离**：改分镜改 spec，不改产物；
几何、字宽、帧号全部由代码算，不靠人肉填。

## 排版为什么必须用 HarfBuzz

DSL 的 `textCard` 把文字**居中在 box 里**（实测：探针 `box.x=12.86%` 的文字墨迹中心恰在 12.86%）。
源片的标题全是**左对齐**，于是要让文字从某个 x 起排，box 的中心必须落在 `x + 字宽/2` ——
「字宽」必须是**渲染器真实画出来的宽度**，估值必漂。
`lib/metrics.mjs` 用仓库已有的 `fontverter` + `harfbuzzjs` 取 advance 宽，**不新增依赖**。

实测锚点：NBDisplay ExtraBold @84px 的「The」advance = 147px；
Electron 里渲染出来 = **147.26px**（像素级吻合）⇒ 度量口径与渲染器一致。

## 踩过的坑（别再踩）

1. **`animate` 多段之间留空档 ⇒ 整块钉死**：`animateStateAt` 对每个维度独立选段，
   帧落在两段空档时取「末段终点」（open-wall 的 opacity 被钉成 0 ⇒ 整个 logo 墙不可见）。
   ⇒ 关键帧链必须**首尾相接**。
2. **有 `box` 的轨不能声明 x/y**（`transform`/`animate`/`exit`/`orbit` 全部互斥）
   ⇒ 需要位移的 sized 元素（汇聚卡 / 合影块 / 推镜）用 **`group`（单子轨）**承担位移。
3. **`animate` 的 x/y 没有 0–100 硬校验**（只有 `box` 有）⇒ 离画布起飞的卡可用 x=118 这类值。
4. **`textCard` 的文字居中在 box 里** ⇒ 左对齐必须用真实字宽反推 box 中心。
5. **渲染器不施加 letter-spacing**（源片 -0.022em）⇒ 度量按无字距算，否则词间距被压扁。
6. **`scale: 0` 非法**（必须 >0），用 0.001。
7. **`animOptions.wordDelayFrames` 必须整数**。
8. **`audio.sfx[]` 不接受 `id` 字段**（契约外字段告警）。
9. **box 出画布会硬失败**（logo 墙网格必须 ≤ 1920 宽）。
10. **`.woff2` 走资产路由时 Content-Type 是 `application/octet-stream` + `nosniff`** ——
    实测**照样加载成功**（Electron 147.26px 与 `font/woff2` 一致）⇒ 展示字体可以放心放在项目 assets 目录。
11. 取证台资产路由此前写死 projectId ⇒ 换一份 manifest 的 projectId 就整片 404（已修，按产品语义解析）。

## 已知偏差（相对源片）

| 偏差 | 原因 |
| --- | --- |
| 标题强调词是银色渐变，不是源片的 peri #98A3FF | `textCard.title` 变体只有固定白字，`accentColor` 不生效 ⇒ 用 `fx:'metal'` 近似 |
| Metrics 数字是静态大数字（84px 上限），不是逐位滚轮（源片 124px） | DSL 无逐位 odometer 原语 |
| 每行标题下方有一块更暗的矩形 | `textCard.title` 变体在 box 上硬编码 `rgba(0,0,0,0.35)` 底；源片无此底 |
| 字幕是产品式词级高亮（青 #5ad2ff），源片是纯白硬字幕 | DSL 的 `caption` 轨自带词级三态 |
| SFX 一律从 0 起播 | DSL 无「源内起始帧」（源片 impact-cine-big 从第 55 帧起） |
| 药丸 / 代码面板 / 描边框 / 命中环 / 灰阶 logo / 光晕全是预生成 PNG | CSR 捕获路径读不到 `backdrop-filter` / CSS `radial-gradient` 平铺 / `grayscale()` |
| 3D 推镜用 `group` + 关键帧近似，透视弱于源片 | `perspective` 只能静态写在 `transform`，且 3D 非 0 会把整棵子树拽进 WebGL 预合成（贵 3–5 倍） |

更完整的能力缺口与扩展路线见 [CAPABILITY-GAPS.md](./CAPABILITY-GAPS.md)。
