/*
 * AyuLink Wristband v5.0 — Patient 108 (Ramulu Goud)
 * =====================================================
 * HACKATHON FINAL BUILD — Mock HR, real MPU fall/tremor, real SOS
 *
 *   KY-039 → GPIO36 (MOCK — generates realistic 72-85 BPM)
 *   MPU6050 → SDA=21, SCL=22
 *   SOS Button → GPIO33 + GND
 *   OLED SH1106 → I2C
 *   LoRa SX1278 → SCK=18,MISO=19,MOSI=23,NSS=5,RST=14,DIO0=26
 *   Buzzer → GPIO27  |  LED → GPIO2
 */

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LoRa.h>
#include <SPI.h>
#include <U8g2lib.h>
#include <Wire.h>

// ── PINS ──
#define LORA_SCK 18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_NSS 5
#define LORA_RST 14
#define LORA_DIO0 26
#define PIN_PULSE 36
#define PIN_SOS 33
#define PIN_BUZZ 27
#define PIN_LED 2

// ── PATIENT ──
#define PATIENT_ID "108"
#define PATIENT_NAME "Ramulu Goud"
#define MOCK_LAT 18.0578f
#define MOCK_LNG 79.5536f

// ── OBJECTS ──
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);
Adafruit_MPU6050 mpu;
bool mpuOk = false;

// ── STATE ──
int bpm = 75;
int spo2 = 97;
float mockTemp = 36.8;
bool worn = true; // always worn (mock mode)
bool sosActive = false;
bool fallActive = false;
bool tremorActive = false;
unsigned long sosTime = 0;
unsigned long fallTime = 0;
unsigned long tremorTime = 0;
#define ALERT_SHOW_MS 20000 // show on wristband OLED for 20s

// ── ONE-SHOT TX FLAGS REMOVED ──
// Alerts now persist in the JSON packet for the duration of the alert state
// (20s) to ensure the Gateway receives them even if LoRa packets are dropped.

// ── MPU STATE ──
float lastTotalG = 1.0f; // previous reading for jerk detection
int tremCount = 0;
unsigned long tremWindow = 0;

// ── DISPLAY ──
uint8_t displayPage = 0;
unsigned long lastPageMs = 0;
#define PAGE_CYCLE_MS 4000

// ── NOTIFICATIONS / HUB ──
char notifMsg[64] = "";
unsigned long notifUntil = 0;
float hubTemp = 0;
float hubHumidity = 0;
int hubAirPpm = 0;
bool hubFlame = false;
char hubAqi[12] = "---";
bool hubSlot[4] = {false, false, false, false};
bool hubReceived = false;

// ── TX ──
unsigned long lastTxMs = 0;
unsigned long lastMpuRetryMs = 0;
#define TX_INTERVAL_MS 2000 // send vitals every 2s normal
#define TX_INTERVAL_EMERGENCY_MS 800 // faster TX during SOS/Fall

// =================================================================
// NON-BLOCKING BUZZER — never freezes the main loop
// =================================================================
struct BuzzerNB {
    int  remaining = 0;
    int  onMs      = 100;
    int  offMs     = 60;
    bool buzzing   = false;
    unsigned long nextMs = 0;
} bzNB;

void buzzerTick() {
    if (bzNB.remaining <= 0) { noTone(PIN_BUZZ); digitalWrite(PIN_BUZZ, LOW); return; }
    if (millis() < bzNB.nextMs) return;
    if (!bzNB.buzzing) {
        tone(PIN_BUZZ, 1000);
        digitalWrite(PIN_BUZZ, HIGH);
        bzNB.buzzing = true;
        bzNB.nextMs = millis() + bzNB.onMs;
    } else {
        noTone(PIN_BUZZ);
        digitalWrite(PIN_BUZZ, LOW);
        bzNB.buzzing = false;
        bzNB.remaining--;
        bzNB.nextMs = millis() + (bzNB.remaining > 0 ? bzNB.offMs : 0);
    }
}

void beepNB(int n, int onMs = 100, int offMs = 60) {
    bzNB.remaining = n;
    bzNB.onMs = onMs;
    bzNB.offMs = offMs;
    bzNB.buzzing = false;
    bzNB.nextMs = 0; // fire immediately
}

// Blocking beep only for setup
void beep(int n, int ms = 100) {
  for (int i = 0; i < n; i++) {
    tone(PIN_BUZZ, 1000);
    digitalWrite(PIN_BUZZ, HIGH);
    delay(ms);
    noTone(PIN_BUZZ);
    digitalWrite(PIN_BUZZ, LOW);
    if (i < n - 1)
      delay(60);
  }
}

// =================================================================
// MOCK HEART RATE — realistic 72-85 BPM with natural drift
// =================================================================
void updateMockHR() {
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate < 2000)
    return; // update every 2s
  lastUpdate = millis();

  // Drift BPM naturally
  bpm += random(-2, 3); // -2 to +2
  bpm = constrain(bpm, 68, 92);

  // SpO2 stays 95-99
  spo2 = 95 + random(0, 5);

  // Drift Temp
  if (random(0, 10) > 6) {
    mockTemp += (random(0, 10) > 5 ? 0.1 : -0.1);
    if (mockTemp < 36.5)
      mockTemp = 36.5;
    if (mockTemp > 37.8)
      mockTemp = 37.8;
  }
  worn = true;

  Serial.printf("[HR-MOCK] bpm=%d spo2=%d\n", bpm, spo2);
}

// =================================================================
// MPU6050 FALL + TREMOR DETECTION
// Ultra-sensitive for hackathon demo
// =================================================================
void checkFall() {
  if (!mpuOk)
    return;

  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);

  float ax = a.acceleration.x / 9.81f;
  float ay = a.acceleration.y / 9.81f;
  float az = a.acceleration.z / 9.81f;
  float totalG = sqrtf(ax * ax + ay * ay + az * az);

  // JERK = how fast acceleration is changing (key for tremor)
  float jerk = fabsf(totalG - lastTotalG);
  lastTotalG = totalG;

  // Debug
  static unsigned long dbgT = 0;
  if (millis() - dbgT > 400) {
    dbgT = millis();
    Serial.printf("[MPU] G=%.2f jerk=%.2f trem=%d fall=%d\n", totalG, jerk,
                  tremCount, fallActive);
  }

  // ── TREMOR/FIDS: detect rapid shaking via jerk ──
  // Need 3 jerk spikes > 0.25 within 2s to avoid false triggers
  if (jerk > 0.25f && !tremorActive && !fallActive) {
    if (millis() - tremWindow > 2000) {
      tremCount = 0;
      tremWindow = millis();
    }
    tremCount++;
    Serial.printf("[TREMOR] jerk spike #%d (jerk=%.2f)\n", tremCount, jerk);
    if (tremCount >= 3) { // need 3 spikes to confirm tremor
      tremorActive = true;
      tremorTime = millis();
      beepNB(3, 80);  // NON-BLOCKING
      sendVitals();    // IMMEDIATE TX — don't wait for next scheduled slot
      Serial.println("[TREMOR] *** FIDS DETECTED — INSTANT TX ***");
    }
  }
  if (tremorActive && millis() - tremorTime > 10000) {
    tremorActive = false;
  }

  // ── FALL: sudden impact — totalG > 1.8g ──
  // At rest = 1.0g. Normal movement = 1.2-1.5g. Real fall = 2.0g+
  // 1.8g threshold prevents false triggers from walking/gesturing
  if (totalG > 1.8f && !fallActive) {
    fallActive = true;
    fallTime = millis();
    beepNB(4, 150);  // NON-BLOCKING
    sendVitals();    // IMMEDIATE TX — don't wait for next scheduled slot
    Serial.printf("[FALL] *** DETECTED — INSTANT TX *** G=%.2f\n", totalG);
  }

  // Auto-clear fall after ALERT_SHOW_MS
  if (fallActive && millis() - fallTime > ALERT_SHOW_MS) {
    fallActive = false;
    tremorActive = false;
    Serial.println("[FALL] Auto-cleared");
  }
}

// =================================================================
// SOS BUTTON
// Press 50ms–1800ms  = ACTIVATE SOS  (fires exactly once per event)
// Long press >= 2000ms = CANCEL all alerts
// =================================================================
void checkSOS() {
  static unsigned long pressDownTime = 0;
  static bool longPressFired = false;
  static bool isPressed = false;
  static unsigned long lastDebounceTime = 0;
  static int lastReading = HIGH;

  int reading = digitalRead(PIN_SOS);

  // Debounce
  if (reading != lastReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > 20) {
    // If the button state has changed (after debounce)
    if (reading == LOW && !isPressed) {
      // Button just pressed
      isPressed = true;
      pressDownTime = millis();
      longPressFired = false;
      Serial.println("[SOS] Button down");
    } else if (reading == HIGH && isPressed) {
      // Button just released
      isPressed = false;
      unsigned long held = millis() - pressDownTime;

      // Check if it was a short press
      if (!longPressFired && held >= 50 && held < 1800) {
        if (!sosActive) {
          sosActive = true;
          sosTime = millis();
          beepNB(3, 200);  // NON-BLOCKING — loop keeps running
          sendVitals();    // IMMEDIATE TX with sos=true
          Serial.printf("[SOS] *** ACTIVATED — INSTANT TX (held %lums) ***\n", held);
        }
      }
    }
  }

  // While held — detect long press (>= 2s = cancel)
  if (isPressed && !longPressFired) {
    if (millis() - pressDownTime >= 2000) {
      longPressFired = true;
      sosActive = false;
      fallActive = false;
      tremorActive = false;
      beepNB(1, 50);   // NON-BLOCKING
      sendVitals();    // IMMEDIATE TX with sos=false — clears dashboard
      Serial.println("[SOS] *** ALL CANCELLED — CLEAR TX (long press) ***");
    }
  }

  lastReading = reading;
}

// =================================================================
// LORA TX
// =================================================================
void sendVitals() {
  // SUSTAINED ALERT logic — flags remain true as long as alert is active.
  // This allows the Gateway multiple chances to receive the alert.
  bool txSos = sosActive;
  bool txFall = fallActive;
  bool txTremor = tremorActive;

  JsonDocument doc;
  doc["type"] = "vital";
  doc["patient_id"] = PATIENT_ID;
  doc["patient_name"] = PATIENT_NAME;
  doc["node"] = PATIENT_ID;
  doc["hr"] = bpm;
  doc["spo2"] = spo2;
  doc["oxy"] = spo2;
  doc["temp"] = mockTemp;
  doc["worn"] = worn;
  doc["sos"] = txSos;
  doc["fall"] = txFall;
  doc["tremor"] = txTremor;  // FIDS/tremor separate from fall
  doc["lat"] = MOCK_LAT;
  doc["lng"] = MOCK_LNG;

  String out;
  serializeJson(doc, out);
  LoRa.beginPacket();
  LoRa.print(out);
  LoRa.endPacket();  // Synchronous
  LoRa.receive();    // Back to RX mode immediately
  lastTxMs = millis(); // Reset TX timer so we don't double-send
  if (txSos || txFall || txTremor)
    Serial.printf("[TX-ALERT] sos=%d fall=%d tremor=%d\n", txSos, txFall, txTremor);
  else
    Serial.print("."); // quiet dot for normal vitals packets
}

// =================================================================
// LORA RX — non-blocking
// =================================================================
void checkLoRaRX() {
  int pk = LoRa.parsePacket();
  if (!pk) {
    return;
  } // stay in RX mode

  String msg = "";
  while (LoRa.available())
    msg += (char)LoRa.read();
  Serial.print("[RX] ");
  Serial.println(msg);

  JsonDocument doc;
  if (deserializeJson(doc, msg))
    return;

  const char *cmd = doc["cmd"] | "";
  const char *type = doc["type"] | "";

  // Notification
  if (strcmp(cmd, "notification") == 0 || strcmp(cmd, "notif") == 0 ||
      doc["notif"].is<const char *>()) {
    const char *body = doc["notif"] | doc["msg"] | "";
    if (strlen(body) > 0) {
      strncpy(notifMsg, body, 63);
      notifMsg[63] = '\0';
      notifUntil = millis() + 9000;
      // NOTE: do NOT set displayPage=2 — page 2 resets to 0 in drawOLED!
      // The notifUntil timer already handles notification display.
      beepNB(2, 120);  // NON-BLOCKING
    }
  }

  // Clear
  if (strcmp(cmd, "clear") == 0) {
    notifMsg[0] = '\0';
    notifUntil = 0;
    sosActive = false;
    fallActive = false;
    tremorActive = false;
    displayPage = 0;
  }

  // Hub data
  if (strcmp(type, "h") == 0) {
    hubTemp = doc["t"] | hubTemp;
    hubHumidity = doc["h"] | hubHumidity;
    hubAirPpm = doc["a"] | hubAirPpm;
    hubFlame = doc["f"] | hubFlame;
    const char *aq = doc["q"] | hubAqi;
    strncpy(hubAqi, aq, 11);
    hubAqi[11] = '\0';
    for (int i = 0; i < 4; i++) {
      char key[4];
      sprintf(key, "s%d", i + 1);
      if (doc[key].is<int>())
        hubSlot[i] = (doc[key] == 1);
    }
    hubReceived = true;
    Serial.printf("[HUB] T=%.1f H=%.1f Air=%d Flame=%d\n", hubTemp, hubHumidity,
                  hubAirPpm, hubFlame);
    if (hubFlame) {
      beepNB(5, 150);  // NON-BLOCKING
      strncpy(notifMsg, "!! FIRE AT HUB !!", 63);
      notifUntil = millis() + 12000;
      displayPage = 2;
    }
    // NOTE: Bad air is shown on dispenser page — no popup (was spamming and blocking SOS)
  }
}

// =================================================================
// OLED DISPLAY
// =================================================================
void drawOLED() {
  u8g2.clearBuffer();

  // ── NOTIFICATION (absolute highest priority) ──
  if (millis() < notifUntil && notifMsg[0]) {
    u8g2.setDrawColor(1);
    u8g2.drawBox(0, 0, 128, 10);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(24, 8, ">> ALERT <<");
    u8g2.setDrawColor(1);
    u8g2.setFont(u8g2_font_6x10_tr);

    // Wrap text simply
    String nStr = String(notifMsg);
    int y = 22;
    while (nStr.length() > 0) {
      String line = nStr.substring(0, 21);
      u8g2.drawStr(0, y, line.c_str());
      nStr = nStr.substring(line.length());
      y += 12;
      if (y > 46)
        break;
    }

    long rem = (long)(notifUntil - millis());
    int bw = (int)map(constrain(rem, 0, 9000), 0, 9000, 0, 128);
    u8g2.drawBox(0, 58, bw, 5);
    u8g2.sendBuffer();
    return; // BLOCK EVERYTHING ELSE
  }
  if (notifMsg[0] && millis() >= notifUntil) {
    notifMsg[0] = '\0';
    if (displayPage == 2)
      displayPage = 0;
  }

  // ── EMERGENCY (second priority) ──
  if (sosActive || fallActive) {
    u8g2.setDrawColor(1);
    u8g2.drawBox(0, 0, 128, 64);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_logisoso16_tr);

    const char *lbl;
    if (tremorActive)
      lbl = "!! FIDS !!";
    else if (sosActive)
      lbl = "!! SOS !!";
    else
      lbl = "!! FALL !!";

    int x = (128 - (int)u8g2.getStrWidth(lbl)) / 2;
    u8g2.drawStr(x, 26, lbl);
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(10, 44, PATIENT_NAME);
    u8g2.drawStr(15, 56, "HELP COMING");
    u8g2.setDrawColor(1);

    // Blink LED
    static bool lb = false;
    lb = !lb;
    digitalWrite(PIN_LED, lb);

    u8g2.sendBuffer();
    return;
  }
  digitalWrite(PIN_LED, LOW);

  // ── PAGE 0: VITALS ──
  if (displayPage == 0) {
    u8g2.setDrawColor(1);
    u8g2.drawBox(0, 0, 128, 11);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(2, 8, "P108  RAMULU GOUD");
    u8g2.setDrawColor(1);

    char buf[16];

    // HR big
    u8g2.setFont(u8g2_font_logisoso16_tr);
    snprintf(buf, 16, "%d", bpm);
    u8g2.drawStr(0, 40, buf);
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(42, 36, "BPM");

    // SpO2
    u8g2.setFont(u8g2_font_logisoso16_tr);
    snprintf(buf, 16, "%d%%", spo2);
    u8g2.drawStr(72, 40, buf);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(72, 48, "SpO2");

    // Worn badge
    u8g2.drawStr(95, 20, "[WORN]");

    // Status
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(0, 60, "Monitoring OK");

    // TX dot
    static bool blk = false;
    blk = !blk;
    if (blk)
      u8g2.drawDisc(124, 58, 3);
    else
      u8g2.drawCircle(124, 58, 3);
    u8g2.drawStr(95, 60, "LoRa");
  }

  // ── PAGE 1: DISPENSER ──
  else if (displayPage == 1) {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 10, hubFlame ? "!! FIRE ALERT !!" : "P108 DISPENSER");
    u8g2.drawHLine(0, 12, 128);

    char buf[32];
    if (!hubReceived) {
      u8g2.drawStr(0, 30, "Waiting for hub");
      u8g2.drawStr(0, 42, "data via LoRa...");
      u8g2.setFont(u8g2_font_5x7_tr);
      u8g2.drawStr(0, 56, "Hub syncs every 3s");
    } else {
      snprintf(buf, 32, "T:%.1fC  H:%.0f%%", hubTemp, hubHumidity);
      u8g2.drawStr(0, 26, buf);
      snprintf(buf, 32, "Air:%dPPM  %s", hubAirPpm, hubAqi);
      u8g2.drawStr(0, 38, buf);
      u8g2.drawStr(0, 50, "Pills:");
      char slots[20] = "";
      for (int i = 0; i < 4; i++)
        strcat(slots, hubSlot[i] ? "[X]" : "[ ]");
      u8g2.drawStr(42, 50, slots);
      snprintf(buf, 32, "Flame: %s", hubFlame ? "YES!" : "No");
      u8g2.drawStr(0, 62, buf);
    }
  }

  else {
    displayPage = 0;
  }

  u8g2.sendBuffer();
}

// =================================================================
// SETUP
// =================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=============================");
  Serial.println("  AyuLink Wristband v5.0");
  Serial.println("  HACKATHON FINAL BUILD");
  Serial.println("  Mock HR | Real MPU | Real SOS");
  Serial.println("=============================\n");

  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_SOS, INPUT_PULLUP);
  digitalWrite(PIN_BUZZ, LOW);
  digitalWrite(PIN_LED, LOW);

  // OLED
  Wire.begin(21, 22);
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x14B_tr);
  u8g2.drawStr(16, 24, "AyuLink");
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(12, 40, "Wristband v5.0");
  u8g2.drawStr(22, 54, "P108 - Ramulu");
  u8g2.sendBuffer();
  delay(600);

  // MPU6050 (retry up to 3x — flaky I2C bus can recover)
  mpuOk = false;
  Serial.print("[MPU6050] Init... ");
  for (int attempt = 1; attempt <= 3 && !mpuOk; attempt++) {
    if (attempt > 1) {
      Serial.print("retry#");
      Serial.print(attempt);
      Serial.print("... ");
      delay(300);
    }
    if (mpu.begin()) {
      mpuOk = true;
      mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
      mpu.setGyroRange(MPU6050_RANGE_500_DEG);
      mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
      Serial.println("OK — Fall/Tremor detection ACTIVE");
    }
  }
  if (!mpuOk) Serial.println("FAILED — Fall detection disabled (will auto-retry in loop)");
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 20, mpuOk ? "MPU6050: OK" : "MPU6050: FAIL");
  u8g2.sendBuffer();
  delay(400);

  // LoRa
  Serial.print("[LoRa] Init... ");
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("FAILED");
    u8g2.drawStr(0, 34, "LoRa: FAILED!");
    u8g2.sendBuffer();
    while (1) {
      beep(1, 100);
      delay(500);
    }
  }
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.enableCrc();
  LoRa.receive(); // <--- START IN RX MODE
  Serial.println("OK — 433MHz SF10");
  u8g2.drawStr(0, 34, "LoRa: OK 433MHz");
  u8g2.sendBuffer();
  delay(400);

  beep(2, 80);

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x14B_tr);
  u8g2.drawStr(30, 28, "READY!");
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(6, 46, "Monitoring P108");
  u8g2.sendBuffer();
  delay(500);

  Serial.println("\n[READY] All systems go!");
  Serial.println("[HR]  MOCK MODE — 72-85 BPM");
  Serial.println("[SOS] GPIO33 — single press=ON, double press=OFF");
  Serial.println("[MPU] Shake=FIDS, Drop=FALL");
}

// =================================================================
// LOOP
// =================================================================
void loop() {
  unsigned long now = millis();

  buzzerTick();     // Non-blocking buzzer state machine
  updateMockHR();   // Mock HR data
  checkFall();      // Real MPU6050
  checkSOS();       // Real button
  checkLoRaRX();    // LoRa downlink

  // Auto-recover MPU6050 if init failed (flaky I2C bus)
  if (!mpuOk && now - lastMpuRetryMs >= 10000) {
    lastMpuRetryMs = now;
    Serial.print("[MPU6050] Re-init... ");
    if (mpu.begin()) {
      mpuOk = true;
      mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
      mpu.setGyroRange(MPU6050_RANGE_500_DEG);
      mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
      Serial.println("RECOVERED — Fall/Tremor detection ACTIVE");
      u8g2.clearBuffer();
      u8g2.setFont(u8g2_font_6x10_tr);
      u8g2.drawStr(0, 20, "MPU6050: OK");
      u8g2.sendBuffer();
    } else {
      Serial.println("still failed");
    }
  }

  // TX interval: faster during emergencies for reliable delivery
  unsigned long txInterval = (sosActive || fallActive || tremorActive) ? TX_INTERVAL_EMERGENCY_MS : TX_INTERVAL_MS;
  if (now - lastTxMs >= txInterval) {
    lastTxMs = now;
    sendVitals();
  }

  // Page cycle
  if (!notifMsg[0] && !sosActive && !fallActive &&
      now - lastPageMs >= PAGE_CYCLE_MS) {
    lastPageMs = now;
    displayPage = (displayPage + 1) % 2;
  }

  drawOLED();
}
