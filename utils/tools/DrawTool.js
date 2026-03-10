import { AbstractTool } from './AbstractTool.js'
import axios from 'axios'
import Config from '../../components/Config.js'

/**
 * AI 绘图工具类 - 使用 SiliconFlow API
 */
export class DrawTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'drawTool'
        this.description = '根据描述生成图片，当你需要画图、生成图片时使用此工具。请用英文详细描述你想要的图片内容。'
        this.parameters = {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '图片的详细描述，建议用英文描述，描述越详细生成的图片越好'
                },
                negative_prompt: {
                    type: 'string',
                    description: '负面描述，指定不希望在图片中出现的内容',
                    default: ''
                },
                width: {
                    type: 'integer',
                    description: '图片宽度，可选值：512、768、1024，默认 1024',
                    default: 1024
                },
                height: {
                    type: 'integer',
                    description: '图片高度，可选值：512、768、1024，默认 1024',
                    default: 1024
                }
            },
            required: ['prompt']
        }
    }

    async func(opts, e) {
        const { prompt, negative_prompt = '', width = 1024, height = 1024 } = opts

        if (!prompt?.trim()) {
            return '请提供图片描述'
        }

        try {
            // 获取配置
            const config = Config.getConfig()
            
            // 调试日志
            logger.debug(`[DrawTool] sf_keys 类型: ${typeof config.sf_keys}, 是否为数组: ${Array.isArray(config.sf_keys)}`)
            logger.debug(`[DrawTool] sf_keys 内容: ${JSON.stringify(config.sf_keys)}`)
            
            // 获取 API Key（支持 sf_keys 数组或 sfKey 单字符串）
            let apiKey = ''
            if (config.sf_keys && Array.isArray(config.sf_keys) && config.sf_keys.length > 0) {
                apiKey = config.sf_keys[0]
                logger.debug(`[DrawTool] 从 sf_keys[0] 获取: ${typeof apiKey}, ${JSON.stringify(apiKey).substring(0, 50)}`)
            } else if (config.sfKey) {
                apiKey = config.sfKey
                logger.debug(`[DrawTool] 从 sfKey 获取: ${typeof apiKey}`)
            }
            
            // 确保 apiKey 是字符串
            if (typeof apiKey !== 'string') {
                apiKey = String(apiKey)
            }
            
            const model = config.sf_model || 'stabilityai/stable-diffusion-xl-base-1.0'

            if (!apiKey || apiKey === 'undefined' || apiKey === '[object Object]') {
                logger.error('[DrawTool] API Key 无效:', apiKey)
                return '绘图功能未配置有效的 API Key，请在锅巴配置或 config.yaml 中设置 sf_keys（格式：sk-xxxxx）'
            }
            
            logger.info(`[DrawTool] 使用模型: ${model}, API Key: ${apiKey.substring(0, 10)}...`)

            // 发送请求到 SiliconFlow
            const response = await axios.post(
                'https://api.siliconflow.cn/v1/images/generations',
                {
                    model: model,
                    prompt: prompt,
                    negative_prompt: negative_prompt,
                    width: width,
                    height: height,
                    num_inference_steps: 20,
                    guidance_scale: 7.5
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000
                }
            )

            if (response.data?.images?.[0]?.url) {
                const imageUrl = response.data.images[0].url
                await e.reply(segment.image(imageUrl))
                return {
                    status: 'success',
                    prompt: prompt,
                    image_url: imageUrl
                }
            } else {
                return '图片生成失败：未返回图片链接'
            }
        } catch (error) {
            logger.error('[DrawTool] 绘图失败:', error)
            return `图片生成失败: ${error.response?.data?.message || error.message}`
        }
    }
}
