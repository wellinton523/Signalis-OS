// windowManager.js
// ─────────────────────────────────────────────────────────────
// Gerencia a criação e comportamento das janelas flutuantes.
// Cada janela é um clone do <template> correspondente no HTML.
// ─────────────────────────────────────────────────────────────

let _zCounter = 100   // z-index crescente para "trazer à frente"

/**
 * Cria uma janela a partir de um <template id="tpl-*">
 * @param {string} templateId - ex: 'tpl-terminal'
 * @returns {HTMLElement} o elemento da janela criado
 */
function createWindow(templateId) {
  const tpl = document.getElementById(templateId)
  if (!tpl) return null

  const win = tpl.content.cloneNode(true).firstElementChild
  document.getElementById('windows-container').appendChild(win)

  _setupDrag(win)
  _setupControls(win)
  _bringToFront(win)

  // Trazer à frente ao clicar em qualquer parte da janela
  win.addEventListener('mousedown', () => _bringToFront(win))

  return win
}


// ── Lógica de arrastar a janela pela titlebar ─────────────────
function _setupDrag(win) {
  const titlebar = win.querySelector('[data-drag]')
  if (!titlebar) return

  // No mobile as janelas são fullscreen — desabilita drag para não conflitar com scroll.
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches

  let dragging = false
  let offsetX = 0, offsetY = 0

  function _start(clientX, clientY, target) {
    if (isMobile()) return
    if (target && target.tagName === 'BUTTON') return
    dragging = true
    offsetX = clientX - win.offsetLeft
    offsetY = clientY - win.offsetTop
  }

  function _move(clientX, clientY) {
    if (!dragging) return
    let x = clientX - offsetX
    let y = clientY - offsetY
    const maxX = window.innerWidth  - win.offsetWidth
    const maxY = window.innerHeight - win.offsetHeight
    x = Math.max(0, Math.min(x, maxX))
    y = Math.max(28, Math.min(y, maxY - 36))
    win.style.left = x + 'px'
    win.style.top  = y + 'px'
  }

  function _end() { dragging = false }

  // Mouse
  titlebar.addEventListener('mousedown', e => _start(e.clientX, e.clientY, e.target))
  document.addEventListener('mousemove', e => _move(e.clientX, e.clientY))
  document.addEventListener('mouseup', _end)

  // Touch
  titlebar.addEventListener('touchstart', e => {
    if (isMobile()) return
    const t = e.touches[0]
    if (!t) return
    _start(t.clientX, t.clientY, e.target)
  }, { passive: true })
  document.addEventListener('touchmove', e => {
    if (!dragging) return
    const t = e.touches[0]
    if (!t) return
    e.preventDefault()
    _move(t.clientX, t.clientY)
  }, { passive: false })
  document.addEventListener('touchend', _end)
  document.addEventListener('touchcancel', _end)
}


// ── Botões de controle (minimizar, fechar) ────────────────────
function _setupControls(win) {
  const body = win.querySelector('.os-window-body')

  win.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.action) {
        case 'close':
          win.remove()
          break
        case 'minimize':
          if (body) {
            const hidden = body.style.display === 'none'
            body.style.display = hidden ? '' : 'none'
            btn.textContent = hidden ? '─' : '□'
            win.style.height = hidden ? '' : 'auto'
          }
          break
      }
    })
  })
}


// ── Traz a janela para frente das outras ──────────────────────
function _bringToFront(win) {
  _zCounter++
  win.style.zIndex = _zCounter
}
