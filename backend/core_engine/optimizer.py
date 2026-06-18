from sqlalchemy.orm import Session
from . import models

class OptimizationEngine:
    """
    Core logic for evaluating zone state and dispatching commands.
    """
    
    @staticmethod
    def evaluate_zone(db: Session, zone: models.Zone):
        print(f"[Optimizer] Evaluating Zone {zone.name} (Occupancy: {zone.current_occupancy})")
        
        # Rule 1: Vacant Zone Energy Saver
        if zone.current_occupancy == 0:
            print(f"[Optimizer] Zone {zone.name} is vacant. Engaging energy saver.")
            zone.target_temp = 28 # Increase temp
            # Turn off lights
            for dev in zone.devices:
                if dev.device_type == 'LIGHT':
                    dev.is_active = False
                    
        # Rule 2: Occupied Zone Comfort Restorer
        elif zone.current_occupancy > 0:
            print(f"[Optimizer] Zone {zone.name} is occupied. Restoring comfort.")
            zone.target_temp = 24 # Normal temp
            # Turn on lights
            for dev in zone.devices:
                if dev.device_type == 'LIGHT':
                    dev.is_active = True
                    
        db.commit()
        db.refresh(zone)
        
        # Here we would typically dispatch MQTT messages to Edge devices
        # mqtt_client.publish(f"ecosync/control/{zone.name}/hvac", zone.target_temp)
        
        return zone
