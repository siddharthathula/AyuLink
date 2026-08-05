"""
AyuLink IoT Monitoring Agent — Mock IoT Data Stream Generator

Generates realistic patient vital signs matching the exact firmware JSON schema.
Simulates normal vitals, gradual deterioration, cardiac events, falls, and SOS.
"""
import asyncio
import random
import time
import math
from typing import Callable, Awaitable
from models import VitalReading, HubReading
import config


class MockPatientProfile:
    """Simulates one patient's vital sign behavior over time."""

    def __init__(self, patient_id: str, patient_cfg: dict):
        self.patient_id = patient_id
        self.name = patient_cfg["name"]
        self.lat = patient_cfg["lat"]
        self.lng = patient_cfg["lng"]
        self.conditions = patient_cfg.get("conditions", [])

        # Base vitals (vary by condition)
        self.base_hr = 72
        self.base_spo2 = 97
        self.base_temp = 36.6

        if "Cardiac" in self.conditions:
            self.base_hr = 82
        if "COPD" in self.conditions:
            self.base_spo2 = 93
        if "Hypertension" in self.conditions:
            self.base_hr = 78

        # State
        self.worn = True
        self.sos = False
        self.fall = False
        self.cardiac_event = False
        self.event_duration = 0

    def generate_reading(self) -> VitalReading:
        """Generate one realistic vital reading."""
        now = time.time()

        # Decay manual events
        if self.event_duration > 0:
            self.event_duration -= 1
        else:
            self.sos = False
            self.cardiac_event = False
            self.fall = False

        # Calculate vitals based on state
        if not self.worn:
            hr, spo2, temp = 0, 0, 0.0
        elif self.sos:
            # SOS: patient in distress — elevated HR, lowered SpO2, but alive
            hr = random.randint(100, 130)
            spo2 = random.randint(85, 93)
            temp = round(self.base_temp + random.uniform(0.2, 1.0), 1)
        elif self.cardiac_event:
            # Cardiac: tachycardia with moderate hypoxia
            hr = random.randint(120, 155)
            spo2 = random.randint(82, 91)
            temp = round(self.base_temp + random.uniform(0.5, 1.5), 1)
        elif self.fall:
            # Fall: slightly elevated HR from shock, mild SpO2 drop
            hr = random.randint(90, 120)
            spo2 = random.randint(90, 96)
            temp = round(self.base_temp + random.uniform(0, 0.5), 1)
        else:
            # Normal with natural variation
            variation = math.sin(now * 0.01) * 3
            hr = int(self.base_hr + variation + random.randint(-3, 3))
            spo2 = min(100, max(93, self.base_spo2 + random.randint(-1, 2)))
            temp = round(self.base_temp + random.uniform(-0.2, 0.3), 1)

        # GPS drift
        lat = self.lat + random.uniform(-0.0005, 0.0005)
        lng = self.lng + random.uniform(-0.0005, 0.0005)

        return VitalReading(
            patient_id=self.patient_id,
            hr=max(0, hr),
            spo2=max(0, spo2),
            temp=max(0, temp),
            lat=lat,
            lng=lng,
            sos=self.sos,
            fall=self.fall,
            worn=self.worn,
            rssi=random.randint(-100, -30),
            timestamp=now,
        )


class MockHubProfile:
    """Simulates the ESP32-S3 Smart Hub sensor data."""

    def __init__(self):
        self.base_ppm = 80
        self.flame = False
        self.pill_taken = [False, False, False, False]
        self._flame_duration = 0

    def generate_reading(self) -> HubReading:
        now = time.time()

        # Air quality: natural fluctuation
        variation = math.sin(now * 0.005) * 30
        ppm = int(self.base_ppm + variation + random.randint(-10, 10))
        ppm = max(20, ppm)

        # Categorize AQI
        if ppm < 50:
            aqi = "Good"
        elif ppm < 100:
            aqi = "Moderate"
        elif ppm < 150:
            aqi = "Unhealthy (Sensitive)"
        elif ppm < 200:
            aqi = "Unhealthy"
        elif ppm < 300:
            aqi = "Very Unhealthy"
        else:
            aqi = "Hazardous"

        # 0.5% chance of flame event
        if random.random() < 0.005 and not self.flame:
            self.flame = True
            self._flame_duration = random.randint(3, 8)

        if self._flame_duration > 0:
            self._flame_duration -= 1
        else:
            self.flame = False

        # Simulate pill intake based on time of day
        # hour = time.localtime(now).tm_hour
        # if hour >= 9:
        #     self.pill_taken[0] = True
        # if hour >= 14:
        #     self.pill_taken[1] = True
        # if hour >= 20:
        #     self.pill_taken[2] = True

        return HubReading(
            air_ppm=ppm,
            air_aqi=aqi,
            flame=self.flame,
            pill_slot1=self.pill_taken[0],
            pill_slot2=self.pill_taken[1],
            pill_slot3=self.pill_taken[2],
            pill_slot4=self.pill_taken[3],
            timestamp=now,
        )


class MockDataStream:
    """Orchestrates mock data generation for all patients and the hub."""

    def __init__(self):
        self.patients: dict[str, MockPatientProfile] = {}
        self.hub = MockHubProfile()

        for p in config.DEMO_PATIENTS:
            self.patients[p["id"]] = MockPatientProfile(p["id"], p)

    async def run(
        self,
        on_vital: Callable[[VitalReading], Awaitable[None]],
        on_hub: Callable[[HubReading], Awaitable[None]],
        enabled_check: Callable[[], bool] = lambda: True,
    ):
        """Continuously generate mock data and call handlers."""
        while True:
            # Paused while simulation is OFF (Settings → Simulation Mode) or a real
            # Gateway is connected — no mock data emitted, task stays alive.
            if not enabled_check():
                await asyncio.sleep(1)
                continue
            # Generate vitals for each patient (staggered)
            for pid, profile in self.patients.items():
                reading = profile.generate_reading()
                await on_vital(reading)
                await asyncio.sleep(0.3)  # Stagger readings

            # Generate hub data
            hub_reading = self.hub.generate_reading()
            await on_hub(hub_reading)

            await asyncio.sleep(config.MOCK_INTERVAL_SECONDS)

    def trigger_event(self, event_type: str, patient_id: str = "P_01"):
        """Manually trigger a demo event."""
        if patient_id in self.patients:
            p = self.patients[patient_id]
            if event_type == "sos":
                p.sos = True
                p.event_duration = 10
            elif event_type == "fall":
                p.fall = True
                p.event_duration = 8
            elif event_type == "cardiac":
                p.cardiac_event = True
                p.event_duration = 15
            elif event_type == "flame":
                self.hub.flame = True
                self.hub._flame_duration = 10
