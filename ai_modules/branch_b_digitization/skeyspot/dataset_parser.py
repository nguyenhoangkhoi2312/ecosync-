import os
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import cv2
import shutil

YOLO_CLASSES = {
    "Window": 0,
    "Door": 1,
    "Closet": 2,
    "ElectricalAppliance": 3,
    "Sink": 4,
    "Toilet": 5,
    "Bathtub": 6
}

def download_and_extract():
    os.makedirs("data", exist_ok=True)
    zip_path = "data/cubicasa5k.zip"
    extract_path = "data/cubicasa5k"

    if not os.path.exists(zip_path):
        print("[Dataset] Downloading CubiCasa5K (5.4GB)... This will take a while.")
        subprocess.run(["curl", "-o", zip_path, "-L", "https://zenodo.org/api/records/2613548/files/cubicasa5k.zip/content"], check=True)

    if not os.path.exists(extract_path):
        print("[Dataset] Extracting CubiCasa5K...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall("data/cubicasa5k")
            
    return "data/cubicasa5k"

import re

def parse_transform(transform_str):
    m = re.search(r'matrix\(([^)]+)\)', transform_str)
    if m:
        parts = [float(x) for x in m.group(1).replace(' ', ',').split(',') if x]
        if len(parts) == 6:
            return parts
    return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]

def apply_transform(x, y, matrix):
    a, b, c, d, e, f = matrix
    return a * x + c * y + e, b * x + d * y + f

def parse_svg_to_yolo(svg_path, img_width, img_height, label_out_path):
    tree = ET.parse(svg_path)
    root = tree.getroot()
    
    def get_tag_name(elem):
        if '}' in elem.tag:
            return elem.tag.split('}', 1)[1]
        return elem.tag
    
    lines = []
    for elem in root.iter():
        if 'class' in elem.attrib:
            classes = elem.attrib['class'].split()
            found_cls = None
            for c in classes:
                if c in YOLO_CLASSES:
                    found_cls = c
                    break
                    
            if found_cls:
                cls_id = YOLO_CLASSES[found_cls]
                
                matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
                if 'transform' in elem.attrib:
                    matrix = parse_transform(elem.attrib['transform'])
                
                points = []
                for child in elem.iter():
                    tag = get_tag_name(child)
                    if tag == 'polygon':
                        points_str = child.attrib.get('points', '')
                        if points_str:
                            for p in points_str.strip().split():
                                if ',' in p:
                                    parts = p.split(',')
                                    if len(parts) >= 2:
                                        x_t, y_t = apply_transform(float(parts[0]), float(parts[1]), matrix)
                                        points.append((x_t, y_t))
                
                if not points:
                    continue
                    
                min_x = min(p[0] for p in points)
                max_x = max(p[0] for p in points)
                min_y = min(p[1] for p in points)
                max_y = max(p[1] for p in points)
                
                x_center = ((min_x + max_x) / 2.0) / img_width
                y_center = ((min_y + max_y) / 2.0) / img_height
                width = (max_x - min_x) / img_width
                height = (max_y - min_y) / img_height
                
                if width > 0 and height > 0 and width <= 1.0 and height <= 1.0:
                    lines.append(f"{cls_id} {x_center} {y_center} {width} {height}")
                
    if lines:
        with open(label_out_path, 'w') as f:
            f.write("\n".join(lines) + "\n")
        return True
    return False

def build_yolo_dataset():
    extract_path = download_and_extract()
    print("[Dataset] Building YOLO format dataset...")
    
    yolo_base = "yolo_dataset"
    os.makedirs(f"{yolo_base}/images/train", exist_ok=True)
    os.makedirs(f"{yolo_base}/images/val", exist_ok=True)
    os.makedirs(f"{yolo_base}/labels/train", exist_ok=True)
    os.makedirs(f"{yolo_base}/labels/val", exist_ok=True)
    
    yaml_content = f"""path: {os.path.abspath(yolo_base)}
train: images/train
val: images/val
names:\n"""
    for name, cid in sorted(YOLO_CLASSES.items(), key=lambda x: x[1]):
        yaml_content += f"  {cid}: {name.lower()}\n"
        
    with open(f"{yolo_base}/data.yaml", "w") as f:
        f.write(yaml_content)
        
    base_dir = Path(extract_path)
    hq_dir = None
    for p in base_dir.rglob("high_quality"):
        if p.is_dir():
            hq_dir = p
            break
                
    if not hq_dir or not hq_dir.exists():
        print("Could not find high_quality folder.")
        return
        
    folders = [f for f in hq_dir.iterdir() if f.is_dir()]
    print(f"Found {len(folders)} high quality floorplans.")
    
    MAX_SAMPLES = 5000
    count = 0
    
    for folder in folders:
        if count >= MAX_SAMPLES:
            break
            
        img_path = folder / "F1_scaled.png"
        svg_path = folder / "model.svg"
        
        if not img_path.exists() or not svg_path.exists():
            continue
            
        img = cv2.imread(str(img_path))
        if img is None:
            continue
            
        h, w, _ = img.shape
        split = "train" if count % 5 != 0 else "val"
        
        out_img = f"{yolo_base}/images/{split}/{folder.name}.png"
        out_lbl = f"{yolo_base}/labels/{split}/{folder.name}.txt"
        
        if parse_svg_to_yolo(str(svg_path), w, h, out_lbl):
            shutil.copy(str(img_path), out_img)
            count += 1
            if count % 100 == 0:
                print(f"Processed {count}/{len(folders)} samples...")
                
    print(f"[Dataset] Completed building YOLO dataset with {count} samples.")

if __name__ == "__main__":
    build_yolo_dataset()
