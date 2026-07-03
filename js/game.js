/* ============================================================
   PlugIdle — a retro CRT idle game about plugging in cords.
   Pure vanilla JS, no dependencies.
   Durable saves: localStorage (sync) + IndexedDB (eviction-resistant).
   ============================================================ */
(() => {
  'use strict';

  const VERSION = '1.1.6';       // shown on the settings page; bump alongside sw.js CACHE
  const SAVE_KEY = 'cordTycoon.save.v1';
  const TICK_MS = 100;            // sim resolution
  const SAVE_EVERY_MS = 5000;     // autosave cadence
  const PROD_MULT = 1.6;          // global pacing: scales all income (active, idle & clicks)
  const COST_GROWTH = 1.12;       // per-buy cost multiplier (lower = smoother stacking; was 1.15)
  const VOLT_COST_GROWTH = 1.16;  // Voltlands per-buy cost growth (bumped 1.14 -> 1.16 after a pacing sim showed it ran a bit fast). The single dial for World 2: raise to slow the economy, lower to speed it. Steeper than the Grid's 1.12.

  /* ---------- Content: cord generators ----------
     Each generator produces watts/sec. Cost grows 1.15x per buy. */
  const CORDS = [
    { id: 'usba',   icon: '🔌', name: 'USB-A Cable',     baseCost: 15,        wps: 0.1,   desc: 'The humble rectangle. Always upside down.' },
    { id: 'jack',   icon: '🎧', name: '3.5mm Audio Jack', baseCost: 100,      wps: 1,     desc: 'Plug in, hear the hiss of progress.' },
    { id: 'hdmi',   icon: '📺', name: 'HDMI Cable',       baseCost: 1100,     wps: 8,     desc: 'Now in glorious 4K throughput.' },
    { id: 'eth',    icon: '🌐', name: 'Ethernet Cable',   baseCost: 12000,    wps: 47,    desc: 'That satisfying RJ45 click.' },
    { id: 'usbc',   icon: '⚡', name: 'USB-C Cable',      baseCost: 130000,   wps: 260,   desc: 'Reversible. Finally.' },
    { id: 'power',  icon: '🔋', name: 'Power Cord',       baseCost: 1.4e6,    wps: 1400,  desc: 'The three-pronged workhorse.' },
    { id: 'thndr',  icon: '🌩️', name: 'Thunderbolt 4',    baseCost: 2e7,      wps: 7800,  desc: '40 Gbps of pure plug-in bliss.' },
    { id: 'fiber',  icon: '✨', name: 'Fiber Optic Line', baseCost: 3.3e8,    wps: 44000, desc: 'Plugging in at the speed of light.' },
    { id: 'indus',  icon: '🏭', name: 'Industrial Bus',   baseCost: 5.1e9,    wps: 4e5,desc: 'Cables thicker than your arm.' },
    { id: 'subsea', icon: '🌊', name: 'Subsea Cable',     baseCost: 7.5e10,   wps: 3.6e6, desc: 'Wiring continents together.' },
    { id: 'orbit',  icon: '🛰️', name: 'Orbital Tether',   baseCost: 1e12,     wps: 3.2e7,   desc: 'A cord from the ground to the stars.' },
    { id: 'quantum',icon: '⚛️', name: 'Quantum Link',     baseCost: 1.4e13,   wps: 2.9e8, desc: 'Entangled. Connected. Everywhere at once.' },
    { id: 'neural',  icon: '🧠', name: 'Neural Cable',     baseCost: 2e14,    wps: 2.6e9,    desc: 'Plugged straight into the cortex.' },
    { id: 'plasma',  icon: '🔥', name: 'Plasma Conduit',   baseCost: 3e15,    wps: 2.3e10,  desc: 'Liquid lightning in a braided sheath.' },
    { id: 'graviton',icon: '🌀', name: 'Graviton Cord',    baseCost: 4e16,    wps: 2.1e11, desc: 'It plugs into spacetime itself.' },
    { id: 'darkfib', icon: '🕳️', name: 'Dark Fiber',       baseCost: 6e17,    wps: 1.9e12, desc: 'Bandwidth drawn from the void.' },
    { id: 'wormhole',icon: '🌌', name: 'Wormhole Jack',    baseCost: 9e18,    wps: 1.7e13,   desc: 'Both ends, everywhere, at once.' },
    { id: 'neutrino',icon: '☄️', name: 'Neutrino Strand',  baseCost: 1.3e20,  wps: 1.5e14, desc: 'Passes through planets to connect.' },
    { id: 'tachyon', icon: '💫', name: 'Tachyon Line',     baseCost: 2e21,    wps: 1.4e15,   desc: 'Delivers the data before you ask.' },
    { id: 'singular',icon: '⚫', name: 'Singularity Bus',  baseCost: 3e22,    wps: 1.25e16, desc: 'One cord to compress them all.' },
    { id: 'cosmic',  icon: '✴️', name: 'Cosmic String',    baseCost: 4.5e23,  wps: 1.1e17, desc: 'A defect in reality, now load-bearing.' },
    { id: 'multivrs',icon: '🪐', name: 'Multiversal Hub',  baseCost: 7e24,    wps: 1e18,   desc: 'Plugs into every timeline at once.' },
    { id: 'divine',  icon: '😇', name: 'Divine Connector', baseCost: 1e26,    wps: 9e18,   desc: 'The port the universe booted from.' },
    { id: 'omega',   icon: '🅾️', name: 'Omega Cord',       baseCost: 1.5e27,  wps: 8e19, desc: 'The final plug. Nothing connects beyond.' },
    { id: 'axiom',   icon: '📐', name: 'Axiom Wire',       baseCost: 2.5e29,  wps: 7e20, desc: 'Plugs pure logic straight into the wall.' },
    { id: 'genesis', icon: '🌱', name: 'Genesis Patch',    baseCost: 4e31,    wps: 6.5e21, desc: 'The cable the next universe boots from.' },
    // Final tier: carries no watts — instead it boosts prestige core gain.
    // coreGain = + this much to the core-gain multiplier per cord owned.
    { id: 'ouro',    icon: '♾️', name: 'Ouroboros Cord',   baseCost: 5e33,    wps: 0, coreGain: 0.01, desc: 'Loops the grid back into the recycler.' },
  ];

  /* ---------- Content: upgrades ----------
     kind: 'click' multiplies tap power; 'global' multiplies all wps;
     'cord' multiplies one cord's output. req = total owned needed to unlock. */
  const UPGRADES = [
    { id: 'u_click1', icon: '👆', name: 'Reinforced Thumbs',  cost: 100,    kind: 'click',  mult: 1.3, desc: 'Tap power ×1.3.' },
    { id: 'u_usba',   icon: '🔌', name: 'Gold USB Contacts',  cost: 500,    kind: 'cord', cord: 'usba',  mult: 2, req: { cord: 'usba', n: 5 }, desc: 'USB-A output x2.' },
    { id: 'u_click2', icon: '✋', name: 'Two-Handed Plugging',cost: 2000,   kind: 'click',  mult: 1.3, desc: 'Tap power ×1.3.' },
    { id: 'u_jack',   icon: '🎧', name: 'Hi-Fi Insulation',   cost: 5000,   kind: 'cord', cord: 'jack',  mult: 2, req: { cord: 'jack', n: 5 }, desc: '3.5mm jack output x2.' },
    { id: 'u_glob1',  icon: '🧰', name: 'Cable Management',    cost: 25000,  kind: 'global', mult: 1.25, desc: 'All cords +25%.' },
    { id: 'u_hdmi',   icon: '📺', name: 'HDMI 2.1 Spec',       cost: 60000,  kind: 'cord', cord: 'hdmi',  mult: 2, req: { cord: 'hdmi', n: 5 }, desc: 'HDMI output x2.' },
    { id: 'u_click3', icon: '🦾', name: 'Robotic Plug Arm',   cost: 120000, kind: 'click',  mult: 1.4, desc: 'Tap power ×1.4.' },
    { id: 'u_eth',    icon: '🌐', name: 'Cat-8 Shielding',     cost: 250000, kind: 'cord', cord: 'eth',   mult: 2, req: { cord: 'eth', n: 5 }, desc: 'Ethernet output x2.' },
    { id: 'u_glob2',  icon: '🏷️', name: 'Color-Coded Labels',  cost: 1e6,    kind: 'global', mult: 1.5,  desc: 'All cords +50%.' },
    { id: 'u_usbc',   icon: '⚡', name: '240W Power Delivery', cost: 3e6,    kind: 'cord', cord: 'usbc',  mult: 2, req: { cord: 'usbc', n: 5 }, desc: 'USB-C output x2.' },
    { id: 'u_power',  icon: '🔋', name: 'Surge Protection',    cost: 2.5e7,  kind: 'cord', cord: 'power', mult: 2, req: { cord: 'power', n: 5 }, desc: 'Power cord output x2.' },
    { id: 'u_glob3',  icon: '🤖', name: 'Automated Patch Bay', cost: 1.5e8,  kind: 'global', mult: 2,    desc: 'All cords x2.' },
    { id: 'u_thndr',  icon: '🌩️', name: 'Active Repeaters',    cost: 5e8,    kind: 'cord', cord: 'thndr', mult: 2, req: { cord: 'thndr', n: 5 }, desc: 'Thunderbolt output x2.' },
    { id: 'u_fiber',  icon: '✨', name: 'Dense WDM',           cost: 8e9,    kind: 'cord', cord: 'fiber', mult: 2, req: { cord: 'fiber', n: 5 }, desc: 'Fiber output x2.' },
    { id: 'u_glob4',  icon: '🛸', name: 'Self-Plugging Drones',cost: 1e11,   kind: 'global', mult: 3,    desc: 'All cords x3.' },
    { id: 'u_click4', icon: '🦿', name: 'Exoskeleton Glove',  cost: 5e7,    kind: 'click',  mult: 1.4, desc: 'Tap power ×1.4.' },
    { id: 'u_click5', icon: '🐝', name: 'Nanobot Swarm',      cost: 1e11,   kind: 'click',  mult: 1.4, desc: 'Tap power ×1.4.' },
    { id: 'u_click6', icon: '🧠', name: 'Hive-Mind Tap',      cost: 1e16,   kind: 'click',  mult: 1.4, desc: 'Tap power ×1.4.' },
    { id: 'u_glob5',  icon: '🎛️', name: 'Plug Orchestra',     cost: 1e14,   kind: 'global', mult: 3, desc: 'All cords x3.' },
    { id: 'u_glob6',  icon: '🧮', name: 'AI Cable Router',     cost: 1e18,   kind: 'global', mult: 4, desc: 'All cords x4.' },
    { id: 'u_glob7',  icon: '🌐', name: 'Reality Patchbay',    cost: 1e23,   kind: 'global', mult: 5, desc: 'All cords x5.' },
    { id: 'u_click7', icon: '🥊', name: 'Plasma Gauntlet',     cost: 5e13,   kind: 'click',  mult: 1.5, desc: 'Tap power ×1.5.' },
    { id: 'u_click8', icon: '🌟', name: 'Singularity Grip',    cost: 1e19,   kind: 'click',  mult: 2, desc: 'Tap power ×2.' },
    // Tap-scaling upgrades — each hand-plug also earns a % of your current W/s.
    { id: 'tw1', icon: '⚡', name: 'Live Wire',      cost: 5e4,  kind: 'tapwps', frac: 0.01, req: { cord: 'usbc',  n: 1 }, desc: 'Each tap also earns 1% of your W/s.' },
    { id: 'tw2', icon: '🔋', name: 'Capacitor Bank', cost: 5e7,  kind: 'tapwps', frac: 0.02, req: { cord: 'thndr', n: 1 }, desc: 'Each tap earns +2% of your W/s.' },
    { id: 'tw3', icon: '🗼', name: 'Tesla Coil',     cost: 5e11, kind: 'tapwps', frac: 0.03, req: { cord: 'orbit', n: 1 }, desc: 'Each tap earns +3% of your W/s.' },
    // Synergy upgrades — one cord's fleet boosts another (Cookie-Clicker style).
    { id: 'syn1', icon: '🔗', name: 'Daisy Chain',       cost: 2e4,  kind: 'synergy', cord: 'jack',  from: 'usba',    per: 0.005, req: { cord: 'usba',  n: 10 }, desc: '+0.5% Audio Jack per USB-A owned.' },
    { id: 'syn2', icon: '🪢', name: 'Bandwidth Bonding',  cost: 5e5,  kind: 'synergy', cord: 'eth',   from: 'hdmi',    per: 0.005, req: { cord: 'hdmi',  n: 10 }, desc: '+0.5% Ethernet per HDMI owned.' },
    { id: 'syn3', icon: '🧵', name: 'Backbone Sync',      cost: 5e8,  kind: 'synergy', cord: 'fiber', from: 'power',   per: 0.003, req: { cord: 'power', n: 10 }, desc: '+0.3% Fiber per Power Cord owned.' },
    { id: 'syn4', icon: '♾️', name: 'Quantum Coupling',   cost: 1e27, kind: 'synergy', cord: 'omega', from: 'quantum', per: 0.01,  req: { cord: 'quantum', n: 10 }, desc: '+1% Omega per Quantum Link owned.' },
    // Per-cord doublers for the new tiers (unlock at 5 owned).
    { id: 'u_neural',  icon: '🧠', name: 'Myelin Sheathing',  cost: 6e15,  kind: 'cord', cord: 'neural',   mult: 2, req: { cord: 'neural',   n: 5 }, desc: 'Neural Cable output x2.' },
    { id: 'u_plasma',  icon: '🔥', name: 'Magnetic Bottling', cost: 1e17,  kind: 'cord', cord: 'plasma',   mult: 2, req: { cord: 'plasma',   n: 5 }, desc: 'Plasma Conduit output x2.' },
    { id: 'u_graviton',icon: '🌀', name: 'Tensor Winding',    cost: 1.3e18,kind: 'cord', cord: 'graviton', mult: 2, req: { cord: 'graviton', n: 5 }, desc: 'Graviton Cord output x2.' },
    { id: 'u_darkfib', icon: '🕳️', name: 'Vacuum Pumping',    cost: 2e19,  kind: 'cord', cord: 'darkfib',  mult: 2, req: { cord: 'darkfib',  n: 5 }, desc: 'Dark Fiber output x2.' },
    { id: 'u_wormhole',icon: '🌌', name: 'Throat Stabilizer', cost: 3e20,  kind: 'cord', cord: 'wormhole', mult: 2, req: { cord: 'wormhole', n: 5 }, desc: 'Wormhole Jack output x2.' },
    { id: 'u_neutrino',icon: '☄️', name: 'Flavour Oscillator',cost: 4e21,  kind: 'cord', cord: 'neutrino', mult: 2, req: { cord: 'neutrino', n: 5 }, desc: 'Neutrino Strand output x2.' },
    { id: 'u_tachyon', icon: '💫', name: 'Causality Bypass',  cost: 6e22,  kind: 'cord', cord: 'tachyon',  mult: 2, req: { cord: 'tachyon',  n: 5 }, desc: 'Tachyon Line output x2.' },
    { id: 'u_singular',icon: '⚫', name: 'Event Horizoning',  cost: 1e24,  kind: 'cord', cord: 'singular', mult: 2, req: { cord: 'singular', n: 5 }, desc: 'Singularity Bus output x2.' },
    { id: 'u_cosmic',  icon: '✴️', name: 'Tension Tuning',    cost: 1.5e25,kind: 'cord', cord: 'cosmic',   mult: 2, req: { cord: 'cosmic',   n: 5 }, desc: 'Cosmic String output x2.' },
    { id: 'u_multivrs',icon: '🪐', name: 'Brane Alignment',   cost: 2e26,  kind: 'cord', cord: 'multivrs', mult: 2, req: { cord: 'multivrs', n: 5 }, desc: 'Multiversal Hub output x2.' },
    { id: 'u_divine',  icon: '😇', name: 'Holy Soldering',    cost: 3e27,  kind: 'cord', cord: 'divine',   mult: 2, req: { cord: 'divine',   n: 5 }, desc: 'Divine Connector output x2.' },
    { id: 'u_omega',   icon: '🅾️', name: 'Final Firmware',    cost: 5e28,  kind: 'cord', cord: 'omega',    mult: 2, req: { cord: 'omega',    n: 5 }, desc: 'Omega Cord output x2.' },
    // Post-Omega wave (v1.11): two new tiers + a global + a synergy.
    { id: 'u_glob8',   icon: '🌌', name: 'Universal Mains',   cost: 1e29,  kind: 'global', mult: 5, desc: 'All cords x5.' },
    { id: 'u_axiom',   icon: '📐', name: 'Lemma Lattice',     cost: 8e30,  kind: 'cord', cord: 'axiom',    mult: 2, req: { cord: 'axiom',    n: 5 }, desc: 'Axiom Wire output x2.' },
    { id: 'syn5',      icon: '🧬', name: 'Seed Crystal',      cost: 5e31,  kind: 'synergy', cord: 'genesis', from: 'omega', per: 0.01, req: { cord: 'omega', n: 10 }, desc: '+1% Genesis Patch per Omega Cord owned.' },
    { id: 'u_genesis', icon: '🌱', name: 'Bootstrap Loom',    cost: 1.3e33,kind: 'cord', cord: 'genesis',  mult: 2, req: { cord: 'genesis',  n: 5 }, desc: 'Genesis Patch output x2.' },
  ];

  /* ---------- Content: core upgrades (prestige shop) ----------
     Bought with Prestige Cores (◆). Cores are spent, but your per-core
     production bonus is based on cores ever EARNED, so it never drops. */
  const CORE_UPGRADES = [
    { id: 'thumbs',    icon: '👍', name: 'Overclocked Thumbs', cost: 1,  desc: 'Tap power ×2.' },
    { id: 'static',    icon: '🔱', name: 'Static Discharge',   cost: 5,  desc: 'Each tap also earns 4% of your W/s.' },
    { id: 'phantom',   icon: '🔌', name: 'Phantom Power',      cost: 2,  desc: 'All production ×1.5.' },
    { id: 'battery',   icon: '🔋', name: 'Battery Backup',     cost: 2,  desc: 'Offline cap +24h (48h total).' },
    { id: 'magnet',    icon: '🧲', name: 'Surge Magnet',       cost: 3,  desc: 'Power surges arrive ~40% sooner.' },
    { id: 'jumpstart', icon: '🚀', name: 'Jump Start',         cost: 4,  desc: 'Keep 5% of your watts through recycling.' },
    { id: 'megasurge', icon: '⚡', name: 'Mega Surges',        cost: 4,  desc: 'Surge Overload payouts ×2.' },
    { id: 'recycler',  icon: '♻️', name: "Recycler's Edge",    cost: 6,  desc: 'Prestige core gains ×1.5.' },
    { id: 'resonance', icon: '💠', name: 'Core Resonance',     cost: 8,  desc: 'Each core gives +8% instead of +5%.' },
    { id: 'nightshift',icon: '🌙', name: 'Night Shift',        cost: 10, desc: 'Offline efficiency 10% → 50%.' },
    { id: 'overdrive', icon: '🔥', name: 'Reactor Overdrive',  cost: 12, desc: 'All production ×2.' },
    { id: 'autotap',    icon: '🤖', name: 'Auto-Tapper',       cost: 15,  desc: 'Auto-plugs 5×/sec, free forever.' },
    // Auto-Tapper ladder — each unlocks once the previous is owned.
    { id: 'autotap10',  icon: '🤖', name: 'Auto-Tapper II',    cost: 60,  req: 'autotap',    desc: 'Auto-plugs 10×/sec.' },
    { id: 'autotap20',  icon: '🤖', name: 'Auto-Tapper III',   cost: 250, req: 'autotap10',  desc: 'Auto-plugs 20×/sec.' },
    { id: 'autotap50',  icon: '🤖', name: 'Auto-Tapper IV',    cost: 1000, req: 'autotap20',  desc: 'Auto-plugs 50×/sec.' },
    { id: 'autotap100', icon: '🤖', name: 'Auto-Tapper V',     cost: 5000, req: 'autotap50',  desc: 'Auto-plugs 100×/sec.' },
    { id: 'autotap1000',icon: '🤖', name: 'Auto-Tapper VI',    cost: 30000, req: 'autotap100', desc: 'Auto-plugs 150×/sec.' },
    { id: 'autobuy',   icon: '🛒', name: 'Auto-Buyer',         cost: 18, desc: 'Auto-buys cords for you — cheapest first, many at once.' },
    { id: 'autoupg',   icon: '🛠️', name: 'Auto-Upgrader',      cost: 22, desc: 'Auto-buys upgrades the moment you can afford them.' },
    // Late-game core accelerators — the ladder that makes ??? reachable.
    { id: 'fission',   icon: '☢️', name: 'Core Fission',       cost: 5e9,  desc: 'Prestige core gains ×5.' },
    { id: 'cascade',   icon: '🧨', name: 'Core Cascade',       cost: 1e12, desc: 'Prestige core gains ×25.' },
    { id: 'singular2', icon: '🕳️', name: 'Core Singularity',   cost: 6e13, desc: 'Prestige core gains ×100.' },
    { id: 'mystery',   icon: '🌀', name: '???',                cost: 1e15, desc: '[DATA CORRUPTED] Do not plug in.' },
  ];

  /* ---------- Content: storm upgrades (Voltlands prestige shop) ----------
     Bought with Storm Shards (💠). Mirrors CORE_UPGRADES — shards are spent,
     but the per-shard ZPS bonus is based on shards ever EARNED, so it never
     drops. Costs reuse the proven Core Upgrade ladder against a comparably
     paced shard income. The auto* entries just set ownership here; their
     logic lands in the automation stage. The w3teaser is a non-purchasable
     world-3 placeholder, rendered greyed at the bottom. */
  const STORM_UPGRADES = [
    { id: 'livewire',    icon: '🔌', name: 'Live Wire',       cost: 1,   desc: 'Tap-zap power ×3.' },
    { id: 'conduction',  icon: '🧲', name: 'Conduction',      cost: 3,   desc: 'All weapons ×1.5.' },
    { id: 'capbank',     icon: '🔋', name: 'Capacitor Bank',  cost: 3,   desc: 'Offline volts cap +24h (48h total).' },
    { id: 'chaser',      icon: '🌪️', name: 'Storm Chaser',    cost: 6,   desc: 'Storm Shard gains ×1.5.' },
    { id: 'resocore',    icon: '💠', name: 'Resonant Core',   cost: 8,   desc: 'Each shard gives +8% instead of +5%.' },
    { id: 'overvolt',    icon: '🔥', name: 'Overvoltage',     cost: 12,  desc: 'All ZPS ×2.' },
    { id: 'autozap',     icon: '🤖', name: 'Auto-Zapper',     cost: 15,  desc: 'Auto tap-zaps 5×/sec, free forever.' },
    { id: 'autoarsenal', icon: '🛒', name: 'Auto-Arsenal',    cost: 18,  desc: 'Auto-buys weapons — cheapest first.' },
    { id: 'autotinker',  icon: '🛠️', name: 'Auto-Tinker',     cost: 22,  desc: 'Auto-buys zap upgrades the moment you can afford them.' },
    { id: 'stormfission',icon: '☢️', name: 'Storm Fission',   cost: 5e9, desc: 'Storm Shard gains ×5.' },
    // ---- Voltlands expansion: 16 more storm upgrades (eff-based; some prereq-chained) ----
    { id: 'livewire2',  icon: '🔌', name: 'Live Wire II',     cost: 30,   req: 'livewire',    eff: { tap: 2 },         desc: 'Tap-zap power ×2 more.' },
    { id: 'conduction2',icon: '🧲', name: 'Conduction II',    cost: 35,   req: 'conduction',  eff: { zps: 2 },         desc: 'All ZPS ×2.' },
    { id: 'overvolt2',  icon: '🔥', name: 'Overvoltage II',   cost: 40,   req: 'overvolt',    eff: { zps: 2 },         desc: 'All ZPS ×2 more.' },
    { id: 'chaser2',    icon: '🌪️', name: 'Storm Chaser II',  cost: 30,   req: 'chaser',      eff: { shardGain: 1.5 }, desc: 'Storm Shard gains ×1.5 more.' },
    { id: 'livewire3',  icon: '⚡', name: 'Live Wire III',    cost: 60,   req: 'livewire2',   eff: { tap: 2 },         desc: 'Tap-zap power ×2 more.' },
    { id: 'conduction3',icon: '🧲', name: 'Conduction III',   cost: 70,   req: 'conduction2', eff: { zps: 2 },         desc: 'All ZPS ×2 more.' },
    { id: 'overvolt3',  icon: '🔥', name: 'Overvoltage III',  cost: 80,   req: 'overvolt2',   eff: { zps: 2 },         desc: 'All ZPS ×2 more.' },
    { id: 'chaser3',    icon: '🌪️', name: 'Storm Chaser III', cost: 60,   req: 'chaser2',     eff: { shardGain: 1.5 }, desc: 'Storm Shard gains ×1.5 more.' },
    { id: 'galvanic',   icon: '🌫️', name: 'Galvanic Field',   cost: 50,                       eff: { zps: 1.5 },       desc: 'All ZPS ×1.5.' },
    { id: 'dynamoheart',icon: '🫀', name: 'Dynamo Heart',     cost: 100,                      eff: { tap: 3 },         desc: 'Tap-zap power ×3.' },
    { id: 'thunderhead',icon: '🌩️', name: 'Thunderhead',      cost: 120,                      eff: { zps: 3 },         desc: 'All ZPS ×3.' },
    { id: 'maelstrom',  icon: '🌀', name: 'Maelstrom',        cost: 250,                      eff: { zps: 3 },         desc: 'All ZPS ×3.' },
    { id: 'apexcharge', icon: '⛈️', name: 'Apex Charge',      cost: 300,                      eff: { zps: 3 },         desc: 'All ZPS ×3.' },
    { id: 'stormfiss2', icon: '☢️', name: 'Storm Fission II',  cost: 1e10, req: 'stormfission',eff: { shardGain: 2 },   desc: 'Storm Shard gains ×2 more.' },
    { id: 'eyestorm',   icon: '👁️', name: 'Eye of the Storm', cost: 5e10,                     eff: { zps: 5, tap: 5 }, desc: 'All ZPS ×5 and tap-zap ×5.' },
    { id: 'tempestcore',icon: '🌪️', name: 'Tempest Core',     cost: 1e11,                     eff: { zps: 5 },         desc: 'All ZPS ×5.' },
    { id: 'discharge',     icon: '💥', name: 'Discharge Capacitor', cost: 4,  desc: 'Unlock DISCHARGE: tap to dump ~15s of ZPS in one burst (20s cooldown).' },
    { id: 'autodischarge', icon: '🔁', name: 'Auto-Discharge',      cost: 12, req: 'discharge', desc: 'Fires Discharge automatically the moment it is ready.' },
    { id: 'w3teaser',    icon: '🌌', name: '???',             disabled: true, desc: 'Coming soon…' },
  ];

  /* ---------- Content: the Surge Grid (Voltlands combat research tree) ----------
     Bought with Surge Charges (minted by kills). Linear prereq chains feed three
     MUTUALLY-EXCLUSIVE branch capstones (crit / flow / hunt); each node folds a
     multiplier into the EXISTING combat chains, so an un-specced tree is a no-op.
     Free respec on reincarnate. eff keys: zps/tap/autoRate/volt/shard are
     multipliers; critChance is additive; critMult is a multiplier. */
  const SURGE_NODES = [
    // Trunk — linear, no branch.
    { id: 'sg_root', icon: '⚡', name: 'Live Current',    cost: 3,   req: null,      branch: '', eff: { tap: 1.5 },             desc: 'Tap-zap power ×1.5.' },
    { id: 'sg_t2',   icon: '🔌', name: 'Conductive Core', cost: 6,   req: 'sg_root', branch: '', eff: { zps: 1.5 },             desc: 'All ZPS ×1.5.' },
    { id: 'sg_t3',   icon: '🌀', name: 'Overdrive Coils', cost: 12,  req: 'sg_t2',   branch: '', eff: { zps: 1.5, tap: 1.5 },   desc: 'ZPS ×1.5 and tap-zap ×1.5.' },
    { id: 'sg_fork', icon: '🔱', name: 'Surge Fork',      cost: 20,  req: 'sg_t3',   branch: '', eff: { zps: 1.25 },            desc: 'All ZPS ×1.25. Opens the three paths.' },
    // CHOOSE ONE PATH — three mutually-exclusive capstones (each commits surgeBranch).
    { id: 'sg_crit', icon: '💥', name: 'Critical Path',   cost: 30,  req: 'sg_fork', branch: 'crit', eff: { critChance: 0.05, critMult: 1.5 }, desc: 'PATH — enable & boost crits: +5% crit chance, crit ×1.5.' },
    { id: 'sg_flow', icon: '🌊', name: 'Flow State',      cost: 30,  req: 'sg_fork', branch: 'flow', eff: { zps: 2, autoRate: 1.5 },           desc: 'PATH — ZPS ×2, auto-zapper rate ×1.5.' },
    { id: 'sg_hunt', icon: '🎯', name: 'Boss Hunter',     cost: 30,  req: 'sg_fork', branch: 'hunt', eff: { volt: 1.5, shard: 1.25 },          desc: 'PATH — volt income ×1.5, shard gain ×1.25.' },
    // Crit sub-chain.
    { id: 'sg_crit2', icon: '🔪', name: 'Hair Trigger', cost: 45,  req: 'sg_crit',  branch: 'crit', eff: { critChance: 0.07 },        desc: '+7% crit chance.' },
    { id: 'sg_crit3', icon: '⚔️', name: 'Overkill',     cost: 70,  req: 'sg_crit2', branch: 'crit', eff: { critMult: 2 },             desc: 'Crit damage ×2.' },
    { id: 'sg_crit4', icon: '🗡️', name: 'Arc Flash',    cost: 110, req: 'sg_crit3', branch: 'crit', eff: { tap: 2, critChance: 0.05 }, desc: 'Tap-zap ×2 and +5% crit chance.' },
    { id: 'sg_crit5', icon: '☄️', name: 'Annihilation', cost: 170, req: 'sg_crit4', branch: 'crit', eff: { critMult: 2.5 },           desc: 'Crit damage ×2.5.' },
    // Flow sub-chain.
    { id: 'sg_flow2', icon: '💧', name: 'Steady Stream',   cost: 45,  req: 'sg_flow',  branch: 'flow', eff: { zps: 2 },                 desc: 'All ZPS ×2.' },
    { id: 'sg_flow3', icon: '🤖', name: 'Rapid Discharge', cost: 70,  req: 'sg_flow2', branch: 'flow', eff: { autoRate: 2 },            desc: 'Auto-zapper rate ×2.' },
    { id: 'sg_flow4', icon: '🌧️', name: 'Cascade',         cost: 110, req: 'sg_flow3', branch: 'flow', eff: { zps: 2 },                 desc: 'All ZPS ×2.' },
    { id: 'sg_flow5', icon: '🌊', name: 'Tidal Force',     cost: 170, req: 'sg_flow4', branch: 'flow', eff: { zps: 2.5, autoRate: 1.5 }, desc: 'ZPS ×2.5, auto-zapper rate ×1.5.' },
    // Hunt sub-chain.
    { id: 'sg_hunt2', icon: '🏹', name: 'Bounty',        cost: 45,  req: 'sg_hunt',  branch: 'hunt', eff: { volt: 1.5 },            desc: 'Volt income ×1.5.' },
    { id: 'sg_hunt3', icon: '⛈️', name: 'Storm Harvest', cost: 70,  req: 'sg_hunt2', branch: 'hunt', eff: { shard: 1.5 },           desc: 'Shard gain ×1.5.' },
    { id: 'sg_hunt4', icon: '🐉', name: 'Giant Killer',  cost: 110, req: 'sg_hunt3', branch: 'hunt', eff: { volt: 2 },              desc: 'Volt income ×2.' },
    { id: 'sg_hunt5', icon: '👑', name: 'Apex Predator', cost: 170, req: 'sg_hunt4', branch: 'hunt', eff: { volt: 1.5, shard: 1.5 }, desc: 'Volt ×1.5, shard ×1.5.' },
  ];
  // Branch metadata for the three mutually-exclusive paths (icon/name/one-line tag
  // shown on the fork choice cards). Keyed by the `branch` field above.
  const SURGE_BRANCH_META = {
    crit: { icon: '💥', name: 'CRIT', tag: 'crit chance & damage' },
    flow: { icon: '🌊', name: 'FLOW', tag: 'ZPS & auto-zap rate' },
    hunt: { icon: '🎯', name: 'HUNT', tag: 'volt & shard income' },
  };
  const SURGE_BY_ID = {};
  for (const _n of SURGE_NODES) SURGE_BY_ID[_n.id] = _n;

  /* ---------- Content: challenges ----------
     Special runs with one rule mutated (started from the More tab after the
     first prestige). Resets the run like recycling, no cores gained; reaching
     the goal lifts the rule and unlocks a PERMANENT perk. */
  const CHALLENGES = [
    { id: 'solo',       icon: '1️⃣', name: 'SOLO CIRCUIT', world: 'grid', rule: 'Only USB-A cables can be bought.',          goal: 1e8,  reward: 'GOLD PINS — USB-A output ×5, forever.' },
    { id: 'unplugged',  icon: '🚫', name: 'UNPLUGGED',    world: 'grid', rule: 'Hand-plugging earns nothing.',              goal: 1e9,  reward: 'JUMP LEADS — every run starts with 5 USB-A cables.' },
    { id: 'minimalist', icon: '🧘', name: 'MINIMALIST',   world: 'grid', rule: 'Upgrades cannot be bought.',                goal: 5e9,  reward: 'PREWIRED — runs start with Reinforced Thumbs owned.' },
    { id: 'darkgrid',   icon: '🌑', name: 'DARK GRID',    world: 'grid', rule: 'Power surges never appear.',                goal: 1e10, reward: 'SURGE BEACON — surges arrive 20% sooner.' },
    { id: 'overpriced', icon: '💸', name: 'OVERPRICED',   world: 'grid', rule: 'Cord costs grow 18% per buy (not 12%).',    goal: 1e11, reward: 'WHOLESALE — all cords cost 3% less.' },
    { id: 'brownout',   icon: '🕯️', name: 'BROWNOUT',     world: 'grid', rule: 'All production halved.',                    goal: 1e12, reward: '2× PRESTIGE CORES — double the cores you earn on every recycle.' },
    // Voltlands challenges (world:'volt'). Goals are runVolts thresholds; perks are
    // permanent and applied in their respective rule sites / applyReincarnatePerks.
    { id: 'bareknuckle', icon: '✊', name: 'BARE KNUCKLES', world: 'volt', rule: 'Only the Static Glove can be bought.',   goal: 1e3, reward: 'KNUCKLE BUSTER — Static Glove zaps ×5, forever.' },
    { id: 'numbfingers', icon: '🧊', name: 'NUMB FINGERS',  world: 'volt', rule: 'Tap-zapping earns nothing.',             goal: 5e3, reward: 'CONDUCTIVE GRIP — each reincarnation starts with 5 Static Gloves.' },
    { id: 'notools',     icon: '🚱', name: 'NO TOOLS',      world: 'volt', rule: 'Zap upgrades cannot be bought.',          goal: 2e4, reward: 'BARE WIRE — runs start with Rubber Gloves Off owned.' },
    { id: 'suddendeath', icon: '💀', name: 'SUDDEN DEATH',  world: 'volt', rule: 'Bosses have ×3 HP.',                      goal: 1e5, reward: 'GIANT SLAYER — boss volt rewards ×2.' },
    { id: 'staticcling', icon: '🧲', name: 'STATIC CLING',  world: 'volt', rule: 'All ZPS halved.',                         goal: 5e5, reward: 'STATIC FIELD — auto tap-zaps (toggle in Settings).' },
    { id: 'powerdrain',  icon: '🪫', name: 'POWER DRAIN',   world: 'volt', rule: 'Weapon costs grow 18% per buy (not 12%).', goal: 2e6, reward: 'SURPLUS — all weapons cost 3% less.' },
    { id: 'glasscannon', icon: '🔪', name: 'GLASS CANNON', world: 'volt', rule: 'Tap-zap ×5, but every enemy has ×2 HP.',   goal: 1e4, reward: 'OVERLOAD — tap-zap power ×2, forever.' },
    { id: 'surgefamine', icon: '🥀', name: 'SURGE FAMINE', world: 'volt', rule: 'Kills mint no Surge Charges this run.',     goal: 5e4, reward: 'SURGE SURPLUS — every kill mints double Surge Charges, forever.' },
  ];
  // World-aware active-challenge accessor: defaults to the active world so existing
  // grid rule checks (`ch() === 'solo'`) keep working; pass 'volt' for tick-time
  // funcs that run regardless of the active world. `activeWorld` is defined later but
  // only ever called at runtime here (late binding is safe).
  const ch = (w) => (state && state.challenges && state.challenges[w || activeWorld()]) || '';
  const chDone = (id) => !!(state && state.challengesDone && state.challengesDone[id]);
  // Tiered challenges: challengesDone[id] is the COUNT of cleared tiers (a legacy
  // boolean `true` counts as 1). Volt challenges are 3 escalating tiers (×8 goal
  // each); grid challenges stay one-shot. The reward/perk is granted at tier 1
  // (chDone), higher tiers just feed trialGridBoost().
  const chTier = (id) => { const v = state && state.challengesDone && state.challengesDone[id]; return v === true ? 1 : (v || 0); };
  const chMaxTier = (c) => (c.world === 'volt' ? 3 : 1);
  const chGoalFor = (c) => c.goal * Math.pow(8, chTier(c.id));
  const chFullyDone = (c) => chTier(c.id) >= chMaxTier(c);

  /* ---------- Content: the Voltlands (idle slayer) ----------
     Unlocked by the ??? core upgrade. Weapons are this world's generators
     (zaps/sec instead of watts/sec); same cost growth and ownership
     milestones as cords, so the proven early-game curve carries over. */
  const WEAPONS = [
    { id: 'glove',   icon: '🧤', name: 'Static Glove',     baseCost: 15,      zps: 0.1,   desc: 'Shuffle on carpet. Touch enemy.' },
    { id: 'tongs',   icon: '🥢', name: 'Taser Tongs',      baseCost: 100,     zps: 1,     desc: 'For a more civilized electrocution.' },
    { id: 'welder',  icon: '🔧', name: 'Arc Welder',       baseCost: 1100,    zps: 8,     desc: 'Welds enemies to the floor. Permanently.' },
    { id: 'coil',    icon: '🗼', name: 'Tesla Coil',       baseCost: 12000,   zps: 47,    desc: 'Wireless damage transmission.' },
    { id: 'ladder',  icon: '🪜', name: "Jacob's Ladder",   baseCost: 1.3e5,   zps: 260,   desc: 'The climbing spark of doom.' },
    { id: 'cannon',  icon: '🧨', name: 'Capacitor Cannon', baseCost: 1.4e6,   zps: 1400,  desc: 'Charges slowly. Discharges all at once.' },
    { id: 'railgun', icon: '🎯', name: 'Volt Railgun',     baseCost: 2e7,     zps: 7800,  desc: 'The rails are also electrified.' },
    { id: 'storm',   icon: '🌩️', name: 'Storm Caller',     baseCost: 3.3e8,   zps: 44000, desc: 'Subscribe to lightning. Cancel anytime.' },
    { id: 'ball',    icon: '🔮', name: 'Ball Lightning',   baseCost: 5.1e9,   zps: 4e5,   desc: 'Science still cannot explain it. It hurts.' },
    { id: 'zeus',    icon: '🏛️', name: 'Zeus Rig',         baseCost: 7.5e10,  zps: 3.6e6, desc: 'Borrowed. Do not tell him.' },
    // ---- Voltlands expansion: 19 more weapons (continues the geometric ladder) ----
    { id: 'lance',    icon: '⚔️', name: 'Plasma Lance',     baseCost: 1e12,    zps: 3.2e7,   desc: 'Pointy end goes toward the enemy.' },
    { id: 'mortar',   icon: '💣', name: 'Ion Mortar',       baseCost: 1.4e13,  zps: 2.9e8,   desc: 'Lobs a ball of very angry electrons.' },
    { id: 'spire',    icon: '🏯', name: 'Tesla Spire',      baseCost: 2e14,    zps: 2.6e9,   desc: 'A skyscraper whose only job is damage.' },
    { id: 'striker',  icon: '🛰️', name: 'Orbital Striker',  baseCost: 3e15,    zps: 2.3e10,  desc: 'Death from low-earth orbit.' },
    { id: 'nullbolt', icon: '🧿', name: 'Nullbolt Array',   baseCost: 4e16,    zps: 2.1e11,  desc: 'Fires the pure absence of resistance.' },
    { id: 'darkdis',  icon: '🕳️', name: 'Dark Discharger',  baseCost: 6e17,    zps: 1.9e12,  desc: 'Voltage drawn straight from the void.' },
    { id: 'whip',     icon: '🌌', name: 'Wormhole Whip',    baseCost: 9e18,    zps: 1.7e13,  desc: 'Cracks it here, lands it everywhere.' },
    { id: 'meteor',   icon: '☄️', name: 'Meteor Coil',      baseCost: 1.3e20,  zps: 1.5e14,  desc: 'Calls down a charged rock or two.' },
    { id: 'ttaser',   icon: '💫', name: 'Tachyon Taser',    baseCost: 2e21,    zps: 1.4e15,  desc: 'Zaps them slightly before they spawn.' },
    { id: 'sprod',    icon: '⚫', name: 'Singularity Prod',  baseCost: 3e22,    zps: 1.25e16, desc: 'Pokes a small hole in causality.' },
    { id: 'conduit',  icon: '✴️', name: 'Cosmic Conduit',   baseCost: 4.5e23,  zps: 1.1e17,  desc: 'Routes a whole galaxy through one tip.' },
    { id: 'grail',    icon: '🪐', name: 'Galactic Railgun', baseCost: 7e24,    zps: 1e18,    desc: 'Muzzle velocity: yes.' },
    { id: 'seraph',   icon: '😇', name: "Seraph's Spark",   baseCost: 1e26,    zps: 9e18,    desc: 'Smiting, but make it electrical.' },
    { id: 'ostrike',  icon: '🅾️', name: 'Omega Striker',    baseCost: 1.5e27,  zps: 8e19,    desc: 'The last weapon. Probably.' },
    { id: 'axarc',    icon: '📐', name: 'Axiom Arc',        baseCost: 2.5e29,  zps: 7e20,    desc: 'Damage proven from first principles.' },
    { id: 'gjolt',    icon: '🌱', name: 'Genesis Jolt',     baseCost: 4e31,    zps: 6.5e21,  desc: 'The spark the next universe zaps with.' },
    { id: 'edynamo',  icon: '♾️', name: 'Eternal Dynamo',   baseCost: 6e32,    zps: 5.5e22,  desc: 'It was zapping before time began.' },
    { id: 'bigbang',  icon: '💥', name: 'Big Bang Battery', baseCost: 9e33,    zps: 5e23,    desc: 'One AA cell. Do not swallow.' },
    { id: 'voltdoom', icon: '👑', name: 'Voltdoom',         baseCost: 1.4e35,  zps: 4.5e24,  desc: 'The final word in applied electrocution.' },
  ];

  /* kinds: 'zap' multiplies tap-zap power; 'weapon' doubles one weapon
     (unlocks at 5 owned); 'zglobal' multiplies all ZPS; 'crit' = 10% ×10 taps. */
  const ZAP_UPGRADES = [
    { id: 'z_zap1',  icon: '🧤', name: 'Rubber Gloves Off', cost: 100,   kind: 'zap', mult: 2, desc: 'Tap-zap power x2.' },
    { id: 'z_glove', icon: '⚡', name: 'Carpet Static Farm', cost: 500,  kind: 'weapon', weapon: 'glove',  mult: 2, req: { weapon: 'glove', n: 5 },  desc: 'Static Glove zaps x2.' },
    { id: 'z_zap2',  icon: '✌️', name: 'Two-Finger Tesla',  cost: 2500,  kind: 'zap', mult: 2, desc: 'Tap-zap power x2.' },
    { id: 'z_tongs', icon: '🥢', name: 'Insulated Grips',   cost: 5000,  kind: 'weapon', weapon: 'tongs',  mult: 2, req: { weapon: 'tongs', n: 5 },  desc: 'Taser Tongs zaps x2.' },
    { id: 'z_glob1', icon: '🌫️', name: 'Conductive Air',    cost: 25000, kind: 'zglobal', mult: 1.5, desc: 'All weapons +50%.' },
    { id: 'z_weld',  icon: '🔧', name: 'Plasma Cutting Tip',cost: 60000, kind: 'weapon', weapon: 'welder', mult: 2, req: { weapon: 'welder', n: 5 }, desc: 'Arc Welder zaps x2.' },
    { id: 'z_crit',  icon: '💥', name: 'Overcharge',        cost: 150000,kind: 'crit', desc: '10% chance a tap-zap deals x10.' },
    { id: 'z_coil',  icon: '🗼', name: 'Resonant Windings', cost: 6e5,   kind: 'weapon', weapon: 'coil',   mult: 2, req: { weapon: 'coil', n: 5 },   desc: 'Tesla Coil zaps x2.' },
    { id: 'z_glob2', icon: '🌀', name: 'Ion Storm',         cost: 3e6,   kind: 'zglobal', mult: 2, desc: 'All weapons x2.' },
    { id: 'z_ladder',icon: '🪜', name: 'Extension Rungs',   cost: 8e6,   kind: 'weapon', weapon: 'ladder', mult: 2, req: { weapon: 'ladder', n: 5 }, desc: "Jacob's Ladder zaps x2." },
    { id: 'z_zap3',  icon: '🔨', name: 'Mjolnir Grip',      cost: 5e7,   kind: 'zap', mult: 5, desc: 'Tap-zap power x5.' },
    // ---- Zap-scaling upgrades (Voltlands mirror of the Grid's tapwps line): each
    // tap-zap also deals a % of your Z/s, so tapping keeps pace with your DPS. ----
    { id: 'zz1', icon: '🔁', name: 'Feedback Loop',      cost: 5e4,  kind: 'zapzps', frac: 0.015, req: { weapon: 'ladder',  n: 1 }, desc: 'Each zap also deals 1.5% of your Z/s.' },
    { id: 'zz2', icon: '🔋', name: 'Capacitive Strike',  cost: 5e7,  kind: 'zapzps', frac: 0.02,  req: { weapon: 'railgun', n: 1 }, desc: 'Each zap deals +2% of your Z/s.' },
    { id: 'zz3', icon: '📡', name: 'Resonant Discharge', cost: 5e11, kind: 'zapzps', frac: 0.015, req: { weapon: 'lance',   n: 1 }, desc: 'Each zap deals +1.5% of your Z/s.' },
    { id: 'z_glob3', icon: '🧲', name: 'Superconductors',   cost: 1e8,   kind: 'zglobal', mult: 3, desc: 'All weapons x3.' },
    // ---- Voltlands expansion: weapon doublers (one per weapon) + more globals/taps ----
    { id: 'z_cannon',  icon: '🧨', name: 'Recoil Damper',        cost: 5.6e7, kind: 'weapon', weapon: 'cannon',  mult: 2, req: { weapon: 'cannon',  n: 5 }, desc: 'Capacitor Cannon zaps ×2.' },
    { id: 'z_railgun', icon: '🎯', name: 'Rifled Rails',         cost: 8e8,   kind: 'weapon', weapon: 'railgun', mult: 2, req: { weapon: 'railgun', n: 5 }, desc: 'Volt Railgun zaps ×2.' },
    { id: 'z_storm',   icon: '🌩️', name: 'Premium Subscription', cost: 1.3e10,kind: 'weapon', weapon: 'storm',   mult: 2, req: { weapon: 'storm',   n: 5 }, desc: 'Storm Caller zaps ×2.' },
    { id: 'z_ball',    icon: '🔮', name: 'Contained Chaos',      cost: 2e11,  kind: 'weapon', weapon: 'ball',    mult: 2, req: { weapon: 'ball',    n: 5 }, desc: 'Ball Lightning zaps ×2.' },
    { id: 'z_zeus',    icon: '🏛️', name: 'Divine Right',         cost: 3e12,  kind: 'weapon', weapon: 'zeus',    mult: 2, req: { weapon: 'zeus',    n: 5 }, desc: 'Zeus Rig zaps ×2.' },
    { id: 'z_lance',   icon: '⚔️', name: 'Honed Tip',            cost: 4e13,  kind: 'weapon', weapon: 'lance',    mult: 2, req: { weapon: 'lance',    n: 5 }, desc: 'Plasma Lance zaps ×2.' },
    { id: 'z_mortar',  icon: '💣', name: 'Bigger Payload',       cost: 5.6e14,kind: 'weapon', weapon: 'mortar',   mult: 2, req: { weapon: 'mortar',   n: 5 }, desc: 'Ion Mortar zaps ×2.' },
    { id: 'z_spire',   icon: '🏯', name: 'Taller Spire',         cost: 8e15,  kind: 'weapon', weapon: 'spire',    mult: 2, req: { weapon: 'spire',    n: 5 }, desc: 'Tesla Spire zaps ×2.' },
    { id: 'z_striker', icon: '🛰️', name: 'Lower Orbit',          cost: 1.2e17,kind: 'weapon', weapon: 'striker',  mult: 2, req: { weapon: 'striker',  n: 5 }, desc: 'Orbital Striker zaps ×2.' },
    { id: 'z_nullbolt',icon: '🧿', name: 'Deeper Null',          cost: 1.6e18,kind: 'weapon', weapon: 'nullbolt', mult: 2, req: { weapon: 'nullbolt', n: 5 }, desc: 'Nullbolt Array zaps ×2.' },
    { id: 'z_darkdis', icon: '🕳️', name: 'Voidtap',              cost: 2.4e19,kind: 'weapon', weapon: 'darkdis',  mult: 2, req: { weapon: 'darkdis',  n: 5 }, desc: 'Dark Discharger zaps ×2.' },
    { id: 'z_whip',    icon: '🌌', name: 'Tighter Crack',        cost: 3.6e20,kind: 'weapon', weapon: 'whip',     mult: 2, req: { weapon: 'whip',     n: 5 }, desc: 'Wormhole Whip zaps ×2.' },
    { id: 'z_meteor',  icon: '☄️', name: 'Denser Rock',          cost: 5.2e21,kind: 'weapon', weapon: 'meteor',   mult: 2, req: { weapon: 'meteor',   n: 5 }, desc: 'Meteor Coil zaps ×2.' },
    { id: 'z_ttaser',  icon: '💫', name: 'Earlier Zap',          cost: 8e22,  kind: 'weapon', weapon: 'ttaser',   mult: 2, req: { weapon: 'ttaser',   n: 5 }, desc: 'Tachyon Taser zaps ×2.' },
    { id: 'z_sprod',   icon: '⚫', name: 'Sharper Poke',         cost: 1.2e24,kind: 'weapon', weapon: 'sprod',    mult: 2, req: { weapon: 'sprod',    n: 5 }, desc: 'Singularity Prod zaps ×2.' },
    { id: 'z_conduit', icon: '✴️', name: 'Wider Routing',        cost: 1.8e25,kind: 'weapon', weapon: 'conduit',  mult: 2, req: { weapon: 'conduit',  n: 5 }, desc: 'Cosmic Conduit zaps ×2.' },
    { id: 'z_grail',   icon: '🪐', name: 'More Velocity',        cost: 2.8e26,kind: 'weapon', weapon: 'grail',    mult: 2, req: { weapon: 'grail',    n: 5 }, desc: 'Galactic Railgun zaps ×2.' },
    { id: 'z_seraph',  icon: '😇', name: 'Holier Spark',         cost: 4e27,  kind: 'weapon', weapon: 'seraph',   mult: 2, req: { weapon: 'seraph',   n: 5 }, desc: "Seraph's Spark zaps ×2." },
    { id: 'z_ostrike', icon: '🅾️', name: 'Final Polish',         cost: 6e28,  kind: 'weapon', weapon: 'ostrike',  mult: 2, req: { weapon: 'ostrike',  n: 5 }, desc: 'Omega Striker zaps ×2.' },
    { id: 'z_axarc',   icon: '📐', name: 'Tighter Proof',        cost: 1e31,  kind: 'weapon', weapon: 'axarc',    mult: 2, req: { weapon: 'axarc',    n: 5 }, desc: 'Axiom Arc zaps ×2.' },
    { id: 'z_gjolt',   icon: '🌱', name: 'Brighter Spark',       cost: 1.6e33,kind: 'weapon', weapon: 'gjolt',    mult: 2, req: { weapon: 'gjolt',    n: 5 }, desc: 'Genesis Jolt zaps ×2.' },
    { id: 'z_edynamo', icon: '♾️', name: 'Faster Spin',          cost: 2.4e34,kind: 'weapon', weapon: 'edynamo',  mult: 2, req: { weapon: 'edynamo',  n: 5 }, desc: 'Eternal Dynamo zaps ×2.' },
    { id: 'z_bigbang', icon: '💥', name: 'Fresh Cell',           cost: 3.6e35,kind: 'weapon', weapon: 'bigbang',  mult: 2, req: { weapon: 'bigbang',  n: 5 }, desc: 'Big Bang Battery zaps ×2.' },
    { id: 'z_voltdoom',icon: '👑', name: 'Last Word',            cost: 5.6e36,kind: 'weapon', weapon: 'voltdoom', mult: 2, req: { weapon: 'voltdoom', n: 5 }, desc: 'Voltdoom zaps ×2.' },
    { id: 'z_glob4',  icon: '🌫️', name: 'Plasma Field',       cost: 5e9,  kind: 'zglobal', mult: 3,  desc: 'All weapons ×3.' },
    { id: 'z_glob5',  icon: '🧲', name: 'Magnetic Lattice',   cost: 1e12, kind: 'zglobal', mult: 3,  desc: 'All weapons ×3.' },
    { id: 'z_glob6',  icon: '🌀', name: 'Graviton Mesh',      cost: 5e14, kind: 'zglobal', mult: 5,  desc: 'All weapons ×5.' },
    { id: 'z_glob7',  icon: '♾️', name: 'Quantum Entangler',  cost: 1e18, kind: 'zglobal', mult: 5,  desc: 'All weapons ×5.' },
    { id: 'z_glob8',  icon: '✴️', name: 'Cosmic Resonator',   cost: 1e22, kind: 'zglobal', mult: 5,  desc: 'All weapons ×5.' },
    { id: 'z_glob9',  icon: '🅾️', name: 'Omega Field',        cost: 1e27, kind: 'zglobal', mult: 5,  desc: 'All weapons ×5.' },
    { id: 'z_glob10', icon: '📐', name: 'Axiomatic Boost',    cost: 1e32, kind: 'zglobal', mult: 5,  desc: 'All weapons ×5.' },
    { id: 'z_glob11', icon: '👑', name: 'Voltlords',          cost: 1e36, kind: 'zglobal', mult: 10, desc: 'All weapons ×10.' },
    { id: 'z_zap4',  icon: '🔨', name: 'Thunder Fist',  cost: 1e9,  kind: 'zap', mult: 5,  desc: 'Tap-zap power ×5.' },
    { id: 'z_zap5',  icon: '⚡', name: 'Storm Knuckle', cost: 1e13, kind: 'zap', mult: 5,  desc: 'Tap-zap power ×5.' },
    { id: 'z_zap6',  icon: '🌟', name: 'Godhand',       cost: 1e18, kind: 'zap', mult: 10, desc: 'Tap-zap power ×10.' },
    { id: 'z_zap7',  icon: '💥', name: 'Voltfist',      cost: 1e24, kind: 'zap', mult: 10, desc: 'Tap-zap power ×10.' },
    { id: 'z_zap8',  icon: '☄️', name: 'Meteor Punch',  cost: 1e29, kind: 'zap', mult: 10, desc: 'Tap-zap power ×10.' },
    { id: 'z_zap9',  icon: '🌌', name: 'Reality Slap',  cost: 1e33, kind: 'zap', mult: 15, desc: 'Tap-zap power ×15.' },
    { id: 'z_zap10', icon: '♾️', name: 'Eternal Jab',   cost: 1e36, kind: 'zap', mult: 15, desc: 'Tap-zap power ×15.' },
    { id: 'z_zap11', icon: '👑', name: 'Doomstrike',    cost: 1e38, kind: 'zap', mult: 20, desc: 'Tap-zap power ×20.' },
  ];

  const ENEMIES = [
    { icon: '🦠', name: 'Static Mite' },
    { icon: '🐀', name: 'Copper Rat' },
    { icon: '🦇', name: 'Volt Bat' },
    { icon: '🕷️', name: 'Shock Spider' },
    { icon: '🤖', name: 'Resistor Drone' },
    { icon: '🦂', name: 'Surge Scorpion' },
    { icon: '🧌', name: 'Ohm Golem' },
    { icon: '👾', name: 'Glitch Wraith' },
    { icon: '🦞', name: 'Cable Crab' },
    { icon: '🐍', name: 'Inductor Serpent' },
    { icon: '🦗', name: 'Capacitor Cricket' },
    { icon: '🪲', name: 'Diode Beetle' },
    { icon: '🦟', name: 'Amp Gnat' },
    { icon: '🐙', name: 'Octocoil' },
    { icon: '🦅', name: 'Arc Raptor' },
    { icon: '👻', name: 'Leyden Ghost' },
  ];
  const BOSSES = [
    { icon: '🐉', name: 'Fuse Dragon' },
    { icon: '⛰️', name: 'Breaker Behemoth' },
    { icon: '🦑', name: 'Grounding Kraken' },
    { icon: '👹', name: 'Overload Oni' },
    { icon: '🌪️', name: 'Storm Tyrant' },
    { icon: '🐲', name: 'Arc Wyrm' },
    { icon: '🗿', name: 'Capacitor Colossus' },
    { icon: '👽', name: 'The Singularity' },
  ];
  const ZONES = ['Static Fields', 'Copper Canyons', 'Insulator Wastes', 'Capacitor Crypts',
    'Magnet Mires', 'Dynamo Dunes', 'The Short Circuit', 'Transformer Tombs',
    'Gigavolt Glacier', 'The Eye of the Storm', 'Plasma Reaches', 'The Null Expanse',
    'Singularity Shore', 'The Last Volt'];

  // Cord output milestones: every CORD_MILESTONE owned grants ×2, except every
  // BIG_MILESTONE owned grants ×BIG_MILESTONE_MULT instead — near-term goals
  // that bump the player past cost walls.
  const CORD_MILESTONE = 25;
  const BIG_MILESTONE = 100;
  const BIG_MILESTONE_MULT = 10;

  /* ---------- Content: achievements ----------
     `cond` decides when one unlocks; optional `prog` returns [current, target]. */
  const ACHIEVEMENTS = [
    { id: 'plug1',    icon: '🔌', name: 'First Contact',   desc: 'Plug in your first cord by hand.',        cond: () => state.clicks >= 1 },
    { id: 'plug100',  icon: '👆', name: 'Button Masher',   desc: 'Hand-plug 100 cords.',                    cond: () => state.clicks >= 100,   prog: () => [state.clicks, 100] },
    { id: 'plug1000', icon: '✋', name: 'Thumb of Steel',  desc: 'Hand-plug 1,000 cords.',                  cond: () => state.clicks >= 1000,  prog: () => [state.clicks, 1000] },
    { id: 'auto1',    icon: '🤖', name: 'Going Automatic', desc: 'Own your first auto-plugging cord.',      cond: () => totalGenerators() >= 1 },
    { id: 'own25',    icon: '📦', name: 'Bulk Buyer',      desc: 'Own 25 of a single cord (a ×2 milestone!).', cond: () => CORDS.some(c => (state.owned[c.id] || 0) >= 25) },
    { id: 'own50',    icon: '🏗️', name: 'Mass Production',  desc: 'Own 50 of a single cord.',                cond: () => CORDS.some(c => (state.owned[c.id] || 0) >= 50) },
    { id: 'own100',   icon: '🏰', name: 'Cord Baron',     desc: 'Own 100 of a single cord (a ×10 milestone!).', cond: () => CORDS.some(c => (state.owned[c.id] || 0) >= 100) },
    { id: 'w1k',      icon: '💡', name: 'Kilowatt Club',   desc: 'Earn 1,000 total watts.',                 cond: () => state.totalEarned >= 1e3,  prog: () => [state.totalEarned, 1e3] },
    { id: 'w1m',      icon: '⚡', name: 'Megawatt Mogul',  desc: 'Earn 1 million total watts.',             cond: () => state.totalEarned >= 1e6,  prog: () => [state.totalEarned, 1e6] },
    { id: 'w1b',      icon: '🔆', name: 'Gigawatt Giant',  desc: 'Earn 1 billion total watts.',             cond: () => state.totalEarned >= 1e9,  prog: () => [state.totalEarned, 1e9] },
    { id: 'w1t',      icon: '🌟', name: 'Terawatt Tycoon', desc: 'Earn 1 trillion total watts.',            cond: () => state.totalEarned >= 1e12, prog: () => [state.totalEarned, 1e12] },
    { id: 'wps1k',    icon: '🚗', name: 'Auto Pilot',      desc: 'Reach 1,000 watts/sec.',                  cond: () => totalWps() >= 1e3,  prog: () => [totalWps(), 1e3] },
    { id: 'wps1m',    icon: '🏭', name: 'Power Plant',     desc: 'Reach 1 million watts/sec.',              cond: () => totalWps() >= 1e6,  prog: () => [totalWps(), 1e6] },
    { id: 'wps1b',    icon: '☢️', name: 'Reactor Online',  desc: 'Reach 1 billion watts/sec.',              cond: () => totalWps() >= 1e9,  prog: () => [totalWps(), 1e9] },
    { id: 'up1',      icon: '🧰', name: 'Tinkerer',        desc: 'Buy your first upgrade.',                 cond: () => Object.keys(state.upgrades).length >= 1 },
    { id: 'up5',      icon: '🔧', name: 'Engineer',        desc: 'Buy 5 upgrades.',                         cond: () => Object.keys(state.upgrades).length >= 5, prog: () => [Object.keys(state.upgrades).length, 5] },
    { id: 'allcord',  icon: '🧳', name: 'Full Toolkit',    desc: 'Own at least one of every cord type.',    cond: () => CORDS.every(c => (state.owned[c.id] || 0) >= 1), prog: () => [CORDS.filter(c => (state.owned[c.id] || 0) >= 1).length, CORDS.length] },
    { id: 'surge1',   icon: '✨', name: 'Spark Catcher',   desc: 'Catch your first power surge.',           cond: () => (state.surgesCollected || 0) >= 1 },
    { id: 'surge25',  icon: '🌩️', name: 'Storm Chaser',    desc: 'Catch 25 power surges.',                  cond: () => (state.surgesCollected || 0) >= 25, prog: () => [state.surgesCollected || 0, 25] },
    { id: 'prest1',   icon: '♻️', name: 'Recycler',        desc: 'Recycle for your first prestige core.',   cond: () => (state.coresEarned || 0) >= 1 },
    { id: 'prest10',  icon: '💠', name: 'Core Collector',  desc: 'Earn 10 prestige cores.',                 cond: () => (state.coresEarned || 0) >= 10, prog: () => [state.coresEarned || 0, 10] },
    { id: 'quantum',  icon: '⚛️', name: 'Quantum Leap',    desc: 'Own a Quantum Link.',                     cond: () => (state.owned.quantum || 0) >= 1 },
    { id: 'w1qa',     icon: '💎', name: 'Quadrillionaire', desc: 'Earn 1 quadrillion total watts.',         cond: () => state.totalEarned >= 1e15, prog: () => [state.totalEarned, 1e15] },
    { id: 'w1qi',     icon: '👑', name: 'Quintillion Lord',desc: 'Earn 1 quintillion total watts.',         cond: () => state.totalEarned >= 1e18, prog: () => [state.totalEarned, 1e18] },
    { id: 'w1sx',     icon: '🌠', name: 'Sextillion Sage', desc: 'Earn 1 sextillion total watts.',          cond: () => state.totalEarned >= 1e21, prog: () => [state.totalEarned, 1e21] },
    { id: 'wps1t',    icon: '🌋', name: 'Megastructure',   desc: 'Reach 1 trillion watts/sec.',             cond: () => totalWps() >= 1e12, prog: () => [totalWps(), 1e12] },
    { id: 'wps1qa',   icon: '💥', name: 'Dyson Sphere',    desc: 'Reach 1 quadrillion watts/sec.',          cond: () => totalWps() >= 1e15, prog: () => [totalWps(), 1e15] },
    { id: 'plug10k',  icon: '🤜', name: 'Carpal Tunnel',   desc: 'Hand-plug 10,000 cords.',                 cond: () => state.clicks >= 10000, prog: () => [state.clicks, 10000] },
    { id: 'own250',   icon: '🏙️', name: 'Cord Hoarder',    desc: 'Own 250 of a single cord.',               cond: () => CORDS.some(c => (state.owned[c.id] || 0) >= 250) },
    { id: 'own500',   icon: '🌇', name: 'Cord Singularity', desc: 'Own 500 of a single cord.',              cond: () => CORDS.some(c => (state.owned[c.id] || 0) >= 500) },
    { id: 'gens1k',   icon: '🧰', name: 'Thousand Plugs',  desc: 'Own 1,000 generators in total.',          cond: () => totalGenerators() >= 1000, prog: () => [totalGenerators(), 1000] },
    { id: 'void',     icon: '🕳️', name: 'Into the Void',   desc: 'Own a Dark Fiber.',                       cond: () => (state.owned.darkfib || 0) >= 1 },
    { id: 'sing',     icon: '⚫', name: 'Point of No Return',desc: 'Own a Singularity Bus.',                 cond: () => (state.owned.singular || 0) >= 1 },
    { id: 'multi',    icon: '🪐', name: 'Across Realities', desc: 'Own a Multiversal Hub.',                  cond: () => (state.owned.multivrs || 0) >= 1 },
    { id: 'omega1',   icon: '🅾️', name: 'The Final Plug',  desc: 'Own an Omega Cord.',                      cond: () => (state.owned.omega || 0) >= 1 },
    { id: 'allcord24',icon: '🧰', name: 'Master Electrician',desc: `Own one of all ${CORDS.length} cord types.`, cond: () => CORDS.every(c => (state.owned[c.id] || 0) >= 1), prog: () => [CORDS.filter(c => (state.owned[c.id] || 0) >= 1).length, CORDS.length] },
    { id: 'surge100', icon: '🌪️', name: 'Tempest',         desc: 'Catch 100 power surges.',                 cond: () => (state.surgesCollected || 0) >= 100, prog: () => [state.surgesCollected || 0, 100] },
    { id: 'syn1ach',  icon: '🔗', name: 'Synergist',       desc: 'Buy a synergy upgrade.',                  cond: () => UPGRADES.some(u => u.kind === 'synergy' && state.upgrades[u.id]) },
    { id: 'up15',     icon: '🔩', name: 'Master Tinkerer',  desc: 'Buy 15 upgrades.',                       cond: () => Object.keys(state.upgrades).length >= 15, prog: () => [Object.keys(state.upgrades).length, 15] },
    { id: 'upAll',    icon: '🛠️', name: 'Fully Upgraded',  desc: 'Buy every upgrade.',                      cond: () => Object.keys(state.upgrades).length >= UPGRADES.length, prog: () => [Object.keys(state.upgrades).length, UPGRADES.length] },
    { id: 'prest50',  icon: '🔷', name: 'Core Magnate',    desc: 'Earn 50 prestige cores.',                 cond: () => (state.coresEarned || 0) >= 50, prog: () => [state.coresEarned || 0, 50] },
    { id: 'prest100', icon: '🟣', name: 'Core Overlord',   desc: 'Earn 100 prestige cores.',                cond: () => (state.coresEarned || 0) >= 100, prog: () => [state.coresEarned || 0, 100] },
    { id: 'core1',    icon: '◆', name: 'Spend to Ascend',  desc: 'Buy your first core upgrade.',            cond: () => Object.keys(state.coreUpgrades || {}).length >= 1 },
    { id: 'coreAll',  icon: '💟', name: 'Core Completionist',desc: 'Buy every core upgrade.',                cond: () => Object.keys(state.coreUpgrades || {}).length >= CORE_UPGRADES.length, prog: () => [Object.keys(state.coreUpgrades || {}).length, CORE_UPGRADES.length] },
    { id: 'axiom1',   icon: '📐', name: 'Beyond the End',  desc: 'Own an Axiom Wire. ("Nothing connects beyond," they said.)', cond: () => (state.owned.axiom || 0) >= 1 },
    { id: 'genesis1', icon: '🌱', name: 'New Game Seed',   desc: 'Own a Genesis Patch.',                    cond: () => (state.owned.genesis || 0) >= 1 },
    { id: 'w1sp',     icon: '🌌', name: 'Septillion Spark',desc: 'Earn 1 septillion total watts.',          cond: () => state.totalEarned >= 1e24, prog: () => [state.totalEarned, 1e24] },
    { id: 'chal1',    icon: '🧪', name: 'Lab Rat',         desc: 'Complete a challenge.',                   cond: () => Object.keys(state.challengesDone || {}).length >= 1 },
    { id: 'chalAll',  icon: '🏅', name: 'Grid Scientist',  desc: 'Complete every Grid challenge.',           cond: () => CHALLENGES.filter((c) => c.world === 'grid' && (state.challengesDone || {})[c.id]).length >= CHALLENGES.filter((c) => c.world === 'grid').length, prog: () => [CHALLENGES.filter((c) => c.world === 'grid' && (state.challengesDone || {})[c.id]).length, CHALLENGES.filter((c) => c.world === 'grid').length] },
    { id: 'streak7',  icon: '🔥', name: 'Week of Power',   desc: 'Reach a 7-day check-in streak.',          cond: () => (state.streak || 0) >= 7, prog: () => [state.streak || 0, 7] },
    // Voltlands
    { id: 'worm1',    icon: '🌀', name: 'What Does It Do?',desc: 'Plug in the thing you were told not to.', cond: () => !!state.wormhole },
    { id: 'kill1',    icon: '⚡', name: 'First Contact II', desc: 'Electrocute your first enemy.',           cond: () => (state.slayer?.kills || 0) >= 1 },
    { id: 'boss1',    icon: '👑', name: 'Breaker of Breakers', desc: 'Defeat your first boss.',             cond: () => (state.slayer?.bosses || 0) >= 1 },
    { id: 'wave25',   icon: '🗺️', name: 'Deep in the Voltlands', desc: 'Reach wave 25.',                    cond: () => (state.slayer?.wave || 0) >= 25, prog: () => [state.slayer?.wave || 0, 25] },
    { id: 'wave50',   icon: '🌪️', name: 'Storm Front',     desc: 'Reach wave 50.',                          cond: () => (state.slayer?.wave || 0) >= 50, prog: () => [state.slayer?.wave || 0, 50] },
    { id: 'weap5',    icon: '🔫', name: 'Armed to the Teeth', desc: 'Own 5 different weapons.',             cond: () => WEAPONS.filter(w => (state.slayer?.weapons[w.id] || 0) >= 1).length >= 5, prog: () => [WEAPONS.filter(w => (state.slayer?.weapons[w.id] || 0) >= 1).length, 5] },
    { id: 'weapAll',  icon: '🏛️', name: 'Full Arsenal',    desc: `Own all ${WEAPONS.length} weapons.`,      cond: () => WEAPONS.every(w => (state.slayer?.weapons[w.id] || 0) >= 1), prog: () => [WEAPONS.filter(w => (state.slayer?.weapons[w.id] || 0) >= 1).length, WEAPONS.length] },
    { id: 'volt1m',   icon: '🔋', name: 'Million Volt Smile', desc: 'Earn 1 million total volts.',          cond: () => (state.slayer?.totalVolts || 0) >= 1e6, prog: () => [state.slayer?.totalVolts || 0, 1e6] },
    { id: 'reinc1',   icon: '💠', name: 'Storm Reborn',      desc: 'Reincarnate for your first Storm Shard.', cond: () => (state.slayer?.shardsEarned || 0) >= 1 },
    { id: 'shard10',  icon: '🌩️', name: 'Shard Collector',   desc: 'Earn 10 Storm Shards.',                   cond: () => (state.slayer?.shardsEarned || 0) >= 10, prog: () => [state.slayer?.shardsEarned || 0, 10] },
    { id: 'voltchal', icon: '🧪', name: 'Storm Scientist',   desc: 'Complete every Voltlands challenge.',      cond: () => CHALLENGES.filter((c) => c.world === 'volt' && (state.challengesDone || {})[c.id]).length >= CHALLENGES.filter((c) => c.world === 'volt').length, prog: () => [CHALLENGES.filter((c) => c.world === 'volt' && (state.challengesDone || {})[c.id]).length, CHALLENGES.filter((c) => c.world === 'volt').length] },
    { id: 'surgenode1', icon: '🧬', name: 'Researcher',    desc: 'Buy your first Surge Grid node.',       cond: () => Object.keys((state.slayer && state.slayer.surgeNodes) || {}).length >= 1 },
    { id: 'surgepath',  icon: '🔱', name: 'Pathfinder',    desc: 'Commit to a Surge Grid path.',          cond: () => !!(state.slayer && state.slayer.surgeBranch) },
    { id: 'surge1kch',  icon: '⚡', name: 'Overcharged',   desc: 'Mint 1,000 lifetime Surge Charges.',    cond: () => (state.slayer?.surgeChargesEarned || 0) >= 1000, prog: () => [state.slayer?.surgeChargesEarned || 0, 1000] },
    { id: 'wave100',    icon: '⛈️', name: 'Stormbreaker',  desc: 'Reach wave 100.',                       cond: () => (state.slayer?.wave || 0) >= 100, prog: () => [state.slayer?.wave || 0, 100] },
    { id: 'wave250',    icon: '🌌', name: 'Voltlord',      desc: 'Reach wave 250.',                       cond: () => (state.slayer?.wave || 0) >= 250, prog: () => [state.slayer?.wave || 0, 250] },
    { id: 'boss10',     icon: '💀', name: 'Boss Slayer',   desc: 'Defeat 10 bosses.',                     cond: () => (state.slayer?.bosses || 0) >= 10, prog: () => [state.slayer?.bosses || 0, 10] },
    { id: 'boss50',     icon: '☠️', name: 'Apex Predator', desc: 'Defeat 50 bosses.',                     cond: () => (state.slayer?.bosses || 0) >= 50, prog: () => [state.slayer?.bosses || 0, 50] },
    { id: 'shard100',   icon: '💠', name: 'Storm Master',  desc: 'Earn 100 lifetime Storm Shards.',       cond: () => (state.slayer?.shardsEarned || 0) >= 100, prog: () => [state.slayer?.shardsEarned || 0, 100] },
  ];

  /* ---------- State ---------- */
  const defaultState = () => ({
    watts: 0,
    totalEarned: 0,
    clicks: 0,
    cores: 0,            // prestige currency — SPENDABLE on core upgrades
    coresEarned: 0,      // lifetime cores ever earned — drives the permanent bonus
    owned: {},           // cordId -> count
    upgrades: {},        // upgradeId -> true
    coreUpgrades: {},    // coreUpgradeId -> true (permanent, persists across prestige)
    achievements: {},    // achievementId -> true (persists across prestige)
    surgesCollected: 0,  // lifetime power surges caught
    startedAt: Date.now(),
    lastSeen: Date.now(),
    settings: { sound: true, music: true, floats: true, sci: false, haptics: true, fps: 30, world: { grid: { autobuyOn: true, autoupgOn: true }, volt: { autobuyOn: true, autoupgOn: true, autoclickOn: true } } },
    bulk: 1,             // 1, 5, 10, or 'max'
    prestigeV: 2,        // prestige-curve schema (v2 = cbrt gain + softcap)
    challenges: { grid: '', volt: '' },  // active challenge id per world (cleared by completion/abandon/prestige)
    challengeBackup: { grid: null, volt: null },  // pre-challenge run snapshot per world, restored on finish/abandon
    challengesDone: {},  // challengeId -> true (permanent perks)
    streak: 0,           // daily check-in streak (48h forgiveness window)
    streakAt: 0,         // ms timestamp of the last streak claim
    streakDay: '',       // local date of the last streak claim
    streakUntil: 0,      // streak production buff expiry
    // ---- the Voltlands (unlocked by the ??? core upgrade) ----
    wormhole: false,     // has the player been through?
    world: 'grid',       // 'grid' (plug game) | 'volt' (slayer game)
    lifetimeEarned: 0,   // watts ever earned, NEVER resets (grid->volt synergy)
    slayer: defaultSlayer(),
    // ---- monetization (Android only; harmless extras on web) ----
    iap: {},             // non-consumable sku -> true (granted entitlements)
    theme: '',           // '' (green) | 'amber' | 'ice' | 'vapor'
    adDay: '',           // local date the rewarded-ad counters belong to
    adUses: {},          // placement -> uses today (daily caps)
    boostUntil: 0,       // 2x production boost expiry (persists across restarts)
    supporterDay: '',    // last date the supporter daily boost was claimed
  });

  function defaultSlayer() {
    return {
      volts: 0,          // spendable ⚡ currency
      totalVolts: 0,     // lifetime volts (achievements)
      wave: 1,
      killsThisWave: 0,
      kills: 0,          // lifetime kills
      zaps: 0,           // hand + auto tap-zaps this run — drives zap milestones (RESET on reincarnate)
      bosses: 0,         // lifetime boss kills (volt->grid synergy)
      hp: 0, maxHp: 0,   // current enemy
      weapons: {},       // weaponId -> count
      upgrades: {},      // zapUpgradeId -> true
      runVolts: 0,       // volts earned this reincarnation — drives shard gain
      shards: 0,         // spendable Storm Shards 💠
      shardsEarned: 0,   // lifetime shards — drives the permanent ZPS multiplier
      shardUpgrades: {}, // stormUpgradeId -> true (persists across reincarnation)
      // ---- Surge Grid (branching combat research tree) ----
      surgeCharges: 0,       // spendable Surge Charges, minted by kills; RESET on reincarnate
      surgeChargesEarned: 0, // lifetime Surge Charges ever minted; KEPT across reincarnation
      surgeNodes: {},        // surgeNodeId -> true; RESET on reincarnate (the free respec)
      surgeBranch: '',       // chosen mutually-exclusive branch; RESET on reincarnate
      surgePresets: [null, null, null],   // 3 saved build templates; KEPT across reincarnation & prestige
      dischargeCd: 0,        // Discharge ability cooldown, seconds (run-scoped)
    };
  }

  // Normalize any save (fresh boot, legacy, or imported) into a complete state:
  // backfill missing fields, merge settings, and reconstruct prestige fields
  // (older saves used `cores` as the lifetime-bonus source, with no coresEarned).
  function normalizeState(s) {
    s = s || {};
    // Detect legacy saves (no coresEarned / prestigeV / lifetimeEarned)
    // BEFORE the defaults merge backfills them with zero-values.
    const hadCoresEarned = s.coresEarned != null;
    const hadPrestigeV = s.prestigeV != null;
    const hadLifetime = s.lifetimeEarned != null;
    // Capture legacy per-world fields BEFORE the defaults merge backfills them
    // with the new empty/object shapes.
    const hadChallenges = s.challenges != null;
    const legacyChallenge = typeof s.challenge === 'string' ? s.challenge : '';
    s = Object.assign(defaultState(), s);
    // Device prefs stay top-level/global. Automation toggles are per-world; merge
    // the nested `world` object so partial saves don't drop the volt subtree.
    const savedSettings = s.settings || {};
    s.settings = Object.assign({ sound: true, music: true, floats: true, sci: false, haptics: true, notify: false, fps: 30 }, savedSettings);
    if (![15, 30, 60].includes(s.settings.fps)) s.settings.fps = 30;   // render frame-rate cap
    s.settings.world = {
      grid: Object.assign({ autobuyOn: true, autoupgOn: true }, (savedSettings.world && savedSettings.world.grid) || {}),
      volt: Object.assign({ autobuyOn: true, autoupgOn: true, autoclickOn: true }, (savedSettings.world && savedSettings.world.volt) || {}),
    };
    // Migrate legacy flat autobuyOn/autoupgOn into the grid automation subtree.
    if (savedSettings.autobuyOn != null) s.settings.world.grid.autobuyOn = !!savedSettings.autobuyOn;
    if (savedSettings.autoupgOn != null) s.settings.world.grid.autoupgOn = !!savedSettings.autoupgOn;
    delete s.settings.autobuyOn; delete s.settings.autoupgOn;
    // Per-world challenges: migrate legacy single `state.challenge` into the grid slot.
    if (!hadChallenges) s.challenges = { grid: legacyChallenge, volt: '' };
    if (s.challenges == null) s.challenges = { grid: '', volt: '' };
    if (typeof s.challenges.grid !== 'string') s.challenges.grid = '';
    if (typeof s.challenges.volt !== 'string') s.challenges.volt = '';
    delete s.challenge;
    if (!hadCoresEarned) s.coresEarned = s.cores || 0;
    if (s.coreUpgrades == null) s.coreUpgrades = {};
    if (s.challengeBackup == null || typeof s.challengeBackup !== 'object') s.challengeBackup = { grid: null, volt: null };
    // Bulk buttons are now 1/5/10/max; clamp a legacy 100 (or any junk) to a valid step.
    if (s.bulk !== 'max' && s.bulk !== 1 && s.bulk !== 5 && s.bulk !== 10) s.bulk = 10;
    if (s.iap == null) s.iap = {};
    if (s.adUses == null) s.adUses = {};
    if (s.challengesDone == null) s.challengesDone = {};
    if (!hadLifetime) s.lifetimeEarned = s.totalEarned || 0;   // best available seed
    s.slayer = Object.assign(defaultSlayer(), s.slayer || {});
    if (s.slayer.shardUpgrades == null || typeof s.slayer.shardUpgrades !== 'object') s.slayer.shardUpgrades = {};
    // Surge Grid backfill (defaultSlayer seeds these, but coerce a malformed import).
    if (s.slayer.surgeNodes == null || typeof s.slayer.surgeNodes !== 'object') s.slayer.surgeNodes = {};
    if (typeof s.slayer.surgeCharges !== 'number') s.slayer.surgeCharges = 0;
    if (typeof s.slayer.surgeChargesEarned !== 'number') s.slayer.surgeChargesEarned = 0;
    if (typeof s.slayer.surgeBranch !== 'string') s.slayer.surgeBranch = '';
    if (!Array.isArray(s.slayer.surgePresets)) s.slayer.surgePresets = [null, null, null];
    if (typeof s.slayer.dischargeCd !== 'number') s.slayer.dischargeCd = 0;
    if (typeof s.slayer.zaps !== 'number') s.slayer.zaps = 0;   // zap-milestone counter
    // v2 prestige curve (sqrt -> cbrt): re-baseline coresEarned so "deserved at
    // the same lifetime earnings" is preserved (old n = sqrt(E/1e9) => new
    // potential = cbrt(E/1e9) = n^(2/3)). Spendable cores are left untouched.
    if (!hadPrestigeV) {
      s.coresEarned = Math.round(Math.pow(Math.max(0, s.coresEarned || 0), 2 / 3));
      s.prestigeV = 2;
    }
    return s;
  }

  let state = normalizeState(loadLocal());

  /* ---------- Derived values ---------- */
  const co = (id) => !!(state.coreUpgrades && state.coreUpgrades[id]);
  // Storm-Upgrade-owned helper (mirror of `co` for the Voltlands shard shop).
  const su = (id) => !!(state.slayer && state.slayer.shardUpgrades && state.slayer.shardUpgrades[id]);
  // Surge-node-owned helper (mirror of `su` for the Surge Grid research tree).
  const sg = (id) => !!(state.slayer && state.slayer.surgeNodes && state.slayer.surgeNodes[id]);
  // Per-shard ZPS bonus (lifetime shards), boosted by Resonant Core.
  function shardPer() { return su('resocore') ? 0.08 : 0.05; }
  // Storm Shard gain multiplier (mirror of prestigeGainMult).
  // Generic storm-upgrade effect accumulator for the eff-based expansion upgrades
  // (the original hardcoded overvolt/livewire/conduction/chaser stay as-is).
  function stormEffProduct(key, base) { let m = base; const o = (state.slayer && state.slayer.shardUpgrades) || {}; for (const u of STORM_UPGRADES) if (o[u.id] && u.eff && u.eff[key] != null) m *= u.eff[key]; return m; }
  function stormZpsMult() { return stormEffProduct('zps', 1); }
  function stormTapMult() { return stormEffProduct('tap', 1); }
  function shardGainMult() { let m = 1; if (su('chaser')) m *= 1.5; if (su('stormfission')) m *= 5; return m * stormEffProduct('shardGain', 1); }
  // Per-core production bonus (lifetime cores), boosted by Core Resonance.
  function corePer() { return co('resonance') ? 0.08 : 0.05; }
  function coreClickMult() { return co('thumbs') ? 2 : 1; }
  // Tap-power multipliers ("Tap power ×N"): the 'click' upgrades plus Overclocked
  // Thumbs. They must multiply the WHOLE tap value (the flat part AND the %-of-W/s
  // share), so "×3" really triples your watts/tap.
  function clickMult() { let p = 1; for (const u of UPGRADES) if (state.upgrades[u.id] && u.kind === 'click') p *= u.mult; return p * coreClickMult(); }
  function coreProdMult() { let m = 1; if (co('phantom')) m *= 1.5; if (co('overdrive')) m *= 2; return m; }
  function offlineCapMs() { return (24 + (co('battery') ? 24 : 0)) * 3600000; }
  function offlineEff() { return co('nightshift') ? 0.5 : 0.1; }

  /* ---------- Offline-cap reminder notification (opt-in, native only) ---------- */
  // One local notification fired when offline earnings reach the cap — scheduled
  // when the app is backgrounded, cancelled when it returns. Web: no plugin, no-op.
  const LocalNotifications = window.Capacitor?.isNativePlatform?.()
    ? (window.Capacitor?.Plugins?.LocalNotifications || null) : null;
  const OFFLINE_NOTIF_ID = 1;

  async function cancelOfflineNotif() {
    if (!LocalNotifications) return;
    try { await LocalNotifications.cancel({ notifications: [{ id: OFFLINE_NOTIF_ID }] }); } catch (e) {}
  }
  async function scheduleOfflineNotif() {
    if (!LocalNotifications || !state.settings.notify) return;
    const fireAt = (state.lastSeen || Date.now()) + offlineCapMs();
    if (fireAt <= Date.now() + 60000) return;   // already at/near the cap — nothing to remind about
    try {
      await cancelOfflineNotif();
      await LocalNotifications.schedule({ notifications: [{
        id: OFFLINE_NOTIF_ID,
        title: 'PlugIdle',
        body: '⚡ Your rig is at the offline cap — come collect your watts!',
        schedule: { at: new Date(fireAt) },
      }] });
    } catch (e) { /* notifications unavailable */ }
  }
  // Settings toggle: request OS permission when enabling (never silently "on"
  // without it); cancel any pending reminder when disabling.
  async function toggleNotify() {
    if (state.settings.notify) {
      state.settings.notify = false;
      cancelOfflineNotif();
    } else {
      let granted = false;
      if (LocalNotifications) {
        try {
          let p = await LocalNotifications.checkPermissions();
          if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
          granted = p.display === 'granted';
        } catch (e) { granted = false; }
      }
      state.settings.notify = granted;
      if (!granted) toast('🔔 Allow notifications in system settings to enable this');
    }
    syncSettingsUI();
    save();
  }
  function surgeDelayMult() { return co('magnet') ? 0.6 : 1; }
  function surgeRewardMult() { return co('megasurge') ? 2 : 1; }
  function prestigeGainMult() {
    let m = co('recycler') ? 1.5 : 1;
    if (co('fission')) m *= 5;
    if (co('cascade')) m *= 25;
    if (co('singular2')) m *= 100;
    if (chDone('brownout')) m *= 2;   // BROWNOUT challenge perk: 2× prestige core production
    return m;
  }
  function autoTapRate() {
    if (co('autotap1000')) return 150;
    if (co('autotap100')) return 100;
    if (co('autotap50')) return 50;
    if (co('autotap20')) return 20;
    if (co('autotap10')) return 10;
    if (co('autotap')) return 5;
    return 0;
  }
  // Ouroboros Cord (and any future coreGain cord) multiplies prestige core gain
  // by +coreGain per owned, uncapped — the steep cord cost curve self-limits it.
  function coreCordGainMult() {
    let bonus = 0;
    for (const c of CORDS) if (c.coreGain) bonus += c.coreGain * (state.owned[c.id] || 0);
    return 1 + bonus;
  }
  function prestigeKeepFrac() { return co('jumpstart') ? 0.05 : 0; }
  function lifetimeBonusPct() { return Math.round((prestigeMult() - 1) * 100); }

  // Per-core bonus is linear up to a ×10 total multiplier, then square-root
  // dampened — keeps late-game prestige meaningful without the runaway loop
  // (see research/balance-report.md). UI percentages derive from the EFFECTIVE
  // multiplier via prestigeMultFor, so the display never overstates.
  const PRESTIGE_SOFTCAP = 10;
  function prestigeMultFor(coresN) {
    const raw = 1 + corePer() * coresN;
    if (raw <= PRESTIGE_SOFTCAP) return raw;
    return PRESTIGE_SOFTCAP * Math.sqrt(raw / PRESTIGE_SOFTCAP);
  }
  function prestigeMult() {
    return prestigeMultFor(state.coresEarned || 0);
  }

  // Voltlands prestige (Storm Reactor): lifetime Storm Shards drive a permanent,
  // softcapped ZPS multiplier — the volt analog of prestigeMult. Same softcap
  // shape as the Grid (linear to ×10, then sqrt-dampened).
  // STORM_THRESHOLD gates the first shard: reincarnateGain = cbrt(runVolts/THRESHOLD).
  // Tuned to match the Grid's first prestige core: under symmetric active-play
  // modeling the first core lands at ~1h54m, by which point a Voltlands run has
  // banked ~4.6e7 runVolts (~wave 60). Earlier values arrived far too early vs cores
  // (2e3 -> ~wave 10; 1.3e5 -> ~wave 30, a measured ~5x faster than the first core).
  // 5e7 puts the first shard at the same play-time as the first core (slightly slower).
  const STORM_THRESHOLD = 5e7;
  const STORM_SOFTCAP = 10;
  // Shard-gain diminishing returns: each lifetime shard raises the runVolts needed
  // for the next by 1/SHARD_DR, so the shard -> ZPS -> runVolts -> shard loop can't
  // run away in the late game. Grid cores get this free via their lifetime
  // subtraction; shards never had it, so late-game (super-linear runVolts vs shard
  // mult) compounded exponentially. The factor is ~1 early (early game untouched)
  // and grows with shardsEarned: ~13% fewer shards at 5, ~21% at 10, ~55% at 100.
  const SHARD_DR = 10;
  function shardMultFor(shardsN) {
    const raw = 1 + shardPer() * shardsN;
    if (raw <= STORM_SOFTCAP) return raw;
    return STORM_SOFTCAP * Math.sqrt(raw / STORM_SOFTCAP);
  }
  function shardMult() {
    return shardMultFor((state.slayer && state.slayer.shardsEarned) || 0);
  }

  // An upgrade's multiplier applies to a cord's WHOLE output — every unit you
  // already own and every one you buy later — because output = n × per-unit ×
  // multiplier. Buying an upgrade therefore boosts your existing fleet too.
  function cordMultiplier(cordId) {
    let m = 1;
    for (const u of UPGRADES) {
      if (!state.upgrades[u.id]) continue;
      if (u.kind === 'cord' && u.cord === cordId) m *= u.mult;
      if (u.kind === 'global') m *= u.mult;
      // Synergy: this cord gains +per per unit of another cord owned.
      if (u.kind === 'synergy' && u.cord === cordId) m *= 1 + u.per * (state.owned[u.from] || 0);
    }
    if (cordId === 'usba' && chDone('solo')) m *= 5;   // GOLD PINS challenge perk
    // Ownership milestones: ×2 per CORD_MILESTONE, ×BIG_MILESTONE_MULT per BIG_MILESTONE.
    m *= cordMilestoneMult(state.owned[cordId] || 0);
    return m;
  }

  // Total milestone multiplier for an owned count: ×2 for each CORD_MILESTONE
  // step, but every BIG_MILESTONE step is ×BIG_MILESTONE_MULT instead of ×2.
  function cordMilestoneMult(owned) {
    const steps = Math.floor(owned / CORD_MILESTONE);
    const big = Math.floor(owned / BIG_MILESTONE);
    return Math.pow(2, steps - big) * Math.pow(BIG_MILESTONE_MULT, big);
  }

  // Transient multipliers from power surges (not persisted; expire on their own).
  let buffs = [];
  function buffMult(kind) {
    const now = Date.now();
    let m = 1;
    for (const b of buffs) if (b.kind === kind && b.until > now) m *= b.mult;
    return m;
  }

  function cordWps(cord) {
    const n = state.owned[cord.id] || 0;
    return n * cord.wps * cordMultiplier(cord.id);
  }

  // Single entry point for earning watts: lifetimeEarned never resets and
  // powers the grid->volt synergy; totalEarned is the per-run figure that
  // drives prestige potential and achievements.
  function gainWatts(n) {
    state.watts += n;
    state.totalEarned += n;
    state.lifetimeEarned = (state.lifetimeEarned || 0) + n;
  }

  // Permanent +25% from the boost_production_25 purchase (Android IAP).
  function iapProdMult() { return state.iap && state.iap.boost_production_25 ? 1.25 : 1; }

  // Grid Bonus: each unlocked achievement grants +1% production, permanently
  // (Cookie Clicker's milk pattern — goals become power; persists prestiges).
  function achCount() {
    let n = 0;
    for (const a of ACHIEVEMENTS) if (state.achievements[a.id]) n++;
    return n;
  }
  function achMult() { return 1 + 0.01 * achCount(); }

  // Volt->Grid synergy: every cleared volt-challenge tier permanently boosts Grid
  // watts by +2% (a named cross-world fn, per the world-template parity contract).
  function trialGridBoost() { let t = 0; for (const c of CHALLENGES) if (c.world === 'volt') t += chTier(c.id); return 1 + 0.02 * t; }
  function totalWps() {
    let sum = 0;
    for (const c of CORDS) sum += cordWps(c);
    const challengePenalty = ch('grid') === 'brownout' ? 0.5 : 1;
    return sum * prestigeMult() * PROD_MULT * coreProdMult() * iapProdMult() * achMult() * buffMult('prod') * challengePenalty * bossWattsMult() * trialGridBoost();
  }

  // ---- Tap / zap power: keep hand-tapping relevant for the whole game ----
  // Milestones: every TAP_MILESTONES threshold of hand-taps grants a permanent-
  // for-the-run boost — ×1.5 tap power (Grid) / ×1.25 tap-zap power (Voltlands).
  const TAP_MILESTONES = [100, 500, 2500, 10000, 50000, 250000, 1e6, 5e6];
  const TAP_MILESTONE_MULT = 1.5;    // Grid: ×1.5 per milestone
  const ZAP_MILESTONE_MULT = 1.25;   // Voltlands: leaner ×1.25 per milestone (same thresholds)
  // Shared milestone math over TAP_MILESTONES, parameterized by count + per-step base.
  function milestonesPassed(count) {
    let n = 0;
    for (const t of TAP_MILESTONES) if ((count || 0) >= t) n++;
    return n;
  }
  function milestoneMult(count, base) { return Math.pow(base, milestonesPassed(count)); }
  function nextMilestone(count) {
    for (const t of TAP_MILESTONES) if ((count || 0) < t) return t;
    return null;
  }
  // Each world applies the shared math to its own counter (Grid hand-plugs vs
  // Voltlands tap-zaps); the Voltlands boost is deliberately leaner.
  function tapMilestonesPassed() { return milestonesPassed(state.clicks); }
  function tapMilestoneMult() { return milestoneMult(state.clicks, TAP_MILESTONE_MULT); }
  function nextTapMilestone() { return nextMilestone(state.clicks); }
  function zapMilestonesPassed() { return milestonesPassed(sl().zaps); }
  function zapMilestoneMult() { return milestoneMult(sl().zaps, ZAP_MILESTONE_MULT); }
  function nextZapMilestone() { return nextMilestone(sl().zaps); }
  // Taps also earn a % of your current W/s (so they scale with production forever).
  function tapWpsFrac() {
    let f = 0;
    for (const u of UPGRADES) if (state.upgrades[u.id] && u.kind === 'tapwps') f += u.frac;
    if (co('static')) f += 0.04;
    return f;
  }

  // Flat tap power — everything except the "% of W/s" share. Scales with click
  // & global upgrades, prestige and tap milestones, but NOT directly with W/s.
  // Base is 1 — deliberately excludes the global PROD_MULT that idle income uses,
  // so a fresh tap is worth 1 (not 1.6); the "% of W/s" share carries it later.
  function clickPowerFlat() {
    if (ch('grid') === 'unplugged') return 0;   // UNPLUGGED challenge rule
    let p = 1;
    for (const u of UPGRADES) {
      if (state.upgrades[u.id] && u.kind === 'click') p *= u.mult;
    }
    // hand-plugging also benefits from global upgrades & prestige, lightly
    let glob = 1;
    for (const u of UPGRADES) {
      if (state.upgrades[u.id] && u.kind === 'global') glob *= u.mult;
    }
    return p * glob * prestigeMult() * coreClickMult() * tapMilestoneMult();
  }
  function clickPower() {
    if (ch('grid') === 'unplugged') return 0;   // UNPLUGGED challenge rule
    // Tap-power mults scale the %-of-W/s share too, so "Tap power ×N" multiplies
    // the WHOLE tap value — not just the flat part (which clickPowerFlat covers).
    const fromWps = tapWpsFrac() * totalWps() * clickMult();
    return (clickPowerFlat() + fromWps) * buffMult('click');
  }

  // Watts earned per second by the Auto-Tapper. Each auto-tap is worth exactly a
  // manual tap (clickPower) -- the SAME tap-power multipliers AND %-of-W/s share --
  // so automating tapping is identical to tapping by hand, just at the auto rate.
  function autoTapGainPerSec() {
    const taps = autoTapRate();
    if (taps <= 0) return 0;
    return clickPower() * taps;   // clickPower() already applies the UNPLUGGED rule + buffs
  }

  // OVERPRICED challenge steepens cost growth; its WHOLESALE perk discounts.
  function costGrowth() { return ch('grid') === 'overpriced' ? 1.18 : COST_GROWTH; }
  function costDiscount() { return chDone('overpriced') ? 0.97 : 1; }

  function cordCost(cord, count) {
    // cost of buying `count` more, starting from current owned
    const owned = state.owned[cord.id] || 0;
    const r = costGrowth();
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += cord.baseCost * Math.pow(r, owned + i);
    }
    return Math.ceil(total * costDiscount());
  }

  function maxAffordable(cord) {
    const owned = state.owned[cord.id] || 0;
    const r = costGrowth();
    const base = cord.baseCost * Math.pow(r, owned);
    // geometric series: watts >= base*(r^k - 1)/(r-1)
    const w = state.watts;
    const k = Math.floor(Math.log((w * (r - 1)) / base + 1) / Math.log(r));
    return Math.max(0, isFinite(k) ? k : 0);
  }

  function buyCount(cord) {
    if (state.bulk === 'max') return Math.max(1, maxAffordable(cord));
    return state.bulk;
  }

  function totalGenerators() {
    let n = 0;
    for (const c of CORDS) n += state.owned[c.id] || 0;
    return n;
  }

  function prestigeGain() {
    // Cores "deserved" follows a cube-root curve (×Recycler's Edge bonus); you
    // collect the difference vs. cores already earned this lifetime. Cube root
    // (Cookie Clicker's shape) needs ~8x more lifetime earnings per doubling,
    // keeping late-game cores meaningful instead of cascading.
    const potential = Math.floor(Math.cbrt(state.totalEarned / 1e9) * prestigeGainMult() * coreCordGainMult());
    return Math.max(0, potential - (state.coresEarned || 0));
  }

  // Storm Shards "deserved" this reincarnation: a cube-root curve over the volts
  // earned THIS run (×Storm Chaser/Fission bonus). Unlike grid cores, shards are
  // pure gain per run — there is no lifetime subtraction.
  function reincarnateGain() {
    const dr = 1 + (((state.slayer && state.slayer.shardsEarned) || 0) / SHARD_DR);   // late-game diminishing brake
    return Math.max(0, Math.floor(Math.cbrt(((state.slayer && state.slayer.runVolts) || 0) / (STORM_THRESHOLD * dr)) * shardGainMult() * surgeShardMult()));
  }

  /* ---------- Number formatting ---------- */
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg', 'Uvg'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return (Math.floor(n * 10) / 10).toString().replace(/\.0$/, '');
    if (state.settings.sci) return n.toExponential(2).replace('e+', 'e');
    const tier = Math.floor(Math.log10(n) / 3);
    if (tier >= SUFFIXES.length) return n.toExponential(2).replace('e+', 'e');
    const scaled = n / Math.pow(1000, tier);
    return scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0) + SUFFIXES[tier];
  }
  function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* ---------- Persistence ----------
     Saves are written to two client-side stores for durability:
       • localStorage — synchronous, so it survives `pagehide`/`beforeunload`
       • IndexedDB    — larger quota and far more eviction-resistant; the primary
     On load we reconcile the two by `lastSeen` and keep the freshest. */

  const DB_NAME = 'cordTycoon';
  const DB_STORE = 'saves';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(key) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    })).catch(() => null);
  }
  function idbSet(key, value) {
    return idbOpen().then(db => new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    })).catch(() => false);
  }
  function idbDel(key) {
    return idbOpen().then(db => new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    })).catch(() => false);
  }

  // Ask the browser to exempt our data from automatic eviction.
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!already) await navigator.storage.persist();
      }
    } catch (e) { /* not supported */ }
  }

  function save() {
    state.lastSeen = Date.now();
    const json = JSON.stringify(state);
    try { localStorage.setItem(SAVE_KEY, json); } catch (e) { /* full/blocked */ }
    idbSet(SAVE_KEY, json); // async durable mirror of the synchronous copy above
  }

  // Synchronous, localStorage-only — keeps `state` ready before the async boot.
  function loadLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // Durable load: read both stores and return whichever save is newest.
  async function loadDurable() {
    const ls = loadLocal();
    let idb = null;
    try {
      const raw = await idbGet(SAVE_KEY);
      idb = raw ? JSON.parse(raw) : null;
    } catch (e) { idb = null; }
    if (ls && idb) return (idb.lastSeen || 0) >= (ls.lastSeen || 0) ? idb : ls;
    return idb || ls;
  }

  async function storageInfo() {
    let persisted = false;
    try {
      if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    } catch (e) { /* unsupported */ }
    return { persisted, idb: 'indexedDB' in window };
  }

  /* ---------- DOM refs ---------- */
  const $ = (s) => document.querySelector(s);
  const el = {
    watts: $('#watts'), wps: $('#wps'), tapval: $('#tapval'), coresline: $('#coresline'),
    socket: $('#socket'), socketSvg: $('#socketSvg'), tapinfo: $('#tapinfo'), autotapBadge: $('#autotapBadge'),
    socketMini: $('#socketMini'), tapvalMini: $('#tapvalMini'),
    socketMiniPlug: $('#socketMiniPlug'), tapvalMiniPlug: $('#tapvalMiniPlug'), bulkBar: $('#bulkBar'),
    // Voltlands tap surfaces — mirror the grid ones (compact ZAP bar on the Zap
    // tab when collapsed; mini ZAP bar on the Arsenal tab). See TAP_SURFACES.
    enemyBtnMini: $('#enemyBtnMini'), tapvalEnemyMini: $('#tapvalEnemyMini'),
    zapMini: $('#zapMini'), tapvalZapMini: $('#tapvalZapMini'),
    buffBar: $('#buffBar'), floaters: $('#floaters'), surgeLayer: $('#surgeLayer'),
    dotUp: $('#dotUp'), dotMore: $('#dotMore'), dotArsenal: $('#dotArsenal'), dotSurge: $('#dotSurge'),
    cordlist: $('#cordlist'), uplist: $('#uplist'), goallist: $('#goallist'), goalcount: $('#goalcount'),
    corelist: $('#corelist'), stormlist: $('#stormlist'), surgelist: $('#surgelist'), surgechargecount: $('#surgechargecount'), surgePresets: $('#surgePresets'),
    statTotal: $('#statTotal'), statClicks: $('#statClicks'), statWps: $('#statWps'),
    statGens: $('#statGens'), statSurges: $('#statSurges'), statAch: $('#statAch'),
    statTime: $('#statTime'), statCores: $('#statCores'),
    coregain: $('#coregain'), corecount: $('#corecount'), prestigemult: $('#prestigemult'),
    prestigeBtn: $('#prestigeBtn'),
    shardgain: $('#shardgain'), shardcount: $('#shardcount'), shardmult: $('#shardmult'),
    reincarnateBtn: $('#reincarnateBtn'),
    recycleBlock: $('#recycleBlock'), coreShopBlock: $('#coreShopBlock'), worldswitchBlock: $('#worldswitchBlock'),
    voltPrestigeBlock: $('#voltPrestigeBlock'), voltShopBlock: $('#voltShopBlock'),
    toast: $('#toast'), modal: $('#modal'), mbox: $('#mbox'),
    savebox: $('#savebox'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'), wipeBtn: $('#wipeBtn'),
    storageStatus: $('#storageStatus'), version: $('#version'),
    // Voltlands
    worldBtn: $('#worldBtn'), wattsUnit: $('#wattsUnit'), wpsUnit: $('#wpsUnit'), tapUnit: $('#tapUnit'),
    enemyBtn: $('#enemyBtn'), enemyEmoji: $('#enemyEmoji'), enemyName: $('#enemyName'), enemyReward: $('#enemyReward'), dischargeBtn: $('#dischargeBtn'),
    zoneName: $('#zoneName'), hpFill: $('#hpFill'), hpText: $('#hpText'), zapinfo: $('#zapinfo'),
    weaponlist: $('#weaponlist'), zuplist: $('#zuplist'), bulkBarZap: $('#bulkBarZap'),
  };
  if (el.version) el.version.textContent = `PlugIdle v${VERSION}`;

  /* ---------- Toast (banner slot shared with the buff bar) ---------- */
  // Temporary notifications take over the banner strip under the header:
  // the buff pills (streak, surges, challenge) collapse while one shows and
  // slide back when it expires. One toast at a time — the newest wins — so
  // notifications never stack over the shop or upgrade buttons.
  let toastTimer = null;
  function toast(msg, gold) {
    const t = document.createElement('div');
    t.className = 'toast' + (gold ? ' gold' : '');
    t.textContent = msg;
    el.toast.innerHTML = '';
    el.toast.appendChild(t);
    el.toast.classList.add('show');
    el.buffBar.classList.add('suppressed');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      el.toast.innerHTML = '';
      el.toast.classList.remove('show');
      el.buffBar.classList.remove('suppressed');
    }, 3000);
  }

  /* ---------- Sound (tiny WebAudio blips) ---------- */
  let audioCtx;
  function blip(freq = 440, dur = 0.05, type = 'square', gain = 0.04) {
    if (!state.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.start(t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur);
    } catch (e) { /* audio blocked */ }
  }

  /* ---------- Background music (procedural chiptune loops, one per world) ----------
     Each world's short loop is synthesized ONCE into an AudioBuffer via an
     OfflineAudioContext, then played gaplessly with a single looping source — no
     live scheduler, so it's free on the timer/battery. Original composition, so
     it's royalty-free. Gated by the Music setting; the AudioContext only starts
     after a user gesture (autoplay policy), and music stops while backgrounded. */
  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Each loop is `chords.length × stepsPerChord` 16th-note steps; the lead arpeggiates
  // chord tones (index into [t0,t1,t2, t0+12]) so it's always consonant. Fields past
  // the core four are optional and default to the volt values, so volt renders
  // unchanged — only grid opts into the pad layer / slow tempo / longer progression.
  const SONGS = {
    // Chill synthwave dream-pad — C major, 48 BPM, 8 chords (vi–IV–I–V ×2 varied) →
    // a slow, spacious 20.0s loop. A detuned sawtooth pad swells and fades under each
    // chord (the warm "supersaw" bed); soft held triangle bass, a gentle heartbeat
    // pulse, and a sparse triangle melody with lots of air.
    grid: {
      bpm: 48, stepsPerChord: 8,
      bassType: 'triangle', bassEvery: 8, bassVol: 0.44,
      kickEvery: 4, kickVol: 0.32,
      pad: [0, 1, 2], padType: 'sawtooth', padVol: 0.1, detune: 9,
      leadType: 'triangle', leadLen: 1.4, leadVol: 0.29,
      chords: [
        [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],   // Am · F · C · G
        [57, 60, 64], [53, 57, 60], [50, 53, 57], [55, 59, 62],    // Am · F · Dm · G
      ],
      arp: [0, null, 2, null, null, 1, null, null, 2, null, 1, null, null, 0, null, null],
    },
    volt: {  // dark & tense — A minor (Am · F · G · E-major dominant)
      bpm: 102, stepsPerChord: 8, bassType: 'square', bassEvery: 4, kickEvery: 8,
      leadType: 'sawtooth', leadLen: 1.9,
      chords: [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 44, 47]],
      arp: [3, null, null, 1, 0, null, 2, null],
    },
  };
  function renderMusicBuffer(world) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const song = SONGS[world];
    const spb = 60 / song.bpm / 4;            // seconds per 16th step
    const spc = song.stepsPerChord || 8;      // steps each chord is held
    const steps = song.chords.length * spc;   // whole progression = one loop
    const sr = 44100;
    const oac = new OAC(1, Math.ceil(steps * spb * sr), sr);
    const voice = (type, midi, t, len, vol) => {
      const o = oac.createOscillator(), g = oac.createGain();
      o.type = type; o.frequency.value = midiHz(midi);
      o.connect(g); g.connect(oac.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); o.stop(t + len + 0.02);
    };
    // Sustained, detuned pad voice: a slow swell up then a fade back down across the
    // whole chord, doubled ±detune cents for a warm analog width. (grid only)
    const pad = (type, midi, t, len, vol, cents) => {
      [-cents, cents].forEach((dc) => {
        const o = oac.createOscillator(), g = oac.createGain();
        o.type = type; o.frequency.value = midiHz(midi);
        if (o.detune) o.detune.value = dc;
        o.connect(g); g.connect(oac.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.5, len * 0.3));   // slow swell
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);                     // fade into next chord
        o.start(t); o.stop(t + len + 0.02);
      });
    };
    for (let i = 0; i < steps; i++) {
      const t = i * spb;
      const chord = song.chords[Math.floor(i / spc) % song.chords.length];
      if (i % song.bassEvery === 0) voice(song.bassType, chord[0] - 12, t, spb * song.bassEvery * 0.9, song.bassVol || 0.5);
      if (i % song.kickEvery === 0) voice('sine', 33, t, 0.12, song.kickVol || 0.55);   // soft low thump for pulse
      if (song.pad && i % spc === 0) {
        for (const idx of song.pad) pad(song.padType, chord[idx], t, spc * spb, song.padVol || 0.09, song.detune || 8);
      }
      const a = song.arp[i % song.arp.length];
      if (a != null) voice(song.leadType, (a === 3 ? chord[0] + 12 : chord[a]) + 12, t, spb * song.leadLen, song.leadVol || 0.35);
    }
    return oac.startRendering();   // Promise<AudioBuffer>
  }
  const musicBuffers = {};   // world -> AudioBuffer (rendered once, cached)
  let musicSource = null, musicGain = null, musicWorld = null;
  async function ensureMusicBuffer(world) {
    if (musicBuffers[world]) return musicBuffers[world];
    const p = renderMusicBuffer(world);
    if (!p) return null;
    return (musicBuffers[world] = await p);
  }
  function stopMusic() {
    if (musicSource) { try { musicSource.stop(); } catch (e) { /* already stopped */ } musicSource = null; }
    musicWorld = null;
  }
  async function playMusic(world) {
    if (!state.settings.music) return;
    if (musicSource && musicWorld === world) return;   // already looping this world's track
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});   // fire-and-forget: never stall if a gesture is still settling
      if (!musicGain) { musicGain = audioCtx.createGain(); musicGain.gain.value = 0.11; musicGain.connect(audioCtx.destination); }
      const buf = await ensureMusicBuffer(world);
      if (!buf || !state.settings.music) return;   // no support, or toggled off mid-render
      stopMusic();
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.connect(musicGain);
      src.start();
      musicSource = src; musicWorld = world;
    } catch (e) { /* audio unavailable / blocked */ }
  }
  // Follow the active world once music is already playing (never auto-starts it).
  function syncMusicWorld() {
    if (musicSource && state.settings.music && musicWorld !== activeWorld()) playMusic(activeWorld());
  }
  // Browsers only allow audio to start after a user gesture — resume + start on the
  // first interaction (if Music is on).
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* ignore */ }
    if (state.settings.music) playMusic(activeWorld());
  }

  /* ---------- Haptics ----------
     Native: the Capacitor Haptics plugin (real haptics on iOS + Android, where
     the Vibration API is unsupported). Web: the Vibration API (Android only —
     iOS Safari has no vibrate). Setting-gated. */
  const Haptics = window.Capacitor?.isNativePlatform?.() ? (window.Capacitor?.Plugins?.Haptics || null) : null;
  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  function buzz(pattern) {
    if (!state.settings.haptics) return;
    if (Haptics) {
      try {
        const total = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
        Haptics.impact({ style: total >= 60 ? 'HEAVY' : total >= 18 ? 'MEDIUM' : 'LIGHT' });
      } catch (e) { /* ignore */ }
      return;
    }
    if (canVibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  }

  /* ---------- Floating numbers ---------- */
  // Whichever tap control is currently on screen, in either world: the mini bar on
  // an upgrade tab, the compact bar when a tap panel is collapsed, or the big hero
  // button. Keeps float effects pinned to the visible control as worlds/tabs change.
  function tapAnchor() {
    const onTab = (id) => { const p = document.getElementById(id); return p && p.classList.contains('active'); };
    const collapsed = (id) => { const p = document.getElementById(id); return p && p.classList.contains('plug-collapsed'); };
    if (activeWorld() === 'volt') {
      if (el.zapMini && onTab('p-arsenal')) return el.zapMini;
      if (el.enemyBtnMini && collapsed('p-zap')) return el.enemyBtnMini;
      return el.enemyBtn || el.socket;
    }
    if (el.socketMini && onTab('p-up')) return el.socketMini;
    if (el.socketMiniPlug && collapsed('p-plug')) return el.socketMiniPlug;
    return el.socket;
  }
  // Visible "tick" on the socket each time the Auto-Tapper fires, so the player
  // can see it working even while idle. Respects the animations toggle.
  function pulseAutoTap() {
    if (!state.settings.floats || reduceMotion()) return;
    const btn = el.socket;
    if (!btn) return;
    btn.classList.remove('autotap-fire');
    void btn.offsetWidth;          // force reflow so the animation can replay
    btn.classList.add('autotap-fire');
  }
  // World-2 mirror of pulseAutoTap: replay the enemy zap-flash each time the
  // Auto-Zapper fires, so it's as visibly "working" as the Grid Auto-Tapper.
  function pulseAutoZap() {
    if (!state.settings.floats || reduceMotion()) return;
    const btn = el.enemyBtn;
    if (!btn) return;
    btn.classList.remove('zapped');
    void btn.offsetWidth;          // force reflow so the animation can replay
    btn.classList.add('zapped');
  }
  function spawnFloater(amount) {
    if (!state.settings.floats) return;
    const r = tapAnchor().getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'float';
    f.textContent = '+' + fmt(amount);
    f.style.left = (r.left + r.width / 2 - 20 + (Math.random() * 60 - 30)) + 'px';
    f.style.top = (r.top + 40) + 'px';
    el.floaters.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  /* ---------- Juice: subtle screenshake ---------- */
  const reduceMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function screenShake(intensity = 1) {
    if (!state.settings.floats || reduceMotion()) return; // respect the animations toggle
    const app = document.getElementById('app');
    if (!app || !app.animate) return;
    const k = intensity;
    app.animate([
      { transform: 'translate(0,0)' },
      { transform: `translate(${-5 * k}px, ${2 * k}px)` },
      { transform: `translate(${4 * k}px, ${-3 * k}px)` },
      { transform: `translate(${-2 * k}px, ${1 * k}px)` },
      { transform: 'translate(0,0)' },
    ], { duration: 180, easing: 'ease-out' });
  }

  /* ---------- Power surges (Golden-Cookie style bonus events) ---------- */
  let surgeActive = false;
  let surgeHideTimer = null;
  let surgeChain = 0;       // consecutive catches within 60s of each other
  let lastSurgeCatch = 0;
  let stormUntil = 0;       // GRID STORM: surges rush in for 90s

  function scheduleSurge() {
    const storm = stormUntil > Date.now();
    const delay = storm
      ? 8000 + Math.random() * 6000
      : (60000 + Math.random() * 90000) * surgeDelayMult()       // 60–150s (Surge Magnet: ×0.6)
        * (chDone('darkgrid') ? 0.8 : 1);                        // SURGE BEACON challenge perk
    setTimeout(trySpawnSurge, delay);
  }
  function trySpawnSurge() {
    if (document.hidden || surgeActive || ch('grid') === 'darkgrid') { scheduleSurge(); return; }
    spawnSurge();
  }
  function spawnSurge() {
    surgeActive = true;
    const node = document.createElement('button');
    node.className = 'surge';
    node.type = 'button';
    node.setAttribute('aria-label', 'Tap the power surge for a bonus!');
    node.textContent = '⚡';
    node.style.left = (12 + Math.random() * 70) + '%';
    node.style.top = (16 + Math.random() * 60) + '%';
    node.addEventListener('click', () => collectSurge(node));
    el.surgeLayer.appendChild(node);
    blip(880, 0.16, 'sine', 0.045); // gentle chime to draw the eye
    surgeHideTimer = setTimeout(() => { removeSurge(node); scheduleSurge(); }, 14000);
  }
  function removeSurge(node) {
    surgeActive = false;
    if (surgeHideTimer) { clearTimeout(surgeHideTimer); surgeHideTimer = null; }
    if (node) node.remove();
  }
  function collectSurge(node) {
    removeSurge(node);
    const now = Date.now();
    // Chain: catches within 60s of each other compound — rewards being present.
    surgeChain = now - lastSurgeCatch <= 60000 ? surgeChain + 1 : 1;
    lastSurgeCatch = now;
    const chainMult = Math.min(1 + 0.25 * (surgeChain - 1), 3);      // up to ×3
    const chainExtraMs = Math.min((surgeChain - 1) * 2000, 10000);   // buffs last longer
    const roll = Math.random();
    if (roll < 0.5) {
      // OVERLOAD: an instant currency payout. Route it to the world the player is
      // actually in — volts in the Voltlands, watts on the Grid — so catching a
      // surge in World 2 rewards World 2 instead of the idle Grid. (The FRENZY /
      // CLICK outcomes below are global buffs and already lift the active world.)
      if (activeWorld() === 'volt') {
        const w = sl().wave;
        const ratio = voltReward(w) / enemyHp(w);        // volts per point of damage
        const bonus = Math.max(totalZps() * ratio * 90, zapPower() * ratio * 60, 50) * surgeRewardMult() * chainMult;
        sl().volts += bonus; sl().totalVolts += bonus; sl().runVolts += bonus;
        spawnFloater(bonus);
        toast('⚡ OVERLOAD! +' + fmt(bonus) + ' V', true);
      } else {
        const bonus = Math.max(totalWps() * 90, clickPower() * 60, 50) * surgeRewardMult() * chainMult;
        gainWatts(bonus);
        spawnFloater(bonus);
        toast('⚡ OVERLOAD! +' + fmt(bonus) + ' W', true);
      }
    } else if (roll < 0.75) {
      buffs.push({ kind: 'prod', mult: 7, until: now + 15000 + chainExtraMs, icon: '🔥', label: 'FRENZY ×7' });
      toast('🔥 PRODUCTION FRENZY ×7!', true);
    } else {
      buffs.push({ kind: 'click', mult: 10, until: now + 12000 + chainExtraMs, icon: '👆', label: 'CLICK ×10' });
      toast('👆 CLICK FRENZY ×10!', true);
    }
    if (surgeChain >= 2) toast(`⛓️ SURGE CHAIN ×${surgeChain}!`, true);
    // Rare GRID STORM: surges rush in every ~10s for 90 seconds.
    if (Math.random() < 0.07 && stormUntil < now) {
      stormUntil = now + 90000;
      buffs.push({ kind: 'storm', mult: 1, until: stormUntil, icon: '🌩️', label: 'GRID STORM', src: 'storm' });
      toast('🌩️ GRID STORM! Surges rushing in for 90s', true);
    }
    state.surgesCollected = (state.surgesCollected || 0) + 1;
    blip(1200, 0.18, 'square', 0.06);
    buzz([0, 30, 50, 30]);
    screenShake(1.2);
    checkAchievements();
    renderBuffs();
    renderStatsLite();
    scheduleSurge();
  }

  // Persistent banners (streak, surge buffs, challenge) live in the strip
  // under the header. With two or more they scroll horizontally like a ticker
  // instead of wrapping; a single one just sits centered. The set of pills
  // ("sig") only changes when a buff is added or expires, so the per-tick
  // path patches each pill's live value (seconds left / challenge progress)
  // in place — the marquee keeps scrolling and never jumps back to start.
  const TICKER_SPEED = 42;        // px/sec — constant regardless of pill count
  let buffSig = '';
  let buffVals = [];              // .bt nodes (both ticker copies), in order
  function buffEntries() {
    const now = Date.now();
    const list = buffs.map((b) => ({
      key: (b.src || b.kind || b.label),
      head: `${b.icon} ${b.label} · `,
      val: () => {
        const left = Math.ceil((b.until - Date.now()) / 1000);
        return left >= 60 ? `${Math.floor(left / 60)}m${left % 60 ? (left % 60) + 's' : ''}` : `${left}s`;
      },
    }));
    const chal = ch() ? CHALLENGES.find((x) => x.id === ch()) : null;
    if (chal) list.push({
      key: 'chal:' + chal.id,
      head: `${chal.icon} ${chal.name} · `,
      val: () => {
        const prog = (chal.world === 'volt') ? (sl().runVolts || 0) : state.totalEarned;
        return `${fmt(Math.min(prog, chGoalFor(chal)))}/${fmt(chGoalFor(chal))}`;
      },
    });
    void now;
    return list;
  }
  function renderBuffs() {
    buffs = buffs.filter((b) => b.until > Date.now());
    const entries = buffEntries();
    if (!entries.length) {
      el.buffBar.classList.remove('show', 'animate');
      el.buffBar.innerHTML = ''; buffSig = ''; buffVals = [];
      return;
    }
    el.buffBar.classList.add('show');
    const sig = entries.map((e) => e.key).join('|');
    if (sig === buffSig && buffVals.length) {           // same pills: patch values only
      const n = entries.length;
      buffVals.forEach((node, i) => { node.textContent = entries[i % n].val(); });
      return;
    }
    buffSig = sig;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ticker = entries.length >= 2 && state.settings.floats && !reduce;
    el.buffBar.classList.toggle('animate', ticker);
    const pills = entries.map((e) => `<span class="buff">${e.head}<i class="bt">${e.val()}</i></span>`).join('');
    // Ticker duplicates the pill run so the loop is seamless (translateX -50%).
    const inner = ticker ? pills + pills : pills;
    el.buffBar.innerHTML = `<div class="buff-track">${inner}</div>`;
    buffVals = Array.from(el.buffBar.querySelectorAll('.bt') || []);
    if (ticker) {
      const track = el.buffBar.querySelector('.buff-track');
      const copyW = (track.scrollWidth || 0) / 2;        // width of one pill run
      if (copyW > 0) track.style.animationDuration = (copyW / TICKER_SPEED) + 's';
    }
  }

  /* ---------- Achievements ---------- */
  function checkAchievements() {
    let earnedNew = false;
    for (const a of ACHIEVEMENTS) {
      if (state.achievements[a.id]) continue;
      let ok = false;
      try { ok = a.cond(); } catch (e) { ok = false; }
      if (ok) {
        state.achievements[a.id] = true;
        earnedNew = true;
        toast('🏆 ' + a.name + ' · GRID +1%', true);
        blip(1320, 0.2, 'triangle', 0.06);
        buzz([0, 20, 50, 20, 50, 40]);
        screenShake(0.8);
      }
    }
    if (earnedNew && document.getElementById('p-goals').classList.contains('active')) {
      renderGoals();
    }
  }

  function renderGoals() {
    const done = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
    el.goalcount.textContent = `(${done}/${ACHIEVEMENTS.length})`;
    const gb = document.getElementById('gridBonus');
    if (gb) gb.textContent = `⚡ GRID BONUS: +${done}% production · +1% per achievement, kept through recycling`;
    let html = '';
    for (const a of ACHIEVEMENTS) {
      const got = !!state.achievements[a.id];
      let prog = '';
      if (!got && a.prog) {
        const [cur, max] = a.prog();
        const pct = Math.max(0, Math.min(100, (cur / max) * 100));
        prog = `<div class="ach-prog"><i style="width:${pct}%"></i></div>` +
               `<div class="ach-progtext">${fmt(Math.min(cur, max))} / ${fmt(max)}</div>`;
      }
      html += `
        <div class="goal ${got ? 'done' : 'locked'}">
          <div class="gi">${got ? a.icon : '🔒'}</div>
          <div class="gbody">
            <div class="gn">${a.name}</div>
            <div class="gd">${a.desc}</div>
            ${prog}
          </div>
          ${got ? '<div class="gcheck">✓</div>' : ''}
        </div>`;
    }
    el.goallist.innerHTML = html;
  }

  /* ---------- Core actions ---------- */
  // Credit `n` taps (manual or from the Auto-Tapper) and celebrate any tap
  // milestone crossed in the process — so auto-taps count toward milestones too.
  // Shared: celebrate any TAP_MILESTONES threshold crossed between before→after.
  function celebrateMilestones(before, after, makeMsg) {
    for (const t of TAP_MILESTONES) {
      if (t > before && t <= after) {
        toast(makeMsg(), true);
        blip(990, 0.18, 'sawtooth', 0.05);
        buzz([0, 25, 40, 25]);
        screenShake(1);
      }
    }
  }
  function awardClicks(n) {
    if (n <= 0) return;
    const before = state.clicks;
    state.clicks += n;
    celebrateMilestones(before, state.clicks, () => `👆 TAP MILESTONE! Tap power ×1.5 (now ×${fmt(tapMilestoneMult())})`);
  }
  // Voltlands analog of awardClicks: credit hand + auto tap-zaps toward zap milestones.
  function awardZaps(n) {
    if (n <= 0) return;
    const before = sl().zaps;
    sl().zaps += n;
    celebrateMilestones(before, sl().zaps, () => `⚡ ZAP MILESTONE! Tap-zap power ×1.25 (now ×${fmt(zapMilestoneMult())})`);
  }

  function plug() {
    const gain = clickPower();
    gainWatts(gain);
    awardClicks(1);
    spawnFloater(gain);
    blip(660 + Math.random() * 80, 0.04, 'triangle');
    buzz(8); // light tap tick
    if (state.settings.floats) {
      el.socket.classList.add('tapping');
      setTimeout(() => el.socket.classList.remove('tapping'), 200);
      el.socketSvg.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 160, easing: 'ease-out' }
      );
    }
    checkAchievements();
    renderStatsLite();
  }

  function buyCord(cord) {
    if (ch() === 'solo' && cord.id !== 'usba') { toast('🔒 SOLO CIRCUIT: USB-A only'); blip(120, 0.06); return; }
    const count = buyCount(cord);
    if (count <= 0) return;
    const cost = cordCost(cord, count);
    if (state.watts < cost) { toast('Not enough watts'); blip(120, 0.06); return; }
    const before = state.owned[cord.id] || 0;
    state.watts -= cost;
    const after = before + count;
    state.owned[cord.id] = after;
    blip(320, 0.06, 'square', 0.05);
    buzz(12);
    // Celebrate crossing an ownership milestone (×2, or ×10 at every 100).
    if (Math.floor(after / CORD_MILESTONE) > Math.floor(before / CORD_MILESTONE)) {
      const tier = cordMilestoneMult(after);
      const big = Math.floor(after / BIG_MILESTONE) > Math.floor(before / BIG_MILESTONE);
      toast(`✖️ ${cord.name} ${big ? 'MEGA milestone! ×10 ·' : 'milestone!'} Now ×${fmt(tier)}`, true);
      blip(990, 0.18, 'sawtooth', 0.05);
      buzz([0, 25, 40, 25]);
      screenShake(1);
    }
    checkAchievements();
    updateCords();
    renderStatsLite();
  }

  function buyUpgrade(u) {
    if (ch() === 'minimalist') { toast('🔒 MINIMALIST: no upgrades'); blip(120, 0.06); return; }
    if (state.upgrades[u.id]) return;
    if (state.watts < u.cost) { toast('Not enough watts'); blip(120, 0.06); return; }
    state.watts -= u.cost;
    state.upgrades[u.id] = true;
    blip(880, 0.12, 'sawtooth', 0.05);
    buzz([0, 15, 30, 15]);
    toast('⬆ ' + u.name + ' purchased!');
    checkAchievements();
    updateCords();
    updateUpgrades();
    renderStatsLite();
  }

  function upgradeUnlocked(u) {
    if (!u.req) return true;
    return (state.owned[u.req.cord] || 0) >= u.req.n;
  }

  function buyCoreUpgrade(cu) {
    if (state.coreUpgrades[cu.id]) return;
    if (cu.req && !co(cu.req)) return;   // locked until its prerequisite is owned
    if ((state.cores || 0) < cu.cost) { toast('Not enough cores'); blip(120, 0.06); return; }
    state.cores -= cu.cost;
    state.coreUpgrades[cu.id] = true;
    if (cu.id === 'mystery') {           // you were warned not to plug it in
      state.wormhole = true;
      save();
      checkAchievements();
      playWormhole();
      return;
    }
    blip(700, 0.16, 'sawtooth', 0.05);
    buzz([0, 20, 40, 20]);
    toast('◆ ' + cu.name + '!', true);
    checkAchievements();
    renderCoreShop();
    updateCords();       // production multipliers may have changed
    updateUpgrades();
    syncSettingsUI();    // reveal the Auto-Buyer / Auto-Upgrader toggle if just bought
    renderStatsLite();
  }

  // Storm Upgrade purchase (mirror of buyCoreUpgrade, spent with Storm Shards).
  // The w3teaser is non-purchasable — it returns silently.
  function buyStormUpgrade(su_) {
    if (!su_ || su_.disabled) return;     // world-3 placeholder can never be bought
    if (state.slayer.shardUpgrades[su_.id]) return;
    if (su_.req && !su(su_.req)) return;  // locked until its prerequisite is owned
    if ((sl().shards || 0) < su_.cost) { toast('Not enough shards'); blip(120, 0.06); return; }
    sl().shards -= su_.cost;
    sl().shardUpgrades[su_.id] = true;
    blip(700, 0.16, 'sawtooth', 0.05);
    buzz([0, 20, 40, 20]);
    toast('💠 ' + su_.name + '!', true);
    checkAchievements();
    renderStormShop();
    syncSettingsUI();    // reveal the Auto-* toggle if just bought
    renderStatsLite();
  }

  // Surge Grid node purchase (mirror of buyStormUpgrade, spent with Surge Charges).
  function surgeNodeUnlocked(n) {
    if (n.req && !sg(n.req)) return false;                                        // prerequisite not owned yet
    if (n.branch && sl().surgeBranch && sl().surgeBranch !== n.branch) return false;   // a different path is already chosen
    return true;
  }
  function buySurgeNode(n) {
    if (!n || sg(n.id)) return;
    if (!surgeNodeUnlocked(n)) { toast(n.req && !sg(n.req) ? 'Research its prerequisite first' : 'Locked by your chosen path'); blip(120, 0.06); return; }
    if ((sl().surgeCharges || 0) < n.cost) { toast('Not enough Surge Charges'); blip(120, 0.06); return; }
    sl().surgeCharges -= n.cost;
    sl().surgeNodes[n.id] = true;
    if (n.branch) sl().surgeBranch = n.branch;   // committing to a mutually-exclusive path
    blip(700, 0.16, 'sawtooth', 0.05);
    buzz([0, 20, 40, 20]);
    toast('⚡ ' + n.name, true);
    renderSurgeTree();   // reflect the buy: reveal next nodes, lock the other paths
    checkAchievements();
  }

  // Surge build presets: save the current node allocation to one of 3 slots and
  // re-buy it with one tap (e.g. after a free respec on reincarnation). Slots live
  // in the slayer subtree, so they persist across reincarnation AND grid prestige.
  function saveSurgePreset(i) {
    if (i < 0 || i > 2 || !sl().surgePresets) return;
    sl().surgePresets[i] = { branch: sl().surgeBranch, nodes: Object.keys(sl().surgeNodes) };
    blip(700, 0.12, 'sawtooth', 0.05); buzz([0, 15, 30]);
    toast('💾 Saved build to slot ' + 'ABC'[i], true);
    renderSurgeTree();
  }
  function loadSurgePreset(i) {
    const p = sl().surgePresets && sl().surgePresets[i];
    if (!p) { toast('Slot ' + 'ABC'[i] + ' is empty'); blip(120, 0.06); return; }
    let bought = 0;
    // SURGE_NODES is in prereq order, so one pass buys prerequisites before dependents.
    for (const n of SURGE_NODES) {
      if (sg(n.id) || !p.nodes.includes(n.id) || !surgeNodeUnlocked(n) || (sl().surgeCharges || 0) < n.cost) continue;
      sl().surgeCharges -= n.cost;
      sl().surgeNodes[n.id] = true;
      if (n.branch) sl().surgeBranch = n.branch;
      bought++;
    }
    if (bought) checkAchievements();
    blip(bought ? 700 : 120, bought ? 0.14 : 0.06, 'sawtooth', 0.05);
    toast(bought ? ('📲 Built ' + bought + ' node' + (bought > 1 ? 's' : '') + ' from slot ' + 'ABC'[i]) : ('Slot ' + 'ABC'[i] + ': nothing affordable yet'), bought > 0);
    renderSurgeTree();
  }

  /* ---------- Rendering ---------- */
  function renderShop() {
    renderCords();
    renderUpgrades();
  }

  // a cord is shown once the previous one is owned (or it's the first)
  function visibleCords() {
    return CORDS.filter((cord, i) => {
      const owned = state.owned[cord.id] || 0;
      const prevOwned = i === 0 ? 1 : (state.owned[CORDS[i - 1].id] || 0);
      return owned > 0 || prevOwned > 0;
    });
  }

  // Full rebuilds replace every node, which eats any tap that's mid-press
  // (pointerdown landed on a button that no longer exists by pointerup).
  // So rebuilds cache their nodes + a structure key, and the per-tick path
  // (updateCords/updateUpgrades below) patches text/classes in place,
  // only falling back to a rebuild when the set of visible items changes.
  let cordStructKey = '';
  let cordNodes = [];
  // Show a cord's flavor description only when it fully fits the row on one line;
  // otherwise hide it entirely (never an ellipsis-truncated "…"). Phones lack the
  // width for most descriptions, the wider tablet column fits more. Re-measured on
  // (re)render, whenever the "W/s each" value changes, and on resize.
  function fitFlavor(n) {
    if (!n || !n.flavor || !n.meta) return;
    if (!n.meta.clientWidth) { n.flavor.style.display = 'none'; return; } // unmeasurable (tab hidden) -> hide
    n.flavor.style.display = 'inline';
    if (n.meta.scrollWidth > n.meta.clientWidth) n.flavor.style.display = 'none';
  }
  function refitFlavors() { for (const n of cordNodes) fitFlavor(n); for (const n of weaponNodes) fitFlavor(n); }
  function renderCords() {
    // Bulk-buy buttons live in the sticky toolbar (#bulkBar), separate from the
    // scrolling cord list, so they stay reachable when scrolled to the bottom.
    el.bulkBar.innerHTML = [1, 5, 10, 'max'].map(b =>
      `<button class="bulk-btn ${state.bulk === b ? 'active' : ''}" data-bulk="${b}">${b === 'max' ? 'MAX' : 'x' + b}</button>`
    ).join('');

    let html = '';
    const vis = visibleCords();
    vis.forEach((cord) => {
      const owned = state.owned[cord.id] || 0;
      const count = buyCount(cord);
      const cost = cordCost(cord, count);
      const can = state.watts >= cost;
      // Core-gain cord (Ouroboros): boosts prestige cores instead of watts.
      if (cord.coreGain) {
        const totalPct = cord.coreGain * owned * 100;   // uncapped — scales with ownership
        html += `
        <button class="card buyable" data-cord="${cord.id}">
          <div class="ico">${cord.icon}</div>
          <div class="body">
            <div class="nm">${cord.name}</div>
            <div class="meta"><span class="pos">+${fmt(cord.coreGain * 100)}% ◆ cores each</span><span class="flavor"> · ${cord.desc}</span></div>
          </div>
          <div class="right">
            <div class="owned">own ${fmt(owned)}</div>
            <div class="cost ${can ? 'ok' : 'no'}">${fmt(cost)} W</div>
            <div class="mnote">+${fmt(totalPct)}% ◆</div>
          </div>
        </button>`;
        return;
      }
      const each = cord.wps * cordMultiplier(cord.id) * prestigeMult() * PROD_MULT;
      const nextMs = (Math.floor(owned / CORD_MILESTONE) + 1) * CORD_MILESTONE;
      const nextMult = nextMs % BIG_MILESTONE === 0 ? BIG_MILESTONE_MULT : 2;
      const msPct = (owned % CORD_MILESTONE) / CORD_MILESTONE * 100;
      html += `
        <button class="card buyable" data-cord="${cord.id}">
          <div class="ico">${cord.icon}</div>
          <div class="body">
            <div class="nm">${cord.name}</div>
            <div class="meta"><span class="pos">${fmt(each)} W/s each</span><span class="flavor"> · ${cord.desc}</span></div>
            <div class="milestone"><i style="width:${msPct}%"></i></div>
          </div>
          <div class="right">
            <div class="owned">own ${fmt(owned)}</div>
            <div class="cost ${can ? 'ok' : 'no'}">${fmt(cost)} W</div>
            <div class="mnote">${owned > 0 ? `×${nextMult} @ ${fmt(nextMs)}` : '&nbsp;'}</div>
          </div>
        </button>`;
    });
    if (!vis.length) html += `<p class="empty-note">Tap the socket to earn your first watts!</p>`;
    el.cordlist.innerHTML = html;
    cordStructKey = state.bulk + '|' + vis.map((c) => c.id).join(',');
    cordNodes = Array.from(el.cordlist.querySelectorAll('[data-cord]') || []).map((node) => ({
      node,
      owned: node.querySelector('.owned'),
      cost: node.querySelector('.cost'),
      mnote: node.querySelector('.mnote'),
      pos: node.querySelector('.pos'),
      ms: node.querySelector('.milestone i'),
      meta: node.querySelector('.meta'),
      flavor: node.querySelector('.flavor'),
      _lastPos: '',
    }));
    for (const n of cordNodes) { n._lastPos = n.pos ? n.pos.textContent : ''; fitFlavor(n); }
  }

  function updateCords() {
    const vis = visibleCords();
    const key = state.bulk + '|' + vis.map((c) => c.id).join(',');
    if (key !== cordStructKey || cordNodes.length !== vis.length ||
        (cordNodes[0] && !cordNodes[0].node.isConnected)) { renderCords(); return; }
    vis.forEach((cord, i) => {
      const n = cordNodes[i];
      const owned = state.owned[cord.id] || 0;
      const cost = cordCost(cord, buyCount(cord));
      n.owned.textContent = 'own ' + fmt(owned);
      n.cost.textContent = fmt(cost) + ' W';
      n.cost.className = 'cost ' + (state.watts >= cost ? 'ok' : 'no');
      if (cord.coreGain) {
        const totalPct = cord.coreGain * owned * 100;
        n.mnote.textContent = `+${fmt(totalPct)}% ◆`;
        return;
      }
      const each = cord.wps * cordMultiplier(cord.id) * prestigeMult() * PROD_MULT;
      const posTxt = `${fmt(each)} W/s each`;
      if (n.pos && n._lastPos !== posTxt) { n.pos.textContent = posTxt; n._lastPos = posTxt; fitFlavor(n); }
      const nextMs = (Math.floor(owned / CORD_MILESTONE) + 1) * CORD_MILESTONE;
      const nextMult = nextMs % BIG_MILESTONE === 0 ? BIG_MILESTONE_MULT : 2;
      if (n.ms) n.ms.style.width = ((owned % CORD_MILESTONE) / CORD_MILESTONE * 100) + '%';
      n.mnote.textContent = owned > 0 ? `×${nextMult} @ ${fmt(nextMs)}` : ' ';
    });
  }

  // Show every unlocked upgrade; purchased ones stay visible but greyed.
  function unlockedUpgrades() {
    return UPGRADES
      .filter(u => state.upgrades[u.id] || upgradeUnlocked(u))
      .sort((a, b) => a.cost - b.cost);
  }

  let upgStructKey = '';
  let upgNodes = [];
  function renderUpgrades() {
    const list = unlockedUpgrades();
    if (list.length === 0) {
      el.uplist.innerHTML = `<p class="empty-note">Buy more cords to unlock upgrades…</p>`;
      upgStructKey = ''; upgNodes = [];
      return;
    }
    let html = '';
    for (const u of list) {
      const bought = !!state.upgrades[u.id];
      const can = !bought && state.watts >= u.cost;
      const cls = bought ? 'bought' : can ? 'ok' : 'no';
      html += `
        <button class="upg ${cls}" data-upgrade="${u.id}">
          <div class="un">${u.name}</div>
          <div class="ud">${u.desc}</div>
          <div class="uc">${bought ? '✓ OWNED' : fmt(u.cost) + ' W'}</div>
        </button>`;
    }
    el.uplist.innerHTML = html;
    upgStructKey = list.map((u) => u.id).join(',');
    upgNodes = Array.from(el.uplist.querySelectorAll('[data-upgrade]') || []).map((node) => ({
      node, uc: node.querySelector('.uc'),
    }));
  }

  function updateUpgrades() {
    const list = unlockedUpgrades();
    if (!list.length) { if (upgStructKey) renderUpgrades(); return; }
    const key = list.map((u) => u.id).join(',');
    if (key !== upgStructKey || upgNodes.length !== list.length ||
        (upgNodes[0] && !upgNodes[0].node.isConnected)) { renderUpgrades(); return; }
    list.forEach((u, i) => {
      const n = upgNodes[i];
      const bought = !!state.upgrades[u.id];
      const can = !bought && state.watts >= u.cost;
      n.node.className = 'upg ' + (bought ? 'bought' : can ? 'ok' : 'no');
      n.uc.textContent = bought ? '✓ OWNED' : fmt(u.cost) + ' W';
    });
  }

  function renderCoreShop() {
    if (!el.corelist) return;
    let html = '';
    for (const cu of CORE_UPGRADES) {
      // req-gated upgrades (e.g. the Auto-Tapper ladder) stay hidden until owned.
      if (cu.req && !co(cu.req) && !state.coreUpgrades[cu.id]) continue;
      // Once bought, the ??? upgrade transforms into the dedicated world-switch block
      // below the shop — so drop its card from the Core Upgrades grid.
      if (cu.id === 'mystery' && state.coreUpgrades[cu.id] && state.wormhole) continue;
      const bought = !!state.coreUpgrades[cu.id];
      const can = !bought && (state.cores || 0) >= cu.cost;
      const cls = bought ? 'bought' : can ? 'ok' : 'no';
      // The "???" upgrade (the Voltlands unlock) is the endgame goal — render it as
      // a full-width, glowing banner while it's still locked so it stands out.
      const mystery = cu.id === 'mystery' && !bought ? ' mystery' : '';
      html += `
        <button class="upg core ${cls}${mystery}" data-core="${cu.id}">
          <div class="un">${cu.icon} ${cu.name}</div>
          <div class="ud">${cu.desc}</div>
          <div class="uc">${bought ? '✓ OWNED' : '◆ ' + fmt(cu.cost)}</div>
        </button>`;
    }
    el.corelist.innerHTML = html;
  }

  function renderStormShop() {
    if (!el.stormlist) return;
    let html = '';
    for (const su_ of STORM_UPGRADES) {
      // req-gated upgrades stay hidden until their prerequisite is owned.
      if (su_.req && !su(su_.req) && !state.slayer.shardUpgrades[su_.id]) continue;
      // World-3 placeholder: a greyed, non-purchasable card (no data-storm,
      // so the delegated handler ignores it).
      if (su_.disabled) {
        html += `
        <div class="upg core no">
          <div class="un">${su_.icon} ${su_.name}</div>
          <div class="ud">${su_.desc}</div>
          <div class="uc">🔒 SOON</div>
        </div>`;
        continue;
      }
      const bought = !!state.slayer.shardUpgrades[su_.id];
      const can = !bought && (sl().shards || 0) >= su_.cost;
      const cls = bought ? 'bought' : can ? 'ok' : 'no';
      html += `
        <button class="upg core ${cls}" data-storm="${su_.id}">
          <div class="un">${su_.icon} ${su_.name}</div>
          <div class="ud">${su_.desc}</div>
          <div class="uc">${bought ? '✓ OWNED' : '💠 ' + fmt(su_.cost)}</div>
        </button>`;
    }
    el.stormlist.innerHTML = html;
  }

  // lightweight per-frame updates (numbers only, no list rebuild)
  function renderStatsLite() {
    const wps = totalWps();
    const volt = activeWorld() === 'volt';
    if (volt) {
      // header doubles as the Voltlands HUD
      el.watts.textContent = fmt(sl().volts);
      el.wps.textContent = fmt(totalZps());
      el.tapval.textContent = fmt(zapPower());
    } else {
      el.watts.textContent = fmt(state.watts);
      el.wps.textContent = fmt(wps);
      el.tapval.textContent = fmt(clickPower());
    }
    if (el.wattsUnit) el.wattsUnit.textContent = volt ? 'V' : 'W';
    if (el.wpsUnit) el.wpsUnit.textContent = volt ? 'Z/s' : 'W/s';
    if (el.tapUnit) el.tapUnit.textContent = volt ? '/ zap' : '/ plug';
    // Mini/compact tap bars mirror each world's main tap value: grid bars show
    // watts-per-plug, volt bars show damage-per-zap. (The bars live on world-scoped
    // tabs, so each is only ever visible in its own world.)
    if (el.tapvalMini) el.tapvalMini.textContent = fmt(clickPower());
    if (el.tapvalMiniPlug) el.tapvalMiniPlug.textContent = fmt(clickPower());
    if (el.tapvalZapMini) el.tapvalZapMini.textContent = fmt(zapPower());
    if (el.tapvalEnemyMini) el.tapvalEnemyMini.textContent = fmt(zapPower());
    if (el.tapinfo) {
      const next = nextTapMilestone();
      const frac = tapWpsFrac();
      const parts = [];
      if (tapMilestonesPassed() > 0) parts.push(`milestone ×${fmt(tapMilestoneMult())}`);
      if (frac > 0) parts.push(`+${Math.round(frac * 100)}% W/s per tap`);
      if (next) parts.push(`next ×1.5 @ ${fmtInt(next)} taps (${fmtInt(state.clicks)})`);
      el.tapinfo.textContent = parts.join(' · ');
    }
    if (el.autotapBadge) {
      const tapRate = autoTapRate();
      el.autotapBadge.hidden = tapRate <= 0;
      el.autotapBadge.textContent = `🤖 AUTO-TAPPER · ${tapRate}/s`;
    }
    // Header currency line: prestige cores on the grid, Storm Shards on the
    // Voltlands (they replace cores there). fmt() keeps the count from overflowing
    // when it grows and honors the scientific-notation setting.
    if (volt) {
      el.coresline.textContent = (sl().shardsEarned || 0) > 0
        ? `💠 ${fmt(sl().shards || 0)} · +${Math.round((shardMult() - 1) * 100)}%` : '';
    } else {
      el.coresline.textContent = (state.coresEarned || 0) > 0
        ? `◆ ${fmt(state.cores)} · +${lifetimeBonusPct()}%` : '';
    }
    el.statTotal.textContent = fmt(state.totalEarned);
    el.statClicks.textContent = fmtInt(state.clicks);
    el.statWps.textContent = fmt(wps);
    el.statGens.textContent = fmtInt(totalGenerators());
    el.statSurges.textContent = fmtInt(state.surgesCollected || 0);
    el.statAch.textContent = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length + ' / ' + ACHIEVEMENTS.length;
    const sg = document.getElementById('statGrid');
    if (sg) sg.textContent = '+' + achCount() + '%';
    // Voltlands stats (rows stay hidden until the wormhole)
    document.querySelectorAll('.voltstat').forEach((li) => { li.hidden = !state.wormhole; });
    if (state.wormhole) {
      const sv = document.getElementById('statVolts');
      const sw = document.getElementById('statWave');
      const sk = document.getElementById('statKills');
      const sb = document.getElementById('statBosses');
      if (sv) sv.textContent = fmt(sl().totalVolts);
      if (sw) sw.textContent = fmtInt(sl().wave);
      if (sk) sk.textContent = fmtInt(sl().kills);
      if (sb) sb.textContent = `${fmtInt(sl().bosses)} (grid +${sl().bosses * 2}%)`;
    }
    el.statCores.textContent = fmtInt(state.cores || 0);
    el.statTime.textContent = fmtDuration(Date.now() - state.startedAt);
    const pg = prestigeGain();
    el.coregain.textContent = fmtInt(pg);
    el.corecount.textContent = fmtInt(state.cores || 0);
    el.prestigemult.textContent = '+' + lifetimeBonusPct() + '%';
    el.prestigeBtn.classList.toggle('dis', pg < 1);
    // Voltlands prestige numbers (Storm Reactor) — only meaningful past the wormhole
    if (state.wormhole && el.reincarnateBtn) {
      const rg = reincarnateGain();
      if (el.shardgain) el.shardgain.textContent = fmtInt(rg);
      if (el.shardcount) el.shardcount.textContent = fmtInt(sl().shards || 0);
      if (el.shardmult) el.shardmult.textContent = '+' + Math.round((shardMult() - 1) * 100) + '%';
      el.reincarnateBtn.classList.toggle('dis', rg < 1);
    }
  }

  // Per-world More-tab gating: each world shows only its own prestige + shop;
  // Power Store / System Stats / Settings / Save Data stay visible in both.
  function renderMoreGating() {
    const volt = activeWorld() === 'volt';
    if (el.recycleBlock) el.recycleBlock.hidden = volt;
    if (el.coreShopBlock) el.coreShopBlock.hidden = volt;
    // The world-switch block (the transformed ??? upgrade) shows in BOTH worlds once
    // the wormhole is open — it's the persistent gateway between the Grid and Voltlands.
    if (el.worldswitchBlock) el.worldswitchBlock.hidden = !state.wormhole;
    if (el.voltPrestigeBlock) el.voltPrestigeBlock.hidden = !state.wormhole || !volt;
    if (el.voltShopBlock) el.voltShopBlock.hidden = !state.wormhole || !volt;
  }

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  // Read a settings value by [data-set] key. World-scoped automation keys use a
  // "world.path" form (e.g. "grid.autobuyOn", "volt.autoclickOn"); device prefs
  // are flat (sound/haptic/anim/sci).
  function settingVal(k) {
    const dot = k.indexOf('.');
    if (dot > 0) return state.settings.world[k.slice(0, dot)][k.slice(dot + 1)];
    return k === 'sound' ? state.settings.sound
         : k === 'music' ? state.settings.music
         : k === 'haptic' ? state.settings.haptics
         : k === 'anim' ? state.settings.floats
         : k === 'notify' ? state.settings.notify
         : state.settings.sci;
  }

  function syncSettingsUI() {
    // [data-set] only — the theme-picker buttons also use .sw and must not
    // have their labels clobbered with ON/OFF.
    document.querySelectorAll('.sw[data-set]').forEach((b) => {
      const v = settingVal(b.dataset.set);
      b.classList.toggle('on', !!v);
      b.textContent = v ? 'ON' : 'OFF';
    });
    const fb = document.getElementById('fpsBtn');
    if (fb) fb.textContent = (state.settings.fps || 30) + ' FPS';   // frame-rate cap label
    // Automation toggles appear only once owned AND in their own world.
    const volt = activeWorld() === 'volt';
    const abRow = document.getElementById('autobuyRow');
    if (abRow) abRow.hidden = volt || !co('autobuy');
    const auRow = document.getElementById('autoupgRow');
    if (auRow) auRow.hidden = volt || !co('autoupg');
    const arRow = document.getElementById('autoArsenalRow');
    if (arRow) arRow.hidden = !volt || !su('autoarsenal');
    const tiRow = document.getElementById('autoTinkerRow');
    if (tiRow) tiRow.hidden = !volt || !su('autotinker');
    const acRow = document.getElementById('autoclickRow');
    if (acRow) acRow.hidden = !volt || !(su('autozap') || chDone('staticcling'));
    const nRow = document.getElementById('notifyRow');   // notifications: native only
    if (nRow) nRow.hidden = !LocalNotifications;
    document.body.classList.toggle('noanim', !state.settings.floats);
  }

  function renderAll() {
    renderShop();
    renderCoreShop();
    renderChallenges();
    renderGoals();
    renderBuffs();
    if (state.wormhole) { renderWeapons(); renderZapUpgrades(); renderSlayerLite(); renderStormShop(); }
    renderMoreGating();
    renderStatsLite();
    syncSettingsUI();
    updateTabDots();
  }

  /* ---------- Tab notification dots (something here is buyable) ---------- */
  function updateTabDots() {
    if (el.dotUp) {
      el.dotUp.hidden = ch() === 'minimalist' || !UPGRADES.some((u) =>
        !state.upgrades[u.id] && upgradeUnlocked(u) && state.watts >= u.cost);
    }
    if (el.dotMore) {
      el.dotMore.hidden = !CORE_UPGRADES.some((cu) =>
        !state.coreUpgrades[cu.id] && (!cu.req || co(cu.req)) && (state.cores || 0) >= cu.cost);
    }
    if (el.dotArsenal) {
      const s = sl();
      el.dotArsenal.hidden = !state.wormhole || !ZAP_UPGRADES.some((u) =>
        !s.upgrades[u.id] && zapUpgradeUnlocked(u) && s.volts >= u.cost);
    }
    if (el.dotSurge) {
      const s = sl();
      el.dotSurge.hidden = !state.wormhole || !SURGE_NODES.some((n) =>
        !sg(n.id) && surgeNodeUnlocked(n) && (s.surgeCharges || 0) >= n.cost);
    }
  }

  /* ---------- Affordability refresh (cheap, runs each tick) ---------- */
  let lastSig = '';
  function refreshAffordability() {
    let sig = state.bulk + '|';
    for (let i = 0; i < CORDS.length; i++) {
      const c = CORDS[i];
      const owned = state.owned[c.id] || 0;
      const prevOwned = i === 0 ? 1 : (state.owned[CORDS[i - 1].id] || 0);
      const visible = owned > 0 || prevOwned > 0;
      sig += (visible ? (state.watts >= cordCost(c, buyCount(c)) ? '1' : '0') : '-');
    }
    sig += '|';
    for (const u of UPGRADES) {
      if (state.upgrades[u.id]) { sig += 'b'; continue; }
      if (!upgradeUnlocked(u)) { sig += '-'; continue; }
      sig += state.watts >= u.cost ? '1' : '0';
    }
    if (state.wormhole) {
      sig += '|' + state.bulk + '|';
      for (const w of WEAPONS) sig += sl().volts >= weaponCost(w, weaponBuyCount(w)) ? '1' : '0';
      for (const u of ZAP_UPGRADES) {
        if (sl().upgrades[u.id]) { sig += 'b'; continue; }
        sig += sl().volts >= u.cost ? '1' : '0';
      }
    }
    if (state.wormhole) {
      sig += '|' + sl().surgeBranch + '|';
      for (const n of SURGE_NODES) {
        if (n.req && !sg(n.req)) { sig += 'x'; continue; }          // hidden (prereq unmet)
        if (sg(n.id)) { sig += 'b'; continue; }                     // owned
        sig += !surgeNodeUnlocked(n) ? '-' : ((sl().surgeCharges || 0) >= n.cost ? '1' : '0');
      }
    }
    if (sig !== lastSig) {
      lastSig = sig;
      // patch-in-place: a full rebuild here would destroy whatever button the
      // player is mid-tap on (the auto-buyer dirties this up to 10x/sec)
      updateCords();
      updateUpgrades();
      if (state.wormhole) { updateWeapons(); updateZapUpgrades(); updateSurgeTree(); }
    }
  }

  /* ---------- Modal helpers ---------- */
  function showModal(html) { el.mbox.innerHTML = html; el.modal.classList.add('show'); }
  function hideModal() { el.modal.classList.remove('show'); }

  /* ---------- Run resets (prestige & challenges) ---------- */
  // Everything that survives a run reset. Monetization entitlements and streak
  // history are account/device facts, not run progress — losing them on
  // recycle would be a bug (and was: pre-v1.11 prestige dropped IAP grants).
  function carryState(extra) {
    return Object.assign({
      cores: state.cores || 0,
      coresEarned: state.coresEarned || 0,
      coreUpgrades: state.coreUpgrades,
      settings: state.settings,
      achievements: state.achievements,
      surgesCollected: state.surgesCollected,
      startedAt: state.startedAt,
      iap: state.iap, theme: state.theme,
      adDay: state.adDay, adUses: state.adUses,
      boostUntil: state.boostUntil, supporterDay: state.supporterDay,
      streak: state.streak, streakAt: state.streakAt,
      streakDay: state.streakDay, streakUntil: state.streakUntil,
      challengesDone: state.challengesDone,
      // carried so a grid-challenge start (which rebuilds state wholesale) can't
      // drop an in-flight volt-challenge snapshot; prestige resets it explicitly.
      challengeBackup: state.challengeBackup,
      // the Voltlands are a parallel world — grid resets never touch them
      wormhole: state.wormhole, world: state.world,
      lifetimeEarned: state.lifetimeEarned, slayer: state.slayer,
    }, extra || {});
  }
  // Challenge-perk head starts applied to every fresh run.
  function applyRunStartPerks() {
    if (chDone('unplugged')) state.owned.usba = Math.max(state.owned.usba || 0, 5);  // JUMP LEADS
    if (chDone('minimalist') && ch() !== 'minimalist') state.upgrades.u_click1 = true; // PREWIRED
  }
  // Voltlands challenge-perk head starts applied to every reincarnation/run.
  function applyReincarnatePerks() {
    if (chDone('numbfingers')) sl().weapons.glove = Math.max(sl().weapons.glove || 0, 5);  // CONDUCTIVE GRIP
    if (chDone('notools') && ch('volt') !== 'notools') sl().upgrades.z_zap1 = true;          // BARE WIRE
  }

  /* ---------- Prestige ---------- */
  function doPrestige() {
    const gain = prestigeGain();
    if (gain <= 0) { toast('Earn more before recycling'); return; }
    const newPct = Math.round((prestigeMultFor((state.coresEarned || 0) + gain) - 1) * 100);
    const kept = Math.floor((state.watts || 0) * prestigeKeepFrac());
    showModal(`
      <h2 class="danger">♻ RECYCLE?</h2>
      <p class="dim">Reset watts, cords &amp; upgrades.<br>Cores, core upgrades &amp; goals are kept.${ch() ? '<br><b>Abandons the active challenge!</b>' : ''}</p>
      <p class="big">+${fmt(gain)} ◆ Cores</p>
      <p>New bonus: <b style="color:var(--green)">+${newPct}%</b>${kept > 0 ? `<br><span class="dim">Jump Start keeps ${fmt(kept)} W</span>` : ''}</p>
      <div class="row2" style="margin-top:14px">
        <button class="bigbtn" id="mYes">CONFIRM</button>
        <button class="smbtn" id="mNo">CANCEL</button>
      </div>`);
    document.getElementById('mYes').addEventListener('click', () => {
      state = Object.assign(defaultState(), carryState({
        cores: (state.cores || 0) + gain,
        coresEarned: (state.coresEarned || 0) + gain,
      }));
      state.challengeBackup = { grid: null, volt: null };   // recycling clears challenges; no run to restore
      state.watts = kept;
      buffs = [];
      syncBoostBuff();
      syncStreakBuff();
      applyRunStartPerks();
      save();
      hideModal();
      blip(220, 0.3, 'sawtooth', 0.06);
      buzz([0, 40, 60, 40, 60, 80]);
      screenShake(1.5);
      toast(`♻ Empire recycled. +${gain} cores`, true);
      checkAchievements();
      renderAll();
    });
    document.getElementById('mNo').addEventListener('click', hideModal);
  }

  /* ---------- Reincarnation (Storm Reactor) ---------- */
  // The Voltlands prestige: reset ONLY the slayer run for Storm Shards. Mutates
  // the slayer in place (never Object.assign(defaultSlayer())) so Grid state and
  // the keep-list — totalVolts/kills/bosses/shards/shardsEarned/shardUpgrades —
  // are guaranteed untouched. Grid state is never read or written here.
  function reincarnate() {
    const gain = reincarnateGain();
    if (gain <= 0) { toast('Slay more before reincarnating'); return; }
    const s = sl();
    s.shards += gain;
    s.shardsEarned += gain;
    // Reset only the per-run fields.
    s.volts = 0;
    s.runVolts = 0;
    s.wave = 1;
    s.killsThisWave = 0;
    s.weapons = {};
    s.upgrades = {};
    s.zaps = 0;   // zap milestones are per-run, like Grid tap milestones reset on prestige
    // Surge Grid: the run boundary IS the free respec — wipe spent charges and the
    // node allocation; lifetime surgeChargesEarned is kept (drives permanent bonuses).
    s.surgeCharges = 0;
    s.surgeNodes = {};
    s.surgeBranch = '';
    s.dischargeCd = 0;
    state.challenges.volt = '';   // reincarnation clears the active volt challenge
    if (state.challengeBackup) state.challengeBackup.volt = null;   // no run to restore — reincarnation already reset it
    applyReincarnatePerks();
    spawnEnemy();
    checkAchievements();
    save();
    blip(220, 0.3, 'sawtooth', 0.06);
    buzz([0, 40, 60, 40, 60, 80]);
    screenShake(1.5);
    toast(`💠 Reincarnated. +${gain} shards`, true);
    renderAll();
  }
  function confirmReincarnate() {
    const gain = reincarnateGain();
    if (gain <= 0) { toast('Slay more before reincarnating'); return; }
    const newPct = Math.round((shardMultFor((sl().shardsEarned || 0) + gain) - 1) * 100);
    showModal(`
      <h2 class="danger">💠 REINCARNATE?</h2>
      <p class="dim">Reset volts, weapons &amp; zap upgrades.<br>Shards, storm upgrades &amp; kills are kept.${(state.challenges && state.challenges.volt) ? '<br><b>Abandons the active challenge!</b>' : ''}</p>
      <p class="big">+${fmt(gain)} 💠 Shards</p>
      <p>New bonus: <b style="color:var(--green)">+${newPct}%</b></p>
      <div class="row2" style="margin-top:14px">
        <button class="bigbtn" id="mYes">CONFIRM</button>
        <button class="smbtn" id="mNo">CANCEL</button>
      </div>`);
    document.getElementById('mYes').addEventListener('click', () => { hideModal(); reincarnate(); });
    document.getElementById('mNo').addEventListener('click', hideModal);
  }

  /* ---------- Challenges ---------- */
  // Reset only the slayer run fields (no shards awarded) — the volt analog of a
  // fresh grid run, used when starting a Voltlands challenge.
  function resetSlayerRun() {
    const s = sl();
    s.volts = 0;
    s.runVolts = 0;
    s.wave = 1;
    s.killsThisWave = 0;
    s.weapons = {};
    s.upgrades = {};
    s.zaps = 0;
    applyReincarnatePerks();
    spawnEnemy();
  }

  // Restore the run that was snapshotted when a challenge started, so finishing or
  // abandoning a challenge drops the player back exactly where they were instead of
  // wiping everything they owned. Grid and volt keep different run-scoped fields.
  function restoreChallengeBackup(w) {
    const b = state.challengeBackup && state.challengeBackup[w];
    if (!b) return false;
    if (w === 'grid') {
      state.watts = b.watts || 0;
      state.totalEarned = b.totalEarned || 0;
      state.clicks = b.clicks || 0;
      state.owned = b.owned || {};
      state.upgrades = b.upgrades || {};
      if (b.bulk != null) state.bulk = b.bulk;
      buffs = [];
      syncBoostBuff();
      syncStreakBuff();
      applyRunStartPerks();
    } else {
      const s = sl();
      s.volts = b.volts || 0;
      s.runVolts = b.runVolts || 0;
      s.wave = b.wave || 1;
      s.killsThisWave = b.killsThisWave || 0;
      s.weapons = b.weapons || {};
      s.upgrades = b.upgrades || {};
      s.zaps = b.zaps || 0;
      applyReincarnatePerks();
      spawnEnemy();
    }
    state.challengeBackup[w] = null;
    return true;
  }

  // Begin a challenge: snapshot the current run, reset it for a clean attempt, and
  // seed the softlock-avoidance starter. Split out of startChallenge so the reset
  // is testable without driving the confirm modal.
  function beginChallenge(c) {
    const w = c.world || 'grid';
    if (!state.challengeBackup) state.challengeBackup = { grid: null, volt: null };
    if (w === 'volt') {
      const s = sl();
      const snap = {
        volts: s.volts, runVolts: s.runVolts, wave: s.wave, killsThisWave: s.killsThisWave,
        weapons: { ...s.weapons }, upgrades: { ...s.upgrades }, zaps: s.zaps,
      };
      state.challenges.volt = c.id;
      resetSlayerRun();
      state.challengeBackup.volt = snap;
      // NUMB FINGERS disables tap-zapping entirely — without a starter weapon the
      // run could never deal its first damage (softlock).
      if (c.id === 'numbfingers') sl().weapons.glove = Math.max(sl().weapons.glove || 0, 1);
    } else {
      const snap = {
        watts: state.watts, totalEarned: state.totalEarned, clicks: state.clicks,
        owned: { ...state.owned }, upgrades: { ...state.upgrades }, bulk: state.bulk,
      };
      state = Object.assign(defaultState(), carryState());
      state.challenges.grid = c.id;
      if (!state.challengeBackup) state.challengeBackup = { grid: null, volt: null };
      state.challengeBackup.grid = snap;
      buffs = [];
      syncBoostBuff();
      syncStreakBuff();
      applyRunStartPerks();
      // UNPLUGGED disables tapping entirely — without a starter cord the run
      // could never earn its first watt (softlock).
      if (c.id === 'unplugged') state.owned.usba = Math.max(state.owned.usba || 0, 1);
    }
  }

  function startChallenge(c) {
    const w = c.world || 'grid';
    if (ch(w)) { toast('Finish or abandon the current challenge first'); return; }
    const goalUnit = w === 'volt' ? 'V' : 'W';
    showModal(`
      <h2>${c.icon} ${c.name}</h2>
      <p class="dim">${c.rule}</p>
      <p>Goal: earn <b style="color:var(--amber)">${fmt(chGoalFor(c))} ${goalUnit}</b> in one run${chMaxTier(c) > 1 ? ` · tier ${Math.min(chTier(c.id) + 1, chMaxTier(c))}/${chMaxTier(c)}` : ''}</p>
      <p class="dim">Starts a separate attempt run — your current progress is saved and restored when you finish or abandon. The challenge run grants no ${w === 'volt' ? 'shards' : 'cores'}.<br>Reward: ${c.reward}</p>
      <div class="row2" style="margin-top:14px">
        <button class="bigbtn" id="mYes">START</button>
        <button class="smbtn" id="mNo">CANCEL</button>
      </div>`);
    document.getElementById('mYes').addEventListener('click', () => {
      beginChallenge(c);
      save();
      hideModal();
      blip(700, 0.16, 'sawtooth', 0.05);
      toast(`${c.icon} ${c.name} — GO!`, true);
      renderAll();
    });
    document.getElementById('mNo').addEventListener('click', hideModal);
  }

  function abandonChallenge() {
    const w = activeWorld();
    if (!ch(w)) return;
    state.challenges[w] = '';
    restoreChallengeBackup(w);   // drop back to the pre-challenge run
    toast('Challenge abandoned — your run was restored');
    save();
    renderAll();
  }

  // Called each tick: lifts the active challenge for the current world and grants
  // the permanent perk on success. Volt goals compare runVolts; grid goals compare
  // totalEarned. Both worlds always tick, so check each independently.
  function checkChallenge() {
    for (const w of ['grid', 'volt']) {
      const id = ch(w);
      if (!id) continue;
      const c = CHALLENGES.find((x) => x.id === id);
      if (!c) continue;
      const progress = w === 'volt' ? (sl().runVolts || 0) : state.totalEarned;
      if (progress < chGoalFor(c)) continue;
      const newTier = chTier(c.id) + 1;
      state.challengesDone[c.id] = newTier;
      state.challenges[w] = '';
      restoreChallengeBackup(w);   // perk is permanent; the run returns to pre-challenge
      toast(`${c.icon} ${c.name} TIER ${newTier}/${chMaxTier(c)}! ${c.reward.split(' — ')[0]}${newTier >= chMaxTier(c) ? ' — MAXED' : ' — next ×8 harder'}`, true);
      blip(1320, 0.2, 'triangle', 0.06);
      buzz([0, 30, 50, 30, 50, 60]);
      screenShake(1.2);
      checkAchievements();
      save();
      renderAll();
    }
  }

  function renderChallenges() {
    const block = document.getElementById('challengeBlock');
    if (!block) return;
    // World-scoped: grid unlocks after the first prestige, volt after the first
    // reincarnation; each world shows only its own challenge set.
    const world = activeWorld();
    const unit = world === 'volt' ? 'V' : 'W';
    const unlocked = world === 'volt'
      ? (sl().shardsEarned || 0) >= 1 || CHALLENGES.some((c) => c.world === 'volt' && chDone(c.id))
      : (state.coresEarned || 0) >= 1 || CHALLENGES.some((c) => c.world === 'grid' && chDone(c.id));
    block.hidden = !unlocked;
    if (!unlocked) return;
    const set = CHALLENGES.filter((c) => (c.world || 'grid') === world);
    const active = set.find((c) => c.id === ch(world));
    const ca = document.getElementById('chActive');
    if (ca) {
      ca.hidden = !active;
      if (active) {
        ca.innerHTML = `<p>${active.icon} <b class="hi">${active.name}</b> in progress — earn ${fmt(chGoalFor(active))} ${unit} this run.</p>
          <button class="smbtn danger" id="chAbandon" style="width:100%">ABANDON CHALLENGE</button>`;
      }
    }
    const list = document.getElementById('chlist');
    if (list) {
      list.innerHTML = set.map((c) => {
        const done = chFullyDone(c);
        const isActive = !!active && active.id === c.id;
        const cls = done ? 'bought' : active ? 'no' : 'ok';
        return `
          <button class="upg ${cls}" data-ch="${c.id}" ${done || active ? 'disabled' : ''}>
            <div class="un">${c.icon} ${c.name}</div>
            <div class="ud">${c.rule}<br>Goal: ${fmt(chGoalFor(c))} ${unit}${chMaxTier(c) > 1 ? ' · tier ' + Math.min(chTier(c.id) + 1, chMaxTier(c)) + '/' + chMaxTier(c) : ''} · ${c.reward}</div>
            <div class="uc">${done ? '✓ MAXED' : isActive ? 'In progress…' : (chTier(c.id) > 0 ? 'NEXT TIER ▸' : 'START')}</div>
          </button>`;
      }).join('');
    }
  }

  /* ---------- Daily streak (48h forgiveness — miss one day, keep the streak) ---------- */
  function streakMult() { return 1 + 0.05 * Math.min(state.streak || 0, 10); }
  function syncStreakBuff() {
    buffs = buffs.filter((b) => b.src !== 'streak');
    if ((state.streakUntil || 0) > Date.now() && (state.streak || 0) > 0) {
      buffs.push({ kind: 'prod', mult: streakMult(), until: state.streakUntil, icon: '🔥', label: `STREAK ×${streakMult().toFixed(2)}`, src: 'streak' });
    }
    renderBuffs();
  }
  function claimDailyStreak() {
    const today = localDay();
    if (state.streakDay === today) { syncStreakBuff(); return; }   // already claimed today
    const now = Date.now();
    const kept = state.streakAt && now - state.streakAt <= 48 * 3600000;
    state.streak = kept ? (state.streak || 0) + 1 : 1;
    state.streakAt = now;
    state.streakDay = today;
    state.streakUntil = now + 30 * 60000;
    syncStreakBuff();
    toast(`🔥 DAY ${state.streak} STREAK · production ×${streakMult().toFixed(2)} for 30m`, true);
    checkAchievements();
    save();
  }

  /* ---------- The Voltlands: slayer logic ---------- */
  const sl = () => state.slayer;
  const zu = (id) => !!(state.slayer && state.slayer.upgrades[id]);
  const isBossWave = (w) => w % 10 === 0;

  function enemyFor(wave) {
    if (isBossWave(wave)) return BOSSES[(wave / 10 - 1) % BOSSES.length];
    return ENEMIES[(wave - 1) % ENEMIES.length];
  }
  function zoneFor(wave) {
    const idx = Math.floor((wave - 1) / 10);
    const cycle = Math.floor(idx / ZONES.length);
    return ZONES[idx % ZONES.length] + (cycle > 0 ? ` ${cycle + 1}` : '');
  }
  function enemyHp(wave) {
    const boss = isBossWave(wave);
    const sudden = boss && ch('volt') === 'suddendeath' ? 3 : 1;   // SUDDEN DEATH rule
    const glass = ch('volt') === 'glasscannon' ? 2 : 1;   // GLASS CANNON rule
    return 10 * Math.pow(1.22, wave - 1) * (boss ? 10 : 1) * sudden * glass;
  }
  function voltReward(wave) {
    const boss = isBossWave(wave);
    const slayerBonus = boss && chDone('suddendeath') ? 2 : 1;     // GIANT SLAYER perk
    // Reward tracks enemy HP growth (both 1.22^wave) so volt income per ZPS is
    // FLAT across waves instead of decaying. Base 2.6 (vs HP base 10) sets a
    // normal wave's volts/sec at ~0.26× the same-production grid watts/sec — the
    // base-1.3 (~5× slower) tuning felt too slow, so rewards were doubled to 2.6
    // (~2.5× slower than the original base of 8). Income is the pacing dial (cost
    // growth is too weak); the full-share Auto-Zapper's +25% ZPS aids active play.
    return 2.6 * Math.pow(1.22, wave - 1) * (boss ? 12 : 1) * slayerBonus * surgeVoltMult();
  }

  // ---- cross-world synergy ----
  // Volt->Grid: every boss killed is a permanent +2% watts production.
  function bossWattsMult() { return 1 + 0.02 * ((state.slayer && state.slayer.bosses) || 0); }
  // Grid->Volt: +1% ZPS per order of magnitude of watts EVER generated.
  function gridZpsBoost() { return 1 + 0.01 * Math.log10(1 + (state.lifetimeEarned || 0)); }

  // ---- Surge Grid multipliers ----
  // Fold owned research nodes into the combat chains. Each returns its no-op base
  // when nothing is specced, so an empty tree is byte-identical to old behaviour.
  function surgeEffProduct(key, base) { let m = base; const o = sl().surgeNodes || {}; for (const n of SURGE_NODES) if (o[n.id] && n.eff && n.eff[key] != null) m *= n.eff[key]; return m; }
  function surgeEffSum(key, base) { let s = base; const o = sl().surgeNodes || {}; for (const n of SURGE_NODES) if (o[n.id] && n.eff && n.eff[key] != null) s += n.eff[key]; return s; }
  function surgeZpsMult()    { return surgeEffProduct('zps', 1); }
  function surgeTapMult()    { return surgeEffProduct('tap', 1); }
  function surgeAutoRate()   { return surgeEffProduct('autoRate', 1); }
  function surgeVoltMult()   { return surgeEffProduct('volt', 1); }
  function surgeShardMult()  { return surgeEffProduct('shard', 1); }   // Surge-Grid shard-gain bonus (distinct from shardMult, the lifetime-shard ZPS bonus)
  function surgeCritChance() { return Math.min(1, surgeEffSum('critChance', 0.10)); }   // base 10% (matches the old z_crit hardcode)
  function surgeCritMult()   { return surgeEffProduct('critMult', 10); }                // base ×10

  function weaponMultiplier(weaponId) {
    let m = 1;
    for (const u of ZAP_UPGRADES) {
      if (!sl().upgrades[u.id]) continue;
      if (u.kind === 'weapon' && u.weapon === weaponId) m *= u.mult;
      if (u.kind === 'zglobal') m *= u.mult;
    }
    if (su('conduction')) m *= 1.5;   // Storm Upgrade: all weapons ×1.5
    if (weaponId === 'glove' && chDone('bareknuckle')) m *= 5;   // KNUCKLE BUSTER perk
    return m * cordMilestoneMult(sl().weapons[weaponId] || 0);   // same x2-per-25 milestones
  }
  function totalZps() {
    let sum = 0;
    for (const w of WEAPONS) sum += (sl().weapons[w.id] || 0) * w.zps * weaponMultiplier(w.id);
    const cling = ch('volt') === 'staticcling' ? 0.5 : 1;   // STATIC CLING rule
    // iapProdMult (Overclock +25% MTX) and buffMult('prod') (×2 ad/supporter
    // boost) both apply here too, so production purchases & ad boosts lift the
    // Voltlands exactly like they lift the Grid.
    return sum * gridZpsBoost() * iapProdMult() * achMult() * buffMult('prod') * shardMult() * (su('overvolt') ? 2 : 1) * surgeZpsMult() * stormZpsMult() * cling;
  }
  // Zaps also deal a % of your current Z/s (the Voltlands mirror of tapWpsFrac),
  // so tapping scales with your DPS forever instead of staying a flat pittance.
  function zapZpsFrac() {
    let f = 0;
    for (const u of ZAP_UPGRADES) if (sl().upgrades[u.id] && u.kind === 'zapzps') f += u.frac;
    return f;
  }
  function zapPower() {
    if (ch('volt') === 'numbfingers') return 0;   // NUMB FINGERS rule
    let p = 1;
    for (const u of ZAP_UPGRADES) if (sl().upgrades[u.id] && u.kind === 'zap') p *= u.mult;
    if (su('livewire')) p *= 3;   // Storm Upgrade: tap-zap power ×3
    if (ch('volt') === 'glasscannon') p *= 5;   // GLASS CANNON rule
    if (chDone('glasscannon')) p *= 2;           // OVERLOAD perk
    // Flat tap-zap power — everything except the "% of Z/s" share. Mirrors the
    // Grid's clickPower shape: (flat + share) × click buffs.
    const flat = p * gridZpsBoost() * achMult() * surgeTapMult() * stormTapMult() * zapMilestoneMult();
    // The "% of Z/s" share (zapZpsFrac upgrades). Deliberately NOT scaled by the
    // flat zap mults/milestones, so the full-share Auto-Zapper stays a predictable
    // +N% of ZPS — leaner than the Grid, where clickMult amplifies its W/s share.
    const fromZps = zapZpsFrac() * totalZps();
    return (flat + fromZps) * buffMult('click');
  }
  function weaponCostGrowth() { return ch('volt') === 'powerdrain' ? 1.18 : VOLT_COST_GROWTH; }   // POWER DRAIN rule; base 1.14 paces World 2 ~0.8× the Grid
  function weaponCostDiscount() { return chDone('powerdrain') ? 0.97 : 1; }   // SURPLUS perk
  function weaponCost(w, count) {
    const owned = sl().weapons[w.id] || 0;
    const r = weaponCostGrowth();
    let total = 0;
    for (let i = 0; i < count; i++) total += w.baseCost * Math.pow(r, owned + i);
    return Math.ceil(total * weaponCostDiscount());
  }
  // Voltlands mirrors of maxAffordable/buyCount (the Grid bulk-buy helpers): the
  // ×1/×5/×10/MAX bar shares the global state.bulk, so weapons buy in bulk too.
  function maxAffordableWeapon(w) {
    const owned = sl().weapons[w.id] || 0;
    const r = weaponCostGrowth();
    // Mirror maxAffordable: solve off the undiscounted base so the estimate stays
    // conservative (a MAX buy never rounds up past what the player can afford).
    const base = w.baseCost * Math.pow(r, owned);
    const v = sl().volts;
    const k = Math.floor(Math.log((v * (r - 1)) / base + 1) / Math.log(r));
    return Math.max(0, isFinite(k) ? k : 0);
  }
  function weaponBuyCount(w) {
    if (state.bulk === 'max') return Math.max(1, maxAffordableWeapon(w));
    return state.bulk;
  }
  function zapUpgradeUnlocked(u) {
    if (!u.req) return true;
    return (sl().weapons[u.req.weapon] || 0) >= u.req.n;
  }

  function spawnEnemy() {
    sl().maxHp = enemyHp(sl().wave);
    sl().hp = sl().maxHp;
  }

  function killEnemy() {
    const s = sl();
    const boss = isBossWave(s.wave);
    const reward = voltReward(s.wave);
    s.volts += reward;
    s.totalVolts += reward;
    s.runVolts += reward;
    s.kills++;
    s.killsThisWave++;
    // Surge Grid currency: combat mints Surge Charges (flat per kill, deliberately
    // un-inflated like AD Time Theorems) — bosses are worth 5×. Minted at 1/10th of a
    // whole charge per kill so the Surge Grid paces ~10× slower than the raw kill
    // count; fmtInt floors the fractional balance, so counts still read as integers.
    let surge = boss ? 0.5 : 0.1;
    if (chDone('surgefamine')) surge *= 2;          // SURGE SURPLUS perk
    if (ch('volt') === 'surgefamine') surge = 0;    // SURGE FAMINE rule: no charges this run
    s.surgeCharges += surge;
    s.surgeChargesEarned += surge;
    if (boss) {
      s.bosses++;
      toast(`💀 ${enemyFor(s.wave).name} DOWN! Grid power +2% (now +${s.bosses * 2}%)`, true);
      blip(220, 0.3, 'sawtooth', 0.06);
      buzz([0, 40, 60, 40]);
      screenShake(1.5);
    }
    const needed = boss ? 1 : 10;
    if (s.killsThisWave >= needed) {
      s.killsThisWave = 0;
      s.wave++;
      if ((s.wave - 1) % 10 === 0 && s.wave > 1) toast(`🗺️ ${zoneFor(s.wave)} — wave ${s.wave}`, true);
    }
    checkAchievements();
  }

  // Damage application with overkill carry. Kills per call are capped so a huge
  // ZPS spike can't lock the loop — but the cap must scale with how much time the
  // call represents, or a coarse tick (e.g. the 1Hz background sim) would credit
  // far fewer kills than the same span of fine 10Hz ticks. The wave-climb makes
  // the loop self-terminate well before the cap in normal play; it's just a
  // backstop against a pathological one-shot-everything spike.
  function applyZapDamage(dmg, maxKills = 50) {
    const s = sl();
    if (s.maxHp <= 0) spawnEnemy();
    s.hp -= dmg;
    let safety = maxKills;
    while (s.hp <= 0 && safety-- > 0) {
      const leftover = -s.hp;
      killEnemy();
      spawnEnemy();
      s.hp = s.maxHp - leftover;
    }
    if (s.hp <= 0) s.hp = 1;   // floor after the per-call kill cap
  }

  // ---- Discharge: an active burst ability (unlocked by a Storm Upgrade) ----
  // Tap to dump a chunk of ZPS in one hit on a cooldown; the Auto-Discharge upgrade
  // fires it for you. Routed through the capped applyZapDamage so it can't balloon.
  const DISCHARGE_CD = 20;       // cooldown, seconds
  const DISCHARGE_BURST = 15;    // dumps ~15s of ZPS in one hit
  function dischargeReady() { return su('discharge') && (sl().dischargeCd || 0) <= 0; }
  function fireDischarge(silent) {
    if (!dischargeReady()) { if (!silent) { toast(su('discharge') ? 'Discharge is charging…' : 'Unlock Discharge first'); blip(120, 0.06); } return; }
    applyZapDamage(totalZps() * DISCHARGE_BURST + zapPower() * 20, 5000);
    sl().dischargeCd = DISCHARGE_CD;
    if (!silent) { blip(1400, 0.25, 'sawtooth', 0.07); buzz([0, 60, 80, 60, 100]); screenShake(2); toast('⚡ DISCHARGE!', true); }
    renderSlayerLite();
  }
  let zapAutoAccum = 0;   // fractional auto-zaps carried between ticks (feeds zap milestones)
  function slayerTick(dt) {
    if (!state.wormhole) return;
    const zps = totalZps();
    // Scale the kill cap with dt (50 per 0.1s) so one 1s background tick credits
    // the same as ten 0.1s foreground ticks — no Voltlands under-credit when the
    // sim is throttled in the background.
    const cap = Math.max(50, Math.ceil(500 * dt));
    if (zps > 0) applyZapDamage(zps * dt, cap);
    // AUTO-ZAPPER: passive tap-zaps at a fixed rate, gated by its per-world
    // Settings toggle. Granted by the Auto-Zapper Storm Upgrade OR the STATIC
    // CLING perk (STATIC FIELD). Silent — no floats/sound, just damage.
    if ((su('autozap') || chDone('staticcling')) && state.settings.world.volt.autoclickOn) {
      const rate = AUTO_ZAP_RATE * surgeAutoRate();   // auto tap-zaps per second
      applyZapDamage(zapPower() * rate * dt, cap);
      zapAutoAccum += rate * dt;                       // auto-zaps count toward milestones too
      const whole = Math.floor(zapAutoAccum);
      // Flash the enemy as each whole auto-zap lands (~5/s at the 10Hz tick) —
      // the Voltlands mirror of the Grid Auto-Tapper's per-fire socket pulse.
      if (whole > 0) { zapAutoAccum -= whole; awardZaps(whole); pulseAutoZap(); }
    }
    // DISCHARGE: cooldown ticks down; Auto-Discharge fires it the moment it's ready.
    if (su('discharge') && (sl().dischargeCd || 0) > 0) sl().dischargeCd = Math.max(0, sl().dischargeCd - dt);
    if (su('autodischarge') && dischargeReady()) fireDischarge(true);
  }

  function zapEnemy() {
    let dmg = zapPower();
    let crit = false;
    // Crit is enabled by the z_crit zap upgrade OR the Surge Grid crit path; the
    // chance/multiplier read from the Surge helpers (base 10% / ×10 when un-specced).
    const critOn = zu('z_crit') || sl().surgeBranch === 'crit';
    if (critOn && Math.random() < surgeCritChance()) { dmg *= surgeCritMult(); crit = true; }
    applyZapDamage(dmg);
    awardZaps(1);   // hand tap-zap counts toward zap milestones
    if (state.settings.floats) {
      const anchor = tapAnchor();   // the visible zap control (big button, compact bar, or mini bar)
      const r = anchor.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'float' + (crit ? ' crit' : '');
      f.textContent = (crit ? '💥' : '⚡') + fmt(dmg);
      f.style.left = (r.left + r.width / 2 - 20 + (Math.random() * 60 - 30)) + 'px';
      f.style.top = (r.top + 30) + 'px';
      el.floaters.appendChild(f);
      setTimeout(() => f.remove(), 1000);
      if (el.enemyBtn) {
        el.enemyBtn.classList.remove('zapped');
        void el.enemyBtn.offsetWidth;
        el.enemyBtn.classList.add('zapped');
      }
    }
    blip(crit ? 1500 : 900 + Math.random() * 100, 0.05, 'sawtooth', 0.05);
    buzz(crit ? [0, 30, 30, 30] : 8);
    renderSlayerLite();
  }

  function buyWeapon(w) {
    if (ch('volt') === 'bareknuckle' && w.id !== 'glove') { toast('🔒 BARE KNUCKLES: Static Glove only'); blip(120, 0.06); return; }
    const count = weaponBuyCount(w);
    if (count <= 0) return;
    const cost = weaponCost(w, count);
    if (sl().volts < cost) { toast('Not enough volts'); blip(120, 0.06); return; }
    const before = sl().weapons[w.id] || 0;
    sl().volts -= cost;
    const after = before + count;
    sl().weapons[w.id] = after;
    blip(320, 0.06, 'square', 0.05);
    buzz(12);
    // Celebrate crossing an ownership milestone (×2, or ×10 at every 100) — same
    // crossing test as buyCord so bulk buys that jump a milestone still fire.
    if (Math.floor(after / CORD_MILESTONE) > Math.floor(before / CORD_MILESTONE)) {
      const tier = cordMilestoneMult(after);
      const big = Math.floor(after / BIG_MILESTONE) > Math.floor(before / BIG_MILESTONE);
      toast(`✖️ ${w.name} ${big ? 'MEGA milestone! ×10 ·' : 'milestone!'} Now ×${fmt(tier)}`, true);
      blip(990, 0.18, 'sawtooth', 0.05);
      buzz([0, 25, 40, 25]);
      screenShake(1);
    }
    checkAchievements();
    updateWeapons();
    renderSlayerLite();
  }

  function buyZapUpgrade(u) {
    if (ch('volt') === 'notools') { toast('🔒 NO TOOLS: no zap upgrades'); blip(120, 0.06); return; }
    if (sl().upgrades[u.id]) return;
    if (sl().volts < u.cost) { toast('Not enough volts'); blip(120, 0.06); return; }
    sl().volts -= u.cost;
    sl().upgrades[u.id] = true;
    blip(880, 0.12, 'sawtooth', 0.05);
    buzz([0, 15, 30, 15]);
    toast('⚡ ' + u.name + ' wired in!');
    updateWeapons();
    updateZapUpgrades();
    renderSlayerLite();
  }

  /* ---------- Voltlands rendering ---------- */
  // A weapon shows once the previous one is owned (or it's the first) — mirrors
  // visibleCords() so the Voltlands shop unlocks progressively like the Grid.
  function visibleWeapons() {
    return WEAPONS.filter((w, i) => {
      const owned = sl().weapons[w.id] || 0;
      const prevOwned = i === 0 ? 1 : (sl().weapons[WEAPONS[i - 1].id] || 0);
      return owned > 0 || prevOwned > 0;
    });
  }

  // Two-tier render, exactly like the Grid cord shop: renderWeapons() does the
  // full rebuild (only when the visible set / bulk changes), updateWeapons()
  // patches text+classes in place each tick so a rebuild never eats a mid-press
  // tap (the auto-arsenal dirties affordability up to 10×/sec).
  let weaponStructKey = '';
  let weaponNodes = [];
  function renderWeapons() {
    if (!el.weaponlist) return;
    // Bulk-buy buttons live in the sticky toolbar (#bulkBarZap), sharing the
    // global state.bulk with the Grid bar.
    if (el.bulkBarZap) {
      el.bulkBarZap.innerHTML = [1, 5, 10, 'max'].map(b =>
        `<button class="bulk-btn ${state.bulk === b ? 'active' : ''}" data-bulk="${b}">${b === 'max' ? 'MAX' : 'x' + b}</button>`
      ).join('');
    }
    let html = '';
    const vis = visibleWeapons();
    vis.forEach((w) => {
      const owned = sl().weapons[w.id] || 0;
      const count = weaponBuyCount(w);
      const cost = weaponCost(w, count);
      const can = sl().volts >= cost;
      const each = w.zps * weaponMultiplier(w.id) * gridZpsBoost();
      // Ownership milestones (same ×2-per-25 / ×10-per-100 as cords) — show the
      // next-milestone progress bar like cord cards. Display only; no math change.
      const nextMs = (Math.floor(owned / CORD_MILESTONE) + 1) * CORD_MILESTONE;
      const nextMult = nextMs % BIG_MILESTONE === 0 ? BIG_MILESTONE_MULT : 2;
      const msPct = (owned % CORD_MILESTONE) / CORD_MILESTONE * 100;
      html += `
        <button class="card buyable" data-weapon="${w.id}">
          <div class="ico">${w.icon}</div>
          <div class="body">
            <div class="nm">${w.name}</div>
            <div class="meta"><span class="pos">${fmt(each)} Z/s each</span><span class="flavor"> · ${w.desc}</span></div>
            <div class="milestone"><i style="width:${msPct}%"></i></div>
          </div>
          <div class="right">
            <div class="owned">own ${fmt(owned)}</div>
            <div class="cost ${can ? 'ok' : 'no'}">${fmt(cost)} V</div>
            <div class="mnote">${owned > 0 ? `×${nextMult} @ ${fmt(nextMs)}` : '&nbsp;'}</div>
          </div>
        </button>`;
    });
    if (!vis.length) html = `<p class="empty-note">Zap enemies to earn your first volts!</p>`;
    el.weaponlist.innerHTML = html;
    weaponStructKey = state.bulk + '|' + vis.map((w) => w.id).join(',');
    weaponNodes = Array.from(el.weaponlist.querySelectorAll('[data-weapon]') || []).map((node) => ({
      node,
      owned: node.querySelector('.owned'),
      cost: node.querySelector('.cost'),
      mnote: node.querySelector('.mnote'),
      pos: node.querySelector('.pos'),
      ms: node.querySelector('.milestone i'),
      meta: node.querySelector('.meta'),
      flavor: node.querySelector('.flavor'),
      _lastPos: '',
    }));
    for (const n of weaponNodes) { n._lastPos = n.pos ? n.pos.textContent : ''; fitFlavor(n); }
  }

  function updateWeapons() {
    if (!el.weaponlist) return;
    const vis = visibleWeapons();
    const key = state.bulk + '|' + vis.map((w) => w.id).join(',');
    if (key !== weaponStructKey || weaponNodes.length !== vis.length ||
        (weaponNodes[0] && !weaponNodes[0].node.isConnected)) { renderWeapons(); return; }
    vis.forEach((w, i) => {
      const n = weaponNodes[i];
      const owned = sl().weapons[w.id] || 0;
      const cost = weaponCost(w, weaponBuyCount(w));
      n.owned.textContent = 'own ' + fmt(owned);
      n.cost.textContent = fmt(cost) + ' V';
      n.cost.className = 'cost ' + (sl().volts >= cost ? 'ok' : 'no');
      const each = w.zps * weaponMultiplier(w.id) * gridZpsBoost();
      const posTxt = `${fmt(each)} Z/s each`;
      if (n.pos && n._lastPos !== posTxt) { n.pos.textContent = posTxt; n._lastPos = posTxt; fitFlavor(n); }
      const nextMs = (Math.floor(owned / CORD_MILESTONE) + 1) * CORD_MILESTONE;
      const nextMult = nextMs % BIG_MILESTONE === 0 ? BIG_MILESTONE_MULT : 2;
      if (n.ms) n.ms.style.width = ((owned % CORD_MILESTONE) / CORD_MILESTONE * 100) + '%';
      n.mnote.textContent = owned > 0 ? `×${nextMult} @ ${fmt(nextMs)}` : ' ';
    });
  }

  // Mirror of unlockedUpgrades()/renderUpgrades()/updateUpgrades() for the
  // Voltlands zap-upgrade shop: full rebuild only on struct change, cheap
  // per-tick patch otherwise (so the tap path doesn't destroy a mid-press button).
  function unlockedZapUpgrades() {
    return ZAP_UPGRADES
      .filter((u) => sl().upgrades[u.id] || zapUpgradeUnlocked(u))
      .sort((a, b) => a.cost - b.cost);
  }
  let zupStructKey = '';
  let zupNodes = [];
  function renderZapUpgrades() {
    if (!el.zuplist) return;
    const list = unlockedZapUpgrades();
    if (!list.length) {
      el.zuplist.innerHTML = `<p class="empty-note">Buy more weapons to unlock upgrades…</p>`;
      zupStructKey = ''; zupNodes = [];
      return;
    }
    el.zuplist.innerHTML = list.map((u) => {
      const bought = !!sl().upgrades[u.id];
      const can = !bought && sl().volts >= u.cost;
      const cls = bought ? 'bought' : can ? 'ok' : 'no';
      return `
        <button class="upg ${cls}" data-zupgrade="${u.id}">
          <div class="un">${u.icon} ${u.name}</div>
          <div class="ud">${u.desc}</div>
          <div class="uc">${bought ? '✓ OWNED' : fmt(u.cost) + ' V'}</div>
        </button>`;
    }).join('');
    zupStructKey = list.map((u) => u.id).join(',');
    zupNodes = Array.from(el.zuplist.querySelectorAll('[data-zupgrade]') || []).map((node) => ({
      node, uc: node.querySelector('.uc'),
    }));
  }

  function updateZapUpgrades() {
    if (!el.zuplist) return;
    const list = unlockedZapUpgrades();
    if (!list.length) { if (zupStructKey) renderZapUpgrades(); return; }
    const key = list.map((u) => u.id).join(',');
    if (key !== zupStructKey || zupNodes.length !== list.length ||
        (zupNodes[0] && !zupNodes[0].node.isConnected)) { renderZapUpgrades(); return; }
    list.forEach((u, i) => {
      const n = zupNodes[i];
      const bought = !!sl().upgrades[u.id];
      const can = !bought && sl().volts >= u.cost;
      n.node.className = 'upg ' + (bought ? 'bought' : can ? 'ok' : 'no');
      n.uc.textContent = bought ? '✓ OWNED' : fmt(u.cost) + ' V';
    });
  }

  // ---- Surge Grid shop (two-tier render, mirrors renderZapUpgrades) ----
  // The tree renders as a vertical SPINE: the linear trunk, a three-way FORK
  // choice, then the chosen branch continues as its own accented spine while the
  // two paths not taken collapse into a footer. renderSurgeTree() rebuilds the
  // structure (only on a buy / branch-commit / reveal); updateSurgeTree() patches
  // cost + affordability per tick WITHOUT a rebuild (a rebuild would eat taps).
  function visibleSurgeNodes() { return SURGE_NODES.filter((n) => !n.req || sg(n.id) || sg(n.req)); }
  function surgeCardUc(n) {
    if (sg(n.id)) return '✓';
    if (!surgeNodeUnlocked(n)) return '🔒';
    return fmt(n.cost) + ' ⚡';
  }
  function applySurgeState(node, n) {
    const cls = sg(n.id) ? 'is-owned'
      : !surgeNodeUnlocked(n) ? 'is-locked'
      : (sl().surgeCharges || 0) >= n.cost ? 'is-affordable' : 'is-unaffordable';
    node.classList.remove('is-owned', 'is-locked', 'is-affordable', 'is-unaffordable');
    node.classList.add(cls);
  }
  // struct signature: visible set + per-node owned flag + chosen branch. Changes
  // only on a buy / reveal / branch-commit (NOT on affordability), so the per-tick
  // updater patches in place and only rebuilds when the layout actually changes.
  function surgeStructSig(list) { return list.map((n) => (sg(n.id) ? 'b' : '') + n.id).join(',') + '|' + sl().surgeBranch; }
  function surgeNodeHtml(n) {
    return '<button class="sg-node" data-surge="' + n.id + '">'
      + '<span class="sg-ico">' + n.icon + '</span>'
      + '<span class="sg-txt"><span class="sg-nm">' + n.name + '</span><span class="sg-dsc">' + n.desc + '</span></span>'
      + '<span class="uc"></span></button>';
  }
  function surgeSpineHtml(nodes, group) {
    return nodes.length ? '<div class="sg-spine sg--' + group + '">' + nodes.map(surgeNodeHtml).join('') + '</div>' : '';
  }
  function surgeBranchCardHtml(n) {
    const m = SURGE_BRANCH_META[n.branch];
    return '<button class="sg-branchcard sg--' + n.branch + '" data-surge="' + n.id + '">'
      + '<span class="sg-ico">' + n.icon + '</span>'
      + '<span class="sg-bname">' + m.name + '</span>'
      + '<span class="sg-beff">' + m.tag + '</span>'
      + '<span class="uc sg-bcost"></span></button>';
  }
  let surgeStructKey = '';
  let surgeNodeCache = {};   // id -> { node, uc }; only the rendered (tappable) nodes
  function renderSurgeTree() {
    if (!el.surgelist) return;
    const list = visibleSurgeNodes();
    const branch = sl().surgeBranch;
    const html = [surgeSpineHtml(list.filter((n) => !n.branch), 'trunk')];
    if (sg('sg_fork')) {
      if (!branch || !SURGE_BRANCH_META[branch]) {
        // FORK: present the three capstones as a side-by-side choice. (An
        // unknown branch from a corrupt save also falls here, not into a crash.)
        const caps = ['crit', 'flow', 'hunt']
          .map((b) => SURGE_NODES.find((n) => n.branch === b && n.req === 'sg_fork'))
          .filter((n) => list.includes(n));
        html.push('<div class="sg-fork">▽ CHOOSE ONE PATH ▽</div>');
        html.push('<div class="sg-choice">' + caps.map(surgeBranchCardHtml).join('') + '</div>');
      } else {
        // committed: the chosen branch continues as its own spine.
        const m = SURGE_BRANCH_META[branch];
        const mine = list.filter((n) => n.branch === branch);
        const owned = mine.filter((n) => sg(n.id)).length;
        const total = SURGE_NODES.filter((n) => n.branch === branch).length;
        const others = ['crit', 'flow', 'hunt'].filter((b) => b !== branch)
          .map((b) => SURGE_BRANCH_META[b].icon + ' ' + SURGE_BRANCH_META[b].name).join(' · ');
        html.push('<div class="sg-pathlabel sg--' + branch + '">' + m.icon + ' ' + m.name + ' PATH · ' + owned + '/' + total + '</div>');
        html.push(surgeSpineHtml(mine, branch));
        html.push('<div class="sg-givenup">Paths not taken: <b>' + others + '</b><br>Reincarnate to respec the tree free.</div>');
      }
    }
    el.surgelist.innerHTML = html.join('');
    surgeNodeCache = {};
    el.surgelist.querySelectorAll('[data-surge]').forEach((node) => {
      const n = SURGE_BY_ID[node.getAttribute('data-surge')];
      const uc = node.querySelector('.uc');
      surgeNodeCache[n.id] = { node, uc };
      applySurgeState(node, n);
      if (uc) uc.textContent = surgeCardUc(n);
    });
    surgeStructKey = surgeStructSig(list);
    if (el.surgechargecount) el.surgechargecount.textContent = fmtInt(sl().surgeCharges || 0);
  }
  function updateSurgeTree() {
    if (!el.surgelist) return;
    const list = visibleSurgeNodes();
    const ids = Object.keys(surgeNodeCache);
    if (surgeStructSig(list) !== surgeStructKey || !ids.length || !surgeNodeCache[ids[0]].node.isConnected) {
      renderSurgeTree();
      return;
    }
    for (const id of ids) {
      const c = surgeNodeCache[id];
      applySurgeState(c.node, SURGE_BY_ID[id]);
      if (c.uc) c.uc.textContent = surgeCardUc(SURGE_BY_ID[id]);
    }
    if (el.surgechargecount) el.surgechargecount.textContent = fmtInt(sl().surgeCharges || 0);
  }

  function renderSlayerLite() {
    if (!state.wormhole || !el.hpFill) return;
    const s = sl();
    const e = enemyFor(s.wave);
    const boss = isBossWave(s.wave);
    el.enemyEmoji.textContent = e.icon;
    el.enemyName.textContent = (boss ? '👑 BOSS: ' : '') + e.name;
    if (el.enemyReward) el.enemyReward.textContent = `Reward: ${fmt(voltReward(s.wave))} Volts`;
    el.zoneName.textContent = `${zoneFor(s.wave)} · WAVE ${s.wave}${boss ? '' : ` · ${s.killsThisWave}/10`}`;
    const pct = s.maxHp > 0 ? Math.max(0, (s.hp / s.maxHp) * 100) : 0;
    el.hpFill.style.width = pct + '%';
    el.hpText.textContent = `${fmt(Math.max(0, s.hp))} / ${fmt(s.maxHp)} HP`;
    if (el.zapinfo) {
      const parts = [`⚡${fmt(zapPower())} / zap`, `grid boost ×${gridZpsBoost().toFixed(2)}`];
      if (zapMilestonesPassed() > 0) parts.push(`milestone ×${fmt(zapMilestoneMult())}`);
      if (zapZpsFrac() > 0) parts.push(`+${Math.round(zapZpsFrac() * 100)}% Z/s per zap`);
      const nz = nextZapMilestone();
      if (nz) parts.push(`next ×1.25 @ ${fmtInt(nz)} zaps (${fmtInt(sl().zaps)})`);
      el.zapinfo.textContent = parts.join(' · ');
    }
    el.enemyBtn.classList.toggle('boss', boss);
    if (el.dischargeBtn) {
      const unlocked = su('discharge');
      el.dischargeBtn.hidden = !unlocked;
      if (unlocked) {
        const cd = Math.ceil(sl().dischargeCd || 0);
        el.dischargeBtn.textContent = cd > 0 ? ('⏳ ' + cd + 's') : '⚡ DISCHARGE';
        el.dischargeBtn.disabled = cd > 0;
        el.dischargeBtn.classList.toggle('ready', cd <= 0);
      }
    }
    if (el.surgechargecount) el.surgechargecount.textContent = fmtInt(sl().surgeCharges || 0);
  }

  /* ---------- World switching & the wormhole ---------- */
  function activeWorld() { return state.wormhole && state.world === 'volt' ? 'volt' : 'grid'; }

  function applyWorld() {
    const w = activeWorld();
    document.body.dataset.world = w;
    if (el.worldBtn) {
      el.worldBtn.hidden = !state.wormhole;
      const toVolt = w !== 'volt';   // on the Grid, the button travels to the Voltlands
      const icon = el.worldBtn.querySelector('.ti');
      const label = el.worldBtn.querySelector('.tl');
      if (icon) icon.textContent = toVolt ? '🌀' : '🔌';
      if (label) label.textContent = toVolt ? 'VOLTLANDS' : 'GRID';
      el.worldBtn.setAttribute('aria-label', toVolt ? 'Travel to the Voltlands' : 'Return to the Grid');
    }
    // if the active tab belongs to the other world, jump to this world's home
    const active = document.querySelector('.tab.active');
    const tw = (active && active.dataset.tworld) || 'both';
    if (tw !== 'both' && tw !== w) activateTab(w === 'volt' ? 'zap' : 'plug', true);
    renderMoreGating();
    syncSettingsUI();
    renderStatsLite();
    syncMusicWorld();   // swap to this world's soundtrack if music is already playing
  }

  function switchWorld() {
    if (!state.wormhole) return;
    state.world = activeWorld() === 'volt' ? 'grid' : 'volt';
    blip(state.world === 'volt' ? 180 : 520, 0.2, 'sawtooth', 0.05);
    applyWorld();
    save();
  }

  function playWormhole() {
    state.world = 'volt';
    if (sl().maxHp <= 0) spawnEnemy();
    const ov = document.getElementById('wormhole');
    const instant = !state.settings.floats || reduceMotion() || !ov;
    if (instant) {
      applyWorld();
      renderAll();
      activateTab('zap', true);   // first unlock lands on the Zap page, not the More tab you bought ??? from
      toast('🌀 ARRIVAL: THE VOLTLANDS', true);
      save();
      return;
    }
    ov.classList.add('show');
    blip(80, 1.4, 'sawtooth', 0.07);
    buzz([0, 80, 60, 80, 60, 200]);
    screenShake(2);
    setTimeout(() => {
      applyWorld();
      renderAll();
      activateTab('zap', true);   // first unlock lands on the Zap page, not the More tab you bought ??? from
      toast('🌀 ARRIVAL: THE VOLTLANDS', true);
      save();
      setTimeout(() => ov.classList.remove('show'), 700);
    }, 4200);
  }

  /* ---------- Offline earnings ---------- */
  function applyOffline() {
    const now = Date.now();
    const eff = offlineEff();
    const away = Math.min(now - (state.lastSeen || now), offlineCapMs()); // Battery Backup raises the cap
    if (away < 1000 * 30) return; // ignore < 30s
    const rate = totalWps();
    const earned = rate * (away / 1000) * eff;
    if (earned <= 0) return;
    gainWatts(earned);
    // Voltlands earn too: ZPS keeps zapping the CURRENT wave (no wave progress
    // offline). Convert that damage into volts exactly like the live loop does —
    // damage ÷ enemy HP = kills, × voltReward per kill — instead of booking every
    // point of damage as a volt. Raw totalZps overcounts badly: a wave's enemies
    // have far more HP than the volts they drop (≈1.25× too high now, and was up
    // to ~30× deep in before the reward curve was fixed). Capacitor Bank raises the
    // Voltlands offline cap +24h independently of the Grid's (Battery Backup) cap.
    let voltsEarned = 0;
    if (state.wormhole) {
      const voltAway = Math.min(now - (state.lastSeen || now), offlineCapMs() + (su('capbank') ? 24 * 3600000 : 0));
      const w = sl().wave;
      const voltRate = totalZps() * (voltReward(w) / enemyHp(w));   // volts/sec = kills/sec × reward
      voltsEarned = voltRate * (voltAway / 1000) * eff;
      if (voltsEarned > 0) {
        sl().volts += voltsEarned;
        sl().totalVolts += voltsEarned;
        sl().runVolts += voltsEarned;
      }
    }
    const h = Math.floor(away / 3600000), m = Math.floor((away % 3600000) / 60000);
    // Once the Voltlands are unlocked and actually earned offline, Volts are the
    // player's primary currency — lead with them (bigger) and demote Watts beneath.
    // Before the wormhole (or if nothing was zapped while away) Watts stay headline.
    const wattAmt = `+${fmt(earned)} W`;
    const amounts = voltsEarned > 0
      ? `<p class="big" style="font-size:34px">+${fmt(voltsEarned)} V</p>`
        + `<p class="big" style="font-size:20px;opacity:.85">${wattAmt}</p>`
      : `<p class="big">${wattAmt}</p>`;
    const adBtn = window.Monetize?.adsAvailable?.()
      ? `<button class="smbtn" id="wbDouble" style="margin-top:8px;width:100%">📺 WATCH AD · DOUBLE IT</button>` : '';
    showModal(`
      <h2>⚡ WELCOME BACK</h2>
      <p class="dim">Your cords ran for<br><b style="color:var(--cyan)">${h}h ${m}m</b> (${Math.round(eff * 100)}% rate)</p>
      ${amounts}
      <button class="bigbtn" id="wbOk" style="margin-top:12px">COLLECT</button>${adBtn}`);
    document.getElementById('wbOk').addEventListener('click', hideModal);
    const dbl = document.getElementById('wbDouble');
    if (dbl) dbl.addEventListener('click', async () => {
      dbl.disabled = true;
      const ok = await window.Monetize.showRewarded();
      if (ok) {
        gainWatts(earned);
        toast('📺 Offline earnings DOUBLED! +' + fmt(earned) + ' W', true);
        save();
        renderStatsLite();
        hideModal();
      } else {
        dbl.disabled = false;
        toast('Ad not ready — try again in a moment');
      }
    });
  }

  /* ---------- Power Store (Android only) ----------
     Rewarded ad bonuses + Google Play purchases, via the js/monetize.js
     facade. On the web Monetize.available() is false and none of this UI
     is ever revealed — the web build stays 100% monetization-free. */

  const IAP_PRODUCTS = [
    { id: 'supporter_pack',      icon: '💖', name: 'Supporter Pack',  consumable: false, desc: 'Supporter badge + claim a free 2x boost every day.' },
    { id: 'boost_production_25', icon: '🚀', name: 'Overclock +25%',  consumable: false, desc: 'All production +25%. Permanent.' },
    { id: 'starter_cores',       icon: '◆',  name: 'Starter Cores',   consumable: false, desc: 'Instantly gain 3 Prestige Cores.' },
    { id: 'timewarp_4h',         icon: '⏩', name: 'Time Warp · 4h',  consumable: true,  desc: 'Instantly earn 4 hours of production.' },
    { id: 'timewarp_24h',        icon: '⏭️', name: 'Time Warp · 24h', consumable: true,  desc: 'Instantly earn 24 hours of production.' },
    { id: 'theme_pack_phosphor', icon: '🎨', name: 'CRT Theme Pack',  consumable: false, desc: 'Amber, Ice & Vapor phosphor themes.' },
  ];
  const AD_LIMITS = { boost: 6, surge: 4 };   // rewarded uses per day, per placement
  const BOOST_MS = 10 * 60000;                // 2x production per boost/claim
  let iapPrices = {};                         // sku -> localized price string

  function localDay() { return new Date().toDateString(); }
  function adUsesLeft(kind) {
    if (state.adDay !== localDay()) { state.adDay = localDay(); state.adUses = {}; }
    return AD_LIMITS[kind] - (state.adUses[kind] || 0);
  }
  function markAdUse(kind) {
    adUsesLeft(kind);                         // roll the day over if needed
    state.adUses[kind] = (state.adUses[kind] || 0) + 1;
  }

  // The 2x boost persists in state.boostUntil so an app restart can't eat a
  // bonus the player watched an ad (or paid goodwill) for.
  function grantBoost(label) {
    const now = Date.now();
    state.boostUntil = Math.max(state.boostUntil || 0, now) + BOOST_MS;
    syncBoostBuff();
    toast(label, true);
    blip(990, 0.18, 'sawtooth', 0.05);
    buzz([0, 25, 40, 25]);
    save();
  }
  function syncBoostBuff() {
    buffs = buffs.filter((b) => b.kind !== 'prod' || b.src !== 'boost');
    if ((state.boostUntil || 0) > Date.now()) {
      buffs.push({ kind: 'prod', mult: 2, until: state.boostUntil, icon: '🚀', label: 'BOOST ×2', src: 'boost' });
    }
    renderBuffs();
  }

  function grantTimewarp(hours) {
    // Credit steady-state production only: a transient ×2 boost (ad or supporter)
    // must not multiply hours of warped time. buffMult('prod') is timed-buffs-only,
    // so divide it back out; permanent mults (prestige, IAP, achievements) stay in.
    const earned = (totalWps() / buffMult('prod')) * hours * 3600;
    gainWatts(earned);
    toast(`⏩ TIME WARP! +${fmt(earned)} W (${hours}h)`, true);
    screenShake(1.2);
    save();
    renderAll();
  }

  // Idempotent entitlement grant — Play Billing re-fires owned products on
  // every restore/boot, so non-consumables must only apply once.
  function grantPurchase(sku) {
    const product = IAP_PRODUCTS.find((p) => p.id === sku);
    if (!product) return;
    if (product.consumable) {
      if (sku === 'timewarp_4h') grantTimewarp(4);
      else if (sku === 'timewarp_24h') grantTimewarp(24);
      return;
    }
    if (state.iap[sku]) return;               // already granted
    state.iap[sku] = true;
    if (sku === 'starter_cores') {
      state.cores = (state.cores || 0) + 3;
      state.coresEarned = (state.coresEarned || 0) + 3;
    }
    toast(`${product.icon} ${product.name} — thank you!`, true);
    save();
    renderAll();
    renderStore();
    applyTheme();
  }

  function applyTheme() {
    const t = state.iap.theme_pack_phosphor ? (state.theme || '') : '';
    document.body.dataset.theme = t;
    renderThemePicker();
  }
  const THEMES = [
    { id: '',      name: 'GREEN' },
    { id: 'amber', name: 'AMBER' },
    { id: 'ice',   name: 'ICE' },
    { id: 'vapor', name: 'VAPOR' },
  ];
  function renderThemePicker() {
    const row = document.getElementById('themeRow');
    const wrap = document.getElementById('themeBtns');
    if (!row || !wrap) return;
    const owned = !!state.iap.theme_pack_phosphor;
    row.hidden = !owned;
    if (!owned) return;
    wrap.innerHTML = THEMES.map((t) =>
      `<button class="sw theme-sw ${(state.theme || '') === t.id ? 'on' : ''}" data-theme-pick="${t.id}">${t.name}</button>`
    ).join('');
  }

  function renderStore() {
    const block = document.getElementById('storeBlock');
    if (!block || !window.Monetize?.available?.()) return;
    block.hidden = false;
    const h3 = block.querySelector('h3');
    if (h3) h3.textContent = state.iap.supporter_pack ? '🎁 POWER STORE · 💖 SUPPORTER' : '🎁 POWER STORE';

    const bonus = document.getElementById('bonusArea');
    if (bonus) {
      const supporter = state.iap.supporter_pack && state.supporterDay !== localDay();
      let html = supporter
        ? `<button class="bigbtn" data-bonus="claim" style="margin-bottom:8px">💖 CLAIM DAILY ×2 BOOST</button>` : '';
      if (window.Monetize.adsAvailable()) {
        const boostLeft = adUsesLeft('boost');
        const surgeLeft = adUsesLeft('surge');
        html += `
        <div class="row2">
          <button class="smbtn" data-bonus="boost" ${boostLeft <= 0 ? 'disabled' : ''}>📺 ×2 BOOST 10m<br><small>${boostLeft}/${AD_LIMITS.boost} today</small></button>
          <button class="smbtn" data-bonus="surge" ${surgeLeft <= 0 ? 'disabled' : ''}>📺 SUMMON SURGE<br><small>${surgeLeft}/${AD_LIMITS.surge} today</small></button>
        </div>
        <p class="muted" style="margin:8px 0 4px">Ads are 100% optional — watch one only when YOU want a bonus.</p>`;
      }
      bonus.innerHTML = html;
    }

    const list = document.getElementById('iaplist');
    if (list) {
      list.innerHTML = IAP_PRODUCTS.map((p) => {
        const owned = !p.consumable && state.iap[p.id];
        const price = iapPrices[p.id] || '···';
        return `
          <button class="upg ${owned ? 'bought' : 'ok'}" data-iap="${p.id}" ${owned ? 'disabled' : ''}>
            <div class="un">${p.icon} ${p.name}</div>
            <div class="ud">${p.desc}</div>
            <div class="uc">${owned ? '✓ OWNED' : price}</div>
          </button>`;
      }).join('');
    }
  }

  async function onBonusClick(kind) {
    if (kind === 'claim') {
      if (!state.iap.supporter_pack || state.supporterDay === localDay()) return;
      state.supporterDay = localDay();
      grantBoost('💖 SUPPORTER BOOST ×2 (10m)!');
      renderStore();
      return;
    }
    if (adUsesLeft(kind) <= 0) { toast('Come back tomorrow!'); return; }
    // Don't make the player burn a daily use on a surge that can't spawn. Guard
    // before the ad, and again after (an organic surge can arrive mid-ad), so
    // markAdUse only runs when the reward is actually delivered.
    if (kind === 'surge' && surgeActive) { toast('⚡ A surge is already on screen!'); return; }
    const ok = await window.Monetize.showRewarded();
    if (!ok) { toast('Ad not ready — try again in a moment'); return; }
    if (kind === 'surge' && surgeActive) { toast('⚡ Surge already on screen — ad credit kept.'); return; }
    markAdUse(kind);
    if (kind === 'boost') grantBoost('📺 BOOST ×2 for 10 minutes!');
    else if (kind === 'surge') { spawnSurge(); toast('📺 SURGE INCOMING — catch it!', true); }
    save();
    renderStore();
  }

  /* ---------- Save / load UI ---------- */
  function exportSave() {
    save();
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    el.savebox.value = code;
    try { navigator.clipboard?.writeText(code); } catch (e) { /* ignore */ }
    toast('📤 Save exported to box');
  }
  function importSave() {
    const code = (el.savebox.value || '').trim();
    if (!code) { toast('Paste a save code first'); return; }
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob(code))));
      if (typeof obj !== 'object' || obj.watts === undefined) throw new Error('bad');
      // normalizeState carries over cores, coresEarned, coreUpgrades and the
      // legacy prestige migration, so imported prestige progress is preserved.
      state = normalizeState(obj);
      save();
      const coreNote = (state.coresEarned || 0) > 0 ? ` (◆${fmtInt(state.cores)} cores, +${lifetimeBonusPct()}%)` : '';
      toast('📥 Save imported!' + coreNote, true);
      if (state.wormhole && sl().maxHp <= 0) spawnEnemy();
      applyWorld();
      applyTheme();
      renderAll();
    } catch (e) { toast('⚠ Invalid save code'); }
  }
  function hardReset() {
    showModal(`
      <h2 class="danger">⚠ HARD RESET</h2>
      <p class="dim">Erase everything permanently?</p>
      <div class="row2" style="margin-top:14px">
        <button class="bigbtn danger" id="wY">ERASE</button>
        <button class="smbtn" id="wN">CANCEL</button>
      </div>`);
    document.getElementById('wY').addEventListener('click', () => {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      idbDel(SAVE_KEY);
      state = defaultState();
      buffs = [];
      save();
      hideModal();
      toast('Reset complete');
      applyWorld();
      applyTheme();
      renderAll();
    });
    document.getElementById('wN').addEventListener('click', hideModal);
  }

  /* ---------- Event wiring ---------- */
  // Tap delegation for rebuilt lists. A plain delegated 'click' is unreliable
  // here: if the list re-renders between pointerdown and pointerup (the
  // auto-buyer/auto-upgrader can do that every tick), the pressed button is
  // gone before the gesture ends and the browser never fires the click. So
  // we resolve the item at pointerdown — while it still exists — and commit
  // on pointerup unless the finger moved (that's a scroll, not a tap).
  function delegateTap(list, attr, fn) {
    if (!list) return;
    if (typeof window.PointerEvent === 'undefined') {   // ancient WebView fallback
      list.addEventListener('click', (e) => {
        const item = e.target && e.target.closest && e.target.closest(`[${attr}]`);
        if (item) fn(item.getAttribute(attr));
      });
      return;
    }
    let armed = null, sx = 0, sy = 0;
    list.addEventListener('pointerdown', (e) => {
      armed = null;
      if (e.button) return;                       // primary button / touch only
      const item = e.target && e.target.closest && e.target.closest(`[${attr}]`);
      if (!item) return;
      armed = item.getAttribute(attr); sx = e.clientX; sy = e.clientY;
    });
    list.addEventListener('pointerup', (e) => {
      const id = armed; armed = null;
      if (id == null) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 14) return;
      fn(id);
    });
    list.addEventListener('pointercancel', () => { armed = null; });
    // keyboard activation still arrives as a click with detail 0
    list.addEventListener('click', (e) => {
      if (e.detail) return;
      const item = e.target && e.target.closest && e.target.closest(`[${attr}]`);
      if (item) fn(item.getAttribute(attr));
    });
  }

  // Rapid-tap controls (socket, mini-socket, zap target). On touch we fire on
  // touchstart and preventDefault(): the tap registers instantly, iOS WebKit's
  // double-tap-to-zoom (which a burst of fast taps otherwise triggers) is
  // suppressed, and the synthesized click is cancelled so the tap isn't counted
  // twice. `click` stays as the mouse/desktop fallback.
  function bindTap(elm, fn) {
    let viaTouch = false;
    elm.addEventListener('touchstart', (e) => {
      viaTouch = true;
      e.preventDefault();
      fn(e);
    }, { passive: false });
    elm.addEventListener('click', (e) => {
      if (viaTouch) { viaTouch = false; return; }
      fn(e);
    });
  }
  // ---- World tap surfaces (shared machinery; see docs/world-template.md) ----
  // Every world taps the same way: a big hero button + a scroll-collapse panel
  // whose compact bar — plus a mini bar on the world's upgrade tab — keep you
  // tapping while the shop list scrolls. One table keeps the worlds in lockstep;
  // add a world by adding a row (and the matching ids in index.html + CSS).
  const TAP_SURFACES = [
    { world: 'grid', action: plug,     hero: 'socket',   panel: 'p-plug', sentinel: 'plugSentinel', bars: ['socketMiniPlug', 'socketMini'] },
    { world: 'volt', action: zapEnemy, hero: 'enemyBtn', panel: 'p-zap',  sentinel: 'zapSentinel',  bars: ['enemyBtnMini', 'zapMini'] },
  ];
  for (const s of TAP_SURFACES) {
    if (el[s.hero]) bindTap(el[s.hero], s.action);
    for (const id of s.bars) if (el[id]) bindTap(el[id], s.action);
  }

  // Never zoom. The viewport meta (user-scalable=no, maximum-scale=1) kills both
  // pinch- and double-tap-zoom in the Capacitor WKWebView, but iOS Safari ignores
  // it for accessibility — so also cancel WebKit's pinch gesture events, which is
  // what's left when the page runs as an installed PWA.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) =>
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false }));
  if (el.worldBtn) el.worldBtn.addEventListener('click', switchWorld);
  if (el.dischargeBtn) el.dischargeBtn.addEventListener('click', () => fireDischarge());
  delegateTap(el.weaponlist, 'data-weapon', (id) => buyWeapon(WEAPONS.find((w) => w.id === id)));
  delegateTap(el.zuplist, 'data-zupgrade', (id) => buyZapUpgrade(ZAP_UPGRADES.find((u) => u.id === id)));
  delegateTap(el.surgelist, 'data-surge', (id) => buySurgeNode(SURGE_NODES.find((n) => n.id === id)));
  delegateTap(el.surgePresets, 'data-surgesave', (i) => saveSurgePreset(+i));
  delegateTap(el.surgePresets, 'data-surgeload', (i) => loadSurgePreset(+i));
  // iOS suppresses :active styling unless a touchstart listener exists.
  document.body.addEventListener('touchstart', () => {}, { passive: true });

  // Re-measure cord flavor descriptions when the viewport width changes (rotate,
  // browser resize): a wider row may now fit a description that was hidden.
  let _flavorFitRAF = 0;
  window.addEventListener('resize', () => {
    if (_flavorFitRAF) return;
    _flavorFitRAF = requestAnimationFrame(() => { _flavorFitRAF = 0; refitFlavors(); });
  });
  // The CRT webfont changes text width once it loads; re-measure after it's ready
  // so descriptions hidden by an early (fallback-font) measure reappear if they fit.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitFlavors);

  // Collapse a tap panel's big hero button into its pinned compact bar once the
  // hero scrolls away: when the sentinel (just above the sticky toolbar) reaches
  // the top of the scroll viewport, the toolbar pins and the compact bar appears.
  // (A scroll + rect check rather than IntersectionObserver, which fires
  // unreliably with a scroll-container root in the app's WKWebView.) Shared by
  // every world via TAP_SURFACES, so the Plug and Zap tabs behave identically.
  const collapseUpdaters = {};
  function setupScrollCollapse(panelId, sentinelId) {
    const panel = document.getElementById(panelId);
    const sentinel = document.getElementById(sentinelId);
    if (!panel || !sentinel) return;
    const update = () => {
      // An inactive (display:none) panel has zero-size rects that would read as
      // "collapsed" — never collapse a panel that isn't the visible tab.
      if (!panel.classList.contains('active')) { panel.classList.remove('plug-collapsed'); return; }
      const sr = sentinel.getBoundingClientRect();
      // On the tablet/desktop layout the hero stays visible and the collapse rig is
      // CSS-dormant (the sentinel is display:none → a zero-size rect). Don't let that
      // fake a collapse, which would mis-anchor tap floats to the hidden compact bar.
      if (sr.width === 0 && sr.height === 0) { panel.classList.remove('plug-collapsed'); return; }
      const collapsed = sr.bottom <= panel.getBoundingClientRect().top + 12;
      panel.classList.toggle('plug-collapsed', collapsed);
    };
    collapseUpdaters[panelId] = update;
    panel.addEventListener('scroll', update, { passive: true });
    update();
  }
  for (const s of TAP_SURFACES) setupScrollCollapse(s.panel, s.sentinel);

  // tabs (bottom nav) — also driven programmatically by world switching
  function activateTab(name, silent) {
    const tab = document.querySelector(`.tab[data-tab="${name}"]`);
    const panel = document.getElementById('p-' + name);
    if (!tab || !panel) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    // Recompute the collapse state for the freshly-shown panel (its scroll
    // position is preserved across tab switches; a tap panel must not show its
    // compact bar at the top, nor hide it if it was left scrolled).
    if (collapseUpdaters['p-' + name]) collapseUpdaters['p-' + name]();
    if (!silent) blip(520, 0.03);
    if (name === 'goals') renderGoals();
    else if (name === 'up') renderUpgrades();
    else if (name === 'plug') renderCords();
    else if (name === 'zap') { renderWeapons(); renderSlayerLite(); }
    else if (name === 'arsenal') renderZapUpgrades();
    else if (name === 'surge') renderSurgeTree();
    else if (name === 'more') { renderCoreShop(); if (state.wormhole) renderStormShop(); renderChallenges(); renderMoreGating(); renderStatsLite(); syncSettingsUI(); renderStore(); }
  }
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // delegated shop taps
  delegateTap(el.bulkBar, 'data-bulk', (v) => {
    state.bulk = v === 'max' ? 'max' : parseInt(v, 10);
    lastSig = '';
    renderCords();
  });
  // The Voltlands shares the same global state.bulk; its bar mirrors the Grid's.
  delegateTap(el.bulkBarZap, 'data-bulk', (v) => {
    state.bulk = v === 'max' ? 'max' : parseInt(v, 10);
    lastSig = '';
    renderWeapons();
  });
  delegateTap(el.cordlist, 'data-cord', (id) => buyCord(CORDS.find(c => c.id === id)));
  delegateTap(el.uplist, 'data-upgrade', (id) => buyUpgrade(UPGRADES.find(u => u.id === id)));
  delegateTap(el.corelist, 'data-core', (id) => buyCoreUpgrade(CORE_UPGRADES.find(cu => cu.id === id)));
  delegateTap(el.stormlist, 'data-storm', (id) => buyStormUpgrade(STORM_UPGRADES.find(su_ => su_.id === id)));

  // Power Store: rewarded bonuses, purchases, restore (delegated; the block
  // only becomes visible inside the native Android shell)
  const storeBlock = document.getElementById('storeBlock');
  if (storeBlock) storeBlock.addEventListener('click', (e) => {
    const bonus = e.target.closest('[data-bonus]');
    if (bonus && !bonus.disabled) { onBonusClick(bonus.dataset.bonus); return; }
    const buyBtn = e.target.closest('[data-iap]');
    if (buyBtn && !buyBtn.disabled) { window.Monetize.buy(buyBtn.dataset.iap); return; }
    if (e.target.closest('#restoreBtn')) window.Monetize.restore();
  });
  // theme picker (revealed once the theme pack is owned)
  const themeRow = document.getElementById('themeRow');
  if (themeRow) themeRow.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-theme-pick]');
    if (!pick) return;
    state.theme = pick.dataset.themePick;
    applyTheme();
    save();
    blip(520, 0.03);
  });

  // prestige + save buttons
  el.prestigeBtn.addEventListener('click', doPrestige);
  if (el.reincarnateBtn) el.reincarnateBtn.addEventListener('click', confirmReincarnate);
  el.exportBtn.addEventListener('click', exportSave);
  el.importBtn.addEventListener('click', importSave);
  el.wipeBtn.addEventListener('click', hardReset);

  // challenges: start / abandon (delegated)
  const chBlock = document.getElementById('challengeBlock');
  if (chBlock) chBlock.addEventListener('click', (e) => {
    if (e.target.closest('#chAbandon')) { abandonChallenge(); return; }
    const btn = e.target.closest('[data-ch]');
    if (btn && !btn.disabled) {
      const c = CHALLENGES.find((x) => x.id === btn.dataset.ch);
      if (c) startChallenge(c);
    }
  });

  // settings switches
  document.querySelectorAll('.sw[data-set]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.set;
      const dot = k.indexOf('.');
      if (dot > 0) { const a = k.slice(0, dot), p = k.slice(dot + 1); state.settings.world[a][p] = !state.settings.world[a][p]; }
      else if (k === 'sound') state.settings.sound = !state.settings.sound;
      else if (k === 'music') { state.settings.music = !state.settings.music; if (state.settings.music) playMusic(activeWorld()); else stopMusic(); }
      else if (k === 'haptic') { state.settings.haptics = !state.settings.haptics; if (state.settings.haptics) buzz(20); }
      else if (k === 'anim') state.settings.floats = !state.settings.floats;
      else if (k === 'notify') { toggleNotify(); return; }   // async permission flow handles sync + save
      else state.settings.sci = !state.settings.sci;
      renderAll();   // full re-render so a number-format change (sci toggle) reaches the core/storm shops, challenges, etc.
      save();
    });
  });

  // Frame-rate cap: a value cycler (15 → 30 → 60), not a boolean, so it's wired
  // on its own. The render loop reads state.settings.fps live, so no restart needed.
  const FPS_OPTIONS = [15, 30, 60];
  const fpsBtn = document.getElementById('fpsBtn');
  if (fpsBtn) fpsBtn.addEventListener('click', () => {
    const i = FPS_OPTIONS.indexOf(state.settings.fps || 30);
    state.settings.fps = FPS_OPTIONS[(i + 1) % FPS_OPTIONS.length];
    fpsBtn.textContent = state.settings.fps + ' FPS';
    blip(520, 0.03);
    save();
  });

  // close modal by tapping the backdrop
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) hideModal(); });

  // keyboard: space/enter to plug (or zap, in the Voltlands)
  window.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      if (activeWorld() === 'volt') zapEnemy();
      else plug();
    }
  });

  // save on hide / unload
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); pauseLoop(); stopMusic(); }   // stop repainting, slow the sim, silence music when hidden
    else { resumeLoop(); if (state.settings.music && audioCtx) playMusic(activeWorld()); }
  });
  // Autoplay policy: audio can only start after a user gesture — resume + start
  // music (if on) on the first interaction.
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { once: true }));
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);

  // Reflect where/how the save is stored, shown in the settings panel.
  async function updateStorageStatus() {
    if (!el.storageStatus) return;
    const info = await storageInfo();
    const stores = ['localStorage', info.idb ? 'IndexedDB' : null].filter(Boolean).join(' + ');
    const lock = info.persisted ? ' · persistent' : '';
    el.storageStatus.textContent = `Saved on this device via ${stores}${lock}.`;
  }

  /* ---------- Main loop ---------- */
  // Auto-buy is unlocked by the Auto-Buyer core upgrade, and runs while its
  // Settings toggle is on (default on).
  function autoBuyActive() {
    return co('autobuy') && state.settings.world.grid.autobuyOn;
  }

  // AUTO-BUYER: spends the bank on whichever tier yields the most extra output
  // per cost (marginal efficiency = 1/payback), snapping each buy to the next
  // ownership milestone so a near-complete ×2/×10 breakpoint gets finished first.
  // This replaced a naive cheapest-first pass that sank a returning player's whole
  // offline bank into low-value tiers. Silent — no sounds/toasts; milestones stay
  // celebrated only on manual buys. Shared with the Voltlands arsenal via
  // autoBuyGreedy (same exponential-cost / milestone shape — world-template parity).
  const AUTO_BUY_PER_CORD = 25;     // core-gain (Ouroboros) tail batch, per tick
  const AUTO_ZAP_RATE = 5;          // Auto-Zapper: tap-zaps per second
  const AUTO_BUY_MAX_STEPS = 64;    // greedy chunks per tick — bounded so ticks stay fast; a huge bank deploys over a few ticks
  function autoBuyAllowed(cord, i) {
    if (cord.wps <= 0 && !cord.coreGain) return false;        // skip non-producing cords, but allow Ouroboros (core-gain)
    if (ch('grid') === 'solo' && cord.id !== 'usba') return false;   // SOLO CIRCUIT: USB-A only
    const owned = state.owned[cord.id] || 0;
    const prevOwned = i === 0 ? 1 : (state.owned[CORDS[i - 1].id] || 0);
    return owned > 0 || prevOwned > 0;                         // unlocked
  }

  // Greedy marginal-efficiency chooser, shared by Grid cords and Voltlands weapons
  // (both have the same exponential cost / per-25 milestone shape). cfg supplies the
  // world's accessors. Each step it ranks every eligible tier by the efficiency of
  // its NEXT SINGLE unit (Δoutput / that unit's cost), buys a milestone-sized batch
  // of the winner for speed, and repeats up to AUTO_BUY_MAX_STEPS.
  //   • Ranking on the single next unit — NOT a milestone-sized chunk average — is
  //     what makes this beat the old cheapest-first pass on a constrained bank
  //     (+4–19% W/s in sims). Averaging a high tier over its 25-unit milestone block
  //     hid its efficient first unit behind 24 expensive ones, so the bank never
  //     reached the high-output tiers; ranking the single unit keeps it visible.
  //   • A unit that crosses a ×2/×10 milestone carries that whole-stack jump in
  //     dOut1, so a near-complete milestone naturally ranks highest and gets finished.
  //   • The global production scalar (prestige/ach/IAP/buffs) is omitted from unitBase
  //     because it multiplies every tier equally and so cancels out of the ranking.
  // Returns true if it bought anything.
  function autoBuyGreedy(cfg) {
    const items = cfg.items;
    // Per-tier base output (per-unit, milestone term removed) is stable across the
    // whole tick — the milestone cancels and the upgrade multipliers don't change as
    // we buy — so precompute it once to hoist the upgrade scan out of the inner loop.
    const unit = [];
    let anyProducer = false;
    for (let i = 0; i < items.length; i++) {
      unit[i] = cfg.unitBase(items[i]);
      if (unit[i] > 0) anyProducer = true;
    }
    if (!anyProducer) return false;
    let bought = false;
    for (let step = 0; step < AUTO_BUY_MAX_STEPS; step++) {
      let bestI = -1, bestEff = 0;
      for (let i = 0; i < items.length; i++) {
        if (unit[i] <= 0) continue;                 // non-producing tiers (e.g. core-gain) handled elsewhere
        if (!cfg.allowed(items[i], i)) continue;    // re-checked each step so a tier unlocked mid-drain is reachable THIS tick
        const owned = cfg.owned(items[i]);
        if (cfg.maxAff(items[i]) < 1) continue;     // can't afford even one
        const dOut1 = unit[i] * ((owned + 1) * cordMilestoneMult(owned + 1) - owned * cordMilestoneMult(owned));
        if (dOut1 <= 0) continue;
        const eff = dOut1 / cfg.cost(items[i], 1);  // marginal efficiency of the next unit (= 1 / its payback)
        if (eff > bestEff) { bestEff = eff; bestI = i; }
      }
      if (bestI < 0) break;                         // nothing affordable & productive this pass
      // Buy a batch of the winner — snapped to its next milestone for speed — but
      // never more than the bank affords (maxAff is a conservative under-estimate,
      // so trim if a rounding edge pushes the exact cost over).
      const it = items[bestI];
      const owned = cfg.owned(it);
      let k = Math.min(cfg.maxAff(it), (Math.floor(owned / CORD_MILESTONE) + 1) * CORD_MILESTONE - owned);
      let cost = cfg.cost(it, k);
      while (k > 1 && cost > cfg.bank()) { k--; cost = cfg.cost(it, k); }
      if (k < 1 || cost > cfg.bank()) break;
      cfg.spend(cost);
      cfg.addOwned(it, k);
      bought = true;
    }
    return bought;
  }

  // Cheapest-first mop-up: after the efficiency prefix has taken the high-value
  // buys, sweep one pass buying a batch of every affordable tier cheapest-first.
  // This is what reaches the deep ×10-every-100 milestone "jackpots" on cheap
  // tiers that single-unit marginal greedy skips — those milestones are non-convex,
  // so greedy alone underperforms a full sweep on a big offline bank. Prefix +
  // mop-up together are strictly ≥ the old cheapest-first everywhere: they tie on a
  // fully-drained bank and beat it +4–19% on a constrained one. Returns true if it
  // bought anything.
  function autoBuyCheapestPass(cfg) {
    const items = cfg.items;
    let bought = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!cfg.allowed(it, i)) continue;
      const k = Math.min(cfg.maxAff(it), AUTO_BUY_PER_CORD);
      if (k < 1) continue;
      const cost = cfg.cost(it, k);
      if (cost > cfg.bank()) continue;
      cfg.spend(cost);
      cfg.addOwned(it, k);
      bought = true;
    }
    return bought;
  }

  // Core-gain cords (Ouroboros) produce no W/s, so neither pass buys them (the cord
  // cfg's `allowed` excludes them); buy them last with leftover watts, exactly as
  // the old cheapest-first pass did (Ouroboros sat last in the list).
  function autoBuyCoreGainTail() {
    let bought = false;
    for (let i = 0; i < CORDS.length; i++) {
      const cord = CORDS[i];
      if (!cord.coreGain || !autoBuyAllowed(cord, i)) continue;
      const k = Math.min(maxAffordable(cord), AUTO_BUY_PER_CORD);
      if (k <= 0) continue;
      const cost = cordCost(cord, k);
      if (state.watts < cost) continue;
      state.watts -= cost;
      state.owned[cord.id] = (state.owned[cord.id] || 0) + k;
      bought = true;
    }
    return bought;
  }

  function autoBuyTick() {
    if (!autoBuyActive()) return;
    const cfg = {
      items: CORDS,
      allowed: (c, i) => autoBuyAllowed(c, i) && !c.coreGain,   // producers only; core-gain handled by the tail
      owned: (c) => state.owned[c.id] || 0,
      addOwned: (c, k) => { state.owned[c.id] = (state.owned[c.id] || 0) + k; },
      bank: () => state.watts,
      spend: (cost) => { state.watts -= cost; },
      maxAff: maxAffordable,
      cost: cordCost,
      unitBase: (c) => c.wps * (cordMultiplier(c.id) / cordMilestoneMult(state.owned[c.id] || 0)),
    };
    const a = autoBuyGreedy(cfg);            // efficiency prefix: prioritise value (wins on constrained banks)
    const b = autoBuyCheapestPass(cfg);      // cheapest mop-up: capture deep milestones / fully drain
    const t = autoBuyCoreGainTail();
    if (a || b || t) lastSig = '';           // force the shop's affordability re-render
  }

  // AUTO-UPGRADER (core upgrade): every tick, buy every unlocked, affordable
  // upgrade, cheapest first so cheap ones are never starved by a pricey one.
  function autoBuyUpgrades() {
    if (!co('autoupg') || !state.settings.world.grid.autoupgOn || ch('grid') === 'minimalist') return;  // MINIMALIST: no upgrades
    let bought = false;
    const avail = UPGRADES
      .filter(u => !state.upgrades[u.id] && upgradeUnlocked(u))
      .sort((a, b) => a.cost - b.cost);
    for (const u of avail) {
      if (state.watts < u.cost) continue;
      state.watts -= u.cost;
      state.upgrades[u.id] = true;
      bought = true;
    }
    if (bought) lastSig = '';   // force the shop's affordability re-render
  }

  // AUTO-ARSENAL (Storm Upgrade): mirrors the Grid Auto-Buyer — spends volts on
  // whichever weapon tier gives the most ZPS per cost, snapping to the next
  // ownership milestone (the shared autoBuyGreedy chooser — world-template parity).
  // Silent. BARE KNUCKLES restricts it to gloves.
  function maxAffordableWeapon(w) {
    const owned = sl().weapons[w.id] || 0;
    const r = weaponCostGrowth();   // challenge-aware (POWER DRAIN steepens it), mirroring grid maxAffordable
    const base = w.baseCost * Math.pow(r, owned);
    const v = sl().volts;
    const k = Math.floor(Math.log((v * (r - 1)) / base + 1) / Math.log(r));
    return Math.max(0, isFinite(k) ? k : 0);
  }
  function autoBuyWeaponAllowed(w, i) {
    if (ch('volt') === 'bareknuckle' && w.id !== 'glove') return false;   // BARE KNUCKLES rule
    const owned = sl().weapons[w.id] || 0;
    const prevOwned = i === 0 ? 1 : (sl().weapons[WEAPONS[i - 1].id] || 0);
    return owned > 0 || prevOwned > 0;   // unlocked
  }
  function autoBuyWeaponsTick() {
    if (!su('autoarsenal') || !state.settings.world.volt.autobuyOn) return;
    const cfg = {
      items: WEAPONS,
      allowed: autoBuyWeaponAllowed,
      owned: (w) => sl().weapons[w.id] || 0,
      addOwned: (w, k) => { sl().weapons[w.id] = (sl().weapons[w.id] || 0) + k; },
      bank: () => sl().volts,
      spend: (cost) => { sl().volts -= cost; },
      maxAff: maxAffordableWeapon,
      cost: weaponCost,
      unitBase: (w) => w.zps * (weaponMultiplier(w.id) / cordMilestoneMult(sl().weapons[w.id] || 0)),
    };
    const a = autoBuyGreedy(cfg);            // efficiency prefix
    const b = autoBuyCheapestPass(cfg);      // cheapest mop-up (deep milestones / full drain)
    if (a || b) lastSig = '';   // force the arsenal's affordability re-render
  }

  // AUTO-TINKER (Storm Upgrade): buys every unlocked, affordable zap upgrade,
  // cheapest first, spending volts. Mirrors the Grid Auto-Upgrader. Silent.
  function autoBuyZapUpgrades() {
    if (!su('autotinker') || !state.settings.world.volt.autoupgOn || ch('volt') === 'notools') return;  // NO TOOLS: no upgrades
    let bought = false;
    const avail = ZAP_UPGRADES
      .filter((u) => !sl().upgrades[u.id] && zapUpgradeUnlocked(u))
      .sort((a, b) => a.cost - b.cost);
    for (const u of avail) {
      if (sl().volts < u.cost) continue;
      sl().volts -= u.cost;
      sl().upgrades[u.id] = true;
      bought = true;
    }
    if (bought) lastSig = '';   // force the arsenal's affordability re-render
  }

  let lastTick = Date.now();
  let tickCount = 0;
  let autoTapAccum = 0;   // fractional auto-taps carried between ticks
  function tick() {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    let gain = totalWps() * dt;
    // Auto-Tapper: passive taps. Flat tap power scales with the rate; the W/s
    // share is capped (see autoTapGainPerSec). Taps still count toward milestones.
    const taps = autoTapRate();
    if (taps > 0) {
      gain += autoTapGainPerSec() * dt;
      autoTapAccum += taps * dt;
      const whole = Math.floor(autoTapAccum);
      if (whole > 0) { autoTapAccum -= whole; awardClicks(whole); }
      if (tickCount % 2 === 0) pulseAutoTap();   // ~5 visible pulses/sec, matching the rate
    }
    if (gain > 0) gainWatts(gain);
    slayerTick(dt);           // both economies always tick (parallel worlds)
    tickCount++;
    autoBuyTick();        // fast cord auto-buyer (Auto-Buyer core upgrade)
    autoBuyUpgrades();    // Auto-Upgrader core upgrade
    autoBuyWeaponsTick(); // Auto-Arsenal storm upgrade (weapons)
    autoBuyZapUpgrades(); // Auto-Tinker storm upgrade (zap upgrades)
    checkChallenge();
    checkAchievements();      // catches threshold (watts/time) unlocks
    // No rendering here — the screen is repainted by the rAF render loop below,
    // decoupled from this fixed-rate sim so it can be frame-capped and paused.
  }

  /* ---------- Render loop (decoupled from the sim) ---------- */
  // Rendering runs on requestAnimationFrame, capped at the player's chosen frame
  // rate. rAF auto-pauses when the tab/app is hidden, so nothing repaints in the
  // background (the big battery win), and the cap stops high-refresh phones from
  // repainting at 120/144Hz. Slow-changing UI (shop affordability, tab dots, goal
  // bars) refreshes at ~6Hz regardless of the cap.
  let rafId = 0, rendering = false, lastRender = 0, lastHeavy = 0;
  const pGoals = document.getElementById('p-goals');
  function renderFrame(ts) {
    if (!rendering) return;
    rafId = requestAnimationFrame(renderFrame);
    const minGap = 1000 / (state.settings.fps || 30);
    if (ts - lastRender < minGap) return;             // frame-rate cap
    lastRender = ts;
    renderStatsLite();
    renderBuffs();                                     // count down / clear expired surge buffs
    if (activeWorld() === 'volt') renderSlayerLite();
    if (ts - lastHeavy >= 160) {                       // ~6Hz: affordability / dots / goal bars
      lastHeavy = ts;
      refreshAffordability();
      updateTabDots();
      if (pGoals && pGoals.classList.contains('active')) renderGoals();
    }
  }
  function startRender() {
    if (rendering) return;
    rendering = true; lastRender = 0; lastHeavy = 0;
    rafId = requestAnimationFrame(renderFrame);
  }
  function stopRender() {
    rendering = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // The fixed-rate sim stays on setInterval; throttle it to 1Hz while hidden
  // (native WebViews don't throttle background timers like browsers do) and
  // restore full rate on resume. The tick's dt keeps earnings correct either way.
  let simTimer = 0;
  function setSimRate(ms) {
    if (simTimer) clearInterval(simTimer);
    simTimer = setInterval(tick, ms);
  }
  function pauseLoop() { setSimRate(1000); stopRender(); }
  function resumeLoop() { setSimRate(TICK_MS); startRender(); }

  /* ---------- Boot ---------- */
  (async function boot() {
    // Reconcile with the durable IndexedDB copy before anything accrues.
    const durable = await loadDurable();
    if (durable) state = normalizeState(durable);
    await requestPersistence();
    applyOffline();
    syncBoostBuff();     // resurrect a still-running 2x boost after restart
    claimDailyStreak();  // daily check-in bonus (48h forgiveness)
    if (state.wormhole && sl().maxHp <= 0) spawnEnemy();
    applyWorld();        // restore which world the player was in
    applyTheme();
    window.Monetize?.init?.({
      skus: IAP_PRODUCTS.map((p) => ({ id: p.id, consumable: p.consumable })),
      onGrant: grantPurchase,
      onPrices: (prices) => { iapPrices = prices; renderStore(); },
      notify: (msg) => toast(msg),
    });
    renderStore();
    renderAll();
    save();              // re-mirror the reconciled state into both stores (self-heal)
    updateStorageStatus();
    checkAchievements();  // award anything already satisfied by the loaded save
    lastTick = Date.now(); // don't count the async load time as idle earnings
    resumeLoop();          // start the fixed-rate sim (10Hz) + the rAF render loop
    setInterval(save, SAVE_EVERY_MS);
    scheduleSurge();      // begin the power-surge cadence
  })();

  // ---- Capacitor native shell (Android) ----
  // window.Capacitor is injected by the native runtime; absent on the plain web.
  const NATIVE = !!(window.Capacitor?.isNativePlatform?.());
  if (NATIVE) {
    const { App, StatusBar } = window.Capacitor.Plugins;
    try {
      StatusBar.setStyle({ style: 'DARK' });               // light icons on the CRT-dark chrome
      StatusBar.setBackgroundColor({ color: '#070a0f' });  // pre-15 devices without edge-to-edge
    } catch (e) { /* ignore */ }
    try {
      // back button: leave in-app pages first; from the game, save and minimize
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else { save(); App.minimizeApp(); }
      });
    } catch (e) { /* ignore */ }
    try {
      // Offline-cap reminder: schedule on background, cancel when the app returns.
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) { cancelOfflineNotif(); resumeLoop(); if (state.settings.music && audioCtx) playMusic(activeWorld()); }
        else { scheduleOfflineNotif(); pauseLoop(); stopMusic(); }
      });
    } catch (e) { /* ignore */ }
  }

  // register service worker for installability + offline (web only — the native
  // shell bundles assets locally, and a stale SW cache would fight app updates)
  if (!NATIVE && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
