# 零 Key 联网搜索：生态调研与落地方案（海外优先）

> 日期：2026-10-27
> 状态：**待评审**（本文只做选型与方案，未改代码）
> 目标市场：**海外优先**；开发机在大陆网络，因此「海外可达性」只能做代码审查，不能本地实测。
> 前置结论：当前 Agent 搜不到东西有两个独立原因 —— ① `canvas` preset 没挂 `tool-web`；② `web.searchProvider` 指向需要 DeepSeek key 的 `deepseek-official`（本机余额 0，HTTP 402）。**只换 provider 不补 `tool-web`，仍然搜不了。**

---

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 推荐落地 | **O1：接入 `@tonydua/dsh-web-search-exa@0.2.3`（Exa 匿名 MCP）**，同时在 `canvas` preset 补 `tool-web`，并删除 TinyFish / hybrid |
| 为什么 | 零 Key、进程内、英文质量最好（实测 1.4–1.9s，返回 Wirecutter / 官方文档级来源）、代码干净、MIT、可回退 |
| 主要风险 | Exa 匿名额度无合同保障；单引擎，无兜底；**该插件尚未在 0.2.1-rc.2 桌面组合里启动验证** |
| 后续 | 若 Exa 429/停用，按 **O2** 自研 `Exa → Firecrawl keyless → Bing → DDG` 复合 provider（约 1 人日） |
| 不推荐 | `@fffangchenghao/dsh-web-search`（海外无代理会丢 Exa/DDG，见 §3.3）、`modsearch`（子进程 + 用户级配置）、`hy-sde-org`（peer 版本不兼容） |
| 工作量 | O1 ≈ 0.5 人日；O2 ≈ 1 人日 |

---

## 1. 需求与变更记录

### 1.1 原始需求（2026-10-27 上半天）

| 编号 | 需求 |
|---|---|
| R1 | 零 Key：终端用户不需要申请任何 API Key |
| R2 | 彻底删除 TinyFish（配置、依赖、UI、构建链、Notice、现状文档） |
| R3 | 大陆网络可用 |
| R4 | 中文搜索质量好 |
| R5 | `web_search` / `web_fetch` 真正进入 `canvas` preset |
| R6 | 失败可诊断（逐引擎原因），不静默 |
| R7 | 不留死 UI（TinyFish 设置区块随功能删除） |
| R8 | 隐私文案同步（搜索词会发给第三方引擎） |
| R9 | headless 可验证（单测 + 探针 + `yarn check`） |

### 1.2 本次变更（用户 2026-10-27 决定）

> 「不要求中文优先，海外可用即可，产品将来可能主打海外市场。」

| 编号 | 变更 |
|---|---|
| R3′ | **海外网络可用**取代「大陆网络可用」；大陆仅作为当前开发/调试环境 |
| R4′ | **英文搜索质量**取代「中文搜索质量」 |
| R10 | **数据流向**：面向海外用户时，优先选择欧美搜索服务，避免把用户查询发往境内服务（合规待法务确认） |
| R11 | 引擎链按市场可替换：将来若回国，再加中文引擎，不写死 |

**直接影响**：

- 百度、360 从主链移除（`360` 本身反爬严重，`@fffangchenghao` 作者也把它降为兜底）。
- AnySearch 从「主引擎」降为「可选/备用」；它是本次实测中文与通用性最好的免费源，但面向海外主线时应让位给 Exa/Firecrawl/Bing/DDG。
- Exa（语义检索）与 Firecrawl keyless 成为核心候选。

---

## 2. DSH 生态盘点（2026-10-27，npm 实查）

### 2.1 A 类：真·零 Key（装完即用）

| 包 | 版本 | 引擎 | 0.2.1-rc.2 兼容 | 进程内 | 自带工具面 | 实测/备注 |
|---|---|---|---|---|---|---|
| **@tonydua/dsh-web-search-exa** | 0.2.3 | Exa 匿名 MCP | ✅ peer `>=0.2.1-alpha.1` | 是 | 否（仅 provider） | 底层 MCP 实测 1.4–1.9s，英文质量最好 |
| **@fffangchenghao/dsh-web-search** | 0.24.0 | AnySearch / cn.bing / DDG HTML / www.bing / DDG Lite / 360 / Exa 匿名 / Firecrawl keyless | ✅ 显式声明 `0.2.1-rc.2: compatible` | 是 | **是**（`web_tools` + 多个可选工具 + 设置页） | 8 引擎，但海外无代理会丢 Exa/DDG（§3.3） |
| **@anysearch/anysearch-dsh** | 0.1.8 | AnySearch 官方 | 需 ≥0.2.0-rc.2，未逐版本声明 | 是 | 仅补 `web_fetch`，**不提供 `web_search`** | MCP 匿名 `tools/list` 200；单点 |
| **@aiwayds/dsh-web-search-anysearch** | 0.8.1 | AnySearch | 需 ≥0.2.0-rc.2 | 是 | 否 | 仅 provider |
| **dsh-web-search-zerokey** | 1.1.0 | Bing / HN / GitHub / arXiv / npm / 掘金 / CSDN | peer `>=0.1.2-rc.1`，大概率 | 是 | 否 | 偏技术源，不适合通用问答 |
| **@godchen520/dsh-web-search-bing** | 1.2.3 | cn.bing（RSS 优先 + HTML 兜底） | peer `>=0.2.0-rc.2 <0.3.0` | 是 | 否 | 中文相关性差，海外无意义 |
| **@liustack/modsearch**（国外） | 5.10.10 | Firecrawl keyless（默认）/ Keenable keyless / Tavily / Exa / X | 未声明 | **否（spawn 自带 CLI）** | `x_search` / `read_page` | Firecrawl keyless 实测 200 / 2.1–4.6s；打包风险（§3.4） |
| **@hy-sde-org/dsh-web-search-public**（国外） | 0.2.1-rc.3 | Startpage / DDG / Ecosia / Google / Mojeek 并发合并 | ❌ peer 要 `dsh-web ^0.2.1-rc.3`，我们是 rc.2 | 是 | 否 | 版本不兼容，直接排除 |

### 2.2 B 类：零 Key 但需自建 / 需免费 Key

| 包 | 实情 |
|---|---|
| `dsh-web-search-searxng@0.5.1` | 零 Key，但要自建 SearXNG 实例；公共实例在大陆均不可达 |
| `dsh-web-search-providers@0.4.1` | Tavily（1000 次/月）+ 百度千帆（1500 次/月），**都要 key** |
| `dsh-web-search-tavily@0.2.4` | Tavily key |
| `dsh-web-search-free@1.9.0` | 名字误导：Tavily/Exa/Brave/Baidu/SearXNG 全要 key；**且 `package.json` 无 license 字段，进安装包会卡 `verify:notices`** |
| `@gausszhou/dsh-web-search-local@0.2.1` | 零 Key 多引擎，但 peer `^0.1.0-rc.8`，**semver 不兼容 0.2.x** |

### 2.3 C 类：借模型 / 厂商 API（非零 Key）

`dsh-web-search-session`、`dsh-web-search-diy`、`dsh-web-search-zhipu`、`dsh-web-search-openai`、`dsh-web-search-aggregation`、官方 `deepseek-official`。

其中 `deepseek-official` **每次搜索 = 一次完整模型 turn**（扣余额），本机实测 HTTP 402 `Insufficient Balance`，不算免费。

---

## 3. 关键结论（决定选型的五条硬事实）

### 3.1 provider ≠ 工具

`web_search` 由 `@deepseek-ai/dsh-tool-web` 提供。它在 `deepseek-harness/packages/bundle/web-app/cordis.patch.yml:579` 被 `disabled: true`，而我们的 `canvas` preset 没有挂载它。结论：

- 只装 provider 类插件（`@tonydua`、`@aiwayds`、`zerokey`、`@godchen520`） → **仍然没有 `web_search`**。
- 只有 `@fffangchenghao` 自带工具面（`web_tools` 等），能绕过这个限制，但会带来另一套工具/UI。

### 3.2 patch 是整块替换 config，且层序决定谁赢

- 插件自带的 `cordis.patch.yml` 若 pin 了 `web` 行，会顶掉 base 的 `fetchProvider`；漏写会直接让 `web_fetch` 变成 `WEB_PROVIDER_AMBIGUOUS`。
- 我们的 `dsh-plugin-desktop/cordis.patch.yml` 层序更靠后，**会反过来覆盖插件的 pin**。
- 所以最终以我们的文件为准：`web` 行必须同时写 `searchProvider` 和 `fetchProvider`。

### 3.3 `@fffangchenghao` 在海外有个隐藏坑

`lib/engines.js:482`：

```js
.filter((host) => host.viaProxy !== true || proxy !== undefined)
```

而 `exa`、`ddg-html`、`www.bing` 都标了 `viaProxy: true`。**没配代理时，海外实际只跑 `AnySearch + cn.bing + Firecrawl + 360`**，宣传的 8 引擎不成立。对海外产品来说，默认主引擎反而是境内 AnySearch + cn.bing，与 R10 相反。

它仍是兼容性最好、工具面最全的包，但**不适合作为海外主线的默认值**。

### 3.4 `modsearch` 的打包风险

`dsh/index.js:10` 明确写着：引擎从包内 `../dist/main.js` **spawn 子进程**（不是 npx，但也要求 Electron 以 `ELECTRON_RUN_AS_NODE` 方式起子进程），配置写在 `~/.modsearch/config.json`（用户级，不是 profile 级）。对桌面安装包来说：

- asar 内 spawn 需要额外验证；
- 每次搜索多一次进程启动开销；
- 用户级配置与我们的 profile 隔离模型不一致。

不作为首选。

### 3.5 兼容性与许可红线

- `@hy-sde-org/dsh-web-search-public` peer 要求 `@deepseek-ai/dsh-web ^0.2.1-rc.3`，当前是 `0.2.1-rc.2`，**装不上**。
- `dsh-web-search-free@1.9.0` 无 license 字段，`verify:licenses` 会失败，**不能进安装包**。
- `@tonydua/dsh-web-search-exa` 不 import 已删除的 `SettingsProvider`（不会重蹈 hybrid 崩溃），其 settings 安装逻辑有 `installSection` 存在性保护。

---

## 4. 推荐方案 O1：Exa 匿名 provider + 补 `tool-web`

### 4.1 架构

```
canvas preset（每个会话）
  └─ tool-web（新增）            ← web_search / web_fetch 真正进会话
        │
host web seam
  ├─ searchProvider: exa         ← @tonydua/dsh-web-search-exa（匿名 MCP）
  └─ fetchProvider: http         ← 上游 keyless HTTP 抓取（带 SSRF 防护，不改）
```

### 4.2 为什么选它

| 维度 | 评价 |
|---|---|
| 零 Key | 无 key 时走 `mcp.exa.ai/mcp` 匿名通道（实测 200） |
| 英文质量 | 3 条查询全部命中一手来源（Wirecutter、PostgreSQL 官方文档、Rust 官方 release 页） |
| 延迟 | 1.4–1.9s（比 Firecrawl 2.1–4.6s、AnySearch 1.5–3.6s 更稳） |
| 代码面 | 纯 provider，无子进程、无客户端 UI、无设置页；429/5xx 有熔断 |
| 兼容 | peer `dsh-web >=0.2.1-alpha.1`，覆盖 0.2.1-rc.2 |
| 许可 | MIT |
| 回退 | 改 `web.searchProvider` 一行即可回到 `deepseek-official` 或换其它 provider |

### 4.3 具体改动

**① 依赖** `dsh-plugin-desktop/package.json`：

```diff
-    "dsh-web-search-hybrid": "workspace:*",
-    "dsh-web-search-tinyfish": "workspace:*",
+    "@tonydua/dsh-web-search-exa": "0.2.3",
```

**② patch** `dsh-plugin-desktop/cordis.patch.yml`：

```diff
-    - id: web-search-tinyfish
-      name: dsh-web-search-tinyfish
-      config:
-        apiKeyEnv: TINYFISH_API_KEY
-    - id: web-search-hybrid
-      name: dsh-web-search-hybrid
-      disabled: true
-      config:
-        apiKeyEnv: TINYFISH_API_KEY
-        bingMarket: zh-CN
+    - id: web-search-exa
+      name: '@tonydua/dsh-web-search-exa'
+      config:
+        apiKeyEnv: EXA_API_KEY   # 没有该凭据时自动走匿名 MCP

 - id: web
   config:
-    searchProvider: deepseek-official
+    searchProvider: exa
     fetchProvider: http
```

**③ preset** `preset-canvas.plugins` 增加（对齐 `standard.patch.yml:116-120`）：

```yaml
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
```

> 说明：host 层 `tool-web` 在 web-app bundle 被 `disabled: true`，桌面 patch 只改了 `config` 没解除 `disabled`；会话层真正生效的是 preset 里的实例。`standard` preset 就是这么挂的，`canvas` 漏了。

**④ 删除**：`dsh-web-search-tinyfish/`、`dsh-web-search-hybrid/` 两个目录；根 `package.json` 的 `workspaces` 与 `scripts.build` 对应项；`yarn.lock` 重新生成。

### 4.4 已知限制与应对

| 限制 | 应对 |
|---|---|
| 单引擎，Exa 匿名 429 时无兜底 | 插件自带熔断；先上线，触发条件满足后升级 O2 |
| 匿名通道无 SLA | 监控搜索失败率；准备 O2 |
| 该插件尚未在本仓库 0.2.1-rc.2 组合里启动 | T0 先做 boot smoke（见 §7） |
| Exa 是语义检索，短关键词/精确 URL 查询可能不如关键词引擎 | 后续 O2 增加 Bing 兜底 |

### 4.5 升级到 O2 的触发条件

任一满足即启动 O2：

- Exa 匿名 429/超时率 > 5%（按周统计）；
- 用户反馈「搜索结果为空/打不开」> 3 例/周；
- Exa 关闭匿名通道；
- 需要正式 SLA 或企业合规承诺。

---

## 5. 备选方案 O2：自研复合 provider（下一迭代）

### 5.1 引擎链

```
非 CJK：Exa(匿名) → Firecrawl(keyless) → Bing → DDG
CJK   ：AnySearch → Bing → Firecrawl → DDG     （可选，给将来回国留口）
```

- 每个引擎 8–12s 超时；总预算受 `tool-web.searchTimeoutMs=60000` 约束。
- 按 URL 归一化去重；默认 8 条。
- 全失败抛结构化错误：`all search engines failed (exa: …; firecrawl: …; bing: …)`。

### 5.2 包结构

```
dsh-web-search-free/
  package.json
  src/index.ts        # Cordis 插件，registerSearchProvider
  src/chain.ts        # 顺序尝试 / 超时 / abort / 去重 / 错误聚合
  src/engines/exa.ts
  src/engines/firecrawl.ts
  src/engines/bing.ts
  src/engines/ddg.ts
  tests/*.test.mjs
```

Provider id：`free`（避免和 `exa`/`bing` 冲突）。

### 5.3 注意

- 仓库内原计划的 `dsh-web-search-free` 与 npm 现有同名包（1.9.0，需 key）冲突，**实施时必须改名**（如 `dsh-web-search-freechain`）。
- O2 可复用 O1 的 Exa 调用方式，不需要推翻重来。

---

## 6. TinyFish 下线清单

### 6.1 运行与构建

| 位置 | 动作 |
|---|---|
| 根 `package.json` → `workspaces` | 移除 `dsh-web-search-tinyfish`、`dsh-web-search-hybrid` |
| 根 `package.json` → `scripts.build` | 移除 `yarn workspace dsh-web-search-tinyfish build` |
| `dsh-plugin-desktop/package.json` → dependencies | 移除两包；新增 `@tonydua/dsh-web-search-exa` |
| `dsh-plugin-desktop/cordis.patch.yml` | 删 `web-search-tinyfish`（23-26）、`web-search-hybrid`（31-36）；新增 `web-search-exa`；`web` 行改 `searchProvider: exa` |
| `preset-canvas.plugins` | 新增 `tool-web`（`fetch: true`、`searchTimeoutMs: 60000`） |
| `dsh-web-search-tinyfish/`、`dsh-web-search-hybrid/` | 整目录删除（含 `lib/` 入库产物） |
| `yarn.lock` | `yarn install` 重算（`dsh-free-search` 依赖随之移除） |

### 6.2 UI 与文档

| 位置 | 动作 |
|---|---|
| `canvas-studio/src/client/SettingsModal.tsx:95-103, 116-130, 188-205, 303-327` | 删除 TinyFish 密钥区块与全部 state/effect；重建 `canvas-studio/lib/client.js` |
| `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` | 重新生成（去 tinyfish/hybrid/free-search，加 `@tonydua/dsh-web-search-exa`） |
| `dsh-plugin-desktop/scripts/verify-plugins.mjs` | 重写：断言 `web_search`/`web_fetch` 已注册 + `ctx.web.search` 真实返回 + `ctx.web.fetch` 成功；删除已失效的 MemOS 断言 |
| `PRIVACY.md` / `PRIVACY.zh.md` | 改为：搜索词会发往 Exa；`web_fetch` 直接访问目标站点；不发送本地凭据 |
| `docs/plans/R-P0-01-两阶段Storyboard形态设计.md:42,118,181` | 过时的「已有 web-search 插件」表述，改为指向本文 |
| `canvas-studio/docs/code-review/*`、`acceptance-test-cases.md` | 历史条目保留，补一行「TinyFish 已下线，条目作废」 |

> `~/.videobuddy/.credentials.yaml` 里的 `TINYFISH_API_KEY` 属于用户数据，代码不主动删；迁移说明里提示可手动清理。

---

## 7. 验证计划（全部 headless）

| 阶段 | 内容 | 通过标准 |
|---|---|---|
| T0 boot smoke | 用真实桌面组合启动 host，断言 `ctx.web` 中存在 `exa` provider、`ctx.tools.schemas()` 含 `web_search`/`web_fetch` | 无加载错误；schema 存在 |
| T1 真实搜索 | `ctx.web.search({ query: 'latest stable rust release', maxResults: 3 })` | ≥1 条；URL 可访问；延迟 < 10s |
| T2 真实抓取 | `ctx.web.fetch({ url: <T1 第一条> })` | 返回正文；无 SSRF/超时错误 |
| T3 失败诊断 | 临时把 `searchProvider` 改成不存在的 id | 报错包含 provider id，不静默 |
| T4 单测 | TinyFish 删除后无残留 import；`verify-plugins.mjs` 新断言 | `yarn test` 通过 |
| T5 全量门 | `corepack yarn typecheck` + `corepack yarn check` | 全绿 |
| T6 桌面验收（人工，可后置） | 全新 profile、无任何凭据，让 Agent「搜一下 latest stable rust release 并给 3 个来源」 | 出卡片、URL 可打开 |

> 说明：T0–T2 是本次必须补的，因为 `@tonydua` 插件虽然代码审查通过，但还没有在本仓库的组合里启动过。

---

## 8. 风险与回退

| 风险 | 影响 | 兜底 |
|---|---|---|
| Exa 匿名限流/关闭 | 搜索不可用 | 熔断 + 升级 O2；或临时 pin 回 `deepseek-official`（需 key） |
| 插件与 0.2.1 组合不兼容 | 启动失败 | 先做 T0；失败则改用手写 provider（O2） |
| 升级到 0.2.2+ 后 peer 不匹配 | 装不上 | 锁版本；升级时复核 `dsh-web` peer 范围 |
| 搜索词隐私/合规 | 法务风险 | PRIVACY 明示；海外优先 Exa（美国服务）；不默认启用境内引擎 |
| 无兜底导致体验断崖 | 口碑 | O2 排进下一迭代，不晚于首个海外版本 |

**回退路径**：`web.searchProvider` 改回 `deepseek-official`（或任何已注册 provider）即可；新包可独立卸载，不影响 canvas-studio。

---

## 9. 待确认

1. **是否批准 O1**（Exa 插件 + `tool-web` + 删 TinyFish/hybrid）？
2. **O2 是否排进下一迭代**？还是等 O1 上线后看数据？
3. **是否保留 CJK 分支**（AnySearch）？建议：O1 不保留；等确定回国策略再加。
4. **提交范围**：本次只提交本文档，还是文档 + O1 代码一起提交？

---

## 附录 A：实测数据（2026-10-27，本机大陆网络）

| 引擎/接口 | 结果 | 延迟 | 质量 |
|---|---|---|---|
| Exa 匿名 MCP（`mcp.exa.ai/mcp`，`web_search_exa`） | 200 × 3 | 1.44s / 1.84s / 1.91s | 最好（Wirecutter、官方文档、Rust release） |
| Firecrawl keyless（`api.firecrawl.dev/v1/search`） | 200 × 3 | 2.09s / 3.12s / 4.58s | 中（有内容农场） |
| AnySearch（`api.anysearch.com/v1/search`） | 200 × 5 | 1.5–3.6s | 好（中英文均可） |
| Bing（`cn.bing.com`） | 200 | 0.2–0.4s | 差（中文长查询跑偏） |
| DDG HTML / Lite | 超时 | 20s | — |
| 公共 SearXNG（searx.be / opnxng / tiekoetter） | 不可达 | — | — |
| Mojeek | 200 但 Captcha | 2.6s | — |
| DeepSeek 官方搜索 | 402 `Insufficient Balance` | — | — |

> 说明：海外专属引擎（DDG、Google、Startpage）在本机不可达，未实测；上表只覆盖能本地验证的部分。

## 附录 B：代码证据

- `@fffangchenghao` 无代理过滤 Exa/DDG：`lib/engines.js:482`。
- `@liustack/modsearch` spawn 自带 CLI：`dsh/index.js:10`、`dsh/index.js:350`。
- `@hy-sde-org` peer 要求：`package.json` → `"@deepseek-ai/dsh-web": "^0.2.1-rc.3"`。
- `@tonydua` 无 `SettingsProvider` 静态导入：`lib/index.js:1-4`；settings 安装有 `installSection` 保护：`lib/index.js:747`。
- `tool-web` 被 web-app 禁用：`deepseek-harness/packages/bundle/web-app/cordis.patch.yml:579`。
- `standard` preset 的 `tool-web` 挂法：`deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml:116-120`。
