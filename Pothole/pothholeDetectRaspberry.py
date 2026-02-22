from picamera2 import Picamera2
import cv2
import time
import json
import websocket
from ultralytics import YOLO

MODEL_PATH = "/home/boris/Documents/PothHole/Pothhole_Detect/best.pt"
# FIXED URL: No https:// inside wss://
WS_URL = "wss://roadquality.onrender.com" 
SEND_INTERVAL = 0.5

# Load YOLO model
model = YOLO(MODEL_PATH)

# Initialize Picamera2
picam2 = Picamera2()
config = picam2.create_preview_configuration(main={"size": (640, 480)})
picam2.configure(config)
picam2.start()

# Connect to WebSocket
ws = websocket.WebSocket()
try:
    ws.connect(WS_URL)
    print(f"✅ Connected to WebSocket server at {WS_URL}")
except Exception as e:
    print(f"❌ Could not connect to WebSocket server: {e}")
    picam2.stop()
    exit()

last_send_time = 0

while True:
    frame = picam2.capture_array()
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

    results = model(frame_rgb, imgsz=320, verbose=False)
    num_holes = len(results[0].boxes) if results[0].boxes is not None else 0

    # Annotate frame
    annotated = results[0].plot()
    cv2.putText(annotated, f"Holes: {num_holes}", (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 255, 0), 3)
    cv2.imshow("YOLOv8 Detection", annotated)

    current_time = time.time()
    if current_time - last_send_time > SEND_INTERVAL:
        try:
            # Added "type": "sensor_data" to stay consistent
            payload = {
                "type": "sensor_data",
                "holesCount": num_holes
            }
            ws.send(json.dumps(payload))
            print(f"Sent: {num_holes} holes")
        except Exception as e:
            print(f"⚠️ Failed to send WebSocket message: {e}")
        last_send_time = current_time

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

picam2.stop()
cv2.destroyAllWindows()
ws.close()
print("🛑 Program terminated")
