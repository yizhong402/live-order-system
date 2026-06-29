#!/bin/bash
# 每日健康巡检脚本
# 检查：stock_snapshot、库存校准结果、双守护进程、HTTP服务、系统稳定性
# 新增：今日新上架SKU详情（含图片URL）、商品完整性统计、校准时效预警
# 输出 JSON 报告 + 人类可读文本

REPORT_FILE="/tmp/health-check-report.json"
TEXT_FILE="/tmp/health-check-report.txt"
SNAPSHOT_FILE="/home/sandbox/.openclaw/workspace/repo/live-order-system/data/stock-snapshots.json"
SCRIPT_DIR="/home/sandbox/.openclaw/workspace/repo/live-order-system"
PUSH_ALERT_FILE="$SCRIPT_DIR/data/.push_fail_alert.json"
BAAS_URL="https://baas.kuafuai.net/baas-api"
BAAS_KEY="baas_CJbcgwuf"
NOW=$(date '+%Y-%m-%d %H:%M:%S')
TODAY=$(date '+%Y-%m-%d')

echo '{}' > "$REPORT_FILE"

# ===== 1. 检查 stock_snapshot 今天是否已执行 =====
SNAPSHOT_RESULT=""
SNAPSHOT_COUNT="0"
SNAPSHOT_DATES=""
if [ -f "$SNAPSHOT_FILE" ]; then
    SNAPSHOT_DATA=$(python3 -c "
import json
with open('$SNAPSHOT_FILE') as f:
    d = json.load(f)
today = '$TODAY'
dates = sorted(d.keys())
has_today = 'yes' if today in d else 'no'
count = len(d)
date_list = ', '.join(dates)
today_sku_count = len(d[today]) if today in d else 0
print(f'{has_today}|{count}|{date_list}|{today_sku_count}')
" 2>/dev/null)
    IFS='|' read -r SNAPSHOT_STATUS SNAPSHOT_COUNT SNAPSHOT_DATES TODAY_SKU_COUNT <<< "$SNAPSHOT_DATA"
    if [ "$SNAPSHOT_STATUS" = "yes" ]; then
        SNAPSHOT_RESULT="✅ 今日快照已执行 ($TODAY, ${TODAY_SKU_COUNT} SKU)"
    else
        SNAPSHOT_RESULT="❌ 今日快照未执行 (仅有: $SNAPSHOT_DATES)"
    fi
else
    SNAPSHOT_RESULT="❌ 快照文件不存在"
fi

# ===== 2. 检查库存校准结果（从 BaaS settings 读取最新 syncLog）=====
CALIBRATE_RESULT=""
CALIBRATE_DETAIL=""
CALIBRATE_STALENESS=""
CALIBRATE_RESULT_JSON=$(python3 -c "
import json, requests, sys
try:
    r = requests.post('${BAAS_URL}/api/data/invoke?table=settings&method=list',
        json={'pageNo': 1, 'pageSize': 1},
        headers={'CODE_FLYING': '${BAAS_KEY}', 'Content-Type': 'application/json'},
        timeout=15)
    data = r.json()
    if data.get('success') and data.get('data') and len(data['data']) > 0:
        oms_raw = data['data'][0].get('omsSync', '{}')
        if isinstance(oms_raw, str):
            oms = json.loads(oms_raw)
        else:
            oms = oms_raw
        logs = oms.get('syncLog', [])
        calibrate_logs = [l for l in logs if l.get('type') == 'calibrate']
        if calibrate_logs:
            last = calibrate_logs[0]
            result = {
                'status': 'ok',
                'last_calibrate_time': last.get('time', ''),
                'added': last.get('added', 0),
                'updated': last.get('updated', 0),
                'skipped': last.get('skipped', 0),
                'elapsed': last.get('elapsed', ''),
                'success': last.get('success', False)
            }
        else:
            result = {'status': 'no_record'}
        print(json.dumps(result))
    else:
        print(json.dumps({'status': 'no_settings'}))
except Exception as e:
    print(json.dumps({'status': 'error', 'message': str(e)}))
" 2>/dev/null)
CALIBRATE_STATUS=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
if [ "$CALIBRATE_STATUS" = "ok" ]; then
    LAST_TIME=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('last_calibrate_time',''))" 2>/dev/null)
    ADDED=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('added',0))" 2>/dev/null)
    UPDATED=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('updated',0))" 2>/dev/null)
    SKIPPED=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('skipped',0))" 2>/dev/null)
    ELAPSED=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('elapsed',''))" 2>/dev/null)
    SUCCESS=$(echo "$CALIBRATE_RESULT_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null)
    if [ "$SUCCESS" = "True" ]; then
        CALIBRATE_RESULT="✅ 库存校准已执行"
        CALIBRATE_DETAIL="$(echo $LAST_TIME) (新增${ADDED} / 更新${UPDATED} / 跳过${SKIPPED} / 耗时${ELAPSED})"
    else
        CALIBRATE_RESULT="⚠️ 校准记录失败"
        CALIBRATE_DETAIL="$LAST_TIME"
    fi
    # 检查校准时效（距现在超过24小时告警）
    if [ -n "$LAST_TIME" ]; then
        STALE_CHECK=$(python3 -c "
from datetime import datetime, timezone, timedelta
import sys
try:
    t = datetime.fromisoformat('$LAST_TIME')
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone(timedelta(hours=8)))
    now = datetime.now(timezone(timedelta(hours=8)))
    hours = (now - t).total_seconds() / 3600
    print(f'{hours:.1f}')
except:
    print('-1')
" 2>/dev/null)
        if [ "$STALE_CHECK" != "-1" ] && [ "$(python3 -c "print('yes' if $STALE_CHECK > 24 else 'no')" 2>/dev/null)" = "yes" ]; then
            CALIBRATE_STALENESS="⚠️ 校准距上次已超过 ${STALE_CHECK} 小时，建议尽快校准"
        else
            CALIBRATE_STALENESS=""
        fi
    fi
elif [ "$CALIBRATE_STATUS" = "no_record" ]; then
    CALIBRATE_RESULT="⚠️ 库存校准: 无历史记录"
    CALIBRATE_STALENESS="❌ 从未执行过库存校准，请尽快校准"
else
    CALIBRATE_RESULT="⚠️ 库存校准: 无法查询 ($CALIBRATE_STATUS)"
fi

# ===== 3. 检查守护进程存活 =====
WATCHDOG_PID=$(pgrep -f "stock_snapshot_watchdog" 2>/dev/null | head -1)
OMS_WD_PID=$(pgrep -f "oms_watchdog" 2>/dev/null | head -1)
WATCHDOG_RESULT=$([ -n "$WATCHDOG_PID" ] && echo "✅ stock_snapshot_watchdog 运行中 (PID: $WATCHDOG_PID)" || echo "❌ stock_snapshot_watchdog 未运行")
OMS_WD_RESULT=$([ -n "$OMS_WD_PID" ] && echo "✅ oms_watchdog 运行中 (PID: $OMS_WD_PID)" || echo "⚠️ oms_watchdog 未运行")

# ===== 4. 检查 HTTP 服务 =====
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8085/ 2>/dev/null)
HTTP_RESULT=$([ "$HTTP_CODE" = "200" ] && echo "✅ HTTP服务(8085) 运行中" || echo "❌ HTTP服务(8085) 异常(HTTP $HTTP_CODE)")

# ===== 5. 检查系统稳定性 =====
RESTART_LOG=$(journalctl --no-pager -n 10 2>/dev/null | grep -i "oom\|killed\|crash\|error\|fail" | tail -3)
RESTART_RESULT=$([ -z "$RESTART_LOG" ] && echo "✅ 无异常终止" || echo "⚠️ 系统日志异常: $RESTART_LOG")

# ===== 5b. 检查 push 失败告警 =====
PUSH_ALERT_RESULT=""
if [ -f "$PUSH_ALERT_FILE" ]; then
    ALERT_CONTENT=$(cat "$PUSH_ALERT_FILE")
    ALERT_TIME=$(echo "$ALERT_CONTENT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('time',''))" 2>/dev/null)
    ALERT_PHASE=$(echo "$ALERT_CONTENT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('phase',''))" 2>/dev/null)
    ALERT_DETAIL=$(echo "$ALERT_CONTENT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('detail',''))" 2>/dev/null)
    # 只报当天的告警
    if echo "$ALERT_TIME" | grep -q "$TODAY"; then
        PUSH_ALERT_RESULT="❌ Git推送失败 [$ALERT_PHASE] $ALERT_DETAIL ($ALERT_TIME)"
    fi
fi

# ===== 5c. 检查守护进程工作目录 =====
WD_CHECK_RESULT=""
STOCK_WD=$(readlink -f /proc/$(pgrep -f "stock_snapshot_watchdog" 2>/dev/null | head -1)/cwd 2>/dev/null)
OMS_WD=$(readlink -f /proc/$(pgrep -f "oms_watchdog" 2>/dev/null | head -1)/cwd 2>/dev/null)
CORRECT_WD="/home/sandbox/.openclaw/workspace/repo/live-order-system"
if [ -n "$STOCK_WD" ] && [ "$STOCK_WD" != "$CORRECT_WD" ]; then
    WD_CHECK_RESULT="⚠️ 快照守护运行目录异常: $STOCK_WD"
fi
if [ -n "$OMS_WD" ] && [ "$OMS_WD" != "$CORRECT_WD" ]; then
    if [ -n "$WD_CHECK_RESULT" ]; then WD_CHECK_RESULT="$WD_CHECK_RESULT；"; fi
    WD_CHECK_RESULT="${WD_CHECK_RESULT}⚠️ OMS守护运行目录异常: $OMS_WD"
fi
if [ -z "$WD_CHECK_RESULT" ]; then
    WD_CHECK_RESULT="✅ 守护进程工作目录正常"
fi

# ===== 6. 今日新上架SKU分析（库存比昨天增多的商品，按库存降序）=====
NEW_PRODUCTS_INFO="[]"
NEW_PRODUCT_COUNT="0"
NEW_PRODUCT_NAMES=""
if [ -f "$SNAPSHOT_FILE" ]; then
    NEW_PRODUCTS_DATA=$(python3 -c "
import json, requests

BAAS_URL = '${BAAS_URL}'
BAAS_KEY = '${BAAS_KEY}'

with open('$SNAPSHOT_FILE') as f:
    d = json.load(f)
dates = sorted(d.keys())
if len(dates) < 2:
    print(json.dumps({'count': 0, 'items': []}))
    exit()

today = dates[-1]
yesterday = dates[-2]
today_data = d[today]
yesterday_data = d[yesterday]

# 找出所有库存比昨天增多的SKU
increased = []
for sku, stock_today in today_data.items():
    stock_yesterday = yesterday_data.get(sku)
    if stock_yesterday is not None:
        increase = int(stock_today) - int(stock_yesterday)
        if increase > 0:
            increased.append((sku, int(stock_today), increase))

# 按库存从多到少排序（跟截图一致）
increased.sort(key=lambda x: -x[1])

if not increased:
    print(json.dumps({'count': 0, 'items': []}))
    exit()

# 从 BaaS 拉取完整商品信息
r = requests.post(f'{BAAS_URL}/api/data/invoke?table=products&method=list',
    json={'pageNo': 1, 'pageSize': 5000},
    headers={'CODE_FLYING': BAAS_KEY, 'Content-Type': 'application/json'},
    timeout=30)
baas_products = {}
if r.json().get('success'):
    for p in r.json().get('data', []):
        baas_products[p['sku']] = p

items = []
no_image = 0
for sku, stock_today, increase in increased:
    p = baas_products.get(sku, {})
    item = {
        'sku': sku,
        'name': p.get('name', ''),
        'stock': stock_today,
        'stock_increase': increase,
        'price_cny': p.get('price_cny', 0) / 100 if p.get('price_cny') else 0,
        'price_usd': p.get('price_usd', 0) / 100 if p.get('price_usd') else 0,
        'image_url': p.get('image_url', ''),
    }
    if not item['image_url']:
        no_image += 1
    items.append(item)

print(json.dumps({'count': len(items), 'no_image': no_image, 'items': items}, ensure_ascii=False))
" 2>/dev/null)
    NEW_PRODUCT_COUNT=$(echo "$NEW_PRODUCTS_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null)
    NEW_NO_IMAGE=$(echo "$NEW_PRODUCTS_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('no_image',0))" 2>/dev/null)
    NEW_PRODUCT_NAMES=$(echo "$NEW_PRODUCTS_DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items',[])
names = [f'{i[\"sku\"]} (+{i[\"stock_increase\"]})' for i in items[:5]]
if len(items) > 5:
    names.append(f'... 共{len(items)}个')
print(' | '.join(names))
" 2>/dev/null)
    NEW_PRODUCTS_INFO="$NEW_PRODUCTS_DATA"
fi

# ===== 7. 商品完整性统计 =====
PRODUCT_STATS=$(python3 -c "
import json, requests

BAAS_URL = '${BAAS_URL}'
BAAS_KEY = '${BAAS_KEY}'
try:
    r = requests.post(f'{BAAS_URL}/api/data/invoke?table=products&method=list',
        json={'pageNo': 1, 'pageSize': 5000},
        headers={'CODE_FLYING': BAAS_KEY, 'Content-Type': 'application/json'},
        timeout=30)
    data = r.json()
    if not data.get('success') or not data.get('data'):
        print(json.dumps({'total': 0, 'no_image': 0, 'no_price': 0, 'zero_stock': 0}))
        exit()
    products = data['data']
    total = len(products)
    no_image = sum(1 for p in products if not p.get('image_url', ''))
    no_price = sum(1 for p in products if (not p.get('price_cny') or p.get('price_cny') == 0) and (not p.get('price_usd') or p.get('price_usd') == 0))
    zero_stock = sum(1 for p in products if (p.get('stock', 0) or 0) == 0)
    print(json.dumps({'total': total, 'no_image': no_image, 'no_price': no_price, 'zero_stock': zero_stock}))
except Exception as e:
    print(json.dumps({'total': 0, 'no_image': 0, 'no_price': 0, 'zero_stock': 0, 'error': str(e)}))
" 2>/dev/null)
PROD_TOTAL=$(echo "$PRODUCT_STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null)
PROD_NO_IMAGE=$(echo "$PRODUCT_STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('no_image',0))" 2>/dev/null)
PROD_NO_PRICE=$(echo "$PRODUCT_STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('no_price',0))" 2>/dev/null)
PROD_ZERO_STOCK=$(echo "$PRODUCT_STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('zero_stock',0))" 2>/dev/null)

# ===== 8. 生成人类可读文本报告 =====
cat > "$TEXT_FILE" << EOF
📋 每日巡检报告 — $TODAY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📸 库存快照: $SNAPSHOT_RESULT
⚙️ 库存校准: $CALIBRATE_RESULT
$( [ -n "$CALIBRATE_DETAIL" ] && echo "    ➤ $CALIBRATE_DETAIL" )
🛡️ 快照守护: $WATCHDOG_RESULT
🛡️ OMS守护: $OMS_WD_RESULT
📡 守护进程目录: $WD_CHECK_RESULT
$( [ -n "$PUSH_ALERT_RESULT" ] && echo "📤 $PUSH_ALERT_RESULT" )
🌐 HTTP服务: $HTTP_RESULT
🖥️ 系统异常: $RESTART_RESULT
📊 商品统计: 共${PROD_TOTAL} SKU | 缺图${PROD_NO_IMAGE} | 缺价${PROD_NO_PRICE} | 库存0: ${PROD_ZERO_STOCK}
📦 今日新上架: ${NEW_PRODUCT_COUNT}个
$( [ "$NEW_PRODUCT_COUNT" -gt 0 ] && echo "    ${NEW_PRODUCT_NAMES}" )
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
$( [ -n "$CALIBRATE_STALENESS" ] && echo "$CALIBRATE_STALENESS" )
生成时间: $NOW
EOF

# ===== 9. 输出 JSON 报告 =====
python3 -c "
import json

report = {
    'timestamp': '$NOW',
    'date': '$TODAY',
    'checks': {
        'stock_snapshot': '$SNAPSHOT_RESULT',
        'calibration': '$CALIBRATE_RESULT',
        'calibration_detail': '$(echo "$CALIBRATE_DETAIL" | sed "s/'/\\\\'/g")',
        'calibration_staleness': '$(echo "$CALIBRATE_STALENESS" | sed "s/'/\\\\'/g")',
        'watchdog_stock': '$WATCHDOG_RESULT',
        'watchdog_oms': '$OMS_WD_RESULT',
        'watchdog_dir': '$WD_CHECK_RESULT',
        'push_alert': '$PUSH_ALERT_RESULT',
        'http_service': '$HTTP_RESULT',
        'restart_log': '$RESTART_RESULT'
    },
    'product_stats': {
        'total': $PROD_TOTAL,
        'no_image': $PROD_NO_IMAGE,
        'no_price': $PROD_NO_PRICE,
        'zero_stock': $PROD_ZERO_STOCK
    },
    'new_products': $(echo "$NEW_PRODUCTS_INFO" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('items',[]), ensure_ascii=False))" 2>/dev/null || echo '[]'),
    'new_product_count': $NEW_PRODUCT_COUNT
}
with open('$REPORT_FILE', 'w') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
"

# ===== 10. 生成 HTML 邮件报告（带图）=====
python3 "$SCRIPT_DIR/gen_email_html.py"

echo "=== 报告已生成 ==="
cat "$TEXT_FILE"
echo "=== JSON 报告 ==="
cat "$REPORT_FILE" | python3 -m json.tool 2>/dev/null || cat "$REPORT_FILE"
