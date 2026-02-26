"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.ts
var index_exports = {};
__export(index_exports, {
  GlossType: () => GlossType,
  countExact: () => countExact,
  findExact: () => findExact,
  get: () => get,
  getField: () => getField,
  getTags: () => getTags,
  getXrefs: () => getXrefs,
  idsToWords: () => idsToWords,
  kanjiAnywhere: () => kanjiAnywhere,
  kanjiBeginning: () => kanjiBeginning,
  kanjiFuzzy: () => kanjiFuzzy,
  readingAnywhere: () => readingAnywhere,
  readingBeginning: () => readingBeginning,
  readingFuzzy: () => readingFuzzy,
  setup: () => setup
});
module.exports = __toCommonJS(index_exports);
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var import_fs = require("fs");

// interfaces.ts
var GlossType = /* @__PURE__ */ ((GlossType2) => {
  GlossType2["literal"] = "literal";
  GlossType2["figurative"] = "figurative";
  GlossType2["explanation"] = "explanation";
  return GlossType2;
})(GlossType || {});

// index.ts
var tokenize = (s) => s.split("").join(" ");
var allStatements = /* @__PURE__ */ new WeakMap();
function statements(db) {
  let hit = allStatements.get(db);
  if (!hit) {
    const ftsString = `SELECT entries.entry_json FROM {{template}}
           JOIN entries ON {{template}}.entry_id = entries.id
           WHERE {{template}}.text MATCH ?
           GROUP BY entries.id LIMIT ? OFFSET ?`;
    hit = {
      get: db.prepare(
        `SELECT entries.entry_json FROM raws
           JOIN entries ON raws.entry_id = entries.id
           WHERE raws.text LIKE ?
           GROUP BY entries.id LIMIT ? OFFSET ?`
      ).pluck(),
      countExact: db.prepare(
        `SELECT COUNT(DISTINCT entries.id) FROM raws
            JOIN entries ON raws.entry_id = entries.id
            WHERE raws.text = ?`
      ).pluck(),
      ftsKanjis: db.prepare(ftsString.replace(/{{template}}/g, "kanjis")).pluck(),
      ftsKanas: db.prepare(ftsString.replace(/{{template}}/g, "kanas")).pluck(),
      idToWord: db.prepare(`SELECT entry_json FROM entries WHERE id = ?`).pluck(),
      getTags: db.prepare(`SELECT value_json FROM metadata WHERE key = 'tags'`).pluck(),
      getField: db.prepare(`SELECT value_json FROM metadata WHERE key = ?`).pluck()
    };
    allStatements.set(db, hit);
  }
  return hit;
}
async function setup(dbpath, filename = "") {
  const db = new import_better_sqlite3.default(dbpath);
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
      contents = await import_fs.promises.readFile(filename, "utf8");
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
  const ftsStmt = kanji ? statements(db).ftsKanjis : statements(db).ftsKanas;
  const tokenized = fuzzy ? tokenize(text) : `"${tokenize(text)}"`;
  const token = beginning ? `^${tokenized}*` : tokenized;
  const raws = ftsStmt.all(token, limit, offset);
  return raws.map((r) => JSON.parse(r));
}
function get(db, text, { exact = true, limit = -1, offset = 0 } = {}) {
  const search = exact ? text : `${text}%`;
  const rows = statements(db).get.all(search, limit, offset);
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
  const row = statements(db).idToWord.get(id);
  return JSON.parse(row);
}
function idsToWords(db, idxs) {
  return idxs.map((id) => idToWord(db, id));
}
function findExact(db, text, limit = -1, offset = 0) {
  return get(db, text, { exact: true, limit, offset });
}
function countExact(db, text) {
  return statements(db).countExact.get(text);
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
  const row = statements(db).getTags.get();
  return JSON.parse(row);
}
function getField(db, key) {
  const row = statements(db).getField.get(key);
  return JSON.parse(row);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GlossType,
  countExact,
  findExact,
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
});
