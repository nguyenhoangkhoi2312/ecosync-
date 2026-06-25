package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// [GEMINI IMPLEMENTATION START]
// Added by Gemini (Antigravity) on June 2026.
// Handles connection to TimescaleDB and inserts/queries for history.

var DB *sql.DB

// reading is one buffered metric sample awaiting a batched insert.
type reading struct {
	t     time.Time
	zone  string
	stype string
	value float64
}

// writeCh decouples the engine's broadcast goroutine (30 fps hot path) from the
// database. persistReading only enqueues; writeLoop batches and flushes. nil until
// initDB succeeds.
var writeCh chan reading

func initDB() {
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "postgres://econ:econ@localhost:5432/econ?sslmode=disable"
	}

	var err error
	DB, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[db] Failed to open DB: %v", err)
		DB = nil
		return
	}

	if err = DB.Ping(); err != nil {
		log.Printf("[db] DB not reachable (is the container up?): %v", err)
		DB = nil
		return
	}
	DB.SetMaxOpenConns(8)
	DB.SetMaxIdleConns(4)

	writeCh = make(chan reading, 8192)
	go writeLoop()
	log.Println("[db] Connected to TimescaleDB.")
}

// persistReading is called once per metric per zone from the engine. It must never
// block the broadcast goroutine, so it only enqueues; if the buffer is saturated the
// sample is dropped (history is best-effort, the live stream is the source of truth).
func persistReading(zoneId, sensorType string, value float64) {
	if writeCh == nil {
		return
	}
	select {
	case writeCh <- reading{time.Now(), zoneId, sensorType, value}:
	default:
		// buffer full — drop rather than stall the engine.
	}
}

// writeLoop drains writeCh and flushes batched multi-row inserts, either when a batch
// fills or on a short timer, so a full building's worth of samples costs one round-trip
// instead of hundreds.
func writeLoop() {
	const maxBatch = 512
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	buf := make([]reading, 0, maxBatch)
	flush := func() {
		if len(buf) == 0 || DB == nil {
			buf = buf[:0]
			return
		}
		var sb strings.Builder
		sb.WriteString("INSERT INTO sensor_readings (time, zone_id, sensor_type, value) VALUES ")
		args := make([]interface{}, 0, len(buf)*4)
		for i, r := range buf {
			if i > 0 {
				sb.WriteByte(',')
			}
			n := i * 4
			fmt.Fprintf(&sb, "($%d,$%d,$%d,$%d)", n+1, n+2, n+3, n+4)
			args = append(args, r.t, r.zone, r.stype, r.value)
		}
		if _, err := DB.Exec(sb.String(), args...); err != nil {
			log.Printf("[db] batch insert failed (%d rows): %v", len(buf), err)
		}
		buf = buf[:0]
	}

	for {
		select {
		case r := <-writeCh:
			buf = append(buf, r)
			if len(buf) >= maxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if DB == nil {
		w.Write([]byte("[]"))
		return
	}

	zone := r.URL.Query().Get("zone")
	if zone == "" {
		zone = "GLOBAL"
	}

	minutesStr := r.URL.Query().Get("minutes")
	limit := 60
	if minutesStr != "" {
		if m, err := strconv.Atoi(minutesStr); err == nil && m > 0 {
			limit = m * 60
		}
	}

	var rows *sql.Rows
	var err error

	if zone == "GLOBAL" {
		rows, err = DB.Query(`
			SELECT
				to_char(time_bucket('1 second', time), 'HH24:MI:SS') as time_str,
				MAX(CASE WHEN sensor_type = 'buildingLoadMw' THEN value ELSE 0 END) * 1000 AS pwr,
				MAX(CASE WHEN sensor_type = 'avgCo2' THEN value ELSE 0 END) AS co2
			FROM sensor_readings
			WHERE zone_id = 'GLOBAL'
			GROUP BY time_bucket('1 second', time)
			ORDER BY time_bucket('1 second', time) DESC
			LIMIT $1
		`, limit)
	} else {
		rows, err = DB.Query(`
			SELECT
				to_char(time_bucket('1 second', time), 'HH24:MI:SS') as time_str,
				MAX(CASE WHEN sensor_type = 'temp' THEN value ELSE 0 END) AS pwr,
				MAX(CASE WHEN sensor_type = 'occupancy' THEN value ELSE 0 END) AS co2
			FROM sensor_readings
			WHERE zone_id = $1
			GROUP BY time_bucket('1 second', time)
			ORDER BY time_bucket('1 second', time) DESC
			LIMIT $2
		`, zone, limit)
	}

	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type histItem struct {
		Time string  `json:"time"`
		Pwr  float64 `json:"pwr"`
		Co2  float64 `json:"co2"`
	}
	var res []histItem
	for rows.Next() {
		var item histItem
		if err := rows.Scan(&item.Time, &item.Pwr, &item.Co2); err == nil {
			res = append([]histItem{item}, res...) // prepend to get chronological order
		}
	}

	importJson, _ := json.Marshal(res)
	w.Write(importJson)
}

// [GEMINI IMPLEMENTATION END]
