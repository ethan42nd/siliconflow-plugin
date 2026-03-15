import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import path from 'node:path'
import fs from 'node:fs'

export class chuoyichuo extends plugin {
    constructor() {
        super({
            name: '戳一戳互动',
            dsc: '戳一戳机器人触发配置化效果',
            event: 'notice.group.poke', // 专心监听戳一戳
            priority: -5000,
            rule: [
                {
                    fnc: 'handlePoke',
                    log: false
                }
            ]
        })
    }

    async handlePoke(e) {
        // 如果被戳的不是机器人自己，或者群号不存在，直接返回
        if (e.target_id !== e.self_id || !e.group_id) return false;

        const config = Config.getConfig();
        const pokeConf = config.pokeConfig || {};
        if (!pokeConf.enable) return false;

        logger.info('[戳一戳] 触发互动');

        const groupId = String(e.group_id);
        const probText = pokeConf.reply_text_prob ?? 0.2;
        const probImg = pokeConf.reply_img_prob ?? 0.5;
        const probMute = pokeConf.mutepick_prob ?? 0;
        const randomVal = Math.random();
        let currentProb = 0;

        // 1. 文字回复逻辑
        currentProb += probText;
        if (randomVal < currentProb) {
            const wordListStr = pokeConf.word_list || '不要再戳了！';
            const words = wordListStr.split('\n').map(w => w.trim()).filter(Boolean);
            if (words.length > 0) {
                const word = words[Math.floor(Math.random() * words.length)];
                
                try {
                    const msgRet = await e.reply(word);
                    // 【新增】将发送的文字内容存入 Redis，有效期1天，供 #哒咩 撤回使用
                    const msgId = msgRet?.seq || msgRet?.data?.message_id || msgRet?.time;
                    if (msgId) {
                        await redis.set(`Yz:autoEmoticons.sent:text_content:${groupId}:${msgId}`, word, { EX: 60 * 60 * 24 * 1 });
                    }
                } catch (err) {
                    logger.error(`[戳一戳] 发送文字失败: ${err}`);
                }
            }
            return true;
        }

        // 2. 图片回复逻辑 (独立读取图库，并兼容 #哒咩 撤回)
        currentProb += probImg;
        if (randomVal < currentProb) {
            const sharedDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'PaimonChuoYiChouPictures');
            const emojiSaveDir = path.join(process.cwd(), 'data', 'autoEmoticons', 'emoji_save', groupId);

            let availablePictures = [];
            let sharedPictures = [];

            // 递归读取你手动上传的共享图库
            if (fs.existsSync(sharedDir)) {
                const getFiles = (dir) => {
                    let results = [];
                    const list = fs.readdirSync(dir);
                    list.forEach(file => {
                        const fullPath = path.join(dir, file);
                        const stat = fs.statSync(fullPath);
                        if (stat && stat.isDirectory()) { 
                            results = results.concat(getFiles(fullPath));
                        } else { 
                            const ext = path.extname(fullPath).toLowerCase();
                            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
                                results.push(fullPath);
                            }
                        }
                    });
                    return results;
                };
                try {
                    sharedPictures = getFiles(sharedDir);
                    availablePictures.push(...sharedPictures);
                } catch (err) {
                    logger.error(`[戳一戳] 读取共享图库失败: ${err}`);
                }
            }

            // 读取自动保存的群专属图库
            if (fs.existsSync(emojiSaveDir)) {
                try {
                    const files = fs.readdirSync(emojiSaveDir).filter(file => {
                        const ext = path.extname(file).toLowerCase();
                        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
                    }).map(file => path.join(emojiSaveDir, file));
                    availablePictures.push(...files);
                } catch (err) {
                    logger.error(`[戳一戳] 读取群专属图库失败: ${err}`);
                }
            }

            if (availablePictures.length > 0) {
                const picturePath = availablePictures[Math.floor(Math.random() * availablePictures.length)];
                try {
                    const msgRet = await e.reply(segment.image(picturePath));
                    const msgId = msgRet?.seq || msgRet?.data?.message_id || msgRet?.time;

                    // 巧妙的一步：把发出去的图存进 Redis，伪装成 autoEmoticons 发的
                    // 这样即使文件分开，当群友对图片回复 #哒咩 时，autoEmoticons.js 依然能找得到并移入回收站！
                    if (msgId) {
                        const isSharedPicture = sharedPictures.includes(picturePath);
                        const fileInfo = isSharedPicture
                            ? `shared:${path.relative(sharedDir, picturePath)}`
                            : path.basename(picturePath);
                        
                        await redis.set(`Yz:autoEmoticons.sent:pic_filePath:${groupId}:${msgId}`, fileInfo, { EX: 60 * 60 * 24 * 1 });
                    }
                } catch (err) {
                    logger.error(`[戳一戳] 发送图片失败: ${err}`);
                }
            } else {
                await e.reply("想给你发表情包，但是我的表情库空空如也~");
            }
            return true;
        }

        // 3. 禁言逻辑
        currentProb += probMute;
        if (randomVal < currentProb) {
            try {
                await e.group.muteMember(e.operator_id, pokeConf.mute_duration || 60);
                await e.reply('不准戳我！！！');
            } catch (err) {
                await e.reply('哼，要不是我没有管理员权限，早把你禁言了！');
            }
            return true;
        }

        // 4. 反击逻辑 (剩下的概率)
        try {
            await e.group.pokeMember(e.operator_id);
            await e.reply('戳你！');
        } catch (err) {
            logger.debug('[戳一戳] 反戳失败，协议端可能不支持');
        }
        return true;
    }
}