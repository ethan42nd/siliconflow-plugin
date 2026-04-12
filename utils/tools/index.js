import { AbstractTool } from './AbstractTool.js'
import { PokeTool } from './PokeTool.js'
import { LikeTool } from './LikeTool.js'
import { RecallTool } from './RecallTool.js'
import { MuteTool } from './MuteTool.js'
import { MemberInfoTool } from './MemberInfoTool.js'
import { SearchTool } from './SearchTool.js'
import { ImageSearchTool } from './ImageSearchTool.js'
import { MusicTool } from './MusicTool.js'
import { WeatherTool } from './WeatherTool.js'
import { TranslateTool } from './TranslateTool.js'
import { WebParserTool } from './WebParserTool.js'
import { ReminderTool, checkPendingReminders } from './ReminderTool.js'
import { DrawTool } from './DrawTool.js'
import { ChatHistoryTool } from './ChatHistoryTool.js'

export {
  AbstractTool,
  PokeTool,
  LikeTool,
  RecallTool,
  MuteTool,
  MemberInfoTool,
  SearchTool,
  ImageSearchTool,
  MusicTool,
  WeatherTool,
  TranslateTool,
  WebParserTool,
  ReminderTool,
  checkPendingReminders,
  DrawTool,
  ChatHistoryTool
}

export const TOOL_MAP = {
  pokeTool: PokeTool,
  likeTool: LikeTool,
  recallTool: RecallTool,
  muteTool: MuteTool,
  memberInfoTool: MemberInfoTool,
  searchTool: SearchTool,
  imageSearchTool: ImageSearchTool,
  musicTool: MusicTool,
  weatherTool: WeatherTool,
  translateTool: TranslateTool,
  webParserTool: WebParserTool,
  reminderTool: ReminderTool,
  drawTool: DrawTool,
  chatHistoryTool: ChatHistoryTool
}

export const TOOL_CONFIG = [
  { key: 'pokeTool', name: '戳一戳', description: '对群成员进行戳一戳操作' },
  { key: 'likeTool', name: '点赞', description: '给群成员点赞' },
  { key: 'recallTool', name: '撤回消息', description: '撤回指定消息' },
  { key: 'muteTool', name: '禁言', description: '对群成员进行禁言/解禁操作' },
  { key: 'memberInfoTool', name: '查询成员信息', description: '查询群成员的详细信息' },
  { key: 'searchTool', name: '网络搜索', description: '进行网络搜索获取实时信息' },
  { key: 'imageSearchTool', name: '图片搜索', description: '根据关键词搜索图片' },
  { key: 'musicTool', name: '音乐搜索', description: '搜索并发送音乐' },
  { key: 'weatherTool', name: '天气查询', description: '查询指定城市的天气' },
  { key: 'translateTool', name: '翻译', description: '翻译文本内容' },
  { key: 'webParserTool', name: '网页解析', description: '解析网页链接内容' },
  { key: 'reminderTool', name: '定时提醒', description: '创建定时提醒' },
  { key: 'drawTool', name: 'AI绘图', description: '根据描述生成图片' },
  { key: 'chatHistoryTool', name: '聊天历史', description: '获取群聊历史消息' }
]
