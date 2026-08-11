/* ================= SUPABASE CONFIG =================
   1. Create a free project at https://supabase.com
   2. Project Settings → API → copy "Project URL" and "anon public" key below.
   3. Run schema.sql (provided alongside this file) in the Supabase SQL editor.
   4. Authentication → URL Configuration → add this page's URL as a Redirect URL
      (needed for password-reset links and Google sign-in to come back here).
   5. (Optional) Authentication → Providers → enable Google, add your OAuth
      client id/secret, to make the "Continue with Google" button work.
================================================== */
const SUPABASE_URL = "https://bfuatuhoosiwaugcxhjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdWF0dWhvb3Npd2F1Z2N4aGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzIxNTksImV4cCI6MjEwMTg0ODE1OX0.0eGEG6MDysnAx8P08xdf9hQxzBTl1erQRNxFOh4ZQDI";
const supabaseReady = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";
const sb = supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ================= CONFIG ================= */
const TIMEFRAMES = ["Scalp","Day","Swing","Position"];
const storageAvailable = typeof window !== "undefined" && !!window.indexedDB;

const DEMO_ACCOUNTS = [];

const REPLY_BANK = [
  "Yeah, watching that level too — waiting on a retest before adding.",
  "Volume's thin on this move, I'd want confirmation first.",
  "That's roughly where my invalidation sits as well.",
  "Trimmed half my size into that pop, letting the rest ride.",
  "Curious what timeframe you're on, looks different on the daily.",
  "Solid read, I've got a similar bias on this one.",
  "I'd wait for a clean close through that zone before adding size.",
  "Appreciate you sharing the chart, mind if I borrow this setup? 😄",
  "Clean level. Momentum's diverging too on my end.",
  "Neutral here until we get more data this week.",
  "That lines up with the flow I'm seeing on my end.",
  "Been eyeing the same zone — good catch."
];

const AVATAR_PALETTE = ["#F0B90B","#16C784","#EA3943","#5B7083","#8E7CC3","#2FB8E8","#E88D4C"];

/* ================= STATE ================= */
const state = {
  posts: [], users: [],
  currentUser: null,             // { id, name, email, handle, color } — id is the Supabase auth user id
  following: [],                 // profiles the current user follows
  followers: [],                 // profiles that follow the current user
  allProfiles: [],                // every profile (for search/suggestions)
  messages: [],                  // messages in the currently open conversation
  convoSummaries: [],            // last message + unread count per conversation, for the Messages list
  filter: "all", sort: "newest",
  activeTab: "feed",
  activeChatId: null,
  msgChannel: null,               // realtime subscription handle
  newPost: { image:null, timeframe:null, sentiment:null },
  myPosts: [], likedPosts: [],
  priceCache: {},                // ticker -> { price, chg, live, ts }
  priceFailCount: {},            // ticker -> consecutive fetch failure count (drives backoff)
};
function followSet(){ return new Set(state.following.map(p=>p.id)); }
function followerSet(){ return new Set(state.followers.map(p=>p.id)); }
function isMutualFriend(id){ return followSet().has(id) && followerSet().has(id); }
function mutualFriends(){ return state.following.filter(p=>followerSet().has(p.id)); }

/* ================= UTIL ================= */
function uid(){ return Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8); }
function timeAgo(iso){
  const s = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(s<10) return "just now";
  if(s<60) return s+"s ago";
  if(s<3600) return Math.floor(s/60)+"m ago";
  if(s<86400) return Math.floor(s/3600)+"h ago";
  return Math.floor(s/86400)+"d ago";
}
function shortTime(iso){ return new Date(iso).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
function escapeHtml(str){ const d=document.createElement("div"); d.textContent=str||""; return d.innerHTML; }
function showToast(msg){
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(showToast._id); showToast._id=setTimeout(()=>t.classList.remove("show"),2000);
}
function sentArrow(s){ return s==="bullish"?"▲":s==="bearish"?"▼":"●"; }
function initials(name){ return (name||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase(); }
function hashStr(str){ let h=0; for(const c of String(str)) h=(h*31 + c.charCodeAt(0))>>>0; return h; }
function colorFor(seed){ return AVATAR_PALETTE[hashStr(seed)%AVATAR_PALETTE.length]; }
function avatarHtml(name, color, size, avatarUrl){
  if(avatarUrl) return `<div class="avatar ${size||''}" style="background:${color}; padding:0; overflow:hidden;"><img src="${avatarUrl}" alt="${escapeHtml(name)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;"></div>`;
  return `<div class="avatar ${size||''}" style="background:${color}">${escapeHtml(initials(name))}</div>`;
}
function convoId(a,b){ return [a,b].sort().join("::"); }

/* ================= STORAGE (IndexedDB — local to this browser) ================= */
