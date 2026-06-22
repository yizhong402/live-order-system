# 直播订单管理系统 — 技术方案设计

> 版本: v1.1 | 日期: 2026-06-22 | 对应 PRD v1.0

---

## 1. 架构变更概述

### 1.1 现状 vs 目标

| 维度 | 现状 | 目标 |
|------|------|------|
| 直播会话 | 仅1个活跃 `currentSession` | 多场直播可**同时活跃** |
| 库存 | 本地 products 数组，保存时全量覆盖 | 共享云端库存 + 实时轮询同步 |
| 订单归属 | 所有订单混在一起，靠 `sessionId` 但无隔离 | 按 session_id 过滤，每场只看自己的订单 |
| 数据模型 | `currentSession` 是唯一的"当前场次" | `activeSessions[]` 当前活跃场次列表 |
| 轮次 | `currentRound` 全局唯一 | 每场独立轮次 `sessions[id].currentRound` |

### 1.2 核心原则

1. **一份云端库存** — 所有直播共用 products 表，库存是唯一的真相源
2. **场次隔离** — 订单带 `session_id`，筛选各自所属场次
3. **实时感知** — 短轮询检测库存变化，UI 即时更新
4. **可超卖** — 不强制拦截，但给出醒目的视觉警告

---

## 2. 数据模型变更

### 2.1 现有表结构（不变）
```
products    → products     (共享)
orders      → orders       (新增 session_id 过滤)
combo_skus  → combo_skus   (共享)
live_sessions → live_sessions (保留，作归档用)
```

### 2.2 新增内存数据结构

```javascript
// 全局活跃场次列表
const activeSessions = {};   // { [id]: SessionObject }

// 每场会话的数据结构
const session = {
  id: 1723456789000,
  sessionTitle: 'A场',
  date: '2026-06-22',
  time: '10:00',
  anchor: '张三',
  currentRound: 1,
  lastBaseTitle: '',
  titleRoundMap: {},      // 该场次的竞拍链接→轮次映射
  titleHistory: [],       // 该场次的历史链接
  currentSkus: {},        // 该场次当前操作的SKU
  orders: [],             // 该场次的订单列表（从云端按session_id加载）
  isActive: true,
  createdAt: '2026-06-22 10:00:00'
}

// 当前助理选中的场次ID
let currentSessionId = null;
```

### 2.3 订单表增加字段（存量兼容）

orders 表已有 `session_id` 字段，数据层面无需改表结构。
但查询时需要新增条件：`where session_id = N`

---

## 3. 页面交互变更

### 3.1 顶部栏新增「选择场次」控件

```
┌──────────────────────────────────────────────────────────────┐
│  直播订单管理系统                                            │
│  [PA仓库]  [首页] [订单录入] [商品] [组合] ...            │
│  ┌───────────────────────────────────────────────┐          │
│  │  首页                                         │          │
│  │  ┌───────────────────┐ ┌──────────────────┐   │          │
│  │  │ 当前场次: A场 ▼   │ │ 助理: 张三       │   │  ← 新增
│  │  └───────────────────┘ └──────────────────┘   │          │
│  │                                                │          │
│  │  订单录入 / 商品管理 / ...                     │          │
│  └───────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

**具体实现**：
- 在 topbar 右上角加一个 **场次选择下拉框** + **当前助理名**显示
- 下拉框显示所有 `activeSessions` 中的场次
- 切换时自动切换到该场次的轮次/SKU/订单列表
- 底部加一个 **「新建场次」** 按钮

### 3.2 首页仪表盘新增

```
┌──────────────────────────────────────────────────────────────┐
│  📊 总库存商品: 996  | 活跃场次: 2  | 今日总订单: 52       │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐                           │
│  │ 🎬 A场      │  │ 🎬 B场      │     ← 活跃场次卡片      │
│  │ 订单: 30    │  │ 订单: 22    │                           │
│  │ 轮次: 12    │  │ 轮次: 8     │                           │
│  │ 助理: 张三  │  │ 助理: 李四  │                           │
│  │ [进入]      │  │ [进入]      │                           │
│  └─────────────┘  └─────────────┘                           │
│                                                              │
│  [➕ 创建新场次]                                              │
│                                                              │
│  ⚠️ 库存预警: 12个商品库存不足                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 核心逻辑变更

### 4.1 多场次管理 (session.js 重构)

| 函数 | 变更 |
|------|------|
| `createSession()` | 不再覆盖 `currentSession`，改为插入 `activeSessions[]` |
| `switchSession(id)` | **新增** — 切换当前工作的场次，加载它的轮次/SKU/订单 |
| `endSession(id)` | **新增** — 结束指定场次，归档到 live_history，从 activeSessions 移除 |
| `getCurrentSession()` | **新增** — 返回 `activeSessions[currentSessionId]` |
| `listActiveSessions()` | **新增** — 返回活跃场次列表，给下拉框用 |

### 4.2 订单录入适配多场次 (order.js)

```javascript
// 所有操作改为：
const session = getCurrentSession();
// 读/写 session.currentRound、session.currentSkus、session.orders
// 保存时 orders 带 session.id
```

订单录入页面底部新增**场次切换提示条**：

```
┌──────────────────────────────────────────┐
│  📌 当前场次: A场 (张三) [切换 ▼]        │
│  当前轮次: 7  | 标题: kawaii bundle      │
└──────────────────────────────────────────┘
```

### 4.3 库存实时同步 (product.js)

```javascript
// 新增：定时轮询云端库存
let stockPollTimer = null;

function startStockPolling() {
  stockPollTimer = setInterval(async () => {
    const res = await client.db.from('products').list();
    if (res.success) {
      const cloudProducts = (res.data || []).map(p => ({
        sku: p.sku, stock: p.stock || 0, ...
      }));
      // 对比本地 products 和云端数据
      const changed = findStockChanges(products, cloudProducts);
      if (changed.length > 0) {
        // 更新本地 products
        // 在订单录入页标蓝闪烁显示库存变化
        showStockChangeAlert(changed);
      }
    }
  }, 5000); // 5秒轮询一次
}

function stopStockPolling() {
  if (stockPollTimer) {
    clearInterval(stockPollTimer);
    stockPollTimer = null;
  }
}
```

### 4.4 库存预警机制

```javascript
function checkStockWarning(sku, quantity) {
  const product = products.find(p => p.sku === sku);
  if (!product) return null;
  
  const afterStock = product.stock - quantity;
  
  if (afterStock < 0) {
    return { level: 'oversold', message: `⚠️ 超卖！${sku} 库存仅剩 ${product.stock}，已超卖 ${Math.abs(afterStock)}` };
  } else if (afterStock <= 5) {
    return { level: 'low', message: `⚠️ ${sku} 库存不足：只剩 ${product.stock}，下单后仅剩 ${afterStock}` };
  }
  return null;
}
```

### 4.5 超卖标记维持不变

保持现有 `isOverSold` 标记逻辑，新增库存不足的视觉提示：
- 当前操作区：扫描 SKU 时弹短暂 toast 警告（不阻止操作）
- SKU 列表：库存不足的商品标黄底色，并显示 "⚠️库存仅剩 X"
- 订单列表：超卖订单保持红色标记

---

## 5. 文件变更清单

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `index.html` | 中 | 顶部栏加场次选择控件、首页加活跃场次卡片、订单页加场次提示条 |
| `css/style.css` | 小 | 新增几个样式类（场次选择器、库存预警条） |
| `js/services/session.js` | **大** | 核心重构：`currentSession` → `activeSessions`，新增切换/结束场次逻辑 |
| `js/services/order.js` | 中 | 订单操作改为走 `getCurrentSession()`、增加库存警告 |
| `js/services/product.js` | 中 | 新增库存轮询逻辑、库存变化检测 |
| `js/services/baas-client.js` | 小 | 可选：新增增量库存查询接口 |
| `js/services/app.js` | 小 | 初始化时加载活跃场次、启动/停止轮询 |

---

## 6. 时序流程

### 6.1 开新场次

```
管理员[首页] → 点击"创建新场次" → 填入标题/日期/主播
  → createSession() 
    → 构造 session 对象 
    → activeSessions[id] = session 
    → 写入 live_sessions 表（状态: active）
    → 自动切到该场次
```

### 6.2 助理加入场次

```
助理打开系统 → 顶部选"当前场次"下拉框
  → 列出所有 activeSessions
  → 选择自己的场次 → switchSession(id)
    → 加载该场次的轮次/标题/订单/SKU
    → 显示"当前场次: A场（助理：张三）"
```

### 6.3 扫码录单（多场次场景）

```
助理A在A场扫码"玉桂狗贴纸×2"
  → addSku("BY0125101386")
    → 检查库存: 115 → 113 (OK)
    → A场.currentSkus["BY0125101386"] += 2
    → 本地 products["BY0125101386"].stock -= 2
    → 保存到云端（products 表减库存）
    → UI 更新 SKU 列表

3秒后助理B那边轮询检测到库存变化
  → 云端对比发现 "BY0125101386" 从 115 变 113
  → 更新本地 products
  → 如果助理B正在操作这个SKU → 标黄闪烁提示
```

### 6.4 结束场次

```
管理员 → 在首页点击"结束A场"
  → 确认弹窗（带该场订单统计）
  → endSession(A场.id)
    → 将该场订单归档
    → 更新 live_sessions 表 status='ended'
    → 从 activeSessions 中移除
    → 如果当前助理正在 A 场 → 提示选择其他场次
```

---

## 7. 页面修改细节

### 7.1 topbar 新增区域

在 index.html 的 topbar-right 区域增加：

```html
<div class="topbar-right">
  <div class="session-selector">
    <label>当前场次:</label>
    <select id="sessionSelector" onchange="switchSession(this.value)">
      <option value="">请选择场次</option>
    </select>
  </div>
  <span id="userLabel">助理: --</span>
</div>
```

CSS:
```css
.session-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}
.session-selector select {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.1);
  color: #fff;
  font-size: 13px;
}
```

### 7.2 首页新增活跃场次卡片区域

在 `#page-home` 的 panel 中，快捷卡片下方新增：

```html
<div id="activeSessionsSection" style="margin-top:24px;">
  <h3 style="margin-bottom:12px;">🎬 活跃场次</h3>
  <div id="activeSessionCards" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;"></div>
  <button class="btn btn-success" onclick="openSessionModal()" style="margin-top:12px;">
    ➕ 创建新场次
  </button>
</div>
```

### 7.3 订单页新增场次提示

在 `#page-order` 第一个 panel 顶部增加：

```html
<div class="session-indicator" id="sessionIndicator">
  📌 当前场次: 未选择
  <button class="btn btn-outline" onclick="document.getElementById('sessionSelector').focus()">切换</button>
</div>
```

---

## 8. 兼容性 & 迁移

### 8.1 存量数据兼容

- 已有订单的 `session_id` 可能是 `null`
- 启动时检测：若 `live_sessions` 中存在 status=null 的记录，自动设为 `'ended'`
- 所有历史订单查询加 `OR session_id IS NULL` 条件，保证旧数据可见

### 8.2 部署策略

- 一次性全量替换 index.html + 所有 JS
- 云端数据不动，只改读取/写入逻辑
- 部署后刷新即可生效

---

## 9. 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 助理未选场次就录单 | 底部提示条闪烁 "⚠️ 请先选择场次"，禁止保存 |
| 两助理同时修改同一商品库存 | BaaS 写操作互不覆盖（各自原子更新），最终库存 = 两个助理扣减之和 |
| 场次结束但助理正在录单 | 提示"该场次已结束，请切换场次"，清空当前SKU但不丢失 |
| 网络断开导致轮询失败 | 本地库存照常扣减，3次轮询失败后顶部显示断开横幅 |
| 所有活跃场次都结束了 | 助理端自动回到首页，提示选择"查看历史"或"创建新场次" |

---

## 10. 开发顺序

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 数据结构改造：`currentSession` → `activeSessions` | session.js |
| 2 | 场次创建/切换/结束逻辑 | session.js, index.html |
| 3 | 顶部场次选择器 UI | index.html, style.css |
| 4 | 首页活跃场次卡片 | index.html, app.js |
| 5 | 订单录入适配多场次 | order.js |
| 6 | 库存实时轮询 | product.js |
| 7 | 库存预警提示 | order.js, product.js |
| 8 | 全量测试 | — |
| 9 | 部署 | deploy |
