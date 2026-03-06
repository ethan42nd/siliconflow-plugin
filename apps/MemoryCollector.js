import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import fetch from 'node-fetch'

export class UserMemory extends plugin {
    constructor() {
        super({
            name: '用户记忆收集器',
            dsc: '收集群聊信息并提炼用户画像',
            event: 'message', // 放宽为所有消息，允许主人在私聊中下达跨群调试指令
            priority: 50000, 
            rule: [
                { reg: '^#提取记忆$', fnc: 'extractMemory' },
                // 终极匹配规则：支持 #同步历史记忆7、#同步历史记忆 @xx 7、#同步历史记忆 1234:5678 7
                { reg: '^#同步(我的)?历史记忆.*$', fnc: 'syncHistoryMemory' },
                { reg: '^#我的(记忆|档案)$', fnc: 'viewMemory' },
                { reg: '^#(修改|设定)记忆\\s*(.*)$', fnc: 'setMemory' },
                { reg: '^#(清空|删除)记忆$', fnc: 'clearMemory' },
                { reg: '', fnc: 'collectMessage', log: false }
            ]
        })
    }

    // 日常收集引擎 (严格限制只能在群聊中运行)
    async collectMessage(e) {
        if (!e.isGroup) return false;

        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return false;

        const userId = String(e.user_id);
        const groupId = String(e.group_id);

        const groupList = memConf.groupList || [];
        if (groupList.length > 0 && !groupList.includes(groupId)) return false;

        if (e.target_id === e.self_id) return false;
        if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false;

        const blackList = memConf.blackList || [];
        if (blackList.includes(userId)) return false;

        let contentToSave = "";
        if (e.message && Array.isArray(e.message)) {
            for (let msg of e.message) {
                if (msg.type === 'text') contentToSave += msg.text;
                else if (msg.type === 'image') contentToSave += "[发送图片] ";
                else if (msg.type === 'face') contentToSave += `[QQ表情] `;
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
            if (memConf.logEnable) {
                logger.mark(`[记忆收集] ${groupId} - ${e.sender?.nickname || userId}: ${contentToSave}`);
            }
        } catch (error) {
            logger.error(`[记忆收集] 缓存失败: ${error}`);
        }
        return false; 
    }

    async syncHistoryMemory(e) {
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};

        let targetUserId = String(e.user_id);
        let targetGroupId = e.isGroup ? String(e.group_id) : "";
        let syncDays = memConf.syncDays || 3;

        // 1. 解析主人专属的跨群调试格式: #同步历史记忆 QQ号:群号 [天数]
        const crossMatch = e.msg.match(/(\d{5,11}):(\d{5,11})\s*(\d+)?(天)?/);
        if (crossMatch) {
            if (!e.isMaster) return e.reply("仅主人可以使用 [QQ号:群号] 的跨群/指定后门调试功能！");
            targetUserId = crossMatch[1];
            targetGroupId = crossMatch[2];
            if (crossMatch[3]) syncDays = parseInt(crossMatch[3]);
        } else {
            // 普通与 @ 模式，必须在群聊中触发
            if (!e.isGroup) return e.reply("请在群聊中使用此功能，或者使用主人调试格式：#同步历史记忆 QQ号:群号");

            // 2. 解析主人的 @ 指定目标
            if (e.at) {
                if (!e.isMaster) return e.reply("仅主人可以 @ 他人强制同步其历史记忆！");
                targetUserId = String(e.at);
            }

            // 3. 解析动态天数 (匹配结尾的数字)
            const dayMatch = e.msg.match(/(\d+)天?$/);
            if (dayMatch) syncDays = parseInt(dayMatch[1]);
        }

        if (!targetGroupId) return e.reply("无法获取目标群号！");

        const syncModelRemark = memConf.syncModel;
        if (!syncModelRemark) return e.reply("请先在锅巴配置中指定【历史同步模型(大)】！");

        const apiConfig = config.smart_APIList?.find(api => api.remark === syncModelRemark);
        if (!apiConfig) return e.reply(`未找到名为 [${syncModelRemark}] 的大模型接口配置。`);

        // 尝试获取人类可读的名字
        let targetName = targetUserId;
        const groupInfo = Bot.gl.get(Number(targetGroupId));
        let groupName = groupInfo ? groupInfo.group_name : targetGroupId;
        if (groupInfo) {
            const member = Bot.gml.get(Number(targetGroupId))?.get(Number(targetUserId));
            if (member) targetName = member.card || member.nickname || targetUserId;
        }
        if (targetUserId === String(e.user_id)) targetName = "你";

        await e.reply(`⏳ 正在呼叫超大杯模型 [${apiConfig.modelId}]，穿梭至 [${groupName}] 拉取 ${targetName} 过去 ${syncDays} 天的记录...`);

        try {
            const insightPath = '../../group-insight/components/index.js';
            const insightComponents = await import(insightPath);
            const messageCollector = await insightComponents.getMessageCollector();
            
            // 拉取海量数据，不做最小限制
            const messages = await messageCollector.getRecentUserMessages(
                Number(targetGroupId), targetUserId, 5000, null, syncDays
            );

            if (!messages || messages.length === 0) {
                return e.reply(`翻遍了 [${groupName}] 的 insight 数据库，没有找到 ${targetName} 最近 ${syncDays} 天的任何发言记录。`);
            }

            let validMessages = [];
            for (let i = messages.length - 1; i >= 0; i--) {
                let msgObj = messages[i];
                let content = "";
                if (msgObj.message && Array.isArray(msgObj.message)) {
                    for (let m of msgObj.message) {
                        if (m.type === 'text') content += m.text;
                        else if (m.type === 'image') content += "[发送图片] ";
                    }
                } else if (typeof msgObj.message === 'string') content = msgObj.message;
                else if (msgObj.raw_message) content = msgObj.raw_message;
                
                content = content.trim();
                if (content && !content.startsWith('#')) validMessages.push(content);
            }

            // 【完全取消不足报错】即便只有 1 条记录，也照样拿去分析
            // 【完全取消不足报错】即便只有 1 条记录，也照样拿去分析
            if (validMessages.length === 0) {
                return e.reply(`拉取到了记录，但全是指令人机交互或纯空白信息，没有营养，无法提炼。`);
            }

            // --- 【新增】先去 Redis 把该用户以前的旧档案捞出来，给大模型做参考 ---
            const memoryKey = `sf_plugin:user_memory:${targetGroupId}:${targetUserId}`;
            const oldMemory = await redis.get(memoryKey) || "该用户暂无历史印象档案。";

            // --- 【修改】调用大模型专属的 syncPrompt ---
            // 如果没配置 syncPrompt，就降级使用普通的 prompt
            const systemPrompt = memConf.syncPrompt || memConf.prompt; 

            // --- 【修改】将旧记忆一并喂给大模型 ---
            const userPrompt = `【上下文】：你正在分析的用户"${targetName}"是"${groupName}"群聊的成员。\n\n【该用户历史印象档案】：\n${oldMemory}\n\n【过去 ${syncDays} 天内的 ${validMessages.length} 条有效言论】：\n${validMessages.join('\n')}\n\n请严格遵循 System 设定，结合历史印象和近期言论，输出该用户的最终侧写画像：`;

            const apiKey = apiConfig.apiKey || (config.sf_keys && config.sf_keys.length > 0 ? config.sf_keys[0].sf_key : "");
            const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: apiConfig.modelId,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    max_tokens: 150,
                    temperature: 0.3 
                })
            });

            const resJson = await response.json();
            if (resJson.choices && resJson.choices.length > 0) {
                const newMemory = resJson.choices[0].message.content.trim();
                
                // 将最新结果强制入库，并清除旧的未提炼碎片
                await redis.set(`sf_plugin:user_memory:${targetGroupId}:${targetUserId}`, newMemory);
                await redis.del(`sf_plugin:chat_buffer:${targetGroupId}:${targetUserId}`); 

                return e.reply(`🎯 深度测写完成！\n基于 ${syncDays} 天内的 ${validMessages.length} 条记录，[${apiConfig.modelId}] 认为 ${targetName} 的画像为：\n\n${newMemory}`);
            } else {
                return e.reply(`大模型返回异常：${resJson.error?.message || '未知错误'}`);
            }

        } catch (error) {
            logger.error(`[同步历史记忆] 处理失败: ${error}`);
            return e.reply(`处理异常：${error.message}`);
        }
    }

    // --------------------------------------------------
    // 以下为基础查询指令 (增加前置群聊判断)
    // --------------------------------------------------
    async viewMemory(e) {
        if (!e.isGroup) return e.reply("请在群聊中使用此指令查看该群的记忆档案。");
        const memory = await redis.get(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        if (!memory) return e.reply("档案为空，请发送 #提取记忆 或 #同步历史记忆 生成。");
        return e.reply(`🗂️ 【你的专属心理档案】\n━━━━━━━━━━━━━━\n${memory}`);
    }

    async setMemory(e) {
        if (!e.isGroup) return false;
        const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim();
        if (!content) return e.reply("请提供要设定的记忆内容！");
        await redis.set(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`, content);
        return e.reply(`✅ 篡改成功！以后我会把你当做：\n\n${content}`);
    }

    async clearMemory(e) {
        if (!e.isGroup) return false;
        await redis.del(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        await redis.del(`sf_plugin:chat_buffer:${e.group_id}:${e.user_id}`);
        return e.reply("💥 你的专属记忆档案和聊天缓存已被彻底销毁！");
    }

    async extractMemory(e) {
        if (!e.isGroup) return e.reply("日常小批量提炼仅限群聊使用。");
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return e.reply("记忆提炼功能未开启。");
        
        const apiConfig = config.smart_APIList?.find(api => api.remark === memConf.selectedModel);
        if (!apiConfig) return e.reply(`未找到名为 [${memConf.selectedModel}] 的接口。`);

        const groupId = String(e.group_id);
        const targetUserId = String(e.user_id);
        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${targetUserId}`;
        const memoryKey = `sf_plugin:user_memory:${groupId}:${targetUserId}`;
        
        const messages = await redis.lRange(bufferKey, 0, -1);
        if (!messages || messages.length < 5) return e.reply(`你近期发言过少。`);
        
        await e.reply(`调用 [${apiConfig.modelId}] 查阅近期 ${messages.length} 条发言...`);

        const oldMemory = await redis.get(memoryKey) || "暂无历史印象。";
        const groupName = e.group?.name || '本群';
        const userPrompt = `【群组名称】："${groupName}"\n【历史印象】：${oldMemory}\n【近期发言】：\n${messages.join('\n')}\n\n请输出更新后的用户画像：`;

        try {
            const apiKey = apiConfig.apiKey || (config.sf_keys && config.sf_keys.length > 0 ? config.sf_keys[0].sf_key : "");
            const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: apiConfig.modelId,
                    messages: [
                        { role: "system", content: memConf.prompt },
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
                return e.reply(`提炼完成！\n\n${newMemory}`);
            } else {
                return e.reply(`模型异常：${resJson.error?.message || '未知错误'}`);
            }
        } catch (error) {
            return e.reply(`提炼出错：${error.message}`);
        }
    }
}