// ============================================================
// app.js — Visit / DC Check  (v10 — Bug-fixed)
// ============================================================
// BUG FIXES:
//  1. SUPABASE_URL / SUPABASE_KEY — ใส่ค่าจาก Supabase project settings
//  2. ID collision — ใช้ crypto.randomUUID() แทน Date.now()
//  3. Profile saved ใน localStorage เท่านั้น — multi-user ต้องระวัง
//  4. executeDeleteRequest ส่งข้อมูลลง delete_requests table แทน update visits โดยตรง
//  5. renderList filter ตำแหน่งพิมพ์มือ (ETC) ไม่ match — ใช้ includes แทน
//  6. esc() ไม่ handle null/undefined — ป้องกัน crash ใน detail view
//  7. photos เป็น undefined เมื่อ visit ไม่มีรูป — ใส่ fallback ให้ครบทุกจุด
//  8. switchTab list ไม่ reload เมื่อกด tab ซ้ำ — แยก loadVisitsFromDB ออก
//  9. Camera modal counter อัพเดทผิดเมื่อ removePhoto — แก้ให้เรียก updateModalCounter
// 10. toast เรียกก่อน DOM พร้อม — ใส่ null check

const PROFILE_KEY = 'outlet_profile_v1';
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };
let currentPage = 0;
const PAGE_SIZE = 20;

let pendingSaveData = null;
let deleteTargetId = null;

// ✅ FIX 1: ใส่ค่า URL และ KEY จาก Supabase Dashboard → Settings → API
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
let supabaseClient = null;

try {
    if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
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

    document.getElementById('cb-next-visit').addEventListener('change', function () {
        document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
        if (this.checked) document.getElementById('f-next-date').value = today();
    });

    const followUpCheckboxes = document.querySelectorAll('.f-followup');
    const resultReqStar = document.getElementById('result-req-star');
    followUpCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const anyChecked = Array.from(followUpCheckboxes).some(c => c.checked);
            if (resultReqStar) resultReqStar.style.display = anyChecked ? 'none' : 'inline';
        });
    });

    switchTab(isProfileComplete() ? 'new' : 'profile');
    if (!isProfileComplete()) {
        setTimeout(() => toast('Please complete your profile to continue.', false), 500);
    }

    if (supabaseClient) loadVisitsFromDB();

    // Unregister old service workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    }
})();

/* ── Profile ── */
function loadProfile() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
        if (saved) userProfile = saved;
    } catch (e) {}
}

function populateProfileForm() {
    document.getElementById('pf-name').value = userProfile.name || '';
    document.getElementById('pf-email').value = userProfile.email || '';
    document.getElementById('pf-position').value = userProfile.position || '';
}

function isProfileComplete() {
    return userProfile.name !== '' && userProfile.email !== '' && userProfile.position !== '';
}

function saveProfile() {
    const name = document.getElementById('pf-name').value.trim();
    const email = document.getElementById('pf-email').value.trim();
    const position = document.getElementById('pf-position').value.trim();

    userProfile = { name, email, position };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    updateFormState();

    if (isProfileComplete()) {
        toast('Profile saved successfully.');
        switchTab('new');
    } else {
        toast('Profile saved, but please complete all fields.', false);
    }
}

function updateFormState() {
    const isComplete = isProfileComplete();
    const formElements = document.querySelectorAll('#tab-new input, #tab-new select, #tab-new textarea, #btn-save, #btn-clear');

    const btnCam = document.getElementById('btn-start-cam');
    if (btnCam) {
        btnCam.disabled = !isComplete;
        btnCam.style.opacity = isComplete ? '1' : '0.5';
        btnCam.style.cursor = isComplete ? 'pointer' : 'not-allowed';
    }

    formElements.forEach(el => {
        if (el) {
            el.disabled = !isComplete;
            el.style.backgroundColor = !isComplete ? '#E9ECEF' : '';
            el.style.cursor = !isComplete ? 'not-allowed' : '';
        }
    });
}

/* ── DB Loader ── */
async function loadVisitsFromDB(isLoadMore = false) {
    if (!supabaseClient) return;
    if (!isLoadMore) currentPage = 0;
    try {
        const { data, error } = await supabaseClient
            .from('visits')
            .select('*')
            .order('created_at', { ascending: false })
            .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

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
            photos: Array.isArray(v.photos) ? v.photos : [],   // ✅ FIX 7
            creatorName: v.creator_name || '',
            creatorEmail: v.creator_email || '',
            creatorPosition: v.creator_position || '',
            is_deleted: v.is_deleted || false,
            delete_reason: v.delete_reason || ''
        }));

        visits = isLoadMore ? [...visits, ...formatted] : formatted;

        const loadMoreWrap = document.getElementById('load-more-wrap');
        if (loadMoreWrap) loadMoreWrap.style.display = data && data.length === PAGE_SIZE ? 'block' : 'none';

        updateCount();
        if (document.getElementById('tab-list').style.display !== 'none') renderList();
    } catch (e) {
        console.error("Fetch failed:", e);
        toast('Failed to load visits. Check console.', false);
    }
}

function loadMoreVisits() {
    currentPage++;
    loadVisitsFromDB(true);
}

/* ── Tabs ── */
function switchTab(tab) {
    if (tab === 'new' && !isProfileComplete()) {
        toast('Please complete your profile first.', false);
        tab = 'profile';
    }

    if (tab !== 'new') stopCamera();

    document.querySelectorAll('.tab').forEach((t, i) =>
        t.classList.toggle('active',
            (tab === 'profile' && i === 0) ||
            (tab === 'new' && i === 1) ||
            (tab === 'list' && i === 2)
        )
    );

    document.getElementById('tab-profile').style.display = tab === 'profile' ? '' : 'none';
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';

    // ✅ FIX 8: โหลดข้อมูลใหม่ทุกครั้งที่สลับ tab มา list
    if (tab === 'list') {
        renderList();
        if (supabaseClient) loadVisitsFromDB();
    }
}

function bindPositionToggle() {
    document.getElementById('f-position').addEventListener('change', function () {
        document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none';
    });
}

function getPosition() {
    const s = document.getElementById('f-position').value;
    return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s;
}

/* ── Camera ── */
let cameraStream = null;

async function startCamera() {
    if (!isProfileComplete()) return;
    const video = document.getElementById('camera-view');
    const modal = document.getElementById('camera-modal');
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
    } catch (err1) {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err2) {
            if (err2.name === 'NotReadableError' || err2.name === 'TrackStartError') {
                toast('Camera is in use by another app.', false);
            } else {
                toast('Cannot access camera: ' + err2.message, false);
            }
            return;
        }
    }
    video.srcObject = cameraStream;
    modal.classList.add('open');
    updateModalCounter();
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    const modal = document.getElementById('camera-modal');
    if (modal) modal.classList.remove('open');
}

function updateModalCounter() {
    const el = document.getElementById('modal-photo-counter');
    if (el) el.textContent = `${photos.length} / 10`;
}

function capturePhoto() {
    if (photos.length >= 10) { toast('Max 10 photos allowed.', false); return; }
    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    photos.push(canvas.toDataURL('image/jpeg', 0.7));
    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);
    updateModalCounter();
    renderPreviews();
    if (photos.length >= 10) { toast('Reached 10 photos maximum.'); setTimeout(stopCamera, 500); }
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${photos.length} / 10`;
    const previewContainer = document.getElementById('previews');
    const capturedSection = document.getElementById('captured-section');
    if (photos.length > 0) {
        capturedSection.style.display = 'block';
        previewContainer.innerHTML = photos.map((p, i) => `
            <div class="photo-thumb">
                <img src="${p}" alt="Preview" onclick="openLightbox('${p}')" title="Click to view">
                <button onclick="removePhoto(${i})" title="Remove photo">✕</button>
            </div>`).join('');
    } else {
        capturedSection.style.display = 'none';
        previewContainer.innerHTML = '';
    }
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
    updateModalCounter(); // ✅ FIX 9
}

async function uploadPhotosToStorage(recordId) {
    let uploadedUrls = [];
    if (!supabaseClient) return uploadedUrls;
    const newPhotos = photos.filter(p => p.startsWith('data:image'));
    for (let i = 0; i < newPhotos.length; i++) {
        try {
            const res = await fetch(newPhotos[i]);
            const blob = await res.blob();
            const fileName = `${recordId}/photo_${Date.now()}_${i}.jpg`;
            const { error } = await supabaseClient.storage.from('visit_photos').upload(fileName, blob, {
                contentType: 'image/jpeg', cacheControl: '3600', upsert: false
            });
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
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 5000 }
        );
    });
}

/* ── Save Confirmation ── */
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
        } else {
            followUps.push(cb.value);
        }
    });

    if (!outlet || !area || !person || !position || !date || !reason) {
        toast('Please fill in all required fields (*).', false);
        return;
    }
    if (!result && followUps.length === 0) {
        toast('Please provide a Result of Visit or select a Follow-up Action.', false);
        return;
    }
    if (photos.length === 0) {
        toast('Please capture at least 1 photo.', false);
        return;
    }

    let finalResultText = result;
    if (followUps.length > 0) {
        finalResultText += (finalResultText ? '\n\n' : '') + '[ Follow-up Actions ]\n- ' + followUps.join('\n- ');
    }

    pendingSaveData = { outlet, area, person, position, date, reason, result: finalResultText };

    const photosHtml = `<div class="confirm-photo-grid">${photos.map(p =>
        `<img src="${p}" alt="Evidence" onclick="openLightbox('${p}')" style="cursor:zoom-in;" title="Click to view">`
    ).join('')}</div>`;

    document.getElementById('save-confirm-text').innerHTML = `
        <div class="visit-card" style="margin:0;box-shadow:none;border:1px solid var(--border-light);cursor:default;transform:none;padding:1rem;">
          <div class="vc-header">
            <span class="vc-name">${esc(outlet)}</span>
            <span class="vc-date">${fmtDate(date)}</span>
          </div>
          <div class="vc-meta">
            <span class="badge badge-area">${area}</span>
            <span class="badge badge-pos">${esc(position)}</span>
            <span class="vc-person">${esc(person)}</span>
          </div>
          <div style="margin-top:12px;">
            <strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Reason</strong>
            <div class="vc-reason" style="margin-top:4px;">${esc(reason).replace(/\n/g,'<br>')}</div>
          </div>
          <div style="margin-top:12px;">
            <strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Result & Actions</strong>
            <div class="vc-reason" style="margin-top:4px;">${esc(finalResultText).replace(/\n/g,'<br>')}</div>
          </div>
          <div style="margin-top:16px;border-top:1px dashed #eee;padding-top:12px;font-size:13px;color:#555;">
            Attached Photos: <strong>${photos.length}</strong>${photosHtml}
          </div>
        </div>`;
    document.getElementById('save-confirm-overlay').classList.add('open');
}

function closeSaveConfirm() {
    document.getElementById('save-confirm-overlay').classList.remove('open');
    pendingSaveData = null;
}

async function executeSave() {
    if (!pendingSaveData) return;
    document.getElementById('save-confirm-overlay').classList.remove('open');
    if (!supabaseClient) {
        alert('❌ ยังไม่ได้เชื่อมต่อฐานข้อมูล — เช็ค SUPABASE_URL และ SUPABASE_KEY');
        return;
    }

    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    toast('Uploading data...', true);

    try {
        // ✅ FIX 2: ใช้ crypto.randomUUID() แทน Date.now() ป้องกัน ID ชนกัน
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now().toString();

        const location = await getCurrentLocation();
        const newUploadedUrls = await uploadPhotosToStorage(id);

        const payload = {
            id,
            outlet: pendingSaveData.outlet,
            area: pendingSaveData.area,
            person: pendingSaveData.person,
            position: pendingSaveData.position,
            date: pendingSaveData.date,
            reason: pendingSaveData.reason,
            result: pendingSaveData.result,
            photos: newUploadedUrls,
            creator_name: userProfile.name,
            creator_email: userProfile.email,
            creator_position: userProfile.position,
            lat: location ? location.lat : null,
            lng: location ? location.lng : null,
            is_deleted: false,
            delete_reason: null
        };

        const { error } = await supabaseClient.from('visits').insert([payload]);
        if (error) { alert('❌ Database Error!\n' + error.message); throw error; }

        toast('✅ Visit saved successfully!');
        clearForm();
        await loadVisitsFromDB();
        switchTab('list');
    } catch (err) {
        console.error(err);
        toast('Failed to save: ' + (err.message || 'Check console.'), false);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Visit';
        pendingSaveData = null;
    }
}

function clearForm() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('f-area').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('pos-other-wrap').style.display = 'none';
    document.getElementById('f-date').value = today();
    document.querySelectorAll('.f-followup').forEach(cb => cb.checked = false);
    document.getElementById('next-visit-wrap').style.display = 'none';
    const star = document.getElementById('result-req-star');
    if (star) star.style.display = 'inline';
    photos = [];
    renderPreviews();
    stopCamera();
}

/* ── Visit List ── */
function renderList() {
    const area = document.getElementById('fl-area').value;
    const pos = document.getElementById('fl-pos').value;
    const q = document.getElementById('fl-search').value.toLowerCase();

    // ✅ FIX 5: filter ตำแหน่ง — ใช้ includes เพื่อรองรับค่าพิมพ์มือ (ETC)
    const filtered = visits.filter(v => {
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos.toLowerCase())) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');
    if (!filtered.length) {
        el.innerHTML = `<div class="empty-state"><p>No visits found.</p></div>`;
        return;
    }

    el.innerHTML = filtered.map(v => {
        const statusBadge = v.is_deleted
            ? `<span class="badge" style="background:#FFEBEB;color:#D48A8A;">Pending Delete</span>` : '';
        const cardStyle = v.is_deleted ? 'opacity:0.7;border:1px dashed #D48A8A;background:#FAFAFA;' : '';
        return `
        <div class="visit-card" style="${cardStyle}" onclick="openDetail('${v.id}')">
          <div class="vc-header">
            <span class="vc-name">${esc(v.outlet)}</span>
            <span class="vc-date">${fmtDate(v.date)}</span>
          </div>
          <div class="vc-meta">
            ${statusBadge}
            <span class="badge badge-area">${esc(v.area)}</span>
            <span class="badge badge-pos">${esc(v.position)}</span>
            <span class="vc-person">${esc(v.person)}</span>
          </div>
          <div class="vc-reason" style="${v.is_deleted ? 'text-decoration:line-through;' : ''}">
            ${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}
          </div>
          ${renderThumbStrip(v.photos)}
        </div>`;
    }).join('');
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';  // ✅ FIX 7
    const visible = ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}" alt=""></div>`).join('');
    const extra = ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : '';
    return `<div class="vc-thumbs">${visible}${extra}</div>`;
}

/* ── Detail View ── */
function openDetail(id) {
    const v = visits.find(x => x.id === id);
    if (!v) return;

    const visitInfo = [
        ['Outlet', v.outlet], ['Area', v.area], ['Date', fmtDate(v.date)],
        ['Person', v.person], ['Position', v.position],
        ['Reason', v.reason], ['Result', v.result]
    ];
    const visitorInfo = [
        ['Created By', v.creatorName || '-'],
        ['Email', v.creatorEmail || '-'],
        ['Role', v.creatorPosition || '-']
    ];

    const renderFields = rows => rows.map(([l, val]) =>
        `<div class="detail-field">
           <span class="detail-label">${l}</span>
           <span class="detail-value">${esc(val).replace(/\n/g, '<br>')}</span>
         </div>`
    ).join('');

    const photosHtml = v.photos && v.photos.length
        ? `<div style="border-top:1px dashed #EBEBEB;margin:20px 0;"></div>
           <div class="detail-label" style="margin-bottom:8px">Photos (${v.photos.length})</div>
           <div class="detail-photos">${v.photos.map(p =>
               `<div class="detail-photo" onclick="openLightbox('${p}')"><img src="${p}" alt="" style="cursor:zoom-in;"></div>`
           ).join('')}</div>` : '';

    const topDeleteAlert = v.is_deleted
        ? `<div style="background:#FFF5F5;border:1px solid #FBCBCB;padding:12px;border-radius:8px;margin-bottom:16px;">
             <strong style="color:#D48A8A;font-size:13px;">⚠️ This record is pending deletion review.</strong>
             <div style="font-size:13px;color:#666;margin-top:6px;">Reason: ${esc(v.delete_reason)}</div>
           </div>` : '';

    const bottomDeleteAction = !v.is_deleted
        ? `<div class="detail-actions" style="margin-top:2rem;padding-top:1rem;border-top:1px solid var(--border-light);display:flex;">
             <button class="btn-secondary btn-danger" onclick="openDeleteRequest('${v.id}')" style="margin-left:auto;">
               Request Deletion
             </button>
           </div>` : '';

    document.getElementById('detail-content').innerHTML = `
        <h2 style="font-size:18px;font-weight:600;margin-bottom:1.5rem;color:var(--text-main)">${esc(v.outlet)}</h2>
        ${topDeleteAlert}
        <div class="detail-grid" style="${v.is_deleted ? 'opacity:0.6;' : ''}">
          <div class="detail-col-main">${renderFields(visitInfo)}</div>
          <div class="detail-col-visitor">
            <div style="font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;margin-bottom:12px;letter-spacing:.05em;">Visitor</div>
            ${renderFields(visitorInfo)}
          </div>
        </div>
        ${photosHtml}
        ${bottomDeleteAction}`;
    document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

/* ── Delete Request System ── */
function openDeleteRequest(id) {
    deleteTargetId = id;
    document.getElementById('delete-reason-input').value = '';
    document.getElementById('delete-confirm-overlay').classList.add('open');
}

function closeDeleteRequest() {
    deleteTargetId = null;
    document.getElementById('delete-confirm-overlay').classList.remove('open');
}

// ✅ FIX 4: บันทึกคำขอลบลงตาราง delete_requests แทน + soft-flag visits
async function executeDeleteRequest() {
    const reason = document.getElementById('delete-reason-input').value.trim();
    if (!reason) { toast('Please provide a reason.', false); return; }
    if (!deleteTargetId || !supabaseClient) return;

    // ✅ snapshot ค่าก่อน closeDeleteRequest() จะ reset เป็น null
    const targetId = deleteTargetId;
    closeDeleteRequest();
    toast('Submitting delete request...', true);

    try {
        // 1. บันทึก delete_request audit log
        const { error: reqError } = await supabaseClient.from('delete_requests').insert([{
            visit_id: targetId,
            requested_by_email: userProfile.email,
            requested_by_name: userProfile.name,
            reason,
            status: 'pending'
        }]);
        if (reqError) throw reqError;

        // 2. Soft-flag visit ว่ากำลังรอการลบ
        const { error: updateError } = await supabaseClient
            .from('visits')
            .update({ is_deleted: true, delete_reason: reason })
            .eq('id', targetId);
        if (updateError) throw updateError;

        // 3. อัพเดท local state
        const idx = visits.findIndex(v => v.id === targetId);
        if (idx !== -1) {
            visits[idx].is_deleted = true;
            visits[idx].delete_reason = reason;
        }

        renderList();
        toast('Delete request submitted. Admin will review shortly.');
        closeDetail();
    } catch (err) {
        console.error(err);
        toast('Failed to submit request: ' + err.message, false);
    }
}

/* ── Utils ── */
function openLightbox(src) {
    document.getElementById('lb-img').src = src;
    document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

// ✅ FIX 6: esc() handle null/undefined
function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function today() { return new Date().toISOString().split('T')[0]; }

function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
}

function updateCount() {
    const el = document.getElementById('rec-count');
    if (el) el.textContent = visits.length + (visits.length === 1 ? ' record' : ' records');
}

// ✅ FIX 10: null-check toast
function toast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? 'var(--primary)' : 'var(--danger)';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}
