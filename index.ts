import {AbstractBatch} from 'abstract-leveldown';
import {promises as pfs} from 'fs';
import LevelDOWN from 'leveldown';
import LevelUp from 'levelup';

import {Simplified, Word} from './interfaces';

type Db = ReturnType<typeof LevelUp>;
export async function setupFromScratch(DBNAME: string, filename: string, verbose = false): Promise<Db> {
  const raw: Simplified = JSON.parse(await pfs.readFile(filename, 'utf8'));
  const db = LevelUp(LevelDOWN(DBNAME));

  let nwritten = 0;
  let batchesWritten = 0;
  const maxNwritten = 1000;
  let batch: AbstractBatch[] = [];

  for (const w of raw.words) {
    nwritten++;
    if (nwritten > maxNwritten) {
      await db.batch(batch);
      batch = [];
      nwritten = 0;
      if (verbose) {
        batchesWritten++;
        console.log(`Batch # ${batchesWritten} written`);
      }
    }
    batch.push({type: 'put', key: `raw/words/${w.id}`, value: JSON.stringify(w)});
    for (const k of w.kana) { batch.push({type: 'put', key: `indexes/kana/${k.text}`, value: w.id}); }
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

export async function readingPrefix(db: Db, prefix: string) {
  const gte = `indexes/kana/${prefix}`;
  const idxs: string[] =
      await drainStream(db.createValueStream({gte, lt: gte + '\uFE0F', keyAsBuffer: false, valueAsBuffer: false}));
  const vals: Word[] = await Promise.all(idxs.map(i => db.get(`raw/words/${i}`, {asBuffer: false})));
  return vals;
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
    if (false) {
      const keys = await getAllKeys(db);
      console.log(keys)
    }
    console.log(await readingPrefix(db, 'それ'));
  })();
}