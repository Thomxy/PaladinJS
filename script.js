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

let touchStartX = 0;
let touchStartY = 0;
let gestureIsMultiTouch = false;

document.addEventListener("touchstart", e => {
    gestureIsMultiTouch = e.touches.length > 1;
    if (!gestureIsMultiTouch && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
});

document.addEventListener("touchend", e => {
    // If it was a two-finger gesture, ignore it completely
    if (gestureIsMultiTouch) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    const threshold = 50; // Minimum movement to count as a swipe
    if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) return;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (deltaX > 0) {
            changeOffset(-OFFSET_STEP);
        } else {
            changeOffset(OFFSET_STEP);
        }
    } else {
        // Vertical swipe
        if (deltaY > 0) {
            changeAltitude(-1);
        } else {
            changeAltitude(1);
        }
    }
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
