import { AbstractTool } from './AbstractTool.js'

/**
 * 音乐搜索工具类
 */
export class MusicTool extends AbstractTool {
    constructor() {
        super()
        this.name = 'musicTool'
        this.description = '搜索音乐并发送音乐卡片，当用户想听歌、点歌、搜歌时使用此工具'
        this.parameters = {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '歌曲名称'
                },
                singer: {
                    type: 'string',
                    description: '歌手名称（可选）'
                },
                platform: {
                    type: 'string',
                    enum: ['qq', '163'],
                    description: '音乐平台，qq=QQ音乐，163=网易云音乐',
                    default: 'qq'
                }
            },
            required: ['name']
        }
    }

    async func(opts, e) {
        const { name, singer = '', platform = 'qq' } = opts

        if (!name?.trim()) {
            return '请提供歌曲名称'
        }

        try {
            // 构建搜索关键词
            const keyword = singer ? `${name} ${singer}` : name

            if (platform === 'qq') {
                return await this.searchQQMusic(keyword, name, singer, e)
            } else {
                return await this.searchNeteaseMusic(keyword, name, singer, e)
            }
        } catch (error) {
            console.error('音乐搜索失败:', error)
            return `音乐搜索失败: ${error.message}`
        }
    }

    /**
     * 搜索 QQ 音乐
     */
    async searchQQMusic(keyword, name, singer, e) {
        try {
            const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?aggr=1&cr=1&flag_qc=0&p=1&n=5&w=${encodeURIComponent(keyword)}`
            const response = await fetch(searchUrl)
            const text = await response.text()
            const json = JSON.parse(text.match(/callback\((.*)\)/)?.[1] || '{}')

            const songs = json.data?.song?.list
            if (!songs || songs.length === 0) {
                return '未找到相关歌曲'
            }

            const song = songs[0]
            const musicData = {
                type: 'qq',
                id: song.songid,
                mid: song.songmid,
                name: song.songname,
                singer: song.singer.map(s => s.name).join('/')
            }

            // 发送音乐卡片
            await this.sendMusicCard(e, musicData)

            return {
                status: 'success',
                platform: 'QQ音乐',
                song: musicData.name,
                singer: musicData.singer
            }
        } catch (error) {
            console.error('QQ 音乐搜索失败:', error)
            return 'QQ 音乐搜索失败'
        }
    }

    /**
     * 搜索网易云音乐
     */
    async searchNeteaseMusic(keyword, name, singer, e) {
        try {
            const searchUrl = `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=5`
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })
            const json = await response.json()

            const songs = json.result?.songs
            if (!songs || songs.length === 0) {
                return '未找到相关歌曲'
            }

            const song = songs[0]
            const musicData = {
                type: '163',
                id: song.id,
                name: song.name,
                singer: song.artists.map(a => a.name).join('/')
            }

            // 发送音乐卡片
            await this.sendMusicCard(e, musicData)

            return {
                status: 'success',
                platform: '网易云音乐',
                song: musicData.name,
                singer: musicData.singer
            }
        } catch (error) {
            console.error('网易云音乐搜索失败:', error)
            return '网易云音乐搜索失败'
        }
    }

    /**
     * 发送音乐卡片
     */
    async sendMusicCard(e, musicData) {
        let musicMessage

        if (musicData.type === 'qq') {
            // QQ 音乐卡片
            musicMessage = {
                type: 'music',
                data: {
                    type: 'qq',
                    id: musicData.id
                }
            }
        } else {
            // 网易云音乐卡片
            musicMessage = {
                type: 'music',
                data: {
                    type: '163',
                    id: musicData.id
                }
            }
        }

        await e.reply(musicMessage)
    }
}
