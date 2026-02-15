export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve HTML at root
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // Serve cities.json (from env)
    if (url.pathname === "/cities.json") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "Method not allowed" }, 405, corsHeaders(request));
      }

      if (env.CITIES_JSON && env.CITIES_JSON.length > 0) {
        return new Response(env.CITIES_JSON, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=3600",
            ...corsHeaders(request)
          }
        });
      }

      if (env.CITIES_JSON_URL && env.CITIES_JSON_URL.length > 0) {
        const upstream = await fetch(env.CITIES_JSON_URL, {
          headers: { "accept": "application/json" }
        });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=3600",
            ...corsHeaders(request)
          }
        });
      }

      return json({ error: "CITIES_JSON not configured" }, 404, corsHeaders(request));
    }

    // Health check
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, corsHeaders(request));
    }

    // Aggregate city endpoint (single client request)
    if (url.pathname === "/city-avg") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, corsHeaders(request));
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400, corsHeaders(request));
      }

      const city = String(body?.city || "").trim();
      const country = String(body?.country || "").trim();
      const locationIds = Array.isArray(body?.locationIds) ? body.locationIds : [];

      if (!city || !country || !locationIds.length) {
        return json({ error: "Missing city, country, or locationIds" }, 400, corsHeaders(request));
      }

      // Safety cap to avoid runaway subrequests (adjust if needed)
      if (locationIds.length > MAX_LOCATIONS) {
        return json(
          { error: `Too many locations for one request (max ${MAX_LOCATIONS})` },
          413,
          corsHeaders(request)
        );
      }

      // Cache bucket: 5 minutes
      const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const cacheKeyUrl = new URL(url.toString());
      cacheKeyUrl.searchParams.set("city", city);
      cacheKeyUrl.searchParams.set("country", country);
      cacheKeyUrl.searchParams.set("bucket", String(bucket));
      cacheKeyUrl.searchParams.set("locations", locationIds.join(","));
      const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const inflightKey = cacheKeyUrl.toString();
      if (!globalThis.__inflight) globalThis.__inflight = new Map();
      const inflight = globalThis.__inflight.get(inflightKey);
      if (inflight) return inflight;

      const promise = (async () => {
        try {
          const data = await computeCityAveragesBatched(env, locationIds);

          const resp = json(
            {
              city,
              country,
              ...data,
              cached: false,
              computedAt: new Date().toISOString()
            },
            200,
            {
              ...corsHeaders(request),
              "cache-control": "public, max-age=300"
            }
          );

          ctx.waitUntil(cache.put(cacheKey, resp.clone()));
          return resp;
        } catch (e) {
          const status = e?.status || 500;
          const retryAfter = e?.retryAfter;
          const headers = corsHeaders(request);
          if (retryAfter) headers["Retry-After"] = String(retryAfter);

          return json(
            { error: e?.message || "Upstream error" },
            status,
            headers
          );
        } finally {
          globalThis.__inflight.delete(inflightKey);
        }
      })();

      globalThis.__inflight.set(inflightKey, promise);
      return promise;
    }

    // Proxy /v3/* (kept for debugging)
    if (url.pathname.startsWith("/v3/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      const allowedMethods = new Set(["GET", "HEAD"]);
      if (!allowedMethods.has(request.method)) {
        return json({ error: "Method not allowed" }, 405, corsHeaders(request));
      }

      const upstream = new URL("https://api.openaq.org" + url.pathname);
      upstream.search = url.search;

      const upstreamReq = new Request(upstream.toString(), {
        method: request.method,
        headers: {
          "accept": request.headers.get("accept") || "application/json",
          "X-API-Key": env.OPENAQ_API_KEY
        }
      });

      const resp = await fetch(upstreamReq);
      const headers = new Headers(resp.headers);
      for (const [k, v] of Object.entries(corsHeaders(request))) {
        headers.set(k, v);
      }

      return new Response(resp.body, {
        status: resp.status,
        headers
      });
    }

    return json({ error: "Not found" }, 404, corsHeaders(request));
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
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

// ==== OpenAQ aggregation (Worker-side) ====

const CONCURRENCY = 3;
const BATCH_SIZE = 100;
const MAX_LOCATIONS = 2000;

async function computeCityAveragesBatched(env, locationIds) {
  const chunks = [];
  for (let i = 0; i < locationIds.length; i += BATCH_SIZE) {
    chunks.push(locationIds.slice(i, i + BATCH_SIZE));
  }

  let currentSum = 0;
  let currentCount = 0;
  let dailySum = 0;
  let dailyCount = 0;
  let annualSum = 0;
  let annualCount = 0;
  let latestUpdate = null;
  let lastYear = new Date().getUTCFullYear() - 1;

  // Process batches sequentially to avoid subrequest spikes
  for (const chunk of chunks) {
    const data = await computeCityAverages(env, chunk);

    if (data.currentMean != null && data.currentCount > 0) {
      currentSum += data.currentMean * data.currentCount;
      currentCount += data.currentCount;
    }

    if (data.dailyMean != null && data.dailyCount > 0) {
      dailySum += data.dailyMean * data.dailyCount;
      dailyCount += data.dailyCount;
    }

    if (data.annualMean != null && data.annualCount > 0) {
      annualSum += data.annualMean * data.annualCount;
      annualCount += data.annualCount;
    }

    if (data.updated) {
      const t = Date.parse(data.updated);
      if (!isNaN(t)) {
        if (!latestUpdate || t > latestUpdate) latestUpdate = t;
      }
    }

    if (data.lastYear) lastYear = data.lastYear;
  }

  const currentMean = currentCount ? (currentSum / currentCount) : null;
  const dailyMean = dailyCount ? (dailySum / dailyCount) : null;
  const annualMean = annualCount ? (annualSum / annualCount) : null;

  return {
    currentMean,
    dailyMean,
    annualMean,
    currentCount,
    dailyCount,
    annualCount,
    totalLocations: locationIds.length,
    updated: latestUpdate ? new Date(latestUpdate).toISOString() : null,
    lastYear
  };
}

async function computeCityAverages(env, locationIds) {
  const sensorResults = await asyncPool(CONCURRENCY, locationIds, async (locId) => {
    const sensorsData = await openaqJson(env, `/v3/locations/${locId}/sensors`, { limit: "200" });
    const sensors = Array.isArray(sensorsData.results) ? sensorsData.results : [];
    const sensor = pickBestPmSensor(sensors);
    if (!sensor) return null;
    return {
      locationId: locId,
      sensor,
      current: sensor.latest?.value ?? null,
      updated: sensor.latest?.datetime?.utc || sensor.latest?.datetime?.local || null
    };
  });

  const used = sensorResults.filter(Boolean).filter(r => r.current != null);
  const currentMean = used.length ? (used.reduce((s, r) => s + r.current, 0) / used.length) : null;

  let latestUpdate = null;
  for (const r of used) {
    const t = Date.parse(r.updated || "");
    if (!isNaN(t)) {
      if (!latestUpdate || t > latestUpdate) latestUpdate = t;
    }
  }

  const dailyResults = await asyncPool(CONCURRENCY, used, async (r) => {
    try {
      return await fetchLast24hMean(env, r.sensor.id);
    } catch {
      return null;
    }
  });
  const dailyUsed = dailyResults.filter(v => v != null);
  const dailyMean = dailyUsed.length ? (dailyUsed.reduce((s, v) => s + v, 0) / dailyUsed.length) : null;

  const lastYear = new Date().getUTCFullYear() - 1;
  const annualResults = await asyncPool(CONCURRENCY, used, async (r) => {
    try {
      return await fetchLastYearMean(env, r.sensor.id, lastYear);
    } catch {
      return null;
    }
  });
  const annualUsed = annualResults.filter(v => v != null);
  const annualMean = annualUsed.length ? (annualUsed.reduce((s, v) => s + v, 0) / annualUsed.length) : null;

  return {
    currentMean,
    dailyMean,
    annualMean,
    currentCount: used.length,
    dailyCount: dailyUsed.length,
    annualCount: annualUsed.length,
    totalLocations: locationIds.length,
    updated: latestUpdate ? new Date(latestUpdate).toISOString() : null,
    lastYear
  };
}

function pickBestPmSensor(sensors) {
  const pmSensors = sensors.filter(s => {
    const pname = normalize(s.parameter?.name);
    const dname = normalize(s.parameter?.displayName);
    return pname === "pm25" || dname.includes("pm2.5");
  });

  const withLatest = pmSensors.filter(s => s.latest && s.latest.value != null);
  if (!withLatest.length) return null;

  withLatest.sort((a, b) => {
    const da = Date.parse(a.latest?.datetime?.utc || a.latest?.datetime?.local || "") || 0;
    const db = Date.parse(b.latest?.datetime?.utc || b.latest?.datetime?.local || "") || 0;
    return db - da;
  });

  return withLatest[0];
}

async function fetchLast24hMean(env, sensorId) {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const params = {
    date_from: from.toISOString(),
    date_to: now.toISOString(),
    limit: "1000",
    sort: "desc"
  };
  const data = await openaqJson(env, `/v3/sensors/${sensorId}/measurements`, params);
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) return null;

  const values = results.map(r => r.value).filter(v => v != null && !isNaN(v));
  if (!values.length) return null;

  return values.reduce((s, v) => s + v, 0) / values.length;
}

async function fetchLastYearMean(env, sensorId, year) {
  const params = {
    date_from: `${year}-01-01`,
    date_to: `${year}-12-31`,
    limit: "100"
  };
  const data = await openaqJson(env, `/v3/sensors/${sensorId}/years`, params);
  const list = Array.isArray(data.results) ? data.results : [];
  const pick = list.find(x => {
    const from = x.period?.datetimeFrom?.utc || x.period?.datetimeFrom?.local || "";
    const to = x.period?.datetimeTo?.utc || x.period?.datetimeTo?.local || "";
    return String(from).startsWith(String(year)) || String(to).startsWith(String(year));
  }) || list[0];
  const val = pick?.value ?? pick?.summary?.avg ?? null;
  return val != null ? val : null;
}

async function openaqJson(env, path, params = {}) {
  const url = new URL("https://api.openaq.org" + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }

  const resp = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "X-API-Key": env.OPENAQ_API_KEY
    }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(text || resp.statusText || "Upstream error");
    err.status = resp.status;
    const retryAfter = resp.headers.get("Retry-After");
    if (retryAfter) err.retryAfter = retryAfter;
    throw err;
  }

  return resp.json();
}

async function asyncPool(limit, items, iterator) {
  const ret = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

function normalize(s) {
  return (s || "").toLowerCase();
}

// === HTML ===
// Uses same-origin Worker for API calls (no key in browser)
const HTML = `<!DOCTYPE html><html lang="en"><head><meta name="x-poe-datastore-behavior" content="local_only"><meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://code.jquery.com https://unpkg.com https://d3js.org https://threejs.org https://cdn.plot.ly https://stackpath.bootstrapcdn.com https://maps.googleapis.com https://cdn.tailwindcss.com https://ajax.googleapis.com https://kit.fontawesome.com https://cdn.datatables.net https://maxcdn.bootstrapcdn.com https://code.highcharts.com https://tako-static-assets-production.s3.amazonaws.com https://www.youtube.com https://fonts.googleapis.com https://fonts.gstatic.com https://pfst.cf2.poecdn.net https://puc.poecdn.net https://i.imgur.com https://wikimedia.org https://*.icons8.com https://*.giphy.com https://picsum.photos https://images.unsplash.com; frame-src 'self' https://www.youtube.com https://trytako.com; child-src 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests; block-all-mixed-content;">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PM2.5 to Cigarettes — OpenAQ</title>
<style>
  :root {
    --bg: #0b0f17;
    --panel: #121827;
    --panel-2: #0f1522;
    --text: #e5e7eb;
    --muted: #9aa4b2;
    --accent: #7c9cff;
    --accent-2: #9ef0ff;
    --border: #1f2937;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    color: var(--text);
    background: radial-gradient(1200px 600px at 20% -10%, #17203a 0%, var(--bg) 60%);
  }
  .wrap {
    max-width: 980px;
    margin: 0 auto;
    padding: 32px 20px 64px;
  }
  header { margin: 16px 0 28px; }
  h1 {
    margin: 0 0 8px;
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .subtitle {
    color: var(--muted);
    font-size: clamp(14px, 2vw, 18px);
  }

  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  }

  .search {
    display: grid;
    grid-template-columns: 1fr 120px auto;
    gap: 12px;
  }
  @media (max-width: 720px) {
    .search { grid-template-columns: 1fr; }
  }

  .field { position: relative; }
  label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  input {
    width: 100%;
    background: #0c1220;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 12px 14px;
    border-radius: 10px;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(124,156,255,0.2);
  }
  button {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
    color: #0b0f17;
    border: none;
    padding: 12px 18px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: transform 0.08s ease, filter 0.2s ease;
  }
  button:hover { filter: brightness(1.05); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }

  .hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 6px;
    background: #0c1220;
    border: 1px solid var(--border);
    border-radius: 10px;
    max-height: 320px;
    overflow: auto;
    z-index: 10;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35);
  }
  .dropdown-item {
    padding: 10px 12px;
    cursor: pointer;
    border-bottom: 1px dashed #1b2436;
    font-size: 14px;
  }
  .dropdown-item:last-child { border-bottom: none; }
  .dropdown-item:hover { background: #141d31; }

  .results { margin-top: 20px; display: grid; gap: 14px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  @media (max-width: 720px) {
    .stats { grid-template-columns: 1fr; }
  }
  .stat {
    background: #0c1220;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
  }
  .stat h3 { margin: 0 0 8px; font-size: 14px; color: var(--muted); }
  .value {
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .unit { font-size: 12px; color: var(--muted); margin-left: 6px; }
  .cig { margin-top: 8px; font-size: 14px; color: var(--muted); }
  .count { margin-top: 6px; font-size: 12px; color: var(--muted); }

  .fade-in { animation: fadeInUp 0.5s ease both; }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .loading { position: relative; overflow: hidden; color: transparent; }
  .loading::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.15), rgba(255,255,255,0.05));
    transform: translateX(-100%);
    animation: shimmer 1.2s infinite;
  }
  @keyframes shimmer { 100% { transform: translateX(100%); } }

  .meta { font-size: 12px; color: var(--muted); }
  .error { color: #fca5a5; font-size: 13px; }
  .footer { margin-top: 18px; font-size: 12px; color: var(--muted); }

  @media (prefers-reduced-motion: reduce) {
    .fade-in { animation: none; }
    .loading::after { animation: none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Air you breathe, translated into cigarettes.</h1>
      <div class="subtitle">
        Type a city, pick the city, and see the average PM2.5 across its monitoring locations.
      </div>
    </header>

    <div class="card">
      <form id="searchForm" class="search" autocomplete="off">
        <div class="field">
          <label for="cityInput">City name</label>
          <input id="cityInput" type="text" placeholder="e.g., London" required="">
          <div id="dropdown" class="dropdown" style="display:none;"></div>
          <div class="hint">Live search from cities.json. Pick a city to compute averages.</div>
        </div>
        <div class="field">
          <label for="isoInput">Country ISO (optional)</label>
          <input id="isoInput" type="text" placeholder="US" maxlength="2">
        </div>
        <div class="field" style="align-self:end;">
          <button id="searchBtn" type="submit">Search</button>
        </div>
      </form>

      <div id="searchMeta" class="meta" style="margin-top:10px;"></div>
      <div id="errorBox" class="error" style="margin-top:8px;"></div>
    </div>

    <div id="results" class="results" style="display:none;">
      <div class="card fade-in">
        <div class="meta" id="locationMeta"></div>
        <div class="stats" style="margin-top:12px;">
          <div class="stat">
            <h3>Average PM2.5 (latest)</h3>
            <div class="value" id="currentValue">—</div>
            <div class="cig" id="currentCigs">—</div>
            <div class="count" id="currentCount"></div>
          </div>
          <div class="stat">
            <h3>Average PM2.5 (last 24 hours)</h3>
            <div class="value" id="dailyValue">—</div>
            <div class="cig" id="dailyCigs">—</div>
            <div class="count" id="dailyCount"></div>
          </div>
          <div class="stat">
            <h3 id="annualLabel">Average PM2.5 (last year)</h3>
            <div class="value" id="annualValue">—</div>
            <div class="cig" id="annualCigs">—</div>
            <div class="count" id="annualCount"></div>
          </div>
        </div>
        <div class="footer">
          Cigarette equivalence based on Berkeley Earth estimate (22 µg/m³ ≈ 1 cigarette/day).
        </div>
      </div>

      <div class="meta" id="disclaimer">
        PM2.5 levels vary by location and time. City averages use the latest sensor values per location.
      </div>
    </div>
  </div>

<script>
(() => {
  const API_BASE = location.origin; // same Worker origin
  const CITIES_URL = "/cities.json";
  const CITY_AVG_URL = "/city-avg";

  const els = {
    form: document.getElementById("searchForm"),
    city: document.getElementById("cityInput"),
    iso: document.getElementById("isoInput"),
    searchBtn: document.getElementById("searchBtn"),
    dropdown: document.getElementById("dropdown"),
    searchMeta: document.getElementById("searchMeta"),
    errorBox: document.getElementById("errorBox"),
    results: document.getElementById("results"),
    locationMeta: document.getElementById("locationMeta"),
    currentValue: document.getElementById("currentValue"),
    currentCigs: document.getElementById("currentCigs"),
    dailyValue: document.getElementById("dailyValue"),
    dailyCigs: document.getElementById("dailyCigs"),
    annualValue: document.getElementById("annualValue"),
    annualCigs: document.getElementById("annualCigs"),
    currentCount: document.getElementById("currentCount"),
    dailyCount: document.getElementById("dailyCount"),
    annualCount: document.getElementById("annualCount"),
    annualLabel: document.getElementById("annualLabel")
  };

  const state = {
    cities: [],
    filtered: [],
    query: "",
    iso: "",
    debounceId: null,
    citiesReady: false,
    inFlight: null,
    cache: new Map()
  };

  function setError(msg) { els.errorBox.textContent = msg || ""; }
  function setMeta(msg) { els.searchMeta.textContent = msg || ""; }
  function normalize(s) { return (s || "").toLowerCase(); }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, { headers: { "accept": "application/json" }, ...opts });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(\`API \${res.status}: \${text || res.statusText}\`);
      err.status = res.status;
      err.retryAfter = res.headers.get("Retry-After");
      throw err;
    }
    return res.json();
  }

  async function loadCities() {
    try {
      setMeta("Loading city list…");
      const data = await fetchJson(CITIES_URL);
      const cities = Array.isArray(data.cities) ? data.cities : [];
      state.cities = cities;
      state.citiesReady = true;
      setMeta(\`Loaded \${cities.length} cities.\`);
    } catch (e) {
      setError("Failed to load cities.json. Check Worker env configuration.");
      setMeta("");
      state.citiesReady = false;
    }
  }

  function filterCities() {
    const q = normalize(state.query.trim());
    const iso = normalize(state.iso.trim());

    if (!q || q.length < 2) {
      state.filtered = [];
      renderDropdown();
      setMeta("Type at least 2 characters.");
      return;
    }

    let list = state.cities.filter(c => normalize(c.city).includes(q));
    if (iso) {
      list = list.filter(c => normalize(c.country_code) === iso);
    }

    state.filtered = list.slice(0, 50);

    if (state.filtered.length) {
      setMeta(\`Found \${list.length} cities. Click one to compute averages.\`);
    } else {
      setMeta("No matches found. Try a more specific name or add country ISO.");
    }

    renderDropdown();
  }

  function renderDropdown() {
    const items = state.filtered;
    if (!items.length) { els.dropdown.style.display = "none"; return; }

    els.dropdown.innerHTML = items.map((c, i) => {
      const label = \`\${c.city}, \${c.country}\`;
      return \`<div class="dropdown-item" data-idx="\${i}">\${escapeHtml(label)}</div>\`;
    }).join("");

    els.dropdown.style.display = "block";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function debounceSearch() {
    clearTimeout(state.debounceId);
    state.debounceId = setTimeout(() => {
      state.query = els.city.value;
      state.iso = els.iso.value;
      if (state.citiesReady) filterCities();
    }, 250);
  }

  function cacheKeyForCity(cityObj) {
    const ids = (cityObj.locations || []).map(l => l.id).join(",");
    return \`\${cityObj.city}|\${cityObj.country}|\${ids}\`;
  }

  async function computeCityAverages(cityObj) {
    setError("");
    els.results.style.display = "block";
    setLoading(true);

    const totalLocations = cityObj.locations.length;
    els.locationMeta.textContent = \`City: \${cityObj.city}, \${cityObj.country} • Loading \${totalLocations} locations…\`;

    const key = cacheKeyForCity(cityObj);
    const cached = state.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      renderValues({ ...cached.data, city: cityObj.city, country: cityObj.country, totalLocations, cached: true });
      setLoading(false);
      return;
    }

    if (state.inFlight) {
      state.inFlight.abort();
      state.inFlight = null;
    }
    const controller = new AbortController();
    state.inFlight = controller;

    try {
      const payload = {
        city: cityObj.city,
        country: cityObj.country,
        locationIds: cityObj.locations.map(l => l.id)
      };

      const data = await fetchJson(CITY_AVG_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      renderValues({ ...data, city: cityObj.city, country: cityObj.country, totalLocations });
      state.cache.set(key, { data, expires: Date.now() + 5 * 60 * 1000 });
    } catch (e) {
      if (e.name === "AbortError") return;
      if (e.status === 429) {
        const wait = e.retryAfter ? \` Try again in \${e.retryAfter} seconds.\` : " Try again in a minute.";
        setError("OpenAQ rate limit hit." + wait);
      } else {
        setError(e.message);
      }

      renderValues({
        city: cityObj.city,
        country: cityObj.country,
        currentMean: null,
        dailyMean: null,
        annualMean: null,
        currentCount: 0,
        dailyCount: 0,
        annualCount: 0,
        totalLocations,
        updated: null,
        lastYear: new Date().getUTCFullYear() - 1
      });
    } finally {
      setLoading(false);
      state.inFlight = null;
    }
  }

  function setLoading(isLoading) {
    [els.currentValue, els.dailyValue, els.annualValue, els.currentCigs, els.dailyCigs, els.annualCigs].forEach(el => {
      if (isLoading) el.classList.add("loading");
      else el.classList.remove("loading");
    });
  }

  function renderValues({ city, country, currentMean, dailyMean, annualMean, currentCount, dailyCount, annualCount, totalLocations, updated, lastYear, cached, computedAt }) {
    animateNumber(els.currentValue, currentMean, "µg/m³");
    animateNumber(els.dailyValue, dailyMean, "µg/m³");
    animateNumber(els.annualValue, annualMean, "µg/m³");

    const cCigs = (currentMean != null) ? Math.round(currentMean / 22) : null;
    const dCigs = (dailyMean != null) ? Math.round(dailyMean / 22) : null;
    const aCigs = (annualMean != null) ? Math.round(annualMean / 22) : null;

    els.currentCigs.textContent = cCigs != null ? \`≈ \${cCigs} cigarettes/day\` : "≈ N/A cigarettes/day";
    els.dailyCigs.textContent = dCigs != null ? \`≈ \${dCigs} cigarettes/day\` : "≈ N/A cigarettes/day";
    els.annualCigs.textContent = aCigs != null ? \`≈ \${aCigs} cigarettes/day\` : "≈ N/A cigarettes/day";

    els.currentCount.textContent = \`\${currentCount} of \${totalLocations} locations used\`;
    els.dailyCount.textContent = dailyCount ? \`\${dailyCount} locations with 24h data\` : "No 24h data available";
    els.annualCount.textContent = annualCount ? \`\${annualCount} locations with last-year data\` : "No last-year data available";

    const year = lastYear || (new Date().getUTCFullYear() - 1);
    els.annualLabel.textContent = \`Average PM2.5 (\${year})\`;

    let meta = \`City: \${city}, \${country} • Locations used: \${currentCount}/\${totalLocations}\`;
    if (updated) meta += \` • Latest update \${updated}\`;
    if (computedAt) meta += \` • Computed \${computedAt}\`;
    if (cached) meta += " • Cached";
    els.locationMeta.textContent = meta;
  }

  function animateNumber(el, value, unit) {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (value == null || isNaN(value)) { el.textContent = "N/A"; return; }
    const target = Math.round(value);
    if (prefersReduced) { el.innerHTML = \`\${target}<span class="unit">\${unit}</span>\`; return; }
    const start = 0, duration = 700, startTime = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(start + (target - start) * eased);
      el.innerHTML = \`\${current}<span class="unit">\${unit}</span>\`;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Live search
  els.city.addEventListener("input", debounceSearch);
  els.iso.addEventListener("input", debounceSearch);

  // Manual search button still works
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    state.query = els.city.value;
    state.iso = els.iso.value;
    if (state.citiesReady) filterCities();
  });

  // Click dropdown item to compute averages
  els.dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;
    const idx = Number(item.dataset.idx);
    const cityObj = state.filtered[idx];
    if (!cityObj) return;
    els.dropdown.style.display = "none";
    els.city.value = \`\${cityObj.city}, \${cityObj.country}\`;
    computeCityAverages(cityObj);
  });

  document.addEventListener("click", (e) => {
    if (!els.dropdown.contains(e.target) && e.target !== els.city) {
      els.dropdown.style.display = "none";
    }
  });

  // Init
  loadCities();
})();
</script>
</body></html>`;

