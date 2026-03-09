import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import fetch from 'node-fetch'

/**
 * 记忆收集器 v3 - 合并版
 * 
 * 功能：
 * 1. 实时收集群聊消息到 Redis 缓冲区
 * 2. 自动/手动触发结构化记忆提炼
 * 3. 深度同步历史记忆（集成 group-insight 插件）
 * 4. 支持跨群调试和主人指定目标
 * 5. 支持手动查看、修改和清空用户档案
 * 
 * 存储结构：
 * - sf_plugin:memory_buffer:{group_id}:{user_id} - 消息缓冲区
 * - sf_plugin:memory_structured:{group_id}:{user_id} - 结构化记忆
 * - sf_plugin:memory_last_extract:{group_id}:{user_id} - 上次提炼时间
 * - sf_plugin:memory_lock:{group_id}:{user_id} - 提炼锁
 */

// ==================== 提示词预设 ====================
const PROMPT_PRESETS = {
  standard: {
    name: '标准模式',
    structuredPrompt: `你是一个专业的用户信息分析助手。请分析用户的聊天记录，提取结构化信息。

请严格按照以下JSON格式输出（不要包含任何其他内容，确保输出是合法的JSON）：
{
  "facts": [
    {
      "category": "basic",
      "key": "属性名称",
      "value": "属性值",
      "confidence": 0.9
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "事件描述",
      "importance": 0.8,
      "emotionalTone": "情绪色彩"
    }
  ],
  "summary": {
    "short": "一句话总结（30字内）",
    "detailed": "详细描述（100字内）"
  }
}

category 可选值：basic(基本信息), interest(兴趣), personality(性格), habit(习惯), relationship(人际关系), skill(技能)
注意：只输出JSON，不要解释；confidence范围0-1；不要编造信息。`,
    syncPrompt: `你是一个顶级的心理侧写师。请根据用户的历史聊天记录，生成深度结构化档案。

请严格按照以下JSON格式输出（不要包含任何其他内容）：
{
  "facts": [
    {"category": "basic|interest|personality|habit|relationship|skill", "key": "属性名", "value": "属性值", "confidence": 0.9}
  ],
  "episodes": [
    {"date": "YYYY-MM-DD", "event": "重要事件描述", "importance": 0.8, "emotionalTone": "情绪"}
  ],
  "social": {
    "closeFriends": ["好友昵称1", "好友昵称2"],
    "activeTopics": ["常聊话题1", "常聊话题2"],
    "roleInGroup": "群内角色"
  },
  "summary": {
    "short": "一句话画像（50字内）",
    "detailed": "详细画像（300字内）"
  }
}

注意：只输出JSON，不要解释；结合历史档案分析；确保JSON格式合法。`
  },
  concise: {
    name: '简洁模式',
    structuredPrompt: `分析用户聊天，提取关键信息，输出JSON：
{
  "facts": [{"category": "basic|interest|personality", "key": "属性", "value": "值", "confidence": 0.8}],
  "episodes": [],
  "summary": {"short": "一句话总结", "detailed": ""}
}
只提取高置信度(>0.7)的关键信息，不要冗余内容。`,
    syncPrompt: `深度分析用户历史记录，输出JSON档案：
{
  "facts": [{"category": "basic|interest|personality", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": [], "activeTopics": [], "roleInGroup": ""},
  "summary": {"short": "", "detailed": ""}
}
只记录重要事实和事件，简洁高效。`
  },
  detailed: {
    name: '详细模式',
    structuredPrompt: `你是专业用户分析师。深入分析聊天记录，提取丰富的用户信息。

输出JSON格式：
{
  "facts": [
    {"category": "basic|interest|personality|habit|relationship|skill", "key": "具体属性名", "value": "详细属性值", "confidence": 0.85}
  ],
  "episodes": [
    {"date": "YYYY-MM-DD", "event": "详细事件描述，包含上下文", "importance": 0.8, "emotionalTone": "具体情绪描述"}
  ],
  "summary": {
    "short": "精炼的一句话画像",
    "detailed": "详细的用户画像描述，包含性格特点、兴趣爱好、行为模式等多维度分析"
  }
}

要求：仔细分析每条消息；关注语言风格；记录具体细节；确保输出合法JSON。`,
    syncPrompt: `你是资深用户研究专家。基于大量历史数据，生成深度用户画像档案。

输出JSON格式：
{
  "facts": [{"category": "basic|interest|personality|habit|relationship|skill", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "YYYY-MM-DD", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": [], "activeTopics": [], "roleInGroup": ""},
  "summary": {"short": "", "detailed": ""}
}

分析要求：深度综合分析；识别行为模式；记录重要事件；推断潜在需求。`
  },
  roleplay: {
    name: '角色扮演模式',
    structuredPrompt: `分析群聊中的角色扮演信息，提取角色设定。

输出JSON：
{
  "facts": [
    {"category": "basic", "key": "角色名", "value": "", "confidence": 0.9},
    {"category": "basic", "key": "性别/年龄", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "喜好", "value": "", "confidence": 0.7},
    {"category": "personality", "key": "性格", "value": "", "confidence": 0.8},
    {"category": "relationship", "key": "关系", "value": "", "confidence": 0.7},
    {"category": "skill", "key": "能力/技能", "value": "", "confidence": 0.7}
  ],
  "episodes": [{"date": "", "event": "剧情事件", "importance": 0.8, "emotionalTone": ""}],
  "summary": {"short": "角色一句话简介", "detailed": "角色详细设定"}
}

注意区分角色扮演内容和现实信息，优先记录角色设定。`,
    syncPrompt: `深度分析RP群历史记录，整理角色档案。

输出JSON：
{
  "facts": [{"category": "", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": [], "activeTopics": [], "roleInGroup": "剧情定位"},
  "summary": {"short": "", "detailed": ""}
}

重点：梳理角色设定；记录剧情发展；分析成长轨迹；区分时间线。`
  },
  game: {
    name: '游戏群模式',
    structuredPrompt: `分析游戏群聊天记录，提取游戏相关信息。

输出JSON：
{
  "facts": [
    {"category": "basic", "key": "游戏ID", "value": "", "confidence": 0.9},
    {"category": "skill", "key": "段位/等级", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "常玩英雄/角色", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "擅长位置", "value": "", "confidence": 0.7},
    {"category": "habit", "key": "游戏习惯", "value": "", "confidence": 0.6}
  ],
  "episodes": [{"date": "", "event": "上分/掉分、精彩操作等", "importance": 0.7, "emotionalTone": ""}],
  "summary": {"short": "玩家简介", "detailed": "游戏风格和特点"}
}

重点提取游戏ID、段位、常用角色等硬核信息。`,
    syncPrompt: `分析游戏群历史，整理玩家档案。

输出JSON：
{
  "facts": [{"category": "", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": ["经常组队的队友"], "activeTopics": ["常讨论的游戏"], "roleInGroup": "群内游戏水平定位"},
  "summary": {"short": "", "detailed": ""}
}

关注：技术成长和段位变化；常用英雄演变；游戏态度；突出事件。`
  }
}

// ==================== 常量定义 ====================

const REDIS_KEYS = {
  BUFFER: (groupId, userId) => `sf_plugin:memory_buffer:${groupId}:${userId}`,
  STRUCTURED: (groupId, userId) => `sf_plugin:memory_structured:${groupId}:${userId}`,
  LAST_EXTRACT: (groupId, userId) => `sf_plugin:memory_last_extract:${groupId}:${userId}`,
  LOCK: (groupId, userId) => `sf_plugin:memory_lock:${groupId}:${userId}`
}

const FACT_CATEGORIES = {
  BASIC: 'basic',
  INTEREST: 'interest',
  PERSONALITY: 'personality',
  HABIT: 'habit',
  RELATIONSHIP: 'relationship',
  SKILL: 'skill'
}

const DEFAULT_MEMORY_STRUCTURE = {
  meta: {
    userId: '',
    groupId: '',
    nickname: '',
    card: '',
    firstSeen: 0,
    lastUpdated: 0,
    version: 3
  },
  facts: [],
  episodes: [],
  social: {
    closeFriends: [],
    activeTopics: [],
    roleInGroup: ''
  },
  summary: {
    short: '',
    detailed: ''
  }
}

// ==================== 工具函数 ====================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const logReplacer = (key, value) => {
  if (typeof value === 'string' && value.length > 500) {
    return value.substring(0, 50) + '... [内容过长，已自动折叠]'
  }
  return value
}

const logTruncate = (str, maxLen = 100) => {
  if (!str || str.length <= maxLen) return str
  return str.substring(0, maxLen) + `...[${str.length - maxLen} chars omitted]`
}

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0
  if (str1 === str2) return 1
  const set1 = new Set(str1.toLowerCase().split(''))
  const set2 = new Set(str2.toLowerCase().split(''))
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])
  return intersection.size / union.size
}

function getTodayString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return defaultValue
  }
}

function getPrompt(memConf, isDeepSync = false) {
  const presetKey = memConf.promptPreset || 'standard'
  const preset = PROMPT_PRESETS[presetKey]
  
  if (isDeepSync) {
    return memConf.syncPrompt || (preset ? preset.syncPrompt : PROMPT_PRESETS.standard.syncPrompt)
  } else {
    return memConf.structuredPrompt || (preset ? preset.structuredPrompt : PROMPT_PRESETS.standard.structuredPrompt)
  }
}

// ==================== 主类定义 ====================

export class UserMemory extends plugin {
  constructor() {
    super({
      name: '用户记忆收集器',
      dsc: '收集群聊信息并提炼结构化用户画像',
      event: 'message',
      priority: 50000,
      rule: [
        { reg: '^#(提取|整理)记忆$', fnc: 'extractMemory' },
        { reg: '^#同步(我的)?历史记忆.*$', fnc: 'syncHistoryMemory' },
        { reg: '^#我的(记忆|档案)$', fnc: 'viewMemory' },
        { reg: '^#记忆详情$', fnc: 'viewMemoryDetail' },
        { reg: '^#(修改|设定)记忆\s*(.*)$', fnc: 'setMemory' },
        { reg: '^#(清空|删除)记忆$', fnc: 'clearMemory' },
        { reg: '', fnc: 'collectMessage', log: false }
      ]
    })
  }

  // ==================== 1. 消息收集 ====================

  async collectMessage(e) {
    if (!e.isGroup) return false

    const config = Config.getConfig()
    const memConf = config.smartMode?.memory || {}
    if (!memConf.enable) return false

    const userId = String(e.user_id)
    const groupId = String(e.group_id)

    const groupList = memConf.groupList || []
    if (groupList.length > 0 && !groupList.includes(groupId)) return false

    if (e.target_id === e.self_id) return false
    if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false

    const blackList = memConf.blackList || []
    if (blackList.includes(userId)) return false

    const contentToSave = this.extractMessageContent(e)
    if (!contentToSave.trim()) return false

    await this.addToBuffer(groupId, userId, {
      content: contentToSave,
      timestamp: Date.now(),
      msgId: e.message_id || Date.now().toString(),
      sender: {
        nickname: e.sender?.nickname || '',
        card: e.sender?.card || ''
      }
    })

    if (memConf.autoExtract?.enable) {
      this.checkAutoExtract(groupId, userId, memConf).catch(err => {
        logger.error(`[记忆收集] 自动提炼检查失败: ${err}`)
      })
    }

    return false
  }

  extractMessageContent(e) {
    let content = ''
    
    if (e.message && Array.isArray(e.message)) {
      for (let msg of e.message) {
        if (msg.type === 'text') content += msg.text
        else if (msg.type === 'image') content += '[发送图片] '
        else if (msg.type === 'face') content += '[QQ表情] '
        else if (msg.type === 'at') content += `[@${msg.qq}] `
        else if (msg.type === 'reply') content += '[回复消息] '
      }
    } else if (e.msg) {
      content = e.msg
    }

    return content.trim()
  }

  async addToBuffer(groupId, userId, messageData) {
    const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
    const config = Config.getConfig()
    const memConf = config.smartMode?.memory || {}
    const maxSize = memConf.autoExtract?.maxBufferSize || 30

    try {
      await redis.lPush(bufferKey, JSON.stringify(messageData))
      await redis.lTrim(bufferKey, 0, maxSize - 1)
      const expireDays = memConf.autoExtract?.bufferExpireDays || 7
      await redis.expire(bufferKey, 60 * 60 * 24 * expireDays)

      if (memConf.logEnable) {
        logger.mark(`[记忆收集] ${groupId} - ${messageData.sender?.nickname || userId}: ${logTruncate(messageData.content, 50)}`)
      }
    } catch (error) {
      logger.error(`[记忆收集] 缓冲区写入失败: ${error}`)
    }
  }

  async getBufferMessages(groupId, userId) {
    const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
    try {
      const messages = await redis.lRange(bufferKey, 0, -1)
      return messages.map(msg => safeJsonParse(msg)).filter(Boolean)
    } catch (error) {
      logger.error(`[记忆收集] 读取缓冲区失败: ${error}`)
      return []
    }
  }

  // ==================== 2. 自动提炼 ====================

  async checkAutoExtract(groupId, userId, memConf) {
    const threshold = memConf.autoExtract?.threshold || 10
    const minInterval = memConf.autoExtract?.minInterval || 3600

    const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
    const bufferSize = await redis.lLen(bufferKey)

    if (bufferSize < threshold) return

    const lastExtractKey = REDIS_KEYS.LAST_EXTRACT(groupId, userId)
    const lastExtract = await redis.get(lastExtractKey)
    
    if (lastExtract) {
      const elapsed = (Date.now() - parseInt(lastExtract)) / 1000
      if (elapsed < minInterval) return
    }

    const lockKey = REDIS_KEYS.LOCK(groupId, userId)
    const locked = await redis.get(lockKey)
    if (locked) return

    this.performAutoExtract(groupId, userId, memConf).catch(err => {
      logger.error(`[记忆收集] 自动提炼执行失败: ${err}`)
    })
  }

  async performAutoExtract(groupId, userId, memConf) {
    const lockKey = REDIS_KEYS.LOCK(groupId, userId)
    
    try {
      await redis.set(lockKey, '1', { EX: 60 })

      const messages = await this.getBufferMessages(groupId, userId)
      if (messages.length < (memConf.autoExtract?.threshold || 5)) {
        await redis.del(lockKey)
        return
      }

      logger.info(`[记忆收集] 触发自动提炼: ${groupId} - ${userId}, 消息数: ${messages.length}`)

      await this.processMemoryExtraction(groupId, userId, messages, false)
      await redis.set(REDIS_KEYS.LAST_EXTRACT(groupId, userId), Date.now().toString())

    } catch (error) {
      logger.error(`[记忆收集] 自动提炼失败: ${error}`)
    } finally {
      await redis.del(lockKey)
    }
  }

  // ==================== 3. 记忆提炼核心 ====================

  async processMemoryExtraction(groupId, userId, messages, isDeepSync = false) {
    const config = Config.getConfig()
    const memConf = config.smartMode?.memory || {}

    const existingMemory = await this.getStructuredMemory(groupId, userId)
    const systemPrompt = getPrompt(memConf, isDeepSync)
    const userPrompt = this.buildExtractionPrompt(existingMemory, messages, isDeepSync, groupId, userId)

    const modelRemark = isDeepSync ? memConf.syncModel : memConf.selectedModel
    if (!modelRemark) {
      throw new Error(`未配置${isDeepSync ? '历史同步' : '记忆提炼'}模型`)
    }

    const apiConfig = config.smart_APIList?.find(api => api.remark === modelRemark)
    if (!apiConfig) {
      throw new Error(`未找到名为 [${modelRemark}] 的接口配置`)
    }

    const extractedData = await this.callLLM(apiConfig, systemPrompt, userPrompt, isDeepSync, memConf)

    if (!extractedData) {
      throw new Error('LLM 返回数据解析失败')
    }

    const mergedMemory = this.consolidateMemory(existingMemory, extractedData, memConf.consolidation)
    mergedMemory.meta.lastUpdated = Date.now()
    if (!mergedMemory.meta.firstSeen) {
      mergedMemory.meta.firstSeen = Date.now()
    }

    await this.saveStructuredMemory(groupId, userId, mergedMemory)
    await redis.del(REDIS_KEYS.BUFFER(groupId, userId))

    return mergedMemory
  }

  buildExtractionPrompt(existingMemory, messages, isDeepSync, groupId, userId) {
    const groupInfo = Bot.gl?.get(Number(groupId))
    const groupName = groupInfo?.group_name || '本群'

    const messageTexts = messages.map((m, idx) => {
      const date = new Date(m.timestamp).toLocaleString()
      return `[${idx + 1}] ${date} ${m.sender?.nickname || '未知'}: ${m.content}`
    }).join('\n')

    let prompt = `【群组名称】：${groupName}\n\n`

    if (existingMemory && existingMemory.facts.length > 0) {
      prompt += `【历史档案摘要】：${existingMemory.summary.short || '暂无'}\n`
      prompt += `【历史事实记录】（${existingMemory.facts.length}条）：\n`
      existingMemory.facts.slice(0, 10).forEach(f => {
        prompt += `- [${f.category}] ${f.key}: ${f.value} (置信度:${f.confidence})\n`
      })
      prompt += '\n'
    }

    prompt += `【待分析的 ${messages.length} 条消息】：\n${messageTexts}\n\n`
    prompt += `请分析以上消息，提取结构化信息。只输出JSON，不要任何解释。`

    return prompt
  }

  async callLLM(apiConfig, systemPrompt, userPrompt, isDeepSync, memConf) {
    const config = Config.getConfig()
    const apiKey = apiConfig.apiKey || (config.sf_keys?.[0]?.sf_key || '')
    
    const requestBody = {
      model: apiConfig.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: isDeepSync ? 2000 : 800
    }

    try {
      if (memConf.debugLog) {
        logger.mark(`[记忆收集] API请求:\n${JSON.stringify(requestBody, logReplacer, 2)}`)
      }

      const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (memConf.debugLog) {
        logger.mark(`[记忆收集] API响应:\n${logTruncate(JSON.stringify(data), 500)}`)
      }

      if (data.choices?.[0]?.message?.content) {
        return this.parseLLMResponse(data.choices[0].message.content)
      }

      return null
    } catch (error) {
      logger.error(`[记忆收集] LLM 调用失败: ${error}`)
      return null
    }
  }

  parseLLMResponse(content) {
    let data = safeJsonParse(content)
    if (data) return data

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                      content.match(/```\s*([\s\S]*?)```/) ||
                      content.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      data = safeJsonParse(jsonMatch[1] || jsonMatch[0])
      if (data) return data
    }

    logger.warn(`[记忆收集] 无法解析 LLM 返回: ${logTruncate(content, 200)}`)
    return null
  }

  // ==================== 4. 记忆存储与读取 ====================

  async getStructuredMemory(groupId, userId) {
    const key = REDIS_KEYS.STRUCTURED(groupId, userId)
    try {
      const data = await redis.get(key)
      if (data) {
        const parsed = safeJsonParse(data)
        if (parsed) return parsed
      }
    } catch (error) {
      logger.error(`[记忆收集] 读取记忆失败: ${error}`)
    }

    return {
      ...DEFAULT_MEMORY_STRUCTURE,
      meta: { ...DEFAULT_MEMORY_STRUCTURE.meta, userId, groupId }
    }
  }

  async saveStructuredMemory(groupId, userId, memory) {
    const key = REDIS_KEYS.STRUCTURED(groupId, userId)
    try {
      await redis.set(key, JSON.stringify(memory))
      return true
    } catch (error) {
      logger.error(`[记忆收集] 保存记忆失败: ${error}`)
      return false
    }
  }

  // ==================== 5. 记忆整合 ====================

  consolidateMemory(existing, extracted, config = {}) {
    const threshold = config.similarityThreshold || 0.85
    const maxPerCategory = config.maxFactsPerCategory || 20
    const confidenceThreshold = config.confidenceThreshold || 0.3
    const retentionDays = config.retentionDays || 90
    const mergeStrategy = config.mergeStrategy || 'newer'

    const merged = {
      meta: { ...existing.meta },
      facts: [...existing.facts],
      episodes: [...existing.episodes],
      social: { ...existing.social },
      summary: { ...existing.summary }
    }

    // 整合 facts
    if (extracted.facts && Array.isArray(extracted.facts)) {
      for (const newFact of extracted.facts) {
        if (newFact.confidence < confidenceThreshold) continue

        const similarIdx = merged.facts.findIndex(f => 
          f.category === newFact.category &&
          (calculateSimilarity(f.key, newFact.key) > threshold ||
           calculateSimilarity(f.value, newFact.value) > threshold)
        )

        if (similarIdx >= 0) {
          const existingFact = merged.facts[similarIdx]
          let shouldReplace = false

          if (mergeStrategy === 'newer') {
            shouldReplace = true
          } else if (mergeStrategy === 'higher') {
            shouldReplace = newFact.confidence > existingFact.confidence
          }

          if (shouldReplace) {
            merged.facts[similarIdx] = {
              ...newFact,
              timestamp: existingFact.timestamp,
              lastConfirmed: Date.now(),
              count: (existingFact.count || 1) + 1
            }
          } else {
            merged.facts[similarIdx].count = (existingFact.count || 1) + 1
            merged.facts[similarIdx].lastConfirmed = Date.now()
          }
        } else {
          merged.facts.push({
            ...newFact,
            timestamp: Date.now(),
            lastConfirmed: Date.now(),
            count: 1
          })
        }
      }
    }

    // 清理和限制 facts
    merged.facts = this.cleanupFacts(merged.facts, maxPerCategory, retentionDays)

    // 整合 episodes
    if (extracted.episodes && Array.isArray(extracted.episodes)) {
      for (const newEpisode of extracted.episodes) {
        const isDuplicate = merged.episodes.some(e => 
          e.date === newEpisode.date &&
          calculateSimilarity(e.event, newEpisode.event) > 0.8
        )
        
        if (!isDuplicate && newEpisode.importance > 0.5) {
          merged.episodes.push({
            ...newEpisode,
            recordedAt: Date.now()
          })
        }
      }
      merged.episodes = merged.episodes
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 20)
    }

    // 整合 social
    if (extracted.social) {
      merged.social = {
        closeFriends: extracted.social.closeFriends || merged.social.closeFriends,
        activeTopics: extracted.social.activeTopics || merged.social.activeTopics,
        roleInGroup: extracted.social.roleInGroup || merged.social.roleInGroup
      }
    }

    // 更新 summary
    if (extracted.summary) {
      merged.summary = {
        short: extracted.summary.short || merged.summary.short,
        detailed: extracted.summary.detailed || merged.summary.detailed
      }
    }

    return merged
  }

  cleanupFacts(facts, maxPerCategory, retentionDays) {
    const now = Date.now()
    const maxAge = retentionDays * 24 * 60 * 60 * 1000

    const byCategory = {}
    facts.forEach(f => {
      if (!byCategory[f.category]) byCategory[f.category] = []
      byCategory[f.category].push(f)
    })

    const cleaned = []
    for (const [category, catFacts] of Object.entries(byCategory)) {
      let validFacts = retentionDays > 0 
        ? catFacts.filter(f => (now - f.timestamp) < maxAge)
        : catFacts

      validFacts.sort((a, b) => {
        const scoreA = (a.confidence || 0) * (a.count || 1)
        const scoreB = (b.confidence || 0) * (b.count || 1)
        return scoreB - scoreA
      })

      cleaned.push(...validFacts.slice(0, maxPerCategory))
    }

    return cleaned
  }

  // ==================== 6. 用户指令处理 ====================

  async extractMemory(e) {
    if (!e.isGroup) {
      return e.reply('请在群聊中使用此功能。')
    }

    const config = Config.getConfig()
    const memConf = config.smartMode?.memory || {}

    if (!memConf.enable) {
      return e.reply('记忆功能未启用。')
    }

    const groupId = String(e.group_id)
    const userId = String(e.user_id)

    const messages = await this.getBufferMessages(groupId, userId)
    if (messages.length < 3) {
      return e.reply('你最近的发言太少，无法提取有效记忆。请多聊几句再试~')
    }

    await e.reply(`正在分析你最近的 ${messages.length} 条发言，请稍候...`)

    try {
      const memory = await this.processMemoryExtraction(groupId, userId, messages, false)
      
      const factsCount = memory.facts?.length || 0
      const episodesCount = memory.episodes?.length || 0
      
      return e.reply(`✅ 记忆提取完成！\n` +
        `📊 共记录 ${factsCount} 条事实，${episodesCount} 个事件\n` +
        `📝 画像摘要：${memory.summary?.short || '暂无'}\n` +
        `\n使用 #记忆详情 查看完整档案`)
    } catch (error) {
      logger.error(`[记忆收集] 手动提取失败: ${error}`)
      return e.reply(`提取失败：${error.message}`)
    }
  }

  async syncHistoryMemory(e) {
    const config = Config.getConfig()
    const memConf = config.smartMode?.memory || {}

    let targetUserId = String(e.user_id)
    let targetGroupId = e.isGroup ? String(e.group_id) : ""
    let syncDays = memConf.syncDays || 3

    // 解析跨群调试格式
    const crossMatch = e.msg.match(/(\d{5,11}):(\d{5,11})\s*(\d+)?(天)?/)
    if (crossMatch) {
      if (!e.isMaster) return e.reply("仅主人可以使用 [QQ号:群号] 的跨群调试功能！")
      targetUserId = crossMatch[1]
      targetGroupId = crossMatch[2]
      if (crossMatch[3]) syncDays = parseInt(crossMatch[3])
    } else {
      if (!e.isGroup) return e.reply("请在群聊中使用此功能，或使用主人格式：#同步历史记忆 QQ号:群号")

      if (e.at) {
        if (!e.isMaster) return e.reply("仅主人可以 @ 他人同步历史记忆！")
        targetUserId = String(e.at)
      }

      const dayMatch = e.msg.match(/(\d+)天?$/)
      if (dayMatch) syncDays = parseInt(dayMatch[1])
    }

    if (!targetGroupId) return e.reply("无法获取目标群号！")

    const syncModelRemark = memConf.syncModel
    if (!syncModelRemark) return e.reply("请先在锅巴配置中指定【历史同步模型(大)】！")

    const apiConfig = config.smart_APIList?.find(api => api.remark === syncModelRemark)
    if (!apiConfig) return e.reply(`未找到名为 [${syncModelRemark}] 的大模型接口配置。`)

    // 获取目标名称
    let targetName = targetUserId
    const groupInfo = Bot.gl.get(Number(targetGroupId))
    let groupName = groupInfo ? groupInfo.group_name : targetGroupId
    if (groupInfo) {
      const member = Bot.gml.get(Number(targetGroupId))?.get(Number(targetUserId))
      if (member) targetName = member.card || member.nickname || targetUserId
    }
    if (targetUserId === String(e.user_id)) targetName = "你"

    await e.reply(`⏳ 正在呼叫超大杯模型 [${apiConfig.modelId}]，穿梭至 [${groupName}] 拉取 ${targetName} 过去 ${syncDays} 天的记录...`)

    try {
      // 从 group-insight 插件获取历史消息
      const insightPath = '../../group-insight/components/index.js'
      const insightComponents = await import(insightPath)
      const messageCollector = await insightComponents.getMessageCollector()
      
      const messages = await messageCollector.getRecentUserMessages(
        Number(targetGroupId), targetUserId, 5000, null, syncDays
      )

      if (!messages || messages.length === 0) {
        return e.reply(`翻遍了 [${groupName}] 的 insight 数据库，没有找到 ${targetName} 最近 ${syncDays} 天的任何发言记录。`)
      }

      // 清理消息
      let validMessages = []
      for (let i = messages.length - 1; i >= 0; i--) {
        let msgObj = messages[i]
        let content = ""
        if (msgObj.message && Array.isArray(msgObj.message)) {
          for (let m of msgObj.message) {
            if (m.type === 'text') content += m.text
            else if (m.type === 'image') content += "[发送图片] "
          }
        } else if (typeof msgObj.message === 'string') content = msgObj.message
        else if (msgObj.raw_message) content = msgObj.raw_message
        
        content = content.trim()
        if (content && !content.startsWith('#')) validMessages.push({
          content,
          timestamp: msgObj.time * 1000 || Date.now(),
          sender: { nickname: msgObj.sender?.nickname || '未知' }
        })
      }

      if (validMessages.length === 0) {
        return e.reply(`拉取到了记录，但全是指令或空白信息，无法提炼。`)
      }

      // 执行深度提炼
      const memory = await this.processMemoryExtraction(targetGroupId, targetUserId, validMessages, true)

      return e.reply(`🎯 深度测写完成！\n` +
        `基于 ${syncDays} 天内的 ${validMessages.length} 条记录，[${apiConfig.modelId}] 生成了结构化档案。\n` +
        `\n📊 共记录 ${memory.facts?.length || 0} 条事实，${memory.episodes?.length || 0} 个事件\n` +
        `📝 画像摘要：${memory.summary?.short || '暂无'}`)

    } catch (error) {
      logger.error(`[记忆收集] 历史同步失败: ${error}`)
      return e.reply(`同步异常：${error.message}`)
    }
  }

  async viewMemory(e) {
    if (!e.isGroup) {
      return e.reply('请在群聊中使用此功能。')
    }

    const groupId = String(e.group_id)
    const userId = String(e.user_id)

    const memory = await this.getStructuredMemory(groupId, userId)

    if (!memory.facts || memory.facts.length === 0) {
      return e.reply('📭 暂无你的记忆档案\n\n多发几条消息，或者发送 #提取记忆 来生成档案~')
    }

    const lines = ['🗂️ 【你的专属档案】\n━━━━━━━━━━━━━━']

    if (memory.summary?.short) {
      lines.push(`📌 摘要：${memory.summary.short}`)
    }

    const categories = {
      basic: '📋 基本信息',
      interest: '🎮 兴趣爱好',
      personality: '🎭 性格特点',
      habit: '📅 习惯偏好',
      relationship: '👥 人际关系',
      skill: '💡 技能特长'
    }

    for (const [cat, label] of Object.entries(categories)) {
      const catFacts = memory.facts.filter(f => f.category === cat)
      if (catFacts.length > 0) {
        lines.push(`\n${label}：`)
        catFacts.slice(0, 5).forEach(f => {
          lines.push(`  • ${f.key}：${f.value}`)
        })
      }
    }

    if (memory.episodes && memory.episodes.length > 0) {
      lines.push(`\n📅 近期动态：`)
      memory.episodes.slice(0, 3).forEach(ep => {
        lines.push(`  • ${ep.date}：${ep.event}`)
      })
    }

    lines.push(`\n━━━━━━━━━━━━━━`)
    lines.push(`使用 #记忆详情 查看完整信息`)

    return e.reply(lines.join('\n'))
  }

  async viewMemoryDetail(e) {
    if (!e.isGroup) {
      return e.reply('请在群聊中使用此功能。')
    }

    const groupId = String(e.group_id)
    const userId = String(e.user_id)

    const memory = await this.getStructuredMemory(groupId, userId)

    if (!memory.facts || memory.facts.length === 0) {
      return e.reply('暂无记忆档案')
    }

    const lines = [
      '🗂️ 【详细记忆档案】',
      `用户：${memory.meta.nickname || userId}`,
      `首次记录：${new Date(memory.meta.firstSeen).toLocaleString()}`,
      `最后更新：${new Date(memory.meta.lastUpdated).toLocaleString()}`,
      '',
      '📊 统计：',
      `  事实记录：${memory.facts.length} 条`,
      `  事件记录：${memory.episodes?.length || 0} 个`,
      '',
      '📋 所有事实：'
    ]

    memory.facts.forEach((f, idx) => {
      lines.push(`${idx + 1}. [${f.category}] ${f.key}=${f.value} (置信:${f.confidence}, 确认:${f.count}次)`)
    })

    if (memory.summary?.detailed) {
      lines.push('', '📝 详细画像：', memory.summary.detailed)
    }

    const common = await import('../../../lib/common/common.js').catch(() => null)
    if (common?.makeForwardMsg) {
      const forwardMsg = await common.makeForwardMsg(e, lines, '详细记忆档案')
      return e.reply(forwardMsg)
    }

    return e.reply(lines.join('\n'))
  }

  async setMemory(e) {
    if (!e.isGroup) return false

    const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim()
    if (!content) {
      return e.reply('请提供要设定的记忆内容！\n格式：#修改记忆 类别|属性名|属性值\n示例：#修改记忆 interest|喜欢的游戏|原神')
    }

    const groupId = String(e.group_id)
    const userId = String(e.user_id)

    const parts = content.split(/[|，,]/)
    if (parts.length < 2) {
      return e.reply('格式错误！请使用：类别|属性名|属性值\n类别可选：basic, interest, personality, habit, relationship, skill')
    }

    const [category, key, value] = parts.map(p => p.trim())
    
    if (!Object.values(FACT_CATEGORIES).includes(category)) {
      return e.reply(`无效的类别！可选：${Object.values(FACT_CATEGORIES).join(', ')}`)
    }

    const memory = await this.getStructuredMemory(groupId, userId)

    const existingIdx = memory.facts.findIndex(f => 
      f.category === category && f.key === key
    )

    const newFact = {
      category,
      key,
      value: value || key,
      confidence: 1.0,
      timestamp: Date.now(),
      lastConfirmed: Date.now(),
      count: 1,
      manual: true
    }

    if (existingIdx >= 0) {
      memory.facts[existingIdx] = newFact
    } else {
      memory.facts.push(newFact)
    }

    if (!memory.summary) memory.summary = {}
    memory.summary.short = `用户手动设置了${key}为${value || key}`

    await this.saveStructuredMemory(groupId, userId, memory)

    return e.reply(`✅ 记忆已更新！\n[${category}] ${key} = ${value || key}`)
  }

  async clearMemory(e) {
    if (!e.isGroup) return false

    const groupId = String(e.group_id)
    const userId = String(e.user_id)

    await redis.del(REDIS_KEYS.STRUCTURED(groupId, userId))
    await redis.del(REDIS_KEYS.BUFFER(groupId, userId))
    await redis.del(REDIS_KEYS.LAST_EXTRACT(groupId, userId))

    return e.reply('💥 你的所有记忆档案和聊天缓存已被彻底清空！')
  }

  // ==================== 7. 对外接口 ====================

  async getMemoryForPrompt(groupId, userId, options = {}) {
    const memory = await this.getStructuredMemory(groupId, userId)
    
    if (!memory.facts || memory.facts.length === 0) {
      return ''
    }

    const parts = []
    const maxFacts = options.maxFacts || 10

    const sortedFacts = [...memory.facts]
      .sort((a, b) => (b.confidence * b.count) - (a.confidence * a.count))
      .slice(0, maxFacts)

    const byCategory = {}
    sortedFacts.forEach(f => {
      if (!byCategory[f.category]) byCategory[f.category] = []
      byCategory[f.category].push(f)
    })

    const categoryNames = {
      basic: '基本信息',
      interest: '兴趣爱好',
      personality: '性格特点',
      habit: '习惯偏好',
      relationship: '人际关系',
      skill: '技能特长'
    }

    for (const [cat, facts] of Object.entries(byCategory)) {
      const catName = categoryNames[cat] || cat
      const factStrs = facts.map(f => `${f.key}是${f.value}`)
      parts.push(`${catName}：${factStrs.join('，')}`)
    }

    if (memory.episodes && memory.episodes.length > 0) {
      const recent = memory.episodes.slice(0, 2)
      parts.push(`最近动态：${recent.map(e => e.event).join('；')}`)
    }

    return parts.join('\n')
  }

  async getRawMemory(groupId, userId) {
    return await this.getStructuredMemory(groupId, userId)
  }
}

// 导出工具函数
export {
  REDIS_KEYS,
  FACT_CATEGORIES,
  PROMPT_PRESETS,
  calculateSimilarity,
  getTodayString
}
