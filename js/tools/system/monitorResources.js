window.toolManager.register({
  name: 'system.resources', version: '1.0.0', category: 'system',
  description: 'Retorna uso atual de CPU, RAM e disco do sistema.',
  permission: window.Permission.RESTRICTED,
  parameters: { type: 'object', properties: {} },
  async execute() {
    const [info, cpu, disk] = await Promise.all([
      window.api.sysInfo(),
      window.api.cpuUsage(),
      window.api.diskUsage()
    ])
    const usedRamMB  = Math.round((info.totalRam - info.freeRam) / 1024 / 1024)
    const totalRamMB = Math.round(info.totalRam / 1024 / 1024)
    const usedDiskGB = (disk.used / 1024 / 1024 / 1024).toFixed(1)
    const totalDiskGB = (disk.total / 1024 / 1024 / 1024).toFixed(1)
    return {
      cpu: `${cpu}%`,
      ram: `${usedRamMB} / ${totalRamMB} MB`,
      disk: `${usedDiskGB} / ${totalDiskGB} GB`,
      hostname: info.hostname
    }
  }
})
