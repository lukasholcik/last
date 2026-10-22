const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
let defaults, documents, lastResult, scene, busy = false, revision = 0, request = 0;
const clone = (v) => structuredClone(v);
const fmt = (v) => {
  if (typeof v !== 'number') return String(v ?? '—');
  if (v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 1e6)) {
    return v.toExponential(5).replace(/\.?0+e/, 'e');
  }
  return Number(v.toFixed(4)).toString();
};

function node(tag, text, attrs = {}) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function svgNode(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function state(kind, title, detail) {
  $('state-bar').dataset.state = kind;
  $('views').dataset.state = kind;
  $('state-title').textContent = title;
  $('state-detail').textContent = detail;
  const message = kind === 'valid' ? 'Current rebuilt geometry' : lastResult ? 'LAST VALID GEOMETRY · not the current inputs' : 'No rebuilt geometry yet';
  document.querySelectorAll('[data-view-state]').forEach((el) => el.textContent = message);
  $('report-state').textContent = kind === 'valid' ? 'Current curve-based checks. Tolerances are software checks, not fit allowances.' : lastResult ? 'Previous rebuild report only. Current inputs have not passed.' : 'No current report.';
}
function setBusy(value) {
  busy = value;
  $('design-form').setAttribute('aria-busy', String(value));
  $('rebuild').disabled = value || !documents;
  $('reset').disabled = value || !defaults;
  $('rebuild').firstChild.textContent = value ? 'Rebuilding… ' : 'Rebuild guides ';
}
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function dirty() {
  revision++;
  clearError();
  state('dirty', 'Unapplied changes', 'Rebuild explicitly to calculate and check these numbers. Views retain the last valid result.');
}
function numberInput(group, field, label, unit = 'mm') {
  const wrap = node('div', undefined, {class: 'input-wrap'});
  const input = node('input', undefined, {type: 'number', step: 'any', required: '', id: `${group}-${field}`, name: group === 'shared' ? field : `${group}.${field}`, 'aria-label': label, title: group === 'shared' ? `design.${field}` : `design.${group}.${field}`, inputmode: 'decimal'});
  input.value = group === 'shared' ? documents.design[field] : documents.design[group][field];
  input.dataset.group = group; input.dataset.field = field;
  wrap.append(input, node('span', unit, {class: 'unit', 'aria-hidden': 'true'}));
  return wrap;
}
function field(group, key, label, unit) {
  const row = node('div', undefined, {class: 'field'});
  row.append(node('label', label, {for: `${group}-${key}`}), numberInput(group, key, label, unit));
  return row;
}
function makeForm() {
  const fields = $('fields'); fields.replaceChildren();
  const shared = node('section', undefined, {class:'input-section'});
  shared.append(node('h3', 'Length along the bottom'), field('shared', 'last_length', 'Last length along bottom profile'), node('p', 'Entered contour length, not horizontal span. Positions are distances along the bottom guide; horizontal positions are calculated.', {class:'field-note'}));
  const top = node('section', undefined, {class:'input-section'});
  top.append(node('h3', 'Outer top silhouette'));
  for (const region of ['heel', 'waist', 'ball', 'toe']) {
    const part = node('div', undefined, {class:'region'}), head = node('div', undefined, {class:'region-head'});
    head.append(node('strong', region[0].toUpperCase()+region.slice(1)), node('span', 'Along contour · mm'), node('span', 'Side extent · mm'));
    part.append(head);
    for (const side of ['medial', 'lateral']) {
      const row = node('div', undefined, {class:'region-row'});
      row.append(node('span', side[0].toUpperCase()+side.slice(1)), numberInput('top', `${side}_${region}_s`, `${side} ${region} contour station`), numberInput('top', `${side}_${region}_width`, `${side} ${region} side extent`));
      part.append(row);
    }
    top.append(part);
  }
  top.append(node('p', 'Each side extent is measured from x = 0 at its own contour station s. The two sides are independent—not a summed section width.', {class:'field-note'}));
  const bottom = node('section', undefined, {class:'input-section'});
  bottom.append(node('h3', 'Longitudinal bottom guide'));
  for (const [key, label, unit] of [['heel_height','Rear heel height','mm'],['toe_spring','Toe spring height','mm'],['seat_arc_length','Seat contour length','mm'],['seat_inclination_deg','Seat inclination','deg'],['contact_s','Contact contour station','mm'],['blend_arc_length','Contact blend contour length','mm']]) bottom.append(field('bottom',key,label,unit));
  bottom.append(node('p', 'Contact is independent of the top ball points. Seat, contact and blend locations retain their contour distances when heel height changes. Seat inclination remains your choice—not an automatic pitch rule.', {class:'field-note'}));
  fields.append(shared,top,bottom);
  $('inputs').disabled = false;
}
function readForm() {
  const result = clone(documents);
  for (const input of $('fields').querySelectorAll('input')) {
    const value = input.valueAsNumber;
    if (!input.value.trim() || !Number.isFinite(value)) { input.focus(); throw new Error(`Enter a finite number for ${input.getAttribute('aria-label')}.`); }
    if (input.dataset.group === 'shared') result.design[input.dataset.field] = value;
    else result.design[input.dataset.group][input.dataset.field] = value;
  }
  return result;
}
async function jsonResponse(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Check that the viewer server is running.'); }
  if (!response.ok) throw new Error(data.error || `Rebuild failed (${response.status}).`);
  return data;
}
function showError(error) {
  state('error', 'Rebuild not applied', 'The current inputs have not passed. Any visible guides and reports are from the last valid rebuild.');
  $('error').textContent = error.message || String(error); $('error').hidden = false; $('error').focus();
}
async function rebuild() {
  if (busy || !documents) return;
  let payload;
  try { payload = readForm(); } catch (error) { showError(error); return; }
  const token = ++request, atRevision = revision;
  clearError(); setBusy(true);
  state('busy', 'Rebuilding both guides', 'Calculating and checking the actual curves in Python…');
  try {
    const data = await jsonResponse(await fetch('/api/rebuild', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}));
    if (token !== request || atRevision !== revision) return;
    if (!data.reports?.top?.passed || !data.reports?.bottom?.passed || !data.reports?.contour?.passed) throw new Error('The server did not return passing top, bottom and contour reports. The result has not been applied.');
    lastResult = data; documents = clone(data.inputs);
    renderDrawing(); renderReports();
    if (scene) { try { scene.update(data.display); } catch (error) { unavailableScene(error); } }
    state('valid', 'Current geometry · checks passed', 'Top, bottom and contour checks passed on the resulting curves. This does not establish shoe fit.');
  } catch (error) { if (token === request && atRevision === revision) showError(error); }
  finally { if (token === request) { setBusy(false); if (atRevision !== revision) state('dirty','Unapplied changes','Inputs changed during the rebuild. Its response was discarded; rebuild again.'); } }
}
async function loadDefaults() {
  if (busy) return;
  const token = ++request; setBusy(true); $('inputs').disabled = true; clearError();
  state('loading','Loading example','Loading the local made-up dimensions, then rebuilding both guides.');
  try {
    const data = await jsonResponse(await fetch('/api/defaults'));
    if (token !== request) return;
    defaults = clone(data); documents = clone(data); revision++; makeForm();
    setBusy(false); await rebuild();
  } catch (error) { if (token === request) { showError(error); setBusy(false); $('inputs').disabled = !documents; } }
}

function renderDrawing() {
  if (!lastResult) return;
  $('selection').textContent = $('construction').checked
    ? 'Select a point to inspect its current model name and coordinates.'
    : 'Show named controls, then select a point to inspect its model name.';
  const top = lastResult.models.top, bottom = lastResult.models.bottom;
  const pts = Object.values(top.points), bpts = Object.values(bottom.points);
  const yMin = Math.min(0,...pts.map(p=>p.y),...bpts.map(p=>p.y)), yMax = Math.max(...pts.map(p=>p.y),...bpts.map(p=>p.y));
  const xMin = Math.min(...pts.map(p=>p.x)), xMax = Math.max(...pts.map(p=>p.x));
  const zMin = Math.min(0,...bpts.map(p=>p.z)), zMax = Math.max(0,...bpts.map(p=>p.z));
  const left = 16-yMin, width=yMax-yMin+32, topBase=23-xMin, bottomBase=topBase+xMax+40+zMax;
  const height=bottomBase-zMin+19, svg=$('drawing');
  svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.append(svgNode('title',{},'Aligned outer top silhouette and longitudinal bottom guide. Equal millimetre scales; forward y points right.'));
  const font = 3.2;
  const label = (x,y,text,extra={})=>svg.append(svgNode('text',{x,y,'font-size':font,...extra},text));
  label(16,7,'TOP / OUTER SILHOUETTE'); label(left+yMax,7,'TOE →',{'text-anchor':'end'});
  label(16,topBase+xMax+23,'SIDE / BOTTOM GUIDE');
  const line=(x1,y1,x2,y2,attrs={})=>svg.append(svgNode('line',{x1,y1,x2,y2,stroke:'#ccd4c9','stroke-width':.25,...attrs}));
  for (const y of [0, yMax]) { line(left+y,12,left+y,bottomBase+5,{'stroke-dasharray':'1 2'}); label(left+y,bottomBase+11,`y ${fmt(y)} mm`,{'text-anchor':y===0?'start':'end'}); }
  line(left+yMin,topBase,left+yMax,topBase,{'stroke-dasharray':'1.5 1.5'});
  line(left+yMin,bottomBase,left+yMax,bottomBase,{'stroke-dasharray':'1.5 1.5'});
  label(left+yMax,bottomBase+16,'Ground z = 0',{'text-anchor':'end'});
  function draw(model, names, type, transform) {
    const xy=(n)=>transform(model.points[n]);
    const point=(n)=>xy(n).join(' ');
    const start=model.curves[names[0]].start;
    const d=`M ${point(start)} `+names.map(n=>{const c=model.curves[n];return `C ${point(c.control1)} ${point(c.control2)} ${point(c.end)}`;}).join(' ')+(type==='top'?' Z':'');
    svg.append(svgNode('path',{d,class:`guide-${type}`,'stroke-width':.65,'stroke-linejoin':'round','data-guide':type}));
    if (!$('construction').checked) return;
    for(const [name, r] of Object.entries(model.reference_lines)) { const path=svgNode('path',{d:`M ${point(r.start)} L ${point(r.end)}`,class:'construction'});path.append(svgNode('title',{},name));svg.append(path); }
    for(const [name,c] of Object.entries(model.curves)) { const path=svgNode('path',{d:`M ${point(c.start)} L ${point(c.control1)} L ${point(c.control2)} L ${point(c.end)}`,class:'construction'});path.append(svgNode('title',{},`${name} control polygon`));svg.append(path); }
    for(const [name,p] of Object.entries(model.points)) {
      const station = type === 'top' ? lastResult.derived.station_map[name] : undefined;
      const [x,y]=transform(p), text=`${type}: ${name} · ${type==='top'?`x ${fmt(p.x)}, calculated y ${fmt(p.y)}`:`calculated y ${fmt(p.y)}, z ${fmt(p.z)}`} mm${station ? ` · entered contour s ${fmt(station.s)} mm` : ''} · ${p.kind}`;
      const circle=svgNode('circle',{cx:x,cy:y,r:p.kind==='landmark'?1.1:.7,fill:p.kind==='handle'?'#af7c4b':type==='top'?'#216356':'#b15d35',tabindex:0,role:'button','aria-label':text});
      circle.append(svgNode('title',{},text));
      const select=()=>$('selection').textContent=text;
      circle.addEventListener('click',select);circle.addEventListener('focus',select);circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});svg.append(circle);
    }
  }
  draw(top,top.outline,'top',p=>[left+p.y,topBase+p.x]);
  draw(bottom,bottom.profile,'bottom',p=>[left+p.y,bottomBase-p.z]);
}
function table(headers, rows) {
  const scroll=node('div',undefined,{class:'table-scroll'}), t=node('table',undefined,{class:'checks'}), head=node('thead'), tr=node('tr'), body=node('tbody');
  headers.forEach(h=>tr.append(node('th',h,{scope:'col'})));head.append(tr);
  for(const row of rows){const r=node('tr',undefined,row.failed?{class:'failed'}:{});row.values.forEach(v=>r.append(node('td',fmt(v))));body.append(r);}
  t.append(head,body);scroll.append(t);return scroll;
}
function renderReports() {
  const {top,bottom,contour}=lastResult.reports, checks=[...top.checks,...bottom.checks,...contour.checks], arc=bottom.bottom_arc_length;
  $('check-count').textContent=`${checks.length} checks`;
  const metrics=$('metrics');metrics.replaceChildren();
  const items=[['Last length',`${fmt(lastResult.inputs.design.last_length)} mm`,'Entered along the bottom profile'],['Bottom contour',`${fmt(arc.actual)} mm`,`Measured on curve · uncertainty ±${fmt(arc.uncertainty_mm)} mm`],['Horizontal span',`${fmt(lastResult.derived.projected_length)} mm`,'Calculated projection—not an input'],['Curve checks',`${checks.filter(c=>c.passed).length} / ${checks.length}`,'Top + bottom + contour · not fit allowances']];
  for(const [name,value,detail]of items){const m=node('div',undefined,{class:'metric'});m.append(node('span',name),node('strong',value),node('small',detail));metrics.append(m);}
  const reports=$('reports');reports.replaceChildren();
  for(const [name,report]of [['Top',top],['Bottom',bottom],['Contour',contour]]){reports.append(node('h3',`${name} curve checks`),table(['Named check','Actual','Expected','Tolerance','Units','Result'],report.checks.map(c=>({values:[c.name,c.actual,c.expected,c.tolerance,c.units||'—',c.passed?'Pass':'Fail'],failed:!c.passed}))));}
  reports.append(node('h3','Width stations · entered contour distance to calculated horizontal position'),table(['Named station','Entered s (mm)','Calculated y (mm)'],Object.entries(lastResult.derived.station_map).map(([name,s])=>({values:[name,s.s,s.y]}))));
  if(top.sections?.length) reports.append(node('h3','Derived full sections · not a sum of independent side inputs'),table(['Section','Forward y (mm)','Medial x (mm)','Lateral x (mm)','Full width (mm)'],top.sections.map(s=>({values:[s.name,s.y,s.medial_x,s.lateral_x,s.width]}))));
  reports.append(node('h3','Bottom contour-length bounds'),node('p',`${fmt(arc.lower_bound)}–${fmt(arc.upper_bound)} mm. Measured along the actual curve, independently checked against the entered last length—not its horizontal projection.`));
}
$('fields').addEventListener('input',dirty);
$('design-form').addEventListener('submit',e=>{e.preventDefault();rebuild();});
$('reset').addEventListener('click',()=>{if(!busy&&defaults){documents=clone(defaults);revision++;makeForm();rebuild();}});
$('construction').addEventListener('change',renderDrawing);
$('fit-view').addEventListener('click',()=>scene?.fit());
async function initScene() {
  try {
    const {createScene}=await import('./scene.js');
    scene=createScene($('scene'));
    $('scene-message').hidden=true;$('fit-view').disabled=false;
    if(lastResult)scene.update(lastResult.display);
  } catch(error) { unavailableScene(error); }
}
function unavailableScene(error) {
  scene?.dispose(); scene=null;
  $('fit-view').disabled=true;
  $('scene-message').hidden=false;$('scene-message').textContent='3D is unavailable here. The aligned 2D views, numeric editing and rebuild checks still work.';
  console.warn('Local 3D viewer unavailable:',error);
}
window.addEventListener('pagehide',()=>scene?.dispose(),{once:true});
loadDefaults();initScene();
