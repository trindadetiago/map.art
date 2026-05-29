# @mapart/geo

Foundational geo primitives + web-mercator tile math. No deps.

Types:

- `LatLng` — `{ lat, lng }`
- `Bbox` — `{ west, south, east, north }`
- `Polygon` — `LatLng[]`
- `TileCoord` — `{ x, y }`

Tile math (`./coords`):

- `latLngToTile(lat, lng, zoom)` → tile coord
- `tileToNW(x, y, zoom)` → NW corner LatLng
- `tileToBounds(x, y, zoom)` → Bbox
- `tileToCenter(x, y, zoom)` → LatLng
- `tileToBoundsWkt(x, y, zoom)` → WKT polygon
- `tileWidthMeters(zoom, lat)` → meters per tile at zoom + latitude

Coverage (`./coords` + `./coverage`):

- `bboxToTiles(bbox, zoom)` → tile coverage of a bbox
- `polygonToTiles(polygon, zoom)` → tile coverage of a polygon
- `circleToPolygon(center, radiusMeters)` → polygon approximation
- `polygonBbox`, `polygonToWkt`, `bboxToPolygon` — helpers

Admin inspector at `/admin/tiles` in `apps/web`. CLI entries: `pnpm mapart tiles for-point|bounds|for-bbox|for-circle`.
