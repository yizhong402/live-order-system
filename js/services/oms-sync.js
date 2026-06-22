// oms-sync.js — OMS 库存同步状态显示（前端只读）
// 实际同步由服务端 oms_sync.py 执行（避免 CORS 问题）
// 配置通过 settings.js 保存到 BaaS settings 表

        function renderOMSSyncLog() {
            // 从 BaaS 读取同步日志
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
                var icon = log.success
                    ? '<span style="color:#22c55e;">✅</span>'
                    : '<span style="color:#ef4444;">❌</span>';
                var changeInfo = log.success ? (log.changed || 0) + '/' + (log.total || 0) : '-';
                rows += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                    '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + timeStr + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;">' + icon + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;color:#fff;font-size:12px;">' + changeInfo + '</td>' +
                    '<td style="padding:6px 8px;color:var(--text-muted);font-size:11px;">' + (log.message || '') + '</td></tr>';
            });

            return '<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="background:rgba(255,255,255,0.05);">' +
                '<th style="padding:6px 8px;text-align:left;">时间</th>' +
                '<th style="padding:6px 8px;text-align:center;">状态</th>' +
                '<th style="padding:6px 8px;text-align:center;">变更</th>' +
                '<th style="padding:6px 8px;text-align:left;">说明</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>';
        }

        function refreshOMSSyncLog() {
            var container = document.getElementById('omsSyncLogContainer');
            var summary = document.querySelector('#settingsContent details summary');
            if (container) container.innerHTML = renderOMSSyncLog();

            var logs = [];
            try {
                var raw = (systemSettings.omsSync && systemSettings.omsSync.syncLog) || [];
                if (typeof raw === 'string') raw = JSON.parse(raw);
                logs = Array.isArray(raw) ? raw : [];
            } catch(e) {}
            if (summary) summary.textContent = '📋 同步记录 (' + logs.length + ')';
        }

        function initOMSSyncOnLoad() {
            // 前端不需要做任何同步，由服务端 cron 执行
            var el = document.getElementById('omsManualSyncBtn');
            if (el) {
                el.textContent = '⚡ 同步由服务端定时执行';
                el.disabled = true;
                el.style.opacity = '0.5';
                el.title = 'OMS API 不支持浏览器跨域请求，同步由服务器定时执行';
            }
        }

        function toggleOMSSync(enabled) {
            systemSettings.omsSync.enabled = enabled;
            debouncedSaveSettings();
            // 同步由服务端 cron 触发
        }

        function updateOMSInterval(minutes) {
            systemSettings.omsSync.intervalMinutes = parseInt(minutes) || 60;
            debouncedSaveSettings();
        }
