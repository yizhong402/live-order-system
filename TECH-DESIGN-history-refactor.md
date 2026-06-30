# 技术方案：历史记录板块重构

## 一、涉及文件

| 文件 | 改动 |
|------|------|
| `index.html` | 重写 `#page-history`；订单页 `#page-order` 增加「结束当前场次」按钮 |
| `js/services/history.js` | 全部重写：单列表、内联展开、统计概览、筛选联动 |
| `js/services/order.js` | 不修改（clearAllLiveData 已完整联动） |
| `js/services/session.js` | 不修改 |

## 二、index.html 改动

### A. 历史记录页 `#page-history` 新结构

```html
<div id="page-history" class="page">
  <div class="panel">
    <div class="panel-title">📋 历史记录</div>

    <!-- 顶部统计概览 -->
    <div id="historyStats" style="...">加载中...</div>

    <!-- 筛选栏（一行紧凑） -->
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <select id="historySessionSelect" onchange="renderHistory()">[全部场次]</select>
      <select id="historyAnchorFilter" onchange="renderHistory()">[全部主播]</select>
      <input type="date" id="historyDateFilter" onchange="renderHistory()">
    </div>

    <!-- 场次列表（单列表，含内联展开） -->
    <div id="historySessionList"></div>

    <!-- 底部操作栏 -->
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button onclick="exportFilteredHistoryCSV()">📄 导出筛选结果CSV</button>
      <button onclick="clearAllLiveData()">🗑️ 删除全部直播数据</button>
    </div>

  </div>
</div>
```

**删除的 HTML 元素（全去掉）：**
- `#filteredSessionList`（重复场次列表）
- `#orderList`（底部订单列表区域）
- `#sessionTitleFilter`（标题筛选输入框）
- `#sessionFilter`（旧场次筛选下拉）
- `#sessionSelect`（旧场次下拉，新改名 `#historySessionSelect`）
- 「结束当前场次」按钮
- 「清空所有订单」按钮

### B. 订单页 `#page-order` 增加「结束当前场次」

在场次信息面板（`#currentSessionInfo` 附近）增加按钮。选择在「切换主播」按钮旁边或下方，添加：

```html
<button class="btn btn-warning" onclick="endCurrentSession()" style="...">
  🎉 结束当前场次
</button>
```

## 三、history.js 全部重写

### 核心函数

| 函数 | 功能 |
|------|------|
| `renderHistory()` | 入口：读所有筛选条件 → 过滤 liveHistory → 渲染场次列表 + 更新统计概览 |
| `initHistoryFilters()` | 初始化时：填充 `historySessionSelect` + `historyAnchorFilter` 的下拉选项 |
| `getSessionOrders(sessionId)` | 公共函数：获取某场次的所有订单（兼容旧格式 orders 嵌入 + 新格式全局 orders） |
| `toggleExpand(sessionId)` | 展开/收起某张场次卡片的内联订单面板 |
| `exportSingleSessionCSV(sessionId)` | 导出指定场次的 CSV |
| `exportFilteredHistoryCSV()` | 导出当前筛选结果的 CSV |
| `deleteSessionHistory(sessionId)` | 保留原逻辑，增强联动覆盖 |
| `updateHistoryData()` | 当外部数据变化时刷新（被 deleteSessionHistory 等调用） |

### renderHistory() 流程

```
1. 读筛选项：selectedSessionId, anchorFilter, dateFilter
2. 过滤 liveHistory
3. 更新统计概览（#historyStats）
4. 渲染场次列表（#historySessionList）
   每个场次卡片结构：
   ┌────────────────────────────────────────────────┐
   │ 🎬 标题                              🗑️  │
   │ 🕐 开始 - 结束                               │
   │ 🎤 主播链  | 📦 N订单  | 🛒 N SKU  | 💰 $X     │
   │                       [展开 ▼ / 收起 ▲]        │
   └────────────────────────────────────────────────┘
```

### 内联展开面板结构

```html
<div class="expandable-content" style="...">
  <!-- 按 round 分组 -->
  <div>第1轮 🎤 aminta  3单  5SKU  $450.00</div>
  <div>第2轮 🎤 aming   4单  8SKU  $920.00</div>
  <div>...</div>
  <!-- 每个 round 可再展开看 SKU 明细（次级展开），暂不做二级展开 -->
  <div style="margin-top:8px;">
    <button onclick="exportSingleSessionCSV(sessionId)">📄 导出本场次CSV</button>
  </div>
</div>
```

### 统计概览计算

```
- 总场次: liveHistory.length（经过滤后的）
- 总订单数: 所有 sessionOrders 累计 length
- 总 SKU 数: 所有 sessionOrders skus 累计 quantity
- 总 GMV: 所有 sessionOrders auctionPrice 累计
```

### 筛选逻辑

```
selectedSessionId: 精确匹配 session.id
anchorFilter: 匹配 session.anchor (全链) 或 order.sessionAnchor (单人)
dateFilter: 匹配 session.date
```

### 删除场次的联动覆盖

`deleteSessionHistory(sessionId)` 执行后必须调用：

```
deleteSessionHistory() {
  // BaaS 已删除
  // 内存已删除
  saveLiveHistory()

  // 联动更新
  renderHistory()              // 刷新历史列表
  updateSessionSelector()      // 订单页场次下拉
  updateRealTimeOrderList()    // 订单页实时订单
  updateSessionDisplay()       // 订单页场次面板
  if (typeof renderDashboard === 'function') renderDashboard()  // 首页统计
  if (typeof calculateProfit === 'function') calculateProfit()  // 毛利页
}
```

注意：`clearAllLiveData()` 已有完整联动，不动。

## 四、订单页增加「结束当前场次」按钮

在 `index.html` 订单页的场次信息区（`#currentSessionInfo` 下面或 `#anchorName` 行的后面），增加：

```html
<button class="btn btn-warning" onclick="endCurrentSession()" style="padding:6px 14px;font-size:12px;margin-top:8px;">
  🎉 结束当前场次
</button>
```

`endCurrentSession()` 函数保留在 `history.js` 不动，只从历史记录页 HTML 中移除按钮，订单页 HTML 中增加按钮引用。

## 五、不做的事项

- 不修改 `clearAllLiveData()` 逻辑
- 不修改 `endCurrentSession()` 逻辑
- 不修改 CSV 导出格式（刚改过）
- 不做二级展开（展开 round 查看每条 SKU）
- 不做懒加载/分页

## 六、兼容性

| 场景 | 处理 |
|------|------|
| 旧数据嵌入 orders 的 session（.orders 数组） | `getSessionOrders()` 优先取内部 orders，再查全局 orders |
| 旧场次 session.anchor 全链、无 currentAnchor | 展示全链，导出取 anchor |
| 空场次（有记录无订单） | 显示 "0订单 / 0SKU / $0.00" |
| 未结束场次（无 endTime） | 显示 "进行中" |
