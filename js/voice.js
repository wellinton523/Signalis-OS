// voice.js — Captura de áudio (STT via Whisper) + Fala (TTS OpenAI)
// ─────────────────────────────────────────────────────────────
// window.aris9Voice.startRecord() / stopRecord() → texto transcrito
// window.aris9Voice.speak(text)                 → toca áudio TTS
// Cache LRU pequeno em memória para não regravar frases repetidas.
// ─────────────────────────────────────────────────────────────
;(function () {
  let mediaStream = null
  let recorder    = null
  let chunks      = []
  let currentAudio = null
  const ttsCache = new Map()   // texto → Blob mp3
  const CACHE_MAX = 12

  async function startRecord () {
    if (recorder && recorder.state === 'recording') return
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('MediaDevices indisponível neste navegador.')
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    // Prefere webm/opus (padrão amplamente suportado por Chrome/Edge)
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
    recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : {})
    chunks = []
    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data) }
    recorder.start()
  }

  async function stopRecord () {
    if (!recorder) return null
    return await new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          mediaStream?.getTracks().forEach(t => t.stop())
          mediaStream = null; recorder = null; chunks = []
          if (blob.size < 800) return resolve('') // muito curto — provável clique vazio
          const text = await _transcribe(blob)
          resolve(text)
        } catch (err) { reject(err) }
      }
      recorder.stop()
    })
  }

  async function _transcribe (blob) {
    const res = await fetch('/api/voice/stt', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    })
    if (!res.ok) throw new Error('STT HTTP ' + res.status + ': ' + (await res.text()).slice(0, 120))
    const j = await res.json()
    return (j.text || '').trim()
  }

  async function speak (text, opts = {}) {
    if (!text || !text.trim()) return
    const clean = String(text).replace(/```[\s\S]*?```/g, '')  // remove blocos de código
                              .replace(/[*_`>#]+/g, ' ')       // remove markdown de énfase
                              .replace(/\s+/g, ' ').trim()
    if (!clean) return
    const key = `${clean}|${opts.voice || 'nova'}|${opts.speed || 1}|${opts.model || 'tts-1-hd'}`
    let blob = ttsCache.get(key)
    if (!blob) {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          voice: opts.voice || (window.aris9Prefs?.get?.().ttsVoice || 'nova'),
          model: opts.model || 'tts-1-hd',
          speed: opts.speed || (window.aris9Prefs?.get?.().ttsSpeed || 1.0)
        })
      })
      if (!res.ok) throw new Error('TTS HTTP ' + res.status + ': ' + (await res.text()).slice(0, 120))
      blob = await res.blob()
      ttsCache.set(key, blob)
      if (ttsCache.size > CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value)
    }
    // toca em foreground; guarda referência para stop
    stopSpeaking()
    const url = URL.createObjectURL(blob)
    const a = new Audio(url)
    a.preload = 'auto'
    currentAudio = a
    a.onended = () => { URL.revokeObjectURL(url); if (currentAudio === a) currentAudio = null }
    try { await a.play() } catch (err) { console.debug('[voice] play blocked:', err) }
    return a
  }

  function stopSpeaking () {
    if (currentAudio) {
      try { currentAudio.pause() } catch {}
      currentAudio = null
    }
  }

  function isRecording () { return !!(recorder && recorder.state === 'recording') }

  window.aris9Voice = { startRecord, stopRecord, speak, stopSpeaking, isRecording }
})()
