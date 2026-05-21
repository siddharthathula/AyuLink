# AyuLink System Architecture & Workflows

## 1. System Overview (Visual)

```text
    [ WRISTBAND ]           [ SMART HUB ]          [ ESP32-CAM ]
    (ESP32 + LoRa)         (NodeMCU + WiFi)       (AI-Thinker + WiFi)
          |                      |                       |
      [ LoRa ]             [ WiFi / WS ]           [ MJPEG Stream ]
          |                      |                       |
          v                      v                       v
    [  GATEWAY  ] <────> [ PYTHON BACKEND ] <─────> [ WEB DASHBOARD ]
    (ESP32 + LoRa)       (FastAPI + SQLite)         (Next.js 15)
                                 |
                                 v
                        [ AI AGENT (Groq) ]
                                 |
                                 v
                        [ TELEGRAM BOT ]
```

---

## 2. Component Detailed Workflows

### A. Wristband Wearable (ESP32)
**Role**: Primary data collection for patient vitals and safety.

```text
 [ Pulse Sensor ] ──┐
 [ MPU6050 IMU  ] ──┼──> [ ESP32 ] ──> [ LoRa RA-02 ] ──> ((( RADIO )))
 [ SOS Button   ] ──┤      (Proc)        (433 MHz)
 [ NEO-M6 GPS   ] ──┘
```

1.  **Sensing**: Samples Heart Rate, Motion/Fall, and GPS every loop.
2.  **Processing**:
    *   Calculates BPM using peak detection.
    *   Monitors IMU for "Free-fall + Impact" signature.
3.  **Transmission**: Broadcasts JSON via **LoRa** every 3 seconds.

### B. Gateway Server (ESP32)
**Role**: Bridge between LoRa radio and the WiFi network.

```text
 ((( RADIO ))) ──> [ LoRa RX ] ──> [ ESP32 ] ──> [ WebSocket ] ──> [ Server ]
                                      |
                                      v
                                [ SH1106 OLED ]
```

1.  **Reception**: Listens on 433MHz for LoRa packets.
2.  **Forwarding**: Relays packet to **Python Server** via WebSocket (`/ws/gateway`).
3.  **Display**: Shows live patient status on its bedside OLED.

### C. Smart Pill Dispenser Hub (NodeMCU)
**Role**: Environment safety and medication compliance.

```text
 [ MQ-135 Air ] ──┐
 [ DHT11 Env  ] ──┼──> [ NodeMCU ] <── [ WebSocket ] ── [ Server ]
 [ Flame Sen. ] ──┘      (Proc)             ^
                            |               |
                            v               v
                     [ SG90 Servo ]   [ OLED Display ]
```

1.  **Telemetry**: Pushes environment data to the Dashboard via `/ws/hub`.
2.  **Actuation**: Controls the Servo for pill dispensing and displays mirrored vitals on OLED.

---

## 3. Critical Logic Flows

### Path 1: The "Life-Sync" (Vitals Flow)
How data reaches the doctor and the bedside hub simultaneously.

```text
 WRISTBAND      GATEWAY       SERVER        DASHBOARD
    |              |            |               |
    |──[LoRa]─────>|            |               |
    |              |──[WS]─────>|               |
    |              |            |──[WS]────────>| (Charts Update)
    |              |            |               |
    |              |            |<──[WS]────────| (Hub Sync)
    |              |            |──[WS]────────>| (Update Hub OLED)
```

### Path 2: The "Guardian" (Emergency Flow)
What happens when a Fall or Fire is detected.

```text
  SENSOR         SERVER         AI AGENT        NOTIFY
    |              |               |              |
    |──[Alert]────>|               |              |
    |              |──[Triage]────>|               |
    |              |               |──[Insight]──>|
    |              |<──────────────|              |
    |              |                              |
    |              |──[Broadcast]────────────────>| (Dashboard Red)
    |              |──[Push]─────────────────────>| (Telegram Alert)
    |              |──[Buzz]─────────────────────>| (Hardware Alarm)
```

### Path 3: The "Scheduler" (Medication Flow)
The journey of a pill dispensing command.

```text
 DASHBOARD       SERVER         HUB          HARDWARE
    |              |             |              |
    |──[Dispense]─>|             |              |
    |              |──[Cmd]─────>|              |
    |              |             |──[PWM]──────>| (Servo Move)
    |              |             |              |
    |              |<─[Success]──|              | (Log Event)
    |              |                            |
    |              |──[Confirm]────────────────>| (Telegram Msg)
```

---

## 4. Port & Connection Map
*   **Python Backend**: `http://localhost:8000` (API) & `ws://localhost:8000` (WebSockets)
*   **Next.js Dashboard**: `http://localhost:3000`
*   **ESP32-CAM**: `http://<IP>:81/stream`
*   **Gateway/Hub WS**: Target `WS_HOST` in firmware must match the Laptop IP.
