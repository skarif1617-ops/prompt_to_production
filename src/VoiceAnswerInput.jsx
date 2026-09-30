import { useEffect, useRef, useState } from 'react'
import { Mic, RotateCcw, Square } from 'lucide-react'

function recognitionMessage(code) {
  const messages = {
    'not-allowed': 'Allow microphone access in the browser address bar, then try again.',
    'service-not-allowed': 'This browser blocks speech recognition. Try Chrome or Edge, or record audio for transcription.',
    'no-speech': 'No speech was detected. Check your microphone and speak clearly.',
    'audio-capture': 'The browser could not use the microphone. Check that it is connected and not busy in another app.',
    network: 'Speech recognition could not connect. Trying audio transcription instead.',
    aborted: 'Voice input stopped. Start the microphone when you are ready.',
  }
  return messages[code] || 'Speech recognition stopped. You can retry or type your answer.'
}

function microphoneMessage(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'Allow microphone access in the browser address bar, then try again.'
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return 'No microphone was found. Connect a microphone or type your answer.'
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return 'The microphone is busy in another app. Close that app and try again.'
  if (error?.name === 'NotSupportedError') return 'Voice input requires localhost or a secure HTTPS connection. You can type your answer instead.'
  return 'The microphone could not start. Check browser permission and try again, or type your answer.'
}

function formatDuration(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function VoiceAnswerInput({ value, onChange, language, onLanguageChange, onBusyChange }) {
  const recognitionRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const activeRef = useRef(false)
  const shouldRestartRef = useRef(false)
  const manualStopRef = useRef(false)
  const fallbackRef = useRef(false)
  const audioOnlyRef = useRef(false)
  const baseTranscriptRef = useRef('')
  const completedTranscriptRef = useRef('')
  const currentTranscriptRef = useRef('')
  const requestRef = useRef(null)
  const requestingRef = useRef(false)
  const audioContextRef = useRef(null)
  const animationRef = useRef(0)
  const restartRef = useRef(0)
  const timerRef = useRef(0)
  const startedAtRef = useRef(0)
  const valueRef = useRef(value)
  const mountedRef = useRef(true)
  const recognitionSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const recorderSupported = typeof window !== 'undefined' && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia)
  const [requesting, setRequesting] = useState(false)
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState(() => recognitionSupported ? '' : recorderSupported ? 'Speech recognition is unavailable here. Text entry is ready; you can record audio for transcription.' : 'Voice input is unavailable here. Text entry is ready.')

  useEffect(() => { valueRef.current = value }, [value])

  const releaseAudio = () => {
    window.cancelAnimationFrame(animationRef.current)
    window.clearInterval(timerRef.current)
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setLevel(0)
  }

  const transcribeRecording = async (blob) => {
    if (!blob.size) {
      if (mountedRef.current) {
        setError('No audio was captured. Check your microphone and try again.')
        setProcessing(false)
        onBusyChange?.(false)
        releaseAudio()
      }
      return
    }
    setProcessing(true)
    onBusyChange?.(true)
    setStatus('Transcribing your audio securely on the server...')
    setError('')
    const controller = new AbortController()
    requestRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), 45000)
    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
        signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok || typeof result.transcript !== 'string' || !result.transcript.trim()) throw new Error(result.error || 'Audio could not be transcribed.')
      const transcript = [baseTranscriptRef.current, result.transcript.trim()].filter(Boolean).join(' ')
      onChange(transcript)
      setStatus('Audio transcribed. Review and edit your answer before submitting.')
    } catch (transcriptionError) {
      if (mountedRef.current) {
        setError(transcriptionError.name === 'AbortError'
          ? 'Audio transcription timed out. Check your connection or type your answer instead.'
          : transcriptionError.message || 'Audio transcription is unavailable. Type your answer instead.')
      }
    } finally {
      window.clearTimeout(timeoutId)
      requestRef.current = null
      if (mountedRef.current) {
        setProcessing(false)
        onBusyChange?.(false)
        releaseAudio()
      }
    }
  }

  const stopRecorder = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else releaseAudio()
  }

  const stopListening = () => {
    manualStopRef.current = true
    activeRef.current = false
    shouldRestartRef.current = false
    window.clearTimeout(restartRef.current)
    window.clearInterval(timerRef.current)
    setListening(false)
    setInterim('')
    if (audioOnlyRef.current) fallbackRef.current = true
    try { recognitionRef.current?.stop() } catch { /* recognition may already have ended */ }
    stopRecorder()
    if (!fallbackRef.current) setStatus('Recording stopped. Review or edit your answer before submitting.')
  }

  const startListening = async (clearDraft = false, audioOnly = false) => {
    if (requestingRef.current) return
    activeRef.current = false
    shouldRestartRef.current = false
    manualStopRef.current = true
    window.clearTimeout(restartRef.current)
    const previousRecognition = recognitionRef.current
    if (previousRecognition) {
      previousRecognition.onend = null
      previousRecognition.onerror = null
      previousRecognition.onresult = null
      try { previousRecognition.abort() } catch { /* recognition may already have ended */ }
    }
    const previousRecorder = recorderRef.current
    if (previousRecorder && previousRecorder.state !== 'inactive') {
      previousRecorder.onstop = null
      previousRecorder.stop()
    }
    releaseAudio()
    recorderRef.current = null

    if (clearDraft) onChange('')
    const initialDraft = clearDraft ? '' : (valueRef.current || '').trim()
    baseTranscriptRef.current = initialDraft
    completedTranscriptRef.current = ''
    currentTranscriptRef.current = ''
    chunksRef.current = []
    fallbackRef.current = Boolean(audioOnly)
    audioOnlyRef.current = Boolean(audioOnly)
    manualStopRef.current = false
    setError('')
    setStatus('')
    setInterim('')
    setElapsed(0)

    let stream
    requestingRef.current = true
    setRequesting(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupportedError' })
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current || manualStopRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
    } catch (permissionError) {
      activeRef.current = false
      setError(microphoneMessage(permissionError))
      setStatus('Text entry is still available below.')
      return
    } finally {
      requestingRef.current = false
      if (mountedRef.current) setRequesting(false)
    }

    const Recorder = window.MediaRecorder
    if (Recorder) {
      try {
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => Recorder.isTypeSupported(type))
        const recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream)
        recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          recorderRef.current = null
          if (fallbackRef.current) {
            fallbackRef.current = false
            void transcribeRecording(blob)
          } else releaseAudio()
        }
        recorder.start(1000)
        recorderRef.current = recorder
      } catch {
        setStatus('Audio backup is unavailable; browser speech recognition can still be used.')
      }
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (AudioContextConstructor) {
      try {
        const context = new AudioContextConstructor()
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        context.createMediaStreamSource(stream).connect(analyser)
        audioContextRef.current = context
        const samples = new Uint8Array(analyser.fftSize)
        const updateLevel = () => {
          analyser.getByteTimeDomainData(samples)
          const energy = samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
          setLevel(Math.min(100, Math.round(Math.sqrt(energy) * 260)))
          animationRef.current = window.requestAnimationFrame(updateLevel)
        }
        updateLevel()
      } catch { setLevel(0) }
    }

    activeRef.current = true
    shouldRestartRef.current = !audioOnly
    setListening(true)
    startedAtRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsed(seconds)
      if (seconds >= 60) {
        setStatus('One-minute recording limit reached. Your captured answer is ready to review.')
        stopListening()
      }
    }, 250)

    if (audioOnly) {
      setStatus('Recording audio for transcription. Press Stop when you have finished speaking.')
      return
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      fallbackRef.current = Boolean(recorderRef.current)
      audioOnlyRef.current = true
      setStatus('Speech recognition is unavailable. Recording audio for server transcription; text entry is also available.')
      return
    }

    const recognition = recognitionRef.current || new Recognition()
    recognitionRef.current = recognition
    recognition.lang = language || 'en-IN'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.onresult = (event) => {
      const finalParts = []
      const interimParts = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalParts.push(result[0].transcript.trim())
        else interimParts.push(result[0].transcript.trim())
      }
      currentTranscriptRef.current = finalParts.filter(Boolean).join(' ')
      const currentInterim = interimParts.filter(Boolean).join(' ')
      setInterim(currentInterim)
      onChange([baseTranscriptRef.current, completedTranscriptRef.current, currentTranscriptRef.current, currentInterim].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        setStatus('No speech detected yet. Keep speaking; listening will resume automatically.')
        return
      }
      if (event.error === 'aborted' && manualStopRef.current) return
      setError(recognitionMessage(event.error))
      if (recorderRef.current && ['network', 'audio-capture', 'service-not-allowed', 'not-allowed'].includes(event.error)) {
        fallbackRef.current = true
        shouldRestartRef.current = false
        setStatus('Falling back to secure audio transcription. Your recording is being kept.')
      } else {
        activeRef.current = false
        shouldRestartRef.current = false
        setListening(false)
      }
      try { recognition.abort() } catch { /* recognition may already have ended */ }
    }
    recognition.onend = () => {
      if (currentTranscriptRef.current) {
        completedTranscriptRef.current = [completedTranscriptRef.current, currentTranscriptRef.current].filter(Boolean).join(' ')
        currentTranscriptRef.current = ''
        onChange([baseTranscriptRef.current, completedTranscriptRef.current].filter(Boolean).join(' '))
      }
      if (shouldRestartRef.current && !manualStopRef.current && !fallbackRef.current) {
        restartRef.current = window.setTimeout(() => {
          if (!shouldRestartRef.current || manualStopRef.current || fallbackRef.current) return
          try { recognition.start() } catch {
            activeRef.current = false
            shouldRestartRef.current = false
            setListening(false)
            setError('Speech recognition could not restart. Your captured text is still available.')
            stopRecorder()
          }
        }, 250)
      } else if (fallbackRef.current) {
        setListening(false)
        stopRecorder()
      }
      else stopRecorder()
    }

    try {
      recognition.start()
      setStatus('Recording. Speak naturally; your answer will appear as you talk.')
    } catch {
      activeRef.current = false
      shouldRestartRef.current = false
      setListening(false)
      fallbackRef.current = Boolean(recorderRef.current)
      setError('Speech recognition could not start. Trying audio transcription instead.')
      try { recognition.abort() } catch { /* recognition may already have ended */ }
      if (!fallbackRef.current) stopRecorder()
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeRef.current = false
      shouldRestartRef.current = false
      manualStopRef.current = true
      window.clearTimeout(restartRef.current)
      window.clearInterval(timerRef.current)
      requestRef.current?.abort()
      const recognition = recognitionRef.current
      if (recognition) {
        recognition.onend = null
        recognition.onerror = null
        recognition.onresult = null
        try { recognition.abort() } catch { /* recognition may already have ended */ }
      }
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        try { recorder.stop() } catch { /* recorder may already have stopped */ }
      }
      window.cancelAnimationFrame(animationRef.current)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close().catch(() => {})
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return <div className="voice-input-panel">
    <div className="voice-input-controls">
      {recognitionSupported && <label className="voice-language">Language<select aria-label="Speech recognition language" value={language} onChange={(event) => onLanguageChange(event.target.value)} disabled={listening}><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="hi-IN">Hindi</option><option value="ta-IN">Tamil</option><option value="te-IN">Telugu</option></select></label>}
      {listening
        ? <button className="voice-start-stop is-recording" type="button" onClick={stopListening}><Square size={14} /> Stop</button>
        : <button className="voice-start-stop" type="button" onClick={() => startListening(false, !recognitionSupported)} disabled={processing || requesting || (!recognitionSupported && !recorderSupported)}><Mic size={15} /> {requesting ? 'Requesting mic' : recognitionSupported ? 'Start mic' : recorderSupported ? 'Record audio' : 'Text mode'}</button>}
      <button className="voice-rerecord" type="button" onClick={() => startListening(true, !recognitionSupported)} disabled={processing || requesting || (!recognitionSupported && !recorderSupported)} title="Clear the answer and record again"><RotateCcw size={14} /> Re-record</button>
      {listening && <span className="voice-recording-status"><i /> Recording {formatDuration(elapsed)}</span>}
    </div>
    <div className="voice-level" role="meter" aria-label="Microphone audio level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={level}><i style={{ width: `${level}%` }} /></div>
    {interim && <p className="voice-interim" aria-live="polite">Hearing: {interim}</p>}
    {(status || error) && <p className={error ? 'voice-error' : 'voice-status'} role={error ? 'alert' : 'status'}>{error || status}</p>}
    {processing && <p className="voice-status" role="status">Transcription is processing. You can edit the answer once it appears.</p>}
  </div>
}