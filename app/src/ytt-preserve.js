/** Apply non-overlapping text edits without rewriting unrelated XML. */
export function applyEdits(source, edits) {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let result = '';
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) ||
        edit.start < cursor || edit.end < edit.start || edit.end > source.length ||
        typeof edit.text !== 'string') {
      throw new RangeError('Invalid or overlapping source edit');
    }
    result += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}

export function escapeXmlAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
