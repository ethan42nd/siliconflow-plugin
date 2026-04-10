import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import Render from '../components/Render.js'
import { style } from '../resources/help/imgs/config.js'
import _ from 'lodash'

export class EmojiReaction extends plugin {
  constructor() {
    super({
      name: '表情回应',
      dsc: '当用户发送表情时，Bot 自动进行表情回应',
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
          reg: '^#(开启|关闭)全局表情回应$',
          fnc: 'toggleGlobalEmojiReaction',
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
        },
        {
          reg: '^#表情回应帮助$',
          fnc: 'emojiReactionHelp'
        }
      ]
    })
  }

  extractUnicodeEmoji(text) {
    if (!text) return []
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu
    return text.match(emojiRegex) || []
  }

  getEmojiCodePoint(emoji) {
    return String(emoji.codePointAt(0))
  }

  async getUserEmojiReactionEnabled(userId, globalDefault = false) {
    const value = await redis.get(`Yz:emojiReaction:user:${userId}:enabled`)
    if (value === 'true') return true
    if (value === 'false') return false
    return globalDefault
  }

  async setUserEmojiReactionEnabled(userId, enabled) {
    const key = `Yz:emojiReaction:user:${userId}:enabled`
    if (enabled) {
      await redis.set(key, 'true')
    } else {
      await redis.set(key, 'false')
    }
  }

  getMessageEmojiIds(e) {
    const emojiIds = []
    const rawMessage = Array.isArray(e.message) ? e.message : []

    for (const item of rawMessage) {
      if (item?.type === 'face' && item?.id !== undefined) {
        emojiIds.push(String(item.id))
      }
    }

    const messageText = e.msg || e.raw_message || ''
    const unicodeEmojis = this.extractUnicodeEmoji(messageText)
    for (const emoji of unicodeEmojis) {
      emojiIds.push(this.getEmojiCodePoint(emoji))
    }

    return [...new Set(emojiIds)]
  }

  async handleEmojiReaction(e) {
    const config = Config.getConfig()
    const emojiConfig = config.emojiReaction || {}

    if (!emojiConfig.enable) return false
    if (!e.group_id || e.user_id === e.self_id) return false

    const groupId = String(e.group_id)
    if (emojiConfig.onlyGroups?.length && !emojiConfig.onlyGroups.includes(groupId)) {
      return false
    }

    const isUserEnabled = await this.getUserEmojiReactionEnabled(String(e.user_id), Boolean(emojiConfig.globalEnabled))
    if (!isUserEnabled) return false

    const emojiIds = this.getMessageEmojiIds(e)
    if (emojiIds.length === 0) return false

    const cooldownSeconds = Number(emojiConfig.cooldown) || 5
    const cooldownKey = `Yz:emojiReaction:cooldown:${groupId}:${e.user_id}`
    const lastReactionTime = await redis.get(cooldownKey)
    const now = Date.now()
    if (lastReactionTime && now - Number(lastReactionTime) < cooldownSeconds * 1000) {
      return false
    }

    try {
      if (emojiConfig.useSameEmoji) {
        const reactToAll = emojiConfig.reactToAllEmojis !== false
        const count = reactToAll ? emojiIds.length : 1
        for (let i = 0; i < Math.min(count, emojiIds.length); i++) {
          await this.sendEmojiReaction(e, emojiIds[i])
          if (i < count - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        }
      } else {
        await this.sendEmojiReaction(e, emojiConfig.emojiId || '74')
      }

      await redis.set(cooldownKey, String(now), { EX: Math.ceil(cooldownSeconds) })
    } catch (error) {
      logger.debug(`[表情回应] 发送表情回应失败: ${error.message}`)
    }

    return false
  }

  async sendEmojiReaction(e, emojiId) {
    const messageId = e.message_id || e.seq
    if (!messageId) {
      logger.debug('[表情回应] 无法获取消息 ID，跳过表情回应')
      return
    }

    if (e.bot?.sendApi) {
      await e.bot.sendApi('set_msg_emoji_like', {
        message_id: messageId,
        emoji_id: String(emojiId),
        set: true
      })
      return
    }

    if (e.bot?.api) {
      await e.bot.api('set_msg_emoji_like', {
        message_id: messageId,
        emoji_id: String(emojiId),
        set: true
      })
      return
    }

    logger.debug('[表情回应] 当前协议不支持 set_msg_emoji_like')
  }

  async toggleEmojiReaction(e) {
    const enable = e.msg.match(/^#表情回应(开启|关闭)$/)?.[1] === '开启'
    const config = Config.getConfig()
    config.emojiReaction = config.emojiReaction || {}
    config.emojiReaction.enable = enable
    Config.setConfig(config)
    await e.reply(`表情回应功能已${enable ? '开启' : '关闭'}~`, true)
    return true
  }

  async toggleGlobalEmojiReaction(e) {
    const enable = e.msg.match(/^#(开启|关闭)全局表情回应$/)?.[1] === '开启'
    const config = Config.getConfig()
    config.emojiReaction = config.emojiReaction || {}
    config.emojiReaction.globalEnabled = enable
    Config.setConfig(config)
    await e.reply(enable
      ? '✅ 已开启全局表情回应~\n未设置的用户将默认开启表情回应'
      : '❌ 已关闭全局表情回应~\n未设置的用户将默认关闭表情回应', true)
    return true
  }

  async toggleUserEmojiReaction(e) {
    const enable = e.msg.match(/^#(开启|关闭)我的表情回应$/)?.[1] === '开启'
    await this.setUserEmojiReactionEnabled(String(e.user_id), enable)
    await e.reply(enable
      ? '✅ 已开启你的表情回应~\n发送表情时我会回应你哦！'
      : '❌ 已关闭你的表情回应~\n发送表情时我不会回应你了', true)
    return true
  }

  async setEmojiReaction(e) {
    const msg = e.msg
    const config = Config.getConfig()
    config.emojiReaction = config.emojiReaction || {}
    const emojiConfig = config.emojiReaction

    const emojiMatch = msg.match(/^#表情回应设置表情\s*(\d+)$/)
    if (emojiMatch) {
      emojiConfig.emojiId = emojiMatch[1]
      emojiConfig.useSameEmoji = false
      Config.setConfig(config)
      await e.reply(`已设置回应表情为: ${emojiMatch[1]}，将使用固定表情回应`, true)
      return true
    }

    if (msg.includes('同表情')) {
      emojiConfig.useSameEmoji = true
      Config.setConfig(config)
      await e.reply('已设置为使用相同表情回应用户的表情', true)
      return true
    }

    if (msg.includes('全部回应') || msg.includes('所有表情')) {
      emojiConfig.reactToAllEmojis = true
      Config.setConfig(config)
      await e.reply('已设置为回应消息中的所有表情', true)
      return true
    }

    if (msg.includes('单个回应') || msg.includes('仅首个')) {
      emojiConfig.reactToAllEmojis = false
      Config.setConfig(config)
      await e.reply('已设置为仅回应消息中的第一个表情', true)
      return true
    }

    const cooldownMatch = msg.match(/^#表情回应设置冷却\s*(\d+)$/)
    if (cooldownMatch) {
      emojiConfig.cooldown = Number(cooldownMatch[1])
      Config.setConfig(config)
      await e.reply(`已设置冷却时间为 ${cooldownMatch[1]} 秒`, true)
      return true
    }

    if (msg.includes('本群')) {
      const groupId = String(e.group_id)
      emojiConfig.onlyGroups = Array.isArray(emojiConfig.onlyGroups) ? emojiConfig.onlyGroups : []
      if (emojiConfig.onlyGroups.includes(groupId)) {
        emojiConfig.onlyGroups = emojiConfig.onlyGroups.filter((id) => id !== groupId)
        Config.setConfig(config)
        await e.reply(`已将本群 ${groupId} 从表情回应白名单移除`, true)
      } else {
        emojiConfig.onlyGroups.push(groupId)
        Config.setConfig(config)
        await e.reply(`已将本群 ${groupId} 加入表情回应白名单`, true)
      }
      return true
    }

    await e.reply([
      '表情回应设置支持以下命令：',
      '#表情回应设置表情 74',
      '#表情回应设置同表情',
      '#表情回应设置全部回应',
      '#表情回应设置单个回应',
      '#表情回应设置冷却 5',
      '#表情回应设置本群'
    ].join('\n'), true)
    return true
  }

  async showEmojiReactionStatus(e) {
    const config = Config.getConfig()
    const emojiConfig = config.emojiReaction || {}
    const groupId = String(e.group_id)
    const userId = String(e.user_id)
    const isGroupAllowed = !emojiConfig.onlyGroups?.length || emojiConfig.onlyGroups.includes(groupId)
    const isUserEnabled = await this.getUserEmojiReactionEnabled(userId, Boolean(emojiConfig.globalEnabled))

    const statusMsg = [
      '🎭 表情回应状态',
      '━━━━━━━━━━━━━━',
      `功能状态: ${emojiConfig.enable ? '✅ 已开启' : '❌ 已关闭'}`,
      `本群状态: ${isGroupAllowed ? '✅ 已生效' : '❌ 不在白名单'}`,
      e.isMaster ? `全局默认: ${emojiConfig.globalEnabled ? '✅ 开启' : '❌ 关闭'}` : '',
      `个人状态: ${isUserEnabled ? '✅ 已开启' : '❌ 已关闭'}`,
      `回应模式: ${emojiConfig.useSameEmoji ? '🔄 同表情回应' : `📍 固定表情(${emojiConfig.emojiId || '74'})`}`,
      emojiConfig.useSameEmoji ? `多表情处理: ${emojiConfig.reactToAllEmojis !== false ? '回应全部' : '仅首个'}` : '',
      `冷却时间: ${emojiConfig.cooldown || 5}秒`,
      '',
      '白名单群:',
      emojiConfig.onlyGroups?.length ? emojiConfig.onlyGroups.map((id) => `  ${id}`).join('\n') : '  所有群',
      '━━━━━━━━━━━━━━',
      '支持: QQ表情 + Unicode Emoji(😀👍)',
      '指令: #表情回应[开启/关闭/状态/设置]',
      '个人: #开启/关闭我的表情回应',
      e.isMaster ? '主人: #开启/关闭全局表情回应' : ''
    ].filter(Boolean).join('\n')

    await e.reply(statusMsg, true)
    return true
  }

  async emojiReactionHelp(e) {
    const helpCfg = {
      themeSet: false,
      title: '表情回应帮助',
      subTitle: 'Emoji Reaction - 让互动更有趣',
      colWidth: 265,
      theme: 'all',
      themeExclude: ['default'],
      colCount: 2,
      bgBlur: true
    }

    const helpList = [
      {
        group: '🎭 个人设置',
        list: [
          { icon: 74, title: '#开启我的表情回应', desc: '开启对自己的表情回应功能' },
          { icon: 76, title: '#关闭我的表情回应', desc: '关闭对自己的表情回应功能' },
          { icon: 79, title: '#表情回应状态', desc: '查看当前功能和个人状态' }
        ]
      },
      {
        group: '⚙️ 主人设置',
        list: [
          { icon: 55, title: '#表情回应开启/关闭', desc: '开启或关闭整个表情回应功能' },
          { icon: 56, title: '#开启/关闭全局表情回应', desc: '设置未设置用户的默认行为' },
          { icon: 57, title: '#表情回应设置表情 [ID]', desc: '设置固定回应的表情ID，如74' },
          { icon: 58, title: '#表情回应设置同表情', desc: '使用用户发送的相同表情回应' },
          { icon: 59, title: '#表情回应设置全部/单个回应', desc: '回应所有表情或仅首个' },
          { icon: 60, title: '#表情回应设置冷却 [秒]', desc: '设置冷却时间防止刷屏' },
          { icon: 61, title: '#表情回应设置本群', desc: '添加/移除当前群到白名单' }
        ]
      },
      {
        group: '😊 常用表情ID参考',
        list: [
          { icon: 74, title: '74 - ❤️ 爱心', desc: '常用固定回应表情' },
          { icon: 76, title: '76 - 😂 笑哭', desc: '表达开心或无奈' },
          { icon: 179, title: '179 - 👍 点赞', desc: '表示赞同和支持' },
          { icon: 176, title: '176 - 🔍 搜索', desc: '思考中或查找中' }
        ]
      }
    ]

    const helpGroup = []
    _.forEach(helpList, (group) => {
      _.forEach(group.list, (help) => {
        const icon = help.icon * 1
        if (!icon) {
          help.css = 'display:none'
        } else {
          const x = (icon - 1) % 10
          const y = (icon - x - 1) / 10
          help.css = `background-position:-${x * 50}px -${y * 50}px`
        }
      })
      helpGroup.push(group)
    })

    const themeData = await this.getThemeData(helpCfg, helpCfg)
    return Render.render('help/index', {
      helpCfg,
      helpGroup,
      ...themeData,
      element: 'default'
    }, { e, scale: 1.6 })
  }

  async getThemeCfg() {
    const resPath = '{{_res_path}}/help/imgs/'
    return {
      main: `${resPath}/main.png`,
      bg: `${resPath}/bg.jpg`,
      style
    }
  }

  async getThemeData(diyStyle, sysStyle) {
    const helpConfig = _.extend({}, sysStyle, diyStyle)
    const colCount = Math.min(5, Math.max(parseInt(helpConfig?.colCount) || 3, 2))
    const colWidth = Math.min(500, Math.max(100, parseInt(helpConfig?.colWidth) || 265))
    const width = Math.min(2500, Math.max(800, colCount * colWidth + 30))
    const theme = await this.getThemeCfg()
    const themeStyle = theme.style || {}
    const ret = [`
      body{background-image:url(${theme.bg});width:${width}px;}
      .container{background-image:url(${theme.main});width:${width}px;}
      .help-table .td,.help-table .th{width:${100 / colCount}%}
    `]

    const css = function (sel, cssProp, key, def, fn) {
      let val = (function () {
        for (const idx in arguments) {
          if (!_.isUndefined(arguments[idx])) {
            return arguments[idx]
          }
        }
      })(themeStyle[key], diyStyle[key], sysStyle[key], def)
      if (fn) {
        val = fn(val)
      }
      ret.push(`${sel}{${cssProp}:${val}}`)
    }

    css('.help-title,.help-group', 'color', 'fontColor', '#ceb78b')
    css('.help-title,.help-group', 'text-shadow', 'fontShadow', 'none')
    css('.help-desc', 'color', 'descColor', '#eee')
    css('.cont-box', 'background', 'contBgColor', 'rgba(43, 52, 61, 0.8)')
    css('.cont-box', 'backdrop-filter', 'contBgBlur', 3, (n) => diyStyle.bgBlur === false ? 'none' : `blur(${n}px)`)
    css('.help-group', 'background', 'headerBgColor', 'rgba(34, 41, 51, .4)')
    css('.help-table .tr:nth-child(odd)', 'background', 'rowBgColor1', 'rgba(34, 41, 51, .2)')
    css('.help-table .tr:nth-child(even)', 'background', 'rowBgColor2', 'rgba(34, 41, 51, .4)')

    return {
      style: `<style>${ret.join('\n')}</style>`,
      colCount
    }
  }
}
