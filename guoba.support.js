import Config from "./components/Config.js";
import lodash from "lodash";
import path from "path";
import { pluginRoot } from "./model/path.js";

const geminiModelsByFetch = Config.getConfig()?.geminiModelsByFetch

// --- 【新增】获取智能模式的模型池，生成锅巴下拉菜单选项 ---
const smartApiList = Config.getConfig()?.smart_APIList || [];
const smartModelOptions = [
  { label: '🤖 使用当前对话模型（默认）', value: '' },
  ...smartApiList.map(api => ({ label: `🔧 ${api.remark}`, value: api.remark }))
];
if (smartModelOptions.length === 1) {
  smartModelOptions.push({ label: '⚠️ 请先在智能接口池中添加接口', value: '' });
}
// ----------------------------------------------------

// --- 【新增】结构化记忆提示词预设 ---
const MEMORY_PROMPT_PRESETS = {
  standard: {
    name: '标准模式（推荐）',
    description: '平衡的信息提取，适合大多数场景',
    structuredPrompt: `你是一个专业的用户信息分析助手。请分析用户的聊天记录，提取结构化信息。

请严格按照以下JSON格式输出（不要包含任何其他内容，确保输出是合法的JSON）：
{
  "facts": [
    {
      "category": "basic",
      "key": "属性名称",
      "value": "属性值",
      "confidence": 0.9
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "事件描述",
      "importance": 0.8,
      "emotionalTone": "情绪色彩"
    }
  ],
  "summary": {
    "short": "一句话总结（30字内）",
    "detailed": "详细描述（100字内）"
  }
}

category 可选值：
- basic: 基本信息（年龄、职业、学历、所在地等）
- interest: 兴趣爱好（游戏、动漫、运动、美食等）
- personality: 性格特点（内向/外向、幽默/严肃等）
- habit: 习惯偏好（作息、常用语、表情习惯等）
- relationship: 人际关系（朋友、家庭、宠物等）
- skill: 技能特长（编程、绘画、音乐等）

注意：
1. 只输出JSON，不要任何解释或markdown代码块标记
2. confidence 范围 0-1，表示你对这个信息的确定程度
3. 如果信息与历史档案冲突，以新信息为准，但保留高置信度的旧信息
4. 不要编造信息，只从提供的消息中提取`,
    syncPrompt: `你是一个顶级的心理侧写师。请根据用户的历史聊天记录，生成深度结构化档案。

请严格按照以下JSON格式输出（不要包含任何其他内容）：
{
  "facts": [
    {
      "category": "basic|interest|personality|habit|relationship|skill",
      "key": "属性名",
      "value": "属性值",
      "confidence": 0.9
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "重要事件描述",
      "importance": 0.8,
      "emotionalTone": "情绪"
    }
  ],
  "social": {
    "closeFriends": ["好友昵称1", "好友昵称2"],
    "activeTopics": ["常聊话题1", "常聊话题2"],
    "roleInGroup": "群内角色（如：活跃分子/潜水员/开心果）"
  },
  "summary": {
    "short": "一句话画像（50字内）",
    "detailed": "详细画像（300字内）"
  }
}

注意：
1. 只输出JSON，不要任何解释
2. 结合历史档案进行分析，不要遗漏重要信息
3. 确保JSON格式合法`},

  concise: {
    name: '简洁模式',
    description: '只提取关键信息，响应更快，Token消耗更少',
    structuredPrompt: `分析用户聊天，提取关键信息，输出JSON：
{
  "facts": [
    {"category": "basic|interest|personality", "key": "属性", "value": "值", "confidence": 0.8}
  ],
  "episodes": [],
  "summary": {"short": "一句话总结", "detailed": ""}
}

类别：basic(基本信息), interest(兴趣), personality(性格)
只提取高置信度(>0.7)的关键信息，不要冗余内容。`,
    syncPrompt: `深度分析用户历史记录，输出JSON档案：
{
  "facts": [{"category": "basic|interest|personality", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": [], "activeTopics": [], "roleInGroup": ""},
  "summary": {"short": "", "detailed": ""}
}

只记录重要事实和事件，简洁高效。`},

  detailed: {
    name: '详细模式',
    description: '提取更丰富的细节，适合深度用户画像',
    structuredPrompt: `你是专业用户分析师。深入分析聊天记录，提取丰富的用户信息。

输出JSON格式：
{
  "facts": [
    {
      "category": "basic|interest|personality|habit|relationship|skill",
      "key": "具体属性名",
      "value": "详细属性值",
      "confidence": 0.85
    }
  ],
  "episodes": [
    {
      "date": "YYYY-MM-DD",
      "event": "详细事件描述，包含上下文",
      "importance": 0.8,
      "emotionalTone": "具体情绪描述"
    }
  ],
  "summary": {
    "short": "精炼的一句话画像",
    "detailed": "详细的用户画像描述，包含性格特点、兴趣爱好、行为模式等多维度分析"
  }
}

要求：
1. 仔细分析每条消息，提取隐含信息
2. 关注用户的语言风格、常用词汇、表达习惯
3. 记录具体细节而非笼统描述
4. 对不确定的信息给予较低置信度
5. 必须确保输出合法JSON`,
    syncPrompt: `你是资深用户研究专家。基于大量历史数据，生成深度用户画像档案。

输出JSON格式：
{
  "facts": [
    {"category": "basic|interest|personality|habit|relationship|skill", "key": "", "value": "", "confidence": 0.9}
  ],
  "episodes": [
    {"date": "YYYY-MM-DD", "event": "", "importance": 0.8, "emotionalTone": ""}
  ],
  "social": {
    "closeFriends": [],
    "activeTopics": [],
    "roleInGroup": ""
  },
  "summary": {
    "short": "",
    "detailed": ""
  }
}

分析要求：
1. 结合历史档案，进行深度综合分析
2. 识别用户的行为模式、价值观、社交特点
3. 记录重要的互动事件和情感变化
4. 推断用户的潜在需求和偏好
5. 输出完整、详细的结构化档案`},

  roleplay: {
    name: '角色扮演模式',
    description: '适合RP群，提取角色设定和世界观信息',
    structuredPrompt: `分析群聊中的角色扮演信息，提取角色设定。

输出JSON：
{
  "facts": [
    {"category": "basic", "key": "角色名", "value": "", "confidence": 0.9},
    {"category": "basic", "key": "性别/年龄", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "喜好", "value": "", "confidence": 0.7},
    {"category": "personality", "key": "性格", "value": "", "confidence": 0.8},
    {"category": "relationship", "key": "关系", "value": "", "confidence": 0.7},
    {"category": "skill", "key": "能力/技能", "value": "", "confidence": 0.7}
  ],
  "episodes": [
    {"date": "", "event": "剧情事件", "importance": 0.8, "emotionalTone": ""}
  ],
  "summary": {
    "short": "角色一句话简介",
    "detailed": "角色详细设定"
  }
}

注意区分角色扮演内容和现实信息，优先记录角色设定。`,
    syncPrompt: `深度分析RP群历史记录，整理角色档案。

输出JSON：
{
  "facts": [{"category": "", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": [], "activeTopics": [], "roleInGroup": "剧情定位"},
  "summary": {"short": "", "detailed": ""}
}

重点：
1. 梳理角色的完整设定和背景故事
2. 记录重要的剧情发展和人物关系变化
3. 分析角色的成长轨迹和行为模式
4. 区分不同时间线的剧情`},

  game: {
    name: '游戏群模式',
    description: '适合游戏群，重点提取游戏ID、段位、常用英雄等',
    structuredPrompt: `分析游戏群聊天记录，提取游戏相关信息。

输出JSON：
{
  "facts": [
    {"category": "basic", "key": "游戏ID", "value": "", "confidence": 0.9},
    {"category": "skill", "key": "段位/等级", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "常玩英雄/角色", "value": "", "confidence": 0.8},
    {"category": "interest", "key": "擅长位置", "value": "", "confidence": 0.7},
    {"category": "habit", "key": "游戏习惯", "value": "", "confidence": 0.6}
  ],
  "episodes": [
    {"date": "", "event": "上分/掉分、精彩操作等", "importance": 0.7, "emotionalTone": ""}
  ],
  "summary": {
    "short": "玩家简介",
    "detailed": "游戏风格和特点"
  }
}

重点提取游戏ID、段位、常用角色等硬核信息。`,
    syncPrompt: `分析游戏群历史，整理玩家档案。

输出JSON：
{
  "facts": [{"category": "", "key": "", "value": "", "confidence": 0.9}],
  "episodes": [{"date": "", "event": "", "importance": 0.8, "emotionalTone": ""}],
  "social": {"closeFriends": ["经常组队的队友"], "activeTopics": ["常讨论的游戏"], "roleInGroup": "群内游戏水平定位"},
  "summary": {"short": "", "detailed": ""}
}

关注：
1. 游戏技术成长和段位变化
2. 常用英雄/角色的演变
3. 游戏态度和团队协作风格
4. 突出的游戏事件和成就`
  },
};

// 预设选项（用于锅巴下拉菜单）
const promptPresetOptions = Object.entries(MEMORY_PROMPT_PRESETS).map(([key, preset]) => ({
  label: `${preset.name} - ${preset.description}`,
  value: key
}));

// ----------------------------------------------------

export function supportGuoba() {
  // /** 群列表（每个Bot-qq单独设置） */
  // let groupList_botUni = Array.from(Bot.gl.values())
  // groupList_botUni = groupList_botUni.map(item => item = { label: `${item.bot_id || Bot.uin}-${item.group_name}-${item.group_id}`, value: `${item.bot_id || Bot.uin}:${item.group_id}` })
  /** 群列表（仅群号） */
  let groupList_total = Array.from(Bot.gl.values())
  groupList_total = groupList_total.map(item => item = { label: `${item.group_name} - ${item.group_id}`, value: item.group_id.toString() })
  /** 私聊 - 8888 */
  // groupList_total = [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
  return {
    pluginInfo: {
      name: 'SF-plugin',
      title: 'SF插件',
      author: ['@Misaka20002', '@syfantasy', '@eggacheb'],
      authorLink: ['https://github.com/Misaka20002', 'https://github.com/syfantasy', 'https://github.com/eggacheb'],
      link: 'https://github.com/Misaka20002/siliconflow-plugin',
      isV3: true,
      isV2: false,
      showInMenu: true,
      description: '基于 Yunzai 的 Synaptic Fusion 插件。SF插件——对接万物',
      // 显示图标，此为个性化配置
      // 图标可在 https://icon-sets.iconify.design 这里进行搜索
      icon: 'fluent-emoji-flat:artist-palette',
      // 图标颜色，例：#FF0000 或 rgb(255, 0, 0)
      iconColor: '#000000',
      // 如果想要显示成图片，也可以填写图标路径（绝对路径）
      iconPath: path.join(pluginRoot, 'resources/readme/girl.png'),
    },
    configInfo: {
      schemas: [
        {
          label: '绘画功能',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "Siliconflow 相关配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "sfBaseUrl",
          label: "SF接口地址",
          bottomHelpMessage: "设置SF接口地址；用于画图和翻译",
          component: "Input",
          componentProps: {
            placeholder: 'https://api.siliconflow.cn/v1',
          },
        },
        {
          field: "sf_keys",
          label: "sf keys",
          bottomHelpMessage: "设置sf的key；登录https://cloud.siliconflow.cn/account/ak 后获取API密钥；用于免费/收费画图；设置多个时可多路并发",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "sf_key",
                label: "sf key",
                required: true,
                component: "Input",
                bottomHelpMessage: "登录https://cloud.siliconflow.cn/account/ak 后获取API密钥；",
                componentProps: {
                  placeholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
                },
              },
              {
                field: "name",
                label: "名称",
                component: "Input",
                required: false,
              },
              {
                field: "remark",
                label: "备注",
                component: "Input",
                required: false,
              },
              {
                field: "isDisable",
                label: "是否禁用",
                component: "Switch",
                required: false,
              },
            ],
          },
        },
        {
          field: "free_mode",
          label: "SF大图模式",
          bottomHelpMessage: "开启后可以绘制更大的图片和更多的步数；注意额度消耗；指令：2048*2048 或 步数30",
          component: "Switch",
        },
        {
          field: "num_inference_steps",
          label: "SF推理步数",
          bottomHelpMessage: "设置默认推理步数；注意额度消耗",
          component: "InputNumber",
          componentProps: {
            min: 1,
            step: 1,
          },
        },
        {
          field: "imageModel",
          label: "SF绘图模型",
          bottomHelpMessage: "SF设置绘图模型，同步自 https://cloud.siliconflow.cn/models?types=to-image ",
          component: "Select",
          componentProps: {
            options: [
              { label: "stabilityai/stable-diffusion-2-1（免费/图生图）", value: "stabilityai/stable-diffusion-2-1" },
              { label: "stabilityai/stable-diffusion-3-medium（免费/图生图）", value: "stabilityai/stable-diffusion-3-medium" },
              { label: "stabilityai/stable-diffusion-3-5-large（免费/图生图）", value: "stabilityai/stable-diffusion-3-5-large" },
              { label: "stabilityai/stable-diffusion-xl-base-1.0（免费/图生图）", value: "stabilityai/stable-diffusion-xl-base-1.0" },
              { label: "deepseek-ai/Janus-Pro-7B（免费）", value: "deepseek-ai/Janus-Pro-7B" },
              { label: "black-forest-labs/FLUX.1-schnell（免费）", value: "black-forest-labs/FLUX.1-schnell" },
              { label: "black-forest-labs/FLUX.1-dev", value: "black-forest-labs/FLUX.1-dev" },
              { label: "LoRA/black-forest-labs/FLUX.1-dev", value: "LoRA/black-forest-labs/FLUX.1-dev" },
              { label: "black-forest-labs/FLUX.1-pro", value: "black-forest-labs/FLUX.1-pro" },
              { label: "Pro/black-forest-labs/FLUX.1-schnell", value: "Pro/black-forest-labs/FLUX.1-schnell" },
              { label: "stabilityai/stable-diffusion-3-5-large-turbo", value: "stabilityai/stable-diffusion-3-5-large-turbo" },
              { label: "Kwai-Kolors/Kolors（免费/文生图）", value: "Kwai-Kolors/Kolors" },
              { label: "Qwen/Qwen-Image", value: "Qwen/Qwen-Image" },
              { label: "Qwen/Qwen-Image-Edit", value: "Qwen/Qwen-Image-Edit" },
              // 添加图生图模型后，还需要添加正则表达式： SF_Painting.js 处理支持图生图模型 match(/.../)
            ],
          },
        },
        {
          field: "generatePrompt",
          label: "开启自动提示词",
          bottomHelpMessage: "sf启用自动提示词；在画图时根据文本自动使用提示词模型生成英文提示词",
          component: "Switch",
        },
        {
          field: "sf_textToPaint_Prompt",
          label: "绘画提示词设定",
          bottomHelpMessage: "sf自定义你的提示词prompt",
          component: "InputTextArea",
        },
        {
          field: "translateModel",
          label: "绘画提示词模型",
          bottomHelpMessage: "sf在画图时输入的提示词是中文的时候自动使用提示词模型，同步自 https://cloud.siliconflow.cn/models?types=chat ",
          component: "Select",
          componentProps: {
            options: [
              { label: "01-ai/Yi-1.5-6B-Chat（免费）", value: "01-ai/Yi-1.5-6B-Chat" },
              { label: "01-ai/Yi-1.5-9B-Chat-16K（免费）", value: "01-ai/Yi-1.5-9B-Chat-16K" },
              { label: "Vendor-A/Qwen/Qwen2-72B-Instruct（免费）", value: "Vendor-A/Qwen/Qwen2-72B-Instruct" },
              { label: "Qwen/Qwen2-1.5B-Instruct（免费）", value: "Qwen/Qwen2-1.5B-Instruct" },
              { label: "Qwen/Qwen2-7B-Instruct（免费）", value: "Qwen/Qwen2-7B-Instruct" },
              { label: "Qwen/Qwen2.5-7B-Instruct（免费）", value: "Qwen/Qwen2.5-7B-Instruct" },
              { label: "Qwen/Qwen2.5-Coder-7B-Instruct（免费）", value: "Qwen/Qwen2.5-Coder-7B-Instruct" },
              { label: "THUDM/chatglm3-6b（免费）", value: "THUDM/chatglm3-6b" },
              { label: "THUDM/glm-4-9b-chat（免费）", value: "THUDM/glm-4-9b-chat" },
              { label: "internlm/internlm2_5-7b-chat（免费）", value: "internlm/internlm2_5-7b-chat" },
              { label: "meta-llama/Meta-Llama-3.1-8B-Instruct（免费）", value: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
              { label: "google/gemma-2-9b-it（免费）", value: "google/gemma-2-9b-it" },
              { label: "AIDC-AI/Marco-o1（免费）", value: "AIDC-AI/Marco-o1" },
              { label: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B（免费）", value: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B" },
              { label: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B（免费）", value: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B" },
              { label: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B（免费）", value: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B" },
              { label: "deepseek-ai/DeepSeek-V3", value: "deepseek-ai/DeepSeek-V3" },
              { label: "deepseek-ai/DeepSeek-R1", value: "deepseek-ai/DeepSeek-R1" },
              { label: "Pro/deepseek-ai/DeepSeek-R1", value: "Pro/deepseek-ai/DeepSeek-R1" },
              { label: "Pro/deepseek-ai/DeepSeek-V3", value: "Pro/deepseek-ai/DeepSeek-V3" },
              { label: "deepseek-ai/DeepSeek-V2-Chat", value: "deepseek-ai/DeepSeek-V2-Chat" },
              { label: "deepseek-ai/DeepSeek-Coder-V2-Instruct", value: "deepseek-ai/DeepSeek-Coder-V2-Instruct" },
              { label: "deepseek-ai/DeepSeek-V2.5", value: "deepseek-ai/DeepSeek-V2.5" },
              { label: "deepseek-ai/deepseek-vl2（视觉）", value: "deepseek-ai/deepseek-vl2" },
              { label: "01-ai/Yi-1.5-34B-Chat-16K", value: "01-ai/Yi-1.5-34B-Chat-16K" },
              { label: "DianXin/DianXin-V1-Chat", value: "DianXin/DianXin-V1-Chat" },
              { label: "Pro/01-ai/Yi-1.5-6B-Chat", value: "Pro/01-ai/Yi-1.5-6B-Chat" },
              { label: "Pro/01-ai/Yi-1.5-9B-Chat-16K", value: "Pro/01-ai/Yi-1.5-9B-Chat-16K" },
              { label: "Pro/Qwen/Qwen2-1.5B-Instruct", value: "Pro/Qwen/Qwen2-1.5B-Instruct" },
              { label: "Pro/Qwen/Qwen2-7B-Instruct", value: "Pro/Qwen/Qwen2-7B-Instruct" },
              { label: "Pro/Qwen/Qwen2.5-7B-Instruct", value: "Pro/Qwen/Qwen2.5-7B-Instruct" },
              { label: "Qwen/Qwen2-57B-A14B-Instruct", value: "Qwen/Qwen2-57B-A14B-Instruct" },
              { label: "Qwen/Qwen2-72B-Instruct", value: "Qwen/Qwen2-72B-Instruct" },
              { label: "Qwen/Qwen2-Math-72B-Instruct", value: "Qwen/Qwen2-Math-72B-Instruct" },
              { label: "Qwen/Qwen2.5-14B-Instruct", value: "Qwen/Qwen2.5-14B-Instruct" },
              { label: "Qwen/Qwen2.5-32B-Instruct", value: "Qwen/Qwen2.5-32B-Instruct" },
              { label: "Qwen/Qwen2.5-72B-Instruct", value: "Qwen/Qwen2.5-72B-Instruct" },
              { label: "Qwen/Qwen2.5-72B-Instruct-128K", value: "Qwen/Qwen2.5-72B-Instruct-128K" },
              { label: "Qwen/Qwen2.5-Math-72B-Instruct", value: "Qwen/Qwen2.5-Math-72B-Instruct" },
              { label: "Qwen/QwQ-32B-Preview", value: "Qwen/QwQ-32B-Preview" },
              { label: "Qwen/QVQ-72B-Preview（视觉）", value: "Qwen/QVQ-72B-Preview" },
              { label: "Qwen/Qwen2.5-Coder-32B-Instruct", value: "Qwen/Qwen2.5-Coder-32B-Instruct" },
              { label: "Qwen/Qwen2-VL-72B-Instruct（视觉）", value: "Qwen/Qwen2-VL-72B-Instruct" },
              { label: "Pro/Qwen/Qwen2-VL-7B-Instruct（视觉）", value: "Pro/Qwen/Qwen2-VL-7B-Instruct" },
              { label: "Pro/THUDM/chatglm3-6b", value: "Pro/THUDM/chatglm3-6b" },
              { label: "Pro/THUDM/glm-4-9b-chat", value: "Pro/THUDM/glm-4-9b-chat" },
              { label: "internlm/internlm2_5-20b-chat", value: "internlm/internlm2_5-20b-chat" },
              { label: "OpenGVLab/InternVL2-26B（视觉）", value: "OpenGVLab/InternVL2-26B" },
              { label: "Pro/OpenGVLab/InternVL2-8B（视觉）", value: "Pro/OpenGVLab/InternVL2-8B" },
              { label: "meta-llama/Llama-3.3-70B-Instruct", value: "meta-llama/Llama-3.3-70B-Instruct" },
            ],
          },
        },
        {
          component: "Divider",
          label: "MJ 相关配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "mj_apiBaseUrl",
          label: "MJ接口地址",
          bottomHelpMessage: "设置MJ接口地址，用于MJ画图；可选：https://ai.trueai.org （免费无key但每一张图片5分钟）",
          component: "Input",
          componentProps: {
            placeholder: 'https://ai.trueai.org',
          },
        },
        {
          field: "mj_apiKey",
          label: "MJ接口Key",
          bottomHelpMessage: "你的账户的API Key",
          component: "Input",
          componentProps: {
            placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
          },
        },
        {
          field: "mj_mode",
          label: "MJ绘画模式",
          bottomHelpMessage: "MJ绘画模式",
          component: "Select",
          componentProps: {
            options: [
              { label: "fast", value: "fast" },
              { label: "slow", value: "slow" },
            ],
          },
        },
        {
          field: "mj_translationEnabled",
          label: "MJ自动提示词",
          bottomHelpMessage: "启用自动提示词；在画图时根据文本自动使用提示词模型生成英文提示词",
          component: "Switch",
        },
        {
          field: "mj_translationBaseUrl",
          label: "MJ提示词接口地址",
          bottomHelpMessage: "填写提供标准openAI API的接口地址",
          component: "Input",
          componentProps: {
            placeholder: 'https://',
          },
        },
        {
          field: "mj_translationKey",
          label: "MJ提示词接口Key",
          bottomHelpMessage: "填写提供标准openAI API的接口Key",
          component: "Input",
          componentProps: {
            placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
          },
        },
        {
          field: "mj_translationModel",
          label: "MJ提示词模型",
          bottomHelpMessage: "填写提供标准openAI API的接口的模型",
          component: "Input",
          componentProps: {
            placeholder: 'gpt-4o',
          },
        },
        {
          component: "Divider",
          label: "绘画限制",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: 'sf_cdtime',
          label: 'CD时间',
          helpMessage: '单位：秒',
          bottomHelpMessage: 'sf绘图/mj绘图 的CD时间，设置为0则无限制',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: 'sf_dailyLimit',
          label: '次数限制',
          bottomHelpMessage: 'sf绘图/mj绘图 的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
          component: "InputNumber",
          componentProps: {
            min: -1,
            step: 1,
          },
        },
        {
          field: 'sf_unlimitedUsers',
          label: '无限制用户ID',
          bottomHelpMessage: '主人与无限制用户无CD次数限制，填写用户ID/QQ号',
          component: "GTags",
          componentProps: {
            placeholder: '请输入用户ID/QQ号',
            allowAdd: true,
            allowDel: true,
            valueParser: ((value) => value.split(',') || []),
          },
        },
        {
          field: 'sf_onlyGroupID',
          label: '白名单群',
          bottomHelpMessage: '仅白名单群可以使用此接口，留空则所有群可用；私聊用群号8888代替',
          component: 'Select',
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: 'multiple',
            options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
          }
        },
        {
          component: "Divider",
          label: "DD 绘图插件配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "dd_APIList",
          label: "DD接口列表",
          bottomHelpMessage: "设置DD绘图的API接口列表，可添加多个接口配置",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "baseUrl",
                label: "接口地址",
                component: "Input",
                bottomHelpMessage: "设置接口地址，例如：https://api.openai.com/v1/images/generations，https://api.studio.nebius.com/v1/images/generations",
                componentProps: {
                  placeholder: 'https://api.openai.com/v1/images/generations',
                },
              },
              {
                field: "apiKey",
                label: "接口Key",
                component: "Input",
                bottomHelpMessage: "设置接口Key",
                componentProps: {
                  placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
                },
              },
              {
                field: "formatType",
                label: "格式类型",
                component: "Select",
                bottomHelpMessage: "选择请求体格式类型，不同类型的接口有不同的请求格式",
                componentProps: {
                  options: [
                    { label: "OpenAI格式", value: "openai" },
                    { label: "Nebius格式", value: "nebius" },
                    { label: "魔塔modelscope", value: "modelscope" },
                  ],
                  defaultValue: "openai",
                },
              },
              {
                field: "enableImageUpload",
                label: "图片上传功能",
                component: "Switch",
                bottomHelpMessage: "开启后支持上传图片给模型，关闭后将忽略消息中的图片",
              },
              {
                field: "model",
                label: "模型",
                component: "Input",
                bottomHelpMessage: "设置模型名称，例如：dall-e-3, black-forest-labs/flux-dev",
                componentProps: {
                  placeholder: 'dall-e-3',
                  defaultValue: 'dall-e-3',
                },
              },
              {
                field: "width",
                label: "图片宽度",
                component: "InputNumber",
                bottomHelpMessage: "设置图片宽度",
                componentProps: {
                  min: 256,
                  max: 1792,
                  step: 64,
                  defaultValue: 1024,
                },
              },
              {
                field: "height",
                label: "图片高度",
                component: "InputNumber",
                bottomHelpMessage: "设置图片高度",
                componentProps: {
                  min: 256,
                  max: 1792,
                  step: 64,
                  defaultValue: 1024,
                },
              },
              {
                field: "n",
                label: "生成数量",
                component: "InputNumber",
                bottomHelpMessage: "设置生成图片的数量（仅OpenAI格式使用，原生的dall-e-3（即官key）只支持生成数量为1，否则报错）",
                componentProps: {
                  min: 1,
                  max: 10,
                  step: 1,
                  defaultValue: 1,
                },
              },
              {
                field: "num_inference_steps",
                label: "推理步数",
                component: "InputNumber",
                bottomHelpMessage: "设置推理步数（仅Nebius等扩展格式使用，OpenAI格式不需要此参数）",
                componentProps: {
                  min: 1,
                  max: 100,
                  step: 1,
                  defaultValue: 28,
                },
              },
              {
                field: "negative_prompt",
                label: "负面提示词",
                component: "InputTextArea",
                bottomHelpMessage: "设置负面提示词（仅Nebius等扩展格式使用，OpenAI格式不需要此参数）",
                componentProps: {
                  defaultValue: "",
                },
              },
              {
                field: "enableGeneratePrompt",
                label: "启用自动提示词",
                component: "Switch",
                bottomHelpMessage: "是否对该接口启用自动提示词功能（开启后将自动优化用户输入的提示词）",
                componentProps: {
                  defaultValue: true,
                },
              },
              {
                field: "response_format",
                label: "响应格式",
                component: "Input",
                bottomHelpMessage: "设置响应格式，例如：b64_json, url（OpenAI和Nebius格式都可使用）",
                componentProps: {
                  placeholder: 'b64_json',
                  defaultValue: 'b64_json',
                },
              },
              {
                field: "response_extension",
                label: "响应扩展",
                component: "Input",
                bottomHelpMessage: "设置响应扩展格式，例如：webp, jpg（仅Nebius等扩展格式使用，OpenAI格式不需要此参数）",
                componentProps: {
                  placeholder: 'webp',
                  defaultValue: 'webp',
                },
              },
              {
                field: "seed",
                label: "随机种子",
                component: "InputNumber",
                bottomHelpMessage: "设置随机种子，-1表示随机（仅Nebius等扩展格式使用，OpenAI格式不需要此参数）",
                componentProps: {
                  min: -1,
                  step: 1,
                  defaultValue: -1,
                },
              },
              {
                field: "extraParams",
                label: "额外参数",
                component: "InputTextArea",
                bottomHelpMessage: "设置额外参数，使用JSON格式，例如：{\"response_format\": \"b64_json\",\"response_extension\": \"webp\",\"num_inference_steps\": 28,\"negative_prompt\": \"\",\"seed\": -1}",
              },
              {
                field: "requestTemplate",
                label: "请求体模板",
                component: "InputTextArea",
                bottomHelpMessage: "设置完整的请求体模板，使用JSON格式。如果设置了此项，将优先使用此模板，忽略上面的参数设置。",
              },
              {
                field: "useTemplateVariables",
                label: "使用模板变量",
                component: "Switch",
                bottomHelpMessage: "开启后会替换模板中的变量，如{{prompt}}、{{width}}等。关闭后将直接使用模板，只替换prompt字段。",
                componentProps: {
                  defaultValue: false,
                },
              },
              {
                field: "authType",
                label: "认证类型",
                component: "Select",
                bottomHelpMessage: "设置API请求的认证类型，影响Authorization请求头的格式",
                componentProps: {
                  options: [
                    { label: "Bearer Token (默认)", value: "bearer" },
                    { label: "Basic Auth", value: "basic" },
                    { label: "API Key", value: "apikey" },
                    { label: "自定义", value: "custom" },
                  ],
                  defaultValue: "bearer",
                },
              },
              {
                field: "authHeaderName",
                label: "认证头名称",
                component: "Input",
                bottomHelpMessage: "设置认证头的名称，默认为'Authorization'",
                componentProps: {
                  placeholder: 'Authorization',
                },
              },
              {
                field: "customAuthValue",
                label: "自定义认证值",
                component: "Input",
                bottomHelpMessage: "当认证类型为'自定义'时，设置完整的认证头值，将直接使用此值作为Authorization头的值",
                componentProps: {
                  placeholder: '例如：Bearer your-token-here',
                },
              },
              {
                field: "customHeaders",
                label: "自定义请求头",
                component: "InputTextArea",
                bottomHelpMessage: "设置其他自定义请求头，使用JSON格式，例如：{\"x-api-version\": \"1.0\", \"custom-header\": \"value\"}",
                componentProps: {
                  placeholder: '{"x-api-version": "1.0"}',
                },
              },
              {
                field: "responseFormat",
                label: "响应格式路径",
                component: "Input",
                bottomHelpMessage: "设置从响应中提取图片数据的路径，例如：images[0].url。如果不设置，将使用默认的解析逻辑。",
              },
              {
                field: "remark",
                label: "文件名",
                component: "Input",
                required: true,
                bottomHelpMessage: "设置接口备注",
              },
              {
                field: "customCommand",
                label: "自定义命令",
                component: "Input",
                required: true,
                rules: [
                  { pattern: '^\\D', message: '自定义命令不能以数字开头（使用数字开头的指令将根据接口序号调用）' },
                  { pattern: '^(?!(d|D))', message: '自定义命令不能与默认指令冲突' },
                ],
                bottomHelpMessage: "可选，设置后可用 #d命令名 来使用此接口，如设置为test则可用#dtest",
              },
              {
                field: "isOnlyMaster",
                label: "仅限主人使用",
                component: "Switch",
                bottomHelpMessage: "开启后仅限主人使用此接口",
              },
              {
                field: 'dd_cdtime',
                label: 'CD时间',
                helpMessage: '单位：秒',
                bottomHelpMessage: '此接口 的CD时间，设置为0则无限制',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: 'dd_dailyLimit',
                label: '次数限制',
                bottomHelpMessage: '此接口 的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
                component: "InputNumber",
                componentProps: {
                  min: -1,
                  step: 1,
                },
              },
              {
                field: 'dd_unlimitedUsers',
                label: '无限制用户ID',
                bottomHelpMessage: '此接口的 主人与无限制用户无CD次数限制，填写用户ID/QQ号',
                component: "GTags",
                componentProps: {
                  placeholder: '请输入用户ID/QQ号',
                  allowAdd: true,
                  allowDel: true,
                  valueParser: ((value) => value.split(',') || []),
                },
              },
              {
                field: 'dd_onlyGroupID',
                label: '白名单群',
                bottomHelpMessage: '仅白名单群可以使用此接口，留空则所有群可用；私聊用群号8888代替',
                component: 'Select',
                componentProps: {
                  allowAdd: true,
                  allowDel: true,
                  mode: 'multiple',
                  options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
                }
              },
            ],
          },
        },
        {
          field: 'dd_usingAPI',
          label: '[#dd]使用接口',
          bottomHelpMessage: "选择要使用的接口配置，必须选择一个接口才能使用绘图功能。其他用户可使用指令：#sfdd接口列表 #sfdd使用接口[数字]",
          component: 'Select',
          componentProps: {
            options: (Config.getConfig()?.dd_APIList || []).map((item, index) => {
              return { label: item.remark || `接口${index + 1}`, value: index + 1 }
            }).concat([{ label: "请选择一个接口", value: 0 }])
          },
        },
        {
          component: "Divider",
          label: "直链功能配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "link_domain",
          label: "直链服务器域名",
          bottomHelpMessage: "设置直链服务器域名，用于图片上传和删除，复制并打开这个链接https://huggingface.co/spaces/xiaozhian/slink/tree/main?duplicate=true，可以复制huggingface空间",
          component: "Input",
        },
        {
          field: "zhilOnlyMaster",
          label: "直链仅主人可用",
          bottomHelpMessage: "#直链 指令仅主人可用",
          component: "Switch",
        },
        {
          component: "Divider",
          label: "Jimeng-API",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "Jimeng.base_url",
          label: "Jimeng-API 地址",
          bottomHelpMessage: "该功能需要自行部署Api，根据说明文档 https://github.com/iptag/jimeng-api 部署Api后填入 http://localhost:5100 ；不会部署的可填写本插件已经部署好的地址 https://misaka20001-jimeng-api.hf.space ；支持文生图、图生图、视频生成，指令： #即梦绘画[tags] #即梦绘画帮助 #即梦视频帮助",
          component: "Input",
          componentProps: {
            placeholder: 'http://localhost:5100',
          },
        },
        {
          field: "Jimeng.sessionid",
          label: "Sessionid",
          bottomHelpMessage: "获取Sessionid：打开浏览器，访问 https://jimeng.jianying.com/ai-tool/home/ 登录你的账号，按F12打开开发者工具，切换到 `Application`或 `Storage` 标签页，在左侧展开`Cookies`，点击 `https://jimeng.jianying.com` 找到名为sessionid的cookie值；若有多个 sessionid 用英文逗号分割；可用指令: #即梦积分 #即梦签到",
          component: "Input",
        },
        {
          field: "Jimeng.model",
          label: "绘画模型",
          bottomHelpMessage: "即梦绘画使用的模型；也可以在绘画中使用参数例如 --model nanobanana 实时更换模型",
          component: "Input",
        },
        {
          field: "Jimeng.sessionid_ITN",
          label: "国际站Sessionid",
          bottomHelpMessage: "同上，访问国际站 https://dreamina.capcut.com/ ；需要自行加上不同的前缀 us-your_session_id 或 hk- 或 jp- 或 sg- ；仅当使用nanobanana时强制选择国际站Sessionid，否则Sessionid与国际站Sessionid共同轮询；若有多个 sessionid 用英文逗号分割",
          component: "Input",
        },
        {
          field: 'Jimeng.max_upimgs',
          label: '上传图片限制',
          helpMessage: '单位：张',
          bottomHelpMessage: '允许用户在图生图、图生视频时最大的上传参考图片数量',
          component: "InputNumber",
          componentProps: {
            min: 1,
            step: 1,
          },
        },
        {
          field: 'Jimeng.cdtime',
          label: 'CD时间',
          helpMessage: '单位：秒',
          bottomHelpMessage: '此接口 的CD时间，设置为0则无限制',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: 'Jimeng.dailyLimit',
          label: '次数限制',
          bottomHelpMessage: '此接口 的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
          component: "InputNumber",
          componentProps: {
            min: -1,
            step: 1,
          },
        },
        {
          field: 'Jimeng.unlimitedUsers',
          label: '无限制用户ID',
          bottomHelpMessage: '此接口的 主人与无限制用户无CD次数限制，填写用户ID/QQ号',
          component: "GTags",
          componentProps: {
            placeholder: '请输入用户ID/QQ号',
            allowAdd: true,
            allowDel: true,
            valueParser: ((value) => value.split(',') || []),
          },
        },
        {
          field: 'Jimeng.onlyGroupID',
          label: '白名单群',
          bottomHelpMessage: '仅白名单群可以使用此接口，留空则所有群可用；私聊用群号8888代替',
          component: 'Select',
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: 'multiple',
            options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
          },
        },
        // {
        //   component: "Divider",
        //   label: "Doubao-API",
        //   componentProps: {
        //     orientation: "left",
        //     plain: true,
        //   },
        // },
        // {
        //   field: "Doubao.base_url",
        //   label: "豆包API地址",
        //   bottomHelpMessage: "该功能需要自行部署Api，请根据说明文档 https://github.com/Bitsea1/doubao-free-api 部署后填入地址（如：http://localhost:8000）；支持对话和绘画功能，指令：#豆包对话帮助 #豆包绘画帮助 #豆包结束对话",
        //   component: "Input",
        //   componentProps: {
        //     placeholder: 'http://localhost:8000',
        //   },
        // },
        // {
        //   field: "Doubao.sessionid",
        //   label: "Sessionid",
        //   bottomHelpMessage: "豆包的sessionid，若有多个sessionid用英文逗号分割进行轮询",
        //   component: "Input",
        // },
        // {
        //   field: 'Doubao.contextExpiryHours',
        //   label: '上下文过期时间',
        //   helpMessage: '单位：小时',
        //   bottomHelpMessage: '对话上下文的过期时间，超过此时间后对话上下文将被清除',
        //   component: "InputNumber",
        //   componentProps: {
        //     min: 1,
        //     step: 1,
        //   },
        // },
        // {
        //   field: 'Doubao.cdtime',
        //   label: 'CD时间',
        //   helpMessage: '单位：秒',
        //   bottomHelpMessage: '豆包功能的CD时间，设置为0则无限制',
        //   component: "InputNumber",
        //   componentProps: {
        //     min: 0,
        //     step: 1,
        //   },
        // },
        // {
        //   field: 'Doubao.dailyLimit',
        //   label: '次数限制',
        //   bottomHelpMessage: '豆包功能的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
        //   component: "InputNumber",
        //   componentProps: {
        //     min: -1,
        //     step: 1,
        //   },
        // },
        // {
        //   field: 'Doubao.unlimitedUsers',
        //   label: '无限制用户ID',
        //   bottomHelpMessage: '主人与无限制用户无CD次数限制，填写用户ID/QQ号',
        //   component: "GTags",
        //   componentProps: {
        //     placeholder: '请输入用户ID/QQ号',
        //     allowAdd: true,
        //     allowDel: true,
        //     valueParser: ((value) => value.split(',') || []),
        //   },
        // },
        // {
        //   field: 'Doubao.onlyGroupID',
        //   label: '白名单群',
        //   bottomHelpMessage: '仅白名单群可以使用豆包功能，留空则所有群可用；私聊用群号8888代替',
        //   component: 'Select',
        //   componentProps: {
        //     allowAdd: true,
        //     allowDel: true,
        //     mode: 'multiple',
        //     options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
        //   },
        // },
        {
          component: "Divider",
          label: "绘画全局设置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "config_presets.presets",
          label: "绘画预设",
          bottomHelpMessage: "绘画预设目前支持 #sf绘画 #dd #即梦 #s（仅绘画模式） #g（仅绘画模式）；可用指令：#sf预设列表 #sf预设[添加|删除|查看]",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "name",
                label: "预设名",
                component: "Input",
                required: true,
                bottomHelpMessage: "将绘画输入文本中的 预设名 替换为 预设文本",
              },
              {
                field: "prompt",
                label: "预设文本",
                component: "InputTextArea",
                bottomHelpMessage: "1.支持的固定参数: 横图, 竖图, 方图, --1:1, --16:9, --9:16, --upimgs 2, reference_strength = 0.8 等；2.meme制作：支持将预设文本中的 _sender_name_ 替换为 被At的用户或当前用户昵称； _sender_id_ 替换为 被At的用户或当前用户qq； _sender_groupid_ 替换为 当前群号； _date_ 替换为 当前日期； _time_ 替换为 当前时间；",
              },
            ],
          },
        },
        {
          field: "simpleMode",
          label: "绘画简洁模式",
          bottomHelpMessage: "开启后合并输出图片与prompt，且不提示进入绘画队列",
          component: "Switch",
        },
        {
          label: '对话功能',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "BOT名称触发配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "botName",
          label: "BOT名称",
          bottomHelpMessage: "设置BOT的名称，当消息中包含这个名称时会触发对话；如果有多个触发词请用 | 符号进行分隔；留空则关闭；更改后重启生效",
          component: "Input",
          componentProps: {
            placeholder: "小助手",
            allowClear: true,
          },
        },
        {
          field: "toggleAtMode",
          label: "At模式",
          bottomHelpMessage: "开启At模式后，可以直接At Bot使用默认命令对话",
          component: "Switch",
        },
        {
          field: 'switch_ChatCooldown',
          label: '不允许并发对话',
          bottomHelpMessage: 'BOT名称触发对话时，不允许并发对话，用户要等待上一次对话完成后才可以触发下一次对话；每个群单独计算，主人不受限制',
          component: 'Switch'
        },
        {
          field: "enablePrivateChatAI",
          label: "私聊AI对话开关",
          bottomHelpMessage: "开启/关闭私聊模式下的AI对话功能",
          component: "Switch",
        },
        {
          field: "defaultCommand",
          label: "默认命令",
          bottomHelpMessage: "当触发BOT名字时使用的默认命令，可选：ss 或 gg",
          component: "Select",
          componentProps: {
            options: [
              { label: "使用#ss命令", value: "ss" },
              { label: "使用#gg命令", value: "gg" },
            ],
          },
        },
        {
          field: "autoReply",
          label: "🌟群自动回复",
          bottomHelpMessage: "允许Bot按照概率自动回复群内的消息",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "groupId",
                label: "群号",
                required: true,
                bottomHelpMessage: "允许的群组的群号",
                component: "Input",
              },
              {
                field: 'enabled',
                label: '开启自动回复',
                bottomHelpMessage: '开启或关闭该群的自动回复',
                component: 'Switch'
              },
              {
                field: "probability",
                label: "自动回复的概率",
                bottomHelpMessage: '判断此群此次自动回复的概率，默认为0.1',
                component: 'InputNumber',
                componentProps: {
                  min: 0,
                  max: 1,
                  step: 0.01
                }
              },
            ],
          },
        },
        {
          component: "Divider",
          label: "[#ss]对话相关配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "ss_APIList",
          label: "[#ss]接口列表",
          bottomHelpMessage: "设置#ss[对话]的API接口列表，可添加多个接口配置，填写了的部分会覆盖默认配置，不填则使用默认配置，默认配置是指[#ss]对话接口地址等，每个接口是独立的上下文，只有#ss和#gg的默认配置是共享的上下文",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "apiBaseUrl",
                label: "接口地址",
                component: "Input",
                bottomHelpMessage: "设置#ss[对话]的API接口地址，兼容所有OpenAI格式的API接口；通常是以 /v1 结尾",
                componentProps: {
                  placeholder: 'https://api.siliconflow.cn/v1',
                },
              },
              {
                field: "apiKey",
                label: "接口密钥",
                component: "InputPassword",
                bottomHelpMessage: "设置#ss[对话]的API接口密钥，多个密钥使用英文逗号分割，自动轮询。",
              },
              {
                field: "model",
                label: "接口模型",
                component: "Input",
                bottomHelpMessage: "设置#ss[对话]的API接口模型",
                componentProps: {
                  placeholder: 'gpt-4',
                },
              },
              {
                field: "prompt",
                label: "接口提示词",
                component: "InputTextArea",
                bottomHelpMessage: "设置#ss[对话]的API接口提示词，自动将提示词中的字符串 {{user_name}} 替换为用户昵称/群昵称",
                componentProps: {
                  placeholder: 'You are a helpful assistant, you prefer to speak Chinese',
                },
              },
              {
                field: 'groupContextLength',
                label: '读取群聊天记录数',
                bottomHelpMessage: '允许机器人读取近期的最多群聊聊天记录条数（实际可获取条数取决于适配器）',
                component: 'InputNumber',
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "useMarkdown",
                label: "图片对话模式",
                component: "Switch",
                bottomHelpMessage: "开启后将以图片形式显示对话内容，支持markdown格式",
              },
              {
                field: "forwardMessage",
                label: "发送合并消息",
                component: "Switch",
                bottomHelpMessage: "开启后在图片对话模式下会同时转发原始消息",
              },
              {
                field: "quoteMessage",
                label: "引用原消息",
                component: "Switch",
                bottomHelpMessage: "开启后回复时会引用原消息",
              },
              {
                field: "enableImageUpload",
                label: "图片上传功能",
                component: "Switch",
                bottomHelpMessage: "开启后支持上传图片给模型，关闭后将忽略消息中的图片",
              },
              {
                field: "mustNeedImgLength",
                label: "必需图片",
                bottomHelpMessage: "填写该接口必须使用的图片张数，若用户使用该接口时必须附带/引用图片的图片不足，则要求用户发送图片，常用于图生图/图片鉴赏/ControlNet",
                helpMessage: '单位：张',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "mustReturnImgRetriesTimes",
                label: "必须返回图片",
                bottomHelpMessage: "重试次数：该接口必须返回图片，若没有返回图片，则执行重试的次数。",
                helpMessage: '单位：重试次数',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "paintModel",
                label: "仅绘画模式",
                component: "Switch",
                bottomHelpMessage: "开启后改接口转为绘画模式：1.仅发送图片，不回复文字；2.可以使用 绘画功能-绘画全局设置-绘画预设；3.与图片对话模式兼容；4.不保存上下文；5.将发送绘画开始信息；6.支持使用 --upimgs [num] 控制必需图片张数",
              },
              {
                field: "forwardThinking",
                label: "转发思考",
                component: "Switch",
                bottomHelpMessage: "开启后会转发思考过程，如果开启图片对话模式，则需要开启发送合并消息",
              },
              {
                field: "forwardReference",
                label: "转发参考链接",
                component: "Switch",
                bottomHelpMessage: "开启后，若该接口触发了联网搜索，将独立转发参考链接信息卡片",
              },
              {
                field: "useContext",
                label: "上下文功能",
                component: "Switch",
                bottomHelpMessage: "开启后将对该接口保留对话历史记录，默认为关闭",
              },
              {
                field: "remark",
                label: "文件名",
                component: "Input",
                required: true,
                bottomHelpMessage: "接口配置的储存的文件名",
              },
              {
                field: "customCommand",
                label: "自定义命令",
                component: "Input",
                required: true,
                rules: [
                  { pattern: '^\\D', message: '自定义命令不能以数字开头（使用数字开头的指令将根据接口序号调用）' },
                  { pattern: '^(?!(s|S))', message: '自定义命令不能与默认指令冲突' },
                ],
                bottomHelpMessage: "可选，设置后可用 #s命令名 来使用此接口，如设置为test则可用#stest，也可以使用#stest结束对话来结束此接口的对话",
              },
              {
                field: "isOnlyMaster",
                label: "仅限主人使用",
                component: "Switch",
                bottomHelpMessage: "开启后仅限主人使用此接口",
              },
              {
                field: 'cdtime',
                label: 'CD时间',
                helpMessage: '单位：秒',
                bottomHelpMessage: '此接口 的CD时间，设置为0则无限制',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: 'dailyLimit',
                label: '次数限制',
                bottomHelpMessage: '此接口 的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
                component: "InputNumber",
                componentProps: {
                  min: -1,
                  step: 1,
                },
              },
              {
                field: 'unlimitedUsers',
                label: '无限制用户ID',
                bottomHelpMessage: '此接口的 主人与无限制用户无CD次数限制，填写用户ID/QQ号',
                component: "GTags",
                componentProps: {
                  placeholder: '请输入用户ID/QQ号',
                  allowAdd: true,
                  allowDel: true,
                  valueParser: ((value) => value.split(',') || []),
                },
              },
              {
                field: 'onlyGroupID',
                label: '白名单群',
                bottomHelpMessage: '仅白名单群可以使用此接口，留空则所有群可用；私聊用群号8888代替',
                component: 'Select',
                componentProps: {
                  allowAdd: true,
                  allowDel: true,
                  mode: 'multiple',
                  options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
                }
              },
            ],
          },
        },
        {
          field: 'ss_usingAPI',
          label: '[#ss]主人使用接口',
          bottomHelpMessage: "选择主人/BOT名称触发时要使用的接口配置；其他用户可使用指令：#sfss接口列表 #sfss使用接口[数字]",
          component: 'Select',
          componentProps: {
            options: (Config.getConfig()?.ss_APIList || []).map((item, index) => {
              return { label: item.remark || `接口${index + 1}`, value: index + 1 }
            }).concat([{ label: "使用默认配置", value: 0 }])
          },
        },
        {
          field: "ss_apiBaseUrl",
          label: "[#ss]对话接口地址",
          bottomHelpMessage: "设置#ss[对话] 的对话API接口地址，兼容所有OpenAI格式的API接口，默认无连续对话功能，如有需要可以打开下面的上下文开关，若不填则使用SF接口",
          component: "Input",
          componentProps: {
            placeholder: 'https://api.siliconflow.cn/v1',
          },
        },
        {
          field: "ss_Key",
          label: "[#ss]对话API Key",
          bottomHelpMessage: "设置#ss 对话的API接口的Key，多个密钥使用英文逗号分割，自动轮询。",
          component: 'InputPassword'
        },
        {
          field: "ss_model",
          label: "[#ss]对话API模型",
          bottomHelpMessage: "设置#ss 对话的API接口模型",
          component: "Input",
          componentProps: {
            placeholder: 'gpt-4',
          },
        },
        {
          field: "ss_Prompt",
          label: "[#ss]对话API提示词",
          bottomHelpMessage: "设置#ss 对话的API接口的提示词/人格/扮演的角色，自动将提示词中的字符串 {{user_name}} 替换为用户昵称/群昵称",
          component: "InputTextArea",
          componentProps: {
            placeholder: 'You are a helpful assistant, you prefer to speak Chinese',
          },
        },
        {
          field: 'ss_groupContextLength',
          label: '[#ss]读取群聊天记录数',
          bottomHelpMessage: '允许机器人读取近期的最多群聊聊天记录条数（实际可获取条数取决于适配器）',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "ss_useMarkdown",
          label: "[#ss]图片对话模式",
          bottomHelpMessage: "开启后将以图片形式显示对话内容，支持markdown格式",
          component: "Switch",
        },
        {
          field: "ss_forwardMessage",
          label: "[#ss]发送合并消息",
          bottomHelpMessage: "开启后在图片对话模式下会同时转发原始消息",
          component: "Switch",
        },
        {
          field: "ss_quoteMessage",
          label: "[#ss]引用原消息",
          bottomHelpMessage: "是否引用原消息",
          component: "Switch",
        },
        {
          field: "ss_enableImageUpload",
          label: "[#ss]图片上传功能",
          bottomHelpMessage: "开启后支持上传图片给模型，关闭后将忽略消息中的图片",
          component: "Switch",
        },
        {
          field: "ss_mustNeedImgLength",
          label: "[#ss]必需图片",
          bottomHelpMessage: "填写该接口必须使用的图片张数，若用户使用该接口时必须附带/引用图片的图片不足，则要求用户发送图片，常用于图生图/图片鉴赏/ControlNet",
          helpMessage: '单位：张',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "ss_mustReturnImgRetriesTimes",
          label: "必须返回图片",
          bottomHelpMessage: "[#ss]重试次数：该接口必须返回图片，若没有返回图片，则执行重试的次数。",
          helpMessage: '单位：重试次数',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "ss_forwardThinking",
          label: "[#ss]转发思考",
          bottomHelpMessage: "是否转发思考过程",
          component: "Switch",
        },
        {
          field: "ss_forwardReference",
          label: "[#ss]转发参考链接",
          bottomHelpMessage: "是否在触发联网搜索时，独立转发参考链接信息卡片",
          component: "Switch",
        },
        {
          field: "ss_debugLog",
          label: "[#ss]调试日志",
          bottomHelpMessage: "开启后会在 Yunzai 控制台输出完整的 API 请求和响应抓包日志，用于排查问题",
          component: "Switch",
        },
        {
          field: "ss_isOnlyMaster",
          label: "[#ss]仅限主人使用",
          bottomHelpMessage: "开启后默认配置仅限主人使用",
          component: "Switch",
        },
        {
          component: "Divider",
          label: "[#gg]Gemini API配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "gg_APIList",
          label: "[#gg]接口列表",
          bottomHelpMessage: "设置#gg[对话]的API接口列表，可添加多个接口配置，填写了的部分会覆盖默认配置，不填则使用默认配置，默认配置是指[#gg]Gemini反代地址等，每个接口是独立的上下文，只有#ss和#gg的默认配置是共享的上下文",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "apiBaseUrl",
                label: "接口地址",
                component: "Input",
                bottomHelpMessage: "设置#gg[对话]的API接口地址，对https://generativelanguage.googleapis.com 反代，内置反代不可用时可选用： https://a.geminiproxy.ggff.net",
                componentProps: {
                  placeholder: 'https://a.geminiproxy.ggff.net',
                },
              },
              {
                field: "apiKey",
                label: "接口密钥",
                component: "InputPassword",
                bottomHelpMessage: "设置#gg[对话]的API接口密钥，Key可以在https://aistudio.google.com/app/apikey获取，多个密钥使用英文逗号分割，自动轮询。",
              },
              {
                field: "model",
                label: "接口模型",
                bottomHelpMessage: '默认值：gemini-2.0-flash；推荐：gemini-exp-1206,gemini-2.0-flash-thinking-exp-01-21；可用模型每日自动更新，立即更新指令：#sf插件立即执行每日自动任务',
                component: 'Select',
                componentProps: {
                  options: geminiModelsByFetch.map(s => { return { label: s, value: s } })
                }
              },
              {
                field: "prompt",
                label: "接口提示词",
                component: "InputTextArea",
                bottomHelpMessage: "设置#gg[对话]的API接口提示词，自动将提示词中的字符串 {{user_name}} 替换为用户昵称/群昵称",
                componentProps: {
                  placeholder: '你是一个有用的助手，你更喜欢说中文。你会根据用户的问题，通过搜索引擎获取最新的信息来回答问题。你的回答会尽可能准确、客观。',
                },
              },
              {
                field: 'groupContextLength',
                label: '读取群聊天记录数',
                bottomHelpMessage: '允许机器人读取近期的最多群聊聊天记录条数（实际可获取条数取决于适配器）',
                component: 'InputNumber',
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "useMarkdown",
                label: "图片对话模式",
                component: "Switch",
                bottomHelpMessage: "开启后将以图片形式显示对话内容，支持markdown格式",
              },
              {
                field: "forwardMessage",
                label: "发送合并消息",
                component: "Switch",
                bottomHelpMessage: "开启后在图片对话模式下会同时转发原始消息",
              },
              {
                field: "quoteMessage",
                label: "引用原消息",
                component: "Switch",
                bottomHelpMessage: "开启后回复时会引用原消息",
              },
              {
                field: "useSearch",
                label: "搜索功能",
                component: "Switch",
                bottomHelpMessage: "开启后Gemini将使用搜索引擎获取最新信息来回答问题，仅限gemini-2.0-flash-exp模型及后续支持该功能的模型",
              },
              {
                field: "useVertexAI",
                label: "使用Vertex AI格式",
                component: "Switch",
                bottomHelpMessage: "开启后将使用Google Vertex AI的请求格式（在Google Cloud Vertex AI平台上调用Gemini API的请求和响应格式），不知道是什么的话就关闭",
              },
              {
                field: "enableImageUpload",
                label: "图片上传功能",
                component: "Switch",
                bottomHelpMessage: "开启后支持上传图片给模型，关闭后将忽略消息中的图片",
              },
              {
                field: "mustNeedImgLength",
                label: "必需图片",
                bottomHelpMessage: "填写该接口必须使用的图片张数，若用户使用该接口时必须附带/引用图片的图片不足，则要求用户发送图片，常用于图生图/图片鉴赏/ControlNet",
                helpMessage: '单位：张',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "enableImageGeneration",
                label: "文生图功能",
                component: "Switch",
                bottomHelpMessage: "开启后Gemini将支持文生图功能，可以生成图片，仅限gemini-2.0-flash-exp模型及后续支持该功能的模型",
              },
              {
                field: "mustReturnImgRetriesTimes",
                label: "必须返回图片",
                bottomHelpMessage: "重试次数：该接口必须返回图片，若没有返回图片，则执行重试的次数。",
                helpMessage: '单位：重试次数',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: "paintModel",
                label: "仅绘画模式",
                component: "Switch",
                bottomHelpMessage: "开启后改接口转为绘画模式：1.仅发送图片，不回复文字；2.可以使用 绘画功能-绘画全局设置-绘画预设；3.与图片对话模式兼容；4.不保存上下文；5.将发送绘画开始信息；6.支持使用  --upimgs [num] 控制必需图片张数",
              },
              {
                field: "useContext",
                label: "上下文功能",
                component: "Switch",
                bottomHelpMessage: "开启后将对该接口保留对话历史记录，默认为关闭",
              },
              {
                field: "remark",
                label: "文件名",
                component: "Input",
                required: true,
                bottomHelpMessage: "接口配置的备注说明",
              },
              {
                field: "customCommand",
                label: "自定义命令",
                component: "Input",
                required: true,
                rules: [
                  { pattern: '^\\D', message: '自定义命令不能以数字开头（使用数字开头的指令将根据接口序号调用）' },
                  { pattern: '^(?!(g|G))', message: '自定义命令不能与默认指令冲突' },
                ],
                bottomHelpMessage: "可选，设置后可用 #g命令名 来使用此接口，如设置为test则可用#gtest，也可以使用#gtest结束对话来结束此接口的对话",
              },
              {
                field: "isOnlyMaster",
                label: "仅限主人使用",
                component: "Switch",
                bottomHelpMessage: "开启后仅限主人使用此接口",
              },
              {
                field: 'cdtime',
                label: 'CD时间',
                helpMessage: '单位：秒',
                bottomHelpMessage: '此接口 的CD时间，设置为0则无限制',
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  step: 1,
                },
              },
              {
                field: 'dailyLimit',
                label: '次数限制',
                bottomHelpMessage: '此接口 的每日限制次数，设置为0则无限制，设置为-1则仅限无限制用户使用',
                component: "InputNumber",
                componentProps: {
                  min: -1,
                  step: 1,
                },
              },
              {
                field: 'unlimitedUsers',
                label: '无限制用户ID',
                bottomHelpMessage: '此接口的 主人与无限制用户无CD次数限制，填写用户ID/QQ号',
                component: "GTags",
                componentProps: {
                  placeholder: '请输入用户ID/QQ号',
                  allowAdd: true,
                  allowDel: true,
                  valueParser: ((value) => value.split(',') || []),
                },
              },
              {
                field: 'onlyGroupID',
                label: '白名单群',
                bottomHelpMessage: '仅白名单群可以使用此接口，留空则所有群可用；私聊用群号8888代替',
                component: 'Select',
                componentProps: {
                  allowAdd: true,
                  allowDel: true,
                  mode: 'multiple',
                  options: [{ label: "私聊 - 8888", value: "8888" }, ...groupList_total]
                }
              },
            ],
          },
        },
        {
          field: 'gg_usingAPI',
          label: '[#gg]主人使用接口',
          bottomHelpMessage: "选择主人/BOT名称触发时要使用的接口配置；其他用户可使用指令：#sfgg接口列表 #sfgg使用接口[数字]",
          component: 'Select',
          componentProps: {
            options: (Config.getConfig()?.gg_APIList || []).map((item, index) => {
              return { label: item.remark || `接口${index + 1}`, value: index + 1 }
            }).concat([{ label: "使用默认配置", value: 0 }])
          },
        },
        {
          field: "ggBaseUrl",
          label: "[#gg]Gemini反代地址",
          bottomHelpMessage: "设置#gg[对话] 的API接口地址，对https://generativelanguage.googleapis.com 反代；留空则使用内置地址，内置反代不可用时可选用： https://a.geminiproxy.ggff.net",
          component: "Input",
          componentProps: {
            placeholder: 'https://a.geminiproxy.ggff.net',
          },
        },
        {
          field: "ggKey",
          label: "[#gg]Gemini API Key",
          bottomHelpMessage: "设置#gg 对话的API接口的Key，Key可以在https://aistudio.google.com/app/apikey获取；留空则使用内置Key，多个密钥使用英文逗号分割，自动轮询。",
          component: 'InputPassword',
        },
        {
          field: 'gg_model',
          label: '[#gg]gemini模型',
          bottomHelpMessage: '默认值：gemini-2.0-flash；推荐：gemini-exp-1206,gemini-2.0-flash-thinking-exp-01-21；可用模型每日自动更新，立即更新指令：#sf插件立即执行每日自动任务',
          component: 'Select',
          componentProps: {
            options: geminiModelsByFetch.map(s => { return { label: s, value: s } })
          }
        },
        {
          field: "gg_Prompt",
          label: "[#gg]对话API提示词",
          bottomHelpMessage: "设置#gg 对话的API接口的系统提示词，自动将提示词中的字符串 {{user_name}} 替换为用户昵称/群昵称",
          component: "InputTextArea",
          componentProps: {
            placeholder: '你是一个有用的助手，你更喜欢说中文。你会根据用户的问题，通过搜索引擎获取最新的信息来回答问题。你的回答会尽可能准确、客观。',
          },
        },
        {
          field: 'gg_groupContextLength',
          label: '[#gg]读取群聊天记录数',
          bottomHelpMessage: '允许机器人读取近期的最多群聊聊天记录条数（实际可获取条数取决于适配器）',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "gg_useMarkdown",
          label: "[#gg]图片对话模式",
          bottomHelpMessage: "开启后将以图片形式显示对话内容，支持markdown格式",
          component: "Switch",
        },
        {
          field: "gg_forwardMessage",
          label: "[#gg]发送合并消息",
          bottomHelpMessage: "开启后在图片对话模式下会同时转发原始消息",
          component: "Switch",
        },
        {
          field: "gg_quoteMessage",
          label: "[#gg]引用原消息",
          bottomHelpMessage: "开启后回复时会引用原消息",
          component: "Switch",
        },
        {
          field: "gg_useSearch",
          label: "[#gg]搜索功能",
          bottomHelpMessage: "开启后Gemini将使用搜索引擎获取最新信息来回答问题，仅限gemini-2.0-flash-exp模型及后续支持该功能的模型",
          component: "Switch",
        },
        {
          field: "gg_useVertexAI",
          label: "[#gg]使用Vertex AI格式",
          bottomHelpMessage: "开启后将使用Google Vertex AI的请求格式（在Google Cloud Vertex AI平台上调用Gemini API的请求和响应格式），不知道是什么的话就关闭",
          component: "Switch",
        },
        {
          field: "gg_enableImageUpload",
          label: "[#gg]图片上传功能",
          bottomHelpMessage: "开启后支持上传图片给模型，关闭后将忽略消息中的图片",
          component: "Switch",
        },
        {
          field: "gg_mustNeedImgLength",
          label: "[#gg]必需图片",
          bottomHelpMessage: "填写该接口必须使用的图片张数，若用户使用该接口时必须附带/引用图片的图片不足，则要求用户发送图片，常用于图生图/图片鉴赏/ControlNet",
          helpMessage: '单位：张',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "gg_enableImageGeneration",
          label: "[#gg]文生图功能",
          bottomHelpMessage: "开启后Gemini将支持文生图功能，可以生成图片，仅限gemini-2.0-flash-exp模型及后续支持该功能的模型",
          component: "Switch",
        },
        {
          field: "gg_mustReturnImgRetriesTimes",
          label: "[#gg]必须返回图片",
          bottomHelpMessage: "重试次数：该接口必须返回图片，若没有返回图片，则执行重试的次数。",
          helpMessage: '单位：重试次数',
          component: "InputNumber",
          componentProps: {
            min: 0,
            step: 1,
          },
        },
        {
          field: "gg_isOnlyMaster",
          label: "[#gg]仅限主人使用",
          bottomHelpMessage: "开启后默认配置仅限主人使用",
          component: "Switch",
        },
        {
          component: "Divider",
          label: "对话全局设置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "gg_ss_useContext",
          label: "上下文功能",
          bottomHelpMessage: "[#ss][#gg]共用，开启后将保留对话历史记录，上下文#gg与#ss的上下文共享",
          component: "Switch",
        },
        {
          field: "gg_maxHistoryLength",
          label: "历史记录条数",
          bottomHelpMessage: "[#ss][#gg]共用，设置保留的历史记录条数，仅保留最近的N条记录；可用指令：#sf结束对话 #sf结束全部对话",
          component: "InputNumber",
          componentProps: {
            min: 1,
            step: 1,
          },
        },
        {
          field: "gg_HistoryExTime",
          label: "历史记录过期时间",
          helpMessage: '单位：小时',
          bottomHelpMessage: "[#ss][#gg]共用，设置保留的历史记录的过期时间；可用指令：#sf结束对话 #sf结束全部对话",
          component: "InputNumber",
          componentProps: {
            min: 1,
            step: 1,
          },
        },
        {
          field: "mediaMaxSizeInMB",
          label: "媒体识别最大体积",
          helpMessage: '单位：MB',
          bottomHelpMessage: "[#gg]图片/视频内容识别时最大体积，目前仅支持 Gemini",
          component: "InputNumber",
          componentProps: {
            min: 1,
            step: 1,
          },
        },
        {
          field: "groupMultiChat",
          label: "群聊多人对话",
          bottomHelpMessage: "开启后群聊中的用户可以在同一话题中与AI聊天，每个群聊都有独立的对话上下文",
          component: "Switch",
        },
        {
          label: '暖群功能',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "群自动打招呼配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "groupSayHello.enabled",
          label: "启用自动打招呼",
          bottomHelpMessage: "开启后将在配置的群中定时自动打招呼，使用Gemini生成打招呼内容；更改后重启生效；可用指令：#打招呼配置 #立即打招呼",
          component: "Switch",
        },
        {
          field: 'groupSayHello.cron_time',
          label: '定时表达式配置',
          bottomHelpMessage: '定时打招呼，重启生效，默认每1小时执行一次：0 0 * * * ? *',
          component: 'EasyCron',
          componentProps: {
            placeholder: '请输入或选择Cron表达式',
          },
        },
        {
          field: "groupSayHello.allowGroups",
          label: "🥝群单独设置",
          bottomHelpMessage: "填写允许自动打招呼的群号列表，留空则不在任何群打招呼；可在群内使用 #自动打招呼开启/关闭 来管理",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "groupId",
                label: "群号",
                required: true,
                bottomHelpMessage: "允许的群组的群号；提示：可以对同一个群配置多个不同接口的配置",
                component: "Input",
              },
              {
                field: 'switchOn',
                label: '开启打招呼',
                bottomHelpMessage: '开启或关闭该群的自动打招呼',
                component: 'Switch'
              },
              {
                field: "replyRate",
                label: "打招呼的概率",
                bottomHelpMessage: '到预定的定时表达式时间后，判断此群此次打招呼的概率，默认为1',
                component: 'InputNumber',
                componentProps: {
                  min: 0,
                  max: 1,
                  step: 0.01
                }
              },
              {
                field: 'usingAPI',
                label: '使用接口',
                bottomHelpMessage: "选择要使用的Gemini接口配置，需要先在 对话功能标签页中设置-[#gg]接口，记得关闭接口中的“读取群聊天记录数”；（如果更改了接口顺序的话，记得也要修改此选项）",
                component: 'Select',
                componentProps: {
                  options: (Config.getConfig()?.gg_APIList || []).map((item, index) => {
                    return { label: item.remark || `接口${index + 1}`, value: index + 1 }
                  }).concat([{ label: "使用默认配置", value: 0 }])
                },
              },
              {
                field: "groupPrompt",
                label: "群单独提示词",
                bottomHelpMessage: '除了接口中的系统提示词(System Prompt)外，还可以在这里设置输入提示词(Input)。',
                component: "InputTextArea",
                componentProps: {
                  placeholder: '请根据以下最近的群聊记录，生成一条像真人一样的回复，长度控制在50字以内，直接输出内容，不要加任何前缀或解释。',
                },
              },
              {
                field: 'trueAtUser',
                label: 'At用户',
                bottomHelpMessage: '在打招呼中真的At用户',
                component: 'Switch'
              },
              {
                field: "botQQArr",
                label: "使用的Bot QQ号",
                bottomHelpMessage: "指定使用哪个Bot发送打招呼消息，留空则使用默认Bot；多个Bot时填写QQ号",
                component: "GTags",
                componentProps: {
                  placeholder: '请输入Bot QQ号',
                  allowAdd: true,
                  allowDel: true,
                  valueParser: ((value) => value.split(',') || []),
                },
              },
            ],
          },
        },
        {
          label: '戳一戳互动配置',
          component: 'Divider'
        },
        {
          field: 'pokeConfig.enable',
          label: '启用戳一戳',
          bottomHelpMessage: '开启后机器人被戳时会根据以下概率触发互动。修改后立即生效。',
          component: 'Switch'
        },
        {
          field: 'pokeConfig.reply_text_prob',
          label: '文字回复概率',
          bottomHelpMessage: '范围 0~1。各项概率总和请小于等于1，剩余的概率将触发“反戳回去”。',
          component: 'InputNumber',
          componentProps: { min: 0, max: 1, step: 0.01 }
        },
        {
          field: 'pokeConfig.reply_img_prob',
          label: '图片回复概率',
          bottomHelpMessage: '触发时将从“自动保存的表情包”以及“手动上传的共享图片目录”中随机抽选发送。',
          component: 'InputNumber',
          componentProps: { min: 0, max: 1, step: 0.01 }
        },
        {
          field: 'pokeConfig.mutepick_prob',
          label: '禁言概率',
          bottomHelpMessage: '触发禁言的概率。机器人需具备管理员权限。',
          component: 'InputNumber',
          componentProps: { min: 0, max: 1, step: 0.01 }
        },
        {
          field: 'pokeConfig.mute_duration',
          label: '禁言时长 (秒)',
          bottomHelpMessage: '触发禁言时的惩罚时间',
          component: 'InputNumber',
          componentProps: { min: 1, step: 1 }
        },
        {
          field: 'pokeConfig.word_list',
          label: '文字回复列表',
          bottomHelpMessage: '触发文字回复时随机抽取一条发送。请每行填写一条回复语。',
          component: 'InputTextArea',
          componentProps: {
            rows: 6,
            placeholder: '不要再戳了！\n救命啊，有变态>_<！！！\n你戳谁呢！\n再戳禁言你哦！'
          }
        },
        {
          label: '群自动表情包配置',
          component: 'Divider'
        },
        {
          field: 'autoEmoticons.useEmojiSave',
          label: '启用表情保存',
          bottomHelpMessage: '是否启用表情保存/偷取/发送；更改后重启生效；会自动发送保存在 /data/autoEmoticons/emoji_save/群号/ 和 /data/autoEmoticons/PaimonChuoYiChouPictures/ 目录下的表情包；群单独指令：#哒咩 #自动表情包[开启|关闭] #表情包配置',
          component: 'Switch'
        },
        {
          field: 'autoEmoticons.timeRestrictionEnabled',
          label: '启用时间限制',
          bottomHelpMessage: '开启后，机器人仅在指定的活跃时间内发送表情包，防止半夜“闹鬼”',
          component: 'Switch'
        },
        {
          field: 'autoEmoticons.activeStartTime',
          label: '活跃开始时间',
          bottomHelpMessage: '格式：HH:mm，例如：08:00',
          component: 'Input',
          componentProps: {
            placeholder: '08:00',
          }
        },
        {
          field: 'autoEmoticons.activeEndTime',
          label: '活跃结束时间',
          bottomHelpMessage: '格式：HH:mm，例如：23:00（支持跨夜，如 22:00 到 06:00）',
          component: 'Input',
          componentProps: {
            placeholder: '23:00',
          }
        },
        {
          field: 'autoEmoticons.confirmCount',
          label: '表情确认次数',
          bottomHelpMessage: '在记录时间内接收多少次才保存表情包',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            step: 1
          }
        },
        {
          field: 'autoEmoticons.replyRate',
          label: '发送表情概率',
          bottomHelpMessage: '发送偷取表情的概率',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            max: 1,
            step: 0.01
          }
        },
        {
          field: 'autoEmoticons.sendCD',
          label: '发送表情冷却时间',
          bottomHelpMessage: '发送表情的冷却时间（秒）',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            step: 1
          }
        },
        {
          field: 'autoEmoticons.maxEmojiCount',
          label: '表情包最大数量',
          bottomHelpMessage: '每个群最大的表情包储存数量，储存在 data/autoEmoticons/emoji_save/ 文件夹下',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            step: 1
          }
        },
        {
          field: 'autoEmoticons.maxEmojiSize',
          label: '表情大小限制',
          bottomHelpMessage: '表情包文件大小限制 (MB)',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            step: 1
          }
        },
        {
          field: 'autoEmoticons.allowGroups',
          label: '表情包白名单群',
          bottomHelpMessage: '需要保存和发送表情包的群号列表，为空数组时表示所有群；（推荐设置该选项，设置后支持无触发自动发送表情包，否则只能接受任意信息后概率触发表情包）',
          component: 'Select',
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: 'multiple',
            options: groupList_total
          }
        },
        {
          field: 'autoEmoticons.getBotByQQ_targetQQArr',
          label: 'BotQQ号',
          bottomHelpMessage: 'Bot多开qq时指定一个或多个Bot发送表情包，否则将随机使用1个已登录的Bot',
          component: "GTags",
          componentProps: {
            placeholder: '请输入qq号',
            allowAdd: true,
            allowDel: true,
            valueParser: ((value) => value.split(',') || []),
          },
        },
        {
          label: '复读 & 打断复读配置',
          component: 'Divider'
        },
        {
          field: "autoRepeat_config",
          label: "🍓群单独设置",
          bottomHelpMessage: "复读 & 打断复读；群单独指令：#自动复读[开启|关闭] #打断复读[开启|关闭] #自动复读状态",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "groupId",
                label: "群号",
                required: true,
                bottomHelpMessage: "群号",
                component: "Input",
              },
              {
                field: "enabled",
                label: "自动复读",
                required: false,
                bottomHelpMessage: "是否启用自动复读，默认关闭",
                component: 'Switch'
              },
              {
                field: "triggerCount",
                label: "触发复读的次数",
                required: false,
                bottomHelpMessage: "触发复读的次数，默认3次",
                component: "InputNumber",
                componentProps: {
                  min: 1,
                  step: 1,
                },
              },
              {
                field: "probability",
                label: "复读概率",
                required: false,
                bottomHelpMessage: "复读概率，默认1",
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  max: 1,
                  step: 0.01,
                },
              },
              {
                field: "breakEnabled",
                label: "打断复读",
                required: false,
                bottomHelpMessage: "是否启用打断复读，默认关闭",
                component: 'Switch'
              },
              {
                field: "breakCount",
                label: "打断的次数",
                required: false,
                bottomHelpMessage: "打断的次数，默认5次",
                component: "InputNumber",
                componentProps: {
                  min: 1,
                  step: 1,
                },
              },
              {
                field: "breakProbability",
                label: "打断概率",
                required: false,
                bottomHelpMessage: "打断概率，默认0.8",
                component: "InputNumber",
                componentProps: {
                  min: 0,
                  max: 1,
                  step: 0.01,
                },
              },
              {
                field: "cooldown",
                label: "冷却时间",
                required: false,
                bottomHelpMessage: "冷却时间（秒），默认30秒",
                component: "InputNumber",
                componentProps: {
                  min: 1,
                  step: 1,
                },
              },
            ],
          },
        },
        {
          label: '语音功能',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          label: 'Fish.audio的设置',
          component: 'Divider'
        },
        {
          field: "voiceSwitch",
          label: "语音功能开关",
          bottomHelpMessage: "更改后重启生效",
          component: "Switch",
        },
        {
          field: 'fish_apiKey',
          label: 'Fish ApiKey',
          bottomHelpMessage: '收费，但是用手机号接码后可以获得10刀，API KEY获取地址：https://fish.audio/zh-CN/go-api/api-keys',
          component: 'Input'
        },
        {
          field: 'fish_reference_id',
          label: '发音人ID',
          bottomHelpMessage: '这里填入你想要的模型model的代码，例如派蒙的是efc1ce3726a64bbc947d53a1465204aa；可用指令：#搜索fish音色[名称]',
          component: 'Input'
        },
        {
          field: 'fish_text_blacklist',
          label: '同传文本黑名单',
          bottomHelpMessage: '可以写上你不想发音的句子，例如一些命令反馈',
          component: "GTags",
          componentProps: {
            placeholder: '请输文本',
            allowAdd: true,
            allowDel: true,
            showPrompt: true,
            promptProps: {
              content: '请输文本',
              okText: '添加',
              rules: [
                { required: true, message: '不能为空' },
              ],
            },
            valueParser: ((value) => value.split(',') || []),
          },
        },
        {
          field: "enableTranslation",
          label: "翻译功能开关",
          bottomHelpMessage: "开启翻译功能，将要进行同传的语言变成日语",
          component: "Switch",
        },
        {
          field: "targetLang",
          label: "翻译目标语言",
          bottomHelpMessage: "翻译目标语言",
          component: "Select",
          componentProps: {
            options: [
              { label: "日语", value: "JA" },
              { label: "英语", value: "EN" },
            ],
          },
        },
        {
          label: 'WebSocket服务',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "WebSocket服务配置",
          componentProps: {
            orientation: "left",
            plain: true,
          },
        },
        {
          field: "enableWS",
          label: "启用WebSocket服务",
          bottomHelpMessage: "是否启用WebSocket服务，用于在网页端 https://sf.maliy.top/ 或 https://sfd.maliy.top/ ，进行对话&绘图；如果是从没有ws的版本更新过来的，请重新安装依赖；重启生效",
          component: "Switch",
        },
        {
          field: "wsPort",
          label: "服务端口",
          bottomHelpMessage: "WebSocket服务监听的端口号，默认8081，请确保服务器防火墙开放此端口；重启生效",
          component: "InputNumber",
          componentProps: {
            min: 1,
            max: 65535,
            step: 1,
          },
        },
        {
          field: "wsLogLevel",
          label: "日志级别",
          bottomHelpMessage: "WebSocket服务的日志记录级别；重启生效",
          component: "Select",
          componentProps: {
            options: [
              { label: "调试", value: "debug" },
              { label: "信息", value: "info" },
              { label: "警告", value: "warn" },
              { label: "错误", value: "error" },
            ],
          },
        },
        {
          field: "wsDefaultUser",
          label: "Web端默认用户名",
          bottomHelpMessage: "设置Web端用户的默认昵称，提示词中的字符串 {{user_name}} 会被替换为该用户名；重启生效",
          component: "Input",
          componentProps: {
            placeholder: "小白",
          },
        },
        {
          field: "wsPassword",
          label: "WebSocket密码",
          bottomHelpMessage: "设置WebSocket服务的访问密码，建议修改默认密码；重启生效",
          component: "InputPassword",
          componentProps: {
            placeholder: "请输入访问密码",
          },
        },
        {
          label: '智能模式',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: "Divider",
          label: "智能接口池",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smart_APIList",
          label: "接口列表",
          bottomHelpMessage: "在这里新增或管理你的 AI 接口。⚠️ 新增并【保存】后，请【刷新当前网页】，即可在下方的下拉菜单中选用新接口。",
          component: "GSubForm",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "remark",
                label: "标识名(必填)",
                component: "Input"
              },
              {
                field: "format",
                label: "接口格式",
                component: "Select",
                componentProps: {
                  options: [
                    { label: "OpenAI", value: "OpenAI" },
                    { label: "Gemini", value: "Gemini" }
                  ]
                }
              },
              {
                field: "baseUrl",
                label: "接口地址",
                component: "Input",
                componentProps: {
                  placeholder: 'https://api.siliconflow.cn/v1',
                },
              },
              {
                field: "apiKey",
                label: "API密钥",
                component: "InputPassword",
                bottomHelpMessage: "如果留空，将自动使用上方配置的 sf_keys",
              },
              {
                field: "modelId",
                label: "模型名称",
                component: "Input",
                bottomHelpMessage: "填入模型在对应平台上的标准ID。⚠️ 注意：作为后台智能任务时，最好使用带有 Instruct 或 Chat 后缀的指令模型！",
                componentProps: {
                  placeholder: '例如: Qwen/Qwen2.5-7B-Instruct',
                },
              }
            ]
          }
        },
        {
          component: "Divider",
          label: "🧠 结构化记忆系统",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.memory.enable",
          label: "启用记忆收集",
          bottomHelpMessage: "开启后会在后台静默收集群友发言，并提取用户画像永久保存。",
          component: "Switch",
        },
        {
          field: "smartMode.memory.injectToChat",
          label: "对话中注入记忆",
          bottomHelpMessage: "开启后，AI对话时会自动注入对方的记忆信息，让回复更个性化。",
          component: "Switch",
        },
        {
          field: "smartMode.memory.logEnable",
          label: "收集器日志输出",
          bottomHelpMessage: "开启后，每次成功拦截并缓存群友发言时，会在控制台打印日志。日常使用建议关闭以防刷屏。",
          component: "Switch",
        },
        {
          field: "smartMode.memory.debugLog",
          label: "API调试日志",
          bottomHelpMessage: "开启后会在控制台打印发送给大模型的完整结构体，以及模型返回的原始JSON。专用于排查提炼报错或内容被截断的问题。",
          component: "Switch",
        },
        {
          field: 'smartMode.memory.groupList',
          label: '生效群聊(白名单)',
          bottomHelpMessage: '仅在选中的群聊中开启记忆收集与提炼。留空则在所有群生效。',
          component: 'Select',
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: 'multiple',
            options: groupList_total
          }
        },
        {
          field: 'smartMode.memory.blackList',
          label: '用户黑名单',
          bottomHelpMessage: '填入不需要收集记忆的QQ号（如其他机器人、不想被收集的用户）。回车添加。',
          component: 'GTags',
          componentProps: {
            placeholder: '输入QQ号并回车',
            allowAdd: true,
            allowDel: true,
          }
        },
        {
          component: "Divider",
          label: "模型配置",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.memory.selectedModel",
          label: "日常提炼模型（小）",
          bottomHelpMessage: "💡 提炼记忆是高频后台任务，推荐使用免费/便宜的 7B~32B 级别模型（如 Qwen2.5-7B-Instruct）。注：为节省天价 Token，插件会自动将群友发送的图片/表情转化为 [发送了一张图片] 文本占位符，普通文本模型即可完美处理，无需强上视觉模型！",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
          },
        },
        {
          field: "smartMode.memory.syncModel",
          label: "历史同步模型（大）",
          bottomHelpMessage: "用于 #同步历史记忆 指令。由于要一次性处理成百上千条记录，必须选择支持超大上下文的高智商模型（如 Gemini-Flash, DeepSeek）。",
          component: "Select",
          componentProps: { options: smartModelOptions },
        },
        {
          field: "smartMode.memory.syncDays",
          label: "历史同步天数",
          bottomHelpMessage: "设置每次同步拉取过去几天的聊天记录（天数越多，消耗的 Token 越大）",
          component: "InputNumber",
          componentProps: { min: 1, max: 30, step: 1, defaultValue: 3 },
        },
        {
          component: "Divider",
          label: "自动提炼配置",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.memory.autoExtract.enable",
          label: "启用自动提炼",
          bottomHelpMessage: "开启后，当缓冲区消息达到阈值时会自动触发记忆提炼（无需手动#提取记忆）。",
          component: "Switch",
        },
        {
          field: "smartMode.memory.autoExtract.threshold",
          label: "自动提炼阈值",
          bottomHelpMessage: "缓冲区达到多少条消息时自动触发提炼。建议值：5-15条。",
          component: "InputNumber",
          componentProps: { min: 1, max: 50, step: 1, defaultValue: 10 },
        },
        {
          field: "smartMode.memory.autoExtract.minInterval",
          label: "自动提炼间隔(秒)",
          bottomHelpMessage: "两次自动提炼的最小间隔，防止频繁调用API。建议值：1800-7200秒（30分钟-2小时）。",
          component: "InputNumber",
          componentProps: { min: 60, max: 86400, step: 60, defaultValue: 3600 },
        },
        {
          field: "smartMode.memory.autoExtract.maxBufferSize",
          label: "缓冲区最大条数",
          bottomHelpMessage: "缓冲区最多保留多少条消息，超过后会自动丢弃旧消息。建议值：20-50条。",
          component: "InputNumber",
          componentProps: { min: 10, max: 100, step: 5, defaultValue: 30 },
        },
        {
          field: "smartMode.memory.autoExtract.bufferExpireDays",
          label: "缓冲区过期天数",
          bottomHelpMessage: "缓冲区消息保留多少天后自动删除。建议值：7天。",
          component: "InputNumber",
          componentProps: { min: 1, max: 30, step: 1, defaultValue: 7 },
        },
        {
          component: "Divider",
          label: "记忆整合策略",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.memory.consolidation.similarityThreshold",
          label: "相似度阈值",
          bottomHelpMessage: "用于事实去重，当两个事实的相似度超过此阈值时视为重复。建议值：0.8-0.9。",
          component: "InputNumber",
          componentProps: { min: 0.5, max: 1, step: 0.05, defaultValue: 0.85 },
        },
        {
          field: "smartMode.memory.consolidation.maxFactsPerCategory",
          label: "每类最大事实数",
          bottomHelpMessage: "每个类别最多保留多少条事实，超过后会删除旧的/低置信度的。建议值：10-30。",
          component: "InputNumber",
          componentProps: { min: 5, max: 100, step: 5, defaultValue: 20 },
        },
        {
          field: "smartMode.memory.consolidation.confidenceThreshold",
          label: "最低置信度",
          bottomHelpMessage: "低于此置信度的事实会被自动清理。建议值：0.3-0.5。",
          component: "InputNumber",
          componentProps: { min: 0, max: 1, step: 0.1, defaultValue: 0.3 },
        },
        {
          field: "smartMode.memory.consolidation.retentionDays",
          label: "事实保留天数",
          bottomHelpMessage: "事实最多保留多少天，0表示永久保留。建议值：30-90天。",
          component: "InputNumber",
          componentProps: { min: 0, max: 365, step: 1, defaultValue: 90 },
        },
        {
          field: "smartMode.memory.consolidation.mergeStrategy",
          label: "冲突解决策略",
          bottomHelpMessage: "当新旧事实冲突时的处理策略。newer=新信息优先，higher=高置信度优先。",
          component: "Select",
          componentProps: {
            options: [
              { label: "新信息优先", value: "newer" },
              { label: "高置信度优先", value: "higher" }
            ],
            defaultValue: "newer"
          },
        },
        {
          component: "Divider",
          label: "提示词配置（高级）",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.memory.promptPreset",
          label: "提示词预设",
          bottomHelpMessage: "选择适合你群聊类型的提示词预设。选择后下面的提示词会自动填充，也可以在此基础上自定义修改。",
          component: "Select",
          componentProps: {
            options: promptPresetOptions,
          },
        },
        {
          field: "smartMode.memory.structuredPrompt",
          label: "日常提炼提示词（自定义）",
          bottomHelpMessage: "指导模型输出JSON格式结构化记忆的提示词。选择上方预设会自动填充，也可手动编辑自定义。",
          component: "InputTextArea",
          componentProps: {
            rows: 12,
            placeholder: "选择上方预设或输入自定义提示词..."
          }
        },
        {
          field: "smartMode.memory.syncPrompt",
          label: "历史同步提示词（自定义）",
          bottomHelpMessage: "指导大模型进行深度历史分析的提示词。选择上方预设会自动填充，也可手动编辑自定义。",
          component: "InputTextArea",
          componentProps: {
            rows: 12,
            placeholder: "选择上方预设或输入自定义提示词..."
          }
        },
        {
          component: "Divider",
          label: "🛠️ 工具配置 (Tool Calling)",
          componentProps: { orientation: "left", plain: true },
        },
        {
          field: "smartMode.tools.enable",
          label: "启用工具调用",
          bottomHelpMessage: "开启后AI可以根据用户意图自动调用工具（戳一戳、点赞、禁言等）。",
          component: "Switch",
        },
        {
          field: 'smartMode.tools.groupList',
          label: '工具生效群聊',
          bottomHelpMessage: '仅在选中的群聊中启用工具调用。留空则在所有群生效。',
          component: 'Select',
          componentProps: {
            allowAdd: true,
            allowDel: true,
            mode: 'multiple',
            options: groupList_total
          }
        },
        {
          field: "smartMode.tools.debugLog",
          label: "工具调用详细日志",
          bottomHelpMessage: "开启后会在控制台输出工具调用的详细信息（请求参数、返回结果等），仅用于调试。",
          component: "Switch",
        },
        {
          component: 'Divider',
          label: '功能分类模型配置（可选）',
          componentProps: {
            orientation: 'left',
            plain: true,
          },
        },
        {
          field: "smartMode.tools.models.toolCallModel",
          label: "🛠️ 工具调用模型",
          bottomHelpMessage: "用于判断是否需要调用工具的模型。必须支持 Function Calling（如 GPT-4、Qwen2.5、DeepSeek）。留空则使用当前对话模型。",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
            placeholder: '使用当前对话模型',
          },
        },
        {
          field: "smartMode.tools.models.visionModel",
          label: "👁️ 视觉理解模型",
          bottomHelpMessage: "用于理解图片内容的模型。需要视觉能力（如 GPT-4V、Gemini Pro Vision、Qwen-VL）。留空则使用当前对话模型。",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
            placeholder: '使用当前对话模型',
          },
        },
        {
          field: "smartMode.tools.models.drawingModel",
          label: "🎨 AI绘图模型",
          bottomHelpMessage: "用于生成图片的模型。需要文生图能力（如 DALL-E、Stable Diffusion、Midjourney）。留空则使用 SiliconFlow 画图配置。",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
            placeholder: '使用 SF 画图配置',
          },
        },
        {
          field: "smartMode.tools.models.searchModel",
          label: "🔍 搜索增强模型",
          bottomHelpMessage: "用于处理搜索结果的模型。建议选择擅长长文本处理的模型。留空则使用当前对话模型。",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
            placeholder: '使用当前对话模型',
          },
        },
        {
          field: "smartMode.tools.models.chatModel",
          label: "💬 对话生成模型",
          bottomHelpMessage: "用于生成最终回复的模型。这是用户看到的主要回复，建议选择对话流畅的模型。留空则使用当前对话模型。",
          component: "Select",
          componentProps: {
            options: smartModelOptions,
            placeholder: '使用当前对话模型',
          },
        },
        {
          component: 'Divider',
          componentProps: {
            orientation: 'left',
            plain: true,
          },
        },
        {
          field: "smartMode.tools.enabledTools",
          label: "启用的工具",
          bottomHelpMessage: "选择要启用的工具，推荐根据群聊实际需求选择。工具越多，AI判断开销越大。",
          component: "Select",
          componentProps: {
            mode: 'multiple',
            options: [
              { label: "🤏 戳一戳", value: "pokeTool" },
              { label: "👍 点赞", value: "likeTool" },
              { label: "🗑️ 撤回消息", value: "recallTool" },
              { label: "🚫 禁言/解禁", value: "muteTool" },
              { label: "👤 查询成员信息", value: "memberInfoTool" },
              { label: "🔍 网络搜索", value: "searchTool" },
              { label: "🖼️ 图片搜索", value: "imageSearchTool" },
              { label: "🎵 音乐搜索", value: "musicTool" },
              { label: "🌤️ 天气查询", value: "weatherTool" },
              { label: "🌐 翻译", value: "translateTool" },
              { label: "🔗 网页解析", value: "webParserTool" },
              { label: "⏰ 定时提醒", value: "reminderTool" },
              { label: "🎨 AI绘图", value: "drawTool" },
              { label: "💬 聊天历史", value: "chatHistoryTool" }
            ]
          },
        },
        {
          field: "smartMode.tools.maxToolRounds",
          label: "最大工具调用轮数",
          bottomHelpMessage: "单次对话中最多进行几轮工具调用。设置过大可能导致对话时间过长。",
          component: "InputNumber",
          componentProps: { min: 1, max: 10, step: 1, defaultValue: 5 },
        },
        {
          component: 'Divider',
          label: '搜索工具配置',
          componentProps: { orientation: 'left', plain: true },
        },
        {
          field: "smartMode.tools.searchConfig.maxKeywords",
          label: "最大关键词数",
          bottomHelpMessage: "单次搜索最多使用几个关键词。多个关键词可获取更全面信息，但会增加 Token 消耗。推荐：3",
          component: "InputNumber",
          componentProps: { min: 1, max: 5, step: 1, defaultValue: 3 },
        },
        {
          field: "smartMode.tools.searchConfig.maxResults",
          label: "每关键词结果数",
          bottomHelpMessage: "每个关键词返回几条搜索结果。推荐：3",
          component: "InputNumber",
          componentProps: { min: 1, max: 10, step: 1, defaultValue: 3 },
        },
        {
          field: "smartMode.tools.searchConfig.maxTotalResults",
          label: "总计最大结果数",
          bottomHelpMessage: "单次搜索总计最多返回几条结果（去重后）。推荐：10",
          component: "InputNumber",
          componentProps: { min: 5, max: 20, step: 1, defaultValue: 10 },
        },
        {
          field: "smartMode.tools.searchConfig.maxRounds",
          label: "搜索轮数",
          bottomHelpMessage: "进行几轮搜索（使用不同引擎或时间间隔）。增加轮数可提升全面性但耗时更长。推荐：1",
          component: "InputNumber",
          componentProps: { min: 1, max: 3, step: 1, defaultValue: 1 },
        },
        {
          field: "smartMode.tools.searchConfig.searxngUrl",
          label: "SearXNG 地址",
          bottomHelpMessage: "可选：自建 SearXNG 实例地址（如 https://searx.example.com），提供更稳定的搜索。留空使用 DuckDuckGo。",
          component: "Input",
          componentProps: { placeholder: 'https://searx.example.com' },
        },
        {
          field: "smartMode.tools.searchConfig.forwardReference",
          label: "转发搜索来源",
          bottomHelpMessage: "开启后，搜索结果链接会以转发消息（合并消息）形式发送，避免刷屏且更美观。",
          component: "Switch",
        },
        {
          field: "smartMode.tools.searchConfig.showThinkingTip",
          label: "显示搜索提示",
          bottomHelpMessage: "搜索前是否发送提示消息（如'派蒙帮你去搜索一下哦'）。",
          component: "Switch",
        },
        {
          field: "smartMode.tools.searchConfig.thinkingTipMsg",
          label: "搜索提示语",
          bottomHelpMessage: "搜索前发送的提示消息内容。",
          component: "Input",
          componentProps: { placeholder: '派蒙帮你去搜索一下哦，稍等片刻~' },
        },
        {
          field: "smartMode.tools.searchConfig.useEmojiReaction",
          label: "使用表情回应",
          bottomHelpMessage: "NapCat等协议支持的表情回应功能。开启后搜索时会用表情回应原消息表示思考中。",
          component: "Switch",
        },
        {
          field: "smartMode.tools.searchConfig.thinkingEmoji",
          label: "思考表情ID",
          bottomHelpMessage: "搜索时使用的表情ID。NapCat 可用 176（搜索/思考表情），其他协议请参考对应文档。",
          component: "Input",
          componentProps: { placeholder: '176' },
        },
        {
          label: '视频解析',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          field: "douyinTV",
          label: "抖音解析",
          bottomHelpMessage: "启用抖音解析；需要安装 Python3 和 依赖 pip install aiohttp ；此开关重启生效",
          component: "Switch",
        },
        {
          field: "kuaishouTV",
          label: "快手解析",
          bottomHelpMessage: "启用快手解析；需要安装 Python3 和 依赖 pip3 install requests ；此开关重启生效",
          component: "Switch",
        },
        {
          field: 'turnOnBilitv',
          label: 'b站解析',
          bottomHelpMessage: '开启b站后，将会解析并发送bilibili链接或小程序关联的视频；此开关重启生效',
          component: 'Switch'
        },
        {
          field: 'video_maxSizeMB',
          label: '视频大小限制',
          bottomHelpMessage: 'b站、抖音解析视频容量超过该值将不会下载，防止发送信息时爆内存重启；此值重启生效',
          helpMessage: '单位：MB',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            step: 1
          }
        },
        {
          label: '帮助',
          component: 'SOFT_GROUP_BEGIN'
        },
        {
          component: 'Divider',
          label: '配置教程',
          componentProps: {
            orientation: 'left',
            plain: true,
          },
        },
        {
          field: 'readme',
          label: '插件首页（必读） 🍌',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://github.com/AIGC-Yunzai/siliconflow-plugin'
          }
        },
        {
          field: 'tutorial_link',
          label: '绘画&对话接口配置教程 🍈',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://aigc-yunzai.me/siliconflow/%E5%A6%82%E4%BD%95%E9%85%8D%E7%BD%AE'
          }
        },
        {
          field: 'openrouter_helper',
          label: '手办化ai生图配置教程 🍉',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://github.com/AIGC-Yunzai/siliconflow-plugin/blob/main/docs/openrouter_ai.md'
          }
        },
        {
          field: 'moscope_helper',
          label: '魔塔绘画配置教程 🍇',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://github.com/AIGC-Yunzai/siliconflow-plugin/blob/main/docs/moscope.md'
          }
        },
        {
          component: 'Divider',
          label: '辅助工具',
          componentProps: {
            orientation: 'left',
            plain: true,
          },
        },
        {
          field: 'tags_link',
          label: 'AI画图Tags生产站 🥭',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://nai4-tag-select.pages.dev/'
          }
        },
        {
          field: 'slink_link',
          label: '直链服务器 🍎',
          component: 'Input',
          componentProps: {
            readonly: true,
            defaultValue: 'https://huggingface.co/spaces/xiaozhian/slink/tree/main?duplicate=true'
          }
        },
      ],
      getConfigData() {
        let config = Config.getConfig()
        config.config_presets = Config.getConfig("presets")

        return config
      },

      setConfigData(data, { Result }) {
        let config = Config.getConfig()
        let config_presets = Config.getConfig("presets")

        // 根据 带点的路径 对 config 赋值
        for (let [keyPath, value] of Object.entries(data)) {
          // 注意: data 并不存在 data['config_presets'] ，仅存在 带点的路径
          if (keyPath.startsWith("config_presets.")) {
            lodash.set(config_presets, keyPath.replace(/^config_presets\./, ""), value);
          } else {
            lodash.set(config, keyPath, value)
          }
        }

        // 验证配置
        try {
          Config.validateConfig(config)
        } catch (err) {
          return Result.error('配置验证失败: ' + err.message)
        }

        config.sfBaseUrl = config.sfBaseUrl.replace(/\/$/, '')
        config.mj_apiBaseUrl = config.mj_apiBaseUrl.replace(/\/$/, '')
        config.mj_translationBaseUrl = config.mj_translationBaseUrl.replace(/\/$/, '')

        try {
          const saved = Config.setConfig(config)
          const saved_presets = Config.setConfig(config_presets, "presets")
          if (!saved || !saved_presets) {
            return Result.error('保存失败，请查看控制台')
          }
          return Result.ok({}, '保存成功~')
        } catch (err) {
          return Result.error('保存失败: ' + err.message)
        }
      },
    },
  }
}
