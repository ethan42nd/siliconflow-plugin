import { AbstractTool } from './AbstractTool.js'
import axios from 'axios'
import Config from '../../components/Config.js'
import { hidePrivacyInfo } from '../common.js'

// 动态导入 ModelRouter 避免循环依赖
let modelRouter = null
async function getModelRouter() {
    if (!modelRouter) {
        const { modelRouter: mr } = await import('./ModelRouter.js')
        modelRouter = mr
    }
    return modelRouter
}

/**
 * AI 绘图工具类 - 支持多模型路由
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
            const config = Config.getConfig()
            const drawingModel = config.smartMode?.tools?.models?.drawingModel
            
            // 如果配置了专用绘图模型（如 Gemini），使用 ModelRouter
            if (drawingModel) {
                return await this.drawWithModelRouter(prompt, negative_prompt, width, height, e)
            }
            
            // 否则使用 SiliconFlow 默认方式
            return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
        } catch (error) {
            logger.error('[DrawTool] 绘图失败:', error)
            return `图片生成失败: ${error.response?.data?.message || error.message}`
        }
    }

    /**
     * 使用 ModelRouter 调用配置的绘图模型
     */
    async drawWithModelRouter(prompt, negative_prompt, width, height, e) {
        const mr = await getModelRouter()
        const apiConfig = mr.getApiConfig('drawing', '')
        
        if (!apiConfig || !apiConfig.apiKey) {
            logger.warn('[DrawTool] drawingModel 配置无效，回退到 SiliconFlow')
            return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
        }

        logger.info(`[DrawTool] 使用 ModelRouter 调用绘图模型: ${apiConfig.model}`)

        // 构建画图提示词
        const imagePrompt = negative_prompt 
            ? `${prompt}\n\nNegative prompt: ${negative_prompt}`
            : prompt

        // 处理 baseUrl，移除末尾的 /v1 以避免重复（兼容中转服务）
        const normalizedBaseUrl = apiConfig.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')
        const url = `${normalizedBaseUrl}/v1/chat/completions`

        const requestBody = {
            model: apiConfig.model,
            messages: [
                {
                    role: 'user',
                    content: `Generate an image: ${imagePrompt}`
                }
            ],
            ...apiConfig.customRequestBody
        }

        // 打印详细请求信息
        const debugLog = Config.getConfig()?.smartMode?.tools?.debugLog
        if (debugLog) {
            logger.mark('\n========== [DrawTool] API 请求详情 ==========')
            logger.mark(`[DrawTool] 请求 URL: ${hidePrivacyInfo(url)}`)
            logger.mark(`[DrawTool] 请求方法: POST`)
            logger.mark(`[DrawTool] 请求头:`)
            logger.mark(`  Authorization: Bearer ${apiConfig.apiKey ? apiConfig.apiKey.substring(0, 10) + '***' : '未设置'}`)
            logger.mark(`  Content-Type: application/json`)
            logger.mark(`[DrawTool] 请求体:`)
            logger.mark(JSON.stringify(requestBody, null, 2))
            logger.mark('===========================================\n')
        }

        try {
            const response = await axios.post(url, requestBody, {
                headers: {
                    'Authorization': `Bearer ${apiConfig.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
            })

            // 打印响应信息
            if (debugLog) {
                logger.mark('\n========== [DrawTool] API 响应详情 ==========')
                logger.mark(`[DrawTool] 状态码: ${response.status}`)
                logger.mark(`[DrawTool] 响应体:`)
                const responseStr = JSON.stringify(response.data, null, 2)
                logger.mark(responseStr.length > 3000 ? responseStr.substring(0, 3000) + '... (截断)' : responseStr)
                logger.mark('===========================================\n')
            }

            // 尝试从响应中提取图片
            const message = response.data?.choices?.[0]?.message
            if (message?.content) {
                // 检查是否返回了图片 URL 或 base64
                const imageUrlMatch = message.content.match(/https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)/i)
                if (imageUrlMatch) {
                    await e.reply(segment.image(imageUrlMatch[0]))
                    return {
                        status: 'success',
                        prompt: prompt,
                        image_url: imageUrlMatch[0]
                    }
                }
            }
            
            return '图片生成失败：模型未返回图片'
        } catch (error) {
            // 打印详细错误信息
            if (debugLog) {
                logger.error('\n========== [DrawTool] API 错误详情 ==========')
                logger.error(`[DrawTool] 错误消息: ${error.message}`)
                if (error.response) {
                    logger.error(`[DrawTool] 状态码: ${error.response.status}`)
                    logger.error(`[DrawTool] 状态文本: ${error.response.statusText}`)
                    logger.error(`[DrawTool] 响应数据:`)
                    logger.error(JSON.stringify(error.response.data, null, 2))
                }
                logger.error('===========================================\n')
            }
            
            logger.error('[DrawTool] ModelRouter 绘图失败:', error.message)
            // 失败时回退到 SiliconFlow
            return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
        }
    }

    /**
     * 使用 SiliconFlow 默认方式
     */
    async drawWithSiliconFlow(prompt, negative_prompt, width, height, e) {
        const config = Config.getConfig()
        
        // 获取 API Key
        let apiKey = ''
        if (config.sf_keys && Array.isArray(config.sf_keys) && config.sf_keys.length > 0) {
            apiKey = config.sf_keys[0]
        } else if (config.sfKey) {
            apiKey = config.sfKey
        }
        
        if (typeof apiKey !== 'string') {
            apiKey = String(apiKey)
        }
        
        if (!apiKey || apiKey === 'undefined' || apiKey === '[object Object]') {
            return '绘图功能未配置有效的 API Key'
        }
        
        const model = config.sf_model || 'stabilityai/stable-diffusion-xl-base-1.0'
        logger.info(`[DrawTool] 使用 SiliconFlow: ${model}`)

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
    }
}
