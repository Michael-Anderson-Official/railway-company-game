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
          closestDepotJunction, currentTrackGeometry, resolveTrackOrigin, railPointAtDistance, validateTrack,
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

const depot = { id: 4, mode: 'kariya', level: -1, rotation: 180, carCount: 10,
  lat: 35.009, lon: 137.019, routeId: null, vehicleId: 'meitetsu2200', unitId: 1 };
state.depots.push(depot);
state.chooseDepot(depot.id);
assert.equal(nodes['#depot-route'].value, '', 'new depots start without a route');
nodes['#depot-route'].value = '1';
nodes['#depot-route'].dispatch('change');
assert.equal(depot.routeId, 1, 'depot route selection persists in the depot');
assert.equal(automatic().length, 3, `depot automatically attaches to the numbered line: ${state.warnings().join('; ')}`);
const spur = automatic().find(section => section.source.type === 'depot');
assert.ok(spur, 'a depot spur is generated');
assert.equal(spur.targetStation.type, 'junction', 'depot joins an interior point of existing double track, not an unused station end');
assert.ok(automatic().some(section => section.id === spur.targetStation.sectionId && section.autoKey.startsWith('route:')),
  'depot junction is anchored to the selected mainline');
assert.ok(spur.targetStation.distanceMeters < 1000, 'junction joins a nearby segment rather than extending to its far endpoint');
assert.ok(spur.targetStation.distanceMeters >= 180, 'junction is clear of the first station crossover');
const hostGeometry = state.currentTrackGeometry().get(spur.targetStation.sectionId);
assert.ok(hostGeometry.points.at(-1).distance - spur.targetStation.distanceMeters >= 180,
  'junction is clear of the second station crossover');
assert.ok(nodes['#tracks'].children.some(group => group.children.some(child =>
  child.attributes['data-crossover-end'] === 'junction')), 'mainline junction displays its crossovers');
assert.equal(spur.routeId, route.id);
assert.equal(automatic()[0].id, stableTrackId, 'unchanged automatic segments keep their identities');
nodes['#depot-direction'].value = 'down';
nodes['#depot-direction'].dispatch('change');
const downJourney = state.buildDepotJourney(depot);
assert.equal(downJourney.error, undefined, `trains can leave toward high-numbered stations: ${downJourney.error}`);
assert.equal(downJourney.outwardStops.at(-1).stationId, south.id, 'down trains reach the last numbered station');
nodes['#depot-direction'].value = 'up';
nodes['#depot-direction'].dispatch('change');
assert.equal(depot.direction, 'up', 'depot direction selector persists upbound departure');
const upJourney = state.buildDepotJourney(depot);
assert.equal(upJourney.error, undefined, `trains can leave toward low-numbered stations: ${upJourney.error}`);
assert.equal(upJourney.outwardStops.at(-1).stationId, north.id, 'up trains reach the first numbered station');
assert.ok(Math.hypot(downJourney.route.points.at(-1).x - upJourney.route.points.at(-1).x,
  downJourney.route.points.at(-1).y - upJourney.route.points.at(-1).y) / upJourney.route.scale > 500,
  'up/down trains reach physically different line terminals');
nodes['#depot-direction'].value = 'down';
nodes['#depot-direction'].dispatch('change');

nodes['#depot-route'].value = '';
nodes['#depot-route'].dispatch('change');
assert.equal(automatic().length, 2, 'clearing depot route removes only the depot spur');
assert.equal(state.trackSections.filter(section => section.source.type === 'depot').length, 0);
state.routes.push({ id: 2, name: '未敷設線', code: 'NS', color: '#228866' });
depot.routeId = 2;
state.dirty();
state.redrawPlaced();
assert.equal(automatic().length, 2, 'selecting an unbuilt route never connects to a different line');
assert.ok(state.warnings().some(warning => warning.includes('複線へ接続できません')),
  'impossible depot connection reports an explicit reason');
depot.routeId = null;
state.dirty();
state.redrawPlaced();

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
