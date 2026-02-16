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

const MIN_STAY = 10;
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

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
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
const departAfterSelect = document.getElementById('depart-after');
const returnLimitSelect = document.getElementById('return-limit');
const searchBtn = document.getElementById('search-btn');
const resultsDiv = document.getElementById('results');

function getDownStations(line) {
  return timetableData[line].down.stations;
}

function populateStations() {
  const line = lineSelect.value;
  const stations = getDownStations(line);

  stationA.innerHTML = '';
  stations.forEach((s, i) => {
    stationA.appendChild(new Option(s, i));
  });
  stationA.value = 0;
}

function populateTimeSelects() {
  departAfterSelect.innerHTML = '';
  returnLimitSelect.innerHTML = '';

  departAfterSelect.appendChild(new Option('現在時刻', 'now'));
  for (let h = 6; h <= 20; h++) {
    for (const m of ['00', '30']) {
      const label = `${h}:${m}`;
      departAfterSelect.appendChild(new Option(label, label));
      returnLimitSelect.appendChild(new Option(label, label));
    }
  }
  returnLimitSelect.appendChild(new Option('21:00', '21:00'));

  departAfterSelect.value = 'now';
  returnLimitSelect.value = '17:00';
}

lineSelect.addEventListener('change', () => {
  populateStations();
  resultsDiv.innerHTML = '';
});

// --- Search Logic ---

function findTrains(line, fromIdx, toIdx) {
  const goingDown = fromIdx < toIdx;
  const data = timetableData[line][goingDown ? 'down' : 'up'];
  const stations = data.stations;
  const downStations = getDownStations(line);

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

function searchRoundTrips() {
  const line = lineSelect.value;
  const aIdx = parseInt(stationA.value);
  const limitMinutes = timeToMinutes(returnLimitSelect.value);
  const departAfterVal = departAfterSelect.value;
  const departAfterMinutes = departAfterVal === 'now' ? getNowMinutes() : timeToMinutes(departAfterVal);
  const downStations = getDownStations(line);
  const aName = downStations[aIdx];

  // Build candidate B stations sorted by distance from A (farthest first)
  const bCandidates = [];
  for (let i = 0; i < downStations.length; i++) {
    if (i === aIdx) continue;
    bCandidates.push({ idx: i, distance: Math.abs(i - aIdx) });
  }
  bCandidates.sort((a, b) => b.distance - a.distance);

  const patterns = [];

  for (const { idx: bIdx } of bCandidates) {
    const bName = downStations[bIdx];
    const outbound = findTrains(line, aIdx, bIdx);
    const returnTrips = findTrains(line, bIdx, aIdx);

    for (const out of outbound) {
      if (out.depMinutes < departAfterMinutes) continue;

      for (const ret of returnTrips) {
        const stayMinutes = ret.depMinutes - out.arrMinutes;
        if (stayMinutes < MIN_STAY) continue;

        if (ret.arrMinutes > limitMinutes) continue;

        const totalMinutes = ret.arrMinutes - out.depMinutes;
        if (totalMinutes <= 0) continue;

        patterns.push({
          out, ret, stayMinutes, totalMinutes,
          bName,
          distance: Math.abs(bIdx - aIdx)
        });
      }
    }
  }

  if (patterns.length === 0) {
    resultsDiv.innerHTML = '<p class="no-results">条件に合う往復パターンが見つかりません。帰着リミットを遅くしてみてください。</p>';
    return;
  }

  // Sort: farthest destination first, then earliest departure
  patterns.sort((a, b) => b.distance - a.distance || a.out.depMinutes - b.out.depMinutes);

  const depStr = departAfterVal === 'now' ? minutesToTime(departAfterMinutes) : departAfterVal;
  const uniqueDestinations = [...new Set(patterns.map(p => p.bName))];
  let html = `<div class="result-summary">${aName}発 ${depStr}〜${returnLimitSelect.value}：${patterns.length}件<br>行き先: ${uniqueDestinations.join('、')}</div>`;

  patterns.forEach((p, i) => {
    const stayH = Math.floor(p.stayMinutes / 60);
    const stayM = p.stayMinutes % 60;
    const stayStr = stayH > 0 ? `${stayH}時間${stayM}分` : `${stayM}分`;

    const totalH = Math.floor(p.totalMinutes / 60);
    const totalM = p.totalMinutes % 60;
    const totalStr = totalH > 0 ? `${totalH}時間${totalM}分` : `${totalM}分`;

    html += `
      <div class="result-card">
        <div class="pattern-number">パターン ${i + 1}　─　${p.bName}まで</div>
        <div class="trip-section">
          <span class="time">${p.out.depTime}</span>
          <span class="station">${aName} 発</span>
          <span class="train-info">${p.out.type} ${p.out.trainNumber}</span>
        </div>
        <div class="separator">↓</div>
        <div class="trip-section">
          <span class="time">${p.out.arrTime}</span>
          <span class="station">${p.bName} 着</span>
        </div>
        <div class="stay-info">${p.bName}で ${stayStr} 滞在</div>
        <div class="trip-section">
          <span class="time">${p.ret.depTime}</span>
          <span class="station">${p.bName} 発</span>
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
  populateTimeSelects();
});
