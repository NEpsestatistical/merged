/* =========================================================
   Market-wide modules: Top Gainers/Losers, Index Movers, Sector Impact.
   Talks to the SAME Worker your portfolio page uses (WORKER_URL),
   via its existing /all route. Does not modify how portfolio.html
   calls that Worker.
   ========================================================= */

const MARKET_ALL_URL = `${WORKER_URL}/all`;

async function fetchAllQuotes() {
  const res = await fetch(MARKET_ALL_URL);
  if (!res.ok) throw new Error(`Market feed: HTTP ${res.status}`);
  const data = await res.json(); // { updated, board: [{ symbol, ltp, percentChange, changeAmount, qty, sector }] }
  const board = Array.isArray(data.board) ? data.board : [];
  // Normalize field names to what the render functions below expect.
  return board.map((q) => ({
    symbol: q.symbol,
    ltp: q.ltp,
    changePercent: q.percentChange,
    changeAmount: q.changeAmount,
    marketCap: null, // not available from this Worker yet
    sector: q.sector,
  }));
}

function renderGainersLosers(quotes) {
  const gainersBody = document.querySelector("#gainersTable tbody");
  const losersBody = document.querySelector("#losersTable tbody");
  if (!gainersBody || !losersBody) return;

  const valid = quotes.filter((q) => q.symbol && !Number.isNaN(q.changePercent));
  const sorted = [...valid].sort((a, b) => b.changePercent - a.changePercent);

  const topGainers = sorted.slice(0, 10);
  const topLosers = sorted.slice(-10).reverse();

  const rowHtml = (q) => `
    <tr>
      <td>${q.symbol}</td>
      <td>Rs ${fmt(q.ltp, 2)}</td>
      <td class="${q.changePercent >= 0 ? "up" : "down"}">${q.changePercent >= 0 ? "+" : ""}${fmt(q.changePercent, 2)}%</td>
    </tr>
  `;

  gainersBody.innerHTML = topGainers.length
    ? topGainers.map(rowHtml).join("")
    : `<tr><td colspan="3" class="loading">No data.</td></tr>`;

  losersBody.innerHTML = topLosers.length
    ? topLosers.map(rowHtml).join("")
    : `<tr><td colspan="3" class="loading">No data.</td></tr>`;
}

function renderIndexMovers(quotes) {
  const body = document.querySelector("#moversTable tbody");
  const noteEl = document.getElementById("moversNote");
  if (!body) return;

  const withCaps = quotes.filter(
    (q) => q.symbol && q.marketCap && !Number.isNaN(q.marketCap) && !Number.isNaN(q.changePercent)
  );

  if (!withCaps.length) {
    body.innerHTML = `<tr><td colspan="3" class="loading">Market-cap data unavailable — check the Worker's marketCap field.</td></tr>`;
    if (noteEl) noteEl.textContent = "";
    return;
  }

  const totalFloatCap = withCaps.reduce((s, q) => s + q.marketCap, 0);

  const withContribution = withCaps.map((q) => ({
    ...q,
    weight: q.marketCap / totalFloatCap,
    contributionPct: (q.marketCap / totalFloatCap) * q.changePercent,
  }));

  const sorted = [...withContribution].sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct));
  const top = sorted.slice(0, 12);

  body.innerHTML = top.map((q) => `
    <tr>
      <td>${q.symbol}</td>
      <td class="${q.changePercent >= 0 ? "up" : "down"}">${q.changePercent >= 0 ? "+" : ""}${fmt(q.changePercent, 2)}%</td>
      <td class="${q.contributionPct >= 0 ? "up" : "down"}">${q.contributionPct >= 0 ? "+" : ""}${fmt(q.contributionPct, 4)} pts (approx.)</td>
    </tr>
  `).join("");

  if (noteEl) {
    noteEl.textContent = "Contribution is market-cap-weighted, calculated from this feed — not NEPSE's official float-adjusted index weighting.";
  }
}

function renderSectorImpact(quotes) {
  const body = document.querySelector("#sectorTable tbody");
  const noteEl = document.getElementById("sectorNote");
  if (!body) return;

  const valid = quotes.filter((q) => q.symbol && !Number.isNaN(q.changePercent));
  if (!valid.length) {
    body.innerHTML = `<tr><td colspan="5" class="loading">No data.</td></tr>`;
    return;
  }

  const hasCaps = valid.some((q) => q.marketCap && !Number.isNaN(q.marketCap));
  const totalCap = hasCaps
    ? valid.reduce((s, q) => s + (q.marketCap || 0), 0)
    : 0;

  const bySector = {};
  for (const q of valid) {
    const sector = q.sector || "Others";
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(q);
  }

  const sectorRows = Object.entries(bySector).map(([sector, stocks]) => {
    const avgChange = stocks.reduce((s, q) => s + q.changePercent, 0) / stocks.length;

    const sectorContribution = hasCaps
      ? stocks.reduce((s, q) => {
          if (!q.marketCap || Number.isNaN(q.marketCap)) return s;
          return s + (q.marketCap / totalCap) * q.changePercent;
        }, 0)
      : null;

    const worst = [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 2);
    const declinersCount = stocks.filter((q) => q.changePercent < 0).length;

    return { sector, count: stocks.length, avgChange, sectorContribution, declinersCount, worst };
  });

  sectorRows.sort((a, b) => a.avgChange - b.avgChange);

  body.innerHTML = sectorRows.map((r) => {
    const worstList = r.worst
      .map((q) => `${q.symbol} (${q.changePercent >= 0 ? "+" : ""}${fmt(q.changePercent, 2)}%)`)
      .join(", ");
    return `
      <tr>
        <td>${r.sector}</td>
        <td class="${r.avgChange >= 0 ? "up" : "down"}">${r.avgChange >= 0 ? "+" : ""}${fmt(r.avgChange, 2)}%</td>
        <td>${r.declinersCount}/${r.count} falling</td>
        <td>${r.sectorContribution === null ? "—" : `${r.sectorContribution >= 0 ? "+" : ""}${fmt(r.sectorContribution, 4)} pts`}</td>
        <td>${worstList}</td>
      </tr>
    `;
  }).join("");

  if (noteEl) {
    noteEl.textContent = hasCaps
      ? "Sector change is the unweighted average of its constituents; index-point contribution is market-cap-weighted, calculated from this feed — not NEPSE's official float-adjusted weighting."
      : "Sector change is the unweighted average of its constituents. Index-point contribution needs share-count data to compute market cap, which isn't in the feed yet.";
  }
}

async function loadMarketModules() {
  const gainersBody = document.querySelector("#gainersTable tbody");
  const losersBody = document.querySelector("#losersTable tbody");
  const moversBody = document.querySelector("#moversTable tbody");
  const sectorBody = document.querySelector("#sectorTable tbody");
  if (gainersBody) gainersBody.innerHTML = `<tr><td colspan="3" class="loading">Loading market data…</td></tr>`;
  if (losersBody) losersBody.innerHTML = `<tr><td colspan="3" class="loading">Loading market data…</td></tr>`;
  if (moversBody) moversBody.innerHTML = `<tr><td colspan="3" class="loading">Loading market data…</td></tr>`;
  if (sectorBody) sectorBody.innerHTML = `<tr><td colspan="5" class="loading">Loading market data…</td></tr>`;

  try {
    const quotes = await fetchAllQuotes();
    renderGainersLosers(quotes);
    renderIndexMovers(quotes);
    renderSectorImpact(quotes);
  } catch (e) {
    const msg3 = `<tr><td colspan="3" class="loading">Couldn't load market data — check the Worker's /all endpoint.</td></tr>`;
    const msg5 = `<tr><td colspan="5" class="loading">Couldn't load market data — check the Worker's /all endpoint.</td></tr>`;
    if (gainersBody) gainersBody.innerHTML = msg3;
    if (losersBody) losersBody.innerHTML = msg3;
    if (moversBody) moversBody.innerHTML = msg3;
    if (sectorBody) sectorBody.innerHTML = msg5;
  }
}

document.addEventListener("DOMContentLoaded", loadMarketModules);
