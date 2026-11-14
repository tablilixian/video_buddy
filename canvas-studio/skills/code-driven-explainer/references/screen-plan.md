# 屏表（screen-plan）· 版面层分册（REQ-038 R7）

> **一句话**：45s 以上的科普/汇报片，先切「屏」再写轨 —— 屏数与节奏用 `meta.autoStages` 交给工具算，
> 你只管每屏放什么（1–4 个单元）与哪里常驻（`carry`）。**别再靠自己在 `sections[]` 里写 `durationSec` 数屏**：
> 真机 45s 那次数对了 6 屏，但屏长 3.4–12.7s 离散 3.7×，没有节奏可言。

## 0. 三层资产之间为什么缺不了「屏」

| 层 | 资产 | 粒度 | 一句话 |
| --- | --- | --- | --- |
| 屏 | **本分册**（`sections[]` + `cell`/`units`/`carry`） | 屏（4–10s） | 主力：版面与节奏 |
| 段 | `RECIPES`（`planRecipe` 永远 4 段） | 段（太粗） | 只做骨架 smoke |
| 轨 | 手写 manifest | 轨（太自由） | 版面决策全丢给模型 = 必错 |

模板（`templateId`）是**屏级可复用版式单元**，一条 45s 片最多吃 2–3 屏（开场/落版/罗列），
其余屏必须用「卡 + 格位」拼 —— 详见 `template-usage.md` 与 `template-gate` 的 `stageSeconds` 口径。

## 1. 屏表字段（schema 正本在 `src/remotion/content-spec.ts`；基础填空见 `content-spec.md`）

```jsonc
{
  "meta": {
    "title": "必填", "fps": 30, "durationSec": 45,
    "autoStages": true,              // ← 显式 true 才把屏数/节奏交给工具（B1）
    "stageBoundarySec": [6.5, 12.9]  // ← 可选：TTS 句起点（秒，严格升序），屏边界向它 ±0.6s 吸附
  },
  "sections": [                      // 段 = 屏（autoStages 下段数必须 == 工具算出的屏数）
    {
      "id": "s2", "copy": "收入 1.2 亿",
      // autoStages 开启时【不许】写 durationSec / weight —— 节奏归工具，写了即拒收
      "cell": { "x": 50, "y": 50, "w": 88, "h": 46 },   // 本屏缺省格位（%）
      "units": [                                        // 一屏 1–4 个单元；与 card 互斥
        { "card": "DAT2", "copy": "1.2 亿 · 同比 +18%", "cell": { "x": 28, "y": 50, "w": 42, "h": 44 } },
        { "card": "A4",  "copy": "三条产品线全部转正",   "cell": { "x": 74, "y": 50, "w": 40, "h": 44 } }
      ]
    }
  ],
  "carry": [                         // 跨屏常驻层（页眉/底板/四角括线）：一条轨跨多屏，只声明一次
    { "id": "panel", "box": { "x": 50, "y": 54, "w": 88, "h": 46 }, "color": "#151c2c", "radius": 18 }
  ]
}
```

- **格位就是字号旋钮**：`textCard` 白名单没有 `fontSize`，字号由渲染期 `planTextFit` 按 box 宽度推 ——
  字要更大，把格位加宽，不要找 fontScale 字段（不存在，写了会被校验拒收）。
- `carry` 的帧窗 = `fromSection` 首帧 → `toSection` 末帧（缺省全片）；指向不存在的屏 id 即拒收。
- 屏内布局怎么排（split-lr / chart-focus…）→ `../../canvas-studio-creation/references/layout-recipes.md`。

## 2. autoStages：屏数与节奏是算出来的（R7-B1）

```
屏数 = clamp(round(totalSec / 6.5), 2, 40)，再拉进「单屏可行带」[ceil(total/10s), floor(total/4s)]
屏长 = 总帧等分；屏边界向 TTS 句起点（stageBoundarySec）±0.6s 吸附，超出不迁就
45s → 7 屏 × 6.43s（离散 1.0×，对照真机 3.7×）；304s → 触 40 屏上限并标 clamped
```

- **6.5s 的来历**：短视频节奏基准（流程推演 §4.1）；改值只改 `stage-plan.ts` 的 `TARGET_STAGE_SEC`
  一处常量，且必须回填标定表（`docs/plans/REQ-038-R7-…md` §11.6）。
- **何时开**：≥45s 的多屏片默认开；**何时不关**：单屏/双屏的短模板片（模板自带时长）不需要。
- `scaffold_manifest({ specPath })` 回执的屏表尾部带「节奏：planStages 算出 N 屏（目标 X，屏长 A–Bs）」——
  工具替你做的节奏决定在这里，**段数对不上屏数会直接拒收**（把 sections 调成 N 段，或关掉 autoStages 自己控）。
- `stageBoundarySec` 从哪来：`tts` 真值回执的句起点（`audio.voiceOver[].startSec`）。先渲一版拿句点、
  再回填 spec 重编 —— 字幕压屏的前提是屏与句对齐。

## 3. 与电影分镜的三处差异（照抄分镜表必错）

屏表 ≈ 分镜，但它是「排版单位」而非「拍摄单位」。两处必须多、一处必须少：

1. **多：`carry`（常驻层）**。电影有摄影机物理连续性，代码每帧重算 —— 跨屏不变的底板/页眉必须
   显式声明，否则下一屏就没了。真机 45s 版 0 块常驻 vs 手写 60s 版 9 块，差的就是这个字段。
2. **少：无运镜**。分镜的景别/推拉/摇移在代码路线里**没有对应物** —— 屏表的「运镜」是格位与节奏。
   写「中景，缓慢推进」没有消费者（渲染器不认、模型也不生成）；动感靠 `animate`/`kenBurns`
   （→ `motion-patterns.md`）。
3. **多：必须机器可校验**。「压抑的氛围」是合法分镜描述，渲染器消费不了。屏表每个字段都要能算：
   占几 %、几个元素、持续几秒 —— 两条例行判据（lint）就是干这个的：
   - **ML-16** 单元素采样秒占比 >25% ⇒ warning（真机 45s 命中 51% = 「一张卡慢慢换」）；
   - **ML-17** 全片无 `carry`/常驻层 ⇒ warning（常驻层的定义是**跨屏存在**，不是零入场）。

## 4. 真渲过的 6 屏样例（本仓 assets 里有 spec + 3 张 SSR 静帧）

`assets/screen-plan-example.json`：39s（`autoStages: true` → 工具算出 6 屏 × 6.5s，**spec 里没有任何
durationSec**）、1 标题屏 + 4 数据屏（各 2 单元）+ 1 收尾屏、1 条 88%×46% 跨屏底板。
编译后 126 轨 / 1170 帧（含 62 条段间叠化转场 —— compose 层自动插，屏边界不再硬切），
体检 **零告警**。静帧（SSR 直渲，非真机）：

| 屏 | 静帧 | 看什么 |
| --- | --- | --- |
| s1 标题 | `assets/screen-plan-example-s1.png` | A2 逐字标题 + 底板常驻层已在场 |
| s3 双单元 | `assets/screen-plan-example-s3.png` | DAT3 三格数据 + B1 数据卡并置，同屏 2 单元 |
| s6 收尾 | `assets/screen-plan-example-s6.png` | A5 落版 + 底板全程未消失（carry） |
| 边界叠化 | `docs/archive/2026-11-14-r7-b4-boundary/` | s1→s2 边界帧 185/190/200 + ffmpeg PSNR 对证（190 与两侧都差 ≥ 明显幅度 ⇒ 渐变不是硬切） |

复现：`NODE_OPTIONS= node docs/archive/2026-11-14-r7-b2-stills/still-example.mjs`
（bundle 入口同目录 `entry-example.tsx`；静帧 = 屏中点帧 97/487/1072）。

**从这份样例学四件事**：① 每屏 1–4 个单元、各占自己的 `cell`，不重叠不留大空白；
② 底板是 `carry` 一条声明，不是每屏重画；③ 屏与屏之间没有运镜衔接 —— 动感来自卡内动画与节奏；
④ **数据卡 copy 语法只有一种**：`;` 或换行分行、`:` 分键值（B1/DAT3/UI5 都是）；
DAT1 更特殊，每行是「角度,值」两个逗号字段。`|` / `::` **不在任何卡的语法里** ——
上一轮 45s spec 写了 `留存率::68|上月::63`，编译校验全绿（copy 是自由文本），真渲才发现 DAT3 只出了
一根柱：**编译校验拦不住文案语法错，R3.5 档必须渲 draft + spotFrames 目检**。
