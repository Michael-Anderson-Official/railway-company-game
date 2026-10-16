"""Extract Kariya City's 2025 population estimate from MLIT's Aichi 250 m GeoJSON ZIP.

Source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-mesh250r6.html
Usage: python3 extract_kariya_population.py /path/to/250m_mesh_2024_23_GEOJSON.zip
"""

import json
import sys
import zipfile
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract_kariya_population.py <Aichi-250m-GeoJSON-zip>")
    source = Path(sys.argv[1])
    destination = Path(__file__).resolve().parent / "population-kariya-2025.json"
    cells = []
    with zipfile.ZipFile(source) as archive:
        with archive.open("250m_mesh_2024_23.geojson") as handle:
            for line in handle:
                # The official GeoJSON uses one Feature per line. Streaming avoids
                # loading the entire 271 MB Aichi file just to select city 23210.
                if b'"SHICODE": "23210"' not in line:
                    continue
                feature = json.loads(line.decode("utf-8").rstrip().removesuffix(","))
                properties = feature["properties"]
                if properties["SHICODE"] != "23210":
                    continue
                population = properties.get("PTN_2025")
                if population is None or population <= 0:
                    continue
                ring = feature["geometry"]["coordinates"][0]
                longitudes = [point[0] for point in ring]
                latitudes = [point[1] for point in ring]
                west, east = min(longitudes), max(longitudes)
                south, north = min(latitudes), max(latitudes)
                cells.append([
                    round((west + east) / 2, 8),
                    round((south + north) / 2, 8),
                    round(population, 4),
                    round((east - west) / 2, 9),
                    round((north - south) / 2, 9),
                ])
    if not cells:
        raise SystemExit("No population mesh records for Kariya (SHICODE 23210)")
    cells.sort(key=lambda cell: (cell[1], cell[0]))
    output = {
        "city": "刈谷市",
        "sourceYear": 2024,
        "populationYear": 2025,
        "meshMeters": 250,
        "source": "国土交通省 国土数値情報 250mメッシュ別将来推計人口（R6国政局推計）",
        "url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-mesh250r6.html",
        "fields": ["lon", "lat", "population", "halfLon", "halfLat"],
        "cells": cells,
    }
    destination.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(cells)} populated meshes, {sum(cell[2] for cell in cells):,.0f} estimated residents, to {destination}")


if __name__ == "__main__":
    main()
