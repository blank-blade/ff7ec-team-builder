import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../public/sample/equipments.latest.tsv", import.meta.url);

const values = {
	"Fusion Sword": { physWeaponBoost: 40, magWeaponBoost: 40, exploitWeakness: 40 },
	"Crimson Blitz": { elemWeakness: 30, elemDmgBonus: 30 },
	"Cruel Successor": { elemWeaponBoost: 35 },
	"Blue Daffodil Gloves": { exploitWeakness: 40 },
	"Lightning's Gloves": { exploitWeakness: 30 },
	"Demon's Impetus": { physDmgBonus: 40 },
	"Festive Gloves": { singleTgtPhysDmgRcvdUp: 50 },
	"Elegant Gloves": { elemWeaponBoost: 35, ampElemAbilities: 50 },
	"Lightning's Rod": { magDmgBonus: 30 },
	"Staff of the Possessed": { elemWeaponBoost: 35 },
	"Festive Rod": { physDmgBonus: 30, magDmgBonus: 30 },
	"Gorgeous Staff": { elemDmgBonus: 30 },
	"Patissier's Collar": { magWeaponBoost: 35 },
	"Patissier's Spear": { elemDmgBonus: 30 },
	"Rocker's Guitar": { exploitWeakness: 30 },
	"Uber 4-Point Shuriken": { elemDmgBonus: 30 },
	Transgressor: { physWeaponBoost: 30, exploitWeakness: 30 },
	"Antler Pike": { elemDmgBonus: 30 },
	"Sword of the Hunt": { exploitWeakness: 35 },
	"Battering Sword": { elemDmgBonus: 30 },
	"Festive Sword": { exploitWeakness: 40 },
	"Blade of the Worthy": { exploitWeakness: 40 },
	Sōba: { elemWeaponBoost: 35 },
	"Phoenix Odachi": { physWeaponBoost: 35, magWeaponBoost: 35 },
	"Killer Falcon": { elemWeaponBoost: 35 },
	"Inflatable Buster Sword": { elemWeakness: 30 },
	Shiranui: { elemDmgBonus: 30 },
	Kikuichimonji: { physDmgBonus: 30, magDmgBonus: 30 },
	Muramasa: { singleTgtPhysDmgRcvdUp: 50, singleTgtMagDmgRcvdUp: 50 },
	"Starsoul Blade": { magWeaponBoost: 35 },
	"Gun of the Worthy": { elemWeakness: 50 },
	Ragnarok: { ampPhysAbilities: 40, ampMagAbilities: 40 },
	"Dragon Claw": { physWeaponBoost: 60, magWeaponBoost: 60 },
	"Rising Sun": { exploitWeakness: 60 },
	"Garb of the Possessed": { exploitWeakness: 30 },
	"Chrome Death Penalty": { elemWeaponBoost: 35 },
	"Riding Gloves": { elemDmgRcvdUp: 50 },
	"Festive Blade": { elemWeaponBoost: 35 },
};

function patchCaps(caps, equipmentValues, name) {
	const seen = new Set();
	const patched = caps.split(";").map((raw) => {
		const segment = raw.trim();
		const type = segment.match(/(?:^|\s)type=([^\s;]+)/)?.[1];
		if (!type || equipmentValues[type] === undefined) return segment;
		seen.add(type);
		const value = equipmentValues[type];
		return /(?:^|\s)value=/.test(segment)
			? segment.replace(/(?:^|\s)value=\S+/, ` value=${value}`)
			: `${segment} value=${value}`;
	});
	const missing = Object.keys(equipmentValues).filter((type) => !seen.has(type));
	if (missing.length) throw new Error(`${name}: missing caps ${missing.join(", ")}`);
	return patched.join("; ");
}

const text = await readFile(file, "utf8");
const lines = text.trimEnd().split(/\r?\n/);
const header = lines[0].split("\t");
const nameIndex = header.indexOf("name");
const capsIndex = header.indexOf("caps");
const found = new Set();

for (let index = 1; index < lines.length; index += 1) {
	const cells = lines[index].split("\t");
	const equipmentValues = values[cells[nameIndex]];
	if (!equipmentValues) continue;
	found.add(cells[nameIndex]);
	cells[capsIndex] = patchCaps(cells[capsIndex], equipmentValues, cells[nameIndex]);
	lines[index] = cells.join("\t");
}

const missingEquipment = Object.keys(values).filter((name) => !found.has(name));
if (missingEquipment.length)
	throw new Error(`Missing equipment rows: ${missingEquipment.join(", ")}`);

await writeFile(file, `${lines.join("\n")}\n`);
