// TERC Schedule Portal - Production Data Layer
// Note: Created and designed by humans, tool-assisted by AI
// Supports Stale-While-Revalidate caching with silent content comparison

const DataStore = (() => {
  const CONFIG = {
    TUTORS_OUTPUT_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbaJLNFNkkETTOL6GaGVienuGZW0s_6bdFHhQ6PifdPXrGeqOFnXzFsfscDoGshMZcAhRV36QZ6E0/pub?gid=5992617&single=true&output=csv',
    SUBJECTS_OUTPUT_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbaJLNFNkkETTOL6GaGVienuGZW0s_6bdFHhQ6PifdPXrGeqOFnXzFsfscDoGshMZcAhRV36QZ6E0/pub?gid=1202002415&single=true&output=csv',
    SERVICE_HOURS_OUTPUT_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbaJLNFNkkETTOL6GaGVienuGZW0s_6bdFHhQ6PifdPXrGeqOFnXzFsfscDoGshMZcAhRV36QZ6E0/pub?gid=869587137&single=true&output=csv',
    CACHE_KEY: 'terc_production_store_v2'
  };

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const ALL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let tutors = [];
  let subjects = [];
  let serviceHours = {};
  let lastUpdated = null;
  const updateListeners = [];

  function onDataUpdated(fn) {
    if (typeof fn === 'function') updateListeners.push(fn);
  }

  function notifyUpdateListeners(timestamp) {
    updateListeners.forEach(fn => {
      try {
        fn(timestamp);
      } catch (err) {
        console.error('Update listener error:', err);
      }
    });
  }

  // --- Fast CSV Scanner ---
  function parseCSV(text) {
    if (!text) return [];
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0, len = text.length; i < len; i++) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          row.push(cell);
          cell = '';
        } else if (char === '\n' || char === '\r') {
          row.push(cell);
          cell = '';
          if (row.some(c => c.trim().length > 0)) rows.push(row);
          row = [];
          if (char === '\r' && text[i + 1] === '\n') i++;
        } else {
          cell += char;
        }
      }
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      if (row.some(c => c.trim().length > 0)) rows.push(row);
    }

    return rows;
  }

  async function fetchText(url) {
    if (!url) return '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) {
      console.error(`Fetch failed for URL: ${url}`, e);
      return '';
    }
  }

  function splitList(val) {
    if (!val) return [];
    return String(val).split(/[,|;]/).map(s => s.trim()).filter(Boolean);
  }

  function parseScheduleRows(rows, { keyHeader, keyProp, textProps = [], listProps = [], dayColumns = true }) {
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map(h => String(h).trim());
    const colMap = {};
    headers.forEach((h, idx) => { if (h) colMap[h] = idx; });
    const getCol = name => colMap[name];

    const keyIndex = getCol(keyHeader);
    if (keyIndex === undefined) return [];

    return rows.slice(1).map(row => {
      const keyVal = String(row[keyIndex] || '').trim();
      const item = { [keyProp]: keyVal };

      if (dayColumns) {
        item.schedule = {};
        WEEKDAYS.forEach(day => {
          const dayIdx = getCol(day);
          const dayVal = dayIdx !== undefined ? String(row[dayIdx] || '').trim() : '';
          if (dayVal) item.schedule[day] = dayVal;
        });
      }

      textProps.forEach(([prop, header, fallback]) => {
        const idx = getCol(header);
        item[prop] = (idx !== undefined ? String(row[idx] || '').trim() : '') || (fallback || '');
      });

      listProps.forEach(([prop, header]) => {
        const idx = getCol(header);
        item[prop] = idx !== undefined ? splitList(row[idx]) : [];
      });

      return item;
    }).filter(item => item[keyProp]);
  }

  function parseServiceHours(rows) {
    const hoursMap = {};
    if (!rows || rows.length < 2) return hoursMap;

    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    const sIdx = headers.findIndex(h => h.includes('service'));
    const hIdx = headers.findIndex(h => h.includes('hour'));

    rows.slice(1).forEach(row => {
      const service = sIdx !== -1 ? String(row[sIdx] || '').trim() : '';
      const hours = hIdx !== -1 ? String(row[hIdx] || '').trim() : '';
      if (service) {
        hoursMap[service] = hours || 'Closed';
        hoursMap[service.toLowerCase()] = hours || 'Closed';
      }
    });

    return hoursMap;
  }

  function setIngestedData(tText, sText, hText) {
    tutors = parseScheduleRows(parseCSV(tText), {
      keyHeader: 'Full Name',
      keyProp: 'fullName',
      textProps: [['notes', 'Notes']],
      listProps: [['subjects', 'Subjects'], ['courses', 'Courses']]
    });

    subjects = parseScheduleRows(parseCSV(sText), {
      keyHeader: 'Subject',
      keyProp: 'code',
      textProps: [
        ['category', 'Category', 'General'],
        ['name', 'Title', ''],
        ['fullName', 'Full Subject Name', '']
      ],
      listProps: [['tutors', 'Tutors'], ['courses', 'Courses']]
    });

    serviceHours = parseServiceHours(parseCSV(hText));
  }

  // --- Silent Background Check ---
  async function checkBackgroundUpdate(cached) {
    try {
      const [tutorsText, subjectsText, serviceText] = await Promise.all([
        fetchText(CONFIG.TUTORS_OUTPUT_URL),
        fetchText(CONFIG.SUBJECTS_OUTPUT_URL),
        fetchText(CONFIG.SERVICE_HOURS_OUTPUT_URL)
      ]);

      if (!tutorsText || !subjectsText) return;

      const hasChanged = (
        tutorsText !== cached.tutorsText ||
        subjectsText !== cached.subjectsText ||
        serviceText !== (cached.serviceText || '')
      );

      if (!hasChanged) return;

      const now = Date.now();
      setIngestedData(tutorsText, subjectsText, serviceText);
      lastUpdated = now;

      localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
        timestamp: now,
        tutorsText,
        subjectsText,
        serviceText
      }));

      notifyUpdateListeners(now);
    } catch (e) {
      console.warn('Background check warning:', e);
    }
  }

  // --- Main Load Entry Point ---
  async function loadData(forceRefresh = false) {
    let cached = null;
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch (e) {
      console.warn('Cache read error:', e);
    }

    if (cached && cached.tutorsText && cached.subjectsText && !forceRefresh) {
      setIngestedData(cached.tutorsText, cached.subjectsText, cached.serviceText || '');
      lastUpdated = cached.timestamp;
      setTimeout(() => checkBackgroundUpdate(cached), 50);
      return { fromCache: true, timestamp: cached.timestamp };
    }

    const now = Date.now();
    try {
      const [tutorsText, subjectsText, serviceText] = await Promise.all([
        fetchText(CONFIG.TUTORS_OUTPUT_URL),
        fetchText(CONFIG.SUBJECTS_OUTPUT_URL),
        fetchText(CONFIG.SERVICE_HOURS_OUTPUT_URL)
      ]);

      setIngestedData(tutorsText, subjectsText, serviceText);
      lastUpdated = now;

      localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
        timestamp: now,
        tutorsText,
        subjectsText,
        serviceText
      }));

      return { fromCache: false, timestamp: now };
    } catch (e) {
      console.error('Data loading failed:', e);
      throw e;
    }
  }

  // --- Time Arithmetic Helpers ---
  function parseSingleTime(str, defaultMeridiem = null) {
    if (!str) return null;
    const match = str.trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/i);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    let mer = match[3] ? (match[3].startsWith('p') ? 'pm' : 'am') : defaultMeridiem;

    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    if (!mer && hour >= 1 && hour <= 7) hour += 12;

    return hour * 60 + min;
  }

  function formatMinutes(totalMinutes) {
    let hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const meridiem = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return mins === 0 ? `${hours} ${meridiem}` : `${hours}:${String(mins).padStart(2, '0')} ${meridiem}`;
  }

  function parseTimeRange(rangeStr) {
    if (!rangeStr) return [];
    const parts = String(rangeStr).split(/[,;|]/);
    const windows = [];

    parts.forEach(part => {
      const raw = part.trim();
      if (!raw) return;
      const split = raw.split(/[-–—to]/i);
      if (split.length < 2) return;
      const endStr = split[split.length - 1].trim();
      const startStr = split.slice(0, split.length - 1).join('-').trim();
      const endMer = endStr.toLowerCase().includes('p') ? 'pm' : (endStr.toLowerCase().includes('a') ? 'am' : null);

      const startMin = parseSingleTime(startStr, endMer);
      const endMin = parseSingleTime(endStr);

      if (startMin !== null && endMin !== null) {
        windows.push({
          start: startMin,
          end: endMin,
          raw: raw,
          startStr: formatMinutes(startMin),
          endStr: formatMinutes(endMin)
        });
      }
    });

    return windows.sort((a, b) => a.start - b.start);
  }

  // --- Real-Time Availability Engine ---
  function evaluateTimeWindows(timeString, targetDay = null, refDate = new Date()) {
    const today = ALL_DAYS[refDate.getDay()];
    const isActualToday = !targetDay || targetDay === today;
    const windows = parseTimeRange(timeString);

    if (!windows.length) {
      return {
        hasSchedule: !!timeString,
        isActualToday,
        isOpenNow: false,
        isUpcoming: false,
        isEnded: false,
        statusType: timeString ? (isActualToday ? 'ended' : 'scheduled') : 'none',
        statusText: timeString || 'No Hours',
        currentWindow: null,
        nextWindow: null
      };
    }

    if (!isActualToday) {
      return {
        hasSchedule: true,
        isActualToday: false,
        isOpenNow: false,
        isUpcoming: false,
        isEnded: false,
        statusType: 'scheduled',
        statusText: windows.map(w => `${w.startStr} – ${w.endStr}`).join(', '),
        currentWindow: null,
        nextWindow: windows[0]
      };
    }

    const nowMinutes = refDate.getHours() * 60 + refDate.getMinutes();

    // 1. Check if inside an active shift window right now
    const currentWin = windows.find(w => nowMinutes >= w.start && nowMinutes < w.end);
    if (currentWin) {
      return {
        hasSchedule: true,
        isActualToday: true,
        isOpenNow: true,
        isAvailableNow: true,
        isUpcoming: false,
        isEnded: false,
        statusType: 'open',
        statusText: `Available · until ${currentWin.endStr}`,
        currentWindow: currentWin,
        nextWindow: null
      };
    }

    // 2. Check if upcoming later today
    const upcomingWin = windows.find(w => nowMinutes < w.start);
    if (upcomingWin) {
      const prevWin = windows.slice().reverse().find(w => nowMinutes >= w.end);
      const statusType = prevWin ? 'break' : 'upcoming';
      const statusText = prevWin ? `On Break · Next Shift ${upcomingWin.startStr}` : `Starts at ${upcomingWin.startStr}`;
      return {
        hasSchedule: true,
        isActualToday: true,
        isOpenNow: false,
        isUpcoming: true,
        isEnded: false,
        statusType,
        statusText,
        currentWindow: null,
        nextWindow: upcomingWin
      };
    }

    // 3. Shift finished for the day
    const lastWin = windows[windows.length - 1];
    return {
      hasSchedule: true,
      isActualToday: true,
      isOpenNow: false,
      isUpcoming: false,
      isEnded: true,
      statusType: 'ended',
      statusText: `Tutoring Ended · at ${lastWin.endStr}`,
      currentWindow: null,
      nextWindow: null
    };
  }

  // Helper to extract first name for glanceable card displays
  function getFirstName(fullName) {
    if (!fullName) return '';
    const parts = String(fullName).trim().split(/\s+/);
    return parts[0];
  }

  // Helper to extract First Name + Last Initial (e.g. "Alex C." or "Alex Chen" -> "Alex C.")
  function getShortName(fullName) {
    if (!fullName) return '';
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length <= 1) return parts[0];
    const first = parts[0];
    const lastPart = parts[parts.length - 1];
    // If already an initial like "C." or "C"
    if (/^[A-Za-z]\.?$/.test(lastPart)) {
      return `${first} ${lastPart.charAt(0).toUpperCase()}.`;
    }
    return `${first} ${lastPart.charAt(0).toUpperCase()}.`;
  }

  return {
    loadData,
    WEEKDAYS,
    ALL_DAYS,
    getTutors: () => tutors,
    getSubjects: () => subjects,
    getServiceHours: () => serviceHours,
    getLastUpdated: () => lastUpdated,
    getTodayName: () => ALL_DAYS[new Date().getDay()],
    getFirstName,
    getShortName,
    getSubjectDisplayName: code => {
      const c = String(code || '').toUpperCase();
      const subjObj = subjects.find(s => s.code.toUpperCase() === c);
      return subjObj ? (subjObj.name || subjObj.fullName || '') : '';
    },
    getSubjectCategory: code => {
      const c = String(code || '').toUpperCase();
      const subjObj = subjects.find(s => s.code.toUpperCase() === c);
      return subjObj ? subjObj.category : '';
    },
    getCategories: () => [...new Set(subjects.map(s => s.category))].filter(Boolean).sort(),
    escapeHtml: text => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    parseTimeRange,
    parseSingleTime,
    formatMinutes,
    evaluateTimeWindows,
    getFirstName,
    onDataUpdated,

    getSubjectLiveStatus: function (subjectOrCode, dayName = null, refDate = new Date()) {
      const subj = typeof subjectOrCode === 'string'
        ? subjects.find(s => s.code.toUpperCase() === subjectOrCode.toUpperCase())
        : subjectOrCode;
      const targetDay = dayName || ALL_DAYS[refDate.getDay()];
      if (!subj) return { statusType: 'none', statusText: 'Not Found', isOpenNow: false };

      const schedStr = subj.schedule[targetDay];
      return evaluateTimeWindows(schedStr, targetDay, refDate);
    },

    getSubjectTutorAvailability: function (subjectCode, dayName = null, refDate = new Date()) {
      const today = ALL_DAYS[refDate.getDay()];
      const targetDay = dayName || today;
      const isActualToday = targetDay === today;
      const codeUpper = String(subjectCode || '').toUpperCase();

      const assignedTutors = tutors.filter(t =>
        t.subjects.some(s => s.toUpperCase() === codeUpper)
      );

      const activeNow = [];
      const upcomingToday = [];
      const endedToday = [];
      const onDuty = [];
      const offDuty = [];

      assignedTutors.forEach(t => {
        const shift = t.schedule[targetDay];
        if (shift) {
          const evalResult = evaluateTimeWindows(shift, targetDay, refDate);
          const tutorEntry = {
            fullName: t.fullName,
            firstName: getFirstName(t.fullName),
            shift: shift,
            courses: t.courses,
            isToday: isActualToday,
            timeEval: evalResult
          };

          onDuty.push(tutorEntry);

          if (isActualToday) {
            if (evalResult.isOpenNow) activeNow.push(tutorEntry);
            else if (evalResult.isUpcoming) upcomingToday.push(tutorEntry);
            else if (evalResult.isEnded) endedToday.push(tutorEntry);
          }
        } else {
          offDuty.push({
            fullName: t.fullName,
            firstName: getFirstName(t.fullName),
            schedule: t.schedule,
            courses: t.courses,
            isToday: false,
            timeEval: { isOpenNow: false, isUpcoming: false, isEnded: false, statusType: 'none' }
          });
        }
      });

      return {
        activeNow,
        upcomingToday,
        endedToday,
        onDuty,
        offDuty,
        all: assignedTutors,
        isActualToday,
        hasActiveTutors: activeNow.length > 0
      };
    },

    getCourseAvailability: function (courseCode, dayName = null, refDate = new Date()) {
      const today = ALL_DAYS[refDate.getDay()];
      const targetDay = dayName || today;
      const isActualToday = targetDay === today;
      const cLower = String(courseCode || '').toLowerCase().trim();

      const assignedTutors = tutors.filter(t =>
        t.courses.some(c => c.toLowerCase() === cLower)
      );

      if (!assignedTutors.length) {
        return {
          statusType: 'none',
          statusText: 'General Help',
          isOpenNow: false,
          isUpcoming: false,
          isEnded: false,
          activeCount: 0,
          tutors: []
        };
      }

      const activeNow = [];
      const upcomingToday = [];
      const endedToday = [];
      const onDuty = [];

      assignedTutors.forEach(t => {
        const shift = t.schedule[targetDay];
        if (shift) {
          const evalRes = evaluateTimeWindows(shift, targetDay, refDate);
          const entry = { fullName: t.fullName, firstName: getFirstName(t.fullName), shift, timeEval: evalRes };
          onDuty.push(entry);
          if (isActualToday) {
            if (evalRes.isOpenNow) activeNow.push(entry);
            else if (evalRes.isUpcoming) upcomingToday.push(entry);
            else if (evalRes.isEnded) endedToday.push(entry);
          }
        }
      });

      // Compute aggregated 5-day schedule across all qualified tutors
      const courseSchedule = {};
      WEEKDAYS.forEach(day => {
        const dayTutors = assignedTutors.filter(t => t.schedule && t.schedule[day]);
        if (!dayTutors.length) {
          courseSchedule[day] = 'Closed';
          return;
        }

        let dayWindows = [];
        dayTutors.forEach(t => {
          const wins = parseTimeRange(t.schedule[day]);
          dayWindows.push(...wins);
        });

        if (!dayWindows.length) {
          courseSchedule[day] = 'Closed';
          return;
        }

        dayWindows.sort((a, b) => a.start - b.start);
        const merged = [];
        dayWindows.forEach(win => {
          if (!merged.length) {
            merged.push({ start: win.start, end: win.end });
          } else {
            const last = merged[merged.length - 1];
            if (win.start <= last.end) {
              last.end = Math.max(last.end, win.end);
            } else {
              merged.push({ start: win.start, end: win.end });
            }
          }
        });

        courseSchedule[day] = merged
          .map(m => `${formatMinutes(m.start)} – ${formatMinutes(m.end)}`)
          .join(', ');
      });

      if (!isActualToday) {
        return {
          statusType: onDuty.length ? 'scheduled' : 'none',
          statusText: onDuty.length ? `${onDuty.length} Tutor${onDuty.length > 1 ? 's' : ''} on ${targetDay}` : `No Tutors on ${targetDay}`,
          isOpenNow: false,
          isUpcoming: false,
          isEnded: false,
          activeCount: onDuty.length,
          tutors: assignedTutors,
          schedule: courseSchedule
        };
      }

      if (activeNow.length > 0) {
        return {
          statusType: 'open',
          statusText: `Live Help Available (${activeNow.map(t => t.firstName || t.fullName).join(', ')})`,
          isOpenNow: true,
          isAvailableNow: true,
          isUpcoming: false,
          isEnded: false,
          activeCount: activeNow.length,
          tutors: assignedTutors,
          schedule: courseSchedule
        };
      }

      if (upcomingToday.length > 0) {
        const nextStart = upcomingToday[0].timeEval.nextWindow ? upcomingToday[0].timeEval.nextWindow.startStr : 'Later';
        return {
          statusType: 'upcoming',
          statusText: `Tutoring available at ${nextStart} (${upcomingToday[0].firstName || upcomingToday[0].fullName})`,
          isOpenNow: false,
          isAvailableNow: false,
          isUpcoming: true,
          isEnded: false,
          activeCount: 0,
          tutors: assignedTutors,
          schedule: courseSchedule
        };
      }

      if (endedToday.length > 0) {
        return {
          statusType: 'ended',
          statusText: 'Tutoring concluded for today',
          isOpenNow: false,
          isAvailableNow: false,
          isUpcoming: false,
          isEnded: true,
          activeCount: 0,
          tutors: assignedTutors,
          schedule: courseSchedule
        };
      }

      // Check next available weekday shift if today has none
      let nextAvailable = null;
      const todayIdx = ALL_DAYS.indexOf(today);
      for (let i = 1; i <= 6; i++) {
        const checkDay = ALL_DAYS[(todayIdx + i) % 7];
        if (WEEKDAYS.includes(checkDay)) {
          const dayTutors = assignedTutors.filter(t => t.schedule && t.schedule[checkDay]);
          if (dayTutors.length > 0) {
            // Find earliest shift on that day
            const shifts = dayTutors.map(t => t.schedule[checkDay]);
            const firstShift = shifts[0].split(/[,|]/)[0].trim();
            const startStr = firstShift.split(/[-–—to]/i)[0].trim();
            nextAvailable = {
              day: checkDay,
              dayShort: checkDay.slice(0, 3),
              timeStr: startStr,
              label: `Next: ${checkDay.slice(0, 3)} ${startStr}`
            };
            break;
          }
        }
      }

      return {
        statusType: 'none',
        statusText: nextAvailable ? nextAvailable.label : 'No tutoring scheduled today',
        isOpenNow: false,
        isAvailableNow: false,
        isUpcoming: false,
        isEnded: false,
        nextAvailable,
        activeCount: 0,
        tutors: assignedTutors,
        schedule: courseSchedule
      };
    },

    filterSubjects: function (filters) {
      const query = (filters.search || '').toLowerCase().trim();
      const today = ALL_DAYS[new Date().getDay()];

      return subjects.filter(subject => {
        const subjectName = (subject.name || subject.fullName || '').toLowerCase();

        if (filters.category && filters.category !== 'all' && subject.category !== filters.category) {
          return false;
        }

        const todaySched = subject.schedule[today];
        const isTodayOnly = filters.availableToday !== undefined ? filters.availableToday : filters.todayOnly;
        if (isTodayOnly && !todaySched) {
          return false;
        }

        if (filters.day && filters.day !== 'all' && !subject.schedule[filters.day]) {
          return false;
        }

        if (!query) return true;

        return subject.code.toLowerCase().includes(query) ||
          subjectName.includes(query) ||
          subject.courses.some(c => c.toLowerCase().includes(query)) ||
          subject.tutors.some(t => t.toLowerCase().includes(query));
      });
    },

    filterTutors: function (filters) {
      const query = (filters.search || '').toLowerCase().trim();
      const today = ALL_DAYS[new Date().getDay()];

      return tutors.filter(tutor => {
        // Today filter
        const isTodayOnly = filters.availableToday !== undefined ? filters.availableToday : filters.todayOnly;
        if (isTodayOnly && !tutor.schedule[today]) {
          return false;
        }

        // Category / Department filter
        if (filters.category && filters.category !== 'all') {
          const tutorSubjects = subjects.filter(s => s.tutors.some(t => t.toLowerCase() === tutor.fullName.toLowerCase()));
          const hasCategory = tutorSubjects.some(s => s.category === filters.category);
          if (!hasCategory) return false;
        }

        if (!query) return true;

        return tutor.fullName.toLowerCase().includes(query) ||
          (tutor.courses || []).some(c => c.toLowerCase().includes(query)) ||
          (tutor.notes || '').toLowerCase().includes(query);
      });
    }
  };
})();
