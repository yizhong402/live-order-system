// combo.js

        function updateComboListDisplay() {
            const listEl = document.getElementById('comboListDisplay');
            if (!listEl) {
                return; // 如果元素不存在，直接返回
            }
            
            const searchInput = document.getElementById('comboSearchSide');
            const keyword = searchInput ? searchInput.value.trim().toUpperCase() : '';
            
            let displayCombos = comboSkus || [];
            
            if (keyword) {
                displayCombos = displayCombos.filter(combo => {
                    return combo.code.toUpperCase().includes(keyword) ||
                           combo.skus.some(skuItem => skuItem.sku.toUpperCase().includes(keyword));
                });
            }
            
            if (displayCombos.length === 0) {
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">' + (keyword ? '没有找到匹配的组合' : '暂无组合') + '</div>';
                return;
            }
            
            listEl.innerHTML = displayCombos.map(combo => {
                let totalCny = 0;
                let totalUsd = 0;
                combo.skus.forEach(skuItem => {
                    const product = products.find(p => p.sku === skuItem.sku);
                    if (product) {
                        totalCny += parseFloat(product.priceCny) * skuItem.quantity;
                        totalUsd += parseFloat(product.priceUsd) * skuItem.quantity;
                    }
                });
                
                return `
                <div class="product-item" style="flex-wrap:wrap;">
                    <div style="flex:1;min-width:200px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-weight:bold;">${combo.code}</span>
                            <div style="display:flex;gap:8px;">
                                <span style="background:#10b981;color:white;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:bold;">¥${totalCny.toFixed(2)}</span>
                                <span style="background:#6366f1;color:white;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:bold;">$${totalUsd.toFixed(2)}</span>
                            </div>
                        </div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.6);">
                            SKU: ${combo.skus.join(', ')}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${combo.skus.map(sku => {
                            const product = products.find(p => p.sku === sku);
                            return `
                            <div style="display:flex;align-items:center;gap:5px;font-size:12px;">
                                ${product && product.image ? `<img src="${product.image}" style="width:20px;height:20px;object-fit:cover;border-radius:3px;">` : '<div style="width:20px;height:20px;background:rgba(255,255,255,0.1);border-radius:3px;"></div>'}
                                <span>${sku}</span>
                            </div>
                        `;
                        }).join('')}
                    </div>
                    <div style="display:flex;gap:8px;margin-top:10px;width:100%;">
                        <button class="btn btn-success" style="padding:4px 10px;font-size:12px;" onclick="applyCombo('${combo.code}');showPage('order');">应用</button>
                        <button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="editCombo('${combo.code}')">✏️ 编辑</button>
                        <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="removeComboByCode('${combo.code}')">删除</button>
                    </div>
                </div>
            `;
            }).join('');
        }
        
        let editingComboCode = null;
        let currentComboSkus = [];
        
        function editCombo(code) {
            const combo = comboSkus.find(c => c.code === code);
            if (!combo) return;
            
            editingComboCode = code;
            currentComboSkus = [...combo.skus];
            
            document.getElementById('editComboCode').value = code;
            updateEditComboSkus();
            document.getElementById('comboEditModal').style.display = 'flex';
        }
        
        function closeComboEditModal() {
            document.getElementById('comboEditModal').style.display = 'none';
            editingComboCode = null;
            currentComboSkus = [];
        }
        
        function addEditComboSku() {
            const skuInput = document.getElementById('editComboSkuInput');
            const sku = skuInput.value.trim().toUpperCase();
            if (!sku) return;
            
            if (!currentComboSkus.includes(sku)) {
                currentComboSkus.push(sku);
                updateEditComboSkus();
            }
            
            skuInput.value = '';
            skuInput.focus();
        }
        
        function updateEditComboSkus() {
            const listEl = document.getElementById('editComboSkus');
            if (currentComboSkus.length === 0) {
                listEl.innerHTML = '<div style="padding:10px;text-align:center;color:rgba(255,255,255,0.4);">暂无 SKU</div>';
                return;
            }
            
            listEl.innerHTML = currentComboSkus.map((sku, index) => {
                const product = products.find(p => p.sku === sku);
                return `
                <div class="product-item">
                    ${product && product.image ? `<img src="${product.image}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">` : '<div style="width:40px;height:40px;background:rgba(255,255,255,0.1);border-radius:4px;"></div>'}
                    <div style="flex:1;">
                        <div style="font-weight:bold;color:#fff;">${sku}</div>
                        ${product ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);">库存：${product.stock}</div>` : ''}
                    </div>
                    <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="removeEditComboSku(${index})">删除</button>
                </div>
            `;
            }).join('');
        }
        
        function removeEditComboSku(index) {
            currentComboSkus.splice(index, 1);
            updateEditComboSkus();
        }
        
        function saveEditCombo() {
            if (!editingComboCode) return;
            
            const combo = comboSkus.find(c => c.code === editingComboCode);
            if (combo) {
                combo.skus = currentComboSkus;
                saveCombos();
                closeComboEditModal();
                alert('组合已更新！');
            }
        }
        
        function removeComboByCode(code) {
            if (confirm(`确定要删除组合 ${code} 吗？`)) {
                comboSkus = comboSkus.filter(c => c.code !== code);
                saveCombos();
            }
        }
        
        function closeComboModal() {
            showPage('home');
        }
        
        let tempComboSkus = [];
        
        function openComboModal() {
            tempComboSkus = [];
            document.getElementById('comboCode').value = '';
            document.getElementById('comboSkuInput').value = '';
            updateCurrentComboSkus();
            updateComboList();
            showPage('combo');
        }
        
        function updateCurrentComboSkus() {
            const listEl = document.getElementById('currentComboSkus');
            if (tempComboSkus.length === 0) {
                listEl.innerHTML = '<div style="padding:10px;text-align:center;color:rgba(255,255,255,0.4);">暂无 SKU，请扫描添加</div>';
                return;
            }
            
            listEl.innerHTML = tempComboSkus.map((sku, index) => {
                const product = products.find(p => p.sku === sku);
                return `
                <div class="product-item">
                    ${product && product.image ? `<img src="${product.image}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">` : '<div style="width:40px;height:40px;background:rgba(255,255,255,0.1);border-radius:4px;"></div>'}
                    <div style="flex:1;">
                        <div style="font-weight:bold;">${sku}</div>
                        ${product ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);">库存：${product.stock}</div>` : ''}
                    </div>
                    <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="removeTempComboSku(${index})">删除</button>
                </div>
            `;
            }).join('');
        }
        
        function searchCombo() {
            const searchInput = document.getElementById('comboSearch');
            const keyword = searchInput.value.trim().toUpperCase();
            const resultDiv = document.getElementById('comboSearchResult');
            
            if (!keyword) {
                resultDiv.style.display = 'none';
                resultDiv.innerHTML = '';
                return;
            }
            
            const matchedCombos = comboSkus.filter(combo => {
                return combo.code.toUpperCase().includes(keyword) ||
                       combo.skus.some(skuItem => skuItem.sku.toUpperCase().includes(keyword));
            });
            
            if (matchedCombos.length === 0) {
                resultDiv.style.display = 'none';
                resultDiv.innerHTML = '';
                return;
            }
            
            resultDiv.style.display = 'block';
            
            let html = '<div style="font-weight:bold;color:#10b981;margin-bottom:10px;">🔍 找到 ' + matchedCombos.length + ' 个匹配的组合：</div>';
            
            matchedCombos.forEach(combo => {
                let totalCny = 0;
                let totalUsd = 0;
                
                combo.skus.forEach(skuItem => {
                    const product = products.find(p => p.sku === skuItem.sku);
                    if (product) {
                        totalCny += parseFloat(product.priceCny) * skuItem.quantity;
                        totalUsd += parseFloat(product.priceUsd) * skuItem.quantity;
                    }
                });
                
                html += `
                    <div style="border-bottom:1px solid rgba(255,255,255,0.1);padding:10px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <span style="font-weight:bold;font-size:16px;">${combo.code}</span>
                            <div style="display:flex;gap:10px;">
                                <span style="background:#10b981;color:white;padding:4px 10px;border-radius:6px;font-weight:bold;">¥${totalCny.toFixed(2)}</span>
                                <span style="background:#6366f1;color:white;padding:4px 10px;border-radius:6px;font-weight:bold;">$${totalUsd.toFixed(2)}</span>
                                <button class="btn btn-success" style="padding:4px 12px;font-size:12px;" onclick="applyCombo('${combo.code}');showPage('order');">应用</button>
                                <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="editCombo('${combo.code}');">编辑</button>
                            </div>
                        </div>
                        <div style="display:flex;flex-wrap:gap:10px;">
                `;
                
                combo.skus.forEach(skuItem => {
                    const product = products.find(p => p.sku === skuItem.sku);
                    html += `
                        <div style="display:flex;align-items:center;gap:8px;margin:5px 10px 5px 0;padding:6px 10px;background:rgba(255,255,255,0.05);border-radius:6px;">
                            ${product && product.image ? `<img src="${product.image}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;">` : '<div style="width:30px;height:30px;background:rgba(255,255,255,0.1);border-radius:4px;"></div>'}
                            <div>
                                <div style="font-weight:bold;font-size:13px;">${skuItem.sku}</div>
                                ${product ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);">¥${product.priceCny} x${skuItem.quantity}</div>` : ''}
                            </div>
                        </div>
                    `;
                });
                
                html += `</div></div>`;
            });
            
            resultDiv.innerHTML = html;
        }
        
        function addComboSku() {
            const skuInput = document.getElementById('comboSkuInput');
            const sku = skuInput.value.trim().toUpperCase();
            if (!sku) return;
            
            if (!tempComboSkus.includes(sku)) {
                tempComboSkus.push(sku);
                updateCurrentComboSkus();
            }
            
            skuInput.value = '';
            skuInput.focus();
        }
        
        function removeTempComboSku(index) {
            tempComboSkus.splice(index, 1);
            updateCurrentComboSkus();
        }
        
        function saveCombo() {
            const code = document.getElementById('comboCode').value.trim().toUpperCase();
            
            if (!code) {
                alert('请输入组合编码！');
                return;
            }
            if (tempComboSkus.length === 0) {
                alert('请至少添加一个 SKU！');
                return;
            }
            
            const existing = comboSkus.find(c => c.code === code);
            if (existing) {
                existing.skus = [...tempComboSkus]; // 创建副本，避免引用问题
            } else {
                comboSkus.push({ code: code, skus: [...tempComboSkus] }); client.db.from("combo_skus").insert().values({ code: code, skus_json: JSON.stringify(tempComboSkus) }).catch(e=>{}); // 创建副本
            }
            
            saveCombos();
            updateComboList();
            tempComboSkus = [];
            document.getElementById('comboCode').value = '';
            document.getElementById('comboSkuInput').value = '';
            updateCurrentComboSkus();
            alert('组合已保存！');
        }
        
        function updateComboList() {
            const listEl = document.getElementById('comboList');
            if (comboSkus.length === 0) {
                listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);">暂无组合</div>';
                return;
            }
            
            listEl.innerHTML = comboSkus.map((combo, index) => `
                <div style="margin:8px 0;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <strong style="color:#fff;">${combo.code}</strong>
                        <div style="display:flex;gap:8px;">
                            <button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="editCombo('${combo.code}')">✏️ 编辑</button>
                            <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="removeCombo(${index})">删除</button>
                        </div>
                    </div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:5px;">
                        SKU: ${combo.skus.join(', ')}
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                        ${combo.skus.map(sku => {
                            const product = products.find(p => p.sku === sku);
                            return `
                            <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:#fff;">
                                ${product && product.image ? `<img src="${product.image}" style="width:20px;height:20px;object-fit:cover;border-radius:3px;">` : '<div style="width:20px;height:20px;background:rgba(255,255,255,0.1);border-radius:3px;"></div>'}
                                <span>${sku}</span>
                            </div>
                        `;
                        }).join('')}
                    </div>
                    <button class="btn btn-success" style="margin-top:10px;padding:6px 16px;font-size:13px;" onclick="applyCombo('${combo.code}');showPage('order');">📦 应用此组合</button>
                </div>
            `).join('');
        }
        
        function removeCombo(index) {
            comboSkus.splice(index, 1);
            updateComboList();
            updateComboListDisplay();
            saveCombos();
        }
        
        function saveCombos() { /* 云端自动保存 */ }
        
        function loadCombos() {
        }
        

        
        function applyCombo(code) {
            const combo = comboSkus.find(c => c.code === code);
            if (!combo) return;
            
            combo.skus.forEach(sku => {
                const product = products.find(p => p.sku === sku);
                if (!product) {
                    alert(`⚠️ SKU ${sku} 不存在于商品库中！`);
                    return;
                }
                if (product.stock <= 0) {
                    alert(`🚨 SKU ${sku} 已售罄！`);
                    return;
                }
                
                if (currentSkus[sku]) {
                    currentSkus[sku]++;
                } else {
                    currentSkus[sku] = 1;
                }
                
                product.stock--;
                
                if (product.stock < 3 && product.stock > 0) {
                    alert(`⚠️ ${sku} 即将售罄！剩余库存: ${product.stock}`);
                }
            });
            
            updateSkuList();
            saveProducts();
            updateQuickComboList(); // 更新快速选择列表
            showPage('order');
            
            const indicator = document.getElementById('scanIndicator');
            indicator.innerHTML = `<p style="color:#10b981;">✅ 组合 ${code} 已应用！</p>`;
            indicator.classList.add('active');
            setTimeout(() => {
                indicator.classList.remove('active');
                indicator.innerHTML = '<p>🎯 准备好扫码枪，将光标放在输入框中扫描</p>';
            }, 2000);
        }
