// ============================================================
// app.js — Visit / DC Check + User Login System
// ============================================================

let cameraStream = null;
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };
let currentPage = 0;
const PAGE_SIZE = 20;
let pendingSaveData = null;
let deleteTargetId = null;
let loggedInUser = null; // เก็บ user object ที่ login แล้ว

const PROFILE_KEY  = 'outlet_profile_v1';
const SESSION_KEY  = 'checklist_user_session';   // sessionStorage (ปิดแท็บหาย)
const REMEMBER_KEY = 'checklist_user_remember';  // localStorage (ถาวร)
const SUPABASE_URL = 'https://kthdrgmdppyaooudbiog.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aCfFzE-lGDhV1oTqaSCXEQ_NTs6SAKr';
let supabaseClient = null;

try {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) { console.error("Connection error:", e); }

/* ── Login ── */
async function doUserLogin() {
    const username = document.getElementById('login-username').value.trim();
    const pass     = document.getElementById('login-pass').value;
    const remember = document.getElementById('login-remember').checked;
    const errEl    = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!username || !pass) { errEl.textContent = 'Please enter username and password.'; errEl.style.display = 'block'; return; }
    if (!supabaseClient)    { errEl.textContent = 'Database not connected.'; errEl.style.display = 'block'; return; }

    try {
        const { data, error } = await supabaseClient.from('users').select('*')
            .eq('username', username).eq('is_active', true).single();

        if (error || !data) { errEl.textContent = 'Username not found or account is inactive.'; errEl.style.display = 'block'; return; }
        if (data.password_hash !== pass) { errEl.textContent = 'Incorrect password.'; errEl.style.display = 'block'; return; }

        loggedInUser = data;
        const payload = JSON.stringify({ id: data.id, username: data.username, name: data.name, position: data.position });

        if (remember) {
            localStorage.setItem(REMEMBER_KEY, payload);
            sessionStorage.removeItem(SESSION_KEY);
        } else {
            sessionStorage.setItem(SESSION_KEY, payload);
            localStorage.removeItem(REMEMBER_KEY);
        }

        userProfile = { name: data.name, email: data.username, position: data.position };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));

        showMainApp();
    } catch (e) { errEl.textContent = 'Login failed: ' + e.message; errEl.style.display = 'block'; }
}

/* ── Logout ── */
function doUserLogout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    localStorage.removeItem(PROFILE_KEY);
    loggedInUser = null;
    userProfile  = { name: '', email: '', position: '' };
    visits = []; photos = [];
    stopCamera();
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-remember').checked = false;
    document.getElementById('login-error').style.display = 'none';
}

/* ── Session check on load ── */
function checkSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBER_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data?.id) return false;
        loggedInUser = data;
        userProfile  = { name: data.name, email: data.username, position: data.position };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
        showMainApp();
        return true;
    } catch (e) { return false; }
}

function showMainApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display   = 'block';
    initApp();
}

/* ── Init (เรียกหลัง login เท่านั้น) ── */
function initApp() {
    populateProfileForm();
    document.getElementById('f-date').value = today();
    bindPositionToggle();
    updateFormState();

    ['pf-name', 'pf-email', 'pf-position'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.readOnly = true; el.style.background = '#F5F5F5'; el.style.color = '#888'; }
    });

    // แสดงชื่อ user + ปุ่ม logout ใน header
    const hdr = document.querySelector('.header');
    if (hdr && !document.getElementById('user-logout-btn')) {
        const userInfo = document.createElement('div');
        userInfo.style.cssText = 'display:flex;align-items:center;gap:10px;';
        userInfo.innerHTML = `
            <span style="font-size:13px;color:var(--text-muted);">Hi, <strong style="color:var(--text-main);">${esc(loggedInUser?.name || '')}</strong></span>
            <button id="user-logout-btn" onclick="doUserLogout()"
                style="padding:6px 14px;background:#FFF;border:1px solid var(--border-light);border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;color:var(--danger);">
                Logout
            </button>`;
        hdr.appendChild(userInfo);
    }

    const cbNext = document.getElementById('cb-next-visit');
    if (cbNext && !cbNext._bound) {
        cbNext._bound = true;
        cbNext.addEventListener('change', function() {
            document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
            if (this.checked) document.getElementById('f-next-date').value = today();
        });
    }

    switchTab('new');
    if (supabaseClient) { loadVisitsFromDB(); setupRealtime(); }
}

window.addEventListener('DOMContentLoaded', () => { checkSession(); });

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
    // Profile ถูก lock จาก DB — แสดงข้อความแจ้ง
    toast('Profile is managed by Admin. Contact admin to update.', false);
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
let realtimeChannel = null;

async function loadVisitsFromDB(isLoadMore = false) {
    if (!supabaseClient) return;
    if (!isLoadMore) currentPage = 0;
    try {
        // ดึง visits + delete_requests พร้อมกัน โดยเพิ่มการเรียงลำดับ request (ascending: true)
        const [visitsRes, reqsRes] = await Promise.all([
            supabaseClient.from('visits').select('*').order('created_at', { ascending: false }).range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1),
            supabaseClient.from('delete_requests').select('visit_id, status, created_at').order('created_at', { ascending: true })
        ]);

        if (visitsRes.error) throw visitsRes.error;

        // map request status (ตัวที่ใหม่ที่สุดจะทับตัวเก่าอัตโนมัติ)
        const reqMap = {};
        (reqsRes.data || []).forEach(r => { reqMap[r.visit_id] = r.status; });

        const formatted = (visitsRes.data || []).map(v => {
            const reqStatus = reqMap[v.id]; // 'pending' | 'approved' | 'rejected' | null
            return {
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
                delete_reason: v.delete_reason || '',
                req_status: reqStatus || null
            };
        });

        visits = isLoadMore ? [...visits, ...formatted] : formatted;
        updateCount();
        if (document.getElementById('tab-list').style.display !== 'none') renderList();
    } catch (e) { toast('Failed to load visits.', false); }
}

/* ── Realtime Subscription ── */
function setupRealtime() {
    if (!supabaseClient || realtimeChannel) return;

    realtimeChannel = supabaseClient
        .channel('app-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
            loadVisitsFromDB();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'delete_requests' }, () => {
            loadVisitsFromDB();
        })
        .subscribe();
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
        <div style="background: #FAFAFA; border: 1px solid var(--border-light); border-radius: 12px; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px dashed #EBEBEB;">
                <div>
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Outlet & Location</div>
                    <div style="font-size: 16px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        ${esc(outlet)}
                        <span class="badge badge-area" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${area}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Date</div>
                    <div style="font-size: 13px; font-weight: 500; color: var(--primary);">${fmtDate(date)}</div>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Met With</div>
                <div style="font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                    <span style="color: #666;">${esc(person)}</span> <span class="badge badge-pos">${esc(position)}</span>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Reason for Visit</div>
                <div style="font-size: 14px; color: #444; line-height: 1.5; background: #FFF; padding: 10px 14px; border-radius: 8px; border: 1px solid #EBEBEB;">${esc(reason).replace(/\n/g,'<br>')}</div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Result & Actions</div>
                <div style="font-size: 14px; color: #444; line-height: 1.5; background: #FFF; padding: 10px 14px; border-radius: 8px; border: 1px solid #EBEBEB;">${esc(finalResultText).replace(/\n/g,'<br>')}</div>
            </div>

            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #EBEBEB;">
                <div style="font-size: 12px; font-weight: 500; color: var(--text-main);">Attached Photos: <span style="color: var(--primary); font-weight: 600;">${photos.length}</span></div>
                ${photosHtml}
            </div>
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
        if (v.req_status === 'approved' || (v.is_deleted === true && v.req_status !== 'pending')) return false;
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos.toLowerCase())) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');
    if (!filtered.length) { el.innerHTML = `<div class="empty-state"><p>No visits found.</p></div>`; return; }

    el.innerHTML = filtered.map(v => {
        const isPending = v.req_status === 'pending';
        const statusBadge = isPending ? `<span class="badge" style="background:#FFEBEB;color:#D48A8A;margin-right:8px;">Pending Delete</span>` : '';
        const cardStyle = isPending ? 'opacity:0.7;border:1px dashed #D48A8A;background:#FAFAFA;' : '';
        
        return `
        <div class="visit-card" style="${cardStyle}" onclick="openDetail('${v.id}')">
          <div class="vc-header" style="margin-bottom: 8px; align-items: flex-start;">
             <span class="vc-name" style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
                 ${esc(v.outlet)}
                 <span class="badge badge-area" style="font-size: 10px; font-weight: normal;">${esc(v.area)}</span>
             </span>
             <span class="vc-date" style="white-space: nowrap;">${fmtDate(v.date)}</span>
          </div>
          <div class="vc-meta" style="margin-bottom: 10px;">
             ${statusBadge}
             <span class="vc-person" style="font-weight: 500; color: #555; display:flex; align-items:center; gap:6px;">${esc(v.person)} <span class="badge badge-pos">${esc(v.position)}</span></span>
          </div>
          <div class="vc-reason" style="${isPending ? 'text-decoration:line-through;' : ''}">${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}</div>
          ${renderThumbStrip(v.photos)}
        </div>`;
    }).join('');
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';
    return `<div class="vc-thumbs">${ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}"></div>`).join('')}${ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : ''}</div>`;
}

/* ── Visit List & Details ── */
function openDetail(id) {
    const v = visits.find(x => x.id === id); if (!v) return;
    const isPending = v.req_status === 'pending';
    
    // กำหนดข้อมูลที่จะแสดงในกล่อง
    const visitInfo = [
        ['Met With', `${v.person} (${v.position})`], 
        ['Reason for Visit', v.reason], 
        ['Result & Actions', v.result]
    ];

    const renderFields = rows => rows.map(([l, val]) => `
        <div class="detail-field" style="margin-bottom: 20px;">
            <span class="detail-label">${l}</span>
            <span class="detail-value" style="background: #FAFAFA; padding: 12px 16px; border-radius: 8px; border: 1px solid #EBEBEB; margin-top: 6px; display: block;">${esc(val).replace(/\n/g, '<br>')}</span>
        </div>
    `).join('');

    const photosHtml = v.photos && v.photos.length ? `
        <div style="border-top:1px dashed #EBEBEB; margin:24px 0 16px 0;"></div>
        <div class="detail-label" style="margin-bottom:12px;">ATTACHED PHOTOS (${v.photos.length})</div>
        <div class="detail-photos">
            ${v.photos.map(p => `<div class="detail-photo" onclick="openLightbox('${p}')"><img src="${p}" style="cursor:zoom-in;"></div>`).join('')}
        </div>` : '';
    
    document.getElementById('detail-content').innerHTML = `
        ${isPending ? `<div style="background:#FFF5F5;border:1px solid #FBCBCB;padding:12px;border-radius:8px;margin-bottom:20px;"><strong style="color:#D48A8A;font-size:13px;">⚠️ Pending deletion review.</strong><div style="font-size:13px;color:#666;margin-top:4px;">Reason: ${esc(v.delete_reason)}</div></div>` : ''}
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #EBEBEB;">
            <div>
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Outlet & Location</div>
                <h2 style="font-size: 18px; font-weight: 600; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${esc(v.outlet)}
                    <span class="badge badge-area" style="font-size: 11px;">${esc(v.area)}</span>
                </h2>
            </div>
            <div style="text-align: right; padding-right: 36px;"> <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Date</div>
                <div style="font-size: 14px; font-weight: 500; color: var(--primary);">${fmtDate(v.date)}</div>
            </div>
        </div>

        <div style="${isPending ? 'opacity:0.6;' : ''}">
          ${renderFields(visitInfo)}
        </div>
        
        ${photosHtml}
        
        ${!isPending ? `
        <div class="detail-actions" style="margin-top:2rem; border-top:1px solid #EBEBEB; padding-top:1.5rem; display:flex;">
            <button class="btn-secondary btn-danger" onclick="openDeleteRequest('${v.id}')" style="margin-left:auto;">Request Deletion</button>
        </div>` : ''}`;
        
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
        
        // 🌟 อัปเดตข้อมูลบนหน้าจอ (ใส่ req_status เป็น pending เพื่อไม่ให้มันซ่อน)
        const idx = visits.findIndex(v => v.id === targetId);
        if (idx !== -1) { 
            visits[idx].is_deleted = true; 
            visits[idx].delete_reason = reason; 
            visits[idx].req_status = 'pending'; // <-- เพิ่มบรรทัดนี้ครับ
        }
        renderList(); 
        toast('Delete request submitted.'); 
        closeDetail();
    } catch (err) { 
        toast('Failed to submit request: ' + err.message, false); 
    }
}

/* ── Utils ── */
function openLightbox(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`; }
function updateCount() { 
    const el = document.getElementById('rec-count'); 
    if (!el) return; 
    
    // ให้นับเฉพาะข้อมูลที่สถานะยังไม่ถูก approve ให้ลบ
    const activeVisits = visits.filter(v => {
        if (v.req_status === 'approved' || (v.is_deleted === true && v.req_status !== 'pending')) return false;
        return true;
    });

    el.textContent = activeVisits.length + (activeVisits.length === 1 ? ' record' : ' records'); 
}function toast(msg, ok = true) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.style.background = ok ? 'var(--primary)' : 'var(--danger)'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }

/* ── LIBRARY PHOTO SELECTION ── */
function selectFromLibrary() {
    if (!isProfileComplete()) { 
        toast('Please complete your profile first.', false); 
        return; 
    }
    document.getElementById('library-input').click(); 
}

async function handleLibrarySelection(input) {
    if (!input.files || !input.files.length) return;
    
    const availableSlots = 10 - photos.length;
    if (availableSlots <= 0) { 
        toast('Photo limit (10) reached.', false); 
        input.value = ''; 
        return; 
    }

    const filesToUpload = Array.from(input.files).slice(0, availableSlots);
    if (input.files.length > availableSlots) { 
        toast(`Can only add ${availableSlots} more photo(s).`); 
    }

    toast('Processing images...', true);
    
    for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) continue;
        try { 
            const dataUrl = await fileToDataUrl(file); 
            photos.push(dataUrl); 
        } catch (e) { 
            console.error("image processing failed:", e); 
        }
    }
    
    input.value = '';
    renderPreviews(); 
    updateModalCounter();
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
