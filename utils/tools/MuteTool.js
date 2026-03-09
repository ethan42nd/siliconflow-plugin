import { AbstractTool } from './AbstractTool.js'

/**
 * 禁言工具类
 */
export class MuteTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'muteTool'
        this.description = '对群聊中的用户进行禁言/解禁操作，如果想要对群员进行禁言请调用此工具，但也请不要随意的就调用该工具禁言，除非真的违规了或者涉证讨论国家敏感问题或者骂的特别难听时调用'
        this.parameters = {
            type: 'object',
            properties: {
                target: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '目标用户的QQ号、群名片或昵称数组，支持单个或多个用户(注意：只填写纯用户名，不要包含时间、数量等描述词（如"一分钟"、"1分钟"）例:当说禁言西狗狗一分钟时，实际的参数应是西狗狗，而不是西狗狗一或者西狗狗1)'
                },
                time: {
                    type: 'number',
                    description: '禁言时长(秒)。0表示解除禁言，默认300秒(5分钟)',
                    default: 300
                },
                random: {
                    type: 'boolean',
                    description: '是否随机选择群成员操作',
                    default: false
                },
                confirm: {
                    type: 'boolean',
                    description: '是否确认执行全体禁言',
                    default: false
                }
            },
            required: []
        }
    }

    /**
     * 清理目标字符串中的时间后缀
     */
    cleanTarget(target) {
        if (!target) return target
        return target
            .replace(/[一二三四五六七八九十百千]+[分秒小时天]?[钟]?$/, '')
            .replace(/\d+[分秒小时天]?[钟]?$/, '')
            .trim()
    }

    /**
     * 查找群成员
     */
    findMember(target, members) {
        const cleanedTarget = this.cleanTarget(target)
        const searchTargets = [target, cleanedTarget].filter(Boolean)

        for (const searchTarget of searchTargets) {
            // 首先尝试作为 QQ 号查找
            if (/^\d+$/.test(searchTarget)) {
                const member = members.get(Number(searchTarget))
                if (member) return { qq: Number(searchTarget), info: member }
            }

            // 按群名片或昵称精确匹配
            const search = searchTarget.toLowerCase()
            for (const [qq, info] of members.entries()) {
                const card = info.card?.toLowerCase()
                const nickname = info.nickname?.toLowerCase()
                if (card === search || nickname === search) {
                    return { qq, info }
                }
            }

            // 按群名片或昵称模糊匹配
            for (const [qq, info] of members.entries()) {
                const card = info.card?.toLowerCase()
                const nickname = info.nickname?.toLowerCase()
                if (card?.includes(search) || nickname?.includes(search) ||
                    search.includes(card) || search.includes(nickname)) {
                    return { qq, info }
                }
            }
        }
        return null
    }

    /**
     * 获取被禁言的成员列表
     */
    getMutedMembers(members) {
        return Array.from(members.entries())
            .filter(([_, member]) => member.shutup_time > 0)
            .map(([qq, info]) => ({ qq, info, muteTimeLeft: info.shutup_time }))
    }

    /**
     * 执行禁言操作
     */
    async func(opts, e) {
        const { target, time = 300, random = false, confirm = false, senderRole, selfDecision = false } = opts

        // 统一处理时间，任何 0 或负数都视为解禁
        const muteTime = time <= 0 ? 0 : Math.min(time, 86400 * 30)
        const isUnmute = muteTime === 0
        const operationType = isUnmute ? '解禁' : '禁言'

        const groupId = e.group_id

        // 权限检查：普通用户不能命令机器人禁言，除非机器人自主决定
        if (!selfDecision && !['owner', 'admin'].includes(senderRole)) {
            return '该群员不是群主或管理员，无权命令我执行禁言操作'
        }

        let group
        try {
            group = e.group || await Bot.pickGroup(groupId)
        } catch (error) {
            console.error('获取群信息失败:', error)
            return `未找到群 ${groupId}`
        }

        try {
            const members = await group.getMemberMap()

            // 检查机器人权限
            const botMember = members.get(Bot.uin)
            if (botMember?.role === 'member') {
                return `失败了，我在这个群聊 ${groupId} 没有权限${operationType}别人`
            }

            // 处理全体禁言
            if (target === 'all') {
                if (!confirm && !isUnmute) {
                    return '执行全体禁言需要额外确认，请添加 confirm 参数'
                }
                await group.muteAll(muteTime)
                return {
                    action: isUnmute ? 'unmuteAll' : 'muteAll',
                    time: muteTime,
                    groupName: group.name || groupId,
                    message: `已${isUnmute ? '解除' : '开启'}全体禁言`
                }
            }

            // 处理随机操作
            if (!target || random) {
                return await this.handleRandomOperation(e, group, members, muteTime)
            }

            // 处理指定目标操作
            const targets = Array.isArray(target) ? target : [target]
            const results = await this.handleBatchOperation(targets, group, members, muteTime)

            const successCount = results.filter(r => r.success).length
            const failCount = results.filter(r => !r.success).length

            return {
                action: isUnmute ? 'unmute' : 'mute',
                results,
                groupName: group.name || groupId,
                time: muteTime,
                summary: { total: targets.length, success: successCount, fail: failCount },
                message: `${operationType}操作完成，成功${successCount}个，失败${failCount}个`
            }
        } catch (error) {
            console.error(`${operationType}操作失败:`, error)
            return `${operationType}操作失败: ${error.message}`
        }
    }

    /**
     * 处理随机操作
     */
    async handleRandomOperation(e, group, members, muteTime) {
        const isUnmute = muteTime === 0
        let availableMembers

        if (isUnmute) {
            const mutedMembers = this.getMutedMembers(members)
            if (mutedMembers.length === 0) {
                return '群内没有被禁言的成员'
            }
            availableMembers = mutedMembers.map(({ qq, info }) => [qq, info])
        } else {
            availableMembers = Array.from(members.entries())
                .filter(([id, member]) =>
                    id !== Bot.uin &&
                    member.role === 'member' &&
                    id !== e.sender.user_id
                )
            if (availableMembers.length === 0) {
                return '群内没有可禁言的普通成员'
            }
        }

        const randomIndex = Math.floor(Math.random() * availableMembers.length)
        const [targetQQ, targetMember] = availableMembers[randomIndex]

        try {
            await group.muteMember(targetQQ, muteTime)
            return {
                action: isUnmute ? 'unmute' : 'mute',
                targetQQ,
                targetName: targetMember.card || targetMember.nickname,
                groupName: group.name || group.group_id,
                time: muteTime,
                isRandom: true,
                success: true,
                message: `已随机${isUnmute ? '解禁' : '禁言'}成员：${targetMember.card || targetMember.nickname}`,
                muteTimeLeft: isUnmute ? 0 : muteTime
            }
        } catch (error) {
            return {
                action: isUnmute ? 'unmute' : 'mute',
                targetQQ,
                targetName: targetMember.card || targetMember.nickname,
                isRandom: true,
                success: false,
                reason: error.message
            }
        }
    }

    /**
     * 处理批量操作
     */
    async handleBatchOperation(targets, group, members, muteTime) {
        const isUnmute = muteTime === 0
        const results = []

        for (const target of targets) {
            const foundMember = this.findMember(target, members)
            if (!foundMember) {
                results.push({ target, success: false, reason: '未找到该用户' })
                continue
            }

            const { qq: targetQQ, info: targetMember } = foundMember

            if (isUnmute) {
                if (targetMember.shutup_time === 0) {
                    results.push({
                        target, targetQQ,
                        targetName: targetMember.card || targetMember.nickname,
                        success: false, reason: '该用户未被禁言'
                    })
                    continue
                }
            } else {
                if (['owner', 'admin'].includes(targetMember.role)) {
                    results.push({
                        target, targetQQ,
                        targetName: targetMember.card || targetMember.nickname,
                        success: false, reason: '无法禁言群主或管理员'
                    })
                    continue
                }
            }

            try {
                await group.muteMember(targetQQ, muteTime)
                results.push({
                    target, targetQQ,
                    targetName: targetMember.card || targetMember.nickname,
                    success: true,
                    message: `已${isUnmute ? '解禁' : '禁言'}`,
                    muteTimeLeft: isUnmute ? 0 : muteTime
                })
            } catch (error) {
                results.push({
                    target, targetQQ,
                    targetName: targetMember.card || targetMember.nickname,
                    success: false, reason: error.message
                })
            }
        }

        return results
    }
}
