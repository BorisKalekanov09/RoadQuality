import cv2
import numpy as np

# Webcam
cap = cv2.VideoCapture(0)

# Remember last line position (helps if line disappears)
last_cx = 320

while True:
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.resize(frame, (640, 480))

    # Convert to grayscale
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Adaptive threshold (better for real world)
    thresh = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11, 2
    )

    # Focus on lower half of image (road area)
    height, width = thresh.shape
    roi = thresh[int(height/2):height, :]

    # Find white pixels
    M = cv2.moments(roi)

    if M["m00"] != 0:
        cx = int(M["m10"] / M["m00"])
        last_cx = cx
    else:
        cx = last_cx  # use memory if line is lost

    # Steering decision
    if cx < width/2 - 40:
        direction = "LEFT"
    elif cx > width/2 + 40:
        direction = "RIGHT"
    else:
        direction = "STRAIGHT"

    # Visualization
    cv2.circle(frame, (cx, int(height*0.75)), 10, (0, 0, 255), -1)
    cv2.putText(frame, direction, (30, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                1, (0, 255, 0), 2)

    cv2.imshow("Line Following", frame)
    cv2.imshow("Mask", roi)

    if cv2.waitKey(1) == 27:
        break

cap.release()
cv2.destroyAllWindows()