# 三国杀助手 - 摄像头视觉识别功能

## 功能设计

### 新增「📷 识别」Tab
- 实时摄像头取景框
- 拍照按钮捕获画面
- AI 视觉识别武将/卡牌
- 识别结果高亮显示 + 详情弹窗

### 技术方案
- **摄像头**: WebRTC `getUserMedia` API（移动端兼容）
- **AI 视觉**: 支持 OpenAI GPT-4o Vision / 腾讯混元多模态 / 本地 LLM Vision
- **权限**: `manifest.json` 新增 `camera` 权限声明

### 识别流程
1. 打开摄像头 → 实时预览
2. 点击拍照 → 截取当前帧
3. 上传图片到 AI 视觉 API
4. AI 返回识别结果（武将名/卡牌名）
5. 自动匹配数据库 → 展示详细信息

### API 选择逻辑
1. 优先使用本地 Ollama Vision 模型（最快）
2. 其次 OpenAI GPT-4o Vision
3. 最后腾讯混元（需申请）
4. 配置写入 `config.js`

## 文件改动
- `index.html` — 新增识别 Tab 结构和样式
- `app.js` — 摄像头逻辑 + AI 识别流程
- `manifest.json` — camera 权限
- `config.js` — AI API 配置（新建）
