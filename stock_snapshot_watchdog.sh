#!/bin/bash
# stock_snapshot_watchdog.sh — 库存快照定时守护
# 每分钟检测一次，到 08:00 自动跑快照
# 通过 nohup 启动，不依赖 crontab

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/stock_snapshot.log"
SNAPSHOT_SCRIPT="$SCRIPT_DIR/stock_snapshot.py"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🛡️ 库存快照守护启动"
log "  脚本: $SNAPSHOT_SCRIPT"
log "  日志: $LOG_FILE"
log "  执行时间: 每天 08:00"

LAST_RUN_DATE=""

while true; do
    CURRENT_DATE=$(date '+%Y-%m-%d')
    CURRENT_HOUR=$(date '+%H')
    CURRENT_MIN=$(date '+%M')
    
    # 每天 08:00 执行，且当天没跑过
    if [ "$CURRENT_HOUR" = "08" ] && [ "$CURRENT_MIN" = "00" ] && [ "$CURRENT_DATE" != "$LAST_RUN_DATE" ]; then
        log "⏰ 定时快照触发"
        cd "$SCRIPT_DIR" && python3 "$SNAPSHOT_SCRIPT" 2>&1 | tee -a "$LOG_FILE"
        
        # 快照完成后立即跑健康检查
        log "🔍 运行每日健康巡检..."
        bash "$SCRIPT_DIR/daily_health_check.sh" 2>&1 | tee -a "$LOG_FILE"
        
        # 自动推送快照到 GitHub Pages（线上热销品+新上架依赖此数据）
        log "🚀 推送快照到 GitHub..."
        cd "$SCRIPT_DIR"
        git add data/stock-snapshots.json
        if git diff --cached --quiet 2>/dev/null; then
            log "   快照数据无变化，跳过推送"
        else
            git commit -m "chore: daily stock snapshot $CURRENT_DATE"
            git push origin master 2>&1 | tee -a "$LOG_FILE"
            # 同步到 main 分支（GitHub Pages 使用 main 部署）
            git push origin master:main --force 2>&1 | tee -a "$LOG_FILE"
            log "✅ 快照已推送到 GitHub（master + main），线上页面约1-2分钟后更新"
        fi
        
        LAST_RUN_DATE="$CURRENT_DATE"
        log "✅ 快照+巡检+推送完成"
        # 等1分钟避免重复触发
        sleep 60
    fi
    
    sleep 30
done
