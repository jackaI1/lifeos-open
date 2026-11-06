"""A local SQLite index of named source intervals, with reproducible rough cuts."""
import os
import sqlite3
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import List, Optional

from .captions import read_srt
from .edits import Edit
from .media import FORMATS, export_clips, run_ffmpeg, validate_source


class Catalogue:
    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connection(self):
        # The sqlite transaction context manager commits/rolls back but does not close.
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        try:
            con.execute('PRAGMA foreign_keys=ON')
            con.executescript('''
                CREATE TABLE IF NOT EXISTS clips (
                    id INTEGER PRIMARY KEY, source TEXT NOT NULL, name TEXT NOT NULL,
                    start REAL NOT NULL, end REAL NOT NULL, captions TEXT,
                    UNIQUE(source, name), CHECK(start >= 0 AND end > start)
                );
                CREATE TABLE IF NOT EXISTS tags (
                    clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
                    tag TEXT NOT NULL, PRIMARY KEY(clip_id, tag)
                );
                CREATE INDEX IF NOT EXISTS tags_by_name ON tags(tag);
            ''')
            with con:
                yield con
        finally:
            con.close()

    def add(self, source: Path, edits: List[Edit], captions: Optional[Path] = None) -> List[int]:
        source = Path(source).resolve()
        validate_source(source, edits)
        caption_path = str(Path(captions).resolve()) if captions else None
        if caption_path:
            read_srt(Path(caption_path))
        ids = []
        with self.connection() as con:
            for edit in edits:
                con.execute('''INSERT INTO clips(source, name, start, end, captions) VALUES(?,?,?,?,?)
                            ON CONFLICT(source,name) DO UPDATE SET start=excluded.start, end=excluded.end,
                            captions=excluded.captions''', (str(source), edit.name, edit.start, edit.end, caption_path))
                clip_id = con.execute('SELECT id FROM clips WHERE source=? AND name=?', (str(source), edit.name)).fetchone()[0]
                con.execute('DELETE FROM tags WHERE clip_id=?', (clip_id,))
                con.executemany('INSERT INTO tags(clip_id,tag) VALUES(?,?)', [(clip_id, t) for t in edit.tags])
                ids.append(clip_id)
        return ids

    @staticmethod
    def record(con, row):
        result = dict(row)
        result['tags'] = [r[0] for r in con.execute('SELECT tag FROM tags WHERE clip_id=? ORDER BY tag', (row['id'],))]
        return result

    def search(self, query: str = '', tag: str = '') -> List[dict]:
        # Escape LIKE wildcards: a search for 100% means those literal characters.
        literal = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        pattern = '%' + literal + '%'
        with self.connection() as con:
            rows = con.execute('''SELECT c.* FROM clips c WHERE
                (c.name LIKE ? ESCAPE '\\' OR EXISTS
                 (SELECT 1 FROM tags t WHERE t.clip_id=c.id AND t.tag LIKE ? ESCAPE '\\'))
                AND (?='' OR EXISTS (SELECT 1 FROM tags t WHERE t.clip_id=c.id AND t.tag=?))
                ORDER BY c.id''', (pattern, pattern, tag, tag.strip().lower())).fetchall()
            return [self.record(con, row) for row in rows]

    def select(self, ids: List[int]) -> List[dict]:
        if not ids:
            raise ValueError('Choose at least one catalogue ID')
        with self.connection() as con:
            records = []
            for clip_id in ids:
                row = con.execute('SELECT * FROM clips WHERE id=?', (clip_id,)).fetchone()
                if row is None:
                    raise ValueError(f'Catalogue clip ID {clip_id} does not exist')
                records.append(self.record(con, row))
            return records


def rough_cut(catalogue: Catalogue, ids: List[int], output: Path, shape: str = 'widescreen', fit: str = 'pad') -> Path:
    if shape not in FORMATS or fit not in ('pad', 'crop'):
        raise ValueError('Choose a supported format and pad or crop')
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(f'Output already exists: {output}')
    records = catalogue.select(ids)
    # Preflight every source and caption file before encoding any of the selected clips.
    for row in records:
        validate_source(Path(row['source']), [Edit(row['name'], row['start'], row['end'])])
        if row['captions']:
            read_srt(Path(row['captions']))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.rough-cut-', dir=output.parent) as tmp:
        work = Path(tmp)
        parts = []
        for index, row in enumerate(records):
            edit = Edit(row['name'], row['start'], row['end'])
            part = export_clips(Path(row['source']), [edit], work / str(index),
                                Path(row['captions']) if row['captions'] else None, [shape], fit)[0]
            parts.append(f"file '{part.relative_to(work).as_posix()}'")
        (work / 'concat.txt').write_text('\n'.join(parts) + '\n', encoding='utf-8')
        target = work / 'rough.mp4'
        run_ffmpeg(['-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy',
                    '-map_metadata', '-1', '-movflags', '+faststart', str(target)], cwd=work)
        os.link(target, output)
    return output
