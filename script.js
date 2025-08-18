// ============================================================
// Paladin Forecast Viewer — Refactored & Commented
// ------------------------------------------------------------
// Functionality unchanged. Logic grouped, comments added,
// a couple of tiny cleanups (dead code removed).
// ============================================================

// ===== CONFIGURATION =====
const BASE_URL = "https://meteo.arso.gov.si/uploads/probase/www/model/aladin/field";
const ALTITUDES = ["tcc-rr", "vf500m", "vf925hPa", "vf1000m", "vf1500m", "vf2000m", "vf2500m", "vf3000m", "vf4000m", "vf5500m"];
const MIN_OFFSET = 3;
const MAX_OFFSET = 72;
const OFFSET_STEP = 3;
const SWIPE_THRESHOLD = 40; // px for swipe decision
const DISPLAY_TZ = 'Europe/Ljubljana'; // CET/CEST for header
const MAX_RUNS = 6;

// Hotspot metadata (10m mode)
const hotspotSuffixes = [
  "_hr-w",
  "_si-central",
  "_si-ne",
  "_si-nw",
  "_si-se",
  "_si-sw"
];
const hotspotPositions = [
  { x: 277, y: 383 },
  { x: 332, y: 218 },
  { x: 462, y: 127 },
  { x: 245, y: 170 },
  { x: 409, y: 275 },
  { x: 239, y: 296 }
];

// ===== DOM REFERENCES (queried once) =====
const image = document.getElementById('forecast-image');
const container = document.querySelector('.image-container');
const headerEl = document.getElementById('header');
const helpIconsStrip = document.getElementById('help-icons-strip');

// ===== STATE =====
let offset = MIN_OFFSET;
let altitudeIndex = 0;
let forecastDate = null;
let forecastTime = null;
let lastScale = 1;
let initialDistance = 0;
let lastTranslateX = 0;
let lastTranslateY = 0;
let lastMidpoint = { x: 0, y: 0 };
let loaderTimer = null;
let currentLang = localStorage.getItem('lang') || 'en';

// Run handling
let runs = []; // each: { dateStr: "YYYYMMDD", timeStr: "0000"|"1200" }
let currentRunIndex = 0; // 0 = newest
let anchorValidUtcMs = null;

// 10m mode
let tenmOriginalState = null; // stores previous mode state to restore later
let tenmHotspotIndex = null;  // which hotspot is active (0..5) or null when not in 10m view

// UI misc
let iconsHidden = false;
let hotspotElements = [];

// ===== I18N =====
const I18N = {
  en: {
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    tccLabel: 'cloud coverage',
    helpTitle: 'How to use',
    helpLi1: 'One finger: swipe left/right to change time; up/down to change altitude.',
    helpLi2: 'Two fingers: pinch to zoom; drag to pan.',
    helpLi3: 'The header turns gray when viewing a forecast from the past.',
    helpLi4: 'On the computer, use onscreen arrows or cursor keys.',
    helpLi5: 'Tap the "10m" button in the top left corner to activate the ground level wind hotspots.',
    helpEmailPrefix: 'Questions or suggestions? Email',
    ariaHelp: 'Help',
    ariaCloseHelp: 'Close help',
    ariaChangeLang: 'Change language'
  },
  si: {
    weekdays: ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'],
    tccLabel: 'oblačnost',
    helpTitle: 'Kako uporabljati',
    helpLi1: 'En prst: levo/desno za spremembo časa; gor/dol za spremembo višine.',
    helpLi2: 'Dva prsta: ščip za povečavo; povlecite za premik.',
    helpLi3: 'Ozadje glave je sivo, ko gledate napoved iz preteklosti.',
    helpLi4: 'Na računalniku uporabite gumbe na ekranu ali kurzorske tipke.',
    helpLi5: 'Gumb "10m" v zgornjem levem kotu aktivira točke za veter pri tleh.',
    helpEmailPrefix: 'Vprašanja ali predlogi? Pišite na',
    ariaHelp: 'Pomoč',
    ariaCloseHelp: 'Zapri pomoč',
    ariaChangeLang: 'Spremeni jezik'
  }
};

// ============================================================
// HELPERS
// ============================================================
function pad(n, length = 2) {
  return n.toString().padStart(length, '0');
}

function getDateString(date) {
  return date.getFullYear().toString() + pad(date.getMonth() + 1) + pad(date.getDate());
}

/** Probe image URL existence (used to build run list) */
function fileExists(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Distance between two touches (pinch) */
function getDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

/** Midpoint between two touches (for pan/zoom focal point) */
function getMidpoint(touches) {
  const [a, b] = touches;
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

// ============================================================
// FORECAST RUN DISCOVERY & IMAGE LOADING
// ============================================================
/**
 * Build a list of recent forecast runs (up to MAX_RUNS), stepping back 12h.
 * Sets forecastDate/forecastTime to the latest available.
 */
async function buildRunList() {
  runs = [];

  const today = new Date();
  const candidates = [
    { d: today, t: "1200" },
    { d: today, t: "0000" },
    { d: new Date(today.getTime() - 86400000), t: "1200" },
    { d: new Date(today.getTime() - 86400000), t: "0000" },
  ];

  // Find latest available run
  let latest = null;
  for (const c of candidates) {
    const dateStr = getDateString(c.d);
    const url = `${BASE_URL}/as_${dateStr}-${c.t}_tcc-rr_si-neighbours_003.png`;
    if (await fileExists(url)) {
      latest = { dateStr, timeStr: c.t };
      break;
    }
  }
  if (!latest) throw new Error("No valid forecast base found.");

  runs.push(latest);

  // Step back 12h at a time
  let y = parseInt(latest.dateStr.slice(0, 4), 10);
  let m = parseInt(latest.dateStr.slice(4, 6), 10) - 1;
  let d = parseInt(latest.dateStr.slice(6, 8), 10);
  let hh = latest.timeStr === "1200" ? 12 : 0;

  while (runs.length < MAX_RUNS) {
    const dt = new Date(Date.UTC(y, m, d, hh));
    dt.setUTCHours(dt.getUTCHours() - 12);

    const dateStr = dt.getUTCFullYear().toString() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate());
    const timeStr = dt.getUTCHours() === 12 ? "1200" : "0000";

    const url = `${BASE_URL}/as_${dateStr}-${timeStr}_tcc-rr_si-neighbours_003.png`;
    const ok = await fileExists(url);
    if (!ok) break;

    runs.push({ dateStr, timeStr });

    y = dt.getUTCFullYear(); m = dt.getUTCMonth(); d = dt.getUTCDate(); hh = dt.getUTCHours();
  }

  // Initialize to newest run
  currentRunIndex = 0;
  forecastDate = runs[0].dateStr;
  forecastTime = runs[0].timeStr;
}

/** Load the main forecast image for the current (date, time, altitude, offset). */
function updateImage() {
  const offsetStr = pad(offset, 3);
  const altitude = ALTITUDES[altitudeIndex];
  const fileName = `as_${forecastDate}-${forecastTime}_${altitude}_si-neighbours_${offsetStr}.png`;
  const nextSrc = `${BASE_URL}/${fileName}`;

  updateHeader();
  showLoaderSoon(50);

  image.addEventListener('load', () => {
    hideLoader();
    image.style.visibility = 'visible';
  }, { once: true });

  image.addEventListener('error', () => {
    hideLoader();
  }, { once: true });

  image.src = nextSrc;
}

// ============================================================
// HELP ICON STRIP (MOBILE HINTS)
// ============================================================
function hideHelpIcons() {
  if (!iconsHidden) {
    iconsHidden = true;
    helpIconsStrip.classList.add('hidden');
  }
}
function showHelpIcons() {
  if (iconsHidden) {
    iconsHidden = false;
    helpIconsStrip.classList.remove('hidden');
  }
}

// ============================================================
// NAVIGATION: TIME & ALTITUDE
// ============================================================
/**
 * Move forward/backward by a number of hours (positive/negative).
 * Steps are in 3h. Seamlessly switch to the next/previous run when needed.
 */
function changeOffset(amount) {
  const step = amount > 0 ? OFFSET_STEP : -OFFSET_STEP;
  let remaining = Math.abs(amount);

  while (remaining > 0) {
    if (step > 0) {
      // Moving forward
      if (currentRunIndex > 0) {
        // We have older runs available (index > 0 means newer run index smaller)
        if (offset < 12) {
          offset += OFFSET_STEP;
        } else {
          currentRunIndex -= 1;
          offset = MIN_OFFSET;
        }
      } else {
        // At newest run
        if (offset + OFFSET_STEP <= MAX_OFFSET) {
          offset += OFFSET_STEP;
        } else {
          break; // can't go beyond available forecast
        }
      }
    } else {
      // Moving backward
      if (offset > MIN_OFFSET) {
        offset -= OFFSET_STEP;
      } else {
        if (currentRunIndex < runs.length - 1) {
          currentRunIndex += 1;
          offset = 12;
        } else {
          break; // reached oldest
        }
      }
    }
    remaining -= OFFSET_STEP;
  }

  if (runs[currentRunIndex]) {
    forecastDate = runs[currentRunIndex].dateStr;
    forecastTime = runs[currentRunIndex].timeStr;
  }

  updateHeader();
  if (tenmHotspotIndex !== null) {
    loadTenmHotspotImage();
  } else {
    updateImage();
  }
}

/** Change altitude layer by +1/-1 within bounds. */
function changeAltitude(direction) {
  const newIndex = altitudeIndex + direction;
  if (newIndex >= 0 && newIndex < ALTITUDES.length) {
    altitudeIndex = newIndex;
    updateImage();
  }
}

// ============================================================
// TOUCH / GESTURE HANDLERS (on container + image)
// - Single-finger swipe: time/altitude
// - Two-finger pinch/drag: zoom/pan
// ============================================================
let touchStartX = 0, touchStartY = 0;
let touchMoved = false;
let gestureBeganMultiTouch = false;

// Scoped to the image container to avoid interfering with dialogs
container.addEventListener('touchstart', e => {
  if (e.touches.length > 1) {
    gestureBeganMultiTouch = true;
  } else {
    gestureBeganMultiTouch = false;
    touchMoved = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

container.addEventListener('touchmove', e => {
  if (e.touches.length === 1) {
    e.preventDefault();
    touchMoved = true;
  } else {
    gestureBeganMultiTouch = true;
  }
}, { passive: false });

container.addEventListener('touchend', e => {
  if (gestureBeganMultiTouch) {
    if (!e.touches || e.touches.length === 0) gestureBeganMultiTouch = false;
    return;
  }
  if (!touchMoved) return;

  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  if (tenmOriginalState) {
    // In 10m mode: only horizontal swipes control time
    if (dx > SWIPE_THRESHOLD) changeOffset(-OFFSET_STEP);
    else if (dx < -SWIPE_THRESHOLD) changeOffset(OFFSET_STEP);
  } else {
    // Normal mode: horizontal = time, vertical = altitude
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > SWIPE_THRESHOLD) changeOffset(-OFFSET_STEP);
      else if (dx < -SWIPE_THRESHOLD) changeOffset(OFFSET_STEP);
    } else {
      if (dy > SWIPE_THRESHOLD) changeAltitude(-1);
      else if (dy < -SWIPE_THRESHOLD) changeAltitude(1);
    }
  }
}, { passive: true });

container.addEventListener('touchcancel', () => {
  gestureBeganMultiTouch = false;
  touchMoved = false;
});

// ============================================================
// HOTSPOTS / 10m MODE
// ============================================================
/** Create overlay hotspot elements and position them (called when entering 10m mode). */
function createHotspots() {
  hotspotElements = hotspotPositions.map((pos, idx) => {
    const el = document.createElement('div');
    el.className = 'hotspot';
    el.addEventListener('click', () => { enterTenmHotspotMode(idx); });
    container.appendChild(el);
    positionHotspot(el, pos);
    return el;
  });
}

/** Compute hotspot position in screen coords, including zoom/pan transforms. */
function positionHotspot(el, pos) {
  const { baseWidth, baseHeight, containerWidth, containerHeight } = getBaseRenderedSize();

  // Base position in container when scale = 1 and no pan
  const imgLeft = (containerWidth - baseWidth) / 2;
  const imgTop  = (containerHeight - baseHeight) / 2;

  // Scale from natural image coords to base rendered coords
  const scaleX = baseWidth / (image.naturalWidth || baseWidth);
  const scaleY = baseHeight / (image.naturalHeight || baseHeight);

  let x = imgLeft + pos.x * scaleX;
  let y = imgTop  + pos.y * scaleY;

  // Apply current zoom & pan
  x = containerWidth / 2 + (x - containerWidth / 2) * lastScale + lastTranslateX;
  y = containerHeight / 2 + (y - containerHeight / 2) * lastScale + lastTranslateY;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function removeHotspots() {
  hotspotElements.forEach(el => el.remove());
  hotspotElements = [];
}

/** Recompute hotspot positions (call on resize and after zoom/pan). */
function updateHotspots() {
  hotspotElements.forEach((el, i) => positionHotspot(el, hotspotPositions[i]));
}

// ============================================================
// HEADER / LOADER / SIZING / TRANSFORM
// ============================================================
let prevHeader = { weekday: null, date: null, time: null, alt: null };

/** Update the header texts and "past" styling. */
function updateHeader() {
  if (!forecastDate || !forecastTime) return;
  const headerText = document.getElementById('header-text');

  // If we are still on the initial "Loading..." content, replace it with structured spans
  if (headerText && headerText.textContent === "Loading...") {
    headerText.innerHTML = `
      <span id="header-weekday"></span>
      <span id="header-date"></span>
      <span id="header-time"></span><br>
      <span id="header-alt"></span>
    `;
  }

  const y = parseInt(forecastDate.slice(0, 4), 10);
  const m = parseInt(forecastDate.slice(4, 6), 10);
  const d = parseInt(forecastDate.slice(6, 8), 10);
  const hh = parseInt(forecastTime.slice(0, 2), 10);
  const mm = parseInt(forecastTime.slice(2, 4), 10);

  const baseUtcMs = Date.UTC(y, m - 1, d, hh, mm);
  const validUtcDate = new Date(baseUtcMs + offset * 3600 * 1000);
  
  // Header gray if viewing before the "anchor" valid time (the time shown when the page loaded)
  if (anchorValidUtcMs != null) {
    const curMs = validUtcDate.getTime();
    if (curMs < anchorValidUtcMs) headerEl.classList.add('header--past');
    else headerEl.classList.remove('header--past');
  }

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(validUtcDate);
  const map = {};
  for (const p of parts) if (!(p.type in map)) map[p.type] = p.value;

  const weekdayName = I18N[currentLang].weekdays[validUtcDate.getDay()];
  const curr = {
    weekday: weekdayName,
    date: `${map.day}/${map.month}/${map.year}`,
    time: `${map.hour}:${map.minute}`,
    alt: (tenmHotspotIndex !== null) ? '10m' : formatAltitude(ALTITUDES[altitudeIndex])
  };

  const elWeek = document.getElementById('header-weekday');
  const elDate = document.getElementById('header-date');
  const elTime = document.getElementById('header-time');
  const elAlt  = document.getElementById('header-alt');

  if (elWeek && elWeek.textContent !== curr.weekday) {
    elWeek.textContent = curr.weekday;
    if (prevHeader.weekday !== null) flash(elWeek);
  }
  if (elDate && elDate.textContent !== curr.date) {
    elDate.textContent = curr.date;
    if (prevHeader.date !== null) flash(elDate);
  }
  if (elTime && elTime.textContent !== curr.time) {
    elTime.textContent = curr.time;
    if (prevHeader.time !== null) flash(elTime);
  }
  if (elAlt && elAlt.textContent !== curr.alt) {
    elAlt.textContent = curr.alt;
    if (prevHeader.alt !== null) flash(elAlt);
  }

  prevHeader = curr;
}

/** Human-friendly altitude label */
function formatAltitude(code) {
  if (code === 'tcc-rr') return I18N[currentLang].tccLabel;
  if (code === 'vf925hPa') return '750m';
  const match = /^vf(\d+m)$/.exec(code);
  return match ? match[1] : code;
}

/** Tiny flash animation when header part changes */
function flash(el) {
  if (!el) return;
  el.classList.remove('flash'); // allow re-trigger
  void el.offsetWidth;          // force reflow
  el.classList.add('flash');
}

/** Show the loader with a slight delay (prevents flicker on fast loads) */
function showLoaderSoon(delay = 120) {
  const el = document.getElementById('loader');
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => { if (el) el.hidden = false; }, delay);
}

/** Hide the loader now */
function hideLoader() {
  const el = document.getElementById('loader');
  clearTimeout(loaderTimer);
  loaderTimer = null;
  if (el) el.hidden = true;
}

/** Compute the base rendered size of the image (object-fit: contain) */
function getBaseRenderedSize() {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const iw = image.naturalWidth || cw;
  const ih = image.naturalHeight || ch;

  const containScale = Math.min(cw / iw, ch / ih) || 1;
  const baseWidth = iw * containScale;
  const baseHeight = ih * containScale;

  return { baseWidth, baseHeight, containerWidth: cw, containerHeight: ch };
}

/** Clamp pan/zoom so the image never leaves the viewport; then apply transform. */
function clampAndApplyTransform(nextScale) {
  let s = Math.max(1, Math.min(nextScale, 5));
  const { baseWidth, baseHeight, containerWidth, containerHeight } = getBaseRenderedSize();
  const effW = baseWidth * s;
  const effH = baseHeight * s;

  const maxX = effW > containerWidth ? (effW - containerWidth) / 2 : 0;
  const maxY = effH > containerHeight ? (effH - containerHeight) / 2 : 0;

  if (maxX === 0) lastTranslateX = 0; else lastTranslateX = Math.max(-maxX, Math.min(lastTranslateX, maxX));
  if (maxY === 0) lastTranslateY = 0; else lastTranslateY = Math.max(-maxY, Math.min(lastTranslateY, maxY));

  lastScale = s;
  image.style.transform = `translate(${lastTranslateX}px, ${lastTranslateY}px) scale(${lastScale})`;

  // Show mobile help icons only when near-unzoomed and portrait
  if (Math.abs(lastScale - 1) < 0.05 && window.innerHeight >= window.innerWidth) {
    showHelpIcons();
  } else {
    hideHelpIcons();
  }
}

// ============================================================
// HELP OVERLAY & LANGUAGE
// ============================================================
/** Update the help dialog texts and ARIA labels for current language. */
function updateHelpText() {
  const t = I18N[currentLang];
  const title = document.getElementById('help-title');
  const li1 = document.getElementById('help-li1');
  const li2 = document.getElementById('help-li2');
  const li3 = document.getElementById('help-li3');
  const li4 = document.getElementById('help-li4');
  const li5 = document.getElementById('help-li5');
  const emailPrefix = document.getElementById('help-email-prefix');
  const helpBtn = document.getElementById('help-btn');
  const helpClose = document.getElementById('help-close');

  if (title) title.textContent = t.helpTitle;
  if (li1) li1.textContent = t.helpLi1;
  if (li2) li2.textContent = t.helpLi2;
  if (li3) li3.textContent = t.helpLi3;
  if (li4) li4.textContent = t.helpLi4;
  if (li5) li5.textContent = t.helpLi5;
  if (emailPrefix) emailPrefix.textContent = t.helpEmailPrefix;
  if (helpBtn) helpBtn.setAttribute('aria-label', t.ariaHelp);
  if (helpClose) helpClose.setAttribute('aria-label', t.ariaCloseHelp);
}

/** Set language (en|si), persist to localStorage, refresh texts. */
function setLang(lang) {
  currentLang = lang === 'si' ? 'si' : 'en';
  localStorage.setItem('lang', currentLang);

  // The header lang button shows the *other* locale code
  const code = document.getElementById('lang-code');
  if (code) code.textContent = (currentLang === 'en' ? 'si' : 'en').toUpperCase();

  // Update ARIA label for the language button
  const langBtn = document.getElementById('lang-btn');
  if (langBtn) langBtn.setAttribute('aria-label', I18N[currentLang].ariaChangeLang);

  // Refresh header and help texts
  updateHeader();
  updateHelpText();
}

// ============================================================
// TIME HELPERS
// ============================================================
/** Compute an initial offset that is "just before now", clamped to available range. */
function computeInitialOffset() {
  if (!forecastDate || !forecastTime) return MIN_OFFSET;

  const y = parseInt(forecastDate.slice(0, 4), 10);
  const m = parseInt(forecastDate.slice(4, 6), 10);
  const d = parseInt(forecastDate.slice(6, 8), 10);
  const hh = parseInt(forecastTime.slice(0, 2), 10);
  const mm = parseInt(forecastTime.slice(2, 4), 10);

  // Base run time in UTC
  const baseUtcMs = Date.UTC(y, m - 1, d, hh, mm);

  // "Now" in UTC (ms)
  const nowMs = Date.now();

  // Hours between now and base run
  const diffHours = Math.floor((nowMs - baseUtcMs) / 3600000);

  // Round down to the nearest available step (3h) so it's "just before now"
  let stepped = Math.floor(diffHours / OFFSET_STEP) * OFFSET_STEP;

  // Clamp to available forecast range
  if (stepped < MIN_OFFSET) stepped = MIN_OFFSET;
  if (stepped > MAX_OFFSET) stepped = MAX_OFFSET;

  return stepped;
}

/** Convert (run date/time, offset hours) to a UTC ms timestamp for comparison. */
function computeValidUtcMs(dateStr, timeStr, offHours) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10);
  const d = parseInt(dateStr.slice(6, 8), 10);
  const hh = parseInt(timeStr.slice(0, 2), 10);
  const mm = parseInt(timeStr.slice(2, 4), 10);
  return Date.UTC(y, m - 1, d, hh, mm) + offHours * 3600 * 1000;
}

// ============================================================
// 10m HOTSPOT MODE
// ============================================================
/**
 * Enter the "10m hotspot mode" focusing on a specific hotspot region.
 * Saves current zoom/pan/altitude to restore when exiting.
 */
function enterTenmHotspotMode(hIndex) {
  if (!tenmOriginalState) {
    tenmOriginalState = {
      altitudeIndex,
      lastScale,
      lastTranslateX,
      lastTranslateY
    };
  }

  removeHotspots();
  tenmHotspotIndex = hIndex;

  // Sentinel altitude to mark 10m mode
  altitudeIndex = -1;
  container.style.touchAction = 'pan-x'; // prevent vertical gestures in 10m mode
  document.getElementById('arrow-up').style.display = 'none';
  document.getElementById('arrow-down').style.display = 'none';
  document.addEventListener('keydown', blockVerticalKeys, true);

  // Show fewer mobile help icons to make space
  helpIconsStrip.innerHTML = `
    <img src="img/002.png" alt="Icon 2">
    <img src="img/003.png" alt="Icon 3">
    <img src="img/004.png" alt="Icon 4">
  `;
  showHelpIcons();
  document.getElementById('header-alt').textContent = '10m';

  loadTenmHotspotImage(() => {
    // Always start 10m mode unzoomed
    lastScale = 1;
    lastTranslateX = 0;
    lastTranslateY = 0;
    clampAndApplyTransform(1);
  });
}

/** Load the 10m hotspot image for the current time step and active hotspot. */
function loadTenmHotspotImage(onLoaded) {
  const offsetStr = pad(offset, 3);
  const fileName = `ad_${forecastDate}-${forecastTime}_vm-va10m${hotspotSuffixes[tenmHotspotIndex]}_${offsetStr}.png`;
  const nextSrc = `${BASE_URL}/${fileName}?t=${Date.now()}`; // cache-bust

  updateHeader();
  showLoaderSoon(50);

  image.addEventListener('load', () => {
    hideLoader();
    if (onLoaded) onLoaded();
  }, { once: true });

  image.src = nextSrc;
}

/** Exit 10m mode and restore previous view state (layer/zoom/pan). */
function exitTenmHotspotMode() {
  if (!tenmOriginalState) return;

  const s = tenmOriginalState;
  tenmOriginalState = null;
  tenmHotspotIndex = null;

  container.style.touchAction = 'none';
  document.getElementById('arrow-up').style.display = '';
  document.getElementById('arrow-down').style.display = '';
  document.removeEventListener('keydown', blockVerticalKeys, true);

  helpIconsStrip.innerHTML = `
    <img src="img/001.png" alt="Icon 1">
    <img src="img/002.png" alt="Icon 2">
    <img src="img/003.png" alt="Icon 3">
    <img src="img/004.png" alt="Icon 4">
  `;

  // Restore zoom & pan & altitude
  altitudeIndex = s.altitudeIndex;
  lastScale = s.lastScale;
  lastTranslateX = s.lastTranslateX;
  lastTranslateY = s.lastTranslateY;

  clampAndApplyTransform(lastScale);

  updateHeader();
  updateImage(); // show normal layer at current date/time/offset
}

/** Block vertical navigation keys while in 10m mode. */
function blockVerticalKeys(e) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  }
}

// ============================================================
// INIT (DOMContentLoaded)
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  // Language init & toggle
  setLang(currentLang);
  const langBtn = document.getElementById('lang-btn');
  if (langBtn) {
    langBtn.addEventListener('click', () => setLang(currentLang === 'en' ? 'si' : 'en'));
  }
  
  try {
    // Discover available runs, pick starting offset close to "now"
    await buildRunList();
    offset = computeInitialOffset();

    // For "past" shading logic
    anchorValidUtcMs = computeValidUtcMs(forecastDate, forecastTime, offset);

    // Keep transform constraints fresh
    image.addEventListener('load', () => { clampAndApplyTransform(lastScale); });
    window.addEventListener('resize', () => { clampAndApplyTransform(lastScale); });

    // Load first image
    updateImage();

    // Arrow buttons
    document.getElementById('arrow-left').addEventListener('click', () => changeOffset(-OFFSET_STEP));
    document.getElementById('arrow-right').addEventListener('click', () => changeOffset(OFFSET_STEP));
    document.getElementById('arrow-up').addEventListener('click', () => changeAltitude(1));
    document.getElementById('arrow-down').addEventListener('click', () => changeAltitude(-1));

    // Pinch-zoom on the image element (two-finger gestures only)
    image.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialDistance = getDistance(e.touches);
        lastMidpoint = getMidpoint(e.touches);
      }
    }, { passive: true });

    image.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        hideHelpIcons();
        e.preventDefault();

        const currentDistance = getDistance(e.touches);
        const currentMidpoint = getMidpoint(e.touches);

        // Calculate scale factor change (guard initialDistance)
        const scaleChange = currentDistance / (initialDistance || currentDistance);
        let newScale = lastScale * scaleChange;

        // Pan deltas in screen px
        const deltaX = currentMidpoint.x - lastMidpoint.x;
        const deltaY = currentMidpoint.y - lastMidpoint.y;

        // Update accumulated translation
        lastTranslateX += deltaX;
        lastTranslateY += deltaY;

        // Clamp translation based on new scale and apply
        clampAndApplyTransform(newScale);

        // Update last states for next event
        initialDistance = currentDistance;
        lastMidpoint = currentMidpoint;
      }
    }, { passive: false });

    image.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        // Reset to prevent jump on next pinch
        initialDistance = 0;
      }
    });

  } catch (err) {
    alert("Forecast data not available.");
    console.error(err);
  }
  
  // Help overlay logic
  const helpBtn = document.getElementById('help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  const helpClose = document.getElementById('help-close');

  function openHelp() { helpOverlay.hidden = false; }
  function closeHelp() { helpOverlay.hidden = true; }

  helpBtn.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);

  // Click backdrop to close
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) closeHelp();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !helpOverlay.hidden) closeHelp();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowLeft':  changeOffset(-OFFSET_STEP); break;
      case 'ArrowRight': changeOffset(OFFSET_STEP);  break;
      case 'ArrowUp':    changeAltitude(1);          break;
      case 'ArrowDown':  changeAltitude(-1);         break;
    }
  });
  
  // 10m mode button
  const tenmBtn = document.getElementById('tenm-btn');
  let tenmMode = false;
  if (tenmBtn) {
    tenmBtn.addEventListener('click', () => {
      tenmMode = !tenmMode;
      tenmBtn.classList.toggle('active', tenmMode);
      tenmBtn.setAttribute('aria-pressed', tenmMode ? 'true' : 'false');
      if (tenmMode) {
        createHotspots();
      } else {
        removeHotspots();
        if (tenmOriginalState) exitTenmHotspotMode();
      }
    });
  }

  // Reposition hotspots on resize or zoom/pan
  window.addEventListener('resize', updateHotspots);

  // Hook into clampAndApplyTransform to refresh hotspot positions after every transform
  const originalClamp = clampAndApplyTransform;
  clampAndApplyTransform = function(nextScale) {
    originalClamp(nextScale);
    updateHotspots();
  };
});
