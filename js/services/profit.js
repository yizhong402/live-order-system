// profit.js

        function getTimeRange() {
            const now = new Date();
            let startDate, endDate;
            
            const customStartDate = document.getElementById('customStartDate').value;
            const customEndDate = document.getElementById('customEndDate').value;
            
            if (customStartDate) {
                startDate = new Date(customStartDate);
            } else {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }
            
            if (customEndDate) {
                endDate = new Date(customEndDate);
                endDate.setDate(endDate.getDate() + 1); // 包含结束日期
            } else {
                endDate = new Date(now);
                endDate.setDate(endDate.getDate() + 1);
            }
            
            return { startDate, endDate };
        }
        
        // 格式化日期
        function formatDate(date) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        }
        
        // 加载毛利计算页面的场次列表
        function loadProfitSessionList() {
            const selectEl = document.getElementById('profitSessionSelect');
            if (!selectEl) return;
            
            // 清空现有选项
            selectEl.innerHTML = '<option value="">全部场次汇总</option>';
            
            if (!liveHistory || liveHistory.length === 0) {
                return;
            }
            
            // 添加场次选项
            liveHistory.forEach((session, index) => {
                const sessionData = session.session || session;
                const sessionId = sessionData.id;
                const sessionTitle = sessionData.title || sessionData.sessionTitle || `场次 ${index + 1}`;
                const sessionDate = sessionData.date || sessionData.startTime || '';
                
                const option = document.createElement('option');
                option.value = sessionId;
                option.textContent = `${sessionTitle} | ${sessionDate}`;
                selectEl.appendChild(option);
            });
        }
        
        // 获取时间范围显示文本
        function getTimeRangeText() {
            const customStartDate = document.getElementById('customStartDate').value;
            const customEndDate = document.getElementById('customEndDate').value;
            
            if (customStartDate && customEndDate) {
                return `${customStartDate} ~ ${customEndDate}`;
            } else if (customStartDate) {
                return `${customStartDate} ~ 至今`;
            } else if (customEndDate) {
                return `开始 ~ ${customEndDate}`;
            } else {
                const now = new Date();
                return `${now.getFullYear()}年${now.getMonth() + 1}月`;
            }
        }
        
        // 添加自定义日期变化监听
        function setupCustomDateListeners() {
            const startDateInput = document.getElementById('customStartDate');
            const endDateInput = document.getElementById('customEndDate');
            
            if (startDateInput) {
                startDateInput.addEventListener('change', calculateProfit);
            }
            if (endDateInput) {
                endDateInput.addEventListener('change', calculateProfit);
            }
        }
        
        // 获取未设置采购价的SKU列表
        function getMissingPriceSkus(orderList) {
            const missingPriceSkus = new Set();
            
            orderList.forEach(order => {
                (order.skus || []).forEach(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const product = products.find(p => p.sku === sku);
                    
                    if (!product || (!product.priceCny && !product.priceUsd)) {
                        missingPriceSkus.add(sku);
                    }
                });
            });
            
            return Array.from(missingPriceSkus);
        }
        
        // 计算毛利
        function calculateProfit() {
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            const selectedSessionId = document.getElementById('profitSessionSelect').value;
            
            let targetOrders = [];
            let sessionInfo = null;
            
            // 获取时间范围
            const { startDate, endDate } = getTimeRange();
            
            if (selectedSessionId) {
                // 计算特定场次的毛利
                const session = liveHistory.find(s => (s.session || s).id == selectedSessionId);
                if (session) {
                    sessionInfo = session.session || session;
                    // 获取场次订单
                    if (session.orders && session.orders.length > 0) {
                        targetOrders = session.orders;
                    } else {
                        targetOrders = orders.filter(o => o.sessionId == selectedSessionId);
                    }
                }
            } else {
                // 计算所有场次的毛利汇总
                targetOrders = [...orders];
            }
            
            // 按时间筛选
            targetOrders = targetOrders.filter(order => {
                if (!order.timestamp) return true;
                
                const orderDate = new Date(order.timestamp);
                return orderDate >= startDate && orderDate < endDate;
            });
            
            // 获取手动输入的GMV（如果填写了则使用手动输入的值）
            const manualGMV = parseFloat(document.getElementById('manualGMV').value) || 0;
            
            // 计算总GMV（优先使用手动输入，否则从订单金额计算）
            const totalGMV = manualGMV > 0 ? manualGMV : targetOrders.reduce((sum, order) => {
                return sum + (parseFloat(order.auctionPrice) || 0);
            }, 0);
            
            // 计算手续费后GMV
            const actualGMV = totalGMV * (1 - feeRate / 100);
            
            // 计算总采购成本（商品采购价 × 数量）
            let totalCostCny = 0;
            let totalCostUsd = 0;
            
            targetOrders.forEach(order => {
                (order.skus || []).forEach(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const quantity = skuItem.quantity || 1;
                    const product = products.find(p => p.sku === sku);
                    
                    if (product) {
                        totalCostCny += (parseFloat(product.priceCny) || 0) * quantity;
                        totalCostUsd += (parseFloat(product.priceUsd) || 0) * quantity;
                    }
                });
            });
            
            // 计算毛利（假设用美元计算）
            const profitUsd = actualGMV - totalCostUsd;
            const profitRate = totalGMV > 0 ? (profitUsd / totalGMV * 100) : 0;
            
            // 计算订单数和SKU数
            const orderCount = targetOrders.length;
            const totalSkuCount = targetOrders.reduce((sum, order) => {
                return sum + (order.skus || []).reduce((skuSum, skuItem) => {
                    return skuSum + (skuItem.quantity || 1);
                }, 0);
            }, 0);
            
            // 获取未设置采购价的SKU
            const missingPriceSkus = getMissingPriceSkus(targetOrders);
            
            // 更新未设置采购价的SKU显示
            const missingPriceSkusEl = document.getElementById('missingPriceSkus');
            if (missingPriceSkusEl) {
                if (missingPriceSkus.length > 0) {
                    missingPriceSkusEl.innerHTML = `
                        <div style="color:#ff9800;margin-bottom:8px;">⚠️ 共 ${missingPriceSkus.length} 个SKU未设置采购价：</div>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">
                            ${missingPriceSkus.map(sku => `<span style="background:rgba(255,152,0,0.2);padding:2px 6px;border-radius:4px;color:#ff9800;font-size:11px;">${sku}</span>`).join('')}
                        </div>
                        <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:8px;">建议先在商品管理中补全采购价后再进行统计</div>
                    `;
                } else {
                    missingPriceSkusEl.innerHTML = '<div style="color:#4CAF50;">✅ 所有SKU均已设置采购价</div>';
                }
            }
            
            // 更新时间范围显示
            const timeRangeDisplayEl = document.getElementById('timeRangeDisplay');
            if (timeRangeDisplayEl) {
                timeRangeDisplayEl.textContent = `📅 ${getTimeRangeText()}`;
            }
            
            // 显示结果
            const profitDetailsEl = document.getElementById('profitDetails');
            if (!profitDetailsEl) return;
            
            const profitColor = profitUsd >= 0 ? '#4CAF50' : '#ef4444';
            
            profitDetailsEl.innerHTML = `
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-bottom:20px;">
                    <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;">
                        <div font-size:14px;margin-bottom:5px;">📦 订单数量</div>
                        <div style="color:#fff;font-size:24px;font-weight:bold;">${orderCount}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;">
                        <div font-size:14px;margin-bottom:5px;">🛒 销售SKU数</div>
                        <div style="color:#fff;font-size:24px;font-weight:bold;">${totalSkuCount}</div>
                    </div>
                </div>
                
                <div style="background:rgba(255,255,255,0.05);padding:20px;border-radius:8px;margin-bottom:15px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <span ">💰 原始GMV</span>
                        <span style="color:#FFD700;font-size:18px;font-weight:bold;">$${totalGMV.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <span ">📉 平台手续费 (${feeRate}%)</span>
                        <span style="color:#ff9800;font-size:16px;">-$${(totalGMV * feeRate / 100).toFixed(2)}</span>
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;margin-bottom:15px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:#667eea;font-weight:bold;">💵 实际GMV (扣除手续费后)</span>
                            <span style="color:#667eea;font-size:20px;font-weight:bold;">$${actualGMV.toFixed(2)}</span>
                        </div>
                    </div>
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <span ">📦 总采购成本</span>
                        <span style="color:#9c27b0;font-size:18px;font-weight:bold;">$${totalCostUsd.toFixed(2)} / ¥${totalCostCny.toFixed(2)}</span>
                    </div>
                    
                    <div style="border-top:2px solid ${profitColor};padding-top:15px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:${profitColor};font-size:18px;font-weight:bold;">🎯 毛利</span>
                            <div style="text-align:right;">
                                <div style="color:${profitColor};font-size:32px;font-weight:bold;">$${profitUsd.toFixed(2)}</div>
                                <div font-size:12px;">毛利率: ${profitRate.toFixed(2)}%</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                ${missingPriceSkus.length > 0 ? `
                <div style="background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.3);padding:15px;border-radius:8px;margin-bottom:15px;">
                    <div style="color:#ff9800;font-weight:bold;margin-bottom:5px;">⚠️ 统计提示</div>
                    <div font-size:13px;">
                        有 ${missingPriceSkus.length} 个SKU未设置采购价，可能影响毛利计算准确性。建议先在商品管理中补全采购价。
                    </div>
                </div>
                ` : ''}
                
                ${sessionInfo ? `
                <div style="background:rgba(0,0,0,0.2);padding:15px;border-radius:8px;">
                    <div font-size:12px;margin-bottom:5px;">📅 当前场次信息</div>
                    <div style="color:#fff;font-size:14px;">${sessionInfo.title || sessionInfo.sessionTitle}</div>
                    <div font-size:12px;">主播: ${sessionInfo.anchor || '未知'} | 日期: ${sessionInfo.date || sessionInfo.startTime || '未知'}</div>
                </div>
                ` : ''}
            `;
            
            // 渲染图表
            // 小延迟确保DOM已更新
            setTimeout(() => {
                const activeTab = document.querySelector('.chart-tab.active');
                if (activeTab) {
                    switchChartTab(activeTab.dataset.tab);
                } else {
                    renderTrendChart();
                }
            }, 200);
        }
        
        // 导出毛利数据
        function exportProfitData() {
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            const selectedSessionId = document.getElementById('profitSessionSelect').value;
            
            let targetOrders = [];
            let sessionInfo = null;
            
            // 获取时间范围
            const { startDate, endDate } = getTimeRange();
            
            if (selectedSessionId) {
                const session = liveHistory.find(s => (s.session || s).id == selectedSessionId);
                if (session) {
                    sessionInfo = session.session || session;
                    if (session.orders && session.orders.length > 0) {
                        targetOrders = session.orders;
                    } else {
                        targetOrders = orders.filter(o => o.sessionId == selectedSessionId);
                    }
                }
            } else {
                targetOrders = [...orders];
            }
            
            // 按时间筛选
            targetOrders = targetOrders.filter(order => {
                if (!order.timestamp) return true;
                const orderDate = new Date(order.timestamp);
                return orderDate >= startDate && orderDate < endDate;
            });
            
            // 获取未设置采购价的SKU
            const missingPriceSkus = getMissingPriceSkus(targetOrders);
            
            // 获取手动输入的GMV（如果填写了则使用手动输入的值）
            const manualGMV = parseFloat(document.getElementById('manualGMV').value) || 0;
            
            // 计算总GMV（优先使用手动输入，否则从订单金额计算）
            const totalGMV = manualGMV > 0 ? manualGMV : targetOrders.reduce((sum, order) => sum + (parseFloat(order.auctionPrice) || 0), 0);
            const actualGMV = totalGMV * (1 - feeRate / 100);
            let totalCostCny = 0, totalCostUsd = 0;
            targetOrders.forEach(order => {
                (order.skus || []).forEach(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const quantity = skuItem.quantity || 1;
                    const product = products.find(p => p.sku === sku);
                    if (product) {
                        totalCostCny += (parseFloat(product.priceCny) || 0) * quantity;
                        totalCostUsd += (parseFloat(product.priceUsd) || 0) * quantity;
                    }
                });
            });
            const profitUsd = actualGMV - totalCostUsd;
            const profitRate = totalGMV > 0 ? (profitUsd / totalGMV * 100) : 0;
            const orderCount = targetOrders.length;
            const totalSkuCount = targetOrders.reduce((sum, order) => {
                return sum + (order.skus || []).reduce((skuSum, skuItem) => skuSum + (skuItem.quantity || 1), 0);
            }, 0);
            
            // 生成CSV
            let csv = `毛利统计报表\n`;
            csv += `统计时间: ${getTimeRangeText()}\n`;
            csv += `手续费比例: ${feeRate}%\n`;
            csv += `\n`;
            csv += `【概览统计】\n`;
            csv += `订单数量,${orderCount}\n`;
            csv += `销售SKU数,${totalSkuCount}\n`;
            csv += `原始GMV($),${totalGMV.toFixed(2)}\n`;
            csv += `手续费($),${(totalGMV * feeRate / 100).toFixed(2)}\n`;
            csv += `实际GMV($),${actualGMV.toFixed(2)}\n`;
            csv += `采购成本($),${totalCostUsd.toFixed(2)}\n`;
            csv += `采购成本(¥),${totalCostCny.toFixed(2)}\n`;
            csv += `毛利($),${profitUsd.toFixed(2)}\n`;
            csv += `毛利率(%),${profitRate.toFixed(2)}\n`;
            csv += `\n`;
            
            if (missingPriceSkus.length > 0) {
                csv += `【未设置采购价的SKU】\n`;
                csv += `SKU\n`;
                missingPriceSkus.forEach(sku => csv += `${sku}\n`);
                csv += `\n`;
            }
            
            csv += `【订单明细】\n`;
            csv += `轮次,标题,竞拍金额($),SKU,数量,采购价($),采购价(¥),时间\n`;
            
            targetOrders.forEach(order => {
                (order.skus || []).forEach(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const quantity = skuItem.quantity || 1;
                    const product = products.find(p => p.sku === sku);
                    const priceCny = product ? (product.priceCny || 0) : 0;
                    const priceUsd = product ? (product.priceUsd || 0) : 0;
                    
                    csv += `${order.round || ''},${order.title || ''},${order.auctionPrice || 0},${sku},${quantity},${priceUsd},${priceCny},${order.timestamp || ''}\n`;
                });
            });
            
            // 下载CSV
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const filename = `毛利报表_${getTimeRangeText()}_${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.csv`;
            link.download = filename;
            link.click();
        }

        // ====== 图表功能 ======
        let trendChartInstance = null;
        let sessionChartInstance = null;
        let productChartInstance = null;

        // 切换图表标签页
        function switchChartTab(tab) {
            document.querySelectorAll('.chart-tab').forEach(btn => {
                btn.className = btn.className.replace(' btn-primary', ' btn-secondary').replace(' active', '');
                if (btn.dataset.tab === tab) {
                    btn.className = 'btn btn-primary chart-tab active';
                }
            });
            
            document.querySelectorAll('.chart-container').forEach(el => el.style.display = 'none');
            const targetMap = { trend: 'chartTrend', session: 'chartSession', product: 'chartProduct' };
            const targetEl = document.getElementById(targetMap[tab]);
            if (targetEl) targetEl.style.display = 'block';
            
            // 重新渲染以确保尺寸正确
            setTimeout(() => {
                if (tab === 'trend') renderTrendChart();
                else if (tab === 'session') renderSessionChart();
                else if (tab === 'product') renderProductChart();
            }, 100);
        }

        // 获取当前计算范围的订单数据
        function getChartOrders() {
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            const selectedSessionId = document.getElementById('profitSessionSelect').value;
            const { startDate, endDate } = getTimeRange();
            
            let targetOrders = [];
            if (selectedSessionId) {
                const session = liveHistory.find(s => (s.session || s).id == selectedSessionId);
                if (session) {
                    if (session.orders && session.orders.length > 0) targetOrders = session.orders;
                    else targetOrders = orders.filter(o => o.sessionId == selectedSessionId);
                }
            } else {
                targetOrders = [...orders];
            }
            
            return targetOrders.filter(order => {
                if (!order.timestamp) return true;
                return new Date(order.timestamp) >= startDate && new Date(order.timestamp) < endDate;
            });
        }

        // 渲染日趋势图
        function renderTrendChart() {
            const canvas = document.getElementById('trendChart');
            if (!canvas || !canvas.parentElement || canvas.parentElement.style.display === 'none') return;
            
            const orders = getChartOrders();
            
            // 按日聚合
            const dailyMap = {};
            orders.forEach(order => {
                if (!order.timestamp) return;
                const day = order.timestamp.substring(0, 10);
                if (!dailyMap[day]) dailyMap[day] = { gmv: 0, cost: 0, count: 0 };
                dailyMap[day].gmv += parseFloat(order.auctionPrice) || 0;
                dailyMap[day].count += 1;
                (order.skus || []).forEach(skuItem => {
                    const sku = skuItem.sku || skuItem;
                    const qty = skuItem.quantity || 1;
                    const product = products.find(p => p.sku === sku);
                    if (product) {
                        dailyMap[day].cost += (parseFloat(product.priceUsd) || 0) * qty;
                    }
                });
            });
            
            const sortedDays = Object.keys(dailyMap).sort();
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            
            const gmvData = sortedDays.map(d => dailyMap[d].gmv);
            const costData = sortedDays.map(d => dailyMap[d].cost);
            const profitData = sortedDays.map((d, i) => gmvData[i] * (1 - feeRate / 100) - costData[i]);
            
            if (trendChartInstance) trendChartInstance.destroy();
            
            trendChartInstance = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: sortedDays,
                    datasets: [
                        {
                            label: 'GMV ($)',
                            data: gmvData,
                            borderColor: '#FFD700',
                            backgroundColor: 'rgba(255,215,0,0.1)',
                            fill: true,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: '毛利 ($)',
                            data: profitData,
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76,175,80,0.1)',
                            fill: true,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: '订单数',
                            data: sortedDays.map(d => dailyMap[d].count),
                            borderColor: '#667eea',
                            backgroundColor: 'rgba(102,126,234,0.3)',
                            type: 'bar',
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top', labels: { color: '#fff', font: { size: 11 } } }
                    },
                    scales: {
                        x: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
                        y: {
                            type: 'linear', display: true, position: 'left',
                            ticks: { color: '#FFD700', font: { size: 10 } },
                            grid: { color: 'rgba(255,255,255,0.05)' }
                        },
                        y1: {
                            type: 'linear', display: true, position: 'right',
                            ticks: { color: '#667eea', font: { size: 10 } },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }

        // 渲染场次对比图
        function renderSessionChart() {
            const canvas = document.getElementById('sessionChart');
            if (!canvas || !canvas.parentElement || canvas.parentElement.style.display === 'none') return;
            
            if (!liveHistory || liveHistory.length === 0) {
                if (sessionChartInstance) sessionChartInstance.destroy();
                return;
            }
            
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            const { startDate, endDate } = getTimeRange();
            
            const sessionData = [];
            liveHistory.forEach(s => {
                const sd = s.session || s;
                const sOrders = s.orders && s.orders.length > 0 ? s.orders : orders.filter(o => o.sessionId == sd.id);
                const filtered = sOrders.filter(o => {
                    if (!o.timestamp) return true;
                    const t = new Date(o.timestamp);
                    return t >= startDate && t < endDate;
                });
                if (filtered.length === 0) return;
                
                let gmv = 0, cost = 0;
                filtered.forEach(o => {
                    gmv += parseFloat(o.auctionPrice) || 0;
                    (o.skus || []).forEach(si => {
                        const sku = si.sku || si;
                        const qty = si.quantity || 1;
                        const prod = products.find(p => p.sku === sku);
                        if (prod) cost += (parseFloat(prod.priceUsd) || 0) * qty;
                    });
                });
                const profit = gmv * (1 - feeRate / 100) - cost;
                sessionData.push({
                    label: sd.title || sd.sessionTitle || '未知',
                    gmv, profit, orders: filtered.length
                });
            });
            
            if (sessionChartInstance) sessionChartInstance.destroy();
            if (sessionData.length === 0) return;
            
            sessionChartInstance = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: sessionData.map(d => d.label),
                    datasets: [
                        {
                            label: 'GMV ($)',
                            data: sessionData.map(d => d.gmv),
                            backgroundColor: 'rgba(255,215,0,0.7)',
                            borderRadius: 4
                        },
                        {
                            label: '毛利 ($)',
                            data: sessionData.map(d => d.profit),
                            backgroundColor: d => d.profit >= 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'top', labels: { color: '#fff', font: { size: 11 } } }
                    },
                    scales: {
                        x: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
                        y: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 渲染商品排行图
        function renderProductChart() {
            const canvas = document.getElementById('productChart');
            if (!canvas || !canvas.parentElement || canvas.parentElement.style.display === 'none') return;
            
            const orders = getChartOrders();
            // 优先使用系统设置中的平台费率，其次使用页面手动输入
            let feeRate = 0;
            const manualFeeEl = document.getElementById('feeRate');
            if (manualFeeEl && manualFeeEl.value) {
                feeRate = parseFloat(manualFeeEl.value) || 0;
            } else if (typeof getPlatformFeeRate === 'function') {
                feeRate = getPlatformFeeRate();
            }
            
            // 按SKU聚合
            const skuMap = {};
            orders.forEach(order => {
                const gmv = parseFloat(order.auctionPrice) || 0;
                (order.skus || []).forEach(si => {
                    const sku = si.sku || si;
                    const qty = si.quantity || 1;
                    if (!skuMap[sku]) skuMap[sku] = { gmv: 0, cost: 0, qty: 0, name: '' };
                    skuMap[sku].gmv += gmv * qty / (order.skus ? order.skus.reduce((a, b) => a + (b.quantity || 1), 0) : 1);
                    skuMap[sku].qty += qty;
                    const prod = products.find(p => p.sku === sku);
                    if (prod) {
                        skuMap[sku].cost += (parseFloat(prod.priceUsd) || 0) * qty;
                        skuMap[sku].name = prod.name || '';
                    }
                });
            });
            
            // 毛利排序取前15
            const skuList = Object.entries(skuMap)
                .map(([sku, d]) => ({ sku, ...d, profit: d.gmv * (1 - feeRate / 100) - d.cost }))
                .sort((a, b) => b.profit - a.profit)
                .slice(0, 15);
            
            if (productChartInstance) productChartInstance.destroy();
            if (skuList.length === 0) return;
            
            productChartInstance = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: skuList.map(d => d.sku + (d.name ? ' ' + d.name.substring(0, 10) : '')),
                    datasets: [{
                        label: '毛利 ($)',
                        data: skuList.map(d => d.profit),
                        backgroundColor: skuList.map(d => d.profit >= 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)'),
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                afterLabel: function(ctx) {
                                    const item = skuList[ctx.dataIndex];
                                    return `GMV: $${item.gmv.toFixed(2)}\n成本: $${item.cost.toFixed(2)}\n数量: ${item.qty}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
                        y: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }
