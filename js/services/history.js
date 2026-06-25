// history.js

        function filterSessions() {
            const sessionSelect = document.getElementById('sessionSelect').value;
            const sessionTitleFilter = document.getElementById('sessionTitleFilter').value.toLowerCase();
            const anchorFilter = document.getElementById('anchorFilter').value.toLowerCase();
            const dateFilter = document.getElementById('dateFilter').value;
            
            let filteredSessions = [...(liveHistory || [])];
            
            // 按场次选择筛选
            if (sessionSelect) {
                filteredSessions = filteredSessions.filter(session => {
                    const sessionId = (session.session || session).id;
                    return sessionId == sessionSelect;
                });
            }
            
            // 按直播标题筛选
            if (sessionTitleFilter) {
                filteredSessions = filteredSessions.filter(session => {
                    const title = ((session.session || session).sessionTitle || '').toLowerCase();
                    return title.includes(sessionTitleFilter);
                });
            }
            
            // 按主播名字筛选
            if (anchorFilter) {
                filteredSessions = filteredSessions.filter(session => {
                    const anchor = ((session.session || session).anchor || '').toLowerCase();
                    return anchor.includes(anchorFilter);
                });
            }
            
            // 按日期筛选
            if (dateFilter) {
                filteredSessions = filteredSessions.filter(session => {
                    const sessionDate = (session.session || session).date;
                    return sessionDate === dateFilter;
                });
            }
            
            // 显示筛选后的场次列表
            displayFilteredSessions(filteredSessions);
        }
        
        function selectSessionFromDropdown() {
            filterSessions();
        }
        
        function displayFilteredSessions(filteredSessions) {
            const filteredSessionListEl = document.getElementById('filteredSessionList');
            
            if (!filteredSessionListEl) return;
            
            if (!filteredSessions || filteredSessions.length === 0) {
                filteredSessionListEl.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);padding:10px;">未找到匹配的场次</div>';
                return;
            }
            
            filteredSessionListEl.innerHTML = filteredSessions.map((session, index) => {
                const sessionData = session.session || session;
                const sessionId = sessionData.id;
                const sessionTitle = sessionData.title || sessionData.date || `场次 ${index + 1}`;
                const sessionAnchor = sessionData.anchor || '未知主播';
                const sessionStartTime = sessionData.startTime || sessionData.createdAt || '未知时间';
                const sessionEndTime = sessionData.endTime || '进行中';
                // 计算该场次的有效订单和实际轮次数
                const sessionOrders = session.orders && session.orders.length > 0 
                    ? session.orders 
                    : orders.filter(o => o.sessionId == sessionId);
                // 实际轮次数：取该场次所有订单的 round 去重
                var actualRounds = 0;
                if (sessionOrders.length > 0) {
                    var roundSet = new Set();
                    sessionOrders.forEach(function(o) { roundSet.add(o.round); });
                    actualRounds = roundSet.size;
                }
                
                const totalSkus = sessionOrders.reduce((acc, o) => {
                    const skuList = o.skus || [];
                    return acc + skuList.reduce((sum, skuItem) => {
                        return sum + (skuItem.quantity || (typeof skuItem === 'object' ? 1 : 0));
                    }, 0);
                }, 0);
                
                return `
                    <div style="padding:10px;margin-bottom:8px;background:rgba(76, 175, 80, 0.1);border:1px solid rgba(76, 175, 80, 0.3);border-radius:6px;cursor:pointer;" onclick="viewSessionOrders('${sessionId}')">
                        <div style="font-weight:bold;color:#4CAF50;">${sessionTitle}</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">
                            <span style="color:#FF9800;">🎤 ${sessionAnchor}</span><br>
                            🕐 ${sessionStartTime} - ${sessionEndTime}<br>
                            📊 ${actualRounds} 轮 | 📦 ${sessionOrders.length} 订单 | 🛒 ${totalSkus} SKU
                        </div>
                        <div style="margin-top:8px;color:#10b981;font-size:12px;text-align:right;">点击查看订单 →</div>
                    </div>
                `;
            }).join('');
        }
        
        function applyFilters() {
            // 保留此函数以兼容旧代码
        }
        
        function filterBySession() {
            // 保留此函数以兼容旧代码
        }
        
        async function endCurrentSession() {
            if (!currentSession) {
                alert('没有正在进行的直播场次');
                return;
            }
            
            if (confirm(`确定要结束当前场次吗？\n\n场次：${currentSession.title || '未命名'}\n开始时间：${currentSession.startTime}\n当前轮次：${currentRound}`)) {
                currentSession.endTime = new Date().toLocaleString('zh-CN');
                currentSession.totalRounds = currentRound;
                
                // 将当前场次的历史链接和轮次保存到场次数据中
                currentSession.titleHistory = [...titleHistory];
                currentSession.titleRoundMap = { ...titleRoundMap };
                
                console.log('结束场次数据:', currentSession);
                console.log('主播:', currentSession.anchor);
                console.log('轮次:', currentRound);
                console.log('历史链接:', titleHistory);
                
                if (!liveHistory) {
                    liveHistory = [];
                }
                liveHistory.push({ ...currentSession }); client.db.from("live_sessions").insert().values({ session_no: currentSession.sessionNo||"", title: currentSession.title||"", date: currentSession.date||"", time: currentSession.time||"", anchor: currentSession.anchor||"", platform: currentSession.platform||"", status: "ended" }).catch(e=>{});
                
                await saveToLocalStorage();
                
                console.log('保存场次数据:', currentSession);
                console.log('liveHistory:', liveHistory);
                
                // 重置当前场次和历史链接
                currentSession = null;
                currentRound = 1;
                currentSkus = {};
                titleHistory = [];
                titleRoundMap = {};
                lastBaseTitle = '';
                
                // 清空输入框
                document.getElementById('baseTitle').value = '';

                // 纯云端: 仅重置前端状态
                
                updateSessionDisplay();
                updateSessionList();
                updateCurrentRoundDisplay();
                updateSkuList();
                updateTitleHistorySelect();
                
                alert('场次已结束并保存到历史记录');
            }
        }
        
        function updateSessionList() {
            const sessionListEl = document.getElementById('sessionList');
            const sessionFilter = document.getElementById('sessionFilter');
            const sessionSelect = document.getElementById('sessionSelect');
            
            if (!sessionListEl) return;
            
            console.log('liveHistory:', liveHistory);
            
            if (!liveHistory || liveHistory.length === 0) {
                sessionListEl.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);padding:10px;">暂无历史场次</div>';
                return;
            }
            
            sessionListEl.innerHTML = liveHistory.map((session, index) => {
                console.log(`场次${index}:`, session);
                
                // 兼容旧的数据结构
                const sessionData = session.session || session;
                const sessionId = sessionData.id;
                const sessionTitle = sessionData.title || sessionData.date || `场次 ${index + 1}`;
                const sessionAnchor = sessionData.anchor || '未知主播';
                const sessionStartTime = sessionData.startTime || sessionData.createdAt || '未知时间';
                const sessionEndTime = sessionData.endTime || '进行中';
                // 获取场次订单：先从场次内部的orders数组获取（旧格式），如果没有则从全局orders数组获取（新格式）
                const internalOrders = session.orders || [];
                const globalOrders = orders.filter(o => o.sessionId === sessionId);
                const sessionOrders = internalOrders.length > 0 ? internalOrders : globalOrders;
                
                // 实际轮次数：取该场次所有订单的 round 去重
                var actualRounds = 0;
                if (sessionOrders.length > 0) {
                    var roundSet = new Set();
                    sessionOrders.forEach(function(o) { roundSet.add(o.round); });
                    actualRounds = roundSet.size;
                }
                
                const totalSkus = sessionOrders.reduce((acc, o) => {
                    // 兼容两种订单格式
                    const skuList = o.skus || [];
                    return acc + skuList.reduce((sum, skuItem) => {
                        return sum + (skuItem.quantity || (typeof skuItem === 'object' ? 1 : 0));
                    }, 0);
                }, 0);
                
                return `
                    <div style="padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.05);border-radius:6px;">
                        <div style="font-weight:bold;color:#4CAF50;">${sessionTitle}</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">
                            <span style="color:#FF9800;">🎤 ${sessionAnchor}</span><br>
                            🕐 ${sessionStartTime} - ${sessionEndTime}<br>
                            📊 ${actualRounds} 轮 | 📦 ${sessionOrders.length} 订单 | 🛒 ${totalSkus} SKU
                        </div>
                        <div style="display:flex;gap:6px;margin-top:8px;">
                        <button class="btn btn-primary" style="padding:2px 8px;font-size:11px;" onclick="viewSessionOrders('${sessionId}')">查看订单</button>
                        <button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" onclick="deleteSessionHistory('' + sessionId + ')">删除</button>
                    </div>
                `;
            }).join('');
            
            // 更新下拉选择框
            if (sessionFilter) {
                sessionFilter.innerHTML = '<option value="" style="background:#2a2a2a;color:white;">选择场次</option>' + 
                    liveHistory.map((session, index) => {
                        const sessionData = session.session || session;
                        return `<option value="${sessionData.id}" style="background:#2a2a2a;color:white;">${sessionData.title || `场次 ${index + 1}`} - ${sessionData.startTime}</option>`;
                    }).join('');
            }
            
            // 更新历史记录页面的场次选择下拉框
            if (sessionSelect) {
                sessionSelect.innerHTML = '<option value="">全部场次</option>' + 
                    liveHistory.map((session, index) => {
                        const sessionData = session.session || session;
                        const displayTitle = `${sessionData.sessionTitle || '未知标题'} | 第${sessionData.sessionNumber || (index + 1)}场 | ${sessionData.date} ${sessionData.time || '00:00'} | ${sessionData.anchor || '未知主播'}`;
                        return `<option value="${sessionData.id}">${displayTitle}</option>`;
                    }).join('');
            }
        }
        
        function viewSessionOrders(sessionId) {
            const session = liveHistory.find(s => (s.session || s).id == sessionId);
            
            if (session) {
                currentSession = session.session || session;
                if (typeof currentSession.id === 'string') currentSession.id = parseInt(currentSession.id) || currentSession.id;
                
                // 旧格式：订单嵌入在session对象中，传到updateOrderList
                if (session.orders && session.orders.length > 0) {
                    updateOrderList(session.orders);
                    return;
                }
            }
            
            // 新格式：订单在全局orders数组，按sessionId过滤
            updateOrderList();
        }
        
        // 获取时间范围（使用自定义日期选择）

        // 删除单条历史场次
        function deleteSessionHistory(sessionId) {
            if (!confirm('确定要删除该场次记录吗？此操作不可恢复。')) return;
            
            const targetId = String(sessionId);
            const idx = liveHistory.findIndex(function(s) {
                var sData = s.session || s;
                return String(sData.id) === targetId;
            });
            
            if (idx === -1) {
                alert('未找到该场次记录');
                return;
            }
            
            // 同步删除 BaaS 中的场次记录
            client.db.from('live_sessions').delete(parseInt(targetId)).catch(function(e){});
            // 同时删除该场次关联的订单
            orders.filter(function(o) { return String(o.sessionId) === targetId; }).forEach(function(o) {
                if (o.id) client.db.from('orders').delete(o.id).catch(function(e){});
            });
            // 内存删除
            orders = orders.filter(function(o) { return String(o.sessionId) !== targetId; });
            
            liveHistory.splice(idx, 1);
            saveLiveHistory();
            updateSessionList();
            updateOrderList();
            updateRealTimeOrderList();
            if (typeof updateDataStats === 'function') updateDataStats();
            console.log('已删除场次:', targetId);
        }
