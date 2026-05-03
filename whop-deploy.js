// /api/whop-deploy.js — GGX AUTO-FORGE V3.0 FIXED
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST requis' });

  // ✅ FIX 1 — v2 est l'API stable pour créer des produits
  const WHOP_BASE = 'https://api.whop.com/api/v2';

  const body = req.body || {};

  // ============================================================
  //  MODE DIAGNOSTIC
  // ============================================================
  if (body.diagMode === 'ping') {
    const directKey  = body.apiKey;
    const apiKeyName = body.apiKeyName;
    const keyToCheck = directKey || (apiKeyName ? process.env[apiKeyName] : null) || process.env.WHOP_API_KEY;
    const companyId  = process.env.WHOP_COMPANY_ID;

    if (directKey && companyId) {
      try {
        // ✅ FIX 2 — Diagnostic teste l'endpoint correct avec company_id dans l'URL
        const testRes  = await fetch(`${WHOP_BASE}/companies/${companyId}/products?limit=1`, {
          headers: { 'Authorization': `Bearer ${directKey}` }
        });
        const testData = await testRes.json().catch(() => ({}));
        return res.status(200).json({
          diagPong:       true,
          keyFound:       testRes.ok,
          companyIdFound: !!companyId,
          company_id:     companyId,
          whop_status:    testRes.status,
          error:          testRes.ok ? undefined : `Clé rejetée: ${testData?.message || testRes.status}`,
        });
      } catch(e) {
        return res.status(200).json({ diagPong: true, keyFound: false, error: e.message });
      }
    }

    return res.status(200).json({
      diagPong:       true,
      keyFound:       !!keyToCheck,
      companyIdFound: !!companyId,
      keyName:        apiKeyName || 'WHOP_API_KEY',
    });
  }

  // ============================================================
  //  MODE NORMAL
  // ============================================================
  const { payload, apiKeyName } = body;

  const finalKey = apiKeyName ? process.env[apiKeyName] : process.env.WHOP_API_KEY;
  if (!finalKey) {
    return res.status(500).json({
      error: `Clé API introuvable: "${apiKeyName || 'WHOP_API_KEY'}"`,
      hint:  'Vercel Dashboard → Settings → Environment Variables'
    });
  }

  const companyId = process.env.WHOP_COMPANY_ID;
  if (!companyId) {
    return res.status(500).json({ error: 'WHOP_COMPANY_ID manquant dans Vercel.' });
  }

  if (!payload?.name) {
    return res.status(400).json({ error: 'Champ "name" manquant.' });
  }

  const title = payload.name.slice(0, 40);
  const pricingPlan = payload.pricing_plans?.[0];
  const priceInDollars = pricingPlan ? parseFloat((pricingPlan.price / 100).toFixed(2)) : null;

  const headers = {
    'Authorization': `Bearer ${finalKey}`,
    'Content-Type':  'application/json',
  };

  // ✅ FIX 3 — company_id dans l'URL, PAS dans le body
  const productPayload = {
    title,
    description: payload.description || '',
    visibility:  'visible',
  };

  let productRes, productRaw, productData;
  try {
    // ✅ FIX 4 — Endpoint correct: /companies/{id}/products
    productRes  = await fetch(`${WHOP_BASE}/companies/${companyId}/products`, {
      method: 'POST', headers, body: JSON.stringify(productPayload),
    });
    productRaw  = await productRes.text();
    productData = productRaw ? JSON.parse(productRaw) : {};
  } catch(e) {
    return res.status(502).json({ error: `Erreur produit: ${e.message}`, raw: productRaw?.slice(0,500) });
  }

  if (!productRes.ok) {
    return res.status(productRes.status).json({
      error:         `Whop produit error: ${productRes.status}`,
      whop_response: productData,
      payload_sent:  productPayload,
      raw:           productRaw?.slice(0, 500),
    });
  }

  const productId = productData.id;

  // --- ÉTAPE 2 : Créer le plan de pricing ---
  if (priceInDollars && productId) {
    const planPayload = {
      product_id:    productId,
      plan_type:     'one_time',
      currency:      (pricingPlan.currency || 'usd').toLowerCase(),
      initial_price: priceInDollars,
    };

    let planRes, planRaw, planData;
    try {
      planRes  = await fetch(`${WHOP_BASE}/plans`, {
        method: 'POST', headers, body: JSON.stringify(planPayload),
      });
      planRaw  = await planRes.text();
      planData = planRaw ? JSON.parse(planRaw) : {};
    } catch(e) {
      return res.status(207).json({
        success:       true,
        partial:       true,
        product:       productData,
        pricing_error: `Plan échoué: ${e.message}`,
        whop_url:      `https://whop.com/hub/${productId}/`,
      });
    }

    if (!planRes.ok) {
      return res.status(207).json({
        success:       true,
        partial:       true,
        product:       productData,
        pricing_error: `Plan error: ${planData?.message || planRes.status}`,
        whop_url:      `https://whop.com/hub/${productId}/`,
      });
    }

    return res.status(200).json({
      success:  true,
      product:  productData,
      plan:     planData,
      whop_url: `https://whop.com/hub/${productId}/`,
    });
  }

  return res.status(200).json({
    success:  true,
    product:  productData,
    whop_url: `https://whop.com/hub/${productId}/`,
  });
}
