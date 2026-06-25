#!/bin/bash
# 直播订单管理系统 — 守护心跳脚本
# 每 30 秒检测所有服务，挂了自动拉起
# 启动方式：nohup bash /tmp/live-order-system/heartbeat.sh > /dev/null 2>&1 &

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"

PID_FILE="${LOG_DIR}/heartbeat.pid"
LOG_FILE="${LOG_DIR}/heartbeat.log"

echo $$ > "$PID_FILE"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

check_restart() {
    local name="$1"
    local port="$2"
    local cmd="$3"
    local workdir="$4"
    
    if [ -n "$port" ]; then
        # 端口检测（HTTP 服务等）
        if curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/" --max-time 5 2>/dev/null | grep -q '200\|302\|301'; then
            return 0
        fi
    else
        # 进程名检测（守护进程等）
        if pgrep -f "$cmd" > /dev/null 2>&1; then
            return 0
        fi
    fi
    
    # 服务挂了，重启
    log "⚠️  ${name} 挂了，正在重启..."
    cd "$workdir" || cd "$SCRIPT_DIR"
    
    if [ -n "$port" ]; then
        nohup $cmd >> "${LOG_DIR}/$(echo $name | tr ' /' '__').log" 2>&1 &
    else
        nohup $cmd >> "${LOG_DIR}/$(echo $name | tr ' /' '__').log" 2>&1 &
    fi
    
    local new_pid=$!
    sleep 2
    
    # 验证启动成功
    if [ -n "$port" ]; then
        if curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/" --max-time 5 2>/dev/null | grep -q '200\|302\|301'; then
            log "✅  ${name} 已重启 (PID: $new_pid)"
        else
            log "❌  ${name} 重启失败 (PID: $new_pid)"
        fi
    else
        if pgrep -f "$cmd" > /dev/null 2>&1; then
            log "✅  ${name} 已重启 (PID: $new_pid)"
        else
            log "❌  ${name} 重启失败"
        fi
    fi
}

log "=================== 心跳守护启动 ==================="
log "检测间隔: 30秒"
log "HTTP:       localhost:8085"
log "OMS:        python3 oms_sync.py --daemon"
log "快照:       stock_snapshot_watchdog.sh"
log "===================================================="

while true; do
    # 1. HTTP 服务 (port 8085)
    check_restart "HTTP服务" "8085" "python3 -m http.server 8085 --bind 0.0.0.0" "$SCRIPT_DIR"
    
    # 2. OMS 同步守护进程
    check_restart "OMS守护进程" "" "python3 -u oms_sync.py --daemon" "$SCRIPT_DIR"
    
    # 3. 库存快照守护
    check_restart "快照守护" "" "stock_snapshot_watchdog.sh" "$SCRIPT_DIR"
    
    sleep 30
done
