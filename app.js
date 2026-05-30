'use strict';

// Goal color variants
const GOAL_COLORS = [
    'goal-blue',
    'goal-mint',
    'goal-purple'
];

// Category color palette
const CATEGORY_COLORS = [
    { hex: '#0ea5e9', name: 'Sky' },
    { hex: '#8b5cf6', name: 'Violet' },
    { hex: '#ec4899', name: 'Pink' },
    { hex: '#ef4444', name: 'Rose' },
    { hex: '#f97316', name: 'Orange' },
    { hex: '#eab308', name: 'Yellow' },
    { hex: '#10b981', name: 'Emerald' },
    { hex: '#06b6d4', name: 'Cyan' },
];

// ─── STATE ───────────────────────────────────────────────────────────────────
const STATE = {
    tasks:        [],
    categories:   [],
    goals:        [],
    schedule:     [],
    darkMode:     false,
    filter:       'all',
    search:       '',
    editingId:    null,
    sortables:    [],
    goalSortable: null,
    showAllCats:  false,
};

// ─── LOCAL STORAGE ───────────────────────────────────────────────
const LS_DARK_MODE_KEY = 'sa_darkMode';

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://nphgxoyzddnxkfwxnwmy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5waGd4b3l6ZGRueGtmd3hud215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NDQwMzQsImV4cCI6MjA5MTUyMDAzNH0.kZWiMt1oyq2DDjwr8J6agNme4WUifwmUCtCU-e-rlyo';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let USER_ID = null;

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showLoginScreen()  {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('openAddTaskModal').style.display = 'none';
}
function hideLoginScreen()  {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('openAddTaskModal').style.display = 'flex';
}

async function signInWithGoogle() {
    const { error } = await db.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) {
        console.error('[Auth] Google sign-in failed:', error.message);
        document.getElementById('loginError').classList.remove('hidden');
    }
}

async function signOut() {
    await db.auth.signOut();
    USER_ID = null;
    STATE.tasks = []; STATE.categories = []; STATE.goals = []; STATE.schedule = [];
    showLoginScreen();
}

// camelCase ↔ snake_case 변환
function toDbTask(task) {
    return {
        id:             task.id,
        user_id:        USER_ID,
        title:          task.title,
        description:    task.description || '',
        category_id:    task.categoryId || '',
        priority:       task.priority || 'medium',
        status:         task.status || 'todo',
        due_date:       task.dueDate || '',
        completed:      task.completed || false,
        completed_date: task.completedDate || '',
        sort_order:     task.order ?? 0,
        created_at:     task.createdAt || new Date().toISOString()
    };
}

function fromDbTask(row) {
    return {
        id:            row.id,
        title:         row.title,
        description:   row.description || '',

        categoryId:    row.category_id || '',
        priority:      row.priority || 'medium',
        status:        row.status || 'todo',
        dueDate:       row.due_date || '',
        completed:     row.completed || false,
        completedDate: row.completed_date || '',
        order:         row.sort_order ?? 0,
        createdAt:     row.created_at || ''
    };
}

// ─── DB SYNC FUNCTIONS (fire & forget) ───────────────────────────────────────
async function dbSyncTask(task) {
    const { error } = await db.from('tasks').upsert(toDbTask(task));
    if (error) console.error('[DB] task upsert failed:', error.message);
}

async function dbDeleteTask(id) {
    const { error } = await db.from('tasks').delete().eq('id', id).eq('user_id', USER_ID);
    if (error) console.error('[DB] task delete failed:', error.message);
}

async function dbSyncCategories() {
    if (STATE.categories.length === 0) return;
    const rows = STATE.categories.map(c => ({
        id:         c.id,
        name:       c.name,
        user_id:    USER_ID,
        sort_order: c.order ?? 0,
        is_visible: c.visible !== false,
        is_deleted: c.deleted === true,
        color:      c.color || '#0ea5e9'
    }));
    const { data, error } = await db.from('categories').upsert(rows, { onConflict: 'id' });
    if (error) {
        console.error('[DB] categories sync failed:', error.message, error);
    }
}

async function dbDeleteCategory(id) {
    // 실제 삭제 대신 soft delete
    const { error } = await db.from('categories').update({ is_deleted: true }).eq('id', id);
    if (error) console.error('[DB] category soft-delete failed:', error.message);
}

async function dbSyncGoals() {
    await db.from('goals').delete().eq('user_id', USER_ID);
    if (STATE.goals.length === 0) return;
    const { error } = await db.from('goals').insert(
        STATE.goals.map(g => ({ id: g.id, user_id: USER_ID, text: g.text, color: g.color, sort_order: g.order ?? 0 }))
    );
    if (error) console.error('[DB] goals sync failed:', error.message);
}

async function dbSyncSchedule() {
    await db.from('schedule').delete().eq('user_id', USER_ID);
    if (!STATE.schedule || STATE.schedule.length === 0) return;
    const { error } = await db.from('schedule').insert(
        STATE.schedule.map(s => ({
            id:         s.id,
            user_id:    USER_ID,
            name:       s.name,
            start_slot: s.startSlot,
            end_slot:   s.endSlot,
            color:      s.color
        }))
    );
    if (error) console.error('[DB] schedule sync failed:', error.message);
}

// ─── DB LOAD ─────────────────────────────────────────────────────────────────
async function dbLoad() {
    const [tasksRes, catsRes, goalsRes, schedRes] = await Promise.all([
        db.from('tasks').select('*').eq('user_id', USER_ID).order('sort_order'),
        db.from('categories').select('*').eq('user_id', USER_ID).order('sort_order'),
        db.from('goals').select('*').eq('user_id', USER_ID).order('sort_order'),
        db.from('schedule').select('*').eq('user_id', USER_ID)
    ]);

    if (tasksRes.error)  console.error('[DB] tasks error:',      tasksRes.error.message);
    if (catsRes.error)   console.error('[DB] categories error:', catsRes.error.message);
    if (goalsRes.error)  console.error('[DB] goals error:',      goalsRes.error.message);
    if (schedRes.error)  console.error('[DB] schedule error:',   schedRes.error.message);

    if (tasksRes.error) throw tasksRes.error;

    STATE.tasks      = tasksRes.data.map(fromDbTask);
    // is_deleted=true 포함 전체 로드 (task 표출 시 이름 조회용)
    STATE.categories = (catsRes.data || []).map(r => ({
        id:      r.id,
        name:    r.name,
        order:   r.sort_order ?? 0,
        visible: r.is_visible !== false,
        deleted: r.is_deleted === true,
        color:   r.color || '#0ea5e9'
    }));
    STATE.goals      = (goalsRes.data || []).map(r => ({ id: r.id, text: r.text, color: r.color, order: r.sort_order ?? 0 }));
    STATE.schedule   = (schedRes.data || []).map(r => ({
        id:        r.id,
        name:      r.name,
        startSlot: r.start_slot,
        endSlot:   r.end_slot,
        color:     r.color
    }));
}

function saveDarkMode() {
    localStorage.setItem(LS_DARK_MODE_KEY, String(STATE.darkMode));
}

// ─── TASK CRUD ────────────────────────────────────────────────────────────────
function createTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function taskCreate(data) {
    // Calculate order within the same status
    const tasksWithStatus = STATE.tasks.filter(t => t.status === (data.status || 'todo'));
    const order = tasksWithStatus.length;

    const task = {
        id:          createTaskId(),
        title:       data.title.trim(),
        description: (data.description || '').trim(),
        categoryId:  data.categoryId || '',
        priority:    data.priority  || 'medium',
        status:      data.status    || 'todo',
        dueDate:     data.dueDate   || '',
        completed:   false,
        completedDate: '',
        order:       order,
        createdAt:   new Date().toISOString()
    };
    STATE.tasks.push(task);
    dbSyncTask(task);
}

function taskUpdate(id, data) {
    const idx = STATE.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    Object.assign(STATE.tasks[idx], data);
    dbSyncTask(STATE.tasks[idx]);
}

function taskDelete(id) {
    const deletedTask = STATE.tasks.find(t => t.id === id);
    STATE.tasks = STATE.tasks.filter(t => t.id !== id);

    // Reorder remaining tasks in the same status
    if (deletedTask) {
        const reordered = STATE.tasks
            .filter(t => t.status === deletedTask.status)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        reordered.forEach((task, idx) => { task.order = idx; });
        reordered.forEach(t => dbSyncTask(t));
    }

    dbDeleteTask(id);
}

function taskToggleComplete(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = !task.completed;

    if (task.completed) {
        task.status = 'done';
        task.completedDate = new Date().toISOString().split('T')[0];
    } else {
        if (task.status === 'done') task.status = 'inprogress';
        task.completedDate = '';
    }
    dbSyncTask(task);
}

function taskSetCompleted(id, completed) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = completed;
    dbSyncTask(task);
}

// ─── GOAL CRUD ────────────────────────────────────────────────────────────────
function createGoalId() {
    return 'goal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function getRandomColor() {
    return GOAL_COLORS[Math.floor(Math.random() * GOAL_COLORS.length)];
}

function getRandomColorExcluding(excludeColors) {
    const available = GOAL_COLORS.filter(c => !excludeColors.includes(c));
    if (available.length === 0) return getRandomColor();
    return available[Math.floor(Math.random() * available.length)];
}

function goalCreate(text) {
    const usedColors = STATE.goals.map(g => g.color);
    const goal = {
        id: createGoalId(),
        text: text.trim(),
        order: STATE.goals.length,
        color: getRandomColorExcluding(usedColors)
    };
    STATE.goals.push(goal);
    dbSyncGoals();
}

function goalDelete(id) {
    STATE.goals = STATE.goals.filter(g => g.id !== id);
    STATE.goals.forEach((g, idx) => { g.order = idx; });
    dbSyncGoals();
}

function goalsReorder(newOrder) {
    const goalMap = {};
    STATE.goals.forEach(g => { goalMap[g.id] = g; });
    STATE.goals = newOrder.map((id, idx) => {
        const goal = goalMap[id];
        if (goal) goal.order = idx;
        return goal;
    }).filter(Boolean);
    dbSyncGoals();
}

// ─── CATEGORY CRUD ────────────────────────────────────────────────────
function createCategoryId() {
    return 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function categoryCreate(name, color = '#0ea5e9') {
    const trimmed = name.trim();
    if (!trimmed || STATE.categories.some(c => c.name === trimmed && !c.deleted)) return false;
    const activeCats = STATE.categories.filter(c => !c.deleted);
    const maxOrder = activeCats.length > 0 ? Math.max(...activeCats.map(c => c.order ?? 0)) : -1;
    STATE.categories.push({ id: createCategoryId(), name: trimmed, color, order: maxOrder + 1, visible: true, deleted: false });
    dbSyncCategories();
    return true;
}

function categoryRename(oldName, newName) {
    const trimmed = newName.trim();
    const oldIdx = STATE.categories.findIndex(c => c.name === oldName && !c.deleted);
    if (oldIdx === -1) return false;
    if (trimmed === oldName) return true;
    if (STATE.categories.some(c => c.name === trimmed && !c.deleted)) return false;

    STATE.categories[oldIdx].name = trimmed;
    // categoryId로 조회하므로 tasks 업데이트 불필요
    // (구버전 호환) category 텍스트도 함께 업데이트

    dbSyncCategories();
    return true;
}

function categoryDelete(name) {
    const cat = STATE.categories.find(c => c.name === name && !c.deleted);
    if (!cat) return;
    cat.deleted = true;
    cat.visible = false;
    // STATE에서 제거하지 않음 → task 이름 조회용으로 유지
    if (cat.id) dbDeleteCategory(cat.id);
    else dbSyncCategories();
}

function categoryToggleVisible(name) {
    const cat = STATE.categories.find(c => c.name === name);
    if (!cat) return;
    cat.visible = cat.visible === false; // false → true, true/null/undefined → false
    if (!cat.visible && STATE.filter === name) STATE.filter = 'all';
    dbSyncCategories();
    renderCategoryFilter();
    renderBoard();
}

function toggleShowAllCats() {
    STATE.showAllCats = !STATE.showAllCats;
    renderCategoryFilter();
}

// ─── FILTERING ────────────────────────────────────────────────────────────────
function getFilteredByStatus(status) {
    const q = STATE.search.toLowerCase().trim();
    return STATE.tasks.filter(task => {
        if (task.status !== status) return false;
        if (STATE.filter !== 'all') {
            const filterCat = STATE.categories.find(c => c.name === STATE.filter);
            const filterCatId = filterCat?.id;
            if (!filterCatId || task.categoryId !== filterCatId) return false;
        }
        if (q) {
            const inTitle = task.title.toLowerCase().includes(q);
            const inDesc  = task.description.toLowerCase().includes(q);
            if (!inTitle && !inDesc) return false;
        }
        return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));  // Sort by order
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// categoryId → category name 조회 (삭제된 카테고리도 포함, 구버전 fallback 지원)
function getCategoryName(task) {
    if (!task.categoryId) return '';
    const cat = STATE.categories.find(c => c.id === task.categoryId);
    return cat?.name || '';
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dateStr) {
    if (!dateStr) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const due  = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
}

function getDayCount(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const due  = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = due - today;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '(D-day)';
    if (diffDays > 0) return `(D-${diffDays})`;
    return `(D+${Math.abs(diffDays)})`;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function getCategoryColor(categoryId) {
    const cat = STATE.categories.find(c => c.id === categoryId);
    return cat?.color || '#0ea5e9';
}

function buildCategoryBadge(task) {
    const name = getCategoryName(task);
    if (!name) return '';
    const color = getCategoryColor(task.categoryId);
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1.5 flex-shrink-0" style="color:${color}; background-color:${color}26;"><span class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background-color:${color}"></span>${esc(name)}</span>`;
}

function buildTaskCard(task) {
    // Calculate days remaining for color coding
    let dateCls = 'text-slate-400 dark:text-slate-500';
    if (task.dueDate) {
        const [y, m, d] = task.dueDate.split('-').map(Number);
        const due = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffMs = due - today;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays <= 3) {
            dateCls = 'text-red-500 font-medium';
        } else if (diffDays <= 7) {
            dateCls = 'text-orange-500 font-medium';
        }
    }
    const overdue   = isOverdue(task.dueDate);
    const isDone    = task.status === 'done';
    const titleCls  = isDone
        ? 'line-through text-slate-400 dark:text-slate-500'
        : 'text-slate-800 dark:text-slate-100';
    const checkCls  = isDone
        ? 'bg-emerald-500 border-emerald-500 text-white'
        : 'border-slate-300 dark:border-slate-600 hover:border-emerald-400 dark:hover:border-emerald-500 text-transparent';
    const priCls    =
        task.priority === 'high'   ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' :
        task.priority === 'medium' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400' :
                                     'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400';

    const borderColor = task.categoryId
        ? getCategoryColor(task.categoryId)
        : '#94a3b8';

    return `
<div class="task-card ${isDone ? 'opacity-50' : ''} fade-up"
     style="border-left: 4px solid ${borderColor}90;"
     data-task-id="${esc(task.id)}"
     onclick="handleCardClick('${esc(task.id)}', event)">

    <div class="flex gap-2.5 items-start">
        <button class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center
                       text-xs font-bold transition-all duration-200 ${checkCls}"
                onclick="handleToggleComplete('${esc(task.id)}')"
                title="Toggle complete">✓</button>

        <div class="flex-1 min-w-0">
            <div class="text-sm font-medium leading-snug ${titleCls}">${esc(task.title)}</div>
            ${task.description
                ? `<div class="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed line-clamp-2">${esc(task.description)}</div>`
                : ''}
            <div class="flex flex-wrap gap-1.5 mt-2 items-center">
                ${buildCategoryBadge(task)}
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${priCls}">${esc(task.priority)}</span>
                ${(task.status === 'done' && task.completedDate)
                    ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✅ ${formatDate(task.completedDate)}</span>`
                    : task.dueDate
                    ? `<span class="text-xs ${dateCls}">📅 ${formatDate(task.dueDate)} ${getDayCount(task.dueDate)}${overdue ? ' ⚠' : ''}</span>`
                    : ''}
            </div>
        </div>
    </div>
</div>`;
}

function buildEmptyState(label) {
    return `
<div class="flex flex-col items-center justify-center py-12 text-center select-none pointer-events-none">
    <div class="text-3xl mb-2 opacity-40">📭</div>
    <div class="text-sm text-slate-400 dark:text-slate-600">No ${label} tasks</div>
    <div class="text-xs text-slate-300 dark:text-slate-700 mt-1">Drag tasks here or add a new one</div>
</div>`;
}

function renderBoard() {
    const configs = [
        { listId: 'todoList',       status: 'todo',       label: 'to do' },
        { listId: 'inprogressList', status: 'inprogress', label: 'in progress' },
        { listId: 'doneList',       status: 'done',       label: 'done' }
    ];

    configs.forEach(({ listId, status, label }) => {
        const el    = document.getElementById(listId);
        const tasks = getFilteredByStatus(status);
        el.innerHTML = tasks.length
            ? tasks.map(buildTaskCard).join('')
            : buildEmptyState(label);
    });

    initDragAndDrop();
}

function renderStats() {
    const all   = STATE.tasks.filter(t => t.status !== 'archive');  // ✅ archive 제외
    const total = all.length;
    const done  = all.filter(t => t.status === 'done').length;  // ✅ status === 'done'만 카운트
    const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

    document.getElementById('completedCount').textContent = done;
    document.getElementById('totalCount').textContent     = total;
    document.getElementById('progressFill').style.width   = pct + '%';
    document.getElementById('progressPct').textContent    = pct + '%';

    // 모바일 헤더 진행률
    document.getElementById('completedCountMobile').textContent = done;
    document.getElementById('totalCountMobile').textContent     = total;
    document.getElementById('progressFillMobile').style.width   = pct + '%';
    document.getElementById('progressPctMobile').textContent    = pct + '%';

    const tCount = all.filter(t => t.status === 'todo').length;
    const iCount = all.filter(t => t.status === 'inprogress').length;
    const dCount = all.filter(t => t.status === 'done').length;

    document.getElementById('todoCount').textContent       = tCount;
    document.getElementById('inprogressCount').textContent = iCount;
    document.getElementById('doneCount').textContent       = dCount;
    document.getElementById('todoBadge').textContent       = tCount;
    document.getElementById('inprogressBadge').textContent = iCount;
    document.getElementById('doneBadge').textContent       = dCount;
}

function renderCategoryFilter() {
    const el = document.getElementById('categoryList');
    const sorted = [...STATE.categories]
        .filter(c => !c.deleted)   // 삭제된 카테고리 제외
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const visibleCats = sorted.filter(c => c.visible !== false);
    const hiddenCats  = sorted.filter(c => c.visible === false);
    const hiddenCount = hiddenCats.length;

    const visibleItems = [
        { value: 'all', label: '✦ All Tasks', catObj: null },
        ...visibleCats.map(c => ({ value: c.name, label: c.name, catObj: c }))
    ];

    const renderItem = ({ value, label, catObj }, isHidden = false) => {
        const active = STATE.filter === value;
        const catColor = catObj?.color || '#0ea5e9';

        let btnClass, btnStyle = '';
        if (active) {
            if (catObj) {
                btnClass = 'text-white shadow-sm';
                btnStyle = `style="background-color:${catColor};"`;
            } else {
                btnClass = 'bg-blue-500 text-white shadow-sm shadow-blue-500/20';
            }
        } else if (isHidden) {
            btnClass = 'text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700/60';
        } else {
            btnClass = 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60';
        }

        const dotHtml = catObj
            ? `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color:${catColor}"></span>`
            : '';

        const eyeIcon = catObj
            ? `<button class="px-1.5 py-1.5 text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 text-sm transition-colors"
                    onclick="categoryToggleVisible('${esc(value)}')"
                    title="${isHidden ? '표시하기' : '숨기기'}">${isHidden ? '👁' : '👁'}</button>`
            : '';

        return `<div class="flex items-center gap-1 category-item${isHidden ? ' opacity-60' : ''}" ${catObj ? `data-category="${esc(label)}"` : ''}>
            <button
                class="flex-1 text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 category-btn ${btnClass} flex items-center gap-2"
                data-filter="${esc(value)}"
                ${btnStyle}
            >${dotHtml}${esc(label)}</button>
            ${catObj ? eyeIcon : ''}
            ${catObj ? `<button class="px-2 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm"
                    onclick="showCategoryMenu('${esc(value)}')"
                    title="Manage">⋮</button>` : ''}
        </div>`;
    };

    let html = visibleItems.map(item => renderItem(item, false)).join('');

    if (hiddenCount > 0 || STATE.showAllCats) {
        const toggleLabel = STATE.showAllCats
            ? '접기 ▲'
            : `전체 보기 (${hiddenCount}개 숨김) ▼`;
        html += `<div class="mt-1 pt-1.5 border-t border-slate-200 dark:border-slate-700/50">
            <button onclick="toggleShowAllCats()"
                class="w-full text-left px-3 py-1 text-xs text-slate-400 dark:text-slate-500
                       hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-lg">
                ${toggleLabel}
            </button>
        </div>`;
    }

    if (STATE.showAllCats && hiddenCount > 0) {
        html += hiddenCats.map(c => renderItem({ value: c.name, label: c.name, catObj: c }, true)).join('');
    }

    el.innerHTML = html;

    el.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            STATE.filter = btn.dataset.filter;
            renderCategoryFilter();
            renderBoard();
        });
    });

    if (STATE.sortables.categoryList) STATE.sortables.categoryList.destroy();
    STATE.sortables.categoryList = new Sortable(el, {
        draggable: '.category-item[data-category]',
        animation: 150,
        onEnd: function() {
            const items = el.querySelectorAll('.category-item[data-category]');
            Array.from(items).forEach((el, idx) => {
                const name = el.dataset.category;
                const cat = STATE.categories.find(c => c.name === name);
                if (cat) cat.order = idx;
            });
            dbSyncCategories();
        }
    });
}

function renderCategorySelect() {
    const el = document.getElementById('taskCategory');
    const sorted = [...STATE.categories]
        .filter(c => !c.deleted && c.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    // value = category id (이름 변경 시에도 안전)
    el.innerHTML = `<option value="">None</option>` +
        sorted.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

function renderGoals() {
    const el = document.getElementById('goalsList');
    if (STATE.goals.length === 0) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = STATE.goals
        .sort((a, b) => a.order - b.order)
        .map(goal => `
<div class="goal-pill ${esc(goal.color)} fade-up group" data-goal-id="${esc(goal.id)}">
    <span>${esc(goal.text)}</span>
    <button type="button"
            class="ml-1 opacity-0 group-hover:opacity-100 transition-opacity leading-none text-lg"
            onclick="handleDeleteGoal('${esc(goal.id)}')"
            title="Delete">×</button>
</div>`)
        .join('');

    initGoalDragAndDrop();
}

function renderAll() {
    renderBoard();
    renderStats();
    renderCategoryFilter();
    renderCategorySelect();
    renderGoals();
}

// ─── DRAG AND DROP ────────────────────────────────────────────────────────────
function initDragAndDrop() {
    STATE.sortables.forEach(s => { try { s.destroy(); } catch(e) {} });
    STATE.sortables = [];

    const listIds = ['todoList', 'inprogressList', 'doneList'];

    listIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const instance = Sortable.create(el, {
            group:      'kanban',
            animation:  150,
            ghostClass: 'sortable-ghost',
            chosenClass:'sortable-chosen',
            filter:     '.pointer-events-none',
            forceFallback: false,
            delay: 100,
            delayOnTouchOnly: true,
            onEnd(evt) {
                const taskId   = evt.item.dataset.taskId;
                const newStatus = evt.to.dataset.status;

                if (!taskId || !newStatus) return;

                // Update task status
                const task = STATE.tasks.find(t => t.id === taskId);
                if (!task) return;

                task.status = newStatus;

                // Auto-update completed state based on status and set/clear completion date
                if (newStatus === 'done') {
                    task.completed = true;
                    task.completedDate = new Date().toISOString().split('T')[0];
                } else {
                    task.completed = false;
                    task.completedDate = '';
                }

                // Update order based on new DOM position
                const container = evt.to;
                const taskIds = Array.from(container.querySelectorAll('[data-task-id]'))
                    .map(el => el.dataset.taskId);

                taskIds.forEach((id, idx) => {
                    const t = STATE.tasks.find(task => task.id === id);
                    if (t) t.order = idx;
                });

                dbSyncTask(task);
                taskIds.forEach(id => {
                    const t = STATE.tasks.find(task => task.id === id);
                    if (t) dbSyncTask(t);
                });

                // Full re-render to update all UI
                renderBoard();
                renderStats();
                renderCategoryFilter();
            }
        });

        STATE.sortables.push(instance);
    });
}

function initGoalDragAndDrop() {
    const el = document.getElementById('goalsList');
    if (!el) return;

    if (STATE.goalSortable) {
        try { STATE.goalSortable.destroy(); } catch(e) {}
    }

    STATE.goalSortable = Sortable.create(el, {
        animation:  150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        forceFallback: false,
        onEnd() {
            const newOrder = Array.from(el.querySelectorAll('[data-goal-id]'))
                .map(el => el.dataset.goalId);
            goalsReorder(newOrder);
        }
    });
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function modalShow(modalId) {
    document.getElementById(modalId).style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('openAddTaskModal').style.display = 'none';
}

function modalHide(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.body.style.overflow = '';
    if (modalId === 'taskModal') STATE.editingId = null;
    document.getElementById('openAddTaskModal').style.display = 'flex';
}

function updateTaskDateFields() {
    const status = document.getElementById('taskStatus').value;
    const dueDateField = document.getElementById('dueDateField');
    const completedDateField = document.getElementById('completedDateField');

    if (status === 'done' || status === 'archive') {
        dueDateField.style.display = 'none';
        completedDateField.style.display = 'grid';
    } else {
        dueDateField.style.display = 'block';
        completedDateField.style.display = 'none';
    }
}

function closeTaskModalWithConfirm() {
    const titleInput = document.getElementById('taskTitle');
    const titleValue = titleInput ? titleInput.value.trim() : '';

    // If title is empty or it's an existing task being edited, close without asking
    if (!titleValue || STATE.editingId) {
        modalHide('taskModal');
        return;
    }

    // Title has content - ask for confirmation
    if (confirm('Close without saving? Any unsaved task will be lost.')) {
        modalHide('taskModal');
    }
}

function openAddModal() {
    STATE.editingId = null;
    document.getElementById('modalTitle').textContent = 'New Task';
    document.getElementById('taskForm').reset();
    document.getElementById('titleError').classList.add('hidden');
    document.getElementById('deleteTaskBtn').classList.add('hidden');
    document.getElementById('taskCompletedDate').value = '';
    renderCategorySelect();
    updateTaskDateFields();
    modalShow('taskModal');
    setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

function handleCardClick(id, event) {
    // 체크박스 버튼 클릭은 무시
    if (event.target.closest('button')) return;
    handleEditTask(id);
}

function handleEditTask(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;

    STATE.editingId = id;
    document.getElementById('modalTitle').textContent = 'Edit Task';
    renderCategorySelect();

    // 현재 task의 category가 숨김 상태면 해당 항목만 드롭다운에 추가
    if (task.categoryId) {
        const currentCat = STATE.categories.find(c => c.id === task.categoryId);
        if (currentCat && !currentCat.deleted && currentCat.visible === false) {
            const opt = document.createElement('option');
            opt.value = currentCat.id;
            opt.textContent = `${currentCat.name} (숨김)`;
            document.getElementById('taskCategory').appendChild(opt);
        }
    }

    document.getElementById('taskTitle').value       = task.title;
    document.getElementById('taskDescription').value = task.description;
    document.getElementById('taskCategory').value    = task.categoryId || '';
    document.getElementById('taskPriority').value    = task.priority;
    document.getElementById('taskStatus').value      = task.status;
    document.getElementById('taskDueDate').value     = task.dueDate;
    document.getElementById('taskCompletedDate').value = task.completedDate || '';
    document.getElementById('titleError').classList.add('hidden');
    document.getElementById('deleteTaskBtn').classList.remove('hidden');

    updateTaskDateFields();
    modalShow('taskModal');
    setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

function handleDeleteTask(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;

    const confirmed = confirm(
        `⚠️ Delete "${task.title}"?\n\nThis action is irreversible and cannot be undone.`
    );

    if (confirmed) {
        taskDelete(id);
        renderAll();

        // ✅ calendar modal이 열려있으면 업데이트
        const calendarModal = document.getElementById('calendarModal');
        if (calendarModal && calendarModal.style.display !== 'none') {
            window.refreshCalendarView?.();
        }
    }
}

function handleToggleComplete(id) {
    taskToggleComplete(id);
    renderAll();
}

function handleArchiveTask(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;
    task.status = 'archive';
    if (!task.completedDate) {
        task.completedDate = new Date().toISOString().slice(0, 10);
    }
    dbSyncTask(task);
    renderAll();
}

function renderArchiveList() {
    const searchText = document.getElementById('archiveSearchInput').value.toLowerCase();
    const filterDateFrom = document.getElementById('archiveFilterDateFrom').value;
    const filterDateTo = document.getElementById('archiveFilterDateTo').value;

    let archived = STATE.tasks.filter(t => t.status === 'archive');

    // Sort by completed date (newest first)
    archived.sort((a, b) => {
        const dateA = new Date(a.completedDate || '0000-00-00');
        const dateB = new Date(b.completedDate || '0000-00-00');
        return dateB - dateA;
    });

    // Filter by search text (title & description)
    if (searchText) {
        archived = archived.filter(t =>
            t.title.toLowerCase().includes(searchText) ||
            t.description.toLowerCase().includes(searchText)
        );
    }

    // Filter by date range
    if (filterDateFrom || filterDateTo) {
        archived = archived.filter(t => {
            const taskDate = t.completedDate;
            if (filterDateFrom && taskDate < filterDateFrom) return false;
            if (filterDateTo && taskDate > filterDateTo) return false;
            return true;
        });
    }

    const list = document.getElementById('archiveList');
    if (archived.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">No archived tasks</p>';
        return;
    }

    list.innerHTML = archived.map(task => `
        <div class="pl-3 pr-3 pt-2 pb-2 rounded-lg bg-slate-100 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 cursor-pointer"
             style="border-left: 4px solid ${task.categoryId ? getCategoryColor(task.categoryId) + '26' : '#94a3b826'};"
             onclick="if(!event.target.closest('button')) showTaskDetailOverlay('${esc(task.id)}')"
             title="Click to view details">
            <div class="flex items-center gap-3 justify-between">
                <div class="flex items-center gap-2 min-w-0 flex-wrap">
                    <div class="text-sm font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">${esc(task.title)}</div>
                    ${buildCategoryBadge(task)}
                    <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap"> ${formatDate(task.completedDate)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function showTaskDetailOverlay(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const statusLabels = {
        'todo':       { emoji: '📋', text: 'To Do' },
        'inprogress': { emoji: '⏳', text: 'In Progress' },
        'done':       { emoji: '✅', text: 'Done' },
        'archive':    { emoji: '📥', text: 'Archive' }
    };
    const status = statusLabels[task.status] || statusLabels['todo'];

    document.getElementById('taskDetailOverlayContent').innerHTML = `
        <div>
            <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Title</p>
            <p class="font-bold text-slate-800 dark:text-slate-100 mt-1">${esc(task.title)}</p>
        </div>
        ${task.description ? `
        <div>
            <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Description</p>
            <p class="text-slate-700 dark:text-slate-300 mt-1">${esc(task.description)}</p>
        </div>` : ''}
        <div class="grid grid-cols-2 gap-2">
            <div>
                <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Status</p>
                <p class="font-medium mt-1">${status.emoji} ${status.text}</p>
            </div>
            ${getCategoryName(task) ? `
            <div>
                <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Category</p>
                <span class="mt-1 inline-block">${buildCategoryBadge(task)}</span>
            </div>` : ''}
        </div>
        ${task.priority ? `
        <div>
            <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Priority</p>
            <p class="font-medium mt-1 capitalize">${task.priority}</p>
        </div>` : ''}
        ${task.completedDate ? `
        <div>
            <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Completed Date</p>
            <p class="font-medium mt-1">✓ ${formatDate(task.completedDate)}</p>
        </div>` : ''}
        ${task.createdAt ? `
        <div>
            <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Created</p>
            <p class="text-xs mt-1 text-slate-500">${new Date(task.createdAt).toLocaleDateString()}</p>
        </div>` : ''}
    `;

    document.getElementById('taskDetailOverlayButtons').innerHTML = `
        <button onclick="handleRestoreArchive('${esc(taskId)}'); document.getElementById('taskDetailOverlay').style.display='none'; renderArchiveList();"
                class="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                       bg-blue-500/10 text-blue-600 dark:text-blue-400
                       hover:bg-blue-500/20 transition-colors">
            ⏏️ Restore
        </button>
        <button onclick="handleDeleteArchive('${esc(taskId)}'); document.getElementById('taskDetailOverlay').style.display='none';"
                class="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                       bg-red-500/10 text-red-600 dark:text-red-400
                       hover:bg-red-500/20 transition-colors">
            🗑️ Delete
        </button>
    `;

    document.getElementById('taskDetailOverlay').style.display = 'flex';
}

function handleRestoreArchive(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;
    task.status = 'done';
    task.completed = true;
    dbSyncTask(task);
    renderArchiveList();
    renderAll();
}

function handleDeleteArchive(id) {
    const task = STATE.tasks.find(t => t.id === id);
    if (!task) return;
    taskDelete(id);
    renderArchiveList();
    renderAll();
}

function showTaskDetail(taskId, editMode = false) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const statusLabels = {
        'todo': { emoji: '📋', text: 'To Do' },
        'inprogress': { emoji: '⏳', text: 'In Progress' },
        'done': { emoji: '✅', text: 'Done' },
        'archive': { emoji: '📥', text: 'Archive' }
    };
    const status = statusLabels[task.status] || statusLabels['todo'];

    const panel = document.getElementById('taskDetailPanel');
    const content = document.getElementById('taskDetailContent');

    // ✅ Edit mode 렌더링
    if (editMode) {
        // 표시 중인 카테고리 + 현재 task의 숨김 카테고리(있을 경우)만 포함
        const currentCatInDetail = task.categoryId
            ? STATE.categories.find(c => c.id === task.categoryId)
            : null;
        const categories = STATE.categories.filter(c =>
            !c.deleted && (c.visible !== false || c.id === task.categoryId)
        ).map(c =>
            (c.visible === false) ? { ...c, name: `${c.name} (숨김)` } : c
        );

        // ✅ 현재 form의 status 값을 확인 (status 변경 시 UI 업데이트)
        const statusSelect = document.getElementById('statusEdit');
        const currentStatus = statusSelect ? statusSelect.value : task.status;

        const buttonDiv = document.getElementById('taskDetailButtons');
        buttonDiv.className = 'border-t border-slate-200 dark:border-slate-700 pt-4 flex gap-2 flex-shrink-0';
        buttonDiv.innerHTML = `
            <button onclick="saveTaskEdits('${taskId}')" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg py-2 text-sm font-medium transition-colors">
                ✓ Save
            </button>
            <button onclick="cancelTaskEdits('${taskId}')" class="flex-1 bg-slate-500/10 hover:bg-slate-500/20 text-slate-600 dark:text-slate-400 rounded-lg py-2 text-sm font-medium transition-colors">
                ✕ Cancel
            </button>
        `;

        content.innerHTML = `
            <div class="space-y-3">
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Title</p>
                    <input type="text" id="titleEdit" value="${esc(task.title)}" class="input-field mt-1">
                </div>

                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Description</p>
                    <textarea id="descriptionEdit" class="input-field mt-1 resize-none" rows="3">${esc(task.description || '')}</textarea>
                </div>

                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Status</p>
                    <select id="statusEdit" class="input-field mt-1" onchange="showTaskDetail('${taskId}', true)">
                        <option value="todo" ${currentStatus === 'todo' ? 'selected' : ''}>📋 To Do</option>
                        <option value="inprogress" ${currentStatus === 'inprogress' ? 'selected' : ''}>⏳ In Progress</option>
                        <option value="done" ${currentStatus === 'done' ? 'selected' : ''}>✅ Done</option>
                        <option value="archive" ${currentStatus === 'archive' ? 'selected' : ''}>📥 Archive</option>
                    </select>
                </div>

                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Category</p>
                    <select id="categoryEdit" class="input-field mt-1">
                        <option value="">- None -</option>
                        ${categories.map(c => `<option value="${esc(c.id)}" ${task.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Priority</p>
                    <select id="priorityEdit" class="input-field mt-1">
                        <option value="">- None -</option>
                        <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                </div>

                ${(currentStatus !== 'done' && currentStatus !== 'archive') ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Due Date</p>
                    <input type="date" id="dueDateEdit" value="${task.dueDate || ''}" class="input-field mt-1">
                </div>
                ` : ''}

                ${(currentStatus === 'done' || currentStatus === 'archive') ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Completed Date</p>
                    <input type="date" id="completedDateEdit" value="${task.completedDate || ''}" class="input-field mt-1">
                </div>
                ` : ''}

                ${task.createdAt ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Created</p>
                    <p class="text-xs mt-1 text-slate-500">${new Date(task.createdAt).toLocaleDateString()}</p>
                </div>
                ` : ''}
            </div>
        `;
    } else {
        // ✅ View mode 렌더링
        const buttonDiv = document.getElementById('taskDetailButtons');
        buttonDiv.className = 'border-t border-slate-200 dark:border-slate-700 pt-4 px-4 pb-4 flex gap-2 flex-shrink-0';
        buttonDiv.innerHTML = `
            <button onclick="showTaskDetail('${taskId}', true)" class="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors">✎ Edit</button>
            <button onclick="deleteTaskConfirm('${taskId}')" class="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors">🗑️ Delete</button>
        `;

        content.innerHTML = `
            <div class="space-y-3">
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Title</p>
                    <p class="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">${esc(task.title)}</p>
                </div>

                ${task.description ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Description</p>
                    <p class="text-sm text-slate-700 dark:text-slate-300 mt-1">${esc(task.description)}</p>
                </div>
                ` : ''}

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Status</p>
                        <p class="text-sm font-medium mt-1">${status.emoji} ${status.text}</p>
                    </div>
                    ${getCategoryName(task) ? `
                    <div>
                        <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Category</p>
                        <span class="mt-1 inline-block">${buildCategoryBadge(task)}</span>
                    </div>
                    ` : ''}
                </div>

                ${task.priority ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Priority</p>
                    <p class="text-sm font-medium mt-1 capitalize">${task.priority}</p>
                </div>
                ` : ''}

                ${(task.status !== 'done' && task.status !== 'archive') ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Due Date</p>
                    <p class="text-sm font-medium mt-1">📅 ${formatDate(task.dueDate) || '-'}</p>
                </div>
                ` : ''}

                ${(task.status === 'done' || task.status === 'archive') ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Completed Date</p>
                    <p class="text-sm font-medium mt-1">✓ ${formatDate(task.completedDate) || '-'}</p>
                </div>
                ` : ''}

                ${task.createdAt ? `
                <div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Created</p>
                    <p class="text-xs mt-1">${new Date(task.createdAt).toLocaleDateString()}</p>
                </div>
                ` : ''}
            </div>
        `;
    }

    openTaskDetailPanel();
}

function updateTaskDate(taskId, field, value) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    taskUpdate(taskId, { [field]: value });
    showTaskDetail(taskId);
    renderAll();

    // ✅ calendar modal이 열려있으면 calendar 업데이트
    const calendarModal = document.getElementById('calendarModal');
    if (calendarModal && calendarModal.style.display !== 'none') {
        window.refreshCalendarView?.();
    }
}

function saveTaskEdits(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const updates = {};

    // ✅ 모든 필드 수집
    const titleInput = document.getElementById('titleEdit');
    const descriptionInput = document.getElementById('descriptionEdit');
    const statusInput = document.getElementById('statusEdit');
    const categoryInput = document.getElementById('categoryEdit');
    const priorityInput = document.getElementById('priorityEdit');
    const dueDateInput = document.getElementById('dueDateEdit');
    const completedDateInput = document.getElementById('completedDateEdit');

    if (titleInput && titleInput.value.trim()) {
        updates.title = titleInput.value.trim();
    }
    if (descriptionInput) {
        updates.description = descriptionInput.value.trim();
    }
    if (statusInput) {
        updates.status = statusInput.value;
    }
    if (categoryInput) {
        const catId = categoryInput.value || '';
        const cat = STATE.categories.find(c => c.id === catId);
        updates.categoryId = catId;

    }
    if (priorityInput) {
        updates.priority = priorityInput.value || null;
    }
    if (dueDateInput && dueDateInput.value) {
        updates.dueDate = dueDateInput.value;
    }
    if (completedDateInput && completedDateInput.value) {
        updates.completedDate = completedDateInput.value;
    }

    if (Object.keys(updates).length > 0) {
        taskUpdate(taskId, updates);
    }

    showTaskDetail(taskId, false);  // ✅ edit mode 해제
    renderAll();

    const calendarModal = document.getElementById('calendarModal');
    if (calendarModal && calendarModal.style.display !== 'none') {
        window.refreshCalendarView?.();
    }
}

function cancelTaskEdits(taskId) {
    showTaskDetail(taskId, false);  // ✅ edit mode 해제, 변경사항 저장 안 함
}

function toggleTaskCardMenu(taskId, event) {
    event.stopPropagation();
    const menu = document.getElementById(`taskCardMenu_${taskId}`);

    // 다른 menu들 닫기
    document.querySelectorAll('.taskCardMenu').forEach(m => {
        if (m.id !== `taskCardMenu_${taskId}`) {
            m.classList.add('hidden');
        }
    });

    // 현재 menu 토글
    menu.classList.toggle('hidden');

    // 외부 클릭 시 menu 닫기
    document.addEventListener('click', function closeMenu(e) {
        if (!menu.parentElement.contains(e.target)) {
            menu.classList.add('hidden');
            document.removeEventListener('click', closeMenu);
        }
    });
}

// 하위 호환성을 위한 래퍼 함수
function saveTaskDateEdits(taskId) {
    saveTaskEdits(taskId);
}

function cancelTaskDateEdits(taskId) {
    cancelTaskEdits(taskId);
}

function openTaskDetailPanel() {
    const panel = document.getElementById('taskDetailPanel');
    if (window.innerWidth < 640) {
        panel.style.width = '';
        panel.style.height = '';
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        panel.style.overflow = 'auto';
    } else {
        document.getElementById('calendarModalContent').style.maxWidth = '50rem';
        document.getElementById('contentWrapper').style.gap = '1.5rem';
        setTimeout(() => {
            panel.style.opacity = '1';
            panel.style.pointerEvents = 'auto';
            panel.style.width = '20rem';
            panel.style.height = 'auto';
            panel.style.overflow = 'auto';
        }, 50);
    }
}

function closeTaskDetailPanel() {
    const panel = document.getElementById('taskDetailPanel');
    if (window.innerWidth < 640) {
        panel.style.opacity = '0';
        panel.style.pointerEvents = 'none';
        panel.style.overflow = 'hidden';
        panel.style.width = '';
        panel.style.height = '';
    } else {
        panel.style.width = '0';
        panel.style.height = '0';
        panel.style.pointerEvents = 'none';
        panel.style.overflow = 'hidden';
        document.getElementById('contentWrapper').style.gap = '0';
        document.getElementById('calendarModalContent').style.maxWidth = '30rem';
        setTimeout(() => { panel.style.opacity = '0'; }, 10);
    }
}

// ✅ 캘린더에서 delete 호출 (detail panel 닫기 포함)
function deleteTaskConfirm(taskId) {
    handleDeleteTask(taskId);

    closeTaskDetailPanel();
}

function handleDeleteGoal(id) {
    goalDelete(id);
    renderGoals();
}

function selectMenuColor(btn, hex) {
    document.querySelectorAll('#categoryColorPicker .color-swatch').forEach(b => {
        b.classList.remove('ring-2', 'ring-offset-2', 'ring-slate-400', 'scale-110');
    });
    btn.classList.add('ring-2', 'ring-offset-2', 'ring-slate-400', 'scale-110');
    document.getElementById('colorInput').value = hex;
}

function selectNewCatColor(btn, hex) {
    document.querySelectorAll('#newCategoryColorSwatches .color-swatch').forEach(b => {
        b.classList.remove('ring-2', 'ring-offset-2', 'ring-slate-400', 'scale-110');
    });
    btn.classList.add('ring-2', 'ring-offset-2', 'ring-slate-400', 'scale-110');
    document.getElementById('newCategoryColor').value = hex;
}

function showCategoryMenu(categoryName) {
    const el = document.getElementById('categoryModalContent');
    const cat = STATE.categories.find(c => c.name === categoryName && !c.deleted);
    const currentColor = cat?.color || '#0ea5e9';

    const colorSwatches = CATEGORY_COLORS.map(c => `<button type="button"
        class="w-7 h-7 rounded-full transition-all duration-150 color-swatch flex-shrink-0 ${c.hex === currentColor ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-110'}"
        style="background-color:${c.hex}"
        data-color="${c.hex}"
        onclick="selectMenuColor(this, '${c.hex}')"
        title="${c.name}"></button>`).join('');

    el.innerHTML = `
        <div class="space-y-3">
            <input type="text" id="renameInput" value="${esc(categoryName)}" class="input-field" placeholder="New name">
            <div id="categoryColorPicker" class="flex items-center gap-2 flex-wrap py-1">
                ${colorSwatches}
                <input type="hidden" id="colorInput" value="${currentColor}">
            </div>
            <div class="flex gap-2">
                <button onclick="confirmRenameCategory('${esc(categoryName)}')" class="btn-primary flex-1 text-sm py-2">Save</button>
                <button onclick="confirmDeleteCategory('${esc(categoryName)}')" class="flex-1 bg-red-500/10 text-red-600 hover:bg-red-500/20 rounded-lg py-2 text-sm font-medium transition-colors">Delete</button>
            </div>
        </div>
    `;
    modalShow('categoryModal');
    setTimeout(() => document.getElementById('renameInput').focus(), 50);
}

function confirmRenameCategory(oldName) {
    const newName = document.getElementById('renameInput').value.trim();
    const newColor = document.getElementById('colorInput').value;
    if (!newName) {
        alert('Please enter a name');
        return;
    }
    const cat = STATE.categories.find(c => c.name === oldName && !c.deleted);
    if (cat && newColor) cat.color = newColor;

    if (newName !== oldName) {
        if (!categoryRename(oldName, newName)) {
            alert('Category already exists or is invalid');
            return;
        }
    } else {
        dbSyncCategories();
    }

    modalHide('categoryModal');
    renderAll();
}

function confirmDeleteCategory(name) {
    if (confirm(`Delete "${name}"? Tasks with this category will lose their category assignment.`)) {
        categoryDelete(name);
        modalHide('categoryModal');
        renderAll();
    }
}

// ─── FORM SUBMISSION ─────────────────────────────────────────────────────────
function handleFormSubmit(e) {
    e.preventDefault();

    const title = document.getElementById('taskTitle').value.trim();

    if (!title) {
        document.getElementById('titleError').classList.remove('hidden');
        document.getElementById('taskTitle').focus();
        return;
    }

    document.getElementById('titleError').classList.add('hidden');

    const status = document.getElementById('taskStatus').value;
    const data = {
        title,
        description: document.getElementById('taskDescription').value,
        categoryId:  document.getElementById('taskCategory').value,
        priority:    document.getElementById('taskPriority').value,
        status:      status,
        dueDate:     (status === 'done' || status === 'archive') ? '' : document.getElementById('taskDueDate').value,
        completedDate: (status === 'done' || status === 'archive') ? (document.getElementById('taskCompletedDate').value || new Date().toISOString().slice(0, 10)) : ''
    };

    if (STATE.editingId) {
        taskUpdate(STATE.editingId, data);
    } else {
        taskCreate(data);
    }

    modalHide('taskModal');
    renderAll();
}

// ─── DARK MODE ───────────────────────────────────────────────────────────────
function applyDarkMode() {
    const html = document.documentElement;
    if (STATE.darkMode) {
        html.classList.add('dark');
        document.getElementById('toggleDarkMode').textContent = '☀️';
    } else {
        html.classList.remove('dark');
        document.getElementById('toggleDarkMode').textContent = '🌙';
    }
}


// ─── EVENT WIRING ────────────────────────────────────────────────────────────
// Toggle category form visibility
function toggleCategoryForm() {
    const form = document.getElementById('addCategoryForm');
    const input = document.getElementById('newCategoryInput');
    const toggleBtn = document.getElementById('toggleCategoryFormBtn');
    if (form.style.display === 'none') {
        form.style.display = 'block';
        input.focus();
        input.value = '';
        toggleBtn.textContent = '✕';
        toggleBtn.style.fontSize = '0.875rem';
        // render color swatches
        const defaultColor = '#0ea5e9';
        document.getElementById('newCategoryColor').value = defaultColor;
        document.getElementById('newCategoryColorSwatches').innerHTML = CATEGORY_COLORS.map(c => `<button type="button"
            class="w-7 h-7 rounded-full transition-all duration-150 color-swatch flex-shrink-0 ${c.hex === defaultColor ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-110'}"
            style="background-color:${c.hex}"
            data-color="${c.hex}"
            onclick="selectNewCatColor(this, '${c.hex}')"
            title="${c.name}"></button>`).join('');
    } else {
        form.style.display = 'none';
        toggleBtn.textContent = '+';
        toggleBtn.style.fontSize = '1rem';
    }
}

function wireEvents() {

    // Task Modal
    document.getElementById('openAddTaskModal').addEventListener('click', openAddModal);
    document.getElementById('closeModal').addEventListener('click', closeTaskModalWithConfirm);
    let taskModalMouseDownOnBackdrop = false;
    document.getElementById('taskModal').addEventListener('mousedown', function(e) {
        taskModalMouseDownOnBackdrop = (e.target === this);
    });
    document.getElementById('taskModal').addEventListener('click', function(e) {
        if (e.target === this && taskModalMouseDownOnBackdrop) closeTaskModalWithConfirm();
    });
    document.getElementById('taskForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('deleteTaskBtn').addEventListener('click', function() {
        if (STATE.editingId) {
            taskDelete(STATE.editingId);
            modalHide('taskModal');
            renderAll();
        }
    });

    // Category Modal
    document.getElementById('closeCategoryModal').addEventListener('click', () => modalHide('categoryModal'));
    document.getElementById('categoryModal').addEventListener('click', function(e) {
        if (e.target === this) modalHide('categoryModal');
    });

    // Calendar variables and functions
    let calendarMonth = new Date().getMonth();
    let calendarYear = new Date().getFullYear();
    let calendarSelectedDate = null;

    function getTasksByDate(dateStr) {
        return STATE.tasks.filter(t => {
            if (t.status === 'done' || t.status === 'archive') {
                return t.completedDate === dateStr;
            } else {
                return t.dueDate === dateStr;
            }
        });
    }

    function renderCalendar() {
        const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
        const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                            'July', 'August', 'September', 'October', 'November', 'December'];

        document.getElementById('calendarTitle').textContent = `${monthNames[calendarMonth]} ${calendarYear}`;

        const grid = document.getElementById('calendarGrid');
        grid.innerHTML = '';

        // Empty cells for days before month starts
        for (let i = 0; i < firstDay; i++) {
            const emptyDiv = document.createElement('div');
            grid.appendChild(emptyDiv);
        }

        // Days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const tasksOnDate = getTasksByDate(dateStr);
            const taskCount = tasksOnDate.length;

            const dayDiv = document.createElement('div');
            dayDiv.className = 'p-2 rounded-lg text-center cursor-pointer text-xs font-medium transition-all duration-200';

            // 선택된 날짜 강조
            if (dateStr === calendarSelectedDate) {
                dayDiv.className += ' bg-blue-500 dark:bg-blue-600 text-white border-2 border-blue-600 dark:border-blue-700 ring-2 ring-blue-400';
            } else {
                dayDiv.className += ' bg-slate-100 dark:bg-slate-700/40 hover:bg-blue-100 dark:hover:bg-blue-900/30';

                if (taskCount > 0) {
                    dayDiv.className += ' border-2 border-blue-400 dark:border-blue-500';
                } else {
                    dayDiv.className += ' border border-slate-200 dark:border-slate-600';
                }
            }

            const today = new Date();
            if (day === today.getDate() && calendarMonth === today.getMonth() && calendarYear === today.getFullYear()) {
                dayDiv.className += ' ring-2 ring-emerald-400 dark:ring-emerald-500';
            }

            // ✅ [완료된것/전체] 형태로 count 표시
            const completedCount = tasksOnDate.filter(t => t.status === 'done' || t.status === 'archive').length;
            dayDiv.innerHTML = `<div>${day}</div>` + (taskCount > 0 ? `<div class="text-xs text-blue-600 dark:text-blue-400 font-bold">[${completedCount}/${taskCount}]</div>` : '');
            dayDiv.addEventListener('click', () => {
                calendarSelectedDate = dateStr;
                renderCalendar();
                showSelectedDateTasks();

                closeTaskDetailPanel();
            });
            grid.appendChild(dayDiv);
        }
    }

    function showSelectedDateTasks() {
        if (!calendarSelectedDate) {
            document.getElementById('selectedDateText').textContent = 'Select a date';
            document.getElementById('selectedTasksList').innerHTML = '';
            return;
        }

        let tasks = getTasksByDate(calendarSelectedDate);

        // Status 순서: todo -> inprogress -> done -> archive
        const statusOrder = { todo: 0, inprogress: 1, done: 2, archive: 3 };
        tasks.sort((a, b) => (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0));

        const [y, m, d] = calendarSelectedDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        document.getElementById('selectedDateText').textContent = `Tasks for ${dateStr} (${tasks.length})`;

        const tasksList = document.getElementById('selectedTasksList');
        tasksList.innerHTML = tasks.length === 0
            ? '<p class="text-xs text-slate-400 dark:text-slate-500">No tasks on this date</p>'
            : tasks.map(t => {
                const statusLabels = {
                    'todo': { emoji: '📋', text: 'To Do', color: 'text-slate-600 dark:text-slate-400' },
                    'inprogress': { emoji: '⏳', text: 'In Progress', color: 'text-blue-600 dark:text-blue-400' },
                    'done': { emoji: '✅', text: 'Done', color: 'text-emerald-600 dark:text-emerald-400' },
                    'archive': { emoji: '📥', text: 'Archive', color: 'text-amber-600 dark:text-amber-400' }
                };
                const status = statusLabels[t.status] || statusLabels['todo'];
                return `
                    <div class="p-2 rounded-lg bg-slate-100 dark:bg-slate-700/40 text-sm flex items-center gap-2 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600/40 transition-colors" onclick="showTaskDetail('${esc(t.id)}')">
                        <div class="font-medium text-slate-800 dark:text-slate-100 truncate flex-1">${esc(t.title)}</div>
                        ${buildCategoryBadge(t)}
                        <span class="${status.color} text-xs font-medium ml-auto flex-shrink-0">${status.emoji} ${status.text}</span>
                    </div>
                `;
            }).join('');
    }

    // ✅ window에 calendar 함수들 할당 (외부에서 접근 가능하게)
    window.refreshCalendarView = function() {
        renderCalendar();
        showSelectedDateTasks();
    };

    // Calendar event listeners
    document.getElementById('openCalendarBtn').addEventListener('click', function() {
        modalShow('calendarModal');
        renderCalendar();
        showSelectedDateTasks();
    });

    document.getElementById('closeCalendarModal').addEventListener('click', () => {
        closeTaskDetailPanel();
        modalHide('calendarModal');
    });

    document.getElementById('closeTaskDetail').addEventListener('click', () => {
        closeTaskDetailPanel();
    });
    document.getElementById('calendarModal').addEventListener('click', function(e) {
        if (e.target === this) modalHide('calendarModal');
    });

    document.getElementById('prevMonth').addEventListener('click', function() {
        calendarMonth--;
        if (calendarMonth < 0) {
            calendarMonth = 11;
            calendarYear--;
        }
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', function() {
        calendarMonth++;
        if (calendarMonth > 11) {
            calendarMonth = 0;
            calendarYear++;
        }
        renderCalendar();
    });

    // ─── 24H SCHEDULE (wheel initialized in schedule-wheel.js) ────────────────
    function switchSchedTab(tab) {
        if (window.innerWidth >= 640) return;
        const wheel = document.getElementById('schedWheelSection');
        const form  = document.getElementById('schedFormSection');
        const tabWheel = document.getElementById('schedTabWheel');
        const tabForm  = document.getElementById('schedTabForm');
        if (tab === 'wheel') {
            wheel.style.display = '';
            form.style.display  = 'none';
            tabWheel.classList.add('tab-active');
            tabForm.classList.remove('tab-active');
        } else {
            wheel.style.display = 'none';
            form.style.display  = '';
            tabForm.classList.add('tab-active');
            tabWheel.classList.remove('tab-active');
        }
    }

    document.getElementById('schedTabWheel').addEventListener('click', () => switchSchedTab('wheel'));
    document.getElementById('schedTabForm').addEventListener('click',  () => switchSchedTab('form'));
    window.switchSchedTab = switchSchedTab;

    document.getElementById('openScheduleBtn').addEventListener('click', function() {
        modalShow('scheduleModal');
        initScheduleWheel();
        switchSchedTab('wheel');
    });

    document.getElementById('closeScheduleModal').addEventListener('click', () => modalHide('scheduleModal'));
    document.getElementById('scheduleModal').addEventListener('click', function(e) {
        if (e.target === this) modalHide('scheduleModal');
    });

    // ─── ARCHIVE MODAL ─────────────────────────────────────────
    document.getElementById('openArchiveBtn').addEventListener('click', function() {
        modalShow('archiveModal');
        renderArchiveList();
    });

    document.getElementById('closeArchiveModal').addEventListener('click', () => modalHide('archiveModal'));
    document.getElementById('archiveModal').addEventListener('click', function(e) {
        if (e.target === this) modalHide('archiveModal');
    });

    document.getElementById('archiveSearchInput').addEventListener('input', renderArchiveList);
    document.getElementById('archiveFilterDateFrom').addEventListener('change', renderArchiveList);
    document.getElementById('archiveFilterDateTo').addEventListener('change', renderArchiveList);

    // Dark mode
    document.getElementById('toggleDarkMode').addEventListener('click', function() {
        STATE.darkMode = !STATE.darkMode;
        applyDarkMode();
        saveDarkMode();
    });

    // Search
    // document.getElementById('searchInput').addEventListener('input', function(e) {
    //     STATE.search = e.target.value;
    //     renderBoard();
    // });

    // Add Category
    document.getElementById('addCategoryBtn').addEventListener('click', function() {
        const input = document.getElementById('newCategoryInput');
        const color = document.getElementById('newCategoryColor').value || '#0ea5e9';
        const val   = input.value.trim();
        if (val && categoryCreate(val, color)) {
            input.value = '';
            renderAll();
            toggleCategoryForm();
        }
    });

    document.getElementById('newCategoryInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addCategoryBtn').click();
        }
    });

    // Add Goal Form
    document.getElementById('toggleAddGoalBtn').addEventListener('click', function() {
        const form = document.getElementById('addGoalForm');
        form.style.display = 'flex';
        document.getElementById('newGoalInput').focus();
    });

    document.getElementById('saveGoalBtn').addEventListener('click', function() {
        const input = document.getElementById('newGoalInput');
        const val = input.value.trim();
        if (val) {
            goalCreate(val);
            input.value = '';
            renderGoals();
            document.getElementById('addGoalForm').style.display = 'none';
        }
    });

    document.getElementById('cancelGoalBtn').addEventListener('click', function() {
        document.getElementById('newGoalInput').value = '';
        document.getElementById('addGoalForm').style.display = 'none';
    });

    document.getElementById('newGoalInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('saveGoalBtn').click();
        } else if (e.key === 'Escape') {
            document.getElementById('cancelGoalBtn').click();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openAddModal();
        }
        if (e.key === 'Escape') {
            if (document.getElementById('taskModal').style.display === 'flex') {
                closeTaskModalWithConfirm();
            } else if (document.getElementById('categoryModal').style.display === 'flex') {
                modalHide('categoryModal');
            }
        }
    });

    // ─── 모바일 드로어 ────────────────────────────────────────────
    function openDrawer() {
        document.getElementById('sideDrawer').classList.add('drawer-open');
        document.getElementById('drawerBackdrop').classList.remove('hidden');
        document.body.classList.add('drawer-open');
    }
    function closeDrawer() {
        document.getElementById('sideDrawer').classList.remove('drawer-open');
        document.getElementById('drawerBackdrop').classList.add('hidden');
        document.body.classList.remove('drawer-open');
    }

    document.getElementById('drawerToggleBtn').addEventListener('click', openDrawer);
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

    document.getElementById('openAddTaskModal').addEventListener('click', function() {
        if (window.innerWidth < 1024) closeDrawer();
    });
    document.getElementById('categoryList').addEventListener('click', function(e) {
        if (e.target.closest('button') && window.innerWidth < 1024) closeDrawer();
    });
    window.addEventListener('resize', function() {
        if (window.innerWidth >= 1024) closeDrawer();
    });

    // ─── 모바일 칸반 탭 ───────────────────────────────────────────
    function applyKanbanTabs() {
        const isDesktop = window.innerWidth >= 1024;
        const board = document.getElementById('kanbanBoard');
        if (!board) return;
        const activeTab = board.dataset.activeTab || 'todo';
        board.querySelectorAll('.col-wrap').forEach(col => {
            col.classList.toggle('tab-hidden', !isDesktop && col.dataset.column !== activeTab);
        });
        document.querySelectorAll('.kanban-tab').forEach(tab => {
            tab.classList.toggle('tab-active', tab.dataset.tab === activeTab);
        });
    }

    document.querySelectorAll('.kanban-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.getElementById('kanbanBoard').dataset.activeTab = this.dataset.tab;
            applyKanbanTabs();
        });
    });

    applyKanbanTabs();
    window.addEventListener('resize', applyKanbanTabs);

    const _origRenderBoard = renderBoard;
    window.renderBoard = function() { _origRenderBoard(); applyKanbanTabs(); };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function loadAndRender() {
    try { await dbLoad(); } catch (err) { console.error('[DB] Load failed:', err); }
    renderAll();
}

async function init() {
    const d = localStorage.getItem(LS_DARK_MODE_KEY);
    STATE.darkMode = d !== null ? d !== 'false' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyDarkMode();
    wireEvents(); // 항상 먼저 등록 (dark mode 등 로그인 전에도 동작해야 하는 이벤트)

    // 세션 확인
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        showLoginScreen();
        return;
    }

    USER_ID = session.user.id;
    hideLoginScreen();
    await loadAndRender();
}

// 로그인/로그아웃 상태 변화 감지
// SIGNED_IN: Google OAuth는 페이지 리로드를 동반하므로 init()에서 처리
// SIGNED_OUT: 여기서만 처리
db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
        USER_ID = null;
        STATE.tasks = []; STATE.categories = []; STATE.goals = []; STATE.schedule = [];
        showLoginScreen();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
