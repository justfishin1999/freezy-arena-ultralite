// static/js/app.js
$(function () {
    // initial status
    checkWpaKeyStatus();
    refreshLogDisplay();

    // set up timer: prefer SSE
    initTimerStream();

    // poll logs every few seconds to stay live
    setInterval(refreshLogDisplay, 5000);

    // poll station connection statuses
    updateStationBadges();
    setInterval(updateStationBadges, 3000);

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


// =========================
// FUNCTIONS
// =========================

// prefer SSE for timer
function initTimerStream() {
    const timerEl = document.getElementById('timer');
    if (!timerEl) {
        return; // page doesn't have a timer
    }

    if (!!window.EventSource) {
        const es = new EventSource('/timer_stream');

        es.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);
                const remaining = Math.floor(data.remaining || 0);
                renderTimer(remaining);
            } catch (e) {
                // ignore
            }
        };

        es.onerror = function () {
            console.warn('SSE connection lost');
            es.close();
            setTimeout(() => initTimerStream(Math.min(retryDelayMs * 2, 10000)), retryDelayMs);
        };
    } else {
        // no SSE, try again
        setTimeout(() => initTimerStream(Math.min(retryDelayMs * 2, 10000)), retryDelayMs);
    }
}

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

// -------------------------------------------------
// Update per-station connection badges (via /ap_status)
// -------------------------------------------------
async function updateStationBadges() {
  const stationKeys = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
  const allBadges = document.querySelectorAll('[id^="conn-"]');

  let apEnabled = true;

  // 1) ask the server config first
  try {
    const cfgRes = await fetch('/config_status', { cache: 'no-store' });
    const cfgData = await cfgRes.json();
    apEnabled = cfgData.apEnabled ?? true;
  } catch (err) {
    console.warn('Could not load /config_status, assuming AP enabled.');
  }

  // if AP is disabled in config, just show N/A and stop
  if (!apEnabled) {
    allBadges.forEach(badge => {
      badge.textContent = 'INACTIVE';
      badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger', 'bg-dark');
      badge.classList.add('bg-secondary');   // gray
      badge.title = 'AP configuration disabled in server config';
    });
    return;
  }

  // 2) otherwise, AP is enabled → query real AP status
  try {
    const res = await fetch('/ap_status', { cache: 'no-store' });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    const statuses = data.stationStatuses || {};

    stationKeys.forEach(station => {
      const badge = document.getElementById(`conn-${station}`);
      if (!badge) return;

      const info = statuses[station] || {};
      const ssid = info.ssid || 'ERR';
      const linked = !!info.isLinked;

      // keep pill shape; only change bg
      badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger', 'bg-dark');

      badge.textContent = ssid;
      if (info.ssid) {
        badge.classList.add(linked ? 'bg-success' : 'bg-danger');
        badge.title = linked
          ? `Connected – ${info.signalDbm || 0} dBm${info.connectionQuality ? ' – ' + info.connectionQuality : ''}`
          : 'Not connected';
      } else {
        badge.classList.add('bg-dark');
        badge.title = 'AP enabled, but no data for this station';
      }
    });

  } catch (err) {
    console.error('AP status failed:', err);
    // AP is enabled but unreachable → ERR
    allBadges.forEach(badge => {
      badge.textContent = 'ERR';
      badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger');
      badge.classList.add('bg-dark');
      badge.title = 'AP enabled in server config, but unreachable';
    });
  }
}