import {
    PokeTool, LikeTool, RecallTool, MuteTool, MemberInfoTool,
    SearchTool, ImageSearchTool, MusicTool, WeatherTool, TranslateTool,
    WebParserTool, ReminderTool, DrawTool, ChatHistoryTool,
    TOOL_MAP, TOOL_CONFIG
} from './index.js'
import Config from '../../components/Config.js'

/**
 * 工具管理器 - 管理所有工具的注册和执行
 * 参考 bl-chat-plugin 架构设计
 */
class ToolManager {
    constructor() {
        this.toolInstances = new Map()
        this.initialized = false
    }

    /**
     * 初始化工具管理器
     */
    init() {
        if (this.initialized) return

        // 注册所有工具实例
        const tools = [
            new PokeTool(),
            new LikeTool(),
            new RecallTool(),
            new MuteTool(),
            new MemberInfoTool(),
            new SearchTool(),
            new ImageSearchTool(),
            new MusicTool(),
            new WeatherTool(),
            new TranslateTool(),
            new WebParserTool(),
            new ReminderTool(),
            new DrawTool(),
            new ChatHistoryTool()
        ]

        for (const tool of tools) {
            this.toolInstances.set(tool.name, tool)
        }

        this.initialized = true
        logger.info(`[ToolManager] 已加载 ${this.toolInstances.size} 个工具`)
    }

    /**
     * 获取启用的工具列表
     */
    getEnabledTools() {
        const config = Config.getConfig()
        const enabledToolNames = config.smartMode?.tools?.enabledTools || []

        if (!enabledToolNames.length) {
            return []
        }

        return enabledToolNames
            .map(name => this.toolInstances.get(name))
            .filter(Boolean)
    }

    /**
     * 获取工具信息列表（用于 OpenAI Function Calling）
     */
    getToolInfos() {
        const enabledTools = this.getEnabledTools()
        return enabledTools.map(tool => tool.getToolInfo())
    }

    /**
     * 获取所有可用工具名称
     */
    getAllToolNames() {
        return Array.from(this.toolInstances.keys())
    }

    /**
     * 执行工具
     * @param {string} toolName - 工具名称
     * @param {Object} params - 工具参数
     * @param {Object} e - 事件对象
     */
    async executeTool(toolName, params, e) {
        const tool = this.toolInstances.get(toolName)
        if (!tool) {
            throw new Error(`工具 ${toolName} 不存在`)
        }

        logger.info(`[ToolManager] 执行工具: ${toolName}`)
        logger.debug(`[ToolManager] 参数:`, params)

        const result = await tool.execute(params, e)

        logger.info(`[ToolManager] 工具 ${toolName} 执行完成`)
        return result
    }

    /**
     * 检查工具是否启用
     */
    isToolEnabled(toolName) {
        const config = Config.getConfig()
        const enabledTools = config.smartMode?.tools?.enabledTools || []
        return enabledTools.includes(toolName)
    }

    /**
     * 获取工具配置信息（用于锅巴配置界面）
     */
    getToolConfig() {
        return TOOL_CONFIG
    }

    /**
     * 处理 AI 返回的工具调用请求
     * @param {Array} toolCalls - AI 返回的 tool_calls
     * @param {Object} e - 事件对象
     * @returns {Array} - 工具执行结果
     */
    async processToolCalls(toolCalls, e) {
        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return []
        }

        const config = Config.getConfig()
        const debugLog = config.smartMode?.tools?.debugLog

        const results = []

        for (const toolCall of toolCalls) {
            const { id, type, function: funcData } = toolCall

            if (type !== 'function') continue

            const toolName = funcData.name
            let params

            try {
                params = JSON.parse(funcData.arguments || '{}')
            } catch (error) {
                logger.error(`[ToolManager] 解析工具参数失败:`, error)
                results.push({
                    toolCallId: id,
                    toolName: toolName,
                    error: '参数解析失败'
                })
                continue
            }

            // 添加发送者角色信息（用于禁言工具）
            if (toolName === 'muteTool' && e.sender?.role) {
                params.senderRole = e.sender.role
            }

            // 详细日志输出
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
                    logger.mark(`====================================\n`)
                }

                results.push({
                    toolCallId: id,
                    toolName: toolName,
                    result: result
                })
            } catch (error) {
                logger.error(`[ToolManager] 执行工具 ${toolName} 失败:`, error)
                if (debugLog) {
                    logger.mark(`错误: ${error.message}`)
                    logger.mark(`====================================\n`)
                }
                results.push({
                    toolCallId: id,
                    toolName: toolName,
                    error: error.message
                })
            }
        }

        return results
    }
}

// 导出单例实例
export const toolManager = new ToolManager()
