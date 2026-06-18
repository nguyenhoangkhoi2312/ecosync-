from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class DeviceBase(BaseModel):
    name: str
    device_type: str
    is_active: bool

class Device(DeviceBase):
    id: int
    zone_id: int
    class Config:
        orm_mode = True

class ZoneBase(BaseModel):
    name: str
    capacity: int = 30
    current_occupancy: int = 0
    target_temp: int = 24

class ZoneCreate(ZoneBase):
    pass

class Zone(ZoneBase):
    id: int
    devices: List[Device] = []
    class Config:
        orm_mode = True

class SensorLogCreate(BaseModel):
    occupancy: int

class SensorLog(SensorLogCreate):
    id: int
    zone_id: int
    timestamp: datetime
    class Config:
        orm_mode = True
