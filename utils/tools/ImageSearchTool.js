import { AbstractTool } from './AbstractTool.js'
import crypto from 'crypto'
import fetch from 'node-fetch'
import Config from '../../components/Config.js'

export class ImageSearchTool extends AbstractTool {
  constructor() {
    super()
    this.name = 'imageSearchTool'
    this.description = '根据关键词搜索图片并返回图片，支持 Bing 和 Pixiv 搜索，当用户想要看某类图片、找图、搜图时使用此工具。搜索二次元/动漫图片建议使用 Pixiv 源。'
    this.parameters = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索的图片关键词'
        },
        count: {
          type: 'integer',
          description: '返回结果数量，最多10个，默认5个',
          default: 5,
          minimum: 1,
          maximum: 10
        },
        source: {
          type: 'string',
          description: '图片来源：bing(必应)、pixiv、auto(自动选择，默认)',
          enum: ['bing', 'pixiv', 'auto'],
          default: 'auto'
        }
      },
      required: ['query']
    }
  }

  async func(opts, e) {
    const config = Config.getConfig()
    const imageSearchConfig = config.smartMode?.tools?.imageSearchConfig || {}
    const { query } = opts
    const count = opts.count !== undefined ? Math.max(1, Math.min(10, parseInt(opts.count, 10) || 5)) : 5
    const source = opts.source || imageSearchConfig.defaultSource || 'auto'

    if (!query) {
      return '搜索关键词（query）是必填项。'
    }

    try {
      let searchSource = source
      if (source === 'auto') {
        const autoUsePixiv = imageSearchConfig.autoUsePixiv !== false
        const pixivKeywords = /pixiv|p站|插画|二次元|动漫|anime|manga|fanart|同人/i
        searchSource = autoUsePixiv && pixivKeywords.test(query) ? 'pixiv' : 'bing'
      }

      logger.info(`[图片搜索] 关键词: "${query}", 来源: ${searchSource}, 数量: ${count}`)

      let imageUrls = []
      if (searchSource === 'pixiv') {
        imageUrls = await this.searchPixivImages(query, count)
      } else {
        imageUrls = await this.searchBingImages(query, count)
      }

      if ((!imageUrls || imageUrls.length === 0) && searchSource === 'pixiv') {
        logger.info('[图片搜索] Pixiv 搜索失败，回退到 Bing')
        imageUrls = await this.searchBingImages(query, count)
      }

      if (!imageUrls || imageUrls.length === 0) {
        return '抱歉，未搜索到相关图片，请换个关键词试试。'
      }

      const imageQuality = imageSearchConfig.imageQuality || 'original'
      if (imageQuality !== 'original') {
        imageUrls = imageUrls.map((url) => this.convertImageQuality(url, imageQuality))
        logger.info(`[图片搜索] 已转换图片质量为: ${imageQuality}`)
      }

      const validUrls = await this.validateImages(imageUrls, count)
      if (validUrls.length === 0) {
        return '抱歉，未找到可用的图片，请重试。'
      }

      const allImages = []
      for (const url of validUrls) {
        try {
          allImages.push(segment.image(url))
        } catch (error) {
          logger.error(`构建图片消息失败 ${url}:`, error)
        }
      }

      if (allImages.length === 0) {
        return '抱歉，所有图片都无法发送，请重试。'
      }

      try {
        if (allImages.length === 1) {
          await e.reply(allImages[0])
        } else {
          const userId = Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin
          const list = allImages.map((img) => ({
            user_id: userId,
            nickname: Bot.nickname,
            message: img
          }))
          await e.reply(await e.group.makeForwardMsg(list))
        }

        return `已成功发送 ${allImages.length} 张图片~（来源：${searchSource === 'pixiv' ? 'Pixiv' : 'Bing'}）`
      } catch (error) {
        logger.error('[图片搜索] 发送失败:', error)
        return '图片发送失败，可能被风控，请稍后再试。'
      }
    } catch (error) {
      logger.error('图片搜索错误:', error)
      return `图片搜索失败: ${error.message}`
    }
  }

  async searchPixivImages(query, count) {
    try {
      const imageSearchConfig = Config.getConfig()?.smartMode?.tools?.imageSearchConfig || {}
      const pixivProxy = imageSearchConfig.pixivProxy || 'i.pixiv.re'
      const allowR18 = imageSearchConfig.pixivR18 === true

      const apiEndpoints = [
        `https://api.obfs.dev/api/pixiv/search?word=${encodeURIComponent(query)}&search_target=partial_match_for_tags&sort=date_desc&filter=for_ios`,
        `https://hibiapi.cicada000.xyz/api/pixiv/search?word=${encodeURIComponent(query)}&search_target=partial_match_for_tags&sort=date_desc`,
        `https://api.lolicon.app/setu/v2?keyword=${encodeURIComponent(query)}&num=${count}&r18=${allowR18 ? 2 : 0}`
      ]

      for (const apiUrl of apiEndpoints) {
        try {
          logger.debug(`[图片搜索] 尝试 Pixiv API: ${apiUrl.substring(0, 50)}...`)

          const response = await fetch(apiUrl, this.buildFetchOptions({
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'application/json'
            },
            timeout: 10000
          }, 'pixiv-api'))

          if (!response.ok) continue

          const data = await response.json()
          let imageUrls = []

          if (apiUrl.includes('lolicon.app')) {
            if (Array.isArray(data.data)) {
              imageUrls = data.data
                .map((item) => item.urls?.original || item.urls?.regular)
                .filter(Boolean)
                .map((url) => url.replace('i.pximg.net', pixivProxy))
            }
          } else if (Array.isArray(data.illusts)) {
            imageUrls = data.illusts
              .filter((item) => allowR18 || item.sanity_level < 6)
              .map((item) => item.image_urls?.large || item.image_urls?.medium)
              .filter(Boolean)
              .map((url) => url.replace('i.pximg.net', pixivProxy))
          }

          if (imageUrls.length > 0) {
            logger.info(`[图片搜索] Pixiv 找到 ${imageUrls.length} 张图片`)
            return imageUrls.slice(0, count)
          }
        } catch (error) {
          logger.debug(`[图片搜索] Pixiv API 失败: ${error.message}`)
        }
      }

      return []
    } catch (error) {
      logger.error('Pixiv 图片搜索错误:', error)
      return []
    }
  }

  async searchBingImages(query, count) {
    try {
      const gecSignature = crypto.randomBytes(32).toString('hex').toUpperCase()
      const clientData = Buffer.from(JSON.stringify({
        '1': '2',
        '2': '1',
        '3': '0',
        '4': Date.now().toString(),
        '6': 'stable',
        '7': Math.floor(Math.random() * 9999999999999),
        '9': 'desktop'
      })).toString('base64')

      const headers = {
        accept: '*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-ch-ua': '"Microsoft Edge";v="131", "Chromium";v="131"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-ms-gec': gecSignature,
        'sec-ms-gec-version': '1-131.0.2903.112',
        'x-client-data': clientData,
        'x-edge-shopping-flag': '1',
        Referer: 'https://cn.bing.com/visualsearch',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }

      const url = new URL('https://cn.bing.com/images/vsasync')
      url.searchParams.set('q', query)
      url.searchParams.set('count', count * 2)

      const response = await fetch(url.toString(), this.buildFetchOptions({ method: 'GET', headers }, 'bing-images'))
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      if (Array.isArray(data.results)) {
        return data.results
          .map((item) => item.imageUrl)
          .filter(Boolean)
          .slice(0, count)
      }

      return []
    } catch (error) {
      logger.error('必应图片搜索错误:', error)
      return []
    }
  }

  async validateImages(urls, maxCount) {
    const checks = await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const response = await fetch(url, this.buildFetchOptions({ method: 'HEAD', timeout: 3000 }, 'image-validate'))
          if (!response.ok) {
            return { url, isValid: false }
          }

          const contentType = response.headers.get('content-type')
          return { url, isValid: Boolean(contentType && contentType.startsWith('image/')) }
        } catch {
          return { url, isValid: false }
        }
      })
    )

    return checks
      .filter((result) => result.status === 'fulfilled' && result.value.isValid)
      .map((result) => result.value.url)
      .slice(0, maxCount)
  }

  convertImageQuality(url, quality) {
    if (quality === 'original' || !url) return url

    if (url.includes('img-original')) {
      if (quality === 'master') {
        return url.replace('img-original', 'img-master').replace(/\.(jpg|png|gif)$/, '_master1200.jpg')
      }

      if (quality === 'small') {
        return url.replace('img-original', 'img-master').replace(/\.(jpg|png|gif)$/, '_square1200.jpg')
      }
    }

    return url
  }
}
