// ==UserScript==
// @name         禁食工具箱
// @namespace    evolve-fasting-kit
// @version      1.0.2
// @description  禁食剧情模式专用：按人口上限预留冥想者，默认保住不死（长生秘辛），不安全时关掉生命灌注器，并显示五项饥荒目标与“食物”烹饪进度。独立于主脚本，关闭后不再改职业或血湖建筑。
// @author       VPS探针开发
// @match        https://g8hh.github.io/evolve/
// @match        https://evolve.fengbujue.com/*
// @updateURL    https://scripts.fengbujue.com/fasting-kit.meta.js
// @downloadURL  https://scripts.fengbujue.com/fasting-kit.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/**
 * Pure planner for 禁食工具箱.
 * No DOM, no Vue, no localStorage. Used by unit tests and (copied into) the userscript.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FastingKitPlan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (d == null ? 0 : d);
  }

  function clampInt(n, lo, hi) {
    n = Math.floor(num(n, 0));
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }

  function highPopAdjust(workers, eff) {
    const e = num(eff, 1);
    return num(workers, 0) * (e > 0 ? e : 1);
  }

  function infusionMult(infusers) {
    const n = Math.max(0, num(infusers, 0));
    return Math.pow(0.95, n);
  }

  /**
   * Permanent + weather food-consume multiplier.
   * conservative: ignore temporary reductions (photosynth, winter hibernation)
   * so a weather/season change cannot suddenly starve people.
   */
  function foodConsumeMod(traits, cal, opts) {
    traits = traits || {};
    cal = cal || {};
    const conservative = !!(opts && opts.conservative);
    let fcm = 1;
    fcm *= 1 + num(traits.gluttony, 0) / 100;
    fcm *= 1 + num(traits.highMetabolism, 0) / 100;
    fcm *= 1 - num(traits.sticky, 0) / 100;
    fcm *= 1 - num(traits.stickyFathom, 0) / 100;
    if (!conservative && traits.photosynth) {
      const p = traits.photosynth; // [sunny, cloudy, rainy] percents
      const weather = num(cal.weather, 0);
      const temp = num(cal.temp, 1);
      if (weather === 2) fcm *= 1 - num(p[0], 0) / 100;
      else if (weather === 1) fcm *= 1 - num(p[1], 0) / 100;
      else fcm *= (temp === 0) ? 1 : (1 - num(p[2], 0) / 100);
    }
    fcm *= 1 + num(traits.ravenous, 0) / 100;
    if (!conservative && traits.hibernator && num(cal.season, 0) === 3) {
      fcm *= 1 - num(traits.hibernator, 0) / 100;
    }
    const hpDiv = num(traits.highPopDiv, 1);
    if (hpDiv > 0) fcm /= hpDiv;
    if (fcm < 0) fcm = 0;
    return fcm;
  }

  function thresholdBase(traits) {
    traits = traits || {};
    let t = 1.25;
    t += num(traits.slowDigestion, 0);
    t += num(traits.slowDigestionFathom, 0);
    t += num(traits.humpback, 0);
    t -= num(traits.atrophy, 0);
    return t;
  }

  function threshold(state) {
    const adj = highPopAdjust(state.meditators, state.highPopEff);
    const raw = thresholdBase(state.traits) + adj * 0.03;
    return raw * infusionMult(state.infusers);
  }

  function demand(state, pop) {
    const p = Math.max(0, num(pop != null ? pop : state.pop, 0));
    const fcm = num(state.foodConsumeMod, 1);
    return p / 100 * fcm;
  }

  function starveAmount(state, pop) {
    const v = demand(state, pop) - threshold(state);
    return v > 0 ? v : 0;
  }

  function neededMeditators(state, targetPop, buffer) {
    const pop = Math.max(0, num(targetPop != null ? targetPop : state.pop, 0));
    const fcm = num(state.foodConsumeMod, 1);
    const inf = infusionMult(state.infusers);
    const base = thresholdBase(state.traits);
    const eff = num(state.highPopEff, 1) > 0 ? num(state.highPopEff, 1) : 1;
    const extra = Math.max(0, num(buffer, 0));
    if (inf <= 0) return Infinity;
    const adjNeed = (pop / 100 * fcm / inf - base) / 0.03;
    const workers = Math.ceil(Math.max(0, adjNeed) / eff);
    return workers + extra;
  }

  function safePop(state, meditators, infusers) {
    const med = meditators != null ? meditators : state.meditators;
    const inf = infusers != null ? infusers : state.infusers;
    const fcm = num(state.foodConsumeMod, 1);
    if (fcm <= 0) return Infinity;
    const adj = highPopAdjust(med, state.highPopEff);
    const raw = thresholdBase(state.traits) + adj * 0.03;
    return (raw * infusionMult(inf)) * 100 / fcm;
  }

  function maxSafeInfusers(state, targetPop, meditators, buffer) {
    const med = Math.max(0, num(meditators != null ? meditators : state.meditators, 0));
    let n = 0;
    const probe = Object.assign({}, state, { meditators: med });
    while (n < 40) {
      probe.infusers = n + 1;
      const need = neededMeditators(probe, targetPop, buffer);
      if (need > med) break;
      n++;
    }
    return n;
  }

  /** Oven tick progress toward 100, matching main.js when oven_complete is powered. */
  function dishProgressPerTick(state) {
    if (!state.ovenOn) return 0;
    let progress = 0.00025;
    progress *= 1 + 0.15 * Math.max(0, num(state.infusers, 0));
    const steepers = Math.max(0, num(state.steepersOn, 0));
    const floor = Math.max(0, num(state.spireFloor, 0));
    if (steepers > 0 && floor > 0) {
      let hunger = 0.5;
      hunger -= num(state.angryHunger, 0);
      hunger += num(state.malnutritionHunger, 0);
      const mult = 0.03 + (state.malnutritionHunger ? 0.01 : 0) + (state.angryHunger ? -0.01 : 0);
      const working = Math.min(steepers, Math.floor(hunger / (mult > 0 ? mult : 1)));
      progress *= 1 + (0.05 * Math.max(0, floor - 1) * Math.max(0, working));
    }
    return progress;
  }

  function plan(state, cfg) {
    cfg = cfg || {};
    const immortal = cfg.immortal !== false;
    const buffer = cfg.buffer != null ? cfg.buffer : 3;
    const reserveForCap = cfg.reserveForCap !== false;
    const allowInfuser = !!cfg.allowInfuser;
    const autoDish = cfg.autoDish !== false;
    const pop = Math.max(0, num(state.pop, 0));
    const popMax = Math.max(pop, num(state.popMax, 0));
    let target = pop;
    if (reserveForCap) target = Math.max(target, popMax);
    if (cfg.targetPop != null) target = Math.max(target, num(cfg.targetPop, 0));
    if (cfg.aimCitizenGoal) target = Math.max(target, 1200);

    const planned = Object.assign({}, state);
    let wantInfusers = Math.max(0, num(state.infusers, 0));
    if (immortal && !allowInfuser) wantInfusers = 0;
    else if (immortal && allowInfuser) {
      // Keep already-on infusers only if they stay safe. Do not auto-raise the count.
      const cap = maxSafeInfusers(Object.assign({}, planned, { infusers: 0 }), target, state.meditatorsAvailable != null ? state.meditatorsAvailable : state.meditators, buffer);
      wantInfusers = Math.min(wantInfusers, cap);
    }
    planned.infusers = wantInfusers;

    const need = neededMeditators(planned, target, immortal ? buffer : 0);
    const have = Math.max(0, num(state.meditators, 0));
    const margin = safePop(planned, have, wantInfusers) - pop;
    const starve = starveAmount(Object.assign({}, planned, { meditators: have }), pop);
    const warnings = [];
    if (immortal && starve > 0) warnings.push('starve');
    if (immortal && have < need) warnings.push('short_meditators');
    if (immortal && margin < 1) warnings.push('tight_margin');
    if (state.fasting && pop < 1200 && cfg.aimCitizenGoal && need > (state.meditatorsAvailable != null ? state.meditatorsAvailable : popMax)) {
      warnings.push('cannot_cover_1200');
    }

    return {
      targetPop: target,
      neededMeditators: need,
      haveMeditators: have,
      wantInfusers: wantInfusers,
      wantSteepers: autoDish && state.ovenUnlocked ? Math.max(num(state.steepersOn, 0), num(state.steepersCount, 0)) : num(state.steepersOn, 0),
      ovenWantOn: !!(autoDish && state.ovenUnlocked),
      safePop: safePop(planned, have, wantInfusers),
      plannedSafePop: safePop(planned, need, wantInfusers),
      starveAmount: starve,
      margin: margin,
      dishPerTick: dishProgressPerTick(Object.assign({}, state, { infusers: wantInfusers })),
      warnings: warnings
    };
  }

  return {
    highPopAdjust,
    infusionMult,
    foodConsumeMod,
    thresholdBase,
    threshold,
    demand,
    starveAmount,
    neededMeditators,
    safePop,
    maxSafeInfusers,
    dishProgressPerTick,
    plan
  };
});

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const SETTINGS_KEY = 'fsk-settings';
  const COLLAPSE_KEY = 'fsk-collapsed';
  const Plan = (typeof FastingKitPlan !== 'undefined' && FastingKitPlan) ? FastingKitPlan : null;

  const DEFAULTS = {
    enabled: false,
    autoStart: true,
    userOff: false,
    immortal: true,
    reserveForCap: true,
    aimCitizenGoal: true,
    autoDish: true,
    allowInfuser: false,
    autoReset: false,
    buffer: 3
  };

  function loadCfg() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { raw = null; }
    const cfg = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    cfg.buffer = Math.max(0, Math.min(20, Math.floor(Number(cfg.buffer) || 0)));
    return cfg;
  }
  function saveCfg() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CFG)); } catch (e) {}
  }
  let CFG = loadCfg();

  const logs = [];
  function log(msg) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    logs.unshift('[' + hh + ':' + mm + ':' + ss + '] ' + msg);
    if (logs.length > 40) logs.length = 40;
    const el = document.getElementById('fsk-log');
    if (el) el.textContent = logs.join('\n');
  }

  function game() { return window.evolve || window.game || null; }
  function cloneGlobal() {
    const e = game();
    return e && e.global ? e.global : null;
  }
  function getVueById(id) {
    const el = document.getElementById(id);
    return el && el.__vue__ ? el.__vue__ : null;
  }
  function vueCivic(v) {
    if (!v) return null;
    if (v.civic && v.civic.meditator) return v.civic;
    if (v.$data && v.$data.civic && v.$data.civic.meditator) return v.$data.civic;
    if (v.civic && (v.civic.farmer || v.civic.unemployed)) return v.civic;
    if (v.$data && v.$data.civic) return v.$data.civic;
    return null;
  }
  function liveCivic() {
    const ids = ['civ-meditator', 'civ-farmer', 'civ-unemployed', 'jobs', 'sshifter'];
    for (let i = 0; i < ids.length; i++) {
      const civic = vueCivic(getVueById(ids[i]));
      if (civic) return civic;
    }
    try {
      const root = document.getElementById('civics') || document.getElementById('jobs');
      if (root) {
        const all = root.querySelectorAll('*');
        const n = Math.min(all.length, 400);
        for (let i = 0; i < n; i++) {
          const civic = vueCivic(all[i].__vue__);
          if (civic) return civic;
        }
      }
    } catch (e) {}
    return null;
  }
  function livePortalStruct(key) {
    const vue = getVueById('portal-' + key);
    if (vue && vue.act && typeof vue.act.count === 'number') return vue.act;
    if (vue && vue.$data && vue.$data.act && typeof vue.$data.act.count === 'number') return vue.$data.act;
    try {
      const wantId = 'portal-' + key;
      const all = document.querySelectorAll('[id^="portal-"], #portal *');
      const n = Math.min(all.length, 4000);
      for (let i = 0; i < n; i++) {
        const v = all[i].__vue__;
        if (!v) continue;
        const act = v.act || (v.$data && v.$data.act);
        if (act && act.id === wantId && typeof act.count === 'number') return act;
      }
    } catch (e) {}
    const g = cloneGlobal();
    return g && g.portal && g.portal[key] ? g.portal[key] : null;
  }
  function liveResource(name) {
    const el = document.getElementById('res' + name);
    if (el && el.__vue__ && el.__vue__.$data && typeof el.__vue__.$data.amount === 'number') return el.__vue__.$data;
    if (el && el.__vue__ && typeof el.__vue__.amount === 'number') return el.__vue__;
    const g = cloneGlobal();
    return g && g.resource && g.resource[name] ? g.resource[name] : null;
  }
  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const t = (a.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || !!a.isContentEditable;
  }
  function clickId(id) {
    if (isTyping()) return false;
    const el = document.getElementById(id);
    if (!el) return false;
    const btn = el.querySelector('a.button, button, .button, h3, .aTitle') || el;
    try { btn.click(); return true; } catch (e) { return false; }
  }

  function traitVars(name) {
    const ev = game();
    if (ev && ev.traits && ev.traits[name] && typeof ev.traits[name].vars === 'function') {
      try { return ev.traits[name].vars(); } catch (e) {}
    }
    return null;
  }
  function fathom(r) {
    const ev = game();
    if (ev && typeof ev.fathomCheck === 'function') {
      try { return Number(ev.fathomCheck(r)) || 0; } catch (e) {}
    }
    return 0;
  }
  function readTraits(race) {
    const t = {};
    const g = function (name, idx) {
      if (!race || !race[name]) return 0;
      const vars = traitVars(name);
      return vars && vars[idx] != null ? Number(vars[idx]) || 0 : 0;
    };
    function varsAt(name, gen) {
      const ev = game();
      if (!ev || !ev.traits || !ev.traits[name] || typeof ev.traits[name].vars !== 'function') return null;
      try { return ev.traits[name].vars(gen); } catch (e) { return null; }
    }
    t.gluttony = g('gluttony', 0);
    t.highMetabolism = g('high_metabolism', 0);
    t.sticky = g('sticky', 0);
    const pf = fathom('pinguicula');
    if (pf > 0) {
      const v = varsAt('sticky', 1);
      if (v) t.stickyFathom = (Number(v[0]) || 0) * pf;
    }
    if (race && race.photosynth) {
      const v = traitVars('photosynth') || [40, 20, 10];
      t.photosynth = [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
    }
    t.ravenous = g('ravenous', 0);
    t.hibernator = g('hibernator', 0);
    t.slowDigestion = g('slow_digestion', 0);
    const sf = fathom('slitheryn');
    if (sf > 0) {
      const v = varsAt('slow_digestion', 1);
      if (v) t.slowDigestionFathom = (Number(v[0]) || 0) * sf;
    }
    t.humpback = g('humpback', 0);
    t.atrophy = g('atrophy', 0);
    if (race && race.high_pop) {
      const v = traitVars('high_pop') || [4, 26, 3.5];
      t.highPopDiv = Number(v[0]) || 1;
    } else {
      t.highPopDiv = 1;
    }
    return t;
  }
  function highPopEff(race) {
    if (!race || !race.high_pop) return 1;
    const v = traitVars('high_pop') || [4, 26, 3.5];
    const eff = Number(v[1]) || 0;
    return eff > 0 ? eff / 100 : 1;
  }
  function universeAffix(universe) {
    return ({ standard: 'l', heavy: 'h', antimatter: 'a', evil: 'e', micro: 'm', magic: 'mg' })[universe] || 'l';
  }

  let lastGameKey = '';
  function gameKey(g) {
    if (!g || !g.race) return '';
    return String(g.race.species || '') + '|' + String((g.stats && g.stats.start) || '') + '|' + String(!!g.race.fasting);
  }

  function gatherState() {
    if (!Plan) return null;
    const g = cloneGlobal();
    if (!g || !g.race) return null;
    const fasting = !!g.race.fasting;
    const civic = liveCivic();
    const meditators = civic && civic.meditator ? Number(civic.meditator.workers) || 0 : (g.civic && g.civic.meditator ? Number(g.civic.meditator.workers) || 0 : 0);
    const species = g.race.species;
    const popRes = liveResource(species) || (g.resource && g.resource[species]) || {};
    const pop = Number(popRes.amount) || 0;
    const popMax = Number(popRes.max) || pop;
    const inf = livePortalStruct('dish_life_infuser');
    const steep = livePortalStruct('dish_soul_steeper');
    const ovenC = livePortalStruct('oven_complete');
    const oven = livePortalStruct('oven');
    const dish = (g.portal && g.portal.devilish_dish) || livePortalStruct('devilish_dish') || {};
    const cal = (g.city && g.city.calendar) || {};
    const traits = readTraits(g.race);
    const fcm = Plan.foodConsumeMod(traits, cal, { conservative: true });
    const affix = universeAffix(g.race.universe);
    const eh = (g.stats && g.stats.endless_hunger) || {};
    const flag = (key) => !!(eh[key] && (eh[key][affix] || eh[key].l));
    let available = meditators;
    if (civic) {
      const djob = civic.d_job;
      const pull = ['farmer', djob, 'unemployed', 'hunter', 'forager', 'lumberjack', 'quarry_worker', 'scavenger', 'crystal_miner'];
      const seen = { meditator: true };
      pull.forEach((j) => {
        if (!j || seen[j] || !civic[j] || typeof civic[j].workers !== 'number') return;
        seen[j] = true;
        available += civic[j].workers;
      });
    }
    return {
      fasting,
      g,
      civic,
      species,
      pop,
      popMax,
      meditators,
      meditatorsAvailable: available,
      infusers: inf ? Number(inf.on) || 0 : 0,
      infuserCount: inf ? Number(inf.count) || 0 : 0,
      steepersOn: steep ? Number(steep.on) || 0 : 0,
      steepersCount: steep ? Number(steep.count) || 0 : 0,
      ovenOn: !!(ovenC && (ovenC.on > 0 || (g.portal && g.portal.oven_complete && g.portal.oven_complete.on))),
      ovenUnlocked: !!(g.tech && (g.tech.dish >= 1 || oven || ovenC)),
      ovenComplete: !!(ovenC && ovenC.count > 0),
      dishDone: Number(dish.done) || 0,
      spireFloor: g.portal && g.portal.spire ? Number(g.portal.spire.count) || 0 : 0,
      foodConsumeMod: fcm,
      traits,
      highPopEff: highPopEff(g.race),
      starved: Number(g.stats && g.stats.starved) || 0,
      stock: Number(g.tech && g.tech.stock_exchange) || 0,
      embassy: !!(g.galaxy && g.galaxy.embassy && g.galaxy.embassy.count > 0) || flag('b1'),
      chthonian: flag('b2'),
      obj: {
        b1: flag('b1'),
        b2: flag('b2'),
        b3: flag('b3') || ((g.tech && g.tech.stock_exchange) >= 80),
        b4: flag('b4') || pop >= 1200,
        b5: flag('b5') || (Number(dish.done) || 0) >= 100
      },
      infRef: inf,
      steepRef: steep,
      ovenCompleteRef: ovenC
    };
  }

  function assignMeditators(civic, want) {
    if (!civic || !civic.meditator) return 0;
    const med = civic.meditator;
    want = Math.max(0, Math.floor(want));
    const max = med.max;
    if (typeof max === 'number' && max !== -1 && max >= 0) want = Math.min(want, max);
    let have = Number(med.workers) || 0;
    if (have === want) {
      if (typeof med.assigned === 'number') med.assigned = have;
      return have;
    }
    if (have > want) {
      const djob = civic.d_job && civic[civic.d_job] && civic.d_job !== 'meditator' ? civic[civic.d_job] : civic.unemployed;
      const drop = have - want;
      med.workers = want;
      if (typeof med.assigned === 'number') med.assigned = want;
      if (djob && typeof djob.workers === 'number') {
        djob.workers += drop;
        if (typeof djob.assigned === 'number') djob.assigned = djob.workers;
      }
      return want;
    }
    let need = want - have;
    const djobName = civic.d_job;
    const order = ['farmer', djobName, 'unemployed', 'hunter', 'forager', 'lumberjack', 'quarry_worker', 'scavenger', 'crystal_miner', 'cement_worker', 'banker', 'entertainer', 'professor', 'scientist', 'priest', 'miner', 'coal_miner', 'teamster'];
    const seen = { meditator: true };
    for (let i = 0; i < order.length && need > 0; i++) {
      const j = order[i];
      if (!j || seen[j] || !civic[j] || typeof civic[j].workers !== 'number') continue;
      seen[j] = true;
      const job = civic[j];
      if (job.workers <= 0) continue;
      const take = Math.min(need, job.workers);
      job.workers -= take;
      if (typeof job.assigned === 'number') job.assigned = job.workers;
      med.workers = (Number(med.workers) || 0) + take;
      need -= take;
    }
    have = Number(med.workers) || 0;
    if (typeof med.assigned === 'number') med.assigned = have;
    return have;
  }

  function setStructOn(inst, want) {
    if (!inst || typeof inst.on !== 'number') return false;
    want = Math.max(0, Math.min(Number(inst.count) || inst.on, Math.floor(want)));
    if (inst.on === want) return false;
    inst.on = want;
    return true;
  }

  let lastNeed = null;
  let lastWarn = '';
  function tick() {
    placePanel();
    const st = gatherState();
    if (!st) { renderPanel(null, null); return; }

    const key = gameKey(st.g);
    if (key !== lastGameKey) {
      lastGameKey = key;
      if (st.fasting && CFG.autoStart && !CFG.enabled) {
        // new run or first detect: autoStart unless userOff in this same fasting run
        // userOff persists across reloads of the same run; clear it only when fasting ends
      }
      if (!st.fasting) {
        if (CFG.userOff) { CFG.userOff = false; saveCfg(); }
      }
    }
    if (st.fasting && CFG.autoStart && !CFG.enabled && !CFG.userOff) {
      CFG.enabled = true;
      saveCfg();
      log('检测到禁食，已自动开启工具箱');
    }
    if (!st.fasting && CFG.enabled) {
      // stay idle outside fasting; do not flip the saved switch off automatically
    }

    const active = !!(CFG.enabled && st.fasting);
    let result = null;
    if (Plan) {
      result = Plan.plan({
        pop: st.pop,
        popMax: st.popMax,
        meditators: st.meditators,
        meditatorsAvailable: st.meditatorsAvailable,
        infusers: st.infusers,
        steepersOn: st.steepersOn,
        steepersCount: st.steepersCount,
        ovenOn: st.ovenOn,
        ovenUnlocked: st.ovenUnlocked,
        foodConsumeMod: st.foodConsumeMod,
        traits: st.traits,
        highPopEff: st.highPopEff,
        fasting: st.fasting,
        spireFloor: st.spireFloor
      }, {
        immortal: CFG.immortal,
        reserveForCap: CFG.reserveForCap,
        aimCitizenGoal: CFG.aimCitizenGoal,
        autoDish: CFG.autoDish,
        allowInfuser: CFG.allowInfuser,
        buffer: CFG.buffer
      });
    }

    if (active && result) {
      if (st.civic) {
        const got = assignMeditators(st.civic, result.neededMeditators);
        if (lastNeed !== result.neededMeditators) {
          lastNeed = result.neededMeditators;
          log('预留冥想者 ' + got + ' / 需要 ' + result.neededMeditators + '（目标人口 ' + Math.floor(result.targetPop) + '）');
        }
        if (got < result.neededMeditators && CFG.immortal) {
          const w = '冥想者不足 ' + got + '/' + result.neededMeditators;
          if (w !== lastWarn) { lastWarn = w; log(w); }
        }
      }
      if (CFG.immortal && st.infRef && typeof st.infRef.on === 'number') {
        const cap = CFG.allowInfuser ? result.wantInfusers : 0;
        if (st.infRef.on > cap) {
          setStructOn(st.infRef, cap);
          log('已把生命灌注器开到 ' + cap + '，避免压低饿死阈值');
        }
      }
      if (CFG.autoDish) {
        if (st.ovenUnlocked && !st.ovenComplete) clickId('portal-oven');
        if (st.ovenCompleteRef && st.ovenCompleteRef.count > 0 && !st.ovenCompleteRef.on) {
          setStructOn(st.ovenCompleteRef, 1);
        }
        if (st.steepRef && st.steepRef.count > 0 && st.steepRef.on < st.steepRef.count) {
          setStructOn(st.steepRef, st.steepRef.count);
        }
      }
      if (CFG.autoReset && st.dishDone >= 100 && st.g.tech && !st.g.tech.dish_reset) {
        if (clickId('tech-final_ingredient')) log('已点最终作料，准备禁食重置');
      }
    }
    renderPanel(st, result);
  }

  function objLine(ok, label, extra) {
    return '<span class="' + (ok ? 'fsk-ok' : 'fsk-no') + '">' + (ok ? '✓' : '○') + ' ' + label + (extra ? ' <span class="fsk-muted">' + extra + '</span>' : '') + '</span>';
  }

  function fmt(n, d) {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 100) return String(Math.round(n));
    return n.toFixed(d == null ? 1 : d);
  }

  let panel = null, statsEl = null, logEl = null;

  function syncInputs() {
    const set = (id, val, isNum) => {
      const el = panel && panel.querySelector('#' + id);
      if (!el) return;
      if (isNum) {
        if (document.activeElement !== el) el.value = String(val);
      } else {
        el.checked = !!val;
      }
    };
    set('fsk-enabled', CFG.enabled);
    set('fsk-autostart', CFG.autoStart);
    set('fsk-immortal', CFG.immortal);
    set('fsk-reserve', CFG.reserveForCap);
    set('fsk-goal', CFG.aimCitizenGoal);
    set('fsk-dish', CFG.autoDish);
    set('fsk-infuser', CFG.allowInfuser);
    set('fsk-reset', CFG.autoReset);
    set('fsk-buffer', CFG.buffer, true);
  }

  function renderPanel(st, result) {
    if (!panel || !statsEl) return;
    syncInputs();
    if (!st) {
      statsEl.innerHTML = '<div class="fsk-muted">等待游戏加载…</div>';
      return;
    }
    if (!st.fasting) {
      statsEl.innerHTML = '<div class="fsk-muted">当前不是禁食剧情。进化时勾选「禁食」后再用本工具箱。</div>';
      return;
    }
    const r = result || {};
    const starve = st.starved;
    const immortalLost = starve > 0;
    const rows = [];
    rows.push('<div><b>' + (CFG.enabled ? '已启用' : '未启用') + '</b> · 人口 ' + Math.floor(st.pop) + ' / ' + Math.floor(st.popMax) +
      ' · 本局饿死 <span class="' + (immortalLost ? 'fsk-bad' : 'fsk-ok') + '">' + starve + '</span>' +
      (immortalLost ? ' <span class="fsk-bad">长生秘辛已失败</span>' : '') + '</div>');
    rows.push('<div>冥想者 ' + st.meditators + (r.neededMeditators != null ? ' / 需要 ' + r.neededMeditators : '') +
      ' · 安全人口约 ' + fmt(r.safePop) +
      ' · 余量 ' + (r.margin != null ? (r.margin >= 0 ? '+' : '') + fmt(r.margin) : '—') + '</div>');
    rows.push('<div>生命灌注器 ' + st.infusers + '/' + st.infuserCount +
      ' · 浸魂器 ' + st.steepersOn + '/' + st.steepersCount +
      ' · “食物” ' + fmt(st.dishDone, 2) + '%</div>');
    if (r.warnings && r.warnings.length) {
      const map = { starve: '正在饿死', short_meditators: '冥想者不够', tight_margin: '安全余量很紧', cannot_cover_1200: '现有劳动力撑不住 1200 人口' };
      rows.push('<div class="fsk-bad">警告：' + r.warnings.map((w) => map[w] || w).join('；') + '</div>');
    }
    rows.push('<div class="fsk-obj">' +
      objLine(st.obj.b1, '大使馆') +
      objLine(st.obj.b2, '幽冥威胁 0') +
      objLine(st.obj.b3, '证券交易所 80', st.stock + '/80') +
      objLine(st.obj.b4, '人口 1200', Math.floor(st.pop) + '/1200') +
      objLine(st.obj.b5, '煮完“食物”', fmt(st.dishDone, 2) + '%') +
      '</div>');
    statsEl.innerHTML = rows.join('');
  }

  const FSK_CSS = `html { --fsk-bg:#1f2526; --fsk-card:#262e2f; --fsk-card2:#2d3637; --fsk-head:#1a2021; --fsk-border:#3b4647; --fsk-text:#e6ecec;
       --fsk-muted:#9aa7a8; --fsk-accent:#48c78e; --fsk-accent2:#ffdd57; --fsk-hover:rgba(255,255,255,.05); --fsk-input:#141a1b;
       --fsk-off:#5a6566; --fsk-shadow:0 2px 10px rgba(0,0,0,.35); --fsk-bad:#f87171; }
html.light { --fsk-bg:#f4f6f8; --fsk-card:#ffffff; --fsk-card2:#f7f9fa; --fsk-head:#eef2f4; --fsk-border:#d5dde2; --fsk-text:#1f2a30;
       --fsk-muted:#62717a; --fsk-accent:#1f9d6a; --fsk-accent2:#8a6d00; --fsk-hover:rgba(0,0,0,.04); --fsk-input:#ffffff; --fsk-off:#b8c2c8;
       --fsk-shadow:0 2px 8px rgba(0,0,0,.08); --fsk-bad:#c23a3a; }
html.night, html.redgreen { --fsk-card:#1e1e1e; --fsk-card2:#252525; --fsk-head:#151515; --fsk-border:#363636; --fsk-input:#0e0e0e; }
html.darkNight { --fsk-card:#1e1e1e; --fsk-card2:#242424; --fsk-head:#141414; --fsk-border:#333; --fsk-text:#c4c4c4; --fsk-input:#0e0e0e; --fsk-accent2:#ffcc00; }
html.gruvboxLight { --fsk-bg:#fbf1c7; --fsk-card:#f9f5d7; --fsk-card2:#f2e5bc; --fsk-head:#ebdbb2; --fsk-border:#d5c4a1; --fsk-text:#3c3836; --fsk-muted:#7c6f64;
       --fsk-accent:#79740e; --fsk-accent2:#b57614; --fsk-hover:rgba(60,56,54,.06); --fsk-input:#fbf1c7; --fsk-off:#bdae93; --fsk-shadow:0 2px 8px rgba(60,56,54,.12); }
html.gruvboxDark { --fsk-card:#282828; --fsk-card2:#32302f; --fsk-head:#1d2021; --fsk-border:#504945; --fsk-text:#ebdbb2; --fsk-muted:#a89984;
       --fsk-accent:#b8bb26; --fsk-accent2:#fabd2f; --fsk-input:#1d2021; --fsk-off:#665c54; }
html.orangeSoda { --fsk-card:#1c1f20; --fsk-card2:#242829; --fsk-head:#131516; --fsk-border:#313638; --fsk-text:#ebdbb2; --fsk-accent:#f06543; --fsk-accent2:#f06543; --fsk-input:#0f1112; }
html.dracula { --fsk-card:#282a36; --fsk-card2:#303241; --fsk-head:#21222c; --fsk-border:#44475a; --fsk-text:#f8f8f2; --fsk-muted:#a4a7c0;
       --fsk-accent:#50fa7b; --fsk-accent2:#f1fa8c; --fsk-input:#1e1f29; --fsk-off:#6272a4; }
#fasting-kit { position: static; display: block; box-sizing: border-box; width: auto; max-width: none; margin: 0 0 .5rem; padding: 0 0 8px; color: var(--fsk-text);
  background: var(--fsk-card); border: 1px solid var(--fsk-border); border-radius: 12px; box-shadow: var(--fsk-shadow);
  font: 13px/1.5 "Microsoft YaHei", "微软雅黑", sans-serif; }
#fasting-kit .fsk-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 6px;
  background: var(--fsk-head); border-bottom: 1px solid var(--fsk-border); border-radius: 12px 12px 0 0; font-weight: 700; font-size: 15px; color: var(--fsk-accent);
  cursor: pointer; user-select: none; }
#fasting-kit .fsk-title .fsk-sub { font-weight: normal; font-size: 12px; color: var(--fsk-muted); }
#fasting-kit .fsk-caret { display: inline-block; width: 1em; transition: transform .15s; color: var(--fsk-muted); }
#fasting-kit.fsk-collapsed { padding-bottom: 0; }
#fasting-kit.fsk-collapsed > :not(.fsk-title) { display: none !important; }
#fasting-kit.fsk-collapsed > .fsk-title { margin: 0; border-bottom: 0; border-radius: 12px; }
#fasting-kit.fsk-collapsed .fsk-caret { transform: rotate(-90deg); }
#fasting-kit .fsk-stats { margin: 0 12px 6px; padding: 8px 12px; background: var(--fsk-card2); border: 1px solid var(--fsk-border); border-radius: 10px; line-height: 1.55; }
#fasting-kit .fsk-card { margin: 6px 12px; padding: 6px 12px 8px; background: var(--fsk-card2); border: 1px solid var(--fsk-border); border-radius: 10px; }
#fasting-kit .fsk-card > b:first-child { display: inline-block; font-size: 14px; color: var(--fsk-text); padding: 1px 0 1px 9px; border-left: 3px solid var(--fsk-accent); margin: 2px 6px 6px 0; }
#fasting-kit label { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 4px; border-radius: 8px; cursor: pointer; user-select: none; }
#fasting-kit label:hover { background: var(--fsk-hover); }
#fasting-kit input[type=checkbox],
#civics #fasting-kit input[type=checkbox],
#portal #fasting-kit input[type=checkbox] {
  -webkit-appearance: none !important; appearance: none !important; position: relative !important;
  width: 2.5em !important; height: 1.4em !important; min-width: 2.5em !important; margin: 0 !important;
  vertical-align: middle; border: 0 !important; border-radius: 1em !important;
  background: var(--fsk-off) !important; box-shadow: none; box-sizing: border-box; cursor: pointer;
  flex-shrink: 0; font-size: 14px; opacity: 1;
}
#fasting-kit input[type=checkbox]::before,
#civics #fasting-kit input[type=checkbox]::before,
#portal #fasting-kit input[type=checkbox]::before {
  content: "" !important; display: block !important; position: absolute !important;
  top: .16em; left: .16em; width: 1.08em !important; height: 1.08em !important;
  border: 0 !important; border-radius: 50% !important; background: #fff !important;
  box-shadow: 0 1px 3px rgba(0,0,0,.35); transform: none; transition: transform .15s;
}
#fasting-kit input[type=checkbox]:checked,
#civics #fasting-kit input[type=checkbox]:checked,
#portal #fasting-kit input[type=checkbox]:checked { background: var(--fsk-accent) !important; border-color: transparent !important; }
#fasting-kit input[type=checkbox]:checked::before,
#civics #fasting-kit input[type=checkbox]:checked::before,
#portal #fasting-kit input[type=checkbox]:checked::before { transform: translateX(1.1em) !important; }
#fasting-kit input[type=number] { height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--fsk-border); background: var(--fsk-input); color: var(--fsk-text); font-size: 13px; vertical-align: middle; width: 64px; }
#fasting-kit input:focus { outline: none; border-color: var(--fsk-accent); box-shadow: 0 0 0 2px rgba(72,199,142,.25); }
#fasting-kit .fsk-log { margin: 6px 12px 0; max-height: 110px; overflow: auto; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--fsk-border);
  background: var(--fsk-input); color: var(--fsk-text); font: 11.5px/1.5 "Microsoft YaHei", "微软雅黑", ui-monospace, monospace; white-space: pre-wrap; }
#fasting-kit .fsk-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#fasting-kit .fsk-muted, #fasting-kit .fsk-muted * { color: var(--fsk-muted); font-weight: normal; }
#fasting-kit .fsk-ok { color: var(--fsk-accent); margin-right: 10px; display: inline-block; }
#fasting-kit .fsk-no { color: var(--fsk-muted); margin-right: 10px; display: inline-block; }
#fasting-kit .fsk-bad { color: var(--fsk-bad); }
#fasting-kit .fsk-obj { margin-top: 4px; }
#fsk-tip { position: fixed; z-index: 100000; display: none; max-width: 420px; padding: 10px 12px; border-radius: 10px; pointer-events: auto;
  background: var(--fsk-card); color: var(--fsk-text); border: 1px solid var(--fsk-border); box-shadow: 0 8px 24px rgba(0,0,0,.35);
  font: 13px/1.6 "Microsoft YaHei", "微软雅黑", sans-serif; text-align: left; white-space: pre-line; }
#fasting-kit .fsk-info { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-left: 6px; border-radius: 50%;
  font-size: 12px; font-weight: 700; color: var(--fsk-muted); border: 1px solid var(--fsk-border); cursor: help; user-select: none; vertical-align: middle; }
#fasting-kit .fsk-info:hover { color: var(--fsk-accent); border-color: var(--fsk-accent); }
`;

  function injectStyle() {
    if (document.getElementById('fsk-style')) return;
    const st = document.createElement('style');
    st.id = 'fsk-style';
    st.textContent = FSK_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const TIPS = {
    'fsk-enabled': '打开后按规划预留冥想者，并按下方选项管理血湖烹饪建筑。关闭后不再改职业或这些建筑。主脚本仍会自己补一部分冥想者，但只按当前人口算。',
    'fsk-autostart': '侦测到当前是禁食剧情时自动打开启用开关。若你手动关掉，同一次禁食里不会再自动开，直到新开一局。',
    'fsk-immortal': '默认开启。按更保守的食物消耗（忽略日晒和冬眠的临时减免）预留冥想者，尽量让饿死保持为 0，好拿长生秘辛。若本局已经饿死过任何人，该成就已经失败。',
    'fsk-reserve': '按人口上限而不是当前人口来预留冥想者，避免房子一下住满就饿死人。',
    'fsk-goal': '至少按 1200 人口来预留冥想者，为「市民数达到 1200」这项目标提前留余量。',
    'fsk-dish': '有条件时建造并开启血湖炉灶，已有浸魂器会开满（它只惩罚物资产量，不提高饿死）。不会自动建造生命灌注器。',
    'fsk-infuser': '默认关闭。勾选后，仅在当前预留的冥想者仍能安全养活目标人口时，才允许已有的生命灌注器开着。不安全会立刻关掉。',
    'fsk-reset': '默认关闭。「食物」煮到 100% 后自动点「最终作料」并走禁食威望重置。请确认要重置再打开。',
    'fsk-buffer': '在刚好不饿死的冥想者数量上再多留几个，防止主脚本抽走或人口突然增长。'
  };

  function installTips() {
    if (window.__fskTipsInstalled) return;
    window.__fskTipsInstalled = true;
    let tip = null, timer = 0;
    function tipEl() {
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'fsk-tip';
        document.body.appendChild(tip);
      }
      return tip;
    }
    function hide() { if (tip) tip.style.display = 'none'; }
    function show(el, text) {
      const t = tipEl();
      t.textContent = text;
      t.style.display = 'block';
      const r = el.getBoundingClientRect();
      let x = r.left;
      let y = r.bottom + 8;
      if (x + 420 > window.innerWidth - 8) x = Math.max(8, window.innerWidth - 428);
      if (y + 160 > window.innerHeight) y = Math.max(8, r.top - 8 - Math.min(160, t.offsetHeight || 80));
      t.style.left = x + 'px';
      t.style.top = y + 'px';
    }
    document.addEventListener('mouseover', (e) => {
      const el = e.target && e.target.closest && e.target.closest('#fasting-kit [data-tip], #fasting-kit .fsk-info');
      if (!el) return;
      const id = el.getAttribute('data-tip') || (el.previousElementSibling && el.previousElementSibling.id);
      const text = TIPS[id] || TIPS[el.getAttribute('data-tip')];
      if (!text) return;
      clearTimeout(timer);
      timer = setTimeout(() => show(el, text), 400);
    });
    document.addEventListener('mouseout', (e) => {
      const el = e.target && e.target.closest && e.target.closest('#fasting-kit [data-tip], #fasting-kit .fsk-info, #fsk-tip');
      if (!el) { clearTimeout(timer); hide(); }
    });
  }

  function bind(id, key, isNum) {
    const el = panel.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (isNum) CFG[key] = Math.max(0, Math.min(20, Math.floor(Number(el.value) || 0)));
      else CFG[key] = !!el.checked;
      if (key === 'enabled') {
        CFG.userOff = !CFG.enabled;
        if (CFG.enabled) log('已手动开启');
        else log('已手动关闭，本局禁食不再自动开');
      }
      saveCfg();
      tick();
    });
  }

  function ensurePanel() {
    injectStyle();
    installTips();
    const existing = document.getElementById('fasting-kit');
    if (existing && panel && existing === panel && panel.isConnected) {
      placePanel();
      return;
    }
    if (existing && existing !== panel) existing.remove();
    panel = document.createElement('div');
    panel.id = 'fasting-kit';
    if (localStorage.getItem(COLLAPSE_KEY) === '1') panel.classList.add('fsk-collapsed');
    panel.innerHTML =
      '<div class="fsk-title" role="button" aria-expanded="true"><span class="fsk-caret">▾</span>禁食工具箱 v' + VERSION + ' <span class="fsk-sub">禁食剧情专用</span></div>' +
      '<div id="fsk-stats" class="fsk-stats"></div>' +
      '<div class="fsk-card"><b>开关</b><div class="fsk-row">' +
        '<label data-tip="fsk-enabled"><input id="fsk-enabled" type="checkbox">启用</label><span class="fsk-info" data-tip="fsk-enabled">?</span>' +
        '<label data-tip="fsk-autostart"><input id="fsk-autostart" type="checkbox">禁食时自动开启</label><span class="fsk-info" data-tip="fsk-autostart">?</span>' +
        '<label data-tip="fsk-immortal"><input id="fsk-immortal" type="checkbox">保住不死</label><span class="fsk-info" data-tip="fsk-immortal">?</span>' +
        '<label data-tip="fsk-reserve"><input id="fsk-reserve" type="checkbox">按人口上限预留</label><span class="fsk-info" data-tip="fsk-reserve">?</span>' +
        '<label data-tip="fsk-goal"><input id="fsk-goal" type="checkbox">按 1200 人口预留</label><span class="fsk-info" data-tip="fsk-goal">?</span>' +
        '<label data-tip="fsk-dish"><input id="fsk-dish" type="checkbox">管理血湖烹饪</label><span class="fsk-info" data-tip="fsk-dish">?</span>' +
        '<label data-tip="fsk-infuser"><input id="fsk-infuser" type="checkbox">允许生命灌注器</label><span class="fsk-info" data-tip="fsk-infuser">?</span>' +
        '<label data-tip="fsk-reset"><input id="fsk-reset" type="checkbox">煮完自动重置</label><span class="fsk-info" data-tip="fsk-reset">?</span>' +
        '<label data-tip="fsk-buffer">余量 <input id="fsk-buffer" type="number" min="0" max="20" step="1"></label><span class="fsk-info" data-tip="fsk-buffer">?</span>' +
      '</div></div>' +
      '<div id="fsk-log" class="fsk-log"></div>';
    statsEl = panel.querySelector('#fsk-stats');
    logEl = panel.querySelector('#fsk-log');
    logEl.textContent = logs.join('\n');
    panel.querySelector('.fsk-title').addEventListener('click', () => {
      panel.classList.toggle('fsk-collapsed');
      try { localStorage.setItem(COLLAPSE_KEY, panel.classList.contains('fsk-collapsed') ? '1' : '0'); } catch (e) {}
    });
    bind('fsk-enabled', 'enabled');
    bind('fsk-autostart', 'autoStart');
    bind('fsk-immortal', 'immortal');
    bind('fsk-reserve', 'reserveForCap');
    bind('fsk-goal', 'aimCitizenGoal');
    bind('fsk-dish', 'autoDish');
    bind('fsk-infuser', 'allowInfuser');
    bind('fsk-reset', 'autoReset');
    bind('fsk-buffer', 'buffer', true);
    placePanel();
    syncInputs();
  }

  function placePanel() {
    if (!panel) return;
    const jobs = document.getElementById('jobs');
    let parent = null;
    let before = null;
    if (jobs && jobs.parentNode) {
      parent = jobs.parentNode;
      before = jobs;
    } else {
      const civ = document.getElementById('civics');
      if (civ) { parent = civ; before = civ.firstChild; }
    }
    if (!parent) {
      const main = document.getElementById('mainColumn') || document.getElementById('main');
      if (main) { parent = main; before = main.firstChild; }
    }
    if (!parent) return;
    if (panel.parentNode !== parent || (before && panel.nextElementSibling !== before && panel !== before)) {
      const active = document.activeElement;
      const keep = active && panel.contains(active);
      parent.insertBefore(panel, before);
      if (keep && active && typeof active.focus === 'function') {
        try { active.focus({ preventScroll: true }); } catch (e) {}
      }
    }
    document.querySelectorAll('#fasting-kit').forEach((d) => { if (d !== panel) d.remove(); });
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    ensurePanel();
    tick();
    setInterval(tick, 500);
    let placeTimer = 0;
    const mo = new MutationObserver(() => {
      if (placeTimer) return;
      placeTimer = setTimeout(() => { placeTimer = 0; placePanel(); }, 200);
    });
    try { mo.observe(document.body, { childList: true, subtree: false }); } catch (e) {}
    const civ = document.getElementById('civics') || document.getElementById('mainColumn') || document.body;
    try { mo.observe(civ, { childList: true, subtree: true }); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
  else setTimeout(start, 500);
})();
