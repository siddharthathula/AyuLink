'use client'

import { useState, useEffect, useRef } from 'react'
import {
    Heart, Activity, Thermometer, Droplets, MapPin, Phone,
    Bell, Clock, Pill, Shield, Users, MessageSquare, Calendar,
    CheckCircle, AlertTriangle, Wifi, Battery, Sun, Cloud, Camera, Video
} from 'lucide-react'
import SchemeEligibility from '@/components/SchemeEligibility'

// Mock family view data - simulating a logged-in family member viewing their elderly relative
const familyMember = {
    name: 'Rahul Kumar',
    relation: 'Son',
    patient: {
        id: 'P-001',
        name: 'Rajesh Kumar',
        age: 68,
        gender: 'Male',
        village: 'Hanamkonda',
        photo: null,
        conditions: ['Diabetes', 'Hypertension'],
        deviceStatus: 'online',
        deviceBattery: 78,
        lastSync: '2 mins ago',
        ashaWorker: { name: 'Priya Sharma', phone: '+91 98765 43220' },
        phcDoctor: { name: 'Dr. Sharma', phone: '+91 98765 43221' },
        currentVitals: {
            heartRate: { value: 78, status: 'normal', time: '2 mins ago' },
            spo2: { value: 96, status: 'normal', time: '2 mins ago' },
            temperature: { value: 36.8, status: 'normal', time: '15 mins ago' },
            bp: { value: '128/82', status: 'normal', time: '1 hour ago' },
            steps: { value: 2340, goal: 5000 }
        },
        medications: [
            { name: 'Metformin 500mg', time: '8:00 AM', status: 'taken', nextDose: '8:00 PM' },
            { name: 'Amlodipine 5mg', time: '8:00 AM', status: 'taken', nextDose: 'Tomorrow 8:00 AM' },
        ],
        recentActivity: [
            { type: 'vital', message: 'Morning BP check completed', time: '1 hour ago', icon: Activity },
            { type: 'medication', message: 'Morning medications taken', time: '3 hours ago', icon: Pill },
            { type: 'activity', message: 'Morning walk - 1.2km', time: '4 hours ago', icon: MapPin },
            { type: 'checkup', message: 'ASHA visit completed', time: 'Yesterday', icon: Users },
        ],
        upcomingAppointments: [
            { type: 'PHC Visit', date: 'Feb 10, 2026', time: '10:00 AM', doctor: 'Dr. Sharma' },
            { type: 'BP Camp', date: 'Feb 15, 2026', time: '9:00 AM', location: 'Rampur Community Center' },
        ],
        weatherAlert: { temp: '28°C', condition: 'Sunny', advice: 'Good weather for outdoor walk' }
    }
}

export default function FamilyPortalPage() {
    const [showCallbackModal, setShowCallbackModal] = useState(false)
    const [camUrl, setCamUrl] = useState<string>('')
    const [camConnected, setCamConnected] = useState(false)
    const [camEditing, setCamEditing] = useState(false)
    // Live vitals from WebSocket
    const [liveHr, setLiveHr] = useState(familyMember.patient.currentVitals.heartRate.value)
    const [liveSpo2, setLiveSpo2] = useState(familyMember.patient.currentVitals.spo2.value)
    const [liveTemp, setLiveTemp] = useState(familyMember.patient.currentVitals.temperature.value)
    const [liveFall, setLiveFall] = useState(false)
    const [liveSos, setLiveSos] = useState(false)
    const [livePatient, setLivePatient] = useState(familyMember.patient)
    const wsRef = useRef<WebSocket | null>(null)
    const { patient } = livePatient === familyMember.patient ? familyMember : { patient: livePatient }

    useEffect(() => {
        // Set cam URL dynamically so it works from any device on the network
        if (typeof window !== 'undefined') {
            setCamUrl(`http://${window.location.hostname}:8000/api/stream`)
        }

        // Fetch real primary patient from local DB
        fetch('/api/patients').then(r => r.json()).then(d => {
            if (d.ok && d.patients?.[0]) {
                const p = d.patients[0]
                setLivePatient({
                    ...familyMember.patient,
                    id: p.id, name: p.name, age: p.age || 0,
                    village: p.village || 'Hanamkonda',
                    conditions: p.conditions || [],
                })
            }
        }).catch(() => {})

        // WebSocket for live vitals
        const wsUrl = `ws://${window.location.hostname}:8000/ws/dashboard`
        const ws = new WebSocket(wsUrl)
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data)
                if (msg.event === 'vital') {
                    const d = msg.data
                    setLiveHr(d.hr || 0)
                    setLiveSpo2(d.spo2 || 0)
                    setLiveTemp(d.temp || 0)
                    setLiveFall(d.fall || false)
                    setLiveSos(d.sos || false)
                }
                if (msg.event === 'state' && msg.data?.patients?.[0]) {
                    const p = msg.data.patients[0]
                    setLiveHr(p.hr || 0)
                    setLiveSpo2(p.spo2 || 0)
                    setLiveTemp(p.temp || 0)
                    setLiveFall(p.fall || false)
                    setLiveSos(p.sos || false)
                }
            } catch { /* ignore */ }
        }
        ws.onclose = () => { /* auto-retry handled by browser */ }
        wsRef.current = ws
        return () => ws.close()
    }, [])

    const statusColors: { [key: string]: string } = {
        normal: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
        warning: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
        critical: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
    }

    const handleRequestCallback = (type: string) => {
        alert(`✅ Callback Request Sent!\n\nA ${type} will call you within 30 minutes.\n\nYour contact: +91 98765 43214`)
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-500 to-emerald-500 rounded-2xl p-5 text-white">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-bold">
                            {livePatient.name.charAt(0)}
                        </div>
                        <div>
                            <p className="text-sm text-teal-100">Monitoring</p>
                            <h1 className="text-2xl font-bold">{livePatient.name}</h1>
                            <p className="text-sm text-teal-100">{livePatient.age} yrs • {livePatient.village}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="flex items-center gap-2 text-sm mb-1">
                            <Wifi className="h-4 w-4" />
                            <span className="font-medium">Device Online</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-teal-100">
                            <Battery className="h-4 w-4" />
                            <span>{patient.deviceBattery}% battery</span>
                        </div>
                        <p className="text-xs text-teal-100 mt-1">Last sync: {patient.lastSync}</p>
                    </div>
                </div>
            </div>

            {/* SOS / Fall Alert Banners */}
            {liveSos && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/40 animate-pulse">
                    <AlertTriangle className="h-6 w-6 text-red-400 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-black text-red-400">🆘 SOS BUTTON PRESSED</p>
                        <p className="text-xs text-red-400/70">{livePatient.name} pressed the emergency button. Paramedic alerted.</p>
                    </div>
                </div>
            )}
            {liveFall && !liveSos && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40">
                    <AlertTriangle className="h-6 w-6 text-amber-400 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-black text-amber-400">⚠️ FALL DETECTED</p>
                        <p className="text-xs text-amber-400/70">{livePatient.name} may have fallen. Please check immediately.</p>
                    </div>
                </div>
            )}

            {/* Weather Advisory */}
            <div className="card p-3 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-3">
                    <Sun className="h-8 w-8 text-amber-500" />
                    <div>
                        <span className="text-lg font-bold text-amber-700 dark:text-amber-300">{patient.weatherAlert.temp}</span>
                        <span className="text-sm text-amber-600 dark:text-amber-400 ml-2">{patient.weatherAlert.condition}</span>
                    </div>
                </div>
                <p className="text-sm text-amber-700 dark:text-amber-300">💡 {patient.weatherAlert.advice}</p>
            </div>

            {/* ESP32-CAM Live Feed */}
            <div className="card p-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Video className="h-4 w-4 text-blue-500" />
                        Live Room Camera
                    </h2>
                </div>

                {/* Stream */}
                <div className="relative bg-black flex justify-center items-center overflow-hidden mx-auto" style={{ height: 360, maxWidth: 640, borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <img 
                        src={camUrl} 
                        className="w-full h-full object-contain"
                        alt="Live Camera Feed"
                        onLoad={() => setCamConnected(true)}
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            setCamConnected(false);
                        }}
                    />
                    {!camConnected && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}>
                            <Camera className="h-12 w-12 mb-3 opacity-30 text-white" />
                            <p className="text-white text-sm font-semibold">Connecting to camera...</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Vitals - Main Focus */}
                <div className="lg:col-span-2 card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            <Heart className="h-5 w-5 text-red-500" />
                            Live Health Status
                        </h2>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                            liveSos ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 animate-pulse' :
                            liveFall ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                            liveHr >= 60 && liveHr <= 100 && liveSpo2 >= 95 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}>
                            {liveSos ? '🆘 SOS Active' : liveFall ? '⚠️ Fall Detected' : '✓ Monitoring Live'}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Heart Rate */}
                        <div className={`p-4 rounded-xl ${statusColors[liveHr >= 60 && liveHr <= 100 ? 'normal' : 'warning']}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <Heart className="h-5 w-5" />
                                <span className="text-xs font-medium">Heart Rate</span>
                            </div>
                            <p className="text-3xl font-bold">{liveHr}</p>
                            <p className="text-xs opacity-75">bpm • live</p>
                        </div>

                        {/* SpO2 */}
                        <div className={`p-4 rounded-xl ${statusColors[liveSpo2 >= 95 ? 'normal' : liveSpo2 >= 90 ? 'warning' : 'critical']}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <Droplets className="h-5 w-5" />
                                <span className="text-xs font-medium">Oxygen</span>
                            </div>
                            <p className="text-3xl font-bold">{liveSpo2}%</p>
                            <p className="text-xs opacity-75">SpO2 • live</p>
                        </div>

                        {/* Fall Status */}
                        <div className={`p-4 rounded-xl ${liveFall ? statusColors['warning'] : statusColors['normal']}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="h-5 w-5" />
                                <span className="text-xs font-medium">Fall Detect</span>
                            </div>
                            <p className="text-2xl font-bold">{liveFall ? '⚠️' : '✓'}</p>
                            <p className="text-xs opacity-75">{liveFall ? 'DETECTED' : 'No fall'}</p>
                        </div>

                        {/* Temperature */}
                        <div className={`p-4 rounded-xl ${statusColors[liveTemp >= 36 && liveTemp <= 38 ? 'normal' : 'warning']}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <Thermometer className="h-5 w-5" />
                                <span className="text-xs font-medium">Temperature</span>
                            </div>
                            <p className="text-3xl font-bold">{liveTemp > 0 ? liveTemp.toFixed(1) : patient.currentVitals.temperature.value}°</p>
                            <p className="text-xs opacity-75">Celsius • live</p>
                        </div>
                    </div>

                    {/* Daily Steps */}
                    <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Daily Steps</span>
                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{patient.currentVitals.steps.value} / {patient.currentVitals.steps.goal}</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
                            <div
                                className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full transition-all"
                                style={{ width: `${(patient.currentVitals.steps.value / patient.currentVitals.steps.goal) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Medications */}
                <div className="card p-5">
                    <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Pill className="h-5 w-5 text-purple-500" />
                        Today's Medications
                    </h2>
                    <div className="space-y-3">
                        {patient.medications.map((med, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${med.status === 'taken' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                                        {med.status === 'taken' ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{med.name}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            {med.status === 'taken' ? `✓ Taken at ${med.time}` : `Next: ${med.nextDose}`}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Recent Activity */}
                <div className="card p-5">
                    <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Clock className="h-5 w-5 text-blue-500" />
                        Recent Activity
                    </h2>
                    <div className="space-y-3">
                        {patient.recentActivity.map((activity, i) => (
                            <div key={i} className="flex items-start gap-3">
                                <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
                                    <activity.icon className="h-4 w-4 text-gray-500" />
                                </div>
                                <div>
                                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{activity.message}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{activity.time}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Upcoming Appointments */}
                <div className="card p-5">
                    <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Calendar className="h-5 w-5 text-teal-500" />
                        Upcoming Appointments
                    </h2>
                    <div className="space-y-3">
                        {patient.upcomingAppointments.map((apt, i) => (
                            <div key={i} className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{apt.type}</span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">{apt.time}</span>
                                </div>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{apt.date}</p>
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{apt.doctor || apt.location}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Contact & Actions */}
                <div className="card p-5">
                    <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Phone className="h-5 w-5 text-emerald-500" />
                        Contact Care Team
                    </h2>
                    <div className="space-y-3">
                        {/* ASHA Worker */}
                        <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{patient.ashaWorker.name}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>ASHA Worker</p>
                                </div>
                                <button
                                    onClick={() => handleRequestCallback('ASHA Worker')}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-white hover:bg-teal-600 transition-colors"
                                >
                                    Request Call
                                </button>
                            </div>
                        </div>

                        {/* PHC Doctor */}
                        <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{patient.phcDoctor.name}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>PHC Doctor</p>
                                </div>
                                <button
                                    onClick={() => handleRequestCallback('Doctor')}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                                >
                                    Request Call
                                </button>
                            </div>
                        </div>

                        {/* Emergency */}
                        <button
                            onClick={() => { if (confirm('This will trigger an emergency alert. Continue?')) alert('🚨 Emergency alert sent to PHC!') }}
                            className="w-full py-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center justify-center gap-2 font-medium"
                        >
                            <AlertTriangle className="h-5 w-5" />
                            Report Emergency
                        </button>
                    </div>
                </div>
            </div>

            {/* Government Scheme Eligibility */}
            <SchemeEligibility patient={{
                age: patient.age,
                conditions: patient.conditions,
                bplCard: true,
                income: 'low'
            }} />

            {/* Footer Note */}
            <div className="card p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                    <Shield className="h-4 w-4 inline mr-1" />
                    Your loved one is being monitored 24/7 by AyuLink. You will receive instant alerts for any health concerns.
                </p>
            </div>
        </div>
    )
}
