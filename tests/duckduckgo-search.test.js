const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const code = fs.readFileSync('./js/agent.js', 'utf8')
const context = { console, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({}) }) }
vm.createContext(context)
vm.runInContext(code, context, { filename: 'js/agent.js' })

const html = `
<html>
  <body>
    <a rel="nofollow" class="result__a" href="https://example.com/first">First result</a>
    <a rel="nofollow" class="result__a" href="https://example.com/second">Second result</a>
  </body>
</html>`

const results = context._extractSearchResults(html)
assert.equal(results.length, 2)
assert.equal(results[0].title, 'First result')
assert.equal(results[0].url, 'https://example.com/first')
assert.equal(results[1].title, 'Second result')

console.log('duckduckgo parser ok')
