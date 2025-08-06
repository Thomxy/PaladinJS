// Forecast state
const altitudes = ["tcc-rr", "vf500m", "vf1000m", "vf1500m", "vf2000m", "vf2500m", "vf3000m", "vf4000m", "vf5500m"];
const MIN_OFFSET = 3;
const MAX_OFFSET = 72;
const OFFSET_STEP = 3;

let date = "20250805";       // fixed for now
let time = "0000";           // fixed for now
let offset = MIN_OFFSET;     // starts at 3h
let altitudeIndex = 0;       // index in the altitudes list

// Load initial image
updateImage();

// Build and load the image
function updateImage() {
    const offsetStr = String(offset).padStart(3, "0");
    const altitude = altitudes[altitudeIndex];
    const fileName = `as_${date}-${time}_${altitude}_si-neighbours_${offsetStr}.png`;
    const imageUrl = `https://meteo.arso.gov.si/uploads/probase/www/model/aladin/field/${fileName}`;
    
    const img = document.getElementById("forecast-image");
    img.src = imageUrl;
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

