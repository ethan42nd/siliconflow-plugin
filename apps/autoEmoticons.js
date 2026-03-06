import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import { getBotByQQ } from '../utils/onebotUtils.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// 存储各群表情列表的缓存
const emojiListCache = new Map()

// 存储共享图片列表的缓存
const sharedPicturesCache = []

// 存储目录监视器
const watchers = new Map()

// 共享图片目录监视器
let sharedPicturesWatcher = null

/**
 * 检查当前时间是否在允许的生效时间范围内 (增强版：强制北京时间 + 容错)
 * @param {Object} config 配置对象
 * @returns {boolean}
 */
function isWithinActiveTime(config) {
    if (!config.autoEmoticons.timeRestrictionEnabled) return true;

    // 获取当前的 UTC+8 (北京时间) 时间，无视服务器本地时区
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijingTime = new Date(utc + (3600000 * 8));

    const currentTime = beijingTime.getHours() * 60 + beijingTime.getMinutes();

    const parseTime = (timeVal) => {
        if (!timeVal) return 0;
        const timeStr = String(timeVal); // 强制转换为字符串，防止在 yaml 里错填成纯数字
        if (!timeStr.includes(':')) {
            return (Number(timeStr) || 0) * 60;
        }
        const [hours, minutes] = timeStr.split(':').map(Number);
        return (hours || 0) * 60 + (minutes || 0);
    };

    const startTime = parseTime(config.autoEmoticons.activeStartTime || "08:00");
    const endTime = parseTime(config.autoEmoticons.activeEndTime || "23:00");

    if (startTime <= endTime) {
        // 正常白天区间：如 08:00 - 23:00
        return currentTime >= startTime && currentTime <= endTime;
    } else {
        // 跨夜区间：如 22:00 - 06:00 (大于晚上10点，或小于早上6点)
        return currentTime >= startTime || currentTime <= endTime;
    }
}

/**
 * 初始化共享图片目录监视器
 */
function initSharedPicturesWatcher() {
    if (sharedPicturesWatcher) return

    const sharedPicturesDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures')

    // 确保目录存在
    if (!fs.existsSync(sharedPicturesDir)) {
        fs.mkdirSync(sharedPicturesDir, { recursive: true })
    }

    // 递归读取所有图片文件
    function loadSharedPictures(dir) {
        const pictures = []
        try {
            const items = fs.readdirSync(dir, { withFileTypes: true })
            for (const item of items) {
                const fullPath = path.join(dir, item.name)
                if (item.isDirectory()) {
                    // 递归处理子目录
                    pictures.push(...loadSharedPictures(fullPath))
                } else if (item.isFile()) {
                    // 检查是否为图片文件
                    const ext = path.extname(item.name).toLowerCase()
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
                        pictures.push(fullPath)
                    }
                }
            }
        } catch (err) {
            logger.error(`[autoEmoticons] 读取共享图片目录失败: ${err}`)
        }
        return pictures
    }

    // 初始加载共享图片
    const initialPictures = loadSharedPictures(sharedPicturesDir)
    sharedPicturesCache.splice(0, sharedPicturesCache.length, ...initialPictures)
    logger.info(`[autoEmoticons] 已加载 ${sharedPicturesCache.length} 个共享图片`)

    // 创建监视器
    sharedPicturesWatcher = chokidar.watch(sharedPicturesDir, {
        persistent: true,
        ignoreInitial: true,
        recursive: true, // 递归监视子目录
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    })

    // 监听文件添加事件
    sharedPicturesWatcher.on('add', (filepath) => {
        const ext = path.extname(filepath).toLowerCase()
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
            if (!sharedPicturesCache.includes(filepath)) {
                sharedPicturesCache.push(filepath)
                logger.debug(`[autoEmoticons] 监测到新共享图片: ${path.relative(sharedPicturesDir, filepath)}`)
            }
        }
    })

    // 监听文件删除事件
    sharedPicturesWatcher.on('unlink', (filepath) => {
        const index = sharedPicturesCache.indexOf(filepath)
        if (index > -1) {
            sharedPicturesCache.splice(index, 1)
            logger.debug(`[autoEmoticons] 监测到共享图片删除: ${path.relative(sharedPicturesDir, filepath)}`)
        }
    })

    // 监听错误事件
    sharedPicturesWatcher.on('error', (error) => {
        logger.error(`[autoEmoticons] 共享图片目录监视器错误: ${error}`)
    })
}

/**
 * 获取可用的图片列表（群专属 + 共享图片）
 * @param {string} groupId 群号
 * @returns {Array} 图片路径列表
 */
export function getAvailablePictures(groupId) {
    const groupEmojis = emojiListCache.get(String(groupId)) || []
    const emojiSaveDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'emoji_save', String(groupId))

    // 群专属表情的完整路径
    const groupEmojiPaths = groupEmojis.map(filename => path.join(emojiSaveDir, filename))

    // 合并群专属表情和共享图片
    return [...groupEmojiPaths, ...sharedPicturesCache]
}

/**
 * 初始化表情目录监视器
 * @param {string} groupId 群号
 */
function initWatcher(groupId) {
    // 如果已有监视器，则返回
    if (watchers.has(groupId)) return

    const emojiSaveDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'emoji_save', `${groupId}`)

    // 确保目录存在
    if (!fs.existsSync(emojiSaveDir)) {
        fs.mkdirSync(emojiSaveDir, { recursive: true })
    }

    // 初始化表情列表缓存
    if (!emojiListCache.has(groupId)) {
        emojiListCache.set(groupId, [])
    }

    // 读取初始表情列表
    try {
        const files = fs.readdirSync(emojiSaveDir)
        emojiListCache.set(groupId, files)
        logger.info(`[autoEmoticons] 已加载群 ${groupId} 的 ${files.length} 个表情`)
    } catch (err) {
        logger.error(`[autoEmoticons] 读取表情目录失败: ${err}`)
    }

    // 创建监视器
    const watcher = chokidar.watch(emojiSaveDir, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    })

    // 监听文件添加事件
    watcher.on('add', (filepath) => {
        const filename = path.basename(filepath)
        const emojiList = emojiListCache.get(groupId) || []
        if (!emojiList.includes(filename)) {
            emojiList.push(filename)
            emojiListCache.set(groupId, emojiList)
            logger.debug(`[autoEmoticons] 监测到新表情: ${filename}`)
        }
    })

    // 监听文件删除事件
    watcher.on('unlink', (filepath) => {
        const filename = path.basename(filepath)
        const emojiList = emojiListCache.get(groupId) || []
        const index = emojiList.indexOf(filename)
        if (index > -1) {
            emojiList.splice(index, 1)
            emojiListCache.set(groupId, emojiList)
            logger.debug(`[autoEmoticons] 监测到表情删除: ${filename}`)
        }
    })

    // 监听错误事件
    watcher.on('error', (error) => {
        logger.error(`[autoEmoticons] 目录监视器错误: ${error}`)
    })

    // 保存监视器
    watchers.set(groupId, watcher)
}

const useEmojiSave_Switch = Config.getConfig().autoEmoticons?.useEmojiSave;

/**
 * 自动表情包插件
 */
export class autoEmoticons extends plugin {
    constructor() {
        const regStr = useEmojiSave_Switch ? "" : `sf-plugin-autoEmoticons-${Math.floor(10000 + Math.random() * 90000)}`;
        super({
            name: '自动表情包',
            dsc: '自动保存群聊中多次出现的图片作为表情包，并随机发送',
            event: 'message.group', // 恢复只监听群消息
            priority: -5000,
            rule: [
                {
                    reg: regStr,
                    fnc: 'autoEmoticonsTrigger',
                    log: false
                },
                // 【新增】监听哒咩记录等一系列指令
                {
                    event: 'message.group',
                    reg: '^#?(哒|达)咩(文本|图片)?记录(第\\d+页|\\d+)?$',
                    fnc: 'showDamieRecord',
                },
                {
                    reg: '^#?(哒|达)咩$',
                    fnc: 'deleteEmoji',
                },
                {
                    reg: '^#群自动表情包配置$',
                    fnc: 'showConfig',
                },
                {
                    reg: '^#自动表情包(开启|关闭)$',
                    fnc: 'toggleGroupEmoticons',
                }
            ],
        })
        this.task = [
            {
                // 每5分钟执行一次
                cron: '0 */5 * * * *',
                name: '自动表情包-发送表情',
                fnc: this.sendimg.bind(this),
                log: false
            },
        ]
    }

    async autoEmoticonsTrigger(e) {
        this.saveAndSendEmoji(e);
        // 继续执行后续插件
        return false;
    }

    async saveAndSendEmoji(e) {
        if (!useEmojiSave_Switch) return false
        const config = Config.getConfig()
        if (!e.isGroup) return false
        // 检查群号是否在允许列表中（如果配置了特定群号）
        const groupId = String(e.group_id)
        if (config.autoEmoticons.allowGroups.length > 0 && !config.autoEmoticons.allowGroups.includes(groupId)) {
            return false
        }

        // 初始化该群的监视器和共享图片监视器
        initWatcher(groupId)
        initSharedPicturesWatcher()

        // 获取表情保存目录路径
        const emojiSaveDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'emoji_save', `${groupId}`)

        // 从缓存获取表情列表
        const emojiList = emojiListCache.get(groupId) || []

        // 处理消息中的图片
        for (const item of e.message) {
            if (item.type === 'image') {
                // 检查图片大小，如果没有file_size字段则直接处理
                if (item.file_size && item.file_size >= (config.autoEmoticons.maxEmojiSize * 1024 * 1024)) continue

                // 获取图片唯一ID - 优先使用filename字段
                const fileUnique = item.filename
                    ? item.filename.split('.')[0]
                    : item.file.split('/').pop().split('.')[0] || item.url.split('/').pop().split('.')[0]

                try {
                    // 检查是否在黑名单中（过大的图片/已#哒咩 过的不再下载）
                    const blockKey = `Yz:autoEmoticons:blocked:${fileUnique}`
                    const isBlocked = await redis.get(blockKey)
                    if (isBlocked) {
                        logger.debug(`[autoEmoticons] 不下载已知过大的表情/图片: ${fileUnique}`)
                        continue
                    }

                    // 从filename获取图片类型，如果没有则从URL获取或默认使用jpg
                    const imgType = item.filename
                        ? item.filename.split('.').pop()
                        : (item.file.split('.').pop() || 'jpg')
                    const filename = `${fileUnique}.${imgType}`

                    // 检查是否已经保存过此表情
                    if (!emojiList.includes(`${fileUnique}.jpg`) && !emojiList.includes(`${filename}`)) {
                        let canBeStored = false
                        // 检查Redis中是否已有记录
                        const redisKey = `Yz:autoEmoticons:${groupId}:${fileUnique}`
                        const currentCount = await redis.get(redisKey)

                        if (!currentCount) {
                            // 首次发现，设置为1并设置过期时间
                            await redis.set(redisKey, '1', {
                                EX: config.autoEmoticons.expireTimeInSeconds
                            })
                            logger.debug(`[autoEmoticons] 表情首次出现: ${fileUnique} (1/${config.autoEmoticons.confirmCount})`)
                        } else {
                            // 增加计数
                            const newCount = parseInt(currentCount) + 1
                            await redis.set(redisKey, String(newCount), {
                                EX: config.autoEmoticons.expireTimeInSeconds
                            })

                            // 检查是否达到保存阈值
                            if (newCount >= config.autoEmoticons.confirmCount) {
                                // 达到指定次数，可以保存
                                await redis.del(redisKey)
                                canBeStored = true
                                logger.debug(`[autoEmoticons] 已达到确认次数: ${fileUnique} (${config.autoEmoticons.confirmCount}/${config.autoEmoticons.confirmCount})`)
                            } else {
                                logger.debug(`[autoEmoticons] 表情再次出现: ${fileUnique} (${newCount}/${config.autoEmoticons.confirmCount})`)
                            }
                        }

                        if (!canBeStored) continue
                        // 保存表情
                        // logger.mark(`[autoEmoticons] 保存表情: ${filename}`)

                        // 使用URL下载图片
                        const downloadResult = await downloadImageFile(
                            item.url,
                            `emoji_save/${groupId}/${fileUnique}`,
                            config.autoEmoticons.maxEmojiSize
                        )

                        if (!downloadResult.success) {
                            logger.error(`[autoEmoticons] 下载表情失败: ${downloadResult.error}`)

                            // 如果是因为文件过大而失败，添加到黑名单
                            if (downloadResult.error && downloadResult.error.includes('文件过大')) {
                                const ONE_MONTH_IN_SECONDS = 30 * 24 * 60 * 60 // 30天的秒数
                                await redis.set(blockKey, '1', {
                                    EX: ONE_MONTH_IN_SECONDS
                                })
                                logger.mark(`[autoEmoticons] 表情文件过大，已加入黑名单: ${fileUnique}，大小: ${downloadResult.size}，30天内不再下载`)
                            }
                            continue
                        }

                        const actualFilename = `${fileUnique}.${downloadResult.actualExt}`
                        logger.mark(`[autoEmoticons] 保存表情成功: ${actualFilename}，大小: ${downloadResult.size} 字节`)


                        // 控制表情数量
                        if (emojiList.length > config.autoEmoticons.maxEmojiCount) {
                            const randomIndex = Math.floor(Math.random() * emojiList.length)
                            const fileToDelete = emojiList[randomIndex]
                            try {
                                fs.unlinkSync(path.join(emojiSaveDir, fileToDelete))
                                logger.debug(`[autoEmoticons] 表情数量过多，删除: ${fileToDelete}`)
                            } catch (err) {
                                logger.error(`[autoEmoticons] 删除表情失败: ${err}`)
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`[autoEmoticons] 处理表情出错: ${error}`)
                }
            }
        }

        // 检查群发送冷却时间
        const cooldownKey = `Yz:autoEmoticons:cooldown:${groupId}`
        const lastSendTime = await redis.get(cooldownKey)
        const now = Date.now()

        // 【新增时间拦截】如果不在活跃时间内，直接终止发送逻辑
        if (!isWithinActiveTime(config)) {
            return false;
        }

        if (lastSendTime && (now - parseInt(lastSendTime)) < (config.autoEmoticons.sendCD * 1000)) {
            const remainingTime = Math.ceil(((parseInt(lastSendTime) + (config.autoEmoticons.sendCD * 1000)) - now) / 1000)
            logger.debug(`[autoEmoticons] 群 ${groupId} 还在冷却中，剩余 ${remainingTime} 秒`)
            return false
        }

        // 随机发送表情包（包含共享图片）
        const availablePictures = getAvailablePictures(groupId)
        if (Math.random() < config.autoEmoticons.replyRate && availablePictures.length > 0) {
            let msgRet, msgRet_id
            try {
                // 设置冷却时间
                await redis.set(cooldownKey, String(now), { EX: config.autoEmoticons.sendCD })

                // 随机选择一个图片
                const randomIndex = Math.floor(Math.random() * availablePictures.length)
                const picturePath = availablePictures[randomIndex]

                // 添加随机延迟
                const delay = randomInt(config.autoEmoticons.replyDelay.min, config.autoEmoticons.replyDelay.max)
                logger.mark(`[autoEmoticons] 群${e.group_id} 将在${delay}毫秒后发送表情包`)
                await sleep(delay)

                // 发送图片
                msgRet = await e.reply(segment.image(picturePath))
                msgRet_id = msgRet.seq || msgRet.data?.message_id || msgRet.time

                // 存储文件信息（用于删除功能）
                const isSharedPicture = sharedPicturesCache.includes(picturePath)
                const fileInfo = isSharedPicture
                    ? `shared:${path.relative(path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures'), picturePath)}`
                    : path.basename(picturePath)

                redis.set(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${msgRet_id}`, fileInfo, { EX: 60 * 60 * 24 * 1 })
                logger.debug(`[autoEmoticons] 概率发送图片成功: ${picturePath}`)
            } catch (error) {
                logger.error(`[autoEmoticons] 发送图片失败: ${error}`)
            }
        }

        return false
    }

    /** 用于戳一戳等 主动发送表情包 */
    async sendimg_Active(e) {
        const groupId = String(e.group_id)
        // 初始化共享图片监视器
        initSharedPicturesWatcher()
        // 初始化该群的监视器
        initWatcher(groupId);
        try {
            // 获取可用图片列表（群专属 + 共享）
            const availablePictures = getAvailablePictures(groupId)
            // 如果没有可用图片，跳过此群
            if (availablePictures.length === 0) {
                logger.debug(`[autoEmoticons] 主动发送图片到群 ${groupId} 没有可用图片，跳过`);
                return false;
            }
            // 随机选择一个图片
            const randomIndex = Math.floor(Math.random() * availablePictures.length);
            const picturePath = availablePictures[randomIndex];
            // 发送图片
            try {
                const msgRet = await e.reply(segment.image(picturePath));
                const msgId = msgRet.seq || msgRet.data?.message_id || msgRet.time

                // 存储文件信息
                const isSharedPicture = sharedPicturesCache.includes(picturePath)
                const fileInfo = isSharedPicture
                    ? `shared:${path.relative(path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures'), picturePath)}`
                    : path.basename(picturePath)

                await redis.set(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${msgId}`, fileInfo, {
                    EX: 60 * 60 * 24 * 1
                });
                logger.info(`[autoEmoticons] 主动发送图片到群 ${groupId}: ${picturePath}`);
            } catch (error) {
                logger.error(`[autoEmoticons] 主动发送图片到群 ${groupId} 失败: ${error}`);
            }
        } catch (error) {
            logger.error(`[autoEmoticons] 主动发送 ${groupId} 表情包出错: ${error}`);
        }
        return true;
    }

    async sendimg() {
        if (!useEmojiSave_Switch) return false;
        const config = Config.getConfig()

        // 【新增时间拦截】如果不在活跃时间内，定时任务直接罢工
        if (!isWithinActiveTime(config)) {
            return false;
        }

        // 初始化共享图片监视器
        initSharedPicturesWatcher()

        // 遍历配置的群列表
        for (const groupId of config.autoEmoticons.allowGroups) {
            try {
                // 检查群发送冷却时间
                const cooldownKey = `Yz:autoEmoticons:cooldown:${groupId}`
                const lastSendTime = await redis.get(cooldownKey)
                const now = Date.now()

                if (lastSendTime && (now - parseInt(lastSendTime)) < (config.autoEmoticons.sendCD * 1000)) {
                    const remainingTime = Math.ceil(((parseInt(lastSendTime) + (config.autoEmoticons.sendCD * 1000)) - now) / 1000)
                    logger.debug(`[autoEmoticons] 群 ${groupId} 还在冷却中，剩余 ${remainingTime} 秒`)
                    continue
                }

                // 使用与手动触发相同的概率判断
                if (Math.random() >= config.autoEmoticons.replyRate) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 随机概率未触发发送`);
                    continue;
                }

                // 初始化该群的监视器
                initWatcher(groupId);

                // 获取可用图片列表（群专属 + 共享）
                const availablePictures = getAvailablePictures(groupId)

                // 如果没有可用图片，跳过此群
                if (availablePictures.length === 0) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 没有可用图片，跳过`);
                    continue;
                }

                // 随机选择一个图片
                const randomIndex = Math.floor(Math.random() * availablePictures.length);
                const picturePath = availablePictures[randomIndex];

                // 发送图片
                try {
                    // 设置冷却时间
                    await redis.set(cooldownKey, String(now), { EX: config.autoEmoticons.sendCD })

                    const group = getBotByQQ(config.autoEmoticons.getBotByQQ_targetQQArr).pickGroup(parseInt(groupId));
                    if (!group) {
                        logger.error(`[autoEmoticons] 无法获取群 ${groupId} 的实例`);
                        continue;
                    }

                    // 添加随机延迟
                    const delay = randomInt(config.autoEmoticons.replyDelay.min, config.autoEmoticons.replyDelay.max)
                    logger.mark(`[autoEmoticons] 群${groupId} 将在${(delay / 1000).toFixed(0)}秒后发送表情包 ${picturePath}`)
                    await sleep(delay)

                    const msgRet = await group.sendMsg(segment.image(picturePath));
                    const msgId = msgRet.seq || msgRet.data?.message_id || msgRet.time

                    // 存储文件信息
                    const isSharedPicture = sharedPicturesCache.includes(picturePath)
                    const fileInfo = isSharedPicture
                        ? `shared:${path.relative(path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures'), picturePath)}`
                        : path.basename(picturePath)

                    await redis.set(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${msgId}`, fileInfo, {
                        EX: 60 * 60 * 24 * 1
                    });

                    // logger.info(`[autoEmoticons] 定时任务发送图片到群 ${groupId}: ${picturePath}`);
                } catch (error) {
                    logger.error(`[autoEmoticons] 定时任务发送图片到群 ${groupId} 失败: ${error}`);
                }
            } catch (error) {
                logger.error(`[autoEmoticons] 处理群 ${groupId} 定时发送任务出错: ${error}`);
            }
        }

        return false;
    }

    /**
     * 显示哒咩记录（支持翻页、指定数量和合并转发）
     */
    async showDamieRecord(e) {
        const msg = e.msg;
        let type = 'all'; 
        if (msg.includes('文本')) type = 'text';
        if (msg.includes('图片')) type = 'image';

        let page = 1;
        let count = 3;

        // 解析指定页数或数量
        const pageMatch = msg.match(/第(\d+)页/);
        if (pageMatch) {
            page = parseInt(pageMatch[1]) || 1;
            count = 10; // 翻页模式固定每页 10 条
        } else {
            const countMatch = msg.match(/记录(\d+)$/);
            if (countMatch) {
                count = parseInt(countMatch[1]) || 3;
                count = Math.min(count, 10); // 最多不超过 10 条防止过载
            }
        }

        const recycleBinPath = path.join(process.cwd(), 'data', 'autoEmoticons', 'recycle_bin');
        const recycleTextPath = path.join(process.cwd(), 'data', 'autoEmoticons', 'recycle_bin_text.txt');

        let texts = [];
        let images = [];

        // 1. 读取并解析文本记录
        if (fs.existsSync(recycleTextPath)) {
            const content = fs.readFileSync(recycleTextPath, 'utf-8');
            // 按行分割，过滤空行，反转数组让最新拉黑的展示在最前面
            texts = content.split('\n').filter(Boolean).reverse(); 
        }

        // 2. 读取并解析图片记录
        if (fs.existsSync(recycleBinPath)) {
            const files = fs.readdirSync(recycleBinPath);
            images = files.filter(f => ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(path.extname(f).toLowerCase()))
                          .map(f => {
                              // 从类似 "1712345678900_图片名.jpg" 的文件名中提取时间戳进行排序
                              const parts = f.split('_');
                              const ts = parseInt(parts[0]) || 0;
                              return { name: f, time: ts, fullPath: path.join(recycleBinPath, f) };
                          })
                          .sort((a, b) => b.time - a.time); // 按时间倒序，最新的在前
        }

        const totalTexts = texts.length;
        const totalImages = images.length;

        let forwardMsg = []; // 用于装填合并转发内容的消息数组
        
        // 统计信息首位展示
        forwardMsg.push(`📊 哒咩回收站统计\n━━━━━━━━━━━━━━\n📝 文本拦截: ${totalTexts} 条\n🖼️ 图片拦截: ${totalImages} 张`);

        // 根据指令类型组装不同的展现内容
        if (type === 'all') {
            forwardMsg.push(`--- 最近 ${count} 条文本记录 ---`);
            const showTexts = texts.slice(0, count);
            if (showTexts.length > 0) {
                showTexts.forEach(t => forwardMsg.push(t));
            } else {
                forwardMsg.push("暂无文本记录");
            }

            forwardMsg.push(`--- 最近 ${count} 张图片记录 ---`);
            const showImages = images.slice(0, count);
            if (showImages.length > 0) {
                showImages.forEach(img => {
                    forwardMsg.push(segment.image(img.fullPath));
                });
            } else {
                forwardMsg.push("暂无图片记录");
            }

        } else if (type === 'text') {
            const maxPage = Math.ceil(totalTexts / 10) || 1;
            page = Math.min(page, maxPage);
            const start = (page - 1) * 10;
            const end = start + 10;
            const showTexts = texts.slice(start, end);

            forwardMsg.push(`📝 文本哒咩记录 (第 ${page}/${maxPage} 页)`);
            if (showTexts.length > 0) {
                showTexts.forEach((t, idx) => forwardMsg.push(`${start + idx + 1}. ${t}`));
            } else {
                forwardMsg.push("暂无文本记录");
            }

        } else if (type === 'image') {
            const maxPage = Math.ceil(totalImages / 10) || 1;
            page = Math.min(page, maxPage);
            const start = (page - 1) * 10;
            const end = start + 10;
            const showImages = images.slice(start, end);

            forwardMsg.push(`🖼️ 图片哒咩记录 (第 ${page}/${maxPage} 页)`);
            if (showImages.length > 0) {
                showImages.forEach((img, idx) => {
                    // 将编号文本和图片拼在一个气泡里
                    forwardMsg.push([`编号 ${start + idx + 1}:\n`, segment.image(img.fullPath)]);
                });
            } else {
                forwardMsg.push("暂无图片记录");
            }
        }

        // 3. 制作标准合并转发消息节点
        let forwardNode = [];
        for (let msg of forwardMsg) {
            forwardNode.push({
                user_id: Bot.uin,
                nickname: Bot.nickname,
                message: msg
            });
        }

        try {
            let replyMsg;
            if (e.isGroup) {
                replyMsg = await e.group.makeForwardMsg(forwardNode);
            } else {
                replyMsg = await e.friend.makeForwardMsg(forwardNode);
            }
            // 发送组装好的合并转发消息
            await e.reply(replyMsg);
        } catch (err) {
            logger.error(`[哒咩记录] 生成合并转发失败: ${err}`);
            await e.reply("合并转发消息生成失败，可能是当前框架或协议端暂不支持。");
        }
        
        return true;
    }
    
    /**
     * 将表情包或戳一戳的文字移入回收站
     */
    async deleteEmoji(e) {
        const groupId = String(e.group_id)
        if (!e.isGroup || !e.isMaster) return false;

        const replyMsgId = e.source?.seq || e.reply_id;
        if (!replyMsgId) {
            return false;
        }

        // ==============================
        // 1. 尝试查找是否为图片消息
        // ==============================
        const fileInfo = await redis.get(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${replyMsgId}`);
        if (fileInfo) {
            try {
                let filePath;
                let fileUnique = null;
                let isShared = false;

                if (fileInfo.startsWith('shared:')) {
                    isShared = true;
                    const relPath = fileInfo.substring(7);
                    filePath = path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures', relPath);
                    fileUnique = path.basename(filePath, path.extname(filePath));
                } else {
                    filePath = path.join(process.cwd(), 'data', 'autoEmoticons', 'emoji_save', groupId, fileInfo);
                    fileUnique = path.basename(fileInfo, path.extname(fileInfo));
                }

                if (filePath && fs.existsSync(filePath)) {
                    const filename = path.basename(filePath);
                    const recycleBinPath = path.join(process.cwd(), 'data', 'autoEmoticons', 'recycle_bin');
                    if (!fs.existsSync(recycleBinPath)) {
                        fs.mkdirSync(recycleBinPath, { recursive: true });
                    }
                    const targetPath = path.join(recycleBinPath, `${Date.now()}_${filename}`);
                    
                    try {
                        fs.renameSync(filePath, targetPath);
                    } catch(err) {
                        fs.copyFileSync(filePath, targetPath);
                        fs.unlinkSync(filePath);
                    }
                    logger.mark(`[autoEmoticons] 图片已移入回收站: ${targetPath}`);

                    if (isShared) {
                        const index = sharedPicturesCache.indexOf(filePath);
                        if (index > -1) sharedPicturesCache.splice(index, 1);
                    } else {
                        const emojiList = emojiListCache.get(groupId) || [];
                        const index = emojiList.indexOf(filename);
                        if (index > -1) {
                            emojiList.splice(index, 1);
                            emojiListCache.set(groupId, emojiList);
                        }
                    }

                    if (fileUnique) {
                        const blockKey = `Yz:autoEmoticons:blocked:${fileUnique}`
                        await redis.set(blockKey, '1', { EX: 30 * 24 * 60 * 60 })
                    }

                    let res = await e.group.recallMsg(replyMsgId)
                    if (!res) this.reply("人家不是管理员，不能撤回超过2分钟的消息呢~")
                    await e.reply(`呜呜呜~人家错了，图片已经被关进小黑屋了~`);
                } else {
                    await e.reply("文件好像已经被删除了，找不到它呢。");
                }
                await redis.del(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${replyMsgId}`);
            } catch (error) {
                logger.error(`[autoEmoticons] 图片移入回收站失败: ${error}`);
            }
            return true;
        }

        // ==============================
        // 2. 尝试查找是否为文字消息
        // ==============================
        const textContent = await redis.get(`Yz:autoEmoticons.sent:text_content:${groupId}:${replyMsgId}`);
        if (textContent) {
            try {
                // 执行撤回
                let res = await e.group.recallMsg(replyMsgId);
                if (!res) this.reply("人家不是管理员，不能撤回超过2分钟的消息呢~");

                // 从 Config.js 中读取并修改配置
                let config = Config.getConfig();
                if (config.pokeConfig && config.pokeConfig.word_list) {
                    let words = config.pokeConfig.word_list.split('\n').map(w => w.trim()).filter(Boolean);
                    const index = words.indexOf(textContent);
                    if (index > -1) {
                        words.splice(index, 1);
                        config.pokeConfig.word_list = words.join('\n');
                        Config.setConfig(config); // 动态保存配置，实时生效
                        logger.mark(`[autoEmoticons] 已从戳一戳词库中移除: ${textContent}`);
                    }
                }

                // 写入文本回收站 (追加到文件末尾)
                const recycleTextPath = path.join(process.cwd(), 'data', 'autoEmoticons', 'recycle_bin_text.txt');
                const timeStr = new Date().toLocaleString('zh-CN', { hour12: false });
                fs.appendFileSync(recycleTextPath, `[${timeStr}] ${textContent}\n`);

                await e.reply(`这句台词太尬了，我已经把它丢进文本回收站啦！`);
                await redis.del(`Yz:autoEmoticons.sent:text_content:${groupId}:${replyMsgId}`);
            } catch (error) {
                logger.error(`[autoEmoticons] 文字移入回收站失败: ${error}`);
            }
            return true;
        }

        logger.mark(`[autoEmoticons] 该消息既不是本插件发送的图片，也不是本插件发送的文字`);
        return false;
    }

    /**
     * 显示表情包配置信息
     */
    async showConfig(e) {
        if (!e.isGroup || !e.isMaster) {
            await e.reply('只有主人可以查看配置哦~')
            return true
        }

        const config = Config.getConfig()
        const groupId = String(e.group_id)

        // 获取当前群的表情数量
        const emojiList = emojiListCache.get(groupId) || []
        const groupEmojiCount = emojiList.length

        // 获取共享图片数量
        const sharedPictureCount = sharedPicturesCache.length

        // 格式化时间
        const formatTime = (seconds) => {
            const days = Math.floor(seconds / 86400)
            const hours = Math.floor((seconds % 86400) / 3600)
            const minutes = Math.floor((seconds % 3600) / 60)

            if (days > 0) return `${days}天${hours}小时${minutes}分钟`
            if (hours > 0) return `${hours}小时${minutes}分钟`
            return `${minutes}分钟`
        }

        // 格式化延迟时间
        const formatDelay = (ms) => {
            if (ms >= 60000) {
                return `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`
            }
            return `${Math.floor(ms / 1000)}秒`
        }

        // 检查当前群是否在允许列表中
        const isGroupAllowed = config.autoEmoticons.allowGroups.length === 0 || config.autoEmoticons.allowGroups.includes(groupId)

        // 检查冷却状态
        const cooldownKey = `Yz:autoEmoticons:cooldown:${groupId}`
        const lastSendTime = await redis.get(cooldownKey)
        const now = Date.now()
        let cooldownStatus = '无冷却'

        if (lastSendTime && (now - parseInt(lastSendTime)) < (config.autoEmoticons.sendCD * 1000)) {
            const remainingTime = Math.ceil(((parseInt(lastSendTime) + (config.autoEmoticons.sendCD * 1000)) - now) / 1000)
            cooldownStatus = `冷却中 (${formatTime(remainingTime)})`
        }

        const configMsg = [
            '📊 表情包插件配置状态',
            '━━━━━━━━━━━━━━━━━━',
            `🔧 功能状态: ${useEmojiSave_Switch ? '✅ 已启用' : '❌ 已禁用'}`,
            `🎯 当前群状态: ${isGroupAllowed ? '✅ 允许' : '❌ 不在允许列表'}`,
            '',
            '📈 统计信息:',
            `　🖼️ 当前群表情: ${groupEmojiCount} 个`,
            `　🌐 共享图片: ${sharedPictureCount} 个`,
            `　⏰ 发送冷却: ${cooldownStatus}`,
            '',
            '⚙️ 配置参数:',
            `　⏰ 活跃时间: ${config.autoEmoticons.timeRestrictionEnabled ? `${config.autoEmoticons.activeStartTime} ~ ${config.autoEmoticons.activeEndTime}` : '全天24小时'}`,
            `　⏱️ 过期时间: ${formatTime(config.autoEmoticons.expireTimeInSeconds)}`,
            `　🔢 确认次数: ${config.autoEmoticons.confirmCount} 次`,
            `　🎲 发送概率: ${(config.autoEmoticons.replyRate * 100).toFixed(1)}%`,
            `　📦 最大数量: ${config.autoEmoticons.maxEmojiCount} 个`,
            `　📏 大小限制: ${config.autoEmoticons.maxEmojiSize} MB`,
            `　❄️ 冷却时间: ${formatTime(config.autoEmoticons.sendCD)}`,
            `　⏳ 发送延迟: ${formatDelay(config.autoEmoticons.replyDelay.min)} ~ ${formatDelay(config.autoEmoticons.replyDelay.max)}`,
            '',
            '🎯 允许群组:',
            config.autoEmoticons.allowGroups.length === 0 ? '　📢 所有群组' : config.autoEmoticons.allowGroups.map(id => `　🏷️ ${id}`).join('\n'),
            '━━━━━━━━━━━━━━━━━━'
        ].join('\n')

        await e.reply(configMsg)
        return true
    }

    /**
     * 切换当前群的自动表情包功能
     */
    async toggleGroupEmoticons(e) {
        if (!e.isGroup || !e.isMaster) {
            await e.reply('只有主人可以设置群表情包功能哦~')
            return true
        }

        const groupId = String(e.group_id)
        const action = e.msg.includes('开启') ? 'enable' : 'disable'

        // 格式化时间
        const formatTime = (seconds) => {
            const days = Math.floor(seconds / 86400)
            const hours = Math.floor((seconds % 86400) / 3600)
            const minutes = Math.floor((seconds % 3600) / 60)

            if (days > 0) return `${days}天${hours}小时${minutes}分钟`
            if (hours > 0) return `${hours}小时${minutes}分钟`
            return `${minutes}分钟`
        }

        try {
            let config = Config.getConfig()
            // 获取当前配置
            const currentAllowGroups = [...config.autoEmoticons.allowGroups]

            if (action === 'enable') {
                // 开启功能
                if (!currentAllowGroups.includes(groupId)) {
                    currentAllowGroups.push(groupId)

                    // 更新配置
                    config.autoEmoticons.allowGroups = currentAllowGroups

                    // 初始化该群的监视器
                    initWatcher(groupId)
                    initSharedPicturesWatcher()

                    await e.reply([
                        '✅ 当前群自动表情包功能已开启！',
                        '',
                        '功能说明：',
                        `• 图片在 ${formatTime(config.autoEmoticons.expireTimeInSeconds)} 内出现 ${config.autoEmoticons.confirmCount} 次将被保存`,
                        `• 有 ${(config.autoEmoticons.replyRate * 100).toFixed(1)}% 概率自动发送表情`,
                        `• 发送间隔：${formatTime(config.autoEmoticons.sendCD)}`,
                        `• 回复"#(哒|达)咩"可删除刚发送的表情`
                    ].join('\n'))
                } else {
                    await e.reply('❗ 当前群的自动表情包功能已经是开启状态了~')
                }
            } else {
                // 关闭功能
                const index = currentAllowGroups.indexOf(groupId)
                if (index > -1) {
                    currentAllowGroups.splice(index, 1)

                    // 更新配置
                    config.autoEmoticons.allowGroups = currentAllowGroups

                    // 清除该群的冷却状态
                    const cooldownKey = `Yz:autoEmoticons:cooldown:${groupId}`
                    await redis.del(cooldownKey)

                    await e.reply([
                        '❌ 当前群自动表情包功能已关闭！',
                        '',
                        '说明：',
                        '• 不再保存新的表情包',
                        '• 不再自动发送表情',
                        '• 已保存的表情包不会被删除',
                        '• 可随时使用"#自动表情包开启"重新启用'
                    ].join('\n'))
                } else {
                    await e.reply('❗ 当前群的自动表情包功能已经是关闭状态了~')
                }
            }

            Config.setConfig(config);
        } catch (error) {
            logger.error(`[autoEmoticons] 切换群功能失败: ${error}`)
            await e.reply('❌ 操作失败，请查看日志获取详细信息')
        }

        return true
    }


}

/**
 * 根据文件头信息判断图片格式
 * @param {Buffer} buffer 文件缓冲区
 * @returns {string} 图片扩展名
 */
function getImageTypeFromBuffer(buffer) {
    if (!buffer || buffer.length < 8) return 'jpg'

    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'jpg'
    }

    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'png'
    }

    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'gif'
    }

    // WebP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'webp'
    }

    // BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return 'bmp'
    }

    // 默认返回 jpg
    return 'jpg'
}

/**
 * 下载文件并自动识别图片格式
 * @param {string} url 下载链接
 * @param {string} relativePath 相对路径（不包含扩展名）
 * @param {number} maxSizeMB 最大文件大小（MB），可选
 * @returns {Promise<{success: boolean, filePath: string, actualExt: string, size: number, error?: string}>}
 */
export async function downloadImageFile(url, relativePath, maxSizeMB = null) {
    try {
        // 将 MB 转换为字节
        const maxSize = maxSizeMB ? maxSizeMB * 1024 * 1024 : null

        // 首先发送 HEAD 请求检查文件大小
        let contentLength = null
        try {
            const headResponse = await fetch(url, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 10000, // 10秒超时
                follow: 5, // 最多跟随5次重定向
                compress: false // 禁用压缩
            })

            if (headResponse.ok && headResponse.headers.has('content-length')) {
                contentLength = parseInt(headResponse.headers.get('content-length'))

                // 如果指定了最大大小且文件超过限制，直接返回错误
                if (maxSize && contentLength > maxSize) {
                    const fileSizeMB = (contentLength / 1024 / 1024).toFixed(2)
                    return {
                        success: false,
                        filePath: null,
                        actualExt: null,
                        size: contentLength,
                        error: `文件过大: ${fileSizeMB}MB，超过限制 ${maxSizeMB}MB`
                    }
                }

                const fileSizeMB = (contentLength / 1024 / 1024).toFixed(2)
                logger.debug(`[downloadImageFile] 文件大小检查通过: ${fileSizeMB}MB`)
            } else {
                logger.debug(`[downloadImageFile] 无法获取文件大小，继续下载`)
            }
        } catch (headError) {
            logger.debug(`[downloadImageFile] HEAD 请求失败，继续下载: ${headError.message}`)
        }

        // 下载文件，添加更多错误处理和重试机制
        let response
        let retryCount = 0
        const maxRetries = 3

        while (retryCount < maxRetries) {
            try {
                response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    timeout: 30000, // 30秒超时
                    follow: 5, // 最多跟随5次重定向
                    compress: false, // 禁用压缩
                    agent: false // 禁用 agent 重用
                })

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
                }

                break // 请求成功，跳出重试循环
            } catch (fetchError) {
                retryCount++
                logger.warn(`[downloadImageFile] 下载尝试 ${retryCount}/${maxRetries} 失败: ${fetchError.message}`)

                if (retryCount >= maxRetries) {
                    throw fetchError
                }

                // 等待一段时间后重试
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
            }
        }

        // 使用 arrayBuffer 方法获取数据（兼容现代 fetch API）
        const arrayBuffer = await response.arrayBuffer()
        const bufferData = Buffer.from(arrayBuffer)

        // 检查文件大小
        if (maxSize && bufferData.length > maxSize) {
            const downloadedSizeMB = (bufferData.length / 1024 / 1024).toFixed(2)
            return {
                success: false,
                filePath: null,
                actualExt: null,
                size: bufferData.length,
                error: `下载文件过大: ${downloadedSizeMB}MB，超过限制 ${maxSizeMB}MB`
            }
        }

        // 根据文件头判断真实格式
        const actualExt = getImageTypeFromBuffer(bufferData)

        // 构建完整文件路径
        const baseDir = path.join(process.cwd(), 'data', 'autoEmoticons')
        const fullPath = path.join(baseDir, `${relativePath}.${actualExt}`)

        // 确保目录存在
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }

        // 写入文件
        fs.writeFileSync(fullPath, bufferData)

        return {
            success: true,
            filePath: fullPath,
            actualExt: actualExt,
            size: bufferData.length
        }

    } catch (error) {
        logger.error(`[downloadImageFile] 下载失败: ${error.message}`)
        return {
            success: false,
            filePath: null,
            actualExt: null,
            size: 0,
            error: error.message
        }
    }
}
