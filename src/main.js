import { fetchSheetCsv, fetchSampleTsv, parseDelimited, validateEquipmentGrid } from './data/sheets.js';
import { recommendTeamsJson } from './core/recommendation.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'ff7ec-team-builder-state-v3';
const EFFECT_KIND = { BUFF: 'buff', DEBUFF: 'debuff' };
const EFFECT_DOMAIN = { OFFENSE: 'offense', DEFENSE: 'defense' };
const ELEMENT_LABEL = { fire: 'Fire', ice: 'Ice', lightning: 'Lightning', wind: 'Wind', water: 'Water', earth: 'Earth', nonelem: 'Non-elem' };
const ARCH_LABEL = { phys: 'Physical', mag: 'Magical', hybrid: 'Hybrid' };

const PRESETS = {
  'phys-fire': { weakArch: 'phys', weakElem: 'fire', healerNeeded: true },
  'phys-ice': { weakArch: 'phys', weakElem: 'ice', healerNeeded: true },
  'phys-lightning': { weakArch: 'phys', weakElem: 'lightning', healerNeeded: true },
  'phys-wind': { weakArch: 'phys', weakElem: 'wind', healerNeeded: true },
  'phys-water': { weakArch: 'phys', weakElem: 'water', healerNeeded: true },
  'phys-earth': { weakArch: 'phys', weakElem: 'earth', healerNeeded: true },
  'mag-fire': { weakArch: 'mag', weakElem: 'fire', healerNeeded: true },
  'mag-ice': { weakArch: 'mag', weakElem: 'ice', healerNeeded: true },
  'mag-lightning': { weakArch: 'mag', weakElem: 'lightning', healerNeeded: true },
  'mag-wind': { weakArch: 'mag', weakElem: 'wind', healerNeeded: true },
  'mag-water': { weakArch: 'mag', weakElem: 'water', healerNeeded: true },
  'mag-earth': { weakArch: 'mag', weakElem: 'earth', healerNeeded: true },
};

const state = {
  sheetUrl: '',
  sheetName: 'Equipments',
  preset: 'custom',
  weakArch: '',
  weakElem: '',
  damageAssumption: 'conservative',
  healerNeeded: false,
  selectedEffects: {},
  themeMode: 'system',
};

let equipmentRows = null;
let loadedSourceKey = '';
let lastResult = null;
let renderRequestId = 0;
let pendingTimer = null;
const systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

function effectiveTheme() {
  if (state.themeMode === 'dark' || state.themeMode === 'light') return state.themeMode;
  return systemThemeQuery?.matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', effectiveTheme() === 'dark');
}

function loadSavedState() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch (_) {}
  for (const id of ['sheetUrl', 'sheetName', 'preset', 'weakArch', 'weakElem', 'damageAssumption', 'themeMode']) {
    if ($(id) && state[id] !== undefined) $(id).value = state[id];
  }
  $('healerNeeded').checked = Boolean(state.healerNeeded);
  applyTheme();
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readControlsIntoState() {
  for (const id of ['sheetUrl', 'sheetName', 'preset', 'weakArch', 'weakElem', 'damageAssumption', 'themeMode']) {
    state[id] = $(id).value;
  }
  state.healerNeeded = $('healerNeeded').checked;
}

function writeStateToControls() {
  for (const id of ['sheetUrl', 'sheetName', 'preset', 'weakArch', 'weakElem', 'damageAssumption', 'themeMode']) {
    if ($(id)) $(id).value = state[id] || (id === 'themeMode' ? 'system' : '');
  }
  $('healerNeeded').checked = Boolean(state.healerNeeded);
  applyTheme();
}


function sourceKey() {
  const url = state.sheetUrl.trim();
  if (!url) return 'bundled-default';
  return `sheet:${url}::${state.sheetName.trim() || 'Equipments'}`;
}

function scheduleRecalculate({ reloadData = false } = {}) {
  if (reloadData) loadedSourceKey = '';
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => recompute(), 180);
}

function setStatus(text, tone = 'neutral') {
  const toneClass = tone === 'error' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-500';
  $('status').className = `text-sm font-bold ${toneClass}`;
  $('status').textContent = text;
}

function currentEffectDefs() {
  return buildEffectDefs(state.weakArch, state.weakElem);
}

function ensureEffectSelectionDefaults() {
  const defs = currentEffectDefs();
  const next = { ...state.selectedEffects };
  for (const effect of defs) {
    if (!(effect.id in next)) next[effect.id] = Boolean(effect.defaultOn);
  }
  state.selectedEffects = next;
}

function effectLabelForElement(type, elem) {
  const element = ELEMENT_LABEL[elem] || elem;
  const labels = {
    elemDmgUp: `${element} Potency Up`,
    elemDmgBonus: `${element} Damage Bonus`,
    elemWeaponBoost: `${element} Weapon Boost`,
    elemResistDown: `${element} Resist. Down`,
    elemDmgRcvdUp: `${element} Dmg. Rcvd. Up`,
    elemResistUp: `${element} Resist. Up`,
    elemDmgDown: `${element} Potency Down`,
  };
  return labels[type];
}

function makeEffect({ id, kind, domain, group, label, token, defaultOn = false, layer = null }) {
  return { id, kind, domain, group, label, token, defaultOn, layer };
}

function buildEffectDefs(weakArch, weakElem) {
  const defs = [];
  const realElem = weakElem && weakElem !== 'nonelem' ? weakElem : '';
  const archs = weakArch === 'hybrid' ? ['phys', 'mag'] : weakArch ? [weakArch] : [];

  for (const arch of archs) {
    defs.push(makeEffect({ id: `off-buff-${arch}-atk`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 1 · Base buffs', label: arch === 'phys' ? 'PATK Up' : 'MATK Up', token: arch === 'phys' ? 'patkUp' : 'matkUp', defaultOn: true, layer: 1 }));
    defs.push(makeEffect({ id: `off-debuff-${arch}-def`, kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 1 · Base debuffs', label: arch === 'phys' ? 'PDEF Down' : 'MDEF Down', token: arch === 'phys' ? 'pdefDown' : 'mdefDown', defaultOn: true, layer: 1 }));
    defs.push(makeEffect({ id: `off-debuff-${arch}-rcvd`, kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 3 · Damage received', label: arch === 'phys' ? 'Phys. Dmg. Rcvd. Up' : 'Mag. Dmg. Rcvd. Up', token: arch === 'phys' ? 'physDmgRcvdUp' : 'magDmgRcvdUp', defaultOn: false, layer: 3 }));
    defs.push(makeEffect({ id: `off-buff-${arch}-bonus`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 4 · Damage bonus', label: arch === 'phys' ? 'Physical Damage Bonus' : 'Magic Damage Bonus', token: arch === 'phys' ? 'physDmgBonus' : 'magDmgBonus', defaultOn: true, layer: 4 }));
    defs.push(makeEffect({ id: `off-buff-${arch}-weapon`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 5 · Weapon boost', label: arch === 'phys' ? 'Physical Weapon Boost' : 'Magic Weapon Boost', token: arch === 'phys' ? 'physWeaponBoost' : 'magWeaponBoost', defaultOn: true, layer: 5 }));
  }

  if (realElem) {
    defs.push(makeEffect({ id: `off-buff-${realElem}-pot`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 1 · Base buffs', label: effectLabelForElement('elemDmgUp', realElem), token: `elemDmgUp:${realElem}`, defaultOn: true, layer: 1 }));
    defs.push(makeEffect({ id: `off-debuff-${realElem}-res-down`, kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 1 · Base debuffs', label: effectLabelForElement('elemResistDown', realElem), token: `elemResistDown:${realElem}`, defaultOn: true, layer: 1 }));
    defs.push(makeEffect({ id: 'off-buff-exploit-weakness', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 3 · Weakness exploit', label: 'Exploit Weakness', token: 'exploitWeakness', defaultOn: true, layer: 3 }));
    defs.push(makeEffect({ id: `off-debuff-${realElem}-rcvd`, kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 3 · Damage received', label: effectLabelForElement('elemDmgRcvdUp', realElem), token: `elemDmgRcvdUp:${realElem}`, defaultOn: false, layer: 3 }));
    defs.push(makeEffect({ id: `off-buff-${realElem}-bonus`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 4 · Damage bonus', label: effectLabelForElement('elemDmgBonus', realElem), token: `elemDmgBonus:${realElem}`, defaultOn: true, layer: 4 }));
    defs.push(makeEffect({ id: `off-buff-${realElem}-weapon`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 5 · Weapon boost', label: effectLabelForElement('elemWeaponBoost', realElem), token: `elemWeaponBoost:${realElem}`, defaultOn: true, layer: 5 }));
  }

  if (weakArch || weakElem) {
    defs.push(makeEffect({ id: 'off-buff-enliven', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 2 · Amplify', label: 'Enliven', token: 'enliven', defaultOn: true, layer: 2 }));
    defs.push(makeEffect({ id: 'off-buff-amp-buffs', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 2 · Amplify', label: 'Amp. Buffs', token: 'amp target=buff', defaultOn: true, layer: 2 }));
    defs.push(makeEffect({ id: 'off-debuff-enfeeble', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 2 · Amplify', label: 'Enfeeble', token: 'enfeeble', defaultOn: false, layer: 2 }));
    if (archs.length || realElem) defs.push(makeEffect({ id: 'off-debuff-amp-debuffs', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 2 · Amplify', label: 'Amp. Debuffs', token: 'amp target=debuff', defaultOn: true, layer: 2 }));
    defs.push(makeEffect({ id: 'off-debuff-dmg-rcvd', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Layer 3 · Damage received', label: 'Dmg. Rcvd. Up', token: 'dmgRcvdUp', defaultOn: false, layer: 3 }));
    defs.push(makeEffect({ id: 'off-debuff-torpor', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.OFFENSE, group: 'Apex', label: 'Torpor', token: 'torpor', defaultOn: false, layer: 6 }));
  }

  const elements = ['fire', 'ice', 'lightning', 'wind', 'water', 'earth'];
  defs.push(makeEffect({ id: 'def-buff-pdef-up', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Defense', label: 'PDEF Up', token: 'pdefUp', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-buff-mdef-up', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Defense', label: 'MDEF Up', token: 'mdefUp', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-buff-def-up', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Defense', label: 'DEF Up', token: 'defUp', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-buff-barrier', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Sustain', label: 'Barrier', token: 'barrier', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-buff-regen', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Sustain', label: 'Regen', token: 'regen', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-buff-veil', kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Sustain', label: 'Veil', token: 'veil', defaultOn: false }));
  for (const elem of elements) {
    defs.push(makeEffect({ id: `def-buff-${elem}-res-up`, kind: EFFECT_KIND.BUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive buffs · Element resist', label: effectLabelForElement('elemResistUp', elem), token: `elemResistUp:${elem}`, defaultOn: false }));
    defs.push(makeEffect({ id: `def-debuff-${elem}-pot-down`, kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive debuffs · Enemy offense', label: effectLabelForElement('elemDmgDown', elem), token: `elemDmgDown:${elem}`, defaultOn: false }));
  }
  defs.push(makeEffect({ id: 'def-debuff-patk-down', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive debuffs · Enemy offense', label: 'PATK Down', token: 'patkDown', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-debuff-matk-down', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive debuffs · Enemy offense', label: 'MATK Down', token: 'matkDown', defaultOn: false }));
  defs.push(makeEffect({ id: 'def-debuff-atk-down', kind: EFFECT_KIND.DEBUFF, domain: EFFECT_DOMAIN.DEFENSE, group: 'Defensive debuffs · Enemy offense', label: 'ATK Down', token: 'atkDown', defaultOn: false }));

  return defs;
}

function selectedEffectTokens(kind) {
  return currentEffectDefs()
    .filter(effect => effect.kind === kind && state.selectedEffects[effect.id])
    .map(effect => effect.token);
}

function effectOptionsForRecommendation() {
  return {
    weakArch: state.weakArch,
    weakElem: state.weakElem,
    wantBuffs: selectedEffectTokens(EFFECT_KIND.BUFF).join(', '),
    wantDebuffs: selectedEffectTokens(EFFECT_KIND.DEBUFF).join(', '),
    healerNeeded: state.healerNeeded,
    damageAssumption: state.damageAssumption,
  };
}

function renderEffectPanels(result = null) {
  ensureEffectSelectionDefaults();
  const defs = currentEffectDefs();
  const covered = new Set(coveredEffectIds(result));
  $('offensiveEffects').innerHTML = renderEffectDomain(defs, EFFECT_DOMAIN.OFFENSE, covered);
  $('defensiveEffects').innerHTML = renderEffectDomain(defs, EFFECT_DOMAIN.DEFENSE, covered);
}

function renderEffectDomain(defs, domain, covered) {
  const domainDefs = defs.filter(effect => effect.domain === domain);
  if (!domainDefs.length) return '<p class="text-sm text-slate-500">Choose an archetype or element to infer applicable effects.</p>';
  const groups = groupBy(domainDefs, effect => effect.group);
  return Object.entries(groups).map(([group, effects]) => `
    <div>
      <div class="mb-2 flex items-center justify-between gap-3">
        <h3 class="text-xs font-black uppercase tracking-[0.16em] text-slate-500">${escapeHtml(group)}</h3>
        <span class="text-xs font-bold text-slate-400">${effects.filter(e => state.selectedEffects[e.id]).length}/${effects.length} selected</span>
      </div>
      <div class="flex flex-wrap gap-2">
        ${effects.map(effect => renderToggleChip(effect, covered.has(effect.id))).join('')}
      </div>
    </div>
  `).join('');
}

function renderToggleChip(effect, isCovered) {
  const selected = Boolean(state.selectedEffects[effect.id]);
  const base = effect.kind === EFFECT_KIND.BUFF ? 'chip-buff' : 'chip-debuff';
  const active = effect.kind === EFFECT_KIND.BUFF ? 'chip-buff-active' : 'chip-debuff-active';
  return `
    <button type="button" class="chip-button ${selected ? active : base}" data-effect-toggle="${escapeHtml(effect.id)}" aria-pressed="${selected}">
      <span class="toggle-box" aria-hidden="true">${selected ? '✓' : ''}</span>
      <span>${escapeHtml(effect.label)}</span>
      ${isCovered ? '<span class="sr-only">covered</span>' : ''}
    </button>
  `;
}

function coveredEffectIds(result) {
  const labels = new Set();
  for (const build of result?.builds || []) {
    parseCsvList(build.summary?.coverage).forEach(label => labels.add(normalizeEffectLabel(label)));
  }
  return currentEffectDefs().filter(effect => labels.has(normalizeEffectLabel(effect.label))).map(effect => effect.id);
}

async function loadRowsIfNeeded() {
  const key = sourceKey();
  if (equipmentRows && loadedSourceKey === key) return equipmentRows;
  const usingSheet = Boolean(state.sheetUrl.trim());
  setStatus(usingSheet ? 'Loading sheet...' : 'Loading bundled data...');
  const raw = usingSheet
    ? await fetchSheetCsv(state.sheetUrl, state.sheetName || 'Equipments')
    : await fetchSampleTsv();
  equipmentRows = parseDelimited(raw);
  loadedSourceKey = key;
  return equipmentRows;
}

async function recompute() {
  const requestId = ++renderRequestId;
  readControlsIntoState();
  ensureEffectSelectionDefaults();
  persistState();
  applyTheme();
  renderEffectPanels(lastResult);

  try {
    const rows = await loadRowsIfNeeded();
    if (requestId !== renderRequestId) return;
    if (!rows) {
      lastResult = null;
      $('output').textContent = '';
      renderDiagnostics([], {});
      renderEmpty('Loading bundled data...');
      setStatus('Loading bundled data.');
      return;
    }

    const validation = validateEquipmentGrid(rows);
    if (!validation.ok) {
      const payload = { validation, rowCount: rows.length };
      lastResult = payload;
      $('output').textContent = JSON.stringify(payload, null, 2);
      renderDiagnostics(validation.warnings, { equipmentCount: Math.max(0, rows.length - 1), mode: state.sheetUrl.trim() ? 'google sheet' : 'bundled default', validation });
      renderEmpty('Schema validation failed. Fix the sheet columns and the app will recalculate.');
      setStatus('Schema validation failed.', 'error');
      return;
    }

    const result = recommendTeamsJson(rows, effectOptionsForRecommendation());
    result.source = {
      mode: state.sheetUrl.trim() ? 'google sheet' : 'bundled default',
      sheetName: state.sheetName || 'Equipments',
      rowCount: rows.length,
      equipmentCount: Math.max(0, rows.length - 1),
      validation,
    };
    result.selectedEffects = currentEffectDefs().filter(effect => state.selectedEffects[effect.id]);
    lastResult = result;
    $('output').textContent = JSON.stringify(result, null, 2);
    $('copyJsonButton').disabled = false;
    renderEffectPanels(result);
    renderResult(result);
    setStatus(`Done. ${result.builds.length} build(s) returned.`, 'ok');
  } catch (error) {
    if (requestId !== renderRequestId) return;
    const payload = { error: error.message, stack: error.stack };
    lastResult = payload;
    $('output').textContent = JSON.stringify(payload, null, 2);
    renderDiagnostics([error.message], payload);
    renderEmpty('Unable to load or recommend from this data source.');
    setStatus('Failed.', 'error');
  }
}

function renderDiagnostics(warnings = [], source = {}) {
  const allWarnings = [...warnings];
  if (source?.validation?.warnings) allWarnings.push(...source.validation.warnings);
  const unique = Array.from(new Set(allWarnings.filter(Boolean)));
  const diagnostics = $('diagnostics');
  if (!unique.length && !source?.equipmentCount) {
    diagnostics.className = 'hidden rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100';
    diagnostics.innerHTML = '';
    return;
  }
  diagnostics.className = 'rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100';
  diagnostics.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <strong>Source</strong>
      <span class="rounded-full bg-white px-2 py-1 font-bold dark:bg-amber-900/60 dark:text-amber-50">${escapeHtml(source.mode || 'loaded data')}</span>
      ${source.equipmentCount !== undefined ? `<span class="rounded-full bg-white px-2 py-1 font-bold dark:bg-amber-900/60 dark:text-amber-50">${source.equipmentCount} equipment rows</span>` : ''}
    </div>
    ${unique.length ? `<div class="mt-3 flex flex-wrap gap-2">${unique.map(w => `<span class="rounded-full bg-amber-100 px-2 py-1 font-bold dark:bg-amber-900/60 dark:text-amber-50">${escapeHtml(w)}</span>`).join('')}</div>` : ''}
  `;
}

function renderResult(result) {
  renderDiagnostics(result.warnings?.map(w => `${w.type}: ${w.message}`) || [], result.source);
  if (!result.builds?.length) {
    renderEmpty(result.warnings?.[0]?.message || 'No builds returned for this profile.');
    return;
  }

  $('results').className = 'grid gap-5';
  $('results').innerHTML = `
    <section class="grid gap-4">
      ${renderCoveredEffects(result, EFFECT_DOMAIN.OFFENSE)}
      ${renderCoveredEffects(result, EFFECT_DOMAIN.DEFENSE)}
    </section>
    <section class="grid gap-5">
      ${result.builds.map(renderBuildCard).join('')}
    </section>
  `;
  bindEffectHover();
}

function renderEmpty(message) {
  $('results').className = 'rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400';
  $('results').innerHTML = escapeHtml(message);
}

function renderCoveredEffects(result, domain) {
  const selected = currentEffectDefs().filter(effect => effect.domain === domain && state.selectedEffects[effect.id]);
  const coveredLabels = new Set();
  for (const build of result?.builds || []) parseCsvList(build.summary?.coverage).forEach(label => coveredLabels.add(normalizeEffectLabel(label)));
  const buffs = selected.filter(effect => effect.kind === EFFECT_KIND.BUFF);
  const debuffs = selected.filter(effect => effect.kind === EFFECT_KIND.DEBUFF);
  return `
    <article class="panel">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 class="panel-title">${domain === EFFECT_DOMAIN.OFFENSE ? 'Covered offensive effects' : 'Covered defensive effects'}</h2>
          <p class="panel-subtitle">Hover a covered effect to highlight matching equipment in the build cards.</p>
        </div>
      </div>
      <div class="grid gap-4">
        ${renderCoveredGroup('Buffs', buffs, coveredLabels)}
        ${renderCoveredGroup('Debuffs', debuffs, coveredLabels)}
      </div>
    </article>
  `;
}

function renderCoveredGroup(title, effects, coveredLabels) {
  if (!effects.length) return `<div><h3 class="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">${title}</h3><span class="effect-chip effect-chip-neutral">None selected</span></div>`;
  return `
    <div>
      <h3 class="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">${title}</h3>
      <div class="flex flex-wrap gap-2">
        ${effects.map(effect => {
          const covered = coveredLabels.has(normalizeEffectLabel(effect.label));
          const kindClass = effect.kind === EFFECT_KIND.BUFF ? 'effect-chip-buff' : 'effect-chip-debuff';
          return `<span class="effect-chip ${kindClass} ${covered ? '' : 'effect-chip-missing'}" data-effect-hover="${escapeHtml(normalizeEffectLabel(effect.label))}" title="Hover to highlight matching equipment"><span class="toggle-box" aria-hidden="true">${covered ? '✓' : ''}</span>${escapeHtml(effect.label)}</span>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderBuildCard(build, index) {
  const summary = build.summary || {};
  return `
    <article class="build-card">
      <div class="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-700 md:flex-row md:items-start md:justify-between">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">${escapeHtml(build.build || `Build #${index + 1}`)}</p>
          <h2 class="mt-1 text-xl font-black tracking-tight text-slate-950 dark:text-slate-50">${escapeHtml(summary.members || 'Team')}</h2>
        </div>
        <div class="flex flex-wrap gap-2 md:justify-end">
          ${pill(summary.potency, 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200')}
          ${pill(summary.score, 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200')}
        </div>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        ${(build.members || []).map(renderMemberCard).join('')}
      </div>
    </article>
  `;
}

function renderMemberCard(member) {
  const memberKey = normalizeEffectLabel(`${member.keyEffects || ''} ${member.weapon1 || ''} ${member.weapon2 || ''} ${member.ultimate || ''} ${member.gear || ''}`);
  return `
    <section class="member-card" data-effect-index="${escapeHtml(memberKey)}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-lg font-black text-slate-950 dark:text-slate-50">${escapeHtml(member.character || 'Unknown')}</h3>
          <p class="text-sm font-extrabold text-slate-500 dark:text-slate-300">${escapeHtml(member.role || '')}</p>
        </div>
        ${pill(member.potency || '', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200')}
      </div>
      <div class="mt-3 grid gap-2">
        ${renderSlot('Weapon 1', member.weapon1)}
        ${renderSlot('Weapon 2', member.weapon2)}
        ${renderSlot('Ultimate', member.ultimate)}
        ${renderSlot('Gear', member.gear)}
      </div>
      <div class="mt-3">
        <h4 class="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">Key effects</h4>
        <div class="flex flex-wrap gap-1.5">${effectChipsFromCsv(member.keyEffects || 'None')}</div>
      </div>
      ${member.notes ? `<div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><strong class="text-slate-800 dark:text-slate-50">Passive notes:</strong> ${escapeHtml(member.notes)}</div>` : ''}
    </section>
  `;
}

function renderSlot(label, text) {
  const key = normalizeEffectLabel(text || '');
  if (!text) return `<div class="equipment-card" data-effect-index=""><p class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">${label}</p><p class="mt-1 text-sm font-bold text-slate-400">None selected</p></div>`;
  const [name, ...details] = String(text).split(' — ');
  return `
    <div class="equipment-card" data-effect-index="${escapeHtml(key)}">
      <p class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">${label}</p>
      <strong class="mt-1 block text-sm text-slate-950 dark:text-slate-50">${escapeHtml(name)}</strong>
      ${details.length ? `<p class="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-200">${escapeHtml(details.join(' — '))}</p>` : ''}
    </div>
  `;
}

function effectChipsFromCsv(text) {
  const items = parseCsvList(text);
  if (!items.length) return '<span class="effect-chip effect-chip-neutral">None</span>';
  return items.map(item => {
    const normalized = normalizeEffectLabel(item);
    const kindClass = looksDebuff(item) ? 'effect-chip-debuff' : looksBuff(item) ? 'effect-chip-buff' : 'effect-chip-neutral';
    return `<span class="effect-chip ${kindClass}" data-effect-hover="${escapeHtml(normalized)}">${escapeHtml(item)}</span>`;
  }).join('');
}

function pill(text, classes) {
  return text ? `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-black ${classes}">${escapeHtml(text)}</span>` : '';
}

function bindEffectHover() {
  document.querySelectorAll('[data-effect-hover]').forEach(chip => {
    chip.addEventListener('mouseenter', () => highlightEquipment(chip.dataset.effectHover));
    chip.addEventListener('mouseleave', clearHighlight);
  });
}

function highlightEquipment(effectKey) {
  if (!effectKey) return;
  const targets = document.querySelectorAll('[data-effect-index]');
  targets.forEach(el => {
    const index = el.dataset.effectIndex || '';
    const match = index.includes(effectKey) || effectKey.includes(index);
    el.classList.toggle('is-highlighted', Boolean(match && index));
    el.classList.toggle('is-dimmed', !match);
  });
}

function clearHighlight() {
  document.querySelectorAll('.is-highlighted,.is-dimmed').forEach(el => {
    el.classList.remove('is-highlighted', 'is-dimmed');
  });
}

function parseCsvList(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean).filter(s => s.toLowerCase() !== 'none');
}

function normalizeEffectLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^(buff|debuff|amp):\s*/g, '')
    .replace(/>=?t\d+/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(t\d|low|mid|high|xhigh|extra high)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksDebuff(text) {
  return /down|rcvd|received|enfeeble|torpor|resist\. down/i.test(text);
}

function looksBuff(text) {
  return /up|boost|bonus|enliven|haste|amp|weakness|regen|barrier|veil/i.test(text);
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function copyJson() {
  if (!lastResult) return;
  await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
  const button = $('copyJsonButton');
  const old = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = old; }, 1200);
}

function handleControlChange(event) {
  const previousSource = sourceKey();
  readControlsIntoState();
  if (event?.target?.id === 'themeMode') applyTheme();
  if (event?.target?.id === 'preset') {
    const preset = PRESETS[state.preset];
    if (preset) Object.assign(state, preset);
    writeStateToControls();
  }
  ensureEffectSelectionDefaults();
  persistState();
  const nextSource = sourceKey();
  renderEffectPanels(lastResult);
  scheduleRecalculate({ reloadData: previousSource !== nextSource });
}

function bindInputs() {
  for (const id of ['sheetUrl', 'sheetName', 'preset', 'weakArch', 'weakElem', 'damageAssumption', 'healerNeeded', 'themeMode']) {
    $(id).addEventListener('input', handleControlChange);
    $(id).addEventListener('change', handleControlChange);
  }
  $('copyJsonButton').addEventListener('click', copyJson);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-effect-toggle]');
    if (!button) return;
    const id = button.dataset.effectToggle;
    state.selectedEffects[id] = !state.selectedEffects[id];
    persistState();
    renderEffectPanels(lastResult);
    scheduleRecalculate();
  });
}

systemThemeQuery?.addEventListener?.('change', () => { if (state.themeMode === 'system') applyTheme(); });
loadSavedState();
ensureEffectSelectionDefaults();
renderEffectPanels();
bindInputs();
scheduleRecalculate({ reloadData: true });
