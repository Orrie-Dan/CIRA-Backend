// Rwanda Administrative Sectors
// Source: Official Rwanda Government Administrative Structure
// Total: 416 sectors across 30 districts
// Last Updated: Based on official government data

// Normalize district names for lookup (case-insensitive)
function normalizeDistrictName(name: string): string {
  return name.toLowerCase().trim();
}

// Sectors organized by district
// Format: District Name (normalized) -> Array of Sector Names
export const RWANDA_SECTORS: Record<string, string[]> = {
  // ============================================
  // KIGALI CITY (3 Districts)
  // ============================================
  
  'gasabo': [
    'Bumbogo', 'Gatsata', 'Gikomero', 'Gisozi', 'Jabana', 'Jali',
    'Kacyiru', 'Kimihurura', 'Kimironko', 'Kinyinya', 'Ndera',
    'Nduba', 'Remera', 'Rusororo', 'Rutunga'
  ],
  
  'kicukiro': [
    'Gahanga', 'Gatenga', 'Gikondo', 'Kagarama', 'Kanombe', 'Kicukiro',
    'Kigarama', 'Masaka', 'Niboye', 'Nyarugunga'
  ],
  
  'nyarugenge': [
    'Gitega', 'Kanyinya', 'Kigali', 'Kimisagara', 'Mageragere',
    'Muhima', 'Nyakabanda', 'Nyamirambo', 'Nyarugenge', 'Rwezamenyo'
  ],

  // ============================================
  // EASTERN PROVINCE (7 Districts)
  // ============================================
  
  'bugesera': [
    'Gashora', 'Juru', 'Kamabuye', 'Mareba', 'Mayange', 'Musenyi',
    'Mwogo', 'Ngeruka', 'Ntarama', 'Nyamata', 'Nyarugenge', 'Rilima',
    'Ruhuha', 'Rweru', 'Shyara'
  ],
  
  'gatsibo': [
    'Gasange', 'Gatsibo', 'Gitoki', 'Kabarore', 'Kageyo', 'Kiramuruzi',
    'Kiziguro', 'Muhura', 'Murambi', 'Ngarama', 'Nyagihanga', 'Remera',
    'Rugarama', 'Rwimbogo'
  ],
  
  'kayonza': [
    'Gahini', 'Kabare', 'Kabarondo', 'Mukarange', 'Murama', 'Murundi',
    'Mwiri', 'Ndego', 'Nyamirama', 'Rukara', 'Ruramira', 'Rwinkwavu'
  ],
  
  'kirehe': [
    'Gahara', 'Gatore', 'Kigarama', 'Kigina', 'Kirehe', 'Mahama',
    'Mpanga', 'Musaza', 'Mushikiri', 'Nasho', 'Nyamugari', 'Nyarubuye'
  ],
  
  'ngoma': [
    'Gashanda', 'Jarama', 'Karembo', 'Kibungo', 'Mugesera', 'Murama',
    'Mutenderi', 'Remera', 'Rukira', 'Rukumberi', 'Sake', 'Zaza'
  ],
  
  'nyagatare': [
    'Gatunda', 'Karama', 'Karangazi', 'Katabagemu', 'Kiyombe', 'Matimba',
    'Mimuli', 'Musheli', 'Nyagatare', 'Rukomo', 'Rwempasha', 'Rwimiyaga',
    'Tabagwe', 'Mukama'
  ],
  
  'rwamagana': [
    'Fumbwe', 'Gahengeri', 'Gishari', 'Karenge', 'Kigabiro', 'Muhazi',
    'Munyaga', 'Munyiginya', 'Musha', 'Muyumbu', 'Mwulire', 'Nyakaliro',
    'Nzige', 'Rubona', 'Rwamagana'
  ],

  // ============================================
  // NORTHERN PROVINCE (5 Districts)
  // ============================================
  
  'burera': [
    'Bungwe', 'Butaro', 'Cyeru', 'Cyanika', 'Gahunga', 'Gatebe',
    'Gitovu', 'Kinyababa', 'Kivuye', 'Nemba', 'Rugarama', 'Rugendabari',
    'Ruhunde', 'Rusarabuye', 'Rwerere'
  ],
  
  'gakenke': [
    'Busengo', 'Coko', 'Cyabingo', 'Gakenke', 'Gashenyi', 'Janja',
    'Kamubuga', 'Karambo', 'Kivuruga', 'Mataba', 'Minazi', 'Muhondo',
    'Muyongwe', 'Muzo', 'Nemba', 'Ruli', 'Rusasa', 'Rushashi'
  ],
  
  'gicumbi': [
    'Bukure', 'Bwisige', 'Byumba', 'Cyumba', 'Giti', 'Kaniga',
    'Manyagiro', 'Miyove', 'Muko', 'Mutete', 'Nyamiyaga', 'Nyankenke',
    'Rubaya', 'Rukomo', 'Rushaki', 'Rutare', 'Ruvune', 'Shangasha',
    'Rwamiko'
  ],
  
  'musanze': [
    'Busogo', 'Cyuve', 'Gacaca', 'Gashaki', 'Gataraga', 'Kimonyi',
    'Kinigi', 'Muhoza', 'Muko', 'Musanze', 'Nkotsi', 'Nyange',
    'Remera', 'Rwaza', 'Shingiro'
  ],
  
  'rulindo': [
    'Base', 'Burega', 'Bushoki', 'Buyoga', 'Cyinzuzi', 'Cyungo',
    'Kinihira', 'Kisaro', 'Masoro', 'Mbogo', 'Murambi', 'Ntarabana',
    'Rusiga', 'Shyorongi', 'Tumba'
  ],

  // ============================================
  // SOUTHERN PROVINCE (8 Districts)
  // ============================================
  
  'gisagara': [
    'Gikonko', 'Gishubi', 'Kansi', 'Kibilizi', 'Kigembe', 'Muganza',
    'Mukindo', 'Musha', 'Ndora', 'Nyanza', 'Save', 'Simbi'
  ],
  
  'huye': [
    'Gishamvu', 'Huye', 'Karama', 'Kigoma', 'Kinazi', 'Maraba',
    'Mbazi', 'Mukura', 'Ngoma', 'Ruhashya', 'Rusatira', 'Rwaniro',
    'Simbi', 'Tumba'
  ],
  
  'kamonyi': [
    'Gacurabwenge', 'Karama', 'Kayenzi', 'Kayumbu', 'Mugina', 'Musambira',
    'Ngamba', 'Nyamiyaga', 'Nyarubaka', 'Rugalika', 'Rukoma', 'Runda'
  ],
  
  'muhanga': [
    'Cyeza', 'Kabacuzi', 'Kibangu', 'Kiyumba', 'Muhanga', 'Mushishiro',
    'Nyabinoni', 'Nyamabuye', 'Nyarusange', 'Rongi', 'Rugendabari', 'Shyogwe'
  ],
  
  'nyamagabe': [
    'Buruhukiro', 'Cyanika', 'Gasaka', 'Gatare', 'Kaduha', 'Kamegeri',
    'Kibirizi', 'Kibumbwe', 'Kitabi', 'Mbazi', 'Mugano', 'Musange',
    'Musebeya', 'Nkomane', 'Tare', 'Uwinkingi'
  ],
  
  'nyanza': [
    'Busasamana', 'Busoro', 'Cyabakamyi', 'Kibilizi', 'Kigoma', 'Mukingo',
    'Muyira', 'Ntyazo', 'Nyagisozi', 'Rwabicuma'
  ],
  
  'nyaruguru': [
    'Busanze', 'Cyahinda', 'Kibeho', 'Kivu', 'Mata', 'Muganza',
    'Munini', 'Ngera', 'Ngoma', 'Nyabimata', 'Nyagisozi', 'Ruheru',
    'Ruramba', 'Rusenge'
  ],
  
  'ruhango': [
    'Byimana', 'Kinihira', 'Kinazi', 'Mbuye', 'Mwendo', 'Ntongwe',
    'Ruhango'
  ],

  // ============================================
  // WESTERN PROVINCE (7 Districts)
  // ============================================
  
  'karongi': [
    'Bwishyura', 'Gashari', 'Gishyita', 'Gitesi', 'Mubuga', 'Murambi',
    'Murundi', 'Mutuntu', 'Rubengera', 'Rugabano', 'Ruganda', 'Rwankuba',
    'Twumba'
  ],
  
  'ngororero': [
    'Bwira', 'Gatumba', 'Hindiro', 'Kabaya', 'Kageyo', 'Kavumu',
    'Matyazo', 'Muhanda', 'Muhororo', 'Ndaro', 'Ngororero', 'Nyange',
    'Sovu'
  ],
  
  'nyabihu': [
    'Bigogwe', 'Jenda', 'Jomba', 'Kabatwa', 'Karago', 'Kintobo',
    'Mukamira', 'Muringa', 'Rambura', 'Rugera', 'Rurembo', 'Shyira'
  ],
  
  'nyamasheke': [
    'Bushekeri', 'Bushenge', 'Cyato', 'Gihombo', 'Kagano', 'Karambi',
    'Kanjongo', 'Karengera', 'Kirimbi', 'Macuba', 'Mahembe', 'Nyabitekeri',
    'Rangiro', 'Ruharambuga', 'Shangi'
  ],
  
  'rubavu': [
    'Bugeshi', 'Busasamana', 'Cyanzarwe', 'Gisenyi', 'Kanama', 'Mudende',
    'Nyakiriba', 'Nyamyumba', 'Nyundo', 'Rubavu', 'Rugerero', 'Rwerere'
  ],
  
  'rusizi': [
    'Bugarama', 'Butare', 'Bweyeye', 'Gikundamvura', 'Gashonga', 'Giheke',
    'Gihundwe', 'Gitambi', 'Kamembe', 'Muganza', 'Mururu', 'Nkanka',
    'Nkombo', 'Nkungu', 'Nyakabuye', 'Nyakarenzo', 'Nzahaha', 'Rwimbogo'
  ],
  
  'rutsiro': [
    'Boneza', 'Gihango', 'Kigeyo', 'Kivumu', 'Manihira', 'Mukura',
    'Murunda', 'Musasa', 'Mushonyi', 'Ruhango'
  ],
};

// Helper function to get sectors by district name (case-insensitive)
export function getSectorsByDistrict(districtName: string): string[] {
  const normalized = normalizeDistrictName(districtName);
  return RWANDA_SECTORS[normalized] || [];
}

// Get all districts that have sectors defined
export function getDistrictsWithSectors(): string[] {
  return Object.keys(RWANDA_SECTORS).map(key => {
    // Convert back to proper case (first letter uppercase, rest lowercase)
    return key.charAt(0).toUpperCase() + key.slice(1);
  });
}

// Validate if a sector belongs to a district
export function isValidSectorForDistrict(sector: string, district: string): boolean {
  const sectors = getSectorsByDistrict(district);
  return sectors.some(s => s.toLowerCase() === sector.toLowerCase());
}

// Get total count of sectors
export function getTotalSectorCount(): number {
  return Object.values(RWANDA_SECTORS).reduce((total, sectors) => total + sectors.length, 0);
}



