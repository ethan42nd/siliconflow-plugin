import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import { prepareAvailablePictures, getSentPictureFileInfo } from './autoEmoticons.js'

function getSentMessageId(msgRet) {
  return msgRet?.seq || msgRet?.data?.message_id || msgRet?.time
}

export class chuoyichuo extends plugin {
  constructor() {
    super({
      name: '戳一戳互动',
      dsc: '戳一戳机器人后触发配置化互动效果',
      event: 'notice.group.poke',
      priority: -5000,
      rule: [
        {
          fnc: 'handlePoke',
          log: false
        }
      ]
    })
  }

  async handlePoke(e) {
    if (e.target_id !== e.self_id || !e.group_id) return false

    const config = Config.getConfig()
    const pokeConf = config.pokeConfig || {}
    if (!pokeConf.enable) return false

    const groupId = String(e.group_id)
    const probText = Number(pokeConf.reply_text_prob ?? 0.2)
    const probImg = Number(pokeConf.reply_img_prob ?? 0.5)
    const probMute = Number(pokeConf.mutepick_prob ?? 0)
    const randomVal = Math.random()
    let currentProb = 0

    currentProb += probText
    if (randomVal < currentProb) {
      return await this.replyText(e, groupId, pokeConf)
    }

    currentProb += probImg
    if (randomVal < currentProb) {
      return await this.replyImage(e, groupId)
    }

    currentProb += probMute
    if (randomVal < currentProb) {
      return await this.muteOperator(e, pokeConf)
    }

    return await this.pokeBack(e)
  }

  async replyText(e, groupId, pokeConf) {
    const wordListStr = pokeConf.word_list || '不要再戳了！'
    const words = wordListStr.split('\n').map((word) => word.trim()).filter(Boolean)
    if (words.length === 0) return true

    const word = words[Math.floor(Math.random() * words.length)]
    try {
      const msgRet = await e.reply(word)
      const msgId = getSentMessageId(msgRet)
      if (msgId) {
        await redis.set(`Yz:autoEmoticons.sent:text_content:${groupId}:${msgId}`, word, { EX: 60 * 60 * 24 })
      }
    } catch (error) {
      logger.error(`[戳一戳] 发送文字失败: ${error}`)
    }

    return true
  }

  async replyImage(e, groupId) {
    const availablePictures = prepareAvailablePictures(groupId)
    if (availablePictures.length === 0) {
      await e.reply('想给你发表情包，但是我的表情库空空如也~')
      return true
    }

    const picturePath = availablePictures[Math.floor(Math.random() * availablePictures.length)]
    try {
      const msgRet = await e.reply(segment.image(picturePath))
      const msgId = getSentMessageId(msgRet)
      if (msgId) {
        await redis.set(
          `Yz:autoEmoticons.sent:pic_filePath:${groupId}:${msgId}`,
          getSentPictureFileInfo(picturePath),
          { EX: 60 * 60 * 24 }
        )
      }
    } catch (error) {
      logger.error(`[戳一戳] 发送图片失败: ${error}`)
    }

    return true
  }

  async muteOperator(e, pokeConf) {
    try {
      await e.group.muteMember(e.operator_id, pokeConf.mute_duration || 60)
      await e.reply('不准戳我！！！')
    } catch (error) {
      await e.reply('哼，要不是我没有管理员权限，早把你禁言了！')
    }

    return true
  }

  async pokeBack(e) {
    try {
      await e.group.pokeMember(e.operator_id)
      await e.reply('戳你！')
    } catch (error) {
      logger.debug('[戳一戳] 反戳失败，协议端可能不支持')
    }

    return true
  }
}
