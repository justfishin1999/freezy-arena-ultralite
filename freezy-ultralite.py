import csv
import io
import json
import secrets
import string
import telnetlib
import time
import threading
import requests
from flask import Flask, make_response, render_template, request, jsonify

# Configuration
AP_IP = "10.0.100.2"
SWITCH_IP = "10.0.100.3"
SWITCH_PASSWORD = "1234Five"
FLASK_PORT = 5000

STATION_KEYS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]
VLAN_MAP = {"red1": 10, "red2": 20, "red3": 30, "blue1": 40, "blue2": 50, "blue3": 60}
GATEWAY_SUFFIX = 4

team_config = {}
selected_teams = {key: "" for key in STATION_KEYS}
timer_duration = 0
timer_start_time = None
timer_running = False
buzzer_triggered = False
logs = []

audience_display_teams = {key: "" for key in STATION_KEYS}

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html', stations=STATION_KEYS)

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

    response = make_response(output.getvalue())
    response.headers['Content-Disposition'] = 'attachment; filename=wpa_keys.csv'
    response.headers['Content-Type'] = 'text/csv'
    return response

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
    data = request.get_json()
    stations = {}
    switch_entries = {}
    for station in STATION_KEYS:
        team = data.get(station, "").strip()
        selected_teams[station] = team
        if team:
            if team not in team_config:
                return jsonify({"status": "error", "message": f"Missing WPA key for team {team}"})
            stations[station] = {"ssid": team, "wpaKey": team_config[team]}
            switch_entries[station] = int(team)

    try:
        push_ap_configuration(stations)
        configure_switch(switch_entries)
        log("Configuration pushed.")
        return jsonify({"status": "success"})
    except Exception as e:
        log(f"Push config error: {e}")
        return jsonify({"status": "error", "message": str(e)})

@app.route('/clear_switch', methods=['POST'])
def clear_switch():
    try:
        clear_switch_config()
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
        log("Timer started.")
        return jsonify({"status": "started"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

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

def log(msg):
    logs.append(msg)
    print(msg)

def push_ap_configuration(stations):
    payload = {"channel": 13, "stationConfigurations": stations}
    response = requests.post(f"http://{AP_IP}/configuration", headers={"Content-Type": "application/json"}, data=json.dumps(payload), timeout=3)
    if response.status_code // 100 != 2:
        raise Exception(f"Access point returned status {response.status_code}: {response.text}")

def configure_switch(teams):
    tn = telnetlib.Telnet(SWITCH_IP, 23, timeout=5)
    tn.read_until(b"Password: ")
    tn.write(SWITCH_PASSWORD.encode("ascii") + b"\n")
    tn.write(b"enable\n" + SWITCH_PASSWORD.encode("ascii") + b"\n")
    tn.write(b"terminal length 0\nconfigure terminal\n")

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
    tn = telnetlib.Telnet(SWITCH_IP, 23, timeout=5)
    tn.read_until(b"Password: ")
    tn.write(SWITCH_PASSWORD.encode("ascii") + b"\n")
    tn.write(b"enable\n" + SWITCH_PASSWORD.encode("ascii") + b"\n")
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

@app.route('/wpa_key_status')
def wpa_key_status():
    return jsonify({'loaded': len(team_config) > 0})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=FLASK_PORT)
