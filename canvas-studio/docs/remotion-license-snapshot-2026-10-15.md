# Remotion License 原文存档（REQ-034 留证）

> **存档日期**：2026-10-15
> **来源**：npm 包内 `remotion@4.0.535/package/LICENSE.md`（即**随包发布的那份**；同日从 npmmirror 取 tarball 解出，`remotion` latest = 4.0.535）
> **为何用包内这份**：`raw.githubusercontent.com` 与 `github.com` 直连超时（国内），而包内这份与安装到用户机器上的完全一致，作为"当时版本被 Free License 覆盖"的证据**更强**。
> **配套**：同 tarball 内另有 `THIRD_PARTY_LICENSES.md`（未存档，需要时可同法取出）。
> **用途**：devdoc §1.3「留证动作」；REQ-034 §四 NFR-1 的取证依据。

---

## 一、原文（逐字）

```markdown
# Remotion License

In Remotion 5.0, the license will slightly change. [View the changes here](https://github.com/remotion-dev/remotion/pull/3750).

---

Depending on the type of your legal entity, you are granted permission to use Remotion for your project. Individuals and small companies are allowed to use Remotion to create videos for free (even commercial), while a company license is required for for-profit organizations of a certain size. This two-tier system was designed to ensure funding for this project while still allowing the source code to be available and the program to be free for most. Read below for the exact terms of use.

- [Free License](#free-license)
- [Company License](#company-license)

## Free License

Copyright © 2026 [Remotion](https://www.remotion.dev)

### Eligibility

You are eligible to use Remotion for free if you are:

- an individual
- a for-profit organization with up to 3 employees
- a non-profit or not-for-profit organization
- evaluating whether Remotion is a good fit, and are not yet using it in a commercial way

### Allowed use cases

Permission is hereby granted, free of charge, to any person eligible for the "Free License", to use the software non-commercially or commercially for the purpose of creating videos and images and to modify the software to their own liking, for the purpose of fulfilling their custom use case or to contribute bug fixes or improvements back to Remotion.

### Disallowed use cases

It is not allowed to copy or modify Remotion code for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion.

### Warranty notice

The software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the author or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

### Support

Support is provided on a best-we-can-do basis via GitHub Issues and Discord.

## Company License

You are required to obtain a Company License to use Remotion if you are not within the group of entities eligible for a Free License. This license will enable you to use Remotion for the allowed use cases specified in the Free License, and give you access to prioritized support (read the [Support Policy](https://www.remotion.dev/docs/support)).

Visit [remotion.pro](https://www.remotion.pro/license) for pricing and to buy a license.

### FAQs

Are you not sure whether you need a Company License because of an edge case? Here are some [frequently asked questions](https://www.remotion.pro/faq).
```

---

## 二、与原文档说法的**出入**（必须修正引用方式）

| 文档原话 | 许可原文实际情况 | 处置 |
|---|---|---|
| 「唯一禁区是**让用户上传自有 Remotion 代码到你的服务渲染**」 | **许可原文里没有这一条**。原文的 Disallowed 只有一条：**不得复制/修改 Remotion 代码以出售、出租、授权、再授权你自己的 Remotion 衍生品** | ⚠️ **该说法不能继续作为"已核事实"引用**。可能源自 FAQ 的某条解读或早期社区说法，**待核原始出处**；在核实前，文档应改为引用原文那条（禁转售衍生品），并注明"用户上传"属**待核** |
| 「两人公司 → Free 覆盖，商业使用零费用」 | **成立**：Eligibility 明确含"for-profit organization with up to 3 employees"；Allowed 明确含 "non-commercially or commercially" | ✅ 保持 |
| 「4 人及以上须 Company License」 | **成立**（同上 Eligibility 的反面） | ✅ 保持 |
| （未记录） | **⚠️ 新增风险项：Remotion 5.0 许可条款将有变动**（原文首行即声明，附 PR 3750 链接） | **新增**：接手方须在升 v5 前复核条款；建议把"升 Remotion 版本前先读 LICENSE.md"写进升级检查清单 |

> 对本项目的实际影响：我们做的是**自己写组件 + 自行服务端渲染**，既不转售 Remotion 衍生品、也不改变 Remotion 本体授权，落在 Allowed 范围内。**但"用户上传"这条禁区的表述需要更正**——它不该作为使用边界来宣讲。

---

## 三、复核方法（可重放）

```bash
# 取随包 LICENSE（无需 GitHub，走 npmmirror）
curl -sL -o /tmp/remotion.tgz \
  "https://registry.npmmirror.com/remotion/-/remotion-4.0.535.tgz"
tar -xzf /tmp/remotion.tgz package/LICENSE.md -C /tmp
# 或装好依赖后直接读 node_modules：
#   cat canvas-studio/.workbuddy/spike-remotion/node_modules/remotion/LICENSE.md
```
