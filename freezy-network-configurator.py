import csv
import json
import telnetlib
import tkinter as tk
from tkinter import filedialog, messagebox
import requests

# Configuration
AP_IP = "10.0.100.2"
SWITCH_IP = "10.0.100.3"
SWITCH_PASSWORD = "1234Five"

STATION_KEYS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]
VLAN_MAP = {"red1": 10, "red2": 20, "red3": 30, "blue1": 40, "blue2": 50, "blue3": 60}
GATEWAY_SUFFIX = 4

team_config = {}

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

    ap_payload = {
        "channel": 6,
        "stationConfigurations": stations
    }

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
            headers={
                "Content-Type": "application/json"
            },
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

# --- GUI Setup ---
root = tk.Tk()
root.title("FRC Network Configurator")

frame = tk.Frame(root)
frame.pack(padx=10, pady=10)

tk.Button(frame, text="Import WPA Key CSV", command=import_csv).grid(row=0, column=0, columnspan=2, pady=5)

selected_teams = {}
for i, station in enumerate(STATION_KEYS):
    tk.Label(frame, text=station.upper()).grid(row=i + 1, column=0, sticky="e")
    var = tk.StringVar()
    entry = tk.Entry(frame, textvariable=var, width=10)
    entry.grid(row=i + 1, column=1, sticky="w")
    selected_teams[station] = var

tk.Button(frame, text="Push Configuration", command=push_configuration)\
    .grid(row=len(STATION_KEYS) + 1, column=0, columnspan=2, pady=5)

tk.Button(frame, text="Clear Switch Configuration", command=clear_switch_config)\
    .grid(row=len(STATION_KEYS) + 2, column=0, columnspan=2, pady=5)

tk.Label(frame, text="Log Output:").grid(row=len(STATION_KEYS) + 3, column=0, columnspan=2, pady=(10, 0))

log_output = tk.Text(frame, height=12, width=70, state="disabled", bg="#f0f0f0")
log_output.grid(row=len(STATION_KEYS) + 4, column=0, columnspan=2)

root.mainloop()
