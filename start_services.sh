#!/bin/bash
# 启动 直播订单管理系统 所有服务
# 每次容器启动后执行本脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"

echo "启动 HTTP 服务 (port 8085)..."
cd "$SCRIPT_DIR"
python3 -m http.server 8085 --bind 0.0.0.0 >> "${LOG_DIR}/http.log" 2>&1 &
echo "  PID: $!"

echo "启动 OMS 同步守护进程..."
python3 -u oms_sync.py --daemon >> "${LOG_DIR}/oms_sync.log" 2>&1 &
echo "  PID: $!"

echo "启动 库存快照 守护进程..."
bash stock_snapshot_watchdog.sh >> "${LOG_DIR}/stock_snapshot.log" 2>&1 &
echo "  PID: $!"

echo ""
echo "✅ 所有服务已启动"
echo "   系统地址: http://localhost:8085/"
