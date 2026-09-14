const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const names = ['isFiniteRange', 'isValidLayer', 'isValidTextLayer', 'normalizeTemplate', 'prepareImages', 'importJson'];
const code = names.map(name => {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert.notEqual(start, -1);
  const tail = source.slice(start + 1);
  const next = tail.search(/\n  (?:async )?function /);
  return source.slice(start, start + 1 + next);
}).join('\n');
const valid = () => ({ id: 'one', name: '정상', ratio: '1:1', createdAt: '2026-09-14T00:00:00Z', images: [], texts: [], backgroundId: 'aurora' });
const envelope = items => ({ format: 'mixit-templates', version: 2, templates: items });
function setup() {
  const nodes = { '#jsonMessage': {}, '#jsonInput': { value: 'selected.json' } };
  const originalTemplates = [{ id: 'existing' }];
  const context = {
    RATIOS: { '1:1': {} }, BACKGROUNDS: [{ id: 'aurora' }], DEFAULT_STATE: { backgroundId: 'aurora' }, DEFAULT_TEXT: {}, TEXT_FONTS: [],
    state: { texts: ['현재 작업'], ratio: '1:1' }, imageCache: new Map([['existing', {}]]), backgroundImageCache: {},
    templates: originalTemplates, saves: 0, renders: 0,
    $: id => nodes[id], setMessage: (element, text) => { element.text = text; },
    loadImageElement: async url => { if (url.endsWith('broken')) throw Error('decode'); return {}; },
    persistTemplates: async items => { context.saves++; context.templates = items; },
    renderTemplates: () => { context.renders++; }
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { context, nodes };
}
const cases = [
  ['구문 오류', '{', '구문 오류'],
  ['읽기 실패', null, '읽을 수'],
  ['잘못된 루트', 'null', '데이터 형식'],
  ['필수 필드 누락', JSON.stringify(envelope([{...valid(), ratio: undefined}])), '데이터 형식'],
  ['잘못된 이미지 배열 타입', JSON.stringify(envelope([{...valid(), images: {}}])), '데이터 형식'],
  ['필수 배열 누락', JSON.stringify(envelope([{...valid(), images: undefined}])), '데이터 형식'],
  ['중복 템플릿 ID', JSON.stringify(envelope([valid(), valid()])), '데이터 형식'],
  ['손상된 배경 이미지', JSON.stringify(envelope([{...valid(), backgroundId: 'custom', backgroundImage: 'data:image/png;base64,broken'}])), '읽을 수'],
  ['손상된 썸네일', JSON.stringify(envelope([{...valid(), thumbnail: 'data:image/png;base64,broken'}])), '읽을 수'],
  ['정상 항목 뒤 손상 이미지', JSON.stringify(envelope([valid(), {...valid(), id: 'two', images: [{id: 'img', name: '손상', dataUrl: 'data:image/png;base64,broken', x:50,y:50,scale:100,rotation:0,flipX:false,flipY:false}]}])), '읽을 수']
];
for (const [name, contents, error] of cases) test(name + ': 기존 작업·목록·캐시 유지', async () => {
  const {context: c, nodes} = setup();
  const state = c.state, templates = c.templates, images = c.imageCache, background = c.backgroundImageCache;
  await c.importJson({ name:'input.json', type:'application/json', text: async () => { if (contents === null) throw Error('read'); return contents; } });
  assert.equal(c.state, state); assert.equal(c.templates, templates);
  assert.equal(c.imageCache, images); assert.equal(c.backgroundImageCache, background);
  assert.equal(c.saves,0); assert.equal(c.renders,0);
  assert.ok(nodes['#jsonMessage'].text.includes(error));
});
test('정상 데이터는 전체 검증 후 저장하고 작업 유지', async () => {
  const {context:c} = setup(); const state=c.state, images=c.imageCache;
  await c.importJson({name:'ok.json', type:'application/json', text:async()=>JSON.stringify(envelope([valid()]))});
  assert.equal(c.saves,1); assert.equal(c.renders,1); assert.equal(c.state,state); assert.equal(c.imageCache,images);
});
test('저장 실패도 기존 목록 유지', async () => {
  const {context:c} = setup(); const templates=c.templates;
  c.persistTemplates=async()=>{throw Error('quota');};
  await c.importJson({name:'ok.json',type:'application/json',text:async()=>JSON.stringify(envelope([valid()]))});
  assert.equal(c.templates,templates); assert.equal(c.renders,0);
});
