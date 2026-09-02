"""
三国杀助手 REST API
从 data.js 提取的完整游戏数据，通过 FastAPI 提供 REST 接口。
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ============================================================
# 数据加载
# ============================================================

DATA_FILE = Path(__file__).parent / "data.json"

with open(DATA_FILE, "r", encoding="utf-8") as f:
    DATA = json.load(f)

HEROES = DATA["HEROES"]
ALL_TAGS = DATA["ALL_TAGS"]
SYNERGIES = DATA["SYNERGIES"]
GENERAL_TIP = DATA["GENERAL_TIP"]
TEAM_COMPOSITIONS = DATA["TEAM_COMPOSITIONS"]
CARDS = DATA["CARDS"]
RULES = DATA["RULES"]
VERSION = DATA["VERSION"]

# 构建索引（快速查找）
HEROES_BY_NAME = {h["name"]: h for h in HEROES}
ALL_CARDS = (
    [{"category": "basic", **c} for c in CARDS["basic_cards"]]
    + [{"category": "trick", **c} for c in CARDS["trick_cards"]]
    + [{"category": "equipment", **c} for c in CARDS["equipment_cards"]]
)
CARDS_BY_NAME = {c["name"]: c for c in ALL_CARDS}

# ============================================================
# FastAPI 应用
# ============================================================

app = FastAPI(
    title="三国杀助手 API",
    description=f"数据版本: {VERSION} | {len(HEROES)} 武将, {len(ALL_TAGS)} 标签, {len(ALL_CARDS)} 卡牌",
    version=VERSION,
)

# CORS — 允许前端直接调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 路由
# ============================================================

@app.get("/api/version")
async def get_version():
    """获取数据版本"""
    return {"version": VERSION, "heroes_count": len(HEROES), "cards_count": len(ALL_CARDS)}


@app.get("/api/heroes")
async def get_heroes(
    faction: Optional[str] = Query(None, description="势力筛选: 蜀/魏/吴/群"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    q: Optional[str] = Query(None, description="名称搜索"),
):
    """获取武将列表，支持势力、标签、名称筛选"""
    result = HEROES

    if faction:
        result = [h for h in result if h["faction"] == faction]

    if tag:
        result = [h for h in result if tag in h.get("tags", [])]

    if q:
        q_lower = q.lower()
        result = [
            h for h in result
            if q_lower in h["name"].lower() or q_lower in h.get("title", "").lower()
        ]

    return {"count": len(result), "heroes": result}


@app.get("/api/heroes/{name}")
async def get_hero(name: str):
    """获取武将详情"""
    hero = HEROES_BY_NAME.get(name)
    if not hero:
        raise HTTPException(status_code=404, detail=f"武将 '{name}' 不存在")

    # 附加额外信息
    hero_with_extras = dict(hero)
    hero_with_extras["tags_detail"] = hero.get("tags", [])

    synergy = SYNERGIES.get(name)
    if synergy:
        hero_with_extras["synergy"] = synergy

    return hero_with_extras


@app.get("/api/tags")
async def get_tags():
    """获取所有标签"""
    return {"count": len(ALL_TAGS), "tags": ALL_TAGS}


@app.get("/api/cards")
async def get_cards(
    type: Optional[str] = Query(None, description="类型筛选: basic/trick/equipment"),
    q: Optional[str] = Query(None, description="名称搜索"),
):
    """获取卡牌列表"""
    result = ALL_CARDS

    if type:
        type_map = {"basic": "基本牌", "trick": "锦囊", "equipment": "装备"}
        filter_text = type_map.get(type, type)
        result = [c for c in result if filter_text in c.get("type", "")]

    if q:
        q_lower = q.lower()
        result = [c for c in result if q_lower in c["name"].lower()]

    return {"count": len(result), "cards": result}


@app.get("/api/cards/{name}")
async def get_card(name: str):
    """获取卡牌详情"""
    card = CARDS_BY_NAME.get(name)
    if not card:
        raise HTTPException(status_code=404, detail=f"卡牌 '{name}' 不存在")
    return card


@app.get("/api/rules")
async def get_rules():
    """获取游戏规则"""
    return RULES


@app.get("/api/synergy/{name}")
async def get_synergy(name: str):
    """获取武将搭配推荐"""
    if name not in HEROES_BY_NAME:
        raise HTTPException(status_code=404, detail=f"武将 '{name}' 不存在")

    synergy = SYNERGIES.get(name)
    if not synergy:
        return {"name": name, "synergy": GENERAL_TIP}

    return {"name": name, "synergy": synergy}


@app.get("/api/teams")
async def get_teams():
    """获取阵容推荐"""
    return {"compositions": TEAM_COMPOSITIONS}


@app.get("/api/search")
async def search(q: str = Query(..., description="搜索关键词")):
    """全文搜索 — 同时搜索武将和卡牌"""
    q_lower = q.lower()

    hero_results = [
        {
            "type": "hero",
            "name": h["name"],
            "title": h.get("title", ""),
            "faction": h["faction"],
        }
        for h in HEROES
        if q_lower in h["name"].lower()
        or q_lower in h.get("title", "").lower()
        or any(q_lower in t.lower() for t in h.get("tags", []))
    ]

    card_results = [
        {
            "type": "card",
            "name": c["name"],
            "card_type": c.get("type", ""),
        }
        for c in ALL_CARDS
        if q_lower in c["name"].lower()
        or q_lower in c.get("description", "").lower()
    ]

    return {
        "query": q,
        "heroes": hero_results,
        "cards": card_results,
        "total": len(hero_results) + len(card_results),
    }


@app.get("/")
async def root():
    """API 根路径"""
    return {
        "name": "三国杀助手 API",
        "version": VERSION,
        "endpoints": [
            "/api/version",
            "/api/heroes",
            "/api/heroes/{name}",
            "/api/tags",
            "/api/cards",
            "/api/cards/{name}",
            "/api/rules",
            "/api/synergy/{name}",
            "/api/teams",
            "/api/search?q=",
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
