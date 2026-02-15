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
    --good: #22c55e;
    --warn: #f59e0b;
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
    max-height: 260px;
    overflow: auto;
    z-index: 10;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35);
  }
  .option {
    padding: 10px 12px;
    cursor: pointer;
    border-bottom: 1px solid #141b2b;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .option:last-child { border-bottom: none; }
  .option:hover { background: #11182a; }
  .option small { color: var(--muted); }

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
        Search a city, pick a monitoring location, and see current and 2025 PM2.5 levels.
      </div>
    </header>

    <div class="card">
      <form id="searchForm" class="search" autocomplete="off">
        <div class="field">
          <label for="cityInput">City name</label>
          <input id="cityInput" type="text" placeholder="e.g., London" required="">
          <div id="dropdown" class="dropdown" style="display:none;"></div>
          <div class="hint">Matches location name or locality within the first few result pages.</div>
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
            <h3>Current PM2.5</h3>
            <div class="value" id="currentValue">—</div>
            <div class="cig" id="currentCigs">—</div>
          </div>
          <div class="stat">
            <h3>Average PM2.5 (2025)</h3>
            <div class="value" id="annualValue">—</div>
            <div class="cig" id="annualCigs">—</div>
          </div>
        </div>
        <div class="footer">
          Cigarette equivalence based on Berkeley Earth estimate (22 µg/m³ ≈ 1 cigarette/day).
        </div>
      </div>

      <div class="meta" id="disclaimer">
        PM2.5 levels vary by location and time. This estimate is a simplified equivalence for context only.
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
  };

  const state = { matches: [], nextPage: 1, query: "", iso: "", searching: false };

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

  function renderDropdown() {
    const list = state.matches;
    if (!list.length) { els.dropdown.style.display = "none"; return; }
    els.dropdown.innerHTML = list.map((loc, idx) => {
      const name = loc.name || "Unnamed location";
      const locality = loc.locality || "";
      const country = loc.country?.code || loc.country?.name || "";
      const subtitle = [locality, country].filter(Boolean).join(", ");
      return \`
        <div class="option" data-idx="\${idx}" role="option">
          <div>\${escapeHtml(name)} \${subtitle ? \`<small>• \${escapeHtml(subtitle)}</small>\` : ""}</div>
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
    if (!q) { state.searching = false; return; }

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
      const matches = results.filter(loc => {
        const hay = normalize([loc.name, loc.locality, loc.country?.name, loc.country?.code].join(" "));
        return hay.includes(normalize(q));
      });

      state.matches = state.matches.concat(matches);
      page += 1;
      pagesFetched += 1;

      if (state.matches.length >= 10 || results.length === 0) break;
    }

    state.nextPage = page;
    if (state.matches.length) {
      setMeta(\`Found \${state.matches.length} matches. Select a location.\`);
      renderDropdown();
    } else {
      setMeta("No matches found in the first pages. Try a more specific name or add country ISO.");
      renderDropdown();
    }

    state.searching = false;
  }

  async function loadDataForLocation(loc) {
    setError("");
    els.results.style.display = "block";
    els.locationMeta.textContent = "Loading…";
    setLoading(true);

    const locationLabel = [loc.name, loc.locality, loc.country?.code].filter(Boolean).join(" • ");
    els.locationMeta.textContent = locationLabel || "Selected location";

    try {
      const sensorsUrl = \`\${API_BASE}/v3/locations/\${loc.id}/sensors?limit=200\`;
      const sensorsData = await fetchJson(sensorsUrl);
      const sensors = Array.isArray(sensorsData.results) ? sensorsData.results : [];

      const pmSensors = sensors.filter(s => {
        const pname = normalize(s.parameter?.name);
        const dname = normalize(s.parameter?.displayName);
        return pname === "pm25" || dname.includes("pm2.5");
      });

      if (!pmSensors.length) throw new Error("No PM2.5 sensors found for this location.");

      let sensor = pmSensors.find(s => s.latest && s.latest.value != null) || pmSensors[0];

      let currentValue = sensor.latest?.value ?? null;
      let currentUpdated = sensor.latest?.datetime?.utc || sensor.latest?.datetime?.local || null;

      if (currentValue == null) {
        const measUrl = \`\${API_BASE}/v3/sensors/\${sensor.id}/measurements?limit=1\`;
        const measData = await fetchJson(measUrl);
        const meas = Array.isArray(measData.results) ? measData.results[0] : null;
        currentValue = meas?.value ?? null;
      }

      let annualValue = null;
      try {
        const annualUrl = \`\${API_BASE}/v3/sensors/\${sensor.id}/years?date_from=2025-01-01&date_to=2025-12-31&limit=100\`;
        const annualData = await fetchJson(annualUrl);
        const annualResults = Array.isArray(annualData.results) ? annualData.results : [];
        let pick = annualResults.find(r => {
          const from = r.period?.datetimeFrom?.utc || r.period?.datetimeFrom?.local || "";
          const to = r.period?.datetimeTo?.utc || r.period?.datetimeTo?.local || "";
          return String(from).startsWith("2025") || String(to).startsWith("2025");
        }) || annualResults[0];

        if (pick) annualValue = pick.value ?? pick.summary?.avg ?? null;
      } catch (e) {
        annualValue = null;
      }

      renderValues(currentValue, annualValue, currentUpdated);
    } catch (e) {
      setError(e.message);
      renderValues(null, null, null);
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

  function renderValues(current, annual, updated) {
    animateNumber(els.currentValue, current, "µg/m³");
    animateNumber(els.annualValue, annual, "µg/m³");

    const cCigs = (current != null) ? Math.round(current / 22) : null;
    const aCigs = (annual != null) ? Math.round(annual / 22) : null;

    els.currentCigs.textContent = cCigs != null ? \`≈ \${cCigs} cigarettes/day\` : "≈ N/A cigarettes/day";
    els.annualCigs.textContent = aCigs != null ? \`≈ \${aCigs} cigarettes/day\` : "≈ N/A cigarettes/day";

    if (updated) els.locationMeta.textContent = \`\${els.locationMeta.textContent} • Updated \${updated}\`;
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

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    state.query = els.city.value;
    state.iso = els.iso.value;
    searchLocations(true);
  });

  els.dropdown.addEventListener("click", (e) => {
    const option = e.target.closest(".option");
    if (!option) return;
    const idx = Number(option.dataset.idx);
    const loc = state.matches[idx];
    if (!loc) return;
    els.dropdown.style.display = "none";
    loadDataForLocation(loc);
  });

  document.addEventListener("click", (e) => {
    if (!els.dropdown.contains(e.target) && e.target !== els.city) {
      els.dropdown.style.display = "none";
    }
  });
})();
</script>
</body></html>`;
