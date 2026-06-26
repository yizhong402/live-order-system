import openpyxl, requests, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

wb = openpyxl.load_workbook('采购价表.xlsx', data_only=True)
ws = wb.active

BASE = 'https://baas.kuafuai.net/baas-api'
HEADERS = {'CODE_FLYING': 'baas_CJbcgwuf', 'Content-Type': 'application/json'}

print("📡 获取云端商品列表...", flush=True)
r = requests.post(f"{BASE}/api/data/invoke?table=products&method=list", headers=HEADERS, json={}, timeout=30)
sku_map = {}
for p in r.json()['data']:
    sku_map[p['sku']] = p['id']
print(f"  云端 {len(sku_map)} 个商品", flush=True)

# 解析Excel，×100转分为整数
updates = []
for row in ws.iter_rows(min_row=2, values_only=True):
    sku, cny, usd = row[0], row[1], row[2]
    if not sku: continue
    sku = str(sku).strip()
    if sku.upper() == 'SKU': continue
    try: cny_v = int(float(cny) * 100 + 0.5) if cny is not None and cny != '' else 0
    except: continue
    try: usd_v = int(float(usd) * 100 + 0.5) if usd is not None and usd != '' else 0
    except: continue
    if sku in sku_map:
        updates.append((sku_map[sku], sku, cny_v, usd_v))

print(f"📊 待写入: {len(updates)} 条", flush=True)
print(f"  例: {updates[0][1]} → ¥{updates[0][2]/100:.2f} / ${updates[0][3]/100:.2f}", flush=True)

def update_one(pid, sku, cny, usd, retries=2):
    for attempt in range(retries):
        try:
            r = requests.post(f"{BASE}/api/data/invoke?table=products&method=update",
                              headers=HEADERS,
                              json={"id": pid, "price_cny": cny, "price_usd": usd},
                              timeout=15)
            if r.json().get('success'):
                return True
            return False
        except:
            if attempt < retries-1:
                time.sleep(1)
            else:
                return False

print("\n🔄 开始写入（10并发/批）...", flush=True)
success = 0
fail = 0

BATCH = 10
for start in range(0, len(updates), BATCH):
    batch = updates[start:start+BATCH]
    with ThreadPoolExecutor(max_workers=BATCH) as pool:
        futures = [pool.submit(update_one, pid, sku, cny, usd) for pid, sku, cny, usd in batch]
        for f in as_completed(futures):
            if f.result():
                success += 1
            else:
                fail += 1
    
    done = min(start + BATCH, len(updates))
    if done % 100 == 0 or done == len(updates):
        print(f"  {done}/{len(updates)} (成功{success} 失败{fail})", flush=True)

print(f"\n{'='*40}", flush=True)
print(f"✅ 完成: 成功{success} 失败{fail}", flush=True)

# 验证
print("\n🔍 验证:", flush=True)
for test_sku in ['BA0125111905', 'BA0125111903', 'BY0125101349']:
    r = requests.post(f"{BASE}/api/data/invoke?table=products&method=list",
                      headers=HEADERS,
                      json={"where":[{"field":"sku","operator":"eq","value":test_sku}]})
    p = r.json()['data'][0]
    print(f"  {test_sku}: ¥{p['price_cny']/100:.2f} / ${p['price_usd']/100:.2f} (分: {p['price_cny']}, {p['price_usd']})", flush=True)
