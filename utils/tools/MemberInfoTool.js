import { AbstractTool } from './AbstractTool.js'

async function callBotApi(e, action, params) {
  if (e.bot?.sendApi) {
    return await e.bot.sendApi(action, params)
  }
  if (e.bot?.api) {
    return await e.bot.api(action, params)
  }
  throw new Error('当前协议端不支持 API 调用')
}

export class MemberInfoTool extends AbstractTool {
  constructor() {
    super({
      name: 'memberInfoTool',
      description: '查询群成员信息。',
      parameters: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: '目标用户 QQ 号'
          }
        },
        required: ['user_id']
      }
    })
  }

  async func({ user_id }, e) {
    if (!e.group_id) {
      return { success: false, error: '仅支持群聊使用' }
    }

    const response = await callBotApi(e, 'get_group_member_info', {
      group_id: e.group_id,
      user_id: Number(user_id),
      no_cache: true
    })

    return {
      success: true,
      action: 'member_info',
      data: response?.data || null
    }
  }
}
