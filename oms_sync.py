#!/usr/bin/env python3
"""
OMS 库存同步脚本（服务端执行，定时任务）
从 OMS API 同步库存 → 写入 BaaS 云数据库
配置从 BaaS settings 表读取，避免 CORS 问题

用法：
  python3 oms_sync.py [--token xxxx]        # 同步一次
  python3 oms_sync.py --list-warehouses       # 列出仓库
  python3 oms_sync.py --cron                  # 以 cron 模式运行（循环）
"""
import requests, json, hashlib, hmac, random, time, sys, os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "oms_token_cache.json")

BAAS = "https://baas.kuafuai.net/baas-api"
BAAS_KEY = "baas_CJbcgwuf"

at, uid = "", 0

# ==================== BaaS 操作 ====================

def baas_list(table, page_size=1):
    r = requests.post(f"{BAAS}/api/data/invoke?table={table}&method=list",
        json={"pageNo": 1, "pageSize": page_size},
        headers={"CODE_FLYING": BAAS_KEY, "Content-Type": "application/json"}, timeout=30)
    j = r.json()
    if not j.get("success"):
        raise Exception(f"BaaS 查询失败 [{table}]: {j.get('message')}")
    return j.get("data", [])

def baas_update(table, record_id, data):
    r = requests.post(f"{BAAS}/api/data/invoke?table={table}&method=update",
        json={"id": record_id, **data},
        headers={"CODE_FLYING": BAAS_KEY, "Content-Type": "application/json"}, timeout=15)
    j = r.json()
    if not j.get("success"):
        raise Exception(f"BaaS 更新失败: {j.get('message')}")

# ==================== 配置加载（从 BaaS） ====================

def load_config():
    r = baas_list("settings", 1)
    if not r:
        raise Exception("settings 表为空，请先在系统设置中配置 OMS")
    item = r[0]
    oms_raw = item.get("omsSync", "{}")
    if isinstance(oms_raw, str):
        oms = json.loads(oms_raw)
    else:
        oms = oms_raw
    enabled = oms.get("enabled", False)
    if isinstance(enabled, int):
        enabled = bool(enabled)
    return {
        "domain": oms.get("domain", ""),
        "authDomain": oms.get("authDomain", ""),
        "warehouse": oms.get("warehouse", "MM01"),
        "clientId": oms.get("clientId", ""),
        "clientSecret": oms.get("clientSecret", ""),
        "email": oms.get("email", ""),
        "enabled": enabled,
        "settings_id": item.get("id")
    }

def save_sync_log(cfg, log_entry):
    try:
        r = baas_list("settings", 1)
        if r:
            record = r[0]
            oms_raw = record.get("omsSync", "{}")
            if isinstance(oms_raw, str):
                oms = json.loads(oms_raw)
            else:
                oms = oms_raw
            sync_log = oms.get("syncLog", [])
            sync_log.insert(0, log_entry)
            if len(sync_log) > 50:
                sync_log = sync_log[:50]
            oms["lastSync"] = log_entry["time"]
            oms["syncLog"] = sync_log
            baas_update("settings", record["id"], {
                "omsSync": json.dumps(oms)
            })
    except Exception as e:
        print(f"  ⚠️ 保存日志失败: {e}")

# ==================== OMS 认证 ====================

def load_cache():
    try:
        with open(CACHE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"accessToken": "", "refreshToken": "", "userId": 0, "expireAt": 0}

def save_cache(data):
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f, indent=2)

def ensure_auth(cfg, cache, fresh_token=None):
    """确保有有效的 AccessToken。自动用 refreshToken 续期。"""
    global at, uid
    domain = cfg["domain"].replace("https://","").replace("http://","").rstrip("/")
    cid = cfg["clientId"]
    secret = cfg["clientSecret"]
    email = cfg["email"]

    now_ms = int(time.time() * 1000)

    # 缓存未过期 → 直接用
    if cache.get("accessToken") and cache.get("expireAt", 0) > now_ms:
        at = cache["accessToken"]
        uid = cache.get("userId", 0)
        print(f"  ✅ 使用缓存的 AccessToken")
        return

    # 尝试用 refreshToken 续期
    if cache.get("refreshToken"):
        print(f"  🔄 尝试刷新 AccessToken...")
        try:
            r = requests.get(f"https://{domain}/api/oauth/refreshToken",
                params={"clientId": cid, "refreshToken": cache["refreshToken"], "userId": cache.get("userId", 0)},
                timeout=15, verify=False)
            j = r.json()
            if j.get("code") == 0 and j.get("data", {}).get("accessToken"):
                d = j["data"]
                at = d["accessToken"]
                uid = d.get("userId", 0)
                save_cache({
                    "accessToken": at,
                    "refreshToken": d.get("refreshToken", cache["refreshToken"]),
                    "userId": uid,
                    "expireAt": d.get("expireIn", now_ms + 3600000)
                })
                print(f"  ✅ AccessToken 已自动续期: {at[:20]}...")
                return
        except Exception as e:
            print(f"  ⚠️ 刷新 token 失败: {e}")

    # refresh 失败 → 需要一次性 token
    if not fresh_token:
        raise Exception("AccessToken 已过期且 refreshToken 无效，需要 --token 重新授权")

    print("\n📡 重新授权中（使用一次性 Token）...")
    params = {"domain": cfg["authDomain"], "clientId": cid, "email": email, "token": fresh_token}
    r = requests.get(f"https://{domain}/api/oauth/authorize",
        params=params, timeout=15, verify=False)
    j = r.json()
    if j.get("code") != 0:
        raise Exception(f"授权失败: {j.get('message')}")
    code = j["data"]

    r = requests.get(f"https://{domain}/api/oauth/accessToken",
        params={"clientId": cid, "clientSecret": secret, "key": code},
        timeout=15, verify=False)
    j = r.json()
    if j.get("code") != 0:
        raise Exception(f"Token 兑换失败: {j.get('message')}")
    d = j["data"]
    at = d["accessToken"]
    uid = d.get("userId", 0)
    save_cache({"accessToken": at, "refreshToken": d.get("refreshToken", ""),
                "userId": uid, "expireAt": d.get("expireIn", now_ms + 3600000)})
    print(f"  ✅ 授权成功: {at[:20]}... UserID: {uid}")

# ==================== OMS 签名 ====================

def gen_sign(method, path, secret, cid=""):
    global at, uid
    nonce = str(random.randint(100000, 999999999))
    ts = str(int(time.time() * 1000))
    params = {"accessToken": at, "clientId": cid, "method": method.lower(),
              "nonce": nonce, "timestamp": ts, "url": path, "userId": str(uid)}
    sign_str = "&".join([f"{k}={params[k]}" for k in sorted(params)])
    h = hmac.new(secret.encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    return {"clientId": cid, "accessToken": at, "timestamp": ts, "nonce": nonce,
            "userId": str(uid), "sign": h, "Content-Type": "application/json"}

# ==================== 同步核心 ====================

def sync_from_oms(fresh_token=None):
    global at, uid

    try:
        cfg = load_config()
    except Exception as e:
        print(f"❌ 配置读取失败: {e}")
        return False

    if not cfg["enabled"]:
        print("⏸️  OMS 同步未启用（settings.omsSync.enabled = false）")
        return False

    domain = cfg["domain"].replace("https://","").replace("http://","").rstrip("/")
    if not domain or not cfg["clientId"] or not cfg["clientSecret"]:
        print("❌ 配置不完整（domain/clientId/clientSecret）")
        return False

    cache = load_cache()
    warehouse = cfg["warehouse"]
    cid = cfg["clientId"]
    secret = cfg["clientSecret"]

    print(f"\n{'='*50}")
    print(f"🔄 OMS 同步: {datetime.now().isoformat()}")
    print(f"  仓库: {warehouse}, 域名: {domain}")
    print(f"{'='*50}")

    try:
        ensure_auth(cfg, cache, fresh_token)

        print(f"\n📡 查询库存 (warehouse={warehouse})...")
        inv_map, total = {}, 0
        page = 1
        while True:
            headers = gen_sign("POST", "/api/inventory/queryInventory", secret, cid)
            time.sleep(0.05)
            r = requests.post(f"https://{domain}/api/inventory/queryInventory",
                json={"warehouse": warehouse, "pageNo": page, "pageSize": 300},
                headers=headers, timeout=30, verify=False)
            j = r.json()
            if j.get("code") == 10004:
                save_cache({"accessToken": "","refreshToken": "","userId": 0,"expireAt": 0})
                raise Exception("AccessToken 已过期，需要重新授权")
            if j.get("code") != 0:
                if page == 1:
                    raise Exception(f"库存查询失败: {j.get('message')}")
                break
            pg = j.get("data", {}).get("page", {})
            rows = pg.get("rows", [])
            total = pg.get("totalSize", 0)
            for x in rows:
                sku = (x.get("sku", "") or "").strip()
                if sku:
                    inv_map[sku] = {"total": x.get("totalNum", 0) or 0,
                                    "available": x.get("availableNum", 0) or 0,
                                    "locked": x.get("lockedNum", 0) or 0}
            if len(inv_map) >= total:
                break
            page += 1
        print(f"  ✅ 获取到 {len(inv_map)} 个 SKU")

        print("\n📡 对比本地库存...")
        local_products = baas_list("products", 10000)
        print(f"  📦 本地商品: {len(local_products)} 个")

        changes, unmatched = [], 0
        local_map = {p.get("sku"): p for p in local_products if p.get("sku")}
        for sku, inv in inv_map.items():
            p = local_map.get(sku)
            if p:
                old_stock = p.get("stock", 0)
                new_stock = inv["total"]
                if old_stock != new_stock:
                    changes.append({"sku": sku, "id": p["id"], "old": old_stock,
                                    "new": new_stock, "avail": inv["available"],
                                    "lock": inv["locked"]})
            else:
                unmatched += 1
        print(f"  📊 变更: {len(changes)}, 未匹配: {unmatched}")

        if changes:
            print(f"\n📡 更新 {len(changes)} 条库存到 BaaS...")
            ok = 0
            for chg in changes:
                try:
                    baas_update("products", chg["id"], {
                        "stock": chg["new"],
                        "available_num": chg["avail"],
                        "locked_num": chg["lock"]
                    })
                    ok += 1
                except:
                    pass
                if ok % 50 == 0:
                    sys.stdout.write(f"\r  ⏳ {ok}/{len(changes)}")
                    sys.stdout.flush()
            print(f"\n  ✅ {ok}/{len(changes)}")
        else:
            print("  ✅ 无变更")

        # 保存同步日志到 BaaS
        log_entry = {
            "time": datetime.now().isoformat(),
            "success": True,
            "changed": len(changes),
            "total": len(inv_map),
            "updated": len(changes),
            "unmatched": unmatched,
            "message": f"{len(changes)} 变更 / {len(inv_map)} SKU" + (f" ({unmatched} 未匹配)" if unmatched else "")
        }
        save_sync_log(cfg, log_entry)

        print(f"\n✅ 同步完成! {len(changes)} 变更 / {len(inv_map)} SKU{', 未匹配' + str(unmatched) if unmatched else ''}")
        return True

    except Exception as e:
        print(f"\n❌ 同步失败: {e}")
        save_sync_log(cfg, {"time": datetime.now().isoformat(), "success": False,
                            "changed": 0, "total": 0, "unmatched": 0, "message": f"❌ {str(e)[:200]}"})
        return False

# ==================== 仓库列表 ====================

def list_warehouses(fresh_token):
    global at, uid
    cfg = load_config()
    cache = load_cache()
    domain = cfg["domain"].replace("https://","").replace("http://","").rstrip("/")
    cid = cfg["clientId"]
    secret = cfg["clientSecret"]
    ensure_auth(cfg, cache, fresh_token)

    headers = gen_sign("POST", "/api/warehouse/list", secret, cid)
    r = requests.post(f"https://{domain}/api/warehouse/list",
        json={"pageNo": 1, "pageSize": 50},
        headers=headers, timeout=15, verify=False)
    j = r.json()
    print(json.dumps(j, indent=2, ensure_ascii=False))

# ==================== 主入口 ====================

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="OMS 库存同步服务端脚本")
    parser.add_argument("--token", help="OMS 一次性授权 Token")
    parser.add_argument("--list-warehouses", action="store_true", help="列出可用仓库")
    parser.add_argument("--cron", action="store_true", help="定时运行模式（每60分钟执行一次）")
    args = parser.parse_args()

    if args.list_warehouses:
        list_warehouses(args.token)
    elif args.cron:
        print(f"⏰ OMS 定时同步已启动，每60分钟执行一次")
        while True:
            sync_from_oms()
            print(f"\n⏳ 等待 60 分钟... ({datetime.now().isoformat()})\n")
            for i in range(60):
                time.sleep(60)
    else:
        sync_from_oms(fresh_token=args.token)
