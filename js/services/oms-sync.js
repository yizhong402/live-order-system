// oms-sync.js — OMS 库存同步服务
// 完整流程：
//   1. GET  /api/oauth/authorize  → 授权码 code
//   2. GET  /api/oauth/accessToken → accessToken + refreshToken + userId
//   3. POST /api/inventory/queryInventory (HMAC签名) → 库存数据

        // 配置常量（从设置读取）
        // systemSettings.omsSync: {
        //   enabled: false,
        //   domain: '',          // OMS 域名（如 https://ftnet.jfwms.com）
        //   authDomain: '',      // 授权domain参数（如 ftnet）
        //   clientId: '',
        //   clientSecret: '',
        //   email: '',
        //   token: '',
        //   intervalMinutes: 60,
        //   lastSync: null,
        //   syncLog: []
        // }

        // ============ OMS 客户端状态 ============
        var omsState = {
            accessToken: null,
            refreshToken: null,
            userId: 0
        };
        var omsSyncTimer = null;

        // ============ 工具函数 ============
        function stripProtocol(u) {
            return u ? u.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '';
        }

        // HMAC-SHA256 签名（Web Crypto API）
        async function omsSign(method, path, payload) {
            var cfg = systemSettings.omsSync;
            var nonce = String(Date.now()) + String(Math.floor(Math.random() * 100000));
            var ts = String(Date.now());

            var params = {
                accessToken: omsState.accessToken || '',
                clientId: cfg.clientId,
                method: method.toLowerCase(),
                nonce: nonce,
                timestamp: ts,
                url: path,
                userId: String(omsState.userId)
            };

            // 排序拼接
            var keys = Object.keys(params).sort();
            var signStr = keys.map(function(k) { return k + '=' + params[k]; }).join('&');

            // HMAC-SHA256
            var enc = new TextEncoder();
            var keyData = enc.encode(cfg.clientSecret);
            var msgData = enc.encode(signStr);

            var cryptoKey = await crypto.subtle.importKey(
                'raw', keyData, { name: 'HMAC', hash: 'SHA-256' },
                false, ['sign']
            );
            var sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
            var hex = Array.from(new Uint8Array(sig)).map(function(b) {
                return b.toString(16).padStart(2, '0');
            }).join('');

            return {
                'clientId': cfg.clientId,
                'accessToken': omsState.accessToken || '',
                'timestamp': ts,
                'nonce': nonce,
                'userId': String(omsState.userId),
                'sign': hex,
                'Content-Type': 'application/json'
            };
        }

        // ============ 核心同步 ============
        async function syncFromOMS() {
            var cfg = systemSettings.omsSync;
            var host = stripProtocol(cfg.domain);

            if (!host) return showSyncResult('❌ 域名未配置', false);
            if (!cfg.clientId || !cfg.clientSecret) return showSyncResult('❌ clientId 或 clientSecret 未配置', false);
            if (!cfg.authDomain) return showSyncResult('❌ 授权 domain 未配置', false);

            updateSyncStatus('🔄 认证中...', '#f59e0b');

            try {
                // === 第 1 步：获取授权码 ===
                var params = new URLSearchParams();
                params.set('domain', cfg.authDomain);
                params.set('clientId', cfg.clientId);
                params.set('email', cfg.email);
                if (cfg.token) params.set('token', cfg.token);

                var authUrl = 'https://' + host + '/api/oauth/authorize?' + params.toString();
                console.log('[OMS] 请求授权...');

                var authResp = await fetch(authUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(15000)
                });

                if (!authResp.ok) throw new Error('授权请求失败 (' + authResp.status + ')');
                var authData = await authResp.json();
                if (authData.code !== 0) throw new Error('授权失败: ' + (authData.message || JSON.stringify(authData)));

                var code = authData.data;  // 授权码在 data 字段
                if (!code) throw new Error('授权响应中未找到 code');
                console.log('[OMS] ✅ 授权码获取成功');

                // === 第 2 步：兑换 accessToken ===
                updateSyncStatus('🔄 获取 AccessToken...', '#f59e0b');

                var tokenUrl = 'https://' + host + '/api/oauth/accessToken' +
                    '?clientId=' + encodeURIComponent(cfg.clientId) +
                    '&clientSecret=' + encodeURIComponent(cfg.clientSecret) +
                    '&key=' + encodeURIComponent(code);

                var tokenResp = await fetch(tokenUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(15000)
                });

                if (!tokenResp.ok) throw new Error('Token 请求失败 (' + tokenResp.status + ')');
                var tokenData = await tokenResp.json();
                if (tokenData.code !== 0) throw new Error('Token 兑换失败: ' + (tokenData.message || JSON.stringify(tokenData)));

                omsState.accessToken = tokenData.data.accessToken;
                omsState.refreshToken = tokenData.data.refreshToken;
                omsState.userId = tokenData.data.userId || 0;
                console.log('[OMS] ✅ AccessToken 获取成功, userId: ' + omsState.userId);

                // === 第 3 步：查询库存 ===
                updateSyncStatus('🔄 同步库存...', '#f59e0b');

                var inventoryPath = '/api/inventory/queryInventory';
                var headers = await omsSign('POST', inventoryPath, {});
                headers['Accept'] = 'application/json';

                var invResp = await fetch('https://' + host + inventoryPath, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ warehouse: cfg.authDomain, pageNo: 1, pageSize: 500 }),
                    signal: AbortSignal.timeout(30000)
                });

                if (!invResp.ok) throw new Error('库存查询失败 (' + invResp.status + ')');
                var invData = await invResp.json();
                if (invData.code !== 0) throw new Error('库存查询失败: ' + (invData.message || JSON.stringify(invData)));

                var rows = invData.data && invData.data.rows;
                if (!rows || rows.length === 0) throw new Error('OMS 未返回库存数据');

                // === 第 4 步：对比更新 ===
                var omsMap = {};
                rows.forEach(function(r) {
                    var sku = (r.sku || '').trim();
                    if (sku) omsMap[sku] = {
                        total: r.totalNum || 0,
                        avail: r.availableNum || 0,
                        lock: r.lockedNum || 0
                    };
                });

                var changes = [];
                var noMatch = [];

                Object.keys(omsMap).forEach(function(sku) {
                    var local = products.find(function(p) { return p.sku === sku; });
                    if (local) {
                        var newStock = omsMap[sku].total;
                        if (local.stock !== newStock) {
                            changes.push({ sku: sku, old: local.stock, new: newStock });
                            local.stock = newStock;
                        }
                    } else {
                        noMatch.push(sku);
                    }
                });

                // === 第 5 步：同步到 BaaS ===
                var updatedCount = 0;
                for (var i = 0; i < changes.length; i++) {
                    var chg = changes[i];
                    try {
                        var searchRes = await client.db.from('products')
                            .select('id,stock').where('sku', chg.sku).list();
                        if (searchRes.success && searchRes.data && searchRes.data.length > 0) {
                            await client.db.from('products')
                                .update(searchRes.data[0].id, { stock: chg.new });
                            updatedCount++;
                        }
                    } catch(e) {
                        console.warn('[OMS] 云端更新失败:', chg.sku, e.message);
                    }
                }

                // 更新同步记录
                var syncLog = {
                    time: new Date().toISOString(),
                    success: true,
                    changed: changes.length,
                    updated: updatedCount,
                    total: Object.keys(omsMap).length,
                    unmatched: noMatch.length,
                    message: changes.length + ' 个变更 / ' + Object.keys(omsMap).length + ' SKU' + (noMatch.length > 0 ? ' (' + noMatch.length + ' 未匹配)' : '')
                };
                cfg.lastSync = syncLog.time;
                cfg.syncLog = cfg.syncLog || [];
                cfg.syncLog.unshift(syncLog);
                if (cfg.syncLog.length > 50) cfg.syncLog = cfg.syncLog.slice(0, 50);
                await saveSettings();

                // 刷新 UI
                if (changes.length > 0 && typeof updateSkuList === 'function') updateSkuList();
                refreshOMSSyncLog();
                updateSyncStatus('✅ 上次同步: ' + new Date().toLocaleString(), '#22c55e');
                showSyncResult('✅ 同步完成 | ' + changes.length + ' 变更 / ' + Object.keys(omsMap).length + ' SKU', true);

                return { success: true };
            } catch(e) {
                console.error('[OMS] 同步失败:', e);
                cfg.syncLog = cfg.syncLog || [];
                cfg.syncLog.unshift({
                    time: new Date().toISOString(),
                    success: false,
                    changed: 0,
                    total: 0,
                    message: '❌ ' + e.message.substring(0, 200)
                });
                if (cfg.syncLog.length > 50) cfg.syncLog = cfg.syncLog.slice(0, 50);
                await saveSettings();
                refreshOMSSyncLog();
                updateSyncStatus('❌ ' + e.message.substring(0, 80), '#ef4444');
                showSyncResult('❌ 同步失败: ' + e.message.substring(0, 100), false);
                return { success: false };
            }
        }

        // ============ 定时同步 ============
        function startOMSAutoSync() {
            stopOMSAutoSync();
            var cfg = systemSettings.omsSync;
            if (!cfg.enabled || !cfg.domain) return;
            var ms = (cfg.intervalMinutes || 60) * 60 * 1000;
            syncFromOMS();
            omsSyncTimer = setInterval(function() {
                if (systemSettings.omsSync.enabled) syncFromOMS();
                else stopOMSAutoSync();
            }, ms);
        }

        function stopOMSAutoSync() {
            if (omsSyncTimer) { clearInterval(omsSyncTimer); omsSyncTimer = null; }
        }

        // ============ UI ============
        function updateSyncStatus(text, color) {
            var el = document.getElementById('omsSyncStatus');
            if (el) { el.textContent = text; if (color) el.style.color = color; }
        }

        function showSyncResult(msg, isSuccess) {
            var toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:8px;background:' + (isSuccess ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)') + ';color:#fff;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:400px;';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(function() {
                toast.style.transition = 'opacity 0.5s';
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 500);
            }, 4000);
        }

        function renderOMSSyncLog() {
            var logs = systemSettings.omsSync.syncLog || [];
            if (logs.length === 0) return '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">暂无同步记录</div>';
            var rows = '';
            logs.forEach(function(log) {
                var timeStr = log.time ? log.time.substring(0, 19).replace('T', ' ') : '-';
                rows += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                    '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + timeStr + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;">' + (log.success ? '<span style="color:#22c55e;">✅</span>' : '<span style="color:#ef4444;">❌</span>') + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;color:#fff;font-size:12px;">' + (log.success ? (log.changed || 0) + '/' + (log.total || 0) : '-') + '</td>' +
                    '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + (log.message || '') + '</td></tr>';
            });
            return '<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:rgba(255,255,255,0.05);"><th style="padding:6px 8px;text-align:left;">时间</th><th style="padding:6px 8px;text-align:center;">状态</th><th style="padding:6px 8px;text-align:center;">变更</th><th style="padding:6px 8px;text-align:left;">说明</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
        }

        function refreshOMSSyncLog() {
            var container = document.getElementById('omsSyncLogContainer');
            var summary = document.querySelector('#settingsContent details summary');
            if (container) container.innerHTML = renderOMSSyncLog();
            if (summary) summary.textContent = '📋 同步记录 (' + (systemSettings.omsSync.syncLog || []).length + ')';
        }

        // ============ 配置更新函数 ============
        function initOMSSyncOnLoad() {
            var cfg = systemSettings.omsSync;
            if (cfg.enabled && cfg.domain) startOMSAutoSync();
        }

        function toggleOMSSync(enabled) {
            systemSettings.omsSync.enabled = enabled;
            debouncedSaveSettings();
            if (enabled) startOMSAutoSync();
            else stopOMSAutoSync();
        }

        function updateOMSInterval(minutes) {
            systemSettings.omsSync.intervalMinutes = parseInt(minutes) || 60;
            debouncedSaveSettings();
            if (omsSyncTimer) startOMSAutoSync();
        }
