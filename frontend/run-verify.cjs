// 用 typescript（纯 JS）即时转储 .ts 后执行验证脚本，绕开平台不匹配的 esbuild 原生二进制。
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const root = __dirname
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (/\.(ts|mts|cts)$/.test(request)) {
    return path.resolve(path.dirname(parent.filename), request)
  }
  return originalResolve.call(this, request, parent, ...rest)
}
require.extensions['.ts'] = compileTs
require.extensions['.mts'] = compileTs
require.extensions['.cts'] = compileTs

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(out.outputText, filename)
}

require(path.join(root, 'scripts', 'verify-domain.cts'))
