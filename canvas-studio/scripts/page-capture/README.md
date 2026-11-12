# page-capture · 真实页面截图采集链（REQ-038 RQ-24）

> **定位**：素材供给的**上游** —— 「复刻真实页面」这一整类镜头的纹理来源。
> 产出直接可被 `image` / `assetGrid` / `image.camera` 消费；`layout.json` 的
> `layoutTable` 条目与 `layout_table` 工具同口径（画布百分比、x/y 中心）⇒ 下游零改动。

## 引擎（拍板）

需求文档写「走仓库既有 playwright 依赖」—— **实测仓库并无 playwright**。零新增依赖
纪律 ⇒ 默认引擎 = **系统 Chrome headless CLI**（macOS `/Applications/Google Chrome.app`
或 PATH 的 `google-chrome` / `chromium`）。用户环境装了 playwright 时可用
`--engine playwright`，能拿到**元素级坐标**（chrome 引擎的元素矩形来自 `--rects`
手工标注或后续用 `inspect_image` 量）。

## 用法

```sh
# 本地 dev server（合规闸只放行本地回环）
node scripts/page-capture/capture.mjs --url http://127.0.0.1:5173 \
  --out build/capture \
  --selectors '{"hero":".hero","sidebar":"aside.main"}' \
  --scale 2
# 产出：build/capture/page.png（2x 全页）+ layout.json + elements/（playwright 引擎时）

# 采集外网（必须显式确认可采集后放行 —— 机械闸，不是提醒）
node scripts/page-capture/capture.mjs --url https://example.com --allow-host example.com ...
```

## 合规闸（验收 4）

1. 非 `http(s)` 目标拒收；
2. 非**本地回环**（127.0.0.1 / localhost / ::1）目标必须显式 `--allow-host <host>`
   —— 把「采集前必须确认页面可采集（不含登录凭据 / 私有客户数据 / 未授权页面）」
   落成机械闸；`layout.json.compliance` 记录本次是否走的外网放行；
3. 工具本身不读 cookie / localStorage / token 环境变量。

## 确定性（验收 3）

同一页面两次采集 → `page.png` sha256 一致（已实测：3840×2160 两轮逐字节同；
`layout.json` 不含时钟字段）。页面自身含动态内容（随机 banner / 实时数据）时由
调用方保证页面稳定（dev server + 固定数据），这不是本工具能兜的。

## 产出消费链

```
page.png → (宿主资产目录) → manifest 的 image/assetGrid/logoWall 轨 src
layout.json.layoutTable[name] → layout_table 工具 write 进项目坐标表
elements/*.png（playwright 引擎）→ assetGrid 单元
```
