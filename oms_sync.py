#!/usr/bin/env python3
"""
OMS 库存同步守护脚本
- 全量同步 SKU 详情 + 库存到 BaaS oms_products 表（含库存=0的SKU）
- 支持手动触发（前端写 manualTrigger=true 到 settings）
- 支持每日定时同步
- 自动用 refreshToken 续期 AccessToken
"""
import requests, json, hashlib, hmac, random, time, sys, os, argparse
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "oms_token_cache.json")
BAAS = "https://baas.kuafuai.net/baas-api"
BAAS_KEY = "baas_CJbcgwuf"

# OMS 固定凭证
OMS_DOMAIN = "ftnet.jfwms.com"
OMS_CID = "fa5f768a7b32449e9350fcb3dedfd5f7"
OMS_SECRET = "3968f218031b43d59afb4e0ef5c38890"
OMS_EMAIL = "308170378@qq.com"
OMS_WAREHOUSE = "MM01"

at, uid = "", 0

# ==================== BaaS 工具 ====================

def _baas_req(table, method, payload=None):
    url = f"{BAAS}/api/data/invoke?table={table}&method={method}"
    r = requests.post(url, json=payload or {}, headers={"CODE_FLYING": BAAS_KEY, "Content-Type": "application/json"}, timeout=30)
    j = r.json()
    if not j.get("success"):
        raise Exception(f"BaaS {method} [{table}] 失败: {j.get('message')}")
    return j.get("data", [])

def list_all(table, page_size=500):
    all_data, page = [], 1
    while True:
        rows = _baas_req(table, "list", {"pageNo": page, "pageSize": page_size})
        if not rows:
            break
        all_data.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
    return all_data

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

    # 4. 写入 BaaS oms_products
    print("  📡 写入 oms_products...", end=" ", flush=True)
    existing = {}
    for item in list_all("oms_products"):
        existing[item["sku"]] = item["id"]

    add_c, upd_c = 0, 0
    for sku, data in merged.items():
        if sku in existing:
            try:
                _baas_req("oms_products", "update", {"id": existing[sku], **data})
                upd_c += 1
            except:
                pass
        else:
            try:
                _baas_req("oms_products", "add", data)
                add_c += 1
            except:
                pass
        if (add_c + upd_c) % 200 == 0:
            print(".", end="", flush=True)
    print(f" 新增{add_c} 更新{upd_c}")

    # 5. 更新同步日志
    elapsed = time.time() - start
    log_entry = {"time": datetime.now().isoformat(timespec="seconds"),
                 "success": True, "total": len(merged),
                 "added": add_c, "updated": upd_c, "elapsed": f"{elapsed:.0f}s"}
    save_oms_field("lastSync", log_entry["time"])
    save_oms_field("manualTrigger", False)

    # 追加日志（保留最近50条）
    s = load_settings()
    logs = s.get("syncLog", []) if s else []
    logs.insert(0, log_entry)
    save_oms_field("syncLog", logs[:50])

    print(f"  ✅ 完成 ({elapsed:.0f}s): {len(merged)} SKU")
    return {"success": True, "total": len(merged), "added": add_c, "updated": upd_c, "elapsed": f"{elapsed:.0f}s"}

# ==================== 守护进程 ====================

def daemon():
    print(f"\n{'='*50}")
    print(f"  OMS 同步守护进程启动 @ {datetime.now().isoformat()}")
    print(f"{'='*50}")

    # 首次同步
    sync()

    last_auto = time.time()
    while True:
        try:
            time.sleep(30)
            
            # 检查手动触发
            s = load_settings()
            if s and s.get("manualTrigger"):
                print(f"[{datetime.now().isoformat()}] 🚀 手动触发同步")
                sync()
                continue

            # 每日定时
            if s and s.get("scheduleTime"):
                now = datetime.now()
                if now.strftime("%H:%M") == s["scheduleTime"] and s.get("lastScheduledDate") != now.strftime("%Y-%m-%d"):
                    print(f"[{datetime.now().isoformat()}] ⏰ 定时同步: {s['scheduleTime']}")
                    sync()
                    save_oms_field("lastScheduledDate", now.strftime("%Y-%m-%d"))
                    continue

            # 每 60 分钟自动同步
            if time.time() - last_auto >= 3600:
                print(f"[{datetime.now().isoformat()}] ⏰ 小时同步")
                sync()
                last_auto = time.time()

        except KeyboardInterrupt:
            print("\n⏹️  停止")
            break
        except Exception as e:
            print(f"  ⚠️ {e}")
            time.sleep(30)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--token", help="一次性授权 Token")
    p.add_argument("--daemon", action="store_true", help="守护进程模式")
    p.add_argument("--sync", action="store_true", help="立即同步")
    a = p.parse_args()

    if a.daemon:
        daemon()
    elif a.sync or a.token:
        r = sync(fresh_token=a.token)
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        r = sync()
        print(json.dumps(r, indent=2, ensure_ascii=False))
