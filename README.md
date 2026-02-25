# JMDict-Simplified for Node.js

- [JMDict-Simplified for Node.js](#jmdict-simplified-for-nodejs)
  - [Installation and setup](#installation-and-setup)
    - [Tutorial](#tutorial)
  - [API](#api)
    - [`setup(dbpath: string, filename = ''): Promise<SetupType>`](#setupdbpath-string-filename---promisesetuptype)
    - [`findExact(db: Db, text: string, limit?: number, offset?: number): Word[]`](#findexactdb-db-text-string-limit-number-offset-number-word)
    - [`readingBeginning(db: Db, prefix: string, limit?: number, offset?: number): Word[]`](#readingbeginningdb-db-prefix-string-limit-number-offset-number-word)
    - [`readingAnywhere`, `kanjiBeginning`, `kanjiAnywhere`](#readinganywhere-kanjibeginning-kanjianywhere)
    - [Fuzzy search](#fuzzy-search)
      - [`readingFuzzy(db: Db, text: string, limit?: number, offset?: number): Word[]`](#readingfuzzydb-db-text-string-limit-number-offset-number-word)
      - [`kanjiFuzzy(db: Db, text: string, limit?: number, offset?: number): Word[]`](#kanjifuzzydb-db-text-string-limit-number-offset-number-word)
    - [`getTags(db: Db): Simplified['tags']`](#gettagsdb-db-simplifiedtags)
    - [`getField(db: Db, key: keyof Omit<Simplified, 'words'>): unknown`](#getfielddb-db-key-keyof-omitsimplified-words-unknown)
    - [`idsToWords(db: Db, idxs: string[]): Word[]`](#idstowordsdb-db-idxs-string-word)
    - [`getXrefs(db: Db, xref: Xref): Word[]`](#getxrefsdb-db-xref-xref-word)
    - [Pagination](#pagination)
  - [Changelog](#changelog)
    - [2.1.0](#210)
    - [2.0.0](#200)
    - [1.2.0](#120)


[**@scriptin**'s `jmdict-simplified`](https://github.com/scriptin/jmdict-simplified) project provides a sane JSON version of the famous [JMDict](http://www.edrdg.org/jmdict/j_jmdict.html) open-source Japanese dictionary project.

*This* current project, `jmdict-simplified-node` (the one you're reading about), helps Node.js applications load JMDict-Simplified's JSON into a database to enable fast searches for
- both text (which often contain kanji) and readings (no kanji), with
- prefix-only, or
- match-anywhere, or
- fuzzy full-text search.

This project also contains TypeScript interfaces describing the JMDict-Simplified project, allowing your TypeScript projects to effortlessly navigate this data.

## Installation and setup

I expect you have a Node.js project already. In it:
1. Install `jmdict-simplified-node`: `npm i jmdict-simplified-node`
2. Download a recent release of the [JMDict-Simplified JSON](https://github.com/scriptin/jmdict-simplified/releases/latest)
3. Import `jmdict-simplified-node` into your project: in TypeScript, this would be `import {setup as setupJmdict} from 'jmdict-simplified-node'`
4. Setup: `const jmdictPromise = setupJmdict('my-jmdict-simplified.db', 'jmdict-eng-3.X.Y.json');`

### Tutorial
For full details about the API, see the next section, but in a nutshell, here's how you can start using this library after you complete the two installation steps above (install this npm package and download JMDict-Simplified):
```ts
import { readingBeginning, setup as setupJmdict } from "jmdict-simplified-node";

const jmdictPromise = setupJmdict(
  "my-jmdict-simplified.db",
  "jmdict-eng-3.6.1.json"
);

jmdictPromise.then(({ db }) => {
  const results = readingBeginning(db, "あおい", 3);
  console.dir(results, { depth: null });
});
```
Drop the above in `demo.mjs`, and run `node demo.mjs`. The first time you run this, it'll take a minute or two to cache all the entries before printing out three JMDict entries whose readings start with あおい. If you rerun it, it'll run in an instant.

For full details on what these library functions are doing, and what other functions this library provides, read on.

## API

### `setup(dbpath: string, filename = ''): Promise<SetupType>`
Always call this first before using any other function in this API: this function returns an object you need to call all other functions. You only need to call this function once in your entire application.

Given:
- `dbpath`: the path where your SQLite database will be stored,
- optionally the `filename` of the JMDict-Simplified JSON,

this function will return a promise of the following data:
```ts
export type SetupType = {
  db: Db,
  dictDate: string,
  version: string,
  tags: Simplified['tags'],
};
```
The `db` object is required by all lookup functions in this API, so hang on to this. The other fields are informational.

If a proper SQLite database is not found in `dbpath`, this function will look at `filename` and parse the JSON in it. It takes ~60 seconds to take a 109 MB JSON file and create a 193 MB SQLite database on a 2020-vintage Mac laptop.

### `findExact(db: Db, text: string, limit?: number, offset?: number): Word[]`
Find all entries where any kanji or reading exactly matches `text`. Returns an array of `Word`s. Unlike the beginning/anywhere functions, this does not do a prefix or substring match: the entry's kanji or kana text must equal `text` in full.

Because a single entry can match via either its kanji or its kana, callers that need to distinguish can filter the results themselves:
```ts
const wanted = "食べ物";
const hits = findExact(db, wanted);
const byKanji = hits.filter(w => w.kanji.some(k => k.text === wanted));
const byKana  = hits.filter(w => w.kana.some(k  => k.text === wanted));
```

### `readingBeginning(db: Db, prefix: string, limit?: number, offset?: number): Word[]`
Find all readings starting with a given `prefix`. Needs a `Db`-typed object, which was one of the things `setup` gave you. `limit` defaults to -1 (no limit) and offset to 0 (no offset).

Returns an array of `Word`s. A `Word` is an entry in JMDict, and contains things like:
- `id`: uniquely identifies it in the dictionary,
- `kanji`: the text being defined (might or might not actually include kanji: `ＣＤ` and `日本` are two examples),
- `kana`: the reading (i.e., the pronunciation) of this kanji text,
- `sense`: the various dictionary senses this word can have.

Look at [`interfaces.ts`](./interfaces.ts) for the details. It very carefully follows the soft-schema of the [upstream `jmdict-simplified`](https://github.com/scriptin/jmdict-simplified) project.

### `readingAnywhere`, `kanjiBeginning`, `kanjiAnywhere`
These three have the same signature as `readingBeginning` above:
```ts
readingAnywhere(db: Db, text: string, limit?: number, offset?: number): Word[]
kanjiBeginning(db: Db, prefix: string, limit?: number, offset?: number): Word[]
kanjiAnywhere(db: Db, text: string, limit?: number, offset?: number): Word[]
```
They search the reading or kanji (text) fields, either via a prefix (to match the beginning) or by anywhere in the string. Both beginning and anywhere are fast: the former uses an index on each kanji and reading string (as fast as possible), while the anywhere case uses SQLite's FTS5 full-text search (tokenized as one characer per token; this is a bit more work than the prefix search but still very fast).

### Fuzzy search
Fuzzy search allows you to find entries where all characters in your search term appear at least once. The characters may be found in any order: searching for "悪い" gives you the exact same results as "い悪".

Caveat. Because of the way this full-text search works, searching for duplicate characters will return hits that contain just one instance of that character, so fuzzy-searching for "いい" will return all entries with a single "い" somewhere in them.

Two functions are provided for fuzzy search:

#### `readingFuzzy(db: Db, text: string, limit?: number, offset?: number): Word[]`
Searches for readings where all characters in `text` appear. Needs a `Db`-typed object, which was one of the things `setup` gave you. `limit` defaults to -1 (no limit) and `offset` defaults to 0 (no offset).

#### `kanjiFuzzy(db: Db, text: string, limit?: number, offset?: number): Word[]`
Searches for kanji (text) where the characters in `text` appear in order. Needs a `Db`-typed object, which was one of the things `setup` gave you. `limit` defaults to -1 (no limit) and `offset` defaults to 0 (no offset).

Both functions return an array of `Word`s, which are entries in JMDict, same as the beginning/anywhere functions above.

### `getTags(db: Db): Simplified['tags']`
JMDict uses a large number of acronyms that it calls "tags", e.g.,
- "MA" for "martial arts term",
- "aux-v" for "auxiliary verb",
- "fem" for "female term or language".

These acronyms will be found in the hits yielded by the four lookup functions above.

This function will return an object mapping these abbreviations to their full meaning.

### `getField(db: Db, key: keyof Omit<Simplified, 'words'>): unknown`
There are a small handful of extra pieces of information that the original JSON includes, things like:
- `dictDate`: the date the original JMDict XML file was created,
- `dictRevisions`: a list of revisions in the original JMDict XML file, etc.

This function lets you access these.

### `idsToWords(db: Db, idxs: string[]): Word[]`
This helper function will expand a list of JMDict word IDs to the full definition. This might be helpful if you only transmit words' IDs, for example.

### `getXrefs(db: Db, xref: Xref): Word[]`
Definitions can have `related` and `antonym` references which can be resolved with this utility. It returns an array of other definitions for a given `Xref` cross-reference because I can't guarantee that the `Xref` is exactly accurate. Most of the time this should return an array of exactly one element (hopefully).

### Pagination
Imagine searching for words whose readings start あいさつ. Your system caps the search results to 10 at a time. You can still search for batches of 10 in the following way, leveraging `limit` and `offset`.
```ts
const NUM_PAGES = 3;
const PAGE_SIZE = 10;
const hits = [];
for (let page = 0; page < NUM_PAGES; page++) {
  const newOffset = hits.length;
  const thisPage = readingBeginning(db, "あいさつ", PAGE_SIZE, newOffset);
  hits.push(...thisPage);
  console.log(`Page ${page + 1}: total hits ${hits.length}`);
}
```

## Changelog

### 2.1.0

Search functions (`readingBeginning`, `readingAnywhere`, `kanjiBeginning`, `kanjiAnywhere`, `readingFuzzy`, `kanjiFuzzy`) no longer return duplicate entries for words. Works with pagination!

Introduces a new function, `findExact` that finds entries matching the search text exactly. This will match both kanji and readings.

### 2.0.0

Moving from Leveldb to SQLite, so the first time you run `setup`, it'll rebuild the database (you can delete the old Leveldb).

The SQLite substrate allows
1. multiple clients to open the same database at once,
2. fast fuzzy search,
3. more compact "anywhere" searches.

Also included: offsets (allowing pagination, along with `limit`).

All the search functions are synchronous thanks to Better-SQLite3. Only `setup` is async (since it might need to read a file).

Upgrade: the API is mostly backwards-compatible so most users can upgrade without any work. Breaking changes are solely in `setup`:
- `setup` accepts fewer arguments (no more `verbose`, `omitPartial`: setup is always quiet and will always set up partial/anywhere searches).
- If you called `setup` with an empty filename because you assumed the database was already setup, of course you'll need to rerun whatever code you initially ran to create the database.

Small caveat: since the search functions are no longer async, you might be able to simplify your code to avoid needless `await`s.

### 1.2.0

Introduce `getXrefs` utility.
