# 三国杀助手 REST API

基于 FastAPI 的三国杀游戏数据 REST API。

## 运行

```bash
cd api
pip install fastapi uvicorn
uvicorn main:app --reload --port 8100
```

## API 文档

启动后访问 `http://localhost:8100/docs` 查看自动生成的 Swagger UI。

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/version | 版本信息 |
| GET | /api/heroes | 武将列表（支持筛选） |
| GET | /api/heroes/{name} | 武将详情 |
| GET | /api/tags | 所有标签 |
| GET | /api/cards | 卡牌列表（支持筛选） |
| GET | /api/cards/{name} | 卡牌详情 |
| GET | /api/rules | 游戏规则 |
| GET | /api/synergy/{name} | 武将搭配推荐 |
| GET | /api/teams | 阵容推荐 |
| GET | /api/search?q= | 全文搜索 |
