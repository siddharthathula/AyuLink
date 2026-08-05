"use client"

import { useEffect, useRef } from 'react'
import { useDemoMode } from '@/lib/demo-context'
import { playAlertSound } from '@/lib/alert-sound'

// Mock Data Generators
const PATIENTS = [
    { name: 'Ravi Kumar', village: 'Shadnagar', age: 70 },
    { name: 'Sunita Devi', village: 'Shamshabad', age: 62 },
    { name: 'Maria Fernandes', village: 'Chevella', age: 68 },
    { name: 'Ismail Khan', village: 'Ibrahimpatnam', age: 75 },
    { name: 'Lakshmi Rao', village: 'Maheshwaram', age: 58 }
]

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Navigation, Play, UserPlus } from 'lucide-react'
import { generateDemoPatients } from '@/lib/demo-data'


export default function DemoSimulator() {
    const { isDemoMode } = useDemoMode()
    const intervalRef = useRef<NodeJS.Timeout | null>(null)
    const moveIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const criticalTimerRef = useRef<NodeJS.Timeout | null>(null)
    const [demoState, setDemoState] = useState<{ active: boolean, lat: number, lng: number } | null>(null)

    useEffect(() => {
        if (!isDemoMode) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (criticalTimerRef.current) clearTimeout(criticalTimerRef.current)
            return
        }

        const demoPatients = generateDemoPatients()

        const emitRandomVital = () => {
            const patient = demoPatients[Math.floor(Math.random() * demoPatients.length)]
            // Background data stays normal; emergency alerts require an intentional demo action.
            const isCritical = false

            // WEAR DETECTION LOGIC (90% chance worn)
            const isWorn = Math.random() > 0.1

            const hr = isWorn
                ? (isCritical ? 100 + Math.floor(Math.random() * 40) : 60 + Math.floor(Math.random() * 40))
                : 0

            const spo2 = isWorn
                ? (isCritical ? 85 + Math.floor(Math.random() * 5) : 94 + Math.floor(Math.random() * 6))
                : 0

            const temp = isWorn
                ? 36 + Math.random() * 1.5
                : 0

            // Emit standard vital event
            const event = new CustomEvent('vitals-update', {
                detail: {
                    deviceId: patient.id,
                    patientName: patient.name,
                    hr,
                    spo2,
                    temp: parseFloat(temp.toFixed(1)),
                    isWorn,
                    lat: patient.lat,
                    lng: patient.lng,
                    status: isWorn ? (isCritical ? 'critical' : 'normal') : 'offline',
                    isDemo: true
                }
            })
            window.dispatchEvent(event)

            // Emit emergency state (Low Chance)
            if (isCritical) {
                const emergencyEvent = new CustomEvent('emergency-state', {
                    detail: {
                        type: 'sos', // Explicit Text
                        active: true,
                        deviceId: patient.id,
                        patientName: patient.name,
                        hr: 100 + Math.floor(Math.random() * 40),
                        spo2: 85 + Math.floor(Math.random() * 10),
                        lat: patient.lat,
                        lng: patient.lng,
                        history: Array.from({ length: 60 }).map((_, i) => ({
                            timestamp: Date.now() - (59 - i) * 1000,
                            lat: patient.lat - 0.005 + (i * 0.0001),
                            lng: patient.lng - 0.005 + (i * 0.0001),
                            hr: 100 + Math.floor(Math.random() * 40),
                            spo2: 85 + Math.floor(Math.random() * 10),
                            status: 'critical'
                        }))
                    }
                })
                window.dispatchEvent(emergencyEvent)
            }
        }

        // Listen for manual triggers from Settings Modal
        const handleJury = () => startJuryDemo()
        const handleSOS = () => {
            window.dispatchEvent(new CustomEvent('emergency-state', {
                detail: {
                    type: 'sos',
                    active: true,
                    deviceId: 'DEMO-MANUAL',
                    patientName: 'Manual SOS Patient',
                    hr: 125,
                    spo2: 87,
                    lat: 17.4485,
                    lng: 78.3490,
                    history: Array.from({ length: 60 }).map((_, i) => ({
                        timestamp: Date.now() - (59 - i) * 1000,
                        lat: 17.4485 - 0.001 + (i * 0.00002),
                        lng: 78.3490 - 0.001 + (i * 0.00002),
                        hr: 110 + Math.floor(Math.random() * 20),
                        spo2: 88 + Math.floor(Math.random() * 5),
                        status: 'critical'
                    }))
                }
            }))
        }

        // Listen for manual emergency simulation trigger
        const handleSimulateEmergency = () => fireCriticalAlert()

        window.addEventListener('trigger-jury-demo', handleJury)
        window.addEventListener('trigger-manual-sos', handleSOS)
        window.addEventListener('trigger-simulate-emergency', handleSimulateEmergency)

        // Emit random vitals every 5 seconds for visual density (normal vitals only)
        intervalRef.current = setInterval(emitRandomVital, 5000)

        // One deliberate preview proves the emergency path when demo data is enabled.
        // It runs once per activation; all later emergencies are manual.
        criticalTimerRef.current = setTimeout(fireCriticalAlert, 1500)

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (criticalTimerRef.current) clearTimeout(criticalTimerRef.current)
            window.removeEventListener('trigger-jury-demo', handleJury)
            window.removeEventListener('trigger-manual-sos', handleSOS)
            window.removeEventListener('trigger-simulate-emergency', handleSimulateEmergency)
        }
    }, [isDemoMode])

    // ── Fire a critical LowOxygen alert for demo ──
    const fireCriticalAlert = () => {
        playAlertSound()
        // Dispatch vitals-update with critical values
        window.dispatchEvent(new CustomEvent('vitals-update', {
            detail: {
                deviceId: 'DEMO-CRITICAL-001',
                patientName: 'Sayamma Rao',
                hr: 135,
                spo2: 82,
                temp: 37.1,
                status: 'critical',
                isDemo: true,
                lat: 17.4447,
                lng: 78.3483,
            }
        }))

        // Dispatch emergency-state for fullscreen banner
        window.dispatchEvent(new CustomEvent('emergency-state', {
            detail: {
                type: 'sos',
                active: true,
                deviceId: 'DEMO-CRITICAL-001',
                patientName: 'Sayamma Rao',
                hr: 135,
                spo2: 82,
                lat: 17.4447,
                lng: 78.3483,
                history: Array.from({ length: 60 }).map((_, i) => ({
                    timestamp: Date.now() - (59 - i) * 1000,
                    lat: 17.4447 - 0.002 + (i * 0.00005),
                    lng: 78.3483 - 0.002 + (i * 0.00005),
                    hr: 120 + Math.floor(Math.random() * 20),
                    spo2: 80 + Math.floor(Math.random() * 5),
                    status: 'critical'
                }))
            }
        }))
    }

    const startJuryDemo = () => {
        const startLat = 17.4447
        const startLng = 78.3483
        const patientName = "Demo Patient (Jury)"

        // 1. Initial SOS
        const emergencyEvent = new CustomEvent('emergency-state', {
            detail: {
                type: 'sos',
                active: true,
                deviceId: 'DEMO-JURY-1',
                patientName: patientName,
                hr: 115,
                spo2: 89,
                lat: startLat,
                lng: startLng,
                history: Array.from({ length: 60 }).map((_, i) => ({
                    timestamp: Date.now() - (59 - i) * 1000,
                    lat: startLat - 0.002 + (i * 0.00005), // Simulated path approaching current location
                    lng: startLng - 0.002 + (i * 0.00005),
                    hr: 100 + Math.floor(Math.random() * 20),
                    spo2: 90 + Math.floor(Math.random() * 5),
                    status: 'critical'
                }))
            }
        })
        window.dispatchEvent(emergencyEvent)

        // 2. Start Movement Simulation
        let step = 0
        if (moveIntervalRef.current) clearInterval(moveIntervalRef.current)

        moveIntervalRef.current = setInterval(async () => {
            step++
            const nextLat = startLat + (step * 0.0002)
            const nextLng = startLng + (step * 0.00015)

            // Broadcast to Supabase & Local
            const update = {
                deviceId: 'DEMO-JURY-1',
                patientName,
                lat: nextLat,
                lng: nextLng,
                hr: 115 + Math.floor(Math.random() * 5),
                spo2: 89 + Math.floor(Math.random() * 2)
            }

            // Global Broadcast
            supabase.channel('ayulink_emergency').send({
                type: 'broadcast',
                event: 'location-update',
                payload: update
            })

            // Local Event
            window.dispatchEvent(new CustomEvent('location-update', { detail: update }))

            if (step > 50) {
                if (moveIntervalRef.current) clearInterval(moveIntervalRef.current)
            }
        }, 2000)
    }

    return null // Buttons removed from bottom-left corner per user request
}
