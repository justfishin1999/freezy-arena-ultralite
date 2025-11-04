// static/js/app.js
$(function () {
    // initial status checks
    checkWpaKeyStatus();
    refreshLogDisplay();
    updateTimer();

    // poll timer every second
    setInterval(updateTimer, 1000);

    // (optional) poll logs every few seconds to stay live
    setInterval(refreshLogDisplay, 5000);

    // ========== CSV IMPORT ==========
    $('#csvForm').on('submit', function (e) {
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

    // ========== GENERATE WPA KEYS ==========
    $('#generateKeys').on('click', () => {
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

    // ========== PUSH CONFIG ==========
    $('#configForm').on('submit', function (e) {
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

    // ========== UPDATE DISPLAY ONLY ==========
    $('#updateDisplay').on('click', function () {
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

    // ========== CLEAR SWITCH ==========
    $('#clearSwitch').on('click', async () => {
        try {
            await $.post('/clear_switch');
        } catch (e) {
            // ignore; we'll refresh logs to see error from backend
        }
        await refreshLogDisplay();
    });

    // ========== START TIMER ==========
    $('#startTimer').on('click', async () => {
        const minutes = $('#timerInput').val();
        try {
            await $.post('/start_timer', { minutes });
        } catch (e) {
            // errors will be in server logs
        }
        await refreshLogDisplay();
        await updateTimer();
    });

    // ========== STOP TIMER (new) ==========
    $('#stopTimer').on('click', async () => {
        try {
            await $.post('/stop_timer');
        } catch (e) {
            // errors will be in server logs
        }
        await refreshLogDisplay();
        await updateTimer();
    });
});


// ========== FUNCTIONS ==========

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
        // if logs can't be fetched, do nothing
        console.error('Failed to fetch logs:', err);
    }
}

// format seconds to mm:ss
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// pull timer status from backend and update display
async function updateTimer() {
    try {
        const res = await fetch('/timer_status');
        const data = await res.json();
        const timerEl = document.getElementById('timer');
        if (timerEl) {
            timerEl.textContent = formatTime(data.remaining || 0);
        }
    } catch (e) {
        const timerEl = document.getElementById('timer');
        if (timerEl) {
            timerEl.textContent = '--:--';
        }
    }
}
