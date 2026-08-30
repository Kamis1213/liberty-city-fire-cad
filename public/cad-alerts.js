
(() => {
  const button = document.getElementById("enable-audio");
  const alertBox = document.getElementById("dispatch-alert");
  if (!button || !alertBox) return;

  const STORAGE_LAST = "lcfd_last_alert_id";
  let audioEnabled = false;
  let firstPoll = true;
  let audioContext = null;

  function updateButton() {
    button.textContent = audioEnabled ? "Dispatch Audio: ON" : "Enable Dispatch Audio";
    button.classList.toggle("enabled", audioEnabled);
  }

  function getAudioContext() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      audioContext = new AudioCtx();
    }
    return audioContext;
  }

  function tone(freq, start, duration, volume = 0.14) {
    const ctx = audioContext;
    if (!ctx || ctx.state !== "running") return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;

    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.setValueAtTime(volume, t0 + Math.max(0.03, duration - 0.03));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function playDispatchTone(priority) {
    if (!audioEnabled || !audioContext || audioContext.state !== "running") return;

    if (priority === "PRIORITY 1") {
      tone(620, 0.00, 0.36, 0.20);
      tone(880, 0.42, 0.36, 0.20);
      tone(620, 0.84, 0.36, 0.20);
      tone(880, 1.26, 0.55, 0.20);
    } else if (priority === "PRIORITY 3") {
      tone(660, 0.00, 0.30, 0.14);
      tone(660, 0.38, 0.30, 0.14);
    } else {
      tone(720, 0.00, 0.42, 0.18);
      tone(920, 0.48, 0.65, 0.18);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showAlert(i) {
    alertBox.innerHTML = `
      <div class="dispatch-alert-title">${escapeHtml(i.priority || "DISPATCH")} — ${escapeHtml(i.incident_number)}</div>
      <div><strong>${escapeHtml(i.call_type)}</strong></div>
      <div>${escapeHtml(i.address)}</div>
      <div class="dispatch-alert-units">${escapeHtml(i.units || "No units assigned")}</div>
      ${i.notes ? `<div class="dispatch-alert-notes">${escapeHtml(i.notes)}</div>` : ""}
      <button type="button" id="dismiss-dispatch-alert">ACKNOWLEDGE</button>
    `;
    alertBox.classList.remove("hidden");

    document.getElementById("dismiss-dispatch-alert")?.addEventListener("click", () => {
      alertBox.classList.add("hidden");
    });

    playDispatchTone(i.priority);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${i.priority} — ${i.call_type}`, {
          body: `${i.address}\n${i.units || ""}`
        });
      } catch (_) {}
    }
  }

  async function enableAudio() {
    const ctx = getAudioContext();
    if (!ctx) {
      button.textContent = "Audio Not Supported";
      return;
    }

    try {
      await ctx.resume();
      audioEnabled = ctx.state === "running";
      updateButton();

      // This confirmation tone proves browser audio permission is active.
      if (audioEnabled) {
        tone(700, 0.00, 0.18, 0.12);
        tone(950, 0.23, 0.22, 0.12);
      }

      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (_) {}
      }
    } catch (_) {
      audioEnabled = false;
      updateButton();
    }
  }

  async function poll() {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      const incidents = data.incidents || [];
      const newest = incidents[0];

      if (!newest) {
        firstPoll = false;
        return;
      }

      const lastSeen = Number(localStorage.getItem(STORAGE_LAST) || 0);

      if (firstPoll && !lastSeen) {
        localStorage.setItem(STORAGE_LAST, String(newest.id));
        firstPoll = false;
        return;
      }

      if (Number(newest.id) > lastSeen) {
        localStorage.setItem(STORAGE_LAST, String(newest.id));
        showAlert(newest);
      }

      firstPoll = false;
    } catch (_) {}
  }

  // Browsers require a fresh click after a page load before sound can play.
  // Therefore the button intentionally starts OFF after every navigation.
  audioEnabled = false;
  updateButton();

  button.addEventListener("click", enableAudio);

  // Also play the dispatcher's tone immediately on dispatch submit, before the page reload.
  const dispatchForm = document.querySelector('form[action="/incidents"]');
  if (dispatchForm) {
    dispatchForm.addEventListener("submit", () => {
      if (!audioEnabled) return;
      const priority = dispatchForm.querySelector('[name="priority"]')?.value || "PRIORITY 2";
      playDispatchTone(priority);
    });
  }

  poll();
  setInterval(poll, 4000);
})();
