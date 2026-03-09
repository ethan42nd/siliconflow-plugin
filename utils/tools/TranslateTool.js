import { AbstractTool } from './AbstractTool.js'

/**
 * 翻译工具类
 */
export class TranslateTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'translateTool'
        this.description = '翻译文本内容，支持多种语言互译，当用户需要翻译时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: '要翻译的文本内容'
                },
                target_lang: {
                    type: 'string',
                    description: '目标语言代码，如 zh=中文, en=英文, ja=日语, ko=韩语, fr=法语, de=德语, ru=俄语, es=西班牙语等',
                    default: 'zh'
                },
                source_lang: {
                    type: 'string',
                    description: '源语言代码，auto 表示自动检测',
                    default: 'auto'
                }
            },
            required: ['text']
        }
    }

    async func(opts, e) {
        const { text, target_lang = 'zh', source_lang = 'auto' } = opts

        if (!text?.trim()) {
            return '请提供要翻译的文本'
        }

        try {
            // 使用 Google 翻译 API（免费接口）
            const result = await this.googleTranslate(text, source_lang, target_lang)

            if (!result) {
                return '翻译失败，请稍后重试'
            }

            return {
                original: text,
                translated: result.translatedText,
                source_lang: result.detectedSourceLanguage || source_lang,
                target_lang: target_lang
            }
        } catch (error) {
            console.error('翻译失败:', error)
            return `翻译失败: ${error.message}`
        }
    }

    /**
     * Google 翻译（使用免费 API）
     */
    async googleTranslate(text, sourceLang, targetLang) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const data = await response.json()

            if (!data || !data[0]) {
                throw new Error('Invalid response format')
            }

            // 拼接翻译结果
            const translatedText = data[0].map(item => item[0]).join('')
            const detectedSourceLanguage = data[2]

            return {
                translatedText,
                detectedSourceLanguage
            }
        } catch (error) {
            console.error('Google 翻译失败:', error)
            // 降级方案：返回原文
            return {
                translatedText: `[翻译服务暂时不可用] ${text}`,
                detectedSourceLanguage: sourceLang
            }
        }
    }
}
