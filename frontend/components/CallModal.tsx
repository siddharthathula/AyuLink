'use client'

import { useState } from 'react'
import { X, Phone, User, Users, Stethoscope, Heart, PhoneCall, PhoneOff } from 'lucide-react'

interface CallModalProps {
    isOpen: boolean
    onClose: () => void
    patient: {
        name: string
        phone: string
        emergencyContact?: string
    }
    ashaWorker?: { name: string; phone: string }
    doctor?: { name: string; phone: string }
}

export default function CallModal({ isOpen, onClose, patient, ashaWorker, doctor }: CallModalProps) {
    const [calling, setCalling] = useState<string | null>(null)
    const [callDuration, setCallDuration] = useState(0)

    const callOptions = [
        {
            id: 'patient',
            label: 'Call Patient',
            name: patient.name,
            phone: patient.phone,
            icon: User,
            color: 'from-blue-500 to-cyan-500'
        },
        patient.emergencyContact ? {
            id: 'family',
            label: 'Call Family',
            name: 'Emergency Contact',
            phone: patient.emergencyContact,
            icon: Users,
            color: 'from-purple-500 to-pink-500'
        } : null,
        ashaWorker ? {
            id: 'asha',
            label: 'Call ASHA Worker',
            name: ashaWorker.name,
            phone: ashaWorker.phone,
            icon: Heart,
            color: 'from-emerald-500 to-teal-500'
        } : null,
        doctor ? {
            id: 'doctor',
            label: 'Call Doctor',
            name: doctor.name,
            phone: doctor.phone,
            icon: Stethoscope,
            color: 'from-red-500 to-rose-500'
        } : null,
    ].filter(Boolean)

    const handleCall = (option: typeof callOptions[0]) => {
        if (!option) return

        // For demo purposes, simulate a call
        setCalling(option.id)

        // Start duration counter
        const startTime = Date.now()
        const timer = setInterval(() => {
            setCallDuration(Math.floor((Date.now() - startTime) / 1000))
        }, 1000)

        // Open phone app on mobile
        window.location.href = `tel:${option.phone}`

        // Clear timer on unmount
        return () => clearInterval(timer)
    }

    const endCall = () => {
        setCalling(null)
        setCallDuration(0)
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="card max-w-md w-full rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                {/* Header */}
                <div className="p-5 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500">
                            <Phone className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>Make a Call</h2>
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select contact to call</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                    </button>
                </div>

                {/* Call In Progress View */}
                {calling && (
                    <div className="p-8 text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center animate-pulse">
                            <PhoneCall className="h-10 w-10 text-white" />
                        </div>
                        <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            Calling {callOptions.find(o => o?.id === calling)?.name}...
                        </p>
                        <p className="text-2xl font-mono mb-4" style={{ color: 'var(--text-primary)' }}>
                            {formatDuration(callDuration)}
                        </p>
                        <button
                            onClick={endCall}
                            className="px-8 py-3 rounded-full bg-red-500 text-white font-bold flex items-center gap-2 mx-auto hover:bg-red-600 transition-colors"
                        >
                            <PhoneOff className="h-5 w-5" />
                            End Call
                        </button>
                    </div>
                )}

                {/* Contact Options */}
                {!calling && (
                    <div className="p-4 space-y-2">
                        {callOptions.map((option) => option && (
                            <button
                                key={option.id}
                                onClick={() => handleCall(option)}
                                className="w-full flex items-center gap-4 p-4 rounded-xl transition-all hover:scale-[1.02] group"
                                style={{ background: 'var(--bg-primary)' }}
                            >
                                <div className={`p-3 rounded-xl bg-gradient-to-br ${option.color}`}>
                                    <option.icon className="h-5 w-5 text-white" />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{option.label}</p>
                                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{option.name}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{option.phone}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Quick Call Footer */}
                {!calling && (
                    <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                            Calls will open your phone's dialer app
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
