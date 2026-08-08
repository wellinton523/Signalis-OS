(function () {
  let resolveAuthenticated
  const ready = new Promise(resolve => { resolveAuthenticated = resolve })

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
    return payload
  }

  function setRemoteButton(enabled) {
    const button = document.getElementById('remote-access-toggle')
    if (!button) return
    button.textContent = enabled ? '[ ACESSO REMOTO: ATIVO ]' : '[ ACESSO REMOTO: DESATIVADO ]'
    button.classList.toggle('remote-active', enabled)
  }

  function showLogin(message = '') {
    const overlay = document.getElementById('auth-overlay')
    overlay.hidden = false
    document.getElementById('auth-error').textContent = message
  }

  function unlock(status) {
    document.getElementById('auth-overlay').hidden = true
    setRemoteButton(status.remoteAccessEnabled)

    // Aplica o nível de permissão retornado pelo servidor
    if (status.permissionLevel && window.permissionManager) {
      try {
        window.permissionManager.setByName(status.permissionLevel)
      } catch { /* permissionManager ainda não carregado — tenta depois */ }
    }

    resolveAuthenticated(status)
  }

  window.signalisAuth = {
    whenAuthenticated: () => ready,
    async toggleRemoteAccess() {
      const status = await request('/api/auth/status')
      const next = !status.remoteAccessEnabled
      const result = await request('/api/auth/remote-access', { method: 'POST', body: { enabled: next } })
      setRemoteButton(result.remoteAccessEnabled)
      return result.remoteAccessEnabled
    }
  }

  window.addEventListener('load', async () => {
    document.getElementById('auth-form').addEventListener('submit', async event => {
      event.preventDefault()
      const username = document.getElementById('auth-username').value
      const password = document.getElementById('auth-password').value
      try {
        unlock(await request('/api/auth/login', { method: 'POST', body: { username, password } }))
      } catch (error) {
        showLogin(error.message)
      }
    })

    document.getElementById('remote-access-toggle').addEventListener('click', async () => {
      try {
        await window.signalisAuth.toggleRemoteAccess()
      } catch (error) {
        alert(error.message)
      }
    })

    try {
      const status = await request('/api/auth/status')
      if (status.authenticated) unlock(status)
      else showLogin()
    } catch (error) {
      showLogin(error.message)
    }
  })
})()
