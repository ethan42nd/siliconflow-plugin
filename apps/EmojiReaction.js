import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'

/**
 * 表情回应插件 - 当用户发送表情时，Bot自动进行表情回应
 * 支持 QQ 表情(face) 和 Unicode Emoji
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
                    reg: '^#(开启|关闭)我的表情回应$',
                    fnc: 'toggleUserEmojiReaction'
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
     * 从文本中提取 Unicode Emoji
     * @param {string} text - 文本内容
     * @returns {Array} - Emoji 列表
     */
    extractUnicodeEmoji(text) {
        if (!text) return []
        // 匹配 Emoji 的正则表达式
        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu
        return text.match(emojiRegex) || []
    }

    /**
     * 获取 Emoji 的 code point（用于表情回应 API）
     * @param {string} emoji - Emoji 字符
     * @returns {string} - code point
     */
    getEmojiCodePoint(emoji) {
        // 获取第一个 code point（大部分 Emoji 只需要第一个）
        return String(emoji.codePointAt(0))
    }

    /**
     * 获取用户表情回应设置
     * @param {string} userId - 用户QQ号
     * @returns {Promise<boolean>} - 是否开启
     */
    async getUserEmojiReactionEnabled(userId) {
        const userKey = `Yz:emojiReaction:user:${userId}:enabled`
        const value = await redis.get(userKey)
        // 默认开启（未设置时返回 true）
        return value !== 'false'
    }

    /**
     * 设置用户表情回应开关
     * @param {string} userId - 用户QQ号
     * @param {boolean} enabled - 是否开启
     */
    async setUserEmojiReactionEnabled(userId, enabled) {
        const userKey = `Yz:emojiReaction:user:${userId}:enabled`
        if (enabled) {
            // 开启时删除键（恢复默认）
            await redis.del(userKey)
        } else {
            // 关闭时设置 false
            await redis.set(userKey, 'false')
        }
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

        // 检查用户是否开启了自己的表情回应（默认开启）
        const userEnabled = await this.getUserEmojiReactionEnabled(String(e.user_id))
        if (!userEnabled) {
            logger.debug(`[表情回应] 用户 ${e.user_id} 已关闭个人表情回应`)
            return false
        }

        // 收集消息中的所有表情
        const emojiIds = []

        for (const msg of e.message) {
            // QQ 表情 (face 类型)
            if (msg.type === 'face' && msg.id) {
                emojiIds.push(String(msg.id))
            }
            
            // 表情图片（自定义表情）
            if (msg.type === 'image' && msg.as_face) {
                // 自定义表情没有固定 ID，跳过或使用特殊处理
                continue
            }
            
            // 文本中的 Unicode Emoji
            if (msg.type === 'text' && msg.text) {
                const emojis = this.extractUnicodeEmoji(msg.text)
                for (const emoji of emojis) {
                    const codePoint = this.getEmojiCodePoint(emoji)
                    if (codePoint) {
                        emojiIds.push(codePoint)
                    }
                }
            }
        }

        // 如果没有检测到表情，不处理
        if (emojiIds.length === 0) {
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

        try {
            // 判断回应模式
            if (emojiConfig.useSameEmoji) {
                // 使用相同表情回应 - 对每个检测到的表情都回应
                const reactToAll = emojiConfig.reactToAllEmojis !== false // 默认 true
                const maxReactions = reactToAll ? emojiIds.length : 1
                
                for (let i = 0; i < Math.min(maxReactions, emojiIds.length); i++) {
                    await this.sendEmojiReaction(e, emojiIds[i])
                    // 每个表情之间稍微延迟，避免请求过快
                    if (i < maxReactions - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100))
                    }
                }
                logger.debug(`[表情回应] 已向用户 ${e.user_id} 发送 ${Math.min(maxReactions, emojiIds.length)} 个表情回应`)
            } else {
                // 使用固定表情回应
                const reactionEmojiId = emojiConfig.emojiId || '74' // 默认使用爱心表情
                await this.sendEmojiReaction(e, reactionEmojiId)
                logger.debug(`[表情回应] 已向用户 ${e.user_id} 发送固定表情回应: ${reactionEmojiId}`)
            }
            
            // 设置冷却时间
            await redis.set(cooldownKey, String(now), { EX: Math.ceil(cooldown / 1000) })
        } catch (error) {
            logger.debug(`[表情回应] 发送表情回应失败: ${error.message}`)
        }

        return false
    }

    /**
     * 发送表情回应（NapCat 等协议支持）
     * @param {Object} e - 事件对象
     * @param {string} emojiId - 表情ID（QQ表情ID 或 Unicode Emoji code point）
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
                    emoji_id: String(emojiId),
                    set: true
                })
                logger.info(`[表情回应] 已发送表情回应: ${emojiId}`)
            } else if (e.bot?.api) {
                // 其他协议尝试
                await e.bot.api('set_msg_emoji_like', {
                    message_id: messageId,
                    emoji_id: String(emojiId),
                    set: true
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
     * 开启/关闭表情回应功能（主人命令）
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
     * 用户开启/关闭自己的表情回应
     */
    async toggleUserEmojiReaction(e) {
        const action = e.msg.match(/^#(开启|关闭)我的表情回应$/)[1]
        const enable = action === '开启'
        const userId = String(e.user_id)

        try {
            await this.setUserEmojiReactionEnabled(userId, enable)
            
            if (enable) {
                await e.reply('✅ 已开启你的表情回应~\n发送表情时我会回应你哦！', true)
            } else {
                await e.reply('❌ 已关闭你的表情回应~\n发送表情时我不会再回应你了', true)
            }
        } catch (error) {
            logger.error('[表情回应] 切换用户设置失败:', error)
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

        // #表情回应设置全部回应 / #表情回应设置单个回应
        if (msg.includes('全部回应') || msg.includes('所有表情')) {
            config.emojiReaction.reactToAllEmojis = true
            Config.setConfig(config)
            await e.reply('已设置为回应消息中的所有表情', true)
            return true
        }
        
        if (msg.includes('单个回应') || msg.includes('仅首个')) {
            config.emojiReaction.reactToAllEmojis = false
            Config.setConfig(config)
            await e.reply('已设置为仅回应消息中的第一个表情', true)
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
            '#表情回应设置全部回应 - 回应消息中的所有表情',
            '#表情回应设置单个回应 - 仅回应第一个表情',
            '#表情回应设置冷却 [秒数] - 设置冷却时间（0-300秒）',
            '#表情回应设置本群 - 添加/移除当前群到白名单',
            '',
            '说明：支持 QQ 表情和 Unicode Emoji（如 😀👍❤️）',
            '',
            '常用 QQ 表情 ID 参考：',
            '74 = ❤️  爱心    76 = 😂  笑哭',
            '179 = 👍 点赞    176 = 🔍  搜索',
            '307 = 🌹 玫瑰    326 = 🎉 庆祝',
            '',
            'Emoji 表情 ID 查看：',
            'https://koishi.js.org/QFace/#/qqnt'
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
        const userId = String(e.user_id)

        const isEnabled = emojiConfig.enable || false
        const isGroupAllowed = !emojiConfig.onlyGroups || 
            emojiConfig.onlyGroups.length === 0 || 
            emojiConfig.onlyGroups.includes(groupId)
        const isUserEnabled = await this.getUserEmojiReactionEnabled(userId)

        const statusMsg = [
            '🎭 表情回应状态',
            '━━━━━━━━━━━━━━',
            `功能状态: ${isEnabled ? '✅ 已开启' : '❌ 已关闭'}`,
            `本群状态: ${isGroupAllowed ? '✅ 已生效' : '❌ 不在白名单'}`,
            `个人状态: ${isUserEnabled ? '✅ 已开启' : '❌ 已关闭'}`,
            `回应模式: ${emojiConfig.useSameEmoji ? '🔄 同表情回应' : `📍 固定表情(${emojiConfig.emojiId || '74'})`}`,
            emojiConfig.useSameEmoji ? `多表情处理: ${emojiConfig.reactToAllEmojis !== false ? '回应全部' : '仅首个'}` : '',
            `冷却时间: ${emojiConfig.cooldown || 5}秒`,
            '',
            '白名单群:',
            emojiConfig.onlyGroups && emojiConfig.onlyGroups.length > 0 
                ? emojiConfig.onlyGroups.map(id => `  ${id}`).join('\n')
                : '  所有群',
            '━━━━━━━━━━━━━━',
            '支持: QQ表情 + Unicode Emoji(😀👍)',
            '指令: #表情回应[开启/关闭/状态/设置]',
            '个人: #开启/关闭我的表情回应'
        ].filter(Boolean).join('\n')

        await e.reply(statusMsg, true)
        return true
    }
}
