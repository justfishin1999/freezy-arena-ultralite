// static/js/app.js
$(function () {
    // initial status
    checkWpaKeyStatus();
    refreshLogDisplay();

    // set up timer: prefer SSE
    initTimerStream();

    // poll logs every few seconds to stay live
    setInterval(refreshLogDisplay, 5000);

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
            console.warn('SSE connection lost, falling back to polling.');
            es.close();
            // fallback to poll
            setInterval(updateTimer, 1000);
        };
    } else {
        // no SSE support
        setInterval(updateTimer, 1000);
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

// fallback: pull timer status from backend and update display
async function updateTimer() {
    try {
        const res = await fetch('/timer_status');
        const data = await res.json();
        renderTimer(data.remaining || 0);
    } catch (e) {
        renderTimer(null);
    }
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
