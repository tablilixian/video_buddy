#!/usr/bin/env zsh
# Drama API Playground 启动 / 测试脚本
#
# 用法：
#   ./run.sh            # 同 ./run.sh help
#   ./run.sh start      # 启动 dev server（默认 5188），用于手动在浏览器测试
#   ./run.sh test       # 一键自动跑全部接口测试，生成 report.html 并留在浏览器打开
#   ./run.sh stop       # 停止 dev server
#   ./run.sh build      # 构建生产包（dist/）
#   ./run.sh help       # 帮助
#
# 环境变量：
#   PORT    代理/dev server 端口（默认 5188，避开被占用的 5173）
#   BASE    Drama Backend 地址（默认 http://117.50.108.73:8082）
#
# 说明：
#   - 本机 shell 可能注入 HTTP_PROXY，脚本内所有 localhost 访问都加 --noproxy '*' 避免被截胡。
#   - macOS 无 GNU timeout，健康等待用 curl --max-time 轮询实现。

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

PORT="${PORT:-5188}"
BASE="${BASE:-http://117.50.108.73:8082}"
PID_FILE="$SCRIPT_DIR/.vite.pid"
LOG_FILE="$SCRIPT_DIR/.vite.log"
REPORT="$SCRIPT_DIR/report.html"

NPX="$(command -v node)"
VITE_BIN="$SCRIPT_DIR/node_modules/.bin/vite"
SMOKE="$SCRIPT_DIR/scripts/smoke.mjs"

# 所有 localhost 访问都绕过本机代理
curl_noproxy() { curl -s --noproxy '*' --max-time "$@"; }

ensure_deps() {
  if [ ! -x "$VITE_BIN" ]; then
    echo "▶ 安装依赖 (npm install)…"
    npm install --no-audit --no-fund 2>&1 | tail -5
  fi
}

server_up() {
  # 返回 0 表示已起来
  local code
  code="$(curl_noproxy 3 "http://localhost:$PORT/" -o /dev/null -w '%{http_code}')"
  [ "$code" = "200" ]
}

wait_server() {
  echo "▶ 等待 dev server (localhost:$PORT) 就绪…"
  local i=0
  while [ $i -lt 40 ]; do
    if server_up; then
      echo "  ✓ 已就绪"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  echo "  ✗ 等待超时，查看日志: $LOG_FILE"
  tail -20 "$LOG_FILE" 2>/dev/null
  return 1
}

start_server() {
  ensure_deps
  if server_up; then
    echo "ℹ dev server 已在 localhost:$PORT 运行。"
    return 0
  fi
  echo "▶ 启动 dev server (端口 $PORT)…"
  nohup "$VITE_BIN" --host --port "$PORT" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if ! wait_server; then
    echo "✗ 启动失败"
    return 1
  fi
  echo "🌐 手动测试地址: http://localhost:$PORT"
  # macOS 下尝试自动打开浏览器（其它平台忽略）
  if command -v open >/dev/null 2>&1; then
    (sleep 1; open "http://localhost:$PORT") >/dev/null 2>&1 &
  fi
  return 0
}

stop_server() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [ -n "$pid" ]; then
      echo "▶ 停止 dev server (pid $pid)…"
      kill "$pid" 2>/dev/null && echo "  ✓ 已停止" || echo "  (进程不存在)"
    fi
    rm -f "$PID_FILE"
  else
    echo "ℹ 未发现 PID 文件，尝试按端口查找…"
    pkill -f "vite --host --port $PORT" 2>/dev/null && echo "  ✓ 已停止" || echo "  (无运行中的实例)"
  fi
}

run_test() {
  ensure_deps
  start_server || return 1
  local fast_args=()
  # ./run.sh test --fast 或 SKIP_VIDEO=1 ./run.sh test → 跳过两个慢的视频端点
  if [ "${2:-}" = "--fast" ] || [ "${SKIP_VIDEO:-0}" = "1" ]; then
    fast_args=(--skip-video)
    echo "▶ 运行自动测试 (快速模式：跳过视频端点)…"
  else
    echo "▶ 运行自动测试 (全部接口 + 素材串联；含视频，较慢)…"
  fi
  if [ -z "$NPX" ] || [ ! -x "$NPX" ]; then
    echo "✗ 未找到 node，请先安装 Node.js 18+"
    return 1
  fi
  "$NPX" "$SMOKE" --base "$BASE" --proxy "http://localhost:$PORT" --out "$REPORT" "${fast_args[@]}"
  local rc=$?
  echo
  if [ "$rc" = "0" ]; then
    echo "✅ 全部用例通过。报告: $REPORT"
  else
    echo "⚠️ 存在失败用例。报告: $REPORT"
  fi
  if command -v open >/dev/null 2>&1; then
    (sleep 1; open "$REPORT") >/dev/null 2>&1 &
  fi
  return $rc
}

do_build() {
  ensure_deps
  echo "▶ 构建生产包 (vite build)…"
  "$VITE_BIN" build 2>&1 | tail -15
}

usage() {
  cat <<'EOF'
Drama API Playground 启动 / 测试脚本

  ./run.sh start        启动 dev server（默认 5188），用于手动浏览器测试
  ./run.sh test         一键自动跑全部接口测试 → 生成 report.html 并打开（含视频，较慢）
  ./run.sh test --fast  同上但跳过两个视频端点（快速回归，约 5 分钟）
  ./run.sh stop         停止 dev server
  ./run.sh build        构建生产包 (dist/)
  ./run.sh help         显示本帮助

环境变量：PORT(端口,默认5188)  BASE(Drama后端,默认117.50.108.73:8082)  SKIP_VIDEO=1(同 --fast)

手动测试：执行 ./run.sh start，浏览器开 http://localhost:PORT，左侧选端点、
中间填参、右侧素材库自动收生成结果，点「用作输入」把产物串到下一步。
亦可点界面里的「运行全部接口(生成测试报告)」按钮，在页面内直接看报告。
EOF
}

case "${1:-help}" in
  start) start_server ;;
  stop) stop_server ;;
  test) run_test ;;
  build) do_build ;;
  help|--help|-h) usage ;;
  *) echo "未知命令: $1"; usage; exit 1 ;;
esac
