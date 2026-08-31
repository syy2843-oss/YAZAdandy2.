/**
 * ===================================
 * 자습 출석 시스템 - 관리자 페이지 로직
 * (부별 독립 입실/퇴실 시스템 반영)
 * ===================================
 *
 * ⚠️ 아래 두 값을 반드시 채워주세요.
 */
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyYJbzpYtLVrcAp0pMT4FqIGzQ1nMOHEnh5LAWH8ok-3VsBydNXZHp8eKRp2m2AbCvPLQ/exec";
const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1fXoog_GpaoHmZp-ImCtoRTy56vaTX2_LEj7Uf5v5LG0/edit?gid=347494037#gid=347494037";

const SESSION_KEY = "attendance_admin_password";

const app = document.getElementById("admin-app");

let allRows = []; // 서버에서 받아온 현재 날짜의 전체 로그 (부별로 여러 행)
let currentDate = todayDateString();

// -------------------------------------------------
// 서버 호출
// -------------------------------------------------
async function callServer(action, payload) {
  const body = Object.assign({ action: action }, payload || {});
  const response = await fetch(WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("서버 응답 오류");
  return response.json();
}

function todayDateString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getSavedPassword() {
  return sessionStorage.getItem(SESSION_KEY);
}

function savePassword(password) {
  sessionStorage.setItem(SESSION_KEY, password);
}

function clearPassword() {
  sessionStorage.removeItem(SESSION_KEY);
}

// -------------------------------------------------
// 로그인 화면
// -------------------------------------------------
function renderLogin(errorMessage) {
  app.innerHTML = `
    <div class="login-card">
      <p class="eyebrow">관리자 로그인</p>
      <p class="title">비밀번호를 입력해주세요</p>
      <input id="pwInput" class="text-input" type="password" placeholder="••••••" autocomplete="off" />
      <button id="loginBtn" class="btn btn-primary">로그인</button>
      ${errorMessage ? `<p class="error-text">${escapeHtml(errorMessage)}</p>` : ""}
    </div>
  `;

  const input = document.getElementById("pwInput");
  const button = document.getElementById("loginBtn");
  input.focus();

  const submit = () => {
    const pw = input.value;
    if (!pw) return;
    tryLogin(pw);
  };

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

async function tryLogin(password) {
  app.innerHTML = `<p class="loading-text">확인 중…</p>`;
  try {
    const result = await callServer("adminGetLogs", { password, date: currentDate });
    if (!result.success) {
      renderLogin(result.error);
      return;
    }
    savePassword(password);
    allRows = result.rows;
    renderDashboard();
  } catch (err) {
    renderLogin("네트워크 오류가 발생했습니다.");
  }
}

// -------------------------------------------------
// 대시보드
// -------------------------------------------------
function renderDashboard() {
  app.innerHTML = `
    <div class="admin-header">
      <h1 class="admin-title">자습 출석 현황</h1>
      <div class="admin-header-actions">
        <a class="btn-small" href="${escapeAttr(GOOGLE_SHEET_URL)}" target="_blank" rel="noopener">Sheets 바로가기</a>
        <button id="csvBtn" class="btn-small">CSV 다운로드</button>
        <button id="logoutBtn" class="btn-small">로그아웃</button>
      </div>
    </div>

    <div id="summaryArea" class="summary-row"></div>

    <div class="filter-bar">
      <input id="dateInput" type="date" value="${currentDate}" />
      <input id="searchInput" type="text" placeholder="학번 검색" />
      <select id="partFilter">
        <option value="all">전체 부</option>
        <option value="1부">1부</option>
        <option value="2부">2부</option>
        <option value="3부">3부</option>
      </select>
    </div>

    <div class="table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>학번</th><th>이름</th><th>부</th><th>입실</th><th>상태</th><th>비고</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>
  `;

  document.getElementById("dateInput").addEventListener("change", onDateChange);
  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("partFilter").addEventListener("change", renderTable);
  document.getElementById("csvBtn").addEventListener("click", downloadCsv);
  document.getElementById("logoutBtn").addEventListener("click", () => {
    clearPassword();
    renderLogin();
  });

  renderSummary();
  renderTable();
}

async function onDateChange(e) {
  currentDate = e.target.value;
  const password = getSavedPassword();
  try {
    const result = await callServer("adminGetLogs", { password, date: currentDate });
    if (!result.success) {
      clearPassword();
      renderLogin(result.error);
      return;
    }
    allRows = result.rows;
    renderSummary();
    renderTable();
  } catch (err) {
    alert("조회 중 오류가 발생했습니다.");
  }
}

function renderSummary() {
  const totalRecords = allRows.length;
  const present = allRows.filter((r) => r.status === "출석").length;
  const notRecognized = allRows.filter((r) => r.status === "미인정").length;
  const uniqueStudents = new Set(allRows.map((r) => r.studentId)).size;

  document.getElementById("summaryArea").innerHTML = `
    <div class="summary-card">
      <div class="summary-num">${totalRecords}</div>
      <div class="summary-label">전체 출석 기록</div>
    </div>
    <div class="summary-card">
      <div class="summary-num accent">${present}</div>
      <div class="summary-label">출석</div>
    </div>
    <div class="summary-card">
      <div class="summary-num alert">${notRecognized}</div>
      <div class="summary-label">미인정(과거기록)</div>
    </div>
    <div class="summary-card">
      <div class="summary-num">${uniqueStudents}</div>
      <div class="summary-label">참여 학생 수</div>
    </div>
  `;
}

function renderTable() {
  const searchValue = (document.getElementById("searchInput")?.value || "").trim();
  const partValue = document.getElementById("partFilter")?.value || "all";

  const filtered = allRows.filter((r) => {
    if (searchValue && !r.studentId.includes(searchValue)) return false;
    if (partValue !== "all" && r.part !== partValue) return false;
    return true;
  });

  // 학번 → 부 순서로 정렬해서 같은 학생 기록이 모여 보이게
  filtered.sort((a, b) => {
    if (a.studentId !== b.studentId) return a.studentId.localeCompare(b.studentId);
    return (a.part || "").localeCompare(b.part || "");
  });

  const body = document.getElementById("tableBody");

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="empty-row">표시할 기록이 없습니다.</td></tr>`;
    return;
  }

  body.innerHTML = filtered
    .map((r) => {
      const badgeClass = r.status === "출석" ? "present" : "not-recognized";
      const badgeText = r.status || "-";
      return `
        <tr>
          <td>${escapeHtml(r.studentId)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.part)}</td>
          <td>${escapeHtml(r.checkinTime)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></td>
          <td>${escapeHtml(r.note)}</td>
        </tr>
      `;
    })
    .join("");
}

function downloadCsv() {
  const header = ["날짜", "학번", "이름", "부", "입실시간", "출석상태", "비고"];
  const lines = [header.join(",")];

  allRows.forEach((r) => {
    const line = [currentDate, r.studentId, r.name, r.part, r.checkinTime, r.status, r.note]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",");
    lines.push(line);
  });

  const csvContent = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `출석기록_${currentDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------------------------
// 유틸
// -------------------------------------------------
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text === undefined || text === null ? "" : String(text);
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text || "").replace(/"/g, "&quot;");
}

// -------------------------------------------------
// 시작점
// -------------------------------------------------
function init() {
  if (WEB_APP_URL.indexOf("PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE") !== -1) {
    app.innerHTML = `<p class="error-text">admin.js 상단의 WEB_APP_URL을 실제 Apps Script 웹 앱 URL로 바꿔주세요.</p>`;
    return;
  }

  const savedPassword = getSavedPassword();
  if (savedPassword) {
    tryLogin(savedPassword);
  } else {
    renderLogin();
  }
}

init();
