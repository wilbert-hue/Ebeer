/**
 * Migration: replace segment dimensions with beer market taxonomy + Europe By Region hierarchy.
 * Run: node scripts/migrate-beer-segments.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicData = path.join(root, 'public', 'data')

const SEGMENT_TYPES = [
  'By Beer Type',
  'By Alcohol Content',
  'By Price Positioning',
  'By Packaging Format & Pack Size',
  'By Sales / Consumption Channel',
]

const EUROPE_BY_REGION = [
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

const EUROPE_SHARE_RAW = {
  Germany: 0.2,
  'U.K.': 0.14,
  France: 0.14,
  Spain: 0.1,
  Italy: 0.11,
  Netherland: 0.045,
  Belgium: 0.035,
  Poland: 0.065,
  'Czech Republic': 0.03,
  Ireland: 0.025,
  Denmark: 0.02,
  Sweden: 0.03,
  Switzerland: 0.025,
  Norway: 0.018,
  'Rest of Europe': 0.087,
}

function sumMarketByYear(geoNode) {
  const years = {}
  if (!geoNode || typeof geoNode !== 'object') return years
  const segKeys = Object.keys(geoNode).filter((k) => k !== 'By Region')
  if (segKeys.length === 0) return years
  const root = geoNode[segKeys[0]]
  function walk(o) {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o)) {
      if (/^\d{4}$/.test(k)) years[k] = (years[k] || 0) + (typeof v === 'number' ? v : 0)
      else walk(v)
    }
  }
  walk(root)
  return years
}

function scaleYears(yearsObj, factor, roundFn) {
  const o = {}
  for (const y of Object.keys(yearsObj)) {
    o[y] = roundFn((yearsObj[y] || 0) * factor)
  }
  return o
}

function buildBeerStructure(allocByYear, roundFn) {
  const ys = Object.keys(allocByYear).sort()
  const T = (y) => allocByYear[y] || 0

  function leaf(weights) {
    const keys = Object.keys(weights)
    const o = {}
    for (const k of keys) o[k] = {}
    for (const y of ys) {
      const target = T(y)
      let placed = 0
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const isLast = i === keys.length - 1
        const val = isLast ? roundFn(target - placed) : roundFn(target * weights[k])
        o[k][y] = val
        placed += val
      }
    }
    return o
  }

  /**
   * parentWeights: { ParentSegment: shareOfT }
   * childDefs: { ParentSegment: { child: shareOfParent } | null }
   * If childDefs[p] === null, year values attach directly to p (no extra segment level).
   */
  function nested2(parentWeights, childDefs) {
    const out = {}
    for (const pk of Object.keys(parentWeights)) {
      const pw = parentWeights[pk]
      const sub = childDefs[pk]
      out[pk] = {}
      if (sub === null) {
        for (const y of ys) {
          out[pk][y] = roundFn(T(y) * pw)
        }
        continue
      }
      const cKeys = Object.keys(sub)
      for (const y of ys) {
        const parentTotal = T(y) * pw
        let acc = 0
        for (let i = 0; i < cKeys.length; i++) {
          const ck = cKeys[i]
          const isLast = i === cKeys.length - 1
          const part = isLast ? roundFn(parentTotal - acc) : roundFn(parentTotal * sub[ck])
          out[pk][ck] = out[pk][ck] || {}
          out[pk][ck][y] = part
          acc += part
        }
      }
    }
    return out
  }

  return {
    'By Beer Type': leaf({
      Lager: 0.35,
      Ale: 0.15,
      'Wheat Beer': 0.08,
      'Stout & Porter': 0.07,
      Pilsner: 0.12,
      'Specialty / Craft Beer': 0.18,
      'Other Beer Types': 0.05,
    }),
    'By Alcohol Content': leaf({
      'Regular Beer': 0.72,
      'Low-Alcohol Beer': 0.18,
      'Non-Alcoholic Beer': 0.1,
    }),
    'By Price Positioning': leaf({
      'Economy Beer': 0.22,
      'Mainstream Beer': 0.43,
      'Premium Beer': 0.26,
      'Super-Premium / Specialty Beer': 0.09,
    }),
    'By Packaging Format & Pack Size': nested2(
      {
        'Bottled Beer': 0.38,
        'Canned Beer': 0.42,
        'Draught / Keg Beer': 0.15,
        Others: 0.05,
      },
      {
        'Bottled Beer': {
          'Small Bottle: Below 330 ml': 0.12,
          'Standard Bottle: 330 ml': 0.38,
          'Mid-Size Bottle: 440–500 ml': 0.3,
          'Large Bottle: Above 500 ml': 0.2,
        },
        'Canned Beer': {
          'Small Can: Below 330 ml': 0.12,
          'Standard Can: 330 ml': 0.4,
          'Mid-Size Can: 440–500 ml': 0.28,
          'Large Can: Above 500 ml': 0.2,
        },
        'Draught / Keg Beer': {
          'Small Kegs: Up to 10 L': 0.25,
          'Medium Kegs: 10–30 L': 0.45,
          'Large Kegs: Above 30 L': 0.3,
        },
        Others: null,
      }
    ),
    'By Sales / Consumption Channel': nested2(
      { 'On-Trade': 0.45, 'Off-Trade': 0.55 },
      {
        'On-Trade': {
          'Bars & Pubs': 0.35,
          Restaurants: 0.3,
          Hotels: 0.15,
          'Events & Venues': 0.2,
        },
        'Off-Trade': {
          'Supermarkets & Hypermarkets': 0.45,
          'Convenience Stores': 0.18,
          'Liquor Stores': 0.22,
          'Online Retail': 0.15,
        },
      }
    ),
  }
}

function emptyBeerSegmentation() {
  const s = buildBeerStructure({ 2021: 1 }, (x) => x)
  function stripToEmpty(n) {
    if (!n || typeof n !== 'object') return {}
    const o = {}
    for (const [k, v] of Object.entries(n)) {
      if (/^\d{4}$/.test(k)) continue
      const isYearLeaf =
        typeof v === 'object' && v !== null && Object.keys(v).length > 0 && Object.keys(v).every((x) => /^\d{4}$/.test(x))
      o[k] = isYearLeaf ? {} : stripToEmpty(v)
    }
    return o
  }
  const out = {}
  for (const st of SEGMENT_TYPES) {
    out[st] = stripToEmpty(s[st])
  }
  return out
}

function buildSegmentationFile() {
  const beer = emptyBeerSegmentation()
  const byRegion = {
    'North America': { 'U.S.': {}, Canada: {} },
    Europe: Object.fromEntries(EUROPE_BY_REGION.map((c) => [c, {}])),
    'Asia Pacific': {
      China: {},
      India: {},
      Japan: {},
      'South Korea': {},
      ASEAN: {},
      Australia: {},
      'Rest of Asia Pacific': {},
    },
    'Latin America': {
      Brazil: {},
      Argentina: {},
      Mexico: {},
      'Rest of Latin America': {},
    },
    'Middle East & Africa': {
      GCC: {},
      'South Africa': {},
      'Rest of Middle East & Africa': {},
    },
  }
  return {
    Global: {
      ...beer,
      'By Region': byRegion,
    },
  }
}

function migrateDataFile(filePath, isVolume) {
  const roundFn = isVolume ? (x) => Math.round(x) : (x) => Math.round(x * 1000) / 1000
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const europeTotals = sumMarketByYear(raw['Europe'] || raw['Germany'] || Object.values(raw)[0])
  const wSum = EUROPE_BY_REGION.reduce((a, c) => a + EUROPE_SHARE_RAW[c], 0)
  const wNorm = Object.fromEntries(EUROPE_BY_REGION.map((c) => [c, EUROPE_SHARE_RAW[c] / wSum]))

  const out = {}
  const keys = Object.keys(raw).filter((k) => k !== 'Russia')

  for (const geo of keys) {
    const alloc = sumMarketByYear(raw[geo])
    if (Object.keys(alloc).length === 0) continue
    out[geo] = buildBeerStructure(alloc, roundFn)
  }

  for (const c of EUROPE_BY_REGION) {
    const alloc = scaleYears(europeTotals, wNorm[c], roundFn)
    out[c] = buildBeerStructure(alloc, roundFn)
  }

  if (raw['Europe'] && Object.keys(europeTotals).length > 0) {
    out['Europe'] = buildBeerStructure(europeTotals, roundFn)
  }

  return out
}

function main() {
  const valuePath = path.join(publicData, 'value.json')
  const volumePath = path.join(publicData, 'volume.json')
  const segPath = path.join(publicData, 'segmentation_analysis.json')

  fs.writeFileSync(valuePath, JSON.stringify(migrateDataFile(valuePath, false), null, 2), 'utf8')
  fs.writeFileSync(volumePath, JSON.stringify(migrateDataFile(volumePath, true), null, 2), 'utf8')
  fs.writeFileSync(segPath, JSON.stringify(buildSegmentationFile(), null, 2), 'utf8')

  console.log('Updated value.json, volume.json, segmentation_analysis.json')
}

main()
