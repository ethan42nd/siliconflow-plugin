import plugin from '../../../lib/plugins/plugin.js'
import { toolManager } from '../utils/tools/ToolManager.js'
import { checkPendingReminders } from '../utils/tools/index.js'
import Config from '../components/Config.js'

let reminderInterval = null

export class SmartTools extends plugin {
    constructor() {
        super({
            name: '智能工具系统',
            dsc: '智能模式工具辅助入口',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '^#工具列表$',
                    fnc: 'listTools',
                    permission: 'master'
                },
                {
                    reg: '^#工具测试\\s*(\\w+)?$',
                    fnc: 'testTool',
                    permission: 'master'
                }
            ]
        })

        toolManager.init()
        this.initReminderPolling()
    }

    initReminderPolling() {
        if (reminderInterval) {
            return
        }

        reminderInterval = setInterval(async () => {
            try {
                await checkPendingReminders()
            } catch (error) {
                logger.error('[SmartTools] 检查提醒失败:', error)
            }
        }, 1000)

        reminderInterval.unref?.()
        logger.info('[SmartTools] 提醒轮询已启动')
    }

    async listTools(e) {
        const config = Config.getConfig()
        const enabledNames = toolManager.getEnabledTools().map((tool) => tool.name)
        const allNames = toolManager.getAllToolNames()

        let message = '【工具列表】\n\n'
        message += `总共 ${allNames.length} 个工具，当前启用 ${enabledNames.length} 个\n`
        message += `调试日志：${config.smartMode?.tools?.debugLog ? '开启' : '关闭'}\n\n`

        for (const toolName of allNames) {
            const tool = toolManager.toolInstances.get(toolName)
            const enabled = enabledNames.includes(toolName)
            const desc = tool?.description ? tool.description.substring(0, 50) : '无描述'
            message += `${enabled ? '✅' : '❌'} ${toolName}: ${desc}${desc.length >= 50 ? '...' : ''}\n`
        }

        await e.reply(message)
        return true
    }

    async testTool(e) {
        const match = e.msg.match(/^#工具测试\s*(\w+)?$/)
        const toolName = match?.[1]

        if (!toolName) {
            await e.reply('请指定要测试的工具名称，如：#工具测试 weatherTool')
            return true
        }

        if (!toolManager.toolInstances.has(toolName)) {
            await e.reply(`工具 ${toolName} 不存在`)
            return true
        }

        const testParams = this.getDefaultTestParams(toolName, e)
        await e.reply(`正在测试工具 ${toolName}...`)

        try {
            const result = await toolManager.executeTool(toolName, testParams, e)
            const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            await e.reply(`测试完成：\n${text.substring(0, 1200)}`)
        } catch (error) {
            logger.error(`[SmartTools] 测试工具 ${toolName} 失败:`, error)
            await e.reply(`测试失败：${error.message}`)
        }

        return true
    }

    getDefaultTestParams(toolName, e) {
        switch (toolName) {
            case 'pokeTool':
                return { target: [String(e.user_id)], times: 1 }
            case 'likeTool':
                return { qq: String(e.user_id), count: 1 }
            case 'memberInfoTool':
                return { user_id: String(e.user_id) }
            case 'searchTool':
                return { query: '今天天气', num_results: 2 }
            case 'imageSearchTool':
                return { query: '猫咪', count: 1, source: 'bing' }
            case 'musicTool':
                return { query: '晴天 周杰伦', count: 1 }
            case 'weatherTool':
                return { city: '北京', days: 1 }
            case 'translateTool':
                return { text: 'Hello world', target_lang: 'zh' }
            case 'webParserTool':
                return { url: 'https://example.com', extract_type: 'summary' }
            case 'reminderTool':
                return { action: 'list' }
            case 'drawTool':
                return { prompt: 'a cute orange cat sitting on a desk', width: 512, height: 512 }
            case 'chatHistoryTool':
                return { limit: 5 }
            default:
                return {}
        }
    }
}
