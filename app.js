import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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

// Register the service worker for PWA install + offline shell.
// Registered after Firebase init so the page is interactive first.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore – non-critical */ });
  });
}

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
      <div style="width:38px;height:38px;border-radius:50%;background:var(--green);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${(m.name||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div style="font-weight:600">${m.name||'Unbekannt'} ${uid===currentUser.uid?'<span style="background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">Du</span>':''}</div>
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
  return str.replace(/[<>'"&]/g, c => ({'<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','&':'&amp;'}[c]));
}

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
  const name=sanitize(document.getElementById('reg-name').value.trim());
  const email=document.getElementById('reg-email').value.trim();
  const pw=document.getElementById('reg-password').value;
  if(!name||!email||!pw){ authErr('Bitte alle Felder ausfüllen.'); return; }
  if(pw.length < 8){ authErr('Passwort muss mindestens 8 Zeichen haben.'); return; }
  if(name.length < 2){ authErr('Name muss mindestens 2 Zeichen haben.'); return; }
  try{
    const c=await createUserWithEmailAndPassword(auth,email,pw);
    await updateProfile(c.user,{displayName:name});
    await set(ref(db,`users/${c.user.uid}`),{name,email,createdAt:Date.now()});
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
  familyId=fr.key; loadApp();
};

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

  listenFamily(); listenPantry(); listenRecipes(); listenShopping(); listenWeekPlan(); listenStaples();
  buildWeekGrid();
  // Ensure the "Meine Familien" list on the family page is fresh, not stale, on first load.
  loadAllUserFamilies().then(()=>renderAllFamiliesList()).catch(()=>{});
}

function updateGreeting(){
  const h=new Date().getHours();
  const name=currentUser?.displayName?.split(' ')[0]||'';
  let g=h<12?'Guten Morgen':h<18?'Guten Mittag':'Guten Abend';
  document.getElementById('home-greeting-text').innerHTML=`${g}${name?', '+name:''}! <br><em>Was kochst du heute?</em>`;
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
  try{
    // Order matters: code first (rule needs family with admin), then family, then own user-cache.
    if(oldCode){
      try{ await remove(ref(db,`familyCodes/${oldCode}`)); } catch(_){ /* code may not exist */ }
    }
    await remove(ref(db,`families/${fid}`));
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
        <div class="fli-name">${f.name||'Familie'}</div>
        <div class="fli-role">${f.role==='admin'?'👑 Admin':'👤 Mitglied'}${fid===familyId?' · Aktiv':''}</div>
      </div>
      ${fid!==familyId?`<button class="btn btn-secondary btn-sm" onclick="switchToFamily('${fid}')">Wechseln</button>`:'<span style="font-size:12px;color:var(--green);font-weight:700">✓</span>'}
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
        <div class="fli-name">${f.name||'Familie'}</div>
        <div class="fli-role">${f.role==='admin'?'👑 Admin':'👤 Mitglied'}</div>
      </div>
      ${fid===familyId?'<span style="font-size:12px;color:var(--green);font-weight:700">Aktiv ✓</span>':`<button class="btn btn-secondary btn-sm" onclick="switchToFamily('${fid}')">Wechseln</button>`}
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
    <div onclick="selectPantryIngredient(${JSON.stringify(m).replace(/"/g,'&quot;')})"
      style="padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.1s"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <span style="font-size:22px">${m.emoji}</span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${m.name} ${m.alreadyInPantry?'<span style="font-size:10px;background:var(--green-light);color:var(--green);padding:1px 6px;border-radius:10px;font-weight:700">schon vorhanden</span>':''}</div>
        <div style="font-size:11px;color:var(--text2)">aus ${m.recipe}${m.unit?' · '+m.unit:''}</div>
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
  const name=sanitize(document.getElementById('p-name').value.trim());
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
      list.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🥕</div><h3>Dein Vorrat ist noch leer</h3><p>Trag ein, was du zuhause hast – damit Pantrio dir passende Rezepte vorschlagen kann.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" onclick="toggleAddPantryForm()">＋ Vorrat hinzufügen</button></div></div>`;
    } else {
      const hasFilter=activePantryCategory!=='Alle'||search;
      list.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🔍</div><h3>Nichts in dieser Kategorie</h3><p>Du hast Vorräte in anderen Kategorien.</p><div class="empty-state-actions"><button class="btn btn-ghost" type="button" onclick="resetPantryFilter()">Alle anzeigen</button></div></div>`;
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
    section.innerHTML=`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:8px;display:flex;align-items:center;gap:6px">${CAT_ICONS[cat]||'📦'} ${cat} <span style="background:var(--surface2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px">${entries.length}</span></div>`;
    entries.forEach(([id,p])=>{
      const div=document.createElement('div');
      div.className='pantry-item';
      div.innerHTML=`
        <div class="pantry-item-emoji">${p.emoji||'📦'}</div>
        <div class="pantry-item-info">
          <div class="pantry-item-name">${p.name}</div>
          <div class="pantry-item-amount">${p.amount?p.amount+' '+(p.unit||''):''}${p.amount&&p.category?' · ':''}${p.category||''}</div>
        </div>
        <div class="status-dot status-${p.status||'ok'}"></div>
        <div class="pantry-item-actions">
          <button class="icon-btn delete" onclick="deletePantryItem('${id}')">×</button>
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
  const name=sanitize(document.getElementById('st-name').value.trim());
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
    header.innerHTML=`${CAT_ICONS[cat]||'📦'} ${cat} <span style="background:var(--surface2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px">${items.length}</span>`;
    list.appendChild(header);
    items.forEach(([id,s])=>{
      // Check if currently in pantry
      const inPantry=Object.values(pantry).some(p=>p.name.toLowerCase().trim()===s.name.toLowerCase().trim());
      const div=document.createElement('div');
      div.className='staple-item';
      div.innerHTML=`
        <span class="star">⭐</span>
        <span style="font-size:22px">${s.emoji||'📦'}</span>
        <div style="flex:1">
          <div style="font-weight:600;display:flex;align-items:center;gap:6px">
            ${s.name}
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;background:${inPantry?'var(--green-light)':'var(--red-light)'};color:${inPantry?'var(--green)':'var(--red)'}">
              ${inPantry?'✓ Im Vorrat':'✗ Fehlt'}
            </span>
          </div>
          <div style="font-size:12px;color:var(--text2)">${s.amount?s.amount+' '+(s.unit||''):''}${s.amount&&s.category?' · ':''}${s.category||''}</div>
        </div>
        <div style="display:flex;gap:6px">
          ${!inPantry?`<button class="icon-btn" onclick="addStapleToShopManual('${id}')" title="Zur Einkaufsliste" style="color:var(--green)">🛒</button>`:''}
          <button class="icon-btn delete" onclick="deleteStaple('${id}')">×</button>
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
    header.innerHTML=`${CAT_ICONS[cat]||'📦'} ${cat}`;
    list.appendChild(header);

    entries.forEach(([id,p])=>{
      const div=document.createElement('div');
      div.className='cook-item';
      div.id=`cook-${id}`;
      div.innerHTML=`
        <div class="checkbox" id="cook-cb-${id}"></div>
        <span style="font-size:22px">${p.emoji||'📦'}</span>
        <div style="flex:1">
          <div class="cook-name" style="font-weight:600">${p.name}</div>
          <div style="font-size:12px;color:var(--text2)">${p.amount?p.amount+' '+(p.unit||''):'Menge nicht angegeben'}</div>
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
      container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">📖</div><h3>Noch keine Rezepte</h3><p>Leg dein erstes Rezept an oder importiere ein paar Klassiker, um loszulegen.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" onclick="showAddRecipePage()">＋ Rezept hinzufügen</button></div></div>`;
    } else {
      container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🔍</div><h3>Nichts gefunden</h3><p>Keine Rezepte passen zu deinem Filter (${activeRecipeFilter}).</p><div class="empty-state-actions"><button class="btn btn-ghost" type="button" onclick="resetRecipeFilter()">Filter zurücksetzen</button></div></div>`;
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
      <div class="recipe-emoji-box">${r.emoji||'🍽'}</div>
      <div class="recipe-card-info">
        <div class="recipe-card-name">${r.name}</div>
        <div class="recipe-card-meta">
          <span class="tag">${r.category||'Sonstiges'}</span>
          ${r.prepTime?`<span class="tag">⏱ ${r.prepTime} min</span>`:''}
          ${r.difficulty?`<span class="tag">${r.difficulty}</span>`:''}
        </div>
        <div class="recipe-card-missing">
          ${badge}
          ${missing.length>0?`<span class="missing-items">${missing.slice(0,2).map(m=>m.name).join(', ')}${missing.length>2?' …':''}</span>`:''}
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
      <div class="qr-emoji">${r.emoji||'🍽'}</div>
      <div class="qr-info">
        <div class="qr-name">${r.name}</div>
        <div class="qr-meta">
          ${r.category?`<span>${r.category}</span>`:''}
          ${r.prepTime?`<span>⏱ ${r.prepTime} min</span>`:''}
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
        <div class="detail-emoji">${r.emoji||'🍽'}</div>
        <div class="detail-title">${r.name}</div>
        <div class="detail-tags">
          <span class="tag" style="background:var(--green-light);color:var(--green)">${r.category||'Sonstiges'}</span>
          ${r.prepTime?`<span class="tag">⏱ ${r.prepTime} min</span>`:''}
          ${r.difficulty?`<span class="tag">${r.difficulty}</span>`:''}
        </div>
        ${r.description?`<p class="detail-desc">${r.description}</p>`:''}
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
              <div class="ing-name-col">${ing.name}</div>
              <div class="ing-amount-col">${amt} ${ing.unit||''}</div>
              ${!has?'<div class="ing-missing">fehlt</div>':''}
            </div>`;
          }).join('')}
        </div>
      `:''}

      ${(r.steps||[]).length>0?`
        <div class="steps-block">
          <div class="block-header">👨‍🍳 Zubereitung</div>
          ${(r.steps||[]).map((s,i)=>`<div class="step-row-item"><div class="step-num">${i+1}</div><div class="step-text">${s}</div></div>`).join('')}
        </div>
      `:''}

      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" onclick="addRecipeToShopDirect('${id}')" ${missing.length===0?'disabled':''} title="${missing.length===0?'Alle Zutaten sind im Vorrat':'Nur fehlende Zutaten werden hinzugefügt'}">${missing.length===0?'🛒 Alles vorhanden':`🛒 ${missing.length} fehlende in den Korb`}</button>
        <button class="btn btn-outline btn-sm" onclick="editRecipe('${id}')">✏️ Bearbeiten</button>
        <button class="btn btn-red btn-sm" onclick="deleteRecipe('${id}')">🗑</button>
      </div>
    `;

    document.getElementById('d-minus').onclick=()=>{ if(currentPortions>1){ currentPortions--; render(); } };
    document.getElementById('d-plus').onclick=()=>{ currentPortions++; render(); };
  }

  render();
  showPage('detail-page');
};

window.deleteRecipe=async(id)=>{
  if(!confirm('Rezept wirklich löschen?')) return;
  if(isDemoMode){ delete recipes[id]; renderRecipes(); renderHome(); showPage('recipes-page'); return; }
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

window.addIngRow=(d={})=>{
  const row=document.createElement('div');
  row.className='ing-form-row';
  row.innerHTML=`<input type="text" placeholder="Nudeln" value="${d.name||''}" class="i-name"><input type="number" placeholder="200" value="${d.amount||''}" class="i-amount" min="0" step="0.1"><input type="text" placeholder="g" value="${d.unit||''}" class="i-unit"><button class="remove-btn" onclick="this.parentElement.remove()">×</button>`;
  document.getElementById('r-ingredients').appendChild(row);
};

window.addStepRow=(d='')=>{
  const row=document.createElement('div');
  row.className='step-form-row';
  row.innerHTML=`<textarea rows="2" placeholder="Schritt beschreiben…" class="s-text">${d}</textarea><button class="remove-btn" onclick="this.parentElement.remove()" style="margin-top:2px">×</button>`;
  document.getElementById('r-steps').appendChild(row);
};

window.saveRecipe=async()=>{
  const name=sanitize(document.getElementById('r-name').value.trim());
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
    item.innerHTML=`<span style="font-size:28px">${r.emoji||'🍽'}</span><div style="flex:1"><div style="font-weight:600">${r.name}</div><div style="font-size:12px;color:var(--text2)">${missing.length===0?'✅ Alles vorhanden':'🛒 '+missing.length+' fehlen'}</div></div>`;
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
    container.innerHTML=`<div class="empty-state"><div class="ei" aria-hidden="true">🛒</div><h3>Einkaufsliste ist leer</h3><p>Füge Zutaten manuell hinzu, oder generiere die Liste automatisch aus deinem Wochenplan.</p><div class="empty-state-actions"><button class="btn btn-primary" type="button" onclick="addManualShopItem()">＋ Manuell hinzufügen</button><button class="btn btn-ghost" type="button" onclick="generateShoppingFromWeek()">📅 Aus Wochenplan</button></div></div>`;
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
    html+=`<div class="shopping-group"><div class="shopping-group-header">${CAT_ICONS[cat]||'📦'} ${cat}</div>`;
    items.forEach(([k,v])=>{
      html+=`<div class="shopping-item" onclick="toggleShopItem('${k}')">
        <div class="checkbox"></div>
        <span class="si-name">${v.name}</span>
        ${v.amount?`<span class="si-amount">${v.amount} ${v.unit||''}</span>`:''}
        ${v.from?`<span class="si-from">${v.from}</span>`:''}
      </div>`;
    });
    html+='</div>';
  });

  if(checked.length>0){
    html+=`<div class="shopping-group"><div class="shopping-group-header">✓ Erledigt (${checked.length})</div>`;
    checked.forEach(([k,v])=>{
      html+=`<div class="shopping-item checked" onclick="toggleShopItem('${k}')">
        <div class="checkbox"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></div>
        <span class="si-name">${v.name}</span>
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
        return `<div class="meal-slot ${r?'filled':''}" onclick="openDayModal('${day}','${meal}')">
          <span class="meal-slot-label">${meal}</span>
          ${r?`<span class="meal-slot-emoji">${r.emoji||'🍽'}</span><span class="meal-slot-content">${r.name}</span>`
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
    item.innerHTML=`<span style="font-size:28px">${r.emoji||'🍽'}</span><div style="flex:1"><div style="font-weight:600">${r.name}</div><div style="font-size:12px;color:var(--text2)">${r.category||''} ${r.prepTime?'· ⏱ '+r.prepTime+' min':''}</div></div>`;
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
  const dismissable = ['day-recipe-modal','recipe-shop-modal','invite-modal','family-switcher-modal'];
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
