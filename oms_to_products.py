#!/usr/bin/env python3
"""
一次性的 OMS → products 表同步工具
- 从 OMS API 拉 SKU 详情 + 库存
- 合并数据后写入 BaaS products 表（商品管理）
"""
import requests, json, hashlib, hmac, random, time, sys, os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "oms_token_cache.json")

# ============ 从 .env 文件加载敏感凭证 ============
ENV_FILE = os.path.join(BASE_DIR, ".env")

def _load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip("'\"")
    return env

_env = _load_env()

BAAS = _env.get("BAAS_URL", "https://baas.kuafuai.net/baas-api")
BAAS_KEY = _env.get("BAAS_API_KEY", "baas_CJbcgwuf")
OMS_DOMAIN = _env.get("OMS_DOMAIN", "ftnet.jfwms.com")
OMS_CID = _env.get("OMS_CLIENT_ID", "fa5f768a7b32449e9350fcb3dedfd5f7")
OMS_SECRET = _env.get("OMS_CLIENT_SECRET", "3968f218031b43d59afb4e0ef5c38890")
OMS_EMAIL = _env.get("OMS_EMAIL", "308170378@qq.com")
OMS_WAREHOUSE = _env.get("OMS_WAREHOUSE", "MM01")

at, uid = "", 0

# ==================== 工具函数 ====================

def _baas(table, method, payload=None):
    url = f"{BAAS}/api/data/invoke?table={table}&method={method}"
    for _ in range(3):
        try:
            r = requests.post(url, json=payload or {}, headers={"CODE_FLYING": BAAS_KEY, "Content-Type": "application/json"}, timeout=30)
            j = r.json()
            if j.get("success"):
                return j.get("data", [])
            msg = j.get("message","")
            if "Too many requests" in msg:
                time.sleep(3)
                continue
            print(f"  ⚠️ BaaS [{method} {table}]: {msg}")
            return []
        except Exception as e:
            print(f"  ⚠️ {e}")
            time.sleep(2)
    return []

def list_all(table):
    """分页列出全部数据（BaaS 不分页，一次性拉取）"""
    rows = _baas(table, "list", {"pageNo":1,"pageSize":500})
    return rows if rows else []

def load_cache():
    try:
        with open(CACHE_FILE) as f:
            return json.load(f)
    except:
        return {}

def save_cache(d):
    with open(CACHE_FILE, "w") as f:
        json.dump(d, f)

def ensure_auth():
    global at, uid
    cache = load_cache()
    now = int(time.time()*1000)
    if cache.get("accessToken") and cache.get("expireAt",0) > now:
        at, uid = cache["accessToken"], cache.get("userId",0)
        return True
    if cache.get("refreshToken"):
        try:
            r = requests.get(f"https://{OMS_DOMAIN}/api/oauth/refreshToken",
                params={"clientId": OMS_CID, "refreshToken": cache["refreshToken"],
                        "userId": cache.get("userId",0)}, timeout=15, verify=False)
            d = r.json().get("data",{})
            if d.get("accessToken"):
                at, uid = d["accessToken"], d.get("userId",0)
                save_cache({"accessToken": at, "refreshToken": d.get("refreshToken", cache["refreshToken"]),
                            "userId": uid, "expireAt": d.get("expireIn", now+3600000)})
                return True
        except:
            pass
    return False

def _sign(path):
    nonce = str(random.randint(100000,999999999))
    ts = str(int(time.time()*1000))
    ss = "&".join([f"{k}={v}" for k,v in sorted({
        "accessToken":at,"clientId":OMS_CID,"method":"post",
        "nonce":nonce,"timestamp":ts,"url":path,"userId":str(uid)}.items())])
    h = hmac.new(OMS_SECRET.encode(), ss.encode(), hashlib.sha256).hexdigest()
    return {"clientId":OMS_CID,"accessToken":at,"timestamp":ts,"nonce":nonce,
            "userId":str(uid),"sign":h,"Content-Type":"application/json"}

def fetch_all(path, body_builder, key_builder):
    data = {}
    page = 1
    while True:
        body = body_builder(page)
        r = requests.post(f"https://{OMS_DOMAIN}{path}", json=body,
            headers=_sign(path), timeout=30, verify=False)
        j = r.json()
        if j.get("code") != 0: break
        rows = j.get("data",{}).get("rows",[]) or j.get("data",{}).get("page",{}).get("rows",[])
        for x in rows:
            k = key_builder(x)
            if k: data[k] = x
        total = j.get("data",{}).get("totalSize",0) or j.get("data",{}).get("page",{}).get("totalSize",0)
        if len(data) >= total: break
        page += 1
        time.sleep(0.03)
    return data

# ==================== 批量写入 ====================

def batch_write(table, rows, id_key="id", batch_size=50):
    """批量写入 BaaS 表（先查现有数据，只写增量+更新）"""
    existing = list_all(table)
    existing_map = {r.get("sku",""): r for r in existing}
    print(f"    📊 {table} 已有 {len(existing_map)} 条", flush=True)

    to_add, to_update = [], []
    for row in rows:
        sku = row.get("sku","")
        if sku in existing_map:
            old = existing_map[sku]
            # 检查是否有变化
            changed = any(
                row.get(k) != old.get(k) for k in ["stock","name","image_url"]
            )
            if changed:
                to_update.append(row)
        else:
            to_add.append(row)

    print(f"    ➕ 新增 {len(to_add)} 条, ✏️ 更新 {len(to_update)} 条", flush=True)

    added, updated = 0, 0

    # 批量新增
    if to_add:
        print(f"    ➕ 写入新增...", end=" ", flush=True)
        for i in range(0, len(to_add), batch_size):
            batch = to_add[i:i+batch_size]
            for item in batch:
                _baas(table, "add", item)
                added += 1
            print(f"#{added}", end=" ", flush=True)
            time.sleep(0.5)  # 限流
        print()

    # 批量更新（只更新库存、名称、图片）
    if to_update:
        print(f"    ✏️ 写入更新...", end=" ", flush=True)
        for i in range(0, len(to_update), batch_size):
            batch = to_update[i:i+batch_size]
            for item in batch:
                sku = item["sku"]
                eid = existing_map[sku].get("id")
                if eid:
                    _baas(table, "update", {
                        "id": eid,
                        "stock": item.get("stock", 0),
                        "name": item.get("name", ""),
                        "image_url": item.get("image_url", ""),
                        "original_stock": item.get("stock", 0),
                    })
                    updated += 1
            print(f"#{updated}", end=" ", flush=True)
            time.sleep(0.5)
        print()

    return added, updated

# ==================== 主流程 ====================

def main():
    print(f"\n{'='*50}")
    print(f"  OMS → products 同步 @ {datetime.now().isoformat()}")
    print(f"{'='*50}")

    if not ensure_auth():
        print("❌ 认证失败，token 可能过期")
        sys.exit(1)

    # 1. 拉 OMS 数据
    print("\n📡 拉取 OMS SKU 详情...", flush=True)
    sku_data = fetch_all("/api/sku/detail",
        lambda p: {"pageNo": p, "pageSize": 300},
        lambda x: (x.get("sku") or "").strip())
    print(f"  ✅ {len(sku_data)} SKU", flush=True)

    print("📡 拉取 OMS 库存...", flush=True)
    inv_data = fetch_all("/api/inventory/queryInventory",
        lambda p: {"warehouse": OMS_WAREHOUSE, "pageNo": p, "pageSize": 300},
        lambda x: (x.get("sku") or "").strip())
    print(f"  ✅ {len(inv_data)} 库存记录", flush=True)

    # 2. 合并
    print("📡 合并数据...", flush=True)
    merged = []
    all_skus = set(sku_data.keys()) | set(inv_data.keys())
    for sku in sorted(all_skus):
        sd = sku_data.get(sku, {})
        iv = inv_data.get(sku, {})
        stock = iv.get("totalNum", 0) or 0
        merged.append({
            "sku": sku,
            "name": sd.get("name", "") or sku,
            "stock": stock,
            "original_stock": stock,
            "image_url": sd.get("imgUrl", "") or "",
            "price_cny": 0,
            "price_usd": 0,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    print(f"  ✅ 合并后 {len(merged)} 条", flush=True)

    # 3. 写入 products 表
    print("\n📡 写入 products 表（商品管理）...", flush=True)
    start = time.time()
    added, updated = batch_write("products", merged, batch_size=30)
    elapsed = time.time() - start
    print(f"\n✅ 完成! 新增 {added}, 更新 {updated}, 耗时 {elapsed:.0f}s", flush=True)

    # 4. 更新同步状态到 settings
    log_entry = {
        "time": datetime.now().isoformat(timespec="seconds"),
        "success": True,
        "total": len(merged),
        "products_added": added,
        "products_updated": updated,
        "elapsed": f"{elapsed:.0f}s"
    }
    rows = _baas("settings", "list", {"pageNo":1,"pageSize":1})
    if rows:
        sid = rows[0]["id"]
        raw = rows[0].get("omsSync", "{}")
        oms = json.loads(raw) if isinstance(raw, str) else raw
        oms["lastSync"] = log_entry["time"]
        oms["manualTrigger"] = False
        oms["skuCount"] = len(merged)
        logs = oms.get("syncLog", [])
        logs.insert(0, log_entry)
        oms["syncLog"] = logs[:50]
        _baas("settings", "update", {"id": sid, "omsSync": json.dumps(oms)})
        print("📝 同步状态已记录", flush=True)

if __name__ == "__main__":
    main()
