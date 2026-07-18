import { ELEMENTAL_TYPES } from "./effect-model.js";
import { calculateTheoreticalDamage } from "./damage-model.js";

const DAMAGE_PASSIVE_TYPES = new Set([
	"boostPATK",
	"boostMATK",
	"boostATK",
	"boostATKAll",
	"elemArcanum",
	"elemMastery",
	"physAbilityMastery",
	"magAbilityMastery",
	"uniqueDamageBoost",
]);

function desiredAllowsEffect(cap, desiredList) {
	if (cap.mode === "passive") return DAMAGE_PASSIVE_TYPES.has(cap.type);
	return desiredList.some((desired) => {
		if (desired.kind !== cap.kind || desired.type !== cap.type) return false;
		if (!ELEMENTAL_TYPES.has(cap.type)) return true;
		return (
			!desired.elem ||
			desired.elem === "none" ||
			desired.elem === (cap.elem || "none")
		);
	});
}

function effectAppliesToMember(cap, source, member) {
	if (
		cap.kind === "debuff" ||
		(cap.kind === "amp" && cap.type === "debuff")
	)
		return true;
	if (cap.mode === "passive") return source === member || /All$/.test(cap.type);
	switch (cap.range || "none") {
		case "allAllies":
			return true;
		case "allyExcludingSelf":
			return source !== member;
		case "singleAlly":
			return member.roleKind === "dps" || member.roleKind === "dpsHealer";
		case "self":
		case "none":
		case "unknown":
			return source === member;
		default:
			return false;
	}
}

function effectsForMember(context, member) {
	const effects = [];
	for (const source of context.loadouts) {
		for (const item of context.loadoutSlots(source.lo)) {
			for (const cap of item.capabilities || []) {
				if (cap.custom !== null && cap.custom !== item.chosenCustom) continue;
				if (!desiredAllowsEffect(cap, context.desiredList)) continue;
				if (!context.conditionSupported(cap.when, context.teamSignals)) continue;
				if (
					cap.mode !== "passive" &&
					context.damageModel.window === "sustained" &&
					(item.item.type === "ultimate" || item.item.type === "gear")
				)
					continue;
				if (effectAppliesToMember(cap, source, member)) effects.push(cap);
			}
		}
	}
	return effects;
}

function bestHitForMember(context, member) {
	let best = null;
	for (const item of context.loadoutSlots(member.lo, true)) {
		for (const hit of item.damage || []) {
			if (hit.custom !== null && hit.custom !== item.chosenCustom) continue;
			const fitTier = context.damageFitTier(
				hit,
				context.hasElementTarget(),
			);
			if (fitTier <= 0) continue;
			const potency = context.effectivePot(
				hit,
				Object.assign({}, context.teamSignals, { hitsWeakness: fitTier >= 3 }),
			);
			if (!best || potency > best.potency) {
				best = {
					arch: hit.arch,
					elem: hit.elem,
					potency,
					hitsWeakness: fitTier >= 3,
					itemName: item.item.name,
				};
			}
		}
	}
	return best;
}

export function calculateTeamTheoreticalDamage(context) {
	const members = context.loadouts.map((member) => {
		const hit = bestHitForMember(context, member);
		if (!hit) return { member, hit: null, damage: null };
		return {
			member,
			hit,
			damage: calculateTheoreticalDamage(
				hit,
				effectsForMember(context, member),
				context.damageModel,
			),
		};
	});
	const anchor = members.find(
		(entry) =>
			entry.member.roleKind === "dps" ||
			entry.member.roleKind === "dpsHealer",
	);
	const anchorDamage = anchor?.damage?.damage || 0;
	const teamDamage = members.reduce(
		(sum, entry) => sum + (entry.damage?.damage || 0),
		0,
	);
	const unquantified = Array.from(
		new Set(members.flatMap((entry) => entry.damage?.unquantified || [])),
	);
	return {
		members,
		anchorDamage,
		teamDamage,
		objectiveDamage:
			context.damageModel.objective === "team" ? teamDamage : anchorDamage,
		isLowerBound: unquantified.length > 0,
		unquantified,
	};
}
