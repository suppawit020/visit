/* ─────────────────────────────────────────
   Visit / DC Check  —  app.js (Safe SQL Edition)
   ───────────────────────────────────────── */

const PROFILE_KEY = 'outlet_profile_v1';
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };

// 🚀 1. ตั้งค่า Supabase แบบปลอดภัย (ไม่ทำให้เว็บค้าง) 🚀
const SUPABASE_URL = 'https://tphoxfcoynxfnvpvzkfv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YnMJCwa2jB_uhegOALtL6Q_DMiR--1X';
let supabaseClient = null;

try {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.warn("ไม่พบ Supabase Script: ระบบจะทำงานแบบ Offline");
    }
} catch (e) {
    console.error("เกิดข้อผิดพลาดในการเชื่อมต่อ:", e);
}

/* ── Init ── */
(function init() {
    loadProfile();
    populateProfileForm();
    document.getElementById('f-date').value = today();
    bindPhotoInput();
    bindDropZone();
    bindPositionToggle();

    // ดึงข้อมูลจาก SQL (ถ้าเชื่อมต่อสำเร็จ)
    if (supabaseClient) {
        loadVisitsFromDB();
    } else {
        updateCount();
    }
})();

/* ── Profile ── */
function loadProfile() {
    try {
        const savedPf = JSON.parse(localStorage.getItem(PROFILE_KEY));
        if (savedPf) userProfile = savedPf;
    } catch (e) {}
}

function populateProfileForm() {
    document.getElementById('pf-name').value = userProfile.name || '';
    document.getElementById('pf-email').value = userProfile.email || '';
    document.getElementById('pf-position').value = userProfile.position || '';
}

function saveProfile() {
    userProfile.name = document.getElementById('pf-name').value.trim();
    userProfile.email = document.getElementById('pf-email').value.trim();
    userProfile.position = document.getElementById('pf-position').value.trim();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    toast('Profile saved successfully!');
}

/* ── SQL Data Loader ── */
async function loadVisitsFromDB() {
    try {
        const { data, error } = await supabaseClient
            .from('visits')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            visits = data.map(v => ({
                id: v.id,
                outlet: v.outlet,
                area: v.area,
                person: v.person,
                position: v.position,
                date: v.date,
                reason: v.reason,
                result: v.result,
                photos: v.photos || [],
                creatorName: v.creator_name,
                creatorEmail: v.creator_email,
                creatorPosition: v.creator_position
            }));
            updateCount();
            if (document.getElementById('tab-list').style.display !== 'none') renderList();
        }
    } catch (e) {
        console.error("ดึงข้อมูลล้มเหลว:", e);
    }
}

/* ── Tab switching (โครงสร้างเดิม) ── */
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((t, i) =>
        t.classList.toggle('active',
            (tab === 'new' && i === 0) ||
            (tab === 'list' && i === 1) ||
            (tab === 'profile' && i === 2)
        )
    );
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('tab-profile').style.display = tab === 'profile' ? '' : 'none';
    if (tab === 'list') renderList();
}

/* ── Position "ETC" toggle (โครงสร้างเดิม) ── */
function bindPositionToggle() {
    document.getElementById('f-position').addEventListener('change', function() {
        document.getElementById('pos-other-wrap').style.display =
            this.value === '__other__' ? '' : 'none';
    });
}

function getPosition() {
    const s = document.getElementById('f-position').value;
    return s === '__other__' ?
        document.getElementById('f-pos-other').value.trim() :
        s;
}

/* ── Photos (โครงสร้างเดิม) ── */
function bindPhotoInput() {
    document.getElementById('f-photos').addEventListener('change', function() {
        handlePhotos(this.files);
        this.value = '';
    });
}

function bindDropZone() {
    const dz = document.getElementById('drop-zone');
    dz.addEventListener('dragover', e => {
        e.preventDefault();
        dz.style.borderColor = 'var(--primary)';
        dz.style.background = '#F4F7F5';
    });
    dz.addEventListener('dragleave', () => {
        dz.style.borderColor = '';
        dz.style.background = '';
    });
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.style.borderColor = '';
        dz.style.background = '';
        handlePhotos(e.dataTransfer.files);
    });
}

async function handlePhotos(files) {
    for (const f of Array.from(files)) {
        if (photos.length >= 10) break;
        photos.push(await toBase64(f));
    }
    renderPreviews();
}

function toBase64(file) {
    return new Promise(res => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.readAsDataURL(file);
    });
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = photos.length + ' / 10';

    const prompt = document.getElementById('upload-prompt');
    if (prompt) {
        prompt.style.display = photos.length > 0 ? 'none' : 'flex';
    }

    document.getElementById('previews').innerHTML = photos
        .map((p, i) => `
      <div class="photo-thumb">
        <img src="${p}" alt="">
        <button onclick="removePhoto(${i})">✕</button>
      </div>`)
        .join('');
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
}

/* ── SQL Photo Uploader ── */
async function uploadPhotosToStorage(recordId) {
    let uploadedUrls = [];
    if (!supabaseClient) return uploadedUrls;

    for (let i = 0; i < photos.length; i++) {
        try {
            const res = await fetch(photos[i]);
            const blob = await res.blob();
            const ext = blob.type.split('/')[1] || 'jpg';
            const fileName = `${recordId}/photo_${Date.now()}_${i}.${ext}`;

            const { data, error } = await supabaseClient.storage
                .from('visit_photos')
                .upload(fileName, blob);

            if (!error) {
                const { data: urlData } = supabaseClient.storage.from('visit_photos').getPublicUrl(fileName);
                uploadedUrls.push(urlData.publicUrl);
            }
        } catch (e) { console.error("Upload error:", e); }
    }
    return uploadedUrls;
}

/* ── Save (อัปเดตเพื่อบันทึกลง SQL) ── */
async function saveVisit() {
    const outlet = document.getElementById('f-outlet').value.trim();
    const area = document.getElementById('f-area').value;
    const person = document.getElementById('f-person').value.trim();
    const position = getPosition();
    const date = document.getElementById('f-date').value;
    const reason = document.getElementById('f-reason').value.trim();
    const result = document.getElementById('f-result').value.trim();

    if (!outlet || !area || !person || !position || !date || !reason || !result) {
        toast('Please fill in all required fields.', false);
        return;
    }

    if (!supabaseClient) {
        toast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้', false);
        return;
    }

    const saveBtn = document.querySelector('.btn-primary');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    toast('กำลังอัปโหลดข้อมูล...', true);

    try {
        const id = Date.now().toString();
        const photoUrls = await uploadPhotosToStorage(id);

        const payload = {
            id: id,
            outlet: outlet,
            area: area,
            person: person,
            position: position,
            date: date,
            reason: reason,
            result: result,
            photos: photoUrls,
            creator_name: userProfile.name,
            creator_email: userProfile.email,
            creator_position: userProfile.position
        };

        const { error } = await supabaseClient.from('visits').insert([payload]);
        if (error) throw error;

        toast('Visit saved successfully!');
        clearForm();
        loadVisitsFromDB();

    } catch (error) {
        console.error(error);
        toast('เกิดข้อผิดพลาดในการบันทึก', false);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Visit';
    }
}

function clearForm() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result']
    .forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-area').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('pos-other-wrap').style.display = 'none';
    document.getElementById('f-date').value = today();
    photos = [];
    renderPreviews();
}

/* ── Visit list (โครงสร้างเดิม) ── */
function renderList() {
    const area = document.getElementById('fl-area').value;
    const pos = document.getElementById('fl-pos').value;
    const q = document.getElementById('fl-search').value.toLowerCase();

    const filtered = visits.filter(v => {
        if (area && v.area !== area) return false;
        if (pos && v.position !== pos) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');

    if (!filtered.length) {
        el.innerHTML = `<div class="empty-state"><p>No visits found.</p></div>`;
        return;
    }

    el.innerHTML = filtered.map(v => `
    <div class="visit-card" onclick="openDetail('${v.id}')">
      <div class="vc-header">
        <span class="vc-name">${esc(v.outlet)}</span>
        <span class="vc-date">${fmtDate(v.date)}</span>
      </div>
      <div class="vc-meta">
        <span class="badge badge-area">${v.area}</span>
        <span class="badge badge-pos">${esc(v.position)}</span>
        <span class="vc-person">${esc(v.person)}</span>
      </div>
      <div class="vc-reason">${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}</div>
      ${renderThumbStrip(v.photos)}
    </div>
  `).join('');
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';
    const visible = ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}" alt=""></div>`).join('');
    const extra = ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : '';
    return `<div class="vc-thumbs">${visible}${extra}</div>`;
}

/* ── Detail view (2 Columns - โครงสร้างเดิม) ── */
function openDetail(id) {
    const v = visits.find(x => x.id === id);
    if (!v) return;

    const visitInfo = [
        ['Outlet Name', v.outlet],
        ['Area', v.area],
        ['Visit Date', fmtDate(v.date)],
        ['Person Met', v.person],
        ['Their Position', v.position],
        ['Reason for Visit', v.reason],
        ['Result of Visit', v.result]
    ];

    const visitorInfo = [
        ['Visited By', v.creatorName || '-'],
        ['Visitor Email', v.creatorEmail || '-'],
        ['Visitor Position', v.creatorPosition || '-']
    ];

    const renderFields = (rows) => rows.map(([l, val]) => `
    <div class="detail-field">
      <span class="detail-label">${l}</span>
      <span class="detail-value">${esc(val)}</span>
    </div>`).join('');

    const photosHtml = v.photos.length ?
        `<div style="border-top:1px dashed #EBEBEB; margin:20px 0;"></div>
       <div class="detail-label" style="margin-bottom:8px">Photos (${v.photos.length})</div>
       <div class="detail-photos">
         ${v.photos.map(p => `<div class="detail-photo" onclick="openLightbox('${p}')"><img src="${p}" alt=""></div>`).join('')}
       </div>`
    : '';

  document.getElementById('detail-content').innerHTML = `
    <h2 style="font-size:18px;font-weight:600;margin-bottom:1.5rem;color:var(--text-main)">${esc(v.outlet)}</h2>
    
    <div class="detail-grid">
      <div class="detail-col-main">
        ${renderFields(visitInfo)}
      </div>
      
      <div class="detail-col-visitor">
        <div style="font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;margin-bottom:12px;letter-spacing:0.05em;">Visitor Profile</div>
        ${renderFields(visitorInfo)}
      </div>
    </div>

    ${photosHtml}

    <div class="detail-actions">
      <button class="btn-secondary btn-danger" onclick="deleteVisit('${v.id}')">Delete record</button>
    </div>
  `;

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
}

async function deleteVisit(id) {
  if (!confirm('Delete this visit record permanently?')) return;
  
  if (supabaseClient) {
      const { error } = await supabaseClient.from('visits').delete().eq('id', id);
      if(error) {
          toast('Failed to delete: ' + error.message, false);
          return;
      }
  }

  closeDetail();
  loadVisitsFromDB();
  toast('Record deleted.');
}

/* ── Lightbox (โครงสร้างเดิม) ── */
function openLightbox(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

/* ── Helpers (โครงสร้างเดิม) ── */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`;
}

function updateCount() {
  document.getElementById('rec-count').textContent =
    visits.length + (visits.length === 1 ? ' record' : ' records');
}

function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = ok ? 'var(--primary)' : 'var(--danger)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}