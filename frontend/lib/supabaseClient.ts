// ─── AyuLink Local Mock Store ─────────────────────────────────────────────────
// Supabase has been fully removed. All data is stored in memory / localStorage.
// This prevents any DNS resolution errors on Vercel.
// ──────────────────────────────────────────────────────────────────────────────

const mockStore: Record<string, any[]> = {
    patients: [
        { id: 'P-001', name: 'Ramulu Goud', village: 'Shadnagar', status: 'normal', age: 68, gender: 'Male', condition: 'Hypertension', bloodGroup: 'O+', phone: '+91 9876543210', emergencyContact: '+91 9876543211', abhaId: '12-3456-7890-1234', rationCardType: 'BPL', allergies: [], lat: 17.066, lng: 78.066 },
        { id: 'P-002', name: 'Laxmi Narsamma', village: 'Maheshwaram', status: 'normal', age: 72, gender: 'Female', condition: 'Diabetes', bloodGroup: 'A+', phone: '+91 9876543212', emergencyContact: '+91 9876543213', abhaId: '23-4567-8901-2345', rationCardType: 'APL', allergies: [], lat: 17.076, lng: 78.076 },
        { id: 'P-003', name: 'Srinivas Reddy', village: 'Shamshabad', status: 'offline', age: 58, gender: 'Male', condition: 'Arthritis', bloodGroup: 'B+', phone: '+91 9876543214', emergencyContact: '+91 9876543215', abhaId: '34-5678-9012-3456', rationCardType: 'BPL', allergies: [], lat: 17.056, lng: 78.056 },
        { id: 'P-004', name: 'Buchamma', village: 'Chevella', status: 'normal', age: 65, gender: 'Female', condition: 'COPD', bloodGroup: 'AB+', phone: '+91 9876543216', emergencyContact: '+91 9876543217', abhaId: '45-6789-0123-4567', rationCardType: 'BPL', allergies: ['Peanuts'], lat: 17.086, lng: 78.086 },
        { id: 'P-005', name: 'Venkat Rao', village: 'Ibrahimpatnam', status: 'normal', age: 55, gender: 'Male', condition: 'Hypertension', bloodGroup: 'O+', phone: '+91 9876543218', emergencyContact: '+91 9876543219', abhaId: '56-7890-1234-5678', rationCardType: 'APL', allergies: [], lat: 17.096, lng: 78.096 },
    ],
    vitals: [],
    patient_records: [],
    medications: [],
    appointments: [],
    asha_visits: [
        { id: 'V-001', patient_id: 'P-001', asha_name: 'Swarupa', scheduled_time: '2023-10-27T09:00:00', status: 'completed', type: 'routine' },
        { id: 'V-002', patient_id: 'P-002', asha_name: 'Kavitha', scheduled_time: '2023-10-27T10:30:00', status: 'pending', type: 'emergency' },
        { id: 'V-003', patient_id: 'P-003', asha_name: 'Manjula', scheduled_time: '2023-10-27T14:00:00', status: 'pending', type: 'routine' },
    ],
}

// Persist to / restore from localStorage if in browser
function getStore(table: string): any[] {
    if (typeof window === 'undefined') return mockStore[table] || []
    try {
        const saved = localStorage.getItem(`ayulink_${table}`)
        if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return mockStore[table] || []
}

function setStore(table: string, data: any[]) {
    mockStore[table] = data
    if (typeof window !== 'undefined') {
        try { localStorage.setItem(`ayulink_${table}`, JSON.stringify(data)) } catch { /* ignore */ }
    }
}

function genId() {
    return Math.random().toString(36).substr(2, 9)
}

// ── Mock Supabase API surface ──────────────────────────────────────────────────
export const supabase: any = {
    from: (table: string) => {
        const chain: any = {
            _filters: [] as Array<{ col: string; val: any }>,
            _limit: undefined as number | undefined,

            select: function (cols?: string) { return this },
            order: function () { return this },
            limit: function (n: number) { this._limit = n; return this },

            eq: function (col: string, val: any) {
                this._filters.push({ col, val })
                return this
            },

            insert: function (data: any) {
                const rows = Array.isArray(data) ? data : [data]
                const existing = getStore(table)
                const withId = rows.map(r => ({ id: genId(), created_at: new Date().toISOString(), ...r }))
                setStore(table, [...existing, ...withId])
                return Promise.resolve({ data: withId, error: null })
            },

            update: function (data: any) {
                const rows = getStore(table).map(r => {
                    const match = this._filters.every((f: { col: string; val: any }) => r[f.col] === f.val)
                    return match ? { ...r, ...data } : r
                })
                setStore(table, rows)
                return Promise.resolve({ data, error: null })
            },

            delete: function () {
                const deleteChain: any = {
                    eq: (col: string, val: any) => {
                        const filtered = getStore(table).filter(r => r[col] !== val)
                        setStore(table, filtered)
                        return Promise.resolve({ data: [], error: null })
                    }
                }
                return deleteChain
            },

            then: function (onfulfilled: any) {
                let rows = getStore(table)
                for (const f of this._filters) rows = rows.filter((r: any) => r[f.col] === f.val)
                if (this._limit !== undefined) rows = rows.slice(0, this._limit)
                return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onfulfilled)
            }
        }
        return chain
    },

    storage: {
        from: (_bucket: string) => ({
            upload: (_path: string, file: any) => Promise.resolve({ data: { path: _path }, error: null }),
            getPublicUrl: (path: string) => ({ data: { publicUrl: `https://placehold.co/600x400?text=${encodeURIComponent(path)}` } }),
            remove: (_paths: string[]) => Promise.resolve({ data: [], error: null }),
        }),
    },

    auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
    },

    channel: (_name: string) => {
        const ch: any = {
            on: () => ch,
            subscribe: () => ch,
            unsubscribe: () => { },
            send: () => Promise.resolve('ok'),
        }
        return ch
    },

    removeChannel: () => Promise.resolve(),
}

export const isSupabaseLive = false
