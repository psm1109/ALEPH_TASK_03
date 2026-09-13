(() => {
  'use strict';

  const STORAGE_KEY = 'mixit-templates-v1';
  const DB_NAME = 'mixit-studio';
  const DB_STORE = 'library';
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const RATIOS = {
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '9:16': { width: 1080, height: 1920 }
  };
  const DEFAULT_STATE = {
    ratio: '1:1', text: '오늘도\n내가 해냄', fontSize: 68, textColor: '#ffffff',
    textX: 50, textY: 77, textAlign: 'center', imageZoom: 100, imageX: 0, imageY: 0,
    imageData: null, imageName: null
  };

  let state = { ...DEFAULT_STATE };
  let templates = [];
  const dbPromise = openTemplateDb();
  let imageObject = null;
  let editingId = null;
  let draggingText = false;
  let toastTimer;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d');

  function openTemplateDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function loadTemplates() {
    const db = await dbPromise;
    if (db) {
      const stored = await new Promise(resolve => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(STORAGE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (Array.isArray(stored)) return stored.filter(isValidTemplate);
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isValidTemplate) : [];
    } catch (_) { return []; }
  }

  async function persistTemplates(nextTemplates) {
    const db = await dbPromise;
    if (db) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        transaction.objectStore(DB_STORE).put(nextTemplates, STORAGE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTemplates));
    }
    templates = nextTemplates;
  }

  function isFiniteRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function isValidTemplate(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const requiredStrings = ['id', 'name', 'ratio', 'text', 'textColor', 'textAlign', 'createdAt'];
    if (!requiredStrings.every(key => typeof item[key] === 'string')) return false;
    if (!RATIOS[item.ratio] || !['left', 'center', 'right'].includes(item.textAlign)) return false;
    if (!/^#[0-9a-f]{6}$/i.test(item.textColor)) return false;
    if (!isFiniteRange(item.fontSize, 16, 180) || !isFiniteRange(item.textX, 5, 95) || !isFiniteRange(item.textY, 5, 95)) return false;
    if (!isFiniteRange(item.imageZoom, 100, 240) || !isFiniteRange(item.imageX, -50, 50) || !isFiniteRange(item.imageY, -50, 50)) return false;
    if (!(item.imageData === null || (typeof item.imageData === 'string' && /^data:image\/(png|jpeg);base64,/i.test(item.imageData)))) return false;
    if (!(item.imageName === null || typeof item.imageName === 'string')) return false;
    return item.name.trim().length > 0 && item.name.length <= 30 && item.text.length <= 120;
  }

  function currentTemplate(name, id = crypto.randomUUID(), createdAt = new Date().toISOString()) {
    return { id, name: name.trim(), createdAt, ...state };
  }

  function syncControls() {
    $('#textInput').value = state.text;
    $('#charCount').textContent = state.text.length;
    $('#fontSize').value = state.fontSize;
    $('#textColor').value = state.textColor;
    $('#colorValue').textContent = state.textColor.toUpperCase();
    $('#textX').value = state.textX; $('#textY').value = state.textY;
    $('#imageZoom').value = state.imageZoom; $('#imageZoomValue').textContent = `${state.imageZoom}%`;
    $('#imageX').value = state.imageX; $('#imageY').value = state.imageY;
    $$('.ratio-button').forEach(button => button.classList.toggle('active', button.dataset.ratio === state.ratio));
    $$('.align-button').forEach(button => button.classList.toggle('active', button.dataset.align === state.textAlign));
  }

  function setCanvasRatio() {
    const size = RATIOS[state.ratio];
    canvas.width = size.width; canvas.height = size.height;
    $('#canvasSize').textContent = `${size.width} × ${size.height} px`;
    renderCanvas();
  }

  function drawPlaceholder() {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#5864ff'); gradient.addColorStop(.52, '#923cff'); gradient.addColorStop(1, '#ff745f');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = .15; ctx.fillStyle = '#ffffff';
    const gap = canvas.width / 7;
    for (let x = -canvas.height; x < canvas.width + canvas.height; x += gap) {
      ctx.save(); ctx.translate(x, 0); ctx.rotate(-.35); ctx.fillRect(0, -200, gap * .35, canvas.height * 1.5); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawImageCover() {
    if (!imageObject) { drawPlaceholder(); return; }
    const baseScale = Math.max(canvas.width / imageObject.naturalWidth, canvas.height / imageObject.naturalHeight);
    const scale = baseScale * state.imageZoom / 100;
    const width = imageObject.naturalWidth * scale, height = imageObject.naturalHeight * scale;
    const overflowX = Math.max(0, width - canvas.width), overflowY = Math.max(0, height - canvas.height);
    const x = (canvas.width - width) / 2 + (state.imageX / 50) * (overflowX / 2);
    const y = (canvas.height - height) / 2 + (state.imageY / 50) * (overflowY / 2);
    ctx.drawImage(imageObject, x, y, width, height);
  }

  function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawImageCover();
    ctx.save();
    const responsiveSize = state.fontSize * (canvas.width / 1080);
    ctx.font = `800 ${responsiveSize}px 'Noto Sans KR', sans-serif`;
    ctx.textAlign = state.textAlign; ctx.textBaseline = 'middle';
    ctx.fillStyle = state.textColor; ctx.strokeStyle = 'rgba(0,0,0,.42)'; ctx.lineWidth = Math.max(3, responsiveSize * .075); ctx.lineJoin = 'round';
    const x = canvas.width * state.textX / 100, centerY = canvas.height * state.textY / 100;
    const lines = state.text.split('\n');
    const lineHeight = responsiveSize * 1.22;
    lines.forEach((line, index) => {
      const y = centerY + (index - (lines.length - 1) / 2) * lineHeight;
      ctx.strokeText(line, x, y, canvas.width * .9); ctx.fillText(line, x, y, canvas.width * .9);
    });
    ctx.restore();
  }

  async function loadImageData(dataUrl) {
    if (!dataUrl) { imageObject = null; renderCanvas(); return; }
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    imageObject = img; renderCanvas();
  }

  async function handleImageFile(file) {
    const message = $('#fileMessage');
    const validTypes = ['image/png', 'image/jpeg'];
    if (!file) return;
    if (!validTypes.includes(file.type)) {
      setMessage(message, 'PNG 또는 JPEG 파일만 사용할 수 있어요. 기존 작업은 그대로 유지됐습니다.', 'error'); return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setMessage(message, '파일이 15MB를 초과해 불러올 수 없어요. 기존 작업은 그대로 유지됐습니다.', 'error'); return;
    }
    try {
      const dataUrl = await readAsDataURL(file);
      const candidate = new Image();
      await new Promise((resolve, reject) => { candidate.onload = resolve; candidate.onerror = reject; candidate.src = dataUrl; });
      imageObject = candidate; state.imageData = dataUrl; state.imageName = file.name;
      state.imageZoom = 100; state.imageX = 0; state.imageY = 0;
      syncControls(); renderCanvas();
      setMessage(message, `${file.name} 이미지를 불러왔습니다.`, 'success');
    } catch (_) {
      setMessage(message, '손상되었거나 읽을 수 없는 이미지예요. 기존 작업은 그대로 유지됐습니다.', 'error');
    } finally { $('#imageInput').value = ''; }
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  function setMessage(element, text, type = '') {
    element.textContent = text; element.className = `status-message ${type}`;
  }

  function showToast(text) {
    const toast = $('#toast'); toast.textContent = text; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function download(filename, href) {
    const anchor = document.createElement('a'); anchor.download = filename; anchor.href = href; anchor.click();
  }

  function downloadImage(type) {
    const extension = type === 'image/png' ? 'png' : 'jpg';
    const safeName = (state.text.split('\n')[0] || 'mixit').replace(/[\\/:*?"<>|]/g, '').trim() || 'mixit';
    download(`${safeName}-${state.ratio.replace(':','x')}.${extension}`, canvas.toDataURL(type, .92));
    showToast(`${extension.toUpperCase()} 파일을 저장했습니다.`);
  }

  function renderTemplates() {
    const list = $('#templateList'); $('#templateCount').textContent = templates.length;
    if (!templates.length) { list.innerHTML = '<div class="template-empty">아직 저장된 템플릿이 없어요.<br>현재 작업을 첫 템플릿으로 저장해보세요.</div>'; return; }
    list.innerHTML = templates.map(item => `
      <article class="template-item" data-id="${escapeHtml(item.id)}">
        <div><strong>${escapeHtml(item.name)}</strong><small>${item.ratio} · ${escapeHtml(item.text.split('\n')[0] || '문구 없음')}</small></div>
        <span class="step ${item.imageData ? 'coral' : ''}">${item.imageData ? 'IMG' : 'TXT'}</span>
        <div class="template-actions">
          <button type="button" data-action="load">불러오기</button>
          <button type="button" data-action="update">현재 내용으로 수정</button>
          <button type="button" class="delete" data-action="delete" aria-label="${escapeHtml(item.name)} 삭제">×</button>
        </div>
      </article>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  }

  async function loadTemplate(item) {
    const nextState = { ...DEFAULT_STATE, ...item };
    try { await loadImageData(nextState.imageData); }
    catch (_) { setMessage($('#templateMessage'), '템플릿의 이미지를 읽을 수 없어 불러오지 않았습니다.', 'error'); return; }
    state = nextState; editingId = item.id; $('#templateName').value = item.name;
    syncControls(); setCanvasRatio();
    setMessage($('#templateMessage'), `“${item.name}” 템플릿을 불러왔습니다.`, 'success');
  }

  async function saveTemplate(event) {
    event.preventDefault();
    const name = $('#templateName').value.trim();
    if (!name) return;
    try {
      const item = currentTemplate(name);
      await persistTemplates([item, ...templates]);
      editingId = item.id; renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 저장했습니다.`, 'success');
    } catch (error) {
      setMessage($('#templateMessage'), '저장 공간이 부족해 템플릿을 저장하지 못했습니다. 큰 이미지를 줄인 뒤 다시 시도해주세요.', 'error');
    }
  }

  async function updateTemplate(id) {
    const current = templates.find(item => item.id === id); if (!current) return;
    const name = ($('#templateName').value.trim() || current.name);
    try {
      await persistTemplates(templates.map(item => item.id === id ? currentTemplate(name, id, current.createdAt) : item));
      editingId = id; $('#templateName').value = name; renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 수정했습니다.`, 'success');
    } catch (_) { setMessage($('#templateMessage'), '저장 공간이 부족해 수정하지 못했습니다. 기존 템플릿은 유지됩니다.', 'error'); }
  }

  async function deleteTemplate(id) {
    const item = templates.find(template => template.id === id); if (!item) return;
    if (!confirm(`“${item.name}” 템플릿을 삭제할까요?`)) return;
    try { await persistTemplates(templates.filter(template => template.id !== id)); renderTemplates(); setMessage($('#templateMessage'), '템플릿을 삭제했습니다.', 'success'); }
    catch (_) { setMessage($('#templateMessage'), '템플릿을 삭제하지 못했습니다.', 'error'); }
  }

  function exportJson() {
    const payload = { format: 'mixit-templates', version: 1, exportedAt: new Date().toISOString(), templates };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    download(`mixit-templates-${new Date().toISOString().slice(0,10)}.json`, blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); setMessage($('#jsonMessage'), `${templates.length}개 템플릿을 내보냈습니다.`, 'success');
  }

  async function importJson(file) {
    const message = $('#jsonMessage');
    if (!file) return;
    if (!(file.type === 'application/json' || file.name.toLowerCase().endsWith('.json'))) {
      setMessage(message, 'JSON 파일만 가져올 수 있어요. 기존 템플릿은 유지됩니다.', 'error'); return;
    }
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (_) { setMessage(message, 'JSON 문법이 손상되어 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error'); $('#jsonInput').value = ''; return; }
    if (!parsed || parsed.format !== 'mixit-templates' || parsed.version !== 1 || !Array.isArray(parsed.templates) || !parsed.templates.every(isValidTemplate)) {
      setMessage(message, '필수 항목이 없거나 형식이 올바르지 않아 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error'); $('#jsonInput').value = ''; return;
    }
    try {
      await persistTemplates(parsed.templates); renderTemplates();
      setMessage(message, `${templates.length}개 템플릿을 복원했습니다.`, 'success');
    } catch (_) { setMessage(message, '저장 공간이 부족해 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error'); }
    $('#jsonInput').value = '';
  }

  function resetWork() {
    state = { ...DEFAULT_STATE }; imageObject = null; editingId = null; $('#templateName').value = '';
    setMessage($('#fileMessage'), '', ''); setMessage($('#templateMessage'), '', ''); syncControls(); setCanvasRatio(); showToast('새 작업을 시작합니다.');
  }

  function bindEvents() {
    $('#imageInput').addEventListener('change', event => handleImageFile(event.target.files[0]));
    const upload = $('#uploadZone');
    ['dragenter','dragover'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.remove('dragover'); }));
    upload.addEventListener('drop', event => handleImageFile(event.dataTransfer.files[0]));

    $('#textInput').addEventListener('input', event => { state.text = event.target.value; $('#charCount').textContent = state.text.length; renderCanvas(); });
    $('#fontSize').addEventListener('input', event => { state.fontSize = Math.max(16, Math.min(180, Number(event.target.value) || 16)); renderCanvas(); });
    $('#textColor').addEventListener('input', event => { state.textColor = event.target.value; $('#colorValue').textContent = event.target.value.toUpperCase(); renderCanvas(); });
    ['textX','textY','imageX','imageY'].forEach(id => $(`#${id}`).addEventListener('input', event => { state[id] = Number(event.target.value); renderCanvas(); }));
    $('#imageZoom').addEventListener('input', event => { state.imageZoom = Number(event.target.value); $('#imageZoomValue').textContent = `${state.imageZoom}%`; renderCanvas(); });
    $$('.align-button').forEach(button => button.addEventListener('click', () => { state.textAlign = button.dataset.align; syncControls(); renderCanvas(); }));
    $$('.ratio-button').forEach(button => button.addEventListener('click', () => { state.ratio = button.dataset.ratio; syncControls(); setCanvasRatio(); }));

    $('#downloadPngButton').addEventListener('click', () => downloadImage('image/png'));
    $('#downloadJpegButton').addEventListener('click', () => downloadImage('image/jpeg'));
    $('#resetButton').addEventListener('click', resetWork);
    $('#templateForm').addEventListener('submit', saveTemplate);
    $('#templateList').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]'); if (!button) return;
      const id = button.closest('.template-item').dataset.id; const item = templates.find(template => template.id === id);
      if (button.dataset.action === 'load') loadTemplate(item);
      if (button.dataset.action === 'update') updateTemplate(id);
      if (button.dataset.action === 'delete') deleteTemplate(id);
    });
    $('#exportJsonButton').addEventListener('click', exportJson);
    $('#jsonInput').addEventListener('change', event => importJson(event.target.files[0]));

    const pointerPosition = event => {
      const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 };
    };
    canvas.addEventListener('pointerdown', event => { draggingText = true; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); $('#dragTip').classList.add('hidden'); const p = pointerPosition(event); state.textX = Math.max(5,Math.min(95,p.x)); state.textY = Math.max(5,Math.min(95,p.y)); syncControls(); renderCanvas(); });
    canvas.addEventListener('pointermove', event => { if (!draggingText) return; const p = pointerPosition(event); state.textX = Math.max(5,Math.min(95,p.x)); state.textY = Math.max(5,Math.min(95,p.y)); syncControls(); renderCanvas(); });
    canvas.addEventListener('pointerup', () => { draggingText = false; canvas.classList.remove('dragging'); });
  }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      { name: 'get_editor_state', title: '편집 상태 확인', description: '현재 비율과 문구 편집 상태를 확인합니다.', inputSchema: { type:'object', properties:{}, additionalProperties:false }, annotations:{ readOnlyHint:true, untrustedContentHint:false }, execute: () => ({ ratio:state.ratio, text:state.text, fontSize:state.fontSize, textColor:state.textColor, textX:state.textX, textY:state.textY, templateCount:templates.length }) },
      { name: 'set_canvas_ratio', title: '캔버스 비율 변경', description: '캔버스 비율을 1:1, 4:5, 9:16 중 하나로 변경합니다.', inputSchema: { type:'object', properties:{ ratio:{ type:'string', enum:['1:1','4:5','9:16'] } }, required:['ratio'], additionalProperties:false }, annotations:{ readOnlyHint:false, untrustedContentHint:false }, execute: ({ratio}) => { if (!RATIOS[ratio]) throw new Error('지원하지 않는 비율입니다.'); state.ratio=ratio; syncControls(); setCanvasRatio(); return { ratio, size:RATIOS[ratio] }; } },
      { name: 'update_caption', title: '문구 편집', description: '캔버스의 문구, 크기, 색상, 위치를 한 번에 변경합니다.', inputSchema: { type:'object', properties:{ text:{type:'string',maxLength:120}, fontSize:{type:'number',minimum:16,maximum:180}, textColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}, textX:{type:'number',minimum:5,maximum:95}, textY:{type:'number',minimum:5,maximum:95} }, additionalProperties:false }, annotations:{readOnlyHint:false,untrustedContentHint:false}, execute: input => { if (input.text !== undefined) state.text=input.text; ['fontSize','textX','textY'].forEach(k=>{if(input[k]!==undefined) state[k]=input[k]}); if(input.textColor!==undefined){if(!/^#[0-9a-f]{6}$/i.test(input.textColor))throw new Error('색상 형식이 올바르지 않습니다.'); state.textColor=input.textColor;} syncControls(); renderCanvas(); return {updated:true,text:state.text}; } }
    ];
    tools.forEach(tool => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  async function init() {
    bindEvents(); syncControls(); setCanvasRatio();
    templates = await loadTemplates(); renderTemplates(); registerWebMcp();
    if (document.fonts?.ready) document.fonts.ready.then(renderCanvas);
  }

  init();
})();
