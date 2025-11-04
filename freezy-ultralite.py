import csv
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
from flask import Flask, make_response, render_template, request, jsonify, redirect, url_for

app = Flask(__name__)

CONFIG_FILE = "config.json"

default_config = {
    "ap_ip": "10.0.100.2",
    "switch_ip": "10.0.100.3",
    "switch_password": "1234Five",
    "enable_ap": True,
    "enable_switch": True,
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

runtime_config = load_config()

STATION_KEYS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]
VLAN_MAP = {"red1": 10, "red2": 20, "red3": 30, "blue1": 40, "blue2": 50, "blue3": 60}
GATEWAY_SUFFIX = 4

WPA_FILE = "wpa_keys.json"

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

# flask routes
@app.route('/')
def index():
    return render_template('index.html', stations=STATION_KEYS)

@app.route('/config', methods=['GET'])
def config_page():
    # render the config form with current values
    return render_template('config.html', cfg=runtime_config)

@app.route('/config', methods=['POST'])
def save_config_route():
    global runtime_config
    # get values from form
    ap_ip = request.form.get('ap_ip', '').strip()
    switch_ip = request.form.get('switch_ip', '').strip()
    switch_password = request.form.get('switch_password', '').strip()
    enable_ap = request.form.get('enable_ap') == 'on'
    enable_switch = request.form.get('enable_switch') == 'on'

    # update in-memory
    runtime_config['ap_ip'] = ap_ip or runtime_config['ap_ip']
    runtime_config['switch_ip'] = switch_ip or runtime_config['switch_ip']
    # allow empty password? usually yes, so just assign
    runtime_config['switch_password'] = switch_password
    runtime_config['enable_ap'] = enable_ap
    runtime_config['enable_switch'] = enable_switch

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
    data = request.get_json()
    for station in STATION_KEYS:
        audience_display_teams[station] = data.get(station, "").strip()
    log("Audience display updated.")
    return jsonify({"status": "success"})

@app.route('/teams')
def get_teams():
    return jsonify(audience_display_teams)

@app.route('/push_config', methods=['POST'])
def push_config():
    global timer_running
    if timer_running:
        return jsonify({"status": "error", "message": "Cannot push config while timer is running!"})

    data = request.get_json()
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
        minutes = int(request.form['minutes'])
        timer_duration = minutes * 60
        timer_start_time = time.time()
        timer_running = True
        buzzer_triggered = False
        log(f"{minutes} minute timer started.")
        return jsonify({"status": "started"})
    except Exception as e:
        log(f"Timer start error: {e}")
        return jsonify({"status": "error", "message": str(e)})

@app.route('/stop_timer', methods=['POST'])
def stop_timer():
    global timer_start_time, timer_running, timer_duration, buzzer_triggered
    timer_running = False
    timer_start_time = None
    buzzer_triggered = False
    timer_duration = 0
    log("Timer stopped.")
    return jsonify({"status": "stopped"})

@app.route('/timer_status')
def timer_status():
    global timer_start_time, timer_running, timer_duration, buzzer_triggered
    if timer_running and timer_start_time:
        elapsed = time.time() - timer_start_time
        remaining = max(0, timer_duration - elapsed)
        trigger_buzzer = False
        if remaining <= 0 and not buzzer_triggered:
            trigger_buzzer = True
            buzzer_triggered = True
        return jsonify({'remaining': remaining, 'running': timer_running, 'buzzer': trigger_buzzer})
    return jsonify({'remaining': timer_duration, 'running': False, 'buzzer': False})

@app.route('/logs')
def get_logs():
    return jsonify(logs)

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
