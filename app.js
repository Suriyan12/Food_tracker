'use strict';

/* =========================================================
   Food Tracker — photo-based calorie & nutrient tracker.
   All data lives on the device (IndexedDB + localStorage).
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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
const MEAL_ICONS = { Breakfast: '🍳', Lunch: '🍛', Snacks: '🍎', Dinner: '🍲' };

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
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { toast('Could not save settings', true); }
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
  if (Math.abs(v) >= 100) return String(Math.round(v));
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
const macroLine = (n) => `${Math.round(n.calories)} kcal · P ${num(n.protein)}g · C ${num(n.carbs)}g · F ${num(n.fat)}g`;

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2500);
}
function loading(on, text = 'Analysing your food…') {
  $('#loadingText').textContent = text;
  $('#loading').hidden = !on;
}

// ---------- Images ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
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

async function callGemini(prompt, imageDataUrl) {
  const key = settings.geminiKey.trim();
  if (!key) throw new Error('Add your Gemini API key in Settings first.');
  const parts = [{ text: prompt }];
  if (imageDataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageDataUrl.split(',')[1] } });
  const model = encodeURIComponent(settings.geminiModel.trim() || DEFAULT_SETTINGS.geminiModel);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini: ${j.error?.message || res.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function callOpenAI(prompt, imageDataUrl) {
  const key = settings.openaiKey.trim();
  if (!key) throw new Error('Add your OpenAI API key in Settings first.');
  const content = [{ type: 'text', text: prompt }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: settings.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI: ${j.error?.message || res.status}`);
  return j.choices?.[0]?.message?.content || '';
}

function parseAI(txt) {
  const s = String(txt).trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI gave an unexpected answer. Please try again.');
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('Could not read the AI answer. Please try again.'); }
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

// ---------- Navigation ----------
let currentDate = today();
let historyRange = 7;
const TITLES = { today: 'Food Tracker', review: 'Review meal', history: 'History', settings: 'Settings' };

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.body.classList.toggle('reviewing', name === 'review');
  $('#title').textContent = TITLES[name] || 'Food Tracker';
  window.scrollTo(0, 0);
  if (name === 'today') renderToday();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ---------- Today ----------
function barHTML(key, value) {
  const n = NMAP[key];
  const goal = Number(settings.goals[key]) || 0;
  const pct = goal ? Math.min(100, (value / goal) * 100) : 0;
  const warn = goal && value > goal && n.limit;
  const color = { protein: 'var(--protein)', carbs: 'var(--carbs)', fat: 'var(--fat)', fiber: 'var(--fiber)', sugar: 'var(--sugar)' }[key];
  const style = `width:${pct}%;${color && !warn ? `background:${color}` : ''}`;
  return `<div class="bar-row">
    <div class="bar-top"><span>${n.label}${n.limit ? ' <small class="muted">(limit)</small>' : ''}</span><span>${num(value)} / ${num(goal)} ${n.unit}</span></div>
    <div class="bar"><i class="${warn ? 'warn' : ''}" style="${style}"></i></div>
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
  $('#calEaten').textContent = Math.round(t.calories);
  $('#calGoalTxt').textContent = `of ${goal} kcal`;
  const left = Math.round(goal - t.calories);
  $('#calLeft').textContent = left >= 0 ? `${left} left` : `${-left} over`;

  $('#macroBars').innerHTML = MAIN_KEYS.map((k) => barHTML(k, t[k])).join('');
  $('#microTable').innerHTML = MICRO_KEYS.map((k) => barHTML(k, t[k])).join('');

  // Meals
  if (!entries.length) {
    $('#mealList').innerHTML = `<div class="card empty">No food logged ${currentDate === today() ? 'yet today' : 'on this day'}.<br>Tap <b>Snap food</b> to add your first meal.</div>`;
    return;
  }
  $('#mealList').innerHTML = MEALS.map((meal) => {
    const list = entries.filter((e) => e.meal === meal);
    if (!list.length) return '';
    const mt = dayTotals(list);
    return `<div class="card">
      <div class="meal-head"><h3>${MEAL_ICONS[meal]} ${meal}</h3><span>${Math.round(mt.calories)} kcal</span></div>
      ${list.map((e) => {
        const et = sumItems(e.items);
        const names = e.items.map((i) => i.name).join(', ') || 'Meal';
        return `<div class="entry" data-id="${esc(e.id)}">
          ${e.thumb ? `<img src="${e.thumb}" alt="">` : '<div class="noimg">🍽️</div>'}
          <div class="entry-body">
            <div class="entry-name">${esc(names)}</div>
            <div class="entry-sub">${esc(e.time)} · P ${num(et.protein)}g · C ${num(et.carbs)}g · F ${num(et.fat)}g</div>
          </div>
          <div class="entry-kcal">${Math.round(et.calories)}</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ---------- Review / edit ----------
let review = null; // { id, photo, thumb, items, meal, date, time, notes, isEdit }

function newReview(extra = {}) {
  const now = new Date();
  return {
    id: null,
    photo: null,
    thumb: null,
    items: [],
    notes: '',
    date: currentDate,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    meal: mealForHour(now.getHours()),
    isEdit: false,
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

function renderReview() {
  const r = review;
  const img = $('#reviewPhoto');
  img.hidden = !(r.photo || r.thumb);
  if (!img.hidden) img.src = r.photo || r.thumb;
  $('#hintBox').hidden = !r.photo;
  $('#reviewHint').value = r.hint || '';
  $('#reviewNotes').textContent = r.notes || '';
  $('#reviewMeal').value = r.meal;
  $('#reviewDate').value = r.date;
  $('#reviewDate').max = today();
  $('#reviewTime').value = r.time;
  $('#deleteEntry').hidden = !r.isEdit;
  $('#saveReview').textContent = r.isEdit ? 'Save changes' : 'Save meal';

  $('#reviewItems').innerHTML = r.items.length
    ? r.items.map((it) => `<div class="card item" data-id="${it.id}">
        <div class="item-head">
          <input class="item-name" value="${esc(it.name)}" aria-label="Food name">
          <button class="icon-btn remove" aria-label="Remove item">✕</button>
        </div>
        <div class="grams">
          <button class="icon-btn minus" aria-label="Less">−</button>
          <input class="item-grams" type="number" inputmode="decimal" min="1" value="${it.grams}" aria-label="Grams">
          <span>g</span>
          <button class="icon-btn plus" aria-label="More">+</button>
          ${it.confidence ? `<span class="tag ${it.confidence}">${it.confidence} confidence</span>` : ''}
        </div>
        <div class="item-macros">${macroLine(itemNutrients(it))}</div>
      </div>`).join('')
    : `<div class="card empty">${r.photo ? 'No food items yet. Try re-analysing, or add items by typing below.' : 'Type what you ate below, e.g. “2 chapati with dal and a bowl of curd”.'}</div>`;
  updateReviewTotal();
}

function updateReviewTotal() {
  const t = sumItems(review.items);
  $('#reviewTotal').textContent = macroLine(t);
}

function setItemGrams(card, grams) {
  const it = review.items.find((i) => i.id === card.dataset.id);
  if (!it) return;
  it.grams = Math.max(0, Math.round(grams));
  $('.item-macros', card).textContent = macroLine(itemNutrients(it));
  updateReviewTotal();
}

async function runPhotoAnalysis() {
  if (!review?.photo) return;
  loading(true);
  try {
    const res = await analyse({ imageDataUrl: review.photo, text: review.hint || '' });
    review.items = res.items;
    review.notes = res.notes;
    if (!res.items.length) toast('No food detected. Add details or type it.', true);
  } catch (err) {
    toast(err.message, true);
  } finally {
    loading(false);
    if (review) renderReview();
  }
}

async function handleImageFile(file) {
  if (!file) return;
  loading(true, 'Preparing photo…');
  try {
    const img = await loadImage(file);
    review = newReview({ photo: resizeImage(img, 1024, 0.85), thumb: resizeImage(img, 320, 0.7) });
  } catch (err) {
    loading(false);
    toast(err.message, true);
    return;
  }
  loading(false);
  openReview();
  await runPhotoAnalysis();
}

async function addTypedItem() {
  const input = $('#addItemText');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  loading(true, 'Estimating nutrition…');
  try {
    const res = await analyse({ text });
    if (!res.items.length) throw new Error('Could not recognise that food. Try describing it differently.');
    review.items.push(...res.items);
    input.value = '';
  } catch (err) {
    toast(err.message, true);
  } finally {
    loading(false);
    if (review) renderReview();
  }
}

async function saveReview() {
  const r = review;
  r.items = r.items.filter((i) => i.grams > 0);
  if (!r.items.length) { toast('Add at least one food item.', true); return; }
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
  currentDate = entry.date;
  toast(r.isEdit ? 'Meal updated' : `Saved · ${Math.round(sumItems(entry.items).calories)} kcal`);
  closeReview();
}

async function editEntry(id) {
  const e = await DB.get(id);
  if (!e) return;
  review = newReview({
    ...e,
    items: JSON.parse(JSON.stringify(e.items)),
    photo: null,
    isEdit: true,
  });
  openReview();
}

// ---------- History ----------
async function renderHistory() {
  $$('#view-history .seg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.range) === historyRange));
  const end = today();
  const start = addDays(end, -(historyRange - 1));
  const entries = await DB.range(start, end);
  const byDay = {};
  for (const e of entries) (byDay[e.date] ||= []).push(e);

  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const totals = days.map((d) => (byDay[d] ? dayTotals(byDay[d]) : null));
  const goal = Number(settings.goals.calories) || 0;

  // Bar chart (SVG)
  const W = 320, H = 150, padL = 4, padB = 18, padT = 8;
  const max = Math.max(goal, ...totals.map((t) => (t ? t.calories : 0)), 1) * 1.1;
  const bw = (W - padL) / days.length;
  const y = (v) => H - padB - ((H - padB - padT) * v) / max;
  const bars = days.map((d, i) => {
    const v = totals[i] ? totals[i].calories : 0;
    const x = padL + i * bw + bw * 0.15;
    const h = H - padB - y(v);
    return `<rect class="b ${goal && v > goal ? 'over' : ''}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2"><title>${prettyDate(d)}: ${Math.round(v)} kcal</title></rect>`;
  }).join('');
  const labelEvery = historyRange <= 7 ? 1 : historyRange <= 30 ? 7 : 15;
  const labels = days.map((d, i) => {
    if ((days.length - 1 - i) % labelEvery !== 0) return '';
    const dt = parseYmd(d);
    const txt = historyRange <= 7 ? dt.toLocaleDateString(undefined, { weekday: 'narrow' }) : `${dt.getDate()}/${dt.getMonth() + 1}`;
    return `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${txt}</text>`;
  }).join('');
  const goalLine = goal ? `<line class="goal" x1="0" x2="${W}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"></line>` : '';
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day">${bars}${goalLine}${labels}</svg>`;

  // Averages over logged days
  const logged = totals.filter(Boolean);
  const avg = (k) => (logged.length ? logged.reduce((s, t) => s + t[k], 0) / logged.length : 0);
  $('#avgStats').innerHTML = [
    ['Avg kcal', Math.round(avg('calories'))],
    ['Protein', `${num(avg('protein'))}g`],
    ['Carbs', `${num(avg('carbs'))}g`],
    ['Fat', `${num(avg('fat'))}g`],
  ].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('') +
    `<p class="muted small" style="grid-column:1/-1;margin:4px 0 0">${logged.length} of ${days.length} days logged · dashed line = goal</p>`;

  // Day list
  const loggedDays = days.filter((d) => byDay[d]).reverse();
  $('#dayList').innerHTML = loggedDays.length
    ? loggedDays.map((d) => {
        const t = dayTotals(byDay[d]);
        return `<div class="card day" data-date="${d}">
          <div><b>${prettyDate(d)}</b><small>${byDay[d].length} meal${byDay[d].length > 1 ? 's' : ''} · P ${num(t.protein)}g · C ${num(t.carbs)}g · F ${num(t.fat)}g</small></div>
          <b>${Math.round(t.calories)} kcal</b>
        </div>`;
      }).join('')
    : '<div class="card empty">No meals logged in this period yet.</div>';
}

// ---------- Settings ----------
function renderSettings() {
  $$('#providerSeg button').forEach((b) => b.classList.toggle('active', b.dataset.provider === settings.provider));
  $('#geminiBox').hidden = settings.provider !== 'gemini';
  $('#openaiBox').hidden = settings.provider !== 'openai';
  $('#geminiKey').value = settings.geminiKey;
  $('#geminiModel').value = settings.geminiModel;
  $('#openaiKey').value = settings.openaiKey;
  $('#openaiModel').value = settings.openaiModel;
  $('#cuisine').value = settings.cuisine;

  $('#goalInputs').innerHTML = GOAL_INPUT_KEYS.map((k) => `<label class="field">${NMAP[k].label} (${NMAP[k].unit})
      <input type="number" inputmode="decimal" min="0" data-goal="${k}" value="${settings.goals[k]}">
    </label>`).join('');

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
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'food_tracker' || !Array.isArray(data.entries)) throw new Error('This is not a Food Tracker backup file.');
    for (const e of data.entries) if (e && e.id && e.date && Array.isArray(e.items)) await DB.put(e);
    if (data.settings) {
      settings = { ...settings, ...data.settings, geminiKey: settings.geminiKey, openaiKey: settings.openaiKey,
        goals: { ...settings.goals, ...(data.settings.goals || {}) }, profile: { ...settings.profile, ...(data.settings.profile || {}) } };
      saveSettings();
    }
    toast(`Restored ${data.entries.length} meals`);
    renderSettings();
  } catch (err) {
    toast(err.message || 'Could not restore backup', true);
  }
}

// ---------- Events ----------
function bindEvents() {
  // Tabs
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.tab)));

  // Date navigation
  $('#prevDay').addEventListener('click', () => { currentDate = addDays(currentDate, -1); renderToday(); });
  $('#nextDay').addEventListener('click', () => { if (currentDate < today()) { currentDate = addDays(currentDate, 1); renderToday(); } });
  $('#datePicker').addEventListener('change', (e) => { if (e.target.value) { currentDate = e.target.value > today() ? today() : e.target.value; renderToday(); } });

  // Add food
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.action;
    if (a === 'camera') $('#cameraInput').click();
    if (a === 'gallery') $('#galleryInput').click();
    if (a === 'describe') { review = newReview(); openReview(); setTimeout(() => $('#addItemText').focus(), 50); }
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
    if (!card || !review) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('remove')) {
      review.items = review.items.filter((i) => i.id !== card.dataset.id);
      renderReview();
      return;
    }
    const input = $('.item-grams', card);
    const cur = Number(input.value) || 0;
    const step = cur >= 200 ? 25 : 10;
    const next = btn.classList.contains('plus') ? cur + step : Math.max(0, cur - step);
    input.value = next;
    setItemGrams(card, next);
  });

  $('#reviewHint').addEventListener('input', (e) => { if (review) review.hint = e.target.value; });
  $('#reanalyse').addEventListener('click', runPhotoAnalysis);
  $('#addItemBtn').addEventListener('click', addTypedItem);
  $('#addItemText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTypedItem(); } });
  $('#reviewMeal').addEventListener('change', (e) => { if (review) review.meal = e.target.value; });
  $('#reviewDate').addEventListener('change', (e) => { if (review) review.date = e.target.value; });
  $('#reviewTime').addEventListener('change', (e) => { if (review) review.time = e.target.value; });
  $('#cancelReview').addEventListener('click', closeReview);
  $('#saveReview').addEventListener('click', () => saveReview().catch((err) => toast(err.message, true)));
  $('#deleteEntry').addEventListener('click', async () => {
    if (!review?.id || !confirm('Delete this meal?')) return;
    await DB.del(review.id);
    toast('Meal deleted');
    closeReview();
  });

  // History
  $$('#view-history .seg button').forEach((b) => b.addEventListener('click', () => { historyRange = Number(b.dataset.range); renderHistory(); }));
  $('#dayList').addEventListener('click', (e) => {
    const d = e.target.closest('.day');
    if (d) { currentDate = d.dataset.date; showView('today'); }
  });

  // Settings
  $$('#providerSeg button').forEach((b) => b.addEventListener('click', () => { settings.provider = b.dataset.provider; saveSettings(); renderSettings(); }));
  const textSetting = (id, key) => $(id).addEventListener('change', (e) => { settings[key] = e.target.value.trim(); saveSettings(); toast('Saved'); });
  textSetting('#geminiKey', 'geminiKey');
  textSetting('#geminiModel', 'geminiModel');
  textSetting('#openaiKey', 'openaiKey');
  textSetting('#openaiModel', 'openaiModel');
  textSetting('#cuisine', 'cuisine');
  $('#goalInputs').addEventListener('change', (e) => {
    const k = e.target.dataset.goal;
    if (!k) return;
    settings.goals[k] = Math.max(0, Number(e.target.value) || 0);
    saveSettings();
    toast('Goal saved');
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
    toast(`Goal set to ${settings.goals.calories} kcal/day`);
  });
  $('#testAI').addEventListener('click', async () => {
    loading(true, 'Testing connection…');
    try {
      const res = await analyse({ text: '1 medium banana' });
      const it = res.items[0];
      toast(it ? `Works! ${it.name}: ${Math.round(itemNutrients(it).calories)} kcal` : 'Connected, but got no items back.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      loading(false);
    }
  });
  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importJson').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });
  $('#clearAll').addEventListener('click', async () => {
    if (!confirm('Delete ALL your logged meals? This cannot be undone.')) return;
    if (!confirm('Are you really sure? Export a backup first if unsure.')) return;
    await DB.clear();
    toast('All meals deleted');
  });

  // Refresh when the app comes back to the foreground on a new day
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#view-today').classList.contains('active')) renderToday();
  });
}

// ---------- Start ----------
async function init() {
  try {
    await DB.open();
  } catch {
    toast('Storage is unavailable in this browser.', true);
    return;
  }
  bindEvents();
  showView('today');
  if (!settings.geminiKey && !settings.openaiKey) {
    setTimeout(() => toast('Welcome! Add your free Gemini key in Settings to start.'), 600);
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
