import {AbstractBatch} from 'abstract-leveldown';
import {promises as pfs} from 'fs';
import LevelDOWN from 'leveldown';
import LevelUp from 'levelup';

import {Simplified, Word} from './interfaces';
export * from './interfaces';
type Db = ReturnType<typeof LevelUp>;

// Takes <60 seconds on 2015-era MacBook Pro, producing 125 MB Leveldb directory.
export type SetupType = {
  db: Db,
  dictDate: string,
  version: string,
};
export async function setup(DBNAME: string, filename = '', verbose = false): Promise<SetupType> {
  const db = LevelUp(LevelDOWN(DBNAME));
  try {
    const opt = {asBuffer: false};
    const [dictDate, version] =
        await Promise.all([db.get('raw/dictDate', opt), db.get('raw/version', opt)]) as string[];
    return {db, dictDate, version};
  } catch {
    // pass
  }

  if (!filename) { throw new Error('database not found but cannot create it if no `filename` given'); }
  const raw: Simplified = JSON.parse(await pfs.readFile(filename, 'utf8'));
  const maxBatches = 10000;
  let batch: AbstractBatch[] = [];

  {
    const keys: (keyof Simplified)[] = ['dictDate', 'version'];
    for (const key of keys) { batch.push({type: 'put', key: `raw/${key}`, value: raw[key]}) }
  }

  for (const [numWordsWritten, w] of raw.words.entries()) {
    if (batch.length > maxBatches) {
      await db.batch(batch);
      batch = [];
      if (verbose) { console.log(`${numWordsWritten} entries written`); }
    }
    batch.push({type: 'put', key: `raw/words/${w.id}`, value: JSON.stringify(w)});
    for (const key of (['kana', 'kanji'] as const )) {
      for (const k of w[key]) {
        batch.push({type: 'put', key: `indexes/${key}/${k.text}-${w.id}`, value: w.id});
        for (const substr of allSubstrings(k.text)) {
          // collisions in key ok, since value will be ame
          batch.push({type: 'put', key: `indexes/partial-${key}/${substr}-${w.id}`, value: w.id});
        }
      }
    }
  }
  if (batch.length) { await db.batch(batch); }
  return {db, dictDate: raw.dictDate, version: raw.version};
}

function drainStream<T>(stream: NodeJS.ReadableStream): Promise<T[]> {
  const ret: T[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', x => ret.push(x))
        .on('error', e => reject(e))
        .on('close', () => resolve(ret))
        .on('end', () => resolve(ret));
  })
}

async function searchBeginning(db: Db, prefix: string, key: 'kana'|'kanji' = 'kana'): Promise<Word[]> {
  const gte = `indexes/${key}/${prefix}`;
  return indexesToWords(db, await drainStream(db.createValueStream({gte, lt: gte + '\uFE0F', valueAsBuffer: false})));
}
async function searchAnywhere(db: Db, text: string, key: 'kana'|'kanji' = 'kana'): Promise<Word[]> {
  const gte = `indexes/partial-${key}/${text}`;
  return indexesToWords(db, await drainStream(db.createValueStream({gte, lt: gte + '\uFE0F', valueAsBuffer: false})));
}
function indexesToWords(db: Db, idxs: string[]): Promise<Word[]> {
  return Promise.all(idxs.map(i => db.get(`raw/words/${i}`, {asBuffer: false}).then(x => JSON.parse(x))))
}

export async function readingBeginning(db: Db, prefix: string) { return searchBeginning(db, prefix, 'kana'); }
export async function readingAnywhere(db: Db, text: string) { return searchAnywhere(db, text, 'kana'); }
export async function kanjiBeginning(db: Db, prefix: string) { return searchBeginning(db, prefix, 'kanji'); }
export async function kanjiAnywhere(db: Db, text: string) { return searchAnywhere(db, text, 'kanji'); }

function allSubstrings(s: string) {
  const slen = s.length;
  let ret: Set<string> = new Set();
  for (let start = 0; start < slen; start++) {
    for (let length = 1; length <= slen - start; length++) { ret.add(s.substr(start, length)); }
  }
  return ret;
}

if (module === require.main) {
  (async function() {
    // Download jmdict-eng-3.0.1.json
    const DBNAME = 'test';
    const {db, dictDate, version} = await setup(DBNAME, 'jmdict-eng-3.0.1.json', true);

    console.log({dictDate, version});

    const res = await readingBeginning(db, 'いい'); // それ
    console.dir(res, {depth: null, maxArrayLength: 1e3});

    const resPartial = await readingAnywhere(db, 'いい');
    console.dir(resPartial, {depth: null, maxArrayLength: 1e3});

    console.log(`${res.length} exact found`);
    console.log(`${resPartial.length} partial found`);
  })();
}