const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const code = fs.readFileSync('./js/agent.js', 'utf8')
const calls = []
const context = {
  console,
  setTimeout,
  clearTimeout,
  fetch: async (url, options) => {
    calls.push(url)
    if (String(url).includes('/api/search/duckduckgo')) {
      return {
        ok: true,
        text: async () => '<a rel="nofollow" class="result__a" href="https://example.com">Exemplo</a>'
      }
    }

    return {
      ok: true,
      json: async () => ({
        message: {
          content: options?.body?.includes('intencao')
            ? '{"intencao":"buscar_web","query":"preço do bitcoin"}'
            : '{"acao":"resposta","texto":"Resposta final"}'
        }
      })
    }
  },
  window: {},
  document: { createElement: () => ({}) },
  self: {},
  globalThis: {}
}

vm.createContext(context)
vm.runInContext(code, context, { filename: 'js/agent.js' })

;(async () => {
  const result = await context.agentSend('pesquise o preço do bitcoin')
  assert.equal(result.acao, 'buscar_web')
  assert.ok(result.texto.includes('Resultados de pesquisa'))
  assert.ok(calls.some(url => String(url).includes('/api/search/duckduckgo')))
  console.log('agent three-step flow ok')
})().catch(err => {
  console.error(err)
  process.exit(1)
})
