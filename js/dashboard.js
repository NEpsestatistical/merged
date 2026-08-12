/*
  dashboard.js
  ------------
  Handles everything on the dashboard EXCEPT the portfolio itself:
  - Market index summary (NEPSE index, points change, turnover)
  - Top gainers / top losers tables
  - A small "snapshot" pulled from portfolio.js (if it exposes data)

  Keep this file separate from portfolio.js on purpose:
  - portfolio.js  -> owns all portfolio holdings logic (add/edit/remove, cost basis, etc.)
  - dashboard.js  -> owns market-wide widgets only

  Replace MOCK data / replace fetchMarketData() with a real API call
  (e.g. NEPSE API, a scraper you host, or a Google Sheet published as JSON)
  when you're ready. The render functions don't care where the data comes from,
  as long as it matches the shape shown below.
*/

// ---------- CONFIG ----------
// Swap this with your real API endpoint later.
// e.g. const MARKET_API_URL = "https://your-api.example.com/nepse/summary";
const MARKET_API_URL = null; // null = use mock data

// ---------- MOCK DATA (placeholder until API is wired up) ----------
const MOCK_MARKET_DATA = {
  index: {
    value: 2650.34,
    change: 12.8,
    changePercent: 0.48,
    turnover: "5.2B",
  },
  gainers: [
    { symbol: "NABIL", ltp: 512.0, changePercent: 6.8 },
    { symbol: "NLIC", ltp: 845.5, changePercent: 5.9 },
    { symbol: "SHINE", ltp: 320.1, changePercent: 5.1 },
    { symbol: "CIT", ltp: 2100.0, changePercent: 4.7 },
    { symbol: "UPPER", ltp: 210.2, changePercent: 4.2 },
  ],
  losers: [
    { symbol: "NHPC", ltp: 34.5, changePercent: -5.4 },
    { symbol: "API", ltp: 410.0, changePercent: -4.9 },
    { symbol: "GBIME", ltp: 260.3, changePercent: -3.8 },
    { symbol: "PRVU", ltp: 195.0, changePercent: -3.2 },
    { symbol: "SBL", ltp: 402.8, changePercent: -2.6 },
  ],
};

// ---------- DATA FETCH ----------
async function fetchMarketData() {
  if (!MARKET_API_URL) {
    return MOCK_MARKET_DATA;
  }
  try {
    const res = await fetch(MARKET_API_URL);
    if (!res.ok) throw new Error("Network response not ok");
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch market data, falling back to mock:", err);
    return MOCK_MARKET_DATA;
  }
}

// ---------- RENDER: Index Summary ----------
function renderIndexSummary(index) {
  const el = document.getElementById("indexSummary");
  const isUp = index.change >= 0;
  const sign = isUp ? "+" : "";
  const cls = isUp ? "up" : "down";

  el.innerHTML = `
    <div class="stat">
      <span class="value ${cls}">${index.value.toFixed(2)}</span>
      <span class="label">NEPSE Index</span>
    </div>
    <div class="stat">
      <span class="value ${cls}">${sign}${index.change.toFixed(2)} (${sign}${index.changePercent.toFixed(2)}%)</span>
      <span class="label">Change</span>
    </div>
    <div class="stat">
      <span class="value">${index.turnover}</span>
      <span class="label">Turnover</span>
    </div>
  `;
}

// ---------- RENDER: Gainers / Losers Table ----------
function renderMoversTable(tableId, rows) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading">No data</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const cls = r.changePercent >= 0 ? "up" : "down";
      const sign = r.changePercent >= 0 ? "+" : "";
      return `
        <tr>
          <td>${r.symbol}</td>
          <td>${r.ltp.toFixed(2)}</td>
          <td class="${cls}">${sign}${r.changePercent.toFixed(2)}%</td>
        </tr>
      `;
    })
    .join("");
}

// ---------- RENDER: Portfolio Snapshot ----------
// This reads from a global `window.portfolioData` that portfolio.js is expected
// to set (e.g. window.portfolioData = { totalValue, totalGainLoss, totalGainLossPercent }).
// If portfolio.js hasn't loaded yet or doesn't expose it, we show a fallback message.
function renderPortfolioSnapshot() {
  const el = document.getElementById("portfolioSnapshot");

  if (window.portfolioData) {
    const p = window.portfolioData;
    const cls = p.totalGainLossPercent >= 0 ? "up" : "down";
    const sign = p.totalGainLossPercent >= 0 ? "+" : "";
    el.innerHTML = `
      <div class="stat">
        <span class="value">Rs. ${Number(p.totalValue).toLocaleString()}</span>
        <span class="label">Total Value</span>
      </div>
      <div class="stat">
        <span class="value ${cls}">${sign}${p.totalGainLossPercent.toFixed(2)}%</span>
        <span class="label">Overall Return</span>
      </div>
    `;
  } else {
    el.innerHTML = `<p class="loading">Portfolio data not available yet.</p>`;
  }
}

// ---------- INIT ----------
async function initDashboard() {
  const data = await fetchMarketData();
  renderIndexSummary(data.index);
  renderMoversTable("gainersTable", data.gainers);
  renderMoversTable("losersTable", data.losers);

  // portfolio.js may load after or before this script; try immediately,
  // then retry shortly in case portfolio.js sets window.portfolioData async.
  renderPortfolioSnapshot();
  setTimeout(renderPortfolioSnapshot, 500);
}

document.addEventListener("DOMContentLoaded", initDashboard);
