import cv2
import json
import logging
import time
from typing import Dict, Any

from ultralytics import YOLO
import supervision as sv
import paho.mqtt.client as mqtt

# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "econ/telemetry/zone_1"

# Use YOLOv8n (nano) for speed. It will auto-download the weights.
# YOLOv11 can be used similarly if weights are provided.
MODEL_NAME = "yolov8n.pt"

# Coordinates for the virtual line (e.g., a doorway)
# Adjust these based on the actual camera resolution and angle
LINE_START = sv.Point(50, 300)
LINE_END = sv.Point(550, 300)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("YOLO-Tracker")

# ---------------------------------------------------------
# MQTT SETUP
# ---------------------------------------------------------
mqtt_client = mqtt.Client()

def setup_mqtt():
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start()
        logger.info("Connected to MQTT Broker")
    except Exception as e:
        logger.error(f"Could not connect to MQTT Broker: {e}")
        logger.info("Will run locally without MQTT publishing.")

def publish_occupancy(zone: str, count: int):
    payload = json.dumps({
        "zone": zone,
        "occupancy": count,
        "temperature": 24.5, # Static for demo
        "humidity": 50.0,
        "co2": 450
    })
    if mqtt_client.is_connected():
        mqtt_client.publish(MQTT_TOPIC, payload)
        logger.info(f"Published to {MQTT_TOPIC}: {payload}")

# ---------------------------------------------------------
# MAIN PIPELINE
# ---------------------------------------------------------
def run_tracking_pipeline(source=0):
    # Load the YOLO model
    logger.info(f"Loading {MODEL_NAME}...")
    model = YOLO(MODEL_NAME)

    # Initialize the ByteTrack tracker
    tracker = sv.ByteTrack()

    # Initialize LineZone to count crossing events
    line_zone = sv.LineZone(start=LINE_START, end=LINE_END)
    
    # Annotators for visualization
    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()
    line_zone_annotator = sv.LineZoneAnnotator()

    # Open video capture (webcam or file)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        logger.error(f"Failed to open video source: {source}")
        return

    logger.info("Starting video stream. Press 'q' to quit.")
    
    # To prevent spamming MQTT, we only publish when count changes
    last_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Run YOLO inference on Mac Mini M4 GPU (mps)
        # classes=[0] ensures we only detect 'person'
        results = model(frame, classes=[0], device="mps", verbose=False)[0]
        
        # Convert ultralytics results to supervision format
        detections = sv.Detections.from_ultralytics(results)
        
        # Update tracker with detections
        detections = tracker.update_with_detections(detections)
        
        # Trigger line zone counting
        line_zone.trigger(detections=detections)
        
        # Calculate net occupancy (in - out)
        # Assuming crossing from top to bottom is "in"
        current_occupancy = max(0, line_zone.in_count - line_zone.out_count)
        
        if current_occupancy != last_count:
            publish_occupancy("Level 4", current_occupancy)
            last_count = current_occupancy

        # Visualization (Draw on frame)
        labels = [
            f"#{tracker_id} Person"
            for tracker_id in detections.tracker_id
        ]
        
        frame = box_annotator.annotate(scene=frame, detections=detections)
        frame = label_annotator.annotate(scene=frame, detections=detections, labels=labels)
        frame = line_zone_annotator.annotate(frame, line_counter=line_zone)
        
        # Display live occupancy on the top left
        cv2.putText(frame, f"Occupancy: {current_occupancy}", (20, 50), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

        # Show the video feed
        cv2.imshow("EcoSync AI - YOLOv11/ByteTrack Occupancy", frame)

        # Press 'q' to quit
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    setup_mqtt()
    # Replace '0' with a video file path to test on pre-recorded footage
    run_tracking_pipeline(source=0)
