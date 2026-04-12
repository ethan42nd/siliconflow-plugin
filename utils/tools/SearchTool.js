import axios from 'axios'
import Config from '../../components/Config.js'
import { AbstractTool } from './AbstractTool.js'

export class SearchTool extends AbstractTool {
  constructor() {
    super({
      name: 'searchTool',
      description: '进行网络搜索获取实时信息，当用户询问需要最新数据、新闻、实时信息时使用此工具。支持一次搜索多个相关关键词以获取更全面的信息。',
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

  parseDuckDuckGoLink(link = '') {
    try {
      if (link.includes('uddg=')) {
        const matched = link.match(/uddg=([^&]+)/)
        if (matched) return decodeURIComponent(matched[1])
      }
      if (link.startsWith('//')) return `https:${link}`
      return link
    } catch {
      return link
    }
  }

  normalizeBaseUrl(url = '') {
    return String(url).trim().replace(/\/$/, '')
  }

  extractDuckDuckGoResults(html, numResults) {
    const results = []
    const pushResult = (title, link, snippet = '') => {
      const cleanLink = this.parseDuckDuckGoLink(link || '')
      const cleanTitle = this.stripTags(title || '')
      const cleanSnippet = this.stripTags(snippet || '')

      if (!cleanLink || !cleanTitle) return
      if (results.find((item) => item.link === cleanLink)) return

      results.push({
        title: cleanTitle,
        link: cleanLink,
        snippet: cleanSnippet
      })
    }

    const primaryRegex = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    let match
    while ((match = primaryRegex.exec(html)) !== null && results.length < numResults) {
      pushResult(match[2], match[1])
    }

    if (results.length >= numResults) return results.slice(0, numResults)

    const blockRegex = /<(div|article)[^>]*class="[^"]*\bresult\b[^"]*"[\s\S]*?<\/\1>/g
    while ((match = blockRegex.exec(html)) !== null && results.length < numResults) {
      const block = match[0]
      const titleMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!titleMatch) continue

      const snippetMatch = block.match(/<(?:a|div|span|p)[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|p)>/)
        || block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
      pushResult(titleMatch[2], titleMatch[1], snippetMatch?.[1] || '')
    }

    if (results.length >= numResults) return results.slice(0, numResults)

    const liteRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    while ((match = liteRegex.exec(html)) !== null && results.length < numResults) {
      pushResult(match[2], match[1])
    }

    return results.slice(0, numResults)
  }

  extractBingResults(html, numResults) {
    const results = []
    const pushResult = (title, link, snippet = '') => {
      const cleanTitle = this.stripTags(title || '')
      const cleanLink = String(link || '').trim()
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
    try {
      const response = await axios.get(`${this.normalizeBaseUrl(searxngUrl)}/search`, {
        headers: this.createRequestHeaders({
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
        }),
        timeout: 15000,
        params: {
          q: query,
          format: 'json',
          engines: 'google,bing,duckduckgo'
        }
      })

      const rawResults = Array.isArray(response.data?.results) ? response.data.results : []
      return rawResults.slice(0, numResults).map((item) => ({
        title: this.stripTags(item.title || '无标题'),
        link: item.url || item.link || '',
        snippet: this.stripTags(item.content || item.snippet || item.abstract || '')
      })).filter((item) => item.link)
    } catch (error) {
      logger.error('[SearchTool] SearXNG 搜索失败:', error.message)
      return []
    }
  }

  async searchDuckDuckGo(query, numResults) {
    try {
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        headers: this.createRequestHeaders({
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }),
        timeout: 10000,
        params: { q: query }
      })

      return this.extractDuckDuckGoResults(response.data || '', numResults)
    } catch (error) {
      logger.error('[SearchTool] DuckDuckGo 搜索失败:', error.message)
      return []
    }
  }

  async searchBing(query, numResults) {
    try {
      const response = await axios.get('https://www.bing.com/search', {
        headers: this.createRequestHeaders({
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }),
        timeout: 15000,
        params: {
          q: query,
          count: numResults
        }
      })

      return this.extractBingResults(response.data || '', numResults)
    } catch (error) {
      logger.error('[SearchTool] Bing 搜索失败:', error.message)
      return []
    }
  }

  async performSearch(query, numResults, round = 0) {
    const searchConfig = this.getSearchConfig()

    if (round > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * round))
    }

    if (searchConfig.searxngUrl) {
      const searxngResults = await this.searchSearxng(query, numResults, searchConfig.searxngUrl)
      if (searxngResults.length > 0) {
        return searxngResults
      }
    }

    const engines = ['duckduckgo', 'bing']
    const startIndex = round % engines.length

    for (let i = 0; i < engines.length; i++) {
      const engine = engines[(startIndex + i) % engines.length]
      let results = []

      try {
        if (engine === 'duckduckgo') {
          results = await this.searchDuckDuckGo(query, numResults)
        } else {
          results = await this.searchBing(query, numResults)
        }

        if (results.length > 0) {
          logger.debug(`[SearchTool] 使用 ${engine} 搜索成功，找到 ${results.length} 条结果`)
          return results
        }
      } catch (error) {
        logger.warn(`[SearchTool] ${engine} 搜索失败:`, error.message)
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
      const maxRounds = searchConfig.maxRounds || 1
      const queries = query.split(';').map((item) => item.trim()).filter(Boolean)

      if (queries.length === 0) {
        return '搜索失败：搜索关键词不能为空'
      }

      const maxKeywords = searchConfig.maxKeywords || 3
      const limitedQueries = queries.slice(0, maxKeywords)

      const allResults = []
      for (let round = 0; round < maxRounds; round++) {
        for (const singleQuery of limitedQueries) {
          const results = await this.performSearch(singleQuery, maxResults, round)
          if (!results.length) continue

          for (const result of results) {
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
      const finalResults = allResults.slice(0, maxTotalResults)

      return {
        action: 'search',
        queries: limitedQueries,
        results: finalResults,
        result_count: finalResults.length,
        rounds: maxRounds,
        needForward: searchConfig.forwardReference !== false
      }
    } catch (error) {
      logger.error('搜索失败:', error)
      return `搜索失败: ${error.message}`
    }
  }
}
