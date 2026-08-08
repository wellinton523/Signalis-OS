;(function () {

  async function _music(action, value) {
    const result = await window.api.musicControl(action, value)
    if (result?.error) throw new Error(result.error)
    return result
  }

  window.toolManager.register({
    name: 'media.play_pause', version: '1.0.0', category: 'media',
    description: 'Alterna entre play e pause na mídia em reprodução.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('play_pause') }
  })

  window.toolManager.register({
    name: 'media.play', version: '1.0.0', category: 'media',
    description: 'Inicia ou retoma a reprodução de música/mídia.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('play') }
  })

  window.toolManager.register({
    name: 'media.pause', version: '1.0.0', category: 'media',
    description: 'Pausa a reprodução de música/mídia.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('pause') }
  })

  window.toolManager.register({
    name: 'media.stop', version: '1.0.0', category: 'media',
    description: 'Para completamente a reprodução de música/mídia.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('stop') }
  })

  window.toolManager.register({
    name: 'media.next', version: '1.0.0', category: 'media',
    description: 'Avança para a próxima faixa/música.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('next') }
  })

  window.toolManager.register({
    name: 'media.previous', version: '1.0.0', category: 'media',
    description: 'Volta para a faixa/música anterior.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('previous') }
  })

  window.toolManager.register({
    name: 'media.volume', version: '1.0.0', category: 'media',
    description: 'Ajusta o volume do sistema. Valor de 0 a 100.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'integer', description: 'Volume de 0 (mudo) a 100 (máximo).' }
      },
      required: ['level']
    },
    async execute({ level }) {
      const n = parseInt(level)
      if (isNaN(n) || n < 0 || n > 100) throw new Error('O volume deve ser um número entre 0 e 100.')
      return _music('volume', n)
    }
  })

  window.toolManager.register({
    name: 'media.mute', version: '1.0.0', category: 'media',
    description: 'Ativa ou desativa o mudo do volume do sistema.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('mute') }
  })

  window.toolManager.register({
    name: 'media.status', version: '1.0.0', category: 'media',
    description: 'Retorna o status atual da mídia: faixa, artista, estado (tocando/pausado) e volume.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() { return _music('status') }
  })

  window.toolManager.register({
    name: 'media.open', version: '1.0.0', category: 'media',
    description: 'Abre um arquivo de áudio ou vídeo para reprodução no player padrão.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho local do arquivo de mídia a abrir.' }
      },
      required: ['path']
    },
    async execute({ path }) {
      if (!path) throw new Error('O caminho do arquivo é obrigatório.')
      return window.api.open(path)
    }
  })

})()
