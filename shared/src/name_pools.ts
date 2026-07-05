// Fun-name pools for skill position groups (D026).
// Like the QB pool, these read like early-2000s flashgame roster names:
// clean two-syllable first names + a strong surname. The skill groups
// don't carry audible flavor text — just persona.

export const NAMES_BY_GROUP: Record<string, readonly string[]> = {
  D_LINE: [
    'Axel Stone', 'Blitz Brody', 'Crush Carter', 'Drago Dean',
    'Edge Erickson', 'Fang Foster', 'Grit Gomez', 'Hawk Hastings',
    'Iron Ingham', 'Jolt Jefferson', 'Krusher Klein', 'Lance Lloyd',
    'Mauler Mason', 'Nitro Nash', 'Onslaught Otto', 'Pummel Pierce',
    'Quake Quintero', 'Rage Reyes', 'Steel Steele', 'Tank Tucker',
    'Uproar Underwood', 'Vicious Vega', 'Wreck Walsh', 'Xeno Xavier',
    'Yard Yates', 'Zephyr Zane', 'Brawler Boyd', 'Chomp Childs',
    'Demolish Drake', 'Fury Foster',
  ],
  O_LINE: [
    'Anchor Aldrich', 'Bulwark Bishop', 'Citadel Craig', 'Drift Doyle',
    'Emblem Erickson', 'Forge Franco', 'Granite Gomez', 'Helm Hayes',
    'Ironwall Irwin', 'Junction Jones', 'Keystone Klein', 'Linchpin Lloyd',
    'Meridian Mason', 'Nexus Nash', 'Obelisk Otto', 'Pillar Pierce',
    'Quoin Quintero', 'Rampart Reyes', 'Shield Stevens', 'Totem Tucker',
    'Umbral Underwood', 'Vault Vega', 'Wedge Walsh', 'Xyst Xavier',
    'Yardstick Yates', 'Zenith Zane', 'Bastion Boyd', 'Column Childs',
    'Donjon Drake', 'Edict Evans',
  ],
  OFF_SKILL: [
    'Arrow Archer', 'Blaze Bowman', 'Cannon Carter', 'Dynamo Doyle',
    'Eclipse Ellison', 'Flash Franco', 'Gunner Gomez', 'Halo Hayes',
    'Ignite Irwin', 'Jolt Jenkins', 'Kindle Klein', 'Lightning Lloyd',
    'Mirage Mason', 'Nova Nash', 'Orbit Otto', 'Pyre Pierce',
    'Quasar Quintero', 'Rocket Reyes', 'Streak Stevens', 'Torch Tucker',
    'Uplift Underwood', 'Velocity Vega', 'Whip Walsh', 'Xplosion Xavier',
    'Yield Yates', 'Zip Zane', 'Bolt Boyd', 'Charge Childs',
    'Dart Drake', 'Edge Evans',
  ],
  DEF_SKILL: [
    'Air Raid Atkins', 'Blackout Brooks', 'Clamp Cleary', 'Dragnet Doyle',
    'Enigma Ellis', 'Frost Franco', 'Glove Grant', 'Haze Hayes',
    'Inkwell Irwin', 'Jailbreak Jenkins', 'Knack Klein', 'Lockdown Lloyd',
    'Mask Mason', 'Net Nash', 'Oblivion Otto', 'Phantom Pierce',
    'Quarter Quintero', 'Rig Reyes', 'Shadow Stevens', 'Trap Tucker',
    'Umbra Underwood', 'Veil Vega', 'Wall Walsh', 'Xanadu Xavier',
    'Yield Yates', 'Zero Zane', 'Blanket Boyd', 'Cloak Childs',
    'Disguise Drake', 'Eclipse Evans',
  ],
  KICKER: [
    'Apex Aldrich', 'Boot Bishop', 'Cleat Craig', 'Dropkick Doyle',
    'Eraser Ellison', 'Foot Franco', 'Goalpost Gomez', 'Heel Hayes',
    'Inch Irwin', 'Jersey Jenkins', 'Kickoff Klein', 'Leg Lloyd',
    'Marker Mason', 'Net Nash', 'Out Otto', 'Punt Pierce',
    'Quarter Quintero', 'Rotor Reyes', 'Squib Stevens', 'Tee Tucker',
    'Upright Underwood', 'Voyager Vega', 'Whip Walsh', 'Xtrafield Xavier',
    'Yard Yates', 'Zinger Zane', 'Boot Boyd', 'Cleat Childs',
    'Dropkick Drake', 'Foot Evans',
  ],
};

/** Pick a fun name from the group pool deterministically. Mutates nothing. */
export function pickName(rng: () => number, group: string): string {
  const pool = NAMES_BY_GROUP[group];
  if (!pool || pool.length === 0) {
    // Fallback: original Alpha/Bravo format, should never hit in practice.
    return `${group}_Alpha`;
  }
  const idx = Math.floor(rng() * pool.length);
  return pool[idx];
}
