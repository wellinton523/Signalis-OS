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

  // ── Detecção de silêncio (Voice Activity Detection simples) ──
  // Grava até o usuário ficar em silêncio por `silenceMs` OU atingir `maxMs`.
  // onLevel(rms) é chamado ~30x/s para animar o mic.
  async function startContinuousRecord (opts = {}) {
    const {
      silenceMs = 1400,
      maxMs = 20000,
      minMs = 800,          // gravação mínima para evitar cortar cedo demais
      threshold = 0.018,    // limiar de RMS para "está falando"
      onLevel = null
    } = opts

    if (isRecording()) await stopRecord().catch(() => {})
    await startRecord()

    return await new Promise((resolve, reject) => {
      let audioCtx, analyser, srcNode, rafId
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        audioCtx = new AC()
        srcNode  = audioCtx.createMediaStreamSource(mediaStream)
        analyser = audioCtx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.4
        srcNode.connect(analyser)
      } catch (err) {
        // Sem Web Audio disponível → cai para timeout fixo
        setTimeout(async () => {
          try { resolve(await stopRecord()) } catch (e) { reject(e) }
        }, 4000)
        return
      }

      const data = new Float32Array(analyser.fftSize)
      const startTs = performance.now()
      let lastLoudTs = performance.now()
      let sawSpeech = false

      const tick = () => {
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        const rms = Math.sqrt(sum / data.length)
        if (onLevel) try { onLevel(rms) } catch {}
        const now = performance.now()
        if (rms > threshold) { lastLoudTs = now; sawSpeech = true }

        const silentFor = now - lastLoudTs
        const totalMs   = now - startTs

        // Só para por silêncio se já ouvimos fala e passou o mínimo
        const stopBySilence = sawSpeech && silentFor > silenceMs && totalMs > minMs
        const stopByMax     = totalMs > maxMs
        const stopByEarly   = !sawSpeech && totalMs > Math.max(3000, silenceMs * 3)

        if (stopBySilence || stopByMax || stopByEarly) {
          cancelAnimationFrame(rafId)
          try { audioCtx.close() } catch {}
          stopRecord().then(text => resolve(sawSpeech ? text : '')).catch(reject)
          return
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    })
  }

  // ── Wake word: SpeechRecognition local (sem gastar Whisper) ──
  // Detecta a palavra em português; ao ouvir, chama onDetected e para.
  function createWakeWordDetector (word, onDetected, opts = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) throw new Error('Reconhecimento de fala local não suportado neste navegador (use Chrome/Edge).')

    const target = String(word || 'aris').toLowerCase().trim()
    const lang = opts.lang || 'pt-BR'
    let recog = null
    let active = false
    let restartTimer = null

    function _boot () {
      recog = new SR()
      recog.continuous = true
      recog.interimResults = true
      recog.lang = lang
      recog.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const raw = String(ev.results[i][0]?.transcript || '').toLowerCase()
          if (!raw) continue
          if (raw.includes(target)) {
            try { onDetected(raw) } catch (err) { console.debug('[wake] callback err', err) }
          }
        }
      }
      recog.onerror = (e) => {
        // 'not-allowed' ou 'aborted' — não tenta reiniciar
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') active = false
      }
      recog.onend = () => {
        if (active) {
          restartTimer = setTimeout(() => { try { recog.start() } catch {} }, 400)
        }
      }
      try { recog.start() } catch { /* já iniciado */ }
    }

    return {
      start () { if (active) return; active = true; _boot() },
      stop  () {
        active = false
        clearTimeout(restartTimer)
        if (recog) { try { recog.stop() } catch {} recog = null }
      },
      isActive () { return active },
      setWord (w) {
        // Troca a palavra reiniciando o detector se estiver ativo.
        // Precisa reboot porque `target` é capturado no closure de _boot.
        const wasActive = active
        this.stop()
        // Substitui `target` via re-criação simples: como target é const do closure,
        // trocamos referências criando novo detector no wrapper externo.
        // (o consumidor deve preferir stop() + createWakeWordDetector(newWord))
        if (wasActive) console.warn('[wake] setWord requer criar novo detector; chame stop() e createWakeWordDetector(newWord).')
      }
    }
  }

  window.aris9Voice = { startRecord, stopRecord, startContinuousRecord, speak, stopSpeaking, isRecording, createWakeWordDetector }

  // ── Orquestrador GLOBAL de wake word ─────────────────────────
  // Roda mesmo com o modo voz fechado, mostra indicador visual e
  // toca um bip natural (2 tons ascendentes) quando dispara.

  let _wakeIndicator = null
  function _ensureWakeIndicator () {
    if (_wakeIndicator && document.body.contains(_wakeIndicator)) return _wakeIndicator
    const el = document.createElement('span')
    el.id = 'wake-indicator'
    el.setAttribute('data-testid', 'wake-indicator')
    el.setAttribute('role', 'status')
    el.setAttribute('aria-label', 'Wake word ativa em background')
    el.title = 'Wake word ativa — clique para abrir o modo voz'
    el.style.display = 'none'
    el.addEventListener('click', () => { try { window.openVoiceChat?.() } catch {} })
    const tb = document.getElementById('titlebar')
    if (tb) {
      // insere antes do título
      const title = tb.querySelector('#titlebar-title')
      if (title) tb.insertBefore(el, title)
      else tb.appendChild(el)
    } else {
      document.body.appendChild(el)
    }
    _wakeIndicator = el
    return el
  }
  function _updateIndicator (visible) {
    const el = _ensureWakeIndicator()
    if (visible) { el.style.display = 'inline-block'; el.classList.add('active') }
    else         { el.style.display = 'none';         el.classList.remove('active') }
  }

  // Bip natural (2 tons ascendentes tipo confirmação de assistente)
  function _wakeBeep () {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      function tone (freq, startAt, dur, peakGain = 0.14) {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt)
        osc.connect(g); g.connect(ctx.destination)
        g.gain.setValueAtTime(0.0001, ctx.currentTime + startAt)
        g.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + startAt + 0.015)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + dur)
        osc.start(ctx.currentTime + startAt)
        osc.stop(ctx.currentTime + startAt + dur + 0.02)
      }
      tone(880, 0,    0.09, 0.13)   // A5
      tone(1320, 0.10, 0.13, 0.16)  // E6
      setTimeout(() => { try { ctx.close() } catch {} }, 500)
    } catch { /* ignora */ }
  }

  const aris9Wake = {
    _detector: null,
    isActive () { return !!(this._detector && this._detector.isActive?.()) },
    beep () { _wakeBeep() },
    async start () {
      if (this._detector) return
      const prefs = window.aris9Prefs?.get?.() || {}
      const word = String(prefs.wakeWord || 'aris').toLowerCase().trim() || 'aris'
      try {
        this._detector = createWakeWordDetector(word, () => {
          _wakeBeep()
          try { window.openVoiceChat?.() } catch {}
          try { window.aris9VoiceKick?.(true) } catch {}
        })
        this._detector.start()
        _updateIndicator(true)
      } catch (err) {
        this._detector = null
        _updateIndicator(false)
        // Reverte a pref para não ficar pendente
        window.aris9Prefs?.set('wakeWordEnabled', false)
        try { window.showNotification?.('ARIS-9', 'Wake word indisponível: ' + err.message, 'warn') } catch {}
        throw err
      }
    },
    stop () {
      if (this._detector) { try { this._detector.stop() } catch {} this._detector = null }
      _updateIndicator(false)
    },
    reboot () {
      this.stop()
      if (window.aris9Prefs?.get?.().wakeWordEnabled) {
        this.start().catch(() => {})
      }
    }
  }
  window.aris9Wake = aris9Wake

  // Reage a mudanças de pref (do drawer ou do modo voz)
  window.addEventListener('aris9:pref-changed', (ev) => {
    const { key, value } = ev.detail || {}
    if (key === 'wakeWordEnabled') {
      if (value) aris9Wake.start().catch(() => {})
      else       aris9Wake.stop()
    } else if (key === 'wakeWord' && aris9Wake.isActive()) {
      aris9Wake.reboot()
    }
  })

  // Auto-start após carregamento se a pref estava ligada da sessão anterior
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (window.aris9Prefs?.get?.().wakeWordEnabled) {
        aris9Wake.start().catch(() => {})
      }
    }, 800)
  })
})()
