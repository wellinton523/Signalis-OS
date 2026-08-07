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

const cases = [
  {
    input: 'O que é um algoritmo?',
    expected: null
  },
  {
    input: 'pesquise o que é uma API',
    expected: 'buscar_web'
  },
  {
    input: 'pesquise o preço do bitcoin hoje',
    expected: 'buscar_web'
  },
  {
    input: 'olá',
    expected: null
  }
]

for (const testCase of cases) {
  const result = context._inferAction(testCase.input)
  if (testCase.expected === null) {
    assert.equal(result, null, `${testCase.input} -> ${result?.acao || result}`)
  } else {
    assert.equal(result.acao, testCase.expected, `${testCase.input} -> ${result.acao}`)
  }
}

console.log('agent intent heuristics ok')
