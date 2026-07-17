import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recommendTeamsJson } from "../src/core/recommendation.js";
import { parseDelimited } from "../src/data/sheets.js";

test("recommendation engine produces builds from the bundled catalog", async () => {
	const text = await readFile("public/sample/equipments.latest.tsv", "utf8");
	const result = recommendTeamsJson(parseDelimited(text), {
		weakArch: "phys",
		weakElem: "fire",
		wantBuffs: "patkUp, patkBoost",
		wantDebuffs: "pdefDown, singleTgtPhysDmgRcvdUp",
		healerNeeded: true,
	});
	assert(result.builds.length > 0);
	assert(result.builds.some((build) => build.members.length === 3));
});
