import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import Config from '../../components/Config.js'
import { removeTrailingSlash, hidePrivacyInfo } from '../common.js'

export class ModelRouter {
  createProxyAgent(proxyUrl) {
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

  getFallbackApiConfig(config) {
    if (config.ss_apiBaseUrl || config.ss_api) {
      return {
        baseUrl: removeTrailingSlash(config.ss_apiBaseUrl || config.ss_api),
        apiKey: config.ss_Key,
        model: config.ss_model || 'gpt-4o',
        useProxy: false,
        proxyUrl: '',
        customRequestBody: {}
      }
    }

    const sfKey = Array.isArray(config.sf_keys) && config.sf_keys.length > 0
      ? config.sf_keys[0]
      : (config.sfKey || '')

    return {
      baseUrl: removeTrailingSlash(config.sfBaseUrl || 'https://api.siliconflow.cn/v1'),
      apiKey: sfKey,
      model: config.translateModel || config.sf_model || 'deepseek-ai/DeepSeek-V3',
      useProxy: false,
      proxyUrl: '',
      customRequestBody: {}
    }
  }

  getApiConfig(purpose, defaultConfig = null) {
    const config = Config.getConfig()
    const mapping = {
      toolCall: 'toolCallModel',
      vision: 'visionModel',
      drawing: 'drawingModel',
      search: 'searchModel',
      chat: 'chatModel'
    }
    const selectedRemark = config.smartMode?.tools?.models?.[mapping[purpose]]

    if (selectedRemark) {
      const selected = (config.smart_APIList || []).find((item) => item.remark === selectedRemark)
      if (selected) {
        return {
          baseUrl: removeTrailingSlash(selected.baseUrl || selected.api || defaultConfig?.baseUrl || this.getFallbackApiConfig(config).baseUrl),
          apiKey: selected.apiKey || selected.key || defaultConfig?.apiKey || this.getFallbackApiConfig(config).apiKey,
          model: selected.modelId || selected.model || defaultConfig?.model || this.getFallbackApiConfig(config).model,
          useProxy: Boolean(selected.useProxy && config.smartMode?.proxy?.url),
          proxyUrl: config.smartMode?.proxy?.url || '',
          customRequestBody: selected.customRequestBody || {}
        }
      }

      logger.warn(`[ModelRouter] 未找到模型 "${selectedRemark}"，回退默认配置`)
    }

    if (defaultConfig) {
      return {
        baseUrl: removeTrailingSlash(defaultConfig.baseUrl),
        apiKey: defaultConfig.apiKey,
        model: defaultConfig.model,
        useProxy: false,
        proxyUrl: '',
        customRequestBody: {}
      }
    }

    return this.getFallbackApiConfig(config)
  }

  async chat({ messages, tools, purpose, defaultConfig, temperature }) {
    const apiConfig = this.getApiConfig(purpose, defaultConfig)
    const url = apiConfig.baseUrl.endsWith('/chat/completions')
      ? apiConfig.baseUrl
      : `${apiConfig.baseUrl}/chat/completions`

    const requestBody = {
      model: apiConfig.model,
      messages,
      stream: false,
      ...apiConfig.customRequestBody
    }

    if (typeof temperature === 'number') {
      requestBody.temperature = temperature
    }

    if (tools?.length) {
      requestBody.tools = tools
      requestBody.tool_choice = 'auto'
    }

    try {
      const requestOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }

      if (apiConfig.useProxy && apiConfig.proxyUrl) {
        requestOptions.agent = this.createProxyAgent(apiConfig.proxyUrl)
        if (Config.getConfig()?.smartMode?.tools?.debugLog) {
          logger.mark(`[ModelRouter] ${purpose} 使用代理: ${hidePrivacyInfo(apiConfig.proxyUrl)}`)
        }
      }

      const response = await fetch(url, requestOptions)
      const data = await response.json()
      const choice = data?.choices?.[0]
      const message = choice?.message

      if (!message) {
        throw new Error(data?.error?.message || data?.message || '模型返回为空')
      }

      return {
        content: message.content || '',
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        reasoning_content: message.reasoning_content || choice?.reasoning_content,
        sources: data?.sources
      }
    } catch (error) {
      logger.error(`[ModelRouter] ${purpose} 请求失败: ${hidePrivacyInfo(error.message)}`)
      throw error
    }
  }
}

export const modelRouter = new ModelRouter()
