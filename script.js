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

// document.addEventListener('touchmove', function(e) {
//     e.preventDefault();
//}, { passive: false });
let maybeRefreshing = false;
window.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0 && e.touches[0].clientY > 0) {
        maybeRefreshing = true;
    } else {
        maybeRefreshing = false;
    }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
    if (maybeRefreshing && e.touches[0].clientY > 10) {
        e.preventDefault();  // Prevent pull-to-refresh
    }
}, { passive: false });

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});

document.addEventListener('touchend', e => {
    const deltaX = e.changedTouches[0].screenX - touchStartX;
    const deltaY = e.changedTouches[0].screenY - touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX > 50) {
            offset = Math.max(MIN_OFFSET, offset - OFFSET_STEP);
            updateImage();
        } else if (deltaX < -50) {
            if (offset < MAX_OFFSET) {
                offset += OFFSET_STEP;
                updateImage();
            }
        }
    } else {
        if (deltaY > 50) {
            altitudeIndex = Math.max(0, altitudeIndex - 1);
            updateImage();
        } else if (deltaY < -50) {
            altitudeIndex = Math.min(altitudes.length - 1, altitudeIndex + 1);
            updateImage();
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
