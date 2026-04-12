import axios from 'axios'
import Config from '../../components/Config.js'
import { AbstractTool } from './AbstractTool.js'
import { WebParserTool } from './WebParserTool.js'

export class SearchTool extends AbstractTool {
  constructor() {
    super({
      name: 'searchTool',
      description: '进行网络搜索获取实时信息，当用户询问需要最新数据、新闻、实时信息时使用此工具。支持 Bing、SearXNG，并支持一次搜索多个相关关键词以获取更全面的信息。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，多个关键词用英文分号";"分隔，如"周杰伦;告白气球歌词"'
          },
          num_results: {
            type: 'integer',
            description: '每个关键词返回的结果数量，默认3条，最多10条',
            default: 3,
            minimum: 1,
            maximum: 10
          }
        },
        required: ['query']
      }
    })

    this.webParserTool = new WebParserTool()
    this.pageContentCache = new Map()
    this.siteProfilesCache = {
      key: null,
      value: null
    }
  }

  getSearchConfig() {
    return Config.getConfig()?.smartMode?.tools?.searchConfig || {}
  }

  createRequestHeaders(extraHeaders = {}) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...extraHeaders
    }
  }

  decodeHtml(text = '') {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .trim()
  }

  stripTags(text = '') {
    return this.decodeHtml(String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
  }

  normalizeBaseUrl(url = '') {
    return String(url).trim().replace(/\/$/, '')
  }

  parseBingLink(link = '') {
    try {
      const cleanLink = this.decodeHtml(String(link || '').trim())
      if (!cleanLink) return cleanLink
      if (cleanLink.startsWith('//')) return `https:${cleanLink}`

      const parsed = new URL(cleanLink)
      if (!/(^|\.)bing\.com$/i.test(parsed.hostname)) {
        return cleanLink
      }

      for (const key of ['url', 'u', 'r', 'redirect']) {
        const rawValue = parsed.searchParams.get(key)
        const directUrl = this.decodeDirectUrl(rawValue || '')
        if (directUrl) return directUrl
      }

      return cleanLink
    } catch {
      return link
    }
  }

  decodeDirectUrl(value = '') {
    const rawValue = this.decodeHtml(String(value || '').trim())
    if (!rawValue) return ''

    const candidates = [rawValue]

    try {
      const decoded = decodeURIComponent(rawValue)
      if (!candidates.includes(decoded)) {
        candidates.push(decoded)
      }
    } catch {
      // ignore invalid URL-encoded values
    }

    for (const candidate of candidates) {
      if (/^https?:\/\//i.test(candidate)) {
        return candidate
      }
    }

    for (const candidate of candidates) {
      const decodedBase64 = this.decodeBase64Url(candidate)
      if (decodedBase64) {
        return decodedBase64
      }
    }

    return ''
  }

  decodeBase64Url(value = '') {
    const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/')
    if (!normalized) return ''

    const candidates = [
      normalized,
      normalized.replace(/^[a-z]\d/i, ''),
      normalized.replace(/^[a-z]\d+/, '')
    ].filter(Boolean)

    for (const candidate of candidates) {
      try {
        const padded = candidate.padEnd(candidate.length + ((4 - candidate.length % 4) % 4), '=')
        const decoded = Buffer.from(padded, 'base64').toString('utf8').trim()
        if (/^https?:\/\//i.test(decoded)) {
          return decoded
        }
      } catch {
        // ignore invalid base64 payloads
      }
    }

    return ''
  }

  getPreferredEngine(searchConfig = {}) {
    const preferredEngine = String(searchConfig.preferredEngine || 'auto').trim().toLowerCase()
    const supportedEngines = ['auto', 'bing', 'searxng']
    return supportedEngines.includes(preferredEngine) ? preferredEngine : 'auto'
  }

  getSearxngEngines(searchConfig = {}) {
    const configuredEngines = String(searchConfig.searxngEngines || '').trim()
    if (!configuredEngines) {
      return 'bing'
    }

    const engines = configuredEngines
      .split(',')
      .map((engine) => engine.trim())
      .filter(Boolean)

    return engines.join(',') || 'bing'
  }

  getEngineOrder(searchConfig = {}, round = 0) {
    const engineOrder = []

    if (searchConfig.searxngUrl) {
      engineOrder.push('searxng')
    }

    engineOrder.push('bing')

    const uniqueEngines = [...new Set(engineOrder)]
    const preferredEngine = this.getPreferredEngine(searchConfig)
    const orderedEngines = preferredEngine !== 'auto' && uniqueEngines.includes(preferredEngine)
      ? [preferredEngine, ...uniqueEngines.filter((engine) => engine !== preferredEngine)]
      : uniqueEngines

    if (orderedEngines.length <= 1 || round <= 0) {
      return orderedEngines
    }

    const [firstEngine, ...fallbackEngines] = orderedEngines
    if (fallbackEngines.length <= 1) {
      return orderedEngines
    }

    const startIndex = round % fallbackEngines.length
    return [firstEngine, ...fallbackEngines.slice(startIndex), ...fallbackEngines.slice(0, startIndex)]
  }

  shouldTemporarilyDisableEngine(error) {
    const message = String(error?.message || '').toLowerCase()
    if (!message) return true

    return [
      'client network socket disconnected',
      'before secure tls connection was established',
      'socket hang up',
      'econnreset',
      'econnrefused',
      'etimedout',
      'timeout',
      'certificate',
      'unable to verify',
      'getaddrinfo',
      'enotfound'
    ].some((keyword) => message.includes(keyword))
  }

  isVerboseSearchLogEnabled(searchConfig = {}) {
    return Boolean(searchConfig?.verboseLog || this.isToolDebugEnabled())
  }

  classifySearchError(error) {
    if (error?.response?.status) {
      return `http_${error.response.status}`
    }

    const code = String(error?.code || '').toLowerCase()
    const message = String(error?.message || '').toLowerCase()
    const combined = `${code} ${message}`

    if (combined.includes('before secure tls connection was established') || combined.includes('certificate') || combined.includes('unable to verify')) {
      return 'tls_handshake'
    }

    if (combined.includes('enotfound') || combined.includes('getaddrinfo')) {
      return 'dns'
    }

    if (combined.includes('econnrefused')) {
      return 'tcp_refused'
    }

    if (combined.includes('econnreset') || combined.includes('socket hang up') || combined.includes('client network socket disconnected')) {
      return 'tcp_reset'
    }

    if (combined.includes('etimedout') || combined.includes('timeout')) {
      return 'timeout'
    }

    return 'network_unknown'
  }

  normalizeHostname(link = '') {
    try {
      const hostname = new URL(link).hostname.toLowerCase()
      return hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  normalizePathname(link = '') {
    try {
      return new URL(link).pathname.toLowerCase() || '/'
    } catch {
      return ''
    }
  }

  normalizeStringArray(values = []) {
    const sourceValues = Array.isArray(values) ? values : [values]
    return [...new Set(sourceValues
      .map((value) => String(value || '').trim())
      .filter(Boolean))]
  }

  parseDelimitedText(value = '') {
    if (Array.isArray(value)) {
      return this.normalizeStringArray(value)
    }

    return this.normalizeStringArray(
      String(value || '')
        .split(/[\n,，;；]+/g)
        .map((item) => item.trim())
    )
  }

  mergeStringArrays(...arrays) {
    return [...new Set(arrays.flatMap((items) => this.normalizeStringArray(items)))]
  }

  normalizeCuratedResults(curatedResults = {}) {
    if (!curatedResults || typeof curatedResults !== 'object' || Array.isArray(curatedResults)) {
      return {}
    }

    const normalized = {}
    for (const [category, items] of Object.entries(curatedResults)) {
      if (!Array.isArray(items)) continue

      const normalizedItems = items
        .map((item) => {
          if (!item || typeof item !== 'object') return null

          const title = String(item.title || '').trim()
          const link = String(item.link || '').trim()
          const snippet = String(item.snippet || '').trim()
          if (!title || !link) return null

          return { title, link, snippet }
        })
        .filter(Boolean)

      if (normalizedItems.length > 0) {
        normalized[String(category || '').trim().toLowerCase()] = normalizedItems
      }
    }

    return normalized
  }

  normalizeSiteProfile(profile = {}, fallbackId = '') {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return null
    }

    const id = String(profile.id || fallbackId || '').trim()
    const keywords = this.normalizeStringArray(profile.keywords || profile.matchKeywords || [])
    const officialDomains = this.normalizeStringArray(profile.officialDomains || profile.domains || [])
    if (!id || keywords.length === 0 || officialDomains.length === 0) {
      return null
    }

    return {
      id,
      keywords,
      topicKeywords: this.normalizeStringArray(profile.topicKeywords || keywords),
      officialDomains,
      curatedResults: this.normalizeCuratedResults(profile.curatedResults || {}),
      lowValuePricingPaths: this.normalizeStringArray(profile.lowValuePricingPaths || []),
      lowValuePricingTitleKeywords: this.normalizeStringArray(profile.lowValuePricingTitleKeywords || [])
    }
  }

  convertStructuredSiteProfile(profile = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return profile
    }

    const buildCuratedEntry = (title, link, snippet) => {
      const normalizedTitle = String(title || '').trim()
      const normalizedLink = String(link || '').trim()
      const normalizedSnippet = String(snippet || '').trim()
      if (!normalizedTitle || !normalizedLink) {
        return []
      }

      return [{
        title: normalizedTitle,
        link: normalizedLink,
        snippet: normalizedSnippet
      }]
    }

    return {
      id: profile.id,
      keywords: this.parseDelimitedText(profile.keywordsText || profile.keywords || profile.matchKeywords || ''),
      topicKeywords: this.parseDelimitedText(profile.topicKeywordsText || profile.topicKeywords || ''),
      officialDomains: this.parseDelimitedText(profile.officialDomainsText || profile.officialDomains || profile.domains || ''),
      curatedResults: {
        pricing: buildCuratedEntry(profile.pricingTitle, profile.pricingLink, profile.pricingSnippet),
        docs: buildCuratedEntry(profile.docsTitle, profile.docsLink, profile.docsSnippet),
        default: buildCuratedEntry(profile.defaultTitle, profile.defaultLink, profile.defaultSnippet)
      },
      lowValuePricingPaths: this.parseDelimitedText(profile.lowValuePricingPathsText || profile.lowValuePricingPaths || ''),
      lowValuePricingTitleKeywords: this.parseDelimitedText(profile.lowValuePricingTitleKeywordsText || profile.lowValuePricingTitleKeywords || '')
    }
  }

  mergeCuratedResults(baseResults = {}, overrideResults = {}) {
    const merged = { ...baseResults }

    for (const [category, items] of Object.entries(overrideResults || {})) {
      merged[category] = [...(merged[category] || [])]
      for (const item of items || []) {
        if (!merged[category].find((existingItem) => existingItem.link === item.link)) {
          merged[category].push(item)
        }
      }
    }

    return merged
  }

  mergeSiteProfile(baseProfile = {}, overrideProfile = {}) {
    return {
      id: overrideProfile.id || baseProfile.id,
      keywords: this.mergeStringArrays(baseProfile.keywords, overrideProfile.keywords),
      topicKeywords: this.mergeStringArrays(baseProfile.topicKeywords, overrideProfile.topicKeywords),
      officialDomains: this.mergeStringArrays(baseProfile.officialDomains, overrideProfile.officialDomains),
      curatedResults: this.mergeCuratedResults(baseProfile.curatedResults, overrideProfile.curatedResults),
      lowValuePricingPaths: this.mergeStringArrays(baseProfile.lowValuePricingPaths, overrideProfile.lowValuePricingPaths),
      lowValuePricingTitleKeywords: this.mergeStringArrays(baseProfile.lowValuePricingTitleKeywords, overrideProfile.lowValuePricingTitleKeywords)
    }
  }

  getBuiltInSiteProfiles() {
    return [
      this.normalizeSiteProfile({
        id: 'openai',
        keywords: ['openai', 'chatgpt', 'gpt', 'codex', 'sora', 'dall-e'],
        topicKeywords: ['openai', 'chatgpt', 'gpt', 'codex', 'sora', 'dall-e'],
        officialDomains: ['openai.com', 'platform.openai.com', 'chatgpt.com', 'help.openai.com'],
        curatedResults: {
          pricing: [
            {
              title: 'ChatGPT Pricing | OpenAI',
              link: 'https://openai.com/pricing/',
              snippet: 'OpenAI 官方 ChatGPT 套餐与计划页面，包含 Free、Plus、Pro、Team、Enterprise 等方案。'
            },
            {
              title: 'OpenAI API Pricing | OpenAI',
              link: 'https://openai.com/api/pricing/',
              snippet: 'OpenAI 官方 API 定价页面，包含模型调用和服务层级的最新价格信息。'
            }
          ],
          docs: [
            {
              title: 'OpenAI Docs',
              link: 'https://platform.openai.com/docs',
              snippet: 'OpenAI 官方开发文档入口。'
            }
          ]
        }
      }, 'openai'),
      this.normalizeSiteProfile({
        id: 'anthropic',
        keywords: ['anthropic', 'claude'],
        topicKeywords: ['anthropic', 'claude'],
        officialDomains: ['anthropic.com', 'platform.claude.com', 'claude.ai'],
        curatedResults: {
          pricing: [
            {
              title: '定价 - Claude API Docs',
              link: 'https://platform.claude.com/docs/zh-CN/about-claude/pricing',
              snippet: 'Claude API 官方定价文档，包含模型价格、数据驻留、批处理和提示缓存等相关信息。'
            }
          ]
        },
        lowValuePricingPaths: ['^/$', '^/login(?:/|$)', 'app-google-auth', '^/public/artifacts(?:/|$)'],
        lowValuePricingTitleKeywords: ['sign in', 'login', 'artifact', 'installation guide', 'guide for windows']
      }, 'anthropic'),
      this.normalizeSiteProfile({
        id: 'google',
        keywords: ['google', 'gemini', 'vertex ai'],
        topicKeywords: ['google', 'gemini', 'vertex ai'],
        officialDomains: ['ai.google.dev', 'cloud.google.com', 'developers.google.com', 'google.com']
      }, 'google'),
      this.normalizeSiteProfile({
        id: 'github',
        keywords: ['github', 'copilot'],
        topicKeywords: ['github', 'copilot'],
        officialDomains: ['github.com', 'docs.github.com']
      }, 'github'),
      this.normalizeSiteProfile({
        id: 'microsoft',
        keywords: ['microsoft', 'azure openai'],
        topicKeywords: ['microsoft', 'azure openai'],
        officialDomains: ['learn.microsoft.com', 'azure.microsoft.com']
      }, 'microsoft'),
      this.normalizeSiteProfile({
        id: 'perplexity',
        keywords: ['perplexity'],
        topicKeywords: ['perplexity'],
        officialDomains: ['perplexity.ai', 'docs.perplexity.ai']
      }, 'perplexity'),
      this.normalizeSiteProfile({
        id: 'xai',
        keywords: ['xai', 'grok'],
        topicKeywords: ['xai', 'grok'],
        officialDomains: ['x.ai', 'docs.x.ai']
      }, 'xai')
    ].filter(Boolean)
  }

  parseCustomSiteProfiles(searchConfig = {}) {
    const structuredProfiles = Array.isArray(searchConfig.siteProfiles)
      ? searchConfig.siteProfiles
          .map((profile, index) => this.normalizeSiteProfile(this.convertStructuredSiteProfile(profile), profile?.id || `custom_${index + 1}`))
          .filter(Boolean)
      : []

    const rawProfiles = searchConfig.siteProfilesJson
    const jsonProfiles = []
    if (!rawProfiles) {
      return structuredProfiles
    }

    try {
      const parsedProfiles = typeof rawProfiles === 'string'
        ? JSON.parse(rawProfiles.trim())
        : rawProfiles

      if (Array.isArray(parsedProfiles)) {
        jsonProfiles.push(...parsedProfiles
          .map((profile, index) => this.normalizeSiteProfile(profile, profile?.id || `custom_json_${index + 1}`))
          .filter(Boolean))
      }

      if (parsedProfiles && typeof parsedProfiles === 'object') {
        jsonProfiles.push(...Object.entries(parsedProfiles)
          .map(([id, profile]) => this.normalizeSiteProfile(profile, id))
          .filter(Boolean))
      }
    } catch (error) {
      logger.warn(`[SearchTool] 解析自定义站点画像配置失败: ${error.message}`)
    }

    return [...structuredProfiles, ...jsonProfiles]
  }

  getSiteProfiles(searchConfig = this.getSearchConfig()) {
    const cacheKey = typeof searchConfig.siteProfilesJson === 'string'
      ? searchConfig.siteProfilesJson.trim()
      : JSON.stringify(searchConfig.siteProfilesJson || '')

    if (this.siteProfilesCache.key === cacheKey && Array.isArray(this.siteProfilesCache.value)) {
      return this.siteProfilesCache.value
    }

    const builtInProfiles = this.getBuiltInSiteProfiles()
    const customProfiles = this.parseCustomSiteProfiles(searchConfig)
    const profileMap = new Map(builtInProfiles.map((profile) => [profile.id, profile]))

    for (const profile of customProfiles) {
      const existingProfile = profileMap.get(profile.id)
      profileMap.set(profile.id, existingProfile ? this.mergeSiteProfile(existingProfile, profile) : profile)
    }

    const profiles = [...profileMap.values()]
    this.siteProfilesCache = {
      key: cacheKey,
      value: profiles
    }

    return profiles
  }

  getMatchedSiteProfiles(query = '', searchConfig = this.getSearchConfig()) {
    const normalizedQuery = String(query || '').toLowerCase()
    if (!normalizedQuery) {
      return []
    }

    return this.getSiteProfiles(searchConfig)
      .filter((profile) => profile.keywords.some((keyword) => normalizedQuery.includes(keyword.toLowerCase())))
  }

  matchesDomain(hostname = '', domain = '') {
    const normalizedHost = String(hostname || '').toLowerCase()
    const normalizedDomain = String(domain || '').toLowerCase().replace(/^www\./, '')
    if (!normalizedHost || !normalizedDomain) return false

    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
  }

  isOfficialInfoQuery(query = '') {
    const normalizedQuery = String(query || '').toLowerCase()
    return [
      '官网',
      '官方',
      '价格',
      '套餐',
      '收费',
      '订阅',
      '账单',
      'pricing',
      'price',
      'plan',
      'plans',
      'subscription',
      'billing',
      'api',
      '文档',
      'docs',
      'documentation',
      '模型',
      'model'
    ].some((keyword) => normalizedQuery.includes(keyword))
  }

  isPricingQuery(query = '') {
    const normalizedQuery = String(query || '').toLowerCase()
    return [
      '价格',
      '套餐',
      '收费',
      '订阅',
      '账单',
      'pricing',
      'price',
      'plan',
      'plans',
      'subscription',
      'billing',
      'cost'
    ].some((keyword) => normalizedQuery.includes(keyword))
  }

  getOfficialDomainCandidates(query = '', searchConfig = this.getSearchConfig()) {
    return [...new Set(
      this.getMatchedSiteProfiles(query, searchConfig)
        .flatMap((profile) => profile.officialDomains || [])
    )]
  }

  getCuratedResultCategories(query = '') {
    const normalizedQuery = String(query || '').toLowerCase()
    const categories = []

    if (this.isPricingQuery(normalizedQuery)) {
      categories.push('pricing')
    }

    if (/api|docs|documentation|开发者|文档/.test(normalizedQuery)) {
      categories.push('docs')
    }

    if (categories.length === 0) {
      categories.push('default')
    }

    return [...new Set(categories)]
  }

  getCuratedOfficialResults(query = '', searchConfig = this.getSearchConfig()) {
    const results = []
    const matchedProfiles = this.getMatchedSiteProfiles(query, searchConfig)
    const categories = this.getCuratedResultCategories(query)

    const pushResult = (title, link, snippet) => {
      if (!link || results.find((item) => item.link === link)) return
      results.push({ title, link, snippet })
    }

    for (const profile of matchedProfiles) {
      for (const category of categories) {
        for (const item of profile.curatedResults?.[category] || []) {
          pushResult(item.title, item.link, item.snippet)
        }
      }

      for (const item of profile.curatedResults?.default || []) {
        pushResult(item.title, item.link, item.snippet)
      }
    }

    return results
  }

  getTopicKeywords(query = '', searchConfig = this.getSearchConfig()) {
    return [...new Set(
      this.getMatchedSiteProfiles(query, searchConfig)
        .flatMap((profile) => profile.topicKeywords || [])
    )]
  }

  getGenericQueryTokens(query = '') {
    const normalizedQuery = String(query || '').toLowerCase()
    if (!normalizedQuery) {
      return []
    }

    const stopTokens = new Set([
      '是什么', '什么意思', '什么是', '来源', '起源', '术语', '解释', '意思', '介绍', '资料', '含义',
      '是什么呢', '是什么啊', '怎么说', '叫法', '说法', '英文', '英语', '中文',
      '台球', '桌球', '撞球', 'billiards', 'billiard', 'pool', 'snooker',
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'meaning', 'origin',
      'term', 'terminology', 'source', 'about', 'english', 'chinese'
    ])

    const rawTokens = normalizedQuery.match(/[a-z0-9]+[\u4e00-\u9fa5]*|[\u4e00-\u9fa5]+/g) || []
    const normalizedTokens = rawTokens
      .flatMap((token) => this.expandQueryToken(token))
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopTokens.has(token))

    return [...new Set(normalizedTokens)]
  }

  countTokenMatches(text = '', tokens = []) {
    const normalizedText = String(text || '').toLowerCase()
    if (!normalizedText || !tokens.length) {
      return 0
    }

    let matchCount = 0
    for (const token of tokens) {
      if (normalizedText.includes(token)) {
        matchCount += 1
      }
    }

    return matchCount
  }

  containsChinese(text = '') {
    return /[\u4e00-\u9fa5]/.test(String(text || ''))
  }

  normalizeQueryText(text = '') {
    return String(text || '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  translateQueryToEnglish(query = '') {
    let translated = this.normalizeQueryText(query).toLowerCase()
    if (!translated || !this.containsChinese(translated)) {
      return ''
    }

    const replacements = [
      [/台球|桌球|撞球/g, 'billiards '],
      [/斯诺克/g, 'snooker '],
      [/术语/g, ' term '],
      [/来源|起源/g, ' origin '],
      [/含义|意思|是什么意思|解释/g, ' meaning '],
      [/英文/g, ' english '],
      [/规则/g, ' rules '],
      [/打法/g, ' play ']
    ]

    for (const [pattern, value] of replacements) {
      translated = translated.replace(pattern, value)
    }

    translated = translated.replace(/([a-z])球/gi, (_, letter) => `"${String(letter).toLowerCase()} ball" `)
    translated = translated.replace(/[？?。！，、；;]/g, ' ')
    translated = translated.replace(/\s+/g, ' ').trim()

    return translated
  }

  isTerminologyQuery(query = '') {
    const normalizedQuery = String(query || '').toLowerCase()
    return /术语|来源|起源|含义|意思|英文|英语|叫法|说法|简称|缩写|term|terminology|origin|meaning|glossary|etymology/.test(normalizedQuery)
  }

  extractQuotedTerms(query = '') {
    const normalizedQuery = this.normalizeQueryText(query)
    const terms = new Set()

    for (const match of normalizedQuery.matchAll(/([a-z])球/gi)) {
      const letter = String(match[1] || '').toLowerCase()
      if (letter) {
        terms.add(`${letter} ball`)
      }
    }

    for (const match of normalizedQuery.matchAll(/["“”]([a-z][a-z0-9\- ]{0,20})["“”]/gi)) {
      const term = this.normalizeQueryText(match[1] || '').toLowerCase()
      if (term) {
        terms.add(term)
      }
    }

    return [...terms]
  }

  buildTermFocusedQueries(query = '') {
    const normalizedQuery = this.normalizeQueryText(query)
    const focusedQueries = []
    const pushQuery = (value) => {
      const normalizedValue = this.normalizeQueryText(value)
      if (normalizedValue && !focusedQueries.includes(normalizedValue)) {
        focusedQueries.push(normalizedValue)
      }
    }

    const englishQuery = this.translateQueryToEnglish(normalizedQuery)
    const quotedTerms = this.extractQuotedTerms(normalizedQuery)
    const hasKBall = /k球/i.test(normalizedQuery)

    if (englishQuery) {
      pushQuery(englishQuery)
    }

    for (const term of quotedTerms) {
      const normalizedTerm = term.replace(/\s+/g, ' ').trim().toLowerCase()
      if (/^[a-z]\s*球$/i.test(normalizedTerm)) {
        const letter = normalizedTerm[0].toLowerCase()
        pushQuery(`billiards "${letter} ball" term`)
        pushQuery(`billiards "${letter} ball" meaning`)
      } else {
        pushQuery(`billiards "${normalizedTerm}" term`)
      }
    }

    if (hasKBall) {
      pushQuery('billiards "k ball" term')
      pushQuery('billiards "kiss shot" glossary')
      pushQuery('cue sports kiss shot term')
    }

    return focusedQueries
  }

  buildExactPhraseQueries(query = '') {
    const normalizedQuery = this.normalizeQueryText(query)
    const exactQueries = []
    const pushQuery = (value) => {
      const normalizedValue = this.normalizeQueryText(value)
      if (normalizedValue && !exactQueries.includes(normalizedValue)) {
        exactQueries.push(normalizedValue)
      }
    }

    const phraseMatches = normalizedQuery.match(/"([^"]+)"/g) || []
    for (const rawPhrase of phraseMatches) {
      const phrase = rawPhrase.replace(/"/g, '').trim()
      if (!phrase) continue
      pushQuery(`"${phrase}"`)
      pushQuery(`"${phrase}" 台球`)
    }

    const letterMatch = normalizedQuery.match(/([a-z])球/i)
    if (letterMatch?.[1]) {
      const letter = letterMatch[1].toLowerCase()
      pushQuery(`"${letter}球" 台球`)
      pushQuery(`"${letter} ball" billiards`)
    }

    return exactQueries
  }

  buildSearchPlan(rawQueries = [], searchConfig = this.getSearchConfig()) {
    const normalizedQueries = this.normalizeStringArray(rawQueries).map((query) => this.normalizeQueryText(query)).filter(Boolean)
    const maxKeywords = searchConfig.maxKeywords || 3
    const baseQueries = normalizedQueries.slice(0, maxKeywords)
    const maxPlanRounds = Math.max(1, Math.min(3, searchConfig.maxRounds || 1))
    const searchPlan = []
    const seenQueries = new Set()

    const pushRound = (queries = [], label = '') => {
      const dedupedQueries = []
      for (const query of queries) {
        const normalizedQuery = this.normalizeQueryText(query)
        if (!normalizedQuery || seenQueries.has(normalizedQuery)) {
          continue
        }

        seenQueries.add(normalizedQuery)
        dedupedQueries.push(normalizedQuery)
      }

      if (dedupedQueries.length > 0) {
        searchPlan.push({ label, queries: dedupedQueries })
      }
    }

    pushRound(baseQueries, 'base')

    const terminologyMode = baseQueries.some((query) => this.isTerminologyQuery(query))
    if (terminologyMode && searchPlan.length < maxPlanRounds) {
      const exactQueries = baseQueries.flatMap((query) => this.buildExactPhraseQueries(query))
      const englishQueries = baseQueries.flatMap((query) => this.buildTermFocusedQueries(query))
      const remainingRounds = maxPlanRounds - searchPlan.length

      if (remainingRounds <= 1) {
        pushRound([...exactQueries, ...englishQueries].slice(0, maxKeywords), 'term_focus')
      } else {
        pushRound(exactQueries.slice(0, maxKeywords), 'exact_phrase')
        if (searchPlan.length < maxPlanRounds) {
          pushRound(englishQueries.slice(0, maxKeywords), 'term_en')
        }
      }
    }

    if (terminologyMode && searchPlan.length < maxPlanRounds) {
      const glossaryQueries = baseQueries.flatMap((query) => {
        const focusedQueries = []
        if (/k球/i.test(query)) {
          focusedQueries.push('site:wikipedia.org billiards kiss shot')
          focusedQueries.push('site:wiktionary.org kiss shot billiards')
        }
        return focusedQueries
      }).slice(0, 2)
      pushRound(glossaryQueries, 'glossary')
    }

    return searchPlan.slice(0, maxPlanRounds)
  }

  expandQueryToken(token = '') {
    const normalizedToken = String(token || '').trim().toLowerCase()
    if (!normalizedToken) {
      return []
    }

    const expandedTokens = [normalizedToken]
    const chineseStopFragments = ['是什么', '什么意思', '什么是', '来源', '起源', '术语', '解释', '意思', '介绍', '资料', '含义', '英文', '英语', '中文']

    for (const fragment of chineseStopFragments) {
      if (normalizedToken.includes(fragment)) {
        const strippedToken = normalizedToken.replaceAll(fragment, '').trim()
        if (strippedToken && strippedToken !== normalizedToken) {
          expandedTokens.push(strippedToken)
        }
      }
    }

    return expandedTokens
  }

  getFocusQueryTokens(query = '') {
    const genericTokens = this.getGenericQueryTokens(query)
    const broadTokens = new Set(['台球', '桌球', '撞球', 'billiards', 'billiard', 'pool', 'snooker'])
    return genericTokens.filter((token) => !broadTokens.has(token))
  }

  isResultRelevant(result = {}, query = '', searchConfig = this.getSearchConfig()) {
    const normalizedQuery = String(query || result.query || '').toLowerCase()
    const topicKeywords = this.getTopicKeywords(normalizedQuery, searchConfig)
    const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
    const hostname = this.normalizeHostname(result.link || '')
    const officialDomains = this.getOfficialDomainCandidates(normalizedQuery, searchConfig)

    if (officialDomains.some((domain) => this.matchesDomain(hostname, domain))) {
      return true
    }

    if (topicKeywords.length > 0) {
      return topicKeywords.some((keyword) => text.includes(keyword))
    }

    const genericTokens = this.getGenericQueryTokens(normalizedQuery)
    if (genericTokens.length === 0) {
      return true
    }

    const focusTokens = this.getFocusQueryTokens(normalizedQuery)
    const genericMatches = this.countTokenMatches(text, genericTokens)
    const focusMatches = this.countTokenMatches(text, focusTokens)

    if (focusTokens.length > 0) {
      return focusMatches > 0 || genericMatches >= 2
    }

    return genericMatches > 0
  }

  hasPricingSignals(result = {}) {
    const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
    return /pricing|price|plan|plans|subscription|billing|cost|价格|收费|套餐|订阅|token|每百万/.test(text)
  }

  matchesConfiguredPatterns(text = '', patterns = []) {
    for (const pattern of patterns) {
      const rawPattern = String(pattern || '').trim()
      if (!rawPattern) continue

      try {
        if (new RegExp(rawPattern, 'i').test(text)) {
          return true
        }
      } catch {
        if (text.toLowerCase().includes(rawPattern.toLowerCase())) {
          return true
        }
      }
    }

    return false
  }

  isLowValueOfficialPricingResult(result = {}, query = '', searchConfig = this.getSearchConfig()) {
    const normalizedQuery = String(query || result.query || '').toLowerCase()
    if (!this.isPricingQuery(normalizedQuery)) {
      return false
    }

    const hostname = this.normalizeHostname(result.link || '')
    const pathname = this.normalizePathname(result.link || '')
    const matchedProfiles = this.getMatchedSiteProfiles(normalizedQuery, searchConfig)
    const officialDomains = this.getOfficialDomainCandidates(normalizedQuery, searchConfig)
    if (!officialDomains.some((domain) => this.matchesDomain(hostname, domain))) {
      return false
    }

    if (this.hasPricingSignals(result)) {
      return false
    }

    const titleAndSnippet = `${result.title || ''} ${result.snippet || ''}`.toLowerCase()
    const lowValuePathPatterns = matchedProfiles.flatMap((profile) => profile.lowValuePricingPaths || [])
    const lowValueTitleKeywords = matchedProfiles.flatMap((profile) => profile.lowValuePricingTitleKeywords || [])

    if (this.matchesConfiguredPatterns(pathname, lowValuePathPatterns)) {
      return true
    }

    return lowValueTitleKeywords.some((keyword) => titleAndSnippet.includes(String(keyword || '').toLowerCase()))
  }

  isLowValueNonOfficialPricingResult(result = {}, query = '', searchConfig = this.getSearchConfig()) {
    const normalizedQuery = String(query || result.query || '').toLowerCase()
    if (!this.isPricingQuery(normalizedQuery)) {
      return false
    }

    const hostname = this.normalizeHostname(result.link || '')
    const officialDomains = this.getOfficialDomainCandidates(normalizedQuery, searchConfig)
    if (officialDomains.some((domain) => this.matchesDomain(hostname, domain))) {
      return false
    }

    if (this.hasPricingSignals(result)) {
      return false
    }

    return true
  }

  isLowValueTerminologyResult(result = {}, query = '') {
    const normalizedQuery = String(query || result.query || '').toLowerCase()
    if (!this.isTerminologyQuery(normalizedQuery)) {
      return false
    }

    const hostname = this.normalizeHostname(result.link || '')
    const pathname = this.normalizePathname(result.link || '')
    const titleAndSnippet = `${result.title || ''} ${result.snippet || ''}`.toLowerCase()

    if (this.matchesDomain(hostname, 'zhihu.com') && /^\/topic\//.test(pathname)) {
      return true
    }

    if (this.isCommunitySource(hostname) && !this.countTokenMatches(titleAndSnippet, this.getFocusQueryTokens(normalizedQuery))) {
      return true
    }

    return /基本玩法|分类|区别|游戏|是什么游戏|规则是怎样/.test(titleAndSnippet)
  }

  filterIrrelevantResults(results = [], searchConfig = {}) {
    if (searchConfig.filterIrrelevantResults === false) {
      return results
    }

    const filteredResults = results.filter((result) => {
      if (!this.isResultRelevant(result, result.query || '', searchConfig)) {
        return false
      }

      if (this.isLowValueOfficialPricingResult(result, result.query || '', searchConfig)) {
        return false
      }

      if (this.isLowValueNonOfficialPricingResult(result, result.query || '', searchConfig)) {
        return false
      }

      if (this.isLowValueTerminologyResult(result, result.query || '')) {
        return false
      }

      return true
    })
    return filteredResults
  }

  shouldEnrichWithPageContent(searchConfig = {}) {
    return searchConfig.enrichWithPageContent !== false
  }

  getMaxParsedResults(searchConfig = {}) {
    return this.clampSearchNumber(searchConfig.maxParsedResults, 2, 0, 3)
  }

  getMaxParsedChars(searchConfig = {}) {
    return this.clampSearchNumber(searchConfig.maxParsedChars, 1200, 500, 4000)
  }

  getRecallResultsPerQuery(searchConfig = {}, query = '') {
    const defaultRecall = this.clampSearchNumber(searchConfig.recallResultsPerQuery, 8, 3, 20)
    const terminologyRecall = this.clampSearchNumber(searchConfig.terminologyRecallResults, 10, 3, 20)
    return this.isTerminologyQuery(query) ? terminologyRecall : defaultRecall
  }

  clampSearchNumber(value, defaultValue, min, max) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) {
      return defaultValue
    }
    return Math.min(max, Math.max(min, Math.floor(parsedValue)))
  }

  async getParsedPageContent(url, maxChars) {
    const cacheKey = `${url}::${maxChars}`
    if (this.pageContentCache.has(cacheKey)) {
      return this.pageContentCache.get(cacheKey)
    }

    const parsedContent = await this.webParserTool.fetchWebContent(url, {
      extractType: 'summary',
      maxChars,
      suppressLog: true
    })

    this.pageContentCache.set(cacheKey, parsedContent || null)

    return parsedContent
  }

  async enrichResultsWithWebContent(results = [], searchConfig = {}) {
    if (!this.shouldEnrichWithPageContent(searchConfig) || !results.length) {
      return results
    }

    const maxParsedResults = this.getMaxParsedResults(searchConfig)
    const maxParsedChars = this.getMaxParsedChars(searchConfig)
    if (maxParsedResults <= 0) {
      return results
    }

    const enrichedResults = results.map((result) => ({ ...result }))
    let parsedCount = 0

    for (const result of enrichedResults) {
      if (parsedCount >= maxParsedResults) {
        break
      }

      if (!/^https?:\/\//i.test(String(result.link || ''))) {
        continue
      }

      const parsedPage = await this.getParsedPageContent(result.link, maxParsedChars)
      if (!parsedPage?.content) {
        continue
      }

      if (parsedPage.accessLimited) {
        if (this.isVerboseSearchLogEnabled(searchConfig)) {
          logger.info(`[SearchTool] 跳过网页正文增强: url=${result.link} reason=${parsedPage.accessLimitedReason || 'access_limited'}`)
        }
        continue
      }

      result.parsedTitle = parsedPage.title || ''
      result.parsedDescription = parsedPage.description || ''
      result.parsedContent = parsedPage.content || ''
      result.parsedHeadings = parsedPage.headings || []
      result.parsedFinalUrl = parsedPage.url || ''
      result.parsedCanonicalUrl = parsedPage.canonicalUrl || ''
      result.parsedSiteName = parsedPage.siteName || ''
      result.parsedPublishedTime = parsedPage.publishedTime || ''
      parsedCount += 1
    }

    return enrichedResults
  }

  isCommunitySource(hostname = '') {
    const communityDomains = [
      'zhihu.com',
      'zhuanlan.zhihu.com',
      'csdn.net',
      'juejin.cn',
      'weixin.qq.com',
      'sohu.com',
      '163.com',
      'toutiao.com',
      'bilibili.com'
    ]

    return communityDomains.some((domain) => this.matchesDomain(hostname, domain))
  }

  hasOfficialResult(results = [], officialDomains = []) {
    if (!officialDomains.length) return false

    return results.some((result) => {
      const hostname = this.normalizeHostname(result.link || '')
      return officialDomains.some((domain) => this.matchesDomain(hostname, domain))
    })
  }

  filterResultsByDomains(results = [], domains = []) {
    if (!domains.length) return results

    return results.filter((result) => {
      const hostname = this.normalizeHostname(result.link || '')
      return domains.some((domain) => this.matchesDomain(hostname, domain))
    })
  }

  scoreSearchResult(result = {}, query = '', searchConfig = {}) {
    const hostname = this.normalizeHostname(result.link || '')
    const normalizedQuery = String(query || result.query || '').toLowerCase()
    const normalizedTitle = String(result.title || '').toLowerCase()
    const normalizedSnippet = String(result.snippet || '').toLowerCase()
    const normalizedLink = String(result.link || '').toLowerCase()
    const officialDomains = this.getOfficialDomainCandidates(normalizedQuery, searchConfig)
    const officialInfoQuery = this.isOfficialInfoQuery(normalizedQuery)
    const pricingQuery = this.isPricingQuery(normalizedQuery)

    let score = 0

    if (officialInfoQuery && officialDomains.some((domain) => this.matchesDomain(hostname, domain))) {
      score += 120
    }

    if (pricingQuery && /pricing|price|plan|plans|subscription|billing|cost|价格|收费|套餐|订阅/.test(`${normalizedTitle} ${normalizedSnippet} ${normalizedLink}`)) {
      score += 35
    }

    if (pricingQuery && /token|每百万|million tokens|input|output|cache read|cache write/.test(`${normalizedTitle} ${normalizedSnippet}`)) {
      score += 20
    }

    if (officialInfoQuery && /api|docs|documentation|help|platform|developer|开发者|文档/.test(`${normalizedTitle} ${normalizedSnippet} ${normalizedLink}`)) {
      score += 20
    }

    if (this.isLowValueOfficialPricingResult(result, normalizedQuery, searchConfig)) {
      score -= 160
    }

    if (searchConfig.demoteCommunitySources !== false && officialInfoQuery && this.isCommunitySource(hostname)) {
      score -= 45
    }

    if (result.round === 1) {
      score += 5
    }

    if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) {
      score += 10
    }

    if (!officialInfoQuery) {
      const genericTokens = this.getGenericQueryTokens(normalizedQuery)
      const focusTokens = this.getFocusQueryTokens(normalizedQuery)
      const rankingText = `${normalizedTitle} ${normalizedSnippet} ${normalizedLink}`
      const tokenMatches = this.countTokenMatches(rankingText, genericTokens)
      const focusMatches = this.countTokenMatches(rankingText, focusTokens)
      score += tokenMatches * 18
      score += focusMatches * 30
      if (this.isTerminologyQuery(normalizedQuery) && /glossary|dictionary|wiktionary|wikipedia|encyclopedia/.test(rankingText)) {
        score += 25
      }
      if (genericTokens.length > 0 && tokenMatches === 0) {
        score -= 80
      }
      if (focusTokens.length > 0 && focusMatches === 0) {
        score -= 60
      }
    }

    return score
  }

  rankSearchResults(results = [], searchConfig = {}) {
    return [...results]
      .map((result, index) => ({
        ...result,
        _score: this.scoreSearchResult(result, result.query || '', searchConfig),
        _index: index
      }))
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score
        return a._index - b._index
      })
      .map(({ _score, _index, ...result }) => result)
  }

  selectWeakFallbackResults(results = [], searchConfig = {}) {
    const maxFallbackResults = this.clampSearchNumber(searchConfig.maxWeakFallbackResults, 2, 0, 3)
    if (maxFallbackResults <= 0) {
      return []
    }

    const filteredCandidates = results.filter((result) => {
      if (this.isLowValueOfficialPricingResult(result, result.query || '', searchConfig)) {
        return false
      }

      if (this.isLowValueNonOfficialPricingResult(result, result.query || '', searchConfig)) {
        return false
      }

      return !this.isCommunitySource(this.normalizeHostname(result.link || ''))
        || this.countTokenMatches(
          `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase(),
          this.getFocusQueryTokens(result.query || '')
        ) > 0
    })

    return this.rankSearchResults(filteredCandidates, searchConfig)
      .slice(0, maxFallbackResults)
      .map((result) => ({
        ...result,
        weaklyRelevant: true
      }))
  }

  async searchOfficialSourceFallback(query, numResults, round, runtimeState, baseResults = []) {
    const searchConfig = this.getSearchConfig()
    if (searchConfig.preferOfficialSources === false) {
      return []
    }

    if (!this.isOfficialInfoQuery(query)) {
      return []
    }

    const officialDomains = this.getOfficialDomainCandidates(query, searchConfig)
    if (!officialDomains.length || this.hasOfficialResult(baseResults, officialDomains)) {
      return []
    }

    const fallbackDomains = officialDomains.slice(0, 2)
    const fallbackResults = [...this.getCuratedOfficialResults(query, searchConfig)]

    if (this.isVerboseSearchLogEnabled(searchConfig)) {
      logger.info(`[SearchTool] 触发官方来源补搜: query="${query}" domains=${fallbackDomains.join(', ')}`)
    }

    for (const domain of fallbackDomains) {
      const siteQuery = `${query} site:${domain}`
      const results = await this.performSearch(siteQuery, Math.min(numResults, 3), round, runtimeState)
      const officialOnlyResults = this.filterResultsByDomains(results, [domain])

      for (const result of officialOnlyResults) {
        if (!fallbackResults.find((item) => item.link === result.link)) {
          fallbackResults.push(result)
        }
      }

      if (fallbackResults.length >= 3) {
        break
      }
    }

    return fallbackResults.slice(0, Math.max(3, numResults))
  }

  extractBingResults(html, numResults) {
    const results = []
    const pushResult = (title, link, snippet = '') => {
      const cleanTitle = this.stripTags(title || '')
      const cleanLink = this.parseBingLink(link || '')
      const cleanSnippet = this.stripTags(snippet || '')

      if (!cleanTitle || !cleanLink) return
      if (results.find((item) => item.link === cleanLink)) return

      results.push({
        title: cleanTitle,
        link: cleanLink,
        snippet: cleanSnippet
      })
    }

    const blockRegex = /<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/g
    let match
    while ((match = blockRegex.exec(html)) !== null && results.length < numResults) {
      const block = match[0]
      const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
        || block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!titleMatch) continue

      const snippetMatch = block.match(/<div[^>]*class="[^"]*\bb_caption\b[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)
        || block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
      pushResult(titleMatch[2], titleMatch[1], snippetMatch?.[1] || '')
    }

    if (results.length >= numResults) return results.slice(0, numResults)

    const genericRegex = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    while ((match = genericRegex.exec(html)) !== null && results.length < numResults) {
      pushResult(match[2], match[1])
    }

    return results.slice(0, numResults)
  }

  async searchSearxng(query, numResults, searxngUrl) {
    const searchConfig = this.getSearchConfig()
    const response = await axios.get(`${this.normalizeBaseUrl(searxngUrl)}/search`, this.buildAxiosConfig({
      headers: this.createRequestHeaders({
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
      }),
      timeout: 15000,
      params: {
        q: query,
        format: 'json',
        engines: this.getSearxngEngines(searchConfig)
      }
    }, 'searxng'))

    const rawResults = Array.isArray(response.data?.results) ? response.data.results : []
    return rawResults.slice(0, numResults).map((item) => ({
      title: this.stripTags(item.title || '无标题'),
      link: item.url || item.link || '',
      snippet: this.stripTags(item.content || item.snippet || item.abstract || '')
    })).filter((item) => item.link)
  }

  async searchBing(query, numResults, searchConfig = this.getSearchConfig()) {
    const normalizedQuery = this.normalizeQueryText(query)
    const useEnglishLocale = !this.containsChinese(normalizedQuery)
    const market = useEnglishLocale ? 'en-US' : 'zh-CN'
    const setLang = useEnglishLocale ? 'en-US' : 'zh-Hans'
    const recallResults = Math.max(numResults, this.getRecallResultsPerQuery(searchConfig, normalizedQuery))
    const response = await axios.get('https://www.bing.com/search', this.buildAxiosConfig({
      headers: this.createRequestHeaders({
        'Accept-Language': useEnglishLocale ? 'en-US,en;q=0.9,zh-CN;q=0.6' : 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }),
      timeout: 15000,
      params: {
        q: normalizedQuery,
        count: recallResults,
        mkt: market,
        setlang: setLang
      }
    }, 'bing'))

    return this.extractBingResults(response.data || '', recallResults)
  }

  async performSearch(query, numResults, round = 0, runtimeState = {}) {
    const searchConfig = this.getSearchConfig()
    const disabledEngines = runtimeState.disabledEngines || new Set()

    if (round > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * round))
    }

    const engines = this.getEngineOrder(searchConfig, round)
    const verboseLogEnabled = this.isVerboseSearchLogEnabled(searchConfig)

    if (verboseLogEnabled) {
      logger.info(
        `[SearchTool] 查询="${query}" round=${round + 1} preferred=${this.getPreferredEngine(searchConfig)} engines=${engines.join(' -> ')} proxy=${this.isToolProxyEnabled() ? 'on' : 'off'}`
      )
    }

    for (const engine of engines) {
      if (disabledEngines.has(engine)) {
        if (verboseLogEnabled) {
          logger.info(`[SearchTool] 跳过已临时禁用的搜索引擎: ${engine}`)
        }
        continue
      }

      let results = []

      try {
        if (engine === 'searxng') {
          results = await this.searchSearxng(query, numResults, searchConfig.searxngUrl)
        } else if (engine === 'bing') {
          results = await this.searchBing(query, numResults, searchConfig)
        }

        if (results.length > 0) {
          logger.debug(`[SearchTool] 使用 ${engine} 搜索成功，找到 ${results.length} 条结果`)
          return results
        }
      } catch (error) {
        const errorType = this.classifySearchError(error)
        logger.error(`[SearchTool] ${engine} 搜索失败(${errorType}):`, error.message)
        if (this.shouldTemporarilyDisableEngine(error)) {
          disabledEngines.add(engine)
          if (verboseLogEnabled) {
            logger.info(`[SearchTool] 已临时禁用搜索引擎: ${engine}`)
          }
        }
      }
    }

    return []
  }

  async func(opts) {
    const { query, num_results = 3 } = opts

    if (!query?.trim()) {
      return '搜索失败：搜索关键词不能为空'
    }

    try {
      const searchConfig = this.getSearchConfig()
      const maxResults = Number(num_results) || searchConfig.maxResults || 3
      const queries = query.split(';').map((item) => item.trim()).filter(Boolean)

      if (queries.length === 0) {
        return '搜索失败：搜索关键词不能为空'
      }

      const searchPlan = this.buildSearchPlan(queries, searchConfig)
      const plannedQueries = searchPlan.flatMap((item) => item.queries)
      const runtimeState = {
        disabledEngines: new Set()
      }

      const allResults = []
      for (let round = 0; round < searchPlan.length; round++) {
        const roundPlan = searchPlan[round]
        for (const singleQuery of roundPlan.queries) {
          const results = await this.performSearch(singleQuery, maxResults, round, runtimeState)
          const officialFallbackResults = await this.searchOfficialSourceFallback(singleQuery, maxResults, round, runtimeState, results)
          const mergedResults = [...officialFallbackResults, ...results]

          if (!mergedResults.length) continue

          for (const result of mergedResults) {
            if (!allResults.find((item) => item.link === result.link)) {
              allResults.push({
                ...result,
                query: singleQuery,
                round: round + 1
              })
            }
          }
        }
      }

      if (allResults.length === 0) {
        return '未找到相关搜索结果'
      }

      const maxTotalResults = searchConfig.maxTotalResults || 10
      const relevantResults = this.filterIrrelevantResults(allResults, searchConfig)
      const rankedResults = this.rankSearchResults(relevantResults, searchConfig)
      const fallbackResults = rankedResults.length === 0
        ? this.selectWeakFallbackResults(allResults, searchConfig)
        : []
      const selectedResults = rankedResults.length > 0 ? rankedResults : fallbackResults
      const limitedResults = selectedResults.slice(0, maxTotalResults)
      const finalResults = await this.enrichResultsWithWebContent(limitedResults, searchConfig)

      return {
        action: 'search',
        queries: plannedQueries,
        results: finalResults,
        result_count: finalResults.length,
        reliable_result_count: rankedResults.length,
        raw_result_count: allResults.length,
        fallback_used: rankedResults.length === 0 && fallbackResults.length > 0,
        rounds: searchPlan.length,
        needForward: searchConfig.forwardReference !== false
      }
    } catch (error) {
      logger.error('搜索失败:', error)
      return `搜索失败: ${error.message}`
    }
  }
}
