// index.ts
import Sqlite from "better-sqlite3";
import { promises as pfs } from "fs";

// interfaces.ts
var GlossType = /* @__PURE__ */ ((GlossType2) => {
  GlossType2["literal"] = "literal";
  GlossType2["figurative"] = "figurative";
  GlossType2["explanation"] = "explanation";
  return GlossType2;
})(GlossType || {});

// index.ts
var tokenize = (s) => s.split("").join(" ");
async function setup(dbpath, filename = "") {
  const db = new Sqlite(dbpath);
  db.pragma("journal_mode = WAL");
  db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT UNIQUE,
    value_json TEXT NOT NULL
  );
`);
  const getMetaStmt = db.prepare("SELECT value_json FROM metadata WHERE key = ?").pluck();
  const get2 = (s) => JSON.parse(getMetaStmt.get(s));
  try {
    return {
      db,
      // if there's no data or if it's mal-formed, this will throw.
      // If that happens, we fall through to re-populating the DB.
      version: get2("version"),
      dictDate: get2("dictDate"),
      tags: get2("tags")
    };
  } catch (e) {
    if (!(e instanceof SyntaxError)) {
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
  const data = await (async () => {
    if (!filename) {
      console.error(
        "database not found but cannot create it if no `filename` given"
      );
      process.exit(1);
    }
    let contents = "";
    try {
      contents = await pfs.readFile(filename, "utf8");
    } catch {
      console.error(
        `Unable to find ${filename}, download it from https://github.com/scriptin/jmdict-simplified`
      );
      process.exit(1);
    }
    return JSON.parse(contents);
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
        JSON.stringify(data[key])
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
    tags: data.tags
  };
}
function fts({
  db,
  text,
  kanji,
  beginning,
  fuzzy = false,
  limit = -1,
  offset = 0
}) {
  if (!text) {
    return [];
  }
  if (beginning && !fuzzy) {
    return get(db, `${text}%`, { exact: false, limit, offset });
  }
  const ftsTable = kanji ? "kanjis" : "kanas";
  const query = `
    SELECT
      entries.entry_json
    FROM
      ${ftsTable}
    JOIN
      entries
    ON
      ${ftsTable}.entry_id = entries.id
    WHERE
      ${ftsTable}.text MATCH ?
    LIMIT ? OFFSET ?;
  `;
  const tokenized = fuzzy ? tokenize(text) : `"${tokenize(text)}"`;
  const token = beginning ? `^${tokenized}*` : tokenized;
  const raws = db.prepare(query).pluck().all(token, limit, offset);
  return raws.map((r) => JSON.parse(r));
}
function get(db, text, { exact = true, limit = -1, offset = 0 } = {}) {
  const GET_QUERY = `
    SELECT
      entries.entry_json
    FROM
      raws
    JOIN
      entries
    ON
      raws.entry_id = entries.id
    WHERE
      raws.text LIKE ?
    LIMIT ? OFFSET ?;
  `;
  const search = exact ? text : `${text}%`;
  const rows = db.prepare(GET_QUERY).pluck().all(search, limit, offset);
  return rows.map((r) => JSON.parse(r));
}
function getXrefs(db, xref) {
  const [first, second] = xref;
  if (typeof second === "string") {
    const reb = second.split("\u30FB")[0];
    const keb = first;
    const kebHits = get(db, keb);
    const rebMatches = kebHits.filter(
      (w) => w.kana.some((k) => k.text === reb)
    );
    return rebMatches;
  } else {
    const hits = get(db, first).concat(get(db, first));
    const seen = /* @__PURE__ */ new Set();
    const result = [];
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
function idToWord(db, id) {
  const query = `SELECT entry_json FROM entries WHERE id = ?`;
  const row = db.prepare(query).pluck().get(id);
  return JSON.parse(row);
}
function idsToWords(db, idxs) {
  return idxs.map((id) => idToWord(db, id));
}
function readingBeginning(db, prefix, limit = -1, offset = 0) {
  return get(db, prefix, {
    exact: false,
    limit,
    offset
  });
}
function readingAnywhere(db, text, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: false,
    beginning: false,
    limit,
    offset
  });
}
var kanjiBeginning = readingBeginning;
function kanjiAnywhere(db, text, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: true,
    beginning: false,
    limit,
    offset
  });
}
function readingFuzzy(db, text, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: false,
    beginning: false,
    fuzzy: true,
    limit,
    offset
  });
}
function kanjiFuzzy(db, text, limit = -1, offset = 0) {
  return fts({
    db,
    text,
    kanji: true,
    beginning: false,
    fuzzy: true,
    limit,
    offset
  });
}
function getTags(db) {
  const query = `SELECT value_json FROM metadata WHERE key = 'tags'`;
  const row = db.prepare(query).pluck().get();
  return JSON.parse(row);
}
function getField(db, key) {
  const query = `SELECT value_json FROM metadata WHERE key = ?`;
  const row = db.prepare(query).pluck().get(key);
  return JSON.parse(row);
}
export {
  GlossType,
  get,
  getField,
  getTags,
  getXrefs,
  idsToWords,
  kanjiAnywhere,
  kanjiBeginning,
  kanjiFuzzy,
  readingAnywhere,
  readingBeginning,
  readingFuzzy,
  setup
};
