import { AbstractTool } from './AbstractTool.js'
import fetch from 'node-fetch'

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

  async func(opts) {
    const { city, days = 1 } = opts

    if (!city?.trim()) {
      return '请提供城市名称'
    }

    let weatherData = null
    let lastError = ''

    try {
      weatherData = await this.getWeatherFromWttr(city)
      if (weatherData) return weatherData
    } catch (error) {
      lastError = error.message
      logger.debug(`[WeatherTool] wttr.in 获取失败: ${error.message}`)
    }

    try {
      weatherData = await this.getWeatherFromOpenMeteo(city, days)
      if (weatherData) return weatherData
    } catch (error) {
      lastError = error.message
      logger.debug(`[WeatherTool] Open-Meteo 获取失败: ${error.message}`)
    }

    return `抱歉，暂时无法获取"${city}"的天气信息。${lastError ? `(${lastError})` : ''}`
  }

  async getWeatherFromWttr(city) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`
      const response = await fetch(url, this.buildFetchOptions({
        headers: {
          'User-Agent': 'curl/7.68.0'
        },
        signal: controller.signal
      }, 'wttr'))
      clearTimeout(timeoutId)

      if (!response.ok) return null

      const data = await response.json()
      if (!data.current_condition?.length) {
        return null
      }

      const current = data.current_condition[0]
      const location = data.nearest_area?.[0]

      let textResult = `【${location?.areaName?.[0]?.value || city}天气】\n`
      textResult += `当前温度: ${current.temp_C}°C\n`
      textResult += `体感温度: ${current.FeelsLikeC}°C\n`
      textResult += `天气状况: ${current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知'}\n`
      textResult += `湿度: ${current.humidity}%\n`
      textResult += `风速: ${current.windspeedKmph} km/h`

      return textResult
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getWeatherFromOpenMeteo(city, days) {
    const geoController = new AbortController()
    const geoTimeout = setTimeout(() => geoController.abort(), 5000)

    let lat
    let lon
    let cityName

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`
      const geoResponse = await fetch(geoUrl, this.buildFetchOptions({ signal: geoController.signal }, 'open-meteo-geocoding'))
      clearTimeout(geoTimeout)

      if (!geoResponse.ok) return null
      const geoData = await geoResponse.json()
      if (!geoData.results?.length) return null

      const location = geoData.results[0]
      lat = location.latitude
      lon = location.longitude
      cityName = location.name
    } finally {
      clearTimeout(geoTimeout)
    }

    const weatherController = new AbortController()
    const weatherTimeout = setTimeout(() => weatherController.abort(), 5000)

    try {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${Math.min(days, 3)}`
      const response = await fetch(weatherUrl, this.buildFetchOptions({ signal: weatherController.signal }, 'open-meteo-weather'))
      clearTimeout(weatherTimeout)

      if (!response.ok) return null
      const data = await response.json()
      if (!data.current) return null

      const current = data.current
      let textResult = `【${cityName}天气】\n`
      textResult += `当前温度: ${current.temperature_2m}°C\n`
      textResult += `体感温度: ${current.apparent_temperature}°C\n`
      textResult += `天气状况: ${this.getWeatherDesc(current.weather_code)}\n`
      textResult += `湿度: ${current.relative_humidity_2m}%\n`
      textResult += `风速: ${current.wind_speed_10m} km/h`

      if (data.daily && days > 1) {
        textResult += '\n\n【未来预报】'
        for (let i = 1; i < Math.min(days, data.daily.time.length); i++) {
          textResult += `\n${data.daily.time[i]}: ${this.getWeatherDesc(data.daily.weather_code[i])}, ${data.daily.temperature_2m_min[i]}°C ~ ${data.daily.temperature_2m_max[i]}°C`
        }
      }

      return textResult
    } finally {
      clearTimeout(weatherTimeout)
    }
  }

  getWeatherDesc(code) {
    const weatherCodes = {
      0: '晴朗',
      1: ' mostly clear',
      2: ' partly cloudy',
      3: ' overcast',
      45: '雾',
      48: '雾凇',
      51: '毛毛雨',
      53: '中度毛毛雨',
      55: '大毛毛雨',
      56: '冻毛毛雨',
      57: '大冻毛毛雨',
      61: '小雨',
      63: '中雨',
      65: '大雨',
      66: '冻雨',
      67: '大冻雨',
      71: '小雪',
      73: '中雪',
      75: '大雪',
      77: '雪粒',
      80: '小阵雨',
      81: '中阵雨',
      82: '大阵雨',
      85: '小阵雪',
      86: '大阵雪',
      95: '雷雨',
      96: '雷雨伴冰雹',
      99: '大雷雨伴冰雹'
    }
    return weatherCodes[code] || '未知'
  }
}
