// oms-sync.js — OMS 库存同步服务

        // ============ OMS 同步配置（合并到 systemSettings） ============
        // systemSettings.omsSync 现已扩展：
        // {
        //   enabled: false,
        //   apiUrl: '',
        //   apiKey: '',
        //   intervalMinutes: 60,
        //   lastSync: null,
        //   autoSync: false,
        //   syncLog: []  // { time, success, changed, total, message }
        // }

        // ============ 核心同步逻辑 ============

        let omsSyncTimer = null;

        async function syncFromOMS() {
            const cfg = systemSettings.omsSync;
            if (!cfg.apiUrl) {
                showSyncResult('❌ OMS API 地址未配置', false);
                return { success: false, message: 'API 地址未配置' };
            }

            updateSyncStatus('🔄 正在同步...', '#f59e0b');

            try {
                // 1. 调用 OMS API 获取库存数据
                const resp = await fetch(cfg.apiUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        ...(cfg.apiKey ? { 'Authorization': 'Bearer ' + cfg.apiKey } : {})
                    },
                    signal: AbortSignal.timeout(30000)
                });

                if (!resp.ok) {
                    throw new Error('OMS 返回 ' + resp.status + ': ' + resp.statusText);
                }

                const data = await resp.json();

                // 2. 解析 OMS 数据（支持多种格式）
                const omsStockMap = parseOMSStockData(data);
                const omsSkuCount = Object.keys(omsStockMap).length;

                if (omsSkuCount === 0) {
                    throw new Error('OMS 返回数据中未找到有效 SKU 库存信息');
                }

                // 3. 对比本地库存，找出变化
                const changes = [];
                const noMatch = [];

                omsStockMap.forEach((omsStock, omsSku) => {
                    const local = products.find(p => p.sku === omsSku);
                    if (local) {
                        const oldStock = local.stock;
                        const newStock = parseInt(omsStock) || 0;
                        if (oldStock !== newStock) {
                            changes.push({ sku: omsSku, old: oldStock, new: newStock });
                            local.stock = newStock;
                        }
                    } else {
                        noMatch.push(omsSku);
                    }
                });

                // 4. 批量更新到云端 BaaS
                let updatedCount = 0;
                for (const chg of changes) {
                    try {
                        // 查找云端记录 ID
                        const searchRes = await client.db.from('products').select('id,stock').where('sku', chg.sku).list();
                        if (searchRes.success && searchRes.data && searchRes.data.length > 0) {
                            const record = searchRes.data[0];
                            await client.db.from('products').update(record.id, { stock: chg.new });
                            updatedCount++;
                        }
                    } catch(e) {
                        console.warn('⚠️ OMS 更新云端失败:', chg.sku, e.message);
                    }
                }

                // 5. 记录同步日志
                const syncLog = {
                    time: new Date().toISOString(),
                    success: true,
                    changed: changes.length,
                    total: omsSkuCount,
                    updated: updatedCount,
                    unmatched: noMatch.length,
                    message: `同步完成：共 ${omsSkuCount} 个SKU，${changes.length} 个变更，${noMatch.length} 个未匹配`
                };

                cfg.lastSync = syncLog.time;
                cfg.syncLog = cfg.syncLog || [];
                cfg.syncLog.unshift(syncLog);
                if (cfg.syncLog.length > 50) cfg.syncLog = cfg.syncLog.slice(0, 50);
                await saveSettings();

                // 6. 刷新 UI
                if (changes.length > 0) {
                    if (typeof updateSkuList === 'function') updateSkuList();
                    if (typeof renderStockOverview === 'function') renderStockOverview();
                }

                const msg = `✅ 同步完成 | ${omsSkuCount} SKU | ${changes.length} 变更 | ${noMatch.length} 未匹配`;
                showSyncResult(msg, true);
                updateSyncStatus(msg, '#22c55e');
                refreshOMSSyncLog();

                return { success: true, changed: changes.length, total: omsSkuCount };
            } catch(e) {
                const msg = '❌ OMS 同步失败: ' + e.message;
                console.error('OMS sync error:', e);

                // 记录失败日志
                cfg.lastSync = new Date().toISOString();
                cfg.syncLog = cfg.syncLog || [];
                cfg.syncLog.unshift({ time: cfg.lastSync, success: false, changed: 0, total: 0, unmatched: 0, message: msg });
                if (cfg.syncLog.length > 50) cfg.syncLog = cfg.syncLog.slice(0, 50);
                await saveSettings();

                showSyncResult(msg, false);
                updateSyncStatus(msg, '#ef4444');
                refreshOMSSyncLog();
                return { success: false, message: msg };
            }
        }

        // 解析 OMS 返回数据为 Map<SKU, stock>
        function parseOMSStockData(data) {
            const map = new Map();

            if (!data) return map;

            // 格式1: { "SKU001": 100, "SKU002": 50, ... }
            if (typeof data === 'object' && !Array.isArray(data) && !data.data && !data.products && !data.items) {
                for (const [key, val] of Object.entries(data)) {
                    if (val !== null && val !== undefined && !key.startsWith('_')) {
                        const num = parseInt(val);
                        if (!isNaN(num)) map.set(key, num);
                    }
                }
                if (map.size > 0) return map;
            }

            // 格式2: { data: [ { sku: "SKU001", stock: 100 }, ... ] }
            const arr = data.data || data.products || data.items || (data.result ? data.result.list || data.result.rows : null) || [];
            if (Array.isArray(arr)) {
                arr.forEach(item => {
                    const sku = item.sku || item.SKU || item.sku_code || item.product_code || item.code;
                    const stock = item.stock || item.quantity || item.qty || item.available || item.inventory;
                    if (sku && stock !== undefined) {
                        const num = parseInt(stock);
                        if (!isNaN(num)) map.set(String(sku), num);
                    }
                });
            }

            // 格式3: 嵌套数组 { result: { list: [ { sku, stock_qty }, ... ] } }
            if (map.size === 0 && data.result) {
                const rows = data.result.list || data.result.rows || data.result.data || [];
                if (Array.isArray(rows)) {
                    rows.forEach(item => {
                        const sku = item.sku || item.sku_code || item.product_code;
                        const stock = item.stock_qty || item.available_qty || item.qty || item.stock;
                        if (sku && stock !== undefined) {
                            const num = parseInt(stock);
                            if (!isNaN(num)) map.set(String(sku), num);
                        }
                    });
                }
            }

            return map;
        }

        // ============ 定时同步 ============

        function startOMSAutoSync() {
            stopOMSAutoSync();
            const cfg = systemSettings.omsSync;
            if (!cfg.enabled || !cfg.apiUrl) return;

            const intervalMs = (cfg.intervalMinutes || 60) * 60 * 1000;
            console.log('🔄 OMS 自动同步已启动，间隔 ' + (cfg.intervalMinutes || 60) + ' 分钟');

            // 立即执行一次
            syncFromOMS();

            omsSyncTimer = setInterval(() => {
                if (systemSettings.omsSync.enabled) {
                    syncFromOMS();
                } else {
                    stopOMSAutoSync();
                }
            }, intervalMs);
        }

        function stopOMSAutoSync() {
            if (omsSyncTimer) {
                clearInterval(omsSyncTimer);
                omsSyncTimer = null;
                console.log('🔄 OMS 自动同步已停止');
            }
        }

        // ============ UI 状态更新 ============

        function updateSyncStatus(text, color) {
            const el = document.getElementById('omsSyncStatus');
            if (el) {
                el.textContent = text;
                if (color) el.style.color = color;
            }
        }

        function showSyncResult(msg, isSuccess) {
            // 浮动提示
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed; bottom: 20px; right: 20px; z-index: 9999;
                padding: 12px 20px; border-radius: 8px;
                background: ${isSuccess ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)'};
                color: #fff; font-size: 13px; font-weight: 500;
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                animation: fadeInUp 0.3s ease;
                max-width: 400px;
            `;
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.5s';
                setTimeout(() => toast.remove(), 500);
            }, 4000);
        }

        // ============ 同步日志页面 ============

        function renderOMSSyncLog() {
            const cfg = systemSettings.omsSync;
            const logs = cfg.syncLog || [];

            if (logs.length === 0) {
                return '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">暂无同步记录</div>';
            }

            return `<div style="max-height:300px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.05);">
                            <th style="padding:6px 8px;text-align:left;color:var(--text-secondary);">时间</th>
                            <th style="padding:6px 8px;text-align:center;color:var(--text-secondary);">状态</th>
                            <th style="padding:6px 8px;text-align:center;color:var(--text-secondary);">变更</th>
                            <th style="padding:6px 8px;text-align:left;color:var(--text-secondary);">详情</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:6px 8px;color:var(--text-muted);">
                                    ${log.time ? log.time.substring(0, 19).replace('T', ' ') : '-'}
                                </td>
                                <td style="padding:6px 8px;text-align:center;">
                                    ${log.success
                                        ? '<span style="color:#22c55e;">✅</span>'
                                        : '<span style="color:#ef4444;">❌</span>'}
                                </td>
                                <td style="padding:6px 8px;text-align:center;color:#fff;">
                                    ${log.success ? (log.changed || 0) + ' / ' + (log.total || 0) : '-'}
                                </td>
                                <td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">
                                    ${log.message || (log.success ? '同步完成' : '失败')}
                                    ${log.unmatched ? ' (' + log.unmatched + ' 未匹配)' : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        // ============ 刷新同步日志UI ============

        function refreshOMSSyncLog() {
            var container = document.getElementById('omsSyncLogContainer');
            var summary = document.querySelector('#settingsContent details summary');
            if (container) {
                container.innerHTML = renderOMSSyncLog();
            }
            if (summary) {
                var count = (systemSettings.omsSync.syncLog || []).length;
                summary.textContent = '📋 同步记录 (' + count + ')';
            }
        }

        // ============ 初始化检查（页面加载时自动启动） ============

        // 在 settings 加载完成后，如果 OMS 已启用则自动启动
        // 钩子由 settings.js 的 renderSettingsPage 触发
        function initOMSSyncOnLoad() {
            const cfg = systemSettings.omsSync;
            if (cfg.enabled && cfg.apiUrl) {
                startOMSAutoSync();
            }
        }

        // 当用户切换 OMS 启用状态时调用
        function toggleOMSSync(enabled) {
            systemSettings.omsSync.enabled = enabled;
            debouncedSaveSettings();
            if (enabled) {
                startOMSAutoSync();
            } else {
                stopOMSAutoSync();
            }
        }

        function updateOMSApiUrl(url) {
            systemSettings.omsSync.apiUrl = url;
            debouncedSaveSettings();
        }

        function updateOMSApiKey(key) {
            systemSettings.omsSync.apiKey = key;
            debouncedSaveSettings();
        }

        function updateOMSInterval(minutes) {
            systemSettings.omsSync.intervalMinutes = parseInt(minutes) || 60;
            debouncedSaveSettings();
            // 如果正在运行，重启定时器
            if (omsSyncTimer) {
                startOMSAutoSync();
            }
        }
