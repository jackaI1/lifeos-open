import {journalSectionHeading} from './journal-structure.mjs';
import { createHash } from 'node:crypto';
import {parseSelectedPassage} from '../../public/bible.js';

export const JOURNAL_IMPORT_SCHEMA = 1;
export const JOURNAL_QUESTIONS = Object.freeze([
  'What does this passage say?',
  'What did this passage mean to its original audience?',
  'What does this passage tell us about God?',
  'What does this passage tell us about man?',
  'What does this passage demand of me?',
  'How does this passage change the way I relate to people?',
  'How does this passage prompt me to pray?',
]);

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value.replace(/\r\n?/g, '\n');
const clean = value => value.trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
const questionKey = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const questionKeys = JOURNAL_QUESTIONS.map(questionKey);
const books = 'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|[12] Samuel|[12] Kings|[12] Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of (?:Solomon|Songs)|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|[12] Corinthians|Galatians|Ephesians|Philippians|Colossians|[12] Thessalonians|[12] Timothy|Titus|Philemon|Hebrews|James|[12] Peter|[123] John|Jude|Revelation';
const passagePattern = new RegExp(`^(?:${books})\\s+\\d{1,3}(?::\\d{1,3})?(?:\\s*[-–]\\s*\\d{1,3}(?::\\d{1,3})?)?(?:\\s*[,;+]\\s*\\d{1,3}(?::\\d{1,3})?(?:\\s*[-–]\\s*\\d{1,3}(?::\\d{1,3})?)?)*$`, 'i');
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function isoDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function explicitDate(text) {
  const candidate = text.replace(/^date\s*:\s*/i, '').trim();
  let match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return { candidate, value: isoDate(Number(match[1]), Number(match[2]), Number(match[3])) };
  match = candidate.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (match && months.includes(match[1].toLowerCase())) return { candidate, value: isoDate(Number(match[3]), months.indexOf(match[1].toLowerCase()) + 1, Number(match[2])) };
  if (/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(candidate) || /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}$/i.test(candidate)) return { candidate, value: null };
  return null;
}

function passage(text) {
  const bracketed=text.trim().match(/^\[([^\]]+)\](?:\s|$)/);
  const candidate = (bracketed?.[1]??text).trim().replace(/^\[|\]$/g, '').trim();
  return passagePattern.test(candidate) ? candidate : parseSelectedPassage(candidate)?.passage??null;
}

function heading(line) {
  const text = clean(line.text);
  if (text.length > 250) return null;
  if(journalSectionHeading(text,line.native?.namedStyleType))return {type:'section',label:text};
  const day = text.match(/^day\s+(\d{1,5})\s*[:.\-]?\s*(.*)$/i);
  if (day) return { type: 'entry', label: text, dayNumber: Number(day[1]), passage: passage(day[2]), date: null, dateCandidate: null, flags: day[2] && !passage(day[2]) ? ['unparsed-heading-detail'] : [] };
  const date = explicitDate(text);
  if (date) return { type: 'entry', label: text, dayNumber: null, passage: null, date: date.value, dateCandidate: date.candidate, flags: date.value ? [] : ['ambiguous-or-invalid-date'] };
  const reference = passage(text);
  if (reference) return { type: 'entry', label: text, dayNumber: null, passage: reference, date: null, dateCandidate: null, flags: ['standalone-passage-boundary'] };
  if (line.native?.namedStyleType === 'TITLE' && text) return { type: 'section', label: text };
  return null;
}

function authorHeading(text) {
  const value = clean(text);
  const suffix = "(?:['’]s)?\\s*(?:(?:thoughts?|devotions?|devo|entries|entry|reflections?|points?|responses?|notes?|answers?|reading)\\s*)?[:：]?";
  const match = value.match(new RegExp(`^(Alex(?: Alex)?|Adam(?: Chua)?)${suffix}$`, 'i'));
  if (match) return { name: /^Alex/i.test(match[1]) ? 'Alex' : 'Adam', basis: 'explicit', label: value };
  if (/^(?:Alex|adam).{0,25}(?:Alex|adam)(?:.{0,20})?[:：]?$/i.test(value) || /^[A-Z][A-Za-z]+['’]s\s+(?:thoughts?|devotions?|reflections?|points?|notes?|answers?)\s*[:：]?$/i.test(value)) return { name: null, basis: 'ambiguous', label: value };
  return null;
}

function prepareSource({ text, paragraphs }) {
  if (text !== undefined && paragraphs !== undefined) throw new TypeError('Supply text or native paragraphs, not both.');
  let nativeRanges = [];
  if (paragraphs !== undefined) {
    if (!Array.isArray(paragraphs) || paragraphs.length > 100_000 || paragraphs.some(p => !p || typeof p.text !== 'string')) throw new TypeError('Invalid native paragraphs.');
    let offset = 0;
    text = paragraphs.map((p, index) => {
      const value = p.text + (index < paragraphs.length - 1 && !/[\r\n]$/.test(p.text) ? '\n' : '');
      nativeRanges.push({ start: offset, end: offset + value.length, paragraph: p });
      offset += value.length;
      return value;
    }).join('');
  }
  if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new TypeError('Journal text must be a string no larger than 16 MiB.');
  const lines = [];
  let nativeIndex = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    while (nativeIndex < nativeRanges.length && nativeRanges[nativeIndex].end <= match.index) nativeIndex++;
    lines.push({ text: match[0].replace(/[\r\n]+$/, ''), start: match.index, end: match.index + match[0].length, number: lines.length + 1, native: nativeRanges[nativeIndex]?.paragraph || null });
  }
  return { text, lines };
}

function parsePoints(lines, rawText, start) {
  const markers = [];
  const canonicalMarkers = [];
  const numericMarkers = [];
  for (const line of lines) {
    const text = clean(line.text);
    const numeric = text.match(/^(\d{1,5})[.),]\s*(.*)$/);
    const content = numeric ? numeric[2] : text;
    const index = questionKeys.indexOf(questionKey(content));
    if (index >= 0) canonicalMarkers.push({ line, slot: index + 1, label: content, inline: '', basis: 'question' });
    else if (numeric) numericMarkers.push({ line, slot: Number(numeric[1]), label: numeric[1], inline: numeric[2], basis: 'number' });
  }
  const nativeSeen=new Set(),nativeMarkers=[];
  for(const line of lines){const n=line.native,text=clean(line.text);if(!n?.isListItem||n.listGlyphType!=='DECIMAL'||n.listNestingLevel>0||!text||/^amen[.!]?$/i.test(text)||nativeSeen.has(n.startIndex))continue;nativeSeen.add(n.startIndex);nativeMarkers.push({line,slot:nativeMarkers.length+1,label:String(nativeMarkers.length+1),inline:text.replace(/^\d{1,5}[.),]\s*/,''),basis:'native-numbered-list'});}
  const nativeSeven=!canonicalMarkers.length&&nativeMarkers.length===7;
  const globalSequence=!canonicalMarkers.length&&numericMarkers.length===7&&numericMarkers[0].slot>7&&numericMarkers.every((m,i)=>m.slot===numericMarkers[0].slot+i);
  markers.push(...(canonicalMarkers.length ? canonicalMarkers : nativeSeven?nativeMarkers:globalSequence?numericMarkers.map((m,i)=>({...m,sourceNumber:m.slot,slot:i+1})):numericMarkers));
  const flags = [];
  if(globalSequence)flags.push('global-numbering-mapped-to-seven-points');
  if (!canonicalMarkers.length && numericMarkers.length) flags.push('numbering-only-interpretation');
  const sections = markers.map((marker, index) => {
    const end = markers[index + 1]?.line.start ?? (start + rawText.length);
    const body = rawText.slice(marker.line.end - start, end - start).trim();
    return { slot: marker.slot, ...(marker.sourceNumber?{sourceNumber:marker.sourceNumber}:{}), basis: marker.basis, label: marker.label, text: [marker.inline, body].filter(Boolean).join('\n'), rawText: rawText.slice(marker.line.start - start, end - start), span: { start: marker.line.start, end } };
  });
  const points = Array(7).fill('');
  const seen = new Set();
  for (const section of sections) {
    if (section.slot < 1 || section.slot > 7) { flags.push('out-of-range-numbering'); continue; }
    if (seen.has(section.slot)) flags.push('repeated-point-label');
    seen.add(section.slot);
    points[section.slot - 1] += (points[section.slot - 1] ? '\n\n' : '') + section.text;
  }
  if (sections.some((section, index) => index > 0 && section.slot <= sections[index - 1].slot)) flags.push('irregular-point-order');
  if (sections.length && points.every(point => !point.trim())) flags.push('blank-template');
  if (!sections.length) flags.push('unstructured-writing');
  if (seen.size !== 7) flags.push('incomplete-point-structure');
  return { points, pointSections: sections, flags };
}

/** Pure parser. It neither writes source documents nor treats imported text as instructions. */
export function parseJournal({ text, paragraphs, sourceId, sourceRevision = null }) {
  if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 500) throw new TypeError('A bounded sourceId is required.');
  if (sourceRevision !== null && (typeof sourceRevision !== 'string' || sourceRevision.length > 1_000)) throw new TypeError('Invalid source revision.');
  const prepared = prepareSource({ text, paragraphs });
  const source = { id: sourceId, revision: sourceRevision, sha256: hash(prepared.text), length: prepared.text.length, offsetEncoding: 'utf16', representation: paragraphs ? 'native-paragraph-text-with-newline-separators' : 'supplied-text' };
  const segments = [];
  let context = null;
  let section = null;
  let segment = { start: 0, kind: 'source-note', context, section, author: { name: 'Alex', basis: 'default', label: null }, lines: [], body: false };
  const flush = end => {
    if (end > segment.start) segments.push({ ...segment, end });
  };
  for (const line of prepared.lines) {
    const found = heading(line);
    const author = authorHeading(line.text);
    if (found) {
      // An explicit date directly followed by a passage is one entry heading.
      if (found.type === 'entry' && found.passage && context?.dateCandidate && !segment.body && !context.passage) {
        context = { ...context, passage: found.passage };
        segment.context = context;
        segment.lines.push(line);
        continue;
      }
      flush(line.start);
      if (found.type === 'section') { section = found.label; context = null; }
      else context = found;
      segment = { start: line.start, kind: found.type === 'entry' ? 'journal-entry' : 'source-note', context, section, author: { name: 'Alex', basis: 'default', label: null }, lines: [line], body: false };
    } else if (author) {
      if (segment.body || segment.kind === 'source-note') {
        flush(line.start);
        segment = { start: line.start, kind: 'journal-entry', context, section, author, lines: [line], body: false };
      } else { segment.author = author; segment.lines.push(line); }
    } else {
      segment.lines.push(line);
      if (line.text.trim()) segment.body = true;
    }
  }
  flush(prepared.text.length);
  const occurrences = new Map();
  const entries = segments.map(part => {
    const rawText = prepared.text.slice(part.start, part.end);
    const parsed = parsePoints(part.lines, rawText, part.start);
    const contentHash = hash(canonical(rawText));
    const identity = hash(JSON.stringify([sourceId, part.kind, part.context?.label || null, part.context?.date || null, part.context?.passage || null, part.author.name, part.author.basis, contentHash]));
    const occurrence = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, occurrence);
    const flags = new Set([...(part.context?.flags || []), ...parsed.flags]);
    if (!part.context?.date) flags.add('unknown-date');
    if (!part.context?.passage) flags.add('unknown-passage');
    if (part.author.basis === 'ambiguous') flags.add('ambiguous-author');
    if (part.author.basis === 'default') flags.add('author-defaulted-to-Alex');
    if (part.kind === 'source-note') flags.add('source-note-not-confirmed-entry');
    const nativeSpans = [...new Set(part.lines.map(line => line.native).filter(Boolean))].map(p => ({ startIndex: p.startIndex ?? null, endIndex: p.endIndex ?? null, tabId: p.tabId ?? null, namedStyleType: p.namedStyleType ?? null, isListItem: Boolean(p.isListItem) }));
    return {
      id: `import_${identity.slice(0, 32)}_${occurrence}`,
      kind: part.kind, sourceId, sourceRevision, sourceHash: source.sha256, contentHash, occurrence,
      span: { start: part.start, end: part.end, lineStart: part.lines[0]?.number ?? 1, lineEnd: part.lines.at(-1)?.number ?? 1 },
      nativeSpans, rawText, author: part.author,
      date: part.context?.date || null, dateCandidate: part.context?.dateCandidate || null,
      passage: part.context?.passage || null, sourceHeading: part.context?.label || null, sourceSection: part.section,
      sourceDayNumber: part.context?.dayNumber ?? null,
      points: parsed.points, pointSections: parsed.pointSections, flags: [...flags],
      imported: true, archiveEligible: false, complete: false, completionStatus: 'historical-unconfirmed',
    };
  });
  return { schemaVersion: JOURNAL_IMPORT_SCHEMA, source, entries, diagnostics: { entries: entries.filter(e => e.kind === 'journal-entry').length, sourceNotes: entries.filter(e => e.kind === 'source-note').length, ambiguousAuthors: entries.filter(e => e.author.basis === 'ambiguous').length, unknownDates: entries.filter(e => !e.date).length, preservedLength: entries.reduce((n,e) => n + e.rawText.length, 0) } };
}

/** Repeat imports upsert stable IDs. Missing/changed source material never authorizes deletion. */
export function planJournalImport({ parsed, previousEntries = [] }) {
  if (parsed?.schemaVersion !== JOURNAL_IMPORT_SCHEMA || !Array.isArray(parsed.entries) || !Array.isArray(previousEntries)) throw new TypeError('Invalid import plan input.');
  const prior = new Map(previousEntries.filter(entry => entry.sourceId === parsed.source.id).map(entry => [entry.id, entry]));
  const current = new Set(parsed.entries.map(entry => entry.id));
  return {
    source: parsed.source,
    insert: parsed.entries.filter(entry => !prior.has(entry.id)),
    refresh: parsed.entries.filter(entry => prior.has(entry.id)),
    missingPreviousIds: [...prior.keys()].filter(id => !current.has(id)),
    delete: [],
    archive: [],
    requiresReview: [...prior.keys()].some(id => !current.has(id)),
  };
}
