"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const lodash_1 = require("lodash");
const path_1 = require("path");
const yargs_1 = require("yargs");
const MicroMatch = require("micromatch");
const c = console;
const cwd = process.cwd();
const typeChars = 30; // TODO: automate
const durChars = 7; // TODO: automate
let { logCount, traceFile, typesFile, pattern = '**/*' } = yargs_1.default(process.argv.slice(2))
    .usage('ts-rank')
    .options({
    logCount: { type: 'number', default: 10 },
    traceFile: { type: 'string', default: './.tsTrace/trace.json' },
    typesFile: { type: 'string', default: './.tsTrace/types.json' },
    pattern: { type: 'string', desc: 'Ruduce the ranking to files that match this glob' },
}).argv;
traceFile = path_1.resolve(cwd, traceFile);
typesFile = path_1.resolve(cwd, typesFile);
void (async () => {
    c.time(':: T');
    c.log(``);
    c.group(`ts-rank\n\nRanking output from %o`, `tsconfig.compilerOptions.generateTrace`);
    c.dir({ logCount, traceFile, typesFile, pattern, cwd });
    c.log(``);
    c.time(':: Reading files');
    const [trace = [], types = []] = await Promise.all([
        readJsonFile(traceFile),
        readJsonFile(typesFile),
    ]);
    c.timeEnd(':: Reading files');
    c.log(':: %o traces, %o types', trace.length, types.length);
    const strucTypeMetrics = mapStructuredTypes({ trace, types }).filter(FilterByGlob(pattern));
    const moduleMetrics = rankMetricsByDur(strucTypeMetrics.filter(({ isNodeModule }) => isNodeModule));
    const nonModuleMetrics = rankMetricsByDur(strucTypeMetrics.filter(({ isNodeModule }) => !isNodeModule));
    c.group('\n%o source:', 'StructuredTypeCheck');
    logMetricGroup(nonModuleMetrics);
    c.groupEnd();
    c.group('\n%o node_modules:', 'StructuredTypeCheck');
    logMetricGroup(moduleMetrics);
    c.groupEnd();
    c.timeEnd(':: T');
    c.groupEnd();
    c.log('');
})();
function logMetricGroup(metrics) {
    let count = 0;
    for (const metric of metrics)
        c.log(`${++count}. `.padStart(logCount.toString().length + 2), metricLogMsg(metric));
    c.log('');
}
function metricLogMsg({ symbol: { firstDeclaration: { end, path, start }, symbolName, }, check, }) {
    const relPath = path_1.relative(cwd, path);
    return `${check.dur.toFixed(0).padStart(durChars)} ms < ${symbolName
        .slice(0, typeChars)
        .padEnd(typeChars)} > ${relPath}:${start.line}:${start.character}`;
}
function mapStructuredTypes({ trace, types }) {
    const structuredTypeChecks = trace.filter(({ cat, name }) => cat === 'check' && name === 'structuredTypeRelatedTo');
    const structuredTypeMetrics = [];
    /** Important for performance */
    const sourceIdIndexMap = new Map(structuredTypeChecks.map(({ args: { sourceId } }, index) => [sourceId, index]));
    // For loop for perf
    for (const item of types) {
        if ('symbolName' in item) {
            // Ignored
            // TODO: ?? utilize this for reference/alias listing??
            if (!item.firstDeclaration)
                continue;
            const symbol = item;
            const check = structuredTypeChecks[sourceIdIndexMap.get(symbol.id)];
            if (!check)
                continue;
            structuredTypeMetrics.push({
                symbol,
                check,
                isNodeModule: symbol.firstDeclaration.path.includes('/node_modules'),
            });
        }
    }
    return structuredTypeMetrics.map((item) => ({
        ...item,
        isNodeModule: item.symbol.firstDeclaration.path.includes('/node_modules'),
    }));
}
function FilterByGlob(glob) {
    return (metric) => MicroMatch.isMatch(metric.symbol.firstDeclaration.path, glob);
}
function rankMetricsByDur(metrics) {
    return lodash_1.orderBy(metrics, ['check.dur'], 'desc')
        .slice(0, logCount)
        .map((item) => ({
        ...item,
        isNodeModule: item.symbol.firstDeclaration.path.includes('/node_modules'),
    }));
}
function readFileAsync(pth) {
    return new Promise((resolve) => fs_1.readFile(pth, 'utf8', (_, f) => resolve(f)));
}
async function readJsonFile(filePath) {
    return JSON.parse((await readFileAsync(filePath)) || 'null') || undefined;
}
