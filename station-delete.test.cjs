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
    this.hidden = false;
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  dispatch(name, options = {}) { this.listeners[name]?.({ preventDefault() {}, ...options }); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = children; for (const child of children) child.parentNode = this;
    if (this.tagName === 'select') this.value = children[0]?.value || ''; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; }
  setPointerCapture() {}
  focus() {}
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /id="station-delete-request"/);
assert.match(html, /id="station-delete-confirm-button"/);
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
        window.stationDeletionTest = { positions, routes, depots, services, trackSections,
          trackWaypoints, automaticTrackIds, redrawPlaced, selectStation,
          selectedId: () => selectedStationId,
          dirty: () => { automaticTracksDirty = true; } };
        loadPopulationData();`);
const windowMock = new Element();
vm.runInNewContext(hooked, {
  document: { querySelector: selector => nodes[selector], createElement: tag => new Element(tag),
    createElementNS: () => new Element() },
  window: windowMock, Math, Map,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  fetch: async () => ({ ok: true, json: async () => ({ populationYear: 2025, cells: [] }) })
});
const state = windowMock.stationDeletionTest;
const plain = value => JSON.parse(JSON.stringify(value));
state.routes.push({ id: 1, name: '公開確認線', code: 'VT', color: '#bc324c' });
state.positions.push(
  { id: 31, name: '北駅', mode: 'kariya', level: -1, rotation: 90, carCount: 10,
    lat: 35.012, lon: 137.012, routeNumbers: { 1: 1 } },
  { id: 32, name: '中央駅', mode: 'kariya', level: -1, rotation: 90, carCount: 10,
    lat: 35.006, lon: 137.012, routeNumbers: { 1: 2 } },
  { id: 33, name: '南駅', mode: 'kariya', level: -1, rotation: 90, carCount: 10,
    lat: 35.000, lon: 137.012, routeNumbers: { 1: 3 } },
  { id: 50, name: '別マップの駅', mode: 'blank', level: -1, rotation: 90, carCount: 6,
    xRatio: .3, yRatio: .3 }
);
state.services.push({ id: 7, name: '普通', routeId: 1, stopIds: [31, 32, 33] });
state.depots.push({ id: 4, mode: 'kariya', level: -1, rotation: 180, carCount: 10,
  lat: 35.009, lon: 137.019, routeId: 1, vehicleId: 'meitetsu2200', unitId: 1 });
state.dirty();
state.redrawPlaced();
const initial = state.trackSections.filter(section => section.autoKey?.startsWith('route:'));
assert.equal(initial.length, 2, 'three numbered stations lay two consecutive double-track sections');
const northSection = initial.find(section => section.source.stationId === 31);
const southSection = initial.find(section => section.source.stationId === 32);
const depotSection = state.trackSections.find(section => section.autoKey === 'depot:4');
assert.ok(depotSection, 'the depot initially connects to a mainline segment');
state.trackWaypoints.set('route:1:31:32', { mode: 'kariya', level: -1, points: [] });
state.trackWaypoints.set('route:1:32:33', { mode: 'kariya', level: -1, points: [] });
state.trackWaypoints.set('route:1:31:33', { mode: 'blank', level: -1, points: [] });
state.trackWaypoints.set('depot:4', { mode: 'kariya', level: -1, points: [] });
// A manual segment and its child must both disappear when their station is removed.
state.trackSections.push({ id: 900, mode: 'kariya', level: -1, automatic: false,
  source: { type: 'station', stationId: 32, side: 1 }, target: { lon: 137.018, lat: 35.003 } });
state.trackSections.push({ id: 901, mode: 'kariya', level: -1, automatic: false,
  source: { type: 'section', sectionId: 900 }, target: { lon: 137.02, lat: 35.002 } });
state.selectStation(32);

nodes['#station-delete-request'].dispatch('click');
assert.equal(nodes['#station-delete-confirm'].hidden, false, 'first tap shows a dedicated confirmation');
assert.match(nodes['#station-delete-message'].textContent, /中央駅/);
assert.equal(state.positions.length, 4, 'first tap never deletes immediately');
nodes['#station-delete-cancel'].dispatch('click');
assert.equal(nodes['#station-delete-confirm'].hidden, true, 'cancel hides confirmation');
assert.equal(state.positions.length, 4, 'cancel preserves all stations');
nodes['#station-delete-confirm-button'].dispatch('click');
assert.equal(state.positions.length, 4, 'a cancelled confirmation cannot be confirmed later');

nodes['#station-delete-request'].dispatch('click');
nodes['#station-delete-confirm-button'].dispatch('click');
assert.deepEqual(plain(state.positions.map(position => position.id)), [31, 33, 50]);
assert.equal(state.selectedId(), null, 'selection resets after removal');
assert.equal(nodes['#station-editor'].hidden, true, 'editor closes after removal');
assert.equal(nodes['#station-delete-confirm'].hidden, true, 'confirmation closes after removal');
assert.deepEqual(plain(state.services[0].stopIds), [31, 33], 'service stops no longer reference deleted stations');
assert.ok(!state.trackSections.some(section => [900, 901, northSection.id, southSection.id].includes(section.id)),
  'old neighboring and dependent track sections are removed');
assert.ok(!state.trackSections.some(section => section.source.stationId === 32 ||
  section.targetStation?.stationId === 32), 'no track connects to deleted station');
assert.ok(!state.trackSections.some(section =>
  section.targetStation?.type === 'junction' && !state.trackSections.some(host => host.id === section.targetStation.sectionId)),
  'no depot junction references a removed mainline section');
assert.ok(state.trackSections.some(section => section.autoKey === 'route:1:31:33'),
  'surviving adjacent stations are automatically reconnected');
assert.equal(state.trackWaypoints.has('route:1:31:32'), false);
assert.equal(state.trackWaypoints.has('route:1:32:33'), false);
assert.equal(state.trackWaypoints.has('route:1:31:33'), true, 'unrelated waypoint keys remain');
if (depotSection.targetStation.sectionId === northSection.id ||
    depotSection.targetStation.sectionId === southSection.id) {
  assert.equal(state.trackWaypoints.has('depot:4'), false, 'orphaned depot path waypoint is cleared');
}
assert.match(nodes['#hint'].textContent, /中央駅.*削除しました/);

state.selectStation(31);
nodes['#station-delete-request'].dispatch('click');
state.selectStation(33);
nodes['#station-delete-confirm-button'].dispatch('click');
assert.ok(state.positions.some(position => position.id === 31), 'switching selected stations cancels pending deletion');
nodes['#station-delete-request'].dispatch('click');
nodes['#station-delete-confirm-button'].dispatch('click');
assert.deepEqual(plain(state.positions.map(position => position.id)), [31, 50]);
assert.equal(state.trackSections.filter(section => section.autoKey?.startsWith('route:')).length, 0,
  'a route with only one station leaves no automatic double-track segment');
assert.deepEqual(plain(state.services[0].stopIds), [31]);

console.log('station deletion confirmation, cascading track cleanup, service stops and recalculation: PASS');
