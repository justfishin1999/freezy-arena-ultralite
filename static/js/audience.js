/* --------------------------------------------------------------
   audience.js – buzzer works on EVERY match
   -------------------------------------------------------------- */
console.log("%cAUDIENCE.JS LOADED", "color:lime;font-size:20px");

let lastRemaining = null;
let audioUnlocked = false;
let matchEnded = false;          // <-- NEW: resets after match stops

/* ---------- 1. UNLOCK AUDIO (once per page load) ---------- */
function unlockAudioContext() {
  if (audioUnlocked) return;
  console.log("UNLOCK: Trying to unlock audio context…");
  const u = document.getElementById('unlocker');
  u.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  u.play().then(() => {
    console.log("%cUNLOCK: SUCCESS – Audio context unlocked", "color:green;font-weight:bold");
    audioUnlocked = true;
  }).catch(() => {});
}
['mousedown','touchstart','keydown','pointerdown'].forEach(ev =>
  window.addEventListener(ev, unlockAudioContext, {once:true, passive:true})
);

/* ---------- 2. BUZZER LOGIC ---------- */
function maybeBuzzFromData(data) {
  const running   = !!data.running;
  const remaining = Math.floor(data.remaining || 0);

  // Detect timer crossing zero OR server explicitly says "buzz"
  const hitZero   = running && lastRemaining !== null && lastRemaining > 0 && remaining <= 0;
  const serverBuzz = running && data.buzzer === true;

  console.log("BUZZ CHECK:", {running, remaining, hitZero, serverBuzz, matchEnded});

  // ---------- PLAY ----------
  if ((hitZero || serverBuzz) && !matchEnded) {
    console.log("%cBUZZER: TRIGGERED – playing /static/end.wav", "color:orange;font-size:16px");
    const buzzer = document.getElementById('buzzer');
    if (!buzzer) { console.error("BUZZER: element missing"); return; }

    if (!audioUnlocked) unlockAudioContext();

    buzzer.currentTime = 0;
    const p = buzzer.play();
    if (p) {
      p.then(() => {
        console.log("%cBUZZER: PLAYING NOW", "color:lime;font-size:18px");
        matchEnded = true;          // <-- block further plays THIS match
      }).catch(err => {
        console.error("%cBUZZER: BLOCKED", "color:red;font-weight:bold", err);
        showAlert();
        matchEnded = true;
      });
    }
  }

  // ---------- RESET for next match ----------
  if (!running && matchEnded) {
    console.log("%cMATCH STOPPED – resetting buzzer flag", "color:cyan");
    matchEnded = false;           // <-- ready for next countdown
  }

  lastRemaining = remaining;
}

/* ---------- 3. TIMER DISPLAY ---------- */
function formatTime(s) {
  const m = String(Math.floor(s/60)).padStart(2,'0');
  const sec = String(Math.floor(s%60)).padStart(2,'0');
  return `${m}:${sec}`;
}
function renderTimer(s) { document.getElementById('timer').textContent = formatTime(s); }
function showAlert() {
  console.warn("BUZZER: visual fallback");
  const a = document.getElementById('alert');
  a.style.display = 'block';
  setTimeout(() => a.style.display = 'none', 5000);
}

/* ---------- 4. SSE ---------- */
function initSSE() {
  console.log("SSE: connecting to /stream …");
  const es = new EventSource('/stream');

  es.addEventListener('timer', e => {
    try {
      const d = JSON.parse(e.data);
      renderTimer(d.running ? Math.max(0, Math.floor(d.remaining)) : 0);
      if (d.event_name) document.getElementById('event-name').textContent = d.event_name;
      maybeBuzzFromData(d);
    } catch (_) {}
  });

  es.onerror = () => {
    console.warn("SSE: reconnecting…");
    es.close();
    setTimeout(initSSE, 2000);
  };
}

/* ---------- 5. TEAMS ---------- */
function updateTeams() {
  fetch('/teams').then(r=>r.json()).then(data => {
    const red = document.getElementById('red-teams');
    const blue = document.getElementById('blue-teams');
    red.innerHTML = blue.innerHTML = '';

    const make = (team, isRed) => {
      const el = document.createElement('div');
      el.className = `team-box ${isRed?'red':'blue'}`;
      el.textContent = team?.trim() || ' ';
      return el;
    };
    const reds = ['red1','red2','red3'];
    const blues = ['blue1','blue2','blue3'];
    const rev = new URLSearchParams(location.search).get('reversed') === 'true';
    if (!rev) {
      reds.forEach(s=>red.appendChild(make(data[s],true)));
      blues.forEach(s=>blue.appendChild(make(data[s],false)));
    } else {
      blues.forEach(s=>red.appendChild(make(data[s],false)));
      reds.forEach(s=>blue.appendChild(make(data[s],true)));
    }
  });
}

/* ---------- 6. START ---------- */
initSSE();
updateTeams();
setInterval(updateTeams, 5000);
console.log("%cREADY – move mouse / tap / press key to unlock audio", "color:cyan");