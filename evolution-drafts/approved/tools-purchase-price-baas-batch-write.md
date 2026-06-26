# Evolution Proposal: 采购价Excel批量写入BaaS云端

- Created-At: 2026-06-27 02:01
- Target-File: TOOLS.md
- Trigger-Type: workflow | explicit-instruction

## Why This Matters
用户明确要求以后由我来写入采购价到BaaS云端，这是一个可复用的多步骤工作流。固化下来，以后用户发Excel采购价表，我就能直接按标准化流程执行。

## Evidence
- 用户原话："你帮我采购价直接写入BAAS吧，以后要更新这个我就交给你来写入"
- 用户原话："需要"（确认进化）
- 本次成功执行了：Excel解析→BaaS API查询→批量逐条更新(10条并发/批)→结果验证全流程，1452条全部成功

## Conflict Points
None

## Plan
1. 在 TOOLS.md 中追加「采购价Excel批量写入BaaS」工作流步骤：
   - 用户发Excel采购价表 → 用 openpyxl（data_only=True）解析
   - 先调用 BaaS API list 获取云端商品SKU→ID映射
   - 匹配后，每10条一批并发写入（用 requests.Session）
   - 反馈：成功条数 + 失败条数 + 未匹配SKU列表

2. 追加文本到 TOOLS.md 末尾

具体追加内容如下：

```md

### 采购价Excel批量写入BaaS云端

当用户发Excel采购价表要求写入BaaS时，按以下流程执行：

1. **接收文件**：用户发送的 .xlsx 文件（通常路径在 `/tmp/xy_channel/`）
2. **读取Excel**：`openpyxl.load_workbook('xxx.xlsx', data_only=True)` 读取计算值
   - 列格式：A=SKU, B=采购价(人民币), C=采购价(美金)
   - 跳过表头行和空行
3. **获取云端映射**：POST 到 `https://baas.kuafuai.net/baas-api/api/data/invoke?table=products&method=list`
   - Header: `CODE_FLYING: baas_CJbcgwuf`, `Content-Type: application/json`
   - 构建 `sku_to_id = {p['sku']: p['id'] for p in data['data']}`
4. **批量写入**：每10条一批，用 `requests.Session` 并发POST
   - 端点：`/api/data/invoke?table=products&method=update`
   - Body: `{"id": id, "price_cny": cny, "price_usd": usd}`
   - 每50条打印一次进度
5. **验证**：重新查询云端前几条，核对价格是否正确更新
6. **清理**：删除临时Excel文件
7. **反馈用户**：成功N条 / 失败N条 / 未匹配N条（列出未匹配的SKU）
```

