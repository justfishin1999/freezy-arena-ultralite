// static/js/app.js
$(function () {
    // initial status
    checkWpaKeyStatus();
    refreshLogDisplay();

    prefillTeamListFromServer();

    // set up timer: prefer SSE
    initUnifiedStream();

    // -------------------------------------------------
    //  Load saved station assignments (persisted on server)
    // -------------------------------------------------
    $.get('/get_station_assignments')
    .done(function (data) {
        Object.keys(data).forEach(function (key) {
            const $input = $('#' + key);
            if ($input.length) $input.val(data[key]);
        });
        // force badge update now that inputs are filled
        refreshApStatusBadges();
    })
    .fail(function () { console.warn('Could not load saved assignments'); });

    // On page load, restore last timer value from localStorage
    const lastTimerSeconds = localStorage.getItem('lastTimerSeconds');
    if (lastTimerSeconds) {
        $('#timerInput').val(lastTimerSeconds);
        // Optionally update the display timer preview (static, not the running one)
        renderTimer(parseInt(lastTimerSeconds, 10));
    }

    // =========================
    // WPA CSV IMPORT (config page)
    // =========================
    const $csvForm = $('#csvForm');
    if ($csvForm.length) {
        $csvForm.on('submit', function (e) {
            e.preventDefault();
            let formData = new FormData(this);
            $.ajax({
                url: '/import_csv',
                type: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: async () => {
                    await checkWpaKeyStatus();
                    await refreshLogDisplay();
                },
                error: async () => {
                    await refreshLogDisplay();
                }
            });
        });
    }

    // =========================
    // WPA GENERATE (config page)
    // =========================
    const $generateKeys = $('#generateKeys');
    if ($generateKeys.length) {
        $generateKeys.on('click', () => {
            let teams = $('#teamListInput').val().split(',').map(t => t.trim()).filter(Boolean);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/generate_team_keys', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.responseType = 'blob';

            xhr.onload = async function () {
                if (xhr.status === 200) {
                    const blob = new Blob([xhr.response], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'wpa_keys.csv';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();

                    await checkWpaKeyStatus();
                    await refreshLogDisplay();
                } else {
                    await refreshLogDisplay();
                }
            };

            xhr.send(JSON.stringify({ teams }));
        });
    }

    // =========================
    // WPA CLEAR ALL (config page)
    // =========================
    const $clearAllWpaBtn = $('#clearAllWpaBtn');
    if ($clearAllWpaBtn.length) {
        $clearAllWpaBtn.on('click', async () => {
            if (confirm("Are you sure you want to remove ALL WPA keys?")) {
                try {
                    await fetch('/clear_wpa_keys', { method: 'POST' });
                } catch (e) {
                    // backend logs
                }
                await checkWpaKeyStatus();
                await refreshLogDisplay();
            } else {
                alert("Aborted WPA key reset. No changes made!");
            }
        });
    }

// =========================
// PUSH CONFIG (main page)
// =========================
const $configForm = $('#configForm');
if ($configForm.length) {
  $configForm.on('submit', function (e) {
    e.preventDefault();

    //Block if timer running
    if (window.timerRunning) {
      alert('Timer is running. Stop the timer before pushing configuration.');
      return;
    }

    let payload = {};
    $(this).serializeArray().forEach(i => payload[i.name] = i.value);

    $.ajax({
      url: '/push_config',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload),
      success: async () => {
        await refreshLogDisplay();
      },
      error: async () => {
        await refreshLogDisplay();
      }
    });
  });
}

// =========================
// UPDATE DISPLAY ONLY (main page)
// =========================
const $updateDisplay = $('#updateDisplay');
if ($updateDisplay.length) {
  $updateDisplay.on('click', function () {
    //Block if timer running
    if (window.timerRunning) {
      alert('Timer is running. Stop the timer before updating display.');
      return;
    }

    let payload = {};
    $('#configForm').serializeArray().forEach(i => payload[i.name] = i.value);

    $.ajax({
      url: '/update_display',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload),
      success: async () => {
        await refreshLogDisplay();
      },
      error: async () => {
        await refreshLogDisplay();
      }
    });
  });
}


    // =========================
    // CLEAR SWITCH (main page)
    // =========================
    const $clearSwitch = $('#clearSwitch');
    if ($clearSwitch.length) {
        $clearSwitch.on('click', async () => {
            try {
                await $.post('/clear_switch');
            } catch (e) {
                // errors show in server logs
            }
            await refreshLogDisplay();
        });
    }

    // =========================
    // START TIMER (main page)
    // =========================
    const $startTimer = $('#startTimer');
    if ($startTimer.length) {
        $startTimer.on('click', async () => {
            const seconds = $('#timerInput').val();
            if (!seconds || isNaN(seconds)) {
                // Optional: Add client-side validation to prevent invalid starts
                alert('Please enter a valid number of seconds.');
                return;
            }

            // Save to localStorage before starting
            localStorage.setItem('lastTimerSeconds', seconds);

            try {
                await $.post('/start_timer', { seconds });
            } catch (e) {
                // server logs
            }
            // SSE will update, but we can also force a refresh
            await refreshLogDisplay();
        });
    }

    // =========================
    // STOP TIMER (main page)
    // =========================
    const $stopTimer = $('#stopTimer');
    if ($stopTimer.length) {
        $stopTimer.on('click', async () => {
            try {
                await $.post('/stop_timer');
            } catch (e) {
                // server logs
            }
            await refreshLogDisplay();
            // if SSE is down, force timer update
            updateTimer();
        });
    }
});


// pull WPA status from backend
async function checkWpaKeyStatus() {
    const badge = document.getElementById('wpaStatusBadge');
    if (!badge) return;

    // clear classes
    badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger');
    badge.textContent = '?';
    badge.classList.add('bg-secondary');

    try {
        const res = await fetch('/wpa_key_status');
        const data = await res.json();
        badge.textContent = '';
        badge.classList.remove('bg-secondary');
        if (data.loaded) {
            badge.classList.add('bg-success');
        } else {
            badge.classList.add('bg-danger');
        }
    } catch (e) {
        badge.textContent = '';
        badge.classList.remove('bg-secondary');
        badge.classList.add('bg-danger');
    }
}

// pull server logs and render into #logDisplay
async function refreshLogDisplay() {
    try {
        const res = await fetch('/logs');
        const data = await res.json(); // this is the Python list `logs`
        const logBox = $('#logDisplay');
        if (!logBox.length) return;

        logBox.empty();
        // show last 100 entries to avoid huge DOM
        data.slice(-100).forEach(line => {
            logBox.append($('<div>').text(line));
        });
        // auto-scroll to bottom
        logBox.scrollTop(logBox[0].scrollHeight);
    } catch (err) {
        console.error('Failed to fetch logs:', err);
    }
}

// format seconds to mm:ss
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}


// render timer value
function renderTimer(seconds) {
    const timerEl = document.getElementById('timer');
    if (!timerEl) return;

    if (seconds == null) {
        timerEl.textContent = '--:--';
    } else {
        timerEl.textContent = formatTime(seconds);
    }
}

function initUnifiedStream(retryDelayMs = 1500) {
    if (!window.EventSource) {
        console.warn('SSE not supported in this browser.');
        return;
    }

    const es = new EventSource('/stream');

    es.addEventListener('timer', (event) => {
    try {
        const data = JSON.parse(event.data);
        const remaining = Math.floor(data.remaining || 0);
        renderTimer(remaining);

        window.timerRunning = !!data.running;
    } catch (e) {
        console.error('Bad timer SSE data', e);
    }
    });


    es.addEventListener('logs', (event) => {
        try {
            const lines = JSON.parse(event.data);
            const logBox = $('#logDisplay');
            if (!logBox.length) return;
            logBox.empty();
            lines.forEach(line => {
                logBox.append($('<div>').text(line));
            });
            logBox.scrollTop(logBox[0].scrollHeight);
        } catch (e) {
            console.error('Bad logs SSE data', e);
        }
    });

    es.addEventListener('apstatus', (event) => {
        try {
            const data = JSON.parse(event.data);
            window.currentApData = data;
            sseUpdateStationBadges(data);
        } catch (e) {
            console.error('Bad apstatus SSE data', e);
        }
    });

    es.onerror = () => {
        console.warn('SSE connection lost, retrying...');
        es.close();
        setTimeout(() => initUnifiedStream(Math.min(retryDelayMs * 2, 10000)), retryDelayMs);
    };
}

function sseUpdateStationBadges(apData) {
    const stationKeys = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
    const allBadges = document.querySelectorAll('[id^="conn-"]');
    const globalBadge = document.getElementById('ap-global-status');
    const channelInfo = document.getElementById('ap-channel-info');

    function setBase(badge) {
        badge.className = 'badge rounded-pill px-2 py-1 text-center fw-semibold';
    }

    // === 1. AP DISABLED ===
    if (apData && apData.apEnabled === false) {
        allBadges.forEach(badge => {
            setBase(badge);
            badge.textContent = 'N/A';
            badge.classList.add('bg-secondary', 'text-white');
            badge.title = 'AP configuration disabled in server config';
        });

        if (globalBadge) {
            globalBadge.textContent = 'AP: OFF';
            globalBadge.className = 'badge bg-secondary text-white';
        }
        if (channelInfo) channelInfo.textContent = '';
        return;
    }

    // === 2. AP ERROR ===
    if (apData && apData.error) {
        allBadges.forEach(badge => {
            setBase(badge);
            badge.textContent = 'ERR';
            badge.classList.add('bg-dark', 'text-white');
            badge.title = apData.error || 'AP unreachable';
        });

        if (globalBadge) {
            globalBadge.textContent = 'AP: ERR';
            globalBadge.className = 'badge bg-danger text-white';
        }
        if (channelInfo) channelInfo.textContent = '';
        return;
    }

    // === 3. AP DATA AVAILABLE ===
    const statuses = (apData && apData.stationStatuses) ? apData.stationStatuses : {};
    const status = (apData && apData.status) || '';
    const channel = apData?.channel || '-';
    const bandwidth = apData?.channelBandwidth || '';

    // Update global AP status
    if (globalBadge) {
        if (status === 'CONFIGURING') {
            globalBadge.textContent = 'AP: CFG';
            globalBadge.className = 'badge bg-warning text-dark';
        } else if (status === 'ACTIVE') {
            globalBadge.textContent = 'AP: ON';
            globalBadge.className = 'badge bg-success text-white';
        } else {
            globalBadge.textContent = 'AP: ?';
            globalBadge.className = 'badge bg-secondary text-white';
        }
    }

    if (channelInfo && status === 'ACTIVE') {
        channelInfo.textContent = `Ch ${channel} (${bandwidth})`;
    } else {
        if (channelInfo) channelInfo.textContent = '';
    }

    // === 4. PER-STATION LOGIC ===
    stationKeys.forEach(station => {
        const badge = document.getElementById(`conn-${station}`);
        if (!badge) return;

        const info = statuses[station] || {};
        const ssid = info.ssid || '';
        const linked = !!info.isLinked;
        const stationStatus = info.status || status; // fallback to global

        // CONFIGURING: show "0"
        if (stationStatus === 'CONFIGURING') {
            setBase(badge);
            badge.textContent = '0';
            badge.classList.add('bg-configured', 'text-black');
            badge.title = 'AP is applying new configuration…';
            return;
        }

        // ACTIVE: use assigned team number from input
        if (stationStatus === 'ACTIVE') {
            const inputEl = document.getElementById(station);
            const assignedTeam = inputEl ? (inputEl.value || '').trim() : '';

            setBase(badge);

            if (linked && ssid) {
                badge.textContent = ssid;
                badge.classList.add('bg-success', 'text-white');
                badge.title = `Connected – ${info.signalDbm || 0} dBm` +
                              (info.connectionQuality ? ` – ${info.connectionQuality}` : '');
            } else if (assignedTeam && ssid.trim() === assignedTeam) {
                badge.textContent = assignedTeam;
                badge.classList.add('bg-configured', 'text-black');
                badge.title = 'Configured – waiting for client to connect';
            } else {
                badge.textContent = ssid || '-';
                badge.classList.add('bg-danger', 'text-white');
                badge.title = 'Not connected';
            }
            return;
        }

        // Fallback (no status)
        setBase(badge);
        badge.textContent = ssid || '-';

        if (info.ssid) {
            const inputEl = document.getElementById(station);
            const teamNum = inputEl ? (inputEl.value || '').trim() : '';
            const ssidTrimmed = ssid.trim();

            if (linked) {
                badge.classList.add('bg-success', 'text-white');
                badge.title = `Connected – ${info.signalDbm || 0} dBm` +
                              (info.connectionQuality ? ` – ${info.connectionQuality}` : '');
            } else if (ssidTrimmed === teamNum && teamNum !== '') {
                badge.classList.add('bg-configured', 'text-black');
                badge.title = 'Configured – waiting for client to connect';
            } else {
                badge.classList.add('bg-danger', 'text-white');
                badge.title = 'Not connected';
            }
        } else {
            badge.classList.add('bg-dark', 'text-white');
            badge.title = 'AP enabled, but no data for this station';
        }
    });
}

function refreshApStatusBadges() {
    // The server sends the current AP status every second via SSE.
    // If the SSE connection is not yet open we just skip – it will
    // be called automatically when the first `apstatus` event arrives.
    if (window.currentApData) {
        sseUpdateStationBadges(window.currentApData);
    }
}

(function () {
  const params = new URLSearchParams(window.location.search);
  const reversed = params.get('reversed') === 'true';
  if (!reversed) return;

  document.querySelectorAll('.station-row').forEach(row => {
    const containers = Array.from(row.querySelectorAll('.station-container'));
    if (containers.length === 2) {
      row.innerHTML = '';
      row.appendChild(containers[1]);
      row.appendChild(containers[0]);
    }
  });
})();

// Preset buttons functionality
document.querySelectorAll('.timer-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const seconds = parseInt(btn.dataset.seconds, 10);
    const input = document.getElementById('timerInput');
    const timerDisplay = document.getElementById('timer');

    if (input && timerDisplay && !isNaN(seconds)) {
      input.value = seconds;
      // Save preset selection to localStorage
      localStorage.setItem('lastTimerSeconds', seconds);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  });
});

// ============================
// MATCH LIST (left sidebar)
// ============================
async function fetchScheduleAndRender() {
  try {
    const res = await fetch('/schedule/data', { cache: 'no-store' });
    const data = await res.json();
    renderMatchList(data.matches || []);
  } catch (err) {
    console.error('Failed to load schedule:', err);
    const matchList = document.getElementById('matchList');
    if (matchList) {
      matchList.innerHTML = '<div class="text-muted small p-2">No schedule found.</div>';
    }
  }
}

function renderMatchList(matches) {
  const matchList = document.getElementById('matchList');
  if (!matchList) return;

  matchList.innerHTML = '';

  const timerRunning = !!window.timerRunning;

  matches.forEach(m => {
    const li = document.createElement('div');
    li.className = 'list-group-item d-flex justify-content-between align-items-start gap-2';

    const timeStr = m.start_time
      ? new Date(m.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '-';

    const red = m.red || [];
    const blue = m.blue || [];

    const redLine = [
      `<span class="text-danger fw-bold">RED - R1</span>: ${red[0] || ''}`,
      `<span class="text-danger fw-bold">R2</span>: ${red[1] || ''}`,
      `<span class="text-danger fw-bold">R3</span>: ${red[2] || ''}`
    ].join(', ');

    const blueLine = [
      `<span class="text-primary fw-bold">BLUE - B1</span>: ${blue[0] || ''}`,
      `<span class="text-primary fw-bold">B2</span>: ${blue[1] || ''}`,
      `<span class="text-primary fw-bold">B3</span>: ${blue[2] || ''}`
    ].join(', ');

    const info = document.createElement('div');
    info.className = 'me-2 flex-grow-1';
    info.innerHTML = `
      <div class="${m.done ? 'text-muted text-decoration-line-through' : ''}">
        Match ${m.match_id} — ${timeStr}
      </div>
      <div class="small ${m.done ? 'text-muted' : ''}">
        ${redLine}
      </div>
      <div class="small ${m.done ? 'text-muted' : ''}">
        ${blueLine}
      </div>
    `;

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm ' + (m.done ? 'btn-outline-secondary' : 'btn-outline-primary');
    btn.textContent = 'Load';

    if (timerRunning) {
      btn.disabled = true;
      btn.title = 'Cannot load match while timer is running';
    }

    btn.addEventListener('click', () => {
      if (window.timerRunning) {
        alert('Timer is running. Stop the timer before loading a new match.');
        return;
      }
      loadMatchIntoStations(m);
      markMatchDone(m.match_id, true);
    });

    li.appendChild(info);
    li.appendChild(btn);
    matchList.appendChild(li);
  });
}



async function loadMatchIntoStations(matchObj) {
  const red = matchObj.red || [];
  const blue = matchObj.blue || [];

  // fill inputs
  document.getElementById('red1').value = red[0] || '';
  document.getElementById('red2').value = red[1] || '';
  document.getElementById('red3').value = red[2] || '';
  document.getElementById('blue1').value = blue[0] || '';
  document.getElementById('blue2').value = blue[1] || '';
  document.getElementById('blue3').value = blue[2] || '';

  // push config automatically
  try {
    const payload = {};
    $('#configForm').serializeArray().forEach(i => payload[i.name] = i.value);
    await $.ajax({
      url: '/push_config',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
    console.log(`Match ${matchObj.match_id} loaded and pushed.`);
  } catch (err) {
    console.error('Failed to push config:', err);
  }
}


async function markMatchDone(matchId, done) {
  try {
    await fetch('/schedule/mark_done', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ match_id: matchId, done })
    });
    // re-render so it goes gray/strikethrough
    fetchScheduleAndRender();
  } catch (err) {
    console.error('Failed to mark match done:', err);
  }
}

// hook refresh button
document.addEventListener('DOMContentLoaded', () => {
  const refBtn = document.getElementById('refreshSchedule');
  if (refBtn) {
    refBtn.addEventListener('click', fetchScheduleAndRender);
  }
  // initial load
  fetchScheduleAndRender();
});

async function prefillTeamListFromServer() {
    const input = document.getElementById('teamListInput');
    if (!input) return; // not on this page

    try {
        const res = await fetch('/teams/all', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.teams) && data.teams.length) {
            input.value = data.teams.join(', ');
        }
    } catch (e) {
        console.warn('Could not load team list from /teams/all', e);
    }
}
