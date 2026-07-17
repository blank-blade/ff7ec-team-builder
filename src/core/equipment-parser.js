import {
	canonicalizeTypeAndElem,
	cleanText,
	normalizeTier,
} from "./effect-model.js";

const CHARACTER_ALIASES = Object.freeze({ "Cait Sith": "Cait" });

function parseDamageMods(value) {
	if (!value) return [];
	return value
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.flatMap((part) => {
			const attrs = parseAttributes(part.split(/\s+/));
			const mult = attrs.mult == null ? null : Number(attrs.mult);
			const add = attrs.add == null ? null : Number(attrs.add);
			if (!mult && !add) return [];
			return [{ mult: mult || null, add: add || null, when: attrs.when || "" }];
		});
}

function parseAttributes(parts) {
	const attrs = {};
	for (const part of parts) {
		const separator = part.indexOf("=");
		if (separator > 0)
			attrs[part.slice(0, separator)] = part.slice(separator + 1);
	}
	return attrs;
}

function customFromWhen(when) {
	return (
		String(when || "")
			.split("&")
			.find((condition) => condition.startsWith("custom:"))
			?.slice(7) || null
	);
}

export function resolveEquipmentRows(equipmentsData) {
	const headers = equipmentsData[0].map((header) =>
		cleanText(header).toLowerCase(),
	);
	const index = Object.fromEntries(
		headers.map((header, position) => [header, position]),
	);
	index.c_pot = index.c_pot ?? index.c_dmg;

	const schemaWarnings = [];
	if (index.caps == null) {
		schemaWarnings.push(
			"Input range is missing the caps column. Pass Equipments!A:N so utility and team coverage can be calculated.",
		);
	}
	if (index.c_mod == null) {
		schemaWarnings.push(
			"Input range is missing the c_mod column. Damage modifiers will be ignored; pass Equipments!A:N.",
		);
	}

	const resolvedItems = [];
	for (const row of equipmentsData.slice(1)) {
		if (!row[index.id] || !row[index.character]) continue;
		if (
			row[index.held] !== true &&
			cleanText(row[index.held]).toUpperCase() !== "TRUE"
		)
			continue;

		const item = {
			id: cleanText(row[index.id]),
			character:
				CHARACTER_ALIASES[cleanText(row[index.character])] ||
				cleanText(row[index.character]),
			type: cleanText(row[index.type]).toLowerCase(),
			name: cleanText(row[index.name]),
			c_arch: cleanText(row[index.c_arch]).toLowerCase() || null,
			c_elem: cleanText(row[index.c_elem]).toLowerCase() || null,
			c_pot: Number(row[index.c_pot]) || 0,
			c_mod: index.c_mod == null ? "" : cleanText(row[index.c_mod]),
			caps: index.caps == null ? "" : cleanText(row[index.caps]),
		};

		const capabilities = [];
		const damage = [];
		const healing = [];
		const customOptions = new Set([null]);

		if (item.c_pot > 0 && item.c_elem === "heal") {
			healing.push({
				pot: item.c_pot,
				range: "self",
				custom: null,
				source: "headline",
			});
			capabilities.push({
				kind: "heal",
				type: "heal",
				elem: "none",
				range: "unknown",
				tier: item.c_pot,
				custom: null,
				label: "heal",
			});
		} else if (item.c_pot > 0 && item.c_arch && item.c_elem) {
			damage.push({
				arch: item.c_arch,
				elem: item.c_elem,
				pot: item.c_pot,
				custom: null,
				mods: parseDamageMods(item.c_mod),
			});
			capabilities.push(
				{
					kind: "dmg",
					type: "elem",
					elem: item.c_elem,
					range: "none",
					tier: 0,
					custom: null,
					label: `dmg ${item.c_elem}`,
				},
				{
					kind: "dmg",
					type: "arch",
					elem: item.c_arch,
					range: "none",
					tier: 0,
					custom: null,
					label: `dmg ${item.c_arch}`,
				},
			);
		}

		for (const capText of item.caps
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean)) {
			const parts = capText.split(/\s+/);
			const kind = parts[0];
			const attrs = parseAttributes(parts.slice(1));
			const custom = customFromWhen(attrs.when);
			if (custom) customOptions.add(custom);

			if (kind === "dmg") {
				const arch = attrs.arch || item.c_arch;
				const elem = attrs.elem || item.c_elem;
				const pot = Number(attrs.mod || attrs.pot) || 0;
				if (arch && elem && pot > 0) {
					damage.push({ arch, elem, pot, custom, mods: [] });
					capabilities.push(
						{
							kind: "dmg",
							type: "elem",
							elem,
							range: "none",
							tier: 0,
							custom,
							label: `dmg ${elem}`,
						},
						{
							kind: "dmg",
							type: "arch",
							elem: arch,
							range: "none",
							tier: 0,
							custom,
							label: `dmg ${arch}`,
						},
					);
				}
				continue;
			}

			if (kind === "heal") {
				const pot = Number(attrs.pot || attrs.mod || item.c_pot) || 0;
				const range = attrs.range || "unknown";
				healing.push({ pot, range, custom, source: "cap" });
				capabilities.push({
					kind: "heal",
					type: "heal",
					elem: "none",
					range,
					tier: pot,
					custom,
					label: "heal",
				});
				continue;
			}

			const rawType = attrs.type || attrs.status || attrs.target;
			if (!rawType) continue;
			const canonical = canonicalizeTypeAndElem(rawType, attrs.elem || "none");
			capabilities.push({
				kind,
				type: canonical.type,
				elem: canonical.elem || "none",
				status: attrs.status || null,
				target: attrs.target || null,
				range: attrs.range || "none",
				tier: normalizeTier(attrs.tier),
				value: Number(attrs.value) || 0,
				custom,
				mode: attrs.mode || null,
				when: attrs.when || null,
				maxTier: normalizeTier(attrs.maxTier),
				label: capText,
			});
		}

		resolvedItems.push({
			item,
			damage,
			healing,
			capabilities,
			customOptions: Array.from(customOptions),
		});
	}

	return { resolvedItems, schemaWarnings };
}
