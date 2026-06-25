import uuid

def build_netlist(symbols):
    """
    Stubs the Hough Transform / PaddleOCR netlist graph builder.
    In reality, this would look at lines connecting symbols and OCR text like 'L1', 'L2'.
    Here, we mock the grouping logic.
    Returns: list of circuits/panels and their connected devices.
    """
    
    # Separate panels from devices
    panels = [s for s in symbols if s["type"] == "panel"]
    devices = [s for s in symbols if s["type"] != "panel"]
    
    netlist = []
    
    # If no panel detected, fake one
    if not panels:
        panel_id = "panel-main-" + str(uuid.uuid4())[:8]
    else:
        panel_id = "panel-" + str(uuid.uuid4())[:8]
        
    # Group devices into mocked circuits (e.g., lights in one circuit, AC in another)
    light_circuit = {
        "circuit_id": "circuit-lighting-1",
        "panel_id": panel_id,
        "devices": []
    }
    
    hvac_circuit = {
        "circuit_id": "circuit-hvac-1",
        "panel_id": panel_id,
        "devices": []
    }
    
    sensor_circuit = {
        "circuit_id": "circuit-sensors-1",
        "panel_id": panel_id,
        "devices": []
    }

    for idx, d in enumerate(devices):
        dev_id = f"device-{d['type']}-{idx}"
        d["id"] = dev_id # inject ID into symbol for cross-referencing
        
        if d["type"] == "light":
            light_circuit["devices"].append(dev_id)
        elif d["type"] == "ac_unit":
            hvac_circuit["devices"].append(dev_id)
        elif "sensor" in d["type"]:
            sensor_circuit["devices"].append(dev_id)
            
    if light_circuit["devices"]: netlist.append(light_circuit)
    if hvac_circuit["devices"]: netlist.append(hvac_circuit)
    if sensor_circuit["devices"]: netlist.append(sensor_circuit)
    
    return {
        "panels": [{"id": panel_id}],
        "circuits": netlist
    }
