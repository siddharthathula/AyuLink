// ─── AyuLink Local Mock Store ─────────────────────────────────────────────────
// Supabase has been fully removed. All data is stored in memory / localStorage.
// This prevents any DNS resolution errors on Vercel.
// ──────────────────────────────────────────────────────────────────────────────

const mockStore: Record<string, any[]> = {
    patients: [
        { id: '108', name: 'Ramulu Goud', village: 'Hanamkonda', status: 'normal', age: 73, gender: 'Male', condition: 'Diabetes, Hypertension', bloodGroup: 'O+', phone: '+91 9876543210', emergencyContact: '+91 9876543211', abhaId: '12-3456-7890-1234', rationCardType: 'BPL', allergies: [], lat: 18.0539, lng: 79.5357 },
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

// ── Backend sync (local SQLite via FastAPI :8000) ─────────────────────────────
// Tables below sync to the local backend DB when reachable, falling back to
// localStorage. Everything stays on-device — no cloud anywhere.

const BACKEND_TABLES = ['medications', 'patients', 'appointments']

async function backendList(table: string): Promise<any[]> {
    const res = await fetch(`/api/${table}`)
    if (!res.ok) throw new Error('backend unreachable')
    const d = await res.json()
    if (!d || d.ok === false) throw new Error('backend error')
    return d[table] || []
}

async function backendCreate(table: string, row: any): Promise<any> {
    const res = await fetch(`/api/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error('backend unreachable')
    const d = await res.json()
    if (!d || d.ok === false) throw new Error('backend error')
    return d.medication || d.row || row
}

async function backendUpdate(table: string, id: string, row: any): Promise<void> {
    const res = await fetch(`/api/${table}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error('backend unreachable')
    const d = await res.json()
    if (!d || d.ok === false) throw new Error('backend error')
}

async function backendDelete(table: string, id: string): Promise<void> {
    const res = await fetch(`/api/${table}/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('backend unreachable')
}

function applyLocalUpdate(table: string, filters: Array<{ col: string; val: any }>, data: any) {
    const rows = getStore(table).map(r => {
        const match = filters.every(f => r[f.col] === f.val)
        return match ? { ...r, ...data } : r
    })
    setStore(table, rows)
}

function applyLocalDelete(table: string, col: string, val: any) {
    setStore(table, getStore(table).filter(r => r[col] !== val))
}

// ── Mock Supabase API surface ──────────────────────────────────────────────────
export const supabase: any = {
    from: (table: string) => {
        const sync = BACKEND_TABLES.includes(table)
        const chain: any = {
            _filters: [] as Array<{ col: string; val: any }>,
            _limit: undefined as number | undefined,
            _updatePayload: undefined as any | undefined,

            select: function (cols?: string) { return this },
            order: function () { return this },
            limit: function (n: number) { this._limit = n; return this },

            eq: function (col: string, val: any) {
                this._filters.push({ col, val })
                return this
            },

            insert: async function (data: any) {
                const rows = Array.isArray(data) ? data : [data]
                if (sync) {
                    try {
                        const created = []
                        for (const r of rows) {
                            created.push(await backendCreate(table, r))
                        }
                        return { data: created, error: null }
                    } catch { /* fall back to localStorage below */ }
                }
                const existing = getStore(table)
                const withId = rows.map(r => ({ id: genId(), created_at: new Date().toISOString(), ...r }))
                setStore(table, [...existing, ...withId])
                return Promise.resolve({ data: withId, error: null })
            },

            update: function (data: any) {
                if (sync) {
                    this._updatePayload = { ...data }
                    return this
                }
                const rows = getStore(table).map(r => {
                    const match = this._filters.every((f: { col: string; val: any }) => r[f.col] === f.val)
                    return match ? { ...r, ...data } : r
                })
                setStore(table, rows)
                return this
            },

            delete: function () {
                const deleteChain: any = {
                    eq: async (col: string, val: any) => {
                        if (sync) {
                            try {
                                await backendDelete(table, val)
                                return { data: [], error: null }
                            } catch { /* fall back below */ }
                        }
                        const filtered = getStore(table).filter(r => r[col] !== val)
                        setStore(table, filtered)
                        return Promise.resolve({ data: [], error: null })
                    }
                }
                return deleteChain
            },

            then: async function (onfulfilled: any) {
                let rows: any[]
                if (sync) {
                    try {
                        rows = await backendList(table)
                    } catch {
                        rows = getStore(table)
                    }
                } else {
                    rows = getStore(table)
                }
                if (this._updatePayload) {
                    const idFilter = this._filters.find((f: { col: string; val: any }) => f.col === 'id')
                    if (idFilter) {
                        try {
                            await backendUpdate(table, idFilter.val, this._updatePayload)
                        } catch {
                            applyLocalUpdate(table, this._filters, this._updatePayload)
                        }
                    } else if (!sync) {
                        applyLocalUpdate(table, this._filters, this._updatePayload)
                    }
                    this._updatePayload = undefined
                }
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
