
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

  function tone(freq, start, duration, volume = 0.14, type = "sine") {
    const ctx = audioContext;
    if (!ctx || ctx.state !== "running") return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
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

  function stationTone(priority) {
    if (!audioEnabled || !audioContext || audioContext.state !== "running") return 0;

    // Fire-station-style alert patterns, intentionally generic rather than copied
    // from any specific department's proprietary tone plan.
    if (priority === "PRIORITY 1") {
      tone(600, 0.00, 0.78, 0.17);
      tone(900, 0.00, 0.78, 0.13);
      tone(740, 0.90, 0.78, 0.17);
      tone(1040, 0.90, 0.78, 0.13);
      tone(600, 1.80, 1.00, 0.18);
      tone(900, 1.80, 1.00, 0.14);
      return 3000;
    }

    if (priority === "PRIORITY 3") {
      tone(690, 0.00, 0.52, 0.12);
      tone(930, 0.00, 0.52, 0.10);
      return 750;
    }

    tone(650, 0.00, 0.65, 0.15);
    tone(950, 0.00, 0.65, 0.12);
    tone(790, 0.78, 0.82, 0.15);
    tone(1090, 0.78, 0.82, 0.12);
    return 1800;
  }

  function dispatchSpeech(i, delayMs) {
    if (!audioEnabled || !("speechSynthesis" in window)) return;

    const units = i.units || "All available units";
    const priority = String(i.priority || "Priority 2").replace("PRIORITY", "Priority");
    const notes = i.notes ? ` Additional information: ${i.notes}.` : "";
    const text =
      `${priority}. ${units}. Respond to ${i.call_type}, at ${i.address}. ` +
      `Incident ${String(i.incident_number || "").replaceAll("-", " ")}.${notes}`;

    setTimeout(() => {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.92;
        utter.pitch = 0.95;
        utter.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find(v => /en-US/i.test(v.lang) && /Microsoft|Google|Samantha|David|Mark/i.test(v.name)) ||
          voices.find(v => /en-US/i.test(v.lang)) ||
          voices[0];

        if (preferred) utter.voice = preferred;
        window.speechSynthesis.speak(utter);
      } catch (_) {}
    }, delayMs);
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
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    });

    const delay = stationTone(i.priority);
    dispatchSpeech(i, delay);

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

      if (audioEnabled) {
        tone(700, 0.00, 0.18, 0.12);
        tone(950, 0.23, 0.22, 0.12);
      }

      if ("speechSynthesis" in window) {
        // Prime browser voices after a user gesture.
        window.speechSynthesis.getVoices();
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

  audioEnabled = false;
  updateButton();
  button.addEventListener("click", enableAudio);

  const dispatchForm = document.querySelector('form[action="/incidents"]');
  if (dispatchForm) {
    dispatchForm.addEventListener("submit", () => {
      if (!audioEnabled) return;
      const priority = dispatchForm.querySelector('[name="priority"]')?.value || "PRIORITY 2";
      stationTone(priority);
    });
  }

  poll();
  setInterval(poll, 4000);
})();
