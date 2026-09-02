// 三国杀助手 - 移动端应用逻辑

// ===== 默认配置（可被 config.js 覆盖） =====
const CONFIG = window.CONFIG || { API_URL: 'http://localhost:8100', USE_API: true };
const VISION_CONFIG = window.VISION_CONFIG || {
  providers: [
    { name: 'ollama', label: '本地/手机 Ollama', endpoint: 'http://localhost:11434/api/generate', model: 'llama3.2-vision:11b', type: 'ollama' },
    { name: 'openai', label: 'OpenAI GPT-4o', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', type: 'openai', apiKey: '' },
    { name: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek-ai/deepseek-vl2:latest', type: 'openai', apiKey: '' },
  ],
  activeProvider: 'ollama',
  timeout: 60000,
};
function getActiveProvider() {
  return VISION_CONFIG.providers.find(p => p.name === VISION_CONFIG.activeProvider) || VISION_CONFIG.providers[0];
}
const VISION_SYSTEM_PROMPT = window.VISION_SYSTEM_PROMPT || `你是一个三国杀游戏助手，专门识别游戏画面中的武将和卡牌。\n请仔细分析图片，返回JSON格式的识别结果：{"type":"hero"|"card"|"unknown","name":"名称","confidence":0.0-1.0,"description":"简要描述"}`;

let currentTab = 'heroes';
let heroFilter = { faction: 'all', search: '', tag: 'all' };
let cardFilter = { type: 'all', search: '', expansion: 'all' };
let deferredPrompt = null;

// ===== CAMERA STATE =====
let cameraStream = null;
let currentFacing = 'environment';
let cameraActive = false;

// ===== API STATE =====
let SGS_API_BASE = CONFIG.API_URL || 'http://localhost:8100';
let SGS_API_ENABLED = CONFIG.USE_API !== false;
let SGS_API_AVAILABLE = false;

// ===== FACTS MAP (for local fallback) =====
const FACTS_MAP = {};

// ===== CACHED CARD LIST =====
let _allCardsCache = null;

// Build facts map from HEROES and CARDS
function buildFacts() {
  Object.keys(FACTS_MAP).forEach(k => delete FACTS_MAP[k]);
  if (typeof HEROES !== 'undefined') {
    HEROES.forEach(h => { FACTS_MAP[h.name] = { type: 'hero', data: h, name: h.name }; });
  }
  if (typeof CARDS !== 'undefined') {
    getAllCards().forEach(c => { FACTS_MAP[c.name] = { type: 'card', data: c, name: c.name }; });
  }
}

// Initial build from data.js (fallback)
buildFacts();

// ===== DEBOUNCE HELPER =====
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ===== API LOADER =====
async function loadFromAPI() {
  if (!SGS_API_ENABLED) return false;
  try {
    const resp = await fetch(`${SGS_API_BASE}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const info = await resp.json();
    console.log(`[SGS] API v${info.version} 已连接 — ${info.heroes_count} 武将, ${info.cards_count} 卡牌`);

    // 并行加载所有数据
    const [heroesRes, tagsRes, cardsRes, rulesRes, teamsRes] = await Promise.all([
      fetch(`${SGS_API_BASE}/api/heroes`).then(r => r.json()),
      fetch(`${SGS_API_BASE}/api/tags`).then(r => r.json()),
      fetch(`${SGS_API_BASE}/api/cards`).then(r => r.json()),
      fetch(`${SGS_API_BASE}/api/rules`).then(r => r.json()),
      fetch(`${SGS_API_BASE}/api/teams`).then(r => r.json()),
    ]);

    // 替换全局数据
    window.HEROES = heroesRes.heroes;
    window.ALL_TAGS = tagsRes.tags;
    window.CARDS = {
      basic_cards: cardsRes.cards.filter(c => c.category === 'basic'),
      trick_cards: cardsRes.cards.filter(c => c.category === 'trick'),
      equipment_cards: cardsRes.cards.filter(c => c.category === 'equipment'),
    };
    window.RULES = rulesRes;
    window.TEAM_COMPOSITIONS = teamsRes.compositions;

    // 加载每个武将的搭配数据
    const synergyPromises = heroesRes.heroes.map(h =>
      fetch(`${SGS_API_BASE}/api/synergy/${encodeURIComponent(h.name)}`).then(r => r.json()).catch(() => null)
    );
    const synergyResults = await Promise.all(synergyPromises);
    window.SYNERGIES = {};
    synergyResults.forEach(s => {
      if (s && s.synergy) window.SYNERGIES[s.name] = s.synergy;
    });

    // 重置卡片缓存（数据可能已被 API 替换）
    _allCardsCache = null;
    SGS_API_AVAILABLE = true;
    console.log('[SGS] API 数据加载完成');
    return true;
  } catch (e) {
    console.warn('[SGS] API 不可用，使用本地数据:', e.message);
    SGS_API_AVAILABLE = false;
    return false;
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // 先尝试从 API 加载
  await loadFromAPI();

  renderHeroes();
  renderAskExamples();
  setupInstallBanner();
  setupCameraTab();
  setupDistCalc();
  setupAskMic();
  initVoiceUI();
  detectPhoneModel(); // 手机/本机 Ollama 模型自动检测（异步，不阻塞渲染）

  // 显示数据来源
  const sourceBadge = SGS_API_AVAILABLE ? '🌐 API' : '📱 本地';
  console.log(`[SGS] 数据来源: ${sourceBadge}`);

  // 异步检查热更新（不阻塞首屏）
  setTimeout(() => checkForUpdates(false), 2500);
});

// ===== TABS =====
const _renderedTabs = new Set(['heroes']);
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab + 'Page';
    document.getElementById(id).classList.add('active');
    currentTab = tab.dataset.tab;

    // Lazy render on first visit
    if (!_renderedTabs.has(currentTab)) {
      if (currentTab === 'cards') renderCards();
      if (currentTab === 'rules') renderRules();
      _renderedTabs.add(currentTab);
    }

    if (currentTab === 'ask') {
      document.getElementById('askResult').innerHTML = '';
    }
    if (currentTab === 'camera') {
      // Auto start camera when entering tab
      startCamera();
    } else {
      stopCamera();
    }
    // 离开出牌页时关闭手牌拍照弹窗，释放摄像头
    if (currentTab !== 'advice') {
      closeAdviceCamera();
    }
    if (currentTab === 'team') {
      renderTeamResult();
    }
  });
});

// ===== HEROES =====
function renderHeroes(heroes = HEROES) {
  const list = document.getElementById('heroList');
  const filtered = heroes.filter(h => {
    if (heroFilter.faction !== 'all' && h.faction !== heroFilter.faction) return false;
    if (heroFilter.search) {
      const s = heroFilter.search.toLowerCase();
      if (!h.name.toLowerCase().includes(s) && !h.title.toLowerCase().includes(s)) return false;
    }
    if (heroFilter.tag !== 'all') {
      const tags = h.tags || [];
      if (!tags.includes(heroFilter.tag)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="not-found">没有找到匹配的武将</div>';
    return;
  }

  list.innerHTML = filtered.map(h => {
    const tags = h.tags || [];
    const tagsHtml = tags.length > 0 ? `<div class="hero-tags">${tags.slice(0, 5).map(t => `<span class="hero-tag">${t}</span>`).join('')}</div>` : '';
    return `<div class="hero-card" onclick="toggleHero(this)" data-hero="${h.name}">
      <div class="hero-card-header">
        <div class="hero-avatar faction-${h.faction}">${h.name[0]}</div>
        <div>
          <div class="hero-name">${h.name} <span style="font-size:11px;color:var(--text2)">${h.title}</span></div>
          <div class="hero-health">⚔️ ${h.faction} &nbsp; ❤️ ${h.health}体力</div>
          ${tagsHtml}
        </div>
        <div class="hero-arrow">▼</div>
      </div>
      <div class="hero-skills">
        ${h.skills.map(s => `
          <div class="skill-item">
            <div class="skill-name">【${s.name}】<span class="skill-type">${s.type}</span></div>
            <div class="skill-desc">${s.description}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleHero(card) {
  card.classList.toggle('open');
}

document.getElementById('heroSearch').addEventListener('input', debounce(e => {
  heroFilter.search = e.target.value;
  renderHeroes();
}, 200));

document.getElementById('factionPills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#factionPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  heroFilter.faction = pill.dataset.faction;
  renderHeroes();
});

// Tag pills
document.getElementById('tagPills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#tagPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  heroFilter.tag = pill.dataset.tag;
  renderHeroes();
});

// ===== CARDS =====
function getAllCards() {
  if (!_allCardsCache) {
    _allCardsCache = [
      ...CARDS.basic_cards.map(c => ({ ...c, _cat: 'basic' })),
      ...CARDS.trick_cards.map(c => ({ ...c, _cat: 'trick' })),
      ...CARDS.equipment_cards.map(c => ({ ...c, _cat: 'equipment' }))
    ];
  }
  return _allCardsCache;
}

function cardCssClass(cat, name) {
  if (name.includes('马')) return 'horse-card';
  if (cat === 'basic') return 'basic-card';
  if (cat === 'trick') return 'trick-card';
  return 'equip-card';
}

function renderCards() {
  const container = document.getElementById('cardList');
  const all = getAllCards().filter(c => {
    if (cardFilter.type !== 'all' && c._cat !== cardFilter.type) return false;
    if (cardFilter.expansion === 'standard' && c.expansion === '军争') return false;
    if (cardFilter.expansion === 'military' && c.expansion !== '军争') return false;
    if (cardFilter.search) {
      const s = cardFilter.search.toLowerCase();
      if (!c.name.toLowerCase().includes(s) && !c.type.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  if (all.length === 0) {
    container.innerHTML = '<div class="not-found">没有找到匹配的卡牌</div>';
    return;
  }

  const groups = {
    basic: all.filter(c => c._cat === 'basic'),
    trick: all.filter(c => c._cat === 'trick'),
    equipment: all.filter(c => c._cat === 'equipment')
  };

  let html = '';

  if (groups.basic.length > 0 && (cardFilter.type === 'all' || cardFilter.type === 'basic')) {
    html += `<div class="card-section"><div class="section-title">🔴 基本牌</div>${groups.basic.map(c => cardHTML(c)).join('')}</div>`;
  }
  if (groups.trick.length > 0 && (cardFilter.type === 'all' || cardFilter.type === 'trick')) {
    html += `<div class="card-section"><div class="section-title">🟣 锦囊牌</div>${groups.trick.map(c => cardHTML(c)).join('')}</div>`;
  }
  if (groups.equipment.length > 0 && (cardFilter.type === 'all' || cardFilter.type === 'equipment')) {
    html += `<div class="card-section"><div class="section-title">🔵 装备牌</div>${groups.equipment.map(c => cardHTML(c)).join('')}</div>`;
  }

  container.innerHTML = html;
}

function cardHTML(c) {
  return `
    <div class="card-item" onclick="toggleCard(this)">
      <div class="card-header">
        <div class="card-icon ${cardCssClass(c._cat, c.name)}">${c.name}</div>
        <div>
          <div class="card-name">【${c.name}】${c.expansion === '军争' ? '<span style="font-size:10px;color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:1px 5px;margin-left:4px;vertical-align:2px">军争</span>' : ''}</div>
          <div class="card-type-label">${c.type}</div>
        </div>
        <div class="card-arrow">▼</div>
      </div>
      <div class="card-detail">
        <div>${c.description}</div>
        ${c.notes ? `<div class="card-note">📌 ${c.notes}</div>` : ''}
        ${c.attack_range ? `<div class="card-note">⚔️ 攻击范围：${c.attack_range}</div>` : ''}
      </div>
    </div>
  `;
}

function toggleCard(item) {
  item.classList.toggle('open');
}

document.getElementById('cardSearch').addEventListener('input', debounce(e => {
  cardFilter.search = e.target.value;
  renderCards();
}, 200));

document.getElementById('cardTypePills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#cardTypePills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  cardFilter.type = pill.dataset.type;
  renderCards();
});

document.getElementById('cardExpansionPills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#cardExpansionPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  cardFilter.expansion = pill.dataset.exp;
  renderCards();
});

// ===== RULES =====
function renderRules() {
  const list = document.getElementById('rulesList');
  let html = '';

  // Basic rules
  RULES.basic_rules.forEach(r => {
    html += `
      <div class="rule-card">
        <div class="rule-header" onclick="toggleRule(this.parentElement)">
          <span>📖 ${r.title}</span>
          <span class="rule-arrow">▼</span>
        </div>
        <div class="rule-body">${r.content.replace(/\n/g, '<br/>')}</div>
      </div>
    `;
  });

  // Skill types
  html += `<div class="section-title" style="margin-top:14px">⚡ 技能类型</div>`;
  RULES.skill_types.forEach(s => {
    html += `
      <div class="rule-card">
        <div class="rule-header" onclick="toggleRule(this.parentElement)">
          <span>⚡ ${s.name}</span>
          <span class="rule-arrow">▼</span>
        </div>
        <div class="rule-body">${s.description}</div>
      </div>
    `;
  });

  // FAQ
  html += `<div class="section-title" style="margin-top:14px">❓ 常见问题</div>`;
  RULES.faq.forEach(f => {
    html += `
      <div class="rule-card">
        <div class="rule-header" onclick="toggleRule(this.parentElement)">
          <span>❓ ${f.q}</span>
          <span class="rule-arrow">▼</span>
        </div>
        <div class="rule-body">${f.a}</div>
      </div>
    `;
  });

  list.innerHTML = html;
}

function toggleRule(card) {
  card.classList.toggle('open');
}

// ===== 距离计算器（规则页） =====
function setupDistCalc() {
  const players = document.getElementById('dcPlayers');
  const offset = document.getElementById('dcOffset');
  if (!players || !offset) return;

  function fillOffsets() {
    const n = parseInt(players.value, 10);
    offset.innerHTML = Array.from({ length: n - 1 }, (_, i) =>
      `<option value="${i + 1}" ${i === 0 ? 'selected' : ''}>${i + 1}</option>`
    ).join('');
  }
  fillOffsets();

  function baseDistance(n, k) {
    return Math.min(k, n - k);
  }
  function update() {
    const n = parseInt(players.value, 10);
    const k = parseInt(offset.value, 10);
    const weapon = parseInt(document.getElementById('dcWeapon').value, 10);
    const myMinus = document.getElementById('dcMyMinus').checked;
    const targetPlus = document.getElementById('dcTargetPlus').checked;
    const base = baseDistance(n, k);
    const dist = Math.max(1, base - (myMinus ? 1 : 0) + (targetPlus ? 1 : 0));
    const hit = dist <= weapon;
    document.getElementById('dcResult').innerHTML =
      `基础距离（顺/逆时针取短）：<b>${base}</b><br/>` +
      `实际距离${myMinus ? '（我-1马）' : ''}${targetPlus ? '（目标+1马）' : ''}：<b>${dist}</b> ｜ 你的攻击范围：<b>${weapon}</b><br/>` +
      (hit ? `✅ <b style="color:var(--shu)">可以攻击到</b>` : `❌ <b style="color:var(--wei)">攻击不到</b>（差 ${dist - weapon} 距离，考虑-1马或更远武器）`);
  }
  [players, offset, document.getElementById('dcWeapon'), document.getElementById('dcMyMinus'), document.getElementById('dcTargetPlus')]
    .forEach(el => el.addEventListener('change', () => { if (el === players) fillOffsets(); update(); }));
  update();
}

// ===== ASK =====
function renderAskExamples() {
  const examples = [
    { icon: '🎴', q: '关羽有什么技能？' },
    { icon: '🃏', q: '【南蛮入侵】怎么用？' },
    { icon: '📜', q: '游戏流程是什么？' },
    { icon: '🎴', q: '蜀国有哪些武将？' },
    { icon: '🃏', q: '八卦阵的效果是什么？' },
    { icon: '📜', q: '什么是判定？' }
  ];
  document.getElementById('askExamples').innerHTML = examples.map(e => `
    <div class="ask-example" onclick="askQuestion('${e.q.replace(/'/g, "\\'")}')">
      <span class="ask-example-icon">${e.icon}</span>
      <span>${e.q}</span>
    </div>
  `).join('');

  // 自由输入框回车提交
  document.getElementById('askInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      askQuestion(e.target.value.trim());
      e.target.value = '';
    }
  });
}

function askQuestion(question) {
  const result = document.getElementById('askResult');
  // 眼镜/自动播报：任何方式的提问，回答都口播（眼镜模式常开自动播报）
  const speakAnswer = () => {
    if (!voiceAutoSpeak || !VOICE_SUPPORTED) return;
    const answerEl = document.querySelector('#askResult .ask-result');
    if (answerEl) speak(answerEl.textContent);
  };
  if (askAIMode) {
    result.innerHTML = `
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">👤 ${question}</div>
      <div class="ask-result">🤖 <span class="recog-loading-dot">●●●</span> AI 思考中…</div>
    `;
    askLLM(question)
      .then(answer => {
        const usedModel = getActiveProvider().chatModel || getActiveProvider().model;
        result.innerHTML = `
          <div style="font-size:12px;color:var(--text2);margin-bottom:8px">👤 ${question}</div>
          <div class="ask-result">🤖 ${answer}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">来源：${getActiveProvider().label} · ${usedModel} · 已结合本地资料</div>
        `;
        speakAnswer();
      })
      .catch(err => {
        const answer = getAnswer(question);
        result.innerHTML = `
          <div style="font-size:12px;color:var(--text2);margin-bottom:8px">👤 ${question}</div>
          <div class="ask-result">🤖 ${answer}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ AI 不可用（${err.message}），已回退本地关键词匹配</div>
        `;
        speakAnswer();
      });
    return;
  }
  const answer = getAnswer(question);
  result.innerHTML = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">👤 ${question}</div>
    <div class="ask-result">🤖 ${answer}</div>
  `;
  speakAnswer();
}

// ===== AI 问答（复用视觉识别的 provider 配置做纯文本对话） =====
let askAIMode = false;

function toggleAskAI(pill) {
  askAIMode = !askAIMode;
  pill.classList.toggle('active', askAIMode);
  pill.textContent = askAIMode ? '🤖 AI 问答（开）' : '🤖 AI 问答';
  if (askAIMode) {
    document.getElementById('askResult').innerHTML =
      '<div style="font-size:12px;color:var(--text2);padding:4px 0">AI 模式已开启：回答将结合本地武将/卡牌资料与「' + getActiveProvider().label + '」，未配置服务时自动回退本地匹配。</div>';
  }
}

// 按问题关键词从本地数据库抽取上下文（轻量 RAG）
function buildAskContext(q) {
  const parts = [];
  const cleanQ = q.replace(/【|】/g, '');
  HEROES.forEach(h => {
    if (cleanQ.includes(h.name)) {
      parts.push(`【武将】${h.name}（${h.faction}，${h.health}体力）：` +
        h.skills.map(s => `${s.name}（${s.type}）：${s.description}`).join('；'));
    }
  });
  getAllCards().forEach(c => {
    if (cleanQ.includes(c.name)) {
      parts.push(`【卡牌】${c.name}（${c.type}）：${c.description}${c.notes ? ' 备注：' + c.notes : ''}`);
    }
  });
  (RULES.skill_types || []).forEach(st => {
    if (cleanQ.includes(st.name)) parts.push(`【技能类型】${st.name}：${st.description}`);
  });
  if (!parts.length) {
    parts.push('（问题未命中具体条目，请依据三国杀标准版规则回答，可提及军争篇）');
  }
  return parts.join('\n');
}

async function askLLM(question) {
  const provider = getActiveProvider();
  if (provider.type !== 'ollama' && !provider.apiKey) {
    throw new Error(`「${provider.label}」未配置 API Key`);
  }
  const system = '你是三国杀游戏助手，用简洁的中文回答玩家问题，要点式排版。优先依据下面给出的本地资料回答，资料不足时依据标准版（含军争篇）规则回答，不要编造不存在的武将或卡牌。\n\n本地资料：\n' + buildAskContext(question);
  return await chatText(system, question);
}

// 纯文本对话（ollama / openai 两种 provider）；Ollama 优先用检测到的 thinking 文本模型（如 gemma4）
async function chatText(systemPrompt, userText) {
  const provider = getActiveProvider();
  const chatModel = provider.chatModel || provider.model;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_CONFIG.timeout);
  try {
    let resp;
    if (provider.type === 'ollama') {
      resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          prompt: systemPrompt + '\n\n用户问题：' + userText,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.4 }
        }),
        signal: controller.signal
      });
    } else {
      resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText }
          ],
          max_tokens: 512
        }),
        signal: controller.signal
      });
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`服务返回 ${resp.status}${text ? '：' + text.substring(0, 80) : ''}`);
    }
    const data = await resp.json();
    let content = provider.type === 'ollama' ? data.response : (data.choices?.[0]?.message?.content || '');
    // thinking 模型（gemma4/qwen3.5 等）可能内联思考过程，只保留正文
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!content) throw new Error('服务返回空内容');
    return content.replace(/\n/g, '<br/>');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ===== 语音输入（Web Speech API，不支持则隐藏按钮） =====
function setupAskMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('askMicBtn');
  if (!SR || !btn) return;
  btn.style.display = '';
  let rec = null;
  let listening = false;
  btn.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.onstart = () => {
      listening = true;
      btn.classList.add('active');
      btn.textContent = '🎙️ 听写中…';
    };
    rec.onresult = e => {
      const text = e.results[0][0].transcript.trim();
      const input = document.getElementById('askInput');
      if (text) {
        input.value = text;
        askQuestion(text); // 播报由 askQuestion 统一处理（眼镜场景音频经蓝牙路由到眼镜）
        input.value = '';
      }
    };
    const reset = () => {
      listening = false;
      btn.classList.remove('active');
      btn.textContent = '🎤 语音';
    };
    rec.onend = reset;
    rec.onerror = reset;
    rec.start();
  });
}

function getAnswer(q) {
  q = q.trim();

  // Hero match
  for (const h of HEROES) {
    if (q.includes(h.name)) {
      return `【${h.name}】（${h.title}）\n` +
        `势力：${h.faction} | 体力：${h.health}\n\n` +
        h.skills.map(s => `【${s.name}】（${s.type}）：${s.description}`).join('\n\n');
    }
  }

  // Faction heroes
  for (const fname of ['蜀', '魏', '吴', '群']) {
    if (q.includes(fname + '国') || q.includes(fname)) {
      const heroes = HEROES.filter(h => h.faction === fname);
      return `【${fname}势力武将】共${heroes.length}位：\n` +
        heroes.map(h => `• ${h.name}（${h.title}）`).join('\n');
    }
  }

  // Card match
  const cleanQ = q.replace(/【|】/g, '');
  for (const c of getAllCards()) {
    if (cleanQ.includes(c.name) || c.name.includes(cleanQ)) {
      let result = `【${c.name}】（${c.type}）\n效果：${c.description}`;
      if (c.notes) result += `\n📌 ${c.notes}`;
      if (c.attack_range) result += `\n⚔️ 攻击范围：${c.attack_range}`;
      return result;
    }
  }

  // Card type
  if (q.includes('基本牌')) return '基本牌包括：【杀】【闪】【桃】，是最基础的牌。';
  if (q.includes('锦囊牌') || q.includes('锦囊')) return '锦囊牌分为普通锦囊和延时锦囊。普通锦囊立即生效（如【南蛮入侵】【决斗】），延时锦囊需置于判定区生效（如【乐不思蜀】【闪电】）。';
  if (q.includes('装备牌')) return '装备牌包括武器（增加攻击范围）、防具（提供防御效果）、马匹（+1马增加防御距离，-1马增加攻击距离）。';

  // Rules
  if (q.includes('游戏流程') || q.includes('回合') || q.includes('流程')) {
    return '游戏流程（每个回合6个阶段）：\n' +
      '1. 准备阶段 — 触发部分技能\n' +
      '2. 判定阶段 — 处理延时锦囊\n' +
      '3. 摸牌阶段 — 摸两张牌\n' +
      '4. 出牌阶段 — 使用手牌和技能\n' +
      '5. 弃牌阶段 — 弃置超出手牌上限的牌\n' +
      '6. 结束阶段 — 触发部分技能';
  }
  if (q.includes('判定')) return '判定是从牌堆顶翻开一张牌，根据花色、点数或颜色来决定效果。延时锦囊（【乐不思蜀】【闪电】）需要在判定阶段进行判定。';
  if (q.includes('濒死') || q.includes('死亡')) return '当角色体力≤0时进入濒死状态，需使用【桃】或技能回复至1点以上，否则死亡。死亡后亮出身份牌，弃置所有牌。';
  if (q.includes('距离')) return '基本距离为座位差（顺时针或逆时针取较小值）。+1马增加别人与你的距离（防御），-1马减少你与别人的距离（进攻），武器提供攻击范围。';
  if (q.includes('手牌上限') || q.includes('体力上限')) return '角色的手牌上限等于其当前体力值。体力4的角色，手牌上限为4张。';
  if (q.includes('主公')) return '主公是每局游戏的领袖，通常有额外的体力上限和主公技。忠臣帮助主公消灭反贼和内奸，反贼的目标是杀死主公，内奸需要在主公存活时消灭所有人。';
  if (q.includes('技能类型') || q.includes('锁定技')) {
    return '技能类型说明：\n' +
      '• 锁定技：必须发动，无法选择不发动\n' +
      '• 限定技：整局游戏只能发动一次\n' +
      '• 觉醒技：满足条件后必须发动\n' +
      '• 主公技：只有主公身份才能使用\n' +
      '• 转换技：可以将一种牌当另一种牌使用';
  }
  if (q.includes('怎么玩') || q.includes('新手')) {
    return '三国杀基础入门：\n' +
      '• 出牌阶段，用【杀】攻击敌人，用【闪】响应敌人【杀】\n' +
      '• 用【桃】回复体力或救濒死队友\n' +
      '• 合理使用锦囊牌（【南蛮入侵】群体伤害、【无中生有】摸牌等）\n' +
      '• 注意防具和武器的搭配\n' +
      '• 手牌不要超过体力上限，弃牌阶段会强制弃牌';
  }

  // Skill type question
  for (const st of RULES.skill_types) {
    if (q.includes(st.name)) return `【${st.name}】：${st.description}`;
  }

  return '抱歉，我暂时没有找到相关内容。试试搜索武将名（如"关羽"）或卡牌名（如"南蛮入侵"）来获取详细信息！';
}

// ===== TEAM RECOMMENDATION =====
let selectedHero = null;
let heroPickerMode = 'team'; // 'team' = 配将页选主将, 'advice' = 出牌页选武将

function showHeroPicker() {
  heroPickerMode = 'team';
  openHeroPicker('选择主将');
}

function showAdviceHeroPicker() {
  heroPickerMode = 'advice';
  openHeroPicker('选择你的武将');
}

function openHeroPicker(title) {
  document.querySelector('#heroPickerModal .modal-title').textContent = title;
  renderModalHeroes(HEROES);
  document.getElementById('heroPickerModal').classList.add('show');
}

function renderModalHeroes(heroes) {
  const list = document.getElementById('modalHeroList');
  if (heroes.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2);font-size:14px">没有找到匹配的武将</div>';
    return;
  }
  list.innerHTML = heroes.map(h => `
    <div class="modal-hero-item" onclick="selectHero('${h.name}')">
      <div class="hero-avatar faction-${h.faction}" style="width:38px;height:38px;font-size:16px">${h.name[0]}</div>
      <div>
        <div class="modal-hero-name">${h.name}</div>
        <div class="modal-hero-sub">${h.title} · ${h.faction} · ❤️${h.health}</div>
      </div>
    </div>
  `).join('');
}

function closeHeroPicker() {
  document.getElementById('heroPickerModal').classList.remove('show');
  document.getElementById('modalHeroSearch').value = '';
}

// 模态框搜索（只注册一次，避免重复绑定）
document.getElementById('modalHeroSearch').addEventListener('input', debounce(e => {
  const s = e.target.value.toLowerCase();
  const filtered = HEROES.filter(h =>
    h.name.toLowerCase().includes(s) || h.title.toLowerCase().includes(s)
  );
  renderModalHeroes(filtered);
}, 200));

function selectHero(name) {
  closeHeroPicker();
  if (heroPickerMode === 'advice') {
    adviceHero = HEROES.find(h => h.name === name);
    document.getElementById('adviceHeroSearch').value = `${adviceHero.name}（${adviceHero.title}）`;
    document.getElementById('adviceHandSection').style.display = '';
    document.getElementById('adviceSituationSection').style.display = '';
    renderAdviceHandCards();
  } else {
    selectedHero = HEROES.find(h => h.name === name);
    renderTeamResult();
  }
}

function renderTeamResult() {
  const container = document.getElementById('teamResult');

  if (!selectedHero) {
    container.innerHTML = `
      <div class="team-empty">
        <div class="team-empty-icon">⚔️</div>
        <div>点击上方框选择你的主将</div>
        <div style="font-size:12px;margin-top:6px;color:var(--text2)">我会为你推荐配合的武将和卡牌</div>
      </div>
    `;
    return;
  }

  const synergy = SYNERGIES[selectedHero.name];

  // Hero tags
  const tags = selectedHero.tags || [];

  container.innerHTML = `
    <div class="team-selected-hero" onclick="showHeroPicker()">
      <div class="hero-avatar faction-${selectedHero.faction}" style="width:50px;height:50px;font-size:24px">${selectedHero.name[0]}</div>
      <div>
        <div class="team-selected-name">${selectedHero.name}</div>
        <div class="team-selected-sub">${selectedHero.title} · ${selectedHero.faction} · ❤️${selectedHero.health}体力</div>
        ${tags.length > 0 ? `<div style="margin-top:4px">${tags.map(t => `<span class="pill" style="padding:2px 8px;font-size:10px;margin-right:4px">${t}</span>`).join('')}</div>` : ''}
      </div>
      <div style="margin-left:auto;color:var(--text2);font-size:12px">▼</div>
    </div>

    ${synergy ? `
      <div class="team-tip-box">
        <div class="team-tip-label">💡 出牌建议</div>
        <div>${synergy.tip}</div>
      </div>

      <div class="team-section-title">🤝 推荐配合武将</div>
      ${synergy.partners.map(pName => {
        const partner = HEROES.find(h => h.name === pName);
        if (!partner) return '';
        const partnerSynergy = SYNERGIES[pName];
        return `
          <div class="team-card" onclick="toggleTeamCard(this)">
            <div class="team-card-header">
              <div class="team-hero-avatar faction-${partner.faction}">${partner.name[0]}</div>
              <div>
                <div class="team-hero-name">${partner.name}</div>
                <div class="team-hero-sub">${partner.title} · ${partner.faction} · ❤️${partner.health}体力</div>
              </div>
              <div class="team-hero-arrow">▼</div>
            </div>
            <div class="team-card-body">
              ${partnerSynergy ? `<div class="team-reason">💡 ${partnerSynergy.reason}</div>` : ''}
              ${partner.skills.map(s => `
                <div style="margin-top:6px">
                  <span style="font-size:12px;color:var(--gold);font-weight:bold">【${s.name}】</span>
                  <span style="font-size:11px;color:var(--text2)">${s.type}</span>
                  <div style="font-size:12px;color:var(--text);margin-top:2px">${s.description}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}

      <div class="team-section-title" style="margin-top:16px">🃏 推荐卡牌</div>
      <div class="team-cards-recommend">
        ${synergy.cards.map(c => `<div class="team-card-recommend-item">${c}</div>`).join('')}
      </div>

      <div style="margin-top:14px;padding:10px;background:var(--bg3);border-radius:8px;border-left:3px solid var(--gold)">
        <div style="font-size:12px;font-weight:bold;color:var(--gold)">📌 阵容搭配思路</div>
        <div style="font-size:13px;color:var(--text);margin-top:6px;line-height:1.7">${synergy.reason}</div>
      </div>
    ` : `
      <div class="team-tip-box">
        <div class="team-tip-label">💡 武将特点</div>
        <div>${selectedHero.skills.map(s => `【${s.name}】${s.description}`).join('\n')}</div>
      </div>
      <div class="team-section-title">🎴 基本信息</div>
      <div class="team-card" style="cursor:default">
        <div class="team-card-header">
          <div class="team-hero-avatar faction-${selectedHero.faction}" style="width:48px;height:48px;font-size:22px">${selectedHero.name[0]}</div>
          <div>
            <div class="team-hero-name">${selectedHero.name}</div>
            <div class="team-hero-sub">${selectedHero.title} · ❤️${selectedHero.health}体力</div>
          </div>
        </div>
        <div class="team-card-body" style="display:block">
          ${selectedHero.skills.map(s => `
            <div style="margin-bottom:8px">
              <span style="font-size:13px;color:var(--gold);font-weight:bold">【${s.name}】</span>
              <span style="font-size:11px;color:var(--text2)">${s.type}</span>
              <div style="font-size:13px;color:var(--text);margin-top:2px;line-height:1.6">${s.description}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `}
  `;
}

function toggleTeamCard(card) {
  card.classList.toggle('open');
}

// ===== VOICE (语音播报与语音问答) =====
// TTS: Web Speech API speechSynthesis（Android/Chrome 内置，眼镜作为蓝牙音频设备时自动由眼镜播报）
// ASR: Web Speech API SpeechRecognition（部分 WebView 不支持，自动隐藏入口）
const VOICE_SUPPORTED = 'speechSynthesis' in window;
const RECOG_SUPPORTED = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
let voiceAutoSpeak = localStorage.getItem('sanguosha_voice_auto') === 'on';
let voiceTimer = null;

function setAutoSpeak(on) {
  voiceAutoSpeak = on;
  localStorage.setItem('sanguosha_voice_auto', on ? 'on' : 'off');
  const btn = document.getElementById('voiceToggleBtn');
  if (btn) {
    btn.textContent = on ? '🔊 自动播报:开' : '🔇 自动播报:关';
    btn.classList.toggle('on', on);
  }
  if (!on && VOICE_SUPPORTED) speechSynthesis.cancel();
}

function toggleAutoSpeak() {
  setAutoSpeak(!voiceAutoSpeak);
}

function speak(text) {
  if (!VOICE_SUPPORTED || !text) return;
  speechSynthesis.cancel();
  // 去掉符号与表情，TTS 只读正文
  const clean = String(text)
    .replace(/[【】\n•✨📋🃏🎯💡❤️⚔️🔴🟣🔵📌🤖👤🔊🔇🕶️]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;
  // 分句队列播报：蓝牙音频传输长文本易被截断，逐句 utterance 更稳
  const sentences = clean.split(/([。！？；])/).reduce((acc, part, i) => {
    if (i % 2 === 0) acc.push((part + (i + 1 < clean.length ? '' : '')));
    else acc[acc.length - 1] += part;
    return acc;
  }, []).map(s => s.trim()).filter(Boolean);
  // 眼镜模式：语速放缓适配"听"的场景
  const rate = glassesMode ? 0.95 : 1.05;
  if (sentences.length <= 1) {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'zh-CN';
    u.rate = rate;
    speechSynthesis.speak(u);
    return;
  }
  sentences.forEach(s => {
    const u = new SpeechSynthesisUtterance(s);
    u.lang = 'zh-CN';
    u.rate = rate;
    speechSynthesis.speak(u);
  });
}

// 当前建议压缩为口播文本
function adviceSpeechText() {
  if (!adviceHero) return '';
  const parts = [`${adviceHero.name}，${ADVICE_SITUATIONS[adviceSituation].label}局势`];
  if (adviceHand.length === 0) {
    parts.push('尚未选择手牌');
    return parts.join('。') + '。';
  }
  parts.push(`手牌共${adviceHand.length}张`);
  const counts = {};
  adviceHand.forEach(n => counts[n] = (counts[n] || 0) + 1);
  const seq = Object.keys(counts)
    .map(n => ({ name: n, action: adviceFor(n).action, order: ADVICE_PLAY_ORDER[n] || 99 }))
    .filter(i => i.action === 'use')
    .sort((a, b) => a.order - b.order);
  if (seq.length > 0) {
    parts.push('建议依次使用：' + seq.map((i, idx) => `第${idx + 1}步，${i.name}${counts[i.name] > 1 ? `，共${counts[i.name]}张` : ''}`).join('；'));
  } else {
    parts.push('暂无适合立刻使用的牌，建议保留过牌');
  }
  const holds = Object.keys(counts).filter(n => adviceFor(n).action === 'hold');
  if (holds.length > 0) parts.push(`${holds.join('、')}建议保留`);
  return parts.join('。') + '。';
}

function speakAdviceNow() {
  if (!VOICE_SUPPORTED) return;
  speak(adviceSpeechText());
}

// 手牌变动后防抖自动播报（连续加牌只播一次最终建议）
function maybeAutoSpeakAdvice() {
  if (!voiceAutoSpeak || !VOICE_SUPPORTED || !adviceHero || adviceHand.length === 0) return;
  clearTimeout(voiceTimer);
  voiceTimer = setTimeout(speakAdviceNow, 1200);
}

function initVoiceUI() {
  const toggleBtn = document.getElementById('voiceToggleBtn');
  if (toggleBtn) {
    if (!VOICE_SUPPORTED) {
      toggleBtn.style.display = 'none';
    } else {
      setAutoSpeak(voiceAutoSpeak);
    }
  }
  const micBtn = document.getElementById('askMicBtn');
  if (micBtn && !RECOG_SUPPORTED) micBtn.style.display = 'none';
  const glassesBtn = document.getElementById('glassesToggle');
  if (glassesBtn) {
    glassesBtn.classList.toggle('active', glassesMode);
    glassesBtn.textContent = glassesMode ? '🕶️ 眼镜模式:开' : '🕶️ 眼镜模式';
  }
}

// ===== GLASSES MODE (BOLON AI 眼镜联动) =====
// BOLON AI 智能眼镜（Rokid 方案）：蓝牙音频直连手机（TTS/ASR 自动路由），照片经 Rokid AI App 同步到相册。
// 眼镜模式 = 自动播报常开 + 放缓语速 + 全场景结果口播 + 相册导入识别入口。
let glassesMode = localStorage.getItem('sanguosha_glasses') === 'on';

function toggleGlassesMode() {
  glassesMode = !glassesMode;
  localStorage.setItem('sanguosha_glasses', glassesMode ? 'on' : 'off');
  const btn = document.getElementById('glassesToggle');
  if (btn) {
    btn.classList.toggle('active', glassesMode);
    btn.textContent = glassesMode ? '🕶️ 眼镜模式:开' : '🕶️ 眼镜模式';
  }
  // 眼镜模式联动自动播报（保持两个开关状态一致，避免互相覆盖）
  if (glassesMode !== voiceAutoSpeak) setAutoSpeak(glassesMode);
  if (glassesMode && VOICE_SUPPORTED) {
    speak('眼镜模式已开启。识别结果和问答回答将自动通过眼镜播报。');
  } else if (!glassesMode) {
    speechSynthesis.cancel();
  }
}

function openGlassesGuide() {
  document.getElementById('glassesGuideModal').classList.add('show');
}

function closeGlassesGuide() {
  document.getElementById('glassesGuideModal').classList.remove('show');
}

// 相册导入识别：适配"眼镜拍桌 → 相册同步 → 导入识别 → 语音播报"流程
async function recognizeFromAlbum(input, mode) {
  const file = input.files && input.files[0];
  input.value = ''; // 允许重复选择同一张照片
  if (!file) return;
  if (!file.type.startsWith('image/')) return;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  }).catch(err => {
    const el = document.getElementById(mode === 'advice' ? 'adviceRecognizeResult' : 'recognizeResult');
    if (el) el.innerHTML = `<div class="recog-error">❌ ${err.message}</div>`;
    return null;
  });
  if (!dataUrl) return;

  if (mode === 'advice') {
    const resultEl = document.getElementById('adviceRecognizeResult');
    resultEl.innerHTML = `
      <div class="recog-loading">
        <div style="font-size:32px;margin-bottom:8px">🔍</div>
        <div>正在识别相册手牌...</div>
        <div class="recog-loading-dot" style="margin-top:6px">●●●</div>
      </div>`;
    try {
      const names = await recognizeHandCards(dataUrl);
      if (names.length === 0) {
        resultEl.innerHTML = `<div class="recog-error">未能识别到手牌，请换一张更清晰的照片</div>`;
        return;
      }
      names.forEach(n => adviceHand.push(n));
      renderAdviceHandCards();
      const counts = {};
      names.forEach(n => counts[n] = (counts[n] || 0) + 1);
      const summary = `已从相册添加：${Object.entries(counts).map(([n, c]) => `${n}×${c}`).join('、')}`;
      resultEl.innerHTML = `<div style="font-size:13px;color:var(--shu)">✅ ${summary}</div>`;
      setTimeout(() => closeAdviceCamera(), 900);
    } catch (err) {
      console.error('Album hand recognition error:', err);
      resultEl.innerHTML = `<div class="recog-error">❌ 识别失败: ${err.message}</div>`;
    }
    return;
  }

  // 主识别页：复用拍照识别管线与结果展示
  const resultEl = document.getElementById('recognizeResult');
  resultEl.innerHTML = `
    <div class="recog-loading">
      <div style="font-size:32px;margin-bottom:8px">🔍</div>
      <div>正在识别相册图片...</div>
      <div class="recog-loading-dot" style="margin-top:6px">●●●</div>
    </div>`;
  try {
    const result = await recognizeWithVision(dataUrl);
    displayRecognizeResult(result, dataUrl);
  } catch (err) {
    console.error('Album recognition error:', err);
    resultEl.innerHTML = `<div class="recog-error">❌ 识别失败: ${err.message}</div>`;
  }
}

// 识别结果口播文本（精简，适合"听"）
function resultSpeechText(result) {
  if (!result) return '';
  if (result.type === 'unknown') return result.message || '未能识别到武将或卡牌';
  const entry = FACTS_MAP[result.name];
  if (!entry) return `识别到${result.name}，但数据库未收录`;
  if (entry.type === 'hero') {
    const h = entry.data;
    return `识别到武将${h.name}。` + h.skills.map(s => `技能${s.name}：${s.description}`).join('。');
  }
  const c = entry.data;
  return `识别到卡牌${c.name}。${c.description}`;
}

// ===== PHONE MODEL AUTO-DETECT (手机端 Ollama 模型自动检测) =====
// 手机 Termux 部署 Ollama 时 endpoint 保持 localhost:11434（PWA/WebView 同机访问）。
// 启动时查询 /api/tags：
//   识别模型 → capabilities 含 vision（名称模式兜底旧版 Ollama）
//   问答模型 → 优先 thinking/tools 的文本模型（如 gemma4），识别模型兜底
// 注意：Google AI Edge Gallery 等应用内下载的模型无 HTTP API，无法被网页调用；
//       需在 Ollama 中拉取（ollama pull gemma4）才能使用。
const VISION_MODEL_NAME_RE = /vision|llava|moondream|minicpm|vl|pixtral|internvl|granite/i;

function ollamaVisionCapable(m) {
  if (Array.isArray(m.capabilities)) return m.capabilities.includes('vision');
  return VISION_MODEL_NAME_RE.test(m.name);
}

// 问答模型挑选：thinking/tools 优先（对话质量更好的旗舰文本模型），排除纯 embedding
function ollamaChatCapable(m) {
  const caps = Array.isArray(m.capabilities) ? m.capabilities : ['completion'];
  if (caps.includes('embedding') && !caps.includes('completion')) return false;
  return caps.includes('completion');
}
function ollamaChatScore(m) {
  const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
  let s = 0;
  if (caps.includes('thinking')) s += 4;
  if (caps.includes('tools')) s += 2;
  if (caps.includes('completion')) s += 1;
  return s;
}
// 同分 tiebreak：模型体积更大视为能力更强（如 gemma3:4b > tinyllama）
function ollamaChatBetter(a, b) {
  const sa = ollamaChatScore(a);
  const sb = ollamaChatScore(b);
  if (sb !== sa) return sb > sa ? b : a;
  return (b.size || 0) > (a.size || 0) ? b : a;
}

async function detectPhoneModel(force = false) {
  const provider = getActiveProvider();
  if (provider.type !== 'ollama') return provider.model;
  const base = provider.endpoint.replace(/\/api\/[^/]+$/, '');
  try {
    const resp = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!resp.ok) throw new Error(`返回 ${resp.status}`);
    const models = (await resp.json()).models || [];
    const byName = new Map(models.map(m => [m.name, m]));

    // 识别模型：配置模型须真实存在且具备 vision；否则切到已装视觉模型
    // （带 tag 的配置须精确匹配；仅无 tag 配置才允许 :latest 回退）
    const cfgModel = byName.get(provider.model)
      || (!provider.model.includes(':') ? byName.get(provider.model.split(':')[0] + ':latest') : undefined);
    let visionName = provider.model;
    let visionUsable = !!(cfgModel && ollamaVisionCapable(cfgModel));
    if (force || !visionUsable) {
      const visionModels = models.filter(ollamaVisionCapable);
      const cfgBase = provider.model.split(':')[0];
      const pick = visionModels.find(m => m.name.split(':')[0] === cfgBase) || visionModels[0];
      if (pick) {
        visionName = pick.name;
        visionUsable = true;
        if (pick.name !== provider.model) console.log(`[SGS] 已自动切换视觉模型 → ${pick.name}`);
      } else {
        console.warn('[SGS] Ollama 中未检测到视觉模型，识别保留原配置');
      }
    }

    // 问答模型：thinking/tools 优先（如 gemma4），同分按模型体积 tiebreak，识别模型兜底
    const chatCandidates = models.filter(ollamaChatCapable);
    const chatPick = chatCandidates.length > 0
      ? chatCandidates.reduce((a, b) => ollamaChatBetter(a, b))
      : null;

    // 手机端单多模态模型策略：最佳问答模型本身具备 vision（如 gemma3:4b）时，
    // 识别/问答共用一个模型，避免双模型同时驻留内存（Termux 内存压力大）
    if (chatPick && ollamaVisionCapable(chatPick)) {
      provider.model = chatPick.name;
      provider.chatModel = chatPick.name;
      updateGlassesModelRow(chatPick.name, chatPick.name, 'ok');
      return chatPick.name;
    }

    const chatName = chatPick ? chatPick.name : visionName;
    provider.model = visionName;
    provider.chatModel = chatName;
    updateGlassesModelRow(visionName, chatName, visionUsable ? 'ok' : 'none');
    return visionName;
  } catch (e) {
    console.warn('[SGS] 模型自动检测不可用:', e.message);
    updateGlassesModelRow('', '', 'fail');
    return provider.model;
  }
}

function redetectPhoneModel() {
  const nameEl = document.getElementById('glassesModelName');
  if (nameEl) nameEl.textContent = '检测中…';
  detectPhoneModel(true);
}

function updateGlassesModelRow(modelName, chatModelName, state) {
  const nameEl = document.getElementById('glassesModelName');
  const chatEl = document.getElementById('glassesChatModelName');
  const hintEl = document.getElementById('glassesModelHint');
  if (!nameEl) return;
  if (state === 'ok' && modelName) {
    nameEl.textContent = modelName;
    if (chatEl) chatEl.textContent = chatModelName || modelName;
    if (hintEl) hintEl.textContent = '启动时已自动检测：手机/本机 Ollama 已安装的模型';
  } else {
    nameEl.textContent = '未检测到可用模型';
    if (chatEl) chatEl.textContent = '—';
    if (hintEl) hintEl.textContent = '无法访问 Ollama 或没有可用模型。请确认手机 Termux 中 Ollama 正在运行（ollama serve）；拍照识别还需视觉模型（如 ollama pull llama3.2-vision）';
  }
}

// ===== AUTO UPDATE (热更新) =====
// APK 内 WebView 加载本地 assets，通过下载远端 app.js/data.js 存 localStorage 实现逻辑与数据热更
// （UI 壳 index.html 变化仍需重新安装 APK）。PWA 下该检查同时作为版本提示。
// 更新源：config.js 的 UPDATE_BASE（默认 GitHub Pages），需提供 version.json：
//   { "version": "1.5.1", "files": { "app.js": "<全文>", "data.js": "<全文>" } }
const UPDATE_BASE = (window.CONFIG && CONFIG.UPDATE_BASE) || 'https://cpufreestyle.github.io/sanguosha-mobile/';
const UPDATE_KEY = 'sanguosha_hotpatch';
const UPDATE_APPLIED_KEY = 'sanguosha_hotpatch_applied';

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function appliedPatchVersion() {
  try { return localStorage.getItem(UPDATE_APPLIED_KEY) || '0'; } catch (e) { return '0'; }
}

async function fetchUpdateManifest() {
  const resp = await fetch(UPDATE_BASE + 'version.json?_=' + Date.now(), { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error('version.json ' + resp.status);
  return resp.json();
}

async function checkForUpdates(showToastOnUptodate) {
  try {
    const manifest = await fetchUpdateManifest();
    const remoteVersion = manifest.version;
    // 已应用过的补丁不再重复下载（本地 VERSION 与已应用补丁取较高者对比）
    const current = compareVersions(appliedPatchVersion(), VERSION) >= 0 ? appliedPatchVersion() : VERSION;
    if (compareVersions(remoteVersion, current) <= 0) {
      if (showToastOnUptodate) showUpdateToast('✅ 已是最新版本 v' + VERSION);
      return false;
    }
    if (!manifest.files || !manifest.files['app.js'] || !manifest.files['data.js']) {
      throw new Error('更新清单缺少文件内容');
    }
    localStorage.setItem(UPDATE_KEY, JSON.stringify({
      version: remoteVersion,
      files: { 'app.js': manifest.files['app.js'], 'data.js': manifest.files['data.js'] },
      ts: Date.now()
    }));
    localStorage.setItem(UPDATE_APPLIED_KEY, remoteVersion);
    showUpdateToast('🎉 已更新至 v' + remoteVersion + '，正在重启…');
    setTimeout(() => location.reload(), 1500);
    return true;
  } catch (e) {
    console.warn('[SGS] 更新检查跳过:', e.message);
    if (showToastOnUptodate) showUpdateToast('⚠️ 更新检查失败，请检查网络');
    return false;
  }
}

function showUpdateToast(text) {
  const old = document.getElementById('updateToast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'updateToast';
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);' +
    'background:var(--card-bg);border:1px solid var(--gold);color:var(--text);' +
    'padding:10px 18px;border-radius:20px;font-size:13px;z-index:900;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.5);max-width:86%;text-align:center;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ===== ADVICE (出牌建议) =====
let adviceHero = null;
let adviceHand = []; // 手牌名数组，允许重复（如三张【杀】）
let adviceSituation = 'default';
let adviceCameraStream = null;
let adviceFacing = 'environment'; // 'environment' = 后置, 'user' = 前置

const ADVICE_SITUATIONS = {
  default: { label: '通用', note: '根据手牌结构灵活出牌，优先处理无代价的收益牌。' },
  early: { label: '开局', note: '优先【无中生有】补牌、用【顺手牵羊】/【过河拆桥】干扰敌人；防具与马匹尽早上身；【杀】留给够得着的高价值目标。' },
  mid: { label: '中盘', note: '用【乐不思蜀】压制敌方核心；装备成型后集中输出；注意保留1~2张【闪】防被集火。' },
  late: { label: '残局', note: '残血时优先留【桃】保命；输出牌果断使用争取斩杀；距离不够时靠【-1马】、【决斗】补伤害。' }
};

// 卡牌通用建议 action: use=优先使用 / situational=视情况 / hold=建议保留
const CARD_ADVICE_RULES = {
  '无中生有': { action: 'use', reason: '立即使用补充2张手牌，无任何代价' },
  '五谷丰登': { action: 'use', reason: '团队补牌收益高，但注意也会给敌人送牌' },
  '桃': { action: 'situational', reason: '体力不满时回复；体力满时不能用，先保留' },
  '杀': { action: 'use', reason: '对攻击范围内敌人使用，注意每回合默认限用一张' },
  '闪': { action: 'hold', reason: '响应敌人【杀】的保命牌，建议保留' },
  '决斗': { action: 'situational', reason: '自己【杀】充足或对手缺【杀】时使用' },
  '过河拆桥': { action: 'use', reason: '优先拆除敌人关键装备（连弩、防具）或己方判定区的乐不思蜀' },
  '顺手牵羊': { action: 'use', reason: '距离1内优先牵敌人关键牌，拿到装备可直接穿戴' },
  '南蛮入侵': { action: 'situational', reason: '群体伤害，但也会消耗队友的【杀】' },
  '万箭齐发': { action: 'situational', reason: '群体伤害，但也会消耗队友的【闪】' },
  '乐不思蜀': { action: 'use', reason: '延时控制，优先压给敌方核心输出位' },
  '闪电': { action: 'situational', reason: '高风险延时锦囊，劣势可赌，优势慎用' },
  '桃园结义': { action: 'situational', reason: '己方整体掉血时使用收益最大' },
  '无懈可击': { action: 'hold', reason: '响应式反制牌，留在手中才能护住关键判定/队友' },
  '酒': { action: 'situational', reason: '与【杀】配合伤害+1；濒死时可当【桃】救自己，注意每回合限一次' },
  '火杀': { action: 'use', reason: '对连环/藤甲目标优先使用，火焰伤害可传导' },
  '雷杀': { action: 'use', reason: '对连环状态目标使用可传导雷电伤害' },
  '火攻': { action: 'situational', reason: '需要有同花色手牌配合，对手牌多的敌人收益更高' },
  '铁索连环': { action: 'situational', reason: '先连环再属性伤害打出群体效果；残血时可重置自己保命' },
  '兵粮寸断': { action: 'use', reason: '延时压制敌方核心，限制其摸牌' },
  '藤甲': { action: 'situational', reason: '免疫普通杀和AOE，但受到火焰伤害+1，场上有火杀/火攻时慎穿' },
  '朱雀羽扇': { action: 'use', reason: '普通杀转火杀，配合连环、克制藤甲' },
  '古锭刀': { action: 'use', reason: '目标没有手牌时伤害+1，配合拆牌/牵牌使用' },
  '诸葛连弩': { action: 'use', reason: '装备后【杀】无次数限制，配合多张【杀】爆发' },
  '青釭剑': { action: 'use', reason: '装备克制八卦阵、仁王盾等防具' },
  '丈八蛇矛': { action: 'use', reason: '两张手牌当一张【杀】，缺【杀】时应急' },
  '贯石斧': { action: 'use', reason: '【杀】被【闪】抵消后弃两张牌强制命中，斩杀利器' },
  '青龙偃月刀': { action: 'use', reason: '【杀】被【闪】抵消后可追击一张【杀】' },
  '八卦阵': { action: 'use', reason: '装备后概率出【闪】，提升生存' },
  '仁王盾': { action: 'use', reason: '装备后黑色【杀】对你无效' },
  '+1马': { action: 'use', reason: '装备增加别人与你的距离，防御型' },
  '-1马': { action: 'use', reason: '装备减少你与别人的距离，更容易够到目标' }
};

// 建议出牌顺序（数字越小越先出）
const ADVICE_PLAY_ORDER = {
  '无中生有': 1,
  '五谷丰登': 2,
  '过河拆桥': 3,
  '顺手牵羊': 3,
  '乐不思蜀': 4,
  '兵粮寸断': 4,
  '桃园结义': 5,
  '铁索连环': 5,
  '诸葛连弩': 6, '青釭剑': 6, '丈八蛇矛': 6, '贯石斧': 6, '青龙偃月刀': 6,
  '八卦阵': 6, '仁王盾': 6, '藤甲': 6, '朱雀羽扇': 6, '古锭刀': 6, '+1马': 6, '-1马': 6,
  '酒': 7, '火杀': 7, '雷杀': 7,
  '杀': 7,
  '决斗': 8, '南蛮入侵': 8, '万箭齐发': 8, '火攻': 8,
  '闪电': 9,
  '桃': 10
};

// 武将对手牌的特殊加成说明
const HERO_CARD_NOTES = {
  '关羽': { '杀': '武圣：红色牌可当【杀】使用，红色手牌都是潜在输出' },
  '张飞': { '杀': '咆哮：出牌阶段【杀】无次数限制，有杀尽量全出' },
  '赵云': { '杀': '龙胆：【杀】【闪】可互相转化，攻防一体', '闪': '龙胆：【闪】也可当【杀】打出，保留价值更高' },
  '诸葛亮': { '闪': '空城：没有手牌时不能成为【杀】【决斗】目标，残局可考虑清空手牌' },
  '吕布': { '决斗': '无双：决斗目标需连出两张【杀】，你占优时果断使用', '杀': '无双：你的【杀】需两张【闪】才能抵消，命中率高' },
  '黄忠': { '杀': '烈弓：目标手牌数≥你的体力值时，【杀】不可被【闪】响应' },
  '马超': { '杀': '铁骑：判定为红色时，【杀】不可被【闪】响应' },
  '许褚': { '杀': '裸衣状态下【杀】伤害+1，优先留到裸衣回合' },
  '甘宁': { '过河拆桥': '奇袭：黑色牌可当【过河拆桥】使用' },
  '吕蒙': { '杀': '克己：本回合不用【杀】可跳过弃牌阶段，蓄爆时可忍一手' },
  '黄盖': { '桃': '苦肉会掉血，【桃】能支撑更多次爆发' },
  '大乔': { '乐不思蜀': '国色：方块牌可当【乐不思蜀】使用' },
  '华佗': { '桃': '急救：回合外红色牌可当【桃】救人，红牌价值更高' },
  '甄姬': { '闪': '倾国：黑色手牌可当【闪】，黑色牌保留价值更高' },
  '袁绍': { '万箭齐发': '乱击：两张同花色手牌可当【万箭齐发】使用' },
  '貂蝉': { '决斗': '离间可弃牌令两名男性角色决斗，【决斗】思路更灵活' }
};

// 局势修正：在通用规则基础上调整 action 与理由
function adviceFor(name) {
  const base = CARD_ADVICE_RULES[name] || { action: 'use', reason: '按牌面效果使用' };
  let action = base.action;
  let reason = base.reason;
  if (adviceSituation === 'late') {
    if (['杀', '决斗', '南蛮入侵', '万箭齐发', '贯石斧'].includes(name)) {
      action = 'use';
      reason += '；残局果断输出，争取斩杀';
    }
  }
  if (adviceSituation === 'early' && (name === '南蛮入侵' || name === '万箭齐发')) {
    action = 'situational';
    reason += '；开局AOE收益有限且容易拉仇恨，可考虑后置';
  }
  if (adviceSituation === 'mid' && name === '乐不思蜀') {
    reason += '；中盘优先压敌方核心输出位';
  }
  return { action, reason };
}

// 局势 pills
document.getElementById('adviceSituationPills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#adviceSituationPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  adviceSituation = pill.dataset.situation;
  renderAdvice();
});

// 手牌搜索过滤
document.getElementById('adviceHandSearch').addEventListener('input', debounce(e => {
  adviceHandSearch = e.target.value;
  renderAdviceHandCards();
}, 200));

// ===== 手牌选择 =====
let adviceHandSearch = '';

function renderAdviceHandCards() {
  const container = document.getElementById('adviceHandCards');
  const s = adviceHandSearch.toLowerCase();
  container.innerHTML = getAllCards()
    .filter(c => !s || c.name.toLowerCase().includes(s) || c.type.toLowerCase().includes(s))
    .map(c => {
      const n = adviceHand.filter(x => x === c.name).length;
      return `<div class="pill ${n > 0 ? 'active' : ''}" onclick="addAdviceHandCard('${c.name}')">${c.name}${n > 0 ? `<span class="pill-count">×${n}</span><span class="pill-minus" onclick="event.stopPropagation();removeAdviceHandCard('${c.name}')">−</span>` : ''}</div>`;
    }).join('');
  updateAdviceHandSummary();
}

function addAdviceHandCard(name) {
  if (adviceHand.length >= 20) return;
  adviceHand.push(name);
  renderAdviceHandCards();
}

function removeAdviceHandCard(name) {
  const idx = adviceHand.lastIndexOf(name);
  if (idx >= 0) adviceHand.splice(idx, 1);
  renderAdviceHandCards();
}

function clearAdviceHand() {
  adviceHand = [];
  renderAdviceHandCards();
}

function updateAdviceHandSummary() {
  const el = document.getElementById('adviceSelectedHand');
  if (adviceHand.length === 0) {
    el.innerHTML = '点击卡牌添加手牌（可重复点击叠加张数）';
  } else {
    const counts = {};
    adviceHand.forEach(n => counts[n] = (counts[n] || 0) + 1);
    el.innerHTML = `共 ${adviceHand.length} 张：${Object.entries(counts).map(([n, c]) => `${n}×${c}`).join('、')} <span class="pill-minus" onclick="clearAdviceHand()">清空</span>`;
  }
  renderAdvice();
}

// ===== 建议渲染 =====
function renderAdvice() {
  const el = document.getElementById('adviceResult');
  if (!adviceHero) {
    el.innerHTML = `
      <div class="team-empty" style="padding:30px 10px">
        <div class="team-empty-icon">💡</div>
        <div>先选择你的武将</div>
        <div style="font-size:12px;margin-top:6px;color:var(--text2)">再勾选手牌与局势，即可获得出牌建议</div>
      </div>`;
    return;
  }

  const synergy = SYNERGIES[adviceHero.name];
  const situation = ADVICE_SITUATIONS[adviceSituation];

  let html = `
    <div class="team-selected-hero" onclick="showAdviceHeroPicker()">
      <div class="hero-avatar faction-${adviceHero.faction}" style="width:50px;height:50px;font-size:24px">${adviceHero.name[0]}</div>
      <div>
        <div class="team-selected-name">${adviceHero.name}</div>
        <div class="team-selected-sub">${adviceHero.title} · ${adviceHero.faction} · ❤️${adviceHero.health}体力 · 🎯${situation.label}</div>
      </div>
      <div style="margin-left:auto;color:var(--text2);font-size:12px">▼</div>
    </div>`;

  if (adviceHand.length === 0) {
    html += `
      <div class="team-tip-box">
        <div class="team-tip-label">💡 ${adviceHero.name}要点</div>
        <div>${synergy ? synergy.tip : adviceHero.skills.map(s => `【${s.name}】${s.description}`).join('<br/>')}</div>
      </div>
      <div class="not-found" style="padding:20px">在上方勾选手牌后，这里会给出具体的出牌顺序建议</div>`;
    el.innerHTML = html;
    return;
  }

  const counts = {};
  adviceHand.forEach(n => counts[n] = (counts[n] || 0) + 1);
  const badges = { use: '优先使用', situational: '视情况', hold: '建议保留' };
  const coreCards = synergy ? synergy.cards : [];

  const items = Object.keys(counts).map(name => {
    const { action, reason } = adviceFor(name);
    return {
      name,
      count: counts[name],
      action,
      reason,
      heroNote: (HERO_CARD_NOTES[adviceHero.name] || {})[name],
      core: coreCards.includes(name),
      order: ADVICE_PLAY_ORDER[name] || 99
    };
  });

  const playSeq = items.filter(i => i.action === 'use').sort((a, b) => a.order - b.order);

  html += `
    <div class="team-section-title" style="margin-top:4px">📋 建议出牌顺序${VOICE_SUPPORTED ? '<button class="advice-speak-btn" onclick="speakAdviceNow()">🔊 播报</button>' : ''}</div>
    ${playSeq.length > 0 ? playSeq.map((i, idx) => `
      <div class="advice-order-item">
        <div class="advice-order-num">${idx + 1}</div>
        <div>
          <div><b>【${i.name}】</b>${i.count > 1 ? `×${i.count}` : ''}${i.core ? '<span class="advice-badge core">核心配合</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text2)">${i.reason}</div>
          ${i.heroNote ? `<div style="font-size:12px;color:var(--gold)">✨ ${i.heroNote}</div>` : ''}
        </div>
      </div>`).join('') : '<div style="font-size:13px;color:var(--text2);padding:4px 0">当前手牌暂无适合立刻使用的牌，建议保留过牌</div>'}

    <div class="team-section-title" style="margin-top:14px">🃏 全部手牌评估</div>
    ${items.map(i => `
      <div class="advice-card">
        <div><b>【${i.name}】</b>${i.count > 1 ? ` ×${i.count}` : ''}
          <span class="advice-badge ${i.action}">${badges[i.action]}</span>
          ${i.core ? '<span class="advice-badge core">核心配合</span>' : ''}
        </div>
        <div style="margin-top:4px;color:var(--text2);font-size:12px">${i.reason}</div>
        ${i.heroNote ? `<div style="margin-top:4px;font-size:12px;color:var(--gold)">✨ ${i.heroNote}</div>` : ''}
      </div>`).join('')}

    <div class="team-tip-box" style="margin-top:14px">
      <div class="team-tip-label">🎯 ${situation.label}思路</div>
      <div>${situation.note}</div>
      ${synergy ? `<div style="margin-top:6px">${synergy.tip}</div>` : ''}
    </div>`;

  el.innerHTML = html;
  // 开启自动播报时，手牌变动防抖播报一次最终建议
  maybeAutoSpeakAdvice();
}

// ===== 手牌拍照识别 =====
async function openAdviceCamera() {
  document.getElementById('adviceCameraModal').classList.add('show');
  document.getElementById('adviceRecognizeResult').innerHTML = '';
  await startAdviceCamera();
}

function closeAdviceCamera() {
  stopAdviceCamera();
  document.getElementById('adviceCameraModal').classList.remove('show');
}

async function startAdviceCamera() {
  try {
    adviceCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: adviceFacing },
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });
    document.getElementById('adviceCameraVideo').srcObject = adviceCameraStream;
  } catch (err) {
    document.getElementById('adviceRecognizeResult').innerHTML = `<div class="recog-error">摄像头启动失败：${err.message}</div>`;
  }
}

function stopAdviceCamera() {
  if (adviceCameraStream) {
    adviceCameraStream.getTracks().forEach(t => t.stop());
    adviceCameraStream = null;
  }
}

async function switchAdviceCamera() {
  adviceFacing = adviceFacing === 'environment' ? 'user' : 'environment';
  stopAdviceCamera();
  await startAdviceCamera();
}

async function captureAdviceCards() {
  const video = document.getElementById('adviceCameraVideo');
  const canvas = document.getElementById('adviceCameraCanvas');
  const resultEl = document.getElementById('adviceRecognizeResult');
  if (!video || !adviceCameraStream) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  resultEl.innerHTML = `
    <div class="recog-loading">
      <div style="font-size:32px;margin-bottom:8px">🔍</div>
      <div>正在识别手牌...</div>
      <div class="recog-loading-dot" style="margin-top:6px">●●●</div>
    </div>`;

  try {
    const names = await recognizeHandCards(dataUrl);
    if (names.length === 0) {
      resultEl.innerHTML = `<div class="recog-error">未能识别到手牌，请对准手牌后重试</div>`;
      return;
    }
    names.forEach(n => adviceHand.push(n));
    renderAdviceHandCards();
    const counts = {};
    names.forEach(n => counts[n] = (counts[n] || 0) + 1);
    resultEl.innerHTML = `<div style="font-size:13px;color:var(--shu)">✅ 已添加：${Object.entries(counts).map(([n, c]) => `${n}×${c}`).join('、')}</div>`;
    setTimeout(() => closeAdviceCamera(), 900);
  } catch (err) {
    console.error('Hand recognition error:', err);
    resultEl.innerHTML = `<div class="recog-error">❌ 识别失败: ${err.message}</div>`;
  }
}

// 通用视觉识别调用：返回解析后的 JSON（ollama / openai 兼容两种 provider）
async function visionJSON(systemPrompt, userText, imageDataUrl) {
  const provider = getActiveProvider();
  if (provider.type !== 'ollama' && !provider.apiKey) {
    throw new Error(`「${provider.label}」未配置 API Key，请在 config.js 中填写`);
  }
  const base64 = imageDataUrl.split(',')[1];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_CONFIG.timeout);

  try {
    let resp;
    if (provider.type === 'ollama') {
      resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          prompt: systemPrompt + '\n\n' + userText,
          images: [base64],
          stream: false,
          format: 'json',
          keep_alive: '10m', // 手机推理慢，对局期间保持模型常驻内存
          options: { temperature: 0.1 }
        }),
        signal: controller.signal
      });
    } else {
      resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                { type: 'text', text: userText }
              ]
            }
          ],
          max_tokens: 512
        }),
        signal: controller.signal
      });
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`识别服务返回 ${resp.status}${text ? '：' + text.substring(0, 120) : ''}`);
    }

    const data = await resp.json();
    const content = provider.type === 'ollama' ? data.response : (data.choices?.[0]?.message?.content || '');

    try {
      return JSON.parse(content);
    } catch { /* 回退到正则提取 */ }
    const match = content.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('识别超时，请重试或检查视觉服务配置');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// 手牌识别：提示词由 data.js 动态生成，只允许返回已知卡名
async function recognizeHandCards(imageDataUrl) {
  const known = getAllCards().map(c => c.name);
  const system = `你是三国杀助手，负责识别照片中的手牌。只允许从以下卡牌中选择：${known.join('、')}。\n返回JSON：{"cards":["杀","闪"]}，同一张牌出现多张就重复列出；识别不到返回 {"cards":[]}。不要输出任何其他文字。`;
  const result = await visionJSON(system, '请识别图中所有三国杀手牌，只返回JSON。', imageDataUrl);

  let names = [];
  if (Array.isArray(result)) {
    names = result.map(x => (typeof x === 'string' ? x : (x && x.name) || ''));
  } else if (result && Array.isArray(result.cards)) {
    names = result.cards.map(x => (typeof x === 'string' ? x : (x && x.name) || ''));
  }
  return names
    .map(n => String(n).replace(/[【】\s]/g, ''))
    .filter(n => known.includes(n));
}

// ===== INSTALL BANNER =====
function setupInstallBanner() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(() => {
      document.getElementById('installBanner').classList.add('show');
    }, 2000);
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBanner').classList.remove('show');
  });

  document.getElementById('closeBanner').addEventListener('click', () => {
    document.getElementById('installBanner').classList.remove('show');
  });
}

// ===== CAMERA TAB SETUP =====
function setupCameraTab() {
  const placeholder = document.getElementById('cameraPlaceholder');
  if (placeholder) {
    placeholder.innerHTML = `
      <div class="camera-icon">📷</div>
      <div>点击下方按钮打开摄像头</div>
      <div style="font-size:11px;margin-top:4px;color:var(--text2)">首次使用需授权摄像头</div>
    `;
  }
}

// ===== CAMERA CONTROL =====
async function startCamera() {
  if (cameraActive) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: currentFacing },
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });
    const video = document.getElementById('cameraVideo');
    video.srcObject = cameraStream;
    cameraActive = true;

    // Update overlay to show corners and scan line
    const overlay = document.getElementById('cameraOverlay');
    overlay.innerHTML = `
      <div class="camera-scan-line"></div>
      <div class="camera-corner tl"></div>
      <div class="camera-corner tr"></div>
      <div class="camera-corner bl"></div>
      <div class="camera-corner br"></div>
      <div style="position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:11px;color:var(--text2)">
        将武将或卡牌放入框内
      </div>
    `;

    document.getElementById('captureBtn').disabled = false;
  } catch (err) {
    console.error('Camera error:', err);
    const placeholder = document.getElementById('cameraPlaceholder');
    if (placeholder) {
      if (err.name === 'NotAllowedError') {
        placeholder.innerHTML = `<div class="camera-icon">🔒</div><div>摄像头权限被拒绝</div><div style="font-size:11px;margin-top:4px">请在浏览器设置中允许摄像头访问</div>`;
      } else if (err.name === 'NotFoundError') {
        placeholder.innerHTML = `<div class="camera-icon">📷</div><div>未找到摄像头设备</div><div style="font-size:11px;margin-top:4px">请确认设备有可用摄像头</div>`;
      } else {
        placeholder.innerHTML = `<div class="camera-icon">❌</div><div>摄像头启动失败</div><div style="font-size:11px;margin-top:4px">${err.message}</div>`;
      }
    }
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  cameraActive = false;
}

async function switchCamera() {
  currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
}

// ===== CAPTURE & RECOGNIZE =====
async function captureAndRecognize() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !cameraActive) return;

  // Capture frame
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // Show loading
  const resultEl = document.getElementById('recognizeResult');
  resultEl.innerHTML = `
    <div class="recog-loading">
      <div style="font-size:32px;margin-bottom:8px">🔍</div>
      <div>正在识别中...</div>
      <div class="recog-loading-dot" style="margin-top:6px">●●●</div>
    </div>
  `;

  try {
    const result = await recognizeWithVision(dataUrl);
    displayRecognizeResult(result, dataUrl);
  } catch (err) {
    console.error('Recognition error:', err);
    resultEl.innerHTML = `
      <div class="recog-error">
        ❌ 识别失败: ${err.message}
      </div>
    `;
  }
}

// ===== VISION RECOGNITION (复用 visionJSON) =====
async function recognizeWithVision(imageDataUrl) {
  const result = await visionJSON(
    VISION_SYSTEM_PROMPT,
    '请识别图片中的三国杀武将或卡牌，直接返回JSON格式结果。',
    imageDataUrl
  );
  // 返回内容无法解析为 JSON 时，交由展示层的 unknown 分支提示
  return result || { type: 'unknown', message: '识别服务返回了无法解析的内容' };
}

// ===== LOCAL FALLBACK =====
function localFallback(text) {
  for (const name of Object.keys(FACTS_MAP)) {
    if (text.includes(name)) {
      const entry = FACTS_MAP[name];
      return { type: entry.type, name, confidence: 0.5, source: 'local' };
    }
  }
  return { type: 'unknown', message: `未能在图中识别到三国杀武将或卡牌。AI回复：${text.substring(0, 100)}` };
}

// ===== DISPLAY RESULT =====
function displayRecognizeResult(result, imageDataUrl) {
  const resultEl = document.getElementById('recognizeResult');

  if (!result) {
    resultEl.innerHTML = `<div class="recog-error">❌ 识别服务无响应</div>`;
    return;
  }

  // 眼镜/自动播报：结果口播（拍照与相册导入共用此出口）
  if (voiceAutoSpeak && VOICE_SUPPORTED) speak(resultSpeechText(result));

  // Unknown
  if (result.type === 'unknown') {
    resultEl.innerHTML = `
      <div class="recog-card">
        <div style="text-align:center;padding:20px">
          <div style="font-size:40px;margin-bottom:10px">🤔</div>
          <div style="color:var(--text2);font-size:14px">未能识别到武将或卡牌</div>
          ${result.message ? `<div style="color:var(--text2);font-size:12px;margin-top:6px">${result.message.substring(0, 120)}</div>` : ''}
          <div style="margin-top:12px">
            <button class="recog-action-btn" onclick="captureAndRecognize()" style="background:var(--bg3);border:1px solid var(--border)">🔄 重新识别</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Hero
  if (result.type === 'hero') {
    const hero = HEROES.find(h => h.name === result.name);
    if (!hero) {
      resultEl.innerHTML = `<div class="recog-error">识别到「${result.name}」但数据库未收录</div>`;
      return;
    }

    const conf = Math.round((result.confidence || 0.5) * 100);
    resultEl.innerHTML = `
      <div class="recog-card">
        <div class="recog-header">
          <div class="hero-avatar faction-${hero.faction}" style="width:48px;height:48px;font-size:22px">
            ${hero.name[0]}
          </div>
          <div>
            <div class="recog-badge">🎴 武将</div>
            <div class="recog-name">${hero.name}</div>
            <div style="font-size:12px;color:var(--text2)">${hero.title} · ${hero.faction} · ❤️ ${hero.health}体力</div>
          </div>
        </div>
        <div class="recog-skill" style="margin-top:12px">
          ${hero.skills.map(s => `
            <div style="margin-bottom:8px">
              <div class="recog-skill-name">【${s.name}】<span style="font-size:11px;color:var(--text2);font-weight:normal">${s.type}</span></div>
              <div class="recog-skill-desc">${s.description}</div>
            </div>
          `).join('')}
        </div>
        <div class="recog-actions">
          <button class="recog-action-btn" onclick="captureAndRecognize()">📸 再拍一张</button>
        </div>
      </div>
    `;
    return;
  }

  // Card
  if (result.type === 'card') {
    const card = getAllCards().find(c => c.name === result.name);

    if (!card) {
      resultEl.innerHTML = `<div class="recog-error">识别到「${result.name}」但数据库未收录</div>`;
      return;
    }

    const cardClass = cardCssClass(card._cat, card.name);

    resultEl.innerHTML = `
      <div class="recog-card">
        <div class="recog-header">
          <div class="card-icon ${cardClass}" style="width:40px;height:56px;font-size:16px">
            ${card.name}
          </div>
          <div>
            <div class="recog-badge">🃏 卡牌</div>
            <div class="recog-name">【${card.name}】</div>
            <div style="font-size:12px;color:var(--text2)">${card.type}</div>
          </div>
        </div>
        <div class="recog-desc" style="margin-top:12px">${card.description}</div>
        ${card.notes ? `<div style="margin-top:8px;font-size:12px;color:var(--gold)">📌 ${card.notes}</div>` : ''}
        ${card.attack_range ? `<div style="margin-top:4px;font-size:12px;color:var(--text2)">⚔️ 攻击范围：${card.attack_range}</div>` : ''}
        <div class="recog-actions">
          <button class="recog-action-btn" onclick="captureAndRecognize()">📸 再拍一张</button>
        </div>
      </div>
    `;
    return;
  }

  // Unknown type but has name
  resultEl.innerHTML = `
    <div class="recog-card">
      <div style="text-align:center;padding:20px">
        <div style="font-size:40px;margin-bottom:10px">🔍</div>
        <div style="color:var(--gold);font-size:16px;font-weight:bold">${result.name || '识别结果'}</div>
        <div style="color:var(--text2);font-size:13px;margin-top:6px">${result.description || ''}</div>
        <div class="recog-actions" style="margin-top:12px">
          <button class="recog-action-btn" onclick="captureAndRecognize()">📸 重新识别</button>
        </div>
      </div>
    </div>
  `;
}
