let hasBuzzerPlayed = false;
let lastRemaining = null;
const urlParams = new URLSearchParams(window.location.search);
const isReversed = urlParams.get('reversed')?.toLowerCase() === 'true';

// Unlock audio on first click
function unlockAudio() {
  const buzzer = document.getElementById('buzzer');
  if (!buzzer) return;
  buzzer.play().then(() => {
    buzzer.pause();
    buzzer.currentTime = 0;
    window.removeEventListener('click', unlockAudio);
  }).catch(() => {});
}
window.addEventListener('click', unlockAudio);

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderTimer(seconds) {
  document.getElementById('timer').textContent = formatTime(seconds);
}

function showAlert() {
  const alert = document.getElementById('alert');
  if (!alert) return;
  alert.style.display = 'block';
  setTimeout(() => alert.style.display = 'none', 5000);
}

function maybeBuzzFromData(data) {
  const running = !!data.running;
  const remaining = typeof data.remaining === 'number' ? data.remaining : 0;

  const hitZeroThisTick = running && lastRemaining !== null && lastRemaining > 0 && remaining <= 0;
  const serverWantsBuzz = running && data.buzzer === true;

  if ((hitZeroThisTick || serverWantsBuzz) && !hasBuzzerPlayed) {
    const buzzer = document.getElementById('buzzer');
    if (buzzer) {
      buzzer.play().catch(err => {
        console.error('end.wav playback failed:', err);
        showAlert();
      });
    } else {
      showAlert();
    }
    hasBuzzerPlayed = true;
  }

  lastRemaining = remaining;
}

// SSE with persistent reconnect
function initTimerSSE(retryDelayMs = 1500) {
  if (!window.EventSource) {
    console.error('EventSource not supported; cannot start SSE.');
    return;
  }

  const es = new EventSource('/timer_stream');

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const running = !!data.running;
      const remaining = Math.floor(data.remaining || 0);

      if (!running) {
        renderTimer(0);
        lastRemaining = 0;
      } else {
        renderTimer(remaining);
      }

      maybeBuzzFromData(data);
    } catch (err) {
      console.error('Bad SSE data:', err);
    }
  };

  es.onerror = () => {
    console.warn('SSE disconnected, retrying...');
    es.close();
    setTimeout(() => {
      initTimerSSE(Math.min(retryDelayMs * 2, 10000));
    }, retryDelayMs);
  };
}

function updateTeams() {
  fetch('/teams')
    .then(res => res.json())
    .then(data => {
      const teamsDiv = document.getElementById('teams');
      teamsDiv.innerHTML = '';

      const redStations = ['red1', 'red2', 'red3'];
      const blueStations = ['blue1', 'blue2', 'blue3'];
      const ordered = isReversed ? [...blueStations, ...redStations] : [...redStations, ...blueStations];

      ordered.forEach(station => {
        const team = data[station];
        if (team) {
          const box = document.createElement('div');
          box.className = `team-box ${station.startsWith('red') ? 'red' : 'blue'}`;
          box.textContent = team;
          teamsDiv.appendChild(box);
        }
      });
    })
    .catch(err => console.error('Fetch /teams failed:', err));
}

// Allow double-click toggle reversed
document.addEventListener('dblclick', () => {
  const newUrl = new URL(window.location.href);
  const current = newUrl.searchParams.get('reversed') === 'true';
  newUrl.searchParams.set('reversed', (!current).toString());
  window.location.href = newUrl.toString();
});

// Startup
initTimerSSE();
updateTeams();
setInterval(updateTeams, 5000);
