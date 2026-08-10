// voice-chat.js — Tela dedicada de conversa por voz com ARIS-9
// ─────────────────────────────────────────────────────────────
// Janela em tela cheia com um botão grande de microfone.
// Fluxo: pressione o mic (ou barra de espaço) para falar → Whisper transcreve → agente responde
// → TTS toca automaticamente a resposta. Suporta interrupção (barbecho).
// ─────────────────────────────────────────────────────────────
;(function () {
  let overlay  = null
  let transcript = null
  let micBtn   = null
  let statusEl = null
  let busy = false
  let _vadEpoch = 0

  function _build () {
    if (overlay) return overlay
    overlay = document.createElement('div')
    overlay.id = 'voice-chat-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Modo voz do ARIS-9')
    overlay.setAttribute('data-testid', 'voice-chat-overlay')
    overlay.innerHTML = `
      <header class="vc-header">
        <div class="vc-title">ARIS-9 // MODO VOZ</div>
        <div class="vc-actions">
          <label class="vc-toggle" title="Mantém o mic aberto após cada resposta">
            <input type="checkbox" id="vc-always" data-testid="vc-always-listen"> escuta sempre
          </label>
          <label class="vc-toggle" title="Ativa ao ouvir a palavra de gatilho">
            <input type="checkbox" id="vc-wake" data-testid="vc-wake-toggle"> wake word:
          </label>
          <input type="text" id="vc-wake-word" data-testid="vc-wake-word" value="aris" maxlength="24" aria-label="Palavra de despertar" />
          <select id="vc-voice" data-testid="vc-voice-select" aria-label="Voz">
            <option value="nova">nova — energética</option>
            <option value="shimmer">shimmer — clara</option>
            <option value="alloy">alloy — neutra</option>
            <option value="coral">coral — calorosa</option>
            <option value="sage">sage — serena</option>
            <option value="onyx">onyx — grave</option>
            <option value="fable">fable — expressiva</option>
            <option value="echo">echo — suave</option>
            <option value="ash">ash — articulada</option>
          </select>
          <button id="vc-close" class="win-ctrl" data-testid="voice-chat-close" aria-label="Fechar modo voz">✕</button>
        </div>
      </header>
      <section class="vc-transcript" id="vc-transcript" data-testid="voice-transcript" aria-live="polite"></section>
      <div class="vc-mic-wrap">
        <button id="vc-mic" class="vc-mic" data-testid="voice-mic-btn" aria-label="Pressione para falar">
          <span class="vc-mic-ring"></span>
          <span class="vc-mic-icon">🎙</span>
        </button>
        <div class="vc-status" id="vc-status">Pressione o microfone (ou barra de espaço) para falar</div>
        <button id="vc-stop" class="vc-secondary" data-testid="voice-stop-btn" aria-label="Interromper fala do ARIS-9">Interromper voz</button>
      </div>
    `
    document.body.appendChild(overlay)

    transcript = overlay.querySelector('#vc-transcript')
    micBtn     = overlay.querySelector('#vc-mic')
    statusEl   = overlay.querySelector('#vc-status')
    const voiceSel = overlay.querySelector('#vc-voice')
    const closeBtn = overlay.querySelector('#vc-close')
    const stopBtn  = overlay.querySelector('#vc-stop')
    const alwaysChk = overlay.querySelector('#vc-always')
    const wakeChk   = overlay.querySelector('#vc-wake')
    const wakeInp   = overlay.querySelector('#vc-wake-word')

    // Restaura preferências
    if (window.aris9Prefs) {
      const p = window.aris9Prefs.get()
      voiceSel.value = p.ttsVoice || 'nova'
      alwaysChk.checked = !!p.voiceAlwaysListen
      wakeChk.checked   = !!p.wakeWordEnabled
      wakeInp.value     = p.wakeWord || 'aris'
    }
    voiceSel.addEventListener('change', () => window.aris9Prefs?.set('ttsVoice', voiceSel.value))
    alwaysChk.addEventListener('change', () => {
      window.aris9Prefs?.set('voiceAlwaysListen', alwaysChk.checked)
      _setStatus(alwaysChk.checked ? 'Escuta sempre ativa — vou reabrir o mic após cada resposta.' : 'Escuta sempre desligada.')
    })
    wakeChk.addEventListener('change', () => {
      window.aris9Prefs?.set('wakeWordEnabled', wakeChk.checked)
      _syncWakeDetector()
    })
    wakeInp.addEventListener('change', () => {
      window.aris9Prefs?.set('wakeWord', wakeInp.value.trim() || 'aris')
      if (wakeChk.checked) _syncWakeDetector(true) // reinicia com nova palavra
    })

    closeBtn.addEventListener('click', close)
    stopBtn.addEventListener('click', () => window.aris9Voice?.stopSpeaking())

    // Push-to-talk / toque simples
    let holdTimer = null
    let heldMode = false
    async function onDown (e) {
      if (busy) return
      if (e.repeat) return
      heldMode = false
      holdTimer = setTimeout(() => { heldMode = true }, 250)
      await _startTalking()
    }
    async function onUp () {
      clearTimeout(holdTimer)
      // Se foi tap curto (<250ms), mantém gravando até novo tap
      if (!heldMode) return
      await _stopTalking()
    }
    micBtn.addEventListener('mousedown', onDown)
    micBtn.addEventListener('touchstart', e => { e.preventDefault(); onDown(e) }, { passive: false })
    micBtn.addEventListener('mouseup', onUp)
    micBtn.addEventListener('mouseleave', () => { if (heldMode) onUp() })
    micBtn.addEventListener('touchend', e => { e.preventDefault(); onUp() })

    // Tap alterna gravação
    micBtn.addEventListener('click', async () => {
      if (heldMode || busy) return
      if (window.aris9Voice?.isRecording()) {
        await _stopTalking()
      } else if (!window.aris9Voice?.isRecording()) {
        // Se o click seguiu um mousedown, já iniciou. Ignora.
      }
    })

    // Barra de espaço = toggle
    document.addEventListener('keydown', async e => {
      if (!overlay.classList.contains('open')) return
      if (e.key === ' ' && !e.repeat && document.activeElement !== voiceSel) {
        e.preventDefault()
        if (window.aris9Voice?.isRecording()) await _stopTalking()
        else await _startTalking()
      }
      if (e.key === 'Escape') close()
    })
    return overlay
  }

  function _line (who, text, cls = '') {
    if (!transcript) return
    const div = document.createElement('div')
    div.className = `vc-line ${cls}`.trim()
    div.setAttribute('data-testid', `vc-line-${who}`)
    div.innerHTML = `<strong>${who}:</strong> <span></span>`
    div.querySelector('span').textContent = text
    transcript.appendChild(div)
    transcript.scrollTop = transcript.scrollHeight
    return div.querySelector('span')
  }
  function _setStatus (s) { if (statusEl) statusEl.textContent = s }

  async function _startTalking (auto = false) {
    if (busy || !window.aris9Voice) return
    window.aris9Voice.stopSpeaking()

    const prefs = window.aris9Prefs?.get?.() || {}
    const useVAD = auto || prefs.voiceAlwaysListen // detecção automática de silêncio

    try {
      _setStatus(useVAD ? 'Estou escutando… (pare de falar para eu responder)' : 'Gravando… solte para enviar (ou toque de novo)')
      micBtn.classList.add('recording')

      if (useVAD) {
        // gravação contínua com auto-stop por silêncio
        busy = true
        const myEpoch = ++_vadEpoch
        const text = await window.aris9Voice.startContinuousRecord({
          silenceMs: 1400, maxMs: 20000, minMs: 700,
          onLevel: (rms) => _pulseMic(rms)
        })
        micBtn.classList.remove('recording')
        // Se o overlay foi fechado ou outro turno começou, descarta o resultado
        if (myEpoch !== _vadEpoch || !overlay.classList.contains('open')) {
          busy = false
          return
        }
        await _handleTranscribedText(text)
        busy = false
        return
      }
      busy = true
      await window.aris9Voice.startRecord()
      busy = false
    } catch (err) {
      _setStatus('Falha ao acessar microfone: ' + (err.message || err))
      micBtn.classList.remove('recording')
      busy = false
    }
  }

  // Anima o glow do mic conforme o volume detectado
  function _pulseMic (rms) {
    if (!micBtn) return
    const intensity = Math.min(1, rms * 20)  // 0..1
    micBtn.style.boxShadow = `0 0 ${30 + intensity * 60}px rgba(255,90,110,${0.4 + intensity * 0.5})`
  }

  // ── Wake word detector ─────────────────────────────────────
  let wakeDetector = null
  function _syncWakeDetector (forceReboot = false) {
    const prefs = window.aris9Prefs?.get?.() || {}
    const shouldRun = !!prefs.wakeWordEnabled && overlay?.classList.contains('open')

    if (wakeDetector && (forceReboot || !shouldRun)) {
      try { wakeDetector.stop() } catch {}
      wakeDetector = null
    }
    if (!shouldRun) return
    if (wakeDetector) return  // já rodando

    try {
      const word = String(prefs.wakeWord || 'aris').toLowerCase().trim() || 'aris'
      wakeDetector = window.aris9Voice.createWakeWordDetector(word, async () => {
        // Se está no meio de algo, ignora para não sobrepor
        if (busy || window.aris9Voice.isRecording()) return
        // Beep curto para dar sinal
        try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play() } catch {}
        _setStatus(`Ouvi "${word}" — falando pra você agora…`)
        _startTalking(true).catch(err => console.debug('[wake] start err', err))
      })
      wakeDetector.start()
      _setStatus(`Wake word ativa: diga "${word}" para começar.`)
    } catch (err) {
      _setStatus('Wake word indisponível: ' + err.message)
      // desmarca o checkbox
      const chk = overlay?.querySelector('#vc-wake')
      if (chk) chk.checked = false
      window.aris9Prefs?.set('wakeWordEnabled', false)
    }
  }

  async function _handleTranscribedText (text) {
    if (!text) { _setStatus('Nada capturado. Toque no mic para tentar de novo.'); return }
    _line('você', text, 'user')
    _setStatus('Pensando…')

    let answer = '(sem resposta)'
    if (typeof window.agentSend === 'function') {
      const start = performance.now()
      const r = await window.agentSend(text)
      window.aris9Metrics?.logTurn({ latencyMs: Math.round(performance.now() - start) })
      answer = r?.texto || answer
    }
    _line('ARIS-9', answer, 'aris')
    _setStatus('Falando… (toque em Interromper para parar)')

    try {
      const audio = await window.aris9Voice.speak(answer)
      if (audio) {
        await new Promise(res => {
          audio.onended = res
          if (audio.ended) res()
        })
      }
    } catch (err) {
      _setStatus('Erro no TTS: ' + (window.aris9ExplainError?.(err.message) || err.message))
      return
    }

    // Modo "escuta sempre": reabre o mic após o áudio da resposta terminar
    const prefs = window.aris9Prefs?.get?.() || {}
    if (prefs.voiceAlwaysListen && overlay.classList.contains('open')) {
      _setStatus('Sua vez — pode continuar falando.')
      setTimeout(() => _startTalking(true).catch(() => {}), 350)
    } else {
      _setStatus('Pronto. Pressione o microfone para falar de novo.')
    }
  }

  async function _stopTalking () {
    if (!window.aris9Voice || !window.aris9Voice.isRecording()) return
    busy = true
    micBtn.classList.remove('recording')
    _setStatus('Transcrevendo…')
    try {
      const text = await window.aris9Voice.stopRecord()
      await _handleTranscribedText(text)
    } catch (err) {
      _setStatus('Erro: ' + (window.aris9ExplainError?.(err.message) || err.message))
    } finally {
      busy = false
    }
  }

  function open () {
    _build()
    overlay.classList.add('open')
    document.body.classList.add('vc-open')
    if (transcript && !transcript.hasChildNodes()) {
      _line('ARIS-9', 'Modo voz ativo. Pressione o microfone e fale — eu escuto em pt-BR e respondo em voz. Ative "escuta sempre" para conversa contínua ou "wake word" para começar dizendo uma palavra.', 'aris')
    }
    _setStatus('Pressione o microfone (ou barra de espaço) para falar')
    _syncWakeDetector()
  }
  function close () {
    if (!overlay) return
    _vadEpoch++  // invalida qualquer VAD em curso
    overlay.classList.remove('open')
    document.body.classList.remove('vc-open')
    window.aris9Voice?.stopSpeaking()
    if (window.aris9Voice?.isRecording()) {
      window.aris9Voice.stopRecord().catch(() => {})
    }
    if (wakeDetector) { try { wakeDetector.stop() } catch {} wakeDetector = null }
  }

  window.openVoiceChat  = open
  window.closeVoiceChat = close
})()
