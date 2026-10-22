/* =========================================================
   TERC Schedule Portal
   Version : 1.0.0
   Built   : 2026-09-08
   Author  : Steven L. (on behalf of TERC)
   Note    : Created and designed by humans, tool-assisted by AI
   ========================================================= */
const APP_VERSION = '1.0.0';
const APP_BUILD = '2026-09-08';

const ScheduleApp = (() => {
  const state = {
    search: '',
    category: 'all',
    viewMode: 'subjects', // 'subjects' | 'tutors'
    availableToday: true,
    get todayOnly() { return this.availableToday; },
    set todayOnly(val) { this.availableToday = Boolean(val); },
    selectedSubject: null,
    selectedTutor: null
  };

  // Tracks the element that opened the modal so focus returns on close (WCAG 2.4.3)
  let _lastFocusedElement = null;

  // Focus trap: keep Tab/Shift+Tab inside `container` while modal is open (WCAG 2.1.2)
  function trapFocus(container) {
    const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => [...container.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[aria-hidden="true"]'));

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }

    container.addEventListener('keydown', onKeydown);
    return () => container.removeEventListener('keydown', onKeydown);
  }

  let _removeTrap = null; // cleanup handle for active focus trap

  function formatScheduleLines(rawHours) {
    if (!rawHours || rawHours === 'Closed') return ['Closed'];
    const parts = String(rawHours).split(/[,|]/).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts : [rawHours];
  }

  // --- Calendar Integration Helpers ---
  function isWeekdayPassed(weekdayName, timeRangeStr = null) {
    const today = new Date();
    const currentDayIdx = today.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    const targetDayIdx = DataStore.ALL_DAYS.indexOf(weekdayName);

    if (targetDayIdx === -1) return false;

    // Past weekday earlier in the week (e.g. Monday when today is Wednesday)
    if (targetDayIdx < currentDayIdx) return true;

    // Weekend (Sunday = 0, Saturday = 6) - all weekday shifts for the work week have passed
    if (currentDayIdx === 0 || currentDayIdx === 6) return true;

    // If it's today, check if shift windows have already ended
    if (targetDayIdx === currentDayIdx && timeRangeStr && timeRangeStr !== 'Closed') {
      const wins = DataStore.parseTimeRange(timeRangeStr);
      if (wins.length > 0) {
        const nowMinutes = today.getHours() * 60 + today.getMinutes();
        const lastWin = wins[wins.length - 1];
        if (nowMinutes >= lastWin.end) return true; // all shifts ended today
      }
    }

    return false;
  }

  function getTargetDateForWeekday(weekdayName) {
    const today = new Date();
    const dayIndex = DataStore.ALL_DAYS.indexOf(weekdayName);
    if (dayIndex === -1) return today;

    const currentDay = today.getDay();
    let diff = dayIndex - currentDay;
    if (diff < 0) diff += 7; // Target upcoming day in current 7-day cycle

    const target = new Date(today);
    target.setDate(today.getDate() + diff);
    return target;
  }

  function formatIcsDateTime(date, minutes) {
    const d = new Date(date);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  }

  function openGoogleCalendarShift(title, dayName, timeRangeStr) {
    const targetDate = getTargetDateForWeekday(dayName);
    const windows = DataStore.parseTimeRange(timeRangeStr);
    if (!windows.length) return;
    const win = windows[0];

    const startIso = formatIcsDateTime(targetDate, win.start);
    const endIso = formatIcsDateTime(targetDate, win.end);

    const eventTitle = encodeURIComponent(`${title} Tutoring @ TERC`);
    const details = encodeURIComponent(`Tutoring Session at Mt. SAC Technology Education Resource Center (TERC).\nPhone: (909) 274-6118\nWebsite: https://www.mtsac.edu/tech-health/terc/`);
    const location = encodeURIComponent('Mt. SAC TERC · Bldg 26D Room 3411');

    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startIso}/${endIso}&details=${details}&location=${location}`;
    window.open(gcalUrl, '_blank', 'noopener,noreferrer');
  }

  function downloadIcsEvents(filename, events) {
    if (!events || !events.length) return;

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Mt. San Antonio College//TERC Schedule Portal//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    const nowIso = formatIcsDateTime(new Date(), new Date().getHours() * 60 + new Date().getMinutes()) + 'Z';

    events.forEach(evt => {
      icsContent.push(
        'BEGIN:VEVENT',
        `UID:${Date.now()}-${Math.random().toString(36).slice(2, 9)}@mtsac.edu`,
        `DTSTAMP:${nowIso}`,
        `DTSTART:${evt.startIso}`,
        `DTEND:${evt.endIso}`,
        `SUMMARY:${evt.title}`,
        'LOCATION:Mt. SAC TERC · Bldg 26D Room 3411',
        'DESCRIPTION:TERC Learning Center (909) 274-6118 · Mt. San Antonio College',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });

    icsContent.push('END:VCALENDAR');
    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function renderMatrixCell(sched, isOverview = false, dayName = null, calContext = null) {
    if (!sched || sched.trim() === '' || sched === 'Closed') {
      return '<span class="t-closed">Closed</span>';
    }

    const intervals = String(sched).split(/[,|]/).map(s => s.trim()).filter(Boolean);
    if (!intervals.length) return '<span class="t-closed">Closed</span>';

    // On at-a-glance cards, collapse split shifts into overall span (e.g. 9:15 AM - 6:00 PM) with a clean (split) note
    if (isOverview && intervals.length > 1) {
      const firstParts = intervals[0].split(/[-–—to]/i);
      const lastParts = intervals[intervals.length - 1].split(/[-–—to]/i);
      const startStr = firstParts.length > 1 ? firstParts.slice(0, firstParts.length - 1).join('-').trim() : intervals[0];
      const endStr = lastParts[lastParts.length - 1].trim();

      return `
        <div class="time-block">
          <span class="t-start">${DataStore.escapeHtml(startStr)}</span>
          <span class="t-dash">–</span>
          <span class="t-end">${DataStore.escapeHtml(endStr)}</span>
          <span class="t-split-note">(split)</span>
        </div>
      `;
    }

    return intervals.map((interval, idx) => {
      const parts = interval.split(/[-–—to]/i);
      const isSplit = intervals.length > 1;
      const startStr = parts.length > 1 ? parts.slice(0, parts.length - 1).join('-').trim() : interval;
      const endStr = parts.length > 1 ? parts[parts.length - 1].trim() : '';

      if (parts.length < 2) {
        return `<div class="modal-time-pill"><span class="t-start">${DataStore.escapeHtml(interval)}</span></div>`;
      }
      return `
        <div class="modal-time-pill ${isSplit ? 'is-split-shift' : ''}">
          <span class="t-start">${DataStore.escapeHtml(startStr)}</span>
          <span class="t-dash">–</span>
          <span class="t-end">${DataStore.escapeHtml(endStr)}</span>
        </div>
      `;
    }).join('');
  }

  // --- Sidebar Component (Desktop Sticky / Mobile Modal) ---
  function renderSidebarHtml() {
    const hours = DataStore.getServiceHours();
    const inPersonRaw = hours['TERC'] || hours['terc'] || hours['In-Person Desk Hours'] || hours['in-person desk hours'] || hours['In-Person'] || '';
    const zoomRaw = hours['Zoom'] || hours['zoom'] || hours['Online Zoom Support Hours'] || hours['online zoom support hours'] || hours['Zoom Support'] || '';
    const inPersonLines = formatScheduleLines(inPersonRaw);
    const zoomLines = formatScheduleLines(zoomRaw);

    const today = DataStore.getTodayName();
    const tutors = DataStore.getTutors();

    // Collect all tutors on duty today across all subjects
    const onDutyTutors = [];
    tutors.forEach(t => {
      const shift = t.schedule[today];
      if (shift) {
        const evalRes = DataStore.evaluateTimeWindows(shift, today);
        onDutyTutors.push({
          fullName: t.fullName,
          firstName: DataStore.getFirstName(t.fullName),
          shortName: DataStore.getShortName(t.fullName),
          shift: shift,
          statusType: evalRes.statusType,
          statusText: evalRes.statusText,
          isOpenNow: evalRes.isOpenNow,
          isUpcoming: evalRes.isUpcoming,
          evalRes
        });
      }
    });

    onDutyTutors.sort((a, b) => {
      if (a.isOpenNow && !b.isOpenNow) return -1;
      if (!a.isOpenNow && b.isOpenNow) return 1;
      if (a.isUpcoming && !b.isUpcoming) return -1;
      if (!a.isUpcoming && b.isUpcoming) return 1;
      return a.firstName.localeCompare(b.firstName);
    });

    const tutorListHtml = onDutyTutors.length > 0
      ? onDutyTutors.map(t => {
        let statusText = 'Shift Concluded';
        if (t.isOpenNow) {
          statusText = t.evalRes.currentWindow ? `On shift · until ${t.evalRes.currentWindow.endStr}` : 'On Shift';
        } else if (t.isUpcoming) {
          statusText = t.evalRes.nextWindow ? `Available at ${t.evalRes.nextWindow.startStr}` : 'Later Today';
        }

        return `
            <button
              type="button"
              class="sidebar-tutor-btn"
              data-tutor-name="${DataStore.escapeHtml(t.fullName)}"
              aria-label="View profile for ${DataStore.escapeHtml(t.fullName)}"
            >
              <span class="sidebar-tutor-name">${DataStore.escapeHtml(t.shortName)}</span>
              <span class="status-badge ${t.statusType}">
                ${DataStore.escapeHtml(statusText)}
              </span>
            </button>
          `;
      }).join('')
      : `<div style="font-size: 0.84rem; color: var(--text-muted); padding: 6px 0;">No tutors scheduled for today (${today}).</div>`;

    return `
      <div class="sidebar-box">
        <div class="sidebar-badge-wrap">
          <img src="terc-badge.png" alt="Mt. SAC TERC" class="sidebar-badge-img" />
        </div>
        <div class="sidebar-heading-brand">TERC Learning Center</div>
        <div class="sidebar-sub-brand">Mt. San Antonio College</div>

        <hr class="sidebar-hr" />

        <div class="sidebar-title">Facility Information</div>

        <div class="sidebar-row">
          <span class="sidebar-lbl">Location:</span>
          <span class="sidebar-val">
            <a href="https://campusmap.mtsac.edu/?s%2Fterc=&id=811#!m/761568?share" target="_blank" rel="noopener noreferrer">Bldg 26D · Room 3411</a>
          </span>
        </div>

        <div class="sidebar-row">
          <span class="sidebar-lbl">Phone:</span>
          <span class="sidebar-val">
            <a href="tel:9092746118">(909) 274-6118</a>
          </span>
        </div>

        <div class="sidebar-row" style="margin-top: 4px;">
          <span class="sidebar-lbl">In-Person:</span>
          <span class="sidebar-val" style="display: flex; flex-direction: column; gap: 2px;">
            ${inPersonLines.map(l => `<span>${DataStore.escapeHtml(l)}</span>`).join('')}
          </span>
        </div>

        <div class="sidebar-row" style="margin-top: 4px;">
          <span class="sidebar-lbl">Zoom Support:</span>
          <span class="sidebar-val" style="display: flex; flex-direction: column; gap: 2px;">
            ${zoomLines.map(l => `<span>${DataStore.escapeHtml(l)}</span>`).join('')}
          </span>
        </div>

        <div class="sidebar-btn-group">
          <a href="https://www.mtsac.edu/tech-health/terc/" target="_blank" rel="noopener noreferrer" class="sidebar-action-btn sidebar-action-primary" style="grid-column: 1 / -1;">Official TERC Website</a>
          <a href="tel:9092746118" class="sidebar-action-btn">Call Desk</a>
          <a href="https://campusmap.mtsac.edu/?s%2Fterc=&id=811#!m/761568?share" target="_blank" rel="noopener noreferrer" class="sidebar-action-btn">Campus Map</a>
        </div>
      </div>

      <div class="sidebar-box">
        <div class="sidebar-title" style="display: flex; justify-content: space-between; align-items: center;">
          <span>Today's Tutor Roster</span>
          <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 500;">${onDutyTutors.length} on duty</span>
        </div>
        <div class="sidebar-tutor-scroll">
          ${tutorListHtml}
        </div>
      </div>
    `;
  }

  // --- Filter & Search Component ---
  function renderFilterHtml(totalCount, visibleCount) {
    const categories = ['all', ...DataStore.getCategories()];

    const searchPlaceholder = state.viewMode === 'tutors'
      ? 'Search tutors by name, course (e.g. MATH 180), or subject...'
      : 'Search subjects, courses (e.g. MATH 180), or tutors...';

    return `
      <div class="filter-panel">
        <div class="search-field">
          <input
            type="text"
            id="search-input"
            placeholder="${searchPlaceholder}"
            value="${DataStore.escapeHtml(state.search)}"
            aria-label="Search schedule"
          />
          <button type="button" id="search-clear-btn" class="search-clear-btn ${state.search ? 'visible' : ''}" aria-label="Clear search">✕</button>
        </div>

        <div class="filter-controls-row">
          <div class="filter-primary-group">
            <!-- 1. Segmented View Switcher (Subjects vs Tutors) -->
            <div class="view-mode-switch" role="tablist" aria-label="View Mode">
              <button
                type="button"
                class="view-mode-btn ${state.viewMode === 'subjects' ? 'active' : ''}"
                data-view="subjects"
                role="tab"
                aria-selected="${state.viewMode === 'subjects'}"
              >
                Subjects
              </button>
              <button
                type="button"
                class="view-mode-btn ${state.viewMode === 'tutors' ? 'active' : ''}"
                data-view="tutors"
                role="tab"
                aria-selected="${state.viewMode === 'tutors'}"
              >
                Tutors
              </button>
            </div>

            <div class="filter-divider" aria-hidden="true"></div>

            <!-- 2. On/Off Toggle Switch (Available Today) -->
            <button
              type="button"
              id="today-toggle-btn"
              class="today-toggle-control ${state.availableToday ? 'active' : ''}"
              role="switch"
              aria-checked="${state.availableToday}"
              aria-label="Filter to available today only"
            >
              <span class="toggle-switch-track">
                <span class="toggle-switch-knob"></span>
              </span>
              <span class="toggle-label">Available Today</span>
            </button>
          </div>

          <div class="filter-divider filter-divider-secondary" aria-hidden="true"></div>

          <!-- 3. Category Filter Chips (Department Tags) -->
          <div class="dept-chips-wrapper" role="tablist" aria-label="Department Filter">
            ${categories.map(cat => {
      const label = cat === 'all' ? 'All' : cat;
      const isActive = state.category === cat;
      return `
                <button
                  type="button"
                  class="dept-tag ${isActive ? 'active' : ''}"
                  data-category="${DataStore.escapeHtml(cat)}"
                  role="tab"
                  aria-selected="${isActive}"
                >
                  ${DataStore.escapeHtml(label)}
                </button>
              `;
    }).join('')}
          </div>
        </div>

        <div class="filter-summary-row">
          <span id="filter-count-stat" aria-live="polite" aria-atomic="true">Showing <strong>${visibleCount}</strong> of <strong>${totalCount}</strong> subjects</span>
        </div>
      </div>
    `;
  }

  // --- Subject Card Component ---
  function renderSubjectCard(subject, today) {
    const tutorAvail = DataStore.getSubjectTutorAvailability(subject.code, today);
    const liveStatus = DataStore.getSubjectLiveStatus(subject.code, today);

    // Exact, informative availability status badge text
    let statusBadgeText = 'Unavailable Today';
    if (liveStatus.isOpenNow && liveStatus.currentWindow) {
      statusBadgeText = `Available until ${liveStatus.currentWindow.endStr}`;
    } else if (liveStatus.isUpcoming && liveStatus.nextWindow) {
      statusBadgeText = `Available at ${liveStatus.nextWindow.startStr}`;
    } else if (liveStatus.statusType === 'break' && liveStatus.nextWindow) {
      statusBadgeText = `Break · Next ${liveStatus.nextWindow.startStr}`;
    } else if (liveStatus.isEnded) {
      statusBadgeText = 'Tutoring Concluded';
    } else if (liveStatus.nextAvailable) {
      statusBadgeText = liveStatus.nextAvailable.label;
    }

    const searchQuery = (state.search || '').toLowerCase().trim();
    const isAllDaysMode = !state.availableToday;
    const allAssigned = tutorAvail.all || [];
    const onDutyList = tutorAvail.onDuty || [];

    // When in "All Days" mode, show all assigned tutors; when in "Available Today", show only today's tutors
    const targetTutorList = isAllDaysMode ? allAssigned : onDutyList;
    const rosterTitle = isAllDaysMode ? "Weekly Tutors:" : "Today's Tutors:";
    const rosterCountText = isAllDaysMode ? `${targetTutorList.length} assigned` : `${targetTutorList.length} scheduled`;

    // Sort tutors: in now first, upcoming second, then alphabetical
    const sortedTutors = [...targetTutorList].map(t => {
      const shift = t.schedule ? t.schedule[today] : t.shift;
      const timeEval = shift ? DataStore.evaluateTimeWindows(shift, today) : null;
      return {
        fullName: t.fullName,
        firstName: DataStore.getFirstName(t.fullName),
        shortName: DataStore.getShortName(t.fullName),
        courses: t.courses || [],
        schedule: t.schedule || {},
        shift,
        timeEval
      };
    }).sort((a, b) => {
      const aNow = a.timeEval && a.timeEval.isOpenNow;
      const bNow = b.timeEval && b.timeEval.isOpenNow;
      if (aNow && !bNow) return -1;
      if (!aNow && bNow) return 1;

      const aUp = a.timeEval && a.timeEval.isUpcoming;
      const bUp = b.timeEval && b.timeEval.isUpcoming;
      if (aUp && !bUp) return -1;
      if (!aUp && bUp) return 1;

      if (searchQuery) {
        const aMatches = a.courses.some(c => c.toLowerCase().includes(searchQuery));
        const bMatches = b.courses.some(c => c.toLowerCase().includes(searchQuery));
        if (aMatches && !bMatches) return -1;
        if (!aMatches && bMatches) return 1;
      }
      return a.firstName.localeCompare(b.firstName);
    });

    let tutorsHtml = '';
    if (sortedTutors.length > 0) {
      tutorsHtml = sortedTutors.map(t => {
        const isOpenNow = t.timeEval && t.timeEval.isOpenNow;
        const isUpcoming = t.timeEval && t.timeEval.isUpcoming;
        const shiftClass = isOpenNow ? 'active-shift' : (isUpcoming ? 'upcoming-shift' : '');

        let timeLabel = '';
        if (isOpenNow && t.timeEval.currentWindow) {
          timeLabel = `until ${t.timeEval.currentWindow.endStr}`;
        } else if (isUpcoming && t.timeEval.nextWindow) {
          timeLabel = `at ${t.timeEval.nextWindow.startStr}`;
        } else if (t.shift) {
          timeLabel = t.shift;
        } else {
          // Off duty today: show the days they work this week
          const activeDays = DataStore.WEEKDAYS
            .filter(d => t.schedule && t.schedule[d])
            .map(d => d.slice(0, 3));
          timeLabel = activeDays.length ? activeDays.join(', ') : 'Weekly';
        }

        const displayName = isAllDaysMode ? t.shortName : t.firstName;

        return `
          <button
            type="button"
            class="tutor-chip ${shiftClass}"
            data-tutor-name="${DataStore.escapeHtml(t.fullName)}"
            title="Click to view ${DataStore.escapeHtml(t.fullName)} courses and schedule"
          >
            <strong>${DataStore.escapeHtml(displayName)}</strong>
            <span class="tutor-time-tag">(${DataStore.escapeHtml(timeLabel)})</span>
          </button>
        `;
      }).join('');
    } else {
      tutorsHtml = `<span class="no-tutors-msg">No tutors scheduled</span>`;
    }

    // 5-Day Schedule Matrix Strip (Cards use collapsed overview mode)
    const matrixColsHtml = DataStore.WEEKDAYS.map(day => {
      const isDayToday = day === today;
      return `
        <div class="matrix-col ${isDayToday ? 'active-day' : ''}">
          <span class="matrix-header-day">${day.slice(0, 3)}</span>
          <div class="matrix-hours-val">
            ${renderMatrixCell(subject.schedule[day], true)}
          </div>
        </div>
      `;
    }).join('');

    // Sample courses with smart search highlight
    const sampleCourses = (subject.courses || []).slice(0, 4);
    const extraCoursesCount = (subject.courses || []).length - sampleCourses.length;

    let cardStatusClass = 'status-unavailable';
    if (liveStatus.isOpenNow) {
      cardStatusClass = 'status-available';
    } else if (liveStatus.isUpcoming) {
      cardStatusClass = 'status-upcoming';
    }

    return `
      <article
        class="schedule-card ${cardStatusClass}"
        data-code="${DataStore.escapeHtml(subject.code)}"
        aria-label="${DataStore.escapeHtml(subject.code)} – ${DataStore.escapeHtml(subject.name || '')} schedule"
      >
        <!-- Tier 1: Bold Subject Header -->
        <div class="card-top-header">
          <div class="card-code-badge-row">
            <div class="subject-code-lg">${DataStore.escapeHtml(subject.code)}</div>
            <div class="card-status-cell ${liveStatus.statusType}">
              ${DataStore.escapeHtml(statusBadgeText)}
            </div>
          </div>
          <div class="subject-name-sub">${DataStore.escapeHtml(subject.name || subject.fullName || subject.code)}</div>
        </div>

        <!-- Tier 2: Tutor Roster (Today or Weekly Fallback) -->
        <div class="card-tutor-roster-row">
          <div class="roster-label-row">
            <span class="roster-title">${rosterTitle}</span>
            <span class="roster-count">${rosterCountText}</span>
          </div>
          <div class="tutor-chips-wrap">
            ${tutorsHtml}
          </div>
        </div>

        <!-- Tier 3: 5-Day Weekly Matrix -->
        <div class="matrix-strip">
          ${matrixColsHtml}
        </div>

        <!-- Tier 4: Bottom Course Summary & Details Trigger -->
        <div class="card-bottom-bar">
          <div class="course-tags-preview">
            ${sampleCourses.map(c => {
      const isMatch = searchQuery && c.toLowerCase().includes(searchQuery);
      return `<span class="course-tag ${isMatch ? 'matched-search' : ''}" data-course="${DataStore.escapeHtml(c)}">${DataStore.escapeHtml(c)}</span>`;
    }).join('')}
            ${extraCoursesCount > 0 ? `<span class="course-tag">+${extraCoursesCount} more</span>` : ''}
          </div>
          <button type="button" class="card-action-cue" aria-label="View full schedule details for ${DataStore.escapeHtml(subject.code)}">Details →</button>
        </div>
      </article>
    `;
  }

  // --- Tutor Card Component ---
  function renderTutorCard(tutor, today) {
    const shift = tutor.schedule[today];
    const evalRes = shift ? DataStore.evaluateTimeWindows(shift, today) : null;
    const shortName = DataStore.getShortName(tutor.fullName);
    const searchQuery = (state.search || '').toLowerCase().trim();

    let cardStatusClass = 'status-unavailable';
    let statusBadgeText = 'Off Duty Today';

    if (evalRes && evalRes.isOpenNow) {
      cardStatusClass = 'status-available';
      statusBadgeText = evalRes.currentWindow ? `Available until ${evalRes.currentWindow.endStr}` : 'On Shift Now';
    } else if (evalRes && evalRes.isUpcoming) {
      cardStatusClass = 'status-upcoming';
      statusBadgeText = evalRes.nextWindow ? `Available at ${evalRes.nextWindow.startStr}` : 'Later Today';
    } else if (evalRes && evalRes.isEnded) {
      cardStatusClass = 'status-unavailable';
      statusBadgeText = 'Shift Concluded';
    } else {
      // Find next weekday shift
      const currentDayIdx = DataStore.ALL_DAYS.indexOf(today);
      for (let i = 1; i <= 6; i++) {
        const checkDay = DataStore.ALL_DAYS[(currentDayIdx + i) % 7];
        if (DataStore.WEEKDAYS.includes(checkDay) && tutor.schedule[checkDay]) {
          const firstShift = String(tutor.schedule[checkDay]).split(/[,|]/)[0].trim();
          const startStr = firstShift.split(/[-–—to]/i)[0].trim();
          statusBadgeText = `Next: ${checkDay.slice(0, 3)} ${startStr}`;
          break;
        }
      }
    }

    const matrixColsHtml = DataStore.WEEKDAYS.map(day => {
      const isDayToday = day === today;
      return `
        <div class="matrix-col ${isDayToday ? 'active-day' : ''}">
          <span class="matrix-header-day">${day.slice(0, 3)}</span>
          <div class="matrix-hours-val">
            ${renderMatrixCell(tutor.schedule[day], true)}
          </div>
        </div>
      `;
    }).join('');

    const sampleCourses = (tutor.courses || []).slice(0, 5);
    const extraCoursesCount = (tutor.courses || []).length - sampleCourses.length;

    return `
      <article
        class="schedule-card ${cardStatusClass}"
        data-tutor-name="${DataStore.escapeHtml(tutor.fullName)}"
        aria-label="${DataStore.escapeHtml(tutor.fullName)}, Academic Tutor – ${DataStore.escapeHtml(statusBadgeText)}"
      >
        <!-- Tier 1: Bold Tutor Header -->
        <div class="card-top-header">
          <div class="card-code-badge-row">
            <div class="subject-code-lg">${DataStore.escapeHtml(shortName)}</div>
            <div class="card-status-cell ${evalRes ? evalRes.statusType : 'unavailable'}">
              ${DataStore.escapeHtml(statusBadgeText)}
            </div>
          </div>
          <div class="subject-name-sub">${DataStore.escapeHtml(tutor.fullName)} · Academic Tutor</div>
        </div>

        <!-- Tier 2: Subjects Supported -->
        <div class="card-tutor-roster-row">
          <div class="roster-label-row">
            <span class="roster-title">SUBJECTS COVERED:</span>
            <span class="roster-count">${(tutor.subjects || []).length} assigned</span>
          </div>
          <div class="tutor-chips-wrap">
            ${(tutor.subjects || []).map(s => `
              <span class="tutor-chip" style="cursor: default;">
                <strong>${DataStore.escapeHtml(s)}</strong>
              </span>
            `).join('')}
          </div>
        </div>

        <!-- Tier 3: 5-Day Weekly Matrix -->
        <div class="matrix-strip">
          ${matrixColsHtml}
        </div>

        <!-- Tier 4: Bottom Course Summary & Details Trigger -->
        <div class="card-bottom-bar">
          <div class="course-tags-preview">
            ${sampleCourses.map(c => {
      const isMatch = searchQuery && c.toLowerCase().includes(searchQuery);
      return `<span class="course-tag ${isMatch ? 'matched-search' : ''}" data-course="${DataStore.escapeHtml(c)}">${DataStore.escapeHtml(c)}</span>`;
    }).join('')}
            ${extraCoursesCount > 0 ? `<span class="course-tag">+${extraCoursesCount} more</span>` : ''}
          </div>
          <button type="button" class="card-action-cue" aria-label="View profile for ${DataStore.escapeHtml(tutor.fullName)}">Profile →</button>
        </div>
      </article>
    `;
  }

  // --- Modal Controllers ---

  // --- Unified Modal Controller ---
  function openDetailModal({ title, subtitle, category = null, statusType, statusText, schedule, sections = [] }) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalContent = document.getElementById('modal-content');
    if (!modalBackdrop || !modalContent) return;

    const today = DataStore.getTodayName();

    const sectionsHtml = sections.map(sec => {
      if (!sec || !sec.content) return '';
      return `
        <div>
          ${sec.heading ? `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <div class="modal-section-h" style="margin-bottom: 0;">${DataStore.escapeHtml(sec.heading)}</div>
              ${sec.headingExtra ? sec.headingExtra : ''}
            </div>
          ` : ''}
          ${sec.content}
        </div>
      `;
    }).join('');

    let hasUpcomingShifts = false;
    if (schedule) {
      hasUpcomingShifts = DataStore.WEEKDAYS.some(day => {
        const sched = schedule[day];
        return sched && sched !== 'Closed' && !isWeekdayPassed(day, sched);
      });
    }

    const scheduleMatrixHtml = schedule ? `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div class="modal-section-h" style="margin-bottom: 0;">Weekly Hours</div>
          ${hasUpcomingShifts ? `
            <button
              type="button"
              class="add-all-cal-btn"
              id="modal-add-all-cal-btn"
              data-cal-title="${DataStore.escapeHtml(title)}"
              title="Download remaining week shifts to your calendar (.ics)"
              aria-label="Add week to calendar"
            >
              <span class="btn-text-desktop">+ Add Week to Calendar (.ics)</span>
              <span class="btn-text-mobile">+ Export Week (.ics)</span>
            </button>
          ` : ''}
        </div>
        <div class="matrix-strip" style="border: 1.5px solid var(--border-med); border-radius: var(--radius-md);">
          ${DataStore.WEEKDAYS.map(day => {
      const sched = schedule[day];
      const isClosed = !sched || sched.trim() === '' || sched === 'Closed';
      const passed = isWeekdayPassed(day, sched);
      const isInteractive = !isClosed && !passed;

      let footerHtml = '';
      if (isInteractive) {
        footerHtml = `
                <div class="matrix-col-footer">
                  <span class="btn-text-desktop">+ Calendar</span>
                  <span class="btn-text-mobile">+ Cal</span>
                </div>
              `;
      }

      return `
              <div
                class="matrix-col ${day === today ? 'active-day' : ''} ${isInteractive ? 'matrix-col-interactive' : ''}"
                ${isInteractive ? `
                  role="button"
                  tabindex="0"
                  data-cal-col="true"
                  data-cal-title="${DataStore.escapeHtml(title)}"
                  data-cal-day="${DataStore.escapeHtml(day)}"
                  data-cal-time="${DataStore.escapeHtml(sched)}"
                  title="Add ${DataStore.escapeHtml(title)} (${day.slice(0, 3)}) to Google Calendar"
                  aria-label="Add ${DataStore.escapeHtml(title)} (${day.slice(0, 3)}) to Google Calendar"
                ` : ''}
              >
                <div class="matrix-col-body">
                  <span class="matrix-header-day">${day.slice(0, 3)}</span>
                  <div class="matrix-hours-val">
                    ${renderMatrixCell(sched)}
                  </div>
                </div>
                ${footerHtml}
              </div>
            `;
    }).join('')}
        </div>
      </div>
    ` : '';

    modalContent.innerHTML = `
      <div class="card-status-cell ${statusType || 'none'}">
        ${DataStore.escapeHtml(statusText || '')}
      </div>

      <div class="modal-header-bar">
        <div>
          <div class="modal-title-lg">${DataStore.escapeHtml(title)}</div>
          <div class="modal-sub-lg">${DataStore.escapeHtml(subtitle || '')}</div>
        </div>
      </div>

      <div class="modal-scroll-body">
        ${scheduleMatrixHtml}
        ${sectionsHtml}
      </div>

      <div class="modal-bottom-bar">
        <button type="button" class="modal-bottom-close-btn" id="modal-close-btn" aria-label="Close dialog">
          <span>Close</span>
        </button>
      </div>
    `;

    modalBackdrop.classList.add('open');
    modalBackdrop.setAttribute('aria-hidden', 'false');

    attachModalInnerListeners();

    // Save triggering element + activate focus trap (WCAG 2.1.2, 2.4.3)
    _lastFocusedElement = document.activeElement;
    if (_removeTrap) _removeTrap();
    _removeTrap = trapFocus(modalBackdrop);

    // Hide page content from screen readers while modal is open (WCAG 1.3.1)
    document.getElementById('app-root')?.setAttribute('aria-hidden', 'true');

    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.focus();
  }

  // 1. Subject Full Details Modal
  function openSubjectModal(code) {
    const subjects = DataStore.getSubjects();
    const subject = subjects.find(s => s.code.toUpperCase() === String(code).toUpperCase());
    if (!subject) return;

    const today = DataStore.getTodayName();
    const tutorAvail = DataStore.getSubjectTutorAvailability(subject.code, today);
    const liveStatus = DataStore.getSubjectLiveStatus(subject.code, today);

    let statusBadgeText = 'Unavailable Today';
    if (liveStatus.isOpenNow && liveStatus.currentWindow) {
      statusBadgeText = `Available until ${liveStatus.currentWindow.endStr}`;
    } else if (liveStatus.isUpcoming && liveStatus.nextWindow) {
      statusBadgeText = `Available at ${liveStatus.nextWindow.startStr}`;
    } else if (liveStatus.nextAvailable) {
      statusBadgeText = liveStatus.nextAvailable.label;
    }

    const tutorsListHtml = tutorAvail.all.length > 0
      ? tutorAvail.all.map(t => {
        const shift = t.schedule[today];
        const evalRes = shift ? DataStore.evaluateTimeWindows(shift, today) : null;
        let shiftBadge = '';
        if (evalRes) {
          if (evalRes.isOpenNow) shiftBadge = `<span class="status-badge available">On Shift</span>`;
          else if (evalRes.isUpcoming) shiftBadge = `<span class="status-badge upcoming">Upcoming</span>`;
          else if (evalRes.isEnded) shiftBadge = `<span class="status-badge unavailable">Shift Concluded</span>`;
        }

        return `
            <div
              class="modal-tutor-item"
              data-tutor-name="${DataStore.escapeHtml(t.fullName)}"
              role="button"
              tabindex="0"
              title="Click to view full profile for ${DataStore.escapeHtml(t.fullName)}"
            >
              <div>
                <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${DataStore.escapeHtml(t.fullName)}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                  Courses: ${(t.courses || []).slice(0, 8).join(', ')}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">${shift || 'Not on duty today'}</div>
                <div style="margin-top: 8px;">${shiftBadge}</div>
              </div>
            </div>
          `;
      }).join('')
      : '<div style="color: var(--text-muted); padding: 12px 0;">General tutoring support.</div>';

    const coursesListHtml = (subject.courses && subject.courses.length > 0)
      ? subject.courses.map(c => `
          <button
            type="button"
            class="modal-course-pill"
            data-course="${DataStore.escapeHtml(c)}"
            aria-label="View schedule for ${DataStore.escapeHtml(c)}"
          >
            ${DataStore.escapeHtml(c)}
          </button>
        `).join('')
      : '<div style="color: var(--text-muted); padding: 12px 0;">All courses supported.</div>';

    const categoryBadgeHtml = subject.category
      ? `<span class="modal-dept-badge">${DataStore.escapeHtml(subject.category)}</span>`
      : '';

    openDetailModal({
      title: subject.code,
      subtitle: subject.name || subject.fullName || subject.code,
      statusType: liveStatus.statusType,
      statusText: statusBadgeText,
      schedule: subject.schedule,
      sections: [
        {
          heading: `Supported Courses (${(subject.courses || []).length})`,
          headingExtra: categoryBadgeHtml,
          content: coursesListHtml
        },
        { heading: `Assigned Tutors (${tutorAvail.all.length})`, content: `<div style="display: flex; flex-direction: column; gap: 8px;">${tutorsListHtml}</div>` }
      ]
    });
  }

  // 2. Tutor Profile Modal
  function openTutorModal(tutorName) {
    const tutors = DataStore.getTutors();
    const tutor = tutors.find(t => t.fullName.toLowerCase() === String(tutorName).toLowerCase().trim());
    if (!tutor) return;

    const today = DataStore.getTodayName();
    const todayShift = tutor.schedule[today];
    const evalRes = todayShift ? DataStore.evaluateTimeWindows(todayShift, today) : null;

    let shiftStatusBadge = '<span class="status-badge unavailable">Off Duty Today</span>';
    let statusBadgeText = 'Off Duty Today';
    let statusType = 'unavailable';
    if (evalRes) {
      statusType = evalRes.statusType;
      if (evalRes.isOpenNow) {
        statusBadgeText = evalRes.currentWindow ? `On Shift · until ${evalRes.currentWindow.endStr}` : 'On Shift Now';
        shiftStatusBadge = `<span class="status-badge available">On Shift Now</span>`;
      } else if (evalRes.isUpcoming) {
        statusBadgeText = evalRes.nextWindow ? `Available at ${evalRes.nextWindow.startStr}` : 'Upcoming';
        shiftStatusBadge = `<span class="status-badge upcoming">Upcoming</span>`;
      } else if (evalRes.isEnded) {
        statusBadgeText = 'Shift Concluded';
        shiftStatusBadge = `<span class="status-badge unavailable">Shift Concluded</span>`;
      }
    }

    const todayShiftBlock = `
      <div style="background: var(--bg-subtle); padding: 14px 18px; border-radius: var(--radius-md); border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Today's Shift (${today})</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-main); margin-top: 2px;">${todayShift || 'Not on duty today'}</div>
        </div>
        <div>${shiftStatusBadge}</div>
      </div>
    `;

    const coursesListHtml = (tutor.courses && tutor.courses.length > 0)
      ? tutor.courses.map(c => `
          <button
            type="button"
            class="modal-course-pill"
            data-course="${DataStore.escapeHtml(c)}"
            aria-label="View schedule for ${DataStore.escapeHtml(c)}"
          >
            ${DataStore.escapeHtml(c)}
          </button>
        `).join('')
      : '<div style="color: var(--text-muted);">General tutoring assistance.</div>';

    const sections = [
      { heading: null, content: todayShiftBlock },
      { heading: `Courses Covered (${(tutor.courses || []).length})`, content: coursesListHtml }
    ];

    if (tutor.notes) {
      sections.push({
        heading: 'Notes & Specialties',
        content: `<div style="font-size: 0.9rem; color: var(--text-secondary); background: var(--bg-subtle); padding: 10px 14px; border-radius: var(--radius-md);">${DataStore.escapeHtml(tutor.notes)}</div>`
      });
    }

    openDetailModal({
      title: tutor.fullName,
      subtitle: 'TERC Academic Tutor',
      statusType,
      statusText: statusBadgeText,
      schedule: tutor.schedule,
      sections
    });
  }

  // 3. Course Details Modal
  function openCourseModal(courseCode) {
    const courseAvail = DataStore.getCourseAvailability(courseCode);
    const today = DataStore.getTodayName();

    const tutorsHtml = (courseAvail.tutors && courseAvail.tutors.length > 0)
      ? courseAvail.tutors.map(t => {
        const shift = t.schedule[today];
        const evalRes = shift ? DataStore.evaluateTimeWindows(shift, today) : null;
        return `
            <div
              class="modal-tutor-item"
              data-tutor-name="${DataStore.escapeHtml(t.fullName)}"
              role="button"
              tabindex="0"
              title="Click to view profile for ${DataStore.escapeHtml(t.fullName)}"
            >
              <div>
                <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${DataStore.escapeHtml(t.fullName)}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                  All Courses: ${(t.courses || []).slice(0, 6).join(', ')}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">${shift || 'Off Duty Today'}</div>
                ${evalRes ? `
                  <span class="status-badge ${evalRes.statusType}" style="display: inline-block; margin-top: 8px;">
                    ${evalRes.isOpenNow ? 'In Now' : (evalRes.isUpcoming ? 'Later Today' : 'Ended')}
                  </span>
                ` : ''}
              </div>
            </div>
          `;
      }).join('')
      : '<div style="color: var(--text-muted); padding: 12px 0;">No specific tutors assigned.</div>';

    const subjectPrefix = String(courseCode).split(/\s+/)[0];
    const subjectName = DataStore.getSubjectDisplayName(subjectPrefix);
    const subtitle = subjectName ? `${subjectName} · Course Tutoring Coverage` : 'Course Tutoring Coverage';

    let courseStatusBadgeText = 'No Tutors Today';
    let courseStatusType = 'unavailable';
    if (courseAvail.isOpenNow) {
      courseStatusType = 'available';
      courseStatusBadgeText = 'Available Now';
    } else if (courseAvail.isUpcoming) {
      courseStatusType = 'upcoming';
      courseStatusBadgeText = 'Available Later Today';
    } else if (courseAvail.nextAvailable) {
      courseStatusType = 'unavailable';
      courseStatusBadgeText = courseAvail.nextAvailable.label;
    }

    const summaryBlock = `
      <div style="background: var(--bg-subtle); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-light); font-size: 0.9rem; color: var(--text-secondary);">
        <strong>${courseAvail.tutors.length}</strong> tutor(s) qualified for <strong>${DataStore.escapeHtml(courseCode)}</strong>.
      </div>
    `;

    const courseCategory = DataStore.getSubjectCategory(subjectPrefix);
    const categoryBadgeHtml = courseCategory
      ? `<span class="modal-dept-badge">${DataStore.escapeHtml(courseCategory)}</span>`
      : '';

    openDetailModal({
      title: courseCode,
      subtitle,
      statusType: courseStatusType,
      statusText: courseStatusBadgeText,
      schedule: courseAvail.schedule,
      sections: [
        {
          heading: 'Course Overview',
          headingExtra: categoryBadgeHtml,
          content: summaryBlock
        },
        { heading: `Qualified Tutors (${courseAvail.tutors.length})`, content: `<div style="display: flex; flex-direction: column; gap: 8px;">${tutorsHtml}</div>` }
      ]
    });
  }

  // 4. Center Facility Info Modal (Mobile)
  function openFacilityModal() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalContent = document.getElementById('modal-content');
    if (!modalBackdrop || !modalContent) return;

    modalContent.innerHTML = `
      <div class="modal-header-bar">
        <div>
          <div class="modal-title-lg">TERC Center Details</div>
          <div class="modal-sub-lg">Mt. San Antonio College · Bldg 26D Room 3411</div>
        </div>
      </div>

      <div class="modal-scroll-body">
        ${renderSidebarHtml()}
      </div>

      <div class="modal-bottom-bar">
        <button type="button" class="modal-bottom-close-btn" id="modal-close-btn" aria-label="Close dialog">
          <span>Close</span>
        </button>
      </div>
    `;

    modalBackdrop.classList.add('open');
    modalBackdrop.setAttribute('aria-hidden', 'false');

    attachModalInnerListeners();

    // Save triggering element + activate focus trap (WCAG 2.1.2, 2.4.3)
    _lastFocusedElement = document.activeElement;
    if (_removeTrap) _removeTrap();
    _removeTrap = trapFocus(modalBackdrop);

    // Hide page content from screen readers while modal is open (WCAG 1.3.1)
    document.getElementById('app-root')?.setAttribute('aria-hidden', 'true');

    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    if (modalBackdrop) {
      modalBackdrop.classList.remove('open');
      modalBackdrop.setAttribute('aria-hidden', 'true');
    }
    // Remove focus trap and return focus to triggering element (WCAG 2.4.3)
    if (_removeTrap) { _removeTrap(); _removeTrap = null; }
    if (_lastFocusedElement) { _lastFocusedElement.focus(); _lastFocusedElement = null; }
    // Restore page content to screen readers (WCAG 1.3.1)
    document.getElementById('app-root')?.removeAttribute('aria-hidden');
  }

  function attachModalInnerListeners() {
    // Tutors inside modal (click + Enter/Space keyboard trigger)
    document.querySelectorAll('[data-tutor-name]').forEach(btn => {
      const triggerTutor = e => {
        e.stopPropagation();
        const name = btn.getAttribute('data-tutor-name');
        if (name) openTutorModal(name);
      };

      btn.addEventListener('click', triggerTutor);
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerTutor(e);
        }
      });
    });

    // Courses inside modal (click + Enter/Space keyboard trigger)
    document.querySelectorAll('.modal-course-pill[data-course]').forEach(pill => {
      const triggerCourse = e => {
        e.stopPropagation();
        const course = pill.getAttribute('data-course');
        if (course) openCourseModal(course);
      };

      pill.addEventListener('click', triggerCourse);
      pill.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerCourse(e);
        }
      });
    });

    // Calendar: Individual day column click & keyboard enter
    document.querySelectorAll('[data-cal-col]').forEach(col => {
      const triggerCalendar = e => {
        e.stopPropagation();
        const calTitle = col.getAttribute('data-cal-title') || 'Tutoring';
        const calDay = col.getAttribute('data-cal-day') || '';
        const calTime = col.getAttribute('data-cal-time') || '';
        if (calDay && calTime) {
          openGoogleCalendarShift(calTitle, calDay, calTime);
        }
      };

      col.addEventListener('click', triggerCalendar);
      col.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerCalendar(e);
        }
      });
    });

    // Calendar: Add Remaining Shifts to Calendar (.ics)
    const addAllBtn = document.getElementById('modal-add-all-cal-btn');
    if (addAllBtn) {
      addAllBtn.addEventListener('click', e => {
        e.stopPropagation();
        const title = addAllBtn.getAttribute('data-cal-title') || 'Tutoring';
        const columns = document.querySelectorAll('[data-cal-col]');
        const events = [];

        columns.forEach(col => {
          const dayName = col.getAttribute('data-cal-day');
          const timeRange = col.getAttribute('data-cal-time');
          if (!dayName || !timeRange) return;

          if (isWeekdayPassed(dayName, timeRange)) return;

          const targetDate = getTargetDateForWeekday(dayName);
          const windows = DataStore.parseTimeRange(timeRange);
          windows.forEach(w => {
            events.push({
              title: `${title} Tutoring @ TERC`,
              startIso: formatIcsDateTime(targetDate, w.start),
              endIso: formatIcsDateTime(targetDate, w.end)
            });
          });
        });

        if (events.length > 0) {
          downloadIcsEvents(`${title}_TERC_Schedule`, events);
        }
      });
    }
  }

  // --- Dynamic DOM Updating Engine ---
  function getVisibleItems() {
    let items;
    const today = DataStore.getTodayName();

    if (state.viewMode === 'tutors') {
      items = DataStore.filterTutors({
        search: state.search,
        category: state.category,
        availableToday: state.availableToday
      });

      // If availableToday filter is on, apply 2-tier sort:
      // Tier 1: Active Today (open or upcoming)
      // Tier 2: Finished Today (ended / none)
      if (state.availableToday) {
        items.sort((a, b) => {
          const shiftA = a.schedule[today];
          const shiftB = b.schedule[today];
          const evalA = shiftA ? DataStore.evaluateTimeWindows(shiftA, today) : null;
          const evalB = shiftB ? DataStore.evaluateTimeWindows(shiftB, today) : null;

          const isAActive = evalA && (evalA.isOpenNow || evalA.isUpcoming);
          const isBActive = evalB && (evalB.isOpenNow || evalB.isUpcoming);

          if (isAActive && !isBActive) return -1;
          if (!isAActive && isBActive) return 1;

          // Within same tier, maintain alphabetical order
          return a.fullName.localeCompare(b.fullName);
        });
      }
      return items;
    }

    items = DataStore.filterSubjects({
      search: state.search,
      category: state.category,
      availableToday: state.availableToday
    });

    // If availableToday filter is on, apply 2-tier sort:
    // Tier 1: Active Today (open or upcoming)
    // Tier 2: Finished Today (ended / none)
    if (state.availableToday) {
      items.sort((a, b) => {
        const liveA = DataStore.getSubjectLiveStatus(a.code, today);
        const liveB = DataStore.getSubjectLiveStatus(b.code, today);

        const isAActive = liveA && (liveA.isOpenNow || liveA.isUpcoming);
        const isBActive = liveB && (liveB.isOpenNow || liveB.isUpcoming);

        if (isAActive && !isBActive) return -1;
        if (!isAActive && isBActive) return 1;

        // Within same tier, maintain alphabetical order
        const nameA = a.name || a.fullName || a.code;
        const nameB = b.name || b.fullName || b.code;
        return nameA.localeCompare(nameB);
      });
    }

    return items;
  }

  function renderCardsHtml(visibleItems) {
    const today = DataStore.getTodayName();
    const isTutorMode = state.viewMode === 'tutors';

    if (!visibleItems.length) {
      const entityName = isTutorMode ? 'tutors' : 'subjects or courses';
      return `
        <div class="empty-results-card" role="status" aria-live="polite">
          <div class="empty-results-title">No matching ${entityName} found</div>
          <div class="empty-results-subtitle">We could not find active shifts matching your query.</div>
          <div class="empty-actions-row">
            ${state.availableToday ? `<button type="button" class="empty-action-btn primary" id="empty-show-all-btn">Show All Days</button>` : ''}
            <button type="button" class="empty-action-btn" id="empty-reset-btn">Reset Filters</button>
          </div>
        </div>
      `;
    }

    if (isTutorMode) {
      return visibleItems.map(t => renderTutorCard(t, today)).join('');
    }
    return visibleItems.map(s => renderSubjectCard(s, today)).join('');
  }

  function updateGridOnly() {
    const grid = document.getElementById('card-grid-mount');
    const visible = getVisibleItems();
    const isTutorMode = state.viewMode === 'tutors';
    const all = isTutorMode ? DataStore.getTutors() : DataStore.getSubjects();

    if (grid) {
      grid.innerHTML = renderCardsHtml(visible);
      attachCardListeners();
    }

    const countStat = document.getElementById('filter-count-stat');
    if (countStat) {
      const entityLabel = isTutorMode ? 'tutors' : 'subjects';
      countStat.innerHTML = `Showing <strong>${visible.length}</strong> of <strong>${all.length}</strong> ${entityLabel}`;
    }

    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) {
      clearBtn.classList.toggle('visible', Boolean(state.search));
    }

    const todayBtn = document.getElementById('today-toggle-btn');
    if (todayBtn) {
      todayBtn.classList.toggle('active', state.availableToday);
      todayBtn.setAttribute('aria-checked', state.availableToday);
    }

    // Update view mode segmented buttons
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      const view = btn.getAttribute('data-view');
      const isActive = view === state.viewMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.placeholder = isTutorMode
        ? 'Search tutors by name, course (e.g. MATH 180), or subject...'
        : 'Search subjects, courses (e.g. MATH 180), or tutors...';
    }

    document.querySelectorAll('.dept-tag').forEach(btn => {
      const cat = btn.getAttribute('data-category') || 'all';
      const isActive = cat === state.category;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
    });
  }

  function renderShell() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const visible = getVisibleItems();
    const isTutorMode = state.viewMode === 'tutors';
    const all = isTutorMode ? DataStore.getTutors() : DataStore.getSubjects();

    root.innerHTML = `
      <div class="app-container">
        <!-- Mobile Topbar -->
        <header class="mobile-topbar">
          <div>
            <div class="mobile-topbar-title">Mt. SAC TERC Schedule</div>
            <div class="mobile-topbar-sub">Building 26D · Room 3411</div>
          </div>
          <button type="button" class="mobile-info-btn" id="mobile-info-trigger">Center Info</button>
        </header>

        <div class="main-layout">
          <!-- Desktop Sidebar -->
          <aside class="sidebar-wrapper">
            ${renderSidebarHtml()}
          </aside>

          <!-- Main Schedule Stream -->
          <main class="schedule-main">
            ${renderFilterHtml(all.length, visible.length)}
            <section class="card-grid" id="card-grid-mount">
              ${renderCardsHtml(visible)}
            </section>
          </main>
        </div>
      </div>
    `;

    attachStaticListeners();
    attachCardListeners();
  }

  function attachStaticListeners() {
    // View mode switch (Subjects vs Tutors)
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view && state.viewMode !== view) {
          state.viewMode = view;
          updateGridOnly();
        }
      });
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        state.search = e.target.value;
        updateGridOnly();
      });
    }

    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.search = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        updateGridOnly();
      });
    }

    const todayBtn = document.getElementById('today-toggle-btn');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        state.availableToday = !state.availableToday;
        updateGridOnly();
      });
    }

    document.querySelectorAll('.dept-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        state.category = btn.getAttribute('data-category') || 'all';
        updateGridOnly();
      });
    });

    const mobileInfoBtn = document.getElementById('mobile-info-trigger');
    if (mobileInfoBtn) {
      mobileInfoBtn.addEventListener('click', openFacilityModal);
    }
  }

  function attachCardListeners() {
    // Mouse click anywhere on a subject card → open subject modal
    document.querySelectorAll('.schedule-card[data-code]').forEach(card => {
      card.addEventListener('click', e => {
        // Don't double-fire if a child button/chip already handles it
        if (e.target.closest('button, a, [data-tutor-name], [data-course]')) return;
        const code = card.getAttribute('data-code');
        if (code) openSubjectModal(code);
      });
    });

    // Details / Profile buttons — primary keyboard entry point (WCAG 2.1.1)
    document.querySelectorAll('.schedule-card .card-action-cue').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const card = btn.closest('.schedule-card');
        const code = card.getAttribute('data-code');
        const tutorName = card.getAttribute('data-tutor-name');
        if (code) openSubjectModal(code);
        else if (tutorName) openTutorModal(tutorName);
      });
    });

    // Tutor chip buttons on cards & sidebar
    document.querySelectorAll('[data-tutor-name]').forEach(el => {
      // Only attach to buttons/sidebar items, not the tutor card article itself
      if (el.tagName === 'ARTICLE') return;
      el.addEventListener('click', e => {
        e.stopPropagation();
        const name = el.getAttribute('data-tutor-name');
        if (name) openTutorModal(name);
      });
    });

    // Course tag clicks on cards
    document.querySelectorAll('.course-tag[data-course]').forEach(tag => {
      tag.addEventListener('click', e => {
        e.stopPropagation();
        const course = tag.getAttribute('data-course');
        if (course) openCourseModal(course);
      });
    });

    // Empty state action buttons
    const emptyShowAllBtn = document.getElementById('empty-show-all-btn');
    if (emptyShowAllBtn) {
      emptyShowAllBtn.addEventListener('click', () => {
        state.availableToday = false;
        updateGridOnly();
      });
    }

    const emptyResetBtn = document.getElementById('empty-reset-btn');
    if (emptyResetBtn) {
      emptyResetBtn.addEventListener('click', () => {
        state.search = '';
        state.category = 'all';
        state.availableToday = false;
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        updateGridOnly();
      });
    }
  }

  // --- Initializer ---
  async function init() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', e => {
        if (e.target === modalBackdrop || e.target.closest('#modal-close-btn')) {
          closeModal();
        }
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    try {
      await DataStore.loadData();
      renderShell();

      console.log(
        `%c🦖 TERC Schedule Portal%c v${APP_VERSION} · ${APP_BUILD}`,
        'color:#70101b;font-weight:800;font-size:1.05em;',
        'color:#555;font-size:0.88em;'
      );

      DataStore.onDataUpdated(() => {
        renderShell();
      });

      setInterval(() => {
        updateGridOnly();
      }, 60000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateGridOnly();
      });
    } catch (err) {
      console.error('Schedule initialization error:', err);
    }
  }

  return {
    init,
    openSubjectModal,
    openTutorModal,
    openCourseModal,
    openFacilityModal
  };
})();

document.addEventListener('DOMContentLoaded', ScheduleApp.init);
