# 事实快照（跟片走，2026-11-05）

> 适用：知识型 / 数据型科普片（入口分流第 6 条）。
> 立项目的：一次 45s 科普片的故事板阶段，agent 用 15 个模型步、约 9.7 min
> 反复 `curl` NASA / timeanddate / Wikipedia / weather.gov，并为「用户写 23.5°
> 还是 NASA 写 23.4°」推理 4 次。**数值与口径是确定性计算，不该由模型用 token 去争。**
> 与 `assets/manifest-builder.mjs` 同一思路：模型只交内容表，计算交给脚本。

## 1. 落点：跟片走，不进仓库

```
<projectDir>/build/fact-snapshot.json
```

`<projectDir>` 是运行时项目目录（会话 cwd），与 `canvas.json` / `storyboard.json` 同级；
`build/` 沿用 `manifest-builder.mjs` 的既有惯例。**不要**把具体片子的数值常量放进 skill 仓库
（跨项目复用会污染版本库，且无法跟片走）。本 skill 只提供**生成脚本与规则**，不提供数值。

## 2. 生成：一次 bash，零新工具

```bash
node <skill>/assets/facts-builder.mjs build/fact-spec.json
# 默认写 build/fact-snapshot.json，stdout 直接给摘要 + 可粘贴的 facts JSON
```

`fact-spec.json` 由模型按用户原话与通用常识**一次**填好（内容表），形状见脚本头注释。
脚本负责：字段校验、裁决冲突、按裁决序生成 `constants` / `claims` / `conflicts`、
给每条来源算 `sha256`、输出 `write_storyboard` 可直接用的 `facts` 片段。

**只读一次结果**：构建完把 stdout 里的 `facts` 片段写进 `write_storyboard` 的 `facts` 节，
不要再把整个快照文件 `read` 一遍，更不要为一两个数值再开 curl。

## 3. 裁决序

```
用户原话 explicit > 项目预置 > 快照 verified > 联网值
```

- 用户给的数值**直接用**；来源里的不同值记脚注（写进 `facts[].claim`，注明「未采用」），不推理权衡。
- 落选值不删、不复核；`status` 用 `verified`（快照）/ `pending`（确实查不到）。
- `pending` 会由 CV-440 的 pending 事实桥在出片回执里点名，**不会变成图表数字**。

## 4. 联网降级（可选，单次）

- 只在「用户没给数值、快照里也没有」时才联网，且**整阶段最多一次**、总时限 20s。
- 失败 / 超时不改任何数值，只把该条标 `pending` 并在交付时说明。
- **状态变更必须落盘**（CV-447 P1-D）：说「已核实」不算数——改完 `status` 要写回故事板，
  并重跑 `assets/facts-builder.mjs` 生成 `build/fact-snapshot.json`。交付 lint 优先读快照，
  只在口头"已 verified"却没落盘时照旧点名 pending。
- **禁止**为了「多一个佐证」抓第二个站点，禁止把网页正文整篇读进上下文。

## 5. 与故事板契约的衔接

`write_storyboard` 的 `facts` 节契约（`host-tools.ts` 字段口径）：

```json
{"facts":[{"claim":"…","source":"https://…","status":"verified|pending"}]}
```

- 单一基准（如 GISTEMP 1951–1980）必须**一条事实只写一次**，图表 `dataSource` / `baseline` 引用它；
  混口径序列按 `references/verification.md` 的 L3 判据重做。
- 快照文件带 `sha256` + `retrievedAt`，陈旧可复查；**不回填历史项目**，只对新建项目生效。
- `references/manifest-contract.md` 的 `dataSource`（B-4）与这里的 `facts[]` 是同一条流水线的上下游：
  故事板定口径 → manifest 声明出处 → 渲染回执点名 pending。
