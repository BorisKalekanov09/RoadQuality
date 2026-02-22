import cv2
import numpy as np
import time

cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Camera not found, trying index 1...")
    cap = cv2.VideoCapture(1)
    if not cap.isOpened():
        print("No camera found at index 0 or 1")
        exit()

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

print("Warming up camera...")
time.sleep(2)

# Throwaway frames to let camera stabilize
for i in range(5):
    cap.read()

print("Starting...")
last_cx = 320

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to grab frame, retrying...")
        time.sleep(0.1)
        continue

    frame = cv2.resize(frame, (640, 480))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    thresh = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11, 2
    )

    height, width = thresh.shape
    roi = thresh[int(height/2):height, :]

    M = cv2.moments(roi)
    if M["m00"] != 0:
        cx = int(M["m10"] / M["m00"])
        last_cx = cx
    else:
        cx = last_cx

    if cx < width/2 - 40:
        direction = "LEFT"
    elif cx > width/2 + 40:
        direction = "RIGHT"
    else:
        direction = "STRAIGHT"

    cv2.circle(frame, (cx, int(height*0.75)), 10, (0, 0, 255), -1)
    cv2.putText(frame, direction, (30, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                1, (0, 255, 0), 2)

    cv2.imshow("Line Following", frame)
    cv2.imshow("Mask", roi)

    key = cv2.waitKey(1) & 0xFF
    if key == 27 or key == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()