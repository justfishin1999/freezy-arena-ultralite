let hasBuzzerPlayed = false;
    const urlParams = new URLSearchParams(window.location.search);
    let isReversed = urlParams.get('reversed')?.toLowerCase() === 'true';

    // unlock audio on first click so the buzzer can play
    function unlockAudio() {
      const buzzer = document.getElementById('buzzer');
      if (!buzzer) return;
      buzzer.play().then(() => {
        buzzer.pause();
        buzzer.currentTime = 0;
        window.removeEventListener('click', unlockAudio);
      }).catch(() => {
        // try again on next click
      });
    }
    window.addEventListener('click', unlockAudio);

    function formatTime(seconds) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function showAlert() {
      const alert = document.getElementById('alert');
      alert.style.display = 'block';
      setTimeout(() => {
        alert.style.display = 'none';
      }, 5000);
    }

    function renderTimer(seconds) {
      document.getElementById('timer').textContent = formatTime(seconds);
    }

    function handleBuzzer(data) {
      if (data.buzzer && !hasBuzzerPlayed) {
        const buzzer = document.getElementById('buzzer');
        buzzer.play().catch(error => {
          console.error('end.wav playback failed:', error);
          showAlert();
        });
        hasBuzzerPlayed = true;
      }
    }

    // SSE for timer: no fallback to /timer_status, just keep retrying
    function initTimerSSE(retryDelayMs = 1500) {
      if (!window.EventSource) {
        console.error('This browser does not support EventSource, and fallback is disabled.');
        return;
      }

      const es = new EventSource('/timer_stream');

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const remaining = Math.floor(data.remaining || 0);
          renderTimer(remaining);
          handleBuzzer(data);
        } catch (e) {
          console.error('Bad SSE timer data:', e);
        }
      };

      es.onerror = () => {
        console.warn('SSE connection lost. Retrying...');
        es.close();
        setTimeout(() => initTimerSSE(Math.min(retryDelayMs * 2, 10000)), retryDelayMs);
      };
    }

    function updateTeams() {
      fetch('/teams')
        .then(response => response.json())
        .then(data => {
          const teamsDiv = document.getElementById('teams');
          teamsDiv.innerHTML = '';

          const redStations = ['red1', 'red2', 'red3'];
          const blueStations = ['blue1', 'blue2', 'blue3'];

          const orderedStations = isReversed
            ? [...blueStations, ...redStations]
            : [...redStations, ...blueStations];

          orderedStations.forEach(station => {
            const team = data[station];
            if (team) {
              const box = document.createElement('div');
              box.className = `team-box ${station.startsWith('red') ? 'red' : 'blue'}`;
              box.textContent = team;
              teamsDiv.appendChild(box);
            }
          });
        })
        .catch(err => console.error('Fetching teams failed:', err));
    }

    // start everything
    initTimerSSE();
    updateTeams();
    setInterval(updateTeams, 5000);

    // Toggle reversed on double click anywhere
    document.addEventListener('dblclick', function() {
      isReversed = !isReversed;
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('reversed', isReversed.toString());
      window.location.href = newUrl.toString();
    });