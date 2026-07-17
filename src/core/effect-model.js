export const TIER_VALUE = Object.freeze({
	low: 1,
	mid: 2,
	moderate: 2,
	high: 3,
	xhigh: 4,
	extrahigh: 4,
	extraHigh: 4,
});

export const TIER_LABEL = Object.freeze({ 1: "T1", 2: "T2", 3: "T3", 4: "T4" });

export const TIERED_TYPES = new Set([
	"patkUp",
	"matkUp",
	"pdefUp",
	"mdefUp",
	"elemDmgUp",
	"elemResistUp",
	"pdefDown",
	"mdefDown",
	"patkDown",
	"matkDown",
	"elemResistDown",
	"elemDmgDown",
]);

export const MATERIA_TIERED_TYPES = new Set([
	"patkUp",
	"matkUp",
	"pdefUp",
	"mdefUp",
	"patkDown",
	"matkDown",
	"pdefDown",
	"mdefDown",
	"elemResistDown",
]);

export const ELEMENTAL_TYPES = new Set([
	"elemDmgUp",
	"elemDmgDown",
	"elemResistUp",
	"elemResistDown",
	"elemDmgBonus",
	"elemWeaponBoost",
	"elemDmgRcvdUp",
	"elemMastery",
	"elemInterruptUp",
	"elemAtbConservation",
	"elemWeakness",
	"ampElemAbilities",
]);

export const SELF_OK_TYPES = new Set([
	"removePoison",
	"removeSilence",
	"removeBlind",
	"removeSleep",
	"removeParalyze",
	"removeStun",
	"removeSlow",
	"removeStop",
	"removePatkDown",
	"removeMatkDown",
	"provoke",
]);

export const DEFENSIVE_BUFF_TYPES = new Set([
	"pdefUp",
	"mdefUp",
	"elemResistUp",
	"physResistUp",
	"magResistUp",
	"barrier",
	"regen",
	"veil",
	"provoke",
	"hpGain",
	"removePoison",
	"removeSilence",
	"removeBlind",
	"removeSleep",
	"removeParalyze",
	"removeStun",
	"removeSlow",
	"removeStop",
	"removePatkDown",
	"removeMatkDown",
	"removePdefDown",
	"removeMdefDown",
]);

const ELEMENT_LABEL = Object.freeze({
	fire: "Fire",
	ice: "Ice",
	lightning: "Lightning",
	wind: "Wind",
	water: "Water",
	earth: "Earth",
	nonelem: "Non-elem",
});

const ARCH_LABEL = Object.freeze({
	phys: "Phys.",
	mag: "Mag.",
	hybrid: "Phys./Mag.",
	any: "Any",
});

export const RANGE_LABEL = Object.freeze({
	self: "Self",
	allAllies: "All Allies",
	allEnemies: "All Enemies",
	singleEnemy: "Single Enemy",
	singleAlly: "Single Ally",
	allyExcludingSelf: "Ally Except Self",
});

const CONDITION_LABEL = Object.freeze({
	firstUse: "First Use",
	selfHpGe50: "Self HP >=50%",
	selfHpGe70: "Self HP >=70%",
	selfHpLt50: "Self HP <50%",
	selfHpLe30: "Self HP <=30%",
	selfHpLe90: "Self HP <=90%",
	selfHpEq100: "Self HP =100%",
	overspeedOff: "Overspeed Off",
	overspeedOn: "Overspeed On",
	hitWeakness: "Hit Weakness",
	selfHasBuff: "Self Has Buff",
	targetHasDebuff: "Target Has Debuff",
	matchingSigil: "Matching Sigil",
	singleTarget: "Single Target",
	onCritical: "Critical Hit",
	stanceGaugeMax: "Stance Gauge Max",
});

export function cleanText(value) {
	return value == null ? "" : String(value).trim();
}

export function normalizeTier(value, fallback = 0) {
	if (value == null || value === "") return fallback;
	const text = cleanText(value);
	const numeric = Number(text);
	if (Number.isFinite(numeric) && numeric > 0) return numeric;
	return TIER_VALUE[text] || TIER_VALUE[text.toLowerCase()] || fallback;
}

export function splitCondition(when) {
	return cleanText(when)
		.split("&")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function elemLabel(elem) {
	const key = cleanText(elem).toLowerCase();
	return (
		ELEMENT_LABEL[key] ||
		(key ? key.charAt(0).toUpperCase() + key.slice(1) : "")
	);
}

export function archLabel(arch) {
	const key = cleanText(arch).toLowerCase();
	return (
		ARCH_LABEL[key] ||
		(key ? key.charAt(0).toUpperCase() + key.slice(1) : "Any")
	);
}

export function tierDisplay(tier) {
	const normalized = normalizeTier(tier);
	return normalized ? TIER_LABEL[normalized] || `T${normalized}` : "";
}

export function canonicalizeTypeAndElem(type, elem) {
	const rawType = cleanText(type);
	const rawElem = cleanText(elem).toLowerCase() || "none";
	if (!rawType) return { type: rawType, elem: rawElem };

	const elementPrefix = rawType
		.toLowerCase()
		.match(
			/^(fire|ice|lightning|wind|water|earth)(dmgup|dmgdown|resistup|resistdown|dmgbonus|weaponboost|dmgrcvdup|mastery|interruptup|atbconservation|weakness|abilities)$/,
		);
	if (elementPrefix) {
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
			abilities: "ampElemAbilities",
		};
		return { type: suffixMap[elementPrefix[2]], elem: elementPrefix[1] };
	}

	const aliases = {
		windDmgUp: { type: "elemDmgUp", elem: "wind" },
		physDmgRcvdUp: { type: "singleTgtPhysDmgRcvdUp", elem: "none" },
		physicalDmgRcvdUp: { type: "singleTgtPhysDmgRcvdUp", elem: "none" },
		singleTgtPhysDmgRcvdUp: { type: "singleTgtPhysDmgRcvdUp", elem: "none" },
		magDmgRcvdUp: { type: "singleTgtMagDmgRcvdUp", elem: "none" },
		magicalDmgRcvdUp: { type: "singleTgtMagDmgRcvdUp", elem: "none" },
		magicDmgRcvdUp: { type: "singleTgtMagDmgRcvdUp", elem: "none" },
		singleTgtMagDmgRcvdUp: { type: "singleTgtMagDmgRcvdUp", elem: "none" },
		elementalDmgRcvdUp: { type: "elemDmgRcvdUp", elem: rawElem },
	};
	const alias = aliases[rawType];
	if (!alias) return { type: rawType, elem: rawElem };
	return {
		type: alias.type,
		elem: alias.elem === "none" ? rawElem : alias.elem,
	};
}

export function effectDisplayName(kind, type, elem, status, target) {
	const key = cleanText(type || status || target);
	const element = cleanText(elem).toLowerCase();
	if (kind === "set" && key === "allCure") return "All Cure Materia Support";
	if (kind === "set" && key === "allEsuna") return "All Esuna Support";
	if (kind === "amp" && key === "buff") return "Amp. Buffs";
	if (kind === "amp" && key === "debuff") return "Amp. Debuffs";
	if (status) return status.charAt(0).toUpperCase() + status.slice(1);

	const elemental = (suffix, fallback) =>
		element && element !== "none"
			? `${elemLabel(element)} ${suffix}`
			: fallback;
	const labels = {
		patkUp: "PATK Up",
		matkUp: "MATK Up",
		patkBoost: "PATK Boost",
		pdefUp: "PDEF Up",
		mdefUp: "MDEF Up",
		patkDown: "PATK Down",
		matkDown: "MATK Down",
		pdefDown: "PDEF Down",
		mdefDown: "MDEF Down",
		elemDmgUp: elemental("Pot. Up", "Elem. Pot. Up"),
		elemDmgDown: elemental("Pot. Down", "Elem. Pot. Down"),
		elemResistUp: elemental("Resist. Up", "Elem. Resist. Up"),
		elemResistDown: elemental("Resist. Down", "Elem. Resist. Down"),
		physResistUp: "Phys. Resist. Up",
		magResistUp: "Mag. Resist. Up",
		haste: "Haste",
		enliven: "Enliven",
		enfeeble: "Enfeeble",
		exploitWeakness: "Exploit Weakness",
		physDmgBonus: "Physical Damage Bonus",
		magDmgBonus: "Magic Damage Bonus",
		elemDmgBonus: elemental("Damage Bonus", "Elemental Damage Bonus"),
		physWeaponBoost: "Physical Weapon Boost",
		magWeaponBoost: "Magic Weapon Boost",
		elemWeaponBoost: elemental("Weapon Boost", "Elemental Weapon Boost"),
		singleTgtPhysDmgRcvdUp: "Single-Tgt. Phys. Dmg. Rcvd. Up",
		singleTgtMagDmgRcvdUp: "Single-Tgt. Mag. Dmg. Rcvd. Up",
		elemDmgRcvdUp: elemental("Dmg. Rcvd. Up", "Elem. Dmg. Rcvd. Up"),
		hpGain: "HP Gain",
		regen: "Regen",
		barrier: "Barrier",
		provoke: "Provoke",
		veil: "Veil",
		quintInterrupt: "Quintessential Interruption",
		overspeed: "Overspeed Gauge",
		limit: "Limit Gauge",
		atb: "ATB Gauge",
		atbGift: "ATB Gauge",
		gearUses: "Gear C. Ability Uses",
		command: "Command Fill Gauge",
		removePoison: "Remove Poison",
		removeSilence: "Remove Silence",
		removeBlind: "Remove Blind",
		removeSleep: "Remove Sleep",
		removeParalyze: "Remove Paralyze",
		removeStun: "Remove Stun",
		removeSlow: "Remove Slow",
		removeStop: "Remove Stop",
		removePatkDown: "Remove PATK Down",
		removeMatkDown: "Remove MATK Down",
		removePdefDown: "Remove PDEF Down",
		removeMdefDown: "Remove MDEF Down",
		removeMdefUp: "Remove MDEF Up",
		pdefBoost: "Boost PDEF",
		mdefBoost: "Boost MDEF",
		healingBoost: "Boost HEAL",
		elemMastery: elemental("Mastery", "Elemental Mastery"),
		physAtbConservation: "Phys. ATB Conservation",
		magAtbConservation: "Mag. ATB Conservation",
		elemAtbConservation: elemental(
			"ATB Conservation",
			"Elemental ATB Conservation",
		),
		physInterruptUp: "Phys. Interrupt Up",
		magicInterruptUp: "Mag. Interrupt Up",
		elemInterruptUp: elemental("Interrupt Up", "Elemental Interrupt Up"),
		ampHealing: "Amp. Healing",
		ampElemAbilities: elemental("Abilities", "Amp. Elemental Abilities"),
		elemWeakness: elemental("Weakness", "Elemental Weakness"),
	};
	return labels[key] || key || kind;
}

export function whenDisplay(when) {
	if (!when) return "";
	return when
		.split("&")
		.map((condition) => {
			if (condition.startsWith("custom:")) {
				const custom = condition.slice(7);
				return `${custom.charAt(0).toUpperCase() + custom.slice(1)} Custom`;
			}
			if (condition.startsWith("status:"))
				return `Status: ${condition.slice(7)}`;
			return CONDITION_LABEL[condition] || condition;
		})
		.join(" + ");
}

export function inferPyramidLayer(kind, type) {
	if (type === "torpor") return 6;
	if (["elemWeaponBoost", "physWeaponBoost", "magWeaponBoost"].includes(type))
		return 5;
	if (["elemDmgBonus", "physDmgBonus", "magDmgBonus"].includes(type)) return 4;
	if (
		[
			"exploitWeakness",
			"singleTgtPhysDmgRcvdUp",
			"singleTgtMagDmgRcvdUp",
			"elemDmgRcvdUp",
			"dmgRcvdUp",
		].includes(type)
	)
		return 3;
	if (type === "enliven" || type === "enfeeble") return 2;
	if (kind === "amp" && (type === "buff" || type === "debuff")) return 2;
	if (type === "patkBoost" || TIERED_TYPES.has(type)) return 1;
	return 0;
}
