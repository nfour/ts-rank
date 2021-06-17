#!/usr/bin/env node

import { readFile } from 'fs'
import { groupBy, orderBy, sortBy, sumBy } from 'lodash'
import { dirname, relative, resolve, sep } from 'path'
import Yargs from 'yargs'
import * as MicroMatch from 'micromatch'
import * as clc from "cli-color";

const cwd = process.cwd()
const TYPE_CHARS_LEN = 30 // TODO: automate

let { FILE_LIMIT, FILE_TYPE_LIMIT, TRACE_FILE, TYPES_FILE, PATTERN = '**/*' } = Yargs(process.argv.slice(2))
  .usage('ts-rank')
  .options({
    FILE_LIMIT: { type: 'number', default: 50, alias: 'f' },
    FILE_TYPE_LIMIT: { type: 'number', default: 10, alias: 't' },
    TRACE_FILE: { type: 'string', default: './.tsTrace/trace.json' },
    TYPES_FILE: { type: 'string', default: './.tsTrace/types.json' },
    PATTERN: { type: 'string', desc: 'Ruduce the ranking to files that match this glob', alias: 'p' },
  }).argv

TRACE_FILE = resolve(cwd, TRACE_FILE)
TYPES_FILE = resolve(cwd, TYPES_FILE)

const validCheckMetricsSymbols = ['structuredTypeRelatedTo']

void (async () => {
  console.time(':: Parse time')
  console.log(``)
  console.group(`ts-rank\n\nRanking output from %o`, `tsconfig.compilerOptions.generateTrace`)
  console.dir({ FILE_LIMIT, FILE_TYPE_LIMIT, TRACE_FILE, TYPES_FILE, PATTERN, cwd })
  console.log(``)

  console.time(':: Reading files')

  const [trace = [], types = []] = await Promise.all([
    readJsonFile<TraceJson.Json>(TRACE_FILE),
    readJsonFile<TypesJson.Json>(TYPES_FILE),
  ])

  console.timeEnd(':: Reading files')
  console.log('')


  const checkMetrics = getSymbolCheckMetrics({ trace, types })
  const filteredCheckMetrics = checkMetrics.filter(FilterByGlob(PATTERN))
  const durationTotal = sumByMetricDuration(filteredCheckMetrics) / 1000
  const metricsByPath = Object.entries(groupBy(filteredCheckMetrics, 'symbol.firstDeclaration.path'))
  const orderedMetrics = sortBy(metricsByPath, ([path, metrics]) =>
    sumByMetricDuration(metrics)
  )
    .reverse()
  
  console.group(`:: Files ranked by type check duration:`)
  console.log('')

  let fileCount = FILE_LIMIT+1

  orderedMetrics
    .slice(0, FILE_LIMIT)
    .reverse()
    .forEach(([_, metrics]) => {
      const totalTime = parseFloat(
        (sumByMetricDuration(metrics) / 1000).toFixed(2)
      )

      const percentage = ((totalTime / durationTotal) * 100).toFixed(0)

      --fileCount
      
      console.group(clc.blackBright(`  ${`# ${clc.bold.cyan(fileCount)}`.padEnd(29)} ${clc.bold.red(totalTime)} ms ${`(${clc.bold.green(percentage + ' %')} of total metrics)`} ${`(${clc.greenBright(metrics.length)} metrics)`}`))

      const typeMetrics = orderBy(metrics, ['check.dur'], 'desc')
        .slice(0, FILE_TYPE_LIMIT)
      
      console.log('')

      for (const metric of typeMetrics)
        console.log(`  ${cli.metric(metric)}`)

      console.log('')
      console.groupEnd()
    })

  console.groupEnd()
  console.timeEnd(':: Parse time')
  console.log(':: %o total traces, %o total types', trace.length, types.length)
  console.log(`:: Measured %o check metrics of kind: [${validCheckMetricsSymbols.map((s) => clc.cyan(s)).join(',')}]`, checkMetrics.length)
  console.log(`:: ${durationTotal.toFixed(0)} ms total measured duration`, )
  console.log('')

  // orderedMetrics.slice(0,3).map(([k, metrics]) => console.log(metrics[0]))
})()


const cli = {
  count: (v: number, n = 2) => `${clc.bold(v)}`.padEnd(n.toString().length+1),
  time: (v: number) =>
    clc.bold(v.toFixed(0)),
  
  symbolName: (v: string) =>
    clc.bold.blueBright(v.slice(0, TYPE_CHARS_LEN).padEnd(TYPE_CHARS_LEN)),
  
  filePath: (path: string, pos?: { line: number, character: number }) => {
    const dir = dirname(path)
    const pathTxt = `${dir + sep}${clc.underline.bold(relative(dir, path))}`
    return !pos ? pathTxt : pathTxt + clc.blackBright(`:${pos.line}:${pos.character}`);
  },
  
  metric({
    symbol: {
      firstDeclaration: { end, path, start },
      symbolName,
    },
    check,
  }: Metric) {
    const relPath = relative(cwd, path)
    const dur = check!.dur / 1000 // Get ms

    return `${(clc.bold.yellow(dur.toFixed(0)) + ' ms').padEnd(27)} ${cli.symbolName(symbolName)} ${cli.filePath(relPath, start)}`
  }
}

type MappedSymbolMetrics = ReturnType<typeof getSymbolCheckMetrics>

function sumByMetricDuration (metrics: Metric[]) { return sumBy(metrics, 'check.dur') }


function getSymbolCheckMetrics({ trace, types }: TraceAndTypes) {

  // TODO: can we log the position of checkSourceFile and mark subsequent checks with it?

  const checks: TraceJson.CheckStructuredType[] = trace.filter(
    ({ cat, name }) => (cat === 'checkTypes' || cat === 'check') && validCheckMetricsSymbols.includes(name)
  ) as any[]

  const metrics: Metric[] = []

  /** Important for performance */
  const sourceIdIndexMap = new Map(
    checks.map(({ args: { sourceId } }, index) => [sourceId, index] as const)
  )


  // For loop for perf
  for (const item of types) {
    if (!('symbolName' in item)) continue

    // Ignored
    // TODO: ?? utilize this for reference/alias listing??
    if (!item.firstDeclaration) {
      continue
    }

    const symbol = item as Metric['symbol']
    const check = checks[sourceIdIndexMap.get(symbol.id)!]

    if (!check) continue

    metrics.push({
      symbol,
      check,
      isNodeModule: symbol.firstDeclaration.path.includes('/node_modules'),
    })
    
  }
  return metrics
}

function FilterByGlob(glob: string) {
  return (metric: Metric) => MicroMatch.isMatch(metric.symbol.firstDeclaration.path, glob)
}


function readFileAsync(pth: string) {
  return new Promise<string>((resolve) => readFile(pth, 'utf8', (_, f) => resolve(f)))
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  return JSON.parse((await readFileAsync(filePath)) || 'null') || undefined
}

interface Metric {
  symbol: Required<TypesJson.Symbol>
  check: TraceJson.CheckStructuredType
  isNodeModule?: boolean
}

type TraceAndTypes = { trace: TraceJson.Json; types: TypesJson.Json }

/**
 * @example {"pid":1,"tid":1,"ph":"B","cat":"program","ts":498615.0050163269,"name":"createProgram"},
 * @example {"pid":1,"tid":1,"ph":"E","cat":"parse","ts":619472.7280139923,"name":"createSourceFile","args":{"path":".../node_modules/@types/react/global.d.ts"}},
 * @example {"pid":1,"tid":1,"ph":"X","cat":"program","ts":739688.894033432,"name":"findSourceFile","dur":2283.663034439087,"args":{"fileName":".../node_modules/@types/prop-types/index.d.ts","refKind":"Import"}},
 * @example {"pid":1,"tid":1,"ph":"X","cat":"check","ts":8021808.152079582,"name":"structuredTypeRelatedTo","dur":52.452921867370605,"args":{"sourceId":15179,"targetId":11404}},
 */
namespace TraceJson {
  export interface CheckSourceFile {
    cat: 'check'
    ts: number
    name: 'checkSourceFile'
    args: { path: string }
  }

  export interface CheckExpression {
    cat: 'check'
    ts: number
    name: 'checkExpression' | 'checkVariableDeclaration'
    dur: number
    args: { kind: number; pos: number; end: number }
  }

  export interface CheckStructuredType {
    cat: 'check'|'checkTypes'
    ts: number
    name: 'structuredTypeRelatedTo'
    dur: number
    args: { sourceId: number; targetId: number }
  }

  export type Item = CheckSourceFile | CheckExpression | CheckStructuredType
  export type Json = Item[]
}

/**
 * @example [{"id":1,"intrinsicName":"any","flags":["Any"]},
 * @example {"id":56,"symbolName":"IArguments","recursionId":1,"firstDeclaration":{"path":".../node_modules/typescript/lib/lib.es5.d.ts","start":{"line":386,"character":2},"end":{"line":392,"character":2}},"flags":["Object"]},
 * @example {"id":56,"symbolName":"IArguments","recursionId":1,"firstDeclaration":{"path":".../node_modules/typescript/lib/lib.es5.d.ts","start":{"line":386,"character":2},"end":{"line":392,"character":2}},"flags":["Object"]},
 * @example {"id":32225,"symbolName":"FaunaMusselsBiomassScalesTypeModelType","firstDeclaration":{"path":".../src/models/gql/FaunaMusselsBiomassScalesTypeModel.ts","start":{"line":2,"character":99},"end":{"line":5,"character":124}},"flags":["TypeParameter","IncludesStructuredOrInstantiable"]},
 * @example {"id":3890,"symbolName":"props","recursionId":33,"firstDeclaration":{"path":"/node_modules/mobx-state-tree/dist/types/complex-types/model.d.ts","start":{"line":82,"character":73},"end":{"line":83,"character":163}},"flags":["524288"],"display":"<PROPS2 extends ModelPropertiesDeclaration>(props: PROPS2) => IModelType<PROPS & ModelPropertiesDeclarationToProperties<PROPS2>, OTHERS, ?, CustomS>"},
 */
namespace TypesJson {
  interface CodePos {
    line: number
    character: number
  }

  export type Intrinsic = {
    id: number
    intrinsicName: string
    flags: string[]
  }
  export type Symbol = {
    id: number
    symbolName: string
    recursionId?: number
    instantiatedType?: number
    firstDeclaration?: { path: string; start: CodePos; end: CodePos }
    flags: string[]
    display?: string
  }
  export type Item = Intrinsic | Symbol
  export type Json = Item[]
}
