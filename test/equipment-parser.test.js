import assert from "node:assert/strict";
import test from "node:test";

import { resolveEquipmentRows } from "../src/core/equipment-parser.js";

const header =
	"id\tcharacter\ttype\tname\theld\tc_name\tob\tlvl\tc_arch\tc_elem\tc_pot\tc_mod\tcustoms\tcaps".split(
		"\t",
	);

test("equipment DSL preserves percentage effects and custom alternatives", () => {
	const row = [
		"wpn_barret_companion_arm",
		"Barret",
		"gacha",
		"Companion Arm",
		"TRUE",
		"Overheating Bash++",
		"0",
		"120",
		"phys",
		"fire",
		"780",
		"mult=2 when=selfHpEq100",
		"spade|diamond",
		"buff type=exploitWeakness value=40 range=allAllies when=custom:none&selfHpGe50; buff type=patkBoost value=40 range=allAllies when=custom:spade",
	];
	const { resolvedItems, schemaWarnings } = resolveEquipmentRows([header, row]);
	assert.deepEqual(schemaWarnings, []);
	assert.equal(resolvedItems.length, 1);
	assert.deepEqual(resolvedItems[0].customOptions, [null, "none", "spade"]);
	assert.equal(
		resolvedItems[0].capabilities.find((cap) => cap.type === "patkBoost").value,
		40,
	);
});

test("Cait Sith input aliases to the roster key used by existing data", () => {
	const row = [
		"id",
		"Cait Sith",
		"gear",
		"Gear",
		"TRUE",
		"",
		"",
		"",
		"",
		"",
		"",
		"",
		"",
		"",
	];
	const { resolvedItems } = resolveEquipmentRows([header, row]);
	assert.equal(resolvedItems[0].item.character, "Cait");
});
