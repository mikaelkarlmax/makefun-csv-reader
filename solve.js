// A fast drop-in replacement for csv-reader 1.0.0's readCsv: same input ({text, header}),
// same answer ({columns, rows, errors}) on every input, broken rows included — but built
// around native substring search instead of character-at-a-time concatenation.
//
// How it works, in one paragraph: the text is walked once, left to right, and a field's
// characters are never concatenated one by one — a plain field is scanned by one tight
// character loop that only inspects, then taken as a single slice (or, when a stray CR
// splits it, a few slices joined once). A quoted field is assembled from the slices
// between its quotes, found with String#indexOf, with CR/CRLF normalisation applied per
// slice and a character loop only for slices that actually contain a CR. Every scan is
// bounded by the characters it consumes, so no input shape — a text with no CRs, no LFs,
// no commas, or nothing but unclosed quotes — can turn the walk quadratic. Everything
// the reference reports — stray_cr, quote_junk, unterminated_quote, short_row, long_row,
// and the line and row each error belongs to — is reproduced exactly, in the order the
// reference meets them.

// Field endings, as small integers so the record loop compares numbers, not strings.
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // index of the next unread character
  let line = 1; // the 1-based line that character sits on
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // a leading BOM is dropped

  // The record currently being read: errors are reported against its start line and its
  // index in rows (null while it is the header record).
  let recLine = 1;
  let recRow = null;

  // The field most recently scanned, and how it ended.
  let fieldValue = '';
  let fieldEnd = AT_END;
  let kept = 0; // characters the last plain scan kept (dropped CRs do not count)

  function note(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // Scans one unquoted field starting at pos. `prefix` is text already belonging to the
  // field: '' normally, the quoted part when scanning quote junk, or '"' when a quoted
  // field turned out to be unterminated and its text is re-read as unquoted.
  // The walk is one tight character loop over the field's own characters — every
  // character of the text is visited a bounded number of times, so no input shape (a
  // file with no CRs, no LFs, or no commas at all) can make the scan quadratic — and
  // the field's characters are taken as slices, never concatenated one by one.
  function scanPlain(prefix) {
    kept = 0;
    let acc = null; // stays null on the fast path: the field is prefix + one slice;
    // a stray CR starts it, and the field's kept slices are concatenated onto it
    let seg = pos; // start of the not-yet-taken slice of this field
    let i = pos;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 44) { // ','
        kept += i - seg;
        fieldValue = (acc === null ? prefix : acc) + text.slice(seg, i);
        pos = i + 1;
        fieldEnd = AT_COMMA;
        return;
      }
      if (c === 10) { // LF: the record ends
        kept += i - seg;
        fieldValue = (acc === null ? prefix : acc) + text.slice(seg, i);
        pos = i + 1;
        line += 1;
        fieldEnd = AT_BREAK;
        return;
      }
      if (c === 13) { // CR
        if (text.charCodeAt(i + 1) === 10) { // CRLF: the record ends
          kept += i - seg;
          fieldValue = (acc === null ? prefix : acc) + text.slice(seg, i);
          pos = i + 2;
          line += 1;
          fieldEnd = AT_BREAK;
          return;
        }
        // A CR not followed by LF, outside quotes: dropped, reported, the field goes on.
        note('stray_cr');
        acc = (acc === null ? prefix : acc) + text.slice(seg, i);
        kept += i - seg;
        i += 1;
        seg = i;
        continue;
      }
      i += 1;
    }
    // No delimiter left: the rest of the text is the field.
    kept += len - seg;
    fieldValue = (acc === null ? prefix : acc) + text.slice(seg);
    pos = len;
    fieldEnd = AT_END;
  }

  // One bounded pass over text[a..b] — a slice of the inside of a quoted field, between
  // two quotes: counts the slice's LFs into the line count and reports whether it holds
  // a CR at all. The pass never leaves the slice, so its cost stays proportional to the
  // characters the field itself consumes.
  function scanInside(a, b) {
    let hasCr = false;
    for (let j = a; j < b; j++) {
      const c = text.charCodeAt(j);
      if (c === 10) line += 1;
      else if (c === 13) hasCr = true;
    }
    return hasCr;
  }

  // Builds text[a..b] with every CRLF and every lone CR read as one LF, as quoted
  // contents are read. Only called for slices scanInside found a CR in; the LFs are
  // already counted by that pass, so here a CRLF adds no line (its LF was counted)
  // and a lone CR adds the one line no other pass counted.
  function normaliseInside(a, b) {
    let out = '';
    let k = a;
    while (k < b) {
      const c = text.charCodeAt(k);
      if (c === 13) {
        out += '\n';
        if (text.charCodeAt(k + 1) === 10) k += 2;
        else { line += 1; k += 1; }
      } else {
        out += text[k];
        k += 1;
      }
    }
    return out;
  }

  // Appends the inside slice text[a..b] to chunks, normalised if it holds a CR.
  function pushInside(chunks, a, b) {
    if (a >= b) return;
    chunks.push(scanInside(a, b) ? normaliseInside(a, b) : text.slice(a, b));
  }

  // Scans one quoted field; pos is on its opening quote.
  function scanQuoted() {
    const openPos = pos;
    const openLine = line;
    let chunks = null; // allocated only when a doubled quote splits the field
    let seg = pos + 1; // start of the current inside slice
    let i = pos + 1;
    for (;;) {
      const iq = text.indexOf('"', i);
      if (iq === -1) {
        // The quote never closes: it is a literal character, the line count rewinds, and
        // the text after it is read again as an unquoted field starting with that quote.
        pos = openPos + 1;
        line = openLine;
        note('unterminated_quote');
        scanPlain('"');
        return;
      }
      if (text.charCodeAt(iq + 1) === 34) {
        // A doubled quote inside the field is one literal quote.
        if (chunks === null) chunks = [];
        pushInside(chunks, seg, iq);
        chunks.push('"');
        i = iq + 2;
        seg = i;
        continue;
      }
      // The closing quote. The common field is a single slice: take it directly,
      // with no chunk array and no join.
      if (chunks === null) {
        fieldValue = scanInside(seg, iq) ? normaliseInside(seg, iq) : text.slice(seg, iq);
      } else {
        pushInside(chunks, seg, iq);
        fieldValue = chunks.join('');
      }
      pos = iq + 1;
      if (pos >= len) { fieldEnd = AT_END; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; fieldEnd = AT_COMMA; return; }
      if (c === 10) { pos += 1; line += 1; fieldEnd = AT_BREAK; return; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fieldEnd = AT_BREAK; return; }
      // Anything else after the closing quote is junk, appended as it stands up to the
      // next comma or line break; it is reported when the field ends, if any was kept.
      scanPlain(fieldValue);
      if (kept > 0) note('quote_junk');
      return;
    }
  }

  for (;;) {
    // A line left with no characters is no record: skip bare LF and CRLF line breaks.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) scanQuoted();
      else scanPlain('');
      fields.push(fieldValue);
    } while (fieldEnd === AT_COMMA);

    // A line that held nothing but stray CRs leaves a single empty unquoted field:
    // it is no record (its stray_cr errors, already noted, stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
