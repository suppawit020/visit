/* ─────────────────────────────────────────
   Visit / DC Check  —  app.js (Void Feature Edition)
   ───────────────────────────────────────── */

const PROFILE_KEY = 'outlet_profile_v1';
let visits = [];
let photos = [];
let userProfile = { name: '', email: '', position: '' };

let currentPage = 0;
const PAGE_SIZE = 20;

// ตัวแปรสำหรับเก็บข้อมูลไว้รอเซฟ
let pendingSaveData = null;

// ตัวแปรสำหรับเก็บ ID ของรายการที่จะยกเลิก (Void)
let voidTargetId = null;

// 🚀 ตั้งค่า Supabase 
const SUPABASE_URL = 'https://tphoxfcoynxfnvpvzkfv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YnMJCwa2jB_uhegOALtL6Q_DMiR--1X';
let supabaseClient = null;

try {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.warn("ไม่พบ Supabase Script");
    }
} catch (e) {
    console.error("เกิดข้อผิดพลาดในการเชื่อมต่อ:", e);
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
        setTimeout(() => toast('⚠️ Please complete your profile to continue.', false), 500);
    }

    if (supabaseClient) {
        loadVisitsFromDB();
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err => console.log('SW setup failed'));
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
        toast('Profile saved successfully!');
        switchTab('new');
    } else {
        toast('Profile saved, but please complete all fields to unlock New Visit.', false);
    }
}

function updateFormState() {
    const isComplete = isProfileComplete();
    const formElements = document.querySelectorAll('#tab-new input, #tab-new select, #tab-new textarea, #btn-save, #btn-clear, #btn-start-cam');

    formElements.forEach(el => {
        if (el) {
            el.disabled = !isComplete;
            if (!isComplete) {
                el.style.backgroundColor = '#E9ECEF';
                el.style.cursor = 'not-allowed';
            } else {
                el.style.backgroundColor = '';
                el.style.cursor = '';
            }
        }
    });
}

/* ── 🔄 SQL Data Loader ── */
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
                creatorPosition: v.creator_position,
                is_voided: v.is_voided || false,
                void_reason: v.void_reason || ''
            }));

            visits = isLoadMore ? [...visits, ...formattedData] : formattedData;

            const loadMoreBtn = document.getElementById('load-more-wrap');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = data.length === PAGE_SIZE ? 'block' : 'none';
            }

            updateCount();
            if (document.getElementById('tab-list').style.display !== 'none') renderList();
        }
    } catch (e) {
        console.error("ดึงข้อมูลล้มเหลว:", e);
    }
}

function loadMoreVisits() {
    currentPage++;
    loadVisitsFromDB(true);
}

function switchTab(tab) {
    if (tab === 'new' && !isProfileComplete()) {
        toast('⚠️ Please complete your profile first.', false);
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

    if (tab === 'list') {
        if (supabaseClient) loadVisitsFromDB();
        else renderList();
    }
}

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

/* ── 📸 Camera System ── */
let cameraStream = null;

async function startCamera() {
    const video = document.getElementById('camera-view');
    const btnStart = document.getElementById('btn-start-cam');
    const btnCapture = document.getElementById('btn-capture');
    const btnStop = document.getElementById('btn-stop-cam');
    const prompt = document.getElementById('upload-prompt');

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });

        video.srcObject = cameraStream;
        video.style.display = 'block';
        btnStart.style.display = 'none';
        btnCapture.style.display = 'inline-flex';
        btnStop.style.display = 'inline-flex';
        if (prompt) prompt.style.display = 'none';

    } catch (err) {
        console.error("Camera Error:", err);
        toast('❌ ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตให้เว็บเข้าถึงกล้องของคุณ', false);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    document.getElementById('camera-view').style.display = 'none';
    document.getElementById('btn-start-cam').style.display = 'inline-flex';
    document.getElementById('btn-capture').style.display = 'none';
    document.getElementById('btn-stop-cam').style.display = 'none';

    if (photos.length === 0) {
        document.getElementById('upload-prompt').style.display = 'block';
    }
}

function capturePhoto() {
    if (photos.length >= 10) {
        toast('⚠️ You can only take up to 10 photos.', false);
        return;
    }

    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64Img = canvas.toDataURL('image/jpeg', 0.7);
    photos.push(base64Img);

    renderPreviews();
    toast('📸 Photo captured!');
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = photos.length + ' / 10';
    document.getElementById('previews').innerHTML = photos
        .map((p, i) => `<div class="photo-thumb"><img src="${p}" alt=""><button onclick="removePhoto(${i})">✕</button></div>`)
        .join('');
}

function removePhoto(i) {
    photos.splice(i, 1);
    renderPreviews();
    if (photos.length === 0 && !cameraStream) {
        document.getElementById('upload-prompt').style.display = 'block';
    }
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
                contentType: 'image/jpeg',
                cacheControl: '3600',
                upsert: false
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
        if (!navigator.geolocation) {
            resolve(null);
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => resolve(null), { enableHighAccuracy: true, timeout: 5000 }
        );
    });
}

/* ── 🟡 ระบบตรวจสอบและยืนยันการ Save แบบ Popup ── */
function triggerSaveConfirm() {
    if (!isProfileComplete()) {
        switchTab('profile');
        toast('⚠️ Please complete your profile first.', false);
        return;
    }

    const outlet = document.getElementById('f-outlet').value.trim();
    const area = document.getElementById('f-area').value;
    const person = document.getElementById('f-person').value.trim();
    const position = getPosition();
    const date = document.getElementById('f-date').value;
    const reason = document.getElementById('f-reason').value.trim();
    const result = document.getElementById('f-result').value.trim();

    if (!outlet || !area || !person || !position || !date || !reason || !result) {
        toast('⚠️ กรุณากรอกข้อมูลให้ครบทุกช่องที่มีเครื่องหมาย *', false);
        return;
    }

    if (photos.length === 0) {
        toast('⚠️ กรุณาถ่ายภาพอย่างน้อย 1 ภาพเพื่อเป็นหลักฐาน', false);
        return;
    }

    // เก็บข้อมูลลงตัวแปรไว้รอเซฟ
    pendingSaveData = { outlet, area, person, position, date, reason, result };

    // 📍 สร้าง HTML แสดงข้อมูลทั้งหมดให้พนักงานตรวจสอบก่อนเซฟ
    const reviewHtml = `
        <div style="text-align: left; line-height: 1.6; font-size: 14px; color: #333;">
            <div style="margin-bottom: 8px;"><strong>📍 สาขา:</strong> <span style="color:#111;">${esc(outlet)}</span> <span style="color:#888;">(${area})</span></div>
            <div style="margin-bottom: 8px;"><strong>👤 ผู้ติดต่อ:</strong> <span style="color:#111;">${esc(person)}</span> <span style="color:#888;">(${esc(position)})</span></div>
            <div style="margin-bottom: 8px;"><strong>📅 วันที่:</strong> <span style="color:#111;">${fmtDate(date)}</span></div>
            
            <div style="margin-top: 12px; border-top: 1px dashed #ccc; padding-top: 12px;">
                <strong style="color:var(--primary);">📝 เหตุผลที่เข้าพบ:</strong>
                <div style="background:#FFF; border:1px solid #EBEBEB; padding:8px; border-radius:6px; margin-top:4px; color:#555;">${esc(reason).replace(/\n/g, '<br>')}</div>
            </div>
            
            <div style="margin-top: 12px;">
                <strong style="color:var(--primary);">🎯 ผลลัพธ์ / สิ่งที่ต้องทำต่อ:</strong>
                <div style="background:#FFF; border:1px solid #EBEBEB; padding:8px; border-radius:6px; margin-top:4px; color:#555;">${esc(result).replace(/\n/g, '<br>')}</div>
            </div>
            
            <div style="margin-top: 12px; border-top: 1px dashed #ccc; padding-top: 12px; text-align: center;">
                <strong>📸 หลักฐานรูปภาพ:</strong> <span style="color:var(--primary); font-weight:bold;">${photos.length}</span> ภาพ
            </div>
        </div>
    `;

    // แทรก HTML เข้าไปในกล่อง Popup ยืนยัน
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
    if (!supabaseClient) {
        toast('❌ Cannot connect to database.', false);
        return;
    }

    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    toast('⏳ กำลังอัปโหลดข้อมูลและรูปภาพ...', true);

    try {
        const id = Date.now().toString();
        const location = await getCurrentLocation();

        const newUploadedUrls = await uploadPhotosToStorage(id);

        const payload = {
            id: id,
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
            is_voided: false,
            void_reason: null
        };

        const { error } = await supabaseClient.from('visits').insert([payload]);
        if (error) throw error;

        // แจ้งเตือนแบบบังคับกดเพื่อให้เห็นชัดเจนว่าเซฟสำเร็จ
        alert('✅ บันทึกข้อมูลเข้าสู่ระบบสำเร็จเรียบร้อยแล้ว!');

        clearForm();
        loadVisitsFromDB();
        switchTab('list');

    } catch (error) {
        console.error(error);
        toast('❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล', false);
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
        const voidBadge = v.is_voided ? `<span class="badge" style="background:#FFEBEB; color:#D48A8A;">❌ ยกเลิกแล้ว</span>` : '';
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

/* ── Detail view ── */
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

    const topVoidAlert = v.is_voided ? `
        <div style="background: #FFF5F5; border: 1px solid #FBCBCB; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
            <strong style="color: #D48A8A; font-size: 13px;">❌ รายการนี้ถูกยกเลิกแล้ว</strong>
            <div style="font-size: 13px; color: #666; margin-top: 6px;">เหตุผล: ${esc(v.void_reason)}</div>
        </div>
    ` : '';

    // 📍 มีแค่ปุ่ม Void อย่างเดียวเพื่อป้องกันการทุจริต
    const bottomVoidAction = !v.is_voided ? `
        <div class="detail-actions" style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-light); display: flex;">
            <button class="btn-secondary btn-danger" onclick="openVoidConfirm('${v.id}')" style="margin-left: auto;">❌ ยกเลิกรายการ (Void)</button>
        </div>
    ` : '';

  document.getElementById('detail-content').innerHTML = `
    <h2 style="font-size:18px;font-weight:600;margin-bottom:1.5rem;color:var(--text-main)">${esc(v.outlet)}</h2>
    
    ${topVoidAlert}

    <div class="detail-grid" style="${v.is_voided ? 'opacity: 0.6;' : ''}">
      <div class="detail-col-main">
        ${renderFields(visitInfo)}
      </div>
      <div class="detail-col-visitor">
        <div style="font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;margin-bottom:12px;letter-spacing:0.05em;">Visitor Profile</div>
        ${renderFields(visitorInfo)}
      </div>
    </div>

    ${photosHtml}

    ${bottomVoidAction}
  `;

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
}

/* ── 🔴 ระบบยกเลิกรายการ (Void System) ── */
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
    
    if (!reasonInput) {
        toast('⚠️ กรุณาระบุเหตุผลในการยกเลิกรายการ', false);
        return;
    }

    if (!voidTargetId || !supabaseClient) return;

    closeVoidConfirm();
    toast('⏳ กำลังยกเลิกรายการ...', true);

    try {
        const { error } = await supabaseClient
            .from('visits')
            .update({ 
                is_voided: true, 
                void_reason: reasonInput 
            })
            .eq('id', voidTargetId);

        if (error) throw error;

        toast('✅ ยกเลิกรายการสำเร็จ');
        closeDetail();
        loadVisitsFromDB();
    } catch (err) {
        console.error(err);
        toast('❌ ไม่สามารถยกเลิกรายการได้', false);
    }
}

/* ── Lightbox ── */
function openLightbox(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  setTimeout(() => t.classList.remove('show'), 3000);
}
