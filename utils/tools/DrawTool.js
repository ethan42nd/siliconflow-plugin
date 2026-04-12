import { AbstractTool } from './AbstractTool.js'
import axios from 'axios'
import Config from '../../components/Config.js'
import { hidePrivacyInfo } from '../common.js'
import { url2Base64 } from '../getImg.js'
import { HttpsProxyAgent } from 'https-proxy-agent'

let modelRouter = null
async function getModelRouter() {
  if (!modelRouter) {
    const { modelRouter: mr } = await import('./ModelRouter.js')
    modelRouter = mr
  }
  return modelRouter
}

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

      if (drawingModel) {
        return await this.drawWithModelRouter(prompt, negative_prompt, width, height, e)
      }

      return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
    } catch (error) {
      logger.error('[DrawTool] 绘图失败:', error)
      return `图片生成失败: ${error.response?.data?.message || error.message}`
    }
  }

  async drawWithModelRouter(prompt, negative_prompt, width, height, e) {
    const mr = await getModelRouter()
    const apiConfig = mr.getApiConfig('drawing')

    if (!apiConfig || !apiConfig.apiKey) {
      logger.warn('[DrawTool] drawingModel 配置无效，回退到 SiliconFlow')
      return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
    }

    logger.info(`[DrawTool] 使用 ModelRouter 调用绘图模型: ${apiConfig.model}`)

    const imagePrompt = negative_prompt
      ? `${prompt}\n\nNegative prompt: ${negative_prompt}`
      : prompt
    const normalizedBaseUrl = apiConfig.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')
    const url = `${normalizedBaseUrl}/v1/chat/completions`

    let messageContent = `Generate an image: ${imagePrompt}`
    let hasReferenceImage = false

    if (e.img && e.img.length > 0) {
      try {
        const imageBase64 = await url2Base64(e.img[0])
        if (imageBase64) {
          messageContent = [
            {
              type: 'text',
              text: `Generate an image based on the reference image: ${imagePrompt}`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
          hasReferenceImage = true
          logger.info('[DrawTool] 检测到引用图片，使用图生图模式')
        }
      } catch (error) {
        logger.warn(`[DrawTool] 获取引用图片失败: ${error.message}，将使用文生图模式`)
      }
    }

    const requestBody = {
      model: apiConfig.model,
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ],
      ...apiConfig.customRequestBody
    }

    const debugLog = Config.getConfig()?.smartMode?.tools?.debugLog
    if (debugLog) {
      logger.mark('\n========== [DrawTool] API 请求详情 ==========')
      logger.mark(`[DrawTool] 请求 URL: ${hidePrivacyInfo(url)}`)
      logger.mark(`[DrawTool] 请求方法: POST`)
      logger.mark(`[DrawTool] 模式: ${hasReferenceImage ? '图生图（含引用图片）' : '文生图'}`)
      logger.mark('[DrawTool] 请求头:')
      logger.mark(`  Authorization: Bearer ${apiConfig.apiKey ? `${apiConfig.apiKey.substring(0, 10)}***` : '未设置'}`)
      logger.mark('  Content-Type: application/json')
      if (apiConfig.useProxy) {
        logger.mark(`[DrawTool] 使用代理: ${hidePrivacyInfo(apiConfig.proxyUrl)}`)
      }
      logger.mark('[DrawTool] 请求体:')

      const logRequestBody = hasReferenceImage ? JSON.parse(JSON.stringify(requestBody)) : requestBody
      if (hasReferenceImage && logRequestBody.messages[0].content[1]?.image_url?.url) {
        logRequestBody.messages[0].content[1].image_url.url = '[base64 image data...]'
      }
      logger.mark(JSON.stringify(logRequestBody, null, 2))
      logger.mark('===========================================\n')
    }

    try {
      const requestConfig = {
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }

      if (apiConfig.useProxy) {
        try {
          requestConfig.httpsAgent = new HttpsProxyAgent(apiConfig.proxyUrl)
        } catch (proxyError) {
          logger.warn(`[DrawTool] 代理配置失败: ${proxyError.message}，将尝试不使用代理`)
        }
      }

      const response = await axios.post(url, requestBody, requestConfig)

      if (debugLog) {
        logger.mark('\n========== [DrawTool] API 响应详情 ==========')
        logger.mark(`[DrawTool] 状态码: ${response.status}`)
        logger.mark('[DrawTool] 响应体:')
        const responseStr = JSON.stringify(response.data, null, 2)
        logger.mark(responseStr.length > 3000 ? `${responseStr.substring(0, 3000)}... (截断)` : responseStr)
        logger.mark('===========================================\n')
      }

      const message = response.data?.choices?.[0]?.message
      if (message?.content) {
        const imageUrlMatch = message.content.match(/https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)/i)
        if (imageUrlMatch) {
          await e.reply(segment.image(imageUrlMatch[0]))
          return {
            status: 'success',
            prompt,
            image_url: imageUrlMatch[0]
          }
        }
      }

      return '图片生成失败：模型未返回图片'
    } catch (error) {
      if (debugLog) {
        logger.error('\n========== [DrawTool] API 错误详情 ==========')
        logger.error(`[DrawTool] 错误消息: ${error.message}`)
        if (error.response) {
          logger.error(`[DrawTool] 状态码: ${error.response.status}`)
          logger.error(`[DrawTool] 状态文本: ${error.response.statusText}`)
          logger.error('[DrawTool] 响应数据:')
          logger.error(JSON.stringify(error.response.data, null, 2))
        }
        logger.error('===========================================\n')
      }

      logger.error('[DrawTool] ModelRouter 绘图失败:', error.message)
      return await this.drawWithSiliconFlow(prompt, negative_prompt, width, height, e)
    }
  }

  async drawWithSiliconFlow(prompt, negative_prompt, width, height, e) {
    const config = Config.getConfig()

    let apiKey = ''
    if (Array.isArray(config.sf_keys) && config.sf_keys.length > 0) {
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
        model,
        prompt,
        negative_prompt,
        width,
        height,
        num_inference_steps: 20,
        guidance_scale: 7.5
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
        prompt,
        image_url: imageUrl
      }
    }

    return '图片生成失败：未返回图片链接'
  }
}
