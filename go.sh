#!/bin/bash

# AyuLink All-In-One Launcher
# Cleans up old ports, launches Backend & Frontend, and gracefully shuts down on Ctrl+C.

echo "========================================="
echo "        AyuLink Startup Script"
echo "========================================="

# 1. Clean up old ports to prevent "Address already in use" errors
echo "[1/4] Cleaning up old ports..."
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 8000/tcp 2>/dev/null || true
sleep 1

# 2. Start Backend (uvicorn)
echo "[2/4] Starting Python Backend (Port 8000)..."
cd backend
# Use virtual environment if present
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
elif [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi
# NOTE: --reload removed intentionally — it kills WebSocket connections (Gateway, Hub)
# on every file save. Use manual restart (Ctrl+C then ./go.sh) when changing backend code.
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 3. Start Frontend (Next.js)
echo "[3/4] Starting Next.js Frontend (Port 3000)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# 4. Handle Ctrl+C for graceful shutdown
cleanup() {
    echo ""
    echo "========================================="
    echo "       Caught Ctrl+C! Shutting down..."
    echo "========================================="
    echo "Killing Backend (PID: $BACKEND_PID)..."
    kill $BACKEND_PID 2>/dev/null
    
    echo "Killing Frontend (PID: $FRONTEND_PID)..."
    kill $FRONTEND_PID 2>/dev/null
    
    # Wait for processes to actually terminate
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    
    # Final cleanup sweep just to be absolutely sure
    fuser -k 3000/tcp 2>/dev/null || true
    fuser -k 8000/tcp 2>/dev/null || true
    
    echo "All processes stopped successfully. Ports cleaned."
    exit 0
}

# Bind the cleanup function to SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo "[4/4] All systems go!"
echo ""
LAN_IP=$(hostname -I | awk '{print $1}')
echo "🚀 AyuLink is running!"
echo ""
echo "   ── Local Access ──────────────────────────────"
echo "   Frontend Dashboard : http://localhost:3000/dashboard"
echo "   Backend API        : http://localhost:8000"
echo ""
echo "   ── Network-Wide Access (for phones/tablets) ──"
echo "   📱 Dashboard       : http://${LAN_IP}:3000/dashboard"
echo "   📱 Family Portal   : http://${LAN_IP}:3000/family"
echo "   📱 Backend API     : http://${LAN_IP}:8000"
echo "   📹 Live Cam Stream : http://${LAN_IP}:8000/api/stream"
echo ""
echo "🛑 Press Ctrl+C at any time to stop everything and clean up ports."
echo ""

# Keep the script running and wait for background jobs
wait
