const CT_CENTER = { lat: 41.3083, lng: -72.9279 };

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapsApiKey() {
  return process.env.PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Google Places request failed.");
  return response.json();
}

async function suggestAddresses(input) {
  const query = String(input || "").trim();
  if (!query) return [];
  const key = mapsApiKey();
  if (!key) {
    throw new Error("Real store search requires Google Maps API");
  }

  const autoUrl = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  autoUrl.searchParams.set("input", query);
  autoUrl.searchParams.set("types", "address");
  autoUrl.searchParams.set("components", "country:us");
  autoUrl.searchParams.set("location", `${CT_CENTER.lat},${CT_CENTER.lng}`);
  autoUrl.searchParams.set("radius", "35000");
  autoUrl.searchParams.set("strictbounds", "false");
  autoUrl.searchParams.set("key", key);

  const autoData = await fetchJson(autoUrl);
  const predictions = Array.isArray(autoData.predictions) ? autoData.predictions.slice(0, 6) : [];

  const suggestions = [];
  for (const prediction of predictions) {
    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", prediction.place_id);
    detailsUrl.searchParams.set("fields", "place_id,formatted_address,geometry");
    detailsUrl.searchParams.set("key", key);
    const detailData = await fetchJson(detailsUrl);
    const result = detailData.result || {};
    suggestions.push({
      placeId: prediction.place_id,
      description: prediction.description || result.formatted_address || "",
      formattedAddress: result.formatted_address || prediction.description || "",
      lat: result.geometry?.location?.lat ?? null,
      lng: result.geometry?.location?.lng ?? null
    });
  }
  return suggestions.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

async function findNearbyStores({ lat, lng, radiusMiles = 10, limit = 10 }) {
  const key = mapsApiKey();
  if (!key) throw new Error("Real store search requires Google Maps API");

  const radiusMeters = Math.round(Math.max(1, Number(radiusMiles || 10)) * 1609.34);
  const keywords = [
    "grocery store",
    "supermarket",
    "market",
    "target",
    "walmart",
    "costco",
    "aldi",
    "trader joe's",
    "whole foods"
  ];

  const all = [];
  for (const keyword of keywords) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(radiusMeters));
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("key", key);
    const data = await fetchJson(url);
    if (Array.isArray(data.results)) all.push(...data.results);
  }

  const uniq = new Map();
  all.forEach((store) => {
    if (!store?.place_id) return;
    if (!uniq.has(store.place_id)) uniq.set(store.place_id, store);
  });

  return Array.from(uniq.values())
    .map((store) => {
      const sLat = store.geometry?.location?.lat;
      const sLng = store.geometry?.location?.lng;
      const distance = Number.isFinite(sLat) && Number.isFinite(sLng) ? haversineMiles(lat, lng, sLat, sLng) : 0;
      return {
        id: store.place_id,
        name: store.name || "Store",
        address: store.vicinity || "Address unavailable",
        distanceMiles: Number(distance.toFixed(2)),
        rating: store.rating ?? null,
        openNow: store.opening_hours ? Boolean(store.opening_hours.open_now) : null,
        mapsUrl: `https://www.google.com/maps/place/?q=place_id:${store.place_id}`
      };
    })
    .filter((s) => s.distanceMiles <= Number(radiusMiles || 10))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit);
}

module.exports = {
  suggestAddresses,
  findNearbyStores
};
