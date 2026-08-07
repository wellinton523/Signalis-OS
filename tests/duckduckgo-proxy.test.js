const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const code = fs.readFileSync('./js/agent.js', 'utf8')
let requestedUrl = null
const context = {
  console,
  setTimeout,
  clearTimeout,
  URL: require('url').URL,
  fetch: async (url) => {
    requestedUrl = url
    return {
      ok: true,
      text: async () => '<html></html>'
    }
  },
  window: {},
  document: { createElement: () => ({}) },
  self: {},
  globalThis: {}
}

vm.createContext(context)
vm.runInContext(code, context, { filename: 'js/agent.js' })

async function run() {
  await context.searchDuckDuckGo('teste')
  assert.equal(requestedUrl, '/api/search/duckduckgo?q=teste')
  console.log('duckduckgo proxy test ok')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
