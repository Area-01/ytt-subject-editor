function timeMs(text, ass = false) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(text.trim());
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error(`잘못된 시간: ${text}`);
  const fraction = ass ? Number(match[4].padEnd(3, '0')) : Number(match[4].padEnd(3, '0'));
  return ((+match[1] * 60 + +match[2]) * 60 + +match[3]) * 1000 + fraction;
}

function checkRange(start, end) {
  if (end <= start) throw new Error('자막 종료 시간은 시작 시간보다 뒤여야 합니다.');
}

export function importSrt(input) {
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!source) return { cues: [], warnings: [] };
  const cues = source.split(/\n[\t ]*\n+/).map((block, index) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const timing = /^(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/.exec(lines.shift() ?? '');
    if (!timing) throw new Error(`${index + 1}번째 SRT 자막의 시간 형식이 잘못되었습니다.`);
    const start = timeMs(timing[1]), end = timeMs(timing[2]);
    checkRange(start, end);
    return { start, end, text: lines.join('\n'), style: null, layer: 0 };
  });
  return { cues, warnings: [] };
}

function fields(line, names) {
  // Text may contain commas; ASS events require it as the final field.
  const result = {};
  let rest = line;
  for (let i = 0; i < names.length; i++) {
    const comma = i === names.length - 1 ? -1 : rest.indexOf(',');
    if (comma < 0 && i !== names.length - 1) throw new Error('ASS 필드 수가 부족합니다.');
    result[names[i]] = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    rest = comma < 0 ? '' : rest.slice(comma + 1);
  }
  return result;
}

function assColor(raw) {
  const match = /^&H([0-9a-f]{1,8})&?$/i.exec(raw ?? '');
  if (!match) return null;
  const hex = match[1].padStart(8, '0');
  return { color: `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}`.toUpperCase(), opacity: 255 - parseInt(hex.slice(0, 2), 16) };
}

export function importAss(input) {
  const warnings = new Set();
  const styles = new Map();
  const cues = [];
  let section = '', styleFormat = null, eventFormat = null;
  for (const original of input.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = original.trim();
    if (!line || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1].toLowerCase(); continue; }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (section.includes('styles')) {
      if (key === 'format') styleFormat = value.split(',').map(x => x.trim().toLowerCase());
      if (key === 'style') {
        if (!styleFormat) throw new Error('ASS 스타일 Format이 없습니다.');
        const item = fields(value, styleFormat);
        styles.set(item.name, { font: item.fontname ?? null, size: Number(item.fontsize) || null,
          bold: Number(item.bold || 0) !== 0, italic: Number(item.italic || 0) !== 0,
          underline: Number(item.underline || 0) !== 0, foreground: assColor(item.primarycolour),
          outline: assColor(item.outlinecolour), shadow: assColor(item.backcolour),
          outlineWidth: Number(item.outline || 0), shadowDistance: Number(item.shadow || 0),
          alignment: Number(item.alignment) || null,
          margins: [Number(item.marginl || 0),Number(item.marginr || 0),Number(item.marginv || 0)] });
      }
    } else if (section === 'events') {
      if (key === 'format') eventFormat = value.split(',').map(x => x.trim().toLowerCase());
      if (key === 'dialogue') {
        if (!eventFormat || eventFormat.at(-1) !== 'text') throw new Error('ASS 이벤트 Format의 마지막 필드는 Text여야 합니다.');
        const item = fields(value, eventFormat);
        const start = timeMs(item.start, true), end = timeMs(item.end, true);
        checkRange(start, end);
        let text = item.text;
        if (/\{[^}]*\\[^}]*\}/.test(text)) {
          warnings.add('ASS 인라인 태그와 애니메이션·가라오케 효과는 가져오지 않았습니다.');
          text = text.replace(/\{[^}]*\}/g, '');
        }
        text = text.replace(/\\[Nn]/g, '\n').replace(/\\h/g, '\u00a0');
        if (item.effect) warnings.add('ASS 이벤트 효과는 가져오지 않았습니다.');
        if ([item.marginl,item.marginr,item.marginv].some(value=>Number(value || 0)!==0)) warnings.add('ASS 자막별 여백은 유튜브 위치에 정확히 적용되지 않습니다.');
        if (item.style && !styles.has(item.style)) warnings.add(`ASS 스타일을 찾을 수 없습니다: ${item.style}`);
        cues.push({ start, end, text, style: styles.get(item.style) ?? null, layer: Number(item.layer) || 0 });
      }
    }
  }
  const defaultEntry=[...styles.entries()].find(([name])=>name?.toLowerCase()==='default');
  const baseSize=defaultEntry?.[1].size ?? styles.values().next().value?.size ?? null;
  for (const cue of cues) if (cue.style) cue.style.baseSize=baseSize;
  return { cues, warnings: [...warnings] };
}
