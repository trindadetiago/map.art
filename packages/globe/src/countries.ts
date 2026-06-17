import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';

type CountryCollection = Extract<ReturnType<typeof feature>, { features: unknown[] }>;
export type CountryFeature = CountryCollection['features'][number];

let cache: CountryFeature[] | null = null;

/**
 * world-atlas ships country boundaries as compact TopoJSON. Decode the
 * `countries` object to GeoJSON features once and reuse across globe instances.
 */
export function getCountryFeatures(): CountryFeature[] {
  if (cache) return cache;
  const topo = countriesTopology as unknown as Parameters<typeof feature>[0];
  const objects = topo.objects as unknown as { countries: Parameters<typeof feature>[1] };
  cache = (feature(topo, objects.countries) as CountryCollection).features;
  return cache;
}
