#!/usr/bin/env python3
"""
ECON Branch B — floorplan -> detailed building-data.json bridge.

Turns a 2D floorplan image into the EXACT schema the Go engine + React twin already consume
(see LAYOUT_SCHEMA.md). This is the "use DeepFloorplan to input into the detailed layout" step:
rooms are segmented (DeepFloorplan when its model is available, robust OpenCV otherwise),
normalized to the building's metric footprint, classified into zone archetypes, and assembled
into floors with full thermalProperties + hvacMapping so the physics and 3D model just work.

Usage:
  python floorplan_to_buildingdata.py --image deepfloorplan/real_floorplan.png \
         --out /tmp/building-data.json --floors 15 --footprint 60x40

Output is drop-in for econ/server/data/building-data.json (rebuild the engine image after).
"""

import argparse
import json
import uuid
import os

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Zone archetypes — the thermal "personality" attached to each detected room type.
# These feed the Go 2R1C physics directly. cAir is computed per-room from its volume.
# ---------------------------------------------------------------------------
ARCHETYPES = {
    "office":      {"setpoint": 22.0, "deadband": 2.0, "baseHeatLoad": 8000},
    "conference":  {"setpoint": 22.0, "deadband": 2.0, "baseHeatLoad": 6000},
    "corridor":    {"setpoint": 24.0, "deadband": 3.0, "baseHeatLoad": 2000},
    "lobby":       {"setpoint": 24.0, "deadband": 2.0, "baseHeatLoad": 5000},
    "server-room": {"setpoint": 18.0, "deadband": 1.0, "baseHeatLoad": 85000},
    "mechanical":  {"setpoint": 26.0, "deadband": 3.0, "baseHeatLoad": 12000},
}
FLOOR_HEIGHT_M = 4.0
WALL_THICKNESS_M = 0.3
AIR_VOL_HEAT_CAP = 1210.0  # J/(m^3·K) ≈ air density × cp; cAir = volume × this


# ---------------------------------------------------------------------------
# 1. Room segmentation
# ---------------------------------------------------------------------------
def segment_rooms_deepfloorplan(img):
    """Adapter for the real DeepFloorplan model (upgrade path).
    Wire TF2DeepFloorplan here: run inference -> room-boundary + room-type masks ->
    per-room polygons + a 'type_hint' from the predicted room class. Return None if the
    model/weights aren't installed so the caller falls back to OpenCV.
    """
    try:
        import deepfloorplan_infer  # provide this module when the TF model is set up
    except Exception:
        return None
    return deepfloorplan_infer.rooms(img)  # [{ "polygon_px": [(x,y)...], "type_hint": "office" }, ...]


def segment_rooms_opencv(img, min_area_frac=0.004):
    """Wall/contour segmenter that works without any ML model.
    Walls are dark lines; we close door gaps so each room becomes an enclosed blob, then
    take each interior contour's bounding rectangle as the room polygon (rectangular rooms
    are robust for extrusion + physics, matching the existing schema)."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    _, walls = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    k = max(3, int(min(h, w) * 0.012))
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    rooms_mask = cv2.bitwise_not(walls)
    contours, _ = cv2.findContours(rooms_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    min_area = min_area_frac * h * w
    rooms = []
    for cnt in contours:
        if cv2.contourArea(cnt) < min_area:
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw > 0.95 * w and bh > 0.95 * h:
            continue  # the outer building shell, not a room
        rooms.append({
            "polygon_px": [(x, y), (x + bw, y), (x + bw, y + bh), (x, y + bh)],
            "bbox_px": (x, y, bw, bh),
            "type_hint": None,
        })
    return rooms


def segment_rooms(img):
    rooms = segment_rooms_deepfloorplan(img)
    if rooms:
        print(f"[segment] DeepFloorplan: {len(rooms)} rooms")
        return rooms, "deepfloorplan"
    rooms = segment_rooms_opencv(img)
    print(f"[segment] OpenCV fallback: {len(rooms)} rooms")
    return rooms, "opencv"


# ---------------------------------------------------------------------------
# 2. Metric normalization + 3. classification
# ---------------------------------------------------------------------------
def px_to_metric(poly_px, img_w, img_h, fw, fd):
    return [[round(px / img_w * fw, 2), round(py / img_h * fd, 2)] for (px, py) in poly_px]


def bbox_metric(poly_m):
    xs = [p[0] for p in poly_m]
    ys = [p[1] for p in poly_m]
    x, y = min(xs), min(ys)
    return x, y, max(xs) - x, max(ys) - y


def classify(poly_m, fw, fd, type_hint=None):
    if type_hint:  # DeepFloorplan label wins; map its class to our archetype set
        return {"room": "office", "bedroom": "office", "hall": "corridor", "corridor": "corridor",
                "closet": "mechanical", "bathroom": "mechanical"}.get(type_hint, type_hint)
    x, y, bw, bh = bbox_metric(poly_m)
    cx, cy, area = x + bw / 2, y + bh / 2, bw * bh
    aspect = max(bw, bh) / max(1e-6, min(bw, bh))
    central = (fw * 0.3 < cx < fw * 0.7) and (fd * 0.3 < cy < fd * 0.7)
    if aspect > 4.0:
        return "corridor"
    if central and area < 80:
        return "server-room"
    if central:
        return "corridor"        # building core (elevators/stairs)
    if area < 30:
        return "conference"
    return "office"


def touches_perimeter(poly_m, fw, fd, eps=1.0):
    x, y, bw, bh = bbox_metric(poly_m)
    return x <= eps or y <= eps or x + bw >= fw - eps or y + bh >= fd - eps


# ---------------------------------------------------------------------------
# 4b. Airflow domain — doors + windows in metric coords, consumed by the React
# flow solver (flowfield.js) as `floor.airflowDomain`. Doors are the openings the
# constrained airflow may pass through; windows are perimeter relief sinks. Emitting
# them from the REAL plan means the digitized airflow matches the true layout instead
# of the frontend's geometric fallback.
# ---------------------------------------------------------------------------
def shared_door(poly_a, poly_b, tol=1.0, min_overlap=1.2):
    """Midpoint + tangent of the wall two rooms share, so one neat doorway can be
    carved there. Tangent (tx,tz) is in the solver's local frame (z = depth - y)."""
    edges = lambda p: [(p[i], p[(i + 1) % len(p)]) for i in range(len(p))]
    for (a0, a1) in edges(poly_a):
        for (b0, b1) in edges(poly_b):
            # vertical shared edge: constant x, overlapping y
            if abs(a0[0] - a1[0]) < tol and abs(b0[0] - b1[0]) < tol and abs(a0[0] - b0[0]) < tol:
                lo = max(min(a0[1], a1[1]), min(b0[1], b1[1]))
                hi = min(max(a0[1], a1[1]), max(b0[1], b1[1]))
                if hi - lo > min_overlap:
                    return {"x": round(a0[0], 2), "y": round((lo + hi) / 2, 2), "tx": 0, "tz": 1}
            # horizontal shared edge: constant y, overlapping x
            if abs(a0[1] - a1[1]) < tol and abs(b0[1] - b1[1]) < tol and abs(a0[1] - b0[1]) < tol:
                lo = max(min(a0[0], a1[0]), min(b0[0], b1[0]))
                hi = min(max(a0[0], a1[0]), max(b0[0], b1[0]))
                if hi - lo > min_overlap:
                    return {"x": round((lo + hi) / 2, 2), "y": round(a0[1], 2), "tx": 1, "tz": 0}
    return None


def perimeter_windows(fw, fd, spacing=6.0):
    """Window centres along the rectangular envelope, matching the 3D facade cadence."""
    wins = []
    edges = [((0, 0), (fw, 0)), ((fw, 0), (fw, fd)), ((fw, fd), (0, fd)), ((0, fd), (0, 0))]
    for (p0, p1) in edges:
        ex, ey = p1[0] - p0[0], p1[1] - p0[1]
        ln = (ex ** 2 + ey ** 2) ** 0.5
        ux, uy = ex / ln, ey / ln
        t = spacing / 2
        while t < ln - spacing / 4:
            wins.append({"x": round(p0[0] + ux * t, 2), "y": round(p0[1] + uy * t, 2)})
            t += spacing
    return wins


def build_airflow_domain(zones, fw, fd):
    doors = []
    for i, z in enumerate(zones):
        for j in z.get("adjacent_to_idx", []):
            if j <= i or j >= len(zones):
                continue  # j<=i dedupes the symmetric pair
            d = shared_door(z["polygon"], zones[j]["polygon"])
            if d:
                doors.append(d)
    return {"doors": doors, "windows": perimeter_windows(fw, fd)}


# ---------------------------------------------------------------------------
# 4. Assemble zones / floors / building (the detailed schema)
# ---------------------------------------------------------------------------
def build_zone(poly_m, level, idx, fw, fd, type_hint=None, adjacent_to_idx=None):
    ztype = classify(poly_m, fw, fd, type_hint)
    x, y, bw, bh = bbox_metric(poly_m)
    area = max(1.0, bw * bh)
    arch = ARCHETYPES.get(ztype, ARCHETYPES["office"])
    perimeter = touches_perimeter(poly_m, fw, fd)
    return {
        "adjacent_to_idx": adjacent_to_idx or [],
        "zoneId": f"zone-{ztype}-{idx}-lvl{level}",
        "name": f"{ztype.replace('-', ' ').title()} {idx} Level {level}",
        "zoneType": ztype,
        "bim_asset_id": str(uuid.uuid4()),
        "polygon": poly_m,
        "centroid": {"x": round(x + bw / 2, 2), "y": round(y + bh / 2, 2)},
        "thermalProperties": {
            "setpoint": arch["setpoint"],
            "deadband": arch["deadband"],
            "baseHeatLoad": arch["baseHeatLoad"],
            # interior rooms get no solar; perimeter rooms heat up through the facade
            "solarGainMultiplier": 1.0 if (perimeter and ztype not in ("server-room", "corridor")) else 0.0,
            "rWall": 0.2,
            "cAir": round(area * FLOOR_HEIGHT_M * AIR_VOL_HEAT_CAP),
        },
        "hvacMapping": {"vavId": f"vav-{ztype}-{idx}-lvl{level}"},
    }


def build_floor(rooms_m, level, fw, fd):
    zones = [build_zone(r["poly_m"], level, i + 1, fw, fd, r.get("type_hint"), r.get("adjacent_to", []))
             for i, r in enumerate(rooms_m)]
    core = next((z for z in zones if z["zoneType"] == "corridor"), None)
    return {
        "level": level,
        "elevation": round((level - 1) * FLOOR_HEIGHT_M, 2),
        "height": FLOOR_HEIGHT_M,
        "name": f"Level {level}",
        "geometry": {
            "exteriorPolygon": [[0, 0], [fw, 0], [fw, fd], [0, fd]],
            "corePolygon": core["polygon"] if core else [[fw*0.4, fd*0.4], [fw*0.6, fd*0.4], [fw*0.6, fd*0.6], [fw*0.4, fd*0.6]],
            "wallThickness": WALL_THICKNESS_M,
        },
        # Real doors (from detected adjacency) + perimeter windows for the airflow solver.
        "airflowDomain": build_airflow_domain(zones, fw, fd),
        "zones": zones,
    }


def build_building(rooms_m, n_floors, fw, fd, building_id="bldg-econ-digitized"):
    return {"buildingId": building_id,
            "floors": [build_floor(rooms_m, lvl, fw, fd) for lvl in range(1, n_floors + 1)]}


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True, help="floorplan image (png/jpg)")
    ap.add_argument("--out", default="building-data.json")
    ap.add_argument("--floors", type=int, default=15)
    ap.add_argument("--footprint", default="60x40", help="metric footprint WxD in meters")
    ap.add_argument("--debug", default=None, help="optional path to write an annotated PNG")
    args = ap.parse_args()

    fw, fd = (float(v) for v in args.footprint.lower().split("x"))
    img = cv2.imread(args.image)
    if img is None:
        raise SystemExit(f"could not read image: {args.image}")
    h, w = img.shape[:2]

    rooms, method = segment_rooms(img)
    if not rooms:
        raise SystemExit("no rooms detected — check the floorplan / thresholds")

    rooms_m = [{"poly_m": px_to_metric(r["polygon_px"], w, h, fw, fd),
                "type_hint": r.get("type_hint"),
                "adjacent_to": r.get("adjacent_to", [])} for r in rooms]

    building = build_building(rooms_m, args.floors, fw, fd)
    
    ontology = []
    for fl in building["floors"]:
        for i, z in enumerate(fl["zones"]):
            ontology.append({
                "subject": z["hvacMapping"]["vavId"],
                "predicate": "brick:feeds",
                "object": z["zoneId"]
            })
            for adj_idx in z.get("adjacent_to_idx", []):
                if adj_idx < len(fl["zones"]):
                    adj_zone = fl["zones"][adj_idx]
                    ontology.append({
                        "subject": z["zoneId"],
                        "predicate": "brick:adjacentTo",
                        "object": adj_zone["zoneId"]
                    })
            z.pop("adjacent_to_idx", None)

    with open(args.out, "w") as f:
        json.dump(building, f, indent=2)

    out_dir = os.path.dirname(args.out) or "."
    ontology_path = os.path.join(out_dir, "brick-ontology.json")
    with open(ontology_path, "w") as f:
        json.dump(ontology, f, indent=2)

    nz = sum(len(fl["zones"]) for fl in building["floors"])
    from collections import Counter
    types = Counter(z["zoneType"] for z in building["floors"][0]["zones"])
    print(f"[done] method={method}  floors={args.floors}  rooms/floor={len(rooms_m)}  zones={nz}")
    print(f"[done] floor-1 zone types: {dict(types)}")
    print(f"[done] wrote {args.out}")

    if args.debug:
        for r in rooms:
            if "bbox_px" in r:
                x, y, bw, bh = r["bbox_px"]
            else:
                xs = [p[0] for p in r["polygon_px"]]
                ys = [p[1] for p in r["polygon_px"]]
                x, y = min(xs), min(ys)
                bw, bh = max(xs) - x, max(ys) - y
            cv2.rectangle(img, (x, y), (x + bw, y + bh), (0, 200, 0), 2)
        cv2.imwrite(args.debug, img)
        print(f"[done] annotated -> {args.debug}")


if __name__ == "__main__":
    main()
