
(() => {
  const button = document.getElementById("enable-audio");
  const alertBox = document.getElementById("dispatch-alert");
  if (!button || !alertBox) return;

  const STORAGE_AUDIO = "lcfd_audio_enabled";
  const STORAGE_LAST = "lcfd_last_alert_id";
  let audioEnabled = localStorage.getItem(STORAGE_AUDIO) === "yes";
  let firstPoll = true;

  function updateButton() {
    button.textContent = audioEnabled ? "Dispatch Audio: ON" : "Enable Dispatch Audio";
    button.classList.toggle("enabled", audioEnabled);
  }

  function tone(freq, start, duration, volume = 0.14) {
    const ctx = window.lcfdAudioContext;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.02);
    gain.gain.setValueAtTime(volume, ctx.currentTime + start + duration - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.02);
  }

  function playDispatchTone(priority) {
    if (!audioEnabled || !window.lcfdAudioContext) return;
    const ctx = window.lcfdAudioContext;
    if (ctx.state === "suspended") ctx.resume();

    if (priority === "PRIORITY 1") {
      tone(620, 0.00, 0.36, 0.18);
      tone(880, 0.42, 0.36, 0.18);
      tone(620, 0.84, 0.36, 0.18);
      tone(880, 1.26, 0.55, 0.18);
    } else if (priority === "PRIORITY 3") {
      tone(660, 0.00, 0.30, 0.12);
      tone(660, 0.38, 0.30, 0.12);
    } else {
      tone(720, 0.00, 0.42, 0.15);
      tone(920, 0.48, 0.65, 0.15);
    }
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
      new Notification(`${i.priority} — ${i.call_type}`, {
        body: `${i.address}\n${i.units || ""}`
      });
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

  async function enableAudio() {
    if (!window.lcfdAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        button.textContent = "Audio Not Supported";
        return;
      }
      window.lcfdAudioContext = new AudioCtx();
    }

    await window.lcfdAudioContext.resume();
    audioEnabled = true;
    localStorage.setItem(STORAGE_AUDIO, "yes");
    updateButton();

    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    // Confirmation chirp.
    tone(700, 0, 0.16, 0.08);
    tone(900, 0.20, 0.20, 0.08);
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

      // On first page load, remember the current newest call instead of sounding old calls.
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
    } catch (_) {
      // Keep the CAD usable even if a poll fails.
    }
  }

  button.addEventListener("click", enableAudio);
  updateButton();
  poll();
  setInterval(poll, 4000);
})();
