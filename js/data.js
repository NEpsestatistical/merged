async function loadAllData(){
  if(supabaseReady && state.currentUser){
    await loadSocialData();
    await loadPostsFromSupabase();
  } else {
    state.posts = [];
  }
}
async function loadPostsFromSupabase(){
  if(!supabaseReady || !state.currentUser){ state.posts = []; return; }
  const me = state.currentUser.id;
  const [{ data: posts, error: postsErr }, { data: likes }, { data: comments }] = await Promise.all([
    sb.from("posts").select("*").order("created_at", { ascending:false }),
    sb.from("post_likes").select("post_id, user_id"),
    sb.from("post_comments").select("*").order("created_at", { ascending:true }),
  ]);
  if(postsErr){ showToast(postsErr.message); state.posts = []; return; }

  const likesByPost = {};
  (likes||[]).forEach(l => { (likesByPost[l.post_id] ||= []).push(l.user_id); });
  const commentsByPost = {};
  (comments||[]).forEach(c => { (commentsByPost[c.post_id] ||= []).push(c); });

  state.likedPosts = (likes||[]).filter(l=>l.user_id===me).map(l=>l.post_id);

  state.posts = (posts||[]).map(p => {
    const author = userById(p.author_id);
    return {
      id: p.id,
      ticker: p.ticker,
      sentiment: p.sentiment,
      timeframe: p.timeframe,
      caption: p.caption || "",
      imageDataUrl: p.image_data_url,
      authorId: p.author_id,
      author: author ? author.name : "Trader",
      createdAt: p.created_at,
      entryPrice: p.entry_price, entryPriceLive: p.entry_price_live,
      likes: (likesByPost[p.id]||[]).length,
      comments: (commentsByPost[p.id]||[]).map(c => ({
        id: c.id,
        author: (userById(c.author_id)||{}).name || "Trader",
        text: c.text,
        createdAt: c.created_at,
      })),
    };
  });
}
async function loadSocialData(){
  const me = state.currentUser.id;
  const [{ data: following }, { data: followers }, { data: allProfiles }] = await Promise.all([
    sb.from("follows").select("following_id, profiles!follows_following_id_fkey(*)").eq("follower_id", me),
    sb.from("follows").select("follower_id, profiles!follows_follower_id_fkey(*)").eq("following_id", me),
    sb.from("profiles").select("*").neq("id", me),
  ]);
  state.following = (following||[]).map(r=>r.profiles).filter(Boolean);
  state.followers = (followers||[]).map(r=>r.profiles).filter(Boolean);
  state.allProfiles = allProfiles || [];
  await loadConvoSummaries();
  subscribeToMessages();
}
function userById(id){
  if(state.currentUser && id===state.currentUser.id) return state.currentUser;
  return state.users.find(u=>u.id===id) || state.allProfiles.find(u=>u.id===id)
    || state.following.find(u=>u.id===id) || state.followers.find(u=>u.id===id)
    || { id, name:"Unknown Trader", color:"#5B7083", handle:"" };
}

/* ================= NAV ================= */
function showTab(tab){
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-"+tab).classList.add("active");
  if(tab==="friends") renderFriendsPanel();
  if(tab==="messages") renderMessagesPanel();
  if(tab==="feed"){ renderWatchlist(); renderFeed(); }
  if(tab==="home") renderHomePanel();
  if(tab==="trending") renderTrending();
  if(tab==="nepal-news") loadNepalNews();
  if(tab==="world-news") loadWorldNews();
}
function onBellClick(){
  showTab(newFollowerCount() ? "friends" : "messages");
}

/* ================= NOTIFICATIONS ================= */
// "New followers" = people following you that you don't follow back yet — closest thing to a
// friend-request style notification under a plain follow/follower model.
function newFollowerCount(){
  if(!state.currentUser) return 0;
  const mine = followSet();
  return state.followers.filter(p=>!mine.has(p.id)).length;
}
function totalUnread(){
  return state.convoSummaries.reduce((sum,c)=>sum+(c.unread||0), 0);
}
function renderNotifBadges(){
  const reqCount = newFollowerCount();
  const msgCount = totalUnread();
  const bellDot = document.getElementById("bell-dot");
  bellDot.textContent = (reqCount+msgCount)>0 ? String(reqCount+msgCount) : "";
  const fb = document.getElementById("friends-badge");
  fb.style.display = reqCount>0 ? "inline-block" : "none"; fb.textContent = reqCount;
  const mb = document.getElementById("messages-badge");
  mb.style.display = msgCount>0 ? "inline-block" : "none"; mb.textContent = msgCount;
}

/* ================= WATCHLIST ================= */
/* ================= LIVE PRICES (no key required) =================
   Yahoo Finance's public chart endpoint now requires an authenticated session (started returning
   401s after its Feb 2025 redesign), so it can't be used unauthenticated anymore. Using instead:
   - Crypto: CoinGecko's simple/price endpoint — free, no key, sends proper CORS headers.
   - Everything else (stocks/ETFs/indices): Stooq's CSV endpoint — free, no key, no CORS headers
     of its own, so it's routed through the same CORS-proxy chain used for the news feeds below.
================================================================================================= */
