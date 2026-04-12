import { AbstractTool } from './AbstractTool.js'
import fetch from 'node-fetch'

export class WebParserTool extends AbstractTool {
  constructor() {
    super()
    this.name = 'webParserTool'
    this.description = '解析网页链接内容，提取关键信息，当用户分享链接或需要获取网页内容时使用此工具'
    this.parameters = {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '需要解析的网页URL'
        }
      },
      required: ['url']
    }
  }

  async func(opts) {
    const { url } = opts

    if (!url?.trim()) {
      return '请提供网页链接'
    }

    let processedUrl = url.trim()
    if (!/^https?:\/\//i.test(processedUrl)) {
      processedUrl = `https://${processedUrl}`
    }

    try {
      const content = await this.fetchWebContent(processedUrl)
      if (!content) {
        return '无法获取网页内容，请检查链接是否有效'
      }

      return {
        url: processedUrl,
        title: content.title,
        content: content.text.substring(0, 2000),
        description: content.description
      }
    } catch (error) {
      logger.error('网页解析失败:', error)
      return `网页解析失败: ${error.message}`
    }
  }

  async fetchWebContent(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 15000
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const html = await response.text()
      return this.parseHtml(html, url)
    } catch (error) {
      logger.error('获取网页内容失败:', error)
      return null
    }
  }

  parseHtml(html, url) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? this.decodeHtmlEntities(titleMatch[1].trim()) : '无标题'

    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)
    const description = descMatch ? this.decodeHtmlEntities(descMatch[1]) : ''

    let text = this.extractTextFromHtml(html)
    text = this.cleanText(text)

    return { title, description, text, url }
  }

  extractTextFromHtml(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

    const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    const contentMatch = text.match(/<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)

    if (articleMatch) {
      text = articleMatch[1]
    } else if (mainMatch) {
      text = mainMatch[1]
    } else if (contentMatch) {
      text = contentMatch[1]
    }

    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
  }

  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
  }

  decodeHtmlEntities(text) {
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
      '&hellip;': '…',
      '&mdash;': '—',
      '&ndash;': '–'
    }
    return text.replace(/&[^;]+;/g, (match) => entities[match] || match)
  }
}
