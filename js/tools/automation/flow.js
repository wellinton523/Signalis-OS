;(function () {

  // ── automation.flow ───────────────────────────────────────────
  // Executa um fluxo de múltiplas tools em sequência, passando resultados entre etapas.
  window.toolManager.register({
    name: 'automation.flow', version: '1.0.0', category: 'automation',
    description: 'Executa uma sequência de ferramentas em ordem, passando o resultado de cada etapa para a próxima. Ideal para automações compostas: organizar pasta, converter arquivos, gerar relatório — tudo em uma só chamada.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Lista de etapas. Cada etapa: {tool: "nome.ferramenta", args: {...}}',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Nome da ferramenta.' },
              args: { type: 'object', description: 'Argumentos da ferramenta.' }
            },
            required: ['tool']
          }
        },
        stopOnError: {
          type: 'boolean',
          description: 'Interrompe o fluxo ao primeiro erro. Padrão: true.'
        }
      },
      required: ['steps']
    },
    async execute({ steps, stopOnError = true }) {
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('A lista de etapas é obrigatória.')
      if (steps.length > 20) throw new Error('Máximo de 20 etapas por fluxo.')

      const results = []
      let lastResult = null

      for (let i = 0; i < steps.length; i++) {
        const step  = steps[i]
        const tool  = String(step.tool || '').trim()
        const args  = step.args ?? {}

        if (!tool) {
          results.push({ step: i + 1, tool: '?', skipped: true, reason: 'Nome da ferramenta ausente.' })
          continue
        }

        const internalName = window.toolManager?.resolveFuncName?.(tool) ?? tool
        const entry = { step: i + 1, tool: internalName, args }

        try {
          const result = await window.toolManager.execute(internalName, args, { source: 'automation.flow' })
          entry.result = result
          entry.ok     = true
          lastResult   = result
        } catch (err) {
          entry.ok    = false
          entry.error = err.message
          results.push(entry)
          if (stopOnError) {
            return {
              completed: false, stoppedAt: i + 1,
              reason: `Etapa ${i + 1} (${tool}) falhou: ${err.message}`,
              results
            }
          }
        }

        results.push(entry)
      }

      const successCount = results.filter(r => r.ok).length
      return {
        completed:    true,
        stepsTotal:   steps.length,
        stepsOk:      successCount,
        stepsFailed:  steps.length - successCount,
        lastResult,
        results
      }
    }
  })

  // ── automation.schedule ───────────────────────────────────────
  // Agenda a execução de uma tool para daqui a N segundos (single-shot, in-session).
  window.toolManager.register({
    name: 'automation.schedule', version: '1.0.0', category: 'automation',
    description: 'Agenda a execução de uma ferramenta para daqui a um determinado número de segundos (dentro da sessão atual). Útil para atrasar ações ou criar lembretes de curto prazo.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        tool:    { type: 'string',  description: 'Nome da ferramenta a executar.' },
        args:    { type: 'object',  description: 'Argumentos da ferramenta.' },
        delayMs: { type: 'integer', description: 'Atraso em milissegundos antes de executar. Máximo: 300000 (5 min).' },
        label:   { type: 'string',  description: 'Rótulo descritivo para identificar a tarefa agendada.' }
      },
      required: ['tool', 'delayMs']
    },
    async execute({ tool, args = {}, delayMs, label }) {
      if (!tool?.trim()) throw new Error('O nome da ferramenta é obrigatório.')
      const delay = Math.min(Math.max(parseInt(delayMs) || 0, 0), 300_000)
      const internalName = window.toolManager?.resolveFuncName?.(tool) ?? tool
      const scheduledAt = new Date().toISOString()

      // Agenda a execução
      setTimeout(async () => {
        try {
          await window.toolManager.execute(internalName, args, { source: 'automation.schedule' })
          console.info(`[ARIS-9 schedule] Tarefa "${label || tool}" executada.`)
        } catch (err) {
          console.warn(`[ARIS-9 schedule] Erro na tarefa "${label || tool}": ${err.message}`)
        }
      }, delay)

      return {
        scheduled:    true,
        tool:         internalName,
        label:        label || tool,
        delayMs:      delay,
        executeAfter: new Date(Date.now() + delay).toISOString(),
        scheduledAt
      }
    }
  })

})()
