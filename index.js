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

    // Health check
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, corsHeaders(request));
    }

    // Proxy /v3/*
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
  .group { border-bottom: 1px solid #141b2b; }
  .group:last-child { border-bottom: none; }
  .group-header {
    padding: 10px 12px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    background: #11182a;
  }
  .group-header:hover { background: #141d31; }
  .group-list { padding: 6px 12px 10px; }
  .location-item {
    padding: 6px 0;
    font-size: 13px;
    color: var(--muted);
    border-bottom: 1px dashed #1b2436;
  }
  .location-item:last-child { border-bottom: none; }
  .group-header small { color: var(--muted); font-weight: 500; }

  .results { margin-top: 20px; display: grid; gap: 14px; }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
        Type a city, pick the city group, and see the average PM2.5 across its monitoring locations.
      </div>
    </header>

    <div class="card">
      <form id="searchForm" class="search" autocomplete="off">
        <div class="field">
          <label for="cityInput">City name</label>
          <input id="cityInput" type="text" placeholder="e.g., London" required="">
          <div id="dropdown" class="dropdown" style="display:none;"></div>
          <div class="hint">Live search (debounced). City is parsed from location name (after first comma).</div>
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
            <h3>Average PM2.5 (2025)</h3>
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
    annualValue: document.getElementById("annualValue"),
    annualCigs: document.getElementById("annualCigs"),
    currentCount: document.getElementById("currentCount"),
    annualCount: document.getElementById("annualCount"),
  };

  const MAX_LOCATIONS = 20;
  const CONCURRENCY = 5;

  const state = { matches: [], groups: [], nextPage: 1, query: "", iso: "", searching: false, debounceId: null };

  function setError(msg) { els.errorBox.textContent = msg || ""; }
  function setMeta(msg) { els.searchMeta.textContent = msg || ""; }
  function normalize(s) { return (s || "").toLowerCase(); }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(\`API \${res.status}: \${text || res.statusText}\`);
    }
    return res.json();
  }

  // City is ONLY the substring after the first comma in location.name
  function parseCityFromName(name) {
    if (!name) return "";
    const parts = String(name).split(",");
    if (parts.length >= 2) return parts[1].trim();
    return "";
  }

  function matchLocation(loc, q) {
    const query = normalize(q);
    const parsedCity = normalize(parseCityFromName(loc.name || ""));
    if (!parsedCity) return false;
    return parsedCity.includes(query);
  }

  function cityKeyForLocation(loc) {
    return (parseCityFromName(loc.name) || "Unknown").trim();
  }

  function buildGroups(locations) {
    const map = new Map();
    for (const loc of locations) {
      const city = cityKeyForLocation(loc);
      if (!map.has(city)) map.set(city, []);
      map.get(city).push(loc);
    }
    const groups = Array.from(map.entries()).map(([city, locations]) => ({ city, locations }));
    groups.sort((a, b) => b.locations.length - a.locations.length || a.city.localeCompare(b.city));
    return groups;
  }

  function renderDropdown() {
    const groups = state.groups;
    if (!groups.length) { els.dropdown.style.display = "none"; return; }
    els.dropdown.innerHTML = groups.map((g, gi) => {
      const locItems = g.locations.map(loc => {
        const name = loc.name || "Unnamed location";
        const country = loc.country?.code || loc.country?.name || "";
        const subtitle = country ? \` • \${country}\` : "";
        return \`<div class="location-item">\${escapeHtml(name)}\${subtitle ? \` <small>\${escapeHtml(subtitle)}</small>\` : ""}</div>\`;
      }).join("");
      return \`
        <div class="group">
          <div class="group-header" data-group="\${gi}">
            <div>\${escapeHtml(g.city)} <small>• \${g.locations.length} locations</small></div>
          </div>
          <div class="group-list">\${locItems}</div>
        </div>
      \`;
    }).join("");
    els.dropdown.style.display = "block";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  async function searchLocations(initial = true) {
    if (state.searching) return;
    state.searching = true;
    setError("");
    const q = state.query.trim();
    const iso = state.iso.trim().toUpperCase();
    if (!q || q.length < 2) {
      setMeta("Type at least 2 characters.");
      state.groups = [];
      renderDropdown();
      state.searching = false;
      return;
    }

    if (initial) {
      state.matches = [];
      state.nextPage = 1;
      setMeta("Searching locations…");
      els.dropdown.style.display = "none";
    }

    const maxAutoPages = 3;
    let page = state.nextPage;
    let pagesFetched = 0;

    while (pagesFetched < maxAutoPages) {
      const params = new URLSearchParams({ limit: "100", page: String(page) });
      if (iso) params.set("iso", iso);

      const url = \`\${API_BASE}/v3/locations?\${params}\`;
      let data;
      try { data = await fetchJson(url); }
      catch (e) { setError(e.message); break; }

      const results = Array.isArray(data.results) ? data.results : [];
      const matches = results.filter(loc => matchLocation(loc, q));

      state.matches = state.matches.concat(matches);
      page += 1;
      pagesFetched += 1;

      if (state.matches.length >= 40 || results.length === 0) break;
    }

    state.nextPage = page;
    state.groups = buildGroups(state.matches);

    if (state.groups.length) {
      setMeta(\`Found \${state.groups.length} cities. Click a city to compute averages.\`);
      renderDropdown();
    } else {
      setMeta("No matches found in the first pages. Try a more specific name or add country ISO.");
      renderDropdown();
    }

    state.searching = false;
  }

  function debounceSearch() {
    clearTimeout(state.debounceId);
    state.debounceId = setTimeout(() => {
      state.query = els.city.value;
      state.iso = els.iso.value;
      searchLocations(true);
    }, 400);
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

  async function computeCityAverages(group) {
    setError("");
    els.results.style.display = "block";
    setLoading(true);

    const totalLocations = group.locations.length;
    const locations = group.locations.slice(0, MAX_LOCATIONS);
    const capped = totalLocations > MAX_LOCATIONS;

    els.locationMeta.textContent = \`City: \${group.city} • Loading \${locations.length}\${capped ? \` (cap \${MAX_LOCATIONS})\` : ""} locations…\`;

    try {
      const sensorResults = await asyncPool(CONCURRENCY, locations, async (loc) => {
        const sensorsUrl = \`\${API_BASE}/v3/locations/\${loc.id}/sensors?limit=200\`;
        const sensorsData = await fetchJson(sensorsUrl);
        const sensors = Array.isArray(sensorsData.results) ? sensorsData.results : [];
        const sensor = pickBestPmSensor(sensors);
        if (!sensor) return null;
        return {
          location: loc,
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

      const annualResults = await asyncPool(CONCURRENCY, used, async (r) => {
        try {
          const annualUrl = \`\${API_BASE}/v3/sensors/\${r.sensor.id}/years?date_from=2025-01-01&date_to=2025-12-31&limit=100\`;
          const annualData = await fetchJson(annualUrl);
          const annualList = Array.isArray(annualData.results) ? annualData.results : [];
          const pick = annualList.find(x => {
            const from = x.period?.datetimeFrom?.utc || x.period?.datetimeFrom?.local || "";
            const to = x.period?.datetimeTo?.utc || x.period?.datetimeTo?.local || "";
            return String(from).startsWith("2025") || String(to).startsWith("2025");
          }) || annualList[0];
          const val = pick?.value ?? pick?.summary?.avg ?? null;
          return val != null ? val : null;
        } catch (e) {
          return null;
        }
      });

      const annualUsed = annualResults.filter(v => v != null);
      const annualMean = annualUsed.length ? (annualUsed.reduce((s, v) => s + v, 0) / annualUsed.length) : null;

      renderValues({
        city: group.city,
        currentMean,
        annualMean,
        currentCount: used.length,
        annualCount: annualUsed.length,
        totalLocations,
        capped,
        updated: latestUpdate ? new Date(latestUpdate).toISOString() : null
      });
    } catch (e) {
      setError(e.message);
      renderValues({
        city: group.city,
        currentMean: null,
        annualMean: null,
        currentCount: 0,
        annualCount: 0,
        totalLocations,
        capped,
        updated: null
      });
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    [els.currentValue, els.annualValue, els.currentCigs, els.annualCigs].forEach(el => {
      if (isLoading) el.classList.add("loading");
      else el.classList.remove("loading");
    });
  }

  function renderValues({ city, currentMean, annualMean, currentCount, annualCount, totalLocations, capped, updated }) {
    animateNumber(els.currentValue, currentMean, "µg/m³");
    animateNumber(els.annualValue, annualMean, "µg/m³");

    const cCigs = (currentMean != null) ? Math.round(currentMean / 22) : null;
    const aCigs = (annualMean != null) ? Math.round(annualMean / 22) : null;

    els.currentCigs.textContent = cCigs != null ? \`≈ \${cCigs} cigarettes/day\` : "≈ N/A cigarettes/day";
    els.annualCigs.textContent = aCigs != null ? \`≈ \${aCigs} cigarettes/day\` : "≈ N/A cigarettes/day";

    els.currentCount.textContent = \`\${currentCount} of \${totalLocations} locations used\${capped ? \` (cap \${MAX_LOCATIONS})\` : ""}\`;
    els.annualCount.textContent = annualCount ? \`\${annualCount} locations with 2025 data\` : "No 2025 data available";

    let meta = \`City: \${city} • Locations used: \${currentCount}/\${totalLocations}\${capped ? \` (cap \${MAX_LOCATIONS})\` : ""}\`;
    if (updated) meta += \` • Latest update \${updated}\`;
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
    searchLocations(true);
  });

  // Click city group header to compute averages
  els.dropdown.addEventListener("click", (e) => {
    const header = e.target.closest(".group-header");
    if (!header) return;
    const idx = Number(header.dataset.group);
    const group = state.groups[idx];
    if (!group) return;
    els.dropdown.style.display = "none";
    computeCityAverages(group);
  });

  document.addEventListener("click", (e) => {
    if (!els.dropdown.contains(e.target) && e.target !== els.city) {
      els.dropdown.style.display = "none";
    }
  });
})();
</script>
</body></html>`;
