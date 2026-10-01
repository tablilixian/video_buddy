# 计划：为桌面大模型接入 TinyFish 联网搜索 / 抓取能力

> 状态：待实施（已与用户确认方案：新建独立包 `dsh-web-search-tinyfish` + 同时开启 `web_fetch`）
> 目标：让桌面大模型具备联网搜索（及网页正文抓取），不依赖 DeepSeek key。最后一跳 provider 从钉死的 `deepseek-official` 换成 **TinyFish**（Search + Fetch 永久免费）。

---

## 1. 背景与根因

现象：调用 `web_search` 时提示「没有 key」，报错 `WEB_PROVIDER_CREDENTIAL_MISSING`。

根因（已定位）：`web` seam 的默认搜索 provider 在 base bundle patch 里被**钉死为 `deepseek-official`**，而该 provider 需要 `DEEPSEEK_API_KEY`。但本机模型是自建网关 `qwen3.8-27b`（无 DeepSeek key），于是 key 缺失抛错。

工具层（`dsh-tool-web` 的 `web_search`/`web_fetch`）、UI 卡片、system prompt 引导全是现成的——**只需把最后一跳 provider 换掉**。

## 2. 已确认的架构事实（方案依据）

- `web` seam 双能力**独立选路**：`searchProvider` / `fetchProvider` 各自 pin、各自 auto-select（`deepseek-harness/packages/web/web/src/index.ts:55-93`）。
- **patch 合并语义（关键）**：base bundle patch 是「ONE insert over empty root」，后续 bundle patch（含桌面 `dsh-plugin-desktop/cordis.patch.yml`）按 `id` 覆盖，**整行 `config` 替换、last-write-wins**（`deepseek-harness/packages/bundle/base/cordis.patch.yml:1-10`）。覆盖不产生重复 id（`applyEntryPatches` 是原地 `target.config = value`）。
- provider 契约极简：`WebSearchProvider{ id, available(), search() }` / `WebFetchProvider{ id, available(), fetch() }`（`web/src/types.ts:102-120`）。`sources[]` 字段 `url/title/snippet/publishedAt` 可直接映射；fetch 结果 `body` 为 `{kind:'html'|'text', content}`。
- **钉死位置**：`searchProvider: deepseek-official` 与 `tool-web.fetch: false` 都在 `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`（即 submodule 的 `packages/bundle/base/cordis.patch.yml`，上游，**不可改**）。桌面自有 patch 未重声明 `id: web`。
- **env 变量无效**：`WebRuntime` 构造用 `config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER`，因 base 已显式设值，env 被 `??` 短路忽略。故必须用 patch 覆盖，不能用 env。

## 3. TinyFish 适配要点（已调研）

| 能力 | 端点 | 认证 | 免费档限流 | 返回关键字段 |
|---|---|---|---|---|
| Search | `GET https://api.search.tinyfish.ai?query=&location=&language=` | `X-API-Key` | 30 req/min | `results[{position, site_name, title, snippet, url}]` + `total_results` + `page` |
| Fetch | `POST https://api.fetch.tinyfish.ai`，body `{urls:[...], format:"markdown"}`（单次≤10 URL） | `X-API-Key` | 150 url/min | `results[{url, title, format, text, status}]` + `errors[]` |

- 一把 key 同时覆盖 Search + Fetch；钱包 $0 也持续可用，无需信用卡。
- `site_name` → 可映射到 source 可选字段；无独立 `publishedAt`，留空（不影响卡片）。
- Fetch 返回干净 markdown → 映射到 `body: {kind:'text', content}`。
- 失败 URL 不计费；超限返回 `429 + Retry-After`。

## 4. 改动文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `dsh-web-search-tinyfish/package.json` | 新增 | 桌面自有 workspace 包 |
| `dsh-web-search-tinyfish/tsconfig.json` | 新增 | 编译到 `lib/` |
| `dsh-web-search-tinyfish/src/index.ts` | 新增 | Cordis 插件入口（`apply`/`Config`/credential-ref/settings） |
| `dsh-web-search-tinyfish/src/provider.ts` | 新增 | `TinyFishSearchProvider` + `TinyFishFetchProvider` |
| `dsh-web-search-tinyfish/lib/**` | 构建产物 | `yarn workspace dsh-web-search-tinyfish build` 生成 |
| 根 `package.json` `workspaces` | 编辑 | 加入 `dsh-web-search-tinyfish`；并在 `build`/`dev` 脚本前置其 build |
| `dsh-plugin-desktop/cordis.patch.yml` | 编辑 | `insert` 加 `web-search-tinyfish`；覆盖 `id: web`（`searchProvider/fetchProvider: tinyfish`）；覆盖 `id: tool-web`（`fetch: true`） |
| `~/.dsh/.credentials.yaml` 或桌面设置 UI | 用户侧 | 登记 `TINYFISH_API_KEY`（去 agent.tinyfish.ai 免费注册） |

**不碰**：`deepseek-harness` submodule、`@deepseek-ai/dsh-base` 任何文件、`canvas-studio`。

## 5. 新包设计

- 命名：`dsh-web-search-tinyfish`（package name）；Cordis 插件 `name = 'web-search-tinyfish'`；patch 行 `id: web-search-tinyfish`；provider 内部注册 id = **`'tinyfish'`**（须与 patch 里的 `searchProvider: tinyfish` / `fetchProvider: tinyfish` 一致）。
- 依赖（对齐桌面已装版本）：`@deepseek-ai/dsh-web@0.1.1-rc.2`、`@deepseek-ai/dsh-credentials@0.1.1-rc.2`、`@deepseek-ai/dsh-settings@0.1.1-rc.2`、`@deepseek-ai/dsh-launch-environment@0.1.1-rc.2`、`@deepseek-ai/schemastery@^3.18.1`、`@deepseek-ai/cordis@4.0.1`；devDeps：`typescript@6.0.3`、`@types/node`。
- `Config`：`apiKeyEnv` 默认 `TINYFISH_API_KEY`（credential-ref 范式，沿用 DeepSeek provider 写法）；可选 `searchTimeoutMs`/`fetchTimeoutMs`。
- `apply()`：照抄 `web-search-deepseek` 范式 —— `installSettingsSection` + `ctx.web.registerSearchProvider(...)` + `ctx.web.registerFetchProvider(...)`。
- `available()`：恒返回 `true`（与 DeepSeek provider 一致——key 缺失在 `search()/fetch()` 执行时抛 `WEB_PROVIDER_CREDENTIAL_MISSING`，pinned 选路仍要求 `available()===true`）。
- key 解析：`credentials.resolve(credentialRef(ref))` → 失败回退 `launchEnvironmentOf(ctx).get(ref)?.value`；均无则抛 `WEB_PROVIDER_CREDENTIAL_MISSING`。
- 网络：直接用 Node22 全局 `fetch`，把 `signal` 透传取消；429 抛 `WEB_PROVIDER_ERROR`（含 Retry-After 提示）。

## 6. patch 改动（桌面 `cordis.patch.yml`）

在现有 `insert:` 列表追加一项：

```yaml
    - id: web-search-tinyfish
      name: dsh-web-search-tinyfish
      config:
        apiKeyEnv: TINYFISH_API_KEY
```

在文件末尾（与 `- id: web-runtime` 同级）追加两行覆盖：

```yaml
- id: web
  config:
    searchProvider: tinyfish
    fetchProvider: tinyfish

- id: tool-web
  config:
    fetch: true
    searchTimeoutMs: 60000
```

> 注意：`id: web` / `id: tool-web` 是**整行替换** base 配置；`tool-web` 必须显式带上 `searchTimeoutMs: 60000`（base 原值），否则会回落 schema 默认 30000。

## 7. 构建与验证

1. `corepack yarn install`（链接新 workspace 包 + 安装其依赖）
2. `corepack yarn workspace dsh-web-search-tinyfish build`（生成 `lib/`）
3. `corepack yarn workspace dsh-plugin-desktop typecheck`（确认桌面侧能解析新包类型）
4. 启动桌面 → 让模型执行一次 `web_search` → 确认**不再报无 key**、返回 TinyFish 结果卡片；再测 `web_fetch` 取正文。
5. 观察桌面日志确认 provider id 命中 `tinyfish`（非 `deepseek-official`）。

## 8. 风险与兜底

- **patch 覆盖语义**（已读源码确认可行）：overlay 按 id 覆盖整行 config，安全。若实测未生效 → 降级为 yarn `patch:` 改 `@deepseek-ai/dsh-base`（仓库已有此模式），但预期不需要。
- **新包被 loader 收编**：workspace 包经 yarn 软链进 `node_modules/`，`name: dsh-web-search-tinyfish` 可被 `import` 解析。若 loader 对 `name` 有额外要求 → 降级为 `dsh-plugin-desktop/src/web-search-tinyfish/` 子插件入口（等价能力、改动更小）。
- **限流**：免费档 Search 30/min、Fetch 150 url/min；超出返回 429，已抛错提示，不做复杂退避（最小化实现）。
- **回退**：删除桌面 patch 里 `id: web`/`tool-web` 两处覆盖 + `web-search-tinyfish` 这一行，即恢复 base 默认（DeepSeek 钉死）。

## 9. 用户需要准备的东西

- **一个免费的 TinyFish API Key**：访问 `https://agent.tinyfish.ai/api-keys` 注册（无需信用卡，钱包 $0 可用）。
- 拿到 key 后二选一登记：
  - 桌面「设置」页中 TinyFish 对应的 API Key 输入框（由 `installSettingsSection` 自动渲染），**或**
  - 直接写入 `~/.dsh/.credentials.yaml` 的 `refs` 段：`TINYFISH_API_KEY: <你的key>`。
- 其余（新包、patch、构建、验证）由本任务自动完成；key 到位后即可在桌面实测。
