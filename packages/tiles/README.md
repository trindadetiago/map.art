# @mapart/tiles

Web-mercator tile math.

- Point → tile (`latLngToTile`)
- Tile → bounds / center / WKT (`tileToBounds`, `tileToCenter`, `tileToBoundsWkt`)
- Bbox → tile coverage (`bboxToTiles`)
- Circle / polygon → tile coverage (`circleToPolygon`, `polygonToTiles`)
- Admin inspector at `/admin/tiles` in `apps/web`
- CLI entries: `pnpm mapart tiles for-point|bounds|for-bbox|for-circle`
