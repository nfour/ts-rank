# ts-rank

A quick n simple CLI to rank output from TypeScript@4.1's `compilerOptions.generateTrace` option.

So you can discover where slow types are hiding.

Will output a set of ranked metrics:
- [x] `StructuredTypeCheck` for source files
- [x] `StructuredTypeCheck` for node_modules

Intend to support type alises & other checks, though for now `StructuredTypeCheck` is useful.

+ [Run ts-rank](#run-ts-rank)
+ [Example package.json scripts](#example-packagejson-scripts)
+ [Configure through tsconfig.json](#configure-through-tsconfigjson)
+ [Configure through fork-ts-checker-webpack-plugin](#configure-through-fork-ts-checker-webpack-plugin)

## Run ts-rank

```
npx ts-rank
```

Outputs:

```bash
ts-rank

Ranking output from 'tsconfig.compilerOptions.generateTrace'
  {
    logCount: 5,
    traceFile: '~/.tsTrace/trace.json',
    typesFile: '~/.tsTrace/types.json',
    pattern: '**/*',
    cwd: '~/ts-rank'
  }
  
  :: Reading files: 161.380ms
  :: 72435 traces, 30457 types
  
  'StructuredTypeCheck' source:
     1.        0 ms < __object                       > tsRank.ts:16:12
     2.        0 ms < __function                     > tsRank.ts:143:64
     3.        0 ms < __function                     > tsRank.ts:123:36
     4.        0 ms < __object                       > tsRank.ts:16:12
     5.        0 ms < __function                     > tsRank.ts:136:10
     6.        0 ms < __function                     > tsRank.ts:143:30
     7.        0 ms < __object                       > tsRank.ts:115:34
     8.        0 ms < Symbol                         > tsRank.ts:209:4
     9.        0 ms < __function                     > tsRank.ts:100:30
    10.        0 ms < __function                     > tsRank.ts:92:78
    
  
  'StructuredTypeCheck' node_modules:
     1.       84 ms < ObjectChain                    > node_modules/@types/lodash/common/common.d.ts:205:6
     2.       83 ms < entries                        > node_modules/@types/lodash/common/object.d.ts:599:31
     3.       83 ms < CollectionChain                > node_modules/@types/lodash/common/common.d.ts:181:6
     4.       82 ms < CollectionChain                > node_modules/@types/lodash/common/common.d.ts:181:6
     5.       82 ms < pop                            > node_modules/@types/lodash/common/common.d.ts:182:35
     6.       82 ms < ExpChain                       > node_modules/@types/lodash/common/common.d.ts:15:22
     7.       70 ms < FunctionChain                  > node_modules/@types/lodash/common/common.d.ts:199:6
     8.       59 ms < FunctionChain                  > node_modules/@types/lodash/common/common.d.ts:199:6
     9.       26 ms < Http2SecureServer              > node_modules/@types/node/http2.d.ts:513:6
    10.       17 ms < ClientHttp2Stream              > node_modules/@types/node/http2.d.ts:181:6
    
  :: T: 196.840ms

Done in 5.03s.
```

```bash
> npx ts-rank --help 

ts-rank

Options:
  --version    Show version number                                     [boolean]
  --logCount                                              [number] [default: 10]
  --traceFile                        [string] [default: "./.tsTrace/trace.json"]
  --typesFile                        [string] [default: "./.tsTrace/types.json"]
  --pattern    Ruduce the ranking to files that match this glob         [string]
```

```bash
# Provide location to the trace files generated by generateTrace
npx ts-rank --traceFile trace/trace.json --typesFile trace/types.json

# Use --pattern as a glob to filter rankings based on file path
npx ts-rank --pattern "**/someFolder/**"  
```

## Example package.json scripts

```json
{
  "scripts": {
    "trace": "tsc --noEmit --generateTrace .tsTrace && npx ts-rank",
    "trace:full": "tsc --noEmit --incremental false --tsBuildInfoFile null --generateTrace .tsTrace && npx ts-rank",
  }
}
```

## Configure through tsconfig.json

```json
{
  "compilerOptions": {
    // The folder where the traces go
    "generateTrace": "./.tsTrace",

    // Disable this to get a full trace
    "incremental": false
  }
}
```

Also works with `fork-ts-checker-webpack-plugin`. Try using the `configOverwites` option when configuring the webpack plugin.

## Configure through fork-ts-checker-webpack-plugin

```ts
const isTracingTs = true
const isTracingTsFully = true

new TsPlugin({
  build: false,
  typescript: {
    configOverwrite: {
      compilerOptions: {
        // Making all of this optional with these booleans.
        ...(isTracingTs
          ? {
              generateTrace: './.tsTrace/trace',
              ...(isTracingTsFully ? { incremental: false } : {}),
            }
          : {}),
      },
    },
  },
}),
```
