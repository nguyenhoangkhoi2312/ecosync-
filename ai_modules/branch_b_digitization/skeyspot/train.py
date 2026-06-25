import os
from ultralytics import YOLO
import dataset_parser

if __name__ == "__main__":
    # 1. Download CubiCasa5K, Extract, and build YOLO bounding boxes
    print("=== Phase 1: Data Engineering ===")
    dataset_parser.build_yolo_dataset()
    
    # 2. Train YOLO
    print("\n=== Phase 2: YOLOv11 Training on Apple MPS ===")
    yaml_path = os.path.abspath("yolo_dataset/data.yaml")
    if not os.path.exists(yaml_path):
        print(f"Error: {yaml_path} not found. Dataset parsing failed.")
        exit(1)
        
    last_weights_path = os.path.abspath("runs/detect/cubicasa_run/weights/last.pt")
    
    if os.path.exists(last_weights_path):
        print(f"Resuming training from {last_weights_path}...")
        model = YOLO(last_weights_path)
        results = model.train(resume=True)
    else:
        model = YOLO("yolo11n.pt")
        results = model.train(
            data=yaml_path,
            epochs=100,
            imgsz=1024,
            device="mps",
            batch=4,       # Reduced from 16 to prevent OOM / crashes
            workers=2,     # Reduced dataloader workers
            project="models",
            name="cubicasa_run"
        )
    
    print("[Success] Training complete. Model saved in models/cubicasa_run/weights/best.pt")
