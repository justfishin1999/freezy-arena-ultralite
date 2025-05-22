# 🛠️ Freezy Arena 'Ultralite'

A super basic **Field Management System (FMS)** designed for **practice** and **offseason** events using the **VH-113 Field Radio**. This tool simplifies VLAN and network setup for FRC-style events **without full FMS control**, giving drivers complete authority over their robots at all times.

---

## 🔧 What It Does

- Configures the **Practice VH-113 Firmware** or **Offseason VH-113 Firmware** flashed field radio.
- Sets up VLANs: `10`, `20`, `30`, `40`, `50`, `60`.
- Supports **Cisco 3500, 3600, 3700, or 9300 series switches** for VLAN and DHCP configuration.

> ❗ This system does **not** control or broadcast packets to driver stations — drivers retain full control.
> 
> ❗ This system does **not** function correctly while using offseason firmware on the VH-113. Must be practice firmware: https://frc-radio.vivid-hosting.net/access-points/fms-ap-firmware-releases (VH-109_AP_PRACTICE_1.2.9-02102025.img.enc)

---

## 🌐 Network Configuration

| Device         | IP Address    | Notes                  |
|----------------|---------------|-------------------------|
| Field Radio/AP | `10.0.100.2`  | No password             |
| Switch         | `10.0.100.3`  | Password: `1234Five`    |
| FMS/Computer   | `10.0.100.5`  | Password: `1234Five`    |

---

## ✨ Features

- 🔑 **Generate WPA keys** and export to `.csv` for use with the offseason radio kiosk.
- 🌐 **Configure Cisco switch** with VLANs and DHCP (like FMS).
- 📡 **Configure Vivid Hosting VH-113 radio** (advanced FMS-style networking).
- 🖥️ **Audience Display**  
  Shows current match time and teams on the field.  
  Add `?reversed=true` or `?reversed=false` to the URL to flip layout.

- 🧱 **Wall Display**  
  Same as Audience Display, but without green chroma background.

---

## ✅ Ideal For

- Offseason events  
- Practice matches  
- Training drive teams and event staff

---

## 🧩 Installation Instructions

1. **Download and install [Python 3.12+](https://www.python.org/downloads/)**
2. **Extract the ZIP archive** to the following location: 'c:\freezy-ultralite'
3. **Open an elevated Command Prompt** (right-click → "Run as Administrator")
4. **Navigate to the project directory**: 'cd c:\freezy-ultralite'
5. **Run the following command**: 'pip install -r requirements.txt'
6. **Start the FMS**: python freezy-ultralite.py
7. **Browse to the admin page**: http://localhost:5000
> ✅ If Python was not added to your system PATH during installation, you may need to use the full path to `python.exe` (e.g., `C:\Python312\python.exe freezy-ultralite.py`)

