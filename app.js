const PROFILE_KEY = 'outlet_profile_v1';
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };
let currentPage = 0;
const PAGE_SIZE = 20;

let pendingSaveData = null;
let voidTargetId = null;

const SUPABASE_URL = 'https://tphoxfcoynxfnvpvzkfv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YnMJCwa2jB_uhegOALtL6Q_DMiR--1X';
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

    switchTab(isProfileComplete() ? 'new' : 'profile');
    if (!isProfileComplete()) {
        setTimeout(() => toast('Please complete your profile to continue.', false), 500);
    }

    if (supabaseClient) loadVisitsFromDB();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for (let registration of registrations) {
                registration.unregister();
            }
        });
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
    if(btnCam) {
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

/* ── SQL Data Loader ── */
async function loadVisitsFromDB(isLoadMore = false) {
    if (!isLoadMore) currentPage = 0;
    try {
        const { data, error } = await supabaseClient
            .from('visits')
            .select('*')
            .order('created_at', { ascending: false })
            .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        if (!error && data) {
            const formattedData = data.map(v => ({
                id: v.id, outlet: v.outlet, area: v.area, person: v.person,
                position: v.position, date: v.date, reason: v.reason, result: v.result,
                photos: v.photos || [], creatorName: v.creator_name,
                creatorEmail: v.creator_email, creatorPosition: v.creator_position,
                is_voided: v.is_voided || false, void_reason: v.void_reason || ''
            }));

            visits = isLoadMore ? [...visits, ...formattedData] : formattedData;
            const loadMoreBtn = document.getElementById('load-more-wrap');
            if (loadMoreBtn) loadMoreBtn.style.display = data.length === PAGE_SIZE ? 'block' : 'none';

            updateCount();
            if (document.getElementById('tab-list').style.display !== 'none') renderList();
        }
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

function loadMoreVisits() {
    currentPage++;
    loadVisitsFromDB(true);
}

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

    if (tab === 'list') {
        if (supabaseClient) loadVisitsFromDB();
        else renderList();
    }
}

function bindPositionToggle() {
    document.getElementById('f-position').addEventListener('change', function() {
        document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none';
    });
}

function getPosition() {
    const s = document.getElementById('f-position').value;
    return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s;
}

/* ── 📷 FULLSCREEN MODAL CAMERA LOGIC ── */
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
        video.srcObject = cameraStream;
        modal.classList.add('open');
        updateModalCounter();
    } catch (err) {
        console.error("Camera Error:", err);
        toast('Cannot access camera. Check browser permissions.', false);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    document.getElementById('camera-modal').classList.remove('open');
}

function updateModalCounter() {
    document.getElementById('modal-photo-counter').textContent = `${photos.length} / 10`;
}

function capturePhoto() {
    if (photos.length >= 10) {
        toast('Max 10 photos allowed.', false);
        return;
    }

    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    photos.push(canvas.toDataURL('image/jpeg', 0.7));
    
    // Flash effect
    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);

    updateModalCounter();
    renderPreviews();
    
    // ถ้าถ่ายครบ 10 รูปให้ปิดกล้องอัตโนมัติ
    if (photos.length >= 10) {
        toast('Reached 10 photos maximum.');
        setTimeout(stopCamera, 500);
    }
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${photos.length} / 10`;
    const previewContainer = document.getElementById('previews');
    const capturedSection = document.getElementById('captured-section');
    
    if(photos.length > 0) {
        capturedSection.style.display = 'block';
        previewContainer.innerHTML = photos
            .map((p, i) => `<div class="photo-thumb"><img src="${p}" alt="Preview"><button onclick="removePhoto(${i})">✕</button></div>`)
            .join('');
    } else {
        capturedSection.style.display = 'none';
        previewContainer.innerHTML = '';
    }
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
    updateModalCounter();
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
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => resolve(null), { enableHighAccuracy: true, timeout: 5000 }
        );
    });
}

/* ── 🟡 SAVE CONFIRMATION WITH ACTUAL IMAGES ── */
function triggerSaveConfirm() {
    if (!isProfileComplete()) { switchTab('profile'); return; }

    const outlet = document.getElementById('f-outlet').value.trim();
    const area = document.getElementById('f-area').value;
    const person = document.getElementById('f-person').value.trim();
    const position = getPosition();
    const date = document.getElementById('f-date').value;
    const reason = document.getElementById('f-reason').value.trim();
    const result = document.getElementById('f-result').value.trim();

    if (!outlet || !area || !person || !position || !date || !reason || !result) {
        toast('Please fill in all required fields (*).', false); return;
    }
    if (photos.length === 0) {
        toast('Please capture at least 1 photo.', false); return;
    }

    pendingSaveData = { outlet, area, person, position, date, reason, result };

    // 📍 สร้าง HTML รูปภาพให้แสดงในหน้าทบทวนก่อนเซฟ
    let photosHtml = `<div class="confirm-photo-grid">`;
    photos.forEach(p => {
        photosHtml += `<img src="${p}" alt="Evidence">`;
    });
    photosHtml += `</div>`;

    const reviewHtml = `
        <div class="visit-card" style="margin: 0; box-shadow: none; border: 1px solid var(--border-light); cursor: default; transform: none; padding: 1rem;">
          <div class="vc-header">
            <span class="vc-name">${esc(outlet)}</span>
            <span class="vc-date">${fmtDate(date)}</span>
          </div>
          <div class="vc-meta">
            <span class="badge badge-area">${area}</span>
            <span class="badge badge-pos">${esc(position)}</span>
            <span class="vc-person">${esc(person)}</span>
          </div>
          <div style="margin-top: 12px;">
            <strong style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Reason for Visit</strong>
            <div class="vc-reason" style="margin-top: 4px; color: #333;">${esc(reason).replace(/\n/g, '<br>')}</div>
          </div>
          <div style="margin-top: 12px;">
            <strong style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Result</strong>
            <div class="vc-reason" style="margin-top: 4px; color: #333;">${esc(result).replace(/\n/g, '<br>')}</div>
          </div>
          <div style="margin-top: 16px; border-top: 1px dashed #eee; padding-top: 12px; font-size: 13px; color: #555;">
            Attached Photos: <strong>${photos.length}</strong>
            ${photosHtml}
          </div>
        </div>
    `;
    
    document.getElementById('save-confirm-text').innerHTML = reviewHtml;
    document.getElementById('save-confirm-overlay').classList.add('open');
}

function closeSaveConfirm() {
    document.getElementById('save-confirm-overlay').classList.remove('open');
    pendingSaveData = null;
}

async function executeSave() {
    closeSaveConfirm();
    if (!pendingSaveData) return;
    if (!supabaseClient) { toast('Database disconnected.', false); return; }

    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    toast('Uploading data...', true);

    try {
        const id = Date.now().toString();
        const location = await getCurrentLocation();
        const newUploadedUrls = await uploadPhotosToStorage(id);

        const payload = {
            id: id, outlet: pendingSaveData.outlet, area: pendingSaveData.area,
            person: pendingSaveData.person, position: pendingSaveData.position,
            date: pendingSaveData.date, reason: pendingSaveData.reason,
            result: pendingSaveData.result, photos: newUploadedUrls,
            creator_name: userProfile.name, creator_email: userProfile.email,
            creator_position: userProfile.position,
            lat: location ? location.lat : null, lng: location ? location.lng : null,
            is_voided: false, void_reason: null
        };

        const { error } = await supabaseClient.from('visits').insert([payload]);
        if (error) throw error;
        
        alert('Visit Record Saved Successfully.');

        clearForm();
        loadVisitsFromDB();
        switchTab('list');

    } catch (error) {
        console.error(error);
        toast('Error saving record.', false);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Visit';
        pendingSaveData = null;
    }
}

function clearForm() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-area').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('pos-other-wrap').style.display = 'none';
    document.getElementById('f-date').value = today();
    photos = [];
    renderPreviews();
    stopCamera();
}

/* ── Visit list ── */
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

    el.innerHTML = filtered.map(v => {
        const voidBadge = v.is_voided ? `<span class="badge" style="background:#FFEBEB; color:#D48A8A;">Voided</span>` : '';
        const cardStyle = v.is_voided ? `opacity: 0.7; border: 1px dashed #D48A8A; background: #FAFAFA;` : '';

        return `
        <div class="visit-card" style="${cardStyle}" onclick="openDetail('${v.id}')">
          <div class="vc-header">
            <span class="vc-name">${esc(v.outlet)}</span>
            <span class="vc-date">${fmtDate(v.date)}</span>
          </div>
          <div class="vc-meta">
            ${voidBadge}
            <span class="badge badge-area">${v.area}</span>
            <span class="badge badge-pos">${esc(v.position)}</span>
            <span class="vc-person">${esc(v.person)}</span>
          </div>
          <div class="vc-reason" style="${v.is_voided ? 'text-decoration: line-through;' : ''}">${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}</div>
          ${renderThumbStrip(v.photos)}
        </div>
        `;
    }).join('');
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';
    const visible = ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}" alt=""></div>`).join('');
    const extra = ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : '';
    return `<div class="vc-thumbs">${visible}${extra}</div>`;
}

function openDetail(id) {
    const v = visits.find(x => x.id === id);
    if (!v) return;

    const visitInfo = [['Outlet', v.outlet], ['Area', v.area], ['Date', fmtDate(v.date)], ['Person', v.person], ['Position', v.position], ['Reason', v.reason], ['Result', v.result]];
    const visitorInfo = [['Created By', v.creatorName || '-'], ['Email', v.creatorEmail || '-'], ['Role', v.creatorPosition || '-']];

    const renderFields = (rows) => rows.map(([l, val]) => `<div class="detail-field"><span class="detail-label">${l}</span><span class="detail-value">${esc(val)}</span></div>`).join('');

    const photosHtml = v.photos.length ? `<div style="border-top:1px dashed #EBEBEB; margin:20px 0;"></div><div class="detail-label" style="margin-bottom:8px">Photos (${v.photos.length})</div><div class="detail-photos">${v.photos.map(p => `<div class="detail-photo" onclick="openLightbox('${p}')"><img src="${p}" alt=""></div>`).join('')}</div>` : '';

    const topVoidAlert = v.is_voided ? `<div style="background: #FFF5F5; border: 1px solid #FBCBCB; padding: 12px; border-radius: 8px; margin-bottom: 16px;"><strong style="color: #D48A8A; font-size: 13px;">This record is voided.</strong><div style="font-size: 13px; color: #666; margin-top: 6px;">Reason: ${esc(v.void_reason)}</div></div>` : '';
    const bottomVoidAction = !v.is_voided ? `<div class="detail-actions" style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-light); display: flex;"><button class="btn-secondary btn-danger" onclick="openVoidConfirm('${v.id}')" style="margin-left: auto;">Void Record</button></div>` : '';

  document.getElementById('detail-content').innerHTML = `<h2 style="font-size:18px;font-weight:600;margin-bottom:1.5rem;color:var(--text-main)">${esc(v.outlet)}</h2>${topVoidAlert}<div class="detail-grid" style="${v.is_voided ? 'opacity: 0.6;' : ''}"><div class="detail-col-main">${renderFields(visitInfo)}</div><div class="detail-col-visitor"><div style="font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;margin-bottom:12px;letter-spacing:0.05em;">Visitor Profile</div>${renderFields(visitorInfo)}</div></div>${photosHtml}${bottomVoidAction}`;
  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

/* ── Void System ── */
function openVoidConfirm(id) {
    voidTargetId = id;
    document.getElementById('void-reason-input').value = '';
    document.getElementById('void-confirm-overlay').classList.add('open');
}

function closeVoidConfirm() {
    voidTargetId = null;
    document.getElementById('void-confirm-overlay').classList.remove('open');
}

async function executeVoid() {
    const reasonInput = document.getElementById('void-reason-input').value.trim();
    if (!reasonInput) { toast('Please provide a reason.', false); return; }
    if (!voidTargetId || !supabaseClient) return;

    closeVoidConfirm();
    toast('Voiding...', true);

    try {
        const { error } = await supabaseClient.from('visits').update({ is_voided: true, void_reason: reasonInput }).eq('id', voidTargetId);
        if (error) throw error;
        toast('Voided successfully.');
        closeDetail();
        loadVisitsFromDB();
    } catch (err) {
        console.error(err);
        toast('Failed to void.', false);
    }
}

/* ── Utils ── */
function openLightbox(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) {
  if (!d) return ''; const [y, m, day] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`;
}
function updateCount() { document.getElementById('rec-count').textContent = visits.length + (visits.length === 1 ? ' record' : ' records'); }
function toast(msg, ok = true) {
  const t = document.getElementById('toast'); t.textContent = msg; t.style.background = ok ? 'var(--primary)' : 'var(--danger)';
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
}
