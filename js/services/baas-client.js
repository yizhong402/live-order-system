// baas-client.js

        function imgUrl(img) {
            return typeof img === 'string' ? img : (img && img.url ? img.url : '');
        }

        // 辅助：上传base64图片到云端
        async function uploadImageBase64(base64Data) {
            if (!base64Data || !base64Data.startsWith('data:')) return base64Data;
            try {
                const arr = base64Data.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) { u8arr[n] = bstr.charCodeAt(n); }
                const blob = new Blob([u8arr], { type: mime });
                const file = new File([blob], 'product.jpg', { type: mime });
                const formData = new FormData();
                formData.append('file', file);
                const resp = await fetch(CLOUD_UPLOAD_URL, {
                    method: 'POST',
                    headers: { 'CODE_FLYING': CLOUD_API_KEY },
                    body: formData
                });
                const result = await resp.json();
                return result.success && result.data ? result.data.url : base64Data;
            } catch(e) {
                console.error('图片上传失败:', e);
                return base64Data;
            }
        }

        // ===== 云端数据辅助函数 =====
        const TABLE_MAP = {
            'products': 'products', 'orders': 'orders', 'comboSkus': 'combo_skus',
            'liveHistory': 'live_sessions',
            'titleHistory': 'title_history',
            'titleRoundMap': 'title_round_map'
        };
        function getTableName(s) { return TABLE_MAP[s] || s; }

        // 纯云端，所有操作直接走 BaaS

        async function migrateFromLocalStorage() {
            try {
                const pRes = await client.db.from('products').list();
                if (pRes.success) products = (pRes.data || []).map(p => ({
                    baasId: p.id,
                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                    priceCny: Number(p.price_cny) / 100 || 0, priceUsd: Number(p.price_usd) / 100 || 0,
                    originalStock: p.original_stock || p.stock || 0, image: p.image_url || '', image_url: p.image_url || ''
                }));

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
                        sessionAnchor: o.session_anchor || '',
                        timestamp: o.created_at ? o.created_at.replace('T',' ').substring(0,19) : new Date().toLocaleString('zh-CN'),
                        isOverSold: false
                    };});
                }

                const hRes = await client.db.from('live_sessions').list().order('created_at', 'desc');
                if (hRes.success) liveHistory = hRes.data || [];

                const cRes = await client.db.from('combo_skus').list();
                if (cRes.success) comboSkus = (cRes.data || []).map(c => ({
                    code: c.code, skus: typeof c.skus_json === 'string' ? JSON.parse(c.skus_json) : (c.skus_json || [])
                }));

                const tRes = await client.db.from('title_history').list();
                if (tRes.success) titleHistory = (tRes.data || []).map(t => t.title).filter(Boolean);

                const mRes = await client.db.from('title_round_map').list();
                if (mRes.success) { mRes.data.forEach(m => { titleRoundMap[m.title] = m.round_value; }); }

                // 修复历史数据：将orders中时间戳sessionId映射到BaaS的session.id
                (hRes.data || []).forEach(function(s) {
                    if (s.client_id) {
                        orders.forEach(function(o) {
                            if (o.sessionId == s.client_id) {
                                o.sessionId = s.id;
                            }
                        });
                    }
                });
                // 再修复没有client_id的老数据：按title+date+anchor匹配
                (hRes.data || []).forEach(function(s) {
                    orders.forEach(function(o) {
                        if (o.sessionId && typeof o.sessionId !== 'number' && o.sessionId > 1000000000000) {
                            // 仍然是大时间戳，尝试复合匹配
                            if (o.sessionDate === s.date && o.sessionAnchor === s.anchor && s.title && s.title.includes(o.sessionAnchor || '')) {
                                o.sessionId = s.id;
                            }
                        }
                    });
                });

                console.log('☁️ 云端数据加载完成');
            } catch(e) {
                console.error('☁️ 云端加载失败:', e);
            }
        }
        
        async function saveProductsToCloud() {
            // 纯云端: 直接将商品数据保存到云端 BaaS
            console.log('☁️ 保存商品到云端...');
            updateProductListDisplay();
            // 同步dirty商品到BaaS
            var skus = Object.keys(_dirtyProducts);
            if (skus.length === 0) return { success: true, message: '无变化' };
            skus.forEach(function(sku) {
                var p = products.find(function(x) { return x.sku === sku; });
                if (!p || !p.baasId) return;
                client.db.from('products').update(p.baasId, {
                    stock: p.stock,
                    price_cny: Math.round(p.priceCny * 100),
                    price_usd: Math.round(p.priceUsd * 100),
                    original_stock: p.originalStock || p.stock
                }).then(null, function(e) { console.error('☁️ 商品保存失败:', sku, e); });
            });
            _dirtyProducts = {};
            return { success: true, message: '保存成功' };
        }
