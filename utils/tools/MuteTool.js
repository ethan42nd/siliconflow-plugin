import { AbstractTool } from './AbstractTool.js'

async function getGroup(e) {
  return e.group || (e.bot?.pickGroup ? await e.bot.pickGroup(e.group_id) : null)
}

export class MuteTool extends AbstractTool {
  constructor() {
    super({
      name: 'muteTool',
      description: '对群成员进行禁言或解除禁言。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '目标用户 QQ 号'
          },
          time: {
            type: 'integer',
            description: '禁言秒数，0 表示解除禁言',
            minimum: 0,
            maximum: 2592000
          }
        },
        required: ['target']
      }
    })
  }

  async func({ target, time = 300 }, e) {
    if (!e.group_id) {
      return { success: false, error: '仅支持群聊使用' }
    }

    const group = await getGroup(e)
    if (!group?.muteMember) {
      return { success: false, error: '当前协议端不支持禁言' }
    }

    await group.muteMember(Number(target), Math.max(0, time))
    return {
      success: true,
      action: time > 0 ? 'mute' : 'unmute',
      target: String(target),
      time: Math.max(0, time)
    }
  }
}
