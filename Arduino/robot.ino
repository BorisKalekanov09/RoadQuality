#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>

#include <WiFi.h>
#include <WebSocketsClient.h>

const char* ssid = "TP-LINK_7516";     // Replace with your WiFi name
const char* password = "e0887714303"; // Replace with your WiFi password
const char* serverAddress = "192.168.0.100"; // Example: "192.168.1.100"
const int serverPort = 8080;
WebSocketsClient webSocket;
float roadQuality;
String roadState;

// ====== L9110S MOTOR PINS ======
#define IN1 26
#define IN2 27
#define IN3 25
#define IN4 33

// ====== IR SENSORS (3 sensors) ======
#define LEFT_SENSOR   32
#define MIDDLE_SENSOR 35   // <-- NEW (choose a free GPIO)
#define RIGHT_SENSOR  34

// ====== OTHER SENSORS ======
#define DHTPIN 5
#define DHTTYPE DHT11
#define VIB_PIN 18

Adafruit_MPU6050 mpu;
DHT dht(DHTPIN, DHTTYPE);

// ====== MOTOR CONTROL ======
int maxSpeed = 255;      // maximum PWM speed
int turnSpeed = 150;      // turn PWM speed
int accelStep = 10;      // PWM ramp step

int currentLeftSpeed = 0;
int currentRightSpeed = 0;

void motorLeft(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    analogWrite(IN1, speed);
    analogWrite(IN2, 0);
  } else if (speed < 0) {
    analogWrite(IN2, -speed);
    analogWrite(IN1, 0);
  } else {
    analogWrite(IN1, 0);
    analogWrite(IN2, 0);
  }
}

void motorRight(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    analogWrite(IN3, speed);
    analogWrite(IN4, 0);
  } else if (speed < 0) {
    analogWrite(IN4, -speed);
    analogWrite(IN3, 0);
  } else {
    analogWrite(IN3, 0);
    analogWrite(IN4, 0);
  }
}

void setMotorSpeed(int targetLeft, int targetRight) {
  // Gradually ramp Left
    motorLeft(targetLeft);
    motorRight(targetRight);

}

// ====== LINE FOLLOWING (3 SENSOR) ======
void lineFollow3Sensor() {
  int L = digitalRead(LEFT_SENSOR);
  int M = digitalRead(MIDDLE_SENSOR);
  int R = digitalRead(RIGHT_SENSOR);

  /*
    Sensor logic:
    0 = white line
    1 = black background
  */
  // Serial.print("L: "); Serial.print(L);
  // Serial.print(" M: "); Serial.print(M);
  // Serial.print(" R: "); Serial.println(R);

  // Perfectly centered
  if (M == 0 && L == 1 && R == 1) {
    setMotorSpeed(maxSpeed, maxSpeed);
  }

  // Slight left deviation
  else if (L == 0 && M == 0 && R == 1) {
    setMotorSpeed(maxSpeed - 40, maxSpeed);
  }

  // Slight right deviation
  else if (R == 0 && M == 0 && L == 1) {
    setMotorSpeed(maxSpeed, maxSpeed - 40);
  }

  // Sharp left turn
  else if (L == 0 && M == 1 && R == 1) {
    setMotorSpeed(-turnSpeed, maxSpeed);
  }

  // Sharp right turn
  else if (R == 0 && M == 1 && L == 1) {
    setMotorSpeed(maxSpeed, -turnSpeed);
  }

  // All sensors on line (junction / stop)
  else if (L == 0 && M == 0 && R == 0) {
    setMotorSpeed(maxSpeed, maxSpeed);
  }

  // Line lost
  else {
    setMotorSpeed(0, 0);
  }
}

// ====== INTERRUPT & ROAD QUALITY ======
volatile int vibCount = 0;
const int SAMPLE_COUNT = 10;
float azValues[SAMPLE_COUNT];
int indexA = 0;
unsigned long lastRoadCheck = 0;
const unsigned long ROAD_INTERVAL = 1000;

void IRAM_ATTR vibISR() { vibCount++; }

float computeStdDev(float *arr, int n) {
  float sum = 0, mean, stddev = 0;
  for(int i=0;i<n;i++) sum += arr[i];
  mean = sum / n;
  for(int i=0;i<n;i++) stddev += pow(arr[i]-mean,2);
  return sqrt(stddev/n);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) Serial.println("Connected to WebSocket");
  else if (type == WStype_DISCONNECTED) Serial.println("Disconnected");
}

void websocket_data(void* params){
  while(1){
      webSocket.loop();
    if(millis() - lastRoadCheck >= ROAD_INTERVAL) {
      String message = "{\"roadQuality\":" + String(roadQuality, 2) +
                        ",\"condition\":\"" + roadState + "\"}";
        webSocket.sendTXT(message);
      Serial.println(message);
      vibCount = 0;
      lastRoadCheck = millis();
   }
   vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ====== SETUP ======
void setup() {
  Serial.begin(115200);

  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);

  pinMode(LEFT_SENSOR, INPUT);
  pinMode(MIDDLE_SENSOR, INPUT);
  pinMode(RIGHT_SENSOR, INPUT);

  pinMode(VIB_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(VIB_PIN), vibISR, RISING);

  Wire.begin();
  dht.begin();

  if(!mpu.begin()) {
    Serial.println("MPU6050 not found!");
    while(1);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_10_HZ);

  Serial.println("ESP32 2-Sensor White Line Follower Ready!");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
        delay(1000);
        Serial.print(".");
    }
  Serial.println("\nWiFi connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.println("Connecting to WebSocket server...");
  webSocket.begin(serverAddress, serverPort, "/data");  // Connect to the WebSocket server
  webSocket.onEvent(webSocketEvent);  // Attach event handler

  xTaskCreatePinnedToCore(websocket_data,  "Task1", 4096, NULL, 1, NULL, 0);
}

// ====== MAIN LOOP ======
void loop() {
      // <--- Add this at the very start

  // --- LINE FOLLOWING ---
  lineFollow3Sensor();

  // --- ROAD QUALITY MONITOR ---
  sensors_event_t a, g, tempEvent;
  mpu.getEvent(&a, &g, &tempEvent);
  azValues[indexA] = a.acceleration.z;
  indexA = (indexA + 1) % SAMPLE_COUNT;
  float stdAz = computeStdDev(azValues, SAMPLE_COUNT);

  if(millis() - lastRoadCheck >= ROAD_INTERVAL) {
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();

    float vibNorm = min(vibCount / 10.0, 1.0);
    float roughness = 0.8 * stdAz + 0.4 * vibNorm;

    float traction = 1.0;
    if(temp < 5) traction -= 0.4;
    else if(temp > 30) traction -= 0.3;
    if(hum > 60) traction -= 0.3;
    traction = max(traction, 0.4f);

    float normR = constrain(roughness / 1.5, 0.0, 1.0);
    roadQuality = (1.0 - normR) * traction;

    roadState = (roadQuality > 0.85) ? "GOOD" :
                       (roadQuality > 0.45) ? "MEDIUM" : "BAD";

    // Serial.println("===== ROAD QUALITY REPORT =====");
    // Serial.print("Temp: "); Serial.print(temp); Serial.print(" °C  ");
    // Serial.print("Humidity: "); Serial.print(hum); Serial.println(" %");
    // Serial.print("Accel Z stddev: "); Serial.println(stdAz, 3);
    // Serial.print("Vibration count/sec: "); Serial.println(vibCount);
    // Serial.print("Road Quality Score: "); Serial.println(roadQuality, 2);
    // Serial.print("Condition: "); Serial.println(roadState);
    // Serial.println();


  }
}