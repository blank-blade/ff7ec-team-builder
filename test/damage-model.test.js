import assert from "node:assert/strict";
import test from "node:test";

import { calculateTheoreticalDamage } from "../src/core/damage-model.js";

test("matches the sourced baseline skill formula", () => {
	const result = calculateTheoreticalDamage(
		{ arch: "phys", elem: "fire", potency: 750, hitsWeakness: true },
		[],
		{ attack: 1000, enemyDefense: 100, stanceBonus: 50 },
	);
	assert.equal(result.damage, 3515.625);
	assert.equal(result.breakdown.divisor, 320);
	assert.equal(result.low, result.damage * 0.985);
	assert.equal(result.high, result.damage * 1.015);
});

test("uses the highest same-name effect and multiplies different named effects", () => {
	const result = calculateTheoreticalDamage(
		{ arch: "mag", elem: "ice", potency: 1000, hitsWeakness: true },
		[
			{ kind: "buff", type: "matkUp", tier: 2 },
			{ kind: "buff", type: "matkUp", tier: 3 },
			{ kind: "debuff", type: "mdefDown", tier: 3 },
			{ kind: "buff", type: "exploitWeakness", value: 30 },
			{ kind: "buff", type: "magDmgBonus", value: 40 },
		],
		{ attack: 1000, enemyDefense: 100, stanceBonus: 50 },
	);
	assert.equal(result.breakdown.attackTier, 3);
	assert.equal(result.breakdown.defenseTier, 3);
	assert.equal(result.breakdown.namedMultipliers.length, 2);
	assert.ok(result.damage > 10000);
});

test("flags mechanics with no verified percentage as a lower bound", () => {
	const result = calculateTheoreticalDamage(
		{ arch: "phys", elem: "water", potency: 1000, hitsWeakness: true },
		[{ kind: "debuff", type: "elemResistDown", elem: "water" }],
		{},
	);
	assert.equal(result.isLowerBound, true);
	assert.deepEqual(result.unquantified, ["elemResistDown"]);
});
