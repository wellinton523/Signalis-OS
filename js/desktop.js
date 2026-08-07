// desktop.js — inicialização do desktop, relógio e wallpaper

let _wallpaperOn = true

// ── Relógio ───────────────────────────────────────────────────
function _updateClock() {
  const now  = new Date()
  const pad  = n => String(n).padStart(2, '0')
  document.getElementById('clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

setInterval(_updateClock, 1000)
_updateClock()


// ── Wallpaper ─────────────────────────────────────────────────
function toggleWallpaper() {
  _wallpaperOn = !_wallpaperOn
  const wp  = document.getElementById('wallpaper')
  const btn = document.getElementById('btn-wallpaper')
  wp.classList.toggle('hidden', !_wallpaperOn)
  btn.textContent = _wallpaperOn ? '[ WALLPAPER ON ]' : '[ WALLPAPER OFF ]'
}
