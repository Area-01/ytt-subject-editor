import { importSrt, importAss } from '/src/subtitle-import.js';
import { exportYtt } from '/src/ytt-export.js';
import { parseYtt, setAttributes, getTextRuns, replaceTextRuns } from '/src/ytt-document.js';
import {applyEdits} from '/src/ytt-preserve.js';
import { compileAnimatedYtt, animatedStateAt } from '/src/animated-ytt.js';
import {evaluateKeyframes} from '/src/effects.js';
import { encodeProject, decodeProject } from '/src/project.js';
import { setUnitEffect, parseUnitTargets, splitEffectUnits } from '/src/unit-effects.js';
import {planTextSelection,applySelectionFrames} from '/src/text-selection.js';
import {makePreset,applyPreset,parsePresetLibrary,stringifyPresetLibrary} from '/src/presets.js';
import {createPathEditor} from '/path-editor.js';
import {createBezierEditor} from '/bezier-editor.js';
import {calculateCueDrag,indexCues,queryCues,packCueLanes,snapCue} from '/src/timeline.js';
import {layoutUnits} from '/src/unit-layout.js';
import {EditHistory} from '/src/history.js';
import {convertAssStyle} from '/src/ass-style.js';
import {mergeNewCues,orderYttCues} from '/src/ytt-merge.js';
import {readCueStyle,setCueStyle} from '/src/ytt-style-edit.js';
import {originalPreview,canAnimateOriginal} from '/src/ytt-preview.js';
import {mountComparison} from '/compare.js';
import {applyLocale} from '/i18n.js';
import {createEffectControls} from '/effect-controls.js';

const $ = id => document.getElementById(id);
applyLocale(document);
mountComparison(document.querySelector('aside'));
const video = $('video');
const snapControl=document.createElement('label'); snapControl.innerHTML='스냅 <select id="snapMode"><option value="cues">자막 경계</option><option value="frames">프레임</option><option value="both">경계 + 프레임</option><option value="none">끄기</option></select>'; $('timelineInfo').before(snapControl);
const textRunPanel=document.createElement('div'); textRunPanel.id='textRunPanel'; $('cueText').parentElement.after(textRunPanel);
const duplicateCue=document.createElement('button'), deleteCue=document.createElement('button');
duplicateCue.type=deleteCue.type='button'; duplicateCue.textContent='자막 복제'; deleteCue.textContent='선택 자막 삭제'; deleteCue.title='선택 자막 삭제 (Delete)'; $('apply').after(duplicateCue); $('addCue').after(deleteCue);deleteCue.disabled=true;
const copyCueButton=document.createElement('button'),pasteCueButton=document.createElement('button');
copyCueButton.type=pasteCueButton.type='button';copyCueButton.textContent='복사';pasteCueButton.textContent='붙여넣기';copyCueButton.title='선택 자막 복사 (Ctrl+C)';pasteCueButton.title='현재 위치에 자막 붙여넣기 (Ctrl+V)';copyCueButton.disabled=true;pasteCueButton.disabled=true;deleteCue.before(copyCueButton,pasteCueButton);
let tracks = [{name:'트랙 1', cues:[]}], selected = null, originalYtt = null, mediaUrl = null;
let cueClipboard=null, originalSessionId=0, nextOriginalSessionId=0;
let nextId = 0, videoName = null, recoveryReady = false, recoveryDirty = false, saveTimer = null, saveChain = Promise.resolve();
let editRevision=0, savedRevision=0, recoveryFailed=false;
const recoveryStatus=document.createElement('span'); recoveryStatus.className='recovery-status'; recoveryStatus.setAttribute('role','status'); recoveryStatus.textContent='자동 저장 준비 중'; $('notice').before(recoveryStatus);
let activeTrack=0, dragging=null;
let timelineIndexes=[], timelineLanes=[], lastTimelineScroll=0, scrollFrame=0, playbackGeneration=0;
let waveformGeneration=0, waveformPeaks=null;
const waveformSurface=document.createElement('canvas');
let effectControls=null, positionDrag=null;
let textSelection=null;
const positionHandle=document.createElement('div'); positionHandle.className='preview-position-handle'; positionHandle.hidden=true; positionHandle.title='선택한 자막을 끌어 위치 이동'; $('stage').append(positionHandle);
const editHistory=new EditHistory(50);
const undoButton=document.createElement('button'), redoButton=document.createElement('button');
undoButton.textContent='실행 취소'; undoButton.title='Ctrl+Z'; redoButton.textContent='다시 실행'; redoButton.title='Ctrl+Shift+Z';
$('export').before(undoButton,redoButton);
function historySnapshot() { return {tracks,originalYtt,originalSessionId,selectedId:selected?.id ?? null,activeTrack}; }
function refreshHistoryButtons() { undoButton.disabled=!editHistory.canUndo; redoButton.disabled=!editHistory.canRedo; }
function recordEdit() { editHistory.record(historySnapshot()); refreshHistoryButtons(); }
function restoreHistory(state) {
  closePathEditor(); tracks=state.tracks; originalYtt=state.originalYtt; originalSessionId=state.originalSessionId; activeTrack=Math.min(state.activeTrack,tracks.length-1);
  selected=tracks.flatMap(track=>track.cues).find(cue=>cue.id===state.selectedId) ?? null;
  nextId=tracks.reduce((max,track)=>track.cues.reduce((n,cue)=>Math.max(n,cue.id),max),nextId);
  previewCache.clear(); showProperties(); render(); markDirty(); refreshHistoryButtons();
}
undoButton.onclick=()=>{const state=editHistory.undo(historySnapshot()); if(state){restoreHistory(state);say('실행을 취소했습니다.');}};
redoButton.onclick=()=>{const state=editHistory.redo(historySnapshot()); if(state){restoreHistory(state);say('다시 실행했습니다.');}};
document.addEventListener('keydown',event=>{
  const element=event.target;
  if (event.defaultPrevented || element?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? '')) return;
  if(event.key==='Delete' && !element?.closest?.('.effect-controls') && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && selected){event.preventDefault();deleteCue.click();return;}
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const key=event.key.toLowerCase();
  if (!event.shiftKey && key==='c' && selected && window.getSelection()?.isCollapsed!==false) {event.preventDefault();copySelectedCue();return;}
  if (!event.shiftKey && key==='v' && cueClipboard) {event.preventDefault();pasteCopiedCue();return;}
  if (key==='z' && !event.shiftKey) { event.preventDefault(); undoButton.click(); }
  else if (key==='y' || (key==='z' && event.shiftKey)) { event.preventDefault(); redoButton.click(); }
});
refreshHistoryButtons();
const previewCache = new Map();
const say = text => { $('notice').textContent = text; };
const time = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${(seconds % 60).toFixed(3).padStart(6,'0')}`;
const totalSeconds = () => tracks.reduce((maximum,track) => track.cues.reduce((n,cue) => Math.max(n,cue.end / 1000 + 2),maximum), Math.max(10,Number.isFinite(video.duration) ? video.duration : 0));
const pixelScale = () => Number($('zoom').value);
const allCues = () => tracks.flatMap(track => track.cues);
const isOriginalCue = () => !!originalYtt && selected?.originalIndex != null;
const canAnimateSelected = () => !isOriginalCue() || canAnimateOriginal(originalYtt,selected.originalIndex);
const hasGeneratedEffect = cue => !!(cue.appearance || cue.units || cue.motionPath || Object.keys(cue.keyframes ?? {}).length);
let presets=[], presetsReady=false;
const presetPanel=document.createElement('fieldset');
presetPanel.innerHTML='<legend>사용자 프리셋</legend><label>목록<select id="presetChoice"></select></label><button type="button" id="presetSave">현재 효과 저장</button> <button type="button" id="presetApply">선택 항목 적용</button><p><button type="button" id="presetReplace">현재 효과로 수정</button> <button type="button" id="presetRename">이름 변경</button> <button type="button" id="presetDelete">삭제</button></p><p><button type="button" id="presetExport">파일로 내보내기</button> <label class="button">파일 가져오기<input id="presetImport" type="file" accept=".json,.ytt-presets"></label></p><p>일부 개별 편집 프리셋은 저장 당시와 같은 글자 수가 필요합니다.</p>';
$('effectPanel').after(presetPanel);
const stylePanel=document.createElement('fieldset');
stylePanel.innerHTML='<legend>자막 기본 스타일</legend><label>유튜브 글꼴<select id="styleFont"><option value="0">기본</option><option value="1">고정폭 명조</option><option value="2">비례 명조</option><option value="3">고정폭 고딕</option><option value="4">비례 고딕</option><option value="5">캐주얼</option><option value="6">필기체</option><option value="7">작은 대문자</option></select></label><label><input id="styleBold" type="checkbox"> 굵게</label><label>윤곽선·그림자 종류<select id="styleEdge"><option value="0">없음</option><option value="1">강한 그림자</option><option value="2">입체</option><option value="3">윤곽선 / 빛</option><option value="4">부드러운 그림자</option></select></label><label>윤곽선·그림자 색<input id="styleEdgeColor" type="color" value="#000000"></label><button type="button" id="styleApply">기본 스타일 적용</button> <button type="button" id="styleClear">기본 스타일 제거</button><p>미리보기는 참고용이며 실제 YouTube 표시와 다를 수 있습니다.</p>';
stylePanel.querySelector('legend').insertAdjacentHTML('afterend','<label>글자색<input id="styleColor" type="color" value="#fefefe"></label><label>글자 불투명도 (0~254)<input id="styleOpacity" type="number" min="0" max="254" step="1" value="254"></label><label>배경색<input id="styleBackground" type="color" value="#080808"></label><label>배경 불투명도 (0~254)<input id="styleBackgroundOpacity" type="number" min="0" max="254" step="1" value="0"></label><label>글자 크기 (YTT 값)<input id="styleSize" type="number" min="0" max="10000" step="1" value="100"></label>');
$('effectPanel').before(stylePanel);
const positionPanel=document.createElement('fieldset');
positionPanel.innerHTML='<legend>자막 고정 위치</legend><label>가로 위치 (0~100%)<input id="positionX" type="number" min="0" max="100" step="1"></label><label>세로 위치 (0~100%)<input id="positionY" type="number" min="0" max="100" step="1"></label><label>기준점<select id="positionAnchor"><option value="0">왼쪽 위</option><option value="1">가운데 위</option><option value="2">오른쪽 위</option><option value="3">왼쪽 가운데</option><option value="4">정중앙</option><option value="5">오른쪽 가운데</option><option value="6">왼쪽 아래</option><option value="7">가운데 아래</option><option value="8">오른쪽 아래</option></select></label><button type="button" id="positionApply">고정 위치 적용</button><p>적용하면 자막 전체의 기존 위치 키프레임을 고정 위치로 바꿉니다. 곡선 경로는 먼저 제거하세요.</p>';
$('effectPanel').before(positionPanel);
const motionPanel=document.createElement('fieldset');
motionPanel.innerHTML='<legend>곡선 이동 경로</legend><p>경로 편집을 누르고 영상 위의 네 점을 끌어 이동하세요. 시작·끝 점과 제어점입니다.</p><label>시작 (자막 기준 초)<input id="pathStart" type="number" min="0" step="0.001" value="0"></label><label>종료 (자막 기준 초)<input id="pathEnd" type="number" min="0" step="0.001" value="1"></label><button type="button" id="pathOpen">경로 편집</button> <button type="button" id="pathApply">경로 적용</button> <button type="button" id="pathRemove">경로 제거</button><p>속도는 키프레임 영역에서 선택한 속도를 사용합니다.</p>';
$('effectPanel').after(motionPanel);
let pathEditor=null,pathDraft=null,pathCue=null;
function closePathEditor() { if(pathEditor)pathEditor.destroy(); pathEditor=null; pathDraft=null; pathCue=null; }
const easingPanel=document.createElement('section');
easingPanel.innerHTML='<label>속도 조절 모드<select id="easingMode"><option value="simple">간편 모드</option><option value="advanced">전문 모드</option></select></label><div id="easingGraph" hidden><p>제어점을 드래그하세요. 가로는 시간, 세로는 진행률입니다.</p><div id="bezierCanvas"></div><output id="bezierValues"></output></div>';
$('effectEase').parentElement.after(easingPanel);
let customEase=[0.42,0,0.58,1];
const curveEditor=createBezierEditor($('bezierCanvas'),customEase,value=>{customEase=value;$('bezierValues').textContent=value.map(n=>n.toFixed(2)).join(', ');});
$('bezierValues').textContent=customEase.map(n=>n.toFixed(2)).join(', ');
$('easingMode').onchange=()=>{ $('easingGraph').hidden=$('easingMode').value!=='advanced'; $('effectEase').disabled=$('easingMode').value==='advanced'; };
function currentEasing() { return $('easingMode').value==='advanced' ? [...customEase] : $('effectEase').value; }
function showEasing(value) {
  if (Array.isArray(value) && value.length===4) { customEase=[...value]; curveEditor.setCurve(customEase); $('bezierValues').textContent=customEase.map(n=>n.toFixed(2)).join(', '); $('easingMode').value='advanced'; }
  else { $('easingMode').value='simple'; $('effectEase').value=value ?? 'linear'; }
  $('easingMode').onchange();
}
const targetPanel=document.createElement('div');
targetPanel.innerHTML='<label>적용할 단위 번호 (비워 두면 전체)<input id="effectTargets" type="text" placeholder="예: 1,3-5"></label><p id="unitChoices"></p>';
$('effectScope').parentElement.after(targetPanel);
const middleFrames=document.createElement('label');
middleFrames.innerHTML='중간 키프레임 (진행률 % = 값, 한 줄에 하나)<textarea id="middleKeyframes" rows="3" placeholder="예: 25 = 100&#10;75 = 200"></textarea><small>위치는 예: 50 = 30, 60 · 선택한 속도 곡선을 각 구간에 적용합니다.</small>';
$('effectEnd').parentElement.after(middleFrames);
const effectTimes=document.createElement('div');
effectTimes.innerHTML='<label>효과 시작 (자막 기준 초)<input id="effectTimeStart" type="number" min="0" step="0.001" value="0"></label><label>효과 종료 (자막 기준 초, 비우면 자동)<input id="effectTimeEnd" type="number" min="0" step="0.001" placeholder="자막 끝"></label><p>단위별 시차를 쓰면 종료 시각과 시차의 합이 자막 길이를 넘지 않아야 합니다.</p>';
$('effectStart').parentElement.before(effectTimes);
function refreshUnitChoices() {
  const mode=$('effectScope').value; targetPanel.hidden=mode==='all';
  if (!selected || mode==='all') { $('unitChoices').textContent=''; return; }
  try {
    const raw=$('groupBoundaries').value.trim();
    if (mode==='custom' && raw && !/^\d+(\s*,\s*\d+)*$/.test(raw)) throw new Error('묶음 경계를 입력하세요.');
    const parts=splitEffectUnits(selected.text,mode,mode==='custom' && raw ? raw.split(',').map(Number) : []).filter(unit=>!/^\s+$/u.test(unit.text));
    $('unitChoices').textContent=parts.map((unit,index)=>`${index+1}: ${unit.text}`).join('  ·  ');
  } catch(error) { $('unitChoices').textContent=error.message; }
}
function showExistingEffect() {
  if (!selected) return;
  const property=$('effectProperty').value;
  let targets; try { targets=parseUnitTargets($('effectTargets').value); } catch { targets=null; }
  const units=selected.units?.filter(unit=>!/^\s+$/u.test(unit.text));
  const frames=$('effectScope').value==='all' ? selected.keyframes?.[property] : (targets ? units?.[targets[0]-1]?.keyframes?.[property] : units?.find(unit=>unit.keyframes?.[property])?.keyframes[property]);
  if (!Array.isArray(frames) || frames.length<2) { $('middleKeyframes').value=''; $('effectTimeStart').value='0'; $('effectTimeEnd').value=''; return; }
  const ordered=[...frames].sort((a,b)=>a.time-b.time);
  const format=value=>Array.isArray(value) ? value.join(', ') : String(value);
  $('effectStart').value=format(ordered[0].value); $('effectEnd').value=format(ordered.at(-1).value);
  $('effectTimeStart').value=String(ordered[0].time/1000); $('effectTimeEnd').value=String(ordered.at(-1).time/1000);
  const span=ordered.at(-1).time-ordered[0].time;
  $('middleKeyframes').value=span>0 ? ordered.slice(1,-1).map(frame=>`${Number(((frame.time-ordered[0].time)/span*100).toFixed(4))} = ${format(frame.value)}`).join('\n') : '';
  showEasing(ordered[0].easing);
}
$('effectProperty').addEventListener('change',showExistingEffect);
$('effectScope').addEventListener('change',()=>{refreshUnitChoices();showExistingEffect();});
$('effectTargets').addEventListener('change',showExistingEffect);
$('groupBoundaries').addEventListener('input',refreshUnitChoices);
const effectHelp=document.createElement('p'); $('effectProperty').parentElement.after(effectHelp);
function updateEffectHelp() { effectHelp.textContent=$('effectProperty').value==='position' && $('effectScope').value!=='all' ? '단어·글자별 위치 값은 원래 배치에서의 상대 이동량(%)입니다. MP4가 필요하며 YouTube 결과는 달라질 수 있습니다.' : ''; }
$('effectProperty').addEventListener('change',updateEffectHelp); $('effectScope').addEventListener('change',updateEffectHelp); updateEffectHelp();
const storagePanel=document.createElement('fieldset');
storagePanel.innerHTML='<legend>데이터 저장 위치</legend><label>프리셋·복구 파일 폴더<input type="text" id="storageDirectory" placeholder="예: C:\\자막도구\\data"></label><button type="button" id="storageApply">저장 위치 변경</button><p>기존 데이터는 새 폴더에 복사하며, 대상에 같은 파일이 있으면 변경을 중단합니다.</p>';
document.querySelector('aside').append(storagePanel);
storagePanel.disabled=true;
fetch('/api/settings').then(async response=>{if(!response.ok)throw new Error(`서버 응답 ${response.status}`);const settings=await response.json();$('storageDirectory').value=settings.directory;storagePanel.disabled=false;}).catch(error=>say(`저장 위치를 읽을 수 없습니다: ${error.message}`));
$('storageApply').onclick=async()=>{
  const directory=$('storageDirectory').value.trim();
  if (!directory) { say('저장할 폴더의 절대 경로를 입력하세요.'); return; }
  storagePanel.disabled=true;
  try {
    const response=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({directory})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error ?? `서버 응답 ${response.status}`);
    $('storageDirectory').value=data.directory; say('데이터 저장 위치를 변경했습니다. 원본 파일은 이전 폴더에도 남아 있습니다.');
  } catch(error) { say(`저장 위치 변경 실패: ${error.message}`); }
  finally { storagePanel.disabled=false; }
};
const fontNames=['Roboto','Courier New','Times New Roman','Lucida Console','Roboto','Comic Sans MS','Monotype Corsiva','Arial'];
function prepareCue(cue) {
  if (originalYtt && cue.originalIndex!=null) {
    if (!canAnimateOriginal(originalYtt,cue.originalIndex)) throw new Error('원본의 지원하지 않는 구조를 보존하기 위해 이 자막에는 효과를 적용할 수 없습니다.');
    const initial=originalPreview(originalYtt,cue.originalIndex,cue.textEdits,cue.styleOverride).state;
    cue={...cue,appearance:{...initial,...cue.appearance}};
  }
  if (!cue.units?.some(unit=>unit.keyframes?.position)) return cue;
  const width=video.videoWidth,height=video.videoHeight;
  if (!width || !height) throw new Error('글자별 위치를 계산하려면 MP4 영상을 먼저 불러오세요.');
  const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
  if (!ctx) throw new Error('글자 배치를 계산할 수 없습니다.');
  const layoutAt=elapsed=>{
    const state=animatedStateAt(cue,elapsed);
    const measured=cue.units.map(unit=>{
      const {position:positionFrames,...otherFrames}=unit.keyframes ?? {};
      const appearance=animatedStateAt({appearance:{...state,...unit.appearance},keyframes:otherFrames,delays:unit.delays,defaultDelayMs:unit.delayMs},elapsed);
      return {...unit,measuredAppearance:appearance};
    });
    const sizeFor=unit=>Math.max(1,height/20*(1+(unit.measuredAppearance.size-100)/400));
    const maxSize=measured.reduce((max,unit)=>Math.max(max,sizeFor(unit)),1);
    return layoutUnits(measured,{width,height,lineHeight:maxSize*1.2,anchor:state.anchor,measure:(text,unit)=>{
      const style=unit.measuredAppearance;
      ctx.font=`${style.italic?'italic ':''}${style.bold?'bold ':''}${sizeFor(unit)}px "${fontNames[style.font] ?? 'Arial'}", sans-serif`;
      return ctx.measureText(text).width;
    }}).map(unit=>unit.layoutOffset);
  };
  const initial=layoutAt(0), units=cue.units.map((unit,index)=>({...unit,layoutOffset:initial[index]}));
  const prepared={...cue,units};
  if (cue.keyframes?.size || cue.units.some(unit=>unit.keyframes?.size)) Object.defineProperty(prepared,'layoutAt',{value:layoutAt,enumerable:false});
  return prepared;
}
function paintAppearance(element,state,height) {
  element.style.color=`${state.color}${state.opacity.toString(16).padStart(2,'0')}`;
  element.style.backgroundColor=`${state.backgroundColor}${state.backgroundOpacity.toString(16).padStart(2,'0')}`;
  element.style.fontSize=`${Math.max(1,(height/20)*(1+(state.size-100)/400))}px`;
  element.style.fontFamily=`"${fontNames[state.font]}", sans-serif`;
  element.style.fontVariant=state.font===7 ? 'small-caps' : 'normal';
  element.style.fontWeight=state.bold ? 'bold' : 'normal';
  element.style.fontStyle=state.italic ? 'italic' : 'normal';
  element.style.textDecoration=state.underline ? 'underline' : 'none';
  const edge=state.edgeColor;
  element.style.textShadow=({0:'none',1:`2px 2px 0 ${edge}`,2:`1px 1px 0 ${edge}, -1px -1px 0 ${edge}`,3:`-1px 0 ${edge}, 1px 0 ${edge}, 0 -1px ${edge}, 0 1px ${edge}`,4:`2px 2px 4px ${edge}`})[state.edgeType];
}
function renderPresets() {
  const select=$('presetChoice'), prior=select.value; select.replaceChildren();
  presets.forEach((preset,index)=>{const option=document.createElement('option'); option.value=String(index); option.textContent=preset.name; select.append(option);});
  if (prior!=='' && Number(prior)<presets.length) select.value=prior;
  presetPanel.disabled=!presetsReady || !selected || !canAnimateSelected() || !!selected.style;
}
async function persistPresets(next) {
  const text=stringifyPresetLibrary(next);
  const response=await fetch('/api/presets',{method:'PUT',headers:{'Content-Type':'application/json'},body:text});
  if (!response.ok) throw new Error(`저장 실패 (서버 응답 ${response.status})`);
  presets=next; renderPresets();
}
const projectText = () => encodeProject({tracks,originalYtt,videoName,quality:$('quality').value});
function markDirty() {
  recoveryDirty = true;
  editRevision++;
  recoveryStatus.textContent=recoveryFailed ? '자동 저장 중지' : '자동 저장 대기 중';
  clearTimeout(saveTimer);
  if (!recoveryReady) return;
  saveTimer = setTimeout(() => {
    let snapshot; const revision=editRevision;
    try { snapshot=projectText(); } catch(error) { recoveryStatus.textContent='자동 저장 실패'; say(`자동 저장 실패: ${error.message}`); return; }
    saveChain=saveChain.catch(()=>{}).then(async()=>{
      if (revision===editRevision) recoveryStatus.textContent='자동 저장 중';
      const response=await fetch('/api/recovery',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});
      if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
      savedRevision=Math.max(savedRevision,revision);
      if (savedRevision===editRevision) recoveryStatus.textContent='자동 저장 완료';
    }).catch(error=>{ if (revision===editRevision) recoveryStatus.textContent='자동 저장 실패'; say(`자동 저장 실패: ${error.message}. 프로젝트를 직접 저장하세요.`); });
  },700);
}
window.addEventListener('beforeunload',event=>{
  if (editRevision>savedRevision) { event.preventDefault(); event.returnValue=''; }
});
function restoreProject(project) {
  if (project.originalYtt) {
    const doc=parseYtt(project.originalYtt), refs=project.tracks.flatMap(t=>t.cues).filter(c=>c.originalIndex!=null).map(c=>c.originalIndex);
    if (refs.length !== doc.cues.length || new Set(refs).size !== refs.length || refs.some(i=>i >= doc.cues.length)) throw new Error('프로젝트의 원본 YTT 참조가 일치하지 않습니다.');
    for (const cue of project.tracks.flatMap(t=>t.cues)) if (cue.originalIndex!=null && cue.textEdits) {
      replaceTextRuns(doc,doc.cues[cue.originalIndex],cue.textEdits);
      if (cue.textEdits.join('')!==cue.text) throw new Error('프로젝트의 텍스트 변경 내용이 일치하지 않습니다.');
    }
    for (const cue of project.tracks.flatMap(t=>t.cues)) if (cue.originalIndex!=null && cue.styleOverride) setCueStyle(project.originalYtt,cue.originalIndex,cue.styleOverride);
  }
  tracks=project.tracks; originalYtt=project.originalYtt; originalSessionId=++nextOriginalSessionId; videoName=project.videoName; $('quality').value=project.quality;
  editHistory.clear(); refreshHistoryButtons();
  activeTrack=0;
  nextId=tracks.reduce((max,track)=>track.cues.reduce((n,cue)=>Math.max(n,cue.id),max),0); selected=null; previewCache.clear();
  if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl=null; video.removeAttribute('src'); video.load();
  waveformGeneration++; waveformPeaks=null; drawWaveform();
  showProperties(); render();
  say(videoName ? `프로젝트를 열었습니다. 영상 ${videoName}을 다시 선택하세요.` : '프로젝트를 열었습니다.');
}

function render(reuseIndexes=false) {
  if (dragging) { $('clock').textContent=time(video.currentTime || 0); return; }
  const list = $('trackList'), scrollLeft=list.scrollLeft, scrollTop=list.scrollTop;
  if (!reuseIndexes || timelineIndexes.length!==tracks.length) { timelineIndexes=tracks.map(track=>indexCues(track.cues)); timelineLanes=tracks.map(track=>packCueLanes(track.cues)); }
  list.replaceChildren();
  const width = Math.max(list.clientWidth - 180, totalSeconds() * pixelScale());
  const visibleStart=Math.max(0,(scrollLeft-300)/pixelScale()*1000), visibleEnd=(scrollLeft+list.clientWidth+300)/pixelScale()*1000;
  for (const [trackIndex,track] of tracks.entries()) {
    const row = document.createElement('div'); row.className = 'track';
    const controls=document.createElement('div'); controls.className='track-controls';
    const name = document.createElement('button'); name.type='button'; name.className = `track-name${activeTrack===trackIndex?' active':''}`; name.textContent = track.name; name.title='작업할 트랙 선택';
    name.addEventListener('click',()=>{activeTrack=trackIndex; render();});
    const rename=document.createElement('button'); rename.type='button'; rename.textContent='이름'; rename.title='트랙 이름 변경';
    rename.addEventListener('click',()=>{ const value=window.prompt('트랙 이름',track.name); if (value==null) return; const trimmed=value.trim(); if (!trimmed) { say('트랙 이름을 입력하세요.'); return; } if(trimmed!==track.name) { recordEdit(); track.name=trimmed; markDirty(); render(); } });
    const lock=document.createElement('button'); lock.type='button'; lock.textContent=track.locked?'잠금 해제':'잠금'; lock.setAttribute('aria-pressed',String(!!track.locked));
    lock.addEventListener('click',()=>{ recordEdit(); track.locked=!track.locked; if (track.locked && track.cues.includes(selected)) {selected=null; showProperties();} markDirty(); render(); });
    const visibility=document.createElement('button'); visibility.type='button'; visibility.textContent=track.hidden?'표시':'숨김'; visibility.title='미리보기에서만 전환하며 출력에는 영향을 주지 않습니다'; visibility.setAttribute('aria-pressed',String(!!track.hidden));
    visibility.addEventListener('click',()=>{ recordEdit(); track.hidden=!track.hidden; markDirty(); render(); });
    controls.append(name,rename,lock,visibility);
    const lane = document.createElement('div'); lane.className = 'lane'; lane.style.width = `${width}px`; lane.style.height=`${timelineLanes[trackIndex].count*49}px`;
    lane.addEventListener('click', event => { if (event.target !== lane) return; const t = (event.clientX - lane.getBoundingClientRect().left) / pixelScale(); if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, Math.max(0,t)); });
    for (const cue of queryCues(timelineIndexes[trackIndex],visibleStart,visibleEnd)) {
      const button = document.createElement('button'); button.className = `cue${cue === selected ? ' selected' : ''}`;
      button.style.top=`${4+49*timelineLanes[trackIndex].lanes.get(cue)}px`;
      button.style.left = `${cue.start / 1000 * pixelScale()}px`; button.style.width = `${Math.max(4, (cue.end - cue.start) / 1000 * pixelScale())}px`;
      const left=document.createElement('span'); left.className='trim-handle trim-start'; left.title='시작 시간 조절';
      const label=document.createElement('span'); label.className='cue-label'; label.textContent=cue.text || '(빈 자막)';
      const right=document.createElement('span'); right.className='trim-handle trim-end'; right.title='종료 시간 조절';
      button.append(left,label,right); button.title='끌어서 이동 · 양 끝을 끌어 길이 조절';
      button.addEventListener('pointerdown',event=>{
        if (event.button!==0) return;
        if (track.locked) { say('잠긴 트랙은 편집할 수 없습니다.'); return; }
        event.preventDefault(); selected=cue; activeTrack=trackIndex; showProperties();
        const operation=event.target===left?'start':event.target===right?'end':'move';
        const mode=$('snapMode').value, fps=Number($('fps').value);
        const boundaries=(mode==='cues' || mode==='both') ? allCues().filter(other=>other!==cue).flatMap(other=>[other.start,other.end]).sort((a,b)=>a-b) : [];
        dragging={cue,operation,originX:event.clientX,original:{start:cue.start,end:cue.end},scale:pixelScale(),candidate:{start:cue.start,end:cue.end},pointerId:event.pointerId,mode,boundaries,fps:Number.isFinite(fps)&&fps>0 ? fps : 30};
        button.setPointerCapture(event.pointerId); button.classList.add('selected');
      });
      button.addEventListener('pointermove',event=>{
        if (!dragging || dragging.pointerId!==event.pointerId || dragging.cue!==cue) return;
        dragging.candidate=calculateCueDrag(dragging.original,dragging.operation,(event.clientX-dragging.originX)/dragging.scale*1000);
        if (Math.abs(event.clientX-dragging.originX)>=3) dragging.candidate=snapCue(dragging.candidate,dragging.operation,{boundaries:dragging.boundaries,fps:dragging.fps,mode:dragging.mode,tolerance:Math.min(200,8000/dragging.scale)});
        button.style.left=`${dragging.candidate.start/1000*dragging.scale}px`;
        button.style.width=`${Math.max(4,(dragging.candidate.end-dragging.candidate.start)/1000*dragging.scale)}px`;
        $('clock').textContent=`${time(dragging.candidate.start/1000)} → ${time(dragging.candidate.end/1000)}`;
      });
      function finishDrag(event,cancelled) {
        if (!dragging || dragging.pointerId!==event.pointerId || dragging.cue!==cue) return;
        const drag=dragging; dragging=null;
        if (!cancelled && (drag.candidate.start!==drag.original.start || drag.candidate.end!==drag.original.end)) {
          recordEdit();
          cue.start=drag.candidate.start; cue.end=drag.candidate.end; previewCache.delete(cue.id); markDirty();
          const duration=cue.end-cue.start;
          const beyond=cue.motionPath?.end>duration || Object.values(cue.keyframes ?? {}).some(frames=>frames.some(frame=>frame.time>duration)) || (cue.units ?? []).some(unit=>Object.entries(unit.keyframes ?? {}).some(([property,frames])=>frames.some(frame=>frame.time+(unit.delays?.[property] ?? unit.delayMs ?? 0)>duration)));
          say(beyond?'자막 길이 밖에 키프레임이 있습니다. 해당 부분은 출력되지 않습니다.':'자막 시간을 변경했습니다.');
        }
        showProperties(); render();
      }
      button.addEventListener('pointerup',event=>finishDrag(event,false));
      button.addEventListener('pointercancel',event=>finishDrag(event,true));
      button.addEventListener('click',event=>{if(event.detail===0){if(track.locked){say('잠긴 트랙은 편집할 수 없습니다.');return;} selected=cue;activeTrack=trackIndex;showProperties();render();}});
      lane.append(button);
    }
    const playhead = document.createElement('div'); playhead.className = 'playhead'; playhead.style.left = `${video.currentTime * pixelScale()}px`; lane.append(playhead);
    row.append(controls,lane); list.append(row);
  }
  $('timelineInfo').textContent = `${tracks.length}개 트랙 · ${allCues().length}개 자막`;
  list.scrollLeft=scrollLeft; list.scrollTop=scrollTop; lastTimelineScroll=list.scrollLeft;
  renderPlayback();
}

function renderPlayback() {
  if (dragging || positionDrag) return;
  drawWaveformPlayhead();
  effectControls?.updatePlayhead();
  for (const playhead of document.querySelectorAll('#trackList .playhead')) playhead.style.left=`${video.currentTime*pixelScale()}px`;
  const current = video.currentTime * 1000;
  const visible=timelineIndexes.flatMap((index,i)=>tracks[i].hidden ? [] : queryCues(index,current,current+0.001)).filter(c=>c.start<=current && current<c.end);
  $('captions').replaceChildren(...visible.flatMap(c => {
    const plain=()=>{const span=document.createElement('span'); span.textContent=c.text;span.dataset.cueId=String(c.id); return span;};
    if (originalYtt && c.originalIndex!=null && !hasGeneratedEffect(c)) {
      try {
        const signature=JSON.stringify([c.originalIndex,c.textEdits,c.styleOverride]);
        if (previewCache.get(c.id)?.signature!==signature || previewCache.get(c.id)?.source!==originalYtt) previewCache.set(c.id,{signature,source:originalYtt,original:originalPreview(originalYtt,c.originalIndex,c.textEdits,c.styleOverride)});
        const sample=previewCache.get(c.id).original, state=sample.state;
        const stage=$('stage'), scale=Math.min(stage.clientWidth/(video.videoWidth || 16),stage.clientHeight/(video.videoHeight || 9));
        const w=(video.videoWidth || 16)*scale,h=(video.videoHeight || 9)*scale;
        const span=document.createElement('span'); span.classList.add('animated-preview');span.dataset.cueId=String(c.id);
        span.style.left=`${(stage.clientWidth-w)/2+w*(state.position[0]*0.96+2)/100}px`;
        span.style.top=`${(stage.clientHeight-h)/2+h*(state.position[1]*0.96+2)/100}px`;
        span.style.transform=`translate(-${(state.anchor%3)*50}%, -${Math.floor(state.anchor/3)*50}%)`;
        span.style.textAlign=sample.layout.align; span.style.direction=sample.layout.direction;
        span.style.writingMode=sample.layout.writingMode; span.style.textOrientation=sample.layout.orientation;
        paintAppearance(span,state,h); span.style.backgroundColor='transparent';
        span.replaceChildren(...sample.parts.filter(part=>current-c.start>=part.appearAt).map(part=>{const child=document.createElement('span');child.className='effect-part';child.textContent=part.text;paintAppearance(child,part.state,h);return child;}));
        if (sample.timed) span.title='원본 텍스트 구간의 상대 표시 시간을 반영합니다. 실제 YouTube 표시와 차이가 있을 수 있습니다.';
        return [span];
      } catch(error) { const span=plain(); span.title=`원본 스타일 미리보기 불가: ${error.message}`; return [span]; }
    }
    if (!(c.appearance || c.units || c.motionPath || (c.keyframes && Object.keys(c.keyframes).length))) {
      const state=animatedStateAt({appearance:{backgroundOpacity:191}},0),stage=$('stage');
      const scale=Math.min(stage.clientWidth/(video.videoWidth || 16),stage.clientHeight/(video.videoHeight || 9));
      const w=(video.videoWidth || 16)*scale,h=(video.videoHeight || 9)*scale,span=document.createElement('span');
      span.dataset.cueId=String(c.id);span.textContent=c.text;span.classList.add('animated-preview');
      span.style.left=`${(stage.clientWidth-w)/2+w*(state.position[0]*0.96+2)/100}px`;
      span.style.top=`${(stage.clientHeight-h)/2+h*(state.position[1]*0.96+2)/100}px`;
      span.style.transform=`translate(-${(state.anchor%3)*50}%, -${Math.floor(state.anchor/3)*50}%)`;paintAppearance(span,state,h);return [span];
    }
    try {
      const signature=JSON.stringify([c.start,c.end,c.text,c.keyframes,c.units,c.appearance,c.styleOverride,c.textEdits,c.motionPath,$('quality').value,video.videoWidth,video.videoHeight]);
      if (previewCache.get(c.id)?.signature !== signature) {
        const events=compileAnimatedYtt([prepareCue(c)],{quality:$('quality').value}).events;
        previewCache.set(c.id,{signature,index:indexCues(events)});
      }
      const samples=queryCues(previewCache.get(c.id).index,current,current+0.001).filter(sample=>sample.start<=current && current<sample.end);
      const stage=$('stage'), scale=Math.min(stage.clientWidth/(video.videoWidth || 16),stage.clientHeight/(video.videoHeight || 9));
      const w=(video.videoWidth || 16)*scale,h=(video.videoHeight || 9)*scale;
      return samples.map(sample=>{
        const span=document.createElement('span'),state=sample.state; span.textContent=sample.text;span.dataset.cueId=String(c.id);
        span.classList.add('animated-preview');
        span.style.left=`${(stage.clientWidth-w)/2 + w*(state.position[0]*0.96+2)/100}px`;
        span.style.top=`${(stage.clientHeight-h)/2 + h*(state.position[1]*0.96+2)/100}px`;
        span.style.transform=`translate(-${(state.anchor%3)*50}%, -${Math.floor(state.anchor/3)*50}%)`;
        paintAppearance(span,state,h);
        if (sample.parts) {
          span.style.backgroundColor='transparent';
          span.replaceChildren(...sample.parts.map(part=>{const child=document.createElement('span');child.className='effect-part';child.textContent=part.text;paintAppearance(child,part.state,h);return child;}));
        }
        return span;
      });
    } catch(error) {
      const span=plain(); span.title=`효과 미리보기 불가: ${error.message}`; return [span];
    }
  }));
  updatePositionHandle();
  $('clock').textContent = time(video.currentTime || 0);
}

function showProperties() {
  $('empty').hidden = !!selected; $('properties').hidden = !selected;
  deleteCue.disabled=!selected;
  copyCueButton.disabled=!selected;
  effectControls?.refresh();
  positionHandle.dataset.enabled=String(!!selected && canAnimateSelected() && !selected.style);
  if (pathCue && pathCue!==selected) closePathEditor();
  renderPresets();
  if (!selected) return;
  $('cueText').value = selected.text; $('cueStart').value = (selected.start / 1000).toFixed(3); $('cueEnd').value = (selected.end / 1000).toFixed(3);
  $('cueText').disabled = isOriginalCue();
  textRunPanel.replaceChildren();
  if (isOriginalCue()) {
    const doc=parseYtt(originalYtt), node=doc.cues[selected.originalIndex];
    const runs=getTextRuns(doc,node), values=selected.textEdits ?? runs.map(run=>run.value);
    if (values.length!==runs.length) throw new Error('프로젝트의 텍스트 구간이 원본과 일치하지 않습니다.');
    runs.forEach((run,index)=>{const label=document.createElement('label'); label.textContent=`원본 텍스트 구간 ${index+1}`; const input=document.createElement('textarea'); input.rows=2; input.value=values[index]; input.dataset.runIndex=String(index); label.append(input); textRunPanel.append(label);});
    if (!runs.length) textRunPanel.textContent='이 자막에는 편집 가능한 텍스트 구간이 없습니다.';
  }
  $('preserveInfo').textContent = isOriginalCue() ? '원본의 각 텍스트 구간을 따로 수정합니다. 스타일·알 수 없는 속성과 주석은 유지됩니다.' : '';
  $('effectPanel').disabled = !canAnimateSelected() || !!selected.style;
  motionPanel.disabled = !canAnimateSelected() || !!selected.style;
  positionPanel.disabled = !canAnimateSelected() || !!selected.style;
  if (isOriginalCue()) $('preserveInfo').textContent+=canAnimateSelected() ? ' 단순한 원본 자막은 효과를 적용할 수 있으며 출력 시 여러 구간으로 변환됩니다.' : ' 미지원 구조를 보존하기 위해 이 자막의 효과 편집은 제한됩니다.';
  if (!pathEditor) { $('pathStart').value=((selected.motionPath?.start ?? 0)/1000).toFixed(3); $('pathEnd').value=((selected.motionPath?.end ?? (selected.end-selected.start))/1000).toFixed(3); }
  stylePanel.disabled = !!selected.style;
  let style=selected.appearance ?? {};
  if (isOriginalCue()) {
    try { const originalStyle=readCueStyle(originalYtt,selected.originalIndex); style={...originalStyle,...selected.styleOverride};
      if (originalStyle.hasStyledSpans) $('preserveInfo').textContent+=' 별도 스타일을 가진 구간은 기본 스타일 변경의 영향을 받지 않을 수 있습니다.';
    } catch(error) { stylePanel.disabled=true; $('preserveInfo').textContent+=` 스타일 편집 불가: ${error.message}`; }
  }
  $('styleFont').value=String(style.font ?? 4);
  $('styleColor').value=style.color ?? '#fefefe'; $('styleOpacity').value=String(style.opacity ?? 254);
  $('styleBackground').value=style.backgroundColor ?? '#080808'; $('styleBackgroundOpacity').value=String(style.backgroundOpacity ?? 0); $('styleSize').value=String(style.size ?? 100);
  $('styleBold').checked=!!style.bold;
  $('styleEdge').value=String(style.edgeType ?? 0);
  $('styleEdgeColor').value=style.edgeColor ?? '#000000';
  let basePosition={position:[50,90],anchor:7};
  if (isOriginalCue()) { try { basePosition=originalPreview(originalYtt,selected.originalIndex,selected.textEdits,selected.styleOverride).state; } catch {} }
  basePosition={...basePosition,...selected.appearance};
  const pos=selected.keyframes?.position?.[0]?.value ?? basePosition.position;
  $('positionX').value=String(pos?.[0] ?? 50); $('positionY').value=String(pos?.[1] ?? 90); $('positionAnchor').value=String(basePosition.anchor ?? 7);
  const whole=Object.keys(selected.keyframes ?? {}), units=[...new Set((selected.units ?? []).flatMap(u=>Object.keys(u.keyframes ?? {})))];
  $('effectList').textContent = whole.length || units.length ? `전체: ${whole.join(', ') || '없음'} / 단위별: ${units.join(', ') || '없음'}` : '적용된 효과 없음';
  refreshUnitChoices();
  showExistingEffect();
}

function updatePositionHandle() {
  if(positionDrag)return;
  if(!selected || positionHandle.dataset.enabled!=='true' || pathEditor || selected.motionPath) {positionHandle.hidden=true;return;}
  const stage=$('stage'), rect=stage.getBoundingClientRect();
  const boxes=[...$('captions').querySelectorAll('[data-cue-id]')].filter(element=>element.dataset.cueId===String(selected.id)).map(element=>element.getBoundingClientRect()).filter(box=>box.width && box.height);
  if(!boxes.length){positionHandle.hidden=true;return;}
  const left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top)),right=Math.max(...boxes.map(box=>box.right)),bottom=Math.max(...boxes.map(box=>box.bottom));
  positionHandle.style.left=`${left-rect.left-4}px`;positionHandle.style.top=`${top-rect.top-4}px`;positionHandle.style.width=`${right-left+8}px`;positionHandle.style.height=`${bottom-top+8}px`;positionHandle.hidden=false;
}
positionHandle.addEventListener('pointerdown',event=>{
  if(event.button!==0 || !selected || selected.motionPath || pathEditor)return;
  try {
    const cue=selected,stage=$('stage'),scale=Math.min(stage.clientWidth/(video.videoWidth || 16),stage.clientHeight/(video.videoHeight || 9));
    const elapsed=Math.max(0,Math.min(cue.end-cue.start,Math.round(video.currentTime*1000-cue.start)));
    const state=animatedStateAt(prepareCue(cue),elapsed),plan=effectControls?.getTarget()==='selection' ? currentTextSelection(cue) : null;
    const part=plan?.units[plan.indices[0]],delay=part?.delays?.position ?? part?.delayMs ?? 0;
    const position=part ? (part.keyframes?.position?.length ? evaluateKeyframes(part.keyframes.position,elapsed-delay) : [0,0]) : state.position;
    const spans=[...$('captions').querySelectorAll('[data-cue-id]')].filter(element=>element.dataset.cueId===String(cue.id));
    positionDrag={cue,plan,pointer:event.pointerId,x:event.clientX,y:event.clientY,left:parseFloat(positionHandle.style.left),top:parseFloat(positionHandle.style.top),width:(video.videoWidth || 16)*scale,height:(video.videoHeight || 9)*scale,position,elapsed,spans,dx:0,dy:0};
    event.preventDefault();positionHandle.setPointerCapture(event.pointerId);if(!video.paused)video.pause();
  } catch(error) {positionDrag=null;say(`위치 이동을 시작할 수 없습니다: ${error.message}`);}
});
positionHandle.addEventListener('pointermove',event=>{
  if(!positionDrag || positionDrag.pointer!==event.pointerId)return;
  const drag=positionDrag;drag.dx=event.clientX-drag.x;drag.dy=event.clientY-drag.y;
  positionHandle.style.left=`${drag.left+drag.dx}px`;positionHandle.style.top=`${drag.top+drag.dy}px`;
  if(!drag.plan)for(const span of drag.spans)span.style.translate=`${drag.dx}px ${drag.dy}px`;
});
function finishPositionDrag(event,cancelled) {
  if(!positionDrag || positionDrag.pointer!==event.pointerId)return;
  const drag=positionDrag;positionDrag=null;
  for(const span of drag.spans)span.style.translate='';
  if(cancelled || selected!==drag.cue || Math.hypot(drag.dx,drag.dy)<2){renderPlayback();return;}
  try {
    const cue=drag.cue,first=drag.plan?.units[drag.plan.indices[0]],delay=first ? (first.delays?.position ?? first.delayMs ?? 0) : (cue.delays?.position ?? cue.defaultDelayMs ?? 0),keyTime=drag.elapsed-delay;
    if(keyTime<0)throw new Error('위치 시차보다 앞에서는 위치를 추가할 수 없습니다.');
    const position=[drag.position[0]+drag.dx/(drag.width*0.96)*100,drag.position[1]+drag.dy/(drag.height*0.96)*100].map(value=>drag.plan ? Math.round(value) : Math.max(0,Math.min(100,Math.round(value))));
    const previous=structuredClone(first ? (first.keyframes?.position ?? []) : (cue.keyframes?.position ?? [])),frames=structuredClone(previous), existing=frames.find(frame=>frame.time===keyTime);
    if(existing)existing.value=position;else frames.push({time:keyTime,value:position,easing:'linear'});
    frames.sort((a,b)=>a.time-b.time);
    let appearance=cue.appearance;
    if(cue.originalIndex==null && !hasGeneratedEffect(cue))appearance={backgroundOpacity:191};
    const next=drag.plan ? {...cue,appearance,units:applySelectionFrames(drag.plan,'position',previous,frames),unitPlan:null} : {...cue,appearance,keyframes:{...cue.keyframes,position:frames}};
    compileAnimatedYtt([prepareCue(next)],{quality:$('quality').value});
    recordEdit();cue.appearance=next.appearance;cue.keyframes=next.keyframes;cue.units=next.units;cue.unitPlan=next.unitPlan;previewCache.delete(cue.id);showProperties();render();markDirty();say(drag.plan?'선택한 글자의 위치를 변경했습니다.':'자막 위치를 변경했습니다.');
  } catch(error){say(`위치 변경 실패: ${error.message}`);renderPlayback();}
}
positionHandle.addEventListener('pointerup',event=>finishPositionDrag(event,false));
positionHandle.addEventListener('pointercancel',event=>finishPositionDrag(event,true));

function drawWaveform() {
  const canvas=$('waveform'), width=Math.max(1,Math.round(canvas.clientWidth*(window.devicePixelRatio || 1)));
  canvas.width=width; waveformSurface.width=width; waveformSurface.height=canvas.height;
  const ctx=waveformSurface.getContext('2d'); ctx.clearRect(0,0,width,canvas.height);
  if (waveformPeaks) {
    ctx.strokeStyle='#63b3cf'; ctx.beginPath();
    for(let x=0;x<width;x++) {
      const first=Math.floor(x*waveformPeaks.length/width), last=Math.max(first+1,Math.ceil((x+1)*waveformPeaks.length/width));
      let min=1,max=-1;
      for(let i=first;i<Math.min(last,waveformPeaks.length);i++) { min=Math.min(min,waveformPeaks[i][0]); max=Math.max(max,waveformPeaks[i][1]); }
      ctx.moveTo(x,(1-max)*canvas.height/2); ctx.lineTo(x,(1-min)*canvas.height/2);
    }
    ctx.stroke();
  }
  drawWaveformPlayhead();
}
function drawWaveformPlayhead() {
  const canvas=$('waveform'),ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(waveformSurface,0,0);
  if (Number.isFinite(video.duration) && video.duration>0) {
    const position=Math.max(0,Math.min(1,video.currentTime/video.duration));
    ctx.strokeStyle='#ffca72'; ctx.beginPath(); ctx.moveTo(position*canvas.width,0); ctx.lineTo(position*canvas.width,canvas.height); ctx.stroke();
    canvas.setAttribute('aria-valuenow',String(Math.round(video.currentTime)));
    canvas.setAttribute('aria-valuemax',String(Math.round(video.duration)));
    canvas.setAttribute('aria-valuetext',`${time(video.currentTime)} / ${time(video.duration)}`);
  }
}
const waveform=$('waveform'); waveform.setAttribute('role','slider'); waveform.setAttribute('aria-label','영상 전체 파형 및 재생 위치'); waveform.setAttribute('aria-valuemin','0'); waveform.tabIndex=0; waveform.title='클릭하여 영상 위치 이동';
waveform.addEventListener('click',event=>{const rect=waveform.getBoundingClientRect();if(rect.width && Number.isFinite(video.duration)) video.currentTime=Math.max(0,Math.min(video.duration,(event.clientX-rect.left)/rect.width*video.duration));});
waveform.addEventListener('keydown',event=>{if(!Number.isFinite(video.duration) || !['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(event.key==='ArrowLeft'?-1:1)));});
new ResizeObserver(drawWaveform).observe(waveform);
async function drawWave(file) {
  const generation=++waveformGeneration; waveformPeaks=null; drawWaveform();
  if (file.size > 64 * 1024 * 1024) {
    try {
      say('큰 영상의 파형을 분할 생성하고 있습니다.');
      const {decodeLargeWave}=await import('/wave-stream.js');
      const peaks=await decodeLargeWave(file,{cancelled:()=>generation!==waveformGeneration});
      if(generation===waveformGeneration) {waveformPeaks=peaks; drawWaveform(); say('영상의 파형을 분할 생성했습니다. 영상과의 시간 일치를 확인하세요.');}
      return;
    } catch(error) {
      if(generation!==waveformGeneration) return;
      if(file.size>300*1024*1024) { say(`큰 영상의 파형을 만들 수 없습니다: ${error.message}`); return; }
      say('분할 처리를 사용할 수 없어 일반 방식으로 파형을 생성합니다.');
    }
  }
  let audio;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audio = new AudioContext();
    const buffer = await audio.decodeAudioData(await file.arrayBuffer());
    if (generation!==waveformGeneration) return;
    const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    const count=Math.min(4096,buffer.length), peaks=[];
    for (let bucket=0;bucket<count;bucket++) {
      let min=1,max=-1;
      const start=Math.floor(bucket*buffer.length/count),end=Math.floor((bucket+1)*buffer.length/count);
      for (const channel of channels) for (let i=start;i<end;i++) { min=Math.min(min,channel[i]); max=Math.max(max,channel[i]); }
      peaks.push([min,max]);
      if (bucket%128===127) { await new Promise(resolve=>setTimeout(resolve,0)); if(generation!==waveformGeneration) return; }
    }
    waveformPeaks=peaks; drawWaveform();
  } catch { if (generation===waveformGeneration) say('이 영상의 오디오 파형을 만들 수 없습니다.'); }
  finally { if (audio) await audio.close().catch(()=>{}); }
}

$('videoFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = URL.createObjectURL(file); video.src = mediaUrl;
  videoName=file.name; markDirty();
  video.onerror = () => say('MP4를 재생할 수 없습니다. 영상 코덱을 확인하세요.');
  say('영상을 불러왔습니다.'); drawWave(file);
});

$('subtitleFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const text = await file.text(), extension = file.name.split('.').pop().toLowerCase();
    let result, nextOriginalYtt=null;
    if (extension === 'ytt' || extension === 'srv3') {
      const doc = parseYtt(text), xml = new DOMParser().parseFromString(text, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('유효하지 않은 XML입니다.');
      const elements = [...xml.documentElement.children].find(e => e.localName === 'body');
      const paragraphs = [...elements.children].filter(e => e.localName === 'p');
      if (paragraphs.length !== doc.cues.length) throw new Error('YTT 자막 구조를 일치시킬 수 없습니다.');
      result = {cues: doc.cues.map((cue,index) => {
        const start = Number(cue.attrs.t?.value ?? 0), duration = Number(cue.attrs.d?.value ?? 0);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(duration) || start < 0 || duration <= 0) throw new Error(`${index+1}번째 자막의 시간 또는 길이가 잘못되었습니다.`);
        return {start,end:start+duration,originalStart:start,originalEnd:start+duration,text:paragraphs[index].textContent,originalIndex:index};
      }), warnings:['YTT 원본 스타일 미리보기는 근사치이며 일부 원본 구조의 효과 변경은 제한됩니다.']};
      nextOriginalYtt = text;
    } else if (extension === 'srt') { result = importSrt(text); }
    else if (extension === 'ass') {
      result=importAss(text);
      const warnings=new Set(result.warnings);
      result.cues=result.cues.map(cue=>{
        const converted=convertAssStyle(cue.style);
        for (const warning of converted.warnings) warnings.add(warning);
        return {...cue,assSourceStyle:cue.style,style:null,appearance:converted.appearance};
      });
      result.warnings=[...warnings];
    }
    else throw new Error('지원하지 않는 자막 형식입니다.');
    const groups = new Map();
    for (const cue of result.cues) { const layer = cue.layer ?? 0; if (!groups.has(layer)) groups.set(layer,[]); groups.get(layer).push({...cue,id:++nextId}); }
    recordEdit(); originalYtt=nextOriginalYtt; originalSessionId=++nextOriginalSessionId;
    tracks = [...groups].map(([layer,cues]) => ({name:`트랙 ${layer+1}`,cues}));
    if (!tracks.length) tracks = [{name:'트랙 1',cues:[]}];
    activeTrack=0; selected = null; showProperties(); render(); markDirty(); say(result.warnings.join(' ') || '자막을 가져왔습니다.');
  } catch (error) { say(`가져오기 실패: ${error.message}`); }
  event.target.value = '';
});

$('addTrack').onclick = () => { recordEdit(); tracks.push({name:`트랙 ${tracks.length+1}`,cues:[]}); activeTrack=tracks.length-1; render(); markDirty(); };
$('addCue').onclick = () => {
  if (tracks[activeTrack].locked) { say('잠긴 트랙에는 자막을 추가할 수 없습니다.'); return; }
  recordEdit();
  const start = Math.round(video.currentTime * 1000); selected = {id:++nextId,start,end:start+2000,text:'새 자막',style:null,layer:activeTrack};
  tracks[activeTrack].cues.push(selected); showProperties(); render(); markDirty();
};
function copySelectedCue() {
  if(!selected)return;
  try {
    const cue=structuredClone(selected);
    let original=null;
    if(isOriginalCue()) {
      const doc=parseYtt(originalYtt),node=doc.cues[cue.originalIndex];
      if(!node)throw new Error('원본 자막을 찾을 수 없습니다.');
      if(doc.elements.some(element=>element.start>=node.start && element.end<=node.end && (element.attrs.id || element.attrs['xml:id']))) throw new Error('고유 ID가 있는 원본 자막은 안전하게 복사할 수 없습니다.');
      original={xml:originalYtt.slice(node.start,node.end),session:originalSessionId};
    }
    cueClipboard={cue,original};pasteCueButton.disabled=false;say('자막을 복사했습니다. Ctrl+V로 재생 위치에 붙여넣으세요.');
  } catch(error){say(`자막 복사 실패: ${error.message}`);}
}
function pasteCopiedCue() {
  if(!cueClipboard)return;
  try {
    const track=tracks[activeTrack];if(!track || track.locked)throw new Error('잠긴 트랙에는 자막을 붙여넣을 수 없습니다.');
    const copy=structuredClone(cueClipboard.cue),duration=copy.end-copy.start;
    const seconds=Number.isFinite(video.currentTime)?video.currentTime:0,start=Math.round(seconds*1000);
    if(!Number.isSafeInteger(start) || start<0 || !Number.isSafeInteger(duration) || duration<=0 || !Number.isSafeInteger(start+duration))throw new Error('붙여넣을 자막의 시간이 올바르지 않습니다.');
    copy.id=nextId+1;copy.start=start;copy.end=start+duration;copy.layer=activeTrack;
    let changedSource=originalYtt;
    if(cueClipboard.original) {
      if(!originalYtt || cueClipboard.original.session!==originalSessionId)throw new Error('원본 YTT 자막은 복사한 프로젝트 안에서만 붙여넣을 수 있습니다.');
      const doc=parseYtt(originalYtt),body=doc.root.children.find(node=>node.name==='body');
      if(!body)throw new Error('원본 YTT 본문을 찾을 수 없습니다.');
      copy.originalIndex=doc.cues.length;
      if(body.end===body.openEnd) {
        const tag=originalYtt.slice(body.start,body.openEnd).replace(/\/\s*>$/,'>');
        changedSource=applyEdits(originalYtt,[{start:body.start,end:body.end,text:`${tag}\n${cueClipboard.original.xml}\n</body>`}]);
      } else changedSource=applyEdits(originalYtt,[{start:body.contentEnd,end:body.contentEnd,text:`\n${cueClipboard.original.xml}\n`}]);
    } else {delete copy.originalIndex;delete copy.originalStart;delete copy.originalEnd;delete copy.textEdits;delete copy.styleOverride;}
    recordEdit();originalYtt=changedSource;nextId=copy.id;track.cues.push(copy);selected=copy;textSelection=null;previewCache.clear();showProperties();render();markDirty();say('자막을 현재 재생 위치에 붙여넣었습니다.');
  } catch(error){say(`자막 붙여넣기 실패: ${error.message}`);}
}
copyCueButton.onclick=copySelectedCue;pasteCueButton.onclick=pasteCopiedCue;
duplicateCue.onclick=()=>{
  if (!selected) return;
  try {
    const copy=structuredClone(selected); copy.id=nextId+1;
    let changedSource=originalYtt, index=null;
    if (isOriginalCue()) {
      index=selected.originalIndex;
      const doc=parseYtt(originalYtt), node=doc.cues[index];
      if (!node) throw new Error('원본 자막을 찾을 수 없습니다.');
      if (doc.elements.some(element=>element.start>=node.start && element.end<=node.end && (element.attrs.id || element.attrs['xml:id']))) throw new Error('고유 ID가 있는 원본 자막은 안전하게 복제할 수 없습니다.');
      changedSource=applyEdits(originalYtt,[{start:node.end,end:node.end,text:`\n${originalYtt.slice(node.start,node.end)}`}]);
      copy.originalIndex=index+1;
    }
    const track=tracks.find(item=>item.cues.includes(selected));
    if (!track || track.locked) throw new Error('선택한 트랙을 편집할 수 없습니다.');
    recordEdit();
    if (index!=null) {
      originalYtt=changedSource;
      for (const cue of allCues()) if (cue.originalIndex>index) cue.originalIndex++;
    }
    nextId=copy.id; track.cues.push(copy); selected=copy; activeTrack=tracks.indexOf(track);
    previewCache.clear(); showProperties(); render(); markDirty(); say('자막을 복제했습니다.');
  } catch(error) { say(`자막 복제 실패: ${error.message}`); }
};
deleteCue.onclick=()=>{
  if (!selected) return;
  try {
    const track=tracks.find(item=>item.cues.includes(selected));
    if (!track || track.locked) throw new Error('선택한 트랙을 편집할 수 없습니다.');
    let changedSource=originalYtt, index=null;
    if (isOriginalCue()) {
      index=selected.originalIndex;
      const doc=parseYtt(originalYtt), node=doc.cues[index];
      if (!node) throw new Error('원본 자막을 찾을 수 없습니다.');
      changedSource=applyEdits(originalYtt,[{start:node.start,end:node.end,text:''}]);
    }
    recordEdit();
    track.cues.splice(track.cues.indexOf(selected),1);
    if (index!=null) {
      originalYtt=changedSource;
      for (const cue of allCues()) if (cue.originalIndex>index) cue.originalIndex--;
    }
    selected=null; closePathEditor(); previewCache.clear(); showProperties(); render(); markDirty(); say('자막을 삭제했습니다. 실행 취소로 복원할 수 있습니다.');
  } catch(error) { say(`자막 삭제 실패: ${error.message}`); }
};
$('apply').onclick = () => {
  if (!selected) return;
  const start = Math.round(Number($('cueStart').value) * 1000), end = Math.round(Number($('cueEnd').value) * 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) { say('종료 시간은 시작 시간보다 뒤여야 합니다.'); return; }
  if (selected.units && $('cueText').value !== selected.text) { say('글자별 효과를 모두 제거한 뒤 텍스트를 수정하세요.'); return; }
  if (isOriginalCue()) {
    try {
      const doc=parseYtt(originalYtt), node=doc.cues[selected.originalIndex], runs=getTextRuns(doc,node);
      const values=[...textRunPanel.querySelectorAll('textarea')].map(input=>input.value);
      if (selected.units && values.join('')!==selected.text) throw new Error('글자별 효과를 모두 제거한 뒤 텍스트를 수정하세요.');
      replaceTextRuns(doc,node,values);
      recordEdit();
      selected.textEdits=values.some((value,index)=>value!==runs[index].value) ? values : undefined;
      selected.text=values.join('');
    } catch(error) { say(`텍스트 변경 실패: ${error.message}`); return; }
  } else { recordEdit(); selected.text = $('cueText').value; }
  selected.start = start; selected.end = end;
  say('변경을 적용했습니다.'); render(); markDirty();
};
function buildOutput() {
    let xml, warnings=[];
    if (originalYtt) {
      xml = originalYtt;
      for (const cue of allCues().filter(c => c.originalIndex != null && (c.textEdits || c.styleOverride || c.start !== c.originalStart || c.end !== c.originalEnd)).sort((a,b) => a.originalIndex-b.originalIndex)) {
        let doc = parseYtt(xml), node = doc.cues[cue.originalIndex];
        if (!node) throw new Error('원본 자막을 찾을 수 없습니다.');
        if (cue.textEdits) { xml=replaceTextRuns(doc,node,cue.textEdits); doc=parseYtt(xml); node=doc.cues[cue.originalIndex]; }
        if (cue.start !== cue.originalStart || cue.end !== cue.originalEnd) xml = setAttributes(doc,node,{t:cue.start,d:cue.end-cue.start});
        if (cue.styleOverride) xml=setCueStyle(xml,cue.originalIndex,cue.styleOverride);
      }
      const converted=allCues().filter(c=>c.originalIndex!=null && hasGeneratedEffect(c));
      const additions=[...allCues().filter(c=>c.originalIndex==null),...converted].map(prepareCue);
      if (converted.length) {
        const doc=parseYtt(xml);
        xml=applyEdits(xml,converted.map(c=>{const node=doc.cues[c.originalIndex];if(!node)throw new Error('원본 자막을 찾을 수 없습니다.');return {start:node.start,end:node.end,text:''};}));
        warnings.push('효과를 적용한 단순 원본 자막은 여러 구간으로 변환되었습니다. 실제 YouTube 표시를 확인하세요.');
      }
      if (additions.length || allCues().some(c=>c.originalIndex!=null && (c.start!==c.originalStart || c.end!==c.originalEnd))) {
        const ordered=orderYttCues(xml); xml=ordered.xml;
        if (ordered.reordered) warnings.push('원본 자막을 시작 시간 순서로 정렬했습니다.');
      }
      if (additions.length) { const merged=mergeNewCues(xml,additions,{quality:$('quality').value}); xml=merged.xml; warnings.push(...merged.warnings); }
    } else if (allCues().some(c => c.motionPath || c.appearance || c.units || Object.keys(c.keyframes ?? {}).length)) {
      const compiled=compileAnimatedYtt(allCues().map(prepareCue),{quality:$('quality').value});
      return {xml:compiled.xml,warnings:compiled.warnings,segments:compiled.segments,bytes:compiled.bytes};
    } else ({xml,warnings} = exportYtt(allCues()));
    return {xml,warnings,segments:parseYtt(xml).cues.length,bytes:new TextEncoder().encode(xml).length};
}
$('estimate').onclick = () => { try { const output=buildOutput(); say(`예상 자막 ${output.segments}구간 · ${(output.bytes/1024).toFixed(1)} KB. ${output.warnings.join(' ')}`); } catch(error) { say(`예상 실패: ${error.message}`); } };
$('export').onclick = () => {
  try {
    const {xml,warnings} = buildOutput();
    const url = URL.createObjectURL(new Blob([xml],{type:'application/xml;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'subtitles.ytt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(warnings.join(' ') || 'YTT 파일을 내보냈습니다.');
  } catch (error) { say(`내보내기 실패: ${error.message}`); }
};
$('applyEffect').onclick = () => {
  if (!selected || !canAnimateSelected() || selected.style) return;
  try {
    const property=$('effectProperty').value;
    const read = text => {
      text=text.trim();
      if (['color','backgroundColor','edgeColor'].includes(property)) { if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error('#RRGGBB 형식의 색상을 입력하세요.'); return text.toUpperCase(); }
      if (property === 'position') { const parts=text.split(',').map(s=>Number(s.trim())); if (parts.length!==2 || parts.some(v=>!Number.isFinite(v))) throw new Error('위치는 X,Y 형식으로 입력하세요.'); return parts; }
      if (text === '' || !Number.isFinite(Number(text))) throw new Error('숫자를 입력하세요.'); return Number(text);
    };
    const duration=selected.end-selected.start, easing=currentEasing();
    const startInput=$('effectTimeStart').value.trim(), endInput=$('effectTimeEnd').value.trim();
    const effectStart=Math.round(Number(startInput)*1000), effectEnd=endInput==='' ? duration : Math.round(Number(endInput)*1000);
    if (!startInput || !Number.isSafeInteger(effectStart) || !Number.isSafeInteger(effectEnd) || effectStart<0 || effectEnd>duration || effectEnd<=effectStart) throw new Error('효과 시간은 자막 길이 안에 있어야 하며 종료가 시작보다 늦어야 합니다.');
    const frames=[{time:effectStart,value:read($('effectStart').value),easing}];
    for (const line of $('middleKeyframes').value.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match=/^\s*(\d+(?:\.\d+)?)\s*=\s*(.+?)\s*$/.exec(line);
      if (!match) throw new Error('중간 키프레임은 한 줄에 진행률 % = 값 형식으로 입력하세요.');
      const percent=Number(match[1]);
      if (!(percent>0 && percent<100)) throw new Error('중간 키프레임 진행률은 0보다 크고 100보다 작아야 합니다.');
      frames.push({time:effectStart+Math.round((effectEnd-effectStart)*percent/100),value:read(match[2]),easing});
    }
    frames.push({time:effectEnd,value:read($('effectEnd').value)});
    frames.sort((a,b)=>a.time-b.time);
    if (frames.some((frame,i)=>i && frame.time<=frames[i-1].time)) throw new Error('키프레임 시간이 겹칩니다. 간격을 더 넓혀 주세요.');
    const mode=$('effectScope').value;
    let updated;
    if (mode==='all') updated={...selected,keyframes:{...selected.keyframes,[property]:frames}};
    else {
      const raw=$('groupBoundaries').value.trim();
      if (mode==='custom' && raw && !/^\d+(\s*,\s*\d+)*$/.test(raw)) throw new Error('묶음 경계는 쉼표로 구분된 글자 번호를 입력하세요.');
      const intervalMs=Number($('stagger').value);
      const targets=parseUnitTargets($('effectTargets').value);
      updated=setUnitEffect(selected,{mode,boundaries:mode==='custom' && raw ? raw.split(',').map(Number) : [],intervalMs,direction:$('staggerDirection').value,property,frames,targets});
      const changed=updated.changedUnitIndices.map(index=>updated.units[index]);
      const maxDelay=changed.reduce((max,unit)=>Math.max(max,unit.delays?.[property] ?? unit.delayMs ?? 0),0), available=selected.end-selected.start-maxDelay;
      if (available<=effectStart) throw new Error('시차를 적용하면 효과 시작이 자막 길이를 벗어납니다.');
      if (endInput!=='' && effectEnd>available) throw new Error('효과 종료 시각과 시차의 합이 자막 길이를 넘습니다.');
      for (const unit of changed) {
        if (endInput==='') for (const frame of unit.keyframes[property]) frame.time=effectStart+Math.round((frame.time-effectStart)*(available-effectStart)/(duration-effectStart));
        if (unit.keyframes[property].some((frame,i,all)=>i && frame.time<=all[i-1].time)) throw new Error('시차 적용 후 키프레임 시간이 겹칩니다. 시차를 줄이거나 간격을 넓혀 주세요.');
      }
    }
    updated=prepareCue(updated);
    compileAnimatedYtt([updated],{quality:$('quality').value});
    recordEdit();
    selected.keyframes=updated.keyframes; selected.units=updated.units; selected.unitPlan=updated.unitPlan; previewCache.delete(selected.id); showProperties(); render(); markDirty();
    say('효과를 적용했습니다. 유튜브 화면과의 일치는 아직 검증되지 않았습니다.');
  } catch(error) { say(`효과 적용 실패: ${error.message}`); }
};
$('removeEffect').onclick = () => {
  if (!selected) return;
  try {
    const property=$('effectProperty').value;
    if ($('effectScope').value==='all') { if (!selected.keyframes?.[property]) return; recordEdit(); delete selected.keyframes[property]; }
    else if (selected.units) {
      const active=selected.units.filter(unit=>!/^\s+$/u.test(unit.text)), targets=parseUnitTargets($('effectTargets').value);
      if (targets?.some(n=>n>active.length)) throw new Error('선택한 단위 번호가 범위를 벗어났습니다.');
      const chosen=targets ? targets.map(n=>active[n-1]) : active;
      if (!chosen.some(unit=>unit.keyframes?.[property])) return;
      recordEdit();
      for (const unit of chosen) { if (unit.keyframes) delete unit.keyframes[property]; if (unit.delays) delete unit.delays[property]; }
      if (targets) selected.unitPlan=null;
      if (selected.units.every(unit=>!Object.keys(unit.keyframes ?? {}).length && !unit.appearance)) { delete selected.units; delete selected.unitPlan; }
    } else return;
    previewCache.delete(selected.id); showProperties(); render(); markDirty();
  } catch(error) { say(`효과 제거 실패: ${error.message}`); }
};
$('styleApply').onclick = () => {
  if (!selected || selected.style) return;
  try {
    if (['styleOpacity','styleBackgroundOpacity','styleSize'].some(id=>$(id).value.trim()==='')) throw new Error('크기와 불투명도를 입력하세요.');
    const style={font:Number($('styleFont').value),bold:$('styleBold').checked,edgeType:Number($('styleEdge').value),edgeColor:$('styleEdgeColor').value,color:$('styleColor').value,opacity:Number($('styleOpacity').value),backgroundColor:$('styleBackground').value,backgroundOpacity:Number($('styleBackgroundOpacity').value),size:Number($('styleSize').value)};
    if (!Number.isInteger(style.opacity) || style.opacity<0 || style.opacity>254 || !Number.isInteger(style.backgroundOpacity) || style.backgroundOpacity<0 || style.backgroundOpacity>254 || !Number.isInteger(style.size) || style.size<0 || style.size>10000) throw new Error('크기 또는 불투명도 범위를 확인하세요.');
    if (isOriginalCue()) {
      setCueStyle(originalYtt,selected.originalIndex,style);
      recordEdit(); selected.styleOverride=style; showProperties(); render(); markDirty();
      say('원본 자막의 기본 스타일을 변경했습니다. 별도 스타일 구간은 영향을 받지 않을 수 있습니다.'); return;
    }
    const updated=prepareCue({...selected,appearance:{...selected.appearance,...style}});
    compileAnimatedYtt([updated],{quality:$('quality').value});
    recordEdit();
    selected.appearance=updated.appearance; selected.units=updated.units; previewCache.delete(selected.id); showProperties(); render(); markDirty();
    say('기본 스타일을 적용했습니다. 미리보기는 유튜브 표시와 다를 수 있습니다.');
  } catch(error) { say(`스타일 적용 실패: ${error.message}`); }
};
$('styleClear').onclick = () => { if (!selected || selected.style || (!selected.appearance && !selected.styleOverride)) return; recordEdit(); const {anchor,position}=selected.appearance ?? {}; delete selected.appearance; if(anchor!=null || position!=null) selected.appearance={...(anchor!=null?{anchor}:{}),...(position!=null?{position}:{})}; delete selected.styleOverride; previewCache.delete(selected.id); showProperties(); render(); markDirty(); };
$('positionApply').onclick=()=>{
  if (!selected || !canAnimateSelected() || selected.style) return;
  try {
    if (selected.motionPath) throw new Error('곡선 이동 경로를 먼저 제거하세요.');
    if (['positionX','positionY'].some(id=>$(id).value.trim()==='')) throw new Error('가로와 세로 위치를 입력하세요.');
    const position=[Number($('positionX').value),Number($('positionY').value)],anchor=Number($('positionAnchor').value);
    if (position.some(value=>!Number.isInteger(value) || value<0 || value>100) || !Number.isInteger(anchor) || anchor<0 || anchor>8) throw new Error('위치는 0~100의 정수여야 합니다.');
    const updated={...selected,appearance:{...selected.appearance,anchor},keyframes:{...selected.keyframes,position:[{time:0,value:position,easing:'linear'},{time:selected.end-selected.start,value:[...position]}]}};
    compileAnimatedYtt([prepareCue(updated)],{quality:$('quality').value});
    recordEdit(); selected.appearance=updated.appearance; selected.keyframes=updated.keyframes; previewCache.delete(selected.id); showProperties(); render(); markDirty(); say('고정 위치를 적용했습니다.');
  } catch(error) { say(`위치 적용 실패: ${error.message}`); }
};
$('pathOpen').onclick=()=>{
  if(!selected || !canAnimateSelected() || selected.style)return;
  if(selected.keyframes?.position) { say('기존 위치 키프레임을 제거한 뒤 경로를 편집하세요.'); return; }
  closePathEditor(); pathCue=selected;
  if (selected.motionPath) showEasing(selected.motionPath.easing);
  pathDraft=structuredClone(selected.motionPath?.points ?? [[20,80],[40,20],[60,20],[80,80]]);
  pathEditor=createPathEditor($('stage'),video,pathDraft,points=>{pathDraft=points;});
  updatePositionHandle();
  say('영상 위의 점을 끌어 경로를 조절한 뒤 경로 적용을 누르세요.');
};
$('pathApply').onclick=()=>{
  if(!selected || selected!==pathCue || !pathDraft) { say('먼저 경로 편집을 누르세요.'); return; }
  try {
    const start=Math.round(Number($('pathStart').value)*1000),end=Math.round(Number($('pathEnd').value)*1000);
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<=start || end>selected.end-selected.start) throw new Error('자막 길이 안의 시작·종료 시간을 입력하세요.');
    const updated=prepareCue({...selected,motionPath:{start,end,points:structuredClone(pathDraft),easing:currentEasing()}});
    compileAnimatedYtt([updated],{quality:$('quality').value});
    recordEdit();
    selected.motionPath=updated.motionPath; selected.units=updated.units; closePathEditor(); previewCache.delete(selected.id); showProperties(); render(); markDirty(); say('곡선 이동 경로를 적용했습니다.');
  } catch(error) { say(`경로 적용 실패: ${error.message}`); }
};
$('pathRemove').onclick=()=>{if(!selected || !canAnimateSelected() || selected.style || !selected.motionPath)return; recordEdit(); delete selected.motionPath; closePathEditor(); previewCache.delete(selected.id); showProperties(); render(); markDirty();};
$('quality').onchange = () => { previewCache.clear(); render(); markDirty(); };
$('presetSave').onclick = async () => {
  if (!selected || !presetsReady) return;
  const name=window.prompt('프리셋 이름을 입력하세요.'); if (name===null) return;
  try {
    const preset=makePreset(prepareCue(selected),name);
    if (presets.some(p=>p.name===preset.name)) throw new Error('같은 이름의 프리셋이 이미 있습니다.');
    presetPanel.disabled=true; await persistPresets([...presets,preset]); say('프리셋을 저장했습니다.');
  } catch(error) { say(`프리셋 저장 실패: ${error.message}`); }
  finally { renderPresets(); }
};
$('presetApply').onclick = () => {
  if (!selected || !$('presetChoice').value) return;
  try {
    if (Object.keys(selected.keyframes ?? {}).length || selected.units || selected.appearance || selected.motionPath) throw new Error('기존 효과를 제거한 자막에 적용하세요.');
    const updated=applyPreset(selected,presets[Number($('presetChoice').value)],{prepareCue});
    recordEdit();
    Object.assign(selected,updated); previewCache.delete(selected.id); showProperties(); render(); markDirty(); say('프리셋을 적용했습니다. 글자 수에 따라 효과 시간이 조정될 수 있습니다.');
  } catch(error) { say(`프리셋 적용 실패: ${error.message}`); }
};
$('presetReplace').onclick = async () => {
  const index=Number($('presetChoice').value);
  if (!selected || !presetsReady || $('presetChoice').value==='' || !presets[index]) return;
  try {
    const replacement=makePreset(prepareCue(selected),presets[index].name);
    const next=[...presets]; next[index]=replacement;
    presetPanel.disabled=true; await persistPresets(next); say('선택한 프리셋을 현재 자막의 효과로 수정했습니다.');
  } catch(error) { say(`프리셋 수정 실패: ${error.message}`); }
  finally { renderPresets(); }
};
$('presetRename').onclick = async () => {
  const index=Number($('presetChoice').value);
  if (!presetsReady || $('presetChoice').value==='' || !presets[index]) return;
  const input=window.prompt('새 프리셋 이름',presets[index].name); if (input===null) return;
  const name=input.trim();
  try {
    if (!name || name.length>100) throw new Error('100자 이내의 이름을 입력하세요.');
    if (presets.some((preset,i)=>i!==index && preset.name===name)) throw new Error('같은 이름의 프리셋이 이미 있습니다.');
    if (name===presets[index].name) return;
    const next=[...presets]; next[index]={...next[index],name};
    presetPanel.disabled=true; await persistPresets(next); say('프리셋 이름을 변경했습니다.');
  } catch(error) { say(`이름 변경 실패: ${error.message}`); }
  finally { renderPresets(); }
};
$('presetDelete').onclick = async () => {
  const index=Number($('presetChoice').value);
  if (!presetsReady || $('presetChoice').value==='' || !presets[index]) return;
  if (!window.confirm(`프리셋 “${presets[index].name}”을 삭제하시겠습니까?`)) return;
  try { presetPanel.disabled=true; await persistPresets(presets.filter((_,i)=>i!==index)); say('프리셋을 삭제했습니다.'); }
  catch(error) { say(`프리셋 삭제 실패: ${error.message}`); }
  finally { renderPresets(); }
};
$('presetExport').onclick = () => {
  try { const url=URL.createObjectURL(new Blob([stringifyPresetLibrary(presets)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='presets.ytt-presets'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); say('프리셋 파일을 내보냈습니다.'); }
  catch(error) { say(`내보내기 실패: ${error.message}`); }
};
$('presetImport').onchange = async event => {
  const file=event.target.files[0]; if (!file || !presetsReady) return;
  try {
    const incoming=parsePresetLibrary(await file.text());
    const names=new Set(presets.map(p=>p.name));
    for (const preset of incoming) { if (names.has(preset.name)) throw new Error(`같은 이름의 프리셋이 있습니다: ${preset.name}`); names.add(preset.name); }
    presetPanel.disabled=true; await persistPresets([...presets,...incoming]); say('프리셋 파일을 가져왔습니다.');
  } catch(error) { say(`가져오기 실패: ${error.message}`); }
  finally { event.target.value=''; renderPresets(); }
};
$('saveProject').onclick = () => { try { const url=URL.createObjectURL(new Blob([projectText()],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='project.yttproj'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); say('프로젝트 파일을 저장했습니다. 영상은 다시 선택해야 합니다.'); } catch(error) { say(`저장 실패: ${error.message}`); } };
$('projectFile').onchange = async event => { const file=event.target.files[0]; if (!file) return; try { restoreProject(decodeProject(await file.text())); markDirty(); } catch(error) { say(`프로젝트 열기 실패: ${error.message}`); } event.target.value=''; };
$('previous').onclick = () => { video.currentTime = Math.max(0, video.currentTime - 1 / Math.max(1,Number($('fps').value))); };
$('next').onclick = () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 1 / Math.max(1,Number($('fps').value))); };
$('zoom').oninput = () => render();
$('trackList').addEventListener('scroll',()=>{
  if (dragging || Math.abs($('trackList').scrollLeft-lastTimelineScroll)<80 || scrollFrame) return;
  scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;render(true);});
});
video.addEventListener('timeupdate',()=>{if(!video.requestVideoFrameCallback || video.paused)renderPlayback();});
video.addEventListener('loadedmetadata',()=>render()); video.addEventListener('seeked',()=>{renderPlayback();effectControls?.refresh();});
video.addEventListener('pause',()=>{playbackGeneration++;renderPlayback();effectControls?.refresh();});
video.addEventListener('play',()=>{
  if (!video.requestVideoFrameCallback) return;
  const generation=++playbackGeneration;
  const frame=()=>{if(generation!==playbackGeneration || video.paused)return;renderPlayback();video.requestVideoFrameCallback(frame);};
  video.requestVideoFrameCallback(frame);
});
function foldPanel(element,title) {
  const details=document.createElement('details');details.className='inspector-fold';
  const summary=document.createElement('summary');summary.textContent=title;details.append(summary);
  element.before(details);details.append(element);return details;
}
const cueDetails=document.createElement('details');cueDetails.className='inspector-fold';
const cueSummary=document.createElement('summary');cueSummary.textContent='자막 내용 · 시간';cueDetails.append(cueSummary);
const properties=$('properties');properties.prepend(cueDetails);
for(const node of [$('cueText').parentElement,textRunPanel,$('cueStart').parentElement,$('cueEnd').parentElement,$('apply'),duplicateCue,$('preserveInfo')])cueDetails.append(node);
foldPanel(stylePanel,'글꼴 · 색상 · 배경');
foldPanel(positionPanel,'고정 위치 · 기준점');
foldPanel($('effectPanel'),'단위별 효과 · 고급 설정');
foldPanel(motionPanel,'곡선 이동 경로');
foldPanel(presetPanel,'사용자 프리셋');
foldPanel(storagePanel,'데이터 저장 위치');
const comparisonPanel=document.querySelector('.comparison-panel');if(comparisonPanel)foldPanel(comparisonPanel,'화면 비교');
function currentTextSelection(cue) {
  if(!textSelection || textSelection.id!==cue.id || textSelection.text!==cue.text)return null;
  return planTextSelection(cue,textSelection.start,textSelection.end,textSelection.mode);
}
function overviewTextPlan(cue,mode) {
  if(!cue.text)return {units:[],indices:[]};
  const selection=currentTextSelection(cue);
  let units;
  if(mode==='character')units=planTextSelection(cue,0,cue.text.length,'character').units;
  else units=selection?.units ?? cue.units ?? [{text:cue.text}];
  let offset=0;const indices=[];
  units.forEach((unit,index)=>{const start=offset;offset+=unit.text.length;if(selection && start<selection.end && offset>selection.start)indices.push(index);});
  return {units,indices};
}
effectControls=createEffectControls({
  parent:properties,getCue:()=>selected,getTime:()=>Math.round(video.currentTime*1000),isEditable:cue=>cue===selected && canAnimateSelected() && !cue.style,
  getSelectionPlan:currentTextSelection,getOverviewPlan:overviewTextPlan,
  setTextSelection:(cue,start,end,mode)=>{textSelection=cue ? {id:cue.id,text:cue.text,start,end,mode} : null;},
  getBaseState:(cue,unit,time)=>{
    const base=cue.originalIndex==null && !hasGeneratedEffect(cue) ? {...cue,appearance:{backgroundOpacity:191}} : cue;
    const state=animatedStateAt(prepareCue(base),time);
    if(unit==='all')return state;
    const plan=unit==='selection'?currentTextSelection(cue):null;
    const part=unit==='selection'?plan?.units[plan.indices[0]]:cue.units?.[Number(unit)];if(!part)throw new Error('편집할 글자 단위를 찾을 수 없습니다.');
    const {position,...otherFrames}=part.keyframes ?? {};
    return animatedStateAt({appearance:{...state,...part.appearance},keyframes:otherFrames,delays:part.delays,defaultDelayMs:part.delayMs},time);
  },
  commitFrames:(cue,unit,property,frames,previous)=>{
    if(cue!==selected || !canAnimateSelected() || cue.style)throw new Error('이 자막은 효과를 편집할 수 없습니다.');
    if(unit==='all' && property==='position' && cue.motionPath)throw new Error('곡선 이동 경로를 먼저 제거하세요.');
    const next=structuredClone(cue);
    if(cue.originalIndex==null && !hasGeneratedEffect(cue) && frames.length)next.appearance={backgroundOpacity:191};
    if(unit==='all') {next.keyframes={...next.keyframes};if(frames.length)next.keyframes[property]=frames;else delete next.keyframes[property];}
    else if(unit==='selection') {
      const plan=currentTextSelection(cue);if(!plan)throw new Error('효과를 적용할 글자 범위를 다시 선택하세요.');
      next.units=applySelectionFrames(plan,property,previous,frames);next.unitPlan=null;
    } else {
      const part=next.units?.[Number(unit)];if(!part)throw new Error('편집할 글자 단위를 찾을 수 없습니다.');
      part.keyframes={...part.keyframes};if(frames.length)part.keyframes[property]=frames;else {delete part.keyframes[property];if(part.delays)delete part.delays[property];}
      next.unitPlan=null;
    }
    compileAnimatedYtt([prepareCue(next)],{quality:$('quality').value});
    recordEdit();cue.appearance=next.appearance;cue.keyframes=next.keyframes;cue.units=next.units;cue.unitPlan=next.unitPlan;previewCache.delete(cue.id);showProperties();render();markDirty();
  },
  seek:milliseconds=>{if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,milliseconds/1000));},notify:message=>say(message),
  openUnitSettings:()=>{const details=$('effectPanel').parentElement;details.open=true;$('effectScope').focus();details.scrollIntoView({block:'nearest'});}
});
$('cueText').addEventListener('select',()=>{
  const input=$('cueText');if(!selected || input.value!==selected.text || input.selectionStart===input.selectionEnd)return;
  try{effectControls.selectRange(selected,input.selectionStart,input.selectionEnd);}catch(error){say(`글자 선택 실패: ${error.message}`);}
});
new ResizeObserver(()=>{if(!dragging && !positionDrag)renderPlayback();}).observe($('stage'));
render();
fetch('/api/presets').then(async response=>{if(response.status!==404) { if(!response.ok)throw new Error(`서버 응답 ${response.status}`); presets=parsePresetLibrary(await response.text()); } presetsReady=true;}).catch(error=>say(`프리셋을 읽을 수 없습니다: ${error.message}`)).finally(renderPresets);
fetch('/api/recovery').then(async response => {
  if (response.status !== 404) {
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const project=decodeProject(await response.text());
    if (!recoveryDirty && window.confirm('이전 자동 저장본이 있습니다. 복구하시겠습니까?')) restoreProject(project);
  }
  recoveryReady=true;
  if (recoveryDirty) markDirty(); else recoveryStatus.textContent='자동 저장 준비 완료';
}).catch(error=>{
  recoveryFailed=true;
  recoveryStatus.textContent='자동 저장 중지';
  say(`기존 자동 저장본을 확인할 수 없어 덮어쓰기를 중지했습니다: ${error.message}. 프로젝트를 직접 저장하세요.`);
});
