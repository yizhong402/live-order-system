// oms-sync.js — OMS 库存同步（前端触发 + 定时设置 + 数据展示）
// 实际同步由服务端 oms_sync.py 守护进程执行
// 手动触发：在 BaaS settings 设置 manualTrigger=true，守护进程检测到后执行

function renderOMSSyncLog() {
  var logs = [];
  try {
    var raw = (systemSettings.omsSync && systemSettings.omsSync.syncLog) || [];
    if (typeof raw === 'string') raw = JSON.parse(raw);
    logs = Array.isArray(raw) ? raw : [];
  } catch(e) {}

  if (logs.length === 0) {
    return '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">暂无同步记录</div>';
  }

  var rows = '';
  logs.forEach(function(log) {
    var timeStr = log.time ? log.time.substring(0, 19).replace('T', ' ') : '-';
    var icon = log.success ? '<span style="color:#22c55e;">✅</span>' : '<span style="color:#ef4444;">❌</span>';
    var changeInfo = log.success ? (log.total || 0) + ' SKU' : '-';
    var detail = log.success ? ('新增' + (log.added || 0) + ' 更新' + (log.updated || 0)) : (log.message || '');
    if (log.elapsed) detail += ' [' + log.elapsed + ']';
    rows += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
      '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + timeStr + '</td>' +
      '<td style="padding:6px 8px;text-align:center;">' + icon + '</td>' +
      '<td style="padding:6px 8px;text-align:center;color:#fff;font-size:12px;">' + changeInfo + '</td>' +
      '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + detail + '</td></tr>';
  });

  return '<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
    '<thead><tr style="background:rgba(255,255,255,0.05);">' +
    '<th style="padding:6px 8px;text-align:left;">时间</th>' +
    '<th style="padding:6px 8px;text-align:center;">状态</th>' +
    '<th style="padding:6px 8px;text-align:center;">同步</th>' +
    '<th style="padding:6px 8px;text-align:left;">详情</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderOMSSyncPanel() {
  var s = systemSettings.omsSync || {};
  var enabled = s.enabled === true;
  var lastSync = s.lastSync || '从未同步';
  var scheduleTime = s.scheduleTime || '';
  var status = s.lastSync ?
    '<span style="color:#22c55e;">✅ 上次同步: ' + lastSync.substring(0, 19).replace('T', ' ') + '</span>' :
    '<span style="color:#f59e0b;">⏳ 尚未同步</span>';

  // 查 OMS 商品数
  var omsCount = 0;
  try {
    var raw = (systemSettings.omsSync && systemSettings.omsSync.skuCount) || 0;
    omsCount = parseInt(raw) || 0;
  } catch(e) {}

  return '<div style="padding:20px;background:rgba(0,0,0,0.15);border-radius:10px;">' +
    '<h4 style="margin-bottom:15px;color:#667eea;">📦 OMS 库存同步</h4>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">' +
      '<div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">同步状态</div>' +
        '<div style="font-size:14px;">' + status + '</div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">OMS 商品数</div>' +
        '<div style="font-size:14px;font-weight:600;">' + omsCount + ' SKU</div>' +
      '</div>' +
    '</div>' +

    // 开关 + 手动同步按钮
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:15px;">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">' +
        '<input type="checkbox" id="omsEnabledCheckbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleOMSSync(this.checked)">' +
        '<span style="color:' + (enabled ? '#22c55e' : 'var(--text-muted)') + ';">' + (enabled ? '🟢 已启用' : '🔴 已停用') + '</span>' +
      '</label>' +
      '<button class="btn btn-primary" onclick="triggerOMSSync()" style="padding:6px 14px;font-size:12px;" ' + (!enabled ? 'disabled style="opacity:0.5"' : '') + '>' +
        '<span id="omsSyncBtnText">🚀 立即同步</span>' +
      '</button>' +
      '<span id="omsSyncStatus" style="font-size:12px;color:var(--text-muted);display:none;"></span>' +
    '</div>' +

    '</div>';
}

function renderOMSProductsList(page, pageSize) {
  // 从 BaaS 分页加载 OMS 商品
  var s = systemSettings.omsSync || {};
  if (!s._lastProductPage) s._lastProductPage = 1;
  page = page || s._lastProductPage || 1;
  pageSize = pageSize || 50;

  loadBaaSProducts(page, pageSize, function(err, data) {
    var container = document.getElementById('omsProductsList');
    var pagination = document.getElementById('omsProductsPagination');
    if (!container) return;

    if (err || !data || !data.rows) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载失败</div>';
      return;
    }

    var rows = data.rows;
    var total = data.totalSize || 0;
    var totalPages = Math.ceil(total / pageSize);
    s._lastProductPage = page;

    if (rows.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无数据，请先同步</div>';
      if (pagination) pagination.innerHTML = '';
      return;
    }

    var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
      '<thead><tr style="background:rgba(255,255,255,0.05);position:sticky;top:0;">' +
      '<th style="padding:6px 4px;text-align:left;">图片</th>' +
      '<th style="padding:6px 4px;text-align:left;">SKU</th>' +
      '<th style="padding:6px 4px;text-align:left;">名称</th>' +
      '<th style="padding:6px 4px;text-align:center;">总库存</th>' +
      '<th style="padding:6px 4px;text-align:center;">可用</th>' +
      '<th style="padding:6px 4px;text-align:center;">锁定</th>' +
      '</tr></thead><tbody>';

    rows.forEach(function(p) {
      var totalColor = p.stock > 0 ? '#22c55e' : '#ef4444';
      var imgHtml = p.imgUrl ? '<img src="' + p.imgUrl + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;" onerror="this.style.display=\'none\'">' : '<span style="color:#666;">🈚</span>';
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
        '<td style="padding:4px;">' + imgHtml + '</td>' +
        '<td style="padding:4px;font-weight:500;color:#fff;font-size:11px;">' + escapeHtml(p.sku || '') + '</td>' +
        '<td style="padding:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(p.name || '') + '</td>' +
        '<td style="padding:4px;text-align:center;color:' + totalColor + ';">' + (p.stock || 0) + '</td>' +
        '<td style="padding:4px;text-align:center;">' + (p.availableStock || 0) + '</td>' +
        '<td style="padding:4px;text-align:center;">' + (p.lockedStock || 0) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // 分页
    if (pagination) {
      var pgHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:8px;font-size:12px;">' +
        '<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="loadOMSProductsPage(1)" ' + (page <= 1 ? 'disabled' : '') + '>首页</button>' +
        '<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="loadOMSProductsPage(' + (page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>' +
        '<span style="color:var(--text-muted);">第 ' + page + '/' + totalPages + ' 页 (共 ' + total + ' 条)</span>' +
        '<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="loadOMSProductsPage(' + (page + 1) + ')" ' + (page >= totalPages ? 'disabled' : '') + '>下一页</button>' +
        '<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="loadOMSProductsPage(' + totalPages + ')" ' + (page >= totalPages ? 'disabled' : '') + '>末页</button>' +
        '</div>';
      pagination.innerHTML = pgHtml;
    }

    // 更新 SKU 计数
    try {
      if (total !== parseInt(systemSettings.omsSync.skuCount || '0')) {
        systemSettings.omsSync.skuCount = total;
      }
    } catch(e) {}
  });
}

function loadOMSProductsPage(page) {
  renderOMSProductsList(page);
}

function loadBaaSProducts(page, pageSize, callback) {
  // 从 BaaS oms_products 表分页查询
  var url = CLOUD_BASE_URL + '/api/data/invoke?table=oms_products&method=list';
  fetch(url, {
    method: 'POST',
    headers: { 'CODE_FLYING': CLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNo: page, pageSize: pageSize })
  })
  .then(function(r) { return r.json(); })
  .then(function(j) {
    if (j.success) {
      var rows = j.data || [];
      // 尝试获取总数
      var totalSize = 0;
      // 有的 BaaS 实现返回总记录数在 extra 里
      if (j.extra && j.extra.totalSize) totalSize = j.extra.totalSize;
      else if (j.totalSize) totalSize = j.totalSize;
      else if (rows.length > 0) totalSize = rows.length;
      callback(null, { rows: rows, totalSize: totalSize });
    } else {
      callback(j.message || '查询失败');
    }
  })
  .catch(function(e) { callback(e.message); });
}

function triggerOMSSync() {
  // 设置 manualTrigger=true，守护进程会检测到并执行
  var btn = document.getElementById('omsSyncBtnText');
  var status = document.getElementById('omsSyncStatus');
  if (btn) btn.textContent = '⏳ 触发中...';
  if (status) { status.style.display = 'inline'; status.textContent = '已发送同步信号，等待服务端执行...'; }

  systemSettings.omsSync.manualTrigger = true;
  debouncedSaveSettings();

  setTimeout(function() {
    if (btn) btn.textContent = '🚀 立即同步';
    if (status) status.textContent = '✅ 同步信号已发送，守护进程将在30秒内执行';
  }, 2000);

  // 过几秒刷新日志
  setTimeout(function() {
    loadSettings(function() {
      renderOMSSyncLog();
    });
  }, 5000);
}

function toggleOMSSync(enabled) {
  systemSettings.omsSync.enabled = enabled;
  debouncedSaveSettings();
  // 更新 UI
  var label = document.querySelector('label[for="omsEnabledCheckbox"] span') ||
              document.querySelector('label:has(#omsEnabledCheckbox) span');
  if (enabled) {
    document.getElementById('omsSyncBtnText').closest('button').disabled = false;
    document.getElementById('omsSyncBtnText').closest('button').style.opacity = '1';
  } else {
    document.getElementById('omsSyncBtnText').closest('button').disabled = true;
    document.getElementById('omsSyncBtnText').closest('button').style.opacity = '0.5';
  }
}

async function saveOMSSchedule() {
  var val = document.getElementById('omsScheduleTime').value;
  if (!val) {
    showToast('请先选择时间', 'warning');
    return;
  }
  systemSettings.omsSync.scheduleTime = val;
  await debouncedSaveSettings();
  showToast('每日校准已设为 ' + val, 'success');
}

function refreshOMSSyncLog() {
  var container = document.getElementById('omsSyncLogContainer');
  if (container) container.innerHTML = renderOMSSyncLog();
  var summary = document.querySelector('#settingsContent details summary');
  if (summary) summary.textContent = '📋 同步记录 (' + (systemSettings.omsSync.syncLog || []).length + ')';
}

function initOMSSyncOnLoad() {
  // 初始化面板
  var panel = document.getElementById('omsSyncPanel');
  if (panel) panel.innerHTML = renderOMSSyncPanel();

  var logContainer = document.getElementById('omsSyncLogContainer');
  if (logContainer) logContainer.innerHTML = renderOMSSyncLog();

  // 加载商品列表第一页
  renderOMSProductsList(1);
}

function searchOMSProducts() {
  var keyword = (document.getElementById('omsSearchInput') || {}).value || '';
  // 简单前端过滤，或者从后台重新搜索
  if (!keyword) {
    renderOMSProductsList(1);
    return;
  }
  // 如果有关键词，直接渲染整个列表但只显示匹配的（前端过滤不合适时可以用 BaaS 查询）
  var container = document.getElementById('omsProductsList');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">🔍 BaaS 不支持关键词搜索，请下载数据后本地过滤</div>';
}

// ===== 工具 =====
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
