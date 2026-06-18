import cv2
from ultralytics import YOLO
import time
import requests

# Load the YOLO11 model (using a tiny version for edge/speed)
# model = YOLO('yolo11n.pt') 

def process_stream(source='0', zone='zone_a'):
    """
    Mock pipeline for tracking-by-detection.
    Reads from a camera or video, counts people, and posts to Backend.
    """
    print(f"Starting Branch A Occupancy tracker for {zone}")
    # cap = cv2.VideoCapture(source)
    
    try:
        while True:
            # ret, frame = cap.read()
            # if not ret: break
            
            # Run YOLO inference
            # results = model.track(frame, persist=True, classes=[0]) # class 0 is person
            
            # Mock count for demonstration
            simulated_count = 5 
            
            # Send to backend
            try:
                response = requests.post(f"http://localhost:8000/api/occupancy/{zone}?count={simulated_count}")
                print(f"Posted count: {simulated_count}")
            except Exception as e:
                print("Backend not reachable.")
            
            time.sleep(5) # Delay for mock
            
    except KeyboardInterrupt:
        print("Stopping tracker")
    # finally:
        # cap.release()

if __name__ == "__main__":
    process_stream()
