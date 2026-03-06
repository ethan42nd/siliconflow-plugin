import plugin from '../../../lib/plugins/plugin.js'
import Render from '../components/Render.js'
import { style } from '../resources/help/imgs/config.js'
import _ from 'lodash'

export class help extends plugin {
    constructor() {
        super({
            /** 功能名称 */
            name: 'SF-PLUGIN-帮助',
            /** 功能描述 */
            dsc: 'SF-PLUGIN帮助',
            event: 'message',
            /** 优先级，数字越小等级越高 */
            priority: 1009,
            rule: [
                {
                    /** 命令正则匹配 (原有帮助) */
                    reg: '^(/|#)(sf|SF|siliconflow)帮助$',
                    /** 执行方法 */
                    fnc: 'help'
                },
                {
                    /** 【新增】智能模块专属帮助 */
                    reg: '^(/|#)(sf|SF|siliconflow)智能帮助$',
                    fnc: 'smartHelp'
                }
            ]
        })
    }

    // ==========================================
    // 原有的基础帮助功能 (保持不变)
    // ==========================================
    async help(e) {
        const helpCfg = {
            "themeSet": false,
            "title": "SF-PLUGIN帮助",
            "subTitle": "Synaptic Fusion-对接万物",
            "colWidth": 265,
            "theme": "all",
            "themeExclude": [
                "default"
            ],
            "colCount": 2,
            "bgBlur": true
        }
        const helpList = [
            {
                "group": "SF-plugin帮助",
                "list": [
                    { "icon": 1, "title": "#mjp [描述]", "desc": "使用 MID_JOURNEY 绘画" },
                    { "icon": 5, "title": "#niji [描述]", "desc": "使用 NIJI_JOURNEY 绘画" },
                    { "icon": 8, "title": "#mjc [描述]", "desc": "引用一张图片,自动在提示词后添加--cref URL" },
                    { "icon": 2, "title": "#nic [描述]", "desc": "与mjc相同，会自动添加--niji参数生成二次元风格图片" },
                    { "icon": 7, "title": "#sf绘图 [描述]", "desc": "使用 Siliconflow 预设模型绘画" },
                    { "icon": 11, "title": "#sf绘图 [描述][横图]", "desc": "指定绘画参数 [横图|竖图|方图|512*512|步数20]" },
                    { "icon": 29, "title": "#dd [描述]", "desc": "使用openai格式的接口生成AI绘图" },
                    { "icon": 10, "title": "#sf预设列表", "desc": "#sf预设[添加|删除|查看]" },
                    { "icon": 54, "title": "#ss [对话]", "desc": "可用指令：#sf结束[全部|ss|gg|dd]对话" },
                    { "icon": 55, "title": "#gg [对话]", "desc": "使用 Gemini 搜索并回答问题" },
                    { "icon": 3, "title": "#sfss接口列表", "desc": "查看接口，#sfss使用接口[n] 每个用户独立" },
                    { "icon": 86, "title": "#sf删除[ss|gg]前[num]条对话", "desc": "设置生成提示词开关" },
                    { "icon": 61, "title": "#fish群号同传QQ号", "desc": "设置TTS同传，例如#fish56789同传12345" },
                    { "icon": 62, "title": "#fish查看配置", "desc": "查看当前fish同传配置信息" },
                    { "icon": 9, "title": "#直链 #删除直链[图链]", "desc": "获取/删除图片的直链地址" },
                    { "icon": 29, "title": "#即梦绘画帮助", "desc": "#即梦视频帮助" },
                ],
            },
            {
                "group": 'SF-plugin设置（请使用Guoba操作）',
                "list": [
                    { "icon": 3, "title": "#sf管理帮助", "desc": "获取 sf 管理员帮助 必看" },
                    { "icon": 91, "title": "#mjp帮助", "desc": "获取 mjp 帮助" },
                    { "icon": 39, "title": "#sfdd帮助", "desc": "获取DD绘图的帮助" },
                    { "icon": 60, "title": "#(fish)同传帮助", "desc": "获取 fish 同传帮助信息" },
                    { "icon": 92, "title": "#sf设置[ss|gg]图片模式 [开|关]", "desc": "设置ss和gg的图片回复模式" },
                    { "icon": 38, "title": "#sf更新", "desc": "更新本插件" },
                ]
            }
        ]
        
        return await this.renderHelp(e, helpCfg, helpList);
    }

    // ==========================================
    // 【新增】智能模块与记忆管理帮助
    // ==========================================
    async smartHelp(e) {
        const helpCfg = {
            "themeSet": false,
            "title": "SF-PLUGIN智能系统",
            "subTitle": "Agentic Memory & 智能互动",
            "colWidth": 265,
            "theme": "all",
            "themeExclude": [
                "default"
            ],
            "colCount": 2,
            "bgBlur": true
        }
        
        const helpList = [
            {
                "group": "🧠 智能记忆与个人侧写",
                "list": [
                    { "icon": 55, "title": "#我的记忆 / #我的档案", "desc": "查看当前大模型为你提炼的专属心理侧写档案" },
                    { "icon": 66, "title": "#提取记忆", "desc": "手动触发提取当前群内你的近期言论，生成画像" },
                    { "icon": 67, "title": "#修改记忆 [设定内容]", "desc": "强行覆写AI对你的记忆设定（例如：#修改记忆 我是首富）" },
                    { "icon": 68, "title": "#清空记忆", "desc": "彻底销毁你在本群的专属记忆档案与聊天缓存" },
                    { "icon": 69, "title": "#同步历史记忆 [天数]", "desc": "跨插件拉取过去N天的海量聊天记录，进行超深度测写" },
                    { "icon": 71, "title": "#同步历史记忆 [QQ]:[群号]", "desc": "(仅主人/私聊) 不打扰群友的跨群点杀测写调试" }
                ]
            },
            {
                "group": "🎭 智能互动与小黑屋系统",
                "list": [
                    { "icon": 21, "title": "群内戳一戳机器人", "desc": "随机触发文字回复、反向戳一戳、禁言或发送表情包" },
                    { "icon": 22, "title": "#哒咩 (回复某条消息)", "desc": "将机器人发出的尬聊文字或表情包撤回，并移入小黑屋拦截" },
                    { "icon": 23, "title": "#哒咩记录 [数量]", "desc": "以合并转发的形式，查看近期被拉黑的文本和图片" },
                    { "icon": 24, "title": "#哒咩[文本/图片]记录第[N]页", "desc": "分页查看历史小黑屋记录 (例: #哒咩文本记录第2页)" },
                    { "icon": 25, "title": "#群自动表情包配置", "desc": "查看当前群的自动表情收集状态和相关配置参数" },
                    { "icon": 26, "title": "#自动表情包[开启/关闭]", "desc": "手动管理本群的群聊表情包自动收集状态" }
                ]
            }
        ]

        return await this.renderHelp(e, helpCfg, helpList);
    }

    // ==========================================
    // 渲染方法抽离 (使两套帮助可以共用同一套底层渲染逻辑)
    // ==========================================
    async renderHelp(e, helpCfg, helpList) {
        let helpGroup = []
        _.forEach(helpList, (group) => {
            _.forEach(group.list, (help) => {
                let icon = help.icon * 1
                if (!icon) {
                    help.css = 'display:none'
                } else {
                    let x = (icon - 1) % 10
                    let y = (icon - x - 1) / 10
                    help.css = `background-position:-${x * 50}px -${y * 50}px`
                }
            })
            helpGroup.push(group)
        })

        let themeData = await this.getThemeData(helpCfg, helpCfg)
        return await Render.render('help/index', {
            helpCfg,
            helpGroup,
            ...themeData,
            element: 'default'
        }, { e, scale: 1.6 })
    }

    async getThemeCfg() {
        let resPath = '{{_res_path}}/help/imgs/'
        return {
            main: `${resPath}/main.png`,
            bg: `${resPath}/bg.jpg`,
            style: style
        }
    }

    async getThemeData(diyStyle, sysStyle) {
        let helpConfig = _.extend({}, sysStyle, diyStyle)
        let colCount = Math.min(5, Math.max(parseInt(helpConfig?.colCount) || 3, 2))
        let colWidth = Math.min(500, Math.max(100, parseInt(helpConfig?.colWidth) || 265))
        let width = Math.min(2500, Math.max(800, colCount * colWidth + 30))
        let theme = await this.getThemeCfg()
        let themeStyle = theme.style || {}
        let ret = [`
          body{background-image:url(${theme.bg});width:${width}px;}
          .container{background-image:url(${theme.main});width:${width}px;}
          .help-table .td,.help-table .th{width:${100 / colCount}%}
          `]
        let css = function (sel, css, key, def, fn) {
            let val = (function () {
                for (let idx in arguments) {
                    if (!_.isUndefined(arguments[idx])) {
                        return arguments[idx]
                    }
                }
            })(themeStyle[key], diyStyle[key], sysStyle[key], def)
            if (fn) {
                val = fn(val)
            }
            ret.push(`${sel}{${css}:${val}}`)
        }
        css('.help-title,.help-group', 'color', 'fontColor', '#ceb78b')
        css('.help-title,.help-group', 'text-shadow', 'fontShadow', 'none')
        css('.help-desc', 'color', 'descColor', '#eee')
        css('.cont-box', 'background', 'contBgColor', 'rgba(43, 52, 61, 0.8)')
        css('.cont-box', 'backdrop-filter', 'contBgBlur', 3, (n) => diyStyle.bgBlur === false ? 'none' : `blur(${n}px)`)
        css('.help-group', 'background', 'headerBgColor', 'rgba(34, 41, 51, .4)')
        css('.help-table .tr:nth-child(odd)', 'background', 'rowBgColor1', 'rgba(34, 41, 51, .2)')
        css('.help-table .tr:nth-child(even)', 'background', 'rowBgColor2', 'rgba(34, 41, 51, .4)')
        return {
            style: `<style>${ret.join('\n')}</style>`,
            colCount
        }
    }
}