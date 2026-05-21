# AyuLink Hardware Wiring Guide

This guide provides the exact pin connections for all microcontrollers and sensors in the AyuLink system.

---

## 1. Wristband Wearable (ESP32 DevKit V1)
**Firmware**: `firmware/Wrist_Band/src/wristband_main.ino`

| Component | ESP32 Pin | Connection Type | Notes |
| :--- | :--- | :--- | :--- |
| **LoRa RA-02 (SPI)** | SCK: 18, MISO: 19, MOSI: 23 | SPI | Standard SPI bus |
| **LoRa (Control)** | NSS: 5, RST: 14, DIO0: 26 | Digital | CS/Reset/Interrupt |
| **MPU6050 IMU** | SDA: 21, SCL: 22 | I2C | Motion & Fall Detection |
| **NEO-M6 GPS** | RX: 16 (GPS TX), TX: 17 (GPS RX) | UART2 | Set Serial2 to 9600 baud |
| **SOS Button** | GPIO 34 | Digital IN | Active LOW (Internal Pull-up) |
| **Pulse Sensor** | GPIO 36 (VP) | Analog IN | ADC1_CH0 |
| **Active Buzzer** | GPIO 27 | Digital OUT | Alarm feedback |
| **Status LED** | GPIO 2 | Digital OUT | On-board LED |

---

## 2. Gateway / Main Server Node (ESP32 DevKit V1)
**Firmware**: `firmware/Gateway/src/gateway_main.ino`

| Component | ESP32 Pin | Connection Type | Notes |
| :--- | :--- | :--- | :--- |
| **LoRa RA-02 (SPI)** | SCK: 18, MISO: 19, MOSI: 23 | SPI | Shared LoRa radio bus |
| **LoRa (Control)** | NSS: 5, RST: 14, DIO0: 26 | Digital | Matches Wearable config |
| **SH1106 OLED** | SDA: 21, SCL: 22 | I2C | Bedside display |
| **RGB LED (Red)** | GPIO 25 | PWM | Emergency indicator |
| **RGB LED (Green)** | GPIO 33 | PWM | System Healthy |
| **RGB LED (Blue)** | GPIO 32 | PWM | Booting/Connecting |
| **Active Buzzer** | GPIO 27 | Digital OUT | Bedside audio alarm |

---

## 3. Smart Pill Dispenser Hub (NodeMCU ESP8266)
**Firmware**: `firmware/Smart_Dispenser/src/nodemcu_hub_main.ino`

| Component | NodeMCU Pin | Connection Type | Notes |
| :--- | :--- | :--- | :--- |
| **MQ-135 Air Sensor**| A0 | Analog IN | 0-1023 range |
| **DHT11 Sensor** | D4 (GPIO 2) | Digital | Temp & Humidity |
| **Flame Sensor** | D5 (GPIO 14) | Digital IN | LOW = Flame Detected |
| **SG90 Servo** | D6 (GPIO 12) | PWM | Pill rotation motor |
| **DS3231 RTC / OLED**| D1 (SCL), D2 (SDA) | I2C | Shared I2C Bus |
| **Active Buzzer** | D7 (GPIO 13) | Digital OUT | Notification beeps |
| **Status LED** | D0 (GPIO 16) | Digital OUT | WiFi status |

---

## 4. ESP32-CAM (AI-Thinker)
**Firmware**: `firmware/ESP32_CAM/src/main.cpp`

*Most pins are reserved for the camera sensor, but here are the key ones:*

| Component | ESP32 Pin | Connection Type | Notes |
| :--- | :--- | :--- | :--- |
| **Camera Sensor** | Multiple (D0-D7) | Parallel | 2MP OV2640 |
| **Flash LED** | GPIO 4 | Digital OUT | High brightness flash |
| **I2C (Internal)** | SDA: 26, SCL: 27 | I2C | Used for camera init |

---

## Power Requirements
1.  **Wearable**: 3.7V Li-Po battery or 5V USB. Use a 3.3V regulator for the LoRa module.
2.  **Gateway/Hub**: 5V USB power supply (min 1A) to handle LoRa/Servo current spikes.
3.  **Sensors**: Most sensors in this project (MQ-135, DHT11, Flame) can run on 3.3V or 5V, but I2C pull-ups should be to 3.3V on the ESP32 boards.
