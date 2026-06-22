# 第一阶段 — 任务拆解

> 顺序: 按依赖关系从底层到上层

## Step 1: 数据结构改造 — session.js
- [ ] 把 `currentSession` 改为 `activeSessions = {}` (对象)
- [ ] `createSession()` → 改为插入 activeSessions，存入 live_sessions 表（状态 active）
- [ ] 新增 `switchSession(id)` → 切换当前场次，加载该场轮次/SKU/订单
- [ ] 新增 `endSession(id)` → 归档该场，从 activeSessions 移除
- [ ] 新增 `getCurrentSession()` → 返回当前选中场次
- [ ] 新增 `listActiveSessions()` → 返回所有活跃场次
- [ ] `showPage()` 补上 PAGE_TITLES 确保兼容

## Step 2: 页面 UI — index.html + style.css
- [ ] topbar 右上角加场次选择器下拉框
- [ ] 订单录入页顶部加"当前场次"提示条
- [ ] 首页加活跃场次卡片区域 + 库存预警区域
- [ ] 创建场次弹窗保留

## Step 3: 订单录入适配多场次 — order.js
- [ ] 所有订单操作改为走 `getCurrentSession()`
- [ ] 轮次切换、SKU 增删改为操作 session.currentRound / session.currentSkus
- [ ] 订单保存带 session_id
- [ ] 实时订单列表按 session_id 过滤

## Step 4: 库存实时轮询 — product.js
- [ ] 新增定时轮询（setInterval 每5秒）
- [ ] 云端库存变化检测
- [ ] UI 标蓝闪烁提示

## Step 5: 库存预警 — order.js + product.js
- [ ] addSku 时检查库存，不足标黄警告
- [ ] SKU 列表显示库存状态

## Step 6: 商品搜索过滤 — product.js + index.html
- [ ] 搜索框按 SKU/名称过滤
- [ ] 库存状态筛选（正常/不足/无图/无价）

## Step 7: 历史删除单场 — history.js
- [ ] 删除单场记录功能

## Step 8: 全量测试
- [ ] 创建多场次
- [ ] 切换场次
- [ ] 各自录单互不干扰
- [ ] 库存同步
- [ ] 结束场次

## Step 9: 部署

## Step 10: 通知用户
