import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import fetch from 'node-fetch'

export class UserMemory extends plugin {
    constructor() {
        super({
            name: '用户记忆收集器',
            dsc: '收集群聊信息并提炼用户画像',
            event: 'message.group',
            priority: 50000, 
            rule: [
                {
                    reg: '^#提取记忆$',
                    fnc: 'extractMemory',
                },
                {
                    reg: '', 
                    fnc: 'collectMessage',
                    log: false
                }
            ]
        })
    }

    async collectMessage(e) {
        // 先检查锅巴配置里有没有开启这个功能
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return false;

        const userId = String(e.user_id);
        const groupId = String(e.group_id);

        // 1. 过滤自己
        if (e.target_id === e.self_id) return false;
        
        // 2. 过滤指令消息（以 # 等开头的命令）
        if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false;

        // 3. 黑名单过滤（不收集其他机器人或特定群友）
        const blackList = memConf.blackList || [];
        if (blackList.includes(userId)) return false;

        // 4. 解析消息体，将图片、表情转化为纯文本行为记录
        let contentToSave = "";
        
        // Yunzai 的 e.message 是一个数组，包含了一句话中的所有元素（文字、图片、表情）
        if (e.message && Array.isArray(e.message)) {
            for (let msg of e.message) {
                if (msg.type === 'text') {
                    contentToSave += msg.text;
                } else if (msg.type === 'image') {
                    // 如果发送了图片，记录一个行为占位符，而不是去耗费资源看图
                    contentToSave += "[发送了一张图片/表情包] ";
                } else if (msg.type === 'face') {
                    contentToSave += `[QQ表情:${msg.text || msg.id}] `;
                }
            }
        } else if (e.msg) {
            contentToSave = e.msg;
        }

        contentToSave = contentToSave.trim();
        // 如果解析完是空的，直接丢弃
        if (!contentToSave) return false;

        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${userId}`;

        try {
            await redis.rPush(bufferKey, contentToSave);
            await redis.lTrim(bufferKey, -30, -1);
            await redis.expire(bufferKey, 60 * 60 * 24 * 7);
        } catch (error) {
            logger.error(`[记忆收集器] 缓存消息失败: ${error}`);
        }

        return false; 
    }

    async extractMemory(e) {
        // 检查开关
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) {
            await e.reply("记忆提炼功能未开启，请在锅巴【智能模式】中启用。");
            return true;
        }

        const groupId = String(e.group_id);
        const targetUserId = e.source ? String(e.source.user_id) : String(e.user_id);
        const targetName = e.source ? '该用户' : '你';

        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${targetUserId}`;
        const memoryKey = `sf_plugin:user_memory:${groupId}:${targetUserId}`;

        const messages = await redis.lRange(bufferKey, 0, -1);
        
        if (!messages || messages.length < 5) {
            await e.reply(`${targetName}最近在群里的发言太少啦（仅 ${messages.length} 条），我还摸不透性格，再多聊几句吧~`);
            return true;
        }

        await e.reply(`正在查阅${targetName}最近的 ${messages.length} 条发言，脑补画面中...`);

        const oldMemory = await redis.get(memoryKey) || "暂无历史印象。";

        // 读取锅巴里的动态配置
        const systemPrompt = memConf.prompt;
        const userPrompt = `【该用户历史印象】：${oldMemory}\n【该用户近期发言记录】：\n${messages.join('\n')}\n\n请输出更新后的用户画像：`;

        const baseUrl = memConf.apiBaseUrl || "https://api.siliconflow.cn/v1";
        const modelName = memConf.model || "Qwen/Qwen2.5-7B-Instruct";
        
        // 优先使用专属配置的 Key，否则随机使用全局 sf_keys
        let apiKey = memConf.apiKey;
        if (!apiKey) {
            const sfKeys = config.sf_keys;
            if (!sfKeys || sfKeys.length === 0) {
                await e.reply("未配置 API Key，请在锅巴配置中填写！");
                return true;
            }
            apiKey = sfKeys[Math.floor(Math.random() * sfKeys.length)].sf_key;
        }

        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    max_tokens: 100,
                    temperature: 0.3 
                })
            });

            const resJson = await response.json();
            if (resJson.choices && resJson.choices.length > 0) {
                const newMemory = resJson.choices[0].message.content.trim();
                
                await redis.set(memoryKey, newMemory);
                await redis.del(bufferKey); // 提炼完毕后清空

                await e.reply(`提炼完成！[${modelName}] 认为${targetName}当前的个人画像为：\n\n${newMemory}`);
            } else {
                await e.reply(`模型返回异常：${resJson.error?.message || '未知错误'}`);
                logger.error("[记忆提取]", resJson);
            }

        } catch (error) {
            await e.reply(`提炼过程出错啦：${error.message}`);
            logger.error(`[记忆提取] ${error}`);
        }

        return true;
    }
}