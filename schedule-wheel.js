// ═══════════════════════════════════════════════════════════════════════════════
// 24H CIRCULAR SCHEDULE WHEEL
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const SCHEDULE = {
    TOTAL_SLOTS: 144, // 24 hours * 6 (10-min intervals)
    COLORS: [
        { hex: '#6366f1', name: 'Indigo', rgb: 'rgb(99, 102, 241)' },
        { hex: '#ec4899', name: 'Pink', rgb: 'rgb(236, 72, 153)' },
        { hex: '#8b5cf6', name: 'Purple', rgb: 'rgb(139, 92, 246)' },
        { hex: '#3b82f6', name: 'Blue', rgb: 'rgb(59, 130, 246)' },
        { hex: '#10b981', name: 'Emerald', rgb: 'rgb(16, 185, 129)' },
        { hex: '#f59e0b', name: 'Amber', rgb: 'rgb(245, 158, 11)' },
        { hex: '#ef4444', name: 'Red', rgb: 'rgb(239, 68, 68)' },
        { hex: '#06b6d4', name: 'Cyan', rgb: 'rgb(6, 182, 212)' }
    ]
};

// ─── UTILS ────────────────────────────────────────────────────────────────────

function timeToSlot(timeStr) {
    // "08:30" → 51 (8*6 + 3)
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return Math.round(h * 6 + m / 10);
}

function slotToTime(slot) {
    // 51 → "08:30"
    const totalMins = Math.round(slot * 10);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg) * Math.PI / 180;
    return {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad)
    };
}

function slotToAngle(slot) {
    // 0 → -90 (12AM at top), clockwise
    return (slot / SCHEDULE.TOTAL_SLOTS) * 360 - 90;
}

function donutSectorPath(cx, cy, rOuter, rInner, startSlot, endSlot) {
    const startAngle = slotToAngle(startSlot);
    const endAngle = slotToAngle(endSlot);
    const outerStart = polarToCartesian(cx, cy, rOuter, startAngle);
    const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle);
    const innerStart = polarToCartesian(cx, cy, rInner, startAngle);
    const innerEnd = polarToCartesian(cx, cy, rInner, endAngle);
    const large = (endAngle - startAngle) > 180 ? 1 : 0;

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${rInner} ${rInner} 0 ${large} 0 ${innerStart.x} ${innerStart.y}`,
        `Z`
    ].join(' ');
}

// ─── DATA MANAGEMENT ──────────────────────────────────────────────────────────

function getOccupiedSlots(excludeId = null) {
    const occupied = new Set();
    STATE.schedule.forEach(evt => {
        if (evt.id !== excludeId) {
            // Handle overnight events (endSlot > TOTAL_SLOTS)
            if (evt.endSlot > SCHEDULE.TOTAL_SLOTS) {
                // First part: startSlot to end of day
                for (let s = evt.startSlot; s < SCHEDULE.TOTAL_SLOTS; s++) {
                    occupied.add(s);
                }
                // Second part: start of day to endSlot (wrapped)
                for (let s = 0; s < (evt.endSlot % SCHEDULE.TOTAL_SLOTS); s++) {
                    occupied.add(s);
                }
            } else {
                // Normal event within a day
                for (let s = evt.startSlot; s < evt.endSlot; s++) {
                    occupied.add(s);
                }
            }
        }
    });
    return occupied;
}

function isConflict(startSlot, endSlot, excludeId = null) {
    const occupied = getOccupiedSlots(excludeId);
    let slotsToCheck = [];

    // Handle overnight events (endSlot > TOTAL_SLOTS)
    if (endSlot > SCHEDULE.TOTAL_SLOTS) {
        // First part: startSlot to end of day
        for (let s = startSlot; s < SCHEDULE.TOTAL_SLOTS; s++) {
            slotsToCheck.push(s);
        }
        // Second part: start of day to endSlot (wrapped)
        for (let s = 0; s < (endSlot % SCHEDULE.TOTAL_SLOTS); s++) {
            slotsToCheck.push(s);
        }
    } else {
        // Normal event within a day
        for (let s = startSlot; s < endSlot; s++) {
            slotsToCheck.push(s);
        }
    }

    // Check if any slot is occupied
    for (let s of slotsToCheck) {
        if (occupied.has(s)) {
            // 충돌하는 이벤트 찾기
            for (let evt of STATE.schedule) {
                if (evt.id !== excludeId) {
                    // Check if event overlaps with this slot
                    const evtOccupies = (slotNum) => {
                        if (evt.endSlot > SCHEDULE.TOTAL_SLOTS) {
                            // Overnight event
                            return slotNum >= evt.startSlot || slotNum < (evt.endSlot % SCHEDULE.TOTAL_SLOTS);
                        } else {
                            // Normal event
                            return slotNum >= evt.startSlot && slotNum < evt.endSlot;
                        }
                    };
                    if (evtOccupies(s)) {
                        return evt.name;
                    }
                }
            }
        }
    }
    return false;
}

function scheduleAdd(data) {
    const { name, startTime, endTime, color } = data;

    if (!name.trim()) {
        return { ok: false, error: 'Activity name is required.' };
    }

    let startSlot = timeToSlot(startTime);
    let endSlot = timeToSlot(endTime);

    // Handle overnight events (e.g., 21:50 ~ 02:00)
    if (endSlot <= startSlot) {
        endSlot += SCHEDULE.TOTAL_SLOTS;
    }

    if (startSlot >= endSlot) {
        return { ok: false, error: 'End time must be after start time.' };
    }

    const conflict = isConflict(startSlot, endSlot);
    if (conflict) {
        return { ok: false, error: `This time slot overlaps with: ${conflict}` };
    }

    const id = 'sched_' + Date.now();
    STATE.schedule.push({
        id,
        name: name.trim(),
        startSlot,
        endSlot,
        color: color || SCHEDULE.COLORS[0].hex
    });

    dbSyncSchedule();
    return { ok: true };
}

function scheduleEdit(id, data) {
    const { name, startTime, endTime, color } = data;
    const event = STATE.schedule.find(e => e.id === id);

    if (!event) return { ok: false, error: 'Event not found.' };
    if (!name.trim()) return { ok: false, error: 'Activity name is required.' };

    let startSlot = timeToSlot(startTime);
    let endSlot = timeToSlot(endTime);

    // Handle overnight events (e.g., 21:50 ~ 02:00)
    if (endSlot <= startSlot) {
        endSlot += SCHEDULE.TOTAL_SLOTS;
    }

    if (startSlot >= endSlot) {
        return { ok: false, error: 'End time must be after start time.' };
    }

    const conflict = isConflict(startSlot, endSlot, id);
    if (conflict) {
        return { ok: false, error: `This time slot overlaps with: ${conflict}` };
    }

    event.name = name.trim();
    event.startSlot = startSlot;
    event.endSlot = endSlot;
    event.color = color || event.color;

    dbSyncSchedule();
    return { ok: true };
}

function scheduleDelete(id) {
    STATE.schedule = STATE.schedule.filter(e => e.id !== id);
    dbSyncSchedule();
}

// ─── RENDERING ────────────────────────────────────────────────────────────────

function renderWheel() {
    const svg = document.getElementById('scheduleWheel');
    if (!svg) return;

    const cx = 200, cy = 200;
    const rOuter = 160, rInner = 50;
    const rLabel = 178;

    let html = '';

    // Background circle (light gray)
    html += `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="#e2e8f0" stroke-width="2" class="dark:stroke-slate-700"/>`;
    html += `<circle cx="${cx}" cy="${cy}" r="${rInner}" fill="none" stroke="#e2e8f0" stroke-width="2" class="dark:stroke-slate-700"/>`;

    // Hour ticks and labels (every 2 hours)
    for (let h = 0; h < 24; h++) {
        const slot = h * 6;
        const angle = slotToAngle(slot);
        const isMainTick = h % 2 === 0;

        if (isMainTick) {
            // Hour label
            const labelPos = polarToCartesian(cx, cy, rLabel + 15, angle);
            const hour12 = h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h-12}PM`;
            html += `<text x="${labelPos.x}" y="${labelPos.y}" text-anchor="middle" dy="0.3em" font-size="12" font-weight="600" fill="#64748b" class="dark:fill-slate-400">${hour12}</text>`;
        }
    }

    // Events (sectors) - continuous even for overnight events
    STATE.schedule.forEach(evt => {
        const startSlot = evt.startSlot;
        const endSlot = evt.endSlot;
        const slotSpan = endSlot - startSlot;

        const path = donutSectorPath(cx, cy, rOuter, rInner, startSlot, endSlot);

        // Sector fill - one continuous path
        html += `<path d="${path}" fill="${evt.color}" opacity="0.8" stroke="white" stroke-width="1.5" class="schedule-sector cursor-pointer hover:opacity-100 transition-opacity" data-event-id="${evt.id}"/>`;

        // Event label (if sector large enough)
        if (slotSpan >= 3) {
            const midSlot = (startSlot + endSlot) / 2;
            const midAngle = slotToAngle(midSlot);
            const rMid = (rOuter + rInner) / 2;
            const textPos = polarToCartesian(cx, cy, rMid, midAngle);
            const textSize = slotSpan > 6 ? 12 : 10;

            html += `<text x="${textPos.x}" y="${textPos.y}" text-anchor="middle" dy="0.3em" font-size="${textSize}" font-weight="600" fill="white" text-anchor="middle" pointer-events="none" class="select-none">${evt.name.substring(0, 10)}</text>`;
        }
    });

    svg.innerHTML = html;

    // Add sector click handlers
    svg.querySelectorAll('.schedule-sector').forEach(sector => {
        sector.addEventListener('click', (e) => {
            e.stopPropagation();
            const eventId = sector.dataset.eventId;
            openEditForm(eventId);
        });
    });
}

function renderEventList() {
    const list = document.getElementById('schedEventList');
    if (!list) return;

    if (STATE.schedule.length === 0) {
        list.innerHTML = '<p class="text-sm text-slate-400 dark:text-slate-500">No events yet. Add one above!</p>';
        document.getElementById('seeAllBtn').classList.add('hidden');
        return;
    }

    const sorted = [...STATE.schedule].sort((a, b) => a.startSlot - b.startSlot);
    const displayCount = showAllEvents ? sorted.length : 2;
    const displayed = sorted.slice(0, displayCount);

    list.innerHTML = displayed.map(evt => `
        <div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/30 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all group">
            <div class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${evt.color}"></div>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-slate-800 dark:text-slate-100">${esc(evt.name)}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400">${slotToTime(evt.startSlot)} ~ ${slotToTime(evt.endSlot)}</div>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 text-xs" onclick="openEditForm('${esc(evt.id)}')" title="Edit">✎</button>
                <button class="p-1 text-slate-500 hover:text-red-600 dark:hover:text-red-400 text-xs" onclick="scheduleDelete('${esc(evt.id)}'); renderScheduleAll();" title="Delete">×</button>
            </div>
        </div>
    `).join('');

    // Show/hide "See all" button
    const seeAllBtn = document.getElementById('seeAllBtn');
    if (sorted.length > 2) {
        seeAllBtn.classList.remove('hidden');
        seeAllBtn.textContent = showAllEvents ? 'Hide' : 'See all';
    } else {
        seeAllBtn.classList.add('hidden');
    }
}

function renderScheduleAll() {
    renderWheel();
    renderEventList();
    updateCurrentActivityDisplay();
}

// ─── FORM ─────────────────────────────────────────────────────────────────────

let editingEventId = null;
let showAllEvents = false;

function openAddForm() {
    editingEventId = null;
    document.getElementById('schedName').value = '';
    document.getElementById('schedStartHour').value = '09';
    document.getElementById('schedStartMin').value = '00';
    document.getElementById('schedEndHour').value = '10';
    document.getElementById('schedEndMin').value = '00';
    const errorEl = document.getElementById('schedError');
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    document.getElementById('schedSubmit').textContent = 'Add Event';
    document.getElementById('schedSubmit').classList.add('btn-primary');
    document.getElementById('schedCancel').style.display = 'none';
    document.getElementById('schedName').focus();
}

function openEditForm(eventId) {
    editingEventId = eventId;
    const evt = STATE.schedule.find(e => e.id === eventId);
    if (!evt) return;

    const startTime = slotToTime(evt.startSlot).split(':');

    // Handle overnight events: convert slot > 144 back to 0-143 range for display
    let displayEndSlot = evt.endSlot;
    if (displayEndSlot > SCHEDULE.TOTAL_SLOTS) {
        displayEndSlot = displayEndSlot % SCHEDULE.TOTAL_SLOTS;
    }
    const endTime = slotToTime(displayEndSlot).split(':');

    document.getElementById('schedName').value = evt.name;
    document.getElementById('schedStartHour').value = startTime[0];
    document.getElementById('schedStartMin').value = startTime[1];
    document.getElementById('schedEndHour').value = endTime[0];
    document.getElementById('schedEndMin').value = endTime[1];

    // Set selected color
    document.querySelectorAll('#colorPicker [data-color]').forEach(btn => {
        btn.classList.toggle('ring-2', btn.dataset.color === evt.color);
    });
    document.querySelector('[data-color-input]').value = evt.color;

    document.getElementById('schedError').textContent = '';
    document.getElementById('schedSubmit').textContent = 'Save Changes';
    document.getElementById('schedSubmit').classList.remove('btn-primary');
    document.getElementById('schedSubmit').classList.add('bg-amber-100', 'dark:bg-amber-900/40', 'text-amber-600', 'dark:text-amber-400');
    document.getElementById('schedCancel').style.display = 'inline-block';
}

function submitForm() {
    const name = document.getElementById('schedName').value;
    const startTime = document.getElementById('schedStartHour').value + ':' + document.getElementById('schedStartMin').value;
    const endTime = document.getElementById('schedEndHour').value + ':' + document.getElementById('schedEndMin').value;
    const color = document.querySelector('[data-color-input]').value;
    const errorEl = document.getElementById('schedError');

    let result;
    if (editingEventId) {
        result = scheduleEdit(editingEventId, { name, startTime, endTime, color });
    } else {
        result = scheduleAdd({ name, startTime, endTime, color });
    }

    if (!result.ok) {
        errorEl.textContent = result.error;
        errorEl.style.display = 'block';
        return;
    }

    errorEl.textContent = '';
    errorEl.style.display = 'none';
    renderScheduleAll();
    openAddForm();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function initScheduleWheel() {
    // Color picker
    const colorPicker = document.getElementById('colorPicker');
    if (colorPicker) {
        const colorInput = document.querySelector('[data-color-input]');

        colorPicker.innerHTML = SCHEDULE.COLORS.map(c => `
            <button type="button" data-color="${c.hex}"
                    class="w-6 h-6 rounded-full border-2 border-transparent hover:border-slate-300 dark:hover:border-slate-600 transition-all flex-shrink-0"
                    style="background-color: ${c.hex}"
                    onclick="document.querySelector('[data-color-input]').value = this.dataset.color; this.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('ring-2')); this.classList.add('ring-2');"
                    title="${c.name}"></button>
        `).join('');

        // Set first color as default
        colorInput.value = SCHEDULE.COLORS[0].hex;
    }

    // Form buttons
    document.getElementById('schedSubmit').addEventListener('click', submitForm);
    document.getElementById('schedCancel').addEventListener('click', openAddForm);

    // Time inputs: ensure step=600 (10 min)
    const timeInputs = document.querySelectorAll('#schedStart, #schedEnd');
    timeInputs.forEach(input => {
        input.step = '600'; // 10 minutes in seconds
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitForm();
        });
    });

    // Name input
    document.getElementById('schedName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitForm();
    });

    // Modal show: render wheel
    openAddForm();
    renderScheduleAll();

    // "See all" button toggle
    const seeAllBtn = document.getElementById('seeAllBtn');
    if (seeAllBtn) {
        seeAllBtn.addEventListener('click', () => {
            showAllEvents = !showAllEvents;
            renderEventList();
        });
    }
}

// ─── CURRENT ACTIVITY DISPLAY ─────────────────────────────────────────

function getCurrentActivity() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentSlot = Math.floor(hours * 6 + minutes / 10);

    for (let evt of STATE.schedule) {
        if (evt.endSlot > SCHEDULE.TOTAL_SLOTS) {
            // Overnight event
            const inFirstPart = currentSlot >= evt.startSlot;
            const inSecondPart = currentSlot < (evt.endSlot % SCHEDULE.TOTAL_SLOTS);
            if (inFirstPart || inSecondPart) {
                return evt.name;
            }
        } else {
            // Normal event
            if (currentSlot >= evt.startSlot && currentSlot < evt.endSlot) {
                return evt.name;
            }
        }
    }
    return null;
}

function updateCurrentActivityDisplay() {
    const display = document.getElementById('currentActivityDisplay');
    if (!display) return;

    const activity = getCurrentActivity();
    if (activity) {
        display.textContent = `Now is the time to do ${activity}`;
        display.style.removeProperty('display');
    } else {
        display.textContent = '';
        display.style.removeProperty('display');
    }
}

// Expose globally for onclick handlers
window.openEditForm = openEditForm;
window.scheduleDelete = scheduleDelete;
window.renderScheduleAll = renderScheduleAll;
window.updateCurrentActivityDisplay = updateCurrentActivityDisplay;

// Start updating current activity display every second
setInterval(() => {
    updateCurrentActivityDisplay();
}, 1000);
