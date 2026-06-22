// app.js

        async function saveToLocalStorage() { /* 云端自动保存 */ }
        
        async function loadFromLocalStorage() {
            try {
                const oRes = await client.db.from('orders').list();
                if (oRes.success) orders = oRes.data || [];
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
                client.db.from('products').delete().neq('id', 0).catch(()=>{}),
                client.db.from('orders').delete().neq('id', 0).catch(()=>{}),
                client.db.from('combo_skus').delete().neq('id', 0).catch(()=>{}),
                client.db.from('live_sessions').delete().neq('id', 0).catch(()=>{}),
                client.db.from('title_history').delete().neq('id', 0).catch(()=>{}),
                client.db.from('title_round_map').delete().neq('id', 0).catch(()=>{})
            ]).then(() => {
                products = []; orders = []; comboSkus = []; productImagesCache = {};
                // 纯云端: 无需清理
                alert('✅ 初始化完成！页面将自动刷新...');
                location.reload();
            });
        }
        
        async function saveProducts() { updateProductListDisplay(); }
        
        async function saveOrders() { /* 云端自动保存 */ }
        
        async function loadProducts() {
            try {
                const res = await client.db.from('products').list();
                if (res.success) products = (res.data || []).map(p => ({
                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                    priceCny: p.price_cny || 0, priceUsd: p.price_usd || 0,
                    originalStock: p.original_stock || p.stock || 0, image: p.image_url || ''
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
        
        async function saveLiveHistory() { /* 云端自动保存 */ }
        
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
            
            // 加载系统设置
            try {
                await loadSettings();
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
            if (document.getElementById('page-home')?.classList.contains('active')) {
                setTimeout(renderDashboard, 200);
            }
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
                await client.db.from('products').delete().neq('id', 0).catch(()=>{});
                await client.db.from('orders').delete().neq('id', 0).catch(()=>{});
                await client.db.from('combo_skus').delete().neq('id', 0).catch(()=>{});
                await client.db.from('live_sessions').delete().neq('id', 0).catch(()=>{});
                
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
                            const imgUrl = await uploadImageBase64(image); if (imgUrl) { products[products.length-1].image = imgUrl; await client.db.from("products").insert().values({ sku, name, stock, price_cny: priceCny, price_usd: priceUsd, image_url: imgUrl, original_stock: stock }); } else { await client.db.from("products").insert().values({ sku, name, stock, price_cny: priceCny, price_usd: priceUsd, image_url: "", original_stock: stock }); }
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
            }
        };


        // ====== 数据看板 ======
        let dashChartInstance = null;

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
            
            const today = new Date().toISOString().substring(0, 10);
            const todayOrders = orders.filter(o => o.timestamp && o.timestamp.substring(0, 10) === today).length;
            document.getElementById('dashTodayOrders').textContent = todayOrders;
            
            const totalSessions = (liveHistory && liveHistory.length) || 0;
            document.getElementById('dashTotalSessions').textContent = totalSessions;
            
            const activeCount = Object.keys(activeSessions || {}).length;
            document.getElementById('dashActiveSessions').textContent = activeCount;
            
            // GMV
            const totalGMV = orders.reduce((s, o) => s + (parseFloat(o.auctionPrice) || 0), 0);
            document.getElementById('dashTotalGMV').textContent = '$' + totalGMV.toFixed(2);
            const todayGMV = orders.filter(o => o.timestamp && o.timestamp.substring(0, 10) === today)
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
            
            // 库存概览
            renderStockOverview();
            
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
                <div style="padding:12px;margin-bottom:6px;background:rgba(255,255,255,0.05);border-radius:8px;border-left:3px solid #4CAF50;">
                    <div style="font-weight:500;color:#fff;font-size:13px;">${s.title || '未命名场次'}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                        🎤 ${s.anchor || '未知'} | 🕐 ${s.time || ''} | 📦 ${s.selectedOrders ? s.selectedOrders.length : 0} 单
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
                        <span style="color:var(--text-muted);font-size:10px;margin-left:6px;">${o.timestamp ? o.timestamp.substring(5, 16) : ''}</span>
                    </div>
                </div>
            `).join('');
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
            
            orders.forEach(o => {
                if (!o.timestamp) return;
                const day = o.timestamp.substring(0, 10);
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
        };
