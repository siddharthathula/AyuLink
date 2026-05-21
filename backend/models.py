"""
AyuLink IoT Monitoring Agent — Data Models
"""
from pydantic import BaseModel
from typing import Optional, List
from enum import Enum
import time


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


class AlertType(str, Enum):
    HR_HIGH = "hr_high"
    HR_LOW = "hr_low"
    SPO2_LOW = "spo2_low"
    TEMP_HIGH = "temp_high"
    TEMP_LOW = "temp_low"
    FALL = "fall"
    FIDS = "fids"
    SOS = "sos"
    DEVICE_OFFLINE = "device_offline"
    DEVICE_NOT_WORN = "not_worn"
    AIR_QUALITY = "air_quality"
    FLAME_DETECTED = "flame_detected"


class VitalReading(BaseModel):
    patient_id: str
    patient_name: Optional[str] = ""
    hr: int = 0
    spo2: int = 0
    temp: float = 0.0
    lat: float = 0.0
    lng: float = 0.0
    sos: bool = False
    fall: bool = False
    tremor: bool = False
    worn: bool = True
    rssi: int = 0
    # Blood pressure (optional — KY-039 wristband doesn't send these)
    bp_systolic: int = 0
    bp_diastolic: int = 0
    # LoRa signal quality injected by gateway
    lora_rssi: int = 0
    lora_snr: float = 0.0
    # GPS
    gps_fix: bool = False
    # Device uptime seconds
    uptime: int = 0
    timestamp: float = 0.0

    def __init__(self, **data):
        if "timestamp" not in data or data["timestamp"] == 0.0:
            data["timestamp"] = time.time()
        super().__init__(**data)


class HubReading(BaseModel):
    device_id: str = "HUB-01"
    air_ppm: int = 0
    air_aqi: str = "Good"
    flame: bool = False
    pill_slot1: bool = False
    pill_slot2: bool = False
    pill_slot3: bool = False
    pill_slot4: bool = False
    # DHT11 environmental sensors
    env_temp: float = 0.0
    humidity: float = 0.0
    # DS3231 RTC
    rtc_time: str = ""
    rtc_date: str = ""
    rssi: int = 0
    uptime: int = 0
    timestamp: float = 0.0

    def __init__(self, **data):
        if "timestamp" not in data or data["timestamp"] == 0.0:
            data["timestamp"] = time.time()
        super().__init__(**data)


class Alert(BaseModel):
    id: str
    patient_id: str
    patient_name: str
    alert_type: AlertType
    severity: Severity
    message: str
    value: Optional[str] = None
    timestamp: float = 0.0
    acknowledged: bool = False

    def __init__(self, **data):
        if "timestamp" not in data or data["timestamp"] == 0.0:
            data["timestamp"] = time.time()
        super().__init__(**data)


class PatientState(BaseModel):
    id: str
    name: str
    age: int = 0
    village: str = ""
    conditions: List[str] = []
    lat: float = 0.0
    lng: float = 0.0
    status: str = "offline"        # normal, warning, critical, offline
    hr: int = 0
    spo2: int = 0
    temp: float = 0.0
    worn: bool = False
    # Blood pressure — written by threshold engine when wristband sends BP
    bp_systolic: int = 0
    bp_diastolic: int = 0
    # LoRa signal quality
    lora_rssi: int = 0
    lora_snr: float = 0.0
    # GPS
    gps_fix: bool = False
    # Risk
    risk_score: int = 0
    last_seen: float = 0.0
    consecutive_warnings: int = 0
    consecutive_criticals: int = 0
    uptime: int = 0


class HubState(BaseModel):
    online: bool = False
    device_id: str = "HUB-01"
    air_ppm: int = 0
    air_aqi: str = "Good"
    flame: bool = False
    pill_slot1: bool = False
    pill_slot2: bool = False
    pill_slot3: bool = False
    pill_slot4: bool = False
    env_temp: float = 0.0
    humidity: float = 0.0
    rtc_time: str = ""
    rtc_date: str = ""
    rssi: int = 0
    uptime: int = 0
    last_seen: float = 0.0
