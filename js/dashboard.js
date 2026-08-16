/* =========================================================
   NEPSE Dashboard — data layer
   Uses ONLY the existing single-symbol worker
   (https://shiny-term-f599.bharatiaashish43.workers.dev/?symbol=XXX)
   and the portfolio data already stored in localStorage by
   portfolio.html (key "eePortfoliosV2"). No market-wide feed
   exists, so index/gainers/losers/screener are intentionally
   NOT implemented here — see the "Market-Wide Data" card.
   ========================================================= */

const WORKER_URL = "https://shiny-term-f599.bharatiaashish43.workers.dev";
const WATCHLIST_KEY = "eeDashboardWatchlist";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/* ---------- Fetch a single symbol quote from the worker ---------- */
async function fetchQuote(symbol) {
  const res = await fetch(`${WORKER_URL}/?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  return res.json();
}

/* ---------- Same defensive day-change reader as portfolio.html,
   since the worker's field names for change aren't documented. ---------- */
function getDayChange(p, ltp) {
  if (!p) return null;
  const pct = [p.percentChange, p.perChange, p.changePercent, p.percChange, p.pctChange]
    .find((v) => v !== undefined && v !== null && !Number.isNaN(Number(v)));
  const amtRaw = [p.pointChange, p.change, p.netChange, p.diff, p.priceChange]
    .find((v) => v !== undefined && v !== null && !Number.isNaN(Number(v)));

  let amt = amtRaw !== undefined ? Number(amtRaw) : null;
  let pctNum = pct !== undefined ? Number(pct) : null;

  if (amt === null && pctNum !== null && ltp !== null) {
    amt = ltp - ltp / (1 + pctNum / 100);
  } else if (pctNum === null && amt !== null && ltp !== null) {
    const prevClose = ltp - amt;
    pctNum = prevClose ? (amt / prevClose) * 100 : 0;
  }

  if (amt === null || pctNum === null || Number.isNaN(amt) || Number.isNaN(pctNum)) return null;
  return { amt, pct: pctNum };
}

/* =========================================================
   PORTFOLIO — read the same localStorage the portfolio page writes,
   rebuild holdings with the identical FIFO logic, then fetch live LTPs.
   ========================================================= */

function loadPortfolios() {
  try {
    const raw = localStorage.getItem("eePortfoliosV2");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {}
  return [];
}

function getCurrentPortfolio(portfolios) {
  if (!portfolios.length) return null;
  let currentId = null;
  try { currentId = localStorage.getItem("eeCurrentPortfolioId"); } catch (e) {}
  return portfolios.find((p) => p.id === currentId) || portfolios[0];
}

// FIFO lot matching — identical to portfolio.html's buildHoldingsFromTrades.
function buildHoldingsFromTrades(trades) {
  const bySymbol = {};
  const sorted = [...trades].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  sorted.forEach((t) => {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
    const lots = bySymbol[t.symbol];
    if (t.side.startsWith("b")) {
      lots.push({ qty: t.qty, price: t.price, date: t.date });
    } else if (t.side.startsWith("s")) {
      let remaining = t.qty;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.qty, remaining);
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 0) lots.shift();
      }
    }
  });

  const result = {};
  Object.keys(bySymbol).forEach((symbol) => {
    const lots = bySymbol[symbol].filter((l) => l.qty > 0);
    if (!lots.length) return;
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    const cost = lots.reduce((s, l) => s + l.qty * l.price, 0);
    result[symbol] = { symbol, qty, avgCost: cost / qty };
  });
  return result;
}

async function loadPortfolioSnapshot() {
  const snapshotEl = document.getElementById("portfolioSnapshot");
  const holdingsBody = document.querySelector("#holdingsTable tbody");

  const portfolios = loadPortfolios();
  const current = getCurrentPortfolio(portfolios);

  if (!current || !current.transactions || !current.transactions.length) {
    snapshotEl.innerHTML = `<p class="loading">No portfolio data yet. Add holdings on the Portfolio page.</p>`;
    holdingsBody.innerHTML = `<tr><td colspan="5" class="loading">No holdings yet.</td></tr>`;
    return;
  }

  const holdings = Object.values(buildHoldingsFromTrades(current.transactions));

  if (!holdings.length) {
    snapshotEl.innerHTML = `<p class="loading">No open positions in "${current.name}".</p>`;
    holdingsBody.innerHTML = `<tr><td colspan="5" class="loading">No open positions.</td></tr>`;
    return;
  }

  let quotes = {};
  let fetchFailed = false;
  try {
    const results = await Promise.all(
      holdings.map(async (h) => {
        try { return await fetchQuote(h.symbol); }
        catch (e) { return null; }
      })
    );
    results.forEach((r) => { if (r && r.symbol) quotes[r.symbol] = r; });
  } catch (e) {
    fetchFailed = true;
  }

  let totalInvested = 0, totalValue = 0, todayPL = 0, haveAnyLtp = false;

  holdings.forEach((h) => {
    const q = quotes[h.symbol];
    const ltp = q ? Number(q.ltp) : null;
    totalInvested += h.qty * h.avgCost;
    if (ltp !== null && !Number.isNaN(ltp)) {
      totalValue += h.qty * ltp;
      haveAnyLtp = true;
      const chg = getDayChange(q, ltp);
      if (chg) todayPL += h.qty * chg.amt;
    } else {
      totalValue += h.qty * h.avgCost; // fall back to cost basis if no live price
    }
  });

  const totalPL = totalValue - totalInvested;
  const totalPLPct = totalInvested ? (totalPL / totalInvested) * 100 : 0;

  const plClass = totalPL >= 0 ? "up" : "down";
  const dayClass = todayPL >= 0 ? "up" : "down";

  snapshotEl.innerHTML = `
    <div class="stat">
      <div class="value">Rs ${fmt(totalValue, 0)}</div>
      <div class="label">Portfolio Value${haveAnyLtp ? "" : " (live price unavailable)"}</div>
    </div>
    <div class="stat">
      <div class="value ${plClass}" style="font-size:22px">Rs ${fmt(Math.abs(totalPL), 0)}</div>
      <div class="label">Total P/L (${fmt(totalPLPct, 1)}%)</div>
    </div>
    <div class="stat">
      <div class="value ${dayClass}" style="font-size:22px">Rs ${fmt(Math.abs(todayPL), 0)}</div>
      <div class="label">Today's P/L</div>
    </div>
    <div class="stat">
      <div class="value" style="font-size:22px">Rs ${fmt(totalInvested, 0)}</div>
      <div class="label">Invested</div>
    </div>
  `;

  holdingsBody.innerHTML = holdings.map((h) => {
    const q = quotes[h.symbol];
    const ltp = q ? Number(q.ltp) : null;
    const pl = ltp !== null && !Number.isNaN(ltp) ? (ltp - h.avgCost) * h.qty : null;
    const plClass2 = pl === null ? "" : (pl >= 0 ? "up" : "down");
    return `
      <tr>
        <td>${h.symbol}</td>
        <td>${fmt(h.qty, 0)}</td>
        <td>${fmt(h.avgCost, 2)}</td>
        <td>${ltp !== null ? "Rs " + fmt(ltp, 2) : "—"}</td>
        <td class="${plClass2}">${pl !== null ? "Rs " + fmt(Math.abs(pl), 0) : "Data unavailable"}</td>
      </tr>
    `;
  }).join("");

  if (fetchFailed) {
    holdingsBody.insertAdjacentHTML("beforeend",
      `<tr><td colspan="5" class="loading">Some live prices failed to load — showing cost basis where unavailable.</td></tr>`);
  }
}

/* =========================================================
   WATCHLIST — user-managed symbol list, each fetched individually.
   ========================================================= */

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveWatchlist(list) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); } catch (e) {}
}

async function renderWatchlist() {
  const body = document.querySelector("#watchTable tbody");
  const list = loadWatchlist();

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="4" class="loading">No symbols yet — add one above.</td></tr>`;
    return;
  }

  body.innerHTML = list.map((s) => `<tr><td>${s}</td><td colspan="2" class="loading">Loading...</td><td></td></tr>`).join("");

  const results = await Promise.all(list.map(async (symbol) => {
    try { return { symbol, data: await fetchQuote(symbol) }; }
    catch (e) { return { symbol, data: null, error: true }; }
  }));

  body.innerHTML = results.map(({ symbol, data, error }) => {
    if (error || !data) {
      return `
        <tr>
          <td>${symbol}</td>
          <td colspan="2" class="loading">Data unavailable</td>
          <td><button class="watch-remove-btn" data-symbol="${symbol}" type="button">✕</button></td>
        </tr>`;
    }
    const ltp = data.ltp !== undefined ? Number(data.ltp) : null;
    const chg = getDayChange(data, ltp);
    const chgClass = chg ? (chg.amt >= 0 ? "up" : "down") : "";
    const chgText = chg ? `${fmt(chg.amt, 2)} (${fmt(chg.pct, 2)}%)` : "—";
    return `
      <tr>
        <td>${symbol}</td>
        <td>${ltp !== null ? "Rs " + fmt(ltp, 2) : "—"}</td>
        <td class="${chgClass}">${chgText}</td>
        <td><button class="watch-remove-btn" data-symbol="${symbol}" type="button">✕</button></td>
      </tr>`;
  }).join("");
}

function setupWatchlistControls() {
  const input = document.getElementById("watchInput");
  const addBtn = document.getElementById("watchAddBtn");
  const body = document.querySelector("#watchTable tbody");

  function addSymbol() {
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    const list = loadWatchlist();
    if (!list.includes(symbol)) {
      list.push(symbol);
      saveWatchlist(list);
      renderWatchlist();
    }
    input.value = "";
  }

  addBtn.addEventListener("click", addSymbol);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") addSymbol(); });

  body.addEventListener("click", (e) => {
    const btn = e.target.closest(".watch-remove-btn");
    if (!btn) return;
    const symbol = btn.dataset.symbol;
    const list = loadWatchlist().filter((s) => s !== symbol);
    saveWatchlist(list);
    renderWatchlist();
  });
}

/* ---------- init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  loadPortfolioSnapshot();
  setupWatchlistControls();
  renderWatchlist();
});
