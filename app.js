'use strict';

/* =========================================================
   Food Tracker — photo-based calorie & nutrient tracker.
   All data lives on the device (IndexedDB + localStorage).
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Nutrients ----------
// goal = default daily target (adult reference values). limit = "stay under".
const NUTRIENTS = [
  { k: 'calories',    label: 'Calories',      unit: 'kcal', goal: 2000 },
  { k: 'protein',     label: 'Protein',       unit: 'g',    goal: 60 },
  { k: 'carbs',       label: 'Carbs',         unit: 'g',    goal: 250 },
  { k: 'fat',         label: 'Fat',           unit: 'g',    goal: 65 },
  { k: 'fiber',       label: 'Fibre',         unit: 'g',    goal: 30 },
  { k: 'sugar',       label: 'Sugar',         unit: 'g',    goal: 50,   limit: true },
  { k: 'sat_fat',     label: 'Saturated fat', unit: 'g',    goal: 20,   limit: true },
  { k: 'cholesterol', label: 'Cholesterol',   unit: 'mg',   goal: 300,  limit: true },
  { k: 'sodium',      label: 'Sodium',        unit: 'mg',   goal: 2300, limit: true },
  { k: 'potassium',   label: 'Potassium',     unit: 'mg',   goal: 3500 },
  { k: 'calcium',     label: 'Calcium',       unit: 'mg',   goal: 1000 },
  { k: 'iron',        label: 'Iron',          unit: 'mg',   goal: 18 },
  { k: 'magnesium',   label: 'Magnesium',     unit: 'mg',   goal: 400 },
  { k: 'zinc',        label: 'Zinc',          unit: 'mg',   goal: 11 },
  { k: 'vitamin_a',   label: 'Vitamin A',     unit: 'mcg',  goal: 900 },
  { k: 'vitamin_c',   label: 'Vitamin C',     unit: 'mg',   goal: 90 },
  { k: 'vitamin_d',   label: 'Vitamin D',     unit: 'mcg',  goal: 15 },
  { k: 'vitamin_b12', label: 'Vitamin B12',   unit: 'mcg',  goal: 2.4 },
  { k: 'folate',      label: 'Folate',        unit: 'mcg',  goal: 400 },
];
const NMAP = Object.fromEntries(NUTRIENTS.map((n) => [n.k, n]));
const NKEYS = NUTRIENTS.map((n) => n.k);
const MAIN_KEYS = ['protein', 'carbs', 'fat', 'fiber', 'sugar'];
const MICRO_KEYS = NKEYS.filter((k) => k !== 'calories' && !MAIN_KEYS.includes(k));
const GOAL_INPUT_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar'];
const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];
const MACRO_COLORS = { protein: 'var(--protein)', carbs: 'var(--carbs)', fat: 'var(--fat)', fiber: 'var(--fiber)', sugar: 'var(--sugar)' };
const UNIT_WORDS = { g: 'grams', mg: 'milligrams', mcg: 'micrograms', kcal: 'calories' };

// ---------- Settings (localStorage) ----------
const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiKey: '',          // placeholder: paste your OpenAI key in Settings
  openaiModel: 'gpt-4o-mini',
  cuisine: '',
  goals: Object.fromEntries(NUTRIENTS.map((n) => [n.k, n.goal])),
  profile: { sex: 'male', age: 30, height: 170, weight: 70, activity: 1.375, target: 'maintain' },
};
const SETTINGS_KEY = 'ft_settings';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { s = {}; }
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    goals: { ...DEFAULT_SETTINGS.goals, ...(s.goals || {}) },
    profile: { ...DEFAULT_SETTINGS.profile, ...(s.profile || {}) },
  };
}
let settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { snackbar('Could not save settings. Storage may be full.', { error: true }); }
}

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('food_tracker', 1);
      r.onupgradeneeded = () => {
        const store = r.result.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('date', 'date');
      };
      r.onsuccess = () => { this.db = r.result; resolve(); };
      r.onerror = () => reject(r.error);
    });
  },
  store(mode) { return this.db.transaction('entries', mode).objectStore('entries'); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(e) { return this.req(this.store('readwrite').put(e)); },
  del(id) { return this.req(this.store('readwrite').delete(id)); },
  get(id) { return this.req(this.store('readonly').get(id)); },
  byDate(d) { return this.req(this.store('readonly').index('date').getAll(d)); },
  range(a, b) { return this.req(this.store('readonly').index('date').getAll(IDBKeyRange.bound(a, b))); },
  all() { return this.req(this.store('readonly').getAll()); },
  clear() { return this.req(this.store('readwrite').clear()); },
};

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function num(v) {
  if (!isFinite(v)) return '0';
  if (Math.abs(v) >= 10) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}
function prettyDate(s) {
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (s.slice(0, 4) !== t.slice(0, 4)) opts.year = 'numeric';
  return parseYmd(s).toLocaleDateString(undefined, opts);
}
function mealForHour(h) { return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 19 ? 'Snacks' : 'Dinner'; }

function itemNutrients(it) {
  const f = (Number(it.grams) || 0) / 100;
  const o = {};
  for (const k of NKEYS) o[k] = (it.per100?.[k] || 0) * f;
  return o;
}
function sumItems(items) {
  const o = Object.fromEntries(NKEYS.map((k) => [k, 0]));
  for (const it of items) {
    const n = itemNutrients(it);
    for (const k of NKEYS) o[k] += n[k];
  }
  return o;
}
const dayTotals = (entries) => sumItems(entries.flatMap((e) => e.items));
const macroText = (n) => `P ${num(n.protein)}g · C ${num(n.carbs)}g · F ${num(n.fat)}g`;

// ---------- Feedback: snackbar, haptics, ripple, busy buttons ----------
let snackTimer;
/** Material snackbar. opts: { error, action: { label, fn } } */
function snackbar(msg, opts = {}) {
  const bar = $('#snackbar');
  const btn = $('#snackAction');
  $('#snackText').textContent = msg;
  bar.classList.toggle('error', !!opts.error);
  btn.hidden = !opts.action;
  btn.onclick = null;
  if (opts.action) {
    btn.textContent = opts.action.label;
    btn.onclick = () => { hideSnackbar(); opts.action.fn(); };
  }
  bar.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, opts.action ? 7000 : opts.error ? 5000 : 3000);
  if (opts.error) haptic([30, 40, 30]);
}
function hideSnackbar() { $('#snackbar').classList.remove('show'); }

function haptic(pattern = 10) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
}

function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  btn.disabled = busy;
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  const label = $('span', btn);
  if (label && busyLabel) {
    if (busy) { btn.dataset.label = label.textContent; label.textContent = busyLabel; }
    else if (btn.dataset.label) label.textContent = btn.dataset.label;
  }
}

const RIPPLE_SEL = '.btn, .icon-btn, .fab, .tab-ind, .entry, .day, .list-item, .seg button, .snack-action';
document.addEventListener('pointerdown', (e) => {
  if (reduceMotion) return;
  let el = e.target.closest(RIPPLE_SEL + ', .tab');
  if (!el || el.disabled) return;
  if (el.classList.contains('tab')) el = $('.tab-ind', el);
  const r = el.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
});

// ---------- Images ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that image. Try a JPG or PNG photo.")); };
    img.src = url;
  });
}
function resizeImage(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// ---------- AI ----------
class AppError extends Error {
  constructor(message, action) { super(message); this.action = action; }
}
const openSettingsAction = { label: 'Settings', fn: () => showView('settings') };

function buildPrompt({ hasImage, text }) {
  const units = 'calories in kcal; protein, carbs, fat, fiber, sugar, sat_fat in grams; cholesterol, sodium, potassium, calcium, iron, magnesium, zinc, vitamin_c in mg; vitamin_a, vitamin_d, vitamin_b12, folate in mcg';
  const keys = NKEYS.map((k) => `"${k}": number`).join(', ');
  return [
    'You are an expert dietitian estimating nutrition for a food diary.',
    hasImage
      ? 'Identify every distinct food and drink visible in the photo, including cooking oil/ghee, sauces, chutneys, gravies, toppings and beverages. Estimate the weight in grams of each portion as served, using the plate, bowl, cutlery, hands and packaging as size references.'
      : 'Estimate the nutrition for the food described below. Use typical serving sizes when a quantity is not given.',
    settings.cuisine ? `The user usually eats: ${settings.cuisine}. Assume typical preparation for that cuisine when unsure.` : 'Assume typical home-style preparation when unsure.',
    text ? `User's description / extra details: "${text}". Trust these details over what you see.` : '',
    'Return ONLY a JSON object, no markdown, in exactly this shape:',
    `{"items":[{"name": string, "grams": number, "confidence": "low"|"medium"|"high", "nutrients": {${keys}}}], "notes": string}`,
    `Nutrient values are for the full estimated grams of that item (NOT per 100 g). Units: ${units}. Use plain numbers, 0 if unknown.`,
    '"notes" is one short sentence on assumptions made (e.g. oil quantity). If there is no food, return {"items":[],"notes":"No food detected"}.',
  ].filter(Boolean).join('\n');
}

async function safeFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new AppError("Can't reach the AI service. Check your internet connection and try again.");
  }
}

function apiError(provider, status, message) {
  const m = String(message || '');
  if (status === 401 || status === 403 || /api key|API_KEY|invalid.*key|incorrect.*key/i.test(m)) {
    return new AppError(`Your ${provider} API key isn't working. Check it in Settings.`, openSettingsAction);
  }
  if (status === 429) return new AppError(`${provider} limit reached for now. Wait a minute, then try again.`);
  if (status === 404) return new AppError(`${provider} model not found. Check the model name in Settings.`, openSettingsAction);
  if (status >= 500) return new AppError(`${provider} is busy right now. Try again in a moment.`);
  return new AppError(`${provider}: ${m || `error ${status}`}`);
}

async function callGemini(prompt, imageDataUrl) {
  const key = settings.geminiKey.trim();
  if (!key) throw new AppError('Add your free Gemini API key in Settings to analyse food.', openSettingsAction);
  const parts = [{ text: prompt }];
  if (imageDataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageDataUrl.split(',')[1] } });
  const model = encodeURIComponent(settings.geminiModel.trim() || DEFAULT_SETTINGS.geminiModel);
  const res = await safeFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('Gemini', res.status, j.error?.message);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function callOpenAI(prompt, imageDataUrl) {
  const key = settings.openaiKey.trim();
  if (!key) throw new AppError('Add your OpenAI API key in Settings, or switch to Gemini.', openSettingsAction);
  const content = [{ type: 'text', text: prompt }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } });
  const res = await safeFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: settings.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('OpenAI', res.status, j.error?.message);
  return j.choices?.[0]?.message?.content || '';
}

function parseAI(txt) {
  const s = String(txt).trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new AppError('The AI gave an unexpected answer. Tap Re-analyse to try again.');
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { throw new AppError("Couldn't read the AI's answer. Tap Re-analyse to try again."); }
  const items = (Array.isArray(j.items) ? j.items : []).map((raw) => {
    const grams = Math.max(1, Number(raw.grams) || 100);
    const n = raw.nutrients || {};
    const per100 = {};
    for (const k of NKEYS) per100[k] = (Math.max(0, Number(n[k]) || 0) * 100) / grams;
    return {
      id: uid(),
      name: String(raw.name || 'Food').slice(0, 80),
      grams: Math.round(grams),
      per100,
      confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : '',
    };
  });
  return { items, notes: String(j.notes || '') };
}

async function analyse({ imageDataUrl = null, text = '' }) {
  const prompt = buildPrompt({ hasImage: !!imageDataUrl, text });
  const raw = settings.provider === 'openai'
    ? await callOpenAI(prompt, imageDataUrl)
    : await callGemini(prompt, imageDataUrl);
  return parseAI(raw);
}

function showError(err) {
  snackbar(err.message || 'Something went wrong. Please try again.', { error: true, action: err.action });
}

// ---------- Navigation ----------
let currentDate = today();
let historyRange = 7;
const TITLES = { today: 'Food Tracker', review: 'Review meal', history: 'History', settings: 'Settings' };

function showView(name, { focus = true } = {}) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('reviewing', name === 'review');
  document.body.classList.toggle('on-today', name === 'today');
  $('#backBtn').hidden = name !== 'review';
  $('#title').textContent = name === 'review' && review?.isEdit ? 'Edit meal' : TITLES[name];
  document.title = name === 'today' ? 'Food Tracker' : `${$('#title').textContent} · Food Tracker`;
  hideSnackbar();
  window.scrollTo(0, 0);
  if (focus) $('#title').focus({ preventScroll: true }); // announce screen change to screen readers
  if (name === 'today') renderToday();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ---------- Today ----------
function barHTML(key, value) {
  const n = NMAP[key];
  const goal = Number(settings.goals[key]) || 0;
  const pct = goal ? Math.min(100, (value / goal) * 100) : 0;
  const over = goal && value > goal;
  const color = over && n.limit ? 'var(--warn)' : MACRO_COLORS[key] || 'var(--primary)';
  const unitWord = UNIT_WORDS[n.unit] || n.unit;
  const badge = n.limit
    ? (over ? `<span class="badge over">${icon('warn')}Over limit</span>` : '<span class="badge limit">· limit</span>')
    : '';
  return `<div class="bar-row">
    <div class="bar-top"><span>${n.label}${badge}</span><span class="val">${num(value)} / ${num(goal)} ${n.unit}</span></div>
    <div class="bar" role="progressbar" aria-label="${n.label}" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.round(value * 10) / 10}"
      aria-valuetext="${num(value)} of ${num(goal)} ${unitWord}${n.limit ? (over ? ', over the limit' : ', limit') : ''}">
      <i style="width:${pct}%;background:${color}"></i>
    </div>
  </div>`;
}

async function renderToday() {
  $('#dateLabel').textContent = prettyDate(currentDate);
  $('#datePicker').value = currentDate;
  $('#datePicker').max = today();
  $('#nextDay').disabled = currentDate >= today();

  const entries = (await DB.byDate(currentDate)).sort((a, b) => a.time.localeCompare(b.time));
  const t = dayTotals(entries);
  const goal = Number(settings.goals.calories) || 0;

  // Calorie ring
  const C = 2 * Math.PI * 52;
  const pct = goal ? t.calories / goal : 0;
  const ring = $('#ringFg');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - Math.min(pct, 1));
  ring.classList.toggle('over', pct > 1);
  const eaten = Math.round(t.calories);
  const left = Math.round(goal - t.calories);
  $('#calEaten').textContent = eaten;
  $('#calGoalTxt').textContent = `of ${goal} kcal`;
  $('#calLeft').textContent = left >= 0 ? `${left} left` : `${-left} over`;
  $('#calLeft').classList.toggle('over', left < 0);
  $('#ringWrap').setAttribute('aria-label', `${eaten} of ${goal} calories eaten, ${left >= 0 ? `${left} left` : `${-left} over goal`}`);

  $('#macroBars').innerHTML = MAIN_KEYS.map((k) => barHTML(k, t[k])).join('');
  $('#microTable').innerHTML = MICRO_KEYS.map((k) => barHTML(k, t[k])).join('');

  if (!entries.length) {
    $('#mealList').innerHTML = `<div class="card empty">
      ${icon('plate')}
      <p><b>No food logged ${currentDate === today() ? 'yet today' : 'on this day'}</b></p>
      <p>Tap <b>Snap food</b> to photograph your meal.</p>
    </div>`;
    return;
  }
  $('#mealList').innerHTML = MEALS.map((meal) => {
    const list = entries.filter((e) => e.meal === meal);
    if (!list.length) return '';
    const mt = dayTotals(list);
    return `<section class="card" aria-label="${meal}">
      <div class="meal-head"><h2>${meal}</h2><span>${Math.round(mt.calories)} kcal</span></div>
      ${list.map((e) => {
        const et = sumItems(e.items);
        const names = e.items.map((i) => i.name).join(', ') || 'Meal';
        return `<button class="entry" data-id="${esc(e.id)}" aria-label="${esc(names)}, ${Math.round(et.calories)} calories at ${esc(e.time)}. Tap to edit.">
          ${e.thumb ? `<img class="thumb" src="${e.thumb}" alt="">` : `<span class="thumb">${icon('plate')}</span>`}
          <span class="entry-body">
            <span class="entry-name">${esc(names)}</span>
            <span class="entry-sub">${esc(e.time)} · ${macroText(et)}</span>
          </span>
          <span class="entry-kcal">${Math.round(et.calories)} <small>kcal</small></span>
        </button>`;
      }).join('')}
    </section>`;
  }).join('');
}

// ---------- Review / edit ----------
let review = null; // { id, photo, thumb, items, meal, date, time, notes, isEdit, analysing, adding }

function newReview(extra = {}) {
  const now = new Date();
  return {
    id: null, photo: null, thumb: null, items: [], notes: '', hint: '',
    date: currentDate,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    meal: mealForHour(now.getHours()),
    isEdit: false, analysing: false, adding: false,
    ...extra,
  };
}

function openReview() {
  showView('review');
  history.pushState({ review: true }, '');
  renderReview();
}
function closeReview() {
  review = null;
  if (history.state && history.state.review) history.back();
  else showView('today');
}
window.addEventListener('popstate', () => {
  if ($('#view-review').classList.contains('active')) { review = null; showView('today'); }
});

const skeletonItem = () => `<div class="card item" aria-hidden="true">
  <div class="skel skel-line w60"></div>
  <div class="item-row"><div class="skel skel-pill"></div><div class="skel skel-line w40" style="margin:0;width:64px;height:28px"></div></div>
  <div class="skel skel-line w80" style="margin:12px 0 0"></div>
</div>`;

function itemHTML(it) {
  const n = itemNutrients(it);
  const name = esc(it.name);
  return `<div class="card item" data-id="${it.id}">
    <div class="item-head">
      <input class="item-name" value="${name}" aria-label="Food name" autocomplete="off">
      <button class="icon-btn remove" aria-label="Remove ${name}">${icon('close')}</button>
    </div>
    <div class="item-row">
      <div class="stepper" role="group" aria-label="Weight of ${name}">
        <button class="icon-btn minus" aria-label="Decrease ${name} weight">${icon('minus')}</button>
        <input class="item-grams" type="number" inputmode="decimal" min="0" value="${it.grams}" aria-label="Grams of ${name}">
        <span class="unit" aria-hidden="true">g</span>
        <button class="icon-btn plus" aria-label="Increase ${name} weight">${icon('plus')}</button>
      </div>
      <div class="item-kcal"><span class="kcal">${Math.round(n.calories)}</span><small>kcal</small></div>
    </div>
    <div class="item-foot">
      <div class="macro-chips">${macroChips(n)}</div>
      ${it.confidence ? `<span class="conf ${it.confidence}">${it.confidence[0].toUpperCase() + it.confidence.slice(1)} confidence</span>` : ''}
    </div>
  </div>`;
}
const macroChips = (n) => `<span style="--c:var(--protein)">Protein ${num(n.protein)}g</span><span style="--c:var(--carbs)">Carbs ${num(n.carbs)}g</span><span style="--c:var(--fat)">Fat ${num(n.fat)}g</span>`;

function renderReview() {
  const r = review;
  if (!r) return;
  $('#title').textContent = r.isEdit ? 'Edit meal' : 'Review meal';
  const img = $('#reviewPhoto');
  img.hidden = !(r.photo || r.thumb);
  if (!img.hidden) img.src = r.photo || r.thumb;
  $('#hintBox').hidden = !r.photo;
  $('#reviewHint').value = r.hint || '';
  $('#reviewMeal').value = r.meal;
  $('#reviewDate').value = r.date;
  $('#reviewDate').max = today();
  $('#reviewTime').value = r.time;
  $('#deleteEntry').hidden = !r.isEdit;
  $('#saveReview span').textContent = r.isEdit ? 'Save changes' : 'Save meal';

  const status = $('#reviewStatus');
  status.classList.toggle('busy', r.analysing);
  status.textContent = r.analysing ? 'Analysing your photo… usually takes 3–10 seconds' : (r.notes ? `AI note: ${r.notes}` : '');

  const busy = r.analysing || r.adding;
  $('#reanalyse').disabled = busy;
  $('#addItemBtn').disabled = busy;
  setBusy($('#addItemBtn'), r.adding);
  $('#saveReview').disabled = busy || !r.items.length;

  let html;
  if (r.analysing) html = skeletonItem() + skeletonItem();
  else if (!r.items.length) {
    html = `<div class="card empty">${icon(r.photo ? 'plate' : 'edit')}<p>${r.photo
      ? 'No food items found. Add extra details and tap <b>Re-analyse</b>, or type the food below.'
      : 'Type what you ate below, for example “2 chapati with dal and a bowl of curd”.'}</p></div>`;
  } else html = r.items.map(itemHTML).join('');
  if (r.adding) html += skeletonItem();
  $('#reviewItems').innerHTML = html;
  updateReviewTotal();
}

function updateReviewTotal() {
  const t = sumItems(review.items);
  $('#reviewTotal').textContent = `${Math.round(t.calories)} kcal`;
  $('#reviewTotal').setAttribute('aria-label', `Meal total ${Math.round(t.calories)} calories, ${macroText(t)}`);
}

function setItemGrams(card, grams) {
  const it = review.items.find((i) => i.id === card.dataset.id);
  if (!it) return;
  it.grams = Math.max(0, Math.round(grams));
  const n = itemNutrients(it);
  $('.kcal', card).textContent = Math.round(n.calories);
  $('.macro-chips', card).innerHTML = macroChips(n);
  updateReviewTotal();
  $('#saveReview').disabled = !review.items.some((i) => i.grams > 0);
}

async function runPhotoAnalysis() {
  if (!review?.photo) return;
  review.analysing = true;
  renderReview();
  try {
    const res = await analyse({ imageDataUrl: review.photo, text: review.hint || '' });
    if (!review) return;
    review.items = res.items;
    review.notes = res.notes;
    if (res.items.length) haptic(15);
    else snackbar('No food found. Add details and re-analyse, or type it.', { error: true });
  } catch (err) {
    showError(err);
  } finally {
    if (review) { review.analysing = false; renderReview(); }
  }
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    const img = await loadImage(file);
    review = newReview({ photo: resizeImage(img, 1024, 0.85), thumb: resizeImage(img, 320, 0.7) });
  } catch (err) {
    showError(err);
    return;
  }
  openReview();
  await runPhotoAnalysis();
}

async function addTypedItem() {
  const input = $('#addItemText');
  const text = input.value.trim();
  if (!text) { input.focus(); snackbar('Type a food first, e.g. “1 cup rice”.'); return; }
  review.adding = true;
  renderReview();
  try {
    const res = await analyse({ text });
    if (!review) return;
    if (!res.items.length) throw new AppError("Couldn't recognise that food. Try describing it differently.");
    review.items.push(...res.items);
    input.value = '';
    haptic(15);
  } catch (err) {
    showError(err);
  } finally {
    if (review) { review.adding = false; renderReview(); }
  }
}

async function saveReview() {
  const r = review;
  r.items = r.items.filter((i) => i.grams > 0);
  if (!r.items.length) { snackbar('Add at least one food before saving.', { error: true }); return; }
  const entry = {
    id: r.id || uid(),
    date: $('#reviewDate').value || today(),
    time: $('#reviewTime').value || '12:00',
    meal: $('#reviewMeal').value,
    thumb: r.thumb || null,
    items: r.items,
    notes: r.notes || '',
    createdAt: r.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await DB.put(entry);
  haptic(20);
  currentDate = entry.date;
  const kcal = Math.round(sumItems(entry.items).calories);
  closeReview();
  setTimeout(() => snackbar(r.isEdit ? 'Meal updated' : `Meal saved · ${kcal} kcal`), 50);
}

async function editEntry(id) {
  const e = await DB.get(id);
  if (!e) return;
  review = newReview({ ...e, items: JSON.parse(JSON.stringify(e.items)), photo: null, isEdit: true });
  openReview();
}

async function deleteEntry() {
  if (!review?.id) return;
  const saved = await DB.get(review.id);
  await DB.del(review.id);
  haptic(20);
  closeReview();
  // Undo instead of a blocking confirm dialog
  setTimeout(() => snackbar('Meal deleted', {
    action: { label: 'Undo', fn: async () => { if (saved) { await DB.put(saved); renderToday(); snackbar('Meal restored'); } } },
  }), 50);
}

// ---------- History ----------
async function renderHistory() {
  $$('#view-history .seg button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.range) === historyRange)));
  const end = today();
  const start = addDays(end, -(historyRange - 1));
  const entries = await DB.range(start, end);
  const byDay = {};
  for (const e of entries) (byDay[e.date] ||= []).push(e);

  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const totals = days.map((d) => (byDay[d] ? dayTotals(byDay[d]) : null));
  const goal = Number(settings.goals.calories) || 0;
  const logged = totals.filter(Boolean);
  const avg = (k) => (logged.length ? logged.reduce((s, t) => s + t[k], 0) / logged.length : 0);

  // Bar chart (SVG)
  const W = 320, H = 160, padB = 20, padT = 8;
  const max = Math.max(goal, ...totals.map((t) => (t ? t.calories : 0)), 1) * 1.1;
  const bw = W / days.length;
  const y = (v) => H - padB - ((H - padB - padT) * v) / max;
  const bars = days.map((d, i) => {
    const v = totals[i] ? totals[i].calories : 0;
    const x = i * bw + bw * 0.15;
    const h = Math.max(0, H - padB - y(v));
    return `<rect class="b ${goal && v > goal ? 'over' : ''}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw * 0.2).toFixed(1)}"><title>${prettyDate(d)}: ${Math.round(v)} kcal</title></rect>`;
  }).join('');
  const labelEvery = historyRange <= 7 ? 1 : historyRange <= 30 ? 7 : 15;
  const labels = days.map((d, i) => {
    if ((days.length - 1 - i) % labelEvery !== 0) return '';
    const dt = parseYmd(d);
    const txt = historyRange <= 7 ? dt.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) : `${dt.getDate()}/${dt.getMonth() + 1}`;
    return `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${txt}</text>`;
  }).join('');
  const goalLine = goal ? `<line class="goal" x1="0" x2="${W}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"></line>` : '';
  const overDays = totals.filter((t) => t && goal && t.calories > goal).length;
  const summary = logged.length
    ? `Last ${historyRange} days: ${logged.length} days logged, average ${Math.round(avg('calories'))} calories, ${overDays} days over your ${goal} calorie goal.`
    : `No meals logged in the last ${historyRange} days.`;
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${summary}">${bars}${goalLine}${labels}</svg>`;

  $('#avgStats').innerHTML = [
    ['Avg kcal', Math.round(avg('calories'))],
    ['Protein', `${num(avg('protein'))}g`],
    ['Carbs', `${num(avg('carbs'))}g`],
    ['Fat', `${num(avg('fat'))}g`],
  ].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('') +
    `<p>Daily averages over ${logged.length} of ${days.length} days logged</p>`;

  const loggedDays = days.filter((d) => byDay[d]).reverse();
  $('#dayList').innerHTML = loggedDays.length
    ? loggedDays.map((d) => {
        const t = dayTotals(byDay[d]);
        const meals = byDay[d].length;
        return `<button class="card day" data-date="${d}" aria-label="${prettyDate(d)}: ${Math.round(t.calories)} calories, ${meals} meals. Open day.">
          <span><b>${prettyDate(d)}</b><small>${meals} meal${meals > 1 ? 's' : ''} · ${macroText(t)}</small></span>
          <span class="entry-kcal">${Math.round(t.calories)} <small>kcal</small></span>
          ${icon('right')}
        </button>`;
      }).join('')
    : `<div class="card empty">${icon('chart')}<p>No meals logged in this period yet.</p></div>`;
}

// ---------- Settings ----------
function renderSettings() {
  $$('#providerSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.provider === settings.provider)));
  $('#geminiBox').hidden = settings.provider !== 'gemini';
  $('#openaiBox').hidden = settings.provider !== 'openai';
  $('#geminiKey').value = settings.geminiKey;
  $('#geminiModel').value = settings.geminiModel;
  $('#openaiKey').value = settings.openaiKey;
  $('#openaiModel').value = settings.openaiModel;
  $('#cuisine').value = settings.cuisine;

  $('#goalInputs').innerHTML = GOAL_INPUT_KEYS.map((k) => `<div>
      <label class="field" for="goal-${k}">${NMAP[k].label} (${NMAP[k].unit})</label>
      <input id="goal-${k}" class="input" type="number" inputmode="decimal" min="0" data-goal="${k}" value="${settings.goals[k]}">
    </div>`).join('');

  const p = settings.profile;
  $('#pSex').value = p.sex;
  $('#pAge').value = p.age;
  $('#pHeight').value = p.height;
  $('#pWeight').value = p.weight;
  $('#pActivity').value = String(p.activity);
  $('#pTarget').value = p.target;
}

function calcGoals(p) {
  // Mifflin-St Jeor BMR × activity, then adjust for goal.
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const adj = { lose: -500, maintain: 0, gain: 300 }[p.target] || 0;
  const calories = Math.max(1200, Math.round((bmr * p.activity + adj) / 10) * 10);
  const protein = Math.round(p.weight * (p.target === 'maintain' ? 1.2 : 1.6));
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = Math.round((calories / 1000) * 14);
  const sugar = Math.round((calories * 0.1) / 4);
  return { calories, protein, carbs, fat, fiber, sugar };
}

// ---------- Export / import ----------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function exportJson() {
  const entries = await DB.all();
  const { geminiKey, openaiKey, ...safeSettings } = settings; // never export API keys
  download(`food-tracker-backup-${today()}.json`,
    JSON.stringify({ app: 'food_tracker', version: 1, exportedAt: new Date().toISOString(), settings: safeSettings, entries }),
    'application/json');
  snackbar(`Backup saved (${entries.length} meals)`);
}

async function exportCsv() {
  const entries = (await DB.all()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['date', 'time', 'meal', 'item', 'grams', ...NUTRIENTS.map((n) => `${n.k}_${n.unit}`)].join(',')];
  for (const e of entries) {
    for (const it of e.items) {
      const n = itemNutrients(it);
      rows.push([e.date, e.time, e.meal, q(it.name), it.grams, ...NKEYS.map((k) => Math.round(n[k] * 100) / 100)].join(','));
    }
  }
  download(`food-tracker-${today()}.csv`, rows.join('\n'), 'text/csv');
  snackbar('CSV exported');
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'food_tracker' || !Array.isArray(data.entries)) throw new AppError("That isn't a Food Tracker backup file. Choose the .json file from Back up.");
    for (const e of data.entries) if (e && e.id && e.date && Array.isArray(e.items)) await DB.put(e);
    if (data.settings) {
      settings = { ...settings, ...data.settings, geminiKey: settings.geminiKey, openaiKey: settings.openaiKey,
        goals: { ...settings.goals, ...(data.settings.goals || {}) }, profile: { ...settings.profile, ...(data.settings.profile || {}) } };
      saveSettings();
    }
    snackbar(`Restored ${data.entries.length} meals`);
    renderSettings();
  } catch (err) {
    showError(err instanceof SyntaxError ? new AppError("Couldn't read that file. Choose the .json file from Back up.") : err);
  }
}

// ---------- Events ----------
function bindEvents() {
  // Navigation
  $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.tab)));
  $('#backBtn').addEventListener('click', closeReview);

  // Date navigation
  $('#prevDay').addEventListener('click', () => { currentDate = addDays(currentDate, -1); renderToday(); });
  $('#nextDay').addEventListener('click', () => { if (currentDate < today()) { currentDate = addDays(currentDate, 1); renderToday(); } });
  $('#datePicker').addEventListener('change', (e) => { if (e.target.value) { currentDate = e.target.value > today() ? today() : e.target.value; renderToday(); } });

  // Add food
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.action;
    if (a === 'camera') $('#cameraInput').click();
    if (a === 'gallery') $('#galleryInput').click();
    if (a === 'describe') { review = newReview(); openReview(); setTimeout(() => $('#addItemText').focus(), 60); }
  }));
  for (const id of ['#cameraInput', '#galleryInput']) {
    $(id).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; handleImageFile(f); });
  }

  // Meal list → edit
  $('#mealList').addEventListener('click', (e) => {
    const row = e.target.closest('.entry');
    if (row) editEntry(row.dataset.id);
  });

  // Review items
  const items = $('#reviewItems');
  items.addEventListener('input', (e) => {
    const card = e.target.closest('.item');
    if (!card || !review) return;
    if (e.target.classList.contains('item-grams')) setItemGrams(card, Number(e.target.value) || 0);
    if (e.target.classList.contains('item-name')) {
      const it = review.items.find((i) => i.id === card.dataset.id);
      if (it) it.name = e.target.value;
    }
  });
  items.addEventListener('click', (e) => {
    const card = e.target.closest('.item');
    const btn = e.target.closest('button');
    if (!card || !btn || !review) return;
    if (btn.classList.contains('remove')) {
      const idx = review.items.findIndex((i) => i.id === card.dataset.id);
      const [removed] = review.items.splice(idx, 1);
      haptic(10);
      renderReview();
      snackbar(`Removed ${removed.name}`, { action: { label: 'Undo', fn: () => { if (review) { review.items.splice(idx, 0, removed); renderReview(); } } } });
      return;
    }
    const input = $('.item-grams', card);
    const cur = Number(input.value) || 0;
    const step = cur >= 200 ? 25 : 10;
    const next = btn.classList.contains('plus') ? cur + step : Math.max(0, cur - step);
    input.value = next;
    haptic(5);
    setItemGrams(card, next);
  });

  $('#reviewHint').addEventListener('input', (e) => { if (review) review.hint = e.target.value; });
  $('#reviewHint').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPhotoAnalysis(); } });
  $('#reanalyse').addEventListener('click', runPhotoAnalysis);
  $('#addItemBtn').addEventListener('click', addTypedItem);
  $('#addItemText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTypedItem(); } });
  $('#reviewMeal').addEventListener('change', (e) => { if (review) review.meal = e.target.value; });
  $('#reviewDate').addEventListener('change', (e) => { if (review) review.date = e.target.value; });
  $('#reviewTime').addEventListener('change', (e) => { if (review) review.time = e.target.value; });
  $('#saveReview').addEventListener('click', () => saveReview().catch(showError));
  $('#deleteEntry').addEventListener('click', () => deleteEntry().catch(showError));

  // History
  $$('#view-history .seg button').forEach((b) => b.addEventListener('click', () => { historyRange = Number(b.dataset.range); renderHistory(); }));
  $('#dayList').addEventListener('click', (e) => {
    const d = e.target.closest('.day');
    if (d) { currentDate = d.dataset.date; showView('today'); }
  });

  // Settings
  $$('#providerSeg button').forEach((b) => b.addEventListener('click', () => { settings.provider = b.dataset.provider; saveSettings(); renderSettings(); }));
  $$('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const input = $(`#${b.dataset.reveal}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${b.dataset.reveal === 'geminiKey' ? 'Gemini' : 'OpenAI'} key`);
  }));
  const textSetting = (id, key, label) => $(id).addEventListener('change', (e) => { settings[key] = e.target.value.trim(); saveSettings(); snackbar(`${label} saved`); });
  textSetting('#geminiKey', 'geminiKey', 'Gemini key');
  textSetting('#geminiModel', 'geminiModel', 'Model');
  textSetting('#openaiKey', 'openaiKey', 'OpenAI key');
  textSetting('#openaiModel', 'openaiModel', 'Model');
  textSetting('#cuisine', 'cuisine', 'Cuisine');
  $('#goalInputs').addEventListener('change', (e) => {
    const k = e.target.dataset.goal;
    if (!k) return;
    const v = Number(e.target.value);
    if (!isFinite(v) || v < 0) { e.target.value = settings.goals[k]; snackbar('Enter a number of 0 or more.', { error: true }); return; }
    settings.goals[k] = v;
    saveSettings();
    snackbar(`${NMAP[k].label} goal saved`);
  });
  $('#calcGoals').addEventListener('click', () => {
    const p = {
      sex: $('#pSex').value,
      age: Number($('#pAge').value) || 30,
      height: Number($('#pHeight').value) || 170,
      weight: Number($('#pWeight').value) || 70,
      activity: Number($('#pActivity').value) || 1.375,
      target: $('#pTarget').value,
    };
    settings.profile = p;
    settings.goals = { ...settings.goals, ...calcGoals(p) };
    saveSettings();
    renderSettings();
    haptic(15);
    snackbar(`Goals updated: ${settings.goals.calories} kcal, ${settings.goals.protein} g protein per day`);
  });
  $('#testAI').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Testing…');
    try {
      const res = await analyse({ text: '1 medium banana' });
      const it = res.items[0];
      snackbar(it ? `Connected! ${it.name}: ${Math.round(itemNutrients(it).calories)} kcal` : 'Connected, but no food came back. Try again.');
      if (it) haptic(15);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  });
  $('#exportJson').addEventListener('click', () => exportJson().catch(showError));
  $('#exportCsv').addEventListener('click', () => exportCsv().catch(showError));
  $('#importJson').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });
  $('#clearAll').addEventListener('click', async () => {
    if (!confirm('Delete ALL logged meals from this phone? This cannot be undone. Back up first if unsure.')) return;
    await DB.clear();
    snackbar('All meals deleted');
  });

  // Refresh when the app comes back to the foreground (e.g. on a new day)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#view-today').classList.contains('active')) renderToday();
  });
}

// ---------- Start ----------
async function init() {
  try {
    await DB.open();
  } catch {
    snackbar("This browser can't store data. Open the app in Chrome.", { error: true });
    return;
  }
  bindEvents();
  showView('today', { focus: false });
  if (!settings.geminiKey && !settings.openaiKey) {
    setTimeout(() => snackbar('Add your free Gemini key to start analysing food.', { action: openSettingsAction }), 600);
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
