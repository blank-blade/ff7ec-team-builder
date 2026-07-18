# Damage model

The builder ranks valid teams by a formula-based theoretical skill hit. It can optimize either the anchor DPS hit or the sum of one best matching hit per team member. The team objective is a normalized comparison because the current equipment TSV does not contain each character's final PATK/MATK, sub-weapons, materia stats, memoria, or enemy-specific bonuses.

## Formula

The implementation follows [NiaMeowDB's tested damage formula](https://meowdb.com/db/ff7-ec/damage-mechanics):

```text
skill = ATK × 50 × potency × (1 + potency bonuses) × (1 + stance) / divisor
divisor = ceil(enemy DEF × (1 - DEF down)) × 2.2 + 100
```

An elemental weakness applies a 2× multiplier. The displayed expected range is the central result ±1.5% variance. Confirmed tier ladders are:

| Tier | 0 | Low | Mid | High | Extra High | Tier 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PATK/MATK Up | 0% | 10% | 20% | 30% | 40% | 50% |
| Element Potency Up | 0% | 10% | 25% | 40% | 60% | 80% |
| PDEF/MDEF Down | 0% | 15% | 25% | 35% | 45% | 55% |

The reference ATK input is the character's PATK or MATK before passives represented by the selected Gear/UW rows. “Other potency bonus” is the sum of applicable potency sources not present in this TSV. The result is a theoretical skill hit, not time-normalized DPS; animation time, ATB generation, critical-hit probability, enemy phases, and buff uptime are outside the current schema.

## Composition rules

- The highest tier/value wins for duplicate effects with the same name.
- Different named percentage effects multiply each other.
- Enfeeble raises the effective PDEF/MDEF Down tier by one.
- Amp Buffs/Debuffs raises the corresponding tier by the capability's tier.
- Sustained mode excludes limited-use active UW/Gear effects. Peak mode includes them.
- Self/passive effects only affect their carrier; all-allies effects affect every matching member; enemy debuffs affect all matching hits.
- An effect disabled in the target picker is not counted, which models immunity or irrelevance.

These composition rules are cross-checked against [NiaMeowDB's teambuilding guidance](https://meowdb.com/db/ff7-ec/ff7-ec-teambuilding-battle-guide) and [Ever Crisis Info's combat guide](https://evercrisis.info/guides/combat/).

## Lower-bound results

The builder never substitutes an estimated percentage for an unknown mechanic. A result is marked `≥` and “lower bound” when a selected build contains an applicable effect whose exact value has not been verified. This currently includes elemental resistance down and non-numeric mechanics such as Torpor and Enliven. NiaMeowDB explicitly identifies the resistance percentage ladders as unconfirmed.

Equipment percentages added to the bundled TSV are OB10/max values from the matching [NiaMeowDB weapon](https://meowdb.com/db/ff7-ec/weapons) and [Ultimate Weapon](https://meowdb.com/db/ff7-ec/ultimate-weapons) entries. Values that cannot be corroborated remain blank and therefore produce a lower-bound indicator when applicable.

The enrichment pass cross-checked individual entries including [Fusion Sword](https://meowdb.com/db/ff7-ec/weapons/fusion-sword), [Crimson Blitz](https://meowdb.com/db/ff7-ec/weapons/crimson-blitz), [Elegant Gloves](https://meowdb.com/db/ff7-ec/weapons/elegant-gloves), [Phoenix Odachi](https://meowdb.com/db/ff7-ec/weapons/phoenix-odachi), [Kikuichimonji](https://meowdb.com/db/ff7-ec/weapons/kikuichimonji), [Riding Gloves](https://meowdb.com/db/ff7-ec/weapons/riding-gloves), [Chrome Death Penalty](https://meowdb.com/db/ff7-ec/weapons/chrome-death-penalty), and [Rising Sun](https://meowdb.com/db/ff7-ec/weapons/rising-sun). [FF7EC's community weapon reference](https://finalfantasy.fandom.com/wiki/Final_Fantasy_VII_Ever_Crisis_weapons) and the [elemental-debuff reference](https://ff7ec.wordpress.com/elemental-debuff/) were used as secondary checks where NiaMeowDB named an effect but omitted its number, notably Gun of the Worthy's 50% Ice Weakness at OB10.

Three applicable effects in the supplied personal tracker remain intentionally unquantified: Gorgeous Staff's custom Fire Weapon Boost, The Hellhound's Single-Target Physical Damage Received Up, and Metal Knuckles' custom Amp Mag Abilities. No numeric value was added without a corroborating source.

The bundled catalog stays held/maxed at OB10 and level 140. The personal-tracker builder preserves every original `held`, `ob`, and `lvl` cell, then converts sourced percentages to that row's C. Ability milestone (below OB6, OB6–9, or OB10). The milestone progressions are backed by the [weapon/OB guide](https://meowdb.com/db/ff7-ec/ff7-ec-weapons-overboost-guide) and the community references above; examples include 25/40/50% Single-Target Damage Received Up, 20/30/40% Exploit Weakness, and 20/25/30% Damage Bonus. New rows are emitted as unheld OB0; Ultimate and Gear values remain fixed because they do not use weapon OB.
