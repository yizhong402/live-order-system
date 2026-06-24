# 已发现问题 & 待修复清单

## 问题1: 刷新后场次从下拉选择器消失
- session只保存在内存 `activeSessions`，刷新后 `refreshActiveSessionsFromCloud` 从BaaS恢复时生成随机新ID，无法匹配下拉选择器
- **修复**: createSession保存BaaS返回ID，refresh用原ID恢复

## 问题2: 下拉选择器刷新后场次选择为空
- 同上根因

## 问题3: 首页活跃场次卡片显示"0单"
- 需要检查 updateActiveSessionsCards 是否计算了orders

## 问题4: 商品列表采购价全为 undefined
- products JSON中 cost/price 字段可能原本就为undefined
- 不是本轮修复范围（数据源问题）

## 测试清单 (每轮)
1. 创建场次
2. 下单3笔 (不同商品/轮次/金额/备注/SKU)
3. 检查首页统计
4. 检查毛利计算
5. 刷新页面
6. 检查场次下拉选择器
7. 检查数据是否全部保留
8. 检查历史记录可滚动
9. 检查库存扣减
