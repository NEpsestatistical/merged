
function renderFriendsPanel(){
  if(!state.currentUser) return;
  if(!supabaseReady){
    document.getElementById("suggested-grid").innerHTML = emptyRow("Connect Supabase to see other traders you can add.");
    return;
  }
  const q = (document.getElementById("friend-search").value||"").trim().toLowerCase();

  let suggestions = filterBySearch(state.allProfiles.filter(u=>!followSet().has(u.id)), q);
  suggestions = suggestions.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  document.getElementById("suggested-grid").innerHTML = suggestions.length ? suggestions.map(u=>`
    <div class="person-card">
      <div style="cursor:pointer;" onclick="openProfile('${u.id}')">
        ${avatarHtml(u.name, u.color, "lg", u.avatar_url)}
        <div class="pn">${escapeHtml(u.name)}</div>
        <div class="ph">@${escapeHtml(u.handle||"")}</div>
        <div class="pb">${escapeHtml(u.bio||"Elite Elliott trader")}</div>
      </div>
      <button class="btn btn-gold btn-sm" style="width:100%; justify-content:center;" onclick="followUser('${u.id}')">＋ Follow</button>
    </div>
  `).join("") : `<div class="empty-state" style="padding:20px 10px; grid-column:1/-1;"><p>${q ? 'No traders match your search.' : 'No other traders have signed up yet — invite some friends!'}</p></div>`;
}

/* ================= USER PROFILE (view another trader) ================= */
let profileTabData = { friends: [], following: [], followers: [] };
let profileTabActive = "friends";
async function openProfile(otherId){
  if(!otherId) return;
  if(!state.currentUser){ return; }
  const isSelf = otherId === state.currentUser.id;
  const u = isSelf ? state.currentUser : userById(otherId);
  if(!u){ showToast("Couldn't load that profile."); return; }

  const avatarBlock = isSelf ? `
    <div style="position:relative; display:inline-block;">
      <div id="profile-avatar-wrap">${avatarHtml(u.name, u.color, "lg", u.avatarUrl)}</div>
      <button class="btn btn-gold btn-sm" style="position:absolute; bottom:-4px; right:-4px; border-radius:50%; width:30px; height:30px; padding:0; justify-content:center;" onclick="document.getElementById('avatar-file-input').click()" title="Change profile picture">📷</button>
    </div>
    <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleAvatarUpload(this.files[0])">
  ` : avatarHtml(u.name, u.color, "lg", u.avatar_url);

  profileTabActive = "friends";
  document.getElementById("profile-body").innerHTML = `
    <div style="text-align:center; padding:6px 0 4px;">
      ${avatarBlock}
      <div class="pn" style="font-size:18px; margin-top:10px;">${escapeHtml(u.name)}${isSelf ? " (you)" : ""}</div>
      <div class="ph">@${escapeHtml((u.handle||"").replace(/^@/,""))}</div>
      ${u.bio ? `<div class="pb" style="margin-top:6px;">${escapeHtml(u.bio)}</div>` : ""}
      <div id="profile-winrate" style="margin-top:8px;"></div>
    </div>
    <div class="person-actions" style="justify-content:center; display:flex; gap:8px; margin:14px 0 6px;">
      ${isSelf
        ? `<button class="btn btn-ghost btn-sm" onclick="closeModals(); showTab('home')">✎ Edit profile</button><button class="btn btn-outline-bear btn-sm" onclick="closeModals(); signOut()">Sign out</button>`
        : personActionButtons(u)}
    </div>
    <div id="profile-social-section" style="margin-top:18px;">
      <div class="subtab-row">
        <button class="subtab-btn active" data-psub="friends" onclick="setProfileTab('friends')">Friends</button>
        <button class="subtab-btn" data-psub="following" onclick="setProfileTab('following')">Following</button>
        <button class="subtab-btn" data-psub="followers" onclick="setProfileTab('followers')">Followers</button>
      </div>
      <div id="profile-social-list" style="padding:10px 0;">Loading…</div>
    </div>
    <div id="profile-posts-section" style="margin-top:18px;">
      <div class="comments-title">${isSelf ? "Your Post History" : "Post History"}</div>
      <div id="profile-posts-list" style="padding:8px 0;">Loading…</div>
    </div>
  `;
  document.getElementById("overlay-bg").classList.add("show");
  document.getElementById("profile-modal").classList.add("show");

  // Load friends / following / followers for this profile (self or other).
  if(requireSupabase()){
    try{
      let following, followers;
      if(isSelf){
        following = state.following;
        followers = state.followers;
      } else {
        const [{ data: theirFollowing, error: e1 }, { data: theirFollowers, error: e2 }] = await Promise.all([
          sb.from("follows").select("following_id, profiles!follows_following_id_fkey(*)").eq("follower_id", otherId),
          sb.from("follows").select("follower_id, profiles!follows_follower_id_fkey(*)").eq("following_id", otherId),
        ]);
        if(e1) throw e1; if(e2) throw e2;
        following = (theirFollowing||[]).map(r=>r.profiles).filter(Boolean);
        followers = (theirFollowers||[]).map(r=>r.profiles).filter(Boolean);
      }
      const followingIds = new Set(following.map(p=>p.id));
      const followerIds = new Set(followers.map(p=>p.id));
      profileTabData = {
        friends: following.filter(p=>followerIds.has(p.id)),
        following, followers,
      };
    }catch(e){
      profileTabData = { friends: [], following: [], followers: [] };
    }
    renderProfileSocialList(u, isSelf);
  }

  // Post history.
  const theirPosts = state.posts.filter(p=>p.authorId===otherId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const postsEl = document.getElementById("profile-posts-list");
  if(postsEl){
    postsEl.innerHTML = theirPosts.length ? `
      <div class="feed" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px;">
        ${theirPosts.map(p=>`
          <div class="post-card" onclick="closeModals(); openDetail('${p.id}')">
            <div class="post-thumb"><img src="${p.imageDataUrl}" alt="${escapeHtml(p.ticker)} chart" loading="lazy"></div>
            <div style="padding:8px 10px; display:flex; flex-direction:column; gap:5px;">
              <span class="badge ${p.sentiment}" style="font-size:11px;">${sentArrow(p.sentiment)} $${escapeHtml(p.ticker)}</span>
              ${p.entryPrice != null ? perfBadgeHtml(p, null, true) : ""}
            </div>
          </div>
        `).join("")}
      </div>
    ` : emptyRow(isSelf ? "You haven't posted any charts yet." : `${escapeHtml(u.name)} hasn't posted any charts yet.`);
  }
  hydrateCallPerformance(theirPosts);

  // Win rate — computed from tracked calls only; posts made before this feature existed
  // (no entry_price) aren't counted since there's nothing to score them against.
  const winRateEl = document.getElementById("profile-winrate");
  if(winRateEl){
    computeWinRate(theirPosts).then(stats=>{
      if(!winRateEl.isConnected) return; // profile modal may have closed by the time this resolves
      if(!stats || stats.winRate == null){
        winRateEl.innerHTML = "";
        return;
      }
      const cls = stats.winRate >= 55 ? "bullish" : stats.winRate <= 45 ? "bearish" : "neutral";
      winRateEl.innerHTML = `<span class="badge ${cls}" title="${stats.wins}W · ${stats.losses}L · ${stats.pushes} push${stats.unresolved?` · ${stats.unresolved} pending`:""}">📊 ${stats.winRate}% win rate · ${stats.wins+stats.losses} call${stats.wins+stats.losses===1?"":"s"} scored</span>`;
    });
  }
}
function setProfileTab(tab){
  profileTabActive = tab;
  document.querySelectorAll("#profile-social-section .subtab-btn").forEach(b=>b.classList.toggle("active", b.dataset.psub===tab));
  renderProfileSocialList();
}
function renderProfileSocialList(){
  const listEl = document.getElementById("profile-social-list");
  if(!listEl) return;
  const list = profileTabData[profileTabActive] || [];
  const labels = {
    friends: "No mutual friends yet.",
    following: "Not following anyone yet.",
    followers: "No followers yet.",
  };
  listEl.innerHTML = list.length
    ? list.map(p=>personRowHtml(p)).join("")
    : emptyRow(labels[profileTabActive]);
}
// Upload / change your own profile picture. Compresses the image and stores it as a data URL
// on your profiles row (same approach the chart posts use — no storage bucket required).
async function handleAvatarUpload(file){
  if(!file || !state.currentUser) return;
  if(!requireSupabase()) return;
  try{
    const dataUrl = await compressImage(file, 400, 0.8);
    const { error } = await sb.from("profiles").update({ avatar_url: dataUrl }).eq("id", state.currentUser.id);
    if(error) throw error;
    state.currentUser.avatarUrl = dataUrl;
    saveCurrentUser(state.currentUser);
    const wrap = document.getElementById("profile-avatar-wrap");
    if(wrap) wrap.innerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "lg", dataUrl);
    const myAvatarEl = document.getElementById("my-avatar");
    if(myAvatarEl) myAvatarEl.outerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", dataUrl).replace('class="avatar "','id="my-avatar" class="avatar" onclick="openProfile(state.currentUser.id)" title="View your profile"');
    const avatarPreview = document.getElementById("home-avatar-preview");
    if(avatarPreview) avatarPreview.innerHTML = avatarHtml(state.currentUser.name, state.currentUser.color, "", dataUrl);
    renderFeed();
    showToast("Profile picture updated");
  }catch(e){
    showToast(e.message || "Couldn't upload image");
  }
}

/* ================= DIRECT MESSAGES (Supabase + Realtime) ================= */
// Builds one row per person you've exchanged messages with (most recent first), each with
// a preview of the last message and an unread count — pulled straight from Supabase.
async function loadConvoSummaries(){
  if(!supabaseReady || !state.currentUser) { state.convoSummaries = []; return; }
  const me = state.currentUser.id;
  const { data, error } = await sb.from("messages")
    .select("*")
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .order("created_at", { ascending:false });
  if(error){ console.warn("loadConvoSummaries", error); state.convoSummaries = []; return; }
  const byOther = new Map();
  for(const m of (data||[])){
    const otherId = m.sender_id===me ? m.recipient_id : m.sender_id;
    if(!byOther.has(otherId)) byOther.set(otherId, { otherId, last:m, unread:0 });
    if(m.recipient_id===me && !m.read) byOther.get(otherId).unread++;
  }
  // make sure every profile we know about is at least resolvable via userById
  state.allProfiles.forEach(p=>{ if(!state.users.find(u=>u.id===p.id)) state.users.push(p); });
  state.convoSummaries = Array.from(byOther.values());
}
function renderMessagesPanel(){
  if(!state.currentUser) return;
  const listEl = document.getElementById("convo-list");
  if(!supabaseReady){
    listEl.innerHTML = emptyRow("Connect Supabase to send and receive real direct messages.");
    return;
  }
  if(!state.convoSummaries.length){
    listEl.innerHTML = `<div class="empty-state"><div class="em">💬</div><p>No conversations yet.<br>Message a friend or follower to start one.</p></div>`;
    return;
  }
  listEl.innerHTML = state.convoSummaries.map(c=>{
    const u = userById(c.otherId);
    const mine = c.last.sender_id===state.currentUser.id;
    const preview = (mine?"You: ":"") + c.last.content;
    return `<div class="convo-row ${c.unread?'unread':''}" onclick="openChat('${c.otherId}')">
      ${avatarHtml(u.name, u.color, "", u.avatar_url)}
      <div class="convo-info">
        <div class="cn">${escapeHtml(u.name)}<span class="ctime">${timeAgo(c.last.created_at)}</span></div>
        <div class="clast">${escapeHtml(preview)}</div>
      </div>
      ${c.unread ? `<span class="unread-dot"></span>` : ''}
    </div>`;
  }).join("");
}

async function openChat(otherId){
  if(!requireSupabase()) return;
  state.activeChatId = otherId;
  const u = userById(otherId);
  document.getElementById("chat-avatar").outerHTML = avatarHtml(u.name, u.color, "sm", u.avatar_url).replace('class="avatar sm"','id="chat-avatar" class="avatar sm"');
  document.getElementById("chat-name").textContent = u.name;
  document.getElementById("chat-sub").textContent = "@" + (u.handle||"");
  document.getElementById("chat-thread").innerHTML = `<div class="loading">Loading messages…</div>`;
  document.getElementById("overlay-bg").classList.add("show");
  document.getElementById("chat-modal").classList.add("show");
  await loadChatThread(otherId);
  await markConvoRead(otherId);
  setTimeout(()=>{ const inp=document.getElementById("chat-input"); inp.value=""; inp.focus(); }, 0);
}
async function loadChatThread(otherId){
  const me = state.currentUser.id;
  const { data, error } = await sb.from("messages")
    .select("*")
    .or(`and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`)
    .order("created_at", { ascending:true });
  if(error){ showToast(error.message); return; }
  state.messages = data || [];
  renderChatThread();
}
async function markConvoRead(otherId){
  const { error } = await sb.from("messages").update({ read:true })
    .eq("sender_id", otherId).eq("recipient_id", state.currentUser.id).eq("read", false);
  if(!error){ await loadConvoSummaries(); renderNotifBadges(); renderMessagesPanel(); }
}
function renderChatThread(){
  if(!state.activeChatId) return;
  const thread = document.getElementById("chat-thread");
  let html = state.messages.map(m=>{
    const mine = m.sender_id===state.currentUser.id;
    return `<div class="msg-row ${mine?'me':'them'}"><div><div class="msg-bubble">${escapeHtml(m.content)}</div><span class="msg-time">${shortTime(m.created_at)}</span></div></div>`;
  }).join("");
  if(!state.messages.length) html = `<div style="text-align:center; color:var(--ink-faint); font-size:12.5px; padding:20px 0;">This is the start of your conversation.</div>`;
  thread.innerHTML = html;
  thread.scrollTop = thread.scrollHeight;
}
async function sendChatMessage(){
  if(!state.activeChatId || !requireSupabase()) return;
  const input = document.getElementById("chat-input");
  const content = input.value.trim(); if(!content) return;
  input.value = "";
  const { error } = await sb.from("messages").insert({
    sender_id: state.currentUser.id, recipient_id: state.activeChatId, content
  });
  if(error){ showToast(error.message); return; }
  // Realtime subscription (below) will push this back to us and re-render the thread.
}
// Live-updates: any message sent to or by the current user (from any tab/device) streams in instantly.
function subscribeToMessages(){
  if(!supabaseReady || !state.currentUser) return;
  if(state.msgChannel) sb.removeChannel(state.msgChannel);
  const me = state.currentUser.id;
  state.msgChannel = sb.channel("messages-" + me)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages", filter:`recipient_id=eq.${me}` }, handleIncomingMessage)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages", filter:`sender_id=eq.${me}` }, handleIncomingMessage)
    .subscribe();
}
async function handleIncomingMessage(payload){
  const m = payload.new;
  const otherId = m.sender_id===state.currentUser.id ? m.recipient_id : m.sender_id;
  if(state.activeChatId===otherId){
    state.messages.push(m);
    renderChatThread();
    if(m.recipient_id===state.currentUser.id) markConvoRead(otherId);
  } else if(m.recipient_id===state.currentUser.id){
    showToast("New message from " + userById(m.sender_id).name);
  }
  await loadConvoSummaries();
  renderMessagesPanel(); renderNotifBadges();
}

/* ================= LIGHTBOX / MODALS ================= */
function openLightbox(src){ document.getElementById("lightbox-img").src = src; document.getElementById("lightbox").classList.add("show"); }
