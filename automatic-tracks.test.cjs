const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  addEventListener(name, handler) { this.listeners[name] = handler; }
  dispatch(name, options = {}) { this.listeners[name]?.({ preventDefault() {}, ...options }); }
  append(child) { child.parentNode = this; this.children.push(child); }
  replaceChildren(...children) {
    this.children = children;
    for (const child of children) child.parentNode = this;
    if (this.tagName === 'select') this.value = children[0]?.value || '';
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; }
  setPointerCapture() {}
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /id="track-tool"[^>]*hidden/, 'manual laying has no visible toolbar entry');
assert.match(html, /id="depot-route"/, 'depots have an explicit route selector');
const ids = [...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(match => `#${match[1]}`))];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
for (const id of ['#track-origin', '#track-route', '#vehicle-route', '#depot-route']) nodes[id].tagName = 'select';
nodes['#map-mode'].value = 'kariya';
nodes['#map-focus'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#depot-vehicle'].value = 'meitetsu2200';
nodes['#vehicle-speed'].value = '5';
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const hooked = script.replace('      loadPopulationData();', `
        window.autoTrackTest = { positions, depots, routes, trackSections, redrawPlaced, buildDepotJourney,
          warnings: () => automaticTrackWarnings,
          dirty: () => { automaticTracksDirty = true; },
          chooseDepot: id => selectDepot(id) };
        loadPopulationData();`);
const windowMock = new Element();
vm.runInNewContext(hooked, {
  document: { querySelector: selector => nodes[selector], createElement: name => new Element(name),
    createElementNS: () => new Element() },
  window: windowMock, Math, Map,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  fetch: async () => ({ ok: true, json: async () => ({ populationYear: 2025, cells: [] }) })
});
const state = windowMock.autoTrackTest;
const route = { id: 1, name: '新地下鉄線', code: 'KS', color: '#cf3946' };
state.routes.push(route);
const north = { id: 31, name: '北駅', rotation: 90, carCount: 10, lat: 35.012, lon: 137.012,
  mode: 'kariya', level: -1, routeNumbers: { 1: 1 } };
const middle = { id: 32, name: '中央駅', rotation: 90, carCount: 10, lat: 35.006, lon: 137.012,
  mode: 'kariya', level: -1, routeNumbers: { 1: 2 } };
const south = { id: 33, name: '南駅', rotation: 90, carCount: 10, lat: 35.000, lon: 137.012,
  mode: 'kariya', level: -1, routeNumbers: { 1: 3 } };
// Deliberately insert the station records out of station-number order.
state.positions.push(south, north, middle);
state.dirty();
state.redrawPlaced();
let automatic = () => state.trackSections.filter(section => section.automatic);
assert.equal(automatic().length, 2, `neighboring station pairs automatically connect: ${state.warnings().join('; ')}`);
assert.deepEqual(JSON.parse(JSON.stringify(automatic().map(section => [section.source.stationId, section.targetStation.stationId]))),
  [[31, 32], [32, 33]], 'station numbers, not record insertion order, control adjacent connections');
assert.equal(nodes['#tracks'].children.length, 2, 'both rail pairs render on the map');
assert.ok(automatic().every(section => section.crossoverEnds.length === 2), 'station-to-station links have X crossovers at both ends');
const stableTrackId = automatic()[0].id;

const depot = { id: 4, mode: 'kariya', level: -1, rotation: 270, carCount: 10,
  lat: 34.993, lon: 137.012, routeId: null, vehicleId: 'meitetsu2200', unitId: 1 };
state.depots.push(depot);
state.chooseDepot(depot.id);
assert.equal(nodes['#depot-route'].value, '', 'new depots start without a route');
nodes['#depot-route'].value = '1';
nodes['#depot-route'].dispatch('change');
assert.equal(depot.routeId, 1, 'depot route selection persists in the depot');
assert.equal(automatic().length, 3, `depot automatically attaches to the numbered line: ${state.warnings().join('; ')}`);
const spur = automatic().find(section => section.source.type === 'depot' || section.targetStation.type === 'depot');
assert.ok(spur, 'a single track-to-depot junction is generated');
assert.equal(spur.routeId, route.id);
assert.equal(automatic()[0].id, stableTrackId, 'unchanged automatic segments keep their identities');
assert.equal(state.buildDepotJourney(depot).error, undefined, 'trains can leave the depot via the generated connection');

nodes['#depot-route'].value = '';
nodes['#depot-route'].dispatch('change');
assert.equal(automatic().length, 2, 'clearing depot route removes only the depot spur');
assert.equal(state.trackSections.filter(section => section.source.type === 'depot').length, 0);

middle.rotation = 0;
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 0, 'physically impossible station alignments do not produce illegal track');
assert.ok(state.warnings().length >= 1, 'users get an actionable invalid-geometry warning');
middle.rotation = 90;
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 2, 'rotating stations back restores both connections');

middle.level = -2;
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 0, 'tracks never bridge different underground floors automatically');
assert.ok(state.warnings().some(warning => warning.includes('階層')));
middle.level = -1;
delete middle.routeNumbers[route.id];
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 0, 'a removed station still physically blocks a track through its platform');
middle.lon += .015;
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 1, 'removing a station number recomputes adjacency');
assert.equal(automatic()[0].source.stationId, 31);
assert.equal(automatic()[0].targetStation.stationId, 33);

console.log('Station-number-order double tracks, depot route auto-connect, realistic geometry, floor isolation and rerouting OK');
