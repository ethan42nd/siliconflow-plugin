import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'

/**
 * 智能工具调用系统
 * 
 * 功能：
 * 1. 根据用户意图自动调用工具
 * 2. 支持多轮工具调用
 * 3. 与 AI 对话系统集成
 * 4. 支持本地工具和 MCP 工具
 */

// ==================== 工具基类 ====================

export class BaseTool {
  constructor(config = {}) {
    this.config = config
    this.name = 'baseTool'
    this.description = '基础工具'
    this.parameters = {
      type: 'object',
      properties: {},
      required: []
    }
  }

  /**
   * 执行工具
   * @param {object} params - 工具参数
   * @param {object} e - 消息事件对象
   * @returns {Promise<string>} 工具执行结果
   */
  async execute(params, e) {
    throw new Error('Tool must implement execute method')
  }

  /**
   * 获取工具定义（用于 OpenAI function calling）
   */
  getDefinition() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    }
  }
}

// ==================== 具体工具实现 ====================

/**
 * 戳一戳工具
 */
export class PokeTool extends BaseTool {
  constructor() {
    super()
    this.name = 'pokeTool'
    this.description = '戳一戳（窗口抖动）指定的群成员。当用户说"戳一下某人"、"抖动某人"时使用。'
    this.parameters = {
      type: 'object',
      properties: {
        user_qq_number: {
          type: 'string',
          description: '要戳的用户的QQ号'
        }
      },
      required: ['user_qq_number']
    }
  }

  async execute(params, e) {
    const { user_qq_number } = params
    const targetId = String(user_qq_number).replace(/[^0-9]/g, '')
    
    if (!targetId || targetId.length < 5) {
      return '无效的QQ号'
    }

    try {
      // 发送戳一戳
      await e.group?.pokeMember(targetId)
      return `成功戳了 ${targetId}`
    } catch (error) {
      return `戳一戳失败: ${error.message}`
    }
  }
}

/**
 * 点赞工具
 */
export class LikeTool extends BaseTool {
  constructor() {
    super()
    this.name = 'likeTool'
    this.description = '给指定的群成员点赞。当用户说"给某人点赞"、"赞一下某人"时使用。'
    this.parameters = {
      type: 'object',
      properties: {
        user_qq_number: {
          type: 'string',
          description: '要点赞的用户的QQ号'
        },
        times: {
          type: 'number',
          description: '点赞次数（1-20）',
          default: 10
        }
      },
      required: ['user_qq_number']
    }
  }

  async execute(params, e) {
    const { user_qq_number, times = 10 } = params
    const targetId = String(user_qq_number).replace(/[^0-9]/g, '')
    const likeTimes = Math.min(Math.max(parseInt(times) || 10, 1), 20)
    
    if (!targetId || targetId.length < 5) {
      return '无效的QQ号'
    }

    try {
      // 点赞
      for (let i = 0; i < likeTimes; i++) {
        await e.bot.sendLike(targetId, 1)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return `成功给 ${targetId} 点了 ${likeTimes} 个赞`
    } catch (error) {
      return `点赞失败: ${error.message}`
    }
  }
}

/**
 * 撤回消息工具
 */
export class RecallTool extends BaseTool {
  constructor() {
    super()
    this.name = 'recallTool'
    this.description = '撤回指定的消息。当用户说"撤回"、"撤回上一条消息"时使用。'
    this.parameters = {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: '要撤回的消息ID（可选，不传则撤回最近的消息）'
        }
      },
      required: []
    }
  }

  async execute(params, e) {
    try {
      // 撤回当前消息
      await e.recall()
      return '消息已撤回'
    } catch (error) {
      return `撤回失败: ${error.message}`
    }
  }
}

/**
 * 禁言工具
 */
export class MuteTool extends BaseTool {
  constructor() {
    super()
    this.name = 'muteTool'
    this.description = '禁言指定的群成员。当用户说"禁言某人"、"把某人禁言"时使用。'
    this.parameters = {
      type: 'object',
      properties: {
        user_qq_number: {
          type: 'string',
          description: '要禁言的用户的QQ号'
        },
        duration: {
          type: 'number',
          description: '禁言时长（秒），默认600秒（10分钟）',
          default: 600
        }
      },
      required: ['user_qq_number']
    }
  }

  async execute(params, e) {
    const { user_qq_number, duration = 600 } = params
    const targetId = String(user_qq_number).replace(/[^0-9]/g, '')
    const muteDuration = Math.min(Math.max(parseInt(duration) || 600, 60), 2592000) // 1分钟到30天
    
    if (!targetId || targetId.length < 5) {
      return '无效的QQ号'
    }

    // 检查权限
    const botMember = await e.group.pickMember(Bot.uin)
    const targetMember = await e.group.pickMember(targetId)
    
    if (!botMember.is_admin && !botMember.is_owner) {
      return '机器人不是管理员，无法禁言'
    }
    
    if (targetMember.is_owner) {
      return '不能禁言群主'
    }
    
    if (targetMember.is_admin && !botMember.is_owner) {
      return '不能禁言其他管理员'
    }

    try {
      await e.group.muteMember(targetId, muteDuration)
      const minutes = Math.floor(muteDuration / 60)
      return `已禁言 ${targetId} ${minutes} 分钟`
    } catch (error) {
      return `禁言失败: ${error.message}`
    }
  }
}

/**
 * 获取群成员信息工具
 */
export class MemberInfoTool extends BaseTool {
  constructor() {
    super()
    this.name = 'memberInfoTool'
    this.description = '获取指定群成员的详细信息，包括昵称、群名片、权限等级等。'
    this.parameters = {
      type: 'object',
      properties: {
        user_qq_number: {
          type: 'string',
          description: '要查询的用户的QQ号'
        }
      },
      required: ['user_qq_number']
    }
  }

  async execute(params, e) {
    const { user_qq_number } = params
    const targetId = String(user_qq_number).replace(/[^0-9]/g, '')
    
    if (!targetId || targetId.length < 5) {
      return '无效的QQ号'
    }

    try {
      const member = await e.group.pickMember(targetId)
      const info = await member.getInfo()
      
      return `用户信息：
昵称: ${info.nickname}
群名片: ${info.card || '未设置'}
QQ: ${info.user_id}
性别: ${info.sex === 'male' ? '男' : info.sex === 'female' ? '女' : '未知'}
年龄: ${info.age || '未知'}
等级: ${info.level || '未知'}
入群时间: ${info.join_time ? new Date(info.join_time * 1000).toLocaleString() : '未知'}
最后发言: ${info.last_sent_time ? new Date(info.last_sent_time * 1000).toLocaleString() : '未知'}
权限: ${info.role === 'owner' ? '群主' : info.role === 'admin' ? '管理员' : '普通成员'}`
    } catch (error) {
      return `获取信息失败: ${error.message}`
    }
  }
}

// ==================== 工具管理器 ====================

export class SmartTools extends plugin {
  constructor() {
    super({
      name: '智能工具调用',
      dsc: '基于AI意图识别的工具调用系统',
      event: 'message',
      priority: 1000,
      rule: [
        { reg: '^#(tool|工具)\\s*(.*)', fnc: 'handleToolCommand' },
        { reg: '^#工具列表$', fnc: 'listTools' },
        { reg: '[\\s\\S]*', fnc: 'handleMessage', log: false }
      ]
    })

    this.initTools()
  }

  /**
   * 初始化工具
   */
  initTools() {
    this.toolInstances = {
      pokeTool: new PokeTool(),
      likeTool: new LikeTool(),
      recallTool: new RecallTool(),
      muteTool: new MuteTool(),
      memberInfoTool: new MemberInfoTool()
    }

    // 生成工具定义列表
    this.toolDefinitions = Object.values(this.toolInstances).map(tool => tool.getDefinition())
    
    // 工具映射
    this.toolMap = new Map(Object.entries(this.toolInstances))
  }

  /**
   * 获取工具定义列表
   */
  getToolDefinitions() {
    return this.toolDefinitions
  }

  /**
   * 处理工具命令
   */
  async handleToolCommand(e) {
    if (!e.isMaster) {
      return e.reply('仅主人可以使用此命令')
    }

    const args = e.msg.replace(/^#(tool|工具)\s*/, '').trim()
    if (!args) {
      return this.listTools(e)
    }

    // 解析工具调用
    const match = args.match(/(\w+)\s*\((.*)\)/)
    if (!match) {
      return e.reply('格式错误。示例: #tool pokeTool({"user_qq_number": "123456"})')
    }

    const [, toolName, paramsStr] = match
    const tool = this.toolMap.get(toolName)
    
    if (!tool) {
      return e.reply(`工具 "${toolName}" 不存在`)
    }

    try {
      const params = JSON.parse(paramsStr)
      const result = await tool.execute(params, e)
      return e.reply(`工具执行结果:\n${result}`)
    } catch (error) {
      return e.reply(`执行失败: ${error.message}`)
    }
  }

  /**
   * 列出所有工具
   */
  async listTools(e) {
    const lines = ['🔧 【可用工具列表】']
    
    for (const [name, tool] of this.toolMap) {
      lines.push(`\n${name}:`)
      lines.push(`  描述: ${tool.description}`)
      lines.push(`  参数: ${JSON.stringify(tool.parameters.properties)}`)
    }

    return e.reply(lines.join('\n'))
  }

  /**
   * 处理普通消息 - 意图识别和工具调用
   */
  async handleMessage(e) {
    const config = Config.getConfig()
    const toolsConfig = config.smartMode?.tools

    // 检查工具调用是否启用
    if (!toolsConfig?.enable) return false

    // 检查群白名单
    if (toolsConfig.groupList?.length > 0) {
      if (!toolsConfig.groupList.includes(String(e.group_id))) return false
    }

    // 检查是否是命令
    if (e.msg?.startsWith('#')) return false

    // 检查触发条件
    const shouldTrigger = await this.shouldTriggerToolCalling(e, config)
    if (!shouldTrigger) return false

    // 执行工具调用流程
    return await this.executeToolCalling(e, config)
  }

  /**
   * 判断是否触发工具调用
   */
  async shouldTriggerToolCalling(e, config) {
    // 必须@机器人或者是主人
    const isAt = e.message?.some(m => m.type === 'at' && m.qq == Bot.uin)
    const isMaster = e.isMaster
    
    if (!isAt && !isMaster) return false

    // 检查消息内容是否包含工具相关意图
    const toolKeywords = [
      '戳', '抖动', 'poke',
      '赞', '点赞', 'like',
      '撤回', 'delete', 'recall',
      '禁言', 'mute', '封',
      '查询', '信息', 'info'
    ]

    const msg = e.msg?.toLowerCase() || ''
    return toolKeywords.some(kw => msg.includes(kw))
  }

  /**
   * 执行工具调用
   */
  async executeToolCalling(e, config) {
    try {
      // 获取启用的工具列表
      const enabledTools = config.smartMode?.tools?.enabledTools || []
      const tools = enabledTools.length > 0 
        ? this.toolDefinitions.filter(t => enabledTools.includes(t.function.name))
        : this.toolDefinitions

      if (tools.length === 0) return false

      // 构建系统提示词
      const systemPrompt = this.buildSystemPrompt(tools)

      // 构建请求数据
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `用户在群${e.group_id}说: ${e.msg}` }
      ]

      const requestData = {
        model: config.smartMode?.tools?.model || 'gpt-3.5-turbo',
        messages,
        tools,
        tool_choice: 'auto'
      }

      // 调用AI判断是否需要工具
      const response = await this.callAI(requestData, config)
      
      if (!response?.choices?.[0]?.message?.tool_calls) {
        return false
      }

      // 执行工具调用
      const toolCalls = response.choices[0].message.tool_calls
      const results = []

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name
        const tool = this.toolMap.get(toolName)
        
        if (!tool) continue

        try {
          const params = JSON.parse(toolCall.function.arguments || '{}')
          const result = await tool.execute(params, e)
          results.push({ tool: toolName, result })
        } catch (error) {
          results.push({ tool: toolName, error: error.message })
        }
      }

      // 如果有工具执行成功，回复结果
      if (results.length > 0) {
        const successResults = results.filter(r => !r.error)
        if (successResults.length > 0) {
          const reply = successResults.map(r => r.result).join('\n')
          await e.reply(reply)
          return true
        }
      }

      return false
    } catch (error) {
      logger.error(`[SmartTools] 工具调用失败: ${error}`)
      return false
    }
  }

  /**
   * 构建系统提示词
   */
  buildSystemPrompt(tools) {
    const toolDescriptions = tools.map(t => 
      `- ${t.function.name}: ${t.function.description}\n  参数: ${JSON.stringify(t.function.parameters.properties)}`
    ).join('\n')

    return `你是QQ群助手，负责判断用户意图并调用合适的工具。

【可用工具】
${toolDescriptions}

【规则】
1. 如果用户需要某个工具功能，请调用对应的工具
2. 从用户消息中提取QQ号等参数
3. 如果不需要工具，直接返回空回复
4. 工具调用使用JSON格式

【示例】
用户: "戳一下123456"
你应该调用: pokeTool({"user_qq_number": "123456"})

用户: "给789点赞"
你应该调用: likeTool({"user_qq_number": "789"})`
  }

  /**
   * 调用AI
   */
  async callAI(requestData, config) {
    const toolsConfig = config.smartMode?.tools
    const apiConfig = config.smart_APIList?.find(api => api.remark === toolsConfig?.model)
    
    if (!apiConfig) {
      throw new Error('未找到工具调用模型配置')
    }

    const apiKey = apiConfig.apiKey || (config.sf_keys?.[0]?.sf_key || '')

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    })

    return await response.json()
  }
}

// 默认导出插件类
export default SmartTools
