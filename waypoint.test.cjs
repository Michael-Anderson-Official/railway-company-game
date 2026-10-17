const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor(tagName = '') {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  dispatch(name, payload = {}) { this.listeners[name]?.({ preventDefault() {}, ...payload }); }
  append(child) { child.parentNode = this; this.children.push(child); }
  replaceChildren(...children) {
    this.children = children;
    for (const child of children) child.parentNode = this;
    if (this.tagName === 'select') this.value = children[0]?.value || '';
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() {
    const board = this;
    return { x: 0, y: 0, matrixTransform() {
      const [x, y, width, height] = board.attributes.viewBox.split(' ').map(Number);
      return { x: x + this.x * width / 400, y: y + this.y * height / 600 };
    } };
  }
  setPointerCapture() {}
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const ids = [...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(match => `#${match[1]}`))];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
for (const id of ['#waypoint-section', '#track-origin', '#track-route', '#vehicle-route', '#depot-route']) {
  nodes[id].tagName = 'select';
}
nodes['#map-mode'].value = 'kariya';
nodes['#map-focus'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#depot-vehicle'].value = 'meitetsu2200';
nodes['#vehicle-speed'].value = '5';

const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const instrumented = script.replace('      loadPopulationData();', `
    window.waypointTest = { positions, routes, trackSections, trackWaypoints,
      redrawPlaced, geoToCanvas, currentTrackGeometry, dirty: () => { automaticTracksDirty = true; } };
    loadPopulationData();`);
const windowMock = new Element();
vm.runInNewContext(instrumented, {
  document: { querySelector: key => nodes[key], createElement: name => new Element(name),
    createElementNS: () => new Element() },
  window: windowMock, Map, Math,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  fetch: async () => ({ ok: true, json: async () => ({ populationYear: 2025, cells: [] }) })
});
const state = windowMock.waypointTest;
state.routes.push({ id: 1, name: '試験線', code: 'TS', color: '#336699' });
state.positions.push(
  { id: 11, name: '北駅', rotation: 90, carCount: 10, lat: 35.020, lon: 137.012,
    mode: 'kariya', level: -1, routeNumbers: { 1: 1 } },
  { id: 12, name: '南駅', rotation: 90, carCount: 10, lat: 34.988, lon: 137.012,
    mode: 'kariya', level: -1, routeNumbers: { 1: 2 } }
);
state.dirty();
state.redrawPlaced();
const section = () => state.trackSections.find(item => item.automatic);
assert.ok(section(), `initial automatic track: ${nodes['#auto-route-warnings'].textContent}`);
const initialId = section().id;
const initialSource = JSON.stringify(section().source);
const initialTarget = JSON.stringify(section().targetStation);
const original = state.currentTrackGeometry().get(initialId);
assert.ok(original, 'initial track geometry exists');
const key = section().autoKey;
assert.ok(nodes['#waypoint-section'].children.some(option => option.value === key), 'selectable segment appears');

function screenFor(lon, lat) {
  const canvasPoint = state.geoToCanvas(lon, lat);
  const [x, y, width, height] = nodes['#board'].attributes.viewBox.split(' ').map(Number);
  return { x: (canvasPoint.x - x) * 400 / width, y: (canvasPoint.y - y) * 600 / height };
}
function tap(lon, lat, pointerType = 'mouse') {
  const { x, y } = screenFor(lon, lat);
  const evt = { pointerId: 99, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y,
    target: nodes['#board'] };
  nodes['#board'].dispatch('pointerdown', evt);
  nodes['#board'].dispatch('pointerup', evt);
}
function arm() {
  nodes['#waypoint-section'].value = key;
  nodes['#waypoint-section'].dispatch('change');
  nodes['#waypoint-pick'].dispatch('click');
  assert.equal(nodes['#waypoint-pick'].attributes['aria-pressed'], 'true');
}

const via = { lon: 137.014, lat: 35.004 };
arm();
tap(via.lon, via.lat, 'touch');
assert.equal(section()?.id, initialId, 'automatic section ID remains stable');
assert.equal(JSON.stringify(section().source), initialSource, 'original station exit preserved');
assert.equal(JSON.stringify(section().targetStation), initialTarget, 'original station entrance preserved');
assert.equal(section().waypoint.points.length, 1, 'touch adds first waypoint to automated line');
assert.equal(state.trackWaypoints.get(key).level, -1, 'waypoint keeps floor');
assert.equal(nodes['#waypoint-pick'].attributes['aria-pressed'], 'true', 'tap mode stays active after a waypoint');
const rerouted = state.currentTrackGeometry().get(initialId);
const exact = state.geoToCanvas(via.lon, via.lat);
assert.ok(rerouted.points.some(point => Math.hypot(point.x - exact.x, point.y - exact.y) < 1e-6),
  'centerline exactly passes tapped waypoint');
assert.ok(rerouted.lengthMeters > original.lengthMeters, 'detour increases length');
assert.equal(nodes['#tracks'].children.length, 1, 'rerouted double tracks render');
assert.ok(!html.includes('id="waypoint-layer"'), 'no waypoint overlay exists in the map');
assert.ok(!html.includes('waypoint-marker'), 'no waypoint marker or caption is rendered');

const secondVia = { lon: 137.015, lat: 34.996 };
tap(secondVia.lon, secondVia.lat, 'touch');
assert.equal(section()?.waypoint?.points.length, 2, `second tap retains both waypoints: ${nodes['#waypoint-status'].textContent}`);
const reroutedTwice = state.currentTrackGeometry().get(initialId);
const secondExact = state.geoToCanvas(secondVia.lon, secondVia.lat);
for (const desired of [exact, secondExact]) {
  assert.ok(reroutedTwice.points.some(point => Math.hypot(point.x - desired.x, point.y - desired.y) < 1e-6),
    'centerline passes through each selected point');
}
assert.equal(JSON.stringify(section().source), initialSource, 'multiple waypoints preserve original station exit');
assert.equal(JSON.stringify(section().targetStation), initialTarget, 'multiple waypoints preserve original station entrance');
const thirdVia = { lon: 137.0144, lat: 34.9945 };
tap(thirdVia.lon, thirdVia.lat, 'touch');
assert.equal(section()?.waypoint?.points.length, 3, `third nearby tap adds a point: ${nodes['#waypoint-status'].textContent}`);
const thirdExact = state.geoToCanvas(thirdVia.lon, thirdVia.lat);
assert.ok(state.currentTrackGeometry().get(initialId).points.some(point =>
  Math.hypot(point.x - thirdExact.x, point.y - thirdExact.y) < 1e-6), 'third intermediate point is exact');

const nearby = screenFor(137.013, 35.004);
const gesture = { pointerId: 111, pointerType: 'touch', isPrimary: true, button: 0,
  clientX: nearby.x, clientY: nearby.y, target: nodes['#board'] };
nodes['#board'].dispatch('pointerdown', gesture);
nodes['#board'].dispatch('pointermove', { ...gesture, clientX: nearby.x + 50 });
nodes['#board'].dispatch('pointerup', { ...gesture, clientX: nearby.x + 50 });
assert.equal(state.trackWaypoints.get(key).points.length, 3, 'swiping map does not add waypoint');

tap(137.012, 35.020, 'touch');
assert.match(nodes['#waypoint-status'].textContent, /敷設できません：.*元の線路を維持しました/,
  'invalid point displays a reason and rollback confirmation');
assert.equal(state.trackWaypoints.get(key).points.length, 3, 'invalid point restores previous waypoints');
for (const desired of [exact, secondExact, thirdExact]) {
  assert.ok(state.currentTrackGeometry().get(initialId).points.some(point =>
    Math.hypot(point.x - desired.x, point.y - desired.y) < 1e-6), 'failed rerouting preserves all existing bends');
}

nodes['#waypoint-undo'].dispatch('click');
assert.equal(state.trackWaypoints.get(key)?.points.length, 2, 'undo removes third waypoint only');
nodes['#waypoint-undo'].dispatch('click');
assert.equal(state.trackWaypoints.get(key)?.points.length, 1, 'undo removes only last waypoint');
assert.ok(state.currentTrackGeometry().get(initialId).points.some(point =>
  Math.hypot(point.x - exact.x, point.y - exact.y) < 1e-6), 'undo restores single bend');

nodes['#waypoint-clear'].dispatch('click');
assert.equal(state.trackWaypoints.has(key), false, 'clear removes waypoint');
assert.equal(section()?.id, initialId);
assert.equal(section().waypoint, undefined, 'clear restores standard automatic track');
assert.ok(!html.includes('id="waypoint-layer"'), 'clearing the detour needs no marker layer');

console.log('Invisible multi-waypoint, touch, exact route, station endpoints, drag, rollback, undo and clear: PASS');
