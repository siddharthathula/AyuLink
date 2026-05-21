import cv2
import sys
url = "http://10.100.221.20:81/stream"
print("Connecting to", url)
cap = cv2.VideoCapture(url)
if not cap.isOpened():
    print("Failed to open stream")
    sys.exit(1)
ret, frame = cap.read()
if ret:
    print("Success! Frame shape:", frame.shape)
else:
    print("Failed to read frame")
cap.release()
