/*
 * AyuLink Gateway Firmware — v3.0
 * =====================================
 * ESP32 DevKit V1
 * SH1106 128x64 OLED (U8g2, HW I2C, SDA=21, SCL=22)
 * LoRa RA-02 SX1278 433MHz (SCK=18,MISO=19,MOSI=23,NSS=5,RST=14,DIO0=26)
 * RGB LED: R=25, G=33, B=32  |  Buzzer=27
 *
 * Data flow:
 *   Wristband ──LoRa──► Gateway ──WebSocket──► Backend
 *   Backend   ──WebSocket──► Gateway ──► OLED notification / buzzer
 *
 * OLED pages (auto-rotate 5s, lock on emergency):
 *   0: Patient vitals (HR, SpO2, worn)
 *   1: Gateway status (WiFi, WS, uptime)
 *   2: LoRa stats (RSSI, SNR, packets)
 *   3: Dispenser (temp, humidity, AQI, flame, pills)
 *   4: GPS location
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LoRa.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <SPI.h>

// ── Pins ──────────────────────────────────────────────────────────
#define LORA_SCK    18
#define LORA_MISO   19
#define LORA_MOSI   23
#define LORA_NSS     5
#define LORA_RST    14
#define LORA_DIO0   26
#define PIN_LED_R   25
#define PIN_LED_G   33
#define PIN_LED_B   32
#define PIN_BUZZER  27

// ── Config ────────────────────────────────────────────────────────
const char* WIFI_SSID = "WiFi";
const char* WIFI_PASS = "wordpass";
const char* WS_HOST   = "10.54.97.237";
const uint16_t WS_PORT = 8000;
const char* WS_PATH   = "/ws/gateway";

// ── OLED ──────────────────────────────────────────────────────────
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// ── WebSocket ────────────────────────────────────────────────────
WebSocketsClient ws;
bool wsConnected = false;

// ── Wristband vitals (from LoRa) ─────────────────────────────────
struct Vitals {
    char   node[16]  = "P108";
    int    hr        = 0;
    int    spo2      = 0;
    float  temp      = 0;
    bool   sos       = false;
    bool   fall      = false;
    bool   tremor    = false;  // FIDS/tremor — separate from fall
    bool   worn      = false;
    float  lat       = 18.0578;
    float  lng       = 79.5536;
    int    loraRssi  = 0;
    unsigned long lastRx = 0;
} vit;

// ── Dispenser hub data (from backend WS) ─────────────────────────
struct Hub {
    float  temp      = 0;
    float  humidity  = 0;
    int    airPpm    = 0;
    char   aqi[16]   = "---";
    bool   flame     = false;
    bool   slot[4]   = {false,false,false,false};
    char   rtcTime[12] = "--:--:--";
    bool   received  = false;
} hub;

// ── Alert state ───────────────────────────────────────────────────
struct Notif {
    char  title[32] = "";
    char  msg[64]   = "";
    bool  active    = false;
    unsigned long expiry = 0;
} notif;

// ── Stats ─────────────────────────────────────────────────────────
int   totalPkts   = 0;
int   totalAlerts = 0;
unsigned long bootMs = 0;
unsigned long alertClearTime = 0; // suppress re-triggers after dashboard dismiss

// ── Display state ────────────────────────────────────────────────
int  page      = 0;
const int PAGES = 5;
unsigned long lastPageFlip = 0;
#define PAGE_INTERVAL_MS 5000
#define EMERGENCY_MS     8000
unsigned long sosTime  = 0;
unsigned long fallTime = 0;
unsigned long lastHubLoRaMs = 0;  // throttle hub data LoRa to wristband
#define HUB_LORA_INTERVAL_MS 10000  // only send hub data every 10s (not every packet)

// ── Pending WS message queue (circular, 4 slots) ─────────────────
// Single pendingMsg caused notifications to be lost when hub data
// arrived in the same loop tick and overwrote the pending slot.
#define WS_QUEUE_SIZE 4
String wsQueue[WS_QUEUE_SIZE];
int wsQHead = 0;  // write index
int wsQTail = 0;  // read index

void wsPush(const String& s) {
    int next = (wsQHead + 1) % WS_QUEUE_SIZE;
    if (next == wsQTail) {
        wsQTail = (wsQTail + 1) % WS_QUEUE_SIZE; // drop oldest on overflow
    }
    wsQueue[wsQHead] = s;
    wsQHead = next;
}
bool wsPop(String& out) {
    if (wsQHead == wsQTail) return false;
    out = wsQueue[wsQTail];
    wsQTail = (wsQTail + 1) % WS_QUEUE_SIZE;
    return true;
}

// ── LoRa downlink retry queue ─────────────────────────────────────
// Wristband TX fires every 2s. We retry 3x at 2.5s intervals so
// at least one packet hits the wristband's RX window between TXs.
struct LoRaRetry {
    char  pkt[100];
    int   remaining = 0;
    unsigned long nextSendMs = 0;
} loraRetry;

void scheduleLoRaDownlink(const char* pkt, int retries = 5, bool force = true) {
    if (!force && loraRetry.remaining > 0) {
        // Queue is busy with a higher priority message (like notification). Drop this one.
        return;
    }
    strncpy(loraRetry.pkt, pkt, 99);
    loraRetry.pkt[99]    = '\0';
    loraRetry.remaining  = retries;
    loraRetry.nextSendMs = 0;  // send first immediately
}

void tickLoRaRetry() {
    if (loraRetry.remaining <= 0) return;
    if (millis() < loraRetry.nextSendMs) return;
    LoRa.beginPacket();
    LoRa.print(loraRetry.pkt);
    LoRa.endPacket();
    LoRa.receive();
    loraRetry.remaining--;
    // 1100ms is coprime to wristband's 2000ms TX interval, ensuring we slide into its RX window
    loraRetry.nextSendMs = millis() + 1100; 
    Serial.printf("[LoRa-DOWN] sent (retries left=%d): %s\n",
                  loraRetry.remaining, loraRetry.pkt);
}


// ── Non-blocking buzzer state machine ───────────────────────────
struct BuzzerTask {
    int   total   = 0;   // total beeps remaining
    int   onMs    = 100; // ON duration ms
    int   offMs   = 60;  // OFF gap ms
    bool  buzzing = false;
    unsigned long nextMs = 0;
} bz;

void buzzerTick() {
    if (bz.total <= 0) { digitalWrite(PIN_BUZZER, LOW); return; }
    if (millis() < bz.nextMs) return;
    if (!bz.buzzing) {
        digitalWrite(PIN_BUZZER, HIGH);
        bz.buzzing = true;
        bz.nextMs  = millis() + bz.onMs;
    } else {
        digitalWrite(PIN_BUZZER, LOW);
        bz.buzzing = false;
        bz.total--;
        bz.nextMs = millis() + (bz.total > 0 ? bz.offMs : 0);
    }
}
void beepAsync(int n, int onMs = 100, int offMs = 60) {
    bz.total   = n;
    bz.onMs    = onMs;
    bz.offMs   = offMs;
    bz.buzzing = false;
    bz.nextMs  = 0;  // fire immediately on next tick
}

void setupLoRa();
void setupOLED();
void setLED(bool r, bool g, bool b);
void beep(int n, int ms = 100);
void processLora(const String& pkt);
void processWsMessage(const String& msg);
void showNotif(const char* title, const char* msg, int durationMs = 7000);
void updateDisplay();
void drawStatusBar();
void drawPage0_Vitals();
void drawPage1_Gateway();
void drawPage2_LoRa();
void drawPage3_Dispenser();
void drawPage4_GPS();
void drawEmergency();
void drawNotification();
String uptimeStr();

// ── WebSocket callback ────────────────────────────────────────────
void wsEvent(WStype_t type, uint8_t* payload, size_t len) {
    if (type == WStype_CONNECTED) {
        wsConnected = true;
        ws.sendTXT("{\"type\":\"identify\",\"node\":\"GATEWAY\"}");
        Serial.println("[WS] Connected");
    } else if (type == WStype_DISCONNECTED) {
        wsConnected = false;
        Serial.println("[WS] Disconnected");
    } else if (type == WStype_TEXT) {
        wsPush(String((char*)payload));  // queue — never overwrites unprocessed messages
    }
}

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
    bootMs = millis();
    Serial.begin(115200);

    pinMode(PIN_LED_R, OUTPUT);
    pinMode(PIN_LED_G, OUTPUT);
    pinMode(PIN_LED_B, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    setLED(false, false, true);  // Blue = booting

    setupOLED();

    // Boot screen
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_7x14B_tr);
    u8g2.drawStr(10, 22, "AyuLink");
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(18, 36, "Gateway v3.0");
    u8g2.drawStr(22, 50, "Starting...");
    u8g2.sendBuffer();
    delay(1200);

    // LoRa
    setupLoRa();

    // WiFi — retry loop (never gives up)
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);

    auto tryWifi = [&]() {
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(0, 12, "Connecting WiFi:");
        u8g2.drawStr(0, 26, WIFI_SSID);
        u8g2.sendBuffer();

        WiFi.begin(WIFI_SSID, WIFI_PASS);
        int retry = 0;
        while (WiFi.status() != WL_CONNECTED && retry < 40) {  // 20s
            delay(500);
            retry++;
            // Blink display dot so user sees progress
            if (retry % 4 == 0) {
                char dots[8] = "";
                for (int d = 0; d < (retry / 4) % 4; d++) strcat(dots, ".");
                u8g2.clearBuffer();
                u8g2.setFont(u8g2_font_6x10_tr);
                u8g2.drawStr(0, 12, "Connecting WiFi:");
                u8g2.drawStr(0, 26, WIFI_SSID);
                u8g2.drawStr(0, 42, dots);
                u8g2.sendBuffer();
            }
        }
    };

    tryWifi();

    // If still not connected — reset and retry once more
    if (WiFi.status() != WL_CONNECTED) {
        setLED(true, false, false);
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(0, 20, "WiFi retry...");
        u8g2.sendBuffer();
        WiFi.disconnect(true);
        delay(2000);
        tryWifi();
    }

    if (WiFi.status() == WL_CONNECTED) {
        setLED(false, true, false);
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(0, 14, "WiFi Connected!");
        u8g2.drawStr(0, 28, WiFi.localIP().toString().c_str());
        char rssiStr[24];
        snprintf(rssiStr, 24, "RSSI: %d dBm", WiFi.RSSI());
        u8g2.drawStr(0, 42, rssiStr);
        u8g2.sendBuffer();
        beep(2, 80);
        delay(1200);
    } else {
        // Still failed — continue anyway so WS auto-reconnects when WiFi comes up
        setLED(true, false, false);
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(0, 14, "WiFi FAIL");
        u8g2.drawStr(0, 28, "Will retry via WS");
        u8g2.drawStr(0, 42, "Check: WiFi/wordpass");
        u8g2.sendBuffer();
        beep(3, 200);
        delay(2000);
    }

    // WebSocket
    ws.begin(WS_HOST, WS_PORT, WS_PATH);
    ws.onEvent(wsEvent);
    ws.setReconnectInterval(5000);
    ws.enableHeartbeat(30000, 10000, 3);  // ping every 15s, pong timeout 3s, 2 retries
    // This stops the backend from closing the idle connection every ~60s

    beep(2, 80);
    Serial.println("[READY] AyuLink Gateway online");
}

// ── Loop ──────────────────────────────────────────────────────────
void loop() {
    ws.loop();
    buzzerTick();      // non-blocking buzzer
    tickLoRaRetry();   // retry queued LoRa downlinks (notifications to wristband)

    // Process all pending WS messages (queue — never drops notifications)
    String msg;
    while (wsPop(msg)) {
        processWsMessage(msg);
    }

    // LoRa receive
    int pkSize = LoRa.parsePacket();
    if (pkSize) {
        String pkt = "";
        while (LoRa.available()) pkt += (char)LoRa.read();
        totalPkts++;
        processLora(pkt);
    }

    // Page auto-rotate (only when no emergency/notif)
    bool emergency = (vit.sos && millis()-sosTime < EMERGENCY_MS) ||
                     (vit.fall && millis()-fallTime < EMERGENCY_MS) ||
                     (vit.tremor && millis()-fallTime < EMERGENCY_MS);
    if (!emergency && !notif.active && millis() - lastPageFlip > PAGE_INTERVAL_MS) {
        page = (page + 1) % PAGES;
        lastPageFlip = millis();
        updateDisplay();
    }

    // Expire notification
    if (notif.active && millis() > notif.expiry) {
        notif.active = false;
        updateDisplay();
    }

    // Auto clear emergency flag after timeout
    if (vit.sos  && millis()-sosTime  >= EMERGENCY_MS) vit.sos  = false;
    if (vit.fall && millis()-fallTime >= EMERGENCY_MS) vit.fall = false;
    if (vit.tremor && millis()-fallTime >= EMERGENCY_MS) vit.tremor = false;

    // SOS/FALL: instant buzzer — no blocking
    if (vit.sos || vit.fall || vit.tremor || hub.flame) {
        static bool strobe = false;
        static unsigned long lastStrobe = 0;
        if (millis()-lastStrobe > 300) {
            strobe = !strobe;
            lastStrobe = millis();
            digitalWrite(PIN_LED_R, strobe ? HIGH : LOW);
            digitalWrite(PIN_LED_G, LOW);
            digitalWrite(PIN_LED_B, LOW);
        }
    } else if (wsConnected) {
        setLED(false, true, false);
        digitalWrite(PIN_BUZZER, LOW);
    } else {
        setLED(true, false, false);
    }

    // Refresh display at ~2Hz
    static unsigned long lastDraw = 0;
    if (millis() - lastDraw > 500) {
        lastDraw = millis();
        updateDisplay();
    }
}

// ── Process LoRa packet from wristband ───────────────────────────
void processLora(const String& pkt) {
    Serial.print("[LoRa RX] "); Serial.println(pkt);
    JsonDocument doc;
    if (deserializeJson(doc, pkt)) return;

    vit.hr   = doc["hr"]   | vit.hr;
    vit.spo2 = doc["oxy"]  | vit.spo2;
    vit.temp = doc["temp"] | vit.temp;
    vit.worn = doc["worn"] | vit.worn;
    vit.lat  = doc["lat"]  | vit.lat;
    vit.lng  = doc["lng"]  | vit.lng;
    vit.loraRssi = LoRa.packetRssi();
    vit.lastRx = millis();

    bool newSos  = doc["sos"]  | false;
    bool newFall = doc["fall"] | false;
    bool newTremor = doc["tremor"] | false;

    bool suppressed = (millis() - alertClearTime < 5000); // 5s grace after dismiss
    if (newSos && !suppressed) {
        if (!vit.sos) {
            // New alert event
            totalAlerts++;
            beepAsync(3, 200);
            showNotif("!! SOS ALERT !!", "Patient needs help!", EMERGENCY_MS);
        }
        vit.sos = true;
        sosTime = millis(); // Refresh timer to keep screen locked
        page = 0;
    }
    if (newTremor && !suppressed) {
        if (!vit.tremor) {
            // New FIDS event — distinct from fall
            totalAlerts++;
            beepAsync(3, 150);
            showNotif("!! FIDS ALERT !!", "Tremor detected!", EMERGENCY_MS);
        }
        vit.tremor = true;
        fallTime = millis(); // Use fallTime for OLED display timer
        page = 0;
    }
    else if (newFall && !suppressed) {
        if (!vit.fall) {
            // New fall event
            totalAlerts++;
            beepAsync(3, 150);
            showNotif("!! FALL DETECTED", "Ramulu Goud fell!", EMERGENCY_MS);
        }
        vit.fall = true;
        fallTime = millis(); // Refresh timer to keep screen locked
        page = 0;
    }

    // Forward to backend (includes tremor field)
    String fwd = pkt;
    ws.sendTXT(fwd);
}

// ── Process WebSocket message from backend ───────────────────────
void processWsMessage(const String& msg) {
    Serial.print("[WS-IN] "); Serial.println(msg);
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, msg);
    if (error) {
        Serial.print("[WS-ERR] JSON parse failed: ");
        Serial.println(error.c_str());
        return;
    }

    const char* type = doc["type"] | "";

    // Hub data broadcast from backend
    if (strcmp(type, "hub") == 0 || doc["hub_data"]) {
        hub.temp     = doc["hub_temp"]     | hub.temp;
        hub.humidity = doc["hub_humidity"] | hub.humidity;
        hub.airPpm   = doc["hub_air_ppm"]  | hub.airPpm;
        hub.flame    = doc["hub_flame"]    | hub.flame;
        hub.received = true;
        const char* aq = doc["hub_aqi"] | hub.aqi;
        strncpy(hub.aqi, aq, 15);
        const char* rt = doc["rtc_time"] | hub.rtcTime;
        if (rt) strncpy(hub.rtcTime, rt, 11);

        for (int i = 0; i < 4; i++) {
            char key[16]; sprintf(key, "hub_slot%d", i+1);
            hub.slot[i] = doc[key] | hub.slot[i];
        }

        // Flame alert — INSTANT: update OLED first, then beep async
        if (hub.flame) {
            totalAlerts++;
            showNotif("!! FIRE ALERT !!", "Flame at Dispenser!", EMERGENCY_MS);
            updateDisplay();  // immediate screen update
            beepAsync(8, 150, 50);  // fast urgent pattern
            setLED(true, false, false);
            // Forward compact flame alert to wristband
            scheduleLoRaDownlink("{\"cmd\":\"notification\",\"title\":\"FIRE\",\"notif\":\"Fire at hub!\"}", 5);
        }

        // Forward compact hub data to wristband (updates page 1)
        char loraPkt[100];
        snprintf(loraPkt, sizeof(loraPkt),
            "{\"type\":\"h\",\"t\":%.1f,\"h\":%.0f,\"a\":%d,\"f\":%d,\"q\":\"%s\",\"s1\":%d,\"s2\":%d,\"s3\":%d,\"s4\":%d}",
            hub.temp, hub.humidity, hub.airPpm, hub.flame ? 1 : 0, hub.aqi,
            hub.slot[0], hub.slot[1], hub.slot[2], hub.slot[3]);
        // Throttle hub data LoRa to wristband — every 10s max, force=false
        // so emergency messages (SOS/Fall/FIDS) ALWAYS take priority
        if (millis() - lastHubLoRaMs >= HUB_LORA_INTERVAL_MS) {
            lastHubLoRaMs = millis();
            scheduleLoRaDownlink(loraPkt, 2, false); 
        }

        return;
    }

    // ── EMERGENCY command from backend (fall/SOS confirmed) ──
    // Triggers full-screen emergency on gateway OLED + buzzer
    const char* cmd = doc["cmd"] | "";
    if (strcmp(cmd, "emergency") == 0) {
        const char* etype = doc["type"] | "fall";  // "fall" or "sos"
        if (strcmp(etype, "sos") == 0) {
            vit.sos = true;
            sosTime = millis();
        } else {
            vit.fall = true;
            fallTime = millis();
        }
        totalAlerts++;
        beepAsync(5, 150, 60);     // urgent 5 beeps
        updateDisplay();           // immediately show emergency screen
        Serial.printf("[EMERGENCY] Backend confirmed: %s\n", etype);

        // Forward to wristband too
        scheduleLoRaDownlink(msg.c_str(), 5, true);
    }
    // Notification command from backend/dashboard
    else if (strcmp(cmd, "notification") == 0 || doc["notif"]) {
        const char* title = doc["title"] | "ALERT";
        const char* body  = doc["notif"] | doc["msg"] | "";
        showNotif(title, body, 8000);
        updateDisplay();   // instant OLED update — no delay
        beepAsync(3, 120, 80);

        // ── SCHEDULE NOTIFICATION TO WRISTBAND WITH RETRIES ──
        // Wristband TX fires every 2s — retry 3x at 2.5s gaps to guarantee delivery
        char loraPkt[100];
        snprintf(loraPkt, sizeof(loraPkt),
            "{\"cmd\":\"notification\",\"notif\":\"%.*s\"}",
            50, body);
        scheduleLoRaDownlink(loraPkt, 3, true);  // FORCE=true to override Hub telemetry!
        Serial.printf("[NOTIF] Queued for wristband (x3): %s\n", loraPkt);
    }
    if (strcmp(cmd, "clear") == 0) {
        notif.active = false;
        vit.sos  = false;
        vit.fall = false;
        vit.tremor = false;
        bz.total = 0;                   // cancel all pending beeps
        bz.buzzing = false;
        digitalWrite(PIN_BUZZER, LOW);  // mute instantly
        alertClearTime = millis();      // 5s suppress window — wristband has time to receive clear
        sosTime  = 0;                   // reset emergency timers
        fallTime = 0;
        updateDisplay();
        
        // ── FORWARD CLEAR TO WRISTBAND OVER LORA ──
        scheduleLoRaDownlink("{\"cmd\":\"clear\"}", 5, true);
        Serial.println("[CLEAR] Dashboard dismiss — queued for wristband");
    }
}

// ── Show notification overlay ─────────────────────────────────────
void showNotif(const char* title, const char* msg, int durationMs) {
    strncpy(notif.title, title, 31);
    strncpy(notif.msg,   msg,   63);
    notif.active = true;
    notif.expiry = millis() + durationMs;
    updateDisplay();
}

// ── OLED Render ───────────────────────────────────────────────────
void updateDisplay() {
    u8g2.clearBuffer();

    bool sos_active  = vit.sos  && millis()-sosTime  < EMERGENCY_MS;
    bool fall_active = vit.fall && millis()-fallTime < EMERGENCY_MS;

    if (sos_active || fall_active) {
        drawEmergency();
    } else if (notif.active && millis() < notif.expiry) {
        drawNotification();
    } else {
        drawStatusBar();
        switch (page) {
            case 0: drawPage0_Vitals();    break;
            case 1: drawPage1_Gateway();   break;
            case 2: drawPage2_LoRa();      break;
            case 3: drawPage3_Dispenser(); break;
            case 4: drawPage4_GPS();       break;
        }
        // Page dots
        int dotStartX = 64 - (PAGES * 6) / 2;
        for (int i = 0; i < PAGES; i++) {
            int dx = dotStartX + i * 6;
            if (i == page) u8g2.drawDisc(dx, 62, 2);
            else           u8g2.drawCircle(dx, 62, 2);
        }
    }

    u8g2.sendBuffer();
}

void drawStatusBar() {
    // Top bar
    u8g2.setDrawColor(1);
    u8g2.drawBox(0, 0, 128, 10);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_5x7_tr);
    // Time from hub RTC
    u8g2.drawStr(1, 8, hub.rtcTime);
    // WiFi + WS status
    char status[20];
    snprintf(status, 20, "%s %s",
        WiFi.status()==WL_CONNECTED ? "W" : "-",
        wsConnected ? "WS" : "--");
    u8g2.drawStr(80, 8, status);
    u8g2.setDrawColor(1);
}

void drawPage0_Vitals() {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 20, "PATIENT 108 - RAMULU");
    u8g2.drawHLine(0, 22, 128);

    // HR large
    u8g2.setFont(u8g2_font_logisoso16_tr);
    char buf[20];
    if (vit.hr > 0) {
        snprintf(buf, 20, "%d", vit.hr);
        u8g2.drawStr(0, 42, buf);
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(36, 42, "BPM");
    } else {
        u8g2.drawStr(0, 42, "--");
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(36, 42, "BPM");
    }

    // SpO2
    u8g2.setFont(u8g2_font_logisoso16_tr);
    if (vit.spo2 > 0) snprintf(buf, 20, "%d%%", vit.spo2);
    else               snprintf(buf, 20, "-%%");
    u8g2.drawStr(72, 42, buf);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(72, 50, "SpO2");

    // Worn + alert badges
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 55, vit.worn ? "[ON]" : "[OFF]");
    if (vit.sos)    u8g2.drawStr(40, 55, "SOS!");
    if (vit.tremor) u8g2.drawStr(70, 55, "FIDS!");
    else if (vit.fall)  u8g2.drawStr(70, 55, "FALL!");

    // Signal age
    if (vit.lastRx > 0) {
        unsigned long age = (millis() - vit.lastRx) / 1000;
        char ageBuf[16]; snprintf(ageBuf, 16, "%lus ago", age);
        u8g2.setFont(u8g2_font_5x7_tr);
        u8g2.drawStr(90, 55, ageBuf);
    }
}

void drawPage1_Gateway() {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 20, "GATEWAY STATUS");
    u8g2.drawHLine(0, 22, 128);
    char buf[32];
    snprintf(buf, 32, "WiFi: %s", WiFi.status()==WL_CONNECTED ? "OK" : "FAIL");
    u8g2.drawStr(0, 34, buf);
    snprintf(buf, 32, "WS:   %s", wsConnected ? "LIVE" : "DISC");
    u8g2.drawStr(0, 44, buf);
    snprintf(buf, 32, "Up:   %s", uptimeStr().c_str());
    u8g2.drawStr(0, 54, buf);
}

void drawPage2_LoRa() {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 20, "LoRa RADIO STATS");
    u8g2.drawHLine(0, 22, 128);
    char buf[32];
    snprintf(buf, 32, "RSSI:  %d dBm", vit.loraRssi);
    u8g2.drawStr(0, 34, buf);
    snprintf(buf, 32, "Pkts:  %d", totalPkts);
    u8g2.drawStr(0, 44, buf);
    snprintf(buf, 32, "Alrts: %d", totalAlerts);
    u8g2.drawStr(0, 54, buf);
}

void drawPage3_Dispenser() {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 20, hub.flame ? "!! FIRE ALERT !!" : "DISPENSER STATUS");
    u8g2.drawHLine(0, 22, 128);
    char buf[32];
    if (!hub.received) {
        u8g2.drawStr(0, 40, "Waiting for hub...");
        return;
    }
    snprintf(buf, 32, "T:%.1fC H:%.0f%%", hub.temp, hub.humidity);
    u8g2.drawStr(0, 33, buf);
    snprintf(buf, 32, "Air: %dPPM %s", hub.airPpm, hub.aqi);
    u8g2.drawStr(0, 43, buf);
    // Pill slots
    char slots[20] = ""; 
    for (int i = 0; i < 4; i++) strcat(slots, hub.slot[i] ? "[+]" : "[ ]");
    u8g2.drawStr(0, 53, slots);
}

void drawPage4_GPS() {
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(0, 20, "PATIENT LOCATION");
    u8g2.drawHLine(0, 22, 128);
    char buf[32];
    snprintf(buf, 32, "Lat: %.4f", vit.lat);
    u8g2.drawStr(0, 34, buf);
    snprintf(buf, 32, "Lng: %.4f", vit.lng);
    u8g2.drawStr(0, 44, buf);
    u8g2.drawStr(0, 54, "Hanamkonda, WGL");
}

void drawEmergency() {
    u8g2.setDrawColor(1);
    u8g2.drawBox(0, 0, 128, 64);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_logisoso16_tr);
    const char* label;
    if (vit.tremor) label = "!! FIDS !!";
    else if (vit.fall) label = "!! FALL !!";
    else label = "!! SOS !!";
    int x = (128 - u8g2.getStrWidth(label)) / 2;
    u8g2.drawStr(x, 28, label);
    u8g2.setFont(u8g2_font_6x10_tr);
    u8g2.drawStr(15, 44, "RAMULU GOUD P108");
    u8g2.drawStr(10, 56, "HELP IS ON THE WAY");
    u8g2.setDrawColor(1);
}

void drawNotification() {
    u8g2.drawBox(0, 0, 128, 10);
    u8g2.setDrawColor(0);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(2, 8, notif.title);
    u8g2.setDrawColor(1);
    u8g2.setFont(u8g2_font_6x10_tr);
    // Word wrap — 21 chars per line at 6px
    char line1[22] = {0}; char line2[22] = {0}; char line3[22] = {0};
    int l = strlen(notif.msg);
    strncpy(line1, notif.msg,                     min(21, l));
    if (l > 21) strncpy(line2, notif.msg + 21,    min(21, l-21));
    if (l > 42) strncpy(line3, notif.msg + 42,    min(21, l-42));
    u8g2.drawStr(0, 22, line1);
    u8g2.drawStr(0, 33, line2);
    u8g2.drawStr(0, 44, line3);
    // Countdown bar
    if (notif.expiry > millis()) {
        int dur = 8000;
        long rem = (long)(notif.expiry - millis());
        int barW = map(constrain(rem, 0, dur), 0, dur, 0, 128);
        u8g2.drawBox(0, 58, barW, 5);
    }
}

// ── Helpers ───────────────────────────────────────────────────────
void setupLoRa() {
    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
    LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
    if (!LoRa.begin(433E6)) {
        Serial.println("[LoRa] INIT FAILED");
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_6x10_tr);
        u8g2.drawStr(0, 30, "LoRa FAILED!");
        u8g2.sendBuffer();
        delay(2000);
    } else {
        LoRa.setSpreadingFactor(10);
        LoRa.setSignalBandwidth(125E3);
        LoRa.setCodingRate4(5);
        LoRa.enableCrc();
        LoRa.receive(); // start in RX mode immediately
        Serial.println("[LoRa] OK — 433MHz SF10");
    }
}

void setupOLED() {
    u8g2.begin();
    u8g2.setContrast(200);
}

void setLED(bool r, bool g, bool b) {
    digitalWrite(PIN_LED_R, r);
    digitalWrite(PIN_LED_G, g);
    digitalWrite(PIN_LED_B, b);
}

// Legacy blocking beep kept for setup only (WiFi connect sounds)
void beep(int n, int ms) {
    for (int i = 0; i < n; i++) {
        digitalWrite(PIN_BUZZER, HIGH); delay(ms);
        digitalWrite(PIN_BUZZER, LOW);
        if (i < n-1) delay(60);
    }
}

String uptimeStr() {
    unsigned long s = (millis() - bootMs) / 1000;
    char buf[16];
    if (s < 60) snprintf(buf, 16, "%lus", s);
    else if (s < 3600) snprintf(buf, 16, "%lum%lus", s/60, s%60);
    else snprintf(buf, 16, "%luh%lum", s/3600, (s%3600)/60);
    return String(buf);
}
