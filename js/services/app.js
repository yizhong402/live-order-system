// app.js

        async function saveToLocalStorage() { /* 云端自动保存 */ }
        
        async function loadFromLocalStorage() {
            try {
                const oRes = await client.db.from('orders').list();
                if (oRes.success) {
                    orders = (oRes.data || []).map(function(o){ return {
                        id: o.id,
                        round: o.round,
                        title: o.title,
                        skus: (function(){ try { var j = JSON.parse(o.skus_json||'[]'); return Array.isArray(j) ? j : (j.skus||[]); } catch(e){ return []; } })(),
                        auctionPrice: (function(){ try { var j = JSON.parse(o.skus_json||'{}'); return Array.isArray(j) ? 0 : (j.auctionPrice||0); } catch(e){ return 0; } })(),
                        note: (function(){ try { var j = JSON.parse(o.skus_json||'{}'); return Array.isArray(j) ? '' : (j.note||''); } catch(e){ return ''; } })(),
                        sessionId: o.session_id || null,
                        sessionDate: o.session_date || '',
                        sessionTime: o.session_time || '',
                        sessionAnchor: (function(){ try { var j = JSON.parse(o.skus_json||'{}'); return Array.isArray(j) ? '' : (j.sessionAnchor||''); } catch(e){ return ''; } })(),
                        timestamp: o.created_at ? o.created_at.replace('T',' ').substring(0,19) : new Date().toLocaleString('zh-CN'),
                        isOverSold: (function(){ try { var j = JSON.parse(o.skus_json||'{}'); return Array.isArray(j) ? false : !!j.isOverSold; } catch(e){ return false; } })()
                    };});
                }
                const hRes = await client.db.from('live_sessions').list().order('created_at', 'desc');
                if (hRes.success) liveHistory = hRes.data || [];
            } catch(e) { orders = []; liveHistory = []; }
        }
        
        document.getElementById('skuInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                addSku();
            }
        });
        
        function initializeApp() {
            if (!confirm('⚠️ 确定要清空所有云端数据吗？此操作不可恢复！')) return;
            const pw = prompt('请输入初始化密码（4位数字）：');
            if (pw !== '1987') { alert('❌ 密码错误！'); return; }
            if (!confirm('🔴 最终确认：所有数据将被永久删除！')) return;
            
            // 清空云端数据
            Promise.all([
                client.db.from('products').delete().neq('id', 0).then(null, ()=>{}),
                client.db.from('orders').delete().neq('id', 0).then(null, ()=>{}),
                client.db.from('combo_skus').delete().neq('id', 0).then(null, ()=>{}),
                client.db.from('live_sessions').delete().neq('id', 0).then(null, ()=>{}),
                client.db.from('title_history').delete().neq('id', 0).then(null, ()=>{}),
                client.db.from('title_round_map').delete().neq('id', 0).then(null, ()=>{})
            ]).then(() => {
                products = []; orders = []; comboSkus = []; productImagesCache = {};
                // 纯云端: 无需清理
                alert('✅ 初始化完成！页面将自动刷新...');
                location.reload();
            });
        }
        
        function saveProducts() {
            updateProductListDisplay();
            // 异步同步dirty商品到BaaS
            var skus = Object.keys(window._dirtyProducts || {});
            if (skus.length === 0) return;
            skus.forEach(function(sku) {
                var p = products.find(function(x) { return x.sku === sku; });
                if (!p || !p.baasId) {
                    // 新建商品（无baasId）: 用save创建
                    if (p && !p.baasId) {
                        client.db.from('products').save({
                            sku: p.sku, name: p.name || '', stock: p.stock || 0,
                            price_cny: Math.round((p.priceCny || 0) * 100),
                            price_usd: Math.round((p.priceUsd || 0) * 100),
                            image_url: p.image || '', original_stock: p.originalStock || p.stock || 0
                        }).then(function(r) {
                            if (r && r.id) p.baasId = r.id;
                        }, function(e){});
                    }
                    return;
                }
                client.db.from('products').update(p.baasId, {
                    stock: p.stock,
                    price_cny: Math.round((p.priceCny || 0) * 100),
                    price_usd: Math.round((p.priceUsd || 0) * 100),
                    original_stock: p.originalStock || p.stock || 0
                }).catch(function(e) { console.error('☁️ 商品保存失败:', sku, e); });
            });
            window._dirtyProducts = {};
        }
        
        async function saveOrders() { /* 云端自动保存 */ }
        
        async function loadProducts() {
            try {
                const res = await client.db.from('products').list();
                if (res.success) products = (res.data || []).map(p => ({
                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                    priceCny: Number(p.price_cny) / 100 || 0, priceUsd: Number(p.price_usd) / 100 || 0,
                    originalStock: p.original_stock || p.stock || 0, image: p.image_url || '', image_url: p.image_url || ''
                }));
            } catch(e) { products = []; }
        }
        
        function endLive() {
            if (!currentSession) {
                alert('没有进行中的直播！');
                return;
            }
            
            let warnings = [];
            let overSoldOrders = orders.filter(o => o.isOverSold);
            let ordersWithNotes = orders.filter(o => o.note);
            
            if (currentRound > 1) {
                const savedRounds = orders.map(o => o.round);
                const missingRounds = [];
                for (let i = 1; i <= currentRound; i++) {
                    if (!savedRounds.includes(i)) {
                        missingRounds.push(i);
                    }
                }
                if (missingRounds.length > 0) {
                    warnings.push(`⚠️ 轮次 ${missingRounds.join(', ')} 未录入订单！`);
                }
            }
            
            if (overSoldOrders.length > 0) {
                warnings.push(`⚠️ 有 ${overSoldOrders.length} 个订单存在超卖情况（红色标记）`);
            }
            
            if (ordersWithNotes.length > 0) {
                warnings.push(`📝 有 ${ordersWithNotes.length} 个订单有备注信息（黄色标记）`);
            }
            
            let confirmMsg = '确定要结束当前直播吗？\n\n所有订单数据将被保存。';
            if (warnings.length > 0) {
                confirmMsg = warnings.join('\n') + '\n\n确认结束直播？';
            }
            
            if (!confirm(confirmMsg)) {
                return;
            }
            
            const liveData = {
                session: currentSession,
                orders: [...orders],
                finalInventory: products.map(p => ({
                    sku: p.sku,
                    originalStock: p.originalStock,
                    finalStock: p.stock,
                    sold: p.originalStock - p.stock
                })),
                endTime: new Date().toLocaleString('zh-CN'),
                totalOrders: orders.length,
                totalSkus: orders.reduce((sum, o) => sum + o.skus.reduce((s, item) => s + item.quantity, 0), 0)
            };
            
            liveHistory.push(liveData);
            saveLiveHistory();
            
            let resultMsg = `🎉 直播已结束！\n\n订单总数: ${liveData.totalOrders}\n商品总销量: ${liveData.totalSkus}`;
            if (overSoldOrders.length > 0) {
                resultMsg += `\n⚠️ 超卖订单: ${overSoldOrders.length} 个`;
            }
            if (ordersWithNotes.length > 0) {
                resultMsg += `\n📝 有备注订单: ${ordersWithNotes.length} 个`;
            }
            resultMsg += '\n\n数据已保存到历史记录。';
            
            alert(resultMsg);
            
            currentSession = null;
            currentRound = 1;
            currentSkus = {};
            orders = [];
            titleRoundMap = {};  // 清空标题轮次映射
            lastBaseTitle = '';
            
            document.getElementById('noSession').style.display = 'block';
            document.getElementById('activeSession').style.display = 'none';
            document.getElementById('baseTitle').value = '';
            
            // 清除保存的标题轮次映射
            // 纯云端: 内存数据已重置
            
            updateCurrentRoundDisplay();
            updateSkuList();
            updateOrderList();
            saveToLocalStorage();
            
            document.getElementById('skuInput').focus();
        }
        
        function saveLiveHistory() {
            // 异步同步liveHistory到BaaS（全量刷新）
            client.db.from('live_sessions').list().then(function(r) {
                if (!r.success || !r.data) return;
                // 构建云端记录的复合索引: title+date+anchor → id
                var cloudIndex = {}; // 'title|date|anchor' => [BaaS ids]
                var cloudById = {};  // BaaS id => record
                r.data.forEach(function(s) {
                    cloudById[s.id] = s;
                    var key = (s.title||'') + '|' + (s.date||'') + '|' + (s.anchor||'');
                    if (!cloudIndex[key]) cloudIndex[key] = [];
                    cloudIndex[key].push(s.id);
                });
                
                // 更新/插入每个场次
                (liveHistory || []).forEach(function(h) {
                    var session = h.session || h;
                    var title = session.title || session.sessionTitle || '';
                    var anchor = session.anchor || '';
                    var date = session.date || '';
                    var time = session.time || '00:00';
                    var endTime = h.endTime || session.endTime || '';
                    
                    var curAnchor = session.currentAnchor || '';
                    var data = {
                        title: title,
                        anchor: anchor,
                        current_anchor: curAnchor,
                        date: date,
                        time: time,
                        session_no: session.sessionNumber || 1,
                        status: 'ended',
                        total_rounds: h.totalRounds || session.totalRounds || 0,
                        end_time: endTime
                    };
                    
                    // 优先用 session.id 匹配云端
                    if (session.id && cloudById[session.id]) {
                        client.db.from('live_sessions').update(session.id, data).catch(function(e){});
                        return;
                    }
                    
                    // 用复合键匹配（title+date+anchor）
                    var matchKey = title + '|' + date + '|' + anchor;
                    var matched = matchKey && cloudIndex[matchKey];
                    if (matched && matched.length > 0) {
                        var cid = matched[0];
                        session.id = cid;
                        client.db.from('live_sessions').update(cid, data).catch(function(e){});
                        return;
                    }
                    
                    // 完全没匹配到，才INSERT新记录
                    client.db.from('live_sessions').insert().values(data).then(function(res){
                        if (res && res.data) session.id = res.data.id || res.data;
                    }, function(e){});
                });
                // 删除云端中已不在本地的场次（仅删除完全匹配的）
                r.data.forEach(function(s) {
                    var stillExists = (liveHistory || []).some(function(h) {
                        return (h.session || h).id == s.id;
                    });
                    if (!stillExists) {
                        client.db.from('live_sessions').delete().eq('id', s.id).then(function(){}, function(e){});
                    }
                });
            }).catch(function(e){});
        }
        
        async function loadLiveHistory() {
            try {
                const res = await client.db.from('live_sessions').list().order('created_at', 'desc');
                if (res.success) liveHistory = res.data || [];
            } catch(e) { liveHistory = []; }
        }
        
        // 加载进度（空函数，兼容旧调用）
        function updateLoadingProgress(status, progress) {}
        
        async function initApp() {
            // 一次性从云端加载所有数据（migrateFromLocalStorage会调用云端API）
            try {
                await migrateFromLocalStorage();
            } catch (error) {
                console.error('☁️ 云端加载失败:', error);
                products = [];
                orders = [];
                comboSkus = [];
                liveHistory = [];
                productImagesCache = {};
            }
            
            console.log('☁️ 加载完成: 商品 ' + products.length + ', 订单 ' + orders.length + ', 组合 ' + comboSkus.length + ', 直播 ' + liveHistory.length);
            
            // 从云端恢复活跃场次
            if (typeof refreshActiveSessionsFromCloud === 'function') {
                refreshActiveSessionsFromCloud();
            }
            
            // 加载系统设置
            try {
                await loadSettings();
                // OMS 同步初始化（如已启用则自动启动定时器）
                if (typeof initOMSSyncOnLoad === 'function') {
                    initOMSSyncOnLoad();
                }
            } catch (e) {
                console.warn('⚙️ 设置加载失败:', e.message);
            }
            
            updateProductStats();
            updateProductList();
            updateLastImportTime();
            updateCurrentTitle();
            updateCurrentRoundDisplay();
            updateSkuList();
            updateProductListDisplay();
            updateComboListDisplay();
            updateRealTimeOrderList();
            updateTitleHistorySelect();
            
            // 首页渲染看板
            setTimeout(function(){ renderDashboard(); }, 200);
        }
        
        // 更新数据统计
        function updateDataStats() {
            const statsEl = document.getElementById('dataStats');
            if (!statsEl) return;
            
            const productCount = products.length;
            const orderCount = orders.length;
            const comboCount = comboSkus.length;
            const liveHistoryCount = liveHistory.length;
            const titleHistoryCount = titleHistory.length;
            
            // 计算图片数量和大小
            const imageCount = Object.keys(productImagesCache).length;
            let totalImageSize = 0;
            for (const key in productImagesCache) {
                if (productImagesCache[key]) {
                    totalImageSize += productImagesCache[key].length;
                }
            }
            const imageSizeMB = (totalImageSize / 1024 / 1024).toFixed(2);
            
            statsEl.innerHTML = `
                <ul style="list-style:none;padding:0;">
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">📦 商品数量: <strong>${productCount}</strong></li>
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">📝 订单数量: <strong>${orderCount}</strong></li>
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">🔗 组合数量: <strong>${comboCount}</strong></li>
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">🎬 直播历史: <strong>${liveHistoryCount}</strong></li>
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">🔗 链接历史: <strong>${titleHistoryCount}</strong></li>
                    <li style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">🖼️ 图片数量: <strong>${imageCount}</strong></li>
                    <li style="padding:8px 0;">📊 图片大小: <strong>${imageSizeMB} MB</strong></li>
                </ul>
            `;
        }
        
        // 导出所有数据
        async function exportAllData() {
            try {
                // 先询问用户是否需要导出图片
                const exportImages = confirm('📷 是否需要导出商品图片？\n\n✅ 是：完整备份（文件大）\n❌ 否：仅导出数据（文件小，导入后重新上传图片）');
                
                const imageData = exportImages ? productImagesCache : {};
                
                const allData = {
                    exportTime: new Date().toLocaleString('zh-CN'),
                    version: '2.0',
                    products: products,
                    productImagesCache: imageData,
                    orders: orders,
                    comboSkus: comboSkus,
                    liveHistory: liveHistory,
                    titleHistory: titleHistory,
                    titleRoundMap: titleRoundMap,
                    lastBaseTitle: lastBaseTitle,
                    currentRound: currentRound
                };
                
                // 使用无格式的JSON，避免大数据问题
                const jsonStr = JSON.stringify(allData);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                
                // 显示文件大小
                const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
                console.log(`📦 导出文件大小: ${sizeMB} MB`);
                
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `walmart-auction-data-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert(`✅ 数据导出成功！\n\n文件大小: ${sizeMB} MB\n${exportImages ? '（包含图片）' : '（不含图片）'}`);
            } catch (e) {
                console.error('导出失败:', e);
                alert('❌ 导出失败: ' + e.message + '\n\n建议：选择不导出图片重试');
            }
        }
        
        // 导入数据
        async function importAllData(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            if (!confirm('⚠️ 导入数据将覆盖当前所有数据，确定要继续吗？')) {
                event.target.value = '';
                return;
            }
            
            try {
                console.log('📥 开始导入文件...');
                const text = await file.text();
                console.log('📥 文件读取完成，解析中...');
                const data = JSON.parse(text);
                
                // 验证数据格式
                if (!data.products || !Array.isArray(data.products)) {
                    throw new Error('无效的数据格式');
                }
                
                console.log('📥 数据验证通过，清空现有数据...');
                // 清空云端数据
                await client.db.from('products').delete().neq('id', 0).then(null, ()=>{});
                await client.db.from('orders').delete().neq('id', 0).then(null, ()=>{});
                await client.db.from('combo_skus').delete().neq('id', 0).then(null, ()=>{});
                await client.db.from('live_sessions').delete().neq('id', 0).then(null, ()=>{});
                
                // 恢复数据
                products = data.products || [];
                productImagesCache = data.productImagesCache || {};
                orders = data.orders || [];
                comboSkus = data.comboSkus || [];
                liveHistory = data.liveHistory || [];
                titleHistory = data.titleHistory || [];
                titleRoundMap = data.titleRoundMap || {};
                lastBaseTitle = data.lastBaseTitle || '';
                currentRound = data.currentRound || 1;
                
                console.log(`📥 开始保存 ${products.length} 个商品...`);
                await saveProducts();
                
                const imageCount = Object.keys(productImagesCache).length;
                if (imageCount > 0) {
                    console.log(`📥 开始保存 ${imageCount} 张图片...`);
                    let savedCount = 0;
                    for (const [sku, image] of Object.entries(productImagesCache)) {
                        try {
                            const imgUrl = await uploadImageBase64(image); if (imgUrl) { products[products.length-1].image = imgUrl; await client.db.from("products").insert().values({ sku, name, stock, price_cny: Math.round(priceCny * 100), price_usd: Math.round(priceUsd * 100), image_url: imgUrl, original_stock: stock }); } else { await client.db.from("products").insert().values({ sku, name, stock, price_cny: Math.round(priceCny * 100), price_usd: Math.round(priceUsd * 100), image_url: "", original_stock: stock }); }
                            savedCount++;
                            if (savedCount % 10 === 0) {
                                console.log(`📥 已保存 ${savedCount}/${imageCount} 张图片`);
                            }
                        } catch (e) {
                            console.error(`保存图片失败 ${sku}:`, e);
                        }
                    }
                }
                
                console.log(`📥 开始保存 ${orders.length} 个订单...`);
                await saveOrders();
                
                console.log(`📥 开始保存 ${comboSkus.length} 个组合...`);
                saveCombos();
                
                console.log(`📥 开始保存 ${liveHistory.length} 条直播记录...`);
                await saveLiveHistory();
                
                // 刷新页面显示
                updateProductList();
                updateProductListDisplay();
                updateSkuList();
                updateRealTimeOrderList();
                updateComboListDisplay();
                updateTitleHistorySelect();
                updateCurrentTitle();
                updateCurrentRoundDisplay();
                updateDataStats();
                
                event.target.value = '';
                console.log('✅ 数据导入完成！');
                alert('✅ 数据导入成功！请刷新页面以完全加载数据');
                
            } catch (e) {
                console.error('❌ 导入失败:', e);
                event.target.value = '';
                alert('❌ 导入失败: ' + e.message + '\n\n请按F12打开控制台查看详细错误');
            }
        }
        
        // 页面切换时更新数据统计 - 包装原 showPage
        const originalShowPage = showPage;
        showPage = function(pageId) {
            originalShowPage(pageId);
            if (pageId === 'data') {
                updateDataStats();
                if (typeof renderBackupList === 'function') {
                    setTimeout(renderBackupList, 100);
                }
            }
            if (pageId === 'product') {
                if (typeof updateCalibrateTimeDisplay === 'function') {
                    setTimeout(updateCalibrateTimeDisplay, 100);
                }
            }
            if (pageId === 'order') {
                if (typeof initExportAnchorFilter === 'function') {
                    setTimeout(initExportAnchorFilter, 100);
                }
            }
        };


        // ====== 数据看板 ======
        let dashChartInstance = null;

        // ===== 库存快照 =====
        let _stockSnapshotsCache = null;

        async function loadStockSnapshots() {
            if (_stockSnapshotsCache) return _stockSnapshotsCache;
            try {
                const resp = await fetch('data/stock-snapshots.json');
                if (!resp.ok) return null;
                _stockSnapshotsCache = await resp.json();
                return _stockSnapshotsCache;
            } catch(e) {
                console.error('快照加载失败:', e);
                return null;
            }
        }

        function renderHotProducts() {
            const container = document.getElementById('dashStockOverview');
            if (!container) return;

            loadStockSnapshots().then(snapshots => {
                if (!snapshots) {
                    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:12px;">⏳ 快照数据准备中，明天08:00后查看</div>';
                    return;
                }

                const dates = Object.keys(snapshots).sort();
                if (dates.length < 2) {
                    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:12px;">📸 已有 <strong>' + dates[0] + '</strong> 快照<br>明天08:00后出热销对比结果</div>';
                    return;
                }

                const prevDate = dates[dates.length - 2];
                const currDate = dates[dates.length - 1];
                const prevSnap = snapshots[prevDate] || {};
                const currSnap = snapshots[currDate] || {};

                // 计算每个SKU的库存变动
                const changes = [];
                for (const sku in prevSnap) {
                    const prevStock = prevSnap[sku] || 0;
                    const currStock = currSnap[sku];
                    if (currStock === undefined) continue;
                    const diff = prevStock - currStock;
                    // 只取正数（库存减少=热销）
                    if (diff > 0) {
                        changes.push({ sku: sku, prevStock: prevStock, currStock: currStock, diff: diff });
                    }
                }

                // 按变动量从大到小排序，取前20
                changes.sort((a, b) => b.diff - a.diff);
                const top = changes.slice(0, 20);

                if (top.length === 0) {
                    container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px;">暂无热销品</div>';
                    return;
                }

                container.innerHTML = top.map(function(item) {
                    const product = (typeof products !== 'undefined' ? products.find(function(p) { return p.sku === item.sku; }) : null);
                    const name = product ? product.name : '';
                    const imgUrl = product ? (product.image || product.image_url || '') : '';
                    const pct = item.prevStock > 0 ? Math.round(item.diff / item.prevStock * 100) : 100;
                    const barColor = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#22c55e';

                    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
                        + '<div style="width:40px;height:40px;flex-shrink:0;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.05);">'
                        + (imgUrl ? '<img src="' + imgUrl + '" style="width:40px;height:40px;object-fit:cover;" onerror="this.style.display=\'none\'">' : '')
                        + '</div>'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="font-size:12px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.sku + '</div>'
                        + (name ? '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>' : '')
                        + '<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px;">'
                        + '<span style="color:' + barColor + ';">📉 昨日减 <strong>' + item.diff + '</strong> 件</span>'
                        + '<span style="color:var(--text-muted);">' + pct + '%</span>'
                        + '</div>'
                        + '<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;margin-top:3px;">'
                        + '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:2px;"></div>'
                        + '</div>'
                        + '</div>'
                        + '</div>';
                }).join('') + '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding-top:6px;">共 ' + top.length + ' 款热销品</div>';
            }).catch(function() {
                container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px;">加载失败</div>';
            });
        }

        function renderDashboard() {
            if (!products) { setTimeout(renderDashboard, 500); return; }
            
            // 更新统计卡片
            document.getElementById('dashTotalProducts').textContent = products.length || 0;
            const noImage = products.filter(p => !p.image && !productImagesCache[p.sku]).length;
            const noPrice = products.filter(p => !p.price_cny && !p.price_usd).length;
            document.getElementById('dashNoImage').textContent = noImage;
            document.getElementById('dashNoPrice').textContent = noPrice;
            
            const totalOrders = orders.length || 0;
            document.getElementById('dashTotalOrders').textContent = totalOrders;
            
            const todayDate = new Date();
            const todayStr = todayDate.toISOString().substring(0, 10); // 2026-06-24
            // 兼容两种 timestamp 格式: ISO日期开头 或 本地日期开头(2026/6/24)
            function isToday(timestamp) {
                if (!timestamp) return false;
                // 标准化日期: 统一转为 YYYY-MM-DD 格式
                var norm = timestamp.replace(/\//g, '-');
                var parts = norm.substring(0, 10).split('-');
                if (parts.length === 3) {
                    var y = parts[0], m = String(parseInt(parts[1])).padStart(2,'0'), d = String(parseInt(parts[2])).padStart(2,'0');
                    return (y + '-' + m + '-' + d) === todayStr;
                }
                return norm.substring(0, 10) === todayStr;
            }
            const todayOrders = orders.filter(o => isToday(o.timestamp)).length;
            document.getElementById('dashTodayOrders').textContent = todayOrders;
            
            const totalSessions = (liveHistory && liveHistory.length) || 0;
            document.getElementById('dashTotalSessions').textContent = totalSessions;
            
            const activeCount = Object.keys(activeSessions || {}).length;
            document.getElementById('dashActiveSessions').textContent = activeCount;
            
            // GMV
            const totalGMV = orders.reduce((s, o) => s + (parseFloat(o.auctionPrice) || 0), 0);
            document.getElementById('dashTotalGMV').textContent = '$' + totalGMV.toFixed(2);
            const todayGMV = orders.filter(o => isToday(o.timestamp))
                .reduce((s, o) => s + (parseFloat(o.auctionPrice) || 0), 0);
            document.getElementById('dashTodayGMV').textContent = '$' + todayGMV.toFixed(2);
            
            // 库存预警
            const lowStockProducts = products.filter(p => p.stock !== undefined && p.stock <= 5 && p.stock > 0);
            const zeroStockProducts = products.filter(p => p.stock === 0 || p.stock === '0');
            const warningBar = document.getElementById('stockWarningBar');
            const warningText = document.getElementById('stockWarningText');
            if (lowStockProducts.length > 0 || zeroStockProducts.length > 0) {
                warningBar.style.display = 'block';
                warningText.textContent = `${lowStockProducts.length} 个SKU库存不足 (≤5)，${zeroStockProducts.length} 个SKU已售罄`;
            } else {
                warningBar.style.display = 'none';
            }
            
            // 活跃场次卡片
            renderActiveSessionCards();
            
            // 最近订单
            renderRecentOrders();
            
            // 热销品 Top 20
            renderHotProducts();
            
            // 图表
            renderDashboardCharts();
        }

        function refreshDashboard() {
            renderDashboard();
        }

        function renderActiveSessionCards() {
            const container = document.getElementById('activeSessionCards');
            if (!container) return;
            
            const entries = Object.entries(activeSessions || {});
            if (entries.length === 0) {
                container.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.4);font-size:13px;">暂无活跃场次</div>';
                return;
            }
            
            container.innerHTML = entries.map(([id, s]) => `
                <div style="padding:12px;margin-bottom:6px;background:rgba(255,255,255,0.05);border-radius:8px;border-left:3px solid #4CAF50;overflow:hidden;">
                    <div style="font-weight:500;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title || '未命名场次'}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;flex-wrap:wrap;gap:2px 8px;word-break:break-all;">
                        <span>🎤 ${s.anchor || '未知'}</span>
                        <span>🕐 ${s.time || ''}</span>
                        <span>📦 ${(typeof orders !== 'undefined' ? orders.filter(function(o){ return o.sessionId == s.id; }).length : 0)}单</span>
                    </div>
                </div>
            `).join('');
        }

        function renderRecentOrders() {
            const container = document.getElementById('dashRecentOrders');
            if (!container) return;
            
            if (!orders || orders.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px;">暂无订单</div>';
                return;
            }
            
            const recent = [...orders].reverse().slice(0, 10);
            container.innerHTML = recent.map(o => `
                <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
                    <div style="color:#fff;">${o.title || '未命名'} <span style="color:var(--text-muted);font-size:11px;">${o.round ? 'R' + o.round : ''}</span></div>
                    <div>
                        <span style="color:#FFD700;">$${(parseFloat(o.auctionPrice) || 0).toFixed(2)}</span>
                        <span style="color:var(--text-muted);font-size:10px;margin-left:6px;">${o.timestamp ? (o.timestamp.indexOf('/')>0 ? o.timestamp.substring(5, 10) + ' ' + o.timestamp.substring(11, 16) : o.timestamp.substring(5, 16)) : ''}</span>
                    </div>
                </div>
            `).join('');
        }

        // ===== 商品管理：新上架产品渲染 =====
        // 初始化新上架产品的日期筛选下拉
        function initNewProductFilters() {
            const filterSelect = document.getElementById('newProductDateFilter');
            const sortSelect = document.getElementById('newProductSort');
            if (!filterSelect || filterSelect.options.length > 0) return;

            loadStockSnapshots().then(function(snapshots) {
                if (!snapshots) return;
                const dates = Object.keys(snapshots).sort();
                if (dates.length < 2) return;

                // 只填充一次，默认选最新日期
                filterSelect.innerHTML = dates.map(function(d) {
                    return '<option value="' + d + '">' + d + '</option>';
                }).join('');
                filterSelect.value = dates[dates.length - 1];
                filterSelect.onchange = function() { renderNewProducts(); };
                if (sortSelect) sortSelect.onchange = function() { renderNewProducts(); };

                // 首次自动渲染
                renderNewProducts();
            });
        }

        function renderNewProducts() {
            const container = document.getElementById('newProductList');
            const filterSelect = document.getElementById('newProductDateFilter');
            const sortSelect = document.getElementById('newProductSort');
            if (!container) return;

            // 如果还没初始化（下拉为空），先初始化
            if (filterSelect && filterSelect.options.length === 0) {
                initNewProductFilters();
                return;
            }

            loadStockSnapshots().then(function(snapshots) {
                if (!snapshots) {
                    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px;font-size:13px;">暂无快照数据</div>';
                    return;
                }

                const dates = Object.keys(snapshots).sort();
                if (dates.length < 2) {
                    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px;font-size:13px;">需要两份快照才能对比新上架产品</div>';
                    return;
                }

                const selectedDate = filterSelect ? filterSelect.value : dates[dates.length - 1];
                const selectedIdx = dates.indexOf(selectedDate);
                if (selectedIdx < 1) {
                    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px;font-size:13px;">选择日期后查看新上架产品</div>';
                    return;
                }

                const currSnap = snapshots[selectedDate] || {};
                const prevSnap = snapshots[dates[selectedIdx - 1]] || {};

                // 新上架 = 前一天无此SKU或库存=0，当天>0
                const newProducts = [];
                for (const sku in currSnap) {
                    const currStock = currSnap[sku] || 0;
                    if (currStock <= 0) continue;
                    const prevStock = prevSnap[sku];
                    if (prevStock === undefined || prevStock <= 0) {
                        newProducts.push({ sku: sku, stock: currStock });
                    }
                }

                // 排序（按库存数量）
                const sortOrder = sortSelect ? sortSelect.value : 'desc';
                if (sortOrder === 'desc') {
                    newProducts.sort(function(a, b) { return b.stock - a.stock; });
                } else {
                    newProducts.sort(function(a, b) { return a.stock - b.stock; });
                }

                if (newProducts.length === 0) {
                    container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:32px;font-size:13px;">该日期暂无新上架产品</div>';
                    return;
                }

                container.innerHTML = newProducts.map(function(item) {
                    const product = (typeof products !== 'undefined' ? products.find(function(p) { return p.sku === item.sku; }) : null);
                    const name = product ? product.name : '';
                    const imgUrl = product ? (product.image || product.image_url || '') : '';
                    const priceCny = product ? (product.priceCny || 0) : 0;
                    const priceUsd = product ? (product.priceUsd || 0) : 0;

                    return '<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">'
                        + '<div style="width:48px;height:48px;flex-shrink:0;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.05);">'
                        + (imgUrl ? '<img src="' + imgUrl + '" style="width:48px;height:48px;object-fit:cover;" onerror="this.style.display=\'none\'">' : '<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:20px;">📦</div>')
                        + '</div>'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.sku + '</div>'
                        + (name ? '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>' : '')
                        + '</div>'
                        + '<div style="text-align:right;flex-shrink:0;">'
                        + '<div style="font-size:13px;color:#22c55e;font-weight:500;">库存: ' + item.stock + '</div>'
                        + '<div style="font-size:11px;color:var(--text-muted);">¥' + priceCny.toFixed(2) + ' / $' + priceUsd.toFixed(2) + '</div>'
                        + '</div>'
                        + '</div>';
                }).join('') + '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding-top:8px;">共 ' + newProducts.length + ' 款新上架产品</div>';
            });
        }

        function renderStockOverview() {
            const container = document.getElementById('dashStockOverview');
            if (!container) return;
            
            if (!products || products.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px;">暂无数据</div>';
                return;
            }
            
            const byStock = [...products].filter(p => p.stock !== undefined).sort((a, b) => a.stock - b.stock).slice(0, 10);
            if (byStock.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:16px;">暂无库存数据</div>';
                return;
            }
            
            container.innerHTML = byStock.map(p => {
                const barWidth = Math.min(100, Math.max(3, (p.stock / 100) * 100));
                const barColor = p.stock <= 3 ? '#ef4444' : p.stock <= 10 ? '#f59e0b' : '#4CAF50';
                return `
                <div style="margin-bottom:6px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
                        <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${p.sku}</span>
                        <span style="color:${barColor};font-weight:500;">${p.stock}</span>
                    </div>
                    <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${barWidth}%;background:${barColor};border-radius:2px;transition:width 0.3s;"></div>
                    </div>
                </div>
            `}).join('');
        }

        function renderDashboardCharts() {
            const canvas = document.getElementById('dashTrendChart');
            if (!canvas) return;
            
            const period = document.getElementById('dashPeriod')?.value || 'today';
            
            // 确定日期范围
            const now = new Date();
            let startDate;
            if (period === 'today') {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            } else if (period === '7d') {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 6);
                startDate.setHours(0, 0, 0, 0);
            } else {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 29);
                startDate.setHours(0, 0, 0, 0);
            }
            
            // 按日聚合
            const dayMap = {};
            let cursor = new Date(startDate);
            const endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            
            while (cursor <= endDate) {
                const key = cursor.toISOString().substring(0, 10);
                dayMap[key] = { gmv: 0, count: 0, profit: 0 };
                cursor.setDate(cursor.getDate() + 1);
            }
            
            function normDate(ts) {
                if (!ts) return '';
                var norm = ts.replace(/\//g, '-').substring(0, 10);
                var parts = norm.split('-');
                if (parts.length === 3) {
                    return parts[0] + '-' + String(parseInt(parts[1])).padStart(2,'0') + '-' + String(parseInt(parts[2])).padStart(2,'0');
                }
                return norm;
            }
            orders.forEach(o => {
                if (!o.timestamp) return;
                const day = normDate(o.timestamp);
                if (dayMap[day]) {
                    dayMap[day].gmv += parseFloat(o.auctionPrice) || 0;
                    dayMap[day].count += 1;
                    // Basic profit estimate
                    (o.skus || []).forEach(si => {
                        const sku = si.sku || si;
                        const qty = si.quantity || 1;
                        const prod = products.find(p => p.sku === sku);
                        if (prod && prod.price_usd) {
                            dayMap[day].profit -= parseFloat(prod.price_usd) * qty;
                        }
                    });
                }
            });
            
            const sortedDays = Object.keys(dayMap).sort();
            const labels = sortedDays.map(d => {
                if (period === 'today') return d.substring(5);
                return d.substring(5);
            });
            const gmvData = sortedDays.map(d => Math.round(dayMap[d].gmv * 100) / 100);
            const countData = sortedDays.map(d => dayMap[d].count);
            
            if (dashChartInstance) dashChartInstance.destroy();
            
            if (typeof Chart === 'undefined') {
                console.log('Chart.js not loaded yet');
                return;
            }
            
            dashChartInstance = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'GMV ($)',
                            data: gmvData,
                            backgroundColor: 'rgba(255,215,0,0.6)',
                            borderColor: '#FFD700',
                            borderWidth: 1,
                            borderRadius: 3,
                            yAxisID: 'y'
                        },
                        {
                            label: '订单数',
                            data: countData,
                            backgroundColor: 'rgba(102,126,234,0.6)',
                            borderColor: '#667eea',
                            borderWidth: 1,
                            borderRadius: 3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { color: '#fff', font: { size: 10 }, boxWidth: 12, padding: 8 }
                        },
                        tooltip: {
                            callbacks: {
                                afterLabel: function(ctx) {
                                    const day = sortedDays[ctx.dataIndex];
                                    const d = dayMap[day];
                                    return `毛利: $${(d.gmv * 0.9 + d.profit).toFixed(2)} (估算)`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 9 }, maxRotation: period === 'today' ? 0 : 45 }
                        },
                        y: {
                            type: 'linear', display: true, position: 'left',
                            ticks: { color: '#FFD700', font: { size: 9 } },
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            title: { display: true, text: 'GMV ($)', color: '#FFD700', font: { size: 10 } }
                        },
                        y1: {
                            type: 'linear', display: true, position: 'right',
                            ticks: { color: '#667eea', font: { size: 9 } },
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: '订单数', color: '#667eea', font: { size: 10 } }
                        }
                    }
                }
            });
        }

        // 钩子：首页显示时渲染看板
        const dashOriginalShowPage = showPage;
        showPage = function(pageId) {
            dashOriginalShowPage(pageId);
            if (pageId === 'home') {
                setTimeout(renderDashboard, 100);
            } else if (pageId === 'data') {
                updateDataStats();
            } else if (pageId === 'settings') {
                setTimeout(renderSettingsPage, 100);
            }
            if (pageId === 'product') {
                if (typeof updateCalibrateTimeDisplay === 'function') {
                    setTimeout(updateCalibrateTimeDisplay, 100);
                }
                if (typeof initNewProductFilters === 'function') {
                    setTimeout(initNewProductFilters, 200);
                }
            }
        };
