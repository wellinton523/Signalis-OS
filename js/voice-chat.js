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

    // Restaura voz preferida
    if (window.aris9Prefs) {
      voiceSel.value = window.aris9Prefs.get().ttsVoice || 'nova'
    }
    voiceSel.addEventListener('change', () => {
      window.aris9Prefs?.set('ttsVoice', voiceSel.value)
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

  async function _startTalking () {
    if (busy || !window.aris9Voice) return
    window.aris9Voice.stopSpeaking()
    try {
      _setStatus('Gravando… solte para enviar (ou toque de novo)')
      micBtn.classList.add('recording')
      await window.aris9Voice.startRecord()
    } catch (err) {
      _setStatus('Falha ao acessar microfone: ' + (err.message || err))
      micBtn.classList.remove('recording')
    }
  }

  async function _stopTalking () {
    if (!window.aris9Voice || !window.aris9Voice.isRecording()) return
    busy = true
    micBtn.classList.remove('recording')
    _setStatus('Transcrevendo…')
    try {
      const text = await window.aris9Voice.stopRecord()
      if (!text) { _setStatus('Nada capturado. Toque no mic para tentar de novo.'); busy = false; return }
      _line('você', text, 'user')
      _setStatus('Pensando…')

      // Fala com o agente (usa agentSend se disponível)
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
        await window.aris9Voice.speak(answer)
      } catch (err) {
        _setStatus('Erro no TTS: ' + window.aris9ExplainError(err.message || err))
        busy = false
        return
      }
      _setStatus('Pronto. Pressione o microfone para falar de novo.')
    } catch (err) {
      _setStatus('Erro: ' + window.aris9ExplainError(err.message || err))
    } finally {
      busy = false
    }
  }

  function open () {
    _build()
    overlay.classList.add('open')
    document.body.classList.add('vc-open')
    if (transcript && !transcript.hasChildNodes()) {
      _line('ARIS-9', 'Modo voz ativo. Pressione o microfone e fale — eu escuto em pt-BR e respondo em voz.', 'aris')
    }
    _setStatus('Pressione o microfone (ou barra de espaço) para falar')
  }
  function close () {
    if (!overlay) return
    overlay.classList.remove('open')
    document.body.classList.remove('vc-open')
    window.aris9Voice?.stopSpeaking()
    if (window.aris9Voice?.isRecording()) {
      window.aris9Voice.stopRecord().catch(() => {})
    }
  }

  window.openVoiceChat  = open
  window.closeVoiceChat = close
})()
