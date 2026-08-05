"use client"

let ctx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    return ctx
}

export function unlockAudio() {
    const c = getCtx()
    if (c && c.state === 'suspended') c.resume()
    unlocked = true
}

export function armAudioUnlock() {
    if (typeof window === 'undefined') return
    const arm = () => {
        unlockAudio()
        window.removeEventListener('pointerdown', arm)
        window.removeEventListener('keydown', arm)
        window.removeEventListener('touchstart', arm)
    }
    window.addEventListener('pointerdown', arm)
    window.addEventListener('keydown', arm)
    window.addEventListener('touchstart', arm)
}

export function playAlertSound() {
    const c = getCtx()
    if (c && c.state === 'running') {
        try {
            const beep = (freq: number, when: number) => {
                const osc = c.createOscillator()
                const gain = c.createGain()
                osc.type = 'square'
                osc.frequency.value = freq
                osc.connect(gain)
                gain.connect(c.destination)
                gain.gain.setValueAtTime(0.35, when)
                gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
                osc.start(when)
                osc.stop(when + 0.2)
            }
            const t = c.currentTime + 0.02
            beep(1046, t)
            beep(784, t + 0.22)
            beep(1046, t + 0.44)
            beep(784, t + 0.66)
            return
        } catch { }
    }
    try {
        new Audio('/alert.mp3').play()
    } catch { }
}
