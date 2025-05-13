import csv
import json
import telnetlib
import tkinter as tk
from tkinter import filedialog, messagebox
import requests
from flask import Flask, render_template, jsonify, request
import threading
import time
import webbrowser

# Configuration
AP_IP = "10.0.100.2"
SWITCH_IP = "10.0.100.3"
SWITCH_PASSWORD = "1234Five"
FLASK_PORT = 5000

STATION_KEYS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]
VLAN_MAP = {"red1": 10, "red2": 20, "red3": 30, "blue1": 40, "blue2": 50, "blue3": 60}
GATEWAY_SUFFIX = 4

team_config = {}
selected_teams = {}
timer_duration = 0
timer_start_time = None
timer_running = False
buzzer_triggered = False

# Flask app setup
app = Flask(__name__, template_folder='templates', static_folder='static')

@app.route('/')
def index():
    reversed = request.args.get('reversed', 'false').lower() == 'true'
    print(f"reversed: {reversed}, type: {type(reversed)}")  # Debug print
    return render_template('index.html')

@app.route('/audience')
def audience():
    reversed = request.args.get('reversed', 'false').lower() == 'true'
    print(f"reversed: {reversed}, type: {type(reversed)}")  # Debug print
    return render_template('audience.html')

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
            print("Buzzer triggered")  # Debug print
        return jsonify({
            'remaining': remaining,
            'running': timer_running,
            'buzzer': trigger_buzzer
        })
    print("Timer not running or no start time")  # Debug print
    return jsonify({
        'remaining': timer_duration,
        'running': timer_running,
        'buzzer': False
    })

@app.route('/teams')
def get_teams():
    teams = {station: selected_teams[station].get().strip() for station in STATION_KEYS}
    return jsonify(teams)

def run_flask():
    app.run(host='0.0.0.0', port=FLASK_PORT, debug=False, use_reloader=False)

def log(msg):
    log_output.config(state="normal")
    log_output.insert("end", f"{msg}\n")
    log_output.see("end")
    log_output.config(state="disabled")

def import_csv():
    filepath = filedialog.askopenfilename(filetypes=[("CSV Files", "*.csv")])
    try:
        with open(filepath, newline='') as file:
            reader = csv.reader(file)
            for row in reader:
                if len(row) == 2:
                    team, key = row[0].strip(), row[1].strip()
                    if team.isdigit():
                        team_config[team] = key
        log("CSV imported successfully. Type team numbers into the fields.")
    except Exception as e:
        messagebox.showerror("CSV Error", str(e))
        log(f"Error importing CSV: {e}")

def push_configuration():
    stations = {}
    switch_entries = {}
    missing_stations = []

    for station in STATION_KEYS:
        team = selected_teams[station].get().strip()
        if not team:
            missing_stations.append(station)
            continue
        if team not in team_config:
            messagebox.showerror("Missing WPA key", f"Team {team} (for {station}) is not in the imported CSV.")
            log(f"ERROR: Team {team} for {station} is missing from CSV.")
            return
        stations[station] = {
            "ssid": team,
            "wpaKey": team_config[team]
        }
        switch_entries[station] = int(team)

    if not stations:
        messagebox.showerror("No stations set", "You must enter at least one team number.")
        log("ERROR: No valid team entries provided.")
        return

    if missing_stations:
        log(f"INFO: These stations will be skipped due to missing team numbers: {', '.join(missing_stations)}")

    try:
        push_ap_configuration(stations)
    except Exception as e:
        messagebox.showerror("AP Error", str(e))
        log(f"AP Error: {e}")
        return

    try:
        configure_switch(switch_entries)
    except Exception as e:
        messagebox.showerror("Switch Error", str(e))
        log(f"Switch Error: {e}")
        return

    messagebox.showinfo("Success", "Configuration applied successfully.")
    log("Switch and AP configured successfully.")

def push_ap_configuration(stations):
    payload = {
        "channel": 13,
        "stationConfigurations": stations
    }
    try:
        response = requests.post(
            f"http://{AP_IP}/configuration",
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=3
        )
        if response.status_code // 100 != 2:
            raise Exception(f"Access point returned status {response.status_code}: {response.text}")
        log("Access point accepted the new configuration.")
    except requests.ConnectionError as e:
        log("ERROR: Access point is refusing connection. You may need to install the API server manually.")
        raise e
    except Exception as e:
        raise e

def configure_switch(teams):
    tn = telnetlib.Telnet(SWITCH_IP, 23, timeout=5)
    tn.read_until(b"Password: ")
    tn.write(SWITCH_PASSWORD.encode("ascii") + b"\n")
    tn.write(b"enable\n" + SWITCH_PASSWORD.encode("ascii") + b"\n")
    tn.write(b"terminal length 0\n")
    tn.write(b"configure terminal\n")

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

    tn.write(b"end\ncopy running-config startup-config\n\n")
    tn.write(b"exit\n")
    output = tn.read_all().decode()
    log(f"Switch Configuration Output:\n{output}")

def clear_switch_config():
    try:
        tn = telnetlib.Telnet(SWITCH_IP, 23, timeout=5)
        tn.read_until(b"Password: ")
        tn.write(SWITCH_PASSWORD.encode("ascii") + b"\n")
        tn.write(b"enable\n" + SWITCH_PASSWORD.encode("ascii") + b"\n")
        tn.write(b"terminal length 0\n")
        tn.write(b"configure terminal\n")

        for vlan in VLAN_MAP.values():
            tn.write(f"""
interface Vlan{vlan}
 no ip address
exit
no access-list 1{vlan}
no ip dhcp pool dhcp{vlan}
""".encode())

        tn.write(b"end\ncopy running-config startup-config\n\n")
        tn.write(b"exit\n")
        output = tn.read_all().decode()
        log(f"Switch Clear Output:\n{output}")
        messagebox.showinfo("Success", "Switch configuration cleared.")
    except Exception as e:
        messagebox.showerror("Switch Error", str(e))
        log(f"Switch Clear Error: {e}")

def start_timer():
    global timer_duration, timer_start_time, timer_running, buzzer_triggered
    try:
        duration = int(timer_entry.get().strip()) * 60  # Convert minutes to seconds
        if duration <= 0:
            messagebox.showerror("Invalid Timer", "Please enter a positive number of minutes.")
            return
        timer_duration = duration
        timer_start_time = time.time()
        timer_running = True
        buzzer_triggered = False
        update_timer_display()
        log("Timer started.")
    except ValueError:
        messagebox.showerror("Invalid Timer", "Please enter a valid number of minutes.")
        log("Error: Invalid timer duration entered.")

def update_connect_to_web():
    webbrowser.open(f"http://localhost:{FLASK_PORT}")

def update_timer_display():
    global timer_running, timer_start_time, timer_duration
    if timer_running:
        elapsed = time.time() - timer_start_time
        remaining = max(0, timer_duration - elapsed)
        minutes, seconds = divmod(int(remaining), 60)
        timer_label.config(text=f"Timer: {minutes:02d}:{seconds:02d}")
        if remaining > 0:
            root.after(1000, update_timer_display)
        else:
            timer_running = False
            timer_label.config(text="Timer: 00:00")
            log("Timer ended.")

# --- GUI Setup ---
root = tk.Tk()
root.title("FRC Network Configurator")

frame = tk.Frame(root)
frame.pack(padx=10, pady=10)

tk.Button(frame, text="Import WPA Key CSV", command=import_csv).grid(row=0, column=0, columnspan=2, pady=5)

for i, station in enumerate(STATION_KEYS):
    tk.Label(frame, text=station.upper()).grid(row=i + 1, column=0, sticky="e")
    var = tk.StringVar()
    entry = tk.Entry(frame, textvariable=var, width=10)
    entry.grid(row=i + 1, column=1, sticky="w")
    selected_teams[station] = var

# Timer GUI elements
tk.Label(frame, text="Timer (minutes):").grid(row=len(STATION_KEYS) + 1, column=0, sticky="e")
timer_entry = tk.Entry(frame, width=10)
timer_entry.grid(row=len(STATION_KEYS) + 1, column=1, sticky="w")
tk.Button(frame, text="Start Timer", command=start_timer).grid(row=len(STATION_KEYS) + 2, column=0, columnspan=2, pady=5)
timer_label = tk.Label(frame, text="Timer: 00:00")
timer_label.grid(row=len(STATION_KEYS) + 3, column=0, columnspan=2)
tk.Button(frame, text="Connect to Web", command=update_connect_to_web).grid(row=len(STATION_KEYS) + 4, column=0, columnspan=2, pady=5)

tk.Button(frame, text="Push Configuration", command=push_configuration)\
    .grid(row=len(STATION_KEYS) + 5, column=0, columnspan=2, pady=5)

tk.Button(frame, text="Clear Switch Configuration", command=clear_switch_config)\
    .grid(row=len(STATION_KEYS) + 6, column=0, columnspan=2, pady=5)

tk.Label(frame, text="Log Output:").grid(row=len(STATION_KEYS) + 7, column=0, columnspan=2, pady=(10, 0))

log_output = tk.Text(frame, height=12, width=70, state="disabled", bg="#f0f0f0")
log_output.grid(row=len(STATION_KEYS) + 8, column=0, columnspan=2)

# Start Flask in a separate thread
flask_thread = threading.Thread(target=run_flask, daemon=True)
flask_thread.start()

root.mainloop()
