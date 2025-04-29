# Schedule‑Planner

A lightweight SPA + Flask backend that lets students pick course sections and instantly enumerate every **clash‑free timetable**.

**Requirements**
- [Python 3.9+](https://www.python.org/downloads/release/python-390/) with [Flask 3.1.0](https://pypi.org/project/Flask/3.1.0/) installed
- Modern browser (ES 2020 support)

---


## Quick start
```bash
git clone https://github.com/Deep0Thinking/Schedule-Planner
cd schedule-planner
python -m venv venv && source venv/bin/activate  # optional
pip install Flask
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