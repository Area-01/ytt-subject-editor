export function encodeProject({tracks, originalYtt, videoName, quality}) {
  const project={format:'ytt-editor-project',version:1,tracks,originalYtt:originalYtt ?? null,videoName:videoName ?? null,quality:quality ?? 'optimized'};
  validateProject(project);
  return JSON.stringify(project,null,2);
}

export function validateProject(project) {
  if (!project || project.format !== 'ytt-editor-project' || project.version !== 1 || !Array.isArray(project.tracks) || project.tracks.length === 0 || project.tracks.length > 1000) throw new Error('지원하지 않는 프로젝트 형식입니다.');
  if (project.originalYtt != null && typeof project.originalYtt !== 'string') throw new Error('원본 자막 데이터가 올바르지 않습니다.');
  if (project.videoName != null && typeof project.videoName !== 'string') throw new Error('영상 참조가 올바르지 않습니다.');
  if (!['optimized','high'].includes(project.quality)) throw new Error('출력 품질 설정이 올바르지 않습니다.');
  const ids=new Set();
  for (const track of project.tracks) {
    if (!track || typeof track.name !== 'string' || !Array.isArray(track.cues)) throw new Error('트랙 정보가 올바르지 않습니다.');
    if ((track.locked != null && typeof track.locked !== 'boolean') || (track.hidden != null && typeof track.hidden !== 'boolean')) throw new Error('트랙 잠금 또는 표시 설정이 올바르지 않습니다.');
    for (const cue of track.cues) {
      if (!cue || !Number.isSafeInteger(cue.id) || cue.id < 1 || ids.has(cue.id) || !Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== 'string') throw new Error('자막 정보가 올바르지 않습니다.');
      ids.add(cue.id);
      if (project.originalYtt && cue.originalIndex != null && (!Number.isSafeInteger(cue.originalIndex) || cue.originalIndex < 0 || !Number.isSafeInteger(cue.originalStart) || !Number.isSafeInteger(cue.originalEnd))) throw new Error('원본 YTT 참조가 올바르지 않습니다.');
    }
  }
  return project;
}

export function decodeProject(text) {
  let parsed;
  try { parsed=JSON.parse(text); } catch { throw new Error('프로젝트 파일을 읽을 수 없습니다.'); }
  return validateProject(parsed);
}
