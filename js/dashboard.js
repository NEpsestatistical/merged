/* =========================================================
   NEPSE Dashboard — full-market discovery layer
   Populates: #gainersTable, #losersTable, #moversTable, #sectorTable

   Uses the SAME worker as dashboard.js (single-symbol quotes) but hits
   its /all endpoint for the full board in one call. Does NOT touch
   WORKER_URL, portfolio storage, or anything in dashboard.js.

   INDEX POINTS — how they're computed, and the honesty limits:
   The worker's /all now also returns `index: { date, value, pointChange,
   percentChange }` — the OFFICIAL NEPSE point change, scraped from
   merolagani's real daily index table. That table only updates once a
   trading day fully closes, so during live market hours this is the
   most recently closed day's point change, not a live tick — labeled
   as such in the UI.

   Individual stocks don't come with an official per-stock point-
   contribution figure (that requires float-adjusted market-cap weights,
   which NEPSE doesn't publish and this source doesn't have). So each
   stock's point figure is: its share of total turnover-weighted market
   impact (changeAmount x qty), signed to match its OWN direction, scaled
   to the magnitude of the real index point change:

     pointsContribution_i = sign(impact_i) * (|impact_i| / totalAbsImpact) * |index.pointChange|

   This means a rising stock always shows positive points and a falling
   stock always shows negative points — sized by how much of that day's
   total turnover it accounted for — and the magnitudes are anchored to
   the real NEPSE point move, not an invented number. It is still an
   apportionment model, not NEPSE's own weighting, and is labeled as such.
   ========================================================= */

const MARKET_WORKER_URL = "https://shiny-term-f599.bharatiaashish43.workers.dev";
const MARKET_CACHE_TTL_MS = 45000;

let _marketCache = { data: null, ts: 0 };

function mfmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function mfmtSigned(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = Number(n) >= 0 ? "+" : "";
  return s + mfmt(n, d);
}

/* ---------- Fetch the full board (+ index summary) from the worker's /all endpoint ---------- */
async function fetchFullBoard(force) {
  if (!force && _marketCache.data && (Date.now() - _marketCache.ts) < MARKET_CACHE_TTL_MS) {
    return _marketCache.data;
  }
  const res = await fetch(`${MARKET_WORKER_URL}/all`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rawBoard = Array.isArray(json.board) ? json.board : [];
  // The source page renders each row twice (desktop + mobile markup), so the
  // worker's scraper picks up duplicates. Dedupe by symbol, keeping the first.
  const seen = new Set();
  const board = rawBoard.filter(r => {
    if (!r.symbol || seen.has(r.symbol)) return false;
    seen.add(r.symbol);
    return true;
  });
  const index = json.index || null; // { date, value, pointChange, percentChange } | null
  _marketCache = { data: { board, index }, ts: Date.now() };
  return _marketCache.data;
}

/* ---------- Impact proxy: rupee value moved, % share of movement, and real-point apportionment ---------- */
function computeImpact(board, index) {
  const rows = board
    .filter(r => r.symbol && r.percentChange !== null && r.percentChange !== undefined)
    .map(r => {
      const changeAmount = r.changeAmount !== null && r.changeAmount !== undefined
        ? Number(r.changeAmount)
        : null;
      const qty = r.qty !== null && r.qty !== undefined ? Number(r.qty) : null;
      const impact = (changeAmount !== null && qty !== null && !Number.isNaN(changeAmount) && !Number.isNaN(qty))
        ? changeAmount * qty
        : null;
      return { ...r, impact };
    });

  const totalAbsImpact = rows.reduce((s, r) => s + (r.impact !== null ? Math.abs(r.impact) : 0), 0);
  const indexPointChange = index && !Number.isNaN(index.pointChange) ? Number(index.pointChange) : null;

  return rows.map(r => {
    const contributionPct = (r.impact !== null && totalAbsImpact > 0) ? (r.impact / totalAbsImpact) * 100 : null;
    const pointsContribution = (r.impact !== null && totalAbsImpact > 0 && indexPointChange !== null)
      ? Math.sign(r.impact) * (Math.abs(r.impact) / totalAbsImpact) * Math.abs(indexPointChange)
      : null;
    return { ...r, contributionPct, pointsContribution };
  });
}

/* ---------- Gainers / Losers ---------- */
function renderGainersLosers(rows) {
  const ranked = rows.filter(r => r.percentChange !== null).slice().sort((a, b) => b.percentChange - a.percentChange);
  const gainers = ranked.filter(r => r.percentChange > 0).slice(0, 10);
  const losers = ranked.filter(r => r.percentChange < 0).slice(-10).reverse();

  const gainersBody = document.querySelector("#gainersTable tbody");
  const losersBody = document.querySelector("#losersTable tbody");

  gainersBody.innerHTML = gainers.length
    ? gainers.map(r => `
        <tr>
          <td>${r.symbol}</td>
          <td>Rs ${mfmt(r.ltp)}</td>
          <td class="up">${mfmtSigned(r.percentChange)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="loading">No gainers today.</td></tr>`;

  losersBody.innerHTML = losers.length
    ? losers.map(r => `
        <tr>
          <td>${r.symbol}</td>
          <td>Rs ${mfmt(r.ltp)}</td>
          <td class="down">${mfmtSigned(r.percentChange)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="loading">No losers today.</td></tr>`;
}

/* ---------- Movers (by market impact, shown as index points when available) ---------- */
function renderMovers(rows, index) {
  const body = document.querySelector("#moversTable tbody");
  const note = document.getElementById("moversNote");

  const hasPoints = index && !Number.isNaN(index.pointChange);

  const ranked = rows
    .filter(r => r.impact !== null)
    .slice()
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 10);

  if (!ranked.length) {
    body.innerHTML = `<tr><td colspan="3" class="loading">Turnover data unavailable — check the worker's qty field.</td></tr>`;
    if (note) note.textContent = "";
    return;
  }

  body.innerHTML = ranked.map(r => {
    const cls = r.impact >= 0 ? "up" : "down";
    const contribText = hasPoints
      ? `${mfmtSigned(r.pointsContribution, 2)} pts`
      : `${mfmtSigned(r.contributionPct, 2)}%`;
    return `
      <tr>
        <td>${r.symbol}</td>
        <td class="${cls}">${mfmtSigned(r.percentChange)}%</td>
        <td class="${cls}">${contribText}</td>
      </tr>`;
  }).join("");

  if (note) {
    note.textContent = hasPoints
      ? `Points are apportioned from NEPSE's official close-to-close change on ${index.date} (${mfmtSigned(index.pointChange)} pts), split by each stock's share of total turnover-weighted movement — not NEPSE's own float-adjusted weighting, and not live-updating intraday.`
      : "Index contribution is a turnover-weighted impact proxy (price change × traded quantity, as a share of total market movement) — the official NEPSE point figure wasn't available this refresh.";
  }
}

/* ---------- Sector impact ---------- */
function renderSectors(rows, index) {
  const body = document.querySelector("#sectorTable tbody");
  const note = document.getElementById("sectorNote");
  const hasPoints = index && !Number.isNaN(index.pointChange);

  const bySector = {};
  rows.forEach(r => {
    const sec = r.sector || "Others";
    if (!bySector[sec]) bySector[sec] = [];
    bySector[sec].push(r);
  });

  const sectorRows = Object.keys(bySector).map(sector => {
    const list = bySector[sector];
    const withChange = list.filter(r => r.percentChange !== null);
    const avgChange = withChange.length
      ? withChange.reduce((s, r) => s + r.percentChange, 0) / withChange.length
      : null;
    const falling = withChange.filter(r => r.percentChange < 0).length;
    const total = withChange.length;
    const contributionPct = list.reduce((s, r) => s + (r.contributionPct || 0), 0);
    const pointsContribution = list.reduce((s, r) => s + (r.pointsContribution || 0), 0);
    const drags = list
      .filter(r => r.impact !== null && r.impact < 0)
      .sort((a, b) => a.impact - b.impact)
      .slice(0, 2)
      .map(r => `${r.symbol} (${mfmtSigned(r.percentChange)}%)`)
      .join(", ") || "—";

    return { sector, avgChange, falling, total, contributionPct, pointsContribution, drags };
  }).filter(s => s.total > 0)
    .sort((a, b) => (hasPoints ? a.pointsContribution - b.pointsContribution : a.contributionPct - b.contributionPct)); // worst-impact sectors first

  if (!sectorRows.length) {
    body.innerHTML = `<tr><td colspan="5" class="loading">Sector data unavailable.</td></tr>`;
    if (note) note.textContent = "";
    return;
  }

  body.innerHTML = sectorRows.map(s => {
    const cls = s.avgChange === null ? "" : (s.avgChange >= 0 ? "up" : "down");
    const contribVal = hasPoints ? s.pointsContribution : s.contributionPct;
    const contribCls = contribVal >= 0 ? "up" : "down";
    const contribText = hasPoints ? `${mfmtSigned(s.pointsContribution, 2)} pts` : `${mfmtSigned(s.contributionPct, 2)}%`;
    return `
      <tr>
        <td>${s.sector}</td>
        <td class="${cls}">${mfmtSigned(s.avgChange)}%</td>
        <td>${s.falling}/${s.total} falling</td>
        <td class="${contribCls}">${contribText}</td>
        <td>${s.drags}</td>
      </tr>`;
  }).join("");

  if (note) {
    note.textContent = hasPoints
      ? `Sectors ranked by total apportioned points (sum of each constituent's share of NEPSE's ${index.date} close-to-close change), most negative first.`
      : "Sectors are ranked by total turnover-weighted impact, most negative first.";
  }
}

/* ---------- init ---------- */
async function loadMarketDiscovery(force) {
  try {
    const { board, index } = await fetchFullBoard(force);
    if (!board.length) throw new Error("Empty board");
    const rows = computeImpact(board, index);
    renderGainersLosers(rows);
    renderMovers(rows, index);
    renderSectors(rows, index);
  } catch (e) {
    console.error("[market] discovery load failed:", e.message);
    const gb = document.querySelector("#gainersTable tbody");
    const lb = document.querySelector("#losersTable tbody");
    const mb = document.querySelector("#moversTable tbody");
    const sb = document.querySelector("#sectorTable tbody");
    if (gb) gb.innerHTML = `<tr><td colspan="3" class="loading">Data unavailable.</td></tr>`;
    if (lb) lb.innerHTML = `<tr><td colspan="3" class="loading">Data unavailable.</td></tr>`;
    if (mb) mb.innerHTML = `<tr><td colspan="3" class="loading">Market data unavailable — ${e.message}</td></tr>`;
    if (sb) sb.innerHTML = `<tr><td colspan="5" class="loading">Market data unavailable — ${e.message}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadMarketDiscovery();
});
