#!/usr/bin/env node
/**
 * API 数据同步脚本
 * 从 data.js 提取全部游戏数据，生成 api/data.json（FastAPI 后端数据源）。
 *
 * 用法：node tools/sync_api_data.js
 *
 * 说明：data.js 的数据全局为 var 声明（可从 vm 沙箱 context 取出），
 * VERSION 为 const（词法绑定，用正则从源码提取）。
 * CI 中运行本脚本后用 git diff --exit-code api/data.json 检查数据漂移。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA_JS = path.join(ROOT, 'data.js');
const OUT = path.join(ROOT, 'api', 'data.json');

const src = fs.readFileSync(DATA_JS, 'utf8');

// VERSION 是 const（词法绑定），正则提取
const versionMatch = src.match(/VERSION = "([\d.]+)"/);
if (!versionMatch) {
  console.error('ERROR: VERSION not found in data.js');
  process.exit(1);
}

// 其余数据全局为 var（进入 vm 沙箱 context）
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'data.js' });

const KEYS = ['HEROES', 'ALL_TAGS', 'SYNERGIES', 'GENERAL_TIP', 'TEAM_COMPOSITIONS', 'CARDS', 'RULES'];
const out = { VERSION: versionMatch[1] };
for (const key of KEYS) {
  if (sandbox[key] === undefined) {
    console.error('ERROR: missing data global: ' + key);
    process.exit(1);
  }
  out[key] = sandbox[key];
}

const cardCount = out.CARDS.basic_cards.length + out.CARDS.trick_cards.length + out.CARDS.equipment_cards.length;
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`api/data.json synced: v${out.VERSION} | ${out.HEROES.length} 武将 | ${out.ALL_TAGS.length} 标签 | ${cardCount} 卡牌`);
