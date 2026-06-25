#!/usr/bin/env python3
"""
stock_snapshot.py — 库存快照脚本
每天 08:00 由 cron 触发：
  1. 读取 BaaS products 表全量 SKU + stock
  2. 写入 data/stock-snapshots.json（按日期 key）
  3. 不碰 OMS 校准，完全独立

首次执行会创建 data/ 目录和 stock-snapshots.json 文件。
同一天多次执行幂等，覆盖当天数据。
"""
import os, json, sys, time
import requests
from datetime import date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
SNAPSHOT_FILE = os.path.join(DATA_DIR, 'stock-snapshots.json')

# ===== 从 .env 读取 BaaS 凭证（复用 oms_sync.py 的方式）=====
ENV_FILE = os.path.join(BASE_DIR, '.env')

def _load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip("'\"")
    return env

_env = _load_env()
BAAS_URL = _env.get('BAAS_URL', 'https://baas.kuafuai.net/baas-api')
BAAS_KEY = 'baas_CJbcgwuf'  # from .env
BAAS_HEADERS = {'CODE_FLYING': BAAS_KEY, 'Content-Type': 'application/json'}

def _baas_req(table, method, payload=None):
    """BaaS API 请求（同 oms_sync.py 的方式）"""
    url = f"{BAAS_URL}/api/data/invoke?table={table}&method={method}"
    for _retry in range(5):
        r = requests.post(url, json=payload or {}, headers=BAAS_HEADERS, timeout=30)
        j = r.json()
        if not j.get('success'):
            msg = j.get('message', '')
            if 'Too many requests' in msg and _retry < 4:
                time.sleep(2 ** _retry)
                continue
            raise Exception(f"BaaS {method} [{table}] 失败: {msg}")
        return j.get('data', [])
    raise Exception(f"BaaS {method} [{table}] 失败: max retries")

def list_all_products():
    """读取 products 表所有 SKU 的库存"""
    rows = _baas_req('products', 'list', {'pageNo': 1, 'pageSize': 5000})
    result = {}
    for p in rows:
        sku = (p.get('sku') or '').strip()
        if sku:
            result[sku] = p.get('stock', 0) or 0
    return result

def load_existing_snapshots():
    """读取已有的快照文件"""
    if not os.path.exists(SNAPSHOT_FILE):
        return {}
    try:
        with open(SNAPSHOT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def save_snapshot():
    """主流程：拍快照"""
    os.makedirs(DATA_DIR, exist_ok=True)

    print(f"[{date.today()}] 读取 BaaS products...", end=' ', flush=True)
    inventory = list_all_products()
    print(f"{len(inventory)} 个 SKU")

    snapshots = load_existing_snapshots()
    today_key = date.today().isoformat()  # YYYY-MM-DD
    snapshots[today_key] = inventory

    with open(SNAPSHOT_FILE, 'w', encoding='utf-8') as f:
        json.dump(snapshots, f, ensure_ascii=False, indent=2)

    print(f"✅ 快照已保存: {SNAPSHOT_FILE}")
    print(f"   日期: {today_key}, SKU 数: {len(inventory)}")
    print(f"   快照总天数: {len(snapshots)}")
    return True

if __name__ == '__main__':
    try:
        save_snapshot()
    except Exception as e:
        print(f"❌ 快照失败: {e}", file=sys.stderr)
        sys.exit(1)
