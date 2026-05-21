/*
 * AyuLink NodeMCU Smart Dispenser Hub
 * =====================================
 * Hardware:
 *   - NodeMCU ESP8266 (or ESP32)
 *   - MQ-135   → Air quality (A0)
 *   - DHT11    → Room temperature + humidity (D4)
 *   - DS3231   → Precise RTC clock (I2C: D1=SCL, D2=SDA)
 *   - AT24C32  → EEPROM on DS3231 module (same I2C bus)
 *   - Flame    → Flame sensor (D5, digital)
 *   - SG90     → 9g servo (D6, PWM)
 *   - OLED     → 0.96" SSD1306 128x64 I2C display (D1/D2)
 *   - Wristband sync → Receives schedule updates from backend WS
 *
 * WiFi Connection: Connects to home WiFi → WebSocket to AyuLink backend (port
 * 8000)
 *
 * JSON sent to backend:
 *   {
 *     "type":       "hub_data",
 *     "device_id":  "NODEMCU-HUB-01",
 *     "rssi":       -60,
 *     "uptime":     120,
 *     "air_ppm":    85,
 *     "air_aqi":    "Good",
 *     "env_temp":   26.4,
 *     "humidity":   63.2,
 *     "rtc_time":   "13:45:22",
 *     "rtc_date":   "2026-05-02",
 *     "flame":      false,
 *     "pill_slot1": false,
 *     "pill_slot2": false,
 *     "pill_slot3": false,
 *     "pill_slot4": false
 *   }
 *
 * JSON received from backend (schedule sync from wristband dashboard):
 *   {"cmd":"dispense","slot":2}
 *   {"cmd":"set_schedule","slot":1,"time":"08:00"}
 *   {"cmd":"reset_all"}
 *   {"cmd":"notification","msg":"Take meds","sub":"Slot 1 - Morning"}
 */

#ifdef ESP8266
#include <ESP8266WiFi.h>
#include <Servo.h>
#include <WebSocketsClient.h>
#else
#include <ESP32Servo.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#endif

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <RTClib.h>  // Adafruit RTClib for DS3231
#include <U8g2lib.h> // SH1106 OLED library
#include <Wire.h>

// ================================================================
// PIN DEFINITIONS (NodeMCU / ESP8266 GPIO map)
// ================================================================
#define PIN_DHT D4    // DHT11 data
#define PIN_FLAME D5  // Flame sensor digital out (LOW = flame)
#define PIN_SERVO D6  // SG90 servo PWM
#define PIN_AIR A0    // MQ-135 analog (0-1023 on NodeMCU)
#define PIN_BUZZER D7 // Passive buzzer (requires tone/PWM)
#define PIN_LED D0    // Status LED (built-in or external)

// I2C: D1 = SCL, D2 = SDA (default Wire on NodeMCU)

// ================================================================
// OLED CONFIG (SH1106 version)
// ================================================================
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// ================================================================
// DHT11 SENSOR
// ================================================================
#define DHT_TYPE DHT11
DHT dht(PIN_DHT, DHT_TYPE);

// ================================================================
// DS3231 RTC
// ================================================================
RTC_DS3231 rtc;
bool rtcReady = false;

// ================================================================
// SERVO CONFIG
// ================================================================
Servo pillServo;
const int SLOT_ANGLES[4] = {0, 60, 120, 180}; // 4-slot rotary magazine
const char *SLOT_LABELS[4] = {"Morning", "Afternoon", "Evening", "Night"};
const char *SLOT_TIMES[4] = {"08:00", "13:00", "18:00", "22:00"};
bool slotTaken[4] = {false, false, false, false};
bool dispensing = false;
int  dispenseSlot = 0;          // slot being dispensed (1..4)
int  dispenseStep = 0;          // 0=idle 1=open 2=close
unsigned long dispenseTimer = 0;
#define DISPENSE_HOLD_MS 1500

// ================================================================
// WIFI & WEBSOCKET CONFIG  ← UPDATE BEFORE FLASH
// ================================================================
const char *WIFI_SSID = "WiFi";       // <-- Your WiFi SSID
const char *WIFI_PASS = "wordpass";   // <-- Your WiFi Password
const char *WS_HOST = "10.73.201.237"; // <-- Laptop IP running backend
const uint16_t WS_PORT = 8000;
const char *WS_PATH = "/ws/hub";

WebSocketsClient webSocket;
bool wsConnected = false;

// ================================================================
// TIMING
// ================================================================
unsigned long lastSensorRead = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastOLEDUpdate = 0;
#define SENSOR_INTERVAL_MS 3000     // Read sensors every 3s
#define HEARTBEAT_INTERVAL_MS 10000 // Heartbeat every 10s
#define OLED_UPDATE_MS 1000         // OLED refresh every 1s

// ================================================================
// LIVE SENSOR DATA
// ================================================================
float g_envTemp = 0.0f;
float g_humidity = 0.0f;
int g_airPpm = 0;
bool g_flame = false;
String g_rtcTime = "--:--:--";
String g_rtcDate = "----/--/--";
char g_aqiStr[20] = "Unknown";

// ================================================================
// FORWARD DECLARATIONS
// ================================================================
void setupWiFi();
void setupWebSocket();
void setupOLED();
void setupRTC();
void readSensors();
void dispensePill(int slot);
void sendStatus();
void processCommand(const char *json);
void updateOLED();
void buzz(int beeps, int ms = 80);
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);
const char *classifyAQI(int ppm);

// ================================================================
// SETUP
// ================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println(F("\n\n===================================="));
  Serial.println(F("  AyuLink P108 Pill Dispenser"));
  Serial.println(F("  MQ135 + DHT11 + DS3231 + Flame"));
  Serial.println(F("  9g Servo + OLED + WiFi WebSocket"));
  Serial.println(F("====================================\n"));

  // GPIO
  pinMode(PIN_FLAME, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  noTone(PIN_BUZZER); // ensure passive buzzer is silent at boot
  digitalWrite(PIN_LED, LOW);

  // I2C (D1=SCL, D2=SDA on NodeMCU)
  Wire.begin(D2, D1);

  // OLED
  setupOLED();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 10, "AyuLink P108 Hub");
  u8g2.drawStr(0, 22, "Initializing...");
  u8g2.sendBuffer();

  // DHT11
  dht.begin();
  Serial.println(F("[DHT11] Sensor initialized"));

  // DS3231 RTC
  setupRTC();

  // Servo
  pillServo.attach(PIN_SERVO);
  pillServo.write(0); // Home position
  delay(400);
  Serial.println(F("[SERVO] Initialized at 0°"));

  // WiFi + WS
  setupWiFi();
  setupWebSocket();

  // Boot beep
  buzz(2);

  Serial.println(F("\n[READY] NodeMCU Hub operational!"));
  Serial.println(
      F("Slots: 1=Morning(0°) 2=Afternoon(60°) 3=Evening(120°) 4=Night(180°)"));
}

// ================================================================
// MAIN LOOP
// ================================================================
void loop() {
  webSocket.loop();

  unsigned long now = millis();

  // Run dispenser state machine — non-blocking
  runDispenser();

  // Read all sensors at interval
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    readSensors();
    sendStatus();
  }

  // Heartbeat
  if (wsConnected && (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS)) {
    lastHeartbeat = now;
    sendStatus();
  }

  // OLED refresh
  if (now - lastOLEDUpdate >= OLED_UPDATE_MS) {
    lastOLEDUpdate = now;
    updateOLED();
  }

  // Auto-dispense check based on RTC time
  if (rtcReady) {
    DateTime nowDt = rtc.now();
    int h = nowDt.hour();
    int m = nowDt.minute();
    int s = nowDt.second();

    // At :00 second of each scheduled slot time, auto-dispense if not taken
    if (s == 0) {
      const int schedH[4] = {8, 13, 18, 22};
      const int schedM[4] = {0, 0, 0, 0};
      for (int i = 0; i < 4; i++) {
        if (h == schedH[i] && m == schedM[i] && !slotTaken[i]) {
          Serial.printf("[RTC] Scheduled dispense: Slot %d (%s)\n", i + 1,
                        SLOT_LABELS[i]);
          dispensePill(i + 1);
        }
      }
    }

    // Daily reset at midnight
    if (h == 0 && m == 0 && s == 0) {
      for (int i = 0; i < 4; i++)
        slotTaken[i] = false;
      Serial.println(F("[RESET] Daily slot reset at midnight"));
      sendStatus();
    }
  }

  yield(); // ESP8266 watchdog
}

// ================================================================
// READ ALL SENSORS
// ================================================================
void readSensors() {
  // ── DHT11 ─────────────────────────────────────────────────
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) {
    g_humidity = h;
    g_envTemp = t;
    Serial.printf("[DHT11] Temp: %.1f°C  Humidity: %.1f%%\n", t, h);
  } else {
    Serial.println(F("[DHT11] Read failed — check wiring"));
  }

  // ── MQ-135 ─────────────────────────────────────────────────
  int raw = analogRead(PIN_AIR);
  g_airPpm = map(raw, 0, 1023, 0, 1000); // Linear approximation
  strncpy(g_aqiStr, classifyAQI(g_airPpm), sizeof(g_aqiStr) - 1);
  Serial.printf("[MQ135] Raw: %d  PPM: %d  AQI: %s\n", raw, g_airPpm, g_aqiStr);

  // ── Flame Sensor ──────────────────────────────────────────
  g_flame = (digitalRead(PIN_FLAME) == LOW); // LOW = flame detected
  if (g_flame) {
    Serial.println(F("[FLAME] *** FIRE DETECTED ***"));
    buzz(5, 200); // Urgent alarm
    digitalWrite(PIN_LED, HIGH);
  } else {
    digitalWrite(PIN_LED, LOW);
  }

  // ── DS3231 RTC ────────────────────────────────────────────
  if (rtcReady) {
    DateTime now = rtc.now();
    char timeBuf[12], dateBuf[14];
    snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d:%02d", now.hour(),
             now.minute(), now.second());
    snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", now.year(),
             now.month(), now.day());
    g_rtcTime = String(timeBuf);
    g_rtcDate = String(dateBuf);
    Serial.printf("[DS3231] Time: %s  Date: %s\n", timeBuf, dateBuf);
  }
}

// ================================================================
// DISPENSE PILL — NON-BLOCKING state machine
// slot = 1..4
// Called from loop() once started; runDispenser() does the work
// ================================================================
void dispensePill(int slot) {
  if (slot < 1 || slot > 4) return;
  if (dispensing) {
    Serial.println(F("[DISPENSE] Blocked — already running"));
    return;
  }
  dispenseSlot = slot;
  dispensing   = true;
  dispenseStep = 1;  // start state machine

  int idx = slot - 1;
  Serial.printf("[DISPENSE] Starting Slot %d (%s) -> %d deg\n",
                slot, SLOT_LABELS[idx], SLOT_ANGLES[idx]);

  // OLED feedback immediately (non-blocking)
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x14_tf);
  char buf[32]; snprintf(buf, sizeof(buf), "Slot %d", slot);
  u8g2.drawStr(0, 15, buf);
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 32, SLOT_LABELS[idx]);
  u8g2.drawStr(0, 44, "Dispensing...");
  u8g2.sendBuffer();
}

// Call this every loop() iteration to advance dispenser state machine
void runDispenser() {
  if (!dispensing) return;
  int idx = dispenseSlot - 1;

  if (dispenseStep == 1) {
    // Step 1: move servo to slot angle
    pillServo.write(SLOT_ANGLES[idx]);
    dispenseTimer = millis();
    dispenseStep  = 2;

  } else if (dispenseStep == 2 && millis() - dispenseTimer >= 800 + DISPENSE_HOLD_MS) {
    // Step 2: return servo home after hold time
    pillServo.write(0);
    dispenseTimer = millis();
    dispenseStep  = 3;

  } else if (dispenseStep == 3 && millis() - dispenseTimer >= 500) {
    // Step 3: all done
    slotTaken[idx] = true;
    dispensing     = false;
    dispenseStep   = 0;
    buzz(2, 60);
    Serial.printf("[DISPENSE] Done Slot %d\n", dispenseSlot);
    sendStatus();
  }
}

// ================================================================
// SEND STATUS JSON TO BACKEND
// ================================================================
void sendStatus() {
  if (!wsConnected)
    return;

  JsonDocument doc;
  doc["type"] = "hub_data";
  doc["device_id"] = "P108";
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = millis() / 1000;

  // MQ-135
  doc["air_ppm"] = g_airPpm;
  doc["air_aqi"] = g_aqiStr;

  // DHT11
  doc["env_temp"] = g_envTemp;
  doc["humidity"] = g_humidity;

  // DS3231 RTC
  doc["rtc_time"] = g_rtcTime;
  doc["rtc_date"] = g_rtcDate;

  // Flame
  doc["flame"] = g_flame;

  // Pill slots
  doc["pill_slot1"] = slotTaken[0];
  doc["pill_slot2"] = slotTaken[1];
  doc["pill_slot3"] = slotTaken[2];
  doc["pill_slot4"] = slotTaken[3];

  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);

  Serial.printf("[TX] hub_data sent: T=%.1f°C H=%.1f%% AQI=%s Flame=%s\n",
                g_envTemp, g_humidity, g_aqiStr, g_flame ? "YES!" : "No");
}

// ================================================================
// PROCESS COMMAND FROM DASHBOARD (via WebSocket)
// ================================================================
void processCommand(const char *json) {
  JsonDocument doc;
  if (deserializeJson(doc, json))
    return;

  const char *cmd = doc["cmd"] | "";
  Serial.printf("[CMD] Received: %s\n", cmd);

  if (strcmp(cmd, "dispense") == 0) {
    int slot = doc["slot"] | 0;
    if (slot >= 1 && slot <= 4)
      dispensePill(slot);

  } else if (strcmp(cmd, "set_schedule") == 0) {
    // Future: update EEPROM schedule via AT24C32
    int slot = doc["slot"] | 0;
    const char *time_str = doc["time"] | "00:00";
    Serial.printf("[SCHEDULE] Slot %d set to %s (EEPROM update TODO)\n", slot,
                  time_str);
    buzz(1, 100);

  } else if (strcmp(cmd, "reset_all") == 0) {
    for (int i = 0; i < 4; i++)
      slotTaken[i] = false;
    Serial.println(F("[CMD] All slots reset"));
    buzz(1, 200);
    sendStatus();

  } else if (strcmp(cmd, "reset_slot") == 0) {
    int slot = doc["slot"] | 0;
    if (slot >= 1 && slot <= 4) {
      slotTaken[slot - 1] = false;
      buzz(1, 100);
      sendStatus();
    }

  } else if (strcmp(cmd, "status") == 0) {
    sendStatus();

  } else if (strcmp(cmd, "buzz") == 0) {
    buzz(doc["count"] | 1);

  } else if (strcmp(cmd, "notification") == 0) {
    // Wristband schedule sync → show on OLED
    const char *msg = doc["msg"] | "Alert!";
    const char *sub = doc["sub"] | "";
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 10, ">> NOTIFICATION <<");
    u8g2.drawStr(0, 22, msg);
    u8g2.drawStr(0, 34, sub);
    u8g2.sendBuffer();
    buzz(4, 50);
    Serial.printf("[NOTIFY] %s | %s\n", msg, sub);

  } else {
    Serial.printf("[CMD] Unknown: '%s'\n", cmd);
  }
}

// ================================================================
// WEBSOCKET EVENT HANDLER
// ================================================================
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    wsConnected = true;
    Serial.println(F("[WS] ✓ Connected to AyuLink backend!"));
    buzz(2, 80);
    sendStatus();
    break;

  case WStype_DISCONNECTED:
    wsConnected = false;
    Serial.println(F("[WS] Disconnected — will retry..."));
    break;

  case WStype_TEXT: {
    char buf[512];
    size_t len = min(length, sizeof(buf) - 1);
    memcpy(buf, payload, len);
    buf[len] = '\0';
    Serial.printf("[WS RX] %s\n", buf);
    processCommand(buf);
    break;
  }

  default:
    break;
  }
}

// ================================================================
// WIFI SETUP — retry loop (never gives up)
// ================================================================
void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);

  auto tryConnect = [&]() {
    Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 10, "Connecting WiFi:");
    u8g2.drawStr(0, 22, WIFI_SSID);
    u8g2.sendBuffer();

    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 40) { // 20s
      delay(500);
      Serial.print(".");
      retries++;
      if (retries % 4 == 0) {
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tf);
        u8g2.drawStr(0, 10, "Connecting WiFi:");
        u8g2.drawStr(0, 22, WIFI_SSID);
        char pb[12] = "";
        for (int d = 0; d < (retries / 4) % 5; d++)
          strcat(pb, ".");
        u8g2.drawStr(0, 36, pb);
        u8g2.sendBuffer();
      }
    }
  };

  tryConnect();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] First attempt failed, retrying...");
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 10, "WiFi retry...");
    u8g2.sendBuffer();
    WiFi.disconnect(true);
    delay(1500);
    tryConnect();
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s  RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 10, "WiFi Connected!");
    u8g2.drawStr(0, 22, WiFi.localIP().toString().c_str());
    char rssi[24];
    snprintf(rssi, 24, "RSSI: %d dBm", WiFi.RSSI());
    u8g2.drawStr(0, 34, rssi);
    u8g2.sendBuffer();
    buzz(2, 80);
    delay(1000);
  } else {
    Serial.println(F("\n[WiFi] FAILED — running offline. Will keep retrying."));
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 10, "WiFi FAILED");
    u8g2.drawStr(0, 22, "Check: WiFi/wordpass");
    u8g2.drawStr(0, 34, "Retrying in bg...");
    u8g2.sendBuffer();
    buzz(3, 200);
    delay(2000);
  }
}

// ================================================================
// WEBSOCKET SETUP
// ================================================================
void setupWebSocket() {
  Serial.printf("[WS] Connecting → ws://%s:%d%s\n", WS_HOST, WS_PORT, WS_PATH);
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000); // retry every 3s (was 5s)
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// ================================================================
// DS3231 RTC SETUP
// ================================================================
void setupRTC() {
  if (!rtc.begin()) {
    Serial.println(F("[DS3231] NOT FOUND — check I2C wiring (D1=SCL D2=SDA)"));
    rtcReady = false;
    return;
  }

  // ALWAYS sync to compile time on flash (accurate for demo — flash = now)
  // __DATE__ = "May  3 2026"  __TIME__ = "10:36:14"
  rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  Serial.println(F("[DS3231] RTC synced to compile time"));

  rtcReady = true;
  DateTime now = rtc.now();
  Serial.printf("[DS3231] Time: %04d-%02d-%02d %02d:%02d:%02d\n",
                now.year(), now.month(), now.day(),
                now.hour(), now.minute(), now.second());
}

// ================================================================
// OLED SETUP
// ================================================================
void setupOLED() {
  u8g2.begin();
  Serial.println(F("[OLED] ✓ SH1106 ready (u8g2)"));
}

void updateOLED() {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);

  char buf[32];
  snprintf(buf, sizeof(buf), "P108 Hub  %s", g_rtcTime.c_str());
  u8g2.drawStr(0, 10, buf);

  snprintf(buf, sizeof(buf), "T:%.1fC  H:%.0f%%", g_envTemp, g_humidity);
  u8g2.drawStr(0, 22, buf);

  snprintf(buf, sizeof(buf), "Air:%dPPM %s", g_airPpm,
           g_flame ? "FIRE!" : g_aqiStr);
  u8g2.drawStr(0, 34, buf);

  u8g2.drawStr(0, 46, "Pills: ");
  char slots[12] = "";
  for (int i = 0; i < 4; i++) {
    strcat(slots, slotTaken[i] ? "[x]" : "[ ]");
  }
  u8g2.drawStr(40, 46, slots);

  snprintf(buf, sizeof(buf), "RSSI:%ddBm  %s", WiFi.RSSI(), g_rtcDate.c_str());
  u8g2.drawStr(0, 58, buf);

  u8g2.sendBuffer();
}

// ================================================================
// BUZZER HELPER — passive buzzer (uses tone/noTone for PWM)
// Frequency 1000 Hz = standard alert tone
// ================================================================
void buzz(int beeps, int ms) {
  for (int i = 0; i < beeps; i++) {
    tone(PIN_BUZZER, 1000); // 1 kHz square wave
    delay(ms);
    noTone(PIN_BUZZER);
    if (i < beeps - 1)
      delay(60);
  }
}

// ================================================================
// AQI CLASSIFIER
// ================================================================
const char *classifyAQI(int ppm) {
  if (ppm < 50)
    return "Good";
  if (ppm < 100)
    return "Moderate";
  if (ppm < 150)
    return "Sensitive";
  if (ppm < 200)
    return "Unhealthy";
  if (ppm < 300)
    return "Very Poor";
  return "Hazardous";
}
