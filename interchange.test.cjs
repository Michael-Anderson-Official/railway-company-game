const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.classList = { toggle() {} };
    this.textContent = '';
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  replaceChildren(...children) { this.children = children; for (const child of children) child.parentNode = this; }
  append(child) { child.parentNode = this; this.children.push(child); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatch(name, payload = {}) { this.listeners[name]?.({ preventDefault() {}, ...payload }); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() {
    const board = this;
    return { x: 0, y: 0, matrixTransform() {
      const [x, y, width, height] = board.attributes.viewBox.split(' ').map(Number);
      return { x: x + this.x * width / 400, y: y + this.y * height / 600 };
    } };
  }
  closest(selector) {
    const key = selector.slice(1, -1);
    for (let target = this; target; target = target.parentNode) {
      if (target.getAttribute(key) !== null) return target;
    }
    return null;
  }
}

const nodes = Object.fromEntries([
  '#board', '#map-tiles', '#map-markers', '#catchment-rings', '#tracks', '#waypoint-layer', '#track-preview', '#placed',
  '#station-endpoints', '#depots', '#preview', '#place-tool', '#track-tool', '#depot-tool', '#tool-bar', '#settings-toggle', '#active-config', '#map-mode', '#map-focus-control', '#map-focus', '#floor-level',
  '#depot-panel', '#depot-heading', '#depot-info', '#depot-vehicle', '#depot-buy', '#depot-status', '#depot-owned', '#depot-close', '#depot-angle', '#depot-angle-value', '#depot-guidance', '#depot-route', '#depot-service', '#depot-direction', '#depot-dispatch', '#depot-return', '#depot-speed',
  '#train-layer', '#fleet-tool', '#fleet-panel', '#fleet-close', '#vehicle-model', '#vehicle-route', '#vehicle-speed',
  '#route-tool', '#route-manager', '#route-close', '#route-edit-target', '#route-name', '#route-code', '#route-save', '#route-manager-status', '#auto-route-warnings', '#route-list', '#waypoint-section', '#waypoint-pick', '#waypoint-undo', '#waypoint-clear', '#waypoint-status', '#service-tool', '#service-manager', '#service-close', '#service-edit-target', '#service-name', '#service-route', '#service-stops', '#service-save', '#service-status', '#service-list',
  '#fleet-preview', '#vehicle-hero', '#vehicle-illustration-caption', '#fleet-stats', '#fleet-description', '#vehicle-run', '#vehicle-stop', '#vehicle-emergency', '#vehicle-status', '#train-hud',
  '#car-count', '#hint', '#map-data', '#map-credit', '#station-editor', '#selected-station-info',
  '#station-name', '#station-interchange', '#station-angle', '#station-angle-value', '#deselect-station',
  '#station-route', '#station-route-number', '#station-route-save', '#station-route-list', '#station-route-status',
  '#zoom-in', '#zoom-out', '#follow-train', '#demand-overview', '#station-demand', '#track-editor', '#track-origin', '#track-route',
  '#track-destination', '#build-track', '#track-validation', '#connection-dialog', '#connection-question',
  '#connection-detail', '#connection-confirm', '#connection-cancel', '#interchange-dialog',
  '#interchange-question', '#interchange-detail', '#interchange-confirm', '#interchange-cancel'
].map(key => [key, new Element()]));
nodes['#map-mode'].value = 'kariya';
nodes['#map-focus'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#vehicle-speed'].value = '5';
nodes['#fleet-panel'].hidden = true;
nodes['#interchange-dialog'].hidden = true;
nodes['#station-interchange'].hidden = true;
const board = nodes['#board'];
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const fetched = [];
const population = {
  './population-kariya-2025.json': [[137.012, 35.004, 100, 0, 0]],
  './population-chiryu-2025.json': [[137.03972, 35.00611, 500, 0, 0]],
  './population-toyoake-2025.json': [[136.995665, 35.05227, 350, 0, 0]]
};
vm.runInNewContext(code, {
  document: { querySelector: key => nodes[key], createElement: () => new Element(), createElementNS: () => new Element() },
  window: new Element(), Math, Map,
  fetch: async url => {
    fetched.push(url);
    return { ok: true, json: async () => ({ populationYear: 2025, cells: population[url] }) };
  }
});

function mercator(lon, lat) {
  const size = 256 * 2 ** 13;
  return {
    x: (lon + 180) / 360 * size,
    y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * size
  };
}
function geoToScreen(lon, lat) {
  const origin = mercator(137.012, 35.004);
  const location = mercator(lon, lat);
  const [viewX, viewY, viewWidth, viewHeight] = board.attributes.viewBox.split(' ').map(Number);
  return { x: (240 + (location.x - origin.x) * .9 - viewX) * 400 / viewWidth,
    y: (360 + (location.y - origin.y) * .9 - viewY) * 600 / viewHeight };
}
function mouse(type, x, y, target = board) {
  board.dispatch(type, { pointerType: 'mouse', pointerId: 7, button: 0, clientX: x, clientY: y, target });
}
function placeAt(lon, lat) {
  const point = geoToScreen(lon, lat);
  mouse('pointerdown', point.x, point.y);
  mouse('pointerup', point.x, point.y);
  return point;
}

async function run() {
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched, ['./population-kariya-2025.json', './population-chiryu-2025.json', './population-toyoake-2025.json']);
  assert.ok(html.includes('知立72,861'), 'official Chiryū population is shown');
  assert.ok(html.includes('137.054972'), 'the relocated 2024 Mikawa Chiryū station is represented');
  assert.ok(html.includes('豊明67,693人'), 'official Toyoake population is shown');
  nodes['#place-tool'].dispatch('click');
  placeAt(137.012, 35.004);
  assert.equal(nodes['#interchange-dialog'].hidden, true, 'no transfer prompt away from rail stations');
  assert.match(nodes['#demand-overview'].textContent, /潜在利用人口 100人/);

  const nearChiryu = placeAt(137.03972, 35.00611);
  assert.equal(nodes['#interchange-dialog'].hidden, false, 'prompt near Chiryū station');
  assert.match(nodes['#interchange-question'].textContent, /知立駅（名鉄）に接続しますか/);
  assert.match(nodes['#interchange-detail'].textContent, /名古屋本線・三河線/);
  assert.match(nodes['#demand-overview'].textContent, /潜在利用人口 600人/, 'Chiryū residents contribute to catchment');
  assert.equal(nodes['#station-interchange'].hidden, true, 'placing alone does not assume transfer');
  nodes['#interchange-confirm'].dispatch('click');
  assert.equal(nodes['#interchange-dialog'].hidden, true);
  assert.equal(nodes['#station-interchange'].hidden, false);
  assert.match(nodes['#station-interchange'].textContent, /乗換駅：名鉄 知立駅/);
  assert.ok(nodes['#placed'].children[1].children.some(child => child.attributes.class === 'station-transfer-label'));

  const second = nodes['#placed'].children[1];
  const stationHit = second.children[0].children.at(-1);
  mouse('pointerdown', nearChiryu.x, nearChiryu.y, stationHit);
  mouse('pointermove', nearChiryu.x - 65, nearChiryu.y);
  mouse('pointerup', nearChiryu.x - 65, nearChiryu.y);
  assert.equal(nodes['#station-interchange'].hidden, true, 'moving away breaks transfer designation');
  assert.equal(nodes['#placed'].children[1].children.some(child => child.attributes.class === 'station-transfer-label'), false);

  placeAt(137.024111, 34.995);
  assert.match(nodes['#interchange-question'].textContent, /重原駅/);
  nodes['#interchange-cancel'].dispatch('click');
  assert.equal(nodes['#station-interchange'].hidden, true, 'declining leaves a normal station');
  assert.equal(nodes['#interchange-dialog'].hidden, true);

  // Recenter the same map on Toyoake; existing placed stations must be retained.
  nodes['#map-focus'].value = 'toyoake';
  nodes['#map-focus'].dispatch('change');
  assert.ok(Number(board.attributes.viewBox.split(' ')[1]) < 0, 'map pans north toward Toyoake');
  assert.equal(nodes['#placed'].children.length, 3, 'existing stations survive switching city focus');
  placeAt(136.995665, 35.05227);
  assert.match(nodes['#interchange-question'].textContent, /前後駅/);
  assert.match(nodes['#station-demand'].textContent, /潜在利用人口：350人/, 'Toyoake population mesh contributes to catchment');
  nodes['#interchange-confirm'].dispatch('click');
  assert.match(nodes['#station-interchange'].textContent, /名鉄 前後駅/);
  assert.equal(nodes['#interchange-dialog'].hidden, true);
  console.log('Three-city population, city focus, 250m transfer offer, confirm/decline, and move invalidation OK');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
