import { normalizePresetHeader } from "../data/sheets.js";

export const QUICK_PRESETS = {
	"phys-fire": {
		label: "Physical / Fire",
		weakArch: "phys",
		weakElem: "fire",
		healerNeeded: true,
	},
	"phys-ice": {
		label: "Physical / Ice",
		weakArch: "phys",
		weakElem: "ice",
		healerNeeded: true,
	},
	"phys-lightning": {
		label: "Physical / Lightning",
		weakArch: "phys",
		weakElem: "lightning",
		healerNeeded: true,
	},
	"phys-wind": {
		label: "Physical / Wind",
		weakArch: "phys",
		weakElem: "wind",
		healerNeeded: true,
	},
	"phys-water": {
		label: "Physical / Water",
		weakArch: "phys",
		weakElem: "water",
		healerNeeded: true,
	},
	"phys-earth": {
		label: "Physical / Earth",
		weakArch: "phys",
		weakElem: "earth",
		healerNeeded: true,
	},
	"mag-fire": {
		label: "Magical / Fire",
		weakArch: "mag",
		weakElem: "fire",
		healerNeeded: true,
	},
	"mag-ice": {
		label: "Magical / Ice",
		weakArch: "mag",
		weakElem: "ice",
		healerNeeded: true,
	},
	"mag-lightning": {
		label: "Magical / Lightning",
		weakArch: "mag",
		weakElem: "lightning",
		healerNeeded: true,
	},
	"mag-wind": {
		label: "Magical / Wind",
		weakArch: "mag",
		weakElem: "wind",
		healerNeeded: true,
	},
	"mag-water": {
		label: "Magical / Water",
		weakArch: "mag",
		weakElem: "water",
		healerNeeded: true,
	},
	"mag-earth": {
		label: "Magical / Earth",
		weakArch: "mag",
		weakElem: "earth",
		healerNeeded: true,
	},
};
export function parsePresetRows(rows) {
	const header = rows[0].map(normalizePresetHeader);
	return rows
		.slice(1)
		.map((row) => {
			const get = (name) => row[header.indexOf(name)] ?? "";
			const id = String(get("id") || "").trim();
			const name = String(get("name") || id).trim();
			if (!id || !name) return null;
			return {
				key: `ext:${id}`,
				id,
				label: name,
				group: String(get("group") || "Extended presets").trim(),
				weakArch: normalizePresetArch(get("weak_arch")),
				weakElem: normalizePresetElem(get("weak_elem")),
				damageAssumption: normalizeDamageAssumption(get("damage_assumption")),
				healerNeeded: parsePresetBoolean(get("healer_needed")),
				wantBuffs: get("want_buffs"),
				wantDebuffs: get("want_debuffs"),
				defensiveBuffs: get("defensive_buffs"),
				defensiveDebuffs: get("defensive_debuffs"),
				notes: get("notes"),
			};
		})
		.filter(Boolean);
}

function normalizePresetArch(value) {
	const text = String(value || "")
		.trim()
		.toLowerCase();
	if (["phys", "physical"].includes(text)) return "phys";
	if (["mag", "magic", "magical"].includes(text)) return "mag";
	if (text === "hybrid") return "hybrid";
	return "";
}

function normalizePresetElem(value) {
	const text = String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z]/g, "");
	const aliases = {
		non: "nonelem",
		nonelemental: "nonelem",
		nonelem: "nonelem",
	};
	const elem = aliases[text] || text;
	return [
		"fire",
		"ice",
		"lightning",
		"wind",
		"water",
		"earth",
		"nonelem",
	].includes(elem)
		? elem
		: "";
}

function normalizeDamageAssumption(value) {
	const text = String(value || "").trim();
	return ["conservative", "optimistic", "baseOnly"].includes(text)
		? text
		: "conservative";
}

function parsePresetBoolean(value) {
	return /^(true|yes|y|1)$/i.test(String(value || "").trim());
}

export function normalizeToken(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}
