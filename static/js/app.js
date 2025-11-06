// static/js/app.js
$(function () {
    // initial status
    checkWpaKeyStatus();
    refreshLogDisplay();

    // set up timer: prefer SSE
    initUnifiedStream();

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
            // if you want to reflect “running” in UI, you can update a label here
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

    function setBase(badge) {
        badge.className = 'badge rounded-pill px-2 py-1 text-center fw-semibold';
    }

    // AP disabled in config.json
    if (apData && apData.apEnabled === false) {
        allBadges.forEach(badge => {
            setBase(badge);
            badge.textContent = 'N/A';
            badge.classList.add('bg-secondary', 'text-white');
            badge.title = 'AP configuration disabled in server config';
        });
        return;
    }

    // AP enabled but error talking to it
    if (apData && apData.error) {
        allBadges.forEach(badge => {
            setBase(badge);
            badge.textContent = 'ERR';
            badge.classList.add('bg-dark', 'text-white');
            badge.title = apData.error || 'AP unreachable';
        });
        return;
    }

    const statuses = (apData && apData.stationStatuses) ? apData.stationStatuses : {};

    stationKeys.forEach(station => {
        const badge = document.getElementById(`conn-${station}`);
        if (!badge) return;

        const info = statuses[station] || {};
        const ssid = info.ssid || 'ERR';
        const linked = !!info.isLinked;

        // always start from base so we keep pill + alignment
        setBase(badge);
        badge.textContent = ssid;

        if (info.ssid) {
            if (linked) {
                badge.classList.add('bg-success', 'text-white');
                badge.title =
                    `Connected – ${info.signalDbm || 0} dBm` +
                    (info.connectionQuality ? ` – ${info.connectionQuality}` : '');
            } else {
                badge.classList.add('bg-danger', 'text-white');
                badge.title = 'Not connected';
            }
        } else {
            // AP up, but no data for this station
            badge.classList.add('bg-dark', 'text-white');
            badge.title = 'AP enabled, but no data for this station';
        }
    });
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
