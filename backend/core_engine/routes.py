from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from . import models, schemas
from .database import get_db
from .optimizer import OptimizationEngine

router = APIRouter()

@router.get("/zones", response_model=List[schemas.Zone])
def read_zones(db: Session = Depends(get_db)):
    zones = db.query(models.Zone).all()
    return zones

@router.post("/zones", response_model=schemas.Zone)
def create_zone(zone: schemas.ZoneCreate, db: Session = Depends(get_db)):
    db_zone = models.Zone(**zone.dict())
    db.add(db_zone)
    db.commit()
    db.refresh(db_zone)
    return db_zone

@router.post("/telemetry/{zone_id}", response_model=schemas.Zone)
def log_telemetry(zone_id: int, log: schemas.SensorLogCreate, db: Session = Depends(get_db)):
    """ Endpoint for Branch A to push live occupancy """
    # Find zone
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
        
    # Create log
    new_log = models.SensorLog(occupancy=log.occupancy, zone_id=zone_id)
    db.add(new_log)
    
    # Update current state
    zone.current_occupancy = log.occupancy
    db.commit()
    
    # Run optimization engine
    optimized_zone = OptimizationEngine.evaluate_zone(db, zone)
    
    return optimized_zone
