import os
from ultralytics import YOLO

# Global model instance to avoid reloading
_model = None

def infer_symbols(img=None, image_shape=None):
    """
    Uses the trained YOLOv11 model to detect symbols in the floorplan image.
    Returns: list of dicts: {"type": str, "bbox": [x1, y1, x2, y2], "confidence": float}
    """
    global _model
    
    if img is None:
        return []
        
    if _model is None:
        # Load the best.pt weights from the latest run
        weights_path = os.path.join(os.path.dirname(__file__), "runs", "detect", "models", "cubicasa_run-5", "weights", "best.pt")
        if os.path.exists(weights_path):
            _model = YOLO(weights_path)
        else:
            print(f"Warning: {weights_path} not found. Returning empty detections.")
            return []

    # Run inference
    results = _model(img, verbose=False)
    
    symbols = []
    for r in results:
        boxes = r.boxes
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            class_name = _model.names[cls_id]
            
            symbols.append({
                "type": class_name,
                "bbox": [x1, y1, x2, y2],
                "confidence": conf
            })
            
    return symbols
