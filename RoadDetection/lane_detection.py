import numpy as np
import cv2
from picamera2 import Picamera2

# --- All your existing processing functions remain unchanged ---

def region_selection(image):
    mask = np.zeros_like(image)
    if len(image.shape) > 2:
        channel_count = image.shape[2]
        ignore_mask_color = (255,) * channel_count
    else:
        ignore_mask_color = 255
    rows, cols = image.shape[:2]
    bottom_left  = [cols * 0.1, rows * 0.95]
    top_left     = [cols * 0.4, rows * 0.6]
    bottom_right = [cols * 0.9, rows * 0.95]
    top_right    = [cols * 0.6, rows * 0.6]
    vertices = np.array([[bottom_left, top_left, top_right, bottom_right]], dtype=np.int32)
    cv2.fillPoly(mask, vertices, ignore_mask_color)
    masked_image = cv2.bitwise_and(image, mask)
    return masked_image

def hough_transform(image):
    rho = 1
    theta = np.pi/180
    threshold = 20
    minLineLength = 20
    maxLineGap = 500
    return cv2.HoughLinesP(image, rho=rho, theta=theta, threshold=threshold,
                           minLineLength=minLineLength, maxLineGap=maxLineGap)

def average_slope_intercept(lines):
    left_lines    = []
    left_weights  = []
    right_lines   = []
    right_weights = []
    for line in lines:
        for x1, y1, x2, y2 in line:
            if x1 == x2:
                continue
            slope = (y2 - y1) / (x2 - x1)
            intercept = y1 - (slope * x1)
            length = np.sqrt(((y2 - y1) ** 2) + ((x2 - x1) ** 2))
            if slope < 0:
                left_lines.append((slope, intercept))
                left_weights.append((length))
            else:
                right_lines.append((slope, intercept))
                right_weights.append((length))
    left_lane  = np.dot(left_weights,  left_lines) / np.sum(left_weights)  if len(left_weights) > 0 else None
    right_lane = np.dot(right_weights, right_lines) / np.sum(right_weights) if len(right_weights) > 0 else None
    return left_lane, right_lane

def pixel_points(y1, y2, line):
    if line is None:
        return None
    slope, intercept = line
    x1 = int((y1 - intercept)/slope)
    x2 = int((y2 - intercept)/slope)
    y1 = int(y1)
    y2 = int(y2)
    return ((x1, y1), (x2, y2))

def lane_lines(image, lines):
    left_lane, right_lane = average_slope_intercept(lines)
    y1 = image.shape[0]
    y2 = y1 * 0.6
    left_line  = pixel_points(y1, y2, left_lane)
    right_line = pixel_points(y1, y2, right_lane)
    return left_line, right_line

def draw_lane_lines(image, lines, color=[255, 0, 0], thickness=12):
    line_image = np.zeros_like(image)
    for line in lines:
        if line is not None:
            cv2.line(line_image, *line, color, thickness)
    return cv2.addWeighted(image, 1.0, line_image, 1.0, 0.0)

def frame_processor(image):
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    kernel_size = 5
    blur = cv2.GaussianBlur(grayscale, (kernel_size, kernel_size), 0)
    low_t = 50
    high_t = 150
    edges = cv2.Canny(blur, low_t, high_t)
    region = region_selection(edges)
    hough = hough_transform(region)
    if hough is None:
        return image  # No lines detected, return original frame
    result = draw_lane_lines(image, lane_lines(image, hough))
    return result

# --- New Pi Camera live capture + optional video save ---

def process_video_picamera(output_video=None, width=1280, height=720, fps=30):
    """
    Capture from Raspberry Pi 5 camera, detect lane lines in real time,
    display via OpenCV window, and optionally save to an mp4 file.

    Parameters:
        output_video: path to save output .mp4 (e.g. 'output.mp4'), or None to skip saving
        width, height: capture resolution
        fps: frames per second
    """
    # Initialize PiCamera2
    picam2 = Picamera2()
    config = picam2.create_video_configuration(
        main={"size": (width, height), "format": "BGR888"}
    )
    picam2.configure(config)
    picam2.start()

    # Optional: set up video writer
    writer = None
    if output_video:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

    print("Press 'q' to quit.")
    try:
        while True:
            # Capture frame as numpy array (BGR format)
            frame = picam2.capture_array()

            # Process frame for lane detection
            processed_frame = frame_processor(frame)

            # Display
            cv2.imshow("Lane Detection", processed_frame)

            # Save frame if writing
            if writer:
                writer.write(processed_frame)

            # Quit on 'q'
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        picam2.stop()
        if writer:
            writer.release()
        cv2.destroyAllWindows()
        print("Done.")

# --- Entry point ---
process_video_picamera(output_video='output.mp4')