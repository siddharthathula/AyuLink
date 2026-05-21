<![CDATA[<div align="center">

# 🏥 AyuLink — Smart Health. Zero Boundaries.

### AI-Powered Remote Patient Monitoring for Rural India

[![Next.js](https://img.shields.io/badge/Next.js_16-black?logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![ESP32](https://img.shields.io/badge/ESP32_IoT-E7352C?logo=espressif)](https://www.espressif.com)
[![LoRa](https://img.shields.io/badge/LoRa_433MHz-7B68EE)](https://lora-alliance.org)
[![Groq AI](https://img.shields.io/badge/Groq_LLaMA_3.1-FF6B35)](https://groq.com)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase)](https://supabase.com)
[![Telegram](https://img.shields.io/badge/Telegram_Bot-26A5E4?logo=telegram)](https://telegram.org)

> **"Every 4 minutes, someone in India dies from a medical emergency that was survivable — if only someone knew it happened in time."**

**Not an app. Infrastructure.**

[Live Demo](https://ayulink.vercel.app) · [Architecture](#-system-architecture) · [Hardware](#-hardware-layer) · [Demo Videos](#-demo-videos)

</div>

---

## 💀 The Problem

Healthcare monitoring today demands three things most people don't have: **a smartphone, reliable internet, and someone physically present.**

That's not a rural problem. That's a human problem.

The elderly woman in Maheshwaram with no smartphone. The diabetic factory worker on a 12-hour shift. The cardiac patient in a Hyderabad apartment whose family is in another city. The bedridden patient in a tier-2 town with no ASHA worker visiting today. **None of them are being monitored. All of them are at risk.**

### By the Numbers

| Reality | Number |
|---------|--------|
| Avg emergency response: rural vs urban | **47 min vs 8 min** — the gap kills |
| Indians above 40 with zero continuous monitoring | **600M+** |
| Medication adherence without reminders | **61%** → preventable hospitalizations |
| People served per PHC | **30,000+** — real-time monitoring is physically impossible |
| Indians without reliable internet | **65%** — telemedicine doesn't reach them |

### Critical Windows That Current Systems Miss

| Emergency | Window Before Irreversible Damage |
|-----------|----------------------------------|
| 🫨 Fall → permanent injury | **15 minutes** |
| ❤️ Cardiac event → brain damage | **8 minutes** |
| 💊 Medication missed → hospitalization | **Days of silent drift** |

**Core Problem:** Existing health monitoring solutions are built for people who are already privileged — smartphone owners, urban residents, English speakers, the connected. Everyone else is **invisible** to the healthcare system until the emergency is already catastrophic.

---

## 💡 AyuLink's Answer

**Infrastructure-level health monitoring that works with zero internet, zero smartphone, zero technical literacy.**

> **LoRa 433MHz · 5km range · <3 second emergency-to-alert · ₹18/patient/month**

| Layer | What It Does |
|-------|-------------|
| ⌚ **Wristband** | ESP32 + pulse oximeter + fall/tremor detection + SOS button + LoRa radio |
| 📡 **Gateway** | LoRa-to-WiFi bridge with OLED display, air quality & flame sensors |
| 💊 **Smart Dispenser** | Servo-controlled 4-slot pill box with scheduling & compliance tracking |
| 📹 **Room Camera** | ESP32-CAM with live MJPEG streaming to dashboard |
| 🖥️ **Dashboard** | Real-time vitals, emergency alerts, patient management, analytics |
| 🤖 **AI Agent** | Groq LLaMA 3.1 — medical triage, risk scoring, clinical insights |
| 📱 **Family Portal** | Live camera, vitals, medication tracking for remote families |
| 🤝 **ASHA Portal** | Field worker visit tracking and verification |
| 📲 **Telegram Bot** | Instant alerts with **Telugu voice** notifications |

---

## 🖥️ Dashboard

<div align="center">

### Main Command Center — Real-Time Health Monitoring
![Dashboard](screenshots/dashboard_main.png)

*Live vitals from hardware • Hardware network status • Smart pill dispenser • Air quality • ESP32-CAM feed*

</div>

<details>
<summary><b>📸 All Dashboard Screenshots (click to expand)</b></summary>

### Live Vitals & Camera Feed
![Vitals](screenshots/dashboard_vitals_camera.png)

### Critical Alerts & Emergency Response  
![Alerts](screenshots/dashboard_vitals_alerts.png)

### Patient Registry — 48 Patients with ABHA ID
![Patients](screenshots/patients_registry.png)

### Emergency Response Map — GPS + Ambulance Dispatch
![Emergency](screenshots/emergency_response_map.png)

### Smart Medicine Dispensers — IoT Pill Box Control
![Dispensers](screenshots/medicine_dispensers.png)

### Family Portal — Live Camera, Vitals, Medications
![Family](screenshots/family_portal.png)

### ASHA Worker Verification Portal
![ASHA](screenshots/asha_verification.png)

### Telegram Bot — Telugu Voice Alerts
![Telegram](screenshots/telegram_bot.png)

### Patient Medical Records
![Records](screenshots/patient_records.png)

</details>

---

## 🔧 Hardware Layer

**5 custom-built ESP32 nodes** communicating over **LoRa 433MHz mesh network**:

### 🏗️ Full System — All Nodes Running Live
![Full Setup](photos/full_hardware_setup.jpg)

*Gateway + ESP32-CAM + Smart Hub + Wristband — all connected, all transmitting*

---

<table>
<tr>
<td width="50%">

### ⌚ Wristband — Patient Wearable
![Wristband](photos/wristband_oled_mpu6050.jpg)

- ESP32-S3 + SSD1306 OLED
- MAX30102 pulse oximeter (HR + SpO2)
- MPU6050 accelerometer (fall + FIDS tremor)
- LoRa SX1278 433MHz radio
- SOS panic button
- Velcro strap mount

</td>
<td width="50%">

### 📡 Gateway — LoRa Bridge
![Gateway](photos/gateway_lora_oled.jpg)

- ESP32 NodeMCU
- LoRa SX1278 433MHz receiver
- SSD1306 OLED (location + alerts)
- WebSocket bridge to backend
- MQ-135 + DHT11 + Flame + RTC + Servo

</td>
</tr>
</table>

---

## 🚨 Emergency Detection Pipeline

<table>
<tr>
<td width="50%">

### 🫨 FIDS (Tremor) Detected
![FIDS](photos/fids_detection_alert.jpg)

MPU6050 sustained tremor → LoRa → Gateway OLED **"!! FIDS !!"** → Dashboard fullscreen → Telegram → 108 Ambulance

</td>
<td width="50%">

### 🆘 Fall Detected
![Fall](photos/fall_detection_alert.jpg)

MPU6050 freefall + impact → LoRa → Gateway **"!! FALL !!"** → Dashboard alert + vitals → Auto-dispatch

</td>
</tr>
</table>

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AyuLink Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ⌚ Wristband ──LoRa 433MHz──▶ 📡 Gateway ──WebSocket──┐       │
│  (MAX30102+MPU6050+SOS)        (LoRa+OLED+Sensors)       │       │
│                                                           │       │
│  📹 ESP32-CAM ──────MJPEG Stream──────────────────────┐  │       │
│                                                        │  │       │
│  💊 Smart Hub ──────Serial─────────────────────────┐  │  │       │
│  (MQ135+DHT11+Flame+RTC+Servo)                     │  │  │       │
│                                                     ▼  ▼  ▼       │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │           FastAPI Backend (Python)                        │     │
│  │  Threshold Engine │ AI Agent (Groq) │ Telegram Bot       │     │
│  │  Camera Proxy     │ SQLite DB       │ REST + WebSocket   │     │
│  └─────────────────────────────────────────────────────────┘     │
│                              │                                     │
│              ┌───────────────┼───────────────┐                    │
│              ▼               ▼               ▼                    │
│     🖥️ Dashboard      📱 Family        🤝 ASHA                 │
│     (Next.js 16)       Portal           Portal                    │
│              │                                                     │
│              ▼                                                     │
│     📲 Telegram Bot (Telugu voice alerts to families)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI Agent — Groq LLaMA 3.1

| Feature | Description |
|---------|-------------|
| **Triage** | Classifies vitals → Normal / Warning / Critical with clinical reasoning |
| **Risk Score** | 0-100 ML risk score from HR, SpO2, temp, BP, history |
| **Chat** | Doctor asks "What's wrong with Ramulu?" → clinical insights |
| **Telugu Alerts** | Voice messages in Telugu for family members |
| **Trend Detection** | Catches deteriorating patterns before they become emergencies |

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 16, React 19, TailwindCSS, Recharts, Leaflet |
| Backend | FastAPI, SQLite, WebSocket, HTTPX |
| AI/ML | Groq Cloud (LLaMA 3.1 8B), Custom risk scoring |
| Hardware | ESP32-S3, ESP32-CAM, NodeMCU, Arduino/PlatformIO |
| Communication | LoRa SX1278 433MHz, WiFi, WebSocket |
| Sensors | MAX30102, MPU6050, MQ-135, DHT11, DS3231, Flame |
| Realtime | Supabase Realtime |
| Notifications | Telegram Bot API (text + Telugu TTS) |
| Deployment | Vercel (frontend) + Local (backend + hardware) |

---

## 🌍 Innovation & Impact

| Metric | Value |
|--------|-------|
| **Emergency Alert Latency** | < 3 seconds (wristband → dashboard → telegram) |
| **LoRa Coverage** | 2-5km radius — covers entire village from 1 gateway |
| **Hardware Cost** | ₹2,500/wristband (~$30) vs ₹50,000+ commercial |
| **Operating Cost** | ₹18/patient/month |
| **Concurrent Patients** | 50+ per PHC gateway |
| **Accessibility** | Telugu voice, works on 2G via Telegram, zero literacy required |
| **Internet Dependency** | ZERO for wristband ↔ gateway (LoRa) |

---

## 🔮 Future Scope & Scalability

- **Multi-village mesh**: Chain LoRa gateways for district-wide coverage
- **Edge AI**: Run triage models directly on ESP32-S3 (TFLite)
- **ABHA Integration**: Connect to India's digital health ecosystem  
- **Predictive Analytics**: 24-hour risk forecasting from historical trends
- **Solar-powered nodes**: Off-grid deployment for remote tribal areas
- **Wearable v2**: Custom PCB, IP67 waterproof, 7-day battery
- **District Dashboard**: Government PHC network management at scale

---

## 📁 Project Structure

```
AyuLink/
├── frontend/              # Next.js 16 Dashboard
│   ├── app/               # Pages: dashboard, family, patients, emergency
│   ├── components/        # 38+ React components
│   └── lib/               # Demo mode, Supabase client, data generators
├── backend/               # FastAPI Python Backend  
│   ├── main.py            # API server + WebSocket + camera proxy
│   ├── ai_agent.py        # Groq LLaMA 3.1 medical AI
│   ├── threshold_engine.py# Clinical threshold alerting
│   └── config.py          # System configuration
├── firmware/              # ESP32 C++ Firmware (PlatformIO)
│   ├── Wearable/          # Wristband (MAX30102 + MPU6050 + LoRa)
│   ├── Gateway/           # LoRa-WiFi bridge + OLED + sensors
│   ├── ESP32_CAM/         # Camera streaming
│   ├── Smart_Hub/         # Environmental sensors + RTC
│   └── Smart_Dispenser/   # Servo pill dispenser
├── photos/                # Hardware photos
├── screenshots/           # Dashboard screenshots  
└── demo-videos/           # Demo recordings (no audio)
```

---

## 🚀 Quick Start

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend  
cd backend && pip install -r requirements.txt
GROQ_API_KEY=your_key python main.py

# Access
# Dashboard: http://localhost:3000/dashboard
# Family:    http://localhost:3000/family
# API:       http://localhost:8000/api/status
```

> **Demo Mode**: No hardware? Dashboard auto-enables simulation with 45 realistic patients.

---

## 👥 Team FightClub

| Role | Member |
|------|--------|
| **System Architecture, Hardware Design & Programming** | **Siddhartha** |
| **UI/UX, AI Integration & Dashboard** | **Anirudh** |

---

<div align="center">

**Built with ❤️ for rural India at ScanSkip HackOS-ONE 2026**

*770 million people. 47 minutes. 4 minutes left. AyuLink.*

</div>
]]>
