# Canvas Studio — Agent 须知

画布插件（Cordis 插件，Host + Client 半）。状态唯一事实来源：`docs/STATUS.md`；文档索引：`docs/README.md`；完整流程：`docs/DEV-WORKFLOW.md`。

## 验证链（铁律，顺序不能变）

```sh
corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke
```

- `test:smoke` 是**门禁包装**（`scripts/run-smoke.mjs`）：失败集合 ⊆ `tests/baseline-red.json` 才算过，名单外新增红即非 0。名单内红修好后**同步移除条目**；要跑原始 `node --test` 用 `test:smoke:raw`。
- `test:smoke` 跑的是 `lib/` 产物，**绝不能当编译闸门**——typecheck/build 必须先过。
- 沙箱内 build 首步 clean.mjs 会撞批量删除阈值，改为逐步骤：`node node_modules/.bin/tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly`。
- **根 `yarn check` 已含本包**（CV-276 起），但本地迭代请在本包目录内跑，更快更准。

## 编码约束（踩过的坑）

| 约束 | 原因 |
| --- | --- |
| 可单测的纯函数放 `src/*.ts`，不放 `src/client/**` | Host tsconfig 排除 client，放进去测不到 |
| client 引用新根级模块须显式追加 `tsconfig.client.json` include | 否则编译过但类型解析不到 |
| 画布几何统一走 `src/canvas-geometry.ts` | 手写路径会让起草线与正式边漂移 |
| React 18.3.1：ref 不能作函数组件 prop | 需要 `forwardRef` |
| 非幂等操作入口加状态守卫 | 别在 UI 层逐处防抖 |
| UI 可见性判定与执行侧前置检查共用同一纯函数 | 可点的必然真能执行 |
| reserved 字段不伪造已生效 | 统一挂「待接入」角标 |
| 画布持久化是事件驱动：每类手势一个落盘点，别加全局定时器 | 机制见 `docs/canvas-studio-task-timeout-spec.md` 与 StudioFrame persistAfter |

## 收尾四步（强制）

1. **STATUS.md**：状态列终态（词汇见 §0.1）+ §8 变更记录追加一行。
2. **canvas-ux-backlog.md**：对应行写清怎么实现 + 文末变更记录。
3. **镜像同步**：涉 REQ/BUG 时同步 `docs/tracking.md`（唯一账本：BUG/REQ 权威号 + 落地映射 + 派单待办）；漂移高发区（tools/api/方案状态行）就地修正。
4. **提交**：`git add` 精确路径（勿 `git add canvas-studio/`），信息带条目号：`feat(canvas-studio): …（CV-xxx）`。

## 编号规则

- CV 主线 = 最大号 + 1（§0「已编到 CV-xxx」为准）；**写号前先 grep 整个 `docs/`**（撞号踩过三次）。
- 历史编号 O/F/R 不复用；每条含 ID/状态/优先级/一句话问题/涉及文件。
- 「已完成」的门槛是**桌面验收**，不是测试通过。

## 基线红现状

**已清零（2026-10-01）**：`tests/baseline-red.json` 的 `failing` 为空数组——任何 smoke 红都是真回归，门禁直接挡。历史基线：studio-defaults 四条（断言已对齐双分辨率 API）+ minimax-skill 一条（渐进披露已支持跨 skill 引用）。
