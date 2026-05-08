// Tiny Nominatim reverse-geocoding client.
// Per https://operations.osmfoundation.org/policies/nominatim/ :
//   - send a meaningful User-Agent identifying the application (caller-provided)
//   - max 1 request/second (callers must throttle; this client only does I/O)

export type ReverseGeocodeResult = {
  label: string | null;
  country: string | null;
  country_code: string | null;
  admin_region: string | null;
  locality: string | null;
  raw: unknown;
};

type NominatimResponse = {
  display_name?: string;
  address?: {
    country?: string;
    country_code?: string;
    state?: string;
    region?: string;
    province?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    suburb?: string;
  };
};

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';

export class ReverseGeocodeError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ReverseGeocodeError';
  }
}

export async function reverseGeocodeNominatim(
  lat: number,
  lon: number,
  opts: { userAgent: string; baseUrl?: string; acceptLanguage?: string },
): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ReverseGeocodeError(`invalid coordinates: lat=${lat}, lon=${lon}`);
  }
  if (!opts.userAgent?.trim()) {
    throw new ReverseGeocodeError('Nominatim requires a non-empty User-Agent');
  }

  const base = (opts.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=14&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': opts.userAgent.trim(),
      'Accept-Language': opts.acceptLanguage?.trim() || 'fr,en',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    throw new ReverseGeocodeError(
      `Nominatim HTTP ${res.status}: ${body}`,
      res.status,
    );
  }

  const data = (await res.json()) as NominatimResponse;
  const a = data.address ?? {};

  const locality =
    a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb ?? null;
  const adminRegion = a.state ?? a.region ?? a.province ?? a.county ?? null;

  return {
    label: data.display_name?.trim() || null,
    country: a.country?.trim() || null,
    country_code: a.country_code?.trim().toUpperCase() || null,
    admin_region: adminRegion?.trim() || null,
    locality: locality?.trim() || null,
    raw: data,
  };
}
