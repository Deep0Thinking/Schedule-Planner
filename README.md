# Schedule‑Planner

A lightweight SPA + Flask backend that lets students pick course sections and instantly enumerate every **clash‑free timetable**.

**Requirements**
- [Python 3.9+](https://www.python.org/downloads/release/python-390/)
- Modern browser (ES 2020 support)

---


## Quick start
```bash
git clone https://github.com/Deep0Thinking/Schedule-Planner
cd schedule-planner
python -m venv venv && source venv/bin/activate  # optional
pip install -r requirements.txt
python app.py  # → http://localhost:5000/
```
`courses.json` is loaded at boot; edit & restart to refresh the catalogue.

---

## Layout
```
app.py             # Flask API
schedule_finder.py # DFS engine
static/
  ├─ index.html
  ├─ scripts.js
  └─ styles.css
courses.json       # Master data
```