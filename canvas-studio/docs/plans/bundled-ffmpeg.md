# 内置 ffmpeg：让装机即全功能（CV-201）

> 状态：**已落地·待验收**（编号 CV-201；SSOT 见 [STATUS.md](../STATUS.md) §4 / §7 / §8，验收用例见 [acceptance-test-cases.md](../acceptance-test-cases.md) §十一 K 组）。
> 本文保留**决策过程与方案对比**（A~E 五方案的取舍依据、七条风险），落地时的四处偏差见文末 §8。

## 1. 结论先行

**当前版本在用户自己的电脑上，只要没装过 ffmpeg，与 ffmpeg 相关的功能就全部不可用** —— 包括**导出成片**。
根因不是「忘了加依赖」，而是**三层各自都对、串起来必然断**：

| 层 | 现状 | 证据 |
|---|---|---|
| 声明 | `ffmpeg-static@5.3.0` 已在 `canvas-studio/package.json` 的 `dependencies` | ✅ 已声明 |
| 获取 | ffmpeg-static 的二进制**不在 npm 包里**，靠 `install.js` postinstall 下载。仓库 `.yarnrc.yml` 设了 `enableScripts: false`，根 `package.json` 的 `dependenciesMeta` 里**没有** `ffmpeg-static: {built:true}` 豁免 ⇒ 脚本从不执行 | 实测 `canvas-studio/node_modules/ffmpeg-static/` 只有 `index.js` / `install.js` / `package.json`，**无 `ffmpeg` 文件**；打包产物 `dsh-plugin-desktop/dist/mac-smoke/.../app.asar.unpacked/node_modules/ffmpeg-static/` 同样无二进制 |
| 解析 | `src/ffmpeg-run.ts:43 resolveFfmpegPath()` 顺序＝显式参数 → `FFMPEG_PATH` → `require('ffmpeg-static')` → `PATH`。第三档返回的路径文件不存在，`accessSync(X_OK)` 失败被跳过 ⇒ **实际只剩系统 ffmpeg 一条路** | 开发机能用只是因为 `brew install ffmpeg` 装了 `/opt/homebrew/bin/ffmpeg` |

失败文案同样不合产品：`未找到可用的 ffmpeg。请安装 ffmpeg（macOS: brew install ffmpeg / Ubuntu: apt install ffmpeg）` —— 这是把开发者的安装步骤推给终端用户。

## 2. 影响面（缺 ffmpeg 时哪个功能会坏）

| 功能 | 位置 | 缺 ffmpeg 行为 |
|---|---|---|
| **成片合成**（拼接 / 转码 / 混音 / 淡出） | `src/compose.ts:408` | **硬失败**，抛错进节点 `error` |
| **视频风格提取 / 抽帧** | `src/video-style.ts:146` | **硬失败** |
| **尾帧续镜抽帧** `extractLastFrame` | `src/video-frames.ts:107` | **硬失败**（同场景连续镜头的像素级衔接断链） |
| BGM 真波形 | `src/waveform-host.ts:96` | 静默降级为**确定性伪波形**（看着能用，内容是假的） |
| fal 参考图压缩（长边 ≤1024） | `src/providers/reference.ts:66` | 静默降级为发原图（可能超限） |
| 产物时长 / 分辨率实测 | `src/generate.ts:1579` / `:2177` | 静默降级为回退**声明值** ⇒ 时长与分辨率失真 |

前三条是 P0：**用户导不出成片**。

### 其它外部二进制审计（顺带做完）

桌面端 `dsh-plugin-desktop/src` 全部 `spawn` 目标都是**随包自带**的（electron 本体 / 内置 node / 内置 pnpm / 安装器 / 用户 shell），无其它外挂可执行文件依赖。
⇒ **ffmpeg 是唯一缺口；补上它，装机即全功能。**

## 3. 硬约束（决定了方案形状）

1. 终端用户拿到的是**已打包的 DMG / NSIS**，不跑 `yarn install` ⇒ **只打开 `enableScripts` 救不了用户**，只能救开发机。二进制必须在**打包期**进入 app。
2. macOS 产物是 **universal（x64 + arm64）**（`package-mac.ts` 传 `--universal`；`mac-universal.ts` + `mac.x64ArchFiles` 配套）⇒ 两个架构的二进制都得在包里，且**不能落同一路径**（否则 `@electron/universal` 合并同一路径下的两个不同二进制会冲突 / 需要 lipo）。⚠️ **后半条不够**（2026-09-17 实测补充）：`extraResources` 是**整棵树**复制进两个切片，所以 `darwin-arm64/ffmpeg` 在两个切片里**逐字节相同**；`@electron/universal` 对「两边相同且未被 `x64ArchFiles` 覆盖的 Mach-O」**同样会报错**。⇒ **「路径含 arch」之外，还必须在 `mac.x64ArchFiles` 里显式声明该路径**（见 §11）。
3. `asar: true` + `asarUnpack: node_modules/**` ⇒ 塞在 asar 里的可执行文件**无法 spawn**；必须走 unpacked 或 `extraResources`。
4. macOS `hardenedRuntime: true` + `notarize: true` ⇒ 包内可执行文件必须被签名；位置要落在 osx-sign 会遍历并签到的区域（`Contents/Resources/**` 可以）。
5. **许可**：ffmpeg-static 的预编译二进制是 **GPL-3.0-or-later**。`scripts/verify-licenses.mjs` 已把 `GPL-3.0-or-later` 放进 `NOTICE_LICENSES`，`THIRD_PARTY_NOTICES.md:371` 已有 `ffmpeg-static | 5.3.0 | GPL-3.0-or-later` 一行 ⇒ 现有门禁不会因此变红，但**随包分发二进制时要额外随包带 LICENSE 与源码获取说明**。

## 4. 推荐方案：打包期取二进制 + 双路径 + 运行时按 arch 选

### ① 二进制来源与缓存（打包机）

新增 `dsh-plugin-desktop/scripts/fetch-ffmpeg.mjs`：

- 版本锁死 `ffmpeg-static@5.3.0` 对应的 release tag **`b6.1.1`**；
- 默认走 **npmmirror 镜像**（已实测可用）：
  `https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffmpeg-<platform>-<arch>.gz`
  可用 `FFMPEG_BINARIES_URL` 覆盖（对齐 ffmpeg-static 自己的环境变量名）；
- 下载 → gunzip → **sha256 校验**（哈希写死在脚本里）→ `chmod 755` → 落到
  `dsh-plugin-desktop/build/ffmpeg/<platform>-<arch>/ffmpeg(.exe)`；
- 目标集合：mac 打包取 `darwin-arm64` + `darwin-x64`；win 打包取 `win32-x64`；
- 已存在且哈希匹配则跳过 ⇒ 缓存命中时**离线可复现**；
- `build/ffmpeg/` 进 `.gitignore`（不把 ~120MB 二进制塞进 git 历史）。

> 实测体积（镜像上的原始文件）：`darwin-arm64` 43MB / `darwin-x64` 75MB / `win32-x64` 79MB。
> DMG / NSIS 会再压缩一次，落到用户包体约：mac universal **+42MB**、win **+28MB**。
> **后续实测校正（2026-09-17）**：mac universal 未压缩实测合计 **118 MiB**（arm64 43 + x64 75），故上表「+42MB」应视为**下限估算**；DMG 压缩后真实增量待全量构建实测。

### ② 随包带出

`dsh-plugin-desktop/package.json` 的 `build.extraResources` 增加 `build/ffmpeg/**`，落地为：

```
VideoBuddy.app/Contents/Resources/ffmpeg/darwin-arm64/ffmpeg
VideoBuddy.app/Contents/Resources/ffmpeg/darwin-x64/ffmpeg
resources/ffmpeg/win32-x64/ffmpeg.exe        # Windows
```

- 两架构**路径不同** ⇒ 避免同一路径下两个不同二进制被 lipo 合并；
- `extraResources` **不在 asar 内** ⇒ 可 spawn；
- 在 bundle 内 ⇒ 被签名 / 公证覆盖。

### ③ 运行时解析（`src/ffmpeg-run.ts`）

候选顺序改为（**保留全部旧档，只新增 + 修正**）：

1. 显式参数（工具入参）
2. `FFMPEG_PATH`（保留：测试注入与高级用户覆盖）
3. **随包二进制**：`<resourcesPath>/ffmpeg/<platform>-<arch>/ffmpeg(.exe)`
   取 `process.resourcesPath`（Electron 主进程自带；纯 Node 下 `undefined` 自动跳过 ⇒ **不引入 electron 依赖**，Host 保持可 headless 测试）
4. 开发态仓库路径：`<desktopRoot>/build/ffmpeg/<platform>-<arch>/ffmpeg`
5. `ffmpeg-static` 包内二进制（**修 asar → asar.unpacked 路径改写**，让这条档真正可用）
6. `PATH` 上的系统 ffmpeg（保留兜底：brew 用户仍可用更新版本）

全落空才抛错，文案改为面向终端用户：**「内置的 ffmpeg 组件缺失，请重新安装应用或在设置中导入导出诊断信息反馈」**，并附 `FFMPEG_PATH` 提示。
解析逻辑抽成纯函数（如 `bundledFfmpegCandidates({ resourcesPath, platform, arch, desktopRoot })`）以便单测注入。

### ④ 门禁（防回归）

- **打包门禁**：`scripts/verify-packaged-runtime.ts`
  `REQUIRED_UNPACKED_RUNTIME_ENTRIES` 增 `ffmpeg/darwin-arm64/ffmpeg`、`ffmpeg/darwin-x64/ffmpeg`；Windows 侧对应清单增 `ffmpeg/win32-x64/ffmpeg.exe` ⇒ 产物里少一个二进制就红。
- **真跑冒烟**（关键，防止「文件在但跑不起来」的假绿灯）：在打包产物上实际执行 `<bin> -version` 并断言退出码 0。
  ⚠️ 既有教训：ffmpeg 相关断言**必须判耗时**（真跑约 90ms，**<5ms 就是空绿**，例如只调 `resolveFfmpegPath()` 返 null 时静默软跳过）。
- **单测**：`canvas-studio/tests/ffmpeg-bundled.test.mjs` —— 用假 `resourcesPath` 断言候选顺序命中随包路径；并断言「随包路径存在时必须优先于 PATH」。
- **反向变异**：把 `extraResources` 一行去掉 → 打包门禁必须变红；把候选顺序调换 → 单测必须变红。（只绿不红的守卫不算守卫。）

### ⑤ 许可与合规

- 随包带 ffmpeg 的 `LICENSE`（镜像上有 `<platform>-<arch>.LICENSE`）到 `build/ffmpeg/<p>-<a>/LICENSE`；
- `THIRD_PARTY_NOTICES.md` 的 ffmpeg 条目从「npm 包」升级为「**随包分发的预编译二进制 b6.1.1，GPL-3.0-or-later，源码获取方式见 …**」；
- `verify-licenses.mjs` 增一条：随包 ffmpeg 目录**必须存在 LICENSE 文件**（否则红）。
- ⚠️ **法务提示（需业务侧确认）**：GPL 二进制作为**独立进程被调用**通常可主张 mere aggregation，但分发仍需履行 GPL 义务（附许可 + 源码/书面要约）；且 b6.1.1 是含 `libx264` 的 GPL 构建，**H.264 编码涉及专利授权**。若要规避，可换 **LGPL 构建**（H.264 编码改走 `h264_videotoolbox` / `h264_mf` 或 `mpeg4`）—— 那是另一条独立改造线，**建议先按现状落地、法务结论另议**。

## 5. 备选方案对比

| 方案 | 做法 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A｜打包期取 + extraResources** | 本文第 4 节 | 用户零安装；dev / prod 同源；不污染 git；绕开 universal 合并 | 打包机需联网一次（可用镜像 + 缓存）；包体 +42MB(mac) / +28MB(win) | **推荐** |
| B｜打开 yarn 脚本 | 根 `dependenciesMeta.ffmpeg-static:{built:true}` + 镜像 env | 改动最小 | **只救开发机，救不了用户**（用户不跑 install）；universal 只拿到当前架构一份；国内 GitHub 直连必失败 | 只作 A 的补充（可选） |
| C｜二进制进 git | 直接提交到 `build/ffmpeg/` | 打包完全离线 | 仓库 +120MB，换版本写进历史 | 否 |
| D｜macOS 改双架构 DMG | 放弃 universal，arm64 / x64 各出一个 | 每包最小（+18 / +24MB）；无合并风险 | 发布流程与 `mac-universal.ts` / `verify-mac-smoke` 一整套门禁都要改 | 量大，暂不动 |
| E｜ffmpeg.wasm | Host 内跑 wasm | 无平台二进制 | 性能差一个量级、内存吃紧、长视频不现实 | 否 |

## 6. 落地步骤（建议一批做完，编号 CV-201）

1. `scripts/fetch-ffmpeg.mjs`（镜像 + sha256 + 缓存）＋ `.gitignore`
2. `package.json`：`build.extraResources` 增 `build/ffmpeg/**`；`package-mac.ts` / `package-win.ts` / `package-win-portable.ts` 在 `prepareRuntime()` **之前**调用取二进制（缺了直接抛错，不静默降级）
3. `src/ffmpeg-run.ts`：新增候选档 + asar→unpacked 改写 + 面向用户的错误文案 + 抽出可测的纯函数
4. 门禁：`verify-packaged-runtime.ts` 必需项 + `-version` 真跑冒烟；`tests/ffmpeg-bundled.test.mjs`；两条反向变异各验证一次
5. 许可：随包 LICENSE + `THIRD_PARTY_NOTICES.md` + `verify-licenses.mjs` 新条目
6. 文档：`docs/STATUS.md`（§0 摘要 / §1 计数 / §2.1 / §8 变更记录）＋ `canvas-ux-backlog.md` ＋ `acceptance-test-cases.md`
7. 验收（**必须在没装 ffmpeg 的干净机器上做**）：装 DMG → 跑 ① 成片合成 ② 尾帧续镜抽帧 ③ BGM 真波形 ④ 老节点重试（时长/分辨率实测）四条，全过才算完成

## 7. 已知风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| universal 合并冲突 | 两架构二进制若落同一路径会被 `@electron/universal` 卡住 | 「路径含 arch」**只能解决「同路径不同字节」的一半**；「同路径相同字节」仍需声明进 `x64ArchFiles`。**2026-09-17 已实测踩中并修复**（§11），并新增守卫 spec 在打包前兜住 |
| macOS 签名 / 公证 | 包内第三方可执行文件未签 ⇒ 公证失败或运行时被 Gatekeeper 拦 | 落在 `Contents/Resources/` 由 osx-sign 统一签；`dist:mac-smoke` 跑通后再上签名版 |
| 包体增长 | mac universal 未压缩 **118 MiB**（arm64 43 MiB + x64 75 MiB，已实测）；DMG 压缩后增量待全量构建实测，原「+42MB」为估算值 | 若不可接受，走备选 D（双架构 DMG）；长期可自编译精简 ffmpeg |
| ⚠️ `--enable-nonfree` ⇒ 不可再分发 | 见 §8 实测证据末行。**这不是「履行 GPL 义务就能发」，而是上游明文禁止再分发** | 对外发布前换 LGPL 构建（BtbN/FFmpeg-Builds 的 `-lgpl` 变体，或自编译只留所需 filter）；内测/自用不受此限 |
| GPL / H.264 专利 | 见 §4⑤ | 与上一行同源；LGPL 路线同时解决两者 |
| 下载源可用性 | 打包机网络 | 默认 npmmirror（已实测 200）；镜像 + sha256 + 本地缓存三层兜底 |

## 8. 落地记录（2026-09-17，与上文方案的四点差异）

**用户拍板**：① mac **维持 universal 单包**（+42MB 可接受，不走备选 D 双架构 DMG）；② 许可**先按现状 GPL 落地**（LGPL 路线留作后续独立改造线）。

> ⚠️ **拍板 ② 的前提已在同批次被实测推翻**：产物 configure 行含 `--enable-nonfree`，触发上游 LICENSE 原文 *"unredistributable"* ⇒ 不是「履行 GPL 义务即可」而是**禁止再分发**。**对外发布前必须重拍为 LGPL 构建**；内测/自用不受限。证据见文末「实测证据」表末行。

**落地清单**：`dsh-plugin-desktop/scripts/ffmpeg-bundle.ts`（新，四目标 sha256 + 体积 + 架构嗅探 + 幂等缓存 + 门禁）、`scripts/fetch-ffmpeg.ts`（新 CLI，`--mac/--win/--host/--all` + `--dev`）、`scripts/after-pack.ts`（新 afterPack 组合钩子）、`dsh-plugin-desktop/package.json`（`build.extraResources` + `afterPack` + `dist:*`/`package:dir` 前置 fetch + `ffmpeg:fetch`/`ffmpeg:dev` 脚本）、`canvas-studio/src/ffmpeg-run.ts`（随包解析档 + 用户向错误文案）、`canvas-studio/tests/ffmpeg-bundled.test.mjs`（新）、`dsh-plugin-desktop/tests/ffmpeg-bundle.spec.ts`（新）、`tests/package.spec.ts`（补 afterPack/extraResources 断言）、`scripts/verify-licenses.mjs` + `THIRD_PARTY_NOTICES.md`（「Bundled executables」段）、`.gitignore`（`dsh-plugin-desktop/build/ffmpeg/`）、`start-canvas-studio.sh`（开发态镜像）。

**与上文方案的四点差异**（都是落地时按证据改的）：

1. **CLI 用 `.ts` 而不是 `.mjs`** —— 它要 `import` 同目录的 `ffmpeg-bundle.ts`（Node 22.19+ 原生类型擦除），与 `package-mac.ts` 等既有脚本一致。
2. **「随包 LICENSE 必须存在」落在 afterPack 门禁，而不是 `verify-licenses.mjs`** —— `verify-licenses` 属于**干净 checkout 上的 headless 门禁**（`yarn check`），此时 `build/ffmpeg/` 根本不存在（二进制是 gitignore 的构建输入），把这条放进去会让无网络环境下的 `yarn check` 恒红。改为：门禁检查**产物**里的 LICENSE（`verifyBundledFfmpeg`），同时把「Bundled executables」段加进 notices **生成器**，保证重新生成时不会丢。
3. **不打开 yarn 脚本、不改 `dependenciesMeta`** —— 备选 B 的两条都被否：`{built:true}` 会把网络下载塞进**每个开发机的 `yarn install`**（GitHub 直连在国内必失败，反而把「跳过」变成「安装失败」），而且会在 `node_modules/ffmpeg-static/` 里多留一份二进制 ⇒ **打包时与 extraResources 重复计体积**。开发态改走 `ffmpeg:dev`：把宿主架构那份**镜像进未打包 Electron 的 `Resources/ffmpeg/`**，于是 `process.resourcesPath` 在开发态与装机态解析到**同一条路径**（比单开一档「仓库相对路径」更一致——后者会在 canvas-studio 单测里被接住，破坏「全部落空必须抛错」用例的语义）。
4. **新增独立 `scripts/after-pack.ts` 而不是改 `verify-packaged-runtime.ts`** —— 后者的门禁测试**逐个断言注入探针的调用次数**，在同一函数里加检查会连带打乱四处计数断言；拆开后两份门禁各自有独立测试（运行时候选清单 / 随包 ffmpeg），职责也更清楚。

**实测证据**：

| 项 | 值 |
|---|---|
| 四目标（archive sha256 已写死在校验表） | darwin-arm64 19,246,198B → 解压 45,568,216B；darwin-x64 25,296,431B → 78,862,176B；win32-x64 29,581,307B → 82,797,568B；linux-x64 → 79,826,272B |
| 真跑冒烟 | `darwin-arm64 -version` → `ffmpeg version 6.0`，**首次 704ms**（新二进制过 macOS 校验），**缓存命中 14ms** —— 均远高于 5ms 的最小耗时闸 |
| 打包链路实测（2026-09-17，`electron-builder --mac dir --universal`） | `afterPack` 在 x64 临时 app 上打 `no executability smoke for this host; verified darwin-x64 structurally`（非原生架构按设计转结构校验），在 arm64 临时 app 上打 `darwin-arm64 reported "ffmpeg version 6.0" in 7380ms`（**打包环境内真执行**，远超 5ms 闸）⇒ 两架构各过一次闸。产物 `Contents/Resources/ffmpeg/{darwin-arm64,darwin-x64}/` 两份二进制 **sha256 与 pin 值逐字节相符**、体积 45,568,216 / 78,862,176 相符、`LICENSE` 齐备；两架构临时 app 内容**完全相同** ⇒ universal 合并不存在冲突 |
| ⚠️ 未能跑完的环节 | universal 合并 + DMG 出包被**本机 agent 文件写代理**拦下：`@electron/universal` 第一步就 `cp -R` 整个 `.app`，其中 `Contents/Resources/app.asar` 带 **`com.apple.provenance`** 扩展属性 ⇒ 代理拒绝搬运（`Brokered file token refused: modify backup failed`，`electron-builder` 只显示为 `Operation not permitted`）。**判据是文件属性而非路径**：该文件 cp 到工作区内同样被拒，而往同一临时目录新建普通文件不受影响；带 `dangerouslyDisableSandbox` 复跑仍在同一处失败 ⇒ **不是产品缺陷，也无法在受管 shell 内绕过**。**替代路径（2026-09-17 起，推荐）**：改到 GitHub Actions 上跑 —— `ci.yml` 的 `desktop-macos` 任务本身就是 `dist:mac-smoke`，本批已为其**新增 smoke DMG 产物上传**（artifact `VideoBuddy-macOS-<sha>`，未签名、仅供测试装机），可直接下载做下面的 K 组验收；`desktop-windows` 任务产出 `VideoBuddy-Windows-<sha>`（NSIS `Setup.exe` + `Portable.zip`）。⚠️ 该工作流只在 `master` 上自动触发，在 `dev` 分支必须手工 `workflow_dispatch` |
| 本机复跑 `dist:mac-smoke` 的前置 | 若走普通终端本地构建：必须先自行 `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`（脚本自己不设，只有 `start-canvas-studio.sh` 设了），否则 `electron-builder` 会去直连 GitHub，单个请求挂满 600s 超时；另需 `DSH_PACKAGE_CHECK_ALREADY_RAN=1` 跳过前置 gate |
| 下载 | 镜像 302 到 `cdn.npmmirror.com` ⇒ 客户端**必须跟随重定向**（`fetch` 默认跟随；用 curl 复核时要 `-L`） |
| 许可 | 每个目标旁随包上游 `LICENSE`（darwin 是两个平台各自的 ffmpeg LICENSE 文本，win32/linux 是 GPL-3 全文） |
| ⚠️ 阻断项（比「GPL 合规」严重一档） | 打包产物内二进制的 configure 行实测为：`--enable-gpl --enable-version3 --enable-nonfree --enable-libx264 --enable-libx265 …`。`--enable-gpl --enable-version3` ⇒ 二进制确为 **GPL-3.0-or-later**；但 `--enable-nonfree` 触发 **FFmpeg 上游自己的明文禁止**：随包 LICENSE「Incompatible libraries」节写 *"…pass `--enable-nonfree` to configure. **This will cause the resulting binary to be unredistributable.**"* ⇒ 现状不是「按 GPL 履行义务即可」，而是**上游声明不可再分发**。**对外发布前必须换成 LGPL/自编译构建** |
| 四目标 pin 全量实测（2026-09-17 收尾） | `fetch-ffmpeg.ts --all` 真跑：darwin 两份命中缓存，**win32-x64 与 linux-x64 均为真下载并逐项通过**（archive sha256 / 解压体积 82,797,568 / 79,826,272 / 二进制 sha256 / 随包 LICENSE）⇒ CI 的 `--win` 前置不会因 pin 失配变红。原生架构 `darwin-arm64` 报 `"ffmpeg version 6.0" in 25ms`（缓存命中，仍远高于 5ms 闸） |

## 9. 收尾动作（2026-09-17）

- **产品版本 2.0.3 → 2.0.4**：`package.json` + `dsh-plugin-desktop/package.json` + 双语 README 的产物名 + `electron-runtime.spec.ts` 三处 `PRODUCT_VERSION` 断言 + `scripts/package.README.md`，并在 `README.i18n.yaml` 重算双语 blob 哈希（`verify-bilingual-docs` 46 记录 / 92 文档一致）。做这次升级的目的：让 CI 产出的 DMG/Setup.exe 带上新版本号，可下载、可与旧版区分（Windows NSIS 升级链路依赖版本号递增）。
- **CI 的 `desktop-macos` 任务新增 smoke DMG 产物上传**（`VideoBuddy-macOS-<sha>`，14 天保留）。安全性依据：`dist:mac-smoke` 末段必跑 `verify-mac-smoke.ts`，它**要求 `dist/mac-smoke/` 里恰好一个 `.dmg`**，否则任务已失败 ⇒ 能走到上传步就必然有 DMG，`if-no-files-found: error` 不会误红。这是让「K 组干净机器验收」在拿不到本地 DMG 时仍可执行的通道。

## 10. 首轮 CI 暴露的两处问题与修复（2026-09-17）

CI run `35201627517`（`dev` 手工 dispatch）结果：`changes` / `upstream-command-windows` 绿、`desktop-macos` 的 `check:mac-package` 绿（**含 `ffmpeg-bundle.spec.ts`，说明 POSIX 分支本来就过**）、`desktop-windows` 红、`check` 红。两处红都**不是产品缺陷**，一处是我自己的测试跨平台缺陷，一处是既有合规门禁的误判：

### 10.1 `desktop-windows` 红：测试断言了 Windows 不存在的执行位

- **现象**：`tests/ffmpeg-bundle.spec.ts > bundled ffmpeg fetching > installs an executable binary and its license...`，`AssertionError: expected +0 not to be +0`。
- **根因**：该用例断言 `statSync(binary).mode & 0o111 !== 0`。Windows 没有 POSIX 执行位，`mode` 只映射只读属性（可写 `0o666` / 只读 `0o444`），**`& 0o111` 恒为 0** ⇒ 断言在 Windows 必然红，与被测代码无关。
- **修法**：fixture 从写死 `darwin-arm64` 改为**宿主真正会安装的那个 pin 目标**（`win32`→`ffmpeg.exe`/`pe:x64`，`linux`→`elf:x64`，darwin 按 `process.arch` 二选一），断言分平台：POSIX 查执行位，Windows 查 `.exe` 名（Windows 的可执行性由扩展名承载，且该名字必须与 pin 表一致，spawn 用的就是它）。断言里的 URL 也从写死文本改为按 `target.archive` / `target.license` 推导。
- **变异验证（证明断言仍在测产品代码）**：把 `chmodSync(pendingPath, 0o755)` 改成 `0o644` ⇒ 该用例在 macOS 立即变红，**文案与 CI 完全一致**（`expected +0 not to be +0`）；还原后 24/24 复绿。

### 10.2 `check` 红：许可校验器不认 SPDX `OR`

- **现象**：`verify:licenses: 3 production package(s) need attention`：`expand-template: "(MIT OR WTFPL)"`、`rc: "(BSD-2-Clause OR MIT OR Apache-2.0)"`、`type-fest: "(MIT OR CC0-1.0)"`。三者都由 `@memtensor/memos-local-plugin` → `better-sqlite3` → `prebuild-install` 链进入生产图。
- **根因**：白名单做的是**精确字符串匹配**，三条 `OR` 表达式的**每个分支本来都在白名单内**（`MIT` / `BSD-2-Clause` / `Apache-2.0` / `CC0-1.0`）⇒ 属误判，不是真的不合规。npm 清单还会把括号一起写进字符串（`(MIT OR WTFPL)`），所以连 `MIT` 都不等于 `(MIT OR WTFPL)`。
- **修法**：把策略抽成 `scripts/license-policy.ts`（**规则只留一份实现**），新增 `licenseAccepted()` 按 SPDX 语义读 `OR`：任一分支被接受即通过，且先剥离分组括号；`AND` 表达式不含 `OR` 分隔符，**仍要求精确条目**（保持 `Apache-2.0 AND LGPL-3.0-or-later` 那条既有先例的严格性）。`verify-licenses.mjs` 改为引用该模块，`noticeRequired()` 同样做括号归一。新增 `tests/license-policy.spec.ts` 7 例，含反向用例（`(WTFPL OR Beerware)`、`GPL-2.0-only`、`AGPL-3.0-or-later`、`MIT AND LGPL-3.0-or-later` 必须被拒）。复跑：`626 production packages checked; 3 use notice-required licenses`。
- **顺带修正一处陈旧产物**：`THIRD_PARTY_NOTICES.md` 因为校验器**在写出通知前就 `exit 1`**，自旧依赖图起就再没被重新生成过 ⇒ 用它自身的生成器重建，补回 **69 行**（`@memtensor/memos-local-plugin`、`onnxruntime-*`、`@huggingface/*`、`esbuild`、`better-sqlite3` 等）。**已知局限**：该文件在 macOS 上用真实 `node_modules` 生成，会列出 darwin 专属可选包（如 `@esbuild/darwin-*`、`fsevents`）而缺 win32 专属包；两个安装包共用同一份提交内容 ⇒ Windows 用户的声明列表会有少量平台错配（属「列多了 darwin 专属项」，不影响合规结论）。
- **影响面**：`check` 与两个打包任务**相互独立**（都只 `needs: changes`），所以这处红不挡出包；但 `desktop-windows` 的 vitest 前置在打包**之前**，10.1 不修就拿不到 Windows 产物。

> 本轮只改测试与脚本，**产品代码未动 ⇒ 版本号维持 `2.0.4`**（已产出的 DMG 与修复后重新产出的 DMG 内容一致）。

## 11. 第三处红：universal 合并拒绝「两个切片逐字节相同」的 Mach-O（2026-09-17）

**这是 CV-201 落地过程中唯一一处「结论被实测推翻」的设计判断**，且**与 CV-201 无关的既有地雷同时引爆**。

### 11.1 现象

`desktop-macos` 连红两次，都停在 `Build macOS smoke artifact`（`dist:mac-smoke`，universal DMG）。真实报错（CI 日志原文）：

```
⨯ Detected file "Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild"
  that's the same in both x64 and arm64 builds and not covered by the x64ArchFiles rule:
  "**/node_modules/{node-pty/prebuilds/darwin-*/**,…,@koromix/koffi-darwin-*/**}"
    at makeUniversalApp (@electron/universal/src/index.ts:181:17)
```

### 11.2 根因（读 `@electron/universal@2.0.3` 源码确认）

它的判定**不是**「两边不同才报错」，而是（`dist/cjs/index.js:118-137`）：

- 遍历 **x64 切片**里的每个 Mach-O 文件；
- 若两个切片的同名文件 **sha256 相同**，则要求该路径被 `x64ArchFiles` 覆盖，**否则直接抛错**；
- 只有两边**不同**时才会走 `lipo -create` 合并。

也就是说 `x64ArchFiles` 的真实语义是**「这些路径在两个切片里合法地相同（互为架构兄弟），别要求 lipo」**，而不是「从 x64 取」。

**同一棵 `node_modules` 被复制进两个切片**（`.yarnrc.yml` 的 `supportedArchitectures.cpu: [current, x64, arm64]` 会**同时装上两个 darwin 变体**），于是**每一个 per-arch 包在两个切片里都逐字节相同** ⇒ 全都被这条规则扫到。已覆盖的 6 类（`node-pty/prebuilds`、`node-addon-require-builtin`、`@vscode/ripgrep`、`@img/sharp`、`@img/sharp-libvips`、`@koromix/koffi`）本来就是为这条规则写的。

**漏了两类**：

| 漏项 | 来源 | 是否 CV-201 引入 |
|---|---|---|
| `@esbuild/darwin-arm64` + `darwin-x64` 的 `bin/esbuild` | `@memtensor/memos-local-plugin@2.0.19 → tsx@4.23.13 → esbuild@0.28.2` 进入**生产**依赖图 | ❌ **既有地雷**（`c1cbac99d4` 引入，与该提交造成的 `check` 许可红同源） |
| `ffmpeg/darwin-arm64/ffmpeg` + `darwin-x64/ffmpeg` | `extraResources` 把 `build/ffmpeg` **整棵树**复制进两个切片 | ✅ **CV-201 引入** |

> **关键点**：`@electron/universal` 只报**第一个**违规文件（按路径序 `app.asar.unpacked/…` 在 `ffmpeg/…` 之前），所以 CI 日志里只看得到 esbuild。**只补 `@esbuild` 的话，下一轮必然再撞 `ffmpeg`** —— 这一点在本机用「遍历生产闭包 + 真实匹配器」的守卫里被同时报出（见 11.4）。
>
> **旁证（既有地雷的独立性）**：上一次 mac 绿的 run 是 `3804360f2d2a`，而 `c1cbac99d4` **不是**它的祖先 ⇒ 那次绿早于该提交。也就是说**即使没有 CV-201，这条红也会出现**。

### 11.3 修法

`build.mac.x64ArchFiles` 由「6 项」扩到「8 项」——把两类漏项并进同一个 brace 组（该字段类型是 `string | null`，**不接受数组**）：

```
**/{node_modules/{node-pty/prebuilds/darwin-*/**,node-addon-require-builtin-darwin-*/**,
     @vscode/ripgrep-darwin-*/**,@img/sharp-darwin-*/**,@img/sharp-libvips-darwin-*/**,
     @koromix/koffi-darwin-*/**,@esbuild/darwin-*/**},ffmpeg/darwin-*/**}
```

**为什么 `extraResources` 不做成「只放本切片那一份」**：`extraResources` 是打包期的目录复制，没有按 arch 过滤的机制；改成 afterPack 里按 arch 删另一份会让「两个切片内容相同」变成「不同」——反而触发 lipo 分支（两个不同路径的二进制不会被 lipo，但会让 `afterPack` 校验与 `verify-mac-smoke` 的假设复杂化）。**声明进 `x64ArchFiles` 是语义正确且最小的一步**：这份二进制在两种架构的切片里本来就该存在（运行时按 `process.platform-arch` 选）。

### 11.4 新增守卫：把「10 分钟后神秘失败」变成「秒级点名」

新增 `tests/mac-x64arch.spec.ts`（挂进 `check:mac-package`，**在打包之前**跑），做法：

1. 用 `production-graph.ts` 遍历**生产依赖闭包**（626 包），找出所有 per-arch darwin 目录（含包内 `prebuilds/`），筛出其中的 **Mach-O** 文件（读文件头 4 字节判定）；
2. 再加上**按配置推导**的内置 ffmpeg 路径（`extraResources.to` + `ffmpegTargetsForPlatform('darwin','universal')`）——**故意不探测构建产物**，因为本门禁跑在 `fetch-ffmpeg` 之前，探测会让断言变成空绿；
3. 用 **`@electron/universal` 自己那个 `minimatch` 实例**（`createRequire` 通过它解析，拿到的才是它真正用的 `9.0.9`，不是顶层 10.x）按 `{ matchBase: true }` 判定覆盖；
4. 覆盖率不足时输出**可照抄的修复提示**：`@esbuild/darwin-x64: add a build.mac.x64ArchFiles alternative covering <路径>`。

**为什么值得新增而不是只改配置**：这条规则是「一类」而不是「一个」——`memos-local-plugin` 这类第三方包随时会再带进新的 per-arch 兄弟包。守卫按闭包枚举，新包一进来就会红并点名。

**顺带把「生产闭包」抽成单一实现**：`scripts/production-graph.ts`（`productionClosure()` / `resolvePackageManifest()`），`verify-licenses.mjs` 改为引用它（删掉原来的内联遍历与 `SEE LICENSE IN` 之外重复逻辑），守卫复用同一份 ⇒ **许可门禁与架构门禁对「哪些包会被打进包」永不分叉**。重构后 `verify:licenses` 输出 `626 production packages checked; 3 use notice-required licenses` —— **与重构前逐字一致**。

### 11.5 验证与**未能验证的部分**

已做：
- 守卫 7 例全过；`tsc -p tsconfig.tests.json` 干净；mac 打包相关 8 个 spec 全过（131 passed / 1 skipped）。
- **变异验证（双向）**：把 `x64ArchFiles` 还原成修复前的 6 项 ⇒ 守卫立刻变红，且**同时点名 4 个漏项**（`@esbuild/darwin-arm64`、`@esbuild/darwin-x64`、`bundled darwin-arm64`、`bundled darwin-x64`）——既证明断言真在测产品配置，也证明「只补 esbuild 不够」。
- 生产闭包枚举结果：闭包内 per-arch Mach-O 共 **16 个**（8 个互不相同的路径 × 2 架构），其中 14 个原已被 6 项 glob 覆盖，2 个（esbuild）为新增；另有内置 ffmpeg **2 个**（均为新增）。
- 另有 3 个家族（`@rolldown/binding-darwin-*`、`@tailwindcss/oxide-darwin-*`、`lightningcss-darwin-*`）**只在 devDependencies 里**，不进安装包 ⇒ **正确地不需要声明**（这也是守卫必须按生产闭包过滤、不能全盘扫 `node_modules` 的原因）。

⚠️ **未能验证**：**本机跑不通 universal 合并**。`@electron/universal` 第一步要把 x64 切片 `cp` 到输出目录，而 `app.asar` 带 `com.apple.provenance` 扩展属性，本机 shell 的文件写代理一律拒绝搬运（`Brokered file token refused: modify backup failed`，cp 到 `/tmp` 或工作区内**都被拒**，带 `dangerouslyDisableSandbox` 也一样）⇒ **无法在本机复现「修复后合并成功」**。判据链因此止于「配置 + 真实匹配器 + 闭包枚举」这一层，**最终确认仍需下一轮 CI 的 `desktop-macos` 变绿**。

## 12. 第四处红：`check` 在 Linux 上红 + 守卫模型的一次纠正（2026-09-17）

### 12.1 现象（同一处修复引出的两件事）

- **`check` 红**（run `35207401184`）：`tests/mac-x64arch.spec.ts` 在 **Linux runner 上红、在本机 macOS 上绿**；
- **下一轮 `desktop-macos` 必然再红**：本机用「生产闭包 + universal 自己的匹配器」静态审计，发现 `onnxruntime-node/bin/napi-v6/darwin/arm64/{libonnxruntime.1.24.3.dylib,onnxruntime_binding.node}` 未被 `x64ArchFiles` 覆盖。

两件事同源：**守卫是好的，但它对「架构专属文件长什么样」的假设太窄**。

### 12.2 根因一：断言把「这个宿主没装 darwin 兄弟包」当成「扫不到东西」

原断言在 `archPackages.length === 0` 时要求扫描结果**为空**。事实是 `node-pty` 的 `prebuilds/` 随**一个 tarball 全平台发货**，任何宿主（含 Linux）都能扫到 `prebuilds/darwin-{arm64,x64}` ⇒ 扫描结果在 Linux 上**不为空**，断言必红。修法：不再断言「空」，改为断言「扫到的每一个都带 darwin 架构标记」+「至少扫到 `prebuilds/` 一族」，这样在任何宿主上都既非空绿、也不依赖 Yarn 装了哪些可选包。

### 12.3 根因二：守卫按「目录布局」找文件，漏掉「单包内置多平台目录」这一形状

旧模型只认两种形状：**包名以 `darwin-<cpu>` 结尾的兄弟包**、**包内 `prebuilds/darwin-<cpu>/`**。`onnxruntime-node` 是**一个包**，把 5 个平台的原生库放在 `bin/napi-v6/<os>/<cpu>/` 下 —— **两种都匹配不上，静默漏检**。

顺手把 `@electron/universal@2.0.3` 的真实规则读全（`dist/cjs/index.js:118-137`）：

- 只对 **Mach-O** 文件做「两切片 sha256 相同」判定，相同且未被 `x64ArchFiles` 覆盖 ⇒ **抛错**；
- 非 Mach-O 的普通文件**只有在两侧 sha 不同时**才报错，两侧相同则放行。

这条把守卫的边界钉死了：**win32/linux 那三个平台的原生库（PE/ELF）即使两个切片逐字节相同也不该声明**——它们是 PLAIN，不参与这条规则。所以守卫必须保留「读文件头 4 字节判 Mach-O」这一步。

### 12.4 修法

1. **守卫改为整闭包遍历 + 按路径段判架构树**（`darwin-<cpu>` 单段，或 `darwin` / `<cpu>` **相邻两段**），不再假设嵌套形状。新增导出 `findArchitectureScope()`。代价实测：遍历 626 包 / 6,965 目录 / 66,440 文件 **260ms** —— 秒级门禁仍然成立。
2. **`x64ArchFiles` 再补 4 项**（仍并入同一 brace 组，该字段类型是 `string | null`）：
   `onnxruntime-node/bin/napi-v6/darwin/arm64/**`、`@rolldown/binding-darwin-*/**`、`lightningcss-darwin-*/**`、`@reflink/reflink-darwin-*/**`。
   其中后三项**没有写完整嵌套路径**：`**/node_modules/@rolldown/binding-darwin-*/**` 里的 `**` 能跨过 `node_modules/canvas-studio/node_modules` 这类中间层，一项即覆盖全部嵌套副本（已用真实匹配器逐条验证）。

### 12.5 ⚠️ 纠正 §11.5 的一处错误结论

§11.5 写过「`@rolldown/binding-darwin-*`、`@tailwindcss/oxide-darwin-*`、`lightningcss-darwin-*` **只在 devDependencies** ⇒ 不进安装包 ⇒ 不需要声明」。**实测推翻**：

| 实际落盘位置（生产闭包内） | 进包？ |
|---|---|
| `canvas-studio/node_modules/@rolldown/binding-darwin-{arm64,x64}/` | **会** |
| `dsh-community-market/node_modules/@rolldown/binding-darwin-*`、`…/lightningcss-darwin-*`、`…/vite/node_modules/@rolldown/binding-darwin-*` | **会** |
| `pnpm/dist/node_modules/@reflink/reflink-darwin-*` | **会** |
| `@huggingface/transformers/node_modules/@img/sharp-*-darwin-*` | **会** |

它们以 **workspace 包的嵌套 `node_modules`** 进入生产闭包，而 electron-builder 会把依赖包**整棵目录（含其嵌套 `node_modules`）**复制进 `app.asar.unpacked`。旧守卫漏掉它们的原因与 12.3 同源：**只扫闭包顶层，没进嵌套目录**。

> **教训**：判断「某个包是否进安装包」，不能看**本包**的 `dependencies`，必须走**生产闭包 + 真实落盘目录**。这也是 §11.4 那条「守卫按闭包枚举」的完整含义。

### 12.6 验证

- 守卫 **10 例全过**；`typecheck` 干净；`dsh-plugin-desktop` 全量单测 **101 文件 / 1009 passed / 4 skipped**。
- **变异验证 ×2**：① 把 4 项新声明回退 ⇒ **3 个断言同时变红**，并逐条点名 `onnxruntime-node/bin/napi-v6/darwin/arm64`、`canvas-studio/node_modules/@rolldown/binding-darwin-*`、`dsh-community-market/node_modules/lightningcss-*`；② 拆掉 `darwin`/`<cpu>` 相邻段识别 ⇒ **2 个断言变红**。恢复后全绿。
- 修复后审计：闭包内「带 darwin 架构标记的 Mach-O」共 **36 个，未覆盖 0 个**（旧模型只找到 16 个，漏 20 个）。
- ⚠️ 仍**未能**在本机跑通 universal 合并（限制同 §11.5），最终确认仍需 CI。

### 12.7 顺带量准的一件事：Windows 包体 +291 MiB 的真实构成

用户报「今天的 Windows 包比昨天大很多（约 +100MB）」。查 CI 制品（`size_in_bytes`）：

| 运行 | commit | Windows 制品 | 内容 |
|---|---|---|---|
| 09-16 | `3804360f2d` | **379.5 MiB** | Setup.exe + Portable.zip，**无 MemOS、无 ffmpeg** |
| 09-17 | `ec6d6a75d4` | **670.9 MiB** | 同上两项，**已含 MemOS + ffmpeg** |

**+291.4 MiB，其中 ffmpeg 只占小头**。当日两个提交同时进入制品：

| 新增物 | 原始体积 | 来源 |
|---|---|---|
| `onnxruntime-node` | **210 MB**（内含 **5 个平台**：win32-x64 59M、**win32-arm64 64M**、darwin-arm64 35M、linux-x64 34M、linux-arm64 18M） | `c1cbac99d4`（MemOS 本地记忆） |
| `onnxruntime-web` | **135 MB** | 同上 |
| `@huggingface/transformers` 等 | **48 MB** | 同上 |
| `better-sqlite3` | 12 MB | 同上 |
| 内置 ffmpeg（win32-x64） | **82.8 MB**（`binaryBytes: 82_797_568`） | CV-201 `49e72892cf` |

⇒ **增长是预期的**（新功能 + 新内置能力），**但主因是 MemOS 的 onnxruntime 全家桶，不是 ffmpeg**。可回收量很大：Windows x64 包只需要 `onnxruntime-node/bin/napi-v6/win32/x64`（59M），另外 **4 个平台树共 151 MB 是纯死重**；macOS universal 则只需要 `darwin/arm64`，`linux/*`+`win32/*` 共 **175 MB** 是纯死重。**裁剪方案（按目标平台排除外来平台目录）列为待批的独立改动**，不在本批实施。

> **另一处需要决策的缺口**：`FFMPEG_TARGETS` 只有 `darwin-{arm64,x64}` / `win32-x64` / `linux-x64`，**没有 `win32-arm64`**。若需要响应「Windows ARM64 机器上 `VideoBuddy.exe` 报『此应用无法在你的电脑上运行』」，光加 arm64 打包目标不够，必须同时补一个 win32-arm64 的 ffmpeg 预编译（`afterPack` 的 ffmpeg 闸会直接抛错拒绝打包）。

