"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const leveldown_1 = __importDefault(require("leveldown"));
const levelup_1 = __importDefault(require("levelup"));
// Takes <60 seconds on 2015-era MacBook Pro, producing 125 MB Leveldb directory.
function setupFromScratch(DBNAME, filename, verbose = false) {
    return __awaiter(this, void 0, void 0, function* () {
        const raw = JSON.parse(yield fs_1.promises.readFile(filename, 'utf8'));
        const db = levelup_1.default(leveldown_1.default(DBNAME));
        const maxBatches = 10000;
        let batch = [];
        for (const [numWordsWritten, w] of raw.words.entries()) {
            if (batch.length > maxBatches) {
                yield db.batch(batch);
                batch = [];
                if (verbose) {
                    console.log(`${numWordsWritten} entries written`);
                }
            }
            batch.push({ type: 'put', key: `raw/words/${w.id}`, value: JSON.stringify(w) });
            for (const key of ['kana', 'kanji']) {
                for (const k of w[key]) {
                    batch.push({ type: 'put', key: `indexes/${key}/${k.text}-${w.id}`, value: w.id });
                    for (const substr of allSubstrings(k.text)) {
                        // collisions in key ok, since value will be ame
                        batch.push({ type: 'put', key: `indexes/partial-${key}/${substr}-${w.id}`, value: w.id });
                    }
                }
            }
        }
        if (batch.length) {
            yield db.batch(batch);
        }
        return db;
    });
}
exports.setupFromScratch = setupFromScratch;
function drainStream(stream) {
    const ret = [];
    return new Promise((resolve, reject) => {
        stream.on('data', x => ret.push(x))
            .on('error', e => reject(e))
            .on('close', () => resolve(ret))
            .on('end', () => resolve(ret));
    });
}
function indexesToWords(db, idxs) {
    return __awaiter(this, void 0, void 0, function* () {
        return Promise.all(idxs.map(i => db.get(`raw/words/${i}`, { asBuffer: false }).then(x => JSON.parse(x))));
    });
}
function searchBeginning(db, prefix, key = 'kana') {
    return __awaiter(this, void 0, void 0, function* () {
        const gte = `indexes/${key}/${prefix}`;
        return indexesToWords(db, yield drainStream(db.createValueStream({ gte, lt: gte + '\uFE0F', valueAsBuffer: false })));
    });
}
function searchAnywhere(db, text, key = 'kana') {
    return __awaiter(this, void 0, void 0, function* () {
        const gte = `indexes/partial-${key}/${text}`;
        return indexesToWords(db, yield drainStream(db.createValueStream({ gte, lt: gte + '\uFE0F', valueAsBuffer: false })));
    });
}
function readingBeginning(db, prefix) {
    return __awaiter(this, void 0, void 0, function* () { return searchBeginning(db, prefix, 'kana'); });
}
exports.readingBeginning = readingBeginning;
function readingAnywhere(db, text) {
    return __awaiter(this, void 0, void 0, function* () { return searchAnywhere(db, text, 'kana'); });
}
exports.readingAnywhere = readingAnywhere;
function kanjiBeginning(db, prefix) {
    return __awaiter(this, void 0, void 0, function* () { return searchBeginning(db, prefix, 'kanji'); });
}
exports.kanjiBeginning = kanjiBeginning;
function kanjiAnywhere(db, text) {
    return __awaiter(this, void 0, void 0, function* () { return searchAnywhere(db, text, 'kanji'); });
}
exports.kanjiAnywhere = kanjiAnywhere;
function allSubstrings(s) {
    const slen = s.length;
    let ret = new Set();
    for (let start = 0; start < slen; start++) {
        for (let length = 1; length <= slen - start; length++) {
            ret.add(s.substr(start, length));
        }
    }
    return ret;
}
if (module === require.main) {
    (function () {
        return __awaiter(this, void 0, void 0, function* () {
            // Download jmdict-eng-3.0.1.json
            const init = false;
            const DBNAME = 'test';
            let db;
            if (init) {
                db = yield setupFromScratch(DBNAME, 'jmdict-eng-3.0.1.json', true);
            }
            else {
                db = levelup_1.default(leveldown_1.default(DBNAME));
            }
            const res = yield readingBeginning(db, 'いい'); // それ
            console.dir(res, { depth: null, maxArrayLength: 1e3 });
            const resPartial = yield readingAnywhere(db, 'いい');
            console.dir(resPartial, { depth: null, maxArrayLength: 1e3 });
            console.log(`${res.length} exact found`);
            console.log(`${resPartial.length} partial found`);
        });
    })();
}