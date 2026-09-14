// security.js — FitPulse local verification gate.
//
// IMPORTANT (read this before relying on it): this site has no backend.
// Every check here — TOTP, WebAuthn, face match — runs and is verified
// entirely inside the visitor's own browser. That makes it a genuine
// *device gate* (useful to keep casual hands off the app, or as a personal
// habit-lock) but it is NOT server-verified security: anyone who clears
// this site's local storage, or edits the page's JS, can remove the gate.
// Treat it the same way you'd treat a phone's app-lock, not a bank login.
//
// UAE PDPL (Federal Decree-Law No. 45 of 2021) note: a face descriptor is
// biometric data, which the law treats as sensitive personal data. This
// module is built around that: nothing is uploaded or sent anywhere —
// detection and matching both run on-device — collection only happens
// after the explicit consent screen (never silently), and there is a
// one-tap permanent delete for the stored descriptor and every other
// verification record. If you publish this publicly, also add a short
// line in your own privacy notice saying face data stays on-device and
// is deletable at any time — that's the other half of PDPL compliance,
// and it has to be your words since it's your app.

(() => {
  "use strict";

  const SEC_STORAGE = {
    password: "fitpulse:security:password",
    totp: "fitpulse:security:totp",
    webauthn: "fitpulse:security:webauthn",
    face: "fitpulse:security:face",
    unlocked: "fitpulse:security:unlocked-session", // sessionStorage key
    log: "fitpulse:security:log",
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  function secGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function secSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  function secRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  /* ===========================================================
     Attempt log — shared by every method
     =========================================================== */
  function logAttempt(method, success) {
    const log = secGet(SEC_STORAGE.log, []);
    log.push({ method, success, at: Date.now() });
    secSet(SEC_STORAGE.log, log.slice(-20)); // keep the last 20
    renderLog();
  }

  function renderLog() {
    const list = $("#sec-log-list");
    if (!list) return;
    const log = secGet(SEC_STORAGE.log, []).slice().reverse();
    if (!log.length) {
      list.innerHTML = `<li class="sec-log-empty">No attempts yet.</li>`;
      return;
    }
    list.innerHTML = log
      .map((entry) => {
        const time = new Date(entry.at).toLocaleString();
        const label = { totp: "Authenticator code", webauthn: "Device passkey", face: "Face unlock" }[entry.method] || entry.method;
        return `<li class="sec-log-row ${entry.success ? "is-success" : "is-fail"}">
          <span>${label}</span><span>${entry.success ? "✓ Verified" : "✕ Failed"}</span><span>${time}</span>
        </li>`;
      })
      .join("");
  }

  /* ===========================================================
     Username & password — the primary lock-screen method.
     Password is never stored in plaintext: PBKDF2-SHA256 (100k
     iterations) with a random salt, via the Web Crypto API only.
     Still local-only (see the file header) — this protects against
     someone glancing at localStorage, not against someone reading
     this file's source.
     =========================================================== */
  function randomSalt(len = 16) {
    const s = new Uint8Array(len);
    crypto.getRandomValues(s);
    return s;
  }

  async function pbkdf2Hash(password, saltBytes, iterations = 100000) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
      keyMaterial,
      256
    );
    return new Uint8Array(bits);
  }

  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function passwordSetup(username, password) {
    const salt = randomSalt();
    const hash = await pbkdf2Hash(password, salt);
    secSet(SEC_STORAGE.password, {
      username: username.trim(),
      salt: bufToBase64(salt),
      hash: bufToBase64(hash),
      iterations: 100000,
    });
  }

  async function passwordVerify(username, password) {
    const record = secGet(SEC_STORAGE.password, null);
    if (!record) return false;
    if (record.username.toLowerCase() !== username.trim().toLowerCase()) {
      logAttempt("password", false);
      return false;
    }
    const salt = base64ToBuf(record.salt);
    const hash = await pbkdf2Hash(password, salt, record.iterations);
    const ok = bytesEqual(hash, base64ToBuf(record.hash));
    logAttempt("password", ok);
    return ok;
  }

  function passwordEnabled() {
    return !!secGet(SEC_STORAGE.password, null)?.username;
  }

  function passwordUsername() {
    return secGet(SEC_STORAGE.password, null)?.username || "";
  }

  /* ===========================================================
     TOTP — RFC 6238, implemented with the Web Crypto API only
     (no external library, no server round-trip). Used as the
     password-recovery factor: prove you hold the authenticator
     code, then you're allowed to set a new password.
     =========================================================== */
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function base32Encode(bytes) {
    let bits = "";
    for (const b of bytes) bits += b.toString(2).padStart(8, "0");
    let out = "";
    for (let i = 0; i < bits.length; i += 5) {
      out += BASE32_ALPHABET[parseInt(bits.substr(i, 5).padEnd(5, "0"), 2)];
    }
    return out;
  }

  function base32Decode(str) {
    const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
    let bits = "";
    for (const c of clean) {
      const val = BASE32_ALPHABET.indexOf(c);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
    return new Uint8Array(bytes);
  }

  function counterToBytes(counter) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, Math.floor(counter / 2 ** 32), false);
    view.setUint32(4, counter >>> 0, false);
    return new Uint8Array(buf);
  }

  async function hmacSha1(keyBytes, msgBytes) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, msgBytes));
  }

  async function totpAt(secretBytes, step, digits = 6) {
    const hmac = await hmacSha1(secretBytes, counterToBytes(step));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return (bin % 10 ** digits).toString().padStart(digits, "0");
  }

  function currentStep() {
    return Math.floor(Date.now() / 1000 / 30);
  }

  // Generates a new secret and stores it as *pending* (not yet enabled —
  // enabling requires proving one live code, same flow authenticator apps use).
  function totpSetup() {
    const raw = new Uint8Array(20);
    crypto.getRandomValues(raw);
    const secret = base32Encode(raw);
    secSet(SEC_STORAGE.totp, { secret, enabled: false });
    return secret;
  }

  async function totpVerify(userCode, { enableIfPending = false } = {}) {
    const record = secGet(SEC_STORAGE.totp, null);
    if (!record?.secret) return false;
    const secretBytes = base32Decode(record.secret);
    const step = currentStep();
    let ok = false;
    for (let w = -1; w <= 1; w++) {
      // eslint-disable-next-line no-await-in-loop
      const code = await totpAt(secretBytes, step + w);
      if (code === userCode.trim()) { ok = true; break; }
    }
    if (ok && enableIfPending && !record.enabled) {
      secSet(SEC_STORAGE.totp, { ...record, enabled: true });
    }
    logAttempt("totp", ok);
    return ok;
  }

  function totpEnabled() {
    return !!secGet(SEC_STORAGE.totp, null)?.enabled;
  }

  /* ===========================================================
     WebAuthn — device passkey / biometric gate.
     No server, so we can't re-verify the cryptographic signature against
     a stored public key from here in a meaningful way — instead the gate
     *is* the platform authenticator ceremony itself: create()/get() only
     resolve after the device's own Face ID / Touch ID / Windows Hello /
     screen-lock challenge succeeds. That's a real local check even
     without a backend; it just isn't independently re-verified.
     =========================================================== */
  function randomChallenge() {
    const c = new Uint8Array(32);
    crypto.getRandomValues(c);
    return c;
  }
  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function webauthnRegister(displayName) {
    if (!window.PublicKeyCredential) throw new Error("This browser/device doesn't support passkeys.");
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "FitPulse" },
        user: { id: userId, name: displayName || "fitpulse-user", displayName: displayName || "FitPulse" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: { userVerification: "required", authenticatorAttachment: "platform" },
        timeout: 60000,
        attestation: "none",
      },
    });
    if (!cred) throw new Error("Registration was cancelled.");
    secSet(SEC_STORAGE.webauthn, { credentialId: bufToBase64(cred.rawId), createdAt: Date.now() });
  }

  async function webauthnVerify() {
    const record = secGet(SEC_STORAGE.webauthn, null);
    if (!record?.credentialId) return false;
    let ok = false;
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomChallenge(),
          allowCredentials: [{ id: base64ToBuf(record.credentialId), type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      ok = !!assertion;
    } catch {
      ok = false;
    }
    logAttempt("webauthn", ok);
    return ok;
  }

  function webauthnEnabled() {
    return !!secGet(SEC_STORAGE.webauthn, null)?.credentialId;
  }

  /* ===========================================================
     Face gate — face-api.js, loaded lazily (needs internet the first
     time, to fetch the library + models; nothing is ever uploaded —
     detection and matching both happen on-device, per the PDPL note
     at the top of this file).
     =========================================================== */
  const FACE_LIB_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
  const FACE_MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights/";
  const FACE_MATCH_THRESHOLD = 0.55; // lower = stricter

  let faceApiReady = null;
  function loadFaceApi() {
    if (faceApiReady) return faceApiReady;
    const loadPromise = new Promise((resolve, reject) => {
      if (window.faceapi) return resolve(window.faceapi);
      const script = document.createElement("script");
      script.src = FACE_LIB_URL;
      script.onload = async () => {
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
          ]);
          resolve(window.faceapi);
        } catch (err) {
          reject(new Error("Couldn't download the face recognition models. Check your internet connection and try again."));
        }
      };
      script.onerror = () => reject(new Error("Couldn't load the face recognition library. Check your internet connection, or this site's host may be blocking outside scripts."));
      document.head.appendChild(script);
    });
    // Never hang forever on a stalled request — surface a real error instead.
    faceApiReady = Promise.race([
      loadPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("This is taking too long — the face recognition library didn't load in 20 seconds. Try again on a stronger connection.")), 20000)
      ),
    ]).catch((err) => {
      faceApiReady = null; // allow retrying instead of getting stuck on a rejected promise forever
      throw err;
    });
    return faceApiReady;
  }

  async function captureDescriptor(videoEl) {
    const faceapi = await loadFaceApi();
    const result = await faceapi
      .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!result) throw new Error("No face found — face the camera in good light and try again.");
    return Array.from(result.descriptor);
  }

  function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
    return Math.sqrt(sum);
  }

  function faceEnabled() {
    return !!secGet(SEC_STORAGE.face, null)?.descriptor;
  }

  /* ===========================================================
     Consent screen — must be explicitly accepted before any
     getUserMedia() call anywhere in this module. Required both as
     good practice and under PDPL for biometric collection.
     =========================================================== */
  function requestCameraConsent() {
    return new Promise((resolve) => {
      const screen = $("#face-consent-screen");
      if (!screen) return resolve(false);
      screen.hidden = false;
      const onAllow = () => { cleanup(); resolve(true); };
      const onDeny = () => { cleanup(); resolve(false); };
      function cleanup() {
        screen.hidden = true;
        $("#face-consent-allow")?.removeEventListener("click", onAllow);
        $("#face-consent-deny")?.removeEventListener("click", onDeny);
      }
      $("#face-consent-allow")?.addEventListener("click", onAllow, { once: true });
      $("#face-consent-deny")?.addEventListener("click", onDeny, { once: true });
    });
  }

  async function runFaceCapture({ verifyAgainst = null } = {}) {
    const consented = await requestCameraConsent();
    if (!consented) throw new Error("Camera permission declined.");

    let stream;
    try {
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("The camera didn't respond in 15 seconds. Your browser or this page may be blocking camera access.")), 15000)
        ),
      ]);
    } catch (err) {
      if (err.name === "NotAllowedError") throw new Error("Camera access was blocked. Check your browser's site permissions and allow the camera for this page.");
      if (err.name === "NotFoundError") throw new Error("No camera was found on this device.");
      if (err.name === "NotReadableError") throw new Error("The camera is already in use by another app.");
      throw err instanceof Error ? err : new Error("Couldn't access the camera.");
    }

    const screen = $("#face-capture-screen");
    const video = $("#face-live-video");
    const status = $("#face-capture-status");
    const captureBtn = $("#face-capture-btn");
    const cancelBtn = $("#face-capture-cancel");

    video.srcObject = stream;
    await video.play();
    screen.hidden = false;
    status.textContent = "Loading face recognition (first time only)…";
    captureBtn.disabled = true;

    let modelsReady = false;
    loadFaceApi()
      .then(() => {
        modelsReady = true;
        status.textContent = "Center your face in the circle, then tap Capture.";
        captureBtn.disabled = false;
      })
      .catch((err) => {
        status.textContent = err.message || "Couldn't load face recognition.";
      });

    return new Promise((resolve, reject) => {
      function cleanup() {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        screen.hidden = true;
        captureBtn.removeEventListener("click", onCapture);
        cancelBtn.removeEventListener("click", onCancel);
      }
      async function onCapture() {
        if (!modelsReady) return;
        captureBtn.disabled = true;
        status.textContent = "Checking…";
        try {
          const descriptor = await captureDescriptor(video);
          if (verifyAgainst) {
            const distance = euclideanDistance(verifyAgainst, descriptor);
            const ok = distance < FACE_MATCH_THRESHOLD;
            cleanup();
            resolve({ ok });
          } else {
            cleanup();
            resolve({ descriptor });
          }
        } catch (err) {
          status.textContent = (err.message || "No face detected") + " — try again.";
          captureBtn.disabled = false;
        }
      }
      function onCancel() {
        cleanup();
        reject(new Error("cancelled"));
      }
      captureBtn.addEventListener("click", onCapture);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  /* ===========================================================
     Delete all security data — the PDPL-required "erase my data"
     control. One tap, no confirmation email, no delay.
     =========================================================== */
  function wipeSecurityData() {
    secRemove(SEC_STORAGE.password);
    secRemove(SEC_STORAGE.totp);
    secRemove(SEC_STORAGE.webauthn);
    secRemove(SEC_STORAGE.face);
    secRemove(SEC_STORAGE.log);
    try { sessionStorage.removeItem(SEC_STORAGE.unlocked); } catch { /* ignore */ }
  }

  function anyMethodEnabled() {
    return passwordEnabled() || webauthnEnabled() || faceEnabled();
  }

  /* ===========================================================
     Security Center UI wiring
     =========================================================== */
  function refreshSecurityCenterUI() {
    const pwOn = passwordEnabled();
    $("#sec-password-status").textContent = pwOn ? `Enabled (${passwordUsername()})` : "Not set up";
    $("#sec-password-status").classList.toggle("is-on", pwOn);
    $("#sec-password-setup-btn").hidden = pwOn;
    $("#sec-password-remove-btn").hidden = !pwOn;
    $("#sec-password-setup-panel").hidden = true;

    const totpOn = totpEnabled();
    $("#sec-totp-status").textContent = totpOn ? "Enabled" : "Not set up";
    $("#sec-totp-status").classList.toggle("is-on", totpOn);
    $("#sec-totp-setup-btn").hidden = totpOn;
    $("#sec-totp-remove-btn").hidden = !totpOn;
    $("#sec-totp-setup-panel").hidden = true;

    const waOn = webauthnEnabled();
    $("#sec-webauthn-status").textContent = waOn ? "Registered" : "Not registered";
    $("#sec-webauthn-status").classList.toggle("is-on", waOn);
    $("#sec-webauthn-register-btn").hidden = waOn;
    $("#sec-webauthn-remove-btn").hidden = !waOn;

    const faceOn = faceEnabled();
    $("#sec-face-status").textContent = faceOn ? "Enabled" : "Not set up";
    $("#sec-face-status").classList.toggle("is-on", faceOn);
    $("#sec-face-enable-btn").hidden = faceOn;
    $("#sec-face-remove-btn").hidden = !faceOn;

    renderLog();
  }

  function initSecurityCenter() {
    $("#menu-drawer-security")?.addEventListener("click", () => {
      window.__fitpulseCloseMenuDrawer?.();
      $("#security-center").hidden = false;
      refreshSecurityCenterUI();
    });
    $("#security-close")?.addEventListener("click", () => { $("#security-center").hidden = true; });

    // --- Username & password ---
    $("#sec-password-setup-btn")?.addEventListener("click", () => {
      $("#sec-password-setup-panel").hidden = false;
      $("#sec-password-username").value = "";
      $("#sec-password-pass").value = "";
      $("#sec-password-confirm").value = "";
      $("#sec-password-feedback").textContent = "";
    });
    $("#sec-password-setup-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("#sec-password-username").value.trim();
      const pass = $("#sec-password-pass").value;
      const confirm = $("#sec-password-confirm").value;
      const feedback = $("#sec-password-feedback");
      if (!username || pass.length < 4) {
        feedback.textContent = "Enter a username and a password of at least 4 characters.";
        feedback.classList.add("is-error");
        return;
      }
      if (pass !== confirm) {
        feedback.textContent = "Passwords don't match.";
        feedback.classList.add("is-error");
        return;
      }
      await passwordSetup(username, pass);
      feedback.classList.remove("is-error");
      feedback.textContent = "Password saved.";
      refreshSecurityCenterUI();
    });
    $("#sec-password-remove-btn")?.addEventListener("click", () => {
      secRemove(SEC_STORAGE.password);
      refreshSecurityCenterUI();
    });

    // --- TOTP setup flow ---
    $("#sec-totp-setup-btn")?.addEventListener("click", () => {
      const secret = totpSetup();
      $("#sec-totp-secret").textContent = secret.match(/.{1,4}/g).join(" ");
      $("#sec-totp-setup-panel").hidden = false;
      $("#sec-totp-code").value = "";
      $("#sec-totp-feedback").textContent = "";
    });
    $("#sec-totp-confirm-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = $("#sec-totp-code").value;
      const ok = await totpVerify(code, { enableIfPending: true });
      $("#sec-totp-feedback").textContent = ok
        ? "Authenticator app connected."
        : "That code didn't match — check the time on your phone and try again.";
      $("#sec-totp-feedback").classList.toggle("is-error", !ok);
      if (ok) refreshSecurityCenterUI();
    });
    $("#sec-totp-remove-btn")?.addEventListener("click", () => {
      secRemove(SEC_STORAGE.totp);
      refreshSecurityCenterUI();
    });

    // --- WebAuthn ---
    $("#sec-webauthn-register-btn")?.addEventListener("click", async () => {
      const btn = $("#sec-webauthn-register-btn");
      const feedback = $("#sec-webauthn-feedback");
      btn.disabled = true;
      feedback.textContent = "Follow your device's prompt…";
      feedback.classList.remove("is-error");
      try {
        const profile = secGet("fitpulse:profile", null);
        await webauthnRegister(profile?.name);
        feedback.textContent = "Device passkey registered.";
        refreshSecurityCenterUI();
      } catch (err) {
        feedback.textContent = err.message || "Couldn't register a passkey on this device.";
        feedback.classList.add("is-error");
      } finally {
        btn.disabled = false;
      }
    });
    $("#sec-webauthn-remove-btn")?.addEventListener("click", () => {
      secRemove(SEC_STORAGE.webauthn);
      refreshSecurityCenterUI();
    });

    // --- Face gate ---
    $("#sec-face-enable-btn")?.addEventListener("click", async () => {
      const btn = $("#sec-face-enable-btn");
      const feedback = $("#sec-face-feedback");
      feedback.textContent = "";
      feedback.classList.remove("is-error");
      btn.disabled = true;
      try {
        const { descriptor } = await runFaceCapture();
        secSet(SEC_STORAGE.face, { descriptor, createdAt: Date.now() });
        feedback.textContent = "Face unlock enabled.";
        refreshSecurityCenterUI();
      } catch (err) {
        if (err.message !== "cancelled") {
          feedback.textContent = err.message || "Couldn't set up face unlock.";
          feedback.classList.add("is-error");
        }
      } finally {
        btn.disabled = false;
      }
    });
    $("#sec-face-remove-btn")?.addEventListener("click", () => {
      secRemove(SEC_STORAGE.face);
      refreshSecurityCenterUI();
    });

    $("#sec-wipe-all-btn")?.addEventListener("click", () => {
      if (!confirm("Remove every verification method and the attempt log from this device? This can't be undone.")) return;
      wipeSecurityData();
      refreshSecurityCenterUI();
    });
  }

  /* ===========================================================
     Lock screen — shown at boot, only if at least one method is
     enrolled. Verifying with ANY enrolled method unlocks the session.
     =========================================================== */
  function initLockScreen(onUnlock) {
    if (!anyMethodEnabled()) return onUnlock();
    let unlocked = false;
    try { unlocked = sessionStorage.getItem(SEC_STORAGE.unlocked) === "1"; } catch { /* ignore */ }
    if (unlocked) return onUnlock();

    const screen = $("#lock-screen");
    screen.hidden = false;

    $("#lock-method-password").hidden = !passwordEnabled();
    $("#lock-method-webauthn").hidden = !webauthnEnabled();
    $("#lock-method-face").hidden = !faceEnabled();
    $("#lock-forgot-link").hidden = !(passwordEnabled() && totpEnabled());

    function unlock() {
      unlocked = true;
      try { sessionStorage.setItem(SEC_STORAGE.unlocked, "1"); } catch { /* ignore */ }
      screen.hidden = true;
      onUnlock();
    }

    $("#lock-password-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("#lock-password-username").value;
      const pass = $("#lock-password-pass").value;
      const feedback = $("#lock-password-feedback");
      const ok = await passwordVerify(username, pass);
      if (ok) return unlock();
      feedback.textContent = "Incorrect username or password.";
    });

    $("#lock-webauthn-btn")?.addEventListener("click", async () => {
      const feedback = $("#lock-webauthn-feedback");
      feedback.textContent = "Follow your device's prompt…";
      const ok = await webauthnVerify();
      feedback.textContent = ok ? "" : "Verification failed. Try again.";
      if (ok) unlock();
    });

    $("#lock-face-btn")?.addEventListener("click", async () => {
      const btn = $("#lock-face-btn");
      const feedback = $("#lock-face-feedback");
      feedback.textContent = "";
      btn.disabled = true;
      try {
        const stored = secGet(SEC_STORAGE.face, null);
        const { ok } = await runFaceCapture({ verifyAgainst: stored.descriptor });
        logAttempt("face", ok);
        feedback.textContent = ok ? "" : "Face didn't match. Try again in good lighting.";
        if (ok) unlock();
      } catch (err) {
        if (err.message !== "cancelled") feedback.textContent = err.message || "Couldn't verify your face.";
      } finally {
        btn.disabled = false;
      }
    });

    // --- Forgot password → verify recovery code (OTP) → set a new password ---
    $("#lock-forgot-link")?.addEventListener("click", () => {
      $("#lock-method-password").hidden = true;
      $("#lock-forgot-link").hidden = true;
      $("#lock-forgot-otp-panel").hidden = false;
      $("#lock-forgot-otp-code").value = "";
      $("#lock-forgot-feedback").textContent = "";
    });

    $("#lock-forgot-otp-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = $("#lock-forgot-otp-code").value;
      const feedback = $("#lock-forgot-feedback");
      const ok = await totpVerify(code);
      if (!ok) {
        feedback.textContent = "That code didn't match.";
        return;
      }
      feedback.textContent = "";
      $("#lock-forgot-otp-panel").hidden = true;
      $("#lock-forgot-newpass-panel").hidden = false;
    });

    $("#lock-forgot-newpass-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = $("#lock-forgot-newpass").value;
      const confirm = $("#lock-forgot-newpass-confirm").value;
      const feedback = $("#lock-forgot-newpass-feedback");
      if (pass.length < 4) {
        feedback.textContent = "Password must be at least 4 characters.";
        return;
      }
      if (pass !== confirm) {
        feedback.textContent = "Passwords don't match.";
        return;
      }
      await passwordSetup(passwordUsername(), pass);
      unlock();
    });
  }

  window.FitPulseSecurity = { initSecurityCenter, initLockScreen, wipeSecurityData };
})();
