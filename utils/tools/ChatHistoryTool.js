import { AbstractTool } from './AbstractTool.js'

/**
 * 聊天历史工具类
 */
export class ChatHistoryTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'chatHistoryTool'
        this.description = '获取当前群聊的历史消息记录，当用户问"刚才说了什么"、"大家在聊什么"等需要回顾历史消息时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                count: {
                    type: 'number',
                    description: '获取历史消息的数量，默认10条，最多20条',
                    default: 10,
                    minimum: 1,
                    maximum: 20
                },
                keyword: {
                    type: 'string',
                    description: '搜索关键词，如果提供则只返回包含该关键词的消息'
                }
            }
        }
    }

    async func(opts, e) {
        const { count = 10, keyword = '' } = opts

        if (!e.group_id) {
            return '此功能仅支持群聊使用'
        }

        try {
            // 从 Redis 获取历史消息
            const redisKey = `sf_plugin:chat_history:${e.group_id}`
            const data = await redis.get(redisKey)

            if (!data) {
                return '暂无历史消息记录'
            }

            let messages = JSON.parse(data)

            // 过滤关键词
            if (keyword) {
                messages = messages.filter(msg =>
                    msg.content && msg.content.toLowerCase().includes(keyword.toLowerCase())
                )
            }

            // 限制数量
            messages = messages.slice(-count)

            if (messages.length === 0) {
                return keyword ? `未找到包含"${keyword}"的历史消息` : '暂无历史消息记录'
            }

            // 格式化输出
            let result = `【最近 ${messages.length} 条消息】\n`
            messages.forEach((msg, i) => {
                const time = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                result += `\n${time} ${msg.nickname || msg.user_id}: ${msg.content?.substring(0, 100) || ''}`
            })

            return result
        } catch (error) {
            logger.error('[ChatHistoryTool] 获取历史消息失败:', error)
            return `获取历史消息失败: ${error.message}`
        }
    }
}
