"""
AyuLink IoT Monitoring Agent — Threshold Engine

Real-time threshold detection with sustained-anomaly filtering,
composite risk scoring, and alert generation.
"""
import time
import uuid
from collections import deque
from typing import Optional
from models import (
    VitalReading, HubReading, Alert, AlertType, Severity,
    PatientState, HubState
)
import config


class ThresholdEngine:
    """
    Monitors incoming vitals against configured thresholds.
    Tracks per-patient state and generates alerts with cooldown.
    """

    def __init__(self, use_mock: bool = False):
        self.patients: dict[str, PatientState] = {}
        self.hub_state = HubState()
        self.vitals_history: dict[str, deque] = {}
        self.alert_log: list[Alert] = []
        self._cooldowns: dict[str, float] = {}  # "patient_id:alert_type" -> last_alert_time
        self.stats = {
            "total_packets": 0,
            "total_alerts": 0,
            "start_time": time.time(),
        }

        # Initialize known patients from config only in mock mode
        if use_mock:
            for p in config.DEMO_PATIENTS:
                self.patients[p["id"]] = PatientState(
                    id=p["id"],
                    name=p["name"],
                    age=p.get("age", 0),
                    village=p.get("village", ""),
                    conditions=p.get("conditions", []),
                    lat=p.get("lat", 0.0),
                    lng=p.get("lng", 0.0),
                )
                self.vitals_history[p["id"]] = deque(maxlen=120)  # Last 120 readings (~6 min at 3s)

    def process_vital(self, reading: VitalReading) -> list[Alert]:
        """Process a vital reading and return any triggered alerts."""
        self.stats["total_packets"] += 1
        alerts = []

        pid = reading.patient_id

        # Register unknown patient
        if pid not in self.patients:
            self.patients[pid] = PatientState(
                id=pid, name=f"Patient {pid}",
                lat=reading.lat, lng=reading.lng,
            )
            self.vitals_history[pid] = deque(maxlen=120)

        state = self.patients[pid]
        state.last_seen = reading.timestamp
        state.lat = reading.lat if reading.lat != 0 else state.lat
        state.lng = reading.lng if reading.lng != 0 else state.lng
        state.worn = reading.worn

        # Store reading
        self.vitals_history[pid].append(reading)

        # ── SOS / FALL / FIDS — check FIRST regardless of worn status ──────────────
        if reading.sos:
            alert = self._maybe_alert(pid, AlertType.SOS, Severity.EMERGENCY,
                                       f"🚨 SOS ACTIVATED by {state.name}!", "SOS")
            if alert:
                alerts.append(alert)
            state.status = "critical"

        if reading.tremor:
            alert = self._maybe_alert(pid, AlertType.FIDS, Severity.EMERGENCY,
                                       f"🫨 FIDS/TREMOR DETECTED for {state.name}!", "FIDS")
            if alert:
                alerts.append(alert)
            state.status = "critical"
        elif reading.fall:
            alert = self._maybe_alert(pid, AlertType.FALL, Severity.EMERGENCY,
                                       f"⚠️ FALL DETECTED for {state.name}!", "Fall")
            if alert:
                alerts.append(alert)
            state.status = "critical"

        # ── Device not worn (after SOS/FALL/FIDS so emergencies always fire) ─────
        if not reading.worn:
            state.status = "offline" if not (reading.sos or reading.fall or reading.tremor) else state.status
            state.hr = 0
            state.spo2 = 0
            state.temp = 0.0
            alert = self._maybe_alert(pid, AlertType.DEVICE_NOT_WORN, Severity.WARNING,
                                       f"Device not worn by {state.name}", "Not Worn")
            if alert:
                alerts.append(alert)
            state.risk_score = 0
            return alerts

        # Update current vitals (only if worn)
        state.hr = reading.hr
        state.spo2 = reading.spo2
        state.temp = reading.temp


        # ── Heart Rate ───────────────────────────────────
        if reading.hr > 0:
            if reading.hr >= config.HR_CRITICAL_HIGH:
                state.consecutive_criticals += 1
                if state.consecutive_criticals >= config.SUSTAINED_READINGS_REQUIRED:
                    alert = self._maybe_alert(pid, AlertType.HR_HIGH, Severity.CRITICAL,
                                               f"Critical Tachycardia: {reading.hr} bpm ({state.name})",
                                               f"{reading.hr} bpm")
                    if alert:
                        alerts.append(alert)
            elif reading.hr >= config.HR_WARNING_HIGH:
                state.consecutive_warnings += 1
                if state.consecutive_warnings >= config.SUSTAINED_READINGS_REQUIRED:
                    alert = self._maybe_alert(pid, AlertType.HR_HIGH, Severity.WARNING,
                                               f"High Heart Rate: {reading.hr} bpm ({state.name})",
                                               f"{reading.hr} bpm")
                    if alert:
                        alerts.append(alert)
            elif reading.hr <= config.HR_CRITICAL_LOW and reading.hr > 0:
                alert = self._maybe_alert(pid, AlertType.HR_LOW, Severity.CRITICAL,
                                           f"Critical Bradycardia: {reading.hr} bpm ({state.name})",
                                           f"{reading.hr} bpm")
                if alert:
                    alerts.append(alert)
            elif reading.hr <= config.HR_WARNING_LOW:
                alert = self._maybe_alert(pid, AlertType.HR_LOW, Severity.WARNING,
                                           f"Low Heart Rate: {reading.hr} bpm ({state.name})",
                                           f"{reading.hr} bpm")
                if alert:
                    alerts.append(alert)
            else:
                state.consecutive_warnings = max(0, state.consecutive_warnings - 1)
                state.consecutive_criticals = max(0, state.consecutive_criticals - 1)

        # ── SpO2 ─────────────────────────────────────────
        if reading.spo2 > 0:
            if reading.spo2 < config.SPO2_CRITICAL:
                alert = self._maybe_alert(pid, AlertType.SPO2_LOW, Severity.CRITICAL,
                                           f"Critical Hypoxia: SpO2 {reading.spo2}% ({state.name})",
                                           f"{reading.spo2}%")
                if alert:
                    alerts.append(alert)
            elif reading.spo2 < config.SPO2_WARNING:
                alert = self._maybe_alert(pid, AlertType.SPO2_LOW, Severity.WARNING,
                                           f"Low SpO2: {reading.spo2}% ({state.name})",
                                           f"{reading.spo2}%")
                if alert:
                    alerts.append(alert)

        # ── Temperature ──────────────────────────────────
        if reading.temp > 0:
            if reading.temp >= config.TEMP_CRITICAL_HIGH:
                alert = self._maybe_alert(pid, AlertType.TEMP_HIGH, Severity.CRITICAL,
                                           f"High Fever: {reading.temp}°C ({state.name})",
                                           f"{reading.temp}°C")
                if alert:
                    alerts.append(alert)
            elif reading.temp >= config.TEMP_WARNING_HIGH:
                alert = self._maybe_alert(pid, AlertType.TEMP_HIGH, Severity.WARNING,
                                           f"Fever: {reading.temp}°C ({state.name})",
                                           f"{reading.temp}°C")
                if alert:
                    alerts.append(alert)
            elif reading.temp < config.TEMP_CRITICAL_LOW:
                alert = self._maybe_alert(pid, AlertType.TEMP_LOW, Severity.CRITICAL,
                                           f"Hypothermia Risk: {reading.temp}°C ({state.name})",
                                           f"{reading.temp}°C")
                if alert:
                    alerts.append(alert)

        # ── Blood Pressure ────────────────────────────────
        if reading.bp_systolic > 0:
            state.bp_systolic = reading.bp_systolic
            state.bp_diastolic = reading.bp_diastolic
            bp_label = f"{reading.bp_systolic}/{reading.bp_diastolic} mmHg"
            if reading.bp_systolic >= config.BP_SYS_CRITICAL or reading.bp_diastolic >= config.BP_DIA_CRITICAL:
                alert = self._maybe_alert(pid, AlertType.BP_HIGH, Severity.CRITICAL,
                                           f"🚨 Hypertensive Crisis: BP {bp_label} ({state.name})",
                                           bp_label)
                if alert:
                    alerts.append(alert)
            elif reading.bp_systolic >= config.BP_SYS_WARNING or reading.bp_diastolic >= config.BP_DIA_WARNING:
                alert = self._maybe_alert(pid, AlertType.BP_HIGH, Severity.WARNING,
                                           f"High Blood Pressure: BP {bp_label} ({state.name})",
                                           bp_label)
                if alert:
                    alerts.append(alert)
            elif reading.bp_systolic <= config.BP_SYS_LOW or reading.bp_diastolic <= config.BP_DIA_LOW:
                alert = self._maybe_alert(pid, AlertType.BP_LOW, Severity.WARNING,
                                           f"Low Blood Pressure (Hypotension): BP {bp_label} ({state.name})",
                                           bp_label)
                if alert:
                    alerts.append(alert)

        # ── Compute Risk Score (0–100) ───────────────────
        state.risk_score = self._compute_risk(reading)

        # ── Overall Status ───────────────────────────────
        if not reading.sos and not reading.fall:
            if state.risk_score >= 70:
                state.status = "critical"
            elif state.risk_score >= 30:
                state.status = "warning"
            else:
                state.status = "normal"

        return alerts

    def process_hub(self, reading: HubReading) -> list[Alert]:
        """Process Smart Hub (NodeMCU) data and return alerts."""
        alerts = []
        self.hub_state.online = True
        self.hub_state.air_ppm = reading.air_ppm
        self.hub_state.air_aqi = reading.air_aqi
        self.hub_state.flame = reading.flame
        self.hub_state.pill_slot1 = reading.pill_slot1
        self.hub_state.pill_slot2 = reading.pill_slot2
        self.hub_state.pill_slot3 = reading.pill_slot3
        self.hub_state.pill_slot4 = getattr(reading, 'pill_slot4', False)
        self.hub_state.last_seen = reading.timestamp
        # DHT11 environmental readings
        if reading.env_temp > 0:
            self.hub_state.env_temp = reading.env_temp
        if reading.humidity > 0:
            self.hub_state.humidity = reading.humidity
        # DS3231 RTC
        if reading.rtc_time:
            self.hub_state.rtc_time = reading.rtc_time
        if reading.rtc_date:
            self.hub_state.rtc_date = reading.rtc_date

        # Air quality alert
        if reading.air_ppm >= config.AIR_QUALITY_CRITICAL:
            alert = self._maybe_alert("HUB", AlertType.AIR_QUALITY, Severity.CRITICAL,
                                       f"🏭 HAZARDOUS Air Quality: {reading.air_ppm} PPM",
                                       f"{reading.air_ppm} PPM")
            if alert:
                alerts.append(alert)
        elif reading.air_ppm >= config.AIR_QUALITY_WARNING:
            alert = self._maybe_alert("HUB", AlertType.AIR_QUALITY, Severity.WARNING,
                                       f"Poor Air Quality: {reading.air_ppm} PPM",
                                       f"{reading.air_ppm} PPM")
            if alert:
                alerts.append(alert)

        # Flame detection
        if reading.flame:
            alert = self._maybe_alert("HUB", AlertType.FLAME_DETECTED, Severity.EMERGENCY,
                                       "🔥 FIRE DETECTED! Flame sensor triggered!", "FIRE")
            if alert:
                alerts.append(alert)

        return alerts


    def check_offline_patients(self) -> list[Alert]:
        """Check for patients that haven't sent data recently."""
        alerts = []
        now = time.time()
        for pid, state in self.patients.items():
            if state.last_seen > 0 and (now - state.last_seen) > config.PATIENT_OFFLINE_TIMEOUT:
                if state.status != "offline":
                    state.status = "offline"
                    alert = self._maybe_alert(pid, AlertType.DEVICE_OFFLINE, Severity.WARNING,
                                               f"Device offline: {state.name} (no data for {int(now - state.last_seen)}s)",
                                               "Offline")
                    if alert:
                        alerts.append(alert)
        return alerts

    def _compute_risk(self, r: VitalReading) -> int:
        """Compute composite risk score 0–100."""
        score = 0

        if r.hr > 120:
            score += 40
        elif r.hr > 100:
            score += 20
        elif 0 < r.hr < 50:
            score += 30

        if 0 < r.spo2 < 85:
            score += 50
        elif 0 < r.spo2 < 90:
            score += 30
        elif 0 < r.spo2 < 95:
            score += 15

        if r.temp > 39:
            score += 25
        elif r.temp > 38:
            score += 10
        elif 0 < r.temp < 35:
            score += 25

        # Blood pressure risk contribution
        if r.bp_systolic > 0:
            if r.bp_systolic >= 180 or r.bp_diastolic >= 120:
                score += 40  # Hypertensive crisis
            elif r.bp_systolic >= 140 or r.bp_diastolic >= 90:
                score += 20  # Stage 1 hypertension
            elif r.bp_systolic <= 90 or r.bp_diastolic <= 60:
                score += 25  # Hypotension

        if r.fall:
            score += 50
        if r.sos:
            score += 50

        return min(100, score)

    def _maybe_alert(self, patient_id: str, alert_type: AlertType,
                     severity: Severity, message: str, value: str) -> Optional[Alert]:
        """Create alert if cooldown has passed. SOS/FALL always bypass cooldown."""
        key = f"{patient_id}:{alert_type.value}"
        now = time.time()
        last_time = self._cooldowns.get(key, 0)

        # SOS and FALL are life-safety events — fire on first packet, 2s cooldown to prevent spam
        is_emergency = alert_type in (AlertType.SOS, AlertType.FALL, AlertType.FIDS, AlertType.FLAME_DETECTED)
        cooldown = 2 if is_emergency else config.ALERT_COOLDOWN_SECONDS

        if now - last_time < cooldown:
            return None

        # Update cooldown (for non-emergency types only — emergencies reset on next call)
        self._cooldowns[key] = now

        patient_name = ""
        if patient_id in self.patients:
            patient_name = self.patients[patient_id].name
        elif patient_id == "HUB":
            patient_name = "Smart Hub"
        else:
            # Fallback: try to resolve from SQLite DB
            try:
                import database as _db
                p = _db.get_patient(patient_id)
                if p:
                    patient_name = p.get("name", f"Patient {patient_id}")
                    # Cache in memory so we don't hit DB every alert
                    from models import PatientState
                    self.patients[patient_id] = PatientState(
                        id=patient_id, name=patient_name,
                        age=p.get("age", 0), village=p.get("village", ""),
                        conditions=p.get("conditions", []),
                    )
            except Exception:
                patient_name = f"Patient {patient_id}"

        alert = Alert(
            id=str(uuid.uuid4())[:8],
            patient_id=patient_id,
            patient_name=patient_name,
            alert_type=alert_type,
            severity=severity,
            message=message,
            value=value,
        )

        self.alert_log.append(alert)
        if len(self.alert_log) > 200:
            self.alert_log = self.alert_log[-200:]

        self.stats["total_alerts"] += 1
        return alert

    def get_dashboard_state(self) -> dict:
        """Return full state for dashboard consumption."""
        now = time.time()
        patients_list = []
        for pid, state in self.patients.items():
            ps = state.model_dump()
            ps["seconds_ago"] = int(now - state.last_seen) if state.last_seen > 0 else -1
            patients_list.append(ps)

        return {
            "patients": patients_list,
            "hub": self.hub_state.model_dump(),
            "alerts": [a.model_dump() for a in self.alert_log[-30:]],
            "stats": {
                **self.stats,
                "uptime": int(now - self.stats["start_time"]),
                "patients_online": sum(1 for p in self.patients.values() if p.status != "offline"),
                "patients_total": len(self.patients),
            },
        }
