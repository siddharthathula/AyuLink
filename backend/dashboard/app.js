/* ═══════════════════════════════════════════════════════════
   AyuLink Dashboard — Client-side Application
   WebSocket consumer + ECG canvas + UI updates
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
let ws = null;
let patients = {};
let hubState = { air_ppm: 0, air_aqi: "Good", flame: false, pill_slot1: false, pill_slot2: false, pill_slot3: false, online: false };
let selectedPatientId = null;
let ecgData = [];
const ECG_MAX_POINTS = 300;

// ── WebSocket Connection ───────────────────────────────
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/dashboard`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateConnectionBadge('ws-badge', true, 'Agent Live');
        showToast('Connected to AyuLink Agent', 'success');
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        } catch (e) {
            console.error('Parse error:', e);
        }
    };

    ws.onclose = () => {
        updateConnectionBadge('ws-badge', false, 'Agent Offline');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
}

function handleMessage(msg) {
    switch (msg.event) {
        case 'state':
            handleFullState(msg.data);
            break;
        case 'vital':
            handleVital(msg.data);
            break;
        case 'hub':
            handleHub(msg.data);
            break;
        case 'alert':
            handleAlert(msg.data);
            break;
        case 'gateway_status':
            updateConnectionBadge('gateway-badge', msg.data.connected,
                msg.data.connected ? 'Gateway Live' : 'Gateway Offline');
            break;
        case 'hub_status':
            updateConnectionBadge('hub-badge', msg.data.connected,
                msg.data.connected ? 'Hub Live' : 'Hub Offline');
            break;
    }
}

// ── Full State Update ──────────────────────────────────
function handleFullState(state) {
    // Update stats
    const s = state.stats;
    animateNumber('stat-patients', s.patients_total);
    animateNumber('stat-online', s.patients_online);
    animateNumber('stat-alerts', s.total_alerts);
    animateNumber('stat-packets', s.total_packets);
    document.getElementById('stat-uptime').textContent = formatUptime(s.uptime);

    // Update patients
    state.patients.forEach(p => {
        patients[p.id] = p;
    });
    renderPatientCards();

    // Select first patient for ECG if none selected
    if (!selectedPatientId && state.patients.length > 0) {
        selectedPatientId = state.patients[0].id;
    }
    renderECGButtons();

    // Update hub
    if (state.hub) {
        hubState = { ...hubState, ...state.hub };
        updateHubUI();
    }

    // Update alerts
    const alertList = document.getElementById('alert-list');
    if (state.alerts && state.alerts.length > 0) {
        alertList.innerHTML = '';
        state.alerts.slice().reverse().forEach(a => addAlertToTimeline(a, false));
    }
}

// ── Individual Vital Update ────────────────────────────
function handleVital(data) {
    const pid = data.patient_id;
    if (!patients[pid]) {
        patients[pid] = { id: pid, name: `Patient ${pid}`, ...data };
    }

    // Update patient state
    patients[pid].hr = data.hr;
    patients[pid].spo2 = data.spo2;
    patients[pid].temp = data.temp;
    patients[pid].worn = data.worn;
    patients[pid].lat = data.lat;
    patients[pid].lng = data.lng;

    // Determine status
    if (!data.worn) {
        patients[pid].status = 'offline';
    } else if (data.sos || data.fall || data.hr > 120 || (data.spo2 > 0 && data.spo2 < 90)) {
        patients[pid].status = 'critical';
    } else if (data.hr > 100 || (data.spo2 > 0 && data.spo2 < 94)) {
        patients[pid].status = 'warning';
    } else {
        patients[pid].status = 'normal';
    }

    // Update ECG if this is the selected patient
    if (pid === selectedPatientId && data.hr > 0) {
        addECGBeat(data.hr);
        document.getElementById('overlay-hr').textContent = data.hr;
        document.getElementById('overlay-spo2').textContent = data.spo2 || '--';
        document.getElementById('overlay-temp').textContent = data.temp ? data.temp.toFixed(1) : '--';
    }

    // Update patient card inline
    updatePatientCardInline(pid);
}

// ── Hub Data Update ────────────────────────────────────
function handleHub(data) {
    hubState = { ...hubState, ...data, online: true };
    updateHubUI();
    updateConnectionBadge('hub-badge', true, 'Hub Live');
}

function updateHubUI() {
    // Air Quality Gauge
    const ppm = hubState.air_ppm;
    const maxPPM = 500;
    const ratio = Math.min(ppm / maxPPM, 1);
    const arcLength = 173; // Approximate arc length
    const dashArray = `${ratio * arcLength} ${arcLength}`;

    const arc = document.getElementById('aqi-arc');
    arc.setAttribute('stroke-dasharray', dashArray);

    // Color based on AQI
    let color = '#10b981';
    if (ppm >= 300) color = '#7c2d12';
    else if (ppm >= 200) color = '#991b1b';
    else if (ppm >= 150) color = '#ef4444';
    else if (ppm >= 100) color = '#f59e0b';
    else if (ppm >= 50) color = '#eab308';
    arc.setAttribute('stroke', color);

    document.getElementById('aqi-value').textContent = ppm;
    document.getElementById('aqi-value').style.color = color;
    document.getElementById('aqi-label').textContent = hubState.air_aqi;

    // Flame Status
    const flameEl = document.getElementById('flame-status');
    if (hubState.flame) {
        flameEl.className = 'flame-status danger';
        flameEl.innerHTML = '<span class="flame-icon">🔥</span><span>FIRE DETECTED!</span>';
    } else {
        flameEl.className = 'flame-status safe';
        flameEl.innerHTML = '<span class="flame-icon">🛡️</span><span>Environment Safe</span>';
    }

    // Pill Status
    updatePillStatus(1, hubState.pill_slot1);
    updatePillStatus(2, hubState.pill_slot2);
    updatePillStatus(3, hubState.pill_slot3);
}

function updatePillStatus(slot, taken) {
    const el = document.getElementById(`pill-status-${slot}`);
    if (el) {
        el.textContent = taken ? '✓ Taken' : 'Pending';
        el.className = `pill-status ${taken ? 'taken' : 'pending'}`;
    }
}

// ── Alert Handling ─────────────────────────────────────
function handleAlert(data) {
    addAlertToTimeline(data, true);
    showToast(data.message, data.severity);

    // Play sound for critical+
    if (data.severity === 'critical' || data.severity === 'emergency') {
        playAlertSound();
    }
}

function addAlertToTimeline(alert, prepend = true) {
    const list = document.getElementById('alert-list');

    // Remove "waiting" placeholder
    const placeholder = list.querySelector('.alert-item.info[style]');
    if (placeholder) placeholder.remove();

    const icons = {
        emergency: '🚨', critical: '❗', warning: '⚠️', info: 'ℹ️'
    };

    const div = document.createElement('div');
    div.className = `alert-item ${alert.severity}`;
    div.innerHTML = `
        <span class="alert-icon">${icons[alert.severity] || '🔔'}</span>
        <div class="alert-content">
            <div class="alert-message">${escapeHtml(alert.message)}</div>
            <div class="alert-time">${formatTime(alert.timestamp)}</div>
        </div>
    `;

    if (prepend) {
        list.prepend(div);
    } else {
        list.appendChild(div);
    }

    // Limit to 30 items
    while (list.children.length > 30) {
        list.removeChild(list.lastChild);
    }
}

// ── Patient Cards ──────────────────────────────────────
function renderPatientCards() {
    const grid = document.getElementById('patients-grid');
    grid.innerHTML = '';

    Object.values(patients).forEach(p => {
        const card = document.createElement('div');
        card.className = `patient-card ${p.status || 'offline'}`;
        card.id = `patient-card-${p.id}`;
        card.onclick = () => selectPatient(p.id);

        const riskScore = p.risk_score || 0;
        const riskColor = riskScore >= 70 ? '#ef4444' : riskScore >= 30 ? '#f59e0b' : '#10b981';

        card.innerHTML = `
            <div class="patient-header">
                <div class="patient-name">${escapeHtml(p.name || p.id)}</div>
                <div class="patient-status-dot ${p.status || 'offline'}"></div>
            </div>
            <div class="patient-vitals">
                <div class="patient-vital">
                    <span class="patient-vital-label">HR</span>
                    <span class="patient-vital-value" style="color: ${getHRColor(p.hr)}">${p.hr || '--'}</span>
                </div>
                <div class="patient-vital">
                    <span class="patient-vital-label">SpO2</span>
                    <span class="patient-vital-value" style="color: ${getSpO2Color(p.spo2)}">${p.spo2 ? p.spo2 + '%' : '--'}</span>
                </div>
                <div class="patient-vital">
                    <span class="patient-vital-label">Temp</span>
                    <span class="patient-vital-value">${p.temp ? p.temp.toFixed(1) + '°' : '--'}</span>
                </div>
                <div class="patient-vital">
                    <span class="patient-vital-label">Risk</span>
                    <span class="patient-vital-value" style="color: ${riskColor}">${riskScore}</span>
                </div>
            </div>
            <div class="patient-risk">
                <div class="patient-risk-fill" style="width: ${riskScore}%; background: ${riskColor}"></div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function updatePatientCardInline(pid) {
    const card = document.getElementById(`patient-card-${pid}`);
    if (!card) {
        renderPatientCards();
        return;
    }
    const p = patients[pid];
    card.className = `patient-card ${p.status || 'offline'}`;

    const values = card.querySelectorAll('.patient-vital-value');
    if (values.length >= 4) {
        values[0].textContent = p.hr || '--';
        values[0].style.color = getHRColor(p.hr);
        values[1].textContent = p.spo2 ? p.spo2 + '%' : '--';
        values[1].style.color = getSpO2Color(p.spo2);
        values[2].textContent = p.temp ? p.temp.toFixed(1) + '°' : '--';
        const rs = p.risk_score || 0;
        const rc = rs >= 70 ? '#ef4444' : rs >= 30 ? '#f59e0b' : '#10b981';
        values[3].textContent = rs;
        values[3].style.color = rc;

        const fill = card.querySelector('.patient-risk-fill');
        if (fill) {
            fill.style.width = rs + '%';
            fill.style.background = rc;
        }
    }

    const dot = card.querySelector('.patient-status-dot');
    if (dot) dot.className = `patient-status-dot ${p.status || 'offline'}`;
}

function selectPatient(pid) {
    selectedPatientId = pid;
    ecgData = [];
    renderECGButtons();
    const p = patients[pid];
    if (p) {
        document.getElementById('overlay-hr').textContent = p.hr || '--';
        document.getElementById('overlay-spo2').textContent = p.spo2 || '--';
        document.getElementById('overlay-temp').textContent = p.temp ? p.temp.toFixed(1) : '--';
    }
}

function renderECGButtons() {
    const container = document.getElementById('ecg-patient-btns');
    container.innerHTML = '';
    Object.values(patients).forEach(p => {
        const btn = document.createElement('button');
        btn.className = `ecg-patient-btn ${p.id === selectedPatientId ? 'active' : ''}`;
        btn.textContent = p.name || p.id;
        btn.onclick = () => selectPatient(p.id);
        container.appendChild(btn);
    });
}

// ── ECG Waveform Canvas ────────────────────────────────
const ecgCanvas = document.getElementById('ecg-canvas');
const ecgCtx = ecgCanvas.getContext('2d');

function resizeECGCanvas() {
    const wrap = ecgCanvas.parentElement;
    ecgCanvas.width = wrap.clientWidth * 2;
    ecgCanvas.height = wrap.clientHeight * 2;
    ecgCtx.scale(2, 2);
}
resizeECGCanvas();
window.addEventListener('resize', resizeECGCanvas);

// Generate a stylized ECG PQRST complex
function generateECGComplex(hr) {
    const points = [];
    const beatsPerFrame = hr / 60;
    const complexWidth = 60;

    // Baseline
    for (let i = 0; i < 10; i++) points.push(0);
    // P wave
    for (let i = 0; i < 8; i++) points.push(Math.sin(i / 8 * Math.PI) * 0.12);
    // PR segment
    for (let i = 0; i < 4; i++) points.push(0);
    // QRS complex
    points.push(-0.1);  // Q
    points.push(0.8 + Math.random() * 0.15);   // R (tall spike)
    points.push(-0.25); // S
    // ST segment
    for (let i = 0; i < 6; i++) points.push(0.02);
    // T wave
    for (let i = 0; i < 10; i++) points.push(Math.sin(i / 10 * Math.PI) * 0.2);
    // Baseline padding
    const paddingNeeded = Math.max(0, complexWidth - points.length);
    for (let i = 0; i < paddingNeeded; i++) points.push(0);

    return points;
}

function addECGBeat(hr) {
    const complex = generateECGComplex(hr);
    ecgData.push(...complex);
    if (ecgData.length > ECG_MAX_POINTS) {
        ecgData = ecgData.slice(ecgData.length - ECG_MAX_POINTS);
    }
}

function drawECG() {
    const w = ecgCanvas.width / 2;
    const h = ecgCanvas.height / 2;

    ecgCtx.clearRect(0, 0, w, h);

    // Grid
    ecgCtx.strokeStyle = 'rgba(99, 102, 241, 0.06)';
    ecgCtx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 20) {
        ecgCtx.beginPath();
        ecgCtx.moveTo(x, 0);
        ecgCtx.lineTo(x, h);
        ecgCtx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
        ecgCtx.beginPath();
        ecgCtx.moveTo(0, y);
        ecgCtx.lineTo(w, y);
        ecgCtx.stroke();
    }

    if (ecgData.length < 2) {
        requestAnimationFrame(drawECG);
        return;
    }

    const mid = h * 0.5;
    const amp = h * 0.35;
    const step = w / ECG_MAX_POINTS;

    // Glow effect
    ecgCtx.shadowColor = '#10b981';
    ecgCtx.shadowBlur = 8;
    ecgCtx.strokeStyle = '#10b981';
    ecgCtx.lineWidth = 1.8;
    ecgCtx.lineJoin = 'round';
    ecgCtx.lineCap = 'round';

    ecgCtx.beginPath();
    for (let i = 0; i < ecgData.length; i++) {
        const x = i * step;
        const y = mid - ecgData[i] * amp;
        if (i === 0) ecgCtx.moveTo(x, y);
        else ecgCtx.lineTo(x, y);
    }
    ecgCtx.stroke();

    // Leading dot
    if (ecgData.length > 0) {
        const lastX = (ecgData.length - 1) * step;
        const lastY = mid - ecgData[ecgData.length - 1] * amp;
        ecgCtx.shadowBlur = 15;
        ecgCtx.fillStyle = '#34d399';
        ecgCtx.beginPath();
        ecgCtx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ecgCtx.fill();
    }

    ecgCtx.shadowBlur = 0;
    requestAnimationFrame(drawECG);
}
requestAnimationFrame(drawECG);

// ── Toast Notifications ────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { emergency: '🚨', critical: '❗', warning: '⚠️', info: 'ℹ️', success: '✅' };
    toast.innerHTML = `<span>${icons[type] || '🔔'}</span><span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

// ── Sound ──────────────────────────────────────────────
function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) { /* Audio not available */ }
}

// ── Demo Controls ──────────────────────────────────────
function triggerSim(eventType) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'simulate', event: eventType, patient_id: selectedPatientId || 'P_01' }));
        showToast(`Triggered: ${eventType.toUpperCase()}`, 'warning');
    }
}

function dispenseSlot(slot) {
    fetch(`/api/dispense/${slot}`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.ok) {
                showToast(`Dispensing Slot ${slot}...`, 'success');
            } else {
                showToast(`Dispense failed: ${data.error}`, 'warning');
            }
        })
        .catch(() => showToast('Network error', 'warning'));
}

// ── Utilities ──────────────────────────────────────────
function formatUptime(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

function formatTime(timestamp) {
    if (!timestamp) return '--:--';
    const d = new Date(timestamp * 1000);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getHRColor(hr) {
    if (!hr || hr === 0) return '#64748b';
    if (hr > 120 || (hr > 0 && hr < 50)) return '#ef4444';
    if (hr > 100 || hr < 55) return '#f59e0b';
    return '#10b981';
}

function getSpO2Color(spo2) {
    if (!spo2 || spo2 === 0) return '#64748b';
    if (spo2 < 90) return '#ef4444';
    if (spo2 < 94) return '#f59e0b';
    return '#10b981';
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    const diff = target - current;
    const steps = Math.min(Math.abs(diff), 20);
    const increment = diff / steps;
    let step = 0;

    function tick() {
        step++;
        const val = step >= steps ? target : Math.round(current + increment * step);
        el.textContent = val;
        if (step < steps) requestAnimationFrame(tick);
    }
    tick();
}

function updateConnectionBadge(id, connected, text) {
    const badge = document.getElementById(id);
    const textEl = badge?.querySelector('span:last-child') || document.getElementById(id.replace('-badge', '-text'));
    const dot = badge?.querySelector('.status-dot');

    if (badge) {
        badge.className = `status-badge ${connected ? 'online' : 'offline'}`;
    }
    if (dot) {
        dot.className = `status-dot ${connected ? 'green' : 'red'}`;
    }
    if (textEl) {
        textEl.textContent = text;
    }
}

// ── Clock ──────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}
setInterval(updateClock, 1000);
updateClock();

// ── Initialize ─────────────────────────────────────────
connectWebSocket();
