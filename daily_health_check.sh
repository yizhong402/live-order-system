#!/bin/bash
# 每日健康巡检脚本
# 检查：stock_snapshot 运行状态、OMS 校准、守护进程、系统稳定性
# 输出 JSON 报告 + 人类可读文本

REPORT_FILE="/tmp/health-check-report.json"
TEXT_FILE="/tmp/health-check-report.txt"
SNAPSHOT_FILE="/tmp/live-order-system/data/stock-snapshots.json"
NOW=$(date '+%Y-%m-%d %H:%M:%S')
TODAY=$(date '+%Y-%m-%d')

echo '{}' > "$REPORT_FILE"

# 1. 检查 stock_snapshot 今天是否已执行
if [ -f "$SNAPSHOT_FILE" ]; then
    HAS_SNAPSHOT=$(python3 -c "
import json
with open('$SNAPSHOT_FILE') as f:
    d = json.load(f)
today = '$TODAY'
print('yes' if today in d else 'no')
print(len(d))
print(', '.join(sorted(d.keys())))
" 2>/dev/null)
    SNAPSHOT_STATUS=$(echo "$HAS_SNAPSHOT" | sed -n '1p')
    SNAPSHOT_COUNT=$(echo "$HAS_SNAPSHOT" | sed -n '2p')
    SNAPSHOT_DATES=$(echo "$HAS_SNAPSHOT" | sed -n '3p')
    if [ "$SNAPSHOT_STATUS" = "yes" ]; then
        SNAPSHOT_RESULT="✅ 今日快照已执行 ($TODAY, ${SNAPSHOT_COUNT}天数据: $SNAPSHOT_DATES)"
    else
        SNAPSHOT_RESULT="❌ 今日快照未执行 (仅有: $SNAPSHOT_DATES)"
    fi
else
    SNAPSHOT_RESULT="❌ 快照文件不存在"
fi

# 2. 检查 OMS 校准
if pgrep -f oms_sync > /dev/null 2>&1 || pgrep -f oms_watchdog > /dev/null 2>&1; then
    OMS_RESULT="✅ OMS 进程运行中"
else
    OMS_RESULT="⚠️ OMS 进程未检测到"
fi

# 3. 检查守护进程存活
WATCHDOG_PID=$(pgrep -f "stock_snapshot_watchdog" 2>/dev/null | head -1)
OMS_WD_PID=$(pgrep -f "oms_watchdog" 2>/dev/null | head -1)
WATCHDOG_RESULT=$([ -n "$WATCHDOG_PID" ] && echo "✅ stock_snapshot_watchdog 运行中 (PID: $WATCHDOG_PID)" || echo "❌ stock_snapshot_watchdog 未运行")
OMS_WD_RESULT=$([ -n "$OMS_WD_PID" ] && echo "✅ oms_watchdog 运行中 (PID: $OMS_WD_PID)" || echo "⚠️ oms_watchdog 未运行")

# 4. 检查 HTTP 服务
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8085/ 2>/dev/null)
HTTP_RESULT=$([ "$HTTP_CODE" = "200" ] && echo "✅ HTTP服务(8085) 运行中" || echo "❌ HTTP服务(8085) 异常(HTTP $HTTP_CODE)")

# 5. 检查系统稳定性
RESTART_LOG=$(journalctl --no-pager -n 10 2>/dev/null | grep -i "oom\|killed\|crash\|error\|fail" | tail -3)
RESTART_RESULT=$([ -z "$RESTART_LOG" ] && echo "✅ 无异常终止" || echo "⚠️ 系统日志异常: $RESTART_LOG")

# 6. 生成人类可读报告
cat > "$TEXT_FILE" << EOF
📋 每日巡检报告 — $TODAY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📸 库存快照: $SNAPSHOT_RESULT
⚙️ OMS 校准: $OMS_RESULT
🛡️ 快照守护: $WATCHDOG_RESULT
🛡️ OMS守护: $OMS_WD_RESULT
🌐 HTTP服务: $HTTP_RESULT
🖥️ 系统异常: $RESTART_RESULT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
生成时间: $NOW
EOF

# 7. 输出 JSON 报告
python3 -c "
import json
report = {
    'timestamp': '$NOW',
    'date': '$TODAY',
    'checks': {
        'stock_snapshot': '$SNAPSHOT_RESULT',
        'oms_calibration': '$OMS_RESULT',
        'watchdog_stock': '$WATCHDOG_RESULT',
        'watchdog_oms': '$OMS_WD_RESULT',
        'http_service': '$HTTP_RESULT',
        'restart_log': '$RESTART_RESULT'
    },
    'details': {
        'snapshot_dates': '$SNAPSHOT_DATES',
        'snapshot_count': '$SNAPSHOT_COUNT'
    }
}
with open('$REPORT_FILE', 'w') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
"

cat "$TEXT_FILE"
