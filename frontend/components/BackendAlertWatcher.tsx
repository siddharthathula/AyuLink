"use client"

import { useEffect, useRef } from 'react'
import { playAlertSound } from '@/lib/alert-sound'

interface LiveAlert {
    id: string
    alert_type?: string
    type?: string
    severity?: string
    patient_name?: string
    patient_id?: string
    message?: string
    value?: string
    lat?: number
    lng?: number
    hr?: number
    spo2?: number
    timestamp?: number
}

const EMERGENCY_TYPES = new Set(['fall', 'sos', 'tremor', 'critical'])
const ACTIVE_WINDOW_MS = 120 * 1000

import { getBackendUrl as getCloudBackendUrl, getWsUrl as getCloudWsUrl, isVercelOrCloud } from '@/lib/backend-config'

function getBackendUrl(path: string): string {
    if (isVercelOrCloud()) return getCloudBackendUrl(path)
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    return `http://${host}:8000${path}`
}

function getWsUrl(): string | null {
    if (isVercelOrCloud()) return null
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    return `ws://${host}:8000/ws/dashboard`
}

function isEmergency(a: LiveAlert): boolean {
    const type = String(a.alert_type || a.type || '').toLowerCase()
    const sev = String(a.severity || '').toLowerCase()
    return EMERGENCY_TYPES.has(type) || sev === 'emergency' || sev === 'critical'
}

function isDismissed(id: string): boolean {
    try {
        return sessionStorage.getItem(`ayulink_dismissed_${id}`) === '1'
    } catch { return false }
}

function dispatchEmergency(a: LiveAlert, withSound: boolean) {
    window.dispatchEvent(new CustomEvent('emergency-state', {
        detail: {
            active: true,
            source: 'backend',
            type: a.alert_type || a.type,
            patientName: a.patient_name || 'Unknown',
            patientId: a.patient_id,
            message: a.message,
            lat: a.lat,
            lng: a.lng,
            hr: a.hr,
            spo2: a.spo2,
            alertId: a.id,
        }
    }))
    if (withSound) playAlertSound()
}

export default function BackendAlertWatcher() {
    const seenRef = useRef<Set<string>>(new Set())
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectRef = useRef<NodeJS.Timeout | null>(null)
    const pollRef = useRef<NodeJS.Timeout | null>(null)
    const stoppedRef = useRef(false)

    useEffect(() => {
        const seen = seenRef.current

        const handleAlert = (a: LiveAlert) => {
            if (!a || !a.id || seen.has(a.id)) return
            seen.add(a.id)
            if (!isEmergency(a)) return
            dispatchEmergency(a, true)
        }

        const prime = async () => {
            try {
                const res = await fetch(getBackendUrl('/api/live/alerts'), { cache: 'no-store' })
                const alerts: LiveAlert[] = await res.json()
                alerts.forEach((a) => a?.id && seen.add(a.id))
                const latest = alerts
                    .filter((a) => a?.id && isEmergency(a) && !isDismissed(a.id))
                    .sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0))[0]
                const nowMs = Date.now()
                if (latest && latest.timestamp && nowMs - latest.timestamp * 1000 < ACTIVE_WINDOW_MS) {
                    dispatchEmergency(latest, false)
                }
            } catch { }
        }

        const poll = async () => {
            if (stoppedRef.current) return
            try {
                const res = await fetch(getBackendUrl('/api/live/alerts'), { cache: 'no-store' })
                const alerts: LiveAlert[] = await res.json()
                alerts.forEach(handleAlert)
            } catch { }
        }

        const connectWs = () => {
            if (stoppedRef.current) return
            const wsUrl = getWsUrl()
            if (!wsUrl) return
            try {
                const ws = new WebSocket(wsUrl)
                wsRef.current = ws
                ws.onopen = () => {
                    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
                }
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data)
                        if (msg?.event === 'alert' && msg?.data) handleAlert(msg.data)
                    } catch { }
                }
                ws.onclose = () => {
                    wsRef.current = null
                    if (!stoppedRef.current && !reconnectRef.current) {
                        reconnectRef.current = setTimeout(() => { reconnectRef.current = null; connectWs() }, 5000)
                    }
                }
                ws.onerror = () => { try { ws.close() } catch { } }
            } catch { }
        }

        const start = async () => {
            await prime()
            if (stoppedRef.current) return
            connectWs()
            pollRef.current = setInterval(poll, 4000)
        }

        start()
        return () => {
            stoppedRef.current = true
            if (wsRef.current) try { wsRef.current.close() } catch { }
            if (reconnectRef.current) clearTimeout(reconnectRef.current)
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [])

    return null
}
