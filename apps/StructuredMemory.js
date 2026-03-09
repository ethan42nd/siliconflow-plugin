import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import fetch from 'node-fetch'

/**
 * 结构化记忆系统 v2
 * 
 * 功能：
 * 1. 实时收集群聊消息到缓冲区
 * 2. 自动/手动触发记忆提炼
 * 3. 结构化存储（facts/episodes/social）
 * 4. 记忆整合（去重、冲突解决、遗忘）
 * 5. 为 AI 对话提供记忆检索
 */

// ==================== 提示词预设 ====================

const PROMPT_PRESETS = {
  standard: {
    name: '标准模式（推荐）',
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

category 可选值：
- basic: 基本信息（年龄、职业、学历、所在地等）
- interest: 兴趣爱好（游戏、动漫、运动、美食等）
- personality: 性格特点（内向/外向、幽默/严肃等）
- habit: 习惯偏好（作息、常用语、表情习惯等）
- relationship: 人际关系（朋友、家庭、宠物等）
- skill: 技能特长（编程、绘画、音乐等）

注意：
1. 只输出JSON，不要任何解释或markdown代码块标记
2. confidence 范围 0-1，表示你对这个信息的确定程度
3. 如果信息与历史档案冲突，以新信息为准，但保留高置信度的旧信息
4. 不要编造信息，只从提供的消息中提取`,
    syncPrompt: `你是一个顶级的心理侧写师。请根据用户的历史聊天记录，生成深度结构化档案。

请严格按照以下JSON格式输出（不要包含任何其他内容）：
{
  "facts": [
    {
      "category": "basic|interest|personality|habit|relationship|skill",
      "key": "属性名",
      "value": "属性值",
      "confidence": 0.9
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "重要事件描述",
      "importance": 0.8,
      "emotionalTone": "情绪"
    }
  ],
  "social": {
    "closeFriends": ["好友昵称1", "好友昵称2"],
    "activeTopics": ["常聊话题1", "常聊话题2"],
    "roleInGroup": "群内角色（如：活跃分子/潜水员/开心果）"
  },
  "summary": {
    "short": "一句话画像（50字内）",
    "detailed": "详细画像（300字内）"
  }
}

注意：
1. 只输出JSON，不要任何解释
2. 结合历史档案进行分析，不要遗漏重要信息
3. 确保JSON格式合法`
  },
  concise: {
    name: '简洁模式',
    structuredPrompt: `分析用户聊天，提取关键信息，输出JSON：
{
  "facts": [
    {"category": "basic|interest|personality", "key": "属性", "value": "值", "confidence": 0.8}
  ],
  "episodes": [],
  "summary": {"short": "一句话总结", "detailed": ""}
}

类别：basic(基本信息), interest(兴趣), personality(性格)
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
    {
      "category": "basic|interest|personality|habit|relationship|skill",
      "key": "具体属性名",
      "value": "详细属性值",
      "confidence": 0.85
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "详细事件描述，包含上下文",
      "importance": 0.8,
      "emotionalTone": "具体情绪描述"
    }
  ],
  "summary": {
    "short": "精炼的一句话画像",
    "detailed": "详细的用户画像描述，包含性格特点、兴趣爱好、行为模式等多维度分析"
  }
}

要求：
1. 仔细分析每条消息，提取隐含信息
2. 关注用户的语言风格、常用词汇、表达习惯
3. 记录具体细节而非笼统描述
4. 对不确定的信息给予较低置信度
5. 必须确保输出合法JSON`,
    syncPrompt: `你是资深用户研究专家。基于大量历史数据，生成深度用户画像档案。

输出JSON格式：
{
  "facts": [
    {"category": "basic|interest|personality|habit|relationship|skill", "key": "", "value": "", "confidence": 0.9}
  ],
  "episodes": [
    {"date": "YYYY-MM-DD", "event": "", "importance": 0.8, "emotionalTone": ""}
  ],
  "social": {
    "closeFriends": [],
    "activeTopics": [],
    "roleInGroup": ""
  },
  "summary": {
    "short": "",
    "detailed": ""
  }
}

分析要求：
1. 结合历史档案，进行深度综合分析
2. 识别用户的行为模式、价值观、社交特点
3. 记录重要的互动事件和情感变化
4. 推断用户的潜在需求和偏好
5. 输出完整、详细的结构化档案`
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
  "episodes": [
    {"date": "", "event": "剧情事件", "importance": 0.8, "emotionalTone": ""}
  ],
  "summary": {
    "short": "角色一句话简介",
    "detailed": "角色详细设定"
  }
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

重点：
1. 梳理角色的完整设定和背景故事
2. 记录重要的剧情发展和人物关系变化
3. 分析角色的成长轨迹和行为模式
4. 区分不同时间线的剧情`
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
  "episodes": [
    {"date": "", "event": "上分/掉分、精彩操作等", "importance": 0.7, "emotionalTone": ""}
  ],
  "summary": {
    "short": "玩家简介",
    "detailed": "游戏风格和特点"
  }
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

关注：
1. 游戏技术成长和段位变化
2. 常用英雄/角色的演变
3. 游戏态度和团队协作风格
4. 突出的游戏事件和成就`
  }
};

// ==================== 常量定义 ====================

const REDIS_KEYS = {
    // 消息缓冲区: sf_plugin:memory_buffer:{group_id}:{user_id}
    BUFFER: (groupId, userId) => `sf_plugin:memory_buffer:${groupId}:${userId}`,
    // 结构化记忆: sf_plugin:memory_structured:{group_id}:{user_id}
    STRUCTURED: (groupId, userId) => `sf_plugin:memory_structured:${groupId}:${userId}`,
    // 上次提炼时间: sf_plugin:memory_last_extract:{group_id}:{user_id}
    LAST_EXTRACT: (groupId, userId) => `sf_plugin:memory_last_extract:${groupId}:${userId}`,
    // 提炼锁（防止并发）: sf_plugin:memory_lock:{group_id}:{user_id}
    LOCK: (groupId, userId) => `sf_plugin:memory_lock:${groupId}:${userId}`
}

// 事实类别定义
const FACT_CATEGORIES = {
    BASIC: 'basic',           // 基本信息
    INTEREST: 'interest',     // 兴趣爱好
    PERSONALITY: 'personality', // 性格特点
    HABIT: 'habit',           // 习惯偏好
    RELATIONSHIP: 'relationship', // 人际关系
    SKILL: 'skill'            // 技能特长
}

// 默认空记忆结构
const DEFAULT_MEMORY_STRUCTURE = {
    meta: {
        userId: '',
        groupId: '',
        nickname: '',
        card: '',
        firstSeen: 0,
        lastUpdated: 0,
        version: 2
    },
    facts: [],        // 事实记忆数组
    episodes: [],     // 事件记忆数组
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

/**
 * 异步延迟
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 截断长字符串用于日志
 */
const logTruncate = (str, maxLen = 100) => {
    if (!str || str.length <= maxLen) return str
    return str.substring(0, maxLen) + `...[${str.length - maxLen} chars omitted]`
}

/**
 * 计算字符串相似度（简单的Jaccard相似度）
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} 0-1 的相似度
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0
    if (str1 === str2) return 1
    
    const set1 = new Set(str1.toLowerCase().split(''))
    const set2 = new Set(str2.toLowerCase().split(''))
    
    const intersection = new Set([...set1].filter(x => set2.has(x)))
    const union = new Set([...set1, ...set2])
    
    return intersection.size / union.size
}

/**
 * 获取当前日期字符串 YYYY-MM-DD
 */
function getTodayString() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 安全的 JSON 解析
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str)
    } catch (e) {
        return defaultValue
    }
}

/**
 * 获取提示词（支持预设和自定义）
 * @param {Object} memConf 记忆配置
 * @param {boolean} isDeepSync 是否为深度同步
 * @returns {string} 提示词
 */
function getPrompt(memConf, isDeepSync = false) {
    const presetKey = memConf.promptPreset || 'standard'
    const preset = PROMPT_PRESETS[presetKey]
    
    // 如果用户配置了自定义提示词，优先使用自定义的
    // 否则使用预设的提示词
    if (isDeepSync) {
        return memConf.syncPrompt || (preset ? preset.syncPrompt : PROMPT_PRESETS.standard.syncPrompt)
    } else {
        return memConf.structuredPrompt || (preset ? preset.structuredPrompt : PROMPT_PRESETS.standard.structuredPrompt)
    }
}

// ==================== 主类定义 ====================

export class StructuredMemory extends plugin {
    constructor() {
        super({
            name: '结构化记忆系统',
            dsc: '收集群聊信息并提炼结构化用户画像',
            event: 'message',
            priority: 50000,
            rule: [
                { reg: '^#(提取|整理)记忆$', fnc: 'extractMemory' },
                { reg: '^#同步(我的)?历史记忆.*$', fnc: 'syncHistoryMemory' },
                { reg: '^#我的(记忆|档案)$', fnc: 'viewMemory' },
                { reg: '^#(修改|设定)记忆\s*(.*)$', fnc: 'setMemory' },
                { reg: '^#(清空|删除)记忆$', fnc: 'clearMemory' },
                { reg: '^#记忆详情$', fnc: 'viewMemoryDetail' },
                { reg: '', fnc: 'collectMessage', log: false }
            ]
        })
    }

    // ==================== 1. 消息收集 ====================

    /**
     * 被动收集群聊消息到缓冲区
     */
    async collectMessage(e) {
        // 仅在群聊中收集
        if (!e.isGroup) return false

        const config = Config.getConfig()
        const memConf = config.smartMode?.memory || {}

        // 检查功能开关
        if (!memConf.enable) return false

        const userId = String(e.user_id)
        const groupId = String(e.group_id)

        // 群聊白名单检查
        const groupList = memConf.groupList || []
        if (groupList.length > 0 && !groupList.includes(groupId)) return false

        // 过滤机器人消息
        if (e.target_id === e.self_id) return false

        // 过滤指令（以 # 开头）
        if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false

        // 用户黑名单检查
        const blackList = memConf.blackList || []
        if (blackList.includes(userId)) return false

        // 提取消息内容
        let contentToSave = this.extractMessageContent(e)
        if (!contentToSave.trim()) return false

        // 保存到缓冲区
        await this.addToBuffer(groupId, userId, {
            content: contentToSave,
            timestamp: Date.now(),
            msgId: e.message_id || Date.now().toString(),
            sender: {
                nickname: e.sender?.nickname || '',
                card: e.sender?.card || ''
            }
        })

        // 检查是否触发自动提炼
        if (memConf.structuredMode && memConf.autoExtract?.enable) {
            this.checkAutoExtract(groupId, userId, memConf).catch(err => {
                logger.error(`[结构化记忆] 自动提炼检查失败: ${err}`)
            })
        }

        return false
    }

    /**
     * 从消息对象中提取内容
     */
    extractMessageContent(e) {
        let content = ''
        
        if (e.message && Array.isArray(e.message)) {
            for (let msg of e.message) {
                if (msg.type === 'text') {
                    content += msg.text
                } else if (msg.type === 'image') {
                    content += '[发送图片] '
                } else if (msg.type === 'face') {
                    content += '[QQ表情] '
                } else if (msg.type === 'at') {
                    content += `[@${msg.qq}] `
                } else if (msg.type === 'reply') {
                    content += '[回复消息] '
                }
            }
        } else if (e.msg) {
            content = e.msg
        }

        return content.trim()
    }

    /**
     * 添加消息到缓冲区
     */
    async addToBuffer(groupId, userId, messageData) {
        const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
        const config = Config.getConfig()
        const memConf = config.smartMode?.memory || {}
        const maxSize = memConf.autoExtract?.maxBufferSize || 30

        try {
            // 使用 LPUSH 添加到列表头部（新的在前）
            await redis.lPush(bufferKey, JSON.stringify(messageData))
            // 只保留最近的 N 条
            await redis.lTrim(bufferKey, 0, maxSize - 1)
            // 设置过期时间（默认7天）
            const expireDays = memConf.autoExtract?.bufferExpireDays || 7
            await redis.expire(bufferKey, 60 * 60 * 24 * expireDays)

            if (memConf.logEnable) {
                logger.mark(`[记忆收集] ${groupId} - ${messageData.sender?.nickname || userId}: ${logTruncate(messageData.content, 50)}`)
            }
        } catch (error) {
            logger.error(`[结构化记忆] 缓冲区写入失败: ${error}`)
        }
    }

    /**
     * 获取缓冲区消息
     */
    async getBufferMessages(groupId, userId) {
        const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
        try {
            const messages = await redis.lRange(bufferKey, 0, -1)
            return messages.map(msg => safeJsonParse(msg)).filter(Boolean)
        } catch (error) {
            logger.error(`[结构化记忆] 读取缓冲区失败: ${error}`)
            return []
        }
    }

    // ==================== 2. 自动提炼逻辑 ====================

    /**
     * 检查是否需要自动提炼
     */
    async checkAutoExtract(groupId, userId, memConf) {
        const threshold = memConf.autoExtract?.threshold || 10
        const minInterval = memConf.autoExtract?.minInterval || 3600

        // 获取当前缓冲区大小
        const bufferKey = REDIS_KEYS.BUFFER(groupId, userId)
        const bufferSize = await redis.lLen(bufferKey)

        if (bufferSize < threshold) return

        // 检查上次提炼时间
        const lastExtractKey = REDIS_KEYS.LAST_EXTRACT(groupId, userId)
        const lastExtract = await redis.get(lastExtractKey)
        
        if (lastExtract) {
            const elapsed = (Date.now() - parseInt(lastExtract)) / 1000
            if (elapsed < minInterval) return
        }

        // 检查是否已有提炼在进行中（简单锁机制）
        const lockKey = REDIS_KEYS.LOCK(groupId, userId)
        const locked = await redis.get(lockKey)
        if (locked) return

        // 执行自动提炼（异步，不等待）
        this.performAutoExtract(groupId, userId, memConf).catch(err => {
            logger.error(`[结构化记忆] 自动提炼执行失败: ${err}`)
        })
    }

    /**
     * 执行自动提炼
     */
    async performAutoExtract(groupId, userId, memConf) {
        const lockKey = REDIS_KEYS.LOCK(groupId, userId)
        
        try {
            // 设置锁（60秒过期，防止死锁）
            await redis.set(lockKey, '1', { EX: 60 })

            // 获取缓冲区消息
            const messages = await this.getBufferMessages(groupId, userId)
            if (messages.length < (memConf.autoExtract?.threshold || 5)) {
                await redis.del(lockKey)
                return
            }

            logger.info(`[结构化记忆] 触发自动提炼: ${groupId} - ${userId}, 消息数: ${messages.length}`)

            // 执行提炼
            await this.processMemoryExtraction(groupId, userId, messages, false)

            // 更新上次提炼时间
            await redis.set(REDIS_KEYS.LAST_EXTRACT(groupId, userId), Date.now().toString())

        } catch (error) {
            logger.error(`[结构化记忆] 自动提炼失败: ${error}`)
        } finally {
            await redis.del(lockKey)
        }
    }

    // ==================== 3. 记忆提炼核心 ====================

    /**
     * 处理记忆提炼
     * @param {string} groupId 
     * @param {string} userId 
     * @param {Array} messages 消息数组
     * @param {boolean} isDeepSync 是否为深度同步（使用大模型）
     */
    async processMemoryExtraction(groupId, userId, messages, isDeepSync = false) {
        const config = Config.getConfig()
        const memConf = config.smartMode?.memory || {}

        // 获取现有记忆
        const existingMemory = await this.getStructuredMemory(groupId, userId)

        // 准备提示词（支持预设和自定义）
        const systemPrompt = getPrompt(memConf, isDeepSync)

        // 准备用户提示词
        const userPrompt = this.buildExtractionPrompt(existingMemory, messages, isDeepSync)

        // 获取 API 配置
        const modelRemark = isDeepSync ? memConf.syncModel : memConf.selectedModel
        if (!modelRemark) {
            throw new Error(`未配置${isDeepSync ? '历史同步' : '记忆提炼'}模型`)
        }

        const apiConfig = config.smart_APIList?.find(api => api.remark === modelRemark)
        if (!apiConfig) {
            throw new Error(`未找到名为 [${modelRemark}] 的接口配置`)
        }

        // 调用 LLM
        const extractedData = await this.callLLM(apiConfig, systemPrompt, userPrompt, isDeepSync)

        if (!extractedData) {
            throw new Error('LLM 返回数据解析失败')
        }

        // 整合记忆
        const mergedMemory = this.consolidateMemory(existingMemory, extractedData, memConf.consolidation)

        // 更新元数据
        mergedMemory.meta.lastUpdated = Date.now()
        if (!mergedMemory.meta.firstSeen) {
            mergedMemory.meta.firstSeen = Date.now()
        }

        // 保存记忆
        await this.saveStructuredMemory(groupId, userId, mergedMemory)

        // 清空缓冲区
        await redis.del(REDIS_KEYS.BUFFER(groupId, userId))

        return mergedMemory
    }

    /**
     * 构建提炼提示词
     */
    buildExtractionPrompt(existingMemory, messages, isDeepSync) {
        const groupInfo = Bot.gl?.get(Number(existingMemory.meta.groupId))
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

    /**
     * 调用 LLM API
     */
    async callLLM(apiConfig, systemPrompt, userPrompt, isDeepSync) {
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
            if (config.smartMode?.memory?.debugLog) {
                logger.mark(`[结构化记忆] API请求:\n${JSON.stringify(requestBody, null, 2)}`)
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

            if (config.smartMode?.memory?.debugLog) {
                logger.mark(`[结构化记忆] API响应:\n${logTruncate(JSON.stringify(data), 500)}`)
            }

            if (data.choices?.[0]?.message?.content) {
                const content = data.choices[0].message.content
                // 尝试解析 JSON
                return this.parseLLMResponse(content)
            }

            return null
        } catch (error) {
            logger.error(`[结构化记忆] LLM 调用失败: ${error}`)
            return null
        }
    }

    /**
     * 解析 LLM 返回的内容
     */
    parseLLMResponse(content) {
        // 尝试直接解析
        let data = safeJsonParse(content)
        if (data) return data

        // 尝试提取 JSON 代码块
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                          content.match(/```\s*([\s\S]*?)```/) ||
                          content.match(/\{[\s\S]*\}/)
        
        if (jsonMatch) {
            data = safeJsonParse(jsonMatch[1] || jsonMatch[0])
            if (data) return data
        }

        logger.warn(`[结构化记忆] 无法解析 LLM 返回: ${logTruncate(content, 200)}`)
        return null
    }

    // ==================== 4. 记忆存储与读取 ====================

    /**
     * 获取结构化记忆
     */
    async getStructuredMemory(groupId, userId) {
        const key = REDIS_KEYS.STRUCTURED(groupId, userId)
        try {
            const data = await redis.get(key)
            if (data) {
                const parsed = safeJsonParse(data)
                if (parsed) return parsed
            }
        } catch (error) {
            logger.error(`[结构化记忆] 读取记忆失败: ${error}`)
        }

        // 返回默认结构
        return {
            ...DEFAULT_MEMORY_STRUCTURE,
            meta: { ...DEFAULT_MEMORY_STRUCTURE.meta, userId, groupId }
        }
    }

    /**
     * 保存结构化记忆
     */
    async saveStructuredMemory(groupId, userId, memory) {
        const key = REDIS_KEYS.STRUCTURED(groupId, userId)
        try {
            await redis.set(key, JSON.stringify(memory))
            return true
        } catch (error) {
            logger.error(`[结构化记忆] 保存记忆失败: ${error}`)
            return false
        }
    }

    // ==================== 5. 记忆整合（核心算法） ====================

    /**
     * 整合新旧记忆
     */
    consolidateMemory(existing, extracted, config = {}) {
        const threshold = config.similarityThreshold || 0.85
        const maxPerCategory = config.maxFactsPerCategory || 20
        const confidenceThreshold = config.confidenceThreshold || 0.3
        const retentionDays = config.retentionDays || 90
        const mergeStrategy = config.mergeStrategy || 'newer'

        // 创建新的记忆对象
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
                // 过滤低置信度
                if (newFact.confidence < confidenceThreshold) continue

                // 查找相似的事实
                const similarIdx = merged.facts.findIndex(f => 
                    f.category === newFact.category &&
                    (calculateSimilarity(f.key, newFact.key) > threshold ||
                     calculateSimilarity(f.value, newFact.value) > threshold)
                )

                if (similarIdx >= 0) {
                    // 冲突解决
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
                            timestamp: existingFact.timestamp, // 保留首次记录时间
                            lastConfirmed: Date.now(),
                            count: (existingFact.count || 1) + 1
                        }
                    } else {
                        // 增加确认次数
                        merged.facts[similarIdx].count = (existingFact.count || 1) + 1
                        merged.facts[similarIdx].lastConfirmed = Date.now()
                    }
                } else {
                    // 添加新事实
                    merged.facts.push({
                        ...newFact,
                        timestamp: Date.now(),
                        lastConfirmed: Date.now(),
                        count: 1
                    })
                }
            }
        }

        // 按类别限制数量并清理过期事实
        merged.facts = this.cleanupFacts(merged.facts, maxPerCategory, retentionDays)

        // 整合 episodes
        if (extracted.episodes && Array.isArray(extracted.episodes)) {
            for (const newEpisode of extracted.episodes) {
                // 简单的去重：同日期相似事件
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
            // 只保留最近 20 个事件
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

    /**
     * 清理事实：按类别限制数量、删除过期
     */
    cleanupFacts(facts, maxPerCategory, retentionDays) {
        const now = Date.now()
        const maxAge = retentionDays * 24 * 60 * 60 * 1000

        // 按类别分组
        const byCategory = {}
        facts.forEach(f => {
            if (!byCategory[f.category]) byCategory[f.category] = []
            byCategory[f.category].push(f)
        })

        const cleaned = []
        for (const [category, catFacts] of Object.entries(byCategory)) {
            // 过滤过期事实
            let validFacts = retentionDays > 0 
                ? catFacts.filter(f => (now - f.timestamp) < maxAge)
                : catFacts

            // 按置信度和确认次数排序
            validFacts.sort((a, b) => {
                const scoreA = (a.confidence || 0) * (a.count || 1)
                const scoreB = (b.confidence || 0) * (b.count || 1)
                return scoreB - scoreA
            })

            // 限制数量
            cleaned.push(...validFacts.slice(0, maxPerCategory))
        }

        return cleaned
    }

    // ==================== 6. 用户指令处理 ====================

    /**
     * 手动提取记忆 #提取记忆
     */
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

        // 获取缓冲区
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
            logger.error(`[结构化记忆] 手动提取失败: ${error}`)
            return e.reply(`提取失败：${error.message}`)
        }
    }

    /**
     * 深度同步历史记忆 #同步历史记忆
     */
    async syncHistoryMemory(e) {
        // TODO: 实现深度同步（调用 group-insight）
        // 这个和原 MemoryCollector.js 类似，但使用结构化输出
        return e.reply('深度同步功能开发中...')
    }

    /**
     * 查看记忆 #我的记忆
     */
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

        // 格式化输出
        const lines = ['🗂️ 【你的专属档案】\n━━━━━━━━━━━━━━']

        // 摘要
        if (memory.summary?.short) {
            lines.push(`📌 摘要：${memory.summary.short}`)
        }

        // 按类别分组显示 facts
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

        // 近期动态
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

    /**
     * 查看详细记忆 #记忆详情
     */
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
            `  事件记录：memory.episodes?.length || 0} 个`,
            '',
            '📋 所有事实：'
        ]

        memory.facts.forEach((f, idx) => {
            lines.push(`${idx + 1}. [${f.category}] ${f.key}=${f.value} (置信:${f.confidence}, 确认:${f.count}次)`)
        })

        if (memory.summary?.detailed) {
            lines.push('', '📝 详细画像：', memory.summary.detailed)
        }

        // 使用转发消息避免刷屏
        const common = await import('../../../lib/common/common.js').catch(() => null)
        if (common?.makeForwardMsg) {
            const forwardMsg = common.makeForwardMsg(e, lines, '详细记忆档案')
            return e.reply(forwardMsg)
        }

        return e.reply(lines.join('\n'))
    }

    /**
     * 手动设定记忆 #修改记忆
     */
    async setMemory(e) {
        if (!e.isGroup) return false

        const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim()
        if (!content) {
            return e.reply('请提供要设定的记忆内容！\n格式：#修改记忆 类别|属性名|属性值\n示例：#修改记忆 interest|喜欢的游戏|原神')
        }

        const groupId = String(e.group_id)
        const userId = String(e.user_id)

        // 解析输入
        const parts = content.split(/[|，,]/)
        if (parts.length < 2) {
            return e.reply('格式错误！请使用：类别|属性名|属性值\n类别可选：basic, interest, personality, habit, relationship, skill')
        }

        const [category, key, value] = parts.map(p => p.trim())
        
        if (!Object.values(FACT_CATEGORIES).includes(category)) {
            return e.reply(`无效的类别！可选：${Object.values(FACT_CATEGORIES).join(', ')}`)
        }

        // 获取现有记忆
        const memory = await this.getStructuredMemory(groupId, userId)

        // 添加或更新事实
        const existingIdx = memory.facts.findIndex(f => 
            f.category === category && f.key === key
        )

        const newFact = {
            category,
            key,
            value: value || key, // 如果只给了两个参数，值等于key
            confidence: 1.0, // 人工设定的置信度为1
            timestamp: Date.now(),
            lastConfirmed: Date.now(),
            count: 1,
            manual: true // 标记为人工添加
        }

        if (existingIdx >= 0) {
            memory.facts[existingIdx] = newFact
        } else {
            memory.facts.push(newFact)
        }

        // 更新摘要
        if (!memory.summary) memory.summary = {}
        memory.summary.short = `用户手动设置了${key}为${value || key}`

        await this.saveStructuredMemory(groupId, userId, memory)

        return e.reply(`✅ 记忆已更新！\n[${category}] ${key} = ${value || key}`)
    }

    /**
     * 清空记忆 #清空记忆
     */
    async clearMemory(e) {
        if (!e.isGroup) return false

        const groupId = String(e.group_id)
        const userId = String(e.user_id)

        // 删除所有相关数据
        await redis.del(REDIS_KEYS.STRUCTURED(groupId, userId))
        await redis.del(REDIS_KEYS.BUFFER(groupId, userId))
        await redis.del(REDIS_KEYS.LAST_EXTRACT(groupId, userId))

        return e.reply('💥 你的所有记忆档案已被彻底清空！')
    }

    // ==================== 7. 对外接口（供其他模块使用）====================

    /**
     * 获取用户的记忆摘要（供 AI 对话使用）
     * @param {string} groupId 
     * @param {string} userId 
     * @param {Object} options 
     * @returns {string} 格式化的记忆文本
     */
    async getMemoryForPrompt(groupId, userId, options = {}) {
        const memory = await this.getStructuredMemory(groupId, userId)
        
        if (!memory.facts || memory.facts.length === 0) {
            return ''
        }

        const parts = []
        const maxFacts = options.maxFacts || 10

        // 优先选择高置信度的事实
        const sortedFacts = [...memory.facts]
            .sort((a, b) => (b.confidence * b.count) - (a.confidence * a.count))
            .slice(0, maxFacts)

        // 按类别分组
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

        // 添加近期动态
        if (memory.episodes && memory.episodes.length > 0) {
            const recent = memory.episodes.slice(0, 2)
            parts.push(`最近动态：${recent.map(e => e.event).join('；')}`)
        }

        return parts.join('\n')
    }

    /**
     * 获取用户的原始记忆数据（供高级使用）
     */
    async getRawMemory(groupId, userId) {
        return await this.getStructuredMemory(groupId, userId)
    }
}

// 导出工具函数供其他模块使用
export {
    REDIS_KEYS,
    FACT_CATEGORIES,
    calculateSimilarity,
    getTodayString
}
