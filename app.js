// ============================================================
// app.js — Visit / DC Check (Camera Bug Fixed + Mini Gallery)
// ============================================================

// 🌟 ย้ายตัวแปรทั้งหมดมาบนสุด ป้องกัน Error "Cannot access before initialization"
let cameraStream = null;
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };
let currentPage = 0;
const PAGE_SIZE = 20;
let pendingSaveData = null;
let deleteTargetId = null;

const PROFILE_KEY = 'outlet_profile_v1';
const SUPABASE_URL = 'https://yvbhrtuuhbvhdsmczsxr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_j32shAkGAVH3CaSJmtjhpA__Sz6yBj5';
let supabaseClient = null;

try {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.error("Connection error:", e);
}

/* ── Init ── */
(function init() {
    loadProfile();
    populateProfileForm();
    document.getElementById('f-date').value = today();
    bindPositionToggle();
    updateFormState();

    document.getElementById('cb-next-visit').addEventListener('change', function() {
        document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
        if (this.checked) document.getElementById('f-next-date').value = today();
    });

    switchTab(isProfileComplete() ? 'new' : 'profile');
    if (supabaseClient) loadVisitsFromDB();
})();

/* ── Profile ── */
function loadProfile() {
    try { const saved = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (saved) userProfile = saved; } catch (e) {}
}

function populateProfileForm() {
    document.getElementById('pf-name').value = userProfile.name || '';
    document.getElementById('pf-email').value = userProfile.email || '';
    document.getElementById('pf-position').value = userProfile.position || '';
}

function isProfileComplete() { return userProfile.name !== '' && userProfile.email !== '' && userProfile.position !== ''; }

function saveProfile() {
    userProfile = {
        name: document.getElementById('pf-name').value.trim(),
        email: document.getElementById('pf-email').value.trim(),
        position: document.getElementById('pf-position').value.trim()
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    updateFormState();
    if (isProfileComplete()) {
        toast('Profile saved.');
        switchTab('new');
    } else { toast('Please complete all fields.', false); }
}

function updateFormState() {
    const isComplete = isProfileComplete();
    const btnCam = document.getElementById('btn-start-cam');
    if (btnCam) {
        btnCam.disabled = !isComplete;
        btnCam.style.opacity = isComplete ? '1' : '0.5';
    }
}

/* ── DB Loader ── */
async function loadVisitsFromDB(isLoadMore = false) {
    if (!supabaseClient) return;
    if (!isLoadMore) currentPage = 0;
    try {
        const { data, error } = await supabaseClient.from('visits').select('*').order('created_at', { ascending: false }).range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);
        if (error) throw error;

        const formatted = (data || []).map(v => ({
            id: v.id,
            outlet: v.outlet || '',
            area: v.area || '',
            person: v.person || '',
            position: v.position || '',
            date: v.date || '',
            reason: v.reason || '',
            result: v.result || '',
            photos: Array.isArray(v.photos) ? v.photos : [],
            creatorName: v.creator_name || '',
            creatorEmail: v.creator_email || '',
            creatorPosition: v.creator_position || '',
            is_deleted: v.is_deleted || false,
            delete_reason: v.delete_reason || ''
        }));

        visits = isLoadMore ? [...visits, ...formatted] : formatted;
        updateCount();
        if (document.getElementById('tab-list').style.display !== 'none') renderList();
    } catch (e) { toast('Failed to load visits.', false); }
}

/* ── Tabs ── */
function switchTab(tab) {
    if (tab === 'new' && !isProfileComplete()) {
        toast('Please complete your profile first.', false);
        tab = 'profile';
    }
    if (tab !== 'new') stopCamera();

    document.querySelectorAll('.tab').forEach((t, i) =>
        t.classList.toggle('active', (tab === 'profile' && i === 0) || (tab === 'new' && i === 1) || (tab === 'list' && i === 2))
    );
    document.getElementById('tab-profile').style.display = tab === 'profile' ? '' : 'none';
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';

    if (tab === 'list') { renderList(); if (supabaseClient) loadVisitsFromDB(); }
}

function bindPositionToggle() { document.getElementById('f-position').addEventListener('change', function() { document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none'; }); }

function getPosition() { const s = document.getElementById('f-position').value; return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s; }

/* ── CAMERA CORE ── */
async function startCamera() {
    if (!isProfileComplete()) return;
    const video = document.getElementById('camera-view');
    const modal = document.getElementById('camera-modal');

    updateMiniGalleryThumb();

    try {
        if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); }
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = cameraStream;
        modal.classList.add('open');
        updateModalCounter();
    } catch (err1) {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = cameraStream;
            modal.classList.add('open');
            updateModalCounter();
        } catch (err2) { toast('Cannot access camera.', false); }
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    document.getElementById('camera-modal').classList.remove('open');
    closeCameraGallery(); // ปิดแกลลอรี่เผื่อเปิดค้างไว้
}

function capturePhoto() {
    if (photos.length >= 10) { toast('Max 10 photos allowed.', false); return; }
    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const newPhotoUrl = canvas.toDataURL('image/jpeg', 0.7);
    photos.push(newPhotoUrl);

    // Flash effect
    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);

    updateModalCounter();
    renderPreviews(); // อัปเดตในหน้าฟอร์มหลัก
    updateMiniGalleryThumb(); // อัปเดตรูปมุมซ้ายล่าง

    if (photos.length >= 10) {
        toast('Reached 10 photos maximum.');
        setTimeout(stopCamera, 500);
    }
}

function updateModalCounter() {
    const el = document.getElementById('modal-photo-counter');
    if (el) el.textContent = `${photos.length} / 10`;
}

function updateMiniGalleryThumb() {
    const recentThumb = document.getElementById('camera-recent-thumb');
    if (!recentThumb) return;
    if (photos.length > 0) {
        recentThumb.style.backgroundImage = `url(${photos[photos.length - 1]})`;
        recentThumb.style.opacity = '1';
    } else {
        recentThumb.style.opacity = '0';
    }
}

/* ── CAMERA MINI-GALLERY (NEW) ── */
function openCameraGallery() {
    if (photos.length === 0) return;
    // ซ่อนกล้อง โชว์แกลลอรี่
    document.getElementById('camera-header').style.display = 'none';
    document.getElementById('camera-body').style.display = 'none';
    document.getElementById('camera-footer').style.display = 'none';

    const gallery = document.getElementById('camera-gallery');
    gallery.style.display = 'flex';
    renderCameraGallery();
}

function closeCameraGallery() {
    // กลับมาโชว์กล้อง
    document.getElementById('camera-header').style.display = 'flex';
    document.getElementById('camera-body').style.display = 'flex';
    document.getElementById('camera-footer').style.display = 'flex';
    document.getElementById('camera-gallery').style.display = 'none';
    updateMiniGalleryThumb();
}

function renderCameraGallery() {
    const grid = document.getElementById('cg-grid');
    grid.innerHTML = photos.map((p, i) => `
        <div class="cg-item">
            <img src="${p}" onclick="openLightbox('${p}')">
            <button class="cg-delete" onclick="removePhotoFromGallery(${i})">✕</button>
        </div>
    `).join('');
}

function removePhotoFromGallery(i) {
    photos.splice(i, 1);
    renderPreviews(); // อัปเดตในฟอร์มหลักด้วย
    updateModalCounter();
    if (photos.length === 0) {
        closeCameraGallery(); // ถ้ารูปหมดแล้ว ให้กลับไปหน้ากล้อง
    } else {
        renderCameraGallery();
    }
}

/* ── FORM PREVIEWS ── */
function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${photos.length} / 10`;
    const previewContainer = document.getElementById('previews');
    const capturedSection = document.getElementById('captured-section');
    if (photos.length > 0) {
        capturedSection.style.display = 'block';
        previewContainer.innerHTML = photos.map((p, i) => `
            <div class="photo-thumb">
                <img src="${p}" onclick="openLightbox('${p}')">
                <button onclick="removePhoto(${i})">✕</button>
            </div>`).join('');
    } else {
        capturedSection.style.display = 'none';
        previewContainer.innerHTML = '';
    }
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
    updateModalCounter();
    updateMiniGalleryThumb();
}

/* ── SAVE SYSTEM ── */
async function uploadPhotosToStorage(recordId) {
    let uploadedUrls = [];
    if (!supabaseClient) return uploadedUrls;
    const newPhotos = photos.filter(p => p.startsWith('data:image'));
    for (let i = 0; i < newPhotos.length; i++) {
        try {
            const res = await fetch(newPhotos[i]);
            const blob = await res.blob();
            const fileName = `${recordId}/photo_${Date.now()}_${i}.jpg`;
            const { error } = await supabaseClient.storage.from('visit_photos').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
            if (!error) {
                const { data: urlData } = supabaseClient.storage.from('visit_photos').getPublicUrl(fileName);
                uploadedUrls.push(urlData.publicUrl);
            }
        } catch (e) { console.error("Upload error:", e); }
    }
    return uploadedUrls;
}

function getCurrentLocation() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null), { enableHighAccuracy: true, timeout: 5000 }
        );
    });
}

function triggerSaveConfirm() {
    if (!isProfileComplete()) { switchTab('profile'); return; }

    const outlet = document.getElementById('f-outlet').value.trim();
    const area = document.getElementById('f-area').value;
    const person = document.getElementById('f-person').value.trim();
    const position = getPosition();
    const date = document.getElementById('f-date').value;
    const reason = document.getElementById('f-reason').value.trim();
    const result = document.getElementById('f-result').value.trim();

    let followUps = [];
    document.querySelectorAll('.f-followup:checked').forEach(cb => {
        if (cb.id === 'cb-next-visit') {
            const nd = document.getElementById('f-next-date').value;
            followUps.push(nd ? `Schedule Next Visit: ${fmtDate(nd)}` : 'Schedule Next Visit');
        } else { followUps.push(cb.value); }
    });

    if (!outlet || !area || !person || !position || !date || !reason) { toast('Please fill in all required fields (*).', false); return; }
    if (!result && followUps.length === 0) { toast('Please provide a Result or select a Follow-up.', false); return; }
    if (photos.length === 0) { toast('Please capture at least 1 photo.', false); return; }

    let finalResultText = result;
    if (followUps.length > 0) { finalResultText += (finalResultText ? '\n\n' : '') + '[ Follow-up Actions ]\n- ' + followUps.join('\n- '); }

    pendingSaveData = { outlet, area, person, position, date, reason, result: finalResultText };

    const photosHtml = `<div class="confirm-photo-grid">${photos.map(p => `<img src="${p}" onclick="openLightbox('${p}')" style="cursor:zoom-in;">`).join('')}</div>`;

    document.getElementById('save-confirm-text').innerHTML = `
        <div class="visit-card" style="margin:0;box-shadow:none;border:1px solid var(--border-light);cursor:default;padding:1rem;">
          <div class="vc-header"><span class="vc-name">${esc(outlet)}</span><span class="vc-date">${fmtDate(date)}</span></div>
          <div class="vc-meta"><span class="badge badge-area">${area}</span><span class="badge badge-pos">${esc(position)}</span><span class="vc-person">${esc(person)}</span></div>
          <div style="margin-top:12px;"><strong style="font-size:11px;color:var(--text-muted);">REASON</strong><div class="vc-reason" style="margin-top:4px;">${esc(reason).replace(/\n/g,'<br>')}</div></div>
          <div style="margin-top:12px;"><strong style="font-size:11px;color:var(--text-muted);">RESULT & ACTIONS</strong><div class="vc-reason" style="margin-top:4px;">${esc(finalResultText).replace(/\n/g,'<br>')}</div></div>
          <div style="margin-top:16px;border-top:1px dashed #eee;padding-top:12px;font-size:13px;">Attached Photos: <strong>${photos.length}</strong>${photosHtml}</div>
        </div>`;
    document.getElementById('save-confirm-overlay').classList.add('open');
}

function closeSaveConfirm() { document.getElementById('save-confirm-overlay').classList.remove('open'); pendingSaveData = null; }

async function executeSave() {
    if (!pendingSaveData) return;
    document.getElementById('save-confirm-overlay').classList.remove('open');
    if (!supabaseClient) { alert('❌ ยังไม่ได้เชื่อมต่อฐานข้อมูล'); return; }

    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    toast('Uploading data...', true);

    try {
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString();
        const location = await getCurrentLocation();
        const newUploadedUrls = await uploadPhotosToStorage(id);

        const payload = {
            id, outlet: pendingSaveData.outlet, area: pendingSaveData.area, person: pendingSaveData.person, position: pendingSaveData.position, date: pendingSaveData.date, reason: pendingSaveData.reason, result: pendingSaveData.result, photos: newUploadedUrls, creator_name: userProfile.name, creator_email: userProfile.email, creator_position: userProfile.position, lat: location ? location.lat : null, lng: location ? location.lng : null, is_deleted: false, delete_reason: null
        };

        const { error } = await supabaseClient.from('visits').insert([payload]);
        if (error) throw error;

        toast('✅ Visit saved successfully!');
        clearForm(); await loadVisitsFromDB(); switchTab('list');
    } catch (err) { toast('Failed to save: ' + err.message, false); } 
    finally { saveBtn.disabled = false; saveBtn.textContent = 'Save Visit'; pendingSaveData = null; }
}

function clearForm() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('f-area').value = ''; document.getElementById('f-position').value = ''; document.getElementById('pos-other-wrap').style.display = 'none'; document.getElementById('f-date').value = today();
    document.querySelectorAll('.f-followup').forEach(cb => cb.checked = false); document.getElementById('next-visit-wrap').style.display = 'none';
    photos = []; renderPreviews(); stopCamera();
}

/* ── Visit List & Details ── */
function renderList() {
    const area = document.getElementById('fl-area').value, pos = document.getElementById('fl-pos').value, q = document.getElementById('fl-search').value.toLowerCase();
    const filtered = visits.filter(v => {
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos.toLowerCase())) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');
    if (!filtered.length) { el.innerHTML = `<div class="empty-state"><p>No visits found.</p></div>`; return; }

    el.innerHTML = filtered.map(v => {
        const statusBadge = v.is_deleted ? `<span class="badge" style="background:#FFEBEB;color:#D48A8A;">Pending Delete</span>` : '';
        const cardStyle = v.is_deleted ? 'opacity:0.7;border:1px dashed #D48A8A;background:#FAFAFA;' : '';
        return `
        <div class="visit-card" style="${cardStyle}" onclick="openDetail('${v.id}')">
          <div class="vc-header"><span class="vc-name">${esc(v.outlet)}</span><span class="vc-date">${fmtDate(v.date)}</span></div>
          <div class="vc-meta">${statusBadge}<span class="badge badge-area">${esc(v.area)}</span><span class="badge badge-pos">${esc(v.position)}</span><span class="vc-person">${esc(v.person)}</span></div>
          <div class="vc-reason" style="${v.is_deleted ? 'text-decoration:line-through;' : ''}">${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}</div>
          ${renderThumbStrip(v.photos)}
        </div>`;
    }).join('');
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';
    return `<div class="vc-thumbs">${ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}"></div>`).join('')}${ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : ''}</div>`;
}

function openDetail(id) {
    const v = visits.find(x => x.id === id); if (!v) return;
    const visitInfo = [['Outlet', v.outlet], ['Area', v.area], ['Date', fmtDate(v.date)], ['Person', v.person], ['Position', v.position], ['Reason', v.reason], ['Result', v.result]];
    const visitorInfo = [['Created By', v.creatorName || '-'], ['Email', v.creatorEmail || '-'], ['Role', v.creatorPosition || '-']];

    const renderFields = rows => rows.map(([l, val]) => `<div class="detail-field"><span class="detail-label">${l}</span><span class="detail-value">${esc(val).replace(/\n/g, '<br>')}</span></div>`).join('');
    const photosHtml = v.photos && v.photos.length ? `<div style="border-top:1px dashed #EBEBEB;margin:20px 0;"></div><div class="detail-label" style="margin-bottom:8px">Photos (${v.photos.length})</div><div class="detail-photos">${v.photos.map(p => `<div class="detail-photo" onclick="openLightbox('${p}')"><img src="${p}" style="cursor:zoom-in;"></div>`).join('')}</div>` : '';
    
    document.getElementById('detail-content').innerHTML = `
        <h2 style="font-size:18px;font-weight:600;margin-bottom:1.5rem;">${esc(v.outlet)}</h2>
        ${v.is_deleted ? `<div style="background:#FFF5F5;border:1px solid #FBCBCB;padding:12px;border-radius:8px;margin-bottom:16px;"><strong style="color:#D48A8A;font-size:13px;">⚠️ Pending deletion review.</strong><div style="font-size:13px;color:#666;">Reason: ${esc(v.delete_reason)}</div></div>` : ''}
        <div class="detail-grid" style="${v.is_deleted ? 'opacity:0.6;' : ''}">
          <div class="detail-col-main">${renderFields(visitInfo)}</div>
          <div class="detail-col-visitor"><div style="font-size:11px;font-weight:600;color:var(--primary);margin-bottom:12px;">VISITOR</div>${renderFields(visitorInfo)}</div>
        </div>
        ${photosHtml}
        ${!v.is_deleted ? `<div class="detail-actions" style="margin-top:2rem;border-top:1px solid #EBEBEB;display:flex;"><button class="btn-secondary btn-danger" onclick="openDeleteRequest('${v.id}')" style="margin-left:auto;">Request Deletion</button></div>` : ''}`;
    document.getElementById('detail-overlay').classList.add('open');
}
function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

/* ── Delete Request ── */
function openDeleteRequest(id) { deleteTargetId = id; document.getElementById('delete-reason-input').value = ''; document.getElementById('delete-confirm-overlay').classList.add('open'); }
function closeDeleteRequest() { deleteTargetId = null; document.getElementById('delete-confirm-overlay').classList.remove('open'); }

async function executeDeleteRequest() {
    const reason = document.getElementById('delete-reason-input').value.trim();
    if (!reason) { toast('Please provide a reason.', false); return; }
    const targetId = deleteTargetId; closeDeleteRequest(); toast('Submitting delete request...', true);

    try {
        const { error: reqError } = await supabaseClient.from('delete_requests').insert([{ visit_id: targetId, requested_by_email: userProfile.email, requested_by_name: userProfile.name, reason, status: 'pending' }]);
        if (reqError) throw reqError;
        const { error: updateError } = await supabaseClient.from('visits').update({ is_deleted: true, delete_reason: reason }).eq('id', targetId);
        if (updateError) throw updateError;
        
        const idx = visits.findIndex(v => v.id === targetId);
        if (idx !== -1) { visits[idx].is_deleted = true; visits[idx].delete_reason = reason; }
        renderList(); toast('Delete request submitted.'); closeDetail();
    } catch (err) { toast('Failed to submit request: ' + err.message, false); }
}

/* ── Utils ── */
function openLightbox(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`; }
function updateCount() { const el = document.getElementById('rec-count'); if (el) el.textContent = visits.length + (visits.length === 1 ? ' record' : ' records'); }
function toast(msg, ok = true) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.style.background = ok ? 'var(--primary)' : 'var(--danger)'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }
