# AyuLink — When Every Second Counts

> *"Every 4 minutes, someone in India dies from a medical emergency that was survivable — if only someone knew it happened in time."*

**Team FightClub** | ScanSkip HackOS-ONE 2026

---

## What is AyuLink?

AyuLink is a complete health monitoring system we built from scratch — hardware, firmware, backend, AI, and dashboard — to solve one problem: **people die in rural India because no one is watching.**

Not because the technology doesn't exist. Because existing tech needs a smartphone, stable internet, and someone physically present. Most of rural India has none of these.

So we built something that doesn't need any of them.

**A wristband that monitors vitals. A LoRa radio that works without WiFi. An AI that triages emergencies. A dashboard that gives doctors superpowers. A Telegram bot that calls families in Telugu.**

All for ₹18/patient/month.

---

## The Reality We're Solving

- **47 minutes** — average emergency response time in rural India (vs 8 min urban)
- **600M+ Indians** above 40 have zero continuous health monitoring
- **61% medication adherence** without automated reminders → preventable hospitalizations
- **1 PHC serves 30,000+ people** — real-time monitoring is physically impossible
- **65% of India** doesn't have reliable internet — telemedicine can't reach them

### The windows that kill:
- Fall → permanent injury: **15 minutes**
- Cardiac event → brain damage: **8 minutes**
- Medication missed → hospitalization: **days of silent drift**

Current solutions are built for the privileged — smartphone owners, urban residents, English speakers. Everyone else is invisible to the healthcare system until it's too late.

---

## How It Works

We built 5 custom ESP32 nodes that talk to each other over LoRa radio (no internet needed), feed data to a Python backend, and display everything on a Next.js dashboard. An AI agent running on Groq triages every patient in real-time.

```
Wristband (on patient's wrist)
    │
    │ LoRa 433MHz — works 5km, no WiFi needed
    ▼
Gateway (at the PHC)
    │
    │ WebSocket
    ▼
Backend (FastAPI + AI Agent)
    │
    ├──→ Dashboard (doctors see everything)
    ├──→ Family Portal (families check from anywhere)
    ├──→ Telegram Bot (Telugu voice alerts)
    └──→ ASHA Portal (field worker tracking)
```

---

## The Hardware We Built

We soldered, wired, and programmed every single node by hand.

### Full System Running Live

![All hardware nodes running together with the dashboard](photos/full_hardware_setup.jpg)

*Everything you see here — we built it. Gateway receiving LoRa packets, ESP32-CAM streaming, Smart Hub monitoring air quality, Wristband tracking vitals. All talking to the dashboard in real-time.*

---

### Wristband — What the Patient Wears

![Wristband with OLED display and sensors](photos/wristband_oled_mpu6050.jpg)

- **ESP32-S3** microcontroller
- **MAX30102** pulse oximeter — heart rate + blood oxygen (SpO2)
- **MPU6050** accelerometer — detects falls and tremors (FIDS)
- **SSD1306 OLED** — shows patient status and alerts
- **LoRa SX1278** 433MHz radio — sends data without internet
- **SOS button** — panic button for emergencies
- Mounted on a velcro strap

### Gateway — The Bridge

![Gateway with LoRa module and OLED](photos/gateway_lora_oled.jpg)

- Receives all wristband data via LoRa
- OLED shows which patient, what location, what's happening
- Forwards everything to the backend via WebSocket
- Also has: MQ-135 air quality, DHT11 temp/humidity, flame sensor, RTC clock, servo for pill dispensing

### ESP32-CAM — Room Camera

![ESP32-CAM module](photos/esp32_cam_module.jpg)

- OV2640 camera, VGA resolution
- Live MJPEG streaming to dashboard and family portal
- WiFi direct connection

---

## Emergency Detection — This Is Where It Gets Real

The wristband's MPU6050 accelerometer constantly monitors for two things: **falls** and **tremors (FIDS)**. When either is detected, the entire pipeline fires in under 3 seconds.

### FIDS (Tremor) Detection

![FIDS detected — dashboard fullscreen alert with Gateway OLED showing the same alert](photos/fids_detection_alert.jpg)

What happens: MPU6050 detects sustained tremor → LoRa alert fires → Gateway OLED shows "!! FIDS !!" → Dashboard goes fullscreen red → Telegram sends voice alert in Telugu → "Call 108 Ambulance" button appears

### Fall Detection

![Fall detected — dashboard alert with vitals and Gateway showing FALL warning](photos/fall_detection_alert.jpg)

Same pipeline, different trigger. The accelerometer detects the freefall signature followed by impact. Three seconds later, every screen in the system is screaming.

---

## The Dashboard

Built with Next.js 16 and React 19. Every page is functional.

### Main Command Center
![Main dashboard with live vitals, hardware status, camera feed](screenshots/dashboard_main.png)

Live vitals streaming from the wristband. Hardware network status. Smart pill dispenser controls. Air quality readings. ESP32-CAM feed. All real-time.

### Live Vitals + Camera
![Vitals monitoring with camera feed](screenshots/dashboard_vitals_camera.png)

### Emergency Alerts
![Critical alerts panel](screenshots/dashboard_vitals_alerts.png)

### Patient Registry — 48 Patients
![Patient list with ABHA IDs](screenshots/patients_registry.png)

### Emergency Response Map
![GPS-based emergency map with ambulance dispatch](screenshots/emergency_response_map.png)

### Smart Medicine Dispensers
![IoT pill box control panel](screenshots/medicine_dispensers.png)

### Family Portal
![Family members can check vitals and camera remotely](screenshots/family_portal.png)

### Telegram Bot — Telugu Voice Alerts
![Telegram notifications with voice messages](screenshots/telegram_bot.png)

### ASHA Worker Verification
![Field worker visit tracking](screenshots/asha_verification.png)

### Patient Medical Records
![Detailed patient records](screenshots/patient_records.png)

---

## AI Agent — Groq LLaMA 3.1

Not a chatbot. A full medical intelligence system. Three modes:

### 1. AI Chat — Clinical Triage
- **Triage Classification** — every vital reading gets classified: Normal, Warning, or Critical, with clinical reasoning
- **Risk Scoring** — 0-100 score from heart rate, SpO2, temperature, BP, and patient history
- **Natural Language** — doctors ask "What's happening with Ramulu?" and get real clinical analysis
- **Trend Detection** — catches deteriorating patterns before they become emergencies

### 2. Medical Knowledge Search — Drug & Disease Lookup

![AI Agent medical search — searching Dolo 650 with full drug information](screenshots/ai_agent.png)

Search any medicine, disease, or symptom and get instant AI-powered results:
- **Drug Information** — generic name, drug class, brand names available in India
- **Dosage Guides** — separate dosing for Adults, Elderly, and Children
- **Side Effects** — common adverse reactions and contraindications
- **Medical Uses** — what conditions the medicine treats
- **Storage** — proper storage instructions

Works for medicines (Dolo 650, Metformin, Amlodipine), diseases (Diabetes, Hypertension, Dengue), and symptoms (Chest pain, Fever). The search is designed for PHC doctors who need quick drug references without internet.

### 3. Triage Insights — Automated Analysis
- Real-time analysis of all patient vitals
- Priority ranking of who needs attention first
- Telugu voice alerts via Telegram so families understand what's happening

---

## Tech Stack

**Frontend:** Next.js 16, React 19, TailwindCSS, Recharts, Leaflet Maps

**Backend:** FastAPI (Python), SQLite, WebSocket, HTTPX

**AI:** Groq Cloud (LLaMA 3.1 8B), custom risk scoring algorithm

**Hardware:** ESP32-S3, ESP32-CAM, NodeMCU, Arduino/PlatformIO

**Communication:** LoRa SX1278 433MHz, WiFi, WebSocket

**Sensors:** MAX30102, MPU6050, MQ-135, DHT11, DS3231 RTC, Flame sensor

**Notifications:** Telegram Bot API (text + Telugu TTS)

**Database:** Supabase (realtime sync for family portal)

---

## What Makes This Different

| | AyuLink | Typical Solutions |
|---|---|---|
| **Internet needed?** | No (LoRa works offline) | Yes (WiFi/4G required) |
| **Smartphone needed?** | No | Yes |
| **Range** | 5km (LoRa mesh) | Bluetooth ~10m |
| **Cost per patient** | ₹18/month | ₹500+/month |
| **Hardware cost** | ₹2,500/wristband (~$30) | ₹50,000+ |
| **Alert latency** | <3 seconds | Minutes |
| **Language** | Telugu voice alerts | English only |
| **AI triage** | Yes (Groq LLaMA 3.1) | No |

---

## Project Structure

```
AyuLink/
├── frontend/           # Next.js 16 Dashboard (38+ components)
│   ├── app/            # All pages: dashboard, family, patients, emergency...
│   ├── components/     # UI components, charts, maps, alerts
│   └── lib/            # Demo mode, Supabase client, data generators
├── backend/            # FastAPI Python Backend
│   ├── main.py         # API server + WebSocket + camera proxy
│   ├── ai_agent.py     # Groq LLaMA 3.1 medical AI agent
│   ├── threshold_engine.py  # Clinical threshold alerting
│   └── config.py       # System configuration
├── firmware/           # All ESP32 firmware (C++, PlatformIO)
│   ├── Wearable/       # Wristband: MAX30102 + MPU6050 + LoRa + OLED
│   ├── Gateway/        # LoRa-WiFi bridge + sensors + OLED
│   ├── ESP32_CAM/      # Camera streaming module
│   ├── Smart_Hub/      # Environmental sensors + RTC
│   └── Smart_Dispenser/# Servo-controlled pill dispenser
├── photos/             # Hardware build photos
├── screenshots/        # Dashboard screenshots
└── demo-videos/        # Demo recordings
```

---

## Running It

```bash
# Start everything
bash go.sh

# Or manually:
cd frontend && npm install && npm run dev    # Dashboard on :3000
cd backend && pip install -r requirements.txt && python main.py  # API on :8000
```

No hardware? The dashboard auto-enables **simulation mode** with 45 realistic patients.

Set your API key: `GROQ_API_KEY=your_key` in backend/.env

---

## Future Scope

- **Multi-village mesh** — chain LoRa gateways for district-wide coverage
- **Edge AI** — run triage models directly on ESP32-S3 (TFLite)
- **ABHA Integration** — connect to India's Ayushman Bharat Digital Health
- **Predictive Analytics** — 24-hour risk forecasting from historical trends
- **Solar-powered nodes** — off-grid deployment for tribal areas
- **Custom PCB v2** — IP67 waterproof wristband, 7-day battery
- **Government PHC Dashboard** — district-level network management

---

## Team FightClub

**Siddhartha** — System Architecture, Hardware Design, Firmware Programming

**Anirudh** — UI/UX Design, AI Integration, Dashboard Development

---

*770 million people. 47 minutes. 4 minutes left.*

*AyuLink. Not an app. Infrastructure.*

*Built at ScanSkip HackOS-ONE 2026*
