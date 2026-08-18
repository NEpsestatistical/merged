/* =========================================================
   NEPSE Dashboard — full-market discovery layer
   Populates: #pulseBreadth/#pulseFillUp/#pulseFillDown/#pulseVerdict,
   #gainersTable, #losersTable, #moversTable, #sectorTable

   Uses the SAME worker as dashboard.js (single-symbol quotes) but hits
   its /all endpoint for the full board in one call. Does NOT touch
   WORKER_URL, portfolio storage, or anything in dashboard.js.

   INDEX POINTS — how they're computed, and the honesty limits:
   The worker's /all also returns `index: { date, value, pointChange,
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

   CHANGES IN THIS VERSION:
   1. Market Pulse — total gainer-side contribution vs total loser-side
      contribution (impact-weighted, not just a headcount), with a
      visual bar and a plain-language verdict on who's leading the tape.
   2. Contribution Leaderboard — the old "movers" table (previously
      capped to the top 10) now lists every board symbol with a valid
      impact figure, ranked by contribution magnitude, highest first.
   3. Sector table now ranks by contribution MAGNITUDE (biggest mover,
      whichever direction, first) instead of most-negative-first.
   4. Carried over from the previous update: dedupe by symbol, HTML
      escaping on all scraped strings, retry/backoff on repeated fetch
      failures, and sessionStorage caching so a reload isn't blank.
   ========================================================= */

const MARKET_WORKER_URL = "https://shiny-term-f599.bharatiaashish43.workers.dev";
const MARKET_CACHE_TTL_MS = 45000;
const MARKET_BACKOFF_TTL_MS = 5 * 60000; // after repeated failures, stop hammering the worker for this long
const MARKET_MAX_CONSECUTIVE_FAILS = 3;
const MARKET_SESSION_KEY = "nepse_market_cache_v1";

let _marketCache = { data: null, ts: 0 };
let _marketFailCount = 0;

/* ---------- Formatting helpers ---------- */
function mfmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function mfmtSigned(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = Number(n) >= 0 ? "+" : "";
  return s + mfmt(n, d);
}

// All scraped text (symbol, sector, drags list) must go through this before
// touching innerHTML — it's third-party data, not something we control.
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- sessionStorage persistence, so a reload isn't a blank slate ---------- */
function loadCacheFromSession() {
  try {
    const raw = sessionStorage.getItem(MARKET_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data && parsed.ts) {
      _marketCache = parsed;
    }
  } catch (e) {
    console.warn("[market] could not read session cache:", e.message);
  }
}

function saveCacheToSession() {
  try {
    sessionStorage.setItem(MARKET_SESSION_KEY, JSON.stringify(_marketCache));
  } catch (e) {
    console.warn("[market] could not write session cache:", e.message);
  }
}

/* ---------- Fetch the full board (+ index summary) from the worker's /all endpoint ---------- */
async function fetchFullBoard(force) {
  const effectiveTtl = _marketFailCount >= MARKET_MAX_CONSECUTIVE_FAILS
    ? MARKET_BACKOFF_TTL_MS
    : MARKET_CACHE_TTL_MS;

  if (!force && _marketCache.data && (Date.now() - _marketCache.ts) < effectiveTtl) {
    return _marketCache.data;
  }

  try {
    const res = await fetch(`${MARKET_WORKER_URL}/all`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rawBoard = Array.isArray(json.board) ? json.board : [];

    const seen = new Set();
    const board = rawBoard.filter(r => {
      if (!r.symbol || seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    });

    const index = json.index || null; // { date, value, pointChange, percentChange } | null

    _marketCache = { data: { board, index }, ts: Date.now() };
    _marketFailCount = 0;
    saveCacheToSession();
    return _marketCache.data;
  } catch (e) {
    _marketFailCount += 1;
    console.error(`[market] fetch failed (consecutive fail #${_marketFailCount}):`, e.message);
    if (_marketCache.data) {
      return _marketCache.data;
    }
    throw e;
  }
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

/* ---------- Market Pulse: impact-weighted gainers vs losers verdict ---------- */
function renderMarketPulse(rows, index) {
  const hasPoints = index && !Number.isNaN(index.pointChange);

  const rising = rows.filter(r => r.percentChange > 0);
  const falling = rows.filter(r => r.percentChange < 0);
  const flat = rows.filter(r => r.percentChange === 0);

  const contribValue = r => hasPoints ? (r.pointsContribution || 0) : (r.contributionPct || 0);

  const upImpact = rows
    .filter(r => r.impact !== null && r.impact > 0)
    .reduce((s, r) => s + contribValue(r), 0);
  const downImpact = Math.abs(rows
    .filter(r => r.impact !== null && r.impact < 0)
    .reduce((s, r) => s + contribValue(r), 0));

  const totalImpact = upImpact + downImpact;
  const upShare = totalImpact > 0 ? (upImpact / totalImpact) * 100 : 50;
  const downShare = 100 - upShare;

  const breadthEl = document.getElementById("pulseBreadth");
  const barUp = document.getElementById("pulseFillUp");
  const barDown = document.getElementById("pulseFillDown");
  const verdictEl = document.getElementById("pulseVerdict");

  if (breadthEl) {
    breadthEl.innerHTML = `<span class="up">${rising.length} rising</span> &nbsp;·&nbsp; <span class="down">${falling.length} falling</span> &nbsp;·&nbsp; <span>${flat.length} unchanged</span>`;
  }
  if (barUp) barUp.style.width = `${upShare.toFixed(1)}%`;
  if (barDown) barDown.style.width = `${downShare.toFixed(1)}%`;

  if (verdictEl) {
    const unit = hasPoints ? "pts" : "% of total move";
    const upText = mfmt(upImpact, 1);
    const downText = mfmt(downImpact, 1);

    let lead;
    if (totalImpact === 0) {
      lead = "No net movement to compare yet.";
    } else if (Math.abs(upImpact - downImpact) < (totalImpact * 0.01)) {
      lead = "Gainers and losers are roughly evenly matched right now.";
    } else if (upImpact > downImpact) {
      lead = "Gainers are currently leading the tape.";
    } else {
      lead = "Losers are currently leading the tape.";
    }

    const sourceNote = hasPoints
      ? ` (apportioned from NEPSE's ${index.date} close-to-close change — not live-updating intraday)`
      : " (turnover-weighted impact share — official NEPSE points unavailable this refresh)";

    verdictEl.textContent = `${lead} Gainers: +${upText} ${unit} · Losers: -${downText} ${unit}${sourceNote}.`;
  }
}

/* ---------- Gainers / Losers (top 10 by % change — unchanged) ---------- */
function renderGainersLosers(rows) {
  const ranked = rows.filter(r => r.percentChange !== null).slice().sort((a, b) => b.percentChange - a.percentChange);
  const gainers = ranked.filter(r => r.percentChange > 0).slice(0, 10);
  const losers = ranked.filter(r => r.percentChange < 0).slice(-10).reverse();

  const gainersBody = document.querySelector("#gainersTable tbody");
  const losersBody = document.querySelector("#losersTable tbody");

  gainersBody.innerHTML = gainers.length
    ? gainers.map(r => `
        <tr>
          <td>${escapeHtml(r.symbol)}</td>
          <td>Rs ${mfmt(r.ltp)}</td>
          <td class="up">${mfmtSigned(r.percentChange)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="loading">No gainers today.</td></tr>`;

  losersBody.innerHTML = losers.length
    ? losers.map(r => `
        <tr>
          <td>${escapeHtml(r.symbol)}</td>
          <td>Rs ${mfmt(r.ltp)}</td>
          <td class="down">${mfmtSigned(r.percentChange)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="loading">No losers today.</td></tr>`;
}

/* ---------- Contribution Leaderboard: EVERY stock, ranked by |impact|, highest first ---------- */
function renderMovers(rows, index) {
  const body = document.querySelector("#moversTable tbody");
  const note = document.getElementById("moversNote");

  const hasPoints = index && !Number.isNaN(index.pointChange);

  const ranked = rows
    .filter(r => r.impact !== null)
    .slice()
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  // Deliberately NOT sliced — this is the full-board leaderboard, not a top-10 snapshot.

  if (!ranked.length) {
    body.innerHTML = `<tr><td colspan="4" class="loading">Turnover data unavailable — check the worker's qty field.</td></tr>`;
    if (note) note.textContent = "";
    return;
  }

  body.innerHTML = ranked.map((r, i) => {
    const cls = r.impact >= 0 ? "up" : "down";
    const contribText = hasPoints
      ? `${mfmtSigned(r.pointsContribution, 2)} pts`
      : `${mfmtSigned(r.contributionPct, 2)}%`;
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.symbol)}</td>
        <td class="${cls}">${mfmtSigned(r.percentChange)}%</td>
        <td class="${cls}">${contribText}</td>
      </tr>`;
  }).join("");

  if (note) {
    note.textContent = hasPoints
      ? `Every board symbol, ranked by its apportioned share of NEPSE's official close-to-close change on ${index.date} (${mfmtSigned(index.pointChange)} pts) — highest contribution first, whichever direction. Not NEPSE's own float-adjusted weighting, and not live-updating intraday.`
      : `Every board symbol, ranked by turnover-weighted impact (price change × traded quantity) as a share of total market movement — highest first, whichever direction. Official NEPSE point figure wasn't available this refresh.`;
  }
}

/* ---------- Sector impact: ranked by contribution MAGNITUDE, highest first ---------- */
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
      .map(r => `${escapeHtml(r.symbol)} (${mfmtSigned(r.percentChange)}%)`)
      .join(", ") || "—";

    return { sector, avgChange, falling, total, contributionPct, pointsContribution, drags };
  }).filter(s => s.total > 0)
    .sort((a, b) => {
      const av = Math.abs(hasPoints ? a.pointsContribution : a.contributionPct);
      const bv = Math.abs(hasPoints ? b.pointsContribution : b.contributionPct);
      return bv - av; // biggest mover first, whichever direction
    });

  if (!sectorRows.length) {
    body.innerHTML = `<tr><td colspan="6" class="loading">Sector data unavailable.</td></tr>`;
    if (note) note.textContent = "";
    return;
  }

  body.innerHTML = sectorRows.map((s, i) => {
    const cls = s.avgChange === null ? "" : (s.avgChange >= 0 ? "up" : "down");
    const contribVal = hasPoints ? s.pointsContribution : s.contributionPct;
    const contribCls = contribVal >= 0 ? "up" : "down";
    const contribText = hasPoints ? `${mfmtSigned(s.pointsContribution, 2)} pts` : `${mfmtSigned(s.contributionPct, 2)}%`;
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.sector)}</td>
        <td class="${cls}">${mfmtSigned(s.avgChange)}%</td>
        <td>${s.falling}/${s.total} falling</td>
        <td class="${contribCls}">${contribText}</td>
        <td>${s.drags}</td>
      </tr>`;
  }).join("");

  if (note) {
    note.textContent = hasPoints
      ? `Sectors ranked by total contribution magnitude (sum of each constituent's apportioned share of NEPSE's ${index.date} close-to-close change), biggest mover first — whichever direction.`
      : "Sectors ranked by total turnover-weighted contribution magnitude, biggest mover first — whichever direction.";
  }
}

/* ---------- init ---------- */
function renderAll(board, index) {
  const rows = computeImpact(board, index);
  renderMarketPulse(rows, index);
  renderGainersLosers(rows);
  renderMovers(rows, index);
  renderSectors(rows, index);
}

async function loadMarketDiscovery(force) {
  try {
    const { board, index } = await fetchFullBoard(force);
    if (!board.length) throw new Error("Empty board");
    renderAll(board, index);
  } catch (e) {
    console.error("[market] discovery load failed:", e.message);
    const pb = document.getElementById("pulseBreadth");
    const pv = document.getElementById("pulseVerdict");
    const gb = document.querySelector("#gainersTable tbody");
    const lb = document.querySelector("#losersTable tbody");
    const mb = document.querySelector("#moversTable tbody");
    const sb = document.querySelector("#sectorTable tbody");
    if (pb) pb.textContent = "Data unavailable.";
    if (pv) pv.textContent = "";
    if (gb) gb.innerHTML = `<tr><td colspan="3" class="loading">Data unavailable.</td></tr>`;
    if (lb) lb.innerHTML = `<tr><td colspan="3" class="loading">Data unavailable.</td></tr>`;
    if (mb) mb.innerHTML = `<tr><td colspan="4" class="loading">Market data unavailable — ${escapeHtml(e.message)}</td></tr>`;
    if (sb) sb.innerHTML = `<tr><td colspan="6" class="loading">Market data unavailable — ${escapeHtml(e.message)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadCacheFromSession();
  if (_marketCache.data) {
    try {
      renderAll(_marketCache.data.board, _marketCache.data.index);
    } catch (e) {
      console.warn("[market] failed to paint cached data:", e.message);
    }
  }
  loadMarketDiscovery();
});
