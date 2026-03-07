import plugin from '../../../lib/plugins/plugin.js'
import Config from '../components/Config.js'
import fetch from 'node-fetch'

/**
 * JSON 字符串化时的值替换器
 * 用于截断超长字符串（如 Base64 图片数据），防止日志输出过度冗长
 * @param {string} key - 对象键名
 * @param {*} value - 对象值
 * @returns {*} 截断后的值或原值
 */
const logReplacer = (key, value) => {
    if (typeof value === 'string' && value.length > 500) {
        return value.substring(0, 50) + '... [内容过长，已自动折叠]';
    }
    return value;
};

/**
 * 异步延迟函数
 * @param {number} ms - 延迟时间（毫秒）
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 用户记忆收集器插件
 * 功能：
 * 1. 实时收集群聊消息并保存到 Redis 缓冲区
 * 2. 定期提炼对话记录生成用户画像（小模型日常提炼）
 * 3. 支持深度同步历史记忆（大模型长周期分析）
 * 4. 支持跨群调试和主人指定目标
 * 5. 支持手动查看、修改和清空用户档案
 */
export class UserMemory extends plugin {
    constructor() {
        super({
            name: '用户记忆收集器',
            dsc: '收集群聊信息并提炼用户画像',
            event: 'message', // 监听所有消息，支持主人私聊调试指令
            priority: 50000, 
            rule: [
                { reg: '^#提取记忆$', fnc: 'extractMemory' }, // 小批量日常提炼
                { reg: '^#同步(我的)?历史记忆.*$', fnc: 'syncHistoryMemory' }, // 大模型深度同步（支持 QQ:群号 格式）
                { reg: '^#我的(记忆|档案)$', fnc: 'viewMemory' }, // 查看个人档案
                { reg: '^#(修改|设定)记忆\\s*(.*)$', fnc: 'setMemory' }, // 手动设定档案
                { reg: '^#(清空|删除)记忆$', fnc: 'clearMemory' }, // 清空档案和缓冲
                { reg: '', fnc: 'collectMessage', log: false } // 被动消息收集（不记日志）
            ]
        })
    }

    /**
     * 被动收集群聊消息到 Redis 缓冲区
     * 仅在群聊中运行，不记录指令和空白消息
     * 触发频率：每条有效消息
     * 
     * @param {object} e - 监听事件对象
     * @returns {boolean} 始终返回 false（不阻止消息继续传递）
     */
    async collectMessage(e) {
        // 仅在群聊中收集
        if (!e.isGroup) return false;

        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        // 记忆功能全局开关
        if (!memConf.enable) return false;

        const userId = String(e.user_id);
        const groupId = String(e.group_id);

        // 群聊白名单：如果配置了，则只在指定群聊中收集
        const groupList = memConf.groupList || [];
        if (groupList.length > 0 && !groupList.includes(groupId)) return false;

        // 过滤掉机器人的消息
        if (e.target_id === e.self_id) return false;
        // 过滤掉指令（以 # 开头）
        if (e.isCmd || (e.msg && e.msg.startsWith('#'))) return false;

        // 用户黑名单：被列入黑名单的用户消息不收集
        const blackList = memConf.blackList || [];
        if (blackList.includes(userId)) return false;

        // 从消息对象中提取纯文本内容
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
        // 空白消息不保存
        if (!contentToSave) return false;

        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${userId}`;

        try {
            // 保存到 Redis 列表（RPUSH），自动保持最近 30 条
            await redis.rPush(bufferKey, contentToSave);
            await redis.lTrim(bufferKey, -30, -1);
            // 缓冲区 7 天后过期
            await redis.expire(bufferKey, 60 * 60 * 24 * 7);
            if (memConf.logEnable) {
                logger.mark(`[记忆收集] ${groupId} - ${e.sender?.nickname || userId}: ${contentToSave}`);
            }
        } catch (error) {
            logger.error(`[记忆收集] 缓存失败: ${error}`);
        }
        return false; 
    }

    /**
     * 深度同步历史记忆（调用大模型进行长周期分析）
     * 支持三种触发方式：
     * 1. 群聊自动同步：#同步历史记忆 [天数]
     * 2. @ 他人同步（主人专属）：#同步历史记忆 @QQ [天数]
     * 3. 跨群调试（主人专属）：#同步历史记忆 QQ:群号 [天数]
     * 
     * @param {object} e - 监听事件对象
     * @returns {Promise<*>} 返回回复消息或 false
     */
    async syncHistoryMemory(e) {
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};

        let targetUserId = String(e.user_id);
        let targetGroupId = e.isGroup ? String(e.group_id) : "";
        let syncDays = memConf.syncDays || 3; // 默认同步最近 3 天

        // 解析方式 1：主人跨群调试格式 #同步历史记忆 QQ号:群号 [天数]
        const crossMatch = e.msg.match(/(\d{5,11}):(\d{5,11})\s*(\d+)?(天)?/);
        if (crossMatch) {
            if (!e.isMaster) return e.reply("仅主人可以使用 [QQ号:群号] 的跨群/指定后门调试功能！");
            targetUserId = crossMatch[1];
            targetGroupId = crossMatch[2];
            if (crossMatch[3]) syncDays = parseInt(crossMatch[3]);
        } else {
            // 方式 2 和 3：普通群聊和 @ 模式（必须在群聊中）
            if (!e.isGroup) return e.reply("请在群聊中使用此功能，或者使用主人调试格式：#同步历史记忆 QQ号:群号");

            // 解析 @：仅主人可 @ 他人
            if (e.at) {
                if (!e.isMaster) return e.reply("仅主人可以 @ 他人强制同步其历史记忆！");
                targetUserId = String(e.at);
            }

            // 解析指令末尾动态天数
            const dayMatch = e.msg.match(/(\d+)天?$/);
            if (dayMatch) syncDays = parseInt(dayMatch[1]);
        }

        if (!targetGroupId) return e.reply("无法获取目标群号！");

        // 获取大模型配置
        const syncModelRemark = memConf.syncModel;
        if (!syncModelRemark) return e.reply("请先在锅巴配置中指定【历史同步模型(大)】！");

        const apiConfig = config.smart_APIList?.find(api => api.remark === syncModelRemark);
        if (!apiConfig) return e.reply(`未找到名为 [${syncModelRemark}] 的大模型接口配置。`);

        // 获取人类可读的目标名称和群名
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
            // 从 group-insight 插件获取消息收集器
            const insightPath = '../../group-insight/components/index.js';
            const insightComponents = await import(insightPath);
            const messageCollector = await insightComponents.getMessageCollector();
            
            // 拉取海量历史数据（不设最小限制）
            const messages = await messageCollector.getRecentUserMessages(
                Number(targetGroupId), targetUserId, 5000, null, syncDays
            );

            if (!messages || messages.length === 0) {
                return e.reply(`翻遍了 [${groupName}] 的 insight 数据库，没有找到 ${targetName} 最近 ${syncDays} 天的任何发言记录。`);
            }

            // 清理消息数据（过滤指令和空白）
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
                // 过滤掉指令消息
                if (content && !content.startsWith('#')) validMessages.push(content);
            }

            // 即便只有 1 条有效记录也继续分析
            if (validMessages.length === 0) {
                return e.reply(`拉取到了记录，但全是指令人机交互或纯空白信息，没有营养，无法提炼。`);
            }

            // 从 Redis 获取目标用户的历史档案作为参考
            const memoryKey = `sf_plugin:user_memory:${targetGroupId}:${targetUserId}`;
            const oldMemory = await redis.get(memoryKey) || "该用户暂无历史印象档案。";

            // 使用专属 syncPrompt，无则降级使用普通 prompt
            const systemPrompt = memConf.syncPrompt || memConf.prompt; 

            // 将历史档案和近期消息一并传递给大模型
            const userPrompt = `【上下文】：你正在分析的用户"${targetName}"是"${groupName}"群聊的成员。\n\n【该用户历史印象档案】：\n${oldMemory}\n\n【过去 ${syncDays} 天内的 ${validMessages.length} 条有效言论】：\n${validMessages.join('\n')}\n\n请严格遵循 System 设定，结合历史印象和近期言论，输出该用户的最终侧写画像：`;

            const apiKey = apiConfig.apiKey || (config.sf_keys && config.sf_keys.length > 0 ? config.sf_keys[0].sf_key : "");
            
            // 构建 API 请求体
            const requestBody = {
                model: apiConfig.modelId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 800, // 大模型允许长篇大论（足够输出详细分析）
                temperature: 0.3 
            };

            // 调试日志：打印发送的请求内容
            if (memConf.debugLog) {
                logger.mark(`========== [历史同步 API 请求] ==========`);
                logger.info(JSON.stringify(requestBody, logReplacer, 2));
            }

            // 调用大模型 API
            const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const resJson = await response.json();

            // 调试日志：打印收到的响应内容
            if (memConf.debugLog) {
                logger.mark(`========== [历史同步 API 响应] ==========`);
                logger.info(JSON.stringify(resJson, logReplacer, 2));
            }
            
            if (resJson.choices && resJson.choices.length > 0) {
                const newMemory = resJson.choices[0].message.content.trim();
                
                // 更新档案并清空缓冲区
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

    // ========== 基础指令方法 ==========

    /**
     * 查看用户个人档案
     * 显示 Redis 中存储的用户画像
     * 
     * @param {object} e - 事件对象
     * @returns {Promise<*>}
     */
    async viewMemory(e) {
        if (!e.isGroup) return e.reply("请在群聊中使用此指令查看该群的记忆档案。");
        const memory = await redis.get(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        if (!memory) return e.reply("档案为空，请发送 #提取记忆 或 #同步历史记忆 生成。");
        return e.reply(`🗂️ 【你的专属心理档案】\n━━━━━━━━━━━━━━\n${memory}`);
    }

    /**
     * 手动设定/修改用户档案
     * 允许用户或主人自定义档案内容
     * 
     * @param {object} e - 事件对象
     * @returns {Promise<*>}
     */
    async setMemory(e) {
        if (!e.isGroup) return false;
        const content = e.msg.replace(/^#(修改|设定)记忆\s*/, '').trim();
        if (!content) return e.reply("请提供要设定的记忆内容！");
        await redis.set(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`, content);
        return e.reply(`✅ 篡改成功！以后我会把你当做：\n\n${content}`);
    }

    /**
     * 清空用户档案和缓冲区
     * 删除该用户的所有记忆数据
     * 
     * @param {object} e - 事件对象
     * @returns {Promise<*>}
     */
    async clearMemory(e) {
        if (!e.isGroup) return false;
        await redis.del(`sf_plugin:user_memory:${e.group_id}:${e.user_id}`);
        await redis.del(`sf_plugin:chat_buffer:${e.group_id}:${e.user_id}`);
        return e.reply("💥 你的专属记忆档案和聊天缓存已被彻底销毁！");
    }

    /**
     * 小批量日常提炼（调用小模型）
     * 基于缓冲区内的最近 30 条消息生成用户画像
     * 触发条件：至少 5 条有效消息
     * 
     * @param {object} e - 事件对象
     * @returns {Promise<*>}
     */
    async extractMemory(e) {
        if (!e.isGroup) return e.reply("日常小批量提炼仅限群聊使用。");
        const config = Config.getConfig();
        const memConf = config.smartMode?.memory || {};
        if (!memConf.enable) return e.reply("记忆提炼功能未开启。");
        
        // 获取小模型配置
        const apiConfig = config.smart_APIList?.find(api => api.remark === memConf.selectedModel);
        if (!apiConfig) return e.reply(`未找到名为 [${memConf.selectedModel}] 的接口。`);

        const groupId = String(e.group_id);
        const targetUserId = String(e.user_id);
        const bufferKey = `sf_plugin:chat_buffer:${groupId}:${targetUserId}`;
        const memoryKey = `sf_plugin:user_memory:${groupId}:${targetUserId}`;
        
        // 获取缓冲区消息
        const messages = await redis.lRange(bufferKey, 0, -1);
        if (!messages || messages.length < 5) return e.reply(`你近期发言过少。`);
        
        await e.reply(`调用 [${apiConfig.modelId}] 查阅近期 ${messages.length} 条发言...`);

        // 获取历史档案作为参考
        const oldMemory = await redis.get(memoryKey) || "暂无历史印象。";
        const groupName = e.group?.name || '本群';
        const userPrompt = `【群组名称】："${groupName}"\n【历史印象】：${oldMemory}\n【近期发言】：\n${messages.join('\n')}\n\n请输出更新后的用户画像：`;

        try {
            const apiKey = apiConfig.apiKey || (config.sf_keys && config.sf_keys.length > 0 ? config.sf_keys[0].sf_key : "");
            
            // 构建小模型请求
            const requestBody = {
                model: apiConfig.modelId,
                messages: [
                    { role: "system", content: memConf.prompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 300, // 小模型适度的输出限制
                temperature: 0.3 
            };

            // 调试日志
            if (memConf.debugLog) {
                logger.mark(`========== [日常提炼 API 请求] ==========`);
                logger.info(JSON.stringify(requestBody, logReplacer, 2));
            }

            // 调用模型 API
            const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const resJson = await response.json();

            // 调试日志
            if (memConf.debugLog) {
                logger.mark(`========== [日常提炼 API 响应] ==========`);
                logger.info(JSON.stringify(resJson, logReplacer, 2));
            }
            
            if (resJson.choices && resJson.choices.length > 0) {
                const newMemory = resJson.choices[0].message.content.trim();
                // 更新档案，清空缓冲区
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