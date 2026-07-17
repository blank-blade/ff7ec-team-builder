import assert from "node:assert/strict";
import test from "node:test";

import {
	canonicalizeTypeAndElem,
	effectDisplayName,
} from "../src/core/effect-model.js";
import { buildEffectDefs } from "../src/ui/effects.js";

test("legacy damage-received aliases canonicalize to exact FF7EC effects", () => {
	assert.equal(
		canonicalizeTypeAndElem("physDmgRcvdUp", "none").type,
		"singleTgtPhysDmgRcvdUp",
	);
	assert.equal(
		canonicalizeTypeAndElem("magDmgRcvdUp", "none").type,
		"singleTgtMagDmgRcvdUp",
	);
	assert.equal(
		effectDisplayName("debuff", "singleTgtPhysDmgRcvdUp"),
		"Single-Tgt. Phys. Dmg. Rcvd. Up",
	);
});

test("effect picker exposes exact attack debuffs and no generic ATK Down", () => {
	const effects = buildEffectDefs("hybrid", "fire");
	const tokens = new Set(effects.map((effect) => effect.token));
	assert(tokens.has("patkDown"));
	assert(tokens.has("matkDown"));
	assert(!tokens.has("atkDown"));
	assert(tokens.has("singleTgtPhysDmgRcvdUp"));
	assert(tokens.has("singleTgtMagDmgRcvdUp"));
});
