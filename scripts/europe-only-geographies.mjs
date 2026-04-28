/**
 * Keep only Europe regional aggregate + listed European countries in value/volume/segmentation.
 * Run: node scripts/europe-only-geographies.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicData = path.resolve(__dirname, '..', 'public', 'data')

const EUROPE_COUNTRIES = [
  'Germany',
  'U.K.',
  'France',
  'Spain',
  'Italy',
  'Netherland',
  'Belgium',
  'Poland',
  'Czech Republic',
  'Ireland',
  'Denmark',
  'Sweden',
  'Switzerland',
  'Norway',
  'Rest of Europe',
]

const ALLOWED = new Set(['Europe', ...EUROPE_COUNTRIES])

function filterTopLevelGeoObject(obj) {
  const out = {}
  for (const k of Object.keys(obj)) {
    if (ALLOWED.has(k)) out[k] = obj[k]
  }
  return out
}

function buildSegmentationBeerShell(fromExisting) {
  const g = fromExisting.Global || {}
  const shell = {}
  for (const key of Object.keys(g)) {
    if (key === 'By Region') continue
    shell[key] = g[key]
  }
  shell['By Region'] = {
    Europe: Object.fromEntries(EUROPE_COUNTRIES.map((c) => [c, {}])),
  }
  return { Global: shell }
}

function main() {
  const valuePath = path.join(publicData, 'value.json')
  const volumePath = path.join(publicData, 'volume.json')
  const segPath = path.join(publicData, 'segmentation_analysis.json')

  const value = JSON.parse(fs.readFileSync(valuePath, 'utf8'))
  const volume = JSON.parse(fs.readFileSync(volumePath, 'utf8'))
  const segmentation = JSON.parse(fs.readFileSync(segPath, 'utf8'))

  const newValue = filterTopLevelGeoObject(value)
  const newVolume = filterTopLevelGeoObject(volume)
  const newSeg = buildSegmentationBeerShell(segmentation)

  fs.writeFileSync(valuePath, JSON.stringify(newValue, null, 2), 'utf8')
  fs.writeFileSync(volumePath, JSON.stringify(newVolume, null, 2), 'utf8')
  fs.writeFileSync(segPath, JSON.stringify(newSeg, null, 2), 'utf8')

  console.log('Kept keys:', Object.keys(newValue).sort().join(', '))
  console.log('Count:', Object.keys(newValue).length)
}

main()
