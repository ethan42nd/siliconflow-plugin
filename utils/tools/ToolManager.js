import { TOOL_MAP, TOOL_CONFIG } from './index.js'
import Config from '../../components/Config.js'

class ToolManager {
  constructor() {
    this.toolInstances = new Map()
    this.initialized = false
  }

  init() {
    if (this.initialized) return

    for (const ToolClass of Object.values(TOOL_MAP)) {
      const instance = new ToolClass()
      this.toolInstances.set(instance.name, instance)
    }

    this.initialized = true
    logger.info(`[ToolManager] 已加载 ${this.toolInstances.size} 个工具`)
  }

  getEnabledTools() {
    this.init()
    const enabledToolNames = Config.getConfig()?.smartMode?.tools?.enabledTools || []

    if (!enabledToolNames.length) {
      return Array.from(this.toolInstances.values())
    }

    return enabledToolNames
      .map((name) => this.toolInstances.get(name))
      .filter(Boolean)
  }

  getToolInfos() {
    return this.getEnabledTools().map((tool) => tool.getToolInfo())
  }

  getAllToolNames() {
    this.init()
    return Array.from(this.toolInstances.keys())
  }

  async executeTool(toolName, params, e) {
    this.init()
    const tool = this.toolInstances.get(toolName)
    if (!tool) {
      throw new Error(`工具 ${toolName} 不存在`)
    }

    logger.info(`[ToolManager] 执行工具: ${toolName}`)
    logger.debug('[ToolManager] 参数:', params)

    const result = await tool.execute(params, e)

    logger.info(`[ToolManager] 工具 ${toolName} 执行完成`)
    return result
  }

  isToolEnabled(toolName) {
    const enabledTools = Config.getConfig()?.smartMode?.tools?.enabledTools || []
    if (!enabledTools.length) {
      return this.toolInstances.has(toolName)
    }
    return enabledTools.includes(toolName)
  }

  getToolConfig() {
    return TOOL_CONFIG
  }

  async processToolCalls(toolCalls, e) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return []
    }

    const debugLog = Boolean(Config.getConfig()?.smartMode?.tools?.debugLog)
    const results = []

    for (const toolCall of toolCalls) {
      const { id, type, function: funcData } = toolCall
      if (type !== 'function') continue

      const toolName = funcData?.name
      let params

      try {
        params = JSON.parse(funcData?.arguments || '{}')
      } catch (error) {
        logger.error('[ToolManager] 解析工具参数失败:', error)
        results.push({
          toolCallId: id,
          toolName,
          error: '参数解析失败'
        })
        continue
      }

      if (toolName === 'muteTool' && e?.sender?.role) {
        params.senderRole = e.sender.role
      }

      if (debugLog) {
        logger.mark(`\n========== [工具调用] ${toolName} ==========`)
        logger.mark(`调用ID: ${id}`)
        logger.mark(`参数: ${JSON.stringify(params, null, 2)}`)
      }

      try {
        const result = await this.executeTool(toolName, params, e)

        if (debugLog) {
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          logger.mark(`结果: ${resultStr.substring(0, 500)}${resultStr.length > 500 ? '...(已截断)' : ''}`)
          logger.mark('====================================\n')
        }

        results.push({
          toolCallId: id,
          toolName,
          result
        })
      } catch (error) {
        logger.error(`[ToolManager] 执行工具 ${toolName} 失败:`, error)

        if (debugLog) {
          logger.mark(`错误: ${error.message}`)
          logger.mark('====================================\n')
        }

        results.push({
          toolCallId: id,
          toolName,
          error: error.message
        })
      }
    }

    return results
  }
}

export const toolManager = new ToolManager()
