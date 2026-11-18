/**
 * Districts of the 5 served states (P2 §7.1): TN 38, KL 14, KA 31, TG 33, AP 26 = 142.
 * Coordinates are APPROXIMATE district-headquarters values (good enough for "approx. road km"
 * and nearest-district lookup; not survey data). Isomorphic, framework-free.
 *
 * Each row: [id, name, state, hqPlaceId, hqName, lat, lng]. `hqPlaceId` is the hub place
 * representing the district HQ (usually the same slug as the district).
 */
import type { DistrictId, PlaceId, StateCode } from "../model";

export interface District {
  id: DistrictId;
  name: string;
  state: StateCode;
  hqPlaceId: PlaceId;
  hqName: string;
  hq: { lat: number; lng: number };
}

type Row = [id: string, name: string, state: StateCode, hqPlaceId: string | null, hqName: string | null, lat: number, lng: number];

const ROWS: Row[] = [
  // ── Tamil Nadu (38) ─────────────────────────────────────────────────────────
  ["ariyalur", "Ariyalur", "TN", null, null, 11.1401, 79.0786],
  ["chengalpattu", "Chengalpattu", "TN", null, null, 12.6921, 79.9766],
  ["chennai", "Chennai", "TN", null, null, 13.0827, 80.2707],
  ["coimbatore", "Coimbatore", "TN", null, null, 11.0168, 76.9558],
  ["cuddalore", "Cuddalore", "TN", null, null, 11.748, 79.7714],
  ["dharmapuri", "Dharmapuri", "TN", null, null, 12.1211, 78.1582],
  ["dindigul", "Dindigul", "TN", null, null, 10.3673, 77.9803],
  ["erode", "Erode", "TN", null, null, 11.341, 77.7172],
  ["kallakurichi", "Kallakurichi", "TN", null, null, 11.738, 78.959],
  ["kanchipuram", "Kanchipuram", "TN", null, null, 12.8342, 79.7036],
  ["kanniyakumari", "Kanniyakumari", "TN", "nagercoil", "Nagercoil", 8.1833, 77.4119],
  ["karur", "Karur", "TN", null, null, 10.9601, 78.0766],
  ["krishnagiri", "Krishnagiri", "TN", null, null, 12.5266, 78.215],
  ["madurai", "Madurai", "TN", null, null, 9.9252, 78.1198],
  ["mayiladuthurai", "Mayiladuthurai", "TN", null, null, 11.1018, 79.6521],
  ["nagapattinam", "Nagapattinam", "TN", null, null, 10.7672, 79.8449],
  ["namakkal", "Namakkal", "TN", null, null, 11.2189, 78.1677],
  ["nilgiris", "The Nilgiris", "TN", "ooty", "Udhagamandalam (Ooty)", 11.4102, 76.695],
  ["perambalur", "Perambalur", "TN", null, null, 11.2342, 78.8807],
  ["pudukkottai", "Pudukkottai", "TN", null, null, 10.3833, 78.8001],
  ["ramanathapuram", "Ramanathapuram", "TN", null, null, 9.3639, 78.8395],
  ["ranipet", "Ranipet", "TN", null, null, 12.9224, 79.3326],
  ["salem", "Salem", "TN", null, null, 11.6643, 78.146],
  ["sivaganga", "Sivaganga", "TN", null, null, 9.8433, 78.4809],
  ["tenkasi", "Tenkasi", "TN", null, null, 8.9594, 77.3157],
  ["thanjavur", "Thanjavur", "TN", null, null, 10.787, 79.1378],
  ["theni", "Theni", "TN", null, null, 10.0104, 77.4768],
  ["thoothukudi", "Thoothukudi", "TN", null, null, 8.7642, 78.1348],
  ["tiruchirappalli", "Tiruchirappalli", "TN", null, null, 10.7905, 78.7047],
  ["tirunelveli", "Tirunelveli", "TN", null, null, 8.7139, 77.7567],
  ["tirupathur", "Tirupathur", "TN", null, null, 12.495, 78.5678],
  ["tiruppur", "Tiruppur", "TN", null, null, 11.1085, 77.3411],
  ["tiruvallur", "Tiruvallur", "TN", null, null, 13.1231, 79.912],
  ["tiruvannamalai", "Tiruvannamalai", "TN", null, null, 12.2253, 79.0747],
  ["tiruvarur", "Tiruvarur", "TN", null, null, 10.7661, 79.6344],
  ["vellore", "Vellore", "TN", null, null, 12.9165, 79.1325],
  ["viluppuram", "Viluppuram", "TN", null, null, 11.9401, 79.4861],
  ["virudhunagar", "Virudhunagar", "TN", null, null, 9.568, 77.9624],
  // ── Kerala (14) ─────────────────────────────────────────────────────────────
  ["thiruvananthapuram", "Thiruvananthapuram", "KL", null, null, 8.5241, 76.9366],
  ["kollam", "Kollam", "KL", null, null, 8.8932, 76.6141],
  ["pathanamthitta", "Pathanamthitta", "KL", null, null, 9.2648, 76.787],
  ["alappuzha", "Alappuzha", "KL", null, null, 9.4981, 76.3388],
  ["kottayam", "Kottayam", "KL", null, null, 9.5916, 76.5222],
  ["idukki", "Idukki", "KL", "painavu", "Painavu", 9.85, 76.97],
  ["ernakulam", "Ernakulam", "KL", "kochi", "Kochi", 9.9312, 76.2673],
  ["thrissur", "Thrissur", "KL", null, null, 10.5276, 76.2144],
  ["palakkad", "Palakkad", "KL", null, null, 10.7867, 76.6548],
  ["malappuram", "Malappuram", "KL", null, null, 11.051, 76.0711],
  ["kozhikode", "Kozhikode", "KL", null, null, 11.2588, 75.7804],
  ["wayanad", "Wayanad", "KL", "kalpetta", "Kalpetta", 11.6085, 76.083],
  ["kannur", "Kannur", "KL", null, null, 11.8745, 75.3704],
  ["kasaragod", "Kasaragod", "KL", null, null, 12.4996, 74.9869],
  // ── Karnataka (31) ──────────────────────────────────────────────────────────
  ["bagalkot", "Bagalkot", "KA", null, null, 16.1691, 75.6615],
  ["ballari", "Ballari", "KA", null, null, 15.1394, 76.9214],
  ["belagavi", "Belagavi", "KA", null, null, 15.8497, 74.4977],
  ["bengaluru-rural", "Bengaluru Rural", "KA", "devanahalli", "Devanahalli", 13.2473, 77.712],
  ["bengaluru-urban", "Bengaluru Urban", "KA", "bengaluru", "Bengaluru", 12.9716, 77.5946],
  ["bidar", "Bidar", "KA", null, null, 17.9104, 77.5199],
  ["chamarajanagar", "Chamarajanagar", "KA", null, null, 11.9261, 76.9437],
  ["chikkaballapur", "Chikkaballapur", "KA", null, null, 13.4355, 77.7315],
  ["chikkamagaluru", "Chikkamagaluru", "KA", null, null, 13.3161, 75.772],
  ["chitradurga", "Chitradurga", "KA", null, null, 14.2251, 76.398],
  ["dakshina-kannada", "Dakshina Kannada", "KA", "mangaluru", "Mangaluru", 12.9141, 74.856],
  ["davanagere", "Davanagere", "KA", null, null, 14.4644, 75.9218],
  ["dharwad", "Dharwad", "KA", null, null, 15.4589, 75.0078],
  ["gadag", "Gadag", "KA", null, null, 15.4315, 75.6355],
  ["hassan", "Hassan", "KA", null, null, 13.0072, 76.0962],
  ["haveri", "Haveri", "KA", null, null, 14.7951, 75.3991],
  ["kalaburagi", "Kalaburagi", "KA", null, null, 17.3297, 76.8343],
  ["kodagu", "Kodagu", "KA", "madikeri", "Madikeri", 12.4244, 75.7382],
  ["kolar", "Kolar", "KA", null, null, 13.1362, 78.1291],
  ["koppal", "Koppal", "KA", null, null, 15.3547, 76.1548],
  ["mandya", "Mandya", "KA", null, null, 12.5218, 76.8951],
  ["mysuru", "Mysuru", "KA", null, null, 12.2958, 76.6394],
  ["raichur", "Raichur", "KA", null, null, 16.212, 77.3439],
  ["ramanagara", "Bengaluru South (Ramanagara)", "KA", null, "Ramanagara", 12.7209, 77.2799],
  ["shivamogga", "Shivamogga", "KA", null, null, 13.9299, 75.5681],
  ["tumakuru", "Tumakuru", "KA", null, null, 13.3379, 77.1173],
  ["udupi", "Udupi", "KA", null, null, 13.3409, 74.7421],
  ["uttara-kannada", "Uttara Kannada", "KA", "karwar", "Karwar", 14.8136, 74.1297],
  ["vijayapura", "Vijayapura", "KA", null, null, 16.8302, 75.71],
  ["vijayanagara", "Vijayanagara", "KA", "hosapete", "Hosapete", 15.2689, 76.3909],
  ["yadgir", "Yadgir", "KA", null, null, 16.77, 77.1376],
  // ── Telangana (33) ──────────────────────────────────────────────────────────
  ["adilabad", "Adilabad", "TG", null, null, 19.6641, 78.532],
  ["bhadradri-kothagudem", "Bhadradri Kothagudem", "TG", "kothagudem", "Kothagudem", 17.55, 80.62],
  ["hanumakonda", "Hanumakonda", "TG", null, null, 18.0072, 79.5584],
  ["hyderabad", "Hyderabad", "TG", null, null, 17.385, 78.4867],
  ["jagtial", "Jagtial", "TG", null, null, 18.7895, 78.912],
  ["jangaon", "Jangaon", "TG", null, null, 17.7227, 79.1518],
  ["jayashankar-bhupalpally", "Jayashankar Bhupalpally", "TG", "bhupalpally", "Bhupalpally", 18.438, 79.866],
  ["jogulamba-gadwal", "Jogulamba Gadwal", "TG", "gadwal", "Gadwal", 16.235, 77.7956],
  ["kamareddy", "Kamareddy", "TG", null, null, 18.32, 78.337],
  ["karimnagar", "Karimnagar", "TG", null, null, 18.4386, 79.1288],
  ["khammam", "Khammam", "TG", null, null, 17.2473, 80.1514],
  ["kumuram-bheem-asifabad", "Kumuram Bheem Asifabad", "TG", "asifabad", "Asifabad", 19.365, 79.283],
  ["mahabubabad", "Mahabubabad", "TG", null, null, 17.6, 80.0],
  ["mahabubnagar", "Mahabubnagar", "TG", null, null, 16.7488, 78.0035],
  ["mancherial", "Mancherial", "TG", null, null, 18.871, 79.444],
  ["medak", "Medak", "TG", null, null, 18.045, 78.263],
  ["medchal-malkajgiri", "Medchal-Malkajgiri", "TG", "medchal", "Medchal", 17.6297, 78.4814],
  ["mulugu", "Mulugu", "TG", null, null, 18.191, 79.944],
  ["nagarkurnool", "Nagarkurnool", "TG", null, null, 16.482, 78.324],
  ["nalgonda", "Nalgonda", "TG", null, null, 17.0575, 79.2671],
  ["narayanpet", "Narayanpet", "TG", null, null, 16.745, 77.496],
  ["nirmal", "Nirmal", "TG", null, null, 19.096, 78.344],
  ["nizamabad", "Nizamabad", "TG", null, null, 18.6725, 78.0941],
  ["peddapalli", "Peddapalli", "TG", null, null, 18.614, 79.374],
  ["rajanna-sircilla", "Rajanna Sircilla", "TG", "sircilla", "Sircilla", 18.388, 78.81],
  ["ranga-reddy", "Ranga Reddy", "TG", "shamshabad", "Shamshabad", 17.2403, 78.4294],
  ["sangareddy", "Sangareddy", "TG", null, null, 17.614, 78.0816],
  ["siddipet", "Siddipet", "TG", null, null, 18.1018, 78.852],
  ["suryapet", "Suryapet", "TG", null, null, 17.1405, 79.6236],
  ["vikarabad", "Vikarabad", "TG", null, null, 17.338, 77.904],
  ["wanaparthy", "Wanaparthy", "TG", null, null, 16.362, 78.062],
  ["warangal", "Warangal", "TG", null, null, 17.9689, 79.5941],
  ["yadadri-bhuvanagiri", "Yadadri Bhuvanagiri", "TG", "bhongir", "Bhongir", 17.51, 78.89],
  // ── Andhra Pradesh (26) ─────────────────────────────────────────────────────
  ["srikakulam", "Srikakulam", "AP", null, null, 18.2949, 83.8938],
  ["parvathipuram-manyam", "Parvathipuram Manyam", "AP", "parvathipuram", "Parvathipuram", 18.783, 83.425],
  ["vizianagaram", "Vizianagaram", "AP", null, null, 18.1067, 83.3956],
  ["visakhapatnam", "Visakhapatnam", "AP", null, null, 17.6868, 83.2185],
  ["alluri-sitharama-raju", "Alluri Sitharama Raju", "AP", "paderu", "Paderu", 18.079, 82.667],
  ["anakapalli", "Anakapalli", "AP", null, null, 17.691, 83.004],
  ["kakinada", "Kakinada", "AP", null, null, 16.9891, 82.2475],
  ["east-godavari", "East Godavari", "AP", "rajamahendravaram", "Rajamahendravaram", 17.0005, 81.804],
  ["konaseema", "Dr. B.R. Ambedkar Konaseema", "AP", "amalapuram", "Amalapuram", 16.578, 82.006],
  ["eluru", "Eluru", "AP", null, null, 16.7107, 81.0952],
  ["west-godavari", "West Godavari", "AP", "bhimavaram", "Bhimavaram", 16.5449, 81.5212],
  ["ntr", "NTR", "AP", "vijayawada", "Vijayawada", 16.5062, 80.648],
  ["krishna", "Krishna", "AP", "machilipatnam", "Machilipatnam", 16.1875, 81.1389],
  ["palnadu", "Palnadu", "AP", "narasaraopet", "Narasaraopet", 16.235, 80.049],
  ["guntur", "Guntur", "AP", null, null, 16.3067, 80.4365],
  ["bapatla", "Bapatla", "AP", null, null, 15.904, 80.467],
  ["prakasam", "Prakasam", "AP", "ongole", "Ongole", 15.5057, 80.0499],
  ["nellore", "Sri Potti Sriramulu Nellore", "AP", null, "Nellore", 14.4426, 79.9865],
  ["kurnool", "Kurnool", "AP", null, null, 15.8281, 78.0373],
  ["nandyal", "Nandyal", "AP", null, null, 15.4786, 78.4836],
  ["anantapur", "Anantapuramu", "AP", null, "Anantapur", 14.6819, 77.6006],
  ["sri-sathya-sai", "Sri Sathya Sai", "AP", "puttaparthi", "Puttaparthi", 14.165, 77.811],
  ["ysr-kadapa", "YSR Kadapa", "AP", "kadapa", "Kadapa", 14.4673, 78.8242],
  ["annamayya", "Annamayya", "AP", "rayachoti", "Rayachoti", 14.058, 78.751],
  ["tirupati", "Tirupati", "AP", null, null, 13.6288, 79.4192],
  ["chittoor", "Chittoor", "AP", null, null, 13.2172, 79.1003],
];

export const DISTRICTS: readonly District[] = ROWS.map(([id, name, state, hqPlaceId, hqName, lat, lng]) => ({
  id,
  name,
  state,
  hqPlaceId: hqPlaceId ?? id,
  hqName: hqName ?? name,
  hq: { lat, lng },
}));

const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));

export function getDistrict(id: string | null | undefined): District | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isDistrictId(id: unknown): id is DistrictId {
  return typeof id === "string" && BY_ID.has(id);
}

export function districtName(id: string | null | undefined): string {
  return getDistrict(id)?.name ?? id ?? "";
}

export function districtsInState(state: StateCode): District[] {
  return DISTRICTS.filter((d) => d.state === state).sort((a, b) => a.name.localeCompare(b.name));
}
