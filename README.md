# FF7EC Team Builder

Reads equipments catalog from a TSV or public Google Sheets URL and generate team recommendations.

## Current capabilities

- Accepts a public Google Sheet URL or spreadsheet ID.
- Fetches the `Equipments` tab as CSV through Google's public `gviz` CSV endpoint.
- Auto-discovers an optional `Presets` tab from the same public Google Sheet URL.
- Falls back to bundled sample TSV files for local UI testing.
- Validates the expected 14-column equipment schema.
- Runs the ported recommendation logic in the browser.
- Shows recommendation results as build cards:
  - team summary and potency
  - coverage chips
  - per-character roles
  - weapon / ultimate / gear slots
  - key active effects and passive notes
- Keeps the raw JSON in an expandable panel for debugging and future UI iteration.
- Stores form inputs in `localStorage`.

## Expected sheet schema

The `Equipments` tab should have this header:

```text
id	character	type	name	held	c_name	ob	lvl	c_arch	c_elem	c_pot	c_mod	customs	caps
```

## Local development

```bash
npm install
npm run dev
```


## Optional presets schema

The optional `Presets` tab should have this header:

```text
id	name	group	weak_arch	weak_elem	damage_assumption	healer_needed	want_buffs	want_debuffs	defensive_buffs	defensive_debuffs	notes
```

- `id` and `name` are required.
- `weak_arch` accepts `phys`, `mag`, or `hybrid`.
- `weak_elem` accepts `fire`, `ice`, `lightning`, `wind`, `water`, `earth`, or `nonelem`.
- Effect columns use the same internal tokens as the UI/recommendation layer, for example `patkUp`, `pdefDown`, `elemDmgUp:water`, or `elemResistUp:lightning`.
- Presets loaded from the bundled sample or from a Google Sheet appear under `Extended presets` in the Quick preset selector.
- Any manual change to enemy inputs or effect chips switches the selector back to `Custom`.
