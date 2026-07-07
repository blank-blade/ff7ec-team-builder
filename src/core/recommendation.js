/**
 * Context-Prioritized Custom Google Sheets Function to calculate optimal FF7EC teams.
 *
 * Schema notes:
 * - Uses c_pot for both damage potency and healing potency.
 * - Healing is represented as c_elem=heal with a numeric c_pot, not as a caps entry.
 * - Tiered buffs/debuffs use numeric tier values: 1=low, 2=mid, 3=high, 4=xhigh/extraHigh.
 * - The final boolean argument, healerNeeded, requires at least one healer anchor.
 * - Optional damageAssumption: conservative (default), optimistic, or baseOnly.
 *
 * @customfunction
 */
export function recommendTeamsGrid(equipmentsData, weakArch, weakElem, wantBuffsStr, wantDebuffsStr, healerNeeded, damageAssumption, manualCoverageMode, anchorHealThreshold) {
  if (!equipmentsData || equipmentsData.length < 2) return [["No equipment data found"]];

  const TIER_VALUE = { low: 1, mid: 2, moderate: 2, high: 3, xhigh: 4, extrahigh: 4, extraHigh: 4 };
  const TIER_LABEL = { 1: "T1", 2: "T2", 3: "T3", 4: "T4" };
  const TIERED_TYPES = new Set([
    "patkUp", "matkUp", "atkUp", "pdefUp", "mdefUp", "defUp", "elemDmgUp", "elemResistUp",
    "pdefDown", "mdefDown", "defDown", "patkDown", "matkDown", "atkDown", "elemResistDown", "elemDmgDown"
  ]);
  const ELEMENTS = new Set(["fire", "ice", "lightning", "wind", "water", "earth", "nonelem"]);
  const ELEMENTAL_TYPES = new Set([
    "elemDmgUp", "elemDmgDown", "elemResistUp", "elemResistDown", "elemDmgBonus", "elemWeaponBoost", "elemDmgRcvdUp",
    "elemMastery", "elemInterruptUp", "elemAtbConservation", "elemWeakness", "ampElemAbilities"
  ]);
  const SELF_OK_TYPES = new Set(["removePoison", "removeSilence", "removeBlind", "removeSleep", "removeParalyze", "removeStun", "removeSlow", "removeStop", "removePatkDown", "removeMatkDown"]);
  const OFFENSIVE_BUFF_TYPES = new Set([
    "patkUp", "matkUp", "atkUp", "elemDmgUp", "enliven", "haste", "exploitWeakness",
    "physDmgBonus", "magDmgBonus", "elemDmgBonus",
    "physWeaponBoost", "magWeaponBoost", "elemWeaponBoost",
    "elemMastery", "physAtbConservation", "magAtbConservation", "elemAtbConservation",
    "ampElemAbilities", "ampPhysAbilities", "ampMagAbilities"
  ]);
  const DEFENSIVE_BUFF_TYPES = new Set([
    "pdefUp", "mdefUp", "defUp", "elemResistUp", "physResistUp", "magResistUp",
    "barrier", "regen", "veil", "provoke", "hpGain",
    "removePoison", "removeSilence", "removeBlind", "removeSleep", "removeParalyze", "removeStun", "removeSlow", "removeStop",
    "removePatkDown", "removeMatkDown", "removePdefDown", "removeMdefDown"
  ]);
  const ELEMENT_LABEL = { fire: "Fire", ice: "Ice", lightning: "Lightning", wind: "Wind", water: "Water", earth: "Earth", nonelem: "Non-elem" };
  const ARCH_LABEL = { phys: "Phys.", mag: "Mag.", hybrid: "Phys./Mag.", any: "Any" };
  const RANGE_LABEL = { self: "Self", allAllies: "All Allies", allEnemies: "All Enemies", singleEnemy: "Single Enemy", singleAlly: "Single Ally", allyExcludingSelf: "Ally Except Self" };
  const CONDITION_LABEL = {
    firstUse: "First Use", selfHpGe50: "Self HP >=50%", selfHpGe70: "Self HP >=70%",
    selfHpLt50: "Self HP <50%", selfHpLe30: "Self HP <=30%", selfHpLe90: "Self HP <=90%", selfHpEq100: "Self HP =100%", overspeedOff: "Overspeed Off",
    overspeedOn: "Overspeed On", hitWeakness: "Hit Weakness", selfHasBuff: "Self Has Buff", targetHasDebuff: "Target Has Debuff",
    matchingSigil: "Matching Sigil", singleTarget: "Single Target", onCritical: "Critical Hit", stanceGaugeMax: "Stance Gauge Max"
  };
  const MAX_DISPLAY_BUILDS = 10;
  const DEFAULT_TIERED_MIN_TIER = 3;
  const HIGH_TIER_THRESHOLD = 3;
  const NEAR_OPTIMAL_OBJECTIVE_RATIO = 0.96;
  const DEFAULT_ANCHOR_HEAL_THRESHOLD = 47;
  // Cura materia is 100%; All (Cure Spells) I applies -40%, so an All Cure
  // support slot is treated as inferred 60% AOE healing for display/scoring.
  const ALL_CURE_INFERRED_HEAL_POTENCY = 60;
  // Gear Command Abilities and Ultimate Weapon U.C. Abilities are limited-use actions.
  // They can still satisfy coverage, but active buff/debuff/amp utility should rank below sustained weapon coverage.
  const LIMITED_USE_ACTIVE_UTILITY_COVERAGE_FACTOR = 0.55;
  const exclusiveGroups = [["Sephiroth", "Seph OG"]];

  function cleanText(v) {
    return v === null || v === undefined ? "" : v.toString().trim();
  }

  function normalizeTier(v, fallback) {
    if (v === null || v === undefined || v === "") return fallback || 0;
    const s = v.toString().trim();
    const numeric = Number(s);
    if (!isNaN(numeric) && numeric > 0) return numeric;
    return TIER_VALUE[s] || TIER_VALUE[s.toLowerCase()] || fallback || 0;
  }

  function parseBool(v) {
    if (v === true) return true;
    const s = cleanText(v).toLowerCase();
    return ["true", "yes", "y", "1", "needed", "need", "healer", "on"].includes(s);
  }

  function normalizeDamageAssumption(v) {
    const s = cleanText(v).toLowerCase().replace(/\s+/g, "");
    if (["optimistic", "opt", "best", "bestcase", "best-case"].includes(s)) return "optimistic";
    if (["baseonly", "base", "off", "none", "false", "0"].includes(s)) return "baseOnly";
    return "conservative";
  }

  function splitCondition(when) {
    return cleanText(when).split("&").map(w => w.trim()).filter(Boolean);
  }

  function elemLabel(elem) {
    const e = cleanText(elem).toLowerCase();
    return ELEMENT_LABEL[e] || (e ? e.charAt(0).toUpperCase() + e.slice(1) : "");
  }

  function archLabel(arch) {
    const a = cleanText(arch).toLowerCase();
    return ARCH_LABEL[a] || (a ? a.charAt(0).toUpperCase() + a.slice(1) : "Any");
  }

  function tierDisplay(tier) {
    const t = normalizeTier(tier, 0);
    return t ? `${TIER_LABEL[t] || ("T" + t)}` : "";
  }

  function effectDisplayName(kind, type, elem, status, target) {
    const t = cleanText(type || status || target);
    const e = cleanText(elem).toLowerCase();
    if (kind === "set" && t === "allCure") return "All Cure Materia Support";
    if (kind === "set" && t === "allEsuna") return "All Esuna Support";
    if (kind === "amp" && t === "buff") return "Amp. Buffs";
    if (kind === "amp" && t === "debuff") return "Amp. Debuffs";
    if (status) return status.charAt(0).toUpperCase() + status.slice(1);
    const map = {
      patkUp: "PATK Up", matkUp: "MATK Up", atkUp: "ATK Up", pdefUp: "PDEF Up", mdefUp: "MDEF Up", defUp: "DEF Up",
      patkDown: "PATK Down", matkDown: "MATK Down", atkDown: "ATK Down", pdefDown: "PDEF Down", mdefDown: "MDEF Down", defDown: "DEF Down",
      elemDmgUp: e && e !== "none" ? `${elemLabel(e)} Pot. Up` : "Elem. Pot. Up",
      elemDmgDown: e && e !== "none" ? `${elemLabel(e)} Pot. Down` : "Elem. Pot. Down",
      elemResistUp: e && e !== "none" ? `${elemLabel(e)} Resist. Up` : "Elem. Resist. Up",
      elemResistDown: e && e !== "none" ? `${elemLabel(e)} Resist. Down` : "Elem. Resist. Down",
      physResistUp: "Phys. Resist. Up", magResistUp: "Mag. Resist. Up",
      haste: "Haste", enliven: "Enliven", enfeeble: "Enfeeble", exploitWeakness: "Exploit Weakness",
      physDmgBonus: "Physical Damage Bonus", magDmgBonus: "Magic Damage Bonus", elemDmgBonus: e && e !== "none" ? `${elemLabel(e)} Damage Bonus` : "Elemental Damage Bonus",
      physWeaponBoost: "Physical Weapon Boost", magWeaponBoost: "Magic Weapon Boost", elemWeaponBoost: e && e !== "none" ? `${elemLabel(e)} Weapon Boost` : "Elemental Weapon Boost",
      physDmgRcvdUp: "Single-Tgt. Phys. Dmg. Rcvd. Up", magDmgRcvdUp: "Single-Tgt. Mag. Dmg. Rcvd. Up", elemDmgRcvdUp: e && e !== "none" ? `${elemLabel(e)} Dmg. Rcvd. Up` : "Elem. Dmg. Rcvd. Up", dmgRcvdUp: "Dmg. Rcvd. Up",
      hpGain: "HP Gain", regen: "Regen", barrier: "Barrier", provoke: "Provoke", veil: "Veil", quintInterrupt: "Quintessential Interruption",
      overspeed: "Overspeed Gauge", limit: "Limit Gauge", atb: "ATB Gauge", atbGift: "ATB Gauge", gearUses: "Gear C. Ability Uses", command: "Command Fill Gauge",
      removePoison: "Remove Poison", removeSilence: "Remove Silence", removeBlind: "Remove Blind", removeSleep: "Remove Sleep", removeParalyze: "Remove Paralyze", removeStun: "Remove Stun", removeSlow: "Remove Slow", removeStop: "Remove Stop",
      removePatkDown: "Remove PATK Down", removeMatkDown: "Remove MATK Down", removePdefDown: "Remove PDEF Down", removeMdefDown: "Remove MDEF Down", removeMdefUp: "Remove MDEF Up",
      pdefBoost: "Boost PDEF", mdefBoost: "Boost MDEF", healingBoost: "Boost HEAL",
      elemMastery: e && e !== "none" ? `${elemLabel(e)} Mastery` : "Elemental Mastery",
      physAtbConservation: "Phys. ATB Conservation", magAtbConservation: "Mag. ATB Conservation", elemAtbConservation: e && e !== "none" ? `${elemLabel(e)} ATB Conservation` : "Elemental ATB Conservation",
      physInterruptUp: "Phys. Interrupt Up", magicInterruptUp: "Mag. Interrupt Up", elemInterruptUp: e && e !== "none" ? `${elemLabel(e)} Interrupt Up` : "Elemental Interrupt Up",
      ampHealing: "Amp. Healing", ampElemAbilities: e && e !== "none" ? `Amp. ${elemLabel(e)} Abilities` : "Amp. Elemental Abilities", elemWeakness: e && e !== "none" ? `${elemLabel(e)} Weakness` : "Elemental Weakness"
    };
    if (map[t]) return map[t];
    return t || kind;
  }

  function whenDisplay(when) {
    if (!when) return "";
    return when.split("&").map(w => {
      if (w.startsWith("custom:")) return w.slice(7).charAt(0).toUpperCase() + w.slice(8) + " Custom";
      if (w.startsWith("status:")) return "Status: " + w.slice(7);
      return CONDITION_LABEL[w] || w;
    }).join(" + ");
  }

  function canonicalizeTypeAndElem(type, elem) {
    let t = cleanText(type);
    let e = cleanText(elem).toLowerCase() || "none";
    if (!t) return { type: t, elem: e };

    const lower = t.toLowerCase();
    const elementPrefix = lower.match(/^(fire|ice|lightning|wind|water|earth)(dmgup|dmgdown|resistup|resistdown|dmgbonus|weaponboost|dmgrcvdup|mastery|interruptup|atbconservation|weakness|abilities)$/);
    if (elementPrefix) {
      const element = elementPrefix[1];
      const suffix = elementPrefix[2];
      const suffixMap = {
        dmgup: "elemDmgUp",
        dmgdown: "elemDmgDown",
        resistup: "elemResistUp",
        resistdown: "elemResistDown",
        dmgbonus: "elemDmgBonus",
        weaponboost: "elemWeaponBoost",
        dmgrcvdup: "elemDmgRcvdUp",
        mastery: "elemMastery",
        interruptup: "elemInterruptUp",
        atbconservation: "elemAtbConservation",
        weakness: "elemWeakness",
        abilities: "ampElemAbilities"
      };
      return { type: suffixMap[suffix], elem: element };
    }

    const alias = {
      windDmgUp: { type: "elemDmgUp", elem: "wind" },
      singleTgtPhysDmgRcvdUp: { type: "physDmgRcvdUp", elem: "none" },
      singleTgtMagDmgRcvdUp: { type: "magDmgRcvdUp", elem: "none" },
      physicalDmgRcvdUp: { type: "physDmgRcvdUp", elem: "none" },
      magicalDmgRcvdUp: { type: "magDmgRcvdUp", elem: "none" },
      magicDmgRcvdUp: { type: "magDmgRcvdUp", elem: "none" },
      elementalDmgRcvdUp: { type: "elemDmgRcvdUp", elem: e }
    };
    if (alias[t]) {
      const a = alias[t];
      return { type: a.type, elem: a.elem === "none" ? e : a.elem };
    }
    return { type: t, elem: e };
  }

  const target = {
    weakArch: weakArch ? cleanText(weakArch).toLowerCase() : null,
    weakElem: weakElem ? cleanText(weakElem).toLowerCase() : null,
    healerNeeded: parseBool(healerNeeded),
    damageAssumption: normalizeDamageAssumption(damageAssumption),
    anchorHealThreshold: Math.max(1, Number(anchorHealThreshold) || DEFAULT_ANCHOR_HEAL_THRESHOLD)
  };

  function inferPyramidLayer(kind, type) {
    if (type === "torpor") return 6;
    if (type === "elemWeaponBoost" || type === "physWeaponBoost" || type === "magWeaponBoost") return 5;
    if (type === "elemDmgBonus" || type === "physDmgBonus" || type === "magDmgBonus") return 4;
    if (type === "exploitWeakness" || type === "physDmgRcvdUp" || type === "magDmgRcvdUp" || type === "elemDmgRcvdUp" || type === "dmgRcvdUp") return 3;
    if (type === "enliven" || type === "enfeeble") return 2;
    if (kind === "amp" && (type === "buff" || type === "debuff")) return 2;
    if (TIERED_TYPES.has(type)) return 1;
    return 0;
  }

  function desiredKey(d) {
    return [d.kind, d.type, d.elem || "none", d.minTier || 0].join(":");
  }

  function desiredLabel(d) {
    const name = effectDisplayName(d.kind, d.type, d.elem, d.status, d.target);
    const tierPart = d.minTier ? ` >=${tierDisplay(d.minTier)}` : "";
    return `${d.kind}: ${name}${tierPart}`;
  }

  function parseDesiredList(str, kind) {
    if (!str) return [];
    return str.toString().split(",").map(raw => raw.trim()).filter(Boolean).map(raw => {
      let text = raw.replace(/^buff:/i, "").replace(/^debuff:/i, "").trim();
      const ampMatch = text.match(/^amp(?:\s+target\s*=\s*|:)(buff|debuff)s?$/i);
      if (ampMatch) {
        const d = { kind: "amp", type: ampMatch[1].toLowerCase(), elem: "none", minTier: 0, key: null, layer: 2 };
        d.key = desiredKey(d);
        return d;
      }
      text = text.replace(/\s*tier\s*=\s*/i, ":").replace(/\s*=\s*/g, ":");
      const parts = text.split(":").map(p => p.trim()).filter(Boolean);
      let type = parts[0];
      let elem = null;
      let explicitTier = null;

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const tier = normalizeTier(p, null);
        if (tier) explicitTier = tier;
        else elem = p;
      }

      const canon = canonicalizeTypeAndElem(type, elem || "none");
      type = canon.type;
      elem = canon.elem && canon.elem !== "none" ? canon.elem : elem;
      let minTier = TIERED_TYPES.has(type) ? DEFAULT_TIERED_MIN_TIER : 0;
      if (explicitTier) minTier = explicitTier;

      if ((!elem || elem === "none") && ELEMENTAL_TYPES.has(type) && target.weakElem && target.weakElem !== "nonelem") elem = target.weakElem;
      const d = { kind, type, elem: elem || "none", minTier, key: null, layer: inferPyramidLayer(kind, type) };
      d.key = desiredKey(d);
      return d;
    });
  }

  const explicitBuffs = parseDesiredList(wantBuffsStr, "buff");
  const explicitDebuffs = parseDesiredList(wantDebuffsStr, "debuff");
  const implicitBuffs = [];
  const implicitUtility = [];
  const synergyDisplayList = [];
  function addImplicitBuff(type, minTier, label, elem, layer) {
    const d = { kind: "buff", type, elem: elem || "none", minTier: minTier || 0, layer: layer || inferPyramidLayer("buff", type) };
    d.key = desiredKey(d);
    implicitBuffs.push(d);
    synergyDisplayList.push(label + (minTier ? ` (${TIER_LABEL[minTier]})` : ""));
  }
  function addImplicitUtility(kind, type, minTier, label, layer) {
    const d = { kind, type, elem: "none", minTier: minTier || 0, layer: layer || inferPyramidLayer(kind, type) };
    d.key = desiredKey(d);
    implicitUtility.push(d);
    synergyDisplayList.push(label + (minTier ? ` (${TIER_LABEL[minTier]})` : ""));
  }

  if (!manualCoverageMode && (target.weakArch || target.weakElem)) {
    // Pyramid Layer 1: primary offensive status tier targets.
    if (target.weakArch === "phys") addImplicitBuff("patkUp", 3, "L1: PATK Up", "none", 1);
    if (target.weakArch === "mag") addImplicitBuff("matkUp", 3, "L1: MATK Up", "none", 1);
    if (target.weakElem && target.weakElem !== "nonelem") addImplicitBuff("elemDmgUp", 3, `L1: ${elemLabel(target.weakElem)} Pot. Up`, target.weakElem, 1);

    // Pyramid Layer 2: general acceleration / availability.
    addImplicitBuff("enliven", 0, "L2: Enliven", "none", 2);
    addImplicitUtility("amp", "buff", 0, "L2: Amp Buffs", 2);
    if (explicitDebuffs.length > 0) addImplicitUtility("amp", "debuff", 0, "L2: Amp Debuffs", 2);

    // Pyramid Layer 3: weakness exploitation traits. Enemy-side Damage Received Up is debuff-immunity-sensitive,
    // so physDmgRcvdUp/magDmgRcvdUp/elemDmgRcvdUp/torpor are left to explicit debuff input.
    if (target.weakElem && target.weakElem !== "nonelem") addImplicitBuff("exploitWeakness", 0, "L3: Exploit Weakness", "none", 3);

    // Pyramid Layer 4: broad damage bonuses.
    if (target.weakArch === "phys") addImplicitBuff("physDmgBonus", 0, "L4: Physical Damage Bonus", "none", 4);
    if (target.weakArch === "mag") addImplicitBuff("magDmgBonus", 0, "L4: Magic Damage Bonus", "none", 4);
    if (target.weakElem && target.weakElem !== "nonelem") addImplicitBuff("elemDmgBonus", 0, `L4: ${elemLabel(target.weakElem)} Damage Bonus`, target.weakElem, 4);

    // Pyramid Layer 5: weapon/element boost traits.
    if (target.weakArch === "phys") addImplicitBuff("physWeaponBoost", 0, "L5: Physical Weapon Boost", "none", 5);
    if (target.weakArch === "mag") addImplicitBuff("magWeaponBoost", 0, "L5: Magic Weapon Boost", "none", 5);
    if (target.weakElem && target.weakElem !== "nonelem") addImplicitBuff("elemWeaponBoost", 0, `L5: ${elemLabel(target.weakElem)} Weapon Boost`, target.weakElem, 5);
  }

  const desiredMap = new Map();
  [...explicitBuffs, ...implicitBuffs, ...implicitUtility, ...explicitDebuffs].forEach(d => {
    if (d.layer === undefined || d.layer === null) d.layer = inferPyramidLayer(d.kind, d.type);
    desiredMap.set(d.key, d);
  });
  const desiredList = Array.from(desiredMap.values());
  const wantedKeys = new Set(desiredList.map(d => d.key));

  const headers = equipmentsData[0].map(h => cleanText(h).toLowerCase());
  const idxId = headers.indexOf("id");
  const idxChar = headers.indexOf("character");
  const idxType = headers.indexOf("type");
  const idxName = headers.indexOf("name");
  const idxHeld = headers.indexOf("held");
  const idxCArch = headers.indexOf("c_arch");
  const idxCElem = headers.indexOf("c_elem");
  const idxCPot = headers.indexOf("c_pot") >= 0 ? headers.indexOf("c_pot") : headers.indexOf("c_dmg");
  const idxCMod = headers.indexOf("c_mod");
  const idxCaps = headers.indexOf("caps");
  const schemaWarnings = [];
  if (idxCaps < 0) schemaWarnings.push("Input range is missing the caps column. With the c_mod schema, pass Equipments!A:N; A:M stops at customs and will produce blank Utility / Capabilities and Team Total Coverage Summary.");
  if (idxCMod < 0) schemaWarnings.push("Input range is missing the c_mod column. Damage modifiers will be ignored; pass Equipments!A:N for the current schema.");

  function parseCMods(str) {
    const mods = [];
    if (!str) return mods;
    str.split(";").map(s => s.trim()).filter(Boolean).forEach(modStr => {
      const attrs = {};
      modStr.split(/\s+/).forEach(p => {
        const eq = p.indexOf("=");
        if (eq > -1) attrs[p.slice(0, eq)] = p.slice(eq + 1);
      });
      const mult = attrs.mult !== undefined ? Number(attrs.mult) : null;
      const add = attrs.add !== undefined ? Number(attrs.add) : null;
      if ((mult && !isNaN(mult)) || (add && !isNaN(add))) {
        mods.push({
          mult: mult && !isNaN(mult) ? mult : null,
          add: add && !isNaN(add) ? add : null,
          when: attrs.when || ""
        });
      }
    });
    return mods;
  }

  const resolvedItems = [];

  for (let i = 1; i < equipmentsData.length; i++) {
    const row = equipmentsData[i];
    if (!row[idxId] || !row[idxChar]) continue;
    if (row[idxHeld] !== true && cleanText(row[idxHeld]).toUpperCase() !== "TRUE") continue;

    const item = {
      id: cleanText(row[idxId]),
      character: cleanText(row[idxChar]),
      type: cleanText(row[idxType]).toLowerCase(),
      name: cleanText(row[idxName]),
      c_arch: row[idxCArch] ? cleanText(row[idxCArch]).toLowerCase() : null,
      c_elem: row[idxCElem] ? cleanText(row[idxCElem]).toLowerCase() : null,
      c_pot: Number(row[idxCPot]) || 0,
      c_mod: idxCMod >= 0 && row[idxCMod] ? cleanText(row[idxCMod]) : "",
      caps: row[idxCaps] ? cleanText(row[idxCaps]) : ""
    };

    const capabilities = [];
    const damageMods = parseCMods(item.c_mod);
    const damageHits = [];
    const healHits = [];
    const customOptions = new Set([null]);

    if (item.c_pot > 0 && item.c_elem === "heal") {
      // Heal range is carried by optional `heal range=...` caps; those caps are hidden from utility display.
      healHits.push({ pot: item.c_pot, range: "unknown", custom: null, source: "headline" });
      capabilities.push({ kind: "heal", type: "heal", elem: "none", range: "unknown", tier: item.c_pot, custom: null, label: "heal" });
    } else if (item.c_pot > 0 && item.c_arch && item.c_elem) {
      damageHits.push({ arch: item.c_arch, elem: item.c_elem, pot: item.c_pot, custom: null, mods: damageMods });
      capabilities.push({ kind: "dmg", type: "elem", elem: item.c_elem, range: "none", tier: 0, custom: null, label: `dmg ${item.c_elem}` });
      capabilities.push({ kind: "dmg", type: "arch", elem: item.c_arch, range: "none", tier: 0, custom: null, label: `dmg ${item.c_arch}` });
    }

    if (item.caps) {
      item.caps.split(";").map(s => s.trim()).filter(Boolean).forEach(capStr => {
        const parts = capStr.split(/\s+/);
        const kind = parts[0];
        let attrs = {};
        parts.slice(1).forEach(p => {
          const eq = p.indexOf("=");
          if (eq > -1) attrs[p.slice(0, eq)] = p.slice(eq + 1);
        });

        let customTag = null;
        if (attrs.when) {
          const customMatch = attrs.when.split("&").find(w => w.startsWith("custom:"));
          if (customMatch) {
            customTag = customMatch.split(":")[1];
            customOptions.add(customTag);
          }
        }

        if (kind === "dmg") {
          const dArch = attrs.arch || item.c_arch;
          const dElem = attrs.elem || item.c_elem;
          const dPot = Number(attrs.mod || attrs.pot || 0);
          if (dArch && dElem && dPot > 0) {
            damageHits.push({ arch: dArch, elem: dElem, pot: dPot, custom: customTag, mods: [] });
            capabilities.push({ kind: "dmg", type: "elem", elem: dElem, range: "none", tier: 0, custom: customTag, label: `dmg ${dElem}` });
            capabilities.push({ kind: "dmg", type: "arch", elem: dArch, range: "none", tier: 0, custom: customTag, label: `dmg ${dArch}` });
          }
          return;
        }

        if (kind === "heal") {
          const pot = Number(attrs.pot || attrs.mod || item.c_pot || 0);
          healHits.push({ pot, range: attrs.range || "unknown", custom: customTag, source: "cap" });
          capabilities.push({ kind: "heal", type: "heal", elem: "none", range: attrs.range || "unknown", tier: pot, custom: customTag, label: "heal" });
          return;
        }

        const rawType = attrs.type || attrs.status || attrs.target || null;
        if (!rawType) return;
        const canon = canonicalizeTypeAndElem(rawType, attrs.elem || "none");
        const cleanType = canon.type;
        const tier = normalizeTier(attrs.tier, 0);
        capabilities.push({
          kind,
          type: cleanType,
          elem: canon.elem || "none",
          status: attrs.status || null,
          target: attrs.target || null,
          range: attrs.range || "none",
          tier,
          custom: customTag,
          mode: attrs.mode || null,
          when: attrs.when || null,
          label: capStr
        });
      });
    }

    resolvedItems.push({ item, damage: damageHits, healing: healHits, capabilities, customOptions });
  }

  function customOptionsFor(r, chosenCustom) {
    const customToUse = chosenCustom !== undefined ? chosenCustom : (r.chosenCustom !== undefined ? r.chosenCustom : "AUTO");
    return customToUse === "AUTO" ? Array.from(r.customOptions) : [customToUse];
  }

  function hasElementTarget() {
    return !!(target.weakElem && target.weakElem !== "none" && target.weakElem !== "nonelem");
  }

  function archMatchesTarget(d) {
    return !target.weakArch || d.arch === target.weakArch || d.arch === "hybrid" || d.arch === "any";
  }

  function elemMatchesTarget(d, requireExactElement) {
    if (!target.weakElem) return true;
    if (target.weakElem === "nonelem") return d.elem === "nonelem";
    if (d.elem === target.weakElem) return true;
    return !requireExactElement && d.elem === "nonelem";
  }

  function getDamageFitTier(d, requireExactElement) {
    const archMatch = archMatchesTarget(d);
    const elemMatch = target.weakElem && d.elem === target.weakElem;
    if (!archMatch || !elemMatchesTarget(d, requireExactElement)) return 0;
    if ((target.weakArch && archMatch) && elemMatch) return 4;
    if (elemMatch) return 3;
    if (target.weakArch && archMatch && d.elem === "nonelem") return 2;
    return 1;
  }

  function conditionSupportedForDamageMod(cond, context) {
    if (!cond) return true;
    if (target.damageAssumption === "optimistic") return true;
    if (target.damageAssumption === "baseOnly") return false;

    const ctx = context || {};
    return splitCondition(cond).every(c => {
      if (c === "targetHasDebuff") return !!ctx.teamHasDebuff;
      if (c === "selfHasBuff") return !!ctx.teamHasBuff || !!ctx.memberHasSelfBuff;
      if (c === "hitWeakness") return !!ctx.hitsWeakness;
      if (["selfHpGe50", "selfHpGe70", "selfHpEq100"].includes(c)) return !!ctx.teamHasAnchorHealer;
      if (["selfHpLe30", "selfHpLt50"].includes(c)) return false;
      return false;
    });
  }

  function getEffectivePot(d, context) {
    let pot = Number(d && d.pot || 0);
    if (!d || !d.mods || !d.mods.length) return pot;
    d.mods.forEach(mod => {
      if (!conditionSupportedForDamageMod(mod.when, context)) return;
      if (mod.mult) pot *= mod.mult;
      // Flat added damage is deliberately display-only for now because FF7EC meta ranking is potency and B/D stacking driven.
    });
    return Math.round(pot);
  }

  function getWeaponScore(r, chosenCustom, options) {
    if (!r) return 0;
    const requireExactElement = !!(options && options.requireExactElement);
    const contextBase = options && options.context ? options.context : {};
    let maxScore = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.damage.forEach(d => {
        if (d.custom !== null && d.custom !== opt) return;
        const fitTier = getDamageFitTier(d, requireExactElement);
        if (fitTier > 0) {
          const effectivePot = getEffectivePot(d, Object.assign({}, contextBase, { hitsWeakness: fitTier >= 3 }));
          maxScore = Math.max(maxScore, fitTier * 1000000 + effectivePot);
        }
      });
    });
    return maxScore;
  }

  function getAnchorDpsScore(r, chosenCustom) {
    return getWeaponScore(r, chosenCustom, { requireExactElement: hasElementTarget() });
  }

  function getAnchorSustainedDamage(r, chosenCustom, context) {
    return getSuitingDamage(r, chosenCustom, {
      requireExactElement: hasElementTarget(),
      context: context || {},
    });
  }

  function hasNaturalTargetMatch(r, chosenCustom) {
    if (!r || !r.damage) return false;
    let found = false;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.damage.forEach(d => {
        if (d.custom !== null && d.custom !== opt) return;
        // "Natural fit" means the weapon's basic command shape matches the
        // target archetype + element. Potency is not part of the condition.
        if (getDamageFitTier(d, true) >= 4) found = true;
      });
    });
    return found;
  }

  function capSatisfiesDesired(cap, desired, isMemberAnchor) {
    if (!cap || !desired) return false;

    if (cap.kind !== desired.kind) return false;
    if (cap.type !== desired.type) return false;

    const desiredElem = desired.elem || "none";
    if (ELEMENTAL_TYPES.has(desired.type) && desiredElem !== "none") {
      if ((cap.elem || "none") !== desiredElem) return false;
    }

    if ((desired.minTier || 0) > 0 && (cap.tier || 0) < desired.minTier) return false;

    // Self-only offensive buffs only satisfy desired team coverage when the
    // member is an anchor. Support self-buffs should not be counted as team utility.
    if (cap.range === "self" && !isMemberAnchor && !SELF_OK_TYPES.has(cap.type)) return false;

    return true;
  }

  function limitedUseLabel(r) {
    if (!r || !r.item) return "Limited-use";
    if (r.item.type === "ultimate") return "Limited-use U.C. Ability";
    if (r.item.type === "gear") return "Limited-use Gear C. Ability";
    return "Limited-use";
  }

  function isLimitedUseActiveUtility(r, cap) {
    if (!r || !r.item || !cap) return false;
    if (r.item.type !== "ultimate" && r.item.type !== "gear") return false;
    if (cap.kind === "dmg" || cap.kind === "heal") return false;
    if (cap.mode === "passive") return false;
    return true;
  }

  function isDefensiveBuffDesired(desired) {
    return !!(
      desired &&
      desired.kind === "buff" &&
      DEFENSIVE_BUFF_TYPES.has(desired.type)
    );
  }

  function getCoverageRangeScore(cap, desired, isMemberAnchor) {
    const range = cap.range || "none";

    // Defensive buffs are team-survival tools. Prefer AOE heavily; a self-only
    // defensive buff can still be useful on an anchor, but should not compete
    // closely with party-wide mitigation.
    if (isDefensiveBuffDesired(desired)) {
      return {
        allAllies: 160000,
        allyExcludingSelf: 70000,
        singleAlly: 25000,
        self: isMemberAnchor ? 8000 : -20000,
        allEnemies: 0,
        singleEnemy: 0,
        none: 0,
        unknown: 0,
      }[range] || 0;
    }

    return {
      allAllies: 4000,
      allEnemies: 4000,
      singleEnemy: 2500,
      singleAlly: 1800,
      self: isMemberAnchor ? 1200 : 0,
      allyExcludingSelf: 1800,
      none: 0,
      unknown: 0,
    }[range] || 0;
  }

  function coverageScoreForCap(r, cap, desired, isMemberAnchor) {
    const layer = desired.layer || inferPyramidLayer(desired.kind, desired.type);
    const layerWeight = {
      1: 500000,
      2: 350000,
      3: 250000,
      4: 160000,
      5: 140000,
      6: 120000,
    }[layer] || 100000;

    const tierScore = (cap.tier || 0) * 10000;

    const rangeScore = getCoverageRangeScore(cap, desired, isMemberAnchor);

    // Conditional defensive mitigation is a bigger concern than conditional
    // offensive support, because missed uptime can mean a wipe.
    const conditionScore = isDefensiveBuffDesired(desired) && cap.when ? -5000 : cap.when ? -500 : 0;
    const limitedFactor = isLimitedUseActiveUtility(r, cap) ? LIMITED_USE_ACTIVE_UTILITY_COVERAGE_FACTOR : 1;

    return Math.round((layerWeight + tierScore + rangeScore + conditionScore) * limitedFactor);
  }

  function getCoverageMapForItem(r, isMemberAnchor) {
    const map = new Map();
    if (!r || !r.capabilities) return map;

    r.capabilities.forEach(cap => {
      if (cap.custom !== null && cap.custom !== r.chosenCustom) return;
      if (cap.kind === "dmg" || cap.kind === "heal") return;
      if (cap.mode === "passive") return;

      desiredList.forEach(desired => {
        if (!capSatisfiesDesired(cap, desired, isMemberAnchor)) return;

        const key = desired.key;
        const score = coverageScoreForCap(r, cap, desired, isMemberAnchor);
        const entry = {
          desired,
          cap,
          tier: cap.tier || 0,
          score,
          itemId: r.item.id,
          itemName: r.item.name,
        };

        const prev = map.get(key);
        if (!prev || entry.score > prev.score) map.set(key, entry);
      });
    });

    return map;
  }

  function getIncrementalCoverageScoreForItem(r, isMemberAnchor, chosenCustom, localCoverageMap) {
    if (!r) return 0;

    const pick = Object.assign({}, r, { chosenCustom });
    const coverage = getCoverageMapForItem(pick, isMemberAnchor);
    let score = 0;

    coverage.forEach((entry, key) => {
      const prev = localCoverageMap && localCoverageMap.get(key);
      if (!prev) {
        score += entry.score;
      } else if (entry.score > prev.score) {
        // Small reward for improving an already-covered token, but much less
        // than adding a new selected effect.
        score += Math.max(0, entry.score - prev.score) * 0.1;
      }
    });

    return score;
  }

  function getNaturalTargetMatchScore(r, chosenCustom) {
    return hasNaturalTargetMatch(r, chosenCustom) ? 1 : 0;
  }

  function getAnchorWeaponPriorityScore(r, chosenCustom, localCoverageMap, isAnchor, context) {
    const dps = getAnchorSustainedDamage(r, chosenCustom, context);
    if (dps <= 0) return -Infinity;

    const coverage = getIncrementalCoverageScoreForItem(
      r,
      isAnchor,
      chosenCustom,
      localCoverageMap
    );

    // Anchor weapon selection is DPS-first. Coverage is only a secondary tie-breaker.
    return dps * 1000000 + coverage;
  }

  function getSuitingDamage(r, chosenCustom, options) {
    if (!r) return 0;
    const requireExactElement = !!(options && options.requireExactElement);
    const contextBase = options && options.context ? options.context : {};
    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.damage.forEach(d => {
        if (d.custom !== null && d.custom !== opt) return;
        const fitTier = getDamageFitTier(d, requireExactElement);
        if (fitTier > 0) best = Math.max(best, getEffectivePot(d, Object.assign({}, contextBase, { hitsWeakness: fitTier >= 3 })));
      });
    });
    return best;
  }

  function getHealScore(r, chosenCustom) {
    if (!r) return 0;
    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.healing.forEach(h => {
        if (h.custom !== null && h.custom !== opt) return;
        best = Math.max(best, h.pot || 0);
      });
    });
    return best;
  }

  function hasAllCureSupport(r, chosenCustom) {
    if (!r || !r.capabilities) return false;
    let found = false;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.capabilities.forEach(cap => {
        if (cap.custom !== null && cap.custom !== opt) return;
        if (cap.kind === "set" && cap.type === "allCure") found = true;
      });
    });
    return found;
  }

  function getAllCureInferredHealPotency(r, chosenCustom) {
    return hasAllCureSupport(r, chosenCustom) ? ALL_CURE_INFERRED_HEAL_POTENCY : 0;
  }

  function getDisplayedHealScore(r, chosenCustom) {
    return Math.max(
      getHealScore(r, chosenCustom),
      getAllCureInferredHealPotency(r, chosenCustom)
    );
  }

  function getTeamHealScore(r, chosenCustom) {
    if (!r) return 0;
    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      const allCure = hasAllCureSupport(r, opt);
      r.healing.forEach(h => {
        if (h.custom !== null && h.custom !== opt) return;
        const range = h.range || "unknown";
        if (range === "allAllies" || allCure) best = Math.max(best, h.pot || 0);
      });
      if (allCure) best = Math.max(best, ALL_CURE_INFERRED_HEAL_POTENCY);
    });
    return best;
  }

  function isRegularWeapon(r) {
    return !!(r && r.item && r.item.type !== "gear" && r.item.type !== "ultimate");
  }

  function getDirectWeaponHealPotency(r, chosenCustom) {
    if (!isRegularWeapon(r)) return 0;
    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.healing.forEach(h => {
        if (h.custom !== null && h.custom !== opt) return;
        best = Math.max(best, h.pot || 0);
      });
    });
    return best;
  }

  function getDirectWeaponPartyHealPotency(r, chosenCustom) {
    if (!isRegularWeapon(r)) return 0;
    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.healing.forEach(h => {
        if (h.custom !== null && h.custom !== opt) return;
        if ((h.range || "unknown") !== "allAllies") return;
        best = Math.max(best, h.pot || 0);
      });
    });
    return best;
  }

  function hasWeaponAllCureSupport(r, chosenCustom) {
    if (!isRegularWeapon(r)) return false;
    let found = false;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      if (hasAllCureSupport(r, opt)) found = true;
    });
    return found;
  }

  function hasWeaponHealBoostSupport(r, chosenCustom) {
    if (!isRegularWeapon(r) || !r.capabilities) return false;
    let found = false;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.capabilities.forEach(cap => {
        if (cap.custom !== null && cap.custom !== opt) return;
        if (cap.type === "healingBoost" || cap.type === "healBoost" || cap.type === "boostHeal") found = true;
      });
    });
    return found;
  }

  function getAnchorHealerCategory(r, chosenCustom) {
    if (!isRegularWeapon(r)) return 0;

    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      const partyHeal = getDirectWeaponPartyHealPotency(r, opt);
      const nominalHeal = getDirectWeaponHealPotency(r, opt);
      const allCure = hasWeaponAllCureSupport(r, opt);
      const healBoost = hasWeaponHealBoostSupport(r, opt);

      // Absolute category ladder:
      // 4. AOE healing weapon ability >= threshold
      // 3. AOE materia support: All (Cure Spells)
      // 2. single/nominal healing weapon ability >= threshold
      // 1. single-heal materia support: HEAL Boost
      if (partyHeal >= target.anchorHealThreshold) best = Math.max(best, 4);
      if (allCure) best = Math.max(best, 3);
      if (nominalHeal >= target.anchorHealThreshold) best = Math.max(best, 2);
      if (healBoost) best = Math.max(best, 1);
    });

    return best;
  }

  function getAnchorHealerScore(r, chosenCustom) {
    if (!isRegularWeapon(r)) return 0;

    let best = 0;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      const category = getAnchorHealerCategory(r, opt);
      if (category <= 0) return;

      const partyHeal = getDirectWeaponPartyHealPotency(r, opt);
      const nominalHeal = getDirectWeaponHealPotency(r, opt);
      const partyExcess = Math.max(0, partyHeal - target.anchorHealThreshold);
      const nominalExcess = Math.max(0, nominalHeal - target.anchorHealThreshold);

      // Category dominates. Potency is only intra-category tie-breaking.
      best = Math.max(best, category * 1000000 + partyExcess * 100 + nominalExcess);
    });

    return best;
  }

  const charMap = new Map();
  resolvedItems.forEach(r => {
    const c = r.item.character;
    if (!charMap.has(c)) charMap.set(c, { character: c, weapons: [], ultimates: [], gear: [], topWeaponScore: 0, topAnchorDpsScore: 0, topHealScore: 0, topTeamHealScore: 0, topAnchorHealerScore: 0, topFallbackHealScore: 0 });
    const d = charMap.get(c);
    const score = getWeaponScore(r, "AUTO");
    const healScore = getHealScore(r, "AUTO");
    const teamHealScore = getTeamHealScore(r, "AUTO");
    const anchorHealerScore = getAnchorHealerScore(r, "AUTO");

    if (r.item.type === "gear") {
      d.gear.push(r);
    } else if (r.item.type === "ultimate") {
      d.ultimates.push(r);
    } else {
      d.weapons.push(r);
      d.topWeaponScore = Math.max(d.topWeaponScore, score);
      d.topAnchorHealerScore = Math.max(d.topAnchorHealerScore, anchorHealerScore);
      // Anchor DPS is intentionally still based on regular weapons, so a limited-use Gear/U.C. ability cannot
      // make an otherwise off-profile character become the primary DPS anchor by itself.
      d.topAnchorDpsScore = Math.max(d.topAnchorDpsScore, getAnchorDpsScore(r, "AUTO"));
    }

    // Healer qualification and supplemental scoring can come from regular weapons, Ultimate Weapons, or Gear C. Abilities.
    d.topHealScore = Math.max(d.topHealScore, healScore);
    d.topTeamHealScore = Math.max(d.topTeamHealScore, teamHealScore);
    d.topFallbackHealScore = Math.max(d.topFallbackHealScore, healScore);
  });

  const chars = Array.from(charMap.values());

  function isBlocked(chosenSet, charName) {
    for (const group of exclusiveGroups) {
      if (group.includes(charName) && group.some(m => chosenSet.has(m))) return true;
    }
    return false;
  }

  function chooseBestCustom(raw, isAnchor, localCoverageMap, roleKind) {
    let bestCustom = null;
    let bestScore = -Infinity;
    raw.customOptions.forEach(opt => {
      const incrementalCoverage = getIncrementalCoverageScoreForItem(raw, isAnchor, opt, localCoverageMap);

      let score;
      if (roleKind === "dps" || roleKind === "dpsHealer") {
        score = getAnchorWeaponPriorityScore(raw, opt, localCoverageMap, isAnchor);
      } else if (roleKind === "healer") {
        score = getHealScore(raw, opt) * 1000000 + incrementalCoverage;
      } else {
        score = incrementalCoverage * 1000000 + getWeaponScore(raw, opt) + getHealScore(raw, opt);
      }

      if (score > bestScore) { bestScore = score; bestCustom = opt; }
    });
    return bestCustom;
  }

  function buildLoadoutForMember(charData, globalCoveredBases, roleKind) {
    const isAnchor = roleKind === "dps" || roleKind === "healer" || roleKind === "dpsHealer";
    let localCoverageMap = new Map(globalCoveredBases);
    let wpnPicks = [];
    let wpns = [...charData.weapons];

    function commitPick(raw, custom) {
      const pick = Object.assign({}, raw, { chosenCustom: custom });
      getCoverageMapForItem(pick, isAnchor).forEach((v, k) => {
        const prev = localCoverageMap.get(k);
        if (!prev || v.score > prev.score) localCoverageMap.set(k, v);
      });
      wpnPicks.push(pick);
      return pick;
    }

    function removeAt(pool, idx) {
      return pool.splice(idx, 1)[0];
    }

    if ((roleKind === "dps" || roleKind === "dpsHealer") && wpns.length > 0) {
      let bestIdx = -1, bestCustom = null, bestScore = -Infinity;
      for (let i = 0; i < wpns.length; i++) {
        const raw = wpns[i];
        raw.customOptions.forEach(opt => {
          const score = getAnchorWeaponPriorityScore(raw, opt, localCoverageMap, true);
          if (score > bestScore) { bestScore = score; bestIdx = i; bestCustom = opt; }
        });
      }

      if (bestIdx > -1) commitPick(removeAt(wpns, bestIdx), bestCustom);
    }

    if ((roleKind === "healer" || roleKind === "dpsHealer") && wpns.length > 0) {
      const alreadyAnchorHeals = wpnPicks.some(w => getAnchorHealerScore(w, w.chosenCustom) > 0);
      if (!alreadyAnchorHeals) {
        let bestIdx = -1, bestScore = -Infinity, bestCustom = null;

        for (let i = 0; i < wpns.length; i++) {
          const raw = wpns[i];
          if (getAnchorHealerScore(raw, "AUTO") <= 0) continue;

          raw.customOptions.forEach(opt => {
            const category = getAnchorHealerCategory(raw, opt);
            if (category <= 0) return;

            const anchorHealerScore = getAnchorHealerScore(raw, opt);
            const incrementalCoverage = getIncrementalCoverageScoreForItem(raw, true, opt, localCoverageMap);
            const partyHeal = getDirectWeaponPartyHealPotency(raw, opt);
            const nominalHeal = getDirectWeaponHealPotency(raw, opt);
            const partyExcess = Math.max(0, partyHeal - target.anchorHealThreshold);
            const nominalExcess = Math.max(0, nominalHeal - target.anchorHealThreshold);
            const roleDps = roleKind === "dpsHealer" ? getAnchorSustainedDamage(raw, opt) : 0;

            // Hard source category first; utility coverage refines within category.
            // This guarantees All Cure support outranks single-ally heal weapon.
            const score = roleKind === "dpsHealer"
              ? category * 1000000000000000 + roleDps * 1000000 + incrementalCoverage * 1000 + partyExcess * 100 + nominalExcess
              : category * 1000000000000 + incrementalCoverage * 1000000 + partyExcess * 1000 + nominalExcess + anchorHealerScore;

            if (score > bestScore) {
              bestScore = score;
              bestIdx = i;
              bestCustom = opt;
            }
          });
        }

        if (bestIdx > -1) commitPick(removeAt(wpns, bestIdx), bestCustom);
      }
    }

    function pickOneMaximizeCoverage(pool) {
      let bestIdx = -1, bestCustomForChoice = null, bestScore = -Infinity;
      const isDpsRole = roleKind === "dps" || roleKind === "dpsHealer";
      const isHealerRole = roleKind === "healer" || roleKind === "dpsHealer";
      const alreadyHasAnchorHeal = wpnPicks.some(w => getAnchorHealerScore(w, w.chosenCustom) > 0);

      for (let i = 0; i < pool.length; i++) {
        const itemRaw = pool[i];
        itemRaw.customOptions.forEach(opt => {
          const incrementalCoverage = getIncrementalCoverageScoreForItem(itemRaw, isAnchor, opt, localCoverageMap);

          let score;
          if (isDpsRole) {
            // Second DPS weapon is utility-first; damage is tie-breaker.
            score = incrementalCoverage * 1000000 + getAnchorSustainedDamage(itemRaw, opt) + getDisplayedHealScore(itemRaw, opt);
          } else if (isHealerRole && alreadyHasAnchorHeal) {
            // Once the healer role is satisfied, do not eagerly chase DPS.
            // Prefer buff/debuff coverage, then extra party healing, then nominal healing.
            // Matching target damage is only a small tie-breaker if it naturally fits.
            score =
              incrementalCoverage * 100000000 +
              getDirectWeaponPartyHealPotency(itemRaw, opt) * 1000 +
              getDirectWeaponHealPotency(itemRaw, opt) +
              getNaturalTargetMatchScore(itemRaw, opt);
          } else {
            // Support is utility-first. Do not treat it as Flex DPS.
            score =
              incrementalCoverage * 1000000 +
              getDisplayedHealScore(itemRaw, opt) * 1000 +
              getNaturalTargetMatchScore(itemRaw, opt);
          }

          if (score > bestScore) { bestScore = score; bestIdx = i; bestCustomForChoice = opt; }
        });
      }

      if (bestIdx !== -1) return commitPick(removeAt(pool, bestIdx), bestCustomForChoice);
      return null;
    }

    while (wpnPicks.length < 2 && wpns.length > 0) {
      const pick = pickOneMaximizeCoverage(wpns);
      if (!pick) break;
    }

    let uwPool = [...charData.ultimates];
    let uwPick = null;
    if (uwPool.length > 0) {
      let bestIdx = -1, bestCustom = null, bestScore = -Infinity;
      for (let i = 0; i < uwPool.length; i++) {
        const raw = uwPool[i];
        raw.customOptions.forEach(opt => {
          const incrementalCoverage = getIncrementalCoverageScoreForItem(raw, isAnchor, opt, localCoverageMap);
          // Ultimate Weapon C. Ability damage is limited-use burst, not sustained DPS.
          // Keep UW selection utility-first; do not use its c_pot as a DPS tie-breaker.
          const score = incrementalCoverage * 1000000;
          if (score > bestScore) { bestScore = score; bestIdx = i; bestCustom = opt; }
        });
      }
      if (bestIdx > -1) {
        uwPick = Object.assign({}, uwPool[bestIdx], { chosenCustom: bestCustom });
        getCoverageMapForItem(uwPick, isAnchor).forEach((v, k) => {
          const prev = localCoverageMap.get(k);
          if (!prev || v.score > prev.score) localCoverageMap.set(k, v);
        });
      }
    }

    let gearPool = [...charData.gear];
    let gearPick = null;
    if (gearPool.length > 0) {
      let bestIdx = -1, bestCustom = null, bestScore = -Infinity;
      for (let i = 0; i < gearPool.length; i++) {
        const raw = gearPool[i];
        raw.customOptions.forEach(opt => {
          const incrementalCoverage = getIncrementalCoverageScoreForItem(raw, isAnchor, opt, localCoverageMap);
          // Gear C. Ability damage is limited-use burst, not sustained DPS.
          // Healing may still matter for healer/support utility, but c_pot damage should not rank gear.
          const score = incrementalCoverage * 1000000 + getDisplayedHealScore(raw, opt) * 1000;
          if (score > bestScore) { bestScore = score; bestIdx = i; bestCustom = opt; }
        });
      }
      if (bestIdx > -1) {
        gearPick = Object.assign({}, gearPool[bestIdx], { chosenCustom: bestCustom });
        getCoverageMapForItem(gearPick, isAnchor).forEach((v, k) => {
          const prev = localCoverageMap.get(k);
          if (!prev || v.score > prev.score) localCoverageMap.set(k, v);
        });
      }
    }

    const requireExactElementForProfile = hasElementTarget();
    const allSlots = [...wpnPicks, uwPick, gearPick].filter(Boolean);
    const sustainedDpsSlots = wpnPicks.filter(Boolean);
    // Sustained DPS is the best matching regular weapon only. UW/Gear C. Ability potency is limited-use burst.
    const dps = Math.max(...sustainedDpsSlots.map(it => getSuitingDamage(it, undefined, { requireExactElement: requireExactElementForProfile })), 0);
    const heal = Math.max(...allSlots.map(w => getDisplayedHealScore(w)), 0);
    const teamHeal = Math.max(...allSlots.map(w => getTeamHealScore(w)), 0);
    const anchorHealerScore = Math.max(...wpnPicks.map(w => getAnchorHealerScore(w, w.chosenCustom)), 0);
    return { weapons: wpnPicks, ultimate: uwPick, gear: gearPick, dps, heal, teamHeal, anchorHealerScore, anchorHealerQualified: anchorHealerScore > 0, usedFallbackHealer: false, updatedCoveredBases: localCoverageMap };
  }

  let bestTeams = [];
  const anchors = chars.filter(c => (c.topAnchorDpsScore || 0) > 0).sort((a, b) => b.topAnchorDpsScore - a.topAnchorDpsScore);
  const strictHealers = chars.filter(c => (c.topAnchorHealerScore || 0) > 0).sort((a, b) => b.topAnchorHealerScore - a.topAnchorHealerScore || b.topTeamHealScore - a.topTeamHealScore || b.topHealScore - a.topHealScore);
  const rawHealers = chars.filter(c => (c.topFallbackHealScore || 0) > 0).sort((a, b) => b.topHealScore - a.topHealScore);
  const runtimeWarnings = [];

  function getTeamCoverageMap(loadouts) {
    const teamMap = new Map();
    loadouts.forEach(m => {
      const isAnchor = m.roleKind === "dps" || m.roleKind === "healer" || m.roleKind === "dpsHealer";
      [m.lo.weapons[0], m.lo.weapons[1], m.lo.ultimate, m.lo.gear].filter(Boolean).forEach(it => {
        getCoverageMapForItem(it, isAnchor).forEach((v, k) => {
          const prev = teamMap.get(k);
          if (!prev || v.score > prev.score) teamMap.set(k, v);
        });
      });
    });
    return teamMap;
  }

  function getTeamSignals(loadouts) {
    const sig = { teamHasDebuff: false, teamHasBuff: false, teamHasAnchorHealer: false };
    loadouts.forEach(m => {
      if ((m.roleKind === "healer" || m.roleKind === "dpsHealer") && m.lo.anchorHealerQualified) sig.teamHasAnchorHealer = true;
      const isAnchor = m.roleKind === "dps" || m.roleKind === "healer" || m.roleKind === "dpsHealer";
      [m.lo.weapons[0], m.lo.weapons[1], m.lo.ultimate, m.lo.gear].filter(Boolean).forEach(it => {
        if (!it.capabilities) return;
        it.capabilities.forEach(cap => {
          if (cap.custom !== null && cap.custom !== it.chosenCustom) return;
          if (!isTokenImpacting(cap, isAnchor)) return;
          if (cap.kind === "debuff") sig.teamHasDebuff = true;
          if (cap.kind === "buff") sig.teamHasBuff = true;
        });
      });
    });
    return sig;
  }

  function recomputeLoadoutDps(loadout, teamSignals) {
    const requireExactElementForProfile = hasElementTarget();
    const sustainedDpsSlots = [loadout.weapons[0], loadout.weapons[1]].filter(Boolean);
    // Only one regular weapon can be the sustained anchor DPS source.
    // Gear/UW C. Ability potency is intentionally excluded because it is limited-use burst.
    return Math.max(...sustainedDpsSlots.map(it => getSuitingDamage(it, undefined, { requireExactElement: requireExactElementForProfile, context: teamSignals })), 0);
  }

  function getAnchorLoadoutDps(loadouts) {
    const anchor = loadouts.find(m => m.roleKind === "dps" || m.roleKind === "dpsHealer");
    return anchor ? anchor.lo.dps || 0 : 0;
  }

  function evaluateTeam(assignments) {
    let trackingCoveredBases = new Map();
    const loadouts = [];
    assignments.forEach(a => {
      const lo = buildLoadoutForMember(a.cd, trackingCoveredBases, a.roleKind);
      trackingCoveredBases = lo.updatedCoveredBases;
      loadouts.push({ cd: a.cd, role: a.role, roleKind: a.roleKind, lo });
    });

    if (target.healerNeeded && !loadouts.some(m => (m.roleKind === "healer" || m.roleKind === "dpsHealer") && m.lo.anchorHealerQualified)) return;
    const teamSignals = getTeamSignals(loadouts);
    loadouts.forEach(m => { m.lo.dps = recomputeLoadoutDps(m.lo, teamSignals); });
    const teamCoverageMap = getTeamCoverageMap(loadouts);
    const satisfiedKeys = Array.from(teamCoverageMap.keys()).filter(k => wantedKeys.has(k));
    const displayTokens = satisfiedKeys.map(k => desiredLabel(desiredMap.get(k)));
    const healerCount = loadouts.filter(m => m.lo.anchorHealerQualified).length;
    const coveragePower = satisfiedKeys.reduce((sum, k) => sum + (teamCoverageMap.get(k).score || 0), 0);
    const highTierCoverageCount = satisfiedKeys.filter(k => {
      const entry = teamCoverageMap.get(k);
      return entry && TIERED_TYPES.has(entry.desired.type) && (entry.tier || 0) >= HIGH_TIER_THRESHOLD;
    }).length;

    const layerOfKey = k => {
      const d = desiredMap.get(k);
      return d ? d.layer || 0 : 0;
    };

    const foundationalCoverageCount = satisfiedKeys.filter(k => {
      const layer = layerOfKey(k);
      return layer === 1 || layer === 2;
    }).length;

    const importantCoverageCount = satisfiedKeys.filter(k => {
      const layer = layerOfKey(k);
      return layer >= 1 && layer <= 3;
    }).length;

    const pyramidCoverageScore = satisfiedKeys.reduce((sum, k) => {
      const entry = teamCoverageMap.get(k);
      const layer = layerOfKey(k);
      const layerWeight = {
        1: 5000, // base potency / attack / defense-shred foundations
        2: 3500, // amp / availability layer
        3: 2500, // weakness exploit / damage received layer
        4: 1600, // damage bonus layer
        5: 1400, // weapon boost layer
        6: 1200,
      }[layer] || 0;
      return sum + layerWeight + (entry?.score || 0);
    }, 0);

    const layerMask = satisfiedKeys.reduce((mask, k) => {
      const layer = layerOfKey(k);
      return layer > 0 ? mask | (1 << layer) : mask;
    }, 0);

    const totalDps = loadouts.reduce((s, m) => s + m.lo.dps, 0);
    const teamAnchorHealerScore = Math.max(...loadouts.map(m => m.lo.anchorHealerScore || 0), 0);
    bestTeams.push({
      loadouts,
      anchorDps: getAnchorLoadoutDps(loadouts),
      anchorHealerScore: teamAnchorHealerScore,
      coverageCount: satisfiedKeys.length,
      coveragePower,
      foundationalCoverageCount,
      importantCoverageCount,
      pyramidCoverageScore,
      highTierCoverageCount,
      layerMask,
      totalDps,
      totalHeal: loadouts.reduce((s, m) => s + m.lo.heal, 0),
      healerCount,
      coveredKeys: satisfiedKeys.slice().sort(),
      coveredTokensDisplay: displayTokens.join(", ")
    });
  }

  function enumerateHealerTeams(healerCandidates, healerRoleKind, healerRoleLabel) {
    anchors.forEach(anchor => {
      healerCandidates.forEach(healer => {
        if (healer.character === anchor.character) return;
        const chosen = new Set([anchor.character]);
        if (isBlocked(chosen, healer.character)) return;
        const chosen2 = new Set(chosen).add(healer.character);
        chars.forEach(flex => {
          if (chosen2.has(flex.character) || isBlocked(chosen2, flex.character)) return;
          evaluateTeam([
            { cd: anchor, role: "Anchor DPS", roleKind: "dps" },
            { cd: healer, role: healerRoleLabel, roleKind: healerRoleKind },
            { cd: flex, role: "Support", roleKind: "support" }
          ]);
        });
      });
    });
  }

  function enumerateCombinedDpsHealerTeams() {
    anchors.forEach(anchor => {
      if ((anchor.topAnchorHealerScore || 0) <= 0) return;
      const chosen = new Set([anchor.character]);
      chars.forEach(char2 => {
        if (chosen.has(char2.character) || isBlocked(chosen, char2.character)) return;
        const chosen2 = new Set(chosen).add(char2.character);
        chars.forEach(char3 => {
          if (chosen2.has(char3.character) || isBlocked(chosen2, char3.character)) return;
          evaluateTeam([
            { cd: anchor, role: "Anchor DPS + Healer", roleKind: "dpsHealer" },
            { cd: char2, role: "Support", roleKind: "support" },
            { cd: char3, role: "Support", roleKind: "support" }
          ]);
        });
      });
    });
  }

  if (target.healerNeeded) {
    enumerateHealerTeams(strictHealers, "healer", "Anchor Healer");
    if (bestTeams.length === 0) enumerateCombinedDpsHealerTeams();
    if (bestTeams.length === 0) {
      if (strictHealers.length === 0 && rawHealers.length > 0) {
        runtimeWarnings.push("Healer required, but no held character has a qualifying regular-weapon Anchor Healer source. Anchor Healer preference order: AOE weapon heal >= threshold, All Cure materia support, single/nominal weapon heal >= threshold, then HEAL Boost materia support. Utility coverage only refines choices within the same category. UW/Gear healing can still contribute support healing, but cannot qualify the Anchor Healer role.");
      } else if (strictHealers.length > 0) {
        runtimeWarnings.push("Healer required and strict healer candidates exist, but no valid team survived DPS/profile/exclusivity constraints. The script also tried allowing one character to act as both Anchor DPS and Anchor Healer.");
      }
    }
  } else {
    anchors.forEach(anchor => {
      const initialChosen = new Set([anchor.character]);
      chars.forEach(char2 => {
        if (initialChosen.has(char2.character) || isBlocked(initialChosen, char2.character)) return;
        const chosen2 = new Set(initialChosen).add(char2.character);
        chars.forEach(char3 => {
          if (chosen2.has(char3.character) || isBlocked(chosen2, char3.character)) return;
          evaluateTeam([
            { cd: anchor, role: "Anchor DPS", roleKind: "dps" },
            { cd: char2, role: "Support", roleKind: "support" },
            { cd: char3, role: "Support", roleKind: "support" }
          ]);
        });
      });
    });
  }

  function anchorDpsBucket(team) {
    // Avoid letting tiny potency differences dominate, but keep major gaps such
    // as 1340 vs 940 decisive once foundations are equal.
    return Math.floor((team.anchorDps || 0) / 100);
  }

  bestTeams.sort((a, b) =>
    // First preserve pyramid foundations. Missing Layer 1/2 support should lose.
    b.foundationalCoverageCount - a.foundationalCoverageCount ||

    // Once foundations are equal, sustained Anchor DPS is the headline axis.
    // This fixes cases where 940% builds outrank 1340% builds solely from
    // slightly better secondary coverage or healer category.
    anchorDpsBucket(b) - anchorDpsBucket(a) ||
    b.anchorDps - a.anchorDps ||

    // Then weighted utility quality, with AOE defensive buffs prioritized. This keeps the pyramid meaningful without
    // letting one extra low-value token beat a much stronger anchor.
    b.importantCoverageCount - a.importantCoverageCount ||
    b.pyramidCoverageScore - a.pyramidCoverageScore ||
    b.coveragePower - a.coveragePower ||
    b.coverageCount - a.coverageCount ||
    b.highTierCoverageCount - a.highTierCoverageCount ||

    // Team DPS is useful if support/healer naturally fits the target.
    b.totalDps - a.totalDps ||

    // Healer quality should break ties after role qualification, not dominate
    // the whole-team ranking.
    (target.healerNeeded ? (b.anchorHealerScore - a.anchorHealerScore) : 0) ||
    b.totalHeal - a.totalHeal ||
    a.healerCount - b.healerCount
  );

  function teamSignature(team) {
    const charsSig = team.loadouts.map(m => `${m.role}:${m.cd.character}`).join("|");
    const equipsSig = team.loadouts.map(m => [m.lo.weapons[0], m.lo.weapons[1], m.lo.ultimate, m.lo.gear]
      .filter(Boolean).map(it => it.item.id + (it.chosenCustom ? `:${it.chosenCustom}` : "")).join("+")).join("|");
    return charsSig + "||" + equipsSig;
  }

  function isCoverageSubset(candidate, selected) {
    const cand = new Set(candidate.coveredKeys || []);
    const sel = new Set(selected.coveredKeys || []);
    for (const k of cand) if (!sel.has(k)) return false;
    return true;
  }

  function hasTrueCoverageDiversity(candidate, selectedTeams) {
    const cand = new Set(candidate.coveredKeys || []);
    for (const selected of selectedTeams) {
      const sel = new Set(selected.coveredKeys || []);
      let hasNew = false;
      for (const k of cand) {
        if (!sel.has(k)) { hasNew = true; break; }
      }
      if (hasNew) return true;
    }
    return false;
  }

  function selectNearOptimalTeams(sortedTeams) {
    if (sortedTeams.length <= 1) return sortedTeams;

    const best = sortedTeams[0];
    const selected = [best];
    const seen = new Set([teamSignature(best)]);

    for (let i = 1; i < sortedTeams.length; i++) {
      const team = sortedTeams[i];
      const sig = teamSignature(team);
      if (seen.has(sig)) continue;

      // Do not show builds that are simply lower-ranked because they cover less
      // and do not add any new coverage dimension.
      const dominated = selected.some(existing =>
        isCoverageSubset(team, existing) &&
        (team.anchorDps || 0) <= (existing.anchorDps || 0) &&
        (team.foundationalCoverageCount || 0) <= (existing.foundationalCoverageCount || 0)
      );
      if (dominated) continue;

      // Keep genuinely different coverage packages, especially if they preserve
      // foundations. Avoid flooding the UI with small permutations.
      if (!hasTrueCoverageDiversity(team, selected)) continue;
      if ((team.foundationalCoverageCount || 0) < (best.foundationalCoverageCount || 0)) continue;

      selected.push(team);
      seen.add(sig);
      if (selected.length >= MAX_DISPLAY_BUILDS) break;
    }

    return selected;
  }

  bestTeams = selectNearOptimalTeams(bestTeams);

  const outputGrid = [];
  const OUT_COLS = 10;
  function pad(row) { while (row.length < OUT_COLS) row.push(""); return row; }
  function joinLimited(parts, limit) {
    const clean = parts.filter(Boolean);
    if (clean.length <= limit) return clean.join(", ");
    return clean.slice(0, limit).join(", ") + `, +${clean.length - limit} more`;
  }

  outputGrid.push(pad(["[ TEAM BUILDER PROFILE ]", "", "", "", "", "", "", "", "", ""]));
  outputGrid.push(pad(["Target", `Archetype: ${target.weakArch ? archLabel(target.weakArch) : 'ANY'} | Element: ${target.weakElem ? elemLabel(target.weakElem) : 'NONE'} | Healer Required: ${target.healerNeeded ? 'TRUE' : 'FALSE'} | Damage: ${target.damageAssumption} | Anchor Heal ≥${target.anchorHealThreshold}%`, "", "", "", "", "", "", "", ""]));
  outputGrid.push(pad(["Implicit Buff Targets", synergyDisplayList.length > 0 ? synergyDisplayList.join("  »  ") : "None", "", "", "", "", "", "", "", ""]));
  outputGrid.push(pad(["Manual Debuff Note", "Enemy-side debuffs are only taken from Wanted Debuffs because immunity/weakness rules vary by boss.", "", "", "", "", "", "", "", ""]));
  outputGrid.push(pad(["Build Selection", `Near-optimal only; max ${MAX_DISPLAY_BUILDS} builds shown. Gear/U.C. abilities are included when the rows are held=TRUE.`, "", "", "", "", "", "", "", ""]));
  schemaWarnings.forEach(w => outputGrid.push(pad(["Schema Warning", w, "", "", "", "", "", "", "", ""])));
  runtimeWarnings.forEach(w => outputGrid.push(pad(["Runtime Warning", w, "", "", "", "", "", "", "", ""])));
  outputGrid.push(pad(["", "", "", "", "", "", "", "", "", ""]));
  outputGrid.push(pad(["Build", "Role", "Character", "Weapon 1", "Weapon 2", "Ultimate", "Gear", "Potency", "Key Effects", "Coverage / Notes"]));

  function getDisplayDamageHits(r) {
    if (!r) return [];
    const bestByShape = new Map();
    customOptionsFor(r).forEach(opt => {
      r.damage.forEach(d => {
        if (d.custom !== null && d.custom !== opt) return;
        const arch = d.arch || r.item.c_arch || "any";
        const elem = d.elem || r.item.c_elem || "nonelem";
        const pot = Number(d.pot || 0);
        if (pot <= 0) return;
        const key = `${arch}|${elem}`;
        const prev = bestByShape.get(key);
        if (!prev || pot > prev.pot) bestByShape.set(key, { arch, elem, pot, mods: d.mods || [] });
      });
    });
    return Array.from(bestByShape.values()).sort((a, b) => b.pot - a.pot);
  }

  function modDisplayWhen(when) {
    return when ? whenDisplay(when) : "Unconditional";
  }

  function getPotencyDetail(r, context, includeDamage = true) {
    if (!r) return "";
    const parts = [];

    if (includeDamage) {
      const dmgHits = getDisplayDamageHits(r);
      dmgHits.forEach(d => {
        const fitTier = getDamageFitTier(d, hasElementTarget());
        const contributesToTarget = fitTier > 0;
        const ctx = Object.assign({}, context || {}, { hitsWeakness: fitTier >= 3 });
        const effective = getEffectivePot(d, ctx);
        let display = effective !== d.pot ? `${d.pot}%→${effective}% ${archLabel(d.arch)}/${elemLabel(d.elem)}` : `${d.pot}% ${archLabel(d.arch)}/${elemLabel(d.elem)}`;
        if (d.mods && d.mods.length) {
          d.mods.forEach(mod => {
            if (mod.mult && effective === d.pot) display += ` [x${mod.mult} if ${modDisplayWhen(mod.when)}]`;
            if (mod.add) display += ` [+${mod.add} dmg${mod.when ? " if " + modDisplayWhen(mod.when) : ""}]`;
          });
        }
        if (!contributesToTarget) display += " [Off-profile]";
        parts.push(display);
      });
    }

    const heal = getDisplayedHealScore(r);
    if (heal > 0) parts.push(`Heal ${heal}%`);
    return parts.join(" | ");
  }

  function isTokenImpacting(cap, isMemberAnchor) {
    if (cap.kind === "dmg") return false;
    if (cap.kind === "heal") return true;

    // Healer-enabling materia support is role-impacting when a healer is needed.
    // It is not part of offensive/defensive desired coverage, so it must not be
    // judged solely by desiredList.
    if (target.healerNeeded && cap.kind === "set" && cap.type === "allCure") return true;
    if (target.healerNeeded && (cap.type === "healingBoost" || cap.type === "healBoost" || cap.type === "boostHeal")) return true;

    // Impact is relative to the user's selected desired effects. This is
    // especially important for defensive elemental picks such as Lightning
    // Resist. Up on a water-weak boss: it should not be compared to weakElem.
    return desiredList.some(d => capSatisfiesDesired(cap, d, isMemberAnchor));
  }

  function capDisplay(cap) {
    if (cap.kind === "heal") return `Heal${cap.tier ? " " + cap.tier + "%" : ""}`;
    let display = effectDisplayName(cap.kind, cap.type, cap.elem, cap.status, cap.target);
    if (cap.tier) display += ` [${tierDisplay(cap.tier)}]`;
    if (cap.range && cap.range !== "none" && cap.range !== "unknown") display += ` [${RANGE_LABEL[cap.range] || cap.range}]`;
    if (cap.mode === "passive") display += " [Passive]";
    if (cap.when) display += ` [${whenDisplay(cap.when)}]`;
    return display;
  }

  function getUtilList(r, isMemberAnchor, includePassive) {
    if (!r || !r.capabilities) return [];
    const utils = [];
    r.capabilities.forEach(cap => {
      if (cap.custom !== null && cap.custom !== r.chosenCustom) return;
      if (cap.kind === "dmg" || cap.kind === "heal") return;
      if (!includePassive && cap.mode === "passive") return;
      let display = capDisplay(cap);
      if (isLimitedUseActiveUtility(r, cap)) display += ` [${limitedUseLabel(r)}]`;
      if (!isTokenImpacting(cap, isMemberAnchor)) display += " [Non-impacting]";
      if (!utils.includes(display)) utils.push(display);
    });
    return utils;
  }

  function getItemDisplayName(r) {
    if (!r || !r.item) return "";
    let name = r.item.name;
    if (r.chosenCustom) name += " [" + r.chosenCustom.charAt(0).toUpperCase() + r.chosenCustom.slice(1) + "]";
    return name;
  }

  function shouldShowWeaponDamage(member, r) {
    if (!member || !r) return false;
    if (member.roleKind === "dps" || member.roleKind === "dpsHealer") return true;
    return hasNaturalTargetMatch(r, r.chosenCustom);
  }

  function slotSummary(r, teamSignals, isAnchor, includePassive, includeDamage = true) {
    if (!r) return "";
    const potency = getPotencyDetail(r, teamSignals, includeDamage);
    const util = getUtilList(r, isAnchor, includePassive).join(" | ");
    const bits = [getItemDisplayName(r)];
    if (potency) bits.push(potency);
    if (util && util !== "None") bits.push(util);
    return bits.join(" — ");
  }

  function getAnchorHealerLoadoutHeal(loadouts) {
    const anchorHealer = loadouts.find(m =>
      m.roleKind === "healer" ||
      m.role === "Anchor Healer" ||
      /anchor\s+healer/i.test(m.role || "")
    );

    if (anchorHealer && anchorHealer.lo) return anchorHealer.lo.heal || 0;

    // Fallback for unusual role layouts: use the strongest actual healer-like
    // loadout, not summed incidental team healing.
    return Math.max(...loadouts.map(m => m.lo?.heal || 0), 0);
  }

  function getTeamHeadlineHeal(team) {
    const loadouts = team.loadouts || [];

    const anchorHealer = loadouts.find(m =>
      m.roleKind === "healer" ||
      m.role === "Anchor Healer" ||
      /anchor\s+healer/i.test(m.role || "")
    );

    if (anchorHealer && anchorHealer.lo) return anchorHealer.lo.heal || 0;

    // Fallback: prefer a loadout that actually qualified as anchor healer.
    const qualified = loadouts
      .filter(m => (m.lo?.anchorHealerQualified || (m.lo?.anchorHealerScore || 0) > 0))
      .sort((a, b) =>
        (b.lo?.anchorHealerScore || 0) - (a.lo?.anchorHealerScore || 0) ||
        (b.lo?.heal || 0) - (a.lo?.heal || 0)
      );

    if (qualified.length) return qualified[0].lo?.heal || 0;
    return 0;
  }

  function teamSummaryPotency(team) {
    const parts = [];

    if ((team.anchorDps || 0) > 0) {
      parts.push(`Anchor ${team.anchorDps}%`);
    }

    if ((team.totalDps || 0) > 0 && team.totalDps !== team.anchorDps) {
      parts.push(`Team DPS ${team.totalDps}%`);
    }

    const headlineHeal = getTeamHeadlineHeal(team);
    if (headlineHeal > 0) {
      parts.push(`Heal ${headlineHeal}%`);
    }

    return parts.join(" / ");
  }

  const displayLimit = Math.min(bestTeams.length, MAX_DISPLAY_BUILDS);
  if (displayLimit === 0) {
    const reason = target.healerNeeded && strictHealers.length === 0
      ? "No qualifying team healer was found. Team heal requires heal range=allAllies or set type=allCure in caps, and the function range must include caps (A:N)."
      : anchors.length === 0
        ? "No target-compatible Anchor DPS candidates were found for the selected archetype/element."
        : "No valid three-character combination could be generated after role/exclusion constraints.";
    outputGrid.push(pad(["No valid builds found", reason, "", "", "", "", "", "", "", ""]));
  }

  for (let k = 0; k < displayLimit; k++) {
    const team = bestTeams[k];
    const teamSignals = getTeamSignals(team.loadouts);
    const coverageText = team.coveredTokensDisplay || "No desired utility coverage";
    outputGrid.push(pad([
      "Build #" + (k + 1),
      "Team Summary",
      team.loadouts.map(m => `${m.cd.character} (${m.role})`).join(" / "),
      "", "", "", "",
      teamSummaryPotency(team),
      `Coverage ${team.coverageCount}/${desiredList.length} | Foundations ${team.foundationalCoverageCount}/${desiredList.filter(d => d.layer === 1 || d.layer === 2).length} | T3+ ${team.highTierCoverageCount}`,
      coverageText
    ]));

    for (let m = 0; m < team.loadouts.length; m++) {
      const member = team.loadouts[m];
      const isAnchor = member.roleKind === "dps" || member.roleKind === "healer" || member.roleKind === "dpsHealer";
      const activeEffects = [];
      const passiveEffects = [];
      [member.lo.weapons[0], member.lo.weapons[1], member.lo.ultimate, member.lo.gear].filter(Boolean).forEach(it => {
        activeEffects.push(...getUtilList(it, isAnchor, false));
        passiveEffects.push(...getUtilList(it, isAnchor, true).filter(x => x.includes("[Passive]")));
      });
      // Effects are shown inline on each equipment slot in the UI. Keep the
      // legacy grid columns empty to avoid duplicate display in build cards.
      const rowEffects = "";
      const notes = "";
      outputGrid.push(pad([
        "",
        member.role,
        member.cd.character,
        slotSummary(member.lo.weapons[0], teamSignals, isAnchor, true, shouldShowWeaponDamage(member, member.lo.weapons[0])),
        slotSummary(member.lo.weapons[1], teamSignals, isAnchor, true, shouldShowWeaponDamage(member, member.lo.weapons[1])),
        slotSummary(member.lo.ultimate, teamSignals, isAnchor, true, false),
        slotSummary(member.lo.gear, teamSignals, isAnchor, true, false),
        `DPS ${member.lo.dps}% / Heal ${member.lo.heal}%`,
        rowEffects,
        notes
      ]));
    }
    outputGrid.push(pad(["", "", "", "", "", "", "", "", "", ""]));
  }

  return outputGrid.length > 8 ? outputGrid : [["No valid combinations could be generated matching constraints"]];
}


export function gridToBuildJson(grid) {
  const rows = Array.isArray(grid) ? grid : [];
  const result = { profile: {}, warnings: [], builds: [], rawGrid: rows };
  let headerIdx = rows.findIndex(r => Array.isArray(r) && r[0] === "Build" && r[1] === "Role");
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    if (row[0] === "Target") result.profile.target = row[1] || "";
    if (row[0] === "Implicit Buff Targets") result.profile.implicitBuffTargets = row[1] || "";
    if (row[0] === "Schema Warning" || row[0] === "Runtime Warning") result.warnings.push({ type: row[0], message: row[1] || "" });
    if (row[0] === "No valid builds found") result.warnings.push({ type: row[0], message: row[1] || "" });
  }
  if (headerIdx < 0) return result;

  let current = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some(x => String(x || '').trim())) continue;
    if (String(r[0] || '').startsWith('Build #') && r[1] === 'Team Summary') {
      current = {
        build: r[0],
        summary: {
          members: r[2] || "",
          potency: r[7] || "",
          score: r[8] || "",
          coverage: r[9] || ""
        },
        members: []
      };
      result.builds.push(current);
      continue;
    }
    if (current && r[2]) {
      current.members.push({
        role: r[1] || "",
        character: r[2] || "",
        weapon1: r[3] || "",
        weapon2: r[4] || "",
        ultimate: r[5] || "",
        gear: r[6] || "",
        potency: r[7] || "",
        keyEffects: r[8] || "",
        notes: r[9] || ""
      });
    }
  }
  return result;
}

export function recommendTeamsJson(equipmentsData, options = {}) {
  const grid = recommendTeamsGrid(
    equipmentsData,
    options.weakArch || "",
    options.weakElem || "",
    options.wantBuffs || "",
    options.wantDebuffs || "",
    options.healerNeeded || false,
    options.damageAssumption || "conservative",
    options.manualCoverageMode !== false,
    options.anchorHealThreshold || 47
  );
  return gridToBuildJson(grid);
}
