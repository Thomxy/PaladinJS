// ===== CONFIGURATION =====
const BASE_URL = "https://meteo.arso.gov.si/uploads/probase/www/model/aladin/field";
const ALTITUDES = ["tcc-rr", "vf500m", "vf925hPa", "vf1000m", "vf1500m", "vf2000m", "vf2500m", "vf3000m", "vf4000m", "vf5500m"];
const MIN_OFFSET = 3;
const MAX_OFFSET = 72;
const OFFSET_STEP = 3;
const SWIPE_THRESHOLD = 40; // px
const image = document.getElementById('forecast-image');
const container = document.querySelector('.image-container');
const DISPLAY_TZ = 'Europe/Ljubljana'; // CET/CEST
const MAX_RUNS = 6;
const headerEl = document.getElementById('header');

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
let runs = []; // each item: { dateStr: "YYYYMMDD", timeStr: "0000"|"1200" }
let currentRunIndex = 0; // 0 = newest, increasing = older
let anchorValidUtcMs = null;

const I18N = {
  en: {
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    tccLabel: 'cloud coverage',
    helpTitle: 'How to use',
    helpLi1: 'One finger: swipe left/right to change time; up/down to change altitude.',
    helpLi2: 'Two fingers: pinch to zoom; drag to pan.',
	helpLi3: 'The header turns light gray when viewing a forecast from the past.',
    helpEmailPrefix: 'Questions or suggestions? Email',
    ariaHelp: 'Help',
    ariaCloseHelp: 'Close help',
    ariaChangeLang: 'Change language'
  },
  si: {
    weekdays: ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'],
    tccLabel: 'oblaki',
    helpTitle: 'Kako uporabljati',
    helpLi1: 'En prst: poteg levo/desno za spremembo časa; gor/dol za spremembo višine.',
    helpLi2: 'Dva prsta: ščip za povečavo; povlecite za premik.',
	helpLi3: 'Ozadje glave je svetlo sivo, ko gledate napoved iz preteklosti.',
    helpEmailPrefix: 'Vprašanja ali predlogi? Pišite na',
    ariaHelp: 'Pomoč',
    ariaCloseHelp: 'Zapri pomoč',
    ariaChangeLang: 'Spremeni jezik'
  }
};

// ===== HELPERS =====
function pad(n, length = 2) {
    return n.toString().padStart(length, '0');
}

function getDateString(date) {
    return date.getFullYear().toString() + pad(date.getMonth() + 1) + pad(date.getDate());
}

function fileExists(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

// ===== CORE LOGIC =====
async function findLatestForecast() {
    const today = new Date();
    const dates = [today, new Date(today.getTime() - 86400000)]; // today & yesterday
    const times = ["1200", "0000"];

    for (const d of dates) {
        const dateStr = getDateString(d);
        for (const time of times) {
            const url = `${BASE_URL}/as_${dateStr}-${time}_tcc-rr_si-neighbours_003.png`;
            console.log("Trying:", url);
            if (await fileExists(url)) {
                console.log("✔️ Found:", url);
                forecastDate = dateStr;
                forecastTime = time;
                return;
            }
        }
    }
    throw new Error("No valid forecast base found.");
}

// Build a list of up to MAX_RUNS recent runs by stepping back 12h
async function buildRunList() {
  runs = [];

  // First, find the latest available run (reuse your existing probe logic)
  const today = new Date();
  const candidates = [
    { d: today, t: "1200" },
    { d: today, t: "0000" },
    { d: new Date(today.getTime() - 86400000), t: "1200" },
    { d: new Date(today.getTime() - 86400000), t: "0000" },
  ];

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

  // Step back 12h at a time to collect older runs
  let y = parseInt(latest.dateStr.slice(0, 4), 10);
  let m = parseInt(latest.dateStr.slice(4, 6), 10) - 1;
  let d = parseInt(latest.dateStr.slice(6, 8), 10);
  let hh = latest.timeStr === "1200" ? 12 : 0;

  while (runs.length < MAX_RUNS) {
    const dt = new Date(Date.UTC(y, m, d, hh));
    dt.setUTCHours(dt.getUTCHours() - 12); // minus 12 hours

    const dateStr = dt.getUTCFullYear().toString()
      + pad(dt.getUTCMonth() + 1)
      + pad(dt.getUTCDate());
    const timeStr = dt.getUTCHours() === 12 ? "1200" : "0000";

    // Verify the run exists (check an early step like 003)
    const url = `${BASE_URL}/as_${dateStr}-${timeStr}_tcc-rr_si-neighbours_003.png`;
    const ok = await fileExists(url);
    if (!ok) break;

    runs.push({ dateStr, timeStr });

    // Prepare for next loop
    y = dt.getUTCFullYear(); m = dt.getUTCMonth(); d = dt.getUTCDate(); hh = dt.getUTCHours();
  }

  // Initialize current run/date/time to newest
  currentRunIndex = 0;
  forecastDate = runs[0].dateStr;
  forecastTime = runs[0].timeStr;
}

function updateImage() {
  const offsetStr = pad(offset, 3);
  const altitude = ALTITUDES[altitudeIndex];
  const fileName = `as_${forecastDate}-${forecastTime}_${altitude}_si-neighbours_${offsetStr}.png`;
  const nextSrc = `${BASE_URL}/${fileName}`;

  updateHeader();

  // Show loader only if the load isn't instant
  showLoaderSoon(50);

  const onDone = () => {
    hideLoader();
  };

  image.addEventListener('load', onDone, { once: true });
  image.addEventListener('error', onDone, { once: true });

  image.src = nextSrc;
}

// ===== NAVIGATION =====
function changeOffset(amount) {
  // Fallback for single-run mode (if runs list isn’t present)
  if (!Array.isArray(runs) || runs.length === 0) {
    const newOffset = offset + amount;
    if (newOffset >= MIN_OFFSET && newOffset <= MAX_OFFSET) {
      offset = newOffset;
      updateImage();
    }
    return;
  }

  const step = amount > 0 ? OFFSET_STEP : -OFFSET_STEP;
  let remaining = Math.abs(amount);

  while (remaining > 0) {
    if (step > 0) {
      // Moving forward in time
      if (currentRunIndex > 0) {
        // In an older run: climb up to 012, then hop to newer run at 003
        if (offset < 12) {
          offset += OFFSET_STEP; // 003 -> 006 -> 009 -> 012
        } else {
          // offset === 12: hop to the next newer run at 003
          currentRunIndex -= 1;
          offset = MIN_OFFSET; // 003
        }
      } else {
        // Newest run: advance normally up to MAX_OFFSET
        if (offset + OFFSET_STEP <= MAX_OFFSET) {
          offset += OFFSET_STEP;
        } else {
          // Already at the newest available step; stop
          break;
        }
      }
    } else {
      // Moving backward in time
      if (offset > MIN_OFFSET) {
        offset -= OFFSET_STEP; // 072 -> ... -> 006 -> 003
      } else {
        // offset === 3: hop to the previous (older) run at 012
        if (currentRunIndex < runs.length - 1) {
          currentRunIndex += 1;
          offset = 12; // show only a few steps from older runs
        } else {
          // Already at the oldest we keep; stop
          break;
        }
      }
    }

    remaining -= OFFSET_STEP;
  }

  // Sync base date/time to the selected run and update
  if (runs[currentRunIndex]) {
    forecastDate = runs[currentRunIndex].dateStr;
    forecastTime = runs[currentRunIndex].timeStr;
  }
  updateImage();
}

function changeAltitude(direction) {
    const newIndex = altitudeIndex + direction;
    if (newIndex >= 0 && newIndex < ALTITUDES.length) {
        altitudeIndex = newIndex;
        updateImage();
    }
}

// ===== TOUCH HANDLERS =====
let touchStartX = 0, touchStartY = 0;
let touchMoved = false;
let gestureBeganMultiTouch = false;

// Scoped to the image container instead of document
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

    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > SWIPE_THRESHOLD) changeOffset(-OFFSET_STEP);
        else if (dx < -SWIPE_THRESHOLD) changeOffset(OFFSET_STEP);
    } else {
        if (dy > SWIPE_THRESHOLD) changeAltitude(-1);
        else if (dy < -SWIPE_THRESHOLD) changeAltitude(1);
    }
}, { passive: true });

container.addEventListener('touchcancel', () => {
    gestureBeganMultiTouch = false;
    touchMoved = false;
});

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
	// Initialize language from saved preference or default
	setLang(currentLang);

	 // Toggle language on click
	 const langBtn = document.getElementById('lang-btn');
	 if (langBtn) {
		langBtn.addEventListener('click', () => {
			setLang(currentLang === 'en' ? 'si' : 'en');
		});
	 }
	try {
		await buildRunList();

		// Optional: start at the time step just before "now" within the newest run.
		offset = computeInitialOffset();

		image.addEventListener('load', () => { clampAndApplyTransform(lastScale); });
		window.addEventListener('resize', () => { clampAndApplyTransform(lastScale); });
		
		anchorValidUtcMs = computeValidUtcMs(forecastDate, forecastTime, offset);

		updateImage();


        // Move inline SVG onclicks to addEventListener
        document.getElementById('arrow-left').addEventListener('click', () => changeOffset(-OFFSET_STEP));
        document.getElementById('arrow-right').addEventListener('click', () => changeOffset(OFFSET_STEP));
        document.getElementById('arrow-up').addEventListener('click', () => changeAltitude(1));
        document.getElementById('arrow-down').addEventListener('click', () => changeAltitude(-1));

		image.addEventListener('touchstart', (e) => {
		  if (e.touches.length === 2) {
			initialDistance = getDistance(e.touches);
			lastMidpoint = getMidpoint(e.touches);
		  }
		}, { passive: true });

		image.addEventListener('touchmove', (e) => {
		  if (e.touches.length === 2) {
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
                // Reset initialDistance to prevent jump on next pinch
                initialDistance = 0;
            }
        });

    } catch (err) {
        alert("Forecast data not available.");
        console.error(err);
    }
	
	const helpBtn = document.getElementById('help-btn');
	const helpOverlay = document.getElementById('help-overlay');
	const helpClose = document.getElementById('help-close');

	function openHelp() {
	  helpOverlay.hidden = false;
	}
	function closeHelp() {
	  helpOverlay.hidden = true;
	}

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
});

// Helper function to get distance between two touches (put it anywhere in the file)
function getDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function getMidpoint(touches) {
    const [a, b] = touches;
    return {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2
    };
}

function updateHeader() {
  if (!forecastDate || !forecastTime) return;

  const y = parseInt(forecastDate.slice(0, 4), 10);
  const m = parseInt(forecastDate.slice(4, 6), 10);
  const d = parseInt(forecastDate.slice(6, 8), 10);
  const hh = parseInt(forecastTime.slice(0, 2), 10);
  const mm = parseInt(forecastTime.slice(2, 4), 10);

  const baseUtcMs = Date.UTC(y, m - 1, d, hh, mm);
  const validUtcDate = new Date(baseUtcMs + offset * 3600 * 1000);
  
  if (anchorValidUtcMs != null) {
	const curMs = validUtcDate.getTime();
	if (curMs < anchorValidUtcMs) headerEl.classList.add('header--past');
	else headerEl.classList.remove('header--past');
  }

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(validUtcDate);
  const map = {};
  for (const p of parts) if (!(p.type in map)) map[p.type] = p.value;

  const weekdayName = I18N[currentLang].weekdays[validUtcDate.getDay()];
  const curr = {
    weekday: weekdayName,
    date: `${map.day}/${map.month}/${map.year}`,
    time: `${map.hour}:${map.minute}`,
    alt: formatAltitude(ALTITUDES[altitudeIndex])
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

function formatAltitude(code) {
  if (code === 'tcc-rr') return I18N[currentLang].tccLabel;
  if (code === 'vf925hPa') return '750m';
  const match = /^vf(\d+m)$/.exec(code);
  return match ? match[1] : code;
}

let prevHeader = {
  weekday: null,
  date: null,
  time: null,
  alt: null
};

function flash(el) {
  if (!el) return;
  el.classList.remove('flash'); // allow re-trigger
  void el.offsetWidth;          // force reflow
  el.classList.add('flash');
}

function showLoaderSoon(delay = 120) {
  const el = document.getElementById('loader');
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => { if (el) el.hidden = false; }, delay);
}

function hideLoader() {
  const el = document.getElementById('loader');
  clearTimeout(loaderTimer);
  loaderTimer = null;
  if (el) el.hidden = true;
}

// Compute the base rendered image size (object-fit: contain) inside the container
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

// Clamp translate so you can't pan beyond the image edges, then apply transform
function clampAndApplyTransform(nextScale) {
  // Clamp scale to your desired range
  let s = Math.max(1, Math.min(nextScale, 5));

  const { baseWidth, baseHeight, containerWidth, containerHeight } = getBaseRenderedSize();
  const effW = baseWidth * s;
  const effH = baseHeight * s;

  // Compute max allowed pan from center; if image doesn't fill axis, lock that axis (no pan)
  const maxX = effW > containerWidth ? (effW - containerWidth) / 2 : 0;
  const maxY = effH > containerHeight ? (effH - containerHeight) / 2 : 0;

  if (maxX === 0) lastTranslateX = 0;
  else lastTranslateX = Math.max(-maxX, Math.min(lastTranslateX, maxX));

  if (maxY === 0) lastTranslateY = 0;
  else lastTranslateY = Math.max(-maxY, Math.min(lastTranslateY, maxY));

  lastScale = s;
  image.style.transform = `translate(${lastTranslateX}px, ${lastTranslateY}px) scale(${lastScale})`;
}

function updateHelpText() {
  const t = I18N[currentLang];
  const title = document.getElementById('help-title');
  const li1 = document.getElementById('help-li1');
  const li2 = document.getElementById('help-li2');
  const li3 = document.getElementById('help-li3');
  const emailPrefix = document.getElementById('help-email-prefix');
  const helpBtn = document.getElementById('help-btn');
  const helpClose = document.getElementById('help-close');

  if (title) title.textContent = t.helpTitle;
  if (li1) li1.textContent = t.helpLi1;
  if (li2) li2.textContent = t.helpLi2;
  if (li3) li3.textContent = t.helpLi3;
  if (emailPrefix) emailPrefix.textContent = t.helpEmailPrefix;
  if (helpBtn) helpBtn.setAttribute('aria-label', t.ariaHelp);
  if (helpClose) helpClose.setAttribute('aria-label', t.ariaCloseHelp);
}

function setLang(lang) {
  currentLang = lang === 'si' ? 'si' : 'en';
  localStorage.setItem('lang', currentLang);

  // Update the small label in the language button
  const code = document.getElementById('lang-code');
  if (code) code.textContent = currentLang.toUpperCase();

  // Update ARIA label for the language button
  const langBtn = document.getElementById('lang-btn');
  if (langBtn) langBtn.setAttribute('aria-label', I18N[currentLang].ariaChangeLang);

  // Refresh header and help texts
  updateHeader();
  updateHelpText();
}

function computeInitialOffset() {
  if (!forecastDate || !forecastTime) return MIN_OFFSET;

  const y = parseInt(forecastDate.slice(0, 4), 10);
  const m = parseInt(forecastDate.slice(4, 6), 10);
  const d = parseInt(forecastDate.slice(6, 8), 10);
  const hh = parseInt(forecastTime.slice(0, 2), 10);
  const mm = parseInt(forecastTime.slice(2, 4), 10);

  // Base run time in UTC
  const baseUtcMs = Date.UTC(y, m - 1, d, hh, mm);

  // "Now" in UTC
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

function computeValidUtcMs(dateStr, timeStr, offHours) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10);
  const d = parseInt(dateStr.slice(6, 8), 10);
  const hh = parseInt(timeStr.slice(0, 2), 10);
  const mm = parseInt(timeStr.slice(2, 4), 10);
  return Date.UTC(y, m - 1, d, hh, mm) + offHours * 3600 * 1000;
}
