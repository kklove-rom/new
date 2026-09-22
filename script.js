// ── CONSTANTS ──
const PenColors   = ['#2a303e','#2b579a','#c42b1c'];
const MarkerColors= ['#fff18f','#a6e3a1','#80cbc4'];
const STORAGE_KEY = 'markit_v2_state';

const S = {
  mode:'text', tool:'pen', color:PenColors[0], size:3,
  history:[], maxH:60,
  customPenColors:[...PenColors],
  customMarkerColors:[...MarkerColors],
  fontSize: 16,
  penHistory: [],
};

// ── DOM REFS ──
const textEditor   = document.getElementById('text-editor');
const canvasWrapper= document.getElementById('canvas-wrapper');
const pageContainer= document.getElementById('page-container');
const docArea      = document.getElementById('doc-area');
const btnText      = document.getElementById('btn-text');
const btnDraw      = document.getElementById('btn-draw');
const penBallEl    = document.getElementById('pen-ball');
const penPanel     = document.getElementById('pen-panel');
const penTrigger   = document.getElementById('pen-trigger');
const sizeSlider   = document.getElementById('size-slider');
const colorSection = document.getElementById('color-section');
const row1         = document.getElementById('color-row-1');
const row2         = document.getElementById('color-row-2');
const confirmOverlay = document.getElementById('confirm-overlay');
const colorPickerModal = document.getElementById('color-picker-modal');
const colorInput   = document.getElementById('color-input');
const colorPreview = document.getElementById('color-preview');
const fontSizeInput= document.getElementById('font-size-input');
const wordCountEl  = document.getElementById('word-count');
const statusModeEl = document.getElementById('status-mode');

// ── FABRIC CANVAS ──
const fc = new fabric.Canvas('c', {
  isDrawingMode:false, selection:false,
  backgroundColor:null, enableRetinaScaling:true
});
// iPad/触屏画线关键修复：禁止浏览器接管画布上的触摸手势（滚动/缩放），
// 否则 Apple Pencil/手指画线会被当成页面滚动，笔画断断续续。
fc.upperCanvasEl.style.touchAction = 'none';

let syncCanvasRaf = null;
// 长文时页面高度可达数万像素，retina 会让画布像素按 dpr² 爆炸
// （如 794×30000 的页面在 dpr=2 下是 1588×60000，占几百 MB 内存），
// 导致每次 renderAll 都卡死。超过安全像素量时自动关闭 retina，页面变短后再恢复。
const MAX_RETINA_PIXELS = 16000000; // 约 4000×4000
function syncCanvasSize(){
  if(syncCanvasRaf) return;
  syncCanvasRaf = requestAnimationFrame(()=>{
    syncCanvasRaf = null;
    const pw = pageContainer.offsetWidth;
    const ph = Math.max(pageContainer.offsetHeight, textEditor.offsetHeight + 76);
    pageContainer.style.minHeight = ph + 'px';
    const dpr = window.devicePixelRatio || 1;
    const needRetina = dpr > 1 && (pw * ph * dpr * dpr) <= MAX_RETINA_PIXELS;
    const retinaChanged = fc.enableRetinaScaling !== needRetina;
    fc.enableRetinaScaling = needRetina;
    if(retinaChanged || fc.getWidth() !== pw || fc.getHeight() !== ph){
      fc.setWidth(pw);
      fc.setHeight(ph);
      fc.wrapperEl.style.width = pw + 'px';
      fc.wrapperEl.style.height = ph + 'px';
      fc.wrapperEl.style.position = 'relative';
      fc.renderAll();
    }
  });
}

let resizeRaf = null;
function onWindowResize(){
  if(resizeRaf) return;
  resizeRaf = requestAnimationFrame(()=>{
    resizeRaf = null;
    syncCanvasSize();
    buildRuler();
  });
}
window.addEventListener('resize', onWindowResize);
setTimeout(syncCanvasSize, 100);

let roPending = false;
const resizeObserver = new ResizeObserver(() => {
  if(roPending) return;
  roPending = true;
  requestAnimationFrame(()=>{ roPending = false; syncCanvasSize(); });
});
resizeObserver.observe(textEditor);

// ── FONT SIZE ──
function applyFontSize(size){
  S.fontSize = Math.max(8, Math.min(72, size));
  fontSizeInput.value = S.fontSize;
  textEditor.style.fontSize = S.fontSize + 'px';
  autoSave();
}
fontSizeInput.addEventListener('change', ()=> applyFontSize(parseInt(fontSizeInput.value)||16));
fontSizeInput.addEventListener('keydown', e=>{
  if(e.key==='Enter') applyFontSize(parseInt(fontSizeInput.value)||16);
});
document.getElementById('fs-up').addEventListener('click', ()=> applyFontSize(S.fontSize+1));
document.getElementById('fs-down').addEventListener('click', ()=> applyFontSize(S.fontSize-1));

// ── ZOOM FONT BUTTONS ──
document.getElementById('btn-font-in').addEventListener('click', ()=> applyFontSize(S.fontSize+1));
document.getElementById('btn-font-out').addEventListener('click', ()=> applyFontSize(S.fontSize-1));

// ── WORD COUNT ──
function updateWordCount(){
  const text = textEditor.innerText || '';
  const chinese = (text.match(/[一-龥]/g)||[]).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  wordCountEl.textContent = chinese > 0 ? `${chinese} 字` : `${words} 词`;
}
let wcTimer = null;
textEditor.addEventListener('input', ()=>{
  if(wcTimer) clearTimeout(wcTimer);
  wcTimer = setTimeout(()=>{ updateWordCount(); }, 200);
  autoSave();
});

// ── RULER ──
let rulerBuilt = false;
function buildRuler(){
  const ruler = document.getElementById('ruler');
  const inner = document.getElementById('ruler-inner');
  const pw = ruler.offsetWidth;
  if(!pw) return;
  const dpi = 96;
  const cm_per_px = 2.54 / dpi;
  const total_cm = pw * cm_per_px;
  const marginLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-padding')) || 38;
  const marginRight = marginLeft;

  const mlEl = document.getElementById('ruler-margin-left');
  const mrEl = document.getElementById('ruler-margin-right');
  mlEl.style.left = '0'; mlEl.style.width = marginLeft + 'px';
  mrEl.style.right = '0'; mrEl.style.width = marginRight + 'px';

  if(!rulerBuilt){
    inner.innerHTML = '';
    for(let i=0; i<=Math.ceil(total_cm*2); i++){
      const x = (i/2) / cm_per_px;
      if(x > pw) break;
      const el = document.createElement('div');
      el.className = 'ruler-mark ' + (i%2===0?'major':'minor');
      el.style.left = x + 'px';
      inner.appendChild(el);
      if(i%2===0 && i>0){
        const n = document.createElement('div');
        n.className = 'ruler-num';
        n.style.left = x + 'px';
        n.textContent = Math.round(i/2);
        inner.appendChild(n);
      }
    }
    rulerBuilt = true;
  }
}
let rulerTimer = null;
window.addEventListener('resize', ()=>{
  if(rulerTimer) return;
  rulerTimer = requestAnimationFrame(()=>{ rulerTimer = null; buildRuler(); });
});
setTimeout(buildRuler, 200);

// ── VIEW SWITCH / 笔记绑定（首页 ⇄ 内页） ──
let currentNoteId = null;
let noteReadOnly  = false;
let penLoadToken  = 0; // 防止 loadFromJSON 异步回调串台
const homeViewEl   = document.getElementById('home-view');
const editorViewEl = document.getElementById('editor-view');
const titlebarTitle= document.getElementById('titlebar-title');
const HOME_KEY     = 'markit_home_v1';

function getHomeState(){ try{ return JSON.parse(localStorage.getItem(HOME_KEY)||'null'); }catch(e){ return null; } }
function getCurrentNote(){
  const hs = getHomeState();
  return hs ? (hs.notes||[]).find(n=>n.id===currentNoteId) : null;
}

// 打开笔记内页（由首页调用）
function openNoteView(id){
  currentNoteId = id;
  const note = getCurrentNote();
  titlebarTitle.textContent = note ? note.name : '文档';
  noteReadOnly = !!(note && note.folderId==='trash');
  textEditor.contentEditable = noteReadOnly ? 'false' : 'true';
  // 重置编辑器
  const myToken = ++penLoadToken;
  fc.clear();
  textEditor.innerHTML = '';
  S.fontSize = 16; fontSizeInput.value = 16; textEditor.style.fontSize = '16px';
  if(note){
    if(note.content) textEditor.innerHTML = note.content;
    if(note.fontSize){ S.fontSize = note.fontSize; fontSizeInput.value = S.fontSize; textEditor.style.fontSize = S.fontSize+'px'; }
    if(note.customPenColors) S.customPenColors = note.customPenColors;
    if(note.customMarkerColors) S.customMarkerColors = note.customMarkerColors;
    if(note.pen){
      try{
        fc.loadFromJSON(JSON.parse(note.pen), ()=>{
          if(myToken !== penLoadToken) return; // 已切换到其他笔记/首页，丢弃过期回调
          fc.setZoom(1); fc.renderAll();
        });
      }catch(e){}
    }
  }
  homeViewEl.classList.add('hidden');
  editorViewEl.classList.remove('hidden');
  updateWordCount();
  renderPalette();
  setMode('text');
  setTimeout(()=>{ syncCanvasSize(); buildRuler(); }, 50);
}

// 返回首页（红绿灯）
function backToHome(){
  if(currentNoteId) autoSave();
  penLoadToken++; // 使进行中的笔迹加载回调失效
  editorViewEl.classList.add('hidden');
  homeViewEl.classList.remove('hidden');
  currentNoteId = null;
  noteReadOnly = false;
  if(window.__markitHomeRender) window.__markitHomeRender();
}
document.querySelectorAll('#titlebar-dots span').forEach(s=> s.addEventListener('click', backToHome));

// ── STORAGE ──
let saveTimer = null;
function autoSave(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    try{
      const content = textEditor.innerHTML;
      const penJSON = JSON.stringify(fc.toJSON());
      if(currentNoteId){
        if(noteReadOnly) return; // 回收站笔记只读，不写回
        // 写回首页存储中对应笔记
        const hs = getHomeState();
        if(hs){
          const n = (hs.notes||[]).find(n=>n.id===currentNoteId);
          if(n){
            // 无变化则跳过：长文 + 大量笔迹时避免反复把几 MB 数据写入 localStorage 造成卡顿
            if(n.content===content && n.pen===penJSON && n.fontSize===S.fontSize) return;
            n.content = content;
            n.pen = penJSON;
            n.fontSize = S.fontSize;
            n.customPenColors = S.customPenColors;
            n.customMarkerColors = S.customMarkerColors;
            localStorage.setItem(HOME_KEY, JSON.stringify(hs));
          }
        }
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        text: textEditor.innerHTML,
        pen: penJSON,
        fontSize: S.fontSize,
        customPenColors: S.customPenColors,
        customMarkerColors: S.customMarkerColors,
      }));
    }catch(e){}
  }, 800);
}

function loadSave(){
  // 旧版单文档存储已不再自动加载（避免异步 loadFromJSON 回调在 fc.clear() 之后
  // 把旧笔迹重新塞回画布造成卡顿）；内容统一由 openNoteView 按笔记加载。
}

// ── MODE ──
function setMode(mode){
  if(noteReadOnly && mode==='draw'){ showToast('已删除的笔记为只读，恢复后才能编辑'); return; }
  S.mode = mode;
  if(mode==='text'){
    fc.isDrawingMode = false;
    fc.selection = false;
    canvasWrapper.classList.remove('draw-active');
    textEditor.style.pointerEvents = 'auto';
    btnText.classList.add('active');
    btnDraw.classList.remove('active');
    penBallEl.classList.remove('visible');
    closePenPanel();
    statusModeEl.textContent = '文本模式';
    textEditor.focus();
  } else {
    fc.isDrawingMode = true;
    fc.selection = false;
    fc.discardActiveObject();
    canvasWrapper.classList.add('draw-active');
    textEditor.style.pointerEvents = 'none';
    btnDraw.classList.add('active');
    btnText.classList.remove('active');
    penBallEl.classList.add('visible');
    applyBrush();
    statusModeEl.textContent = '绘图模式';
  }
  fc.requestRenderAll();
}

btnText.addEventListener('click',()=>setMode('text'));
btnDraw.addEventListener('click',()=>setMode('draw'));

// ── SAVE / PASTE / UNDO / CLEAR ──
document.getElementById('btn-save').addEventListener('click',()=>{ autoSave(); showToast('已保存'); });

document.getElementById('btn-paste').addEventListener('click', ()=>{
  if(noteReadOnly){ showToast('已删除的笔记为只读，恢复后才能编辑'); return; }
  textEditor.focus();
  const sel = window.getSelection();
  if(!sel || sel.rangeCount === 0){
    const range = document.createRange();
    range.selectNodeContents(textEditor);
    range.collapse(false);
    if(sel){ sel.removeAllRanges(); sel.addRange(range); }
  }
  document.execCommand('paste');
});

// 撤销按钮：只撤销画笔内容，不撤销文本（快速移除最后一笔）
document.getElementById('btn-undo').addEventListener('click',()=>{
  if(noteReadOnly){ showToast('已删除的笔记为只读，恢复后才能编辑'); return; }
  const objs = fc.getObjects();
  if(objs.length === 0){
    showToast('没有可撤销的画笔内容');
    return;
  }
  fc.remove(objs[objs.length - 1]); // 移除最后一笔，文本不受影响
  fc.renderAll();
  autoSave();
  showToast('已撤销画笔');
});

document.getElementById('btn-clear').addEventListener('click',()=>{
  if(noteReadOnly){ showToast('已删除的笔记为只读，恢复后才能编辑'); return; }
  confirmOverlay.classList.add('show');
});
document.getElementById('btn-cancel').addEventListener('click',()=> confirmOverlay.classList.remove('show'));
document.getElementById('btn-confirm').addEventListener('click',()=>{
  textEditor.innerHTML = '';
  fc.clear();
  S.penHistory = [];
  fc.renderAll();
  localStorage.removeItem(STORAGE_KEY);
  confirmOverlay.classList.remove('show');
  updateWordCount();
  showToast('已清空');
});
confirmOverlay.addEventListener('click',e=>{ if(e.target===confirmOverlay) confirmOverlay.classList.remove('show'); });

// ── READING MODE ──
document.getElementById('btn-reading-mode').addEventListener('click',()=>{
  document.body.classList.add('reading');
  fc.isDrawingMode = false; // 阅读模式下禁止绘制
  canvasWrapper.classList.remove('draw-active'); // 关闭画布触控，单指即可滚动页面
});
document.getElementById('exit-reading').addEventListener('click',()=>{
  document.body.classList.remove('reading');
  if(S.mode === 'draw'){
    fc.isDrawingMode = true; // 退出阅读且是绘图模式时恢复绘制
    canvasWrapper.classList.add('draw-active');
  }
});

// ── EXPORT (DOCX / PDF) ──
const exportModal = document.getElementById('export-modal');
const exportFilenameInput = document.getElementById('export-filename');

document.getElementById('btn-export').addEventListener('click', ()=>{
  exportFilenameInput.value = 'MarkIt文档';
  exportModal.classList.add('show');
  exportFilenameInput.focus();
  exportFilenameInput.select();
});
document.getElementById('export-btn-cancel').addEventListener('click', ()=> exportModal.classList.remove('show'));
exportModal.addEventListener('click', e=>{ if(e.target===exportModal) exportModal.classList.remove('show'); });
document.getElementById('export-btn-confirm').addEventListener('click', async ()=>{
  const format = document.querySelector('input[name="export-format"]:checked').value;
  let name = exportFilenameInput.value.trim() || 'MarkIt文档';
  name = name.replace(/[\\/:*?"<>|]/g,'_');
  exportModal.classList.remove('show');
  showToast('正在导出…');
  try{
    if(format==='docx') await exportDocx(name);
    else await exportPdf(name);
    showToast('导出成功');
  }catch(err){
    showToast('导出失败');
  }
});

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 将页面(文本+笔迹)渲染为高分辨率 canvas
function capturePageCanvas(){
  return html2canvas(pageContainer, {backgroundColor:'#ffffff', scale:2, useCORS:true, logging:false});
}

async function exportDocx(name){
  const {Document, Packer, Paragraph, TextRun} = docx;
  const text = textEditor.innerText || '';
  const lines = text.split('\n');
  const doc = new Document({
    sections:[{
      properties:{},
      children: lines.map(line => new Paragraph({
        spacing:{line:360},
        children:[new TextRun({
          text: line.length ? line : ' ',
          size: S.fontSize * 2, // docx 字号单位为半磅
          font:{ascii:'Times New Roman', hAnsi:'Times New Roman', eastAsia:'宋体'},
        })],
      })),
    }],
  });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, name + '.docx');
}

async function exportPdf(name){
  const canvas = await capturePageCanvas();
  const {jsPDF} = window.jspdf;
  const pdf = new jsPDF('p','mm','a4');
  const pageW = 210, pageH = 297;
  const pxPerMm = canvas.width / pageW;
  const pagePxH = pageH * pxPerMm;
  let rendered = 0, page = 0;
  while(rendered < canvas.height){
    const sliceH = Math.min(pagePxH, canvas.height - rendered);
    const part = document.createElement('canvas');
    part.width = canvas.width; part.height = sliceH;
    const ctx = part.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,part.width,part.height);
    ctx.drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if(page > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg',0.95), 'JPEG', 0, 0, pageW, sliceH/pxPerMm);
    rendered += sliceH; page++;
  }
  pdf.save(name + '.pdf');
}

// ── BRUSH ──
function applyBrush(){
  if(S.tool==='eraser'){
    const b = new fabric.PencilBrush(fc);
    b.color='rgba(0,0,0,0.01)'; b.width=S.size*3;
    b.strokeLineCap='round'; b.strokeLineJoin='round';
    fc.freeDrawingBrush=b; return;
  }
  const b = new fabric.PencilBrush(fc);
  if(S.tool==='marker'){
    const hex=S.color.replace('#','');
    const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),bl=parseInt(hex.slice(4,6),16);
    b.color=`rgba(${r},${g},${bl},0.38)`; b.width=S.size*4; b.strokeLineCap='square';
  } else {
    b.color=S.color; b.width=S.size; b.strokeLineCap='round'; b.strokeLineJoin='round';
  }
  fc.freeDrawingBrush=b;
}

fc.on('path:created', function(e){
  if(S.tool==='eraser'){
    const ep=e.path, eb=ep.getBoundingRect();
    const toRemove=fc.getObjects().filter(obj=>{
      if(obj===ep)return false;
      const b=obj.getBoundingRect();
      return !(b.left>eb.left+eb.width||b.left+b.width<eb.left||b.top>eb.top+eb.height||b.top+b.height<eb.top);
    });
    toRemove.forEach(obj=>fc.remove(obj));
    fc.remove(ep); fc.requestRenderAll();
    autoSave(); return;
  }
  if(S.tool==='marker'){ fc.requestRenderAll(); autoSave(); return; }
  // 画布尺寸只随文本高度变化（由 ResizeObserver 负责），无需每画一笔都同步
  autoSave();
});

// ── PEN PANEL ──
let isDragging=false,lpTimer=null,dragSY=0,ballSY=0,pmRaf=null;
penTrigger.addEventListener('pointerdown',e=>{
  dragSY=e.clientY;
  ballSY=penBallEl.getBoundingClientRect().top+penBallEl.offsetHeight/2;
  lpTimer=setTimeout(()=>{ isDragging=true; closePenPanel(); penBallEl.style.transition='none'; },220);
});
document.addEventListener('pointermove',e=>{
  if(!isDragging)return;
  if(pmRaf) return;
  pmRaf = requestAnimationFrame(()=>{
    pmRaf = null;
    let t=ballSY+(e.clientY-dragSY);
    t=Math.max(50,Math.min(window.innerHeight-50,t));
    penBallEl.style.top=t+'px'; penBallEl.style.transform='none';
  });
});
document.addEventListener('pointerup',()=>{
  if(lpTimer)clearTimeout(lpTimer);
  if(!isDragging)return;
  isDragging=false; penBallEl.style.transition='';
  const cx=penBallEl.getBoundingClientRect().left+penBallEl.offsetWidth/2;
  if(cx<window.innerWidth/2){ penBallEl.style.left='14px'; penBallEl.style.right='auto'; }
  else{ penBallEl.style.right='14px'; penBallEl.style.left='auto'; }
});
penTrigger.addEventListener('click',()=>{ if(!isDragging) penPanel.classList.toggle('open'); });
function closePenPanel(){ penPanel.classList.remove('open'); }

// ── SIZE SLIDER ──
function updateSliderBg(){ sizeSlider.style.setProperty('--pct',((sizeSlider.value-1)/49*100).toFixed(1)+'%'); }
sizeSlider.addEventListener('input',e=>{ S.size=parseInt(e.target.value,10); updateSliderBg(); applyBrush(); });
updateSliderBg();

// ── PEN TOOL BUTTONS ──
document.querySelectorAll('.pen-icon-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.pen-icon-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    S.tool=btn.dataset.tool;
    if(S.tool==='pen') S.color=S.customPenColors[0];
    else if(S.tool==='marker') S.color=S.customMarkerColors[0];
    renderPalette(); applyBrush();
  });
});

// ── COLOR PALETTE ──
let pendingColorTool=null;
function openColorPicker(tool){
  pendingColorTool=tool;
  colorInput.value=S.color;
  colorPreview.style.backgroundColor=S.color;
  colorPickerModal.classList.add('show');
  colorInput.focus();
}
function closeColorPicker(){ colorPickerModal.classList.remove('show'); pendingColorTool=null; }
function isValidHex(c){ return /^#[0-9A-F]{6}$/i.test(c); }
colorInput.addEventListener('input',()=>{
  let v=colorInput.value; if(!v.startsWith('#'))v='#'+v;
  if(isValidHex(v)) colorPreview.style.backgroundColor=v;
});
document.getElementById('color-btn-cancel').addEventListener('click',closeColorPicker);
document.getElementById('color-btn-confirm').addEventListener('click',()=>{
  let v=colorInput.value; if(!v.startsWith('#'))v='#'+v;
  if(!isValidHex(v)){ showToast('请输入有效的十六进制颜色'); return; }
  S.color=v.toUpperCase();
  const arr=pendingColorTool==='marker'?S.customMarkerColors:S.customPenColors;
  if(!arr.includes(S.color)) arr.push(S.color);
  renderPalette(); applyBrush(); closeColorPicker(); showToast('颜色已添加');
});
colorPickerModal.addEventListener('click',e=>{ if(e.target===colorPickerModal) closeColorPicker(); });

function renderPalette(){
  row1.innerHTML=''; row2.innerHTML='';
  const colors=S.tool==='marker'?S.customMarkerColors:S.customPenColors;
  colors.forEach((c,i)=>{
    const btn=document.createElement('div');
    btn.className='color-btn'+(c===S.color?' active':'');
    btn.style.backgroundColor=c;
    btn.addEventListener('click',()=>{ S.color=c; renderPalette(); applyBrush(); });
    (i<Math.ceil(colors.length/2)?row1:row2).appendChild(btn);
  });
  const addBtn=document.createElement('div');
  addBtn.className='color-btn color-add';
  addBtn.innerHTML='<svg width="14" height="14"><use href="#icon-plus"/></svg>';
  addBtn.addEventListener('click',()=>openColorPicker(S.tool));
  (colors.length%2===0?row2:row1).appendChild(addBtn);
  colorSection.style.display=S.tool==='eraser'?'none':'flex';
}

// ── TOAST ──
let toastTimer;
function showToast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),1800);
}

// ── TOUCH HANDLING (双指滚动 & 阅读模式单指滚动不绘制) ──
let pinchY = null;

fc.upperCanvasEl.addEventListener('touchstart', function(e) {
  if (e.touches.length >= 2) {
    // 双指落下：中止进行中的笔画并彻底丢弃，切换到滚动
    if (fc._isCurrentlyDrawing) {
      fc._isCurrentlyDrawing = false;
      const brush = fc.freeDrawingBrush;
      if (brush) { brush._points = []; brush.oldEnd = undefined; }
      fc.clearContext(fc.contextTop);
    }
    fc.isDrawingMode = false;
    pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    e.preventDefault(); // 阻止浏览器默认手势
  } else {
    pinchY = null;
    if (S.mode === 'draw' && !document.body.classList.contains('reading')) {
      fc.isDrawingMode = true;
      e.preventDefault(); // 阻止浏览器把单指触摸当页面滚动，保证画线不中断
    }
  }
}, {passive: false});

fc.upperCanvasEl.addEventListener('touchmove', function(e) {
  if (e.touches.length >= 2 && pinchY !== null) {
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    docArea.scrollTop += pinchY - cy;
    pinchY = cy;
    e.preventDefault();
  } else if (e.touches.length === 1 && S.mode === 'draw' && !document.body.classList.contains('reading')) {
    e.preventDefault(); // 单指绘图时禁止页面滚动，避免笔画被浏览器手势打断
  }
}, {passive: false});

fc.upperCanvasEl.addEventListener('touchend', function(e) {
  if (e.touches.length < 2) pinchY = null;
  if (S.mode === 'draw' && !document.body.classList.contains('reading')) {
    fc.isDrawingMode = e.touches.length < 2;
  }
}, {passive: true});

// ── INIT ──
renderPalette();
syncCanvasSize();
setMode('text');
buildRuler();
updateWordCount();

/* ══════════ HOME VIEW (首页逻辑) ══════════ */
(function(){
const NOTE_ICON = 'https://i.hd-r.cn/f9da61c9-44a9-417e-9f9d-2b8c8617544a.png';
const HOME_STORAGE_KEY = 'markit_home_v1';

let state = {
  folders: [
    {id:'unarchived',name:'未归档',fixed:true},
    {id:'trash',name:'最近删除',fixed:true},
  ],
  notes: [],
  activeFolderId: 'unarchived',
  sortOrder: 'newest',
};

// ── PERSISTENCE ──
function save(){
  try{ localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(state)); }catch(e){}
}
function load(){
  try{
    const raw = localStorage.getItem(HOME_STORAGE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      state.folders = s.folders || state.folders;
      state.notes = s.notes || [];
      state.sortOrder = s.sortOrder || 'newest';
    }
  }catch(e){}
}

// ── AUTO-DELETE TRASH (3 days) ──
function purgeOldTrash(){
  const now = Date.now();
  const THREE_DAYS = 3*24*60*60*1000;
  state.notes = state.notes.filter(n => {
    if(n.folderId !== 'trash') return true;
    return (now - n.deletedAt) < THREE_DAYS;
  });
  save();
}

// ── UNIQUE NAME ──
function uniqueNoteName(base, excludeId){
  const names = state.notes.filter(n=>n.id!==excludeId).map(n=>n.name);
  if(!names.includes(base)) return base;
  let i=1;
  while(names.includes(base+' '+i)) i++;
  return base+' '+i;
}
function nextDefaultName(){
  let i=1;
  const names = state.notes.map(n=>n.name);
  while(names.includes('未命名笔记'+i)) i++;
  return '未命名笔记'+i;
}

// ── FORMAT DATE ──
function fmtDate(ts){
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if(diff < 60000) return '刚刚';
  if(diff < 3600000) return Math.floor(diff/60000)+'分钟前';
  if(diff < 86400000) return '今天 '+d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  if(diff < 172800000) return '昨天';
  return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}

// ── RENDER SIDEBAR ──
function renderSidebar(){
  const list = document.getElementById('folder-list');
  list.innerHTML = '';
  state.folders.forEach(f=>{
    const count = state.notes.filter(n=>n.folderId===f.id).length;
    const div = document.createElement('div');
    div.className = 'folder-item' + (f.id===state.activeFolderId?' active':'');
    div.dataset.id = f.id;
    const dot = document.createElement('div');
    dot.className = 'folder-dot'+(f.fixed&&f.id==='trash'?' gray':'');
    const span = document.createElement('span');
    span.style.flex='1'; span.style.overflow='hidden'; span.style.textOverflow='ellipsis'; span.style.whiteSpace='nowrap';
    span.textContent = f.name;
    const badge = document.createElement('span');
    badge.className='folder-count'; badge.textContent=count;
    div.appendChild(dot); div.appendChild(span); div.appendChild(badge);
    if(!f.fixed){
      const more = document.createElement('button');
      more.className='folder-ctx-btn'; more.innerHTML='⋯'; more.title='选项';
      more.addEventListener('click',e=>{e.stopPropagation(); openFolderCtx(e,f.id);});
      div.appendChild(more);
    }
    div.addEventListener('click',()=>{ state.activeFolderId=f.id; exitSelectMode(); renderAll(); });
    list.appendChild(div);
  });
}

// ── GET VISIBLE NOTES ──
function getVisibleNotes(search=''){
  let notes = state.notes.filter(n=>n.folderId===state.activeFolderId);
  if(search.trim()) notes = notes.filter(n=>n.name.toLowerCase().includes(search.toLowerCase()));
  if(state.sortOrder==='newest') notes.sort((a,b)=>b.createdAt-a.createdAt);
  else notes.sort((a,b)=>a.createdAt-b.createdAt);
  return notes;
}

// ── RENDER GRID ──
let selectMode = false;
let selectedIds = new Set();

function renderGrid(search=''){
  const grid = document.getElementById('notes-grid');
  grid.innerHTML='';
  const notes = getVisibleNotes(search);
  if(notes.length===0){
    const el=document.createElement('div');
    el.className='empty-state';
    el.innerHTML='<div class="empty-icon">📄</div><div>暂无笔记<br><span style="font-size:12px">点击右上角 + 新建</span></div>';
    grid.appendChild(el);
    return;
  }
  if(selectMode) grid.classList.add('select-mode');
  else grid.classList.remove('select-mode');
  notes.forEach(n=>grid.appendChild(makeCard(n)));
}

function makeCard(note){
  const div = document.createElement('div');
  div.className = 'note-card' + (selectedIds.has(note.id)?' selected':'');
  div.dataset.id = note.id;

  const sel = document.createElement('div');
  sel.className='note-select-circle';
  div.appendChild(sel);

  const thumb = document.createElement('div');
  thumb.className='note-thumb';
  const img = document.createElement('img');
  img.src = NOTE_ICON; img.alt=''; img.loading='lazy';
  img.onerror = ()=>{ img.style.display='none'; };
  thumb.appendChild(img);

  const info = document.createElement('div');
  info.className='note-info';
  const name = document.createElement('div'); name.className='note-name'; name.textContent=note.name;
  const date = document.createElement('div'); date.className='note-date'; date.textContent=fmtDate(note.createdAt);
  info.appendChild(name); info.appendChild(date);

  div.appendChild(thumb); div.appendChild(info);

  // long press
  let lp;
  div.addEventListener('pointerdown',e=>{
    lp=setTimeout(()=>{ openNoteCtx(e,note.id); },600);
  });
  div.addEventListener('pointerup',()=>clearTimeout(lp));
  div.addEventListener('pointermove',()=>clearTimeout(lp));

  div.addEventListener('click',()=>{
    if(selectMode){ toggleSelect(note.id); return; }
    openNote(note.id);
  });

  return div;
}

function toggleSelect(id){
  if(selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectBanner();
  renderGrid(document.getElementById('search-input').value);
}

function updateSelectBanner(){
  const banner = document.getElementById('select-banner');
  const info = document.getElementById('select-info');
  if(selectMode){ banner.classList.add('show'); info.textContent='已选 '+selectedIds.size+' 项'; }
  else{ banner.classList.remove('show'); }
}

function exitSelectMode(){
  selectMode=false; selectedIds.clear();
  document.getElementById('btn-select').classList.remove('active');
  updateSelectBanner();
}

// ── OPEN NOTE ──
// 点击笔记卡片 → 切换到笔记内页（同页面内视图切换），内容读写走 markit_home_v1
function openNote(id){
  const note = state.notes.find(n=>n.id===id);
  if(!note){ homeToast('笔记不存在'); return; }
  localStorage.setItem('markit_open_note_id', id);
  openNoteView(id);
}

// ── NEW NOTE ──
function openNewNoteModal(){
  const defaultName = nextDefaultName();
  const input = document.getElementById('new-note-input');
  input.value = defaultName;
  document.getElementById('new-note-modal').classList.add('show');
  setTimeout(()=>{ input.select(); input.focus(); },60);
}
document.getElementById('btn-new').addEventListener('click', openNewNoteModal);
document.getElementById('new-note-cancel').addEventListener('click',()=>{
  document.getElementById('new-note-modal').classList.remove('show');
});
document.getElementById('new-note-ok').addEventListener('click',()=>createNote());
document.getElementById('new-note-input').addEventListener('keydown',e=>{ if(e.key==='Enter') createNote(); });
document.getElementById('new-note-modal').addEventListener('click',e=>{
  if(e.target===document.getElementById('new-note-modal')) document.getElementById('new-note-modal').classList.remove('show');
});

function createNote(){
  const raw = document.getElementById('new-note-input').value.trim();
  if(!raw){ homeToast('请输入笔记名称'); return; }
  const name = uniqueNoteName(raw);
  const note = {
    id: 'n_'+Date.now()+'_'+Math.random().toString(36).slice(2),
    name, folderId: state.activeFolderId==='trash'?'unarchived':state.activeFolderId,
    createdAt: Date.now(), content:'',
  };
  state.notes.unshift(note);
  save();
  document.getElementById('new-note-modal').classList.remove('show');
  if(note.folderId !== state.activeFolderId){
    state.activeFolderId = note.folderId;
  }
  renderAll();
  // 确认后直接进入笔记内页
  setTimeout(()=> openNote(note.id), 80);
}

// ── SEARCH ──
document.getElementById('btn-search').addEventListener('click',()=>{
  const bar = document.getElementById('search-bar');
  const isOpen = bar.classList.toggle('open');
  document.getElementById('btn-search').classList.toggle('active', isOpen);
  if(isOpen){ document.getElementById('search-input').focus(); }
  else{ document.getElementById('search-input').value=''; document.getElementById('search-results-label').style.display='none'; renderGrid(); }
});
document.getElementById('search-input').addEventListener('input',e=>{
  const q=e.target.value.trim();
  const label=document.getElementById('search-results-label');
  if(q){ const r=getVisibleNotes(q); label.textContent='找到 '+r.length+' 条结果'; label.style.display='block'; }
  else{ label.style.display='none'; }
  renderGrid(e.target.value);
});
document.getElementById('search-clear').addEventListener('click',()=>{
  document.getElementById('search-input').value='';
  document.getElementById('search-results-label').style.display='none';
  renderGrid();
  document.getElementById('search-input').focus();
});

// ── SORT ──
const sortDropdown = document.getElementById('sort-dropdown');
document.getElementById('btn-sort').addEventListener('click',e=>{
  e.stopPropagation();
  const r=e.currentTarget.getBoundingClientRect();
  sortDropdown.style.top=(r.bottom+4)+'px'; sortDropdown.style.left=r.left+'px';
  sortDropdown.classList.toggle('open');
});
sortDropdown.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    state.sortOrder=btn.dataset.sort; save();
    sortDropdown.querySelectorAll('button').forEach(b=>b.classList.remove('active-sort'));
    btn.classList.add('active-sort');
    sortDropdown.classList.remove('open');
    renderGrid(document.getElementById('search-input').value);
    homeToast(btn.textContent);
  });
});

// ── SELECT MODE ──
document.getElementById('btn-select').addEventListener('click',()=>{
  selectMode=!selectMode;
  document.getElementById('btn-select').classList.toggle('active', selectMode);
  if(!selectMode){ selectedIds.clear(); }
  updateSelectBanner();
  renderGrid(document.getElementById('search-input').value);
});
document.getElementById('btn-select-all').addEventListener('click',()=>{
  const notes=getVisibleNotes(document.getElementById('search-input').value);
  if(selectedIds.size===notes.length){ selectedIds.clear(); }
  else{ notes.forEach(n=>selectedIds.add(n.id)); }
  updateSelectBanner();
  renderGrid(document.getElementById('search-input').value);
});
document.getElementById('btn-delete-selected').addEventListener('click',()=>{
  if(selectedIds.size===0){ homeToast('请先选择笔记'); return; }
  openDeleteModal([...selectedIds],()=>{
    [...selectedIds].forEach(id=>moveToTrash(id));
    selectedIds.clear(); updateSelectBanner();
    renderAll(); homeToast('已移入最近删除');
  });
});
document.getElementById('btn-cancel-select').addEventListener('click',()=>{ exitSelectMode(); renderGrid(); });

// ── FOLDER CTX MENU ──
let ctxFolderId=null;
const folderCtxMenu = document.getElementById('folder-ctx-menu');
function openFolderCtx(e,id){
  ctxFolderId=id;
  folderCtxMenu.style.top=e.clientY+'px'; folderCtxMenu.style.left=e.clientX+'px';
  folderCtxMenu.classList.add('open');
}
document.getElementById('fctx-rename').addEventListener('click',()=>{
  folderCtxMenu.classList.remove('open');
  const folder=state.folders.find(f=>f.id===ctxFolderId);
  if(!folder) return;
  openRenameModal(null, val=>{
    folder.name=val; save(); renderAll(); homeToast('已重命名');
  }, folder.name, '重命名文件夹');
});
document.getElementById('fctx-delete').addEventListener('click',()=>{
  folderCtxMenu.classList.remove('open');
  const folder=state.folders.find(f=>f.id===ctxFolderId);
  if(!folder) return;
  openDeleteModal(null,()=>{
    state.notes.forEach(n=>{ if(n.folderId===ctxFolderId) n.folderId='unarchived'; });
    state.folders=state.folders.filter(f=>f.id!==ctxFolderId);
    if(state.activeFolderId===ctxFolderId) state.activeFolderId='unarchived';
    save(); renderAll(); homeToast('已删除文件夹，笔记移入未归档');
  }, '删除文件夹', '文件夹内的笔记将移入【未归档】，此操作不可撤销。');
});

// ── ADD FOLDER ──
document.getElementById('btn-add-folder').addEventListener('click',()=>{
  document.getElementById('add-folder-input').value='';
  document.getElementById('add-folder-modal').classList.add('show');
  setTimeout(()=>document.getElementById('add-folder-input').focus(),60);
});
document.getElementById('add-folder-cancel').addEventListener('click',()=>document.getElementById('add-folder-modal').classList.remove('show'));
document.getElementById('add-folder-modal').addEventListener('click',e=>{
  if(e.target===document.getElementById('add-folder-modal')) document.getElementById('add-folder-modal').classList.remove('show');
});
document.getElementById('add-folder-ok').addEventListener('click',()=>{
  const name=document.getElementById('add-folder-input').value.trim();
  if(!name){ homeToast('请输入文件夹名称'); return; }
  const id='f_'+Date.now();
  state.folders.splice(state.folders.length-1,0,{id,name,fixed:false});
  save(); document.getElementById('add-folder-modal').classList.remove('show');
  renderAll(); homeToast('文件夹已创建');
});
document.getElementById('add-folder-input').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('add-folder-ok').click();
});

// ── NOTE CTX MENU ──
let ctxNoteId=null;
const noteCtxMenu=document.getElementById('note-ctx-menu');
const moveSubmenu=document.getElementById('move-submenu');

function openNoteCtx(e,id){
  ctxNoteId=id;
  closeMenus();
  const note = state.notes.find(n=>n.id===id);
  const inTrash = note && note.folderId==='trash';
  // 回收站笔记：只显示 恢复 / 彻底删除
  document.getElementById('nctx-restore').style.display = inTrash?'flex':'none';
  document.getElementById('nctx-rename').style.display  = inTrash?'none':'flex';
  document.getElementById('nctx-move').style.display    = inTrash?'none':'flex';
  document.getElementById('nctx-export').style.display  = inTrash?'none':'flex';
  noteCtxMenu.querySelector('.ctx-sep').style.display   = inTrash?'none':'block';
  document.getElementById('nctx-delete').textContent    = inTrash?'彻底删除':'删除';
  noteCtxMenu.style.top=Math.min(e.clientY, window.innerHeight-220)+'px';
  noteCtxMenu.style.left=Math.min(e.clientX, window.innerWidth-180)+'px';
  noteCtxMenu.classList.add('open');
}
document.getElementById('nctx-restore').addEventListener('click',()=>{
  noteCtxMenu.classList.remove('open');
  const n=state.notes.find(n=>n.id===ctxNoteId); if(!n) return;
  const target = (n.prevFolderId && state.folders.some(f=>f.id===n.prevFolderId)) ? n.prevFolderId : 'unarchived';
  n.folderId = target;
  delete n.prevFolderId; delete n.deletedAt;
  save(); renderAll(); homeToast('已恢复到【'+(state.folders.find(f=>f.id===target)||{}).name+'】');
});
document.getElementById('nctx-rename').addEventListener('click',()=>{
  noteCtxMenu.classList.remove('open');
  openRenameModal(ctxNoteId, val=>{
    const n=state.notes.find(n=>n.id===ctxNoteId); if(!n) return;
    n.name=val; save(); renderAll(); homeToast('已重命名');
  });
});
document.getElementById('nctx-move').addEventListener('click',e=>{
  e.stopPropagation();
  const r=noteCtxMenu.getBoundingClientRect();
  moveSubmenu.innerHTML='';
  state.folders.filter(f=>f.id!==state.activeFolderId&&f.id!=='trash').forEach(f=>{
    const btn=document.createElement('button');
    btn.textContent=f.name;
    btn.addEventListener('click',()=>{
      const n=state.notes.find(n=>n.id===ctxNoteId); if(!n) return;
      n.folderId=f.id; save(); closeMenus(); renderAll(); homeToast('已移至 '+f.name);
    });
    moveSubmenu.appendChild(btn);
  });
  if(moveSubmenu.children.length===0){
    const b=document.createElement('div');
    b.style.cssText='padding:10px 14px;font-size:13px;color:#aaa';
    b.textContent='无其他文件夹'; moveSubmenu.appendChild(b);
  }
  moveSubmenu.style.top=e.clientY+'px';
  moveSubmenu.style.left=(r.right+4)+'px';
  moveSubmenu.classList.add('open');
});
document.getElementById('nctx-export').addEventListener('click',()=>{
  noteCtxMenu.classList.remove('open');
  const n=state.notes.find(n=>n.id===ctxNoteId); if(!n) return;
  const blob=new Blob([n.content||''],{type:'text/html'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=n.name+'.html'; document.body.appendChild(a); a.click();
  document.body.removeChild(a); homeToast('已导出 '+n.name);
});
document.getElementById('nctx-delete').addEventListener('click',()=>{
  noteCtxMenu.classList.remove('open');
  const n=state.notes.find(n=>n.id===ctxNoteId);
  if(n && n.folderId==='trash'){
    // 回收站内：彻底删除
    openDeleteModal([ctxNoteId],()=>{
      moveToTrash(ctxNoteId); renderAll(); homeToast('已彻底删除');
    }, '彻底删除笔记', '删除后将无法恢复，确认彻底删除？');
  } else {
    openDeleteModal([ctxNoteId],()=>{
      moveToTrash(ctxNoteId); renderAll(); homeToast('已移入最近删除');
    });
  }
});

function moveToTrash(id){
  const n=state.notes.find(n=>n.id===id); if(!n) return;
  if(n.folderId==='trash'){ state.notes=state.notes.filter(n=>n.id!==id); }
  else{ n.prevFolderId=n.folderId; n.folderId='trash'; n.deletedAt=Date.now(); }
  save();
}

// ── RENAME MODAL ──
let renameCallback=null;
function openRenameModal(noteId, cb, initialVal, title){
  renameCallback=cb;
  const input=document.getElementById('rename-input');
  const t=document.getElementById('rename-modal-title');
  t.textContent=title||'重命名笔记';
  if(noteId){
    const n=state.notes.find(n=>n.id===noteId);
    input.value=n?n.name:'';
  } else { input.value=initialVal||''; }
  document.getElementById('rename-modal').classList.add('show');
  setTimeout(()=>{ input.select(); input.focus(); },60);
}
document.getElementById('rename-cancel').addEventListener('click',()=>{
  document.getElementById('rename-modal').classList.remove('show'); renameCallback=null;
});
document.getElementById('rename-modal').addEventListener('click',e=>{
  if(e.target===document.getElementById('rename-modal')){ document.getElementById('rename-modal').classList.remove('show'); renameCallback=null; }
});
document.getElementById('rename-ok').addEventListener('click',()=>{
  const val=document.getElementById('rename-input').value.trim();
  if(!val){ homeToast('名称不能为空'); return; }
  document.getElementById('rename-modal').classList.remove('show');
  if(renameCallback) renameCallback(val);
  renameCallback=null;
});
document.getElementById('rename-input').addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('rename-ok').click(); });

// ── DELETE MODAL ──
let deleteCallback=null;
function openDeleteModal(ids, cb, title, sub){
  deleteCallback=cb;
  document.getElementById('delete-modal-title').textContent=title||(ids&&ids.length>1?'删除所选笔记':'删除笔记');
  document.getElementById('delete-modal-sub').textContent=sub||'将移入【最近删除】，3 天后自动清除。';
  document.getElementById('delete-modal').classList.add('show');
}
document.getElementById('delete-cancel').addEventListener('click',()=>{
  document.getElementById('delete-modal').classList.remove('show'); deleteCallback=null;
});
document.getElementById('delete-modal').addEventListener('click',e=>{
  if(e.target===document.getElementById('delete-modal')){ document.getElementById('delete-modal').classList.remove('show'); deleteCallback=null; }
});
document.getElementById('delete-ok').addEventListener('click',()=>{
  document.getElementById('delete-modal').classList.remove('show');
  if(deleteCallback) deleteCallback();
  deleteCallback=null;
});

// ── CLOSE MENUS ──
function closeMenus(){
  noteCtxMenu.classList.remove('open');
  moveSubmenu.classList.remove('open');
  folderCtxMenu.classList.remove('open');
  sortDropdown.classList.remove('open');
}
document.addEventListener('click',()=> closeMenus());
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeMenus(); });
noteCtxMenu.addEventListener('click',e=>e.stopPropagation());
moveSubmenu.addEventListener('click',e=>e.stopPropagation());
folderCtxMenu.addEventListener('click',e=>e.stopPropagation());
sortDropdown.addEventListener('click',e=>e.stopPropagation());

// ── TOAST（复用全局 #toast 元素） ──
let homeToastTimer;
function homeToast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(homeToastTimer);
  homeToastTimer=setTimeout(()=>el.classList.remove('show'),1800);
}

// ── RENDER ALL ──
function renderAll(){
  renderSidebar();
  const folder=state.folders.find(f=>f.id===state.activeFolderId);
  document.getElementById('topbar-title').textContent=folder?folder.name:'';
  renderGrid(document.getElementById('search-input').value);
  updateSelectBanner();
  document.querySelectorAll('#sort-dropdown button').forEach(b=>{
    b.classList.toggle('active-sort', b.dataset.sort===state.sortOrder);
  });
}

// 暴露给内页：返回首页时刷新列表
window.__markitHomeRender = renderAll;

// ── INIT ──
load();
purgeOldTrash();
renderAll();
})();
