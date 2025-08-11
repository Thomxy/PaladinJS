// Forecast state
const BASE_URL = "https://meteo.arso.gov.si/uploads/probase/www/model/aladin/field";
const altitudes = ["tcc-rr", "vf500m", "vf1000m", "vf1500m", "vf2000m", "vf2500m", "vf3000m", "vf4000m", "vf5500m"];
const MIN_OFFSET = 3;
const MAX_OFFSET = 72;
const OFFSET_STEP = 3;

let offset = MIN_OFFSET;     // starts at 3h
let altitudeIndex = 0;       // index in the altitudes list
let forecastDate = null;     // e.g. "20250806"
let forecastTime = null;     // "1200" or "0000"

function pad(n) {
    return n.toString().padStart(2, '0');
}

function getDateString(date) {
    return date.getFullYear().toString() +
           pad(date.getMonth() + 1) +
           pad(date.getDate());
}

async function findLatestForecast() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dates = [today, yesterday];
    const times = ["1200", "0000"];

    for (const d of dates) {
        const dateStr = getDateString(d);
        for (const time of times) {
            const filename = `as_${dateStr}-${time}_tcc-rr_si-neighbours_003.png`;
            const url = `${BASE_URL}/${filename}`;

            // 👇 Add this debug line
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

function fileExists(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

// Build and load the image
function updateImage() {
    const offsetStr = String(offset).padStart(3, "0");
    const altitude = altitudes[altitudeIndex];
    const fileName = `as_${forecastDate}-${forecastTime}_${altitude}_si-neighbours_${offsetStr}.png`;
    const imageUrl = `${BASE_URL}/${fileName}`;

    document.getElementById("forecast-image").src = imageUrl;
}

// Handle offset changes
function changeOffset(amount) {
    const newOffset = offset + amount;
    if (newOffset >= MIN_OFFSET && newOffset <= MAX_OFFSET) {
        offset = newOffset;
        updateImage();
    }
}

// Handle altitude changes
function changeAltitude(direction) {
    const newIndex = altitudeIndex + direction;
    if (newIndex >= 0 && newIndex < altitudes.length) {
        altitudeIndex = newIndex;
        updateImage();
    }
}

// gesture helpers
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;
let gestureBeganMultiTouch = false;

// touchstart: mark if the gesture has >1 finger or store start coords for single-finger
document.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1) {
    gestureBeganMultiTouch = true;
  } else {
    gestureBeganMultiTouch = false;
    touchMoved = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

// touchmove: if single-finger, prevent default (blocks browser one-finger pan) and mark moved.
// For multi-touch, do not preventDefault so browser can handle pinch + two-finger pan.
document.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1) {
    // prevent the browser from panning the zoomed image with one finger
    e.preventDefault();          // NEEDS passive:false on this listener (done below)
    touchMoved = true;
  } else {
    // multi-touch in progress: remember the gesture involved >1 finger
    gestureBeganMultiTouch = true;
  }
}, { passive: false });

// touchend: if the gesture ever had >1 finger, ignore it (pinch/2-finger pan).
// Otherwise, if there was a meaningful single-finger move, treat it as a swipe.
document.addEventListener('touchend', (e) => {
  // Clean-up: if gesture was multi-touch, reset the flag and do nothing
  if (gestureBeganMultiTouch) {
    // if no more touches are active, reset for next gesture
    if (!e.touches || e.touches.length === 0) {
      gestureBeganMultiTouch = false;
    }
    return;
  }

  // if no meaningful move, ignore (taps etc.)
  if (!touchMoved) return;

  // compute movement delta using the first changed touch
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const threshold = 40; // adjust sensitivity if you want

  if (Math.abs(dx) > Math.abs(dy)) {
    // horizontal swipe
    if (dx > threshold) changeOffset(-OFFSET_STEP);   // swipe right -> back
    else if (dx < -threshold) changeOffset(OFFSET_STEP); // swipe left -> forward
  } else {
    // vertical swipe
    if (dy > threshold) changeAltitude(-1);   // swipe down -> lower altitude
    else if (dy < -threshold) changeAltitude(1); // swipe up -> higher altitude
  }
}, { passive: true });

// touchcancel: reset flags
document.addEventListener('touchcancel', () => {
  gestureBeganMultiTouch = false;
  touchMoved = false;
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await findLatestForecast();  // sets forecastDate and forecastTime
        updateImage();
    } catch (err) {
        alert("Forecast data not available.");
        console.error(err);
    }
});
