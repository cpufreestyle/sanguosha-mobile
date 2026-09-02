// AI 视觉识别配置（示例文件）
// 复制为 config.js 并填入 API Key 即可覆盖 app.js 中的默认配置
//
// cp config.example.js config.js
//
// 注意：
// 1. config.js 已在 .gitignore 中，不会被提交到仓库
// 2. 必须使用 window.CONFIG / window.VISION_CONFIG 赋值形式，
//    不要用 const 声明（会与 app.js 的声明冲突导致整个应用无法启动）

window.CONFIG = {
  API_URL: 'http://localhost:8100',
  USE_API: true,
};

window.VISION_CONFIG = {
  providers: [
    {
      name: 'ollama',
      label: '本地/手机 Ollama (推荐)',
      endpoint: 'http://localhost:11434/api/generate',
      // model 可留作占位：app.js 启动时会查询 /api/tags 自动检测
      // 已安装的视觉模型（capabilities 含 vision）并切换，手机 Termux / 电脑均适用
      model: 'llama3.2-vision:11b',
      type: 'ollama'
    },
    {
      name: 'openai',
      label: 'OpenAI GPT-4o',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      type: 'openai',
      apiKey: '' // 在此填入你的 OpenAI API Key
    },
    {
      name: 'openrouter',
      label: 'OpenRouter (DeepSeek VL)',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'deepseek-ai/deepseek-vl2:latest',
      type: 'openai',
      apiKey: '' // 在此填入你的 OpenRouter API Key
    }
  ],
  activeProvider: 'ollama',
  timeout: 60000 // 手机端 Ollama 推理较慢，视觉识别给足超时
};

window.VISION_SYSTEM_PROMPT = `你是一个三国杀游戏助手，专门识别游戏画面中的武将和卡牌。

三国杀标准版包含以下武将：
蜀国：刘备、关羽、张飞、诸葛亮、赵云
魏国：曹操、司马懿
吴国：孙权
群雄：吕布、貂蝉

三国杀标准版卡牌：
基本牌：杀、闪、桃
普通锦囊：决斗、过河拆桥、顺手牵羊、无中生有、南蛮入侵、万箭齐发、五谷丰登、桃园结义
延时锦囊：乐不思蜀、闪电
装备-武器：诸葛连弩、青釭剑、丈八蛇矛、贯石斧、青龙偃月刀
装备-防具：八卦阵、仁王盾
装备-马：+1马、-1马

请仔细分析图片，返回JSON格式的识别结果：
{
  "type": "hero" | "card" | "unknown",
  "name": "识别到的武将/卡牌名称",
  "confidence": 0.0-1.0,
  "description": "简要描述",
  "details": "如果是武将，提供技能信息；如果是卡牌，提供效果说明"
}

如果图片中包含多个武将/卡牌，返回数组格式。如果无法确定，返回 type: "unknown"。`;
