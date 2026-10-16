# `assets/fonts/` —— 随包中文字体子集

REQ-034（代码驱动合成 / Remotion 路线 B-CSR）的中文兜底字体。**由构建脚本产出、产物入库**，
运行期由宿主只读路由 `/canvas-studio/remotion/fonts/<name>.woff2` 提供给客户端渲染进程。

## 文件

| 文件 | 说明 |
|---|---|
| `noto-sans-sc-400.woff2` | 常规字重子集（0.95MB，4374 字形） |
| `noto-sans-sc-700.woff2` | 粗体字重子集（0.98MB，4374 字形） |
| `OFL.txt` | SIL Open Font License 1.1 全文（源字体随附原文，OFL 要求随分发保留） |

族名 = **`Noto Sans SC`**（与 `src/remotion/fonts.ts` 的 `BUNDLED_FONT_FAMILY` 必须逐字一致，
由 `tests/remotion-fonts.test.mjs` 守住）。

## 来源与重建

```bash
node scripts/build-font-subset.mjs          # 重建（源字体已缓存则不重新下载）
node scripts/build-font-subset.mjs --print  # 只打印体积，不写盘
```

- **源**：Google Fonts 版 Noto Sans SC 静态 TTF，取自 `@expo-google-fonts/noto-sans-sc@0.4.4`
  （该包是 npm 上少见的**全量 TTF** 包；fontsource 系是 unicode-range 切片包，无全量文件、无法子集化）。
  脚本只取用到的两个字重，按 **pin 死的 URL + sha256 + 字节数**校验后落到 `.cache/font-source/`
  （不入库），因此**不把 91MB 的源包塞进 devDependency**，重建仍可复现、源被替换会立刻报错。
- **字表**：`scripts/font-subset-chars.txt` = GB2312 全集（一级 3755 + 二级 3008）+ ASCII 可打印
  + 常用中西标点/符号，共 **6962 字**（单行、去重、无换行）。
- **工具**：`subset-font`（harfbuzz WASM，devDependency）。
- **体积闸**：脚本内置「单文件 ≤2MB、合计 ≤3MB」（devdoc §8.3 第 5 条体积纪律）。实测合计 1.93MB。

## 许可与合规（OFL 的两个易踩点）

- `OFL.txt` 的首行是 **Adobe 的版权声明**（Noto CJK 与思源黑体同源，声明里含
  `with Reserved Font Name 'Source'`）——这是 OFL 要求**原样保留**的版权行，不是笔误。
- **为什么不随包思源黑体**：思源黑体的 OFL 带**保留字体名 `'Source'`**，子集属 OFL 定义的
  Modified Version，严格合规**必须重命名族名**；而 `subset-font` 改不了 `name` 表
  （实测 `preserveNameIds: []` 仍保留 nameID 0/1/4/6）⇒ 会留一笔发布前合规债。
  **Noto Sans SC 的族名本身不含 `'Source'`**（Google 的派生命名即合规改名）⇒ 无此债。
- ⇒ **对 Modifed Version 的处置**：本目录产物是 Noto Sans SC 的子集，族名保持
  `Noto Sans SC` 不变，满足 OFL 的命名条款；`OFL.txt` 随包分发满足许可随附条款。

## 为什么不走客户端 bundle 内联

客户端 bundle 已 8.6MB；把 ~2MB 字体 base64 内联进去（+2.7MB）只会拖慢加载，且
`tsdown` 处理大二进制不划算。走**宿主只读路由 + 同源 `@font-face`** 更省，也符合
devdoc §8.3 第 4 条的「同源」硬要求（跨源 `@font-face` 会静默 404 → 回退系统字体 → 中文观感事故）。
