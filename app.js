import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, update, remove, serverTimestamp, query, limitToLast, orderByChild, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const app = initializeApp({
  apiKey: "AIzaSyCwEc0C3hBaWeipnxIoGY_ugmtH1znuvZ4",
  authDomain: "pantrio-de.firebaseapp.com",
  databaseURL: "https://pantrio-de-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pantrio-de",
  storageBucket: "pantrio-de.firebasestorage.app",
  messagingSenderId: "491477233854",
  appId: "1:491477233854:web:7326836b414baa78442eef"
});

// App Check – verifies that requests come from this app, not from bots / stolen API key.
// Site Key is public by design (reCAPTCHA convention); the secret is only stored in Firebase Console.
// Must be initialized before getAuth / getDatabase so attached tokens reach all later requests.
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6Lfii9csAAAAAFT5tB43r5E2pTnh8EDCjWHbdBcj'),
  isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);
const db = getDatabase(app);

const APP_VERSION = '0.9.19';

// Register the service worker for PWA install + offline shell.
// Registered after Firebase init so the page is interactive first.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore – non-critical */ });
  });
}

// ─── EVENT DELEGATION ───
// Replaces inline-Handlers (onclick, oninput, ...) so we can ship strict CSP
// without 'unsafe-inline' on script-src. Pattern:
//   <button data-action="funcName">...</button>           → window.funcName()
//   <button data-action="funcName" data-arg="x">...       → window.funcName('x')
//   <input  data-input-action="funcName">                 → window.funcName(el.value) on input
//   <input  data-enter-action="funcName">                 → window.funcName() on Enter
//   <div    data-modal-overlay="modalId">                 → closeModal('modalId') on overlay-click
function callAction(name, arg, el){
  const fn = window[name];
  if (typeof fn !== 'function'){
    console.warn('[delegation] unknown action:', name);
    return;
  }
  return fn(arg, el);
}
// Helper actions for delegation (formerly inline-handler use cases)
window.removeParentRow = (_arg, el) => { if(el && el.parentElement) el.parentElement.remove(); };
window.openDayModalDelegated = (_arg, el) => {
  if (typeof window.openDayModal === 'function') window.openDayModal(el.dataset.day, el.dataset.meal);
};
window.selectPantryIngredientFromAttr = (_arg, el) => {
  try {
    const data = JSON.parse(el.getAttribute('data-payload') || '{}');
    if (typeof window.selectPantryIngredient === 'function') window.selectPantryIngredient(data);
  } catch(e){ console.warn('[delegation] payload parse failed:', e); }
};
document.addEventListener('click', (e) => {
  const overlay = e.target.closest('[data-modal-overlay]');
  if (overlay && e.target === overlay){
    const id = overlay.getAttribute('data-modal-overlay');
    if (typeof window.closeModal === 'function') window.closeModal(id);
    return;
  }
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.getAttribute('data-action');
  const arg = t.getAttribute('data-arg');
  callAction(action, arg === null ? undefined : arg, t);
});
document.addEventListener('input', (e) => {
  const t = e.target.closest('[data-input-action]');
  if (!t) return;
  callAction(t.getAttribute('data-input-action'), t.value, t);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest('[data-enter-action]');
  if (!t) return;
  callAction(t.getAttribute('data-enter-action'), undefined, t);
});

// ─── THEME ───
const THEME_KEY = 'pantrio.theme';
function setTheme(choice){
  // choice: 'light' | 'dark' | 'system'
  if(choice === 'system'){
    try { localStorage.removeItem(THEME_KEY); } catch(e){}
    document.documentElement.removeAttribute('data-theme');
  } else {
    try { localStorage.setItem(THEME_KEY, choice); } catch(e){}
    document.documentElement.setAttribute('data-theme', choice);
  }
  syncThemeSegment();
}
function effectiveTheme(){
  const attr = document.documentElement.getAttribute('data-theme');
  if(attr === 'light' || attr === 'dark') return attr;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function toggleTheme(){
  setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
}
function syncThemeSegment(){
  let active = 'system';
  try { const s = localStorage.getItem(THEME_KEY); if(s === 'light' || s === 'dark') active = s; } catch(e){}
  const seg = document.getElementById('theme-segment');
  if(seg){
    seg.querySelectorAll('[data-theme-choice]').forEach(btn => {
      const isActive = btn.dataset.themeChoice === active;
      btn.classList.toggle('btn-primary', isActive);
      btn.classList.toggle('btn-outline', !isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }
  const icon = document.getElementById('theme-toggle-icon');
  if(icon){
    // Show the icon for the action: when currently light, show 🌙 (click → dark); when dark, show ☀️
    icon.textContent = effectiveTheme() === 'dark' ? '☀️' : '🌙';
  }
}
window.setTheme = setTheme;
window.toggleTheme = toggleTheme;
if(window.matchMedia){
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeSegment); } catch(e){}
}

// ─── ENTER KEY LISTENERS ───
document.addEventListener('DOMContentLoaded', () => {
  syncThemeSegment();
  document.getElementById('login-email').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-password').focus(); });
  document.getElementById('login-password').addEventListener('keydown', e => { if(e.key==='Enter') window.login(); });
  document.getElementById('reg-password').addEventListener('keydown', e => { if(e.key==='Enter') window.register(); });
  document.getElementById('reg-name').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('reg-email').focus(); });
  document.getElementById('reg-email').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('reg-password').focus(); });
  document.getElementById('forgot-email').addEventListener('keydown', e => { if(e.key==='Enter') window.resetPassword(); });

  // Close pantry ingredient search on outside click
  document.addEventListener('click', e => {
    const results = document.getElementById('p-search-results');
    if(results && !results.contains(e.target) && e.target.id !== 'p-search'){
      results.classList.add('hidden');
    }
  });

  // Check if demo already expired on load
  if(localStorage.getItem(DEMO_EXPIRED_KEY)){
    showDemoExpiredLocked();
  }
});

// ─── STATE ───
let currentUser = null;
let familyId = null;
let familyData = null;
let pantry = {};
let recipes = {};
let shoppingList = {};
let weekPlan = {};
let staples = {}; // independent staples list
let editingRecipeId = null;
let activePantryCategory = 'Alle';
let activeRecipeFilter = 'Alle';
let pendingDaySlot = null;
let isDemoMode = false;

const DAYS = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
const MEALS = ['Frühstück','Mittag','Abend'];
const CAT_ICONS = { 'Gemüse & Obst':'🥦','Fleisch & Fisch':'🥩','Milchprodukte':'🧀','Trockenwaren':'🌾','Konserven':'🥫','Gewürze':'🧂','Getränke':'🥤','Sonstiges':'📦' };

// ─── DEMO DATA ───
const DEMO_PANTRY = {
  p1: { name:'Nudeln', emoji:'🍝', category:'Trockenwaren', amount:500, unit:'g', status:'ok' },
  p2: { name:'Tomaten', emoji:'🍅', category:'Gemüse & Obst', amount:4, unit:'Stück', status:'ok' },
  p3: { name:'Eier', emoji:'🥚', category:'Milchprodukte', amount:6, unit:'Stück', status:'low' },
  p4: { name:'Käse', emoji:'🧀', category:'Milchprodukte', amount:200, unit:'g', status:'ok' },
  p5: { name:'Zwiebeln', emoji:'🧅', category:'Gemüse & Obst', amount:3, unit:'Stück', status:'ok' },
  p6: { name:'Knoblauch', emoji:'🧄', category:'Gemüse & Obst', amount:1, unit:'Knolle', status:'ok' },
  p7: { name:'Olivenöl', emoji:'🫙', category:'Gewürze', amount:500, unit:'ml', status:'ok' },
  p8: { name:'Reis', emoji:'🍚', category:'Trockenwaren', amount:1000, unit:'g', status:'ok' },
  p9: { name:'Hähnchenbrust', emoji:'🍗', category:'Fleisch & Fisch', amount:400, unit:'g', status:'low' },
  p10: { name:'Sahne', emoji:'🥛', category:'Milchprodukte', amount:200, unit:'ml', status:'ok' },
  p11: { name:'Tomatenmark', emoji:'🥫', category:'Konserven', amount:1, unit:'Dose', status:'ok' },
  p12: { name:'Salz', emoji:'🧂', category:'Gewürze', amount:null, unit:null, status:'ok' },
  p13: { name:'Pfeffer', emoji:'🧂', category:'Gewürze', amount:null, unit:null, status:'ok' },
  p14: { name:'Parmesan', emoji:'🧀', category:'Milchprodukte', amount:100, unit:'g', status:'critical' },
};

const DEMO_RECIPES = {
  r1: {
    name:'Tomatenpasta', emoji:'🍝', category:'Hauptgericht', portions:4, prepTime:20, difficulty:'Einfach',
    description:'Ein schnelles und leckeres Klassiker-Gericht für die ganze Familie.',
    ingredients:[
      {name:'Nudeln',amount:400,unit:'g'},{name:'Tomaten',amount:4,unit:'Stück'},
      {name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Olivenöl',amount:3,unit:'EL'},
      {name:'Parmesan',amount:50,unit:'g'},{name:'Salz',amount:1,unit:'Prise'},
    ],
    steps:['Nudeln in Salzwasser kochen bis sie al dente sind.','Knoblauch fein hacken und in Olivenöl anbraten.','Tomaten würfeln und 10 Minuten köcheln lassen.','Nudeln abgießen, mit Sauce mischen und mit Parmesan servieren.']
  },
  r2: {
    name:'Shakshuka', emoji:'🍳', category:'Frühstück', portions:2, prepTime:25, difficulty:'Einfach',
    description:'Orientalisches Frühstück mit Eiern in würziger Tomatensauce.',
    ingredients:[
      {name:'Eier',amount:4,unit:'Stück'},{name:'Tomaten',amount:3,unit:'Stück'},
      {name:'Zwiebeln',amount:1,unit:'Stück'},{name:'Paprika',amount:1,unit:'Stück'},
      {name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Tomatenmark',amount:2,unit:'EL'},
      {name:'Kreuzkümmel',amount:1,unit:'TL'},
    ],
    steps:['Zwiebeln und Knoblauch in Öl glasig dünsten.','Tomaten und Tomatenmark hinzufügen, würzen.','10 Minuten köcheln, dann Mulden formen.','Eier in die Mulden schlagen, zudecken und stocken lassen.']
  },
  r3: {
    name:'Hähnchen-Sahne-Pasta', emoji:'🍗', category:'Hauptgericht', portions:4, prepTime:30, difficulty:'Mittel',
    description:'Cremige Pasta mit zartem Hähnchen – ein Familienklassiker.',
    ingredients:[
      {name:'Hähnchenbrust',amount:400,unit:'g'},{name:'Nudeln',amount:300,unit:'g'},
      {name:'Sahne',amount:200,unit:'ml'},{name:'Käse',amount:100,unit:'g'},
      {name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Olivenöl',amount:2,unit:'EL'},
    ],
    steps:['Hähnchen in Streifen schneiden und anbraten.','Knoblauch dazugeben, kurz mitbraten.','Mit Sahne ablöschen, Käse einrühren.','Gekochte Nudeln untermengen und servieren.']
  },
  r4: {
    name:'Reispfanne mit Gemüse', emoji:'🍱', category:'Hauptgericht', portions:3, prepTime:25, difficulty:'Einfach',
    description:'Schnelle Reispfanne – ideal für Reste.',
    ingredients:[
      {name:'Reis',amount:300,unit:'g'},{name:'Paprika',amount:1,unit:'Stück'},
      {name:'Zwiebeln',amount:1,unit:'Stück'},{name:'Sojasoße',amount:3,unit:'EL'},
      {name:'Eier',amount:2,unit:'Stück'},{name:'Olivenöl',amount:2,unit:'EL'},
    ],
    steps:['Reis kochen und abkühlen lassen.','Gemüse würfeln und in Öl scharf anbraten.','Reis dazugeben und mit Sojasoße würzen.','Eier verquirlen, in die Pfanne geben und verrühren.']
  },
  r5: {
    name:'Knoblauch-Käse-Toast', emoji:'🧀', category:'Snack', portions:2, prepTime:10, difficulty:'Einfach',
    description:'Perfekter schneller Snack oder Vorspeise.',
    ingredients:[
      {name:'Käse',amount:150,unit:'g'},{name:'Knoblauch',amount:2,unit:'Zehen'},
      {name:'Olivenöl',amount:2,unit:'EL'},{name:'Toastbrot',amount:4,unit:'Scheiben'},
    ],
    steps:['Brot toasten.','Knoblauch mit Olivenöl mischen und aufs Brot streichen.','Käse drauf und unter den Grill bis er schmilzt.']
  }
};

const DEMO_SHOPPING = {
  s1: { name:'Paprika', amount:2, unit:'Stück', category:'Gemüse & Obst', from:'Shakshuka', checked:false },
  s2: { name:'Sojasoße', amount:1, unit:'Flasche', category:'Konserven', from:'Reispfanne', checked:false },
  s3: { name:'Kreuzkümmel', amount:1, unit:'Päckchen', category:'Gewürze', from:'Shakshuka', checked:false },
  s4: { name:'Toastbrot', amount:1, unit:'Packung', category:'Trockenwaren', from:'Käse-Toast', checked:true },
};

const DEMO_WEEKPLAN = {
  'Montag':{ 'Mittag':'r1', 'Abend':'r3' },
  'Dienstag':{ 'Frühstück':'r2' },
  'Mittwoch':{ 'Mittag':'r4' },
  'Donnerstag':{ 'Abend':'r3' },
  'Freitag':{ 'Mittag':'r5', 'Abend':'r1' },
};

const DEMO_DURATION = 10 * 60; // 10 minutes in seconds
const DEMO_EXPIRED_KEY = 'pantrio_demo_expired';
let demoTimerInterval = null;

window.startDemo = () => {
  // Check if demo already expired
  if(localStorage.getItem(DEMO_EXPIRED_KEY)){
    showDemoExpiredLocked();
    return;
  }

  isDemoMode = true;
  currentUser = { uid: 'demo', displayName: 'Demo-Nutzer' };
  familyId = 'demo';
  familyData = { name: 'Musterfamilie', code: 'DEMO42', members: { demo: { name: 'Demo-Nutzer', role: 'admin' } } };
  pantry = JSON.parse(JSON.stringify(DEMO_PANTRY));
  recipes = JSON.parse(JSON.stringify(DEMO_RECIPES));
  shoppingList = JSON.parse(JSON.stringify(DEMO_SHOPPING));
  weekPlan = JSON.parse(JSON.stringify(DEMO_WEEKPLAN));

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('demo-banner').classList.remove('hidden');
  document.getElementById('demo-timer-badge').classList.remove('hidden');
  document.getElementById('fam-name-disp').textContent = familyData.name;
  document.getElementById('modal-code').textContent = familyData.code;
  document.getElementById('topbar-family-name').textContent = familyData.name;
  document.getElementById('fam-username').textContent = 'Demo-Nutzer';
  document.getElementById('fam-useremail').textContent = 'demo@pantrio.de';
  document.getElementById('fam-avatar').textContent = 'D';

  updateGreeting();
  renderPantry();
  renderRecipes();
  renderHome();
  renderShopping();
  buildWeekGrid();
  renderWeekGrid();
  renderFamilyMembers();

  document.getElementById('hc-recipes').textContent = Object.keys(recipes).length;
  document.getElementById('hc-shopping').textContent = Object.values(shoppingList).filter(i=>!i.checked).length;
  const weekTotal = Object.values(weekPlan).reduce((a,d)=>a+Object.keys(d||{}).length,0);
  document.getElementById('hc-week').textContent = weekTotal;

  // Start countdown
  let remaining = DEMO_DURATION;
  updateDemoTimer(remaining);
  demoTimerInterval = setInterval(()=>{
    remaining--;
    updateDemoTimer(remaining);
    // Turn badge orange in last 2 minutes
    const badge = document.getElementById('demo-timer-badge');
    if(remaining <= 60){
      badge.style.background = 'var(--red)';
      badge.style.borderColor = 'var(--red)';
      badge.style.animation = 'pulse 1s infinite';
    } else if(remaining <= 120){
      badge.style.background = '#d97706';
      badge.style.borderColor = '#F59E0B';
    }
    if(remaining <= 0){
      clearInterval(demoTimerInterval);
      demoTimerInterval = null;
      localStorage.setItem(DEMO_EXPIRED_KEY, '1');
      showDemoExpired();
    }
  }, 1000);
};

function updateDemoTimer(secs){
  const m = Math.floor(secs/60);
  const s = secs % 60;
  const el = document.getElementById('demo-timer');
  if(el) el.textContent = `${m}:${String(s).padStart(2,'0')}`;
}

function showDemoExpired(){
  // Stop all interaction
  document.getElementById('demo-expired-modal').classList.remove('hidden');
  isDemoMode = false;
}

function showDemoExpiredLocked(){
  // Show on auth screen directly
  const btn = document.getElementById('demo-btn');
  const hint = document.getElementById('demo-hint');
  if(btn){
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.cursor = 'not-allowed';
    btn.textContent = '🔒 Demo bereits genutzt';
  }
  if(hint) hint.textContent = 'Du hast die Demo bereits verwendet. Registriere dich kostenlos!';
}

window.goToRegisterFromDemo = () => {
  document.getElementById('demo-expired-modal').classList.add('hidden');
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  pantry={}; recipes={}; shoppingList={}; weekPlan={};
  switchAuthTab('register');
};

window.goToLoginFromDemo = () => {
  document.getElementById('demo-expired-modal').classList.add('hidden');
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  pantry={}; recipes={}; shoppingList={}; weekPlan={};
  switchAuthTab('login');
};

window.exitDemo = () => {
  if(demoTimerInterval){ clearInterval(demoTimerInterval); demoTimerInterval=null; }
  isDemoMode = false;
  currentUser = null; familyId = null; familyData = null;
  pantry = {}; recipes = {}; shoppingList = {}; weekPlan = {};
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('demo-banner').classList.add('hidden');
  document.getElementById('demo-banner').style.background = '';
  document.getElementById('demo-banner').style.borderColor = '';
  document.getElementById('demo-banner').style.color = '';
  const badge = document.getElementById('demo-timer-badge');
  badge.classList.add('hidden');
  badge.style.background = '';
  badge.style.borderColor = '';
  badge.style.animation = '';
  document.getElementById('auth-screen').style.display = 'flex';
};

function renderFamilyMembers() {
  const members = familyData?.members || {};
  const ul = document.getElementById('member-list');
  ul.innerHTML = '';
  Object.entries(members).forEach(([uid, m]) => {
    ul.innerHTML += `<li style="display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--green);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${esc((m.name||'?')[0].toUpperCase())}</div>
      <div style="flex:1"><div style="font-weight:600">${esc(m.name||'Unbekannt')} ${uid===currentUser.uid?'<span style="background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">Du</span>':''}</div>
      <div style="font-size:12px;color:var(--text2)">${m.role==='admin'?'👑 Admin':'👤 Mitglied'}</div></div></li>`;
  });
  const last = ul.querySelector('li:last-child');
  if (last) last.style.borderBottom = 'none';
}

// ─── AUTH ───
window.switchAuthTab = t => {
  ['login-form','register-form','forgot-form'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  const show = t==='login'?'login-form':t==='register'?'register-form':'forgot-form';
  document.getElementById(show).classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach((b,i)=>b.classList.toggle('active',(i===0&&t==='login')||(i===1&&t==='register')));
  document.getElementById('auth-error').classList.add('hidden');
};

function authErr(msg){ const e=document.getElementById('auth-error'); e.textContent=msg; e.classList.remove('hidden'); }

// ─── RATE LIMITING ───
const loginAttempts = { count:0, lockedUntil:0 };
let lockoutTimer = null;

function checkRateLimit(){
  if(Date.now() < loginAttempts.lockedUntil){
    showLockoutModal();
    return false;
  }
  return true;
}

function trackFailedLogin(){
  loginAttempts.count++;
  const remaining = 5 - loginAttempts.count;
  if(loginAttempts.count >= 5){
    loginAttempts.lockedUntil = Date.now() + 30000;
    loginAttempts.count = 0;
    showLockoutModal();
  } else {
    const e = document.getElementById('auth-error');
    e.textContent = `E-Mail oder Passwort falsch – noch ${remaining} Versuch${remaining===1?'':'e'} bis zur Sperre.`;
    e.classList.remove('hidden');
    // Get more urgent visually as attempts increase
    if(remaining === 1){
      e.style.background = '#fee2e2';
      e.style.color = '#b91c1c';
      e.style.fontWeight = '700';
      e.style.border = '1.5px solid #fca5a5';
    } else if(remaining === 2){
      e.style.background = '#fff3cd';
      e.style.color = '#92400e';
      e.style.fontWeight = '600';
      e.style.border = '1.5px solid #fcd34d';
    } else {
      e.style.background = '';
      e.style.color = '';
      e.style.fontWeight = '';
      e.style.border = '';
    }
  }
}

function showLockoutModal(){
  const modal = document.getElementById('lockout-modal');
  const secsEl = document.getElementById('lockout-seconds');
  const circle = document.getElementById('lockout-circle');
  const totalSecs = 30;
  const circumference = 327; // 2 * π * 52

  modal.classList.remove('hidden');

  // Disable login inputs
  document.getElementById('login-email').disabled = true;
  document.getElementById('login-password').disabled = true;
  document.querySelector('#login-form .btn-primary').disabled = true;
  document.querySelector('#login-form .btn-primary').style.opacity = '0.5';

  if(lockoutTimer) clearInterval(lockoutTimer);

  lockoutTimer = setInterval(()=>{
    const remaining = Math.max(0, Math.ceil((loginAttempts.lockedUntil - Date.now()) / 1000));
    secsEl.textContent = remaining;
    // Animate circle: goes from full to empty
    const progress = remaining / totalSecs;
    circle.style.strokeDashoffset = circumference * (1 - progress);

    if(remaining <= 0){
      clearInterval(lockoutTimer);
      lockoutTimer = null;
      modal.classList.add('hidden');
      // Re-enable inputs
      document.getElementById('login-email').disabled = false;
      document.getElementById('login-password').disabled = false;
      document.getElementById('login-password').value = '';
      document.getElementById('login-password').focus();
      document.querySelector('#login-form .btn-primary').disabled = false;
      document.querySelector('#login-form .btn-primary').style.opacity = '1';
      document.getElementById('auth-error').classList.add('hidden');
    }
  }, 200);
}

// ─── INPUT SANITIZATION ───
function sanitize(str){
  if(!str) return '';
  return String(str).replace(/[<>'"&]/g, c => ({'<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','&':'&amp;'}[c]));
}
// HTML-Escape am Render-Pfad – einzige Verteidigungslinie gegen XSS. Inputs werden roh gespeichert,
// das Escapen passiert ausschließlich beim Rendern. Niemals beim Speichern escapen, sonst Doppel-Escape.
const esc = sanitize;

// ─── PASSWORD STRENGTH ───
window.checkPasswordStrength = (pw) => {
  const fill = document.getElementById('pw-strength-fill');
  const label = document.getElementById('pw-strength-label');
  if(!pw){ fill.style.width='0%'; label.textContent=''; return; }
  let score = 0;
  if(pw.length >= 8) score++;
  if(pw.length >= 12) score++;
  if(/[A-Z]/.test(pw)) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    {w:'20%', color:'#ef4444', text:'Sehr schwach'},
    {w:'40%', color:'#f97316', text:'Schwach'},
    {w:'60%', color:'#eab308', text:'Mittel'},
    {w:'80%', color:'#84cc16', text:'Stark'},
    {w:'100%', color:'#22c55e', text:'Sehr stark'},
  ];
  const lvl = levels[Math.min(score, 4)];
  fill.style.width = lvl.w;
  fill.style.background = lvl.color;
  label.textContent = lvl.text;
  label.style.color = lvl.color;
};

window.login = async()=>{
  if(!checkRateLimit()) return;
  const email=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-password').value;
  if(!email||!pw){ authErr('Bitte alle Felder ausfüllen.'); return; }
  try{
    await signInWithEmailAndPassword(auth,email,pw);
    loginAttempts.count=0;
  } catch(e){
    trackFailedLogin();
    authErr(friendlyErr(e.code));
  }
};

window.register = async()=>{
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pw=document.getElementById('reg-password').value;
  if(!name||!email||!pw){ authErr('Bitte alle Felder ausfüllen.'); return; }
  if(pw.length < 8){ authErr('Passwort muss mindestens 8 Zeichen haben.'); return; }
  if(name.length < 2){ authErr('Name muss mindestens 2 Zeichen haben.'); return; }
  try{
    const c=await createUserWithEmailAndPassword(auth,email,pw);
    await updateProfile(c.user,{displayName:name});
    await update(ref(db,`users/${c.user.uid}`),{name,email,createdAt:Date.now()});
    bumpStat('userCount', +1);
    await sendEmailVerification(c.user);
  }catch(e){ authErr(friendlyErr(e.code)); }
};

window.resetPassword = async()=>{
  const email=document.getElementById('forgot-email').value.trim();
  if(!email){ authErr('Bitte E-Mail eingeben.'); return; }
  try{
    await sendPasswordResetEmail(auth,email);
    document.getElementById('forgot-success').classList.remove('hidden');
  } catch(e){ authErr(friendlyErr(e.code)); }
};

window.resendVerification = async()=>{
  if(auth.currentUser) await sendEmailVerification(auth.currentUser);
  document.getElementById('verify-banner').innerHTML = `<span>✅</span><span>E-Mail wurde gesendet! Bitte prüfe deinen Posteingang.</span>`;
};

window.logout = async()=>{
  document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.add('hidden'));
  await signOut(auth);
};

function friendlyErr(c){
  return {
    'auth/invalid-credential':'E-Mail oder Passwort falsch',
    'auth/email-already-in-use':'E-Mail bereits registriert',
    'auth/weak-password':'Passwort zu schwach (min. 8 Zeichen)',
    'auth/invalid-email':'Ungültige E-Mail-Adresse',
    'auth/user-not-found':'Kein Konto mit dieser E-Mail',
    'auth/too-many-requests':'Zu viele Versuche. Bitte später erneut versuchen.',
    'auth/network-request-failed':'Netzwerkfehler. Bitte Verbindung prüfen.'
  }[c]||'Fehler: '+c;
}

// ─── FAMILY ───
window.showCreateFamily=()=>{ document.getElementById('family-choice').classList.add('hidden'); document.getElementById('create-family-form').classList.remove('hidden'); };
window.showJoinFamily=()=>{ document.getElementById('family-choice').classList.add('hidden'); document.getElementById('join-family-form').classList.remove('hidden'); };
window.showFamilyChoice=()=>{ document.getElementById('family-choice').classList.remove('hidden'); document.getElementById('create-family-form').classList.add('hidden'); document.getElementById('join-family-form').classList.add('hidden'); };

function famErr(m){ const e=document.getElementById('family-error'); e.textContent=m; e.classList.remove('hidden'); }

// ─── STARTER RECIPES ───
const STARTER_RECIPES = [
  { name:'Tomatenpasta', emoji:'🍝', category:'Hauptgericht', portions:4, prepTime:20, difficulty:'Einfach',
    description:'Ein schneller Klassiker für die ganze Familie – in 20 Minuten auf dem Tisch.',
    ingredients:[{name:'Nudeln',amount:400,unit:'g'},{name:'Tomaten',amount:4,unit:'Stück'},{name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Olivenöl',amount:3,unit:'EL'},{name:'Parmesan',amount:50,unit:'g'},{name:'Salz',amount:1,unit:'Prise'}],
    steps:['Nudeln in Salzwasser al dente kochen.','Knoblauch fein hacken, in Olivenöl goldbraun anbraten.','Tomaten würfeln, dazugeben und 10 Min. köcheln lassen.','Nudeln abgießen, mit der Sauce mischen und mit Parmesan servieren.']
  },
  { name:'Rührei mit Toast', emoji:'🍳', category:'Frühstück', portions:2, prepTime:10, difficulty:'Einfach',
    description:'Das perfekte schnelle Frühstück – cremig, warm, sättigend.',
    ingredients:[{name:'Eier',amount:4,unit:'Stück'},{name:'Butter',amount:1,unit:'EL'},{name:'Milch',amount:2,unit:'EL'},{name:'Toastbrot',amount:4,unit:'Scheiben'},{name:'Salz',amount:1,unit:'Prise'},{name:'Pfeffer',amount:1,unit:'Prise'}],
    steps:['Eier mit Milch, Salz und Pfeffer verquirlen.','Butter in der Pfanne bei mittlerer Hitze schmelzen.','Eimasse hineingeben und langsam stocken lassen, dabei rühren.','Mit getoastetem Brot servieren.']
  },
  { name:'Gemüsesuppe', emoji:'🥣', category:'Hauptgericht', portions:4, prepTime:35, difficulty:'Einfach',
    description:'Wärmende Suppe aus saisonalem Gemüse – perfekt für jeden Tag.',
    ingredients:[{name:'Karotten',amount:3,unit:'Stück'},{name:'Kartoffeln',amount:3,unit:'Stück'},{name:'Zwiebeln',amount:1,unit:'Stück'},{name:'Sellerie',amount:2,unit:'Stangen'},{name:'Gemüsebrühe',amount:1,unit:'Liter'},{name:'Olivenöl',amount:2,unit:'EL'},{name:'Petersilie',amount:1,unit:'Bund'}],
    steps:['Gemüse schälen und in Würfel schneiden.','Zwiebeln in Öl glasig dünsten.','Gemüse und Brühe dazugeben, 25 Min. köcheln.','Mit Petersilie garnieren und servieren.']
  },
  { name:'Pfannkuchen', emoji:'🥞', category:'Frühstück', portions:4, prepTime:20, difficulty:'Einfach',
    description:'Klassische Pfannkuchen – süß oder herzhaft, immer ein Treffer.',
    ingredients:[{name:'Mehl',amount:200,unit:'g'},{name:'Eier',amount:2,unit:'Stück'},{name:'Milch',amount:300,unit:'ml'},{name:'Butter',amount:1,unit:'EL'},{name:'Salz',amount:1,unit:'Prise'},{name:'Zucker',amount:1,unit:'EL'}],
    steps:['Mehl, Eier, Milch, Zucker und Salz zu einem glatten Teig verrühren.','30 Min. ruhen lassen.','Butter in Pfanne erhitzen, Teig portionsweise hineingeben.','Goldbraun backen, wenden, fertigbacken.']
  },
  { name:'Hähnchen-Reis-Pfanne', emoji:'🍗', category:'Hauptgericht', portions:4, prepTime:30, difficulty:'Mittel',
    description:'Proteinreich, sättigend und schnell – ein Wochenabend-Favorit.',
    ingredients:[{name:'Hähnchenbrust',amount:500,unit:'g'},{name:'Reis',amount:300,unit:'g'},{name:'Paprika',amount:2,unit:'Stück'},{name:'Zwiebeln',amount:1,unit:'Stück'},{name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Olivenöl',amount:2,unit:'EL'},{name:'Paprikapulver',amount:1,unit:'TL'}],
    steps:['Reis nach Packungsanweisung kochen.','Hähnchen in Stücke schneiden, würzen und anbraten.','Gemüse würfeln, zum Hähnchen geben und mitbraten.','Reis untermengen, alles kurz zusammen schwenken.']
  },
  { name:'Bananenmilch-Smoothie', emoji:'🍌', category:'Frühstück', portions:2, prepTime:5, difficulty:'Einfach',
    description:'Cremiger Energie-Smoothie für den perfekten Start in den Tag.',
    ingredients:[{name:'Bananen',amount:2,unit:'Stück'},{name:'Milch',amount:300,unit:'ml'},{name:'Joghurt',amount:100,unit:'g'},{name:'Honig',amount:1,unit:'EL'}],
    steps:['Alle Zutaten in einen Mixer geben.','30 Sekunden auf höchster Stufe mixen.','In Gläser füllen und sofort servieren.']
  },
  { name:'Spaghetti Carbonara', emoji:'🍝', category:'Hauptgericht', portions:4, prepTime:25, difficulty:'Mittel',
    description:'Das Original aus Rom – cremig ohne Sahne, nur mit Ei und Käse.',
    ingredients:[{name:'Spaghetti',amount:400,unit:'g'},{name:'Speck',amount:150,unit:'g'},{name:'Eier',amount:3,unit:'Stück'},{name:'Parmesan',amount:80,unit:'g'},{name:'Knoblauch',amount:1,unit:'Zehe'},{name:'Pfeffer',amount:1,unit:'Prise'}],
    steps:['Spaghetti in Salzwasser al dente kochen.','Speck und Knoblauch in der Pfanne kross anbraten.','Eier und Parmesan zu einer Creme verrühren.','Heiße Nudeln vom Herd nehmen, Eicreme schnell unterrühren – nicht stocken lassen!']
  },
  { name:'Guacamole', emoji:'🥑', category:'Snack', portions:4, prepTime:10, difficulty:'Einfach',
    description:'Frischer Avocado-Dip – ideal zu Nachos oder als Brotaufstrich.',
    ingredients:[{name:'Avocados',amount:2,unit:'Stück'},{name:'Limette',amount:1,unit:'Stück'},{name:'Zwiebeln',amount:0.5,unit:'Stück'},{name:'Knoblauch',amount:1,unit:'Zehe'},{name:'Salz',amount:1,unit:'Prise'},{name:'Koriander',amount:1,unit:'Prise'}],
    steps:['Avocados halbieren, Kern entfernen, Fruchtfleisch herauslöffeln.','Mit einer Gabel grob zerdrücken.','Limettensaft, fein gehackte Zwiebel, Knoblauch und Gewürze unterrühren.','Abschmecken und sofort servieren.']
  },
  { name:'Overnight Oats', emoji:'🌙', category:'Frühstück', portions:1, prepTime:5, difficulty:'Einfach',
    description:'Vorbereitung am Abend, gesundes Frühstück am Morgen – ohne Kochen.',
    ingredients:[{name:'Haferflocken',amount:80,unit:'g'},{name:'Milch',amount:200,unit:'ml'},{name:'Joghurt',amount:100,unit:'g'},{name:'Banane',amount:1,unit:'Stück'},{name:'Honig',amount:1,unit:'EL'},{name:'Beeren',amount:50,unit:'g'}],
    steps:['Haferflocken, Milch und Joghurt in einem Glas vermischen.','Honig einrühren.','Über Nacht im Kühlschrank quellen lassen.','Am nächsten Morgen mit Früchten toppen.']
  },
  { name:'Tomatensuppe', emoji:'🍅', category:'Vorspeise', portions:4, prepTime:25, difficulty:'Einfach',
    description:'Samtig, aromatisch und wärmend – ein echter Klassiker.',
    ingredients:[{name:'Tomaten',amount:800,unit:'g'},{name:'Zwiebeln',amount:1,unit:'Stück'},{name:'Knoblauch',amount:2,unit:'Zehen'},{name:'Gemüsebrühe',amount:400,unit:'ml'},{name:'Olivenöl',amount:2,unit:'EL'},{name:'Basilikum',amount:1,unit:'Bund'},{name:'Sahne',amount:100,unit:'ml'}],
    steps:['Zwiebeln und Knoblauch in Öl andünsten.','Tomaten grob würfeln und dazugeben.','Brühe angießen, 15 Min. köcheln.','Pürieren, Sahne einrühren, mit Basilikum servieren.']
  },
];

async function seedStarterRecipes(fid) {
  const ts = Date.now();
  for(let i=0; i<STARTER_RECIPES.length; i++){
    const r = { ...STARTER_RECIPES[i], createdAt: ts+i, createdBy: currentUser.displayName, isStarter: true };
    await push(ref(db,`families/${fid}/recipes`), r);
  }
}

// Generate a cryptographically random invite code from an unambiguous alphabet.
// Default 12 chars from 32-char alphabet ≈ 60 bits entropy.
window.generateInviteCode = (len = 12) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  if (window.crypto && crypto.getRandomValues) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  } else {
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

window.createFamily = async()=>{
  const name=document.getElementById('family-name').value.trim();
  if(!name){ famErr('Bitte einen Namen eingeben.'); return; }
  const code=window.generateInviteCode();
  const fr=push(ref(db,'families'));
  await set(fr,{ name, code, createdBy:currentUser.uid, createdAt:Date.now(), members:{ [currentUser.uid]:{ name:currentUser.displayName, role:'admin', joinedAt:Date.now() } } });
  await set(ref(db,`users/${currentUser.uid}/familyId`),fr.key);
  await set(ref(db,`familyCodes/${code}`),fr.key);
  await update(ref(db,`users/${currentUser.uid}/families`),{ [fr.key]:{ name, role:'admin' } });
  await seedStarterRecipes(fr.key);
  bumpStat('familyCount', +1);
  familyId=fr.key; loadApp();
};

function bumpStat(key, delta){
  // Best-effort counter; Tampering möglich, aber Schaden begrenzt auf Stats-Anzeige.
  runTransaction(ref(db, `stats/${key}`), v => (typeof v === 'number' ? v : 0) + delta).catch(() => {});
}

window.joinFamily = async()=>{
  const code=document.getElementById('join-code').value.trim().toUpperCase();
  if(!code||code.length<4||code.length>24){ famErr('Bitte einen gültigen Einladungscode eingeben.'); return; }
  const snap=await get(ref(db,`familyCodes/${code}`));
  if(!snap.exists()){ famErr('Code nicht gefunden.'); return; }
  const fid=snap.val();
  await update(ref(db,`families/${fid}/members/${currentUser.uid}`),{name:currentUser.displayName,role:'member',joinedAt:Date.now(),joinCode:code});
  await set(ref(db,`users/${currentUser.uid}/familyId`),fid);
  familyId=fid; loadApp();
};

// ─── AUTH STATE ───
onAuthStateChanged(auth, async user=>{
  if(user){
    currentUser=user;
    document.getElementById('auth-screen').style.display='none';
    // Show email verification banner if not verified
    if(!user.emailVerified){
      document.getElementById('verify-banner').classList.remove('hidden');
    } else {
      document.getElementById('verify-banner').classList.add('hidden');
    }
    listenUserAuditLog();
    listenAdminStatus();
    listenSystemBanner();
    listenMarketplace();
    const snap=await get(ref(db,`users/${user.uid}/familyId`));
    if(snap.exists()){ familyId=snap.val(); loadApp(); }
    else{ document.getElementById('family-screen').classList.remove('hidden'); }
  } else {
    currentUser=null; familyId=null;
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('family-screen').classList.add('hidden');
    document.getElementById('app-screen').style.display='none';
  }
});

// ─── LOAD APP ───
function loadApp(){
  document.getElementById('family-screen').classList.add('hidden');
  document.getElementById('app-screen').style.display='block';
  updateGreeting();

  // Update account info in family page
  if(currentUser){
    const name = currentUser.displayName||'Nutzer';
    document.getElementById('fam-username').textContent = name;
    document.getElementById('fam-useremail').textContent = currentUser.email||'';
    document.getElementById('fam-avatar').textContent = name[0].toUpperCase();
  }

  // Ensure current family is in user's families list
  if(!isDemoMode && familyId){
    get(ref(db,`families/${familyId}/name`)).then(snap=>{
      const name = snap.val()||'Familie';
      get(ref(db,`families/${familyId}/members/${currentUser.uid}/role`)).then(rSnap=>{
        const role = rSnap.val()||'member';
        update(ref(db,`users/${currentUser.uid}/families`), { [familyId]:{ name, role } });
      });
    });

    // Seed starter recipes if family has none yet
    get(ref(db,`families/${familyId}/recipes`)).then(snap=>{
      if(!snap.exists()) seedStarterRecipes(familyId);
    });
  }

  listenFamily(); listenPantry(); listenRecipes(); listenShopping(); listenWeekPlan(); listenStaples(); listenAuditLog();
  buildWeekGrid();
  // Ensure the "Meine Familien" list on the family page is fresh, not stale, on first load.
  loadAllUserFamilies().then(()=>renderAllFamiliesList()).catch(()=>{});
}

function updateGreeting(){
  const h=new Date().getHours();
  const name=currentUser?.displayName?.split(' ')[0]||'';
  let g=h<12?'Guten Morgen':h<18?'Guten Mittag':'Guten Abend';
  document.getElementById('home-greeting-text').innerHTML=`${g}${name?', '+esc(name):''}! <br><em>Was kochst du heute?</em>`;
}

// ─── FAMILY LISTENER ───
let allUserFamilies = {}; // familyId -> {name, role}

function listenFamily(){
  onValue(ref(db,`families/${familyId}`),snap=>{
    if(!snap.exists()) return;
    familyData=snap.val();
    document.getElementById('topbar-family-name').textContent=familyData.name;
    document.getElementById('fam-name-disp').textContent=familyData.name;
    document.getElementById('modal-code').textContent=familyData.code;
    const isAdmin = familyData?.members?.[currentUser?.uid]?.role === 'admin';
    const rotBtn = document.getElementById('rotate-code-btn');
    if (rotBtn) rotBtn.style.display = isAdmin ? '' : 'none';
    // Danger-Zone: members see "Leave", admins see "Delete"
    const memberCount = Object.keys(familyData?.members||{}).length;
    const leaveBtn = document.getElementById('leave-family-btn');
    const deleteBtn = document.getElementById('delete-family-btn');
    const hint = document.getElementById('danger-zone-hint');
    if (leaveBtn && deleteBtn && hint) {
      if (isAdmin) {
        leaveBtn.classList.add('hidden');
        deleteBtn.classList.remove('hidden');
        hint.textContent = memberCount > 1
          ? `Achtung: damit verlieren alle ${memberCount} Mitglieder den Zugriff auf Vorrat, Rezepte, Wochenplan und Einkaufsliste.`
          : 'Diese Familie wird komplett entfernt. Diese Aktion kann nicht rückgängig gemacht werden.';
      } else {
        leaveBtn.classList.remove('hidden');
        deleteBtn.classList.add('hidden');
        hint.textContent = 'Du verlässt die Familie. Deine eigenen Daten in anderen Familien bleiben erhalten.';
      }
    }
    renderFamilyMembers();
    renderAllFamiliesList();
  });
}

const AUDIT_ACTION_LABELS = {
  'rotate-code':   { icon: '🔄', verb: 'hat den Einladungscode erneuert' },
  'leave-family':  { icon: '🚪', verb: 'hat die Familie verlassen' },
  'delete-recipe': { icon: '🗑',  verb: 'hat ein Rezept gelöscht' }
};

function formatRelativeTime(ts){
  if(!ts || typeof ts !== 'number') return '';
  const diff = Date.now() - ts;
  if(diff < 0) return 'gerade eben';
  const min = Math.floor(diff / 60000);
  if(min < 1) return 'gerade eben';
  if(min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if(h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if(d < 7) return `vor ${d} Tg`;
  return new Date(ts).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

function listenAuditLog(){
  if(!familyId || isDemoMode) return;
  const q = query(ref(db, `families/${familyId}/auditLog`), orderByChild('ts'), limitToLast(50));
  onValue(q, snap => {
    const list = document.getElementById('audit-log-list');
    if(!list) return;
    if(!snap.exists()){
      list.innerHTML = '<div style="font-size:13px;color:var(--text2);font-style:italic">Noch keine Aktivität.</div>';
      return;
    }
    const entries = [];
    snap.forEach(child => { entries.push(child.val()); });
    entries.reverse(); // neueste zuerst
    list.innerHTML = entries.map(e => {
      const label = AUDIT_ACTION_LABELS[e.action] || { icon: '•', verb: esc(e.action || 'unbekannt') };
      const who = esc(e.actorName || 'Jemand');
      const target = e.targetName ? ` <em style="color:var(--text2)">„${esc(e.targetName)}"</em>` : '';
      const when = formatRelativeTime(e.ts);
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--surface2);border-radius:8px;font-size:13px">
        <span style="font-size:16px;flex-shrink:0">${label.icon}</span>
        <div style="flex:1;min-width:0">
          <div><strong>${who}</strong> ${label.verb}${target}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(when)}</div>
        </div>
      </div>`;
    }).join('');
  }, err => {
    console.warn('[audit] read failed:', err?.message || err);
  });
}

// ─── SYSTEM BANNER ───
const BANNER_DISMISS_KEY = 'pantrio.bannerDismissed';

function listenSystemBanner(){
  onValue(ref(db, 'systemBanner'), snap => {
    const banner = snap.val();
    renderSystemBanner(banner);
  }, err => console.warn('[banner] read failed:', err?.message || err));
}

function renderSystemBanner(banner){
  const el = document.getElementById('system-banner');
  const txt = document.getElementById('system-banner-text');
  const ico = document.getElementById('system-banner-icon');
  if(!el || !txt) return;
  if(!banner || !banner.active || !banner.text){
    el.classList.add('hidden');
    return;
  }
  // Already dismissed (lokal nach updatedAt-Hash)?
  let dismissed = '';
  try { dismissed = localStorage.getItem(BANNER_DISMISS_KEY) || ''; } catch(e){}
  if(dismissed === String(banner.updatedAt || '')){
    el.classList.add('hidden');
    return;
  }
  txt.textContent = banner.text;
  if(banner.severity === 'warning'){
    el.style.background = '#fff3cd';
    el.style.borderBottom = '1px solid #ffc107';
    el.style.color = '#856404';
    if(ico) ico.textContent = '⚠';
  } else {
    el.style.background = '#dbeafe';
    el.style.borderBottom = '1px solid #3b82f6';
    el.style.color = '#1e40af';
    if(ico) ico.textContent = 'ℹ';
  }
  el.classList.remove('hidden');
}

window.dismissSystemBanner = async () => {
  try {
    const snap = await get(ref(db, 'systemBanner/updatedAt'));
    const ts = snap.val() || '';
    localStorage.setItem(BANNER_DISMISS_KEY, String(ts));
  } catch(e){}
  document.getElementById('system-banner').classList.add('hidden');
};

// ─── ADMIN ───
let isAdmin = false;
let adminFeedbackFilter = 'all';
let cachedFeedback = [];

const BOOTSTRAP_ADMIN_UID = 'ZntXAQlTABT5zKTsMHs9nwHVdpl1';

function listenAdminStatus(){
  if(!currentUser || isDemoMode){
    isAdmin = false;
    syncAdminUi();
    return;
  }
  // Bootstrap-Admin: identische UID-Whitelist wie in den Rules.
  if(currentUser.uid === BOOTSTRAP_ADMIN_UID){
    isAdmin = true;
    syncAdminUi();
    listenAdminFeedback();
    return;
  }
  onValue(ref(db, `admins/${currentUser.uid}`), snap => {
    isAdmin = snap.val() === true;
    syncAdminUi();
    if(isAdmin) listenAdminFeedback();
  }, err => {
    console.warn('[admin] read failed:', err?.message || err);
    isAdmin = false;
    syncAdminUi();
  });
}

function syncAdminUi(){
  const link = document.getElementById('admin-link-btn');
  if(link) link.classList.toggle('hidden', !isAdmin);
  const ver = document.getElementById('admin-version');
  if(ver) ver.textContent = APP_VERSION;
}

window.switchAdminTab = (tab) => {
  if(tab === 'stats') loadAdminStats();
  if(tab === 'system') loadAdminBanner();
  if(tab === 'marketplace') renderAdminMarketplace();
  ['feedback','stats','system','marketplace'].forEach(t => {
    const btn = document.getElementById(`admin-tab-${t}`);
    const content = document.getElementById(`admin-tab-content-${t}`);
    if(!btn || !content) return;
    const active = t === tab;
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--text)' : 'var(--text2)';
    btn.style.borderBottomColor = active ? 'var(--green)' : 'transparent';
    content.classList.toggle('hidden', !active);
  });
};

window.setFeedbackFilter = (filter) => {
  adminFeedbackFilter = filter;
  ['all','bug','wish','other'].forEach(f => {
    const btn = document.getElementById(`adm-fb-${f}`);
    if(!btn) return;
    const active = f === filter;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'var(--green)' : 'var(--surface)';
    btn.style.color = active ? 'white' : 'var(--text)';
  });
  renderAdminFeedback();
};

function listenAdminFeedback(){
  if(!isAdmin) return;
  const q = query(ref(db, 'feedback'), orderByChild('ts'), limitToLast(200));
  onValue(q, snap => {
    cachedFeedback = [];
    if(snap.exists()){
      snap.forEach(child => { cachedFeedback.push({ id: child.key, ...child.val() }); });
      cachedFeedback.reverse();
    }
    renderAdminFeedback();
  }, err => {
    console.warn('[admin-feedback] read failed:', err?.message || err);
  });
}

const FB_TYPE_LABELS = {
  'bug':   { icon: '🐞', label: 'Bug' },
  'wish':  { icon: '✨', label: 'Wunsch' },
  'other': { icon: '💬', label: 'Sonstiges' }
};
const FB_STATUS_LABELS = {
  'new':  { color: 'var(--red)',    label: 'Neu' },
  'read': { color: 'var(--orange)', label: 'Gelesen' },
  'done': { color: 'var(--green)',  label: 'Erledigt' }
};

function renderAdminFeedback(){
  const list = document.getElementById('admin-feedback-list');
  if(!list) return;
  const filtered = adminFeedbackFilter === 'all' ? cachedFeedback : cachedFeedback.filter(f => f.type === adminFeedbackFilter);
  if(filtered.length === 0){
    list.innerHTML = '<div style="font-size:13px;color:var(--text2);font-style:italic;padding:14px">Kein Feedback in dieser Kategorie.</div>';
    return;
  }
  list.innerHTML = filtered.map(f => {
    const type = FB_TYPE_LABELS[f.type] || { icon: '•', label: f.type };
    const status = FB_STATUS_LABELS[f.status] || FB_STATUS_LABELS.new;
    const when = formatRelativeTime(f.ts);
    const meta = [];
    if(f.userEmail) meta.push(esc(f.userEmail));
    if(f.version) meta.push('v' + esc(f.version));
    if(f.page) meta.push(esc(f.page));
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700">${type.icon} ${esc(type.label)}</div>
        <div style="font-size:11px;font-weight:700;color:${status.color}">${esc(status.label)}</div>
      </div>
      <div style="font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">${esc(f.message || '')}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${meta.join(' · ')}${meta.length ? ' · ' : ''}${esc(when)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${f.status !== 'read' ? `<button class="btn btn-outline btn-sm" data-action="setFeedbackStatus" data-id="${esc(f.id)}" data-status="read">Als gelesen markieren</button>` : ''}
        ${f.status !== 'done' ? `<button class="btn btn-outline btn-sm" data-action="setFeedbackStatus" data-id="${esc(f.id)}" data-status="done" style="border-color:var(--green);color:var(--green)">Als erledigt</button>` : ''}
        ${f.status !== 'new' ? `<button class="btn btn-outline btn-sm" data-action="setFeedbackStatus" data-id="${esc(f.id)}" data-status="new">Auf neu zurück</button>` : ''}
        <button class="btn btn-outline btn-sm" data-action="adminDeleteFeedback" data-arg="${esc(f.id)}" style="border-color:var(--red);color:var(--red)">🗑</button>
      </div>
    </div>`;
  }).join('');
}

window.setFeedbackStatus = (_arg, el) => {
  const id = el.getAttribute('data-id');
  const status = el.getAttribute('data-status');
  if(!id || !status) return;
  update(ref(db, `feedback/${id}`), { status }).catch(e => alert('Status-Update fehlgeschlagen: ' + (e?.message||e)));
};

async function loadAdminStats(){
  if(!isAdmin) return;
  const list = document.getElementById('admin-stats-list');
  if(!list) return;
  list.innerHTML = '<div style="font-size:13px;color:var(--text2);font-style:italic">Lädt…</div>';
  try {
    const [statsSnap, fbSnap] = await Promise.all([
      get(ref(db, 'stats')),
      get(query(ref(db, 'feedback'), orderByChild('ts'), limitToLast(500)))
    ]);
    const stats = statsSnap.val() || {};
    let feedbackTotal = 0, feedbackNew = 0;
    if(fbSnap.exists()){
      fbSnap.forEach(c => {
        feedbackTotal++;
        if(c.val()?.status === 'new') feedbackNew++;
      });
    }
    const card = (label, value, hint) => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:6px">${esc(label)}</div>
      <div style="font-size:28px;font-weight:900;font-family:'Fraunces',serif">${esc(String(value))}</div>
      ${hint ? `<div style="font-size:11px;color:var(--text2);margin-top:4px">${esc(hint)}</div>` : ''}
    </div>`;
    list.innerHTML = [
      card('Registrierte User', stats.userCount ?? '?', 'approx (Counter-Pfad)'),
      card('Familien', stats.familyCount ?? '?', 'approx'),
      card('Feedback gesamt', feedbackTotal, ''),
      card('Davon neu', feedbackNew, '🔴 ungelesen'),
      card('App-Version', APP_VERSION, ''),
      card('SW-Cache', 'pantrio-shell-v8', '')
    ].join('');
  } catch(e){
    list.innerHTML = `<div style="font-size:13px;color:var(--red);padding:14px">Stats-Read fehlgeschlagen: ${esc(e?.message||String(e))}</div>`;
  }
}

async function loadAdminBanner(){
  if(!isAdmin) return;
  try {
    const snap = await get(ref(db, 'systemBanner'));
    const b = snap.val() || {};
    const txt = document.getElementById('banner-text');
    const sev = document.getElementById('banner-severity');
    const act = document.getElementById('banner-active');
    if(txt) txt.value = b.text || '';
    if(sev) sev.value = b.severity || 'info';
    if(act) act.checked = b.active === true;
    const status = document.getElementById('banner-status');
    if(status){ status.classList.add('hidden'); status.textContent = ''; }
  } catch(e){
    console.warn('[banner-load] failed:', e);
  }
}

window.saveSystemBanner = async () => {
  if(!isAdmin) return;
  const text = (document.getElementById('banner-text').value || '').slice(0, 280);
  const severity = document.getElementById('banner-severity').value;
  const active = document.getElementById('banner-active').checked === true;
  const status = document.getElementById('banner-status');
  try {
    await set(ref(db, 'systemBanner'), {
      text, severity, active, updatedAt: Date.now()
    });
    if(status){
      status.classList.remove('hidden');
      status.style.background = 'var(--green-light)';
      status.style.color = 'var(--green)';
      status.textContent = '✓ Banner gespeichert.';
    }
    // Lokalen Dismiss-Cache zurücksetzen, damit der Admin den eigenen Banner sieht
    try { localStorage.removeItem(BANNER_DISMISS_KEY); } catch(e){}
  } catch(e){
    if(status){
      status.classList.remove('hidden');
      status.style.background = 'var(--red-light)';
      status.style.color = 'var(--red)';
      status.textContent = 'Speichern fehlgeschlagen: ' + (e?.message||e);
    }
  }
};

window.adminDeleteFeedback = async (id) => {
  if(!confirm('Feedback wirklich löschen?')) return;
  try {
    await remove(ref(db, `feedback/${id}`));
  } catch(e){
    alert('Löschen fehlgeschlagen: ' + (e?.message||e));
  }
};

function renderAdminMarketplace(){
  const list = document.getElementById('admin-marketplace-list');
  if(!list) return;
  if(!Array.isArray(marketplaceCache) || marketplaceCache.length === 0){
    list.innerHTML = '<div style="font-size:13px;color:var(--text2);font-style:italic;padding:14px">Der Marktplatz ist leer.</div>';
    return;
  }
  list.innerHTML = marketplaceCache.map(r => {
    const author = r.anonymous
      ? '<em style="color:var(--text2)">anonym</em>'
      : esc(r.publishedBy?.familyName || 'Familie') + (r.publishedBy?.userName ? ' <span style="color:var(--text2)">(' + esc(r.publishedBy.userName) + ')</span>' : '');
    const when = r.publishedAt ? formatRelativeTime(r.publishedAt) : '';
    const copies = typeof r.copies === 'number' ? r.copies : 0;
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:15px;font-weight:700">${esc(r.emoji || '🍽')} ${esc(r.name || '(ohne Name)')}</div>
        <div style="font-size:11px;font-weight:700;color:var(--text2)">📥 ${esc(String(copies))}x</div>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px">${esc(r.category || 'Sonstiges')} · von ${author}${when ? ' · ' + esc(when) : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" data-action="showMarketplaceDetail" data-arg="${esc(r.id)}">🔍 Ansehen</button>
        <button class="btn btn-outline btn-sm" data-action="adminDeleteMarketplace" data-arg="${esc(r.id)}" style="border-color:var(--red);color:var(--red)">🗑 Löschen</button>
      </div>
    </div>`;
  }).join('');
}

window.adminDeleteMarketplace = async (publishId) => {
  if(!isAdmin) return;
  const r = (marketplaceCache || []).find(x => x.id === publishId);
  const label = r ? `„${r.name || '(ohne Name)'}"` : 'diesen Eintrag';
  if(!confirm(`Marktplatz-Eintrag ${label} wirklich löschen? Bereits übernommene Kopien in anderen Familien bleiben unberührt.`)) return;
  try {
    await remove(ref(db, `publicRecipes/${publishId}`));
    if(typeof showPantryToast === 'function') showPantryToast('Vom Marktplatz entfernt.');
  } catch(e){
    alert('Löschen fehlgeschlagen: ' + (e?.message||e));
  }
};

// ─── FEEDBACK (User-Submission) ───
window.openFeedbackModal = () => {
  if(isDemoMode){ alert('Im Demo-Modus kannst du leider noch kein Feedback geben. Erstelle einen Account, um uns zu schreiben.'); return; }
  document.getElementById('feedback-message').value = '';
  document.getElementById('feedback-type').value = 'bug';
  const cc = document.getElementById('feedback-charcount');
  if(cc) cc.textContent = '0';
  const status = document.getElementById('feedback-status');
  if(status){ status.classList.add('hidden'); status.textContent = ''; }
  const btn = document.getElementById('feedback-submit-btn');
  if(btn){ btn.disabled = false; btn.textContent = 'Senden'; }
  document.getElementById('feedback-modal').classList.remove('hidden');
};

document.addEventListener('input', (e) => {
  if(e.target && e.target.id === 'feedback-message'){
    const cc = document.getElementById('feedback-charcount');
    if(cc) cc.textContent = String(e.target.value.length);
  }
});

window.submitFeedback = async () => {
  if(!currentUser || isDemoMode) return;
  const type = document.getElementById('feedback-type').value;
  const message = (document.getElementById('feedback-message').value || '').trim();
  const statusEl = document.getElementById('feedback-status');
  const btn = document.getElementById('feedback-submit-btn');
  if(message.length < 1){
    statusEl.classList.remove('hidden');
    statusEl.style.background = 'var(--red-light)';
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Bitte schreib uns wenigstens einen Satz.';
    return;
  }
  if(!['bug','wish','other'].includes(type)) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Sende…'; }
  try {
    const entry = {
      type,
      message: message.slice(0, 2000),
      userUid: currentUser.uid,
      userEmail: (currentUser.email || '').slice(0, 200),
      ts: serverTimestamp(),
      status: 'new',
      version: APP_VERSION,
      page: getCurrentPageId(),
      ua: (navigator.userAgent || '').slice(0, 300)
    };
    await push(ref(db, 'feedback'), entry);
    statusEl.classList.remove('hidden');
    statusEl.style.background = 'var(--green-light)';
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = '✓ Feedback gesendet. Vielen Dank!';
    setTimeout(() => {
      window.closeModal('feedback-modal');
    }, 1200);
  } catch(e){
    statusEl.classList.remove('hidden');
    statusEl.style.background = 'var(--red-light)';
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Senden fehlgeschlagen: ' + (e?.message || e);
    if(btn){ btn.disabled = false; btn.textContent = 'Senden'; }
  }
};

function getCurrentPageId(){
  const visible = document.querySelector('.page.active');
  return visible ? (visible.id || '') : '';
}

function listenUserAuditLog(){
  if(!currentUser || isDemoMode) return;
  const q = query(ref(db, `users/${currentUser.uid}/familyAuditLog`), orderByChild('ts'), limitToLast(50));
  onValue(q, snap => {
    const block = document.getElementById('user-audit-log-block');
    const list = document.getElementById('user-audit-log-list');
    if(!block || !list) return;
    if(!snap.exists()){
      block.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    const entries = [];
    snap.forEach(child => { entries.push(child.val()); });
    entries.reverse();
    block.classList.remove('hidden');
    list.innerHTML = entries.map(e => {
      const target = e.targetName ? esc(e.targetName) : 'Unbenannte Familie';
      const when = formatRelativeTime(e.ts);
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--surface2);border-radius:8px;font-size:13px">
        <span style="font-size:16px;flex-shrink:0">🗑</span>
        <div style="flex:1;min-width:0">
          <div><strong>${target}</strong> gelöscht</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(when)}</div>
        </div>
      </div>`;
    }).join('');
  }, err => {
    console.warn('[user-audit] read failed:', err?.message || err);
  });
}

async function logUserAudit(action, extra){
  if(!currentUser || isDemoMode) return;
  try {
    const entry = {
      action,
      actorUid: currentUser.uid,
      ts: serverTimestamp()
    };
    const name = currentUser.displayName;
    if (name) entry.actorName = name.slice(0, 80);
    if (extra && typeof extra === 'object'){
      if (extra.targetId) entry.targetId = String(extra.targetId).slice(0, 128);
      if (extra.targetName) entry.targetName = String(extra.targetName).slice(0, 200);
      if (extra.meta) entry.meta = String(extra.meta).slice(0, 500);
    }
    await push(ref(db, `users/${currentUser.uid}/familyAuditLog`), entry);
  } catch(e){
    console.warn('[user-audit] write failed:', e?.message || e);
  }
}

async function logAudit(fid, action, extra){
  if(!fid || !currentUser || isDemoMode) return;
  try {
    const entry = {
      action,
      actorUid: currentUser.uid,
      ts: serverTimestamp()
    };
    const name = currentUser.displayName;
    if (name) entry.actorName = name.slice(0, 80);
    if (extra && typeof extra === 'object'){
      if (extra.targetId) entry.targetId = String(extra.targetId).slice(0, 128);
      if (extra.targetName) entry.targetName = String(extra.targetName).slice(0, 200);
      if (extra.meta) entry.meta = String(extra.meta).slice(0, 500);
    }
    await push(ref(db, `families/${fid}/auditLog`), entry);
  } catch(e){
    console.warn('[audit] write failed:', e?.message || e);
  }
}

window.rotateInviteCode = async() => {
  if(!currentUser||!familyId||!familyData) return;
  if(familyData.members?.[currentUser.uid]?.role !== 'admin'){
    alert('Nur Admins können den Einladungscode erneuern.');
    return;
  }
  if(!confirm('Einladungscode wirklich erneuern? Der alte Code funktioniert danach nicht mehr.')) return;
  const oldCode = familyData.code;
  const newCode = window.generateInviteCode();
  try{
    await set(ref(db,`familyCodes/${newCode}`), familyId);
    await set(ref(db,`families/${familyId}/code`), newCode);
    if(oldCode && oldCode !== newCode){
      await remove(ref(db,`familyCodes/${oldCode}`));
    }
    await logAudit(familyId, 'rotate-code', { meta: 'code rotated' });
    if(typeof showPantryToast === 'function'){ showPantryToast('Neuer Code: '+newCode); }
    else { alert('Neuer Code: '+newCode); }
  } catch(e){
    alert('Code-Erneuerung fehlgeschlagen: '+(e?.message||e));
  }
};

// Switches the active family to the first remaining one in the user's cache,
// or back to the family-choice screen if none are left.
async function switchToFirstAvailableFamilyOrChoice(){
  await loadAllUserFamilies();
  const remaining = Object.keys(allUserFamilies).filter(fid => fid !== familyId);
  if (remaining.length > 0) {
    await switchToFamily(remaining[0]);
  } else {
    familyId = null;
    familyData = null;
    pantry = {}; recipes = {}; shoppingList = {}; weekPlan = {};
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('family-screen').classList.remove('hidden');
    showFamilyChoice();
  }
}

window.leaveFamily = async() => {
  if(!currentUser || !familyId || !familyData) return;
  const role = familyData?.members?.[currentUser.uid]?.role;
  if(role === 'admin'){
    alert('Als Admin kannst du diese Familie nicht verlassen, sondern nur löschen.');
    return;
  }
  if(!confirm(`„${familyData.name||'Familie'}" wirklich verlassen?\n\nDeine Beiträge in anderen Familien bleiben erhalten.`)) return;
  try{
    await logAudit(familyId, 'leave-family', { targetName: familyData.name || '' });
    await remove(ref(db,`families/${familyId}/members/${currentUser.uid}`));
    await remove(ref(db,`users/${currentUser.uid}/families/${familyId}`));
    if(typeof showPantryToast === 'function'){ showPantryToast('Familie verlassen.'); }
    await switchToFirstAvailableFamilyOrChoice();
  } catch(e){
    alert('Verlassen fehlgeschlagen: '+(e?.message||e));
  }
};

window.deleteFamily = async() => {
  if(!currentUser || !familyId || !familyData) return;
  if(familyData?.members?.[currentUser.uid]?.role !== 'admin'){
    alert('Nur Admins können die Familie löschen.');
    return;
  }
  const memberCount = Object.keys(familyData?.members||{}).length;
  const warning = memberCount > 1
    ? `„${familyData.name||'Familie'}" mit ${memberCount} Mitgliedern wirklich UNWIDERRUFLICH löschen?\n\nAlle Vorräte, Rezepte, Wochenpläne und Einkaufslisten gehen verloren. Mitglieder verlieren den Zugriff sofort.`
    : `„${familyData.name||'Familie'}" wirklich löschen?\n\nAlle Vorräte, Rezepte, Wochenpläne und Einkaufslisten gehen verloren.`;
  if(!confirm(warning)) return;
  // Second confirm – type the family name to confirm
  const expected = familyData.name || 'Familie';
  const typed = prompt(`Zur Bestätigung: tippe „${expected}" ein:`);
  if(typed !== expected){
    alert('Name stimmt nicht überein. Vorgang abgebrochen.');
    return;
  }
  const oldCode = familyData.code;
  const fid = familyId;
  const famName = familyData.name || '';
  try{
    // Order matters: audit log first (must outlive the family), then code, family, own user-cache.
    await logUserAudit('delete-family', { targetId: fid, targetName: famName });
    if(oldCode){
      try{ await remove(ref(db,`familyCodes/${oldCode}`)); } catch(_){ /* code may not exist */ }
    }
    await remove(ref(db,`families/${fid}`));
    bumpStat('familyCount', -1);
    await remove(ref(db,`users/${currentUser.uid}/families/${fid}`));
    if(typeof showPantryToast === 'function'){ showPantryToast('Familie gelöscht.'); }
    await switchToFirstAvailableFamilyOrChoice();
  } catch(e){
    alert('Löschen fehlgeschlagen: '+(e?.message||e));
  }
};

window.exportFamilyData = async() => {
  if(!currentUser || !familyId || !familyData){
    alert('Keine Familie aktiv – nichts zu exportieren.');
    return;
  }
  try{
    // Pull a fresh snapshot of the whole family node (rules require active membership – which we have).
    const snap = await get(ref(db,`families/${familyId}`));
    if(!snap.exists()){
      alert('Familiendaten konnten nicht gelesen werden.');
      return;
    }
    const fam = snap.val();
    const safeName = (fam.name||'familie').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') || 'familie';
    const today = new Date().toISOString().slice(0,10);
    const payload = {
      pantrioExport: {
        version: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: { uid: currentUser.uid, name: currentUser.displayName || null, email: currentUser.email || null },
        familyId: familyId
      },
      family: {
        name: fam.name || null,
        code: fam.code || null,
        createdAt: fam.createdAt || null,
        createdBy: fam.createdBy || null
      },
      members: fam.members || {},
      pantry: fam.pantry || {},
      staples: fam.staples || {},
      recipes: fam.recipes || {},
      weekPlan: fam.weekPlan || {},
      shoppingList: fam.shoppingList || {}
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pantrio-${safeName}-${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    if(typeof showPantryToast === 'function'){ showPantryToast('Export gestartet'); }
  } catch(e){
    alert('Export fehlgeschlagen: '+(e?.message||e));
  }
};

async function loadAllUserFamilies(){
  const snap = await get(ref(db,`users/${currentUser.uid}/families`));
  const cached = snap.exists() ? snap.val() : {};
  const validated = {};
  // Validate each cached entry against actual membership and self-heal stale entries.
  // Reads on /families/<fid> are blocked by RTDB rules unless we are members,
  // so a failing get() / missing member is the signal to drop the entry.
  await Promise.all(Object.keys(cached).map(async fid => {
    try{
      const fs = await get(ref(db,`families/${fid}`));
      const member = fs.exists() ? fs.val()?.members?.[currentUser.uid] : null;
      if(member){
        validated[fid] = {
          name: fs.val().name || cached[fid].name || 'Familie',
          role: member.role || cached[fid].role || 'member'
        };
      } else {
        // not a member anymore – clean up stale cache entry
        try{ await remove(ref(db,`users/${currentUser.uid}/families/${fid}`)); }catch(_){ }
      }
    } catch(_){
      // permission denied → not a member → drop cache entry
      try{ await remove(ref(db,`users/${currentUser.uid}/families/${fid}`)); }catch(_){ }
    }
  }));
  allUserFamilies = validated;
  // Always include the currently-active family (covers legacy users that only have familyId).
  if(familyId && !allUserFamilies[familyId]){
    allUserFamilies[familyId] = {
      name: familyData?.name || 'Familie',
      role: familyData?.members?.[currentUser.uid]?.role || 'member'
    };
  }
}

function renderAllFamiliesList(){
  // Update family page list
  const container = document.getElementById('all-families-list');
  if(!container) return;
  container.innerHTML = '';
  Object.entries(allUserFamilies).forEach(([fid, f])=>{
    const div = document.createElement('div');
    div.className = 'family-list-item' + (fid===familyId?' active':'');
    div.innerHTML = `
      <div style="width:36px;height:36px;border-radius:10px;background:${fid===familyId?'var(--green)':'var(--surface2)'};color:${fid===familyId?'white':'var(--text2)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏠</div>
      <div style="flex:1">
        <div class="fli-name">${esc(f.name||'Familie')}</div>
        <div class="fli-role">${f.role==='admin'?'👑 Admin':'👤 Mitglied'}${fid===familyId?' · Aktiv':''}</div>
      </div>
      ${fid!==familyId?`<button class="btn btn-secondary btn-sm" data-action="switchToFamily" data-arg="${fid}">Wechseln</button>`:'<span style="font-size:12px;color:var(--green);font-weight:700">✓</span>'}
    `;
    container.appendChild(div);
  });
}

window.switchToFamily = async(fid) => {
  if(fid===familyId) return;
  familyId = fid;
  await set(ref(db,`users/${currentUser.uid}/familyId`), fid);
  // Reset state
  pantry={}; recipes={}; shoppingList={}; weekPlan={};
  listenFamily(); listenPantry(); listenRecipes(); listenShopping(); listenWeekPlan();
  buildWeekGrid();
  showPage('home-page');
  closeModal('family-switcher-modal');
};

window.openFamilySwitcher = async() => {
  await loadAllUserFamilies();
  renderSwitcherFamilies();
  hideSwitcherForms();
  document.getElementById('switcher-error').classList.add('hidden');
  document.getElementById('family-switcher-modal').classList.remove('hidden');
};

function renderSwitcherFamilies(){
  const list = document.getElementById('switcher-families-list');
  list.innerHTML = '';
  Object.entries(allUserFamilies).forEach(([fid,f])=>{
    const div = document.createElement('div');
    div.className = 'family-list-item' + (fid===familyId?' active':'');
    div.innerHTML = `
      <div style="width:36px;height:36px;border-radius:10px;background:${fid===familyId?'var(--green)':'var(--surface2)'};color:${fid===familyId?'white':'var(--text2)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏠</div>
      <div style="flex:1">
        <div class="fli-name">${esc(f.name||'Familie')}</div>
        <div class="fli-role">${f.role==='admin'?'👑 Admin':'👤 Mitglied'}</div>
      </div>
      ${fid===familyId?'<span style="font-size:12px;color:var(--green);font-weight:700">Aktiv ✓</span>':`<button class="btn btn-secondary btn-sm" data-action="switchToFamily" data-arg="${fid}">Wechseln</button>`}
    `;
    list.appendChild(div);
  });
}

window.showSwitcherCreate = () => { hideSwitcherForms(); document.getElementById('switcher-create-form').classList.remove('hidden'); document.getElementById('switcher-add-section').classList.add('hidden'); };
window.showSwitcherJoin = () => { hideSwitcherForms(); document.getElementById('switcher-join-form').classList.remove('hidden'); document.getElementById('switcher-add-section').classList.add('hidden'); };
window.hideSwitcherForms = () => {
  document.getElementById('switcher-create-form').classList.add('hidden');
  document.getElementById('switcher-join-form').classList.add('hidden');
  document.getElementById('switcher-add-section').classList.remove('hidden');
};

window.createFamilyFromSwitcher = async() => {
  const name = document.getElementById('sw-family-name').value.trim();
  if(!name){ swErr('Bitte einen Namen eingeben.'); return; }
  const code = window.generateInviteCode();
  const fr = push(ref(db,'families'));
  const fid = fr.key;
  await set(fr,{ name, code, createdBy:currentUser.uid, createdAt:Date.now(), members:{ [currentUser.uid]:{ name:currentUser.displayName, role:'admin', joinedAt:Date.now() } } });
  await set(ref(db,`familyCodes/${code}`), fid);
  await update(ref(db,`users/${currentUser.uid}/families`), { [fid]:{ name, role:'admin' } });
  await seedStarterRecipes(fid);
  bumpStat('familyCount', +1);
  await switchToFamily(fid);
  closeModal('family-switcher-modal');
};

window.joinFamilyFromSwitcher = async() => {
  const code = document.getElementById('sw-join-code').value.trim().toUpperCase();
  if(!code||code.length<4||code.length>24){ swErr('Bitte einen gültigen Einladungscode eingeben.'); return; }
  const snap = await get(ref(db,`familyCodes/${code}`));
  if(!snap.exists()){ swErr('Code nicht gefunden. Bitte prüfen.'); return; }
  const fid = snap.val();
  if(allUserFamilies[fid]){ swErr('Du bist dieser Familie bereits beigetreten.'); return; }
  const famSnap = await get(ref(db,`families/${fid}/name`));
  const famName = famSnap.val()||'Familie';
  await update(ref(db,`families/${fid}/members/${currentUser.uid}`),{ name:currentUser.displayName, role:'member', joinedAt:Date.now(), joinCode:code });
  await update(ref(db,`users/${currentUser.uid}/families`), { [fid]:{ name:famName, role:'member' } });
  await switchToFamily(fid);
  closeModal('family-switcher-modal');
};

function swErr(msg){ const e=document.getElementById('switcher-error'); e.textContent=msg; e.classList.remove('hidden'); }

window.shareInviteCode = () => {
  const code = familyData?.code||'';
  if(navigator.share){
    navigator.share({ title:'Pantrio Einladung', text:`Tritt meiner Familie in Pantrio bei! Code: ${code}`, url: window.location.href });
  } else { showInviteModal(); }
};

// ─── PANTRY ───
function listenPantry(){
  onValue(ref(db,`families/${familyId}/pantry`),snap=>{
    pantry=snap.val()||{};
    renderPantry();
    renderHome();
    renderRecipes();
  });
}

window.toggleAddPantryForm=()=>{
  const f=document.getElementById('add-pantry-form');
  f.classList.toggle('hidden');
  if(!f.classList.contains('hidden')){
    document.getElementById('p-search').value='';
    document.getElementById('p-search-results').classList.add('hidden');
    document.getElementById('p-name').value='';
    document.getElementById('p-emoji').value='';
    document.getElementById('p-amount').value='';
    document.getElementById('p-unit').value='';
    document.getElementById('p-search').focus();
  }
};

window.searchPantryIngredients=(query)=>{
  const results = document.getElementById('p-search-results');
  if(!query.trim()){ results.classList.add('hidden'); return; }

  // Collect all unique ingredients from all recipes
  const seen = new Set();
  const matches = [];
  const q = query.toLowerCase().trim();

  // Already in pantry names for duplicate indicator
  const pantryNames = new Set(Object.values(pantry).map(p=>p.name.toLowerCase().trim()));

  Object.values(recipes).forEach(recipe=>{
    (recipe.ingredients||[]).forEach(ing=>{
      if(!ing.name) return;
      const key = ing.name.toLowerCase().trim();
      if(seen.has(key)) return;
      if(!key.includes(q)) return;
      seen.add(key);
      matches.push({ name:ing.name, unit:ing.unit||'', recipe:recipe.name, emoji:recipe.emoji||'📦', alreadyInPantry: pantryNames.has(key) });
    });
  });

  if(matches.length===0){
    results.innerHTML=`<div style="padding:12px 14px;font-size:13px;color:var(--text2)">Keine Treffer – manuell eingeben</div>`;
    results.classList.remove('hidden');
    return;
  }

  results.innerHTML = matches.slice(0,8).map(m=>`
    <div data-action="selectPantryIngredientFromAttr" data-payload="${JSON.stringify(m).replace(/"/g,'&quot;')}"
      style="padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.1s"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <span style="font-size:22px">${esc(m.emoji)}</span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${esc(m.name)} ${m.alreadyInPantry?'<span style="font-size:10px;background:var(--green-light);color:var(--green);padding:1px 6px;border-radius:10px;font-weight:700">schon vorhanden</span>':''}</div>
        <div style="font-size:11px;color:var(--text2)">aus ${esc(m.recipe)}${m.unit?' · '+esc(m.unit):''}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="var(--green)"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
    </div>
  `).join('');
  results.classList.remove('hidden');
};

window.selectPantryIngredient=(ing)=>{
  // Fill the manual form fields
  document.getElementById('p-name').value = ing.name;
  document.getElementById('p-unit').value = ing.unit||'';
  document.getElementById('p-search').value = ing.name;
  document.getElementById('p-search-results').classList.add('hidden');
  // Scroll to and focus amount field
  document.getElementById('p-amount').focus();
  document.getElementById('p-amount').scrollIntoView({behavior:'smooth',block:'nearest'});
};

window.savePantryItem=async()=>{
  const name=document.getElementById('p-name').value.trim();
  if(!name) return;
  const item={
    name,
    emoji:document.getElementById('p-emoji').value||'📦',
    category:document.getElementById('p-category').value,
    amount:parseFloat(document.getElementById('p-amount').value)||null,
    unit:document.getElementById('p-unit').value.trim()||null,
    status:document.getElementById('p-status').value,
    addedAt:Date.now()
  };
  if(isDemoMode){ const key='p'+Date.now(); pantry[key]=item; renderPantry(); renderHome(); renderRecipes(); }
  else await push(ref(db,`families/${familyId}/pantry`),item);
  document.getElementById('p-name').value='';
  document.getElementById('p-emoji').value='';
  document.getElementById('p-amount').value='';
  document.getElementById('p-unit').value='';
  document.getElementById('p-status').value='ok';
  document.getElementById('p-search').value='';
  document.getElementById('p-name').focus();
};

window.deletePantryItem=async(id)=>{
  const item = pantry[id];
  if(item) checkAndAddToShoppingFromStaples(item.name);
  if(isDemoMode){ delete pantry[id]; renderPantry(); renderHome(); renderRecipes(); return; }
  await remove(ref(db,`families/${familyId}/pantry/${id}`));
};

// Check if removed pantry item is on staples list → add to shopping
function checkAndAddToShoppingFromStaples(name){
  const match = Object.values(staples).find(s=>s.name.toLowerCase().trim()===name.toLowerCase().trim());
  if(!match) return;
  const key = 'staple_' + name.toLowerCase().replace(/[^a-z0-9äöüß]/g,'_');
  // Don't add if already on shopping list
  const alreadyThere = Object.values(shoppingList).some(i=>i.name.toLowerCase().trim()===name.toLowerCase().trim()&&!i.checked);
  if(alreadyThere) return;
  const shopItem = { name:match.name, amount:match.amount||null, unit:match.unit||'', category:match.category||'Sonstiges', from:'⭐ Stammliste', checked:false };
  if(isDemoMode){
    shoppingList[key] = shopItem;
    renderShopping();
  } else {
    update(ref(db,`families/${familyId}/shoppingList`),{[key]:shopItem});
  }
  // Show toast
  const toast=document.createElement('div');
  toast.style.cssText=`position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#92400e;color:white;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.2);z-index:300;white-space:nowrap;animation:slideUp 0.3s ease`;
  toast.textContent=`⭐ ${match.name} zur Einkaufsliste hinzugefügt`;
  document.body.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity='0'; toast.style.transition='opacity 0.4s'; setTimeout(()=>toast.remove(),400); },3000);
}

window.filterPantry=(q)=>renderPantry(q);

// ─── PANTRY TABS ───
let activePantryTab = 'stock';

window.switchPantryTab=(tab)=>{
  activePantryTab = tab;
  ['stock','staples','cook'].forEach(t=>{
    document.getElementById(`pantry-tab-${t}`).classList.toggle('hidden', t!==tab);
    document.getElementById(`ptab-${t}`).classList.toggle('active', t===tab);
  });
  if(tab==='staples') renderStaples();
  if(tab==='cook') renderCookMode();
};

// ─── RENDER PANTRY (grouped by category) ───
window.resetPantryFilter = () => { activePantryCategory='Alle'; renderPantry(''); };
window.resetRecipeFilter = () => { activeRecipeFilter='Alle'; renderRecipes(''); };

function renderPantry(search=''){
  const list=document.getElementById('pantry-list');
  const cats=new Set(['Alle']);
  Object.values(pantry).forEach(p=>p.category&&cats.add(p.category));

  const cf=document.getElementById('pantry-cat-filters');
  cf.innerHTML='';
  cats.forEach(c=>{
    const ch=document.createElement('button');
    ch.className='cat-chip'+(c===activePantryCategory?' active':'');
    ch.textContent=c; ch.onclick=()=>{ activePantryCategory=c; renderPantry(search); };
    cf.appendChild(ch);
  });

  let items=Object.entries(pantry);
  if(activePantryCategory!=='Alle') items=items.filter(([,p])=>p.category===activePantryCategory);
  if(search){ const s=search.toLowerCase(); items=items.filter(([,p])=>p.name?.toLowerCase().includes(s)); }

  const total=Object.keys(pantry).length;
  document.getElementById('pantry-count-badge').textContent=`${total} Vorräte`;
  document.getElementById('hc-pantry').textContent=total;

  if(items.length===0){
    if(total===0){
      list.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🥕</div><h3>Dein Vorrat ist noch leer</h3><p>Trag ein, was du zuhause hast – damit Pantrio dir passende Rezepte vorschlagen kann.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" data-action="toggleAddPantryForm">＋ Vorrat hinzufügen</button></div></div>`;
    } else {
      const hasFilter=activePantryCategory!=='Alle'||search;
      list.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🔍</div><h3>Nichts in dieser Kategorie</h3><p>Du hast Vorräte in anderen Kategorien.</p><div class="empty-state-actions"><button class="btn btn-ghost" type="button" data-action="resetPantryFilter">Alle anzeigen</button></div></div>`;
    }
    return;
  }

  // Group by category
  const groups={};
  items.forEach(([id,p])=>{
    const cat=p.category||'Sonstiges';
    if(!groups[cat]) groups[cat]=[];
    groups[cat].push([id,p]);
  });

  list.innerHTML='';
  Object.entries(groups).forEach(([cat,entries])=>{
    const section=document.createElement('div');
    section.style.cssText='margin-bottom:16px';
    section.innerHTML=`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:8px;display:flex;align-items:center;gap:6px">${CAT_ICONS[cat]||'📦'} ${esc(cat)} <span style="background:var(--surface2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px">${entries.length}</span></div>`;
    entries.forEach(([id,p])=>{
      const div=document.createElement('div');
      div.className='pantry-item';
      div.innerHTML=`
        <div class="pantry-item-emoji">${esc(p.emoji||'📦')}</div>
        <div class="pantry-item-info">
          <div class="pantry-item-name">${esc(p.name)}</div>
          <div class="pantry-item-amount">${p.amount?esc(p.amount)+' '+esc(p.unit||''):''}${p.amount&&p.category?' · ':''}${esc(p.category||'')}</div>
        </div>
        <div class="status-dot status-${esc(p.status||'ok')}"></div>
        <div class="pantry-item-actions">
          <button class="icon-btn delete" data-action="deletePantryItem" data-arg="${id}">×</button>
        </div>`;
      section.appendChild(div);
    });
    list.appendChild(section);
  });
}

// ─── STAPLES ───
function listenStaples(){
  if(isDemoMode) return;
  onValue(ref(db,`families/${familyId}/staples`),snap=>{
    staples = snap.val()||{};
    if(activePantryTab==='staples') renderStaples();
  });
}

window.toggleStapleForm=()=>{
  const f=document.getElementById('add-staple-form');
  f.classList.toggle('hidden');
  if(!f.classList.contains('hidden')){
    document.getElementById('st-name').value='';
    document.getElementById('st-emoji').value='';
    document.getElementById('st-amount').value='';
    document.getElementById('st-unit').value='';
    document.getElementById('st-name').focus();
  }
};

window.saveStaple=async()=>{
  const name=document.getElementById('st-name').value.trim();
  if(!name) return;
  const item={
    name,
    emoji:document.getElementById('st-emoji').value||'📦',
    category:document.getElementById('st-category').value,
    amount:parseFloat(document.getElementById('st-amount').value)||null,
    unit:document.getElementById('st-unit').value.trim()||null,
    addedAt:Date.now()
  };
  if(isDemoMode){
    staples['st'+Date.now()]=item;
    renderStaples();
  } else {
    await push(ref(db,`families/${familyId}/staples`),item);
  }

  // Check if already in pantry – if not, add to shopping list automatically
  const inPantry=Object.values(pantry).some(p=>p.name.toLowerCase().trim()===name.toLowerCase().trim());
  if(!inPantry){
    const alreadyInShop=Object.values(shoppingList).some(i=>i.name.toLowerCase().trim()===name.toLowerCase().trim()&&!i.checked);
    if(!alreadyInShop){
      const key='staple_'+name.toLowerCase().replace(/[^a-z0-9äöüß]/g,'_');
      const shopItem={ name:item.name, amount:item.amount||null, unit:item.unit||'', category:item.category||'Sonstiges', from:'⭐ Stammliste', checked:false };
      if(isDemoMode){ shoppingList[key]=shopItem; renderShopping(); }
      else await update(ref(db,`families/${familyId}/shoppingList`),{[key]:shopItem});
      showPantryToast(1);
    }
  }

  toggleStapleForm();
};

window.deleteStaple=async(id)=>{
  if(isDemoMode){ delete staples[id]; renderStaples(); return; }
  await remove(ref(db,`families/${familyId}/staples/${id}`));
};

function renderStaples(){
  const list=document.getElementById('staples-list');
  const countLabel=document.getElementById('staples-count-label');
  const entries=Object.entries(staples);
  if(countLabel) countLabel.textContent=`${entries.length} Artikel`;

  if(entries.length===0){
    list.innerHTML=`<div class="empty-state"><div class="ei">⭐</div><h3>Stammliste ist leer</h3><p>Füge Artikel hinzu die du immer zuhause haben möchtest – z.B. Olivenöl, Salz, Nudeln.</p></div>`;
    return;
  }

  // Group by category
  const groups={};
  entries.forEach(([id,s])=>{
    const cat=s.category||'Sonstiges';
    if(!groups[cat]) groups[cat]=[];
    groups[cat].push([id,s]);
  });

  list.innerHTML='';
  Object.entries(groups).forEach(([cat,items])=>{
    const header=document.createElement('div');
    header.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:8px;margin-top:14px;display:flex;align-items:center;gap:6px';
    header.innerHTML=`${CAT_ICONS[cat]||'📦'} ${esc(cat)} <span style="background:var(--surface2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px">${items.length}</span>`;
    list.appendChild(header);
    items.forEach(([id,s])=>{
      // Check if currently in pantry
      const inPantry=Object.values(pantry).some(p=>p.name.toLowerCase().trim()===s.name.toLowerCase().trim());
      const div=document.createElement('div');
      div.className='staple-item';
      div.innerHTML=`
        <span class="star">⭐</span>
        <span style="font-size:22px">${esc(s.emoji||'📦')}</span>
        <div style="flex:1">
          <div style="font-weight:600;display:flex;align-items:center;gap:6px">
            ${esc(s.name)}
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;background:${inPantry?'var(--green-light)':'var(--red-light)'};color:${inPantry?'var(--green)':'var(--red)'}">
              ${inPantry?'✓ Im Vorrat':'✗ Fehlt'}
            </span>
          </div>
          <div style="font-size:12px;color:var(--text2)">${s.amount?esc(s.amount)+' '+esc(s.unit||''):''}${s.amount&&s.category?' · ':''}${esc(s.category||'')}</div>
        </div>
        <div style="display:flex;gap:6px">
          ${!inPantry?`<button class="icon-btn" data-action="addStapleToShopManual" data-arg="${id}" title="Zur Einkaufsliste" style="color:var(--green)">🛒</button>`:''}
          <button class="icon-btn delete" data-action="deleteStaple" data-arg="${id}">×</button>
        </div>
      `;
      list.appendChild(div);
    });
  });
}

window.addStapleToShopManual=async(id)=>{
  const s=staples[id]; if(!s) return;
  const key='staple_'+s.name.toLowerCase().replace(/[^a-z0-9äöüß]/g,'_');
  const alreadyThere=Object.values(shoppingList).some(i=>i.name.toLowerCase().trim()===s.name.toLowerCase().trim()&&!i.checked);
  if(alreadyThere){ showPantryToast2(0); return; }
  const shopItem={ name:s.name, amount:s.amount||null, unit:s.unit||'', category:s.category||'Sonstiges', from:'⭐ Stammliste', checked:false };
  if(isDemoMode){ shoppingList[key]=shopItem; renderShopping(); }
  else await update(ref(db,`families/${familyId}/shoppingList`),{[key]:shopItem});
  showPantryToast(1);
  renderStaples();
};

// ─── COOK MODE ───
let cookChecked = new Set();

function renderCookMode(){
  const list=document.getElementById('cook-list');
  const actions=document.getElementById('cook-actions');
  const items=Object.entries(pantry);

  cookChecked = new Set(); // reset on open
  actions.classList.add('hidden');

  if(items.length===0){
    list.innerHTML=`<div class="empty-state"><div class="ei">🍳</div><h3>Kein Vorrat vorhanden</h3><p>Füge zuerst Zutaten zum Vorrat hinzu.</p></div>`;
    return;
  }

  // Group by category
  const groups={};
  items.forEach(([id,p])=>{
    const cat=p.category||'Sonstiges';
    if(!groups[cat]) groups[cat]=[];
    groups[cat].push([id,p]);
  });

  list.innerHTML='';
  Object.entries(groups).forEach(([cat,entries])=>{
    const header=document.createElement('div');
    header.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:6px;margin-top:14px;display:flex;align-items:center;gap:6px';
    header.innerHTML=`${CAT_ICONS[cat]||'📦'} ${esc(cat)}`;
    list.appendChild(header);

    entries.forEach(([id,p])=>{
      const div=document.createElement('div');
      div.className='cook-item';
      div.id=`cook-${id}`;
      div.innerHTML=`
        <div class="checkbox" id="cook-cb-${id}"></div>
        <span style="font-size:22px">${esc(p.emoji||'📦')}</span>
        <div style="flex:1">
          <div class="cook-name" style="font-weight:600">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--text2)">${p.amount?esc(p.amount)+' '+esc(p.unit||''):'Menge nicht angegeben'}</div>
        </div>
      `;
      div.onclick=()=>toggleCookItem(id);
      list.appendChild(div);
    });
  });
}

function toggleCookItem(id){
  const div=document.getElementById(`cook-${id}`);
  const cb=document.getElementById(`cook-cb-${id}`);
  if(cookChecked.has(id)){
    cookChecked.delete(id);
    div.classList.remove('cooked');
    cb.innerHTML='';
    cb.style.background='';
    cb.style.borderColor='';
  } else {
    cookChecked.add(id);
    div.classList.add('cooked');
    cb.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`;
    cb.style.background='var(--red)';
    cb.style.borderColor='var(--red)';
  }
  document.getElementById('cook-actions').classList.toggle('hidden', cookChecked.size===0);
}

window.clearCookChecked=async(doRemove)=>{
  if(!doRemove){ cookChecked.clear(); renderCookMode(); return; }
  if(cookChecked.size===0) return;
  const count=cookChecked.size;
  // Check staples for each removed item
  cookChecked.forEach(id=>{ const item=pantry[id]; if(item) checkAndAddToShoppingFromStaples(item.name); });
  if(isDemoMode){
    cookChecked.forEach(id=>delete pantry[id]);
    renderPantry(); renderHome(); renderRecipes();
  } else {
    await Promise.all([...cookChecked].map(id=>remove(ref(db,`families/${familyId}/pantry/${id}`))));
  }
  cookChecked.clear();
  renderCookMode();
  showPantryToast2(count);
};

function showPantryToast2(count){
  const existing=document.getElementById('pantry-toast');
  if(existing) existing.remove();
  const toast=document.createElement('div');
  toast.id='pantry-toast';
  toast.style.cssText=`position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--red);color:white;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(232,93,79,0.4);z-index:300;white-space:nowrap;animation:slideUp 0.3s ease`;
  toast.textContent=`🍳 ${count} Zutat${count===1?'':'en'} als verbraucht entfernt`;
  document.body.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity='0'; toast.style.transition='opacity 0.4s'; setTimeout(()=>toast.remove(),400); },3000);
}

// ─── RECIPES ───
function listenRecipes(){
  onValue(ref(db,`families/${familyId}/recipes`),snap=>{
    recipes=snap.val()||{};
    renderRecipes();
    renderHome();
    document.getElementById('hc-recipes').textContent=Object.keys(recipes).length;
  });
}

function calcMissing(recipe){
  const pantryNames=Object.values(pantry).map(p=>p.name.toLowerCase().trim());
  const ingredients=recipe.ingredients||[];
  const missing=ingredients.filter(ing=>{
    if(!ing.name) return false;
    return !pantryNames.some(pn=>pn.includes(ing.name.toLowerCase().trim())||ing.name.toLowerCase().trim().includes(pn));
  });
  return missing;
}

window.filterRecipes=q=>renderRecipes(q);

function renderRecipes(search=''){
  const container=document.getElementById('recipe-cards-list');
  const cats=new Set(['Alle']);
  Object.values(recipes).forEach(r=>r.category&&cats.add(r.category));

  // Filter chips
  const fc=document.getElementById('recipe-filter-chips');
  fc.innerHTML='';
  ['Alle','✅ Komplett','🛒 Fast komplett',...cats].filter((v,i,a)=>a.indexOf(v)===i).forEach(c=>{
    const ch=document.createElement('button');
    ch.className='cat-chip'+(c===activeRecipeFilter?' active':'');
    ch.textContent=c; ch.onclick=()=>{ activeRecipeFilter=c; renderRecipes(search); };
    fc.appendChild(ch);
  });

  let items=Object.entries(recipes);
  if(search){ const s=search.toLowerCase(); items=items.filter(([,r])=>r.name?.toLowerCase().includes(s)); }

  if(activeRecipeFilter==='✅ Komplett') items=items.filter(([,r])=>calcMissing(r).length===0);
  else if(activeRecipeFilter==='🛒 Fast komplett') items=items.filter(([,r])=>calcMissing(r).length<=2&&calcMissing(r).length>0);
  else if(activeRecipeFilter!=='Alle') items=items.filter(([,r])=>r.category===activeRecipeFilter);

  // Sort by missing
  items.sort((a,b)=>calcMissing(a[1]).length-calcMissing(b[1]).length);

  container.innerHTML='';
  if(items.length===0){
    const total=Object.keys(recipes).length;
    if(total===0){
      container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">📖</div><h3>Noch keine Rezepte</h3><p>Leg dein erstes Rezept an oder importiere ein paar Klassiker, um loszulegen.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" data-action="showAddRecipePage">＋ Rezept hinzufügen</button></div></div>`;
    } else {
      container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🔍</div><h3>Nichts gefunden</h3><p>Keine Rezepte passen zu deinem Filter (${esc(activeRecipeFilter)}).</p><div class="empty-state-actions"><button class="btn btn-ghost" type="button" data-action="resetRecipeFilter">Filter zurücksetzen</button></div></div>`;
    }
    return;
  }

  items.forEach(([id,r])=>{
    const missing=calcMissing(r);
    let badge='';
    if(missing.length===0) badge=`<span class="match-badge match-100">✅ Alles da</span>`;
    else if(missing.length===1) badge=`<span class="match-badge match-1">🛒 1 fehlt</span>`;
    else badge=`<span class="match-badge match-few">🛒 ${missing.length} fehlen</span>`;

    const card=document.createElement('div');
    card.className='recipe-card';
    card.onclick=()=>showDetail(id);
    card.innerHTML=`
      <div class="recipe-emoji-box">${esc(r.emoji||'🍽')}</div>
      <div class="recipe-card-info">
        <div class="recipe-card-name">${esc(r.name)}</div>
        <div class="recipe-card-meta">
          <span class="tag">${esc(r.category||'Sonstiges')}</span>
          ${r.prepTime?`<span class="tag">⏱ ${esc(r.prepTime)} min</span>`:''}
          ${r.difficulty?`<span class="tag">${esc(r.difficulty)}</span>`:''}
        </div>
        <div class="recipe-card-missing">
          ${badge}
          ${missing.length>0?`<span class="missing-items">${missing.slice(0,2).map(m=>esc(m.name)).join(', ')}${missing.length>2?' …':''}</span>`:''}
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// ─── HOME ───
function renderHome(){
  const qr=document.getElementById('home-quick-recipes');
  const items=Object.entries(recipes).sort((a,b)=>calcMissing(a[1]).length-calcMissing(b[1]).length).slice(0,4);
  document.getElementById('hc-recipes').textContent=Object.keys(recipes).length;

  if(items.length===0){
    qr.innerHTML=`<div class="empty-state"><div class="ei">🍳</div><h3>Noch keine Rezepte</h3><p>Füge Rezepte und Vorräte hinzu.</p></div>`;
    return;
  }

  qr.innerHTML='';
  items.forEach(([id,r])=>{
    const missing=calcMissing(r);
    let badge='';
    if(missing.length===0) badge=`<span class="match-badge match-100">✅ Sofort möglich</span>`;
    else if(missing.length===1) badge=`<span class="match-badge match-1">🛒 1 Zutat fehlt</span>`;
    else badge=`<span class="match-badge match-few">🛒 ${missing.length} fehlen</span>`;

    const card=document.createElement('div');
    card.className='quick-recipe-card';
    card.onclick=()=>showDetail(id);
    card.innerHTML=`
      <div class="qr-emoji">${esc(r.emoji||'🍽')}</div>
      <div class="qr-info">
        <div class="qr-name">${esc(r.name)}</div>
        <div class="qr-meta">
          ${r.category?`<span>${esc(r.category)}</span>`:''}
          ${r.prepTime?`<span>⏱ ${esc(r.prepTime)} min</span>`:''}
        </div>
      </div>
      ${badge}`;
    qr.appendChild(card);
  });
}

// ─── DETAIL ───
window.showDetail=(id)=>{
  const r=recipes[id]; if(!r) return;
  let currentPortions=r.portions||4;
  const base=r.portions||4;

  function render(){
    const scale=currentPortions/base;
    const missing=calcMissing(r);
    const pantryNames=Object.values(pantry).map(p=>p.name.toLowerCase().trim());

    document.getElementById('detail-content').innerHTML=`
      <div class="detail-hero">
        <div class="detail-emoji">${esc(r.emoji||'🍽')}</div>
        <div class="detail-title">${esc(r.name)}</div>
        <div class="detail-tags">
          <span class="tag" style="background:var(--green-light);color:var(--green)">${esc(r.category||'Sonstiges')}</span>
          ${r.prepTime?`<span class="tag">⏱ ${esc(r.prepTime)} min</span>`:''}
          ${r.difficulty?`<span class="tag">${esc(r.difficulty)}</span>`:''}
        </div>
        ${r.description?`<p class="detail-desc">${esc(r.description)}</p>`:''}
      </div>

      <div class="portions-bar">
        <span style="font-weight:600">Portionen</span>
        <div class="portions-controls">
          <button class="portions-btn" id="d-minus">−</button>
          <span class="portions-val" id="d-val">${currentPortions}</span>
          <button class="portions-btn" id="d-plus">＋</button>
        </div>
      </div>

      ${(r.ingredients||[]).length>0?`
        <div class="ingredients-block">
          <div class="block-header">🥕 Zutaten</div>
          ${(r.ingredients||[]).map(ing=>{
            const has=pantryNames.some(pn=>pn.includes(ing.name?.toLowerCase().trim())||ing.name?.toLowerCase().trim().includes(pn));
            const amt=ing.amount?(Math.round(ing.amount*scale*10)/10):'';
            return `<div class="ingredient-row-item">
              <div class="ing-status" style="background:${has?'var(--green)':'var(--red)'}"></div>
              <div class="ing-name-col">${esc(ing.name)}</div>
              <div class="ing-amount-col">${esc(amt)} ${esc(ing.unit||'')}</div>
              ${!has?'<div class="ing-missing">fehlt</div>':''}
            </div>`;
          }).join('')}
        </div>
      `:''}

      ${(r.steps||[]).length>0?`
        <div class="steps-block">
          <div class="block-header">👨‍🍳 Zubereitung</div>
          ${(r.steps||[]).map((s,i)=>`<div class="step-row-item"><div class="step-num">${i+1}</div><div class="step-text">${esc(s)}</div></div>`).join('')}
        </div>
      `:''}

      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" data-action="addRecipeToShopDirect" data-arg="${id}" ${missing.length===0?'disabled':''} title="${missing.length===0?'Alle Zutaten sind im Vorrat':'Nur fehlende Zutaten werden hinzugefügt'}">${missing.length===0?'🛒 Alles vorhanden':`🛒 ${missing.length} fehlende in den Korb`}</button>
        <button class="btn btn-outline btn-sm" data-action="editRecipe" data-arg="${id}">✏️ Bearbeiten</button>
        <button class="btn btn-outline btn-sm" data-action="printRecipe" title="Rezept drucken">🖨 Drucken</button>
        <button class="btn btn-red btn-sm" data-action="deleteRecipe" data-arg="${id}">🗑</button>
      </div>
      ${renderShareToggle(id, r)}
    `;

    document.getElementById('d-minus').onclick=()=>{ if(currentPortions>1){ currentPortions--; render(); } };
    document.getElementById('d-plus').onclick=()=>{ currentPortions++; render(); };
  }

  render();
  showPage('detail-page');
};

// ─── MARKTPLATZ ───
const MARKETPLACE_LIMIT_PER_FAMILY = 20;
let marketplaceCache = [];
let marketplaceFilter = '';
let marketplaceSort = 'new';

function isCurrentUserFamilyAdmin(){
  return !!(familyData && currentUser && familyData.members?.[currentUser.uid]?.role === 'admin');
}

function renderShareToggle(id, r){
  if(isDemoMode) return '';
  if(!isCurrentUserFamilyAdmin()) return '';
  const isShared = !!r.publishedAs;
  return `<div style="margin-top:14px;padding:14px;background:var(--surface2);border-radius:10px">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="font-size:20px">🌍</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">Mit anderen Familien teilen</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.4">${isShared
          ? `Dieses Rezept ist im Marktplatz veröffentlicht. ${typeof r.copies === 'number' ? `<strong>${r.copies}x übernommen</strong>` : ''}`
          : 'Andere Familien können das Rezept im Marktplatz finden und in ihre Sammlung übernehmen.'}</div>
        ${isShared ? '' : `<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:8px;cursor:pointer"><input type="checkbox" id="share-anonymous-${esc(id)}"><span>Anonym veröffentlichen (ohne Familien- und Nutzername)</span></label>`}
      </div>
    </div>
    <div style="margin-top:10px">
      ${isShared
        ? `<button class="btn btn-outline btn-sm" data-action="unpublishRecipe" data-arg="${esc(id)}" style="width:100%">🔒 Vom Marktplatz nehmen</button>`
        : `<button class="btn btn-primary btn-sm" data-action="publishRecipe" data-arg="${esc(id)}" style="width:100%">🌍 Veröffentlichen</button>`}
    </div>
  </div>`;
}

window.publishRecipe = async (id) => {
  if(isDemoMode){ alert('Im Demo-Modus nicht verfügbar.'); return; }
  if(!isCurrentUserFamilyAdmin()){ alert('Nur Familien-Admins können Rezepte veröffentlichen.'); return; }
  const r = recipes[id];
  if(!r) return;
  if(r.publishedAs){ alert('Rezept ist bereits veröffentlicht.'); return; }
  // Soft-Limit
  const sharedCount = Object.values(recipes).filter(x => !!x.publishedAs).length;
  if(sharedCount >= MARKETPLACE_LIMIT_PER_FAMILY){
    alert(`Limit erreicht: max ${MARKETPLACE_LIMIT_PER_FAMILY} öffentliche Rezepte pro Familie. Nimm zuerst eines vom Marktplatz, bevor du ein neues teilst.`);
    return;
  }
  const anonChk = document.getElementById(`share-anonymous-${id}`);
  const anonymous = !!(anonChk && anonChk.checked);
  const snapshot = {
    name: r.name || '',
    emoji: r.emoji || '',
    category: r.category || '',
    difficulty: r.difficulty || '',
    description: r.description || '',
    portions: r.portions || 4,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
    sourceFamilyId: familyId,
    sourceRecipeId: id,
    publishedAt: Date.now(),
    anonymous,
    copies: 0
  };
  if(!anonymous){
    snapshot.publishedBy = {
      familyName: (familyData?.name || 'Familie').slice(0, 80),
      userName: (currentUser?.displayName || '').slice(0, 80)
    };
  }
  try {
    const newRef = push(ref(db, 'publicRecipes'));
    await set(newRef, snapshot);
    await set(ref(db, `families/${familyId}/recipes/${id}/publishedAs`), newRef.key);
    if(typeof showPantryToast === 'function') showPantryToast('Rezept veröffentlicht! 🌍');
    showDetail(id); // re-render mit neuem State
  } catch(e){
    alert('Veröffentlichen fehlgeschlagen: ' + (e?.message || e));
  }
};

window.unpublishRecipe = async (id) => {
  if(isDemoMode) return;
  if(!isCurrentUserFamilyAdmin()){ alert('Nur Familien-Admins können das tun.'); return; }
  const r = recipes[id];
  if(!r || !r.publishedAs) return;
  if(!confirm('Rezept vom Marktplatz nehmen? Andere Familien können es danach nicht mehr finden (bereits übernommene Kopien bleiben).')) return;
  const publishId = r.publishedAs;
  try {
    await remove(ref(db, `publicRecipes/${publishId}`));
    await set(ref(db, `families/${familyId}/recipes/${id}/publishedAs`), null);
    if(typeof showPantryToast === 'function') showPantryToast('Vom Marktplatz genommen.');
    showDetail(id);
  } catch(e){
    alert('Fehler: ' + (e?.message || e));
  }
};

function listenMarketplace(){
  if(isDemoMode) return;
  const q = query(ref(db, 'publicRecipes'), orderByChild('publishedAt'), limitToLast(200));
  onValue(q, snap => {
    marketplaceCache = [];
    if(snap.exists()){
      snap.forEach(c => { marketplaceCache.push({ id: c.key, ...c.val() }); });
      marketplaceCache.reverse();
    }
    renderMarketplace();
    if(isAdmin){
      const admList = document.getElementById('admin-marketplace-list');
      if(admList && !admList.closest('.admin-tab-content')?.classList.contains('hidden')){
        renderAdminMarketplace();
      }
    }
  }, err => console.warn('[marketplace] read failed:', err?.message || err));
}

window.setMarketplaceSort = (sort) => {
  marketplaceSort = sort;
  document.getElementById('mp-sort-new').style.background = sort === 'new' ? 'var(--green)' : 'var(--surface)';
  document.getElementById('mp-sort-new').style.color = sort === 'new' ? 'white' : 'var(--text)';
  document.getElementById('mp-sort-pop').style.background = sort === 'pop' ? 'var(--green)' : 'var(--surface)';
  document.getElementById('mp-sort-pop').style.color = sort === 'pop' ? 'white' : 'var(--text)';
  renderMarketplace();
};

window.filterMarketplace = (val) => {
  marketplaceFilter = (val || '').toLowerCase().trim();
  renderMarketplace();
};

function renderMarketplace(){
  const container = document.getElementById('marketplace-cards');
  if(!container) return;
  let list = marketplaceCache.slice();
  if(marketplaceFilter){
    list = list.filter(r => (r.name || '').toLowerCase().includes(marketplaceFilter));
  }
  if(marketplaceSort === 'pop'){
    list.sort((a, b) => (b.copies || 0) - (a.copies || 0));
  }
  if(list.length === 0){
    container.innerHTML = '<div class="empty-state"><div class="ei" aria-hidden="true">🌍</div><h3>Marktplatz ist leer</h3><p>Noch keine geteilten Rezepte. Sei die erste Familie und teile eines!</p></div>';
    return;
  }
  container.innerHTML = list.map(r => {
    const author = r.anonymous
      ? '<em style="color:var(--text2)">anonym</em>'
      : esc(r.publishedBy?.familyName || 'Familie');
    return `<div class="recipe-card" data-action="showMarketplaceDetail" data-arg="${esc(r.id)}" style="cursor:pointer">
      <div class="rc-emoji">${esc(r.emoji || '🍽')}</div>
      <div class="rc-content">
        <div class="rc-name">${esc(r.name || '')}</div>
        <div class="rc-meta">
          <span>${esc(r.category || 'Sonstiges')}</span>
          ${r.copies ? `<span> · 📥 ${esc(String(r.copies))}</span>` : ''}
          <span> · von ${author}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.showMarketplaceDetail = (publishId) => {
  const r = marketplaceCache.find(x => x.id === publishId);
  if(!r){ alert('Rezept nicht gefunden.'); return; }
  const author = r.anonymous
    ? '<em style="color:var(--text2)">anonym geteilt</em>'
    : `geteilt von <strong>${esc(r.publishedBy?.familyName || 'Familie')}</strong>${r.publishedBy?.userName ? ` (${esc(r.publishedBy.userName)})` : ''}`;
  const isMine = r.sourceFamilyId === familyId;
  const isAlreadyImported = Object.values(recipes).some(x => x.importedFrom?.publishId === publishId);
  document.getElementById('marketplace-detail-content').innerHTML = `
    <div class="detail-hero">
      <div class="detail-emoji">${esc(r.emoji || '🍽')}</div>
      <div class="detail-title">${esc(r.name)}</div>
      <div class="detail-tags">
        <span class="tag" style="background:var(--green-light);color:var(--green)">${esc(r.category || 'Sonstiges')}</span>
        ${r.difficulty ? `<span class="tag">${esc(r.difficulty)}</span>` : ''}
        ${r.copies ? `<span class="tag">📥 ${esc(String(r.copies))}x übernommen</span>` : ''}
      </div>
      <p class="detail-desc" style="font-size:12px;color:var(--text2)">${author}</p>
      ${r.description ? `<p class="detail-desc">${esc(r.description)}</p>` : ''}
    </div>
    ${(r.ingredients || []).length > 0 ? `
      <div class="ingredients-block">
        <div class="block-header">🥕 Zutaten</div>
        ${(r.ingredients || []).map(ing => `<div class="ingredient-row-item">
          <div class="ing-name-col">${esc(ing.name || '')}</div>
          <div class="ing-amount-col">${esc(ing.amount || '')} ${esc(ing.unit || '')}</div>
        </div>`).join('')}
      </div>` : ''}
    ${(r.steps || []).length > 0 ? `
      <div class="steps-block">
        <div class="block-header">👨‍🍳 Zubereitung</div>
        ${(r.steps || []).map((s, i) => `<div class="step-row-item"><div class="step-num">${i + 1}</div><div class="step-text">${esc(s)}</div></div>`).join('')}
      </div>` : ''}
    <div class="detail-actions">
      ${isMine
        ? '<div style="font-size:13px;color:var(--text2);font-style:italic;padding:10px">Das ist dein eigenes Rezept – andere Familien sehen das hier so.</div>'
        : isAlreadyImported
          ? '<div style="font-size:13px;color:var(--green);padding:10px">✓ Bereits in deine Sammlung übernommen</div>'
          : `<button class="btn btn-primary" data-action="importPublicRecipe" data-arg="${esc(r.id)}" style="width:100%">📥 In meine Sammlung übernehmen</button>`}
    </div>
  `;
  showPage('marketplace-detail-page');
};

window.importPublicRecipe = async (publishId) => {
  if(isDemoMode){ alert('Im Demo-Modus nicht verfügbar.'); return; }
  if(!familyId){ alert('Bitte erst einer Familie beitreten.'); return; }
  const r = marketplaceCache.find(x => x.id === publishId);
  if(!r) return;
  const newRecipe = {
    name: r.name || '',
    emoji: r.emoji || '',
    category: r.category || '',
    difficulty: r.difficulty || '',
    description: r.description || '',
    portions: r.portions || 4,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
    importedFrom: {
      publishId,
      familyName: r.anonymous ? '' : (r.publishedBy?.familyName || ''),
      importedAt: Date.now()
    }
  };
  try {
    await push(ref(db, `families/${familyId}/recipes`), newRecipe);
    runTransaction(ref(db, `publicRecipes/${publishId}/copies`), v => (typeof v === 'number' ? v : 0) + 1).catch(() => {});
    if(typeof showPantryToast === 'function') showPantryToast('In deine Sammlung übernommen ✨');
    showPage('recipes-page');
  } catch(e){
    alert('Übernehmen fehlgeschlagen: ' + (e?.message || e));
  }
};

window.deleteRecipe=async(id)=>{
  if(!confirm('Rezept wirklich löschen?')) return;
  if(isDemoMode){ delete recipes[id]; renderRecipes(); renderHome(); showPage('recipes-page'); return; }
  const recipeName = recipes?.[id]?.name || '';
  await logAudit(familyId, 'delete-recipe', { targetId: id, targetName: recipeName });
  await remove(ref(db,`families/${familyId}/recipes/${id}`));
  showPage('recipes-page');
};

window.addRecipeToShopDirect=(id)=>{
  const r=recipes[id]; if(!r) return;
  const portions=parseInt(document.getElementById('d-val')?.textContent)||r.portions||4;
  const missing = calcMissing(r);
  if(missing.length === 0){
    if(typeof showPantryToast === 'function'){ showPantryToast('Alle Zutaten sind bereits im Vorrat ✨'); }
    else { alert('Alle Zutaten sind bereits im Vorrat.'); }
    return;
  }
  const added = addIngsToShop(r, portions, true);
  if(typeof showPantryToast === 'function'){ showPantryToast(`${added} fehlende Zutat${added===1?'':'en'} zur Einkaufsliste`); }
  showPage('shopping-page');
};

// ─── ADD/EDIT RECIPE ───
window.showAddRecipePage=()=>{
  editingRecipeId=null;
  document.getElementById('add-recipe-title').textContent='Neues Rezept';
  ['r-name','r-desc','r-emoji'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('r-portions').value='4';
  document.getElementById('r-time').value='';
  document.getElementById('r-difficulty').value='Einfach';
  document.getElementById('r-category').value='Hauptgericht';
  document.getElementById('r-ingredients').innerHTML='';
  document.getElementById('r-steps').innerHTML='';
  addIngRow(); addIngRow(); addIngRow();
  addStepRow();
  document.getElementById('r-error').classList.add('hidden');
  showPage('add-recipe-page');
};

window.editRecipe=(id)=>{
  const r=recipes[id]; if(!r) return;
  editingRecipeId=id;
  document.getElementById('add-recipe-title').textContent='Rezept bearbeiten';
  document.getElementById('r-name').value=r.name||'';
  document.getElementById('r-desc').value=r.description||'';
  document.getElementById('r-emoji').value=r.emoji||'';
  document.getElementById('r-portions').value=r.portions||4;
  document.getElementById('r-time').value=r.prepTime||'';
  document.getElementById('r-difficulty').value=r.difficulty||'Einfach';
  document.getElementById('r-category').value=r.category||'Hauptgericht';
  document.getElementById('r-ingredients').innerHTML='';
  (r.ingredients||[]).forEach(ing=>addIngRow(ing));
  if(!(r.ingredients||[]).length) addIngRow();
  document.getElementById('r-steps').innerHTML='';
  (r.steps||[]).forEach(s=>addStepRow(s));
  if(!(r.steps||[]).length) addStepRow();
  document.getElementById('r-error').classList.add('hidden');
  showPage('add-recipe-page');
};

window.cancelRecipeForm=()=>showPage('recipes-page');

// ─── PRINT RECIPE ───
// Toggelt eine Body-Klasse, damit das @media print im app.css greift.
// Cleanup über afterprint-Event (egal ob User druckt oder Dialog abbricht).
window.printRecipe = () => {
  document.body.classList.add('printing-recipe');
  const cleanup = () => {
    document.body.classList.remove('printing-recipe');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
};

window.addIngRow=(d={})=>{
  const row=document.createElement('div');
  row.className='ing-form-row';
  row.innerHTML=`<input type="text" placeholder="Nudeln" value="${esc(d.name||'')}" class="i-name"><input type="number" placeholder="200" value="${esc(d.amount||'')}" class="i-amount" min="0" step="0.1"><input type="text" placeholder="g" value="${esc(d.unit||'')}" class="i-unit"><button class="remove-btn" data-action="removeParentRow">×</button>`;
  document.getElementById('r-ingredients').appendChild(row);
};

window.addStepRow=(d='')=>{
  const row=document.createElement('div');
  row.className='step-form-row';
  row.innerHTML=`<textarea rows="2" placeholder="Schritt beschreiben…" class="s-text">${esc(d)}</textarea><button class="remove-btn" data-action="removeParentRow" style="margin-top:2px">×</button>`;
  document.getElementById('r-steps').appendChild(row);
};

window.saveRecipe=async()=>{
  const name=document.getElementById('r-name').value.trim();
  if(!name){ const e=document.getElementById('r-error'); e.textContent='Bitte einen Namen eingeben.'; e.classList.remove('hidden'); return; }
  document.getElementById('r-error').classList.add('hidden');

  const ingredients=[...document.querySelectorAll('.ing-form-row')].map(r=>({
    name:r.querySelector('.i-name').value.trim(),
    amount:parseFloat(r.querySelector('.i-amount').value)||0,
    unit:r.querySelector('.i-unit').value.trim()
  })).filter(i=>i.name);

  const steps=[...document.querySelectorAll('.s-text')].map(t=>t.value.trim()).filter(Boolean);

  const data={
    name,
    category:document.getElementById('r-category').value,
    portions:parseInt(document.getElementById('r-portions').value)||4,
    prepTime:parseInt(document.getElementById('r-time').value)||null,
    difficulty:document.getElementById('r-difficulty').value,
    emoji:document.getElementById('r-emoji').value||null,
    description:document.getElementById('r-desc').value.trim()||null,
    ingredients, steps,
    updatedAt:Date.now(),
    updatedBy:currentUser.displayName
  };

  if(editingRecipeId){
    if(isDemoMode){ recipes[editingRecipeId]={...recipes[editingRecipeId],...data}; }
    else await update(ref(db,`families/${familyId}/recipes/${editingRecipeId}`),data);
  } else {
    data.createdAt=Date.now(); data.createdBy=currentUser.displayName;
    if(isDemoMode){ const key='r'+Date.now(); recipes[key]=data; }
    else await push(ref(db,`families/${familyId}/recipes`),data);
  }
  if(isDemoMode){ renderRecipes(); renderHome(); document.getElementById('hc-recipes').textContent=Object.keys(recipes).length; }
  showPage('recipes-page');
};

// ─── SHOPPING ───
function listenShopping(){
  onValue(ref(db,`families/${familyId}/shoppingList`),snap=>{
    shoppingList=snap.val()||{};
    renderShopping();
    const total=Object.keys(shoppingList).length;
    document.getElementById('hc-shopping').textContent=total;
  });
}

function addIngsToShop(recipe, portions, missingOnly=false){
  const base=recipe.portions||4;
  const scale=portions/base;
  const updated={...shoppingList};

  // When called from a recipe detail action, only the ingredients that are NOT already in the pantry are useful.
  const sourceIngs = missingOnly ? calcMissing(recipe) : (recipe.ingredients||[]);
  let added = 0;

  sourceIngs.forEach(ing=>{
    if(!ing.name) return;
    const key='r_'+ing.name.toLowerCase().replace(/[^a-z0-9äöüß]/g,'_');
    const amt=Math.round((ing.amount||0)*scale*10)/10;
    if(updated[key]){ updated[key].amount=Math.round((updated[key].amount+amt)*10)/10; }
    else{ updated[key]={ name:ing.name, amount:amt, unit:ing.unit||'', category:recipe.category||'Sonstiges', from:recipe.name, checked:false }; }
    added++;
  });

  if(isDemoMode){ shoppingList=updated; renderShopping(); document.getElementById('hc-shopping').textContent=Object.values(shoppingList).filter(i=>!i.checked).length; }
  else set(ref(db,`families/${familyId}/shoppingList`),updated);

  return added;
}

window.addManualShopItem=()=>{
  const val=document.getElementById('shop-manual-input').value.trim();
  if(!val) return;
  const key='m_'+Date.now();
  const item={ name:val, amount:null, unit:'', category:'Sonstiges', from:null, checked:false };
  if(isDemoMode){ shoppingList[key]=item; renderShopping(); }
  else update(ref(db,`families/${familyId}/shoppingList`),{ [key]:item });
  document.getElementById('shop-manual-input').value='';
};

window.toggleShopItem=(key)=>{
  const item=shoppingList[key]; if(!item) return;
  if(isDemoMode){ shoppingList[key].checked=!item.checked; renderShopping(); document.getElementById('hc-shopping').textContent=Object.values(shoppingList).filter(i=>!i.checked).length; return; }
  update(ref(db,`families/${familyId}/shoppingList/${key}`),{checked:!item.checked});
};

window.clearCheckedItems=async()=>{
  const checked = Object.entries(shoppingList).filter(([,v])=>v.checked);
  const unchecked = Object.entries(shoppingList).filter(([,v])=>!v.checked);

  if(checked.length === 0) return;

  // Map shopping categories to pantry categories
  const catMap = {
    'Hauptgericht':'Trockenwaren','Vorspeise':'Trockenwaren','Frühstück':'Trockenwaren',
    'Snack':'Trockenwaren','Backen':'Trockenwaren','Sonstiges':'Sonstiges',
    'Gemüse & Obst':'Gemüse & Obst','Fleisch & Fisch':'Fleisch & Fisch',
    'Milchprodukte':'Milchprodukte','Trockenwaren':'Trockenwaren',
    'Konserven':'Konserven','Gewürze':'Gewürze','Getränke':'Getränke'
  };

  // Add checked items to pantry
  const pantryUpdates = {};
  checked.forEach(([,item])=>{
    if(!item.name) return;
    const key = 'shop_' + item.name.toLowerCase().replace(/[^a-z0-9äöüß]/g,'_') + '_' + Date.now();
    pantryUpdates[key] = {
      name: item.name,
      emoji: '📦',
      category: catMap[item.category] || 'Sonstiges',
      amount: item.amount || null,
      unit: item.unit || null,
      status: 'ok',
      addedAt: Date.now(),
      addedFrom: 'Einkaufsliste'
    };
  });

  const newList = {};
  unchecked.forEach(([k,v])=>{ newList[k]=v; });

  if(isDemoMode){
    Object.assign(pantry, pantryUpdates);
    shoppingList = newList;
    renderShopping();
    renderPantry();
    renderHome();
    renderRecipes();
    showPantryToast(checked.length);
    return;
  }

  // Write pantry + shopping list in parallel
  const pantryRef = ref(db, `families/${familyId}/pantry`);
  await Promise.all([
    ...Object.entries(pantryUpdates).map(([k,v]) => set(ref(db, `families/${familyId}/pantry/${k}`), v)),
    set(ref(db, `families/${familyId}/shoppingList`), newList)
  ]);
  showPantryToast(checked.length);
};

function showPantryToast(count){
  // Remove existing toast if any
  const existing = document.getElementById('pantry-toast');
  if(existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'pantry-toast';
  toast.style.cssText = `
    position:fixed; bottom:90px; left:50%; transform:translateX(-50%);
    background:var(--green); color:white; padding:12px 20px;
    border-radius:12px; font-size:14px; font-weight:600;
    box-shadow:0 4px 20px rgba(39,174,96,0.4);
    z-index:300; white-space:nowrap;
    animation:slideUp 0.3s ease;
  `;
  toast.textContent = `✅ ${count} Artikel in den Vorrat übernommen`;
  document.body.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity='0'; toast.style.transition='opacity 0.4s'; setTimeout(()=>toast.remove(), 400); }, 3000);
}

window.clearAllShopping=()=>{
  if(!confirm('Einkaufsliste wirklich leeren?')) return;
  if(isDemoMode){ shoppingList={}; renderShopping(); document.getElementById('hc-shopping').textContent=0; return; }
  set(ref(db,`families/${familyId}/shoppingList`),{});
};

window.openAddRecipeToShop=()=>{
  const list=document.getElementById('recipe-select-list');
  list.innerHTML='';
  Object.entries(recipes).sort((a,b)=>calcMissing(a[1]).length-calcMissing(b[1]).length).forEach(([id,r])=>{
    const missing=calcMissing(r);
    const item=document.createElement('div');
    item.className='recipe-select-item';
    item.innerHTML=`<span style="font-size:28px">${esc(r.emoji||'🍽')}</span><div style="flex:1"><div style="font-weight:600">${esc(r.name)}</div><div style="font-size:12px;color:var(--text2)">${missing.length===0?'✅ Alles vorhanden':'🛒 '+missing.length+' fehlen'}</div></div>`;
    item.onclick=()=>{
      const p=parseInt(document.getElementById('shop-portions').value)||4;
      const missingNow=calcMissing(r);
      if(missingNow.length===0){
        if(typeof showPantryToast === 'function'){ showPantryToast(`${r.name}: alles im Vorrat ✨`); }
        closeModal('recipe-shop-modal');
        return;
      }
      const added=addIngsToShop(r,p,true);
      if(typeof showPantryToast === 'function'){ showPantryToast(`${added} fehlende Zutat${added===1?'':'en'} aus „${r.name}"`); }
      closeModal('recipe-shop-modal');
    };
    list.appendChild(item);
  });
  document.getElementById('recipe-shop-modal').classList.remove('hidden');
};

function renderShopping(){
  const container=document.getElementById('shopping-list-content');
  const items=Object.entries(shoppingList);
  const unchecked=items.filter(([,v])=>!v.checked);
  const checked=items.filter(([,v])=>v.checked);

  document.getElementById('shopping-count').textContent=unchecked.length||0;
  document.getElementById('shopping-subtitle').textContent=unchecked.length>0?`${unchecked.length} Artikel offen`:'Alle erledigt! 🎉';

  // Nav badge
  const badge = document.getElementById('nav-shopping-badge');
  if(unchecked.length > 0){
    badge.textContent = unchecked.length > 99 ? '99+' : unchecked.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if(items.length===0){
    container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🛒</div><h3>Einkaufsliste ist leer</h3><p>Füge Zutaten manuell hinzu, oder generiere die Liste automatisch aus deinem Wochenplan.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" data-action="addManualShopItem">＋ Manuell hinzufügen</button><button class="btn btn-ghost" type="button" data-action="generateShoppingFromWeek">📅 Aus Wochenplan</button></div></div>`;
    return;
  }

  // Group unchecked by category
  const groups={};
  unchecked.forEach(([k,v])=>{
    const cat=v.category||'Sonstiges';
    if(!groups[cat]) groups[cat]=[];
    groups[cat].push([k,v]);
  });

  let html='';
  Object.entries(groups).forEach(([cat,items])=>{
    html+=`<div class="shopping-group"><div class="shopping-group-header">${CAT_ICONS[cat]||'📦'} ${esc(cat)}</div>`;
    items.forEach(([k,v])=>{
      html+=`<div class="shopping-item" data-action="toggleShopItem" data-arg="${k}">
        <div class="checkbox"></div>
        <span class="si-name">${esc(v.name)}</span>
        ${v.amount?`<span class="si-amount">${esc(v.amount)} ${esc(v.unit||'')}</span>`:''}
        ${v.from?`<span class="si-from">${esc(v.from)}</span>`:''}
      </div>`;
    });
    html+='</div>';
  });

  if(checked.length>0){
    html+=`<div class="shopping-group"><div class="shopping-group-header">✓ Erledigt (${checked.length})</div>`;
    checked.forEach(([k,v])=>{
      html+=`<div class="shopping-item checked" data-action="toggleShopItem" data-arg="${k}">
        <div class="checkbox"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></div>
        <span class="si-name">${esc(v.name)}</span>
      </div>`;
    });
    html+='</div>';
  }

  container.innerHTML=html;
}

// ─── WEEK PLAN ───
function listenWeekPlan(){
  onValue(ref(db,`families/${familyId}/weekPlan`),snap=>{
    weekPlan=snap.val()||{};
    renderWeekGrid();
    const total=Object.values(weekPlan).reduce((a,d)=>a+Object.keys(d||{}).length,0);
    document.getElementById('hc-week').textContent=total;
  });
}

function buildWeekGrid(){
  const grid=document.getElementById('week-grid');
  grid.innerHTML='';
  DAYS.forEach(day=>{
    const card=document.createElement('div');
    card.className='day-card';
    card.id=`day-${day}`;
    grid.appendChild(card);
  });
}

function renderWeekGrid(){
  DAYS.forEach(day=>{
    const card=document.getElementById(`day-${day}`);
    if(!card) return;
    const dayData=weekPlan[day]||{};
    card.innerHTML=`<div class="day-header"><span class="day-name">${day}</span></div><div class="day-meals">
      ${MEALS.map(meal=>{
        const r=dayData[meal]?recipes[dayData[meal]]:null;
        return `<div class="meal-slot ${r?'filled':''}" data-action="openDayModalDelegated" data-day="${day}" data-meal="${meal}">
          <span class="meal-slot-label">${meal}</span>
          ${r?`<span class="meal-slot-emoji">${esc(r.emoji||'🍽')}</span><span class="meal-slot-content">${esc(r.name)}</span>`
             :`<span class="meal-slot-empty">+ Rezept wählen</span>`}
        </div>`;
      }).join('')}
    </div>`;
  });
}

window.openDayModal=(day,meal)=>{
  pendingDaySlot={day,meal};
  document.getElementById('day-modal-title').textContent=`${day} – ${meal}`;
  const list=document.getElementById('day-recipe-list');
  list.innerHTML='';
  const existing=weekPlan[day]?.[meal];
  const removeBtn=document.getElementById('remove-meal-btn');
  removeBtn.style.display=existing?'':'none';

  Object.entries(recipes).forEach(([id,r])=>{
    const item=document.createElement('div');
    item.className='recipe-select-item';
    if(id===existing) item.style.borderColor='var(--green)';
    item.innerHTML=`<span style="font-size:28px">${esc(r.emoji||'🍽')}</span><div style="flex:1"><div style="font-weight:600">${esc(r.name)}</div><div style="font-size:12px;color:var(--text2)">${esc(r.category||'')} ${r.prepTime?'· ⏱ '+esc(r.prepTime)+' min':''}</div></div>`;
    item.onclick=()=>{ setMealForDay(day,meal,id); closeModal('day-recipe-modal'); };
    list.appendChild(item);
  });

  document.getElementById('day-recipe-modal').classList.remove('hidden');
};

async function setMealForDay(day,meal,recipeId){
  if(isDemoMode){
    if(!weekPlan[day]) weekPlan[day]={};
    weekPlan[day][meal]=recipeId;
    const total=Object.values(weekPlan).reduce((a,d)=>a+Object.keys(d||{}).length,0);
    document.getElementById('hc-week').textContent=total;
    renderWeekGrid();
    return;
  }
  await update(ref(db,`families/${familyId}/weekPlan/${day}`),{[meal]:recipeId});
}

window.removeMealFromDay=async()=>{
  if(!pendingDaySlot) return;
  const {day,meal}=pendingDaySlot;
  if(isDemoMode){
    if(weekPlan[day]) delete weekPlan[day][meal];
    const total=Object.values(weekPlan).reduce((a,d)=>a+Object.keys(d||{}).length,0);
    document.getElementById('hc-week').textContent=total;
    renderWeekGrid();
    closeModal('day-recipe-modal'); return;
  }
  const dayData={...(weekPlan[day]||{})};
  delete dayData[meal];
  await set(ref(db,`families/${familyId}/weekPlan/${day}`),dayData);
  closeModal('day-recipe-modal');
};

window.generateShoppingFromWeek=()=>{
  const recipeIds=new Set();
  Object.values(weekPlan).forEach(day=>{ if(day) Object.values(day).forEach(id=>recipeIds.add(id)); });
  if(recipeIds.size===0){ alert('Keine Rezepte im Wochenplan.'); return; }
  let totalAdded=0; let recipesContributing=0;
  recipeIds.forEach(id=>{
    const r=recipes[id]; if(!r) return;
    const added=addIngsToShop(r, r.portions||4, true);
    if(added>0){ totalAdded+=added; recipesContributing++; }
  });
  if(typeof showPantryToast === 'function'){
    if(totalAdded===0){ showPantryToast('Alle Zutaten der Wochenrezepte sind im Vorrat ✨'); }
    else { showPantryToast(`${totalAdded} fehlende Zutat${totalAdded===1?'':'en'} aus ${recipesContributing} Rezept${recipesContributing===1?'':'en'} übernommen`); }
  }
  showPage('shopping-page');
};

// ─── UI ───
window.showPage=(id)=>{
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const map={'home-page':'nav-home','pantry-page':'nav-pantry','recipes-page':'nav-recipes','shopping-page':'nav-shopping','week-page':'nav-week','family-page':'nav-family'};
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(map[id]) document.getElementById(map[id]).classList.add('active');
};

window.closeModal=(id)=>document.getElementById(id).classList.add('hidden');

// Global Escape-key handler: closes the topmost dismissable modal.
// Skips lockout/demo-expired which are intentionally modal-by-design.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const dismissable = ['day-recipe-modal','recipe-shop-modal','invite-modal','family-switcher-modal','feedback-modal'];
  for (const id of dismissable) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); break; }
  }
});

window.showInviteModal=()=>{
  document.getElementById('modal-code').textContent=familyData?.code||'–';
  document.getElementById('invite-modal').classList.remove('hidden');
};

window.copyInviteCode=()=>{
  const code=familyData?.code||'';
  navigator.clipboard.writeText(code).then(()=>{
    const el=document.getElementById('modal-code');
    el.textContent='✓ Kopiert!';
    setTimeout(()=>el.textContent=code,1500);
  });
};
