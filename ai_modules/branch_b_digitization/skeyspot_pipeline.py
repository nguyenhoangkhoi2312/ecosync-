import json
import argparse
import os
import cv2
import numpy as np

from skeyspot.detector import infer_symbols
from ocr_graph_search.netlist_builder import build_netlist

def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def point_in_polygon(pt_px, poly_m, img_w, img_h, fw, fd):
    # poly_m is in meters. pt_px is in pixels.
    # Convert pt_px to meters
    pt_m = (pt_px[0] / img_w * fw, pt_px[1] / img_h * fd)
    poly = np.array(poly_m, dtype=np.float32)
    return cv2.pointPolygonTest(poly, pt_m, False) >= 0

def assign_symbol_to_zone(sym, floors, img_w, img_h, fw, fd):
    x1, y1, x2, y2 = sym['bbox']
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    
    # We'll just map to the first floor for this 2D pipeline
    if not floors: return None
    floor1 = floors[0]
    
    best_zone = None
    for z in floor1["zones"]:
        if point_in_polygon((cx, cy), z["polygon"], img_w, img_h, fw, fd):
            best_zone = z["zoneId"]
            break
            
    # Fallback to closest centroid if not strictly inside
    if not best_zone:
        min_dist = float('inf')
        cx_m, cy_m = cx / img_w * fw, cy / img_h * fd
        for z in floor1["zones"]:
            zc = z["centroid"]
            dist = (zc["x"] - cx_m)**2 + (zc["y"] - cy_m)**2
            if dist < min_dist:
                min_dist = dist
                best_zone = z["zoneId"]
                
    return best_zone

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--building", default="building-data.json")
    ap.add_argument("--ontology", default="brick-ontology.json")
    ap.add_argument("--image", default="deepfloorplan/real_floorplan.png")
    args = ap.parse_args()

    building = load_json(args.building)
    ontology = load_json(args.ontology)
    
    img = cv2.imread(args.image)
    if img is None:
        # Mock image dimensions
        img_h, img_w = 1000, 1000
    else:
        img_h, img_w = img.shape[:2]
        
    # Assume 60x40 footprint based on floorplan_to_buildingdata default
    fw, fd = 60.0, 40.0

    print("[SkeySpot] Running detector...")
    symbols = infer_symbols(img=img, image_shape=(img_h, img_w))
    print(f"[SkeySpot] Detected {len(symbols)} electrical symbols.")
    
    # Assign symbols to zones
    for sym in symbols:
        zone_id = assign_symbol_to_zone(sym, building.get("floors", []), img_w, img_h, fw, fd)
        sym["zone_id"] = zone_id

    print("[OCR Graph Search] Building netlist circuits...")
    netlist = build_netlist(symbols)
    
    print("[Ontology Merge] Expanding brick-ontology.json...")
    # Add devices and their locations
    for sym in symbols:
        if "id" not in sym: continue
        ontology.append({
            "subject": sym["id"],
            "predicate": "brick:hasLocation",
            "object": sym["zone_id"]
        })
        
    # Add circuits feeding devices
    for c in netlist["circuits"]:
        circ_id = c["circuit_id"]
        panel_id = c["panel_id"]
        # Panel feeds circuit
        ontology.append({
            "subject": panel_id,
            "predicate": "brick:feeds",
            "object": circ_id
        })
        # Circuit feeds devices
        for dev_id in c["devices"]:
            ontology.append({
                "subject": circ_id,
                "predicate": "brick:feeds",
                "object": dev_id
            })

    save_json(ontology, args.ontology)
    print(f"[done] Enriched ontology with {len(symbols)} devices and {len(netlist['circuits'])} circuits.")
    print(f"[done] Saved to {args.ontology}")

if __name__ == "__main__":
    main()
