// index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, corsHeaders(request));
    }

    // Only proxy /v3/* (change if you want broader access)
    if (!url.pathname.startsWith("/v3/")) {
      return json({ error: "Not found" }, 404, corsHeaders(request));
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Allow only safe methods
    const allowedMethods = new Set(["GET", "HEAD"]);
    if (!allowedMethods.has(request.method)) {
      return json({ error: "Method not allowed" }, 405, corsHeaders(request));
    }

    // Build upstream URL
    const upstream = new URL("https://api.openaq.org" + url.pathname);
    upstream.search = url.search;

    // Forward request
    const upstreamReq = new Request(upstream.toString(), {
      method: request.method,
      headers: {
        "accept": request.headers.get("accept") || "application/json",
        "X-API-Key": env.OPENAQ_API_KEY
      }
    });

    const resp = await fetch(upstreamReq);

    // Pass through response body + status
    const headers = new Headers(resp.headers);
    // Ensure CORS headers on response
    for (const [k, v] of Object.entries(corsHeaders(request))) {
      headers.set(k, v);
    }

    return new Response(resp.body, {
      status: resp.status,
      headers
    });
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}