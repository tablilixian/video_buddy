# 交接文档：DramaServer 自有大模型接入（settings 写入被死 entry 卡死）

> 日期：2026-10-22　分支：`dev`　状态：**根因已定位并修复，仅剩桌面 GUI 人工验收**（2026-10-23 复核：LLM 一条线代码缺口 0；**积分/余额不在此线**，P2 的 `refreshBalance` 与 P3 全量未开工，见方案 §0.5 / §P3）
> 本文自包含：新会话无需历史上下文。相关方案：[DramaServer-管理面接口接入方案.md](./DramaServer-管理面接口接入方案.md)（含 §0.4 重评估表）

## 0. 一句话结论

0.2.1 的 `settings.mutate` 每次都从**文件**重建 Loader 图；桌面层原先只存在于
启动器内存里，所以任何一次配置写入都会**删掉桌面行并复活两个死 entry**，写不进
去、窗口还会消失。修复 = 把桌面层落成 profile 内真正的 bundle 层
（`node_modules/dsh-desktop-layer`），让 boot 与 recompose 读同一份源。

## 1. 目标与已达成

**目标**：登录用户在 VideoBuddy 桌面里能用上 DramaServer 自有 LLM（聊天模型选择器 + 设置页「DramaServer 官方模型」区块）。

| 提交 | 内容 |
| --- | --- |
| `441050aa34` | CV-354 模型设置页 0.2.1 断线修复（`connection.api` → `remote.llm/settings/credentials` 三域）+ 官方区块 + provider 折叠行重设计 |
| `7101379fbd` | CV-355/356/357 方案 P1+P2+P4：`src/drama-management.ts`、`src/device-registry.ts`、`businessApiBase`、`src/account-state.ts`、`src/gateway.ts`、`src/index.ts` 装配 + 4 个测试 + `scripts/live-e2e-management.mjs` |
| `211344de3e` | 修复①：DeviceRegistry 方法裸引用丢 `this` → 包箭头函数 + 回归守卫 |
| `48a514f896` | 修复②：落行改走 `settings.mutate` + 目录回调失败清 `catalogFetchedAt` |
| `f40b05b9f2` | 在 `cordis.patch.yml` 禁用 hmr / desktop-product-telemetry（**方向对、层不对，见 §2**） |
| `05ea9dc2b6` | 修复③：启动期缓存恢复延后 5s + 兜 catch（防 unhandled rejection → fatal load failure） |
| `3a8323d075` | **修复④（根因）**：启动器层物化为 profile bundle；`planGeneration` 双视图；`assertDesktopLayerApplied` 守卫；`verify-profile-boot` 增加 recompose 回归 |

**运行时已实证打通**（日志/文件为证）：会话推送 → bootstrap → `auth/sync` →
`device.json` → `/v1/models?modality=text` → `gateway-catalog.json`（1 个模型
`deepseek-flash`）→ 凭据 `CANVAS_STUDIO_GATEWAY_TOKEN` 已发布；编排幂等/错误
策略按设计工作（401 静默 / 429 退避 / 失败不阻塞登录）。

## 2. 根因（已确认，取代原「死 entry 卡死」的表述）

```
settings.mutate → SettingsForms.write → ConfigEditor.edit
  → readProfilePatches(profileContext)   ← 只读 4 个来源：
      bundle 层 + profile cordis.patch.yml + home cordis.patch.yml + overlays
  → reconcileProfilePatches → recompose → Include.update(patches)
  → 组合图 = applyEntryPatches(文件内容, 新 patches)   ← 未列出的行被移除
  → 激活判定：新出现的失败 → 抛 `dsh: warning: N entries did not activate` → 回滚
```

启动器（`prepareDesktopProfile`）当年把桌面层直接塞进 `boot()` 的 patches 参数，
`profileContext.overlays` 始终是 `[]`。于是 `readProfilePatches` **看不到**桌面层：

1. `desktop-shell` / `canvas-studio` / `desktop-webserver` 等行从图里消失 ⇒
   窗口消失（用户观感「闪退」，主进程活着、无崩溃转储）；
2. `hmr`、`desktop-product-telemetry` 从 bundle 层复活 ⇒ 激活失败（`--expose-internals`
   缺失 / `DSH_CLIENT_VERSION` 未设）⇒ 写入回滚；
3. 网关行永远写不进 profile patch ⇒ 管理面接入卡死。

**原 §3.1 的「谜团」由此解释**：`~/.videobuddy/profiles/desktop/cordis.yml` 是
Include 按**本次 recompose 的 patches** 写回的产物，桌面行来自内存层、不在
patches 里，所以文件里没有 `canvas-studio`/`desktop-shell` 却仍在运行——运行的是
**boot 那一刻**的那张图，文件是后来被重写坏的。

## 3. 修复内容（`3a8323d075`）

| 机制 | 说明 |
| --- | --- |
| 物化层 | `<profile>/node_modules/dsh-desktop-layer/{package.json,cordis.patch.yml}`，`package.json` 声明 `dsh.bundle.patch`；patch 文件 = 仓库 `cordis.patch.yml` 原文（保住 `!!js` 表达式）+ 启动器计算行（平台替换 / Web 端口 / 桌面设置）YAML 追加。**每次 boot 全量重写**，无残留 |
| 层序 | `dsh.profile.bundles` 永远把该层排在**最后**（`desktopBundleList`），才能禁用 base/web-app/第三方插入的行；同时它在**用户层之下**，所以 settings 写入永远有效、不会被「overlay 覆盖」检查拒绝 |
| 双视图 | `planGeneration(launcher｜persisted)`：`launcher` 忽略上一轮生成的层、组合仓库原文件，用来**推导**计算行；`persisted` 就是 Loader 真正要读的东西。混用会让「替换行已存在」把 insert 退化成 config patch，层自我销毁 |
| 守卫 | `assertDesktopLayerApplied`：boot 期比对「启动器意图」与「磁盘组合」的 id / name / 启用态，漂移即抛并提示删除该层目录重启 |
| 不可变 | `DESKTOP_LAYER_BUNDLE_NAME` 进 `IMMUTABLE_BUNDLES`：插件页不得禁用/卸载 |
| 自愈 | 层目录缺失（首次启动、pnpm 清过 node_modules）时 `loadRecoveryFilteredProfile` 跳过而非抛错，当轮用内存层引导 |

注意：`f40b05b9f2` 在 `cordis.patch.yml` 里写的两行 `disabled: true` 现在**真正生效**
（它成了 bundle 层内容）；`profile.ts` 里那两处动态 disable 仍然保留，作为纵深防御。

## 4. 验收清单（人工，GUI）

前置：本次改动只影响 `dsh-plugin-desktop`，`canvas-studio` 未改；lib 已重建
（`node node_modules/.bin/tsdown`）。**必须在用户自己的终端启动**（受管 shell 里
Electron 起不来：`EPERM unlink .../crash-evidence/.active-run.json.*`）。

1. 启动：`cd dsh-plugin-desktop && env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 node lib/bin.js`
2. 看日志 `~/Library/Application Support/VideoBuddy/logs/dsh-*.log`
   - 不应再出现 `did not activate`
   - 启动约 5s 后应出现「网关行已从目录缓存恢复：N 个模型」（或登录推送后「管理面 bootstrap 完成：…text 模型 N 个」）
3. 设置 → 模型：「DramaServer 官方模型」区块点亮（模型列表 + 设为默认，只读）
4. **关键回归**：在该页随便保存一项（或在聊天里切一次模型）——窗口必须不消失；
   `~/.videobuddy/profiles/desktop/cordis.patch.yml` 应出现 `llm-pi-ai` 的
   `providers` 配置，且 `cordis.yml` 仍含 `desktop-shell` / `canvas-studio`
5. 聊天模型选择器出现 DramaServer 组（默认模型建议切过去；当前 profile 出厂默认
   `deepseek-official/deepseek-flash` 是不存在的组合）
6. L6：`DRAMA_ACCESS_TOKEN=<桌面登录的 access token> node canvas-studio/scripts/live-e2e-management.mjs`
7. 服务端确认设备记录 `name=VideoBuddy Desktop`

## 5. 关键路径速查

| 什么 | 在哪 |
| --- | --- |
| DSH home（桌面） | `~/.videobuddy`（`main.ts` `resolveDesktopDataHome`；**不是** `~/.dsh`） |
| 物化 profile | `~/.videobuddy/profiles/desktop/cordis.yml`（+ package.json/pnpm-lock） |
| **启动器层** | `~/.videobuddy/profiles/desktop/node_modules/dsh-desktop-layer/cordis.patch.yml`（每次 boot 重写，勿手改） |
| 设备/目录缓存 | `~/.videobuddy/canvas-studio/{device.json,gateway-catalog.json}` |
| 桌面日志 | `~/Library/Application Support/VideoBuddy/logs/dsh-*.log` |
| llm 注册面参照 | `deepseek-harness/packages/llm/llm-pi-ai/src/index.ts` |
| 网关落行代码 | `canvas-studio/src/index.ts` `applyGatewayConfig` + `src/gateway.ts` |
| recompose 语义 | `deepseek-harness/packages/boot/app-boot/src/index.ts` `recompose` / `reconcileProfilePatches` |
| 验证链 | `node node_modules/.bin/tsc -p tsconfig.json --noEmit` · `tsc -p tsconfig.tests.json` · `tsdown` · `vitest run tests/profile.spec.ts` · `env -u NODE_OPTIONS node scripts/verify-profile-boot.mjs` · `verify-loader-boot.mjs` |

## 6. 踩坑记录（新会话必读）

1. **0.2.1 `settings.mutate` = 全量 recompose**，输入只有「文件层 + overlays」。
   任何「只存在于内存的启动器补丁」都会在下一次写入时蒸发——要么落成 bundle 层，
   要么走 `profileContext.overlays`（但 overlays 在用户层之上：会挡住同名行的
   settings 写入，且它 insert 的行无法被下层 patch 命中，所以插入型层不能用 overlays）。
2. **层必须晚于它要禁用的行**：`desktopBundleList` 把启动器层固定排最后。
3. **层的推导输入不能包含层自己的产物**（`launcher` 视图），否则不幂等；用
   「连续 boot 的 layer 文件 sha256 不变」验证幂等性。
4. **JS `#私有成员` 类的方法不能裸引用传递**，跨模块一律包箭头函数。
5. canvas-studio client 类型面：`ctx.remote.*` 用各域生成投影；**勿引 `dsh-api-remotes`**。
6. 根 yarn `enableImmutableInstalls`：新增依赖用 `corepack yarn install --no-immutable`（仓库根）。
7. 宿主 `ctx.get('credentials')` / `ctx.get('settings')` 无需 inject；client 子 fiber 必须在 `STUDIO_CLIENT_INJECT` 声明。
8. 「闪退」要分清主进程/渲染层：本轮主进程活着（行被移除导致窗口消失），别被表象带偏。
9. 受管 shell 起不了 Electron（`EPERM unlink` 崩溃证据目录）；`verify-*.mjs` 也要
   `env -u NODE_OPTIONS`（brokered fs shim 会让 storage mkdir 报 `EPIPE`）。
10. **桌面层不能被当成「已安装依赖」**（`1b6286711d` 修）：`profileDependencyMigrationRequired`
    用 `existsSync(<profile>/node_modules)` 判断要不要跑 pnpm 迁移，而层就落在
    `node_modules/dsh-desktop-layer` ⇒ 每个只物化过层、没跑过 pnpm 的 profile 每次启动
    都重跑一次打包版 pnpm（沙箱里直接失败在 `migrating legacy Profile dependency layout`）。
    判据已改为「node_modules 里存在非层条目」。
    ⇒ **凡是在 profile 目录里新增固定子目录，都要回头检查有没有 `existsSync(dir)` 型判据会误读它。**
11. 本机 Electron 无法 unlink 任何文件的真实机制（比第 9 条更准）：shell 被 toybox seatbelt
    包裹，`rm` 能成功是因为它走 broker 代理删除；Electron 进程内的直接 `unlink` 一律 EPERM。
    `dangerouslyDisableSandbox` 与 `open -n -a`（LaunchServices）都不解除。表现为启动走到
    `connection` 插件时死在 `unlink ~/.videobuddy/.credentials.yaml.lock` —— **这是环境，不是产品缺陷**。
    绕过 userData 侧崩溃证据可用 `--user-data-dir=/tmp/...` 直接调 Electron 二进制
    （`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <main.js>`），
    但凭证锁在 `~/.videobuddy` 下，绕不过。
