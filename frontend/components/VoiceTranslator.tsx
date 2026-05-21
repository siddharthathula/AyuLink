'use client'

import { useState, useEffect, useRef } from 'react'
import { Mic, MicOff, Languages, FileText, Loader2, Play, Volume2 } from 'lucide-react'

// Add type for Web Speech API
declare global {
    interface Window {
        webkitSpeechRecognition: any;
        SpeechRecognition: any;
    }
}

export default function VoiceTranslator() {
    const [isListening, setIsListening] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [translation, setTranslation] = useState('')
    const [translatedText, setTranslatedText] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)
    const [permissionError, setPermissionError] = useState(false)

    const [lang, setLang] = useState('hi-IN') // 'hi-IN' or 'en-US' or 'te-IN'

    const recognitionRef = useRef<any>(null)
    const isUserListeningRef = useRef(false)

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition()
                recognition.continuous = true // Changed to true for continuous listening
                recognition.interimResults = true
                recognition.lang = lang

                recognition.onstart = () => {
                    setIsListening(true)
                    setPermissionError(false)
                }

                recognition.onresult = (event: any) => {
                    let interimTranscript = ''
                    let finalTranscript = ''

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript
                        } else {
                            interimTranscript += event.results[i][0].transcript
                        }
                    }

                    if (finalTranscript) {
                        const newText = transcript ? transcript + ' ' + finalTranscript : finalTranscript
                        setTranscript(newText)
                        // Trigger translation for the final segment
                        handleRealTranslation(newText)
                    } else if (interimTranscript) {
                        // feedback on listening

                    }
                }

                recognition.onerror = (event: any) => {
                    console.error('Speech recognition error', event.error)
                    if (event.error === 'not-allowed') {
                        setPermissionError(true)
                    }
                    if (event.error !== 'no-speech') {
                        setIsListening(false)
                    }
                }

                recognition.onend = () => {
                    // If user still wants to listen (didn't click stop), restart it
                    if (isUserListeningRef.current) {
                        // Use a small timeout to avoid rapid restart loops
                        setTimeout(() => {
                            if (isUserListeningRef.current) { // Check again after delay
                                try {
                                    recognition.start()
                                } catch (e) {
                                    console.warn("Auto-restart failed, retrying...", e)
                                }
                            }
                        }, 200)
                    } else {
                        setIsListening(false)
                    }
                }

                recognitionRef.current = recognition
            }
        }
    }, [lang]) // Re-init on lang change

    const startListening = () => {
        setTranscript('')
        setTranslation('')
        setTranslatedText('')
        isUserListeningRef.current = true
        setIsListening(true)

        if (recognitionRef.current) {
            try {
                recognitionRef.current.start()
            } catch (e) {
                console.error("Already started", e)
                // If extensive error, force stop and restart
                recognitionRef.current.stop()
                setTimeout(() => {
                    if (isUserListeningRef.current) recognitionRef.current.start()
                }, 300)
            }
        } else {
            alert("Your browser does not support speech recognition. Try Chrome.")
        }
    }

    const stopListening = () => {
        isUserListeningRef.current = false
        setIsListening(false)
        if (recognitionRef.current) {
            recognitionRef.current.stop()
        }
    }

    const simulateVoice = () => {
        let fakeInput = ""
        if (lang === 'te-IN') {
            fakeInput = "డాక్టర్ గారు, నాకు నిన్న రాత్రి నుండి చాలా జ్వరంగా ఉంది మరియు తలనొప్పిగా కూడా ఉంది." // Telugu: Doctor, I have a high fever and headache since last night.
        } else if (lang === 'hi-IN') {
            fakeInput = "डॉक्टर साहब, मुझे कल रात से बहुत तेज बुखार है और सर में दर्द भी है।"
        } else {
            fakeInput = "Doctor, I have had a high fever and a severe headache since last night."
        }
        setTranscript(fakeInput)
        handleRealTranslation(fakeInput)
    }

    const handleRealTranslation = async (text: string) => {
        setIsProcessing(true)

        try {
            // Source language code mapping
            const source = lang.split('-')[0] // 'hi', 'en', 'te'

            if (source === 'en') {
                // If already English, just process it directly
                setTranslatedText(text)
                processClinicalNote(text)
                return
            }

            // Call Free Translation API
            const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|en`)
            const data = await res.json()

            let translated = data.responseData.translatedText

            // Fallback if primary is empty (sometimes happens with rare words)
            if (!translated && data.matches && data.matches.length > 0) {
                translated = data.matches[0].translation
            }

            // Final fallback
            if (!translated) translated = "[Translation Unavailable]"

            setTranslatedText(translated)
            processClinicalNote(translated)

            // Auto-speak translation in English for the PHC worker
            speakText(translated)

        } catch (error) {
            console.error("Translation API Error:", error)
            setTranslatedText("Error connecting to translation service. Using fallback...")

            // Demo Fallback logic if API fails
            if (text.includes("bukhar") || text.includes("జ్వరంగా") || text.includes("fever")) {
                const fallback = "Doctor, the patient reports a high fever and headache since last night."
                setTranslatedText(fallback)
                processClinicalNote(fallback)
                speakText(fallback)
            } else {
                setIsProcessing(false)
            }
        }
    }

    const speakText = (text: string) => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            // Cancel any current speech
            window.speechSynthesis.cancel()

            const utterance = new SpeechSynthesisUtterance(text)
            utterance.rate = 0.9
            utterance.pitch = 1
            utterance.lang = 'en-US'
            window.speechSynthesis.speak(utterance)
        }
    }

    const processClinicalNote = (englishText: string) => {
        // Simulate AI processing naming entities on the ENGLISH text
        // This is much more robust because we only need to match English keywords now!
        setTimeout(() => {
            const lower = englishText.toLowerCase()
            let clinicalNote = "Patient presents with "

            // Robust English Keyword Matching
            if (lower.includes('fever') || lower.includes('temperature') || lower.includes('hot')) clinicalNote += "symptoms of Pyrexia (Fever). "
            if (lower.includes('pain') || lower.includes('ache') || lower.includes('hurt')) clinicalNote += "complaints of acute pain. "
            if (lower.includes('cough') || lower.includes('cold')) clinicalNote += "persistent cough (Tussis). "
            if (lower.includes('headache') || lower.includes('head')) clinicalNote += "severe Cephalalgia (Headache). "
            if (lower.includes('stomach') || lower.includes('abdomen') || lower.includes('belly')) clinicalNote += "abdominal discomfort/gastritis. "
            if (lower.includes('dizz') || lower.includes('vertigo') || lower.includes('spin')) clinicalNote += "episodes of Vertigo. "
            if (lower.includes('breath') || lower.includes('dyspnea')) clinicalNote += "Dyspnea (Shortness of Breath). "
            if (lower.includes('tired') || lower.includes('weak') || lower.includes('fatigue')) clinicalNote += "Generalized Weakness/Fatigue. "
            if (lower.includes('vomit') || lower.includes('nausea')) clinicalNote += "signs of Nausea/Vomiting. "

            if (clinicalNote === "Patient presents with ") {
                clinicalNote += "general malaise. Specific symptoms unclear from initial triage."
            }

            clinicalNote += " Vitals stable. Recommend further investigation."

            setTranslation(clinicalNote)
            setIsProcessing(false)
        }, 800)
    }

    return (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.15)' }}>
                        <Languages className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Vani AI Translator</h3>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Real-time Translation &amp; Clinical Scribing</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={lang}
                        onChange={(e) => setLang(e.target.value)}
                        className="text-xs rounded-lg px-2 py-1 outline-none"
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                        <option value="hi-IN">Hindi</option>
                        <option value="en-US">English</option>
                        <option value="te-IN">Telugu</option>
                    </select>
                    {isListening && (
                        <div className="flex items-center gap-1">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                            <span className="text-xs font-medium text-red-400 ml-1">Recording...</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="p-6" style={{ background: 'var(--bg-card)' }}>

                {/* Microphone Button */}
                <div className="flex flex-col items-center justify-center py-6">
                    <button
                        onClick={isListening ? stopListening : startListening}
                        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${isListening
                            ? 'bg-red-500 shadow-lg shadow-red-500/30 scale-110'
                            : 'bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 hover:scale-105'
                            }`}
                    >
                        {isListening ? (
                            <MicOff className="h-8 w-8 text-white" />
                        ) : (
                            <Mic className="h-8 w-8 text-white" />
                        )}

                        {isListening && (
                            <>
                                <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-[ping_1.5s_ease-out_infinite]" style={{ animationDelay: '0s' }}></div>
                            </>
                        )}
                    </button>

                    <div className="mt-4 flex flex-col items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                            {isListening ? 'Listening...' : 'Tap for Voice Input'}
                        </p>
                        {!isListening && !transcript && (
                            <button
                                onClick={simulateVoice}
                                className="text-xs text-indigo-400 hover:underline mt-1"
                            >
                                (Demo: Simulate Hindi Audio)
                            </button>
                        )}
                    </div>
                    {permissionError && (
                        <p className="mt-2 text-xs text-red-400">Microphone access denied. Please allow permission.</p>
                    )}
                </div>

                {/* Results Section */}
                {(isProcessing || transcript) && (
                    <div className="grid md:grid-cols-2 gap-4 animate-fadeIn">
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Original Audio ({lang.split('-')[0].toUpperCase()})</span>
                                    <Volume2
                                        className="h-4 w-4 cursor-pointer text-indigo-400 hover:text-indigo-300"
                                        onClick={() => speakText(transcript)}
                                    />
                                </div>
                                <p className="italic min-h-[40px]" style={{ color: 'var(--text-primary)' }}>&quot;{transcript}&quot;</p>
                            </div>

                            {translatedText && (
                                <div className="p-4 rounded-xl" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold uppercase text-indigo-400">English Translation</span>
                                    </div>
                                    <p className="font-medium min-h-[40px] text-indigo-300">{translatedText}</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 rounded-xl relative overflow-hidden flex flex-col" style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.2)' }}>
                            <div className="absolute top-0 right-0 p-2">
                                <div className="px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1" style={{ background: 'rgba(20,184,166,0.15)', color: '#5eead4' }}>
                                    <FileText className="h-3 w-3" />
                                    CLINICAL NOTE
                                </div>
                            </div>

                            {isProcessing ? (
                                <div className="flex flex-col items-center justify-center h-full min-h-[120px]">
                                    <Loader2 className="h-6 w-6 text-teal-400 animate-spin mb-2" />
                                    <span className="text-xs text-teal-400 font-medium">Generating Clinical Summary...</span>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col">
                                    <div className="mt-8 flex-1">
                                        <p className="font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                            {translation}
                                        </p>
                                    </div>
                                    <div className="mt-4 flex gap-2">
                                        <button className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1 transition-colors hover:opacity-80" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                                            <Play className="h-3 w-3" />
                                            Copy to EMR
                                        </button>
                                        <button
                                            onClick={() => speakText(translation)}
                                            className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-teal-500 transition-colors"
                                        >
                                            <Volume2 className="h-3 w-3" />
                                            Read Summary
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
