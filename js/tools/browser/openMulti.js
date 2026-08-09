// openMulti.js — Abre várias URLs de uma vez
;(function () {
  window.toolManager.register({
    name: 'browser.openMulti', version: '1.0.0', category: 'browser',
    description: 'Abre múltiplas URLs de uma só vez. Use para montar rapidamente um "ambiente" (ex: Gmail + Slack + Jira em uma frase).',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de URLs HTTP/HTTPS a abrir em sequência.'
        },
        delayMs: {
          type: 'integer',
          description: 'Intervalo entre aberturas (ms). Padrão: 250.'
        }
      },
      required: ['urls']
    },
    async execute ({ urls, delayMs = 250 }) {
      if (!Array.isArray(urls) || urls.length === 0) throw new Error('Lista de URLs vazia.')
      if (urls.length > 20) throw new Error('Máximo de 20 URLs por vez.')

      const opened = []
      const failed = []
      for (const raw of urls) {
        const url = String(raw || '').trim()
        if (!/^https?:\/\//i.test(url)) { failed.push({ url: raw, reason: 'URL inválida' }); continue }
        try {
          await window.api.open(url)
          opened.push(url)
        } catch (err) {
          failed.push({ url, reason: err.message })
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, Math.min(2000, delayMs)))
      }
      return { opened: opened.length, urls: opened, failed }
    }
  })
})()
