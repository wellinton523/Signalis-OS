;(function () {

  // ── system.screenshot ────────────────────────────────────────
  // Captura a tela atual e retorna como data URL base64 (PNG).
  window.toolManager.register({
    name: 'system.screenshot', version: '1.0.0', category: 'system',
    description: 'Captura a tela atual do computador e retorna a imagem como base64 PNG. Útil para entender o que está acontecendo na tela, ler mensagens de erro visíveis e identificar o estado de aplicativos abertos.',
    permission: window.Permission.ADMIN,
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Região específica a capturar: {x, y, width, height}. Omita para captura completa.'
        }
      }
    },
    async execute({ region } = {}) {
      const res = await window.api.screenshot(region ?? null)
      if (res?.error) throw new Error(res.error)
      return res
    }
  })

  // ── system.ocr ───────────────────────────────────────────────
  // Captura a tela e extrai texto via OCR no servidor.
  window.toolManager.register({
    name: 'system.ocr', version: '1.0.0', category: 'system',
    description: 'Captura a tela e extrai todo o texto visível usando OCR (reconhecimento óptico de caracteres). Útil para ler mensagens de erro, textos em janelas e conteúdo de aplicativos que não expõem API.',
    permission: window.Permission.ADMIN,
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Região específica: {x, y, width, height}. Omita para tela completa.'
        }
      }
    },
    async execute({ region } = {}) {
      const res = await window.api.screenshotOcr(region ?? null)
      if (res?.error) throw new Error(res.error)
      return res
    }
  })

})()
