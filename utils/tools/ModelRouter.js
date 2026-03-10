import Config from '../../components/Config.js'
import axios from 'axios'
import { hidePrivacyInfo } from '../common.js'

/**
 * @description: 多模型API路由器
 * 为不同功能提供不同的AI模型支持：工具调用、视觉、画图、搜索、聊天
 */

export class ModelRouter {
    constructor() {
        this.cache = new Map()
        this.cacheTimeout = 5 * 60 * 1000 // 5分钟缓存
    }

    /**
     * @description: 获取指定用途的API配置
     * @param {string} purpose - 用途：toolCall(工具调用)、vision(视觉)、drawing(画图)、search(搜索)、chat(聊天)
     * @param {string} defaultModelName - 默认模型名称（配置中的智能模式选中模型）
     * @return {Object|null} API配置
     */
    getApiConfig(purpose, defaultModelName) {
        const config = Config.getConfig()
        // 映射 purpose 到配置路径
        const modelMapping = {
            toolCall: 'toolCallModel',
            vision: 'visionModel',
            drawing: 'drawingModel',
            search: 'searchModel',
            chat: 'chatModel'
        }
        const modelKey = modelMapping[purpose]
        const modelConfig = config.smartMode?.tools?.models?.[modelKey]
        
        // 如果没有配置多模型路由，或者使用默认模型
        if (!modelConfig || modelConfig === '' || modelConfig === 'default') {
            // 返回默认配置（使用SF配置或SS配置）
            return this._getDefaultApiConfig(config, defaultModelName)
        }

        // 从 smart_APIList 中查找指定的模型配置
        const apiList = config.smart_APIList || []
        const apiConfig = apiList.find(api => api.remark === modelConfig)
        
        if (!apiConfig) {
            logger.warn(`[ModelRouter] 未找到模型 "${modelConfig}"，使用默认配置`)
            return this._getDefaultApiConfig(config, defaultModelName)
        }

        return this._normalizeApiConfig(apiConfig, config)
    }

    /**
     * @description: 获取默认API配置（兼容原有逻辑）
     * @param {Object} config - 全局配置
     * @param {string} modelName - 模型名称
     * @return {Object} API配置
     */
    _getDefaultApiConfig(config, modelName) {
        // 优先使用SS配置（OpenAI兼容格式，更适合工具调用）
        if (config.ss_api) {
            return {
                baseUrl: config.ss_api.replace(/\/$/, ''),
                apiKey: config.ss_Key,
                model: config.ss_model || 'gpt-4o',
                type: 'openai'
            }
        }
        // 否则使用SF配置
        return {
            baseUrl: config.sfBaseUrl || 'https://api.siliconflow.cn',
            apiKey: config.sfKey,
            model: config.sf_model || 'deepseek-ai/DeepSeek-V3',
            type: 'openai'
        }
    }

    /**
     * @description: 标准化API配置
     * @param {Object} apiConfig - API列表中的配置
     * @param {Object} globalConfig - 全局配置
     * @return {Object} 标准化的API配置
     */
    _normalizeApiConfig(apiConfig, globalConfig) {
        const baseUrl = apiConfig.api?.replace(/\/$/, '') || 'https://api.siliconflow.cn'
        const apiKey = apiConfig.key
        const model = apiConfig.model || globalConfig.sf_model || 'deepseek-ai/DeepSeek-V3'
        
        return {
            baseUrl,
            apiKey,
            model,
            type: 'openai', // 统一使用OpenAI格式
            name: apiConfig.name,
            customRequestBody: apiConfig.customRequestBody || {}
        }
    }

    /**
     * @description: 发送聊天请求（带工具）
     * @param {Object} options - 请求选项
     * @param {Array} options.messages - 消息历史
     * @param {Array} options.tools - 工具定义
     * @param {string} options.purpose - 用途（决定使用哪个模型）
     * @param {string} options.defaultModelName - 默认模型名称
     * @param {number} options.temperature - 温度
     * @return {Object} AI响应
     */
    async chat(options) {
        const { messages, tools, purpose, defaultModelName, temperature = 0.7 } = options
        
        const apiConfig = this.getApiConfig(purpose, defaultModelName)
        if (!apiConfig || !apiConfig.apiKey) {
            throw new Error(`[ModelRouter] ${purpose} 用途的API配置无效`)
        }

        const url = `${apiConfig.baseUrl}/v1/chat/completions`
        
        const requestBody = {
            model: apiConfig.model,
            messages,
            temperature,
            ...apiConfig.customRequestBody
        }

        // 只有在需要工具调用时才添加 tools 参数
        if (tools && tools.length > 0) {
            requestBody.tools = tools
            requestBody.tool_choice = 'auto'
        }

        if (Config.getConfig()?.smartMode?.tools?.debugLog) {
            logger.mark(`\n[ModelRouter] 请求模型: ${apiConfig.model} (${purpose})`)
            logger.mark(`[ModelRouter] API: ${hidePrivacyInfo(apiConfig.baseUrl)}`)
            logger.mark(`[ModelRouter] 工具数量: ${tools?.length || 0}`)
        }

        try {
            const response = await axios.post(url, requestBody, {
                headers: {
                    'Authorization': `Bearer ${apiConfig.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
            })

            const data = response.data
            if (!data.choices || data.choices.length === 0) {
                throw new Error('API返回结果为空')
            }

            const choice = data.choices[0]
            const message = choice.message

            // 解析工具调用
            let toolCalls = null
            if (message.tool_calls && message.tool_calls.length > 0) {
                toolCalls = message.tool_calls.map(tc => ({
                    id: tc.id,
                    type: tc.type,
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }))
            }

            if (Config.getConfig()?.smartMode?.tools?.debugLog) {
                logger.mark(`[ModelRouter] 响应完成，工具调用: ${toolCalls ? toolCalls.length : 0}个`)
                if (message.content) {
                    logger.mark(`[ModelRouter] 回复长度: ${message.content.length}字符`)
                }
            }

            return {
                content: message.content || '',
                toolCalls,
                reasoning_content: message.reasoning_content || choice.reasoning_content,
                sources: data.sources
            }
        } catch (error) {
            const safeError = hidePrivacyInfo(error.message)
            logger.error(`[ModelRouter] ${purpose} 请求失败: ${safeError}`)
            throw error
        }
    }

    /**
     * @description: 获取所有可用的模型名称列表（用于Guoba配置）
     * @return {Array} 模型名称数组
     */
    getAvailableModelOptions() {
        const config = Config.getConfig()
        const apiList = config.smart_APIList || []
        
        const options = [
            { label: '🤖 使用智能模式默认模型', value: 'default' }
        ]

        // 从 API 列表中提取所有模型
        apiList.forEach(api => {
            if (api.name) {
                const label = `🔧 ${api.name} (${api.model || '未指定模型'})`
                options.push({
                    label,
                    value: api.name
                })
            }
        })

        return options
    }

    /**
     * @description: 获取用于Guoba配置的模型选择器字段
     * @return {Array} Guoba字段配置数组
     */
    getGuobaModelSelectors() {
        const options = this.getAvailableModelOptions()
        
        return [
            {
                field: 'smartMode.modelRouting.toolCall',
                label: '工具调用模型',
                component: 'Select',
                helpMessage: '用于判断是否需要调用工具、选择工具的模型。建议使用支持 Function Calling 的模型，如 GPT-4o、Claude 3.5、DeepSeek-V3',
                componentProps: { options }
            },
            {
                field: 'smartMode.modelRouting.vision',
                label: '视觉理解模型',
                component: 'Select',
                helpMessage: '用于理解图片内容的模型。建议选择 GPT-4o、Claude 3.5 Sonnet 等支持视觉的模型',
                componentProps: { options }
            },
            {
                field: 'smartMode.modelRouting.drawing',
                label: '画图生成模型',
                component: 'Select',
                helpMessage: '用于生成图片描述、优化画图的模型',
                componentProps: { options }
            },
            {
                field: 'smartMode.modelRouting.search',
                label: '搜索分析模型',
                component: 'Select',
                helpMessage: '用于分析搜索结果、提炼关键信息的模型',
                componentProps: { options }
            },
            {
                field: 'smartMode.modelRouting.chat',
                label: '最终回复模型',
                component: 'Select',
                helpMessage: '用于生成最终回复的模型。可以使用轻量级模型以降低成本',
                componentProps: { options }
            }
        ]
    }
}

// 单例导出
export const modelRouter = new ModelRouter()
