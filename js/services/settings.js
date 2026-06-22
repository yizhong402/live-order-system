// settings.js - 系统设置

        // ===== 系统设置数据结构 =====
        let systemSettings = {
            // 平台费模板
            platformFees: [
                { name: 'TT Shop', rate: 15, desc: 'TikTok Shop 默认费率' },
                { name: 'Shopee', rate: 10, desc: 'Shopee 默认费率' },
                { name: '独立站', rate: 5, desc: '独立站/自建站费率' },
            ],
            // 运费模板
            shippingTemplates: [
                { name: '美国', countries: 'US', baseFee: 5.0, perKg: 3.0 },
                { name: '东南亚', countries: 'TH,PH,ID,MY,VN,SG', baseFee: 3.0, perKg: 2.0 },
                { name: '英国', countries: 'GB', baseFee: 6.0, perKg: 3.5 },
            ],
            // 汇率
            exchangeRate: 7.2,  // 1 USD = 7.2 CNY
            // OMS同步配置
            omsSync: {
                enabled: false,
                domain: '',       // OMS 域名（如 https://ftnet.jfwms.com）
                authDomain: '',   // 授权 domain 参数（如 ftnet）
                clientId: '',     // API 客户端 ID
                clientSecret: '', // API 客户端密钥
                email: '',        // 注册邮箱
                token: '',        // OMS 授权一次性 Token
                intervalMinutes: 60,
                lastSync: null,
                autoSync: false,
                syncLog: [],
            }
        };

        let _settingsLoaded = false;

        // 从云端加载设置
        async function loadSettings() {
            try {
                const res = await client.db.from('settings').list();
                if (res.success && res.data && res.data.length > 0) {
                    const cloud = res.data[0];
                    // 解析 JSON 字符串字段（BaaS JSON 字段存为字符串）
                    if (typeof cloud.omsSync === 'string') cloud.omsSync = JSON.parse(cloud.omsSync);
                    if (typeof cloud.platformFees === 'string') cloud.platformFees = JSON.parse(cloud.platformFees);
                    if (typeof cloud.shippingTemplates === 'string') cloud.shippingTemplates = JSON.parse(cloud.shippingTemplates);
                    systemSettings = deepMerge(systemSettings, cloud);
                    console.log('⚙️ 系统设置已加载');
                }
                _settingsLoaded = true;
            } catch (e) {
                console.warn('⚙️ 云端设置加载失败，使用默认值:', e.message);
                _settingsLoaded = true;
            }
        }

        // 保存设置到云端
        async function saveSettings() {
            try {
                const res = await client.db.from('settings').list();
                if (res.success && res.data && res.data.length > 0) {
                    const existing = res.data[0];
                    await client.db.from('settings').update(existing.id, systemSettings);
                } else {
                    await client.db.from('settings').save(systemSettings);
                }
                console.log('⚙️ 系统设置已保存');
                return true;
            } catch (e) {
                console.error('⚙️ 设置保存失败:', e);
                return false;
            }
        }

        // 深层合并
        function deepMerge(target, source) {
            const result = JSON.parse(JSON.stringify(target));
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = deepMerge(result[key] || {}, source[key]);
                } else if (source[key] !== undefined && source[key] !== null) {
                    result[key] = source[key];
                }
            }
            return result;
        }

        // 获取有效平台费模板的费率（第一个或指定）
        function getPlatformFeeRate(platformName) {
            if (!platformName) {
                return systemSettings.platformFees.length > 0 ? systemSettings.platformFees[0].rate : 10;
            }
            const tmpl = systemSettings.platformFees.find(t => 
                t.name.toLowerCase() === platformName.toLowerCase()
            );
            return tmpl ? tmpl.rate : 10;
        }

        // ===== 设置页面渲染 =====
        function renderSettingsPage() {
            const container = document.getElementById('settingsContent');
            if (!container) return;

            let html = '';

            // === 平台费用模板 ===
            html += '<div class="settings-section">' +
                '<div class="settings-section-header">' +
                    '<h3>🏪 平台费用模板</h3>' +
                    '<button class="btn btn-success" onclick="addPlatformFeeTmpl()" style="padding:4px 12px;font-size:12px;">+ 添加模板</button>' +
                '</div>' +
                '<p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">设置各平台的默认手续费率，毛利计算将使用当前选中平台的费率</p>' +
                '<table class="settings-table"><thead><tr><th>平台名称</th><th>费率 (%)</th><th>说明</th><th style="width:60px;"></th></tr></thead><tbody id="platformFeeTableBody">';
            
            systemSettings.platformFees.forEach((t, i) => {
                html += '<tr>' +
                    '<td><input class="settings-input" value="' + escHtml(t.name) + '" onchange="updatePlatformFee(' + i + ',\'name\',this.value)" style="width:120px;"></td>' +
                    '<td><input class="settings-input" type="number" min="0" step="0.1" value="' + t.rate + '" onchange="updatePlatformFee(' + i + ',\'rate\',this.value)" style="width:80px;"></td>' +
                    '<td><input class="settings-input" value="' + escHtml(t.desc || '') + '" onchange="updatePlatformFee(' + i + ',\'desc\',this.value)" style="width:200px;"></td>' +
                    '<td><button class="btn btn-danger" onclick="removePlatformFee(' + i + ')" style="padding:2px 8px;font-size:11px;">🗑️</button></td>' +
                '</tr>';
            });

            html += '</tbody></table></div>';

            // === 运费模板 ===
            html += '<div class="settings-section">' +
                '<div class="settings-section-header">' +
                    '<h3>🚚 运费模板</h3>' +
                    '<button class="btn btn-success" onclick="addShippingTmpl()" style="padding:4px 12px;font-size:12px;">+ 添加模板</button>' +
                '</div>' +
                '<p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">按国家/地区设置运费，毛利率计算时将扣除对应运费</p>' +
                '<table class="settings-table"><thead><tr><th>模板名称</th><th>国家代码</th><th>基础运费 ($)</th><th>续重每KG ($)</th><th style="width:60px;"></th></tr></thead><tbody id="shippingTableBody">';
            
            systemSettings.shippingTemplates.forEach((t, i) => {
                html += '<tr>' +
                    '<td><input class="settings-input" value="' + escHtml(t.name) + '" onchange="updateShippingTmpl(' + i + ',\'name\',this.value)" style="width:100px;"></td>' +
                    '<td><input class="settings-input" value="' + escHtml(t.countries) + '" onchange="updateShippingTmpl(' + i + ',\'countries\',this.value)" style="width:140px;" placeholder="US,TH,PH..."></td>' +
                    '<td><input class="settings-input" type="number" min="0" step="0.1" value="' + t.baseFee + '" onchange="updateShippingTmpl(' + i + ',\'baseFee\',this.value)" style="width:80px;"></td>' +
                    '<td><input class="settings-input" type="number" min="0" step="0.1" value="' + t.perKg + '" onchange="updateShippingTmpl(' + i + ',\'perKg\',this.value)" style="width:80px;"></td>' +
                    '<td><button class="btn btn-danger" onclick="removeShippingTmpl(' + i + ')" style="padding:2px 8px;font-size:11px;">🗑️</button></td>' +
                '</tr>';
            });

            html += '</tbody></table></div>';

            // === 汇率设置 ===
            html += '<div class="settings-section">' +
                '<div class="settings-section-header"><h3>💱 汇率设置</h3></div>' +
                '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
                    '<div class="form-group" style="margin-bottom:0;flex:1;max-width:300px;">' +
                        '<label>1 USD = <input class="settings-input" type="number" min="0.01" step="0.01" value="' + systemSettings.exchangeRate + '" onchange="updateExchangeRate(this.value)" style="width:90px;"> CNY</label>' +
                    '</div>' +
                    '<div style="font-size:12px;color:var(--text-muted);">' +
                        '<span>当前参考: 1 USD ≈ ' + systemSettings.exchangeRate + ' CNY</span>' +
                    '</div>' +
                '</div>' +
            '</div>';

            // === OMS同步配置 ===
            var omsCfg = systemSettings.omsSync;
            html += '<div class="settings-section">' +
                '<div class="settings-section-header">' +
                    '<h3>🔄 OMS 库存同步</h3>' +
                    '<span style="font-size:11px;color:var(--text-muted);background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px;">服务端定时执行</span>' +
                '</div>' +
                '<p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">定时从外部OMS系统（PA仓库）同步库存到商品管理。同步由服务器定时执行，浏览器端仅查看状态。</p>' +
                '<div style="display:flex;flex-direction:column;gap:10px;">' +
                    '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
                        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">' +
                            '<input type="checkbox" ' + (omsCfg.enabled ? 'checked' : '') + ' onchange="toggleOMSSync(this.checked)"> 启用自动同步' +
                        '</label>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">同步间隔（分钟）</label>' +
                            '<input class="settings-input" type="number" min="5" value="' + omsCfg.intervalMinutes + '" onchange="updateOMSInterval(this.value)" style="width:80px;">' +
                        '</div>' +
                        '<span id="omsSyncStatus" style="font-size:12px;color:var(--text-muted);">' +
                            (omsCfg.lastSync ? '上次同步: ' + omsCfg.lastSync.substring(0, 19).replace('T', ' ') : '尚未同步') +
                        '</span>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">OMS 域名</label>' +
                            '<input class="settings-input" type="text" value="' + escHtml(omsCfg.domain) + '" onchange="updateOMSDomain(this.value)" ' +
                                'placeholder="ftnet.jfwms.com" style="width:100%;">' +
                        '</div>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">授权 domain 参数</label>' +
                            '<input class="settings-input" type="text" value="' + escHtml(omsCfg.authDomain) + '" onchange="updateOMSAuthDomain(this.value)" ' +
                                'placeholder="ftnet" style="width:100%;">' +
                        '</div>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">邮箱 <span style="color:var(--text-muted);">email</span></label>' +
                            '<input class="settings-input" type="email" value="' + escHtml(omsCfg.email) + '" onchange="updateOMSEmail(this.value)" ' +
                                'placeholder="xxx@qq.com" style="width:100%;">' +
                        '</div>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">Client ID</label>' +
                            '<input class="settings-input" type="text" value="' + escHtml(omsCfg.clientId) + '" onchange="updateOMSClientId(this.value)" ' +
                                'placeholder="client_id" style="width:100%;">' +
                        '</div>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">Client Secret</label>' +
                            '<input class="settings-input" type="password" value="' + escHtml(omsCfg.clientSecret) + '" onchange="updateOMSClientSecret(this.value)" ' +
                                'placeholder="client_secret" style="width:100%;">' +
                        '</div>' +
                        '<div class="form-group" style="margin-bottom:0;">' +
                            '<label style="font-size:12px;">授权 Token（15分钟有效）</label>' +
                            '<input class="settings-input" type="password" value="' + escHtml(omsCfg.token) + '" onchange="updateOMSToken(this.value)" ' +
                                'placeholder="OMS 后台生成 token" style="width:100%;">' +
                        '</div>' +
                    '</div>' +
                    '<details style="margin-top:8px;">' +
                        '<summary style="cursor:pointer;font-size:12px;color:var(--text-secondary);padding:4px 0;">📋 同步记录 (' + (omsCfg.syncLog || []).length + ')</summary>' +
                        '<div id="omsSyncLogContainer">' +
                            (typeof renderOMSSyncLog === 'function' ? renderOMSSyncLog() : '<div style="color:var(--text-muted);font-size:12px;">加载中...</div>') +
                        '</div>' +
                    '</details>' +
                '</div>' +
            '</div>';

            container.innerHTML = html;

            // 页面渲染后初始化 OMS 自动同步
            setTimeout(function() {
                if (typeof omsSyncTimer !== 'undefined' && systemSettings.omsSync.enabled && systemSettings.omsSync.domain) {
                    if (typeof startOMSAutoSync === 'function' && !omsSyncTimer) {
                        startOMSAutoSync();
                    }
                }
            }, 500);
        }

        // ===== 字段更新函数 =====
        function updatePlatformFee(index, field, value) {
            if (!systemSettings.platformFees[index]) return;
            if (field === 'rate') value = parseFloat(value) || 0;
            systemSettings.platformFees[index][field] = value;
            debouncedSaveSettings();
        }

        function addPlatformFeeTmpl() {
            systemSettings.platformFees.push({ name: '新平台', rate: 10, desc: '' });
            renderSettingsPage();
        }

        function removePlatformFee(index) {
            systemSettings.platformFees.splice(index, 1);
            renderSettingsPage();
            debouncedSaveSettings();
        }

        function updateShippingTmpl(index, field, value) {
            if (!systemSettings.shippingTemplates[index]) return;
            if (field === 'baseFee' || field === 'perKg') value = parseFloat(value) || 0;
            systemSettings.shippingTemplates[index][field] = value;
            debouncedSaveSettings();
        }

        function addShippingTmpl() {
            systemSettings.shippingTemplates.push({ name: '新地区', countries: '', baseFee: 3.0, perKg: 2.0 });
            renderSettingsPage();
        }

        function removeShippingTmpl(index) {
            systemSettings.shippingTemplates.splice(index, 1);
            renderSettingsPage();
            debouncedSaveSettings();
        }

        function updateExchangeRate(value) {
            systemSettings.exchangeRate = parseFloat(value) || 7.2;
            debouncedSaveSettings();
        }

        // ===== OMS 同步配置更新函数 =====
        function updateOMSDomain(value) {
            systemSettings.omsSync.domain = value;
            debouncedSaveSettings();
        }
        function updateOMSAuthDomain(value) {
            systemSettings.omsSync.authDomain = value;
            debouncedSaveSettings();
        }
        function updateOMSEmail(value) {
            systemSettings.omsSync.email = value;
            debouncedSaveSettings();
        }
        function updateOMSClientId(value) {
            systemSettings.omsSync.clientId = value;
            debouncedSaveSettings();
        }
        function updateOMSClientSecret(value) {
            systemSettings.omsSync.clientSecret = value;
            debouncedSaveSettings();
        }
        function updateOMSToken(value) {
            systemSettings.omsSync.token = value;
            debouncedSaveSettings();
        }

        // ===== 防抖保存 =====
        var _saveTimer = null;
        function debouncedSaveSettings() {
            if (_saveTimer) clearTimeout(_saveTimer);
            _saveTimer = setTimeout(async function() {
                await saveSettings();
            }, 800);
        }

        // 辅助函数
        function escHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
