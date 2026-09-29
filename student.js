/**
 * ===================================
 * 자습 출석 시스템 - 학생 페이지 로직
 * (부별 즉시출석 + 기기 등록/인증으로 대리출석 방지)
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

/**
 * 기기 토큰을 저장하고, 실제로 잘 저장됐는지 즉시 재확인한다.
 * (시크릿 모드, 저장공간 부족 등으로 저장이 조용히 실패하는 경우를 대비)
 * 성공하면 true, 실패하면 false를 반환한다.
 */
function saveDeviceToken(token) {
  try {
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    const readBack = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    return readBack === token;
  } catch (err) {
    return false;
  }
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
 * "이 휴대폰을 출석 기기로 등록하시겠습니까?"
 * 학번 확인이 끝난 뒤, 실제 입실에 쓸 기기 토큰을 발급받는 단계.
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

      // 서버 등록은 성공했지만, 이 휴대폰에 토큰 저장이 실패하면
      // 다음에 "이미 등록된 기기가 있습니다"로 막히게 되므로 여기서 바로 확인한다.
      const saved = saveDeviceToken(result.deviceToken);
      if (!saved) {
        renderDeviceRegisterConfirm(
          student,
          "휴대폰에 등록 정보를 저장하지 못했습니다. 시크릿(비공개) 모드가 아닌 " +
          "일반 브라우저 창으로 다시 열어서 시도해주세요. 이미 서버에는 등록이 완료되어, " +
          "재시도해도 오류가 나면 선생님께 문의해주세요."
        );
        return;
      }

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
      if (isDeviceAuthError(result.error)) {
        renderDeviceAuthFailure(result.error);
        return;
      }
      showActionError(result.error);
    }
    await loadStatus(studentId);
  } catch (err) {
    showActionError("네트워크 오류가 발생했습니다.");
    setActionButtonDisabled(false);
  }
}

/**
 * 서버가 "기기 인증에 실패했습니다: ..." 형태로 돌려주는 오류인지 확인.
 * (부 시간대 오류, 중복 출석 오류 등 다른 오류와 구분하기 위함)
 */
function isDeviceAuthError(message) {
  return typeof message === "string" && message.indexOf("기기 인증에 실패") !== -1;
}

/**
 * 등록된 기기가 없어서(또는 토큰이 사라져서) 입실이 거부된 경우,
 * 학생이 뭘 해야 하는지 놓치지 않도록 화면 전체를 바꿔서 크게 안내한다.
 * 작은 빨간 글씨 오류만 띄우고 학생이 계속 같은 버튼만 누르는 상황을 막기 위함.
 */
function renderDeviceAuthFailure(message) {
  app.innerHTML = `
    <p class="eyebrow" style="color:var(--alert);">기기 등록이 필요해요</p>
    <p class="title" style="font-size:22px; line-height:1.4;">
      이 휴대폰에 등록된<br/>출석 정보가 없어요.
    </p>
    <p class="idle-sub" style="margin-bottom:20px; font-size:14px;">
      아래 버튼을 눌러 <strong>학번을 다시 입력</strong>하고<br/>이 휴대폰을 새로 등록해주세요.
    </p>
    <button id="goRegisterBtn" class="btn-action checkin" style="font-size:18px;">
      학번 입력하고 다시 등록하기
    </button>
    <p class="footer-note">${escapeHtml(message)}</p>
  `;

  document.getElementById("goRegisterBtn").addEventListener("click", () => {
    clearSavedIdentity();
    renderRegisterForm();
  });
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
// 문의하기
// -------------------------------------------------
function initInquiryForm() {
  const btn = document.getElementById("inquirySubmitBtn");
  if (!btn) return;

  const textarea = document.getElementById("inquiryContent");
  const msg = document.getElementById("inquiryMsg");

  btn.addEventListener("click", async () => {
    const content = textarea.value.trim();
    if (!content) {
      msg.textContent = "내용을 입력해주세요.";
      msg.style.color = "var(--alert)";
      return;
    }

    btn.disabled = true;
    msg.textContent = "보내는 중…";
    msg.style.color = "var(--muted)";

    try {
      const studentId = getSavedStudentId() || "";
      const result = await callServer("submitInquiry", { studentId, content });
      if (result.success) {
        msg.textContent = "문의가 접수되었습니다. 확인 후 도움드릴게요.";
        msg.style.color = "var(--accent)";
        textarea.value = "";
      } else {
        msg.textContent = result.error || "오류가 발생했습니다.";
        msg.style.color = "var(--alert)";
      }
    } catch (err) {
      msg.textContent = "네트워크 오류가 발생했습니다.";
      msg.style.color = "var(--alert)";
    } finally {
      btn.disabled = false;
    }
  });
}

// -------------------------------------------------
// 내 문의 확인하기 (+ 새 답변 도착 알림 배너)
// -------------------------------------------------
const SEEN_ANSWER_COUNT_KEY = "attendance_seen_answer_count";

function getSeenAnswerCount() {
  return Number(localStorage.getItem(SEEN_ANSWER_COUNT_KEY) || 0);
}

function setSeenAnswerCount(n) {
  try {
    localStorage.setItem(SEEN_ANSWER_COUNT_KEY, String(n));
  } catch (err) {
    // 저장 실패해도 기능에는 영향 없음 (다음에 배너가 다시 뜰 뿐)
  }
}

function countAnswered(rows) {
  return rows.filter((r) => r.answer).length;
}

function renderMyInquiries(rows) {
  const listEl = document.getElementById("myInquiriesList");

  if (rows.length === 0) {
    listEl.innerHTML = `<p class="idle-sub">아직 보낸 문의가 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = rows
    .map((r) => {
      const answerHtml = r.answer
        ? `<div style="margin-top:4px; color:var(--accent);">↳ 답변: ${escapeHtml(r.answer)}</div>`
        : `<div style="margin-top:4px; color:var(--muted);">아직 답변 대기 중이에요.</div>`;
      return `
        <div style="padding:8px 0; border-bottom:1px solid var(--line);">
          <div style="color:var(--muted);">${escapeHtml(r.time)}</div>
          <div style="margin-top:2px;">${escapeHtml(r.content)}</div>
          ${answerHtml}
        </div>
      `;
    })
    .join("");
}

function initMyInquiries() {
  const box = document.getElementById("myInquiriesBox");
  const banner = document.getElementById("newAnswerBanner");
  if (!box) return;

  let cachedRows = null;

  async function fetchRows() {
    const studentId = getSavedStudentId();
    if (!studentId) return null;
    const result = await callServer("getMyInquiries", { studentId });
    return result.success ? result.rows : null;
  }

  // 1) 페이지가 열리자마자 조용히 확인해서, 아직 안 본 새 답변이 있으면 배너를 띄운다.
  (async () => {
    try {
      const rows = await fetchRows();
      if (!rows) return;
      cachedRows = rows;
      if (banner && countAnswered(rows) > getSeenAnswerCount()) {
        banner.style.display = "block";
      }
    } catch (err) {
      // 배너 확인 실패는 조용히 무시 (출석 기능과 무관)
    }
  })();

  // 2) 배너를 누르면 "내 문의 확인하기" 박스를 열어서 보여준다.
  if (banner) {
    banner.addEventListener("click", () => {
      box.open = true;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // 3) 박스를 펼치면 목록을 그리고, 그 시점의 답변 개수를 "확인함"으로 저장한다.
  box.addEventListener("toggle", async () => {
    if (!box.open) return;

    const listEl = document.getElementById("myInquiriesList");
    if (!getSavedStudentId()) {
      listEl.innerHTML = `<p class="idle-sub">학번 등록 후 이용 가능합니다.</p>`;
      return;
    }

    try {
      const rows = (await fetchRows()) || cachedRows;
      if (!rows) {
        listEl.innerHTML = `<p class="error-text">문의 내역을 불러오지 못했습니다.</p>`;
        return;
      }
      cachedRows = rows;
      renderMyInquiries(rows);
      setSeenAnswerCount(countAnswered(rows));
      if (banner) banner.style.display = "none";
    } catch (err) {
      listEl.innerHTML = `<p class="error-text">네트워크 오류가 발생했습니다.</p>`;
    }
  });
}

// -------------------------------------------------
// 시작점
// -------------------------------------------------
function init() {
  initInquiryForm();
  initMyInquiries();

  // 저장공간이 부족해질 때 이 사이트의 데이터가 먼저 지워지지 않도록 요청.
  // (완전한 보장은 아니지만, 부작용 없이 도움이 될 수 있어 추가)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

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
    loadStatus(savedStudentId);
  } else if (savedStudentId && !savedDeviceToken) {
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
