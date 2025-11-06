/********** CONFIG INPUTS **********/
const { recordId } = input.config();

/********** TABLE & RECORD **********/
const table = base.getTable("Products");
const record = await table.selectRecordAsync(recordId);
if (!record) throw new Error("❌ Record not found.");

/********** SAFE GETTER **********/
function safeGet(field) {
  try {
    return record.getCellValueAsString(field)?.trim() || "";
  } catch {
    return "";
  }
}

/********** EXTRACT FIELDS **********/
const brand = safeGet("Brand Detected");
const model = safeGet("Model") || safeGet("The Model");
const category = safeGet("The Category");
const classification = safeGet("Classification");
const year = safeGet("Year");
const metaDescriptionRaw = safeGet("The Meta Description");
const longDescription = safeGet("The Description");
const specs = safeGet("The Specifications");
const imageUrl = safeGet("ImageKit URL");

/********** VALIDATE META DESCRIPTION **********/
let metaDescription = metaDescriptionRaw;

// If the field looks like specs, override it
if (
  !metaDescription ||
  /axis|travel|mm|rpm|hp|inch|:/.test(metaDescription.toLowerCase())
) {
  console.warn("⚠️ The Meta Description appears invalid — using fallback.");
  const targetName = [brand, model, year].filter(Boolean).join(" ");
  metaDescription = `Superior Machine & Tool purchases used ${
    targetName || "CNC machines"
  } from owners and manufacturers nationwide. Get a fast quote today!`;
}

/********** BUILD SPECIFICATIONS **********/
let additionalProps = [];
if (specs) {
  additionalProps = specs
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [key, value] = s.split(":").map((x) => x.trim());
      return {
        "@type": "PropertyValue",
        name: key || "Specification",
        value: value || "",
      };
    });
}

/********** ORGANIZATION NODE **********/
const organizationNode = {
  "@type": "Organization",
  name: "Superior Machine & Tool, Inc.",
  url: "https://superiormachinetools.com",
  email: "sales@superiormachinetools.com",
  telephone: "1-800-822-9524",
  address: {
    "@type": "PostalAddress",
    streetAddress: "1301 Sunset Ave",
    addressLocality: "Lansing",
    addressRegion: "MI",
    postalCode: "48917",
    addressCountry: "US",
  },
  description: metaDescription,
  areaServed: "United States",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Used CNC Machines We Purchase",
    itemListElement: [
      {
        "@type": "Demand",
        itemOffered: {
          "@type": "Product",
          name: "Used CNC Machinery",
        },
      },
    ],
  },
  seeks: {
    "@type": "Demand",
    itemOffered: {
      "@type": "Product",
      name: "Used CNC Machinery",
    },
    description: metaDescription,
  },
};

/********** PRODUCT NODE **********/
let productNode = null;
if (brand && model) {
  productNode = {
    "@type": "Product",
    name: `${brand} ${model} ${year ? year : ""}`.trim(),
    brand,
    model,
    ...(category ? { category } : {}),
    ...(classification ? { additionalType: classification } : {}),
    ...(year ? { productionDate: year } : {}),
    ...(longDescription ? { description: longDescription } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(additionalProps.length > 0
      ? { additionalProperty: additionalProps }
      : {}),
    offers: {
      "@type": "Demand",
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: "Superior Machine & Tool, Inc.",
      },
    },
  };
}

/********** FINAL SCHEMA **********/
const schema = {
  "@context": "https://schema.org",
  "@graph": productNode ? [organizationNode, productNode] : [organizationNode],
};

/********** UPDATE RECORD **********/
await table.updateRecordAsync(record.id, {
  "Schema JSON": JSON.stringify(schema, null, 2),
});

console.log("✅ Buyer-focused Schema JSON created successfully!");
