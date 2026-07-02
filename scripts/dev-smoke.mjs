#!/usr/bin/env node
/* Headless smoke test for PlugIdle. Stubs just enough DOM to load js/game.js
   in Node, exposes the IIFE's internals via a test-only suffix injected at
   load time (shipped code is untouched), then drives the critical paths:
   boot -> buy ??? -> wormhole -> zap/kill/waves -> boss -> weapon buys ->
   world switch -> prestige (slayer must survive) -> save roundtrip.

   Run: node scripts/dev-smoke.mjs   (exits non-zero on failure) */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------- minimal DOM stub ---------- */
const elements = new Map();           // id/selector -> element (stable identity)
function makeEl(tag = 'div') {
  const listeners = {};
  const children = [];
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, hidden: false,
    textContent: '', innerHTML: '', value: '', disabled: false, offsetWidth: 1,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, v) => { (v === undefined ? !classes.has(c) : v) ? classes.add(c) : classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire: (ev, arg) => { (listeners[ev] || []).forEach((fn) => fn(arg || { target: el })); },
    appendChild: (c) => { children.push(c); return c; },
    remove: () => {}, setAttribute: () => {}, getAttribute: () => null,
    closest: () => null, querySelector: () => makeEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    animate: () => ({}),
  };
  return el;
}
const byKey = (key) => { if (!elements.has(key)) elements.set(key, makeEl()); return elements.get(key); };

global.window = global;
global.addEventListener = () => {};
global.document = {
  hidden: false,
  body: Object.assign(makeEl('body'), {}),
  getElementById: (id) => byKey('#' + id),
  querySelector: (sel) => byKey(sel),
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag),
  addEventListener: () => {},
};
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'smoke' }, configurable: true });
global.matchMedia = () => ({ matches: false });
// Node has no rAF; a no-op (that never calls back) keeps the render loop from
// spinning during the headless run while letting boot()'s startRender() succeed.
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

/* ---------- seed a late-game save (2e15 cores, curve v2) ---------- */
const now = Date.now();
store.set('cordTycoon.save.v1', JSON.stringify({
  watts: 1e6, totalEarned: 1e6, cores: 2e15, coresEarned: 2e15,
  prestigeV: 2, lastSeen: now, startedAt: now,
}));

/* ---------- load game.js with a test-only exposure suffix ---------- */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let src = readFileSync(join(root, 'js', 'game.js'), 'utf8');
const hook = `
  window.__test = {
    get state() { return state; },
    CORE_UPGRADES, WEAPONS, ZAP_UPGRADES, CHALLENGES, CORDS, UPGRADES, ACHIEVEMENTS,
    buyCoreUpgrade, zapEnemy, buyWeapon, buyZapUpgrade, switchWorld,
    totalZps, zapPower, bossWattsMult, gridZpsBoost, prestigeGain, prestigeMult,
    carryState, defaultState, normalizeState, defaultSlayer, applyZapDamage, spawnEnemy,
    autoBuyTick, autoBuyUpgrades, autoTapRate, autoTapGainPerSec, clickPowerFlat, clickPower, clickMult, tapWpsFrac, totalWps,
    maxAffordable, cordCost,
    reincarnate, reincarnateGain, shardMult, sl, su, killEnemy,
    sg, SURGE_NODES, buySurgeNode, surgeNodeUnlocked, saveSurgePreset, loadSurgePreset, dischargeReady, fireDischarge,
    surgeZpsMult, surgeTapMult, surgeAutoRate, surgeVoltMult, surgeShardMult, surgeCritChance, surgeCritMult,
    STORM_UPGRADES, buyStormUpgrade,
    autoBuyWeaponsTick, autoBuyZapUpgrades, slayerTick, AUTO_ZAP_RATE, resetSlayerRun,
    awardZaps, zapMilestoneMult, zapMilestonesPassed, nextZapMilestone, milestoneMult, milestonesPassed,
    ch, chDone, startChallenge, beginChallenge, checkChallenge, abandonChallenge, restoreChallengeBackup,
    chTier, chMaxTier, chGoalFor, chFullyDone, trialGridBoost,
    weaponCost, weaponCostGrowth, VOLT_COST_GROWTH, enemyHp, voltReward, weaponMultiplier, applyReincarnatePerks,
    weaponBuyCount, maxAffordableWeapon,
    renderMoreGating, syncSettingsUI, applyWorld, co,
    applyOffline, offlineEff, offlineCapMs,
    grantPurchase, grantBoost, markAdUse, adUsesLeft, iapProdMult, syncBoostBuff,
    IAP_PRODUCTS, AD_LIMITS, BOOST_MS, buffMult, localDay,
  };
})();`;
if (!src.endsWith('})();\n')) throw new Error('unexpected game.js tail');
src = src.slice(0, src.lastIndexOf('})();')) + hook;
eval(src);

/* ---------- assertions ---------- */
let failures = 0;
const check = (name, ok) => {
  console.log((ok ? '  ok ' : 'FAIL ') + name);
  if (!ok) failures++;
};

await new Promise((r) => setTimeout(r, 150));   // let async boot() finish
const T = window.__test;
const S = () => T.state;

check('boot: save loaded (2e15 cores)', S().cores === 2e15);
check('boot: world starts grid', (document.body.dataset.world || 'grid') === 'grid');

// buy ??? (instant path: disable animations first)
S().settings.floats = false;
const mystery = T.CORE_UPGRADES.find((c) => c.id === 'mystery');
check('content: ??? exists at 1e15', mystery && mystery.cost === 1e15);
T.buyCoreUpgrade(mystery);
check('wormhole: flag set', S().wormhole === true);
check('wormhole: world is volt', S().world === 'volt');
check('wormhole: enemy spawned', S().slayer.maxHp > 0);
check('wormhole: achievement granted', !!S().achievements.worm1);
check('wormhole: cores deducted', S().cores === 1e15);

// zap until first kill (wave 1 enemy = 10 HP, zapPower >= 1)
const zapsNeeded = Math.ceil(S().slayer.maxHp / T.zapPower()) + 2;
for (let i = 0; i < zapsNeeded; i++) T.zapEnemy();
check('combat: first kill counted', S().slayer.kills >= 1);
check('combat: volts earned', S().slayer.volts > 0);
check('combat: kill achievement', !!S().achievements.kill1);

// grind to the wave-10 boss and beyond (cap iterations for safety)
let guard = 2e5;
while (S().slayer.bosses < 1 && guard-- > 0) T.applyZapDamage(T.zapPower() * 5);
check('combat: boss killed', S().slayer.bosses >= 1);
check('combat: boss achievement', !!S().achievements.boss1);
check('synergy: bossWattsMult > 1', T.bossWattsMult() > 1);
check('combat: wave advanced past 10', S().slayer.wave >= 11);

// balance: volt income must stay FLAT across waves (no compounding decay). Base 2.6
// sets reward/HP at ~0.26× per ZPS — ~2.5× slower than the original 0.8 (base 8);
// rewards were doubled from base 1.3 because progression felt too slow.
const voltRatio = (w) => T.voltReward(w) / T.enemyHp(w);
check('balance: volt reward/HP ratio ~0.26 (rewards doubled from 0.13)', Math.abs(voltRatio(3) - 0.26) < 1e-9);
check('balance: volt income ratio flat across waves (no decay)', Math.abs(voltRatio(3) - voltRatio(53)) < 1e-6);

// weapon purchase
S().slayer.volts = 1e6;
const glove = T.WEAPONS[0];
T.buyWeapon(glove);
check('arsenal: weapon bought', S().slayer.weapons.glove === 1);
check('arsenal: totalZps > 0', T.totalZps() > 0);

// bulk-buy weapons (shared state.bulk, mirrors the Grid cord bulk path)
S().slayer.volts = 1e9;
S().bulk = 5;
const ownedBefore = S().slayer.weapons.glove;
check('bulk: weaponBuyCount honors x5', T.weaponBuyCount(glove) === 5);
T.buyWeapon(glove);
check('bulk: x5 buys 5 at once', S().slayer.weapons.glove === ownedBefore + 5);
S().bulk = 'max';
const maxN = T.maxAffordableWeapon(glove);
check('bulk: max affordable is positive', maxN > 0);
const maxCost = T.weaponCost(glove, maxN);
check('bulk: max stays within volts (never overspends)', maxCost <= S().slayer.volts);
const voltsBefore = S().slayer.volts;
T.buyWeapon(glove);
check('bulk: max buy succeeds', S().slayer.weapons.glove === ownedBefore + 5 + maxN);
check('bulk: max buy charged volts', S().slayer.volts < voltsBefore);
S().bulk = 1;   // restore default for later assertions
const zu = T.ZAP_UPGRADES[0];
T.buyZapUpgrade(zu);
check('arsenal: zap upgrade bought', !!S().slayer.upgrades[zu.id]);
check('synergy: gridZpsBoost > 1', T.gridZpsBoost() > 1);

// world switch both ways
T.switchWorld();
check('travel: back to grid', S().world === 'grid');
T.switchWorld();
check('travel: back to volt', S().world === 'volt');

// prestige carry: slayer must survive a grid reset
const before = JSON.stringify(S().slayer);
const carried = Object.assign(T.defaultState(), T.carryState({}));
check('carry: slayer survives reset', JSON.stringify(carried.slayer) === before);
check('carry: wormhole survives reset', carried.wormhole === true);
check('carry: lifetimeEarned survives reset', carried.lifetimeEarned === S().lifetimeEarned);

// save roundtrip through normalizeState (export/import path)
const round = T.normalizeState(JSON.parse(JSON.stringify(S())));
check('save: roundtrip keeps wormhole', round.wormhole === true);
check('save: roundtrip keeps weapons', round.slayer.weapons.glove === S().slayer.weapons.glove);
check('save: legacy save gets slayer backfilled', T.normalizeState({ watts: 5 }).slayer.wave === 1);

// Update safety: a save carrying purchases (cords, upgrades, core/prestige
// upgrades, IAP entitlements) must survive normalizeState + a JSON roundtrip with
// EVERY entitlement intact — the guarantee that shipping an update never wipes a
// player's owned content. prestigeV:2 marks it a current save (no legacy rebase).
{
  const buy = {
    prestigeV: 2,
    owned: { usba: 42, hdmi: 7, quantum: 1 },
    upgrades: { u_click1: true, u_usba: true, syn1: true },
    coreUpgrades: { autotap: true, autotap20: true, thumbs: true },
    iap: { supporter_pack: true, theme_pack_phosphor: true },
    cores: 9, coresEarned: 50,
  };
  const after = T.normalizeState(JSON.parse(JSON.stringify(buy)));
  check('update-safety: owned cords preserved', after.owned.usba === 42 && after.owned.hdmi === 7 && after.owned.quantum === 1);
  check('update-safety: upgrades preserved', !!(after.upgrades.u_click1 && after.upgrades.u_usba && after.upgrades.syn1));
  check('update-safety: core (prestige) upgrades preserved', !!(after.coreUpgrades.autotap && after.coreUpgrades.autotap20 && after.coreUpgrades.thumbs));
  check('update-safety: IAP entitlements preserved', !!(after.iap.supporter_pack && after.iap.theme_pack_phosphor));
  check('update-safety: cores preserved', after.cores === 9 && after.coresEarned === 50);
  // A future defaultState() field must NOT clobber a save's ownership maps:
  check('update-safety: ownership map not reset by defaults merge', T.normalizeState({ prestigeV: 2, owned: { onlyone: 3 } }).owned.onlyone === 3);
}

// Stage 1 — new slayer reincarnation fields backfill on legacy/imported saves
const sl0 = T.normalizeState({ watts: 5 }).slayer;
check('migrate: runVolts backfilled to 0', sl0.runVolts === 0);
check('migrate: shards backfilled to 0', sl0.shards === 0);
check('migrate: shardsEarned backfilled to 0', sl0.shardsEarned === 0);
check('migrate: shardUpgrades is an object', sl0.shardUpgrades && typeof sl0.shardUpgrades === 'object');
check('migrate: null shardUpgrades coerced to object',
  (() => { const o = T.normalizeState({ slayer: { shardUpgrades: null } }).slayer.shardUpgrades; return o && typeof o === 'object'; })());
check('migrate: defaultSlayer exposes the 4 new fields',
  (() => { const d = T.defaultSlayer(); return d.runVolts === 0 && d.shards === 0 && d.shardsEarned === 0 && typeof d.shardUpgrades === 'object'; })());

// Stage 1 — per-world settings shape + legacy flat-toggle migration
check('migrate: new save has world.volt.autoclickOn', T.normalizeState({}).settings.world.volt.autoclickOn === true);
check('migrate: new save has world.grid automation', (() => { const g = T.normalizeState({}).settings.world.grid; return g.autobuyOn === true && g.autoupgOn === true; })());
check('migrate: legacy flat autobuyOn -> grid', T.normalizeState({ settings: { autobuyOn: false } }).settings.world.grid.autobuyOn === false);
check('migrate: legacy flat autoupgOn -> grid', T.normalizeState({ settings: { autoupgOn: false } }).settings.world.grid.autoupgOn === false);
check('migrate: legacy flat migration keeps volt defaults', T.normalizeState({ settings: { autobuyOn: false } }).settings.world.volt.autoclickOn === true);
check('migrate: legacy flat toggles removed from top-level', (() => { const st = T.normalizeState({ settings: { autobuyOn: false } }).settings; return st.autobuyOn === undefined && st.autoupgOn === undefined; })());
check('migrate: partial world save keeps volt subtree', T.normalizeState({ settings: { world: { grid: { autobuyOn: false } } } }).settings.world.volt.autoclickOn === true);
check('migrate: device prefs stay global', (() => { const st = T.normalizeState({ settings: { floats: false } }).settings; return st.floats === false && st.sound === true; })());

// Stage 1 — challenges migration (single -> per-world)
check('migrate: legacy challenge -> grid slot', T.normalizeState({ challenge: 'solo' }).challenges.grid === 'solo');
check('migrate: legacy challenge leaves volt empty', T.normalizeState({ challenge: 'solo' }).challenges.volt === '');
check('migrate: legacy challenge field removed', T.normalizeState({ challenge: 'solo' }).challenge === undefined);
check('migrate: new save has both challenge slots', (() => { const c = T.normalizeState({}).challenges; return c.grid === '' && c.volt === ''; })());

// Stage 2 — Storm Reactor reincarnation: resets run, keeps lifetime, Grid untouched
{
  const sR = T.sl();
  // a mid-run slayer state worth reincarnating
  sR.runVolts = 1e9; sR.volts = 5000; sR.wave = 23; sR.killsThisWave = 4;
  sR.kills = 5; sR.bosses = 2; sR.totalVolts = 1e6;
  sR.weapons = { glove: 3 }; sR.upgrades = { z_zap1: true };
  sR.shards = 0; sR.shardsEarned = 0;
  S().challenges.volt = 'staticcling';
  // snapshot Grid + cross-world synergy inputs
  const gridSnap = JSON.stringify({ watts: S().watts, owned: S().owned, upgrades: S().upgrades,
    cores: S().cores, coresEarned: S().coresEarned, coreUpgrades: S().coreUpgrades,
    lifetimeEarned: S().lifetimeEarned });
  const bossesBefore = sR.bosses, totalVoltsBefore = sR.totalVolts;
  const gainExpect = T.reincarnateGain();
  check('reincarnate: gain positive with big runVolts', gainExpect > 0);
  T.reincarnate();
  check('reincarnate: runVolts reset', T.sl().runVolts === 0);
  check('reincarnate: volts reset', T.sl().volts === 0);
  check('reincarnate: wave reset to 1', T.sl().wave === 1);
  check('reincarnate: killsThisWave reset', T.sl().killsThisWave === 0);
  check('reincarnate: weapons cleared', Object.keys(T.sl().weapons).length === 0);
  check('reincarnate: zap upgrades cleared', Object.keys(T.sl().upgrades).length === 0);
  check('reincarnate: wave-1 enemy respawned', T.sl().maxHp > 0 && T.sl().hp > 0);
  check('reincarnate: volt challenge cleared', S().challenges.volt === '');
  check('reincarnate: totalVolts kept', T.sl().totalVolts === totalVoltsBefore);
  check('reincarnate: kills kept', T.sl().kills === 5);
  check('reincarnate: bosses kept', T.sl().bosses === bossesBefore);
  check('reincarnate: shards awarded', T.sl().shards === gainExpect && gainExpect > 0);
  check('reincarnate: shardsEarned awarded', T.sl().shardsEarned === gainExpect);
  check('reincarnate: Grid state untouched', JSON.stringify({ watts: S().watts, owned: S().owned, upgrades: S().upgrades,
    cores: S().cores, coresEarned: S().coresEarned, coreUpgrades: S().coreUpgrades,
    lifetimeEarned: S().lifetimeEarned }) === gridSnap);
  // gain<=0 guard: a fresh-ish run awards nothing and mutates nothing
  T.sl().runVolts = 0;
  const shardsBefore = T.sl().shards, waveBefore = T.sl().wave;
  T.sl().wave = 7;
  T.reincarnate();
  check('reincarnate: no-op when gain is 0', T.sl().shards === shardsBefore && T.sl().wave === 7);
  T.sl().wave = waveBefore;
}

// Stage 2 — shardMult rises with shardsEarned and respects the softcap
{
  const sR = T.sl();
  const baseEarned = sR.shardsEarned;
  sR.shardsEarned = 0;
  check('shardMult: 1.0 at zero shards', T.shardMult() === 1);
  sR.shardsEarned = 10;
  const m10 = T.shardMult();
  sR.shardsEarned = 50;
  const m50 = T.shardMult();
  check('shardMult: rises with shardsEarned', m50 > m10 && m10 > 1);
  // below softcap (per=0.05, cap=10): raw = 1 + 0.05*n is linear
  check('shardMult: linear below softcap (10 shards => 1.5)', Math.abs(m10 - 1.5) < 1e-9);
  // far past the softcap knee (180 shards): sqrt-dampened, sublinear
  sR.shardsEarned = 100000;
  const big = T.shardMult();
  const raw = 1 + 0.05 * 100000;
  check('shardMult: softcap sqrt-dampened past knee', Math.abs(big - 10 * Math.sqrt(raw / 10)) < 1e-6 && big < raw);
  sR.shardsEarned = baseEarned;
}

// Stage 2 — totalZps scales with shardMult (the volt analog of prestigeMult)
{
  const sR = T.sl();
  sR.weapons = { glove: 5 };
  const earnedSave = sR.shardsEarned;
  sR.shardsEarned = 0;
  const z0 = T.totalZps();
  sR.shardsEarned = 100;
  const z1 = T.totalZps();
  check('totalZps: scales with shardsEarned', z1 > z0 && z0 > 0);
  sR.shardsEarned = earnedSave;
  sR.weapons = {};
}

// Stage 3 — Storm Upgrades shop: catalogue, effects, teaser is non-purchasable
{
  const SU = T.STORM_UPGRADES;
  check('content: 29 storm upgrades', SU.length === 29);
  const teaser = SU[SU.length - 1];
  check('storm: w3teaser is last', teaser.id === 'w3teaser');
  check('storm: w3teaser is disabled', teaser.disabled === true);
  check('storm: w3teaser desc says coming soon', /Coming soon/.test(teaser.desc));

  const sR = T.sl();
  sR.shardUpgrades = {};
  sR.weapons = {};
  // livewire: tap-zap power ×3
  const zp0 = T.zapPower();
  sR.shards = 1e12;
  T.buyStormUpgrade(SU.find((u) => u.id === 'livewire'));
  check('storm: livewire owned after buy', sR.shardUpgrades.livewire === true);
  check('storm: livewire triples tap-zap power', Math.abs(T.zapPower() - zp0 * 3) < 1e-6);

  // overvolt: all ZPS ×2 (needs a weapon to produce nonzero ZPS)
  sR.weapons = { glove: 5 };
  const z0 = T.totalZps();
  T.buyStormUpgrade(SU.find((u) => u.id === 'overvolt'));
  check('storm: overvolt doubles totalZps', Math.abs(T.totalZps() - z0 * 2) < 1e-6 && z0 > 0);

  // w3teaser is a no-op: cannot be bought, shards untouched
  const shardsBefore = sR.shards;
  T.buyStormUpgrade(teaser);
  check('storm: w3teaser cannot be bought', !sR.shardUpgrades.w3teaser && sR.shards === shardsBefore);

  sR.shardUpgrades = {};
  sR.weapons = {};
  sR.shards = 0;
}

// Stage 4 — Voltlands automation: Auto-Arsenal / Auto-Tinker / Auto-Zapper
{
  const sR = T.sl();
  check('content: AUTO_ZAP_RATE is 5', T.AUTO_ZAP_RATE === 5);

  // Auto-Arsenal: cheapest-first weapon buyer, gated by volt.autobuyOn
  sR.shardUpgrades = { autoarsenal: true };
  sR.weapons = {};
  sR.upgrades = {};
  sR.volts = 1e6;
  S().settings.world.volt.autobuyOn = true;
  T.autoBuyWeaponsTick();
  const weaponCount = () => T.WEAPONS.reduce((n, w) => n + (sR.weapons[w.id] || 0), 0);
  check('auto-arsenal: buys >=1 weapon when on', weaponCount() >= 1);
  S().settings.world.volt.autobuyOn = false;
  sR.volts = 1e6;
  const armBefore = weaponCount();
  T.autoBuyWeaponsTick();
  check('auto-arsenal: toggle off stops buying', weaponCount() === armBefore);
  // owning the upgrade is required, too
  S().settings.world.volt.autobuyOn = true;
  sR.shardUpgrades = {};
  sR.weapons = {};
  sR.volts = 1e6;
  T.autoBuyWeaponsTick();
  check('auto-arsenal: no-op without the upgrade', weaponCount() === 0);

  // Auto-Tinker: cheapest-first zap-upgrade buyer, gated by volt.autoupgOn
  sR.shardUpgrades = { autotinker: true };
  sR.upgrades = {};
  sR.weapons = { glove: 6 };   // unlock the glove weapon upgrade too
  sR.volts = 1e6;
  S().settings.world.volt.autoupgOn = true;
  T.autoBuyZapUpgrades();
  check('auto-tinker: buys >=1 zap upgrade when on', Object.keys(sR.upgrades).length >= 1);
  S().settings.world.volt.autoupgOn = false;
  sR.upgrades = {};
  sR.volts = 1e6;
  T.autoBuyZapUpgrades();
  check('auto-tinker: toggle off stops buying', Object.keys(sR.upgrades).length === 0);
  sR.shardUpgrades = {};
  sR.upgrades = {};
  T.autoBuyZapUpgrades();
  check('auto-tinker: no-op without the upgrade', Object.keys(sR.upgrades).length === 0);

  // Auto-Zapper: passive tap-zaps inside slayerTick, gated by volt.autoclickOn
  sR.shardUpgrades = { autozap: true };
  sR.weapons = {};                       // no weapons => totalZps() === 0
  sR.upgrades = {};
  sR.wave = 1; sR.killsThisWave = 0;
  T.spawnEnemy();
  check('auto-zapper: totalZps is 0 with no weapons', T.totalZps() === 0);
  S().settings.world.volt.autoclickOn = true;
  const killsBefore = sR.kills;
  for (let i = 0; i < 50; i++) T.slayerTick(1);   // many seconds of auto-zaps
  check('auto-zapper: kills advance when on', sR.kills > killsBefore);
  S().settings.floats = true;                        // the pulse respects the animations toggle (off since L119)
  T.slayerTick(1);                                   // one more auto-zap, now with animations on
  check('auto-zapper: fires the enemy zap-flash animation (parity with auto-tapper)', document.getElementById('enemyBtn').classList.contains('zapped'));
  S().settings.floats = false;                       // restore the harness default
  S().settings.world.volt.autoclickOn = false;
  sR.wave = 1; sR.killsThisWave = 0;
  T.spawnEnemy();
  const killsOff = sR.kills;
  for (let i = 0; i < 50; i++) T.slayerTick(1);
  check('auto-zapper: toggle off applies no damage', sR.kills === killsOff);

  sR.shardUpgrades = {};
  sR.weapons = {};
  sR.upgrades = {};
  sR.volts = 0;
  S().settings.world.volt.autoclickOn = true;
}

// Stage 5 — per-world challenges: data, filtering, world-aware rules + perks
{
  // content counts (6 grid + 6 volt = 12)
  check('content: 14 challenges total', T.CHALLENGES.length === 14);
  check('content: 6 grid challenges', T.CHALLENGES.filter((c) => c.world === 'grid').length === 6);
  check('content: 8 volt challenges', T.CHALLENGES.filter((c) => c.world === 'volt').length === 8);
  check('content: every challenge has a world', T.CHALLENGES.every((c) => c.world === 'grid' || c.world === 'volt'));
  // filtering: a volt-only set excludes the legacy grid ids
  const voltIds = T.CHALLENGES.filter((c) => c.world === 'volt').map((c) => c.id);
  check('challenges: volt set excludes grid ids', !voltIds.includes('solo') && !voltIds.includes('brownout'));

  // snapshot state we mutate
  const worldSave = S().world;
  const chSave = JSON.parse(JSON.stringify(S().challenges));
  const doneSave = JSON.parse(JSON.stringify(S().challengesDone || {}));
  const sR = T.sl();
  const slSave = JSON.parse(JSON.stringify(sR));

  // ch() is world-aware: defaults to the active world, explicit arg overrides
  S().world = 'volt';
  S().challenges = { grid: 'solo', volt: 'staticcling' };
  check('ch: defaults to active world (volt)', T.ch() === 'staticcling');
  check('ch: explicit grid arg reads grid slot', T.ch('grid') === 'solo');
  S().world = 'grid';
  check('ch: defaults to active world (grid)', T.ch() === 'solo');

  // per-world active rule: STATIC CLING halves volt ZPS (the volt economy ticks
  // regardless of foreground world) but never touches grid production.
  sR.shardUpgrades = {}; sR.upgrades = {}; sR.weapons = { glove: 5 };
  S().world = 'volt';
  S().challenges = { grid: '', volt: '' };
  const zVoltClear = T.totalZps();
  const wGridClear = T.totalWps();
  S().challenges.volt = 'staticcling';
  const zVoltCling = T.totalZps();
  const wGridCling = T.totalWps();
  S().challenges.volt = '';
  check('challenge: STATIC CLING halves volt ZPS', Math.abs(zVoltCling - zVoltClear * 0.5) < 1e-6 && zVoltClear > 0);
  check('challenge: volt challenge never touches grid production', Math.abs(wGridCling - wGridClear) < 1e-9);

  // NUMB FINGERS rule: tap-zap earns nothing while active (volt world)
  S().world = 'volt';
  S().challenges.volt = 'numbfingers';
  check('challenge: NUMB FINGERS zeros zapPower', T.zapPower() === 0);
  S().challenges.volt = '';
  check('challenge: cleared NUMB FINGERS restores zapPower', T.zapPower() > 0);

  // POWER DRAIN rule: weapon cost growth steepens (1.18 vs the 1.16 Volt base) while
  // active. Measured over 12 buys so the growth gap dwarfs per-buy ceil() rounding.
  sR.weapons = {};
  const wg = T.WEAPONS[0];
  const baseCost2 = T.weaponCost(wg, 12);
  S().challenges.volt = 'powerdrain';
  const drainCost2 = T.weaponCost(wg, 12);
  S().challenges.volt = '';
  check('challenge: POWER DRAIN steepens weapon cost', drainCost2 > baseCost2);

  // SUDDEN DEATH rule: boss HP ×3 while active
  const bossBase = T.enemyHp(10);
  S().challenges.volt = 'suddendeath';
  const bossSudden = T.enemyHp(10);
  const mobSudden = T.enemyHp(9);   // non-boss unaffected
  S().challenges.volt = '';
  check('challenge: SUDDEN DEATH triples boss HP', Math.abs(bossSudden - bossBase * 3) < 1e-6);
  check('challenge: SUDDEN DEATH spares non-boss HP', Math.abs(mobSudden - T.enemyHp(9)) < 1e-6);

  // BARE KNUCKLES rule: only the glove can be bought while active
  sR.volts = 1e9; sR.weapons = {};
  S().challenges.volt = 'bareknuckle';
  T.buyWeapon(T.WEAPONS[1]);    // tongs — blocked
  check('challenge: BARE KNUCKLES blocks non-glove buy', (sR.weapons.tongs || 0) === 0);
  T.buyWeapon(T.WEAPONS[0]);    // glove — allowed
  check('challenge: BARE KNUCKLES allows glove buy', (sR.weapons.glove || 0) >= 1);
  S().challenges.volt = '';
  sR.weapons = {};

  // perks: completing a volt challenge grants a permanent perk
  // KNUCKLE BUSTER (bareknuckle) — Static Glove ×5
  const mGlove0 = T.weaponMultiplier('glove');
  S().challengesDone = Object.assign({}, doneSave, { bareknuckle: true });
  check('perk: KNUCKLE BUSTER multiplies glove ×5', Math.abs(T.weaponMultiplier('glove') - mGlove0 * 5) < 1e-6);
  // CONDUCTIVE GRIP (numbfingers) — reincarnation head-start of 5 gloves
  S().challengesDone = Object.assign({}, doneSave, { numbfingers: true });
  sR.weapons = {}; sR.upgrades = {};
  S().challenges.volt = '';
  T.applyReincarnatePerks();
  check('perk: CONDUCTIVE GRIP starts run with 5 gloves', (sR.weapons.glove || 0) >= 5);
  // BARE WIRE (notools) — run starts with z_zap1, but not during the notools run
  S().challengesDone = Object.assign({}, doneSave, { notools: true });
  sR.upgrades = {};
  S().challenges.volt = '';
  T.applyReincarnatePerks();
  check('perk: BARE WIRE starts run with z_zap1', sR.upgrades.z_zap1 === true);
  sR.upgrades = {};
  S().challenges.volt = 'notools';
  T.applyReincarnatePerks();
  check('perk: BARE WIRE suppressed during the notools run', !sR.upgrades.z_zap1);

  // completing a volt challenge sets challengesDone (checkChallenge, volt goal = runVolts)
  S().challengesDone = JSON.parse(JSON.stringify(doneSave));
  S().world = 'volt';
  S().challenges = { grid: '', volt: 'bareknuckle' };
  sR.runVolts = 0;
  T.checkChallenge();
  check('challenge: not complete below volt goal', !S().challengesDone.bareknuckle && S().challenges.volt === 'bareknuckle');
  sR.runVolts = T.CHALLENGES.find((c) => c.id === 'bareknuckle').goal;
  T.checkChallenge();
  check('challenge: volt goal completes via runVolts', !!S().challengesDone.bareknuckle && S().challenges.volt === '');

  // GRID rules must keep applying while the player is foregrounded in the Voltlands —
  // the grid economy ticks every frame regardless of the active world, so a grid
  // challenge cannot be cheesed by travelling to the Voltlands (bare ch() leak).
  {
    const gridSave = {
      watts: S().watts, owned: JSON.parse(JSON.stringify(S().owned || {})),
      upgrades: JSON.parse(JSON.stringify(S().upgrades || {})),
      coreUpgrades: JSON.parse(JSON.stringify(S().coreUpgrades || {})),
      gridSettings: JSON.parse(JSON.stringify(S().settings.world.grid)),
    };
    S().challengesDone = JSON.parse(JSON.stringify(doneSave));
    S().owned = { usba: 10 };
    S().world = 'volt';   // foregrounded in the Voltlands

    // BROWNOUT halves grid production even while in the Voltlands
    S().challenges = { grid: '', volt: '' };
    const wpsClear = T.totalWps();
    S().challenges.grid = 'brownout';
    const wpsBrown = T.totalWps();
    check('leak: BROWNOUT halves grid W/s in volt foreground',
      wpsClear > 0 && Math.abs(wpsBrown - wpsClear * 0.5) < wpsClear * 1e-9);

    // UNPLUGGED zeros tap power (and the auto-tapper's gain) even in the Voltlands
    S().challenges.grid = 'unplugged';
    check('leak: UNPLUGGED zeros clickPowerFlat in volt foreground', T.clickPowerFlat() === 0);
    check('leak: UNPLUGGED zeros autoTapGainPerSec in volt foreground', T.autoTapGainPerSec() === 0);

    // SOLO CIRCUIT: the cord auto-buyer must still refuse non-USB-A while in the Voltlands
    S().challenges.grid = 'solo';
    S().coreUpgrades = Object.assign({}, gridSave.coreUpgrades, { autobuy: true });
    S().settings.world.grid.autobuyOn = true;
    S().owned = { usba: 5 };
    S().watts = 1e12;
    T.autoBuyTick();
    const boughtNonUsba = T.CORDS.slice(1).some((c) => (S().owned[c.id] || 0) > 0);
    check('leak: SOLO CIRCUIT blocks non-USB-A auto-buy in volt foreground', !boughtNonUsba);

    // MINIMALIST: the upgrade auto-buyer must still refuse upgrades while in the Voltlands
    S().challenges.grid = 'minimalist';
    S().coreUpgrades = Object.assign({}, gridSave.coreUpgrades, { autoupg: true });
    S().settings.world.grid.autoupgOn = true;
    S().upgrades = {};
    S().watts = 1e30;
    T.autoBuyUpgrades();
    check('leak: MINIMALIST blocks upgrade auto-buy in volt foreground',
      Object.keys(S().upgrades).length === 0);

    // restore grid state
    S().watts = gridSave.watts;
    S().owned = gridSave.owned;
    S().upgrades = gridSave.upgrades;
    S().coreUpgrades = gridSave.coreUpgrades;
    S().settings.world.grid = gridSave.gridSettings;
    S().challenges = { grid: '', volt: '' };
  }

  // NUMB FINGERS must be clearable: tap-zapping earns nothing, so without a seeded
  // weapon the wave-1 enemy could never be damaged (softlock). Starting the
  // challenge through startChallenge() seeds a Static Glove so ZPS makes progress.
  {
    S().challengesDone = JSON.parse(JSON.stringify(doneSave));
    S().world = 'volt';
    S().challenges = { grid: '', volt: '' };
    sR.weapons = {}; sR.upgrades = {};
    const numb = T.CHALLENGES.find((c) => c.id === 'numbfingers');
    T.startChallenge(numb);
    document.getElementById('mYes').fire('click');   // confirm START
    check('softlock: NUMB FINGERS active after start', S().challenges.volt === 'numbfingers');
    check('softlock: NUMB FINGERS seeds a starter weapon', (sR.weapons.glove || 0) >= 1);
    check('softlock: NUMB FINGERS zeros tap-zap (rule active)', T.zapPower() === 0);
    check('softlock: NUMB FINGERS still produces ZPS from the seed', T.totalZps() > 0);
    // the seeded ZPS actually damages the wave-1 enemy and can score a kill
    const kills0 = sR.kills;
    let g = 2e5;
    while (sR.kills === kills0 && g-- > 0) T.applyZapDamage(T.totalZps());
    check('softlock: NUMB FINGERS run can score a kill (no softlock)', sR.kills > kills0);
    S().challenges.volt = '';
  }

  // challenge sandboxing: starting a challenge snapshots the run; finishing OR
  // abandoning restores it, so the player never loses what they had already bought.
  {
    // ----- volt: abandon path -----
    S().world = 'volt';
    S().challenges = { grid: '', volt: '' };
    S().challengeBackup = { grid: null, volt: null };
    S().challengesDone = JSON.parse(JSON.stringify(doneSave));
    sR.weapons = { glove: 7, tongs: 3 }; sR.upgrades = { z_zap1: true };
    sR.volts = 555; sR.runVolts = 555; sR.wave = 14; sR.killsThisWave = 4;
    T.beginChallenge(T.CHALLENGES.find((c) => c.id === 'bareknuckle'));
    check('restore: starting a volt challenge clears the run', Object.keys(sR.weapons).length === 0 && sR.wave === 1);
    check('restore: volt run snapshotted on start', !!S().challengeBackup.volt);
    sR.weapons.glove = 99;   // "bought" inside the challenge — must vanish on restore
    T.abandonChallenge();
    check('restore: abandoning a volt challenge restores weapons', sR.weapons.glove === 7 && sR.weapons.tongs === 3);
    check('restore: abandoning a volt challenge restores upgrades & wave', sR.upgrades.z_zap1 === true && sR.wave === 14);
    check('restore: volt backup cleared after restore', !S().challengeBackup.volt);

    // ----- volt: completion path (perk kept, run returned) -----
    sR.weapons = { glove: 5 }; sR.upgrades = {}; sR.wave = 9;
    const scl = T.CHALLENGES.find((c) => c.id === 'staticcling');
    T.beginChallenge(scl);
    sR.runVolts = scl.goal;
    T.checkChallenge();
    check('restore: completing a volt challenge grants the perk', !!S().challengesDone.staticcling);
    check('restore: completing a volt challenge restores the run',
      sR.weapons.glove === 5 && sR.wave === 9 && !S().challengeBackup.volt);

    // ----- grid (beginChallenge reassigns state; the hook getter tracks it) -----
    const pre = {
      owned: JSON.parse(JSON.stringify(S().owned || {})), upgrades: JSON.parse(JSON.stringify(S().upgrades || {})),
      watts: S().watts, totalEarned: S().totalEarned, clicks: S().clicks,
    };
    S().world = 'grid';
    S().challenges = { grid: '', volt: '' };
    S().challengeBackup = { grid: null, volt: null };
    S().challengesDone = JSON.parse(JSON.stringify(doneSave));
    S().owned = { usba: 12, jack: 4 }; S().upgrades = { u_click1: true };
    S().watts = 7777; S().totalEarned = 9999; S().clicks = 321;
    T.beginChallenge(T.CHALLENGES.find((c) => c.id === 'solo'));
    check('restore: starting a grid challenge clears the run', !S().owned.jack && S().watts === 0);
    check('restore: grid run snapshotted on start', !!S().challengeBackup.grid);
    S().owned.jack = 50;   // "bought" inside the challenge — must vanish on restore
    T.abandonChallenge();
    check('restore: abandoning a grid challenge restores cords', S().owned.usba === 12 && S().owned.jack === 4);
    check('restore: abandoning a grid challenge restores upgrades, watts & clicks',
      S().upgrades.u_click1 === true && S().watts === 7777 && S().clicks === 321);
    check('restore: grid backup cleared after restore', !S().challengeBackup.grid);
    // put the grid run back the way the rest of the run expects it
    S().owned = pre.owned; S().upgrades = pre.upgrades;
    S().watts = pre.watts; S().totalEarned = pre.totalEarned; S().clicks = pre.clicks;
  }

  // restore
  S().world = worldSave;
  S().challenges = chSave;
  S().challengesDone = doneSave;
  Object.assign(sR, slSave);
}

// Stage 6 — More-tab gating + per-world settings render
{
  const worldSave = S().world;
  const wormSave = S().wormhole;
  const settingsSave = JSON.parse(JSON.stringify(S().settings));
  const suSave = JSON.parse(JSON.stringify(T.sl().shardUpgrades || {}));
  const doneSave = JSON.parse(JSON.stringify(S().challengesDone || {}));
  const g = (id) => document.getElementById(id);

  S().wormhole = true;

  // Voltlands foreground: Storm Reactor + Storm Upgrades shown, Grid prestige hidden
  S().world = 'volt';
  T.renderMoreGating();
  check('gating: volt shows Storm Reactor', g('voltPrestigeBlock').hidden === false);
  check('gating: volt shows Storm Upgrades', g('voltShopBlock').hidden === false);
  check('gating: volt hides Recycle Plant', g('recycleBlock').hidden === true);
  check('gating: volt hides Core Upgrades', g('coreShopBlock').hidden === true);

  // Grid foreground: inverse
  S().world = 'grid';
  T.renderMoreGating();
  check('gating: grid shows Recycle Plant', g('recycleBlock').hidden === false);
  check('gating: grid shows Core Upgrades', g('coreShopBlock').hidden === false);
  check('gating: grid hides Storm Reactor', g('voltPrestigeBlock').hidden === true);
  check('gating: grid hides Storm Upgrades', g('voltShopBlock').hidden === true);

  // Pre-wormhole, the volt blocks stay hidden even in the volt world
  S().wormhole = false;
  S().world = 'volt';
  T.renderMoreGating();
  check('gating: no wormhole hides Storm blocks', g('voltPrestigeBlock').hidden === true && g('voltShopBlock').hidden === true);
  S().wormhole = true;

  // Settings render is world-aware and never throws with the settings.world shape
  S().world = 'grid';
  S().coreUpgrades.autobuy = true; S().coreUpgrades.autoupg = true;
  let threw = false;
  try { T.syncSettingsUI(); } catch (e) { threw = true; }
  check('settings: syncSettingsUI runs on grid without throwing', !threw);
  check('settings: grid shows Auto-Buyer/Upgrader rows', g('autobuyRow').hidden === false && g('autoupgRow').hidden === false);
  check('settings: grid hides volt automation rows', g('autoArsenalRow').hidden === true && g('autoclickRow').hidden === true);

  S().world = 'volt';
  T.sl().shardUpgrades = { autoarsenal: true, autotinker: true, autozap: true };
  threw = false;
  try { T.syncSettingsUI(); } catch (e) { threw = true; }
  check('settings: syncSettingsUI runs on volt without throwing', !threw);
  check('settings: volt shows Auto-Arsenal/Tinker/Zapper rows', g('autoArsenalRow').hidden === false && g('autoTinkerRow').hidden === false && g('autoclickRow').hidden === false);
  check('settings: volt hides grid automation rows', g('autobuyRow').hidden === true && g('autoupgRow').hidden === true);
  // STATIC CLING perk also reveals the Auto-Zapper row without owning autozap
  T.sl().shardUpgrades = {};
  S().challengesDone = Object.assign({}, doneSave, { staticcling: true });
  T.syncSettingsUI();
  check('settings: STATIC CLING perk reveals Auto-Zapper row', g('autoclickRow').hidden === false);

  // applyWorld re-runs the gating + settings render on a world switch (no throw)
  threw = false;
  try { T.applyWorld(); } catch (e) { threw = true; }
  check('gating: applyWorld re-renders without throwing', !threw);

  // restore
  S().world = worldSave;
  S().wormhole = wormSave;
  S().settings = settingsSave;
  T.sl().shardUpgrades = suSave;
  S().challengesDone = doneSave;
}

// accelerators present and wired
check('content: 23 core upgrades', T.CORE_UPGRADES.length === 23);
S().coreUpgrades.fission = true;
const g1 = T.prestigeGain();
delete S().coreUpgrades.fission;
check('accelerators: fission multiplies gain', g1 >= T.prestigeGain());

// Auto-Buyer core upgrade: one tick buys MANY cords across tiers (not 1)
S().challenges.grid = '';
S().coreUpgrades.autobuy = true;
S().owned = { usba: 1 };
S().watts = 1e9;
const tally = () => T.CORDS.reduce((n, c) => n + (S().owned[c.id] || 0), 0);
const cordsBefore = tally();
T.autoBuyTick();
const cordsAfter = tally();
check('autobuy: buys many cords in one tick', cordsAfter - cordsBefore > 1);

// ...and its Settings toggle stops it
S().settings.world.grid.autobuyOn = false;
const offBefore = tally();
T.autoBuyTick();
check('autobuy: toggle off stops buying', tally() === offBefore);
S().settings.world.grid.autobuyOn = true;

// Efficiency revamp: with a CONSTRAINED bank (can't buy everything — the case that
// matters for ongoing play and partial offline drains), the efficiency chooser must
// turn the same spend into meaningfully MORE W/s than the old cheapest-first pass,
// which sank the bank into low-value tiers. (Drained to exhaustion both converge, so
// the test deliberately uses a bank too small to buy everything.)
{
  const s = S();
  s.challenges = { grid: '', volt: '' };
  s.coreUpgrades = { autobuy: true };
  s.settings.world.grid.autobuyOn = true;
  s.upgrades = {};                       // no per-cord upgrades → clean comparison
  const startOwned = { usba: 80, jack: 55, hdmi: 30, eth: 15, usbc: 8, power: 3, thndr: 1 };
  const BANK = 1e7;                      // constrained: far less than "buy everything" costs
  const setup = () => { s.owned = Object.assign({}, startOwned); s.watts = BANK; };

  // new efficiency buyer → run to exhaustion
  setup();
  let prev = -1, guard = 0;
  while (s.watts !== prev && guard++ < 5000) { prev = s.watts; T.autoBuyTick(); }
  const wpsNew = T.totalWps();
  const spentNew = BANK - s.watts;

  // old cheapest-first replica → run to exhaustion, same start + bank
  setup();
  prev = -1; guard = 0;
  const cheapestPass = () => {
    let did = false;
    for (let i = 0; i < T.CORDS.length; i++) {
      const c = T.CORDS[i];
      if (c.wps <= 0 && !c.coreGain) continue;
      const owned = s.owned[c.id] || 0;
      const prevOwned = i === 0 ? 1 : (s.owned[T.CORDS[i - 1].id] || 0);
      if (!(owned > 0 || prevOwned > 0)) continue;
      const k = Math.min(T.maxAffordable(c), 25);
      if (k <= 0) continue;
      const cost = T.cordCost(c, k);
      if (s.watts < cost) continue;
      s.watts -= cost; s.owned[c.id] = (s.owned[c.id] || 0) + k; did = true;
    }
    return did;
  };
  while (cheapestPass() && guard++ < 5000) {}
  const wpsOld = T.totalWps();

  check('auto-buy: efficiency chooser beats cheapest-first on a constrained bank (>5% W/s)', wpsNew > wpsOld * 1.05);
  check('auto-buy: efficiency chooser deploys most of the bank', spentNew > BANK * 0.5);
}

// Regression lock: on a BIG bank drained to exhaustion the auto-buyer must never
// UNDERPERFORM cheapest-first. The ×10-every-100 milestones are non-convex, so a
// pure efficiency greedy regressed badly here (it skips the low-marginal climb to
// the deep jackpots); the cheapest-first mop-up pass is what keeps parity.
{
  const s = S();
  s.challenges = { grid: '', volt: '' };
  s.coreUpgrades = { autobuy: true };
  s.settings.world.grid.autobuyOn = true;
  s.upgrades = {};
  const startOwned = { usba: 80, jack: 55, hdmi: 30, eth: 15, usbc: 8, power: 3, thndr: 1 };
  const BANK = 1e15;                     // big: both reach the deep milestones, so they should tie
  const setup = () => { s.owned = Object.assign({}, startOwned); s.watts = BANK; };

  setup();
  let prev = -1, guard = 0;
  while (s.watts !== prev && guard++ < 8000) { prev = s.watts; T.autoBuyTick(); }
  const wpsNew = T.totalWps();

  setup();
  guard = 0;
  const cheapestPass = () => {
    let did = false;
    for (let i = 0; i < T.CORDS.length; i++) {
      const c = T.CORDS[i];
      if (c.wps <= 0 && !c.coreGain) continue;
      const owned = s.owned[c.id] || 0;
      const prevOwned = i === 0 ? 1 : (s.owned[T.CORDS[i - 1].id] || 0);
      if (!(owned > 0 || prevOwned > 0)) continue;
      const k = Math.min(T.maxAffordable(c), 25);
      if (k <= 0) continue;
      const cost = T.cordCost(c, k);
      if (s.watts < cost) continue;
      s.watts -= cost; s.owned[c.id] = (s.owned[c.id] || 0) + k; did = true;
    }
    return did;
  };
  while (cheapestPass() && guard++ < 20000) {}
  const wpsOld = T.totalWps();

  check('auto-buy: never worse than cheapest-first on a big drained bank', wpsNew >= wpsOld * 0.99);
}

// Milestone awareness: one unit short of a ×2 breakpoint is the highest-efficiency
// buy, so the chooser completes it rather than spending the bank elsewhere.
{
  const s = S();
  s.challenges = { grid: '', volt: '' };
  s.coreUpgrades = { autobuy: true };
  s.settings.world.grid.autobuyOn = true;
  s.upgrades = {};
  s.owned = { usba: 24, jack: 1 };   // usba one short of its 25-owned ×2; jack just unlocked
  s.watts = 300;                     // affords the usba milestone-completing unit, little else
  T.autoBuyTick();
  check('auto-buy: completes a near ownership milestone first', (s.owned.usba || 0) >= 25);
}

// Auto-Upgrader core upgrade: buys all unlocked affordable upgrades at once
S().coreUpgrades.autoupg = true;
S().upgrades = {};
S().owned = { usba: 10, jack: 10 };
S().watts = 1e9;
T.autoBuyUpgrades();
check('autoupg: buys affordable upgrades', Object.keys(S().upgrades).length > 1);

// ...and its Settings toggle stops it
S().settings.world.grid.autoupgOn = false;
S().upgrades = {};
T.autoBuyUpgrades();
check('autoupg: toggle off stops buying', Object.keys(S().upgrades).length === 0);
S().settings.world.grid.autoupgOn = true;

// Auto-Tapper ladder: rate scales 5→1000 and each tier needs the previous
S().coreUpgrades = {};
check('autotap: rate 0 with none owned', T.autoTapRate() === 0);
S().cores = 1e6;
T.buyCoreUpgrade(T.CORE_UPGRADES.find(c => c.id === 'autotap10'));
check('autotap: II is locked without I', !S().coreUpgrades.autotap10);
S().coreUpgrades.autotap = true;
check('autotap: base rate is 5', T.autoTapRate() === 5);
['autotap10', 'autotap20', 'autotap50', 'autotap100', 'autotap1000'].forEach(id => { S().coreUpgrades[id] = true; });
check('autotap: maxed rate is 150', T.autoTapRate() === 150);

// Auto-taps are identical to manual taps — full tap-power multipliers AND the
// %-of-W/s share, just faster. (The old W/s-share cap is intentionally removed.)
S().challenges.grid = '';
S().coreUpgrades.static = true;   // each tap earns 4% of W/s (autotap ladder set above)
S().upgrades = {};
S().owned = { usba: 1000 };       // nonzero W/s for the share
check('autotap: each auto-tap equals a manual tap × rate',
  Math.abs(T.autoTapGainPerSec() - T.clickPower() * T.autoTapRate()) < T.clickPower() * T.autoTapRate() * 1e-9);
const autoBase = T.autoTapGainPerSec();
const cuAuto = T.UPGRADES.find((u) => u.kind === 'click');
S().upgrades[cuAuto.id] = true;
check('autotap: a tap-power upgrade scales auto-tap income exactly like a manual tap',
  Math.abs(T.autoTapGainPerSec() - autoBase * cuAuto.mult) < autoBase * 1e-6);

// Ouroboros Cord: 0 watts, boosts prestige core gain, never auto-bought
const ouro = T.CORDS.find(c => c.coreGain);
check('content: ouroboros core-gain cord exists', !!ouro && ouro.wps === 0);
S().coreUpgrades = {};
S().owned = {};
S().totalEarned = 1e30;
S().coresEarned = 0;
const baseGain = T.prestigeGain();
S().owned[ouro.id] = 50;
check('ouroboros: boosts prestige gain', T.prestigeGain() > baseGain);

S().challenges.grid = '';
S().coreUpgrades = { autobuy: true };
S().settings.world.grid.autobuyOn = true;
S().owned = { genesis: 1 };       // unlocks ouro (its previous cord)
S().watts = 1e40;                 // more than enough to afford ouro
T.autoBuyTick();
check('autobuy: buys the core-gain cord (Ouroboros)', (S().owned[ouro.id] || 0) > 0);

// BROWNOUT challenge reward is now 2× prestige core production (was the auto-buyer)
S().coreUpgrades = {}; S().challengesDone = {}; S().owned = {}; S().totalEarned = 1e30; S().coresEarned = 0;
const gainNoBrown = T.prestigeGain();
S().challengesDone = { brownout: true };
const gainBrown = T.prestigeGain();
check('brownout reward: ~2x prestige cores', gainBrown >= gainNoBrown * 2 && gainBrown <= gainNoBrown * 2 + 1);
// BROWNOUT no longer unlocks the auto-buyer
S().coreUpgrades = {}; S().challengesDone = { brownout: true };
S().owned = { usba: 1 }; S().watts = 1e40; S().settings.world.grid.autobuyOn = true;
const usbaBefore = S().owned.usba;
T.autoBuyTick();
check('brownout no longer unlocks auto-buyer', S().owned.usba === usbaBefore);

// offline volt earnings must convert damage -> kills -> volts (count DOWN enemy HP),
// not book raw ZPS as volts (count UP). The corrected rate is totalZps × reward/HP.
{
  const sR3 = T.sl();
  S().wormhole = true;
  S().world = 'volt';
  S().challenges = { grid: '', volt: '' };
  S().owned = { usba: 10 };                 // grid production > 0 so applyOffline reaches the volt block
  S().watts = 0;
  S().lifetimeEarned = 1e30;                // pinned high so the grid earn doesn't nudge gridZpsBoost (→ totalZps)
  sR3.weapons = { glove: 50, tongs: 20 };   // some ZPS
  sR3.wave = 5;                             // a normal (non-boss) wave
  sR3.volts = 0; sR3.runVolts = 0; sR3.totalVolts = 0;
  const zps = T.totalZps();
  const ratio = T.voltReward(5) / T.enemyHp(5);   // ~0.8 under the current curve
  const eff = T.offlineEff();
  const awayMs = 2 * 3600 * 1000;                 // 2h
  S().lastSeen = Date.now() - awayMs;
  const cap = T.offlineCapMs();
  const away = Math.min(awayMs, cap);
  const expected = zps * ratio * (away / 1000) * eff;
  const naive = zps * (away / 1000) * eff;        // the old, buggy overcount
  T.applyOffline();
  const got = sR3.volts;
  check('offline: volt earnings convert damage→volts via HP/reward', Math.abs(got - expected) < expected * 1e-6);
  check('offline: volt earnings stay below the naive ZPS×time overcount', got > 0 && got < naive * 0.999);

  // Welcome-back dialog is tuned to the player's primary currency: past the
  // wormhole (and with volts actually earned), Volts lead ABOVE Watts and render
  // bigger. Pre-fix the dialog always led with Watts at a fixed size.
  const wb = document.querySelector('#mbox').innerHTML;
  const vAt = wb.indexOf(' V</p>'), wAt = wb.indexOf(' W</p>');
  const big = wb.indexOf('font-size:34px'), small = wb.indexOf('font-size:20px');
  check('welcome-back: Volts lead above the demoted Watts past the wormhole', vAt > -1 && wAt > -1 && vAt < wAt);
  check('welcome-back: the leading Volts line is the bigger one', big > -1 && small > -1 && big < vAt && vAt < small && small < wAt);
}

// Control: before the wormhole, Watts stay the headline — no Volts line, no demotion.
{
  S().wormhole = false;
  S().owned = { usba: 10 }; S().watts = 0;
  S().lastSeen = Date.now() - 2 * 3600 * 1000;
  T.applyOffline();
  const wb2 = document.querySelector('#mbox').innerHTML;
  check('welcome-back: Watts stay primary before the wormhole', wb2.includes(' W</p>') && !wb2.includes(' V</p>'));
  check('welcome-back: pre-wormhole Watts line keeps the default size (not demoted)', !wb2.includes('font-size:20px'));
}

// rate invariance (regression lock for the dt-scaled volt kill cap): one coarse
// 1Hz tick must credit ≈ the same volts as ten fine 0.1s ticks over the same 1s,
// so throttling the sim to 1Hz in the background doesn't under-credit the Voltlands.
{
  const sR4 = T.sl();
  S().wormhole = true; S().world = 'volt';
  S().challenges = { grid: '', volt: '' };
  // Hold every ZPS multiplier CONSTANT across both runs: max out achievements
  // (killEnemy unlocks them mid-run, which would otherwise inflate the finer
  // path's later ticks via achMult), and zero the lifetime/boost/streak inputs.
  S().achievements = Object.fromEntries(T.ACHIEVEMENTS.map((a) => [a.id, true]));
  S().lifetimeEarned = 0; S().boostUntil = 0; S().streakUntil = 0;
  const base = { volts: 0, runVolts: 0, totalVolts: 0, wave: 5, killsThisWave: 0, kills: 0,
                 bosses: 0, weapons: { railgun: 1 }, upgrades: {}, shards: 0, shardsEarned: 0,
                 shardUpgrades: {}, hp: 0, maxHp: 0 };
  const run = (steps, dt) => {
    Object.assign(sR4, JSON.parse(JSON.stringify(base)));
    T.spawnEnemy();
    for (let i = 0; i < steps; i++) T.slayerTick(dt);
    return sR4.runVolts;
  };
  const coarse = run(1, 1.0);     // one 1Hz tick
  const fine = run(10, 0.1);      // ten 0.1s ticks (same wall-second)
  check('rate-invariance: 1Hz tick ≈ ten 0.1s ticks (volt kill cap scales with dt)',
    fine > 0 && Math.abs(coarse - fine) <= fine * 0.08);
}

// frame-rate cap setting: defaults to 30, clamps junk, keeps valid presets
check('fps: defaults to 30', T.normalizeState({}).settings.fps === 30);
check('fps: clamps an invalid value to 30', T.normalizeState({ settings: { fps: 999 } }).settings.fps === 30);
check('fps: keeps a valid 60', T.normalizeState({ settings: { fps: 60 } }).settings.fps === 60);

// Surge Grid — Phase 1: state + currency mint + pacing constant
{
  const d = T.defaultSlayer();
  check('surge: defaultSlayer seeds charges at 0', d.surgeCharges === 0 && d.surgeChargesEarned === 0);
  check('surge: defaultSlayer seeds empty nodes + branch', d.surgeNodes && typeof d.surgeNodes === 'object' && d.surgeBranch === '');
  check('surge: VOLT_COST_GROWTH constant is 1.16', T.VOLT_COST_GROWTH === 1.16);
  S().challenges.volt = '';
  check('surge: weaponCostGrowth uses the 1.16 Volt base', T.weaponCostGrowth() === 1.16);
  S().challenges.volt = 'powerdrain';
  check('surge: POWER DRAIN still overrides growth to 1.18', T.weaponCostGrowth() === 1.18);
  S().challenges.volt = '';
  check('migrate: legacy save backfills surge fields',
    (() => { const sl0 = T.normalizeState({ slayer: {} }).slayer; return sl0.surgeCharges === 0 && sl0.surgeChargesEarned === 0 && typeof sl0.surgeNodes === 'object' && sl0.surgeBranch === ''; })());
  check('migrate: malformed surgeNodes coerced to object', typeof T.normalizeState({ slayer: { surgeNodes: 7 } }).slayer.surgeNodes === 'object');

  // Mint: deliberately slow — a normal kill is +0.1 charge, a boss kill +0.5 (10× slower
  // than the raw kill count); spendable + lifetime move together. fmtInt floors the display.
  const sR = T.sl();
  sR.surgeCharges = 0; sR.surgeChargesEarned = 0;
  sR.wave = 3; sR.killsThisWave = 0;
  T.spawnEnemy(); T.killEnemy();
  check('surge: a normal kill mints +0.1 charge (10× slower; spendable + lifetime)',
    Math.abs(sR.surgeCharges - 0.1) < 1e-9 && Math.abs(sR.surgeChargesEarned - 0.1) < 1e-9);
  sR.wave = 10; sR.killsThisWave = 0;
  T.spawnEnemy(); T.killEnemy();
  check('surge: a boss kill mints +0.5 charges', Math.abs(sR.surgeCharges - 0.6) < 1e-9 && Math.abs(sR.surgeChargesEarned - 0.6) < 1e-9);

  // Reincarnate is the free respec: spendable charges + node allocation reset, lifetime kept.
  sR.surgeNodes = { surge_test: true }; sR.surgeBranch = 'surge_crit';
  sR.runVolts = 1e12;   // ensure reincarnateGain() > 0
  const earnedBefore = sR.surgeChargesEarned;
  T.reincarnate();
  check('surge: reincarnate resets spendable charges to 0', T.sl().surgeCharges === 0);
  check('surge: reincarnate clears nodes + branch (free respec)', Object.keys(T.sl().surgeNodes).length === 0 && T.sl().surgeBranch === '');
  check('surge: reincarnate KEEPS lifetime surgeChargesEarned', T.sl().surgeChargesEarned === earnedBefore);
}

// Surge Grid — Phase 2/3: tree buy logic + tick-hook multipliers
{
  const sR = T.sl();
  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 0; sR.weapons = {};
  const N = (id) => T.SURGE_NODES.find(n => n.id === id);

  // empty tree => every surge multiplier is its no-op base
  check('surge: empty tree => zps/tap/volt/shard/auto mult all 1',
    T.surgeZpsMult() === 1 && T.surgeTapMult() === 1 && T.surgeVoltMult() === 1 && T.surgeShardMult() === 1 && T.surgeAutoRate() === 1);
  check('surge: empty tree => crit base 10% / x10', Math.abs(T.surgeCritChance() - 0.10) < 1e-9 && T.surgeCritMult() === 10);

  // buy guard: not enough charges
  sR.surgeCharges = 1;
  T.buySurgeNode(N('sg_root'));
  check('surge: buy blocked when charges < cost', !T.sg('sg_root'));
  // enough charges => buy + decrement
  sR.surgeCharges = 1000;
  T.buySurgeNode(N('sg_root'));
  check('surge: node bought + charges decremented', T.sg('sg_root') && sR.surgeCharges === 1000 - N('sg_root').cost);
  check('surge: bought tap node lifts surgeTapMult', Math.abs(T.surgeTapMult() - 1.5) < 1e-9);
  // prereq gating
  T.buySurgeNode(N('sg_t3'));
  check('surge: prereq-gated node refused until its req is owned', !T.sg('sg_t3'));
  T.buySurgeNode(N('sg_t2'));
  check('surge: prereq met => node buys; surgeZpsMult lifts', T.sg('sg_t2') && Math.abs(T.surgeZpsMult() - 1.5) < 1e-9);

  // branch exclusivity
  T.buySurgeNode(N('sg_t3')); T.buySurgeNode(N('sg_fork')); T.buySurgeNode(N('sg_crit'));
  check('surge: picking a capstone sets surgeBranch', sR.surgeBranch === 'crit');
  check('surge: a different-branch node is locked once a path is chosen', !T.surgeNodeUnlocked(N('sg_flow')));
  T.buySurgeNode(N('sg_flow'));
  check('surge: buying a locked cross-branch node is refused', !T.sg('sg_flow'));
  check('surge: crit capstone raises crit chance + mult', T.surgeCritChance() > 0.10 && T.surgeCritMult() > 10);

  // tick-hook integration: surge mults actually move combat outputs
  sR.weapons = { glove: 100 };
  sR.surgeNodes = {}; sR.surgeBranch = '';
  const zps0 = T.totalZps(), tap0 = T.zapPower(), volt0 = T.voltReward(5);
  sR.surgeNodes = { sg_root: true, sg_t2: true };   // tap x1.5, zps x1.5
  check('surge: totalZps scales with surgeZpsMult', Math.abs(T.totalZps() - zps0 * 1.5) < zps0 * 1e-6);
  check('surge: zapPower scales with surgeTapMult', Math.abs(T.zapPower() - tap0 * 1.5) < tap0 * 1e-6);
  sR.surgeNodes = { sg_hunt: true };   // volt x1.5
  check('surge: voltReward scales with surgeVoltMult', Math.abs(T.voltReward(5) - volt0 * 1.5) < volt0 * 1e-6);
  // reincarnateGain scales with surgeShardMult
  sR.runVolts = 1e12; sR.surgeNodes = {};
  const g0 = T.reincarnateGain();
  sR.surgeNodes = { sg_hunt: true, sg_hunt2: true, sg_hunt3: true };   // shard x1.25 x1.5
  check('surge: reincarnateGain scales with surgeShardMult', T.reincarnateGain() > g0);

  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 0; sR.weapons = {}; sR.runVolts = 0;
}

// Voltlands expansion challenges — rule wiring + perks
{
  const sR = T.sl();
  S().challenges = { grid: '', volt: '' };
  const hp0 = T.enemyHp(5);
  S().challenges.volt = 'glasscannon';
  check('challenge: GLASS CANNON doubles enemy HP', Math.abs(T.enemyHp(5) - hp0 * 2) < hp0 * 1e-6);
  S().challenges.volt = '';
  // SURGE FAMINE: kills mint no Surge Charges
  sR.surgeCharges = 0; sR.surgeChargesEarned = 0; sR.wave = 3; sR.killsThisWave = 0;
  S().challenges.volt = 'surgefamine';
  T.spawnEnemy(); T.killEnemy();
  check('challenge: SURGE FAMINE mints no Surge Charges', sR.surgeCharges === 0 && sR.surgeChargesEarned === 0);
  S().challenges.volt = '';
  // SURGE SURPLUS perk: a normal kill mints double
  S().challengesDone = Object.assign({}, S().challengesDone, { surgefamine: true });
  sR.surgeCharges = 0; sR.surgeChargesEarned = 0; sR.wave = 3; sR.killsThisWave = 0;
  T.spawnEnemy(); T.killEnemy();
  check('perk: SURGE SURPLUS doubles a normal kill mint (=0.2)', Math.abs(sR.surgeCharges - 0.2) < 1e-9 && Math.abs(sR.surgeChargesEarned - 0.2) < 1e-9);
  delete S().challengesDone.surgefamine;
  sR.surgeCharges = 0; sR.surgeChargesEarned = 0; sR.wave = 1;
}

// Discharge active ability (Storm-Upgrade unlock + Auto-Discharge)
{
  const sR = T.sl();
  S().wormhole = true; S().challenges = { grid: '', volt: '' };
  sR.shardUpgrades = {}; sR.dischargeCd = 0; sR.weapons = { glove: 100 }; sR.upgrades = {};
  sR.wave = 5; sR.killsThisWave = 0; sR.kills = 0;
  T.spawnEnemy();
  check('discharge: locked until the Storm Upgrade is owned', !T.dischargeReady());
  T.fireDischarge();
  check('discharge: firing while locked is a no-op', (sR.dischargeCd || 0) === 0);
  sR.shardUpgrades = { discharge: true };
  check('discharge: ready once unlocked', T.dischargeReady());
  const k0 = sR.kills;
  T.fireDischarge();
  check('discharge: firing deals a burst (advances kills) + sets the cooldown', sR.kills > k0 && Math.abs(sR.dischargeCd - 20) < 1e-9 && !T.dischargeReady());
  for (let i = 0; i < 20; i++) T.slayerTick(1);
  check('discharge: cooldown ticks to 0 after ~20s', (sR.dischargeCd || 0) <= 0 && T.dischargeReady());
  sR.shardUpgrades = { discharge: true, autodischarge: true };
  sR.dischargeCd = 0;
  T.slayerTick(1);
  check('discharge: Auto-Discharge fires it when ready (sets cooldown)', sR.dischargeCd > 0);
  sR.shardUpgrades = {}; sR.dischargeCd = 0; sR.weapons = {};
}

// Tiered volt challenges + cross-world (volt tiers -> Grid watts) coupling
{
  S().challengesDone = {};
  const bk = T.CHALLENGES.find((x) => x.id === 'bareknuckle');   // volt
  const solo = T.CHALLENGES.find((x) => x.id === 'solo');        // grid
  check('tier: volt challenges are 3 tiers, grid stay 1', T.chMaxTier(bk) === 3 && T.chMaxTier(solo) === 1);
  check('tier: tier-1 goal is the base goal', T.chGoalFor(bk) === bk.goal);
  S().challengesDone = { bareknuckle: 1 };
  check('tier: next goal after tier 1 is x8', Math.abs(T.chGoalFor(bk) - bk.goal * 8) < 1);
  S().challengesDone = { bareknuckle: true };
  check('tier: legacy boolean true counts as tier 1', T.chTier('bareknuckle') === 1);
  // cross-world coupling: cleared volt tiers boost Grid watts (+2% each)
  S().challengesDone = {};
  check('tier: trialGridBoost is 1.0 with no tiers', T.trialGridBoost() === 1);
  S().challengesDone = { bareknuckle: 3, numbfingers: 2 };   // 5 volt tiers
  check('tier: trialGridBoost +2% per cleared volt tier (=1.10)', Math.abs(T.trialGridBoost() - 1.1) < 1e-9);
  // completing a volt challenge increments the tier count (not a boolean)
  S().challengesDone = {}; S().world = 'volt';
  S().challenges = { grid: '', volt: '' }; S().challengeBackup = { grid: null, volt: null };
  T.beginChallenge(bk);
  T.sl().runVolts = bk.goal;        // reach the tier-1 goal
  T.checkChallenge();
  check('tier: completing tier 1 sets count to 1 and clears the run', T.chTier('bareknuckle') === 1 && S().challenges.volt === '');
  S().challengesDone = {}; S().world = 'grid';
}

// Surge build presets — save / load across runs
{
  const sR = T.sl();
  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 1000; sR.surgePresets = [null, null, null];
  T.buySurgeNode(T.SURGE_NODES.find((n) => n.id === 'sg_root'));
  T.buySurgeNode(T.SURGE_NODES.find((n) => n.id === 'sg_t2'));
  T.saveSurgePreset(0);
  check('preset: save captures the owned nodes', !!sR.surgePresets[0] && sR.surgePresets[0].nodes.includes('sg_root') && sR.surgePresets[0].nodes.includes('sg_t2'));
  // wipe (as a respec would) then reload with plenty of charges
  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 1000;
  T.loadSurgePreset(0);
  check('preset: load rebuilds the saved nodes', T.sg('sg_root') && T.sg('sg_t2'));
  // load with limited charges buys only what is affordable (sg_root=3, sg_t2=6)
  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 3;
  T.loadSurgePreset(0);
  check('preset: load buys only affordable nodes', T.sg('sg_root') && !T.sg('sg_t2'));
  // loading an empty slot is a no-op
  sR.surgeNodes = {}; sR.surgeCharges = 1000;
  T.loadSurgePreset(2);
  check('preset: loading an empty slot does nothing', Object.keys(sR.surgeNodes).length === 0);
  check('migrate: surgePresets backfilled to a 3-slot array', Array.isArray(T.normalizeState({ slayer: {} }).slayer.surgePresets) && T.normalizeState({ slayer: {} }).slayer.surgePresets.length === 3);
  sR.surgeNodes = {}; sR.surgeBranch = ''; sR.surgeCharges = 0; sR.surgePresets = [null, null, null];
}

// Upgrade semantics — multipliers must be multiplicative on the value they claim.
{
  S().challenges = { grid: '', volt: '' };
  S().coreUpgrades = {};
  // Reported bug: a "Tap power xN" upgrade must multiply the WHOLE tap value
  // (flat + the %-of-W/s share), not just the flat part.
  S().owned = { usba: 200 };     // real W/s so the %-of-W/s share is significant
  S().upgrades = { tw1: true };  // Live Wire: each tap earns 1% of W/s
  const tapBefore = T.clickPower();
  const cu = T.UPGRADES.find((u) => u.kind === 'click');
  S().upgrades[cu.id] = true;
  check('tap: a tap-power upgrade multiplies the WHOLE tap value', Math.abs(T.clickPower() - tapBefore * cu.mult) < tapBefore * 1e-6);
  // Overclocked Thumbs (core "Tap power x3") is also a full tap multiplier.
  S().upgrades = { tw1: true };
  const tb2 = T.clickPower();
  S().coreUpgrades = { thumbs: true };
  check('tap: core Overclocked Thumbs (×2) multiplies the WHOLE tap value', Math.abs(T.clickPower() - tb2 * 2) < tb2 * 1e-6);
  S().coreUpgrades = {};
  // tapwps adds its % of W/s to the tap (Live Wire = +1% of W/s) on top of the flat.
  S().upgrades = {};
  const flatOnly = T.clickPower();
  S().upgrades = { tw1: true };
  check('tap: Live Wire adds 1% of W/s to the tap value', Math.abs(T.clickPower() - (flatOnly + 0.01 * T.totalWps())) < flatOnly * 1e-6);
  // 'global' upgrade multiplies all cord production (Cable Management = +25%).
  S().upgrades = {};
  const wps0 = T.totalWps();
  S().upgrades = { u_glob1: true };   // All cords +25%
  check('upgrade: a +25% global multiplies total W/s by 1.25', Math.abs(T.totalWps() - wps0 * 1.25) < wps0 * 1e-6);
  // 'cord' upgrade multiplies one cord's output (Gold USB Contacts = USB-A x2).
  S().upgrades = {};
  const wpsA = T.totalWps();          // only USB-A owned, so its x2 doubles total
  S().upgrades = { u_usba: true };
  check('upgrade: a cord x2 doubles that cord output', Math.abs(T.totalWps() - wpsA * 2) < wpsA * 1e-6);
  // Voltlands 'zap' upgrade multiplies the flat tap-zap; the Z/s share is 0 here
  // (no zapzps upgrade owned), so a x2 doubles the whole zapPower.
  { const sR = T.sl(); sR.upgrades = {}; const zp0 = T.zapPower();
    sR.upgrades = { z_zap1: true };   // Rubber Gloves Off: tap-zap x2
    check('zap: a tap-zap x2 upgrade doubles zapPower', Math.abs(T.zapPower() - zp0 * 2) < zp0 * 1e-6);
    sR.upgrades = {}; }
  // Voltlands ZPS-scaling zaps (mirror of the Grid's tapwps): a 'zapzps' upgrade
  // makes each zap ALSO deal frac × current Z/s — so tapping keeps pace with DPS
  // instead of decaying to a flat pittance as ZPS balloons.
  {
    const sR = T.sl();
    check('content: zz1/zz2/zz3 exist as zapzps upgrades',
      ['zz1', 'zz2', 'zz3'].every((id) => T.ZAP_UPGRADES.some((u) => u.id === id && u.kind === 'zapzps')));
    sR.upgrades = {}; sR.shardUpgrades = {}; S().buffs = []; S().challenges = { grid: '', volt: '' };
    sR.weapons = { glove: 50, tongs: 50, welder: 50 };    // nonzero Z/s
    const zps = T.totalZps();
    const zapFlat = T.zapPower();                          // no zapzps owned -> flat only
    const zz1 = T.ZAP_UPGRADES.find((u) => u.id === 'zz1');
    sR.upgrades = { zz1: true };                           // +1.5% of Z/s per zap
    check('zap: a zapzps upgrade adds frac × Z/s to each zap',
      zps > 0 && Math.abs((T.zapPower() - zapFlat) - zz1.frac * zps) < zz1.frac * zps * 1e-9);
    const share1 = T.zapPower() - zapFlat;
    sR.weapons = { glove: 100, tongs: 100, welder: 100 };  // more Z/s -> bigger share
    const share2 = T.zapPower() - zapFlat;
    check('zap: the Z/s share scales tapping with production', share2 > share1 * 1.5);
    sR.upgrades = {}; sR.weapons = {}; sR.shardUpgrades = {};
  }
  S().owned = {}; S().upgrades = {}; S().coreUpgrades = {};
}

// Content integrity — unique ids per catalog + valid cross-references
{
  const uniq = (name, arr) => { const ids = arr.map((x) => x.id).filter(Boolean); check('content: ' + name + ' ids unique', new Set(ids).size === ids.length); };
  uniq('CORDS', T.CORDS); uniq('UPGRADES', T.UPGRADES); uniq('CORE_UPGRADES', T.CORE_UPGRADES);
  uniq('WEAPONS', T.WEAPONS); uniq('ZAP_UPGRADES', T.ZAP_UPGRADES); uniq('STORM_UPGRADES', T.STORM_UPGRADES);
  uniq('SURGE_NODES', T.SURGE_NODES); uniq('CHALLENGES', T.CHALLENGES); uniq('ACHIEVEMENTS', T.ACHIEVEMENTS);
  check('content: weapon-kind zap upgrades target real weapons',
    T.ZAP_UPGRADES.filter((u) => u.kind === 'weapon').every((u) => T.WEAPONS.some((w) => w.id === u.weapon)));
  check('content: surge node reqs reference real nodes',
    T.SURGE_NODES.every((n) => !n.req || T.SURGE_NODES.some((m) => m.id === n.req)));
  check('content: Voltlands exceeds the Grid in generators', T.WEAPONS.length > T.CORDS.length);
  check('content: Voltlands exceeds the Grid in upgrades', T.ZAP_UPGRADES.length > T.UPGRADES.length);
  check('content: storm upgrades (excl. teaser) exceed the core upgrades',
    T.STORM_UPGRADES.filter((u) => !u.disabled).length > T.CORE_UPGRADES.length);
  // new eff-based storm upgrades actually fold into the combat chains
  { const sR = T.sl(); sR.weapons = { glove: 50 }; sR.shardUpgrades = {};
    const z0 = T.totalZps();
    sR.shardUpgrades = { thunderhead: true };   // eff { zps: 3 }
    check('storm: eff upgrade lifts totalZps ×3', Math.abs(T.totalZps() - z0 * 3) < z0 * 1e-6);
    sR.shardUpgrades = {}; sR.weapons = {}; }
}

// Monetization — every IAP grant + both ad rewards actually apply their reward
{
  const s = S();
  s.iap = {}; s.adDay = T.localDay(); s.adUses = {}; s.boostUntil = 0; s.supporterDay = '';
  s.owned = { usba: 10 }; s.upgrades = {}; s.coreUpgrades = {}; s.challenges = { grid: '', volt: '' };

  // catalog matches what both stores are told to create (6 SKUs, types intact)
  check('mtx: catalog has the 6 store SKUs', T.IAP_PRODUCTS.length === 6 &&
    ['supporter_pack','boost_production_25','starter_cores','timewarp_4h','timewarp_24h','theme_pack_phosphor'].every((id) => T.IAP_PRODUCTS.some((p) => p.id === id)));
  check('mtx: only the two Time Warps are consumable', T.IAP_PRODUCTS.filter((p) => p.consumable).map((p) => p.id).sort().join() === 'timewarp_24h,timewarp_4h');

  // --- IAP: starter_cores grants 3 cores, once (idempotent on Play restore re-fire) ---
  s.cores = 0; s.coresEarned = 0;
  T.grantPurchase('starter_cores');
  check('mtx: starter_cores grants +3 cores', s.cores === 3 && s.coresEarned === 3 && s.iap.starter_cores === true);
  T.grantPurchase('starter_cores');
  check('mtx: starter_cores idempotent (no double-grant on restore)', s.cores === 3 && s.coresEarned === 3);

  // --- IAP: Overclock +25% multiplies real production ---
  check('mtx: iapProdMult is 1 before purchase', T.iapProdMult() === 1);
  const baseW = T.totalWps();
  T.grantPurchase('boost_production_25');
  check('mtx: Overclock sets iapProdMult ×1.25', Math.abs(T.iapProdMult() - 1.25) < 1e-9 && s.iap.boost_production_25 === true);
  check('mtx: Overclock actually lifts totalWps ×1.25', baseW > 0 && Math.abs(T.totalWps() - baseW * 1.25) < baseW * 1e-9);

  // --- IAP: supporter + theme entitlement flags ---
  T.grantPurchase('supporter_pack');   T.grantPurchase('theme_pack_phosphor');
  check('mtx: supporter + theme entitlements set', s.iap.supporter_pack === true && s.iap.theme_pack_phosphor === true);

  // --- IAP: Time Warp consumables grant N hours of production, re-grantable ---
  s.iap.boost_production_25 = false;        // isolate the rate from the +25%
  s.watts = 0; s.totalEarned = 0;
  const rate = T.totalWps() / T.buffMult('prod');   // steady-state rate: Time Warp excludes transient buffs (boost/frenzy/streak)
  T.grantPurchase('timewarp_4h');
  check('mtx: timewarp_4h grants 4h of production', rate > 0 && Math.abs(s.watts - rate * 4 * 3600) < rate * 1e-6);
  const after4 = s.watts;
  T.grantPurchase('timewarp_4h');
  check('mtx: timewarp consumable re-grants on repurchase', Math.abs(s.watts - (after4 + rate * 4 * 3600)) < rate * 1e-6);
  s.watts = 0;
  T.grantPurchase('timewarp_24h');
  check('mtx: timewarp_24h grants 24h of production', Math.abs(s.watts - rate * 24 * 3600) < rate * 1e-6);

  // --- REGRESSION (Finding B): a transient x2 boost must NOT inflate a paid Time Warp.
  // Invariant: the warp payout is identical whether or not a boost is active. ---
  s.boostUntil = 0; T.syncBoostBuff();          // ensure no boost active
  s.watts = 0; T.grantPurchase('timewarp_24h');
  const warpNoBoost = s.watts;
  T.grantBoost('regression');                   // x2 transient boost now live
  s.watts = 0; T.grantPurchase('timewarp_24h');
  const warpBoosted = s.watts;
  check('mtx: Time Warp payout is unchanged by an active x2 boost', warpNoBoost > 0 && Math.abs(warpBoosted - warpNoBoost) < warpNoBoost * 1e-6);
  s.boostUntil = 0; T.syncBoostBuff();          // restore: clear boost for the buff tests below

  // --- unknown SKU is a safe no-op ---
  const cBefore = s.cores;
  T.grantPurchase('not_a_real_sku');
  check('mtx: unknown SKU is a no-op (no throw, no grant)', s.cores === cBefore);

  // --- Ad reward: 2x boost buff ---
  s.boostUntil = 0; T.syncBoostBuff();
  const prod0 = T.buffMult('prod');
  T.grantBoost('test');
  check('mtx: ad boost opens a ~10min window', s.boostUntil > Date.now() && s.boostUntil <= Date.now() + T.BOOST_MS + 3000);
  check('mtx: ad boost ×2 enters buffMult(prod)', Math.abs(T.buffMult('prod') - prod0 * 2) < prod0 * 1e-9);
  const firstUntil = s.boostUntil;
  T.grantBoost('test2');
  check('mtx: stacking boosts extend duration (not multiplier)', Math.abs(s.boostUntil - (firstUntil + T.BOOST_MS)) < 3000);

  // --- Ad caps: per-placement daily limits, independent, reset on a new day ---
  s.adDay = T.localDay(); s.adUses = {};
  check('mtx: boost ad cap starts full', T.adUsesLeft('boost') === T.AD_LIMITS.boost);
  for (let i = 0; i < T.AD_LIMITS.boost; i++) T.markAdUse('boost');
  check('mtx: boost ad cap exhausts after AD_LIMITS uses', T.adUsesLeft('boost') === 0);
  check('mtx: surge ad cap is independent of boost', T.adUsesLeft('surge') === T.AD_LIMITS.surge);
  s.adDay = 'an old day';
  check('mtx: a new day resets the ad caps', T.adUsesLeft('boost') === T.AD_LIMITS.boost);
}

// zap milestones — Voltlands analog of Grid tap milestones (shared thresholds +
// math; leaner ×1.25 per step vs the Grid's ×1.5), reset per-run like Grid clicks.
{
  const sR = T.sl();
  S().wormhole = true; S().world = 'volt';
  S().challenges = { grid: '', volt: '' }; S().challengeBackup = { grid: null, volt: null };
  // shared math over both bases
  check('zapmilestone: milestoneMult(0,1.25) = 1', T.milestoneMult(0, 1.25) === 1);
  check('zapmilestone: milestoneMult(100,1.25) = 1.25', Math.abs(T.milestoneMult(100, 1.25) - 1.25) < 1e-9);
  check('zapmilestone: milestoneMult(100,1.5) = 1.5 (grid base)', Math.abs(T.milestoneMult(100, 1.5) - 1.5) < 1e-9);
  // zapPower gains exactly ×1.25 crossing the first milestone (only sl().zaps changes)
  sR.zaps = 0; const zp0 = T.zapPower();
  sR.zaps = 100; const zp1 = T.zapPower();
  check('zapmilestone: zapPower ×1.25 after crossing 100 zaps', zp0 > 0 && Math.abs(zp1 - zp0 * 1.25) < zp0 * 1e-9);
  // awardZaps increments the counter and tracks milestones
  sR.zaps = 0; T.awardZaps(100);
  check('zapmilestone: awardZaps increments the counter', sR.zaps === 100);
  check('zapmilestone: milestonesPassed = 1 at 100 zaps', T.zapMilestonesPassed() === 1);
  check('zapmilestone: nextZapMilestone = 500', T.nextZapMilestone() === 500);
  // per-run reset parity: reincarnate + resetSlayerRun clear zaps; a grid reset keeps them
  sR.zaps = 500; sR.runVolts = 1e12;   // ensure reincarnateGain() > 0
  T.reincarnate();
  check('zapmilestone: reincarnate resets zaps to 0', T.sl().zaps === 0);
  T.sl().zaps = 500; T.resetSlayerRun();
  check('zapmilestone: resetSlayerRun resets zaps to 0', T.sl().zaps === 0);
  T.sl().zaps = 777;
  T.beginChallenge(T.CHALLENGES.find((c) => (c.world || 'grid') === 'grid'));
  check('zapmilestone: grid reset leaves volt zaps intact', T.sl().zaps === 777);
  S().challenges = { grid: '', volt: '' }; S().challengeBackup = { grid: null, volt: null };
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
