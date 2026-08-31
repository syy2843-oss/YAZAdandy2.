/**
 * ===================================
 * 자습 출석 시스템 - 학생 페이지 로직
 * (부별 독립 입실/퇴실 + 기기 등록/인증으로 대리출석 방지)
 * ===================================
 *
 * ⚠️ 아래 WEB_APP_URL을 본인의 Apps Script 웹 앱 URL로 바꿔주세요.
 */
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyYJbzpYtLVrcAp0pMT4FqIGzQ1nMOHEnh5LAWH8ok-3VsBydNXZHp8eKRp2m2AbCvPLQ/exec";

const STORAGE_KEY = "attendance_student_id";
const DEVICE_TOKEN_STORAGE_KEY = "attendance_device_token";
const PART_ORDER = ["1부", "2부", "3부"];

const app = document.getElementById("app");

// -------------------------------------------------
// 서버 호출 공통 함수
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

function getSavedStudentId() {
  return localStorage.getItem(STORAGE_KEY);
}

function saveStudentId(studentId) {
  localStorage.setItem(STORAGE_KEY, studentId);
}

function getSavedDeviceToken() {
  return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
}

function saveDeviceToken(token) {
  localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
}

function clearSavedIdentity() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
}

// -------------------------------------------------
// 화면: 학번 등록
// -------------------------------------------------
function renderLoading(message) {
  app.innerHTML = `
    <p class="eyebrow">자습 출석</p>
    <p class="loading-text">${escapeHtml(message || "처리 중…")}</p>
  `;
}

function renderRegisterForm(errorMessage) {
  app.innerHTML = `
    <p class="eyebrow">최초 등록</p>
    <p class="title">학번을 입력해주세요</p>
    <label class="field-label" for="studentIdInput">학번</label>
    <input
      id="studentIdInput"
      class="text-input"
      type="text"
      inputmode="numeric"
      placeholder="20311"
      autocomplete="off"
    />
    <button id="submitIdBtn" class="btn btn-primary">확인</button>
    ${errorMessage ? `<p class="error-text">${escapeHtml(errorMessage)}</p>` : ""}
  `;

  const input = document.getElementById("studentIdInput");
  const button = document.getElementById("submitIdBtn");
  input.focus();

  const submit = () => {
    const studentId = input.value.trim();
    if (!studentId) return;
    handleStudentIdSubmit(studentId);
  };

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

function renderConfirm(student) {
  app.innerHTML = `
    <p class="eyebrow">본인이 맞나요?</p>
    <div class="confirm-block">
      <div class="confirm-id">${escapeHtml(student.studentId)}</div>
      <div class="confirm-name">${escapeHtml(student.name)}</div>
    </div>
    <button id="confirmYesBtn" class="btn btn-primary">맞아요, 계속할게요</button>
    <button id="confirmNoBtn" class="btn btn-ghost">아니에요, 다시 입력할게요</button>
  `;

  document.getElementById("confirmYesBtn").addEventListener("click", () => {
    saveStudentId(student.studentId);
    renderDeviceRegisterConfirm(student);
  });

  document.getElementById("confirmNoBtn").addEventListener("click", () => {
    renderRegisterForm();
  });
}

/**
 * 새로 만든 화면: "이 휴대폰을 출석 기기로 등록하시겠습니까?"
 * 학번 확인이 끝난 뒤, 실제 입실/퇴실에 쓸 기기 토큰을 발급받는 단계.
 */
function renderDeviceRegisterConfirm(student, errorMessage) {
  app.innerHTML = `
    <p class="eyebrow">기기 등록</p>
    <p class="title">이 휴대폰을 ${escapeHtml(student.name)}님의<br/>출석 기기로 등록할까요?</p>
    <p class="idle-sub" style="margin-bottom:18px;">
      등록 후에는 이 휴대폰으로만 ${escapeHtml(student.studentId)}번 출석 처리가 가능합니다.
    </p>
    <button id="registerDeviceBtn" class="btn btn-primary">이 휴대폰으로 등록하기</button>
    <button id="switchStudentBtn" class="btn btn-ghost">다른 학번으로 계속하기</button>
    ${errorMessage ? `<p class="error-text">${escapeHtml(errorMessage)}</p>` : ""}
  `;

  document.getElementById("registerDeviceBtn").addEventListener("click", async () => {
    renderLoading("기기 등록 중…");
    try {
      const result = await callServer("registerDevice", { studentId: student.studentId });
      if (!result.success) {
        renderDeviceRegisterConfirm(student, result.error);
        return;
      }
      saveDeviceToken(result.deviceToken);
      loadStatus(student.studentId);
    } catch (err) {
      renderDeviceRegisterConfirm(student, "네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
  });

  document.getElementById("switchStudentBtn").addEventListener("click", () => {
    clearSavedIdentity();
    renderRegisterForm();
  });
}

async function handleStudentIdSubmit(studentId) {
  renderLoading("학번 확인 중…");
  try {
    const result = await callServer("checkStudent", { studentId });
    if (!result.success) {
      renderRegisterForm(result.error);
      return;
    }
    renderConfirm(result);
  } catch (err) {
    renderRegisterForm("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
  }
}

// -------------------------------------------------
// 부별 상태 판단 유틸
// -------------------------------------------------
function describePart(partKey, partData, currentPart) {
  if (partData.state === "DONE") {
    return { label: "출석 완료", dotClass: "done" };
  }
  if (partKey === currentPart) {
    return { label: "참여 가능", dotClass: "available" };
  }
  return { label: "미참여", dotClass: "none" };
}

/**
 * 지금 눌러야 할 버튼(있다면)을 결정한다.
 * 퇴실 개념이 없어져서, 이제 "현재 부에 아직 출석 안 했으면 입실 버튼" 하나뿐이다.
 */
function decideAction(parts, currentPart) {
  if (currentPart && parts[currentPart].state === "NOT_STARTED") {
    return { type: "checkin", part: currentPart, data: parts[currentPart] };
  }
  return null;
}

function formatScheduleLabel(schedule) {
  return `${schedule.start} ~ ${schedule.end}`;
}

// -------------------------------------------------
// 화면: 부별 출석 현황
// -------------------------------------------------
function renderStatus(data) {
  const { studentId, name, currentPart, parts } = data;

  const listHtml = PART_ORDER.map((key) => {
    const desc = describePart(key, parts[key], currentPart);
    return `
      <div class="part-row">
        <span class="part-dot ${desc.dotClass}"></span>
        <span class="part-name">${escapeHtml(key)}</span>
        <span class="part-status-label ${desc.dotClass}">${escapeHtml(desc.label)}</span>
        <span class="part-schedule">${escapeHtml(formatScheduleLabel(parts[key].schedule))}</span>
      </div>
    `;
  }).join("");

  const action = decideAction(parts, currentPart);

  let actionHtml = "";
  if (action && action.type === "checkin") {
    actionHtml = `
      <div class="action-block">
        <p class="action-current-label">현재 진행 중</p>
        <p class="action-current-part">${escapeHtml(action.part)} · ${escapeHtml(formatScheduleLabel(action.data.schedule))}</p>
        <button id="actionBtn" class="btn-action checkin">${escapeHtml(action.part)} 입실하기</button>
      </div>
    `;
  } else {
    actionHtml = `
      <div class="action-block">
        <p class="idle-sub" style="margin-top:4px;">지금은 참여 가능한 자습 시간이 아니에요.</p>
      </div>
    `;
  }

  app.innerHTML = `
    <div class="status-header">
      <p class="eyebrow">자습 출석</p>
      <div class="status-id">${escapeHtml(studentId)}</div>
      <div class="status-name">${escapeHtml(name)}</div>
    </div>
    <p class="status-current-label" style="margin-bottom:8px;">오늘 출석 현황</p>
    <div class="part-list">${listHtml}</div>
    ${actionHtml}
    <p id="actionError" class="error-text" style="display:none;"></p>
    <button id="resetBtn" class="btn btn-ghost">다른 학번으로 다시 등록</button>
  `;

  if (action) {
    document.getElementById("actionBtn").addEventListener("click", () => {
      doCheckin(studentId, action.part);
    });
  }

  document.getElementById("resetBtn").addEventListener("click", resetRegistration);
}

// -------------------------------------------------
// 흐름 제어
// -------------------------------------------------
async function loadStatus(studentId) {
  renderLoading("현재 상태 확인 중…");
  try {
    const result = await callServer("getAttendanceStatus", { studentId });

    if (!result.success) {
      clearSavedIdentity();
      renderRegisterForm(result.error);
      return;
    }

    renderStatus(result);
  } catch (err) {
    app.innerHTML = `
      <p class="eyebrow">자습 출석</p>
      <p class="error-text">네트워크 오류가 발생했습니다.</p>
      <button id="retryBtn" class="btn btn-primary">다시 시도</button>
    `;
    document.getElementById("retryBtn").addEventListener("click", () => loadStatus(studentId));
  }
}

async function doCheckin(studentId, part) {
  setActionButtonDisabled(true);
  try {
    const deviceToken = getSavedDeviceToken();
    const result = await callServer("checkin", { studentId, part, deviceToken });
    if (!result.success) {
      showActionError(result.error);
    }
    await loadStatus(studentId);
  } catch (err) {
    showActionError("네트워크 오류가 발생했습니다.");
    setActionButtonDisabled(false);
  }
}

function resetRegistration() {
  clearSavedIdentity();
  renderRegisterForm();
}

function setActionButtonDisabled(disabled) {
  const btn = document.getElementById("actionBtn");
  if (btn) btn.disabled = disabled;
}

function showActionError(message) {
  const el = document.getElementById("actionError");
  if (el) {
    el.textContent = message;
    el.style.display = "block";
  }
}

// -------------------------------------------------
// 유틸
// -------------------------------------------------
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text === undefined || text === null ? "" : String(text);
  return div.innerHTML;
}

// -------------------------------------------------
// 시작점
// -------------------------------------------------
function init() {
  if (WEB_APP_URL.indexOf("PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE") !== -1) {
    app.innerHTML = `
      <p class="eyebrow">설정 필요</p>
      <p class="error-text">student.js 상단의 WEB_APP_URL을 실제 Apps Script 웹 앱 URL로 바꿔주세요.</p>
    `;
    return;
  }

  const savedStudentId = getSavedStudentId();
  const savedDeviceToken = getSavedDeviceToken();

  if (savedStudentId && savedDeviceToken) {
    // 학번+기기 등록 모두 완료된 경우 → 바로 상태 조회
    loadStatus(savedStudentId);
  } else if (savedStudentId && !savedDeviceToken) {
    // 예전 버전(기기 등록 기능 추가 전)부터 학번만 저장돼 있던 경우 →
    // 학번 재입력 없이 바로 기기 등록 단계로 안내
    callServer("checkStudent", { studentId: savedStudentId })
      .then((result) => {
        if (result.success) {
          renderDeviceRegisterConfirm(result);
        } else {
          clearSavedIdentity();
          renderRegisterForm();
        }
      })
      .catch(() => {
        renderRegisterForm("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      });
  } else {
    renderRegisterForm();
  }
}

init();
