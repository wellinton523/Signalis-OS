// notifications.js
// ─────────────────────────────────────────────────────────────
// Sistema de notificações do SIGNALIS-OS
//   • Toast in-app (canto superior central) — sempre ativo
//   • Notification API nativa do navegador — se permissão concedida
//   • Beep discreto via Web Audio API — sem ativo externo
// ─────────────────────────────────────────────────────────────

(function () {
  const CONTAINER_ID = 'notification-container'
  const MAX_TOASTS   = 4
  const DEFAULT_TTL  = 5200 // ms

  // Preferências persistentes (o usuário pode desligar por comando futuro)
  const PREF_KEY = 'aris9_notification_prefs'
  const prefs = _loadPrefs()

  function _loadPrefs () {
    try {
      const raw = localStorage.getItem(PREF_KEY)
      const p   = raw ? JSON.parse(raw) : {}
      return {
        sound:   p.sound   !== false,   // default: on
        native:  p.native  !== false,   // default: on
        inApp:   p.inApp   !== false    // default: on
      }
    } catch { return { sound: true, native: true, inApp: true } }
  }

  function _savePrefs () {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* ignora */ }
  }

  // ── Permissão nativa ──────────────────────────────────────
  // Só pedimos após a primeira interação real do usuário (via requestNativePermission).
  let _nativeAsked = false
  async function requestNativePermission () {
    if (!('Notification' in window)) return 'unsupported'
    if (_nativeAsked) return Notification.permission
    _nativeAsked = true
    if (Notification.permission === 'default') {
      try {
        const res = await Notification.requestPermission()
        return res
      } catch { return 'denied' }
    }
    return Notification.permission
  }

  // ── Beep discreto (Web Audio API) ─────────────────────────
  let _audioCtx = null
  function _beep (type = 'success') {
    if (!prefs.sound) return
    try {
      if (!_audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        _audioCtx = new AC()
      }
      // Se o contexto está suspenso (por autoplay policy), tenta retomar
      if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})

      const now = _audioCtx.currentTime
      const osc = _audioCtx.createOscillator()
      const gain = _audioCtx.createGain()
      osc.connect(gain)
      gain.connect(_audioCtx.destination)

      // Timbres por tipo — mantém a estética "console retro" do SIGNALIS-OS
      const profile = {
        success: [{ f: 880,  t: 0.00 }, { f: 1320, t: 0.09 }],
        info:    [{ f: 660,  t: 0.00 }],
        warn:    [{ f: 520,  t: 0.00 }, { f: 440,  t: 0.10 }],
        error:   [{ f: 220,  t: 0.00 }, { f: 180,  t: 0.10 }]
      }[type] || [{ f: 660, t: 0 }]

      osc.type = 'square'
      osc.frequency.setValueAtTime(profile[0].f, now)
      for (let i = 1; i < profile.length; i++) {
        osc.frequency.setValueAtTime(profile[i].f, now + profile[i].t)
      }
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)

      osc.start(now)
      osc.stop(now + 0.26)
    } catch { /* ignora falhas de áudio */ }
  }

  // ── Notificação nativa ────────────────────────────────────
  function _fireNative (title, message, type) {
    if (!prefs.native) return
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible') return // evita ruído se já está olhando
    try {
      const n = new Notification(title, {
        body: message,
        tag: 'aris9-response',
        silent: true // som fica com o Web Audio
      })
      n.onclick = () => { window.focus(); n.close() }
      setTimeout(() => { try { n.close() } catch {} }, 6000)
    } catch { /* ignora */ }
  }

  // ── Toast in-app ──────────────────────────────────────────
  function _ensureContainer () {
    let el = document.getElementById(CONTAINER_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = CONTAINER_ID
      el.setAttribute('aria-live', 'polite')
      el.setAttribute('aria-atomic', 'true')
      document.body.appendChild(el)
    }
    return el
  }

  function _renderToast (title, message, type) {
    if (!prefs.inApp) return
    const container = _ensureContainer()

    // Limita a fila
    while (container.children.length >= MAX_TOASTS) {
      container.removeChild(container.firstChild)
    }

    const toast = document.createElement('div')
    toast.className = `os-toast ${type || ''}`.trim()

    const titleEl = document.createElement('div')
    titleEl.className = 'os-toast-title'
    const titleSpan = document.createElement('span')
    titleSpan.textContent = title
    const closeBtn = document.createElement('button')
    closeBtn.className = 'os-toast-close'
    closeBtn.setAttribute('aria-label', 'fechar notificação')
    closeBtn.textContent = '✕'
    titleEl.appendChild(titleSpan)
    titleEl.appendChild(closeBtn)

    const msgEl = document.createElement('div')
    msgEl.className = 'os-toast-msg'
    msgEl.textContent = message

    toast.appendChild(titleEl)
    toast.appendChild(msgEl)
    container.appendChild(toast)

    // Animação de entrada
    requestAnimationFrame(() => toast.classList.add('show'))

    const dismiss = () => {
      if (!toast.isConnected) return
      toast.classList.remove('show')
      toast.classList.add('hide')
      setTimeout(() => { toast.remove() }, 320)
    }

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismiss() })
    toast.addEventListener('click', dismiss)

    setTimeout(dismiss, DEFAULT_TTL)
    return toast
  }

  // ── API pública ───────────────────────────────────────────
  // showNotification(title, message, type = 'info' | 'success' | 'warn' | 'error')
  function showNotification (title, message, type = 'info') {
    const t = String(title || 'SIGNALIS-OS')
    const m = String(message || '')
    _renderToast(t, m, type)
    _fireNative(t, m, type)
    _beep(type)
  }

  function setNotificationPref (key, value) {
    if (!(key in prefs)) return
    prefs[key] = !!value
    _savePrefs()
  }

  function getNotificationPrefs () { return { ...prefs } }

  window.showNotification       = showNotification
  window.requestNativePermission = requestNativePermission
  window.setNotificationPref    = setNotificationPref
  window.getNotificationPrefs   = getNotificationPrefs
})()
