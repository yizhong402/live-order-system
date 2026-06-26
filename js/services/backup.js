// ========== 云端备份系统 ==========
// 备份数据 → 云存储（文件上传），元数据 → localStorage
// 同一浏览器内一键备份/恢复；换浏览器可用"导出文件"迁移

// 获取当前系统完整快照
function captureSnapshot() {
    return {
        version: '2.1',
        captureTime: new Date().toISOString(),
        products: products.map(function(p){
            return { sku: p.sku, name: p.name, stock: p.stock,
                priceCny: p.priceCny, priceUsd: p.priceUsd,
                originalStock: p.originalStock,
                image: p.image || p.image_url || '' };
        }),
        orders: orders.map(function(o){ return {
            round: o.round, title: o.title,
            skus_json: JSON.stringify({skus: o.skus||[], auctionPrice: o.auctionPrice||0, note: o.note||''}),
            session_id: o.sessionId || 0,
            created_at: o.timestamp ? new Date(o.timestamp).toISOString().slice(0,19).replace('T',' ') : new Date().toISOString().slice(0,19).replace('T',' ')
        };}),
        comboSkus: comboSkus.map(function(c){ return { code: c.code, skus_json: JSON.stringify(c.skus || []) }; }),
        liveSessions: liveHistory.map(function(s){ return {
            title: s.title, date: s.date, time: s.time,
            anchor: s.anchor, platform: s.platform,
            client_id: s.client_id, status: s.status, session_no: s.session_no
        };}),
        titleHistory: titleHistory.map(function(t){ return { title: t }; }),
        titleRoundMap: titleRoundMap,
        productImages: {} // 图片只存URL，不存base64
    };
}

function snapshotStats(data) {
    var size = new Blob([JSON.stringify(data)]).size;
    var sizeStr = size > 1048576 ? (size/1048576).toFixed(2)+' MB' : (size/1024).toFixed(1)+' KB';
    return {
        sizeStr: sizeStr,
        productCount: data.products.length,
        orderCount: data.orders.length,
        comboCount: data.comboSkus.length,
        sessionCount: data.liveSessions.length
    };
}

// 备份元数据存localStorage
var BACKUP_STORAGE_KEY = 'walmart_backups_index';

function getLocalBackups() {
    try {
        var raw = localStorage.getItem(BACKUP_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
}

function saveLocalBackups(index) {
    try {
        localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(index));
    } catch(e) {
        console.error('保存备份索引失败:', e);
    }
}

// 上传JSON文件到云端
async function uploadBackupJson(jsonStr, filename) {
    try {
        var blob = new Blob([jsonStr], { type: 'application/json' });
        var file = new File([blob], filename, { type: 'application/json' });
        var formData = new FormData();
        formData.append('file', file);
        var resp = await fetch(CLOUD_UPLOAD_URL, {
            method: 'POST',
            headers: { 'CODE_FLYING': CLOUD_API_KEY },
            body: formData
        });
        var result = await resp.json();
        return result.success && result.data ? result.data.url : null;
    } catch(e) {
        console.error('备份文件上传失败:', e);
        return null;
    }
}

// 从云端URL获取备份JSON
async function downloadBackupJson(url) {
    try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return await resp.json();
    } catch(e) {
        console.error('下载备份失败:', e);
        return null;
    }
}

// === 核心功能 ===

var backupList = [];

function loadBackupList() {
    backupList = getLocalBackups();
    return backupList;
}

async function createCloudBackup() {
    try {
        var name = prompt('📝 请输入备份名称（选填）', '手动备份 ' + new Date().toLocaleString('zh-CN'));
        if (name === null) return;
        if (!name || name.trim() === '') name = '手动备份 ' + new Date().toLocaleString('zh-CN');

        var data = captureSnapshot();
        var stats = snapshotStats(data);
        var jsonStr = JSON.stringify(data);

        var loadingEl = document.getElementById('backupStatus');
        if (loadingEl) loadingEl.textContent = '☁️ 正在上传备份 (' + stats.sizeStr + ')...';

        var filename = 'backup-' + Date.now() + '.txt';
        var url = await uploadBackupJson(jsonStr, filename);

        if (!url) {
            // 上传失败，降级为本地导出
            if (loadingEl) loadingEl.textContent = '';
            if (confirm('⚠️ 云存储上传失败，是否导出到本地文件？')) {
                exportAllData();
            } else {
                alert('❌ 备份失败：无法上传到云端');
            }
            return;
        }

        // 保存元数据
        var entry = {
            id: 'b' + Date.now(),
            name: name.trim(),
            stats: stats,
            url: url,
            created_at: new Date().toISOString().slice(0,19).replace('T',' ')
        };
        var index = getLocalBackups();
        index.unshift(entry);
        // 保留最近30条
        if (index.length > 30) index.length = 30;
        saveLocalBackups(index);

        if (loadingEl) loadingEl.textContent = '';

        alert('✅ 备份成功！\n\n📦 备份名称: ' + name.trim() +
              '\n📊 数据统计:\n  商品: ' + stats.productCount + ' 个' +
              '\n  订单: ' + stats.orderCount + ' 笔' +
              '\n  组合SKU: ' + stats.comboCount + ' 个' +
              '\n  直播场次: ' + stats.sessionCount + ' 场' +
              '\n  文件大小: ' + stats.sizeStr);

        renderBackupList();

    } catch(e) {
        console.error('备份失败:', e);
        var el = document.getElementById('backupStatus');
        if (el) el.textContent = '';
        alert('❌ 备份失败: ' + e.message);
    }
}

async function restoreFromBackup(backupId, backupName) {
    if (!confirm('⚠️ 恢复操作将覆盖当前所有数据！\n\n此操作不可撤销，确定要继续吗？')) return;
    if (!confirm('⚠️ 再次确认：你确定要从备份 "' + backupName + '" 恢复数据吗？')) return;

    try {
        var loadingEl = document.getElementById('backupStatus');
        if (loadingEl) loadingEl.textContent = '☁️ 正在查找备份...';

        var index = getLocalBackups();
        var entry = null;
        for (var i = 0; i < index.length; i++) {
            if (index[i].id === backupId) { entry = index[i]; break; }
        }
        if (!entry || !entry.url) {
            alert('❌ 未找到备份记录或文件链接已失效');
            return;
        }

        if (loadingEl) loadingEl.textContent = '☁️ 正在下载备份数据...';

        var data = await downloadBackupJson(entry.url);
        if (!data) {
            alert('❌ 备份文件下载失败，文件可能已被删除');
            return;
        }

        var stats = snapshotStats(data);

        if (loadingEl) loadingEl.textContent = '☁️ 正在清空现有数据...';

        // 1. 清空
        await client.db.from('products').delete().neq('id', 0).catch(function(){});
        await client.db.from('orders').delete().neq('id', 0).catch(function(){});
        await client.db.from('combo_skus').delete().neq('id', 0).catch(function(){});
        await client.db.from('live_sessions').delete().neq('id', 0).catch(function(){});
        await client.db.from('title_history').delete().neq('id', 0).catch(function(){});
        await client.db.from('title_round_map').delete().neq('id', 0).catch(function(){});

        if (loadingEl) loadingEl.textContent = '☁️ 正在恢复商品 (' + stats.productCount + ' 个)...';

        // 2. 恢复商品
        var batchSize = 50;
        for (var pi = 0; pi < data.products.length; pi += batchSize) {
            var batch = data.products.slice(pi, pi + batchSize);
            await Promise.all(batch.map(function(p){
                return client.db.from('products').insert().values({
                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                    price_cny: Math.round((p.priceCny || 0) * 100), price_usd: Math.round((p.priceUsd || 0) * 100),
                    image_url: p.image || '',
                    original_stock: p.originalStock || p.stock || 0
                });
            }));
            if (loadingEl) {
                loadingEl.textContent = '☁️ 恢复商品中... ' + Math.min(pi+batchSize, data.products.length) + '/' + stats.productCount;
            }
        }

        if (loadingEl) loadingEl.textContent = '☁️ 正在恢复订单 (' + stats.orderCount + ' 笔)...';

        // 3. 恢复订单
        for (var oj = 0; oj < data.orders.length; oj += batchSize) {
            var obatch = data.orders.slice(oj, oj + batchSize);
            await Promise.all(obatch.map(function(o){
                return client.db.from('orders').insert().values({
                    round: o.round, title: o.title,
                    skus_json: o.skus_json || '{}',
                    session_id: o.session_id || 0,
                    created_at: o.created_at || new Date().toISOString().slice(0,19).replace('T',' ')
                });
            }));
            if (loadingEl && (oj + batchSize) % 100 === 0) {
                loadingEl.textContent = '☁️ 恢复订单中... ' + Math.min(oj+batchSize, data.orders.length) + '/' + stats.orderCount;
            }
        }

        if (loadingEl) loadingEl.textContent = '☁️ 正在恢复组合SKU和场次...';

        // 4-7. 其他数据
        var promises4 = [];
        if (data.comboSkus && data.comboSkus.length > 0) {
            data.comboSkus.forEach(function(c){
                promises4.push(client.db.from('combo_skus').insert().values({
                    code: c.code, skus_json: c.skus_json || '[]'
                }).catch(function(){}));
            });
        }
        if (data.liveSessions && data.liveSessions.length > 0) {
            data.liveSessions.forEach(function(s){
                promises4.push(client.db.from('live_sessions').insert().values({
                    title: s.title || '', date: s.date || '', time: s.time || '',
                    anchor: s.anchor || '', platform: s.platform || '',
                    client_id: s.client_id || 0, status: s.status || 'ended',
                    session_no: s.session_no || ''
                }).catch(function(){}));
            });
        }
        if (data.titleHistory && data.titleHistory.length > 0) {
            data.titleHistory.forEach(function(t){
                promises4.push(client.db.from('title_history').insert().values({
                    title: t.title || ''
                }).catch(function(){}));
            });
        }
        if (data.titleRoundMap) {
            for (var key in data.titleRoundMap) {
                if (data.titleRoundMap.hasOwnProperty(key)) {
                    promises4.push(client.db.from('title_round_map').insert().values({
                        title: key, round_value: data.titleRoundMap[key]
                    }).catch(function(){}));
                }
            }
        }
        if (promises4.length > 0) await Promise.all(promises4);

        if (loadingEl) loadingEl.textContent = '';

        alert('✅ 恢复成功！\n\n恢复数据: 商品 ' + stats.productCount + ' 个, 订单 ' + stats.orderCount + ' 笔\n请刷新页面以完全加载数据');

    } catch(e) {
        console.error('恢复失败:', e);
        var el = document.getElementById('backupStatus');
        if (el) el.textContent = '';
        alert('❌ 恢复失败: ' + e.message + '\n\n请按F12查看控制台详细错误');
    }
}

function deleteBackup(backupId, backupName) {
    if (!confirm('确定要删除备份 "' + backupName + '" 吗？')) return;
    var index = getLocalBackups();
    index = index.filter(function(e){ return e.id !== backupId; });
    saveLocalBackups(index);
    renderBackupList();
}

function renderBackupList() {
    var container = document.getElementById('backupList');
    if (!container) return;

    loadBackupList();

    if (backupList.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无云端备份，点击上方按钮创建</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < backupList.length; i++) {
        var b = backupList[i];
        var st = b.stats || {};
        var timeStr = '';
        if (b.created_at) {
            try {
                var d = new Date(b.created_at.replace(' ', 'T'));
                timeStr = d.toLocaleString('zh-CN');
            } catch(e) { timeStr = b.created_at; }
        }
        html += '<div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;margin-bottom:10px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
        html += '<div style="flex:1;">';
        html += '<div style="font-weight:bold;color:#e0e0e0;margin-bottom:4px;">📦 ' + escapeHtml(b.name || '未命名备份') + '</div>';
        html += '<div style="font-size:12px;color:var(--text-muted);">🕐 ' + timeStr + ' &nbsp;|&nbsp; 📦 商品 ' + (st.productCount||0) + ' &nbsp;|&nbsp; 📋 订单 ' + (st.orderCount||0) + ' &nbsp;|&nbsp; 🧩 组合 ' + (st.comboCount||0) + ' &nbsp;|&nbsp; 🎬 场次 ' + (st.sessionCount||0) + '</div>';
        html += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">💾 大小: ' + (st.sizeStr||'未知') + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
        html += '<button class="btn btn-success btn-sm" onclick="restoreFromBackup(\'' + escapeForAttr(b.id) + '\', \'' + escapeForAttr(b.name) + '\')" style="font-size:13px;padding:6px 14px;">🔄 恢复</button>';
        html += '<button class="btn btn-danger btn-sm" onclick="deleteBackup(\'' + escapeForAttr(b.id) + '\', \'' + escapeForAttr(b.name) + '\')" style="font-size:13px;padding:6px 14px;">🗑️ 删除</button>';
        html += '</div></div></div>';
    }
    container.innerHTML = html;
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function escapeForAttr(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
}
