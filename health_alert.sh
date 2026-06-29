#!/bin/bash
# health_alert.sh — 发送异常告警到晨检通道
# 被 watchdog 在推送失败时调用
# 写入 $REPO_DIR/data/.push_fail_alert.json 供晨检查看

REPO_DIR="/home/sandbox/.openclaw/workspace/repo/live-order-system"
ALERT_FILE="$REPO_DIR/data/.push_fail_alert.json"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SUBJECT="$1"
DETAIL="$2"

echo "[$TIMESTAMP] ⚠️ $SUBJECT: $DETAIL" | tee -a /tmp/health_alert.log

# 写入告警文件
cat > "$ALERT_FILE" <<EOF
{
  "time": "$TIMESTAMP",
  "subject": "$SUBJECT",
  "detail": "$DETAIL"
}
EOF
