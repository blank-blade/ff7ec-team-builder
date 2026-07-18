const ATTACK_BUFF = Object.freeze([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
const POTENCY_BUFF = Object.freeze([0, 0.1, 0.25, 0.4, 0.6, 0.8]);
const DEFENSE_DOWN = Object.freeze([0, 0.15, 0.25, 0.35, 0.45, 0.55]);

const PERCENT_MULTIPLIERS = new Set([
	"exploitWeakness",
	"physDmgBonus",
	"magDmgBonus",
	"elemDmgBonus",
	"physWeaponBoost",
	"magWeaponBoost",
	"elemWeaponBoost",
	"singleTgtPhysDmgRcvdUp",
	"singleTgtMagDmgRcvdUp",
	"elemDmgRcvdUp",
	"elemWeakness",
	"ampPhysAbilities",
	"ampMagAbilities",
	"ampElemAbilities",
	"uniqueDamageBoost",
]);

const POTENCY_PASSIVES = new Set([
	"elemArcanum",
	"elemMastery",
	"physAbilityMastery",
	"magAbilityMastery",
]);

function finite(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function tierValue(table, tier) {
	return table[clamp(Math.trunc(finite(tier, 0)), 0, table.length - 1)] || 0;
}

function appliesToHit(effect, arch, elem) {
	if (effect.elem && effect.elem !== "none" && effect.elem !== elem) return false;
	if (effect.type.startsWith("phys") && arch !== "phys") return false;
	if (
		(effect.type.startsWith("mag") || effect.type === "singleTgtMagDmgRcvdUp") &&
		arch !== "mag"
	)
		return false;
	if (effect.type === "singleTgtPhysDmgRcvdUp" && arch !== "phys") return false;
	return true;
}

function bestTier(effects, type, arch, elem, bonus = 0) {
	let tier = 0;
	for (const effect of effects) {
		if (effect.type !== type || !appliesToHit(effect, arch, elem)) continue;
		tier = Math.max(tier, finite(effect.tier, 0));
	}
	return clamp(tier + bonus, 0, 5);
}

function maxPercent(effects, type, arch, elem) {
	let value = 0;
	let found = false;
	for (const effect of effects) {
		if (effect.type !== type || !appliesToHit(effect, arch, elem)) continue;
		const percent = Number(effect.value);
		if (!Number.isFinite(percent) || percent <= 0) continue;
		found = true;
		value = Math.max(value, percent / 100);
	}
	return found ? value : null;
}

function maxAmplifier(effects, target) {
	let tier = 0;
	for (const effect of effects) {
		if (effect.kind !== "amp" || effect.type !== target) continue;
		tier = Math.max(tier, finite(effect.tier, 0));
	}
	return tier;
}

function hasEffect(effects, type) {
	return effects.some((effect) => effect.type === type);
}

export function normalizeDamageModelOptions(options = {}) {
	return {
		attack: Math.max(1, finite(options.attack, 1000)),
		enemyDefense: Math.max(0, finite(options.enemyDefense, 100)),
		stanceBonus: clamp(finite(options.stanceBonus, 50), 0, 500) / 100,
		basePotencyBonus:
			clamp(finite(options.basePotencyBonus, 0), 0, 1000) / 100,
		objective: options.objective === "team" ? "team" : "anchor",
		window: options.window === "peak" ? "peak" : "sustained",
	};
}

export function calculateTheoreticalDamage(hit, rawEffects, rawOptions = {}) {
	const options = normalizeDamageModelOptions(rawOptions);
	const arch = hit?.arch === "mag" ? "mag" : "phys";
	const elem = hit?.elem || "nonelem";
	const potency = Math.max(0, finite(hit?.potency, 0)) / 100;
	const effects = (rawEffects || []).filter((effect) =>
		appliesToHit(effect, arch, elem),
	);
	const buffAmp = maxAmplifier(effects, "buff");
	const debuffAmp = maxAmplifier(effects, "debuff");
	const enfeeble = hasEffect(effects, "enfeeble") ? 1 : 0;

	const attackType = arch === "phys" ? "patkUp" : "matkUp";
	const defenseType = arch === "phys" ? "pdefDown" : "mdefDown";
	const attackTier = bestTier(effects, attackType, arch, elem, buffAmp);
	const defenseTier = bestTier(
		effects,
		defenseType,
		arch,
		elem,
		debuffAmp + enfeeble,
	);
	const potencyTier = bestTier(effects, "elemDmgUp", arch, elem, buffAmp);

	let attackBonus = tierValue(ATTACK_BUFF, attackTier);
	for (const type of [
		arch === "phys" ? "boostPATK" : "boostMATK",
		"boostATK",
		"boostATKAll",
		arch === "phys" ? "patkBoost" : "matkBoost",
	]) {
		const value = maxPercent(effects, type, arch, elem);
		if (value !== null) attackBonus += value;
	}

	let potencyBonus = options.basePotencyBonus + tierValue(POTENCY_BUFF, potencyTier);
	for (const type of POTENCY_PASSIVES) {
		const value = maxPercent(effects, type, arch, elem);
		if (value !== null) potencyBonus += value;
	}

	const defenseDown = tierValue(DEFENSE_DOWN, defenseTier);
	const effectiveDefense = Math.ceil(options.enemyDefense * (1 - defenseDown));
	const divisor = effectiveDefense * 2.2 + 100;
	const weaknessMultiplier = hit?.hitsWeakness ? 2 : 1;

	const multiplierParts = [];
	const unquantified = [];
	for (const type of PERCENT_MULTIPLIERS) {
		const relevant = effects.filter(
			(effect) => effect.type === type && appliesToHit(effect, arch, elem),
		);
		if (!relevant.length) continue;
		const percent = maxPercent(relevant, type, arch, elem);
		if (percent === null) {
			unquantified.push(type);
			continue;
		}
		multiplierParts.push({ type, value: percent, multiplier: 1 + percent });
	}

	if (effects.some((effect) => effect.type === "elemResistDown"))
		unquantified.push("elemResistDown");
	if (effects.some((effect) => effect.type === "torpor"))
		unquantified.push("torpor");
	if (effects.some((effect) => effect.type === "enliven"))
		unquantified.push("enliven");

	const namedMultiplier = multiplierParts.reduce(
		(product, part) => product * part.multiplier,
		1,
	);
	const base =
		(options.attack * (1 + attackBonus) *
			50 *
			potency *
			(1 + potencyBonus) *
			(1 + options.stanceBonus)) /
		divisor;
	const damage = base * weaknessMultiplier * namedMultiplier;

	return {
		damage,
		low: damage * 0.985,
		high: damage * 1.015,
		isLowerBound: unquantified.length > 0,
		unquantified: Array.from(new Set(unquantified)),
		breakdown: {
			attack: options.attack,
			attackTier,
			attackBonus,
			potency: potency * 100,
			potencyTier,
			potencyBonus,
			enemyDefense: options.enemyDefense,
			defenseTier,
			defenseDown,
			effectiveDefense,
			divisor,
			stanceMultiplier: 1 + options.stanceBonus,
			weaknessMultiplier,
			namedMultipliers: multiplierParts,
		},
	};
}

export function formatDamage(value) {
	return Math.round(finite(value, 0)).toLocaleString("en-US");
}
