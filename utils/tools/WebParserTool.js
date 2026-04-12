import fetch from 'node-fetch'
import { AbstractTool } from './AbstractTool.js'

export class WebParserTool extends AbstractTool {
  constructor() {
    super({
      name: 'webParserTool',
      description: '解析网页链接内容，提取标题、描述、正文、标题层级等关键信息。当用户提供链接或需要更准确地读取网页正文时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '需要解析的网页 URL'
          },
          extract_type: {
            type: 'string',
            description: '提取模式：summary 返回更短摘要，full 返回更完整正文',
            default: 'full'
          },
          max_chars: {
            type: 'integer',
            description: '返回内容最大字符数，默认 full=4000，summary=1500，最大 12000',
            minimum: 500,
            maximum: 12000
          }
        },
        required: ['url']
      }
    })
  }

  normalizeUrl(url = '') {
    const trimmedUrl = String(url || '').trim()
    if (!trimmedUrl) return ''
    return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
  }

  clampNumber(value, defaultValue, min, max) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) {
      return defaultValue
    }
    return Math.min(max, Math.max(min, Math.floor(parsedValue)))
  }

  resolveMaxChars(extractType = 'full', maxChars) {
    const defaultValue = extractType === 'summary' ? 1500 : 4000
    return this.clampNumber(maxChars, defaultValue, 500, 12000)
  }

  async func(opts) {
    const { url, extract_type = 'full', max_chars } = opts

    const processedUrl = this.normalizeUrl(url)
    if (!processedUrl) {
      return '请提供网页链接'
    }

    const extractType = extract_type === 'summary' ? 'summary' : 'full'
    const maxChars = this.resolveMaxChars(extractType, max_chars)

    try {
      const content = await this.fetchWebContent(processedUrl, {
        extractType,
        maxChars
      })

      if (!content) {
        return '无法获取网页内容，请检查链接是否有效'
      }

      return {
        url: processedUrl,
        finalUrl: content.url,
        canonicalUrl: content.canonicalUrl,
        title: content.title,
        description: content.description,
        siteName: content.siteName,
        publishedTime: content.publishedTime,
        headings: content.headings,
        content: content.content,
        content_length: content.fullLength,
        accessLimited: content.accessLimited,
        accessLimitedReason: content.accessLimitedReason
      }
    } catch (error) {
      logger.error('网页解析失败:', error)
      return `网页解析失败: ${error.message}`
    }
  }

  async fetchWebContent(url, options = {}) {
    try {
      const response = await fetch(url, this.buildFetchOptions({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 15000
      }, 'web'))

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const html = await response.text()
      return this.parseHtml(html, response.url || url, options)
    } catch (error) {
      if (options.suppressLog) {
        logger.debug(`获取网页内容失败(已静默): ${error.message}`)
      } else {
        logger.error('获取网页内容失败:', error)
      }
      return null
    }
  }

  parseHtml(html, url, options = {}) {
    const metadata = this.extractMetadata(html, url)
    const mainContent = this.extractMainContent(html)
    const mergedContent = this.mergeContent(mainContent, metadata.articleBody || '')
    const fullText = this.cleanText(mergedContent)
    const extractType = options.extractType === 'summary' ? 'summary' : 'full'
    const maxChars = this.resolveMaxChars(extractType, options.maxChars)
    const content = extractType === 'summary'
      ? this.buildExcerpt(fullText, maxChars)
      : this.truncateText(fullText, maxChars)
    const accessLimitedReason = this.detectAccessLimitation({
      title: metadata.title,
      description: metadata.description,
      headings: metadata.headings,
      content
    })

    return {
      url,
      canonicalUrl: metadata.canonicalUrl || url,
      title: metadata.title || '无标题',
      description: metadata.description || '',
      siteName: metadata.siteName || '',
      publishedTime: metadata.publishedTime || '',
      headings: metadata.headings.slice(0, 8),
      content,
      fullLength: fullText.length,
      accessLimited: Boolean(accessLimitedReason),
      accessLimitedReason
    }
  }

  detectAccessLimitation({ title = '', description = '', headings = [], content = '' } = {}) {
    const previewText = [
      String(title || ''),
      String(description || ''),
      ...(Array.isArray(headings) ? headings.slice(0, 3) : []),
      String(content || '').slice(0, 800)
    ].join('\n').toLowerCase()

    const indicators = [
      {
        reason: '页面返回了地区限制提示，未获取到目标正文',
        patterns: [
          /app unavailable in region/,
          /unavailable in region/,
          /not available in your region/,
          /当前地区不可用/,
          /所在地区不可用/,
          /地区不可用/,
          /区域不可用/
        ]
      },
      {
        reason: '页面返回了登录相关页面，未获取到目标正文',
        patterns: [
          /sign in failed/,
          /sign in to continue/,
          /please sign in/,
          /登录失败/,
          /请先登录/,
          /需要登录/
        ]
      },
      {
        reason: '页面返回了访问验证页面，未获取到目标正文',
        patterns: [
          /verify you are human/,
          /captcha/,
          /security check/,
          /人机验证/,
          /安全验证/
        ]
      },
      {
        reason: '页面返回了访问受限页面，未获取到目标正文',
        patterns: [
          /access denied/,
          /forbidden/,
          /permission denied/
        ]
      }
    ]

    for (const indicator of indicators) {
      if (indicator.patterns.some((pattern) => pattern.test(previewText))) {
        return indicator.reason
      }
    }

    return ''
  }

  extractMetadata(html, url) {
    const jsonLd = this.extractJsonLdData(html)
    const title = this.firstNonEmpty(
      this.extractMetaContent(html, 'property', 'og:title'),
      this.extractMetaContent(html, 'name', 'twitter:title'),
      this.extractTagText(html, 'title'),
      jsonLd.title,
      jsonLd.headline
    )

    const description = this.firstNonEmpty(
      this.extractMetaContent(html, 'name', 'description'),
      this.extractMetaContent(html, 'property', 'og:description'),
      this.extractMetaContent(html, 'name', 'twitter:description'),
      jsonLd.description
    )

    const siteName = this.firstNonEmpty(
      this.extractMetaContent(html, 'property', 'og:site_name'),
      jsonLd.siteName
    )

    const publishedTime = this.firstNonEmpty(
      this.extractMetaContent(html, 'property', 'article:published_time'),
      this.extractMetaContent(html, 'name', 'pubdate'),
      this.extractMetaContent(html, 'name', 'publishdate'),
      jsonLd.datePublished
    )

    const canonicalUrl = this.firstNonEmpty(
      this.extractCanonicalUrl(html),
      url
    )

    return {
      title: this.decodeHtmlEntities(title || '').trim(),
      description: this.decodeHtmlEntities(description || '').trim(),
      siteName: this.decodeHtmlEntities(siteName || '').trim(),
      publishedTime: this.decodeHtmlEntities(publishedTime || '').trim(),
      canonicalUrl,
      headings: this.extractHeadings(html),
      articleBody: this.decodeHtmlEntities(jsonLd.articleBody || '').trim()
    }
  }

  extractMetaContent(html, attrName, attrValue) {
    const regex = new RegExp(
      `<meta[^>]*${attrName}=["']${this.escapeRegExp(attrValue)}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]*content=["']([^"']*)["'][^>]*${attrName}=["']${this.escapeRegExp(attrValue)}["'][^>]*>`,
      'i'
    )
    const match = html.match(regex)
    return match?.[1] || match?.[2] || ''
  }

  extractCanonicalUrl(html) {
    const match = html.match(/<link[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>|<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i)
    return match?.[1] || match?.[2] || ''
  }

  extractTagText(html, tagName) {
    const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
    return match?.[1] ? this.stripTags(match[1]) : ''
  }

  extractHeadings(html) {
    const headings = []
    const regex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
    let match

    while ((match = regex.exec(html)) !== null && headings.length < 8) {
      const text = this.cleanInlineText(this.stripTags(match[2] || ''))
      if (text && !headings.includes(text)) {
        headings.push(text)
      }
    }

    return headings
  }

  extractJsonLdData(html) {
    const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    const aggregated = {
      title: '',
      headline: '',
      description: '',
      siteName: '',
      datePublished: '',
      articleBody: ''
    }

    for (const script of scripts) {
      const rawJson = script[1]?.trim()
      if (!rawJson) continue

      try {
        const parsed = JSON.parse(rawJson)
        this.collectJsonLdFields(parsed, aggregated)
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }

    return aggregated
  }

  collectJsonLdFields(node, aggregated) {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectJsonLdFields(item, aggregated)
      }
      return
    }

    aggregated.title ||= this.firstNonEmpty(node.name, node.title)
    aggregated.headline ||= this.firstNonEmpty(node.headline)
    aggregated.description ||= this.firstNonEmpty(node.description)
    aggregated.siteName ||= this.firstNonEmpty(node.publisher?.name, node.isPartOf?.name)
    aggregated.datePublished ||= this.firstNonEmpty(node.datePublished)
    aggregated.articleBody ||= this.firstNonEmpty(node.articleBody, node.text)

    for (const value of Object.values(node)) {
      this.collectJsonLdFields(value, aggregated)
    }
  }

  extractMainContent(html) {
    const sanitizedHtml = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')

    const candidates = []
    const patterns = [
      /<article[^>]*>([\s\S]*?)<\/article>/gi,
      /<main[^>]*>([\s\S]*?)<\/main>/gi,
      /<(section|div)[^>]*(?:id|class)=["'][^"']*(?:article|content|post|entry|main|body|markdown|rich-text|richtext|prose|document|doc|wiki|text)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
      /<body[^>]*>([\s\S]*?)<\/body>/gi
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(sanitizedHtml)) !== null) {
        const rawHtml = match[2] || match[1] || ''
        const text = this.htmlToText(rawHtml)
        const score = this.scoreContentCandidate(text)
        if (score > 0) {
          candidates.push({ text, score })
        }
      }
    }

    if (!candidates.length) {
      return this.htmlToText(sanitizedHtml)
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates[0].text
  }

  htmlToText(html) {
    return this.decodeHtmlEntities(
      String(html || '')
        .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|section|article|main|header|footer|aside|blockquote|pre|table|tr|ul|ol)>/gi, '\n\n')
        .replace(/<\/(?:h1|h2|h3|h4|h5|h6)>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/li>/gi, '')
        .replace(/<td[^>]*>/gi, ' ')
        .replace(/<\/td>/gi, ' | ')
        .replace(/<[^>]+>/g, ' ')
    )
  }

  scoreContentCandidate(text = '') {
    const normalizedText = this.cleanText(text)
    if (normalizedText.length < 200) {
      return 0
    }

    const paragraphs = normalizedText.split(/\n{2,}/).filter((item) => item.trim().length >= 40).length
    const punctuationCount = (normalizedText.match(/[，。；：！？,.!?;:]/g) || []).length
    return normalizedText.length + paragraphs * 300 + punctuationCount * 2
  }

  mergeContent(primaryText = '', fallbackText = '') {
    const mainText = this.cleanText(primaryText)
    const extraText = this.cleanText(fallbackText)

    if (!extraText) return mainText
    if (!mainText) return extraText
    if (mainText.includes(extraText) || extraText.includes(mainText)) {
      return mainText.length >= extraText.length ? mainText : extraText
    }

    return `${mainText}\n\n${extraText}`
  }

  cleanInlineText(text = '') {
    return this.cleanText(text).replace(/\n+/g, ' ').trim()
  }

  cleanText(text = '') {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line, index, lines) => {
        if (!line) {
          return true
        }

        const normalizedLine = line.toLowerCase()
        if (line.length <= 1) return false
        if (/^(menu|nav|home|login|register|copyright|cookies?)$/i.test(normalizedLine)) {
          return false
        }

        const duplicateCount = lines.filter((item) => item === line).length
        return duplicateCount <= 3
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  buildExcerpt(text = '', maxChars = 1500) {
    const paragraphs = this.cleanText(text)
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 30)

    if (!paragraphs.length) {
      return this.truncateText(this.cleanText(text), maxChars)
    }

    let excerpt = ''
    for (const paragraph of paragraphs) {
      const nextExcerpt = excerpt ? `${excerpt}\n\n${paragraph}` : paragraph
      if (nextExcerpt.length > maxChars) {
        break
      }
      excerpt = nextExcerpt
      if (excerpt.length >= maxChars * 0.8) {
        break
      }
    }

    return this.truncateText(excerpt || paragraphs[0], maxChars)
  }

  truncateText(text = '', maxChars = 4000) {
    const cleanText = this.cleanText(text)
    if (cleanText.length <= maxChars) {
      return cleanText
    }

    return `${cleanText.slice(0, Math.max(0, maxChars - 1)).trim()}…`
  }

  stripTags(text = '') {
    return String(text || '').replace(/<[^>]+>/g, ' ')
  }

  firstNonEmpty(...values) {
    return values.find((value) => String(value || '').trim()) || ''
  }

  decodeHtmlEntities(text = '') {
    const namedEntities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
      '&hellip;': '…',
      '&mdash;': '—',
      '&ndash;': '–',
      '&ldquo;': '"',
      '&rdquo;': '"',
      '&lsquo;': "'",
      '&rsquo;': "'"
    }

    return String(text || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&[a-z]+;/gi, (match) => namedEntities[match] || match)
  }

  escapeRegExp(text = '') {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
