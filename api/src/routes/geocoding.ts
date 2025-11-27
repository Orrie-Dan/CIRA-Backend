import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getSectorsByDistrict } from '../data/rwanda-sectors.js'

const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
})

// Rwanda's approximate bounding box
const RWANDA_BOUNDS = {
  minLat: -2.84,
  maxLat: -1.05,
  minLon: 28.86,
  maxLon: 30.90,
}

// All 30 districts of Rwanda
const RWANDA_DISTRICTS = new Set([
    'kicukiro', 'gasabo', 'nyarugenge',
    'bugesera', 'gatsibo', 'kayonza', 'kirehe', 'ngoma', 'nyagatare', 'rwamagana',
    'burera', 'gakenke', 'gicumbi', 'musanze', 'rulindo',
    'gisagara', 'huye', 'kamonyi', 'muhanga', 'nyamagabe', 'nyanza', 'nyaruguru', 'ruhango',
    'karongi', 'ngororero', 'nyabihu', 'nyamasheke', 'rubavu', 'rusizi', 'rutsiro',
])

const DISTRICT_TO_PROVINCE: Record<string, string> = {
  'kicukiro': 'Kigali City', 'gasabo': 'Kigali City', 'nyarugenge': 'Kigali City',
  'bugesera': 'Eastern Province', 'gatsibo': 'Eastern Province', 'kayonza': 'Eastern Province',
  'kirehe': 'Eastern Province', 'ngoma': 'Eastern Province', 'nyagatare': 'Eastern Province',
  'rwamagana': 'Eastern Province',
  'burera': 'Northern Province', 'gakenke': 'Northern Province', 'gicumbi': 'Northern Province',
  'musanze': 'Northern Province', 'rulindo': 'Northern Province',
  'gisagara': 'Southern Province', 'huye': 'Southern Province', 'kamonyi': 'Southern Province',
  'muhanga': 'Southern Province', 'nyamagabe': 'Southern Province', 'nyanza': 'Southern Province',
  'nyaruguru': 'Southern Province', 'ruhango': 'Southern Province',
  'karongi': 'Western Province', 'ngororero': 'Western Province', 'nyabihu': 'Western Province',
  'nyamasheke': 'Western Province', 'rubavu': 'Western Province', 'rusizi': 'Western Province',
  'rutsiro': 'Western Province',
}

interface NominatimAddress {
  country?: string
  country_code?: string
  state?: string
  region?: string
  province?: string
  county?: string
  district?: string
  city?: string
  city_district?: string
  municipality?: string
  town?: string
  suburb?: string
  neighbourhood?: string
  locality?: string
  quarter?: string
  village?: string
  hamlet?: string
  road?: string
  residential?: string
  pedestrian?: string
  path?: string
  footway?: string
  [key: string]: string | undefined
}

interface NominatimResponse {
  display_name?: string
  address?: NominatimAddress
  boundingbox?: string[]
  osm_type?: string
  osm_id?: number
}

interface GeocodeResult {
  addressText: string
  province?: string
  district?: string
  sector?: string
  cell?: string
  village?: string
  road?: string
  confidence: 'high' | 'medium' | 'low'
  sources: {
    province?: string
    district?: string
    sector?: string
  }
}

function isInRwanda(lat: number, lon: number): boolean {
  return (
    lat >= RWANDA_BOUNDS.minLat &&
    lat <= RWANDA_BOUNDS.maxLat &&
    lon >= RWANDA_BOUNDS.minLon &&
    lon <= RWANDA_BOUNDS.maxLon
  )
}

function cleanName(name: string | undefined): string | undefined {
  if (!name) return undefined
  
  let cleaned = name.trim()
  
  // Remove Kinyarwanda prefixes
  cleaned = cleaned.replace(/^(Akarere ka|Umurenge wa?'?|Intara ya?'?)\s+/i, '')
  
  // Remove English prefixes
  cleaned = cleaned.replace(/^(District of|Sector of|Province of)\s+/i, '')
  
  // Remove suffixes
  cleaned = cleaned.replace(/\s+(District|Sector|Province|City)$/i, '')
  
  return cleaned.trim()
}

function normalizeDistrictName(name: string): string {
  const cleaned = cleanName(name)
  if (!cleaned) return name
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
}

function normalizeSectorName(name: string): string {
  const cleaned = cleanName(name)
  if (!cleaned) return name
  return cleaned
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Extract road/street name from multiple possible fields
 */
function extractRoad(address: NominatimAddress): string | undefined {
  const roadCandidates = [
    address.road,
    address.pedestrian,
    address.path,
    address.footway,
    address.residential,
  ]
  
  for (const candidate of roadCandidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  
  return undefined
}

/**
 * Multi-zoom strategy: Query at different zoom levels to get better administrative data
 */
async function queryNominatim(lat: number, lon: number, zoom: number): Promise<NominatimResponse | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CIRA-Infrastructure-Reporting/1.0',
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch (error) {
    return null
  }
}

/**
 * Extract district from response with confidence scoring
 */
function extractDistrict(data: NominatimResponse): { district?: string, confidence: 'high' | 'medium' | 'low', source?: string } {
  const address = data.address
  if (!address) return { confidence: 'low' }
  
  // Priority order for district extraction
  const candidates: Array<{ value: string | undefined, source: string, priority: number }> = [
    { value: address.county, source: 'county', priority: 1 },
    { value: address.district, source: 'district', priority: 2 },
    { value: address.city_district, source: 'city_district', priority: 3 },
    { value: address.municipality, source: 'municipality', priority: 4 },
    { value: address.city, source: 'city', priority: 5 },
  ]
  
  for (const candidate of candidates) {
    if (!candidate.value) continue
    
    const cleaned = cleanName(candidate.value)
    if (cleaned && RWANDA_DISTRICTS.has(cleaned.toLowerCase())) {
      return {
        district: normalizeDistrictName(cleaned),
        confidence: candidate.priority <= 2 ? 'high' : 'medium',
        source: candidate.source
      }
    }
  }
  
  return { confidence: 'low' }
}

/**
 * Extract sector with improved heuristics
 */
function extractSector(data: NominatimResponse, district?: string): { sector?: string, confidence: 'high' | 'medium' | 'low', source?: string } {
  const address = data.address
  if (!address) return { confidence: 'low' }
  
  // Direct address field candidates
  const candidates: Array<{ value: string | undefined, source: string }> = [
    { value: address.suburb, source: 'suburb' },
    { value: address.neighbourhood, source: 'neighbourhood' },
    { value: address.town, source: 'town' },
    { value: address.locality, source: 'locality' },
  ]
  
  // Check direct candidates
  for (const candidate of candidates) {
    if (!candidate.value) continue
    
    const cleaned = cleanName(candidate.value)
    if (cleaned) {
      const lower = cleaned.toLowerCase()
      
      // Exclude if it's a district or province
      if (RWANDA_DISTRICTS.has(lower)) continue
      if (lower.includes('province') || lower === 'rwanda') continue
      
      // Exclude if it looks like a road
      const roadKeywords = ['road', 'street', 'avenue', 'boulevard', 'highway', 'route']
      if (roadKeywords.some(kw => lower.includes(kw))) continue
      
      return {
        sector: normalizeSectorName(cleaned),
        confidence: 'medium',
        source: candidate.source
      }
    }
  }
  
  // Parse display_name as fallback
  if (data.display_name) {
    const parts = data.display_name.split(',').map(p => p.trim())
    
    // Find the part between road and district
    for (let i = 0; i < parts.length; i++) {
      const cleaned = cleanName(parts[i])
      if (!cleaned) continue
      
      const lower = cleaned.toLowerCase()
      
      // Skip if it's a known district
      if (RWANDA_DISTRICTS.has(lower)) continue
      
      // Skip if it's a province indicator
      if (lower.includes('province') || lower === 'rwanda') continue
      
      // Skip obvious road names
      if (lower.includes('road') || lower.includes('street')) continue
      
      // If we have a district, look for parts before it that aren't roads
      if (district) {
        const districtIndex = parts.findIndex(p => {
          const c = cleanName(p)
          return c && RWANDA_DISTRICTS.has(c.toLowerCase())
        })
        
        if (districtIndex > 0 && i < districtIndex && i > 0) {
          return {
            sector: normalizeSectorName(cleaned),
            confidence: 'low',
            source: 'display_name'
          }
        }
      }
    }
  }
  
  return { confidence: 'low' }
}

/**
 * Merge results from multiple zoom levels
 */
function mergeResults(results: NominatimResponse[]): GeocodeResult {
  let bestDistrict: { district?: string, confidence: 'high' | 'medium' | 'low', source?: string } = { confidence: 'low' }
  let bestSector: { sector?: string, confidence: 'high' | 'medium' | 'low', source?: string } = { confidence: 'low' }
  let province: string | undefined
  let road: string | undefined
  let cell: string | undefined
  let village: string | undefined
  
  // Extract from all results, preferring higher confidence
  for (const result of results) {
    const districtResult = extractDistrict(result)
    if (districtResult.district && 
        (districtResult.confidence === 'high' || !bestDistrict.district)) {
      bestDistrict = districtResult
    }
    
    const sectorResult = extractSector(result, bestDistrict.district)
    if (sectorResult.sector && 
        (sectorResult.confidence === 'high' || sectorResult.confidence === 'medium' || !bestSector.sector)) {
      bestSector = sectorResult
    }
    
    // Extract other fields from first available result
    if (!road && result.address) {
      road = extractRoad(result.address)
    }
    if (!cell && result.address) {
      cell = result.address.quarter || result.address.cell
    }
    if (!village && result.address) {
      village = result.address.village || result.address.hamlet
    }
  }
  
  // Derive province from district
  if (bestDistrict.district) {
    const cleaned = cleanName(bestDistrict.district)
    if (cleaned) {
      province = DISTRICT_TO_PROVINCE[cleaned.toLowerCase()]
    }
  }
  
  // Build address text
  const addressParts: string[] = []
  if (road) addressParts.push(road)
  if (bestSector.sector) addressParts.push(bestSector.sector)
  if (bestDistrict.district) addressParts.push(`${bestDistrict.district} District`)
  if (province) addressParts.push(province)
  addressParts.push('Rwanda')
  
  const addressText = addressParts.join(', ')
  
  // Overall confidence
  let overallConfidence: 'high' | 'medium' | 'low' = 'low'
  if (bestDistrict.confidence === 'high' && bestSector.confidence !== 'low') {
    overallConfidence = 'high'
  } else if (bestDistrict.confidence !== 'low' || bestSector.confidence !== 'low') {
    overallConfidence = 'medium'
  }
  
  return {
    addressText,
    province,
    district: bestDistrict.district,
    sector: bestSector.sector,
    cell,
    village,
    road,
    confidence: overallConfidence,
    sources: {
      province: province ? 'derived' : undefined,
      district: bestDistrict.source,
      sector: bestSector.source,
    }
  }
}

export async function geocodingRoutes(app: FastifyInstance) {
  app.get('/geocoding/reverse', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = reverseGeocodeQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parsed.error.flatten(),
          requestId: req.id,
        },
      })
    }

      const { lat, lon } = parsed.data
      
    if (!isInRwanda(lat, lon)) {
      app.log.warn({ lat, lon }, 'Coordinates outside Rwanda bounds')
      return reply.code(400).send({
        error: {
          code: 'OUT_OF_BOUNDS',
          message: 'Coordinates are outside Rwanda',
          requestId: req.id,
        },
      })
    }

    try {
      // Multi-zoom strategy: Query at different zoom levels
      // zoom 18: detailed (building level)
      // zoom 14: district level
      // zoom 10: province level
      const zoomLevels = [18, 14, 10]
      const results: NominatimResponse[] = []
      
      for (const zoom of zoomLevels) {
        const result = await queryNominatim(lat, lon, zoom)
        if (result) {
          // Validate it's in Rwanda
          if (result.address?.country_code?.toLowerCase() === 'rw') {
            results.push(result)
            app.log.debug({ zoom, display_name: result.display_name }, 'Nominatim response')
          }
        }
        
        // Small delay to respect rate limits
        if (zoom !== zoomLevels[zoomLevels.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      if (results.length === 0) {
        app.log.warn({ lat, lon }, 'No valid Nominatim results')
        return reply.code(502).send({
          error: {
            code: 'GEOCODING_FAILED',
            message: 'Failed to reverse geocode coordinates',
            requestId: req.id,
          },
        })
      }

      // Merge results from all zoom levels
      const geocodeResult = mergeResults(results)
      
      app.log.info({
        lat,
        lon,
        result: geocodeResult,
      }, 'Geocoding successful')
      
      return reply.send(geocodeResult)
      
    } catch (error) {
      app.log.error(error, 'Reverse geocoding error')
      return reply.code(500).send({
        error: {
          code: 'GEOCODING_ERROR',
          message: 'Internal error during geocoding',
          requestId: req.id,
        },
      })
    }
  })

  // Forward geocode: address to coordinates
  app.get('/geocoding/forward', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { q?: string }
    const queryString = query.q

    if (!queryString || queryString.trim().length === 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter "q" is required',
          requestId: req.id,
        },
      })
    }

    try {
      // Add Rwanda to the query to improve results
      const searchQuery = `${queryString.trim()}, Rwanda`
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&addressdetails=1&countrycodes=rw`
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CIRA-Infrastructure-Reporting/1.0',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        app.log.warn(`Nominatim forward geocoding failed: ${response.status} ${response.statusText}`)
        return reply.code(502).send({
          error: {
            code: 'GEOCODING_FAILED',
            message: 'Failed to geocode address',
            requestId: req.id,
          },
        })
      }

      const results = await response.json()

      if (!Array.isArray(results) || results.length === 0) {
        return reply.send({
          results: [],
          message: 'No locations found for the given address',
        })
      }

      // Process results and validate they're in Rwanda
      const validResults = results
        .map((result: any) => {
          const lat = parseFloat(result.lat)
          const lon = parseFloat(result.lon)
          
          if (!isInRwanda(lat, lon)) {
            return null
          }

          // Extract address components
          const address = result.address || {}
          const road = address.road || ''
          const sector = address.suburb || address.neighbourhood || address.town || ''
          const district = address.county || address.district || address.city || ''
          const province = address.state || address.region || address.province || ''

          return {
            latitude: lat,
            longitude: lon,
            displayName: result.display_name || queryString,
            address: {
              road,
              sector,
              district,
              province,
            },
          }
        })
        .filter((result: any) => result !== null)

      if (validResults.length === 0) {
        return reply.send({
          results: [],
          message: 'No locations found in Rwanda for the given address',
        })
      }

      return reply.send({
        results: validResults,
      })
    } catch (error) {
      app.log.error(error, 'Forward geocoding error')
      return reply.code(500).send({
        error: {
          code: 'GEOCODING_ERROR',
          message: 'Internal error during geocoding',
          requestId: req.id,
        },
      })
    }
  })

  // Get sectors by district
  app.get('/geocoding/sectors', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { district?: string }
    const districtName = query.district

    if (!districtName || districtName.trim().length === 0) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'District parameter is required',
          requestId: req.id,
        },
      })
    }

    try {
      const sectors = getSectorsByDistrict(districtName.trim())
      
      if (sectors.length === 0) {
        app.log.warn({ district: districtName }, 'No sectors found for district')
        return reply.send({
          district: districtName,
          sectors: [],
          count: 0,
          message: 'No sectors found for the specified district',
        })
      }

      return reply.send({
        district: districtName,
        sectors: sectors.sort(), // Return alphabetically sorted
        count: sectors.length,
      })
    } catch (error) {
      app.log.error(error, 'Error fetching sectors')
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch sectors',
          requestId: req.id,
        },
      })
    }
  })
}
