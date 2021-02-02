#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const lodash_1 = require("lodash");
const path_1 = require("path");
const yargs_1 = require("yargs");
const MicroMatch = require("micromatch");
const clc = require("cli-color");
const cwd = process.cwd();
const TYPE_CHARS_LEN = 30; // TODO: automate
let { FILE_LIMIT, FILE_TYPE_LIMIT, TRACE_FILE, TYPES_FILE, PATTERN = '**/*' } = yargs_1.default(process.argv.slice(2))
    .usage('ts-rank')
    .options({
    FILE_LIMIT: { type: 'number', default: 50, alias: 'f' },
    FILE_TYPE_LIMIT: { type: 'number', default: 10, alias: 't' },
    TRACE_FILE: { type: 'string', default: './.tsTrace/trace.json' },
    TYPES_FILE: { type: 'string', default: './.tsTrace/types.json' },
    PATTERN: { type: 'string', desc: 'Ruduce the ranking to files that match this glob', alias: 'p' },
}).argv;
TRACE_FILE = path_1.resolve(cwd, TRACE_FILE);
TYPES_FILE = path_1.resolve(cwd, TYPES_FILE);
const FILE_LIMIT_CHARS = FILE_LIMIT.toString().length;
const FILE_TYPE_LIMIT_CHARS = FILE_TYPE_LIMIT.toString().length;
void (async () => {
    console.time(':: T');
    console.log(``);
    console.group(`ts-rank\n\nRanking output from %o`, `tsconfig.compilerOptions.generateTrace`);
    console.dir({ FILE_LIMIT, FILE_TYPE_LIMIT, TRACE_FILE, TYPES_FILE, PATTERN, cwd });
    console.log(``);
    console.time(':: Reading files');
    const [trace = [], types = []] = await Promise.all([
        readJsonFile(TRACE_FILE),
        readJsonFile(TYPES_FILE),
    ]);
    console.timeEnd(':: Reading files');
    console.log(':: %o traces, %o types', trace.length, types.length);
    const checkMetrics = getSymbolCheckMetrics({ trace, types }).filter(FilterByGlob(PATTERN));
    const metricsMapByPath = Object.entries(lodash_1.groupBy(checkMetrics, 'symbol.firstDeclaration.path'));
    const sumByMetricDuration = (metrics) => lodash_1.sumBy(metrics, 'check.dur');
    const orderedMetrics = lodash_1.sortBy(metricsMapByPath, ([path, metrics], compare) => sumByMetricDuration(metrics))
        .reverse();
    console.group(`Files ranked by Duration (Wall)`);
    let fileCount = FILE_LIMIT + 1;
    orderedMetrics
        .slice(0, FILE_LIMIT)
        .reverse()
        .forEach(([_, metrics]) => {
        const totalTime = parseFloat((sumByMetricDuration(metrics) / 1000).toFixed(2));
        --fileCount;
        console.group(clc.blackBright(`  ${`# ${clc.bold.cyan(fileCount)}`.padEnd(29)} ${clc.bold.red(totalTime)} ms (Total time)`));
        const typeMetrics = lodash_1.orderBy(metrics, ['check.dur'], 'desc')
            .slice(0, FILE_TYPE_LIMIT);
        console.log('');
        for (const metric of typeMetrics)
            console.log(`  ${cli.metric(metric)}`);
        console.log('');
        console.groupEnd();
    });
    console.timeEnd(':: T');
    console.groupEnd();
    console.log('');
})();
const cli = {
    count: (v, n = 2) => `${clc.bold(v)}`.padEnd(n.toString().length + 1),
    time: (v) => clc.bold(v.toFixed(0)),
    symbolName: (v) => clc.bold.blueBright(v.slice(0, TYPE_CHARS_LEN).padEnd(TYPE_CHARS_LEN)),
    filePath: (path, pos) => {
        const dir = path_1.dirname(path);
        const pathTxt = `${dir + path_1.sep}${clc.underline.bold(path_1.relative(dir, path))}`;
        return !pos ? pathTxt : pathTxt + clc.blackBright(`:${pos.line}:${pos.character}`);
    },
    metric({ symbol: { firstDeclaration: { end, path, start }, symbolName, }, check, }) {
        const relPath = path_1.relative(cwd, path);
        const dur = check.dur / 1000; // Get ms
        return `${(clc.bold.yellow(dur.toFixed(0)) + ' ms').padEnd(27)} ${cli.symbolName(symbolName)} ${cli.filePath(relPath, start)}`;
    }
};
function getSymbolCheckMetrics({ trace, types }) {
    const validSymbols = ['checkExpression', 'structuredTypeRelatedTo'];
    const checks = trace.filter(({ cat, name }) => cat === 'check' && validSymbols.includes(name));
    const metrics = [];
    /** Important for performance */
    const sourceIdIndexMap = new Map(checks.map(({ args: { sourceId } }, index) => [sourceId, index]));
    // For loop for perf
    for (const item of types) {
        if (!('symbolName' in item))
            continue;
        // Ignored
        // TODO: ?? utilize this for reference/alias listing??
        if (!item.firstDeclaration)
            continue;
        const symbol = item;
        const check = checks[sourceIdIndexMap.get(symbol.id)];
        if (!check)
            continue;
        metrics.push({
            symbol,
            check,
            isNodeModule: symbol.firstDeclaration.path.includes('/node_modules'),
        });
    }
    return metrics;
}
function FilterByGlob(glob) {
    return (metric) => MicroMatch.isMatch(metric.symbol.firstDeclaration.path, glob);
}
function readFileAsync(pth) {
    return new Promise((resolve) => fs_1.readFile(pth, 'utf8', (_, f) => resolve(f)));
}
async function readJsonFile(filePath) {
    return JSON.parse((await readFileAsync(filePath)) || 'null') || undefined;
}
