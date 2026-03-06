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
                // 【新增】记忆管理三连
                {
                    reg: '^#我的(记忆|档案)$',
                    fnc: 'viewMemory',
                },
                {
                    reg: '^#(修改|设定)记忆\\s*(.*)$',
                    fnc: 'setMemory',
                },
                {
                    reg: '^#(清空|删除)记忆$',
                    fnc: 'clearMemory',
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
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return false;

        const userId = String(e.user_id);
        const groupId = String(e.group_id);

        if (e.target_id === e.self_id) return false;
        if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false;

        const blackList = memConf.blackList || [];
        if (blackList.includes(userId)) return false;

        let contentToSave = "";
        if (e.message && Array.isArray(e.message)) {
            for (let msg of e.message) {
                if (msg.type === 'text') {
                    contentToSave += msg.text;
                } else if (msg.type === 'image') {
                    contentToSave += "[发送了一张图片/表情包] ";
                } else if (msg.type === 'face') {
                    contentToSave += `[QQ表情:${msg.text || msg.id}] `;
                }
            }
        } else if (e.msg) {
            contentToSave = e.msg;
        }

        contentToSave = contentToSave.trim();
        if (!contentToSave) return false;

        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${userId}`;

        try {
            await redis.rPush(bufferKey, contentToSave);
            await redis.lTrim(bufferKey, -30, -1);
            await redis.expire(bufferKey, 60 * 60 * 24 * 7);
            
            // 【新增】日志输出判断
            if (memConf.logEnable) {
                logger.mark(`[记忆收集] ${e.sender?.nickname || userId}: ${contentToSave}`);
            }
        } catch (error) {
            logger.error(`[记忆收集器] 缓存消息失败: ${error}`);
        }

        return false; 
    }

    // --- 【新增】查看自己的记忆 ---
    async viewMemory(e) {
        const groupId = String(e.group_id);
        const userId = String(e.user_id);
        const memoryKey = `sf_plugin:user_memory:${groupId}:${userId}`;
        
        const memory = await redis.get(memoryKey);
        
        if (!memory) {
            await e.reply("你目前还没有专属记忆档案哦~ 多在群里水群让我多了解你，或者发送 #提取记忆 来生成一份吧！\n(你也可以发送 #修改记忆 [内容] 直接手动为自己设定人设)");
            return true;
        }

        await e.reply(`🗂️ 【你的专属心理档案】\n━━━━━━━━━━━━━━\n${memory}\n━━━━━━━━━━━━━━\n💡 提示：如果不准，你可以：\n1. 继续聊天，然后发送 #提取记忆 (让AI重新总结)\n2. 发送 #修改记忆 [你想要的设定] (强行覆盖档案)\n3. 发送 #清空记忆 (销毁案底)`);
        return true;
    }

    // --- 【新增】手动修改/篡改记忆 ---
    async setMemory(e) {
        const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim();
        if (!content) {
            await e.reply("请提供要设定的记忆内容！例如：\n#修改记忆 我是一个高冷男神，不喜欢说话。");
            return true;
        }

        const groupId = String(e.group_id);
        const userId = String(e.user_id);
        const memoryKey = `sf_plugin:user_memory:${groupId}:${userId}`;

        await redis.set(memoryKey, content);
        await e.reply(`✅ 篡改成功！以后我就会把你当做这样的人：\n\n${content}`);
        return true;
    }

    // --- 【新增】清空销毁记忆 ---
    async clearMemory(e) {
        const groupId = String(e.group_id);
        const userId = String(e.user_id);
        const memoryKey = `sf_plugin:user_memory:${groupId}:${userId}`;
        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${userId}`;

        await redis.del(memoryKey);
        await redis.del(bufferKey); // 顺便把没来得及提取的聊天缓存也清掉
        
        await e.reply("💥 轰！你的专属记忆档案和聊天缓存已被彻底销毁！我们重新认识一下吧~");
        return true;
    }

    // ... 下面是原有的 extractMemory 方法保持不变 ...
    async extractMemory(e) {
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
        const systemPrompt = memConf.prompt;
        const userPrompt = `【该用户历史印象】：${oldMemory}\n【该用户近期发言记录】：\n${messages.join('\n')}\n\n请输出更新后的用户画像：`;

        const baseUrl = memConf.apiBaseUrl || "https://api.siliconflow.cn/v1";
        const modelName = memConf.model || "Qwen/Qwen2.5-7B-Instruct";
        
        let apiKey = memConf.apiKey;
        if (!apiKey) {
            const sfKeys = config.sf_keys;
            if (!sfKeys || sfKeys.length === 0) {
                await e.reply("未配置 API Key，请在配置文件中填写！");
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
                await redis.del(bufferKey); 

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