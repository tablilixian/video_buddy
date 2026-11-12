# P 类体裁卡 · 产品宣传片（RQ-11② · REQ-038）

> **定位**：「产品宣传片」体裁的卡册。**卡内容 = 参数化生成器**（`recipe-cards.ts` 里注册，
> `P1` / `P3` / `P5` 三张样卡先跑判据分布 —— 拍板 **SB-2**）；运动语法从手法库取
> （`shotcraft-catalog.md`），不重复发明。
> 骨架：`RECIPES['product-promo-60s']`（12 段位沿 playsout 时轴结构）。
> 素材契约：`assets: [{slot, kind, source, required, fallback}]`（RQ-21 机读）。

## 判据口径（RQ-11 验收 2/3/4 的可执行面）

- **轨数口径**：人工介入轨数 = spec 声明的段数；展开后总轨数 = 生成 manifest 的轨数。
  实测（`scripts/param-audit/param-audit.mjs`，spec-a）：人工 **4**（≤30 ✅）/
  展开后 **27**（≤150 ✅）。playsout 手搓基线两者都是 **265**。
- **参数化率**：每卡声明可换参维度 ≥5（下表「参数化维度」列）；**结构面**（维度写进
  轨参数 = 接进生成器）由 `param-audit.mjs` 自动断言；**像素面**（换参重渲关键帧
  PSNR <30dB，≥40 判摆设）由真机渲染后跑 `scripts/pixel-audit/frame-diff.mjs`。
  实测结构面：P1 接线 8/11、P3 7/7、P5 6/6（均 ≥5 ✅）。
- **不雷同**：两份 spec（换产品名+数据+素材，拍板 **SB-3**）生成指纹不同（结构面 ✅）；
  像素面（两两 PSNR 中位 <25dB 且 min <20dB，且两片各自过 RQ-13 亮度闸）留真机。

## P1 · 伙伴墙开场（logoWall）

- **用途**：片头 —— 合作方 logo 墙 + 主标题。
- **槽位**：`copy`（主标题）/ `assetSlots.partnerLogos`（逗号分隔的 logo URL 列表）。
- **原语**：`logoWall`（1 条轨承载全部 logo；21 元素手搓 21 轨 → 1 条）+ `title`
  (`maskReveal` + `plate:'none'` + `letterSpacingEm:-0.022`) + `vignette` + `dotGrid`。
- **参数化维度（11）**：列数 `columns` / 单元尺寸 `cellW/cellH` / 间距 `gapX/gapY` /
  灰度 `grayscale` / 错峰 `unitStagger` / 圆角 `radius` / 标题文案 / 字距 /
  强调色 `accentColor` / 墙位置 `box` / 暗角强度。
- **素材**：`partnerLogos` = user 通道（**品牌红线 SB-5：logo 禁 AI 重画**）；
  缺席降级 = 纯标题开场（logoWall 不出轨，出片不阻断）。
- **验收帧**：段中点（墙全亮、错峰完成）。

## P3 · 芯片条 + 数据卡

- **用途**：数据锚点段 —— 卖点药丸行 + 键值数据卡。
- **槽位**：`copy`（`键:值; 键:值` 分号分隔 = 数据行；前 8 条同时做芯片文案）/
  `label`（数据卡标题）。
- **原语**：`chipRow`（药丸流式 + 错峰）+ `dataCard`（`countUp` 数位滚动）+
  `vignette` + 径向 `glow`。
- **参数化维度（7）**：芯片内容与条数 / 间距 `gap` / 字号 `fontPx` / 药丸配色
  `background/border` / 圆角 `radius` / 数据数值 / 强调色。
- **素材**：零外部素材（纯代码绘制）。
- **验收帧**：数据卡数值滚动中段（约段内 45 帧）。

## P5 · 代码面板演示

- **用途**：SDK / 接入演示段 —— 窗栏代码面板 + 侧注。
- **槽位**：`copy`（代码文本，`\n` 分行）/ `label`（窗栏标题）。
- **原语**：`codePanel`（`scrollSpeed` 滚动 + 窗栏三点）+ `title` 侧注 + `vignette`。
- **参数化维度（6）**：代码内容 / 字号 `fontPx` / 滚动速度 `scrollSpeed` / 底色
  `background` / 圆角 `radius` / 强调色（窗栏点）。
- **素材**：零外部素材。
- **验收帧**：面板滚动态（段内 60 帧后）。

## 骨架（product-promo-60s · 12 段位）

| 段 | 卡 | 权重 | 说明 |
| --- | --- | --- | --- |
| open | **P1** | 140 | 伙伴墙开场 |
| t1 | A2 | 54 | 呼吸字卡 |
| hero | C2 | 240 | 产品亮相（图 = RQ-24 采集链产） |
| metrics | **P3** | 168 | 数据卡 |
| t2 | A5 | 54 | 转场字卡 |
| sdk | **P5** | 168 | 代码演示 |
| prism | A4 | 168 | 能力拆解 |
| compute | B1 | 168 | 规模数据 |
| catalogue | E1 | 168 | 目录墙 |
| audience | C2 | 168 | 人群场景 |
| t3 | A2 | 54 | 收束 |
| outro | A5 | 240 | 落版 |

> 时轴结构 = playsout 复刻的 12 镜头骨架（open 0 / t1 150 / hero 204 / … / TOTAL 1800），
> 权重按各段帧数归一。P4–P12 待 3 张样卡的**判据实测分布**（真机）后再扩 ——
> 扩卡不改 `recipes.ts`（注册表直接 `registerCard`）。
