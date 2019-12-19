import {AbstractBatch} from 'abstract-leveldown';
import {promises as pfs} from 'fs';
import LevelDOWN from 'leveldown';
import LevelUp from 'levelup';

import {Simplified, Word} from './interfaces';

type Db = ReturnType<typeof LevelUp>;

// Takes <60 seconds on 2015-era MacBook Pro, producing 125 MB Leveldb directory.
export async function setupFromScratch(DBNAME: string, filename: string, verbose = false): Promise<Db> {
  const raw: Simplified = JSON.parse(await pfs.readFile(filename, 'utf8'));
  const db = LevelUp(LevelDOWN(DBNAME));

  const maxBatches = 10000;
  let batch: AbstractBatch[] = [];

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
  return db;
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

async function getAllKeys(db: Db) { return drainStream<string>(db.createKeyStream({keyAsBuffer: false})); }

export async function indexesToWords(db: Db, idxs: string[]) {
  return Promise.all(idxs.map(i => db.get(`raw/words/${i}`, {asBuffer: false}).then(x => JSON.parse(x))))
}

export async function readingPrefix(db: Db, prefix: string) {
  const gte = `indexes/kana/${prefix}`;
  return indexesToWords(db, await drainStream(db.createValueStream({gte, lt: gte + '\uFE0F', valueAsBuffer: false})));
}

export async function readingAnywhere(db: Db, prefix: string) {
  const gte = `indexes/partial-kana/${prefix}`;
  return indexesToWords(db, await drainStream(db.createValueStream({gte, lt: gte + '\uFE0F', valueAsBuffer: false})));
}

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
    const init = false;
    const DBNAME = 'test';
    let db: Db;
    if (init) {
      db = await setupFromScratch(DBNAME, 'jmdict-eng-3.0.1.json', true);
    } else {
      db = LevelUp(LevelDOWN(DBNAME));
    }

    const res = await readingPrefix(db, 'いい'); // それ
    console.dir(res, {depth: null, maxArrayLength: 1e3});

    const resPartial = await readingAnywhere(db, 'いい');
    console.dir(resPartial, {depth: null, maxArrayLength: 1e3});

    console.log(`${res.length} exact found`);
    console.log(`${resPartial.length} partial found`);
  })();
}