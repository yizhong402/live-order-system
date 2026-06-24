// session.js

        // ============ 多场次支持 ============
        const activeSessions = {};      // { id: sessionObject, ... }
        let currentSessionId = null;    // 当前选中的场次 ID
        let activeSessionPollTimer = null; // 轮询活跃场次定时器
        
        function getCurrentSession() {
            if (currentSessionId && activeSessions[currentSessionId]) {
                return activeSessions[currentSessionId];
            }
            return null;
        }
        
        // 将当前全局状态同步到activeSessions中的对应场次
        function syncGlobalsToSession() {
            const s = getCurrentSession();
            if (!s) return;
            s.currentRound = currentRound;
            s.currentSkus = { ...currentSkus };
            s.titleHistory = [...titleHistory];
            s.titleRoundMap = { ...titleRoundMap };
            s.lastBaseTitle = lastBaseTitle;
            s.orders = orders.filter(o => o.sessionId === currentSessionId);
        }
        
        // 从场次对象恢复全局状态
        function syncSessionToGlobals(session) {
            if (!session) return;
            currentSession = session;
            currentRound = session.currentRound || 1;
            currentSkus = session.currentSkus ? { ...session.currentSkus } : {};
            titleHistory = session.titleHistory ? [...session.titleHistory] : [];
            titleRoundMap = session.titleRoundMap ? { ...session.titleRoundMap } : {};
            lastBaseTitle = session.lastBaseTitle || '';
            // orders 全局保留，显示时按 session_id 过滤
        }
        
        function listActiveSessions() {
            return Object.values(activeSessions).filter(s => s.isActive !== false);
        }
        
        function switchSession(id) {
            // 先保存当前场次状态
            syncGlobalsToSession();
            
            if (id && activeSessions[id]) {
                currentSessionId = id;
                syncSessionToGlobals(activeSessions[id]);
            } else {
                // 切换到空状态（无场次选中）
                currentSessionId = null;
                currentSession = null;
                currentRound = 1;
                currentSkus = {};
                titleHistory = [];
                titleRoundMap = {};
                lastBaseTitle = '';
            }
            
            // 更新UI
            updateSessionSelector();
            updateSessionDisplay();
            if (currentSessionId) {
                updateTitleHistorySelect();
                updateCurrentTitle();
                updateCurrentRoundDisplay();
                // 按session_id过滤加载订单
                loadOrdersForCurrentSession();
            }
            updateActiveSessionsCards();
        }
        
        function loadOrdersForCurrentSession() {
            // orders 已经全局加载，显示时根据 sessionId 过滤
            // 触发页面更新
            if (typeof updateOrderList === 'function') updateOrderList();
            if (typeof updateRealTimeOrderList === 'function') updateRealTimeOrderList();
        }
        
        function endSession(id) {
            const session = activeSessions[id];
            if (!session) return;
            
            if (!confirm(`确定要结束场次「${session.sessionTitle}」吗？\n开始时间：${session.startTime}\n当前轮次：${session.currentRound || 1}`)) return;
            
            syncGlobalsToSession();
            session.endTime = new Date().toLocaleString('zh-CN');
            session.totalRounds = session.currentRound || 1;
            session.isActive = false;
            
            // 存入live_history
            liveHistory.push({ ...session });
            try {
                client.db.from("live_sessions").insert().values({
                    session_no: session.sessionNumber || "",
                    title: session.sessionTitle || "",
                    date: session.date || "",
                    time: session.time || "",
                    anchor: session.anchor || "",
                    platform: session.platform || "",
                    status: "ended"
                }).catch(e => {});
            } catch(e) {}
            
            delete activeSessions[id];
            
            // 如果结束的是当前场次，切到其他活跃场次或空状态
            if (currentSessionId === id) {
                const remaining = listActiveSessions();
                if (remaining.length > 0) {
                    switchSession(remaining[0].id);
                } else {
                    switchSession(null);
                }
            }
            
            updateSessionSelector();
            updateActiveSessionsCards();
            updateSessionDisplay();
            
            if (typeof updateDataStats === 'function') updateDataStats();
            
            console.log('场次已结束:', session.sessionTitle);
        }
        
        // 创建新场次
        async function createSession() {
            const sessionTitle = document.getElementById('sessionTitle').value.trim();
            const date = document.getElementById('sessionDate').value;
            const time = document.getElementById('sessionTimeInput').value;
            const anchor = document.getElementById('anchorName').value.trim();
            
            if (!sessionTitle) { alert('请输入直播标题！'); return; }
            if (!date) { alert('请选择直播日期！'); return; }
            if (!anchor) { alert('请输入主播名字！'); return; }
            
            const todaySessions = liveHistory.filter(s => s.date === date);
            const sessionNumber = todaySessions.length + 1;
            
            const startTime = new Date().toLocaleString('zh-CN');
            const localId = Date.now();
            const session = {
                id: localId,
                sessionTitle: sessionTitle,
                date: date,
                time: time || '00:00',
                anchor: anchor,
                sessionNumber: sessionNumber,
                title: `${sessionTitle} | 第${sessionNumber}场 | ${date} ${time || '00:00'} | ${anchor}`,
                startTime: startTime,
                created_at: new Date().toISOString().slice(0,19).replace('T', ' '),
                currentRound: 1,
                currentSkus: {},
                titleHistory: [],
                titleRoundMap: {},
                lastBaseTitle: '',
                orders: [],
                isActive: true
            };
            
            // 保存到云端并捕获BaaS返回的ID
            try {
                var insResult = await client.db.from("live_sessions").insert().values({
                    title: session.sessionTitle,
                    date: session.date,
                    time: session.time,
                    anchor: session.anchor,
                    client_id: localId,
                    status: "active"
                });
                if (insResult && insResult.data && insResult.data.id) {
                    // 使用BaaS ID作为session.id，确保刷新后一致
                    var baasId = insResult.data.id;
                    delete activeSessions[session.id];
                    session.id = baasId;
                    // 更新已有订单的sessionId
                    if (typeof orders !== 'undefined') {
                        orders.forEach(function(o) {
                            if (o.sessionId == localId) o.sessionId = baasId;
                        });
                    }
                }
            } catch(e) { console.error('☁️ 场次保存失败:', e); }
            
            activeSessions[session.id] = session;
            
            // 切到新场次
            switchSession(session.id);
            
            closeSessionModal();
            console.log('创建场次:', session);
        }

        function openSessionModal() {
            document.getElementById('sessionModal').classList.add('active');
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('sessionDate').value = today;
            document.getElementById('sessionTitle').value = '';
            document.getElementById('sessionTimeInput').value = '';
            document.getElementById('anchorName').value = '';
        }
        
        function closeSessionModal() {
            document.getElementById('sessionModal').classList.remove('active');
        }
        
        function openHelpModal() {
            document.getElementById('helpModal').style.display = 'flex';
        }
        
        function closeHelpModal() {
            document.getElementById('helpModal').style.display = 'none';
        }
        
        function updateSessionSelector() {
            const sel = document.getElementById('sessionSelector');
            if (!sel) return;
            const active = listActiveSessions();
            const currentId = currentSessionId;
            sel.innerHTML = '<option value="">-- 请选择场次 --</option>';
            active.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.sessionTitle} (${s.anchor})`;
                if (s.id === currentId) opt.selected = true;
                sel.appendChild(opt);
            });
            // 也更新场次标签
            const lbl = document.getElementById('currentSessionLabel');
            if (lbl) {
                const session = getCurrentSession();
                lbl.textContent = session ? `${session.sessionTitle} (${session.anchor})` : '未选择';
            }
        }
        
        function refreshActiveSessionsFromCloud() {
            try {
                client.db.from('live_sessions').list().then(res => {
                    if (res.success && res.data) {
                        res.data.forEach(s => {
                            if (s.status === 'active' && !activeSessions[s.id]) {
                                // 直接用BaaS的ID作为session.id，确保与订单的sessionId一致
                                activeSessions[s.id] = {
                                    id: s.id,
                                    sessionTitle: s.title || '',
                                    date: s.date || '',
                                    time: s.time || '',
                                    anchor: s.anchor || '',
                                    sessionNumber: s.session_no || 1,
                                    title: `${s.title || ''} | 第${s.session_no || 1}场 | ${s.date || ''} ${s.time || ''} | ${s.anchor || ''}`,
                                    startTime: s.created_at || '',
                                    created_at: s.created_at || '',
                                    currentRound: 1,
                                    currentSkus: {},
                                    titleHistory: [],
                                    titleRoundMap: {},
                                    lastBaseTitle: '',
                                    orders: [],
                                    isActive: true
                                };
                            }
                        });
                        updateSessionSelector();
                        updateActiveSessionsCards();
                    }
                }).catch(() => {});
            } catch(e) {}
        }
        
        const PAGE_TITLES = {
            'home': '首页',
            'order': '订单录入',
            'product': '商品管理',
            'combo': '组合SKU',
            'history': '历史记录',
            'profit': '毛利计算',
            'data': '数据管理'
        };

        function showPage(pageId) {
            document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            
            document.querySelector(`.sidebar-btn[onclick="showPage('${pageId}')"]`)?.classList.add('active');
            document.getElementById(`page-${pageId}`)?.classList.add('active');
            
            const title = PAGE_TITLES[pageId] || pageId;
            document.getElementById('topbarTitle').textContent = title;
            
            if (pageId === 'product') {
                // 先更新校准时间显示，避免updateProductList/updateProductStats异常影响
                if (typeof updateCalibrateTimeDisplay === 'function') {
                    try { updateCalibrateTimeDisplay(); } catch(e) { console.warn('updateCalibrateTimeDisplay error:', e); }
                }
                try { updateProductList(); } catch(e) { console.warn('updateProductList error:', e); }
                try { updateProductStats(); } catch(e) { console.warn('updateProductStats error:', e); }
                // 重置库存筛选为全部
                currentStockFilter = 'all';
                document.querySelectorAll('[id^="filter"]').forEach(btn => btn.classList.remove('active'));
                document.getElementById('filterAll').classList.add('active');
            } else if (pageId === 'combo') {
                updateComboList();
            } else if (pageId === 'history') {
                updateOrderList();
                updateSessionList();
            } else if (pageId === 'profit') {
                loadProfitSessionList();
                setupCustomDateListeners();
                calculateProfit();
            }
        }
        
        function filterProductList() {
            const searchTerm = document.getElementById('productSearchInput').value.toLowerCase();
            let filteredProducts = products.filter(p => 
                p.sku.toLowerCase().includes(searchTerm) || 
                (p.name && p.name.toLowerCase().includes(searchTerm))
            );
            
            // 库存筛选
            if (currentStockFilter === 'normal') {
                filteredProducts = filteredProducts.filter(p => p.stock > 2);
            } else if (currentStockFilter === 'low') {
                filteredProducts = filteredProducts.filter(p => p.stock > 0 && p.stock <= 2);
            } else if (currentStockFilter === 'empty') {
                filteredProducts = filteredProducts.filter(p => p.stock === 0);
            } else if (currentStockFilter === 'noImage') {
                // 无图片筛选
                filteredProducts = filteredProducts.filter(p => !productImagesCache[p.sku] && (!p.image || p.image === ''));
            } else if (currentStockFilter === 'noPrice') {
                // 无价格筛选
                filteredProducts = filteredProducts.filter(p => !p.priceCny && !p.priceUsd);
            } else if (currentStockFilter === 'hasPrice') {
                // 有正常价格筛选
                filteredProducts = filteredProducts.filter(p => p.priceCny > 0 || p.priceUsd > 0);
            }
            
            displayProductList(filteredProducts, 'productListPage');
        }
        
        function updateActiveSessionsCards() {
            const container = document.getElementById('activeSessionCards');
            if (!container) return;
            const active = listActiveSessions();
            if (active.length === 0) {
                container.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.03);border-radius:12px;border:1px dashed rgba(255,255,255,0.1);">暂无活跃场次</div>';
                return;
            }
            container.innerHTML = active.map(s => `
                <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;cursor:pointer;transition:all 0.2s;" 
                     onclick="switchSession(${s.id})"
                     onmouseenter="this.style.borderColor='rgba(102,126,234,0.5)'" 
                     onmouseleave="this.style.borderColor='rgba(255,255,255,0.1)'">
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">
                        <span style="color:#667eea;font-weight:600;">🎬 ${s.sessionTitle}</span>
                        <span style="font-size:12px;color:rgba(255,255,255,0.4);padding:2px 8px;background:rgba(16,185,129,0.2);border-radius:4px;">进行中</span>
                    </div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.7);">
                        <div>🎤 ${s.anchor}</div>
                        <div>🕐 ${s.date || ''} ${s.time || ''}</div>
                        <div style="margin-top:6px;">轮次: ${s.currentRound || 1} | 订单: ${(typeof orders !== 'undefined' ? orders.filter(function(o){ return o.sessionId == s.id; }).length : 0)}</div>
                    </div>
                </div>
            `).join('');
        }
        
        function updateSessionDisplay() {
            const noSession = document.getElementById('noSession');
            const activeSession = document.getElementById('activeSession');
            const session = getCurrentSession();
            
            if (session) {
                noSession.style.display = 'none';
                activeSession.style.display = 'block';
                document.getElementById('sessionTime').textContent = `${session.date} ${session.time}`;
                document.getElementById('sessionAnchor').textContent = session.anchor;
            } else {
                noSession.style.display = 'block';
                activeSession.style.display = 'none';
            }
        }
        
        function changeAnchor() {
            const session = getCurrentSession();
            if (!session) { alert('请先选择场次！'); return; }
            const current = session.anchor || '';
            const newAnchor = prompt(`当前主播：${current}\n\n输入新主播名字（中途换人，后续订单归属新主播）：`, current);
            if (newAnchor && newAnchor.trim() && newAnchor.trim() !== current) {
                session.anchor = newAnchor.trim();
                document.getElementById('sessionAnchor').textContent = session.anchor;
                // 更新场次列表显示
                updateSessionList();
                // 更新订单录入页头顶的场次标签
                const lbl = document.getElementById('currentSessionLabel');
                if (lbl) lbl.textContent = `${session.sessionTitle} (${session.anchor})`;
                // 同步到 BaaS
                if (session.id) {
                    client.db.from('live_sessions').update(session.id, { anchor: session.anchor }).catch(()=>{});
                }
                syncGlobalsToSession();
                saveSessionToLocalStorage();
                showToast(`✅ 主播已切换为 ${session.anchor}`, 'success');
            }
        }
        
        function saveSessionToLocalStorage() {
            syncGlobalsToSession();
        }
        
        function loadSessionFromLocalStorage() {
            const session = getCurrentSession();
            if (session && session.titleHistory) {
                titleHistory = [...session.titleHistory];
            }
            if (session && session.titleRoundMap) {
                titleRoundMap = { ...session.titleRoundMap };
            }
            updateSessionDisplay();
            updateTitleHistorySelect();
        }
        
        function updateCurrentTitle() {
            const baseTitle = document.getElementById('baseTitle').value.trim();
            
            // 如果链接名称改变了
            if (baseTitle !== lastBaseTitle) {
                // 保存上一个链接名称的当前轮次
                if (lastBaseTitle) {
                    titleRoundMap[lastBaseTitle] = currentRound;
                }
                
                // 恢复新链接名称的轮次（如果之前使用过）
                if (baseTitle && titleRoundMap[baseTitle]) {
                    currentRound = titleRoundMap[baseTitle];
                } else if (baseTitle) {
                    // 新链接名称，从第1轮开始
                    currentRound = 1;
                }
                
                lastBaseTitle = baseTitle;
                updateCurrentRoundDisplay();
                updateTitleHistorySelect(); // 更新历史下拉框
                saveSessionData(); // 保存数据
            }
            
            let displayTitle = '-';
            if (baseTitle) {
                displayTitle = `${baseTitle} ${currentRound}#`;
            }
            document.getElementById('currentTitle').textContent = displayTitle;
        }
        
        function updateCurrentRoundDisplay() {
            document.getElementById('currentRoundInput').value = currentRound;
            updateCurrentTitle();
        }
        
        // 保存当前链接名称的轮次
        function saveCurrentTitleRound() {
            const baseTitle = document.getElementById('baseTitle').value.trim();
            if (baseTitle) {
                titleRoundMap[baseTitle] = currentRound;
                lastBaseTitle = baseTitle;
            }
        }
        
        // 保存会话数据
        function saveSessionData() {
            saveCurrentTitleRound();
            
        }
        
        // 添加标题到历史记录
        function addToTitleHistory(title) {
            if (!title || title.trim() === '') return;
            title = title.trim();
            
            // 如果已经存在，移到最前面
            const existingIndex = titleHistory.indexOf(title);
            if (existingIndex !== -1) {
                titleHistory.splice(existingIndex, 1);
            }
            
            titleHistory.unshift(title);
            
            // 只保留最近20个
            if (titleHistory.length > 20) {
                titleHistory = titleHistory.slice(0, 20);
            }
            updateTitleHistorySelect();
        }
        
        // 从历史选择
        function selectFromHistory() {
            const select = document.getElementById('titleHistorySelect');
            const title = select.value;
            if (title) {
                document.getElementById('baseTitle').value = title;
                updateCurrentTitle();
                select.value = ''; // 重置选择
            }
        }
        
        // 更新历史下拉框
        function updateTitleHistorySelect() {
            const select = document.getElementById('titleHistorySelect');
            if (!select) return;
            
            select.innerHTML = '<option value="">历史链接...</option>';
            titleHistory.forEach(title => {
                const option = document.createElement('option');
                option.value = title;
                option.textContent = title;
                if (titleRoundMap[title]) {
                    option.textContent += ` (第 ${titleRoundMap[title]} 轮)`;
                }
                select.appendChild(option);
            });
        }
        
        function openTitleHistoryModal() {
            document.getElementById('titleHistoryModal').style.display = 'flex';
            updateTitleHistoryListDisplay();
        }
        
        function closeTitleHistoryModal() {
            document.getElementById('titleHistoryModal').style.display = 'none';
        }
        
        function updateTitleHistoryListDisplay() {
            const listEl = document.getElementById('titleHistoryList');
            if (titleHistory.length === 0) {
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">暂无历史链接</div>';
                return;
            }
            
            listEl.innerHTML = titleHistory.map((title, index) => `
                <div style="margin:8px 0;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                    <div style="flex:1;">
                        <div style="color:#fff;font-weight:bold;">${title}</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px;">
                            ${titleRoundMap[title] ? `当前轮次：第 ${titleRoundMap[title]} 轮` : '暂无轮次记录'}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:13px;" onclick="selectTitleFromHistory('${title}')">使用</button>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:13px;" onclick="deleteTitleHistory(${index})">删除</button>
                    </div>
                </div>
            `).join('');
        }
        
        function selectTitleFromHistory(title) {
            document.getElementById('baseTitle').value = title;
            updateCurrentTitle();
            closeTitleHistoryModal();
        }
        
        function deleteTitleHistory(index) {
            const title = titleHistory[index];
            if (confirm(`确定要删除历史链接 "${title}" 吗？`)) {
                // 从历史记录中删除
                titleHistory.splice(index, 1);
                // 同时删除对应的轮次记录
                delete titleRoundMap[title];
                // 更新显示
                updateTitleHistorySelect();
                updateTitleHistoryListDisplay();
                saveSessionData();
            }
        }
        
        function clearAllTitleHistory() {
            if (confirm('确定要清空全部历史链接吗？此操作不可恢复！')) {
                titleHistory = [];
                titleRoundMap = {};
                updateTitleHistorySelect();
                updateTitleHistoryListDisplay();
                saveSessionData();
            }
        }
        
        function addNewTitle() {
            const newTitleInput = document.getElementById('newTitleInput');
            const newTitle = newTitleInput.value.trim();
            
            if (!newTitle) {
                alert('请输入竞拍链接名称！');
                return;
            }
            
            // 检查是否已存在
            if (titleHistory.includes(newTitle)) {
                alert('该竞拍链接已存在！');
                return;
            }
            
            // 添加到历史记录
            titleHistory.push(newTitle);
            // 初始化轮次为1
            titleRoundMap[newTitle] = 1;
            
            // 清空输入框
            newTitleInput.value = '';
            
            // 更新显示
            updateTitleHistorySelect();
            updateTitleHistoryListDisplay();
            saveSessionData();
            
            alert('竞拍链接添加成功！');
        }
        
        function jumpToRound() {
            const input = document.getElementById('currentRoundInput');
            const targetRound = parseInt(input.value);
            
            if (isNaN(targetRound) || targetRound < 1) {
                alert('请输入有效的轮次数字！');
                input.value = currentRound;
                return;
            }
            
            const baseTitle = document.getElementById('baseTitle').value.trim();
            
            if (baseTitle && Object.keys(currentSkus).length > 0 && currentRound !== targetRound) {
                const existingOrder = orders.find(o => o.round === currentRound && o.title.startsWith(baseTitle));
                if (existingOrder) {
                    Object.keys(currentSkus).forEach(sku => {
                        const existing = existingOrder.skus.find(item => item.sku === sku);
                        if (existing) {
                            existing.quantity += currentSkus[sku];
                        } else {
                            existingOrder.skus.push({ sku: sku, quantity: currentSkus[sku] });
                        }
                    });
                    existingOrder.timestamp = new Date().toLocaleString('zh-CN');
                } else {
                    const skuItems = Object.keys(currentSkus).map(sku => ({
                        sku: sku,
                        quantity: currentSkus[sku]
                    }));
                    orders.unshift({
                        id: Date.now(),
                        round: currentRound,
                        title: `${baseTitle} ${currentRound}#`,
                        skus: skuItems,
                        timestamp: new Date().toLocaleString('zh-CN'),
                        sessionId: currentSession ? currentSession.id : null,
                        sessionDate: currentSession ? currentSession.date : null,
                        sessionTime: currentSession ? currentSession.time : null,
                        sessionAnchor: currentSession ? currentSession.anchor : null
                    });
                }
                saveToLocalStorage();
                updateOrderList();
            }
            
            currentRound = targetRound;
            saveCurrentTitleRound();
            updateCurrentRoundDisplay();
            clearSkus();
            
            const existingOrder = orders.find(o => o.round === currentRound);
            if (existingOrder) {
                existingOrder.skus.forEach(item => {
                    currentSkus[item.sku] = item.quantity;
                });
                updateSkuList();
            }
            
            document.getElementById('skuInput').focus();
        }
        
        async function nextRound() {
            if (window._nextRoundBusy) { return; }
            window._nextRoundBusy = true;
            try {
                const baseTitle = document.getElementById('baseTitle').value.trim();
                const skuKeys = Object.keys(currentSkus);
                
                if (baseTitle && skuKeys.length > 0) {
                    const existingOrder = orders.find(o => o.round === currentRound && o.title.startsWith(baseTitle));
                    
                    if (existingOrder) {
                        var auctionPrice = parseFloat(document.getElementById('auctionPrice').value) || 0;
                        var orderNote = document.getElementById('orderNote').value.trim();
                        if (auctionPrice > 0) existingOrder.auctionPrice = auctionPrice;
                        if (orderNote) existingOrder.note = orderNote;
                        skuKeys.forEach(function(sku){
                            var existing = existingOrder.skus.find(function(item){ return item.sku === sku; });
                            if (existing) {
                                existing.quantity += currentSkus[sku];
                            } else {
                                existingOrder.skus.push({ sku: sku, quantity: currentSkus[sku] });
                            }
                            var p = products.find(function(x){ return x.sku === sku; });
                            if (p) p.stock -= currentSkus[sku];
                        });
                        existingOrder.timestamp = new Date().toLocaleString('zh-CN');
                        try {
                            await client.db.from('orders').update(existingOrder.id, {
                                skus_json: JSON.stringify({skus: existingOrder.skus || [], auctionPrice: existingOrder.auctionPrice || 0, note: existingOrder.note || ''})
                            });
                        } catch(e) { console.error('☁️ 合并更新失败:', e); }
                        const indicator = document.getElementById('scanIndicator');
                        indicator.innerHTML = `<p style="color:#10b981;">✅ ${existingOrder.title} 已合并保存！</p>`;
                        indicator.classList.add('active');
                        setTimeout(() => {
                            indicator.classList.remove('active');
                            indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
                        }, 2000);
                    } else {
                        var auctionPrice = parseFloat(document.getElementById('auctionPrice').value) || 0;
                        var orderNote = document.getElementById('orderNote').value.trim();
                        var skuItems = skuKeys.map(function(sku){ return { sku: sku, quantity: currentSkus[sku] }; });
                        
                        var order = {
                            id: Date.now(),
                            round: currentRound,
                            title: baseTitle + ' ' + currentRound + '#',
                            skus: skuItems,
                            auctionPrice: auctionPrice,
                            note: orderNote,
                            timestamp: new Date().toLocaleString('zh-CN'),
                            sessionId: currentSession ? currentSession.id : null,
                            sessionDate: currentSession ? currentSession.date : null,
                            sessionTime: currentSession ? currentSession.time : null,
                            sessionAnchor: currentSession ? currentSession.anchor : null
                        };
                        
                        orders.unshift(order);
                        try {
                            var insResult = await client.db.from('orders').insert().values({
                                round: order.round, title: order.title,
                                skus_json: JSON.stringify({skus: order.skus||[], auctionPrice: order.auctionPrice||0, note: order.note||''}),
                                session_id: order.sessionId||0,
                                created_at: new Date().toISOString().slice(0,19).replace('T',' ')
                            });
                            if (insResult && insResult.data && insResult.data.id) {
                                order.id = insResult.data.id;
                            }
                        } catch(e) { console.error('☁️ nextRound保存失败:', e); }
                        skuKeys.forEach(function(sku){
                            var p = products.find(function(x){ return x.sku === sku; });
                            if (p) p.stock -= currentSkus[sku];
                        });
                        const indicator = document.getElementById('scanIndicator');
                        indicator.innerHTML = `<p style="color:#10b981;">✅ ${order.title} 已自动保存！</p>`;
                        indicator.classList.add('active');
                        setTimeout(() => {
                            indicator.classList.remove('active');
                            indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
                        }, 2000);
                    }
                    
                    saveToLocalStorage();
                }
                
                currentRound++;
                saveCurrentTitleRound();
                updateCurrentRoundDisplay();
                clearSkus();
                document.getElementById('auctionPrice').value = '';
                document.getElementById('orderNote').value = '';
                updateOrderList();
                updateRealTimeOrderList();
                if (typeof renderDashboard === 'function') renderDashboard();
                document.getElementById('skuInput').focus();
            } finally {
                window._nextRoundBusy = false;
            }
        }
        
        function prevRound() {
            if (currentRound > 1) {
                const baseTitle = document.getElementById('baseTitle').value.trim();
                if (baseTitle && Object.keys(currentSkus).length > 0) {
                    const existingOrder = orders.find(o => o.round === currentRound && o.title.startsWith(baseTitle));
                    if (existingOrder) {
                        var auctionPrice = parseFloat(document.getElementById('auctionPrice').value) || 0;
                        var orderNote = document.getElementById('orderNote').value.trim();
                        if (auctionPrice > 0) existingOrder.auctionPrice = auctionPrice;
                        if (orderNote) existingOrder.note = orderNote;
                        Object.keys(currentSkus).forEach(function(sku){
                            var existing = existingOrder.skus.find(function(item){ return item.sku === sku; });
                            if (existing) {
                                existing.quantity += currentSkus[sku];
                            } else {
                                existingOrder.skus.push({ sku: sku, quantity: currentSkus[sku] });
                            }
                        });
                        existingOrder.timestamp = new Date().toLocaleString('zh-CN');
                        // 更新 BaaS
                        client.db.from('orders').update(existingOrder.id, {
                            skus_json: JSON.stringify({skus: existingOrder.skus || [], auctionPrice: existingOrder.auctionPrice || 0, note: existingOrder.note || ''})
                        }).then(function(){}, function(e){ console.error('☁️ prevRound合并更新失败:', e); });
                    } else {
                        var auctionPrice2 = parseFloat(document.getElementById('auctionPrice').value) || 0;
                        var orderNote2 = document.getElementById('orderNote').value.trim();
                        var skuItems = Object.keys(currentSkus).map(function(sku){ return { sku: sku, quantity: currentSkus[sku] }; });
                        var oid3 = Date.now();
                        var newOrder = {
                            id: oid3,
                            round: currentRound,
                            title: baseTitle + ' ' + currentRound + '#',
                            skus: skuItems,
                            auctionPrice: auctionPrice2,
                            note: orderNote2,
                            timestamp: new Date().toLocaleString('zh-CN'),
                            sessionId: currentSession ? currentSession.id : null,
                            sessionDate: currentSession ? currentSession.date : null,
                            sessionTime: currentSession ? currentSession.time : null,
                            sessionAnchor: currentSession ? currentSession.anchor : null
                        };
                        orders.unshift(newOrder);
                        client.db.from('orders').insert().values({
                            round: currentRound, title: baseTitle + ' ' + currentRound + '#',
                            skus_json: JSON.stringify({skus: skuItems, auctionPrice: auctionPrice2||0, note: orderNote2||''}),
                            session_id: currentSession ? currentSession.id : 0,
                            created_at: new Date().toISOString().slice(0,19).replace('T',' ')
                        }).then(function(){}, function(e){ console.error('☁️ prevRound保存失败:', e); });
                    }
                    saveToLocalStorage();
                    updateOrderList();
                    updateRealTimeOrderList();
                    if (typeof renderDashboard === 'function') renderDashboard();
                }
                
                currentRound--;
                document.getElementById('auctionPrice').value = '';
                document.getElementById('orderNote').value = '';
                
                const existingOrder = orders.find(o => o.round === currentRound);
                if (existingOrder) {
                    currentSkus = {};
                    existingOrder.skus.forEach(item => {
                        currentSkus[item.sku] = item.quantity;
                    });
                    const restoredTitle = existingOrder.title.replace(/\s+\d+#$/, '');
                    document.getElementById('baseTitle').value = restoredTitle;
                    
                    // 如果恢复的标题与当前不同，需要切换轮次
                    if (restoredTitle !== lastBaseTitle) {
                        if (lastBaseTitle) {
                            titleRoundMap[lastBaseTitle] = currentRound + 1; // 保存上一个的轮次
                        }
                        lastBaseTitle = restoredTitle;
                        // 恢复这个标题的轮次（从订单中找到）
                        titleRoundMap[restoredTitle] = currentRound;
                    }
                } else {
                    clearSkus();
                }
                
                saveCurrentTitleRound();
                updateCurrentRoundDisplay();
                updateSkuList();
                updateCurrentTitle();
                document.getElementById('skuInput').focus();
            }
        }
        
        function resetRound() {
            currentRound = 1;
            saveCurrentTitleRound();
            updateCurrentRoundDisplay();
            clearSkus();
            updateCurrentTitle();
            document.getElementById('skuInput').focus();
        }
