// static/js/match_scheduling_audience.js

async function fetchSchedule() {
  try {
    const res = await fetch('/schedule/data', { cache: 'no-store' });
    const data = await res.json();
    renderAudienceList(data.matches || []);
  } catch (err) {
    console.error('Failed to fetch schedule', err);
  }
}

function renderAudienceList(matches) {
  const container = document.getElementById('audienceList');
  if (!container) return;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();

  matches.forEach(m => {
    const div = document.createElement('div');
    div.className = 'match-line';

    const timeStr = m.start_time
      ? new Date(m.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    const redTeams = (m.red || []).join(', ') || '–';
    const blueTeams = (m.blue || []).join(', ') || '–';

    div.innerHTML = `
      <span class="match-id">Match ${m.match_id}</span>
      <span class="match-time">${timeStr}</span>
      <span class="match-red">RED: ${redTeams}</span>
      <span class="match-blue">BLUE: ${blueTeams}</span>
    `;

    fragment.appendChild(div);
  });

  // Duplicate list for seamless scroll
  const dup = fragment.cloneNode(true);
  container.appendChild(fragment);
  container.appendChild(dup);
}


fetchSchedule();

setInterval(fetchSchedule, 60000);
