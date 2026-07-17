import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function rows(text) {
	return text
		.trimEnd()
		.split(/\r?\n/)
		.map((line) => line.split("\t"));
}

test("bundled equipment catalog is structurally consistent", async () => {
	const data = rows(
		await readFile("public/sample/equipments.latest.tsv", "utf8"),
	);
	const ids = new Set();
	for (const [index, row] of data.entries()) {
		assert.equal(
			row.length,
			14,
			`equipment row ${index + 1} has ${row.length} columns`,
		);
		if (index === 0) continue;
		assert(!ids.has(row[0]), `duplicate equipment id: ${row[0]}`);
		ids.add(row[0]);
		assert.notEqual(row[1], "Cait Sith", "use canonical Cait roster key");
		assert.equal(
			row[4],
			"TRUE",
			`${row[0]} should be held in the bundled catalog`,
		);
		if (row[2] === "gear") {
			assert.equal(row[6], "", `${row[0]} gear should not have an OB value`);
			assert.equal(row[7], "", `${row[0]} gear should not have a level`);
		} else if (row[2] === "ultimate") {
			assert.equal(
				row[6],
				"",
				`${row[0]} ultimate weapon should not have an OB value`,
			);
			assert.equal(row[7], "140", `${row[0]} should be level 140`);
		} else {
			assert.equal(row[6], "10", `${row[0]} should be OB10`);
			assert.equal(row[7], "140", `${row[0]} should be level 140`);
		}
	}
	for (const id of [
		"uw_barret_battle_cry",
		"wpn_barret_companion_arm",
		"wpn_red_xiii_super_sleuth_collar",
		"gear_tifa_zangan_gi",
		"gear_red_xiii_super_sleuth_cape",
	])
		assert(ids.has(id), `missing ${id}`);
});

test("presets use supported, explicit buff/debuff tokens", async () => {
	const data = rows(await readFile("public/sample/presets.latest.tsv", "utf8"));
	const forbidden = new Set([
		"atkUp",
		"defDown",
		"atkDown",
		"physDmgRcvdUp",
		"magDmgRcvdUp",
	]);
	for (const [index, row] of data.slice(1).entries()) {
		assert.notEqual(
			row[3],
			"any",
			`preset row ${index + 2} uses unsupported any archetype`,
		);
		for (const column of [7, 8, 9, 10]) {
			for (const token of row[column].split(",")) {
				assert(
					!forbidden.has(token.split(":", 1)[0]),
					`preset row ${index + 2} uses ${token}`,
				);
			}
		}
	}
});
