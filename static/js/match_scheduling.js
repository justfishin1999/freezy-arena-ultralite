// static/js/match_scheduling.js
$(async function () {
  await loadSchedule();

  $('#addBlock').on('click', function () {
    $('#blocksContainer').append(`
      <div class="block-row d-flex gap-2 mt-1">
        <input type="time" class="form-control form-control-sm block-start" value="08:00">
        <input type="time" class="form-control form-control-sm block-end" value="12:00">
        <input type="number" class="form-control form-control-sm block-gap" value="6" title="Gap in minutes">
      </div>
    `);
  });

  $('#generateSchedule').on('click', async function () {
    const teams = $('#teamsInput').val().split(',').map(t => t.trim()).filter(Boolean);
    const matchesPerTeam = parseInt($('#matchesPerTeam').val(), 10) || 1;

    const blocks = [];
    $('#blocksContainer .block-row').each(function () {
      const start = $(this).find('.block-start').val();
      const end = $(this).find('.block-end').val();
      const gapMin = parseInt($(this).find('.block-gap').val(), 10) || 6;
      if (start && end) {
        blocks.push({ start, end, gap_minutes: gapMin });
      }
    });

    $('#scheduleStatus').text('Generating…');

    try {
      const res = await fetch('/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teams,
          matches_per_team: matchesPerTeam,
          blocks
        })
      });
      const data = await res.json();
      if (!res.ok) {
        $('#scheduleStatus').text(data.message || 'Error generating schedule');
        return;
      }
      $('#scheduleStatus').text('Schedule generated and saved.');
      renderScheduleTable(data.schedule.matches);
    } catch (err) {
      console.error(err);
      $('#scheduleStatus').text('Error generating schedule.');
    }
  });

  $('#clearSchedule').on('click', async function () {
    if (!confirm("Clear the current schedule?")) return;
    try {
      await fetch('/schedule/clear', { method: 'POST' });
      $('#scheduleStatus').text('Schedule cleared.');
      renderScheduleTable([]);
    } catch (err) {
      console.error(err);
      $('#scheduleStatus').text('Error clearing schedule.');
    }
  });
});

async function loadSchedule() {
  try {
    const res = await fetch('/schedule/data', { cache: 'no-store' });
    const data = await res.json();
    renderScheduleTable(data.matches || []);

    let teamsFilled = false;

    // repopulate form from schedule
    if (data.meta && Array.isArray(data.meta.teams) && data.meta.teams.length) {
      $('#teamsInput').val(data.meta.teams.join(', '));
      teamsFilled = true;
    }

    if (data.meta && data.meta.matches_per_team) {
      $('#matchesPerTeam').val(data.meta.matches_per_team);
    }

    if (data.meta && Array.isArray(data.meta.blocks) && data.meta.blocks.length) {
      const bc = $('#blocksContainer');
      bc.empty();
      data.meta.blocks.forEach(b => {
        bc.append(`
          <div class="block-row d-flex gap-2 mt-1">
            <input type="time" class="form-control form-control-sm block-start" value="${b.start}">
            <input type="time" class="form-control form-control-sm block-end" value="${b.end}">
            <input type="number" class="form-control form-control-sm block-gap" value="${b.gap_minutes || 6}" title="Gap in minutes">
          </div>
        `);
      });
    }

    // 🔁 fallback: no teams in schedule, try the shared team list
    if (!teamsFilled) {
      try {
        const teamsRes = await fetch('/teams/all', { cache: 'no-store' });
        if (teamsRes.ok) {
          const teamsData = await teamsRes.json();
          if (Array.isArray(teamsData.teams) && teamsData.teams.length) {
            $('#teamsInput').val(teamsData.teams.join(', '));
          }
        }
      } catch (e) {
        console.warn('Could not load teams from /teams/all', e);
      }
    }

  } catch (err) {
    console.error('Failed to load schedule', err);
  }
}

function renderScheduleTable(matches) {
  const tbody = $('#scheduleTable tbody');
  tbody.empty();
  matches.forEach(m => {
    const timeStr = m.start_time
      ? new Date(m.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    tbody.append(`
      <tr>
        <td>${m.match_id}</td>
        <td>${timeStr}</td>
        <td>${(m.red || []).join(', ')}</td>
        <td>${(m.blue || []).join(', ')}</td>
      </tr>
    `);
  });
}
