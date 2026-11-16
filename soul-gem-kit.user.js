// ==UserScript==
// @name         尖塔灵魂石工具箱
// @namespace    evolve-soul-gem-kit
// @version      1.2.1
// @description  爬塔时临时开启：引诱装置开满、军人船员尽量压到 0，士兵移入地狱多派巡逻，以尽量提高灵魂宝石掉率；可适时建造灵魂宝石三件套（默认关），并可关闭已有掠食者无人机以免抢巡逻掉宝。优先于主脚本的地狱/舰队船员控制，关闭后还原。不干扰绯绯色金转补给。
// @author       VPS探针开发
// @match        https://g8hh.github.io/evolve/
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/**
 * Pure planner for 尖塔灵魂石工具箱.
 * No DOM, no Vue, no localStorage. Used by unit tests and (copied into) the userscript.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoulGemKitPlan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clampInt(n, lo, hi) {
    n = Math.floor(Number(n) || 0);
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }

  function soldiersForRating(armyRating, target, wounded) {
    target = Math.max(0, Number(target) || 0);
    wounded = Math.max(0, Number(wounded) || 0);
    if (target <= 0) return 1;
    if (typeof armyRating !== 'function') return Math.max(1, Math.ceil(target));
    if (armyRating(1, wounded) >= target) return 1;
    let lo = 1, hi = 1;
    while (hi < 200000 && armyRating(hi, wounded) < target) {
      lo = hi;
      hi = hi * 2;
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (armyRating(mid, wounded) >= target) hi = mid;
      else lo = mid + 1;
    }
    return Math.max(1, lo);
  }

  function packRange(threat) {
    const t = Math.max(0, Number(threat) || 0);
    return {
      low: Math.max(1, Math.floor(t / 50)),
      mid: Math.max(1, Math.floor(t / 20)),
      high: Math.max(1, Math.floor(t / 10))
    };
  }

  function neededDefenseRating(state, cfg) {
    const threat = Math.max(0, Number(state.threat) || 0);
    const walls = Math.max(0, Math.min(100, Number(state.walls) || 0));
    const turret = Math.max(0, Number(state.turretPower) || 0);
    const targetDmg = Math.max(1, Number(cfg && cfg.siegeTargetDamage) || 100);
    const lowMulti = Math.max(1, Number(cfg && cfg.lowWallsMulti) || 3);
    // 城墙完好时也留一点底，避免第一次围城把墙打穿；墙越残，预留越高。
    const wallFactor = 0.25 + lowMulti * (1 - walls / 100);
    const raw = threat * 35 / targetDmg * wallFactor;
    return Math.max(0, raw - turret);
  }

  function expectedPatrolChances(size, patrols, state) {
    const threat = Math.max(0, Number(state.threat) || 0);
    const div = Math.max(5, 35 - Math.floor((Number(state.attractorOn) || 0) / 3));
    const packs = packRange(threat);
    const meanDemons = (packs.low + packs.high) / 2;
    const pEnc = threat / (threat + 999);
    const pFight = 29 / 30;
    const droids = Math.max(0, Math.floor(Number(state.warDroidOn) || 0));
    const droidBonus = Math.max(0, Math.floor(Number(state.droidBonusSoldiers) || 0));
    const woundedPer = Math.max(0, Number(state.woundedPerPatrol) || 0);
    const rate = state.armyRating;
    let sum = 0;
    for (let i = 0; i < patrols; i++) {
      const bonus = i < droids ? droidBonus : 0;
      const rating = typeof rate === 'function' ? rate(size + bonus, woundedPer) : (size + bonus);
      const kills = Math.min(Math.max(0, rating), meanDemons);
      const chances = kills > 0 ? Math.round(kills / div) : 0;
      sum += pEnc * pFight * chances;
    }
    return sum;
  }

  function planPatrol(state, cfg) {
    cfg = cfg || {};
    state = state || {};
    const armyRating = typeof state.armyRating === 'function'
      ? state.armyRating
      : function (n) { return Math.max(0, n); };

    const workers = Math.max(0, Math.floor(Number(state.workers) || 0));
    const maxSoldiers = Math.max(workers, Math.floor(Number(state.max) || 0));
    const wounded = Math.max(0, Math.floor(Number(state.wounded) || 0));
    const reservedCrew = Math.max(0, Math.floor(Number(state.reservedCrew) || 0));
    const homeReserve = Math.max(0, Math.floor(Number(cfg.homeReserve) || 0));
    const threat = Math.max(0, Number(state.threat) || 0);
    const walls = Math.max(0, Math.min(100, Number(state.walls) || 0));
    const fillRatio = workers / Math.max(1, maxSoldiers);
    const woundedRatio = wounded / Math.max(1, workers);
    const threatTarget = Math.max(100, Number(cfg.threatTarget) || 1200);
    const minSizeCfg = Math.max(0, Math.floor(Number(cfg.minPatrolSize) || 0));

    const forge = (state.soulForgeOn && !state.warlord) ? Math.max(0, Math.floor(Number(state.soulForgeNeeded) || 0)) : 0;
    const guards = Math.max(0, Math.floor(Number(state.guardPostSoldiers) || 0));
    const fixedReserve = forge + guards;

    let maxHell = Math.max(0, workers - reservedCrew - homeReserve);
    const reason = [];

    if (state.warlord) {
      return {
        garrison: 0, patrols: 0, patrol_size: 1, forge, guards, defense: 0,
        available: 0, skipped: 'warlord', reason: ['军阀种族：不改驻军与巡逻']
      };
    }

    let defRating = neededDefenseRating(state, cfg);
    if (walls < 25) defRating *= 1.5;
    let defenseSoldiers = soldiersForRating(armyRating, defRating, 0);
    if (defRating <= 0) defenseSoldiers = 0;
    if (walls >= 90 && defRating <= (Number(state.turretPower) || 0)) defenseSoldiers = 0;

    // 兵力不足或伤员偏多时，加大编制、多留城防，避免巡逻团被吃光后崩盘。
    const highThreat = threat >= 2000;
    const badShape = fillRatio < 0.7 || woundedRatio > 0.25 || walls < 40;
    if (walls < 50) {
      const half = Math.floor(Math.max(0, maxHell - fixedReserve) / 2);
      defenseSoldiers = Math.max(defenseSoldiers, Math.min(half, defenseSoldiers || half));
    }

    let available = maxHell - fixedReserve - defenseSoldiers;
    if (available < 1) {
      if (walls < 50) {
        const keep = Math.max(0, Math.min(defenseSoldiers, Math.floor(Math.max(0, maxHell - fixedReserve) / 2)));
        defenseSoldiers = keep;
        available = Math.max(0, maxHell - fixedReserve - defenseSoldiers);
        reason.push('城墙偏低，优先预留城防与熔炉');
      } else {
        defenseSoldiers = 0;
        available = Math.max(0, maxHell - fixedReserve);
      }
    }

    const packs = packRange(threat);
    let targetPack = packs.mid;
    if (highThreat || badShape) targetPack = packs.high;
    else if (threat > threatTarget * 1.25) targetPack = Math.floor((packs.mid + packs.high) / 2);

    const woundedPer = available > 0 && wounded > Math.max(0, workers - maxHell)
      ? (wounded - Math.max(0, workers - maxHell)) / Math.max(1, Math.floor(available / Math.max(1, minSizeCfg || 2)))
      : 0;
    state.woundedPerPatrol = woundedPer;

    const minSafe = soldiersForRating(armyRating, targetPack, woundedPer);
    let minSize = minSizeCfg > 0 ? minSizeCfg : (highThreat || badShape ? minSafe : 1);
    minSize = Math.max(1, minSize);
    if (available < 1) {
      const garrison = Math.min(maxHell, fixedReserve + defenseSoldiers);
      return {
        garrison, patrols: 0, patrol_size: Math.max(1, minSize),
        forge, guards, defense: Math.max(0, garrison - fixedReserve),
        available: 0, expectedChances: 0, targetPack, minSize,
        reason: reason.concat(['没有可派出的巡逻兵力'])
      };
    }

    minSize = Math.min(minSize, available);
    let best = { size: minSize, patrols: Math.floor(available / minSize), ev: -1 };
    const maxTry = available;
    for (let size = minSize; size <= maxTry; size++) {
      const patrols = Math.floor(available / size);
      if (patrols < 1) break;
      // 绝大多数巡逻（无机器人加成）也要打得过目标魔潮；否则跳过过小编制。
      const bare = armyRating(size, woundedPer);
      if (bare < targetPack * 0.8 && size < minSafe) continue;
      const ev = expectedPatrolChances(size, patrols, state);
      if (ev > best.ev + 1e-9 || (Math.abs(ev - best.ev) <= 1e-9 && patrols > best.patrols)) {
        best = { size, patrols, ev };
      }
    }
    if (best.ev < 0) {
      best.size = Math.min(Math.max(minSize, minSafe), available);
      best.patrols = Math.floor(available / best.size);
      best.ev = expectedPatrolChances(best.size, best.patrols, state);
    }

    const usedPatrol = best.patrols * best.size;
    const leftover = available - usedPatrol;
    const defense = defenseSoldiers + leftover;
    const garrison = Math.min(maxHell, usedPatrol + fixedReserve + defense);
    // 最终硬约束：巡逻总人数不超过驻军，熔炉编制不被挤掉。
    let patrols = best.patrols;
    let size = Math.max(1, best.size);
    if (patrols * size + fixedReserve > garrison) {
      patrols = Math.floor(Math.max(0, garrison - fixedReserve) / size);
    }
    if (patrols * size > garrison) {
      patrols = Math.floor(garrison / size);
    }

    reason.push(highThreat || badShape ? '高威胁或战损偏高，使用较大编制' : '威胁接近目标，尽量增加巡逻队数');

    return {
      garrison,
      patrols,
      patrol_size: size,
      forge,
      guards,
      defense: garrison - patrols * size - fixedReserve,
      available,
      expectedChances: expectedPatrolChances(size, patrols, state),
      targetPack,
      minSize,
      maxHell,
      reservedCrew,
      homeReserve,
      reason
    };
  }

  function applyOrder(current, target) {
    const cur = {
      garrison: Math.max(0, Math.floor(Number(current.garrison) || 0)),
      patrols: Math.max(0, Math.floor(Number(current.patrols) || 0)),
      patrol_size: Math.max(1, Math.floor(Number(current.patrol_size) || 1))
    };
    const tgt = {
      garrison: Math.max(0, Math.floor(Number(target.garrison) || 0)),
      patrols: Math.max(0, Math.floor(Number(target.patrols) || 0)),
      patrol_size: Math.max(1, Math.floor(Number(target.patrol_size) || 1))
    };
    const steps = [];
    let size = cur.patrol_size, patrols = cur.patrols, garrison = cur.garrison;
    if (size > tgt.patrol_size) { size = tgt.patrol_size; steps.push('size-down'); }
    if (patrols > tgt.patrols) { patrols = tgt.patrols; steps.push('patrols-down'); }
    if (garrison !== tgt.garrison) { garrison = tgt.garrison; steps.push('garrison'); }
    if (size < tgt.patrol_size) { size = tgt.patrol_size; steps.push('size-up'); }
    if (patrols < tgt.patrols) { patrols = tgt.patrols; steps.push('patrols-up'); }
    if (patrols * size > garrison) {
      patrols = Math.floor(garrison / Math.max(1, size));
      steps.push('clamp');
    }
    return { garrison, patrols, patrol_size: size, steps };
  }

  function isClimbingSpire(sp) {
    if (!sp || typeof sp.count !== 'number') return false;
    return (Number(sp.progress) || 0) > 0 || sp.count > 1;
  }

  // autoStart && not already on && actually climbing && not dismissed on this same floor
  function shouldAutoEnable(opts) {
    opts = opts || {};
    if (!opts.autoStart || opts.enabled) return false;
    if (!isClimbingSpire(opts.spire)) return false;
    const floor = opts.spire.count;
    if (opts.manualOffFloor != null && opts.manualOffFloor === floor) return false;
    return true;
  }

  // leftover (city.power) is MW after the replicator absorbs surplus, NOT total generation.
  // Available for attractors = leftover + replicator.pow. Do not shut attractors just because leftover is briefly negative.
  function planAttractorOn(state) {
    state = state || {};
    const count = Math.max(0, Math.floor(Number(state.count) || 0));
    const cur = Math.max(0, Math.min(count, Math.floor(Number(state.on) || 0)));
    const cost = Math.max(0, Number(state.cost) || 3);
    const hasLeftover = state.power != null && Number.isFinite(Number(state.power));
    const leftover = hasLeftover ? Number(state.power) : null;
    const hasRepl = state.replicatorPow != null && Number.isFinite(Number(state.replicatorPow));
    const repl = hasRepl ? Math.max(0, Number(state.replicatorPow)) : 0;
    const buffer = Math.max(0, Number(state.buffer != null ? state.buffer : 5));
    if (!count) {
      return { on: 0, current: cur, count: 0, drain: 0, powerLimited: false, leftover: leftover, replicatorPow: repl, cost: cost, avail: (leftover == null ? repl : leftover + repl) };
    }
    if (!hasLeftover && !hasRepl) {
      return { on: count, current: cur, count: count, drain: 0, powerLimited: false, leftover: leftover, replicatorPow: repl, cost: cost, avail: null, reason: 'unknown-power' };
    }
    const left = leftover == null ? 0 : leftover;
    const avail = left + repl;
    let want;
    if (cost <= 0) {
      want = count;
    } else if (avail - buffer >= (count - cur) * cost) {
      want = count;
    } else if (avail >= buffer || avail >= 0) {
      const maxExtra = Math.floor(Math.max(0, avail - buffer) / cost);
      want = Math.min(count, cur + maxExtra);
    } else {
      const short = buffer - avail;
      const off = Math.ceil(short / cost);
      want = Math.max(0, cur - off);
    }
    const extra = Math.max(0, want - cur);
    const deficitCover = left < buffer ? Math.max(0, buffer - left) : 0;
    const drain = Math.min(repl, extra * cost + deficitCover);
    return {
      on: want, current: cur, count: count, drain: drain,
      powerLimited: want < count, leftover: left, replicatorPow: repl,
      cost: cost, avail: avail, buffer: buffer
    };
  }

  function encounterProb(threat) {
    const t = Math.max(0, Number(threat) || 0);
    return t / (t + 999);
  }

  function packMean(threat) {
    const p = packRange(threat);
    return (p.low + p.high) / 2;
  }

  function droneAvgDamage(portalTech) {
    return (Number(portalTech) || 0) >= 7 ? 87.5 : 50;
  }

  function expectedDronePass(n, threat, portalTech) {
    let t = Math.max(0, Number(threat) || 0);
    let killed = 0;
    const dmg = droneAvgDamage(portalTech);
    const drones = Math.max(0, Math.floor(Number(n) || 0));
    for (let i = 0; i < drones; i++) {
      const pe = encounterProb(t);
      const pack = packMean(t);
      const k = pe * Math.min(dmg, pack);
      killed += k;
      t = Math.max(0, t - k);
    }
    return { killed: killed, threatAfter: t };
  }

  function simulatePatrolSoak(state, override) {
    state = state || {};
    override = override || {};
    const P = Math.max(0, Math.floor(Number(state.patrols) || 0));
    const S = Math.max(1, Math.floor(Number(state.patrol_size) || 1));
    const droids = Math.max(0, Math.floor(Number(override.droids != null ? override.droids : (state.warDroidOn || 0))));
    const drones = Math.max(0, Math.floor(Number(override.drones != null ? override.drones : (state.warDroneOn || 0))));
    const bonus = Math.max(0, Math.floor(Number(state.droidBonusSoldiers != null ? state.droidBonusSoldiers : 1)));
    const rate = typeof state.armyRating === 'function' ? state.armyRating : function (n) { return Math.max(0, n); };
    const woundedPer = Math.max(0, Number(state.woundedPerPatrol) || 0);
    const startThreat = Math.max(0, Number(state.threat) || 0);
    const droneSim = expectedDronePass(drones, startThreat, state.portalTech || 0);
    let t = droneSim.threatAfter;
    let patrolKills = 0;
    let demonsFaced = 0;
    let underRated = 0;
    for (let i = 0; i < P; i++) {
      const size = S + (i < droids ? bonus : 0);
      const rating = Math.max(0, Number(rate(size, woundedPer)) || 0);
      const typ = packRange(t).high;
      if (rating + 1e-9 < typ) underRated++;
      const pe = encounterProb(t);
      const pack = packMean(t);
      demonsFaced += pe * pack;
      const k = pe * Math.min(rating, pack);
      patrolKills += k;
      t = Math.max(0, t - k);
    }
    const soakRatio = demonsFaced > 1e-6 ? patrolKills / demonsFaced : 1;
    const leftoverFrac = startThreat > 1e-6 ? t / startThreat : 0;
    const overkill = soakRatio >= 0.95 && t <= Math.max(10, startThreat * 0.05);
    const underSoak = soakRatio < 0.8 || t > Math.max(50, startThreat * 0.25);
    return {
      patrolKills: patrolKills,
      demonsFaced: demonsFaced,
      leftoverThreat: t,
      soakRatio: soakRatio,
      leftoverFrac: leftoverFrac,
      overkill: overkill,
      underSoak: underSoak,
      underRated: underRated,
      threatAfterDrones: droneSim.threatAfter,
      droneKills: droneSim.killed,
      startThreat: startThreat,
      droids: droids,
      drones: drones
    };
  }

  function structCount(state, onKey, countKey) {
    const count = state[countKey];
    const on = state[onKey];
    if (count != null && Number.isFinite(Number(count))) return Math.max(0, Math.floor(Number(count)));
    return Math.max(0, Math.floor(Number(on) || 0));
  }

  function planTrioCaps(state, cfg) {
    state = state || {};
    cfg = cfg || {};
    const gemReserve = Math.max(0, Math.floor(Number(cfg.gemReserve != null ? cfg.gemReserve : 50)));
    const droneHardCap = Math.max(0, Math.floor(Number(cfg.droneHardCap != null ? cfg.droneHardCap : 20)));
    const repairSoftCap = Math.max(0, Math.floor(Number(cfg.repairSoftCap != null ? cfg.repairSoftCap : 30)));
    const wallsHigh = Math.max(0, Math.min(100, Number(cfg.wallsHigh != null ? cfg.wallsHigh : 90)));
    const defenseExtra = Math.max(0, Math.floor(Number(cfg.defenseExtra != null ? cfg.defenseExtra : 3)));
    const shutdownDrones = cfg.shutdownDrones != null ? !!cfg.shutdownDrones : true;
    const gems = Math.max(0, Number(state.soulGems != null ? state.soulGems : 0));
    const gemsOk = gems >= gemReserve + 1;
    const walls = Math.max(0, Math.min(100, Number(state.walls != null ? state.walls : 100)));
    const wallsFalling = !!state.wallsFalling || (Number(state.wallsTrend) || 0) < 0;
    const carportDamaged = Math.max(0, Number(state.carportDamaged) || 0);
    const inferniteDiff = Number(state.inferniteDiff);
    const inferniteOk = !Number.isFinite(inferniteDiff) || inferniteDiff >= 0;
    const patrols = Math.max(0, Math.floor(Number(state.patrols) || 0));
    const droidCur = structCount(state, 'warDroidOn', 'warDroidCount');
    const repairCur = structCount(state, 'repairDroidOn', 'repairDroidCount');
    const droneCur = structCount(state, 'warDroneOn', 'warDroneCount');
    const droneOnNow = Math.max(0, Math.floor(Number(state.warDroneOn != null ? state.warDroneOn : droneCur)));
    const backupOn = Math.max(0, Math.floor(Number(state.warDroneBackupOn != null ? state.warDroneBackupOn : droneOnNow)));
    const wallsAtRisk = walls < wallsHigh || wallsFalling || carportDamaged > 0;

    function item(current, cap, want, reason, extra) {
      const out = { current: current, cap: cap, want: want, reason: reason };
      if (extra) Object.keys(extra).forEach((k) => { out[k] = extra[k]; });
      return out;
    }

    if (state.warlord) {
      return {
        war_droid: item(droidCur, droidCur, 0, 'warlord'),
        repair_droid: item(repairCur, repairCur, 0, 'warlord'),
        war_drone: item(droneCur, droneCur, 0, 'warlord', { wantOn: droneOnNow, restoreOn: backupOn, shutdown: false }),
        next: null,
        soak: simulatePatrolSoak(state),
        gemReserve: gemReserve,
        shutdownDrones: shutdownDrones
      };
    }

    const soakNow = simulatePatrolSoak(state, {
      droids: droidCur,
      drones: shutdownDrones ? 0 : droneOnNow
    });

    let droidCap = droidCur;
    let droidReason = 'already-soaked';
    if (soakNow.overkill) {
      droidCap = droidCur;
      droidReason = 'already-soaked';
    } else {
      let best = droidCur;
      const maxD = Math.max(droidCur, patrols);
      for (let d = droidCur + 1; d <= maxD; d++) {
        const prev = simulatePatrolSoak(state, { droids: d - 1, drones: shutdownDrones ? 0 : droneOnNow });
        const cur = simulatePatrolSoak(state, { droids: d, drones: shutdownDrones ? 0 : droneOnNow });
        if (cur.patrolKills > prev.patrolKills + 1e-6) {
          best = d;
          if (cur.overkill) break;
        } else {
          break;
        }
      }
      if (best > droidCur) {
        droidCap = best;
        droidReason = 'raise-gem-ev';
      } else {
        droidCap = droidCur;
        droidReason = soakNow.underRated > 0 ? 'no-gem-ev-gain' : 'patrols-already-rated';
      }
    }

    const leftoverGar = Math.max(0,
      (Number(state.garrison) || 0)
      - patrols * Math.max(1, Number(state.patrol_size) || 1)
      - (Number(state.soulForgeNeeded) || 0)
    );
    if (wallsAtRisk && walls < 50 && leftoverGar <= 0 && defenseExtra > 0) {
      const defenseTarget = Math.max(droidCap, Math.max(droidCur, Math.min(patrols + defenseExtra, droidCur + defenseExtra)));
      if (defenseTarget > droidCap) {
        droidCap = defenseTarget;
        droidReason = 'walls-defense';
      }
    }

    let droneCap = droneCur;
    let droneReason = 'already-soaked';
    let wantOn = droneOnNow;
    let restoreOn = Math.min(droneCur, backupOn);
    if (shutdownDrones) {
      droneCap = 0;
      droneReason = 'shutdown';
      wantOn = 0;
    } else {
      wantOn = restoreOn;
      const soakIfDroidsBuilt = simulatePatrolSoak(state, { droids: droidCap, drones: droneOnNow });
      if (!soakIfDroidsBuilt.underSoak || soakIfDroidsBuilt.overkill) {
        droneCap = droneCur;
        droneReason = soakIfDroidsBuilt.overkill ? 'already-soaked' : 'patrols-absorb';
      } else {
        let best = droneCur;
        const hard = Math.max(droneCur, droneHardCap);
        for (let n = droneCur + 1; n <= hard; n++) {
          const prev = simulatePatrolSoak(state, { droids: droidCap, drones: n - 1 });
          const cur = simulatePatrolSoak(state, { droids: droidCap, drones: n });
          const improved = cur.leftoverThreat < prev.leftoverThreat - 1e-6 || cur.soakRatio > prev.soakRatio + 1e-6;
          if (improved) {
            best = n;
            if (!cur.underSoak || cur.overkill) break;
          } else {
            break;
          }
        }
        if (best > droneCur) {
          droneCap = best;
          droneReason = 'patrols-undersoak';
        } else {
          droneCap = droneCur;
          droneReason = 'drone-no-help';
        }
      }
    }

    let repairCap = repairCur;
    let repairReason = 'walls-stable';
    if (wallsAtRisk) {
      repairCap = Math.max(repairCur, repairSoftCap);
      repairReason = carportDamaged > 0 ? 'carport-damaged' : (wallsFalling ? 'walls-falling' : 'walls-low');
    } else {
      repairCap = repairCur;
      repairReason = 'walls-stable';
    }

    function wantFor(cur, cap, blocked) {
      if (cur >= cap) return 0;
      if (!gemsOk) return 0;
      if (blocked) return 0;
      return 1;
    }
    const droidWant = wantFor(droidCur, droidCap, false);
    const repairWant = wantFor(repairCur, repairCap, !inferniteOk);
    const droneWant = wantFor(droneCur, droneCap, shutdownDrones);

    let droidReasonFinal = droidReason;
    let repairReasonFinal = repairReason;
    let droneReasonFinal = droneReason;
    if (!gemsOk && droidCur < droidCap) droidReasonFinal = 'gem-reserve';
    if (!gemsOk && repairCur < repairCap && inferniteOk) repairReasonFinal = 'gem-reserve';
    if (repairCur < repairCap && !inferniteOk) repairReasonFinal = 'infernite-net';
    if (!gemsOk && droneCur < droneCap && !shutdownDrones) droneReasonFinal = 'gem-reserve';

    let next = null;
    if (repairWant && wallsAtRisk) next = 'repair_droid';
    else if (droidWant) next = 'war_droid';
    else if (droneWant) next = 'war_drone';
    else if (repairWant) next = 'repair_droid';

    return {
      war_droid: item(droidCur, droidCap, droidWant, droidReasonFinal),
      repair_droid: item(repairCur, repairCap, repairWant, repairReasonFinal),
      war_drone: item(droneCur, droneCap, droneWant, droneReasonFinal, {
        wantOn: wantOn,
        restoreOn: restoreOn,
        shutdown: shutdownDrones
      }),
      next: next,
      soak: soakNow,
      gemReserve: gemReserve,
      gemsOk: gemsOk,
      wallsAtRisk: wallsAtRisk,
      shutdownDrones: shutdownDrones
    };
  }

  const UNTOUCHABLE_SHIPS = ['bireme'];

  function isUntouchableShip(name) {
    return UNTOUCHABLE_SHIPS.indexOf(name) >= 0;
  }

  // All built biremes stay on. Never emit a reduce/off/toggle step.
  // Only write when current .on is below the required count (power back up).
  function planBiremePower(state) {
    state = state || {};
    function one(on, count) {
      const c = Math.max(0, Math.floor(Number(count) || 0));
      const o = Math.max(0, Math.floor(Number(on) || 0));
      const want = c;
      return { on: o, count: c, want: want, write: o < want, reduced: false };
    }
    const portal = one(state.biremeOn, state.biremeCount);
    const hasGalaxy = state.galaxyBiremeOn != null || state.galaxyBiremeCount != null;
    const galaxy = hasGalaxy ? one(state.galaxyBiremeOn, state.galaxyBiremeCount) : null;
    const steps = [];
    if (portal.write) steps.push({ ship: 'bireme', area: 'portal', from: portal.on, to: portal.want });
    if (galaxy && galaxy.write) steps.push({ ship: 'bireme', area: 'galaxy', from: galaxy.on, to: galaxy.want });
    return { portal: portal, galaxy: galaxy, steps: steps, reduced: [] };
  }

  // Compress combat ships toward pipeline floors. bireme is never in the reduce order
  // and never gets an off/toggle/reduce step, even if present in the ship map.
  function planMilShipOns(state) {
    state = state || {};
    const ships = state.ships || {};
    const floors = state.pipelineFloors || {};
    const on = {};
    const reduced = [];
    const steps = [];
    const names = Object.keys(ships);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const cur = Math.max(0, Math.floor(Number(ships[name] && ships[name].on) || 0));
      const count = Math.max(cur, Math.floor(Number(ships[name] && ships[name].count) || 0));
      if (isUntouchableShip(name)) {
        on[name] = cur;
        continue;
      }
      const floor = Math.max(0, Math.min(count, Math.floor(Number(floors[name]) || 0)));
      on[name] = floor;
      if (floor < cur) {
        reduced.push(name);
        steps.push({ ship: name, from: cur, to: floor });
      }
    }
    return { on: on, reduced: reduced, steps: steps };
  }

  function biremeReservedCrew(state) {
    state = state || {};
    const mil = Math.max(1, Math.floor(Number(state.biremeMil != null ? state.biremeMil : 2)));
    const portalCount = Math.max(0, Math.floor(Number(state.biremeCount != null ? state.biremeCount : state.biremeOn) || 0));
    const galaxyCount = Math.max(0, Math.floor(Number(state.galaxyBiremeCount != null ? state.galaxyBiremeCount : state.galaxyBiremeOn) || 0));
    return (portalCount + galaxyCount) * mil;
  }


  // 折叠的建筑设置段需要先点开才能出现 input.script_bld_s_*，设完后若原来是收起的要再收起来。
  function planSettingsSectionAccess(state) {
    state = state || {};
    const hasCheckbox = !!state.hasCheckbox;
    const hasTrigger = !!state.hasTrigger;
    const isOpen = !!state.isOpen;
    if (hasCheckbox) {
      return { ready: true, clickToOpen: false, recollapseAfter: false };
    }
    if (!hasTrigger) {
      return { ready: false, clickToOpen: false, recollapseAfter: false, retry: true };
    }
    if (isOpen) {
      return { ready: false, clickToOpen: false, recollapseAfter: false, retry: true };
    }
    return { ready: false, clickToOpen: true, recollapseAfter: true, retry: true };
  }

  return {
    clampInt,
    soldiersForRating,
    packRange,
    neededDefenseRating,
    expectedPatrolChances,
    planPatrol,
    applyOrder,
    isClimbingSpire,
    shouldAutoEnable,
    planAttractorOn,
    encounterProb,
    packMean,
    simulatePatrolSoak,
    planTrioCaps,
    UNTOUCHABLE_SHIPS,
    isUntouchableShip,
    planBiremePower,
    planMilShipOns,
    biremeReservedCrew,
    planSettingsSectionAccess
  };
});
(function () {
  'use strict';

  const SETTINGS_KEY = 'sgk-settings';
  const COLLAPSE_KEY = 'sgk-collapsed';
  const VOLLCH_BACKUP_KEY = 'sgk-vollch-backup';
  const DRONE_BACKUP_KEY = 'sgk-wardrone-backup';
  const ARMADA = ['scout_ship', 'corvette_ship', 'frigate_ship', 'cruiser_ship', 'dreadnought'];
  const MIL_SHIPS = ARMADA.concat(['armed_miner', 'minelayer', 'raider']);
  const REGIONS = ['gxy_stargate', 'gxy_gateway', 'gxy_gorddon', 'gxy_alien1', 'gxy_alien2', 'gxy_chthonian'];
  const PIRATE_FIXED = { gxy_gorddon: [800, 720], gxy_alien1: [1000, 900], gxy_alien2: [2500, 2250], gxy_chthonian: [7500, 7000] };
  const PILLAGE = { gxy_stargate: 0.5, gxy_gateway: 1, gxy_gorddon: 0.75, gxy_alien1: 0.75, gxy_alien2: 1, gxy_chthonian: 1 };
  const ZH_SHIP = { scout_ship: '侦察舰', corvette_ship: '护卫舰', frigate_ship: '护航舰', cruiser_ship: '巡洋舰', dreadnought: '无畏舰', armed_miner: '武装矿船', minelayer: '布雷舰', raider: '掠夺舰' };
  const ZH_REGION = { gxy_stargate: '星门', gxy_gateway: '门户', gxy_gorddon: '戈尔登', gxy_alien1: '同盟星系', gxy_alien2: '敌对星系', gxy_chthonian: '冥王星带' };

  const DEFAULTS = {
    enabled: false,
    autoStartClimb: true,
    compressCrew: true,
    reserveCrew: -1,
    homeReserve: 0,
    threatTarget: 1200,
    minPatrolSize: 0,
    autoAttractor: true,
    hireMercs: false,
    autoTrio: false,
    gemReserve: 50,
    shutdownDrones: true,
    manualOffFloor: null
  };
  const PROTECTED_SHIPS = ['bireme', 'transport'];
  const SUPPLY_PIPE_FLAGS = [
    'autoSupply', 'autoPower', 'autoBuild', 'masterScriptToggle',
    'buildingsTransportGem'
  ];

  function loadCfg() {
    const cfg = Object.assign({}, DEFAULTS);
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        Object.keys(DEFAULTS).forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] != null) cfg[k] = raw[k];
        });
      }
    } catch (e) {}
    cfg.enabled = !!cfg.enabled;
    cfg.compressCrew = !!cfg.compressCrew;
    cfg.autoAttractor = !!cfg.autoAttractor;
    cfg.hireMercs = !!cfg.hireMercs;
    cfg.reserveCrew = Math.floor(Number(cfg.reserveCrew));
    if (!Number.isFinite(cfg.reserveCrew)) cfg.reserveCrew = -1;
    cfg.homeReserve = Math.max(0, Math.floor(Number(cfg.homeReserve) || 0));
    cfg.threatTarget = Math.max(100, Math.floor(Number(cfg.threatTarget) || 1200));
    cfg.minPatrolSize = Math.max(0, Math.floor(Number(cfg.minPatrolSize) || 0));
    cfg.autoStartClimb = !!cfg.autoStartClimb;
    cfg.autoTrio = !!cfg.autoTrio;
    cfg.shutdownDrones = cfg.shutdownDrones == null ? true : !!cfg.shutdownDrones;
    cfg.gemReserve = Math.max(0, Math.floor(Number(cfg.gemReserve)));
    if (!Number.isFinite(cfg.gemReserve)) cfg.gemReserve = 50;
    if (cfg.manualOffFloor == null || cfg.manualOffFloor === '') cfg.manualOffFloor = null;
    else cfg.manualOffFloor = Math.floor(Number(cfg.manualOffFloor));
    if (!Number.isFinite(cfg.manualOffFloor)) cfg.manualOffFloor = null;
    return cfg;
  }
  function saveCfg() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CFG)); } catch (e) {}
  }
  let CFG = loadCfg();

  const Plan = (typeof SoulGemKitPlan !== 'undefined' && SoulGemKitPlan) ? SoulGemKitPlan : null;

  // ---------- 游戏对象 ----------
  function game() { return window.evolve || window.game || null; }
  function g() {
    const e = game();
    return e && e.global ? e.global : null;
  }
  function getVueById(id) {
    const el = document.getElementById(id);
    return el && el.__vue__ ? el.__vue__ : null;
  }
  function fortVue() { return getVueById('fort') || getVueById('gFort'); }

  let _realGlobal = null;
  function liveSettings() {
    const fv = fortVue();
    if (fv && fv.s) return fv.s;
    if (fv && fv.$data && fv.$data.s) return fv.$data.s;
    const main = document.querySelector('#mainColumn > div');
    if (main && main.__vue__ && main.__vue__.s) return main.__vue__.s;
    const ev = g();
    return ev && ev.settings ? ev.settings : null;
  }
  function liveGalaxyStruct(name) {
    const ids = ['galaxy-' + name, name];
    for (let i = 0; i < ids.length; i++) {
      const vue = getVueById(ids[i]);
      if (vue && vue.act && typeof vue.act.on === 'number') return vue.act;
      if (vue && vue.$data && vue.$data.act && typeof vue.$data.act.on === 'number') return vue.$data.act;
    }
    return null;
  }
  function livePortalStructVue(key) {
    const vue = getVueById('portal-' + key);
    if (vue && vue.act && typeof vue.act.count === 'number') return vue.act;
    if (vue && vue.$data && vue.$data.act && typeof vue.$data.act.count === 'number') return vue.$data.act;
    return null;
  }
  function assembleLiveGlobal() {
    const clone = g() || {};
    const f = (function () {
      const fv = fortVue();
      if (fv && fv.f && typeof fv.f.garrison === 'number') return fv.f;
      if (fv && fv.$data && fv.$data.f && typeof fv.$data.f.garrison === 'number') return fv.$data.f;
      return null;
    })();
    const gar = (function () {
      const fv = fortVue();
      if (fv && fv.g && typeof fv.g.workers === 'number') return fv.g;
      const gv = getVueById('garrison');
      if (gv && gv.g && typeof gv.g.workers === 'number') return gv.g;
      if (gv && typeof gv.workers === 'number') return gv;
      return null;
    })();
    if (!f && !gar) return null;
    const portal = Object.assign({}, clone.portal || {});
    if (f) portal.fortress = f;
    const portalKeys = ['soul_forge','guard_post','war_droid','repair_droid','war_drone','turret','attractor','bireme','transport','infernite_mine','purifier','spire','harbor','port','base_camp'];
    for (let i = 0; i < portalKeys.length; i++) {
      const inst = livePortalStructVue(portalKeys[i]);
      if (inst) portal[portalKeys[i]] = inst;
    }
    const galaxy = Object.assign({}, clone.galaxy || {});
    const shipNames = MIL_SHIPS.concat(['defense_platform', 'starbase', 'foothold']);
    for (let i = 0; i < shipNames.length; i++) {
      const inst = liveGalaxyStruct(shipNames[i]);
      if (inst) galaxy[shipNames[i]] = inst;
    }
    const civic = Object.assign({}, clone.civic || {});
    if (gar) civic.garrison = gar;
    return {
      portal: portal,
      galaxy: galaxy,
      civic: civic,
      city: clone.city,
      resource: clone.resource,
      tech: clone.tech,
      race: clone.race,
      settings: liveSettings() || clone.settings,
      eden: clone.eden,
      space: clone.space,
      interstellar: clone.interstellar,
      stats: clone.stats
    };
  }
  function findRealGlobal() {
    const fv = fortVue();
    const liveF = fv && (fv.f || (fv.$data && fv.$data.f));
    const liveGarFromFort = fv && (fv.g || (fv.$data && fv.$data.g));
    const gv = getVueById('garrison');
    const liveGar = (gv && (gv.g || gv.$data && (gv.$data.g || gv.$data))) || liveGarFromFort;
    if (_realGlobal && _realGlobal.portal && _realGlobal.portal.fortress && liveF && _realGlobal.portal.fortress === liveF) {
      const evg = game() && game().global;
      if (evg && _realGlobal === evg) return _realGlobal;
      // 拼出来的入口要每次刷新军舰/建筑的 Vue 绑定，避免缓存到已卸载的 act。
      const fresh = assembleLiveGlobal();
      if (fresh) { _realGlobal = fresh; return fresh; }
      return _realGlobal;
    }
    const tryG = (obj) => {
      if (!obj || !obj.portal || !obj.portal.fortress) return null;
      if (liveF && obj.portal.fortress === liveF) return obj;
      if (liveGar && obj.civic && obj.civic.garrison === liveGar) return obj;
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
      if (!hit && liveF && v.portal && v.portal.fortress === liveF) hit = v;
      if (hit) { _realGlobal = hit; return hit; }
      if (v.$parent) q.push(v.$parent);
      if (v.$root && v.$root !== v) q.push(v.$root);
      if (v.$children) for (let i = 0; i < v.$children.length; i++) q.push(v.$children[i]);
    }
    // settings.expose 开启时 window.evolve.global 是每帧深拷贝，Vue 树上也挂不到模块级 global。
    // 用堡垒 / 军舰等 Vue 绑定拼可写入口，只读字段（tech / race / 资源速率）可以走克隆。
    hit = assembleLiveGlobal();
    if (hit) { _realGlobal = hit; return hit; }
    return null;
  }

  function liveGlobal() {
    const real = findRealGlobal();
    if (real && real.portal && real.portal.fortress) return real;
    return null;
  }

  function liveFortress() {
    const fv = fortVue();
    if (fv && fv.f && typeof fv.f.garrison === 'number') return fv.f;
    if (fv && fv.$data && fv.$data.f && typeof fv.$data.f.garrison === 'number') return fv.$data.f;
    const real = liveGlobal();
    return real && real.portal ? real.portal.fortress : null;
  }
  function liveGarrison() {
    const fv = fortVue();
    if (fv && fv.g && typeof fv.g.workers === 'number') return fv.g;
    const gv = getVueById('garrison');
    if (gv && gv.g && typeof gv.g.workers === 'number') return gv.g;
    if (gv && typeof gv.workers === 'number') return gv;
    const real = liveGlobal();
    return real && real.civic ? real.civic.garrison : null;
  }
  function liveSoulGem() {
    const el = document.getElementById('resSoul_Gem');
    if (el && el.__vue__ && el.__vue__.$data && typeof el.__vue__.$data.amount === 'number') return el.__vue__.$data;
    const real = liveGlobal() || g();
    return real && real.resource ? real.resource.Soul_Gem : null;
  }
  function livePortalStruct(key) {
    const vueInst = livePortalStructVue(key);
    if (vueInst) return vueInst;
    const real = _realGlobal;
    if (real && real.portal && real.portal[key]) return real.portal[key];
    const glob = g();
    return glob && glob.portal && glob.portal[key] ? glob.portal[key] : null;
  }
  function isExposeCloneStruct(inst, key) {
    if (!inst) return false;
    const ev = g();
    return !!(ev && ev.portal && ev.portal[key] && ev.portal[key] === inst);
  }
  function liveWritablePortalStruct(key) {
    const vueInst = livePortalStructVue(key);
    if (vueInst) return vueInst;
    try {
      const wantId = 'portal-' + key;
      const all = document.querySelectorAll('*');
      const limit = Math.min(all.length, 8000);
      for (let i = 0; i < limit; i++) {
        const v = all[i].__vue__;
        if (!v) continue;
        const act = v.act || (v.$data && v.$data.act);
        if (act && act.id === wantId && typeof act.on === 'number') return act;
      }
    } catch (e) {}
    const inst = livePortalStruct(key);
    if (inst && typeof inst.on === 'number' && !isExposeCloneStruct(inst, key)) return inst;
    return null;
  }
  function isLiveFortress(inst) {
    if (!inst) return false;
    const fv = fortVue();
    if (fv && (fv.f === inst || (fv.$data && fv.$data.f === inst))) return true;
    const real = liveGlobal();
    return !!(real && real.portal && real.portal.fortress === inst);
  }
  function pokeVue() {
    ['fort', 'gFort', 'garrison'].forEach((id) => {
      const v = getVueById(id);
      if (v && typeof v.$forceUpdate === 'function') {
        try { v.$forceUpdate(); } catch (e) {}
      }
    });
  }

  function isEvolveReady() {
    const glob = g() || liveGlobal();
    return !!(glob && glob.portal && glob.portal.fortress && glob.civic && glob.civic.garrison);
  }
  function isWarlord(glob) {
    glob = glob || liveGlobal() || g();
    return !!(glob && glob.race && glob.race.warlord);
  }

  // ---------- 公式辅助 ----------
  function jobScale(n) {
    const ev = game();
    const glob = liveGlobal() || g();
    if (!glob || !glob.race || !glob.race.high_pop) return n;
    try {
      if (ev && ev.traits && ev.traits.high_pop && typeof ev.traits.high_pop.vars === 'function') {
        return n * ev.traits.high_pop.vars()[0];
      }
    } catch (e) {}
    return n;
  }
  function armyRatingFn() {
    const ev = game();
    if (ev && typeof ev.armyRating === 'function') {
      return function (n, w) {
        try { return Math.max(0, Number(ev.armyRating(n, 'hellArmy', w || 0)) || 0); }
        catch (e) { return Math.max(0, n - (w || 0) / 2); }
      };
    }
    return function (n, w) { return Math.max(0, n - (w || 0) / 2); };
  }
  function soulForgeSoldiers() {
    const glob = liveGlobal() || g();
    if (!glob) return 0;
    const base = glob.race && glob.race.warlord ? 400 : 650;
    const guns = livePortalStruct('gun_emplacement');
    const gunOn = guns && typeof guns.on === 'number' ? guns.on : 0;
    const saved = gunOn * (glob.tech && glob.tech.hell_gun >= 2 ? jobScale(2) : jobScale(1));
    const rate = armyRatingFn();
    let avg = Math.max(rate(1, 0), 1);
    let soldiers = Math.ceil(base / avg);
    soldiers = Math.max(0, soldiers - saved);
    if (glob.race && glob.race.hivemind) {
      soldiers = 0;
      while ((soldiers + saved) * avg < base) {
        soldiers++;
        avg = rate(soldiers, 0) / Math.max(1, soldiers);
        avg = Math.max(avg, 1);
        if (soldiers > 10000) break;
      }
    }
    return soldiers;
  }
  function shipAction(name) {
    const ev = game();
    if (!ev || !ev.actions) return null;
    const areas = ['galaxy', 'portal', 'space', 'interstellar'];
    for (let a = 0; a < areas.length; a++) {
      const tree = ev.actions[areas[a]];
      if (!tree) continue;
      for (const region of Object.keys(tree)) {
        if (tree[region] && tree[region][name] && tree[region][name].ship) return tree[region][name];
      }
    }
    return null;
  }
  function portalShipInst(real, name) {
    return real && real.portal && real.portal[name] ? real.portal[name] : null;
  }
  function protectedMilCrew(real) {
    return currentTpCrew(real) + portalProtectedMil(real);
  }
  function relatedRates(real) {
    const out = { Infernite: 0, Supply: 0, cargo: {} };
    if (real && real.resource && real.resource.Infernite) out.Infernite = Number(real.resource.Infernite.diff) || 0;
    if (real && real.portal && real.portal.purifier) out.Supply = Number(real.portal.purifier.diff) || 0;
    const cargo = real && real.portal && real.portal.transport && real.portal.transport.cargo;
    if (cargo) {
      Object.keys(cargo).forEach((k) => {
        if (k === 'used' || k === 'max' || !(cargo[k] > 0)) return;
        if (real.resource && real.resource[k] && typeof real.resource[k].diff === 'number') out.cargo[k] = real.resource[k].diff;
      });
    }
    return out;
  }
  function readSpire(real) {
    const sp = (real && real.portal && real.portal.spire) || livePortalStruct('spire');
    if (!sp || typeof sp.count !== 'number') return null;
    return { count: sp.count, progress: Number(sp.progress) || 0, type: sp.type || '', boss: sp.boss || '' };
  }
  function isClimbingSpire(sp) {
    if (!sp) return false;
    return (Number(sp.progress) || 0) > 0 || sp.count > 1;
  }
  function shipMil(name) {
    try {
      const def = shipAction(name);
      if (def && def.ship && typeof def.ship.mil === 'function') return Math.max(0, Number(def.ship.mil()) || 0);
    } catch (e) {}
    return 0;
  }
  function shipRating(name) {
    try {
      const def = shipAction(name);
      if (def && def.ship && typeof def.ship.rating === 'function') return Math.max(0, Number(def.ship.rating()) || 0);
    } catch (e) {}
    return 0;
  }

  function pirateLevel(glob, region) {
    const instinct = !!(glob.race && glob.race.instinct);
    let pirate = 0;
    if (region === 'gxy_stargate' || region === 'gxy_gateway') {
      const tech = (glob.tech && glob.tech.piracy) || 0;
      pirate = 0.1 * (instinct ? tech * 0.9 : tech);
    } else if (PIRATE_FIXED[region]) {
      pirate = instinct ? PIRATE_FIXED[region][1] : PIRATE_FIXED[region][0];
    }
    try {
      const ev = game();
      if (glob.race && glob.race.chicken && ev && ev.traits && ev.traits.chicken && typeof ev.traits.chicken.vars === 'function') {
        pirate *= 1 + ev.traits.chicken.vars()[1] / 100;
      }
      if (glob.race && glob.race.ocular_power && glob.race.ocularPowerConfig && glob.race.ocularPowerConfig.f
          && ev && ev.traits && ev.traits.ocular_power && typeof ev.traits.ocular_power.vars === 'function') {
        pirate *= 1 - ev.traits.ocular_power.vars()[1] / 500;
      }
    } catch (e) {}
    return pirate;
  }

  function regionArmada(real, region, galOn, defense) {
    let armada = 0;
    const def = defense || (real.galaxy && real.galaxy.defense) || {};
    const assigned = def[region] || {};
    for (let i = 0; i < ARMADA.length; i++) {
      const ship = ARMADA[i];
      armada += (Number(assigned[ship]) || 0) * shipRating(ship);
    }
    const gal = real.galaxy || {};
    const onOf = (key) => {
      if (galOn && galOn[key] != null) return galOn[key];
      const inst = gal[key];
      return inst && typeof inst.on === 'number' ? inst.on : 0;
    };
    if (region === 'gxy_stargate') armada += onOf('defense_platform') * 20;
    if (region === 'gxy_gateway') armada += onOf('starbase') * 25;
    if (region === 'gxy_alien2') {
      armada += onOf('foothold') * 50;
      armada += onOf('armed_miner') * shipRating('armed_miner');
    }
    if (region === 'gxy_chthonian') {
      armada += onOf('minelayer') * shipRating('minelayer');
      armada += onOf('raider') * shipRating('raider');
    }
    return armada;
  }

  function piracyCover(real, region, galOn, defense) {
    if (!real.tech || !real.tech.piracy || (real.race && real.race.truepath)) return 1;
    const pirate = pirateLevel(real, region);
    if (pirate <= 0) return 1;
    const armada = regionArmada(real, region, galOn, defense);
    const pillage = PILLAGE[region] != null ? PILLAGE[region] : 0.75;
    const patrol = armada > pirate ? pirate : armada;
    const local = (1 - (pirate - patrol) / pirate) * pillage + (1 - pillage);
    if (region === 'gxy_stargate') return local;
    return local * piracyCover(real, 'gxy_stargate', galOn, defense);
  }

  function snapshotDefense(real) {
    const out = {};
    const def = (real.galaxy && real.galaxy.defense) || {};
    REGIONS.forEach((r) => {
      out[r] = {};
      ARMADA.forEach((s) => { out[r][s] = Math.max(0, Math.floor(Number(def[r] && def[r][s]) || 0)); });
    });
    return out;
  }
  function snapshotOn(real) {
    const out = {};
    const gal = real.galaxy || {};
    MIL_SHIPS.concat(['defense_platform', 'starbase', 'foothold']).forEach((s) => {
      const inst = gal[s];
      out[s] = inst && typeof inst.on === 'number' ? inst.on : 0;
    });
    ARMADA.forEach((s) => {
      const inst = gal[s];
      if (inst && typeof inst.on === 'number') out[s] = inst.on;
    });
    return out;
  }

  function trimDefenseToOn(defense, onMap) {
    const next = JSON.parse(JSON.stringify(defense));
    for (let i = ARMADA.length - 1; i >= 0; i--) {
      const ship = ARMADA[i];
      const cap = Math.max(0, Math.floor(Number(onMap[ship]) || 0));
      let count = 0;
      for (let j = REGIONS.length - 1; j >= 0; j--) {
        const region = REGIONS[j];
        count += next[region][ship];
        if (count > cap) {
          const overflow = count - cap;
          next[region][ship] = Math.max(0, next[region][ship] - overflow);
          count = cap;
        }
      }
      if (count < cap) next.gxy_gateway[ship] += (cap - count);
    }
    return next;
  }

  function coversOk(real, galOn, defense, protectedRegions) {
    for (let i = 0; i < protectedRegions.length; i++) {
      const r = protectedRegions[i];
      if (piracyCover(real, r, galOn, defense) < 0.999) return false;
    }
    return true;
  }

  function galaxyMilForOn(onMap) {
    let n = 0;
    for (let i = 0; i < MIL_SHIPS.length; i++) {
      const name = MIL_SHIPS[i];
      n += Math.max(0, Math.floor(Number(onMap[name]) || 0)) * shipMil(name);
    }
    return n;
  }
  function currentGalaxyMil(real) {
    return galaxyMilForOn(snapshotOn(real));
  }
  function biremeMilPerShip() {
    const n = shipMil('bireme');
    return n > 0 ? n : 2;
  }
  function biremeInsts(real) {
    const out = [];
    const portal = liveWritablePortalStruct('bireme') || portalShipInst(real, 'bireme') || livePortalStruct('bireme');
    if (portal && typeof portal.count === 'number') out.push({ area: 'portal', inst: portal });
    const gal = (real && real.galaxy && real.galaxy.bireme)
      || (function () {
        const ev = g();
        return ev && ev.galaxy && ev.galaxy.bireme;
      })();
    // only count a galaxy bireme if it is a distinct instance
    if (gal && typeof gal.count === 'number' && gal !== portal) out.push({ area: 'galaxy', inst: gal });
    return out;
  }
  function biremeRequiredCrew(real) {
    const mil = biremeMilPerShip();
    let n = 0;
    const seen = [];
    biremeInsts(real).forEach((row) => {
      if (seen.indexOf(row.inst) >= 0) return;
      seen.push(row.inst);
      n += Math.max(0, Math.floor(Number(row.inst.count) || 0)) * mil;
    });
    if (Plan && Plan.biremeReservedCrew && n === 0) {
      // fallback if structs are missing from the facade this tick
    }
    return n;
  }
  function portalProtectedMil(real) {
    let n = biremeRequiredCrew(real);
    for (let i = 0; i < PROTECTED_SHIPS.length; i++) {
      const name = PROTECTED_SHIPS[i];
      if (name === 'bireme') continue; // already reserved by built count, not current .on
      const inst = portalShipInst(real, name) || livePortalStruct(name);
      if (!inst) continue;
      const on = typeof inst.on === 'number' ? inst.on : 0;
      n += on * (shipMil(name) || 0);
    }
    return n;
  }
  function currentTpCrew(real) {
    const crew = real.civic && real.civic.garrison && typeof real.civic.garrison.crew === 'number' ? real.civic.garrison.crew : 0;
    // 用规划中的 .on×编制，避免 .mil 尚未刷新时把双排桨船员误当成真路船员。
    const gal = currentGalaxyMil(real);
    const portal = portalProtectedMil(real);
    return Math.max(0, crew - gal - portal);
  }

  function canComputePiracy(real) {
    if (!real || !real.galaxy || !real.tech || !real.tech.piracy || (real.race && real.race.truepath)) return false;
    if (!shipRating('scout_ship') && !shipRating('dreadnought')) return false;
    return true;
  }

  // 补给货物可能来自仙女座某星系时，只为这些星系保留最低海盗覆盖与生产船。
  const CARGO_REGIONS = {
    Bolognium: ['gxy_gateway', 'gxy_alien2'],
    Adamantite: ['gxy_alien2'],
    Iridium: ['gxy_alien2'],
    Vitreloy: ['gxy_chthonian'],
    Polymer: ['gxy_chthonian'],
    Deuterium: ['gxy_chthonian'],
    Neutronium: ['gxy_chthonian'],
    Orichalcum: ['gxy_chthonian']
  };
  const CARGO_SHIPS = {
    Bolognium: ['armed_miner'],
    Adamantite: ['armed_miner'],
    Iridium: ['armed_miner'],
    Vitreloy: ['raider'],
    Polymer: ['raider'],
    Deuterium: ['raider'],
    Neutronium: ['raider'],
    Orichalcum: ['minelayer', 'raider']
  };
  function cargoResources(real) {
    const cargo = real && real.portal && real.portal.transport && real.portal.transport.cargo;
    const out = [];
    if (!cargo) return out;
    Object.keys(cargo).forEach((k) => {
      if (k === 'used' || k === 'max') return;
      if (cargo[k] > 0) out.push(k);
    });
    return out;
  }
  function pipelineNeeds(real) {
    const cargo = cargoResources(real);
    const regions = [];
    const ships = {};
    cargo.forEach((res) => {
      const rs = CARGO_REGIONS[res] || [];
      rs.forEach((r) => { if (regions.indexOf(r) < 0) regions.push(r); });
      const ss = CARGO_SHIPS[res] || [];
      ss.forEach((s) => { ships[s] = true; });
    });
    if (regions.length && regions.indexOf('gxy_stargate') < 0) regions.unshift('gxy_stargate');
    return { cargo: cargo, regions: regions, ships: ships };
  }
  function ratesViolated(before, after) {
    if (!after) return false;
    const names = { Infernite: true, Supply: true };
    const take = (src, k) => {
      if (!src) return null;
      if (k === 'Infernite' || k === 'Supply') return typeof src[k] === 'number' ? src[k] : null;
      return src.cargo && typeof src.cargo[k] === 'number' ? src.cargo[k] : null;
    };
    if (before && before.cargo) Object.keys(before.cargo).forEach((k) => { names[k] = true; });
    if (after.cargo) Object.keys(after.cargo).forEach((k) => { names[k] = true; });
    const keys = Object.keys(names);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const a = take(after, k);
      const b = take(before, k);
      if (a == null) continue;
      if (a >= -1e-6) continue;
      if (b == null) return true;
      if (a < b - 1e-3) return true;
    }
    return false;
  }
  function planCrewCompression(real) {
    const on = snapshotOn(real);
    const defense = snapshotDefense(real);
    const tp = currentTpCrew(real);
    const result = { on: Object.assign({}, on), defense: defense, reservedCrew: currentGalaxyMil(real) + tp, reduced: [], tpCrew: tp, skipped: null, protectedRegions: [], pipeline: null };
    const protectedMil = protectedMilCrew(real);
    result.protectedMil = protectedMil;
    if (!CFG.compressCrew) {
      result.skipped = 'off';
      result.reservedCrew = Math.max(protectedMil, (real.civic && real.civic.garrison && real.civic.garrison.crew) || result.reservedCrew);
      return result;
    }
    const needs = pipelineNeeds(real);
    result.pipeline = needs;
    // 不再为「已经 100% 覆盖」的无关星系留船；只保护补给管线需要的星系。
    const protectedRegions = needs.regions.slice();
    result.protectedRegions = protectedRegions;
    const canPiracy = canComputePiracy(real);
    if (!canPiracy) result.skipped = 'piracy-unknown';
    // 目标：军人船员尽量为 0。生产补给货物的军舰保留当前 .on，其余可压缩军舰尽量关掉。
    const targetOn = Object.assign({}, on);
    const floorOf = (ship) => (needs.ships[ship] ? Math.max(0, Math.floor(Number(on[ship]) || 0)) : 0);
    const order = MIL_SHIPS.slice().filter((s) => !Plan.isUntouchableShip(s) && s !== 'bireme').sort((a, b) => {
      const ma = shipMil(a) || 1, mb = shipMil(b) || 1;
      return (shipRating(a) / ma) - (shipRating(b) / mb);
    });
    for (let s = 0; s < order.length; s++) {
      const ship = order[s];
      if (Plan.isUntouchableShip(ship) || ship === 'bireme') continue;
      const floor = floorOf(ship);
      while (targetOn[ship] > floor) {
        const trialOn = Object.assign({}, targetOn);
        trialOn[ship] = targetOn[ship] - 1;
        if (canPiracy && protectedRegions.length) {
          const trialDef = trimDefenseToOn(defense, trialOn);
          if (!coversOk(real, trialOn, trialDef, protectedRegions)) break;
        }
        targetOn[ship] = trialOn[ship];
        result.reduced.push(ship);
      }
    }
    result.on = targetOn;
    result.defense = trimDefenseToOn(defense, targetOn);
    result.reservedCrew = galaxyMilForOn(targetOn) + protectedMilCrew(real);
    result.protectedMil = protectedMilCrew(real);
    return result;
  }

  function applyShipPlan(real, plan) {
    if (!real || !real.galaxy || !plan) return { ok: false };
    const changed = [];
    MIL_SHIPS.forEach((ship) => {
      if (Plan.isUntouchableShip(ship) || ship === 'bireme') return;
      const inst = real.galaxy[ship];
      if (!inst || typeof inst.on !== 'number') return;
      if (isExposeCloneStruct(inst, ship)) return; // never write the expose clone
      const want = Math.max(0, Math.min(inst.count || inst.on, Math.floor(Number(plan.on[ship]) || 0)));
      if (inst.on === want) return;
      inst.on = want;
      changed.push(ship + ':' + want);
    });
    const cloneDef = g() && g().galaxy && g().galaxy.defense;
    if (real.galaxy.defense && plan.defense && real.galaxy.defense !== cloneDef) {
      REGIONS.forEach((r) => {
        if (!real.galaxy.defense[r]) return;
        ARMADA.forEach((s) => {
          if (typeof real.galaxy.defense[r][s] === 'number') {
            const want = Math.max(0, Math.floor(Number(plan.defense[r][s]) || 0));
            if (real.galaxy.defense[r][s] !== want) real.galaxy.defense[r][s] = want;
          }
        });
      });
    }
    return { ok: true, changed };
  }

  function applyBiremeKeepOn(real) {
    const planned = Plan.planBiremePower((function () {
      const st = { biremeOn: 0, biremeCount: 0 };
      biremeInsts(real).forEach((row) => {
        const inst = row.inst;
        if (row.area === 'galaxy') {
          st.galaxyBiremeOn = inst.on;
          st.galaxyBiremeCount = inst.count;
        } else {
          st.biremeOn = inst.on;
          st.biremeCount = inst.count;
        }
      });
      return st;
    })());
    const changed = [];
    const applyOne = (inst, want, area) => {
      if (!inst || typeof inst.on !== 'number' || typeof want !== 'number') return;
      const ev = g();
      if (ev && ev[area] && ev[area].bireme === inst) return; // never write the expose clone
      const cap = typeof inst.count === 'number' ? inst.count : inst.on;
      const target = Math.max(0, Math.min(cap, want));
      if (inst.on >= target) return; // already at or above required; never power down
      inst.on = target;
      changed.push(area + ':bireme:' + inst.on);
    };
    biremeInsts(real).forEach((row) => {
      const want = row.area === 'galaxy'
        ? (planned.galaxy && planned.galaxy.want)
        : (planned.portal && planned.portal.want);
      applyOne(row.inst, want, row.area);
    });
    if (changed.length) pokeVue();
    return { ok: true, changed: changed, planned: planned, wrote: changed.length > 0 };
  }

  function attractorPowerCost() {
    try {
      const ev = game();
      const def = ev && ev.actions && ev.actions.portal && ev.actions.portal.prtl_fortress && ev.actions.portal.prtl_fortress.attractor;
      if (def && typeof def.powered === 'function') {
        const n = Number(def.powered());
        if (n > 0) return n;
      }
    } catch (e) {}
    return 3;
  }
  function currentPower(real) {
    const city = (real && real.city) || (g() && g().city) || {};
    return typeof city.power === 'number' ? city.power : null;
  }
  function currentPowerTotal(real) {
    const city = (real && real.city) || (g() && g().city) || {};
    return typeof city.power_total === 'number' ? city.power_total : null;
  }
  // 左上角余电 (city.power) 是总督把盈余塞进复制器之后的剩余，不是总发电。
  function liveReplicator() {
    const el = document.getElementById('iReplicator');
    const v = el && el.__vue__;
    if (v && typeof v.pow === 'number') return v;
    if (v && v.$data && typeof v.$data.pow === 'number') return v.$data;
    return null;
  }
  function liveCityReplicator() {
    const vue = getVueById('city-replicator');
    if (vue && vue.act && typeof vue.act.on === 'number') return vue.act;
    if (vue && vue.$data && vue.$data.act && typeof vue.$data.act.on === 'number') return vue.$data.act;
    return null;
  }
  function isCloneReplicator(obj) {
    if (!obj) return false;
    const ev = g();
    if (ev && ev.race && ev.race.replicator && ev.race.replicator === obj) return true;
    if (ev && ev.city && ev.city.replicator && ev.city.replicator === obj) return true;
    return false;
  }
  let lastReplPow = { n: 0, at: 0 };
  function readReplicatorPow(real) {
    let raw = 0;
    const live = liveReplicator();
    if (live && typeof live.pow === 'number') raw = Math.max(0, Number(live.pow) || 0);
    else {
      const cityR = liveCityReplicator();
      if (cityR && typeof cityR.on === 'number') raw = Math.max(0, Number(cityR.on) || 0);
      else {
        const race = real && real.race && real.race.replicator;
        if (race && typeof race.pow === 'number' && !isCloneReplicator(race)) raw = Math.max(0, Number(race.pow) || 0);
        else {
          const ev = g();
          if (ev && ev.race && ev.race.replicator && typeof ev.race.replicator.pow === 'number') {
            raw = Math.max(0, Number(ev.race.replicator.pow) || 0);
          } else if (ev && ev.city && ev.city.replicator && typeof ev.city.replicator.on === 'number') {
            raw = Math.max(0, Number(ev.city.replicator.on) || 0);
          }
        }
      }
    }
    const now = Date.now();
    if (raw > 0) { lastReplPow = { n: raw, at: now }; return raw; }
    // 建造等操作可能短暂卸掉 #iReplicator，不要把刚刚还很高的复制器功率读成 0 再去关引诱装置。
    if (lastReplPow.n > 0 && now - lastReplPow.at < 60000) return lastReplPow.n;
    return 0;
  }
  function applyReplicatorDrain(drain) {
    drain = Math.max(0, Math.floor(Number(drain) || 0));
    const before = readReplicatorPow(liveGlobal());
    if (!drain) return { ok: true, drained: 0, before: before, after: before, live: false };
    const live = liveReplicator();
    const cityR = liveCityReplicator();
    const real = liveGlobal();
    let after = before;
    let wrote = false;
    if (live && !isCloneReplicator(live)) {
      after = Math.max(0, Math.floor((Number(live.pow) || 0) - drain));
      live.pow = after;
      wrote = true;
    } else if (real && real.race && real.race.replicator && !isCloneReplicator(real.race.replicator)) {
      after = Math.max(0, Math.floor((Number(real.race.replicator.pow) || 0) - drain));
      real.race.replicator.pow = after;
      wrote = true;
    }
    if (wrote) {
      if (cityR && !isCloneReplicator(cityR)) {
        cityR.on = after;
        if (typeof cityR.count === 'number') cityR.count = after;
      } else if (real && real.city && real.city.replicator && !isCloneReplicator(real.city.replicator)) {
        real.city.replicator.on = after;
        real.city.replicator.count = after;
      }
    }
    return { ok: wrote, drained: Math.max(0, before - after), before: before, after: after, live: wrote };
  }
  function planAttractors(real) {
    const inst = livePortalStruct('attractor') || (real && real.portal && real.portal.attractor);
    if (!inst || typeof inst.count !== 'number') return null;
    const count = inst.count || 0;
    const cur = typeof inst.on === 'number' ? inst.on : 0;
    const threat = (real && real.portal && real.portal.fortress && real.portal.fortress.threat) || 0;
    const leftover = currentPower(real);
    const repl = readReplicatorPow(real);
    const planned = Plan.planAttractorOn({
      on: cur, count: count, power: leftover, replicatorPow: repl,
      cost: attractorPowerCost(), buffer: 5
    });
    planned.threat = threat;
    planned.power = leftover;
    planned.powerTotal = currentPowerTotal(real);
    return planned;
  }

  function applyAttractors(plan) {
    if (!plan) return { ok: false };
    const inst = livePortalStruct('attractor');
    const real = liveGlobal();
    const target = inst && typeof inst.on === 'number' ? inst : (real && real.portal && real.portal.attractor);
    if (!target || typeof target.on !== 'number') return { ok: false, reason: 'no-attractor' };
    const want = Math.max(0, Math.min(target.count || 0, plan.on));
    const before = target.on;
    if (want < before) {
      const avail = plan.avail;
      const repl = plan.replicatorPow;
      const sureShort = avail != null && Number.isFinite(avail) && avail < 0 && (repl == null || repl <= 0);
      if (!sureShort) {
        return { ok: true, before: before, on: before, skipped: 'keep-on', replicator: { ok: true, drained: 0 } };
      }
    }
    // 先从复制器腾出电力，再开引诱装置，避免和总督抢余电、把左上角打红。
    const drain = Math.max(0, Number(plan.drain) || 0);
    const released = drain ? applyReplicatorDrain(drain) : { ok: true, drained: 0 };
    if (before !== want) target.on = want;
    return { ok: true, before: before, on: target.on, replicator: released };
  }

  function readDroneBackup() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRONE_BACKUP_KEY) || 'null');
      if (raw && typeof raw.on === 'number') return raw;
    } catch (e) {}
    return null;
  }
  function writeDroneBackup(obj) {
    try { localStorage.setItem(DRONE_BACKUP_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function clearDroneBackup() {
    try { localStorage.removeItem(DRONE_BACKUP_KEY); } catch (e) {}
  }
  function applyWarDronePower(shutdown) {
    const inst = liveWritablePortalStruct('war_drone');
    if (!inst || typeof inst.on !== 'number') return { ok: false, reason: 'no-live-drone' };
    const count = typeof inst.count === 'number' ? inst.count : inst.on;
    if (shutdown) {
      let bak = readDroneBackup();
      if (!bak) {
        bak = { on: inst.on };
        writeDroneBackup(bak);
      }
      if (inst.on !== 0) {
        inst.on = 0;
        pokeVue();
      }
      return { ok: true, on: inst.on, count: count, backupOn: bak.on, shutdown: true };
    }
    const bak = readDroneBackup();
    if (bak) {
      const want = Math.max(0, Math.min(count, Math.floor(Number(bak.on) || 0)));
      if (inst.on !== want) {
        inst.on = want;
        pokeVue();
      }
      clearDroneBackup();
      return { ok: true, on: inst.on, count: count, backupOn: bak.on, shutdown: false, restored: true };
    }
    return { ok: true, on: inst.on, count: count, shutdown: false, restored: false };
  }

  function findPortalAction(key) {
    const ev = game();
    const actions = ev && ev.actions && ev.actions.portal;
    if (!actions) return null;
    const zones = Object.keys(actions);
    for (let i = 0; i < zones.length; i++) {
      const z = actions[zones[i]];
      if (z && z[key]) return z[key];
    }
    return null;
  }
  function trioCost(key) {
    const def = findPortalAction(key);
    if (!def || !def.cost) return null;
    const out = {};
    Object.keys(def.cost).forEach((res) => {
      const fn = def.cost[res];
      try { out[res] = typeof fn === 'function' ? Number(fn(0)) || 0 : Number(fn) || 0; } catch (e) { out[res] = 0; }
    });
    return out;
  }
  function trioPowerCost(key) {
    const def = findPortalAction(key);
    try {
      if (def && typeof def.powered === 'function') return Math.max(0, Number(def.powered()) || 0);
    } catch (e) {}
    if (key === 'war_droid') return 2;
    if (key === 'repair_droid') return 3;
    if (key === 'war_drone') return 5;
    return 0;
  }
  function canPayTrio(real, key, reserve) {
    const cost = trioCost(key);
    if (!cost) return { ok: false, reason: 'no-cost' };
    const res = (real && real.resource) || (g() && g().resource) || {};
    const names = Object.keys(cost);
    for (let i = 0; i < names.length; i++) {
      const k = names[i];
      const need = Number(cost[k]) || 0;
      const have = (res[k] && typeof res[k].amount === 'number') ? res[k].amount : 0;
      if (k === 'Soul_Gem' && have - need < reserve) return { ok: false, reason: 'gem-reserve', cost: cost };
      if (have < need) return { ok: false, reason: 'unaffordable:' + k, cost: cost };
    }
    return { ok: true, cost: cost };
  }
  function tryBuildTrio(real, key, reserve) {
    const pay = canPayTrio(real, key, reserve);
    if (!pay.ok) return { ok: false, reason: pay.reason, key: key };
    const rates = relatedRates(real);
    if (key === 'repair_droid' && rates && rates.Infernite < 0) return { ok: false, reason: 'infernite-net', key: key };
    if (rates && rates.Supply < 0 && rates.Supply < -1e-6) return { ok: false, reason: 'supply-net', key: key };
    const needPow = trioPowerCost(key);
    const leftover = currentPower(real);
    const repl = readReplicatorPow(real);
    const avail = (leftover == null ? 0 : leftover) + (repl || 0);
    const att = livePortalStruct('attractor') || (real && real.portal && real.portal.attractor);
    const attOn = att && typeof att.on === 'number' ? att.on : 0;
    const attReserved = attOn * attractorPowerCost() + 5;
    if (needPow > 0 && avail < needPow + attReserved + 2) {
      return { ok: false, reason: 'power', key: key, avail: avail, need: needPow, attReserved: attReserved };
    }
    const before = (function () {
      const inst = liveWritablePortalStruct(key) || livePortalStruct(key);
      return inst && typeof inst.count === 'number' ? inst.count : null;
    })();
    let clicked = false;
    const vue = getVueById('portal-' + key);
    try {
      if (vue && typeof vue.action === 'function') { vue.action(); clicked = true; }
    } catch (e) {}
    if (!clicked) {
      const def = findPortalAction(key);
      try {
        if (def && typeof def.action === 'function') { def.action(); clicked = true; }
      } catch (e2) {}
    }
    if (!clicked) return { ok: false, reason: 'no-action', key: key };
    pokeVue();
    const after = (function () {
      const inst = liveWritablePortalStruct(key) || livePortalStruct(key);
      return inst && typeof inst.count === 'number' ? inst.count : null;
    })();
    return { ok: true, key: key, clicked: true, before: before, after: after, cost: pay.cost };
  }

  function snapshotState(real) {
    const f = (liveFortress() && isLiveFortress(liveFortress()) ? liveFortress() : (real.portal && real.portal.fortress)) || {};
    const gar = liveGarrison() || (real.civic && real.civic.garrison) || {};
    const forge = livePortalStruct('soul_forge') || (real.portal && real.portal.soul_forge) || {};
    const guard = livePortalStruct('guard_post') || (real.portal && real.portal.guard_post) || {};
    const droid = livePortalStruct('war_droid') || (real.portal && real.portal.war_droid) || {};
    const repair = livePortalStruct('repair_droid') || (real.portal && real.portal.repair_droid) || {};
    const drone = liveWritablePortalStruct('war_drone') || livePortalStruct('war_drone') || (real.portal && real.portal.war_drone) || {};
    const carport = livePortalStruct('carport') || (real.portal && real.portal.carport) || {};
    const turret = livePortalStruct('turret') || (real.portal && real.portal.turret) || {};
    const att = livePortalStruct('attractor') || (real.portal && real.portal.attractor) || {};
    const turretEach = real.tech && real.tech.turret ? (real.tech.turret >= 2 ? 70 : 50) : 35;
    const soulNeeded = (forge.on > 0) ? soulForgeSoldiers() : 0;
    return {
      workers: gar.workers || 0,
      max: gar.max || 0,
      wounded: gar.wounded || 0,
      crew: gar.crew || 0,
      garrison: f.garrison || 0,
      patrols: f.patrols || 0,
      patrol_size: f.patrol_size || 1,
      assigned: f.assigned || 0,
      nocrew: !!f.nocrew,
      threat: f.threat || 0,
      walls: f.walls != null ? f.walls : 100,
      pity: f.pity || 0,
      soulForgeOn: !!(forge.on > 0),
      soulForgeNeeded: soulNeeded,
      guardPostSoldiers: jobScale(guard.on || 0),
      warDroidOn: droid.on || 0,
      warDroidCount: droid.count || 0,
      droidBonusSoldiers: ((real.race && real.race.hdroid) || (real.tech && real.tech.hdroid) ? jobScale(2) : jobScale(1)),
      attractorOn: att.on || 0,
      attractorCount: att.count || 0,
      turretOn: turret.on || 0,
      turretPower: (turret.on || 0) * turretEach,
      armyRating: armyRatingFn(),
      warlord: !!(real.race && real.race.warlord),
      repairDroidOn: (repair.on || 0),
      repairDroidCount: (repair.count || 0),
      warDroneOn: (drone.on || 0),
      warDroneCount: (drone.count || 0),
      carportDamaged: (carport.damaged || 0),
      soulGems: (function () {
        const soul = liveSoulGem() || (real.resource && real.resource.Soul_Gem);
        return soul && typeof soul.amount === 'number' ? soul.amount : 0;
      })(),
      inferniteDiff: (real.resource && real.resource.Infernite && typeof real.resource.Infernite.diff === 'number') ? real.resource.Infernite.diff : 0,
      portalTech: (real.tech && real.tech.portal) || 0,
      wallsFalling: false
    };
  }

  function applyFortress(target, nocrew) {
    const f = liveFortress();
    if (!f || !isLiveFortress(f)) return { ok: false, reason: 'no-live-fortress' };
    const applied = Plan.applyOrder({
      garrison: f.garrison, patrols: f.patrols, patrol_size: f.patrol_size
    }, target);
    if (f.patrol_size !== applied.patrol_size && applied.steps.indexOf('size-down') >= 0) {
      f.patrol_size = applied.patrol_size;
    } else if (f.patrol_size > applied.patrol_size) {
      f.patrol_size = applied.patrol_size;
    }
    if (f.patrols > applied.patrols) f.patrols = applied.patrols;
    f.garrison = applied.garrison;
    f.assigned = applied.garrison;
    if (f.patrol_size < applied.patrol_size) f.patrol_size = applied.patrol_size;
    if (f.patrols < applied.patrols) f.patrols = applied.patrols;
    if (f.patrols * f.patrol_size > f.garrison) {
      f.patrols = Math.floor(f.garrison / Math.max(1, f.patrol_size));
    }
    if (typeof nocrew === 'boolean') f.nocrew = nocrew;
    pokeVue();
    return { ok: true, applied: { garrison: f.garrison, patrols: f.patrols, patrol_size: f.patrol_size, nocrew: f.nocrew } };
  }

  // ---------- 屏蔽 Vollch ----------
  function readVollchFlag(key) {
    const el = document.querySelector('input.script_' + key);
    if (el) return !!el.checked;
    try {
      const raw = JSON.parse(localStorage.getItem('settings') || '{}');
      if (Object.prototype.hasOwnProperty.call(raw, key)) return !!raw[key];
    } catch (e) {}
    return null;
  }
  function readVollchFlagDom(key) {
    const el = document.querySelector('input.script_' + key);
    return el ? !!el.checked : null;
  }
  function setVollchFlag(key, value) {
    const els = document.querySelectorAll('input.script_' + key);
    if (!els.length) return false;
    let changed = false;
    els.forEach((inp) => {
      const want = !!value;
      if (!!inp.checked !== want) {
        inp.checked = want;
        changed = true;
      }
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const el = document.querySelector('input.script_' + key);
    return !!(el && !!el.checked === !!value);
  }
  function patchVollchSettingsLocal(patch) {
    try {
      const raw = JSON.parse(localStorage.getItem('settings') || '{}');
      Object.assign(raw, patch);
      localStorage.setItem('settings', JSON.stringify(raw));
      return true;
    } catch (e) { return false; }
  }
  function vollchConflictKeys() {
    // 只屏蔽会改地狱驻军/巡逻或把刚释放的军人船员再派回去的开关。
    // 不关总开关、不关自动作业/科研/建造总开关，也不关补给运输（autoSupply）和湖区运输船供电。
    const keys = ['autoHell', 'hellHandlePatrolSize', 'hellHandlePatrolCount', 'autoFleet'];
    ARMADA.forEach((s) => {
      keys.push('bld_s_galaxy-' + s, 'bld_s2_galaxy-' + s);
    });
    // 武装矿船 / 布雷舰 / 掠夺舰也会被主脚本 autoPower 重新打开并抢走双排桨船员，必须一并屏蔽供能。
    MIL_SHIPS.forEach((s) => {
      if (ARMADA.indexOf(s) >= 0) return;
      keys.push('bld_s_galaxy-' + s, 'bld_s2_galaxy-' + s);
    });
    keys.push('bld_s_portal-attractor', 'bld_s2_portal-attractor');
    ['war_droid', 'repair_droid', 'war_drone'].forEach((k) => {
      keys.push('bld_s_portal-' + k, 'bld_s2_portal-' + k, 'batportal-' + k);
    });
    // 只关双排桨的供能/Power（bld_s）。不要关智能开关 bld_s2、自动建造 bat，也不关运输船或 autoSupply。
    keys.push('bld_s_portal-bireme');
    return keys.filter((k) => SUPPLY_PIPE_FLAGS.indexOf(k) < 0);
  }
  function trioPowerKeys() {
    const keys = [];
    ['war_droid', 'repair_droid', 'war_drone'].forEach((k) => {
      keys.push('bld_s_portal-' + k, 'bld_s2_portal-' + k, 'batportal-' + k);
    });
    return keys;
  }
  function biremePowerKeys() {
    return ['bld_s_portal-bireme'];
  }
  function powerControlKeys() {
    return trioPowerKeys().concat(biremePowerKeys());
  }
  function isBuildingSettingsOpen() {
    const trigger = document.getElementById('buildingSettingsCollapsed');
    const wrap = trigger && trigger.nextElementSibling;
    return !!(wrap && wrap.style && wrap.style.display === 'block');
  }
  function hasTrioPowerCheckbox() {
    return !!document.querySelector('input.script_bld_s_portal-war_drone, input.script_bld_s_portal-war_droid, input.script_bld_s_portal-repair_droid, input.script_bld_s_portal-bireme');
  }
  let _vollchSettingsRaw = null;
  function isVollchSettingsRaw(obj) {
    return !!(obj && typeof obj === 'object' && !Array.isArray(obj)
      && obj.overrides && typeof obj.overrides === 'object'
      && Object.prototype.hasOwnProperty.call(obj, 'autoPower')
      && Object.prototype.hasOwnProperty.call(obj, 'masterScriptToggle'));
  }
  function withVollchSettingsRaw(duringFn, mutateFn) {
    const orig = JSON.stringify;
    let hit = _vollchSettingsRaw;
    JSON.stringify = function (value, replacer, space) {
      if (isVollchSettingsRaw(value)) {
        hit = value;
        _vollchSettingsRaw = value;
        if (typeof mutateFn === 'function') {
          try { mutateFn(value); } catch (e) {}
        }
      }
      return orig.call(this, value, replacer, space);
    };
    try {
      if (typeof duringFn === 'function') duringFn();
    } finally {
      JSON.stringify = orig;
    }
    return hit;
  }
  function readStoredOverrides() {
    try {
      const raw = JSON.parse(localStorage.getItem('settings') || '{}');
      return (raw && raw.overrides && typeof raw.overrides === 'object') ? raw.overrides : {};
    } catch (e) { return {}; }
  }
  function ensureBuildingSettingsTable() {
    const planAcc = (Plan && Plan.planSettingsSectionAccess)
      ? Plan.planSettingsSectionAccess({
        hasCheckbox: hasTrioPowerCheckbox(),
        hasTrigger: !!document.getElementById('buildingSettingsCollapsed'),
        isOpen: isBuildingSettingsOpen()
      })
      : { ready: hasTrioPowerCheckbox(), clickToOpen: false, recollapseAfter: false, retry: !hasTrioPowerCheckbox() };
    if (planAcc.ready) return { ready: true, opened: false, recollapseAfter: false };
    if (!planAcc.clickToOpen) return { ready: false, opened: false, recollapseAfter: false, retry: true };
    const trigger = document.getElementById('buildingSettingsCollapsed');
    if (!trigger) return { ready: false, opened: false, recollapseAfter: false, retry: true };
    try { trigger.click(); } catch (e) {}
    return {
      ready: hasTrioPowerCheckbox(),
      opened: isBuildingSettingsOpen(),
      recollapseAfter: true
    };
  }
  function recollapseBuildingSettings() {
    const trigger = document.getElementById('buildingSettingsCollapsed');
    if (trigger && isBuildingSettingsOpen()) {
      try { trigger.click(); } catch (e) {}
    }
  }
  function backupVollchOverrides(keys, dest) {
    if (!dest) return;
    dest.__overrides = dest.__overrides || {};
    const live = (_vollchSettingsRaw && _vollchSettingsRaw.overrides) || readStoredOverrides();
    keys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(dest.__overrides, k)) return;
      if (live && Object.prototype.hasOwnProperty.call(live, k)) {
        try { dest.__overrides[k] = JSON.parse(JSON.stringify(live[k])); } catch (e) { dest.__overrides[k] = live[k]; }
      }
    });
  }
  function clearLiveTrioOverrides(keys, backup) {
    const raw = _vollchSettingsRaw;
    if (!raw || !raw.overrides) return [];
    const cleared = [];
    keys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(raw.overrides, k)) {
        if (backup) backupVollchOverrides([k], backup);
        delete raw.overrides[k];
        cleared.push(k);
      }
    });
    return cleared;
  }
  function restoreLiveTrioOverrides(backup) {
    const raw = _vollchSettingsRaw;
    if (!raw || !backup || !backup.__overrides) return false;
    if (!raw.overrides || typeof raw.overrides !== 'object') raw.overrides = {};
    Object.keys(backup.__overrides).forEach((k) => {
      raw.overrides[k] = backup.__overrides[k];
    });
    return true;
  }

  function suppressVollchHell(on) {
    const result = { on: !!on, applied: false, restored: false, missing: [], localPatched: false, domReady: false, recollapsed: false, overridesCleared: [] };
    try {
      const keys = vollchConflictKeys();
      const powerKeys = powerControlKeys();
      if (on) {
        let backup = null;
        try { backup = JSON.parse(localStorage.getItem(VOLLCH_BACKUP_KEY) || 'null'); } catch (e) {}
        if (!backup) backup = {};
        keys.forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(backup, k)) return;
          const v = readVollchFlag(k);
          if (v != null) backup[k] = v;
          else {
            try {
              const raw = JSON.parse(localStorage.getItem('settings') || '{}');
              if (Object.prototype.hasOwnProperty.call(raw, k)) backup[k] = !!raw[k];
            } catch (e2) {}
          }
        });
        backupVollchOverrides(powerKeys, backup);
        try { localStorage.setItem(VOLLCH_BACKUP_KEY, JSON.stringify(backup)); } catch (e) {}

        const table = ensureBuildingSettingsTable();
        result.table = { ready: table.ready, opened: table.opened };
        const localPatch = {};
        keys.forEach((k) => { localPatch[k] = false; });
        withVollchSettingsRaw(() => {
          keys.forEach((k) => { setVollchFlag(k, false); });
        }, (raw) => {
          backupVollchOverrides(powerKeys, backup);
          powerKeys.forEach((k) => {
            if (raw.overrides && Object.prototype.hasOwnProperty.call(raw.overrides, k)) {
              delete raw.overrides[k];
              result.overridesCleared.push(k);
            }
          });
        });
        if (_vollchSettingsRaw) {
          const more = clearLiveTrioOverrides(powerKeys, backup);
          more.forEach((k) => { if (result.overridesCleared.indexOf(k) < 0) result.overridesCleared.push(k); });
        }
        try { localStorage.setItem(VOLLCH_BACKUP_KEY, JSON.stringify(backup)); } catch (e) {}
        if (Object.keys(localPatch).length) result.localPatched = patchVollchSettingsLocal(localPatch);

        keys.forEach((k) => {
          if (readVollchFlagDom(k) == null) result.missing.push(k);
        });
        const managedBldS = ['bld_s_portal-war_droid', 'bld_s_portal-repair_droid', 'bld_s_portal-war_drone', 'bld_s_portal-bireme'];
        result.domReady = managedBldS.every((k) => readVollchFlagDom(k) === false);
        result.biremePowerOff = readVollchFlagDom('bld_s_portal-bireme');
        result.transportPowerOn = readVollchFlagDom('bld_s_portal-transport');
        if (table.opened || table.recollapseAfter) {
          recollapseBuildingSettings();
          result.recollapsed = !isBuildingSettingsOpen();
        }
        result.applied = true;
        result.buildingCollapsed = (function () {
          try {
            const raw = JSON.parse(localStorage.getItem('settings') || '{}');
            if (Object.prototype.hasOwnProperty.call(raw, 'buildingSettingsCollapsed')) return !!raw.buildingSettingsCollapsed;
          } catch (e) {}
          return !isBuildingSettingsOpen();
        })();
      } else {
        let backup = null;
        try { backup = JSON.parse(localStorage.getItem(VOLLCH_BACKUP_KEY) || 'null'); } catch (e) {}
        const table = ensureBuildingSettingsTable();
        result.table = { ready: table.ready, opened: table.opened };
        if (backup && typeof backup === 'object') {
          withVollchSettingsRaw(() => {
            Object.entries(backup).forEach(([k, v]) => {
              if (k === '__overrides') return;
              setVollchFlag(k, !!v);
            });
          }, (raw) => {
            if (backup.__overrides) {
              if (!raw.overrides || typeof raw.overrides !== 'object') raw.overrides = {};
              Object.keys(backup.__overrides).forEach((k) => { raw.overrides[k] = backup.__overrides[k]; });
            }
          });
          restoreLiveTrioOverrides(backup);
          patchVollchSettingsLocal((function () {
            const p = {};
            Object.entries(backup).forEach(([k, v]) => { if (k !== '__overrides') p[k] = !!v; });
            return p;
          })());
          // 覆盖要写回内存和 localStorage，但不能丢掉其它设置
          if (_vollchSettingsRaw && backup.__overrides) {
            restoreLiveTrioOverrides(backup);
            try { localStorage.setItem('settings', JSON.stringify(_vollchSettingsRaw)); } catch (e) {}
          }
        }
        if (table.opened || table.recollapseAfter) {
          recollapseBuildingSettings();
          result.recollapsed = !isBuildingSettingsOpen();
        }
        try { localStorage.removeItem(VOLLCH_BACKUP_KEY); } catch (e) {}
        result.restored = !!backup;
        result.domReady = ['bld_s_portal-war_droid', 'bld_s_portal-repair_droid', 'bld_s_portal-war_drone', 'bld_s_portal-bireme']
          .every((k) => readVollchFlagDom(k) === true);
        result.biremePowerOff = readVollchFlagDom('bld_s_portal-bireme');
        result.transportPowerOn = readVollchFlagDom('bld_s_portal-transport');
        result.buildingCollapsed = (function () {
          try {
            const raw = JSON.parse(localStorage.getItem('settings') || '{}');
            if (Object.prototype.hasOwnProperty.call(raw, 'buildingSettingsCollapsed')) return !!raw.buildingSettingsCollapsed;
          } catch (e) {}
          return !isBuildingSettingsOpen();
        })();
      }
    } catch (e) {
      result.error = String(e && e.message || e);
      try { recollapseBuildingSettings(); } catch (e2) {}
    }
    return result;
  }

  // ---------- 主循环 ----------
  let lastTick = null;
  let lastLogAt = 0;
  let ratesAnchor = null;
  let shipAnchor = null;
  let crewLocked = false;
  function tick(reason) {
    if (!CFG.enabled) {
      lastTick = { skipped: 'off', reason: reason || 'tick', at: Date.now() };
      return lastTick;
    }
    if (!isEvolveReady()) {
      lastTick = { skipped: 'not-ready', reason: reason || 'tick', at: Date.now() };
      return lastTick;
    }
    const real = liveGlobal();
    if (!real || !real.portal || !real.portal.fortress) {
      lastTick = { skipped: 'no-live', reason: reason || 'tick', at: Date.now() };
      return lastTick;
    }
    if (isWarlord(real)) {
      lastTick = { skipped: 'warlord', at: Date.now() };
      return lastTick;
    }
    const vollchSup = suppressVollchHell(true);

    let crewPlan = null;
    let reservedCrew;
    const protectedCrew = protectedMilCrew(real);
    const biremeCrewNeed = biremeRequiredCrew(real);
    const ratesBefore = relatedRates(real);
    if (CFG.compressCrew) {
      if (!ratesAnchor) {
        ratesAnchor = ratesBefore;
        shipAnchor = snapshotOn(real);
        crewLocked = false;
      } else if (crewLocked || ratesViolated(ratesAnchor, ratesBefore)) {
        if (!crewLocked && shipAnchor) {
          crewLocked = true;
          log('相关材料净产变负，已把军舰恢复到压缩前配置，避免打断绯绯色金转补给');
        }
        crewPlan = {
          on: Object.assign({}, shipAnchor || snapshotOn(real)),
          defense: snapshotDefense(real),
          reservedCrew: galaxyMilForOn(shipAnchor || snapshotOn(real)) + protectedCrew,
          reduced: [],
          skipped: 'rate-guard',
          protectedMil: protectedCrew
        };
        crewPlan.defense = trimDefenseToOn(crewPlan.defense, crewPlan.on);
        applyShipPlan(real, crewPlan);
        reservedCrew = CFG.reserveCrew >= 0 ? CFG.reserveCrew : crewPlan.reservedCrew;
      } else {
        crewPlan = planCrewCompression(real);
        applyShipPlan(real, crewPlan);
        reservedCrew = CFG.reserveCrew >= 0 ? CFG.reserveCrew : crewPlan.reservedCrew;
      }
    } else {
      reservedCrew = CFG.reserveCrew >= 0 ? CFG.reserveCrew : ((liveGarrison() || {}).crew || 0);
    }
    reservedCrew = Math.max(protectedCrew, Math.max(0, reservedCrew), biremeCrewNeed);
    const f = liveFortress();
    if (f && isLiveFortress(f) && CFG.compressCrew) f.nocrew = true;

    const st = snapshotState(real);
    st.reservedCrew = reservedCrew;
    const plan = Plan.planPatrol(st, {
      threatTarget: CFG.threatTarget,
      homeReserve: CFG.homeReserve,
      minPatrolSize: CFG.minPatrolSize
    });
    let applied = null;
    if (!plan.skipped) {
      applied = applyFortress(plan, CFG.compressCrew ? true : undefined);
    }
    const biremeKeep = applyBiremeKeepOn(real);

    let att = null;
    if (CFG.autoAttractor && !plan.skipped) {
      const ap = planAttractors(real);
      if (ap) att = applyAttractors(ap);
    }

    if (lastWallsSeen != null && st.walls < lastWallsSeen) st.wallsFalling = true;
    lastWallsSeen = st.walls;
    const droneBak = readDroneBackup();
    if (droneBak && typeof droneBak.on === 'number') st.warDroneBackupOn = droneBak.on;
    const trio = Plan.planTrioCaps(st, {
      gemReserve: CFG.gemReserve,
      shutdownDrones: !!CFG.shutdownDrones
    });
    let dronePower = null;
    if (CFG.shutdownDrones) {
      dronePower = applyWarDronePower(true);
    } else if (readDroneBackup()) {
      dronePower = applyWarDronePower(false);
    }
    let trioBuild = null;
    if (CFG.autoTrio && trio && trio.next) {
      trioBuild = tryBuildTrio(real, trio.next, CFG.gemReserve);
      if (trioBuild && trioBuild.ok) log('已建造' + trioLabel(trio.next) + (trioBuild.after != null ? '（' + trioBuild.after + '）' : ''));
    }

    lastTick = { ok: true, reason: reason || 'tick', crewPlan, reservedCrew, protectedCrew, plan, applied, att, trio, trioBuild, dronePower, biremeKeep, biremeCrewNeed, vollchSup, state: st, rates: ratesBefore, at: Date.now() };
    try { refreshStats(); } catch (e) {}
    if (reason === 'enable' || reason === 'manual') {
      log(statusSummary(lastTick));
    } else if (Date.now() - lastLogAt > 30000 && applied && applied.ok) {
      lastLogAt = Date.now();
    }
    return lastTick;
  }

  function formatInt(n) {
    n = Math.floor(Number(n) || 0);
    return n.toLocaleString('zh-CN');
  }
  let lastWallsSeen = null;
  function trioLabel(key) {
    if (key === 'war_droid') return '战斗机器人';
    if (key === 'repair_droid') return '修理机器人';
    if (key === 'war_drone') return '掠食者无人机';
    return key || '';
  }
  function statusSummary(t) {
    if (!t) return '尚未运行';
    if (t.skipped === 'warlord') return '军阀种族：不改驻军与巡逻';
    if (t.skipped) return '未执行：' + t.skipped;
    const p = t.plan || {};
    const bits = [];
    bits.push('驻军 ' + formatInt(p.garrison) + '　巡逻 ' + formatInt(p.patrols) + '×' + formatInt(p.patrol_size));
    bits.push('熔炉预留 ' + formatInt(p.forge));
    if (t.crewPlan && t.crewPlan.reduced && t.crewPlan.reduced.length) {
      bits.push('已关军舰 ' + t.crewPlan.reduced.length + ' 艘，保留船员（管线最低） ' + formatInt(t.reservedCrew));
    } else {
      bits.push('保留船员 ' + formatInt(t.reservedCrew));
    }
    if (t.dronePower && t.dronePower.shutdown) bits.push('掠食者无人机已关闭');
    else if (t.dronePower && t.dronePower.restored) bits.push('掠食者无人机已还原');
    if (t.trioBuild && t.trioBuild.ok) bits.push('已造 ' + trioLabel(t.trioBuild.key));
    else if (t.trio && t.trio.next && CFG.autoTrio) bits.push('下一座 ' + trioLabel(t.trio.next));
    return bits.join('　');
  }

  let tickTimer = 0, powerTimer = 0;
  function setEnabled(on, reason) {
    const turningOff = CFG.enabled && !on;
    CFG.enabled = !!on;
    if (turningOff && (reason === 'manual' || reason === 'user')) {
      const sp = readSpire(liveGlobal() || g());
      CFG.manualOffFloor = sp ? sp.count : CFG.manualOffFloor;
    }
    if (CFG.enabled) CFG.manualOffFloor = null;
    saveCfg();
    const box = document.getElementById('sgk-enabled');
    if (box) box.checked = CFG.enabled;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
    if (powerTimer) { clearInterval(powerTimer); powerTimer = 0; }
    if (CFG.enabled) {
      ratesAnchor = null;
      shipAnchor = null;
      crewLocked = false;
      suppressVollchHell(true);
      tick(reason || 'enable');
      tickTimer = setInterval(() => { try { tick('tick'); } catch (e) {} }, 2000);
      powerTimer = setInterval(() => {
        if (!CFG.enabled) return;
        try { tick('hold'); } catch (e) {}
      }, 500);
      log('灵魂石工具箱：开（已临时接管主脚本的地狱驻军/巡逻、舰队船员控制，并屏蔽三件套与双排桨的供能控制，关闭后还原）');
    } else {
      try { applyWarDronePower(false); } catch (e) {}
      suppressVollchHell(false);
      log('灵魂石工具箱：关（已还原主脚本相关开关、掠食者无人机与双排桨供能控制）');
    }
    try { refreshStats(); } catch (e) {}
  }

  let lastSpireCount = null;
  function climbWatch() {
    try {
      const real = liveGlobal() || g();
      const sp = readSpire(real);
      if (!sp) return;
      if (lastSpireCount != null && sp.count > lastSpireCount) {
        if (CFG.manualOffFloor != null && CFG.manualOffFloor !== sp.count) {
          CFG.manualOffFloor = null;
          saveCfg();
        }
      }
      lastSpireCount = sp.count;
      if (!CFG.autoStartClimb || CFG.enabled) return;
      if (!isClimbingSpire(sp)) return;
      if (CFG.manualOffFloor != null && CFG.manualOffFloor === sp.count) return;
      setEnabled(true, 'auto-climb');
      log('已开始爬塔（第' + sp.count + '层），自动启用灵魂石工具箱');
    } catch (e) {}
  }

  // ---------- UI ----------
  let panel, logEl, statsEl;
  function log(msg) {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (logEl) logEl.textContent = '[' + t + '] ' + msg + '\n' + logEl.textContent;
    try { console.log('[尖塔灵魂石工具箱]', msg); } catch (e) {}
  }
  function bindPanelNodes() {
    const root = (panel && panel.isConnected) ? panel : document.getElementById('soul-gem-kit');
    if (!root) return;
    const s = root.querySelector('#sgk-stats');
    const l = root.querySelector('#sgk-log');
    if (s) statsEl = s;
    if (l) logEl = l;
  }
  let uiTimer = null;
  function startUiRefresh() {
    if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    uiTimer = setInterval(() => { try { refreshStats(); } catch (e) {} }, 500);
  }

  function gemStats(real) {
    const obs = real && real.portal && real.portal.observe && real.portal.observe.stats;
    if (!obs) return null;
    const pick = (src) => {
      const gms = src && src.gems ? src.gems : {};
      return {
        days: src && src.days || 0,
        patrols: gms.patrols || 0,
        guns: gms.guns || 0,
        soul_forge: gms.soul_forge || 0,
        crafted: gms.crafted || 0,
        surveyors: gms.surveyors || 0,
        turrets: gms.turrets || 0
      };
    };
    return { period: pick(obs.period), total: pick(obs.total) };
  }

  function refreshStats() {
    bindPanelNodes();
    if (!statsEl) return;
    if (!isEvolveReady()) { statsEl.textContent = '等待游戏…'; return; }
    try {
      const real = liveGlobal() || g();
      if (!real || !real.portal || !real.portal.fortress) { statsEl.textContent = '未找到地狱堡垒'; return; }
      const st = snapshotState(real);
      const soul = liveSoulGem();
      const gems = soul && typeof soul.amount === 'number' ? soul.amount : ((real.resource && real.resource.Soul_Gem && real.resource.Soul_Gem.amount) || 0);
      const gs = gemStats(real);
      const leftover = st.garrison - st.patrols * st.patrol_size;
      const forgeOk = !st.soulForgeOn || leftover >= st.soulForgeNeeded;
      let html = '';
      html += '威胁 ' + formatInt(st.threat) + '　城墙 ' + formatInt(st.walls) + '%　士兵 ' + formatInt(st.workers) + '/' + formatInt(st.max);
      html += '　伤员 ' + formatInt(st.wounded) + '　军人船员 ' + formatInt(st.crew) + '　地狱驻军 ' + formatInt(st.garrison);
      html += '<br>巡逻 ' + formatInt(st.patrols) + ' × ' + formatInt(st.patrol_size);
      html += '　熔炉 ' + (st.soulForgeOn ? (formatInt(Math.max(0, leftover)) + '/' + formatInt(st.soulForgeNeeded) + (forgeOk ? '（已驻）' : '（缺编）')) : '未开启');
      html += '　灵魂宝石 ' + formatInt(gems);
      if (gs && gs.period) {
        const p = gs.period;
        html += '<br>本期宝石（' + formatInt(p.days) + ' 日）：巡逻 ' + formatInt(p.patrols) + '　炮台 ' + formatInt(p.guns) + '　熔炉 ' + formatInt(p.soul_forge) + '　熔炼 ' + formatInt(p.crafted) + '　勘探 ' + formatInt(p.surveyors);
      }
      if (isWarlord(real)) {
        html += '<br><b style="color:#f66">军阀种族：本脚本不改驻军、巡逻与船员</b>';
      } else if (lastTick && lastTick.plan) {
        const p = lastTick.plan;
        html += '<br>规划：驻军 ' + formatInt(p.garrison) + '　巡逻 ' + formatInt(p.patrols) + '×' + formatInt(p.patrol_size) + '　城防预留 ' + formatInt(p.defense) + '　保留船员 ' + formatInt(lastTick.reservedCrew);
        if (lastTick.crewPlan && lastTick.crewPlan.skipped === 'rate-guard') html += '　（净产告警，已恢复压缩前军舰）';
        else if (lastTick.crewPlan && lastTick.crewPlan.skipped === 'piracy-unknown') html += '　（海盗覆盖无法精确计算，已按补给管线最低保留关船）';
        else if (lastTick.crewPlan && lastTick.crewPlan.reduced) html += '　已关军舰 ' + formatInt(lastTick.crewPlan.reduced.length) + ' 艘（目标船员尽量为 0）';
        if (st.attractorCount) html += '　引诱装置 ' + formatInt(st.attractorOn) + '/' + formatInt(st.attractorCount);
        {
          const leftover = currentPower(real);
          const total = currentPowerTotal(real);
          const rp = readReplicatorPow(real);
          if (total != null || leftover != null) {
            html += '　总电 ' + formatInt(total) + '　余电 ' + (leftover == null ? '—' : formatInt(leftover)) + '　复制器 ' + formatInt(rp);
          }
        }
      }
      {
        const t = (lastTick && lastTick.trio) || (Plan ? Plan.planTrioCaps(st, { gemReserve: CFG.gemReserve, shutdownDrones: !!CFG.shutdownDrones }) : null);
        const droidC = st.warDroidCount != null ? st.warDroidCount : st.warDroidOn;
        const repairC = st.repairDroidCount != null ? st.repairDroidCount : 0;
        const droneC = st.warDroneCount != null ? st.warDroneCount : st.warDroneOn;
        const droidCap = t && t.war_droid ? t.war_droid.cap : droidC;
        const repairCap = t && t.repair_droid ? t.repair_droid.cap : repairC;
        const droneCap = t && t.war_drone ? t.war_drone.cap : droneC;
        html += '<br>战斗机器人 ' + formatInt(droidC) + ' / ' + formatInt(droidCap);
        html += '　修理机器人 ' + formatInt(repairC) + ' / ' + formatInt(repairCap);
        html += '　掠食者无人机 ' + formatInt(st.warDroneOn || 0) + ' 开 / ' + formatInt(droneC) + ' 座';
        if (CFG.shutdownDrones && CFG.enabled) html += '（已关闭供电）';
        else if (t && t.war_drone && t.war_drone.cap != null) html += '　上限 ' + formatInt(droneCap);
      }
      const vollch = CFG.enabled
        ? (document.querySelector('input.script_autoHell') ? '主脚本：已临时暂停地狱/舰队船员控制（关闭后还原）' : '主脚本：未检测到开关，已用回写接管')
        : '主脚本：未接管（本工具默认关闭）';
      html += '<br>' + vollch;
      statsEl.innerHTML = html;
    } catch (e) {
      try { console.warn('[尖塔灵魂石工具箱] 刷新状态失败', e); } catch (e2) {}
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

  const SGK_CSS = `html { --sgk-bg:#1f2526; --sgk-card:#262e2f; --sgk-card2:#2d3637; --sgk-head:#1a2021; --sgk-border:#3b4647; --sgk-text:#e6ecec;
       --sgk-muted:#9aa7a8; --sgk-accent:#48c78e; --sgk-accent2:#ffdd57; --sgk-hover:rgba(255,255,255,.05); --sgk-input:#141a1b;
       --sgk-off:#5a6566; --sgk-shadow:0 2px 10px rgba(0,0,0,.35); }
html.light { --sgk-bg:#f4f6f8; --sgk-card:#ffffff; --sgk-card2:#f7f9fa; --sgk-head:#eef2f4; --sgk-border:#d5dde2; --sgk-text:#1f2a30;
       --sgk-muted:#62717a; --sgk-accent:#1f9d6a; --sgk-accent2:#8a6d00; --sgk-hover:rgba(0,0,0,.04); --sgk-input:#ffffff; --sgk-off:#b8c2c8;
       --sgk-shadow:0 2px 8px rgba(0,0,0,.08); }
html.night, html.redgreen { --sgk-card:#1e1e1e; --sgk-card2:#252525; --sgk-head:#151515; --sgk-border:#363636; --sgk-input:#0e0e0e; }
html.darkNight { --sgk-card:#1e1e1e; --sgk-card2:#242424; --sgk-head:#141414; --sgk-border:#333; --sgk-text:#c4c4c4; --sgk-input:#0e0e0e; --sgk-accent2:#ffcc00; }
html.gruvboxLight { --sgk-bg:#fbf1c7; --sgk-card:#f9f5d7; --sgk-card2:#f2e5bc; --sgk-head:#ebdbb2; --sgk-border:#d5c4a1; --sgk-text:#3c3836; --sgk-muted:#7c6f64;
       --sgk-accent:#79740e; --sgk-accent2:#b57614; --sgk-hover:rgba(60,56,54,.06); --sgk-input:#fbf1c7; --sgk-off:#bdae93; --sgk-shadow:0 2px 8px rgba(60,56,54,.12); }
html.gruvboxDark { --sgk-card:#282828; --sgk-card2:#32302f; --sgk-head:#1d2021; --sgk-border:#504945; --sgk-text:#ebdbb2; --sgk-muted:#a89984;
       --sgk-accent:#b8bb26; --sgk-accent2:#fabd2f; --sgk-input:#1d2021; --sgk-off:#665c54; }
html.orangeSoda { --sgk-card:#1c1f20; --sgk-card2:#242829; --sgk-head:#131516; --sgk-border:#313638; --sgk-text:#ebdbb2; --sgk-accent:#f06543; --sgk-accent2:#f06543; --sgk-input:#0f1112; }
html.dracula { --sgk-card:#282a36; --sgk-card2:#303241; --sgk-head:#21222c; --sgk-border:#44475a; --sgk-text:#f8f8f2; --sgk-muted:#a4a7c0;
       --sgk-accent:#50fa7b; --sgk-accent2:#f1fa8c; --sgk-input:#1e1f29; --sgk-off:#6272a4; }
#soul-gem-kit { position: static; display: block; box-sizing: border-box; width: auto; max-width: none; margin: 0 0 .5rem; padding: 0 0 8px; color: var(--sgk-text);
  background: var(--sgk-card); border: 1px solid var(--sgk-border); border-radius: 12px; box-shadow: var(--sgk-shadow);
  font: 13px/1.5 "Microsoft YaHei", "微软雅黑", sans-serif; }
#soul-gem-kit .sgk-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 6px;
  background: var(--sgk-head); border-bottom: 1px solid var(--sgk-border); border-radius: 12px 12px 0 0; font-weight: 700; font-size: 15px; color: var(--sgk-accent);
  cursor: pointer; user-select: none; }
#soul-gem-kit .sgk-title .sgk-sub { font-weight: normal; font-size: 12px; color: var(--sgk-muted); }
#soul-gem-kit .sgk-caret { display: inline-block; width: 1em; transition: transform .15s; color: var(--sgk-muted); }
#soul-gem-kit.sgk-collapsed { padding-bottom: 0; }
#soul-gem-kit.sgk-collapsed > :not(.sgk-title) { display: none !important; }
#soul-gem-kit.sgk-collapsed > .sgk-title { margin: 0; border-bottom: 0; border-radius: 12px; }
#soul-gem-kit.sgk-collapsed .sgk-caret { transform: rotate(-90deg); }
#soul-gem-kit .sgk-stats { margin: 0 12px 6px; padding: 8px 12px; background: var(--sgk-card2); border: 1px solid var(--sgk-border); border-radius: 10px; line-height: 1.55; }
#soul-gem-kit .sgk-card { margin: 6px 12px; padding: 6px 12px 8px; background: var(--sgk-card2); border: 1px solid var(--sgk-border); border-radius: 10px; }
#soul-gem-kit .sgk-card > b:first-child { display: inline-block; font-size: 14px; color: var(--sgk-text); padding: 1px 0 1px 9px; border-left: 3px solid var(--sgk-accent); margin: 2px 6px 6px 0; }
#soul-gem-kit label { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 4px; border-radius: 8px; cursor: pointer; user-select: none; }
#soul-gem-kit label:hover { background: var(--sgk-hover); }
/* 自隔离：压过主脚本 #portal 绿点规则（与机甲工具箱相同问题） */
#soul-gem-kit input[type=checkbox],
#portal #soul-gem-kit input[type=checkbox] {
  -webkit-appearance: none !important; appearance: none !important; position: relative !important;
  width: 2.5em !important; height: 1.4em !important; min-width: 2.5em !important; margin: 0 !important;
  vertical-align: middle; border: 0 !important; border-radius: 1em !important;
  background: var(--sgk-off) !important; box-shadow: none; box-sizing: border-box; cursor: pointer;
  flex-shrink: 0; font-size: 14px; opacity: 1;
}
#soul-gem-kit input[type=checkbox]::before,
#portal #soul-gem-kit input[type=checkbox]::before {
  content: "" !important; display: block !important; position: absolute !important;
  top: .16em; left: .16em; width: 1.08em !important; height: 1.08em !important;
  border: 0 !important; border-radius: 50% !important; background: #fff !important;
  box-shadow: 0 1px 3px rgba(0,0,0,.35); transform: none; transition: transform .15s;
}
#soul-gem-kit input[type=checkbox]:checked,
#portal #soul-gem-kit input[type=checkbox]:checked {
  background: var(--sgk-accent) !important; border-color: transparent !important;
}
#soul-gem-kit input[type=checkbox]:checked::before,
#portal #soul-gem-kit input[type=checkbox]:checked::before { transform: translateX(1.1em) !important; }
#soul-gem-kit label:hover input[type=checkbox],
#portal #soul-gem-kit label:hover input[type=checkbox] { box-shadow: 0 0 0 3px rgba(72,199,142,.22) !important; }
#soul-gem-kit input[type=number] { height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--sgk-border); background: var(--sgk-input); color: var(--sgk-text); font-size: 13px; vertical-align: middle; width: 64px; }
#soul-gem-kit input:focus { outline: none; border-color: var(--sgk-accent); box-shadow: 0 0 0 2px rgba(72,199,142,.25); }
#soul-gem-kit button.sgk-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--sgk-border); background: var(--sgk-input);
  color: var(--sgk-text); font-size: 13px; cursor: pointer; }
#soul-gem-kit button.sgk-btn:hover { border-color: var(--sgk-accent); filter: brightness(1.08); }
#soul-gem-kit button.sgk-primary { background: var(--sgk-accent); border-color: var(--sgk-accent); color: #fff; }
#soul-gem-kit .sgk-log { margin: 6px 12px 0; max-height: 110px; overflow: auto; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--sgk-border);
  background: var(--sgk-input); color: var(--sgk-text); font: 11.5px/1.5 "Microsoft YaHei", "微软雅黑", ui-monospace, monospace; white-space: pre-wrap; }
#soul-gem-kit .sgk-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#sgk-tip { position: fixed; z-index: 100000; display: none; max-width: 420px; padding: 10px 12px; border-radius: 10px; pointer-events: auto;
  background: var(--sgk-card); background: color-mix(in srgb, var(--sgk-card) 87%, transparent); -webkit-backdrop-filter: blur(6px) saturate(1.1); backdrop-filter: blur(6px) saturate(1.1);
  color: var(--sgk-text); border: 1px solid var(--sgk-border); box-shadow: 0 8px 24px rgba(0,0,0,.35); text-shadow: 0 0 1px var(--sgk-card);
  font: 13px/1.6 "Microsoft YaHei", "微软雅黑", sans-serif; text-align: left; white-space: pre-line; }
#sgk-tip.pinned { border-color: var(--sgk-accent); background: var(--sgk-card); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: 0 8px 24px rgba(0,0,0,.45); text-shadow: none; }
#sgk-tip .sgk-tip-h { font-weight: 700; color: var(--sgk-accent); margin-bottom: 4px; }
#sgk-tip .sgk-tip-f { margin-top: 6px; font-size: 11px; color: var(--sgk-muted); }
#soul-gem-kit .sgk-info { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-left: 6px; border-radius: 50%;
  font-size: 12px; font-weight: 700; color: var(--sgk-muted); border: 1px solid var(--sgk-border); cursor: help; user-select: none; vertical-align: middle; }
#soul-gem-kit .sgk-info:hover { color: var(--sgk-accent); border-color: var(--sgk-accent); }
`;
  function injectStyle() {
    if (document.getElementById('sgk-style')) return;
    const st = document.createElement('style');
    st.id = 'sgk-style';
    st.textContent = SGK_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const SGK_TIPS = {
    'sgk-enabled': '临时爬塔模式。开启后优先于主脚本，暂停其地狱驻军/巡逻和舰队军人船员控制；关闭后原样还原。引诱装置开满，军人船员尽量压到 0，士兵移入地狱多派巡逻。不会打断绯绯色金转补给。',
    'sgk-autostart': '侦测到已开始爬塔（尖塔进度>0，或已通过第1层）后自动打开上方启用开关。若你手动关掉，同一层不会立刻再开，直到进入新一层。',
    'sgk-compress': '尽量把军人船员压到 0：关掉所有可关的军舰，士兵填进地狱增加巡逻。运输船/双排桨和绯绯色金转补给所需的最少军人船员会保留，不打断转换，也不让相关材料净产变负。与补给管线无关的星系，海盗覆盖可以低于 100%。真路飞船暂不改动。',
    'sgk-reserve': '至少保留的军人船员；-1 为自动（只保留补给管线/双排桨所需的最少军人船员，目标尽量为 0）',
    'sgk-home': '留在家园、不派入地狱的士兵',
    'sgk-threat': '仅供巡逻编制参考（威胁高时用较大编制打更大的魔潮）。不会用来关停引诱装置。',
    'sgk-minsize': '巡逻编制下限；0 为自动',
    'sgk-attractor': '引诱装置开满（开启数=建成数）。不因威胁偏高或左上角余电偏少而关停；余电不足时会从复制器腾电。仅当连复制器电力也不够、可能影响绯绯色金转补给时才少开。',

    'sgk-trio': '默认关闭，以节省灵魂宝石。主开关和本项都打开时，才按上限适时建造战斗机器人、修理机器人或掠食者无人机。不会拆已有建筑；电力不够就等，不为它们关掉引诱装置或补给链。',
    'sgk-gem-reserve': '建造三件套时至少留这么多灵魂宝石。低于或等于此数时不花宝石。',
    'sgk-shutdown-drones': '默认开启。主开关打开后把已有掠食者无人机全部停电（不拆除）。它们先出手却不掉灵魂宝石，会抢走巡逻队的恶魔。关闭本项或关掉工具箱时，按备份恢复原来的开启数。',
    'sgk-now': '仅在已启用时立即按当前规划执行一次'
  };

  function installKitTips() {
    if (window.__sgkTipsInstalled) return;
    window.__sgkTipsInstalled = true;
    const SHOW_DELAY = 500, HIDE_GRACE = 150;
    let tip = null, showTimer = 0, hideTimer = 0, pinned = false, curEl = null, pendingEl = null;
    const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    function tipEl() {
      if (!tip) {
        tip = document.createElement('div'); tip.id = 'sgk-tip';
        tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        tip.addEventListener('mouseleave', () => { if (!pinned) scheduleHide(); });
        document.body.appendChild(tip);
      }
      return tip;
    }
    function takeTitle(e) {
      const v = e.getAttribute('title');
      if (v != null) { e.removeAttribute('title'); if (v) e.dataset.sgkTip = v; }
      return e.dataset.sgkTip || '';
    }
    function findTip(t) {
      if (!t || !t.closest || !t.closest('#soul-gem-kit')) return null;
      return t.closest('[title],[data-sgk-tip]');
    }
    function isOpen() { return !!(tip && tip.style.display === 'block'); }
    function hideNow() { clearTimeout(hideTimer); clearTimeout(showTimer); pendingEl = null; pinned = false; curEl = null; if (tip) tip.style.display = 'none'; }
    function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!pinned) hideNow(); }, HIDE_GRACE); }
    function show(e, text, title, pin) {
      if (!text) return;
      const d = tipEl();
      d.innerHTML = (title ? '<div class="sgk-tip-h">' + esc(title) + '</div>' : '') + '<div>' + esc(text) + '</div>'
        + (pin ? '<div class="sgk-tip-f">已固定 · 点空白处关闭</div>' : '');
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
      const q = e.target.closest && e.target.closest('#soul-gem-kit .sgk-info');
      if (q) {
        e.preventDefault(); e.stopPropagation();
        hideNow(); pinned = true;
        const head = q.previousElementSibling;
        show(q, q.dataset.sgkHelp, head ? head.textContent.trim() : '', true);
        return;
      }
      if (pinned && tip && !tip.contains(e.target)) hideNow();
    }, true);
  }

  function syncCfgFromUi() {
    const num = (id, def) => {
      const n = document.getElementById(id);
      if (!n) return def;
      const v = parseInt(n.value, 10);
      return Number.isFinite(v) ? v : def;
    };
    const chk = (id, def) => {
      const n = document.getElementById(id);
      return n ? !!n.checked : def;
    };
    CFG.autoStartClimb = chk('sgk-autostart', CFG.autoStartClimb);
    CFG.compressCrew = chk('sgk-compress', CFG.compressCrew);
    CFG.autoAttractor = chk('sgk-attractor', CFG.autoAttractor);
    CFG.reserveCrew = num('sgk-reserve', CFG.reserveCrew);
    CFG.homeReserve = Math.max(0, num('sgk-home', CFG.homeReserve));
    CFG.threatTarget = Math.max(100, num('sgk-threat', CFG.threatTarget));
    CFG.minPatrolSize = Math.max(0, num('sgk-minsize', CFG.minPatrolSize));
    CFG.autoTrio = chk('sgk-trio', CFG.autoTrio);
    CFG.shutdownDrones = chk('sgk-shutdown-drones', CFG.shutdownDrones);
    CFG.gemReserve = Math.max(0, num('sgk-gem-reserve', CFG.gemReserve));
    saveCfg();
  }

  function mount() {
    if (panel) { placePanel(); startUiRefresh(); return; }
    const existing = document.getElementById('soul-gem-kit');
    if (existing) {
      panel = existing;
      bindPanelNodes();
      placePanel();
      startUiRefresh();
      if (CFG.enabled && !tickTimer) setEnabled(true, 'boot');
      return;
    }
    injectStyle();
    panel = el('div', { id: 'soul-gem-kit' });
    panel.innerHTML = '<div class="sgk-title" role="button" aria-expanded="true"><span class="sgk-caret">▾</span>尖塔灵魂石工具箱 v1.2.1 <span class="sgk-sub">爬塔时临时开启</span></div>';
    statsEl = el('div', { id: 'sgk-stats', class: 'sgk-stats' });
    panel.appendChild(statsEl);

    const box = el('div', { class: 'sgk-card' });
    box.appendChild(el('b', null, '设置'));
    const row = el('div', { class: 'sgk-row' });
    row.appendChild(el('label', { title: SGK_TIPS['sgk-enabled'] }, '<input type="checkbox" id="sgk-enabled"' + (CFG.enabled ? ' checked' : '') + '> 启用（临时优先于主脚本）'));
    row.appendChild(el('label', { title: SGK_TIPS['sgk-autostart'] }, '<input type="checkbox" id="sgk-autostart"' + (CFG.autoStartClimb ? ' checked' : '') + '> 开始爬塔后自动启用'));
    row.appendChild(el('label', { title: SGK_TIPS['sgk-compress'] }, '<input type="checkbox" id="sgk-compress"' + (CFG.compressCrew ? ' checked' : '') + '> 压缩军人船员（尽量为 0）'));
    row.appendChild(el('label', { title: SGK_TIPS['sgk-attractor'] }, '<input type="checkbox" id="sgk-attractor"' + (CFG.autoAttractor ? ' checked' : '') + '> 引诱装置开满'));
    row.appendChild(document.createTextNode('保留船员'));
    row.appendChild(el('input', { id: 'sgk-reserve', type: 'number', step: '1', value: String(CFG.reserveCrew), title: SGK_TIPS['sgk-reserve'] }));
    row.appendChild(document.createTextNode('家园预留'));
    row.appendChild(el('input', { id: 'sgk-home', type: 'number', min: '0', step: '1', value: String(CFG.homeReserve), title: SGK_TIPS['sgk-home'] }));
    row.appendChild(document.createTextNode('巡逻参考威胁'));
    row.appendChild(el('input', { id: 'sgk-threat', type: 'number', min: '100', step: '50', value: String(CFG.threatTarget), title: SGK_TIPS['sgk-threat'] }));
    row.appendChild(document.createTextNode('最小编制'));
    row.appendChild(el('input', { id: 'sgk-minsize', type: 'number', min: '0', step: '1', value: String(CFG.minPatrolSize), title: SGK_TIPS['sgk-minsize'] }));
    const nowBtn = el('button', { type: 'button', id: 'sgk-now', class: 'sgk-btn sgk-primary', title: SGK_TIPS['sgk-now'] }, '立即执行');
    row.appendChild(nowBtn);
    box.appendChild(row);
    panel.appendChild(box);

    const trioBox = el('div', { class: 'sgk-card', id: 'sgk-trio-card' });
    trioBox.appendChild(el('b', null, '灵魂宝石三件套'));
    const trioRow = el('div', { class: 'sgk-row' });
    trioRow.appendChild(el('label', { title: SGK_TIPS['sgk-trio'] }, '<input type="checkbox" id="sgk-trio"' + (CFG.autoTrio ? ' checked' : '') + '> 适时建造'));
    trioRow.appendChild(el('label', { title: SGK_TIPS['sgk-shutdown-drones'] }, '<input type="checkbox" id="sgk-shutdown-drones"' + (CFG.shutdownDrones ? ' checked' : '') + '> 关闭全部掠食者无人机'));
    trioRow.appendChild(document.createTextNode('保留灵魂宝石'));
    trioRow.appendChild(el('input', { id: 'sgk-gem-reserve', type: 'number', min: '0', step: '1', value: String(CFG.gemReserve), title: SGK_TIPS['sgk-gem-reserve'] }));
    trioBox.appendChild(trioRow);
    panel.appendChild(trioBox);

    logEl = el('pre', { id: 'sgk-log', class: 'sgk-log' }, '');
    panel.appendChild(logEl);

    Object.entries(SGK_TIPS).forEach(([id, t]) => {
      const e = panel.querySelector('#' + id);
      if (!e) return;
      const tgt = e.closest('label') || e;
      if (!tgt.getAttribute('title')) tgt.setAttribute('title', t);
    });
    const headB = box.querySelector('b');
    if (headB) {
      const q = document.createElement('span');
      q.className = 'sgk-info'; q.textContent = '?';
      q.dataset.sgkHelp = '默认关闭。启用后临时优先于主脚本，暂停其地狱驻军/巡逻与舰队船员控制，关闭后还原。引诱装置开满；军人船员尽量压到 0，士兵移入地狱多派巡逻；熔炉预留编制；不减补给运输/双排桨所需船员，不打断绯绯色金转补给，也不让相关材料净产变负。若手动关闭，同一层不会自动再开。';
      q.setAttribute('aria-label', '说明');
      headB.insertAdjacentElement('afterend', q);
    }
    const trioHead = trioBox.querySelector('b');
    if (trioHead) {
      const q2 = document.createElement('span');
      q2.className = 'sgk-info'; q2.textContent = '?';
      q2.dataset.sgkHelp = '适时建造默认关，以节省灵魂宝石。上限按巡逻能否吃完可用恶魔计算，恶魔不够杀时不再加建。关闭全部掠食者无人机默认开：主开关打开后把已建无人机停电（不拆除），避免它们先出手却不掉宝石；关闭本项或关掉工具箱时按备份恢复。';
      q2.setAttribute('aria-label', '说明');
      trioHead.insertAdjacentElement('afterend', q2);
    }
    installKitTips();
    placePanel();
    installCollapse();

    document.getElementById('sgk-enabled').onchange = (e) => { setEnabled(e.target.checked, 'manual'); };
    ['sgk-autostart', 'sgk-compress', 'sgk-attractor', 'sgk-reserve', 'sgk-home', 'sgk-threat', 'sgk-minsize', 'sgk-trio', 'sgk-gem-reserve', 'sgk-shutdown-drones'].forEach((id) => {
      const n = document.getElementById(id);
      if (!n) return;
      n.onchange = () => {
        const prevShutdown = CFG.shutdownDrones;
        syncCfgFromUi();
        if (CFG.enabled) {
          suppressVollchHell(true);
          if (id === 'sgk-shutdown-drones' && prevShutdown && !CFG.shutdownDrones) {
            try { applyWarDronePower(false); } catch (e) {}
          }
          tick('manual');
        }
        refreshStats();
        log('参数已更新');
      };
    });
    document.getElementById('sgk-now').onclick = () => {
      syncCfgFromUi();
      if (!CFG.enabled) { log('请先启用（临时优先于主脚本）'); return; }
      const r = tick('manual');
      log(statusSummary(r));
      refreshStats();
    };

    refreshStats();
    startUiRefresh();
    if (CFG.enabled) setEnabled(true, 'boot');
    else {
      try {
        if (localStorage.getItem(VOLLCH_BACKUP_KEY)) suppressVollchHell(false);
        if (localStorage.getItem(DRONE_BACKUP_KEY)) applyWarDronePower(false);
      } catch (e) {}
      log('尖塔灵魂石工具箱 v1.2.1 已挂载（默认关闭，开始爬塔后可自动启用）');
      climbWatch();
    }

    window.SoulGemKit = {
      CFG, Plan, findRealGlobal, liveGlobal, liveFortress, liveGarrison, liveSoulGem,
      soulForgeSoldiers, jobScale, armyRatingFn, planCrewCompression, applyShipPlan,
      planAttractors, applyAttractors, snapshotState, applyFortress, tick, setEnabled,
      suppressVollchHell, piracyCover, snapshotOn, snapshotDefense, canComputePiracy,
      currentGalaxyMil, currentTpCrew, galaxyMilForOn, refreshStats,
      protectedMilCrew, relatedRates, readSpire, isClimbingSpire, climbWatch,
      shipMil, shipRating, liveGalaxyStruct, liveSettings, assembleLiveGlobal,
      pipelineNeeds, cargoResources, ratesViolated, portalProtectedMil, currentPower, currentPowerTotal,
      liveReplicator, liveCityReplicator, readReplicatorPow, applyReplicatorDrain,
      vollchConflictKeys,
      planTrioCaps: (st, cfg) => Plan.planTrioCaps(st, cfg),
      tryBuildTrio, applyWarDronePower, liveWritablePortalStruct,
      readDroneBackup, clearDroneBackup,
      applyBiremeKeepOn, biremeRequiredCrew, biremeInsts, biremeMilPerShip,
      readVollchFlagDom, trioPowerKeys, biremePowerKeys, powerControlKeys, ensureBuildingSettingsTable, isBuildingSettingsOpen,
      get lastTick() { return lastTick; }
    };
  }

  function boot() {
    if (!isEvolveReady()) return false;
    mount();
    return true;
  }

  function placePanel() {
    if (!panel) return false;
    const fort = document.getElementById('fort');
    const parent = document.getElementById('portal') || (fort && fort.parentNode);
    if (!fort || !parent || (parent.id === 'portal' && !parent.contains(fort))) {
      if (panel.parentNode) panel.remove();
      return false;
    }
    const ok = panel.parentNode === parent && panel.nextElementSibling === fort;
    if (ok) return true;
    document.querySelectorAll('#soul-gem-kit').forEach((d) => { if (d !== panel) d.remove(); });
    const active = document.activeElement;
    const hadFocus = active && panel.contains(active);
    parent.insertBefore(panel, fort);
    if (hadFocus && document.activeElement !== active) { try { active.focus({ preventScroll: true }); } catch (e) {} }
    try { refreshStats(); } catch (e) {}
    return true;
  }
  function installCollapse() {
    const head = panel.querySelector('.sgk-title');
    if (!head) return;
    const apply = (c) => {
      panel.classList.toggle('sgk-collapsed', c);
      head.setAttribute('aria-expanded', c ? 'false' : 'true');
    };
    let c = false;
    try { c = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}
    apply(c);
    head.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.sgk-info')) return;
      const now = !panel.classList.contains('sgk-collapsed');
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
          if (panel && (r.target === panel || panel.contains(r.target))) continue;
          schedulePlace();
          return;
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(() => { schedulePlace(); climbWatch(); }, 2000);
  }
  if (!boot()) {
    const bootTimer = setInterval(() => { if (boot()) clearInterval(bootTimer); }, 1000);
  }
  startWatch();
})();
