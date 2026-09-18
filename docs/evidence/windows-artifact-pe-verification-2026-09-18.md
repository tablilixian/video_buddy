# Windows 产物 PE 机器类型校验补齐证据

## 结论

- 结果：通过。本批只增强校验链，不改打包配置、不改产品代码、不动产物本身。
- 范围：`dsh-plugin-desktop` 的 Windows 产物校验脚本与其单元测试；未修改 `deepseek-harness` 子模块或 DSH 底层。
- 起因：同事在 **Intel x64** 主机上安装新 Windows 包时遇到「没有与之关联的应用」（快捷方式）与「此应用无法在你的电脑上运行」（主程序，即 `ERROR_BAD_EXE_FORMAT`），需判定是否属于架构分发错误。
- 结论一：**不是架构分发错误**。本仓库 Windows 产物在配置层与构建层都是 x64 单一架构（见「架构证据链」），且仓库无任何 Release 资产可供误取。
- 结论二：原校验链只验到「是不是 PE 文件」，**不验 COFF 机器类型**。若将来误发 arm64/x86 镜像、或写出半截 exe，CI 仍会全绿。本批补齐该缺口。

## 架构证据链

| 层 | 位置 | 断言 |
| --- | --- | --- |
| electron-builder 配置 | `dsh-plugin-desktop/package.json` `build.win.target` | `{ "target": "nsis", "arch": ["x64"] }`，单一架构 |
| 打包主机闸 | `dsh-plugin-desktop/scripts/package-win.ts` `assertWindowsPackageHost()` | 非 `win32` 抛错；`process.arch !== 'x64'` 抛错 |
| 打包命令行 | 同文件 `packageWindowsArtifact()` | 显式传 `--x64`，另附 `--config.win.signExecutable=false`、`--config.npmRebuild=false` |
| 产物名闸 | `scripts/verify-win-installer.ts` / `verify-win-portable.ts` | 只接受 `VideoBuddy-<version>-x64-Setup.exe` 与 `VideoBuddy-<version>-x64-Portable.zip` |
| 本批新增 | `scripts/verify-win-installer.ts` | PE 内 COFF 机器类型必须落在允许集内（见「变更」） |

## 产物体积时间线（Actions 制品）

| 创建时间 (UTC) | commit | 制品 | 体积 |
| --- | --- | --- | ---: |
| 2026-09-16 04:58 | `3804360f2d` | `VideoBuddy-Windows-…` | 379.5 MiB |
| 2026-09-17 09:26 | `ec6d6a75d4` | `VideoBuddy-Windows-…` | 670.9 MiB |
| 2026-09-17 10:06 | `72f258d236` | `VideoBuddy-Windows-…` | 670.9 MiB |
| 2026-09-17 10:23 | `fffc4d0ed3` | `VideoBuddy-Windows-…` | 670.9 MiB |

`GET /repos/tablilixian/video_buddy/releases` 返回 0 条：仓库**没有发布过 Release**，因此同事手上的包只能来自 Actions 制品，不存在「带 arm64 资产的下载页」这一路径。+291.4 MiB 的增量来自 MemOS 引入的 onnxruntime 全家桶，与本批无关。

## 变更

- `scripts/verify-win-installer.ts`
  - 新增机器类型常量：`WINDOWS_PE_MACHINE_I386 (0x14c)`、`WINDOWS_PE_MACHINE_AMD64 (0x8664)`、`WINDOWS_PE_MACHINE_ARM64 (0xaa64)`，以及允许集 `WINDOWS_X64_HOST_EXECUTABLES`（x86 或 x64）与 `WINDOWS_APPLICATION_EXECUTABLES`（仅 x64）。
  - 新增 `readWindowsPeMachine()` 与 `describeWindowsPeMachine()`，失败信息直接写出观察到的架构，例如 `is arm64 (0xaa64), expected x64 (0x8664)`。
  - `assertPortableExecutableBuffer()` 与 `assertPortableExecutable()` 增加机器类型断言（默认要求 x64），并新增「签名存在但 COFF 头被截断」分支：`does not have a complete COFF header`。
  - 允许集按产物角色划分：NSIS 安装器桩是 32 位镜像 ⇒ x86 或 x64；`win-unpacked/VideoBuddy.exe` 必须为 x64。
- `scripts/verify-win-portable.ts`：便携归档内的 `VideoBuddy.exe` 显式按 x64 应用断言。
- `tests/verify-win-installer.spec.ts`、`tests/verify-win-portable.spec.ts`：夹具改为携带真实机器类型（安装器桩 x86、应用 x64），使允许集的**非对称性本身**成为被测对象；新增 arm64、x86、截断三类反例。

## 自动化回归

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| Windows 打包门禁单测 | `vitest run`（`check:win-package` 的 14 个 spec） | 14 文件 / **251 passed**、2 skipped |
| 类型检查 | `tsc -p tsconfig.json` + `tsc -p tsconfig.tests.json` | 双清零 |
| 变异验证 | `assertAllowedMachine()` 改为空操作 | **恰好 5 条反例变红**（arm64 应用 / arm64 安装器 / x86 应用 / 便携 arm64 / 便携 x86），其余保持绿 ⇒ 断言承重且边界精准；已还原并复验 13/13 绿 |

## 仍未证（本批不覆盖）

- CI **不启动 exe**，只做 PE 与打包结构校验，「装完能否跑起来」仍需真机 smoke。
- 同事手上那份文件的完整性（体积 / SHA-256 / 机器类型）无法从 CI 侧证明。本批只保证**我们发出的包是 x64**，不能替代对端取证；对端可用 PowerShell 读取 PE 机器类型自行核对（0x8664 = x64、0xaa64 = arm64）。
- 安装包未做 Authenticode 签名；SmartScreen 与企业安全软件行为不受本批影响。
- `2.0.4` 仍含跨平台原生库死重（Windows 侧约 151 MiB），裁剪方案未批、未处理。

## 基线

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-09-18（Asia/Shanghai） |
| 取证主机 | macOS 14.6，arm64 |
| 分支 | `dev` |
| 基线提交 | `b47c4f74e9` |
| Node.js | 本机 `v22.22.2`；CI `22.23.2` |
| 参考 Actions run | `35208792404`（`fffc4d0ed3`，`desktop-windows` 全绿） |
| DSH 子模块 | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，未修改 |
