# 交接文档：DramaServer 自有大模型接入（settings 写入被死 entry 卡死）

> 日期：2026-10-22　分支：`dev`　状态：**代码全部已提交，卡在桌面运行时环境问题**
> 本文自包含：新会话无需历史上下文。相关方案：[DramaServer-管理面接口接入方案.md](./DramaServer-管理面接口接入方案.md)（含 §0.4 重评估表）

## 1. 目标与已达成

**目标**：登录用户在 VideoBuddy 桌面里能用上 DramaServer 自有 LLM（聊天模型选择器 + 设置页「DramaServer 官方模型」区块）。

**代码侧已全部完成并提交**（验证链四步全绿）：

| 提交 | 内容 |
| --- | --- |
| `441050aa34` | CV-354 模型设置页 0.2.1 断线修复（`connection.api` → `remote.llm/settings/credentials` 三域）+ 官方区块（识别 `canvas-studio-gateway` 行，缺行时「待接入」暗态）+ provider 折叠行重设计 |
| `7101379fbd` | CV-355/356/357 方案 P1+P2+P4：`src/drama-management.ts`（DramaClient：auth/sync · models · credits）、`src/device-registry.ts`（device.json 设备身份）、`businessApiBase` 设置项、`src/account-state.ts`（会话推送编排）、`src/gateway.ts`（网关行生成/指纹/目录缓存/凭据发布）、`src/index.ts` 装配 + routes.ts 会话钩子、4 个测试文件、`scripts/live-e2e-management.mjs` |
| `211344de3e` | 修复①：DeviceRegistry 方法裸引用丢 `this`（`#私有成员` 爆炸）→ 包箭头函数 + 真 registry 回归守卫 |
| `48a514f896` | 修复②：落行 configEditor.edit → settings.mutate（当时误判为轻量路径，见下）+ 目录回调失败清 `catalogFetchedAt` 允许重试 |
| `f40b05b9f2` | 桌面壳 `dsh-plugin-desktop/cordis.patch.yml` 禁用 hmr / desktop-product-telemetry（**但未传导到运行时，见 §3**） |
| `05ea9dc2b6` | 修复③：启动期缓存恢复延后 5s + 兜 catch（防 unhandled rejection → fatal load failure） |

**运行时已实证打通的环节**（日志/文件为证）：

- ✅ 会话推送 → bootstrap 触发（`routes.ts` auth/session 钩子）
- ✅ `auth/sync` 成功 → `~/.videobuddy/canvas-studio/device.json`
- ✅ `/v1/models?modality=text` 成功 → `~/.videobuddy/canvas-studio/gateway-catalog.json`（真实目录，当前 1 个可用模型 `deepseek-flash`）
- ✅ 凭据 `CANVAS_STUDIO_GATEWAY_TOKEN` 已发布（`onSessionToken` 先于目录回调）
- ✅ 编排幂等/错误策略按设计工作（401 静默 / 429 退避 / 失败不阻塞登录）

## 2. 唯一卡点：settings 写入被「死 entry」卡死

0.2.1 的关键机制（本轮实测确认，**修正了方案 §4.0 的假设**）：

```
settings.mutate（甚至桌面模型页自己的保存）
  = SettingsForms.write → ConfigEditor.edit
  = 读改 profile patch 文件 → reconcileProfilePatches → recompose（全量重放）
  → 重放后置校验：任一 entry 未激活 → 抛「dsh: warning: N entries did not activate」→ 写入回滚
```

桌面壳有**两个从未激活的 entry**：

- `hmr`：要求 `--expose-internals`，Electron 主进程没有（上游是给 host 子进程的）
- `desktop-product-telemetry`：`serviceVersion: !!js process.env.DSH_CLIENT_VERSION`，桌面壳未设该 env

后果链：网关行写入 → 重放失败回滚（行不落地）→ **重放期间插件 fiber 重挂** → 重激活死 entry 再失败 → 再回滚重挂 → **窗口消失**（用户观感「闪退」；主进程不死、无崩溃转储）。启动期（apply 期）触发写入更糟：unhandled rejection → `fatal load failure` → 应用起不来（已用延后+catch 防住）。

日志证据：`~/Library/Application Support/VideoBuddy/logs/dsh-2026-10-22.error.log`（搜 `did not activate`）。

## 3. 当前未解问题（新会话从这里接手）

### 3.1 主问题：桌面补丁没有传导到运行时

`f40b05b9f2` 在 `dsh-plugin-desktop/cordis.patch.yml` 禁用了两个 entry，但 12:41 启动的 profile（`~/.videobuddy/profiles/desktop/cordis.yml`，12:41 物化）**没有**拾取禁用行，报错依旧。

待查清的事实（按优先级）：

1. **桌面运行时的 entry 列表/patch 真实来源**：12:41 物化的 cordis.yml 里**连 `canvas-studio` 和 `desktop-shell` 行都没有**，但两者都在跑（canvas-studio 直接加载仓库 `canvas-studio/lib/index.js`，见 fatal 栈）。说明运行时 patch/entry 有第二个来源（main.ts 内嵌？运行时注入 loader？）。查 `dsh-plugin-desktop/src/main.ts` 与 `src/profile-materializer.ts`：`prepareDesktopProfile` / `materializeProfile`（main.ts:616/729 仅恢复模式与依赖迁移时调用）与运行时喂给 loader 的 patch 组装处。
2. `materializeProfile` 只在恢复/依赖迁移时重跑 → 改 patch 文件不会自动重物化。**需要找到正常 boot 重物化（或 patch 热传导）的机制**，或手动触发一次（删除/重命名物化 `cordis.yml` 让 boot 重建？注意 profile 目录还有 package.json/pnpm-lock 等，重物化会重装依赖，谨慎评估）。
3. 注意：用户**已删除**我手改的 `~/.videobuddy/profiles/desktop/cordis.yml`（物化产物，2026-10-22 手改版含两行 `disabled: true` + 注释）。下次 boot 的行为需重新确认（重建 or 报错）。
4. 上面曾观察到「12:41 物化版无 canvas-studio 行却跑着 canvas」——先弄清这一点，补丁传导的答案很可能就在同一个机制里。

### 3.2 备选方案（若补丁传导实在走不通）

**方案 B（推荐评估）：canvas-studio 自建 mini-adapter，完全绕开 settings/configEditor 写入。**
llm 注册面是代码 API：`ctx.llm.registerAdapter(routes, adapter)` + `ctx.llm.registerConfigurableProviders(entries)`（见 `deepseek-harness/packages/llm/llm-pi-ai/src/index.ts` 的用法）。canvas-studio 可以自己实现一个 openai-completions adapter（baseURL `<businessApiBase>/v1/llm`，Bearer 取 `credentials.resolve(credentialRef('CANVAS_STUDIO_GATEWAY_TOKEN'))`——凭据已就位），把 DramaServer 目录注册成 adapter + 目录行。模型即进 `buildModelCatalog`（聊天可选）与设置页目录。**零 settings 写入 = 零重放风险**，代价是要实现 adapter 接口（对照 `@deepseek-ai/dsh-llm` 的注册面与 pi-ai adapter 结构）。

**方案 C：修死 entry 本身**——main.ts 启动时 `process.env.DSH_CLIENT_VERSION = app.getVersion()`（救 telemetry）；hmr 在 Electron 主进程带 `--expose-internals` 的可行性待查（`ELECTRON_RUN_AS_NODE`/fuses/NODE_OPTIONS allowlist，大概率不可行 → 禁用是唯一解）。即使走方案 C，也要先解决 §3.1 的传导问题。

### 3.3 验收清单（接通后）

1. 重启桌面 → 日志约 5s 后「网关行已从目录缓存恢复：N 个模型」或登录推送后「管理面 bootstrap 完成：…text 模型 N 个」
2. 设置 → 模型：「DramaServer 官方模型」区块点亮（模型列表 + 设为默认，只读）
3. 聊天模型选择器出现 DramaServer 组（默认模型建议切到它——当前 profile 出厂默认 `deepseek-official/deepseek-flash` 是不真实存在的组合）
4. L6：`DRAMA_ACCESS_TOKEN=<桌面登录的 access token> node canvas-studio/scripts/live-e2e-management.mjs`
5. 服务端确认设备记录 `name=VideoBuddy Desktop`

## 4. 关键路径速查

| 什么 | 在哪 |
| --- | --- |
| DSH home（桌面） | `~/.videobuddy`（`main.ts` `resolveDesktopDataHome`；**不是** `~/.dsh`） |
| 物化 profile | `~/.videobuddy/profiles/desktop/cordis.yml`（+ package.json/pnpm-lock） |
| 设备/目录缓存 | `~/.videobuddy/canvas-studio/{device.json,gateway-catalog.json}` |
| 桌面日志 | `~/Library/Application Support/VideoBuddy/logs/dsh-*.log`（renderer 崩溃不出现在这里，主进程 stderr 在用户终端） |
| 桌面进程 | `dsh-plugin-desktop/lib/main.js`（仓库 dev 直跑；canvas-studio 加载仓库 `canvas-studio/lib/index.js`） |
| 官方模型页参照 | `deepseek-harness/packages/client/ui-settings-models/`（settings.mutate 同款写入） |
| llm 注册面参照 | `deepseek-harness/packages/llm/llm-pi-ai/src/index.ts`（registerAdapter / registerConfigurableProviders / 目录热更新） |
| 网关落行代码 | `canvas-studio/src/index.ts` `applyGatewayConfig`（settings.mutate 路径）+ `src/gateway.ts` 纯函数 |
| 验证链 | `corepack yarn typecheck && build && verify:loader && test:smoke`（canvas-studio 目录内；沙箱 build 分步：`node node_modules/.bin/tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly`） |

## 5. 踩坑记录（新会话必读）

1. **0.2.1 `settings.mutate` = ConfigEditor 全量重放**（不是轻量 volatile 写）。任一未激活 entry 卡死**一切**配置写（包括桌面模型页保存）。启动期（apply 期）触发写入 = unhandled rejection = `fatal load failure`，应用起不来。
2. **JS `#私有成员` 类的方法不能裸引用传递**（`const f = obj.fn; f()` 丢 this）——跨模块传 getter 一律包箭头函数。已有真 registry 回归守卫（`tests/account-state.test.mjs`）。
3. canvas-studio client 类型面：`ctx.remote.*` 用各域生成投影（`@deepseek-ai/dsh-llm/remote` + `@deepseek-ai/dsh-api-settings-controller/remote` 合并进 `TypertRemoteNamespaceMap`）；**勿引 `dsh-api-remotes`**（其类型依赖全在 devDeps，`nmHoistingLimits: workspaces` 下不传递安装）。
4. 根 yarn `enableImmutableInstalls`：新增依赖用 `corepack yarn install --no-immutable`（在**仓库根**跑，lockfile 在根）。
5. 宿主 `ctx.get('credentials')` / `ctx.get('settings')` 无需声明 inject（optional service 用 ctx.get）；client 子 fiber 访问服务必须在 `STUDIO_CLIENT_INJECT` 里声明。
6. 「闪退」要分清主进程/渲染层：主进程死了会有 Crashpad 转储 + 日志戛然而止；本轮的「闪退」主进程活着（重挂风暴导致窗口消失），别被表象带偏。
