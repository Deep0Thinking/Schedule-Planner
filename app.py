"""
Schedule-Planner Backend (Flask)

Provides a minimal REST API consumed by the front-end SPA.

Endpoints
---------
GET  /api/courses      - full course catalog
POST /api/schedules    - conflict-free schedule generation
GET  /                 - index.html (SPA entry point)
"""
from flask import Flask, request, jsonify, send_from_directory
import os, json
from datetime import datetime

from schedule_finder import generate_schedules_for_chosen_courses, section_conflicts

app = Flask(__name__, static_folder="static")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COURSES_FILE = os.path.join(BASE_DIR, "courses.json")
ALL_COURSES = []  # set at start-up


# -------- REST API -------- #

@app.get("/api/courses")
def api_courses():
    """Return the complete, pre-validated course catalog."""
    return jsonify(ALL_COURSES)


@app.post("/api/schedules")
def api_schedules():
    """Generate all conflict-free schedules matching the client's selection.

    Request Body
    ------------
    {
        "chosenCourses": [
            {"courseName": str, "sections": [CRN, ...]},
            ...
        ]
    }

    Responses
    ---------
    200 OK  - [schedule, ...]                         (success)
    200 OK  - {"error", "unresolvablePairs"}          (no solution)
    400 BAD - {"error"}                               (malformed body)
    """
    body = request.get_json(silent=True) or {}
    chosen = body.get("chosenCourses", [])
    if not (isinstance(chosen, list) and chosen):
        return jsonify({"error": "chosenCourses must be a non-empty list"}), 400

    schedules = generate_schedules_for_chosen_courses(ALL_COURSES, chosen)
    if schedules:
        return jsonify(schedules)

    return jsonify({
        "error": "No valid schedules found",
        "unresolvablePairs": find_unresolvable_pairs(ALL_COURSES, chosen)
    })


@app.get("/")
def root():
    """Serve the single-page front-end."""
    return send_from_directory(app.static_folder, "index.html")


# -------- Helpers -------- #

def load_courses():
    """Load *courses.json*, normalize each section, and perform validation.

    Adds to each section:
    - times  : [[day, start, end], ...] (all in minutes)
    - Weeks  : course duration in whole weeks
    """
    with open(COURSES_FILE, encoding="utf-8") as f:
        courses = json.load(f)

    ok_status = {"CLOSED", "OPEN", "WAITLISTED", "SEE INSTRUCTOR"}
    ok_type   = {"HY", "L", "OD", "LL", "B"}
    ok_meet   = {"Lab", "Lecture", "DE Online Lecture"}
    date_fmt  = "%Y/%m/%d"

    for course in courses:
        for s in course["sections"]:
            # Validation
            if s["Status"] not in ok_status:  raise ValueError(s)
            if s["Type"]   not in ok_type:    raise ValueError(s)
            if s["Meet"]   not in ok_meet:    raise ValueError(s)
            if not isinstance(s["CRN"], int): raise ValueError(s)

            # Derived fields
            # MeetingTime → times : [[day, start, end], ...]
            s["times"] = [
                [mt["day"], int(mt["start"]), int(mt["end"])]
                for mt in s["MeetingTime"] if int(mt["start"]) < int(mt["end"])
            ]

            # Whole-week course duration
            st = datetime.strptime(s["StartDate"], date_fmt)
            ed = datetime.strptime(s["EndDate"], date_fmt)
            s["Weeks"] = (ed - st).days // 7

    return courses


def find_unresolvable_pairs(all_courses, chosen_info):
    """Return course pairs that can never coexist under the chosen CRNs."""
    chosen_map = {c["courseName"]: set(c["sections"]) for c in chosen_info}
    relevant   = [c for c in all_courses if c["courseName"] in chosen_map]
    bad_pairs  = []

    for i in range(len(relevant)):
        for j in range(i + 1, len(relevant)):
            a, b = relevant[i], relevant[j]
            # If every pairing of the chosen sections conflicts, record the courses.
            if not any(
                not section_conflicts(sa, sb)
                for sa in a["sections"] if sa["CRN"] in chosen_map[a["courseName"]]
                for sb in b["sections"] if sb["CRN"] in chosen_map[b["courseName"]]
            ):
                bad_pairs.append([a["courseName"], b["courseName"]])
    return bad_pairs


# -------- Entry Point -------- #

if __name__ == "__main__":
    ALL_COURSES = load_courses()
    app.run(debug=True)
