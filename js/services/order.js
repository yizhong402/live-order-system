// order.js

        function updateSkuList() {
            const skuListEl = document.getElementById('skuList');
            const skuKeys = Object.keys(currentSkus);
            const totalCount = Object.values(currentSkus).reduce((sum, count) => sum + count, 0);
            document.getElementById('skuCount').textContent = `${skuKeys.length}种商品 (共${totalCount}件)`;
            
            if (skuKeys.length === 0) {
                skuListEl.innerHTML = '<div style="padding:30px;text-align:center;color:rgba(255,255,255,0.4);">暂无SKU，请扫描商品条码</div>';
                return;
            }
            
            skuListEl.innerHTML = skuKeys.map((sku, index) => {
                const product = products.find(p => p.sku === sku);
                const image = productImagesCache[sku] || (product && (product.image_url || product.image)) || '';
                return `
                <div class="sku-item" style="display:flex;align-items:center;gap:12px;">
                    ${image ? `<img src="${image}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;" alt="${sku}">` : '<div style="width:50px;height:50px;background:rgba(255,255,255,0.1);border-radius:4px;"></div>'}
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span font-size:14px;">[${index + 1}]</span>
                            <span class="sku-code">${sku}</span>
                        </div>
                        ${product ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px;">
                            库存: ${product.stock} | ¥${product.priceCny} / $${product.priceUsd}
                        </div>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div class="quantity-control">
                            <button class="qty-btn" onclick="decreaseQty('${sku}')">-</button>
                            <input type="number" class="qty-input" value="${currentSkus[sku]}" min="1" onchange="updateQty('${sku}', this.value)">
                            <button class="qty-btn" onclick="increaseQty('${sku}')">+</button>
                        </div>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:14px;" onclick="removeSku('${sku}')">删除</button>
                    </div>
                </div>
            `;
            }).join('');
        }
        
        // Toast 通知
        function showToast(msg, type) {
            let toast = document.getElementById('toastMsg');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toastMsg';
                toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 24px;border-radius:8px;font-size:14px;transition:opacity 0.3s;opacity:0;pointer-events:none;';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.background = type === 'warning' ? 'rgba(245,158,11,0.9)' : 'rgba(16,185,129,0.9)';
            toast.style.color = '#fff';
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 3000);
        }

        function increaseQty(sku) {
            currentSkus[sku]++;
            updateSkuList();
        }
        
        function decreaseQty(sku) {
            if (currentSkus[sku] > 1) {
                currentSkus[sku]--;
                updateSkuList();
            }
        }
        
        function updateQty(sku, value) {
            currentSkus[sku] = Math.max(1, parseInt(value) || 1);
            updateSkuList();
        }
        
        function removeSku(sku) {
            delete currentSkus[sku];
            updateSkuList();
        }
        
        function clearSkus() {
            currentSkus = {};
            saveProducts();
            updateSkuList();
        }
        
        let _savingOrder = false;
        function saveOrder() {
            if (_savingOrder) { return; }
            const baseTitle = document.getElementById('baseTitle').value.trim();
            if (!currentSession) {
                alert('请先创建直播场次！');
                return;
            }
            if (!baseTitle) {
                alert('请先输入竞拍链接名称！');
                return;
            }
            const skuKeys = Object.keys(currentSkus);
            if (skuKeys.length === 0) {
                alert('请先扫描至少一个SKU！');
                return;
            }
            
            try {
                _savingOrder = true;
                addToTitleHistory(baseTitle);
                
                const auctionPrice = parseFloat(document.getElementById('auctionPrice').value) || 0;
                const orderNote = document.getElementById('orderNote').value.trim();
                
                const skuItems = skuKeys.map(sku => ({
                    sku: sku,
                    quantity: currentSkus[sku]
                }));
                
                // 超卖警告
                const zeroStockSkus = [];
                for (const sku of skuKeys) {
                    const product = products.find(p => p.sku === sku);
                    if (product && product.stock < 0) {
                        zeroStockSkus.push(sku);
                    }
                }
                if (zeroStockSkus.length > 0) {
                    alert('⚠️ 以下商品已超卖（库存为负数）：\n' + zeroStockSkus.join('、') + '\n\n请确认是否继续保存！');
                }
                
                const order = {
                    id: Date.now(),
                    round: currentRound,
                    title: baseTitle + ' ' + currentRound + '#',
                    skus: skuItems,
                    auctionPrice: auctionPrice,
                    note: orderNote,
                    timestamp: new Date().toLocaleString('zh-CN'),
                    sessionId: currentSession.id,
                    sessionDate: currentSession.date,
                    sessionTime: currentSession.time,
                    sessionAnchor: currentSession.anchor,
                    isOverSold: false
                };
                
                checkOverSold(order);
                orders.unshift(order);
                
                // 异步写 BaaS
                client.db.from('orders').insert().values({
                    round: order.round, title: order.title,
                    skus_json: JSON.stringify({skus: order.skus||[], auctionPrice: order.auctionPrice||0, note: order.note||''}),
                    session_id: order.sessionId||0,
                    created_at: new Date().toISOString().slice(0,19).replace('T',' ')
                }).then(function(r){ if(r && r.data) { order.id = typeof r.data === 'number' ? r.data : (r.data.id || r.data); } }, function(e){ console.error('☁️ 订单保存失败:', e); });
                
                // 虚拟扣库存
                for (const sku of skuKeys) {
                    const product = products.find(p => p.sku === sku);
                    if (product) {
                        product.stock -= currentSkus[sku];
                        _dirtyProducts[sku] = true;
                    }
                }
                
                // 立即刷新 UI（同步操作，不依赖 BaaS）
                updateOrderList();
                updateRealTimeOrderList();
                saveToLocalStorage();
                saveProducts();  // 异步同步库存扣减到BaaS
                if (typeof renderDashboard === 'function') renderDashboard();
                
                // 清空输入
                document.getElementById('auctionPrice').value = '';
                document.getElementById('orderNote').value = '';
                
                // 显示提示
                const indicator = document.getElementById('scanIndicator');
                indicator.innerHTML = '<p style="color:#10b981;">✅ ' + order.title + ' 已保存！</p>';
                indicator.classList.add('active');
                setTimeout(function(){
                    indicator.classList.remove('active');
                    indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
                }, 2000);
                
                currentSkus = {};
                currentRound++;
                updateCurrentRoundDisplay();
                updateSkuList();
                document.getElementById('skuInput').focus();
            } finally {
                _savingOrder = false;
            }
        }
        
        var _filteredOrders = null;
        
        function updateOrderList(filteredOrders = null) {
            const orderListEl = document.getElementById('orderList');
            _filteredOrders = filteredOrders;
            let displayOrders;
            
            if (filteredOrders) {
                displayOrders = filteredOrders;
            } else if (currentSession) {
                // 默认只显示当前场次的订单（活跃场次或历史场次）
                displayOrders = orders.filter(order => order.sessionId === currentSession.id);
            } else {
                // 无当前场次时，提示用户创建或选择场次，不展示全量订单
                orderListEl.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.4);">请先选择或创建直播场次</div>';
                return;
            }
            
            if (displayOrders.length === 0) {
                orderListEl.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.4);">暂无订单记录</div>';
                return;
            }
            
            displayOrders.forEach(order => {
                checkOverSold(order);
            });
            
            orderListEl.innerHTML = displayOrders.map((order, index) => {
                // 始终用 orders.indexOf(order) 确保索引正确（过滤场景下displayOrders是子集）
                const actualIndex = orders.indexOf(order);
                let orderStyle = '';
                let warningBadge = '';
                
                if (order.isOverSold) {
                    orderStyle = 'border: 2px solid #ef4444 !important; background: rgba(239, 68, 68, 0.1) !important;';
                    warningBadge = '<span style="background:#ef4444;color:white;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px;">⚠️ 超卖</span>';
                } else if (order.note) {
                    orderStyle = 'border: 2px solid #f59e0b !important; background: rgba(245, 158, 11, 0.05) !important;';
                    warningBadge = '<span style="background:#f59e0b;color:white;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px;">📝 有备注</span>';
                }
                
                var _t = order.timestamp || '';
                var _tm = _t.length > 10 ? _t.slice(-8).replace(/^0/,'') : _t;
                return `
                <div class="order-item" style="${orderStyle}">
                    <div class="order-header" style="flex-wrap:wrap;gap:6px;">
                        <span style="font-weight:600;font-size:14px;">订单 ${order.round}# ${warningBadge}</span>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0;">
                            <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">💰</span>
                            <input type="number" id="auctionPrice_${actualIndex}" value="${order.auctionPrice || ''}" placeholder="金额" style="width:76px;padding:3px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.2);color:#34d399;font-weight:600;font-size:13px;text-align:right;" onchange="saveQuickAuctionPrice(${actualIndex}, this.value)">
                            <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">${_tm}</span>
                        </div>
                    </div>
                    <div class="order-title" style="margin-top:4px;">
                        <strong>${order.title}</strong> <span style="color:var(--text-muted);font-size:11px;">R${order.round}</span>
                    </div>
                    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                        <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">📝</span>
                        <input type="text" id="note_${actualIndex}" value="${order.note || ''}" placeholder="添加备注..." style="flex:1;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.15);color:#fbbf24;font-size:12px;" onchange="saveQuickNote(${actualIndex}, this.value)">
                    </div>
                    ${order.sessionAnchor ? `
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">
                        🎤 ${order.sessionAnchor} · ${order.sessionDate} ${order.sessionTime}
                    </div>
                    ` : ''}
                    <div class="order-skus" style="max-height:150px;overflow-y:auto;">
                        ${order.skus.map(item => {
                            const product = products.find(p => p.sku === item.sku);
                            const isOverSold = product && product.stock < 0;
                            // 先从商品数据获取图片，再从缓存获取
                            const imageUrl = (product && product.image && product.image !== '') ? product.image : (productImagesCache[item.sku] || null);
                            const imageHtml = imageUrl ? `<img src="${imageUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />` : `<div style="width:40px;height:40px;border-radius:4px;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:16px;color:rgba(255,255,255,0.5);">📷</div>`;
                            return `
                            <div style="display:flex;align-items:center;gap:10px;margin:8px 0;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;${isOverSold ? 'border-left:3px solid #ef4444;' : ''}">
                                ${imageHtml}
                                <div style="flex:1;">
                                    <div style="font-weight:bold;">${item.sku}${isOverSold ? ' ⚠️' : ''}</div>
                                    ${product ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);">¥${product.priceCny} / $${product.priceUsd} | 库存: ${product.stock}</div>` : ''}
                                </div>
                                <div font-weight:bold;">x${item.quantity}</div>
                            </div>
                            `;
                        }).join('')}
                    </div>
                    <!-- 操作按钮：横排一行 -->
                    <div style="display:flex;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04);">
                        <button onclick="copyOrderSkus(${actualIndex})" style="flex:1;padding:6px 4px;border:none;border-radius:6px;background:rgba(129,140,248,0.08);color:#818cf8;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;">📋 复制</button>
                        <button onclick="editOrder(${actualIndex})" style="flex:1;padding:6px 4px;border:none;border-radius:6px;background:rgba(251,191,36,0.08);color:#fbbf24;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;">✏️ 编辑</button>
                        <button onclick="deleteOrder(${actualIndex})" style="flex:1;padding:6px 4px;border:none;border-radius:6px;background:rgba(248,113,113,0.08);color:#f87171;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;">🗑️ 删除</button>
                    </div>
                </div>
            `;
            }).join('');
        }
        
        function saveQuickAuctionPrice(index, value) {
            const price = parseFloat(value) || 0;
            const order = orders[index];
            if (!order) return;
            order.auctionPrice = price;
            saveToLocalStorage();
            // 同步到 BaaS (嵌入skus_json)
            if (order.id) {
                client.db.from('orders').update(order.id, {
                    skus_json: JSON.stringify({skus: order.skus || [], auctionPrice: order.auctionPrice || 0, note: order.note || ''})
                }).then(function(){}, function(e){ console.error('☁️ 快速更新金额失败:', e); });
            }
        }
        
        function saveQuickNote(index, value) {
            const order = orders[index];
            if (!order) return;
            order.note = value.trim();
            saveToLocalStorage();
            updateOrderList();
            // 同步到 BaaS (嵌入skus_json)
            if (order.id) {
                client.db.from('orders').update(order.id, {
                    skus_json: JSON.stringify({skus: order.skus || [], auctionPrice: order.auctionPrice || 0, note: order.note || ''})
                }).then(function(){}, function(e){ console.error('☁️ 快速更新备注失败:', e); });
            }
        }
        
        function checkOverSold(order) {
            let hasOverSold = false;
            order.skus.forEach(item => {
                const product = products.find(p => p.sku === item.sku);
                if (product && product.stock < 0) {
                    hasOverSold = true;
                }
            });
            order.isOverSold = hasOverSold;
        }
        
        function filterOrders() {
            const roundInput = document.getElementById('roundFilter');
            const round = parseInt(roundInput.value);
            
            if (isNaN(round) || round <= 0) {
                updateOrderList();
                return;
            }
            
            // 仅在当前场次范围内按轮次过滤
            const baseOrders = currentSession ? orders.filter(order => order.sessionId === currentSession.id) : [];
            const filtered = baseOrders.filter(order => order.round === round);
            updateOrderList(filtered);
        }
        
        function clearFilter() {
            document.getElementById('anchorFilter').value = '';
            document.getElementById('dateFilter').value = '';
            document.getElementById('filteredSessionList').innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);padding:10px;">请使用上方筛选条件查询场次</div>';
            updateOrderList();
        }
        
        function clearFilter() {
            document.getElementById('sessionSelect').value = '';
            document.getElementById('sessionTitleFilter').value = '';
            document.getElementById('anchorFilter').value = '';
            document.getElementById('dateFilter').value = '';
            currentSession = null;  // 重置当前会话
            displayFilteredSessions(liveHistory);
            updateOrderList();  // 更新订单列表显示当前场次订单
        }
        
        function filterOrdersRealTime() {
            const roundInput = document.getElementById('orderRoundFilter');
            const round = parseInt(roundInput.value);
            
            if (isNaN(round) || round <= 0) {
                updateRealTimeOrderList();
                return;
            }
            
            // 仅在当前场次范围内按轮次过滤
            const baseOrders = currentSession ? orders.filter(order => order.sessionId === currentSession.id) : [];
            const filtered = baseOrders.filter(order => order.round === round);
            updateRealTimeOrderList(filtered);
        }
        
        function clearOrderFilter() {
            document.getElementById('orderRoundFilter').value = '';
            updateRealTimeOrderList();
        }
        
        function updateRealTimeOrderList(filteredOrders) {
            const orderList = document.getElementById('realTimeOrderList');
            let displayOrders = filteredOrders;
            
            if (!displayOrders) {
                if (currentSession) {
                    // 默认只显示当前场次的订单
                    displayOrders = orders.filter(order => order.sessionId === currentSession.id);
                } else {
                    // 无当前场次时，不展示全量订单
                    orderList.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.4);">请先选择或创建直播场次</div>';
                    return;
                }
                // 按保存时间倒序排列（新保存的排最前）
                displayOrders = [...displayOrders].sort((a, b) => (b.id || 0) - (a.id || 0));
            }
            
            if (displayOrders.length === 0) {
                orderList.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">暂无订单记录</div>';
                return;
            }
            
            orderList.innerHTML = displayOrders.map((order, index) => {
                const skuItems = (order.skus || []).map(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const qty = skuItem.quantity || 1;
                    const product = products.find(p => p.sku === sku);
                    // 获取库存数量
                    const stock = product ? parseInt(product.stock || 0) : 0;
                    // 低库存阈值
                    const lowStockThreshold = 5;
                    // 判断库存状态
                    let stockStatus = 'normal'; // normal, low, out
                    let borderColor = 'border-color:#4CAF50'; // 绿色-正常
                    let stockText = `库存: ${stock}`;
                    let stockColor = '#4CAF50';
                    
                    if (stock <= 0) {
                        stockStatus = 'out';
                        borderColor = 'border-color:#ef4444'; // 红色-缺货
                        stockText = `⚠️ 缺货`;
                        stockColor = '#ef4444';
                    } else if (stock <= lowStockThreshold) {
                        stockStatus = 'low';
                        borderColor = 'border-color:#f59e0b'; // 黄色-低库存
                        stockText = `⚠️ 库存: ${stock}`;
                        stockColor = '#f59e0b';
                    }
                    
                    // 先从商品数据获取图片，再从缓存获取
                    const imageUrl = (product && product.image && product.image !== '') ? product.image : (productImagesCache[sku] || null);
                    const imageHtml = imageUrl ? `<img src="${imageUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;margin-right:8px;" />` : `<div style="width:32px;height:32px;border-radius:4px;background:rgba(255,255,255,0.1);margin-right:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:rgba(255,255,255,0.5);">📷</div>`;
                    return `<div style="display:flex;align-items:center;padding:4px 8px;background:rgba(255,255,255,0.05);margin-bottom:2px;border-radius:4px;border:2px solid;border-color:${borderColor.split(':')[1]};">
                        ${imageHtml}
                        <div style="flex:1;overflow:hidden;">
                            <span style="font-size:12px;">${sku} ${product ? `(${product.name})` : ''}</span>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;margin-left:8px;">
                            <span style="color:#4CAF50;font-size:12px;">x${qty}</span>
                            <span style="color:${stockColor};font-size:10px;">${stockText}</span>
                        </div>
                        <button class="btn btn-primary" style="padding:2px 6px;font-size:10px;margin-left:8px;" onclick="copySingleSku('${sku}')">复制SKU</button>
                    </div>`;
                }).join('');
                
                const titleOnly = order.title ? order.title.replace(/\s+\d+#$/, '') : '无标题';
                return `
                    <div class="order-item" style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:12px;border-left:4px solid #667eea;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <div>
                                <span style="font-weight:bold;color:#f093fb;">${titleOnly}</span>
                                <span style="font-weight:bold;color:#4CAF50;margin-left:10px;">第 ${order.round} 轮</span>
                            </div>
                            <div style="display:flex;gap:5px;">
                                <button class="btn btn-success" style="padding:2px 8px;font-size:11px;" onclick="copyOrderSkus(${index})">复制</button>
                                <button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" onclick="deleteOrder(${index})">删除</button>
                            </div>
                        </div>
                        ${skuItems}
                        <div style="margin-top:8px;display:flex;gap:10px;align-items:flex-end;">
                            <div style="flex:1;">
                                <label style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;display:block;">💰 竞拍金额 ($)</label>
                                <input type="number" min="0" step="0.01" value="${order.auctionPrice || ''}" placeholder="输入金额" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#f59e0b;font-size:12px;" onchange="saveOrderAmount(${index}, this.value)">
                            </div>
                            <div style="flex:2;">
                                <label style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:3px;display:block;">📝 备注</label>
                                <input type="text" value="${order.note || ''}" placeholder="输入备注" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:12px;" onchange="saveOrderNote(${index}, this.value)">
                            </div>
                        </div>
                        <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5);">${order.timestamp}</div>
                    </div>
                `;
            }).join('');
        }
        
        function saveOrderAmount(index, value) {
            const order = orders[index];
            if (!order) return;
            
            const amount = parseFloat(value) || 0;
            order.auctionPrice = amount;
            saveToLocalStorage();
            // 同步到 BaaS (嵌入skus_json)
            if (order.id) {
                client.db.from('orders').update(order.id, {
                    skus_json: JSON.stringify({skus: order.skus || [], auctionPrice: order.auctionPrice || 0, note: order.note || ''})
                }).then(function(){}, function(e){ console.error('☁️ 实时订单金额更新失败:', e); });
            }
        }
        
        function saveOrderNote(index, value) {
            const order = orders[index];
            if (!order) return;
            
            order.note = value.trim();
            saveToLocalStorage();
            // 同步到 BaaS (嵌入skus_json)
            if (order.id) {
                client.db.from('orders').update(order.id, {
                    skus_json: JSON.stringify({skus: order.skus || [], auctionPrice: order.auctionPrice || 0, note: order.note || ''})
                }).then(function(){}, function(e){ console.error('☁️ 实时订单备注更新失败:', e); });
            }
        }
        
        function copySingleSku(sku) {
            if (!sku) {
                alert('没有可复制的SKU！');
                return;
            }
            
            const product = products.find(p => p.sku === sku);
            if (!product) {
                alert('该SKU不存在于商品库中！');
                return;
            }
            
            // 添加到当前轮次
            currentSkus[sku] = (currentSkus[sku] || 0) + 1;
            
            updateSkuList();
            updateSkuCount();
            
            const indicator = document.getElementById('scanIndicator');
            indicator.innerHTML = `<p style="color:#10b981;">✅ ${sku} 已添加到当前轮次！</p>`;
            indicator.classList.add('active');
            setTimeout(() => {
                indicator.classList.remove('active');
                indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
            }, 2000);
        }
        
        function copyOrderSkus(orderIndex) {
            const order = orders[orderIndex];
            if (!order || !order.skus) {
                alert('没有可复制的商品！');
                return;
            }
            
            const targetRound = prompt(`将 ${order.title} 的商品复制到哪个轮次？\n\n请输入轮次数字（如：${currentRound + 1}）:`, currentRound + 1);
            
            if (targetRound === null) return;
            
            const targetRoundNum = parseInt(targetRound);
            if (isNaN(targetRoundNum) || targetRoundNum < 1) {
                alert('请输入有效的轮次数字！');
                return;
            }
            
            const baseTitle = order.title.replace(/\s+\d+#$/, '');
            const existingOrder = orders.find(o => o.round === targetRoundNum && o.title.startsWith(baseTitle));
            
            if (existingOrder) {
                order.skus.forEach(item => {
                    const existing = existingOrder.skus.find(e => e.sku === item.sku);
                    if (existing) {
                        existing.quantity += item.quantity;
                    } else {
                        existingOrder.skus.push({ sku: item.sku, quantity: item.quantity });
                    }
                });
                existingOrder.timestamp = new Date().toLocaleString('zh-CN');
            } else {
                orders.unshift({
                    id: Date.now(),
                    round: targetRoundNum,
                    title: `${baseTitle} ${targetRoundNum}#`,
                    skus: order.skus.map(item => ({ sku: item.sku, quantity: item.quantity })),
                    timestamp: new Date().toLocaleString('zh-CN'),
                    sessionId: currentSession ? currentSession.id : null,
                    sessionDate: currentSession ? currentSession.date : null,
                    sessionTime: currentSession ? currentSession.time : null,
                    sessionAnchor: currentSession ? currentSession.anchor : null
                });
            }
            
            saveToLocalStorage();
            
            const roundInput = document.getElementById('currentRoundInput');
            if (roundInput) {
                roundInput.value = targetRoundNum;
            }
            
            currentRound = targetRoundNum;
            currentSkus = {};
            
            updateOrderList();
            updateRealTimeOrderList();
            updateSkuCount();
            
            const indicator = document.getElementById('scanIndicator');
            indicator.innerHTML = `<p style="color:#10b981;">✅ 商品已复制到 ${targetRoundNum}#！</p>`;
            indicator.classList.add('active');
            setTimeout(() => {
                indicator.classList.remove('active');
                indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
            }, 2000);
        }
        
        let editingOrderIndex = -1;
        
        function editOrder(index) {
            editingOrderIndex = index;
            const order = orders[index];
            
            document.getElementById('editRound').value = order.round;
            document.getElementById('editTitle').value = order.title;
            document.getElementById('editAuctionPrice').value = order.auctionPrice || '';
            document.getElementById('editOrderNote').value = order.note || '';
            document.getElementById('editIsOverSold').checked = order.isOverSold || false;
            
            updateEditSkuList(order.skus);
            
            document.getElementById('editOrderModal').style.display = 'flex';
        }
        
        function updateEditSkuList(skus) {
            const listEl = document.getElementById('editSkuList');
            listEl.innerHTML = skus.map((item, index) => `
                <div style="display:flex;align-items:center;gap:10px;margin:5px 0;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;">
                    <span ">[${index + 1}]</span>
                    <span class="sku-code">${item.sku}</span>
                    <div class="quantity-control">
                        <button class="qty-btn" onclick="editDecreaseQty(${index})">-</button>
                        <input type="number" class="qty-input" value="${item.quantity}" min="1" onchange="editUpdateQty(${index}, this.value)">
                        <button class="qty-btn" onclick="editIncreaseQty(${index})">+</button>
                    </div>
                    <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="editRemoveSku(${index})">删除</button>
                </div>
            `).join('');
        }
        
        function addEditSku() {
            const input = document.getElementById('editSkuInput');
            const sku = input.value.trim();
            if (!sku) return;
            
            const order = orders[editingOrderIndex];
            const existing = order.skus.find(item => item.sku === sku);
            
            if (existing) {
                existing.quantity++;
            } else {
                order.skus.push({ sku: sku, quantity: 1 });
            }
            
            updateEditSkuList(order.skus);
            input.value = '';
            input.focus();
        }
        
        function editIncreaseQty(index) {
            orders[editingOrderIndex].skus[index].quantity++;
            updateEditSkuList(orders[editingOrderIndex].skus);
        }
        
        function editDecreaseQty(index) {
            const item = orders[editingOrderIndex].skus[index];
            if (item.quantity > 1) {
                item.quantity--;
                updateEditSkuList(orders[editingOrderIndex].skus);
            }
        }
        
        function editUpdateQty(index, value) {
            const qty = parseInt(value) || 1;
            orders[editingOrderIndex].skus[index].quantity = Math.max(1, qty);
            updateEditSkuList(orders[editingOrderIndex].skus);
        }
        
        function editRemoveSku(index) {
            orders[editingOrderIndex].skus.splice(index, 1);
            updateEditSkuList(orders[editingOrderIndex].skus);
        }
        
        function saveEditOrder() {
            const order = orders[editingOrderIndex];
            order.round = parseInt(document.getElementById('editRound').value) || 1;
            order.title = document.getElementById('editTitle').value.trim();
            order.auctionPrice = parseFloat(document.getElementById('editAuctionPrice').value) || 0;
            order.note = document.getElementById('editOrderNote').value.trim();
            order.isOverSold = document.getElementById('editIsOverSold').checked;
            
            if (!order.title) {
                alert('请输入订单标题！');
                return;
            }
            
            // 同步到 BaaS
            if (order.id) {
                client.db.from('orders').update(order.id, {
                    round: order.round, title: order.title,
                    skus_json: JSON.stringify({skus: order.skus||[], auctionPrice: order.auctionPrice||0, note: order.note||''})
                }).then(function(){}, function(e){ console.error('☁️ 编辑订单保存失败:', e); });
            }
            
            updateOrderList();
            saveToLocalStorage();
            closeEditModal();
        }
        
        function closeEditModal() {
            document.getElementById('editOrderModal').style.display = 'none';
            editingOrderIndex = -1;
        }
        
        function deleteOrder(index) {
            const deleted = orders[index];
            orders.splice(index, 1);
            
            // 同步删除 BaaS
            if (deleted && deleted.id) {
                client.db.from('orders').delete().eq('id', deleted.id).then(function(){}, function(e){ console.error('☁️ 删除订单失败:', e); });
            }
            
            updateOrderList();
            updateRealTimeOrderList();
            saveToLocalStorage();
        }
        
        function clearAllOrders() {
            if (confirm('确定要清空所有订单记录吗？')) {
                orders = [];
                updateOrderList();
                updateRealTimeOrderList();
                saveToLocalStorage();
            }
        }
        
        async function clearAllLiveData() {
            // 强提醒确认
            const confirm1 = confirm('⚠️ 警告！\n\n您即将删除所有直播数据，包括：\n• 所有直播场次记录\n• 所有订单记录\n• 当前进行中的直播\n• 标题历史记录\n\n⚠️ 此操作不可撤销！\n\n但商品信息不会受到影响。\n\n确定继续吗？');
            
            if (!confirm1) return;
            
            // 二次确认
            const confirm2 = confirm('🔴 再次确认！\n\n您确定要删除所有直播数据吗？\n\n• 商品数据将被保留\n• 直播数据将被永久删除\n\n输入 "确认删除" 并点击确定继续：');
            
            if (!confirm2) return;
            
            try {
                // 批量删除 BaaS 数据（同步等待完成）
                var deletePromises = [];
                
                // 删除所有 orders
                var orderIds = orders.map(function(o) { return o.id; }).filter(Boolean);
                orderIds.forEach(function(id) {
                    deletePromises.push(
                        client.db.from('orders').delete().eq('id', id).catch(function(e){
                            console.error('☁️ 删除订单 ' + id + ' 失败:', e);
                        })
                    );
                });
                
                // 删除所有 live_sessions
                var sessionIds = (liveHistory || []).map(function(s) {
                    var sData = s.session || s;
                    return sData.id;
                }).filter(Boolean);
                sessionIds.forEach(function(id) {
                    deletePromises.push(
                        client.db.from('live_sessions').delete().eq('id', id).catch(function(e){
                            console.error('☁️ 删除场次 ' + id + ' 失败:', e);
                        })
                    );
                });
                
                // 删除 activeSessions 中未存到 liveHistory 的
                var activeIds = Object.keys(activeSessions || {}).filter(function(id) {
                    return id && !sessionIds.includes(parseInt(id));
                });
                activeIds.forEach(function(id) {
                    deletePromises.push(
                        client.db.from('live_sessions').delete().eq('id', parseInt(id)).catch(function(e){
                            console.error('☁️ 删除活跃场次 ' + id + ' 失败:', e);
                        })
                    );
                });
                
                // 删除 title_history
                deletePromises.push(
                    client.db.from('title_history').delete().neq('id', 0).catch(function(e){
                        console.error('☁️ 删除标题历史失败:', e);
                    })
                );
                
                // 删除 title_round_map
                deletePromises.push(
                    client.db.from('title_round_map').delete().neq('id', 0).catch(function(e){
                        console.error('☁️ 删除标题轮次映射失败:', e);
                    })
                );
                
                // 等待所有删除完成
                await Promise.all(deletePromises);
                console.log('☁️ BaaS 数据全部删除完成');
            } catch(e) {
                console.error('☁️ 删除 BaaS 数据时出错:', e);
            }
            
            // 清空内存数据
            orders = [];
            liveHistory = [];
            currentSession = null;
            currentRound = 1;
            currentSkus = {};
            titleHistory = [];
            titleRoundMap = {};
            
            // 清空 activeSessions 使下拉框不再展示
            if (typeof activeSessions === 'object') {
                Object.keys(activeSessions).forEach(function(k) { delete activeSessions[k]; });
            }
            
            // 更新显示
            updateOrderList();
            updateSessionList();
            updateSessionDisplay();
            updateCurrentRoundDisplay();
            updateSkuList();
            updateRealTimeOrderList();
            updateSessionSelector();
            
            // 更新首页统计
            if (typeof renderDashboard === 'function') {
                renderDashboard();
            }
            
            // 更新筛选后的场次列表
            const filteredSessionListEl = document.getElementById('filteredSessionList');
            if (filteredSessionListEl) {
                filteredSessionListEl.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);padding:10px;">请使用上方筛选条件查询场次</div>';
            }
            
            // 保存到存储
            saveToLocalStorage();
            
            alert('✅ 所有直播数据已成功删除！\n\n商品信息已保留。');
        }
        
        function exportOrders() {
            // 获取当前显示的订单（考虑当前场次过滤）
            let exportOrdersList = orders;
            if (currentSession) {
                // 判断是旧格式还是新格式
                if (currentSession.session && currentSession.orders && currentSession.orders.length > 0) {
                    // 旧格式：订单保存在场次对象内部的orders数组
                    exportOrdersList = currentSession.orders;
                } else if (currentSession.id) {
                    // 新格式：订单保存在全局orders数组，通过sessionId关联
                    exportOrdersList = orders.filter(order => order.sessionId == currentSession.id);
                    // 如果全局orders为空（已结束的场次，数据在liveHistory中），从liveHistory回退查找
                    if (exportOrdersList.length === 0) {
                        const historyEntry = liveHistory.find(function(h) {
                            var s = h.session || h;
                            return s.id == currentSession.id;
                        });
                        if (historyEntry && historyEntry.orders && historyEntry.orders.length > 0) {
                            exportOrdersList = historyEntry.orders;
                        }
                    }
                }
            }
            
            if (exportOrdersList.length === 0) {
                alert('没有订单可导出！');
                return;
            }
            
            // 按轮次升序排序
            exportOrdersList = [...exportOrdersList].sort((a, b) => {
                const ra = parseInt(a.round) || 0;
                const rb = parseInt(b.round) || 0;
                return ra - rb;
            });
            
            let csv = '序号,轮次,标题,商品种类,SKU,数量,竞拍金额,备注,主播,直播日期,直播时间,时间,状态\n';
            exportOrdersList.forEach((order, index) => {
                order.skus.forEach((skuItem, skuIndex) => {
                    const orderNum = exportOrdersList.length - index;
                    const totalSkus = order.skus.length;
                    const status = order.isOverSold ? '超卖' : (order.note ? '有备注' : '正常');
                                        // 主播名：优先从当前场次取，否则从订单的 sessionAnchor 取
                    var anchorName = '';
                    if (currentSession && currentSession.anchor) {
                        anchorName = currentSession.anchor;
                    } else if (order.sessionAnchor) {
                        anchorName = order.sessionAnchor;
                    }
                    csv += `${orderNum},${order.round},${order.title},${totalSkus},${skuItem.sku},${skuItem.quantity},${order.auctionPrice || ''},"${order.note || ''}",${anchorName},${order.sessionDate || ''},${order.sessionTime || ''},${order.timestamp},${status}\n`;
                });
            });
            
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const filename = currentSession 
                ? `orders_${currentSession.anchor}_${currentSession.date}.csv`
                : `orders_${new Date().toISOString().slice(0,10)}.csv`;
            link.download = filename;
            link.click();
        }
        
        function addSku() {
            const skuInput = document.getElementById('skuInput');
            const sku = skuInput.value.trim().toUpperCase();
            if (!sku) return;
            
            const combo = comboSkus.find(c => c.code === sku);
            if (combo) {
                applyCombo(sku);
                skuInput.value = '';
                skuInput.focus();
                return;
            }
            
            const product = products.find(p => p.sku === sku);
            if (!product) {
                const confirmAdd = confirm(`⚠️ SKU ${sku} 不存在于商品库中！\n\n是否强制录入该SKU？`);
                if (!confirmAdd) {
                    skuInput.value = '';
                    skuInput.focus();
                    return;
                }
            } else if (product.stock <= 0) {
                const confirmAdd = confirm(`🚨 SKU ${sku} 已售罄！\n\n是否继续强制添加？`);
                if (!confirmAdd) {
                    skuInput.value = '';
                    skuInput.focus();
                    return;
                }
            }
            
            if (currentSkus[sku]) {
                currentSkus[sku]++;
            } else {
                currentSkus[sku] = 1;
            }
            
            updateSkuList();
            skuInput.value = '';
            skuInput.focus();
            
            const indicator = document.getElementById('scanIndicator');
            let stockStatus = '';
            if (product && product.stock < 3 && product.stock > 0) {
                stockStatus = ` (剩余${product.stock}件，即将售罄)`;
            }
            indicator.innerHTML = `<p style="color:#10b981;">✅ ${sku} 已添加${stockStatus}</p>`;
            indicator.classList.add('active');
            
            if (product && product.stock < 3 && product.stock > 0) {
                setTimeout(() => {
                    alert(`⚠️ ${sku} 即将售罄！剩余库存: ${product.stock}`);
                }, 300);
            }
            
            setTimeout(() => {
                indicator.classList.remove('active');
                indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
            }, 2000);
        }
