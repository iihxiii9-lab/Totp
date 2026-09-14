// app.js — FitPulse application logic.
// Vanilla JS, modular by concern. Every DOM read/write is guarded so a
// missing element (or a future markup change) never throws and blocks
// the rest of the app from working — progressive enhancement in practice.

(() => {
  "use strict";

  const STORAGE = {
    theme: "fitpulse:theme",
    weights: "fitpulse:weights",
    stats: "fitpulse:stats",
    target: "fitpulse:target",
    profile: "fitpulse:profile",
  };

  /* ---------------------------------------------------------
     Safe storage helpers — private browsing / quota errors
     should degrade gracefully, never crash the app.
     --------------------------------------------------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ===========================================================
     Theme
     =========================================================== */
  function initTheme() {
    const toggle = $("#theme-toggle");
    const saved = store.get(STORAGE.theme, null);
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    const theme = saved || (prefersLight ? "light" : "dark");
    applyTheme(theme);

    toggle?.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const next = current === "light" ? "dark" : "light";
      applyTheme(next);
      store.set(STORAGE.theme, next);
    });
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    const toggle = $("#theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(theme === "light"));
      toggle.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    }
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f2ea" : "#14100d");
  }

  /* ===========================================================
     Profile — lightweight on-device "sign-in" (no server/password;
     see chat explanation). Personalizes the greeting and feeds the
     visitor's name to the ElevenLabs voice widget.
     =========================================================== */
  function initProfile() {
    const profile = store.get(STORAGE.profile, null);
    if (profile?.name) {
      applyProfile(profile);
    } else {
      showAuthScreen();
    }

    $("#auth-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#auth-name");
      const name = input.value.trim();
      if (!name) return;
      const newProfile = { name, guest: false };
      store.set(STORAGE.profile, newProfile);
      applyProfile(newProfile);
      hideAuthScreen();
    });

    $("#auth-guest")?.addEventListener("click", () => {
      const guestProfile = { name: "Guest", guest: true };
      store.set(STORAGE.profile, guestProfile);
      applyProfile(guestProfile);
      hideAuthScreen();
    });

    $("#menu-drawer-switch")?.addEventListener("click", () => {
      closeMenuDrawer();
      showAuthScreen();
    });
  }

  function showAuthScreen() {
    const screen = $("#auth-screen");
    if (screen) screen.hidden = false;
    $("#auth-name")?.focus();
  }

  function hideAuthScreen() {
    const screen = $("#auth-screen");
    if (screen) screen.hidden = true;
  }

  function applyProfile(profile) {
    // Hero greeting
    const greeting = $("#hero-greeting");
    if (greeting) {
      greeting.hidden = false;
      greeting.textContent = profile.guest ? "Welcome 👋" : `Welcome back, ${profile.name} 👋`;
    }
    // Menu drawer profile block
    const block = $("#menu-drawer-profile");
    const nameEl = $("#menu-drawer-name");
    const avatarEl = $("#menu-drawer-avatar");
    if (block && nameEl && avatarEl) {
      block.hidden = false;
      nameEl.textContent = profile.name;
      avatarEl.textContent = profile.name.trim().charAt(0).toUpperCase() || "?";
    }
    // Let the ElevenLabs voice widget address the visitor by name.
    // Requires the agent's prompt/first message to reference {{user_name}}
    // in the ElevenLabs dashboard.
    const widget = $("elevenlabs-convai");
    if (widget) {
      widget.setAttribute("dynamic-variables", JSON.stringify({ user_name: profile.name }));
    }
  }
  function initNav() {
    const navButtons = $$("[data-nav]");
    navButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        goTo(btn.dataset.nav);
        closeMenuDrawer();
      });
    });
  }

  function goTo(view) {
    $$(".view").forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });
    // Keep every nav surface (bottom tabs, header menu, drawer) in sync.
    $$(".tab-btn, .menu-link, .menu-drawer-link").forEach((btn) => {
      const active = btn.dataset.nav === view;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    if (view === "progress") renderProgressView();
  }

  /* ===========================================================
     Mobile menu drawer (hamburger)
     =========================================================== */
  function initMenuDrawer() {
    const toggle = $("#menu-toggle");
    const closeBtn = $("#menu-close");
    const scrim = $("#menu-scrim");
    toggle?.addEventListener("click", openMenuDrawer);
    closeBtn?.addEventListener("click", closeMenuDrawer);
    scrim?.addEventListener("click", closeMenuDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenuDrawer();
    });
  }

  function openMenuDrawer() {
    $("#menu-drawer").hidden = false;
    $("#menu-scrim").hidden = false;
    $("#menu-toggle")?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      $("#menu-drawer")?.classList.add("is-open");
      $("#menu-scrim")?.classList.add("is-open");
    });
  }

  function closeMenuDrawer() {
    const drawer = $("#menu-drawer");
    const scrim = $("#menu-scrim");
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove("is-open");
    scrim?.classList.remove("is-open");
    $("#menu-toggle")?.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      drawer.hidden = true;
      if (scrim) scrim.hidden = true;
    }, 200);
  }

  /* ===========================================================
     Home — weekly plan grid
     =========================================================== */
  let activeWeek = 1;

  function initPlan() {
    const tabs = $("#week-tabs");
    if (!tabs) return;
    tabs.innerHTML = PLAN.map(
      (w) => `<button class="week-tab" role="tab" data-week="${w.week}" aria-selected="${w.week === activeWeek}">Week ${w.week}</button>`
    ).join("");

    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".week-tab");
      if (!btn) return;
      activeWeek = Number(btn.dataset.week);
      $$(".week-tab", tabs).forEach((t) => t.setAttribute("aria-selected", String(t === btn)));
      renderDayGrid();
    });

    renderDayGrid();
  }

  function renderDayGrid() {
    const grid = $("#week-grid");
    if (!grid) return;
    const week = PLAN.find((w) => w.week === activeWeek);
    if (!week) return;
    grid.innerHTML = `
      <p class="day-grid-kcal">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5s6 5.8 6 10.5a6 6 0 1 1-12 0c0-1.6.8-3 1.7-4.2.2 1.4 1.1 2.2 1.9 2 .5-3.4 1-5.7 2.4-8.3Z"/></svg>
        ${week.kcal} kcal planned this week
      </p>
      <div class="day-row">
        ${week.days
          .map((d) => {
            const classes = ["day-pill"];
            if (d.done) classes.push("is-done");
            if (d.rest) classes.push("is-rest");
            if (d.today) classes.push("is-today");
            const label = d.rest ? "Rest" : d.type;
            const disabled = d.rest ? "disabled" : "";
            return `<button type="button" class="${classes.join(" ")}" data-day-type="${d.rest ? "" : d.type}" ${disabled}
              title="Day ${d.day}: ${label}" aria-label="Day ${d.day}: ${label}${d.done ? ", completed" : ""}">
              <span class="day-num">${d.day}</span>
              <span>${d.rest ? "—" : d.done ? "✓" : label.slice(0, 4)}</span>
            </button>`;
          })
          .join("")}
      </div>`;

    $$(".day-pill", grid).forEach((pill) => {
      pill.addEventListener("click", () => {
        const type = pill.dataset.dayType;
        if (!type) return;
        openPlayer(EXERCISES_BY_AREA[toAreaId(type)] || TODAY_EXERCISES);
      });
    });
  }

  /* ===========================================================
     Home — target area picker (persisted)
     =========================================================== */
  function initTargetGrid() {
    const grid = $("#target-grid");
    if (!grid) return;
    const selected = store.get(STORAGE.target, "full-body");

    grid.innerHTML = TARGET_AREAS.map(
      (t) => `<button class="target-card target-card--${t.id}" type="button" data-area="${t.id}" aria-pressed="${t.id === selected}">
        <span class="target-card-icon" aria-hidden="true">${iconMarkup(t.id)}</span>
        <span class="target-card-label">${t.label}</span>
      </button>`
    ).join("");

    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".target-card");
      if (!card) return;
      $$(".target-card", grid).forEach((c) => c.setAttribute("aria-pressed", String(c === card)));
      store.set(STORAGE.target, card.dataset.area);
      syncDiscoverChip(card.dataset.area);
      goTo("discover");
    });
  }

  /* ===========================================================
     Discover — filter chips + workout list
     =========================================================== */
  let discoverFilter = "all";

  function initDiscover() {
    const chips = $("#discover-chips");
    if (!chips) return;
    const all = [{ id: "all", label: "Hottest", icon: "abs" }, ...TARGET_AREAS.map((t) => ({ ...t, icon: t.id }))];
    chips.innerHTML = all
      .map(
        (t) =>
          `<button class="chip" type="button" data-area="${t.id}" aria-pressed="${t.id === discoverFilter}">${iconMarkup(t.icon)}${t.label}</button>`
      )
      .join("");

    chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      discoverFilter = chip.dataset.area;
      $$(".chip", chips).forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      renderDiscoverList();
    });

    renderDiscoverList();
  }

  function syncDiscoverChip(areaId) {
    discoverFilter = areaId;
    const chips = $("#discover-chips");
    if (!chips) return;
    $$(".chip", chips).forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.area === areaId)));
    renderDiscoverList();
  }

  function renderDiscoverList() {
    const list = $("#discover-list");
    if (!list) return;
    const items = WORKOUTS.filter((w) => discoverFilter === "all" || w.area === discoverFilter);
    list.innerHTML = items
      .map(
        (w) => `<li>
          <button class="workout-item" type="button" data-workout="${w.id}" data-area="${w.area}">
            <span class="workout-thumb workout-thumb--${w.area}" aria-hidden="true">${iconMarkup(w.area)}</span>
            <span>
              <p class="workout-name">${w.name}</p>
              <p class="workout-meta">${w.minutes} min · ${w.kcal} kcal</p>
            </span>
            <svg class="workout-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </li>`
      )
      .join("") || `<li class="workout-meta">No workouts for this area yet.</li>`;

    $$(".workout-item", list).forEach((btn) =>
      btn.addEventListener("click", () => openPlayer(EXERCISES_BY_AREA[btn.dataset.area] || TODAY_EXERCISES))
    );
  }

  /* ===========================================================
     Progress — logging + stats + SVG charts
     =========================================================== */
  function getWeights() {
    return store.get(STORAGE.weights, []);
  }

  function getStats() {
    return store.get(STORAGE.stats, { workouts: 18, kcal: 3125, minutes: 213 });
  }

  function initProgressForm() {
    const form = $("#log-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#weight-input", form);
      const val = parseFloat(input.value);
      const feedback = $("#log-feedback");
      if (!val || val < 30 || val > 300) {
        if (feedback) feedback.textContent = "Enter a weight between 30 and 300 kg.";
        return;
      }
      const weights = getWeights();
      weights.push({ date: new Date().toISOString().slice(0, 10), weight: val });
      store.set(STORAGE.weights, weights.slice(-28));
      if (feedback) feedback.textContent = "Logged for today. Nice work.";
      input.value = "";
      renderProgressView();
      renderHomeProgressPreview();
    });
  }

  function renderProgressView() {
    const stats = getStats();
    setText("#stat-workouts", stats.workouts);
    setText("#stat-kcal", stats.kcal.toLocaleString());
    setText("#stat-minutes", stats.minutes);
    drawChart($("#chart-svg"), getWeights());
  }

  function renderHomeProgressPreview() {
    const weights = getWeights();
    const latest = weights.length ? weights[weights.length - 1].weight : 77.2;
    setText("#preview-weight", `${latest} kg`);
    drawSparkline($("#preview-sparkline"), weights.length ? weights.map((w) => w.weight) : [80, 79.2, 78.5, 78, 77.6, 77.2]);
  }

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }

  function drawSparkline(svg, values) {
    if (!svg || !values.length) return;
    const w = 220, h = 60, pad = 6;
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const step = (w - pad * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    });
    svg.innerHTML = `<path d="M${points.join(" L")}" />`;
  }

  function drawChart(svg, weights) {
    if (!svg) return;
    const w = 320, h = 140, padX = 12, padY = 16;
    if (!weights.length) {
      svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="13">Log a weight to see your trend.</text>`;
      return;
    }
    const values = weights.map((d) => d.weight);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const step = (w - padX * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => {
      const x = padX + i * step;
      const y = h - padY - ((v - min) / range) * (h - padY * 2);
      return [x, y];
    });
    const line = points.map((p) => p.join(",")).join(" L");
    const fillPath = `M${points[0][0]},${h - padY} L${line} L${points[points.length - 1][0]},${h - padY} Z`;
    const gridLines = [0.25, 0.5, 0.75]
      .map((f) => `<line class="grid-line" x1="0" x2="${w}" y1="${h * f}" y2="${h * f}" />`)
      .join("");
    const dots = points.map(([x, y]) => `<circle class="trend-dot" cx="${x}" cy="${y}" r="3.5" />`).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${gridLines}
      <path class="trend-fill" d="${fillPath}" />
      <path class="trend-line" d="M${line}" />
      ${dots}
    `;
  }

  /* ===========================================================
     Workout player — timer-driven exercise walkthrough
     =========================================================== */
  const playerState = { exercises: [], index: 0, remaining: 0, timerId: null, paused: false };

  function openPlayer(exercises) {
    const player = $("#player");
    if (!player) return;
    playerState.exercises = exercises;
    playerState.index = 0;
    player.hidden = false;
    document.body.style.overflow = "hidden";
    loadExercise();
  }

  function closePlayer() {
    stopTimer();
    const player = $("#player");
    if (player) player.hidden = true;
    document.body.style.overflow = "";
  }

  function loadExercise() {
    const { exercises, index } = playerState;
    const ex = exercises[index];
    if (!ex) return closePlayer();
    setText("#player-step-label", `Exercise ${index + 1} of ${exercises.length}`);
    setText("#player-title", ex.name);
    playerState.remaining = ex.seconds;
    updateTimerDisplay();
    const fill = $("#player-progress-fill");
    if (fill) fill.style.width = `${((index + 1) / exercises.length) * 100}%`;
    startTimer();
  }

  function updateTimerDisplay() {
    const m = String(Math.floor(playerState.remaining / 60)).padStart(2, "0");
    const s = String(playerState.remaining % 60).padStart(2, "0");
    setText("#player-timer", `${m}:${s}`);
  }

  function startTimer() {
    stopTimer();
    playerState.paused = false;
    setPauseIcon(false);
    playerState.timerId = setInterval(() => {
      if (playerState.remaining <= 0) {
        nextExercise();
        return;
      }
      playerState.remaining -= 1;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (playerState.timerId) clearInterval(playerState.timerId);
    playerState.timerId = null;
  }

  function togglePause() {
    if (!$("#player") || $("#player").hidden) return;
    playerState.paused = !playerState.paused;
    setPauseIcon(playerState.paused);
    if (playerState.paused) stopTimer();
    else startTimer();
  }

  function setPauseIcon(isPaused) {
    const play = $("#icon-play"), pause = $("#icon-pause"), btn = $("#player-toggle");
    if (play) play.hidden = !isPaused;
    if (pause) pause.hidden = isPaused;
    if (btn) btn.setAttribute("aria-label", isPaused ? "Resume" : "Pause");
  }

  function nextExercise() {
    if (playerState.index < playerState.exercises.length - 1) {
      playerState.index += 1;
      loadExercise();
    } else {
      finishWorkout();
    }
  }

  function prevExercise() {
    if (playerState.index > 0) {
      playerState.index -= 1;
      loadExercise();
    }
  }

  function finishWorkout() {
    const stats = getStats();
    const totalSeconds = playerState.exercises.reduce((sum, e) => sum + e.seconds, 0);
    stats.workouts += 1;
    stats.minutes += Math.round(totalSeconds / 60);
    stats.kcal += 90;
    store.set(STORAGE.stats, stats);
    closePlayer();
    goTo("progress");
  }

  function initPlayerControls() {
    $("#start-workout")?.addEventListener("click", () => openPlayer(TODAY_EXERCISES));
    $("#player-close")?.addEventListener("click", closePlayer);
    $("#player-toggle")?.addEventListener("click", togglePause);
    $("#player-next")?.addEventListener("click", nextExercise);
    $("#player-prev")?.addEventListener("click", prevExercise);
    document.addEventListener("keydown", (e) => {
      const player = $("#player");
      if (!player || player.hidden) return;
      if (e.key === "Escape") closePlayer();
      if (e.key === " ") { e.preventDefault(); togglePause(); }
    });
  }

  /* ===========================================================
     Offline banner
     =========================================================== */
  function initOfflineBanner() {
    const banner = $("#offline-banner");
    if (!banner) return;
    const update = () => { banner.hidden = navigator.onLine; };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  /* ===========================================================
     Install prompt (Android/Chrome). iOS has no beforeinstallprompt
     event, so the banner there would need manual "Add to Home
     Screen" instructions if desired — omitted here for brevity.
     =========================================================== */
  function initInstallPrompt() {
    let deferredPrompt = null;
    const banner = $("#install-banner");
    const installBtn = $("#install-btn");
    const dismissBtn = $("#install-dismiss");
    if (!banner) return;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (store.get("fitpulse:install-dismissed", false)) return;
      banner.hidden = false;
    });

    installBtn?.addEventListener("click", async () => {
      banner.hidden = true;
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    });

    dismissBtn?.addEventListener("click", () => {
      banner.hidden = true;
      store.set("fitpulse:install-dismissed", true);
    });

    window.addEventListener("appinstalled", () => {
      banner.hidden = true;
    });
  }

  /* ===========================================================
     Service worker registration + update notification
     =========================================================== */
  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("sw.js");

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });
      } catch (err) {
        console.warn("Service worker registration failed:", err);
      }
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function showUpdateToast(reg) {
    const toast = $("#update-toast");
    if (!toast) return;
    toast.hidden = false;
    $("#update-reload")?.addEventListener(
      "click",
      () => reg.waiting?.postMessage({ type: "SKIP_WAITING" }),
      { once: true }
    );
    $("#update-dismiss")?.addEventListener("click", () => (toast.hidden = true), { once: true });
  }

  /* ===========================================================
     Boot
     =========================================================== */
  document.addEventListener("DOMContentLoaded", () => {
    window.__fitpulseCloseMenuDrawer = closeMenuDrawer;
    if (window.FitPulseSecurity) {
      window.FitPulseSecurity.initSecurityCenter();
      window.FitPulseSecurity.initLockScreen(bootApp);
    } else {
      bootApp();
    }
  });

  function bootApp() {
    initTheme();
    initProfile();
    initNav();
    initMenuDrawer();
    initPlan();
    initTargetGrid();
    initDiscover();
    initProgressForm();
    initPlayerControls();
    initOfflineBanner();
    initInstallPrompt();
    renderHomeProgressPreview();
    goTo("home");
  }

  initServiceWorker();
})();
