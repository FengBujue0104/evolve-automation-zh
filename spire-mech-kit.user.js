// ==UserScript==
// @name         尖塔机甲工具箱
// @namespace    evolve-spire-mech-kit
// @version      1.5.3
// @description  通关自动换装与补队；搜集机铺满、缓冲与地狱化升级；灵魂宝石预留；补给近满时拆搜集机补泰坦；尖塔四件套独立自动建造与供电。
// @author       VPS探针开发
// @match        https://g8hh.github.io/evolve/
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 探测 Evolve ----------
  // 注意：settings.expose 开启时，window.evolve.global 是 deepClone，
  // 每帧 updateDebugData() 会覆盖。读写「会改档」的状态必须走 Vue 绑定的真对象
  //（mechList / mechAssembly / buildQueue / resSoul_Gem），与 Vollch 相同。
  function game() {
    return window.evolve || window.game || null;
  }
  function g() {
    const e = game();
    return e && e.global ? e.global : null; // 克隆：适合只读快照；写入请用 live*
  }
  function getVueById(id) {
    const el = document.getElementById(id);
    return el && el.__vue__ ? el.__vue__ : null;
  }
  function listVue() { return getVueById('mechList'); }
  function assemblyVue() { return getVueById('mechAssembly'); }
  function queueVue() { return getVueById('buildQueue'); }

  function liveMechbay() {
    const lv = listVue();
    if (lv && lv.$data && Array.isArray(lv.$data.mechs)) return lv.$data;
    const av = assemblyVue();
    if (av && av.m && Array.isArray(av.m.mechs)) return av.m;
    const glob = g();
    return glob && glob.portal ? glob.portal.mechbay : null;
  }
  function livePurifier() {
    const av = assemblyVue();
    if (av && av.p && typeof av.p.supply === 'number') return av.p;
    const glob = g();
    return glob && glob.portal ? glob.portal.purifier : null;
  }
  function liveQueue() {
    const qv = queueVue();
    if (qv && qv.$data && Array.isArray(qv.$data.queue)) return qv.$data;
    const glob = g();
    return glob ? glob.queue : null;
  }
  function liveSoulGem() {
    const el = document.getElementById('resSoul_Gem');
    if (el && el.__vue__ && el.__vue__.$data && typeof el.__vue__.$data.amount === 'number') {
      return el.__vue__.$data;
    }
    const glob = g();
    return glob && glob.resource ? glob.resource.Soul_Gem : null;
  }
  function liveBlueprint() {
    const av = assemblyVue();
    if (av && av.b) return av.b;
    const mb = liveMechbay();
    return mb ? mb.blueprint : null;
  }
  function liveSpire() {
    try {
      const real = findRealGlobal();
      if (real && real.portal && real.portal.spire) return real.portal.spire;
    } catch (e) {}
    const glob = g();
    return (glob && glob.portal && glob.portal.spire) || null;
  }
  function isEvolveReady() {
    return !!(liveMechbay() && document.getElementById('mechList'));
  }

  // ---------- 机甲公式（对齐 portal.js / Vollch MechManager）----------
  const SIZE = ['small', 'medium', 'large', 'titan', 'collector'];
  const CHASSIS = ['wheel', 'tread', 'biped', 'quad', 'spider', 'hover'];
  const WEAPON = ['laser', 'kinetic', 'shotgun', 'missile', 'flame', 'plasma', 'sonic', 'tesla'];
  const EQUIP = ['special', 'shields', 'sonar', 'grapple', 'infrared', 'flare', 'radiator', 'coolant', 'ablative', 'stabilizer', 'seals'];
  const SIZE_SLOTS = { small: 0, medium: 1, large: 2, titan: 4, collector: 2 };
  const SIZE_WEAPONS = { small: 1, medium: 1, large: 2, titan: 4, collector: 0 };

  // 界面用语（与 g8hh 中文版 / strings.zh-CN 一致）；键名保持英文
  const ZH_SIZE = { small: '侦察', medium: '标准', large: '重型', titan: '泰坦', collector: '搜集' };
  const ZH_CHASSIS = { wheel: '轮子', tread: '踏板', biped: '双足', quad: '四足', spider: '蜘蛛', hover: '悬浮' };
  const ZH_WEAPON = { laser: '激光', kinetic: '机枪', shotgun: '霰弹', missile: '导弹', flame: '火焰', plasma: '切割', sonic: '音波', tesla: '电能', claws: '利爪', axe: '巨斧', hammer: '战锤', venom: '剧毒獠牙', cold: '寒霜吐息', fire: '烈焰吐息', shock: '雷电吐息', acid: '腐蚀吐息', stone: '岩石魔像', iron: '钢铁魔像', flesh: '血肉魔像', ice: '冰霜魔像', magma: '熔岩魔像' };
  const ZH_EQUIP = { shields: '护盾', sonar: '声纳', grapple: '抓钩', infrared: '红外', flare: '闪光', radiator: '暖气', coolant: '冷却', ablative: '烧蚀', stabilizer: '稳定', seals: '橡胶', jumpjet: '喷气', battery: '电池', target: '瞄准', scavenger: '清道夫', scouter: '斥候', darkvision: '黑暗视觉', echo: '回声定位', thermal: '热视觉', manashield: '法力护盾', cold: '抵抗寒冷', heat: '抵抗高温', athletic: '强健体魄', lucky: '幸运', stoneskin: '石肤' };
  const ZH_TYPE = { sand: '沙漠', swamp: '沼泽', forest: '森林', jungle: '丛林', rocky: '岩石', gravel: '砂石', muddy: '泥沼', grass: '草地', brush: '灌木', concrete: '混凝土' };
  const ZH_STATUS = { freeze: '冰冷', hot: '闷热', corrosive: '腐蚀', humid: '潮湿', windy: '风暴', hilly: '丘陵', mountain: '多山', radioactive: '放射性', quake: '地震', dust: '沙尘', river: '河流', tar: '焦油坑', steam: '蒸汽', flooded: '水淹', fog: '迷雾', rain: '雨水', hail: '冰雹', chasm: '裂谷', dark: '黑暗', gravity: '重力' };
  const ZH_BOSS = { fire_elm: '火元素', water_elm: '水元素', rock_golem: '岩石魔像', bone_golem: '骸骨魔像', mech_dino: '机械霸王龙', plant: '植物怪兽', crazed: '疯狂恶魔', minotaur: '弥诺陶洛斯', ooze: '巨型软泥怪', zombie: '僵尸群落', raptor: '迅猛龙群', frost_giant: '冰霜巨人', swarm: '蝗虫群', dragon: '巨龙', mech_dragon: '机械巨龙', construct: '发条构装体', beholder: '眼魔', worm: '巨型沙虫', hydra: '九头怪', colossus: '巨像', lich: '巫妖', ape: '巨猿', bandit: '强盗首领', croc: '远古鳄鱼', djinni: '灯神', snake: '巨蟒', centipede: '巨型蜈蚣', spider: '蜘蛛群', manticore: '蝎狮', fiend: '深渊恶魔', bat: '蝙蝠集群', medusa: '美杜莎', ettin: '双头巨人', faceless: '无面恐魔', enchanted: '附魔剑', gargoyle: '石像鬼', chimera: '奇美拉', gorgon: '戈耳工', kraken: '克拉肯', homunculus: '人造人', giant_chicken: '巨型鸡', skeleton_pack: '骷髅群' };
  const ZH_INF_MODE = { upgrade: '自动+升级', auto: '自动', always: '总是', never: '不用' };
  const ZH_FILL_MODE = { bay: '填满机库', count: '固定数量' };
  const ZH_ERR = {
    'no blueprint/mechbay': '没有蓝图或机甲舱',
    'no queue': '没有建造队列',
    'queue full': '建造队列已满',
    'no mechbay': '找不到机甲舱',
    'wait-soul': '灵魂宝石不够造泰坦',
    'no collectors': '没有可拆的搜集机',
    'cannot-fit': '即使拆光可拆搜集机也放不下泰坦',
    'partial': '腾出的空位仍不够一台泰坦',
    'not ready': '游戏未就绪',
    'no spire': '尚未解锁尖塔',
    'not-ready': '未就绪',
    disabled: '未启用',
    waygate: '恶魔领主战斗中',
    'regear-busy': '换装仍在进行'
  };
  const ZH_VIA = { 'vue.scrap': '游戏解体', 'live-direct': '直接解体', 'live-splice': '直接移除', 'live-instant': '即时建造', 'live-queue-splice': '加入队列' };
  function zhPick(map, key, fallback) { return (key != null && map[key]) || fallback || key || ''; }
  function zhSize(v) { return zhPick(ZH_SIZE, v, v); }
  function zhChassis(v) { return zhPick(ZH_CHASSIS, v, v); }
  function zhWeapon(v) { return zhPick(ZH_WEAPON, v, v); }
  function zhEquip(eq, size) {
    if (eq === 'special') {
      if (size === 'large' || size === 'cyberdemon') return '电池';
      if (size === 'titan') return '瞄准';
      return '喷气';
    }
    return zhPick(ZH_EQUIP, eq, eq);
  }
  function zhType(v) { return zhPick(ZH_TYPE, v, v); }
  function zhBoss(v) { return zhPick(ZH_BOSS, v, v); }
  function zhStatus(v) { return zhPick(ZH_STATUS, v, v); }
  function zhInfMode(v) { return zhPick(ZH_INF_MODE, v, v); }
  function zhFillMode(v) { return zhPick(ZH_FILL_MODE, v, v); }
  function zhErr(v) { if (v == null || v === '') return ''; return ZH_ERR[v] || String(v).replace(/^找不到 live mechbay$/, '找不到机甲舱数据').replace(/^找不到 live queue$/, '找不到建造队列').replace(/^找不到 #mechAssembly Vue。请打开机甲实验室页。$/, '找不到机甲组装界面，请打开机甲实验室页。'); }
  function zhVia(v) { return zhPick(ZH_VIA, v, v); }
  function zhReason(reason) {
    const r = String(reason || '');
    if (r === 'manual') return '手动';
    if (r === 'boot') return '启动';
    if (r === 'follow') return '跟进';
    if (r === 'watch') return '监视';
    if (r === 'tick') return '周期';
    if (r.indexOf('floor-clear ') === 0) return '通关第' + r.slice(12) + '层';
    return r;
  }
  function zhStatusList(status) {
    if (!status) return '无';
    const keys = typeof status === 'string' ? status.split(',').filter(Boolean) : Object.keys(status);
    return keys.length ? keys.map(zhStatus).join('、') : '无';
  }
  function zhMechBrief(m) {
    if (!m) return '?';
    const wp = (m.hardpoint || []).map(zhWeapon).join(',');
    const eq = (m.equip || []).map((e) => zhEquip(e, m.size)).join(',');
    return zhSize(m.size) + '/' + zhChassis(m.chassis) + (wp ? '/[' + wp + ']' : '') + (eq ? ' {' + eq + '}' : '');
  }


  const SmallChassisMod = {
    wheel:  { sand: 0.9,  swamp: 0.35, forest: 1,    jungle: 0.92, rocky: 0.65, gravel: 1,    muddy: 0.85, grass: 1.3,  brush: 0.9,  concrete: 1.1 },
    tread:  { sand: 1.15, swamp: 0.55, forest: 1,    jungle: 0.95, rocky: 0.65, gravel: 1.3,  muddy: 0.88, grass: 1,    brush: 1,    concrete: 1 },
    biped:  { sand: 0.78, swamp: 0.68, forest: 1,    jungle: 0.82, rocky: 0.48, gravel: 1,    muddy: 0.85, grass: 1.25, brush: 0.92, concrete: 1 },
    quad:   { sand: 0.86, swamp: 0.58, forest: 1.25, jungle: 1,    rocky: 0.95, gravel: 0.9,  muddy: 0.68, grass: 1,    brush: 0.95, concrete: 1 },
    spider: { sand: 0.75, swamp: 0.9,  forest: 0.82, jungle: 0.77, rocky: 1.25, gravel: 0.86, muddy: 0.92, grass: 1,    brush: 1,    concrete: 1 },
    hover:  { sand: 1,    swamp: 1.35, forest: 0.65, jungle: 0.55, rocky: 0.82, gravel: 1,    muddy: 1.15, grass: 1,    brush: 0.78, concrete: 1 }
  };
  const LargeChassisMod = {
    wheel:  { sand: 0.85, swamp: 0.18, forest: 1,    jungle: 0.85, rocky: 0.5,  gravel: 0.95, muddy: 0.58, grass: 1.2,  brush: 0.8,  concrete: 1 },
    tread:  { sand: 1.1,  swamp: 0.4,  forest: 0.95, jungle: 0.9,  rocky: 0.5,  gravel: 1.2,  muddy: 0.72, grass: 1,    brush: 1,    concrete: 1 },
    biped:  { sand: 0.65, swamp: 0.5,  forest: 0.95, jungle: 0.7,  rocky: 0.4,  gravel: 1,    muddy: 0.7,  grass: 1.2,  brush: 0.85, concrete: 1 },
    quad:   { sand: 0.75, swamp: 0.42, forest: 1.2,  jungle: 1,    rocky: 0.9,  gravel: 0.8,  muddy: 0.5,  grass: 0.95, brush: 0.9,  concrete: 1 },
    spider: { sand: 0.65, swamp: 0.78, forest: 0.75, jungle: 0.65, rocky: 1.2,  gravel: 0.75, muddy: 0.82, grass: 1,    brush: 0.95, concrete: 1 },
    hover:  { sand: 1,    swamp: 1.2,  forest: 0.48, jungle: 0.35, rocky: 0.68, gravel: 1,    muddy: 1.08, grass: 1,    brush: 0.7,  concrete: 1 }
  };
  const StatusMod = {
    freeze: (m) => (!m.equip.includes('radiator') ? 0.25 : 1),
    hot: (m) => (!m.equip.includes('coolant') ? 0.25 : 1),
    corrosive: (m) => (!m.equip.includes('ablative') ? (m.equip.includes('shields') ? 0.75 : 0.25) : 1),
    humid: (m) => (!m.equip.includes('seals') ? 0.75 : 1),
    windy: (m) => (m.chassis === 'hover' ? 0.5 : 1),
    hilly: (m) => (m.chassis !== 'spider' ? 0.75 : 1),
    mountain: (m) => (m.chassis !== 'spider' && !m.equip.includes('grapple') ? (m.equip.includes('flare') ? 0.75 : 0.5) : 1),
    radioactive: (m) => (!m.equip.includes('shields') ? 0.5 : 1),
    quake: (m) => (!m.equip.includes('stabilizer') ? 0.25 : 1),
    dust: (m) => (!m.equip.includes('seals') ? 0.5 : 1),
    river: (m) => (m.chassis !== 'hover' ? 0.65 : 1),
    tar: (m) => (m.chassis !== 'quad' ? (m.chassis === 'tread' || m.chassis === 'wheel' ? 0.5 : 0.75) : 1),
    steam: (m) => (!m.equip.includes('shields') ? 0.75 : 1),
    flooded: (m) => (m.chassis !== 'hover' ? 0.35 : 1),
    fog: (m) => (!m.equip.includes('sonar') ? 0.2 : 1),
    rain: (m) => (!m.equip.includes('seals') ? 0.75 : 1),
    hail: (m) => (!m.equip.includes('ablative') && !m.equip.includes('shields') ? 0.75 : 1),
    chasm: (m) => (!m.equip.includes('grapple') ? 0.1 : 1),
    dark: (m) => (!m.equip.includes('infrared') ? (m.equip.includes('flare') ? 0.25 : 0.1) : 1),
    gravity: (m) => (m.size === 'titan' ? 0.25 : m.size === 'large' ? 0.45 : m.size === 'medium' ? 0.8 : 1)
  };

  // 精简版怪物武器表（尖塔常见 + 本档 boss）；缺省时按 1 处理
  const MONSTERS = {"rock_golem":{"laser":1.0,"kinetic":0.65,"shotgun":0.35,"missile":0.95,"flame":0.5,"plasma":1.0,"sonic":0.75,"tesla":0.0},"bone_golem":{"laser":0.45,"kinetic":1.0,"shotgun":0.75,"missile":1.0,"flame":0.35,"plasma":0.55,"sonic":0.75,"tesla":0.15},"mech_dino":{"laser":0.85,"kinetic":0.45,"shotgun":0.5,"missile":0.5,"flame":0.05,"plasma":0.55,"sonic":0.35,"tesla":1.0},"plant":{"laser":0.42,"kinetic":0.2,"shotgun":0.35,"missile":0.25,"flame":1.0,"plasma":0.65,"sonic":0.75,"tesla":0.38},"crazed":{"laser":0.5,"kinetic":1.0,"shotgun":0.95,"missile":0.35,"flame":0.85,"plasma":0.65,"sonic":0.15,"tesla":0.6},"minotaur":{"laser":0.32,"kinetic":0.44,"shotgun":0.2,"missile":1.0,"flame":0.5,"plasma":0.82,"sonic":0.15,"tesla":0.35},"ooze":{"laser":0.2,"kinetic":0.0,"shotgun":0.0,"missile":0.0,"flame":0.65,"plasma":1.0,"sonic":0.85,"tesla":0.15},"zombie":{"laser":0.35,"kinetic":0.08,"shotgun":0.95,"missile":0.8,"flame":1.0,"plasma":0.45,"sonic":0.18,"tesla":0.05},"raptor":{"laser":0.68,"kinetic":1.0,"shotgun":0.33,"missile":0.44,"flame":0.55,"plasma":0.85,"sonic":0.22,"tesla":0.66},"swarm":{"laser":0.02,"kinetic":0.01,"shotgun":0.38,"missile":0.08,"flame":1.0,"plasma":0.04,"sonic":0.66,"tesla":0.45},"dragon":{"laser":0.18,"kinetic":0.35,"shotgun":0.65,"missile":1.0,"flame":0.0,"plasma":0.12,"sonic":0.22,"tesla":0.15},"mech_dragon":{"laser":0.84,"kinetic":0.18,"shotgun":0.28,"missile":0.75,"flame":0.1,"plasma":0.68,"sonic":0.22,"tesla":1.0},"construct":{"laser":0.5,"kinetic":0.34,"shotgun":0.28,"missile":0.9,"flame":0.2,"plasma":0.6,"sonic":0.08,"tesla":1.0},"beholder":{"laser":0.75,"kinetic":0.45,"shotgun":0.12,"missile":0.05,"flame":0.15,"plasma":1.0,"sonic":0.01,"tesla":0.3},"worm":{"laser":0.55,"kinetic":0.2,"shotgun":0.02,"missile":0.05,"flame":0.38,"plasma":0.45,"sonic":1.0,"tesla":0.01},"hydra":{"laser":0.85,"kinetic":0.25,"shotgun":0.6,"missile":0.45,"flame":0.75,"plasma":0.85,"sonic":0.5,"tesla":0.65},"colossus":{"laser":1.0,"kinetic":0.45,"shotgun":0.35,"missile":1.0,"flame":0.05,"plasma":0.75,"sonic":0.35,"tesla":0.5},"lich":{"laser":0.1,"kinetic":0.45,"shotgun":0.75,"missile":0.75,"flame":0.1,"plasma":0.1,"sonic":0.35,"tesla":0.5},"ape":{"laser":1.0,"kinetic":0.5,"shotgun":0.35,"missile":0.5,"flame":0.95,"plasma":0.85,"sonic":0.05,"tesla":0.68},"bandit":{"laser":0.65,"kinetic":1.0,"shotgun":0.75,"missile":0.5,"flame":0.5,"plasma":0.85,"sonic":0.25,"tesla":0.25},"croc":{"laser":0.65,"kinetic":0.5,"shotgun":0.2,"missile":0.5,"flame":0.05,"plasma":0.6,"sonic":1.0,"tesla":0.75},"djinni":{"laser":0.0,"kinetic":0.15,"shotgun":0.22,"missile":0.0,"flame":0.35,"plasma":1.0,"sonic":0.65,"tesla":0.4},"snake":{"laser":0.5,"kinetic":0.5,"shotgun":0.5,"missile":0.5,"flame":0.5,"plasma":0.5,"sonic":0.5,"tesla":0.5},"centipede":{"laser":0.5,"kinetic":0.65,"shotgun":0.5,"missile":0.6,"flame":0.85,"plasma":0.95,"sonic":0.0,"tesla":0.01},"spider":{"laser":0.65,"kinetic":0.75,"shotgun":0.9,"missile":0.15,"flame":1.0,"plasma":0.22,"sonic":0.38,"tesla":0.18},"manticore":{"laser":0.05,"kinetic":0.5,"shotgun":0.4,"missile":0.15,"flame":0.25,"plasma":0.95,"sonic":0.48,"tesla":0.6},"fiend":{"laser":0.75,"kinetic":0.25,"shotgun":0.5,"missile":0.75,"flame":0.25,"plasma":0.5,"sonic":0.25,"tesla":0.5},"bat":{"laser":0.16,"kinetic":0.25,"shotgun":0.9,"missile":0.02,"flame":0.18,"plasma":0.12,"sonic":1.0,"tesla":0.58},"medusa":{"laser":0.35,"kinetic":0.95,"shotgun":0.88,"missile":1.0,"flame":0.1,"plasma":0.3,"sonic":0.15,"tesla":0.26},"ettin":{"laser":0.5,"kinetic":0.5,"shotgun":0.6,"missile":0.25,"flame":0.35,"plasma":0.8,"sonic":0.3,"tesla":0.09},"faceless":{"laser":0.6,"kinetic":0.0,"shotgun":0.15,"missile":0.05,"flame":0.28,"plasma":0.6,"sonic":0.8,"tesla":1.0},"enchanted":{"laser":1.0,"kinetic":0.2,"shotgun":0.65,"missile":0.7,"flame":0.02,"plasma":0.95,"sonic":0.05,"tesla":0.01},"gargoyle":{"laser":0.15,"kinetic":0.5,"shotgun":1.0,"missile":0.5,"flame":0.4,"plasma":0.3,"sonic":0.85,"tesla":0.2},"chimera":{"laser":0.38,"kinetic":0.85,"shotgun":0.65,"missile":0.35,"flame":0.6,"plasma":0.42,"sonic":0.5,"tesla":0.8},"gorgon":{"laser":0.65,"kinetic":0.65,"shotgun":0.65,"missile":0.66,"flame":0.65,"plasma":0.64,"sonic":0.65,"tesla":0.65},"kraken":{"laser":0.75,"kinetic":0.35,"shotgun":0.05,"missile":0.5,"flame":0.35,"plasma":0.75,"sonic":0.18,"tesla":0.85},"homunculus":{"laser":0.05,"kinetic":0.85,"shotgun":0.75,"missile":0.65,"flame":1.0,"plasma":0.1,"sonic":0.5,"tesla":0.2},"giant_chicken":{"laser":0.95,"kinetic":0.95,"shotgun":0.95,"missile":0.95,"flame":0.95,"plasma":0.95,"sonic":0.95,"tesla":0.95},"skeleton_pack":{"laser":0.5,"kinetic":1.0,"shotgun":1.05,"missile":1.2,"flame":0.1,"plasma":0.5,"sonic":0.5,"tesla":0.2}};

  function prepared() {
    const b = g().blood;
    return (b && b.prepared) || 0;
  }
  function mechSpace(size) {
    const p = prepared();
    switch (size) {
      case 'small': return 2;
      case 'medium': return p >= 2 ? 4 : 5;
      case 'large': return p >= 2 ? 8 : 10;
      case 'titan': return p >= 2 ? 20 : 25;
      case 'collector': return 1;
      default: return 999;
    }
  }
  function mechCost(size, infernal) {
    // 对齐 portal.js mechCost
    const p = prepared();
    let s = 9999, c = 1e7;
    switch (size) {
      case 'small': {
        const base = p >= 2 ? 5e4 : 75e3;
        c = infernal ? 2.5 * base : base;
        s = infernal ? 20 : 1;
        break;
      }
      case 'medium':
        c = infernal ? 45e4 : 18e4;
        s = infernal ? 100 : 4;
        break;
      case 'large':
        c = infernal ? 925e3 : 375e3;
        s = infernal ? 500 : 20;
        break;
      case 'titan':
        c = infernal ? 15e5 : 75e4;
        s = infernal ? 1500 : 75;
        break;
      case 'collector': {
        const base = p >= 2 ? 8e3 : 1e4;
        c = infernal ? 2.5 * base : base;
        s = 1;
        break;
      }
    }
    return { s, c, space: mechSpace(size) };
  }
  function mechRefund(size, infernal) {
    const { s, c } = mechCost(size, infernal);
    return { s: Math.floor(s / 2), c: Math.floor(c / 3) };
  }

  function terrainRating(mech, rating, effects, scouts) {
    if (mech.equip.includes('special') && (mech.size === 'small' || mech.size === 'medium' || mech.size === 'collector')) {
      if (rating < 1) rating += (1 - rating) * (effects.includes('gravity') ? 0.1 : 0.2);
    }
    if (mech.size !== 'small' && rating < 1) {
      rating += (effects.includes('fog') || effects.includes('dark') ? 0.005 : 0.01) * (scouts || 0);
      if (rating > 1) rating = 1;
    }
    return rating;
  }
  function weaponPower(mech, power) {
    if (power < 1 && power !== 0 && mech.equip.includes('special') && mech.size === 'titan') {
      power += 0.25 * (1 - power);
    }
    if (mech.equip.includes('special') && (mech.size === 'large' || mech.size === 'cyberdemon')) {
      power *= 1.02;
    }
    return power;
  }
  function sizeMod(mech, floorType) {
    const concrete = floorType === 'concrete';
    switch (mech.size) {
      case 'small': return 0.0025 * (concrete ? 0.92 : 1);
      case 'medium': return 0.0075 * (concrete ? 0.95 : 1);
      case 'large': return 0.01;
      case 'titan': return 0.012 * (concrete ? 1.25 : 1);
      case 'collector': return 0; // 无战斗力
      default: return 0;
    }
  }
  function bodyMod(mech) {
    const floor = g().portal.spire;
    if (!floor || !floor.type) return 1;
    const table = (mech.size === 'small' || mech.size === 'medium') ? SmallChassisMod : LargeChassisMod;
    const terrain = (table[mech.chassis] && table[mech.chassis][floor.type]) || 1;
    const effects = Object.keys(floor.status || {});
    let rating = terrainRating(mech, terrain, effects, g().portal.mechbay.scouts || 0);
    for (const effect of effects) {
      if (StatusMod[effect]) rating *= StatusMod[effect](mech);
    }
    return rating;
  }
  function weaponMod(mech) {
    const floor = g().portal.spire;
    const boss = floor && floor.boss;
    const table = (boss && MONSTERS[boss]) || null;
    // 恶魔领主 / waygate 模式：武器亲和全按 1（与 nn(mech,true) 一致）
    const waygateFight = isWaygateFight();
    let rating = 0;
    for (let i = 0; i < (mech.hardpoint || []).length; i++) {
      const w = mech.hardpoint[i];
      const base = waygateFight ? 1 : (table ? (table[w] != null ? table[w] : 1) : 1);
      rating += weaponPower(mech, base);
    }
    return rating;
  }
  function mechPower(mech) {
    if (!mech || mech.size === 'collector') return 0;
    let rating = bodyMod(mech) * weaponMod(mech);
    rating *= sizeMod(mech, g().portal.spire && g().portal.spire.type);
    // portal.js mechRating：infernal && blood.prepared>=3 才 ×1.25
    if (mech.infernal && prepared() >= 3) rating *= 1.25;
    return rating;
  }
  function isWaygateFight() {
    const glob = g();
    const wg = glob.portal.waygate;
    const tech = glob.tech && glob.tech.waygate;
    return !!(wg && wg.on === 1 && tech >= 2 && wg.progress < 100);
  }

  function combinations(arr, k) {
    const out = [];
    function rec(start, path) {
      if (path.length === k) { out.push(path.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        path.push(arr[i]);
        rec(i + 1, path);
        path.pop();
      }
    }
    if (k <= 0) return [[]];
    rec(0, []);
    return out;
  }

  function bestWeapon() {
    if (isWaygateFight()) return 'flame'; // 任意均可
    const boss = g().portal.spire.boss;
    const table = MONSTERS[boss] || {};
    let best = WEAPON[0], bestV = -1;
    for (const w of WEAPON) {
      const v = table[w] != null ? table[w] : 0;
      if (v > bestV) { bestV = v; best = w; }
    }
    return best;
  }

  function bestBody(size) {
    const slots = SIZE_SLOTS[size] + (prepared() ? 1 : 0);
    // 强制带 special（尖塔常用）
    const equipOpts = EQUIP.slice(1); // 不含 special，稍后插入
    const need = Math.max(0, slots - 1);
    let bestMod = -1;
    let bestList = [];
    const combos = combinations(equipOpts, need);
    for (const eq of combos) {
      const equip = ['special'].concat(eq);
      for (const chassis of CHASSIS) {
        const mech = { size, chassis, equip, hardpoint: [], infernal: false };
        const mod = bodyMod(mech);
        if (mod > bestMod) {
          bestMod = mod;
          bestList = [mech];
        } else if (mod === bestMod) {
          bestList.push(mech);
        }
      }
    }
    return bestList[0] || { size, chassis: 'quad', equip: ['special'], hardpoint: [], infernal: false };
  }

  function bestMech(size) {
    size = size || 'titan';
    const body = bestBody(size);
    const w = bestWeapon();
    const n = SIZE_WEAPONS[size] || 0;
    const mech = {
      size,
      chassis: body.chassis,
      equip: body.equip.slice(),
      hardpoint: Array(n).fill(w),
      infernal: false
    };
    return mech;
  }

  function ratingOf(mech, best) {
    const bp = mechPower(best);
    const p = mechPower(mech);
    return bp > 0 ? p / bp : 0;
  }

  // ---------- 操作 ----------
  const CFG = {
    // v1.4.4：只保护「地狱化战斗机甲」（泰坦等：1500 宝石/台，拆了只回 750）；地狱化搜集机不在此保护内
    protectInfernal: true,
    // 地狱化搜集机可被拆（腾泰坦空位 / 手动按体积 collector 拆）；排序按产量升序，普通搜集机先拆、地狱化最后拆
    scrapInfernalCollectors: true,
    // 造搜集机时是否用地狱化（需 血石「地狱化」= blood.prepared≥3）：
    // 'auto'  = 仅「搜集机铺满」模式下，且付完地狱化后剩余补给仍够把其余空舱位全部铺满普通搜集机时才造地狱化
    //           （缓冲用的搜集机很快会被拆去腾泰坦位，一律造普通）
    // 'upgrade'（默认）= auto + 机库已铺满时，用「超过 sup_max×infernalUpgradeKeepRatio 的余量补给」把产量最低的普通搜集机逐台换成地狱化
    // 'always'= 补给够就造地狱化；'never' = 永远普通
    infernalCollectorMode: 'upgrade',
    infernalUpgradeKeepRatio: 0.5, // 升级只花补给中高于 sup_max×此值 的部分（留给 Vollch 造尖塔建筑/泰坦）
    infernalUpgradePerTick: 10,     // 每个 watch 周期最多换几台
    // 相对最优不拆（默认开）：当前层绝对效率再低，只要已接近本层最优就不拆，避免低效层空转拆装
    protectNearOptimal: true,
    nearOptimalRatio: 0.99, // rating >= best * 此值 → 视为相对最优
    autoScrap: false,
    autoScrapThreshold: 0.5, // 相对最优的效率低于此值才自动解体（仍受 protectNearOptimal 约束）
    autoScrapIntervalMs: 15000,
    confirmBulk: true,
    // 通关后自动换装（默认可开；面板可关）
    autoRegear: true,
    regearEffThreshold: 0.7, // 通关换装时略宽松；仍默认不拆相对最优
    regearSize: 'titan',
    regearFillMode: 'bay', // 'bay' = 填满可用 bay；'count' = 固定数量
    regearCount: 4,
    regearWatchMs: 2000,
    regearCooldownMs: 8000, // 防同 tick 重复触发
    clearOnlyHellMech: true, // 只清 hell-mech，不动建筑/科研队列
    // 持续补队（挂在 autoRegear 下）：通关流水线后继续把队列补满，直到 bay+队列机甲占地 ≥ max
    autoTopUp: true,
    topUpWatchMs: 2000, // 与 floor watch 同周期；实际复用 regear 定时器
    topUpLogQuietMs: 15000, // 无进展时日志节流
    // 搜集机铺满（默认开）：开着时持续补本层最优 collector；关掉后改攻略/补泰坦
    autoCollectorFill: true,
    // 泰坦补给不足时：先造搜集机；舱位不够一台泰坦时，只拆出刚好够 1 台泰坦的空位再造 1 台
    collectorBuffer: true,
    topUpCyclesPerTick: 8, // 每 watch 周期最多「拆+造」循环次数
    // 灵魂宝石预留：造搜集机后剩余 Soul_Gem 须 ≥ 泰坦造价 × 此值；0=关闭预留（搜集机可用完全部宝石）
    // 造泰坦本身不受限，可把宝石花光
    soulGemTitanReserve: 1,
    // 补给近满：supply/sup_max ≥ 此值时停造搜集机，优先补泰坦消耗补给；0=关闭
    supplyNearFullRatio: 0.9,
    // ---- 尖塔四件套（v1.5.3）：独立于主脚本建筑上限 / Power ----
    autoSpireFour: true,          // 总开关：自动建造 + 供电
    spireFourIntervalMs: 2000,    // 建造/研究周期
    spireFourPowerMs: 500,        // 供电回写周期（压过主脚本 Power）
    spireBuildPerTick: 1,         // 每周期最多造 1 座，避免一次掏空补给
    spireMechbayMode: 'auto',     // auto | storage | climb
    spireMechbayReserve: -1,      // ≥0 时固定预留这么多支援给机甲舱；-1=按模式自动
    autoPurifyResearch: true      // 通关获得鲜血之石后自动研究「增强型空气过滤网」
  };

  function mechs() {
    const mb = liveMechbay();
    return ((mb && mb.mechs) || []).map((m, id) => Object.assign({ id }, m));
  }

  function sameConfigAsBest(m) {
    if (!m || m.size === 'collector') return false;
    const best = bestMech(m.size);
    if (m.chassis !== best.chassis) return false;
    const hp = m.hardpoint || [];
    const bhp = best.hardpoint || [];
    if (hp.length !== bhp.length) return false;
    for (let i = 0; i < hp.length; i++) if (hp[i] !== bhp[i]) return false;
    const eq = (m.equip || []).slice().sort().join(',');
    const beq = (best.equip || []).slice().sort().join(',');
    return eq === beq;
  }

  /** 相对本层最优：rating >= nearOptimalRatio，或配置与最优完全一致 */
  function isNearOptimal(m) {
    if (!CFG.protectNearOptimal) return false;
    if (!m || m.size === 'collector') return true;
    if (sameConfigAsBest(m)) return true;
    const best = bestMech(m.size);
    const r = ratingOf(m, best);
    return r >= (CFG.nearOptimalRatio || 0.99);
  }

  function matchFilters(m, filters) {
    if (isProtectedInfernal(m)) return false;
    if (m.size === 'collector' && m.infernal && !CFG.scrapInfernalCollectors) return false;
    // 默认：已达相对最优的不进解体名单（可 filters.ignoreNearOptimal=true 强制）
    const protectNear = (filters.protectNearOptimal != null) ? !!filters.protectNearOptimal : CFG.protectNearOptimal;
    if (protectNear && !filters.ignoreNearOptimal && isNearOptimal(m)) return false;
    if (filters.allNonInfernal) return !m.infernal;
    if (filters.size && m.size !== filters.size) return false;
    if (filters.chassis && m.chassis !== filters.chassis) return false;
    if (filters.weapon) {
      const has = (m.hardpoint || []).includes(filters.weapon);
      if (!has) return false;
    }
    if (filters.effBelow != null && filters.effBelow !== '') {
      const best = bestMech(m.size === 'collector' ? 'titan' : m.size);
      const r = m.size === 'collector' ? 1 : ratingOf(m, best);
      if (!(r < Number(filters.effBelow))) return false;
    }
    const any = filters.allNonInfernal || filters.size || filters.chassis || filters.weapon || (filters.effBelow != null && filters.effBelow !== '');
    return !!any;
  }

  function previewScrap(filters) {
    return mechs().filter((m) => matchFilters(m, filters));
  }

  function doScrapIds(ids, opts) {
    // 优先走 #mechList.__vue__.scrap(id) → 闭包写的是模块级真 global（非 expose 克隆）
    // opts.ignoreNearOptimal：搜集机缓冲拆 collector 时用（相对最优不拆的明确例外）
    opts = opts || {};
    const lv = listVue();
    const mb = liveMechbay();
    const pur = livePurifier();
    const soul = liveSoulGem();
    if (!mb) return { ok: false, error: '找不到机甲舱数据' };
    const sorted = ids.slice().sort((a, b) => b - a);
    let gems = 0, supplyAdd = 0, space = 0, n = 0, skippedNear = 0;
    const beforeG = soul ? soul.amount : 0;
    const beforeS = pur ? pur.supply : 0;
    const beforeBay = mb.bay;
    const beforeN = mb.mechs.length;
    const useVue = lv && typeof lv.scrap === 'function';
    for (const id of sorted) {
      const m = mb.mechs[id];
      if (!m) continue;
      if (isProtectedInfernal(m)) continue;
      if (m.size === 'collector' && m.infernal && !CFG.scrapInfernalCollectors) continue;
      if (CFG.protectNearOptimal && !opts.ignoreNearOptimal && isNearOptimal(m)) { skippedNear++; continue; }
      const ref = mechRefund(m.size, m.infernal);
      const sz = mechSpace(m.size);
      if (useVue) {
        lv.scrap(id);
      } else {
        // 无 Vue 时直写 live 对象（仍是真引用）
        if (pur) {
          pur.supply += Math.floor(mechCost(m.size, m.infernal).c / 3);
          if (pur.supply > pur.sup_max) pur.supply = pur.sup_max;
        }
        if (soul) soul.amount += Math.floor(mechCost(m.size, m.infernal).s / 2);
        mb.mechs.splice(id, 1);
        mb.bay -= sz;
        if (mb.active > 0) mb.active--;
      }
      gems += ref.s;
      supplyAdd += ref.c;
      space += sz;
      n++;
    }
    const gemsDelta = (soul ? soul.amount : 0) - beforeG;
    const supplyDelta = (pur ? pur.supply : 0) - beforeS;
    const bayDelta = beforeBay - mb.bay;
    try { refreshStats(); } catch (e) {}
    return {
      ok: true,
      n,
      skippedNear,
      mechsBefore: beforeN,
      mechsAfter: mb.mechs.length,
      gemsExpected: gems,
      supplyExpected: supplyAdd,
      spaceExpected: space,
      gemsDelta: gemsDelta || (n ? gems : 0),
      supplyDelta: supplyDelta || (n ? supplyAdd : 0),
      bayDelta: bayDelta || (n ? space : 0),
      bay: mb.bay,
      bayMax: mb.max,
      soul: soul ? soul.amount : 0,
      supply: pur ? pur.supply : 0,
      via: useVue ? 'vue.scrap' : 'live-direct'
    };
  }

  function setBlueprint(mech) {
    const av = assemblyVue();
    if (!av) return { ok: false, error: '找不到机甲组装界面，请打开机甲实验室页。' };
    if (av.b && 'infernal' in av.b) av.b.infernal = !!mech.infernal;
    av.setSize(mech.size);
    av.setType(mech.chassis);
    for (let i = 0; i < (mech.hardpoint || []).length; i++) av.setWep(mech.hardpoint[i], i);
    for (let i = 0; i < (mech.equip || []).length; i++) av.setEquip(mech.equip[i], i);
    return { ok: true };
  }

  /**
   * 建造一台当前蓝图。资源够 → 改 live mechbay/purifier/Soul_Gem；
   * 否则 → 往 live queue 推 hell-mech（不调用 assemblyVue.build 的队列分支，避免 buildQueue catch 清空整队）。
   */
  function buildOne() {
    const mb = liveMechbay();
    const pur = livePurifier();
    const soul = liveSoulGem();
    const qobj = liveQueue();
    const bp = liveBlueprint() || (mb && mb.blueprint);
    if (!mb || !bp) return { built: false, queued: false, error: '没有蓝图或机甲舱' };
    const costs = mechCost(bp.size, bp.infernal);
    const space = mechSpace(bp.size);
    const avail = mb.max - mb.bay;
    const haveSup = pur ? pur.supply : 0;
    const haveSoul = soul ? soul.amount : 0;
    const canInstant = haveSup >= costs.c && avail >= space && haveSoul >= costs.s;

    if (canInstant) {
      if (pur) pur.supply -= costs.c;
      if (soul) soul.amount -= costs.s;
      mb.mechs.push(JSON.parse(JSON.stringify(bp)));
      mb.bay += space;
      mb.active++;
      return { built: true, queued: false, via: 'live-instant' };
    }

    if (!qobj || !Array.isArray(qobj.queue)) return { built: false, queued: false, error: '没有建造队列' };
    let used = 0;
    for (let j = 0; j < qobj.queue.length; j++) {
      used += Math.ceil((qobj.queue[j].q || 1) / (qobj.queue[j].qs || 1));
    }
    if (used >= (qobj.max || 0)) return { built: false, queued: false, error: '建造队列已满' };
    const blueprint = JSON.parse(JSON.stringify(bp));
    qobj.queue.push({
      id: 'hell-mech-' + Math.floor(Math.random() * 100000),
      action: 'hell-mech',
      type: blueprint,
      label: zhSize(blueprint.size || '?') + ' ' + zhChassis(blueprint.chassis || '?'),
      cna: false, time: 0, q: 1, qs: 1, t_max: 0, bres: false
    });
    return { built: false, queued: true, via: 'live-queue-splice' };
  }

  function buildOrQueue(count) {
    const mb = liveMechbay();
    const pur = livePurifier();
    const soul = liveSoulGem();
    const qobj = liveQueue();
    const results = [];
    for (let i = 0; i < count; i++) {
      const beforeQ = (qobj && qobj.queue || []).length;
      const beforeN = mb.mechs.length;
      const beforeBay = mb.bay;
      const beforeSoul = soul ? soul.amount : 0;
      const beforeSup = pur ? pur.supply : 0;
      const r = buildOne();
      results.push({
        queued: !!r.queued,
        built: !!r.built,
        via: r.via || null,
        error: r.error || null,
        bayDelta: mb.bay - beforeBay,
        soulDelta: beforeSoul - (soul ? soul.amount : 0),
        supplyDelta: beforeSup - (pur ? pur.supply : 0),
        queueDelta: (qobj && qobj.queue || []).length - beforeQ,
        mechsDelta: mb.mechs.length - beforeN
      });
      if (!r.built && !r.queued) break;
    }
    return {
      ok: true,
      results,
      queueLen: (qobj && qobj.queue || []).length,
      mechs: mb.mechs.length,
      bay: mb.bay,
      bayMax: mb.max,
      soul: soul ? soul.amount : 0,
      supply: pur ? pur.supply : 0
    };
  }

  function fillBayCount(size) {
    const mb = liveMechbay();
    if (!mb) return 0;
    const space = mechSpace(size);
    return Math.max(0, Math.floor((mb.max - mb.bay) / space));
  }

  /** 建造队列已占用槽位数（与游戏 qs/q 一致） */
  function queueSlotsUsed() {
    const qobj = liveQueue();
    let used = 0;
    for (const item of ((qobj && qobj.queue) || [])) {
      used += Math.ceil((item.q || 1) / (item.qs || 1));
    }
    return used;
  }

  function queueSlotsFree() {
    const qobj = liveQueue();
    if (!qobj) return 0;
    return Math.max(0, (qobj.max || 0) - queueSlotsUsed());
  }

  /** 队列里 hell-mech 建成后将占用的 bay 空间（按 type.size） */
  function hellMechQueuedBay() {
    let space = 0;
    for (const { item } of listHellMechQueue()) {
      const sz = (item.type && item.type.size) || CFG.regearSize || 'titan';
      const qty = item.q || 1;
      space += mechSpace(sz) * qty;
    }
    return space;
  }

  /**
   * 持续补队计划：want = 建成后刚好填满 bay 还缺几台（已扣队列里 hell-mech 占地），
   * attempts = min(want, 队列空位)。避免超订。
   */
  function topUpPlan(size) {
    size = size || CFG.regearSize || 'titan';
    const mb = liveMechbay();
    const qobj = liveQueue();
    const empty = { size, want: 0, attempts: 0, qFree: 0, bayFitRemaining: 0, queuedBay: 0, bay: 0, max: 0, space: mechSpace(size), queueLen: 0, hellMech: 0 };
    if (!mb || !qobj) return empty;
    const space = mechSpace(size);
    const queuedBay = hellMechQueuedBay();
    // 不用 clamp：已超订时 raw<0，禁止再拆搜集加造（避免更超订）
    const freeAfterQueueRaw = mb.max - mb.bay - queuedBay;
    const freeAfterQueue = Math.max(0, freeAfterQueueRaw);
    const bayFitRemaining = Math.floor(freeAfterQueue / space);
    const qFree = queueSlotsFree();
    let want = Math.max(0, bayFitRemaining);
    let wantViaScrap = false;
    // 舱位不够 1 台（bayFit=0）时：缓冲/近满可拆搜集腾出 1 台泰坦空位
    // 旧逻辑 want=0 → runTopUp 当「机库已满」直接返回，永远不拆（满仓卡死根因）
    if (want <= 0 && size !== 'collector' && allowScrapCollectorsForTitan() && freeAfterQueueRaw >= 0) {
      const colSp = mechSpace('collector');
      const scrapable = listScrapCollectors().length * Math.max(1, colSp);
      if (scrapable > 0 && freeAfterQueueRaw + scrapable >= space && canAfford(size, false)) {
        want = 1;
        wantViaScrap = true;
      }
    }
    // attempts = want：即时建造不占队列槽；buildOne 在队列满且无法即时时会失败并停止
    const attempts = want;
    return {
      size, want, attempts, qFree, bayFitRemaining, queuedBay, space,
      bay: mb.bay, max: mb.max,
      queueLen: (qobj.queue || []).length,
      hellMech: listHellMechQueue().length,
      projectedBay: mb.bay + queuedBay,
      wantViaScrap,
      freeAfterQueueRaw
    };
  }

  function listHellMechQueue() {
    const qobj = liveQueue();
    const q = (qobj && qobj.queue) || [];
    return q.map((item, index) => ({ index, item })).filter(x => x.item && x.item.action === 'hell-mech');
  }

  /**
   * 清空 hell-mech 队列项。splice live queue（真 global.queue）；
   * 不调用 vue.remove（其内部 buildQueue 会重建实例，循环易失效）。
   */
  function clearMechQueue() {
    const qobj = liveQueue();
    if (!qobj || !Array.isArray(qobj.queue)) {
      return { ok: false, error: '找不到建造队列', removed: 0 };
    }
    const before = qobj.queue.length;
    const beforeMech = listHellMechQueue().length;
    let removed = 0;
    for (let i = qobj.queue.length - 1; i >= 0; i--) {
      const item = qobj.queue[i];
      if (!item || item.action !== 'hell-mech') continue;
      qobj.queue.splice(i, 1);
      removed++;
    }
    return {
      ok: true,
      removed,
      beforeMech,
      afterMech: listHellMechQueue().length,
      queueBefore: before,
      queueAfter: qobj.queue.length,
      via: 'live-splice'
    };
  }

  function snapshotFloor() {
    const sp = liveSpire();
    if (!sp) return null;
    return {
      count: sp.count,
      progress: sp.progress,
      boss: sp.boss,
      type: sp.type,
      status: Object.keys(sp.status || {}).slice().sort().join(',')
    };
  }

  /** 搜集机补给效率（对齐 portal.js mechCollect：base×地形×状态） */
  function collectorRate(mech) {
    if (!mech || mech.size !== 'collector') return 0;
    const base = mech.infernal ? 31.25 : 25;
    return base * bodyMod(mech);
  }

  /** 地狱化可用：游戏只有 blood.prepared>=3 才显示蓝图 infernal 勾选（portal.js drawMechLab） */
  function infernalUnlocked() {
    return prepared() >= 3;
  }
  /** 拆搜集机时的候选资格 */
  function isScrapableCollector(m) {
    if (!m || m.size !== 'collector') return false;
    if (m.infernal && !CFG.scrapInfernalCollectors) return false;
    return true;
  }
  /** 战斗型地狱化机甲受保护（不含搜集机） */
  function isProtectedInfernal(m) {
    return !!(CFG.protectInfernal && m && m.infernal && m.size !== 'collector');
  }
  /**
   * 本次造搜集机用不用地狱化。
   * slotsLeft = 包括这台在内，本轮还打算造几台搜集机（≤ 空舱位）。
   * 经济依据（portal.js mechCost/mechCollect，prepared≥2 折扣）：
   *   普通 8000 补给→25/s；地狱化 20000→31.25/s；同占 1 舱位、同 1 宝石。
   *   每补给产出：普通 25/8000 是地狱化 31.25/20000 的 2 倍 → 补给紧时铺普通更快；
   *   每舱位产出：地狱化 +25% → 舱位是瓶颈（补给够铺满）时才值得地狱化。
   * auto 规则：补给 - 地狱化价 ≥ 普通价 × (slotsLeft-1) → 造地狱化（不会让本轮少铺任何一格）。
   */
  function chooseInfernalCollector(slotsLeft, opts) {
    opts = opts || {};
    if (!infernalUnlocked()) return false;
    const mode = CFG.infernalCollectorMode || 'auto';
    if (mode === 'never') return false;
    const sup = supplyAmount();
    const ci = mechCost('collector', true).c;
    const cn = mechCost('collector', false).c;
    if (sup < ci) return false;
    if (mode === 'always') return true;
    if (opts.buffer) return false; // 缓冲搜集机是临时的
    const left = Math.max(1, Math.floor(slotsLeft || 1));
    return (sup - ci) >= cn * (left - 1);
  }
  /**
   * 机库已铺满搜集机时：普通→地狱化 原地换（拆 1 普通 +2666，造 1 地狱化 −20000，净 17334 换 +25% 产量）。
   * 只在 mode='upgrade'、搜集铺满开、未触发补给近满改泰坦时运行；只花 sup_max×keepRatio 以上的余量。
   */
  let pendingNormalRestore = 0; // v1.4.6：拆了普通但地狱化没造成时，下个周期继续补回普通搜集机
  function restoreNormalCollector() {
    const normal = Object.assign({}, bestMech('collector'), { infernal: false });
    const set = setBlueprint(normal);
    if (!set.ok) return { built: false, queued: false, error: set.error };
    setBlueprintInfernal(false);
    return buildOne();
  }
  function upgradeCollectorsToInfernal(maxN) {
    const out = { n: 0, reason: null, restored: 0 };
    // 先处理上次没补回的普通搜集机
    while (pendingNormalRestore > 0) {
      const r = restoreNormalCollector();
      if (!(r.built || r.queued)) { out.reason = 'restore-pending'; return out; }
      pendingNormalRestore--; out.restored++;
      log('[地狱化搜集] 补回上次未建成的普通搜集机（' + (r.built ? '已建造' : '已入队') + '）');
    }
    if ((CFG.infernalCollectorMode || 'auto') !== 'upgrade') { out.reason = 'mode'; return out; }
    if (!infernalUnlocked()) { out.reason = 'locked'; return out; }
    if (!CFG.autoCollectorFill) { out.reason = 'fill-off'; return out; }
    if (shouldPreferTitanOverCollector()) { out.reason = 'supply-near-full'; return out; }
    const lim = Math.max(0, maxN == null ? (CFG.infernalUpgradePerTick || 10) : maxN);
    const keep = supplyMax() * Math.max(0, Number(CFG.infernalUpgradeKeepRatio) || 0);
    const costI = mechCost('collector', true);
    const refund = mechRefund('collector', false);
    const spI = mechSpace('collector');
    const best = bestMech('collector');
    const bestInf = Object.assign({}, best, { infernal: true });
    const newRate = collectorRate(bestInf);
    for (let i = 0; i < lim; i++) {
      if (supplyAmount() + refund.c - costI.c < keep) { out.reason = 'keep-supply'; break; }
      if (!collectorKeepsSoulReserve(true) || soulGemAmount() + refund.s < costI.s) { out.reason = 'soul'; break; }
      const cand = listCollectors(true).sort((a, b) => collectorRate(a) - collectorRate(b))[0];
      if (!cand) { out.reason = 'no-normal'; break; }
      if (collectorRate(cand) >= newRate) { out.reason = 'no-gain'; break; }
      // —— 拆之前把能检查的都检查完：补给/宝石（按返还后计）、舱位、蓝图可设置 ——
      if (supplyAmount() + refund.c < costI.c) { out.reason = 'supply'; break; }
      if (freeBaySpace() + mechSpace(cand.size) < spI) { out.reason = 'space'; break; }
      const set = setBlueprint(bestInf);
      if (!set.ok) { out.reason = 'blueprint: ' + set.error; break; }
      setBlueprintInfernal(true);
      const bp = liveBlueprint();
      if (!bp || bp.size !== 'collector' || !bp.infernal) { setBlueprintInfernal(false); out.reason = 'blueprint-mismatch'; break; }
      const sc = doScrapIds([cand.id], { ignoreNearOptimal: true });
      if (!sc.n) { setBlueprintInfernal(false); out.reason = 'scrap-fail'; break; }
      const r = buildOne();
      setBlueprintInfernal(false);
      if (r.built) { out.n++; continue; }
      if (r.queued) { out.n++; out.reason = 'queued'; break; } // 已进建造队列，空出的舱位留给它
      // 地狱化没造成：立刻补回 1 台普通搜集机；补不回就记账，下个周期再补
      const back = restoreNormalCollector();
      if (back.built || back.queued) { out.restored++; out.reason = 'build-fail-restored'; }
      else { pendingNormalRestore++; out.reason = 'build-fail-retry'; }
      log('[地狱化搜集] 地狱化建造失败（' + (r.error || '资源不足') + '），' + (back.built ? '已补回普通搜集机' : back.queued ? '普通搜集机已入队' : '下个周期重试补回'));
      break;
    }
    if (out.n) log('[地狱化搜集] 普通→地狱化 换装 ' + out.n + ' 台（余量补给 > ' + Math.floor(keep) + '）');
    return out;
  }

  /** 只改 live 蓝图的 infernal 勾选（不动底盘/装备） */
  function setBlueprintInfernal(flag) {
    const bp = liveBlueprint();
    if (!bp) return false;
    if ('infernal' in bp || flag) bp.infernal = !!flag;
    return true;
  }

  function freeBaySpace() {
    const mb = liveMechbay();
    return mb ? Math.max(0, mb.max - mb.bay) : 0;
  }

  function canAfford(size, infernal) {
    const costs = mechCost(size, !!infernal);
    const pur = livePurifier();
    const soul = liveSoulGem();
    const haveSup = pur ? pur.supply : 0;
    const haveSoul = soul ? soul.amount : 0;
    return haveSup >= costs.c && haveSoul >= costs.s;
  }

  function soulGemAmount() {
    const soul = liveSoulGem();
    return soul ? soul.amount : 0;
  }

  /** 预留下限：够 N 台泰坦的 Soul_Gem；N≤0 表示关闭预留 */
  function soulGemReserveFloor() {
    const n = Number(CFG.soulGemTitanReserve);
    if (!n || n <= 0) return 0;
    return mechCost(CFG.regearSize || 'titan', false).s * n;
  }

  /**
   * 造搜集机是否仍满足预留：
   * Soul_Gem.amount - collectorCost >= titanCost * soulGemTitanReserve
   * 预留关闭（0）时恒 true。
   */
  function collectorKeepsSoulReserve(infernal) {
    const floor = soulGemReserveFloor();
    if (floor <= 0) return true;
    const col = mechCost('collector', !!infernal).s;
    return (soulGemAmount() - col) >= floor;
  }

  /** 在预留下最多还能造几台搜集机（即时扣宝石视角；入队也按同一上限防花光） */
  function maxCollectorsBySoulReserve(infernal) {
    const floor = soulGemReserveFloor();
    const col = Math.max(1, mechCost('collector', !!infernal).s || 1);
    const have = soulGemAmount();
    if (floor <= 0) return 1e9;
    return Math.max(0, Math.floor((have - floor) / col));
  }

  function canAffordSoul(size, infernal) {
    return soulGemAmount() >= mechCost(size, !!infernal).s;
  }

  function canAffordSupply(size, infernal) {
    const pur = livePurifier();
    const haveSup = pur ? pur.supply : 0;
    return haveSup >= mechCost(size, !!infernal).c;
  }

  function setSoulGemTitanReserve(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    CFG.soulGemTitanReserve = v;
    log('灵魂宝石预留：' + (v ? ('够 ' + v + ' 台泰坦（≈' + soulGemReserveFloor() + '）') : '关'));
    try { refreshStats(); } catch (e) {}
    return v;
  }

  function supplyAmount() {
    const pur = livePurifier();
    return pur ? pur.supply : 0;
  }
  function supplyMax() {
    const pur = livePurifier();
    return pur ? (pur.sup_max || 0) : 0;
  }
  function supplyRatio() {
    const mx = supplyMax();
    if (!mx) return 0;
    return supplyAmount() / mx;
  }
  /** 补给是否接近满仓；ratio≤0 表示关闭此规则 */
  function isSupplyNearFull() {
    const r = Number(CFG.supplyNearFullRatio);
    if (!r || r <= 0) return false;
    return supplyRatio() >= r;
  }
  /**
   * 补给近满 → 停搜集、优先泰坦（仍受宝石/舱位约束）。
   * 宝石不够泰坦时仍不造搜集（近满时造搜集只会更堵补给）。
   */
  function shouldPreferTitanOverCollector() {
    return isSupplyNearFull();
  }
  /**
   * 是否允许为腾出 1 台泰坦空位拆搜集机：
   * - 搜集缓冲开；或
   * - 补给近满（要烧补给造泰坦，舱位被搜集占满时也必须拆）
   */
  function allowScrapCollectorsForTitan() {
    return !!CFG.collectorBuffer || shouldPreferTitanOverCollector();
  }
  function setSupplyNearFullRatio(n) {
    let v = Number(n);
    if (!isFinite(v) || v < 0) v = 0;
    if (v > 1) v = 1;
    CFG.supplyNearFullRatio = v;
    log('补给近满阈值：' + (v ? (v + '（现 ' + (supplyRatio() * 100).toFixed(1) + '%）→ 停搜集改补泰坦') : '关'));
    try { refreshStats(); } catch (e) {}
    return v;
  }

  function listCollectors(nonInfernalOnly) {
    return mechs().filter((m) => m.size === 'collector' && !(nonInfernalOnly && m.infernal));
  }
  /** 可拆搜集机，按补给产量升序（同配置时普通 25 < 地狱化 31.25 → 普通先拆）；产量相同普通优先 */
  function listScrapCollectors() {
    return mechs().filter(isScrapableCollector).sort((a, b) => {
      const d = collectorRate(a) - collectorRate(b);
      if (Math.abs(d) > 1e-9) return d;
      return (a.infernal ? 1 : 0) - (b.infernal ? 1 : 0);
    });
  }

  /**
   * 只拆出「刚好够造 1 台泰坦」的机库空位（titan≈20 / collector≈1 → 通常约 10~20 台）。
   * 优先拆补给效率最低的非 infernal 搜集机；忽略相对最优保护（缓冲流程例外）。
   */
  function scrapCollectorsForOneTitan() {
    const mb = liveMechbay();
    if (!mb) return { ok: false, error: 'no mechbay', n: 0, freed: 0, need: 0 };
    const titanSp = mechSpace(CFG.regearSize || 'titan');
    const titanSoul = mechCost(CFG.regearSize || 'titan', false).s;
    // 搜集机返还 floor(1/2)=0 宝石：宝石不够 1 台泰坦时拆空位无意义
    if (soulGemAmount() < titanSoul) {
      return {
        ok: false, error: 'wait-soul', n: 0, freed: 0, need: 0, titanSp,
        free: mb.max - mb.bay, soul: soulGemAmount(), titanSoul, waitedSoul: true
      };
    }
    const free = mb.max - mb.bay;
    const need = Math.max(0, titanSp - free);
    if (need <= 0) return { ok: true, n: 0, freed: 0, need: 0, titanSp, free };
    const cols = listScrapCollectors();
    if (!cols.length) return { ok: false, error: 'no collectors', n: 0, freed: 0, need, titanSp, free };
    // v1.4.6：先算「把所有可拆搜集机都拆掉」能腾出多少；即使全拆也放不下 1 台泰坦就一台都不拆
    const capacity = cols.reduce((a, m) => a + mechSpace(m.size), 0);
    if (free + capacity < titanSp) {
      return { ok: false, error: 'cannot-fit', n: 0, freed: 0, need, titanSp, free, capacity, bayMax: mb.max };
    }
    // 只拆刚好够的（按产量升序，普通先拆、地狱化最后拆）
    const picked = [];
    let acc = 0;
    for (const m of cols) {
      if (acc >= need) break;
      picked.push(m);
      acc += mechSpace(m.size);
    }
    const nScrap = picked.length;
    const ids = picked.map((m) => m.id);
    const nInfernal = picked.filter((m) => m.infernal).length;
    const r = doScrapIds(ids, { ignoreNearOptimal: true });
    const freedNow = mb.max - mb.bay;
    return {
      ok: !!r.ok && freedNow >= titanSp,
      error: (!!r.ok && freedNow < titanSp) ? 'partial' : (r.ok ? undefined : r.error),
      n: r.n || 0,
      nInfernal,
      freed: r.bayDelta || 0,
      need, nScrap, titanSp, free, capacity,
      bay: r.bay, bayMax: r.bayMax,
      soul: r.soul, supply: r.supply,
      ids
    };
  }

  /** 按本层最优搜集机蓝图建造/入队若干台（受 Soul_Gem 预留 + 补给近满约束） */
  function buildCollectors(count, opts) {
    opts = opts || {};
    const mech = bestMech('collector');
    const set = setBlueprint(mech);
    if (!set.ok) return { ok: false, error: set.error, results: [], blockedBySoulReserve: false, blockedBySupplyNearFull: false };
    if (shouldPreferTitanOverCollector()) {
      const ratio = supplyRatio();
      log('[补给近满] 不造搜集机：补给 ' + (ratio * 100).toFixed(1) + '% ≥ ' + (CFG.supplyNearFullRatio * 100) + '%，改优先泰坦');
      return {
        ok: true, results: [], queued: 0, built: 0, plan: topUpPlan('collector'), mech,
        blockedBySoulReserve: false, blockedBySupplyNearFull: true,
        supplyRatio: ratio, soul: soulGemAmount()
      };
    }
    const plan = topUpPlan('collector');
    let n = Math.min(Math.max(0, count == null ? plan.attempts : count), plan.attempts);
    const maxBySoul = maxCollectorsBySoulReserve(!!mech.infernal);
    const floor = soulGemReserveFloor();
    const beforeSoul = soulGemAmount();
    if (n > maxBySoul) {
      if (maxBySoul <= 0) {
        log('[灵魂宝石预留] 不造搜集机：现有 ' + Math.floor(beforeSoul) + '，造 1 台后会低于预留 ' + floor + '（≈泰坦×' + (CFG.soulGemTitanReserve || 0) + '）');
        return {
          ok: true, results: [], queued: 0, built: 0, plan, mech,
          blockedBySoulReserve: true, blockedBySupplyNearFull: false, soul: beforeSoul, reserveFloor: floor, maxBySoul: 0
        };
      }
      log('[灵魂宝石预留] 搜集机计划 ' + n + ' → 限 ' + maxBySoul + '（现有 ' + Math.floor(beforeSoul) + '，预留 ' + floor + '）');
      n = maxBySoul;
    }
    if (n <= 0) return { ok: true, results: [], queued: 0, built: 0, plan, mech, blockedBySoulReserve: false };
    // 逐台建造并复检预留（即时扣宝石时防止越界）
    const results = [];
    let built = 0, queued = 0, builtInfernal = 0;
    for (let i = 0; i < n; i++) {
      const inf = chooseInfernalCollector(n - i, { buffer: !!opts.buffer });
      setBlueprintInfernal(inf);
      if (!collectorKeepsSoulReserve(inf)) {
        log('[灵魂宝石预留] 中途停止：再建 1 台搜集机会低于预留 ' + floor + '（现有 ' + Math.floor(soulGemAmount()) + '）');
        break;
      }
      const r = buildOne();
      r.infernal = inf;
      results.push(r);
      if (r.built) { built++; if (inf) builtInfernal++; }
      else if (r.queued) queued++;
      else break;
    }
    setBlueprintInfernal(false); // 还原：后续泰坦等蓝图默认普通
    if (builtInfernal) log('[地狱化搜集] 本轮造地狱化 ' + builtInfernal + ' / ' + built + ' 台（模式 ' + zhInfMode(CFG.infernalCollectorMode) + '）');
    return {
      ok: true, results, built, queued, builtInfernal, plan, mech,
      blockedBySoulReserve: false,
      soul: soulGemAmount(), reserveFloor: floor, maxBySoul,
      build: { results, soul: soulGemAmount() }
    };
  }

  /**
   * 补 1 台泰坦（带搜集机缓冲）：
   * - 补给+舱位够 → 直接造/入队 1 台泰坦
   * - 补给够但舱位不够 → 只拆出 1 台泰坦空位的搜集机，再立刻造 1 台
   * - 补给不够 → 用空舱位造搜集机（等 tick 产补给）；不拆
   */
  function tryBuildOneTitanBuffered() {
    const size = CFG.regearSize || 'titan';
    const titanSp = mechSpace(size);
    const titanSoul = mechCost(size, false).s;
    const out = { scraped: 0, built: false, queued: false, collectorsBuilt: 0, collectorsQueued: 0, action: null };
    const free = freeBaySpace();
    const soulOk = canAffordSoul(size, false);
    const supplyOk = canAffordSupply(size, false);
    const afford = soulOk && supplyOk;
    out.soul = soulGemAmount();
    out.reserveFloor = soulGemReserveFloor();

    if (afford && free >= titanSp) {
      const set = setBlueprint(bestMech(size));
      if (!set.ok) { out.error = set.error; return out; }
      const r = buildOne();
      out.built = !!r.built; out.queued = !!r.queued; out.via = r.via; out.action = r.built ? 'build-titan' : (r.queued ? 'queue-titan' : 'fail');
      out.error = r.error || null;
      return out;
    }

    if (afford && free < titanSp && allowScrapCollectorsForTitan()) {
      const scrap = scrapCollectorsForOneTitan();
      out.scraped = scrap.n || 0;
      out.scrap = scrap;
      if (scrap.waitedSoul) {
        out.action = 'wait-soul';
        log('[搜集缓冲] 灵魂宝石不够 1 台泰坦（现 ' + Math.floor(soulGemAmount()) + ' / 需 ' + titanSoul + '），不拆搜集机');
        return out;
      }
      if (scrap.error === 'cannot-fit') {
        out.action = 'cannot-fit';
        if (Date.now() - (tryBuildOneTitanBuffered._cfLog || 0) > 60000) {
          tryBuildOneTitanBuffered._cfLog = Date.now();
          log('[搜集缓冲] 全部可拆搜集机拆掉也放不下 1 台泰坦（空位 ' + scrap.free + ' + 可拆 ' + scrap.capacity + ' < ' + scrap.titanSp + '），一台都不拆');
        }
        return out;
      }
      if (scrap.n) log('[搜集缓冲] 拆搜集机 ' + scrap.n + ' 台' + (scrap.nInfernal ? ('（其中地狱化 ' + scrap.nInfernal + '）') : '') + '，腾出约 ' + scrap.freed + ' 格（需 ' + scrap.need + ' / 泰坦占 ' + scrap.titanSp + '）');
      if (freeBaySpace() >= titanSp && canAfford(size, false)) {
        const set = setBlueprint(bestMech(size));
        if (!set.ok) { out.error = set.error; out.action = 'scrap-only'; return out; }
        const r = buildOne();
        out.built = !!r.built; out.queued = !!r.queued; out.via = r.via;
        out.action = r.built ? 'scrap-build-titan' : (r.queued ? 'scrap-queue-titan' : 'scrap-only');
        out.error = r.error || null;
      } else {
        out.action = 'scrap-only';
      }
      return out;
    }

    // 资源不足
    if (!afford) {
      // 宝石不够泰坦：绝不为此空转拆搜集（返还 0 宝石）
      if (!soulOk) {
        out.action = 'wait-soul';
        log('[搜集缓冲] 灵魂宝石不够 1 台泰坦（现 ' + Math.floor(soulGemAmount()) + ' / 需 ' + titanSoul + '），等待宝石；不拆搜集机');
        return out;
      }
      // 有宝石、缺补给：开缓冲 → 在预留下造搜集机（补给近满则不造搜集）
      if (CFG.collectorBuffer) {
        if (shouldPreferTitanOverCollector()) {
          out.action = 'prefer-titan-supply-full';
          out.supplyRatio = supplyRatio();
          log('[补给近满] 缓冲也不造搜集机（补给 ' + (out.supplyRatio * 100).toFixed(1) + '%），等待够造泰坦或腾舱位');
          return out;
        }
        if (free >= mechSpace('collector')) {
          const bc = buildCollectors(null, { buffer: true });
          out.collectorsBuilt = bc.built || 0;
          out.collectorsQueued = bc.queued || 0;
          out.collectorBuild = bc;
          if (bc.blockedBySupplyNearFull) {
            out.action = 'prefer-titan-supply-full';
            out.supplyRatio = bc.supplyRatio;
            return out;
          }
          if (bc.blockedBySoulReserve) {
            out.action = 'wait-soul-reserve';
            return out;
          }
          out.action = (out.collectorsBuilt + out.collectorsQueued) > 0 ? 'build-collectors' : 'wait-supply';
          if (out.collectorsBuilt + out.collectorsQueued > 0) {
            log('[搜集缓冲] 补给不足造泰坦，先补搜集机：即时 ' + out.collectorsBuilt + '、入队 ' + out.collectorsQueued + '（预留后灵魂宝石 ' + Math.floor(soulGemAmount()) + '）');
          }
          return out;
        }
        out.action = 'wait-supply';
        return out;
      }
      const set = setBlueprint(bestMech(size));
      if (!set.ok) { out.error = set.error; out.action = 'wait-supply'; return out; }
      const r = buildOne();
      out.built = !!r.built; out.queued = !!r.queued; out.via = r.via;
      out.action = r.queued ? 'queue-titan-low-supply' : (r.built ? 'build-titan' : 'wait-supply');
      out.error = r.error || null;
      return out;
    }

    out.action = 'no-space-no-collectors';
    return out;
  }

  /**
   * 通关后自动换装流水线：
   * 1) 清空 hell-mech 队列
   * 2) 按效率阈值批量解体非 infernal
   * 3) 设当前楼层最优泰坦蓝图并建造/入队补齐
   */
  function runRegearPipeline(reason) {
    const out = { ok: false, reason: reason || 'manual', steps: {} };
    if (!isEvolveReady()) {
      out.error = '机甲实验室未就绪';
      return out;
    }
    if (isWaygateFight()) {
      out.paused = true;
      out.error = '传送门/恶魔领主战斗中，暂停换装';
      log(`[换装] 跳过：${zhErr(out.error)}`);
      return out;
    }
    const glob = g();
    const wasPaused = !!(glob.settings && glob.settings.pause);
    if (glob.settings) glob.settings.pause = true; // 流水线期间暂停，避免 tick 抢队列/补给
    try {
      const floor = snapshotFloor();
      log(`[换装] 开始（${zhReason(out.reason)}）第${floor && floor.count}层 ${zhType(floor && floor.type)} 首领=${zhBoss(floor && floor.boss)} 属性=${zhStatusList(floor && floor.status)}`);

      // 1. 清队列
      const cq = clearMechQueue();
      out.steps.clearQueue = cq;
      log(`[换装] ①清机甲队列：移除 ${cq.removed} 项（${zhVia(cq.via)}），队列 ${cq.queueBefore}→${cq.queueAfter}`);

      // 2. 解体低效
      const thr = CFG.regearEffThreshold;
      const bad = previewScrap({ effBelow: thr, protectNearOptimal: CFG.protectNearOptimal });
      bad.sort((a, b) => mechPower(a) - mechPower(b));
      const scrap = bad.length ? doScrapIds(bad.map(m => m.id)) : { ok: true, n: 0, bay: glob.portal.mechbay.bay, bayMax: glob.portal.mechbay.max, soul: glob.resource.Soul_Gem.amount, supply: glob.portal.purifier.supply };
      out.steps.scrap = scrap;
      log(`[换装] ②解体效率<${thr}：${scrap.n || 0} 台（跳过相对最优 ${scrap.skippedNear || 0}）→ 机甲 ${scrap.mechsBefore}→${scrap.mechsAfter}；灵魂宝石 ${Math.floor((liveSoulGem()||{}).amount||0)}；补给 ${Math.floor((livePurifier()||{}).supply||0)}；机库 ${(liveMechbay()||{}).bay}/${(liveMechbay()||{}).max}`);

      // 3. 补装：搜集机铺满 → collector（受 Soul 预留 / 补给近满则改泰坦）；否则泰坦
      if (CFG.autoCollectorFill && !shouldPreferTitanOverCollector()) {
        const mech = bestMech('collector');
        const set = setBlueprint(mech);
        out.steps.blueprint = { set, mech: { size: mech.size, chassis: mech.chassis, hardpoint: (mech.hardpoint || []).slice(), equip: (mech.equip || []).slice() } };
        if (!set.ok) { out.error = set.error; log('[换装] ③搜集机蓝图失败：' + zhErr(set.error)); return out; }
        const plan = topUpPlan('collector');
        log('[换装] ③搜集机铺满蓝图 ' + zhMechBrief(mech) + '；计划 ' + plan.attempts + '；灵魂宝石预留 ' + soulGemReserveFloor());
        const bc = plan.attempts > 0 ? buildCollectors(plan.attempts) : { ok: true, results: [], built: 0, queued: 0, blockedBySoulReserve: false };
        const mbNow = liveMechbay();
        const build = {
          results: bc.results || [],
          queueLen: (liveQueue().queue || []).length,
          mechs: mbNow.mechs.length,
          bay: mbNow.bay,
          bayMax: mbNow.max,
          soul: soulGemAmount(),
          supply: (livePurifier() || {}).supply,
          blockedBySoulReserve: !!bc.blockedBySoulReserve
        };
        out.steps.build = build;
        const built = bc.built || 0;
        const queued = bc.queued || 0;
        log('[换装] ③完成（搜集机）：即时 ' + built + '，入队 ' + queued + (bc.blockedBySoulReserve ? '（灵魂宝石预留拦住）' : '') + '；机库 ' + build.bay + '/' + build.bayMax + '；灵魂宝石 ' + Math.floor(build.soul));
      } else {
        const size = CFG.regearSize || 'titan';
        const mech = bestMech(size);
        const set = setBlueprint(mech);
        out.steps.blueprint = { set, mech: { size: mech.size, chassis: mech.chassis, hardpoint: mech.hardpoint.slice(), equip: mech.equip.slice() } };
        if (!set.ok) { out.error = set.error; log('[换装] ③蓝图失败：' + zhErr(set.error)); return out; }
        log('[换装] ③蓝图 ' + zhMechBrief(mech) + '；开始缓冲补装');
        const cycles = [];
        const targetTitans = CFG.regearFillMode === 'count'
          ? Math.max(0, Number(CFG.regearCount) || 0)
          : Math.max(1, CFG.topUpCyclesPerTick || 8);
        for (let i = 0; i < Math.max(targetTitans * 2, 1); i++) {
          const made = cycles.filter(c => c.built || c.queued).length;
          if (made >= targetTitans) break;
          const plan = topUpPlan(size);
          if (CFG.regearFillMode !== 'count' && plan.want <= 0) break;
          const step = tryBuildOneTitanBuffered();
          cycles.push(step);
          if (!(step.built || step.queued || step.scraped || step.collectorsBuilt || step.collectorsQueued)) break;
          if (step.action === 'build-collectors' || step.action === 'wait-supply' || step.action === 'wait-soul' || step.action === 'wait-soul-reserve' || step.action === 'prefer-titan-supply-full') break;
        }
        out.steps.build = { cycles };
        const built = cycles.filter(c => c.built).length;
        const queued = cycles.filter(c => c.queued).length;
        const scraped = cycles.reduce((s, c) => s + (c.scraped || 0), 0);
        const mb = liveMechbay();
        log('[换装] ③完成：泰坦即时 ' + built + '/入队 ' + queued + '，拆搜集 ' + scraped + '；机库 ' + mb.bay + '/' + mb.max + '；机甲 ' + mb.mechs.length);
      }
      out.ok = true;
      out.floor = floor;
      topUpFollowing = !!CFG.autoTopUp; // 流水线后再跟进补队，直到 bay 满
      try { refreshStats(); } catch (e) {}
      return out;
    } finally {
      if (glob.settings) glob.settings.pause = wasPaused;
    }
  }

  // ---------- 自动解体 ----------
  let autoTimer = null;
  function autoTick() {
    if (!CFG.autoScrap || !isEvolveReady()) return;
    if (isWaygateFight()) return;
    const filters = { effBelow: CFG.autoScrapThreshold };
    const bad = previewScrap(filters);
    if (!bad.length) return;
    bad.sort((a, b) => mechPower(a) - mechPower(b));
    const id = bad[0].id;
    log(`自动解体 #${id + 1}（效率阈值 ${CFG.autoScrapThreshold}）`);
    doScrapIds([id]);
    refreshStats();
  }
  function setAuto(on) {
    CFG.autoScrap = !!on;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (CFG.autoScrap) {
      autoTimer = setInterval(autoTick, CFG.autoScrapIntervalMs);
      log('已开启自动解体（打恶魔领主时暂停）');
    } else {
      log('已关闭自动解体');
    }
  }

  // ---------- 通关侦测（spire.count 增加）+ 持续补队 ----------
  // 依据 main.js：progress>=100 → progress=0 → Blood_Stone → spire.count++ → genSpireFloor()
  // 可靠主信号：count 增加；次信号（诊断用）：progress 归零、boss/type 变化
  let lastFloor = null;
  let regearTimer = null;
  let lastRegearAt = 0;
  let regearBusy = false;
  let lastTopUpLogAt = 0;
  let topUpFollowing = false; // 通关流水线后进入跟进，直到 bay 满或关掉 autoRegear/autoTopUp

  /**
   * 持续补队：机库未满（bay + 队列 hell-mech 占地 < max）且队列有空位时继续建造。
   * - autoCollectorFill 开：只补本层最优搜集机（第1层攒建筑补给；关掉后改打 BOSS/补泰坦）
   * - 补给近满（supplyNearFullRatio）：停造搜集，改补泰坦消耗补给；舱位被搜集占满时拆搜集腾 1 台泰坦空位
   * - 否则补泰坦；补给不足先造搜集机；舱位不够则按「1台泰坦空位」拆搜集再立刻造 1 台泰坦
   */
  function runTopUp(reason) {
    const out = { ok: false, reason: reason || 'tick', did: false, cycles: [] };
    if (!CFG.autoRegear || !CFG.autoTopUp) {
      out.skipped = 'disabled';
      return out;
    }
    if (!isEvolveReady()) { out.skipped = 'not-ready'; return out; }
    if (isWaygateFight()) { out.skipped = 'waygate'; return out; }
    if (regearBusy) { out.skipped = 'regear-busy'; return out; }

    // ---- 搜集机铺满模式（补给近满则改走泰坦）----
    const divertToTitan = shouldPreferTitanOverCollector();
    out.supplyRatio = supplyRatio();
    out.divertToTitan = !!divertToTitan;
    if (CFG.autoCollectorFill && !divertToTitan) {
      const plan = topUpPlan('collector');
      out.plan = plan;
      if (plan.want <= 0) {
        out.ok = true; out.done = true; out.mode = 'collector-full';
        const up = upgradeCollectorsToInfernal();
        out.upgraded = up.n; out.upgradeStop = up.reason;
        if (up.n) { out.did = true; try { refreshStats(); } catch (e) {} }
        return out;
      }
      if (plan.attempts <= 0) {
        out.ok = true; out.waitingQueue = true; out.mode = 'collector';
        return out;
      }
      const bc = buildCollectors(plan.attempts);
      out.ok = true; out.mode = 'collector';
      out.built = bc.built || 0; out.queued = bc.queued || 0;
      out.blockedBySoulReserve = !!bc.blockedBySoulReserve;
      out.blockedBySupplyNearFull = !!bc.blockedBySupplyNearFull;
      out.soul = soulGemAmount();
      out.reserveFloor = soulGemReserveFloor();
      out.did = (out.built + out.queued) > 0;
      if (out.did) {
        lastTopUpLogAt = Date.now();
        topUpFollowing = true;
        log('[搜集铺满] ' + zhReason(reason || 'tick') + '：即时 ' + out.built + '、入队 ' + out.queued + '；机库 ' + ((liveMechbay()||{}).bay) + '/' + ((liveMechbay()||{}).max) + '；灵魂宝石 ' + Math.floor(out.soul) + '（预留 ' + out.reserveFloor + '）');
        try { refreshStats(); } catch (e) {}
      } else if (out.blockedBySoulReserve) {
        const now = Date.now();
        if (now - lastTopUpLogAt >= (CFG.topUpLogQuietMs || 15000)) {
          lastTopUpLogAt = now;
          log('[搜集铺满] 灵魂宝石预留拦住：现有 ' + Math.floor(out.soul) + ' < 预留 ' + out.reserveFloor + '+搜集造价，等待宝石');
        }
      }
      return out;
    }
    if (CFG.autoCollectorFill && divertToTitan) {
      const now = Date.now();
      if (now - lastTopUpLogAt >= (CFG.topUpLogQuietMs || 15000)) {
        lastTopUpLogAt = now;
        log('[补给近满] 搜集铺满暂停，改补泰坦消耗补给（' + (out.supplyRatio * 100).toFixed(1) + '% ≥ ' + ((CFG.supplyNearFullRatio || 0) * 100) + '%）');
      }
    }

    // ---- 泰坦补队（带搜集机缓冲；补给近满时不会再造搜集）----
    const size = CFG.regearSize || 'titan';
    let plan = topUpPlan(size);
    out.plan = plan;
    if (plan.want <= 0) {
      if (topUpFollowing) {
        topUpFollowing = false;
        log('[持续补队] 机库已满（机库 ' + plan.bay + '+队列占地 ' + plan.queuedBay + ' / ' + plan.max + '），停止跟进');
      }
      out.ok = true; out.done = true; out.mode = 'titan';
      return out;
    }

    const maxCycles = Math.max(1, CFG.topUpCyclesPerTick || 8);
    let did = false;
    for (let i = 0; i < maxCycles; i++) {
      plan = topUpPlan(size);
      if (plan.want <= 0) break;
      // 队列满且无法即时造（无空 bay / 无补给）时等下一轮
      const free = freeBaySpace();
      const titanSp = mechSpace(size);
      const afford = canAfford(size, false);
      if (plan.qFree <= 0 && !(afford && free >= titanSp) && !(afford && free < titanSp && listScrapCollectors().length)) {
        out.waitingQueue = true;
        break;
      }
      const step = tryBuildOneTitanBuffered();
      out.cycles.push(step);
      if (step.built || step.queued || step.scraped || step.collectorsBuilt || step.collectorsQueued) did = true;
      else break;
      // 造了搜集机等补给：本 tick 不再空转
      if (step.action === 'build-collectors' || step.action === 'wait-supply' || step.action === 'wait-soul' || step.action === 'wait-soul-reserve' || step.action === 'prefer-titan-supply-full') break;
    }
    out.ok = true; out.mode = 'titan'; out.did = did;
    if (did) {
      lastTopUpLogAt = Date.now();
      topUpFollowing = true;
      const plan2 = topUpPlan(size);
      const built = out.cycles.filter((c) => c.built).length;
      const queued = out.cycles.filter((c) => c.queued).length;
      const scraped = out.cycles.reduce((s, c) => s + (c.scraped || 0), 0);
      const cBuilt = out.cycles.reduce((s, c) => s + (c.collectorsBuilt || 0), 0);
      log('[持续补队] ' + zhReason(reason || 'tick') + '：泰坦即时 ' + built + '/入队 ' + queued + '，拆搜集 ' + scraped + '，造搜集 ' + cBuilt + '；机库 ' + ((liveMechbay()||{}).bay) + '/' + ((liveMechbay()||{}).max) + '；仍缺泰坦 ' + plan2.want);
      try { refreshStats(); } catch (e) {}
      if (plan2.want <= 0) {
        topUpFollowing = false;
        log('[持续补队] 补满完成');
      }
    } else if (out.waitingQueue) {
      const now = Date.now();
      if (now - lastTopUpLogAt >= (CFG.topUpLogQuietMs || 15000)) {
        lastTopUpLogAt = now;
        log('[持续补队] 等待队列空位：还缺 ' + plan.want + ' 台泰坦，队列 ' + plan.queueLen);
      }
    }
    return out;
  }

  function floorWatchTick() {
    if (!isEvolveReady()) return;
    const cur = snapshotFloor();
    if (!cur) return;
    if (lastFloor == null) {
      lastFloor = cur;
      if (CFG.autoRegear && CFG.autoTopUp) runTopUp('boot');
      return;
    }
    const cleared = cur.count > lastFloor.count;
    if (cleared) {
      const delta = cur.count - lastFloor.count;
      log('[通关] 侦测到打通 ' + delta + ' 层：' + lastFloor.count + '→' + cur.count + '（' + zhType(lastFloor.type) + '/' + zhBoss(lastFloor.boss) + ' → ' + zhType(cur.type) + '/' + zhBoss(cur.boss) + '，进度 ' + Number(lastFloor.progress).toFixed(2) + '→' + Number(cur.progress).toFixed(2) + '）');
      lastFloor = cur;
      if (CFG.autoRegear) {
        const now = Date.now();
        if (regearBusy) {
          log('[换装] 上一次流水线仍在执行，跳过');
        } else if (now - lastRegearAt < CFG.regearCooldownMs) {
          log('[换装] 冷却中，跳过');
        } else {
          regearBusy = true;
          try {
            lastRegearAt = now;
            runRegearPipeline('floor-clear ' + cur.count);
            topUpFollowing = true;
          } finally {
            regearBusy = false;
          }
        }
      }
    } else {
      lastFloor = cur;
    }
    if (CFG.autoRegear && CFG.autoTopUp && !regearBusy) {
      runTopUp(topUpFollowing ? 'follow' : 'watch');
    }
    try { refreshStats(); } catch (e) {}
  }

  function setAutoRegear(on) {
    CFG.autoRegear = !!on;
    if (regearTimer) { clearInterval(regearTimer); regearTimer = null; }
    if (CFG.autoRegear) {
      lastFloor = snapshotFloor();
      regearTimer = setInterval(floorWatchTick, CFG.regearWatchMs);
      topUpFollowing = !!CFG.autoTopUp;
      log('通关后自动换装：开（效率 ' + CFG.regearEffThreshold + '，尺寸 ' + zhSize(CFG.regearSize) + '，' + zhFillMode(CFG.regearFillMode) + '；持续补队 ' + (CFG.autoTopUp ? '开' : '关') + '）');
    } else {
      topUpFollowing = false;
      log('通关后自动换装：关');
    }
  }

  function setAutoTopUp(on) {
    CFG.autoTopUp = !!on;
    if (!CFG.autoTopUp) topUpFollowing = false;
    else if (CFG.autoRegear) {
      topUpFollowing = true;
      if (!regearTimer) setAutoRegear(true);
      try { runTopUp('toggle'); } catch (e) {}
    }
    log('持续补队：' + (CFG.autoTopUp ? '开' : '关'));
    try { refreshStats(); } catch (e) {}
  }

  function setAutoCollectorFill(on) {
    CFG.autoCollectorFill = !!on;
    if (CFG.autoCollectorFill) {
      topUpFollowing = !!(CFG.autoRegear && CFG.autoTopUp);
      log('搜集机铺满：开');
    } else {
      topUpFollowing = !!(CFG.autoRegear && CFG.autoTopUp);
      log('搜集机铺满：关');
    }
    try { refreshStats(); } catch (e) {}
  }

  function setCollectorBuffer(on) {
    CFG.collectorBuffer = !!on;
    log('搜集缓冲：' + (CFG.collectorBuffer ? '开' : '关'));
    try { refreshStats(); } catch (e) {}
  }

  /**
   * 测试用：不写 expose 克隆（会回滚）。把 lastFloor 钉在 count-1，
   * 让 floorWatchTick 认为刚通关，从而跑流水线。真通关时游戏会 ++ 真 global.spire.count，
   * 克隆在下一帧 updateDebugData 后同步，侦测同样生效。
   */
  function simulateFloorClear() {
    if (!isEvolveReady()) return { ok: false, error: '游戏未就绪' };
    const cur = snapshotFloor();
    if (!cur) return { ok: false, error: '尚未解锁尖塔' };
    const before = Object.assign({}, cur);
    lastFloor = Object.assign({}, cur, { count: cur.count - 1, progress: 99.9 });
    floorWatchTick();
    return { ok: true, before, after: snapshotFloor(), triggeredFrom: lastFloor };
  }

  // ---------- 尖塔四件套规划（与 mech-kit/spire-four-math.js 同步）----------
  function supplyFrom(port, camp) {
    return Math.round((port || 0) * (1 + (camp || 0) * 0.4) * 10000 + 100);
  }
  function getBestSupplyRatio(support, maxPorts, maxCamps) {
    let bestPort = 0, bestCamp = 0;
    const optPort = Math.ceil(support / 2 + 1);
    const optCamp = Math.floor(support / 2 - 1);
    if (support <= 3 || optPort > maxPorts) {
      bestPort = Math.min(maxPorts, support);
      bestCamp = Math.min(maxCamps, support - bestPort);
    } else if (optCamp > maxCamps) {
      bestCamp = Math.min(maxCamps, support);
      bestPort = Math.min(maxPorts, support - bestCamp);
    } else if (optPort <= maxPorts && optCamp <= maxCamps) {
      bestPort = optPort;
      bestCamp = optCamp;
    }
    return [supplyFrom(bestPort, bestCamp), bestPort, bestCamp];
  }
  function planSpireFour(state) {
    const supportMax = Math.max(0, Math.floor(Number(state.supportMax) || 0));
    const portCount = Math.max(0, Math.floor(Number(state.portCount) || 0));
    const campCount = Math.max(0, Math.floor(Number(state.campCount) || 0));
    const bayCount = Math.max(0, Math.floor(Number(state.mechbayCount) || 0));
    const purifierCount = Math.max(0, Math.floor(Number(state.purifierCount) || 0));
    const combatSpace = Math.max(0, Number(state.combatSpace) || 0);
    const bayUsed = Math.max(0, Number(state.bayUsed) || 0);
    const mode = state.mechbayMode || 'auto';
    let reserve = Number(state.mechbayReserve);
    const combatBays = Math.ceil(combatSpace / 25) || 0;
    const usedBays = Math.ceil(bayUsed / 25) || 0;
    const autoBays = Math.max(usedBays, combatBays + (combatSpace > 0 || bayCount > 0 || bayUsed > 0 ? 1 : 0));
    let wantBay;
    if (Number.isFinite(reserve) && reserve >= 0) wantBay = Math.floor(reserve);
    else if (mode === 'storage') {
      wantBay = Math.max(combatBays, Math.min(usedBays, Math.ceil((combatBays + usedBays) / 2) || combatBays));
    } else if (mode === 'climb') {
      const climbBays = Math.max(autoBays, Math.ceil(supportMax * 0.25));
      wantBay = Math.max(autoBays, Math.min(climbBays, Math.max(autoBays, Math.floor(supportMax / 3))));
    } else wantBay = autoBays;
    wantBay = Math.max(0, Math.min(wantBay, supportMax));
    const storageSupport = Math.max(0, supportMax - Math.min(wantBay, Math.max(bayCount, 0)));
    const [idealSup, idealPort, idealCamp] = getBestSupplyRatio(storageSupport, 1e9, 1e9);
    const onBay = Math.min(wantBay, bayCount, supportMax);
    const storageNow = Math.max(0, supportMax - onBay);
    const [onSup, onPort, onCamp] = getBestSupplyRatio(storageNow, portCount, campCount);
    let next = null;
    const missingBay = wantBay > bayCount;
    const missingPort = idealPort > portCount;
    const missingCamp = idealCamp > campCount;
    if (missingBay) next = 'mechbay';
    else if (missingPort && missingCamp) {
      const ifPort = supplyFrom(Math.min(portCount + 1, idealPort), Math.min(campCount, idealCamp));
      const ifCamp = supplyFrom(Math.min(portCount, idealPort), Math.min(campCount + 1, idealCamp));
      next = ifCamp >= ifPort ? 'base_camp' : 'port';
    } else if (missingPort) next = 'port';
    else if (missingCamp) next = 'base_camp';
    else next = 'purifier';
    return {
      supportMax, wantBay, wantPort: idealPort, wantCamp: idealCamp,
      wantPurifier: purifierCount + (next === 'purifier' ? 1 : 0),
      on: {
        purifier: Math.max(0, Math.floor(Number(state.purifierOn != null ? state.purifierOn : purifierCount) || 0)),
        port: onPort, camp: onCamp, mechbay: onBay
      },
      targetSupMax: idealSup, currentPlannedSupMax: onSup, next, combatBays, usedBays, autoBays, bayUsed, storageSupport, mode
    };
  }

  const SPIRE_FOUR = [
    { key: 'purifier', id: 'portal-purifier', zh: '空气净化器' },
    { key: 'port', id: 'portal-port', zh: '登陆点' },
    { key: 'base_camp', id: 'portal-base_camp', zh: '登陆营地' },
    { key: 'mechbay', id: 'portal-mechbay', zh: '机甲舱' }
  ];
  const SPIRE_FOUR_KEYS = SPIRE_FOUR.map(x => x.key);
  const VOLLCH_SPIRE_KEYS = SPIRE_FOUR.flatMap(({ id }) => ['bat' + id, 'bld_s_' + id, 'bld_s2_' + id]);
  const VOLLCH_BACKUP_KEY = 'smk-spire-four-vollch-backup';
  const ZH_SPIRE_BLD = { purifier: '空气净化器', port: '登陆点', base_camp: '登陆营地', mechbay: '机甲舱' };
  const ZH_SPIRE_BAY_MODE = { auto: '自动', storage: '仓储优先', climb: '爬塔优先' };

  function portalVue(key) { return getVueById('portal-' + key); }
  function techVue(id) { return getVueById(id); } // tech-purify

  let _realGlobal = null;
  function findRealGlobal() {
    if (_realGlobal && _realGlobal.portal && _realGlobal.portal.purifier) return _realGlobal;
    const pur = livePurifier();
    const mb = liveMechbay();
    const tryG = (obj) => {
      if (!obj || !obj.portal) return null;
      if (pur && obj.portal.purifier === pur) return obj;
      if (mb && obj.portal.mechbay === mb) return obj;
      return null;
    };
    const ev = game();
    let hit = tryG(ev && ev.global);
    if (hit) { _realGlobal = hit; return hit; }
    const q = [], seen = new Set();
    try {
      document.querySelectorAll('*').forEach((el) => { if (el.__vue__) q.push(el.__vue__); });
    } catch (e) {}
    let guard = 0;
    while (q.length && guard++ < 4000) {
      const v = q.pop();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      hit = tryG(v.global) || tryG(v.$data && v.$data.global) || tryG(v.g);
      if (hit) { _realGlobal = hit; return hit; }
      if (v.$parent) q.push(v.$parent);
      if (v.$root && v.$root !== v) q.push(v.$root);
      if (v.$children) for (let i = 0; i < v.$children.length; i++) q.push(v.$children[i]);
    }
    return null;
  }

  function livePortalStruct(key) {
    const vue = portalVue(key);
    if (vue && vue.act && typeof vue.act.count === 'number') return vue.act;
    if (vue && vue.$data && vue.$data.act && typeof vue.$data.act.count === 'number') return vue.$data.act;
    if (key === 'purifier') return livePurifier();
    if (key === 'mechbay') return liveMechbay();
    const real = findRealGlobal();
    if (real && real.portal && real.portal[key]) return real.portal[key];
    const glob = g();
    return glob && glob.portal && glob.portal[key] ? glob.portal[key] : null;
  }
  function isLiveWriteable(key, inst) {
    if (!inst) return false;
    const vue = portalVue(key);
    if (vue && (vue.act === inst || (vue.$data && vue.$data.act === inst))) return true;
    if (key === 'purifier' && inst === livePurifier()) return true;
    if (key === 'mechbay' && inst === liveMechbay()) return true;
    const real = findRealGlobal();
    if (real && real.portal && real.portal[key] === inst) return true;
    return false;
  }
  function spireActionDef(key) {
    const ev = game();
    return ev && ev.actions && ev.actions.portal && ev.actions.portal.prtl_spire
      ? ev.actions.portal.prtl_spire[key] : null;
  }
  function techDef(id) {
    const ev = game();
    const tech = ev && ev.actions && ev.actions.tech;
    if (!tech) return null;
    return tech[id] || tech['tech_' + id] || null;
  }
  function supportPerPurifier() {
    const def = spireActionDef('purifier');
    if (def && typeof def.support === 'function') {
      try { const n = Number(def.support()); if (n > 0) return n; } catch (e) {}
    }
    const glob = g();
    let base = (glob && glob.tech && glob.tech.b_stone >= 3) ? 1.25 : 1;
    try {
      if (glob && glob.tech && glob.tech.hell_spire >= 11 && glob.eden && glob.eden.asphodel_harvester) {
        const n = glob.eden.asphodel_harvester.on || 0;
        base *= 1 + (n / 50);
      }
    } catch (e) {}
    return +base.toFixed(2);
  }
  function currentSupportMax() {
    const pur = livePortalStruct('purifier') || livePurifier() || {};
    if (typeof pur.s_max === 'number' && pur.s_max > 0) return Math.floor(pur.s_max);
    const on = (typeof pur.on === 'number' ? pur.on : (pur.count || 0));
    return Math.floor(on * supportPerPurifier());
  }
  function combatMechSpace() {
    const list = mechs();
    let n = 0;
    for (const m of list) {
      if (!m || m.size === 'collector') continue;
      n += mechSpace(m.size);
    }
    return n;
  }
  /** 机库占用：优先 live.bay，并与机甲列表占地取较大值，避免 bay 字段滞后导致预留过低 */
  function totalBayUsed() {
    const mb = liveMechbay() || {};
    let fromField = Math.max(0, Number(mb.bay) || 0);
    let fromMechs = 0;
    const list = (mb.mechs && mb.mechs.length) ? mb.mechs : mechs();
    for (const m of list) {
      if (!m) continue;
      fromMechs += mechSpace(m.size);
    }
    return Math.max(fromField, fromMechs);
  }
  function snapshotSpireFour() {
    const pick = (key) => {
      const s = livePortalStruct(key) || {};
      return { count: s.count || 0, on: typeof s.on === 'number' ? s.on : 0 };
    };
    const pur = pick('purifier');
    const port = pick('port');
    const camp = pick('base_camp');
    const bay = pick('mechbay');
    const mb = liveMechbay() || {};
    const used = totalBayUsed();
    return {
      supportMax: currentSupportMax(),
      purifierCount: pur.count, purifierOn: pur.on,
      portCount: port.count, portOn: port.on,
      campCount: camp.count, campOn: camp.on,
      mechbayCount: bay.count, mechbayOn: bay.on,
      combatSpace: combatMechSpace(),
      titanSpace: mechSpace('titan'),
      bayUsed: used,
      bayMax: mb.max || 0,
      mechbayMode: CFG.spireMechbayMode || 'auto',
      mechbayReserve: CFG.spireMechbayReserve
    };
  }
  function planFromLive() {
    return planSpireFour(snapshotSpireFour());
  }

  function resourceAmount(name) {
    if (name === 'Supply') {
      const p = livePurifier();
      if (p && typeof p.supply === 'number') return p.supply;
    }
    if (name === 'Soul_Gem') {
      const s = liveSoulGem();
      if (s && typeof s.amount === 'number') return s.amount;
    }
    const glob = g();
    const r = glob && glob.resource && glob.resource[name];
    return r && typeof r.amount === 'number' ? r.amount : 0;
  }
  function buildingCosts(key) {
    const def = spireActionDef(key);
    const out = {};
    if (!def || !def.cost) return out;
    for (const [res, fn] of Object.entries(def.cost)) {
      try {
        const n = typeof fn === 'function' ? Number(fn()) : Number(fn);
        if (n > 0) out[res] = n;
      } catch (e) {}
    }
    return out;
  }
  function canAffordCosts(costs) {
    if (!costs) return false;
    for (const [res, n] of Object.entries(costs)) {
      if (resourceAmount(res) < n) return false;
    }
    return true;
  }
  function isBuildingUnlocked(key) {
    const def = spireActionDef(key);
    const glob = g();
    if (!glob) return false;
    if (def && def.reqs) {
      for (const [tech, lv] of Object.entries(def.reqs)) {
        if ((glob.tech && glob.tech[tech] || 0) < lv) return false;
      }
    }
    const inst = livePortalStruct(key);
    if (inst && typeof inst.count === 'number') return true;
    return !!(glob.portal && glob.portal[key]);
  }

  function syncMechbayMax(inst) {
    if (!inst) return;
    // 与 portal.js updateMechbay 一致：max = 开启的机甲舱 × 25。
    // 禁止在此调用 postPower/updateMechbay：它们读的是上一帧 spire_on，
    // 会把刚写入的 max 立刻盖成旧值（例如 on=21 却变回 900）。
    // 下一帧主循环会按新的 .on 重算 spire_on 并自行 updateMechbay。
    const on = Math.max(0, Math.min(inst.count || 0, Math.floor(Number(inst.on) || 0)));
    inst.max = on * 25;
  }
  function setStructOn(key, target) {
    const inst = livePortalStruct(key);
    if (!inst || typeof inst.count !== 'number') return { ok: false, reason: 'no-struct' };
    const want = Math.max(0, Math.min(inst.count, Math.floor(target)));
    const before = typeof inst.on === 'number' ? inst.on : 0;
    if (!isLiveWriteable(key, inst)) return { ok: false, reason: 'clone' };
    if (before !== want) inst.on = want;
    if (key === 'mechbay') syncMechbayMax(inst);
    return { ok: true, changed: want - before, on: inst.on, max: key === 'mechbay' ? inst.max : undefined };
  }

  function applySpirePower(plan) {
    if (!plan) plan = planFromLive();
    const out = {};
    // 空气净化器：尽可能全开（游戏在电力不足时会自己亮警告，不主动关已开的）
    const pur = livePortalStruct('purifier');
    if (pur && typeof pur.count === 'number') {
      out.purifier = setStructOn('purifier', pur.count);
    }
    out.port = setStructOn('port', plan.on.port);
    out.camp = setStructOn('base_camp', plan.on.camp);
    out.mechbay = setStructOn('mechbay', plan.on.mechbay);
    return out;
  }

  // ---- 屏蔽主脚本对四件套的自动建造 / 智能供电（只改页面内 Vollch 开关，关掉时还原）----
  function readVollchFlag(key) {
    const el = document.querySelector('input.script_' + key);
    if (el) return !!el.checked;
    try {
      const raw = JSON.parse(localStorage.getItem('settings') || '{}');
      if (Object.prototype.hasOwnProperty.call(raw, key)) return !!raw[key];
    } catch (e) {}
    return null;
  }
  function setVollchFlag(key, value) {
    const els = document.querySelectorAll('input.script_' + key);
    if (!els.length) return false;
    let changed = false;
    els.forEach((inp) => {
      if (!!inp.checked !== !!value) {
        inp.checked = !!value;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
    });
    return changed;
  }
  function patchVollchSettingsLocal(patch) {
    try {
      const raw = JSON.parse(localStorage.getItem('settings') || '{}');
      Object.assign(raw, patch);
      localStorage.setItem('settings', JSON.stringify(raw));
      return true;
    } catch (e) { return false; }
  }
  function suppressVollchSpire(on) {
    const result = { on: !!on, applied: false, restored: false, missing: [], localPatched: false };
    try {
      if (on) {
        let backup = null;
        try { backup = JSON.parse(localStorage.getItem(VOLLCH_BACKUP_KEY) || 'null'); } catch (e) {}
        if (!backup) {
          backup = {};
          VOLLCH_SPIRE_KEYS.forEach((k) => {
            const v = readVollchFlag(k);
            if (v != null) backup[k] = v;
            else {
              try {
                const raw = JSON.parse(localStorage.getItem('settings') || '{}');
                if (Object.prototype.hasOwnProperty.call(raw, k)) backup[k] = !!raw[k];
              } catch (e2) {}
            }
          });
          try { localStorage.setItem(VOLLCH_BACKUP_KEY, JSON.stringify(backup)); } catch (e) {}
        }
        const localPatch = {};
        VOLLCH_SPIRE_KEYS.forEach((k) => {
          if (!setVollchFlag(k, false)) {
            if (document.querySelector('input.script_' + k) == null) result.missing.push(k);
            localPatch[k] = false;
          }
        });
        if (Object.keys(localPatch).length) {
          result.localPatched = patchVollchSettingsLocal(localPatch);
        }
        result.applied = true;
      } else {
        let backup = null;
        try { backup = JSON.parse(localStorage.getItem(VOLLCH_BACKUP_KEY) || 'null'); } catch (e) {}
        if (backup && typeof backup === 'object') {
          Object.entries(backup).forEach(([k, v]) => setVollchFlag(k, !!v));
          patchVollchSettingsLocal(backup);
        }
        try { localStorage.removeItem(VOLLCH_BACKUP_KEY); } catch (e) {}
        result.restored = !!backup;
      }
    } catch (e) {
      result.error = String(e && e.message || e);
    }
    return result;
  }

  function clickAction(vueId, def) {
    const vue = getVueById(vueId);
    if (vue && typeof vue.action === 'function') {
      try { vue.action(); return 'vue'; } catch (e) { return 'error:' + (e && e.message || e); }
    }
    if (def && typeof def.action === 'function') {
      try {
        const r = def.action();
        return r === false ? 'def-false' : 'def';
      } catch (e) { return 'error:' + (e && e.message || e); }
    }
    return 'no-target';
  }

  function purifyStatus() {
    const glob = g();
    const tech = glob && glob.tech || {};
    const has = (tech.b_stone || 0) >= 3;
    const unlocked = (tech.hell_spire || 0) >= 3 && (tech.b_stone || 0) >= 2;
    const blood = resourceAmount('Blood_Stone');
    const knowledge = resourceAmount('Knowledge');
    const costs = { Knowledge: 52500000, Blood_Stone: 1 };
    const def = techDef('purify');
    if (def && def.cost) {
      try {
        if (typeof def.cost.Knowledge === 'function') costs.Knowledge = Number(def.cost.Knowledge()) || costs.Knowledge;
        if (typeof def.cost.Blood_Stone === 'function') costs.Blood_Stone = Number(def.cost.Blood_Stone()) || costs.Blood_Stone;
      } catch (e) {}
    }
    const affordable = unlocked && !has && blood >= costs.Blood_Stone && knowledge >= costs.Knowledge;
    return { has, unlocked, blood, knowledge, costs, affordable };
  }
  function tryResearchPurify() {
    const st = purifyStatus();
    if (st.has) return { ok: true, skipped: 'done' };
    if (!st.unlocked) return { ok: false, skipped: 'locked' };
    if (!st.affordable) return { ok: false, skipped: 'unaffordable', status: st };
    const via = clickAction('tech-purify', techDef('purify'));
    const after = purifyStatus();
    return { ok: after.has, via, before: st, after };
  }

  function tryBuildOne(key) {
    if (!SPIRE_FOUR_KEYS.includes(key) && key !== 'purifier') return { ok: false, error: 'bad-key' };
    if (!isBuildingUnlocked(key)) return { ok: false, error: 'locked', key };
    const costs = buildingCosts(key);
    if (!canAffordCosts(costs)) return { ok: false, error: 'unaffordable', key, costs };
    const inst = livePortalStruct(key);
    const before = inst ? inst.count : (g() && g().portal && g().portal[key] && g().portal[key].count) || 0;
    const via = clickAction('portal-' + key, spireActionDef(key));
    const inst2 = livePortalStruct(key);
    const after = inst2 ? inst2.count : before;
    return { ok: after > before, via, key, before, after, costs };
  }

  let lastSpireFourLogAt = 0;
  function spireFourTick(reason) {
    if (!CFG.autoSpireFour || !isEvolveReady()) return { skipped: 'off' };
    const glob = g();
    if (!glob || !glob.portal || !glob.portal.purifier) return { skipped: 'no-spire' };
    suppressVollchSpire(true);
    if (CFG.autoPurifyResearch) {
      const res = tryResearchPurify();
      if (res.ok && !res.skipped) log('已研究增强型空气过滤网（空气净化器支援 +25%）');
    }
    const plan = planFromLive();
    applySpirePower(plan);
    let built = null;
    const money = resourceAmount('Money');
    const supply = resourceAmount('Supply');
    const tryOrder = [];
    if (plan.next) tryOrder.push(plan.next);
    if (!tryOrder.includes('purifier')) tryOrder.push('purifier');
    for (const key of tryOrder) {
      if (!isBuildingUnlocked(key)) continue;
      const costs = buildingCosts(key);
      if (!canAffordCosts(costs)) continue;
      const r = tryBuildOne(key);
      if (r.ok) { built = r; break; }
    }
    if (built) {
      const plan2 = planFromLive();
      applySpirePower(plan2);
      log('四件套已建造' + (ZH_SPIRE_BLD[built.key] || built.key) + '（' + built.before + '→' + built.after + '）');
    } else {
      const now = Date.now();
      if (reason === 'manual' || now - lastSpireFourLogAt > 30000) {
        lastSpireFourLogAt = now;
        // 安静：只在手动或 30 秒节流时写一行规划
      }
    }
    try { refreshSpireFourStatus(); } catch (e) {}
    return { ok: true, plan, built, reason: reason || 'tick' };
  }

  let spireFourTimer = 0, spireFourPowerTimer = 0;
  function setAutoSpireFour(on) {
    CFG.autoSpireFour = !!on;
    const box = document.getElementById('smk-spire-four');
    if (box) box.checked = CFG.autoSpireFour;
    if (spireFourTimer) { clearInterval(spireFourTimer); spireFourTimer = 0; }
    if (spireFourPowerTimer) { clearInterval(spireFourPowerTimer); spireFourPowerTimer = 0; }
    if (CFG.autoSpireFour) {
      suppressVollchSpire(true);
      spireFourTick('enable');
      spireFourTimer = setInterval(() => spireFourTick('tick'), Math.max(1000, CFG.spireFourIntervalMs || 2000));
      spireFourPowerTimer = setInterval(() => {
        if (!CFG.autoSpireFour) return;
        try { applySpirePower(planFromLive()); } catch (e) {}
      }, Math.max(250, CFG.spireFourPowerMs || 500));
      log('尖塔四件套自动建造：开（机甲舱预留 ' + (ZH_SPIRE_BAY_MODE[CFG.spireMechbayMode] || CFG.spireMechbayMode) + '，无视主脚本上限并屏蔽其供电）');
    } else {
      suppressVollchSpire(false);
      log('尖塔四件套自动建造：关（已还原主脚本对四件套的开关）');
    }
    try { refreshStats(); refreshSpireFourStatus(); } catch (e) {}
  }

  function formatInt(n) {
    n = Math.floor(Number(n) || 0);
    return n.toLocaleString('zh-CN');
  }
  function refreshSpireFourStatus() {
    const el = document.getElementById('smk-spire-four-status');
    if (!el) return;
    if (!isEvolveReady()) { el.textContent = '等待游戏…'; return; }
    const snap = snapshotSpireFour();
    const plan = planSpireFour(snap);
    const puri = purifyStatus();
    const nextZh = ZH_SPIRE_BLD[plan.next] || plan.next || '—';
    const costs = plan.next ? buildingCosts(plan.next) : {};
    const costBits = Object.keys(costs).length
      ? '（' + Object.entries(costs).map(([k, v]) => (k === 'Money' ? '金钱' : k === 'Supply' ? '补给' : k) + ' ' + formatInt(v)).join('，') + (canAffordCosts(costs) ? '，可建' : '，资源不足') + '）'
      : '';
    let filter = '增强型空气过滤网：';
    if (puri.has) filter += '已完成';
    else if (!puri.unlocked) filter += '未解锁';
    else if (puri.affordable) filter += '可研究';
    else filter += '待资源（知识 ' + formatInt(puri.knowledge) + '/' + formatInt(puri.costs.Knowledge) + '，鲜血之石 ' + Math.floor(puri.blood) + '/' + puri.costs.Blood_Stone + '）';
    const vollch = CFG.autoSpireFour
      ? (document.querySelector('input.script_batportal-purifier') || document.querySelector('input.script_bld_s2_portal-port')
        ? '主脚本：已屏蔽四件套自动建造与智能供电'
        : '主脚本：未检测到开关，已用供电回写接管')
      : '主脚本：未接管';
    el.innerHTML =
      `空气净化器 ${snap.purifierOn}/${snap.purifierCount}　登陆点 ${snap.portOn}/${snap.portCount}　登陆营地 ${snap.campOn}/${snap.campCount}　机甲舱 ${snap.mechbayOn}/${snap.mechbayCount}` +
      `<br>支援 ${snap.supportMax}（机甲舱预留 ${plan.on.mechbay}，补给用 ${plan.on.port + plan.on.camp}）　补给上限 ${formatInt((livePurifier()||{}).sup_max)}（规划 ${formatInt(plan.targetSupMax)}）` +
      `<br>下一步：${nextZh}${costBits}` +
      `<br>${filter}　${vollch}`;
  }


  // ---------- UI ----------
  let panel, logEl, statsEl;

  function log(msg) {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (logEl) {
      logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
    }
    try { console.log('[尖塔机甲工具箱]', msg); } catch (e) {}
  }

  function bindPanelNodes() {
    const root = (panel && panel.isConnected) ? panel : document.getElementById('spire-mech-kit');
    if (!root) return;
    const s = root.querySelector('#smk-stats');
    const l = root.querySelector('#smk-log');
    if (s) statsEl = s;
    if (l) logEl = l;
  }
  let uiTimer = null;
  function startUiRefresh() {
    if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    uiTimer = setInterval(() => {
      try { refreshStats(); } catch (e) {}
      try { refreshSpireFourStatus(); } catch (e) {}
    }, 500);
  }

  function refreshStats() {
    bindPanelNodes();
    if (!statsEl || !isEvolveReady()) return;
    try {
    const mb = liveMechbay() || {};
    const pur = livePurifier();
    const soul = liveSoulGem();
    const sp = liveSpire() || {};
    const list = mechs();
    const size = (mb.blueprint && mb.blueprint.size) || 'titan';
    const best = bestMech(size === 'collector' ? 'titan' : size);
    let sum = 0, bad = 0, near = 0;
    const rows = [];
    for (const m of list) {
      if (m.size === 'collector') continue;
      const r = ratingOf(m, bestMech(m.size));
      sum += r;
      if (r < (CFG.nearOptimalRatio || 0.99)) bad++;
      else near++;
      rows.push(r);
    }
    const avg = rows.length ? (sum / rows.length * 100).toFixed(1) : '-';
    const wg = isWaygateFight();
    const qMech = listHellMechQueue().length;
    const qobj = liveQueue();
    const qLen = (qobj && qobj.queue || []).length;
    const infCols = list.filter(m => m.size === 'collector' && m.infernal).length;
    const allCols = list.filter(m => m.size === 'collector').length;
    statsEl.innerHTML =
      `第${sp.count ?? '?'}层 ${zhType(sp.type)||'?'}　首领 ${zhBoss(sp.boss)||'?'}　属性 ${zhStatusList(sp.status)}　进度 ${(sp.progress||0).toFixed(2)}%　剩余 ${sp.time||'?'}<br>` +
      `机库 ${mb.bay}/${mb.max}　台数 ${list.length}（相对最优≈${near} / 可拆劣机≈${bad}）均效 ${avg}%　建造队列 ${qLen}（机甲项 ${qMech}）` +
      (wg ? ` <b style="color:#f66">恶魔领主战斗中，自动换装已暂停</b>` : '') +
      `<br>推荐：${zhMechBrief(best)}` +
      `<br>灵魂宝石 ${Math.floor(soul ? soul.amount : 0)}　补给 ${Math.floor(pur ? pur.supply : 0)}/${Math.floor(pur ? pur.sup_max : 0)}` +
      `<br>通关换装：${CFG.autoRegear ? '开' : '关'}　效率 ${CFG.regearEffThreshold}　${zhSize(CFG.regearSize)}/${zhFillMode(CFG.regearFillMode)}` +
      (CFG.regearFillMode === 'count' ? `×${CFG.regearCount}` : '') +
      `　相对最优不拆：${CFG.protectNearOptimal ? '开≥'+CFG.nearOptimalRatio : '关'}` +
      `　持续补队：${(CFG.autoRegear && CFG.autoTopUp) ? '开' : '关'}${topUpFollowing ? '（跟进中）' : ''}` +
      `　搜集铺满：${CFG.autoCollectorFill ? '开' : '关'}　缓冲：${CFG.collectorBuffer ? '开' : '关'}` +
      `　灵魂宝石预留：${CFG.soulGemTitanReserve > 0 ? ('×'+CFG.soulGemTitanReserve+'台泰坦(≥'+soulGemReserveFloor()+')') : '关'}` +
      `　地狱化搜集：${zhInfMode(CFG.infernalCollectorMode)}${infernalUnlocked() ? '' : '（未解锁）'} 现有 ${infCols}/${allCols} 可拆：${CFG.scrapInfernalCollectors ? '是' : '否'}` +
      `　补给近满：${CFG.supplyNearFullRatio > 0 ? ('≥'+(CFG.supplyNearFullRatio*100)+'% 现'+(supplyRatio()*100).toFixed(0)+'%'+(isSupplyNearFull()?'→改泰坦':'')) : '关'}`;
    } catch (e) {
      try { console.warn('[尖塔机甲工具箱] 刷新状态失败', e); } catch (e2) {}
    }
  }

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function select(id, options, value) {
    const s = el('select', { id });
    for (const [val, label] of options) {
      const o = el('option', { value: val }, label);
      if (String(val) === String(value)) o.selected = true;
      s.appendChild(o);
    }
    return s;
  }

  function readFilters() {
    return {
      allNonInfernal: document.getElementById('smk-all')?.checked,
      size: document.getElementById('smk-size')?.value || '',
      chassis: document.getElementById('smk-chassis')?.value || '',
      weapon: document.getElementById('smk-weapon')?.value || '',
      effBelow: document.getElementById('smk-eff')?.value
    };
  }

  function syncRegearCfgFromUi() {
    const thr = document.getElementById('smk-regear-eff');
    const size = document.getElementById('smk-regear-size');
    const mode = document.getElementById('smk-regear-mode');
    const count = document.getElementById('smk-regear-count');
    const top = document.getElementById('smk-topup');
    const col = document.getElementById('smk-collector-fill');
    const buf = document.getElementById('smk-collector-buf');
    const reserve = document.getElementById('smk-soul-reserve');
    if (thr) CFG.regearEffThreshold = Number(thr.value) || 0.7;
    if (size) CFG.regearSize = size.value || 'titan';
    if (mode) CFG.regearFillMode = mode.value || 'bay';
    if (count) CFG.regearCount = Math.max(0, parseInt(count.value, 10) || 0);
    if (top) CFG.autoTopUp = !!top.checked;
    if (col) CFG.autoCollectorFill = !!col.checked;
    if (buf) CFG.collectorBuffer = !!buf.checked;
    if (reserve) CFG.soulGemTitanReserve = Math.max(0, parseInt(reserve.value, 10) || 0);
    const near = document.getElementById('smk-supply-near');
    if (near) {
      let v = Number(near.value);
      if (!isFinite(v) || v < 0) v = 0;
      if (v > 1) v = 1;
      CFG.supplyNearFullRatio = v;
    }
    const bayMode = document.getElementById('smk-spire-bay-mode');
    const bayRes = document.getElementById('smk-spire-bay-reserve');
    if (bayMode) CFG.spireMechbayMode = bayMode.value || 'auto';
    if (bayRes) {
      const n = parseInt(bayRes.value, 10);
      CFG.spireMechbayReserve = Number.isFinite(n) ? n : -1;
    }
  }


  // ---------- v1.5.3 外观 + 说明框（嵌入机甲实验室顶部）（与中文版主脚本同款主题/行为） ----------
  const SMK_CSS = `html { --smk-bg:#1f2526; --smk-card:#262e2f; --smk-card2:#2d3637; --smk-head:#1a2021; --smk-border:#3b4647; --smk-text:#e6ecec;
       --smk-muted:#9aa7a8; --smk-accent:#48c78e; --smk-accent2:#ffdd57; --smk-hover:rgba(255,255,255,.05); --smk-input:#141a1b;
       --smk-off:#5a6566; --smk-shadow:0 2px 10px rgba(0,0,0,.35); }
html.light { --smk-bg:#f4f6f8; --smk-card:#ffffff; --smk-card2:#f7f9fa; --smk-head:#eef2f4; --smk-border:#d5dde2; --smk-text:#1f2a30;
       --smk-muted:#62717a; --smk-accent:#1f9d6a; --smk-accent2:#8a6d00; --smk-hover:rgba(0,0,0,.04); --smk-input:#ffffff; --smk-off:#b8c2c8;
       --smk-shadow:0 2px 8px rgba(0,0,0,.08); }
html.night, html.redgreen { --smk-card:#1e1e1e; --smk-card2:#252525; --smk-head:#151515; --smk-border:#363636; --smk-input:#0e0e0e; }
html.darkNight { --smk-card:#1e1e1e; --smk-card2:#242424; --smk-head:#141414; --smk-border:#333; --smk-text:#c4c4c4; --smk-input:#0e0e0e; --smk-accent2:#ffcc00; }
html.gruvboxLight { --smk-bg:#fbf1c7; --smk-card:#f9f5d7; --smk-card2:#f2e5bc; --smk-head:#ebdbb2; --smk-border:#d5c4a1; --smk-text:#3c3836; --smk-muted:#7c6f64;
       --smk-accent:#79740e; --smk-accent2:#b57614; --smk-hover:rgba(60,56,54,.06); --smk-input:#fbf1c7; --smk-off:#bdae93; --smk-shadow:0 2px 8px rgba(60,56,54,.12); }
html.gruvboxDark { --smk-card:#282828; --smk-card2:#32302f; --smk-head:#1d2021; --smk-border:#504945; --smk-text:#ebdbb2; --smk-muted:#a89984;
       --smk-accent:#b8bb26; --smk-accent2:#fabd2f; --smk-input:#1d2021; --smk-off:#665c54; }
html.orangeSoda { --smk-card:#1c1f20; --smk-card2:#242829; --smk-head:#131516; --smk-border:#313638; --smk-text:#ebdbb2; --smk-accent:#f06543; --smk-accent2:#f06543; --smk-input:#0f1112; }
html.dracula { --smk-card:#282a36; --smk-card2:#303241; --smk-head:#21222c; --smk-border:#44475a; --smk-text:#f8f8f2; --smk-muted:#a4a7c0;
       --smk-accent:#50fa7b; --smk-accent2:#f1fa8c; --smk-input:#1e1f29; --smk-off:#6272a4; }
#spire-mech-kit { position: static; display: block; box-sizing: border-box; width: auto; max-width: none; margin: 0 0 .5rem; padding: 0 0 10px; color: var(--smk-text);
  background: var(--smk-card); border: 1px solid var(--smk-border); border-radius: 12px; box-shadow: var(--smk-shadow);
  font: 13px/1.55 "Lato", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
#spire-mech-kit .smk-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 10px 14px; margin: 0 0 8px;
  background: var(--smk-head); border-bottom: 1px solid var(--smk-border); border-radius: 12px 12px 0 0; font-weight: 700; font-size: 15px; color: var(--smk-accent); }
#spire-mech-kit .smk-title .smk-sub { font-weight: normal; font-size: 12px; color: var(--smk-muted); }
#spire-mech-kit .smk-title { cursor: pointer; user-select: none; }
#spire-mech-kit .smk-caret { display: inline-block; width: 1em; transition: transform .15s; color: var(--smk-muted); }
#spire-mech-kit.smk-collapsed { padding-bottom: 0; }
#spire-mech-kit.smk-collapsed > :not(.smk-title) { display: none !important; }
#spire-mech-kit.smk-collapsed > .smk-title { margin: 0; border-bottom: 0; border-radius: 12px; }
#spire-mech-kit.smk-collapsed .smk-caret { transform: rotate(-90deg); }
/* 嵌入后机甲列表不再 sticky（否则滚动时会盖住面板）；改为普通流内的可滚动列表 */
#spire-mech-kit ~ #mechList { position: relative !important; top: auto !important; height: auto !important; max-height: calc(100vh - 6rem); }
#spire-mech-kit .smk-stats { margin: 0 12px 8px; padding: 8px 12px; background: var(--smk-card2); border: 1px solid var(--smk-border); border-radius: 10px; line-height: 1.6; }
#spire-mech-kit .smk-card { margin: 8px 12px; padding: 8px 12px 10px; background: var(--smk-card2); border: 1px solid var(--smk-border); border-radius: 10px; }
#spire-mech-kit .smk-card > b:first-child, #spire-mech-kit .smk-card > div:first-child > b:first-child {
  display: inline-block; font-size: 14px; color: var(--smk-text); padding: 1px 0 1px 9px; border-left: 3px solid var(--smk-accent); margin: 2px 6px 6px 0; }
#spire-mech-kit .smk-card > div:first-child { margin-bottom: 4px; color: var(--smk-muted); }
#spire-mech-kit .smk-help { display: none; }
#spire-mech-kit input[type=number], #spire-mech-kit input[type=text], #spire-mech-kit select {
  height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--smk-border); background: var(--smk-input); color: var(--smk-text); font-size: 13px; vertical-align: middle; }
#spire-mech-kit select { padding-right: 4px; }
#spire-mech-kit input:focus, #spire-mech-kit select:focus { outline: none; border-color: var(--smk-accent); box-shadow: 0 0 0 2px rgba(72,199,142,.25); }
/* 复选框 → 胶囊开关；整个 label 可点 */
#spire-mech-kit label { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 4px; border-radius: 8px; cursor: pointer; user-select: none; }
#spire-mech-kit label:hover { background: var(--smk-hover); }
#spire-mech-kit input[type=checkbox] { -webkit-appearance: none; appearance: none; position: relative; width: 2.5em; height: 1.4em; margin: 0; flex-shrink: 0;
  border-radius: 1em; background: var(--smk-off); cursor: pointer; transition: background .15s, box-shadow .15s; font-size: 14px; }
#spire-mech-kit input[type=checkbox]::before { content: ""; position: absolute; top: .16em; left: .16em; width: 1.08em; height: 1.08em; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform .15s; }
#spire-mech-kit input[type=checkbox]:checked { background: var(--smk-accent); }
#spire-mech-kit input[type=checkbox]:checked::before { transform: translateX(1.1em); }
#spire-mech-kit label:hover input[type=checkbox] { box-shadow: 0 0 0 3px rgba(72,199,142,.22); }
#spire-mech-kit button.smk-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--smk-border); background: var(--smk-input);
  color: var(--smk-text); font-size: 13px; cursor: pointer; transition: filter .15s, border-color .15s; }
#spire-mech-kit button.smk-btn:hover { border-color: var(--smk-accent); filter: brightness(1.08); }
#spire-mech-kit button.smk-primary { background: var(--smk-accent); border-color: var(--smk-accent); color: #fff; }
#spire-mech-kit button.smk-danger { background: #d9534f; border-color: #d9534f; color: #fff; }
#spire-mech-kit button.smk-warn { background: #c98a1b; border-color: #c98a1b; color: #fff; }
#spire-mech-kit .smk-log { margin: 8px 12px 0; max-height: 160px; overflow: auto; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--smk-border);
  background: var(--smk-input); color: var(--smk-text); font: 11.5px/1.5 ui-monospace, Menlo, Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; }
#spire-mech-kit code { font-size: 11px; background: var(--smk-input); padding: 1px 5px; border-radius: 4px; color: var(--smk-muted); }
#spire-mech-kit .smk-info { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-left: 6px; border-radius: 50%;
  font-size: 12px; font-weight: 700; color: var(--smk-muted); border: 1px solid var(--smk-border); cursor: help; user-select: none; vertical-align: middle; }
#spire-mech-kit .smk-info:hover { color: var(--smk-accent); border-color: var(--smk-accent); }
/* 说明框：悬停=半透明；点「?」固定=不透明（与主脚本 zh.1 固定说明一致） */
#smk-tip { position: fixed; z-index: 100000; display: none; max-width: 460px; padding: 10px 12px; border-radius: 10px; pointer-events: auto;
  background: var(--smk-card); background: color-mix(in srgb, var(--smk-card) 87%, transparent); -webkit-backdrop-filter: blur(6px) saturate(1.1); backdrop-filter: blur(6px) saturate(1.1);
  color: var(--smk-text); border: 1px solid var(--smk-border); box-shadow: 0 8px 24px rgba(0,0,0,.35); text-shadow: 0 0 1px var(--smk-card);
  font: 13px/1.6 "Lato", "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left; white-space: pre-line; }
#smk-tip.pinned { border-color: var(--smk-accent); background: var(--smk-card); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: 0 8px 24px rgba(0,0,0,.45); text-shadow: none; }
#smk-tip .smk-tip-h { font-weight: 700; color: var(--smk-accent); margin-bottom: 4px; }
#smk-tip .smk-tip-f { margin-top: 6px; font-size: 11px; color: var(--smk-muted); }
`;
  function injectStyle() {
    if (document.getElementById('smk-style')) return;
    const st = document.createElement('style');
    st.id = 'smk-style';
    st.textContent = SMK_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  function stylePanel() {
    const kinds = { '#833': 'smk-danger', '#553': 'smk-warn' };
    panel.querySelectorAll('button').forEach((b) => {
      const bg = (b.getAttribute('style') || '').match(/background:\s*(#[0-9a-f]{3,6})/i);
      b.removeAttribute('style');
      b.classList.add('smk-btn');
      if (bg) b.classList.add(kinds[bg[1].toLowerCase()] || 'smk-primary');
    });
    [...panel.children].forEach((c) => {
      if (c.classList.contains('smk-title') || c.id === 'smk-stats' || c.id === 'smk-log') return;
      c.removeAttribute('style');
      c.classList.add('smk-card');
    });
    panel.querySelectorAll('div').forEach((d) => {
      if (/opacity/.test(d.getAttribute('style') || '') && d.textContent.length > 200) d.classList.add('smk-help');
    });
  }
  const SMK_TIPS = {
    'smk-near': '已达本层相对最优的机甲不拆',
    'smk-auto': '定时解体效率低于阈值的机甲；打恶魔领主时暂停',
    'smk-regear': '通关后按本层最优配置解体劣机并补装；打恶魔领主时暂停',
    'smk-topup': '队列造完后若还有空舱位，继续入队（队列上限 20）',
    'smk-collector-fill': '开：只补最优搜集机；关：改补泰坦',
    'smk-collector-buf': '补给不够先造搜集机；舱位不够时每次只拆出 1 台泰坦的空位',
    'smk-inf-col': '自动+升级：机库铺满后，用超过上限 50% 的余量补给把普通搜集机换成地狱化',
    'smk-inf-scrap': '给泰坦腾空位时可拆地狱化搜集机（普通先拆）',
    'smk-eff': '只匹配效率低于此值的机甲；空=不限',
    'smk-preview': '只预览，不会解体',
    'smk-scrap': '解体所有匹配项（游戏无撤销）',
    'smk-clearq': '只清除建造队列里的机甲项',
    'smk-fill': '按当前空舱位计算可造数量',
    'smk-build': '设置蓝图后，资源够就直接建造，否则入队',
    'smk-regear-now': '立即执行一次通关换装',
    'smk-topup-now': '立即补满机甲队列',
    'smk-soul-reserve': '造搜集机后须剩够 N 台泰坦的灵魂宝石；0 为关闭',
    'smk-supply-near': '补给达到此比例时停造搜集机，改补泰坦；0 为关闭',
    'smk-regear-count': '仅在「固定数量」模式下使用',
    'smk-spire-four': '独立建造四件套并接管供电；无视主脚本建筑上限，同时屏蔽其对这四座的 Power 控制',
    'smk-spire-bay-mode': '自动：按当前机库占用保留舱位（含搜集机），其余支援最大化补给上限；仓储优先：在战斗机甲与当前占用之间取中；爬塔优先：多留机甲舱',
    'smk-spire-bay-reserve': '预留多少支援给机甲舱；-1 表示按左侧模式自动计算',
    'smk-spire-four-now': '立即按当前规划建造一座并回写供电'
  };
  const SMK_HELP = {
    0: '按尺寸、底盘、武器、效率筛选后解体。地狱化战斗机甲不会被拆。',
    1: '按当前蓝图或本层最优配置建造；资源不够时进入建造队列。',
    2: '定时解体效率低于阈值的机甲；打恶魔领主时暂停。',
    3: '通关后按本层最优换装并补队；打恶魔领主时暂停。',
    4: '尽可能多造空气净化器；通关并获得鲜血之石后研究增强型空气过滤网；按最佳比例平衡登陆点与登陆营地以最大化补给上限；机甲舱按爬塔需要预留。开启后无视主脚本建筑上限，并屏蔽主脚本对这四座的 Power 控制。'
  };
  function addTipsAndHelp() {
    Object.entries(SMK_TIPS).forEach(([id, t]) => {
      const e = panel.querySelector('#' + id);
      if (!e) return;
      const tgt = e.closest('label') || e;
      if (!tgt.getAttribute('title')) tgt.setAttribute('title', t);
    });
    const cards = [...panel.querySelectorAll('.smk-card')];
    cards.forEach((c, i) => {
      const help = c.querySelector('.smk-help');
      const text = help ? help.textContent.trim() : SMK_HELP[i];
      if (!text) return;
      const head = c.querySelector(':scope > b:first-child, :scope > div:first-child > b:first-child');
      if (!head) return;
      const q = document.createElement('span');
      q.className = 'smk-info'; q.textContent = '?'; q.dataset.smkHelp = text; q.setAttribute('aria-label', '说明');
      head.insertAdjacentElement('afterend', q);
    });
  }
  // 悬停：0.5 秒出现、半透明、移到别的条目立即关闭、离开 150ms 关闭、滚动 / Esc 关闭
  // 点「?」固定：不透明、悬停别处不影响，点空白处关闭
  function installKitTips() {
    if (window.__smkTipsInstalled) return;
    window.__smkTipsInstalled = true;
    const SHOW_DELAY = 500, HIDE_GRACE = 150;
    let tip = null, showTimer = 0, hideTimer = 0, pinned = false, curEl = null, pendingEl = null;
    const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    function tipEl() {
      if (!tip) {
        tip = document.createElement('div'); tip.id = 'smk-tip';
        tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        tip.addEventListener('mouseleave', () => { if (!pinned) scheduleHide(); });
        document.body.appendChild(tip);
      }
      return tip;
    }
    function takeTitle(e) {
      const v = e.getAttribute('title');
      if (v != null) { e.removeAttribute('title'); if (v) e.dataset.smkTip = v; }
      return e.dataset.smkTip || '';
    }
    function findTip(t) {
      if (!t || !t.closest || !t.closest('#spire-mech-kit')) return null;
      return t.closest('[title],[data-smk-tip]');
    }
    function isOpen() { return !!(tip && tip.style.display === 'block'); }
    function hideNow() { clearTimeout(hideTimer); clearTimeout(showTimer); pendingEl = null; pinned = false; curEl = null; if (tip) tip.style.display = 'none'; }
    function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!pinned) hideNow(); }, HIDE_GRACE); }
    function show(e, text, title, pin) {
      if (!text) return;
      const d = tipEl();
      d.innerHTML = (title ? `<div class="smk-tip-h">${esc(title)}</div>` : '') + `<div>${esc(text)}</div>`
        + (pin ? '<div class="smk-tip-f">已固定 · 点空白处关闭</div>' : '');
      d.classList.toggle('pinned', !!pin);
      d.style.display = 'block';
      const r = e.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      d.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
      d.style.top = top + 'px';
      curEl = e;
    }
    document.addEventListener('mouseover', (e) => {
      if (pinned) return;
      if (tip && tip.contains(e.target)) { clearTimeout(hideTimer); return; }
      const t = findTip(e.target);
      if (!t) { clearTimeout(showTimer); pendingEl = null; if (isOpen()) scheduleHide(); return; }
      const text = takeTitle(t);
      if (t === curEl && isOpen()) { clearTimeout(hideTimer); return; }
      if (t === pendingEl) return;
      if (isOpen()) hideNow();
      clearTimeout(showTimer);
      pendingEl = t;
      showTimer = setTimeout(() => { pendingEl = null; if (!pinned) show(t, text, '', false); }, SHOW_DELAY);
    }, true);
    document.addEventListener('mouseout', (e) => {
      if (pinned) return;
      const to = e.relatedTarget;
      if (to && tip && tip.contains(to)) return;
      const toEl = to ? findTip(to) : null;
      if (toEl && (toEl === curEl || toEl === pendingEl)) return;
      if (pendingEl && toEl !== pendingEl) { clearTimeout(showTimer); pendingEl = null; }
      if (isOpen()) scheduleHide();
    }, true);
    // 滚动关闭：只在条目真的移动时关（避免游戏布局抖动误关）；滚轮 / 触摸滑动立即关
    let anchorTop = null;
    const anchorOf = () => curEl || pendingEl;
    const topOf = (x) => (x && x.isConnected ? x.getBoundingClientRect().top : null);
    document.addEventListener('mouseover', () => { anchorTop = topOf(anchorOf()); }, false);
    document.addEventListener('scroll', (e) => {
      if (pinned || (!isOpen() && !pendingEl)) return;
      const t = e.target;
      if (tip && t && t.nodeType === 1 && tip.contains(t)) return;
      const now = topOf(anchorOf());
      if (now === null || anchorTop === null || Math.abs(now - anchorTop) > 4) hideNow();
    }, true);
    const userScroll = (e) => { if (!pinned && (isOpen() || pendingEl) && !(tip && tip.contains(e.target))) hideNow(); };
    document.addEventListener('wheel', userScroll, { capture: true, passive: true });
    document.addEventListener('touchmove', userScroll, { capture: true, passive: true });
    document.addEventListener('keydown', (e) => { if (!pinned && e.key === 'Escape' && (isOpen() || pendingEl)) hideNow(); }, true);
    document.addEventListener('click', (e) => {
      const q = e.target.closest && e.target.closest('#spire-mech-kit .smk-info');
      if (q) {
        e.preventDefault(); e.stopPropagation();
        hideNow(); pinned = true;
        const head = q.previousElementSibling;
        show(q, q.dataset.smkHelp, head ? head.textContent.trim() : '', true);
        return;
      }
      if (pinned && tip && !tip.contains(e.target)) hideNow();
    }, true);
    let lp = 0;
    document.addEventListener('touchstart', (e) => {
      const t = findTip(e.target);
      if (!t) return;
      lp = setTimeout(() => { const text = takeTitle(t); hideNow(); pinned = true; show(t, text, '', true); }, 450);
    }, { passive: true, capture: true });
    document.addEventListener('touchend', () => clearTimeout(lp), true);
  }

  function mount() {
    if (panel) { placePanel(); startUiRefresh(); return; }
    const existing = document.getElementById('spire-mech-kit');
    if (existing) {
      panel = existing;
      bindPanelNodes();
      placePanel();
      startUiRefresh();
      if (CFG.autoRegear && !regearTimer) setAutoRegear(true);
      if (CFG.autoSpireFour && !spireFourTimer) setAutoSpireFour(true);
      return;
    }
    injectStyle();
    panel = el('div', { id: 'spire-mech-kit' });
    panel.innerHTML = `<div class="smk-title" role="button" aria-expanded="true"><span class="smk-caret">▾</span>尖塔机甲工具箱 v1.5.3</div>`;
    statsEl = el('div', { id: 'smk-stats', class: 'smk-stats' });
    panel.appendChild(statsEl);

    const scrapBox = el('div', { style: { marginBottom: '8px' } });
    scrapBox.appendChild(el('div', null, '<b>批量解体</b>'));
    const row1 = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } });
    row1.appendChild(el('label', null, '<input type="checkbox" id="smk-all"> 全部非地狱化'));
    row1.appendChild(document.createTextNode('尺寸'));
    row1.appendChild(select('smk-size', [['', '（不限）'], ...SIZE.map(s => [s, zhSize(s)])], ''));
    row1.appendChild(document.createTextNode('底盘'));
    row1.appendChild(select('smk-chassis', [['', '（不限）'], ...CHASSIS.map(s => [s, zhChassis(s)])], ''));
    row1.appendChild(document.createTextNode('含武器'));
    row1.appendChild(select('smk-weapon', [['', '（不限）'], ...WEAPON.map(s => [s, zhWeapon(s)])], ''));
    row1.appendChild(document.createTextNode('效率<'));
    const eff = el('input', { id: 'smk-eff', type: 'number', step: '0.05', min: '0', max: '1', value: '', placeholder: '如 0.7，空=不限', style: { width: '88px' } });
    row1.appendChild(eff);
    scrapBox.appendChild(row1);
    const row1b = el('div', { style: { marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    row1b.appendChild(el('button', { type: 'button', id: 'smk-preview' }, '预览匹配'));
    row1b.appendChild(el('button', { type: 'button', id: 'smk-scrap', style: { background: '#833', color: '#fff' } }, '确认解体匹配项'));
    row1b.appendChild(el('button', { type: 'button', id: 'smk-clearq', style: { background: '#553', color: '#fff' } }, '清空机甲队列'));
    scrapBox.appendChild(row1b);
    panel.appendChild(scrapBox);

    const buildBox = el('div', { style: { marginBottom: '8px' } });
    buildBox.appendChild(el('div', null, '<b>拼装 / 入队</b>'));
    const row2 = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } });
    row2.appendChild(document.createTextNode('模式'));
    row2.appendChild(select('smk-mode', [['blueprint', '当前蓝图'], ['best', '当前楼层最优']], 'best'));
    row2.appendChild(document.createTextNode('尺寸'));
    row2.appendChild(select('smk-bsize', SIZE.map(s => [s, zhSize(s)]), 'titan'));
    row2.appendChild(document.createTextNode('数量'));
    row2.appendChild(el('input', { id: 'smk-count', type: 'number', min: '1', value: '1', style: { width: '56px' } }));
    row2.appendChild(el('button', { type: 'button', id: 'smk-fill' }, '填满机库'));
    row2.appendChild(el('button', { type: 'button', id: 'smk-build', style: { background: '#356', color: '#fff' } }, '设置蓝图并建造/入队'));
    buildBox.appendChild(row2);
    panel.appendChild(buildBox);

    const autoBox = el('div', { style: { marginBottom: '8px' } });
    autoBox.appendChild(el('div', null, '<b>自动解体</b>'));
    const rowAuto = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '4px' } });
    rowAuto.appendChild(el('label', null, `<input type="checkbox" id="smk-auto"${CFG.autoScrap ? ' checked' : ''}> 启用`));
    rowAuto.appendChild(document.createTextNode('效率低于'));
    rowAuto.appendChild(el('input', { id: 'smk-auto-eff', type: 'number', step: '0.05', min: '0', max: '1', value: String(CFG.autoScrapThreshold), style: { width: '64px' } }));
    rowAuto.appendChild(el('label', { title: '已达本层相对最优的机甲不拆' }, `<input type="checkbox" id="smk-near"${CFG.protectNearOptimal ? ' checked' : ''}> 相对最优不拆`));
    rowAuto.appendChild(document.createTextNode('≥'));
    rowAuto.appendChild(el('input', { id: 'smk-near-ratio', type: 'number', step: '0.01', min: '0', max: '1', value: String(CFG.nearOptimalRatio), style: { width: '56px' } }));
    autoBox.appendChild(rowAuto);
    panel.appendChild(autoBox);

    const regearBox = el('div', { style: { marginBottom: '8px', padding: '6px', border: '1px dashed #486', borderRadius: '4px' } });
    regearBox.appendChild(el('div', null, '<b>通关后自动换装</b>'));
    const row3 = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '4px' } });
    row3.appendChild(el('label', null, `<input type="checkbox" id="smk-regear" ${CFG.autoRegear ? 'checked' : ''}> 启用`));
    row3.appendChild(document.createTextNode('效率<'));
    row3.appendChild(el('input', { id: 'smk-regear-eff', type: 'number', step: '0.05', min: '0', max: '1', value: String(CFG.regearEffThreshold), style: { width: '64px' } }));
    row3.appendChild(document.createTextNode('尺寸'));
    row3.appendChild(select('smk-regear-size', SIZE.map(s => [s, zhSize(s)]), CFG.regearSize));
    row3.appendChild(document.createTextNode('补齐'));
    row3.appendChild(select('smk-regear-mode', [['bay', '填满机库'], ['count', '固定数量']], CFG.regearFillMode));
    row3.appendChild(el('input', { id: 'smk-regear-count', type: 'number', min: '0', value: String(CFG.regearCount), style: { width: '56px' }, title: '仅在「固定数量」模式下使用' }));
    row3.appendChild(el('label', null, `<input type="checkbox" id="smk-topup" ${CFG.autoTopUp ? 'checked' : ''}> 持续补队`));
    row3.appendChild(el('label', null, `<input type="checkbox" id="smk-collector-fill" ${CFG.autoCollectorFill ? 'checked' : ''}> 搜集机铺满`));
    row3.appendChild(el('label', null, `<input type="checkbox" id="smk-collector-buf" ${CFG.collectorBuffer ? 'checked' : ''}> 搜集缓冲`));
    row3.appendChild(document.createTextNode('预留泰坦×'));
    row3.appendChild(el('input', { id: 'smk-soul-reserve', type: 'number', min: '0', step: '1', value: String(CFG.soulGemTitanReserve), style: { width: '48px' }, title: '造搜集机后须剩够 N 台泰坦的灵魂宝石；0 为关闭' }));
    row3.appendChild(document.createTextNode('补给近满≥'));
    row3.appendChild(el('input', { id: 'smk-supply-near', type: 'number', min: '0', max: '1', step: '0.05', value: String(CFG.supplyNearFullRatio), style: { width: '56px' }, title: '补给达到此比例时停造搜集机，改补泰坦；0 为关闭' }));
    row3.appendChild(document.createTextNode('地狱化搜集'));
    row3.appendChild(select('smk-inf-col', [['upgrade', '自动+铺满后升级'], ['auto', '自动(只铺空位)'], ['always', '总是'], ['never', '不用']], CFG.infernalCollectorMode));
    row3.appendChild(el('label', { title: '腾泰坦空位时可拆地狱化搜集机（按产量升序，普通先拆）' }, `<input type="checkbox" id="smk-inf-scrap" ${CFG.scrapInfernalCollectors ? 'checked' : ''}> 可拆地狱化搜集`));
    row3.appendChild(el('button', { type: 'button', id: 'smk-regear-now', style: { background: '#264', color: '#fff' } }, '立即跑流水线'));
    row3.appendChild(el('button', { type: 'button', id: 'smk-topup-now', style: { background: '#246', color: '#fff' } }, '立即补队'));
    regearBox.appendChild(row3);
    panel.appendChild(regearBox);

    const spireBox = el('div', { style: { marginBottom: '8px' } });
    spireBox.appendChild(el('div', null, '<b>尖塔四件套</b>'));
    const row4 = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '4px' } });
    row4.appendChild(el('label', { title: '独立建造空气净化器、登陆点、登陆营地、机甲舱，并接管供电；无视主脚本建筑上限，同时屏蔽主脚本对这四座的 Power 控制' },
      `<input type="checkbox" id="smk-spire-four" ${CFG.autoSpireFour ? 'checked' : ''}> 自动建造与供电`));
    row4.appendChild(document.createTextNode('机甲舱预留'));
    row4.appendChild(select('smk-spire-bay-mode', [['auto', '自动'], ['storage', '仓储优先'], ['climb', '爬塔优先']], CFG.spireMechbayMode));
    row4.appendChild(document.createTextNode('固定预留'));
    row4.appendChild(el('input', { id: 'smk-spire-bay-reserve', type: 'number', min: '-1', step: '1', value: String(CFG.spireMechbayReserve), style: { width: '56px' }, title: '预留多少支援给机甲舱；-1 表示按左侧模式自动计算' }));
    row4.appendChild(el('button', { type: 'button', id: 'smk-spire-four-now', style: { background: '#264', color: '#fff' } }, '立即执行'));
    spireBox.appendChild(row4);
    spireBox.appendChild(el('div', { id: 'smk-spire-four-status', style: { marginTop: '6px', lineHeight: '1.6' } }, ''));
    panel.appendChild(spireBox);

    logEl = el('pre', {
      id: 'smk-log',
      class: 'smk-log'
    }, '');
    panel.appendChild(logEl);

    stylePanel();
    addTipsAndHelp();
    installKitTips();
    placePanel();
    installCollapse();

    document.getElementById('smk-preview').onclick = () => {
      const f = readFilters();
      const hit = previewScrap(f);
      log(`预览匹配 ${hit.length} 台：` + hit.slice(0, 12).map(m => {
        const best = bestMech(m.size === 'collector' ? 'titan' : m.size);
        const r = m.size === 'collector' ? '-' : (ratingOf(m, best) * 100).toFixed(0) + '%';
        return `#${m.id + 1} ${zhSize(m.size)}/${zhChassis(m.chassis)}/${zhWeapon((m.hardpoint || [])[0]) || '-'}(${r})`;
      }).join('；') + (hit.length > 12 ? '…' : ''));
      refreshStats();
    };

    document.getElementById('smk-scrap').onclick = () => {
      const f = readFilters();
      const hit = previewScrap(f);
      if (!hit.length) { log('没有匹配的机甲'); return; }
      if (CFG.confirmBulk) {
        const ok = window.confirm(`将解体 ${hit.length} 台机甲（地狱化战斗机甲已排除${CFG.scrapInfernalCollectors ? '；地狱化搜集机可能在内' : ''}）。\n游戏无撤销，只能靠返还的宝石/补给重建。\n继续？`);
        if (!ok) { log('已取消解体'); return; }
      }
      const r = doScrapIds(hit.map(m => m.id));
      if (!r.ok) { log(zhErr(r.error)); return; }
      log(`已解体 ${r.n} 台：灵魂宝石 +${r.gemsDelta}（估+${r.gemsExpected}），补给 +${Math.floor(r.supplyDelta)}（估+${r.supplyExpected}），腾出 ${r.bayDelta} 格（现 ${r.bay}/${r.bayMax}）`);
      refreshStats();
    };

    document.getElementById('smk-clearq').onclick = () => {
      const r = clearMechQueue();
      if (!r.ok) { log(zhErr(r.error)); return; }
      log(`已清空机甲队列 ${r.removed} 项（${zhVia(r.via)}），总队列 ${r.queueBefore}→${r.queueAfter}`);
      refreshStats();
    };

    document.getElementById('smk-fill').onclick = () => {
      const mode = document.getElementById('smk-mode').value;
      const size = mode === 'blueprint' ? ((liveBlueprint()||{}).size) : document.getElementById('smk-bsize').value;
      const n = fillBayCount(size);
      document.getElementById('smk-count').value = String(Math.max(1, n));
      log(`按尺寸 ${zhSize(size)} 估算可再建 ${n} 台（机库空位 ${(liveMechbay().max - liveMechbay().bay)}）`);
    };

    document.getElementById('smk-build').onclick = () => {
      const mode = document.getElementById('smk-mode').value;
      const size = document.getElementById('smk-bsize').value;
      let count = Math.max(1, parseInt(document.getElementById('smk-count').value, 10) || 1);
      let mech;
      if (mode === 'blueprint') {
        mech = JSON.parse(JSON.stringify(liveBlueprint()));
      } else {
        mech = bestMech(size);
      }
      const set = setBlueprint(mech);
      if (!set.ok) { log(zhErr(set.error)); return; }
      log(`蓝图已设为 ${zhMechBrief(mech)}，开始建造×${count}`);
      const r = buildOrQueue(count);
      if (!r.ok) { log(zhErr(r.error)); return; }
      const built = r.results.filter(x => x.built).length;
      const queued = r.results.filter(x => x.queued).length;
      log(`完成：即时建成 ${built}，入队 ${queued}；队列长 ${r.queueLen}；机库 ${r.bay}/${r.bayMax}；灵魂宝石 ${Math.floor(r.soul)}；补给 ${Math.floor(r.supply)}`);
      refreshStats();
    };

    document.getElementById('smk-auto').onchange = (e) => {
      CFG.autoScrapThreshold = Number(document.getElementById('smk-auto-eff').value) || 0.5;
      setAuto(e.target.checked);
    };
    document.getElementById('smk-auto-eff').onchange = (e) => {
      CFG.autoScrapThreshold = Number(e.target.value) || 0.5;
    };
    document.getElementById('smk-near').onchange = (e) => {
      CFG.protectNearOptimal = !!e.target.checked;
      log(`相对最优不拆：${CFG.protectNearOptimal ? '开' : '关'}（阈值 ${CFG.nearOptimalRatio}）`);
      refreshStats();
    };
    document.getElementById('smk-near-ratio').onchange = (e) => {
      CFG.nearOptimalRatio = Math.min(1, Math.max(0, Number(e.target.value) || 0.99));
      log(`相对最优阈值 ≥ ${CFG.nearOptimalRatio}`);
      refreshStats();
    };

    document.getElementById('smk-regear').onchange = (e) => {
      syncRegearCfgFromUi();
      setAutoRegear(e.target.checked);
    };
    ['smk-regear-eff', 'smk-regear-size', 'smk-regear-mode', 'smk-regear-count'].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.onchange = () => { syncRegearCfgFromUi(); refreshStats(); log(`换装参数已更新：效率=${CFG.regearEffThreshold} 尺寸=${zhSize(CFG.regearSize)} 模式=${zhFillMode(CFG.regearFillMode)} 数量=${CFG.regearCount}`); };
    });
    document.getElementById('smk-regear-now').onclick = () => {
      syncRegearCfgFromUi();
      runRegearPipeline('manual');
    };
    document.getElementById('smk-topup').onchange = (e) => {
      setAutoTopUp(e.target.checked);
    };
    document.getElementById('smk-collector-fill').onchange = (e) => {
      setAutoCollectorFill(e.target.checked);
    };
    document.getElementById('smk-collector-buf').onchange = (e) => {
      setCollectorBuffer(e.target.checked);
    };
    document.getElementById('smk-soul-reserve').onchange = (e) => {
      setSoulGemTitanReserve(e.target.value);
    };
    document.getElementById('smk-supply-near').onchange = (e) => {
      setSupplyNearFullRatio(e.target.value);
    };
    document.getElementById('smk-inf-col').onchange = (e) => {
      CFG.infernalCollectorMode = e.target.value || 'auto';
      log('地狱化搜集：' + zhInfMode(CFG.infernalCollectorMode) + (infernalUnlocked() ? '' : '（未解锁：需鲜血之石「机甲地狱化」）'));
      refreshStats();
    };
    document.getElementById('smk-inf-scrap').onchange = (e) => {
      CFG.scrapInfernalCollectors = !!e.target.checked;
      log('可拆地狱化搜集机：' + (CFG.scrapInfernalCollectors ? '开（普通先拆，地狱化最后拆）' : '关'));
      refreshStats();
    };
    document.getElementById('smk-topup-now').onclick = () => {
      syncRegearCfgFromUi();
      topUpFollowing = true;
      const r = runTopUp('manual');
      if (r.skipped) log('[持续补队] 跳过：' + zhErr(r.skipped));
      else if (!r.did && r.waitingQueue) log('[持续补队] 队列已满，等待消耗后再补');
      else if (!r.did && r.done) log('[持续补队] 已满，无需补');
      refreshStats();
    };
    document.getElementById('smk-spire-four').onchange = (e) => {
      syncRegearCfgFromUi();
      setAutoSpireFour(e.target.checked);
    };
    document.getElementById('smk-spire-bay-mode').onchange = () => {
      syncRegearCfgFromUi();
      log('机甲舱预留模式：' + (ZH_SPIRE_BAY_MODE[CFG.spireMechbayMode] || CFG.spireMechbayMode));
      if (CFG.autoSpireFour) { try { applySpirePower(planFromLive()); } catch (e2) {} }
      refreshStats(); refreshSpireFourStatus();
    };
    document.getElementById('smk-spire-bay-reserve').onchange = () => {
      syncRegearCfgFromUi();
      log('机甲舱固定预留：' + (CFG.spireMechbayReserve < 0 ? '自动' : CFG.spireMechbayReserve));
      if (CFG.autoSpireFour) { try { applySpirePower(planFromLive()); } catch (e2) {} }
      refreshStats(); refreshSpireFourStatus();
    };
    document.getElementById('smk-spire-four-now').onclick = () => {
      syncRegearCfgFromUi();
      const prev = CFG.autoSpireFour;
      CFG.autoSpireFour = true;
      const r = spireFourTick('manual');
      if (!prev) CFG.autoSpireFour = false;
      if (r && r.built) { /* 已由 tick 写日志 */ }
      else if (r && r.plan) log('四件套规划下一步：' + (ZH_SPIRE_BLD[r.plan.next] || r.plan.next) + '（支援 ' + r.plan.supportMax + '，预留舱 ' + r.plan.on.mechbay + '）');
      else if (r && r.skipped) log('四件套未执行：' + r.skipped);
      refreshStats(); refreshSpireFourStatus();
    };

    refreshStats();
    refreshSpireFourStatus();
    startUiRefresh();
    // 默认开启通关侦测 + 持续补队
    setAutoRegear(CFG.autoRegear);
    setAutoSpireFour(CFG.autoSpireFour);
    log('尖塔机甲工具箱 v1.5.3 已挂载（地狱化搜集：' + zhInfMode(CFG.infernalCollectorMode) + (infernalUnlocked() ? '' : '，未解锁机甲地狱化') + '；四件套：' + (CFG.autoSpireFour ? '开' : '关') + '）');
    window.SpireMechKit = {
      CFG, previewScrap, doScrapIds, setBlueprint, buildOrQueue, bestMech, mechPower, ratingOf,
      refreshStats, isWaygateFight, clearMechQueue, listHellMechQueue, runRegearPipeline, buildOne,
      simulateFloorClear, floorWatchTick, snapshotFloor, setAutoRegear, setAuto, setAutoTopUp,
      setAutoCollectorFill, setCollectorBuffer, setSoulGemTitanReserve, setSupplyNearFullRatio, runTopUp, topUpPlan, hellMechQueuedBay,
      queueSlotsUsed, queueSlotsFree, fillBayCount, collectorRate, scrapCollectorsForOneTitan,
      tryBuildOneTitanBuffered, buildCollectors, restoreNormalCollector, get pendingNormalRestore() { return pendingNormalRestore; }, listCollectors, listScrapCollectors, chooseInfernalCollector, upgradeCollectorsToInfernal, setBlueprintInfernal, infernalUnlocked, isProtectedInfernal, isScrapableCollector, canAfford, canAffordSoul, canAffordSupply, freeBaySpace,
      soulGemAmount, soulGemReserveFloor, collectorKeepsSoulReserve, maxCollectorsBySoulReserve,
      supplyRatio, supplyAmount, supplyMax, isSupplyNearFull, shouldPreferTitanOverCollector, allowScrapCollectorsForTitan,
      mechSpace, mechCost, isNearOptimal, sameConfigAsBest, liveMechbay, livePurifier, liveQueue, liveSoulGem,
      getBestSupplyRatio, planSpireFour, planFromLive, snapshotSpireFour, applySpirePower, setStructOn,
      tryBuildOne, tryResearchPurify, purifyStatus, spireFourTick, setAutoSpireFour, suppressVollchSpire,
      buildingCosts, currentSupportMax, combatMechSpace, totalBayUsed, syncMechbayMax, refreshSpireFourStatus, livePortalStruct,
      get topUpFollowing() { return topUpFollowing; },
      set topUpFollowing(v) { topUpFollowing = !!v; }
    };
  }

  function boot() {
    if (!isEvolveReady()) return false;
    try {
      if (Object.keys(MONSTERS).length === 0 && game() && game().monsters) {
        // 某些版本挂在 evolve.monsters
      }
    } catch (e) {}
    mount();
    return true;
  }

  // ---------- v1.5.3 嵌入：#mechLab 最上方，#mechAssembly（拼装面板）之前、#mechList（机甲列表）更后 ----------
  // 游戏切换标签 / 重绘时会 empty() #mechLab 并重建两块；这里把同一个面板节点放回去（保留日志与状态），不重复创建。
  const COLLAPSE_KEY = 'smk-collapsed';
  function placePanel() {
    if (!panel) return false;
    const list = document.getElementById('mechList');
    const asm = document.getElementById('mechAssembly');
    const parent = (asm && asm.parentNode) || (list && list.parentNode);
    if (!parent || (!asm && !list)) {           // 机甲实验室未显示：不渲染
      if (panel.parentNode) panel.remove();
      return false;
    }
    const anchor = asm || list;                 // 插在拼装面板前（实验室最上方）
    const ok = panel.parentNode === parent && panel.nextElementSibling === anchor;
    if (ok) return true;
    const dup = document.querySelectorAll('#spire-mech-kit');
    dup.forEach((d) => { if (d !== panel) d.remove(); });
    const active = document.activeElement;
    const hadFocus = active && panel.contains(active);
    parent.insertBefore(panel, anchor);
    if (hadFocus && document.activeElement !== active) { try { active.focus({ preventScroll: true }); } catch (e) {} }
    try { refreshStats(); } catch (e) {}
    return true;
  }
  function installCollapse() {
    const head = panel.querySelector('.smk-title');
    const apply = (c) => {
      panel.classList.toggle('smk-collapsed', c);
      head.setAttribute('aria-expanded', c ? 'false' : 'true');
    };
    let c = false;
    try { c = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}
    apply(c);
    head.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.smk-info')) return;
      const now = !panel.classList.contains('smk-collapsed');
      apply(now);
      try { localStorage.setItem(COLLAPSE_KEY, now ? '1' : '0'); } catch (e2) {}
    });
  }
  let placeQueued = false;
  function schedulePlace() {
    if (placeQueued) return;
    placeQueued = true;
    (window.requestAnimationFrame || setTimeout)(() => {
      placeQueued = false;
      if (!panel) { boot(); return; }
      placePanel();
    });
  }
  function startWatch() {
    try {
      const mo = new MutationObserver((recs) => {
        for (const r of recs) {
          if (panel && (r.target === panel || panel.contains(r.target))) continue; // 面板自身刷新不触发
          schedulePlace();
          return;
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(schedulePlace, 2000); // 兜底
  }
  if (!boot()) {
    const bootTimer = setInterval(() => { if (boot()) clearInterval(bootTimer); }, 1000);
  }
  startWatch();
})();
