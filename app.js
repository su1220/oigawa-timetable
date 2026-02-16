const DATA_FILES = {
  main: {
    down: 'data/main-line-down.json',
    up: 'data/main-line-up.json'
  },
  ikawa: {
    down: 'data/ikawa-line-down.json',
    up: 'data/ikawa-line-up.json'
  }
};

let timetableData = {};

// --- Utility ---

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- Data Loading ---

async function loadJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function loadAllData() {
  const entries = [];
  for (const [line, dirs] of Object.entries(DATA_FILES)) {
    for (const [dir, url] of Object.entries(dirs)) {
      entries.push({ line, dir, url });
    }
  }
  const results = await Promise.all(entries.map(e => loadJSON(e.url)));
  results.forEach((data, i) => {
    const { line, dir } = entries[i];
    if (!timetableData[line]) timetableData[line] = {};
    timetableData[line][dir] = data;
  });
}

// --- UI Control ---

const lineSelect = document.getElementById('line-select');
const stationA = document.getElementById('station-a');
const stationB = document.getElementById('station-b');
const minStayInput = document.getElementById('min-stay');
const searchBtn = document.getElementById('search-btn');
const resultsDiv = document.getElementById('results');

function getDownStations(line) {
  return timetableData[line].down.stations;
}

function populateStations() {
  const line = lineSelect.value;
  const stations = getDownStations(line);

  stationA.innerHTML = '';
  stationB.innerHTML = '';

  stations.forEach((s, i) => {
    stationA.appendChild(new Option(s, i));
    stationB.appendChild(new Option(s, i));
  });

  // Default: first and last station
  stationA.value = 0;
  stationB.value = stations.length - 1;
}

lineSelect.addEventListener('change', () => {
  populateStations();
  resultsDiv.innerHTML = '';
});

// --- Search Logic ---

function findOutboundTrains(line, fromIdx, toIdx) {
  // A is before B in station order → use down timetable
  // A is after B → use up timetable
  const goingDown = fromIdx < toIdx;
  const data = timetableData[line][goingDown ? 'down' : 'up'];
  const stations = data.stations;
  const downStations = getDownStations(line);

  // Map the station indices (which are in down-line order) to the timetable's station order
  const fromStation = downStations[fromIdx];
  const toStation = downStations[toIdx];
  const ttFromIdx = stations.indexOf(fromStation);
  const ttToIdx = stations.indexOf(toStation);

  if (ttFromIdx === -1 || ttToIdx === -1 || ttFromIdx >= ttToIdx) return [];

  const results = [];
  for (const train of data.trains) {
    const depTime = train.times[ttFromIdx];
    const arrTime = train.times[ttToIdx];
    if (depTime && arrTime) {
      results.push({
        trainNumber: train.trainNumber,
        type: train.type,
        depTime,
        arrTime,
        depMinutes: timeToMinutes(depTime),
        arrMinutes: timeToMinutes(arrTime)
      });
    }
  }

  return results.sort((a, b) => a.depMinutes - b.depMinutes);
}

function findReturnTrains(line, fromIdx, toIdx) {
  // Return trip: B → A
  // If B is after A in down order, return is up direction
  const goingUp = fromIdx > toIdx;
  const data = timetableData[line][goingUp ? 'up' : 'down'];
  const stations = data.stations;
  const downStations = getDownStations(line);

  const fromStation = downStations[fromIdx]; // B station
  const toStation = downStations[toIdx];     // A station
  const ttFromIdx = stations.indexOf(fromStation);
  const ttToIdx = stations.indexOf(toStation);

  if (ttFromIdx === -1 || ttToIdx === -1 || ttFromIdx >= ttToIdx) return [];

  const results = [];
  for (const train of data.trains) {
    const depTime = train.times[ttFromIdx];
    const arrTime = train.times[ttToIdx];
    if (depTime && arrTime) {
      results.push({
        trainNumber: train.trainNumber,
        type: train.type,
        depTime,
        arrTime,
        depMinutes: timeToMinutes(depTime),
        arrMinutes: timeToMinutes(arrTime)
      });
    }
  }

  return results.sort((a, b) => a.depMinutes - b.depMinutes);
}

function searchRoundTrips() {
  const line = lineSelect.value;
  const aIdx = parseInt(stationA.value);
  const bIdx = parseInt(stationB.value);
  const minStay = parseInt(minStayInput.value) || 0;

  if (aIdx === bIdx) {
    resultsDiv.innerHTML = '<p class="no-results">出発駅と目的駅が同じです。</p>';
    return;
  }

  const downStations = getDownStations(line);
  const aName = downStations[aIdx];
  const bName = downStations[bIdx];

  const outbound = findOutboundTrains(line, aIdx, bIdx);
  const returnTrips = findReturnTrains(line, bIdx, aIdx);

  if (outbound.length === 0) {
    resultsDiv.innerHTML = `<p class="no-results">${aName} → ${bName} の列車が見つかりません。</p>`;
    return;
  }

  if (returnTrips.length === 0) {
    resultsDiv.innerHTML = `<p class="no-results">${bName} → ${aName} の帰りの列車が見つかりません。</p>`;
    return;
  }

  const patterns = [];

  for (const out of outbound) {
    for (const ret of returnTrips) {
      const stayMinutes = ret.depMinutes - out.arrMinutes;
      if (stayMinutes < minStay) continue;

      const totalMinutes = ret.arrMinutes - out.depMinutes;
      if (totalMinutes <= 0) continue;

      patterns.push({ out, ret, stayMinutes, totalMinutes });
    }
  }

  if (patterns.length === 0) {
    resultsDiv.innerHTML = `<p class="no-results">条件に合う往復パターンが見つかりません。最低滞在時間を短くしてみてください。</p>`;
    return;
  }

  // Sort by outbound departure, then by stay time
  patterns.sort((a, b) => a.out.depMinutes - b.out.depMinutes || a.stayMinutes - b.stayMinutes);

  let html = `<div class="result-summary">${aName} ⇄ ${bName}：${patterns.length}件の往復パターン</div>`;

  patterns.forEach((p, i) => {
    const stayH = Math.floor(p.stayMinutes / 60);
    const stayM = p.stayMinutes % 60;
    const stayStr = stayH > 0 ? `${stayH}時間${stayM}分` : `${stayM}分`;

    const totalH = Math.floor(p.totalMinutes / 60);
    const totalM = p.totalMinutes % 60;
    const totalStr = totalH > 0 ? `${totalH}時間${totalM}分` : `${totalM}分`;

    html += `
      <div class="result-card">
        <div class="pattern-number">パターン ${i + 1}</div>
        <div class="trip-section">
          <span class="time">${p.out.depTime}</span>
          <span class="station">${aName} 発</span>
          <span class="train-info">${p.out.type} ${p.out.trainNumber}</span>
        </div>
        <div class="separator">↓</div>
        <div class="trip-section">
          <span class="time">${p.out.arrTime}</span>
          <span class="station">${bName} 着</span>
        </div>
        <div class="stay-info">${bName}で ${stayStr} 滞在</div>
        <div class="trip-section">
          <span class="time">${p.ret.depTime}</span>
          <span class="station">${bName} 発</span>
          <span class="train-info">${p.ret.type} ${p.ret.trainNumber}</span>
        </div>
        <div class="separator">↓</div>
        <div class="trip-section">
          <span class="time">${p.ret.arrTime}</span>
          <span class="station">${aName} 着</span>
        </div>
        <div class="total-time">往復合計: ${totalStr}</div>
      </div>
    `;
  });

  resultsDiv.innerHTML = html;
}

searchBtn.addEventListener('click', searchRoundTrips);

// --- Init ---

loadAllData().then(() => {
  populateStations();
});
