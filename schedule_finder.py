"""schedule_finder.py

Exhaustively enumerates all conflict-free course schedules.

Input  (UI)  :: [{"courseName": str, "sections": [CRN, …]}, …]
Catalog req :: each section owns
                 MeetingTime → [{"day": str, "start": int, "end": int}]
Output       :: [[section, …], …] — each inner list is one valid timetable
                 with section["courseName"] injected.

Algorithm: depth-first search over the Cartesian product of the selected
sections, backtracking immediately upon the first time clash (minute precision).
"""

from typing import List, Dict, Any, Tuple

__all__ = ["generate_schedules_for_chosen_courses", "section_conflicts"]

# -------- Public API -------- #

def generate_schedules_for_chosen_courses(
    all_courses: List[Dict[str, Any]],
    chosen_info: List[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    """Return every clash-free schedule derived from *chosen_info*.

    Parameters
    ----------
    all_courses : full catalog as served by /api/courses
    chosen_info : UI payload containing only the CRNs kept checked

    Returns
    -------
    list[list[dict]]
        Each inner list represents one schedule; every section dict is
        augmented with the key ``courseName``.
    """

    # Build [(courseName, [candidate section, …]), …] restricted to chosen CRNs.
    per_course: List[Tuple[str, List[Dict[str, Any]]]] = []

    for entry in chosen_info:
        name = entry["courseName"]
        wanted = set(entry["sections"])

        course = next((c for c in all_courses if c["courseName"] == name), None)
        if not course:
            continue  # ignore stale or misspelled names

        picked: List[Dict[str, Any]] = []
        for sec in course["sections"]:
            if sec["CRN"] in wanted:
                clone = dict(sec)                     # leave original intact
                clone["times"] = [
                    [mt["day"], mt["start"], mt["end"]] for mt in sec["MeetingTime"]
                ]
                picked.append(clone)

        per_course.append((name, picked))

    if not per_course:
        return []

    # -------- depth-first search over Cartesian product --------
    schedules: List[List[Dict[str, Any]]] = []
    stack: List[Tuple[str, Dict[str, Any]]] = []  # partial (courseName, section)

    def dfs(i: int) -> None:
        if i == len(per_course):
            # completed choice → commit one schedule
            schedules.append([dict(sec, courseName=name) for name, sec in stack])
            return

        course_name, options = per_course[i]
        for sec in options:
            if any(section_conflicts(sec, chosen) for _, chosen in stack):
                continue  # clash — prune branch
            stack.append((course_name, sec))
            dfs(i + 1)
            stack.pop()

    dfs(0)
    return schedules

# -------- Helper -------- #

def section_conflicts(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    """True if sections *a* and *b* overlap on the same day (minute-granular)."""
    for da, sa, ea in a["times"]:
        for db, sb, eb in b["times"]:
            if da == db and not (ea <= sb or eb <= sa):
                return True
    return False
