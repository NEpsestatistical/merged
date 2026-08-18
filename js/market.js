const STOOQ_INDEX_ALIASES = { "SPX":"^spx", "US500":"^spx", "DJI":"^dji", "DOW":"^dji", "NDX":"^ndq",
  "NASDAQ":"^ndq", "VIX":"^vix", "US30":"^dji" };
const PRICE_CACHE_TTL_MS = 45000;
const PRICE_BACKOFF_TTL_MS = 5*60000; // after repeated failures, stop hammering the proxy chain for this long
const PRICE_MAX_CONSECUTIVE_FAILS = 3;

// Resolves a watchlist ticker to the symbol Stooq expects.
// - "AAPL"           -> "aapl.us"     (default: US-listed equities)
// - "SPX" / "NASDAQ"  -> "^spx"/"^ndq" (known indices, see STOOQ_INDEX_ALIASES)
// - "RELIANCE.IN"     -> "reliance.in" (user gave an explicit exchange suffix — passed straight through)
// Stooq's exchange suffixes: .us (US), .uk (LSE), .de (Xetra), .jp (Tokyo), .in (India/NSE), .hk (Hong Kong), etc.
function resolveStooqSymbol(ticker){
  const t = ticker.trim();
  const alias = STOOQ_INDEX_ALIASES[t.toUpperCase()];
  if(alias) return { symbol: alias, explicitExchange: true };
  if(t.includes(".")) return { symbol: t.toLowerCase(), explicitExchange: true };
  return { symbol: t.toLowerCase() + ".us", explicitExchange: false };
}

function priceForFallback(ticker, note){
  // Used only if live data can't be reached (offline, symbol unrecognized, all sources down) —
  // keeps the UI populated instead of showing nothing, clearly marked as not live.
  const h = hashStr(ticker);
  const price = (20 + (h%48000)/100).toFixed(2);
  const chg = (((h>>3)%4000)/100 - 20).toFixed(2);
  return { price, chg: parseFloat(chg), live:false, error: note };
}

function parseStooqCsv(csv){
  const lines = csv.trim().split("\n").map(l=>l.split(","));
  const header = lines[0].map(h=>h.trim().toLowerCase());
  const closeIdx = header.indexOf("close");
  if(closeIdx === -1) throw new Error("Unexpected CSV format");
  const closes = lines.slice(1)
    .map(row => parseFloat(row[closeIdx]))
    .filter(v => !isNaN(v));
  if(!closes.length) throw new Error("No rows");
  return closes;
}

async function fetchStooqPrice(ticker){
  const { symbol, explicitExchange } = resolveStooqSymbol(ticker);
  const d2 = new Date();
  const d1 = new Date(d2.getTime() - 12*24*60*60*1000); // 12 days back so weekends/holidays don't leave us with <2 rows
  const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const stooqUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${fmt(d1)}&d2=${fmt(d2)}&i=d`;

  const attempts = [
    { label:"direct", run: () => fetchWithTimeout(stooqUrl, 6000).then(r => r.ok ? r.text() : Promise.reject(new Error("HTTP "+r.status))) },
    ...CORS_PROXIES.map((build,i) => ({ label:"proxy"+i, run: async () => {
      const { url, json } = build(stooqUrl);
      const res = await fetchWithTimeout(url, 9000);
      if(!res.ok) throw new Error("HTTP "+res.status);
      if(json){ const data = await res.json(); return data.contents; }
      return res.text();
    }}))
  ];

  const errors = [];
  for(const a of attempts){
    try{
      const csv = await a.run();
      if(!csv) throw new Error("Empty response");
      if(csv.trim().startsWith("<")) throw new Error("Got HTML, not CSV (proxy likely blocked/erroring)");
      if(/^\s*Exceeded/i.test(csv) || /Exceeded the daily hits limit/i.test(csv)) throw new Error("Stooq daily limit hit");
      const closes = parseStooqCsv(csv);
      const price = closes[closes.length-1];
      const prev = closes.length > 1 ? closes[closes.length-2] : price;
      const chg = prev ? ((price - prev) / prev) * 100 : 0;
      return { price: price.toFixed(price < 10 ? 4 : 2), chg: parseFloat(chg.toFixed(2)), live:true };
    }catch(e){ errors.push(`${a.label}: ${e.message}`); }
  }
  // Non-US tickers without an explicit ".exchange" suffix are the #1 cause of "unrecognized symbol" —
  // surface that clearly instead of a generic unreachable error, so the person knows what to fix.
  if(!explicitExchange){
    throw new Error(`"${ticker}" not found on US markets — for non-US tickers add the exchange, e.g. "${ticker}.IN" (India), "${ticker}.UK" (London), "${ticker}.HK" (Hong Kong)`);
  }
  throw new Error("Stooq unreachable — " + errors.join(" | "));
}

async function fetchLivePrice(ticker, force){
  const cached = state.priceCache[ticker];
  const fails = state.priceFailCount[ticker] || 0;
  // Back off automatically after repeated failures — an unmapped/dead symbol will otherwise retry
  // through the full proxy chain every 45s forever, which just adds load for no benefit.
  const effectiveTtl = fails >= PRICE_MAX_CONSECUTIVE_FAILS ? PRICE_BACKOFF_TTL_MS : PRICE_CACHE_TTL_MS;
  if(!force && cached && (Date.now() - cached.ts) < effectiveTtl) return cached;

  let result;
  try{
    result = await fetchStooqPrice(ticker);
    state.priceFailCount[ticker] = 0;
  }catch(e){
    console.error(`[watchlist] live price failed for ${ticker}:`, e.message);
    state.priceFailCount[ticker] = fails + 1;
    result = priceForFallback(ticker, e.message);
  }
  result.ts = Date.now();
  state.priceCache[ticker] = result;
  return result;
}

// Runs async fetchers with limited concurrency and a small stagger between starts, instead of
// firing every watchlist ticker's request at once — gentler on the free CORS proxies we depend on.
async function runLimited(items, worker, concurrency=3, staggerMs=120){
  const results = new Array(items.length);
  let next = 0;
  async function lane(){
    while(next < items.length){
      const i = next++;
      if(staggerMs) await new Promise(r=>setTimeout(r, staggerMs));
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency, items.length)}, lane));
  return results;
}

function stooqChartImgUrl(ticker){
  // Stooq's public chart-image endpoint — no key required. Renders a small line chart PNG
  // straight from their servers, so no CORS proxy or extra fetch call is needed for it.
  const symbol = resolveStooqSymbol(ticker).symbol;
  return `https://stooq.com/c/?s=${encodeURIComponent(symbol)}&c=3m&t=l&a=0&b=0&w=280&h=80`;
}
function priceChipHtml(t, data, loading){
  const up = data.chg >= 0;
  const priceStr = loading ? "…" : `$${data.price} ${up?'+':''}${data.chg}%`;
  const nlBadge = (!loading && !data.live) ? ` <span title="${escapeHtml(data.error || 'Live data unavailable')}" style="opacity:.6; cursor:help;">•nl</span>` : '';
  return `<div class="wl-chip" data-ticker="${escapeHtml(t)}">
    <div class="t">${escapeHtml(t)}<button onclick="removeWatchTicker('${t}')" title="Remove">✕</button></div>
    <div class="p ${loading?'':(up?'up':'down')}" style="${loading?'color:var(--ink-faint);':''}">${priceStr}${nlBadge}</div>
    <img class="wl-spark" src="${stooqChartImgUrl(t)}" alt="" loading="lazy" onerror="this.classList.add('hidden')">
  </div>`;
}

async function renderWatchlist(force){
  const list = getWatchlist();
  const row = document.getElementById("wl-row");
  if(!list.length){ row.innerHTML = `<div style="font-size:12px; color:var(--ink-faint); padding:6px 2px;">No tickers yet — add one below.</div>`; return; }

  // Paint instantly from cache (or a loading state) so the UI never looks empty, then patch in fresh data.
  row.innerHTML = list.map(t=>{
    const cached = state.priceCache[t];
    return priceChipHtml(t, cached || {price:0,chg:0,live:false}, !cached);
  }).join("");

  const results = await runLimited(list, t => fetchLivePrice(t, force));
  // Bail if the watchlist changed (or another render started) while we were fetching.
  if(JSON.stringify(getWatchlist()) !== JSON.stringify(list)) return;
  row.innerHTML = list.map((t,i) => priceChipHtml(t, results[i], false)).join("");
}

let priceRefreshTimer = null;
function startPriceAutoRefresh(){
  if(priceRefreshTimer) clearInterval(priceRefreshTimer);
  priceRefreshTimer = setInterval(()=>{
    if(state.activeTab === "feed" && document.visibilityState === "visible") renderWatchlist();
  }, 45000);
}

function addWatchTicker(){
  const input = document.getElementById("wl-input");
  const t = input.value.trim().toUpperCase();
  if(!t) return;
  const list = getWatchlist();
  if(list.includes(t)){ showToast(t+" is already on your watchlist"); return; }
  list.push(t); saveWatchlist(list); input.value=""; renderWatchlist();
}
function removeWatchTicker(t){ saveWatchlist(getWatchlist().filter(x=>x!==t)); renderWatchlist(); }

/* ================= CALL TRACKING (win/loss vs. price at time of posting) ================= */
