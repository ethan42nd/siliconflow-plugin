import { AbstractTool } from './AbstractTool.js'
import crypto from 'crypto'

/**
 * 图片搜索工具类
 */
export class ImageSearchTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'imageSearchTool'
        this.description = '根据关键词搜索图片并返回图片，当用户想要看某类图片、找图、搜图时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索的图片关键词'
                },
                count: {
                    type: 'number',
                    description: '返回结果数量，最多10个',
                    default: 5,
                    minimum: 1,
                    maximum: 10
                }
            },
            required: ['query']
        }
    }

    async func(opts, e) {
        const { query } = opts
        let count = opts.count !== undefined ? Math.max(1, Math.min(10, parseInt(opts.count) || 5)) : 5

        if (!query) {
            return '搜索关键词（query）是必填项。'
        }

        try {
            // 使用必应图片搜索
            let imageUrls = await this.searchBingImages(query, count)

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
                    const list = allImages.map(img => ({
                        user_id: Bot.uin,
                        nickname: Bot.nickname,
                        message: img
                    }))
                    await e.reply(await e.group.makeForwardMsg(list))
                }
                return `已成功发送 ${allImages.length} 张图片~`
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
