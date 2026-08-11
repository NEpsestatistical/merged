function closeLightbox(e){ if(e) e.stopPropagation(); document.getElementById("lightbox").classList.remove("show"); }
function closeModals(){
  document.getElementById("overlay-bg").classList.remove("show");
  document.getElementById("new-post-modal").classList.remove("show");
  document.getElementById("detail-modal").classList.remove("show");
  document.getElementById("chat-modal").classList.remove("show");
  document.getElementById("signout-modal").classList.remove("show");
  document.getElementById("profile-modal").classList.remove("show");
  state.activeChatId = null;
}

/* ================= STATIC UI ================= */
function buildStaticUI(){
  document.getElementById("tf-grid").innerHTML = TIMEFRAMES.map(tf=>`<div class="tf-btn" onclick="selectTimeframe('${tf}', this)">${tf}</div>`).join("");
  const chips = [["all","All"],["bullish","▲ Bullish"],["neutral","● Neutral"],["bearish","▼ Bearish"]];
  document.getElementById("filter-chips").innerHTML = chips.map(([v,l],i)=>`<span class="chip ${i===0?'active':''}" data-s="${v}" onclick="setFilter('${v}', this)">${l}</span>`).join("");
  setupDropZone();
}

/* ================= HOME / SOCIAL / SECURITY ================= */
const SOCIAL_LINKS = [
  { name:"YouTube",  sub:"Elliott Wave with Statistical", url:"https://www.youtube.com/@NepseElliottwaveanalysis", color:"#FF0000", icon:"▶" },
  { name:"Instagram", sub:"@ewt_aashish",        url:"https://www.instagram.com/ewt_aashish/", color:"#E1306C", icon:"📷" },
  { name:"Discord",   sub:"Community server",    url:"https://discord.gg/ryhbrjAFn", color:"#5865F2", icon:"💬" }
];
function renderSocialGrid(){
  document.getElementById("social-grid").innerHTML = SOCIAL_LINKS.map(s=>`
    <a class="social-link" href="${s.url}" target="_blank" rel="noopener noreferrer">
      <div class="si" style="background:${s.color}">${s.icon}</div>
      <div><div class="sl-name">${escapeHtml(s.name)}</div><div class="sl-sub">${escapeHtml(s.sub)}</div></div>
    </a>
  `).join("");
}
async function changePasswordFromHome(){
  if(!requireSupabase()) return;
  const input = document.getElementById("home-new-password");
  const pw = input.value;
  if(pw.length < 6){ showToast("Password should be at least 6 characters."); return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if(error){ showToast(error.message); return; }
  input.value = "";
  showToast("Password updated ✅");
}
function renderHomePanel(){
  if(!state.currentUser) return;
  document.getElementById("home-acct-info").innerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", state.currentUser.avatarUrl) +
    `<div><div style="font-weight:700; font-size:14px;">${escapeHtml(state.currentUser.name)}</div><div style="font-size:12px; color:var(--ink-faint);">${escapeHtml(state.currentUser.email||"")}</div></div>`;
  const avatarPreview = document.getElementById("home-avatar-preview");
  if(avatarPreview) avatarPreview.innerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", state.currentUser.avatarUrl);
  renderSocialGrid();
  document.getElementById("asc-current-email").textContent = "Signed in as " + (state.currentUser.email||"");
  const nameInput = document.getElementById("home-edit-name");
  const handleInput = document.getElementById("home-edit-handle");
  if(nameInput && document.activeElement !== nameInput) nameInput.value = state.currentUser.name || "";
  if(handleInput && document.activeElement !== handleInput) handleInput.value = state.currentUser.handle || "";
}
async function saveProfileFromHome(){
  if(!requireSupabase()) return;
  const note = document.getElementById("home-edit-note");
  const name = document.getElementById("home-edit-name").value.trim();
  const handle = document.getElementById("home-edit-handle").value.trim();
  if(!name){ showToast("Name can't be empty."); return; }
  if(!handle || handle.length < 3){ showToast("Username must be at least 3 characters."); return; }

  // Check uniqueness (excluding self) before attempting the update.
  const { data: existing, error: checkErr } = await sb.from("profiles")
    .select("id").eq("handle", handle).neq("id", state.currentUser.id).maybeSingle();
  if(checkErr){ showToast(checkErr.message); return; }
  if(existing){ if(note) note.textContent = "That username is already taken — try another."; showToast("Username already taken."); return; }

  const { data, error } = await sb.from("profiles")
    .update({ name, handle })
    .eq("id", state.currentUser.id)
    .select().maybeSingle();
  if(error){ showToast(error.message); return; }

  state.currentUser.name = data.name;
  state.currentUser.handle = data.handle;
  if(note) note.textContent = "Letters, numbers, and underscores only. Your username must be unique.";
  showToast("Profile updated ✅");
  renderHomePanel();
  const myAvatarEl = document.getElementById("my-avatar");
  if(myAvatarEl) myAvatarEl.outerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", state.currentUser.avatarUrl).replace('class="avatar "','id="my-avatar" class="avatar" onclick="openProfile(state.currentUser.id)" title="View your profile"');
}

/* ================= TRENDING ================= */
function renderTrending(){
  const scores = {};
  for(const p of state.posts){
    if((p.reports||0) >= 5) continue;
    const t = (p.ticker||"").toUpperCase().trim();
    if(!t) continue;
    if(!scores[t]) scores[t] = { ticker:t, posts:0, likes:0, comments:0, bullish:0, bearish:0, topPost:null };
    scores[t].posts += 1;
    scores[t].likes += (p.likes||0);
    scores[t].comments += (p.comments||[]).length;
    if(p.sentiment==="bullish") scores[t].bullish++;
    if(p.sentiment==="bearish") scores[t].bearish++;
    // Track the single best post for this ticker (most liked, ties broken by newest) so the row can open it directly.
    if(!scores[t].topPost || (p.likes||0) > (scores[t].topPost.likes||0) ||
       ((p.likes||0) === (scores[t].topPost.likes||0) && new Date(p.createdAt) > new Date(scores[t].topPost.createdAt))){
      scores[t].topPost = p;
    }
  }
  const ranked = Object.values(scores)
    .map(s => ({ ...s, score: s.posts*3 + s.likes*2 + s.comments }))
    .sort((a,b)=>b.score-a.score)
    .slice(0,20);
  const listEl = document.getElementById("trend-list");
  if(!ranked.length){
    listEl.innerHTML = `<div class="empty-state"><div class="em">🔥</div><p>Nothing trending yet.<br>Post a chart to get things moving.</p></div>`;
    return;
  }
  listEl.innerHTML = ranked.map((s,i)=>{
    const lean = s.bullish===s.bearish ? "Mixed" : (s.bullish>s.bearish ? "▲ Bullish lean" : "▼ Bearish lean");
    return `<div class="trend-row ${i===0?'r1':i===1?'r2':i===2?'r3':''}" style="cursor:pointer;" onclick="openDetail('${s.topPost.id}')" title="View top $${escapeHtml(s.ticker)} post">
      <div class="trend-rank">${i+1}</div>
      <div class="trend-main"><div class="tt">$${escapeHtml(s.ticker)}</div><div class="tm">${s.posts} post${s.posts>1?'s':''} · ${lean}</div></div>
      <div class="trend-score"><div class="ts-val">${s.score}</div><div class="ts-lbl">${s.likes}♥ · ${s.comments}💬</div></div>
    </div>`;
  }).join("");
}

/* ================= LIVE NEWS (RSS via public CORS proxy, no key required) ================= */
const NEWS_FEEDS = {
  nepal: [
    // Direct feed, confirmed serving real application/rss+xml.
    { name:"Online Khabar", url:"https://www.onlinekhabar.com/feed" },
    // kathmandupost.com and thehimalayantimes.com no longer expose working public RSS endpoints
    // (the old /author/rss and /rss_2.php paths now return HTML or a JS challenge page), so we
    // pull their latest coverage through Google News' site-scoped search feed instead.
    { name:"Kathmandu Post", url:"https://news.google.com/rss/search?q=when:2d+site:kathmandupost.com&hl=en-NP&gl=NP&ceid=NP:en" },
    { name:"Himalayan Times", url:"https://news.google.com/rss/search?q=when:2d+site:thehimalayantimes.com&hl=en-NP&gl=NP&ceid=NP:en" },
    { name:"Setopati", url:"https://news.google.com/rss/search?q=when:2d+site:setopati.com&hl=en-NP&gl=NP&ceid=NP:en" },
    // Catch-all top stories for Nepal, so anything the site-specific feeds miss still shows up.
    { name:"Nepal Top Stories", url:"https://news.google.com/rss/headlines/section/geo/Nepal?hl=en-NP&gl=NP&ceid=NP:en" }
  ],
  world: [
    { name:"BBC World", url:"https://feeds.bbci.co.uk/news/world/rss.xml" },
    { name:"Al Jazeera", url:"https://www.aljazeera.com/xml/rss/all.xml" },
    { name:"The Guardian", url:"https://www.theguardian.com/world/rss" },
    { name:"NYT World", url:"https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
    // Reuters retired its public RSS feeds, so their wire coverage comes through Google News instead.
    { name:"Reuters", url:"https://news.google.com/rss/search?q=when:1d+site:reuters.com&hl=en-US&gl=US&ceid=US:en" },
    { name:"Top World Stories", url:"https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" }
  ]
};
const CORS_PROXIES = [
  u => ({ url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(u), json:false }),
  u => ({ url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u), json:false }),
  u => ({ url: "https://corsproxy.io/?url=" + encodeURIComponent(u), json:false }),
  u => ({ url: "https://api.allorigins.win/get?url=" + encodeURIComponent(u), json:true }),
  u => ({ url: "https://r.jina.ai/" + u, json:false }),
  u => ({ url: "https://thingproxy.freeboard.io/fetch/" + u, json:false })
];
function fetchWithTimeout(url, ms){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(()=>clearTimeout(t));
}
const newsCache = { nepal:null };
function textOf(node, selector){
  const el = node.querySelector(selector);
  return el ? (el.textContent || "").trim() : "";
}
function parseRssXml(xmlText){
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if(doc.querySelector("parsererror")) throw new Error("Bad XML");
  const isAtom = !!doc.querySelector("feed > entry");
  const nodes = isAtom ? Array.from(doc.querySelectorAll("entry")) : Array.from(doc.querySelectorAll("item"));
  return nodes.map(n => {
    let link = "";
    if(isAtom){
      const linkEl = n.querySelector("link[href]");
      link = linkEl ? linkEl.getAttribute("href") : "";
    } else {
      link = textOf(n, "link");
    }
    let img = "";
    const media = n.querySelector("media\\:content, media\\:thumbnail, enclosure[type^='image']");
    if(media) img = media.getAttribute("url") || "";
    if(!img){
      const desc = textOf(n, "description") || textOf(n, "summary") || textOf(n, "content");
      const m = desc.match(/<img[^>]+src="([^"]+)"/i);
      if(m) img = m[1];
    }
    const pub = textOf(n,"pubDate") || textOf(n,"published") || textOf(n,"updated");
    return {
      title: textOf(n,"title"),
      link,
      thumbnail: img,
      pubDate: pub
    };
  });
}
async function fetchRssItems(feedUrl){
  let lastErr;

  // Try rss2json first — purpose-built for this, generally more reliable than generic CORS proxies.
  try{
    const r2jUrl = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feedUrl);
    const res = await fetchWithTimeout(r2jUrl, 8000);
    if(res.ok){
      const data = await res.json();
      if(data.status === "ok" && Array.isArray(data.items) && data.items.length){
        return data.items.map(it => ({
          title: it.title || "",
          link: it.link || "",
          thumbnail: it.thumbnail || it.enclosure?.link || "",
          pubDate: it.pubDate || ""
        }));
      }
    }
  }catch(e){ lastErr = e; }

  // try a direct fetch next, in case the feed itself allows CORS
  try{
    const res = await fetchWithTimeout(feedUrl, 6000);
    if(res.ok){
      const items = parseRssXml(await res.text());
      if(items.length) return items;
    }
  }catch(e){ lastErr = e; }

  for(const build of CORS_PROXIES){
    const { url, json } = build(feedUrl);
    try{
      const res = await fetchWithTimeout(url, 9000);
      if(!res.ok) throw new Error("HTTP "+res.status);
      let text;
      if(json){
        const data = await res.json();
        text = data.contents || "";
      } else {
        text = await res.text();
      }
      const items = parseRssXml(text);
      if(items.length) return items;
      lastErr = new Error("No items parsed");
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("Feed unreachable");
}
function newsCardHtml(item, sourceName){
  const img = item.thumbnail || "";
  let dateStr = "";
  if(item.pubDate){
    const d = new Date(item.pubDate);
    if(!isNaN(d.getTime())) dateStr = timeAgo(d.toISOString());
  }
  return `<a class="news-card" href="${item.link}" target="_blank" rel="noopener noreferrer">
    ${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="nc-body">
      <div class="nc-src">${escapeHtml(sourceName)}</div>
      <div class="nc-title">${escapeHtml(item.title||"")}</div>
      <div class="nc-time">${dateStr}</div>
    </div>
  </a>`;
}
async function loadNepalNews(force){
  const grid = document.getElementById("nepal-news-grid");
  if(newsCache.nepal && !force){ grid.innerHTML = newsCache.nepal; return; }
  grid.innerHTML = `<div class="loading">Loading Nepal news…</div>`;
  const results = await Promise.allSettled(NEWS_FEEDS.nepal.map(f => fetchRssItems(f.url).then(items=>({ f, items }))));
  let cards = [];
  for(const r of results){
    if(r.status==="fulfilled"){
      const { f, items } = r.value;
      cards.push(...items.slice(0,12).map(it => ({ it, src: f.name, ts: new Date(it.pubDate).getTime()||0 })));
    } else {
      console.warn("Nepal news source failed:", r.reason);
    }
  }
  if(!cards.length){
    grid.innerHTML = `<div class="empty-state"><div class="em">📡</div><p>Couldn't load Nepal news right now.<br>The news sources may be unreachable from this browser.</p><button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="loadNepalNews(true)">Retry</button></div>`;
    return;
  }
  cards.sort((a,b)=>b.ts-a.ts);
  const html = cards.slice(0,30).map(c=>newsCardHtml(c.it, c.src)).join("");
  newsCache.nepal = html;
  document.getElementById("nepal-news-grid").innerHTML = html;
}
let activeWorldSource = "all";
function renderWorldNewsTabs(){
  const tabs = [{ key:"all", label:"All" }, ...NEWS_FEEDS.world.map(f=>({ key:f.name, label:f.name }))];
  document.getElementById("world-news-tabs").innerHTML = tabs.map(t=>
    `<span class="chip ${activeWorldSource===t.key?'active':''}" onclick="setWorldSource('${t.key.replace(/'/g,"")}')">${escapeHtml(t.label)}</span>`
  ).join("");
}
function setWorldSource(key){ activeWorldSource = key; renderWorldNewsTabs(); renderWorldNewsGrid(); }
let worldNewsCards = [];
async function loadWorldNews(force){
  renderWorldNewsTabs();
  const grid = document.getElementById("world-news-grid");
  if(worldNewsCards.length && !force){ renderWorldNewsGrid(); return; }
  grid.innerHTML = `<div class="loading">Loading world news…</div>`;
  const results = await Promise.allSettled(NEWS_FEEDS.world.map(f => fetchRssItems(f.url).then(items=>({ f, items }))));
  worldNewsCards = [];
  for(const r of results){
    if(r.status==="fulfilled"){
      const { f, items } = r.value;
      worldNewsCards.push(...items.slice(0,14).map(it => ({ it, src: f.name, ts: new Date(it.pubDate).getTime()||0 })));
    } else {
      console.warn("World news source failed:", r.reason);
    }
  }
  if(!worldNewsCards.length){
    grid.innerHTML = `<div class="empty-state"><div class="em">📡</div><p>Couldn't load world news right now.<br>The news sources may be unreachable from this browser.</p><button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="loadWorldNews(true)">Retry</button></div>`;
    return;
  }
  worldNewsCards.sort((a,b)=>b.ts-a.ts);
  renderWorldNewsGrid();
}
function renderWorldNewsGrid(){
  const grid = document.getElementById("world-news-grid");
  const cards = activeWorldSource==="all" ? worldNewsCards : worldNewsCards.filter(c=>c.src===activeWorldSource);
  grid.innerHTML = cards.length ? cards.slice(0,36).map(c=>newsCardHtml(c.it, c.src)).join("") : `<div class="empty-state"><p>No articles from this source right now.</p></div>`;
}

/* ================= BOOT ================= */
async function bootApp(){
  const fy = document.getElementById("footer-year"); if(fy) fy.textContent = new Date().getFullYear();
  document.getElementById("my-avatar").outerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", state.currentUser.avatarUrl).replace('class="avatar "','id="my-avatar" class="avatar" onclick="openProfile(state.currentUser.id)" title="View your profile"');
  loadLocal();
  await loadAllData();
  renderWatchlist();
  renderFeed();
  renderTape();
  renderNotifBadges();
  startPriceAutoRefresh();
  showTab("home");
}

async function init(){
  buildStaticUI();
  if(!storageAvailable){
    document.getElementById("feed").innerHTML = `<div class="empty-state"><div class="em">🔌</div><p>Local storage isn't available in this browser.</p></div>`;
  }
  if(!supabaseReady){
    document.getElementById("login-note-fallback")?.remove();
    showToast("Add your Supabase URL & anon key in the code to enable real accounts.");
    return; // login gate stays visible; forms will explain what's missing when used.
  }

  // Password-recovery links land here with a Supabase auth event, not a normal session —
  // catch that and show the "set a new password" card instead of logging straight in.
  sb.auth.onAuthStateChange((event, session) => {
    if(event === "PASSWORD_RECOVERY"){
      document.getElementById("pw-reset-overlay").classList.add("show");
    }
    if(event === "SIGNED_IN" && session?.user && !state.currentUser){
      onSignedIn(session.user);
    }
    if(event === "SIGNED_OUT"){
      clearCurrentUser();
    }
  });

  try{
    const { data: { session } } = await sb.auth.getSession();
    if(session?.user){
      await onSignedIn(session.user);
    }
    // otherwise the login gate stays visible until the person signs in / signs up.
  }catch(e){
    // A blip here (network hiccup, transient RLS/db error, etc.) does NOT mean the
    // person got signed out — their Supabase session in localStorage is untouched.
    // Show the login gate with a retry instead of silently stranding them, and
    // never call clearCurrentUser()/signOut() here.
    console.error("Session restore error:", e);
    document.getElementById("login-gate").classList.remove("hide");
    showToast("Couldn't restore your session — check your connection and refresh to retry.");
  }
}
init().catch(e=>{
  console.error("Init error:", e);
  showToast("Something went wrong loading the app — check the console.");
});

