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
                    type: 'number',
                    description: '图片宽度，默认 1024',
                    default: 1024,
                    enum: [512, 768, 1024]
                },
                height: {
                    type: 'number',
                    description: '图片高度，默认 1024',
                    default: 1024,
                    enum: [512, 768, 1024]
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
            const apiKey = config.sf_keys?.[0]
            const model = config.sf_model || 'stabilityai/stable-diffusion-xl-base-1.0'

            if (!apiKey) {
                return '绘图功能未配置 API Key'
            }

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
