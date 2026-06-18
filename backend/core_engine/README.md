# Backend: Core AI Engine

This is the central state management and decision-making engine.

## Role in EcoSync
- Receives real-time occupancy counts (from Branch A).
- Receives the electrical layout digital twin (from Branch B).
- Fuses this state to know "How many people are in Zone X, and what devices map to Zone X?".
- Contains the Optimization Engine to generate actionable commands (e.g., dim lights, adjust HVAC).
