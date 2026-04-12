import { AbstractTool } from './AbstractTool.js'

export class LikeTool extends AbstractTool {
  constructor() {
    super({
      name: 'likeTool',
      description: '给指定用户点赞。',
      parameters: {
        type: 'object',
        properties: {
          qq: {
            type: 'string',
            description: '目标用户 QQ 号'
          },
          count: {
            type: 'integer',
            description: '点赞次数，1 到 20',
            minimum: 1,
            maximum: 20
          }
        },
        required: ['qq']
      }
    })
  }

  async func({ qq, count = 10 }, e) {
    const bot = e.bot ?? Bot
    const friend = bot?.pickFriend ? bot.pickFriend(Number(qq)) : null
    if (!friend?.thumbUp) {
      return { success: false, error: '当前协议端不支持点赞' }
    }

    await friend.thumbUp(Math.min(count, 20))
    return { success: true, action: 'like', target: String(qq), count: Math.min(count, 20) }
  }
}
