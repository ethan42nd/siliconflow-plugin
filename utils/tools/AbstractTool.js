import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import Config from '../../components/Config.js'
import { hidePrivacyInfo } from '../common.js'

export class AbstractTool {
  constructor({ name, description, parameters = { type: 'object', properties: {}, required: [] } } = {}) {
    this.name = name || ''
    this.description = description || ''
    this.parameters = parameters
  }

  validateParameters(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return '参数必须是对象'
    }

    for (const requiredKey of this.parameters.required || []) {
      if (!(requiredKey in params)) {
        return `缺少必填参数: ${requiredKey}`
      }
    }

    for (const [key, value] of Object.entries(params)) {
      const schema = this.parameters.properties?.[key]
      if (!schema) continue

      if (schema.type === 'array') {
        if (typeof value === 'string') {
          params[key] = [value]
          continue
        }
        if (!Array.isArray(value)) {
          return `参数 ${key} 类型错误，应为数组`
        }
        continue
      }

      if (schema.type === 'integer') {
        if (typeof value === 'string' && /^-?\d+$/.test(value)) {
          params[key] = parseInt(value, 10)
        } else if (!Number.isInteger(value)) {
          return `参数 ${key} 类型错误，应为整数`
        }
      } else if (schema.type === 'number') {
        if (typeof value === 'string' && !Number.isNaN(Number(value))) {
          params[key] = Number(value)
        } else if (typeof value !== 'number') {
          return `参数 ${key} 类型错误，应为数字`
        }
      } else if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') {
          return `参数 ${key} 类型错误，应为布尔值`
        }
      } else if (schema.type === 'string' && typeof value !== 'string') {
        return `参数 ${key} 类型错误，应为字符串`
      }

      if (schema.minimum !== undefined && params[key] < schema.minimum) {
        return `参数 ${key} 不能小于 ${schema.minimum}`
      }
      if (schema.maximum !== undefined && params[key] > schema.maximum) {
        return `参数 ${key} 不能大于 ${schema.maximum}`
      }
    }

    return true
  }

  getToolInfo() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    }
  }

  getToolProxyConfig() {
    const proxyConfig = Config.getConfig()?.smartMode?.proxy || {}
    const enabledTools = Array.isArray(proxyConfig.enabledTools) ? proxyConfig.enabledTools : []
    const legacyToolProxy = proxyConfig.toolProxy || {}

    return {
      enabledTools,
      legacyToolProxy
    }
  }

  getProxyUrl() {
    return Config.getConfig()?.smartMode?.proxy?.url?.trim() || ''
  }

  isToolDebugEnabled() {
    return Boolean(Config.getConfig()?.smartMode?.tools?.debugLog)
  }

  isToolProxyEnabled() {
    const proxyUrl = this.getProxyUrl()
    if (!proxyUrl || !this.name) return false

    const { enabledTools, legacyToolProxy } = this.getToolProxyConfig()
    if (enabledTools.includes(this.name)) {
      return true
    }

    return Boolean(legacyToolProxy?.[this.name])
  }

  createProxyAgent(proxyUrl = this.getProxyUrl()) {
    if (!proxyUrl) return null

    const protocol = String(proxyUrl).split(':')[0]?.toLowerCase()
    if (protocol === 'http' || protocol === 'https') {
      return new HttpsProxyAgent(proxyUrl)
    }

    if (protocol === 'socks' || protocol === 'socks4' || protocol === 'socks4a' || protocol === 'socks5' || protocol === 'socks5h') {
      return new SocksProxyAgent(proxyUrl)
    }

    throw new Error(`不支持的代理协议: ${protocol || 'unknown'}`)
  }

  getProxyAgent() {
    const proxyUrl = this.getProxyUrl()
    if (!proxyUrl) return null

    if (this._proxyAgent && this._proxyAgentUrl === proxyUrl) {
      return this._proxyAgent
    }

    this._proxyAgent = this.createProxyAgent(proxyUrl)
    this._proxyAgentUrl = proxyUrl
    return this._proxyAgent
  }

  logProxyUsage(context = '') {
    if (!this.isToolProxyEnabled() || !this.isToolDebugEnabled()) {
      return
    }

    const suffix = context ? ` (${context})` : ''
    logger.debug(`[${this.name}] 使用代理${suffix}: ${hidePrivacyInfo(this.getProxyUrl())}`)
  }

  buildFetchOptions(options = {}, context = '') {
    const requestOptions = { ...options }
    if (!this.isToolProxyEnabled()) {
      return requestOptions
    }

    requestOptions.agent = this.getProxyAgent()
    this.logProxyUsage(context)
    return requestOptions
  }

  buildAxiosConfig(config = {}, context = '') {
    const requestConfig = { ...config }
    if (!this.isToolProxyEnabled()) {
      return requestConfig
    }

    const agent = this.getProxyAgent()
    requestConfig.httpAgent = agent
    requestConfig.httpsAgent = agent
    requestConfig.proxy = false
    this.logProxyUsage(context)
    return requestConfig
  }

  async execute(params, e) {
    const validation = this.validateParameters(params)
    if (validation !== true) {
      return { success: false, error: validation }
    }
    return await this.func(params, e)
  }

  async func() {
    throw new Error('工具必须实现 func 方法')
  }
}
