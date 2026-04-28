function toMiles(valueMeters) {
  return Number((Number(valueMeters || 0) * 0.000621371).toFixed(2));
}

async function geocodeAddress(address) {
  const trimmed = String(address || "").trim();
  if (!trimmed) {
    throw new Error("Address is required.");
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      address: trimmed,
      formattedAddress: `${trimmed} (demo geocode)`,
      location: { lat: 40.7128, lng: -74.006 },
      source: "demo"
    };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", trimmed);
  url.searchParams.set("key", key);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Geocoding request failed.");
  }
  const data = await response.json();
  if (data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
    throw new Error("Invalid address. Please enter a more specific address.");
  }

  const result = data.results[0];
  return {
    address: trimmed,
    formattedAddress: result.formatted_address,
    location: {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng
    },
    source: "google"
  };
}

module.exports = {
  geocodeAddress,
  toMiles
};
