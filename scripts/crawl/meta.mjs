// Paso 1 del corpus: la ficha de cada ordenanza municipal, por número, desde la Base de Normas
// del Concejo Deliberante de General Pueyrredon. Una petición por número, de a pocas a la vez,
// y reanudable: lo que ya está en data/raw/meta/ no se vuelve a pedir.
//
//   node scripts/crawl/meta.mjs [desde] [hasta]
import fs from 'node:fs'
import path from 'node:path'

const DESDE = Number(process.argv[2] ?? 1)
const HASTA = Number(process.argv[3] ?? 27500)
const PARALELO = 3
const PAUSA_MS = 250
const UA = 'DigestoAbierto/0.1 (proyecto open source, github.com/MatheoTe)'
const dir = path.resolve('data/raw/meta')
fs.mkdirSync(dir, { recursive: true })

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function pedir(n, intento = 1) {
  const url = `https://basenormas.concejomdp.gov.ar/normas/getdata/normabyactonumero/json/normas/acto/or/nro/${n}`
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
    const txt = await r.text()
    if (txt.trimStart().startsWith('<')) throw new Error('devolvió HTML en vez de JSON')
    return JSON.parse(txt)
  } catch (e) {
    if (intento >= 4) throw e
    await dormir(2000 * intento ** 2)
    return pedir(n, intento + 1)
  }
}

const pendientes = []
for (let n = DESDE; n <= HASTA; n++) if (!fs.existsSync(path.join(dir, `${n}.json`))) pendientes.push(n)
console.log(`${pendientes.length} números por pedir (${DESDE}-${HASTA})`)

let hechos = 0, encontradas = 0, errores = 0
async function trabajador() {
  while (pendientes.length) {
    const n = pendientes.shift()
    try {
      const j = await pedir(n)
      fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(j))
      if (j.status === 'OK') encontradas++
    } catch (e) {
      errores++
      console.error(`${n}: ${e.message}`)
    }
    if (++hechos % 500 === 0) console.log(`${new Date().toISOString()} ${hechos} pedidos, ${encontradas} encontradas, ${errores} errores`)
    await dormir(PAUSA_MS)
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabajador))
console.log(`listo: ${hechos} pedidos, ${encontradas} encontradas, ${errores} errores`)
