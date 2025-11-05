/********** CONFIG INPUTS **********/
const { wpBaseUrl, wpUser, wpAppPassword, recordId } = input.config();
console.log("🔧 Config Inputs:", { wpBaseUrl, wpUser, recordId });

/********** TABLE & RECORD **********/
const table = base.getTable("Products");
const record = await table.selectRecordAsync(recordId);
if (!record) throw new Error("❌ Record not found.");

/********** EXTRACT FIELDS **********/
const brand = record.getCellValueAsString("Brand Detected")?.trim();
const model = record.getCellValueAsString("The Model")?.trim();
const year = record.getCellValueAsString("The Year")?.trim();
let description = record.getCellValueAsString("The Description")?.trim();
const metaDescription = record.getCellValueAsString("The Meta Description")?.trim();
const classification = record.getCellValueAsString("Classification")?.trim();
const category = record.getCellValueAsString("The Category")?.trim();
const cdnImage = record.getCellValueAsString("ImageKit URL")?.trim();
const slugBase = record.getCellValueAsString("Slug")?.trim();
let specificationsRaw = record.getCellValueAsString("The Specifications")?.trim();
let wpPostId = record.getCellValue("WordPress Post ID");

console.log("📦 Record Data:", { brand, model, year, classification, category });

/********** SLUG SANITIZER **********/
function sanitizeSlug(input) {
  if (!input) return "";
  const clean = input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\/\\\(\)\[\]\.,]/g, " ")
    .replace(/[^a-z0-9\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean;
}

/********** DESCRIPTION FORMATTER **********/
function formatDescription(text) {
  if (!text) return "";
  const sentences = text
    .split(/(?<!\d)\.(?=\s+[A-Z])/)
    .map(s => s.trim())
    .filter(Boolean);
  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += 3) {
    let chunk = sentences.slice(i, i + 3).join(". ");
    if (!chunk.endsWith(".")) chunk += ".";
    paragraphs.push(chunk);
  }
  return paragraphs.join("\n\n");
}
description = formatDescription(description);

/********** TITLE & SLUG **********/
const title = `Sell ${brand} ${model}${year && year !== "-" ? " (" + year + ")" : ""}`;

// ✅ Slug now uses Model field only
let slug = slugBase || model;
slug = sanitizeSlug(slug);

if (!slug) throw new Error("❌ Missing Model field for slug generation.");

/********** AUTH HEADER **********/
const authHeader = "Basic " + Buffer.from(`${wpUser}:${wpAppPassword}`).toString("base64");

/********** HELPER: WP Fetch **********/
async function wpFetch(endpoint, options = {}) {
  const res = await fetch(`${wpBaseUrl}/wp-json/wp/v2/${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`❌ WP API error ${res.status}: ${text}`);
  }
  return res.json();
}

/********** HELPER: Find or Create Term (supports hierarchy) **********/
async function getOrCreateTerm(name, taxonomy, parentId = 0) {
  if (!name) return null;
  const slug = sanitizeSlug(name);

  // 1. Lookup by slug
  try {
    const existingBySlug = await wpFetch(`${taxonomy}?slug=${slug}&per_page=1`);
    if (existingBySlug.length > 0) {
      const found = existingBySlug[0];
      if (parentId && found.parent !== parentId) {
        await wpFetch(`${taxonomy}/${found.id}`, {
          method: "POST",
          body: JSON.stringify({ parent: parentId }),
        });
      }
      return found.id;
    }
  } catch (err) {
    console.warn(`⚠️ Slug lookup failed for ${name} in ${taxonomy}: ${err.message}`);
  }

  // 2. Lookup by name
  try {
    const existingByName = await wpFetch(`${taxonomy}?search=${encodeURIComponent(name)}&per_page=5`);
    const exact = existingByName.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (exact) {
      if (parentId && exact.parent !== parentId) {
        await wpFetch(`${taxonomy}/${exact.id}`, {
          method: "POST",
          body: JSON.stringify({ parent: parentId }),
        });
      }
      return exact.id;
    }
  } catch (err) {
    console.warn(`⚠️ Name lookup failed for ${name} in ${taxonomy}: ${err.message}`);
  }

  // 3. Create new term if not found
  try {
    const payload = { name, slug };
    if (parentId) payload.parent = parentId;
    const created = await wpFetch(`${taxonomy}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    console.log(`🆕 Created term "${name}" in ${taxonomy} (ID ${created.id})`);
    return created.id;
  } catch (err) {
    console.error(`❌ Failed creating term "${name}" in ${taxonomy}: ${err.message}`);
    return null;
  }
}

/********** BRAND TAXONOMY **********/
let brandIds = [];
try {
  const brandId = await getOrCreateTerm(brand, "brands");
  if (brandId) brandIds.push(brandId);
  console.log("✅ Linked brand:", brand);
} catch (err) {
  console.error("⚠️ Brand taxonomy assignment failed:", err.message);
}

/********** MACHINE TYPE TAXONOMY (Classification → Category) **********/
let machineTypeIds = [];
try {
  const classificationName = classification?.trim() || null; // e.g., "Metal Cutting"
  const categoryName = category?.trim() || null;             // e.g., "CNC Lathes"

  let classificationId = null;
  let categoryId = null;

  if (classificationName) {
    classificationId = await getOrCreateTerm(classificationName, "machine-type");
  }

  if (categoryName) {
    categoryId = await getOrCreateTerm(categoryName, "machine-type", classificationId || 0);
  }

  const uniqueIds = [classificationId, categoryId].filter(Boolean);
  machineTypeIds = [...new Set(uniqueIds)];
  console.log("✅ Linked machine type hierarchy:", { classificationName, categoryName, ids: machineTypeIds });
} catch (err) {
  console.error("⚠️ Machine type taxonomy assignment failed:", err.message);
}

/********** BUILD SPECIFICATIONS HTML **********/
function buildSpecificationsHTML(specsRaw, brand, model) {
  if (!specsRaw) return "";
  const specs = specsRaw
    .replace(/Ø/g, "")
    .split("|")
    .map(s => s.trim())
    .filter(Boolean);

  const toTitleCase = str =>
    str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const firstTen = specs.slice(0, 10);
  const col1 = firstTen.slice(0, 5);
  const col2 = firstTen.slice(5);

  const makeList = arr =>
    arr.map(s => {
      const [label, value] = s.split(":").map(x => x.trim());
      const cleanLabel = label ? toTitleCase(label) : "";
      return `<li><strong>${cleanLabel}</strong><span>${value || ""}</span></li>`;
    }).join("\n");

  return `
  <section class="machine-specifications">
    <h2 class="spec-heading">${brand} ${model} Machine Specifications</h2>
    <div class="spec-grid">
      <div class="spec-column"><ul>${makeList(col1)}</ul></div>
      <div class="spec-column"><ul>${makeList(col2)}</ul></div>
    </div>
  </section>`;
}
const specificationsHTML = buildSpecificationsHTML(specificationsRaw, brand, model);

/********** FIND EXISTING POST **********/
let postId = wpPostId;
if (!postId) {
  try {
    const found = await wpFetch(`machines?slug=${slug}`);
    if (found.length > 0) {
      postId = found[0].id;
      console.log(`✅ Found existing post ID: ${postId}`);
    }
  } catch (err) {
    console.warn(`⚠️ Slug search failed: ${err.message}`);
  }
}

/********** BUILD PAYLOAD **********/
const payload = {
  title,
  slug,
  status: "publish",
  content: description || "",
  brands: brandIds,
  "machine-type": machineTypeIds, // ✅ corrected taxonomy slug
  acf: {
    machine_make: brand || "",
    machine_model: model || "",
    machine_year: year && year !== "-" ? year : "",
    cdn_image_url: cdnImage || "",
    meta_description: metaDescription || "",
    specifications: specificationsHTML || "",
  },
};
console.log("📤 Payload ready:", payload);

/********** CREATE OR UPDATE POST **********/
let result;
try {
  if (postId) {
    result = await wpFetch(`machines/${postId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    console.log(`✅ Updated existing post ID ${postId}`);
  } else {
    result = await wpFetch("machines", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    postId = result.id;
    console.log(`✅ Created new post ID ${postId}`);
  }
} catch (err) {
  console.warn(`⚠️ Update failed (${err.message}). Creating new post...`);
  result = await wpFetch("machines", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  postId = result.id;
  console.log(`✅ Created new post after fallback (ID ${postId})`);
}

/********** UPDATE AIRTABLE **********/
await table.updateRecordAsync(recordId, {
  "WordPress Post ID": postId || null,
});

console.log(`✅ Sync complete for: ${title}`);
console.log(`🪪 WordPress ID: ${postId}`);
console.log(`🔗 View: ${result?.link || "N/A"}`);
console.log("💾 Updated Airtable with WordPress Post ID.");
