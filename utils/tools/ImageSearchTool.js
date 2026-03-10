import { AbstractTool } from './AbstractTool.js'
import crypto from 'crypto'
import Config from '../../components/Config.js'

/**
 * 图片搜索工具类 - 支持多源搜索（Bing、Pixiv）
 */
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
        const { query } = opts
        let count = opts.count !== undefined ? Math.max(1, Math.min(10, parseInt(opts.count) || 5)) : 5
        const source = opts.source || 'auto'

        if (!query) {
            return '搜索关键词（query）是必填项。'
        }

        try {
            // 确定搜索源
            let searchSource = source
            if (source === 'auto') {
                // 根据关键词自动判断：包含日语/动漫相关词优先使用 Pixiv
                const pixivKeywords = /pixiv|p站|插画|二次元|动漫|anime|manga|fanart|同人/i
                searchSource = pixivKeywords.test(query) ? 'pixiv' : 'bing'
            }

            logger.info(`[图片搜索] 关键词: "${query}", 来源: ${searchSource}, 数量: ${count}`)

            let imageUrls = []
            
            // 根据来源执行搜索
            if (searchSource === 'pixiv') {
                imageUrls = await this.searchPixivImages(query, count)
            } else {
                imageUrls = await this.searchBingImages(query, count)
            }

            if (!imageUrls || imageUrls.length === 0) {
                // 如果当前源搜索失败，尝试另一个源
                if (searchSource === 'pixiv') {
                    logger.info('[图片搜索] Pixiv 搜索失败，回退到 Bing')
                    imageUrls = await this.searchBingImages(query, count)
                }
            }

            if (!imageUrls || imageUrls.length === 0) {
                return '抱歉，未搜索到相关图片，请换个关键词试试。'
            }

            // 验证图片可访问性
            const validUrls = await this.validateImages(imageUrls, count)

            if (validUrls.length === 0) {
                return '抱歉，未找到可用的图片，请重试。'
            }

            // 发送图片
            const allImages = []
            for (const url of validUrls) {
                try {
                    const img = segment.image(url)
                    allImages.push(img)
                } catch (error) {
                    console.error(`构建图片消息失败 ${url}:`, error)
                }
            }

            if (allImages.length === 0) {
                return '抱歉，所有图片都无法发送，请重试。'
            }

            // 发送合并转发消息或单独发送
            try {
                if (allImages.length === 1) {
                    await e.reply(allImages[0])
                } else {
                    // 构建转发消息
                    const userId = Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin
                    const list = allImages.map(img => ({
                        user_id: userId,
                        nickname: Bot.nickname,
                        message: img
                    }))
                    await e.reply(await e.group.makeForwardMsg(list))
                }
                return `已成功发送 ${allImages.length} 张图片~（来源：${searchSource === 'pixiv' ? 'Pixiv' : 'Bing'}）`
            } catch (error) {
                console.error('[图片搜索] 发送失败:', error)
                return '图片发送失败，可能被风控，请稍后再试。'
            }
        } catch (error) {
            console.error('图片搜索错误:', error)
            return `图片搜索失败: ${error.message}`
        }
    }

    /**
     * 执行 Pixiv 图片搜索
     * 使用 HibiAPI 或类似服务
     */
    async searchPixivImages(query, count) {
        try {
            // 获取配置
            const config = Config.getConfig()
            const imageSearchConfig = config.smartMode?.tools?.imageSearchConfig || {}
            const pixivProxy = imageSearchConfig.pixivProxy || 'i.pixiv.re'
            const allowR18 = imageSearchConfig.pixivR18 === true

            // 尝试多个 Pixiv API 源
            const apiEndpoints = [
                // HibiAPI 实例（公共）
                `https://api.obfs.dev/api/pixiv/search?word=${encodeURIComponent(query)}&search_target=partial_match_for_tags&sort=date_desc&filter=for_ios`,
                // 备选 API
                `https://hibiapi.cicada000.xyz/api/pixiv/search?word=${encodeURIComponent(query)}&search_target=partial_match_for_tags&sort=date_desc`,
                // Lolicon API (适用于二次元图片)
                `https://api.lolicon.app/setu/v2?keyword=${encodeURIComponent(query)}&num=${count}&r18=${allowR18 ? 2 : 0}`
            ]

            for (const apiUrl of apiEndpoints) {
                try {
                    logger.debug(`[图片搜索] 尝试 Pixiv API: ${apiUrl.substring(0, 50)}...`)
                    
                    const response = await fetch(apiUrl, {
                        method: 'GET',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'application/json'
                        },
                        timeout: 10000
                    })

                    if (!response.ok) {
                        continue
                    }

                    const data = await response.json()
                    let imageUrls = []

                    // 解析不同 API 的响应格式
                    if (apiUrl.includes('lolicon.app')) {
                        // Lolicon API 格式
                        if (data.data && Array.isArray(data.data)) {
                            imageUrls = data.data
                                .map(item => item.urls?.original || item.urls?.regular)
                                .filter(url => url)
                                .map(url => url.replace('i.pximg.net', pixivProxy))
                        }
                    } else {
                        // HibiAPI 格式
                        if (data.illusts && Array.isArray(data.illusts)) {
                            imageUrls = data.illusts
                                .filter(item => allowR18 || item.sanity_level < 6) // 过滤 R18
                                .map(item => item.image_urls?.large || item.image_urls?.medium)
                                .filter(url => url)
                                .map(url => url.replace('i.pximg.net', pixivProxy))
                        }
                    }

                    if (imageUrls.length > 0) {
                        logger.info(`[图片搜索] Pixiv 找到 ${imageUrls.length} 张图片`)
                        return imageUrls.slice(0, count)
                    }
                } catch (error) {
                    logger.debug(`[图片搜索] Pixiv API 失败: ${error.message}`)
                    continue
                }
            }

            return []
        } catch (error) {
            console.error('Pixiv 图片搜索错误:', error)
            return []
        }
    }

    /**
     * 执行必应图片搜索
     */
    async searchBingImages(query, count) {
        try {
            const gecSignature = crypto.randomBytes(32).toString('hex').toUpperCase()
            const clientData = Buffer.from(JSON.stringify({
                '1': '2', '2': '1', '3': '0',
                '4': Date.now().toString(),
                '6': 'stable',
                '7': Math.floor(Math.random() * 9999999999999),
                '9': 'desktop'
            })).toString('base64')

            const headers = {
                'accept': '*/*',
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
                'Referer': 'https://cn.bing.com/visualsearch',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }

            const url = new URL('https://cn.bing.com/images/vsasync')
            url.searchParams.set('q', query)
            url.searchParams.set('count', count * 2) // 获取更多结果以防有些不可用

            const response = await fetch(url.toString(), { method: 'GET', headers })
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const data = await response.json()

            if (data.results && Array.isArray(data.results)) {
                return data.results
                    .map(item => item.imageUrl)
                    .filter(url => url)
                    .slice(0, count)
            }

            return []
        } catch (error) {
            console.error('必应图片搜索错误:', error)
            return []
        }
    }

    /**
     * 验证图片可访问性
     */
    async validateImages(urls, maxCount) {
        const checkImage = async (url) => {
            try {
                const response = await fetch(url, { method: 'HEAD', timeout: 3000 })
                if (response.ok) {
                    const contentType = response.headers.get('content-type')
                    return contentType && contentType.startsWith('image/')
                }
                return false
            } catch (error) {
                return false
            }
        }

        const checks = await Promise.allSettled(
            urls.map(async url => ({ url, isValid: await checkImage(url) }))
        )

        return checks
            .filter(result => result.status === 'fulfilled' && result.value.isValid)
            .map(result => result.value.url)
            .slice(0, maxCount)
    }
}
