#!/usr/bin/env node

import { readFile } from 'fs'
import { orderBy } from 'lodash'
import { relative, resolve } from 'path'
import Yargs from 'yargs'
import * as MicroMatch from 'micromatch'

const c = console
const cwd = process.cwd()
const typeChars = 30 // TODO: automate
const durChars = 7 // TODO: automate

let { logCount, traceFile, typesFile, pattern = '**/*' } = Yargs(process.argv.slice(2))
  .usage('ts-rank')
  .options({
    logCount: { type: 'number', default: 10 },
    traceFile: { type: 'string', default: './.tsTrace/trace.json' },
    typesFile: { type: 'string', default: './.tsTrace/types.json' },
    pattern: { type: 'string', desc: 'Ruduce the ranking to files that match this glob' },
  }).argv

traceFile = resolve(cwd, traceFile)
typesFile = resolve(cwd, typesFile)

void (async () => {
  c.time(':: T')
  c.log(``)
  c.group(`ts-rank\n\nRanking output from %o`, `tsconfig.compilerOptions.generateTrace`)
  c.dir({ logCount, traceFile, typesFile, pattern, cwd })
  c.log(``)

  c.time(':: Reading files')

  const [trace = [], types = []] = await Promise.all([
    readJsonFile<TraceJson.Json>(traceFile),
    readJsonFile<TypesJson.Json>(typesFile),
  ])

  c.timeEnd(':: Reading files')

  c.log(':: %o traces, %o types', trace.length, types.length)

  const strucTypeMetrics = mapStructuredTypes({ trace, types }).filter(FilterByGlob(pattern))
  const moduleMetrics = rankMetricsByDur(
    strucTypeMetrics.filter(({ isNodeModule }) => isNodeModule)
  )
  const nonModuleMetrics = rankMetricsByDur(
    strucTypeMetrics.filter(({ isNodeModule }) => !isNodeModule)
  )

  c.group('\n%o source:', 'StructuredTypeCheck')
  logMetricGroup(nonModuleMetrics)
  c.groupEnd()

  c.group('\n%o node_modules:', 'StructuredTypeCheck')
  logMetricGroup(moduleMetrics)
  c.groupEnd()

  c.timeEnd(':: T')
  c.groupEnd()
  c.log('')
})()

function logMetricGroup(metrics: Metric[]) {
  let count = 0

  for (const metric of metrics)
    c.log(`${++count}. `.padStart(logCount.toString().length + 2), metricLogMsg(metric))

  c.log('')
}

function metricLogMsg({
  symbol: {
    firstDeclaration: { end, path, start },
    symbolName,
  },
  check,
}: Metric) {
  const relPath = relative(cwd, path)
  const dur = check!.dur / 1000 // Get ms

  return `${dur.toFixed(0).padStart(durChars)} ms < ${symbolName
    .slice(0, typeChars)
    .padEnd(typeChars)} > ${relPath}:${start.line}:${start.character}`
}

type MappedSymbolMetrics = ReturnType<typeof mapStructuredTypes>

function mapStructuredTypes({ trace, types }: TraceAndTypes) {
  const structuredTypeChecks: TraceJson.CheckStructuredType[] = trace.filter(
    ({ cat, name }) => cat === 'check' && name === 'structuredTypeRelatedTo'
  ) as any[]

  const structuredTypeMetrics: Metric[] = []

  /** Important for performance */
  const sourceIdIndexMap = new Map(
    structuredTypeChecks.map(({ args: { sourceId } }, index) => [sourceId, index] as const)
  )

  // For loop for perf
  for (const item of types) {
    if ('symbolName' in item) {
      // Ignored
      // TODO: ?? utilize this for reference/alias listing??
      if (!item.firstDeclaration) continue

      const symbol = item as Metric['symbol']
      const check = structuredTypeChecks[sourceIdIndexMap.get(symbol.id)!]

      if (!check) continue

      structuredTypeMetrics.push({
        symbol,
        check,
        isNodeModule: symbol.firstDeclaration.path.includes('/node_modules'),
      })
    }
  }

  return structuredTypeMetrics.map((item) => ({
    ...item,
    isNodeModule: item.symbol.firstDeclaration.path.includes('/node_modules'),
  }))
}

function FilterByGlob(glob: string) {
  return (metric: Metric) => MicroMatch.isMatch(metric.symbol.firstDeclaration.path, glob)
}

function rankMetricsByDur(metrics: MappedSymbolMetrics) {
  return orderBy(metrics, ['check.dur'], 'desc')
    .slice(0, logCount)
    .map((item) => ({
      ...item,
      isNodeModule: item.symbol.firstDeclaration.path.includes('/node_modules'),
    }))
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
    cat: 'check'
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
    firstDeclaration?: { path: string; start: CodePos; end: CodePos }
    flags: string[]
  }
  export type Item = Intrinsic | Symbol
  export type Json = Item[]
}
