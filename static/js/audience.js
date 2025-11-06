/* --------------------------------------------------------------
   audience.js – buzzer works on EVERY match
   -------------------------------------------------------------- */
console.log("%cAUDIENCE.JS LOADED", "color:lime;font-size:20px");

let lastRemaining = null;
let audioUnlocked = false;
let matchEnded = false;

// <-- define this so renderTeamsFromData can use it
const urlParams = new URLSearchParams(window.location.search);
const isReversed = urlParams.get('reversed')?.toLowerCase() === 'true';

/* ---------- 1. UNLOCK AUDIO (once per page load) ---------- */
function unlockAudioContext() {
  if (audioUnlocked) return;
  console.log("UNLOCK: Trying to unlock audio context…");
  const u = document.getElementById('unlocker');
  u.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  u.play().then(() => {
    console.log("%cUNLOCK: SUCCESS – Audio context unlocked", "color:green;font-weight:bold");
    audioUnlocked = true;
    updateMuteIcon();
  }).catch(() => {});
}
['mousedown','touchstart','keydown','pointerdown'].forEach(ev =>
  window.addEventListener(ev, unlockAudioContext, {once:true, passive:true})
);

function updateMuteIcon() {
  const icon = document.getElementById('mute-indicator');
  if (!icon) return;
  if (audioUnlocked) {
    icon.classList.add('hidden');
  } else {
    icon.classList.remove('hidden');
  }
}

/* ---------- 2. BUZZER LOGIC ---------- */
function maybeBuzzFromData(data) {
  const running   = !!data.running;
  const remaining = Math.floor(data.remaining || 0);

  const hitZero    = running && lastRemaining !== null && lastRemaining > 0 && remaining <= 0;
  const serverBuzz = running && data.buzzer === true;

  if ((hitZero || serverBuzz) && !matchEnded) {
    const buzzer = document.getElementById('buzzer');
    if (!buzzer) return;
    if (!audioUnlocked) unlockAudioContext();

    buzzer.currentTime = 0;
    const p = buzzer.play();
    if (p) {
      p.then(() => {
        matchEnded = true;
      }).catch(err => {
        console.error("BUZZER BLOCKED:", err);
        showAlert();
        matchEnded = true;
      });
    }
  }

  if (!running && matchEnded) {
    // ready for next countdown
    matchEnded = false;
  }

  lastRemaining = remaining;
}

/* ---------- 3. TIMER DISPLAY ---------- */
function formatTime(s) {
  const m = String(Math.floor(s/60)).padStart(2,'0');
  const sec = String(Math.floor(s%60)).padStart(2,'0');
  return `${m}:${sec}`;
}
function renderTimer(s) {
  const el = document.getElementById('timer');
  if (el) el.textContent = formatTime(s);
}
function showAlert() {
  const a = document.getElementById('alert');
  if (!a) return;
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

      const secs = d.running ? Math.max(0, Math.floor(d.remaining)) : 0;
      renderTimer(secs);

      const nameEl = document.getElementById('event-name');
      if (nameEl && d.event_name) {
        nameEl.textContent = d.event_name;
      }

      maybeBuzzFromData(d);

      // ALWAYS render 6 boxes, even if teams missing
      renderTeamsFromData(d.teams || {});
    } catch (err) {
      console.error('bad SSE timer payload', err);
    }
  });

  es.onerror = () => {
    console.warn("SSE: reconnecting…");
    es.close();
    setTimeout(initSSE, 2000);
  };
}

/* ---------- 5. TEAMS ---------- */
function renderTeamsFromData(teamsObj) {
  const redDiv = document.getElementById('red-teams');
  const blueDiv = document.getElementById('blue-teams');
  if (!redDiv || !blueDiv) return;

  redDiv.innerHTML = '';
  blueDiv.innerHTML = '';

  const redStations  = ['red1', 'red2', 'red3'];
  const blueStations = ['blue1', 'blue2', 'blue3'];
  const teams = teamsObj || {};

  const makeBox = (team, isRed) => {
    const box = document.createElement('div');
    box.className = `team-box ${isRed ? 'red' : 'blue'}`;
    // show blank but keep size
    box.textContent = (team && team.trim() !== '') ? team : '\u00A0';
    return box;
  };

  if (!isReversed) {
    // normal: red on left, blue on right
    redStations.forEach(st => redDiv.appendChild(makeBox(teams[st], true)));
    blueStations.forEach(st => blueDiv.appendChild(makeBox(teams[st], false)));
  } else {
    // reversed: blue on left, red on right
    blueStations.forEach(st => redDiv.appendChild(makeBox(teams[st], false)));
    redStations.forEach(st => blueDiv.appendChild(makeBox(teams[st], true)));
  }
}

/* ---------- 6. START ---------- */
initSSE();
updateMuteIcon();
console.log("%cREADY – move mouse / tap / press key to unlock audio", "color:cyan");
