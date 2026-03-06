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
                { reg: '^#提取记忆$', fnc: 'extractMemory' },
                { reg: '^#同步历史记忆$', fnc: 'syncHistoryMemory' },
                { reg: '^#我的(记忆|档案)$', fnc: 'viewMemory' },
                { reg: '^#(修改|设定)记忆\\s*(.*)$', fnc: 'setMemory' },
                { reg: '^#(清空|删除)记忆$', fnc: 'clearMemory' },
                { reg: '', fnc: 'collectMessage', log: false }
            ]
        })
    }

    async collectMessage(e) {
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return false;

        const userId = String(e.user_id);
        const groupId = String(e.group_id);

        // 【新增】白名单拦截逻辑
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
                else if (msg.type === 'image') contentToSave += "[发送了一张图片/表情包] ";
                else if (msg.type === 'face') contentToSave += `[QQ表情:${msg.text || msg.id}] `;
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
            logger.error(`[记忆收集器] 缓存消息失败: ${error}`);
        }

        return false;
    }

    // --- 【升级版】双轨制大模型历史同步 ---
    async syncHistoryMemory(e) {
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        const syncModelRemark = memConf.syncModel;

        if (!syncModelRemark) {
            await e.reply("请先在锅巴配置的【智能模式】中，指定用于处理海量数据的【历史同步模型(大)】！");
            return true;
        }

        const apiConfig = config.smart_APIList?.find(api => api.remark === syncModelRemark);
        if (!apiConfig) {
            await e.reply(`未在接口池中找到名为 [${syncModelRemark}] 的配置，请检查。`);
            return true;
        }

        const groupId = String(e.group_id);
        const groupName = e.group?.name || '本群';
        const targetUserId = e.source ? String(e.source.user_id) : String(e.user_id);
        const targetName = e.source ? '该用户' : '你';
        const syncDays = memConf.syncDays || 3;

        await e.reply(`正在呼叫超大杯模型 [${apiConfig.modelId}]，从 group-insight 数据库中拉取${targetName}过去 ${syncDays} 天的言论进行深度测写，请耐心等待...`);

        try {
            const insightPath = '../../group-insight/components/index.js';
            const insightComponents = await import(insightPath);
            const messageCollector = await insightComponents.getMessageCollector();

            const messages = await messageCollector.getRecentUserMessages(
                e.group_id, targetUserId, 1000, null, syncDays
            );

            if (!messages || messages.length === 0) {
                await e.reply(`没有找到${targetName}最近 ${syncDays} 天的发言记录。`);
                return true;
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
                } else if (typeof msgObj.message === 'string') {
                    content = msgObj.message;
                } else if (msgObj.raw_message) {
                    content = msgObj.raw_message;
                }
                content = content.trim();
                if (content && !content.startsWith('#')) {
                    validMessages.push(content);
                }
            }

            if (validMessages.length === 0) {
                await e.reply("拉取到的记录均为空白或指令，无法生成。");
                return true;
            }

            // 【加入群组上下文提示】
            const systemPrompt = memConf.prompt;
            const userPrompt = `【上下文信息】：你正在分析的用户是在名为"${groupName}"的群聊中的成员。\n【该用户过去 ${syncDays} 天的 ${validMessages.length} 条发言记录】：\n${validMessages.join('\n')}\n\n请输出最终的用户画像：`;

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

                // 直接存入最终记忆，并清空日常收集缓存重新开始
                const memoryKey = `sf_plugin:user_memory:${groupId}:${targetUserId}`;
                const bufferKey = `sf_plugin:chat_buffer:${groupId}:${targetUserId}`;
                await redis.set(memoryKey, newMemory);
                await redis.del(bufferKey);

                await e.reply(`🎯 深度测写完成！基于 ${validMessages.length} 条记录，[${apiConfig.modelId}] 认为${targetName}在"${groupName}"群的画像为：\n\n${newMemory}`);
            } else {
                await e.reply(`大模型返回异常：${resJson.error?.message || '未知错误'}`);
            }

        } catch (error) {
            logger.error(`[同步历史记忆] 失败: ${error}`);
            await e.reply(`处理异常：${error.message}`);
        }
        return true;
    }

    // 辅助功能：我的记忆、修改记忆、清空记忆
    async viewMemory(e) {
        const memory = await redis.get(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        if (!memory) return e.reply("档案为空，请发送 #提取记忆 或 #同步历史记忆 生成。");
        return e.reply(`🗂️ 【你的专属心理档案】\n━━━━━━━━━━━━━━\n${memory}`);
    }

    async setMemory(e) {
        const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim();
        if (!content) return e.reply("请提供要设定的记忆内容！");
        await redis.set(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`, content);
        return e.reply(`✅ 篡改成功！以后我会把你当做：\n\n${content}`);
    }

    async clearMemory(e) {
        await redis.del(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        await redis.del(`sf_plugin:chat_buffer:${e.group_id}:${e.user_id}`);
        return e.reply("💥 你的专属记忆档案和聊天缓存已被彻底销毁！");
    }

    // 日常小批量提炼（保持原样，直接读取选中的小模型）
    async extractMemory(e) {
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return e.reply("记忆提炼功能未开启。");

        const apiConfig = config.smart_APIList?.find(api => api.remark === memConf.selectedModel);
        if (!apiConfig) return e.reply(`未找到名为 [${memConf.selectedModel}] 的接口。`);

        const groupId = String(e.group_id);
        const groupName = e.group?.name || '本群';
        const targetUserId = e.source ? String(e.source.user_id) : String(e.user_id);
        const targetName = e.source ? '该用户' : '你';

        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${targetUserId}`;
        const memoryKey = `sf_plugin:user_memory:${groupId}:${targetUserId}`;
        const messages = await redis.lRange(bufferKey, 0, -1);

        if (!messages || messages.length < 5) return e.reply(`${targetName}近期发言过少。`);

        await e.reply(`调用 [${apiConfig.modelId}] 查阅${targetName}最近 ${messages.length} 条发言...`);

        const oldMemory = await redis.get(memoryKey) || "暂无历史印象。";
        // 【加入群组上下文】
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