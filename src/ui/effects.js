export const EFFECT_KIND = Object.freeze({ BUFF: "buff", DEBUFF: "debuff" });
export const EFFECT_DOMAIN = { OFFENSE: "offense", DEFENSE: "defense" };
const ELEMENT_LABEL = {
	fire: "Fire",
	ice: "Ice",
	lightning: "Lightning",
	wind: "Wind",
	water: "Water",
	earth: "Earth",
	nonelem: "Non-elem",
};
function effectLabelForElement(type, elem) {
	const element = ELEMENT_LABEL[elem] || elem;
	const labels = {
		elemDmgUp: `${element} Potency Up`,
		elemDmgBonus: `${element} Damage Bonus`,
		elemWeaponBoost: `${element} Weapon Boost`,
		elemResistDown: `${element} Resist. Down`,
		elemDmgRcvdUp: `${element} Dmg. Rcvd. Up`,
		elemResistUp: `${element} Resist. Up`,
		elemDmgDown: `${element} Potency Down`,
	};
	return labels[type];
}

function makeEffect({
	id,
	kind,
	domain,
	group,
	label,
	token,
	defaultOn = false,
	layer = null,
}) {
	return { id, kind, domain, group, label, token, defaultOn, layer };
}

export function buildEffectDefs(weakArch, weakElem) {
	const defs = [];
	const realElem = weakElem && weakElem !== "nonelem" ? weakElem : "";
	const archs =
		weakArch === "hybrid" ? ["phys", "mag"] : weakArch ? [weakArch] : [];

	for (const arch of archs) {
		defs.push(
			makeEffect({
				id: `off-buff-${arch}-atk`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 1 · Base buffs",
				label: arch === "phys" ? "PATK Up" : "MATK Up",
				token: arch === "phys" ? "patkUp" : "matkUp",
				defaultOn: true,
				layer: 1,
			}),
		);
		if (arch === "phys") {
			defs.push(
				makeEffect({
					id: "off-buff-patk-boost",
					kind: EFFECT_KIND.BUFF,
					domain: EFFECT_DOMAIN.OFFENSE,
					group: "Layer 1 · Base buffs",
					label: "PATK Boost",
					token: "patkBoost",
					defaultOn: false,
					layer: 1,
				}),
			);
		}
		defs.push(
			makeEffect({
				id: `off-debuff-${arch}-def`,
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 1 · Base debuffs",
				label: arch === "phys" ? "PDEF Down" : "MDEF Down",
				token: arch === "phys" ? "pdefDown" : "mdefDown",
				defaultOn: true,
				layer: 1,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-debuff-${arch}-rcvd`,
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 3 · Damage received",
				label:
					arch === "phys"
						? "Single-Tgt. Phys. Dmg. Rcvd. Up"
						: "Single-Tgt. Mag. Dmg. Rcvd. Up",
				token:
					arch === "phys" ? "singleTgtPhysDmgRcvdUp" : "singleTgtMagDmgRcvdUp",
				defaultOn: false,
				layer: 3,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-buff-${arch}-bonus`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 4 · Damage bonus",
				label: arch === "phys" ? "Physical Damage Bonus" : "Magic Damage Bonus",
				token: arch === "phys" ? "physDmgBonus" : "magDmgBonus",
				defaultOn: true,
				layer: 4,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-buff-${arch}-weapon`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 5 · Weapon boost",
				label: arch === "phys" ? "Physical Weapon Boost" : "Magic Weapon Boost",
				token: arch === "phys" ? "physWeaponBoost" : "magWeaponBoost",
				defaultOn: true,
				layer: 5,
			}),
		);
	}

	if (realElem) {
		defs.push(
			makeEffect({
				id: `off-buff-${realElem}-pot`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 1 · Base buffs",
				label: effectLabelForElement("elemDmgUp", realElem),
				token: `elemDmgUp:${realElem}`,
				defaultOn: true,
				layer: 1,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-debuff-${realElem}-res-down`,
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 1 · Base debuffs",
				label: effectLabelForElement("elemResistDown", realElem),
				token: `elemResistDown:${realElem}`,
				defaultOn: true,
				layer: 1,
			}),
		);
		defs.push(
			makeEffect({
				id: "off-buff-exploit-weakness",
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 3 · Weakness exploit",
				label: "Exploit Weakness",
				token: "exploitWeakness",
				defaultOn: true,
				layer: 3,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-debuff-${realElem}-rcvd`,
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 3 · Damage received",
				label: effectLabelForElement("elemDmgRcvdUp", realElem),
				token: `elemDmgRcvdUp:${realElem}`,
				defaultOn: false,
				layer: 3,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-buff-${realElem}-bonus`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 4 · Damage bonus",
				label: effectLabelForElement("elemDmgBonus", realElem),
				token: `elemDmgBonus:${realElem}`,
				defaultOn: true,
				layer: 4,
			}),
		);
		defs.push(
			makeEffect({
				id: `off-buff-${realElem}-weapon`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 5 · Weapon boost",
				label: effectLabelForElement("elemWeaponBoost", realElem),
				token: `elemWeaponBoost:${realElem}`,
				defaultOn: true,
				layer: 5,
			}),
		);
	}

	if (weakArch || weakElem) {
		defs.push(
			makeEffect({
				id: "off-buff-enliven",
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 2 · Amplify",
				label: "Enliven",
				token: "enliven",
				defaultOn: true,
				layer: 2,
			}),
		);
		defs.push(
			makeEffect({
				id: "off-buff-amp-buffs",
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 2 · Amplify",
				label: "Amp. Buffs",
				token: "amp target=buff",
				defaultOn: true,
				layer: 2,
			}),
		);
		defs.push(
			makeEffect({
				id: "off-debuff-enfeeble",
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 2 · Amplify",
				label: "Enfeeble",
				token: "enfeeble",
				defaultOn: false,
				layer: 2,
			}),
		);
		if (archs.length || realElem)
			defs.push(
				makeEffect({
					id: "off-debuff-amp-debuffs",
					kind: EFFECT_KIND.DEBUFF,
					domain: EFFECT_DOMAIN.OFFENSE,
					group: "Layer 2 · Amplify",
					label: "Amp. Debuffs",
					token: "amp target=debuff",
					defaultOn: true,
					layer: 2,
				}),
			);
		defs.push(
			makeEffect({
				id: "off-debuff-torpor",
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Apex",
				label: "Torpor",
				token: "torpor",
				defaultOn: false,
				layer: 6,
			}),
		);
	}

	const elements = ["fire", "ice", "lightning", "wind", "water", "earth"];
	defs.push(
		makeEffect({
			id: "def-buff-provoke",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Defense",
			label: "Provoke",
			token: "provoke",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-buff-pdef-up",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Defense",
			label: "PDEF Up",
			token: "pdefUp",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-buff-mdef-up",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Defense",
			label: "MDEF Up",
			token: "mdefUp",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-buff-barrier",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Sustain",
			label: "Barrier",
			token: "barrier",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-buff-regen",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Sustain",
			label: "Regen",
			token: "regen",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-buff-veil",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Sustain",
			label: "Veil",
			token: "veil",
			defaultOn: false,
		}),
	);
	for (const elem of elements) {
		defs.push(
			makeEffect({
				id: `def-buff-${elem}-res-up`,
				kind: EFFECT_KIND.BUFF,
				domain: EFFECT_DOMAIN.DEFENSE,
				group: "Defensive buffs · Element resist",
				label: effectLabelForElement("elemResistUp", elem),
				token: `elemResistUp:${elem}`,
				defaultOn: false,
			}),
		);
		defs.push(
			makeEffect({
				id: `def-debuff-${elem}-pot-down`,
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.DEFENSE,
				group: "Defensive debuffs · Enemy offense",
				label: effectLabelForElement("elemDmgDown", elem),
				token: `elemDmgDown:${elem}`,
				defaultOn: false,
			}),
		);
	}
	defs.push(
		makeEffect({
			id: "def-debuff-patk-down",
			kind: EFFECT_KIND.DEBUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive debuffs · Enemy offense",
			label: "PATK Down",
			token: "patkDown",
			defaultOn: false,
		}),
	);
	defs.push(
		makeEffect({
			id: "def-debuff-matk-down",
			kind: EFFECT_KIND.DEBUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive debuffs · Enemy offense",
			label: "MATK Down",
			token: "matkDown",
			defaultOn: false,
		}),
	);
	return defs;
}
