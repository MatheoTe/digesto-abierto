// Paso 3 del corpus: la ficha completa de cada ordenanza vigente en la Base de Normas
// (descriptores temáticos y relaciones: qué abroga, deroga o modifica, y quién la modificó).
// Se guarda el HTML crudo comprimido en data/raw/ficha/<n>.html.gz. Reanudable.
//
//   node scripts/crawl/fichas.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const PARALELO = 3
const PAUSA_MS = 250
const UA = 'DigestoAbierto/0.1 (proyecto open source, github.com/MatheoTe)'
const metaDir = path.resolve('data/raw/meta')
const dir = path.resolve('data/raw/ficha')
fs.mkdirSync(dir, { recursive: true })

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function bajar(url, intento = 1) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
    if (r.status === 404) return null
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } catch (e) {
    if (intento >= 4) throw e
    await dormir(2000 * intento ** 2)
    return bajar(url, intento + 1)
  }
}

const pendientes = []
for (const f of fs.readdirSync(metaDir)) {
  const n = f.replace('.json', '')
  if (fs.existsSync(path.join(dir, `${n}.html.gz`))) continue
  const j = JSON.parse(fs.readFileSync(path.join(metaDir, f), 'utf8'))
  if (j.status !== 'OK') continue
  const d = j.data
  if (d.abrogacion_n || d.fec_excluido) continue
  pendientes.push({ n, url: `https://basenormas.concejomdp.gov.ar/normas/show/${d.base || 'normas'}/${d.id}` })
}
pendientes.sort((a, b) => Number(a.n) - Number(b.n))
console.log(`${pendientes.length} fichas por bajar`)

let hechos = 0, errores = 0
async function trabajador() {
  while (pendientes.length) {
    const p = pendientes.shift()
    try {
      const buf = await bajar(p.url)
      if (buf) fs.writeFileSync(path.join(dir, `${p.n}.html.gz`), zlib.gzipSync(buf))
    } catch (e) {
      errores++
      console.error(`${p.n}: ${e.message}`)
    }
    if (++hechos % 500 === 0) console.log(`${new Date().toISOString()} ${hechos} fichas, ${errores} errores`)
    await dormir(PAUSA_MS)
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabajador))
console.log(`listo: ${hechos} fichas, ${errores} errores`)
