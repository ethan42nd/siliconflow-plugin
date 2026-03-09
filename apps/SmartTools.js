import plugin from '../../../lib/plugins/plugin.js'
import { toolManager } from '../utils/tools/ToolManager.js'
import { checkPendingReminders } from '../utils/tools/index.js'
import Config from '../components/Config.js'
import axios from 'axios'
import schedule from 'node-schedule'

/**
 * 智能工具系统 - 支持 AI 调用工具的插件
 * 参考 bl-chat-plugin 架构设计
 */
export class SmartTools extends plugin {
    constructor() {
        super({
            name: '智能工具系统',
            dsc: 'AI 工具调用系统，支持多种工具',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '^#工具列表$',
                    fnc: 'listTools',
                    permission: 'master'
                },
                {
                    reg: '^#工具测试\\s*(\w+)?$',
                    fnc: 'testTool',
                    permission: 'master'
                }
            ]
        })

        // 初始化工具管理器
        toolManager.init()

        // 设置定时任务检查提醒
        this.initScheduledTasks()
    }

    /**
     * 初始化定时任务
     */
    initScheduledTasks() {
        // 每秒检查待触发的提醒
        schedule.scheduleJob('* * * * * *', async () => {
            try {
                await checkPendingReminders()
            } catch (error) {
                logger.error(`[SmartTools] 检查提醒失败:`, error)
            }
        })

        logger.info('[SmartTools] 定时任务已启动')
    }

    /**
     * 处理 AI 的工具调用请求
     * @param {Array} toolCalls - AI 返回的 tool_calls
     * @param {Object} e - 事件对象
     * @returns {Array} - 工具执行结果
     */
    async processToolCalls(toolCalls, e) {
        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return []
        }

        const results = []

        for (const toolCall of toolCalls) {
            const { id, type, function: funcData } = toolCall

            if (type !== 'function') continue

            const toolName = funcData.name
            let params

            try {
                params = JSON.parse(funcData.arguments || '{}')
            } catch (error) {
                logger.error(`[SmartTools] 解析工具参数失败:`, error)
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

            try {
                const result = await toolManager.executeTool(toolName, params, e)
                results.push({
                    toolCallId: id,
                    toolName: toolName,
                    result: result
                })
            } catch (error) {
                logger.error(`[SmartTools] 执行工具 ${toolName} 失败:`, error)
                results.push({
                    toolCallId: id,
                    toolName: toolName,
                    error: error.message
                })
            }
        }

        return results
    }

    /**
     * 构建带工具的请求数据
     * @param {Array} messages - 消息列表
     * @param {string} model - 模型名称
     * @returns {Object} - 请求数据
     */
    buildRequestDataWithTools(messages, model) {
        const config = Config.getConfig()
        const toolConfig = config.smartMode?.tools || {}

        if (!toolConfig.enable) {
            return { model, messages }
        }

        const tools = toolManager.getToolInfos()

        if (!tools.length) {
            return { model, messages }
        }

        return {
            model,
            messages,
            tools,
            tool_choice: 'auto'
        }
    }

    /**
     * 格式化工具结果为文本
     */
    formatToolResults(results) {
        if (!results || results.length === 0) {
            return ''
        }

        let formatted = '\n\n【工具执行结果】\n'

        for (const result of results) {
            if (result.error) {
                formatted += `[${result.toolName}] 执行失败: ${result.error}\n`
            } else {
                const resultStr = typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result, null, 2)

                // 截断过长的结果
                const truncated = resultStr.length > 500
                    ? resultStr.substring(0, 500) + '...(已截断)'
                    : resultStr

                formatted += `[${result.toolName}] ${truncated}\n`
            }
        }

        return formatted
    }

    /**
     * 列出所有工具
     */
    async listTools(e) {
        const allTools = toolManager.getAllToolNames()
        const enabledTools = toolManager.getEnabledTools().map(t => t.name)

        let msg = '【工具列表】\n\n'
        msg += `总共 ${allTools.length} 个工具，已启用 ${enabledTools.length} 个\n\n`

        for (const toolName of allTools) {
            const tool = toolManager.toolInstances.get(toolName)
            const isEnabled = enabledTools.includes(toolName)
            msg += `${isEnabled ? '✅' : '❌'} ${toolName}: ${tool.description.substring(0, 50)}...\n`
        }

        await e.reply(msg)
        return true
    }

    /**
     * 测试工具
     */
    async testTool(e) {
        const match = e.msg.match(/^#工具测试\s*(\w+)?$/)
        const toolName = match?.[1]

        if (!toolName) {
            await e.reply('请指定要测试的工具名称，如：#工具测试 pokeTool')
            return true
        }

        if (!toolManager.toolInstances.has(toolName)) {
            await e.reply(`工具 ${toolName} 不存在`)
            return true
        }

        await e.reply(`正在测试工具 ${toolName}...`)

        try {
            // 根据工具类型提供默认测试参数
            let testParams = {}
            switch (toolName) {
                case 'pokeTool':
                    testParams = { target: [String(e.user_id)], times: 1 }
                    break
                case 'likeTool':
                    testParams = { qq: String(e.user_id), count: 1 }
                    break
                case 'memberInfoTool':
                    testParams = { user_id: String(e.user_id) }
                    break
                case 'weatherTool':
                    testParams = { city: '北京', days: 1 }
                    break
                case 'translateTool':
                    testParams = { text: 'Hello World', target_lang: 'zh' }
                    break
                case 'reminderTool':
                    testParams = { action: 'list' }
                    break
                default:
                    testParams = {}
            }

            const result = await toolManager.executeTool(toolName, testParams, e)
            await e.reply(`测试完成，结果：\n${JSON.stringify(result, null, 2).substring(0, 1000)}`)
        } catch (error) {
            await e.reply(`测试失败：${error.message}`)
        }

        return true
    }
}

// 导出单例实例供其他模块使用
export const smartTools = new SmartTools()
