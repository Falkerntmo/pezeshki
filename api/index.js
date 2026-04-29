export const config = {
  runtime: "edge",
};

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function inventoryGateway(req) {
  if (!TARGET_BASE) {
    return new Response(JSON.stringify({ error: "System Error: Missing Warehouse Domain Configuration" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // سیستم قطع‌کننده تصادفی (بین ۲۵ تا ۴۵ ثانیه)
  const controller = new AbortController();
  const randomDropTime = Math.floor(Math.random() * (45000 - 25000 + 1)) + 25000;
  
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, randomDropTime);

  try {
    const url = new URL(req.url);

    // لایه استتار اول: مدیریت CORS
    if (req.method === "OPTIONS") {
      clearTimeout(timeoutId);
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // لایه استتار دوم: نمایش دیتای فیک تجاری در مسیرهای عمومی
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/status")) {
      clearTimeout(timeoutId);
      return new Response(JSON.stringify({
        service: "Kala Stock Inventory API",
        status: "operational",
        region: "Alborz-Karaj",
        uptime: Math.floor(process.uptime ? process.uptime() : Date.now() / 1000),
        categories: ["Pro-Coffee Equipment", "Accessories"],
        recent_restock: [
          { sku: "PC-101", item: "Professional Espresso Maker", qty: 12 },
          { sku: "PC-102", item: "Premium Arabica Blend", qty: 45 }
        ],
        message: "Gateway is secure. Internal routing active."
      }), {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "s-maxage=3600, stale-while-revalidate",
          "X-Service-Version": "v3.1.0"
        }
      });
    }

    // منطق اصلی تونل و پروکسی
    const targetUrl = TARGET_BASE + url.pathname + url.search;
    const headers = new Headers();
    let clientIp = null;
    
    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") { clientIp = value; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = value; continue; }
      headers.set(k, value);
    }
    
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const fetchOpts = {
      method,
      headers,
      redirect: "manual",
      signal: controller.signal // اعمال تایمر تصادفی روی اتصال
    };
    
    if (hasBody) {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const respHeaders = new Headers();
    
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      respHeaders.set(k, v);
    }

    // لایه استتار سوم: هدرهای ساختگی خروجی
    respHeaders.set("X-Transaction-Id", crypto.randomUUID());
    respHeaders.set("X-Gateway-Node", "krj-edge-pool-1");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    // مدیریت امن ارورها
    if (err.name === 'AbortError') {
      return new Response(JSON.stringify({ message: "Sync cycle completed successfully." }), { 
        status: 200, // ارسال کد ۲۰۰ به جای ارور قطعی
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Upstream warehouse synchronization timeout." }), { 
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
