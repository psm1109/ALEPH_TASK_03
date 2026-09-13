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
    textX: 50, textY: 77, textAlign: 'center', images: []
  };

  let state = { ...DEFAULT_STATE, images: [] };
  let templates = [];
  let selectedLayerId = null;
  let activeTab = 'edit';
  let dragState = null;
  let toastTimer;
  let imageCache = new Map();
  const dbPromise = openTemplateDb();

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d');

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

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
      if (Array.isArray(stored)) return stored.map(normalizeTemplate).filter(Boolean);
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeTemplate).filter(Boolean) : [];
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

  function isValidLayer(layer) {
    return Boolean(layer && typeof layer === 'object' && !Array.isArray(layer)
      && typeof layer.id === 'string' && typeof layer.name === 'string'
      && typeof layer.dataUrl === 'string' && /^data:image\/(png|jpeg);base64,/i.test(layer.dataUrl)
      && isFiniteRange(layer.x, -20, 120) && isFiniteRange(layer.y, -20, 120)
      && isFiniteRange(layer.scale, 10, 240) && isFiniteRange(layer.rotation, -180, 180)
      && typeof layer.flipX === 'boolean' && typeof layer.flipY === 'boolean');
  }

  function normalizeTemplate(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const requiredStrings = ['id', 'name', 'ratio', 'text', 'textColor', 'textAlign', 'createdAt'];
    if (!requiredStrings.every(key => typeof item[key] === 'string')) return null;
    if (!RATIOS[item.ratio] || !['left', 'center', 'right'].includes(item.textAlign)) return null;
    if (!/^#[0-9a-f]{6}$/i.test(item.textColor)) return null;
    if (!isFiniteRange(item.fontSize, 16, 180) || !isFiniteRange(item.textX, 5, 95) || !isFiniteRange(item.textY, 5, 95)) return null;
    if (!item.name.trim() || item.name.length > 30 || item.text.length > 120) return null;

    let images;
    if (Array.isArray(item.images)) {
      if (!item.images.every(isValidLayer)) return null;
      images = item.images.map(layer => ({ ...layer }));
    } else if (item.imageData === null || item.imageData === undefined) {
      images = [];
    } else if (typeof item.imageData === 'string' && /^data:image\/(png|jpeg);base64,/i.test(item.imageData)) {
      images = [{
        id: `legacy-${item.id}`, name: item.imageName || '기존 이미지', dataUrl: item.imageData,
        x: 50 + (Number(item.imageX) || 0) * .35, y: 50 + (Number(item.imageY) || 0) * .35,
        scale: Math.max(10, Math.min(240, Number(item.imageZoom) || 100)), rotation: 0, flipX: false, flipY: false
      }];
    } else { return null; }

    return {
      id: item.id, name: item.name, ratio: item.ratio, text: item.text,
      fontSize: item.fontSize, textColor: item.textColor, textX: item.textX,
      textY: item.textY, textAlign: item.textAlign, createdAt: item.createdAt, images
    };
  }

  function currentTemplate(name, id = makeId(), createdAt = new Date().toISOString()) {
    return { id, name: name.trim(), createdAt, ...state, images: state.images.map(layer => ({ ...layer })) };
  }

  function selectedLayer() {
    return state.images.find(layer => layer.id === selectedLayerId) || null;
  }

  function syncControls() {
    $('#textInput').value = state.text;
    $('#charCount').textContent = state.text.length;
    $('#fontSize').value = state.fontSize;
    $('#textColor').value = state.textColor;
    $('#colorValue').textContent = state.textColor.toUpperCase();
    $('#textX').value = state.textX;
    $('#textY').value = state.textY;
    $$('.ratio-button').forEach(button => button.classList.toggle('active', button.dataset.ratio === state.ratio));
    $$('.align-button').forEach(button => button.classList.toggle('active', button.dataset.align === state.textAlign));
    syncLayerControls();
  }

  function syncLayerControls() {
    const layer = selectedLayer();
    $('#layerControls').disabled = !layer;
    $('#selectedLayerName').textContent = layer ? layer.name : '항목을 선택해주세요';
    if (!layer) return;
    $('#layerScale').value = layer.scale;
    $('#layerScaleValue').textContent = `${Math.round(layer.scale)}%`;
    $('#layerRotation').value = layer.rotation;
    $('#layerRotationValue').textContent = `${Math.round(layer.rotation)}°`;
    $('#layerX').value = layer.x;
    $('#layerY').value = layer.y;
    $('#flipHorizontalButton').classList.toggle('active', layer.flipX);
    $('#flipVerticalButton').classList.toggle('active', layer.flipY);
  }

  function switchTab(tab) {
    activeTab = tab;
    const isEdit = tab === 'edit';
    $('#editTab').hidden = !isEdit;
    $('#layersTab').hidden = isEdit;
    $('#editTabButton').classList.toggle('active', isEdit);
    $('#layersTabButton').classList.toggle('active', !isEdit);
    $('#editTabButton').setAttribute('aria-selected', String(isEdit));
    $('#layersTabButton').setAttribute('aria-selected', String(!isEdit));
    if (!isEdit && !selectedLayerId && state.images.length) selectedLayerId = state.images.at(-1).id;
    $('#dragTip').textContent = isEdit ? '문구를 드래그해 옮겨보세요' : (state.images.length ? '선택한 이미지를 드래그해 옮겨보세요' : '먼저 이미지를 추가해주세요');
    renderLayers();
    renderCanvas();
  }

  function setCanvasRatio() {
    const size = RATIOS[state.ratio];
    canvas.width = size.width;
    canvas.height = size.height;
    $('#canvasSize').textContent = `${size.width} × ${size.height} px`;
    renderCanvas();
  }

  function drawPlaceholder() {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#5864ff');
    gradient.addColorStop(.52, '#923cff');
    gradient.addColorStop(1, '#ff745f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = .15;
    ctx.fillStyle = '#ffffff';
    const gap = canvas.width / 7;
    for (let x = -canvas.height; x < canvas.width + canvas.height; x += gap) {
      ctx.save(); ctx.translate(x, 0); ctx.rotate(-.35);
      ctx.fillRect(0, -200, gap * .35, canvas.height * 1.5); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function layerDimensions(layer, image) {
    const width = canvas.width * layer.scale / 100;
    return { width, height: width * image.naturalHeight / image.naturalWidth };
  }

  function drawLayer(layer, showSelection) {
    const image = imageCache.get(layer.id);
    if (!image) return;
    const { width, height } = layerDimensions(layer, image);
    ctx.save();
    ctx.translate(canvas.width * layer.x / 100, canvas.height * layer.y / 100);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    if (showSelection && layer.id === selectedLayerId) {
      ctx.strokeStyle = '#c8f135';
      ctx.lineWidth = Math.max(3, canvas.width / 270);
      ctx.setLineDash([canvas.width / 70, canvas.width / 110]);
      ctx.strokeRect(-width / 2, -height / 2, width, height);
    }
    ctx.restore();
  }

  function renderCanvas(showGuides = true) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPlaceholder();
    state.images.forEach(layer => drawLayer(layer, showGuides && activeTab === 'layers'));
    ctx.save();
    const responsiveSize = state.fontSize * (canvas.width / 1080);
    ctx.font = `800 ${responsiveSize}px 'Noto Sans KR', sans-serif`;
    ctx.textAlign = state.textAlign; ctx.textBaseline = 'middle';
    ctx.fillStyle = state.textColor; ctx.strokeStyle = 'rgba(0,0,0,.42)';
    ctx.lineWidth = Math.max(3, responsiveSize * .075); ctx.lineJoin = 'round';
    const x = canvas.width * state.textX / 100;
    const centerY = canvas.height * state.textY / 100;
    const lines = state.text.split('\n');
    const lineHeight = responsiveSize * 1.22;
    lines.forEach((line, index) => {
      const y = centerY + (index - (lines.length - 1) / 2) * lineHeight;
      ctx.strokeText(line, x, y, canvas.width * .9); ctx.fillText(line, x, y, canvas.width * .9);
    });
    ctx.restore();
  }

  function loadImageElement(dataUrl) {
    const image = new Image();
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl;
    });
  }

  async function hydrateImages(layers) {
    const nextCache = new Map();
    await Promise.all(layers.map(async layer => nextCache.set(layer.id, await loadImageElement(layer.dataUrl))));
    imageCache = nextCache;
  }

  async function handleImageFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const message = $('#fileMessage');
    const validTypes = ['image/png', 'image/jpeg'];
    const additions = [];
    const rejected = [];
    for (const file of files) {
      if (!validTypes.includes(file.type)) { rejected.push(`${file.name}: PNG 또는 JPEG 파일이 아님`); continue; }
      if (file.size > MAX_FILE_SIZE) { rejected.push(`${file.name}: 15MB 초과`); continue; }
      try {
        const dataUrl = await readAsDataURL(file);
        const image = await loadImageElement(dataUrl);
        const id = makeId();
        const offset = Math.min(state.images.length + additions.length, 4) * 3;
        const coverScale = Math.min(240, Math.max(100, (canvas.height / canvas.width) * (image.naturalWidth / image.naturalHeight) * 100));
        const layer = {
          id, name: file.name, dataUrl, x: 50 + offset, y: 50 + offset,
          scale: state.images.length + additions.length === 0 ? coverScale : 58,
          rotation: 0, flipX: false, flipY: false
        };
        additions.push(layer); imageCache.set(id, image);
      } catch (_) { rejected.push(`${file.name}: 손상되었거나 읽을 수 없음`); }
    }
    if (additions.length) {
      state.images.push(...additions);
      selectedLayerId = additions.at(-1).id;
      renderLayers(); syncLayerControls(); renderCanvas(); switchTab('layers');
    }
    if (additions.length && !rejected.length) setMessage(message, `${additions.length}개 이미지를 추가했습니다.`, 'success');
    else if (additions.length) setMessage(message, `${additions.length}개 추가, ${rejected.length}개 거부: ${rejected.join(' · ')}`, 'error');
    else setMessage(message, `${rejected.join(' · ')}. 기존 작업은 그대로 유지됐습니다.`, 'error');
    $('#imageInput').value = '';
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  }

  function renderLayers() {
    const list = $('#layerList');
    $('#layerCount').textContent = state.images.length;
    if (!state.images.length) {
      list.innerHTML = '<div class="layer-empty">추가된 이미지가 없어요.<br>편집 탭에서 이미지를 추가해주세요.</div>';
      selectedLayerId = null; syncLayerControls(); return;
    }
    list.innerHTML = [...state.images].reverse().map(layer => {
      const index = state.images.findIndex(item => item.id === layer.id);
      return `<article class="layer-item ${layer.id === selectedLayerId ? 'active' : ''}" data-layer-id="${escapeHtml(layer.id)}">
        <button class="layer-select" type="button" data-layer-action="select" aria-pressed="${layer.id === selectedLayerId}">
          <img class="layer-thumb" src="${layer.dataUrl}" alt="">
          <span class="layer-copy"><strong>${escapeHtml(layer.name)}</strong><small>크기 ${Math.round(layer.scale)}% · 회전 ${Math.round(layer.rotation)}°</small></span>
        </button>
        <span class="layer-order">
          <button type="button" data-layer-action="up" aria-label="${escapeHtml(layer.name)} 앞으로 가져오기" ${index === state.images.length - 1 ? 'disabled' : ''}>↑</button>
          <button type="button" data-layer-action="down" aria-label="${escapeHtml(layer.name)} 뒤로 보내기" ${index === 0 ? 'disabled' : ''}>↓</button>
        </span>
      </article>`;
    }).join('');
    syncLayerControls();
  }

  function selectLayer(id) {
    if (!state.images.some(layer => layer.id === id)) return;
    selectedLayerId = id; renderLayers(); renderCanvas();
  }

  function moveLayer(id, direction) {
    const index = state.images.findIndex(layer => layer.id === id);
    const target = direction === 'up' ? index + 1 : index - 1;
    if (index < 0 || target < 0 || target >= state.images.length) return;
    [state.images[index], state.images[target]] = [state.images[target], state.images[index]];
    selectedLayerId = id; renderLayers(); renderCanvas();
  }

  function deleteSelectedLayer() {
    const layer = selectedLayer();
    if (!layer || !confirm(`“${layer.name}” 이미지를 삭제할까요?`)) return;
    const index = state.images.findIndex(item => item.id === layer.id);
    state.images.splice(index, 1); imageCache.delete(layer.id);
    selectedLayerId = state.images[Math.min(index, state.images.length - 1)]?.id || null;
    renderLayers(); renderCanvas(); showToast('이미지 항목을 삭제했습니다.');
  }

  function updateSelectedLayer(key, value) {
    const layer = selectedLayer();
    if (!layer) return;
    layer[key] = value; syncLayerControls(); renderLayers(); renderCanvas();
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
    renderCanvas(false);
    const extension = type === 'image/png' ? 'png' : 'jpg';
    const safeName = (state.text.split('\n')[0] || 'mixit').replace(/[\\/:*?"<>|]/g, '').trim() || 'mixit';
    const dataUrl = canvas.toDataURL(type, .92);
    renderCanvas();
    download(`${safeName}-${state.ratio.replace(':', 'x')}.${extension}`, dataUrl);
    showToast(`${extension.toUpperCase()} 파일을 저장했습니다.`);
  }

  function renderTemplates() {
    const list = $('#templateList'); $('#templateCount').textContent = templates.length;
    if (!templates.length) {
      list.innerHTML = '<div class="template-empty">아직 저장된 템플릿이 없어요.<br>현재 작업을 첫 템플릿으로 저장해보세요.</div>'; return;
    }
    list.innerHTML = templates.map(item => `<article class="template-item" data-id="${escapeHtml(item.id)}">
      <div><strong>${escapeHtml(item.name)}</strong><small>${item.ratio} · 이미지 ${item.images.length}개 · ${escapeHtml(item.text.split('\n')[0] || '문구 없음')}</small></div>
      <span class="step ${item.images.length ? 'coral' : ''}">${item.images.length ? 'IMG' : 'TXT'}</span>
      <div class="template-actions"><button type="button" data-action="load">불러오기</button><button type="button" data-action="update">현재 내용으로 수정</button><button type="button" class="delete" data-action="delete" aria-label="${escapeHtml(item.name)} 삭제">×</button></div>
    </article>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  async function loadTemplate(rawItem) {
    const item = normalizeTemplate(rawItem);
    if (!item) return;
    try { await hydrateImages(item.images); }
    catch (_) { setMessage($('#templateMessage'), '템플릿의 이미지 중 읽을 수 없는 항목이 있어 불러오지 않았습니다.', 'error'); return; }
    state = { ...DEFAULT_STATE, ...item, images: item.images.map(layer => ({ ...layer })) };
    selectedLayerId = state.images.at(-1)?.id || null;
    $('#templateName').value = item.name;
    syncControls(); renderLayers(); setCanvasRatio();
    setMessage($('#templateMessage'), `“${item.name}” 템플릿을 불러왔습니다.`, 'success');
  }

  async function saveTemplate(event) {
    event.preventDefault();
    const name = $('#templateName').value.trim();
    if (!name) return;
    try {
      const item = currentTemplate(name); await persistTemplates([item, ...templates]); renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 저장했습니다.`, 'success');
    } catch (_) { setMessage($('#templateMessage'), '저장 공간이 부족해 템플릿을 저장하지 못했습니다. 큰 이미지를 줄인 뒤 다시 시도해주세요.', 'error'); }
  }

  async function updateTemplate(id) {
    const current = templates.find(item => item.id === id); if (!current) return;
    const name = $('#templateName').value.trim() || current.name;
    try {
      await persistTemplates(templates.map(item => item.id === id ? currentTemplate(name, id, current.createdAt) : item));
      $('#templateName').value = name; renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 수정했습니다.`, 'success');
    } catch (_) { setMessage($('#templateMessage'), '저장 공간이 부족해 수정하지 못했습니다. 기존 템플릿은 유지됩니다.', 'error'); }
  }

  async function deleteTemplate(id) {
    const item = templates.find(template => template.id === id);
    if (!item || !confirm(`“${item.name}” 템플릿을 삭제할까요?`)) return;
    try {
      await persistTemplates(templates.filter(template => template.id !== id)); renderTemplates();
      setMessage($('#templateMessage'), '템플릿을 삭제했습니다.', 'success');
    } catch (_) { setMessage($('#templateMessage'), '템플릿을 삭제하지 못했습니다.', 'error'); }
  }

  function exportJson() {
    const payload = { format: 'mixit-templates', version: 2, exportedAt: new Date().toISOString(), templates };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    download(`mixit-templates-${new Date().toISOString().slice(0, 10)}.json`, blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setMessage($('#jsonMessage'), `${templates.length}개 템플릿을 내보냈습니다.`, 'success');
  }

  async function importJson(file) {
    const message = $('#jsonMessage');
    if (!file) return;
    if (!(file.type === 'application/json' || file.name.toLowerCase().endsWith('.json'))) {
      setMessage(message, 'JSON 파일만 가져올 수 있어요. 기존 템플릿은 유지됩니다.', 'error'); return;
    }
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (_) {
      setMessage(message, 'JSON 문법이 손상되어 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error');
      $('#jsonInput').value = ''; return;
    }
    const validEnvelope = parsed && parsed.format === 'mixit-templates' && [1, 2].includes(parsed.version) && Array.isArray(parsed.templates);
    const normalized = validEnvelope ? parsed.templates.map(normalizeTemplate) : [];
    if (!validEnvelope || normalized.some(item => !item)) {
      setMessage(message, '필수 항목이 없거나 형식이 올바르지 않아 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error');
      $('#jsonInput').value = ''; return;
    }
    try {
      await persistTemplates(normalized); renderTemplates();
      setMessage(message, `${templates.length}개 템플릿을 복원했습니다.`, 'success');
    } catch (_) { setMessage(message, '저장 공간이 부족해 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error'); }
    $('#jsonInput').value = '';
  }

  function resetWork() {
    state = { ...DEFAULT_STATE, images: [] }; imageCache = new Map(); selectedLayerId = null;
    $('#templateName').value = ''; setMessage($('#fileMessage'), ''); setMessage($('#templateMessage'), '');
    syncControls(); renderLayers(); setCanvasRatio(); switchTab('edit'); showToast('새 작업을 시작합니다.');
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * canvas.width, y: (event.clientY - rect.top) / rect.height * canvas.height };
  }

  function hitTestLayer(point) {
    return [...state.images].reverse().find(layer => {
      const image = imageCache.get(layer.id); if (!image) return false;
      const { width, height } = layerDimensions(layer, image);
      const dx = point.x - canvas.width * layer.x / 100;
      const dy = point.y - canvas.height * layer.y / 100;
      const angle = -layer.rotation * Math.PI / 180;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
    }) || null;
  }

  function beginCanvasDrag(event) {
    const point = pointerPosition(event);
    if (activeTab === 'layers') {
      const hit = hitTestLayer(point) || selectedLayer(); if (!hit) return;
      selectLayer(hit.id);
      dragState = { type: 'layer', startX: point.x, startY: point.y, layerX: hit.x, layerY: hit.y };
    } else {
      dragState = { type: 'text' };
      state.textX = Math.max(5, Math.min(95, point.x / canvas.width * 100));
      state.textY = Math.max(5, Math.min(95, point.y / canvas.height * 100));
      syncControls(); renderCanvas();
    }
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); $('#dragTip').classList.add('hidden');
  }

  function moveCanvasDrag(event) {
    if (!dragState) return;
    const point = pointerPosition(event);
    if (dragState.type === 'text') {
      state.textX = Math.max(5, Math.min(95, point.x / canvas.width * 100));
      state.textY = Math.max(5, Math.min(95, point.y / canvas.height * 100));
    } else {
      const layer = selectedLayer(); if (!layer) return;
      layer.x = Math.max(-20, Math.min(120, dragState.layerX + (point.x - dragState.startX) / canvas.width * 100));
      layer.y = Math.max(-20, Math.min(120, dragState.layerY + (point.y - dragState.startY) / canvas.height * 100));
    }
    syncControls(); renderCanvas();
  }

  function endCanvasDrag() {
    if (dragState?.type === 'layer') renderLayers();
    dragState = null; canvas.classList.remove('dragging');
  }

  function bindEvents() {
    $('#imageInput').addEventListener('change', event => handleImageFiles(event.target.files));
    const upload = $('#uploadZone');
    ['dragenter', 'dragover'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.remove('dragover'); }));
    upload.addEventListener('drop', event => handleImageFiles(event.dataTransfer.files));
    $('#editTabButton').addEventListener('click', () => switchTab('edit'));
    $('#layersTabButton').addEventListener('click', () => switchTab('layers'));
    $('#openLayersButton').addEventListener('click', () => switchTab('layers'));
    $('#textInput').addEventListener('input', event => { state.text = event.target.value; $('#charCount').textContent = state.text.length; renderCanvas(); });
    $('#fontSize').addEventListener('input', event => { state.fontSize = Math.max(16, Math.min(180, Number(event.target.value) || 16)); renderCanvas(); });
    $('#textColor').addEventListener('input', event => { state.textColor = event.target.value; $('#colorValue').textContent = event.target.value.toUpperCase(); renderCanvas(); });
    ['textX', 'textY'].forEach(id => $(`#${id}`).addEventListener('input', event => { state[id] = Number(event.target.value); renderCanvas(); }));
    $$('.align-button').forEach(button => button.addEventListener('click', () => { state.textAlign = button.dataset.align; syncControls(); renderCanvas(); }));
    $$('.ratio-button').forEach(button => button.addEventListener('click', () => { state.ratio = button.dataset.ratio; syncControls(); setCanvasRatio(); }));
    $('#layerList').addEventListener('click', event => {
      const button = event.target.closest('[data-layer-action]'); if (!button) return;
      const id = button.closest('.layer-item').dataset.layerId;
      if (button.dataset.layerAction === 'select') selectLayer(id);
      if (button.dataset.layerAction === 'up') moveLayer(id, 'up');
      if (button.dataset.layerAction === 'down') moveLayer(id, 'down');
    });
    $('#layerScale').addEventListener('input', event => updateSelectedLayer('scale', Number(event.target.value)));
    $('#layerRotation').addEventListener('input', event => updateSelectedLayer('rotation', Number(event.target.value)));
    $('#layerX').addEventListener('input', event => updateSelectedLayer('x', Number(event.target.value)));
    $('#layerY').addEventListener('input', event => updateSelectedLayer('y', Number(event.target.value)));
    $('#flipHorizontalButton').addEventListener('click', () => { const layer = selectedLayer(); if (layer) updateSelectedLayer('flipX', !layer.flipX); });
    $('#flipVerticalButton').addEventListener('click', () => { const layer = selectedLayer(); if (layer) updateSelectedLayer('flipY', !layer.flipY); });
    $('#deleteLayerButton').addEventListener('click', deleteSelectedLayer);
    $('#downloadPngButton').addEventListener('click', () => downloadImage('image/png'));
    $('#downloadJpegButton').addEventListener('click', () => downloadImage('image/jpeg'));
    $('#resetButton').addEventListener('click', resetWork);
    $('#templateForm').addEventListener('submit', saveTemplate);
    $('#templateList').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]'); if (!button) return;
      const id = button.closest('.template-item').dataset.id;
      const item = templates.find(template => template.id === id);
      if (button.dataset.action === 'load') loadTemplate(item);
      if (button.dataset.action === 'update') updateTemplate(id);
      if (button.dataset.action === 'delete') deleteTemplate(id);
    });
    $('#exportJsonButton').addEventListener('click', exportJson);
    $('#jsonInput').addEventListener('change', event => importJson(event.target.files[0]));
    canvas.addEventListener('pointerdown', beginCanvasDrag);
    canvas.addEventListener('pointermove', moveCanvasDrag);
    canvas.addEventListener('pointerup', endCanvasDrag);
    canvas.addEventListener('pointercancel', endCanvasDrag);
  }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: 'get_editor_state', title: '편집 상태 확인', description: '현재 비율, 문구, 이미지 항목과 선택 상태를 확인합니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({ ratio: state.ratio, text: state.text, imageCount: state.images.length, selectedLayerId, images: state.images.map(({ id, name, x, y, scale, rotation, flipX, flipY }) => ({ id, name, x, y, scale, rotation, flipX, flipY })), templateCount: templates.length })
      },
      {
        name: 'set_canvas_ratio', title: '캔버스 비율 변경', description: '캔버스 비율을 1:1, 4:5, 9:16 중 하나로 변경합니다.',
        inputSchema: { type: 'object', properties: { ratio: { type: 'string', enum: ['1:1', '4:5', '9:16'] } }, required: ['ratio'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: ({ ratio }) => { if (!RATIOS[ratio]) throw new Error('지원하지 않는 비율입니다.'); state.ratio = ratio; syncControls(); setCanvasRatio(); return { ratio, size: RATIOS[ratio] }; }
      },
      {
        name: 'transform_image_layer', title: '이미지 항목 변형', description: '선택한 이미지 항목의 위치, 크기, 회전, 대칭을 변경합니다.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number', minimum: -20, maximum: 120 }, y: { type: 'number', minimum: -20, maximum: 120 }, scale: { type: 'number', minimum: 10, maximum: 240 }, rotation: { type: 'number', minimum: -180, maximum: 180 }, flipX: { type: 'boolean' }, flipY: { type: 'boolean' } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: input => {
          const layer = state.images.find(item => item.id === input.id); if (!layer) throw new Error('이미지 항목을 찾을 수 없습니다.');
          ['x', 'y', 'scale', 'rotation', 'flipX', 'flipY'].forEach(key => { if (input[key] !== undefined) layer[key] = input[key]; });
          selectedLayerId = layer.id; renderLayers(); renderCanvas(); return { updated: true, id: layer.id };
        }
      }
    ];
    tools.forEach(tool => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  async function init() {
    bindEvents(); syncControls(); setCanvasRatio(); renderLayers();
    templates = await loadTemplates(); renderTemplates(); registerWebMcp();
    if (document.fonts?.ready) document.fonts.ready.then(renderCanvas);
  }

  init();
})();
