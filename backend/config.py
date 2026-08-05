"""
AyuLink IoT Monitoring Agent — Configuration
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ── Network ──────────────────────────────────────────────
WIFI_SSID = "WiFi"
WIFI_PASS = "wordpass"
GATEWAY_IP = os.getenv("GATEWAY_IP", "192.168.4.1")
GATEWAY_WS_PORT = 81
GATEWAY_WS_URL = f"ws://{GATEWAY_IP}:{GATEWAY_WS_PORT}"

BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = 8000

# ── Telegram Bot ─────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = int(os.getenv("TELEGRAM_CHAT_ID", "0"))
TELEGRAM_ENABLED   = True  # Set False to disable bot

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ── Thresholds ───────────────────────────────────────────
HR_WARNING_HIGH = 100
HR_WARNING_LOW = 55
HR_CRITICAL_HIGH = 120
HR_CRITICAL_LOW = 40

SPO2_WARNING = 94
SPO2_CRITICAL = 90

TEMP_WARNING_HIGH = 38.0
TEMP_CRITICAL_HIGH = 39.0
TEMP_CRITICAL_LOW = 35.0

# Blood Pressure (mmHg) — JNC8 / AHA Clinical Guidelines
BP_SYS_WARNING = 140      # Stage 1 Hypertension
BP_SYS_CRITICAL = 180     # Hypertensive Crisis
BP_SYS_LOW = 90           # Hypotension
BP_DIA_WARNING = 90       # Stage 1 Hypertension
BP_DIA_CRITICAL = 120     # Hypertensive Crisis
BP_DIA_LOW = 60           # Hypotension

AIR_QUALITY_WARNING = 300   # PPM
AIR_QUALITY_CRITICAL = 500  # PPM

# ── Alert Settings ───────────────────────────────────────
ALERT_COOLDOWN_SECONDS = 5           # Demo: fire alert every 5s (was 30s)
SUSTAINED_READINGS_REQUIRED = 2      # Consecutive abnormal readings before alert
PATIENT_OFFLINE_TIMEOUT = 30         # Seconds before marking offline

# ── Mock Mode ────────────────────────────────────────────
MOCK_PATIENT_COUNT = 1
MOCK_INTERVAL_SECONDS = 3
MOCK_CRITICAL_PROBABILITY = 0.02     # 2% chance of critical event
SINGLE_PATIENT_MODE = True           # Only 1 wearable in real setup

# ── Patient 108 — REAL PATIENT (Hardware connected) ──────
# This patient has actual ESP32 wristband sending live LoRa data
REAL_PATIENT_108 = {
    "id":         "108",
    "name":       "Ramulu Goud",
    "age":        73,
    "village":    "Hanamkonda",
    "lat":        17.9784,
    "lng":        79.5941,
    "conditions": ["Diabetes", "Hypertension", "Cardiac Risk"],
    "family_contact": "Child (Naresh Goud)",
    "is_real":    True,   # Flag: real hardware, not mock
}

# ── Demo Patients (mock data for demo mode) ───────────────
PRIMARY_PATIENT = {
    "id": "P_01", "name": "Raju Naidu", "age": 72,
    "village": "Maheshwaram", "lat": 17.1066, "lng": 78.4534,
    "conditions": ["Diabetes", "Hypertension"],
    "is_real": True,
}

DEMO_PATIENTS = [
    PRIMARY_PATIENT,
    REAL_PATIENT_108,   # Patient 108 included in all patient lists
]

# ── Pill Dispenser (4 slots, 1 servo by rotation angle) ──
PILL_SLOTS = [
    {"slot": 1, "label": "Morning",   "time": "08:00 AM", "angle": 0},
    {"slot": 2, "label": "Afternoon", "time": "01:00 PM", "angle": 60},
    {"slot": 3, "label": "Evening",   "time": "06:00 PM", "angle": 120},
    {"slot": 4, "label": "Night",     "time": "10:00 PM", "angle": 180},
]
SERVO_HOME_ANGLE = 180  # Servo resting position (closed)

