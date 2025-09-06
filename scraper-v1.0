<script>
let inputConfig = input.config();
let recordId = inputConfig.recordId;
let scraperApiKey = inputConfig.scraper_api_key;
let render = inputConfig.rendersetting;

let table = base.getTable("Sitemap Scraped");
let record = await table.selectRecordAsync(recordId);
let loc = record.getCellValue("loc");

let encodedUrl = encodeURIComponent(loc);
let scraperUrl = `https://api.scraperapi.com/?api_key=${scraperApiKey}&url=${encodedUrl}&render=${render}&device_type=desktop&country_code=us&output_format=text&timeout=90000`;

let response = await fetch(scraperUrl);
let rawText = await response.text();

output.set("Scraped Result", rawText.slice(0, 1000)); // Just to preview

await table.updateRecordAsync(recordId, {
  "Scraped": rawText
});
</script>
