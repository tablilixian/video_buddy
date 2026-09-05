# deepseek-harness fork 维护手册

> 适用对象：需要改动 harness 上游包（`@deepseek-ai/dsh-client-ui-*` 等）的维护者。
> 现状基线：2026-09-05，附件旁路扩展点（`registerAttachmentDivert`）。
> 关联：`docs/plans/conversation-attachment-divert.md` §3.1–§3.2。

## 1. 三份「harness 代码」的关系（必读）

| 位置 | 是什么 | 生效性 |
| --- | --- | --- |
| `video_buddy/deepseek-harness/` | 官方 harness 的**源码镜像**（独立 git 仓库，remote 指向上游 `deepseek-ai/deepseek-harness`，无推送权限） | 不直接运行；改动的**正本/存档** |
| `dsh-plugin-desktop/node_modules/@deepseek-ai/dsh-client-ui-*` | npm 安装的构建产物（`lib/client.js` + `lib/types/*.d.ts`），桌面端浏览器实际加载的代码 | **运行时真正生效**；gitignore 内、**不入库** |
| `canvas-studio/node_modules/@deepseek-ai/dsh-*`（同名包，版本可能略旧如 0.1.0-rc.7） | 仅供 canvas-studio **类型引用**（import type） | 不含运行时代码，一般无需补丁 |

**版本对齐原则**：源码仓库 checkout 的 tag 必须与运行时 npm 包版本一致（当前均为 `dsh-v0.1.1-rc.2` / `0.1.1-rc.2`），这样源码改动与 dist 补丁才能一一对应。

## 2. 本地分支约定

- 上游 tag checkout 后处于 **detached HEAD**——在其上的提交没有分支指着，会丢。**任何 fork 改动必须先建本地分支**。
- 当前分支：`local/attachment-divert`（基于 tag `dsh-v0.1.1-rc.2`，提交 `fbcc4c785f`：ui-conversation 附件旁路扩展点正本）。
- 命名约定：`local/<主题>`。**不要推送到 origin**（那是上游官方库）。

## 3. 改动 harness 的标准流程

1. 确认 `deepseek-harness` 处于对应版本 tag 的本地分支上（`git log --oneline -1` 核对）。
2. 改源码（如 `packages/client/ui-conversation/src/client/service.ts`）。
3. **同步构建产物**（两选一）：
   - **首选**：依赖装得动时，`corepack pnpm@11.7.0 install` 后 `pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle`，把 `lib/` 整体拷贝覆盖 `dsh-plugin-desktop/node_modules/@deepseek-ai/dsh-client-ui-conversation/`；
   - **兜底**（本机 pnpm install 被 broker 拦截/进程被杀时适用）：对 `dsh-plugin-desktop/node_modules/.../lib/client.js` 直接做**等价手工补丁**，并同步 `lib/types/client/service.d.ts`；改完用 `cp lib/client.js /tmp/x.mjs && node --check /tmp/x.mjs` 验语法。
4. `dsh-plugin-desktop` 重新 build（`bash start-canvas-studio.sh` 完整模式即含此步）后生效。
5. **提交正本**到 harness 本地分支；主仓库（video_buddy）如有配套改动一并提交推送。

## 4. dist 补丁台账（当前存量）

| 补丁 | 位置 | 内容 | 重放入口 |
| --- | --- | --- | --- |
| 附件旁路扩展点 | `dsh-plugin-desktop/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/{client.js, types/client/service.d.ts}` | `ConversationController.registerAttachmentDivert` + `sendSession` divert 分流（详见下述源文件） | 正本：deepseek-harness 分支 `local/attachment-divert` 的 `packages/client/ui-conversation/src/client/service.ts`；重放即按 §3.3 兜底流程把该文件逻辑手工映到 dist |

> ⚠️ **任何 `yarn/pnpm install` 重装依赖都会冲掉 node_modules 补丁**。症状：对话贴图发送报「当前模型不支持图片」且画布不落节点（divert 未生效）。恢复 = 按 §3.3 重放。

## 5. 升级 harness 官方版本时（checklist）

1. `git fetch && git checkout <新tag> && git checkout -b local/<主题>`；
2. `git cherry-pick local/attachment-divert`（或手工 rebase 各 `local/*` 分支），解决冲突；
3. 重新构建该包（§3.3 首选路径），覆盖 `dsh-plugin-desktop/node_modules`；
4. 核对新版本 `sendSession` 签名/行为是否变化，必要时改 canvas-studio 侧 `divertAttachments` 适配；
5. 重跑验证链（DEV-WORKFLOW §三）+ 真机贴图发送冒烟。

## 6. 快速自检：dist 补丁是否还在

```bash
grep -c "registerAttachmentDivert" \
  dsh-plugin-desktop/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
# 输出 >= 1 即在；0 = 补丁已丢，按 §4 重放
```
