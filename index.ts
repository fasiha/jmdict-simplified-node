import Sqlite, { type Database as Db, type Statement } from "better-sqlite3";
import { promises as pfs } from "fs";

import type { Simplified, Word, Xref } from "./interfaces";
export * from "./interfaces";

export type SetupType = {
  db: Db;
  dictDate: string;
  version: string;
  tags: Simplified["tags"];
};

const tokenize = (s: string) => s.split("").join(" ");

type Statements = Record<
  | "get"
  | "countExact"
  | "ftsKanjis"
  | "ftsKanas"
  | "idToWord"
  | "getTags"
  | "getField",
  Statement
>;
const allStatements = new WeakMap<Db, Statements>();
function statements(db: Db): Statements {
  let hit = allStatements.get(db);
  if (!hit) {
    const ftsString = `SELECT entries.entry_json FROM {{template}}
           JOIN entries ON {{template}}.entry_id = entries.id
           WHERE {{template}}.text MATCH ?
           GROUP BY entries.id LIMIT ? OFFSET ?`

    hit = {
      get: db
        .prepare(
          `SELECT entries.entry_json FROM raws
           JOIN entries ON raws.entry_id = entries.id
           WHERE raws.text LIKE ?
           GROUP BY entries.id LIMIT ? OFFSET ?`,
        )
        .pluck(),
      countExact: db
        .prepare(
          `SELECT COUNT(DISTINCT entries.id) FROM raws
            JOIN entries ON raws.entry_id = entries.id
            WHERE raws.text = ?`,
        )
        .pluck(),
      ftsKanjis: db
        .prepare(ftsString.replace(/{{template}}/g, "kanjis"))
        .pluck(),
      ftsKanas: db
        .prepare(ftsString.replace(/{{template}}/g, "kanas"))
        .pluck(),
      idToWord: db
        .prepare(`SELECT entry_json FROM entries WHERE id = ?`)
        .pluck(),
      getTags: db
        .prepare(`SELECT value_json FROM metadata WHERE key = 'tags'`)
        .pluck(),
      getField: db
        .prepare(`SELECT value_json FROM metadata WHERE key = ?`)
        .pluck(),
    };
    allStatements.set(db, hit);
  }
  return hit;
}

export async function setup(dbpath: string, filename = ""): Promise<SetupType> {
  const db = new Sqlite(dbpath);
  db.pragma("journal_mode = WAL");

  db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT UNIQUE,
    value_json TEXT NOT NULL
  );
`);

  // Check if the DB is already populated.
  const getMetaStmt = db
    .prepare("SELECT value_json FROM metadata WHERE key = ?")
    .pluck();
  const get = (s: string) => JSON.parse(getMetaStmt.get(s) as string);
  try {
    return {
      db,
      // if there's no data or if it's mal-formed, this will throw.
      // If that happens, we fall through to re-populating the DB.
      version: get("version"),
      dictDate: get("dictDate"),
      tags: get("tags"),
    };
  } catch (e) {
    // SyntaxError means JSON.parse failed, which is fine!
    if (!(e instanceof SyntaxError)) {
      // Any other error is not fine
      throw e;
    }
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT UNIQUE,
    entry_json TEXT NOT NULL
  );
`);

  db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS kanjis USING fts5(
    text,
    entry_id UNINDEXED,
    tokenize = 'unicode61'
  );
`);

  db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS kanas USING fts5(
    text,
    entry_id UNINDEXED,
    tokenize = 'unicode61'
  );
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS raws (
    text TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    UNIQUE(text, entry_id)
  );
`);

  const data: Simplified = await (async () => {
    // The main reason to do this processing in a function is
    // so the contents of the file can be garbage-collected.

    // filename provided?
    if (!filename) {
      console.error(
        "database not found but cannot create it if no `filename` given"
      );
      process.exit(1);
    }

    // file can be read?
    let contents: string = "";
    try {
      contents = await pfs.readFile(filename, "utf8");
    } catch {
      console.error(
        `Unable to find ${filename}, download it from https://github.com/scriptin/jmdict-simplified`
      );
      process.exit(1);
    }

    // file can be parsed?
    return JSON.parse(contents) as Simplified;
  })();

  const insertMeta = db.prepare(
    "INSERT INTO metadata (key, value_json) VALUES (?, ?)"
  );
  const insertEntry = db.prepare(
    "INSERT INTO entries (id, entry_json) VALUES (?, ?)"
  );
  const insertKanji = db.prepare(
    "INSERT INTO kanjis (entry_id, text) VALUES (?, ?)"
  );
  const insertKana = db.prepare(
    "INSERT INTO kanas (entry_id, text) VALUES (?, ?)"
  );
  const insertRaw = db.prepare(
    "INSERT INTO raws (entry_id, text) VALUES (?, ?)"
  );

  for (const key in data) {
    if (key !== "words") {
      insertMeta.run(
        key,
        JSON.stringify((data as unknown as Record<string, unknown>)[key])
      );
    }
  }

  for (const entry of data.words) {
    insertEntry.run(entry.id, JSON.stringify(entry));

    for (const k of entry.kanji) {
      insertKanji.run(entry.id, tokenize(k.text));
      insertRaw.run(entry.id, k.text);
    }

    for (const k of entry.kana) {
      insertKana.run(entry.id, tokenize(k.text));
      insertRaw.run(entry.id, k.text);
    }
  }

  return {
    db,
    version: data.version,
    dictDate: data.dictDate,
    tags: data.tags,
  };
}

interface FtsArgs {
  db: Db;
  text: string;
  /**
   * If true, search kanji (otherwise kana/reading).
   */
  kanji: boolean;
  /**
   * If true, only match at the beginning of the word.
   * Else, ok to match in the middle.
   */
  beginning: boolean;
  /**
   * If true, do a fuzzy search where each unique character
   * in `text` will be present somewhere in the match.
   *
   * Else, `text` must be found exactly in the word.
   */
  fuzzy?: boolean;
  limit?: number;
  offset?: number;
}
function fts({
  db,
  text,
  kanji,
  beginning,
  fuzzy = false,
  limit = -1,
  offset = 0,
}: FtsArgs): Word[] {
  if (!text) {
    return [];
  }

  if (beginning && !fuzzy) {
    return get(db, `${text}%`, { exact: false, limit, offset });
  }

  const ftsStmt = kanji
    ? statements(db).ftsKanjis
    : statements(db).ftsKanas;

  const tokenized = fuzzy ? tokenize(text) : `"${tokenize(text)}"`;
  const token = beginning ? `^${tokenized}*` : tokenized;
  const raws = ftsStmt.all(token, limit, offset) as string[];
  return raws.map((r) => JSON.parse(r) as Word);
}

interface GetExtra {
  /**
   * If true (default), `text` must match exactly. If false, `text` is treated
   * as a prefix and any entry starting with `text` is returned.
   */
  exact?: boolean;
  limit?: number;
  offset?: number;
}
export function get(
  db: Db,
  text: string,
  { exact = true, limit = -1, offset = 0 }: GetExtra = {}
): Word[] {
  const search = exact ? text : `${text}%`;
  const rows = statements(db).get.all(search, limit, offset) as string[];
  return rows.map((r) => JSON.parse(r) as Word);
}

export function getXrefs(db: Db, xref: Xref): Word[] {
  const [first, second] = xref;
  if (typeof second === "string") {
    // per DTD http://www.edrdg.org/jmdict/jmdict_dtd_h.html `first`
    // will be keb (kanji) and `second` will have a reb (reading)
    // potentially with a center-dot separating it from a sense number.
    const reb = second.split("・")[0];
    const keb = first;
    const kebHits = get(db, keb);
    const rebMatches = kebHits.filter((w) =>
      w.kana.some((k) => k.text === reb)
    );
    return rebMatches;
  } else {
    // all we have is `first`, which could be a keb or reb (kanji or
    // reading/kana) so search both
    const hits = get(db, first).concat(get(db, first));

    const seen = new Set(); // dedupe
    const result: Word[] = [];
    for (const hit of hits) {
      if (seen.has(hit.id)) {
        continue;
      }
      seen.add(hit.id);
      result.push(hit);
    }
    return result;
  }
}

function idToWord(db: Db, id: string): Word {
  const row = statements(db).idToWord.get(id) as string;
  return JSON.parse(row) as Word;
}

export function idsToWords(db: Db, idxs: string[]): Word[] {
  return idxs.map((id) => idToWord(db, id));
}

export function findExact(db: Db, text: string, limit = -1, offset = 0) {
  return get(db, text, { exact: true, limit, offset });
}

export function countExact(db: Db, text: string): number {
  return statements(db).countExact.get(text) as number;
}

export function readingBeginning(
  db: Db,
  prefix: string,
  limit = -1,
  offset = 0
) {
  return get(db, prefix, {
    exact: false,
    limit,
    offset,
  });
}
export function readingAnywhere(db: Db, text: string, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: false,
    beginning: false,
    limit,
    offset,
  });
}
export const kanjiBeginning = readingBeginning;

export function kanjiAnywhere(db: Db, text: string, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: true,
    beginning: false,
    limit,
    offset,
  });
}

export function readingFuzzy(db: Db, text: string, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: false,
    beginning: false,
    fuzzy: true,
    limit,
    offset,
  });
}
export function kanjiFuzzy(db: Db, text: string, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: true,
    beginning: false,
    fuzzy: true,
    limit,
    offset,
  });
}

export function getTags(db: Db): Simplified["tags"] {
  const row = statements(db).getTags.get() as string;
  return JSON.parse(row) as Simplified["tags"];
}

export function getField(
  db: Db,
  key: keyof Omit<Simplified, "words">
): unknown {
  const row = statements(db).getField.get(key) as string;
  return JSON.parse(row);
}
