// scripts.js

// === DOM references ===
const coursesContainer  = document.getElementById("coursesContainer");
const scheduleResultsDiv = document.getElementById("scheduleResults");
const form              = document.getElementById("coursesForm");
const toggleAllBtn      = document.getElementById("toggleAllBtn");
const scheduleCountSpan = document.getElementById("scheduleCountSpan");

// === Time constants (minutes) ===
const EARLIEST_MIN = 8  * 60;   // 08:00
const LATEST_MIN   = 20 * 60;   // 20:00
const INTERVAL_MIN = 30;        // 30‑min slots

// Monday‑Friday shortcuts
const DAYS = ["M", "T", "W", "R", "F"];

// 10 distinguishable CSS classes for course blocks
const courseColors = [
  "course-color-0","course-color-1","course-color-2","course-color-3","course-color-4",
  "course-color-5","course-color-6","course-color-7","course-color-8","course-color-9"
];

let allCourses = [];                        // master catalog (populated on load)
let globalCourseColorMap = {};              // courseName → color class
let allInFullMode = false;                  // preview/full toggle state
let sectionSelectionState = {};             // CRN → checked?

// Format minutes → "H:MM"
function minutesToHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

// ========== 1) Build course cards on page load ==========
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/courses");
    if (!res.ok) throw new Error("/api/courses failed");
    allCourses = await res.json();

    // Stable color per course
    allCourses.forEach((c, i) => {
      globalCourseColorMap[c.courseName] = courseColors[i % courseColors.length];
    });

    // Init sectionSelectionState (CLOSED sections start unchecked/disabled)
    allCourses.forEach(c => c.sections.forEach(sec => {
      sectionSelectionState[sec.CRN] = !(sec.Status?.toUpperCase() === "CLOSED");
    }));

    // Create one label (with checkbox + info icon) per course
    allCourses.forEach(course => {
      const label = document.createElement("label");
      label.classList.add(globalCourseColorMap[course.courseName]);

      // Course‑level checkbox: on if any open section exists
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "courseCheck";
      input.value = course.courseName;
      input.checked = course.sections.some(sec => sec.Status?.toUpperCase() !== "CLOSED");

      // Sync all open sections when user toggles course‑level box
      input.addEventListener("change", e => {
        const on = e.target.checked;
        course.sections.forEach(sec => {
          sectionSelectionState[sec.CRN] = on && sec.Status?.toUpperCase() !== "CLOSED";
        });
        updateTotalUnits();
      });

      // Info icon opens section picker
      const infoIcon = document.createElement("span");
      infoIcon.classList.add("info-icon");
      infoIcon.innerHTML = "&#9432;";
      infoIcon.title = "Section details";
      infoIcon.addEventListener("click", ev => {
        ev.stopPropagation();
        ev.preventDefault();
        showCourseSectionsPopup(course);
      });

      label.append(input, document.createTextNode(" " + course.courseName), infoIcon);
      coursesContainer.appendChild(label);
    });

    updateCourseCheckboxesFromSections();
    updateTotalUnits();
  } catch (err) {
    console.error(err);
    coursesContainer.innerHTML = "<p>Error loading courses.</p>";
  }
});

// ========== 2) Submit → request schedules ==========
form.addEventListener("submit", async e => {
  e.preventDefault();
  scheduleResultsDiv.textContent = "Loading schedules...";
  scheduleCountSpan.textContent  = "";
  allInFullMode = false;
  toggleAllBtn.textContent = "Show All Full Schedules";

  // Gather selected CRNs per course
  const chosenCourses = allCourses.map(course => {
    const crns = course.sections.filter(sec => sectionSelectionState[sec.CRN]).map(sec => sec.CRN);
    return crns.length ? { courseName: course.courseName, sections: crns } : null;
  }).filter(Boolean);

  try {
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chosenCourses })
    });
    const data = await res.json();
    "error" in data ? renderError(data) : renderSchedules(data);
  } catch (err) {
    console.error(err);
    scheduleResultsDiv.innerHTML = "<p>Error generating schedules.</p>";
  }
});

// ===== Popup: pick sections within one course =====
function showCourseSectionsPopup(course) {
  const overlay = document.createElement("div");
  overlay.classList.add("popup-overlay");

  const popup = document.createElement("div");
  popup.classList.add("course-sections-popup");

  popup.innerHTML = `<h2>${course.courseName}</h2>`;
  popup.insertAdjacentHTML("beforeend",
    `<p><strong>Title:</strong> ${course.Title || ""}<br>
       <strong>Units:</strong> ${course.Unit || ""}<br>
       <strong>Grade Mode:</strong> ${course.GradeMode || ""}<br>
       <strong>Description:</strong> ${course.Description || ""}</p><hr>`);

  // --- sections table ---
  const table = document.createElement("table");
  table.classList.add("sections-table");
  table.innerHTML =
    `<thead><tr><th></th><th>CRN</th><th>Status</th><th>Seats</th><th>Instructor</th><th>Meet</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  course.sections.forEach(sec => {
    const tr = document.createElement("tr");

    // Checkbox (disabled if CLOSED)
    const tdCheck = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    if (sec.Status?.toUpperCase() === "CLOSED") {
      cb.disabled = true;
      cb.checked  = false;
      sectionSelectionState[sec.CRN] = false; // safety
    } else {
      cb.checked = !!sectionSelectionState[sec.CRN];
      cb.addEventListener("change", () => {
        sectionSelectionState[sec.CRN] = cb.checked;
      });
    }
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // CRN
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.CRN }));

    // Status (color‑coded)
    const statusTd = document.createElement("td");
    statusTd.innerHTML = `<span style="color:${getStatusColor(sec.Status)};font-weight:600;">${sec.Status}</span>`;
    tr.appendChild(statusTd);

    // Seats (color‑coded)
    const seatsTd = document.createElement("td");
    seatsTd.innerHTML = `<span style="color:${getRemainingColor(sec.Rem)};">${sec.Act}/${sec.Cap} (Rem: ${sec.Rem})</span>`;
    tr.appendChild(seatsTd);

    tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.Instructor }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.Meet }));

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  popup.appendChild(table);

  // Close btn
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => {
    updateCourseCheckboxesFromSections();
    updateTotalUnits();
    document.body.removeChild(overlay);
  });
  popup.appendChild(closeBtn);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

// Sync course checkboxes after section picker closes
function updateCourseCheckboxesFromSections() {
  allCourses.forEach(course => {
    const label = Array.from(document.querySelectorAll("#coursesContainer label"))
      .find(l => l.querySelector("input[type='checkbox']")?.value === course.courseName);
    if (!label) return;
    const box = label.querySelector("input[type='checkbox']");
    const openSecs   = course.sections.filter(s => s.Status?.toUpperCase() !== "CLOSED");
    const anySelected = openSecs.some(s => sectionSelectionState[s.CRN]);
    box.checked = anySelected;
  });
}

// -------- Render helpers --------
function renderError(data) {
  scheduleResultsDiv.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = data.error || "No valid schedules found.";
  scheduleResultsDiv.appendChild(p);

  if (data.unresolvablePairs?.length) {
    const ul = document.createElement("ul");
    data.unresolvablePairs.forEach(([a,b]) => {
      const li = document.createElement("li");
      li.textContent = `Unresolvable conflict between ${a} and ${b}`;
      ul.appendChild(li);
    });
    scheduleResultsDiv.appendChild(ul);
  }
  scheduleCountSpan.textContent = "";
}

function renderSchedules(schedules) {
  scheduleResultsDiv.innerHTML = "";
  scheduleCountSpan.textContent = "";
  if (!schedules.length) {
    scheduleResultsDiv.innerHTML = "<p>No valid schedules found.</p>";
    return;
  }

  scheduleCountSpan.textContent = `Total Compatible Schedules: ${schedules.length}`;

  schedules.forEach((sched, i) => {
    const block = document.createElement("div");
    block.classList.add("schedule-block");

    // Header
    const header = document.createElement("div");
    header.classList.add("schedule-header");
    header.innerHTML = `<h2>Schedule ${i + 1}</h2>`;
    const toggleBtn = document.createElement("button");
    toggleBtn.classList.add("toggle-btn");
    toggleBtn.textContent = "Show Full Schedule";
    header.appendChild(toggleBtn);
    block.appendChild(header);

    // Preview grid
    const previewWrap = document.createElement("div");
    previewWrap.innerHTML = `<div class='preview-grid-label'>Preview:</div>`;
    const previewTable = buildGenericScheduleTable({
      earliestMin: EARLIEST_MIN, latestMin: LATEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:false, showDetails:false, tableClass:"preview-table"
    });
    fillGenericSchedule(previewTable, sched, {
      earliestMin: EARLIEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:false, showDetails:false
    });
    previewWrap.appendChild(previewTable);
    block.appendChild(previewWrap);

    // Full grid (hidden by default)
    const fullDiv = document.createElement("div");
    fullDiv.classList.add("detailed-schedule","hidden");
    const fullTable = buildGenericScheduleTable({
      earliestMin: EARLIEST_MIN, latestMin: LATEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:true, showDetails:true, tableClass:"schedule-table"
    });
    fillGenericSchedule(fullTable, sched, {
      earliestMin: EARLIEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:true, showDetails:true
    });
    fullDiv.appendChild(fullTable);
    block.appendChild(fullDiv);

    // Toggle btn handler
    toggleBtn.addEventListener("click", () => {
      const showingFull = !fullDiv.classList.contains("hidden");
      if (showingFull) {
        fullDiv.classList.add("hidden");
        previewWrap.classList.remove("hidden");
        toggleBtn.textContent = "Show Full Schedule";
      } else {
        fullDiv.classList.remove("hidden");
        previewWrap.classList.add("hidden");
        toggleBtn.textContent = "Show Preview";
      }
    });

    scheduleResultsDiv.appendChild(block);
  });
}

/**
 * Build a blank weekly grid (Mon–Fri).
 *
 * earliestMin  – first slot in minutes
 * latestMin    – last slot (exclusive)
 * intervalMin  – minutes per row
 * showTimeCol  – prepend HH:MM column
 * tableClass   – extra class applied to <table>
 */
function buildGenericScheduleTable({ earliestMin, latestMin, intervalMin, showTimeCol, showDetails, tableClass }) {
  const table = document.createElement("table");
  if (tableClass) table.classList.add(tableClass);

  /* ---------- header ---------- */
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  if (showTimeCol) headerRow.appendChild(document.createElement("th")); // blank corner

  DAYS.forEach(d => {
    const th = document.createElement("th");
    th.textContent = d;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  /* ---------- body ---------- */
  const tbody = document.createElement("tbody");
  const numRows = (latestMin - earliestMin) / intervalMin; // assume even division

  for (let i = 0; i < numRows; i++) {
    const row = document.createElement("tr");

    if (showTimeCol) {
      const timeTd = document.createElement("td");
      timeTd.classList.add("time-col");
      timeTd.textContent = minutesToHHMM(earliestMin + i * intervalMin);
      row.appendChild(timeTd);
    }

    for (let j = 0; j < DAYS.length; j++) row.appendChild(document.createElement("td"));

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  return table;
}

/**
 * Paint section blocks onto a table built by buildGenericScheduleTable().
 * Each entry in section.times has the form [day, startMin, endMin].
 */
function fillGenericSchedule(table, schedule, { earliestMin, intervalMin, showTimeCol, showDetails }) {
  const rows       = Array.from(table.querySelectorAll("tbody tr"));
  const cellMatrix = rows.map(r => Array.from(r.querySelectorAll("td")));
  const dayOffset  = showTimeCol ? 1 : 0; // shift if HH:MM column present

  schedule.forEach(section => {
    const { courseName, CRN } = section;
    const foundCourse = allCourses.find(c => c.courseName === courseName);
    const colorClass  = foundCourse ? globalCourseColorMap[foundCourse.courseName] : "course-color-0";

    section.times.forEach(([day, startMin, endMin]) => {
      const dayIndex = DAYS.indexOf(day);
      if (dayIndex < 0) return;

      let startIndex = Math.floor((startMin - earliestMin) / intervalMin);
      let endIndex   = Math.ceil((endMin   - earliestMin) / intervalMin);

      // clamp indices into table bounds
      startIndex = Math.max(startIndex, 0);
      endIndex   = Math.min(endIndex, rows.length);
      if (endIndex <= startIndex) return;

      const rowSpan = endIndex - startIndex;
      const topCell = cellMatrix[startIndex][dayIndex + dayOffset];
      if (!topCell) return;

      /* ---- block element ---- */
      const blockDiv = document.createElement("div");
      blockDiv.classList.add("course-block", colorClass);

      if (showDetails) {
        blockDiv.textContent = `${courseName}\n(${CRN})`;
        blockDiv.addEventListener("click", () => showCourseInfoPopup(foundCourse, section));
      }

      // fine‑grained vertical placement within merged cell
      const spanMinutes   = rowSpan * intervalMin;
      const cellStartMin  = earliestMin + startIndex * intervalMin;
      const offsetMinutes = startMin - cellStartMin;

      blockDiv.style.top    = (offsetMinutes / spanMinutes) * 100 + "%";
      blockDiv.style.height = ((endMin - startMin) / spanMinutes) * 100 + "%";

      topCell.appendChild(blockDiv);
      topCell.rowSpan = rowSpan;

      // remove cells hidden by rowSpan
      for (let r = startIndex + 1; r < startIndex + rowSpan; r++) {
        const spanned = cellMatrix[r][dayIndex + dayOffset];
        if (spanned) {
          spanned.remove();
          cellMatrix[r][dayIndex + dayOffset] = null;
        }
      }
    });
  });
}

/** lightweight modal with detailed section info */
function showCourseInfoPopup(course, section) {
  if (!course) { console.warn("No matching course object", section); return; }

  const { courseName, Unit, Title, GradeMode, Description } = course;
  const { Status, Type, CRN, Meet, Cap, Act, Rem, Instructor, StartDate, EndDate, Weeks } = section;

  const overlay = document.createElement("div");
  overlay.classList.add("popup-overlay");

  const popup = document.createElement("div");
  popup.classList.add("course-popup");

  popup.innerHTML = `
    <h2>${courseName}</h2>
    <h3>${Title}</h3>
    <p><strong>Instructor:</strong> ${Instructor}</p>
    <hr>
    <p><strong>Status:</strong> <strong style="color:${getStatusColor(Status)};">${Status}</strong></p>
    <p><strong>Seats:</strong> <strong style="color:${getRemainingColor(Rem)};">${Act} / ${Cap} (Remain: ${Rem})</strong></p>
    <hr>
    <p><strong>CRN:</strong> ${CRN}</p>
    <p><strong>Unit:</strong> ${Unit}</p>
    <p><strong>Type:</strong> ${Type}</p>
    <p><strong>Grade Mode:</strong> ${GradeMode}</p>
    <p><strong>Meeting:</strong> ${Meet}</p>
    <p><strong>Start:</strong> ${StartDate}</p>
    <p><strong>End:</strong> ${EndDate}</p>
    <p><strong>Weeks:</strong> ${Weeks}</p>
    <hr>
    <p><strong>Description:</strong> ${Description || "No description available."}</p>`;

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => document.body.removeChild(overlay));
  popup.appendChild(closeBtn);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

/** map status → color (OPEN, CLOSED, WAITLISTED, SEE INSTRUCTOR) */
function getStatusColor(status) {
  switch (status?.toUpperCase()) {
    case "OPEN":          return "rgb(0,200,0)";   // green
    case "CLOSED":        return "rgb(200,0,0)";   // red
    case "WAITLISTED":    return "rgb(255,204,0)"; // yellow-ish
    case "SEE INSTRUCTOR":return "purple";
    default:               return "#000";
  }
}

/** green when seats remain, else red */
function getRemainingColor(rem) {
  return Number(rem) === 0 ? "rgb(200,0,0)" : "rgb(0,200,0)";
}

/* toggle preview/full for every schedule block */
toggleAllBtn.addEventListener("click", () => {
  allInFullMode = !allInFullMode;

  toggleAllBtn.textContent = allInFullMode ? "Show All Previews" : "Show All Full Schedules";

  document.querySelectorAll(".schedule-block").forEach(block => {
    const preview = block.querySelector(".preview-table")?.closest("div");
    const full    = block.querySelector(".detailed-schedule");
    const btn     = block.querySelector(".toggle-btn");
    if (!preview || !full || !btn) return;

    if (allInFullMode) {
      full.classList.remove("hidden");  preview.classList.add("hidden");
      btn.textContent = "Show Preview";
    } else {
      full.classList.add("hidden");     preview.classList.remove("hidden");
      btn.textContent = "Show Full Schedule";
    }
  });
});

/* recalculate and show "Total Units" under the course list */
function updateTotalUnits() {
  const chosenCourseNames = new Set();

  allCourses.forEach(course => {
    if (course.sections.some(sec => sectionSelectionState[sec.CRN])) {
      chosenCourseNames.add(course.courseName);
    }
  });

  let total = 0;
  chosenCourseNames.forEach(name => {
    const course = allCourses.find(c => c.courseName === name);
    total += Number(course?.Unit) || 0;
  });

  document.getElementById("unitsDisplay").textContent = `Total Units: ${total}`;
}
