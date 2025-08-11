// ===== CONFIGURATION =====
const BASE_URL = "https://meteo.arso.gov.si/uploads/probase/www/model/aladin/field";
const ALTITUDES = ["tcc-rr", "vf500m", "vf1000m", "vf1500m", "vf2000m", "vf2500m", "vf3000m", "vf4000m", "vf5500m"];
const MIN_OFFSET = 3;
const MAX_OFFSET = 72;
const OFFSET_STEP = 3;
const SWIPE_THRESHOLD = 40; // px
const image = document.getElementById('forecast-image');

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
let startPanX = 0;
let startPanY = 0;
let isTwoFingerPanning = false;
let lastTouchDistance = 0;

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

function updateImage() {
    const offsetStr = pad(offset, 3);
    const altitude = ALTITUDES[altitudeIndex];
    const fileName = `as_${forecastDate}-${forecastTime}_${altitude}_si-neighbours_${offsetStr}.png`;
    document.getElementById("forecast-image").src = `${BASE_URL}/${fileName}`;
}

// ===== NAVIGATION =====
function changeOffset(amount) {
    const newOffset = offset + amount;
    if (newOffset >= MIN_OFFSET && newOffset <= MAX_OFFSET) {
        offset = newOffset;
        updateImage();
    }
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

document.addEventListener('touchstart', e => {
    if (e.touches.length > 1) {
        gestureBeganMultiTouch = true;
    } else {
        gestureBeganMultiTouch = false;
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
}, { passive: true });

document.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
        e.preventDefault();
        touchMoved = true;
    } else {
        gestureBeganMultiTouch = true;
    }
}, { passive: false });

document.addEventListener('touchend', e => {
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

document.addEventListener('touchcancel', () => {
    gestureBeganMultiTouch = false;
    touchMoved = false;
});

function getMidpoint(touches) {
  const [a, b] = touches;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await findLatestForecast();
        updateImage();

        image.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                initialDistance = getDistance(e.touches);
                lastMidpoint = getMidpoint(e.touches);
            }
        }, { passive: false });

        image.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();

                const currentDistance = getDistance(e.touches);
                const currentMidpoint = getMidpoint(e.touches);

                // Calculate scale factor change
                let scaleChange = currentDistance / initialDistance;
                let newScale = lastScale * scaleChange;
                newScale = Math.min(Math.max(newScale, 1), 5);

                // Calculate translation change (pan delta)
                let deltaX = currentMidpoint.x - lastMidpoint.x;
                let deltaY = currentMidpoint.y - lastMidpoint.y;

                // Update translate position factoring scale
                lastTranslateX += deltaX;
                lastTranslateY += deltaY;

                // Apply transform
                image.style.transform = `translate(${lastTranslateX}px, ${lastTranslateY}px) scale(${newScale})`;

                // Update last states for next event
                lastScale = newScale;
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
