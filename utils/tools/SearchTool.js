import { AbstractTool } from './AbstractTool.js'
import axios from 'axios'

/**
 * 网络搜索工具类
 */
export class SearchTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'searchTool'
        this.description = '进行网络搜索获取实时信息，当用户询问需要最新数据、新闻、实时信息时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词'
                },
                num_results: {
                    type: 'number',
                    description: '返回结果数量，默认5条',
                    default: 5,
                    minimum: 1,
                    maximum: 10
                }
            },
            required: ['query']
        }
    }

    async func(opts, e) {
        const { query, num_results = 5 } = opts

        if (!query?.trim()) {
            return '搜索失败：搜索关键词不能为空'
        }

        try {
            // 使用 searxng 或其他搜索 API
            // 这里提供一个示例实现，使用 DuckDuckGo 搜索
            const searchResults = await this.searchDuckDuckGo(query, num_results)

            if (!searchResults || searchResults.length === 0) {
                return '未找到相关搜索结果'
            }

            return {
                action: 'search',
                query: query,
                results: searchResults,
                result_count: searchResults.length
            }
        } catch (error) {
            console.error('搜索失败:', error)
            return `搜索失败: ${error.message}`
        }
    }

    /**
     * 使用 DuckDuckGo 搜索（示例实现）
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
                links.push(match[1])
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
