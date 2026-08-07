const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const code = fs.readFileSync('./js/agent.js', 'utf8')
const context = {
  console,
  fetch: async () => ({ ok: true, json: async () => ({ message: { content: '{}' } }) }),
  setTimeout,
  clearTimeout,
  window: {},
  document: { createElement: () => ({}) },
  self: {},
  globalThis: {}
}

vm.createContext(context)
vm.runInContext(code, context, { filename: 'js/agent.js' })

const parsed = context._parseAction(JSON.stringify({
  acoes: [
    { acao: 'abrir_busca_web', parametro: 'react', texto: 'Pesquisando' },
    { acao: 'abrir_site', parametro: 'https://react.dev', texto: 'Abrindo' },
    { acao: 'resposta', texto: 'Pronto.' }
  ]
}))

assert.equal(parsed.acao, 'sequencia')
assert.equal(parsed.acoes.length, 3)
assert.equal(parsed.acoes[0].acao, 'abrir_busca_web')
assert.equal(parsed.acoes[1].acao, 'abrir_site')
assert.equal(parsed.acoes[2].acao, 'resposta')
assert.equal(parsed.acoes[2].texto, 'Pronto.')

console.log('agent sequence parsing ok')
