# DSH Desktop 上游 bug 修复回植分析（2026-10-20）

> 目标：从参考项目 `anywhere-labs/dsh-desktop`（本地 `../dsh-desktop`）中挑出可以合并进 VideoBuddy 的 bug 修复，并给出可直接执行的回植清单。
>
> 状态：**分析完成，待评审**。第一批 17 项已用 `git apply --check` 在本仓库 `dbb79b3a00` 上逐条与整批顺序验证通过。

## 0. 审核摘要

| 结论 | 数量 | 说明 |
| --- | ---: | --- |
| A 类：可直接回植 | **17** | 补丁在本仓库干净应用（含整批顺序验证）；建议立即作为低风险热修落地 |
| B 类：需适配后回植 | 13 组 | 依赖 0.1.5+/0.2.x 的重构、缺失文件或补丁版本，建议并入 0.2.1-rc.2 升级 |
| C 类：不建议回植 | — | Next/Beta 专属、上游版本迁移类、Host 子进程架构、纯设计取舍、打包可复现性 |

**最优先两条（安全）**：`d7c38ee0b0`（profile 物化子进程环境注入面）、`57f608163f`（市场受限客户端 IPv6 黑名单绕过）。

**最贴合版本一条**：`12e88bf129`（作者当年就是针对 `dsh 0.1.1-rc.2` 写的两个上游补丁 + 桌面侧拖拽逻辑）。

## 1. 背景与方法

### 1.1 两个仓库的关系

| 项 | 值 |
| --- | --- |
| 本仓库 | `/Users/wl/Desktop/job/learn/video_buddy`，分支 `dev` |
| 分析基线 | `dbb79b3a00`（`feat(canvas-studio): REQ-034 O-06 执行者切换…`） |
| 参考仓库 | `/Users/wl/Desktop/job/learn/dsh-desktop`，分支 `master` |
| 参考 HEAD | `6a63b9730b`（`fix(desktop): support AA Schemastery 3.18.5 builds (#1417)`） |
| 共同祖先 | `83e706ab6882e054607609d3c9f25a0dba6e8924`（`Merge pull request #481 …`） |
| 参考仓库自祖先起 | 786 个提交，其中 **262 个 `fix`（非 merge）** |
| 本仓库自祖先起 | 580 个提交（全部为自有开发，未合并过上游后续修复） |

因此：**凡是在 `83e706ab68..master` 里、且其改动文件在本仓库仍处于该提交父版本状态的修复，就是干净的候选**；反之若本仓库已改动或缺少前置文件，则需适配或不适用。

### 1.2 判定方法

1. 枚举 `83e706ab68..master` 的 262 个 `fix` 提交。
2. 过滤掉仅落在 `dsh-desktop-next/`、`dsh-plugin-desktop-beta/`、`dsh-community-market-next/`、`vendor/` 的提交（这些包我们不存在）。
3. 得到 **177 个**触及本仓库已有文件的候选。
4. 对每个候选：在基于本仓库 HEAD 的临时 worktree 上，用 `git apply --check` 验证补丁是否能干净应用；对每个文件单独验证，区分「OK / FAIL / NEW」。
5. 对筛出的候选做整批**顺序**应用验证（排除 Next/Beta 路径、子模块指针和已知冲突的测试文件），确认无相互冲突。

验证命令见附录 B，逐文件矩阵见附录 A。

## 2. A 类：可直接回植（17 项）

下表的「应用性」列均来自附录 A 的逐文件实测；「整批顺序」指按 §3.1 的顺序应用，已验证全部成功。

| # | commit | 日期 | 主题 | 类型 | 何时回植 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `029d7c7aa8` | 08-28 | Windows 安装器等进程退出的宽限期 6s → 30s | 安装器 | 第一批 |
| 2 | `b29072b0cb` | 08-30 | 保留上游「插件加载失败」报告并追加恢复指引 | 恢复模式 | 第一批 |
| 3 | `e79bcc1c17` | 09-04 | 打包版 pnpm 的 PATH 优先级回收 | 运行时 | 第一批 |
| 4 | `e7a7537f8c` | 09-04 | Windows 更新交接时显示安装器窗口 | 更新 | 第一批 |
| 5 | `1097fcdea3` | 09-05 | Windows 原生对话框底部留白 | UI | 第一批 |
| 6 | `15668197aa` | 09-05 | 启动阶段被托盘隐藏的窗口仍可恢复 | 窗口 | 第一批（去掉子模块指针） |
| 7 | `d100c0ad1d` | 09-08 | 启动器可弹出最初的 Windows 原生对话框 | 启动 | 第一批 |
| 8 | `c41b4f99c2` | 09-08 | 市场源状态提交后再加载 Discover 列表 | 市场 UI | 第一批 |
| 9 | `57f608163f` | 09-19 | 市场受限客户端补全 IPv6 黑名单（NAT64/6to4/Teredo 等） | **安全** | 第一批（最高优先） |
| 10 | `d7c38ee0b0` | 09-20 | profile 物化子进程清理注入型环境变量 | **安全** | 第一批（最高优先） |
| 11 | `11a2577697` | 09-20 | 日志展开 `cause` 链（含 AggregateError/循环引用） | 诊断 | 第一批 |
| 12 | `32036a11bb` | 09-22 | package 目录半写入时不再抛未捕获 `ENOENT` | 稳定性 | 第一批 |
| 13 | `a367c4886e` | 09-20 | Linux 关窗改为最小化，避免无界面僵尸进程 | Linux | 第一批 |
| 14 | `45c9749b05` | 09-25 | macOS 毛玻璃菜单可读性（深色变量） | UI | 第一批（仅源码） |
| 15 | `c8c12adbbe` | 10-14 | 深色主题下原生 `<select>` 弹层白底浅字 | UI | 第一批（仅源码） |
| 16 | `95ec148db3` | 09-20 | 市场缓存写入失败不再冒泡；扫描缓存加界 | 市场稳定性 | 第一批（仅源码） |
| 17 | `12e88bf129` | 08-26 | 侧栏/聊天拖拽面具层冲突；新增两个 `0.1.1-rc.2` 上游补丁 | UI + 补丁 | 第一批 |

### 2.1 逐条详情

**1) `029d7c7aa8` — Windows 安装器宽限期**
- 现状：`dsh-plugin-desktop/build/installer.nsh` 等待 `${if} $R1 < 12`（约 6s）后进入强制关闭路径。
- 修复：改为 `< 60`（约 30s），覆盖慢盘/杀软/大体积物理运行时的有序退出。
- 文件：`build/installer.nsh`、`tests/installer-nsh.spec.ts`（均干净应用）。

**2) `b29072b0cb` — 保留上游插件失败报告**
- 现状：`DESKTOP_BOOT_RECOVERY_SCRIPT` 直接 `container.replaceChildren(panel)`，把上游失败原因整块替换掉。
- 修复：改为在失败报告节点后追加恢复面板，并补中英文说明文案与深色主题变量。
- 文件：`src/desktop-boot-recovery.ts`、`tests/desktop-boot-recovery.spec.ts`。

**3) `e79bcc1c17` — pnpm PATH 优先级**
- 现状：`installPathDirectory` 在目录已在 PATH 首位时仍重写，且把目录拼到继承值前，导致优先级错乱。
- 修复：先剔除已存在的目录项再决定插入；若首段已等于目标目录则直接返回。
- 文件：`src/desktop-runtime-environment.ts`、对应测试。

**4) `e7a7537f8c` — Windows 更新交接窗口**
- 修复：更新下载/安装交接阶段显式 `show()` 安装器窗口，避免静默。
- 文件：`src/electron-runtime.ts`、对应测试。

**5) `1097fcdea3` — Windows 对话框底部留白**
- 文件：`src/desktop-dialog-window.ts`、对应测试。

**6) `15668197aa` — 托盘隐藏窗口**
- 修复：启动阶段记录「因托盘而被隐藏」状态，后续 reveal 时正确恢复。
- 文件：`src/electron-shell-generation.ts`、`tests/electron-runtime.spec.ts`。
- **注意**：该提交同时含 `deepseek-harness` 子模块指针改动，回植时必须剔除（见 §3.2 排除规则）。

**7) `d100c0ad1d` — 启动器初始对话框**
- 修复：`src/bin.ts` 允许启动器展示最初的 Windows 原生对话框（`--allow-initial-dialogs` 类处理）。

**8) `c41b4f99c2` — 市场 Discover 刷新**
- 修复：源设置提交后再触发 Discover 加载，避免读到旧源状态。
- 文件：`dsh-community-market/src/client/MarketSettingsTab.tsx`、测试。

**9) `57f608163f` — 市场 SSRF 防护补全（安全）**
- 现状：`restricted-image.ts` 与 `restricted-http.ts` 各自维护 IPv6 `BlockList`，均漏掉 NAT64（`64:ff9b::/96`、`64:ff9b:1::/48`）、6to4（`2002::/16`）、Teredo（`2001::/32`）、IPv4-compatible（`::/96`）。
- 修复：抽到 `src/network/blocked-subnets.ts` 统一维护，两条受限通道共用；并把 NAT64 内嵌的 IPv4 也纳入拦截。
- 文件：`src/media/restricted-image.ts`、`src/network/restricted-http.ts`（均干净）、新增 `src/network/blocked-subnets.ts`、两个测试。
- 该提交还顺带把目录缓存加上 LRU 上界（`maxEntries`，默认 256）——建议一并接受。

**10) `d7c38ee0b0` — profile 物化子进程环境清理（安全）**
- 现状：`materializeProfile` 用 `{...process.env}` 启动打包 pnpm，凭据型变量（`*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*`）、`DSH_*`、`NODE_OPTIONS`/`NODE_PATH`、`LD_*`/`DYLD_*`、`SSL_CERT_*`、`npm_config_*`、`PNPM_CONFIG_*` 都会进入安装子进程。
- 修复：以 `scrubbedParentEnv()` 为基底，再剥离上述注入键与 `PNPM_CONFIG_` 前缀；Windows 下还处理大小写不敏感的重名键。
- 依赖：`scrubbedParentEnv` 在 0.1.1-rc.2 的 `@deepseek-ai/dsh-subprocess` 中已存在（已验证），并已由 `src/shell-environment.ts:10` 使用，**无新依赖**。
- 文件：`src/profile-materializer.ts`、对应测试。

**11) `11a2577697` — 日志 cause 链**
- 修复：新增 `formatDesktopErrorDetails()`，展开 `cause` 与 `AggregateError.errors` 并处理循环引用；`errorCause()` 改用它。
- 文件：`src/desktop-logger.ts`、对应测试。

**12) `32036a11bb` — package overlay 健壮性**
- 修复：`statSync`/`readFileSync` 命中 `ENOENT` 时按候选缺失处理，落到完整的一侧；两侧都无时报出包名。
- 文件：`src/package-overlay.ts`、对应测试。

**13) `a367c4886e` — Linux 关窗最小化**
- 修复：新增 `hidesWindowOnClose` 平台策略；Windows/macOS 维持 hide，Linux 改为 minimize，避免托盘不可用导致 Host 无界面。
- 文件：`src/electron-platform.ts`、`src/electron-shell-generation.ts` 及两个测试。

**14) `45c9749b05` — macOS 毛玻璃菜单**
- 源码：`src/client/styles.ts` 干净应用。
- 测试：`tests/client-environment.spec.ts` 在本仓库已分叉，**测试断言需手工补**（一行断言）。

**15) `c8c12adbbe` — 深色 select 弹层**
- 源码：`src/client/desktop-settings-styles.ts` 干净应用。
- 测试：`tests/client-desktop-settings.spec.ts` 断言需手工补（16 行）。

**16) `95ec148db3` — 市场缓存持久化失败**
- 源码：`src/catalog/service.ts`、`src/host/routes.ts` 干净应用（缓存写入失败降级为日志；扫描缓存 LRU 上界）。
- 测试：`tests/host-routes.spec.ts` 需手工补；`tests/market-runtime.spec.ts` 可干净应用。

**17) `12e88bf129` — 侧栏与聊天面具层冲突（重点）**
- 桌面侧：`src/client/workspace-folder-drop.ts` 增加「悬停期识别单目录」「声明式抢占文件拖拽」并在 `operations` 中 `stopImmediatePropagation`；新增 `hasSingleDraggedDirectory`、`claimWorkspaceFileDrag`、`invalid` 状态。
- 上游补丁（**正是针对我们当前版本**）：
  - `patches/dsh-client-ui-attachment@0.1.1-rc.2.patch`：把附件 DropOverlay 挂到 `[data-dsh-conversation-drop-target]` 而非 `document.body`，并在 workspace 目标上让位。
  - `patches/dsh-client-ui-conversation@0.1.1-rc.2.patch`：给会话根节点加 `data-dsh-conversation-drop-target` 与 `position: relative`。
  - `package.json` 的 `resolutions` 与 `yarn.lock` 一并干净应用。
- 这是唯一一个作者按 `0.1.1-rc.2` 版本编写补丁的修复，价值最高且与升级计划不冲突（升级到 0.2.1 后需按新版本重做补丁）。

## 3. 第一批执行清单（cherry-pick / 回植）

两个仓库在 `83e706ab68` 之后无共享历史，因此**不能直接 `git cherry-pick`**。可行做法是从参考仓库导出「按路径过滤后的补丁」再 `git apply`，或把参考仓库临时加为 remote 后按路径手选。以下为已验证的执行方式。

### 3.1 已验证的应用顺序

```
029d7c7aa8  b29072b0cb  e79bcc1c17  e7a7537f8c  1097fcdea3  15668197aa
d100c0ad1d  c41b4f99c2  57f608163f  d7c38ee0b0  11a2577697  32036a11bb
a367c4886e  45c9749b05  c8c12adbbe  95ec148db3  12e88bf129
```

说明：
- 顺序主要按「先小后大、先无依赖后有依赖」排布；`12e88bf129` 涉及 `package.json`/`yarn.lock`，放最后。
- 按此顺序整批应用后，实测 `33 files changed, 956 insertions(+), 116 deletions(-)`，无冲突。

### 3.2 路径排除规则

生成补丁时必须排除：

| 排除 | 原因 |
| --- | --- |
| `dsh-desktop-next/**`、`dsh-plugin-desktop-beta/**`、`dsh-community-market-next/**`、`vendor/**` | 本仓库不存在这些包 |
| `deepseek-harness` | 子模块指针改动，由根仓库统一管理，绝不随功能补丁更新 |
| `dsh-plugin-desktop/tests/client-environment.spec.ts` | `45c9749b05` 的测试基线已分叉（源码仍取） |
| `dsh-plugin-desktop/tests/client-desktop-settings.spec.ts` | `c8c12adbbe` 的测试基线已分叉（源码仍取） |
| `dsh-community-market/tests/host-routes.spec.ts` | `95ec148db3` 的测试基线已分叉（源码仍取） |

### 3.3 可执行脚本（逐条 `git apply`）

在**本仓库根目录**执行（`REF` 指向本地参考仓库；同事机器上可先 `git clone` 参考仓库再改路径）：

```bash
set -euo pipefail
REF=/Users/wl/Desktop/job/learn/dsh-desktop
TMP=$(mktemp -d)

EXCLUDE='^dsh-desktop-next/|^dsh-plugin-desktop-beta/|^dsh-community-market-next/|^vendor/|^deepseek-harness$|^dsh-plugin-desktop/tests/client-environment\.spec\.ts$|^dsh-plugin-desktop/tests/client-desktop-settings\.spec\.ts$|^dsh-community-market/tests/host-routes\.spec\.ts$'

gen() { # $1 = commit
  local c=$1 files
  files=$(git -C "$REF" diff-tree --no-commit-id --name-only -r "$c" | grep -vE "$EXCLUDE")
  [ -n "$files" ] || { echo "skip $c (nothing to port)"; return 0; }
  printf '%s\n' "$files" | tr '\n' '\0' \
    | xargs -0 git -C "$REF" diff "$c^" "$c" -- > "$TMP/$c.patch"
  git apply "$TMP/$c.patch"
  echo "applied $c"
}

git switch -c fix/upstream-backport-20261020

for c in \
  029d7c7aa8 b29072b0cb e79bcc1c17 e7a7537f8c 1097fcdea3 15668197aa \
  d100c0ad1d c41b4f99c2 57f608163f d7c38ee0b0 11a2577697 32036a11bb \
  a367c4886e 45c9749b05 c8c12adbbe 95ec148db3 12e88bf129
do
  gen "$c"
done

corepack yarn install --immutable
corepack yarn check
```

若希望保留上游提交来源信息，可先 `git -C "$REF" format-patch -1 --stdout <commit>` 再 `git am`（需自行去掉 Beta/Next 与子模块指针相关文件；本脚本用 `git diff` 导出并做路径过滤，故默认用 `git apply`）。

### 3.4 手工补充项（测试断言）

以下 3 个测试文件因基线分叉未随补丁写入，需从参考提交手工搬运断言：

| 来源提交 | 文件 | 内容 |
| --- | --- | --- |
| `45c9749b05` | `dsh-plugin-desktop/tests/client-environment.spec.ts` | 1 条深色菜单变量断言 |
| `c8c12adbbe` | `dsh-plugin-desktop/tests/client-desktop-settings.spec.ts` | 16 行深色 select 断言 |
| `95ec148db3` | `dsh-community-market/tests/host-routes.spec.ts` | 缓存写入失败不冒泡、logger.error 断言 |

## 4. B 类：需适配后回植（13 组）

这些修复有价值，但受「本仓库缺文件 / 依赖大重构 / 补丁版本不符」阻碍，建议并入 0.2.1-rc.2 升级一起做。

| commit | 内容 | 阻塞点 / 适配方式 |
| --- | --- | --- |
| `4c301f12bd` | `agent/error` 完整 cause 链落盘 + 诊断导出 | 无 `host-bootstrap.ts`（我们是同进程 Host）；`diagnostic-export*.ts` 可直接应用，把新模块 `agent-error-logging.ts` 挂到 `src/index.ts` 的 Host ctx 即可；`agent/error` 事件在 0.1.1 已存在 |
| `286b65d821` | 记录意外 Host 退出（`host.exited`）并给恢复入口 | `desktop-logger.ts`/`lifecycle-events.ts` 可直用；`host-process.ts` 不存在，`electron-runtime.ts`/`main.ts` 需改写 |
| `091f1d5b6c` | fail-loud 接管 `uncaughtException` 时撤下 Desktop 处理器 | `desktop-logger.ts` 部分可直用；`main.ts` 需适配 |
| `4a427fdb14` | Host 退出后设置页按钮永久 busy，改走 preload 直连主进程 | `preload.ts`/`desktop-settings-api.ts` 可直用；需新增 `renderer-actions-*`，改 `electron-runtime.ts` |
| `86914c715a` | macOS 目录选择改用 Electron 原生选择器 | 契约/部分运行时可用；`electron-platform.ts`/`preload.ts` 需适配 |
| `30130ee8be` + `9ca92ee098` | 更新下载重定向溯源 + 安装包 SHA-256 硬校验 | 需按最终态移植：保留「HTTPS + 可选摘要」，不要 host 白名单（后者已被 `9ca92ee098` 移除）；`update-*` 需手工改 |
| `62171c6010` + `afec8f6d89` + `5af1f8c166` | 渲染进程崩溃自动恢复 / 强杀后重载 / 空白无响应 watchdog | 需新增 `renderer-recovery.ts`、`renderer-surface-watchdog.ts` 并改 `electron-shell-generation.ts` |
| `a1caef3368` | Windows ACL 受限 shell 在无 console 下 `0xC0000142` | 需新增 `windows-console-host.ts` 并改 `windows-acl-runner.ts` |
| `d590d3c9da` | Windows 运行期 shim 跨代码页解码 | 依赖 `6ca84561c4` 对 `desktop-runtime-environment.ts` 的大重构（424 行） |
| `011403db85` | 后台 Node 启动不再被当作 GUI 重入 | 依赖链 `e79bcc1c17` → `6ca84561c4`（`011403db85` 的 `desktop-runtime-environment.ts` hunk 仅在 `6ca84561c4` 之后可应用）；`desktop-installer-quit.ts` 与 `main.ts` 部分可直接用 |
| `8b647466cd` / `b30eea0d3c` / `da745d924a` | Linux/Windows 工具子进程保持 Node 模式 | 后半是 `patches/dsh-subprocess-local@0.1.5+`，需回植到我们的 `@0.1.1-rc.2` 补丁 |
| `6219fd9919` | 非系统盘工作区触发 Win32 error 5 | 是 `patches/dsh-sandbox-windows-acl@0.1.7-rc.1`，需回植到 `@0.1.1-rc.2` 补丁 |
| `cb736b6edf` / `5510cb1203` / `b4c5b4e6a9` | 侧栏锚定 / footer 堆叠 / 通知偏好免重启 | 部分文件可直用，`client/index.ts` 等已分叉，需逐个适配 |

## 5. C 类：不建议回植

| 类别 | 代表提交 | 原因 |
| --- | --- | --- |
| Next/Beta 专属 | `4096f20bf9`、`2670051b56`、`75ad518423`、`6bfdcd653d` | 只落在 `dsh-desktop-next/`、`dsh-plugin-desktop-beta/` |
| 上游版本迁移类 | `feat/fix(... dsh v0.1.x/0.2.x)`、`patches/*@0.1.5+`/`@0.2.x`、`settings.yaml.imported`、`code→ptc` 预设迁移 | 属于 0.2.1 升级方案范畴（见 `dsh-upgrade-0.2.1-rc.2-20261020.md`），单独摘无意义 |
| Host 子进程架构 | `4e2c908c18`（Host stderr 快速失败）、`6219a1b5de` 等 | 本仓库 Host 为同进程，无 `host-process.ts` |
| 纯设计取舍 | `5e3b6ed967` 移除 Windows Acrylic、`40fc545d6c` 移除 Mica、`f6de1f6fcd` Linux 材质 | 本仓库默认 `windowsMaterial: 'acrylic'`，属产品决策而非 bug 修复 |
| 打包/CI 可复现性 | `1af4a0c976`、`83cc4f821c` | 本仓库图标管线已自定义（`rewrite-app-icon.mjs`），且测试未做跨平台哈希断言 |

## 6. 验证计划

| 阶段 | 命令 | 通过标准 |
| --- | --- | --- |
| 补丁应用 | §3.3 脚本 | 17 条全部 `applied`，无冲突 |
| 依赖 | `corepack yarn install --immutable` | 锁文件一致（`12e88bf129` 含 `yarn.lock`） |
| 布局 gate | `node scripts/verify-layout.mjs` | 通过（注意本机全局 `insteadOf` 会把 origin 显示为 SSH，见风险 R1） |
| 文档 gate | `node scripts/verify-bilingual-docs.mjs` | 通过 |
| 类型/单测 | `corepack yarn typecheck && corepack yarn test` | 通过 |
| 完整门禁 | `corepack yarn check` | 通过 |
| 手工回归 | 见 §6.1 | 全部通过 |

### 6.1 手工回归用例

1. Windows：安装器覆盖升级，确认旧进程 ≤30s 有序退出且不丢设置。
2. 插件加载失败：恢复模式页面上游失败报告仍在，且新增指引文案可见；深/浅色均可读。
3. 深色主题：设置页原生 `<select>`（语音输入、Cordis）弹层为不透明深色，深字可见。
4. macOS：毛玻璃菜单在浅色背景下文字可读。
5. 侧栏工作区：拖入文件夹时侧栏反馈正常，聊天附件全屏遮罩不再抢占；拖入非目录时显示 invalid。
6. 市场：签名源受限（NAT64）地址被拦截；缓存写入失败（模拟只读）不导致 Host 崩溃；切换源后 Discover 刷新。
7. Linux：关闭窗口 → 最小化，托盘不可用仍可从窗口列表/Alt-Tab 恢复。
8. 托盘：启动阶段被隐藏后，点击托盘能恢复窗口。

## 7. 风险登记

| 编号 | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 本机全局 git `url.git@github.com:.insteadOf https://github.com/` 使 `verify-layout.mjs` 报 `origin differs from upstream.json` | 低 | 与本次回植无关；可用 `GIT_CONFIG_GLOBAL=/dev/null node scripts/verify-layout.mjs` 复核 |
| R2 | 基线与参考仓库会继续前移 | 中 | 回植前重跑 §1.2 的逐文件应用性检查；基线记录为 `dbb79b3a00` |
| R3 | `12e88bf129` 的上游补丁与后续升级冲突 | 中 | 先回植为 0.1.1-rc.2 补丁；升级到 0.2.1 时按新版本重做（已在升级方案 §5 登记 patch 待办） |
| R4 | 三个分叉测试未随补丁写入 | 低 | 按 §3.4 手工搬运断言 |
| R5 | 安全补丁被误以为可延迟 | 低 | `d7c38ee0b0`、`57f608163f` 设为第一批最高优先 |

## 8. 排期建议

| 批次 | 内容 | 工作量 | 时机 |
| --- | --- | --- | --- |
| 第一批 | A 类 17 项 + 手工测试断言 | 2–3 人日 | **立即**（独立于升级，低风险） |
| 第二批 | B 类中与升级重叠的：`4c301f12bd`、`4a427fdb14`、渲染恢复三件套 | 3–5 人日 | 与 0.2.1-rc.2 升级同批 |
| 第三批 | 其余 B 类（更新校验、Windows ACL、目录选择等） | 3–5 人日 | 升级后，参照参考仓库 stable 2.0.18 最终实现 |

与升级方案的关系：第一批全部基于 `0.1.1-rc.2`，**不阻塞也不依赖**升级；第二批/第三批的代码位置与升级改动重叠，应并入以免重复劳动。

## 9. 附录

### A. 第一批逐文件应用性矩阵（基线 `dbb79b3a00`）

| commit | 文件 | 结果 |
| --- | --- | --- |
| `029d7c7aa8` | `build/installer.nsh`、`tests/installer-nsh.spec.ts` | OK / OK |
| `b29072b0cb` | `src/desktop-boot-recovery.ts`、测试 | OK / OK |
| `e79bcc1c17` | `src/desktop-runtime-environment.ts`、测试 | OK / OK |
| `e7a7537f8c` | `src/electron-runtime.ts`、测试 | OK / OK |
| `1097fcdea3` | `src/desktop-dialog-window.ts`、测试 | OK / OK |
| `15668197aa` | `src/electron-shell-generation.ts`、`tests/electron-runtime.spec.ts`（子模块指针已剔除） | OK / OK |
| `d100c0ad1d` | `src/bin.ts` | OK |
| `c41b4f99c2` | `src/client/MarketSettingsTab.tsx`、测试 | OK / OK |
| `57f608163f` | `src/media/restricted-image.ts`、`src/network/restricted-http.ts`、`src/network/blocked-subnets.ts`(新)、两个测试 | OK / OK / NEW / OK |
| `d7c38ee0b0` | `src/profile-materializer.ts`、测试 | OK / OK |
| `11a2577697` | `src/desktop-logger.ts`、测试 | OK / OK |
| `32036a11bb` | `src/package-overlay.ts`、测试 | OK / OK |
| `a367c4886e` | `src/electron-platform.ts`、`src/electron-shell-generation.ts`、两个测试 | OK / OK / OK / OK |
| `45c9749b05` | `src/client/styles.ts` / `tests/client-environment.spec.ts` | OK / **FAIL（手工）** |
| `c8c12adbbe` | `src/client/desktop-settings-styles.ts` / `tests/client-desktop-settings.spec.ts` | OK / **FAIL（手工）** |
| `95ec148db3` | `src/catalog/service.ts`、`src/host/routes.ts` / `tests/market-runtime.spec.ts` / `tests/host-routes.spec.ts` | OK / OK / OK / **FAIL（手工）** |
| `12e88bf129` | `src/client/workspace-folder-drop.ts`、`tests/client-workspace-folder-drop.spec.ts`、`tests/package.spec.ts`、`package.json`、`yarn.lock`、两个新补丁 | 全部 OK / NEW |

### B. 验证命令（分析时实际使用）

```bash
# 共同祖先与差异规模
git -C dsh-desktop merge-base <ours-dev> master
git -C dsh-desktop rev-list --count 83e706ab68..master          # 786
git -C dsh-desktop log --no-merges --grep=fix -i --oneline 83e706ab68..master | wc -l   # 262

# 逐文件 / 整批应用性（在基于本仓库 HEAD 的临时 worktree 上）
git worktree add --detach /tmp/vb-check HEAD
git -C dsh-desktop diff <commit>^ <commit> -- <file> | git -C /tmp/vb-check apply --check

# 顺序整批验证（排除 §3.2 路径）
for c in 029d7c7aa8 b29072b0cb ... 12e88bf129; do
  files=$(git -C dsh-desktop diff-tree --no-commit-id --name-only -r "$c" | grep -vE "$EXCLUDE")
  printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 git -C dsh-desktop diff "$c^" "$c" -- \
    | git -C /tmp/vb-check apply
done
```

### C. 证据索引

| 结论 | 来源 |
| --- | --- |
| 共同祖先 `83e706ab68`、786 / 262 计数 | `git merge-base` / `git rev-list` |
| 17 项干净应用 | 临时 worktree `git apply --check` 逐文件与整批顺序验证 |
| `scrubbedParentEnv` 在 0.1.1 已存在 | 上游子模块 `b150a551b8…:packages/bundle/web-app/src/index.ts`、`src/shell-environment.ts:10` |
| 本仓库默认 `windowsMaterial: 'acrylic'` | `dsh-plugin-desktop/src/window-material.ts:11` |
| 参考仓库对应修复 | `dsh-desktop:master`，稳定版 2.0.18 已包含全部 A 类与 B 类 |

## 10. 审核记录

| 角色 | 姓名 | 结论 | 日期 | 备注 |
| --- | --- | --- | --- | --- |
| 产品/项目负责人 | 待填 | 待审核 | — | — |
| 技术负责人 | 待填 | 待审核 | — | — |
| 发布负责人 | 待填 | 待审核 | — | — |
