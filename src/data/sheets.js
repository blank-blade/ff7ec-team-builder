export function parseSpreadsheetId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return '';
}

export function sheetCsvUrl(sheetUrlOrId, sheetName = 'Equipments') {
  const id = parseSpreadsheetId(sheetUrlOrId);
  if (!id) throw new Error('Could not find a Google Spreadsheet ID in the provided URL.');
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

export async function fetchSheetCsv(sheetUrlOrId, sheetName = 'Equipments') {
  const url = sheetCsvUrl(sheetUrlOrId, sheetName);
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sheetName} as CSV: HTTP ${response.status}. Make sure the copied sheet is public/viewable.`);
  }
  return await response.text();
}

export async function fetchSampleTsv() {
  const response = await fetch('./sample/equipments.latest.tsv');
  if (!response.ok) throw new Error(`Failed to load bundled sample TSV: HTTP ${response.status}`);
  return await response.text();
}

export function parseDelimited(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = raw.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  return parseSeparated(raw, delimiter);
}

export function parseCsv(text) {
  return parseSeparated(String(text || '').replace(/^\uFEFF/, ''), ',');
}

function parseSeparated(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export function validateEquipmentGrid(rows) {
  const required = ['id','character','type','name','held','c_name','ob','lvl','c_arch','c_elem','c_pot','c_mod','customs','caps'];
  const warnings = [];
  if (!Array.isArray(rows) || rows.length < 2) {
    return { ok: false, warnings: ['No equipment rows found.'] };
  }
  const header = rows[0].map(x => String(x || '').trim());
  for (const col of required) {
    if (!header.includes(col)) warnings.push(`Missing required column: ${col}`);
  }
  if (header.length < required.length) warnings.push(`Expected at least ${required.length} columns, found ${header.length}.`);
  const widthIssues = rows.slice(1).reduce((count, row) => count + (row.length < required.length ? 1 : 0), 0);
  if (widthIssues) warnings.push(`${widthIssues} row(s) have fewer than ${required.length} columns.`);
  return { ok: warnings.length === 0, warnings };
}
