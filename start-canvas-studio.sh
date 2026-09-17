#!/usr/bin/env bash
#
# start-canvas-studio.sh — 本地一键启动 VideoBuddy 验收 canvas-studio
#
# 用法：
#   bash start-canvas-studio.sh          # 完整启动：重建 canvas-studio + 桌面，再起 Electron
#   bash start-canvas-studio.sh --fast   # 不重建，直接启动已构建的桌面（需上次已 build 过）
#
# 关键说明：
#   - canvas-studio 的 lib 会打进 dsh-plugin-desktop 的落地包（lib/main.js），
#     根 dev/start 都不会自动 build canvas-studio。完整模式下先重建 canvas-studio，
#     再走桌面 dev（桌面 dev 自身会 build，把最新 canvas lib 一起编进去）。
#   - --fast 不做任何重建：直接 `yarn start`（桌面 start = 运行已构建的 lib/bin.js）。
#     若你刚改过 canvas-studio 源码，请用完整模式，否则改动不会生效。
#   - Electron 窗口弹出 = 验收环境就绪；关闭窗口即停止，终端 Ctrl+C 亦可。
#   - 若已有 Electron 窗口在跑，请先关闭再运行，避免重复启动。
set -euo pipefail

# 进入脚本所在目录（项目根），无论从哪调用
cd "$(dirname "$0")"

# 设置 Electron 镜像源，加速下载
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# 智谱（Zhipu / BigModel）LLM 凭据改为在应用内填写：启动后打开「设置 → 模型」，
# 找到 zhipu provider 卡片，在 API Key 框粘贴 Key 后点保存（写入凭据存储，不落明文）。
# 不再在此脚本硬编码 Key，避免个人密钥随仓库泄露；运行时 pi-ai 经 credentials 域解析
# settings.yaml 中 llm-pi-ai.providers.zhipu.apiKeyEnv(=ZHIPU_API_KEY) 完成鉴权。

echo "==> VideoBuddy 本地验收启动脚本"

# 0. 尽量加载 nvm 并切到 node 22（不强制，失败静默）
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

# 0.1 启用 corepack（持久化，重复执行无害）
corepack enable >/dev/null 2>&1 || true

# 0.2 node 版本检查：需要 ^22.19.0 或 >=24.0.0
NODE_VER="$(node -v | tr -d 'v')"
NODE_MAJOR="$(printf '%s' "$NODE_VER" | cut -d. -f1)"
NODE_MINOR="$(printf '%s' "$NODE_VER" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  echo "✗ 需要 node ^22.19.0 或 >=24.0.0，当前 $(node -v)" >&2
  echo "  请先执行：nvm use 22 （或任意 >=22.19 / >=24 的版本）" >&2
  exit 1
fi
echo "==> node $(node -v) 满足要求"

# 1. 初始化 upstream submodule（幂等：仅当 harness 未检出时）
#    只拉 deepseek-harness：skill 内容已是本仓 canvas-studio/skills/ 的手写源，
#    不再依赖任何上游 checkout（原 h3 子模块已于 2026-09-17 移除）。
#    判据用 package.json：子模块根没有 src/ 目录（源码在 apps/、packages/ 下），
#    原先判 src/index.ts 恒为真 → 每次启动都白跑一次联网拉取。
if [ ! -f deepseek-harness/package.json ]; then
  echo "==> 初始化 upstream submodule（首次需联网，约数分钟）..."
  git submodule update --init deepseek-harness
fi

# 2. 安装 workspace 依赖（幂等：仅当依赖未安装时）
#    判据用 Yarn 4 的 node_modules/.yarn-state.yml：node-modules linker 下根目录
#    不会被创建 node_modules/.bin（它只出现在各 workspace 内），原先判 .bin 恒为真
#    → 每次启动都白跑一次 install（--immutable 还要求 yarn.lock 与清单完全同步）。
if [ ! -f node_modules/.yarn-state.yml ]; then
  echo "==> 安装 workspace 依赖（首次较重，需联网）..."
  corepack yarn install --immutable
fi

# 2.1 内置 ffmpeg（开发态镜像，幂等）
#     app 的抽帧 / 成片合成 / 真波形都靠内置 ffmpeg（CV-201）。打包产物由
#     electron-builder 的 extraResources 把 build/ffmpeg/<平台>-<架构>/ 带成
#     Contents/Resources/ffmpeg/<平台>-<架构>/；开发态这里把宿主架构那份**镜像进
#     未打包的 Electron 资源目录**，让 process.resourcesPath 在两种形态下解析到
#     同一条路径（否则开发态只能退回系统 ffmpeg，两条路跑不同版本）。
#     网络不可用时**只告警不中断**：解析链会自动回退系统 ffmpeg / FFMPEG_PATH。
FFMPEG_KEY="$(node -p "process.platform + '-' + process.arch")"
if [ -f "dsh-plugin-desktop/build/ffmpeg/$FFMPEG_KEY/ffmpeg" ]; then
  corepack yarn workspace dsh-plugin-desktop ffmpeg:dev >/dev/null 2>&1 || true
else
  echo "==> 准备内置 ffmpeg（首次约 20~45MB，走 npmmirror 镜像；失败不阻断启动）..."
  corepack yarn workspace dsh-plugin-desktop ffmpeg:dev \
    || echo "⚠️ 内置 ffmpeg 未就绪：开发态回退系统 ffmpeg / FFMPEG_PATH（不影响打包产物）"
fi

# 3. --fast：不重建，直接启动已构建桌面
if [ "${1:-}" = "--fast" ]; then
  # 防呆（2026-09-13）：canvas lib 是打包进桌面的，--fast 启动的一定是上次
  # 构建的快照。若 canvas-studio 源码比桌面落地包新，--fast 会静默跑旧代码
  # （表现为「改了没生效」），这里直接拒绝并提示走完整模式。
  if [ -f dsh-plugin-desktop/lib/main.js ]; then
    STALE_SRC="$(find canvas-studio/src -type f \( -name '*.ts' -o -name '*.tsx' \) -newer dsh-plugin-desktop/lib/main.js 2>/dev/null | head -1)"
    if [ -n "$STALE_SRC" ]; then
      echo "✗ --fast 会启动旧构建：canvas-studio 源码比桌面产物新（$STALE_SRC）" >&2
      echo "  请用完整模式重建：bash start-canvas-studio.sh" >&2
      exit 1
    fi
  fi
  echo "==> 快速启动（不重建）：yarn start ..."
  corepack yarn start
  exit 0
fi

# 4. 完整启动：先重建 canvas-studio，再走桌面 dev（桌面 dev 自身会 build）
echo "==> 重建 canvas-studio（编译最新源码）..."
corepack yarn workspace canvas-studio build

echo "==> 启动桌面：yarn dev（构建桌面并嵌入最新 canvas lib，再起 Electron）..."
corepack yarn dev
