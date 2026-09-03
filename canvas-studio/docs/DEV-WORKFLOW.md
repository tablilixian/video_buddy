# Canvas Studio 开发流程规范（DEV-WORKFLOW）

> 改动画布代码的完整流程。**最后一步「收尾必更文档」是强制的**——不做就等于这个改动在文档层面不存在。
> 状态总表：[STATUS.md](./STATUS.md) · 文档索引：[README.md](./README.md)

---

## 一、动手前：认领条目

1. 打开 [STATUS.md](./STATUS.md)，找到要做的条目（CV-xxx）。
2. **没有条目就先建**：新编号从 **CV-056** 起，在 STATUS.md §4 加一行 + backlog 加一行。不要口头跟踪。
3. 把状态改成 `进行中`。

---

## 二、编码约束（踩过的坑）

| 约束 | 原因 |
| --- | --- |
| 可单测的纯函数放 `src/*.ts`，**不能放 `src/client/**`** | Host 的 tsconfig 排除了 client 目录，放进去就测不到 |
| client 引用新的根级模块时，`tsconfig.client.json` 的 `include` 必须显式追加 | 否则 client 编译能过但类型解析不到 |
| 画布几何统一走 `src/canvas-geometry.ts`（`edgeAnchor` / `edgePath`） | 别手写 `M...C...`，起草线与正式边会漂移 |
| React 18.3.1：ref 不能作函数组件 prop | 外部要拿根元素用 `forwardRef` |
| 非幂等操作在入口加状态守卫（`if (node.isLoading) return`） | 别在 UI 层逐处防抖 |
| UI 可见性判定与执行侧前置检查共用同一个纯函数（如 `canRetryNode`） | 「可点的必然真能执行」，逐字一致 |
| reserved 字段**不伪造已生效** | 统一挂「待接入」角标 |

---

## 三、验证链（铁律，顺序不能变）

```bash
cd /Users/wl/Desktop/job/learn/video_buddy/canvas-studio

# 1. 类型检查（Host + Client 两侧都要）
corepack yarn typecheck

# 2. 构建（本机直接跑；沙箱内见下方注）
corepack yarn build

# 3. 冒烟
corepack yarn test:smoke

# 4. Loader 校验
corepack yarn verify:loader
```

> ⚠️ **`test:smoke` 跑的是 `lib/*.js` 产物，源码语法写坏了测试照样全绿。** 绝不能拿测试当编译闸门——`typecheck` 和 `build` 必须先过。
>
> 沙箱内 `yarn build` 首步 `clean.mjs` 的 `rmSync('lib')` 会超批量删除阈值中断，改为逐步骤：
> ```bash
> node node_modules/.bin/tsdown
> tsc -p tsconfig.json
> tsc -p tsconfig.client.json --emitDeclarationOnly
> ```

---

## 四、收尾必更文档（强制步骤）

改完代码、验证链全绿之后，**必须**做完下面四件事才能结束。

### 步骤 1：更新 STATUS.md（唯一事实来源）

- [ ] 把条目的**状态列**改成正确的终态（见下方状态规则）
- [ ] 在 **§8 变更记录**追加一行：`日期 | 变更内容 | 测试/验证结果`
- [ ] 若新发现缺陷或优化点 → 分配新 CV 编号，加进 **§4 主线全量表**
- [ ] 若条目被拆除/合并 → 在 §6 历史 ID 映射里留痕，不要直接删行

### 步骤 2：更新 canvas-ux-backlog.md（技术细节）

- [ ] 对应 CV 行的「改进意见」列改成已实现的描述（写清**怎么实现的**）
- [ ] 文末**变更记录**追加一行：日期 / 条目 / 做了什么 / 测试数量 + typecheck + verify 结果

### 步骤 3：排查文档漂移

改了行为就要回头看看有没有文档说过相反的话。已知的漂移高发区：

- [ ] [../plan.md](../plan.md) —— 设置页与 skill 接入记录
- [ ] [canvas-studio-tools.md](./canvas-studio-tools.md) —— 工具参数变了要同步
- [ ] 代码注释里引用了本条目 ID 的地方

发现漂移就**就地修正**并注明修正日期，不要只在 STATUS.md 里写「某某文档已滞后」——那等于没修。

### 步骤 4：提交

- [ ] `git add` 用**精确路径**，不要 `git add canvas-studio/`（会带上其它会话的未跟踪产物）
- [ ] 提交信息写清条目编号：`feat(canvas-studio): 关键帧打回（CV-051）`
- [ ] 提交落在本地 `dev` 分支（沙箱无 GitHub 凭据，推送需用户手动执行）

---

## 五、状态变更规则（避免「改了代码就标完成」）

| 实际情况 | 该标的状态 |
| --- | --- |
| 代码改完、验证链全绿，**还没在桌面验过** | `已修复·待验收` |
| 用户在桌面上回归通过 | `已完成` |
| 方案清楚但没动手 | `待处理` |
| 方向不定，等用户决定 | `待拍板` |
| 缺复现信息 | `待复现` |
| 有设计文档，零代码 | `仅设计` |

**「已完成」的门槛是用户验收，不是测试通过。** 桌面回归重启后确认无误，才从 `已修复·待验收` 转正。

---

## 六、可复制的检查清单

每个改动收尾时对着走一遍：

```
□ STATUS.md 状态列已更新
□ STATUS.md §8 变更记录已追加
□ canvas-ux-backlog.md 对应行 + 变更记录已更新
□ 文档漂移已排查（next-steps / hitl / plan / tools）
□ typecheck (Host + Client) 0 错
□ build 通过
□ test:smoke 通过
□ verify:loader 通过
□ git add 精确路径 + 提交信息带条目号
□ 桌面回归后把「已修复·待验收」转正为「已完成」
```

---

## 七、新条目登记规则

1. **编号**：CV 主线，从 CV-056 起递增，一个条目一个号，不复用。
2. **分类**：在 STATUS.md 里按性质落表 —— 行为错误进 §2 缺陷表，改进/需求进 §4 主线表，两条都沾就进 §4 并在 §2 索引。
3. **优先级**：`P0` 功能断裂 / `P1` 核心工作流缺口 / `P2` 体验优化。
4. **必填字段**：ID、状态、优先级、一句话问题、涉及文件（含行号）。
5. **历史编号**（O / F / R 系列）不再新增，新条目一律用 CV。
