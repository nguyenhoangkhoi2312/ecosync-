from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from . import models, routes
from .database import engine

# Create tables if they don't exist
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="EcoSync AI Core Engine", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router, prefix="/api", tags=["core"])

@app.get("/")
def read_root():
    return {"message": "EcoSync AI API is running with SQLite DB"}

