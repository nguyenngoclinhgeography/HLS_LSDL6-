/* =========================================================
   HLS6 CORE v1.3.0-online
   Bộ não dùng chung cho Học liệu số Lịch sử & Địa lí 6
   - Hồ sơ người học
   - Tiến trình theo từng học sinh
   - Điểm quiz theo từng bài
   - Chuẩn hóa điểm về thang 10
   - Tự đồng bộ 50 bài cũ dùng localStorage v1
   - Tự nhận diện kết quả quiz trên các mẫu giao diện khác nhau
========================================================= */
(function (window) {
    'use strict';

    const PROFILE_KEY = 'hoclieu6_profile_v1';
    const LEGACY_PROGRESS_KEY = 'hoclieu6_progress_v1';
    const PROGRESS_KEY = 'hoclieu6_progress_v2';
    const SCORES_KEY = 'hoclieu6_scores_v1';
    const STUDENTS_KEY = 'hoclieu6_students_v1';
    const LEGACY_MIGRATED_KEY = 'hoclieu6_legacy_migrated_v1';
    const CORE_VERSION = '1.4.0-online-FIX10';
    const ONLINE_API_URL = 'https://script.google.com/macros/s/AKfycbxBrGoCGdnSBegBcF_8UK0fSPzfNXutFZ4MpHw4ErBZB_oq0KoGPAZuOaodOBUATS9dOw/exec';
    const ONLINE_TIMEOUT = 9000;
    let onlineBusy = false;
    const boundLessons = {};
    let internalLegacyWrite = false;

    function safeRead(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function safeWrite(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[HLS6] Không thể lưu dữ liệu:', e);
            return false;
        }
    }

    function makeId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'hs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }

    function normalize(v) {
        return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    // Mã học sinh ổn định theo Họ tên + Lớp để cùng một em có thể
    // đăng nhập trên nhiều thiết bị mà vẫn nhận đúng hồ sơ online.
    function stableStudentId(name, className) {
        const text = normalize(name) + '|' + normalize(className);
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return 'hs-' + (h >>> 0).toString(16).padStart(8, '0');
    }

    function migrateStudentLocalData(oldId, newId) {
        if (!oldId || !newId || oldId === newId) return;
        const progressAll = safeRead(PROGRESS_KEY, {});
        const scoresAll = safeRead(SCORES_KEY, {});
        const students = safeRead(STUDENTS_KEY, {});
        if (progressAll[oldId]) {
            progressAll[newId] = { ...(progressAll[oldId] || {}), ...(progressAll[newId] || {}) };
            delete progressAll[oldId];
            safeWrite(PROGRESS_KEY, progressAll);
        }
        if (scoresAll[oldId]) {
            scoresAll[newId] = { ...(scoresAll[oldId] || {}), ...(scoresAll[newId] || {}) };
            delete scoresAll[oldId];
            safeWrite(SCORES_KEY, scoresAll);
        }
        if (students[oldId]) {
            students[newId] = { ...(students[oldId] || {}), ...(students[newId] || {}), studentId: newId };
            delete students[oldId];
            safeWrite(STUDENTS_KEY, students);
        }
    }

    function jsonpGet(action, params) {
        return new Promise((resolve, reject) => {
            if (!ONLINE_API_URL) return reject(new Error('ONLINE_API_URL chưa được cấu hình'));
            const cb = '__hls6_jsonp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            const script = document.createElement('script');
            let timer = null;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                try { delete window[cb]; } catch (e) { window[cb] = undefined; }
                if (script.parentNode) script.parentNode.removeChild(script);
            };
            window[cb] = data => { cleanup(); resolve(data); };
            script.onerror = () => { cleanup(); reject(new Error('Không thể kết nối máy chủ online')); };
            const q = new URLSearchParams({ action: action || '', callback: cb, _: String(Date.now()) });
            Object.entries(params || {}).forEach(([k, v]) => { if (v != null) q.set(k, String(v)); });
            script.src = ONLINE_API_URL + '?' + q.toString();
            timer = setTimeout(() => { cleanup(); reject(new Error('Kết nối online quá thời gian chờ')); }, ONLINE_TIMEOUT);
            document.head.appendChild(script);
        });
    }

    async function onlinePost(action, data) {
        if (!ONLINE_API_URL || !window.fetch) return false;
        try {
            // text/plain là simple request, tránh preflight CORS.
            // API dùng upsert nên việc gửi lại khi mất mạng/refresh vẫn an toàn.
            await fetch(ONLINE_API_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action, ...(data || {}) }),
                keepalive: true
            });
            return true;
        } catch (e) {
            console.warn('[HLS6] Online write thất bại, tiếp tục offline:', e);
            return false;
        }
    }

    function mergeRemoteStudent(payload) {
        if (!payload || !payload.success || !payload.profile || !payload.profile.studentId) return false;
        const id = payload.profile.studentId;
        const progressAll = safeRead(PROGRESS_KEY, {});
        const scoresAll = safeRead(SCORES_KEY, {});
        const students = safeRead(STUDENTS_KEY, {});
        const localProgress = progressAll[id] || {};
        const localScores = scoresAll[id] || {};

        (payload.progress || []).forEach(row => {
            if (row && row.lessonId && (row.completed === true || String(row.completed).toLowerCase() === 'true')) localProgress[row.lessonId] = true;
        });
        (payload.scores || []).forEach(row => {
            if (!row || !row.lessonId) return;
            const old = localScores[row.lessonId];
            const remoteTime = String(row.updatedAt || '');
            const localTime = String(old && old.updatedAt || '');
            if (!old || remoteTime >= localTime) {
                localScores[row.lessonId] = {
                    score: Number(row.score) || 0,
                    total: Math.max(1, Number(row.total) || 1),
                    percent: Number(row.percent) || 0,
                    point10: Number(row.point10) || 0,
                    attempts: Number(row.attempts) || 1,
                    updatedAt: row.updatedAt || now(),
                    ...(row.subject ? { subject: row.subject } : {}),
                    ...(row.title ? { title: row.title } : {})
                };
            }
        });

        progressAll[id] = localProgress;
        scoresAll[id] = localScores;
        students[id] = { ...(students[id] || {}), ...(payload.profile || {}), studentId: id };
        safeWrite(PROGRESS_KEY, progressAll);
        safeWrite(SCORES_KEY, scoresAll);
        safeWrite(STUDENTS_KEY, students);

        const current = getProfileRaw();
        if (current && current.studentId === id) {
            safeWrite(PROFILE_KEY, { ...current, ...payload.profile, studentId: id });
        }
        return true;
    }

    async function syncStudentOnline(studentId) {
        if (!studentId) return false;
        if (onlineBusy) return false;
        onlineBusy = true;
        try {
            const profile = getProfileRaw();
            if (profile && profile.studentId === studentId) {
                await onlinePost('registerStudent', profile);
            }
            const data = await jsonpGet('getStudent', { studentId });
            const ok = mergeRemoteStudent(data);
            if (ok) emit('online-synced', { studentId });
            return ok;
        } catch (e) {
            console.warn('[HLS6] Không đồng bộ được hồ sơ online:', e);
            emit('online-error', { message: e.message || 'Không thể đồng bộ' });
            return false;
        } finally {
            onlineBusy = false;
        }
    }

    async function syncStudentsOnline(options) {
        const withDetails = !options || options.withDetails !== false;
        try {
            const data = await jsonpGet('getStudents', {});
            if (!data || !data.success || !Array.isArray(data.students)) return false;
            const all = safeRead(STUDENTS_KEY, {});
            data.students.forEach(p => { if (p && p.studentId) all[p.studentId] = { ...(all[p.studentId] || {}), ...p }; });
            safeWrite(STUDENTS_KEY, all);

            // FIX10: Góc giáo viên cần số liệu thật từ Google Sheets, không chỉ danh sách tên.
            // Lấy hồ sơ chi tiết từng học sinh rồi nhập vào bộ nhớ local để dashboard
            // có thể dùng chung toàn bộ logic thống kê/radar hiện có.
            if (withDetails && data.students.length) {
                const ids = data.students.map(s => s && s.studentId).filter(Boolean);
                const results = await Promise.all(ids.map(async id => {
                    try { return await jsonpGet('getStudent', { studentId: id }); }
                    catch (e) { return null; }
                }));
                results.forEach(payload => { if (payload && payload.success && payload.profile) mergeRemoteStudent(payload); });
            }

            emit('online-students-synced', { count: data.students.length, withDetails });
            return true;
        } catch (e) {
            console.warn('[HLS6] Không tải được danh sách học sinh online:', e);
            return false;
        }
    }

    function onlineStatus() {
        return { enabled: !!ONLINE_API_URL, apiUrl: ONLINE_API_URL, mode: 'offline-first' };
    }

    function now() {
        return new Date().toISOString();
    }

    function getProfile() {
        const profile = safeRead(PROFILE_KEY, null);
        if (!profile) return null;
        if (profile.studentId) return profile;

        const upgraded = {
            ...profile,
            studentId: makeId(),
            createdAt: profile.createdAt || now(),
            lastLoginAt: now()
        };
        setProfile(upgraded);
        const all = safeRead(PROGRESS_KEY, {});
        if (!all[upgraded.studentId]) {
            all[upgraded.studentId] = safeRead(LEGACY_PROGRESS_KEY, {});
            safeWrite(PROGRESS_KEY, all);
            try { localStorage.setItem(LEGACY_MIGRATED_KEY, '1'); } catch (e) {}
        }
        const scores = safeRead(SCORES_KEY, {});
        if (!scores[upgraded.studentId]) {
            scores[upgraded.studentId] = {};
            safeWrite(SCORES_KEY, scores);
        }
        return upgraded;
    }

    function setProfile(profile) {
        if (!profile || !profile.studentId) return null;
        safeWrite(PROFILE_KEY, profile);
        registerStudent(profile);
        return profile;
    }

    function registerStudent(profile) {
        if (!profile || !profile.studentId) return false;
        const all = safeRead(STUDENTS_KEY, {});
        const old = all[profile.studentId] || {};
        all[profile.studentId] = { ...old, ...profile, lastLoginAt: profile.lastLoginAt || now() };
        return safeWrite(STUDENTS_KEY, all);
    }

    function getStudents() {
        const all = safeRead(STUDENTS_KEY, {});
        const current = getProfileRaw();
        if (current && current.studentId && !all[current.studentId]) {
            all[current.studentId] = current;
            safeWrite(STUDENTS_KEY, all);
        }
        return Object.values(all).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
    }

    function getProfileRaw() {
        return safeRead(PROFILE_KEY, null);
    }

    function getStudentSnapshot(studentId) {
        if (!studentId) return null;
        const students = safeRead(STUDENTS_KEY, {});
        const progressAll = safeRead(PROGRESS_KEY, {});
        const scoresAll = safeRead(SCORES_KEY, {});
        const profile = students[studentId] || null;
        if (!profile) return null;
        const progress = progressAll[studentId] || {};
        const scores = scoresAll[studentId] || {};
        const scored = Object.values(scores);
        const avg = scored.length ? Math.round((scored.reduce((sum,r)=>sum+(Number(r.point10)||0),0)/scored.length)*10)/10 : null;
        return { profile, progress, scores, summary: { completedLessons:Object.values(progress).filter(Boolean).length, scoredLessons:Object.keys(scores).length, averageScore10:avg, progressPercent:Math.round(Object.values(progress).filter(Boolean).length/50*100) } };
    }

    function login(name, className) {
        name = String(name || '').trim();
        className = String(className || '').trim();
        if (!name || !className) return null;

        const old = getProfile();
        const existingLocal = getStudents().find(s => normalize(s.name) === normalize(name) && normalize(s.cl) === normalize(className));
        const stableId = stableStudentId(name, className);
        const samePerson = old && normalize(old.name) === normalize(name) && normalize(old.cl) === normalize(className);
        const previousId = samePerson ? old.studentId : (existingLocal ? existingLocal.studentId : null);
        if (previousId && previousId !== stableId) migrateStudentLocalData(previousId, stableId);

        const profile = {
            studentId: stableId,
            name,
            cl: className,
            createdAt: (samePerson && old.createdAt) || (existingLocal && existingLocal.createdAt) || now(),
            lastLoginAt: now()
        };

        setProfile(profile);
        registerStudent(profile);

        const progressAll = safeRead(PROGRESS_KEY, {});
        let legacyMigrated = false;
        try { legacyMigrated = localStorage.getItem(LEGACY_MIGRATED_KEY) === '1'; } catch (e) {}
        if (!progressAll[profile.studentId]) {
            progressAll[profile.studentId] = (!legacyMigrated) ? { ...safeRead(LEGACY_PROGRESS_KEY, {}) } : {};
            safeWrite(PROGRESS_KEY, progressAll);
            if (!legacyMigrated) {
                try { localStorage.setItem(LEGACY_MIGRATED_KEY, '1'); } catch (e) {}
            }
        }

        const scoresAll = safeRead(SCORES_KEY, {});
        if (!scoresAll[profile.studentId]) {
            scoresAll[profile.studentId] = {};
            safeWrite(SCORES_KEY, scoresAll);
        }

        // Ghi hồ sơ trước, sau đó kéo dữ liệu online về. Nếu mạng lỗi,
        // website vẫn dùng dữ liệu local như bình thường.
        onlinePost('registerStudent', profile).catch(() => {});
        syncStudentOnline(profile.studentId);

        emit('profile-updated');
        return profile;
    }

    function logout() {
        try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
        emit('profile-logged-out');
    }

    function getStudentId() {
        const p = getProfile();
        return p && p.studentId ? p.studentId : null;
    }

    function getProgress() {
        const studentId = getStudentId();
        if (!studentId) return {};
        const all = safeRead(PROGRESS_KEY, {});
        return all[studentId] || {};
    }

    function saveProgress(progress) {
        const studentId = getStudentId();
        if (!studentId) return false;
        const all = safeRead(PROGRESS_KEY, {});
        all[studentId] = progress || {};
        return safeWrite(PROGRESS_KEY, all);
    }

    function completeLesson(lessonId, meta) {
        if (!lessonId) return false;
        const progress = getProgress();
        progress[lessonId] = true;
        saveProgress(progress);

        // Giữ tương thích với các trang cũ trong giai đoạn chuyển đổi.
        try {
            const legacy = safeRead(LEGACY_PROGRESS_KEY, {});
            legacy[lessonId] = true;
            internalLegacyWrite = true;
            localStorage.setItem(LEGACY_PROGRESS_KEY, JSON.stringify(legacy));
        } catch (e) {} finally {
            internalLegacyWrite = false;
        }

        onlinePost('saveProgress', {
            studentId: getStudentId(),
            lessonId,
            completed: true,
            completedAt: now()
        }).catch(() => {});

        emit('progress-updated', { lessonId, meta: meta || null });
        return true;
    }

    function getScores() {
        const studentId = getStudentId();
        if (!studentId) return {};
        const all = safeRead(SCORES_KEY, {});
        return all[studentId] || {};
    }

    function saveQuizResult(lessonId, score, total, meta) {
        const studentId = getStudentId();
        if (!studentId || !lessonId) return null;

        score = Number(score) || 0;
        total = Math.max(1, Number(total) || 1);
        const percent = Math.round((score / total) * 100);
        const point10 = Math.round((score / total) * 100) / 10;

        const all = safeRead(SCORES_KEY, {});
        if (!all[studentId]) all[studentId] = {};

        const old = all[studentId][lessonId];
        const result = {
            score,
            total,
            percent,
            point10,
            updatedAt: now(),
            attempts: old && Number.isFinite(old.attempts) ? old.attempts + 1 : 1,
            ...((meta && typeof meta === 'object') ? meta : {})
        };

        all[studentId][lessonId] = result;
        safeWrite(SCORES_KEY, all);
        onlinePost('saveScore', {
            studentId,
            lessonId,
            score: result.score,
            total: result.total,
            percent: result.percent,
            point10: result.point10,
            attempts: result.attempts,
            updatedAt: result.updatedAt,
            subject: result.subject || '',
            title: result.title || ''
        }).catch(() => {});
        emit('score-updated', { lessonId, result });
        return result;
    }

    function getScore(lessonId) {
        return getScores()[lessonId] || null;
    }

    function countDone() {
        return Object.values(getProgress()).filter(Boolean).length;
    }

    // Luôn trả về điểm trung bình theo thang 10.
    function averageScore() {
        const scores = Object.values(getScores());
        if (!scores.length) return null;
        const sum = scores.reduce((acc, x) => acc + (Number(x.point10) || 0), 0);
        return Math.round((sum / scores.length) * 10) / 10;
    }

    function summary(totalLessons) {
        totalLessons = Number(totalLessons) || 50;
        const done = countDone();
        return {
            totalLessons,
            completedLessons: done,
            progressPercent: Math.round(done / totalLessons * 100),
            scoredLessons: Object.keys(getScores()).length,
            averageScore10: averageScore()
        };
    }

    function subjectSummary(prefix, total) {
        const progress = getProgress();
        const scores = getScores();
        const done = Object.keys(progress).filter(k => k.startsWith(prefix) && progress[k]).length;
        const scored = Object.entries(scores).filter(([id]) => id.startsWith(prefix));
        const avg = scored.length
            ? Math.round((scored.reduce((sum, [, r]) => sum + (Number(r.point10) || 0), 0) / scored.length) * 10) / 10
            : null;
        return {
            completedLessons: done,
            totalLessons: total,
            progressPercent: total ? Math.round(done / total * 100) : 0,
            scoredLessons: scored.length,
            averageScore10: avg
        };
    }

    function getRecentScores(limit) {
        limit = Number(limit) || 5;
        return Object.entries(getScores())
            .map(([lessonId, result]) => ({ lessonId, ...result }))
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .slice(0, limit);
    }

    /* ---------------------------------------------------------
       Hồ sơ năng lực học tập 1.0
       5 trục: Kiến thức, Bản đồ & không gian, Tư liệu & thời gian,
       Phân tích - giải thích, Vận dụng.
       Điểm mỗi trục = trung bình điểm /10 của các bài đã có điểm
       được gắn với trục đó. Trục chưa có minh chứng trả về null.
    --------------------------------------------------------- */
    const COMPETENCY_MAP = {
        knowledge: new Set([
            'h01','h04','h05','h06','h07','h08','h09','h10','h11','h12','h13','h14','h15','h16','h17','h18','h19','h20',
            'g01','g02','g03','g04','g06','g07','g08','g10','g11','g12','g13','g15','g16','g17','g19','g20','g21','g22','g23','g24','g25','g27','g28','g29'
        ]),
        map: new Set(['g01','g02','g03','g04','g05','g09','g14','g18','g26','g30','h07','h08','h09','h10','h11','h19','h20']),
        sources: new Set(['h02','h03','h07','h08','h09','h10','h11','h12','h13','h14','h15','h16','h17','h18','h19','h20','g05','g14','g18','g26','g30']),
        analysis: new Set(['h06','h07','h08','h09','h10','h12','h13','h15','h16','h17','h18','h19','h20','g10','g11','g12','g13','g15','g16','g17','g18','g19','g20','g21','g22','g23','g24','g25','g27','g28','g29','g30']),
        application: new Set(['h16','h17','h18','h19','h20','g05','g09','g14','g17','g18','g21','g26','g28','g29','g30'])
    };

    const COMPETENCY_LABELS = {
        knowledge: 'Kiến thức',
        map: 'Bản đồ & không gian',
        sources: 'Tư liệu & thời gian',
        analysis: 'Phân tích – giải thích',
        application: 'Vận dụng'
    };

    function competencyProfile() {
        const scores = getScores();
        const axes = Object.entries(COMPETENCY_MAP).map(([key, ids]) => {
            const evidence = [...ids].filter(id => scores[id]);
            if (!evidence.length) {
                return { key, label: COMPETENCY_LABELS[key], value: null, evidenceCount: 0, lessonIds: [] };
            }
            const avg = evidence.reduce((sum, id) => sum + (Number(scores[id].point10) || 0), 0) / evidence.length;
            return {
                key,
                label: COMPETENCY_LABELS[key],
                value: Math.round(avg * 10) / 10,
                evidenceCount: evidence.length,
                lessonIds: evidence
            };
        });
        return { axes, scoredLessons: Object.keys(scores).length };
    }

    /* ---------------------------------------------------------
       Đồng bộ progress v1 của 50 trang cũ -> progress v2.
    --------------------------------------------------------- */

    function getStudentAnalytics(studentId) {
        const snap = getStudentSnapshot(studentId);
        if (!snap) return null;
        const progress = snap.progress || {};
        const scores = snap.scores || {};
        const subject = (prefix, total) => {
            const done = Object.keys(progress).filter(k => k.startsWith(prefix) && progress[k]).length;
            const scored = Object.entries(scores).filter(([id]) => id.startsWith(prefix));
            const avg = scored.length ? Math.round((scored.reduce((sum, [, r]) => sum + (Number(r.point10) || 0), 0) / scored.length) * 10) / 10 : null;
            return { completedLessons: done, totalLessons: total, progressPercent: total ? Math.round(done / total * 100) : 0, scoredLessons: scored.length, averageScore10: avg };
        };
        const axes = Object.entries(COMPETENCY_MAP).map(([key, ids]) => {
            const evidence = [...ids].filter(id => scores[id]);
            if (!evidence.length) return { key, label: COMPETENCY_LABELS[key], value: null, evidenceCount: 0, lessonIds: [] };
            const avg = evidence.reduce((sum, id) => sum + (Number(scores[id].point10) || 0), 0) / evidence.length;
            return { key, label: COMPETENCY_LABELS[key], value: Math.round(avg * 10) / 10, evidenceCount: evidence.length, lessonIds: evidence };
        });
        return { history: subject('h', 20), geography: subject('g', 30), competency: { axes, scoredLessons: Object.keys(scores).length } };
    }

    function syncLegacyProgress() {
        const studentId = getStudentId();
        if (!studentId) return;
        const legacy = safeRead(LEGACY_PROGRESS_KEY, {});
        const all = safeRead(PROGRESS_KEY, {});
        const current = all[studentId] || {};
        let changed = false;

        Object.keys(legacy).forEach(key => {
            if (legacy[key] && !current[key]) {
                current[key] = true;
                changed = true;
            }
        });

        if (changed) {
            all[studentId] = current;
            safeWrite(PROGRESS_KEY, all);
            emit('progress-updated', { source: 'legacy-sync' });
        }
    }

    /* ---------------------------------------------------------
       Chuẩn hóa kết quả quiz của các mẫu HTML khác nhau.
       Ví dụ 6/8 -> 7.5/10; 8/10 -> 8/10; 7.5 -> 7.5/10.
    --------------------------------------------------------- */
    function visible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.closest('.hidden, [hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function parseScoreText(text) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        let m = s.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
        if (m) {
            const score = Number(m[1].replace(',', '.'));
            const total = Number(m[2].replace(',', '.'));
            if (Number.isFinite(score) && Number.isFinite(total) && total > 0) {
                return { score, total, point10: Math.round((score / total) * 100) / 10 };
            }
        }
        m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:điểm|\/10)\b/i);
        if (m) {
            const point10 = Number(m[1].replace(',', '.'));
            if (Number.isFinite(point10) && point10 >= 0 && point10 <= 10) {
                return { score: point10, total: 10, point10 };
            }
        }
        return null;
    }

    function findFinalScore(lessonId) {
        const selectors = [
            '#resultScore', '#finalScore', '#scoreNumber', '#scoreText', '#score',
            '.result-score', '.result .score', '.quizResult .score', '.quiz-result .score'
        ];
        const candidates = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => candidates.push(el));
        });

        const seen = new Set();
        for (const el of candidates) {
            if (seen.has(el) || !visible(el)) continue;
            seen.add(el);

            let target = el;
            let text = el.textContent || '';
            const parent = el.parentElement;

            // Trường hợp Bài 20: span #score chỉ chứa "7", còn /10 nằm ở cha.
            if (parent && /\/\s*10\b/.test(parent.textContent || '') && !/\//.test(text)) {
                target = parent;
                text = parent.textContent || '';
            }

            // Chỉ nhận score nằm trong vùng kết quả, tránh lấy điểm live giữa quiz.
            const resultAncestor = target.closest(
                '[id*="result" i], [class*="result" i], [id*="quizResult" i], [class*="quiz-result" i]'
            );
            if (!resultAncestor || !visible(resultAncestor)) continue;

            const parsed = parseScoreText(text);
            if (!parsed) continue;

            return { target, parsed };
        }
        return null;
    }

    function normalizeResultDisplay(target, point10) {
        if (!target || target.dataset.hls6Normalized === '1') return;
        const shown = Number(point10).toFixed(1).replace(/\.0$/, '');
        target.textContent = shown + '/10';
        target.dataset.hls6Normalized = '1';
    }

    function attachCompletionButtons(lessonId) {
        const buttons = Array.from(document.querySelectorAll('button, a'));
        buttons.forEach(btn => {
            if (btn.dataset.hls6Bound === '1') return;
            const text = normalize(btn.textContent);
            if (!/(hoàn thành|hoan thanh|hoàn tất|hoan tat)/.test(text)) return;
            btn.dataset.hls6Bound = '1';
            btn.addEventListener('click', () => {
                setTimeout(() => {
                    completeLesson(lessonId, { source: 'completion-button' });
                }, 0);
            });
        });
    }

    function bindLessonPage(lessonId) {
        if (!lessonId || boundLessons[lessonId]) return;
        boundLessons[lessonId] = true;

        syncLegacyProgress();
        attachCompletionButtons(lessonId);

        let lastSavedSignature = '';
        let lastScoreText = '';

        function check() {
            attachCompletionButtons(lessonId);
            const found = findFinalScore(lessonId);
            if (!found) {
                // Kết quả đang ẩn / người học đang làm lại -> cho phép lưu lần thử tiếp theo,
                // kể cả khi điểm mới trùng với lần trước.
                lastSavedSignature = '';
                return;
            }

            const { target, parsed } = found;
            const signature = `${parsed.score}/${parsed.total}/${parsed.point10}`;
            if (signature === lastSavedSignature) return;

            // Chuẩn hóa giao diện về thang 10.
            normalizeResultDisplay(target, parsed.point10);

            const result = saveQuizResult(lessonId, parsed.score, parsed.total, {
                source: 'HLS6 auto-sync',
                displayPoint10: parsed.point10
            });

            if (result) {
                lastSavedSignature = signature;
                lastScoreText = target.textContent;
                completeLesson(lessonId, { source: 'quiz-auto-complete' });
            }
        }

        // Cho các trang đã render sẵn.
        setTimeout(check, 80);
        setTimeout(check, 500);

        const observer = new MutationObserver(() => {
            check();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });

        // Khi người dùng làm lại quiz, cho phép lưu điểm mới khi kết quả thay đổi.
        window.addEventListener('hls6:score-updated', () => {});
        window.addEventListener('storage', e => {
            if (e.key === LEGACY_PROGRESS_KEY) syncLegacyProgress();
        });
    }

    /* ---------------------------------------------------------
       Hook localStorage.setItem để mọi trang cũ ghi progress v1
       đều được chuyển ngay sang hồ sơ v2.
    --------------------------------------------------------- */
    try {
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function (key, value) {
            const out = originalSetItem(key, value);
            if (key === LEGACY_PROGRESS_KEY && !internalLegacyWrite) {
                setTimeout(syncLegacyProgress, 0);
            }
            return out;
        };
    } catch (e) {
        console.warn('[HLS6] Không thể hook localStorage:', e);
    }

    function emit(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent('hls6:' + name, { detail: detail || {} }));
        } catch (e) {}
    }

    window.HLS6 = {
        version: CORE_VERSION,
        keys: {
            profile: PROFILE_KEY,
            legacyProgress: LEGACY_PROGRESS_KEY,
            progress: PROGRESS_KEY,
            scores: SCORES_KEY,
            students: STUDENTS_KEY
        },
        getProfile,
        setProfile,
        login,
        logout,
        getStudentId,
        getProgress,
        saveProgress,
        completeLesson,
        getScores,
        saveQuizResult,
        getScore,
        countDone,
        averageScore,
        summary,
        subjectSummary,
        getRecentScores,
        getStudents,
        getStudentSnapshot,
        getStudentAnalytics,
        competencyProfile,
        syncLegacyProgress,
        syncStudentOnline,
        syncStudentsOnline,
        onlineStatus,
        bindLessonPage
    };

})(window);
