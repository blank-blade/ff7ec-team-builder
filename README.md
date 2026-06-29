# FF7EC Team Builder

Reads equipments catalog from a TSV or public Google Sheets URL and generate team recommendations.

## Current capabilities

- Accepts a public Google Sheet URL or spreadsheet ID.
- Fetches the `Equipments` tab as CSV through Google's public `gviz` CSV endpoint.
- Can load a bundled sample TSV for local UI testing.
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
