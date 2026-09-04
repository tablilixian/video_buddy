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

# 1. 初始化 upstream submodule（幂等：仅当 harness 源码缺失时）
if [ ! -f deepseek-harness/src/index.ts ]; then
  echo "==> 初始化 upstream submodule（首次需联网，约数分钟）..."
  git submodule update --init --recursive
fi

# 2. 安装 workspace 依赖（幂等：仅当 node_modules 缺失时）
if [ ! -d node_modules/.bin ]; then
  echo "==> 安装 workspace 依赖（首次较重，需联网）..."
  corepack yarn install --immutable
fi

# 3. --fast：不重建，直接启动已构建桌面
if [ "${1:-}" = "--fast" ]; then
  echo "==> 快速启动（不重建）：yarn start ..."
  corepack yarn start
  exit 0
fi

# 4. 完整启动：先重建 canvas-studio，再走桌面 dev（桌面 dev 自身会 build）
echo "==> 重建 canvas-studio（编译最新源码）..."
corepack yarn workspace canvas-studio build

echo "==> 启动桌面：yarn dev（构建桌面并嵌入最新 canvas lib，再起 Electron）..."
corepack yarn dev
