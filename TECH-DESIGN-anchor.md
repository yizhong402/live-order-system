# 技术方案：多主播轮播支持完善

## 改动文件

1. `js/services/session.js` — session 新增 currentAnchor，changeAnchor 逻辑调整
2. `js/services/order.js` — 保存/编辑/导出主播逻辑调整
3. `index.html` — 编辑弹窗加主播字段、录入页加当前主播指示

## Step 1：session.js — 新增 currentAnchor 字段

**创建场次时**：anchor 和 currentAnchor 都存初始主播
```js
session.anchor = anchor;          // 全链（历史查看用）
session.currentAnchor = anchor;   // 当前单人主播（订单归属用）
```

**changeAnchor 时**：
```js
// 全链仍累加
session.anchor = current ? current + '/' + newAnchor : newAnchor;
// 单人主播只存新名字
session.currentAnchor = newAnchor.trim();
```

## Step 2：order.js — 保存订单取 currentAnchor

订单保存/nextRound/prevRound/copyOrderSkus 中的 `sessionAnchor` 改为取 `currentAnchor`

## Step 3：order.js — 编辑弹窗加主播字段

编辑弹窗增加：
```html
<label>主播</label>
<input type="text" id="editSessionAnchor">
```

## Step 4：order.js — 修复导出主播列优先级

```js
anchorName = order.sessionAnchor || '';  // 优先订单级单人主播
if (!anchorName && currentSession) {
    anchorName = currentSession.currentAnchor || currentSession.anchor;
}
```

## Step 5：order.js — CSV 格式优化

- 文件名：`orders_{sessionTitle}_{date}.csv`（简洁）
- 增加按主播筛选导出选项
- 增加按主播小计行

## Step 6：录入页增加"当前在播主播"指示

UI 醒目显示单人主播，切换时视觉变化。
