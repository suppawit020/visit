// ============================================================
// APP CONFIGURATION & CONSTANTS
// ============================================================
const CONFIG = {
    KEYS: {
        PROFILE: 'outlet_profile_v1',
        SESSION: 'checklist_user_session',
        REMEMBER: 'checklist_user_remember',
        AUTOSAVE: 'checklist_autosave_v1'
    },
    SUPABASE: {
        URL: 'https://kthdrgmdppyaooudbiog.supabase.co',
        KEY: 'sb_publishable_aCfFzE-lGDhV1oTqaSCXEQ_NTs6SAKr'
    },
    PAGE_SIZE: 5,
    MAX_PHOTOS: 10,
    ALLOW_LIBRARY_UPLOAD: true // อนุญาตให้ดึงรูปจากเครื่องได้
};

// ============================================================
// GLOBAL STATE MANAGEMENT
// ============================================================
let AppState = {
    cameraStream: null,
    currentFacingMode: 'environment', 
    visits: [],
    photos: [],
    userProfile: { name: '', email: '', position: '', avatar: '' },
    currentPage: 0,
    pendingSaveData: null,
    deleteTargetId: null,
    loggedInUser: null,
    supabaseClient: null,
    realtimeChannel: null,
    totalPages: 1,
    totalCount: 0,
    fpDate: null,
    fpNextDate: null,
    fpFilterDate: null
};

// ============================================================
// INITIALIZATION & SESSION
// ============================================================
try {
    if (typeof window.supabase !== 'undefined') {
        AppState.supabaseClient = window.supabase.createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.KEY);
    }
} catch (e) {
    console.error("Supabase Connection error:", e);
}

window.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    checkSession();
});

function checkSession() {
    try {
        const raw = sessionStorage.getItem(CONFIG.KEYS.SESSION) || localStorage.getItem(CONFIG.KEYS.REMEMBER);
        if (!raw) return false;

        const data = JSON.parse(raw);
        if (!data?.id) return false;

        AppState.loggedInUser = data;
        
        const localProfile = JSON.parse(localStorage.getItem(CONFIG.KEYS.PROFILE)) || {};
        AppState.userProfile = { 
            name: data.name, 
            email: data.username, 
            position: data.position, 
            avatar: localProfile.avatar || '' 
        };
        localStorage.setItem(CONFIG.KEYS.PROFILE, JSON.stringify(AppState.userProfile));
        
        showMainApp();
        return true;
    } catch (e) {
        return false;
    }
}

function initApp() {
    AppState.fpDate = flatpickr("#f-date", {
        altInput: true,
        altFormat: "d M Y", 
        dateFormat: "Y-m-d", 
        defaultDate: "today",
        minDate: "today", 
        maxDate: "today"
    });

    AppState.fpNextDate = flatpickr("#f-next-date", {
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        minDate: "today"
    });

    AppState.fpFilterDate = flatpickr("#fl-date-wrap", {
        wrap: true, 
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        onChange: function(selectedDates, dateStr, instance) {
            resetAndFetch(); 
        }
    });

    bindPositionToggle();
    updateFormState();

    document.getElementById('profile-menu-wrap').style.display = 'block';
    
    const initial = (AppState.loggedInUser?.name || 'U').charAt(0).toUpperCase();
    document.getElementById('avatar-small-text').textContent = initial;
    document.getElementById('avatar-text').textContent = initial;
    document.getElementById('pd-name').textContent = AppState.loggedInUser?.name || '';
    document.getElementById('pd-email').textContent = AppState.loggedInUser?.username || '';
    document.getElementById('pd-position').textContent = AppState.loggedInUser?.position || '';

    loadAvatarUI();

    const cbNext = document.getElementById('cb-next-visit');
    if (cbNext && !cbNext._bound) {
        cbNext._bound = true;
        cbNext.addEventListener('change', function() {
            document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
            if (this.checked && AppState.fpNextDate) {
                AppState.fpNextDate.setDate(today());
            }
        });
    }

    bindAutoSave();
    loadAutoSaveData();
    switchTab('new');

    if (AppState.supabaseClient) {
        loadVisitsFromDB();
        setupRealtime();
    }
}

window.handleFilterPosChange = function() {
    const pos = document.getElementById('fl-pos').value;
    const otherInput = document.getElementById('fl-pos-other');
    if (pos === '__other__') {
        otherInput.style.display = 'block';
        otherInput.focus();
    } else {
        otherInput.style.display = 'none';
        otherInput.value = '';
    }
    resetAndFetch();
}

// ============================================================
// AUTHENTICATION MODULE
// ============================================================
window.doUserLogin = async function() {
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-pass').value;
    const remember = document.getElementById('login-remember').checked;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!username || !pass) {
        errEl.textContent = 'Please enter username and password.';
        errEl.style.display = 'block';
        return;
    }
    if (!AppState.supabaseClient) {
        errEl.textContent = 'Database not connected.';
        errEl.style.display = 'block';
        return;
    }

    try {
        const { data, error } = await AppState.supabaseClient
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            errEl.textContent = 'Username not found or account is inactive.';
            errEl.style.display = 'block';
            return;
        }
        if (data.password_hash !== pass) {
            errEl.textContent = 'Incorrect password.';
            errEl.style.display = 'block';
            return;
        }

        AppState.loggedInUser = data;
        const payload = JSON.stringify({ 
            id: data.id, 
            username: data.username, 
            name: data.name, 
            position: data.position 
        });

        if (remember) {
            localStorage.setItem(CONFIG.KEYS.REMEMBER, payload);
            sessionStorage.removeItem(CONFIG.KEYS.SESSION);
        } else {
            sessionStorage.setItem(CONFIG.KEYS.SESSION, payload);
            localStorage.removeItem(CONFIG.KEYS.REMEMBER);
        }

        const localProfile = JSON.parse(localStorage.getItem(CONFIG.KEYS.PROFILE)) || {};
        AppState.userProfile = { 
            name: data.name, 
            email: data.username, 
            position: data.position, 
            avatar: localProfile.avatar || '' 
        };
        localStorage.setItem(CONFIG.KEYS.PROFILE, JSON.stringify(AppState.userProfile));

        showMainApp();
    } catch (e) {
        errEl.textContent = 'Login failed: ' + e.message;
        errEl.style.display = 'block';
    }
}

window.doUserLogout = function() {
    sessionStorage.removeItem(CONFIG.KEYS.SESSION);
    localStorage.removeItem(CONFIG.KEYS.REMEMBER);
    localStorage.removeItem(CONFIG.KEYS.PROFILE);
    
    AppState.loggedInUser = null;
    AppState.userProfile = { name: '', email: '', position: '', avatar: '' };
    AppState.visits = [];
    AppState.photos = [];
    
    stopCamera();
    
    document.getElementById('profile-menu-wrap').style.display = 'none';
    document.getElementById('profile-dropdown').classList.remove('show');
    loadAvatarUI();
    
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-remember').checked = false;
    document.getElementById('login-error').style.display = 'none';
    
    document.getElementById('login-pass').type = 'password';
    document.getElementById('eye-icon').innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
}

window.togglePasswordVisibility = function() {
    const passInput = document.getElementById('login-pass');
    const eyeIcon = document.getElementById('eye-icon');
    
    if (passInput.type === 'password') {
        passInput.type = 'text';
        eyeIcon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
    } else {
        passInput.type = 'password';
        eyeIcon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
    }
}

// ============================================================
// DATABASE & STORAGE OPERATIONS
// ============================================================

window.resetAndFetch = function() {
    AppState.currentPage = 0;
    if (AppState.supabaseClient) {
        fetchVisitsWithSkeleton();
    } else {
        window.renderList();
    }
}

let searchTimeout;
window.debounceSearch = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        window.resetAndFetch();
    }, 500);
}

async function loadVisitsFromDB() {
    if (!AppState.supabaseClient) return;
    
    try {
        const rangeStart = AppState.currentPage * CONFIG.PAGE_SIZE;
        const rangeEnd = (AppState.currentPage + 1) * CONFIG.PAGE_SIZE - 1;

        const adminPositions = ['CEO', 'CFO', 'OWNER', 'ADMIN']; 
        const currentPos = AppState.userProfile.position ? AppState.userProfile.position.toUpperCase() : '';
        const isAdmin = adminPositions.includes(currentPos);

        let visitsQuery = AppState.supabaseClient.from('visits').select('*');
        let countQuery = AppState.supabaseClient.from('visits').select('*', { count: 'exact', head: true });
        
        if (!isAdmin) {
            visitsQuery = visitsQuery.eq('creator_email', AppState.userProfile.email);
            countQuery = countQuery.eq('creator_email', AppState.userProfile.email);
        }

        const filterArea = document.getElementById('fl-area') ? document.getElementById('fl-area').value : '';
        let filterPos = document.getElementById('fl-pos') ? document.getElementById('fl-pos').value : '';
        const filterDate = document.getElementById('fl-date') ? document.getElementById('fl-date').value : '';
        const filterSearch = document.getElementById('fl-search') ? document.getElementById('fl-search').value.toLowerCase().trim() : '';

        if (filterPos === '__other__') {
            filterPos = document.getElementById('fl-pos-other') ? document.getElementById('fl-pos-other').value.trim() : '';
        }

        if (filterArea) {
            visitsQuery = visitsQuery.eq('area', filterArea);
            countQuery = countQuery.eq('area', filterArea);
        }
        if (filterPos) {
            visitsQuery = visitsQuery.ilike('position', `%${filterPos}%`);
            countQuery = countQuery.ilike('position', `%${filterPos}%`);
        }
        if (filterDate) {
            visitsQuery = visitsQuery.eq('date', filterDate);
            countQuery = countQuery.eq('date', filterDate);
        }
        if (filterSearch) {
            const searchQ = `outlet.ilike.%${filterSearch}%,person.ilike.%${filterSearch}%`;
            visitsQuery = visitsQuery.or(searchQ);
            countQuery = countQuery.or(searchQ);
        }

        visitsQuery = visitsQuery.order('created_at', { ascending: false }).range(rangeStart, rangeEnd);

        const [visitsRes, countRes, reqsRes] = await Promise.all([
            visitsQuery,
            countQuery,
            AppState.supabaseClient.from('delete_requests').select('visit_id, status, created_at').order('created_at', { ascending: true })
        ]);

        if (visitsRes.error) throw visitsRes.error;

        const totalCount = countRes.count || 0;
        AppState.totalCount = totalCount;
        AppState.totalPages = Math.max(1, Math.ceil(totalCount / CONFIG.PAGE_SIZE));

        const reqMap = {};
        (reqsRes.data || []).forEach(r => { reqMap[r.visit_id] = r.status; });

        const formatted = (visitsRes.data || []).map(v => ({
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
            req_status: reqMap[v.id] || null
        }));

        AppState.visits = formatted;
        updateCount();
    } catch (e) {
        toast('Failed to load visits.', false);
    }
}

window.goToPage = function(page) {
    if (page < 0 || page >= AppState.totalPages) return;
    AppState.currentPage = page;
    fetchVisitsWithSkeleton();
    document.getElementById('visit-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPagination() {
    const container = document.getElementById('pagination-container');
    if (!container) return;

    const total = AppState.totalPages;
    const current = AppState.currentPage;

    if (total <= 1) {
        container.innerHTML = '';
        return;
    }

    let pages = [];

    if (total <= 7) {
        for (let i = 0; i < total; i++) pages.push(i);
    } else {
        pages.push(0);
        if (current > 3) pages.push('...');
        for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) {
            pages.push(i);
        }
        if (current < total - 4) pages.push('...');
        pages.push(total - 1);
    }

    const btnClass = (p) => p === current
        ? 'pagination-btn pagination-btn-active'
        : 'pagination-btn';

    const pageButtons = pages.map(p =>
        p === '...'
            ? `<span class="pagination-ellipsis">…</span>`
            : `<button class="${btnClass(p)}" onclick="goToPage(${p})">${p + 1}</button>`
    ).join('');

    container.innerHTML = `
        <div class="pagination-wrap">
            <button class="pagination-btn pagination-btn-nav" onclick="goToPage(${current - 1})" ${current === 0 ? 'disabled' : ''}>‹</button>
            ${pageButtons}
            <button class="pagination-btn pagination-btn-nav" onclick="goToPage(${current + 1})" ${current === total - 1 ? 'disabled' : ''}>›</button>
        </div>
        <div class="pagination-info">Page ${current + 1} of ${total}</div>
    `;
}

function setupRealtime() {
    if (!AppState.supabaseClient || AppState.realtimeChannel) return;

    AppState.realtimeChannel = AppState.supabaseClient
        .channel('app-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => loadVisitsFromDB())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'delete_requests' }, () => loadVisitsFromDB())
        .subscribe();
}

async function uploadPhotosToStorage(recordId) {
    let uploadedUrls = [];
    if (!AppState.supabaseClient) return uploadedUrls;
    
    const newPhotos = AppState.photos.filter(p => p.startsWith('data:image'));
    for (let i = 0; i < newPhotos.length; i++) {
        try {
            const res = await fetch(newPhotos[i]);
            const blob = await res.blob();
            const fileName = `${recordId}/photo_${Date.now()}_${i}.jpg`;
            const { error } = await AppState.supabaseClient.storage.from('visit_photos').upload(fileName, blob, { 
                contentType: 'image/jpeg', 
                upsert: false 
            });
            
            if (!error) {
                const { data: urlData } = AppState.supabaseClient.storage.from('visit_photos').getPublicUrl(fileName);
                uploadedUrls.push(urlData.publicUrl);
            }
        } catch (e) {
            console.error("Upload error:", e);
        }
    }
    return uploadedUrls;
}

// ============================================================
// CAMERA & MEDIA MODULE
// ============================================================
window.toggleCamera = async function() {
    AppState.currentFacingMode = AppState.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (AppState.cameraStream) {
        AppState.cameraStream.getTracks().forEach(t => t.stop());
        AppState.cameraStream = null;
    }
    await window.startCamera();
}

window.startCamera = async function() {
    if (!isProfileComplete()) return;
    const video = document.getElementById('camera-view');
    const modal = document.getElementById('camera-modal');

    updateMiniGalleryThumb();

    try {
        if (AppState.cameraStream) {
            AppState.cameraStream.getTracks().forEach(t => t.stop());
        }
        AppState.cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: AppState.currentFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: false 
        });
        
        video.srcObject = AppState.cameraStream;
        video.style.transform = AppState.currentFacingMode === 'user' ? 'scaleX(-1)' : 'none';
        modal.classList.add('open');
        updateModalCounter();
    } catch (err1) {
        try {
            AppState.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = AppState.cameraStream;
            video.style.transform = 'none';
            modal.classList.add('open');
            updateModalCounter();
        } catch (err2) {
            toast('Cannot access camera.', false);
        }
    }
}

window.stopCamera = function() {
    if (AppState.cameraStream) {
        AppState.cameraStream.getTracks().forEach(t => t.stop());
        AppState.cameraStream = null;
    }
    document.getElementById('camera-modal').classList.remove('open');
    closeCameraGallery(); 
}

window.capturePhoto = function() {
    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) {
        toast(`Max ${CONFIG.MAX_PHOTOS} photos allowed.`, false);
        return;
    }
    
    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    if (AppState.currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    if (AppState.currentFacingMode === 'user') {
        ctx.setTransform(1, 0, 0, 1, 0, 0); 
    }

    const newPhotoUrl = canvas.toDataURL('image/jpeg', 0.7);
    AppState.photos.push(newPhotoUrl);

    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);

    updateModalCounter();
    renderPreviews(); 
    updateMiniGalleryThumb(); 
    saveAutoSaveData(); 

    if (document.getElementById('m-photo-grid')) {
        renderModalPhotos();
    }

    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) {
        toast(`Reached ${CONFIG.MAX_PHOTOS} photos maximum.`);
        setTimeout(window.stopCamera, 500);
    }
}

window.selectFromLibrary = function() {
    if (!CONFIG.ALLOW_LIBRARY_UPLOAD) {
        toast('Policy: Photo capture only. Library upload disabled.', false);
        return;
    }
    if (!isProfileComplete()) {
        toast('Please complete your profile first.', false);
        return;
    }
    document.getElementById('library-input').click(); 
}

function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height *= maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width *= maxHeight / height));
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

window.handleLibrarySelection = async function(input) {
    if (!input.files || !input.files.length) return;
    
    const availableSlots = CONFIG.MAX_PHOTOS - AppState.photos.length;
    if (availableSlots <= 0) {
        toast(`Photo limit (${CONFIG.MAX_PHOTOS}) reached.`, false);
        input.value = '';
        return;
    }

    const filesToUpload = Array.from(input.files).slice(0, availableSlots);
    toast('Processing and compressing images...', true);
    
    for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) continue;
        try {
            const dataUrl = await compressImage(file, 1280, 1280, 0.7);
            AppState.photos.push(dataUrl);
        } catch (e) {
            console.error("image processing failed:", e);
        }
    }
    
    input.value = '';
    renderPreviews(); 
    updateModalCounter();
    saveAutoSaveData(); 
    if (document.getElementById('m-photo-grid')) renderModalPhotos();
}

// ============================================================
// FORM & AUTOSAVE MODULE
// ============================================================
function bindAutoSave() {
    const inputs = ['f-outlet', 'f-area', 'f-person', 'f-position', 'f-pos-other', 'f-date', 'f-reason', 'f-result', 'f-next-date'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveAutoSaveData);
            el.addEventListener('change', saveAutoSaveData);
        }
    });
    document.querySelectorAll('.f-followup').forEach(cb => {
        cb.addEventListener('change', saveAutoSaveData);
    });
}

function saveAutoSaveData() {
    if (document.getElementById('tab-new').style.display === 'none') return;

    const data = {
        outlet: document.getElementById('f-outlet').value,
        area: document.getElementById('f-area').value,
        person: document.getElementById('f-person').value,
        position: document.getElementById('f-position').value,
        posOther: document.getElementById('f-pos-other').value,
        date: document.getElementById('f-date').value,
        reason: document.getElementById('f-reason').value,
        result: document.getElementById('f-result').value,
        followups: Array.from(document.querySelectorAll('.f-followup')).map(cb => cb.checked),
        nextDate: document.getElementById('f-next-date').value,
        photos: AppState.photos
    };

    try {
        localStorage.setItem(CONFIG.KEYS.AUTOSAVE, JSON.stringify(data));
    } catch (e) {
        console.warn("Autosave storage full, saving text without photos.");
        data.photos = [];
        localStorage.setItem(CONFIG.KEYS.AUTOSAVE, JSON.stringify(data));
    }
}

function loadAutoSaveData() {
    const raw = localStorage.getItem(CONFIG.KEYS.AUTOSAVE);
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        let hasData = false;

        const populateField = (id, val) => {
            if (val) { document.getElementById(id).value = val; hasData = true; }
        };

        populateField('f-outlet', data.outlet);
        populateField('f-area', data.area);
        populateField('f-person', data.person);
        populateField('f-pos-other', data.posOther);
        populateField('f-reason', data.reason);
        populateField('f-result', data.result);
        
        if (data.date && AppState.fpDate) {
            AppState.fpDate.setDate(data.date);
            hasData = true;
        }
        if (data.nextDate && AppState.fpNextDate) {
            AppState.fpNextDate.setDate(data.nextDate);
        }

        if (data.position) {
            document.getElementById('f-position').value = data.position;
            document.getElementById('pos-other-wrap').style.display = data.position === '__other__' ? 'block' : 'none';
            hasData = true;
        }

        if (data.followups && data.followups.length > 0) {
            document.querySelectorAll('.f-followup').forEach((cb, i) => {
                cb.checked = data.followups[i];
                if (cb.checked) hasData = true;
                if (cb.id === 'cb-next-visit') {
                    document.getElementById('next-visit-wrap').style.display = cb.checked ? 'block' : 'none';
                }
            });
        }

        if (data.photos && data.photos.length > 0) {
            AppState.photos = data.photos;
            renderPreviews();
            updateModalCounter();
            updateMiniGalleryThumb();
            hasData = true;
        }
        
        if (hasData) {
            toast('Draft restored automatically.', true); 
        }
    } catch (e) {
        console.error("Failed to load autosave", e);
    }
}

window.clearForm = function() {
    ['f-outlet', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    document.getElementById('f-area').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('pos-other-wrap').style.display = 'none';
    
    if (AppState.fpDate) AppState.fpDate.setDate(today());
    if (AppState.fpNextDate) AppState.fpNextDate.clear();
    
    document.querySelectorAll('.f-followup').forEach(cb => cb.checked = false);
    document.getElementById('next-visit-wrap').style.display = 'none';
    
    AppState.photos = [];
    renderPreviews();
    window.stopCamera();
    
    localStorage.removeItem(CONFIG.KEYS.AUTOSAVE);
}

// ============================================================
// SAVE & VALIDATION MODULE
// ============================================================
window.triggerSaveConfirm = function() {
    if (!isProfileComplete()) {
        toast('Please complete profile first.', false);
        return;
    }

    const requiredFields = [
        { id: 'f-outlet', name: 'Outlet Name' },
        { id: 'f-area', name: 'Area' },
        { id: 'f-person', name: 'Person You Met' },
        { id: 'f-position', name: 'Their Position' },
        { id: 'f-date', name: 'Visit Date' },
        { id: 'f-reason', name: 'Reason for Visit' }
    ];

    const posEl = document.getElementById('f-position');
    if (posEl && posEl.value === '__other__') {
        requiredFields.push({ id: 'f-pos-other', name: 'Specify Position' });
    }

    for (const field of requiredFields) {
        const el = document.getElementById(field.id);
        if (!el || !el.value.trim()) {
            toast(`Please fill in: ${field.name}`, false);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
            el.focus(); 
            el.classList.add('error-highlight'); 
            setTimeout(() => el.classList.remove('error-highlight'), 2500);
            return;
        }
    }

    let followUps = [];
    let fQuotation = false, fCall = false;
    
    document.querySelectorAll('.f-followup').forEach(cb => {
        if (cb.value === 'Send Quotation / Documents') fQuotation = cb.checked;
        if (cb.value === 'Call Back Later') fCall = cb.checked;
        
        if (cb.id === 'cb-next-visit') {
            if (cb.checked) {
                const nd = document.getElementById('f-next-date').value;
                followUps.push(nd ? `Schedule Next Visit: ${fmtDate(nd)}` : 'Schedule Next Visit');
            }
        } else if (cb.checked) {
            followUps.push(cb.value);
        }
    });
    
    const fNext = document.getElementById('cb-next-visit').checked;
    const fNextDate = document.getElementById('f-next-date').value;
    const resultEl = document.getElementById('f-result');
    const result = resultEl.value.trim();

    if (!result && followUps.length === 0) {
        toast('Please provide a Result or select a Follow-up.', false);
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        resultEl.focus();
        resultEl.classList.add('error-highlight');
        setTimeout(() => resultEl.classList.remove('error-highlight'), 2500);
        return;
    }

    if (AppState.photos.length === 0) {
        toast('Please capture at least 1 photo.', false);
        const camSection = document.querySelector('.easy-camera-container');
        if (camSection) {
            camSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            camSection.classList.add('error-highlight');
            setTimeout(() => camSection.classList.remove('error-highlight'), 2500);
        }
        return;
    }

    const finalResultText = result + (followUps.length > 0 && result ? '\n\n' : '') + 
                           (followUps.length > 0 ? '[ Follow-up Actions ]\n- ' + followUps.join('\n- ') : '');

    AppState.pendingSaveData = { 
        outlet: document.getElementById('f-outlet').value.trim(), 
        area: document.getElementById('f-area').value, 
        person: document.getElementById('f-person').value.trim(), 
        position: getPosition(), 
        date: document.getElementById('f-date').value, 
        reason: document.getElementById('f-reason').value.trim(), 
        result: finalResultText,
        rawResult: result,
        rawFollowUps: { fQuotation, fCall, fNext, fNextDate }
    };

    renderConfirmModal();
    document.getElementById('save-confirm-overlay').classList.add('open');
}

window.executeSave = async function() {
    if (!AppState.pendingSaveData) return;

    if (document.getElementById('save-confirm-overlay').getAttribute('data-mode') === 'edit') {
        const mResult = document.getElementById('m-result').value.trim();
        let mFollowUps = [];
        if (document.getElementById('m-cb-quotation').checked) mFollowUps.push('Send Quotation / Documents');
        if (document.getElementById('m-cb-call').checked) mFollowUps.push('Call Back Later');
        if (document.getElementById('m-cb-next').checked) {
            const nd = document.getElementById('m-next-date').value;
            mFollowUps.push(nd ? `Schedule Next Visit: ${fmtDate(nd)}` : 'Schedule Next Visit');
        }

        const mFinalResultText = mResult + (mFollowUps.length > 0 && mResult ? '\n\n' : '') + 
                                (mFollowUps.length > 0 ? '[ Follow-up Actions ]\n- ' + mFollowUps.join('\n- ') : '');
        
        const posSel = document.getElementById('m-position-sel').value;
        
        AppState.pendingSaveData.outlet = document.getElementById('m-outlet').value.trim();
        AppState.pendingSaveData.area = document.getElementById('m-area').value;
        AppState.pendingSaveData.date = document.getElementById('m-date').value;
        AppState.pendingSaveData.person = document.getElementById('m-person').value.trim();
        AppState.pendingSaveData.position = posSel === '__other__' ? document.getElementById('m-pos-other').value.trim() : posSel;
        AppState.pendingSaveData.reason = document.getElementById('m-reason').value.trim();
        AppState.pendingSaveData.result = mFinalResultText;

        if (!AppState.pendingSaveData.outlet || !AppState.pendingSaveData.reason || !AppState.pendingSaveData.person || !AppState.pendingSaveData.position) {
            toast('Please fill in required fields.', false);
            return;
        }
        if (!mResult && mFollowUps.length === 0) {
            toast('Please provide a Result or select a Follow-up.', false);
            return;
        }
        if (AppState.photos.length === 0) {
            toast('Please add at least 1 photo before saving.', false);
            return;
        }
    }

    document.getElementById('save-confirm-overlay').classList.remove('open');
    if (!AppState.supabaseClient) {
        alert('❌ ยังไม่ได้เชื่อมต่อฐานข้อมูล');
        return;
    }

    const saveBtn = document.getElementById('btn-save');
    saveBtn.disabled = true; 
    saveBtn.textContent = 'Saving...';
    toast('Uploading data...', true);

    try {
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString();
        const location = await getCurrentLocation();
        const newUploadedUrls = await uploadPhotosToStorage(id);

        const payload = {
            id, 
            outlet: AppState.pendingSaveData.outlet, 
            area: AppState.pendingSaveData.area, 
            person: AppState.pendingSaveData.person, 
            position: AppState.pendingSaveData.position, 
            date: AppState.pendingSaveData.date, 
            reason: AppState.pendingSaveData.reason, 
            result: AppState.pendingSaveData.result, 
            photos: newUploadedUrls, 
            creator_name: AppState.userProfile.name, 
            creator_email: AppState.userProfile.email, 
            creator_position: AppState.userProfile.position, 
            lat: location ? location.lat : null, 
            lng: location ? location.lng : null, 
            is_deleted: false, 
            delete_reason: null
        };

        const { error } = await AppState.supabaseClient.from('visits').insert([payload]);
        if (error) throw error;

        toast('✅ Visit saved successfully!');
        window.clearForm(); 
        await loadVisitsFromDB(); 
        window.switchTab('list');
    } catch (err) {
        toast('Failed to save: ' + err.message, false);
    } finally {
        saveBtn.disabled = false; 
        saveBtn.textContent = 'Save Visit'; 
        AppState.pendingSaveData = null;
    }
}

// ============================================================
// UI RENDERING MODULE
// ============================================================
function showMainApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    initApp();
}

window.switchTab = function(tab) {
    if (tab !== 'new') window.stopCamera();

    document.querySelectorAll('.tab').forEach((t, i) =>
        t.classList.toggle('active', (tab === 'new' && i === 0) || (tab === 'list' && i === 1))
    );
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';

    if (tab === 'list') {
        AppState.currentPage = 0;
        if (AppState.supabaseClient) {
            fetchVisitsWithSkeleton();
        } else {
            window.renderList();
        }
    }
}

async function fetchVisitsWithSkeleton() {
    document.getElementById('visit-list').innerHTML = ''; 
    document.getElementById('pagination-container').innerHTML = '';
    document.getElementById('visit-list-loading').style.display = 'block'; 
    
    await loadVisitsFromDB();
    
    document.getElementById('visit-list-loading').style.display = 'none';
    renderList();
    renderPagination();
}

window.renderList = function() {
    const area = document.getElementById('fl-area').value;
    let pos = document.getElementById('fl-pos').value;
    const q = document.getElementById('fl-search').value.toLowerCase();
    const filterDate = document.getElementById('fl-date') ? document.getElementById('fl-date').value : '';

    if (pos === '__other__') {
        pos = document.getElementById('fl-pos-other') ? document.getElementById('fl-pos-other').value.toLowerCase().trim() : '';
    } else {
        pos = pos.toLowerCase();
    }

    const filtered = AppState.visits.filter(v => {
        if (v.req_status === 'approved' || (v.is_deleted === true && v.req_status !== 'pending')) return false;
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos)) return false;
        if (filterDate && v.date !== filterDate) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');
    if (!filtered.length) {
        el.innerHTML = `<div class="empty-state"><p>No visits found.</p></div>`;
        return;
    }

    el.innerHTML = filtered.map(v => {
        const isPending = v.req_status === 'pending';
        const statusBadge = isPending ? `<span class="badge badge-pending">Pending Delete</span>` : '';
        const cardClass = isPending ? 'visit-card-pending' : '';
        
        return `
        <div class="visit-card ${cardClass}" onclick="window.openDetail('${v.id}')">
          <div class="vc-header" style="margin-bottom: 8px; align-items: flex-start;">
             <span class="vc-name" style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
                 ${esc(v.outlet)}
                 <span class="badge badge-area" style="font-size: 10px; font-weight: normal;">${esc(v.area)}</span>
             </span>
             <div style="display: flex; align-items: center; gap: 10px;">
                 ${statusBadge}
                 <span class="vc-date" style="white-space: nowrap;">${fmtDate(v.date)}</span>
             </div>
          </div>
          <div class="vc-meta" style="margin-bottom: 10px;">
             <span class="vc-person" style="font-weight: 500; color: #555; display:flex; align-items:center; gap:6px;">${esc(v.person)} <span class="badge badge-pos">${esc(v.position)}</span></span>
          </div>
          <div class="vc-reason" style="${isPending ? 'text-decoration:line-through;' : ''}">${esc(v.reason).substring(0, 120)}${v.reason.length > 120 ? '...' : ''}</div>
          ${renderThumbStrip(v.photos)}
        </div>`;
    }).join('');
}

// ============================================================
// MODAL & UI HELPERS
// ============================================================
window.openDetail = function(id) {
    try {
        const v = AppState.visits.find(x => String(x.id) === String(id)); 
        if (!v) {
            alert("Error: Data not found. Please refresh.");
            return;
        }
        
        const isPending = v.req_status === 'pending';
        const visitInfo = [
            ['Met With', `${v.person} (${v.position})`], 
            ['Reason for Visit', v.reason], 
            ['Result & Actions', v.result]
        ];

        const renderFields = rows => rows.map(([l, val]) => `
            <div class="detail-field" style="margin-bottom: 20px;">
                <span class="detail-label">${l}</span>
                <span class="detail-value" style="background: var(--card-bg); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 6px; display: block; color: var(--text-main);">${esc(val).replace(/\n/g, '<br>')}</span>
            </div>
        `).join('');

        const photosHtml = v.photos && v.photos.length ? `
            <div style="border-top:1px dashed var(--border-light); margin:24px 0 16px 0;"></div>
            <div class="detail-label" style="margin-bottom:12px;">ATTACHED PHOTOS (${v.photos.length})</div>
            <div class="detail-photos">
                ${v.photos.map(p => `<div class="detail-photo" onclick="window.openLightbox('${p}')"><img src="${p}" style="cursor:zoom-in;"></div>`).join('')}
            </div>` : '';
        
        const creatorHtml = `
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed var(--border-light);">
                <div class="detail-label" style="margin-bottom:12px;">RECORDED BY</div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; box-shadow: var(--shadow-sm);">
                        ${(v.creatorName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            ${esc(v.creatorName || 'Unknown')}
                            <span class="badge badge-pos" style="font-size: 10px;">${esc(v.creatorPosition || '-')}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${esc(v.creatorEmail || '-')}</div>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('detail-content').innerHTML = `
            ${isPending ? `<div class="pending-warning"><strong>⚠️ Pending deletion review.</strong><div>Reason: ${esc(v.delete_reason)}</div></div>` : ''}
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light);">
                <div>
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Outlet & Location</div>
                    <h2 style="font-size: 18px; font-weight: 600; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        ${esc(v.outlet)}
                        <span class="badge badge-area" style="font-size: 11px;">${esc(v.area)}</span>
                    </h2>
                </div>
                <div style="text-align: right; padding-right: 36px;"> 
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Date</div>
                    <div style="font-size: 14px; font-weight: 500; color: var(--primary);">${fmtDate(v.date)}</div>
                </div>
            </div>

            <div style="${isPending ? 'opacity:0.6;' : ''}">
              ${renderFields(visitInfo)}
            </div>
            
            ${photosHtml}
            ${creatorHtml}
            
            ${!isPending ? `
            <div class="detail-actions" style="margin-top:2rem; border-top:1px solid var(--border-light); padding-top:1.5rem; display:flex;">
                <button class="btn-secondary btn-danger" onclick="window.openDeleteRequest('${v.id}')" style="margin-left:auto;">Request Deletion</button>
            </div>` : ''}`;
            
        document.getElementById('detail-overlay').classList.add('open');
    } catch (e) {
        console.error(e);
    }
}

window.renderConfirmModal = function() {
    const photosHtml = `<div class="confirm-photo-grid">${AppState.photos.map(p => `<img src="${p}" onclick="window.openLightbox('${p}')" style="cursor:zoom-in;">`).join('')}</div>`;

    document.getElementById('save-confirm-text').innerHTML = `
        <div style="background: var(--bg-color); border: 1px solid var(--border-light); border-radius: 12px; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-light);">
                <div>
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Outlet & Location</div>
                    <div style="font-size: 16px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        ${esc(AppState.pendingSaveData.outlet)}
                        <span class="badge badge-area" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${AppState.pendingSaveData.area}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Date</div>
                    <div style="font-size: 13px; font-weight: 500; color: var(--primary);">${fmtDate(AppState.pendingSaveData.date)}</div>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Met With</div>
                <div style="font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--text-muted);">${esc(AppState.pendingSaveData.person)}</span> <span class="badge badge-pos">${esc(AppState.pendingSaveData.position)}</span>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Reason for Visit</div>
                <div style="font-size: 14px; color: var(--text-main); line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.reason).replace(/\n/g,'<br>')}</div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Result & Actions</div>
                <div style="font-size: 14px; color: var(--text-main); line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.result).replace(/\n/g,'<br>')}</div>
            </div>

            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <div style="font-size: 12px; font-weight: 500; color: var(--text-main);">Attached Photos: <span style="color: var(--primary); font-weight: 600;">${AppState.photos.length}</span></div>
                ${photosHtml}
            </div>
        </div>`;

    document.getElementById('save-confirm-actions').innerHTML = `
        <button class="btn-secondary" onclick="window.enableModalEdit()">Edit</button>
        <button class="btn-primary" onclick="window.executeSave()">Confirm & Save</button>
    `;
    document.getElementById('save-confirm-overlay').setAttribute('data-mode', 'static');
}

window.enableModalEdit = function() {
    const areas = ['BKK','NORTH','NORTHEAST','WEST','EAST','SOUTH'];
    const areaOptions = areas.map(a => `<option value="${a}" ${a===AppState.pendingSaveData.area?'selected':''}>${a}</option>`).join('');

    const positions = ['CEO', 'CFO', 'OWNER', 'BARTENDER', 'F&B MANAGER', 'MANAGER'];
    const isOtherPos = AppState.pendingSaveData.position && !positions.includes(AppState.pendingSaveData.position);
    const posOptions = positions.map(p => `<option value="${p}" ${p === AppState.pendingSaveData.position ? 'selected' : ''}>${p}</option>`).join('');
    
    const f = AppState.pendingSaveData.rawFollowUps || {};

    document.getElementById('save-confirm-text').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 65vh; overflow-y: auto; padding-right: 5px; text-align: left;">
            <div style="background: rgba(124, 144, 130, 0.1); color: var(--primary); padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-bottom: 4px; border: 1px solid var(--primary); display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit mode active
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Outlet Name</label>
                <input type="text" id="m-outlet" value="${esc(AppState.pendingSaveData.outlet)}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
            </div>
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Area</label>
                    <select id="m-area" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                        ${areaOptions}
                    </select>
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Date</label>
                    <input type="text" id="m-date" value="${AppState.pendingSaveData.date}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Met With</label>
                    <input type="text" id="m-person" value="${esc(AppState.pendingSaveData.person)}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Position</label>
                    <select id="m-position-sel" onchange="document.getElementById('m-pos-other-wrap').style.display = this.value === '__other__' ? 'block' : 'none'" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                        <option value="">Select position</option>
                        ${posOptions}
                        <option value="__other__" ${isOtherPos ? 'selected' : ''}>ETC — Please Type</option>
                    </select>
                </div>
            </div>
            <div id="m-pos-other-wrap" style="display: ${isOtherPos ? 'block' : 'none'};">
                <input type="text" id="m-pos-other" value="${isOtherPos ? esc(AppState.pendingSaveData.position) : ''}" placeholder="Specify Position" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Reason for Visit</label>
                <textarea id="m-reason" rows="2" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; resize: vertical; background: transparent; color: var(--text-main);">${esc(AppState.pendingSaveData.reason)}</textarea>
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Result of Visit</label>
                <textarea id="m-result" rows="2" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; resize: vertical; background: transparent; color: var(--text-main);">${esc(AppState.pendingSaveData.rawResult || '')}</textarea>
            </div>
            <div style="margin-top: 4px; padding-bottom: 10px;">
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 8px; display: block;">Follow-up Actions</label>
                <div style="display: flex; flex-direction: column; gap: 10px; background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light);">
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-quotation" ${f.fQuotation ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);"> Send Quotation/Docs
                    </label>
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-call" ${f.fCall ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);"> Call Back Later
                    </label>
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-next" ${f.fNext ? 'checked' : ''} onchange="document.getElementById('m-next-date-wrap').style.display = this.checked ? 'block' : 'none'" style="width: 18px; height: 18px; accent-color: var(--primary);"> Schedule Next Visit
                    </label>
                </div>
                <div id="m-next-date-wrap" style="display: ${f.fNext ? 'block' : 'none'}; margin-top: 10px; background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--primary);">
                    <label style="font-size: 11px; color: var(--primary); display: block; margin-bottom: 6px;">Select Date for Next Visit:</label>
                    <input type="text" id="m-next-date" value="${f.fNextDate || today()}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 6px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                </div>
            </div>
            
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Attached Photos (<span id="m-photo-count">${AppState.photos.length}</span>/${CONFIG.MAX_PHOTOS})</label>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-secondary" onclick="window.startCamera()" style="padding: 4px 12px; font-size: 11px; border-radius: 6px; border: 1px solid var(--primary); color: var(--primary); display: flex; align-items: center; gap: 4px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                            Camera
                        </button>
                        <button type="button" class="btn-secondary" onclick="window.selectFromLibrary()" style="padding: 4px 12px; font-size: 11px; border-radius: 6px; border: 1px solid var(--primary); color: var(--primary);">+ Library</button>
                    </div>
                </div>
                <div id="m-photo-grid" class="photo-previews"></div>
            </div>
        </div>
    `;

    document.getElementById('save-confirm-actions').innerHTML = `
        <button class="btn-secondary" onclick="window.renderConfirmModal()" style="color: var(--text-main);">Cancel Edit</button>
        <button class="btn-primary" onclick="window.executeSave()">Confirm & Save</button>
    `;
    document.getElementById('save-confirm-overlay').setAttribute('data-mode', 'edit');
    renderModalPhotos();

    // เริ่มต้นการใช้งาน Flatpickr สำหรับโหมดแก้ไข
    flatpickr("#m-date", {
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        minDate: "today",
        maxDate: "today"
    });

    flatpickr("#m-next-date", {
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        minDate: "today"
    });
}

function renderModalPhotos() {
    const grid = document.getElementById('m-photo-grid');
    const countEl = document.getElementById('m-photo-count');
    if (!grid) return;
    
    if (countEl) countEl.textContent = AppState.photos.length;
    
    if (AppState.photos.length > 0) {
        grid.innerHTML = AppState.photos.map((p, i) => `
            <div class="photo-thumb">
                <img src="${p}" onclick="window.openLightbox('${p}')">
                <button type="button" onclick="window.removeModalPhoto(${i})">✕</button>
            </div>`).join('');
    } else {
        grid.innerHTML = `<div style="font-size: 12px; color: var(--danger); padding: 8px 0;">⚠️ No photos attached. Please add at least 1 photo.</div>`;
    }
}

window.removeModalPhoto = function(i) {
    AppState.photos.splice(i, 1);
    renderModalPhotos();
    renderPreviews(); 
    updateModalCounter();
    updateMiniGalleryThumb();
    saveAutoSaveData(); 
}

// ============================================================
// UTILITIES & HELPERS
// ============================================================
window.openLightbox = function(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
window.closeLightbox = function() { document.getElementById('lightbox').classList.remove('open'); }
window.closeDetail = function() { document.getElementById('detail-overlay').classList.remove('open'); }
window.openDeleteRequest = function(id) { AppState.deleteTargetId = id; document.getElementById('delete-reason-input').value = ''; document.getElementById('delete-confirm-overlay').classList.add('open'); }
window.closeDeleteRequest = function() { AppState.deleteTargetId = null; document.getElementById('delete-confirm-overlay').classList.remove('open'); }
window.closeSaveConfirm = function() { document.getElementById('save-confirm-overlay').classList.remove('open'); AppState.pendingSaveData = null; }

function isProfileComplete() { return AppState.userProfile.name !== '' && AppState.userProfile.email !== '' && AppState.userProfile.position !== ''; }
function getPosition() { const s = document.getElementById('f-position').value; return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s; }
function bindPositionToggle() { document.getElementById('f-position').addEventListener('change', function() { document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none'; }); }

function esc(s) { 
    if (s == null) return ''; 
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); 
}

function today() { 
    return new Date().toISOString().split('T')[0]; 
}

function fmtDate(d) { 
    if (!d) return ''; 
    const dateObj = new Date(d);
    if (isNaN(dateObj)) {
        const parts = d.split(/[-/]/);
        if (parts.length === 3) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (parts[0].length === 4) { 
                return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
            } else { 
                return `${parseInt(parts[1])} ${months[parseInt(parts[0]) - 1]} ${parts[2]}`;
            }
        }
        return d; 
    }
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; 
    return `${dateObj.getDate()} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`; 
}

function updateCount() { 
    const el = document.getElementById('rec-count'); 
    if (!el) return; 
    
    const count = AppState.totalCount || AppState.visits.filter(v => {
        if (v.req_status === 'approved' || (v.is_deleted === true && v.req_status !== 'pending')) return false;
        return true;
    }).length;

    el.textContent = count + (count === 1 ? ' record' : ' records'); 
}

function toast(msg, ok = true) { 
    const t = document.getElementById('toast'); 
    if (!t) return; 
    t.textContent = msg; 
    t.style.background = ok ? 'var(--primary)' : 'var(--danger)'; 
    t.classList.add('show'); 
    setTimeout(() => t.classList.remove('show'), 3500); 
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

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

window.executeDeleteRequest = async function() {
    const reason = document.getElementById('delete-reason-input').value.trim();
    if (!reason) { toast('Please provide a reason.', false); return; }
    
    const targetId = AppState.deleteTargetId; 
    window.closeDeleteRequest(); 
    toast('Submitting delete request...', true);

    try {
        const { error: reqError } = await AppState.supabaseClient.from('delete_requests').insert([{ 
            visit_id: targetId, 
            requested_by_email: AppState.userProfile.email, 
            requested_by_name: AppState.userProfile.name, 
            reason, 
            status: 'pending' 
        }]);
        if (reqError) throw reqError;
        
        const { error: updateError } = await AppState.supabaseClient.from('visits').update({ 
            is_deleted: true, 
            delete_reason: reason 
        }).eq('id', targetId);
        
        if (updateError) throw updateError;
        
        const idx = AppState.visits.findIndex(v => String(v.id) === String(targetId));
        if (idx !== -1) { 
            AppState.visits[idx].is_deleted = true; 
            AppState.visits[idx].delete_reason = reason; 
            AppState.visits[idx].req_status = 'pending'; 
        }
        
        window.renderList(); 
        toast('Delete request submitted.'); 
        window.closeDetail();
    } catch (err) { 
        toast('Failed to submit request: ' + err.message, false); 
    }
}

// Profile UI Helpers
function loadAvatarUI() {
    const avatarData = AppState.userProfile.avatar;
    const imgLarge = document.getElementById('avatar-img');
    const textLarge = document.getElementById('avatar-text');
    const imgSmall = document.getElementById('avatar-small-img');
    const textSmall = document.getElementById('avatar-small-text');

    if (avatarData) {
        if (imgLarge) { imgLarge.src = avatarData; imgLarge.style.display = 'block'; }
        if (textLarge) { textLarge.style.display = 'none'; }
        if (imgSmall) { imgSmall.src = avatarData; imgSmall.style.display = 'block'; }
        if (textSmall) { textSmall.style.display = 'none'; }
    } else {
        if (imgLarge) { imgLarge.style.display = 'none'; }
        if (textLarge) { textLarge.style.display = 'block'; }
        if (imgSmall) { imgSmall.src = ''; imgSmall.style.display = 'none'; }
        if (textSmall) { textSmall.style.display = 'block'; }
    }
}

window.handleProfileUpload = async function(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    toast('Updating profile picture...', true);

    try {
        const dataUrl = await fileToDataUrl(file);
        AppState.userProfile.avatar = dataUrl;
        localStorage.setItem(CONFIG.KEYS.PROFILE, JSON.stringify(AppState.userProfile));

        loadAvatarUI();
        toast('Profile picture updated!');
    } catch (e) {
        console.error(e);
        toast('Failed to update picture.', false);
    }
    input.value = '';
}

function updateModalCounter() {
    const el = document.getElementById('modal-photo-counter');
    if (el) el.textContent = `${AppState.photos.length} / ${CONFIG.MAX_PHOTOS}`;
}

function updateMiniGalleryThumb() {
    const recentThumb = document.getElementById('camera-recent-thumb');
    if (!recentThumb) return;
    if (AppState.photos.length > 0) {
        recentThumb.style.backgroundImage = `url(${AppState.photos[AppState.photos.length - 1]})`;
        recentThumb.style.opacity = '1';
    } else {
        recentThumb.style.opacity = '0';
    }
}

window.openCameraGallery = function() {
    if (AppState.photos.length === 0) return;
    document.getElementById('camera-header').style.display = 'none';
    document.getElementById('camera-body').style.display = 'none';
    document.getElementById('camera-footer').style.display = 'none';

    const gallery = document.getElementById('camera-gallery');
    gallery.style.display = 'flex';
    renderCameraGallery();
}

window.closeCameraGallery = function() {
    document.getElementById('camera-header').style.display = 'flex';
    document.getElementById('camera-body').style.display = 'flex';
    document.getElementById('camera-footer').style.display = 'flex';
    document.getElementById('camera-gallery').style.display = 'none';
    updateMiniGalleryThumb();
}

function renderCameraGallery() {
    const grid = document.getElementById('cg-grid');
    grid.innerHTML = AppState.photos.map((p, i) => `
        <div class="cg-item">
            <img src="${p}" onclick="window.openLightbox('${p}')">
            <button class="cg-delete" onclick="window.removePhotoFromGallery(${i})">✕</button>
        </div>
    `).join('');
}

window.removePhotoFromGallery = function(i) {
    AppState.photos.splice(i, 1);
    renderPreviews(); 
    updateModalCounter();
    saveAutoSaveData(); 
    if (AppState.photos.length === 0) {
        window.closeCameraGallery(); 
    } else {
        renderCameraGallery();
    }
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${AppState.photos.length} / ${CONFIG.MAX_PHOTOS}`;
    const previewContainer = document.getElementById('previews');
    const capturedSection = document.getElementById('captured-section');
    if (AppState.photos.length > 0) {
        capturedSection.style.display = 'block';
        previewContainer.innerHTML = AppState.photos.map((p, i) => `
            <div class="photo-thumb">
                <img src="${p}" onclick="window.openLightbox('${p}')">
                <button type="button" onclick="window.removePhoto(${i})">✕</button>
            </div>`).join('');
    } else {
        capturedSection.style.display = 'none';
        previewContainer.innerHTML = '';
    }
}

window.removePhoto = function(i) {
    AppState.photos.splice(i, 1);
    renderPreviews();
    updateModalCounter();
    updateMiniGalleryThumb();
    saveAutoSaveData(); 
}

function renderThumbStrip(ph) {
    if (!ph || !ph.length) return '';
    return `<div class="vc-thumbs">${ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}"></div>`).join('')}${ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : ''}</div>`;
}

function updateFormState() {
    const isComplete = isProfileComplete();
    const btnCam = document.getElementById('btn-start-cam');
    if (btnCam) {
        btnCam.disabled = !isComplete;
        btnCam.style.opacity = isComplete ? '1' : '0.5';
    }
}

// Profile Menu Click handler
window.toggleProfileMenu = function() {
    document.getElementById('profile-dropdown').classList.toggle('show');
}

window.addEventListener('click', function(e) {
    const wrap = document.getElementById('profile-menu-wrap');
    const dropdown = document.getElementById('profile-dropdown');
    if (wrap && dropdown && !wrap.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// ============================================================
// UX/UI PREMIUM FEATURES
// ============================================================

function initDarkMode() {
    const savedTheme = localStorage.getItem('checklist_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-mode');
        document.querySelectorAll('.moon-icon').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.sun-icon').forEach(el => el.style.display = 'block');
    }
}

window.toggleDarkMode = function() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('checklist_theme', isDark ? 'dark' : 'light');
    
    document.querySelectorAll('.moon-icon').forEach(el => el.style.display = isDark ? 'none' : 'block');
    document.querySelectorAll('.sun-icon').forEach(el => el.style.display = isDark ? 'block' : 'none');
}
