$(function () {
    checkWpaKeyStatus();

    $('#csvForm').on('submit', function (e) {
        e.preventDefault();
        let formData = new FormData(this);
        $.ajax({
            url: '/import_csv',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: () => {
                log('CSV Imported.');
                checkWpaKeyStatus();
            },
            error: () => log('Failed to import CSV.')
        });
    });

    $('#generateKeys').on('click', () => {
        let teams = $('#teamListInput').val().split(',').map(t => t.trim());
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/generate_team_keys', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.responseType = 'blob';

        xhr.onload = function () {
            if (xhr.status === 200) {
                const blob = new Blob([xhr.response], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'wpa_keys.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                log(`Generated WPA keys for: ${teams.join(', ')}`);
                checkWpaKeyStatus();
            } else {
                log('Failed to generate keys.');
            }
        };

        xhr.send(JSON.stringify({ teams }));
    });

    $('#configForm').on('submit', function (e) {
        e.preventDefault();
        let payload = {};
        $(this).serializeArray().forEach(i => payload[i.name] = i.value);
        $.ajax({
            url: '/push_config',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            success: () => log('Configuration pushed.'),
            error: () => log('Failed to push config.')
        });
    });

    $('#updateDisplay').on('click', function () {
        let payload = {};
        $('#configForm').serializeArray().forEach(i => payload[i.name] = i.value);
        $.ajax({
            url: '/update_display',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            success: () => log('Audience display updated.'),
            error: () => log('Failed to update display.')
        });
    });

    $('#clearSwitch').on('click', () => {
        $.post('/clear_switch')
            .done(() => log('Switch config cleared.'))
            .fail(() => log('Failed to clear switch config.'));
    });

    $('#startTimer').on('click', () => {
        let minutes = $('#timerInput').val();
        $.post('/start_timer', { minutes })
            .done(() => log('Timer started.'))
            .fail(() => log('Failed to start timer.'));
    });

    function log(message) {
        $('#logDisplay').append($('<div>').text(new Date().toLocaleTimeString() + ' - ' + message));
    }
});

function checkWpaKeyStatus() {
    const badge = document.getElementById('wpaStatusBadge');

    // Remove all possible background classes
    badge.classList.remove('bg-secondary', 'bg-success', 'bg-danger');

    // Set default ? state
    badge.textContent = '?';
    badge.classList.add('bg-secondary');

    fetch('/wpa_key_status')
        .then(res => res.json())
        .then(data => {
            if (data.loaded) {
                badge.textContent = '';
                badge.classList.add('bg-success');
            } else {
                badge.textContent = '';
                badge.classList.add('bg-danger');
            }
        })
        .catch(() => {
            badge.textContent = '';
            badge.classList.add('bg-danger');
        });
}
 
