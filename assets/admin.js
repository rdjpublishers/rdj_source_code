/* ════════════════════════════════════════════════════════════════════
   RDJ SOURCE CODES — Admin Panel (separated from public page)

   This file owns EVERY admin-related concern:
     •  Admin auth (SHA-256 hash check + triple-click trigger)
     •  All admin UI:  login modal, panel modal, every tab, every
        form, every list (Files, Add/Edit, Categories, Arrange,
        GitHub Sync)
     •  Admin CSS, injected lazily and removed on sign-out
     •  Clean-HTML re-serialization for publishing back to GitHub

   The public index.html references ONLY a neutral `.trigger-dot`
   element in its topbar.  Everything else — modals, buttons,
   styles, admin state — is created here at runtime.  The cleartext
   admin password is never stored on the client.
   ════════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────────
   AUTH
   ────────────────────────────────────────────────────────────────── */

const ADMIN_HASH = '26f5f8b67b8a8cf17b2a2e43dc2dea57bfdd1cf27175260280308e356ea8e99d';
const ADMIN_UNLOCK_KEY = 'rdjsc_admin_unlocked';

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isUnlocked() {
  try { return localStorage.getItem(ADMIN_UNLOCK_KEY) === '1'; }
  catch(e) { return false; }
}
function persistUnlock() {
  try { localStorage.setItem(ADMIN_UNLOCK_KEY, '1'); } catch(e) {}
}
function clearUnlock() {
  try { localStorage.removeItem(ADMIN_UNLOCK_KEY); } catch(e) {}
}

/* Trigger-dot color control — only the .trigger-dot element exists
   in the public HTML (no admin ids, classes or markup). */
function setTriggerDotColor(hex) {
  const dot = document.querySelector('.trigger-dot');
  if (dot) dot.style.background = hex || '';
}

/* ──────────────────────────────────────────────────────────────────
   ADMIN STATE
   ────────────────────────────────────────────────────────────────── */

let ADMIN_AUTH = false;
let ADMIN_TAB  = 'files';
let ARRANGE_CAT = '__all__';
let ARRANGE_DRAG_SRC = null;
let EDITING_ID = null;
let EDITING_CAT = null;
let PENDING_MEDIA = null; // {dataUrl?,url?,type,file?}
let PENDING_ZIP   = null; // {dataUrl?,url?,fileName?,size?,file?}
let GH_STATUS = '', GH_MSG = '', GH_PROGRESS = '';

/* ──────────────────────────────────────────────────────────────────
   FILENAME NORMALIZATION — guarantees the right extension on the
   wire, regardless of how the user provided the file
   (file picker, URL paste, or hand-typed filename).
   ────────────────────────────────────────────────────────────────── */
function _forceExt(name, ext) {
  if (name == null || name === '') return name;
  ext = String(ext || '').replace(/^\./, '');
  if (!ext) return name;
  // Split on ? or # so a URL like foo.zip?ver=2 still counts as having .zip
  const cleaned = String(name).split(/[?#]/)[0];
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? name : cleaned + '.' + ext;
}
let ADMIN_CLICK_COUNT = 0, ADMIN_CLICK_TIMER = null;

/* ──────────────────────────────────────────────────────────────────
   ADMIN STYLES — injected lazily when the admin enters, removed
   when they sign out.  Even the stylesheet never ships to public.
   ────────────────────────────────────────────────────────────────── */

const ADMIN_STYLES_ID = 'rdjsc-admin-styles';

const ADMIN_STYLES_CSS = `
/* ── Modal shell ── */
.mw{position:fixed;inset:0;z-index:500;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.78);backdrop-filter:blur(6px);}
.mw.show{display:flex;}
.am{background:var(--surface);border:1px solid var(--bh);border-radius:18px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,0.6);}
.am-hd{padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;}
.am-hd h2{font-family:var(--display);font-size:1.1rem;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;}
.am-hd .am-hd-btns{display:flex;gap:8px;flex-shrink:0;}
.am-hd button.x-btn{background:var(--s3);border:1px solid var(--border);color:var(--muted);width:32px;height:32px;border-radius:50%;font-size:13px;flex-shrink:0;}
.am-hd button.x-btn:hover{color:var(--text);border-color:var(--bh);}
.am-save-close{background:var(--brass);color:#fff;border:none;font-weight:700;font-size:12px;padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:6px;white-space:nowrap;}
.am-save-close:hover{background:var(--brass-l);}
.am-save-local{background:var(--s3);color:var(--text);border:1px solid var(--border);font-weight:700;font-size:12px;padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:6px;white-space:nowrap;transition:all .2s;}
.am-save-local:hover{border-color:var(--teal);color:var(--teal-l);}
.am-save-tip{font-size:11px;font-family:var(--mono);color:var(--teal-l);white-space:nowrap;opacity:0;transition:opacity .25s;}
.am-save-tip.show{opacity:1;}
@media(max-width:560px){.am-save-tip{display:none;}.am-save-close span.full{display:none;}}
.am-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;}
.amt{flex:1;background:none;border:none;padding:12px 8px;font-size:11.5px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap;letter-spacing:.02em;}
.amt.active{color:var(--brass);border-bottom-color:var(--brass);}
.am-body{padding:20px 22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;}

/* ── Form fields ── */
.afl{display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;}
.afsel{width:100%;background:var(--s2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;color:var(--text);font-size:13.5px;outline:none;font-family:var(--sans);}
.afsel:focus{border-color:var(--brass);}
.afrow{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media (max-width:520px){.afrow{grid-template-columns:1fr;}}
.af-hint{font-size:11px;color:var(--dim);line-height:1.5;}
.ntc.err{background:rgba(217,97,79,0.12);border:1px solid rgba(217,97,79,0.4);color:#e58676;}
.ntc.ok{background:var(--teal-p);border:1px solid var(--teal);color:var(--teal-l);}
.ntc.loading{background:var(--brass-p);border:1px solid var(--brass);color:var(--brass-l);}

/* ── File rows ── */
.admin-row-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--border);border-radius:10px;background:var(--s2);}
.ari-thumb{width:44px;height:44px;border-radius:7px;object-fit:cover;background:var(--s3);flex-shrink:0;}
.ari-title{font-size:13px;font-weight:600;color:var(--text);}
.ari-sub{font-size:10.5px;color:var(--muted);font-family:var(--mono);}
.ari-btns{margin-left:auto;display:flex;gap:6px;flex-shrink:0;}
.ari-btn{background:var(--s3);border:1px solid var(--border);color:var(--muted);width:29px;height:29px;border-radius:7px;font-size:12px;display:flex;align-items:center;justify-content:center;}
.ari-btn:hover{border-color:var(--brass);color:var(--brass);}
.ari-btn.del:hover{border-color:var(--danger);color:var(--danger);}

/* ── Categories ── */
.cat-row{display:flex;align-items:center;gap:8px;}
.cat-row .afi{flex:1;}
.cat-emoji-in{width:52px !important;flex:none !important;text-align:center;font-size:18px;padding:6px 4px !important;}

/* ── Password modal ── */
.pw-box{max-width:360px;}
.pw-box .am-body{align-items:center;text-align:center;}
.pw-lock-ic{font-size:2.4rem;margin-bottom:4px;}

/* ── Drop zones & attachments ── */
.drop-zone{border:1.5px dashed var(--border);border-radius:11px;padding:16px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;position:relative;display:block;}
.drop-zone:hover{border-color:var(--brass);background:var(--brass-p);}
.drop-zone input{position:absolute;inset:0;opacity:0;cursor:pointer;}
.drop-zone .dz-txt{font-size:12.5px;color:var(--muted);}
.attach-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;background:var(--s2);margin-top:8px;}
.attach-thumb{width:38px;height:38px;border-radius:6px;object-fit:cover;background:var(--s3);flex-shrink:0;}
.attach-ic{width:38px;height:38px;border-radius:6px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.attach-name{font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.attach-status{font-size:10px;color:var(--muted);font-family:var(--mono);white-space:nowrap;}
.attach-del{background:var(--s3);border:1px solid var(--border);color:var(--muted);width:26px;height:26px;border-radius:6px;font-size:11px;flex-shrink:0;}
.attach-del:hover{border-color:var(--danger);color:var(--danger);}
.or-div{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin:2px 0;}
.or-div::before,.or-div::after{content:'';flex:1;height:1px;background:var(--border);}
.gh-info{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.6;color:var(--muted);}
.gh-info a{color:var(--brass);}
.gh-path-info{font-size:11px;color:var(--muted);background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;}

/* ── Arrange tab ── */
.arrange-cat-pick{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:2px 0 6px;}
.arrange-cat-chip{background:var(--s2);border:1px solid var(--border);color:var(--muted);font-size:11.5px;padding:7px 11px;border-radius:8px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:6px;font-weight:500;font-family:var(--sans);}
.arrange-cat-chip:hover{border-color:var(--brass);color:var(--text);}
.arrange-cat-chip.active{background:var(--brass-p);border-color:var(--brass);color:var(--brass-l);font-weight:600;}
.arrange-cat-chip .arr-cnt{font-family:var(--mono);font-size:10px;opacity:.65;background:var(--s3);padding:1px 5px;border-radius:4px;min-width:18px;text-align:center;}
.arrange-cat-chip.active .arr-cnt{background:var(--brass);color:#1a1204;opacity:1;}
body.light .arrange-cat-chip.active .arr-cnt{color:#fff;}
.arrange-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:4px 0 6px;}
.arrange-bar .arrange-count{font-size:11.5px;color:var(--muted);font-family:var(--mono);}
.arrange-bar .arrange-count b{color:var(--text);}
.arrange-bar-btns{display:flex;gap:6px;}
.arrange-mini{background:var(--s2);border:1px solid var(--border);color:var(--muted);font-size:11px;padding:5px 9px;border-radius:7px;display:flex;align-items:center;gap:5px;cursor:pointer;transition:all .15s;}
.arrange-mini:hover{border-color:var(--brass);color:var(--brass);}
.arrange-mini:disabled{opacity:.35;cursor:not-allowed;}
.arrange-list{display:flex;flex-direction:column;gap:6px;max-height:54vh;overflow-y:auto;padding:2px 4px 4px;margin:0 -4px;}
.arrange-list::-webkit-scrollbar{width:6px;}
.arrange-list::-webkit-scrollbar-track{background:transparent;}
.arrange-list::-webkit-scrollbar-thumb{background:var(--s3);border-radius:3px;}
.arrange-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--s2);cursor:grab;transition:border-color .15s,background .15s,transform .15s,opacity .15s;position:relative;}
.arrange-item:hover{border-color:var(--brass);background:var(--brass-p);}
.arrange-item.dragging{opacity:.35;cursor:grabbing;transform:scale(0.98);}
.arrange-item.drag-over-top{border-top:2px solid var(--brass);}
.arrange-item.drag-over-bottom{border-bottom:2px solid var(--brass);}
.arrange-item.drop-here{background:var(--brass-p);border-color:var(--brass);}
.arrange-handle{color:var(--muted);font-size:16px;cursor:grab;user-select:none;flex-shrink:0;width:18px;text-align:center;line-height:1;letter-spacing:-2px;}
.arrange-item:hover .arrange-handle{color:var(--brass);}
.arrange-pos{font-size:10px;color:var(--dim);font-family:var(--mono);flex-shrink:0;width:26px;text-align:center;background:var(--s3);padding:2px 0;border-radius:5px;}
.arrange-thumb{width:42px;height:42px;border-radius:7px;object-fit:cover;background:var(--s3);flex-shrink:0;}
.arrange-info{flex:1;min-width:0;}
.arrange-title{font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;}
.arrange-meta{font-size:10.5px;color:var(--muted);font-family:var(--mono);display:flex;align-items:center;gap:6px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.arrange-btns{display:flex;gap:4px;flex-shrink:0;}
.arrange-btns button{background:var(--s3);border:1px solid var(--border);color:var(--muted);width:28px;height:28px;border-radius:6px;font-size:10px;display:flex;align-items:center;justify-content:center;transition:all .15s;cursor:pointer;}
.arrange-btns button:hover:not(:disabled){border-color:var(--brass);color:var(--brass-l);background:var(--brass-p);}
.arrange-btns button:disabled{opacity:.3;cursor:not-allowed;}
.arrange-empty{padding:36px 14px;text-align:center;color:var(--muted);font-size:12.5px;border:1.5px dashed var(--border);border-radius:11px;}
.arrange-empty .arr-em{font-size:1.8rem;margin-bottom:6px;opacity:.6;}
.arrange-saved{font-size:10.5px;color:var(--teal-l);font-family:var(--mono);opacity:0;transition:opacity .2s;}
.arrange-saved.show{opacity:1;}

/* ── Trigger-dot unlocked state (green pulse) ── */
.admin-mode .trigger-dot{background:#22c55e !important;animation:rdjsc-dotpulse 1.6s ease-out infinite;}
@keyframes rdjsc-dotpulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,0.55);}70%{box-shadow:0 0 0 7px rgba(34,197,94,0);}100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}}

/* ── Responsive: small phones ── */
@media(max-width:480px){
  .mw{padding:8px;}
  .am{border-radius:14px;max-height:95vh;}
  .am-hd{padding:13px 14px;gap:6px;flex-wrap:wrap;}
  .am-hd h2{font-size:.98rem;gap:6px;}
  .am-hd .am-hd-btns{gap:5px;}
  .am-save-tip{display:none;}
  .am-save-local span.full,.am-save-close span.full{display:none;}
  .am-save-local,.am-save-close{font-size:11px;padding:7px 8px;border-radius:7px;}
  .am-hd button.x-btn{width:28px;height:28px;font-size:12px;}
  .amt{font-size:10.5px;padding:10px 8px;}
  .am-body{padding:14px 16px;gap:12px;}
  .afsel{font-size:13px;padding:9px 11px;border-radius:8px;}
  .afl{font-size:10.5px;}
  .bg{font-size:12.5px;padding:10px 14px;border-radius:9px;}
  .admin-row-item{padding:8px;gap:8px;border-radius:9px;}
  .ari-thumb{width:38px;height:38px;}
  .ari-title{font-size:12px;}
  .ari-sub{font-size:9.5px;}
  .ari-btn{width:28px;height:28px;font-size:11px;border-radius:6px;}
  .drop-zone{padding:14px 10px;border-radius:10px;}
  .drop-zone .dz-txt{font-size:12px;}
  .attach-item{padding:7px 8px;gap:8px;border-radius:8px;}
  .attach-thumb,.attach-ic{width:34px;height:34px;}
  .gh-info{padding:11px 12px;font-size:11.5px;border-radius:9px;}
  .gh-path-info{font-size:10.5px;padding:7px 9px;}
  .cat-emoji-in{width:46px !important;font-size:16px !important;}
  .arrange-cat-pick{gap:5px;}
  .arrange-cat-chip{font-size:10.5px;padding:6px 9px;gap:4px;}
  .arrange-cat-chip .arr-cnt{font-size:9px;padding:1px 4px;}
  .arrange-list{max-height:50vh;gap:5px;}
  .arrange-item{padding:7px 8px;gap:7px;border-radius:9px;}
  .arrange-handle{font-size:14px;width:14px;}
  .arrange-pos{width:22px;font-size:9px;padding:1.5px 0;}
  .arrange-thumb{width:36px;height:36px;border-radius:6px;}
  .arrange-title{font-size:12px;}
  .arrange-meta{font-size:9.5px;gap:4px;}
  .arrange-btns button{width:26px;height:26px;font-size:10px;border-radius:5px;}
  .arrange-mini{font-size:10.5px;padding:5px 7px;}
  .arrange-bar{gap:6px;}
}

/* ── Responsive: tablets & up ── */
@media(min-width:768px){
  .am{max-width:680px;border-radius:18px;}
  .am-hd{padding:18px 22px;}
  .am-hd h2{font-size:1.15rem;}
  .am-body{padding:22px;gap:15px;}
  .amt{font-size:12px;padding:13px 10px;}
}

/* ── Responsive: desktops ── */
@media(min-width:1024px){
  .am{max-width:720px;}
}
`;

function injectAdminStyles() {
  if (document.getElementById(ADMIN_STYLES_ID)) return;
  const s = document.createElement('style');
  s.id = ADMIN_STYLES_ID;
  s.textContent = ADMIN_STYLES_CSS;
  document.head.appendChild(s);
}
function removeAdminStyles() {
  document.getElementById(ADMIN_STYLES_ID)?.remove();
}

/* ──────────────────────────────────────────────────────────────────
   DYNAMIC MODAL BUILDERS
   ────────────────────────────────────────────────────────────────── */

function buildLoginModal() {
  if (document.getElementById('adminLoginWrap')) return;
  injectAdminStyles();
  const wrap = document.createElement('div');
  wrap.className = 'mw';
  wrap.id = 'adminLoginWrap';
  wrap.innerHTML = `
<div class="am pw-box">
  <div class="am-hd"><h2>🔐 Admin Access</h2><button class="x-btn" onclick="closePwModal()">✕</button></div>
  <div class="am-body">
    <div class="pw-lock-ic">🗝️</div>
    <p style="color:var(--muted);font-size:13px;">Enter the admin password to manage files &amp; categories.</p>
    <input class="afi" id="adminPass" type="password" placeholder="Password" style="text-align:center;letter-spacing:.1em;" onkeydown="if(event.key==='Enter')doLogin()">
    <div class="ntc err" id="adminErr" style="display:none;">Incorrect password. Try again.</div>
    <button class="bg" style="width:100%;justify-content:center" onclick="doLogin()">Unlock Admin Panel</button>
  </div>
</div>`;
  document.body.appendChild(wrap);
}
function removeLoginModal() {
  document.getElementById('adminLoginWrap')?.remove();
}

function buildAdminPanel() {
  if (document.getElementById('adminPanelWrap')) return;
  injectAdminStyles();
  const wrap = document.createElement('div');
  wrap.className = 'mw';
  wrap.id = 'adminPanelWrap';
  wrap.innerHTML = `
<div class="am">
  <div class="am-hd">
    <h2>⚙️ Admin</h2>
    <div class="am-hd-btns">
      <span class="am-save-tip" id="am-save-tip">Saved locally ✓</span>
      <button class="am-save-local" onclick="saveLocally()" title="Save changes locally without closing — push to GitHub whenever you're ready">💾 Save Locally</button>
      <button class="am-save-close" onclick="saveAndCloseAdmin()">✅ Save &amp; Sign Out</button>
      <button class="x-btn" onclick="saveAndCloseAdmin()">✕</button>
    </div>
  </div>
  <div class="am-tabs">
    <button class="amt" id="tab-files" onclick="switchAdminTab('files')">Files</button>
    <button class="amt" id="tab-add" onclick="switchAdminTab('add')">Add New</button>
    <button class="amt" id="tab-cats" onclick="switchAdminTab('cats')">Categories</button>
    <button class="amt" id="tab-arrange" onclick="switchAdminTab('arrange')">✨ Arrange</button>
    <button class="amt" id="tab-github" onclick="switchAdminTab('github')">GitHub Sync</button>
  </div>
  <div class="am-body" id="am-body"></div>
</div>`;
  document.body.appendChild(wrap);
}
function removeAdminPanel() {
  document.getElementById('adminPanelWrap')?.remove();
}

/* ──────────────────────────────────────────────────────────────────
   TRIPLE-CLICK TRIGGER
   ────────────────────────────────────────────────────────────────── */

function openAdminEntry() {
  ADMIN_CLICK_COUNT++;
  clearTimeout(ADMIN_CLICK_TIMER);
  if (ADMIN_CLICK_COUNT >= 3) {
    ADMIN_CLICK_COUNT = 0;
    if (ADMIN_AUTH) openAdminPanel();
    else openPwModal();
  } else {
    ADMIN_CLICK_TIMER = setTimeout(() => { ADMIN_CLICK_COUNT = 0; }, 600);
  }
}

function openPwModal() {
  buildLoginModal();
  const wrap = document.getElementById('adminLoginWrap');
  if (!wrap) return;
  wrap.classList.add('show');
  const inp = document.getElementById('adminPass');
  if (inp) inp.value = '';
  const err = document.getElementById('adminErr');
  if (err) err.style.display = 'none';
  setTimeout(() => document.getElementById('adminPass')?.focus(), 80);
}
function closePwModal() {
  document.getElementById('adminLoginWrap')?.classList.remove('show');
}
async function doLogin() {
  const pw = document.getElementById('adminPass')?.value || '';
  const hash = await sha256Hex(pw);
  if (hash === ADMIN_HASH) {
    ADMIN_AUTH = true;
    persistUnlock();
    closePwModal();
    document.body.classList.add('admin-mode');
    buildAdminPanel();
    setTriggerDotColor(''); /* let .admin-mode .trigger-dot rule paint green */
    openAdminPanel();
  } else {
    const err = document.getElementById('adminErr');
    if (err) err.style.display = 'block';
    const inp = document.getElementById('adminPass');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

/* ──────────────────────────────────────────────────────────────────
   ADMIN PANEL — open / close / tabs
   ────────────────────────────────────────────────────────────────── */

function openAdminPanel() {
  buildAdminPanel();
  document.getElementById('adminPanelWrap')?.classList.add('show');
  EDITING_ID = null; PENDING_MEDIA = null; PENDING_ZIP = null;
  switchAdminTab('files');
}
function closeAdminSilently() {
  if (document.getElementById('adminPanelWrap')?.classList.contains('show')) {
    saveAndCloseAdmin();
  }
}

function saveLocally() {
  save();
  renderSidebar(); renderCatTabs(); renderGallery();
  if (ADMIN_TAB === 'github')   renderGitHubTab();
  if (ADMIN_TAB === 'arrange')  renderAdminArrange();
  const tip = document.getElementById('am-save-tip');
  if (tip) {
    tip.textContent = 'Saved locally ✓';
    tip.classList.add('show');
    clearTimeout(window.__saveTipTimer);
    window.__saveTipTimer = setTimeout(() => tip.classList.remove('show'), 1800);
  }
}
function saveAndCloseAdmin() {
  save();
  document.getElementById('adminPanelWrap')?.classList.remove('show');
  ADMIN_AUTH = false;
  EDITING_ID = null; PENDING_MEDIA = null; PENDING_ZIP = null;
  document.body.classList.remove('admin-mode');
  removeAdminPanel();
  removeLoginModal();
  removeAdminStyles();
  setTriggerDotColor('');
  renderSidebar(); renderCatTabs(); renderGallery();
}
function doLogout() { saveAndCloseAdmin(); }

function switchAdminTab(tab) {
  ADMIN_TAB = tab;
  ['files','add','cats','arrange','github'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.classList.toggle('active', t === tab);
  });
  if (tab === 'files')    renderAdminFiles();
  else if (tab === 'add') renderAdminAddForm();
  else if (tab === 'cats')renderAdminCats();
  else if (tab === 'arrange') renderAdminArrange();
  else                    renderGitHubTab();
}

/* ──────────────────────────────────────────────────────────────────
   FILES TAB
   ────────────────────────────────────────────────────────────────── */

function renderAdminFiles() {
  const body = document.getElementById('am-body');
  if (!body) return;
  if (!DATA.files.length) {
    body.innerHTML = `<div class="ntc" style="background:var(--s2);border:1px solid var(--border);">No files yet. Use "Add New" to create one.</div>`;
    return;
  }
  body.innerHTML = DATA.files.map(f => `
    <div class="admin-row-item">
      <img class="ari-thumb" src="${esc(f.mediaUrl)}" onerror="this.src='https://picsum.photos/seed/${f.id}/80/80'">
      <div>
        <div class="ari-title">${esc(f.title)}</div>
        <div class="ari-sub">${catEmoji(f.category)} ${esc(f.category)} · ${esc(extBadge(f.fileName))} · ${f.downloads||0} dl${f.downloadUrl&&f.downloadUrl.startsWith('data:')?' · 💾 local (sync to publish)':''}</div>
      </div>
      <div class="ari-btns">
        <button class="ari-btn" onclick="startEditFile('${f.id}')" title="Edit">✏️</button>
        <button class="ari-btn del" onclick="deleteFile('${f.id}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}
function deleteFile(id) {
  if (!confirm('Delete this file entry? This cannot be undone.')) return;
  DATA.files = DATA.files.filter(f => f.id !== id);
  save();
  renderAdminFiles();
}
function startEditFile(id) {
  EDITING_ID = id;
  const f = DATA.files.find(x => x.id === id);
  PENDING_MEDIA = f ? {
    url:     f.mediaUrl    && !f.mediaUrl.startsWith('data:')    ? f.mediaUrl : undefined,
    dataUrl: f.mediaUrl    &&  f.mediaUrl.startsWith('data:')    ? f.mediaUrl : undefined,
    type:    f.mediaType
  } : null;
  PENDING_ZIP = f ? {
    url:      f.downloadUrl && !f.downloadUrl.startsWith('data:') ? f.downloadUrl : undefined,
    dataUrl:  f.downloadUrl &&  f.downloadUrl.startsWith('data:') ? f.downloadUrl : undefined,
    fileName: f.fileName
  } : null;
  switchAdminTab('add');
}

/* ──────────────────────────────────────────────────────────────────
   ADD / EDIT TAB
   ────────────────────────────────────────────────────────────────── */

function renderAdminAddForm() {
  const editing = EDITING_ID ? DATA.files.find(f => f.id === EDITING_ID) : null;
  const catOptions = DATA.categories.map(c =>
    `<option value="${ea(c)}" ${editing && editing.category === c ? 'selected' : ''}>${catEmoji(c)} ${esc(c)}</option>`
  ).join('');
  const body = document.getElementById('am-body');

  const mediaSrc = PENDING_MEDIA ? (PENDING_MEDIA.dataUrl || PENDING_MEDIA.url) : '';
  const mediaAttach = mediaSrc ? `<div class="attach-item"><img class="attach-thumb" src="${esc(mediaSrc)}"><div class="attach-name">${PENDING_MEDIA.dataUrl ? 'Uploaded image ready' : 'Linked: ' + esc(PENDING_MEDIA.url)}</div><span class="attach-status">${PENDING_MEDIA.dataUrl ? '💾 local' : '🔗 url'}</span><button class="attach-del" onclick="clearMedia()">✕</button></div>` : '';

  const zipSrc = PENDING_ZIP ? (PENDING_ZIP.dataUrl || PENDING_ZIP.url) : '';
  const zipAttach = zipSrc ? `<div class="attach-item"><div class="attach-ic">🗜️</div><div class="attach-name">${esc(PENDING_ZIP.fileName || 'zip file')}</div><span class="attach-status">${PENDING_ZIP.dataUrl ? '💾 local' : '🔗 url'}</span><button class="attach-del" onclick="clearZip()">✕</button></div>` : '';

  body.innerHTML = `
    <div>
      <label class="afl">Title *</label>
      <input class="afi" id="af-title" type="text" placeholder="e.g. Minimal Portfolio Template" value="${editing ? ea(editing.title) : ''}">
    </div>
    <div class="afrow">
      <div>
        <label class="afl">Category *</label>
        <select class="afsel" id="af-cat">${catOptions || '<option value="">Add a category first</option>'}</select>
      </div>
      <div>
        <label class="afl">File name</label>
        <input class="afi" id="af-fname" type="text" placeholder="my-pack.zip" value="${editing ? ea(editing.fileName || '') : ''}">
      </div>
    </div>
    <div>
      <label class="afl">Cover image / GIF *</label>
      <label class="drop-zone" id="media-drop">
        <span class="dz-txt">🖼️ Click or drag an image/GIF here to upload</span>
        <input type="file" id="media-file-in" accept="image/*" onchange="handleMediaFile(this.files);this.value=''">
      </label>
      ${mediaAttach}
      <div class="or-div">or</div>
      <input class="afi" id="af-media-url" type="url" placeholder="Paste an image/GIF URL instead" value="${PENDING_MEDIA && PENDING_MEDIA.url ? ea(PENDING_MEDIA.url) : ''}" oninput="setMediaUrl(this.value)">
    </div>
    <div>
      <label class="afl">Zip source file *</label>
      <label class="drop-zone" id="zip-drop">
        <span class="dz-txt">🗜️ Click or drag a .zip file here to upload</span>
        <input type="file" id="zip-file-in" accept=".zip" onchange="handleZipFile(this.files);this.value=''">
      </label>
      ${zipAttach}
      <div class="or-div">or</div>
      <input class="afi" id="af-zip-url" type="url" placeholder="Paste a direct zip URL instead" value="${PENDING_ZIP && PENDING_ZIP.url ? ea(PENDING_ZIP.url) : ''}" oninput="setZipUrl(this.value)">
      <div class="af-hint">Uploaded zips work instantly for local downloads. Head to the <b>GitHub Sync</b> tab and push to generate a permanent public download link automatically. The system automatically appends <code>.zip</code> to the saved filename and to the GitHub upload path if it's missing — so downloads always come out as a real zip.</div>
    </div>
    <div>
      <label class="afl">Tags (comma separated)</label>
      <input class="afi" id="af-tags" type="text" placeholder="html, css, template" value="${editing ? ea((editing.tags || []).join(', ')) : ''}">
    </div>
    <div class="ntc err" id="af-err" style="display:none"></div>
    <div style="display:flex;gap:10px;">
      ${editing ? `<button class="bg" style="flex:1;justify-content:center;background:var(--s3);color:var(--text);" onclick="cancelEditFile()">Cancel Edit</button>` : ''}
      <button class="bg" style="flex:2;justify-content:center" onclick="submitFileForm()">${editing ? '💾 Save Changes' : '➕ Add File'}</button>
    </div>
  `;
  attachDropHandlers('media-drop', handleMediaFile);
  attachDropHandlers('zip-drop', handleZipFile);
}
function attachDropHandlers(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('dragover',  e => { e.preventDefault(); el.style.borderColor = 'var(--brass)'; });
  el.addEventListener('dragleave', () => { el.style.borderColor = ''; });
  el.addEventListener('drop',      e => { e.preventDefault(); el.style.borderColor = ''; if (e.dataTransfer.files.length) handler(e.dataTransfer.files); });
}
function handleMediaFile(files) {
  const file = files && files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const type = /gif/i.test(file.type) ? 'gif' : 'image';
    PENDING_MEDIA = { dataUrl: e.target.result, file, type };
    renderAdminAddForm();
  };
  reader.readAsDataURL(file);
}
function setMediaUrl(v) {
  v = v.trim();
  if (!v) return;
  const type = /\.gif($|\?)/i.test(v) ? 'gif' : 'image';
  PENDING_MEDIA = { url: v, type };
}
function clearMedia() { PENDING_MEDIA = null; renderAdminAddForm(); }
function handleZipFile(files) {
  const file = files && files[0];
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) { alert('Please choose a .zip file.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    PENDING_ZIP = { dataUrl: e.target.result, file, fileName: file.name, size: file.size };
    const fnameInput = document.getElementById('af-fname');
    if (fnameInput && !fnameInput.value) fnameInput.value = file.name;
    renderAdminAddForm();
  };
  reader.readAsDataURL(file);
}
function setZipUrl(v) {
  v = v.trim();
  if (!v) return;
  const fromUrl = v.split('/').pop() || '';
  PENDING_ZIP = {
    ...(PENDING_ZIP || {}),
    url: v,
    dataUrl: undefined,
    fileName: _forceExt((PENDING_ZIP && PENDING_ZIP.fileName) || fromUrl, 'zip')
  };
}
function clearZip() { PENDING_ZIP = null; renderAdminAddForm(); }
function cancelEditFile() { EDITING_ID = null; PENDING_MEDIA = null; PENDING_ZIP = null; renderAdminAddForm(); }
function submitFileForm() {
  const title    = document.getElementById('af-title').value.trim();
  const category = document.getElementById('af-cat').value;
  let fileName   = document.getElementById('af-fname').value.trim();
  const tags     = document.getElementById('af-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const errDiv   = document.getElementById('af-err');
  errDiv.style.display = 'none';

  const mediaUrl    = PENDING_MEDIA ? (PENDING_MEDIA.dataUrl || PENDING_MEDIA.url) : '';
  const downloadUrl = PENDING_ZIP   ? (PENDING_ZIP.dataUrl   || PENDING_ZIP.url)   : '';
  const mediaType   = PENDING_MEDIA ? PENDING_MEDIA.type : 'image';

  if (!title || !category || !mediaUrl || !downloadUrl) {
    errDiv.textContent = 'Title, category, a cover image/GIF and a zip file are all required.';
    errDiv.style.display = 'block';
    return;
  }
  if (!fileName) fileName = (PENDING_ZIP && PENDING_ZIP.fileName) || (title.replace(/\s+/g, '-').toLowerCase() + '.zip');
  // Always make sure the saved filename has a .zip extension — covers
  // anyone who types a bare name in the "Download filename" field.
  fileName = _forceExt(fileName, 'zip');

  if (EDITING_ID) {
    const idx = DATA.files.findIndex(f => f.id === EDITING_ID);
    if (idx !== -1) {
      DATA.files[idx] = { ...DATA.files[idx], title, category, mediaUrl, mediaType, downloadUrl, fileName, tags };
    }
    EDITING_ID = null;
  } else {
    DATA.files.unshift({
      id: uid(), title, category, mediaUrl, mediaType, downloadUrl, fileName, tags,
      createdAt: new Date().toISOString().slice(0, 10), downloads: 0
    });
  }
  PENDING_MEDIA = null; PENDING_ZIP = null;
  save();
  renderGallery();
  switchAdminTab('files');
}

/* ──────────────────────────────────────────────────────────────────
   CATEGORIES TAB
   ────────────────────────────────────────────────────────────────── */

function renderAdminCats() {
  const body = document.getElementById('am-body');
  const counts = {};
  DATA.files.forEach(f => { counts[f.category] = (counts[f.category] || 0) + 1; });
  const rows = DATA.categories.map((c, i) => {
    if (EDITING_CAT === c) {
      return `<div class="cat-row"><input class="afi cat-emoji-in" id="ec-emoji-${i}" value="${ea(catEmoji(c))}" placeholder="🏷️"><input class="afi" id="ec-in-${i}" value="${ea(c)}"><button class="ari-btn" onclick="saveEditCat('${ea(c)}',${i})" title="Save">💾</button><button class="ari-btn" onclick="EDITING_CAT=null;renderAdminCats()" title="Cancel">✕</button></div>`;
    }
    return `<div class="cat-row"><span style="font-size:18px;width:34px;text-align:center;flex-shrink:0;">${catEmoji(c)}</span><span style="flex:1;font-size:13.5px;">${esc(c)}</span><span style="font-size:10.5px;color:var(--muted);font-family:var(--mono);white-space:nowrap;">${counts[c] || 0} files</span><button class="ari-btn" onclick="EDITING_CAT='${ea(c)}';renderAdminCats()" title="Edit">✏️</button><button class="ari-btn del" onclick="deleteCategory(${i})" title="Delete">🗑️</button></div>`;
  }).join('');
  body.innerHTML = `
    <div class="af-hint">Pick any emoji as a category's icon — paste one you like or type it from your keyboard's emoji picker.</div>
    <div style="display:flex;flex-direction:column;gap:8px;">${rows || '<div class="af-hint">No categories yet.</div>'}</div>
    <div class="cat-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px;">
      <input class="afi cat-emoji-in" id="new-cat-emoji" placeholder="🏷️">
      <input class="afi" id="new-cat-in" placeholder="New category name">
      <button class="bg" onclick="addCategory()">➕</button>
    </div>
  `;
}
function addCategory() {
  const inp = document.getElementById('new-cat-in');
  const emojiInp = document.getElementById('new-cat-emoji');
  const val = inp.value.trim();
  const emoji = emojiInp.value.trim() || '🏷️';
  if (!val) return;
  if (DATA.categories.includes(val)) { inp.value = ''; return; }
  DATA.categories.push(val);
  DATA.categoryEmojis[val] = emoji;
  save();
  renderAdminCats();
  renderSidebar(); renderCatTabs(); renderGallery();
}
function saveEditCat(oldVal, i) {
  const newVal   = document.getElementById('ec-in-' + i).value.trim();
  const newEmoji = document.getElementById('ec-emoji-' + i).value.trim() || '🏷️';
  if (!newVal) return;
  if (DATA.categories.includes(newVal) && newVal !== oldVal) { alert('Category already exists.'); return; }
  DATA.categories = DATA.categories.map(c => c === oldVal ? newVal : c);
  DATA.files.forEach(f => { if (f.category === oldVal) f.category = newVal; });
  if (oldVal !== newVal) delete DATA.categoryEmojis[oldVal];
  DATA.categoryEmojis[newVal] = newEmoji;
  if (ACTIVE_CAT === oldVal) ACTIVE_CAT = newVal;
  EDITING_CAT = null;
  save();
  renderAdminCats();
  renderSidebar(); renderCatTabs(); renderGallery();
}
function deleteCategory(i) {
  const val = DATA.categories[i];
  const count = DATA.files.filter(f => f.category === val).length;
  if (!confirm(`Delete "${val}"?${count ? ` ${count} file(s) will move to "Uncategorized".` : ''}`)) return;
  DATA.categories.splice(i, 1);
  delete DATA.categoryEmojis[val];
  if (!DATA.categories.includes('Uncategorized')) {
    DATA.categories.push('Uncategorized');
    DATA.categoryEmojis['Uncategorized'] = '🏷️';
  }
  DATA.files.forEach(f => { if (f.category === val) f.category = 'Uncategorized'; });
  save();
  renderAdminCats();
  renderSidebar(); renderCatTabs(); renderGallery();
}

/* ──────────────────────────────────────────────────────────────────
   GITHUB SYNC TAB
   ────────────────────────────────────────────────────────────────── */

function renderGitHubTab() {
  const body = document.getElementById('am-body');
  let pendingImgs = 0, pendingZips = 0;
  DATA.files.forEach(f => {
    if (f.mediaUrl    && f.mediaUrl.startsWith('data:'))    pendingImgs++;
    if (f.downloadUrl && f.downloadUrl.startsWith('data:')) pendingZips++;
  });
  const pendingLine = (pendingImgs + pendingZips) > 0
    ? `<div class="ntc loading">📤 ${pendingImgs} cover image(s) and ${pendingZips} zip(s) are stored locally and waiting to be published.</div>`
    : `<div class="ntc" style="background:var(--s2);border:1px solid var(--border);">✅ Nothing pending — everything is already using hosted links.</div>`;
  const statusHtml    = GH_STATUS    ? `<div class="ntc ${GH_STATUS}">${esc(GH_MSG)}</div>` : '';
  const progressHtml  = GH_PROGRESS  ? `<div class="ntc loading" id="gh-progress-msg">${esc(GH_PROGRESS)}</div>` : '';
  body.innerHTML = `
    <div class="gh-info"><strong>Local-first workflow:</strong> add &amp; edit files freely, then use <strong>💾 Save Locally</strong> (top of this panel) to keep everything in your browser without signing out. Come back anytime — your changes stay put until you're ready. When ready to publish, enter your token below and click <strong>Push to GitHub</strong> to batch-upload every pending file and get permanent, automatically-generated download links.<br><br>Works with a <a href="https://github.com/settings/tokens?type=beta" target="_blank">fine-grained token</a> (grant it access to this one repo, with <strong>Contents: Read and write</strong> permission) or a <a href="https://github.com/settings/tokens" target="_blank">classic token</a> with <code>repo</code> scope.</div>
    ${pendingLine}
    ${statusHtml}
    ${progressHtml}
    <div>
      <label class="afl">Personal Access Token</label>
      <input class="afi" id="gh-tok" type="password" placeholder="ghp_…" value="" oninput="GH.token=this.value">
    </div>
    <div class="afrow">
      <div>
        <label class="afl">Owner (GitHub username)</label>
        <input class="afi" id="gh-own" type="text" placeholder="rdjpublishers" value="${ea(GH.owner)}" oninput="GH.owner=this.value">
      </div>
      <div>
        <label class="afl">Repository name</label>
        <input class="afi" id="gh-rep" type="text" placeholder="RDJ-Source-Codes" value="${ea(GH.repo)}" oninput="GH.repo=this.value">
      </div>
    </div>
    <div class="gh-path-info">📁 Pushes to: <strong>github.com/${esc(GH.owner || 'owner')}/${esc(GH.repo || 'repo')}/index.html</strong> · Images: <code>images/img-*.ext</code> · Zips: <code>zips/*.zip</code></div>
    <div class="af-hint">Files larger than roughly 40–45&nbsp;MB may fail to upload through this method (GitHub's Contents API has a practical size limit). For bigger archives, host the zip elsewhere and paste its direct link in the Add New tab instead.</div>
    <button class="bg" style="width:100%;justify-content:center" onclick="ghPush()">🚀 Push to GitHub</button>
  `;
}
function ghSync() {
  GH.token = (document.getElementById('gh-tok') || { value: GH.token }).value || GH.token;
  GH.owner = (document.getElementById('gh-own') || { value: GH.owner }).value || GH.owner;
  GH.repo  = (document.getElementById('gh-rep') || { value: GH.repo  }).value || GH.repo;
  GH.path  = 'index.html';
}
async function uploadDataUrlToRepo(dataUrl, token, owner, repo, folder, preferredName) {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid data URL');
  const mime = matches[1];
  const b64  = matches[2];
  // zips/ always lands as .zip on the wire; images/ follows the MIME
  // (e.g. image/gif -> .gif, image/png -> .png) so GitHub raw serves
  // the right Content-Type and the browser/OS recognizes the file.
  // image/jpeg is normalized to .jpg because that's the form every
  // browser/photo app expects.
  const mimeExtRaw = (mime.split('/')[1] || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mimeExt = mimeExtRaw === 'jpeg' ? 'jpg' : mimeExtRaw;
  const wantExt = folder === 'zips' ? 'zip' : mimeExt;
  const safeBase = preferredName
    ? preferredName.replace(/[^a-zA-Z0-9._-]/g, '-')
    : ('file-' + Date.now());
  const safeName = _forceExt(safeBase, wantExt);
  const fname = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 5) + '-' + safeName;
  const api   = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + fname;
  const put   = await fetch(api, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Add ' + folder + ' file — ' + new Date().toLocaleString(), content: b64 })
  });
  if (!put.ok) {
    const e = await put.json().catch(() => ({}));
    if (put.status === 403 || put.status === 404) throw new Error('Access denied for ' + fname + ' — check the token has Contents: Read and write access to this repo.');
    throw new Error(e.message || 'Upload failed for ' + fname);
  }
  return 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/main/' + fname;
}
async function ghPush() {
  ghSync();
  if (!GH.token || !GH.owner || !GH.repo) {
    GH_STATUS = 'err'; GH_MSG = 'Fill in Token, Owner and Repository.'; GH_PROGRESS = '';
    renderGitHubTab(); return;
  }
  GH_STATUS = 'loading'; GH_MSG = ''; GH_PROGRESS = 'Scanning for local files…';
  renderGitHubTab();
  const token = GH.token, owner = GH.owner, repo = GH.repo;

  const imgJobs = [];
  const zipJobs = [];
  DATA.files.forEach(f => {
    if (f.mediaUrl    && f.mediaUrl.startsWith('data:')) imgJobs.push(f);
    if (f.downloadUrl && f.downloadUrl.startsWith('data:')) zipJobs.push(f);
  });
  const total = imgJobs.length + zipJobs.length;
  let done = 0;

  try {
    for (const f of imgJobs) {
      done++;
      GH_PROGRESS = 'Uploading cover image ' + done + ' of ' + total + '…';
      const el = document.getElementById('gh-progress-msg'); if (el) el.textContent = GH_PROGRESS;
      const url = await uploadDataUrlToRepo(f.mediaUrl, token, owner, repo, 'images', f.id + '-cover');
      f.mediaUrl = url;
    }
    for (const f of zipJobs) {
      done++;
      GH_PROGRESS = 'Uploading zip ' + done + ' of ' + total + '…';
      const el = document.getElementById('gh-progress-msg'); if (el) el.textContent = GH_PROGRESS;
      const url = await uploadDataUrlToRepo(f.downloadUrl, token, owner, repo, 'zips', f.fileName || (f.id + '.zip'));
      f.downloadUrl = url;
    }
  } catch (e) {
    GH_STATUS = 'err'; GH_MSG = '❌ ' + (e.message || 'Upload failed.'); GH_PROGRESS = '';
    save(); renderGitHubTab(); return;
  }
  save();
  GH_PROGRESS = total > 0 ? 'All files uploaded. Publishing index.html…' : 'Publishing index.html…';
  const el2 = document.getElementById('gh-progress-msg'); if (el2) el2.textContent = GH_PROGRESS;

  try {
    const OPEN  = '<script id="site-data" type="application/json">';
    const CLOSE = '<' + '/script>';
    const newData = JSON.stringify(DATA, null, 2);

    /* Build a *clean* HTML page from the current document — same
       approach as the main RDJ site: take document.documentElement.outerHTML,
       then drop any transient runtime state (open modals, inline overflow,
       notice banners) before serializing.  The trigger-dot and the assets/
       admin.js reference survive untouched, so the published file is
       still admin-capable. */
    let pageHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    pageHtml = pageHtml.replace(/(<input[^>]*id="gh-tok"[^>]*value=")[^"]*(")/g, '$1$2');
    pageHtml = pageHtml.replace(/\s*class="mw show"/g,    ' class="mw"');
    pageHtml = pageHtml.replace(/\s*class="overlay show"/g,' class="overlay"');
    pageHtml = pageHtml.replace(/\s*class="sidebar open"/g,' class="sidebar"');
    pageHtml = pageHtml.replace(/(<body\b[^>]*?)\s*style="overflow:\s*hidden;?"/i, '$1');
    pageHtml = pageHtml.replace(/<div class="ntc (?:loading|ok|err)"[^>]*>[\s\S]*?<\/div>/g, '');

    const si = pageHtml.indexOf(OPEN);
    const ei = pageHtml.indexOf(CLOSE, si + OPEN.length);
    if (si === -1 || ei === -1) throw new Error('Data block not found — reload and try again.');
    pageHtml = pageHtml.slice(0, si + OPEN.length) + '\n' + newData + '\n' + pageHtml.slice(ei);

    const apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/index.html';
    const hdr = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
    let sha;
    const getRes = await fetch(apiUrl, { headers: hdr });
    if (getRes.ok) sha = (await getRes.json()).sha;
    else if (getRes.status === 403 || getRes.status === 404) throw new Error('Access denied — check the token has Contents: Read and write access to ' + owner + '/' + repo + '.');
    else if (getRes.status !== 404) throw new Error('GitHub API: ' + getRes.status);

    const content = btoa(unescape(encodeURIComponent(pageHtml)));
    const body = { message: 'Update RDJ Source Codes — ' + new Date().toLocaleString() + (total > 0 ? ' (' + total + ' file' + (total !== 1 ? 's' : '') + ' uploaded)' : ''), content };
    if (sha) body.sha = sha;
    const putRes = await fetch(apiUrl, { method: 'PUT', headers: hdr, body: JSON.stringify(body) });
    if (!putRes.ok) {
      const e = await putRes.json().catch(() => ({}));
      if (putRes.status === 403 || putRes.status === 404) throw new Error('Access denied — check the token has Contents: Read and write access to ' + owner + '/' + repo + '.');
      throw new Error(e.message || 'Push failed: ' + putRes.status);
    }
    GH_STATUS = 'ok';
    GH_MSG = '✅ Published to github.com/' + owner + '/' + repo + (total > 0 ? ' — ' + total + ' file' + (total !== 1 ? 's' : '') + ' uploaded' : '') + '. Site updates in ~30 sec (via GitHub Pages, if enabled).';
    GH_PROGRESS = '';
    GH.token = ''; saveGH();
    renderGallery(); renderAdminFiles(); renderGitHubTab();
  } catch (e) {
    GH_STATUS = 'err'; GH_MSG = '❌ ' + (e.message || 'Push failed.'); GH_PROGRESS = ''; renderGitHubTab();
  }
}

/* ──────────────────────────────────────────────────────────────────
   ARRANGE TAB (drag-to-reorder + per-category sort helpers)
   ────────────────────────────────────────────────────────────────── */

function arrangeViewItems() {
  const out = [];
  let pos = 0;
  for (let i = 0; i < DATA.files.length; i++) {
    const f = DATA.files[i];
    if (ARRANGE_CAT === '__all__' || f.category === ARRANGE_CAT) {
      out.push({ f, absIdx: i, pos: pos++ });
    }
  }
  return out;
}
function renderAdminArrange() {
  const body = document.getElementById('am-body');
  const cats = ['__all__', ...DATA.categories];
  const chipHtml = cats.map(c => {
    const isAll = c === '__all__';
    const label = isAll ? '📦 All Files' : (catEmoji(c) + ' ' + c);
    const count = isAll ? DATA.files.length : DATA.files.filter(f => f.category === c).length;
    const safeKey = isAll ? c : ea(c);
    return `<button class="arrange-cat-chip ${ARRANGE_CAT === c ? 'active' : ''}" onclick="setArrangeCat('${safeKey}')">${label}<span class="arr-cnt">${count}</span></button>`;
  }).join('');

  const items = arrangeViewItems();
  let listHtml;
  if (!items.length) {
    listHtml = `<div class="arrange-empty"><div class="arr-em">📭</div>No files in this category yet.<br>Add some from the <b>Add New</b> tab first.</div>`;
  } else {
    listHtml = `<div class="arrange-list" id="arrange-list">${
      items.map(({ f, pos }) => `
        <div class="arrange-item" draggable="true" data-id="${f.id}" data-pos="${pos}">
          <div class="arrange-handle" title="Drag to reorder">⋮⋮</div>
          <span class="arrange-pos">#${pos + 1}</span>
          <img class="arrange-thumb" src="${esc(f.mediaUrl)}" onerror="this.src='https://picsum.photos/seed/${f.id}/80/80'">
          <div class="arrange-info">
            <div class="arrange-title">${esc(f.title)}</div>
            <div class="arrange-meta">${catEmoji(f.category)} ${esc(f.category)} · ${esc(extBadge(f.fileName))}</div>
          </div>
          <div class="arrange-btns">
            <button onclick="arrangeMove('${f.id}','up')"     title="Move up"     ${pos === 0 ? 'disabled' : ''}>▲</button>
            <button onclick="arrangeMove('${f.id}','down')"   title="Move down"   ${pos === items.length - 1 ? 'disabled' : ''}>▼</button>
            <button onclick="arrangeMove('${f.id}','top')"    title="Move to top" ${pos === 0 ? 'disabled' : ''}>⤒</button>
            <button onclick="arrangeMove('${f.id}','bottom')" title="Move to bottom" ${pos === items.length - 1 ? 'disabled' : ''}>⤓</button>
          </div>
        </div>`).join('')
    }</div>`;
  }

  body.innerHTML = `
    <div class="af-hint">Pick a category, then <strong>drag</strong> the rows to rearrange — or use the ▲▼⤒⤓ buttons. Order is saved locally. Switch the gallery sort to <strong>"Custom order"</strong> to see it on the public view.</div>
    <div class="arrange-cat-pick">${chipHtml}</div>
    ${items.length ? `
      <div class="arrange-bar">
        <div class="arrange-count">Showing <b>${items.length}</b> file${items.length === 1 ? '' : 's'} in <b>${esc(ARRANGE_CAT === '__all__' ? 'All Files' : ARRANGE_CAT)}</b></div>
        <div class="arrange-bar-btns">
          <button class="arrange-mini" onclick="arrangeSortAZ()"   title="Sort A–Z within this category">🔤 A–Z</button>
          <button class="arrange-mini" onclick="arrangeReverse()"  title="Reverse current order">🔃 Reverse</button>
        </div>
      </div>` : ''}
    ${listHtml}
  `;
  attachArrangeDragHandlers();
}
function setArrangeCat(cat) {
  ARRANGE_CAT = cat;
  renderAdminArrange();
}
function arrangeReorderAbs(srcAbsIdx, targetAbsIdx) {
  if (srcAbsIdx === targetAbsIdx) return;
  if (srcAbsIdx < 0 || srcAbsIdx >= DATA.files.length) return;
  if (targetAbsIdx < 0 || targetAbsIdx >= DATA.files.length) return;
  const moved = DATA.files.splice(srcAbsIdx, 1)[0];
  DATA.files.splice(targetAbsIdx, 0, moved);
  save();
  renderAdminArrange();
  renderGallery();
  flashArrangeSaved();
}
function arrangeMove(id, dir) {
  const items = arrangeViewItems();
  const cur = items.findIndex(x => x.f.id === id);
  if (cur === -1) return;
  const curAbs = items[cur].absIdx;
  if (dir === 'up'   && cur === 0) return;
  if (dir === 'down' && cur === items.length - 1) return;
  let targetView;
  if      (dir === 'up')      targetView = cur - 1;
  else if (dir === 'down')    targetView = cur + 1;
  else if (dir === 'top')     targetView = 0;
  else if (dir === 'bottom')  targetView = items.length - 1;
  else return;
  const targetAbs = items[targetView].absIdx;
  arrangeReorderAbs(curAbs, targetAbs);
}
function arrangeSortAZ() {
  const items = arrangeViewItems();
  if (items.length < 2) return;
  const sorted = items.slice().sort((a, b) => a.f.title.localeCompare(b.f.title));
  const positions = items.map(x => x.absIdx).sort((a, b) => a - b);
  sorted.forEach((it, i) => { DATA.files[positions[i]] = it.f; });
  save();
  renderAdminArrange();
  renderGallery();
  flashArrangeSaved();
}
function arrangeReverse() {
  const items = arrangeViewItems();
  if (items.length < 2) return;
  const reversed = items.slice().reverse();
  const positions = items.map(x => x.absIdx).sort((a, b) => a - b);
  reversed.forEach((it, i) => { DATA.files[positions[i]] = it.f; });
  save();
  renderAdminArrange();
  renderGallery();
  flashArrangeSaved();
}
function flashArrangeSaved() {
  const body = document.getElementById('am-body');
  if (!body) return;
  let el = document.getElementById('arr-saved-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'arr-saved-flash';
    el.className = 'arrange-saved show';
    el.textContent = '✓ Order updated';
    el.style.cssText = 'text-align:center;margin-top:4px;';
    body.appendChild(el);
  } else { el.classList.add('show'); }
  clearTimeout(window.__arrFlashTimer);
  window.__arrFlashTimer = setTimeout(() => { el && el.classList.remove('show'); }, 1200);
}
function attachArrangeDragHandlers() {
  const list = document.getElementById('arrange-list');
  if (!list) return;
  const items = list.querySelectorAll('.arrange-item');
  items.forEach(item => {
    item.addEventListener('dragstart', e => {
      ARRANGE_DRAG_SRC = item.dataset.id;
      item.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ARRANGE_DRAG_SRC);
        const ghost = item.cloneNode(true);
        ghost.style.cssText = 'position:absolute;top:-1000px;opacity:.85;width:' + item.offsetWidth + 'px;';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => ghost.remove(), 0);
      } catch (_) {}
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.arrange-item').forEach(x => { x.classList.remove('drag-over-top', 'drag-over-bottom', 'drop-here'); });
      ARRANGE_DRAG_SRC = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!ARRANGE_DRAG_SRC || item.dataset.id === ARRANGE_DRAG_SRC) return;
      const r = item.getBoundingClientRect();
      const above = (e.clientY - r.top) < r.height / 2;
      list.querySelectorAll('.arrange-item').forEach(x => x.classList.remove('drag-over-top', 'drag-over-bottom'));
      item.classList.add(above ? 'drag-over-top' : 'drag-over-bottom');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      const srcId = e.dataTransfer.getData('text/plain') || ARRANGE_DRAG_SRC;
      const dstId = item.dataset.id;
      if (!srcId || srcId === dstId) return;
      const r = item.getBoundingClientRect();
      const above = (e.clientY - r.top) < r.height / 2;
      const dstAbs = DATA.files.findIndex(f => f.id === dstId);
      const srcAbs = DATA.files.findIndex(f => f.id === srcId);
      if (srcAbs === -1 || dstAbs === -1) return;
      let targetAbs;
      if (above) targetAbs = srcAbs < dstAbs ? dstAbs     : dstAbs;
      else       targetAbs = srcAbs < dstAbs ? dstAbs     : dstAbs + 1;
      arrangeReorderAbs(srcAbs, targetAbs);
    });
  });
}

/* ──────────────────────────────────────────────────────────────────
   ESC closes admin / lightbox
   ────────────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof CURRENT_LB !== 'undefined' && CURRENT_LB) closeLB();
    closeAdminSilently();
    closePwModal();
  }
});

/* ──────────────────────────────────────────────────────────────────
   INIT — wire up the trigger dot, restore unlock state
   ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  /* The .trigger-dot is the only admin-related markup in the public
     HTML. Triple-click it for login; the visible color change to
     green is driven by the .admin-mode class + ADMIN_STYLES_CSS. */
  const dot = document.querySelector('.trigger-dot');
  if (dot) dot.addEventListener('click', openAdminEntry);

  /* Restore unlock state across refresh.  The panel is NOT auto-opened
     — the owner still triple-clicks the dot for one-tap access
     (no password needed once unlocked). */
  if (isUnlocked()) {
    ADMIN_AUTH = true;
    document.body.classList.add('admin-mode');
    buildAdminPanel();
  }
});
