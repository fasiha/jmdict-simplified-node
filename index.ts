import {promises as pfs} from 'fs';

import {Simplified, Word} from './interfaces';
import {ClassicLevel} from "classic-level";
import {AbstractBatchOperation} from "abstract-level";
import {ValueStream} from "level-read-stream";

export * from './interfaces';
type Db = ClassicLevel;
// Takes ~90 seconds on 2015-era MacBook Pro, producing 140 MB Leveldb directory ("jmdict-eng-3.1.0.json").
export type SetupType = {
  db: ClassicLevel,
  dictDate: string,
  version: string,
};

export async function setup(dbpath: string, filename = '', verbose = false, omitPartial = false): Promise<SetupType> {
  const db = new ClassicLevel<string, string>(dbpath);
  try {
    const [dictDate, version] =
      await Promise.all([db.get('raw/dictDate'), db.get('raw/version')]) as string[];
    return {db, dictDate, version};
  } catch {
    // pass
  }

  if (!filename) {
    await db.close();
    throw new Error('database not found but cannot create it if no `filename` given');
  }
  let contents: string = '';
  try {
    contents = await pfs.readFile(filename, 'utf8')
  } catch {
    console.error(`Unable to find ${filename}, download it from https://github.com/scriptin/jmdict-simplified`);
    process.exit(1);
  }
  const raw: Simplified = JSON.parse(contents);
  try {
    const maxBatches = 10000;
    let batch: AbstractBatchOperation<any, any, any>[] = [];

    {
      // non-JSON, pure strings
      const keys: (keyof Simplified)[] = ['dictDate', 'version'];
      for (const key of keys) {
        batch.push({type: 'put', key: `raw/${key}`, value: raw[key]})
      }
    }
    {
      // to JSONify
      const keys: (keyof Simplified)[] = ['tags', 'dictRevisions'];
      for (const key of keys) {
        batch.push({type: 'put', key: `raw/${key}`, value: JSON.stringify(raw[key])})
      }
    }

    for (const [numWordsWritten, w] of raw.words.entries()) {
      if (batch.length > maxBatches) {
        await db.batch(batch);
        batch = [];
        if (verbose) {
          console.log(`${numWordsWritten} entries written`);
        }
      }
      batch.push({type: 'put', key: `raw/words/${w.id}`, value: JSON.stringify(w)});
      for (const key of (['kana', 'kanji'] as const)) {
        for (const k of w[key]) {
          batch.push({type: 'put', key: `indexes/${key}/${k.text}-${w.id}`, value: w.id});
          if (!omitPartial) {
            for (const substr of allSubstrings(k.text)) {
              // collisions in key ok, since value will be same
              batch.push({type: 'put', key: `indexes/partial-${key}/${substr}-${w.id}`, value: w.id});
            }
          }
        }
      }
    }
    if (batch.length) {
      await db.batch(batch);
    }
  } catch (e) {
    await db.close()
    throw e;
  }
  return {db, dictDate: raw.dictDate, version: raw.version};
}

function drainStream(stream: ValueStream<string, Simplified, Db>): Promise<string[]> {
  const ret: string[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', x => ret.push(x))
      .on('error', e => reject(e))
      .on('close', () => resolve(ret))
      .on('end', () => resolve(ret));
  })
}

async function searchBeginning(db: Db, prefix: string, key: 'kana' | 'kanji' = 'kana', limit: number): Promise<Word[]> {
  const gte = `indexes/${key}/${prefix}`;
  const values = new ValueStream<string, Simplified, Db>(db, {gte, lt: gte + '\uFE0F', limit});
  return idsToWords(db, await drainStream(values));
}

async function searchAnywhere(db: Db, text: string, key: 'kana' | 'kanji' = 'kana', limit: number): Promise<Word[]> {
  const gte = `indexes/partial-${key}/${text}`;
  const values = new ValueStream<string, Simplified, Db>(db, {gte, lt: gte + '\uFE0F', limit})
  return idsToWords(db, await drainStream(values));
}

export function idsToWords(db: Db, idxs: string[]): Promise<Word[]> {
  return Promise.all(idxs.map(i => db.get(`raw/words/${i}`).then((x: string) => JSON.parse(x))))
}

export async function readingBeginning(db: Db, prefix: string, limit = -1) {
  return searchBeginning(db, prefix, 'kana', limit);
}

export async function readingAnywhere(db: Db, text: string, limit = -1) {
  return searchAnywhere(db, text, 'kana', limit);
}

export async function kanjiBeginning(db: Db, prefix: string, limit = -1) {
  return searchBeginning(db, prefix, 'kanji', limit);
}

export async function kanjiAnywhere(db: Db, text: string, limit = -1) {
  return searchAnywhere(db, text, 'kanji', limit);
}

export async function getTags(db: Db): Promise<Simplified['tags']> {
  return db.get('raw/tags').then((x: string) => JSON.parse(x));
}

type BetterOmit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export async function getField(db: Db, key: keyof BetterOmit<Simplified, 'words'>): Promise<string> {
  return db.get(`raw/${key}`);
}

function allSubstrings(s: string) {
  const slen = s.length;
  let ret: Set<string> = new Set();
  for (let start = 0; start < slen; start++) {
    for (let length = 1; length <= slen - start; length++) {
      ret.add(s.substr(start, length));
    }
  }
  return ret;
}

if (module === require.main) {
  (async function () {
    // TODO: Download latest jmdict-eng JSON
    const DBNAME = 'test';
    const {db, dictDate, version} = await setup(DBNAME, 'jmdict-eng-3.5.0.json', true, false);

    console.log({dictDate, version});

    const res = await readingBeginning(db, 'いい'); // それ
    const resPartial = await readingAnywhere(db, 'いい');
    console.log(`${res.length} exact found`);
    console.log(`${resPartial.length} partial found`);

    console.log(await idsToWords(db, ['1571070']));

    {
      const LIMIT = 4;
      const res = await readingBeginning(db, 'いい', LIMIT);
      console.log(`${res.length} found with limit ${LIMIT}`);
    }
    {
      console.log(Object.keys(await getTags(db)));
    }
    {
      console.log(await getField(db, "dictDate"));
    }
  })();
}
