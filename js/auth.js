
function requireSupabase(){
  if(!supabaseReady){
    setEmailMsg("This app isn't connected to Supabase yet — add your project URL & anon key in the SUPABASE CONFIG section of the code.");
    return false;
  }
  return true;
}
function setEmailMsg(text, ok){
  const el = document.getElementById("email-login-msg");
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok);
}
function readEmailForm(){
  const email = document.getElementById("email-login-email").value.trim().toLowerCase();
  const password = document.getElementById("email-login-password").value;
  return { email, password };
}
function validEmail(email){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

async function emailSignUp(){
  if(!requireSupabase()) return;
  const { email, password } = readEmailForm();
  if(!validEmail(email)){ setEmailMsg("Enter a valid email address."); return; }
  if(password.length < 6){ setEmailMsg("Password should be at least 6 characters."); return; }
  const namePart = email.split("@")[0].replace(/[^a-zA-Z0-9]+/g," ").trim();
  const name = namePart.split(" ").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ") || "Trader";
  const { data, error } = await sb.auth.signUp({ email, password, options:{ data:{ name } } });
  if(error){ setEmailMsg(error.message); return; }
  if(data.session){
    setEmailMsg("Account created — signing you in…", true);
    await onSignedIn(data.session.user);
  } else {
    setEmailMsg("Check your inbox to confirm your email, then sign in.", true);
  }
}
async function emailSignIn(){
  if(!requireSupabase()) return;
  const { email, password } = readEmailForm();
  if(!validEmail(email)){ setEmailMsg("Enter a valid email address."); return; }
  if(!password){ setEmailMsg("Enter your password."); return; }
  setEmailMsg("Signing in…", true);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ setEmailMsg(error.message); return; }
  setEmailMsg("Signed in — welcome back…", true);
  await onSignedIn(data.user);
}
async function emailForgotPassword(){
  if(!requireSupabase()) return;
  const { email } = readEmailForm();
  if(!validEmail(email)){ setEmailMsg("Enter your email above first, then tap Forgot password."); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split("#")[0] });
  if(error){ setEmailMsg(error.message); return; }
  setEmailMsg("Password reset email sent — check your inbox for the link.", true);
}
async function googleSignIn(){
  if(!requireSupabase()) return;
  const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: window.location.href.split("#")[0] } });
  if(error){
    // Supabase returns a generic "provider is not enabled" (or similar 4xx) when Google OAuth
    // hasn't been turned on for this project yet — that's a setup step, not something the person
    // signing in can fix, so say so plainly instead of surfacing the raw API error text.
    const msg = /provider is not enabled|unsupported provider|validation_failed/i.test(error.message)
      ? "Google sign-in isn't set up for this app yet — enable the Google provider in Supabase (Authentication → Providers) or sign in with email instead."
      : error.message;
    showToast(msg);
  }
}
function submitPasswordReset(){
  const pw = document.getElementById("pw-reset-input").value;
  const msgEl = document.getElementById("pw-reset-msg");
  if(pw.length < 6){ msgEl.textContent = "Password should be at least 6 characters."; return; }
  sb.auth.updateUser({ password: pw }).then(({ error })=>{
    if(error){ msgEl.textContent = error.message; return; }
    document.getElementById("pw-reset-overlay").classList.remove("show");
    showToast("Password updated — you're all set.");
  });
}

// Called once we have a real Supabase auth user (from sign-in, sign-up, or an existing session).
async function onSignedIn(authUser){
  const { profile, isNew } = await ensureProfile(authUser);
  state.currentUser = {
    id: authUser.id,
    name: profile.name,
    email: authUser.email,
    handle: "@" + (profile.handle || ""),
    color: profile.color || colorFor(authUser.email || authUser.id),
    avatarUrl: profile.avatar_url || null,
  };
  saveCurrentUser(state.currentUser);
  closeAccountPicker();
  document.getElementById("login-gate").classList.add("hide");

  if(isNew){
    document.getElementById("ug-name").value = profile.name || "";
    document.getElementById("ug-handle").value = profile.handle || "";
    document.getElementById("ug-msg").textContent = "";
    document.getElementById("username-gate").classList.remove("hide");
    return; // bootApp() runs after they submit the username-setup form
  }

  await bootApp();
}
async function submitUsernameSetup(){
  const msg = document.getElementById("ug-msg");
  const name = document.getElementById("ug-name").value.trim();
  const handle = document.getElementById("ug-handle").value.trim();
  if(!name){ msg.textContent = "Enter a display name."; return; }
  if(!handle || handle.length < 3){ msg.textContent = "Username must be at least 3 characters."; return; }

  const { data: existing, error: checkErr } = await sb.from("profiles")
    .select("id").eq("handle", handle).neq("id", state.currentUser.id).maybeSingle();
  if(checkErr){ msg.textContent = checkErr.message; return; }
  if(existing){ msg.textContent = "That username is already taken — try another."; return; }

  const { data, error } = await sb.from("profiles")
    .update({ name, handle })
    .eq("id", state.currentUser.id)
    .select().maybeSingle();
  if(error){ msg.textContent = error.message; return; }

  state.currentUser.name = data.name;
  state.currentUser.handle = "@" + data.handle;
  saveCurrentUser(state.currentUser);
  document.getElementById("username-gate").classList.add("hide");
  await bootApp();
}
// Fetches this user's profile row, creating it if the signup DB trigger hasn't run yet (or doesn't exist).
// Returns { profile, isNew } — isNew is true for brand-new accounts, whether the row was just
// inserted here or was auto-created moments ago by the schema's on_auth_user_created trigger.
async function ensureProfile(authUser){
  let { data: profile } = await sb.from("profiles").select("*").eq("id", authUser.id).maybeSingle();
  let isNew = false;
  if(!profile){
    isNew = true;
    const name = authUser.user_metadata?.name || (authUser.email||"Trader").split("@")[0];
    const handle = (name.toLowerCase().replace(/[^a-z0-9]+/g,"") || "trader") + authUser.id.slice(0,4);
    const insertRes = await sb.from("profiles").insert({ id: authUser.id, name, handle, color: colorFor(authUser.email||authUser.id) }).select().maybeSingle();
    profile = insertRes.data || { name, handle, color: colorFor(authUser.email||authUser.id) };
  } else if(authUser.created_at && (Date.now() - new Date(authUser.created_at).getTime()) < 60000){
    // Auth account was created less than a minute ago — this is a first-ever sign-in,
    // even though the DB trigger already auto-created the profile row.
    isNew = true;
  }
  return { profile, isNew };
}
function signOut(){
  document.getElementById("overlay-bg").classList.add("show");
  document.getElementById("signout-modal").classList.add("show");
}
function closeSignoutModal(){
  document.getElementById("overlay-bg").classList.remove("show");
  document.getElementById("signout-modal").classList.remove("show");
}
function confirmSignOut(){
  closeSignoutModal();
  if(state.msgChannel){ sb.removeChannel(state.msgChannel); state.msgChannel = null; }
  clearCurrentUser();
  if(supabaseReady) sb.auth.signOut().finally(()=>location.reload());
  else location.reload();
}

/* ================= DATA LOAD ================= */
// Posts, likes, and comments are shared, real data — always loaded from Supabase so every
// signed-in user sees the same feed. (Falls back to empty state if Supabase isn't configured.)
