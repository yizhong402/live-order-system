// product.js

        // ============ 排序状态 ============
        let sortField = '';       // 'stock' | 'price' | ''
        let sortOrder = 'asc';    // 'asc' | 'desc'
        
        function toggleSort(field) {
          if (sortField === field) {
            // 切换升降序
            sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
          } else {
            sortField = field;
            sortOrder = 'asc';
          }
          updateSortButtons();
          updateProductList();
        }
        
        function updateSortButtons() {
          const stockBtn = document.getElementById('sortStockBtn');
          const priceBtn = document.getElementById('sortPriceBtn');
          const indicator = document.getElementById('sortIndicator');
          if (sortField === 'stock') {
            stockBtn.textContent = '📦 库存 ' + (sortOrder === 'asc' ? '↑' : '↓');
            stockBtn.style.borderColor = '#667eea';
            stockBtn.style.color = '#667eea';
            if (priceBtn) { priceBtn.textContent = '💰 采购价 ↕'; priceBtn.style.borderColor = ''; priceBtn.style.color = ''; }
            if (indicator) indicator.textContent = sortOrder === 'asc' ? '库存 低→高' : '库存 高→低';
          } else if (sortField === 'price') {
            priceBtn.textContent = '💰 采购价 ' + (sortOrder === 'asc' ? '↑' : '↓');
            priceBtn.style.borderColor = '#667eea';
            priceBtn.style.color = '#667eea';
            if (stockBtn) { stockBtn.textContent = '📦 库存 ↕'; stockBtn.style.borderColor = ''; stockBtn.style.color = ''; }
            if (indicator) indicator.textContent = sortOrder === 'asc' ? '采购价 低→高' : '采购价 高→低';
          } else {
            if (stockBtn) { stockBtn.textContent = '📦 库存 ↕'; stockBtn.style.borderColor = ''; stockBtn.style.color = ''; }
            if (priceBtn) { priceBtn.textContent = '💰 采购价 ↕'; priceBtn.style.borderColor = ''; priceBtn.style.color = ''; }
            if (indicator) indicator.textContent = '';
          }
        }
        
        // ============ 库存实时轮询 ============
        let stockPollTimer = null;
        
        function startStockPolling() {
            console.log('📡 库存轮询已启动 (5秒间隔)');
            stopStockPolling();
            stockPollTimer = setInterval(async () => {
                try {
                    const res = await client.db.from('products').select('sku,stock').list();
                    if (res.success && res.data) {
                        const changed = [];
                        res.data.forEach(cp => {
                            const local = products.find(p => p.sku === cp.sku);
                            if (local && local.stock !== cp.stock) {
                                changed.push({ sku: cp.sku, old: local.stock, new: cp.stock });
                                local.stock = cp.stock;
                            }
                        });
                        if (changed.length > 0) {
                            console.log('🔄 库存变化:', changed.map(c => `${c.sku}:${c.old}→${c.new}`).join(', '));
                            // 如果当前在订单录入页，闪烁提示变化
                            if (typeof updateSkuList === 'function') updateSkuList();
                            // 显示库存变化通知
                            changed.forEach(c => {
                                showStockFlash(c.sku, c.old, c.new);
                            });
                        }
                    }
                } catch(e) {
                    // 静默失败
                }
            }, 5000);
        }
        
        function stopStockPolling() {
            if (stockPollTimer) {
                clearInterval(stockPollTimer);
                stockPollTimer = null;
            }
        }
        
        function showStockFlash(sku, oldStock, newStock) {
            // 在订单录入页的SKU列表中闪烁提示
            const skuItems = document.querySelectorAll('.sku-item');
            skuItems.forEach(item => {
                const codeEl = item.querySelector('.sku-code');
                if (codeEl && codeEl.textContent === sku) {
                    item.style.transition = 'background 0.3s';
                    item.style.background = 'rgba(59,130,246,0.2)';
                    setTimeout(() => { item.style.background = ''; }, 2000);
                    // 添加库存变动标签
                    const oldLabel = item.querySelector('.stock-flash');
                    if (oldLabel) oldLabel.remove();
                    const flash = document.createElement('div');
                    flash.className = 'stock-flash';
                    flash.style.cssText = 'font-size:11px;color:#60a5fa;margin-top:2px;';
                    flash.textContent = `🔄 库存: ${oldStock} → ${newStock}`;
                    codeEl.parentElement.appendChild(flash);
                    setTimeout(() => { flash.remove(); }, 5000);
                }
            });
        }


        function openProductModal() {
            showPage('product');
        }
        
        function closeProductModal() {
            showPage('home');
        }
        
        function toggleAddForm() {
            var form = document.getElementById('addProductForm');
            var btn = document.getElementById('addProductToggleBtn');
            if (form && btn) {
                var isVisible = form.style.display !== 'none';
                form.style.display = isVisible ? 'none' : 'block';
                btn.textContent = isVisible ? '➕ 添加商品' : '✖️ 收起表单';
            }
        }


        function syncOMSProducts() {
            var btn = document.getElementById('omsSyncBtnText') || document.querySelector('.btn-primary[onclick*="triggerOMSSync"]');
            if (!btn) btn = document.querySelector('.btn-primary[onclick*="syncOMSProducts"]');
            if (btn) {
                btn.textContent = '⏳ 同步中...';
                btn.disabled = true;
            }
            
            // 触发 OMS 同步标记
            systemSettings.omsSync.manualTrigger = true;
            debouncedSaveSettings();
            
            // 提示用户
            var statusEl = document.getElementById('omsSyncStatusMsg');
            if (!statusEl) {
                statusEl = document.createElement('span');
                statusEl.id = 'omsSyncStatusMsg';
                statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-left:10px;';
                if (btn && btn.parentNode) btn.parentNode.appendChild(statusEl);
            }
            statusEl.textContent = '⏳ 同步信号已发送，等待服务端执行...';
            
            // 等几秒后刷新 OMS 面板（不刷新 products 表，防止覆盖直播预扣库存）
            setTimeout(function() {
                // 刷新 oms_products 数据表（设置页里的 OMS 商品列表）
                if (typeof loadBaaSProducts === 'function') {
                    renderOMSProductsList(1);
                }
                // 刷新同步日志
                if (typeof refreshOMSSyncLog === 'function') {
                    // 加载最新的 settings
                    client.db.from('settings').list().then(function(r) {
                        if (r.success && r.data && r.data[0]) {
                            var raw = r.data[0].omsSync || '{}';
                            if (typeof raw === 'string') raw = JSON.parse(raw);
                            systemSettings.omsSync = raw;
                            if (typeof refreshOMSSyncLog === 'function') refreshOMSSyncLog();
                        }
                    }).catch(function(){});
                }
                statusEl.textContent = '✅ OMS 数据已同步（仅刷新参考数据，未覆盖系统库存）';
                if (btn) { btn.textContent = '🔄 同步 OMS 数据'; btn.disabled = false; }
            }.bind(this), 8000);
        }

        function calibrateStock() {
            if (!confirm('⚠️ 库存校准\n\n此操作将用 OMS 仓库库存直接覆盖系统库存！\n\n请在 **开播前** 使用，直播期间请勿操作。\n\n确定继续？')) {
                return;
            }
            
            var btn = document.querySelector('.btn-warning[onclick*="calibrateStock"]');
            if (btn) {
                btn.textContent = '⏳ 校准中...';
                btn.disabled = true;
            }
            
            // 触发校准标记（守护进程会执行覆盖同步）
            systemSettings.omsSync.calibrateTrigger = true;
            debouncedSaveSettings();
            
            var pollStart = Date.now();
            var pollCount = 0;
            showToast('📊 库存校准已启动，正在轮询进度...', 'warning');
            
            // 轮询检测校准完成
            function pollCalibrate() {
                pollCount++;
                var elapsed = Math.floor((Date.now() - pollStart) / 1000);
                var minutes = Math.floor(elapsed / 60);
                var seconds = elapsed % 60;
                var timeStr = minutes > 0 ? minutes + '分' + seconds + '秒' : seconds + '秒';
                
                if (btn) {
                    btn.textContent = '⏳ 校准中 (' + timeStr + ')';
                }
                
                client.db.from('settings').list().then(function(sr) {
                    if (!sr.success || !sr.data || !sr.data[0]) {
                        scheduleNextPoll();
                        return;
                    }
                    var rawOms = sr.data[0].omsSync || '{}';
                    try {
                        systemSettings.omsSync = typeof rawOms === 'string' ? JSON.parse(rawOms) : rawOms;
                    } catch(e) {}
                    if (typeof updateCalibrateTimeDisplay === 'function') updateCalibrateTimeDisplay();
                    
                    var oms = systemSettings.omsSync || {};
                    // 校准已经执行完毕（标记被清除）
                    if (oms.calibrateTrigger === false || oms.calibrateTrigger === undefined || oms.calibrateTrigger === null) {
                        var lastLog = (oms.syncLog || [])[0];
                        if (lastLog && lastLog.type === 'calibrate') {
                            var skipInfo = lastLog.skipped > 0 ? '（跳过' + lastLog.skipped + '条无变化）' : '';
                            var detail = '新增' + lastLog.added + ' 更新' + lastLog.updated + skipInfo;
                            showToast('✅ 库存校准完成: ' + detail, 'success');
                        } else {
                            showToast('✅ 库存校准已完成', 'success');
                        }
                        // 刷新商品列表
                        client.db.from('products').list().then(function(res) {
                            if (res.success && res.data) {
                                products = res.data.map(function(p) { return {
                                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                                    priceCny: p.price_cny || 0, priceUsd: p.price_usd || 0,
                                    originalStock: p.original_stock || p.stock || 0, 
                                    image: p.image_url || '',
                                    image_url: p.image_url || ''
                                }; });
                                updateProductList();
                                updateProductListDisplay();
                                updateProductStats();
                                showToast('📦 已刷新: ' + products.length + ' 条', 'success');
                            }
                            if (btn) { btn.textContent = '📊 库存校准'; btn.disabled = false; }
                        }).catch(function() {
                            if (btn) { btn.textContent = '📊 库存校准'; btn.disabled = false; }
                        });
                        return;
                    }
                    
                    // 检查是否有错误
                    var lastErr = oms.lastError;
                    if (lastErr && lastErr.type === 'calibrate') {
                        showToast('❌ 校准失败: ' + lastErr.message, 'error');
                        if (btn) { btn.textContent = '📊 库存校准'; btn.disabled = false; }
                        return;
                    }
                    
                    scheduleNextPoll();
                }).catch(function() {
                    scheduleNextPoll();
                });
            }
            
            function scheduleNextPoll() {
                var elapsed = Date.now() - pollStart;
                // 超过5分钟还没完成 → 超时恢复按钮
                if (elapsed > 300000) {
                    showToast('⚠️ 校准超时，请检查 OMS 连接状态', 'warning');
                    if (btn) { btn.textContent = '📊 库存校准'; btn.disabled = false; }
                    return;
                }
                setTimeout(pollCalibrate, 15000);
            }
            
            // 首次轮询等3秒（给守护进程响应时间），之后每15秒
            setTimeout(pollCalibrate, 3000);
        }

        // 商品管理页显示校准时间
function updateCalibrateTimeDisplay() {
  var el = document.getElementById('calibrateTimeDisplay');
  if (!el) return;
  var oms = systemSettings.omsSync || {};
  var t = oms.scheduleTime || '';
  el.textContent = t ? t : '未设置';

  // ===== OMS 同步/校准状态显示 =====
  var statusEl = document.getElementById('omsSyncStatus');
  if (!statusEl) return;

  var lastSync = oms.lastSync || '';
  var lastError = oms.lastError;
  var now = new Date();

  // 1. 有未清除的错误 → 红色
  if (lastError && lastError.message && lastError.message !== 'None') {
    var errType = lastError.type === 'calibrate' ? '校准' : '同步';
    var errTime = '';
    if (lastError.time) {
      try {
        var d = new Date(lastError.time.replace(' ', 'T'));
        errTime = d.toLocaleString('zh-CN');
      } catch(e) { errTime = lastError.time; }
    }
    statusEl.innerHTML = '<span style="color:#ff4444;margin-left:8px;" title="' + lastError.time + '">⚠️ OMS ' + errType + '失败 (' + errTime + '): ' + escapeHtml(lastError.message) + '</span>';
    return;
  }

  // 2. 检查是否有过 sync（没有 lastSync 说明从未成功同步过）
  if (!lastSync) {
    statusEl.innerHTML = '<span style="color:#ffaa00;margin-left:8px;">⚠️ OMS 未同步，请在系统设置页配置</span>';
    return;
  }

  // 3. 检查是否超过 4h 未同步
  try {
    var lastSyncDate = new Date(lastSync.replace(' ', 'T'));
    var hoursSinceSync = (now - lastSyncDate) / 3600000;
    if (hoursSinceSync > 4) {
      var h = Math.floor(hoursSinceSync);
      statusEl.innerHTML = '<span style="color:#ffaa00;margin-left:8px;" title="上次同步: ' + lastSync + '">⚠️ OMS 已 ' + h + 'h 未同步</span>';
      return;
    }
  } catch(e) { /* ignore date parse errors */ }

  // 4. 一切正常
  statusEl.innerHTML = '<span style="color:#66cc66;margin-left:8px;">✅ OMS 正常</span>';
}

// 商品管理页-跳转到设置页
function showCalibrateScheduleDialog() {
  var st = document.getElementById('settingsTab');
  if (st) st.click();
  // 滚动到 OMS 设置
  setTimeout(function() {
    var inp = document.getElementById('omsScheduleTime');
    if (inp) inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}

let originalImages = [];
        
        function openImageMatchModal() {
            const modal = document.getElementById('imageMatchModal');
            const grid = document.getElementById('imageMatchGrid');
            
            originalImages = products.map(p => p.image);
            
            grid.innerHTML = '';
            
            products.forEach((product, index) => {
                const card = document.createElement('div');
                card.style.background = 'rgba(255,255,255,0.05)';
                card.style.borderRadius = '10px';
                card.style.padding = '10px';
                card.style.textAlign = 'center';
                card.style.cursor = 'pointer';
                card.dataset.index = index;
                card.onclick = () => showImageSelector(index);
                
                const img = document.createElement('img');
                img.src = product.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"/%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"/%3E%3Cpolyline points="21 15 16 10 5 21"/%3E%3C/svg%3E';
                img.style.width = '120px';
                img.style.height = '120px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '8px';
                
                const sku = document.createElement('div');
                sku.textContent = product.sku;
                sku.style.color = 'white';
                sku.style.fontSize = '12px';
                sku.style.marginTop = '8px';
                sku.style.wordBreak = 'break-all';
                
                card.appendChild(img);
                card.appendChild(sku);
                grid.appendChild(card);
            });
            
            modal.style.display = 'flex';
        }
        
        function showImageSelector(productIndex) {
            const modal = document.createElement('div');
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.background = 'rgba(0,0,0,0.9)';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            modal.style.zIndex = '1000';
            
            const title = document.createElement('h3');
            title.textContent = `为 ${products[productIndex].sku} 选择图片`;
            title.style.color = 'white';
            title.style.marginBottom = '20px';
            
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(100px, 1fr))';
            grid.style.gap = '10px';
            grid.style.maxWidth = '800px';
            grid.style.maxHeight = '400px';
            grid.style.overflowY = 'auto';
            
            const allImages = [...new Set(products.map(p => p.image).filter(img => img))];
            
            if (allImages.length === 0) {
                const noImage = document.createElement('p');
                noImage.textContent = '没有可用的图片';
                noImage.style.color = '#999';
                modal.appendChild(noImage);
            } else {
                allImages.forEach((img, idx) => {
                    const imgEl = document.createElement('img');
                    imgEl.src = img;
                    imgEl.style.width = '80px';
                    imgEl.style.height = '80px';
                    imgEl.style.objectFit = 'cover';
                    imgEl.style.borderRadius = '8px';
                    imgEl.style.cursor = 'pointer';
                    imgEl.style.border = products[productIndex].image === img ? '3px solid #4CAF50' : '3px solid transparent';
                    imgEl.onclick = () => {
                        products[productIndex].image = img;
                        saveProducts();
                        modal.remove();
                        openImageMatchModal();
                    };
                    grid.appendChild(imgEl);
                });
                
                const noneBtn = document.createElement('button');
                noneBtn.textContent = '无图片';
                noneBtn.style.background = '#666';
                noneBtn.style.color = 'white';
                noneBtn.style.border = 'none';
                noneBtn.style.padding = '10px 20px';
                noneBtn.style.borderRadius = '5px';
                noneBtn.style.marginTop = '15px';
                noneBtn.onclick = () => {
                    products[productIndex].image = '';
                    saveProducts();
                    modal.remove();
                    openImageMatchModal();
                };
                
                modal.appendChild(title);
                modal.appendChild(grid);
                modal.appendChild(noneBtn);
            }
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.background = '#666';
            closeBtn.style.color = 'white';
            closeBtn.style.border = 'none';
            closeBtn.style.padding = '10px 20px';
            closeBtn.style.borderRadius = '5px';
            closeBtn.style.marginTop = '15px';
            closeBtn.onclick = () => modal.remove();
            modal.appendChild(closeBtn);
            
            document.body.appendChild(modal);
        }
        
        function saveImageMatch() {
            saveProducts();
            alert('✅ 图片匹配已保存！');
            closeImageMatchModal();
        }
        
        function resetImageMatch() {
            products.forEach((p, i) => {
                p.image = originalImages[i] || '';
            });
            saveProducts();
            openImageMatchModal();
        }
        
        function closeImageMatchModal() {
            document.getElementById('imageMatchModal').style.display = 'none';
        }
        
        function previewImage() {
            const fileInput = document.getElementById('productImage');
            const preview = document.getElementById('imagePreview');
            const file = fileInput.files[0];
            
            if (!file) {
                preview.src = '';
                preview.style.display = 'none';
                return;
            }
            
            console.log('📷 选择的图片文件:', file.name, '大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
            
            if (file.size > 10 * 1024 * 1024) {
                alert('❌ 图片文件过大！请选择小于10MB的图片。当前文件大小: ' + (file.size / 1024 / 1024).toFixed(2) + ' MB');
                fileInput.value = '';
                return;
            }
            
            const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
            if (!validTypes.includes(file.type)) {
                alert('❌ 不支持的图片格式！请选择 JPG、PNG、GIF 或 BMP 格式的图片。');
                fileInput.value = '';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                    console.log('✅ 图片预览成功，Base64长度:', e.target.result.length);
                } catch (err) {
                    console.error('❌ 图片预览失败:', err);
                    alert('图片预览失败，请重试或更换图片。');
                }
            };
            reader.onerror = function(err) {
                console.error('❌ FileReader错误:', err);
                alert('图片读取失败，请检查文件是否损坏或尝试其他图片。');
                fileInput.value = '';
            };
            reader.readAsDataURL(file);
        }
        
        async function addProduct() {
            const sku = document.getElementById('productSku').value.trim().toUpperCase();
            const name = document.getElementById('productName').value.trim();
            const stock = parseInt(document.getElementById('productStock').value) || 0;
            const priceCny = parseFloat(document.getElementById('productPriceCny').value) || 0;
            const priceUsd = parseFloat(document.getElementById('productPriceUsd').value) || 0;
            
            let image = '';
            const fileInput = document.getElementById('productImage');
            if (fileInput.files[0]) {
                image = document.getElementById('imagePreview').src;
            }
            
            if (!sku) {
                alert('请输入SKU！');
                return;
            }
            
            const existing = products.find(p => p.sku === sku);
            if (existing) {
                existing.name = name || existing.name;
                existing.stock = stock;
                existing.priceCny = priceCny;
                existing.priceUsd = priceUsd;
                if (image) {
                    var imgUrl = await uploadImageBase64(image);
                    existing.image = imgUrl || image;
                    productImagesCache[sku] = image;
                }
                // 保存到 BaaS
                client.db.from('products').list().then(function(r) {
                    if (r.success && r.data) {
                        var f = r.data.find(function(x) { return x.sku === sku; });
                        if (f) {
                            client.db.from('products').update(f.id, {
                                price_cny: priceCny, price_usd: priceUsd,
                                name: name || existing.name,
                                stock: stock, original_stock: stock
                            }).catch(function(e) { console.error('BaaS update err:', e); });
                        }
                    }
                });
            } else {
                products.push({
                    sku: sku,
                    name: name,
                    stock: stock,
                    priceCny: priceCny,
                    priceUsd: priceUsd,
                    originalStock: stock
                });
                if (image) {
                    const imgUrl = await uploadImageBase64(image); if (imgUrl) { products[products.length-1].image = imgUrl; } var pdata = { sku: sku, name: name || '', stock: stock, price_cny: priceCny, price_usd: priceUsd, image_url: imgUrl || '', original_stock: stock }; await client.db.from('products').save(pdata);
                    productImagesCache[sku] = image;
                }
            }
            
            updateProductList();
            saveProducts();
            document.getElementById('productSku').value = '';
            document.getElementById('productName').value = '';
            document.getElementById('productSku').focus();
        }
        
        function updateProductList() {
            console.log('updateProductList 被调用，商品数量:', products.length);
            displayProductList(getFilteredProducts(), 'productList');
            // 如果在批量选择模式，重新加复选框
            if (document.querySelector('.batch-select-cb')) {
                reattachBatchCheckboxes();
            }
        }
        
        function reattachBatchCheckboxes() {
            const container = document.getElementById('productList');
            if (!container) return;
            container.querySelectorAll('[data-sku]').forEach(el => {
                if (el.querySelector('.batch-select-cb')) return; // already has checkbox
                const sku = el.dataset.sku;
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'batch-select-cb';
                cb.style.marginRight = '8px';
                cb.style.width = '16px';
                cb.style.height = '16px';
                cb.style.cursor = 'pointer';
                cb.checked = batchSelectedSkus && batchSelectedSkus.has(sku);
                cb.onchange = function() {
                    if (this.checked) {
                        if (batchSelectedSkus) batchSelectedSkus.add(sku);
                    } else {
                        if (batchSelectedSkus) batchSelectedSkus.delete(sku);
                    }
                    updateBatchButton();
                };
                el.insertBefore(cb, el.firstChild);
            });
            updateBatchButton();
        }
        
        function onProductSearchInput() {
            updateProductList();
        }
        
        function onProductFilterChange() {
            updateProductList();
        }
        
        function getFilteredProducts() {
            const searchInput = document.getElementById('productSearchInput');
            const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const filterNoImage = document.getElementById('filterNoImage')?.checked || false;
            const filterNoPrice = document.getElementById('filterNoPrice')?.checked || false;
            const stockFilter = document.getElementById('filterStockStatus')?.value || 'all';
            
            let filtered = products;
            
            if (searchTerm) {
                filtered = filtered.filter(p => 
                    p.sku.toLowerCase().includes(searchTerm) || 
                    (p.name && p.name.toLowerCase().includes(searchTerm))
                );
            }
            
            // 🏷️ 库存状态筛选
            if (stockFilter === 'inStock') {
                filtered = filtered.filter(p => p.stock > 0);
            } else if (stockFilter === 'outOfStock') {
                filtered = filtered.filter(p => p.stock === 0);
            } else if (stockFilter === 'lowStock') {
                filtered = filtered.filter(p => p.stock > 0 && p.stock <= 3);
            }
            
            if (filterNoImage) {
                filtered = filtered.filter(p => {
                    var img = p.image_url || p.image || productImagesCache[p.sku] || '';
                    return !img;
                });
            }
            
            if (filterNoPrice) {
                filtered = filtered.filter(p => {
                    var cny = Number(p.price_cny || p.priceCny || 0);
                    var usd = Number(p.price_usd || p.priceUsd || 0);
                    return cny === 0 && usd === 0;
                });
            }
            
            // 🔄 排序
            if (sortField === 'stock') {
                filtered = [...filtered].sort((a, b) => {
                    return sortOrder === 'asc' ? a.stock - b.stock : b.stock - a.stock;
                });
            } else if (sortField === 'price') {
                filtered = [...filtered].sort((a, b) => {
                    var pa = Number(a.priceCny || a.price_cny || 0);
                    var pb = Number(b.priceCny || b.price_cny || 0);
                    return sortOrder === 'asc' ? pa - pb : pb - pa;
                });
            }
            
            return filtered;
        }
        
        function updateProductListDisplay() {
            const listEl = document.getElementById('productListPage');
            const searchInput = document.getElementById('productSearchInput');
            const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
            
            if (!listEl) {
                console.log('❌ productListPage 元素不存在');
                return;
            }
            
            const filteredProducts = products.filter(p => 
                p.sku.toLowerCase().includes(searchTerm) || 
                (p.name && p.name.toLowerCase().includes(searchTerm))
            );
            
            console.log('过滤后商品数量:', filteredProducts.length);
            
            if (filteredProducts.length === 0) {
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">暂无商品</div>';
                return;
            }
            
            updateProductStats();
            
            // 虚拟列表优化 - 只渲染可见区域的商品
            const ITEM_HEIGHT = 80; // 每个商品项的高度
            const VISIBLE_COUNT = 30; // 可见区域显示的商品数量
            const BUFFER_COUNT = 5; // 缓冲区数量
            
            // 创建虚拟列表容器
            listEl.innerHTML = `
                <div id="virtualListContainer" style="position: relative; overflow-y: auto; max-height: 600px;">
                    <div id="virtualListPlaceholder" style="height: ${filteredProducts.length * ITEM_HEIGHT}px;"></div>
                    <div id="virtualListContent" style="position: absolute; top: 0; left: 0; right: 0;"></div>
                </div>
            `;
            
            const container = document.getElementById('virtualListContainer');
            const placeholder = document.getElementById('virtualListPlaceholder');
            const content = document.getElementById('virtualListContent');
            
            function renderVisibleItems() {
                const scrollTop = container.scrollTop;
                const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_COUNT);
                const endIndex = Math.min(filteredProducts.length, startIndex + VISIBLE_COUNT + BUFFER_COUNT * 2);
                
                const visibleProducts = filteredProducts.slice(startIndex, endIndex);
                
                // 使用 documentFragment 避免字符串长度超限
            const fragment = document.createDocumentFragment();
            
            visibleProducts.forEach((product) => {
                let stockClass = 'stock-green';
                let stockText = '正常';
                if (product.stock === 0) {
                    stockClass = 'stock-red';
                    stockText = '已售罄';
                } else if (product.stock < 3) {
                    stockClass = 'stock-yellow';
                    stockText = '即将售罄';
                }
            
                const index = products.findIndex(p => p.sku === product.sku);
                const imageData = productImagesCache[product.sku] || product.image || '';
                
                // 创建商品项
                const itemDiv = document.createElement('div');
                itemDiv.className = 'product-item';
                
                // 库存徽章
                const badge = document.createElement('span');
                badge.className = `stock-badge ${stockClass}`;
                badge.title = stockText;
                itemDiv.appendChild(badge);
                
                // 图片或占位
                if (imageData) {
                    const img = document.createElement('img');
                    img.src = imageData;
                    img.style.width = '40px';
                    img.style.height = '40px';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '4px';
                    img.style.cursor = 'pointer';
                    img.onclick = () => showImageFullscreen(product.sku);
                    img.title = '点击查看大图';
                    itemDiv.appendChild(img);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.style.width = '40px';
                    placeholder.style.height = '40px';
                    placeholder.style.background = 'rgba(255,255,255,0.1)';
                    placeholder.style.borderRadius = '4px';
                    itemDiv.appendChild(placeholder);
                }
                
                // 商品信息
                const infoDiv = document.createElement('div');
                infoDiv.style.flex = '1';
                
                const skuDiv = document.createElement('div');
                skuDiv.style.fontWeight = 'bold';
                skuDiv.textContent = product.sku;
                infoDiv.appendChild(skuDiv);
                
                if (product.name) {
                    const nameDiv = document.createElement('div');
                    nameDiv.style.fontSize = '12px';
                    nameDiv.style.color = 'rgba(255,255,255,0.8)';
                    nameDiv.textContent = product.name;
                    infoDiv.appendChild(nameDiv);
                }
                
                const priceDiv = document.createElement('div');
                priceDiv.style.fontSize = '12px';
                priceDiv.style.color = 'rgba(255,255,255,0.6)';
                priceDiv.textContent = `库存: ${product.stock} | ¥${product.priceCny} / $${product.priceUsd}`;
                infoDiv.appendChild(priceDiv);
                
                itemDiv.appendChild(infoDiv);
                
                // 按钮组
                const btnGroup = document.createElement('div');
                btnGroup.style.display = 'flex';
                btnGroup.style.gap = '3px';
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn btn-success';
                copyBtn.style.padding = '3px 8px';
                copyBtn.style.fontSize = '11px';
                copyBtn.textContent = '📋 复制';
                copyBtn.onclick = () => copySku(product.sku);
                btnGroup.appendChild(copyBtn);
                
                const editBtn = document.createElement('button');
                editBtn.className = 'btn btn-primary';
                editBtn.style.padding = '3px 8px';
                editBtn.style.fontSize = '11px';
                editBtn.textContent = '编辑';
                editBtn.onclick = () => editProduct(index);
                btnGroup.appendChild(editBtn);
                
                const delBtn = document.createElement('button');
                delBtn.className = 'btn btn-danger';
                delBtn.style.padding = '3px 8px';
                delBtn.style.fontSize = '11px';
                delBtn.textContent = '删除';
                delBtn.onclick = () => removeProduct(index);
                btnGroup.appendChild(delBtn);
                
                itemDiv.appendChild(btnGroup);
                fragment.appendChild(itemDiv);
            });
            
            // 清空并添加新内容
            content.innerHTML = '';
            content.appendChild(fragment);
            
            // 调整内容位置
            content.style.top = startIndex * ITEM_HEIGHT + 'px';
        }
        
        // 初始渲染
        renderVisibleItems();
        
        // 添加滚动事件监听
        container.addEventListener('scroll', renderVisibleItems);
        
        // 图片预加载：后台加载当前不可见区域的图片到缓存
        function preloadOffscreenImages() {
            const scrollTop = container.scrollTop;
            const viewStart = Math.floor(scrollTop / ITEM_HEIGHT);
            const viewEnd = viewStart + VISIBLE_COUNT;
            // 预加载当前可见区域上下各 50 个
            const preloadStart = Math.max(0, viewStart - 50);
            const preloadEnd = Math.min(filteredProducts.length, viewEnd + 50);
            for (let i = preloadStart; i < preloadEnd; i++) {
                const p = filteredProducts[i];
                if (!p) continue;
                const imgUrl = p.image_url || p.image || '';
                if (imgUrl && !productImagesCache[p.sku + '_preloaded']) {
                    productImagesCache[p.sku + '_preloaded'] = true;
                    const img = new Image();
                    img.onload = function() {
                        // 加载完成后不要额外操作，浏览器会缓存
                    };
                    img.src = imgUrl;
                }
            }
        }
        preloadOffscreenImages();
        container.addEventListener('scroll', function() {
            // 滚动停止后预加载（防抖）
            clearTimeout(container._preloadTimer);
            container._preloadTimer = setTimeout(preloadOffscreenImages, 500);
        });
    }
    
    function displayProductList(productsToDisplay, elementId) {
        const listEl = document.getElementById(elementId);
        if (!listEl) return;
        
        if (!productsToDisplay || productsToDisplay.length === 0) {
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">暂无商品</div>';
            return;
        }
        
        // 清空列表
        listEl.innerHTML = '';
        
        // 使用 documentFragment 一次性添加所有元素，避免异步渲染问题
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < productsToDisplay.length; i++) {
            const product = productsToDisplay[i];
            let stockClass = 'stock-green';
            let stockText = '正常';
            if (product.stock === 0) {
                stockClass = 'stock-red';
                stockText = '已售罄';
            } else if (product.stock < 3) {
                stockClass = 'stock-yellow';
                stockText = '即将售罄';
            }
            
            const realIndex = products.findIndex(p => p.sku === product.sku);
            const imageData = productImagesCache[product.sku] || product.image || '';
            
            // 创建元素
            const itemDiv = document.createElement('div');
            itemDiv.dataset.sku = product.sku;
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.gap = '15px';
            itemDiv.style.margin = '8px 0';
            itemDiv.style.padding = '10px';
            itemDiv.style.background = 'rgba(255,255,255,0.05)';
            itemDiv.style.borderRadius = '8px';
            
            // 库存状态徽章
            const badge = document.createElement('span');
            badge.className = `stock-badge ${stockClass}`;
            badge.title = stockText;
            itemDiv.appendChild(badge);
            
            // 图片或占位
            if (imageData) {
                const img = document.createElement('img');
                img.src = imageData;
                img.style.width = '50px';
                img.style.height = '50px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '4px';
                img.style.cursor = 'pointer';
                img.onclick = () => showImageFullscreen(product.sku);
                img.title = '点击查看大图';
                img.alt = product.sku;
                itemDiv.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.style.width = '50px';
                placeholder.style.height = '50px';
                placeholder.style.background = 'rgba(255,255,255,0.1)';
                placeholder.style.borderRadius = '4px';
                itemDiv.appendChild(placeholder);
            }
            
            // 商品信息
            const infoDiv = document.createElement('div');
            infoDiv.style.flex = '1';
            
            const skuStrong = document.createElement('strong');
            skuStrong.textContent = product.sku;
            infoDiv.appendChild(skuStrong);
            
            if (product.name) {
                const nameDiv = document.createElement('div');
                nameDiv.style.fontSize = '13px';
                nameDiv.style.color = 'rgba(255,255,255,0.8)';
                nameDiv.textContent = product.name;
                infoDiv.appendChild(nameDiv);
            }
            
            const priceDiv = document.createElement('div');
            priceDiv.style.fontSize = '12px';
            priceDiv.style.color = 'rgba(255,255,255,0.6)';
            priceDiv.textContent = `库存：${product.stock} | 采购价：¥${product.priceCny} / $${product.priceUsd}`;
            infoDiv.appendChild(priceDiv);
            
            itemDiv.appendChild(infoDiv);
            
            // 按钮组
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '3px';
            
            // 复制按钮
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-success';
            copyBtn.style.padding = '3px 8px';
            copyBtn.style.fontSize = '11px';
            copyBtn.textContent = '📋 复制';
            copyBtn.onclick = () => copySku(product.sku);
            btnGroup.appendChild(copyBtn);
            
            // 编辑按钮
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-primary';
            editBtn.style.padding = '3px 8px';
            editBtn.style.fontSize = '11px';
            editBtn.textContent = '编辑';
            editBtn.onclick = () => editProduct(realIndex);
            btnGroup.appendChild(editBtn);
            
            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.style.padding = '3px 8px';
            delBtn.style.fontSize = '11px';
            delBtn.textContent = '删除';
            delBtn.onclick = () => removeProduct(realIndex);
            btnGroup.appendChild(delBtn);
            
            itemDiv.appendChild(btnGroup);
            
            fragment.appendChild(itemDiv);
        }
        
        // 一次性添加所有元素
        listEl.appendChild(fragment);
    }
    
    function updateProductStats() {
            const total = products.length;
            const noImage = products.filter(p => {
                var img = p.image_url || productImagesCache[p.sku] || '';
                return !img;
            }).length;
            const noPrice = products.filter(p => (!p.priceCny || p.priceCny === 0) && (!p.priceUsd || p.priceUsd === 0)).length;
            const normalStock = products.filter(p => p.stock > 2).length;
            const lowStock = products.filter(p => p.stock > 0 && p.stock <= 2).length;
            const emptyStock = products.filter(p => p.stock === 0).length;
            
            const updateStats = (prefix) => {
                const els = {
                    total: document.getElementById(prefix + 'statsTotal'),
                    noImage: document.getElementById(prefix + 'statsNoImage'),
                    noPrice: document.getElementById(prefix + 'statsNoPrice'),
                    normal: document.getElementById(prefix + 'statsNormal'),
                    low: document.getElementById(prefix + 'statsLow'),
                    empty: document.getElementById(prefix + 'statsEmpty')
                };
                
                if (els.total) {
                    els.total.textContent = total;
                    if (els.noImage) els.noImage.textContent = noImage;
                    if (els.noPrice) els.noPrice.textContent = noPrice;
                    if (els.normal) els.normal.textContent = normalStock;
                    if (els.low) els.low.textContent = lowStock;
                    if (els.empty) els.empty.textContent = emptyStock;
                }
            };
            
            updateStats('');
            updateStats('page-');
            
            if (document.getElementById('sideTotal')) {
                document.getElementById('sideTotal').textContent = total;
                document.getElementById('sideNoImage').textContent = noImage;
                document.getElementById('sideNoPrice').textContent = noPrice;
            }
        }
        
        let currentStockFilter = 'all';
        
        function setStockFilter(filter) {
            currentStockFilter = filter;
            
            document.querySelectorAll('[id^="filter"]').forEach(btn => btn.classList.remove('active'));
            
            // 根据筛选类型获取正确的按钮ID
            let buttonId;
            if (filter === 'noImage') {
                buttonId = 'filterNoImage';
            } else if (filter === 'noPrice') {
                buttonId = 'filterNoPrice';
            } else if (filter === 'hasPrice') {
                buttonId = 'filterHasPrice';
            } else {
                buttonId = `filter${filter.charAt(0).toUpperCase() + filter.slice(1)}`;
            }
            
            document.getElementById(buttonId).classList.add('active');
            
            filterProductList();
        }
        
        function batchUpdateStock() {
            const skuList = prompt('请输入要修改库存的SKU列表，用逗号分隔:');
            if (!skuList) return;
            
            const skus = skuList.split(',').map(s => s.trim()).filter(s => s);
            const newStock = parseInt(prompt('请输入新的库存数量:'));
            
            if (isNaN(newStock)) {
                alert('请输入有效的数字');
                return;
            }
            
            skus.forEach(sku => {
                const product = products.find(p => p.sku === sku);
                if (product) {
                    product.stock = newStock;
                }
            });
            
            saveToLocalStorage();
            filterProductList();
            alert(`已更新 ${skus.length} 个商品的库存`);
        }
        
                function downloadProductsWithIssues() {
            const issues = products.filter(p => {
                var img = p.image_url || p.image || productImagesCache[p.sku] || '';
                const hasImage = !!img;
                var cny = Number(p.price_cny || p.priceCny || 0);
                var usd = Number(p.price_usd || p.priceUsd || 0);
                const hasPrice = cny > 0 || usd > 0;
                return !hasImage || !hasPrice;
            });
            
            if (issues.length === 0) {
                alert('🎉 所有商品都完整，没有需要修复的问题！');
                return;
            }
            
            let csv = 'SKU,名称,库存,人民币价格,美金价格,问题\n';
            issues.forEach(p => {
                const problems = [];
                var img = p.image_url || p.image || productImagesCache[p.sku] || '';
                if (!img) problems.push('无图片');
                var cny = Number(p.price_cny || p.priceCny || 0);
                var usd = Number(p.price_usd || p.priceUsd || 0);
                if (cny === 0 && usd === 0) problems.push('无价格');
                
                csv += `"${p.sku || ''}","${p.name || ''}",${p.stock || 0},${p.priceCny || 0},${p.priceUsd || 0},"${problems.join(';')}"\n`;
            });
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `问题商品_${new Date().toLocaleDateString()}.csv`;
            link.click();
        }
        
        function exportAllProducts() {
            if (products.length === 0) {
                alert('没有商品可导出！');
                return;
            }
            
            const modalDiv = document.createElement('div');
            modalDiv.id = 'exportModal';
            modalDiv.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            modalDiv.innerHTML = `
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 15px; padding: 30px; width: 90%; max-width: 500px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    <h3 style="color: #667eea; font-size: 20px; margin-bottom: 20px; text-align: center;">📤 选择导出格式</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <button onclick="selectExportFormat('excel')" style="padding: 15px; border: none; border-radius: 10px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 4px 15px rgba(76, 175, 80, 0.4)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='none'">
                            📊 Excel<br><span style="font-size: 11px; opacity: 0.9;">(不含图片)</span>
                        </button>
                        <button onclick="selectExportFormat('excel-images')" style="padding: 15px; border: none; border-radius: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='none'">
                            🖼️ Excel<br><span style="font-size: 11px; opacity: 0.9;">(含图片)</span>
                        </button>
                        <button onclick="selectExportFormat('csv')" style="padding: 15px; border: none; border-radius: 10px; background: linear-gradient(135deg, #FF9800 0%, #f57c00 100%); color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 4px 15px rgba(255, 152, 0, 0.4)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='none'">
                            📝 CSV<br><span style="font-size: 11px; opacity: 0.9;">(不含图片)</span>
                        </button>
                        <button onclick="selectExportFormat('html')" style="padding: 15px; border: none; border-radius: 10px; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 4px 15px rgba(33, 150, 243, 0.4)'" onmouseout="this.style.transform='scale(1)';this.style.boxShadow='none'">
                            🌐 HTML<br><span style="font-size: 11px; opacity: 0.9;">(含图片)</span>
                        </button>
                    </div>
                    <button onclick="document.body.removeChild(document.getElementById('exportModal'))" style="margin-top: 20px; padding: 10px 30px; border: none; border-radius: 8px; background: rgba(255,255,255,0.1); color: white; font-size: 14px; cursor: pointer; width: 100%;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
                        取消
                    </button>
                </div>
            `;
            
            document.body.appendChild(modalDiv);
        }
        
        function selectExportFormat(format) {
            document.body.removeChild(document.getElementById('exportModal'));
            
            switch(format) {
                case 'excel-images':
                    exportProductsAsExcelWithImages();
                    break;
                case 'html':
                    exportProductsAsHtml();
                    break;
                case 'csv':
                    exportProductsAsCsv();
                    break;
                default:
                    exportProductsAsExcel();
            }
        }
        
        function exportProductsAsExcel() {
            const wb = XLSX.utils.book_new();
            const wsData = [
                ['SKU', '名称', '库存', '人民币价格(CNY)', '美金价格(USD)', '创建时间']
            ];
            products.forEach(p => {
                wsData.push([
                    p.sku || '',
                    p.name || '',
                    p.stock || 0,
                    p.priceCny || 0,
                    p.priceUsd || 0,
                    p.createdAt || ''
                ]);
            });
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, '商品数据');
            XLSX.writeFile(wb, `商品数据_${new Date().toLocaleDateString()}.xlsx`);
        }
        
        async function exportProductsAsExcelWithImages() {
            if (typeof ExcelJS === 'undefined') {
                alert('ExcelJS 库未加载，请刷新页面重试！');
                return;
            }
            
            const totalProducts = products.length;
            let exportSize = 300;
            
            const sizeOptions = [
                { size: 100, desc: '约 5-15 MB', color: '#4CAF50' },
                { size: 200, desc: '约 10-30 MB', color: '#8BC34A' },
                { size: 300, desc: '约 15-45 MB', color: '#FFC107' },
                { size: 500, desc: '约 25-75 MB', color: '#FF9800' },
                { size: 800, desc: '约 40-120 MB', color: '#E91E63' },
                { size: 1000, desc: '约 50-150 MB', color: '#F44336' }
            ];
            
            await new Promise((resolve) => {
                const sizeModal = document.createElement('div');
                sizeModal.id = 'sizeModal';
                sizeModal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
                
                const container = document.createElement('div');
                container.style.cssText = 'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 15px; padding: 30px; width: 90%; max-width: 500px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);';
                
                const title = document.createElement('h3');
                title.style.cssText = 'color: #667eea; font-size: 20px; margin-bottom: 10px; text-align: center;';
                title.textContent = '📦 选择每批次商品数量';
                container.appendChild(title);
                
                const desc = document.createElement('p');
                desc.style.cssText = 'color: rgba(255,255,255,0.7); font-size: 13px; text-align: center; margin-bottom: 20px;';
                desc.textContent = '共 ' + totalProducts + ' 个商品，选择批次大小以控制文件大小';
                container.appendChild(desc);
                
                const gridDiv = document.createElement('div');
                gridDiv.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;';
                
                sizeOptions.forEach(function(opt) {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'padding: 12px 8px; border: none; border-radius: 8px; background: ' + opt.color + '; color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s;';
                    btn.innerHTML = opt.size + '<br><span style="font-size: 10px; opacity: 0.9;">' + opt.desc + '</span>';
                    btn.dataset.size = opt.size;
                    btn.addEventListener('click', function() {
                        window.selectedBatchSize = opt.size;
                        document.body.removeChild(sizeModal);
                        resolve();
                    });
                    btn.addEventListener('mouseover', function() { this.style.transform = 'scale(1.05)'; });
                    btn.addEventListener('mouseout', function() { this.style.transform = 'scale(1)'; });
                    gridDiv.appendChild(btn);
                });
                
                container.appendChild(gridDiv);
                
                const cancelBtn = document.createElement('button');
                cancelBtn.style.cssText = 'margin-top: 20px; padding: 10px 30px; border: none; border-radius: 8px; background: rgba(255,255,255,0.1); color: white; font-size: 14px; cursor: pointer; width: 100%;';
                cancelBtn.textContent = '取消';
                cancelBtn.addEventListener('click', function() {
                    window.selectedBatchSize = null;
                    document.body.removeChild(sizeModal);
                    resolve();
                });
                cancelBtn.addEventListener('mouseover', function() { this.style.background = 'rgba(255,255,255,0.2)'; });
                cancelBtn.addEventListener('mouseout', function() { this.style.background = 'rgba(255,255,255,0.1)'; });
                container.appendChild(cancelBtn);
                
                sizeModal.appendChild(container);
                document.body.appendChild(sizeModal);
            });
            
            if (window.selectedBatchSize === null) return;
            exportSize = window.selectedBatchSize;
            
            const totalBatches = Math.ceil(totalProducts / exportSize);
            const estimatedSizeMB = Math.round((exportSize * 0.15));
            
            if (!confirm(`共有 ${totalProducts} 个商品，将分成 ${totalBatches} 个文件导出（每${exportSize}个商品一个文件）。\n\n预估单个文件大小：约 ${estimatedSizeMB}-${estimatedSizeMB * 2} MB\n\n点击"确定"开始导出...`)) {
                return;
            }
        
            const progressDiv = document.createElement('div');
            progressDiv.id = 'exportProgress';
            progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);padding:30px;border-radius:15px;text-align:center;z-index:10000;color:white;min-width:350px;';
            progressDiv.innerHTML = `
                <h3 style="margin-bottom:20px;color:#667eea;">📤 正在导出商品数据</h3>
                <div id="progressText" style="margin-bottom:15px;">准备中...</div>
                <div style="width:100%;height:10px;background:rgba(255,255,255,0.2);border-radius:5px;overflow:hidden;">
                    <div id="progressBar" style="width:0%;height:100%;background:linear-gradient(90deg,#667eea,#764ba2);transition:width 0.3s;"></div>
                </div>
                <div id="batchInfo" style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.6);"></div>
            `;
            document.body.appendChild(progressDiv);
            
            const updateProgress = function(current, total, message, batchInfo) {
                if (batchInfo === undefined) batchInfo = '';
                const percent = Math.round((current / total) * 100);
                document.getElementById('progressText').textContent = message || current + '/' + total + ' (' + percent + '%)';
                document.getElementById('progressBar').style.width = percent + '%';
                document.getElementById('batchInfo').textContent = batchInfo;
            };
            
            let exportedCount = 0;
            let exportedImages = 0;
            
            try {
                for (let batch = 0; batch < totalBatches; batch++) {
                    const startIdx = batch * exportSize;
                    const endIdx = Math.min(startIdx + exportSize, totalProducts);
                    const batchProducts = products.slice(startIdx, endIdx);
                    
                    updateProgress(batch * exportSize, totalProducts, '正在准备第 ' + (batch + 1) + '/' + totalBatches + ' 批...', 
                        '批次 ' + (batch + 1) + '/' + totalBatches + ' (' + (startIdx + 1) + '-' + endIdx + ' 个商品)');
                    
                    const workbook = new ExcelJS.Workbook();
                    workbook.creator = 'Walmart Live Auction Tool';
                    workbook.created = new Date();
                    
                    const worksheet = workbook.addWorksheet('商品数据');
                    worksheet.columns = [
                        { header: 'SKU', key: 'sku', width: 20 },
                        { header: '名称', key: 'name', width: 30 },
                        { header: '库存', key: 'stock', width: 10 },
                        { header: '人民币价格(CNY)', key: 'priceCny', width: 15 },
                        { header: '美金价格(USD)', key: 'priceUsd', width: 15 },
                        { header: '图片', key: 'image', width: 25 },
                        { header: '创建时间', key: 'createdAt', width: 20 }
                    ];
                    
                    worksheet.getRow(1).font = { bold: true };
                    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };
                    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    
                    const maxImageSize = 300;
                    let batchImageCount = 0;
                    
                    for (let i = 0; i < batchProducts.length; i++) {
                        const p = batchProducts[i];
                        const imageUrl = p.image_url || p.image || productImagesCache[p.sku] || null;
                        const rowNum = i + 2;
                        
                        worksheet.addRow({
                            sku: p.sku || '',
                            name: p.name || '',
                            stock: p.stock || 0,
                            priceCny: p.priceCny || 0,
                            priceUsd: p.priceUsd || 0,
                            createdAt: p.createdAt || ''
                        });
                        
                        if (imageUrl) {
                            try {
                                const base64Data = await getCompressedBase64FromUrl(imageUrl, maxImageSize);
                                if (base64Data && base64Data.length < 300000) {
                                    const image = workbook.addImage({
                                        base64: base64Data.split(',')[1],
                                        extension: 'jpeg'
                                    });
                                    worksheet.addImage(image, {
                                        tl: { col: 5, row: rowNum - 1 },
                                        ext: { width: 100, height: 100 }
                                    });
                                    batchImageCount++;
                                }
                            } catch (e) {
                                console.warn('图片加载失败: ' + p.sku, e);
                            }
                        }
                        
                        const overallProgress = startIdx + i + 1;
                        updateProgress(overallProgress, totalProducts, 
                            '正在处理: ' + (p.sku || '商品' + overallProgress), 
                            '批次 ' + (batch + 1) + '/' + totalBatches + ' (' + overallProgress + '/' + totalProducts + ')');
                        
                        if ((i + 1) % 5 === 0) {
                            await new Promise(function(resolve) { setTimeout(resolve, 5); });
                        }
                    }
                    
                    worksheet.eachRow(function(row, rowIndex) {
                        row.height = rowIndex === 1 ? 25 : 110;
                    });
                    
                    updateProgress(startIdx + batchProducts.length, totalProducts, 
                        '正在生成第 ' + (batch + 1) + '/' + totalBatches + ' 个文件...');
                    
                    const buffer = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = '商品数据_含图片_' + (batch + 1) + '_' + new Date().toLocaleDateString() + '.xlsx';
                    link.click();
                    
                    exportedCount += batchProducts.length;
                    exportedImages += batchImageCount;
                    
                    await new Promise(function(resolve) { setTimeout(resolve, 500); });
                }
                
                document.body.removeChild(progressDiv);
                alert('✅ 导出成功！\n共导出 ' + exportedCount + ' 个商品\n包含 ' + exportedImages + ' 张图片\n分成 ' + totalBatches + ' 个文件');
                
            } catch (error) {
                document.body.removeChild(progressDiv);
                console.error('导出失败:', error);
                alert('导出失败：' + error.message);
            }
        }
        
        async function getCompressedBase64FromUrl(url, maxSize = 400) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => {
                    try {
                        let width = img.width;
                        let height = img.height;
                        
                        if (width > height) {
                            if (width > maxSize) {
                                height = Math.round(height * maxSize / width);
                                width = maxSize;
                            }
                        } else {
                            if (height > maxSize) {
                                width = Math.round(width * maxSize / height);
                                height = maxSize;
                            }
                        }
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataURL = canvas.toDataURL('image/jpeg', 0.6);
                        resolve(dataURL);
                    } catch (e) {
                        reject(e);
                    }
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = url;
            });
        }
        
        function exportProductsAsHtml() {
            let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>商品数据导出 - ${new Date().toLocaleString()}</title>
    
</head>
<body>
    <h1>📦 商品数据导出</h1>
    <div class="stats">
        <strong>导出时间:</strong> ${new Date().toLocaleString()} | 
        <strong>商品总数:</strong> ${products.length} 件
    </div>
    <div class="product-grid">`;
            
            products.forEach(p => {
                const imageUrl = p.image_url || p.image || productImagesCache[p.sku] || null;
                const imageHtml = imageUrl ? `<img src="${imageUrl}" class="product-image" alt="${p.name || p.sku}" />` : '<div class="product-image" style="background:#eee;display:flex;align-items:center;justify-content:center;color:#999;">无图片</div>';
                
                html += `
        <div class="product-card">
            ${imageHtml}
            <div class="product-sku">${p.sku || '无SKU'}</div>
            <div class="product-name">${p.name || '无名称'}</div>
            <div class="product-info">
                <div>📦 库存: ${p.stock || 0}</div>
                <div>💰 采购价(CNY): ¥${p.priceCny || 0}</div>
                <div>💵 采购价(USD): $${p.priceUsd || 0}</div>
                <div>📅 创建时间: ${p.createdAt || '-'}</div>
            </div>
        </div>`;
            });
            
            html += `
    </div>
</body>
</html>`;
            
            const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `商品数据_含图片_${new Date().toLocaleDateString()}.html`;
            link.click();
        }
        
        function filterProducts() {
            updateProductListDisplay();
        }
        
        function copySku(sku) {
            navigator.clipboard.writeText(sku).then(() => {
                const indicator = document.getElementById('scanIndicator');
                indicator.innerHTML = `<p style="color:#10b981;">✅ SKU ${sku} 已复制到剪贴板！</p>`;
                indicator.classList.add('active');
                setTimeout(() => {
                    indicator.classList.remove('active');
                    indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
                }, 2000);
            }).catch(err => {
                alert('复制失败，请手动复制: ' + sku);
            });
        }
        
        async function batchDeleteFiltered() {
            // 获取当前筛选的商品
            const searchTerm = document.getElementById('productSearchInput').value.toLowerCase();
            let filteredProducts = products.filter(p => 
                p.sku.toLowerCase().includes(searchTerm) || 
                (p.name && p.name.toLowerCase().includes(searchTerm))
            );
            
            // 应用当前筛选条件
            if (currentStockFilter === 'normal') {
                filteredProducts = filteredProducts.filter(p => p.stock > 2);
            } else if (currentStockFilter === 'low') {
                filteredProducts = filteredProducts.filter(p => p.stock > 0 && p.stock <= 2);
            } else if (currentStockFilter === 'empty') {
                filteredProducts = filteredProducts.filter(p => p.stock === 0);
            } else if (currentStockFilter === 'noImage') {
                filteredProducts = filteredProducts.filter(p => { var img = p.image_url || p.image || productImagesCache[p.sku] || ''; return !img; });
            } else if (currentStockFilter === 'noPrice') {
                filteredProducts = filteredProducts.filter(p => !p.priceCny && !p.priceUsd);
            } else if (currentStockFilter === 'hasPrice') {
                filteredProducts = filteredProducts.filter(p => p.priceCny > 0 || p.priceUsd > 0);
            }
            
            if (filteredProducts.length === 0) {
                alert('当前筛选条件下没有可删除的商品！');
                return;
            }
            
            // 确认删除
            const confirmed = confirm(`确定要删除当前筛选的 ${filteredProducts.length} 个商品吗？此操作不可恢复！`);
            if (!confirmed) return;
            
            // 逐个删除商品
            for (const product of [...filteredProducts]) {
                const sku = product.sku;
                const index = products.findIndex(p => p.sku === sku);
                if (index !== -1) {
                    products.splice(index, 1);
                    delete productImagesCache[sku];
                    await deleteImage(sku);
                }
            }
            
            await saveProducts();
            filterProductList();
            updateProductListDisplay();
            updateProductStats();
            
            alert(`成功删除 ${filteredProducts.length} 个商品！`);
        }
        
        async function removeProduct(indexOrSku) {
            let index;
            if (typeof indexOrSku === 'number') {
                index = indexOrSku;
            } else {
                index = products.findIndex(p => p.sku === indexOrSku);
            }
            
            if (index !== -1) {
                const sku = products[index].sku;
                products.splice(index, 1);
                delete productImagesCache[sku];
                await deleteImage(sku);
                
                // 保持当前筛选状态，只更新筛选后的列表
                filterProductList();
                updateProductListDisplay();
                await saveProducts();
                updateProductStats();
            }
        }
        
        function editProduct(index) {
            const product = products[index];
            document.getElementById('editProductIndex').value = index;
            document.getElementById('editProductSku').value = product.sku;
            document.getElementById('editProductName').value = product.name || '';
            document.getElementById('editProductStock').value = product.stock;
            document.getElementById('editProductPriceCny').value = product.priceCny;
            document.getElementById('editProductPriceUsd').value = product.priceUsd;
            
            const preview = document.getElementById('editImagePreview');
            const imageData = productImagesCache[product.sku] || product.image || '';
            if (imageData) {
                preview.src = imageData;
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
            
            document.getElementById('editProductModal').style.display = 'block';
        }
        
        function closeEditProductModal() {
            document.getElementById('editProductModal').style.display = 'none';
            document.getElementById('editProductImage').value = '';
            document.getElementById('editImagePreview').style.display = 'none';
        }
        
        function previewEditImage() {
            const fileInput = document.getElementById('editProductImage');
            const preview = document.getElementById('editImagePreview');
            const file = fileInput.files ? fileInput.files[0] : null;
            
            if (!file) {
                preview.src = '';
                preview.style.display = 'none';
                return;
            }
            
            console.log('📷 编辑时选择的图片文件:', file.name, '大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
            
            if (file.size > 10 * 1024 * 1024) {
                alert('❌ 图片文件过大！请选择小于10MB的图片。当前文件大小: ' + (file.size / 1024 / 1024).toFixed(2) + ' MB');
                fileInput.value = '';
                return;
            }
            
            const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
            if (!validTypes.includes(file.type)) {
                alert('❌ 不支持的图片格式！请选择 JPG、PNG、GIF 或 BMP 格式的图片。');
                fileInput.value = '';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                    console.log('✅ 编辑图片预览成功，Base64长度:', e.target.result.length);
                } catch (err) {
                    console.error('❌ 编辑图片预览失败:', err);
                    alert('图片预览失败，请重试或更换图片。');
                }
            };
            reader.onerror = function(err) {
                console.error('❌ FileReader错误:', err);
                alert('图片读取失败，请检查文件是否损坏或尝试其他图片。');
                fileInput.value = '';
            };
            reader.readAsDataURL(file);
        }
        
        function clearEditImage() {
            document.getElementById('editProductImage').value = '';
            document.getElementById('editImagePreview').src = '';
            document.getElementById('editImagePreview').style.display = 'none';
        }
        
        function showImageFullscreen(sku) {
            // 从 products 数组查找真实图片 URL
            var prod = products.find(function(p) { return p.sku === sku; });
            var imageData = productImagesCache[sku] || '';
            if (!imageData && prod) {
                imageData = prod.image_url || prod.image || '';
            }
            if (!imageData) return;
            
            const modal = document.createElement('div');
            modal.id = 'imageModal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);display:flex;justify-content:center;align-items:center;z-index:99999;cursor:zoom-out;';
            modal.onclick = function() {
                if (modal.parentNode === document.body) {
                    document.body.removeChild(modal);
                }
            };
            
            const img = document.createElement('img');
            img.src = imageData;
            img.alt = sku;
            img.style.cssText = 'max-width:90%;max-height:90%;object-fit:contain;border-radius:8px;box-shadow:0 0 50px rgba(0,0,0,0.5);';
            img.onclick = function(e) {
                e.stopPropagation();
            };
            
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:#ef4444;color:white;border:none;border-radius:50%;width:50px;height:50px;font-size:24px;cursor:pointer;z-index:9999;';
            closeBtn.onclick = function(e) {
                e.stopPropagation();
                if (modal.parentNode === document.body) {
                    document.body.removeChild(modal);
                }
            };
            
            modal.appendChild(img);
            modal.appendChild(closeBtn);
            document.body.appendChild(modal);
        }
        
        async function saveEditProduct() {
            const index = parseInt(document.getElementById('editProductIndex').value);
            const product = products[index];
            
            product.name = document.getElementById('editProductName').value.trim();
            product.stock = parseInt(document.getElementById('editProductStock').value) || 0;
            product.priceCny = parseFloat(document.getElementById('editProductPriceCny').value) || 0;
            product.priceUsd = parseFloat(document.getElementById('editProductPriceUsd').value) || 0;
            
            const fileInput = document.getElementById('editProductImage');
            if (fileInput.files && fileInput.files[0]) {
                const reader = new FileReader();
                reader.onload = async function(e) {
                    const imageData = e.target.result;
                    await saveImage(product.sku, imageData);
                    productImagesCache[product.sku] = imageData;
                    finishSave();
                };
                reader.readAsDataURL(fileInput.files[0]);
            } else {
                finishSave();
            }
            
            function finishSave() {
                product.originalStock = product.stock;
                // 编辑时只修改价格字段，保留 OMS 同步的库存/名称/图片不变
                var sku = product.sku;
                var ppriceCny = product.priceCny || 0;
                var ppriceUsd = product.priceUsd || 0;
                var pname = product.name || '';
                var pstock = product.stock || 0;
                var pimg = product.image_url || '';
                
                // 上传新图片（如果选了）
                var imagePromise = Promise.resolve(null);
                var fileInput = document.getElementById('editProductImage');
                if (fileInput && fileInput.files && fileInput.files[0]) {
                    imagePromise = uploadImageBase64(productImagesCache[sku] || '');
                }
                
                imagePromise.then(function(imgUrl) {
                    var finalImg = imgUrl || pimg;
                    // 查找 BaaS 记录并更新
                    client.db.from('products').list().then(function(res) {
                        if (res.success && res.data) {
                            var found = res.data.find(function(r) { return r.sku === sku; });
                            if (found) {
                                client.db.from('products').update(found.id, {
                                    price_cny: ppriceCny,
                                    price_usd: ppriceUsd,
                                    name: pname,
                                    stock: pstock,
                                    original_stock: pstock,
                                    image_url: finalImg
                                }).then(function() {
                                    console.log('✅ BaaS 保存成功:', sku);
                                }).catch(function(e) {
                                    console.error('❌ BaaS 保存失败:', e);
                                });
                            }
                        }
                    }).catch(function(e) {
                        console.error('❌ 查询失败:', e);
                    });
                });
                
                updateProductList();
                updateProductListDisplay();
                saveProducts();
                closeEditProductModal();
                alert('商品信息已更新！');
            }
        }
        
        function downloadImage(base64, index) {
            const link = document.createElement('a');
            link.download = `unmatched_image_${index + 1}.jpg`;
            link.href = base64;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        function downloadSkuListAsCSV(skus) {
            const csv = 'SKU\n' + skus.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.download = 'skus_without_images.csv';
            link.href = URL.createObjectURL(blob);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }
        
        function showImportReport(unmatchedImages, skusWithoutImages) {
            let html = `
                <div style="padding:20px;max-height:600px;overflow:auto;">
                    <h3 style="margin-bottom:20px;color:#333;">📊 导入报告</h3>
            `;
            
            if (unmatchedImages.length > 0) {
                html += `
                    <div style="margin-bottom:20px;">
                        <h4 style="color:#e74c3c;margin-bottom:10px;">⚠️ 未匹配的图片 (${unmatchedImages.length}张)</h4>
                        <p style="font-size:12px;color:#666;margin-bottom:10px;">以下图片未能匹配到任何SKU，请下载后重新上传：</p>
                        <div style="display:flex;flex-wrap:gap:10px;">
                `;
                
                unmatchedImages.forEach((img, index) => {
                    html += `
                        <div style="margin:5px;padding:5px;border:1px solid #ddd;border-radius:4px;text-align:center;">
                            <img src="${img}" style="width:80px;height:80px;object-fit:cover;border-radius:4px;">
                            <div style="margin-top:5px;">
                                <button onclick="downloadImage('${img}', ${index})" style="padding:4px 8px;font-size:12px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">
                                    📥 下载
                                </button>
                            </div>
                        </div>
                    `;
                });
                
                html += `
                        </div>
                    </div>
                `;
            }
            
            if (skusWithoutImages.length > 0) {
                html += `
                    <div>
                        <h4 style="color:#f39c12;margin-bottom:10px;">⚠️ 缺少图片的SKU (${skusWithoutImages.length}个)</h4>
                        <p style="font-size:12px;color:#666;margin-bottom:10px;">以下SKU没有匹配到图片，请单独上传：</p>
                        <div style="max-height:200px;overflow:auto;border:1px solid #ddd;border-radius:4px;padding:10px;">
                            <div style="display:flex;flex-wrap:wrap;gap:5px;">
                `;
                
                skusWithoutImages.forEach(sku => {
                    html += `
                        <span style="padding:3px 8px;background:#f8f9fa;border-radius:4px;font-size:12px;">${sku}</span>
                    `;
                });
                
                html += `
                            </div>
                        </div>
                        <button onclick="downloadSkuListAsCSV(['${skusWithoutImages.join("','")}'])" style="margin-top:10px;padding:6px 12px;font-size:12px;background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer;">
                            📥 下载SKU列表
                        </button>
                    </div>
                `;
            }
            
            html += `
                    <button onclick="document.getElementById('importReportModal').style.display='none'" style="margin-top:20px;padding:8px 16px;font-size:14px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">
                        关闭
                    </button>
                </div>
            `;
            
            const modal = document.createElement('div');
            modal.id = 'importReportModal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            `;
            
            const content = document.createElement('div');
            content.style.cssText = `
                background: white;
                border-radius: 10px;
                max-width: 800px;
                width: 90%;
                max-height: 80vh;
                overflow: auto;
            `;
            content.innerHTML = html;
            
            modal.appendChild(content);
            document.body.appendChild(modal);
            
            modal.onclick = function(e) {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    document.body.removeChild(modal);
                }
            };
        }
        
        function showImageImportTips() {
            alert(`📊 Excel批量导入图片指南

=== IMPORTANT: Excel格式要求 ===
1. 必须保存为 .xlsx 格式（不能是 .xls 或其他格式）
2. Excel文件大小建议不超过20MB
3. 图片必须直接插入到Excel单元格中

=== 推荐的Excel表格结构 ===
| SKU    | 商品名称 | 库存 | 人民币价格 | 美金价格 | 图片 |
|--------|----------|------|------------|----------|------|
| SKU001 | 商品A    | 10   | 50         | 7.5      | [图片] |
| SKU002 | 商品B    | 5    | 80         | 12       | [图片] |

=== 如何在Excel中插入图片 ===
1. 打开Excel，定位到要插入图片的单元格
2. 点击"插入" -> "图片" -> "此设备"
3. 选择要插入的图片文件
4. 调整图片大小以适应单元格

=== 如果图片无法自动提取 ===

🔧 方案1：使用Base64格式（最可靠！）
   1. 打开在线Base64转换工具
   2. 上传图片获取Base64编码
   3. 在Excel的"图片"列直接粘贴Base64编码
   4. 确保Base64以 "data:image/" 开头

🔧 方案2：检查Excel文件
   - 确保是 .xlsx 格式（不是 .xls 或 .csv）
   - 尝试重新保存文件：另存为 -> 选择 .xlsx 格式
   - 检查图片是否真的插入到了Excel中

🔧 方案3：调试方法
   1. 导入时按 F12 打开开发者工具
   2. 切换到 Console 控制台
   3. 查看"提取到的图片数量"日志
   4. 如果显示"找到 0 张图片"，说明Excel中的图片无法被识别

=== 替代方案 ===
如果图片始终无法导入：
   - 先用XLSX导入商品数据（不含图片）
   - 然后在商品管理中逐个手动上传图片
   - 或使用CSV导入后手动添加图片

如有问题，请尝试上述方法！`);
        }
        
        function downloadTemplate() {
            const template = `SKU,商品名称,库存,人民币价格,美金价格
SKU001,商品A,10,50,7.5
SKU002,商品B,5,80,12
SKU003,商品C,20,30,4.5
ABCD001,商品D,15,100,15`;
            
            const blob = new Blob(['\ufeff' + template], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = '商品导入模板.csv';
            link.click();
        }
        
        function downloadProductTemplate() {
            downloadTemplate();
        }
        
        function importProductFile() {
            const fileInput = document.getElementById('productImportFile');
            if (fileInput && fileInput.files.length > 0) {
                importProductXlsxWithImages();
            }
        }
        
        async function importProductXlsxWithImages() {
            const fileInput = document.getElementById('productImportFile');
            const file = fileInput.files[0];
            if (!file) return;
            
            console.log('=== 商品管理 - Excel导入开始 ===');
            console.log('选择的文件:', file.name);
            console.log('文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
            
            if (typeof XLSX === 'undefined') {
                alert('❌ Excel解析库未加载！\n\n请检查网络连接后刷新页面重试。');
                return;
            }
            
            // 文件大小限制已移除，支持大文件分块导入
            const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
            if (file.size > 500 * 1024 * 1024) {
                if (!confirm(`⚠️ 文件较大 (${fileSizeMB} MB)，可能需要较长时间处理。确定继续导入吗？`)) {
                    return;
                }
            }
            
            // 创建进度条
            const progressBar = document.createElement('div');
            progressBar.innerHTML = `
                <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);padding:30px;border-radius:12px;z-index:9999;color:white;text-align:center;min-width:300px;">
                    <div style="font-size:18px;margin-bottom:20px;">📥 正在导入商品...</div>
                    <div style="height:20px;background:rgba(255,255,255,0.2);border-radius:10px;overflow:hidden;margin-bottom:10px;">
                        <div id="importProgress" style="height:100%;background:linear-gradient(90deg,#4CAF50,#8BC34A);width:0%;transition:width 0.3s;"></div>
                    </div>
                    <div id="importStatus" style="font-size:14px;color:rgba(255,255,255,0.8);">准备导入...</div>
                </div>
            `;
            document.body.appendChild(progressBar);
            
            const progressEl = document.getElementById('importProgress');
            const statusEl = document.getElementById('importStatus');
            
            try {
                statusEl.textContent = '读取文件中...';
                progressEl.style.width = '10%';
                
                const data = await file.arrayBuffer();
                
                statusEl.textContent = '解析Excel中...';
                progressEl.style.width = '20%';
                
                const workbook = XLSX.read(data, { type: 'array' });
                
                statusEl.textContent = '提取图片中...';
                progressEl.style.width = '30%';
                
                const { images, imageCellMap } = await extractImagesFromWorkbookZip(file);
                console.log(`提取到 ${images ? images.length : 0} 张图片`);
                console.log('图片-单元格映射:', imageCellMap);
                
                progressEl.style.width = '40%';
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                console.log('解析到行数:', jsonData.length);
                
                let addedCount = 0;
                let updatedCount = 0;
                let skippedCount = 0;
                let imageCount = 0;
                const CHUNK_SIZE = 100; // 每次处理100行
                const totalChunks = Math.ceil(jsonData.length / CHUNK_SIZE);
                
                statusEl.textContent = '准备处理...';
                
                // 保存已售罄商品的状态
                const soldOutSkus = new Set(products.filter(p => p.status === 'soldout').map(p => p.sku));
                console.log(`已售罄商品: ${soldOutSkus.size} 个`);
                
                // 不再清空旧数据，改为增量更新
                // 只有明确标记为要删除的商品才会被删除
                
                console.log('开始增量导入新数据...');
                
                statusEl.textContent = '处理商品数据...';
                
                // 分块处理
                for (let chunkStart = 0; chunkStart < jsonData.length; chunkStart += CHUNK_SIZE) {
                    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, jsonData.length);
                    const currentChunk = jsonData.slice(chunkStart, chunkEnd);
                    
                    console.log(`处理块 ${Math.floor(chunkStart / CHUNK_SIZE) + 1}/${totalChunks}, 行 ${chunkStart + 1}-${chunkEnd}`);
                    
                    statusEl.textContent = `处理块 ${Math.floor(chunkStart / CHUNK_SIZE) + 1}/${totalChunks}...`;
                    
                    for (let i = 0; i < currentChunk.length; i++) {
                        const globalIndex = chunkStart + i;
                        const row = currentChunk[i];
                        const sku = (row['SKU'] || row['sku'] || row['Sku'] || '').toString().trim().toUpperCase();
                        
                        // 更新进度
                        const progress = 40 + (globalIndex / jsonData.length) * 50;
                        progressEl.style.width = `${progress}%`;
                        statusEl.textContent = `处理商品: ${globalIndex + 1}/${jsonData.length}`;
                        
                        if (!sku) {
                            skippedCount++;
                            continue;
                        }
                        
                        const name = row['名称'] || row['name'] || row['Name'] || row['商品名称'] || '';
                        const stockRaw = row['库存'] || row['stock'] || row['Stock'] || row['数量'];
                        const stock = stockRaw ? parseInt(stockRaw) : null;
                        const priceCnyRaw = row['采购价(CNY)'] || row['人民币价格'] || row['priceCny'] || row['PriceCNY'];
                        const priceCny = priceCnyRaw ? parseFloat(priceCnyRaw) : null;
                        const priceUsdRaw = row['采购价(USD)'] || row['美金价格'] || row['priceUsd'] || row['PriceUSD'];
                        const priceUsd = priceUsdRaw ? parseFloat(priceUsdRaw) : null;
                        
                        // 尝试匹配图片 - 仅通过单元格位置匹配，不使用行顺序匹配（防止错位）
                        let imageData = '';
                        const rowNum = globalIndex + 2;
                        
                        // 检查imageCellMap是否有数据
                        if (Object.keys(imageCellMap).length > 0) {
                            const possibleCells = [`B${rowNum}`, `C${rowNum}`, `D${rowNum}`, `E${rowNum}`, `F${rowNum}`, `G${rowNum}`];
                            
                            for (const cell of possibleCells) {
                                const embedIds = imageCellMap[cell];
                                if (embedIds) {
                                    // 支持同一单元格有多个图片的情况（取第一个）
                                    const embedIdList = Array.isArray(embedIds) ? embedIds : [embedIds];
                                    for (const embedId of embedIdList) {
                                        const cleanedEmbedId = embedId.replace('rId', '');
                                        const matchedImage = images.find(img => img.path && (img.path.includes(cleanedEmbedId) || img.path.includes(embedId)));
                                        if (matchedImage) {
                                            imageData = matchedImage.base64;
                                            console.log(`行 ${rowNum} SKU: ${sku} - 通过单元格 ${cell} 匹配到图片`);
                                            break; // 找到第一个就停止
                                        }
                                    }
                                    if (imageData) break;
                                }
                            }
                        }
                        
                        // 如果单元格映射为空，尝试通过drawing.xml的行位置匹配
                        if (!imageData && images.length > 0 && Object.keys(imageCellMap).length === 0) {
                            // 这种情况下，我们假设图片是按行顺序排列的，但前提是每一行有且仅有一个图片
                            // 但为了防止错位，如果图片数量不匹配行数量，就不匹配
                            const validSkuCount = jsonData.filter(row => (row['SKU'] || row['sku'] || row['Sku'] || '').toString().trim()).length;
                            if (images.length === validSkuCount) {
                                imageData = typeof images[globalIndex] === 'string' ? images[globalIndex] : images[globalIndex].base64;
                                console.log(`行 ${rowNum} SKU: ${sku} - 按精确行顺序匹配图片`);
                            } else {
                                console.log(`行 ${rowNum} SKU: ${sku} - 图片数量(${images.length})与SKU数量(${validSkuCount})不匹配，跳过图片匹配`);
                            }
                        }
                        
                        const existingProduct = products.find(p => p.sku === sku);
                        
                        if (existingProduct) {
                            let hasChanges = false;
                            if (name && name !== existingProduct.name) {
                                existingProduct.name = name;
                                hasChanges = true;
                            }
                            if (stock !== null && stock !== existingProduct.stock) {
                                existingProduct.stock = stock;
                                existingProduct.originalStock = stock;
                                hasChanges = true;
                            }
                            if (priceCny !== null && priceCny !== existingProduct.priceCny) {
                                existingProduct.priceCny = priceCny;
                                hasChanges = true;
                            }
                            if (priceUsd !== null && priceUsd !== existingProduct.priceUsd) {
                                existingProduct.priceUsd = priceUsd;
                                hasChanges = true;
                            }
                            if (imageData && imageData !== productImagesCache[sku] && imageData !== existingProduct.image) {
                                await saveImage(sku, imageData);
                                productImagesCache[sku] = imageData;
                                hasChanges = true;
                                imageCount++;
                            }
                            if (hasChanges) updatedCount++;
                            else skippedCount++;
                        } else {
                            const newProduct = {
                                sku: sku,
                                name: name || '未命名商品',
                                stock: stock !== null ? stock : 0,
                                originalStock: stock !== null ? stock : 0,
                                priceCny: priceCny !== null ? priceCny : 0,
                                priceUsd: priceUsd !== null ? priceUsd : 0,
                                status: soldOutSkus.has(sku) ? 'soldout' : 'normal'
                            };
                            products.push(newProduct);
                            addedCount++;
                            if (imageData) {
                                await saveImage(sku, imageData);
                                productImagesCache[sku] = imageData;
                                imageCount++;
                            }
                        }
                        
                        // 每处理完20行，让浏览器有机会执行垃圾回收
                        if ((i + 1) % 20 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
                
                // 处理完一个块后，立即保存数据到数据库
                await saveProducts();
                
                // 每处理完一个块，等待100ms让浏览器释放内存
                console.log(`块 ${Math.floor(chunkStart / CHUNK_SIZE) + 1}/${totalChunks} 处理完成，等待释放内存...`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
                
            statusEl.textContent = '保存数据中...';
            progressEl.style.width = '95%';
            
            // 保存导入时间
            const importTime = new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            saveProducts();
            
            progressEl.style.width = '100%';
            statusEl.textContent = '完成！';
                
                setTimeout(() => {
                    document.body.removeChild(progressBar);
                    updateProductList();
                    updateProductStats();
                    updateLastImportTime();
                    
                    alert(`✅ 导入完成！\n\n新增: ${addedCount} 个\n更新: ${updatedCount} 个\n跳过: ${skippedCount} 行\n📷 图片: ${imageCount} 张`);
                }, 500);
                
            } catch (error) {
                document.body.removeChild(progressBar);
                console.error('Excel导入失败:', error);
                alert('❌ 导入失败！\n\n错误信息: ' + error.message);
            }
        }
        
        function importProductCsvFile() {
            const fileInput = document.getElementById('productImportCsv');
            const file = fileInput.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const csv = e.target.result;
                const lines = csv.split('\n');
                let addedCount = 0;
                let updatedCount = 0;
                let skippedCount = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const parts = line.split(',').map(p => p.trim());
                    const sku = (parts[0] || '').toUpperCase();
                    
                    if (!sku) {
                        skippedCount++;
                        continue;
                    }
                    
                    const name = parts[1] || '';
                    const stock = parseInt(parts[2] || 0);
                    const priceCny = parseFloat(parts[3] || 0);
                    const priceUsd = parseFloat(parts[4] || 0);
                    
                    const existingProduct = products.find(p => p.sku === sku);
                    
                    if (existingProduct) {
                        let hasChanges = false;
                        if (name && name !== existingProduct.name) {
                            existingProduct.name = name;
                            hasChanges = true;
                        }
                        if (!isNaN(stock) && stock !== existingProduct.stock) {
                            existingProduct.stock = stock;
                            existingProduct.originalStock = stock;
                            hasChanges = true;
                        }
                        if (!isNaN(priceCny) && priceCny !== existingProduct.priceCny) {
                            existingProduct.priceCny = priceCny;
                            hasChanges = true;
                        }
                        if (!isNaN(priceUsd) && priceUsd !== existingProduct.priceUsd) {
                            existingProduct.priceUsd = priceUsd;
                            hasChanges = true;
                        }
                        if (hasChanges) updatedCount++;
                        else skippedCount++;
                    } else {
                        const newProduct = {
                            sku: sku,
                            name: name || '未命名商品',
                            stock: !isNaN(stock) ? stock : 0,
                            originalStock: !isNaN(stock) ? stock : 0,
                            priceCny: !isNaN(priceCny) ? priceCny : 0,
                            priceUsd: !isNaN(priceUsd) ? priceUsd : 0
                        };
                        products.push(newProduct);
                        addedCount++;
                    }
                }
                
                saveProducts();
                updateProductList();
                updateProductStats();
                
                alert(`✅ CSV导入完成！\n\n新增: ${addedCount} 个\n更新: ${updatedCount} 个\n跳过: ${skippedCount} 行`);
            };
            
            reader.readAsText(file, 'UTF-8');
        }
        
        function importProducts() {
            const csv = prompt('请粘贴CSV数据（格式：SKU,商品名称,库存,人民币价格,美金价格）:\n\n示例:\nSKU001,商品A,10,50,7.5\nSKU002,商品B,5,80,12');
            if (!csv) return;
            
            const lines = csv.split('\n');
            let addedCount = 0;
            let updatedCount = 0;
            
            lines.forEach(line => {
                const parts = line.split(',').map(p => p.trim());
                if (parts[0]) {
                    const sku = parts[0].toUpperCase();
                    const existing = products.find(p => p.sku === sku);
                    
                    if (existing) {
                        let hasChanges = false;
                        
                        if (parts[1] && parts[1] !== existing.name) {
                            existing.name = parts[1];
                            hasChanges = true;
                        }
                        
                        const newStock = parseInt(parts[2]);
                        if (!isNaN(newStock) && newStock !== existing.stock) {
                            existing.stock = newStock;
                            existing.originalStock = newStock;
                            hasChanges = true;
                        }
                        
                        const newPriceCny = parseFloat(parts[3]);
                        if (!isNaN(newPriceCny) && newPriceCny !== existing.priceCny) {
                            existing.priceCny = newPriceCny;
                            hasChanges = true;
                        }
                        
                        const newPriceUsd = parseFloat(parts[4]);
                        if (!isNaN(newPriceUsd) && newPriceUsd !== existing.priceUsd) {
                            existing.priceUsd = newPriceUsd;
                            hasChanges = true;
                        }
                        
                        if (hasChanges) {
                            updatedCount++;
                        }
                    } else {
                        products.push({
                            sku: sku,
                            name: parts[1] || '',
                            stock: parseInt(parts[2]) || 0,
                            priceCny: parseFloat(parts[3]) || 0,
                            priceUsd: parseFloat(parts[4]) || 0,
                            image: '',
                            originalStock: parseInt(parts[2]) || 0
                        });
                        addedCount++;
                    }
                }
            });
            
            updateProductList();
            saveProducts();
            alert(`导入完成！新增 ${addedCount} 条，更新 ${updatedCount} 条商品数据。`);
        }
        
        function checkXlsxLibrary() {
            console.log('=== XLSX库诊断 ===');
            console.log('typeof XLSX:', typeof XLSX);
            console.log('XLSX对象:', XLSX);
            
            let message = '🔧 XLSX库诊断结果：\n\n';
            
            if (typeof XLSX === 'undefined') {
                message += '❌ XLSX库未加载！\n\n';
                message += '可能原因：\n';
                message += '1. 网络连接问题\n';
                message += '2. CDN被屏蔽\n';
                message += '3. 浏览器缓存问题\n\n';
                message += '解决方法：\n';
                message += '1. 刷新页面（Ctrl+F5）\n';
                message += '2. 检查网络连接\n';
                message += '3. 尝试使用Chrome或Edge浏览器\n';
                message += '4. 暂时使用CSV批量导入（无图片）\n';
            } else if (typeof XLSX.read === 'function') {
                message += '✅ XLSX库已正确加载！\n\n';
                message += '库版本: ' + (XLSX.version || '未知') + '\n\n';
                message += '如果导入仍失败，请：\n';
                message += '1. 检查文件是否为标准.xlsx格式\n';
                message += '2. 尝试用Excel重新保存文件\n';
                message += '3. 打开浏览器控制台(F12)查看详细错误\n';
            } else {
                message += '⚠️ XLSX库加载不完整！\n\n';
                message += '建议刷新页面重试。\n';
            }
            
            alert(message);
            
            console.log('=== 诊断完成 ===');
        }
        
        
        // 云端导入（超大文件绕过浏览器解析，直接上传到云存储后服务端处理）
        let cloudImportFile = null;
        
        function cloudImportXlsx() {
            document.getElementById('cloudXlsxFile').click();
        }
        
        async function cloudImportFileSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            if (!confirm(`⚠️ 文件大小: ${sizeMB}MB\n\n将上传到云端进行服务端处理，请确认继续？`)) return;
            
            const progressDiv = document.getElementById('importProgress');
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            const progressMessage = document.getElementById('progressMessage');
            const importBtn = document.getElementById('cloudImportBtn');
            
            progressDiv.style.display = 'block';
            progressBar.style.width = '0%';
            progressText.textContent = '0%';
            progressMessage.textContent = '正在上传文件到云端...';
            importBtn.disabled = true;
            
            try {
                // 直接把文件上传到云存储
                const formData = new FormData();
                formData.append('file', file);
                
                const resp = await fetch(CLOUD_UPLOAD_URL, {
                    method: 'POST',
                    headers: { 'CODE_FLYING': CLOUD_API_KEY },
                    body: formData
                });
                const result = await resp.json();
                
                if (!result.success || !result.data || !result.data.url) {
                    throw new Error('上传失败: ' + JSON.stringify(result));
                }
                
                const fileUrl = result.data.url;
                progressBar.style.width = '100%';
                progressText.textContent = '✅';
                progressMessage.textContent = `✅ 文件上传成功! (${sizeMB}MB)\n\n正在通知服务端后台处理，请稍后刷新查看...`;
                progressMessage.style.whiteSpace = 'pre-line';
                
                // 通知后台处理
                const notifyResp = await fetch(CLOUD_BASE_URL + '/common/upload', {
                    method: 'POST',
                    headers: { 'CODE_FLYING': CLOUD_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'process_xlsx_import',
                        fileUrl: fileUrl,
                        apiKey: CLOUD_API_KEY
                    })
                });
                
                console.log('云端导入文件URL:', fileUrl);
                
                showToast('文件已上传，服务端正在处理中，请稍后刷新页面查看结果');
                importBtn.disabled = false;
            } catch (e) {
                console.error('云端导入失败:', e);
                progressMessage.textContent = '❌ 上传失败: ' + e.message;
                progressMessage.style.color = '#ef4444';
                importBtn.disabled = false;
            }
        }

        // 云端导入（超大文件绕过浏览器解析，直接上传到云存储）
        function cloudImportXlsx() {
            document.getElementById('cloudXlsxFile').click();
        }
        
        async function cloudImportFileSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            if (!confirm(`⚠️ 文件大小: ${sizeMB}MB\n\n将上传到云端进行服务端处理，请确认继续？`)) return;
            
            const progressDiv = document.getElementById('importProgress');
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            const progressMessage = document.getElementById('progressMessage');
            const importBtn = document.getElementById('cloudImportBtn');
            
            progressDiv.style.display = 'block';
            progressBar.style.width = '5%';
            progressText.textContent = '0%';
            progressMessage.textContent = '正在上传文件到云存储...';
            importBtn.disabled = true;
            
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                const resp = await fetch(CLOUD_UPLOAD_URL, {
                    method: 'POST',
                    headers: { 'CODE_FLYING': CLOUD_API_KEY },
                    body: formData
                });
                const result = await resp.json();
                
                if (!result.success || !result.data || !result.data.url) {
                    throw new Error('上传失败: ' + JSON.stringify(result));
                }
                
                const fileUrl = result.data.url;
                progressBar.style.width = '40%';
                progressText.textContent = '40%';
                progressMessage.textContent = '已上传到云端，正在提交后台处理请求...';
                
                // 调用后台处理接口
                const processResp = await fetch(CLOUD_BASE_URL + '/common/custom', {
                    method: 'POST',
                    headers: { 'CODE_FLYING': CLOUD_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'process_xlsx_import',
                        fileUrl: fileUrl
                    })
                });
                const processResult = await processResp.json();
                
                progressBar.style.width = '100%';
                progressText.textContent = '✅';
                
                if (processResult.success) {
                    progressMessage.innerHTML = '✅ 导入完成! 已处理 ' + (processResult.data?.count || '') + ' 个商品，请刷新页面查看。';
                    showToast('导入完成，请刷新页面');
                } else {
                    progressMessage.innerHTML = '✅ 文件已上传到云端!<br>把下面这行字发给小艺，我帮你继续处理：<br><code style="background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:4px;font-size:12px;">导入Excel: ' + fileUrl + '</code>';
                    showToast('文件已上传，告诉小艺继续处理');
                    // 复制文件URL到剪贴板方便粘贴
                    navigator.clipboard.writeText('导入Excel: ' + fileUrl).catch(()=>{});
                }
                
                importBtn.disabled = false;
            } catch (e) {
                console.error('云端导入失败:', e);
                progressMessage.textContent = '❌ 上传失败: ' + e.message;
                progressMessage.style.color = '#ef4444';
                importBtn.disabled = false;
            }
        }
function checkJSZipLibrary() {
            console.log('=== JSZip库诊断 ===');
            console.log('typeof JSZip:', typeof JSZip);
            console.log('JSZip对象:', JSZip);
            
            let message = '🔧 JSZip库诊断结果：\n\n';
            
            if (typeof JSZip === 'undefined') {
                message += '❌ JSZip库未加载！\n\n';
                message += '可能原因：\n';
                message += '1. CDN被屏蔽\n';
                message += '2. 网络连接问题\n\n';
                message += '解决方法：\n';
                message += '1. 刷新页面（Ctrl+F5）\n';
                message += '2. 检查网络连接\n';
            } else if (typeof JSZip.loadAsync === 'function') {
                message += '✅ JSZip库已正确加载！\n\n';
                message += '版本: ' + (JSZip.version || '未知') + '\n';
            } else {
                message += '⚠️ JSZip库加载不完整！\n';
            }
            
            alert(message);
            console.log('=== JSZip诊断完成 ===');
        }
        
        async function importXlsxWithImages() {
            const fileInput = document.getElementById('xlsxFile');
            const file = fileInput.files[0];
            if (!file) return;
            
            console.log('=== 开始Excel导入诊断 ===');
            console.log('选择的文件:', file.name);
            console.log('文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
            console.log('文件类型:', file.type || '未知');
            console.log('XLSX库状态:', typeof XLSX === 'undefined' ? '未加载' : '已加载');
            
            if (typeof XLSX === 'undefined') {
                alert('❌ Excel解析库未加载！\n\n请检查网络连接后刷新页面重试。\n如果问题持续，请尝试使用Chrome或Edge浏览器。');
                return;
            }
            
            const maxSizeMB = 100;
            if (file.size > maxSizeMB * 1024 * 1024) {
                alert(`⚠️ 文件过大 (${(file.size / 1024 / 1024).toFixed(2)} MB)，请先在Excel中压缩图片：\n\n方法：\n1. 用Excel打开文件\n2. 选中所有图片\n3. 将图片宽度调整为 800-1000 像素\n4. 保存文件后重新导入\n\n提示：图片越多越大，导入前请先压缩！`);
                return;
            }
            
            const progressDiv = document.getElementById('importProgress');
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            const progressMessage = document.getElementById('progressMessage');
            const importBtn = document.getElementById('xlsxImportBtn');
            
            progressDiv.style.display = 'block';
            progressBar.style.width = '0%';
            progressText.textContent = '0%';
            progressMessage.textContent = '正在读取文件...';
            importBtn.disabled = true;
            
            try {
                const reader = new FileReader();
                const fileData = await new Promise((resolve, reject) => {
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsBinaryString(file);
                });
                
                progressBar.style.width = '20%';
                progressText.textContent = '20%';
                progressMessage.textContent = '正在解析Excel文件...';
                
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const workbook = XLSX.read(fileData, { 
                    type: 'binary'
                });
                
                console.log('解析后的workbook:', workbook);
                console.log('SheetNames:', workbook.SheetNames);
                console.log('Sheets:', workbook.Sheets ? Object.keys(workbook.Sheets) : '无');
                console.log('workbook完整结构:', JSON.stringify(Object.keys(workbook)));
                
                if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
                    throw new Error('无法读取工作表数据，文件可能已损坏或格式不兼容');
                }
                
                progressBar.style.width = '30%';
                progressText.textContent = '30%';
                progressMessage.textContent = '正在提取图片...';
                
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                console.log('工作表内容keys:', worksheet ? Object.keys(worksheet) : '无');
                console.log('worksheet是否有!images:', worksheet && worksheet['!images'] ? '是' : '否');
                
                let images = extractImagesFromWorkbook(workbook, worksheet);
                let imageCellMap = {};
                if (images.length === 0) {
                    console.log('传统方式未找到图片，尝试JSZip方式...');
                    const result = await extractImagesFromWorkbookZip(file);
                    images = result.images;
                    imageCellMap = result.imageCellMap || {};
                }
                
                console.log('提取到的图片数量:', images.length);
                console.log('图片单元格映射:', imageCellMap);
                
                if (images.length > 0) {
                    console.log('开始压缩图片以适应存储限制...');
                    images = await processAndCompressImages(images);
                }
                console.log('workbook结构:', Object.keys(workbook));
                console.log('是否有xl/media:', !!workbook['xl/media']);
                
                progressBar.style.width = '40%';
                progressText.textContent = '40%';
                progressMessage.textContent = `找到 ${images.length} 张图片，正在解析数据...`;
                
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const rows = XLSX.utils.sheet_to_json(worksheet);
                progressBar.style.width = '50%';
                progressText.textContent = '50%';
                progressMessage.textContent = '正在处理商品数据...';
                
                await new Promise(resolve => setTimeout(resolve, 50));
                
                let addedCount = 0;
                let updatedCount = 0;
                const batchSize = 10;
                const totalRows = rows.length;
                const usedImages = new Set();
                const skusWithoutImages = [];
                const validSkuRows = rows.filter(row => {
                    const sku = (row['SKU'] || row['sku'] || row['编码'] || '').toString().trim().toUpperCase();
                    return sku && sku !== '';
                });
                
                console.log(`数据行数: ${rows.length}`);
                console.log(`有效SKU行数: ${validSkuRows.length}`);
                console.log(`图片数量: ${images.length}`);
                
                if (images.length !== validSkuRows.length) {
                    console.warn(`⚠️ 图片数量(${images.length})与有效SKU行数(${validSkuRows.length})不一致！`);
                }
                
                for (let start = 0; start < totalRows; start += batchSize) {
                    const end = Math.min(start + batchSize, totalRows);
                    
                    for (let i = start; i < end; i++) {
                        const row = rows[i];
                        const sku = (row['SKU'] || row['sku'] || row['编码'] || '').toString().trim().toUpperCase();
                        if (!sku) continue;
                        
                        const name = row['名称'] || row['name'] || row['商品名称'] || row['中文名称'] || '';
                        const stock = parseInt(row['库存'] || row['stock'] || row['数量'] || 0);
                        const priceCny = parseFloat(row['人民币价格'] || row['priceCny'] || row['采购价'] || 0);
                        const priceUsd = parseFloat(row['美金价格'] || row['priceUsd'] || row['美元价格'] || 0);
                        
                        let imageBase64 = '';
                        let matchedImageIndex = -1;
                        
                        if (row['图片'] || row['image'] || row['Image']) {
                            const imageCell = row['图片'] || row['image'] || row['Image'];
                            if (typeof imageCell === 'string' && imageCell.startsWith('data:image')) {
                                imageBase64 = imageCell;
                                console.log(`行 ${i+1} SKU: ${sku} - 使用单元格中的Base64图片`);
                            }
                        }
                        
                        // 先尝试通过imageCellMap进行单元格位置匹配（更精确）
                        if (!imageBase64 && imageCellMap && Object.keys(imageCellMap).length > 0) {
                            const rowNum = i + 2; // Excel行号（从2开始，因为第1行是表头）
                            const possibleCells = [`B${rowNum}`, `C${rowNum}`, `D${rowNum}`, `E${rowNum}`, `F${rowNum}`, `G${rowNum}`];
                            
                            for (const cell of possibleCells) {
                                const embedIds = imageCellMap[cell];
                                if (embedIds) {
                                    const embedIdList = Array.isArray(embedIds) ? embedIds : [embedIds];
                                    for (const embedId of embedIdList) {
                                        const cleanedEmbedId = embedId.replace('rId', '');
                                        const matchedImage = images.find(img => img.path && (img.path.includes(cleanedEmbedId) || img.path.includes(embedId)));
                                        if (matchedImage) {
                                            imageBase64 = matchedImage.base64;
                                            matchedImageIndex = images.indexOf(matchedImage);
                                            if (matchedImageIndex >= 0) usedImages.add(matchedImageIndex);
                                            console.log(`行 ${i+1} SKU: ${sku} - 通过单元格 ${cell} 匹配到图片`);
                                            break;
                                        }
                                    }
                                    if (imageBase64) break;
                                }
                            }
                        }
                        
                        // 只有在没有单元格映射且图片数量完全匹配SKU数量时，才使用行顺序匹配
                        if (!imageBase64 && images.length > 0 && (!imageCellMap || Object.keys(imageCellMap).length === 0)) {
                            if (images.length === validSkuRows.length) {
                                if (images[i]) {
                                    imageBase64 = images[i].base64 || images[i];
                                    matchedImageIndex = i;
                                    usedImages.add(i);
                                    console.log(`行 ${i+1} SKU: ${sku} - 按精确行顺序匹配图片`);
                                }
                            } else {
                                console.log(`行 ${i+1} SKU: ${sku} - 图片数量(${images.length})与SKU数量(${validSkuRows.length})不匹配，不使用行顺序匹配防止错位`);
                            }
                        }
                        
                        console.log(`行 ${i+1}: SKU=${sku}, 图片匹配=${imageBase64 ? '成功' : '失败'}`);
                        
                        const existing = products.find(p => p.sku === sku);
                        if (existing) {
                            let hasChanges = false;
                            
                            if (name && name !== existing.name) {
                                existing.name = name;
                                hasChanges = true;
                            }
                            
                            if (!isNaN(stock) && stock !== existing.stock) {
                                existing.stock = stock;
                                existing.originalStock = stock;
                                hasChanges = true;
                            }
                            
                            if (!isNaN(priceCny) && priceCny !== existing.priceCny) {
                                existing.priceCny = priceCny;
                                hasChanges = true;
                            }
                            
                            if (!isNaN(priceUsd) && priceUsd !== existing.priceUsd) {
                                existing.priceUsd = priceUsd;
                                hasChanges = true;
                            }
                            
                            if (imageBase64 && (!existing.image || imageBase64 !== existing.image)) {
                                existing.image = imageBase64;
                                hasChanges = true;
                            }
                            
                            if (hasChanges) {
                                updatedCount++;
                            }
                        } else {
                            products.push({
                                sku: sku,
                                name: name,
                                stock: !isNaN(stock) ? stock : 0,
                                priceCny: !isNaN(priceCny) ? priceCny : 0,
                                priceUsd: !isNaN(priceUsd) ? priceUsd : 0,
                                image: imageBase64,
                                originalStock: !isNaN(stock) ? stock : 0
                            });
                            addedCount++;
                        }
                        
                        if (!imageBase64) {
                            skusWithoutImages.push(sku);
                        }
                    }
                    
                    const progress = 50 + (end / totalRows) * 40;
                    progressBar.style.width = `${progress}%`;
                    progressText.textContent = `${Math.round(progress)}%`;
                    progressMessage.textContent = `正在处理商品数据... (${end}/${totalRows})`;
                    
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
                
                const unmatchedImages = images.filter((img, index) => !usedImages.has(index));
                
                progressBar.style.width = '95%';
                progressText.textContent = '95%';
                progressMessage.textContent = '正在保存数据...';
                
                await new Promise(resolve => setTimeout(resolve, 50));
                
                updateProductList();
                updateProductListDisplay();
                
                const saveResult = await smartSaveProducts();
                
                progressBar.style.width = '100%';
                progressText.textContent = '100%';
                progressMessage.textContent = '导入完成！';
                
                await new Promise(resolve => setTimeout(resolve, 300));
                
                progressDiv.style.display = 'none';
                importBtn.disabled = false;
                fileInput.value = '';
                
                if (saveResult.success) {
                    let resultMsg = `导入完成！\n\n新增 ${addedCount} 条，更新 ${updatedCount} 条商品数据。\n\n`;
                    
                    if (unmatchedImages.length > 0) {
                        resultMsg += `⚠️ 有 ${unmatchedImages.length} 张图片未匹配到任何SKU\n`;
                    }
                    
                    if (skusWithoutImages.length > 0) {
                        resultMsg += `⚠️ 有 ${skusWithoutImages.length} 个SKU缺少图片\n`;
                    }
                    
                    alert(resultMsg);
                    
                    if (unmatchedImages.length > 0 || skusWithoutImages.length > 0) {
                        showImportReport(unmatchedImages, skusWithoutImages);
                    }
                } else {
                    alert(`❌ 保存失败！\n\n${saveResult.message}\n\n建议：\n1. 点击"清理缓存"释放空间\n2. 将文件拆分成更小的批次导入\n3. 在Excel中预先压缩图片`);
                }
            } catch (error) {
                console.error('导入失败详细错误:', error);
                progressDiv.style.display = 'none';
                importBtn.disabled = false;
                fileInput.value = '';
                
                let errorMessage = '❌ 导入失败！\n\n';
                errorMessage += '错误信息: ' + (error.message || '未知错误') + '\n\n';
                
                if (!file) {
                    errorMessage += '原因: 未选择文件\n';
                } else if (typeof XLSX === 'undefined') {
                    errorMessage += '原因: Excel解析库未加载\n';
                    errorMessage += '请刷新页面重试\n';
                } else {
                    errorMessage += '可能原因:\n';
                    errorMessage += '1. 文件可能已损坏\n';
                    errorMessage += '2. 文件正在被其他程序使用\n';
                    errorMessage += '3. Excel文件格式不标准\n\n';
                    errorMessage += '解决方法:\n';
                    errorMessage += '1. 关闭文件后重新打开\n';
                    errorMessage += '2. 重新保存为.xlsx/.xls/.xlsm格式\n';
                    errorMessage += '3. 尝试用Excel新建文件后复制数据\n';
                }
                
                alert(errorMessage);
            }
        }
        
        async function extractImagesFromWorkbookZip(file) {
            const images = [];
            const imageCellMap = {};
            const imageOrder = [];
            
            try {
                console.log('=== 使用JSZip提取图片 ===');
                const zip = await JSZip.loadAsync(file);
                console.log('ZIP文件结构:', Object.keys(zip.files));
                
                let relsMap = {};
                if (zip.files['xl/_rels/cellimages.xml.rels']) {
                    console.log('=== 尝试解析cellimages.xml.rels ===');
                    try {
                        const relsXml = await zip.files['xl/_rels/cellimages.xml.rels'].async('string');
                        console.log('cellimages.xml.rels内容:', relsXml.substring(0, 500) + '...');
                        
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(relsXml, 'text/xml');
                        const relElements = xmlDoc.getElementsByTagName('Relationship');
                        
                        for (let i = 0; i < relElements.length; i++) {
                            const rel = relElements[i];
                            const id = rel.getAttribute('Id');
                            const target = rel.getAttribute('Target');
                            if (id && target) {
                                relsMap[id] = target;
                                console.log(`关系 ${id} -> ${target}`);
                            }
                        }
                    } catch (e) {
                        console.log('解析cellimages.xml.rels失败:', e.message);
                    }
                }
                
                if (zip.files['xl/cellimages.xml']) {
                    console.log('=== 尝试解析cellimages.xml获取图片位置 ===');
                    try {
                        const cellImagesXml = await zip.files['xl/cellimages.xml'].async('string');
                        console.log('cellimages.xml内容:', cellImagesXml.substring(0, 800) + '...');
                        
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(cellImagesXml, 'text/xml');
                        
                        let cellImageElements = xmlDoc.getElementsByTagName('cellImage');
                        if (cellImageElements.length === 0) {
                            cellImageElements = xmlDoc.getElementsByTagNameNS('*', 'cellImage');
                        }
                        
                        console.log(`找到 ${cellImageElements.length} 个 cellImage 元素`);
                        
                        const imagePositions = [];
                        
                        for (let i = 0; i < cellImageElements.length; i++) {
                            const el = cellImageElements[i];
                            let blip = el.querySelector('blip');
                            if (!blip) {
                                blip = el.querySelector('xdr\\:blip') || el.querySelector('[*\\:embed]');
                            }
                            if (!blip) {
                                const allElements = el.getElementsByTagName('*');
                                for (let j = 0; j < allElements.length; j++) {
                                    const attr = allElements[j].getAttribute('r:embed');
                                    if (attr) {
                                        blip = allElements[j];
                                        break;
                                    }
                                }
                            }
                            
                            const embed = blip ? (blip.getAttribute('r:embed') || blip.getAttribute('embed')) : null;
                            
                            const xfrm = el.querySelector('xdr\\:xfrm') || el.querySelector('xfrm');
                            let yPos = 0;
                            if (xfrm) {
                                const off = xfrm.querySelector('a\\:off') || xfrm.querySelector('off');
                                if (off) {
                                    yPos = parseInt(off.getAttribute('y') || 0);
                                }
                            }
                            
                            if (embed && relsMap[embed]) {
                                const imagePath = relsMap[embed];
                                console.log(`图片 ${i+1}: ${embed} -> ${imagePath}, Y 位置：${yPos}`);
                                imagePositions.push({ embed, path: imagePath, index: i, yPos });
                            } else if (embed) {
                                console.log(`图片 ${i+1}: ${embed} -> 未找到映射，Y 位置：${yPos}`);
                            }
                        }
                        
                        console.log('按 Y 坐标排序前:', imagePositions.map(p => `图片${p.index+1}(Y=${p.yPos})`));
                        imagePositions.sort((a, b) => a.yPos - b.yPos);
                        console.log('按 Y 坐标排序后:', imagePositions.map(p => `图片${p.index+1}(Y=${p.yPos})`));
                        
                        for (let i = 0; i < imagePositions.length; i++) {
                            imageOrder.push(imagePositions[i]);
                        }
                        
                        // 检查xl/drawings/目录下是否有图片关联
                        let drawingsMap = {};
                        const drawingsPath = 'xl/drawings/_rels/drawing1.xml.rels';
                        if (zip.files[drawingsPath]) {
                            try {
                                const drawingsXml = await zip.files[drawingsPath].async('string');
                                const parser = new DOMParser();
                                const xmlDoc = parser.parseFromString(drawingsXml, 'text/xml');
                                const relElements = xmlDoc.getElementsByTagName('Relationship');
                                
                                for (let j = 0; j < relElements.length; j++) {
                                    const rel = relElements[j];
                                    const id = rel.getAttribute('Id');
                                    const target = rel.getAttribute('Target');
                                    if (id && target) {
                                        drawingsMap[id] = target;
                                    }
                                }
                                console.log('drawings关系映射:', drawingsMap);
                            } catch (e) {
                                console.log('解析drawings关系失败:', e.message);
                            }
                        }
                        
                        // 尝试从 xl/drawings/drawing1.xml 解析图片位置
                        if (zip.files['xl/drawings/drawing1.xml']) {
                            try {
                                const drawingXml = await zip.files['xl/drawings/drawing1.xml'].async('string');
                                console.log('找到 drawings/drawing1.xml，长度:', drawingXml.length);
                                
                                const parser = new DOMParser();
                                const xmlDoc = parser.parseFromString(drawingXml, 'text/xml');
                                
                                let anchorElements = xmlDoc.getElementsByTagName('xdr:anchor');
                                if (anchorElements.length === 0) anchorElements = xmlDoc.getElementsByTagName('anchor');
                                if (anchorElements.length === 0) anchorElements = xmlDoc.getElementsByTagNameNS('*', 'anchor');
                                
                                console.log(`找到 ${anchorElements.length} 个 anchor 元素`);
                                
                                for (let a = 0; a < anchorElements.length; a++) {
                                    const anchor = anchorElements[a];
                                    const fromEl = anchor.getElementsByTagName('xdr:from')[0] || anchor.getElementsByTagName('from')[0];
                                    
                                    if (fromEl) {
                                        const colEl = fromEl.getElementsByTagName('xdr:col')[0] || fromEl.getElementsByTagName('col')[0];
                                        const rowEl = fromEl.getElementsByTagName('xdr:row')[0] || fromEl.getElementsByTagName('row')[0];
                                        
                                        if (colEl && rowEl) {
                                            const col = parseInt(colEl.textContent || colEl.childNodes[0]?.textContent || '0');
                                            const row = parseInt(rowEl.textContent || rowEl.childNodes[0]?.textContent || '0');
                                            
                                            console.log(`Anchor ${a}: 列=${col}, 行=${row}`);
                                            
                                            // 查找所有blip元素（支持同一单元格有多个图片）
                                            const blipElements = [];
                                            const blipSelectors = ['xdr:blip', 'blip', '[*|blip]', 'a:blip', 'pic:blipFill a:blip'];
                                            for (const selector of blipSelectors) {
                                                const elements = anchor.querySelectorAll(selector);
                                                if (elements.length > 0) {
                                                    elements.forEach(el => blipElements.push(el));
                                                }
                                            }
                                            
                                            // 如果没找到，尝试更通用的方式
                                            if (blipElements.length === 0) {
                                                const allElements = anchor.getElementsByTagName('*');
                                                for (let e = 0; e < allElements.length; e++) {
                                                    if (allElements[e].tagName.toLowerCase().includes('blip')) {
                                                        blipElements.push(allElements[e]);
                                                    }
                                                }
                                            }
                                            
                                            if (blipElements.length > 0) {
                                                const cellRef = String.fromCharCode(65 + col) + (row + 2);
                                                
                                                for (const blipEl of blipElements) {
                                                    const embed = blipEl.getAttribute('r:embed') || blipEl.getAttribute('embed');
                                                    if (embed) {
                                                        // 支持同一单元格有多个图片，使用数组存储
                                                        if (!imageCellMap[cellRef]) {
                                                            imageCellMap[cellRef] = [];
                                                        }
                                                        if (!imageCellMap[cellRef].includes(embed)) {
                                                            imageCellMap[cellRef].push(embed);
                                                            console.log(`  -> 图片 ${embed} 关联到单元格 ${cellRef} (共${imageCellMap[cellRef].length}张)`);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log('解析drawing1.xml失败:', e.message);
                            }
                        }
                        
                        console.log('最终图片单元格映射:', JSON.stringify(imageCellMap));
                        console.log('总共有', images.length, '张图片将被匹配');
                    } catch (e) {
                        console.log('解析cellimages.xml失败:', e.message);
                    }
                }
                
                let mediaFiles = [];
                zip.forEach((relativePath, zipEntry) => {
                    console.log('检查文件:', relativePath);
                    if (relativePath.match(/xl\/media\/image/gi) || 
                        relativePath.match(/media\/image/gi)) {
                        const match = relativePath.match(/image(\d+)/i);
                        const index = match ? parseInt(match[1]) : 0;
                        mediaFiles.push({ path: relativePath, file: zipEntry, index: index });
                        console.log('  ✓ 找到媒体文件:', relativePath, '索引:', index);
                    }
                });
                
                console.log(`找到 ${mediaFiles.length} 个媒体文件（排序前）:`);
                mediaFiles.forEach(m => console.log(`  - ${m.path} (索引: ${m.index})`));
                
                // 不再按文件名排序，直接使用Excel原始顺序
                if (imageOrder.length > 0) {
                    console.log('=== 根据cellImage顺序重新排序图片 ===');
                    const orderedMedia = [];
                    for (const orderItem of imageOrder) {
                        const fullPath = 'xl/' + orderItem.path;
                        const media = mediaFiles.find(m => m.path === fullPath);
                        if (media) {
                            console.log(`  顺序 ${orderItem.index + 1}: ${media.path}`);
                            orderedMedia.push(media);
                        } else {
                            console.log(`  顺序 ${orderItem.index + 1}: 未找到 ${fullPath}`);
                        }
                    }
                    mediaFiles = orderedMedia;
                } else {
                    // 当无法获取单元格映射时，保持Excel原始顺序
                    console.log('=== 无法获取单元格映射，保持Excel原始顺序 ===');
                }
                
                console.log(`排序后:`);
                mediaFiles.forEach(m => console.log(`  - ${m.path} (索引: ${m.index})`));
                
                console.log(`图片-单元格映射:`, imageCellMap);
                console.log(`图片顺序:`, imageOrder);
                
                for (const media of mediaFiles) {
                    try {
                        const data = await media.file.async('base64');
                        const ext = media.path.split('.').pop().toLowerCase();
                        const mimeType = ext === 'png' ? 'image/png' : 
                                       ext === 'gif' ? 'image/gif' : 
                                       ext === 'bmp' ? 'image/bmp' : 'image/jpeg';
                        const base64 = `data:${mimeType};base64,${data}`;
                        images.push({ base64, path: media.path, index: media.index });
                        console.log(`  ✓ 提取成功: ${media.path}, 大小: ${data.length} 字符`);
                    } catch (e) {
                        console.log(`  ✗ ${media.path} 提取失败:`, e.message);
                    }
                }
            } catch (e) {
                console.log('JSZip解析失败:', e.message);
            }
            
            console.log(`=== 最终提取到 ${images.length} 张图片 ===`);
            return { images, imageCellMap };
        }
        
        async function compressImage(base64, maxWidth = 200, maxHeight = 200, quality = 0.4) {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > maxWidth || height > maxHeight) {
                        if (width > height) {
                            height = Math.round(height * maxWidth / width);
                            width = maxWidth;
                        } else {
                            width = Math.round(width * maxHeight / height);
                            height = maxHeight;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = () => resolve(base64);
                img.src = base64;
            });
        }
        
        async function processAndCompressImages(images) {
            console.log('=== 开始压缩处理图片 ===');
            const compressedImages = [];
            const maxSizeKB = 40; // 提高到40KB，让图片更清晰
            const targetWidth = 250; // 增大目标宽度
            const targetHeight = 250; // 增大目标高度
            
            for (let i = 0; i < images.length; i++) {
                const imgObj = images[i];
                const img = typeof imgObj === 'string' ? imgObj : imgObj.base64;
                const sizeKB = (img.length * 0.75) / 1024;
                console.log(`图片${i + 1}: ${sizeKB.toFixed(2)} KB`);
                
                // 所有图片都进行压缩，确保大小一致且符合存储限制
                console.log(`  开始压缩...`);
                let quality = 0.8; // 提高初始质量到0.8
                let compressed = await compressImage(img, targetWidth, targetHeight, quality);
                
                // 如果仍然过大，继续降低质量
                while ((compressed.length * 0.75 / 1024) > maxSizeKB && quality > 0.3) {
                    quality -= 0.05;
                    compressed = await compressImage(img, targetWidth, targetHeight, quality);
                }
                
                const newSizeKB = (compressed.length * 0.75) / 1024;
                console.log(`  压缩完成: ${newSizeKB.toFixed(2)} KB (质量: ${quality})`);
                
                if (typeof imgObj === 'string') {
                    compressedImages.push(compressed);
                } else {
                    compressedImages.push({ ...imgObj, base64: compressed });
                }
            }
            
            console.log(`=== 图片压缩处理完成 ===`);
            return compressedImages;
        }
        
        function extractImagesFromWorkbook(workbook, worksheet) {
            const images = [];
            
            if (!workbook || !worksheet) return images;
            
            console.log('=== 开始提取图片 (传统方式) ===');
            console.log('workbook结构:', Object.keys(workbook));
            
            if (worksheet['!images']) {
                console.log(`方式1: 找到worksheet["!images"]: ${worksheet['!images'].length} 张`);
                for (const img of worksheet['!images']) {
                    if (img.data) {
                        const mimeType = img.type === 'png' ? 'image/png' : 
                                       img.type === 'gif' ? 'image/gif' : 'image/jpeg';
                        try {
                            const base64 = arrayBufferToBase64(img.data);
                            images.push(`data:${mimeType};base64,${base64}`);
                            console.log(`  ✓ 提取成功，大小: ${base64.length} 字符`);
                        } catch (e) {
                            console.log('  ✗ 图片转换失败:', e.message);
                        }
                    } else if (img.src) {
                        console.log(`  ✓ 图片有src属性，长度: ${img.src.length}`);
                        images.push(img.src);
                    } else if (img._data) {
                        const mimeType = img.type === 'png' ? 'image/png' : 'image/jpeg';
                        try {
                            const base64 = arrayBufferToBase64(img._data);
                            images.push(`data:${mimeType};base64,${base64}`);
                            console.log(`  ✓ 从_data提取成功`);
                        } catch (e) {
                            console.log('  ✗ _data转换失败:', e.message);
                        }
                    }
                }
            }
            
            if (workbook.model && workbook.model.images) {
                const sheetIndex = workbook.SheetNames.indexOf(worksheet.name);
                if (sheetIndex >= 0 && workbook.model.images[sheetIndex]) {
                    console.log(`方式2: 找到workbook.model.images: ${workbook.model.images[sheetIndex].length} 张`);
                    for (const img of workbook.model.images[sheetIndex]) {
                        if (img.data) {
                            const mimeType = img.type === 'png' ? 'image/png' : 
                                           img.type === 'gif' ? 'image/gif' : 'image/jpeg';
                            try {
                                const base64 = arrayBufferToBase64(img.data);
                                images.push(`data:${mimeType};base64,${base64}`);
                            } catch (e) {
                                console.log('  ✗ 转换失败:', e.message);
                            }
                        }
                    }
                }
            }
            
            if (workbook['xl/media']) {
                console.log(`方式3: 找到xl/media文件夹: ${Object.keys(workbook['xl/media']).length} 个文件`);
                const mediaFolder = workbook['xl/media'];
                const sortedKeys = Object.keys(mediaFolder).sort((a, b) => {
                    const numA = parseInt(a.match(/\d+/)?.[0]) || 0;
                    const numB = parseInt(b.match(/\d+/)?.[0]) || 0;
                    return numA - numB;
                });
                for (const key of sortedKeys) {
                    if (key.startsWith('image')) {
                        const imageData = mediaFolder[key];
                        const ext = key.split('.').pop().toLowerCase();
                        const mimeType = ext === 'png' ? 'image/png' : 
                                       ext === 'gif' ? 'image/gif' : 
                                       ext === 'bmp' ? 'image/bmp' : 'image/jpeg';
                        try {
                            const base64 = arrayBufferToBase64(imageData);
                            images.push(`data:${mimeType};base64,${base64}`);
                            console.log(`  ✓ ${key} -> ${mimeType}, 大小: ${base64.length}`);
                        } catch (e) {
                            console.log(`  ✗ ${key} 转换失败:`, e.message);
                        }
                    }
                }
            }
            
            if (workbook.files) {
                console.log(`方式4: 找到workbook.files: ${Object.keys(workbook.files).length} 个文件`);
                for (const key of Object.keys(workbook.files)) {
                    if (key.includes('media/image') || key.includes('xl/media')) {
                        const imageData = workbook.files[key];
                        const ext = key.split('.').pop().toLowerCase();
                        const mimeType = ext === 'png' ? 'image/png' : 
                                       ext === 'gif' ? 'image/gif' : 'image/jpeg';
                        try {
                            const base64 = arrayBufferToBase64(imageData);
                            images.push(`data:${mimeType};base64,${base64}`);
                            console.log(`  ✓ ${key} -> ${mimeType}`);
                        } catch (e) {
                            console.log(`  ✗ ${key} 转换失败:`, e.message);
                        }
                    }
                }
            }
            
            if (workbook.Props && workbook.Props.images) {
                console.log(`方式5: 找到Props.images: ${workbook.Props.images.length} 张`);
                for (const img of workbook.Props.images) {
                    if (img.content) {
                        try {
                            images.push(img.content);
                        } catch (e) {
                            console.log('  ✗ 转换失败:', e.message);
                        }
                    }
                }
            }
            
            if (worksheet.images) {
                console.log(`方式6: 找到worksheet.images: ${worksheet.images.length} 张`);
                for (const img of worksheet.images) {
                    if (img.data) {
                        const mimeType = img.format === 'png' ? 'image/png' : 'image/jpeg';
                        try {
                            const base64 = arrayBufferToBase64(img.data);
                            images.push(`data:${mimeType};base64,${base64}`);
                        } catch (e) {
                            console.log('  ✗ 转换失败:', e.message);
                        }
                    }
                }
            }
            
            console.log(`=== 最终提取到 ${images.length} 张图片 ===`);
            return images;
        }
        
        function arrayBufferToBase64(buffer) {
            if (buffer instanceof ArrayBuffer) {
                return btoa(String.fromCharCode(...new Uint8Array(buffer)));
            } else if (buffer instanceof Uint8Array) {
                return btoa(String.fromCharCode(...buffer));
            } else if (Array.isArray(buffer)) {
                return btoa(String.fromCharCode(...buffer));
            } else if (typeof buffer === 'string') {
                return buffer;
            }
            return '';
        }
        
        function getStorageUsed() {
            // 纯云端: 无存储限制
            return 0;
        }
        

        async function clearStorage() {
            if (confirm('⚠️ 确定要清空所有数据吗？\n此操作不可恢复！')) {
                products = [];
                orders = [];
                comboSkus = [];
                try {
                    await client.db.from('products').delete().neq('id', 0);
                    await client.db.from('orders').delete().neq('id', 0);
                    await client.db.from('combo_skus').delete().neq('id', 0);
                    await client.db.from('live_sessions').delete().neq('id', 0);
                } catch(e) { console.error('清空云端失败:', e); }
            }
        }
        
        async function deleteAllProducts() {
            if (products.length === 0) {
                alert('当前没有商品可删除！');
                return;
            }
            
            const firstConfirm = confirm(`⚠️ 警告！\n\n您即将删除全部 ${products.length} 个商品，此操作不可撤销！\n\n确定要继续吗？`);
            
            if (!firstConfirm) return;
            
            const secondConfirm = confirm(`🔴 再次确认！\n\n您确定要删除全部 ${products.length} 个商品吗？\n\n此操作将永久删除所有商品数据，包括图片！\n\n请输入 "删除" 两个字确认：`);
            
            if (!secondConfirm) return;
            
            const confirmText = prompt('请输入 "删除" 两个字确认删除所有商品：');
            
            if (confirmText === '删除') {
                const deletedCount = products.length;
                products = [];
                productImagesCache = {};
                
                updateProductList();
                updateProductListDisplay();
                updateProductStats();
                
                alert(`✅ 已成功删除全部 ${deletedCount} 个商品！`);
            } else {
                alert('❌ 输入不正确，操作已取消！');
            }
        }
        
        function updateLastImportTime() {
            const el = document.getElementById('lastImportTimeValue');
            if (el) {
                el.textContent = products.length > 0 ? '云端加载' : '从未导入';
            }
        }

        // ====== 批量编辑 ======
        let batchSelectedSkus = new Set();

        function closeModal(id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        }

        // 进入批量选择模式 - 给每个商品加复选框
        function enterBatchSelectMode() {
            batchSelectedSkus = new Set();
            const container = document.getElementById('productList');
            if (!container) return;

            // 给所有商品项加复选框
            container.querySelectorAll('[data-sku]').forEach(el => {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'batch-select-cb';
                cb.style.marginRight = '8px';
                cb.style.width = '16px';
                cb.style.height = '16px';
                cb.style.cursor = 'pointer';
                cb.dataset.sku = el.dataset.sku;
                cb.onchange = function() {
                    if (this.checked) {
                        batchSelectedSkus.add(this.dataset.sku);
                    } else {
                        batchSelectedSkus.delete(this.dataset.sku);
                    }
                    updateBatchButton();
                };
                el.insertBefore(cb, el.firstChild);
            });

            document.getElementById('batchEditBtn').style.display = 'inline-block';
            document.getElementById('batchSelectCancel').style.display = 'inline-block';
            updateBatchButton();
        }

        function exitBatchSelectMode() {
            batchSelectedSkus = new Set();
            document.querySelectorAll('.batch-select-cb').forEach(cb => cb.remove());
            document.getElementById('batchEditBtn').style.display = 'none';
            document.getElementById('batchSelectCancel').style.display = 'none';
        }

        function updateBatchButton() {
            const btn = document.getElementById('batchEditBtn');
            if (!btn) return;
            btn.textContent = `✏️ 批量编辑 (${batchSelectedSkus.size})`;
            if (batchSelectedSkus.size === 0) {
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }

        function openBatchEditModal() {
            if (batchSelectedSkus.size === 0) {
                alert('请先勾选要编辑的商品');
                return;
            }

            // 清空表单
            document.getElementById('batchEditStock').value = '';
            document.getElementById('batchEditPriceCny').value = '';
            document.getElementById('batchEditPriceUsd').value = '';
            document.getElementById('batchEditSkuList').value = '';
            document.getElementById('batchEditResult').innerHTML = '';

            // 显示选中商品信息
            document.getElementById('batchEditInfo').innerHTML =
                `<div>已选中 <strong style="color:#667eea;">${batchSelectedSkus.size}</strong> 个商品</div>
                <div style="font-size:11px;margin-top:4px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${Array.from(batchSelectedSkus).slice(0, 5).join(', ')}${batchSelectedSkus.size > 5 ? '...' : ''}
                </div>`;

            document.getElementById('batchEditModal').style.display = 'flex';
        }

        async function applyBatchEdit() {
            const stockVal = document.getElementById('batchEditStock').value;
            const priceCnyVal = document.getElementById('batchEditPriceCny').value;
            const priceUsdVal = document.getElementById('batchEditPriceUsd').value;
            const extraSkus = document.getElementById('batchEditSkuList').value.trim();

            const hasStock = stockVal !== '';
            const hasCny = priceCnyVal !== '';
            const hasUsd = priceUsdVal !== '';

            if (!hasStock && !hasCny && !hasUsd) {
                document.getElementById('batchEditResult').innerHTML = '<div style="color:#f44336;">请至少填写一个要修改的字段</div>';
                return;
            }

            // 收集目标SKU
            const targetSkus = new Set(batchSelectedSkus || []);
            if (extraSkus) {
                extraSkus.split('\n').map(s => s.trim()).filter(Boolean).forEach(s => targetSkus.add(s));
            }

            if (targetSkus.size === 0) {
                document.getElementById('batchEditResult').innerHTML = '<div style="color:#f44336;">没有要编辑的SKU</div>';
                return;
            }

            const resultEl = document.getElementById('batchEditResult');
            resultEl.innerHTML = '<div style="color:#667eea;">⏳ 正在保存...</div>';

            let updated = 0;
            const errors = [];

            targetSkus.forEach(sku => {
                const idx = products.findIndex(p => p.sku === sku);
                if (idx === -1) {
                    errors.push(`未找到 SKU: ${sku}`);
                    return;
                }
                if (hasStock) products[idx].stock = parseInt(stockVal) || 0;
                if (hasCny) products[idx].price_cny = parseFloat(priceCnyVal) || 0;
                if (hasUsd) products[idx].price_usd = parseFloat(priceUsdVal) || 0;
                updated++;
            });

            try {
                await saveProducts();
                updateProductList();
                exitBatchSelectMode();
                resultEl.innerHTML =
                    `<div style="color:#4CAF50;">✅ 成功更新 ${updated} 个商品${errors.length ? '，${errors.length} 个失败' : ''}</div>` +
                    (errors.length > 0 ? errors.map(e => `<div style="color:#f44336;font-size:11px;">${e}</div>`).join('') : '');

                // 2秒后关闭
                setTimeout(() => {
                    const modal = document.getElementById('batchEditModal');
                    if (modal) modal.style.display = 'none';
                }, 2000);
            } catch (e) {
                resultEl.innerHTML = `<div style="color:#f44336;">❌ 保存失败: ${e.message}</div>`;
            }
        }

        // 给每个商品项加 data-sku 属性（修改 displayProductList 中的元素创建）
        // 钩子: 在渲染每个商品项时加 data-sku
