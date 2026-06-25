#!/bin/bash
# 启动 直播订单管理系统 所有服务 + 心跳守护
# 每次容器重启后执行本脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "启动 HTTP 服务 (port 8085)..."
cd "$SCRIPT_DIR" && nohup python3 -m http.server 8085 --bind 0.0.0.0 > /dev/null 2>&1 &

echo "启动 OMS 同步守护进程..."
cd "$SCRIPT_DIR" && nohup python3 -u oms_sync.py --daemon > /dev/null 2>&1 &

echo "启动 库存快照 守护进程..."
cd "$SCRIPT_DIR" && nohup bash stock_snapshot_watchdog.sh > /dev/null 2>&1 &

echo "启动 心跳守护 (30秒检测周期)..."
cd "$SCRIPT_DIR" && nohup bash heartbeat.sh > /dev/null 2>&1 &

echo ""
echo "✅ 所有服务已启动，心跳检测每 30 秒自动恢复失败服务"
echo "   系统地址: http://localhost:8085/"
echo "   日志目录: ${SCRIPT_DIR}/logs/"
