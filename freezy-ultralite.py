import csv
import datetime
import io
import json
import secrets
import string
import telnetlib3
import time
import requests
import subprocess
import platform
import os
import sys
from flask import Flask, Response, make_response, render_template, request, jsonify, redirect, stream_with_context, url_for

cli = sys.modules['flask.cli']
cli.show_server_banner = lambda *x: None

app = Flask(__name__)

CONFIG_FILE = "config.json"
MATCH_SCHEDULE_FILE = "match_schedule.json"

default_config = {
    "ap_ip": "10.0.100.2",
    "switch_ip": "10.0.100.3",
    "switch_password": "1234Five",
    "enable_ap": True,
    "enable_switch": True,
    "event_name": "Super Cool Event",
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
                # merge to ensure new fields get defaults
                cfg = default_config.copy()
                cfg.update(data)
                return cfg
        except Exception:
            return default_config.copy()
    return default_config.copy()

def save_config(cfg):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)

def load_match_schedule():
    if os.path.exists(MATCH_SCHEDULE_FILE):
        try:
            with open(MATCH_SCHEDULE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {"matches": [], "meta": {}}
    return {"matches": [], "meta": {}}

def save_match_schedule(data: dict):
    with open(MATCH_SCHEDULE_FILE, "w") as f:
        json.dump(data, f, indent=2)

runtime_config = load_config()

STATION_KEYS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]
VLAN_MAP = {"red1": 10, "red2": 20, "red3": 30, "blue1": 40, "blue2": 50, "blue3": 60}
GATEWAY_SUFFIX = 4

WPA_FILE = "wpa_keys.json"

@app.route('/config_status')
def config_status():
    return jsonify({
        "apEnabled": bool(runtime_config.get("enable_ap", True))
    })

def load_wpa_keys():
    if os.path.exists(WPA_FILE):
        try:
            with open(WPA_FILE, "r") as f:
                return json.load(f)
        except Exception:
            # bad file, return empty
            return {}
    return {}

def save_wpa_keys(data: dict):
    with open(WPA_FILE, "w") as f:
        json.dump(data, f, indent=2)

# load at startup
team_config = load_wpa_keys()
selected_teams = {key: "" for key in STATION_KEYS}

timer_duration = 0
timer_start_time = None
timer_running = False
buzzer_triggered = False

logs = []

audience_display_teams = {key: "" for key in STATION_KEYS}

match_schedule = load_match_schedule()

# flask routes
@app.route('/')
def index():
    return render_template('index.html', stations=STATION_KEYS, ap_ip=runtime_config.get("ap_ip"), ap_enabled=runtime_config.get("enable_ap"), switch_enabled=runtime_config.get("enable_switch"))

@app.route('/setup', methods=['GET'])
def config_page():
    # render the config form with current values
    return render_template('setup.html', cfg=runtime_config)

@app.route('/setup', methods=['POST'])
def save_config_route():
    global runtime_config
    # get values from form
    ap_ip = request.form.get('ap_ip', '').strip()
    switch_ip = request.form.get('switch_ip', '').strip()
    switch_password = request.form.get('switch_password', '').strip()
    enable_ap = request.form.get('enable_ap') == 'on'
    enable_switch = request.form.get('enable_switch') == 'on'
    event_name = request.form.get('event_name', '').strip()

    # update in-memory
    runtime_config['ap_ip'] = ap_ip or runtime_config['ap_ip']
    runtime_config['switch_ip'] = switch_ip or runtime_config['switch_ip']
    # allow empty password? usually yes, so just assign
    runtime_config['switch_password'] = switch_password
    runtime_config['enable_ap'] = enable_ap
    runtime_config['enable_switch'] = enable_switch
    runtime_config['event_name'] = event_name

    save_config(runtime_config)
    log("Configuration settings updated.")
    return redirect(url_for('config_page'))

@app.route('/audience')
def audience():
    return render_template('audience.html')

@app.route('/wall')
def wall():
    return render_template('wall.html')

@app.route('/import_csv', methods=['POST'])
def import_csv():
    file = request.files.get('file')
    if not file:
        return "No file uploaded", 400
    try:
        reader = csv.reader(file.stream.read().decode('utf-8').splitlines())
        for row in reader:
            if len(row) == 2:
                team, key = row[0].strip(), row[1].strip()
                if team.isdigit():
                    team_config[team] = key
        save_wpa_keys(team_config)
        log("CSV imported successfully.")
        return jsonify({"status": "success"})
    except Exception as e:
        log(f"CSV import error: {e}")
        return jsonify({"status": "error", "message": str(e)})

def generate_random_key(length=8):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

@app.route('/generate_team_keys', methods=['POST'])
def generate_team_keys():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Invalid content type"}), 415

    data = request.get_json()
    teams = data.get('teams', [])
    output = io.StringIO()
    writer = csv.writer(output)

    for team in teams:
        team = team.strip()
        if team.isdigit():
            key = generate_random_key()
            team_config[team] = key
            writer.writerow([team, key])
    save_wpa_keys(team_config)
    response = make_response(output.getvalue())
    response.headers['Content-Disposition'] = 'attachment; filename=wpa_keys.csv'
    response.headers['Content-Type'] = 'text/csv'
    return response

@app.route('/clear_wpa_keys', methods=['POST'])
def clear_wpa_keys():
    global team_config
    team_config = {}
    save_wpa_keys(team_config)
    log("All WPA keys cleared.")
    return jsonify({"status": "success"})

@app.route('/update_display', methods=['POST'])
def update_display():
    global station_assignments
    data = request.get_json() or {}

    for station in STATION_KEYS:
        audience_display_teams[station] = data.get(station, "").strip()
    

    # 1. keep a copy of the team numbers
    new_assign = {}
    for key in STATION_KEYS:
        new_assign[key] = data.get(key, "").strip()
    station_assignments = new_assign
    save_station_assignments(station_assignments)


    log("Audience display updated.")
    return jsonify({"status": "success"})

@app.route('/teams')
def get_teams():
    return jsonify(audience_display_teams)

@app.route('/push_config', methods=['POST'])
def push_config():
    global timer_running
    remaining, running = get_timer_state()
    if running:
        return jsonify({"status": "error", "message": "Cannot push config while timer is running!"})

    global station_assignments
    data = request.get_json() or {}

    # 1. keep a copy of the team numbers
    new_assign = {}
    for key in STATION_KEYS:
        new_assign[key] = data.get(key, "").strip()
    station_assignments = new_assign
    save_station_assignments(station_assignments)

    stations = {}
    switch_entries = {}

    for station in STATION_KEYS:
        team = data.get(station, "").strip()
        selected_teams[station] = team
        if team:
            if team not in team_config:
                msg = f"Missing WPA key for team {team}"
                log(msg)
                return jsonify({"status": "error", "message": msg})
            stations[station] = {"ssid": team, "wpaKey": team_config[team]}
            switch_entries[station] = int(team)

    # now push according to enabled flags, no ping first
    try:
        if runtime_config.get("enable_ap"):
            push_ap_configuration(stations)
            log("AP configuration pushed.")
        else:
            log("AP configuration disabled; skipping.")

        if runtime_config.get("enable_switch"):
            configure_switch(switch_entries)
            log("Switch configuration pushed.")
        else:
            log("Switch configuration disabled; skipping.")

        # also update audience display to match
        update_display_internal(stations=data)
        return jsonify({"status": "success"})
    except Exception as e:
        log(f"Push config error: {e}")
        return jsonify({"status": "error", "message": str(e)})

# -------------------------------------------------
#  NEW: persist last-used station assignments
# -------------------------------------------------
STATION_ASSIGNMENTS_FILE = "station_assignments.json"

@app.route('/get_station_assignments')
def get_station_assignments():
    return jsonify(station_assignments)

def load_station_assignments():
    if os.path.exists(STATION_ASSIGNMENTS_FILE):
        try:
            with open(STATION_ASSIGNMENTS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {k: "" for k in STATION_KEYS}

def save_station_assignments(data: dict):
    with open(STATION_ASSIGNMENTS_FILE, "w") as f:
        json.dump(data, f, indent=2)

# load at startup
station_assignments = load_station_assignments()

def update_display_internal(stations):
    for station in STATION_KEYS:
        audience_display_teams[station] = stations.get(station, "").strip()
    log("Audience display updated (internal).")

@app.route('/clear_switch', methods=['POST'])
def clear_switch():
    global timer_running
    if timer_running:
        return jsonify({"status": "error", "message": "Cannot clear switch config while timer is running!"})

    try:
        if runtime_config.get("enable_switch"):
            clear_switch_config()
            log("Switch configuration cleared.")
        else:
            log("Switch configuration disabled; skipping clear.")
        return jsonify({"status": "success"})
    except Exception as e:
        log(f"Clear switch error: {e}")
        return jsonify({"status": "error", "message": str(e)})

@app.route('/start_timer', methods=['POST'])
def start_timer():
    global timer_start_time, timer_duration, timer_running, buzzer_triggered
    try:
        seconds = int(request.form.get('seconds', '0'))
    except ValueError:
        return jsonify({"status": "error", "message": "Invalid seconds"}), 400

    if seconds <= 0:
        return jsonify({"status": "error", "message": "Seconds must be > 0"}), 400

    timer_duration = seconds
    timer_start_time = time.time()
    timer_running = True
    buzzer_triggered = False
    log(f"{seconds} second timer started.")
    return jsonify({"status": "started"})

@app.route('/stop_timer', methods=['POST'])
def stop_timer():
    global timer_running, timer_start_time, timer_duration, buzzer_triggered
    timer_running = False
    timer_start_time = None
    timer_duration = 0
    buzzer_triggered = False
    log("Timer stopped.")
    return jsonify({"status": "stopped"})

def get_timer_state():
    global timer_start_time, timer_running, timer_duration
    if timer_running and timer_start_time:
        elapsed = time.time() - timer_start_time
        remaining = timer_duration - elapsed
        if remaining <= 0:
            timer_running = False
            timer_start_time = None
            remaining = 0
        return remaining, timer_running
    return timer_duration, False


@app.route('/timer_stream')
def timer_stream():
    def event_stream():
        global buzzer_triggered
        yield ": ok\n\n"
        while True:
            remaining, running = get_timer_state()
            trigger_buzzer = False
            if running and remaining <= 0 and not buzzer_triggered:
                trigger_buzzer = True
                buzzer_triggered = True

            payload = json.dumps({
                "remaining": remaining,
                "running": running,
                "buzzer": trigger_buzzer,
                "event_name": runtime_config.get("event_name",""),
                "teams": audience_display_teams,
            })
            yield f"data: {payload}\n\n"
            time.sleep(1)

    resp = Response(stream_with_context(event_stream()), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    return resp



@app.route('/timer_status')
def timer_status():
    remaining, running = get_timer_state()

    trigger_buzzer = bool(running and remaining <= 0 and not buzzer_triggered)

    return jsonify({
        "remaining": remaining,
        "running": running,
        "buzzer": trigger_buzzer
    })


@app.route('/logs')
def get_logs():
    return jsonify(logs)

@app.route('/ap_status')
def ap_status_proxy():
    """
    Used by app.js to get live AP status.
    Uses runtime_config['ap_ip'].
    """
    ap_ip = runtime_config.get("ap_ip", "").strip()
    data = fetch_ap_status(ap_ip)
    return jsonify(data)

@app.route('/wpa_key_status')
def wpa_key_status():
    return jsonify({'loaded': len(team_config) > 0})

def log(msg):
    logs.append(msg)
    print(msg)

def push_ap_configuration(stations):
    # uses runtime_config for AP IP
    ap_ip = runtime_config.get("ap_ip")
    payload = {"channel": 13, "stationConfigurations": stations}
    response = requests.post(
        f"http://{ap_ip}/configuration",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=3
    )
    if response.status_code // 100 != 2:
        raise Exception(f"Access point returned status {response.status_code}: {response.text}")

def configure_switch(teams):
    switch_ip = runtime_config.get("switch_ip")
    switch_password = runtime_config.get("switch_password") or ""
    tn = telnetlib3.Telnet(switch_ip, 23, timeout=5)
    tn.read_until(b"Password: ")
    tn.write(switch_password.encode("ascii") + b"\n")
    tn.write(b"enable\n" + switch_password.encode("ascii") + b"\n")
    tn.write(b"terminal length 0\nconfigure terminal\n")

    # first clear out existing for these vlans
    for vlan in VLAN_MAP.values():
        tn.write(f"interface Vlan{vlan}\nno ip address\nno access-list 1{vlan}\nno ip dhcp pool dhcp{vlan}\n".encode())

    for station, team in teams.items():
        vlan = VLAN_MAP[station]
        ip_base = f"10.{team // 100}.{team % 100}"
        gateway = f"{ip_base}.{GATEWAY_SUFFIX}"
        tn.write(f"""
ip dhcp excluded-address {ip_base}.1 {ip_base}.19
ip dhcp excluded-address {ip_base}.200 {ip_base}.254
ip dhcp pool dhcp{vlan}
 network {ip_base}.0 255.255.255.0
 default-router {gateway}
 lease 7
interface Vlan{vlan}
 ip address {gateway} 255.255.255.0
""".encode())

    tn.write(b"end\ncopy running-config startup-config\n\nexit\n")
    tn.read_all().decode()

def clear_switch_config():
    switch_ip = runtime_config.get("switch_ip")
    switch_password = runtime_config.get("switch_password") or ""
    tn = telnetlib3.Telnet(switch_ip, 23, timeout=5)
    tn.read_until(b"Password: ")
    tn.write(switch_password.encode("ascii") + b"\n")
    tn.write(b"enable\n" + switch_password.encode("ascii") + b"\n")
    tn.write(b"terminal length 0\nconfigure terminal\n")
    for vlan in VLAN_MAP.values():
        tn.write(f"""
interface Vlan{vlan}
 no ip address
exit
no access-list 1{vlan}
no ip dhcp pool dhcp{vlan}
""".encode())
    tn.write(b"end\ncopy running-config startup-config\n\nexit\n")
    tn.read_all().decode()

# ------------------------------------------------------------------
# Helper: fetch status from external AP
# ------------------------------------------------------------------
def fetch_ap_status(ap_ip: str):
    """
    Fetch /status from the AP.
    Returns dict on success, or error dict on failure.
    """
    if not runtime_config.get("enable_ap"):
        return {"error": "AP IP not configured"}
    else:
        url = f"http://{ap_ip.strip()}/status"
        try:
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            log("AP status: timeout (5s)")
            return {"error": "AP timeout (5s)", "ap_ip": ap_ip}
        except requests.exceptions.ConnectionError:
            log(f"AP status: cannot reach {ap_ip}")
            return {"error": "Cannot reach AP", "ap_ip": ap_ip}
        except requests.exceptions.HTTPError:
            log(f"AP status: HTTP {resp.status_code}")
            return {"error": f"HTTP {resp.status_code}", "ap_ip": ap_ip}
        except ValueError:
            log("AP status: invalid JSON")
            return {"error": "Invalid JSON from AP", "raw": resp.text[:200]}
        except Exception as e:
            log(f"AP status: unexpected error: {e}")
            return {"error": "Unexpected error", "details": str(e)}
        
@app.route('/stream')
def unified_stream():
    def event_stream():
        global buzzer_triggered

        # let browsers know the stream is alive
        yield ": ok\n\n"

        # we’ll keep track of the last log length so we only send new ones
        last_log_len = len(logs)

        while True:
            # 1) timer
            remaining, running = get_timer_state()
            trigger_buzzer = False
            if running and remaining <= 0 and not buzzer_triggered:
                trigger_buzzer = True
                buzzer_triggered = True

            timer_payload = json.dumps({
                "remaining": remaining,
                "running": running,
                "buzzer": trigger_buzzer,
                "event_name": runtime_config.get("event_name",""),
                "teams": audience_display_teams,

            })
            yield f"event: timer\ndata: {timer_payload}\n\n"

            # 2) logs (only if new)
            current_len = len(logs)
            if current_len != last_log_len:
                # send only the last ~100 to avoid giant payloads
                recent_logs = logs[-100:]
                logs_payload = json.dumps(recent_logs)
                yield f"event: logs\ndata: {logs_payload}\n\n"
                last_log_len = current_len

            # 3) AP status (only if AP is enabled)
            if runtime_config.get("enable_ap", True):
                ap_ip = runtime_config.get("ap_ip", "").strip()
                ap_data = fetch_ap_status(ap_ip)
                # include apEnabled so frontend can show N/A if disabled
                ap_data["apEnabled"] = True
                ap_payload = json.dumps(ap_data)
                yield f"event: apstatus\ndata: {ap_payload}\n\n"
            else:
                # tell frontend AP is disabled
                ap_payload = json.dumps({"apEnabled": False})
                yield f"event: apstatus\ndata: {ap_payload}\n\n"

            time.sleep(1)

    resp = Response(stream_with_context(event_stream()), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    return resp

@app.route('/schedule')
def schedule_page():
    # operator page
    return render_template('match_scheduling.html')

@app.route('/schedule/audience')
def schedule_audience_page():
    # audience display
    return render_template('match_scheduling_audience.html')

@app.route('/schedule/data')
def schedule_data():
    # return current schedule JSON
    return jsonify(match_schedule)

@app.route('/schedule/generate', methods=['POST'])
def schedule_generate():
    global match_schedule
    data = request.get_json(force=True)
    teams = data.get("teams", [])
    matches_per_team = int(data.get("matches_per_team", 2))
    blocks = data.get("blocks", [])

    if len(teams) < 6:
        return jsonify({"status": "error", "message": "Need at least 6 teams"}), 400
    if not blocks:
        return jsonify({"status": "error", "message": "At least 1 time block is required"}), 400

    # convert minutes -> seconds for generator
    norm_blocks = []
    for b in blocks:
        gap_minutes = int(b.get("gap_minutes", 6))  # default 6 min
        norm_blocks.append({
            "start": b.get("start"),
            "end": b.get("end"),
            "gap_seconds": gap_minutes * 60
        })

    try:
        matches = generate_schedule(teams, matches_per_team, norm_blocks)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

    match_schedule = {
        "matches": matches,
        "meta": {
            "teams": teams,
            "matches_per_team": matches_per_team,
            "blocks": blocks  # store original (with minutes)
        }
    }
    save_match_schedule(match_schedule)
    log("Match schedule generated.")
    return jsonify({"status": "ok", "schedule": match_schedule})


@app.route('/schedule/clear', methods=['POST'])
def schedule_clear():
    global match_schedule
    match_schedule = {"matches": [], "meta": {}}
    save_match_schedule(match_schedule)
    log("Match schedule cleared.")
    return jsonify({"status": "ok"})

def generate_schedule(teams, matches_per_team, blocks):
    total_slots = len(teams) * matches_per_team
    total_matches_needed = (total_slots + 5) // 6

    # turn blocks into actual datetime ranges for today
    today = datetime.date.today()
    all_match_times = []
    for block in blocks:
        block_start_str = block.get("start")
        block_end_str = block.get("end")
        gap = int(block.get("gap_seconds", 300))
        # parse times
        bs_hour, bs_min = map(int, block_start_str.split(":"))
        be_hour, be_min = map(int, block_end_str.split(":"))
        start_dt = datetime.datetime(today.year, today.month, today.day, bs_hour, bs_min)
        end_dt = datetime.datetime(today.year, today.month, today.day, be_hour, be_min)
        # fill times
        current = start_dt
        while current <= end_dt and len(all_match_times) < total_matches_needed:
            all_match_times.append(current)
            current = current + datetime.timedelta(seconds=gap)

    if len(all_match_times) < total_matches_needed:
        raise Exception("Not enough time slots in your blocks to schedule all matches.")

    # now build matches
    import random
    team_counts = {t: 0 for t in teams}
    matches = []

    for idx, start_dt in enumerate(all_match_times, start=1):
        # pick 6 teams that have the lowest play count so far
        # this keeps it fairly even
        sorted_by_need = sorted(teams, key=lambda t: team_counts[t])
        # shuffle within small window to randomize
        random.shuffle(sorted_by_need)
        chosen = sorted(sorted_by_need, key=lambda t: team_counts[t])[:6]

        # split into red/blue
        red = chosen[:3]
        blue = chosen[3:]

        # increment counts
        for t in chosen:
            team_counts[t] += 1

        matches.append({
            "match_id": idx,
            "start_time": start_dt.isoformat(),
            "red": red,
            "blue": blue
        })

        total_slots_remaining = sum(max(0, matches_per_team - team_counts[t]) for t in teams)
        if total_slots_remaining <= 0:
            break

    return matches

@app.route('/schedule/print')
def schedule_print():
    data = load_match_schedule()
    return render_template('match_scheduling_print.html', schedule=data)

@app.route('/schedule/mark_done', methods=['POST'])
def schedule_mark_done():
    global match_schedule
    data = request.get_json(force=True)
    match_id = data.get("match_id")
    done = bool(data.get("done", True))

    if not match_id:
        return jsonify({"status": "error", "message": "match_id required"}), 400

    updated = False
    for m in match_schedule.get("matches", []):
        if m.get("match_id") == match_id:
            m["done"] = done
            updated = True
            break

    if updated:
        save_match_schedule(match_schedule)
        return jsonify({"status": "ok"})
    else:
        return jsonify({"status": "error", "message": "match not found"}), 404

    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
