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
    calls.push({ url, body: options?.body })
    return {
      ok: true,
      json: async () => ({ message: { content: '{"acao":"resposta","texto":"ok"}' } })
    }
  },
  window: {
    __AI_BACKEND_URL: '/api/llm/chat',
    __AI_MODEL: 'gemma4:cloud'
  },
  document: { createElement: () => ({}) },
  self: {},
  globalThis: {}
}

vm.createContext(context)
vm.runInContext(code, context, { filename: 'js/agent.js' })

;(async () => {
  const result = await context.agentSend('olá')
  assert.equal(result.acao, 'resposta')
  assert.ok(calls.some(call => String(call.url).includes('/api/llm/chat')))
  const payload = JSON.parse(calls[0].body)
  assert.equal(payload.model, 'gemma4:cloud')
  console.log('agent cloud backend ok')
})().catch(err => {
  console.error(err)
  process.exit(1)
})
