const CALL_MOVE_THRESHOLD_PCT = 0.3; // moves smaller than this count as a "push", not a win or loss

function callOutcome(sentiment, pctChange){
  if(sentiment === "bullish"){
    if(pctChange > CALL_MOVE_THRESHOLD_PCT) return "win";
    if(pctChange < -CALL_MOVE_THRESHOLD_PCT) return "loss";
    return "push";
  }
  if(sentiment === "bearish"){
    if(pctChange < -CALL_MOVE_THRESHOLD_PCT) return "win";
    if(pctChange > CALL_MOVE_THRESHOLD_PCT) return "loss";
    return "push";
  }
  // neutral call: win if price stayed roughly range-bound, loss if it broke out either direction
  return Math.abs(pctChange) < CALL_MOVE_THRESHOLD_PCT*2 ? "win" : "loss";
}

function perfBadgeHtml(post, live, loading){
  if(post.entryPrice == null) return ""; // posted before tracking existed, or entry price unavailable — untracked
  if(loading) return `<span class="badge tf" data-perf-post="${post.id}" style="opacity:.6;">tracking…</span>`;
  if(!live){
    return `<span class="badge tf" data-perf-post="${post.id}" title="Couldn't fetch current price to score this call">— untracked</span>`;
  }
  const current = parseFloat(live.price);
  const pct = ((current - post.entryPrice) / post.entryPrice) * 100;
  const outcome = callOutcome(post.sentiment, pct);
  const icon = outcome==="win" ? "✓" : outcome==="loss" ? "✕" : "•";
  const cls = outcome==="win" ? "bullish" : outcome==="loss" ? "bearish" : "neutral";
  const sign = pct>=0 ? "+" : "";
  return `<span class="badge ${cls}" data-perf-post="${post.id}" title="Entry $${post.entryPrice} → now $${current}">${icon} ${sign}${pct.toFixed(1)}% since posted</span>`;
}

// After a feed/detail/profile render, fill in each post's performance badge asynchronously —
// dedupes ticker lookups so posting five NVDA calls only costs one live-price fetch.
async function hydrateCallPerformance(posts){
  const tracked = posts.filter(p => p.entryPrice != null);
  if(!tracked.length) return;
  const tickers = [...new Set(tracked.map(p=>p.ticker))];
  const results = await Promise.all(tickers.map(t => fetchLivePrice(t)));
  const priceByTicker = {}; tickers.forEach((t,i)=> priceByTicker[t]=results[i]);
  tracked.forEach(p => {
    const el = document.querySelector(`[data-perf-post="${p.id}"]`);
    if(!el) return;
    const live = priceByTicker[p.ticker];
    el.outerHTML = perfBadgeHtml(p, live && live.live ? live : null, false);
  });
}

// Win rate across a set of posts (e.g. one trader's history) — pushes are excluded from the
// percentage (they're neither a win nor a loss) but still counted toward "tracked".
async function computeWinRate(posts){
  const tracked = posts.filter(p => p.entryPrice != null);
  if(!tracked.length) return null;
  const tickers = [...new Set(tracked.map(p=>p.ticker))];
  const results = await Promise.all(tickers.map(t => fetchLivePrice(t)));
  const priceByTicker = {}; tickers.forEach((t,i)=> priceByTicker[t]=results[i]);
  let wins=0, losses=0, pushes=0, unresolved=0;
  tracked.forEach(p=>{
    const live = priceByTicker[p.ticker];
    if(!live || !live.live){ unresolved++; return; }
    const pct = ((parseFloat(live.price) - p.entryPrice) / p.entryPrice) * 100;
    const outcome = callOutcome(p.sentiment, pct);
    if(outcome==="win") wins++; else if(outcome==="loss") losses++; else pushes++;
  });
  const decided = wins+losses;
  return { wins, losses, pushes, unresolved, total: tracked.length, winRate: decided ? Math.round((wins/decided)*100) : null };
}

/* ================= IMAGE HANDLING ================= */
function compressImage(file, maxDim=1000, quality=0.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w >= h){ h = Math.round(h*maxDim/w); w = maxDim; } else { w = Math.round(w*maxDim/h); h = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function handleFile(file){
  if(!file) return;
  if(!file.type || !file.type.startsWith("image/")){ showToast("Please choose an image file"); return; }
  try{
    const dataUrl = await compressImage(file);
    state.newPost.image = dataUrl;
    const dz = document.getElementById("drop-zone");
    dz.classList.add("has-img");
    dz.innerHTML = `<img src="${dataUrl}" alt="preview">`;
  }catch(e){
    showToast("Couldn't read that image: " + (e && e.message ? e.message : "unknown error"));
  }
}
function setupDropZone(){
  const dz = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  if(!dz || !fileInput) return;
  ["dragenter","dragover"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dz.style.borderColor = "var(--gold)"; }));
  ["dragleave","drop"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dz.style.borderColor = ""; }));
  dz.addEventListener("drop", e => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(file) handleFile(file);
  });
}

/* ================= NEW POST ================= */
function openNewPost(){
  state.newPost = { image:null, timeframe:null, sentiment:null };
  document.getElementById("drop-zone").classList.remove("has-img");
  document.getElementById("drop-zone").innerHTML = `<div class="dz-label"><span class="em">📊</span>Tap to upload a chart screenshot</div>`;
  document.getElementById("in-ticker").value = "";
  document.getElementById("in-caption").value = "";
  document.getElementById("posting-as").innerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "sm", state.currentUser.avatarUrl) + `<span>${escapeHtml(state.currentUser.name)}</span>`;
  document.querySelectorAll("#tf-grid .tf-btn").forEach(b=>b.classList.remove("sel"));
  document.querySelectorAll("#sent-control .seg-btn").forEach(b=>b.classList.remove("sel"));
  document.getElementById("overlay-bg").classList.add("show");
  document.getElementById("new-post-modal").classList.add("show");
}
function selectTimeframe(tf, el){ state.newPost.timeframe = tf; document.querySelectorAll("#tf-grid .tf-btn").forEach(b=>b.classList.toggle("sel", b===el)); }
function selectSentiment(s){ state.newPost.sentiment = s; document.querySelectorAll("#sent-control .seg-btn").forEach(b=>b.classList.toggle("sel", b.dataset.s===s)); }

async function submitPost(){
  const ticker = document.getElementById("in-ticker").value.trim();
  const caption = document.getElementById("in-caption").value.trim();
  if(!state.newPost.image){ showToast("Add a chart image first"); return; }
  if(!ticker){ showToast("Enter a ticker symbol"); return; }
  if(!state.newPost.sentiment){ showToast("Pick a sentiment"); return; }
  if(!state.newPost.timeframe){ showToast("Pick a timeframe"); return; }
  if(!requireSupabase()) return;

  const btn = document.getElementById("submit-btn"); btn.disabled = true; btn.textContent = "Posting…";
  try{
    const { data, error } = await sb.from("posts").insert({
      author_id: state.currentUser.id,
      ticker, sentiment: state.newPost.sentiment, timeframe: state.newPost.timeframe,
      caption, image_data_url: state.newPost.image,
    }).select().maybeSingle();
    if(error) throw error;
    state.posts.unshift({
      id: data.id, ticker: data.ticker, sentiment: data.sentiment, timeframe: data.timeframe,
      caption: data.caption || "", imageDataUrl: data.image_data_url,
      authorId: data.author_id, author: state.currentUser.name, createdAt: data.created_at,
      likes: 0, comments: [],
      entryPrice: null, entryPriceLive: false,
    });
    closeModals(); renderFeed(); renderTape();
    showToast("Posted to the feed 📈");

    // Grab the entry price in the background so the post itself isn't held up waiting
    // on a third-party price API — attach it to the post once it comes back.
    (async () => {
      try{
        const snap = await fetchLivePrice(ticker.toUpperCase());
        if(!snap.live) return;
        const entryPrice = parseFloat(snap.price);
        const { error: updErr } = await sb.from("posts")
          .update({ entry_price: entryPrice, entry_price_live: true })
          .eq("id", data.id);
        if(updErr) return;
        const local = state.posts.find(p => p.id === data.id);
        if(local){ local.entryPrice = entryPrice; local.entryPriceLive = true; renderFeed(); renderTape(); }
      }catch(e){ /* untracked, no big deal */ }
    })();
  }catch(e){ showToast("Couldn't post: " + (e.message||"try again")); }
  btn.disabled = false; btn.textContent = "Post to Feed";
}

/* ================= FEED ================= */
function setFilter(f, el){ state.filter = f; document.querySelectorAll("#filter-chips .chip").forEach(c=>c.classList.toggle("active", c===el)); renderFeed(); }
function setSort(v){ state.sort = v; renderFeed(); }
function visiblePosts(){
  let list = state.posts.filter(p => (p.reports||0) < 5);
  if(state.filter !== "all") list = list.filter(p => p.sentiment === state.filter);
  list = [...list].sort((a,b)=> state.sort==="top" ? (b.likes-a.likes) : (new Date(b.createdAt)-new Date(a.createdAt)));
  return list;
}
function renderFeed(){
  const hiddenCount = state.posts.filter(p => (p.reports||0) >= 5).length;
  const list = visiblePosts();
  const feedEl = document.getElementById("feed");
  if(!storageAvailable){
    feedEl.innerHTML = `<div class="empty-state"><div class="em">🔌</div><p>Local storage isn't available in this browser.<br>Posts can't be saved or shown here.</p></div>`;
    return;
  }
  if(list.length===0){
    feedEl.innerHTML = `<div class="empty-state"><div class="em">📭</div><p>No charts posted yet.<br>Be the first to share your analysis.</p></div>`;
    return;
  }
  feedEl.innerHTML = list.map(p => `
    <div class="post-card" onclick="openDetail('${p.id}')">
      <div class="post-thumb">
        <img src="${p.imageDataUrl}" alt="${escapeHtml(p.ticker)} chart" loading="lazy">
        <div class="sent-badge ${p.sentiment}">${sentArrow(p.sentiment)} $${escapeHtml(p.ticker)}</div>
        <div class="tf-badge">${escapeHtml(p.timeframe)}</div>
      </div>
      <div class="post-body">
        ${p.caption ? `<div class="post-caption">${escapeHtml(p.caption)}</div>` : ""}
        ${p.entryPrice != null ? `<div>${perfBadgeHtml(p, null, true)}</div>` : ""}
        <div class="post-meta">
          <span class="post-author">${avatarHtml(p.author, colorFor(p.authorId||p.author), "sm")}${escapeHtml(p.author)} · ${timeAgo(p.createdAt)}</span>
          <span class="post-stats"><span>❤ ${p.likes||0}</span><span>💬 ${(p.comments||[]).length}</span></span>
        </div>
      </div>
    </div>
  `).join("") + (hiddenCount>0 ? `<div class="hidden-note">${hiddenCount} post${hiddenCount>1?"s":""} hidden after community reports</div>` : "");
  hydrateCallPerformance(list);
}

/* ================= TICKER TAPE ================= */
function renderTape(){
  const tape = document.getElementById("tape");
  const track = document.getElementById("tape-track");
  const recent = [...state.posts].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,10);
  if(recent.length===0){ tape.classList.add("empty"); track.innerHTML = `<div class="tape-seg">Waiting for the first post…</div>`; return; }
  tape.classList.remove("empty");
  const seg = p => `<div class="tape-seg ${p.sentiment==='bullish'?'bull':p.sentiment==='bearish'?'bear':''}"><b>$${escapeHtml(p.ticker)}</b> ${sentArrow(p.sentiment)} ${p.sentiment}</div>`;
  const html = recent.map(seg).join("");
  track.innerHTML = html + html;
}

/* ================= POST DETAIL ================= */
// Shows the poster's avatar, name, @handle, bio, and Message/Follow buttons — same building
// blocks used in the Friends tab — so anyone viewing a post can see who posted it and act on it.
function authorProfileRowHtml(p){
  const u = p.authorId ? userById(p.authorId) : null;
  const isSelf = state.currentUser && p.authorId === state.currentUser.id;
  if(!u){
    // Fallback for posts without a resolvable profile (e.g. author left, or demo data).
    return `<div class="author-row">${avatarHtml(p.author, colorFor(p.authorId||p.author), "sm")}Posted by ${escapeHtml(p.author)} · ${timeAgo(p.createdAt)}</div>`;
  }
  return `<div class="person-row" style="padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin:4px 0 2px;">
    <div style="cursor:pointer; display:flex; align-items:center; gap:10px; flex:1; min-width:0;" onclick="openProfile('${u.id}')">
      ${avatarHtml(u.name, u.color, "", u.avatar_url)}
      <div class="person-info">
        <div class="pn">${escapeHtml(u.name)}${isSelf ? " (you)" : ""}</div>
        <div class="ph">@${escapeHtml(u.handle||"")} · ${timeAgo(p.createdAt)}</div>
        ${u.bio ? `<div class="pb">${escapeHtml(u.bio)}</div>` : ""}
      </div>
    </div>
    <div class="person-actions">${isSelf ? "" : personActionButtons(u)}</div>
  </div>`;
}
function openDetail(id){
  const p = state.posts.find(x=>x.id===id); if(!p) return;
  const isMine = state.currentUser && p.authorId === state.currentUser.id;
  const liked = state.likedPosts.includes(id);
  document.getElementById("detail-body").innerHTML = `
    <img class="detail-img" src="${p.imageDataUrl}" alt="${escapeHtml(p.ticker)} chart" onclick="openLightbox('${p.imageDataUrl.replace(/'/g,"\\'")}')">
    <div class="badge-row">
      <span class="badge ${p.sentiment}">${sentArrow(p.sentiment)} $${escapeHtml(p.ticker)}</span>
      <span class="badge tf">${escapeHtml(p.timeframe)}</span>
      ${perfBadgeHtml(p, null, true)}
    </div>
    ${p.caption ? `<div class="detail-caption">${escapeHtml(p.caption)}</div>` : ""}
    ${authorProfileRowHtml(p)}
    <div class="detail-actions">
      <button class="btn ${liked?'btn-outline-bull':'btn-ghost'}" onclick="toggleLike('${p.id}')">❤ ${p.likes||0}</button>
      <button class="btn btn-ghost" onclick="reportPost('${p.id}')">🚩 Report</button>
      ${isMine ? `<button class="btn btn-outline-bear" onclick="deletePost('${p.id}')">🗑 Delete</button>` : ""}
    </div>
    <div class="comments-title">Comments (${(p.comments||[]).length})</div>
    <div id="comments-list">${renderComments(p)}</div>
    <div class="comment-form">
      <input type="text" id="comment-input" placeholder="Add a comment…">
      <button class="btn btn-gold" onclick="addComment('${p.id}')">Send</button>
    </div>
  `;
  document.getElementById("overlay-bg").classList.add("show");
  document.getElementById("detail-modal").classList.add("show");
  hydrateCallPerformance([p]);
}
function renderComments(p){
  if(!(p.comments||[]).length) return `<div style="font-size:13px; color:var(--ink-faint); padding:4px 0 8px;">No comments yet — start the discussion.</div>`;
  return p.comments.map(c=>`<div class="comment"><span class="ca">${escapeHtml(c.author)}</span><span class="ct">${timeAgo(c.createdAt)}</span><div class="cb">${escapeHtml(c.text)}</div></div>`).join("");
}
async function toggleLike(id){
  const p = state.posts.find(x=>x.id===id); if(!p) return;
  if(!requireSupabase()) return;
  const me = state.currentUser.id;
  const liked = state.likedPosts.includes(id);
  try{
    if(liked){
      const { error } = await sb.from("post_likes").delete().eq("post_id", id).eq("user_id", me);
      if(error) throw error;
      state.likedPosts = state.likedPosts.filter(x=>x!==id);
      p.likes = Math.max(0, (p.likes||0) - 1);
    } else {
      const { error } = await sb.from("post_likes").insert({ post_id: id, user_id: me });
      if(error) throw error;
      state.likedPosts.push(id);
      p.likes = (p.likes||0) + 1;
    }
  }catch(e){ showToast(e.message||"Couldn't update like"); return; }
  openDetail(id); renderFeed();
}
async function reportPost(id){
  const p = state.posts.find(x=>x.id===id); if(!p) return;
  if(!requireSupabase()) return;
  const { error } = await sb.from("post_reports").insert({ post_id: id, reporter_id: state.currentUser.id });
  if(error){ showToast(error.message.includes("duplicate") ? "You've already reported this post." : error.message); return; }
  showToast("Thanks — reported for review.");
  closeModals(); renderFeed();
}
async function deletePost(id){
  if(!confirm("Delete this post? This can't be undone.")) return;
  if(!requireSupabase()) return;
  const { error } = await sb.from("posts").delete().eq("id", id).eq("author_id", state.currentUser.id);
  if(error){ showToast(error.message); return; }
  state.posts = state.posts.filter(p=>p.id!==id);
  closeModals(); renderFeed(); renderTape();
  showToast("Post deleted");
}
async function addComment(id){
  const input = document.getElementById("comment-input");
  const text = input.value.trim(); if(!text) return;
  const p = state.posts.find(x=>x.id===id); if(!p) return;
  if(!requireSupabase()) return;
  const { data, error } = await sb.from("post_comments").insert({
    post_id: id, author_id: state.currentUser.id, text,
  }).select().maybeSingle();
  if(error){ showToast(error.message); return; }
  p.comments = p.comments || [];
  p.comments.push({ id: data.id, author: state.currentUser.name, text: data.text, createdAt: data.created_at });
  input.value = "";
  openDetail(id); renderFeed();
}

/* ================= FRIENDS / FOLLOW (Supabase) ================= */
function relationshipState(otherId){
  const following = followSet().has(otherId), follower = followerSet().has(otherId);
  if(following && follower) return "friends";
  if(following) return "following";
  if(follower) return "follower";
  return "none";
}
async function followUser(otherId){
  if(!requireSupabase()) return;
  const { error } = await sb.from("follows").insert({ follower_id: state.currentUser.id, following_id: otherId });
  if(error){ showToast(error.message); return; }
  await loadSocialData();
  renderFriendsPanel(); renderNotifBadges(); renderMessagesPanel();
  const u = userById(otherId);
  showToast("Following " + u.name + (followerSet().has(otherId) ? " 🤝 you're now friends" : ""));
}
async function unfollowUser(otherId){
  if(!requireSupabase()) return;
  const { error } = await sb.from("follows").delete().eq("follower_id", state.currentUser.id).eq("following_id", otherId);
  if(error){ showToast(error.message); return; }
  await loadSocialData();
  renderFriendsPanel(); renderNotifBadges(); renderMessagesPanel();
}
function personActionButtons(u){
  const rel = relationshipState(u.id);
  const followBtn = rel==="following" || rel==="friends"
    ? `<button class="btn btn-ghost btn-sm" onclick="unfollowUser('${u.id}')">Unfollow</button>`
    : `<button class="btn btn-gold btn-sm" onclick="followUser('${u.id}')">＋ Follow</button>`;
  return `<button class="btn btn-outline-bull btn-sm" onclick="openChat('${u.id}')">Message</button>${followBtn}`;
}
function filterBySearch(list, q){
  if(!q) return list;
  return list.filter(u => {
    const name = (u.name||"").toLowerCase();
    const handle = (u.handle||"").toLowerCase();
    const nameStartsWith = name.split(/\s+/).some(word => word.startsWith(q));
    return name.startsWith(q) || nameStartsWith || handle.startsWith(q) || ("@"+handle).startsWith(q);
  });
}
function personRowHtml(u, extraNote){
  return `<div class="person-row">
    <div style="cursor:pointer; display:flex; align-items:center; gap:10px; flex:1; min-width:0;" onclick="openProfile('${u.id}')">
      ${avatarHtml(u.name, u.color, "", u.avatar_url)}
      <div class="person-info">
        <div class="pn">${escapeHtml(u.name)}</div>
        <div class="ph">@${escapeHtml(u.handle||"")}</div>
        ${u.bio ? `<div class="pb">${escapeHtml(u.bio)}</div>` : ""}
        ${extraNote ? `<div class="pb">${extraNote}</div>` : ""}
      </div>
    </div>
    <div class="person-actions">${personActionButtons(u)}</div>
  </div>`;
}
function emptyRow(text){ return `<div class="empty-state" style="padding:24px 10px;"><p>${text}</p></div>`; }
