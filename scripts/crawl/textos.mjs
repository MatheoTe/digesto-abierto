// Paso 2 del corpus: el texto de cada ordenanza vigente. Primero el "texto actualizado" que publica
// la Biblioteca del Concejo (consolida las modificaciones); si no existe, el texto original.
// Se guarda el HTML crudo comprimido en data/raw/texto/<n>.html.gz y la fuente en <n>.json.
// Reanudable: lo que ya tiene su .json no se vuelve a pedir.
//
//   node scripts/crawl/textos.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const PARALELO = 3
const PAUSA_MS = 250
const UA = 'DigestoAbierto/0.1 (proyecto open source, github.com/MatheoTe)'
const metaDir = path.resolve('data/raw/meta')
const dir = path.resolve('data/raw/texto')
fs.mkdirSync(dir, { recursive: true })

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const NO_DISPONIBLE = 'EL DOCUMENTO SOLICITADO NO SE ENCUENTRA DISPONIBLE'

async function bajar(url, intento = 1) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })
    if (r.status === 404) return null
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 30000 && buf.toString('latin1').includes(NO_DISPONIBLE)) return null
    return buf
  } catch (e) {
    if (intento >= 4) throw e
    await dormir(2000 * intento ** 2)
    return bajar(url, intento + 1)
  }
}

const limpia = (u) => (u ? u.replace(/\?.*$/, '') : null)

const pendientes = []
for (const f of fs.readdirSync(metaDir)) {
  const n = f.replace('.json', '')
  if (fs.existsSync(path.join(dir, `${n}.json`))) continue
  const j = JSON.parse(fs.readFileSync(path.join(metaDir, f), 'utf8'))
  if (j.status !== 'OK') continue
  const d = j.data
  if (d.abrogacion_n || d.fec_excluido) continue
  pendientes.push({ n, actualizado: limpia(d.url_actualizado_html), original: limpia(d.url_html) })
}
pendientes.sort((a, b) => Number(a.n) - Number(b.n))
console.log(`${pendientes.length} ordenanzas vigentes por bajar`)

let hechos = 0, actualizados = 0, originales = 0, sinTexto = 0, errores = 0
async function trabajador() {
  while (pendientes.length) {
    const p = pendientes.shift()
    try {
      let fuente = null, url = null, buf = null
      if (p.actualizado) { buf = await bajar(p.actualizado); if (buf) { fuente = 'actualizado'; url = p.actualizado } }
      if (!buf && p.original) { await dormir(PAUSA_MS); buf = await bajar(p.original); if (buf) { fuente = 'original'; url = p.original } }
      if (buf) fs.writeFileSync(path.join(dir, `${p.n}.html.gz`), zlib.gzipSync(buf))
      fs.writeFileSync(path.join(dir, `${p.n}.json`), JSON.stringify({ fuente, url, bytes: buf?.length ?? 0, bajado: new Date().toISOString() }))
      if (fuente === 'actualizado') actualizados++; else if (fuente === 'original') originales++; else sinTexto++
    } catch (e) {
      errores++
      console.error(`${p.n}: ${e.message}`)
    }
    if (++hechos % 250 === 0) console.log(`${new Date().toISOString()} ${hechos} hechas: ${actualizados} actualizadas, ${originales} originales, ${sinTexto} sin texto, ${errores} errores`)
    await dormir(PAUSA_MS)
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabajador))
console.log(`listo: ${hechos} hechas: ${actualizados} actualizadas, ${originales} originales, ${sinTexto} sin texto, ${errores} errores`)
