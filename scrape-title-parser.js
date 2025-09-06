/***** INPUTS *****/
const {
  tableName = "Sitemap Scraped",
  recordId,
  titleField = "PageTitle",
  brandField = "Brand Detected",                     // preferred brand field
  modelField = "Detected Model",
  modelNormField = "Detected Model (Normalized)",
  confField = "Model Confidence",
  noModelField = "No Model Detected",
  parserVersionField = "Parser Version",
  debugField = "Parser Debug",
  listingIdField = "Listing ID",
  seriesField = "Model Series",
  brandModelIdField = "BrandModel ID",               // optional TEXT copy of the key
  brandModelField = "BrandModel"                     // LINKED or TEXT field (relationship)
} = input.config();

if (!tableName) throw new Error("Missing input: tableName");
if (!recordId) throw new Error("Missing input: recordId");

/***** CONSTANTS *****/
const PARSER_VERSION = "v1.7.4";

/***** UTILITIES *****/
function toRegexSafe(s){return s.replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&");}

/* Canonical brands + aliases (exact list you provided, with common variants) */
const BRAND_ALIAS_MAP = [
  { canonical: "Mazak",       aliases: ["MAZAK","YAMAZAKI MAZAK","YAMAZAKI","MAZAK OPTONICS"] },
  { canonical: "Okuma",       aliases: ["OKUMA","OKUMA AMERICA","OKUMA & HOWA","OKUMA-HOWA","OKUMA HOWA"] },
  { canonical: "Makino",      aliases: ["MAKINO","LEBLOND MAKINO","LEBLOND-MAKINO"] },
  { canonical: "DMG MORI",    aliases: ["DMG MORI","DMG-MORI","MORI SEIKI","MORI-SEIKI","DMG"] },
  { canonical: "Zimmermann",  aliases: ["ZIMMERMANN","F. ZIMMERMANN","FRIEDRICH ZIMMERMANN"] },
  { canonical: "Tacchi",      aliases: ["TACCHI","GIACOMO TACCHI","TARNIO TACCHI","TARNIO\\s+TACCHI"] },
  { canonical: "Grob",        aliases: ["GROB","GROB-WERKE","GROB WERKE"] },
  { canonical: "Doosan",      aliases: ["DOOSAN","DN SOLUTIONS","DN-SOLUTIONS","DAEWOO"] }
];
const BRAND_ALIASES_FLAT = BRAND_ALIAS_MAP.flatMap(x => x.aliases);
const BRAND_REGEX = new RegExp(
  "\\b(?:" + BRAND_ALIASES_FLAT.map(s=>toRegexSafe(s).replace(/\s+/g,"\\s*")).join("|") + ")\\b","gi"
);

/* Boilerplate / marketing to drop */
const STOP_PHRASES = [
  "CNC MACHINE TOOLS","MACHINE TOOLS","MULTI[- ]?TASKING MACHINES?","EQUIPMENT FOR SALE",
  "MACHINING CENTERS?","HORIZONTAL","VERTICAL","LASER","MILL","MILLS","CENTER","CENTERS","MACHINES?",
  "CNC LATHES?","CNC LATHE","LATHES?","LATHE","5[- ]AXIS","4[- ]AXIS","3[- ]AXIS","2[- ]AXIS","AXIS",
  "USED","NEW","GOOD","EXCELLENT","NEEDS WORK","PRODUCTS?","CATALOG(UE)?","SERIES","EXPLORE",
  "GANTRY","PALLETECH","WATT","WATTS","TABLE","CONTROL","LIVE TOOL","LIVE TOOLING",
  "VIDEO AVAILABLE","UNDER POWER","FOR SALE","BAND SAWS"
];
const STOP_REGEX = new RegExp("\\b(?:" + STOP_PHRASES.join("|") + ")\\b","gi");

/* Series tokens (added NLX, LYNX, PUMA) */
const SERIES_WORD =
  "(?:INTEGREX|VARIAXIS|QUICK\\s*TURN|QT\\s*NEXUS|QTN|QTS|QTU|SQT|SMART|MAZATECH|VTC|VCN|MTV|FG|UN|UD|AJV|HC\\s*NEXUS|PFH|FH|FJV|VQC|MACTURN|MULTUS|LB|LU|MU|MB|GENOS|CAPTAIN|CADET|LOC|LT|MX|MA|MILLAC|IMPACT|SPACE\\s*TURN|DMU|DMP|DMV|CLX|CTX|NRX|NZX|ULTRASONIC|CVG|PGV|IGV|GP|MCC|EDNC|EDAF|U|L2|MMC2|FZP|FZU|FZ|NLX|LYNX|PUMA)";

/* Tokens — allow dots (U6 H.E.A.T) and handle digit-first variants */
const MODEL_TOKEN =
  "([A-Za-z0-9][A-Za-z0-9\\-/.]*?(?:\\s*[IVX]+)?(?:\\s+(?:S|ST|M|Y|MY|MS|MSY|HP))?)";
const SERIES_MODEL_RE = new RegExp(`\\b${SERIES_WORD}\\s+${MODEL_TOKEN}\\b`, "i");

/* Modelish: letter-first with hyphen/slash/dots */
const MODELISH_RE =
  /\b([A-Z]{1,12}[A-Z0-9]*[-/][A-Z0-9/ .-]*[A-Z0-9](?:\s*[IVX]+)?(?:\s+(?:S|ST|M|Y|MY|MS|MSY|HP))?)\b/i;

/* Modelish: digit-first (e.g., 4V-24) */
const MODELISH_DIGIT_FIRST_RE =
  /\b([0-9][A-Z0-9]*[-/][A-Z0-9/ .-]*[A-Z0-9](?:\s*[IVX]+)?(?:\s+(?:S|ST|M|Y|MY|MS|MSY|HP))?)\b/i;

/* Alnum+digits fallback (allow multi-letter tails like 2100LSYB, TT1800SY3) */
const ALNUM_NUM_RE =
  /\b([A-Z]{1,12}\s?\d{2,6}[A-Z0-9]{0,6}(?:\s*[IVX]+)?(?:\s+(?:S|ST|M|Y|MY|MS|MSY|HP))?)\b/i;

function normalizeModel(model){
  if(!model) return model;
  let m = model.toUpperCase().trim();
  m = m.replace(/\s*-\s*/g, "-");             // tighten hyphens
  m = m.replace(/(\d)\s+([A-Z]+)/g, "$1$2");  // 100 S -> 100S
  m = m.replace(/\b([A-Z])\s+(\d)/g, "$1$2"); // H 15 -> H15
  m = m.replace(/\bVQC\s*20\s*40B\b/, "VQC 20/40B"); // special case
  m = m.replace(/\s{2,}/g, " ").trim();
  return m;
}

function detectSeries(model){
  if(!model) return "";
  const u = model.toUpperCase();
  const seriesList = [
    "INTEGREX","VARIAXIS","QUICK TURN","QT NEXUS","QTN","QTS","QTU","SQT","SMART","MAZATECH",
    "VTC","VCN","MTV","FG","UN","UD","AJV","HC NEXUS","PFH","FH","FJV","VQC","MACTURN","MULTUS",
    "LB","LU","MU","MB","GENOS","CAPTAIN","CADET","LOC","LT","MX","MA","MILLAC","IMPACT","SPACE TURN",
    "DMU","DMP","DMV","CLX","CTX","NRX","NZX","ULTRASONIC","CVG","PGV","IGV","GP","MCC","EDNC","EDAF",
    "U","L2","MMC2","FZP","FZU","FZ","NLX","LYNX","PUMA"
  ];
  for (const s of seriesList) if (u.startsWith(s+" ") || u === s) return s;
  return "";
}

function canonicalizeBrandName(raw) {
  if (!raw) return "";
  const cleaned = String(raw).trim().toUpperCase();
  for (const { canonical, aliases } of BRAND_ALIAS_MAP) {
    const canonRE = new RegExp("^" + toRegexSafe(canonical.toUpperCase()).replace(/\s+/g,"\\s*") + "$", "i");
    if (canonRE.test(cleaned)) return canonical;
    for (const a of aliases) {
      const re = new RegExp("^" + a.replace(/\s+/g,"\\s*") + "$", "i");
      if (re.test(cleaned)) return canonical;
    }
  }
  return "";
}

function detectBrandFromTitle(title) {
  const t = (title || "").toUpperCase();
  for (const { canonical, aliases } of BRAND_ALIAS_MAP) {
    const hay = [canonical.toUpperCase(), ...aliases];
    for (const term of hay) {
      const re = new RegExp("\\b" + term.replace(/\s+/g,"\\s*") + "\\b", "i");
      if (re.test(t)) return canonical;
    }
  }
  return "";
}

function extractListingId(title){
  const m = String(title).match(/#\s?(\d+)/);
  return m ? m[1] : "";
}

function extractModel(rawTitle){
  const debug = [];
  if(!rawTitle) return {model:"No Model Detected", confidence:0, debug};

  // 1) normalize
  let t = String(rawTitle)
    .replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
    .replace(/&#8211;|–/g,"-").replace(/&#039;|’|'/g,"'")
    .replace(/\u2026|\.{3}$/g,"").trim();
  debug.push(["normalized", t]);

  // 2) remove site tails and IDs
  t = t.replace(/\s*\|\s*.*$/,"")
       .replace(/\s+\-\s*(MachineTools\.com|Equipt|Premier Equipment|Revelation Machinery|The Equipment Hub|DMG MORI)\b.*$/i,"")
       .replace(/\s+#\d+\b.*$/,"").trim();
  debug.push(["strip site/id", t]);

  // 3) remove boilerplate
  t = t.replace(/\bUSED\b/gi,"").replace(/\bNEW\b/gi,"")
       .replace(/\b(19|20)\d{2}[A-Za-z]?\b/g,"")
       .replace(/\((?:[^()]*)\)/g,"")
       .replace(/\bPALLETECH\b.*$/i,"")
       .replace(/\/\s*GL-?\d+[A-Z0-9\-]*\s*(?:GANTRY)?/gi,"")
       .replace(/\bWITH\s+[A-Z0-9\-]+(?:\s+[A-Z0-9\-]+)*\b/gi,"")
       .replace(/,\s*(LOW\s+HOURS|TOOLING\s+INCLUDED|UNDER\s+POWER|VIDEO\s+AVAILABLE)\b/gi,"")
       .replace(/\/\s*\d+\s*"?/g,"")
       .replace(/\s{2,}/g," ").trim();
  debug.push(["strip accessories", t]);

  // 4) strip brands and stop words
  const withoutBrands = t.replace(BRAND_REGEX," ").replace(/\s{2,}/g," ").trim();
  const stripped = withoutBrands.replace(STOP_REGEX," ").replace(/\s{2,}/g," ").trim();
  debug.push(["strip brands+stops", stripped]);

  if(!stripped) return {model:"No Model Detected", confidence:0.1, debug};

  // 5) normalize lone i/j before digits
  let s = stripped.replace(/\b([ij])(?=\s*[-]?\s*\d)/g,(m,g1)=>g1.toUpperCase());

  // 6) match in order
  let m = s.match(SERIES_MODEL_RE);
  if(m){ const candidate = m[0].toUpperCase().trim();
         return {model: normalizeModel(candidate), confidence: 0.96, debug}; }

  m = s.match(MODELISH_RE);
  if(m){ return {model: normalizeModel(m[1]), confidence: 0.93, debug}; }

  m = s.match(MODELISH_DIGIT_FIRST_RE);
  if(m){ return {model: normalizeModel(m[1]), confidence: 0.92, debug}; }

  m = s.match(ALNUM_NUM_RE);
  if(m){ return {model: normalizeModel(m[1]), confidence: 0.88, debug}; }

  return {model:"No Model Detected", confidence:0.1, debug};
}

/***** MAIN *****/
const table = base.getTable(tableName);
const record = await table.selectRecordAsync(recordId);
if (!record) throw new Error(`Record not found: ${recordId}`);

const pageTitle = record.getCellValueAsString(titleField);
if (!pageTitle) throw new Error(`Record ${recordId} missing '${titleField}'.`);

const fieldNames = table.fields.map(f => f.name);

// brand field: prefer “Brand Detected”, fallback to legacy “Detected Brand”, or provided name
const brandFieldResolved =
  ["Brand Detected","Detected Brand",brandField].find(n => fieldNames.includes(n));

const {model, confidence, debug} = extractModel(pageTitle);
const listingId = extractListingId(pageTitle);
const series = model && model !== "No Model Detected" ? detectSeries(model) : "";

// pick brand from record or title
let recordBrand = brandFieldResolved ? record.getCellValueAsString(brandFieldResolved) : "";
let brandCanonical = canonicalizeBrandName(recordBrand);
if (!brandCanonical) {
  const detected = detectBrandFromTitle(pageTitle);
  if (detected) brandCanonical = detected;
}
const brandForKey = (brandCanonical || recordBrand || "").trim();

// build key once (avoid timing/race)
const normalizedModel = model && model !== "No Model Detected" ? normalizeModel(model) : "";
const brandModelKey = (brandForKey && normalizedModel) ? `${brandForKey} ${normalizedModel}`.trim() : "";

// prep updates
const fieldsToUpdate = {};
function maybeSet(name, value){ if (fieldNames.includes(name)) fieldsToUpdate[name] = value; }

maybeSet(modelField, model);
maybeSet(modelNormField, normalizedModel);
maybeSet(confField, confidence);
maybeSet(noModelField, model === "No Model Detected");
maybeSet(parserVersionField, PARSER_VERSION);
maybeSet(debugField, JSON.stringify(debug));
maybeSet(listingIdField, listingId || "");
maybeSet(seriesField, series);
maybeSet(brandModelIdField, brandModelKey); // optional text copy

/***** BrandModel (link or text) from in-memory key *****/
if (fieldNames.includes(brandModelField) && brandModelKey) {
  const bmFieldObj = table.getField(brandModelField);
  const bmType = bmFieldObj.type;

  // skip computed
  const computedTypes = new Set(["formula","rollup","lookup","createdTime","lastModifiedTime","autoNumber"]);
  if (!computedTypes.has(bmType)) {
    if (bmType === "multipleRecordLinks") {
      const linkedTableId = bmFieldObj.options?.linkedTableId;
      if (!linkedTableId) throw new Error(`Linked table id missing for field '${brandModelField}'.`);
      const linkedTable = base.getTable(linkedTableId);

      // robust primary field resolution
      const primaryFieldObj =
        linkedTable.fields.find(f => f.isPrimaryField === true) ||
        linkedTable.fields.find(f => f.isPrimary === true) ||
        (linkedTable.primaryField ?? null) ||
        linkedTable.fields[0];
      if (!primaryFieldObj) throw new Error(`Unable to resolve primary field for linked table '${linkedTable.name}'.`);
      const primaryFieldName = primaryFieldObj.name;

      // find or create
      let targetId = null;
      const linkQuery = await linkedTable.selectRecordsAsync({ fields: [primaryFieldName] });
      const needle = brandModelKey.toUpperCase();
      for (const r of linkQuery.records) {
        const val = r.getCellValueAsString(primaryFieldName);
        if (val && val.trim().toUpperCase() === needle) { targetId = r.id; break; }
      }
      if (!targetId) {
        targetId = await linkedTable.createRecordAsync({ [primaryFieldName]: brandModelKey });
      }
      fieldsToUpdate[brandModelField] = [{ id: targetId }];
    } else {
      fieldsToUpdate[brandModelField] = brandModelKey; // plain text
    }
  }
}

// commit
await table.updateRecordAsync(recordId, fieldsToUpdate);

/***** OUTPUT *****/
const summary = `Updated ${recordId}
- Brand (resolved): ${brandCanonical || recordBrand || ""}
- Model: ${model}
- Normalized: ${normalizedModel}
- BrandModel key: ${brandModelKey}
- Confidence: ${confidence}
- Series: ${series}
- Listing ID: ${listingId}`;

if (typeof output?.markdown === "function") {
  output.markdown(`✅ ${summary.replace(/\n/g, "  \n")}`);
} else if (typeof output?.set === "function") {
  output.set("recordId", recordId);
  output.set("brand", brandCanonical || recordBrand || "");
  output.set("model", model);
  output.set("normalized", normalizedModel);
  output.set("brandModelKey", brandModelKey);
  output.set("confidence", confidence);
  output.set("series", series);
  output.set("listingId", listingId);
  output.set("summary", summary);
} else {
  console.log(summary);
}
