import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'

/**
 * 表情回应插件 - 当用户发送表情时，Bot自动进行表情回应
 */
export class EmojiReaction extends plugin {
    constructor() {
        super({
            name: '表情回应',
            dsc: '当用户发送表情时，Bot自动进行表情回应',
            event: 'message.group',
            priority: -100,
            rule: [
                {
                    reg: '',
                    fnc: 'handleEmojiReaction',
                    log: false
                },
                {
                    reg: '^#表情回应(开启|关闭)$',
                    fnc: 'toggleEmojiReaction',
                    permission: 'master'
                },
                {
                    reg: '^#表情回应设置.*$',
                    fnc: 'setEmojiReaction',
                    permission: 'master'
                },
                {
                    reg: '^#表情回应状态$',
                    fnc: 'showEmojiReactionStatus'
                }
            ]
        })
    }

    /**
     * 处理表情回应
     */
    async handleEmojiReaction(e) {
        const config = Config.getConfig()
        const emojiConfig = config.emojiReaction || {}

        // 检查功能是否开启
        if (!emojiConfig.enable) {
            return false
        }

        // 检查是否只对指定群生效
        if (emojiConfig.onlyGroups && emojiConfig.onlyGroups.length > 0) {
            const groupId = String(e.group_id)
            if (!emojiConfig.onlyGroups.includes(groupId)) {
                return false
            }
        }

        // 检查消息中是否包含表情
        let hasEmoji = false
        let faceId = null

        for (const msg of e.message) {
            if (msg.type === 'face') {
                hasEmoji = true
                faceId = msg.id
                break
            }
            // 检查是否为表情图片（自定义表情）
            if (msg.type === 'image' && msg.as_face) {
                hasEmoji = true
                break
            }
        }

        // 如果没有表情，不处理
        if (!hasEmoji) {
            return false
        }

        // 检查冷却时间
        const cooldownKey = `Yz:emojiReaction:cooldown:${e.group_id}:${e.user_id}`
        const lastReactionTime = await redis.get(cooldownKey)
        const now = Date.now()
        const cooldown = (emojiConfig.cooldown || 5) * 1000 // 默认5秒冷却

        if (lastReactionTime && (now - parseInt(lastReactionTime)) < cooldown) {
            logger.debug(`[表情回应] 用户 ${e.user_id} 在群 ${e.group_id} 冷却中`)
            return false
        }

        // 获取回应的表情ID
        let reactionEmojiId = emojiConfig.emojiId || '74' // 默认使用爱心表情

        // 如果使用相同表情回应，且检测到了表情ID
        if (emojiConfig.useSameEmoji && faceId) {
            reactionEmojiId = faceId
        }

        try {
            // 发送表情回应
            await this.sendEmojiReaction(e, reactionEmojiId)
            
            // 设置冷却时间
            await redis.set(cooldownKey, String(now), { EX: Math.ceil(cooldown / 1000) })
            
            logger.debug(`[表情回应] 已向用户 ${e.user_id} 发送表情回应: ${reactionEmojiId}`)
        } catch (error) {
            logger.debug(`[表情回应] 发送表情回应失败: ${error.message}`)
        }

        return false
    }

    /**
     * 发送表情回应（NapCat 等协议支持）
     * @param {Object} e - 事件对象
     * @param {string} emojiId - 表情ID
     */
    async sendEmojiReaction(e, emojiId) {
        try {
            // 获取消息ID（优先使用 e.message_id，群聊中可能是 e.seq）
            const messageId = e.message_id || e.seq
            if (!messageId) {
                logger.debug('[表情回应] 无法获取消息ID，跳过表情回应')
                return
            }

            // 检查是否支持表情回应 - 使用 bot.sendApi
            if (e.bot?.sendApi) {
                // NapCat / OneBot 11 协议
                await e.bot.sendApi('set_msg_emoji_like', {
                    message_id: messageId,
                    emoji_id: String(emojiId)
                })
                logger.info(`[表情回应] 已发送表情回应: ${emojiId}`)
            } else if (e.bot?.api) {
                // 其他协议尝试
                await e.bot.api('set_msg_emoji_like', {
                    message_id: messageId,
                    emoji_id: String(emojiId)
                })
                logger.info(`[表情回应] 已发送表情回应: ${emojiId}`)
            } else {
                logger.debug('[表情回应] 当前协议不支持表情回应')
            }
        } catch (error) {
            logger.debug('[表情回应] 发送表情回应失败:', error.message)
        }
    }

    /**
     * 开启/关闭表情回应功能
     */
    async toggleEmojiReaction(e) {
        const action = e.msg.match(/^#表情回应(开启|关闭)$/)[1]
        const enable = action === '开启'

        try {
            let config = Config.getConfig()
            if (!config.emojiReaction) {
                config.emojiReaction = {}
            }
            config.emojiReaction.enable = enable
            Config.setConfig(config)

            await e.reply(`表情回应功能已${enable ? '开启' : '关闭'}~`, true)
        } catch (error) {
            logger.error('[表情回应] 切换功能状态失败:', error)
            await e.reply('设置失败，请检查控制台日志', true)
        }

        return true
    }

    /**
     * 设置表情回应参数
     */
    async setEmojiReaction(e) {
        const msg = e.msg
        const config = Config.getConfig()
        if (!config.emojiReaction) {
            config.emojiReaction = {}
        }

        // 解析设置指令
        // #表情回应设置表情 74
        const emojiMatch = msg.match(/^#表情回应设置表情\s*(\d+)$/)
        if (emojiMatch) {
            const emojiId = emojiMatch[1]
            config.emojiReaction.emojiId = emojiId
            config.emojiReaction.useSameEmoji = false
            Config.setConfig(config)
            await e.reply(`已设置回应表情为: ${emojiId}，将使用固定表情回应`, true)
            return true
        }

        // #表情回应设置同表情
        if (msg.includes('同表情')) {
            config.emojiReaction.useSameEmoji = true
            Config.setConfig(config)
            await e.reply('已设置为使用相同表情回应用户的表情', true)
            return true
        }

        // #表情回应设置冷却 5
        const cooldownMatch = msg.match(/^#表情回应设置冷却\s*(\d+)$/)
        if (cooldownMatch) {
            const cooldown = parseInt(cooldownMatch[1])
            if (cooldown < 0 || cooldown > 300) {
                await e.reply('冷却时间应在 0-300 秒之间', true)
                return true
            }
            config.emojiReaction.cooldown = cooldown
            Config.setConfig(config)
            await e.reply(`已设置冷却时间为: ${cooldown}秒`, true)
            return true
        }

        // #表情回应设置本群
        if (msg.includes('本群') || msg.includes('当前群')) {
            const groupId = String(e.group_id)
            if (!config.emojiReaction.onlyGroups) {
                config.emojiReaction.onlyGroups = []
            }

            const index = config.emojiReaction.onlyGroups.indexOf(groupId)
            if (index === -1) {
                config.emojiReaction.onlyGroups.push(groupId)
                Config.setConfig(config)
                await e.reply('已将当前群添加到表情回应白名单', true)
            } else {
                config.emojiReaction.onlyGroups.splice(index, 1)
                Config.setConfig(config)
                await e.reply('已将当前群从表情回应白名单移除', true)
            }
            return true
        }

        // 显示帮助
        await e.reply([
            '表情回应设置帮助：',
            '#表情回应设置表情 [表情ID] - 设置固定回应表情',
            '#表情回应设置同表情 - 使用用户发送的相同表情回应',
            '#表情回应设置冷却 [秒数] - 设置冷却时间（0-300秒）',
            '#表情回应设置本群 - 添加/移除当前群到白名单',
            '',
            '常用表情ID参考：',
            '74 = ❤️  爱心',
            '76 = 😂  笑哭',
            '179 = 👍  点赞',
            '176 = 🔍  搜索/思考',
            '307 = 🌹  玫瑰',
            '326 = 🎉  庆祝'
        ].join('\n'), true)

        return true
    }

    /**
     * 显示表情回应状态
     */
    async showEmojiReactionStatus(e) {
        const config = Config.getConfig()
        const emojiConfig = config.emojiReaction || {}
        const groupId = String(e.group_id)

        const isEnabled = emojiConfig.enable || false
        const isGroupAllowed = !emojiConfig.onlyGroups || 
            emojiConfig.onlyGroups.length === 0 || 
            emojiConfig.onlyGroups.includes(groupId)

        const statusMsg = [
            '🎭 表情回应状态',
            '━━━━━━━━━━━━━━',
            `功能状态: ${isEnabled ? '✅ 已开启' : '❌ 已关闭'}`,
            `本群状态: ${isGroupAllowed ? '✅ 已生效' : '❌ 不在白名单'}`,
            `回应模式: ${emojiConfig.useSameEmoji ? '🔄 同表情回应' : `📍 固定表情(${emojiConfig.emojiId || '74'})`}`,
            `冷却时间: ${emojiConfig.cooldown || 5}秒`,
            '',
            '白名单群:',
            emojiConfig.onlyGroups && emojiConfig.onlyGroups.length > 0 
                ? emojiConfig.onlyGroups.map(id => `  ${id}`).join('\n')
                : '  所有群',
            '━━━━━━━━━━━━━━',
            '指令: #表情回应[开启/关闭/状态/设置]'
        ].join('\n')

        await e.reply(statusMsg, true)
        return true
    }
}
