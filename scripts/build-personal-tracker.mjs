import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [personalArg, outputArg] = process.argv.slice(2);
if (!personalArg || !outputArg) {
	throw new Error(
		"Usage: node scripts/build-personal-tracker.mjs <personal.tsv> <output.tsv>",
	);
}

const catalogPath = new URL(
	"../public/sample/equipments.latest.tsv",
	import.meta.url,
);

const SCALABLE_PERCENT_TYPES = new Set([
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
]);

function personalPercent(name, type, max, ob) {
	if (ob >= 10) return max;
	const milestone = ob >= 6 ? 1 : 0;
	if (type === "elemWeakness" && name === "Gun of the Worthy")
		return [30, 50][milestone];
	if (type === "elemWeakness" && name === "Inflatable Buster Sword")
		return [15, 30][milestone];
	if (type.includes("DmgRcvdUp")) return [25, 40][milestone];
	if (type.startsWith("amp")) return [30, 40][milestone];
	if (type.includes("WeaponBoost")) return [20, 30][milestone];
	if (type === "exploitWeakness")
		return max >= 40 ? [20, 30][milestone] : [20, 25][milestone];
	if (type.includes("DmgBonus"))
		return max >= 40 ? [20, 30][milestone] : [20, 25][milestone];
	return null;
}

function scaleCapsForPersonal(caps, name, ob) {
	return caps
		.split(";")
		.map((raw) => {
			const segment = raw.trim();
			const type = segment.match(/(?:^|\s)type=([^\s;]+)/)?.[1];
			const max = Number(segment.match(/(?:^|\s)value=([^\s;]+)/)?.[1]);
			if (!SCALABLE_PERCENT_TYPES.has(type) || !Number.isFinite(max))
				return segment;
			const value = personalPercent(name, type, max, ob);
			return value === null
				? segment.replace(/(?:^|\s)value=\S+/, "")
				: segment.replace(/(?:^|\s)value=\S+/, ` value=${value}`);
		})
		.join("; ");
}

function parse(text) {
	const lines = text.trimEnd().split(/\r?\n/);
	const header = lines[0].split("\t");
	return {
		header,
		rows: lines.slice(1).map((line) => line.split("\t")),
	};
}

const personal = parse(await readFile(resolve(personalArg), "utf8"));
const catalog = parse(await readFile(catalogPath, "utf8"));
if (personal.header.join("\t") !== catalog.header.join("\t"))
	throw new Error("Personal tracker and bundled catalog schemas differ");

const index = Object.fromEntries(personal.header.map((name, i) => [name, i]));
const personalById = new Map(
	personal.rows.map((row) => [row[index.id], row.slice()]),
);
const merged = catalog.rows.map((catalogRow) => {
	const personalRow = personalById.get(catalogRow[index.id]);
	if (personalRow) {
		personalRow[index.caps] =
			catalogRow[index.type] === "gear" ||
			catalogRow[index.type] === "ultimate"
				? catalogRow[index.caps]
				: scaleCapsForPersonal(
						catalogRow[index.caps],
						personalRow[index.name],
						Number(personalRow[index.ob]),
					);
		return personalRow;
	}
	const added = catalogRow.slice();
	added[index.held] = "FALSE";
	added[index.ob] = "0";
	added[index.lvl] = added[index.type] === "gear" ? "" : "140";
	if (added[index.type] !== "gear" && added[index.type] !== "ultimate")
		added[index.caps] = scaleCapsForPersonal(
			added[index.caps],
			added[index.name],
			0,
		);
	return added;
});

await writeFile(
	resolve(outputArg),
	`${personal.header.join("\t")}\n${merged.map((row) => row.join("\t")).join("\n")}\n`,
);
