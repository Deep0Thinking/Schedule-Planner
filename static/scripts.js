// scripts.js

const coursesContainer  = document.getElementById("coursesContainer");
const scheduleResultsDiv = document.getElementById("scheduleResults");
const form              = document.getElementById("coursesForm");
const toggleAllBtn      = document.getElementById("toggleAllBtn");
const scheduleCountSpan = document.getElementById("scheduleCountSpan");
const sortSelect = document.getElementById("sort-select");
const resultsControls = document.getElementById("results-controls");
const sortDirBtn = document.getElementById("sort-direction-btn");

const EARLIEST_MIN = 8  * 60;   // 08:00
const LATEST_MIN   = 20 * 60;   // 20:00
const INTERVAL_MIN = 30;        // 30‑min slots

const DAYS = ["M", "T", "W", "R", "F"];
const courseColors = [ // 10 distinguishable CSS classes for course blocks
  "course-color-0","course-color-1","course-color-2","course-color-3","course-color-4",
  "course-color-5","course-color-6","course-color-7","course-color-8","course-color-9"
];

let allCourses = [];
let globalCourseColorMap = {};
let allInFullMode = false;
let sectionSelectionState = {};
let currentSchedules = []; // Holds fetched schedules with their metrics
let prioritizedCourseNames = []; // An ordered list of checked course names
let isSortAscending = true;

function minutesToHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/courses");
    if (!res.ok) throw new Error("/api/courses failed");
    allCourses = await res.json();

    allCourses.forEach((c, i) => { // Assign a stable color to each course
      globalCourseColorMap[c.courseName] = courseColors[i % courseColors.length];
    });

    allCourses.forEach(c => c.sections.forEach(sec => { // Initialize section checkboxes; disable closed ones
      sectionSelectionState[sec.CRN] = !(sec.Status?.toUpperCase() === "CLOSED");
    }));

    allCourses.forEach(course => { // Create a UI entry for each course from the catalog
      const label = document.createElement("label");
      label.classList.add(globalCourseColorMap[course.courseName]);

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "courseCheck";
      input.value = course.courseName;
      input.checked = course.sections.some(sec => sec.Status?.toUpperCase() !== "CLOSED");

      input.addEventListener("change", e => { // Handle course selection and update priority list
        const on = e.target.checked;
        const courseName = e.target.value;
        course.sections.forEach(sec => {
          sectionSelectionState[sec.CRN] = on && sec.Status?.toUpperCase() !== "CLOSED";
        });
        if (on) {
            if (!prioritizedCourseNames.includes(courseName)) prioritizedCourseNames.push(courseName);
        } else {
            prioritizedCourseNames = prioritizedCourseNames.filter(name => name !== courseName);
        }
        updateTotalUnits();
      });

      const infoIcon = document.createElement("span"); // Info icon opens the section picker popup
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

form.addEventListener("submit", async e => {
  e.preventDefault();
  scheduleResultsDiv.textContent = "Loading schedules...";
  scheduleCountSpan.textContent  = "";
  resultsControls.style.display = "none";

  const chosenCourses = prioritizedCourseNames.map(courseName => {
    const course = allCourses.find(c => c.courseName === courseName);
    const crns = course.sections
        .filter(sec => sectionSelectionState[sec.CRN])
        .map(sec => sec.CRN);
    return crns.length ? { courseName: course.courseName, sections: crns } : null;
  }).filter(Boolean);

  try {
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chosenCourses })
    });
    const data = await res.json();
    
    if ("error" in data) {
        renderError(data);
        currentSchedules = [];
        resultsControls.style.display = "none";
    } else {
        currentSchedules = data.map(schedule => ({
            scheduleData: schedule,
            metrics: calculateScheduleMetrics(schedule)
        }));
        resultsControls.style.display = "block";
        
        const currentSortValue = sortSelect.value;
        const sortedSchedules = sortSchedules(currentSchedules, currentSortValue, isSortAscending);
        renderSchedules(sortedSchedules.map(s => s.scheduleData));
    }
  } catch (err) {
    console.error(err);
    scheduleResultsDiv.innerHTML = "<p>Error generating schedules.</p>";
  }
});

function showCourseSectionsPopup(course) {
  const overlay = Object.assign(document.createElement("div"), { className: "popup-overlay" });
  const popup   = Object.assign(document.createElement("div"), { className: "course-sections-popup" });
  popup.innerHTML = `<h2>${course.courseName}</h2>
    <p><strong>Title:</strong> ${course.Title||""}<br><strong>Units:</strong> ${course.Unit||""}<br>
    <strong>Grade Mode:</strong> ${course.GradeMode||""}<br><strong>Description:</strong> ${course.Description||""}</p><hr>`;

  const controls = document.createElement("div");
  controls.className = "section-filters";
  controls.innerHTML = `
    <input id="sectionSearch" type="text" placeholder="🔍 Search…" />
    <select id="statusFilter"><option value="">All Statuses</option><option value="OPEN">OPEN</option><option value="WAITLISTED">WAITLISTED</option><option value="CLOSED">CLOSED</option><option value="SEE INSTRUCTOR">SEE INSTRUCTOR</option></select>
    <select id="meetFilter"></select>`;
  popup.appendChild(controls);

  const meetFilter = controls.querySelector("#meetFilter");
  meetFilter.innerHTML = `<option value="">All Meeting Types</option>` +
    [...new Set(course.sections.map(s => s.Meet))].sort()
      .map(m => `<option value="${m}">${m}</option>`).join("");

  const table = document.createElement("table");
  table.className = "sections-table";
  table.innerHTML = `<thead><tr><th><input id="masterCheck" type="checkbox" checked /></th><th>CRN</th><th>Status</th><th>Seats</th><th>Instructor</th><th>Meet</th></tr></thead>`;
  const masterCB = table.querySelector("#masterCheck");
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  popup.appendChild(table);

  const render = () => { // Renders the table rows based on filters
    const q  = controls.querySelector("#sectionSearch").value.trim().toLowerCase();
    const st = controls.querySelector("#statusFilter").value;
    const mt = controls.querySelector("#meetFilter").value;
    tbody.textContent = "";
    course.sections.forEach(sec => {
      if (st && sec.Status?.toUpperCase() !== st) return;
      if (mt && sec.Meet !== mt) return;
      if (q && ![sec.CRN, sec.Instructor, sec.Meet, sec.Status].join(" ").toLowerCase().includes(q)) return;
      const tr = document.createElement("tr");
      const tdCheck = document.createElement("td");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox" });
      if (sec.Status?.toUpperCase() === "CLOSED") {
        cb.disabled = true; cb.checked = false; sectionSelectionState[sec.CRN] = false;
      } else {
        cb.checked = !!sectionSelectionState[sec.CRN];
        cb.onchange = () => { sectionSelectionState[sec.CRN] = cb.checked; updateMaster(); };
      }
      tdCheck.appendChild(cb); tr.appendChild(tdCheck);
      tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.CRN }));
      const stTd = document.createElement("td");
      stTd.innerHTML = `<span style="color:${getStatusColor(sec.Status)};font-weight:600;">${sec.Status}</span>`;
      tr.appendChild(stTd);
      const seatTd = document.createElement("td");
      seatTd.innerHTML = `<span style="color:${getRemainingColor(sec.Rem)};">${sec.Act}/${sec.Cap} (Rem: ${sec.Rem})</span>`;
      tr.appendChild(seatTd);
      tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.Instructor }));
      tr.appendChild(Object.assign(document.createElement("td"), { textContent: sec.Meet }));
      tbody.appendChild(tr);
    });
    updateMaster(); // Sync master checkbox after rows are painted
    function updateMaster() {
      const boxes = [...tbody.querySelectorAll('input[type="checkbox"]:not([disabled])')];
      masterCB.indeterminate = boxes.some(b => b.checked) && boxes.some(b => !b.checked);
      masterCB.checked = boxes.length > 0 && boxes.every(b => b.checked);
    }
  };

  masterCB.onchange = () => { // Master checkbox handler
    const boxes = [...tbody.querySelectorAll('input[type="checkbox"]:not([disabled])')];
    boxes.forEach(b => { b.checked = masterCB.checked; const crn = b.closest('tr').children[1].textContent; sectionSelectionState[crn] = masterCB.checked; });
  };
  render();
  controls.addEventListener("input", render);
  controls.addEventListener("change", render);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => { updateCourseCheckboxesFromSections(); updateTotalUnits(); document.body.removeChild(overlay); };
  popup.appendChild(closeBtn);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

// Sync course checkboxes and priority list after section picker closes
function updateCourseCheckboxesFromSections() {
  allCourses.forEach(course => {
    const label = Array.from(document.querySelectorAll("#coursesContainer label")).find(l => l.querySelector("input[type='checkbox']")?.value === course.courseName);
    if (!label) return;
    const box = label.querySelector("input[type='checkbox']");
    const anySelected = course.sections.filter(s => s.Status?.toUpperCase() !== "CLOSED").some(s => sectionSelectionState[s.CRN]);
    box.checked = anySelected;

    // Sync prioritization list
    if (box.checked && !prioritizedCourseNames.includes(course.courseName)) {
        prioritizedCourseNames.push(course.courseName);
    } else if (!box.checked && prioritizedCourseNames.includes(course.courseName)) {
        prioritizedCourseNames = prioritizedCourseNames.filter(name => name !== course.courseName);
    }
  });
}

// Calculate quantitative metrics for a single schedule for sorting
function calculateScheduleMetrics(schedule) {
  const metrics = { totalGaps: 0, earliestStart: 24 * 60, latestEnd: 0, daySpan: 0 };
  const dailyTimes = {}; // e.g., { "M": [[540, 660], [720, 780]] }
  for (const section of schedule) {
    for (const [day, start, end] of section.times) {
      if (!dailyTimes[day]) dailyTimes[day] = [];
      dailyTimes[day].push([start, end]);
      metrics.earliestStart = Math.min(metrics.earliestStart, start);
      metrics.latestEnd = Math.max(metrics.latestEnd, end);
    }
  }
  for (const day in dailyTimes) {
    const times = dailyTimes[day].sort((a, b) => a[0] - b[0]);
    if (times.length > 0) {
        metrics.daySpan += (times[times.length - 1][1] - times[0][0]);
    }
    for (let i = 0; i < times.length - 1; i++) {
      const gap = times[i+1][0] - times[i][1]; // Time between consecutive classes
      if (gap > 0) metrics.totalGaps += gap;
    }
  }
  return metrics;
}

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
    const header = document.createElement("div");
    header.classList.add("schedule-header");
    header.innerHTML = `<h2>Schedule ${i + 1}</h2>`;
    const toggleBtn = document.createElement("button");
    toggleBtn.classList.add("toggle-btn");
    toggleBtn.textContent = "Show Full Schedule";
    header.appendChild(toggleBtn);
    block.appendChild(header);
    const previewWrap = document.createElement("div");
    previewWrap.innerHTML = `<div class='preview-grid-label'>Preview:</div>`;
    const previewTable = buildGenericScheduleTable({
      earliestMin: EARLIEST_MIN, latestMin: LATEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:false, showDetails:false, tableClass:"preview-table"
    });
    fillGenericSchedule(previewTable, sched, { earliestMin: EARLIEST_MIN, intervalMin: INTERVAL_MIN, showTimeCol:false, showDetails:false });
    previewWrap.appendChild(previewTable);
    block.appendChild(previewWrap);
    const fullDiv = document.createElement("div");
    fullDiv.classList.add("detailed-schedule","hidden");
    const fullTable = buildGenericScheduleTable({
      earliestMin: EARLIEST_MIN, latestMin: LATEST_MIN, intervalMin: INTERVAL_MIN,
      showTimeCol:true, showDetails:true, tableClass:"schedule-table"
    });
    fillGenericSchedule(fullTable, sched, { earliestMin: EARLIEST_MIN, intervalMin: INTERVAL_MIN, showTimeCol:true, showDetails:true });
    fullDiv.appendChild(fullTable);
    block.appendChild(fullDiv);

    // NEW CODE BLOCK STARTS HERE
    // This preserves the global full/preview state when re-rendering from a sort
    if (allInFullMode) {
      fullDiv.classList.remove("hidden");
      previewWrap.classList.add("hidden");
      toggleBtn.textContent = "Show Preview";
    }
    // NEW CODE BLOCK ENDS HERE

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

// Build a blank weekly schedule grid
function buildGenericScheduleTable({ earliestMin, latestMin, intervalMin, showTimeCol, showDetails, tableClass }) {
  const table = document.createElement("table");
  if (tableClass) table.classList.add(tableClass);
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
  const tbody = document.createElement("tbody");
  const numRows = (latestMin - earliestMin) / intervalMin; // Assume even division
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

// Paint course blocks onto a schedule grid
function fillGenericSchedule(table, schedule, { earliestMin, intervalMin, showTimeCol, showDetails }) {
  const rows       = Array.from(table.querySelectorAll("tbody tr"));
  const cellMatrix = rows.map(r => Array.from(r.querySelectorAll("td")));
  const dayOffset  = showTimeCol ? 1 : 0; // Column offset if time column is present
  schedule.forEach(section => {
    const { courseName, CRN } = section;
    const foundCourse = allCourses.find(c => c.courseName === courseName);
    const colorClass  = foundCourse ? globalCourseColorMap[foundCourse.courseName] : "course-color-0";
    section.times.forEach(([day, startMin, endMin]) => {
      const dayIndex = DAYS.indexOf(day);
      if (dayIndex < 0) return;
      let startIndex = Math.floor((startMin - earliestMin) / intervalMin);
      let endIndex   = Math.ceil((endMin   - earliestMin) / intervalMin);
      startIndex = Math.max(startIndex, 0); // Clamp indices into table bounds
      endIndex   = Math.min(endIndex, rows.length);
      if (endIndex <= startIndex) return;
      const rowSpan = endIndex - startIndex;
      const topCell = cellMatrix[startIndex][dayIndex + dayOffset];
      if (!topCell) return;
      const blockDiv = document.createElement("div");
      blockDiv.classList.add("course-block", colorClass);
      if (showDetails) {
        blockDiv.textContent = `${courseName}\n(${CRN})`;
        blockDiv.addEventListener("click", () => showCourseInfoPopup(foundCourse, section));
      }
      // Fine-grained vertical placement within the merged cell
      const spanMinutes   = rowSpan * intervalMin;
      const cellStartMin  = earliestMin + startIndex * intervalMin;
      const offsetMinutes = startMin - cellStartMin;
      blockDiv.style.top    = (offsetMinutes / spanMinutes) * 100 + "%";
      blockDiv.style.height = ((endMin - startMin) / spanMinutes) * 100 + "%";
      topCell.appendChild(blockDiv);
      topCell.rowSpan = rowSpan;
      for (let r = startIndex + 1; r < startIndex + rowSpan; r++) { // Remove cells hidden by rowspan
        const spanned = cellMatrix[r][dayIndex + dayOffset];
        if (spanned) {
          spanned.remove();
          cellMatrix[r][dayIndex + dayOffset] = null;
        }
      }
    });
  });
}

// Show a popup with detailed section info
function showCourseInfoPopup(course, section) {
  if (!course) { console.warn("No matching course object", section); return; }
  const { courseName, Unit, Title, GradeMode, Description } = course;
  const { Status, Type, CRN, Meet, Cap, Act, Rem, Instructor, StartDate, EndDate, Weeks } = section;
  const overlay = document.createElement("div");
  overlay.classList.add("popup-overlay");
  const popup = document.createElement("div");
  popup.classList.add("course-popup");
  popup.innerHTML = `<h2>${courseName}</h2><h3>${Title}</h3><p><strong>Instructor:</strong> ${Instructor}</p><hr><p><strong>Status:</strong> <strong style="color:${getStatusColor(Status)};">${Status}</strong></p><p><strong>Seats:</strong> <strong style="color:${getRemainingColor(Rem)};">${Act} / ${Cap} (Remain: ${Rem})</strong></p><hr><p><strong>CRN:</strong> ${CRN}</p><p><strong>Unit:</strong> ${Unit}</p><p><strong>Type:</strong> ${Type}</p><p><strong>Grade Mode:</strong> ${GradeMode}</p><p><strong>Meeting:</strong> ${Meet}</p><p><strong>Start:</strong> ${StartDate}</p><p><strong>End:</strong> ${EndDate}</p><p><strong>Weeks:</strong> ${Weeks}</p><hr><p><strong>Description:</strong> ${Description || "No description available."}</p>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => document.body.removeChild(overlay));
  popup.appendChild(closeBtn);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

function getStatusColor(status) { // Get a color based on the course section's status
  switch (status?.toUpperCase()) {
    case "OPEN":          return "rgb(0,200,0)";
    case "CLOSED":        return "rgb(200,0,0)";
    case "WAITLISTED":    return "rgb(255,204,0)";
    case "SEE INSTRUCTOR":return "purple";
    default:              return "#000";
  }
}

function getRemainingColor(rem) { // Green if seats remain, else red
  return Number(rem) === 0 ? "rgb(200,0,0)" : "rgb(0,200,0)";
}

// Handle the "Show All/Hide All" master toggle button
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

// Recalculate and display the total selected units
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

sortSelect.addEventListener("change", (e) => {
  const sortValue = e.target.value;
  const sorted = sortSchedules(currentSchedules, sortValue, isSortAscending);
  renderSchedules(sorted.map(s => s.scheduleData));
});

function sortSchedules(schedules, sortValue, isAscending) {
  if (sortValue === "default") {
    return schedules;
  }
  return [...schedules].sort((a, b) => {
    let diff = 0;
    switch(sortValue) {
      case "gaps-asc":    diff = a.metrics.totalGaps - b.metrics.totalGaps; break;
      case "compact-asc": diff = a.metrics.daySpan - b.metrics.daySpan; break;
      case "start-desc":  diff = b.metrics.earliestStart - a.metrics.earliestStart; break;
      case "end-asc":     diff = a.metrics.latestEnd - b.metrics.latestEnd; break;
      default:            diff = 0;
    }
    return isAscending ? diff : -diff;
  });
}

sortDirBtn.addEventListener("click", () => {
  isSortAscending = !isSortAscending;
  sortDirBtn.textContent = isSortAscending ? "↑" : "↓";
  
  const currentSortValue = sortSelect.value;
  const sorted = sortSchedules(currentSchedules, currentSortValue, isSortAscending);
  renderSchedules(sorted.map(s => s.scheduleData));
});