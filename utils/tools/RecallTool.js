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

export class RecallTool extends AbstractTool {
  constructor() {
    super({
      name: 'recallTool',
      description: '撤回指定消息。',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: '要撤回的消息 ID'
          }
        },
        required: ['message_id']
      }
    })
  }

  async func({ message_id }, e) {
    await callBotApi(e, 'delete_msg', { message_id: String(message_id) })
    return { success: true, action: 'recall', message_id: String(message_id) }
  }
}
