const DB_NAME = "ee_social_db";
const DB_VERSION = 1;
let _dbPromise = null;
function openDb(){
  if(_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains("posts")) db.createObjectStore("posts", { keyPath:"id" });
      if(!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath:"id" });
      if(!db.objectStoreNames.contains("friendships")) db.createObjectStore("friendships", { keyPath:"id" });
      if(!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath:"id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}
function idbGetAll(store){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
function idbPut(store, obj){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => resolve(obj);
    tx.onerror = () => reject(tx.error);
  }));
}
function idbDelete(store, id){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/* ================= LOCAL PREFS ================= */
function loadLocal(){
  try{ state.myPosts = JSON.parse(localStorage.getItem("ee_my_posts")||"[]"); }catch(e){ state.myPosts=[]; }
  try{ state.likedPosts = JSON.parse(localStorage.getItem("ee_liked_posts")||"[]"); }catch(e){ state.likedPosts=[]; }
}
function saveLocal(){
  try{ localStorage.setItem("ee_my_posts", JSON.stringify(state.myPosts)); }catch(e){}
  try{ localStorage.setItem("ee_liked_posts", JSON.stringify(state.likedPosts)); }catch(e){}
}
function getSavedUser(){ try{ return JSON.parse(localStorage.getItem("ee_current_user")||"null"); }catch(e){ return null; } }
function saveCurrentUser(u){ try{ localStorage.setItem("ee_current_user", JSON.stringify(u)); }catch(e){} }
function clearCurrentUser(){ try{ localStorage.removeItem("ee_current_user"); }catch(e){} }
function getWatchlist(){
  if(!state.currentUser) return [];
  try{ return JSON.parse(localStorage.getItem("ee_wl_"+state.currentUser.id)||'["SPY","BTCUSD","NVDA"]'); }catch(e){ return []; }
}
function saveWatchlist(list){ try{ localStorage.setItem("ee_wl_"+state.currentUser.id, JSON.stringify(list)); }catch(e){} }

/* ================= AUTH / LOGIN GATE (Supabase) ================= */
function avatarHtmlLight(name){
  return `<div class="avatar sm" style="background:${colorFor(name)}">${escapeHtml(initials(name))}</div>`;
}
// "Add another account" box is just a convenience for switching devices/names in this demo UI;
// real accounts and passwords always live in Supabase, never in the browser.
function openAccountPicker(){
  document.getElementById("acct-manual").classList.add("show");
  document.getElementById("acct-overlay").classList.add("show");
  setTimeout(()=>document.getElementById("manual-name").focus(), 50);
}
function closeAccountPicker(){ document.getElementById("acct-overlay").classList.remove("show"); }
function toggleManualAcct(){ document.getElementById("acct-manual").classList.add("show"); document.getElementById("manual-name").focus(); }
function submitManualAccount(){ closeAccountPicker(); showToast("Use the email form to sign in or create an account."); }

