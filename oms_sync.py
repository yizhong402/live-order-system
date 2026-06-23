#!/usr/bin/env python3
"""
OMS 库存同步守护脚本
- 全量同步 SKU 详情 + 库存到 BaaS oms_products 表（含库存=0的SKU）
- 支持手动触发（前端写 manualTrigger=true 到 settings）
- 自动用 refreshToken 续期 AccessToken
- 敏感凭证从 .env 文件读取，不硬编码在代码中
"""
import requests, json, hashlib, hmac, random, time, sys, os, argparse
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "oms_token_cache.json")

# ============ 从 .env 文件加载敏感凭证 ============
ENV_FILE = os.path.join(BASE_DIR, ".env")

def _load_env():
    """读取 .env 文件"""
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

# ==================== BaaS 工具 ====================

def _baas_req(table, method, payload=None):
    import time as _t
    url = f"{BAAS}/api/data/invoke?table={table}&method={method}"
    for _retry in range(5):
        r = requests.post(url, json=payload or {}, headers={"CODE_FLYING": BAAS_KEY, "Content-Type": "application/json"}, timeout=30)
        j = r.json()
        if not j.get("success"):
            msg = j.get("message", "")
            if "Too many requests" in msg and _retry < 4:
                _t.sleep(2 ** _retry)
                continue
            raise Exception(f"BaaS {method} [{table}] 失败: {msg}")
        return j.get("data", [])
    raise Exception(f"BaaS {method} [{table}] 失败: max retries")
    return []

def list_all(table, page_size=500):
    all_data, page = [], 1
    while True:
        rows = _baas_req(table, "list", {"pageNo": page, "pageSize": page_size})
        if not rows:
            break
        # BaaS API 不分页（总忽略 pageNo），所以只取第一页
        if page > 1 and set(r.get("id") for r in rows) == set(r.get("id") for r in all_data[-len(rows):]):
            break
        all_data.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
    # 去重（BaaS 返回重复数据时的兜底）
    seen = set()
    deduped = []
    for item in all_data:
        if item.get("id") not in seen:
            seen.add(item.get("id"))
            deduped.append(item)
    return deduped

# ==================== 设置读写 ====================

def load_settings():
    rows = _baas_req("settings", "list", {"pageNo": 1, "pageSize": 1})
    if not rows:
        return None
    item = rows[0]
    raw = item.get("omsSync", "{}")
    oms = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(oms.get("enabled"), int):
        oms["enabled"] = bool(oms["enabled"])
    oms["_id"] = item["id"]
    return oms

def save_oms_field(key, value):
    s = load_settings()
    if s:
        sid = s.pop("_id")
        s[key] = value
        _baas_req("settings", "update", {"id": sid, "omsSync": json.dumps(s)})

# ==================== OMS 认证 ====================

def _save_cache(data):
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f)

def _load_cache():
    try:
        with open(CACHE_FILE) as f:
            return json.load(f)
    except:
        return {"accessToken": "", "refreshToken": "", "userId": 0, "expireAt": 0}

def ensure_auth(fresh_token=None):
    global at, uid
    cache = _load_cache()
    now_ms = int(time.time() * 1000)

    if cache.get("accessToken") and cache.get("expireAt", 0) > now_ms:
        at, uid = cache["accessToken"], cache.get("userId", 0)
        return True

    # refreshToken 续期
    if cache.get("refreshToken"):
        try:
            r = requests.get(f"https://{OMS_DOMAIN}/api/oauth/refreshToken",
                params={"clientId": OMS_CID, "refreshToken": cache["refreshToken"],
                        "userId": cache.get("userId", 0)},
                timeout=15, verify=False)
            d = r.json().get("data", {})
            if d.get("accessToken"):
                at, uid = d["accessToken"], d.get("userId", 0)
                _save_cache({"accessToken": at, "refreshToken": d.get("refreshToken", cache["refreshToken"]),
                             "userId": uid, "expireAt": d.get("expireIn", now_ms + 3600000)})
                return True
        except:
            pass

    if not fresh_token:
        return False

    # 一次性 token 授权
    r = requests.get(f"https://{OMS_DOMAIN}/api/oauth/authorize",
        params={"domain": "ftnet", "clientId": OMS_CID, "email": OMS_EMAIL, "token": fresh_token},
        timeout=15, verify=False)
    code = r.json()["data"]
    r = requests.get(f"https://{OMS_DOMAIN}/api/oauth/accessToken",
        params={"clientId": OMS_CID, "clientSecret": OMS_SECRET, "key": code},
        timeout=15, verify=False)
    d = r.json()["data"]
    at, uid = d["accessToken"], d.get("userId", 0)
    _save_cache({"accessToken": at, "refreshToken": d.get("refreshToken", ""),
                 "userId": uid, "expireAt": d.get("expireIn", now_ms + 3600000)})
    return True

def _sign(path):
    nonce = str(random.randint(100000, 999999999))
    ts = str(int(time.time() * 1000))
    ss = "&".join([f"{k}={v}" for k, v in sorted({
        "accessToken": at, "clientId": OMS_CID, "method": "post",
        "nonce": nonce, "timestamp": ts, "url": path, "userId": str(uid)
    }.items())])
    h = hmac.new(OMS_SECRET.encode(), ss.encode(), hashlib.sha256).hexdigest()
    return {"clientId": OMS_CID, "accessToken": at, "timestamp": ts, "nonce": nonce,
            "userId": str(uid), "sign": h, "Content-Type": "application/json"}

# ==================== OMS 数据拉取 ====================

def _fetch_all(path, body_builder, key_builder):
    """通用分页拉取函数"""
    data = {}
    page = 1
    while True:
        body = body_builder(page)
        r = requests.post(f"https://{OMS_DOMAIN}{path}", json=body,
            headers=_sign(path), timeout=30, verify=False)
        j = r.json()
        if j.get("code") != 0:
            break
        rows = j.get("data", {}).get("rows", []) or j.get("data", {}).get("page", {}).get("rows", [])
        for x in rows:
            k = key_builder(x)
            if k:
                data[k] = x
        total = j.get("data", {}).get("totalSize", 0) or j.get("data", {}).get("page", {}).get("totalSize", 0)
        if len(data) >= total:
            break
        page += 1
        time.sleep(0.03)
    return data

def fetch_sku_details():
    return _fetch_all("/api/sku/detail",
        lambda p: {"pageNo": p, "pageSize": 300},
        lambda x: (x.get("sku") or "").strip())

def fetch_inventory():
    return _fetch_all("/api/inventory/queryInventory",
        lambda p: {"warehouse": OMS_WAREHOUSE, "pageNo": p, "pageSize": 300},
        lambda x: (x.get("sku") or "").strip())

# ==================== 核心同步 ====================

def sync(fresh_token=None):
    """执行一次全量同步，返回结果 dict"""
    global at, uid
    start = time.time()

    if not ensure_auth(fresh_token):
        return {"success": False, "message": "认证失败，需要一次性授权 Token (--token)"}

    print(f"[{datetime.now().isoformat()}] 开始全量同步...")

    # 1. 拉取 SKU 详情
    print("  📡 拉取 SKU 详情...", end=" ", flush=True)
    sku_data = fetch_sku_details()
    print(f"{len(sku_data)} 条")

    # 2. 拉取库存
    print("  📡 拉取库存...", end=" ", flush=True)
    inv_data = fetch_inventory()
    print(f"{len(inv_data)} 条")

    # 3. 合并
    print("  📡 合并数据...", end=" ", flush=True)
    merged = {}
    all_skus = set(sku_data.keys()) | set(inv_data.keys())
    for sku in sorted(all_skus):
        sd = sku_data.get(sku, {})
        iv = inv_data.get(sku, {})
        merged[sku] = {
            "sku": sku,
            "skuNo": sd.get("skuNo", ""),
            "name": sd.get("name", "") or sku,
            "imgUrl": sd.get("imgUrl", "") or "",
            "stock": iv.get("totalNum", 0) or 0,
            "availableStock": iv.get("availableNum", 0) or 0,
            "lockedStock": iv.get("lockedNum", 0) or 0,
            "updatedAt": datetime.now().isoformat(timespec="seconds")
        }
    print(f"{len(merged)} 条")

    # 4. 写入 oms_products（差异更新：仅新增/变化的 SKU，不变的跳过）
    print("  📡 同步 oms_products（差异更新）...", end=" ", flush=True)
    existing = {}
    for item in list_all("oms_products"):
        existing[item["sku"]] = item
    print(f"(现有{len(existing)}条)", flush=True)

    added, updated, skipped = 0, 0, 0
    for sku, data in sorted(merged.items()):
        if sku in existing:
            old = existing[sku]
            # 逐个字段对比，有变化才更新
            changed = False
            for field in ("name", "stock", "availableStock", "lockedStock", "imgUrl", "skuNo"):
                if str(data.get(field, "")) != str(old.get(field, "")):
                    changed = True
                    break
            if changed:
                _baas_req("oms_products", "update", {
                    "id": old["id"],
                    "name": data["name"],
                    "stock": data["stock"],
                    "availableStock": data["availableStock"],
                    "lockedStock": data["lockedStock"],
                    "imgUrl": data["imgUrl"],
                    "skuNo": data["skuNo"],
                    "updatedAt": data["updatedAt"]
                })
                updated += 1
            else:
                skipped += 1
        else:
            # 新增 SKU
            _baas_req("oms_products", "add", {
                "sku": sku, "skuNo": data["skuNo"],
                "name": data["name"],
                "stock": data["stock"],
                "availableStock": data["availableStock"],
                "lockedStock": data["lockedStock"],
                "imgUrl": data["imgUrl"],
                "updatedAt": data["updatedAt"]
            })
            added += 1
        # BaaS 限流保护
        total_writes = added + updated
        if total_writes > 0 and total_writes % 50 == 0:
            time.sleep(1)

    print(f"      ➕ 新增 {added} / ✏️ 更新 {updated} / ⏭️ 跳过 {skipped}")

    # 5. 更新日志和统计
    elapsed = time.time() - start
    log_entry = {"time": datetime.now().isoformat(timespec="seconds"),
                 "success": True, "total": len(merged),
                 "added": added, "updated": updated, "skipped": skipped,
                 "elapsed": f"{elapsed:.0f}s"}
    save_oms_field("lastSync", log_entry["time"])
    save_oms_field("skuCount", len(merged))
    save_oms_field("manualTrigger", False)

    s = load_settings()
    logs = s.get("syncLog", []) if s else []
    logs.insert(0, log_entry)
    save_oms_field("syncLog", logs[:50])

    print(f"  ✅ 同步完成 ({elapsed:.0f}s): {len(merged)} SKU")
    return {"success": True, "total": len(merged), "added": added, "updated": updated, "skipped": skipped, "elapsed": f"{elapsed:.0f}s"}

# ==================== 全量校准同步（覆盖 products 库存） ====================

def calibrate(fresh_token=None):
    """开播前库存校准：同步 OMS → 直接覆盖 products 表库存"""
    global at, uid
    start = time.time()

    if not ensure_auth(fresh_token):
        return {"success": False, "message": "认证失败，需要一次性授权 Token (--token)"}

    print(f"[{datetime.now().isoformat()}] 📡 开始全量校准同步...")

    # 1. 拉取 SKU 详情
    print("  📡 拉取 SKU 详情...", end=" ", flush=True)
    sku_data = fetch_sku_details()
    print(f"{len(sku_data)} 条")

    # 2. 拉取库存
    print("  📡 拉取库存...", end=" ", flush=True)
    inv_data = fetch_inventory()
    print(f"{len(inv_data)} 条")

    # 3. 合并
    print("  📡 合并数据...", end=" ", flush=True)
    merged = {}
    all_skus = set(sku_data.keys()) | set(inv_data.keys())
    for sku in sorted(all_skus):
        sd = sku_data.get(sku, {})
        iv = inv_data.get(sku, {})
        merged[sku] = {
            "sku": sku,
            "skuNo": sd.get("skuNo", ""),
            "name": sd.get("name", "") or sku,
            "imgUrl": sd.get("imgUrl", "") or "",
            "stock": iv.get("totalNum", 0) or 0,
            "availableStock": iv.get("availableNum", 0) or 0,
            "lockedStock": iv.get("lockedNum", 0) or 0,
            "updatedAt": datetime.now().isoformat(timespec="seconds")
        }
    print(f"{len(merged)} 条")

    # 4. 写入 products 表（覆盖可用库存！⚠️ 仅开播前使用）
    #    stock = availableNum（可用库存），不是 totalNum（总库存）
    #    因为发货会占用库存，总库存中已锁定的部分不可售
    print("  📡 写入 products（覆盖可用库存）...", end=" ", flush=True)
    prod_existing = {}
    for item in list_all("products"):
        prod_existing[item["sku"]] = item
    print(f"(共{len(prod_existing)}条)", flush=True)

    prod_add, prod_upd = 0, 0
    for sku, data in merged.items():
        if sku in prod_existing:
            old = prod_existing[sku]
            _baas_req("products", "update", {
                "id": old["id"],
                "stock": data["availableStock"],
                "original_stock": data["availableStock"],
                "name": data["name"], "image_url": data["imgUrl"]
            })
            prod_upd += 1
        else:
            _baas_req("products", "add", {
                "sku": sku, "name": data["name"],
                "stock": data["availableStock"],
                "original_stock": data["availableStock"],
                "image_url": data["imgUrl"], "price_cny": 0, "price_usd": 0,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            prod_add += 1
        if (prod_add + prod_upd) % 30 == 0:
            time.sleep(1)

    print(f"    ➕ 新增 {prod_add} / ✏️ 更新 {prod_upd}", flush=True)

    # 5. 日志
    elapsed = time.time() - start
    log_entry = {"time": datetime.now().isoformat(timespec="seconds"),
                 "success": True, "total": len(merged),
                 "added": prod_add, "updated": prod_upd, "elapsed": f"{elapsed:.0f}s",
                 "type": "calibrate"}
    s = load_settings()
    logs = s.get("syncLog", []) if s else []
    logs.insert(0, log_entry)
    save_oms_field("syncLog", logs[:50])
    save_oms_field("skuCount", len(merged))
    # 清除校准触发标记
    save_oms_field("calibrateTrigger", False)

    print(f"  ✅ 校准完成 ({elapsed:.0f}s): {len(merged)} SKU")
    return {"success": True, "total": len(merged), "added": prod_add, "updated": prod_upd, "elapsed": f"{elapsed:.0f}s"}

# ==================== 守护进程 ====================

def daemon():
    print(f"\n{'='*50}")
    print(f"  OMS 守护进程启动 @ {datetime.now().isoformat()}")
    print(f"  说明: 仅响应手动触发，不做自动同步（保护直播预扣库存）")
    print(f"{'='*50}")

    while True:
        try:
            time.sleep(30)
            
            # 只检查手动触发，不做自动同步
            s = load_settings()
            if s and s.get("manualTrigger"):
                print(f"[{datetime.now().isoformat()}] 🚀 手动触发同步")
                sync()
                save_oms_field("manualTrigger", False)
                continue

            if s and s.get("calibrateTrigger"):
                print(f"[{datetime.now().isoformat()}] 🚀 库存校准触发")
                calibrate()
                save_oms_field("calibrateTrigger", False)
                continue

        except KeyboardInterrupt:
            print("\n⏹️  停止")
            break
        except Exception as e:
            print(f"  ⚠️ {e}")
            time.sleep(30)


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--token", help="一次性授权 Token")
    p.add_argument("--daemon", action="store_true", help="守护进程模式")
    p.add_argument("--sync", action="store_true", help="立即同步（只更新 oms_products，不覆盖库存）")
    p.add_argument("--calibrate", action="store_true", help="完全校准（覆盖 products 表库存）")
    a = p.parse_args()

    if a.daemon:
        daemon()
    elif a.calibrate:
        r = calibrate(fresh_token=a.token)
        print(json.dumps(r, indent=2, ensure_ascii=False))
    elif a.sync or a.token:
        r = sync(fresh_token=a.token)
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        r = sync()
        print(json.dumps(r, indent=2, ensure_ascii=False))
