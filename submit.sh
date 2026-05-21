#!/bin/bash
# === AYULINK FINAL SUBMISSION BUILDER ===
# Run: bash submit.sh
set -e

echo "🏥 AyuLink Submission Builder — FightClub"
echo "==========================================="

ROOT="$(cd "$(dirname "$0")" && pwd)"
MEDIA="/home/siddhartha/Desktop/AyuLink/AyuLink"

# 1. Photos
echo "[1/4] Processing hardware photos..."
mkdir -p "$ROOT/photos" "$ROOT/screenshots" "$ROOT/demo-videos"

# Resize hardware photos
for f in "$MEDIA"/IMG*.jpg; do
  [ -f "$f" ] && convert "$f" -resize 1200x -quality 85 "$ROOT/photos/$(basename "$f")" 2>/dev/null
done
cd "$ROOT/photos"
[ -f IMG20260521131147.jpg ] && mv IMG20260521131147.jpg wristband_sensor_strap.jpg
[ -f IMG20260521131245.jpg ] && mv IMG20260521131245.jpg wristband_oled_mpu6050.jpg
[ -f IMG20260521131442.jpg ] && mv IMG20260521131442.jpg gateway_lora_oled.jpg
[ -f IMG20260521131447.jpg ] && mv IMG20260521131447.jpg gateway_full_view.jpg
[ -f IMG20260521132430.jpg ] && mv IMG20260521132430.jpg esp32_cam_module.jpg

# WhatsApp hero images
WA="$MEDIA/dk/WhatsApp Unknown 2026-05-21 at 1.48.52 PM"
[ -d "$WA" ] && {
  cp "$WA/WhatsApp Image 2026-05-21 at 1.48.35 PM.jpeg" "$ROOT/photos/full_hardware_setup.jpg" 2>/dev/null
  cp "$WA/WhatsApp Image 2026-05-21 at 1.48.36 PM.jpeg" "$ROOT/photos/fids_detection_alert.jpg" 2>/dev/null
  cp "$WA/WhatsApp Image 2026-05-21 at 1.48.36 PM (1).jpeg" "$ROOT/photos/fall_detection_alert.jpg" 2>/dev/null
  cp "$WA/WhatsApp Image 2026-05-21 at 1.48.37 PM.jpeg" "$ROOT/photos/fall_detection_hardware.jpg" 2>/dev/null
}

# 2. Screenshots
echo "[2/4] Copying screenshots..."
SS="$MEDIA/screenshots"
[ -d "$SS" ] && {
  cp "$SS/Screenshot from 2026-05-21 13-32-48.png" "$ROOT/screenshots/dashboard_main.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-33-13.png" "$ROOT/screenshots/dashboard_vitals_camera.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-33-16.png" "$ROOT/screenshots/dashboard_vitals_alerts.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-34-07.png" "$ROOT/screenshots/patients_registry.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-34-16.png" "$ROOT/screenshots/emergency_response_map.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-34-31.png" "$ROOT/screenshots/patient_records.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-35-16.png" "$ROOT/screenshots/medicine_dispensers.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-37-33.png" "$ROOT/screenshots/family_portal.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-38-18.png" "$ROOT/screenshots/telegram_bot.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-39-47.png" "$ROOT/screenshots/asha_verification.png" 2>/dev/null
  cp "$SS/Screenshot from 2026-05-21 13-40-19.png" "$ROOT/screenshots/ai_agent.png" 2>/dev/null
}

# 3. Videos (remove audio, compress)
echo "[3/4] Processing videos..."
for f in "$MEDIA"/VID*.mp4; do
  [ -f "$f" ] || continue
  name=$(basename "${f%.*}").mp4
  ffmpeg -y -i "$f" -an -vf "scale=720:-2" -c:v libx264 -crf 28 -preset fast "$ROOT/demo-videos/$name" 2>/dev/null || cp "$f" "$ROOT/demo-videos/$name"
done
cd "$ROOT/demo-videos"
[ -f VID20260521130623.mp4 ] && mv VID20260521130623.mp4 wristband_demo.mp4 2>/dev/null
[ -f VID20260521130826.mp4 ] && mv VID20260521130826.mp4 gateway_display.mp4 2>/dev/null
[ -f VID20260521131043.mp4 ] && mv VID20260521131043.mp4 lora_communication.mp4 2>/dev/null
[ -f VID20260521131359.mp4 ] && mv VID20260521131359.mp4 full_system_demo.mp4 2>/dev/null
[ -f VID_20260521_131618.mp4 ] && mv VID_20260521_131618.mp4 dashboard_walkthrough.mp4 2>/dev/null

# 4. Git
echo "[4/4] Git setup..."
cd "$ROOT"
git init 2>/dev/null || true
git add -A
git commit -m "feat: AyuLink — AI-Powered Rural Health Monitoring | HackOS-ONE 2026

Team FightClub | Siddhartha & Anirudh
Full-stack IoT + AI platform: ESP32 LoRa mesh, Groq LLaMA 3.1 triage,
Next.js dashboard, Telegram alerts, Smart pill dispenser" 2>/dev/null || true

echo ""
echo "✅ DONE! Now run:"
echo "   cd $ROOT"
echo "   git remote add origin <your-repo-url>"
echo "   git push -u origin main"
echo ""
echo "   # Deploy frontend to Vercel:"
echo "   cd frontend && vercel --prod"
