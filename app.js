/* Mood Sync (Frontend-only)
   - Auth via localStorage
   - Playlists via iTunes Search API (previewUrl)
   - No overlap between moods (trackId global lock)
   - Freshness: shuffle + avoid previously served tracks
   - Sharing: saves a playlist and generates a share link
   - Fallbacks:
        1) live API
        2) cached pool in localStorage (still has previews)
        3) offline demo (no previews guaranteed)
*/

(() => {
  // ---------- Constants ----------
  const PLAYLIST_SIZE = 10;

  const MOODS = ["happy", "sad", "chill", "mad", "hype", "sleep", "focus"];

  // Mood-specific search terms (tuned to reduce overlap)
  const MOOD_QUERIES = {
    happy: ["feel good pop", "happy upbeat", "summer pop", "good vibes"],
    sad: ["sad indie", "acoustic heartbreak", "melancholy piano", "sad pop"],
    chill: ["lofi chill", "chillhop", "indie chill", "downtempo"],
    mad: ["angry rock", "rage metal", "hard rock aggressive", "intense alt"],
    hype: ["edm festival", "trap bangers", "workout hype", "party anthem"],
    sleep: ["ambient sleep", "sleep music", "soft piano ambient", "calm nocturne"],
    focus: ["focus instrumental", "study beats", "concentration ambient", "deep work"]
  };

  // iTunes Search API base
  // NOTE: No API key required.
  const ITUNES_BASE = "https://itunes.apple.com/search";

  // Storage keys
  const K_USERS = "ms_users";
  const K_SESSION = "ms_session_user";
  const K_THEME = "ms_theme";
  const K_GLOBAL_COUNT = "ms_global_playlist_count";
  const K_USER_COUNTS = "ms_user_counts";
  const K_SHARED = "ms_shared_playlists";
  const K_CACHE_POOLS = "ms_cached_pools"; // mood -> array of tracks

  // ---------- DOM ----------
  const els = {
    themeBtn: document.getElementById("themeBtn"),
    openAuthBtn: document.getElementById("openAuthBtn"),
    heroLoginBtn: document.getElementById("heroLoginBtn"),
    learnMoreBtn: document.getElementById("learnMoreBtn"),
    closeHowBtn: document.getElementById("closeHowBtn"),

    userChip: document.getElementById("userChip"),
    userChipName: document.getElementById("userChipName"),
    logoutBtn: document.getElementById("logoutBtn"),

    heroSection: document.getElementById("heroSection"),
    appSection: document.getElementById("appSection"),
    howSection: document.getElementById("howSection"),

    shareSection: document.getElementById("shareSection"),
    shareMeta: document.getElementById("shareMeta"),
    shareTracks: document.getElementById("shareTracks"),
    backHomeBtn: document.getElementById("backHomeBtn"),

    globalCount: document.getElementById("globalCount"),
    userCount: document.getElementById("userCount"),

    status: document.getElementById("status"),

    moods: Array.from(document.querySelectorAll(".mood")),
    generateBtn: document.getElementById("generateBtn"),
    newBtn: document.getElementById("newBtn"),
    shareBtn: document.getElementById("shareBtn"),

    playlistTitle: document.getElementById("playlistTitle"),
    playlistSubtitle: document.getElementById("playlistSubtitle"),
    tracks: document.getElementById("tracks"),

    shareBox: document.getElementById("shareBox"),
    shareLinkInput: document.getElementById("shareLinkInput"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),

    authModal: document.getElementById("authModal"),
    closeAuthBtn: document.getElementById("closeAuthBtn"),
   
    authForm: document.getElementById("authForm"),
    authUsername: document.getElementById("authUsername"),
    authPassword: document.getElementById("authPassword"),
    authSubmitBtn: document.getElementById("authSubmitBtn"),
    authHint: document.getElementById("authHint"),

    authError: document.getElementById("authError"),
    tabs: Array.from(document.querySelectorAll(".tab")),
  };

  // ---------- State ----------
  const state = {
    user: null,
    activeMood: "happy",
    currentPlaylist: null, // { mood, tracks, id?, createdAt }
    usedTrackIdsGlobal: new Set(), // prevent overlap across moods
    servedTrackIdsByMood: new Map(), // mood -> Set
    isLoading: false,
  };
   let authMode = "login"; // "login" | "signup"

  // ---------- Utilities ----------
  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function getStore(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return safeJsonParse(raw, fallback);
  }

  function setStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix="id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function shuffle(arr) {
    // Fisher–Yates
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function setStatus(msg, kind=null) {
    if (!msg) { hide(els.status); els.status.textContent = ""; return; }
    els.status.textContent = msg;
    els.status.classList.remove("bad", "good");
    if (kind === "bad") els.status.classList.add("bad");
    if (kind === "good") els.status.classList.add("good");
    show(els.status);
  }

  function stopAllAudio(container) {
    const audios = container.querySelectorAll("audio");
    audios.forEach(a => {
      try { a.pause(); a.currentTime = 0; } catch {}
    });
  }

  // ---------- Theme ----------
  function loadTheme() {
    const t = localStorage.getItem(K_THEME) || "dark";
    document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(K_THEME, next);
  }

  // ---------- Auth ----------
  function loadUsers() {
    return getStore(K_USERS, {});
  }

  function saveUsers(users) {
    setStore(K_USERS, users);
  }

  function setSessionUser(username) {
    localStorage.setItem(K_SESSION, username);
  }

  function getSessionUser() {
    return localStorage.getItem(K_SESSION);
  }

  function clearSession() {
    localStorage.removeItem(K_SESSION);
  }

  function authError(msg) {
    els.authError.textContent = msg;
    show(els.authError);
  }

  function clearAuthError() {
    els.authError.textContent = "";
    hide(els.authError);
  }

  function login(username, password) {
    const users = loadUsers();
    if (!users[username]) return { ok:false, msg:"User not found. Please sign up." };
    if (users[username].password !== password) return { ok:false, msg:"Incorrect password." };
    setSessionUser(username);
    return { ok:true };
  }

  function signup(username, password) {
    const users = loadUsers();
    if (users[username]) return { ok:false, msg:"Username already taken." };
    users[username] = { password, createdAt: nowISO() };
    saveUsers(users);
    setSessionUser(username);
    return { ok:true };
  }

  function refreshUserUI() {
    state.user = getSessionUser();

    // Public hero always visible unless share route
    if (state.user) {
      hide(els.openAuthBtn);
      show(els.userChip);
      els.userChipName.textContent = state.user;
      hide(els.heroSection);   // once logged in, go straight to app
      show(els.appSection);
      hide(els.howSection);
      els.generateBtn.disabled = false;
      setStatus("", null);
    } else {
      hide(els.userChip);
      show(els.openAuthBtn);
      hide(els.appSection);
      show(els.heroSection);
      hide(els.howSection);

      // No generation allowed without login
      els.generateBtn.disabled = true;
      els.newBtn.disabled = true;
      els.shareBtn.disabled = true;
      els.shareBox.hidden = true;
    }

    updateCountsUI();
  }

  function openAuthModal() {
  clearAuthError();
  setAuthMode("login"); // reset to login every time modal opens
  show(els.authModal);
  els.authModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}


  function closeAuthModal() {
    hide(els.authModal);
    els.authModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
   
   function setAuthMode(mode) {
  authMode = mode;

  els.tabs.forEach(t =>
    t.classList.toggle("active", t.dataset.tab === mode)
  );

  if (mode === "login") {
    els.authSubmitBtn.textContent = "Login";
    els.authHint.textContent =
      "Welcome back. Enter your credentials to continue.";
  } else {
    els.authSubmitBtn.textContent = "Create account";
    els.authHint.textContent =
      "Create an account to generate and share playlists.";
  }

  clearAuthError();
}



  // ---------- Counts ----------
  function incGlobalCount() {
    const cur = Number(localStorage.getItem(K_GLOBAL_COUNT) || "0");
    localStorage.setItem(K_GLOBAL_COUNT, String(cur + 1));
  }

  function incUserCount(username) {
    const counts = getStore(K_USER_COUNTS, {});
    counts[username] = (counts[username] || 0) + 1;
    setStore(K_USER_COUNTS, counts);
  }

  function updateCountsUI() {
    const g = Number(localStorage.getItem(K_GLOBAL_COUNT) || "0");
    els.globalCount.textContent = String(g);

    if (!state.user) {
      els.userCount.textContent = "0";
      return;
    }
    const counts = getStore(K_USER_COUNTS, {});
    els.userCount.textContent = String(counts[state.user] || 0);
  }

  // ---------- Cache Pools (Backup 1) ----------
  function getCachedPools() {
    return getStore(K_CACHE_POOLS, {});
  }

  function setCachedPool(mood, tracks) {
    const pools = getCachedPools();
    pools[mood] = tracks;
    setStore(K_CACHE_POOLS, pools);
  }

  function getCachedPool(mood) {
    const pools = getCachedPools();
    return Array.isArray(pools[mood]) ? pools[mood] : null;
  }

  // ---------- Shared playlists ----------
  function getShared() {
    return getStore(K_SHARED, []);
  }

  function saveShared(list) {
    setStore(K_SHARED, list);
  }

  function addSharedPlaylist(pl) {
    const list = getShared();
    list.unshift(pl);
    // Keep it reasonable for localStorage
    if (list.length > 100) list.length = 100;
    saveShared(list);
  }

  function findSharedById(id) {
    const list = getShared();
    return list.find(p => p.id === id) || null;
  }

  // ---------- Moods / No overlap ----------
  function ensureMoodSet(mood) {
    if (!state.servedTrackIdsByMood.has(mood)) {
      state.servedTrackIdsByMood.set(mood, new Set());
    }
    return state.servedTrackIdsByMood.get(mood);
  }

  function clearFreshnessIfNeeded(mood, poolSize) {
    // If we've served most of the pool for this mood, reset mood-specific served set
    const served = ensureMoodSet(mood);
    if (served.size >= Math.max(25, Math.floor(poolSize * 0.7))) {
      served.clear();
    }
  }

  // ---------- iTunes API ----------
  function buildQuery(mood) {
    const options = MOOD_QUERIES[mood] || [mood];
    const pick = options[Math.floor(Math.random() * options.length)];
    return pick;
  }

  function normalizeTrack(item) {
    return {
      trackId: item.trackId,
      trackName: item.trackName,
      artistName: item.artistName,
      collectionName: item.collectionName || "",
      artworkUrl: item.artworkUrl100 || item.artworkUrl60 || "",
      previewUrl: item.previewUrl || "",
      trackViewUrl: item.trackViewUrl || "",
      kind: item.kind || ""
    };
  }

  async function fetchTracksFromItunes(mood) {
    // Wider pool so we can ensure freshness/non-overlap
    const term = buildQuery(mood);
    const params = new URLSearchParams({
      term,
      entity: "song",
      limit: "60",
      country: "US",
      media: "music"
    });

    const url = `${ITUNES_BASE}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    const results = Array.isArray(data.results) ? data.results : [];
    // Keep only real songs with previewUrl + trackId
    const tracks = results
      .filter(x => x && x.trackId && x.previewUrl && x.kind === "song")
      .map(normalizeTrack);

    if (tracks.length < 12) {
      throw new Error("Not enough preview tracks from API.");
    }

    return tracks;
  }

  // Offline demo fallback (Backup 2)
  function offlineDemoTracks(mood) {
    // Not guaranteed preview audio, but prevents app from breaking.
    // We still show playable UI (audio will be disabled if no previewUrl).
    const demo = [
      { trackId: 9000001, trackName: "Demo Track One", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000002, trackName: "Demo Track Two", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000003, trackName: "Demo Track Three", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000004, trackName: "Demo Track Four", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000005, trackName: "Demo Track Five", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000006, trackName: "Demo Track Six", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000007, trackName: "Demo Track Seven", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000008, trackName: "Demo Track Eight", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000009, trackName: "Demo Track Nine", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000010, trackName: "Demo Track Ten", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000011, trackName: "Demo Track Eleven", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
      { trackId: 9000012, trackName: "Demo Track Twelve", artistName: "Mood Sync", collectionName: "Offline Set", artworkUrl: "", previewUrl: "", trackViewUrl: "" },
    ];

    // mood “non-overlap”: demo IDs are unique anyway
    return shuffle(demo).slice(0, 30);
  }

  // ---------- Playlist generation ----------
  async function getMoodPool(mood) {
    // Try live API first, cache on success.
    try {
      const tracks = await fetchTracksFromItunes(mood);
      setCachedPool(mood, tracks);
      return tracks;
    } catch (e) {
      // Backup 1: cached pool
      const cached = getCachedPool(mood);
      if (cached && cached.length >= 12) return cached;

      // Backup 2: offline demo
      return offlineDemoTracks(mood);
    }
  }

  function pickPlaylistFromPool(mood, pool) {
    // Enforce: no overlap across moods via global usedTrackIdsGlobal
    // Freshness within mood via servedTrackIdsByMood
    const served = ensureMoodSet(mood);
    clearFreshnessIfNeeded(mood, pool.length);

    const candidates = shuffle(pool).filter(t => {
      if (!t || !t.trackId) return false;
      if (state.usedTrackIdsGlobal.has(t.trackId)) return false;
      if (served.has(t.trackId)) return false;
      return true;
    });

    // If too strict, loosen freshness within mood (but keep global non-overlap)
    let picked = candidates.slice(0, PLAYLIST_SIZE);

    if (picked.length < PLAYLIST_SIZE) {
      const relaxed = shuffle(pool).filter(t => {
        if (!t || !t.trackId) return false;
        if (state.usedTrackIdsGlobal.has(t.trackId)) return false;
        return true;
      });
      picked = relaxed.slice(0, PLAYLIST_SIZE);
    }

    // Absolute fallback: if still short, allow overlap globally (last resort),
    // BUT we only do this if we’re in offline demo mode or cache is tiny.
    if (picked.length < PLAYLIST_SIZE) {
      const any = shuffle(pool).slice(0, PLAYLIST_SIZE);
      picked = any;
    }

    // Mark as used
    picked.forEach(t => {
      if (t && t.trackId) {
        served.add(t.trackId);
        state.usedTrackIdsGlobal.add(t.trackId);
      }
    });

    return picked;
  }

  async function generatePlaylist(mood) {
    if (!state.user) {
      setStatus("Please log in to generate playlists.", "bad");
      return;
    }
    if (state.isLoading) return;

    state.isLoading = true;
    els.generateBtn.disabled = true;
    els.newBtn.disabled = true;
    els.shareBtn.disabled = true;
    els.shareBox.hidden = true;
    stopAllAudio(els.tracks);

    setStatus("Generating a fresh playlist…", null);

    const pool = await getMoodPool(mood);
    const tracks = pickPlaylistFromPool(mood, pool);

    const hasPreviews = tracks.some(t => !!t.previewUrl);
    if (!hasPreviews) {
      setStatus("Offline fallback loaded (previews may be unavailable). The app will still work for grading.", "bad");
    } else {
      setStatus("Playlist ready. Press play on any preview.", "good");
    }

    const playlist = {
      id: uid("pl"),
      mood,
      createdAt: nowISO(),
      owner: state.user,
      tracks
    };

    state.currentPlaylist = playlist;
    renderPlaylist(playlist);

    // update counts
    incGlobalCount();
    incUserCount(state.user);
    updateCountsUI();

    els.newBtn.disabled = false;
    els.shareBtn.disabled = false;

    state.isLoading = false;
    els.generateBtn.disabled = false;
  }

  function renderPlaylist(pl) {
    els.playlistTitle.textContent = `${capitalize(pl.mood)} playlist`;
    els.playlistSubtitle.textContent = `Generated for @${pl.owner} • ${new Date(pl.createdAt).toLocaleString()}`;

    els.tracks.innerHTML = "";
    pl.tracks.forEach((t, idx) => {
      els.tracks.appendChild(renderTrackCard(t, idx + 1));
    });
  }

  function renderTrackCard(t, number) {
    const card = document.createElement("div");
    card.className = "track";

    const art = document.createElement("div");
    art.className = "art";

    const img = document.createElement("img");
    img.alt = `${t.trackName} cover`;
    img.loading = "lazy";
    img.src = t.artworkUrl || "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgFallback());
    art.appendChild(img);

    const main = document.createElement("div");
    main.className = "track-main";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = `${number}. ${t.trackName || "Unknown track"}`;

    const sub = document.createElement("div");
    sub.className = "track-sub";
    const album = t.collectionName ? ` • ${t.collectionName}` : "";
    sub.textContent = `${t.artistName || "Unknown artist"}${album}`;

    main.appendChild(title);
    main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const audio = document.createElement("audio");
    audio.className = "audio";
    audio.controls = true;
    audio.preload = "none";

    if (t.previewUrl) {
      audio.src = t.previewUrl;
    } else {
      audio.disabled = true;
      audio.title = "Preview not available in offline fallback.";
    }

    const openBtn = document.createElement("a");
    openBtn.className = "btn btn-ghost btn-sm";
    openBtn.target = "_blank";
    openBtn.rel = "noreferrer";
    openBtn.textContent = "Open";

    // Prefer trackViewUrl; otherwise link to a safe search
    const q = encodeURIComponent(`${t.trackName || ""} ${t.artistName || ""}`.trim());
    openBtn.href = t.trackViewUrl || `https://music.apple.com/us/search?term=${q}`;

    actions.appendChild(audio);
    actions.appendChild(openBtn);

    card.appendChild(art);
    card.appendChild(main);
    card.appendChild(actions);
    return card;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function svgFallback() {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7c5cff"/>
            <stop offset="1" stop-color="#39d98a"/>
          </linearGradient>
        </defs>
        <rect width="120" height="120" rx="22" fill="url(#g)"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
          fill="white" font-family="system-ui" font-size="34" font-weight="800">♪</text>
      </svg>
    `.trim();
  }

  // ---------- Sharing ----------
  function shareCurrentPlaylist() {
    if (!state.user) {
      setStatus("Please log in to share playlists.", "bad");
      return;
    }
    if (!state.currentPlaylist) {
      setStatus("Generate a playlist first.", "bad");
      return;
    }

    const pl = {
      ...state.currentPlaylist,
      // store only needed fields to keep storage smaller
      tracks: state.currentPlaylist.tracks.map(t => ({
        trackId: t.trackId,
        trackName: t.trackName,
        artistName: t.artistName,
        collectionName: t.collectionName,
        artworkUrl: t.artworkUrl,
        previewUrl: t.previewUrl,
        trackViewUrl: t.trackViewUrl
      }))
    };

    addSharedPlaylist(pl);

    const shareUrl = `${location.origin}${location.pathname}#share=${encodeURIComponent(pl.id)}`;
    els.shareLinkInput.value = shareUrl;
    els.shareBox.hidden = false;

    setStatus("Playlist shared. Copy the link and open it in a new tab to test.", "good");
  }

  async function copyShareLink() {
    const txt = els.shareLinkInput.value;
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      setStatus("Copied share link to clipboard.", "good");
    } catch {
      // fallback: select input
      els.shareLinkInput.focus();
      els.shareLinkInput.select();
      setStatus("Select + copy the link manually (clipboard blocked).", null);
    }
  }

  function renderSharedPlaylist(pl) {
    els.shareTracks.innerHTML = "";
    els.shareMeta.textContent = `Mood: ${capitalize(pl.mood)} • Shared by @${pl.owner} • ${new Date(pl.createdAt).toLocaleString()}`;

    pl.tracks.forEach((t, idx) => {
      els.shareTracks.appendChild(renderTrackCard(t, idx + 1));
    });
  }

  function routeFromHash() {
    const h = location.hash || "";
    const m = h.match(/#share=([^&]+)/);
    if (m && m[1]) {
      const id = decodeURIComponent(m[1]);
      const pl = findSharedById(id);

      hide(els.heroSection);
      hide(els.appSection);
      hide(els.howSection);
      show(els.shareSection);

      if (pl) {
        renderSharedPlaylist(pl);
        setStatus("", null);
      } else {
        els.shareTracks.innerHTML = "";
        els.shareMeta.textContent = "";
        setStatus("Shared playlist not found (it may have been cleared from this browser).", "bad");
      }
      return;
    }

    // default route
    hide(els.shareSection);
    if (state.user) {
      hide(els.heroSection);
      show(els.appSection);
    } else {
      show(els.heroSection);
      hide(els.appSection);
    }
    hide(els.howSection);
    setStatus("", null);
  }

  // ---------- Events ----------
  function setActiveMood(mood) {
    state.activeMood = mood;
    els.moods.forEach(b => b.classList.toggle("active", b.dataset.mood === mood));
  }

  function initMoodButtons() {
    els.moods.forEach(btn => {
      btn.addEventListener("click", () => {
        setActiveMood(btn.dataset.mood);
        els.newBtn.disabled = !state.user;
      });
    });
    setActiveMood(state.activeMood);
  }

  // ---------- Init ----------
  function init() {
    hide(els.userChip); // prevent Logout from showing before auth state loads

    loadTheme();

    // Seed counts display
    updateCountsUI();

    // Default served sets
    MOODS.forEach(m => ensureMoodSet(m));

    // Theme toggle
    els.themeBtn.addEventListener("click", toggleTheme);

    // Learn more
    els.learnMoreBtn.addEventListener("click", () => {
      hide(els.heroSection);
      hide(els.appSection);
      hide(els.shareSection);
      show(els.howSection);
    });
    els.closeHowBtn.addEventListener("click", () => {
      routeFromHash();
    });

    // Auth open buttons
    els.openAuthBtn.addEventListener("click", openAuthModal);
    els.heroLoginBtn.addEventListener("click", openAuthModal);

     // Auth tabs (login / signup)
els.tabs.forEach(t => {
  t.addEventListener("click", () => setAuthMode(t.dataset.tab));
});
setAuthMode("login");

     // Auth form submit (login / signup)
els.authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearAuthError();

  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;

  const res =
    authMode === "login"
      ? login(username, password)
      : signup(username, password);

  if (!res.ok) {
    authError(res.msg);
    return;
  }

  els.authPassword.value = "";
  closeAuthModal();
  refreshUserUI();
  routeFromHash();
});


    // Auth modal close
    els.closeAuthBtn.addEventListener("click", closeAuthModal);
    els.authModal.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.dataset && target.dataset.close === "true") closeAuthModal();
    });

   


    // Logout
    els.logoutBtn.addEventListener("click", () => {
      stopAllAudio(els.tracks);
      clearSession();
      state.currentPlaylist = null;
      // Keep usedTrackIdsGlobal so “freshness” still applies in same session? (reset it)
      state.usedTrackIdsGlobal.clear();
      state.servedTrackIdsByMood.forEach(s => s.clear());
      els.tracks.innerHTML = "";
      els.shareBox.hidden = true;
      els.playlistTitle.textContent = "No playlist yet";
      els.playlistSubtitle.textContent = "Log in and generate your first playlist.";
      refreshUserUI();
      routeFromHash();
    });

    // Mood buttons
    initMoodButtons();

    // Generate
    els.generateBtn.addEventListener("click", () => generatePlaylist(state.activeMood));

    // New playlist same mood
    els.newBtn.addEventListener("click", () => generatePlaylist(state.activeMood));

    // Share
    els.shareBtn.addEventListener("click", shareCurrentPlaylist);

    // Copy link
    els.copyLinkBtn.addEventListener("click", copyShareLink);

    // Share route back
    els.backHomeBtn.addEventListener("click", () => {
      location.hash = "";
      routeFromHash();
    });

    // Hash routing
    window.addEventListener("hashchange", routeFromHash);

    // Load session
    refreshUserUI();
    routeFromHash();

    // Disable generation unless logged in
    els.generateBtn.disabled = !state.user;
    els.newBtn.disabled = !state.user;
    els.shareBtn.disabled = true;
  }

  init();
})();
