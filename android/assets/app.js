// 三国杀助手 - 移动端应用逻辑

let currentTab = 'heroes';
let heroFilter = { faction: 'all', search: '' };
let cardFilter = { type: 'all', search: '' };
let deferredPrompt = null;

// ===== CAMERA STATE =====
let cameraStream = null;
let currentFacing = 'environment'; // 'environment' = 后置, 'user' = 前置
let cameraActive = false;

// ===== FACTS CHECK (for local fallback) =====
const FACTS_MAP = {};

// Build facts map from HEROES and CARDS
(function buildFacts() {
  HEROES.forEach(h => {
    FACTS_MAP[h.name] = {
      type: 'hero',
      data: h,
      name: h.name
    };
  });
  const allCards = [
    ...CARDS.basic_cards.map(c => ({ ...c, _cat: 'basic' })),
    ...CARDS.trick_cards.map(c => ({ ...c, _cat: 'trick' })),
    ...CARDS.equipment_cards.map(c => ({ ...c, _cat: 'equipment' }))
  ];
  allCards.forEach(c => {
    FACTS_MAP[c.name] = {
      type: 'card',
      data: c,
      name: c.name
    };
  });
})();

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderHeroes();
  renderCards();
  renderRules();
  renderAskExamples();
  setupInstallBanner();
  // Auto-init camera when switching to camera tab
  setupCameraTab();
});

// ===== TABS =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab + 'Page';
    document.getElementById(id).classList.add('active');
    currentTab = tab.dataset.tab;
    if (currentTab === 'ask') {
      document.getElementById('askResult').innerHTML = '';
    }
    if (currentTab === 'camera') {
      // Auto start camera when entering tab
      startCamera();
    } else {
      stopCamera();
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
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="not-found">没有找到匹配的武将</div>';
    return;
  }

  list.innerHTML = filtered.map(h => `
    <div class="hero-card" onclick="toggleHero(this)">
      <div class="hero-card-header">
        <div class="hero-avatar faction-${h.faction}">${h.name[0]}</div>
        <div>
          <div class="hero-name">${h.name} <span style="font-size:11px;color:var(--text2)">${h.title}</span></div>
          <div class="hero-health">⚔️ ${h.faction} &nbsp; ❤️ ${h.health}体力</div>
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
    </div>
  `).join('');
}

function toggleHero(card) {
  card.classList.toggle('open');
}

document.getElementById('heroSearch').addEventListener('input', e => {
  heroFilter.search = e.target.value;
  renderHeroes();
});

document.getElementById('factionPills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#factionPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  heroFilter.faction = pill.dataset.faction;
  renderHeroes();
});

// ===== CARDS =====
function getAllCards() {
  return [
    ...CARDS.basic_cards.map(c => ({ ...c, _cat: 'basic' })),
    ...CARDS.trick_cards.map(c => ({ ...c, _cat: 'trick' })),
    ...CARDS.equipment_cards.map(c => ({ ...c, _cat: 'equipment' }))
  ];
}

function cardTypeIcon(cat) {
  const map = { basic: '🔴', trick: '🟣', equipment: '🔵' };
  return map[cat] || '🔵';
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
          <div class="card-name">【${c.name}】</div>
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

document.getElementById('cardSearch').addEventListener('input', e => {
  cardFilter.search = e.target.value;
  renderCards();
});

document.getElementById('cardTypePills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#cardTypePills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  cardFilter.type = pill.dataset.type;
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
}

function askQuestion(question) {
  const answer = getAnswer(question);
  const result = document.getElementById('askResult');
  result.innerHTML = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">👤 ${question}</div>
    <div class="ask-result">🤖 ${answer}</div>
  `;
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
  const factionNames = { '蜀': '蜀', '魏': '魏', '吴': '吴', '群': '群' };
  for (const [fname, fnameCN] of Object.entries(factionNames)) {
    if (q.includes(fnameCN + '国') || q.includes(fname)) {
      const heroes = HEROES.filter(h => h.faction === fnameCN);
      return `【${fnameCN}势力武将】共${heroes.length}位：\n` +
        heroes.map(h => `• ${h.name}（${h.title}）`).join('\n');
    }
  }

  // Card match
  const allCards = [...CARDS.basic_cards, ...CARDS.trick_cards, ...CARDS.equipment_cards];
  for (const c of allCards) {
    const cleanQ = q.replace(/【|】/g, '');
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

function showHeroPicker() {
  const modal = document.getElementById('heroPickerModal');
  const list = document.getElementById('modalHeroList');

  renderModalHeroes(HEROES);
  modal.classList.add('show');

  document.getElementById('modalHeroSearch').addEventListener('input', e => {
    const s = e.target.value.toLowerCase();
    const filtered = HEROES.filter(h =>
      h.name.toLowerCase().includes(s) || h.title.toLowerCase().includes(s)
    );
    renderModalHeroes(filtered);
  });
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

function selectHero(name) {
  closeHeroPicker();
  selectedHero = HEROES.find(h => h.name === name);
  renderTeamResult();
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
  const tags = HERO_TAGS[selectedHero.name] || [];

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

// ===== VISION RECOGNITION =====
async function recognizeWithVision(imageDataUrl) {
  const provider = getActiveProvider();

  if (provider.type === 'ollama') {
    return await recognizeWithOllama(imageDataUrl, provider);
  } else if (provider.type === 'openai') {
    return await recognizeWithOpenAI(imageDataUrl, provider);
  } else {
    // Fallback to local facts matching
    return { type: 'unknown', message: '未配置视觉识别模型，请检查 config.js' };
  }
}

async function recognizeWithOllama(imageDataUrl, provider) {
  const base64 = imageDataUrl.split(',')[1];

  const payload = {
    model: provider.model,
    prompt: VISION_SYSTEM_PROMPT + '\n\n请直接返回JSON，不要包含任何其他文字。',
    images: [base64],
    stream: false,
    format: 'json',
    options: {
      temperature: 0.1
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_CONFIG.timeout);

  try {
    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`Ollama 返回 ${resp.status}`);
    }

    const data = await resp.json();

    // Parse JSON response from model
    let parsed;
    try {
      parsed = JSON.parse(data.response);
    } catch {
      // Try to extract JSON from response text
      const match = data.response.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        // Fallback: do local keyword matching
        return localFallback(data.response);
      }
    }

    return parsed;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('识别超时，请确保 Ollama 已启动');
    }
    throw err;
  }
}

async function recognizeWithOpenAI(imageDataUrl, provider) {
  const base64 = imageDataUrl.split(',')[1];

  const payload = {
    model: provider.model,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: '请识别图片中的三国杀武将或卡牌，直接返回JSON格式结果。' }
        ]
      }
    ],
    max_tokens: 512
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_CONFIG.timeout);

  try {
    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API 返回 ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return localFallback(content);
      }
    }

    return parsed;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('识别超时，请检查网络连接');
    }
    throw err;
  }
}

// ===== LOCAL FALLBACK =====
function localFallback(text) {
  // Simple keyword matching from AI's text description
  const allNames = [
    ...HEROES.map(h => h.name),
    ...CARDS.basic_cards.map(c => c.name),
    ...CARDS.trick_cards.map(c => c.name),
    ...CARDS.equipment_cards.map(c => c.name)
  ];

  for (const name of allNames) {
    if (text.includes(name)) {
      const entry = FACTS_MAP[name];
      if (entry) return { type: entry.type, name: name, confidence: 0.5, source: 'local' };
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
    const allCards = [
      ...CARDS.basic_cards.map(c => ({ ...c, _cat: 'basic' })),
      ...CARDS.trick_cards.map(c => ({ ...c, _cat: 'trick' })),
      ...CARDS.equipment_cards.map(c => ({ ...c, _cat: 'equipment' }))
    ];
    const card = allCards.find(c => c.name === result.name);

    if (!card) {
      resultEl.innerHTML = `<div class="recog-error">识别到「${result.name}」但数据库未收录</div>`;
      return;
    }

    const cardClass = card.name.includes('马') ? 'horse-card' :
      card._cat === 'basic' ? 'basic-card' :
      card._cat === 'trick' ? 'trick-card' : 'equip-card';

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
