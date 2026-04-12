import { AbstractTool } from './AbstractTool.js'

export class PokeTool extends AbstractTool {
  constructor() {
    super({
      name: 'pokeTool',
      description: '对群成员执行戳一戳操作。当用户明确要求戳某人时使用。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '目标用户 QQ 号'
          }
        },
        required: ['target']
      }
    })
  }

  async func({ target }, e) {
    if (!e.group_id) {
      return { success: false, error: '仅支持群聊使用' }
    }

    const group = e.group || (e.bot?.pickGroup ? await e.bot.pickGroup(e.group_id) : null)
    if (!group?.pokeMember) {
      return { success: false, error: '当前协议端不支持戳一戳' }
    }

    await group.pokeMember(Number(target))
    return { success: true, action: 'poke', target: String(target) }
  }
}
