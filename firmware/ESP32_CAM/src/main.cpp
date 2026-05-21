#include <WiFi.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ─── WiFi Credentials ───────────────────────────────────────────────────────
const char* ssid     = "WiFi";
const char* password = "wordpass";

// ─── AI Thinker ESP32-CAM Pin Definitions ────────────────────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE =
    "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART     =
    "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;

// ─── MJPEG Stream Handler ────────────────────────────────────────────────────
static esp_err_t stream_handler(httpd_req_t* req) {
    camera_fb_t* fb = NULL;
    esp_err_t    res = ESP_OK;
    size_t       _jpg_buf_len;
    uint8_t*     _jpg_buf;
    char         part_buf[64];

    res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
    if (res != ESP_OK) return res;

    // Allow cross-origin so the browser dashboard can show the feed
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    while (true) {
        fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("Camera capture failed – retrying");
            delay(100);
            continue;   // don't disconnect; just skip this frame
        }

        if (fb->format != PIXFORMAT_JPEG) {
            // Convert non-JPEG frames
            bool ok = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
            esp_camera_fb_return(fb);
            fb = NULL;
            if (!ok) { res = ESP_FAIL; break; }
        } else {
            _jpg_buf_len = fb->len;
            _jpg_buf     = fb->buf;
        }

        // Send multipart boundary
        if (res == ESP_OK)
            res = httpd_resp_send_chunk(req,
                      _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));

        // Send part header
        if (res == ESP_OK) {
            size_t hlen = snprintf(part_buf, sizeof(part_buf),
                                   _STREAM_PART, _jpg_buf_len);
            res = httpd_resp_send_chunk(req, part_buf, hlen);
        }

        // Send JPEG data
        if (res == ESP_OK)
            res = httpd_resp_send_chunk(req,
                      (const char*)_jpg_buf, _jpg_buf_len);

        if (fb) { esp_camera_fb_return(fb); fb = NULL; }
        else    { free(_jpg_buf); }

        if (res != ESP_OK) break;
    }
    return res;
}

// ─── Root Handler (health check) ─────────────────────────────────────────────
static esp_err_t root_handler(httpd_req_t* req) {
    const char* html =
        "<html><body style='font-family:sans-serif'>"
        "<h2>AyuLink ESP32-CAM</h2>"
        "<p>Stream: <a href='/stream'>/stream</a></p>"
        "</body></html>";
    httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

// ─── Start HTTP Server ───────────────────────────────────────────────────────
void startCameraServer() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port        = 81;
    config.max_uri_handlers   = 4;
    config.stack_size         = 8192;

    httpd_uri_t stream_uri = {
        .uri      = "/stream",
        .method   = HTTP_GET,
        .handler  = stream_handler,
        .user_ctx = NULL
    };
    httpd_uri_t root_uri = {
        .uri      = "/",
        .method   = HTTP_GET,
        .handler  = root_handler,
        .user_ctx = NULL
    };

    if (httpd_start(&stream_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(stream_httpd, &stream_uri);
        httpd_register_uri_handler(stream_httpd, &root_uri);
        Serial.println("HTTP server started on port 81");
    } else {
        Serial.println("Failed to start HTTP server!");
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // disable brownout

    Serial.begin(115200);
    Serial.setDebugOutput(false);
    Serial.println();

    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0 = Y2_GPIO_NUM; config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM; config.pin_d3 = Y5_GPIO_NUM;
    config.pin_d4 = Y6_GPIO_NUM; config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM; config.pin_d7 = Y9_GPIO_NUM;
    config.pin_xclk    = XCLK_GPIO_NUM;
    config.pin_pclk    = PCLK_GPIO_NUM;
    config.pin_vsync   = VSYNC_GPIO_NUM;
    config.pin_href    = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn    = PWDN_GPIO_NUM;
    config.pin_reset   = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    config.grab_mode    = CAMERA_GRAB_LATEST;

    // With PSRAM: higher res + double buffer; without: safe fallback
    if (psramFound()) {
        Serial.println("PSRAM found – using VGA (640x480)");
        config.frame_size   = FRAMESIZE_VGA;   // 640x480 – good balance
        config.jpeg_quality = 12;              // lower = better quality (10-63)
        config.fb_count     = 2;
        config.fb_location  = CAMERA_FB_IN_PSRAM;
    } else {
        Serial.println("No PSRAM – using QVGA");
        config.frame_size   = FRAMESIZE_QVGA;  // 320x240 – always works
        config.jpeg_quality = 15;
        config.fb_count     = 1;
        config.fb_location  = CAMERA_FB_IN_DRAM;
    }

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("Camera init FAILED: 0x%x\n", err);
        // Blink the built-in LED as error indicator
        pinMode(4, OUTPUT);
        while (true) { digitalWrite(4, HIGH); delay(200); digitalWrite(4, LOW); delay(200); }
    }
    Serial.println("Camera initialised OK");

    // Flip image if upside-down
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
        s->set_vflip(s, 1);    // vertical flip
        s->set_hmirror(s, 1);  // horizontal mirror = 180° rotation
        s->set_brightness(s, 1);
        s->set_saturation(s, 0);
    }

    // Connect WiFi
    WiFi.begin(ssid, password);
    WiFi.setSleep(false);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println();
    Serial.println("WiFi connected");

    startCameraServer();

    Serial.printf("Camera Stream Ready!  Go to: http://%s:81/stream\n",
                  WiFi.localIP().toString().c_str());
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
    delay(10000); // nothing to do – HTTP server runs in its own task
}
