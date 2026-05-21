import { Patient } from '@/app/patients/page'

const VILLAGES = [
    'Hanamkonda', 'Warangal', 'Kazipet', 'Subedari',
    'Mulugu', 'Jangaon', 'Elkathurthy', 'Narsampet', 'Parkal',
    'Bhupalpally', 'Mahabubabad', 'Khammam', 'Dornakal', 'Palakurthi'
]

// Real GPS coordinates for each village/town in Warangal district
const VILLAGE_COORDS: Record<string, [number, number]> = {
    'Hanamkonda':    [18.0578, 79.5536],
    'Warangal':      [17.9784, 79.5941],
    'Kazipet':       [17.9666, 79.5085],
    'Subedari':      [18.0029, 79.5686],
    'Mulugu':        [18.1933, 79.9418],
    'Jangaon':       [17.7231, 79.1547],
    'Elkathurthy':   [18.0025, 79.8003],
    'Narsampet':     [17.9267, 79.9014],
    'Parkal':        [18.2017, 79.7165],
    'Bhupalpally':   [18.4374, 79.8578],
    'Mahabubabad':   [17.6061, 80.0012],
    'Khammam':       [17.2473, 80.1514],
    'Dornakal':      [17.4389, 80.1514],
    'Palakurthi':    [17.6667, 79.5167],
}

const FIRST_NAMES = [
    'Ramulu', 'Laxmi', 'Srinivas', 'Buchamma', 'Venkat', 'Padma', 'Raju', 'Sayamma',
    'Krishna', 'Sunita', 'Ramesh', 'Manjula', 'Narsimha', 'Susheela', 'Balu', 'Yadamma',
    'Chandra', 'Anita', 'Ravi', 'Kavitha', 'Gopal', 'Suvarna', 'Mallesh', 'Lalitha'
]

const LAST_NAMES = [
    'Goud', 'Reddy', 'Rao', 'Yadav', 'Sharma', 'Patel', 'Naidu', 'Kumar', 'Devi', 'Amma'
]

const CONDITIONS = [
    'Diabetes', 'Hypertension', 'Cardiac', 'Arthritis', 'COPD', 'Thyroid', 'Healthy', 'Asthma'
]

export const DEMO_PATIENT_COUNT = 45

export function generateDemoPatients(count: number = DEMO_PATIENT_COUNT): any[] {
    // Check if data exists in localStorage
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('ayulink_demo_data_v3')
        if (saved) {
            try {
                const parsed = JSON.parse(saved)
                if (parsed.length === count && parsed[0]?.lat !== undefined) return parsed
            } catch (e) {
                console.error('Failed to parse demo data', e)
            }
        }
    }

    const data = Array.from({ length: count }).map((_, i) => {
        const village = VILLAGES[Math.floor(Math.random() * VILLAGES.length)]
        const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
        const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
        const condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)]

        // Generate realistic vitals based on condition
        let hr = 60 + Math.floor(Math.random() * 40)
        let spo2 = 90 + Math.floor(Math.random() * 10)

        if (condition === 'Cardiac') hr += 10
        if (condition === 'COPD') spo2 -= 2

        // Status logic
        let status = 'normal'
        if (hr > 100 || spo2 < 90) status = 'critical'
        else if (hr > 90 || spo2 < 94) status = 'warning'

        // Device status
        const deviceStatus = Math.random() > 0.15 ? 'online' : 'offline' // 85% online

        // Per-village GPS coords + small jitter so patients in the same village don't stack
        const baseCoords = VILLAGE_COORDS[village] || [18.0578, 79.5536]
        const lat = baseCoords[0] + (Math.random() * 0.012 - 0.006)
        const lng = baseCoords[1] + (Math.random() * 0.012 - 0.006)

        return {
            id: `P-${(i + 1).toString().padStart(3, '0')}`,
            name: `${firstName} ${lastName}`,
            age: 45 + Math.floor(Math.random() * 40),
            gender: Math.random() > 0.5 ? 'Male' : 'Female',
            deviceStatus: deviceStatus,
            lastReading: 'Just now',
            hr,
            spo2,
            phone: `+91 ${9000000000 + Math.floor(Math.random() * 999999999)}`,
            village,
            lat,
            lng,
            allergies: Math.random() > 0.8 ? ['Peanuts'] : [],
            conditions: condition === 'Healthy' ? [] : [condition],
            emergencyContact: `+91 ${9000000000 + Math.floor(Math.random() * 999999999)}`,
            bloodGroup: ['A+', 'B+', 'O+', 'AB+'][Math.floor(Math.random() * 4)],
            language: 'Telugu',
            abhaId: `${Math.floor(Math.random() * 99)}-${Math.floor(Math.random() * 9999)}-${Math.floor(Math.random() * 9999)}-${Math.floor(Math.random() * 9999)}`,
            rationCardType: Math.random() > 0.6 ? 'BPL' : 'APL',
            familyHeadName: 'Self'
        }
    })

    // Save to localStorage
    if (typeof window !== 'undefined') {
        localStorage.setItem('ayulink_demo_data_v3', JSON.stringify(data))
    }

    return data
}

export function getDemoStats() {
    const patients = generateDemoPatients()
    const villageStats: Record<string, { name: string, patients: number, online: number, alerts: number, status: string }> = {}

    patients.forEach(p => {
        if (!villageStats[p.village]) {
            villageStats[p.village] = { name: p.village, patients: 0, online: 0, alerts: 0, status: 'good' }
        }
        villageStats[p.village].patients++
        if (p.deviceStatus === 'online') {
            villageStats[p.village].online++
        }
        if (p.hr > 100 || p.spo2 < 90) {
            villageStats[p.village].alerts++
        }
    })

    // Update status based on alerts
    Object.values(villageStats).forEach(v => {
        if (v.alerts > 3) v.status = 'critical'
        else if (v.alerts > 0) v.status = 'warning'
        else v.status = 'good'
    })

    const totalPatients = patients.length
    const totalOnline = patients.filter(p => p.deviceStatus === 'online').length
    const totalAlerts = patients.filter(p => p.hr > 100 || p.spo2 < 90).length
    const criticalPatients = patients.filter(p => p.hr > 110 || p.spo2 < 85).length

    return {
        villages: Object.values(villageStats).sort((a, b) => b.patients - a.patients),
        totalPatients,
        totalOnline,
        totalAlerts,
        criticalPatients,
        healthScore: 82 // Consistent hardcoded-style demo score
    }
}
