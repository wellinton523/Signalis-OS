// permission levels are ordered from least to most privileged
const Permission = Object.freeze({
  RESTRICTED: 0,
  STANDARD: 1,
  ADMIN: 2,
  GOD: 3
})

const PermissionName = Object.freeze({
  restricted: Permission.RESTRICTED,
  standard: Permission.STANDARD,
  admin: Permission.ADMIN,
  god: Permission.GOD
})

class PermissionManager {
  constructor(initialLevel = Permission.RESTRICTED) {
    this._level = initialLevel
  }

  get level() { return this._level }

  get name() {
    return Object.keys(PermissionName).find(name => PermissionName[name] === this._level)
  }

  can(requiredLevel) {
    return this._level >= requiredLevel
  }

  set(level) {
    if (!Number.isInteger(level) || level < Permission.RESTRICTED || level > Permission.GOD) {
      throw new Error('Nível de permissão inválido.')
    }
    this._level = level
    return this._level
  }

  setByName(name) {
    const normalized = String(name || '').toLowerCase()
    if (!(normalized in PermissionName)) throw new Error(`Nível desconhecido: ${name}`)
    return this.set(PermissionName[normalized])
  }
}

window.Permission = Permission
window.PermissionName = PermissionName
window.PermissionManager = PermissionManager
window.permissionManager = new PermissionManager()
