# vo-ad/vo-spot-30s · 口播广告信息流 14 秒模板

真人口播打底的信息流带货模板：**口播视频全屏 → 钩子大字 → 主张 → 三条卖点花字错峰 → 促销 + CTA**。
SFX 按花字节拍钉帧（impact/pop×3/chime），底部进度条，BGM 配乐位留给生成。

## 段落（帧 @30fps，共 420 = 14s）

| # | 帧 | 画面 |
|---|---|---|
| 1 | 0–84 | 口播视频起 + 全屏钩子大字（`maskReveal`）+ impact 钉帧 |
| 2 | 84–168 | 产品名（黄签）+ 一句话主张（大字）+ whoosh |
| 3 | 168–240 | 卖点 1 花字（黄底黑字，左）+ pop |
| 4 | 240–312 | 卖点 2 花字（白底黑字，右）+ pop |
| 5 | 312–342 | 卖点 3 花字（黄底，左）+ pop |
| 6 | 342–420 | CTA 大字 + 促销行 + chime；进度条走完 |

底部全程：口播字幕条（`captionText` 按行折句，随口播换行）。

## 槽位（10 个：9 个带缺省 + voVideo 必填）

`voVideo`（口播视频，**唯一必填**）/ `hook` / `productName` / `claim` /
`selling1~3` / `promoLine` / `cta` / `captionText`（多行字幕）。
全部 maxChars 见 `slots.json`，超限编译前拒收。

## 素材

- **口播视频**：真人素材必须用户提供（user 通道；AI 生成假人出镜是红线）。
  示例样片（Mixkit Free License，可商用）已下到 `build/vo-ad-sample/`——
  体验时拷进真机项目的资产目录，再把 `slots.voVideo` 指向它的同源 URL。
- **音效**：6 支全走包内音效库 `/canvas-studio/remotion/fx/`（`assets/audio/sfx/`，
  Mixkit 免费许可，含本模板扩充批 19 支），无需自备。
- **BGM**：`audio.json` 的 `bgm.prompt` 是配乐位 —— `scaffold_manifest({ bgmUrl })`
  先生成纯器乐再编入。

## 设计取舍

- 口播视频**不静音**：口播广告的人声就是主体（audio 构成里计 native 声）。
- `vo-dim` 全屏 24% 压暗：花字可读性的最低限度，不要调到 0.4+（口播人脸会闷）。
- 竖屏素材（720×1280）走 `cover` 居中裁切，两侧裁掉约 44% —— 拍的时候人放中间。
- 15s/30s 变长版：复制本目录改 `durationInFrames` 与段落帧位即可，槽位合同不变。
