'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Heart, Droplets, Activity, Thermometer, Brain, Zap, MapPin, Upload, Camera, Sparkles } from 'lucide-react'
import WebcamCapture from './WebcamCapture'
import VillageSearchInput from './VillageSearchInput'

interface Sensor { id: string; name: string; icon: any; description: string; enabled: boolean }

interface AddPatientModalProps {
    isOpen: boolean
    onClose: () => void
    editPatient?: any
    onSave?: (patientData: any) => void
    onAdd?: (patientData: any) => void
}

const languages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'hi', name: 'हिंदी (Hindi)', flag: '🇮🇳' },
    { code: 'te', name: 'తెలుగు (Telugu)', flag: '🇮🇳' },
    { code: 'ta', name: 'தமிழ் (Tamil)', flag: '🇮🇳' },
    { code: 'kn', name: 'ಕನ್ನಡ (Kannada)', flag: '🇮🇳' },
    { code: 'mr', name: 'मराठी (Marathi)', flag: '🇮🇳' },
]

const EMPTY_FORM = {
    name: '', age: '', gender: 'male', phone: '', address: '',
    bloodGroup: '', allergies: '', emergencyContact: '',
    language: 'en', village: '', deviceId: '', abhaId: '',
    rationCardType: 'APL', familyHeadName: '', conditions: '',
}

export default function AddPatientModal({ isOpen, onClose, editPatient, onSave, onAdd }: AddPatientModalProps) {
    const [formData, setFormData] = useState({ ...EMPTY_FORM })
    const [avatarUrl, setAvatarUrl] = useState('')
    const [showCamera, setShowCamera] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [saving, setSaving] = useState(false)

    const [sensors, setSensors] = useState<Sensor[]>([
        { id: 'max30102', name: 'MAX30102', icon: Heart, description: 'Heart Rate + SpO2', enabled: true },
        { id: 'mpu6050', name: 'MPU6050', icon: Activity, description: 'Fall Detection + Activity', enabled: true },
        { id: 'mlx90614', name: 'MLX90614', icon: Thermometer, description: 'IR Temperature', enabled: true },
        { id: 'ad8232', name: 'AD8232', icon: Droplets, description: 'ECG Monitoring', enabled: false },
        { id: 'gsr', name: 'GSR Sensor', icon: Brain, description: 'Stress Level', enabled: false },
        { id: 'gps', name: 'NEO-6M GPS', icon: MapPin, description: 'Location Tracking', enabled: true },
    ])

    useEffect(() => {
        if (editPatient) {
            setFormData({
                name: editPatient.name || '', age: editPatient.age || '',
                gender: editPatient.gender || 'male', phone: editPatient.phone || '',
                address: editPatient.address || '', bloodGroup: editPatient.bloodGroup || '',
                allergies: Array.isArray(editPatient.allergies) ? editPatient.allergies.join(', ') : editPatient.allergies || '',
                emergencyContact: editPatient.emergencyContact || '',
                language: editPatient.language || 'en', village: editPatient.village || '',
                deviceId: editPatient.deviceId || '', abhaId: editPatient.abhaId || '',
                rationCardType: editPatient.rationCardType || 'APL',
                familyHeadName: editPatient.familyHeadName || '',
                conditions: Array.isArray(editPatient.conditions) ? editPatient.conditions.join(', ') : editPatient.conditions || '',
            })
            setAvatarUrl(editPatient.avatarUrl || '')
        } else {
            setFormData({ ...EMPTY_FORM })
            setAvatarUrl('')
        }
        setValidationError('')
    }, [editPatient, isOpen])

    const toggleSensor = (id: string) =>
        setSensors(s => s.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x))

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.name.trim()) { setValidationError('Please fill in the patient name'); return }
        if (!formData.age) { setValidationError('Please fill in the patient age'); return }
        if (!formData.phone.trim()) { setValidationError('Please fill in the phone number'); return }
        if (formData.phone.replace(/\D/g, '').length !== 10) { setValidationError('Phone number must be exactly 10 digits'); return }
        if (!formData.village) { setValidationError('Please select a village'); return }
        setValidationError('')
        setSaving(true)
        const patientData = {
            ...formData, avatarUrl,
            sensors: sensors.filter(s => s.enabled).map(s => s.id),
            allergies: formData.allergies ? formData.allergies.split(',').map(a => a.trim()) : [],
            conditions: formData.conditions ? formData.conditions.split(',').map(c => c.trim()) : [],
            status: 'normal', lastActive: 'Just now',
        }
        try {
            if (onSave) await onSave(patientData)
            else if (onAdd) await onAdd(patientData)
            else { alert(`✅ Patient ${editPatient ? 'Updated' : 'Added'}!\n\nName: ${formData.name}`); onClose() }
        } catch (err: any) {
            setValidationError(err?.message || 'Failed to save patient. Is the backend running?')
        } finally {
            setSaving(false)
        }
    }

    const [mounted, setMounted] = useState(false)
    useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
    if (!isOpen || !mounted) return null

    // ── Shared style tokens ──────────────────────────────────────────────────────
    const inputStyle: React.CSSProperties = {
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        outline: 'none',
        width: '100%',
        padding: '10px 16px',
        borderRadius: '12px',
        fontSize: '0.875rem',
        fontWeight: 500,
        transition: 'border-color 0.2s',
    }
    const labelStyle: React.CSSProperties = {
        display: 'block',
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: '6px',
        color: 'var(--text-muted)',
    }

    const onFocus = (e: React.FocusEvent<any>) => { e.currentTarget.style.borderColor = '#14b8a6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(20,184,166,0.15)' }
    const onBlur = (e: React.FocusEvent<any>) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none' }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-start justify-center z-[9999] p-4 pt-6 overflow-y-auto">
            <div className="rounded-2xl shadow-2xl max-w-7xl w-full my-4 animate-fadeIn overflow-hidden relative"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>

                {/* ── Header ── */}
                <div className="sticky top-0 z-10 px-8 py-5 flex items-center justify-between"
                    style={{
                        background: 'linear-gradient(90deg, rgba(20,184,166,0.08) 0%, rgba(16,185,129,0.05) 100%)',
                        borderBottom: '1px solid var(--border-color)',
                        backdropFilter: 'blur(12px)',
                    }}>
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            {editPatient ? <Zap className="h-6 w-6 text-teal-400" /> : <Sparkles className="h-6 w-6 text-teal-400" />}
                            {editPatient ? 'Edit Patient Profile' : 'Register New Patient'}
                        </h2>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                            {editPatient ? 'Update patient details and sensor configuration' : 'Enroll a new patient into the AyuLink mesh network'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl transition-all hover:bg-red-500/10 group">
                        <X className="h-6 w-6 text-slate-400 group-hover:text-red-400 transition-colors" />
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="p-4 sm:p-8 max-h-[80vh] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-color) transparent' }}>
                    <form onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                            {/* LEFT: Photo + Network Identity */}
                            <div className="lg:col-span-1 space-y-6">

                                {/* Photo */}
                                <div className="flex flex-col items-center">
                                    {showCamera ? (
                                        <div className="w-full rounded-2xl p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Take Photo</h3>
                                                <button type="button" onClick={() => setShowCamera(false)} className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors">Cancel</button>
                                            </div>
                                            <WebcamCapture onImageCaptured={(url) => { setAvatarUrl(url); setShowCamera(false) }} />
                                        </div>
                                    ) : (
                                        <div className="relative group cursor-pointer" onClick={() => setShowCamera(true)}>
                                            <div className={`w-40 h-40 rounded-full overflow-hidden flex items-center justify-center transition-all group-hover:border-teal-400`}
                                                style={{
                                                    border: avatarUrl ? '4px solid #14b8a6' : '3px dashed var(--border-color)',
                                                    background: 'var(--bg-secondary)',
                                                    boxShadow: avatarUrl ? '0 0 30px rgba(20,184,166,0.25)' : 'none',
                                                }}>
                                                {avatarUrl
                                                    ? <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                                                    : <Camera className="h-10 w-10 text-slate-500 group-hover:text-teal-400 transition-colors" />}
                                            </div>
                                            <div className="absolute bottom-2 right-2 p-2 bg-teal-500 rounded-full text-white shadow-lg group-hover:scale-110 transition-transform">
                                                <Upload className="h-4 w-4" />
                                            </div>
                                        </div>
                                    )}
                                    <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                                        {avatarUrl ? 'Click to retake' : 'Tap to take photo'}
                                    </p>
                                </div>

                                {/* Network Identity */}
                                <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                                    <label style={{ ...labelStyle, color: 'var(--text-muted)' }}>Network Identity</label>
                                    <div>
                                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>LoRa Device MAC</label>
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-sm font-bold text-teal-400"
                                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                                            <Zap className="h-3 w-3 flex-shrink-0" />
                                            <input
                                                value={formData.deviceId}
                                                onChange={e => setFormData({ ...formData, deviceId: e.target.value })}
                                                placeholder="00:00:00:00"
                                                className="bg-transparent outline-none w-full text-teal-400 placeholder:text-slate-600"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>ABHA Health ID</label>
                                        <input
                                            value={formData.abhaId}
                                            onChange={e => setFormData({ ...formData, abhaId: e.target.value })}
                                            placeholder="XX-XXXX-XXXX-XXXX"
                                            onFocus={onFocus} onBlur={onBlur}
                                            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT: Demographics + Sensors */}
                            <div className="lg:col-span-2 space-y-8">

                                {/* Demographics */}
                                <section>
                                    <h3 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                                        <span className="w-1 h-4 bg-teal-500 rounded-full inline-block" />
                                        Demographics
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        <div className="col-span-2">
                                            <label style={labelStyle}>Full Name</label>
                                            <input type="text" required style={inputStyle}
                                                value={formData.name} placeholder="e.g. Ramesh Kumar"
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Age</label>
                                            <input type="number" required style={inputStyle}
                                                value={formData.age}
                                                onChange={e => setFormData({ ...formData, age: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Gender</label>
                                            <select style={{ ...inputStyle, appearance: 'none' as any }}
                                                value={formData.gender}
                                                onChange={e => setFormData({ ...formData, gender: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur}>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                        <div className="col-span-2">
                                            <label style={labelStyle}>Phone Number</label>
                                            <input type="tel" required style={inputStyle}
                                                value={formData.phone} placeholder="10-digit mobile number"
                                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Language</label>
                                            <select style={{ ...inputStyle, appearance: 'none' as any }}
                                                value={formData.language}
                                                onChange={e => setFormData({ ...formData, language: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur}>
                                                {languages.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-span-3">
                                            <label style={labelStyle}>Village / Area</label>
                                            <VillageSearchInput value={formData.village}
                                                onChange={v => setFormData({ ...formData, village: v })}
                                                placeholder="Search village..." />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Blood Group</label>
                                            <select style={{ ...inputStyle, appearance: 'none' as any }}
                                                value={formData.bloodGroup}
                                                onChange={e => setFormData({ ...formData, bloodGroup: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur}>
                                                <option value="">Select</option>
                                                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Ration Card</label>
                                            <select style={{ ...inputStyle, appearance: 'none' as any }}
                                                value={formData.rationCardType}
                                                onChange={e => setFormData({ ...formData, rationCardType: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur}>
                                                <option value="APL">APL</option>
                                                <option value="BPL">BPL</option>
                                                <option value="AAY">AAY</option>
                                                <option value="None">None</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Family Head</label>
                                            <input type="text" style={inputStyle}
                                                value={formData.familyHeadName} placeholder="e.g. Ramesh / Self"
                                                onChange={e => setFormData({ ...formData, familyHeadName: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div className="col-span-3">
                                            <label style={labelStyle}>Allergies (comma-separated)</label>
                                            <input type="text" style={inputStyle}
                                                value={formData.allergies} placeholder="e.g. Penicillin, Peanuts"
                                                onChange={e => setFormData({ ...formData, allergies: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div className="col-span-3">
                                            <label style={labelStyle}>Medical Conditions (comma-separated)</label>
                                            <input type="text" style={inputStyle}
                                                value={formData.conditions} placeholder="e.g. Hypertension, Diabetes"
                                                onChange={e => setFormData({ ...formData, conditions: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                        <div className="col-span-3">
                                            <label style={labelStyle}>Emergency Contact</label>
                                            <input type="tel" style={inputStyle}
                                                value={formData.emergencyContact} placeholder="Emergency phone number"
                                                onChange={e => setFormData({ ...formData, emergencyContact: e.target.value })}
                                                onFocus={onFocus} onBlur={onBlur} />
                                        </div>
                                    </div>
                                </section>

                                {/* Sensor Modules */}
                                <section>
                                    <h3 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                                        <span className="w-1 h-4 bg-purple-500 rounded-full inline-block" />
                                        Active Sensor Modules
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {sensors.map(sensor => (
                                            <div key={sensor.id} onClick={() => toggleSensor(sensor.id)}
                                                className="relative p-4 rounded-xl cursor-pointer transition-all duration-200 select-none"
                                                style={sensor.enabled
                                                    ? { background: 'linear-gradient(135deg,#14b8a6,#10b981)', border: '2px solid transparent', boxShadow: '0 4px 20px rgba(20,184,166,0.25)', transform: 'scale(1.02)' }
                                                    : { background: 'var(--bg-secondary)', border: '2px solid var(--border-color)' }}>
                                                <div className="flex items-center gap-4">
                                                    <div className="p-3 rounded-lg"
                                                        style={sensor.enabled
                                                            ? { background: 'rgba(255,255,255,0.2)' }
                                                            : { background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
                                                        <sensor.icon className="h-5 w-5" style={sensor.enabled ? { color: '#fff' } : { color: 'var(--text-muted)' }} />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-sm" style={{ color: sensor.enabled ? '#fff' : 'var(--text-primary)' }}>{sensor.name}</h4>
                                                        <p className="text-xs mt-0.5" style={{ color: sensor.enabled ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)' }}>{sensor.description}</p>
                                                    </div>
                                                    {sensor.enabled && (
                                                        <div className="absolute top-3 right-3 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }}>
                                                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        </div>

                        {/* ── Footer ── */}
                        <div className="mt-8 pt-6 flex items-center justify-between relative" style={{ borderTop: '1px solid var(--border-color)' }}>
                            {validationError && (
                                <p className="text-sm text-red-400 font-medium flex items-center gap-1.5">
                                    <span>⚠️</span> {validationError}
                                </p>
                            )}
                            {!editPatient && !validationError && (
                                <button type="button"
                                    onClick={() => setFormData({
                                        name: 'Rajeshwari Devi', age: '68', gender: 'female', phone: '9876543210',
                                        address: 'House No. 12, Nalgonda', bloodGroup: 'O+', allergies: 'None',
                                        emergencyContact: '9876543222', language: 'te', village: 'Nalgonda',
                                        deviceId: 'LORA_01', abhaId: '91-2345-6789-0123', rationCardType: 'BPL',
                                        familyHeadName: 'Self', conditions: 'Hypertension',
                                    })}
                                    className="text-xs font-bold flex items-center gap-1.5 transition-colors"
                                    style={{ color: 'var(--text-muted)' }}
                                    onMouseEnter={e => (e.currentTarget.style.color = '#14b8a6')}
                                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                                    <Zap className="h-3 w-3" /> Auto-fill Demo Data
                                </button>
                            )}
                            <div className="flex gap-3 ml-auto">
                                <button type="button" onClick={onClose} disabled={saving}
                                    className="px-6 py-2.5 rounded-xl font-bold transition-all disabled:opacity-50"
                                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}>
                                    Cancel
                                </button>
                                <button type="submit" disabled={saving}
                                    className="px-8 py-2.5 rounded-xl font-bold text-white flex items-center gap-2 transition-all disabled:opacity-70 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                                    style={{ background: 'linear-gradient(135deg,#14b8a6,#10b981)', boxShadow: '0 4px 20px rgba(20,184,166,0.3)' }}>
                                    {saving && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />}
                                    {saving ? 'Saving...' : editPatient ? 'Save Changes' : 'Register Patient'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>,
        document.body
    )
}
