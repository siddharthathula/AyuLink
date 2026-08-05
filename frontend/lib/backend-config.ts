/**
 * AyuLink — Universal Backend & Hardware Bridge Config
 * 
 * Works in 2 modes seamlessly:
 * 1. LIVE HARDWARE MODE (Local Dev / LAN / ESP32 Bridge): Connects to FastAPI backend on port 8000.
 * 2. VERCEL / CLOUD DEMO MODE: Detects HTTPS or unreachable backend and gracefully degrades to
 *    in-browser simulation/mock data without showing red error screens or throwing uncaught exceptions.
 */

export function isVercelOrCloud(): boolean {
    if (typeof window === 'undefined') return true
    // If protocol is https or hostname is vercel.app, we are on cloud without local hardware port 8000
    return window.location.protocol === 'https:' || window.location.hostname.endsWith('vercel.app')
}

export function getBackendUrl(path: string = ''): string {
    if (typeof window === 'undefined') return `/api${path}`
    const host = window.location.hostname
    if (isVercelOrCloud()) {
        return `/api${path}`
    }
    return `http://${host}:8000${path}`
}

export function getWsUrl(path: string = '/ws/dashboard'): string | null {
    if (typeof window === 'undefined') return null
    if (isVercelOrCloud()) {
        // Vercel cannot host raw WebSockets on port 8000 over HTTPS
        return null
    }
    const host = window.location.hostname
    return `ws://${host}:8000${path}`
}

export async function safeFetch<T>(
    path: string,
    options?: RequestInit,
    fallback?: T
): Promise<T> {
    const url = getBackendUrl(path)
    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 4000)
        const res = await fetch(url, { ...options, signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) {
            return await res.json()
        }
    } catch {
        /* Backend unreachable or cloud environment */
    }
    if (fallback !== undefined) {
        return fallback
    }
    return { ok: false, simulated: true } as unknown as T
}
