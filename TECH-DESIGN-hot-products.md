# 技术方案 — 首页热销品 & 商品新上架

---

## 1. 文件结构

```
/tmp/live-order-system/
├── stock_snapshot.py          # [新增] 快照脚本
├── data/
│   └── stock-snapshots.json   # [新增] 快照数据
├── index.html                 # [修改] 首页+商品页
├── js/
│   └── services/
│       ├── app.js             # [修改] 新增快照加载函数
│       └── product.js         # [修改] 新增新上架渲染
└── css/
    └── style.css              # [可能修改] 新样式
```

## 2. stock_snapshot.py（新增）

### 职责
- 每天 08:00 自动执行一次
- 读取 BaaS `products` 表所有 SKU 的当前库存
- 写入本地 `data/stock-snapshots.json`（按日期分组）

### BaaS API
复用 `oms_sync.py` 已使用的接口格式：
```
POST /api/data/invoke?table=products&method=list
Headers: CODE_FLYING=<api_key>, Content-Type=application/json
```

### 快照数据格式
```json
{
  "2026-06-25": { "BA0125111905": 2, "A6-GRID-0509": 50 },
  "2026-06-26": { "BA0125111905": 1, "A6-GRID-0509": 45 }
}
```

### 执行流程
```
1. 读取现有快照文件（如果存在）
2. 从 BaaS products 表获取全量 SKU + stock
3. 设置 key = 当天日期字符串
4. 组装 { key: { sku: stock, ... } } 追加到快照对象
5. 写回文件
```

### 幂等性
同一天多次执行 → 覆盖当天数据，不会重复。

## 3. 首页热销品 Top 20（前端）

### 数据源
```
fetch('/data/stock-snapshots.json')
→ 取最近2天快照 → 逐SKU算差值
```

### 热销度算法
```js
const snapshots = await loadStockSnapshots(); // { "2026-06-25":{...}, "2026-06-26":{...} }
const dates = Object.keys(snapshots).sort();
const prev = snapshots[dates[dates.length - 2]]; // 前一天
const curr = snapshots[dates[dates.length - 1]]; // 当天

// 热销 = 前一天库存 - 当天库存 > 0
// 新上架 = 前一天无此SKU或库存=0，当天>0
```

### UI 布局（替换当前"库存概览"）
```
┌──────────────────────────────────────────┐
│  🔥 热销品 Top 20                        │
│                                          │
│  [图] BA0125111905  A8成品【含内页+书皮】   │
│        📉 昨日减少：50件  ████████░░░░ 50% │
│                                          │
│  [图] A6-GRID-0509   A6网格               │
│        📉 昨日减少：5件   ████░░░░░░░░   5% │
│                                          │
│  共 3 款热销品（取前 20 名）               │
└──────────────────────────────────────────┘
```

### 刷新联动
首页"🔄 刷新"按钮 → `refreshDashboard()` → `renderHotProducts()`

## 4. 商品管理新上架板块（前端）

### 位置
商品管理页顶部、搜索筛选区上方。

### UI 布局
```
┌──────────────────────────────────────────┐
│  🆕 新上架产品    日期: [▼ 2026-06-26]    │
│  排序: [▼ 库存从多到少]                    │
│                                          │
│  [图] NEW-SKU-001  新品A   库存:80  ¥0/$0 │
│  [图] NEW-SKU-002  新品B   库存:30  ¥0/$0 │
│                                          │
│  共 2 款新上架产品                         │
└──────────────────────────────────────────┘
```

### 排序逻辑
- 默认：库存从多到少
- 可切换：库存从少到多

## 5. 涉及的所有修改汇总

| 文件 | 改什么 | 影响范围 |
|------|--------|---------|
| `stock_snapshot.py` | 新脚本 | ⚫ 数据层（不碰现有代码） |
| `index.html` | 首页：替换库存概览区；商品页：新增新上架板块 | 仅UI |
| `app.js` | 新增 `loadStockSnapshots()`, `renderHotProducts()` | 首页渲染 |
| `product.js` | 新增 `renderNewProducts()`, `renderNewProductDateFilter()` | 商品页渲染 |
| `style.css` | 可能新增热销卡片样式 | 仅样式 |

## 6. 风险与边界

| 场景 | 处理方式 |
|------|---------|
| 只有1天快照（今天刚拍，明天还没拍） | 显示"数据准备中，明天08:00后出结果" |
| 某SKU在products表里被删除了 | 快照里还有历史数据，前端 `products.find()` 找不到时跳过 |
| 快照文件不存在 | 显示"暂无快照数据" |
| 热销品不足20个 | 有多少显示多少 |
| 新上架产品为0 | 显示"该日期暂无新上架产品" |
| fastjson加载失败 | 显示"加载失败"，不阻塞其他功能 |
