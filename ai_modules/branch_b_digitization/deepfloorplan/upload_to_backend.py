import json
import requests
import os

API_URL = "http://localhost:8000/api/zones"

def upload_zones(json_file):
    if not os.path.exists(json_file):
        print(f"Error: {json_file} not found. Run digitize_opencv.py first.")
        return

    with open(json_file, "r") as f:
        zones = json.load(f)

    print(f"Uploading {len(zones)} zones to Backend Database...")
    
    success_count = 0
    for z in zones:
        payload = {
            "name": z["name"],
            "capacity": z["capacity"],
            "current_occupancy": 0,
            "target_temp": 24
        }
        try:
            response = requests.post(API_URL, json=payload)
            if response.status_code == 200:
                print(f"✓ Uploaded {z['name']} successfully.")
                success_count += 1
            else:
                print(f"✗ Failed to upload {z['name']}: {response.text}")
        except Exception as e:
            print(f"✗ Backend not reachable. Ensure FastAPI is running on {API_URL}")
            return
            
    print(f"\nUpload complete. {success_count}/{len(zones)} zones registered.")

if __name__ == "__main__":
    upload_zones("digital_twin_layout.json")
