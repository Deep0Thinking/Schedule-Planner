# schedule_finder.py
# Exhaustively enumerates all conflict-free course schedules using a backtracking DFS.

from typing import List, Dict, Any, Tuple

__all__ = ["generate_schedules_for_chosen_courses", "section_conflicts"]


def generate_schedules_for_chosen_courses(
    all_courses: List[Dict[str, Any]],
    chosen_info: List[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    # Return every clash-free schedule derived from the user's chosen sections.

    # Aggregate the selected sections, grouped by course name.
    per_course: List[Tuple[str, List[Dict[str, Any]]]] = []

    for entry in chosen_info:
        name = entry["courseName"]
        wanted = set(entry["sections"])

        course = next((c for c in all_courses if c["courseName"] == name), None)
        if not course:
            continue  # Ignore stale or misspelled course names from the request.

        picked: List[Dict[str, Any]] = []
        for sec in course["sections"]:
            if sec["CRN"] in wanted:
                picked.append(sec)

        per_course.append((name, picked))

    if not per_course:
        return []

    schedules: List[List[Dict[str, Any]]] = []  # Final list of valid schedules.
    stack: List[Tuple[str, Dict[str, Any]]] = []  # The current path (partial schedule) in the DFS traversal.

    def dfs(i: int) -> None:
        # Recursive DFS helper to explore schedule combinations.
        if i == len(per_course):
            # Base case: a valid schedule is found, add it to the results.
            schedules.append([dict(sec, courseName=name) for name, sec in stack])
            return

        course_name, options = per_course[i]
        for sec in options:
            # Prune this search branch if the new section conflicts with the current path.
            if any(section_conflicts(sec, chosen) for _, chosen in stack):
                continue
            stack.append((course_name, sec))
            dfs(i + 1)
            stack.pop()

    dfs(0)
    return schedules


def section_conflicts(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    # Determines if two sections have any time overlap on any given day.
    for da, sa, ea in a["times"]:
        for db, sb, eb in b["times"]:
            if da == db and not (ea <= sb or eb <= sa):
                return True
    return False