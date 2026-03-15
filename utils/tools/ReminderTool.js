import { AbstractTool } from './AbstractTool.js'

const REDIS_KEY_PREFIX = 'sf_plugin:reminder:'
const PENDING_LIST_KEY = `${REDIS_KEY_PREFIX}pending:list`

/**
 * 定时提醒工具类
 */
export class ReminderTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'reminderTool'
        this.description = '创建定时提醒。支持相对时间（如"15分钟后提醒我..."）和绝对时间（如"下午5点提醒我..."）。你需要将用户描述的时间转换为具体的延迟秒数或具体时间。'
        this.parameters = {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'list', 'cancel'],
                    description: '操作类型：create 创建提醒，list 查看提醒列表，cancel 取消提醒'
                },
                delay_seconds: {
                    type: 'number',
                    description: '延迟秒数（用于相对时间，如 15分钟=900秒，1小时=3600秒）。与 reminder_time 二选一。'
                },
                reminder_time: {
                    type: 'string',
                    description: '提醒时间，ISO 8601 格式（如 "2026-01-27T17:00:00+08:00"）。与 delay_seconds 二选一。'
                },
                content: {
                    type: 'string',
                    description: '提醒事项的简短描述'
                },
                reminder_id: {
                    type: 'string',
                    description: '提醒ID，取消提醒时需要提供'
                }
            },
            required: ['action']
        }
    }

    /**
     * 生成提醒ID
     */
    generateId(userId) {
        return `rem_${Date.now()}_${userId}`
    }

    /**
     * 获取 Redis key
     */
    getRedisKey(type, id) {
        return `${REDIS_KEY_PREFIX}${type}:${id}`
    }

    /**
     * 获取待触发提醒列表
     */
    async getPendingList() {
        try {
            const data = await redis.get(PENDING_LIST_KEY)
            return data ? JSON.parse(data) : []
        } catch {
            return []
        }
    }

    /**
     * 保存待触发提醒列表
     */
    async savePendingList(list) {
        await redis.set(PENDING_LIST_KEY, JSON.stringify(list))
    }

    /**
     * 创建提醒
     */
    async createReminder(e, opts) {
        const { delay_seconds, reminder_time, content } = opts

        if (!content) {
            return '创建提醒失败：未提供提醒内容'
        }

        let triggerTime
        if (delay_seconds && delay_seconds > 0) {
            triggerTime = Date.now() + (delay_seconds * 1000)
        } else if (reminder_time) {
            triggerTime = new Date(reminder_time).getTime()
        } else {
            return '创建提醒失败：请提供 delay_seconds 或 reminder_time'
        }

        if (isNaN(triggerTime) || triggerTime <= Date.now()) {
            return '创建提醒失败：提醒时间必须是将来的时间'
        }

        const reminderId = this.generateId(e.user_id)
        const reminderData = {
            id: reminderId,
            user_id: String(e.user_id),
            group_id: e.group_id ? String(e.group_id) : null,
            message_id: e.message_id || null,
            content: content,
            trigger_time: triggerTime,
            created_at: Date.now(),
            status: 'pending'
        }

        try {
            // 存储提醒详情
            await redis.set(
                this.getRedisKey('detail', reminderId),
                JSON.stringify(reminderData),
                { EX: 86400 * 7 } // 7天过期
            )

            // 添加到待触发列表
            const pendingList = await this.getPendingList()
            pendingList.push({ id: reminderId, trigger_time: triggerTime })
            pendingList.sort((a, b) => a.trigger_time - b.trigger_time)
            await this.savePendingList(pendingList)

            const formattedTime = this.formatTime(triggerTime)
            return `提醒已创建！我会在 ${formattedTime} 提醒你：${content}\n提醒ID: ${reminderId}`
        } catch (error) {
            logger.error('[ReminderTool] 创建提醒失败:', error)
            return `创建提醒失败：${error.message}`
        }
    }

    /**
     * 查看提醒列表
     */
    async listReminders(e) {
        try {
            const pendingList = await this.getPendingList()
            const userReminders = []

            for (const item of pendingList) {
                const data = await redis.get(this.getRedisKey('detail', item.id))
                if (data) {
                    const reminder = JSON.parse(data)
                    if (reminder.user_id === String(e.user_id) && reminder.status === 'pending') {
                        userReminders.push(reminder)
                    }
                }
            }

            if (userReminders.length === 0) {
                return '你没有待执行的提醒'
            }

            userReminders.sort((a, b) => a.trigger_time - b.trigger_time)

            let response = `你有 ${userReminders.length} 个待执行的提醒：\n`
            userReminders.forEach((r, i) => {
                const time = this.formatTime(r.trigger_time)
                response += `\n${i + 1}. [${time}] ${r.content}\n   ID: ${r.id}`
            })

            return response
        } catch (error) {
            logger.error('[ReminderTool] 查看提醒列表失败:', error)
            return `查看提醒失败：${error.message}`
        }
    }

    /**
     * 取消提醒
     */
    async cancelReminder(e, reminderId) {
        if (!reminderId) {
            return '取消提醒失败：未提供提醒ID'
        }

        try {
            const data = await redis.get(this.getRedisKey('detail', reminderId))
            if (!data) {
                return `取消提醒失败：未找到ID为 ${reminderId} 的提醒`
            }

            const reminder = JSON.parse(data)

            // 验证是否是该用户的提醒
            if (reminder.user_id !== String(e.user_id) && !e.isMaster) {
                return '取消提醒失败：你只能取消自己的提醒'
            }

            // 从待触发列表移除
            const pendingList = await this.getPendingList()
            const newList = pendingList.filter(item => item.id !== reminderId)
            await this.savePendingList(newList)

            // 删除详情数据
            await redis.del(this.getRedisKey('detail', reminderId))

            return `已取消提醒：${reminder.content}`
        } catch (error) {
            logger.error('[ReminderTool] 取消提醒失败:', error)
            return `取消提醒失败：${error.message}`
        }
    }

    /**
     * 格式化时间显示
     */
    formatTime(timestamp) {
        const date = new Date(timestamp)
        const month = date.getMonth() + 1
        const day = date.getDate()
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        return `${month}月${day}日 ${hours}:${minutes}`
    }

    /**
     * 执行工具
     */
    async func(opts, e) {
        const { action } = opts

        switch (action) {
            case 'create':
                return await this.createReminder(e, opts)
            case 'list':
                return await this.listReminders(e)
            case 'cancel':
                return await this.cancelReminder(e, opts.reminder_id)
            default:
                return `未知操作：${action}`
        }
    }
}

/**
 * 检查并触发到期的提醒（由定时任务调用）
 */
export async function checkPendingReminders() {
    try {
        const now = Date.now()
        const pendingList = await redis.get(PENDING_LIST_KEY)

        if (!pendingList) return

        const list = JSON.parse(pendingList)
        const dueReminders = list.filter(item => item.trigger_time <= now)

        if (dueReminders.length === 0) return

        // 从列表中移除到期的提醒
        const remaining = list.filter(item => item.trigger_time > now)
        await redis.set(PENDING_LIST_KEY, JSON.stringify(remaining))

        logger.info(`[ReminderTool] 发现 ${dueReminders.length} 个到期提醒`)

        // 处理到期的提醒
        for (const item of dueReminders) {
            try {
                await triggerReminder(item.id)
            } catch (error) {
                logger.error(`[ReminderTool] 触发提醒 ${item.id} 失败:`, error)
            }
        }
    } catch (error) {
        logger.error('[ReminderTool] 检查待触发提醒失败:', error)
    }
}

/**
 * 触发单个提醒
 */
async function triggerReminder(reminderId) {
    const data = await redis.get(`${REDIS_KEY_PREFIX}detail:${reminderId}`)
    if (!data) return

    const reminder = JSON.parse(data)
    if (reminder.status !== 'pending') return

    try {
        const messageText = `⏰ 提醒：${reminder.content}`

        if (reminder.group_id) {
            const message = []
            if (reminder.message_id) {
                message.push({ type: 'reply', data: { id: String(reminder.message_id) } })
            }
            message.push({ type: 'at', data: { qq: String(reminder.user_id) } })
            message.push({ type: 'text', data: { text: ` ${messageText}` } })

            await Bot.sendApi('send_group_msg', {
                group_id: Number(reminder.group_id),
                message: message
            })
        } else {
            await Bot.sendApi('send_private_msg', {
                user_id: Number(reminder.user_id),
                message: messageText
            })
        }

        logger.info(`[ReminderTool] 已发送提醒给用户 ${reminder.user_id}: ${reminder.content}`)

        // 更新状态为已完成
        reminder.status = 'completed'
        await redis.set(
            `${REDIS_KEY_PREFIX}detail:${reminderId}`,
            JSON.stringify(reminder),
            { EX: 86400 } // 1天后过期
        )
    } catch (error) {
        logger.error(`[ReminderTool] 发送提醒消息失败:`, error)
    }
}
