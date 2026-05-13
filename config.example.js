// AI 视觉识别配置（示例文件，复制为 config.js 并填入 API Key）
const VISION_CONFIG = {
  providers: [
    {
      name: 'ollama',
      label: '本地 Ollama (推荐)',
      endpoint: 'http://localhost:11434/api/generate',
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
  timeout: 30000
};

function getActiveProvider() {
  return VISION_CONFIG.providers.find(p => p.name === VISION_CONFIG.activeProvider) || VISION_CONFIG.providers[0];
}

const VISION_SYSTEM_PROMPT = `你是一个三国杀游戏助手...`;
