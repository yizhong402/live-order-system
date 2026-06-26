import sys, json, requests, time

BASE = 'https://baas.kuafuai.net/baas-api'
HEADERS = {'CODE_FLYING': 'baas_CJbcgwuf', 'Content-Type': 'application/json'}

print("📡 获取云端商品列表...", flush=True)
r = requests.post(f"{BASE}/api/data/invoke?table=products&method=list", headers=HEADERS, json={}, timeout=30)
data = r.json()
products = data['data']

# 找出需要乘以100的（非零价格）
to_migrate = []
for p in products:
    cny = p.get('price_cny', 0)
    usd = p.get('price_usd', 0)
    if cny > 0 or usd > 0:
        to_migrate.append({
            'id': p['id'],
            'sku': p['sku'],
            'price_cny': int(cny * 100),  # 确保整数
            'price_usd': int(usd * 100),
            'orig_cny': cny,
            'orig_usd': usd
        })

print(f"📊 待迁移（×100）：{len(to_migrate)} 条", flush=True)
if to_migrate:
    print(f"  示例：{to_migrate[0]['sku']} ¥{to_migrate[0]['orig_cny']}→{to_migrate[0]['price_cny']}分", flush=True)

# 逐批更新
print("🔄 开始迁移...", flush=True)
session = requests.Session()
success = 0
fail = 0
for i, item in enumerate(to_migrate):
    try:
        r = session.post(f"{BASE}/api/data/invoke?table=products&method=update",
                        headers=HEADERS,
                        json={"id": item['id'], "price_cny": item['price_cny'], "price_usd": item['price_usd']},
                        timeout=10)
        if r.json().get('success'):
            success += 1
        else:
            fail += 1
    except Exception as e:
        fail += 1
    if (i+1) % 50 == 0:
        print(f"  {i+1}/{len(to_migrate)} (成功{success} 失败{fail})", flush=True)
    elif i < 5:
        time.sleep(0.1)

print(f"\n✅ 迁移完成: 成功{success} 失败{fail}", flush=True)

# 验证
if to_migrate:
    r = requests.post(f"{BASE}/api/data/invoke?table=products&method=list",
                      headers=HEADERS,
                      json={"where":[{"field":"id","operator":"eq","value":to_migrate[0]['id']}]})
    v = r.json()['data'][0]
    print(f"\n验证: {v['sku']} price_cny={v['price_cny']} (期望: {to_migrate[0]['price_cny']})", flush=True)
