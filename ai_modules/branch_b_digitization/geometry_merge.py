import cv2
import numpy as np

def box_center(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

def iou_with_mask(box, mask):
    x1, y1, x2, y2 = map(int, box)
    h, w = mask.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    crop = mask[y1:y2, x1:x2] > 0
    return crop.mean()

def point_in_mask(pt, mask):
    x, y = map(int, pt)
    h, w = mask.shape[:2]
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    return mask[y, x] > 0

def assign_symbol_to_room(box, room_masks, alpha=0.7):
    """
    Mathematical reconciliation step connecting YOLOv11 symbols (lights, AC)
    to CubiCasa5k room segmentation masks using bounding-box IoU overlap.
    """
    c = box_center(box)
    best_id, best_score = None, -1
    for room_id, room_mask in room_masks.items():
        overlap = iou_with_mask(box, room_mask)
        inside = 1.0 if point_in_mask(c, room_mask) else 0.0
        score = alpha * overlap + (1 - alpha) * inside
        if score > best_score:
            best_score = score
            best_id = room_id
    return best_id, best_score
