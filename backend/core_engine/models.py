from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
import datetime
from .database import Base

class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    capacity = Column(Integer, default=30)
    current_occupancy = Column(Integer, default=0)
    target_temp = Column(Integer, default=24)
    
    devices = relationship("Device", back_populates="zone")
    logs = relationship("SensorLog", back_populates="zone")

class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    device_type = Column(String) # 'HVAC' or 'LIGHT'
    is_active = Column(Boolean, default=True)
    zone_id = Column(Integer, ForeignKey("zones.id"))

    zone = relationship("Zone", back_populates="devices")

class SensorLog(Base):
    __tablename__ = "sensor_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    occupancy = Column(Integer, default=0)
    zone_id = Column(Integer, ForeignKey("zones.id"))

    zone = relationship("Zone", back_populates="logs")
