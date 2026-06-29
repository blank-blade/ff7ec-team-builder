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
export function recommendTeamsGrid(equipmentsData, weakArch, weakElem, wantBuffsStr, wantDebuffsStr, healerNeeded, damageAssumption, manualCoverageMode) {
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
    damageAssumption: normalizeDamageAssumption(damageAssumption)
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
      if (allCure) best = Math.max(best, 1);
    });
    return best;
  }

  function isOffensiveBuffType(type) {
    return OFFENSIVE_BUFF_TYPES.has(type);
  }

  function isDefensiveBuffType(type) {
    return DEFENSIVE_BUFF_TYPES.has(type);
  }

  function buffCanApplyToAnchor(cap, isMemberAnchor) {
    const range = cap.range || "none";
    if (range === "allAllies" || range === "none" || range === "unknown") return true;
    if (range === "self") return !!isMemberAnchor;
    if (range === "allyExcludingSelf") return !isMemberAnchor;
    if (range === "singleAlly") return true;
    return false;
  }

  function defensiveBuffAppliesToTeamEnough(cap, isMemberAnchor) {
    const range = cap.range || "none";
    if (range === "allAllies" || range === "none" || range === "unknown") return true;
    if (range === "singleAlly" || range === "allyExcludingSelf") return true;
    if (range === "self") return !!isMemberAnchor;
    return false;
  }

  function capSatisfiesDesired(cap, desired, isMemberAnchor) {
    if (cap.kind !== desired.kind) return false;
    if (cap.type !== desired.type) return false;
    if (desired.elem && desired.elem !== "none" && cap.elem !== desired.elem) return false;
    if (desired.minTier && (cap.tier || 0) < desired.minTier) return false;

    if (cap.kind === "buff") {
      if (isOffensiveBuffType(cap.type) && !buffCanApplyToAnchor(cap, isMemberAnchor)) return false;
      if (isDefensiveBuffType(cap.type) && !defensiveBuffAppliesToTeamEnough(cap, isMemberAnchor)) return false;
    } else if (cap.range === "self" && !isMemberAnchor && !SELF_OK_TYPES.has(cap.type)) {
      return false;
    }

    return true;
  }

  function rangeCoverageAdjustment(cap, desired, isMemberAnchor) {
    if (cap.kind !== "buff") return 0;
    const range = cap.range || "none";

    if (isDefensiveBuffType(cap.type)) {
      if (range === "allAllies") return 140;
      if (range === "none" || range === "unknown") return 40;
      if (range === "singleAlly" || range === "allyExcludingSelf") return -20;
      if (range === "self") return isMemberAnchor ? -80 : -140;
      return -60;
    }

    if (isOffensiveBuffType(cap.type)) {
      if (range === "allAllies") return 70;
      if (range === "singleAlly") return 50;
      if (range === "allyExcludingSelf") return isMemberAnchor ? -160 : 45;
      if (range === "self") return isMemberAnchor ? 35 : -180;
      return 0;
    }

    return 0;
  }

  function capCoverageScore(cap, desired, isMemberAnchor) {
    if (!capSatisfiesDesired(cap, desired, isMemberAnchor)) return 0;
    const layer = desired.layer || inferPyramidLayer(desired.kind, desired.type);
    const layerWeight = 100 + layer * 25;
    const rangeAdj = rangeCoverageAdjustment(cap, desired, isMemberAnchor);
    if (TIERED_TYPES.has(desired.type)) {
      const tier = Math.max(cap.tier || 0, desired.minTier || 0);
      const highTierBonus = tier >= HIGH_TIER_THRESHOLD ? 100 : 0;
      return Math.max(1, layerWeight + highTierBonus + tier * 20 + rangeAdj);
    }
    return Math.max(1, layerWeight + 80 + rangeAdj);
  }

  function isLimitedUseActiveUtility(r, cap) {
    return !!(r && r.item && (r.item.type === "gear" || r.item.type === "ultimate") && cap && cap.mode !== "passive" &&
      (cap.kind === "buff" || cap.kind === "debuff" || cap.kind === "amp"));
  }

  function limitedUseLabel(r) {
    if (!r || !r.item) return "Limited-use Ability";
    if (r.item.type === "gear") return "Limited-use Gear C. Ability";
    if (r.item.type === "ultimate") return "Limited-use U.C. Ability";
    return "Limited-use Ability";
  }

  function applySourceCoverageWeight(score, r, cap) {
    if (score <= 0) return score;
    if (isLimitedUseActiveUtility(r, cap)) {
      return Math.max(1, Math.round(score * LIMITED_USE_ACTIVE_UTILITY_COVERAGE_FACTOR));
    }
    return score;
  }

  function getCoverageMapForItem(r, isMemberAnchor, chosenCustom) {
    const map = new Map();
    if (!r || !r.capabilities) return map;
    customOptionsFor(r, chosenCustom).forEach(opt => {
      r.capabilities.forEach(cap => {
        if (cap.custom !== null && cap.custom !== opt) return;
        desiredList.forEach(d => {
          const rawScore = capCoverageScore(cap, d, isMemberAnchor);
          const score = applySourceCoverageWeight(rawScore, r, cap);
          if (score <= 0) return;
          const prev = map.get(d.key);
          if (!prev || score > prev.score) map.set(d.key, { score, rawScore, sourceWeight: rawScore ? score / rawScore : 1, tier: cap.tier || 0, cap, desired: d });
        });
      });
    });
    return map;
  }

  function getCoveredKeysForAnItem(r, isMemberAnchor, chosenCustom) {
    return new Set(Array.from(getCoverageMapForItem(r, isMemberAnchor, chosenCustom).keys()));
  }

  function getCoveragePowerForItem(r, isMemberAnchor, chosenCustom) {
    let power = 0;
    getCoverageMapForItem(r, isMemberAnchor, chosenCustom).forEach(v => power += v.score);
    return power;
  }

  function getIncrementalCoverageScoreForItem(r, isMemberAnchor, chosenCustom, existingMap) {
    let score = 0;
    getCoverageMapForItem(r, isMemberAnchor, chosenCustom).forEach((v, k) => {
      const prev = existingMap && existingMap.get(k);
      if (!prev) score += v.score;
      else if (v.score > prev.score) score += (v.score - prev.score);
    });
    return score;
  }

  const charMap = new Map();
  resolvedItems.forEach(r => {
    const c = r.item.character;
    if (!charMap.has(c)) charMap.set(c, { character: c, weapons: [], ultimates: [], gear: [], topWeaponScore: 0, topAnchorDpsScore: 0, topHealScore: 0, topTeamHealScore: 0, topFallbackHealScore: 0 });
    const d = charMap.get(c);
    const score = getWeaponScore(r, "AUTO");
    const healScore = getHealScore(r, "AUTO");
    const teamHealScore = getTeamHealScore(r, "AUTO");

    if (r.item.type === "gear") {
      d.gear.push(r);
    } else if (r.item.type === "ultimate") {
      d.ultimates.push(r);
    } else {
      d.weapons.push(r);
      d.topWeaponScore = Math.max(d.topWeaponScore, score);
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
      const dps = (roleKind === "dps" || roleKind === "dpsHealer") ? getAnchorDpsScore(raw, opt) : getWeaponScore(raw, opt);
      const heal = getHealScore(raw, opt);
      const roleScore = roleKind === "healer" ? heal : dps;
      const score = incrementalCoverage * 1000000 + roleScore;
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
      wpns.sort((a, b) => getAnchorDpsScore(b, "AUTO") - getAnchorDpsScore(a, "AUTO"));
      const topRaw = wpns.shift();
      commitPick(topRaw, chooseBestCustom(topRaw, true, localCoverageMap, "dps"));
    }

    if ((roleKind === "healer" || roleKind === "dpsHealer") && wpns.length > 0) {
      const alreadyTeamHeals = wpnPicks.some(w => getTeamHealScore(w, w.chosenCustom) > 0);
      if (!alreadyTeamHeals) {
        let bestIdx = -1, bestScore = -Infinity, bestCustom = null;
        for (let i = 0; i < wpns.length; i++) {
          const raw = wpns[i];
          if (getTeamHealScore(raw, "AUTO") <= 0) continue;
          raw.customOptions.forEach(opt => {
            const teamHeal = getTeamHealScore(raw, opt);
            if (teamHeal <= 0) return;
            const rawHeal = getHealScore(raw, opt);
            const incrementalCoverage = getIncrementalCoverageScoreForItem(raw, true, opt, localCoverageMap);
            const roleDps = roleKind === "dpsHealer" ? getAnchorDpsScore(raw, opt) : getWeaponScore(raw, opt);
            const score = teamHeal * 10000000 + incrementalCoverage * 1000000 + roleDps + rawHeal;
            if (score > bestScore) { bestScore = score; bestIdx = i; bestCustom = opt; }
          });
        }
        if (bestIdx > -1) commitPick(removeAt(wpns, bestIdx), bestCustom);
      }
    }

    function pickOneMaximizeCoverage(pool) {
      let bestIdx = -1, bestCustomForChoice = null, bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const itemRaw = pool[i];
        itemRaw.customOptions.forEach(opt => {
          const incrementalCoverage = getIncrementalCoverageScoreForItem(itemRaw, isAnchor, opt, localCoverageMap);
          const roleDps = (roleKind === "dps" || roleKind === "dpsHealer") ? getAnchorDpsScore(itemRaw, opt) : getWeaponScore(itemRaw, opt);
          const score = incrementalCoverage * 1000000 + roleDps + getHealScore(itemRaw, opt);
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
          const score = incrementalCoverage * 1000000 + getWeaponScore(raw, opt);
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
          const score = incrementalCoverage * 1000000 + getWeaponScore(raw, opt) + getHealScore(raw, opt) * 1000;
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
    const dps = Math.max(...allSlots.map(it => getSuitingDamage(it, undefined, { requireExactElement: requireExactElementForProfile })), 0);
    const heal = Math.max(...allSlots.map(w => getHealScore(w)), 0);
    const teamHeal = Math.max(...allSlots.map(w => getTeamHealScore(w)), 0);
    return { weapons: wpnPicks, ultimate: uwPick, gear: gearPick, dps, heal, teamHeal, anchorHealerQualified: teamHeal > 0, usedFallbackHealer: false, updatedCoveredBases: localCoverageMap };
  }

  let bestTeams = [];
  const anchors = chars.filter(c => (c.topAnchorDpsScore || 0) > 0).sort((a, b) => b.topAnchorDpsScore - a.topAnchorDpsScore);
  const strictHealers = chars.filter(c => (c.topTeamHealScore || 0) > 0).sort((a, b) => b.topTeamHealScore - a.topTeamHealScore || b.topHealScore - a.topHealScore);
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
    const allSlots = [loadout.weapons[0], loadout.weapons[1], loadout.ultimate, loadout.gear].filter(Boolean);
    return Math.max(...allSlots.map(it => getSuitingDamage(it, undefined, { requireExactElement: requireExactElementForProfile, context: teamSignals })), 0);
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
    const layerMask = satisfiedKeys.reduce((mask, k) => {
      const d = desiredMap.get(k);
      const layer = d ? d.layer || 0 : 0;
      return layer > 0 ? mask | (1 << layer) : mask;
    }, 0);

    bestTeams.push({
      loadouts,
      coverageCount: satisfiedKeys.length,
      coveragePower,
      highTierCoverageCount,
      layerMask,
      totalDps: loadouts.reduce((s, m) => s + m.lo.dps, 0),
      totalHeal: loadouts.reduce((s, m) => s + m.lo.heal, 0),
      healerCount,
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
            { cd: flex, role: "Support / Flex DPS", roleKind: "support" }
          ]);
        });
      });
    });
  }

  function enumerateCombinedDpsHealerTeams() {
    anchors.forEach(anchor => {
      if ((anchor.topTeamHealScore || 0) <= 0) return;
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
        runtimeWarnings.push("Healer required, but no held character has a qualifying team-healing source. Self/single-target heals are not valid Anchor Healers. Add or verify heal range=allAllies on party-heal C-abilities, or set type=allCure for weapons with All (Cure) materia support.");
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

  bestTeams.sort((a, b) =>
    b.coveragePower - a.coveragePower ||
    b.coverageCount - a.coverageCount ||
    b.highTierCoverageCount - a.highTierCoverageCount ||
    b.totalDps - a.totalDps ||
    b.totalHeal - a.totalHeal ||
    a.healerCount - b.healerCount
  );

  function teamSignature(team) {
    const charsSig = team.loadouts.map(m => `${m.role}:${m.cd.character}`).join("|");
    const equipsSig = team.loadouts.map(m => [m.lo.weapons[0], m.lo.weapons[1], m.lo.ultimate, m.lo.gear]
      .filter(Boolean).map(it => it.item.id + (it.chosenCustom ? `:${it.chosenCustom}` : "")).join("+")).join("|");
    return charsSig + "||" + equipsSig;
  }

  function selectNearOptimalTeams(sortedTeams) {
    if (sortedTeams.length <= 1) return sortedTeams;
    const best = sortedTeams[0];
    const minPower = best.coveragePower * NEAR_OPTIMAL_OBJECTIVE_RATIO;
    const minCoverage = best.coverageCount;
    const selected = [];
    const seen = new Set();
    for (let i = 0; i < sortedTeams.length; i++) {
      const team = sortedTeams[i];
      if (team.coverageCount < minCoverage) continue;
      if (team.coveragePower < minPower) continue;
      const sig = teamSignature(team);
      if (seen.has(sig)) continue;
      selected.push(team);
      seen.add(sig);
      if (selected.length >= MAX_DISPLAY_BUILDS) break;
    }
    return selected.length ? selected : [best];
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
  outputGrid.push(pad(["Target", `Archetype: ${target.weakArch ? archLabel(target.weakArch) : 'ANY'} | Element: ${target.weakElem ? elemLabel(target.weakElem) : 'NONE'} | Healer Required: ${target.healerNeeded ? 'TRUE' : 'FALSE'} | Damage: ${target.damageAssumption}`, "", "", "", "", "", "", "", ""]));
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

  function getDpsDetail(r, context) {
    if (!r) return "";
    const dmgHits = getDisplayDamageHits(r);
    const heal = getHealScore(r);
    const parts = [];
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
    if (heal > 0) parts.push(`Heal ${heal}%`);
    return parts.join(" | ");
  }

  function isTokenImpacting(cap, isMemberAnchor) {
    if (cap.kind === "dmg") return false;
    if (ELEMENTAL_TYPES.has(cap.type) && target.weakElem && cap.elem !== target.weakElem) return false;
    if (cap.range === "self" && !isMemberAnchor && !SELF_OK_TYPES.has(cap.type)) return false;
    return true;
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

  function slotSummary(r, teamSignals, isAnchor, includePassive) {
    if (!r) return "";
    const dps = getDpsDetail(r, teamSignals);
    const util = joinLimited(getUtilList(r, isAnchor, includePassive), includePassive ? 4 : 3);
    const bits = [getItemDisplayName(r)];
    if (dps) bits.push(dps);
    if (util && util !== "None") bits.push(util);
    return bits.join(" — ");
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
      `Team DPS ${team.totalDps}% / Heal ${team.totalHeal}%`,
      `Coverage ${team.coverageCount}/${desiredList.length} | T3+ ${team.highTierCoverageCount}`,
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
      const rowEffects = joinLimited(Array.from(new Set(activeEffects)), 8) || "None";
      const notes = joinLimited(Array.from(new Set(passiveEffects)), 4);
      outputGrid.push(pad([
        "",
        member.role,
        member.cd.character,
        slotSummary(member.lo.weapons[0], teamSignals, isAnchor, false),
        slotSummary(member.lo.weapons[1], teamSignals, isAnchor, false),
        slotSummary(member.lo.ultimate, teamSignals, isAnchor, false),
        slotSummary(member.lo.gear, teamSignals, isAnchor, true),
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
    options.manualCoverageMode !== false
  );
  return gridToBuildJson(grid);
}
