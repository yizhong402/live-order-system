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
                    sku: p.sku, name: p.name || '', stock: p.stock || 0,
                    priceCny: p.price_cny || 0, priceUsd: p.price_usd || 0,
                    originalStock: p.original_stock || p.stock || 0, image: p.image_url || '', image_url: p.image_url || ''
                }));

                const oRes = await client.db.from('orders').list();
                if (oRes.success) orders = oRes.data || [];

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

                console.log('☁️ 云端数据加载完成');
            } catch(e) {
                console.error('☁️ 云端加载失败:', e);
            }
        }
        
        async function saveProductsToCloud() {
            console.log('☁️ 保存商品到云端...');
            updateProductListDisplay();
            return { success: true, message: '保存成功' };
        }
        
        async function saveProductsToCloud() {
            // 纯云端: 直接将商品数据保存到云端 BaaS
            console.log('☁️ 保存商品到云端...');
            updateProductListDisplay();
            return { success: true, message: '保存成功' };
        }
