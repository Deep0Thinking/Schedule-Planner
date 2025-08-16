# app.py
# Provides a minimal Flask-based REST API for the Schedule-Planner frontend.

from flask import Flask, request, jsonify, send_from_directory
import os, json
from datetime import datetime

from schedule_finder import generate_schedules_for_chosen_courses, section_conflicts

app = Flask(__name__, static_folder="static")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COURSES_FILE = os.path.join(BASE_DIR, "courses.json")
ALL_COURSES = []  # Global cache for the course catalog, loaded at startup.


@app.get("/api/courses")
def api_courses():
    # Returns the complete, pre-processed course catalog.
    return jsonify(ALL_COURSES)


@app.post("/api/schedules")
def api_schedules():
    # Generates schedules from a JSON payload of chosen courses and sections.
    body = request.get_json(silent=True) or {}
    chosen = body.get("chosenCourses", [])
    if not (isinstance(chosen, list) and chosen):
        return jsonify({"error": "chosenCourses must be a non-empty list"}), 400

    schedules = generate_schedules_for_chosen_courses(ALL_COURSES, chosen)
    if schedules:
        return jsonify(schedules)

    # If no schedules are possible, identify pairs of courses that are inherently in conflict.
    return jsonify({
        "error": "No valid schedules found",
        "unresolvablePairs": find_unresolvable_pairs(ALL_COURSES, chosen)
    })


@app.get("/")
def root():
    # Serves the main index.html, the entry point for the SPA.
    return send_from_directory(app.static_folder, "index.html")


def load_courses():
    # Loads, validates, and pre-processes the course data from courses.json.
    with open(COURSES_FILE, encoding="utf-8") as f:
        courses = json.load(f)

    ok_status = {"CLOSED", "OPEN", "WAITLISTED", "SEE INSTRUCTOR"}
    ok_type = {"HY", "L", "OD", "LL", "B"}
    ok_meet = {"Lab", "Lecture", "DE Online Lecture"}
    date_fmt = "%Y/%m/%d"

    for course in courses:
        for s in course["sections"]:
            if s["Status"] not in ok_status: raise ValueError(s)
            if s["Type"] not in ok_type:     raise ValueError(s)
            if s["Meet"] not in ok_meet:     raise ValueError(s)
            if not isinstance(s["CRN"], int): raise ValueError(s)

            # Normalize meeting times into a more accessible list of [day, start_minute, end_minute].
            s["times"] = [
                [mt["day"], int(mt["start"]), int(mt["end"])]
                for mt in s["MeetingTime"] if int(mt["start"]) < int(mt["end"])
            ]

            # Calculate the total course duration in weeks.
            st = datetime.strptime(s["StartDate"], date_fmt)
            ed = datetime.strptime(s["EndDate"], date_fmt)
            s["Weeks"] = (ed - st).days // 7

    return courses


def find_unresolvable_pairs(all_courses, chosen_info):
    # Identifies pairs of courses for which no non-conflicting section combination exists.
    chosen_map = {c["courseName"]: set(c["sections"]) for c in chosen_info}
    relevant = [c for c in all_courses if c["courseName"] in chosen_map]
    bad_pairs = []

    for i in range(len(relevant)):
        for j in range(i + 1, len(relevant)):
            a, b = relevant[i], relevant[j]
            # If all combinations of selected sections for courses a and b conflict, they are unresolvable.
            if not any(
                not section_conflicts(sa, sb)
                for sa in a["sections"] if sa["CRN"] in chosen_map[a["courseName"]]
                for sb in b["sections"] if sb["CRN"] in chosen_map[b["courseName"]]
            ):
                bad_pairs.append([a["courseName"], b["courseName"]])
    return bad_pairs


if __name__ == "__main__":
    # Load course data into memory and start the development server.
    ALL_COURSES = load_courses()
    app.run(debug=True)