package main

import (
	"econ/simulation"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for dev
	},
}

func main() {
	// 1. Serve static building data
	http.HandleFunc("/api/building-data", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		data, err := os.ReadFile("./data/building-data.json")
		if err != nil {
			http.Error(w, "Failed to read building data", http.StatusInternalServerError)
			return
		}
		w.Write(data)
	})

	// 2. Serve Brick Ontology Data
	http.HandleFunc("/api/ontology", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		data, err := os.ReadFile("./data/brick-ontology.json")
		if err != nil {
			http.Error(w, "Failed to read ontology data", http.StatusInternalServerError)
			return
		}
		w.Write(data)
	})

	// Initialize simulation engine
	engine := simulation.NewEngine()

	// [GEMINI IMPLEMENTATION START]
	initDB()
	engine.Persist = persistReading
	http.HandleFunc("/api/history", historyHandler)
	// [GEMINI IMPLEMENTATION END]

	// 3. Peak-load forecast: proxy a live-telemetry window to the Python LSTM service.
	http.HandleFunc("/api/forecast", forecastHandler(engine))

	// Connect to the MQTT broker: ingest real occupancy from the CV/edge layer and
	// publish actuation commands to the ESP32. Non-blocking; the sim runs regardless.
	startMQTT(engine)

	go engine.Start()

	// 2. WebSocket endpoint for telemetry streaming
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(w, r, engine)
	})

	// Start server
	port := "8080"
	log.Printf("ECON Enterprise Backend running on port %s...\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request, engine *simulation.Engine) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	engine.AddClient(conn)
	defer engine.RemoveClient(conn)

	log.Println("New telemetry client connected!")

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("Client disconnected")
			break
		}
		log.Printf("Received command: %s", string(msg))
		// Isolate command handling: a panic here must never take down the whole
		// backend (and thus stop the telemetry stream for every client).
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("recovered from panic handling command %q: %v", string(msg), r)
				}
			}()
			// [GEMINI IMPLEMENTATION START]
			// Added by Gemini (Antigravity) on June 2026.
			// This block intercepts JSON payloads for manual override vetos
			// sent from the dashboard, parsing them to trigger PublishCommand
			// while leaving legacy string scenarios intact.
			strMsg := string(msg)
			if len(strMsg) > 0 && strMsg[0] == '{' {
				var override map[string]string
				if err := json.Unmarshal(msg, &override); err == nil {
					if action, ok := override["action"]; ok {
						if zone, ok := override["zone"]; ok {
							engine.PublishCommand(action, zone)
							return
						}
					}
				}
			}
			// [GEMINI IMPLEMENTATION END]
			engine.SetScenario(strMsg)
		}()
	}
}
