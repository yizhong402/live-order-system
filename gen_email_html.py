#!/usr/bin/env python3
"""生成每日巡检HTML邮件报告"""
import json
import sys

REPORT_FILE = "/tmp/health-check-report.json"
OUTPUT_FILE = "/tmp/health-check-email.html"

def main():
    with open(REPORT_FILE, encoding="utf-8") as f:
        report = json.load(f)

    checks = report["checks"]
    stats = report["product_stats"]
    new_items = report.get("new_products", [])
    new_count = report.get("new_product_count", 0)

    def status_class(s):
        if s.startswith("✅"):
            return "ok"
        return "err"

    # System status rows
    items_data = [
        ("📸 库存快照", checks.get("stock_snapshot", "")),
        ("⚙️ 库存校准", checks.get("calibration", "")),
        ("🛡️ 快照守护", checks.get("watchdog_stock", "")),
        ("🛡️ OMS 守护", checks.get("watchdog_oms", "")),
        ("🌐 HTTP 服务", checks.get("http_service", "")),
        ("🖥️ 系统异常", checks.get("restart_log", "")),
    ]
    check_rows = ""
    for label, val in items_data:
        cls = status_class(val)
        check_rows += (
            f'<div class="check-item">'
            f'<span class="check-label">{label}</span>'
            f'<span class="check-status {cls}">{val}</span>'
            f"</div>\n"
        )
    detail = checks.get("calibration_detail", "")
    if detail:
        check_rows += (
            f'<div class="check-item" style="padding-left:24px">'
            f'<span class="check-label" style="color:#999;font-size:13px">校准明细</span>'
            f'<span class="check-status" style="font-size:13px;color:#666">{detail}</span>'
            f"</div>\n"
        )

    # New products
    new_html = ""
    for item in new_items:
        img_url = item.get("image_url", "")
        if img_url:
            img_tag = (
                f'<img src="{img_url}" alt="{item["sku"]}" '
                f'onerror="this.style.display=\'none\'">'
            )
        else:
            img_tag = (
                '<div style="width:80px;height:80px;background:#eee;'
                'border-radius:8px;display:flex;align-items:center;'
                'justify-content:center;flex-shrink:0;font-size:24px">📦</div>'
            )
        cny = f"¥{item['price_cny']}" if item.get("price_cny") else "—"
        usd = f"${item['price_usd']}" if item.get("price_usd") else "—"
        stock = item.get("stock", 0)
        increase = item.get("stock_increase", 0)
        increase_badge = f'<span class="increase-badge">+{increase}</span>' if increase else ''
        new_html += f"""<div class="new-item">
{img_tag}
<div class="info">
<div class="sku">{item["sku"]} {increase_badge}</div>
<div class="name">{item.get("name", "")}</div>
<div class="meta">
<span class="meta-item">💰 {cny} / {usd}</span>
<span class="meta-item">📦 库存 {stock}</span>
</div>
</div>
</div>
"""

    staleness = checks.get("calibration_staleness", "")
    staleness_html = (
        f'<div class="staleness">{staleness}</div>\n' if staleness else ""
    )

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>每日巡检报告 {report["date"]}</title>
<style>
body {{ font-family: -apple-system, "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f7fa; color: #333; }}
h1 {{ text-align: center; color: #1a1a2e; font-size: 22px; margin-bottom: 8px; }}
.date {{ text-align: center; color: #888; font-size: 14px; margin-bottom: 24px; }}
.section {{ background: white; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }}
.section h2 {{ font-size: 16px; margin: 0 0 12px 0; color: #1a1a2e; display: flex; align-items: center; gap: 8px; }}
.section h2 .badge {{ background: #667eea; color: white; font-size: 11px; padding: 2px 8px; border-radius: 10px; }}
.check-item {{ display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }}
.check-item:last-child {{ border-bottom: none; }}
.check-label {{ color: #555; font-size: 14px; }}
.check-status {{ font-size: 14px; }}
.ok {{ color: #22c55e; }}
.err {{ color: #ef4444; }}
.stat-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
.stat-card {{ text-align: center; padding: 12px; background: #f8fafc; border-radius: 8px; }}
.stat-num {{ font-size: 24px; font-weight: bold; color: #1a1a2e; }}
.stat-label {{ font-size: 12px; color: #888; margin-top: 4px; }}
.new-item {{ display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; align-items: flex-start; }}
.new-item:last-child {{ border-bottom: none; }}
.new-item img {{ width: 80px; height: 80px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }}
.new-item .info {{ flex: 1; min-width: 0; }}
.new-item .sku {{ font-weight: bold; font-size: 14px; color: #1a1a2e; }}
.increase-badge {{ display: inline-block; background: #d1fae5; color: #065f46; font-size: 11px; padding: 0 6px; border-radius: 4px; margin-left: 4px; }}
.new-item .name {{ font-size: 13px; color: #555; margin: 2px 0; }}
.new-item .meta {{ font-size: 12px; color: #888; display: flex; gap: 12px; flex-wrap: wrap; }}
.meta-item {{ white-space: nowrap; }}
.staleness {{ background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; text-align: center; color: #92400e; font-size: 14px; margin-top: 8px; }}
.footer {{ text-align: center; color: #aaa; font-size: 12px; margin-top: 20px; }}
</style>
</head>
<body>
<h1>📋 每日巡检报告</h1>
<p class="date">{report["date"]} · {report["timestamp"]}</p>

<div class="section">
<h2>📊 系统状态</h2>
{check_rows}</div>

<div class="section">
<h2>📦 商品统计</h2>
<div class="stat-grid">
<div class="stat-card"><div class="stat-num">{stats["total"]}</div><div class="stat-label">总 SKU</div></div>
<div class="stat-card"><div class="stat-num">{stats["no_image"]}</div><div class="stat-label">缺图</div></div>
<div class="stat-card"><div class="stat-num">{stats["no_price"]}</div><div class="stat-label">缺价</div></div>
<div class="stat-card"><div class="stat-num">{stats["zero_stock"]}</div><div class="stat-label">库存为 0</div></div>
</div>
</div>
"""

    if new_items:
        html += f"""<div class="section">
<h2>🆕 今日新上架 <span class="badge">{new_count} 个</span></h2>
{new_html}</div>
"""

    html += f"""{staleness_html}<div class="footer">自动生成 · 巡检时间 {report["timestamp"]}</div>
</body>
</html>"""

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ HTML邮件报告已生成: {OUTPUT_FILE} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
