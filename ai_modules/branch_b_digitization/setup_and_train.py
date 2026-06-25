import os
import cv2
import numpy as np
from ultralytics import YOLO

def setup_mock_dataset():
    base = "skeyspot/mock_dataset"
    os.makedirs(f"{base}/images/train", exist_ok=True)
    os.makedirs(f"{base}/images/val", exist_ok=True)
    os.makedirs(f"{base}/labels/train", exist_ok=True)
    os.makedirs(f"{base}/labels/val", exist_ok=True)
    
    yaml_content = f"""path: {os.path.abspath(base)}
train: images/train
val: images/val
names:
  0: light
  1: ac_unit
  2: sensor_co2
  3: panel
"""
    with open(f"{base}/data.yaml", "w") as f:
        f.write(yaml_content)
        
    # Generate 1 tiny image
    img = np.zeros((128, 128, 3), dtype=np.uint8)
    cv2.rectangle(img, (20, 20), (40, 40), (255, 255, 255), -1)
    
    cv2.imwrite(f"{base}/images/train/mock.jpg", img)
    cv2.imwrite(f"{base}/images/val/mock.jpg", img)
    
    # YOLO format: class x_center y_center width height (normalized 0-1)
    # Box is x:20-40, y:20-40. center: 30/128, 30/128. width: 20/128, height: 20/128
    cx, cy, w, h = 30/128.0, 30/128.0, 20/128.0, 20/128.0
    with open(f"{base}/labels/train/mock.txt", "w") as f:
        f.write(f"0 {cx} {cy} {w} {h}\n")
    with open(f"{base}/labels/val/mock.txt", "w") as f:
        f.write(f"0 {cx} {cy} {w} {h}\n")
        
    print("[Dataset] Mock dataset created.")
    return f"{base}/data.yaml"

if __name__ == "__main__":
    yaml_path = setup_mock_dataset()
    print("[YOLO] Starting training on Apple Silicon (MPS)...")
    
    model = YOLO("yolo11n.pt")
    # Train for just 1 epoch to prove the pipeline works
    model.train(
        data=yaml_path,
        epochs=1,
        imgsz=128,
        device="mps",
        project="skeyspot/models",
        name="skeyspot_run"
    )
    print("[YOLO] Training complete. Weights saved to skeyspot/models/skeyspot_run/weights/best.pt")
