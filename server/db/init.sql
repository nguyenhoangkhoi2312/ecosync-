CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE sensor_readings (
  time        TIMESTAMPTZ NOT NULL,
  zone_id     TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  value       DOUBLE PRECISION
);

SELECT create_hypertable('sensor_readings', 'time');

CREATE INDEX ON sensor_readings (zone_id, time DESC);

-- [GEMINI] 5-minute downsampling for long-term trends
CREATE MATERIALIZED VIEW sensor_readings_5m
WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', time) AS bucket,
       zone_id,
       sensor_type,
       AVG(value) as avg_value
FROM sensor_readings
GROUP BY bucket, zone_id, sensor_type;

SELECT add_continuous_aggregate_policy('sensor_readings_5m',
    start_offset => INTERVAL '1 month',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes');

-- [GEMINI] Retention policies
SELECT add_retention_policy('sensor_readings', INTERVAL '7 days');
SELECT add_retention_policy('sensor_readings_5m', INTERVAL '90 days');
