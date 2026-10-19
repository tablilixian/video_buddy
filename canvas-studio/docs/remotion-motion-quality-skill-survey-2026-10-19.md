# Remotion 动效质量：外部 skill 调研与三层解法

> 日期：2026-10-19 · 状态：调研 + 提案（未立项、未改码）
> 触发问题：模型用现有 skill 产出的 Remotion 动画「逻辑不严谨 / 不好看」，需要判断是不是 skill 不够专业。
> 结论先行：**两部分都缺，但主因不在 skill 文案，而在引擎表现力；外部确有比官方 remotion-dev/skills 更对口的质量向 skill，可吸收「编排 + 数值 + 质检」，不可整装。**

---

## 1. 诊断：两类症状，两个根因

| 症状 | 根因层 | 一句话 |
|---|---|---|
| 逻辑不严谨（元素乱入、节奏散、主次不分） | 编排层 | 没有 motion brief（谁先动、谁主谁次、几个 beat、多少帧预算），动画是逐条拼的 |
| 不好看（机械、平、像 PPT） | 引擎层 | 缓动只有 4 档二次曲线、无 spring、无退场、无调色/颗粒，skill 想好看也没有工具 |

### 1.1 代码级证据（canvas-studio）

| # | 现象 | 证据 |
|---|---|---|
| E1 | 缓动只有 4 个，且**全是二次多项式**；`easeOut` 是 quad 不是 cubic | `src/remotion/timing.ts:355-360` |
| E2 | 没有 spring / 没有自定义 bezier | 全仓 `src/remotion/` grep `spring` 零命中 |
| E3 | 没有「退场」概念 | `skills/` 内 grep `退场` 仅命中无关的 `music-prompt-writing` |
| E4 | 没有错峰原语，只能手算 `startFrame` | `skills/` 内 grep `stagger\|错峰` 零命中 |
| E5 | 没有编排层（scene / beat / 主次） | `tracks` 平铺，仅 `startFrame + durationInFrames` |
| E6 | 渲后不做视觉自查 | 已知口径：自动化不覆盖视觉（CV-253 三轮全绿而 UI 仍压字） |

**关键推论**：`easeOut = 1-(1-t)²` 的收尾比 `easeOutExpo` 慢近一倍，观感就是「软塌、拖尾」。模型现在写出的入场（`x:115→50`、18 帧、`easeOut`）已经是这套枚举能给的最好结果 —— **天花板在引擎，不在提示词**。继续改 skill 文案而不动 `timing.ts`，投入产出接近零。

---

## 2. 外部候选（实测，非二手转述）

| 源 | 内容 | 许可 | 适配度 | 可吸收 |
|---|---|---|---|---|
| `remotion-dev/skills`（官方） | 13 skill / 173 md / 686KB；面向「agent 写 JSX + 跑 npx」 | **仓库无 LICENSE**，父仓 Remotion License 禁再分发衍生 | 低 | markup 分册的时序/转场/音频概念 |
| `haidrrrry/claude-remotion-skill` | 1 个 skill：`SKILL.md`（10 条硬规则）+ `motion-patterns.md`（17 个组件）+ `design-rules.md` + `assets/theme.ts`，4 个成片 example | **MIT** | **最高** | 10 条规则、theme token、渲后抽帧闭环 |
| `iart-ai/motion-design-skills` | 9 个 skill：animation-principles / color-motion / shot-composition / motion-art-direction / beat-sync-editing / remotion-video / logo-animation / motion-background | **MIT** | 高（方法论层，与引擎无关） | 12 原则、OKLCH 插值、构图与安全区、运动语言 |
| LottieFiles `motion-design` | `director/`(6) + `patterns/`(4) + `reference/`(5)，含 `timing-easing-tables.md`、`quality-checklist.md`、`common-mistakes.md` | 见原仓 | 高 | 时长/缓动对照表、质量清单、运动人格 |
| `kylezantos/design-motion-principles` | 审计型：`audit-checklist` / `common-mistakes` / `performance` / 三位设计师视角 | **MIT** | 中高 | 审计清单（可直接当验收门） |
| `MengTo/Skills` → `animation-systems` | Web 动效（Stripe/Linear/Apple 风格），给硬数值：300–700ms、stagger 40–90ms、进场 ease-out / 退场 ease-in | 见原仓 | 中 | 数值体系（毫秒 → 帧） |
| `dylantarre/animation-principles` | 144 个 skill（12 原则 × 12 维度） | MIT | 低 | 只取 squash/stretch、anticipation 概念 |
| `45ck/content-machine` 的 deep dive | **不是 skill，是根因分析报告**：generic prompt 导致装饰性运动、布局抖动、慢特效、转场不同步；给出 motion brief 字段与 quality gates | 见原仓 | — | **「逻辑不严谨」的直接解药** |

### 2.1 最值得抄的一条：motion brief 先于代码

`45ck` 那份报告的字段直接可用（改写成 manifest 语境）：

```
surface / duration_frames / fps / visual_goal
beat_frames[]            # 哪几帧是节拍点
moving_elements[]        # 谁动，主/次
entry_motion / hold_motion / exit_motion
caption_safe_zone        # 字幕安全区
blocked_effects[]        # 本次禁用（如 blur-heavy）
review_frames[]          # 交付前必看的帧号
```

我们现在是「直接写 tracks」，跳过 brief ⇒ 每个元素各自入场、没有 beat、没有主次，观感自然散。**这一条不需要改引擎，纯 skill 层就能落地。**

### 2.2 最值得抄的一套数值

来自 `haidrrrry` 的 10 条规则（MIT），逐条对照我们的现状：

| 规则 | 我们现状 | 落地成本 |
|---|---|---|
| 禁线性插值，用 spring / bezier + clamp | 有 clamp 语义，但无 bezier/spring | 引擎（中） |
| 入场同时动 2–3 个属性 | skill 已教「x + opacity」，但无人强制 | skill（低） |
| 一切错峰 stagger（3–6 帧） | 零支持 | skill 先手算；引擎再评估原语 |
| 退场存在，且比进场快 | 零支持 | **引擎（低，收益高）** |
| 五层栈：bg mesh → assets → graphics → grade → grain+vignette | 只有 tracks 平铺，无 grade/grain | 引擎（中） |
| 静图必 Ken Burns，视频用 OffthreadVideo | 有 `kenBurns`，但非默认 | skill（低） |
| 闲置元素呼吸（sin 微动） | 有「呼吸」范式，非默认 | skill（低） |
| 所有时长从 fps 派生 | manifest 是帧制，无 fps 换算 | 不适用（更优） |
| 单一 theme，禁内联色/缓动 | manifest 有 `global`，但 fx/色散落 | skill（低） |
| 渲后抽帧检查再交付 | 无 | **引擎（中，收益最高）** |

---

## 3. 三层解法（不要只做第一层）

### L1 知识层 —— 改 skill，1–2 天，纯文本，零风险

1. 新增 `code-driven-explainer/references/motion-brief.md`：定义 brief 五要素（beat / 主次 / 帧预算 / 进出场 / 禁用项），要求组装前先写。
2. 新增 `references/motion-quality-gates.md`：把「入场是否 ≥2 属性」「是否有退场」「相邻元素是否错峰 ≥3 帧」「单镜运动是否超过 2 个焦点」做成自查表。
3. 扩 `motion-patterns.md`：补 3 个范式 —— 主次编排（hero → supporting）、退场与交接、静图 Ken Burns + 呼吸的组合。
4. `SKILL.md` 加 2–3 条指针（现 9,068B，余量充足）。

> 收益：解决「逻辑不严谨」的 70%。不解决「不好看」。

### L2 引擎层 —— 改 manifest + timing.ts，这才是审美地基

| 优先级 | 改动 | 形态 | 兼容性 |
|---|---|---|---|
| **P0** | 缓动扩档 | `easeOutCubic` / `easeOutQuart` / `easeOutExpo` / `easeInOutCubic` / `easeInOutExpo`，纯函数、端点收敛 | 只增不改，缺省仍 `easeInOut` ⇒ 老 manifest 逐像素不变 |
| **P0** | 退场 | `tracks[].exit = { durationInFrames, easing?, to: { opacity?, x?, y?, scale? } }`，尾段叠加 | 新增可选字段 |
| P1 | 全局 look | `meta.look = { grade, grain, vignette }`，噪点必须**固定 seed**（确定性红线） | 新增可选字段 |
| P1 | 错峰原语 | `tracks[].group = { key, index }` + `group.staggerFrames` | 若 skill 手算够用则不做 |
| P2 | spring | `animate.mode = "spring"` + `{ damping, stiffness, mass }`，纯函数 | 新增枚举值 |

⚠️ 触碰 `timing.ts` 属 T3 级（确定性渲染不变量），必须走反向变异验证：改坏 → 断言变红 → 还原；并验老 manifest 逐像素不变。

### L3 验证层 —— 让 agent 看得见自己的产物

`render_composition` 在出片后按 `reviewFrames`（默认 0 / 25% / 50% / 75% / 末帧）抽 5 张 PNG 回给 agent，模型据此自查「有没有压字、元素是否偏、转场是否跳」。这是唯一能闭环 E6 的手段，也是 `haidrrrry` 那条「never ship unverified」的可执行版。

---

## 4. 不推荐

| 方案 | 原因 |
|---|---|
| 整装 `remotion-dev/skills` | 无 LICENSE 文件 + 父仓许可禁再分发；入口 17.4KB/17.8KB 已超我们 12KB 闸；`create/studio/render/upgrade` 全是 npx CLI 流，会诱导模型绕过 `render_composition` |
| 把 `haidrrrry` 或 `iart-ai` 直接装进产品 | 它们教的是「写 JSX + 跑 CLI」，与 manifest DSL 冲突；但**改写成我们的字段语义后价值很高** |
| `dylantarre/animation-principles`（144 个） | 体量与噪声远超收益 |
| 只改 skill 不改引擎 | 天花板不变，属于「反复改文案、画面依旧」的典型死循环 |

---

## 5. 建议的推进顺序

1. **本周**：L1 三篇分册（纯文本，可立即验收，解决编排散）。
2. **同批**：P0 缓动扩档 + 退场（两个字段，收益最大，风险可控，只增不改）。
3. **下一批**：L3 抽帧自查（依赖渲染工单，中等成本，但能让后续所有调优变成闭环）。
4. **观察后**：`meta.look` 调色/颗粒、spring、stagger 原语。

## 6. 参考链接

- https://github.com/haidrrrry/claude-remotion-skill （MIT，10 条规则 + theme.ts）
- https://github.com/iart-ai/motion-design-skills （MIT，9 个方法论 skill）
- https://github.com/kylezantos/design-motion-principles （MIT，动效审计）
- https://github.com/remotion-dev/skills （官方，仅可读不可复用）
- https://github.com/45ck/content-machine/blob/master/skills/short-form-archetype-research/references/agent-motion-design-skill-systems-deep-dive.md
