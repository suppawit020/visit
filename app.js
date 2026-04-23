// 🌟 ประกาศตัวแปรไว้บนสุด ป้องกันบัค Initialization
let cameraStream = null;
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };
let currentPage = 0;
const PAGE_SIZE = 20;
let pendingSaveData = null;
let deleteTargetId = null;
let userRequests = [];

const PROFILE_KEY = 'outlet_profile_v1';
const SUPABASE_URL = 'https://yvbhrtuuhbvhdsmczsxr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_j32shAkGAVH3CaSJmtjhpA__Sz6yBj5';
let supabaseClient = null;

try { if (typeof window.supabase !== 'undefined') supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch (e) { console.error(e); }

(function init() {
    loadProfile();
    populateProfileForm();
    document.getElementById('f-date').value = today();
    document.getElementById('f-position').addEventListener('change', function() { document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none'; });
    document.getElementById('cb-next-visit').addEventListener('change', function() {
        document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
        if (this.checked) document.getElementById('f-next-date').value = today();
    });
    updateFormState();
    switchTab(isProfileComplete() ? 'new' : 'profile');
    if (supabaseClient) loadVisitsFromDB();
})();

function loadProfile() { try { const saved = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (saved) userProfile = saved; } catch (e) {} }

function populateProfileForm() {
    document.getElementById('pf-name').value = userProfile.name || '';
    document.getElementById('pf-email').value = userProfile.email || '';
    document.getElementById('pf-position').value = userProfile.position || '';
}

function isProfileComplete() { return userProfile.name !== '' && userProfile.email !== ''; }

function saveProfile() {
    userProfile = { name: document.getElementById('pf-name').value.trim(), email: document.getElementById('pf-email').value.trim(), position: document.getElementById('pf-position').value.trim() };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    updateFormState();
    if (isProfileComplete()) { toast('Profile saved.');
        switchTab('new'); } else { toast('Please complete all fields.', false); }
}

function updateFormState() {
    const btn = document.getElementById('btn-start-cam');
    if (btn) { btn.disabled = !isProfileComplete();
        btn.style.opacity = isProfileComplete() ? '1' : '0.5'; }
}

async function loadVisitsFromDB() {
    if (!supabaseClient) return;
    try {
        const { data: reqData } = await supabaseClient.from('delete_requests').select('*');
        userRequests = reqData || [];
        const { data, error } = await supabaseClient.from('visits').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        visits = data || [];
        updateCount();
        if (document.getElementById('tab-list').style.display !== 'none') renderList();
    } catch (e) { console.error(e); }
}

function switchTab(tab) {
    if (tab === 'new' && !isProfileComplete()) { toast('Complete profile first.', false);
        tab = 'profile'; }
    if (tab !== 'new') stopCamera();
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (tab === 'profile' && i === 0) || (tab === 'new' && i === 1) || (tab === 'list' && i === 2)));
    document.getElementById('tab-profile').style.display = tab === 'profile' ? '' : 'none';
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';
    if (tab === 'list') { renderList(); if (supabaseClient) loadVisitsFromDB(); }
}

function getPosition() { const s = document.getElementById('f-position').value; return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s; }

/* ── 📸 แก้ไขระบบกล้อง ── */
async function startCamera() {
    if (!isProfileComplete()) return;
    const video = document.getElementById('camera-view');
    updateMiniGalleryThumb();
    try {
        // เช็คและปิดกล้องเก่าก่อนเปิดใหม่เสมอ
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = cameraStream;
        document.getElementById('camera-modal').classList.add('open');
        updateModalCounter();
    } catch (e) { toast('Cannot access camera. Check permissions.', false); }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    document.getElementById('camera-modal').classList.remove('open');
    closeCameraGallery();
}

function capturePhoto() {
    if (photos.length >= 10) return;
    const v = document.getElementById('camera-view'),
        c = document.getElementById('camera-canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    photos.push(c.toDataURL('image/jpeg', 0.7));
    v.style.opacity = '0.3';
    setTimeout(() => { v.style.opacity = '1'; }, 150);
    updateModalCounter();
    renderPreviews();
    updateMiniGalleryThumb();
    if (photos.length >= 10) setTimeout(stopCamera, 500);
}

function updateModalCounter() { const el = document.getElementById('modal-photo-counter'); if (el) el.textContent = `${photos.length} / 10`; }

function updateMiniGalleryThumb() {
    const r = document.getElementById('camera-recent-thumb');
    if (!r) return;
    r.style.backgroundImage = photos.length > 0 ? `url(${photos[photos.length - 1]})` : '';
    r.style.opacity = photos.length > 0 ? '1' : '0';
}

function openCameraGallery() {
    if (photos.length === 0) return;
    document.getElementById('camera-header').style.display = 'none';
    document.getElementById('camera-body').style.display = 'none';
    document.getElementById('camera-footer').style.display = 'none';
    document.getElementById('camera-gallery').style.display = 'flex';
    renderCameraGallery();
}

function closeCameraGallery() {
    const h = document.getElementById('camera-header');
    if (h) {
        h.style.display = 'flex';
        document.getElementById('camera-body').style.display = 'flex';
        document.getElementById('camera-footer').style.display = 'flex';
        document.getElementById('camera-gallery').style.display = 'none';
        updateMiniGalleryThumb();
    }
}

function renderCameraGallery() { document.getElementById('cg-grid').innerHTML = photos.map((p, i) => `<div class="cg-item"><img src="${p}" onclick="openLightbox('${p}')"><button class="cg-delete" onclick="removePhotoFromGallery(${i})">✕</button></div>`).join(''); }

function removePhotoFromGallery(i) {
    photos.splice(i, 1);
    renderPreviews();
    updateModalCounter();
    if (photos.length === 0) closeCameraGallery();
    else renderCameraGallery();
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${photos.length} / 10`;
    const s = document.getElementById('captured-section');
    if (photos.length > 0) {
        s.style.display = 'block';
        document.getElementById('previews').innerHTML = photos.map((p, i) => `<div class="photo-thumb"><img src="${p}" onclick="openLightbox('${p}')"><button onclick="removePhoto(${i})">✕</button></div>`).join('');
    } else { s.style.display = 'none'; }
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
    updateModalCounter();
    updateMiniGalleryThumb();
}

async function uploadPhotosToStorage(recordId) {
    let urls = [];
    if (!supabaseClient) return urls;
    for (let i = 0; i < photos.length; i++) {
        try {
            const res = await fetch(photos[i]);
            const blob = await res.blob();
            const { error } = await supabaseClient.storage.from('visit_photos').upload(`${recordId}/photo_${i}.jpg`, blob, { contentType: 'image/jpeg' });
            if (!error) {
                const { data } = supabaseClient.storage.from('visit_photos').getPublicUrl(`${recordId}/photo_${i}.jpg`);
                urls.push(data.publicUrl);
            }
        } catch (e) {}
    }
    return urls;
}

function triggerSaveConfirm() {
    const outlet = document.getElementById('f-outlet').value.trim(),
        area = document.getElementById('f-area').value,
        person = document.getElementById('f-person').value.trim(),
        position = getPosition(),
        date = document.getElementById('f-date').value,
        reason = document.getElementById('f-reason').value.trim(),
        result = document.getElementById('f-result').value.trim();
    if (!outlet || !area || !person || !date || !reason) return toast('Please fill in required fields.', false);
    if (photos.length === 0) return toast('Capture at least 1 photo.', false);
    pendingSaveData = { outlet, area, person, position, date, reason, result };
    document.getElementById('save-confirm-text').innerHTML = `<b>${esc(outlet)}</b><br>${esc(reason)}`;
    document.getElementById('save-confirm-overlay').classList.add('open');
}

function closeSaveConfirm() {
    document.getElementById('save-confirm-overlay').classList.remove('open');
    pendingSaveData = null;
}

async function executeSave() {
    if (!pendingSaveData) return;
    document.getElementById('save-confirm-overlay').classList.remove('open');
    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    toast('Uploading data...', true);
    try {
        const id = Date.now().toString();
        const urls = await uploadPhotosToStorage(id);
        const payload = {...pendingSaveData, id, photos: urls, creator_name: userProfile.name, creator_email: userProfile.email, creator_position: userProfile.position, is_deleted: false };
        await supabaseClient.from('visits').insert([payload]);
        toast('✅ Visit saved!');
        clearForm();
        await loadVisitsFromDB();
        switchTab('list');
    } catch (err) { toast('Failed: ' + err.message, false); } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Visit';
        pendingSaveData = null;
    }
}

function clearForm() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('f-area').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('f-date').value = today();
    photos = [];
    renderPreviews();
    stopCamera();
}

function getVisitStatus(v) { const req = userRequests.find(r => r.visit_id === v.id); return req ? req.status : (v.is_deleted ? 'pending' : 'active'); }

function renderList() {
    const area = document.getElementById('fl-area').value,
        pos = document.getElementById('fl-pos').value,
        q = document.getElementById('fl-search').value.toLowerCase();
    const filtered = visits.filter(v => {
        if (getVisitStatus(v) === 'approved') return false; // ซ่อนรายการที่แอดมินลบแล้ว
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos.toLowerCase())) return false;
        if (q && !v.outlet.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');
    if (!filtered.length) { el.innerHTML = `<div class="empty-state">No visits found.</div>`; return; }
    el.innerHTML = filtered.map(v => {
        const s = getVisitStatus(v);
        return `<div class="visit-card" style="${s === 'pending' ? 'opacity:0.6' : ''}" onclick="openDetail('${v.id}')">
          <div class="vc-header"><b>${esc(v.outlet)}</b> <span style="font-size:12px;color:#888;">${fmtDate(v.date)}</span></div>
          <div style="font-size:12px;color:#666;margin-top:6px;">${esc(v.reason).substring(0, 60)}...</div>
        </div>`;
    }).join('');
}

function openDetail(id) {
    const v = visits.find(x => x.id === id);
    if (!v) return;
    const isOwner = (userProfile.email && v.creator_email === userProfile.email);
    const s = getVisitStatus(v);

    let phtml = '';
    if (v.photos) {
        let ph = Array.isArray(v.photos) ? v.photos : JSON.parse(v.photos || '[]');
        phtml = ph.map(p => `<img src="${p}" onclick="openLightbox('${p}')" style="width:80px;height:80px;object-fit:cover;border-radius:6px;cursor:zoom-in;">`).join(' ');
    }

    document.getElementById('detail-content').innerHTML = `
        <h2 style="font-size:18px;margin-bottom:1rem;">${esc(v.outlet)}</h2>
        ${s === 'pending' ? `<div style="color:#D48A8A;font-size:13px;margin-bottom:1rem;">⚠️ Pending Deletion</div>` : ''}
        <div style="font-size:13px;line-height:1.6;color:#444;">
            <b>Area:</b> ${esc(v.area)}<br><b>Person:</b> ${esc(v.person)} (${esc(v.position)})<br><br>
            <b>Reason:</b><br>${esc(v.reason).replace(/\n/g,'<br>')}<br><br><b>Result:</b><br>${esc(v.result).replace(/\n/g,'<br>')}
        </div>
        <div style="margin-top:1rem;display:flex;gap:8px;flex-wrap:wrap;">${phtml}</div>
        ${(isOwner && s !== 'pending') ? `<div style="text-align:right; margin-top:1rem; border-top:1px solid #EEE; padding-top:1rem;"><button class="btn-secondary btn-danger" onclick="openDeleteRequest('${v.id}')">Request Deletion</button></div>` : ''}
    `;
    document.getElementById('detail-overlay').classList.add('open');
}
function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

function openDeleteRequest(id) { deleteTargetId = id; document.getElementById('delete-confirm-overlay').classList.add('open'); }
function closeDeleteRequest() { deleteTargetId = null; document.getElementById('delete-confirm-overlay').classList.remove('open'); }
async function executeDeleteRequest() {
    const reason = document.getElementById('delete-reason-input').value.trim();
    if (!reason) return toast('Please provide a reason.', false);
    closeDeleteRequest(); toast('Submitting...', true);
    try {
        await supabaseClient.from('delete_requests').insert([{ visit_id: deleteTargetId, requested_by_email: userProfile.email, requested_by_name: userProfile.name, reason, status: 'pending' }]);
        await supabaseClient.from('visits').update({ is_deleted: true, delete_reason: reason }).eq('id', deleteTargetId);
        await loadVisitsFromDB(); toast('Request submitted.'); closeDetail();
    } catch (err) { toast('Failed: ' + err.message, false); }
}

function openLightbox(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { return d; }
function updateCount() { const el = document.getElementById('rec-count'); if (el) el.textContent = visits.length + ' records'; }
function toast(msg, ok = true) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.style.background = ok ? 'var(--primary)' : 'var(--danger)'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }
