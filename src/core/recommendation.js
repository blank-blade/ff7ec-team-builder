import {
	archLabel,
	canonicalizeTypeAndElem,
	cleanText,
	DEFENSIVE_BUFF_TYPES,
	ELEMENTAL_TYPES,
	effectDisplayName,
	elemLabel,
	inferPyramidLayer,
	MATERIA_TIERED_TYPES,
	normalizeTier,
	RANGE_LABEL,
	SELF_OK_TYPES,
	splitCondition,
	TIER_LABEL,
	TIERED_TYPES,
	tierDisplay,
	whenDisplay,
} from "./effect-model.js";
import { resolveEquipmentRows } from "./equipment-parser.js";
import {
	formatDamage,
	normalizeDamageModelOptions,
} from "./damage-model.js";
import { calculateTeamTheoreticalDamage } from "./team-damage.js";

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
export function recommendTeamsGrid(
	equipmentsData,
	weakArch,
	weakElem,
	wantBuffsStr,
	wantDebuffsStr,
	healerNeeded,
	damageAssumption,
	manualCoverageMode,
	anchorHealThreshold,
	includeUW,
	includeGear,
	includeMateria,
	coopMode,
	damageObjective,
	attackValue,
	enemyDefense,
	stanceBonus,
	basePotencyBonus,
	damageWindow,
) {
	if (!equipmentsData || equipmentsData.length < 2)
		return [["No equipment data found"]];

	const MAX_DISPLAY_BUILDS = 10;
	const DEFAULT_TIERED_MIN_TIER = 3;
	const HIGH_TIER_THRESHOLD = 3;
	const DEFAULT_ANCHOR_HEAL_THRESHOLD = 47;
	const ALL_CURE_INFERRED_HEAL_POTENCY = 60;
	const LIMITED_USE_ACTIVE_UTILITY_COVERAGE_FACTOR = 0.55;
	const MATERIA_ACTIVE_UTILITY_COVERAGE_FACTOR = 0.72;
	const TOTAL_MATERIA_SLOTS = 3;
	const exclusiveGroups = [["Sephiroth", "Seph OG"]];

	function parseBool(value) {
		if (value === true) return true;
		return ["true", "yes", "y", "1", "needed", "need", "healer", "on"].includes(
			cleanText(value).toLowerCase(),
		);
	}

	function normalizeDamageAssumption(value) {
		const normalized = cleanText(value).toLowerCase().replace(/\s+/g, "");
		if (
			["optimistic", "opt", "best", "bestcase", "best-case"].includes(
				normalized,
			)
		)
			return "optimistic";
		if (["baseonly", "base", "off", "none", "false", "0"].includes(normalized))
			return "baseOnly";
		return "conservative";
	}

	const target = {
		weakArch: weakArch ? cleanText(weakArch).toLowerCase() : null,
		weakElem: weakElem ? cleanText(weakElem).toLowerCase() : null,
		healerNeeded: parseBool(healerNeeded),
		damageAssumption: normalizeDamageAssumption(damageAssumption),
		anchorHealThreshold: Math.max(
			1,
			Number(anchorHealThreshold) || DEFAULT_ANCHOR_HEAL_THRESHOLD,
		),
		// Ultimate Weapons and Gear are opt-in toggles that default ON to match the
		// prior behavior. When OFF, their pools are skipped entirely during loadout
		// assembly. When ON, they are still only kept in a build when they add an
		// active contribution (coverage or heal); otherwise the build is simplified.
		includeUW: includeUW === undefined ? true : parseBool(includeUW),
		includeGear: includeGear === undefined ? true : parseBool(includeGear),
		includeMateria:
			includeMateria === undefined ? false : parseBool(includeMateria),
		coopMode: coopMode === undefined ? false : parseBool(coopMode),
		damageModel: normalizeDamageModelOptions({
			objective: damageObjective,
			attack: attackValue,
			enemyDefense,
			stanceBonus,
			basePotencyBonus,
			window: damageWindow,
		}),
	};

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
		return str
			.toString()
			.split(",")
			.map((raw) => raw.trim())
			.filter(Boolean)
			.map((raw) => {
				let text = raw
					.replace(/^buff:/i, "")
					.replace(/^debuff:/i, "")
					.trim();
				const ampMatch = text.match(
					/^amp(?:\s+target\s*=\s*|:)(buff|debuff)s?$/i,
				);
				if (ampMatch) {
					const d = {
						kind: "amp",
						type: ampMatch[1].toLowerCase(),
						elem: "none",
						minTier: 0,
						key: null,
						layer: 2,
					};
					d.key = desiredKey(d);
					return d;
				}
				text = text.replace(/\s*tier\s*=\s*/i, ":").replace(/\s*=\s*/g, ":");
				const parts = text
					.split(":")
					.map((p) => p.trim())
					.filter(Boolean);
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

				if (
					(!elem || elem === "none") &&
					ELEMENTAL_TYPES.has(type) &&
					target.weakElem &&
					target.weakElem !== "nonelem"
				)
					elem = target.weakElem;
				const d = {
					kind,
					type,
					elem: elem || "none",
					minTier,
					key: null,
					layer: inferPyramidLayer(kind, type),
				};
				d.key = desiredKey(d);
				return d;
			});
	}

	const explicitBuffs = parseDesiredList(wantBuffsStr, "buff");
	const explicitDebuffs = parseDesiredList(wantDebuffsStr, "debuff");
	// Provoke is a special defensive buff: when selected, every recommended team
	// must include a Provoke source, and the carrier is designated as the Tank.
	const provokeRequired = explicitBuffs.some((d) => d.type === "provoke");
	const implicitBuffs = [];
	const implicitUtility = [];
	const synergyDisplayList = [];
	function addImplicitBuff(type, minTier, label, elem, layer) {
		const d = {
			kind: "buff",
			type,
			elem: elem || "none",
			minTier: minTier || 0,
			layer: layer || inferPyramidLayer("buff", type),
		};
		d.key = desiredKey(d);
		implicitBuffs.push(d);
		synergyDisplayList.push(
			label + (minTier ? ` (${TIER_LABEL[minTier]})` : ""),
		);
	}
	function addImplicitUtility(kind, type, minTier, label, layer) {
		const d = {
			kind,
			type,
			elem: "none",
			minTier: minTier || 0,
			layer: layer || inferPyramidLayer(kind, type),
		};
		d.key = desiredKey(d);
		implicitUtility.push(d);
		synergyDisplayList.push(
			label + (minTier ? ` (${TIER_LABEL[minTier]})` : ""),
		);
	}

	if (!manualCoverageMode && (target.weakArch || target.weakElem)) {
		// Pyramid Layer 1: primary offensive status tier targets.
		if (target.weakArch === "phys")
			addImplicitBuff("patkUp", 3, "L1: PATK Up", "none", 1);
		if (target.weakArch === "mag")
			addImplicitBuff("matkUp", 3, "L1: MATK Up", "none", 1);
		if (target.weakElem && target.weakElem !== "nonelem")
			addImplicitBuff(
				"elemDmgUp",
				3,
				`L1: ${elemLabel(target.weakElem)} Pot. Up`,
				target.weakElem,
				1,
			);

		// Pyramid Layer 2: general acceleration / availability.
		addImplicitBuff("enliven", 0, "L2: Enliven", "none", 2);
		addImplicitUtility("amp", "buff", 0, "L2: Amp Buffs", 2);
		if (explicitDebuffs.length > 0)
			addImplicitUtility("amp", "debuff", 0, "L2: Amp Debuffs", 2);

		// Pyramid Layer 3: weakness exploitation traits. Enemy-side Damage Received Up is debuff-immunity-sensitive,
		// so singleTgtPhysDmgRcvdUp/singleTgtMagDmgRcvdUp/elemDmgRcvdUp/torpor are left to explicit debuff input.
		if (target.weakElem && target.weakElem !== "nonelem")
			addImplicitBuff("exploitWeakness", 0, "L3: Exploit Weakness", "none", 3);

		// Pyramid Layer 4: broad damage bonuses.
		if (target.weakArch === "phys")
			addImplicitBuff(
				"physDmgBonus",
				0,
				"L4: Physical Damage Bonus",
				"none",
				4,
			);
		if (target.weakArch === "mag")
			addImplicitBuff("magDmgBonus", 0, "L4: Magic Damage Bonus", "none", 4);
		if (target.weakElem && target.weakElem !== "nonelem")
			addImplicitBuff(
				"elemDmgBonus",
				0,
				`L4: ${elemLabel(target.weakElem)} Damage Bonus`,
				target.weakElem,
				4,
			);

		// Pyramid Layer 5: weapon/element boost traits.
		if (target.weakArch === "phys")
			addImplicitBuff(
				"physWeaponBoost",
				0,
				"L5: Physical Weapon Boost",
				"none",
				5,
			);
		if (target.weakArch === "mag")
			addImplicitBuff("magWeaponBoost", 0, "L5: Magic Weapon Boost", "none", 5);
		if (target.weakElem && target.weakElem !== "nonelem")
			addImplicitBuff(
				"elemWeaponBoost",
				0,
				`L5: ${elemLabel(target.weakElem)} Weapon Boost`,
				target.weakElem,
				5,
			);
	}

	const desiredMap = new Map();
	[
		...explicitBuffs,
		...implicitBuffs,
		...implicitUtility,
		...explicitDebuffs,
	].forEach((d) => {
		if (d.layer === undefined || d.layer === null)
			d.layer = inferPyramidLayer(d.kind, d.type);
		desiredMap.set(d.key, d);
	});
	const desiredList = Array.from(desiredMap.values());
	const wantedKeys = new Set(desiredList.map((d) => d.key));
	const desiredByCapability = new Map();
	for (const desired of desiredList) {
		const key = `${desired.kind}:${desired.type}`;
		if (!desiredByCapability.has(key)) desiredByCapability.set(key, []);
		desiredByCapability.get(key).push(desired);
	}

	const { resolvedItems, schemaWarnings } =
		resolveEquipmentRows(equipmentsData);

	function customOptionsFor(r, chosenCustom) {
		const customToUse =
			chosenCustom !== undefined
				? chosenCustom
				: r.chosenCustom !== undefined
					? r.chosenCustom
					: "AUTO";
		return customToUse === "AUTO" ? r.customOptions : [customToUse];
	}

	function hasElementTarget() {
		return !!(
			target.weakElem &&
			target.weakElem !== "none" &&
			target.weakElem !== "nonelem"
		);
	}

	function archMatchesTarget(d) {
		return (
			!target.weakArch ||
			d.arch === target.weakArch ||
			d.arch === "hybrid" ||
			d.arch === "any"
		);
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
		if (target.weakArch && archMatch && elemMatch) return 4;
		if (elemMatch) return 3;
		if (target.weakArch && archMatch && d.elem === "nonelem") return 2;
		return 1;
	}

	function conditionSupportedForDamageMod(cond, context) {
		if (!cond) return true;
		if (target.damageAssumption === "optimistic") return true;
		if (target.damageAssumption === "baseOnly") return false;

		const ctx = context || {};
		return splitCondition(cond).every((c) => {
			if (c === "targetHasDebuff") return !!ctx.teamHasDebuff;
			if (c === "selfHasBuff")
				return !!ctx.teamHasBuff || !!ctx.memberHasSelfBuff;
			if (c === "hitWeakness") return !!ctx.hitsWeakness;
			if (["selfHpGe50", "selfHpGe70", "selfHpEq100"].includes(c))
				return !!ctx.teamHasAnchorHealer;
			if (["selfHpLe30", "selfHpLt50"].includes(c)) return false;
			return false;
		});
	}

	function getEffectivePot(d, context) {
		let pot = Number(d?.pot || 0);
		if (!d?.mods?.length) return pot;
		d.mods.forEach((mod) => {
			if (!conditionSupportedForDamageMod(mod.when, context)) return;
			if (mod.mult) pot *= mod.mult;
			// Flat added damage is deliberately display-only for now because FF7EC meta ranking is potency and B/D stacking driven.
		});
		return Math.round(pot);
	}

	function getWeaponScore(r, chosenCustom, options) {
		if (!r) return 0;
		const requireExactElement = !!options?.requireExactElement;
		const contextBase = options?.context ? options.context : {};
		let maxScore = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.damage.forEach((d) => {
				if (d.custom !== null && d.custom !== opt) return;
				const fitTier = getDamageFitTier(d, requireExactElement);
				if (fitTier > 0) {
					const effectivePot = getEffectivePot(
						d,
						Object.assign({}, contextBase, { hitsWeakness: fitTier >= 3 }),
					);
					maxScore = Math.max(maxScore, fitTier * 1000000 + effectivePot);
				}
			});
		});
		return maxScore;
	}

	function getAnchorDpsScore(r, chosenCustom) {
		return getWeaponScore(r, chosenCustom, {
			requireExactElement: hasElementTarget(),
		});
	}

	function getAnchorSustainedDamage(r, chosenCustom, context) {
		return getSuitingDamage(r, chosenCustom, {
			requireExactElement: hasElementTarget(),
			context: context || {},
		});
	}

	function hasNaturalTargetMatch(r, chosenCustom) {
		if (!r?.damage) return false;
		let found = false;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.damage.forEach((d) => {
				if (d.custom !== null && d.custom !== opt) return;
				// "Natural fit" means the weapon's basic command shape matches the
				// target archetype + element. Potency is not part of the condition.
				if (getDamageFitTier(d, true) >= 4) found = true;
			});
		});
		return found;
	}

	function capSatisfiesDesired(cap, desired, isMemberAnchor, isDpsAnchor) {
		if (!cap || !desired) return false;

		if (cap.kind !== desired.kind) return false;
		if (cap.type !== desired.type) return false;

		const desiredElem = desired.elem || "none";
		if (ELEMENTAL_TYPES.has(desired.type) && desiredElem !== "none") {
			if ((cap.elem || "none") !== desiredElem) return false;
		}

		if ((desired.minTier || 0) > 0 && (cap.tier || 0) < desired.minTier)
			return false;

		// Self-only defensive/utility buffs (e.g. Provoke, Esuna) are the
		// carrier's personal role and always satisfy coverage.
		if (SELF_OK_TYPES.has(cap.type)) return true;

		// Offensive buffs must benefit the anchor DPS. A self-range offensive
		// buff only counts when the carrier IS the DPS (they buff themself);
		// a self-range offensive buff on a support/healer must not be considered
		// at all, since it does not help the DPS deal damage.
		const isOffensiveBuff =
			desired.kind === "buff" && !DEFENSIVE_BUFF_TYPES.has(desired.type);
		if (isOffensiveBuff && cap.range === "self" && !isDpsAnchor) return false;

		// Other self-only buffs only satisfy coverage when the member is an anchor.
		if (cap.range === "self" && !isMemberAnchor) return false;

		return true;
	}

	function limitedUseLabel(r) {
		if (!r?.item) return "Limited-use";
		if (r.item.type === "ultimate") return "Limited-use U.C. Ability";
		if (r.item.type === "gear") return "Limited-use Gear C. Ability";
		return "Limited-use";
	}

	function isLimitedUseActiveUtility(r, cap) {
		if (!r?.item || !cap) return false;
		if (r.item.type !== "ultimate" && r.item.type !== "gear") return false;
		if (cap.kind === "dmg" || cap.kind === "heal") return false;
		if (cap.mode === "passive") return false;
		return true;
	}

	function isMateriaActiveUtility(r, cap) {
		return !!(
			r?.item?.type === "materia" &&
			cap &&
			cap.kind !== "dmg" &&
			cap.kind !== "heal" &&
			cap.mode !== "passive"
		);
	}

	function isDefensiveBuffDesired(desired) {
		return !!(
			desired &&
			desired.kind === "buff" &&
			DEFENSIVE_BUFF_TYPES.has(desired.type)
		);
	}

	function getCoverageRangeScore(cap, desired, isMemberAnchor, isDpsAnchor) {
		const range = cap.range || "none";

		// Defensive buffs are team-survival tools. Prefer AOE heavily; a self-only
		// defensive buff can still be useful on an anchor, but should not compete
		// closely with party-wide mitigation.
		if (isDefensiveBuffDesired(desired)) {
			return (
				{
					allAllies: 160000,
					allyExcludingSelf: 70000,
					singleAlly: 25000,
					self: isMemberAnchor ? 8000 : -20000,
					allEnemies: 0,
					singleEnemy: 0,
					none: 0,
					unknown: 0,
				}[range] || 0
			);
		}

		// Offensive buffs must benefit the anchor DPS. Enemy-targeted ranges
		// never apply to allies, so they score nothing. Self-range only scores
		// when the carrier is the DPS (they buff themself); otherwise it is
		// irrelevant to the DPS and must not be considered.
		const isOffensiveBuff =
			desired.kind === "buff" && !DEFENSIVE_BUFF_TYPES.has(desired.type);
		if (isOffensiveBuff) {
			return (
				{
					allAllies: 4000,
					allyExcludingSelf: 1800,
					singleAlly: 1800,
					self: isDpsAnchor ? 1200 : 0,
					allEnemies: 0,
					singleEnemy: 0,
					none: 0,
					unknown: 0,
				}[range] || 0
			);
		}

		// Debuffs / utility: keep prior scoring.
		return (
			{
				allAllies: 4000,
				allEnemies: 4000,
				singleEnemy: 2500,
				singleAlly: 1800,
				self: isMemberAnchor ? 1200 : 0,
				allyExcludingSelf: 1800,
				none: 0,
				unknown: 0,
			}[range] || 0
		);
	}

	function coverageScoreForCap(r, cap, desired, isMemberAnchor, isDpsAnchor) {
		const layer =
			desired.layer || inferPyramidLayer(desired.kind, desired.type);
		const layerWeight =
			{
				1: 500000,
				2: 350000,
				3: 250000,
				4: 160000,
				5: 140000,
				6: 120000,
			}[layer] || 100000;

		const tierScore = (cap.tier || 0) * 10000;

		const rangeScore = getCoverageRangeScore(
			cap,
			desired,
			isMemberAnchor,
			isDpsAnchor,
		);

		// Conditional defensive mitigation is a bigger concern than conditional
		// offensive support, because missed uptime can mean a wipe.
		const conditionScore =
			isDefensiveBuffDesired(desired) && cap.when ? -5000 : cap.when ? -500 : 0;
		const limitedFactor = isLimitedUseActiveUtility(r, cap)
			? LIMITED_USE_ACTIVE_UTILITY_COVERAGE_FACTOR
			: isMateriaActiveUtility(r, cap)
				? MATERIA_ACTIVE_UTILITY_COVERAGE_FACTOR
				: 1;

		return Math.round(
			(layerWeight + tierScore + rangeScore + conditionScore) * limitedFactor,
		);
	}

	function getCoverageMapForItem(r, isMemberAnchor, isDpsAnchor) {
		const map = new Map();
		if (!r?.capabilities) return map;

		r.capabilities.forEach((cap) => {
			if (cap.custom !== null && cap.custom !== r.chosenCustom) return;
			if (cap.kind === "dmg" || cap.kind === "heal") return;
			if (cap.mode === "passive") return;

			const candidates =
				desiredByCapability.get(`${cap.kind}:${cap.type}`) || [];
			candidates.forEach((desired) => {
				if (!capSatisfiesDesired(cap, desired, isMemberAnchor, isDpsAnchor))
					return;

				const key = desired.key;
				const score = coverageScoreForCap(
					r,
					cap,
					desired,
					isMemberAnchor,
					isDpsAnchor,
				);
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

	function getIncrementalCoverageScoreForItem(
		r,
		isMemberAnchor,
		chosenCustom,
		localCoverageMap,
		isDpsAnchor,
	) {
		if (!r) return 0;

		const pick = Object.assign({}, r, { chosenCustom });
		const coverage = getCoverageMapForItem(pick, isMemberAnchor, isDpsAnchor);
		let score = 0;

		coverage.forEach((entry, key) => {
			const prev = localCoverageMap?.get(key);
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

	// Total coverage quality a weapon provides for the selected effects, regardless
	// of whether those effects are already covered by the team. Used as a
	// tie-breaker for non-DPS roles so a weapon that covers MORE distinct wanted
	// effects (e.g. Stream Guard: MDEF Down + MATK Up) is preferred over a
	// strictly narrower one (e.g. Arc Sword: MDEF Down only) when their
	// incremental contribution is equal. This keeps support/healer weapon choice
	// stable instead of arbitrary/order-dependent once the team already covers a
	// token both weapons share.
	function getOwnCoverageBreadth(r, isMemberAnchor, isDpsAnchor) {
		if (!r) return 0;
		const coverage = getCoverageMapForItem(r, isMemberAnchor, isDpsAnchor);
		let sum = 0;
		coverage.forEach((entry) => {
			sum += entry.score;
		});
		return sum;
	}

	function getNaturalTargetMatchScore(r, chosenCustom) {
		return hasNaturalTargetMatch(r, chosenCustom) ? 1 : 0;
	}

	// DPS second-weapon coverage: the DPS should focus on damage and offensive
	// utility, not on defensive buffs. Defensive buffs are only a healer/support
	// concern, so they are heavily de-prioritized here — self-range defensive
	// buffs are essentially never worth a DPS weapon slot, while AOE defensive
	// buffs remain a tiny tie-breaker in case nobody else can cover them.
	function getDpsIncrementalCoverageScoreForItem(
		r,
		isMemberAnchor,
		chosenCustom,
		localCoverageMap,
	) {
		if (!r) return 0;
		const pick = Object.assign({}, r, { chosenCustom });
		const coverage = getCoverageMapForItem(pick, isMemberAnchor, true);
		let score = 0;
		coverage.forEach((entry, key) => {
			const prev = localCoverageMap?.get(key);
			const defFactor = isDefensiveBuffDesired(entry.desired)
				? dpsDefensiveBuffRangeFactor(entry.cap.range)
				: 1;
			// Enfeeble and Amp are support/heal-domain effects that other team
			// members (support, healer) normally carry. The DPS should not grab
			// them on its 2nd weapon at the expense of a sustained damage booster
			// (e.g. PATK Up / Physical Damage Bonus), which would both waste the
			// DPS slot and make a support/healer's coverage (and UW) redundant.
			const supportDomainFactor = dpsSupportDomainFactor(entry.desired);
			const effective = entry.score * defFactor * supportDomainFactor;
			if (!prev) {
				score += effective;
			} else if (entry.score > prev.score) {
				const prevFactor = isDefensiveBuffDesired(prev.desired)
					? dpsDefensiveBuffRangeFactor(prev.cap.range)
					: 1;
				const prevSupportFactor = dpsSupportDomainFactor(prev.desired);
				const prevEffective = prev.score * prevFactor * prevSupportFactor;
				// Small reward for improving an already-covered token, but much less
				// than adding a new selected effect.
				score += Math.max(0, effective - prevEffective) * 0.1;
			}
		});
		return score;
	}

	// Penalty factor applied to support/heal-domain coverage (Enfeeble, Amp) when
	// the DPS is choosing its 2nd weapon. These effects are normally carried by
	// the support or healer, so the DPS should strongly prefer sustained damage
	// boosters over grabbing them itself.
	function dpsSupportDomainFactor(desired) {
		if (!desired) return 1;
		if (desired.type === "enfeeble") return 0.15;
		if (desired.kind === "amp") return 0.15;
		return 1;
	}

	// Penalty factor applied to defensive-buff coverage when the DPS is choosing
	// a weapon. Self-range defensive buffs are worth nothing to a DPS; AOE
	// defensive buffs are only a faint tie-breaker; other ranges are near-zero.
	function dpsDefensiveBuffRangeFactor(range) {
		switch (range || "none") {
			case "allAllies":
				return 0.1;
			case "self":
				return 0.0;
			case "allyExcludingSelf":
			case "singleAlly":
				return 0.02;
			default:
				return 0.0;
		}
	}

	function getAnchorWeaponPriorityScore(
		r,
		chosenCustom,
		localCoverageMap,
		isAnchor,
		context,
	) {
		const dps = getAnchorSustainedDamage(r, chosenCustom, context);
		if (dps <= 0) return -Infinity;

		const coverage = getIncrementalCoverageScoreForItem(
			r,
			isAnchor,
			chosenCustom,
			localCoverageMap,
		);

		// Anchor weapon selection is DPS-first. Coverage is only a secondary tie-breaker.
		return dps * 1000000 + coverage;
	}

	function getSuitingDamage(r, chosenCustom, options) {
		if (!r) return 0;
		const requireExactElement = !!options?.requireExactElement;
		const contextBase = options?.context ? options.context : {};
		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.damage.forEach((d) => {
				if (d.custom !== null && d.custom !== opt) return;
				const fitTier = getDamageFitTier(d, requireExactElement);
				if (fitTier > 0)
					best = Math.max(
						best,
						getEffectivePot(
							d,
							Object.assign({}, contextBase, { hitsWeakness: fitTier >= 3 }),
						),
					);
			});
		});
		return best;
	}

	function getHealScore(r, chosenCustom) {
		if (!r) return 0;
		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.healing.forEach((h) => {
				if (h.custom !== null && h.custom !== opt) return;
				best = Math.max(best, h.pot || 0);
			});
		});
		return best;
	}

	function hasAllCureSupport(r, chosenCustom) {
		if (!r?.capabilities) return false;
		let found = false;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.capabilities.forEach((cap) => {
				if (cap.custom !== null && cap.custom !== opt) return;
				if (cap.kind === "set" && cap.type === "allCure") found = true;
			});
		});
		return found;
	}

	function getAllCureInferredHealPotency(r, chosenCustom) {
		return hasAllCureSupport(r, chosenCustom)
			? ALL_CURE_INFERRED_HEAL_POTENCY
			: 0;
	}

	function getDisplayedHealScore(r, chosenCustom) {
		return Math.max(
			getHealScore(r, chosenCustom),
			getAllCureInferredHealPotency(r, chosenCustom),
		);
	}

	function getTeamHealScore(r, chosenCustom) {
		if (!r) return 0;
		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			const allCure = hasAllCureSupport(r, opt);
			r.healing.forEach((h) => {
				if (h.custom !== null && h.custom !== opt) return;
				const range = h.range || "unknown";
				if (range === "allAllies" || allCure) best = Math.max(best, h.pot || 0);
			});
			if (allCure) best = Math.max(best, ALL_CURE_INFERRED_HEAL_POTENCY);
		});
		return best;
	}

	function isRegularWeapon(r) {
		return !!(r?.item && r.item.type !== "gear" && r.item.type !== "ultimate");
	}

	function getDirectWeaponHealPotency(r, chosenCustom) {
		if (!isRegularWeapon(r)) return 0;
		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.healing.forEach((h) => {
				if (h.custom !== null && h.custom !== opt) return;
				// Anchor Healer must heal the party. Self-only healing does not
				// benefit allies, so it cannot qualify as a nominal heal source.
				const range = h.range || "unknown";
				if (range === "self") return;
				best = Math.max(best, h.pot || 0);
			});
		});
		return best;
	}

	function getDirectWeaponPartyHealPotency(r, chosenCustom) {
		if (!isRegularWeapon(r)) return 0;
		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.healing.forEach((h) => {
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
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			if (hasAllCureSupport(r, opt)) found = true;
		});
		return found;
	}

	function hasWeaponHealBoostSupport(r, chosenCustom) {
		if (!isRegularWeapon(r) || !r.capabilities) return false;
		let found = false;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			r.capabilities.forEach((cap) => {
				if (cap.custom !== null && cap.custom !== opt) return;
				if (
					cap.type === "healingBoost" ||
					cap.type === "healBoost" ||
					cap.type === "boostHeal"
				)
					found = true;
			});
		});
		return found;
	}

	function getAnchorHealerCategory(r, chosenCustom) {
		if (!isRegularWeapon(r)) return 0;

		let best = 0;
		customOptionsFor(r, chosenCustom).forEach((opt) => {
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
		customOptionsFor(r, chosenCustom).forEach((opt) => {
			const category = getAnchorHealerCategory(r, opt);
			if (category <= 0) return;

			const partyHeal = getDirectWeaponPartyHealPotency(r, opt);
			const nominalHeal = getDirectWeaponHealPotency(r, opt);
			const partyExcess = Math.max(0, partyHeal - target.anchorHealThreshold);
			const nominalExcess = Math.max(
				0,
				nominalHeal - target.anchorHealThreshold,
			);

			// Category dominates. Potency is only intra-category tie-breaking.
			best = Math.max(
				best,
				category * 1000000 + partyExcess * 100 + nominalExcess,
			);
		});

		return best;
	}

	const charMap = new Map();
	resolvedItems.forEach((r) => {
		const c = r.item.character;
		if (!charMap.has(c))
			charMap.set(c, {
				character: c,
				weapons: [],
				ultimates: [],
				gear: [],
				topWeaponScore: 0,
				topAnchorDpsScore: 0,
				topHealScore: 0,
				topTeamHealScore: 0,
				topAnchorHealerScore: 0,
				topFallbackHealScore: 0,
			});
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
			d.topAnchorHealerScore = Math.max(
				d.topAnchorHealerScore,
				anchorHealerScore,
			);
			// Anchor DPS is intentionally still based on regular weapons, so a limited-use Gear/U.C. ability cannot
			// make an otherwise off-profile character become the primary DPS anchor by itself.
			d.topAnchorDpsScore = Math.max(
				d.topAnchorDpsScore,
				getAnchorDpsScore(r, "AUTO"),
			);
		}

		// Healer qualification and supplemental scoring can come from regular weapons, Ultimate Weapons, or Gear C. Abilities.
		d.topHealScore = Math.max(d.topHealScore, healScore);
		d.topTeamHealScore = Math.max(d.topTeamHealScore, teamHealScore);
		d.topFallbackHealScore = Math.max(d.topFallbackHealScore, healScore);
	});

	const chars = Array.from(charMap.values());

	function isBlocked(chosenSet, charName) {
		if (target.coopMode) return false;
		for (const group of exclusiveGroups) {
			if (group.includes(charName) && group.some((m) => chosenSet.has(m)))
				return true;
		}
		return false;
	}

	function buildLoadoutForMember(charData, globalCoveredBases, roleKind) {
		const isAnchor =
			roleKind === "dps" || roleKind === "healer" || roleKind === "dpsHealer";
		const isDpsAnchor = roleKind === "dps" || roleKind === "dpsHealer";
		const localCoverageMap = new Map(globalCoveredBases);
		const wpnPicks = [];
		const wpns = [...charData.weapons];

		function commitPick(raw, custom) {
			const pick = Object.assign({}, raw, { chosenCustom: custom });
			getCoverageMapForItem(pick, isAnchor, isDpsAnchor).forEach((v, k) => {
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
			let bestIdx = -1,
				bestCustom = null,
				bestScore = -Infinity;
			for (let i = 0; i < wpns.length; i++) {
				const raw = wpns[i];
				raw.customOptions.forEach((opt) => {
					const score = getAnchorWeaponPriorityScore(
						raw,
						opt,
						localCoverageMap,
						true,
					);
					if (score > bestScore) {
						bestScore = score;
						bestIdx = i;
						bestCustom = opt;
					}
				});
			}

			if (bestIdx > -1) commitPick(removeAt(wpns, bestIdx), bestCustom);
		}

		if (
			(roleKind === "healer" || roleKind === "dpsHealer") &&
			wpns.length > 0
		) {
			const alreadyAnchorHeals = wpnPicks.some(
				(w) => getAnchorHealerScore(w, w.chosenCustom) > 0,
			);
			if (!alreadyAnchorHeals) {
				let bestIdx = -1,
					bestScore = -Infinity,
					bestCustom = null;

				for (let i = 0; i < wpns.length; i++) {
					const raw = wpns[i];
					if (getAnchorHealerScore(raw, "AUTO") <= 0) continue;

					raw.customOptions.forEach((opt) => {
						const category = getAnchorHealerCategory(raw, opt);
						if (category <= 0) return;

						const incrementalCoverage = getIncrementalCoverageScoreForItem(
							raw,
							true,
							opt,
							localCoverageMap,
							isDpsAnchor,
						);
						const partyHeal = getDirectWeaponPartyHealPotency(raw, opt);
						const nominalHeal = getDirectWeaponHealPotency(raw, opt);
						const partyExcess = Math.max(
							0,
							partyHeal - target.anchorHealThreshold,
						);
						const nominalExcess = Math.max(
							0,
							nominalHeal - target.anchorHealThreshold,
						);
						const roleDps =
							roleKind === "dpsHealer" ? getAnchorSustainedDamage(raw, opt) : 0;

						// Hard source category first; utility coverage refines within category.
						// This guarantees All Cure support outranks single-ally heal weapon.
						const score =
							roleKind === "dpsHealer"
								? category * 1000000000000000 +
									roleDps * 1000000 +
									incrementalCoverage * 1000 +
									partyExcess * 100 +
									nominalExcess
								: category * 1000000000000 +
									incrementalCoverage * 1000000 +
									partyExcess * 1000 +
									nominalExcess;
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
			let bestIdx = -1,
				bestCustomForChoice = null,
				bestScore = -Infinity;
			const isDpsRole = roleKind === "dps" || roleKind === "dpsHealer";
			const isHealerRole = roleKind === "healer" || roleKind === "dpsHealer";
			const alreadyHasAnchorHeal = wpnPicks.some(
				(w) => getAnchorHealerScore(w, w.chosenCustom) > 0,
			);

			for (let i = 0; i < pool.length; i++) {
				const itemRaw = pool[i];
				itemRaw.customOptions.forEach((opt) => {
					const incrementalCoverage = isDpsRole
						? getDpsIncrementalCoverageScoreForItem(
								itemRaw,
								isAnchor,
								opt,
								localCoverageMap,
							)
						: getIncrementalCoverageScoreForItem(
								itemRaw,
								isAnchor,
								opt,
								localCoverageMap,
								isDpsRole,
							);

					let score;
					if (isDpsRole) {
						// Second DPS weapon is utility-first, but the DPS should focus
						// on damage and offensive utility. Defensive buffs (especially
						// self-range) are heavily de-prioritized so the DPS does not
						// waste a slot on party mitigation that the healer/support
						// should cover instead.
						score =
							incrementalCoverage * 1000000 +
							getAnchorSustainedDamage(itemRaw, opt) +
							getDisplayedHealScore(itemRaw, opt);
					} else if (isHealerRole && alreadyHasAnchorHeal) {
						// Once the healer role is satisfied, do not eagerly chase DPS.
						// Prefer buff/debuff coverage, then extra party healing, then nominal healing.
						// Matching target damage is only a small tie-breaker if it naturally fits.
						// Coverage breadth breaks ties toward the weapon that covers
						// more distinct wanted effects.
						score =
							incrementalCoverage * 100000000 +
							getDirectWeaponPartyHealPotency(itemRaw, opt) * 1000 +
							getDirectWeaponHealPotency(itemRaw, opt) +
							getNaturalTargetMatchScore(itemRaw, opt) +
							getOwnCoverageBreadth(itemRaw, isAnchor, isDpsRole);
					} else {
						// Support is utility-first. Do not treat it as Flex DPS.
						// Coverage breadth breaks ties toward the weapon that covers
						// more distinct wanted effects (e.g. Stream Guard over Arc
						// Sword when MDEF Down is already covered by the team).
						score =
							incrementalCoverage * 1000000 +
							getDisplayedHealScore(itemRaw, opt) * 1000 +
							getNaturalTargetMatchScore(itemRaw, opt) +
							getOwnCoverageBreadth(itemRaw, isAnchor, isDpsRole);
					}

					if (score > bestScore) {
						bestScore = score;
						bestIdx = i;
						bestCustomForChoice = opt;
					}
				});
			}

			if (bestIdx !== -1)
				return commitPick(removeAt(pool, bestIdx), bestCustomForChoice);
			return null;
		}

		while (wpnPicks.length < 2 && wpns.length > 0) {
			const pick = pickOneMaximizeCoverage(wpns);
			if (!pick) break;
		}

		const uwPool = target.includeUW ? [...charData.ultimates] : [];
		let uwPick = null;
		if (uwPool.length > 0) {
			let bestIdx = -1,
				bestCustom = null,
				bestScore = -Infinity;
			for (let i = 0; i < uwPool.length; i++) {
				const raw = uwPool[i];
				raw.customOptions.forEach((opt) => {
					const incrementalCoverage = getIncrementalCoverageScoreForItem(
						raw,
						isAnchor,
						opt,
						localCoverageMap,
						isDpsAnchor,
					);
					// Ultimate Weapon C. Ability damage is limited-use burst, not sustained DPS.
					// Keep UW selection utility-first; do not use its c_pot as a DPS tie-breaker.
					const score = incrementalCoverage * 1000000;
					if (score > bestScore) {
						bestScore = score;
						bestIdx = i;
						bestCustom = opt;
					}
				});
			}
			// Only keep the UW when it actively contributes (coverage or heal).
			// Otherwise simplify the build by omitting it.
			if (bestIdx > -1) {
				const candidate = Object.assign({}, uwPool[bestIdx], {
					chosenCustom: bestCustom,
				});
				const candidateCoverage = getIncrementalCoverageScoreForItem(
					candidate,
					isAnchor,
					bestCustom,
					localCoverageMap,
					isDpsAnchor,
				);
				const candidateHeal = getDisplayedHealScore(candidate, bestCustom);
				if (candidateCoverage > 0 || candidateHeal > 0) {
					uwPick = candidate;
					getCoverageMapForItem(uwPick, isAnchor, isDpsAnchor).forEach(
						(v, k) => {
							const prev = localCoverageMap.get(k);
							if (!prev || v.score > prev.score) localCoverageMap.set(k, v);
						},
					);
				}
			}
		}

		const gearPool = target.includeGear ? [...charData.gear] : [];
		let gearPick = null;
		if (gearPool.length > 0) {
			let bestIdx = -1,
				bestCustom = null,
				bestScore = -Infinity;
			for (let i = 0; i < gearPool.length; i++) {
				const raw = gearPool[i];
				raw.customOptions.forEach((opt) => {
					const incrementalCoverage = getIncrementalCoverageScoreForItem(
						raw,
						isAnchor,
						opt,
						localCoverageMap,
						isDpsAnchor,
					);
					// Gear C. Ability damage is limited-use burst, not sustained DPS.
					// Healing may still matter for healer/support utility, but c_pot damage should not rank gear.
					const score =
						incrementalCoverage * 1000000 +
						getDisplayedHealScore(raw, opt) * 1000;
					if (score > bestScore) {
						bestScore = score;
						bestIdx = i;
						bestCustom = opt;
					}
				});
			}
			// Only keep the Gear when it actively contributes (coverage or heal).
			// Otherwise simplify the build by omitting it.
			if (bestIdx > -1) {
				const candidate = Object.assign({}, gearPool[bestIdx], {
					chosenCustom: bestCustom,
				});
				const candidateCoverage = getIncrementalCoverageScoreForItem(
					candidate,
					isAnchor,
					bestCustom,
					localCoverageMap,
					isDpsAnchor,
				);
				const candidateHeal = getDisplayedHealScore(candidate, bestCustom);
				if (candidateCoverage > 0 || candidateHeal > 0) {
					gearPick = candidate;
					getCoverageMapForItem(gearPick, isAnchor, isDpsAnchor).forEach(
						(v, k) => {
							const prev = localCoverageMap.get(k);
							if (!prev || v.score > prev.score) localCoverageMap.set(k, v);
						},
					);
				}
			}
		}

		const requireExactElementForProfile = hasElementTarget();
		const allSlots = [...wpnPicks, uwPick, gearPick].filter(Boolean);
		const sustainedDpsSlots = wpnPicks.filter(Boolean);
		// Sustained DPS is the best matching regular weapon only. UW/Gear C. Ability potency is limited-use burst.
		const dps = Math.max(
			...sustainedDpsSlots.map((it) =>
				getSuitingDamage(it, undefined, {
					requireExactElement: requireExactElementForProfile,
				}),
			),
			0,
		);
		const heal = Math.max(...allSlots.map((w) => getDisplayedHealScore(w)), 0);
		const teamHeal = Math.max(...allSlots.map((w) => getTeamHealScore(w)), 0);
		const anchorHealerScore = Math.max(
			...wpnPicks.map((w) => getAnchorHealerScore(w, w.chosenCustom)),
			0,
		);
		return {
			weapons: wpnPicks,
			ultimate: uwPick,
			gear: gearPick,
			materia: [],
			dps,
			heal,
			teamHeal,
			anchorHealerScore,
			anchorHealerQualified: anchorHealerScore > 0,
			usedFallbackHealer: false,
			updatedCoveredBases: localCoverageMap,
		};
	}

	let bestTeams = [];
	// Set true while evaluating a team that only has a limited-use (UW/Gear) Provoke
	// source, so ranking can prefer teams with a sustained (weapon) Provoke.
	let teamUsesLimitedProvoke = false;
	const anchors = chars
		.filter((c) => (c.topAnchorDpsScore || 0) > 0)
		.sort((a, b) => b.topAnchorDpsScore - a.topAnchorDpsScore);
	const strictHealers = chars
		.filter((c) => (c.topAnchorHealerScore || 0) > 0)
		.sort(
			(a, b) =>
				b.topAnchorHealerScore - a.topAnchorHealerScore ||
				b.topTeamHealScore - a.topTeamHealScore ||
				b.topHealScore - a.topHealScore,
		);
	const rawHealers = chars
		.filter((c) => (c.topFallbackHealScore || 0) > 0)
		.sort((a, b) => b.topHealScore - a.topHealScore);
	const runtimeWarnings = [];

	function loadoutSlots(lo, sustainedOnly = false) {
		return (
			sustainedOnly
				? [lo.weapons[0], lo.weapons[1]]
				: [
						lo.weapons[0],
						lo.weapons[1],
						lo.ultimate,
						lo.gear,
						...(lo.materia || []),
					]
		).filter(Boolean);
	}

	function isAnchorRole(roleKind) {
		return (
			roleKind === "dps" || roleKind === "healer" || roleKind === "dpsHealer"
		);
	}

	function getTeamCoverageMap(loadouts) {
		const teamMap = new Map();
		loadouts.forEach((m) => {
			const isAnchor = isAnchorRole(m.roleKind);
			const isDpsAnchor = m.roleKind === "dps" || m.roleKind === "dpsHealer";
			loadoutSlots(m.lo).forEach((it) => {
				getCoverageMapForItem(it, isAnchor, isDpsAnchor).forEach((v, k) => {
					const prev = teamMap.get(k);
					if (!prev || v.score > prev.score) teamMap.set(k, v);
				});
			});
		});
		return teamMap;
	}

	function getTeamSignals(loadouts) {
		const sig = {
			teamHasDebuff: false,
			teamHasBuff: false,
			teamHasAnchorHealer: false,
		};
		loadouts.forEach((m) => {
			if (
				(m.roleKind === "healer" || m.roleKind === "dpsHealer") &&
				m.lo.anchorHealerQualified
			)
				sig.teamHasAnchorHealer = true;
			const isAnchor = isAnchorRole(m.roleKind);
			const isDpsAnchor = m.roleKind === "dps" || m.roleKind === "dpsHealer";
			loadoutSlots(m.lo).forEach((it) => {
				if (!it.capabilities) return;
				it.capabilities.forEach((cap) => {
					if (cap.custom !== null && cap.custom !== it.chosenCustom) return;
					if (!isTokenImpacting(cap, isAnchor, isDpsAnchor)) return;
					if (cap.kind === "debuff") sig.teamHasDebuff = true;
					if (cap.kind === "buff") sig.teamHasBuff = true;
				});
			});
		});
		return sig;
	}

	// A loadout "has Provoke" if any of its chosen items carries an active
	// (non-passive, non-unchosen-custom) provoke buff capability.
	function loadoutHasProvoke(lo) {
		if (!lo) return false;
		return loadoutSlots(lo).some((it) => {
			if (!it.capabilities) return false;
			return it.capabilities.some((cap) => {
				if (cap.custom !== null && cap.custom !== it.chosenCustom) return false;
				if (cap.mode === "passive") return false;
				return cap.kind === "buff" && cap.type === "provoke";
			});
		});
	}

	// Sustained Provoke comes from a regular weapon (always available); limited
	// Provoke comes from an Ultimate Weapon U.C. Ability or a Gear C. Ability.
	function loadoutHasSustainedProvoke(lo) {
		if (!lo) return false;
		return loadoutSlots(lo, true).some((it) => {
			if (!it.capabilities) return false;
			return it.capabilities.some((cap) => {
				if (cap.custom !== null && cap.custom !== it.chosenCustom) return false;
				if (cap.mode === "passive") return false;
				return cap.kind === "buff" && cap.type === "provoke";
			});
		});
	}

	function recomputeLoadoutDps(loadout, teamSignals) {
		const requireExactElementForProfile = hasElementTarget();
		// Sustained DPS uses only regular weapons; Gear/UW C. Ability potency is
		// limited-use burst and is intentionally excluded.
		const sustainedDpsSlots = loadoutSlots(loadout, true);
		return Math.max(
			...sustainedDpsSlots.map((it) =>
				getSuitingDamage(it, undefined, {
					requireExactElement: requireExactElementForProfile,
					context: teamSignals,
				}),
			),
			0,
		);
	}

	function getAnchorLoadoutDps(loadouts) {
		const anchor = loadouts.find(
			(m) => m.roleKind === "dps" || m.roleKind === "dpsHealer",
		);
		return anchor ? anchor.lo.dps || 0 : 0;
	}

	function activeCastCount(lo) {
		return loadoutSlots(lo).reduce((count, item) => {
			if (!item?.capabilities) return count;
			const hasActiveCast = item.capabilities.some((cap) => {
				if (cap.custom !== null && cap.custom !== item.chosenCustom)
					return false;
				if (cap.mode === "passive") return false;
				return cap.kind !== "set";
			});
			return count + (hasActiveCast ? 1 : 0);
		}, 0);
	}

	function availableMateriaSlots(lo) {
		return Math.max(
			0,
			TOTAL_MATERIA_SLOTS - (lo.gear ? 1 : 0) - (lo.materia || []).length,
		);
	}

	function amplifierForKind(lo, kind) {
		let best = null;
		loadoutSlots(lo)
			.filter((item) => item?.item?.type !== "materia")
			.forEach((item) => {
				(item.capabilities || []).forEach((cap) => {
					if (cap.custom !== null && cap.custom !== item.chosenCustom) return;
					if (cap.kind !== "amp" || cap.type !== kind || cap.mode === "passive")
						return;
					const maxTier = cap.maxTier || cap.tier || 0;
					if (!best || maxTier > best.maxTier) best = { item, cap, maxTier };
				});
			});
		return best;
	}

	function createAmplifiedMateria(member, desired, ampSource) {
		const tier = Math.max(
			desired.minTier || DEFAULT_TIERED_MIN_TIER,
			ampSource.maxTier || DEFAULT_TIERED_MIN_TIER,
		);
		const cap = {
			kind: desired.kind,
			type: desired.type,
			elem: desired.elem || "none",
			range: desired.kind === "buff" ? "singleAlly" : "singleEnemy",
			tier,
			custom: null,
			mode: null,
			when: null,
			source: "materia",
			label: `materia ${desired.type}`,
		};
		return {
			item: {
				id: `materia_${member.cd.character}_${desired.key}`,
				character: member.cd.character,
				type: "materia",
				name: `${effectDisplayName(desired.kind, desired.type, desired.elem)} Materia`,
			},
			damage: [],
			healing: [],
			capabilities: [cap],
			customOptions: [null],
			chosenCustom: null,
			materiaAmpSource: ampSource.item.item.name,
		};
	}

	function assignAmplifiedMateria(loadouts) {
		if (!target.includeMateria) return;

		const covered = getTeamCoverageMap(loadouts);
		const uncovered = desiredList
			.filter(
				(desired) =>
					(desired.kind === "buff" || desired.kind === "debuff") &&
					MATERIA_TIERED_TYPES.has(desired.type) &&
					!covered.has(desired.key),
			)
			.sort(
				(a, b) =>
					(a.layer || 99) - (b.layer || 99) ||
					(b.minTier || 0) - (a.minTier || 0),
			);

		for (const desired of uncovered) {
			const candidates = loadouts
				.filter(
					(member) =>
						member.roleKind !== "dps" &&
						member.roleKind !== "dpsHealer" &&
						availableMateriaSlots(member.lo) > 0,
				)
				.map((member) => ({
					member,
					amp: amplifierForKind(member.lo, desired.kind),
					casts: activeCastCount(member.lo),
					remainingSlots: availableMateriaSlots(member.lo),
				}))
				.filter((entry) => entry.amp)
				.sort(
					(a, b) =>
						a.casts - b.casts ||
						b.remainingSlots - a.remainingSlots ||
						b.amp.maxTier - a.amp.maxTier ||
						a.member.cd.character.localeCompare(b.member.cd.character),
				);

			const chosen = candidates[0];
			if (!chosen) continue;
			const materia = createAmplifiedMateria(
				chosen.member,
				desired,
				chosen.amp,
			);
			chosen.member.lo.materia.push(materia);
			getCoverageMapForItem(materia, false, false).forEach((entry, key) => {
				const prev = covered.get(key);
				if (!prev || entry.score > prev.score) covered.set(key, entry);
			});
		}
	}

	function evaluateTeam(assignments) {
		teamUsesLimitedProvoke = false;
		let trackingCoveredBases = new Map();
		const loadouts = [];
		assignments.forEach((a) => {
			const lo = buildLoadoutForMember(a.cd, trackingCoveredBases, a.roleKind);
			trackingCoveredBases = lo.updatedCoveredBases;
			loadouts.push({ cd: a.cd, role: a.role, roleKind: a.roleKind, lo });
		});
		assignAmplifiedMateria(loadouts);

		if (
			target.healerNeeded &&
			!loadouts.some(
				(m) =>
					(m.roleKind === "healer" || m.roleKind === "dpsHealer") &&
					m.lo.anchorHealerQualified,
			)
		)
			return;

		// When Provoke is selected, every recommended team must include a Provoke
		// source. Prefer a sustained (regular-weapon) source; a limited-use
		// Ultimate/Gear source is accepted only if no sustained source exists.
		if (provokeRequired) {
			const hasSustained = loadouts.some((m) =>
				loadoutHasSustainedProvoke(m.lo),
			);
			const hasAny = loadouts.some((m) => loadoutHasProvoke(m.lo));
			if (!hasAny) return;
			if (!hasSustained) {
				// No sustained source available in this team: only keep it if no
				// other generated team offers a sustained source (handled at ranking).
				teamUsesLimitedProvoke = true;
			}

			// Designate the Provoke carrier as the Tank. Prefer a sustained source
			// carrier; otherwise any carrier. If the carrier is primarily a DPS or
			// Healer, show the Tank role as a secondary role alongside their main role.
			const tankMember =
				loadouts.find((m) => loadoutHasSustainedProvoke(m.lo)) ||
				loadouts.find((m) => loadoutHasProvoke(m.lo));
			if (tankMember) {
				const primary = tankMember.role || "";
				const isPrimaryDpsOrHealer = /anchor\s+dps|healer/i.test(primary);
				tankMember.role = isPrimaryDpsOrHealer ? `${primary} · Tank` : "Tank";
				tankMember.roleKind = isPrimaryDpsOrHealer
					? tankMember.roleKind
					: "tank";
			}
		}
		const teamSignals = getTeamSignals(loadouts);
		loadouts.forEach((m) => {
			m.lo.dps = recomputeLoadoutDps(m.lo, teamSignals);
		});
		const theoretical = calculateTeamTheoreticalDamage({
			loadouts,
			teamSignals,
			desiredList,
			damageModel: target.damageModel,
			loadoutSlots,
			conditionSupported: conditionSupportedForDamageMod,
			damageFitTier: getDamageFitTier,
			effectivePot: getEffectivePot,
			hasElementTarget,
		});
		theoretical.members.forEach((entry) => {
			entry.member.lo.theoreticalHit = entry.hit;
			entry.member.lo.theoreticalDamage = entry.damage;
		});
		const teamCoverageMap = getTeamCoverageMap(loadouts);
		const satisfiedKeys = Array.from(teamCoverageMap.keys()).filter((k) =>
			wantedKeys.has(k),
		);
		const displayTokens = satisfiedKeys.map((k) =>
			desiredLabel(desiredMap.get(k)),
		);
		const healerCount = loadouts.filter(
			(m) => m.lo.anchorHealerQualified,
		).length;
		const coveragePower = satisfiedKeys.reduce(
			(sum, k) => sum + (teamCoverageMap.get(k).score || 0),
			0,
		);
		const highTierCoverageCount = satisfiedKeys.filter((k) => {
			const entry = teamCoverageMap.get(k);
			return (
				entry &&
				TIERED_TYPES.has(entry.desired.type) &&
				(entry.tier || 0) >= HIGH_TIER_THRESHOLD
			);
		}).length;

		const layerOfKey = (k) => {
			const d = desiredMap.get(k);
			return d ? d.layer || 0 : 0;
		};

		const foundationalCoverageCount = satisfiedKeys.filter((k) => {
			const layer = layerOfKey(k);
			return layer === 1 || layer === 2;
		}).length;

		const importantCoverageCount = satisfiedKeys.filter((k) => {
			const layer = layerOfKey(k);
			return layer >= 1 && layer <= 3;
		}).length;

		const pyramidCoverageScore = satisfiedKeys.reduce((sum, k) => {
			const entry = teamCoverageMap.get(k);
			const layer = layerOfKey(k);
			const layerWeight =
				{
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
		const teamAnchorHealerScore = Math.max(
			...loadouts.map((m) => m.lo.anchorHealerScore || 0),
			0,
		);
		bestTeams.push({
			loadouts,
			anchorTheoreticalDamage: theoretical.anchorDamage,
			teamTheoreticalDamage: theoretical.teamDamage,
			objectiveDamage: theoretical.objectiveDamage,
			damageIsLowerBound: theoretical.isLowerBound,
			unquantifiedDamageEffects: theoretical.unquantified,
			anchorDps: getAnchorLoadoutDps(loadouts),
			anchorHealerScore: teamAnchorHealerScore,
			usesLimitedProvoke: provokeRequired && teamUsesLimitedProvoke,
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
			coveredTokensDisplay: displayTokens.join(", "),
		});
	}

	function enumerateHealerTeams(
		healerCandidates,
		healerRoleKind,
		healerRoleLabel,
	) {
		anchors.forEach((anchor) => {
			healerCandidates.forEach((healer) => {
				if (!target.coopMode && healer.character === anchor.character) return;
				const chosen = new Set([anchor.character]);
				if (isBlocked(chosen, healer.character)) return;
				const chosen2 = new Set(chosen).add(healer.character);
				chars.forEach((flex) => {
					if (
						(!target.coopMode && chosen2.has(flex.character)) ||
						isBlocked(chosen2, flex.character)
					)
						return;
					evaluateTeam([
						{ cd: anchor, role: "Anchor DPS", roleKind: "dps" },
						{ cd: healer, role: healerRoleLabel, roleKind: healerRoleKind },
						{ cd: flex, role: "Support", roleKind: "support" },
					]);
				});
			});
		});
	}

	function enumerateCombinedDpsHealerTeams() {
		anchors.forEach((anchor) => {
			if ((anchor.topAnchorHealerScore || 0) <= 0) return;
			const chosen = new Set([anchor.character]);
			chars.forEach((char2) => {
				if (
					(!target.coopMode && chosen.has(char2.character)) ||
					isBlocked(chosen, char2.character)
				)
					return;
				const chosen2 = new Set(chosen).add(char2.character);
				chars.forEach((char3) => {
					if (
						(!target.coopMode && chosen2.has(char3.character)) ||
						isBlocked(chosen2, char3.character)
					)
						return;
					evaluateTeam([
						{ cd: anchor, role: "Anchor DPS + Healer", roleKind: "dpsHealer" },
						{ cd: char2, role: "Support", roleKind: "support" },
						{ cd: char3, role: "Support", roleKind: "support" },
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
				runtimeWarnings.push(
					"Healer required, but no held character has a qualifying regular-weapon Anchor Healer source. Anchor Healer preference order: AOE weapon heal >= threshold, All Cure materia support, single/nominal weapon heal >= threshold, then HEAL Boost materia support. Utility coverage only refines choices within the same category. UW/Gear healing can still contribute support healing, but cannot qualify the Anchor Healer role.",
				);
			} else if (strictHealers.length > 0) {
				runtimeWarnings.push(
					"Healer required and strict healer candidates exist, but no valid team survived DPS/profile/exclusivity constraints. The script also tried allowing one character to act as both Anchor DPS and Anchor Healer.",
				);
			}
		}
	} else {
		anchors.forEach((anchor) => {
			const initialChosen = new Set([anchor.character]);
			chars.forEach((char2) => {
				if (
					(!target.coopMode && initialChosen.has(char2.character)) ||
					isBlocked(initialChosen, char2.character)
				)
					return;
				const chosen2 = new Set(initialChosen).add(char2.character);
				chars.forEach((char3) => {
					if (
						(!target.coopMode && chosen2.has(char3.character)) ||
						isBlocked(chosen2, char3.character)
					)
						return;
					evaluateTeam([
						{ cd: anchor, role: "Anchor DPS", roleKind: "dps" },
						{ cd: char2, role: "Support", roleKind: "support" },
						{ cd: char3, role: "Support", roleKind: "support" },
					]);
				});
			});
		});
	}

	bestTeams.sort(
		(a, b) =>
			// When Provoke is required, strongly prefer teams with a sustained
			// (regular-weapon) Provoke source over teams relying on limited-use
			// Ultimate/Gear Provoke.
			(provokeRequired
				? (a.usesLimitedProvoke ? 1 : 0) - (b.usesLimitedProvoke ? 1 : 0)
				: 0) ||
			// Rank by the selected formula-based damage objective. Coverage then
			// distinguishes equal/lower-bound results and preserves requested utility.
			b.objectiveDamage - a.objectiveDamage ||
			b.foundationalCoverageCount - a.foundationalCoverageCount ||
			b.importantCoverageCount - a.importantCoverageCount ||
			b.pyramidCoverageScore - a.pyramidCoverageScore ||
			b.coveragePower - a.coveragePower ||
			b.coverageCount - a.coverageCount ||
			b.highTierCoverageCount - a.highTierCoverageCount ||
			// Team DPS is useful if support/healer naturally fits the target.
			b.totalDps - a.totalDps ||
			// Healer quality should break ties after role qualification, not dominate
			// the whole-team ranking.
			(target.healerNeeded ? b.anchorHealerScore - a.anchorHealerScore : 0) ||
			b.totalHeal - a.totalHeal ||
			a.healerCount - b.healerCount,
	);

	function teamSignature(team) {
		const charsSig = team.loadouts
			.map((m) => `${m.role}:${m.cd.character}`)
			.join("|");
		const equipsSig = team.loadouts
			.map((m) =>
				[
					m.lo.weapons[0],
					m.lo.weapons[1],
					m.lo.ultimate,
					m.lo.gear,
					...(m.lo.materia || []),
				]
					.filter(Boolean)
					.map(
						(it) => it.item.id + (it.chosenCustom ? `:${it.chosenCustom}` : ""),
					)
					.join("+"),
			)
			.join("|");
		return `${charsSig}||${equipsSig}`;
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
				if (!sel.has(k)) {
					hasNew = true;
					break;
				}
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
			const dominated = selected.some(
				(existing) =>
					isCoverageSubset(team, existing) &&
					(team.objectiveDamage || 0) <= (existing.objectiveDamage || 0) &&
					(team.foundationalCoverageCount || 0) <=
						(existing.foundationalCoverageCount || 0),
			);
			if (dominated) continue;

			// Keep genuinely different coverage packages, especially if they preserve
			// foundations. Avoid flooding the UI with small permutations.
			if (!hasTrueCoverageDiversity(team, selected)) continue;
			if (
				(team.foundationalCoverageCount || 0) <
				(best.foundationalCoverageCount || 0)
			)
				continue;

			selected.push(team);
			seen.add(sig);
			if (selected.length >= MAX_DISPLAY_BUILDS) break;
		}

		return selected;
	}

	bestTeams = selectNearOptimalTeams(bestTeams);

	const outputGrid = [];
	const OUT_COLS = 11;
	function pad(row) {
		while (row.length < OUT_COLS) row.push("");
		return row;
	}
	outputGrid.push(
		pad(["[ TEAM BUILDER PROFILE ]", "", "", "", "", "", "", "", "", ""]),
	);
	outputGrid.push(
		pad([
			"Target",
			`Archetype: ${target.weakArch ? archLabel(target.weakArch) : "ANY"} | Element: ${target.weakElem ? elemLabel(target.weakElem) : "NONE"} | Mode: ${target.coopMode ? "Co-op" : "Solo"} | Healer Required: ${target.healerNeeded ? "TRUE" : "FALSE"} | Materia B/D: ${target.includeMateria ? "ON" : "OFF"} | Damage objective: ${target.damageModel.objective} (${target.damageModel.window}) | ATK: ${target.damageModel.attack} | DEF: ${target.damageModel.enemyDefense} | Stance: ${Math.round(target.damageModel.stanceBonus * 100)}% | Base potency bonus: ${Math.round(target.damageModel.basePotencyBonus * 100)}%`,
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]),
	);
	outputGrid.push(
		pad([
			"Implicit Buff Targets",
			synergyDisplayList.length > 0 ? synergyDisplayList.join("  »  ") : "None",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]),
	);
	outputGrid.push(
		pad([
			"Manual Debuff Note",
			"Enemy-side debuffs are only taken from Wanted Debuffs because immunity/weakness rules vary by boss.",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]),
	);
	outputGrid.push(
		pad([
			"Build Selection",
			`Near-optimal only; max ${MAX_DISPLAY_BUILDS} builds shown. Gear/U.C. abilities are included when the rows are held=TRUE.`,
			"",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]),
	);
	schemaWarnings.forEach((w) =>
		outputGrid.push(pad(["Schema Warning", w, "", "", "", "", "", "", "", ""])),
	);
	runtimeWarnings.forEach((w) =>
		outputGrid.push(
			pad(["Runtime Warning", w, "", "", "", "", "", "", "", ""]),
		),
	);
	outputGrid.push(pad(["", "", "", "", "", "", "", "", "", ""]));
	outputGrid.push(
		pad([
			"Build",
			"Role",
			"Character",
			"Weapon 1",
			"Weapon 2",
			"Ultimate",
			"Gear",
			"Materia",
			"Potency",
			"Key Effects",
			"Coverage / Notes",
		]),
	);

	function getDisplayDamageHits(r) {
		if (!r) return [];
		const bestByShape = new Map();
		customOptionsFor(r).forEach((opt) => {
			r.damage.forEach((d) => {
				if (d.custom !== null && d.custom !== opt) return;
				const arch = d.arch || r.item.c_arch || "any";
				const elem = d.elem || r.item.c_elem || "nonelem";
				const pot = Number(d.pot || 0);
				if (pot <= 0) return;
				const key = `${arch}|${elem}`;
				const prev = bestByShape.get(key);
				if (!prev || pot > prev.pot)
					bestByShape.set(key, { arch, elem, pot, mods: d.mods || [] });
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
			dmgHits.forEach((d) => {
				const fitTier = getDamageFitTier(d, hasElementTarget());
				const contributesToTarget = fitTier > 0;
				const ctx = Object.assign({}, context || {}, {
					hitsWeakness: fitTier >= 3,
				});
				const effective = getEffectivePot(d, ctx);
				let display =
					effective !== d.pot
						? `${d.pot}%→${effective}% ${archLabel(d.arch)}/${elemLabel(d.elem)}`
						: `${d.pot}% ${archLabel(d.arch)}/${elemLabel(d.elem)}`;
				if (d.mods?.length) {
					d.mods.forEach((mod) => {
						if (mod.mult && effective === d.pot)
							display += ` [x${mod.mult} if ${modDisplayWhen(mod.when)}]`;
						if (mod.add)
							display += ` [+${mod.add} dmg${mod.when ? ` if ${modDisplayWhen(mod.when)}` : ""}]`;
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

	function isTokenImpacting(cap, isMemberAnchor, isDpsAnchor) {
		if (cap.kind === "dmg") return false;
		if (cap.kind === "heal") return true;

		// Healer-enabling materia support is role-impacting when a healer is needed.
		// It is not part of offensive/defensive desired coverage, so it must not be
		// judged solely by desiredList.
		if (target.healerNeeded && cap.kind === "set" && cap.type === "allCure")
			return true;
		if (
			target.healerNeeded &&
			(cap.type === "healingBoost" ||
				cap.type === "healBoost" ||
				cap.type === "boostHeal")
		)
			return true;

		// Impact is relative to the user's selected desired effects. This is
		// especially important for defensive elemental picks such as Lightning
		// Resist. Up on a water-weak boss: it should not be compared to weakElem.
		return desiredList.some((d) =>
			capSatisfiesDesired(cap, d, isMemberAnchor, isDpsAnchor),
		);
	}

	function capDisplay(cap) {
		if (cap.kind === "heal") return `Heal${cap.tier ? ` ${cap.tier}%` : ""}`;
		let display = effectDisplayName(
			cap.kind,
			cap.type,
			cap.elem,
			cap.status,
			cap.target,
		);
		if (cap.tier) display += ` [${tierDisplay(cap.tier)}]`;
		if (cap.value) display += ` [${cap.value}%]`;
		if (cap.range && cap.range !== "none" && cap.range !== "unknown")
			display += ` [${RANGE_LABEL[cap.range] || cap.range}]`;
		if (cap.mode === "passive") display += " [Passive]";
		if (cap.when) display += ` [${whenDisplay(cap.when)}]`;
		return display;
	}

	function getUtilList(r, isMemberAnchor, includePassive, isDpsAnchor) {
		if (!r?.capabilities) return [];
		const utils = [];
		r.capabilities.forEach((cap) => {
			if (cap.custom !== null && cap.custom !== r.chosenCustom) return;
			if (cap.kind === "dmg" || cap.kind === "heal") return;
			if (!includePassive && cap.mode === "passive") return;
			let display = capDisplay(cap);
			if (isLimitedUseActiveUtility(r, cap))
				display += ` [${limitedUseLabel(r)}]`;
			if (!isTokenImpacting(cap, isMemberAnchor, isDpsAnchor))
				display += " [Non-impacting]";
			if (!utils.includes(display)) utils.push(display);
		});
		return utils;
	}

	function getItemDisplayName(r) {
		if (!r?.item) return "";
		let name = r.item.name;
		if (r.chosenCustom)
			name +=
				" [" +
				r.chosenCustom.charAt(0).toUpperCase() +
				r.chosenCustom.slice(1) +
				"]";
		return name;
	}

	function shouldShowWeaponDamage(member, r) {
		if (!member || !r) return false;
		if (member.roleKind === "dps" || member.roleKind === "dpsHealer")
			return true;
		return hasNaturalTargetMatch(r, r.chosenCustom);
	}

	function slotSummary(
		r,
		teamSignals,
		isAnchor,
		includePassive,
		includeDamage = true,
		isDpsAnchor = false,
	) {
		if (!r) return "";
		const potency = getPotencyDetail(r, teamSignals, includeDamage);
		const util = getUtilList(r, isAnchor, includePassive, isDpsAnchor).join(
			" | ",
		);
		const bits = [getItemDisplayName(r)];
		if (potency) bits.push(potency);
		if (util && util !== "None") bits.push(util);
		return bits.join(" — ");
	}

	function getTeamHeadlineHeal(team) {
		const loadouts = team.loadouts || [];

		const anchorHealer = loadouts.find(
			(m) =>
				m.roleKind === "healer" ||
				m.role === "Anchor Healer" ||
				/anchor\s+healer/i.test(m.role || ""),
		);

		if (anchorHealer?.lo) return anchorHealer.lo.heal || 0;

		// Fallback: prefer a loadout that actually qualified as anchor healer.
		const qualified = loadouts
			.filter(
				(m) =>
					m.lo?.anchorHealerQualified || (m.lo?.anchorHealerScore || 0) > 0,
			)
			.sort(
				(a, b) =>
					(b.lo?.anchorHealerScore || 0) - (a.lo?.anchorHealerScore || 0) ||
					(b.lo?.heal || 0) - (a.lo?.heal || 0),
			);

		if (qualified.length) return qualified[0].lo?.heal || 0;
		return 0;
	}

	function teamSummaryPotency(team) {
		const parts = [];
		const lowerBound = team.damageIsLowerBound ? "≥" : "";
		parts.push(
			`${target.damageModel.objective === "team" ? "Team hit" : "Anchor hit"} ${lowerBound}${formatDamage(team.objectiveDamage)}`,
		);

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
		const reason =
			target.healerNeeded && strictHealers.length === 0
				? "No qualifying team healer was found. Team heal requires heal range=allAllies or set type=allCure in caps, and the function range must include caps (A:N)."
				: anchors.length === 0
					? "No target-compatible Anchor DPS candidates were found for the selected archetype/element."
					: "No valid three-character combination could be generated after role/exclusion constraints.";
		outputGrid.push(
			pad(["No valid builds found", reason, "", "", "", "", "", "", "", ""]),
		);
	}

	for (let k = 0; k < displayLimit; k++) {
		const team = bestTeams[k];
		const teamSignals = getTeamSignals(team.loadouts);
		const coverageText =
			team.coveredTokensDisplay || "No desired utility coverage";
		const damageNote = team.damageIsLowerBound
			? `Lower bound; unquantified: ${team.unquantifiedDamageEffects.join(", ")}`
			: `Expected range ${formatDamage(team.objectiveDamage * 0.985)}–${formatDamage(team.objectiveDamage * 1.015)}`;
		outputGrid.push(
			pad([
				`Build #${k + 1}`,
				"Team Summary",
				team.loadouts.map((m) => `${m.cd.character} (${m.role})`).join(" / "),
				"",
				"",
				"",
				"",
				teamSummaryPotency(team),
				`Coverage ${team.coverageCount}/${desiredList.length} | Foundations ${team.foundationalCoverageCount}/${desiredList.filter((d) => d.layer === 1 || d.layer === 2).length} | T3+ ${team.highTierCoverageCount}`,
				`${coverageText}${damageNote ? ` | ${damageNote}` : ""}`,
			]),
		);

		for (let m = 0; m < team.loadouts.length; m++) {
			const member = team.loadouts[m];
			const isAnchor =
				member.roleKind === "dps" ||
				member.roleKind === "healer" ||
				member.roleKind === "dpsHealer";
			const isDpsAnchor =
				member.roleKind === "dps" || member.roleKind === "dpsHealer";
			const activeEffects = [];
			const passiveEffects = [];
			[
				member.lo.weapons[0],
				member.lo.weapons[1],
				member.lo.ultimate,
				member.lo.gear,
			]
				.filter(Boolean)
				.forEach((it) => {
					activeEffects.push(...getUtilList(it, isAnchor, false, isDpsAnchor));
					passiveEffects.push(
						...getUtilList(it, isAnchor, true, isDpsAnchor).filter((x) =>
							x.includes("[Passive]"),
						),
					);
				});
			// Equipment effects render inline. Generated materia gets its own
			// column so it can be surfaced as a dedicated section per character.
			const rowEffects = "";
			const materiaText = (member.lo.materia || [])
				.map((it) => {
					const cap = it.capabilities[0];
					return `Materia: ${capDisplay(cap)} [Amplified by ${it.materiaAmpSource}]`;
				})
				.join(" | ");
			const notes = (member.lo.materia || []).length
				? "Materia B/D assigned (see Materia column)."
				: "";
			outputGrid.push(
				pad([
					"",
					member.role,
					member.cd.character,
					slotSummary(
						member.lo.weapons[0],
						teamSignals,
						isAnchor,
						true,
						shouldShowWeaponDamage(member, member.lo.weapons[0]),
						isDpsAnchor,
					),
					slotSummary(
						member.lo.weapons[1],
						teamSignals,
						isAnchor,
						true,
						shouldShowWeaponDamage(member, member.lo.weapons[1]),
						isDpsAnchor,
					),
					slotSummary(
						member.lo.ultimate,
						teamSignals,
						isAnchor,
						true,
						false,
						isDpsAnchor,
					),
					slotSummary(
						member.lo.gear,
						teamSignals,
						isAnchor,
						true,
						false,
						isDpsAnchor,
					),
					materiaText,
					`${member.lo.theoreticalDamage ? `Hit ${member.lo.theoreticalDamage.isLowerBound ? "≥" : ""}${formatDamage(member.lo.theoreticalDamage.damage)} / ` : ""}DPS ${member.lo.dps}% / Heal ${member.lo.heal}%`,
					rowEffects,
					notes,
				]),
			);
		}
		outputGrid.push(pad(["", "", "", "", "", "", "", "", "", ""]));
	}

	return outputGrid.length > 8
		? outputGrid
		: [["No valid combinations could be generated matching constraints"]];
}

export function gridToBuildJson(grid) {
	const rows = Array.isArray(grid) ? grid : [];
	const result = { profile: {}, warnings: [], builds: [], rawGrid: rows };
	const headerIdx = rows.findIndex(
		(r) => Array.isArray(r) && r[0] === "Build" && r[1] === "Role",
	);
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		if (row[0] === "Target") result.profile.target = row[1] || "";
		if (row[0] === "Implicit Buff Targets")
			result.profile.implicitBuffTargets = row[1] || "";
		if (row[0] === "Schema Warning" || row[0] === "Runtime Warning")
			result.warnings.push({ type: row[0], message: row[1] || "" });
		if (row[0] === "No valid builds found")
			result.warnings.push({ type: row[0], message: row[1] || "" });
	}
	if (headerIdx < 0) return result;

	let current = null;
	for (let i = headerIdx + 1; i < rows.length; i++) {
		const r = rows[i] || [];
		if (!r.some((x) => String(x || "").trim())) continue;
		if (String(r[0] || "").startsWith("Build #") && r[1] === "Team Summary") {
			current = {
				build: r[0],
				summary: {
					members: r[2] || "",
					potency: r[7] || "",
					score: r[8] || "",
					coverage: r[9] || "",
				},
				members: [],
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
				materia: r[7] || "",
				potency: r[8] || "",
				keyEffects: r[9] || "",
				notes: r[10] || "",
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
		options.anchorHealThreshold || 47,
		options.includeUW === undefined ? true : options.includeUW,
		options.includeGear === undefined ? true : options.includeGear,
		options.includeMateria === undefined ? false : options.includeMateria,
		options.coopMode === undefined ? false : options.coopMode,
		options.damageObjective || "anchor",
		options.attackValue ?? 1000,
		options.enemyDefense ?? 100,
		options.stanceBonus ?? 50,
		options.basePotencyBonus ?? 0,
		options.damageWindow || "sustained",
	);
	return gridToBuildJson(grid);
}
