import { AbstractTool } from './AbstractTool.js'
import axios from 'axios'
import Config from '../../components/Config.js'

/**
 * 网络搜索工具类 - 支持多关键词和多轮搜索
 */
export class SearchTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'searchTool'
        this.description = '进行网络搜索获取实时信息，当用户询问需要最新数据、新闻、实时信息时使用此工具。支持一次搜索多个相关关键词以获取更全面的信息。'
        this.parameters = {
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
    }

    async func(opts, e) {
        const { query, num_results = 3 } = opts

        if (!query?.trim()) {
            return '搜索失败：搜索关键词不能为空'
        }

        try {
            // 获取搜索配置
            const config = Config.getConfig()
            const searchConfig = config.smartMode?.tools?.searchConfig || {}
            
            // 配置参数（使用传入值或配置默认值）
            const maxResults = num_results || searchConfig.maxResults || 3
            const maxRounds = searchConfig.maxRounds || 1
            
            // 解析多个搜索关键词
            const queries = query.split(';').map(q => q.trim()).filter(q => q)
            
            if (queries.length === 0) {
                return '搜索失败：搜索关键词不能为空'
            }

            // 限制最大关键词数量
            const maxKeywords = searchConfig.maxKeywords || 3
            const limitedQueries = queries.slice(0, maxKeywords)

            // 执行多轮搜索（如果需要）
            let allResults = []
            for (let round = 0; round < maxRounds; round++) {
                for (const singleQuery of limitedQueries) {
                    const results = await this.performSearch(singleQuery, maxResults, round)
                    if (results && results.length > 0) {
                        // 去重：避免相同链接
                        for (const result of results) {
                            if (!allResults.find(r => r.link === result.link)) {
                                allResults.push({
                                    ...result,
                                    query: singleQuery,
                                    round: round + 1
                                })
                            }
                        }
                    }
                }
            }

            if (allResults.length === 0) {
                return '未找到相关搜索结果'
            }

            // 按相关性排序并限制总数
            const maxTotalResults = searchConfig.maxTotalResults || 10
            const finalResults = allResults.slice(0, maxTotalResults)

            return {
                action: 'search',
                queries: limitedQueries,
                results: finalResults,
                result_count: finalResults.length,
                rounds: maxRounds,
                needForward: searchConfig.forwardReference !== false // 是否需要转发消息
            }
        } catch (error) {
            console.error('搜索失败:', error)
            return `搜索失败: ${error.message}`
        }
    }

    /**
     * 执行搜索（支持多种搜索引擎，自动降级）
     */
    async performSearch(query, numResults, round = 0) {
        const config = Config.getConfig()
        const searchConfig = config.smartMode?.tools?.searchConfig || {}
        
        // 根据轮数添加延迟避免限制
        if (round > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * round))
        }
        
        // 优先使用 SearXNG 实例
        if (searchConfig.searxngUrl) {
            const results = await this.searchSearxng(query, numResults, searchConfig.searxngUrl)
            if (results.length > 0) return results
        }
        
        // 引擎优先级：DuckDuckGo -> Bing -> Google
        const engines = ['duckduckgo', 'bing']
        const startIndex = round % engines.length
        
        for (let i = 0; i < engines.length; i++) {
            const engine = engines[(startIndex + i) % engines.length]
            let results = []
            
            try {
                if (engine === 'duckduckgo') {
                    results = await this.searchDuckDuckGo(query, numResults)
                } else if (engine === 'bing') {
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

    /**
     * 使用 SearXNG 搜索
     */
    async searchSearxng(query, numResults, searxngUrl) {
        try {
            const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo`
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            })

            const results = response.data.results || []
            return results.slice(0, numResults).map(r => ({
                title: r.title || '无标题',
                link: r.url || r.link || '',
                snippet: r.content || r.snippet || r.abstract || ''
            }))
        } catch (error) {
            logger.error('[SearchTool] SearXNG 搜索失败:', error.message)
            return []
        }
    }

    /**
     * 使用 DuckDuckGo 搜索
     */
    async searchDuckDuckGo(query, numResults) {
        try {
            // 注意：这里使用 html.duckduckgo.com，它不需要 JS
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            })

            const html = response.data
            const results = []

            // 简单解析 HTML 提取搜索结果
            const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/g
            const snippetRegex = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g

            let match
            const links = []
            const titles = []

            while ((match = resultRegex.exec(html)) !== null && links.length < numResults) {
                const rawLink = match[1]
                // 解析 DuckDuckGo 重定向链接获取真实 URL
                const realLink = this.parseDuckDuckGoLink(rawLink)
                links.push(realLink)
                titles.push(this.decodeHtmlEntities(match[2]))
            }

            const snippets = []
            while ((match = snippetRegex.exec(html)) !== null && snippets.length < numResults) {
                snippets.push(this.decodeHtmlEntities(match[1]))
            }

            for (let i = 0; i < Math.min(links.length, numResults); i++) {
                results.push({
                    title: titles[i] || '无标题',
                    link: links[i],
                    snippet: snippets[i] || ''
                })
            }

            return results
        } catch (error) {
            console.error('DuckDuckGo 搜索失败:', error)
            return []
        }
    }

    /**
     * 解析 DuckDuckGo 重定向链接获取真实 URL
     */
    parseDuckDuckGoLink(redirectUrl) {
        try {
            // DuckDuckGo 链接格式: //duckduckgo.com/l/?uddg=URL&rut=...
            if (redirectUrl.includes('uddg=')) {
                const uddgMatch = redirectUrl.match(/uddg=([^&]+)/)
                if (uddgMatch) {
                    return decodeURIComponent(uddgMatch[1])
                }
            }
            return redirectUrl
        } catch (e) {
            return redirectUrl
        }
    }

    /**
     * 使用 Bing 搜索
     */
    async searchBing(query, numResults) {
        try {
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}`
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                },
                timeout: 15000
            })

            const html = response.data
            const results = []

            // 解析 Bing 搜索结果
            // Bing 结果在 .b_algo 容器中
            const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g
            let algoMatch
            
            while ((algoMatch = algoRegex.exec(html)) !== null && results.length < numResults) {
                const algoHtml = algoMatch[1]
                
                // 提取标题和链接
                const titleMatch = algoHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
                if (!titleMatch) continue
                
                const link = titleMatch[1]
                const title = this.stripHtml(titleMatch[2]).trim()
                
                // 提取摘要
                const snippetMatch = algoHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/)
                const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]).trim() : ''
                
                results.push({
                    title: title || '无标题',
                    link: link,
                    snippet: snippet
                })
            }

            return results
        } catch (error) {
            logger.error('[SearchTool] Bing 搜索失败:', error.message)
            return []
        }
    }

    /**
     * 去除 HTML 标签
     */
    stripHtml(html) {
        return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    }

    decodeHtmlEntities(text) {
        const entities = {
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#39;': "'",
            '&nbsp;': ' '
        }
        return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, match => entities[match] || match)
    }
}
