/**
 * ===================================
 * 자습 출석 시스템 - 관리자 페이지 로직
 * (부별 즉시출석 시스템 + 기기 초기화 기능 반영)
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

    <div class="filter-bar" style="margin-top:-4px;">
      <input id="resetStudentIdInput" type="text" placeholder="초기화할 학번 입력" style="flex:1;" />
      <button id="resetDeviceBtn" class="btn-small">기기 초기화</button>
      <span id="resetResultMsg" style="font-size:13px;"></span>
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

    <div class="table-wrap" style="margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line);">
        <strong style="font-size:14px;">문의함</strong>
        <button id="refreshInquiriesBtn" class="btn-small">새로고침</button>
      </div>
      <table class="log-table">
        <thead>
          <tr>
            <th>시각</th><th>학번</th><th>내용</th><th>상태</th><th></th>
          </tr>
        </thead>
        <tbody id="inquiryBody"></tbody>
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
  document.getElementById("resetDeviceBtn").addEventListener("click", onResetDeviceClick);
  document.getElementById("refreshInquiriesBtn").addEventListener("click", loadInquiries);

  renderSummary();
  renderTable();
  loadInquiries();
}

/**
 * 문의함 목록을 서버에서 가져와서 그린다.
 */
async function loadInquiries() {
  const body = document.getElementById("inquiryBody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" class="empty-row">불러오는 중…</td></tr>`;

  try {
    const password = getSavedPassword();
    const result = await callServer("adminGetInquiries", { password });

    if (!result.success) {
      body.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(result.error)}</td></tr>`;
      return;
    }

    if (result.rows.length === 0) {
      body.innerHTML = `<tr><td colspan="5" class="empty-row">접수된 문의가 없습니다.</td></tr>`;
      return;
    }

    body.innerHTML = result.rows
      .map((r) => {
        const isResolved = r.status === "완료";
        const badgeClass = isResolved ? "present" : "pending";

        const answerArea = r.answer
          ? `<div style="margin-top:6px; font-size:12px; color:var(--accent);">↳ 답변: ${escapeHtml(r.answer)}</div>`
          : `
            <div style="display:flex; gap:6px; margin-top:6px;">
              <input type="text" class="reply-input" data-row="${r.rowIndex}" placeholder="답변 입력…" style="flex:1; border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:12px;" />
              <button class="btn-small reply-btn" data-row="${r.rowIndex}">답변 보내기</button>
            </div>
          `;

        return `
          <tr>
            <td>${escapeHtml(r.time)}</td>
            <td>${escapeHtml(r.studentId)}</td>
            <td style="white-space:normal; max-width:320px;">
              ${escapeHtml(r.content)}
              ${answerArea}
            </td>
            <td><span class="badge ${badgeClass}">${escapeHtml(r.status)}</span></td>
            <td>
              ${isResolved ? "" : `<button class="btn-small resolve-btn" data-row="${r.rowIndex}">완료로만 표시</button>`}
            </td>
          </tr>
        `;
      })
      .join("");

    document.querySelectorAll(".resolve-btn").forEach((btn) => {
      btn.addEventListener("click", () => resolveInquiry(Number(btn.dataset.row)));
    });

    document.querySelectorAll(".reply-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rowIndex = Number(btn.dataset.row);
        const input = document.querySelector(`.reply-input[data-row="${rowIndex}"]`);
        replyToInquiry(rowIndex, input.value.trim());
      });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty-row">네트워크 오류가 발생했습니다.</td></tr>`;
  }
}

async function replyToInquiry(rowIndex, answer) {
  if (!answer) {
    alert("답변 내용을 입력해주세요.");
    return;
  }
  try {
    const password = getSavedPassword();
    const result = await callServer("adminReplyInquiry", { password, rowIndex, answer });
    if (result.success) {
      loadInquiries();
    } else {
      alert(result.error);
    }
  } catch (err) {
    alert("네트워크 오류가 발생했습니다.");
  }
}

async function resolveInquiry(rowIndex) {
  try {
    const password = getSavedPassword();
    const result = await callServer("adminResolveInquiry", { password, rowIndex });
    if (result.success) {
      loadInquiries();
    } else {
      alert(result.error);
    }
  } catch (err) {
    alert("네트워크 오류가 발생했습니다.");
  }
}

/**
 * 관리자가 학번을 입력하고 "기기 초기화"를 누르면,
 * 그 학번의 등록된 기기를 비활성화해서 재등록이 가능하게 만든다.
 * (학생이 브라우저 데이터가 지워져서 못 들어올 때 선생님이 빠르게 풀어주는 용도)
 */
async function onResetDeviceClick() {
  const input = document.getElementById("resetStudentIdInput");
  const msg = document.getElementById("resetResultMsg");
  const studentId = input.value.trim();

  if (!studentId) {
    msg.textContent = "학번을 입력해주세요.";
    msg.style.color = "var(--alert)";
    return;
  }

  msg.textContent = "처리 중…";
  msg.style.color = "var(--muted)";

  try {
    const password = getSavedPassword();
    const result = await callServer("adminResetDevice", { password, studentId });
    if (!result.success) {
      msg.textContent = result.error;
      msg.style.color = "var(--alert)";
      return;
    }
    msg.textContent = studentId + "번 기기 초기화 완료. 학생이 다시 등록할 수 있습니다.";
    msg.style.color = "var(--accent)";
    input.value = "";
  } catch (err) {
    msg.textContent = "네트워크 오류가 발생했습니다.";
    msg.style.color = "var(--alert)";
  }
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
