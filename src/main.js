const EQUIPMENTS_SHEET_NAME = "Equipments";
const PRESETS_SHEET_NAME = "Presets";
const CONTROL_IDS = [
	"sheetUrl",
	"preset",
	"weakArch",
	"weakElem",
	"damageAssumption",
	"themeMode",
];

function countEquipmentTypes(rows) {
	const counts = { weapon: 0, ultimate: 0, gear: 0 };
	const header = (rows[0] || []).map((x) => String(x || "").trim());
	const typeIdx = header.indexOf("type");
	if (typeIdx < 0) return counts;
	for (const row of rows.slice(1)) {
		const type = String(row[typeIdx] || "")
			.trim()
			.toLowerCase();
		if (type === "ultimate") counts.ultimate += 1;
		else if (type === "gear") counts.gear += 1;
		else counts.weapon += 1;
	}
	return counts;
}

function setSourceMeta(source) {
	const node = $("sourceMeta");
	if (!node) return;
	if (!source) {
		node.innerHTML = metaPill("Bundled data");
		return;
	}

	const mode = String(source.mode || "").trim();
	const modeLabel = /bundled/i.test(mode)
		? "Bundled data"
		: /google|sheet|remote/i.test(mode)
			? "Google Sheet"
			: mode || "Bundled data";

	const counts = source.typeCounts || { weapon: 0, ultimate: 0, gear: 0 };
	const total = counts.weapon + counts.ultimate + counts.gear;
	const pills = [metaPill(modeLabel)];
	if (total > 0) {
		pills.push(metaPill(`${total} rows`, "meta-pill-neutral"));
		pills.push(metaPill(`${counts.weapon} weapons`, "meta-pill-weapon"));
		pills.push(metaPill(`${counts.ultimate} ultimate`, "meta-pill-ultimate"));
		pills.push(metaPill(`${counts.gear} gear`, "meta-pill-gear"));
	}
	const presetCount = Number(source.presetCount || 0);
	pills.push(
		metaPill(
			presetCount > 0 ? `${presetCount} presets` : "no presets",
			"meta-pill-neutral",
		),
	);
	node.innerHTML = pills.join("");
}

function metaPill(text, variant = "") {
	return `<span class="meta-pill ${variant}">${escapeHtml(text)}</span>`;
}

function buildStatusMessage(count) {
	const n = Number(count) || 0;
	if (n === 0)
		return "No matching teams found. Try loosening a target or changing the enemy profile.";
	if (n === 1) return "1 recommended team is ready.";
	return `${n} recommended teams are ready.`;
}

function _friendlyFailureMessage(error) {
	const detail = error?.message ? String(error.message) : "";
	if (/fetch|network|failed to load|cors/i.test(detail)) {
		return "Could not load the equipment data. Check the sheet link or your connection.";
	}
	if (/header|column|tsv|csv|parse|validation/i.test(detail)) {
		return "The equipment data could not be read. Check the sheet columns and pasted values.";
	}
	return "Could not make recommendations. Check the selected targets or source data.";
}

import { recommendTeamsJson } from "./core/recommendation.js";
import {
	fetchSamplePresetsTsv,
	fetchSampleTsv,
	fetchSheetCsv,
	normalizePresetHeader,
	parseDelimited,
	validateEquipmentGrid,
	validatePresetGrid,
} from "./data/sheets.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "ff7ec-team-builder-state-v3";
const EFFECT_KIND = { BUFF: "buff", DEBUFF: "debuff" };
const EFFECT_DOMAIN = { OFFENSE: "offense", DEFENSE: "defense" };
const ELEMENT_LABEL = {
	fire: "Fire",
	ice: "Ice",
	lightning: "Lightning",
	wind: "Wind",
	water: "Water",
	earth: "Earth",
	nonelem: "Non-elem",
};
const _ARCH_LABEL = { phys: "Physical", mag: "Magical", hybrid: "Hybrid" };

const QUICK_PRESETS = {
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

const state = {
	sheetUrl: "",
	sheetName: EQUIPMENTS_SHEET_NAME,
	preset: "custom",
	weakArch: "",
	weakElem: "",
	damageAssumption: "conservative",
	healerNeeded: false,
	selectedEffects: {},
	themeMode: "system",
};

let equipmentRows = null;
let loadedSourceKey = "";
let extendedPresets = [];
let loadedPresetSourceKey = "";
let presetWarnings = [];
let lastResult = null;
let renderRequestId = 0;
let pendingTimer = null;
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

function effectiveTheme() {
	if (state.themeMode === "dark" || state.themeMode === "light")
		return state.themeMode;
	return systemThemeQuery?.matches ? "dark" : "light";
}

function applyTheme() {
	document.documentElement.classList.toggle(
		"dark",
		effectiveTheme() === "dark",
	);
}

function loadSavedState() {
	try {
		Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
	} catch (_) {}
	renderPresetOptions();
	for (const id of CONTROL_IDS) {
		if ($(id) && state[id] !== undefined) $(id).value = state[id];
	}
	$("healerNeeded").checked = Boolean(state.healerNeeded);
	applyTheme();
}

function persistState() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readControlsIntoState() {
	for (const id of CONTROL_IDS) {
		state[id] = $(id).value;
	}
	state.healerNeeded = $("healerNeeded").checked;
}

function writeStateToControls() {
	for (const id of CONTROL_IDS) {
		if ($(id)) $(id).value = state[id] || (id === "themeMode" ? "system" : "");
	}
	$("healerNeeded").checked = Boolean(state.healerNeeded);
	applyTheme();
}

function sourceKey() {
	const url = state.sheetUrl.trim();
	if (!url) return "bundled-default";
	return `sheet:${url}::${state.sheetName.trim() || EQUIPMENTS_SHEET_NAME}`;
}

function presetSourceKey() {
	const url = state.sheetUrl.trim();
	return url ? `sheet:${url}::Presets` : "bundled-presets";
}

function scheduleRecalculate({ reloadData = false } = {}) {
	if (reloadData) {
		loadedSourceKey = "";
		loadedPresetSourceKey = "";
	}
	clearTimeout(pendingTimer);
	pendingTimer = setTimeout(() => recompute(), 180);
}

function setStatus(text, tone = "neutral") {
	const toneClass =
		tone === "error"
			? "text-rose-600 dark:text-rose-400"
			: tone === "ok"
				? "text-emerald-600 dark:text-emerald-400"
				: "text-slate-500 dark:text-slate-300";
	$("status").className = `text-sm font-bold ${toneClass}`;
	$("status").textContent = text;
}

function currentEffectDefs() {
	return buildEffectDefs(state.weakArch, state.weakElem);
}

function ensureEffectSelectionDefaults() {
	const defs = currentEffectDefs();
	const next = { ...state.selectedEffects };
	for (const effect of defs) {
		if (!(effect.id in next)) next[effect.id] = Boolean(effect.defaultOn);
	}
	state.selectedEffects = next;
}

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

function buildEffectDefs(weakArch, weakElem) {
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
				label: arch === "phys" ? "Phys. Dmg. Rcvd. Up" : "Mag. Dmg. Rcvd. Up",
				token: arch === "phys" ? "physDmgRcvdUp" : "magDmgRcvdUp",
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
				id: "off-debuff-dmg-rcvd",
				kind: EFFECT_KIND.DEBUFF,
				domain: EFFECT_DOMAIN.OFFENSE,
				group: "Layer 3 · Damage received",
				label: "Dmg. Rcvd. Up",
				token: "dmgRcvdUp",
				defaultOn: false,
				layer: 3,
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
			id: "def-buff-def-up",
			kind: EFFECT_KIND.BUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive buffs · Defense",
			label: "DEF Up",
			token: "defUp",
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
	defs.push(
		makeEffect({
			id: "def-debuff-atk-down",
			kind: EFFECT_KIND.DEBUFF,
			domain: EFFECT_DOMAIN.DEFENSE,
			group: "Defensive debuffs · Enemy offense",
			label: "ATK Down",
			token: "atkDown",
			defaultOn: false,
		}),
	);

	return defs;
}

function selectedEffectTokens(kind) {
	return currentEffectDefs()
		.filter(
			(effect) => effect.kind === kind && state.selectedEffects[effect.id],
		)
		.map((effect) => effect.token);
}

function effectOptionsForRecommendation() {
	return {
		weakArch: state.weakArch,
		weakElem: state.weakElem,
		wantBuffs: selectedEffectTokens(EFFECT_KIND.BUFF).join(", "),
		wantDebuffs: selectedEffectTokens(EFFECT_KIND.DEBUFF).join(", "),
		healerNeeded: state.healerNeeded,
		damageAssumption: state.damageAssumption,
	};
}

function renderEffectPanels(result = null) {
	ensureEffectSelectionDefaults();
	const defs = currentEffectDefs();
	const covered = new Set(coveredEffectIds(result));
	$("offensiveEffects").innerHTML = renderEffectDomain(
		defs,
		EFFECT_DOMAIN.OFFENSE,
		covered,
	);
	$("defensiveEffects").innerHTML = renderEffectDomain(
		defs,
		EFFECT_DOMAIN.DEFENSE,
		covered,
	);
}

function renderEffectDomain(defs, domain, covered) {
	const domainDefs = defs.filter((effect) => effect.domain === domain);
	if (!domainDefs.length)
		return '<p class="text-sm text-slate-500">Choose an archetype or element to infer applicable effects.</p>';
	const groups = groupBy(domainDefs, (effect) => effect.group);
	return Object.entries(groups)
		.map(
			([group, effects]) => `
    <div>
      <div class="mb-2 flex items-center justify-between gap-3">
        <h3 class="text-xs font-black uppercase tracking-[0.16em] text-slate-500">${escapeHtml(group)}</h3>
        <span class="text-xs font-bold text-slate-400">${effects.filter((e) => state.selectedEffects[e.id]).length}/${effects.length} selected</span>
      </div>
      <div class="flex flex-wrap gap-2">
        ${effects.map((effect) => renderToggleChip(effect, covered.has(effect.id))).join("")}
      </div>
    </div>
  `,
		)
		.join("");
}

function renderToggleChip(effect, isCovered) {
	const selected = Boolean(state.selectedEffects[effect.id]);
	const base = effect.kind === EFFECT_KIND.BUFF ? "chip-buff" : "chip-debuff";
	const active =
		effect.kind === EFFECT_KIND.BUFF
			? "chip-buff-active"
			: "chip-debuff-active";
	// Provoke is a special defensive buff: give it a distinguished ring/colour so
	// it stands out from the regular buff/debuff toggles.
	const isProvoke = effect.token === "provoke";
	const special = isProvoke ? "chip-special" : "";
	const specialActive = isProvoke ? "chip-special-active" : "";
	return `
    <button type="button" class="chip-button ${isProvoke ? (selected ? specialActive : special) : selected ? active : base}" data-effect-toggle="${escapeHtml(effect.id)}" aria-pressed="${selected}">
      <span class="toggle-box" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span>${escapeHtml(effect.label)}</span>
      ${isCovered ? '<span class="sr-only">covered</span>' : ""}
    </button>
  `;
}

function coveredEffectIds(result) {
	const labels = new Set();
	for (const build of result?.builds || []) {
		parseCsvList(build.summary?.coverage).forEach((label) =>
			labels.add(normalizeEffectLabel(label)),
		);
	}
	return currentEffectDefs()
		.filter((effect) => labels.has(normalizeEffectLabel(effect.label)))
		.map((effect) => effect.id);
}

async function loadRowsIfNeeded() {
	const key = sourceKey();
	if (equipmentRows && loadedSourceKey === key) return equipmentRows;
	const usingSheet = Boolean(state.sheetUrl.trim());
	setStatus(usingSheet ? "Loading sheet..." : "Loading bundled data...");
	const raw = usingSheet
		? await fetchSheetCsv(state.sheetUrl, EQUIPMENTS_SHEET_NAME)
		: await fetchSampleTsv();
	equipmentRows = parseDelimited(raw);
	loadedSourceKey = key;
	return equipmentRows;
}

async function loadExtendedPresetsIfNeeded() {
	const key = presetSourceKey();
	if (loadedPresetSourceKey === key) return extendedPresets;
	presetWarnings = [];
	let raw = "";
	let mode = "bundled Presets";
	if (state.sheetUrl.trim()) {
		try {
			raw = await fetchSheetCsv(state.sheetUrl, PRESETS_SHEET_NAME);
			mode = "Google Sheet Presets";
		} catch (_) {
			raw = await fetchSamplePresetsTsv();
		}
	} else {
		raw = await fetchSamplePresetsTsv();
	}
	const rows = parseDelimited(raw);
	const validation = validatePresetGrid(rows);
	extendedPresets = validation.ok ? parsePresetRows(rows) : [];
	if (!validation.ok)
		presetWarnings = validation.warnings.map((w) => `${mode}: ${w}`);
	loadedPresetSourceKey = key;
	renderPresetOptions();
	return extendedPresets;
}

async function recompute() {
	const requestId = ++renderRequestId;
	readControlsIntoState();
	ensureEffectSelectionDefaults();
	persistState();
	applyTheme();
	renderEffectPanels(lastResult);

	try {
		const rows = await loadRowsIfNeeded();
		await loadExtendedPresetsIfNeeded();
		if (requestId !== renderRequestId) return;
		if (!rows) {
			lastResult = null;
			renderDiagnostics([], {});
			renderEmpty("Loading bundled data...");
			updateCopyButton();
			setStatus("Loading bundled data.");
			return;
		}

		const validation = validateEquipmentGrid(rows);
		if (!validation.ok) {
			const payload = { validation, rowCount: rows.length };
			lastResult = payload;
			renderDiagnostics([...validation.warnings, ...presetWarnings], {
				equipmentCount: Math.max(0, rows.length - 1),
				presetCount: extendedPresets.length,
				mode: state.sheetUrl.trim() ? "google sheet" : "bundled default",
				validation,
			});
			renderEmpty(
				"Schema validation failed. Fix the sheet columns and the app will recalculate.",
			);
			updateCopyButton();
			setStatus("Schema validation failed.", "error");
			return;
		}

		const result = recommendTeamsJson(rows, effectOptionsForRecommendation());
		result.source = {
			mode: state.sheetUrl.trim() ? "google sheet" : "bundled default",
			sheetName: EQUIPMENTS_SHEET_NAME,
			rowCount: rows.length,
			equipmentCount: Math.max(0, rows.length - 1),
			typeCounts: countEquipmentTypes(rows),
			validation,
			presetCount: extendedPresets.length,
			presetWarnings,
		};
		result.selectedEffects = currentEffectDefs().filter(
			(effect) => state.selectedEffects[effect.id],
		);
		lastResult = result;
		renderEffectPanels(result);
		renderResult(result);
		setSourceMeta(result.source);
		updateCopyButton();
		setStatus(buildStatusMessage(result.builds.length), "ok");
	} catch (error) {
		if (requestId !== renderRequestId) return;
		const payload = { error: error.message, stack: error.stack };
		lastResult = payload;
		renderDiagnostics([error.message], payload);
		renderEmpty("Unable to load or recommend from this data source.");
		updateCopyButton();
		setStatus("Failed.", "error");
	}
}

function renderDiagnostics(warnings = [], source = {}) {
	const allWarnings = [...warnings, ...presetWarnings];
	if (source?.validation?.warnings)
		allWarnings.push(...source.validation.warnings);
	if (source?.presetWarnings) allWarnings.push(...source.presetWarnings);
	const unique = Array.from(new Set(allWarnings.filter(Boolean)));
	const node = $("sourceWarnings");
	if (!node) return;
	if (!unique.length) {
		node.className = "mt-2 hidden flex-wrap gap-2";
		node.innerHTML = "";
		return;
	}
	node.className = "mt-2 flex flex-wrap gap-2";
	node.innerHTML = unique
		.map(
			(w) =>
				`<span class="meta-pill meta-pill-warning">${escapeHtml(w)}</span>`,
		)
		.join("");
}

function renderResult(result) {
	renderDiagnostics(
		result.warnings?.map((w) => `${w.type}: ${w.message}`) || [],
		result.source,
	);
	if (!result.builds?.length) {
		renderEmpty(
			result.warnings?.[0]?.message || "No builds returned for this profile.",
		);
		return;
	}

	$("results").className = "grid gap-5";
	$("results").innerHTML = `
    <section class="grid gap-5">
      ${result.builds.map(renderBuildCard).join("")}
    </section>
  `;
	bindEffectHover();
}

function renderEmpty(message) {
	$("results").className =
		"rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400";
	$("results").innerHTML = escapeHtml(message);
}

function renderBuildCard(build, index) {
	const summary = build.summary || {};
	const coverageStats = getBuildCoverageStats(build);
	const buildNo = buildNumberLabel(build.build, index);
	const stats = [
		compactTeamPotency(summary.potency || ""),
		coverageStats.total
			? `Coverage ${coverageStats.covered}/${coverageStats.total} · Foundations ${coverageStats.foundationalCovered}/${coverageStats.foundationalTotal}`
			: "",
	].filter(Boolean);

	return `
    <article class="build-card">
      <div class="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-700 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            ${pill(buildNo, "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900")}
            ${renderCompactTeam(build)}
          </div>
        </div>
        <div class="flex flex-wrap gap-2 xl:justify-end">
          ${stats.map((stat) => pill(stat, stat.startsWith("Coverage") ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200")).join("")}
        </div>
      </div>
      ${renderBuildCoverage(build)}
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        ${(build.members || []).map(renderMemberCard).join("")}
      </div>
    </article>
  `;
}

function buildNumberLabel(value, index) {
	const text = String(value || "");
	const match = text.match(/#?\s*(\d+)/);
	return `#${match ? match[1] : index + 1}`;
}

function renderCompactTeam(build) {
	const members = build.members || [];
	if (members.length) {
		return members
			.map(
				(member) => `
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <span class="truncate text-lg font-black tracking-tight text-slate-950 dark:text-slate-50">${escapeHtml(member.character || "Unknown")}</span>
        ${rolePill(member.role || "")}
      </span>
    `,
			)
			.join('<span class="text-slate-300 dark:text-slate-600">/</span>');
	}

	return escapeHtml(build.summary?.members || "Team");
}

function roleShort(role) {
	const text = String(role || "").toLowerCase();
	if (text.includes("dps")) return "DPS";
	if (text.includes("healer")) return "Healer";
	if (text.includes("support")) return "Support";
	if (text.includes("tank")) return "Tank";
	return role || "";
}

// Render a role label that may carry a secondary "· Tank" suffix, e.g.
// "Anchor DPS · Tank" -> "DPS · Tank". The Tank portion is highlighted.
function rolePill(role) {
	const text = String(role || "").trim();
	if (!text) return "";
	const parts = text.split("·").map((p) => p.trim());
	const pills = parts.map((part) => {
		const short = roleShort(part);
		const isTank = /tank/i.test(part);
		const cls = isTank
			? "inline-flex shrink-0 rounded-md bg-amber-100 px-2 py-1 text-xs font-black uppercase tracking-[0.10em] text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
			: "inline-flex shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-black uppercase tracking-[0.10em] text-slate-600 dark:bg-slate-800 dark:text-slate-200";
		return `<span class="${cls}">${escapeHtml(short)}</span>`;
	});
	return pills.join(
		'<span class="text-slate-300 dark:text-slate-600">·</span>',
	);
}

function compactTeamPotency(value) {
	const parts = String(value || "")
		.split("/")
		.map((x) => x.trim())
		.filter(Boolean);
	return parts
		.filter((part) => !/\b(?:Anchor|Team DPS|DPS|Heal)\s+0%/i.test(part))
		.join(" / ");
}

function getBuildCoverageStats(build) {
	const selected = currentEffectDefs().filter(
		(effect) => state.selectedEffects[effect.id],
	);
	const coveredLabels = new Set(
		parseCsvList(build.summary?.coverage).map(normalizeEffectLabel),
	);
	const foundational = selected.filter(
		(effect) => effect.layer === 1 || effect.layer === 2,
	);
	return {
		selected,
		coveredLabels,
		total: selected.length,
		covered: selected.filter((effect) =>
			coveredLabels.has(normalizeEffectLabel(effect.label)),
		).length,
		foundationalTotal: foundational.length,
		foundationalCovered: foundational.filter((effect) =>
			coveredLabels.has(normalizeEffectLabel(effect.label)),
		).length,
	};
}

function renderBuildCoverage(build) {
	const stats = getBuildCoverageStats(build);
	const selected = stats.selected;
	if (!selected.length) return "";

	const offense = selected.filter(
		(effect) => effect.domain === EFFECT_DOMAIN.OFFENSE,
	);
	const defense = selected.filter(
		(effect) => effect.domain === EFFECT_DOMAIN.DEFENSE,
	);

	const sections = [
		renderBuildCoverageGroup("Offense", offense, stats.coveredLabels),
		renderBuildCoverageGroup("Defense", defense, stats.coveredLabels),
	]
		.filter(Boolean)
		.join("");

	if (!sections) return "";

	return `
    <section class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">Build coverage</h3>
        <span class="rounded-md bg-white px-2.5 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200">${stats.covered}/${stats.total} covered · foundations ${stats.foundationalCovered}/${stats.foundationalTotal}</span>
      </div>
      <div class="grid gap-2">
        ${sections}
      </div>
    </section>
  `;
}

function renderBuildCoverageGroup(title, effects, coveredLabels) {
	if (!effects.length) return "";
	const coveredCount = effects.filter((effect) =>
		coveredLabels.has(normalizeEffectLabel(effect.label)),
	).length;
	return `
    <div class="flex flex-wrap items-center gap-2">
      <span class="min-w-16 text-xs font-black text-slate-500 dark:text-slate-300">${title} ${coveredCount}/${effects.length}</span>
      ${effects
				.map((effect) => {
					const covered = coveredLabels.has(normalizeEffectLabel(effect.label));
					const kindClass =
						effect.kind === EFFECT_KIND.BUFF
							? "effect-chip-buff"
							: "effect-chip-debuff";
					const special =
						effect.token === "provoke" ? "effect-chip-special" : "";
					return `<span class="effect-chip ${kindClass} ${special} ${covered ? "" : "effect-chip-missing"}" data-effect-hover="${escapeHtml(normalizeEffectLabel(effect.label))}" data-effect-hover-source="coverage" title="Hover to highlight matching equipment"><span class="toggle-box" aria-hidden="true">${covered ? "✓" : ""}</span>${escapeHtml(effect.label)}</span>`;
				})
				.join("")}
    </div>
  `;
}

function renderMemberCard(member) {
	const memberKey = normalizeEffectLabel(
		`${member.keyEffects || ""} ${member.weapon1 || ""} ${member.weapon2 || ""} ${member.ultimate || ""} ${member.gear || ""}`,
	);
	const headline = compactMemberPotency(member.potency || "");

	return `
    <section class="member-card" data-effect-index="${escapeHtml(memberKey)}">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-lg font-black text-slate-950 dark:text-slate-50">${escapeHtml(member.character || "Unknown")}</h3>
        ${rolePill(member.role || "")}
        ${headline ? pill(headline, "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200") : ""}
      </div>
      <div class="mt-3 grid gap-2">
        ${renderSlot("Main", member.weapon1)}
        ${renderSlot("Off", member.weapon2)}
        ${renderSlot("Ult", member.ultimate)}
        ${renderSlot("Gear", member.gear)}
      </div>
      ${
				member.keyEffects
					? `<div class="mt-3">
        <h4 class="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">Key effects</h4>
        <div class="flex flex-wrap gap-1.5">${effectChipsFromCsv(member.keyEffects)}</div>
      </div>`
					: ""
			}
      ${member.notes ? `<div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><strong class="text-slate-800 dark:text-slate-50">Passive notes:</strong> ${escapeHtml(member.notes)}</div>` : ""}
    </section>
  `;
}

function compactMemberPotency(value) {
	const parts = String(value || "")
		.split("/")
		.map((x) => x.trim())
		.filter(Boolean);
	return parts.filter((part) => !/\b(?:DPS|Heal)\s+0%/i.test(part)).join(" / ");
}

function slotLabelPill(label) {
	return `<span class="inline-flex shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-black uppercase tracking-[0.10em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">${escapeHtml(label)}</span>`;
}

function renderSlot(label, text) {
	const key = normalizeEffectLabel(text || "");
	if (!text) {
		return `
      <div class="equipment-card" data-effect-index="">
        <div class="flex flex-wrap items-center gap-2">
          ${slotLabelPill(label)}
          <span class="text-sm font-bold text-slate-400">None selected</span>
        </div>
      </div>
    `;
	}

	const [name, ...details] = String(text).split(" — ");
	const chips = splitSlotDetails(details);
	const activeHtml = chips.active.length
		? `<div class="mt-2 flex flex-wrap gap-1.5">${renderSlotDetailChips(chips.active, false)}</div>`
		: "";
	const inactiveHtml = chips.inactive.length
		? `
    <details class="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/60">
      <summary class="cursor-pointer text-xs font-black text-slate-500 dark:text-slate-300">${chips.inactive.length} inactive / off-profile effect${chips.inactive.length === 1 ? "" : "s"}</summary>
      <div class="mt-2 flex flex-wrap gap-1.5">${renderSlotDetailChips(chips.inactive, true)}</div>
    </details>
  `
		: "";

	return `
    <div class="equipment-card" data-effect-index="${escapeHtml(key)}">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        ${slotLabelPill(label)}
        <strong class="min-w-0 truncate text-sm text-slate-950 dark:text-slate-50">${escapeHtml(name)}</strong>
      </div>
      ${activeHtml}
      ${inactiveHtml}
    </div>
  `;
}

function splitSlotDetails(details) {
	const rawParts = details
		.flatMap((detail) => String(detail || "").split(" | "))
		.map((x) => x.trim())
		.filter(Boolean);

	const mergedParts = mergeAllCureHealParts(rawParts);
	const active = [];
	const inactive = [];

	mergedParts.forEach((part) => {
		if (/\[Non-impacting\]/i.test(part)) {
			inactive.push(part.replace(/\s*\[Non-impacting\]/gi, "").trim());
		} else {
			active.push(part);
		}
	});

	return { active, inactive };
}

function isAllCurePart(part) {
	return (
		/\ball\s+cure\b/i.test(part) ||
		/\ball\s*\(\s*cure\s+spells?\s*\)/i.test(part) ||
		/\bcura\s+all\b/i.test(part) ||
		/\ball\s+cura\b/i.test(part) ||
		/\bcure\s+materia\s+support\b/i.test(part)
	);
}

function mergeAllCureHealParts(parts) {
	const healIdx = parts.findIndex((part) => /^Heal\s+\d+%/i.test(part));
	const allCureIdx = parts.findIndex(isAllCurePart);

	if (healIdx === -1 || allCureIdx === -1) return parts;

	const healPart = parts[healIdx].replace(/\s*\[Non-impacting\]/gi, "").trim();
	const allCurePart = parts[allCureIdx];

	// Only merge the inferred all-cure heal presentation. Preserve normal weapon
	// heals + unrelated support labels as-is.
	const isLikelyInferredAllCureHeal =
		/^Heal\s+60%/i.test(healPart) ||
		/\binferred\b/i.test(allCurePart) ||
		/\ball\s+cure\b/i.test(allCurePart) ||
		/\bcura\s+all\b/i.test(allCurePart);

	if (!isLikelyInferredAllCureHeal) return parts;

	const merged = `${healPart} [All Cure]`;
	return parts
		.map((part, idx) => (idx === healIdx ? merged : part))
		.filter((_, idx) => idx !== allCureIdx);
}

function effectKindClassFromText(text) {
	const normalized = normalizeEffectLabel(text || "");

	// Debuff first. Important: "Amp. Debuffs" contains the substring "buff",
	// so generic buff matching must never run before debuff matching.
	if (
		/\bamp\s*debuffs?\b/.test(normalized) ||
		/\bdebuffs?\b/.test(normalized) ||
		/\benfeeble\b/.test(normalized) ||
		/\btorpor\b/.test(normalized) ||
		/\bdown\b/.test(normalized) ||
		/\bresist\s*down\b/.test(normalized) ||
		/\bdmg\s*rcvd\s*up\b/.test(normalized) ||
		/\bpatk\s*down\b/.test(normalized) ||
		/\bmatk\s*down\b/.test(normalized) ||
		/\bpdef\s*down\b/.test(normalized) ||
		/\bmdef\s*down\b/.test(normalized)
	) {
		return "effect-chip-debuff";
	}

	if (
		/\bamp\s*buffs?\b/.test(normalized) ||
		/\bbuffs?\b/.test(normalized) ||
		/\benliven\b/.test(normalized) ||
		/\bhaste\b/.test(normalized) ||
		/\bboost\b/.test(normalized) ||
		/\bbonus\b/.test(normalized) ||
		/\bpot\s*up\b/.test(normalized) ||
		/\bpatk\s*up\b/.test(normalized) ||
		/\bmatk\s*up\b/.test(normalized) ||
		/\bpdef\s*up\b/.test(normalized) ||
		/\bmdef\s*up\b/.test(normalized) ||
		/\bexploit\s*weakness\b/.test(normalized) ||
		/\bweapon\s*boost\b/.test(normalized) ||
		/\bdamage\s*bonus\b/.test(normalized)
	) {
		return "effect-chip-buff";
	}

	return "effect-chip-neutral";
}

function renderSlotDetailChips(parts, inactive = false) {
	return parts
		.map((part) => {
			const normalized = normalizeEffectLabel(part);
			const limitedUse = /\[Limited-use/i.test(part);
			const passive = /\[Passive\]/i.test(part);
			// Provoke is a special defensive buff: keep its distinguished amber
			// colour consistent with the toggle and coverage pills.
			const kindClass =
				normalized === "provoke"
					? "effect-chip-special"
					: effectKindClassFromText(part);
			const stateClass = inactive
				? "opacity-65"
				: limitedUse
					? "opacity-80"
					: passive
						? "ring-1 ring-inset ring-slate-300 dark:ring-slate-600"
						: "";
			return `<span class="effect-chip ${kindClass} ${stateClass}" data-effect-value="${escapeHtml(normalized)}">${escapeHtml(part)}</span>`;
		})
		.join("");
}

function effectChipsFromCsv(text) {
	const items = parseCsvList(text);
	if (!items.length)
		return '<span class="effect-chip effect-chip-neutral">None</span>';
	return items
		.map((item) => {
			const normalized = normalizeEffectLabel(item);
			// Provoke is a special defensive buff: keep its distinguished amber
			// colour consistent with the toggle and coverage pills.
			const kindClass =
				normalized === "provoke"
					? "effect-chip-special"
					: looksDebuff(item)
						? "effect-chip-debuff"
						: looksBuff(item)
							? "effect-chip-buff"
							: "effect-chip-neutral";
			return `<span class="effect-chip ${kindClass}" data-effect-hover="${escapeHtml(normalized)}">${escapeHtml(item)}</span>`;
		})
		.join("");
}

function pill(text, classes) {
	return text
		? `<span class="inline-flex rounded-md px-2.5 py-1 text-xs font-black ${classes}">${escapeHtml(text)}</span>`
		: "";
}

function bindEffectHover() {
	document
		.querySelectorAll('[data-effect-hover-source="coverage"]')
		.forEach((chip) => {
			chip.addEventListener("mouseenter", () =>
				highlightEquipment(chip.dataset.effectHover),
			);
			chip.addEventListener("mouseleave", clearHighlight);
		});
}

function highlightEquipment(effectKey) {
	if (!effectKey) return;
	const targets = document.querySelectorAll("[data-effect-index]");
	targets.forEach((el) => {
		const index = el.dataset.effectIndex || "";
		const match = index.includes(effectKey) || effectKey.includes(index);
		el.classList.toggle("is-highlighted", Boolean(match && index));
		el.classList.toggle("is-dimmed", !match);
	});
}

function clearHighlight() {
	document.querySelectorAll(".is-highlighted,.is-dimmed").forEach((el) => {
		el.classList.remove("is-highlighted", "is-dimmed");
	});
}

function parseCsvList(text) {
	return String(text || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.filter((s) => s.toLowerCase() !== "none");
}

function normalizeEffectLabel(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/^(buff|debuff|amp):\s*/g, "")
		.replace(/>=?t\d+/g, "")
		.replace(/\[.*?\]/g, "")
		.replace(/\b(t\d|low|mid|high|xhigh|extra high)\b/g, "")
		.replace(/\bpotency\b/g, "pot")
		.replace(/\bresist(?:ance)?\b/g, "resist")
		.replace(/\bdamage\b/g, "dmg")
		.replace(/\bphysical\b/g, "phys")
		.replace(/\bmagic(?:al)?\b/g, "mag")
		.replace(/\bsingle\s+tgt\b/g, "single target")
		.replace(/\ball\s+tgt\b/g, "all target")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function looksDebuff(text) {
	return effectKindClassFromText(text) === "effect-chip-debuff";
}

function looksBuff(text) {
	return effectKindClassFromText(text) === "effect-chip-buff";
}

function groupBy(items, fn) {
	return items.reduce((acc, item) => {
		const key = fn(item);
		if (!acc[key]) acc[key] = [];
		acc[key].push(item);
		return acc;
	}, {});
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// Dev/local only: expose a "Copy build JSON" button that includes the input
// parameters. Hidden in production builds.
const IS_DEV =
	location.hostname === "localhost" ||
	location.hostname === "127.0.0.1" ||
	location.hostname.endsWith(".local") ||
	import.meta.env?.DEV === true;

function updateReloadButton() {
	const button = $("reloadButton");
	if (button) button.disabled = !state.sheetUrl.trim();
}

function updateCopyButton() {
	const button = $("copyBuildButton");
	if (!button) return;
	if (!IS_DEV) {
		button.classList.add("hidden");
		return;
	}
	button.classList.remove("hidden");
	button.disabled = !lastResult || Boolean(lastResult.error);
}

async function copyBuildJson() {
	if (!lastResult || lastResult.error) return;
	const payload = {
		inputs: {
			sheetUrl: state.sheetUrl,
			preset: state.preset,
			weakArch: state.weakArch,
			weakElem: state.weakElem,
			damageAssumption: state.damageAssumption,
			healerNeeded: state.healerNeeded,
			selectedEffects: currentEffectDefs()
				.filter((effect) => state.selectedEffects[effect.id])
				.map((effect) => effect.token),
		},
		result: lastResult,
	};
	await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
	const label = $("copyBuildLabel");
	const old = label.textContent;
	label.textContent = "Copied";
	setTimeout(() => {
		label.textContent = old;
	}, 1200);
}

async function reloadData() {
	if (!state.sheetUrl.trim()) return;
	const button = $("reloadButton");
	if (button) button.classList.add("is-loading");
	setStatus("Reloading sheet...");
	scheduleRecalculate({ reloadData: true });
	setTimeout(() => button?.classList.remove("is-loading"), 600);
}

function handleControlChange(event) {
	const targetId = event?.target?.id || "";
	const previousSource = sourceKey();
	readControlsIntoState();
	if (targetId === "themeMode") applyTheme();
	if (targetId === "preset") {
		const preset = getPresetDefinition(state.preset);
		if (preset) applyPreset(preset);
		writeStateToControls();
	} else if (
		["weakArch", "weakElem", "damageAssumption", "healerNeeded"].includes(
			targetId,
		)
	) {
		state.preset = "custom";
		$("preset").value = "custom";
	}
	ensureEffectSelectionDefaults();
	persistState();
	const nextSource = sourceKey();
	updateReloadButton();
	renderEffectPanels(lastResult);
	scheduleRecalculate({ reloadData: previousSource !== nextSource });
}

function bindInputs() {
	for (const id of [...CONTROL_IDS, "healerNeeded"]) {
		$(id).addEventListener("input", handleControlChange);
		$(id).addEventListener("change", handleControlChange);
	}
	$("reloadButton").addEventListener("click", reloadData);
	$("copyBuildButton").addEventListener("click", copyBuildJson);
	updateReloadButton();
	updateCopyButton();
	document.addEventListener("click", (event) => {
		const button = event.target.closest("[data-effect-toggle]");
		if (!button) return;
		const id = button.dataset.effectToggle;
		state.preset = "custom";
		$("preset").value = "custom";
		state.selectedEffects[id] = !state.selectedEffects[id];
		persistState();
		renderEffectPanels(lastResult);
		scheduleRecalculate();
	});
}

function renderPresetOptions() {
	const select = $("preset");
	if (!select) return;
	const current = state.preset || "custom";
	const quickOptions = Object.entries(QUICK_PRESETS)
		.map(
			([key, preset]) =>
				`<option value="${escapeHtml(key)}">${escapeHtml(preset.label)}</option>`,
		)
		.join("");
	const groups = [
		`<option value="custom">Custom</option>`,
		`<optgroup label="Quick presets">${quickOptions}</optgroup>`,
	];
	if (extendedPresets.length) {
		const extendedOptions = extendedPresets
			.map(
				(preset) =>
					`<option value="${escapeHtml(preset.key)}">${escapeHtml(preset.label)}</option>`,
			)
			.join("");
		groups.push(
			`<optgroup label="Extended presets">${extendedOptions}</optgroup>`,
		);
	}
	select.innerHTML = groups.join("");
	const hasCurrent = Array.from(select.options).some(
		(option) => option.value === current,
	);
	select.value = hasCurrent ? current : "custom";
	if (!hasCurrent) state.preset = "custom";
}

function getPresetDefinition(key) {
	if (!key || key === "custom") return null;
	if (QUICK_PRESETS[key]) return QUICK_PRESETS[key];
	return extendedPresets.find((preset) => preset.key === key) || null;
}

function applyPreset(preset) {
	state.weakArch = preset.weakArch ?? state.weakArch;
	state.weakElem = preset.weakElem ?? state.weakElem;
	state.damageAssumption =
		preset.damageAssumption || state.damageAssumption || "conservative";
	state.healerNeeded = Boolean(preset.healerNeeded);
	const explicitTokens = [
		...parseCsvList(preset.wantBuffs),
		...parseCsvList(preset.wantDebuffs),
		...parseCsvList(preset.defensiveBuffs),
		...parseCsvList(preset.defensiveDebuffs),
	];
	state.selectedEffects = {};
	if (explicitTokens.length) {
		const tokenSet = new Set(explicitTokens.map(normalizeToken));
		for (const effect of currentEffectDefs()) {
			state.selectedEffects[effect.id] = tokenSet.has(
				normalizeToken(effect.token),
			);
		}
	} else {
		ensureEffectSelectionDefaults();
	}
}

function parsePresetRows(rows) {
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

function normalizeToken(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

systemThemeQuery?.addEventListener?.("change", () => {
	if (state.themeMode === "system") applyTheme();
});
loadSavedState();
ensureEffectSelectionDefaults();
renderEffectPanels();
bindInputs();
updateReloadButton();
scheduleRecalculate({ reloadData: true });

setSourceMeta(null);
