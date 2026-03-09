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
}

// 导出单例实例
export const toolManager = new ToolManager()
