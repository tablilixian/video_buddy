# 内容规格（content-spec）· RQ-12/RQ-21 填空指南（REQ-038）

> **一句话**：拿到 brief 后，你写的是这份 **spec（JSON 填空）**，不是 manifest 轨。
> spec → `planFromSpec`（产品侧确定性函数）→ manifest。**同 spec ⇒ 同 manifest**（逐字段）。

## 为什么不许直接写轨

- 手写大 manifest 必错（REQ-038 §3 RQ-18：2026-11-05 有 3h37m 零成片的前车之鉴；
  playsout 复刻手搓 265 轨产出 3 个真 bug）。
- spec 把你从「写轨」解放到「填内容 + 选卡」：段结构、时间轴切分、版式轨、装饰层、
  素材槽位全部由**卡注册表**（`recipe-cards.ts`）确定性生成。

## spec 形状（schema 正本在 `src/remotion/content-spec.ts`）

```jsonc
{
  "meta": { "title": "必填", "theme": "cold-tech（可选）", "fps": 30, "durationSec": 60 },
  "sections": [
    {
      "id": "hook",                       // 必填，唯一
      "card": "A2",                       // 卡编号或卡名（'A2 标题逐字' 也认）；缺省 = 占位段
      "copy": "今天，它替你数了一次心跳",   // 必填主文案（B1 用 "键:值; 键:值" 行内格式）
      "durationSec": 3,                   // 显式秒数；不给则按 weight 归一
      "label": "开场",                    // 可选，eyebrow / dataCard 标题
      "assetSlots": { "mainVisual": "/canvas-studio/assets/xxx.png" },  // 可选，素材槽位
      "accentColor": "#4f9cf9"            // 可选，本段强调色
    }
  ],
  "captions": [{ "text": "…", "startSec": 0.5 }],   // 可选
  "sfx": [{ "name": "impact-cine-big", "startSec": 1.83, "gain": 0.8 }]  // 可选
}
```

## 校验（`validateContentSpec`）

- 必填缺失 / 取值越界 ⇒ **error**（拒收，修完再跑）；
- `card` 未注册 ⇒ **warning**（该段走占位回落，出片但只有一张占位卡）；
- `captions[].text` / `sfx[].name` 空串 ⇒ error。

## 内置卡速查（`registeredCardIds()`；卡册全文见 `shot-cards.md`）

| 卡 | 用途 | 素材槽位 | 缺素材降级 |
| --- | --- | --- | --- |
| `A1` | 标题遮罩揭示 | —（零素材） | — |
| `A2` | 标题逐字打出 | — | — |
| `A4` | 要点逐词落位（copy 按 `；` 或换行拆条） | — | — |
| `A5` | 收尾落版（自带 exit 上浮淡出） | — | — |
| `A6` | 结论条（黑底圆角 + 白字单句；`label` 是上方标题，可空） | — | — |
| `B1` | 数据卡（copy = `键:值; 键:值`，数值自动 countUp） | — | — |
| `DAT6` | 折线 + 峰谷标注 + 均值虚线（copy = `标签:数值; …`，`label` = `标题 \| 高点文案 \| 低点文案`） | — | — |
| `C2` | 左右分栏（文 + 图） | `mainVisual`（user） | 色块占位，不阻断 |
| `E1` | 素材推拉（全屏 kenburns + 暗角 + 字幕） | `scene`（user） | 退化为标题卡 |

### 分段着色 `highlights`（R11）

标题里想「两个关键词各一种颜色」（「继续」橙 /「回来」青）时用它，**不要**去改 `copy`
或拆成两屏：

```json
{ "id": "s1", "card": "A2", "copy": "继续，还是回来",
  "highlights": [{ "text": "继续", "color": "#F5A623" }, { "text": "回来", "color": "#2EE6A8" }] }
```

- 命中 = `copy.indexOf(text)` **第一处**；同一子串出现多次只有第一处变色。
- 互不重叠（先声明的优先）；找不到的项只 warn，不改画面。
- 只在 `copy` 是字符串时生效；`units` 型屏写在各单元的 `highlights` 里（单元级覆盖屏级）。
- `A1` / `A2` / `A5` / `A6` 消费这个字段；`B1` / `DAT*` 没有标题槽，写了也不生效。

每卡自动长出的版式：段底板 + 点阵（`dotGrid`）+ 径向光晕（`gradient radial`）+
眉标 + 主内容 + 强调线 + 角标 + 暗角（`vignette`）—— playsout 设计语言的代码化。

## 素材契约（RQ-21）· 写 spec 前先看清单

1. `specAssetNeeds(spec)` 给出**机读素材需求清单**，按 `source` 三路分流：
   - `user`（必须用户给 / 真实品牌）：**选卡阶段就先列出来问**，缺了走 `fallback` 降级出片，
     降级记录写进交付说明 —— **不整片停摆，也不造假**；
   - `library`（资产库复用：SFX / 媒体 logo）：查 `list_library_assets` 直接取；
   - `generated`（可生成：海报 / 广告图 / 抽象底图）：走画布媒体生成。
2. **品牌红线（SB-5）**：`kind: 'logo' | 'ui'` 的素材**永远不可能**来自 `generated` 通道
   —— 卡注册表在注册期就拒收这种声明。你也不许在 `assetSlots` 里塞 AI 画的 logo。
3. 同一份 spec 两次运行产出**同一份**清单（确定性）—— 清单可以直接贴给用户。

## 产出物怎么进 manifest

```
brief → 你写 spec（本文件 schema）→ validateContentSpec 零错
      → planFromSpec(spec, totalFrames) → { tracks, timeline, assetNeeds }
      → 包上 meta/audio → validateManifest → render_composition
```

`totalFrames = durationSec × fps`；时间轴末段吃余数保证 Σ = 总帧（时长自洽）。

## 出片优先（M1 硬规则，2026-11-16 真机事故后加）

`scaffold_manifest` 落盘成功 ⇒ **下一条动作必须是 `render_composition({ manifestPath, quality: 'draft' })`**。
先看动起来的效果，再决定改哪里。**禁止**在这一步去读 / 改宿主源码、或另写一份生成器 / 手搓 manifest
—— 真机有过一次 100 分钟零出片，全部时间消耗在「发现画幅不对 ⇒ 决定重写渲染层 ⇒ 反复重读源码 ⇒
一次没落笔」。

画幅 / 版式 / 字号不对，**都改 spec 重跑 `scaffold_manifest`**，不要绕开它。

## 竖屏（9:16）必读：格位投影会把 box 压扁

spec 里的 `cell` 是「这张卡的整块画布」，卡内元素按**卡内比例**落在格位里。所以：

- 竖屏下 title 单元 `cell.h: 24` ⇒ 卡内标题只占卡高的 30% ⇒ 实际盒高 `7.2% × 1920 = 138px`，
  一行 149px 的标题放不下。**想让标题真的占满这一格，把 `cell.h` 调到 30 以上**。
- 字号由盒子的**宽与高共同**决定（R11 起盒高进缩号循环）：盒矮就降号，**不会裁字**，
  但字会变小。回执里的「盒高只有 Npx（只够 M 行）」就是在说这件事。
- 正文用 `A4`（要点）时同理：`cell.h` 太矮会被压到「条目还在、字变小」；条目数多就给高一点。

判定口径很简单：**回执里出现「会被裁掉」= 必须改；出现「盒高只有」= 字被压小了，觉得不够大就加高格位。**
