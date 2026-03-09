import { AbstractTool } from './AbstractTool.js'

/**
 * 天气查询工具类
 */
export class WeatherTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'weatherTool'
        this.description = '查询指定城市的天气信息，当用户询问天气时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: '城市名称，如"北京"、"上海"、"广州"等'
                },
                days: {
                    type: 'number',
                    description: '预报天数，1-3天，默认1天',
                    default: 1,
                    minimum: 1,
                    maximum: 3
                }
            },
            required: ['city']
        }
    }

    async func(opts, e) {
        const { city, days = 1 } = opts

        if (!city?.trim()) {
            return '请提供城市名称'
        }

        try {
            // 使用和风天气 API（需要配置 key）
            // 这里提供一个免费的 API 示例
            const weatherData = await this.getWeatherData(city, days)

            if (!weatherData) {
                return `未找到 "${city}" 的天气信息，请检查城市名称是否正确`
            }

            return weatherData
        } catch (error) {
            console.error('天气查询失败:', error)
            return `天气查询失败: ${error.message}`
        }
    }

    /**
     * 获取天气数据（使用免费 API）
     */
    async getWeatherData(city, days) {
        try {
            // 使用 wttr.in 免费天气服务
            const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'curl/7.68.0'
                }
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const data = await response.json()

            if (!data.current_condition || data.current_condition.length === 0) {
                return null
            }

            const current = data.current_condition[0]
            const location = data.nearest_area?.[0]

            let result = {
                location: {
                    city: location?.areaName?.[0]?.value || city,
                    region: location?.region?.[0]?.value || '',
                    country: location?.country?.[0]?.value || ''
                },
                current: {
                    temperature: current.temp_C,
                    feels_like: current.FeelsLikeC,
                    humidity: current.humidity,
                    weather_desc: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知',
                    wind_speed: current.windspeedKmph,
                    wind_dir: current.winddir16Point,
                    visibility: current.visibility,
                    pressure: current.pressure,
                    uv_index: current.uvIndex
                },
                forecast: []
            }

            // 添加预报数据
            if (data.weather && days > 1) {
                for (let i = 1; i < Math.min(days, data.weather.length); i++) {
                    const day = data.weather[i]
                    result.forecast.push({
                        date: day.date,
                        max_temp: day.maxtempC,
                        min_temp: day.mintempC,
                        avg_temp: day.avgtempC,
                        weather_desc: day.hourly?.[4]?.lang_zh?.[0]?.value || day.hourly?.[4]?.weatherDesc?.[0]?.value || '未知'
                    })
                }
            }

            // 格式化为文本
            let textResult = `【${result.location.city}天气】\n`
            textResult += `当前温度: ${result.current.temperature}°C\n`
            textResult += `体感温度: ${result.current.feels_like}°C\n`
            textResult += `天气状况: ${result.current.weather_desc}\n`
            textResult += `湿度: ${result.current.humidity}%\n`
            textResult += `风速: ${result.current.wind_speed} km/h (${result.current.wind_dir})\n`
            textResult += `能见度: ${result.current.visibility} km\n`
            textResult += `气压: ${result.current.pressure} hPa\n`
            textResult += `紫外线指数: ${result.current.uv_index}`

            if (result.forecast.length > 0) {
                textResult += '\n\n【未来预报】'
                for (const day of result.forecast) {
                    textResult += `\n${day.date}: ${day.weather_desc}, ${day.min_temp}°C ~ ${day.max_temp}°C`
                }
            }

            return textResult
        } catch (error) {
            console.error('获取天气数据失败:', error)
            return null
        }
    }
}
