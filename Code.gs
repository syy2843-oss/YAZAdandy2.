/**
 * ===================================
 * 자습 출석 시스템 - Apps Script 백엔드
 * 부(部)별 독립 입실 = 즉시 출석 시스템
 * ===================================
 */

// ---- 설정값 ----
const STUDENTS_SHEET_NAME = "Students";
const LOGS_SHEET_NAME = "Logs";
const DEVICES_SHEET_NAME = "Devices";
const SECURITY_LOGS_SHEET_NAME = "SecurityLogs";
const INQUIRIES_SHEET_NAME = "Inquiries";
const TIME_ZONE = "Asia/Seoul";

// ⚠️ 반드시 본인만 아는 값으로 바꿔주세요.
const ADMIN_PASSWORD = "changeme1234";

// 부별 시간표. 나중에 시간을 바꾸고 싶으면 이 값만 수정하면 된다.
// "HH:mm" 24시간 형식, 문자열 비교로 시간대를 판정하므로 반드시 이 형식을 지킬 것.
const PART_SCHEDULE = {
  "1부": { start: "17:00", end: "18:00" },
  "2부": { start: "19:00", end: "20:20" },
  "3부": { start: "20:30", end: "21:50" }
};
const PART_ORDER = ["1부", "2부", "3부"]; // 화면에 보여줄 순서

const ATTENDANCE_STATUS = {
  PRESENT: "출석",
  NOT_RECOGNIZED: "미인정" // 이전 방식(체류시간 판정)으로 쌓인 과거 기록 표시용으로만 남겨둠
};

// ===== 외부 출석체크표 연동 설정 =====
const ATTENDANCE_SHEET_ID = "PUT_YOUR_ATTENDANCE_SHEET_ID_HERE"; // 출석체크표 스프레드시트 ID (URL 아님, ID만!)
const ATTENDANCE_MONTH_SHEET_MODE = true; // true: 월별 시트("9월" 등) 자동 선택
const ATTENDANCE_SHEET_NAME = "9월"; // MONTH_SHEET_MODE가 false일 때만 사용

const ONLY_MARK_REQUESTED_PART = false; // true: 신청한 부만 색칠 / false: 출석한 부는 무조건 색칠
const ATTENDANCE_COLOR = "#ffff00"; // 출석 완료 표시 색상 (진한 노랑)

const ATTENDANCE_HEADER_DATE_ROW = 3;   // 날짜(일) 숫자가 있는 행
const ATTENDANCE_HEADER_PART_ROW = 5;   // "1부/2부/3부" 라벨이 있는 행
const ATTENDANCE_DATA_START_ROW = 6;    // 학생 데이터 첫 행
const ATTENDANCE_STUDENT_ID_COL = 3;    // 학번 열 (C = 3번째)
// 날짜 열 탐색 시작 위치. 매달 1일이 무슨 요일이냐에 따라 실제 날짜가
// 시작되는 열이 달라지므로(예: 8월엔 H열, 9월엔 E열), 고정 열 대신
// "학번/이름 열 다음부터 전부" 넓게 훑도록 넉넉히 앞쪽(E=5번째)부터 시작한다.
const ATTENDANCE_DATE_SEARCH_START_COL = 5;

// 학생 페이지가 화면을 그릴 때 참고하는 부별 상태값
// (퇴실 개념이 없어져서, 이제 "입실 전"과 "출석 완료" 둘뿐)
const PART_STATE = {
  NOT_STARTED: "NOT_STARTED", // 그 부에 아직 출석하지 않음
  DONE: "DONE"                // 출석 완료
};

// Logs 시트 열 번호 (1부터 시작).
// 날짜 | 학번 | 이름 | 부 | 입실시간 | 퇴실시간 | 체류시간(분) | 출석상태 | 비고
const LOG_COL = {
  DATE: 1,
  STUDENT_ID: 2,
  NAME: 3,
  PART: 4,
  CHECKIN_TIME: 5,
  CHECKOUT_TIME: 6,
  STAY_MINUTES: 7,
  STATUS: 8,
  NOTE: 9
};

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getStudentsSheet_() {
  return getSpreadsheet_().getSheetByName(STUDENTS_SHEET_NAME);
}

function getLogsSheet_() {
  return getSpreadsheet_().getSheetByName(LOGS_SHEET_NAME);
}

function getDevicesSheet_() {
  return getSpreadsheet_().getSheetByName(DEVICES_SHEET_NAME);
}

function getSecurityLogsSheet_() {
  return getSpreadsheet_().getSheetByName(SECURITY_LOGS_SHEET_NAME);
}

function getInquiriesSheet_() {
  return getSpreadsheet_().getSheetByName(INQUIRIES_SHEET_NAME);
}

function doPost(e) {
  let result;

  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;

    switch (action) {
      case "ping":
        result = handlePing_(request);
        break;

      case "checkStudent":
        result = handleCheckStudent_(request);
        break;

      case "registerDevice":
        result = handleRegisterDevice_(request);
        break;

      case "getAttendanceStatus":
        result = handleGetAttendanceStatus_(request);
        break;

      case "checkin":
        result = handleCheckin_(request);
        break;

      case "adminGetLogs":
        result = handleAdminGetLogs_(request);
        break;

      case "adminResetDevice":
        result = handleAdminResetDevice_(request);
        break;

      case "submitInquiry":
        result = handleSubmitInquiry_(request);
        break;

      case "adminGetInquiries":
        result = handleAdminGetInquiries_(request);
        break;

      case "adminResolveInquiry":
        result = handleAdminResolveInquiry_(request);
        break;

      case "adminReplyInquiry":
        result = handleAdminReplyInquiry_(request);
        break;

      case "getMyInquiries":
        result = handleGetMyInquiries_(request);
        break;

      default:
        result = { success: false, error: "알 수 없는 요청입니다." };
    }
  } catch (err) {
    result = { success: false, error: "서버 처리 중 오류가 발생했습니다." };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handlePing_(request) {
  const studentsSheet = getStudentsSheet_();
  const logsSheet = getLogsSheet_();

  return {
    success: true,
    message: "서버가 정상적으로 응답했습니다.",
    studentsSheetFound: studentsSheet !== null,
    logsSheetFound: logsSheet !== null,
    serverTime: new Date().toISOString()
  };
}

function handleCheckStudent_(request) {
  const studentId = normalizeStudentId_(request.studentId);

  if (!studentId) {
    return { success: false, error: "학번을 입력해주세요." };
  }

  const student = findStudentByStudentId_(studentId);

  if (!student) {
    return { success: false, error: "등록된 학생을 찾을 수 없습니다." };
  }

  return {
    success: true,
    studentId: student.studentId,
    name: student.name
  };
}

/**
 * 이 휴대폰을 학번의 "출석 기기"로 등록한다.
 * 이미 그 학번에 활성 상태인 기기가 등록되어 있으면 거부한다
 * (누군가 남의 학번으로 자기 폰을 등록해버리는 것을 막기 위함).
 * 재등록이 필요하면 관리자가 관리자 페이지의 "기기 초기화" 기능을 쓰거나
 * Devices 시트에서 기존 행의 "상태"를 바꿔야 한다.
 */
function handleRegisterDevice_(request) {
  const studentId = normalizeStudentId_(request.studentId);

  if (!studentId) {
    return { success: false, error: "학번을 입력해주세요." };
  }

  const student = findStudentByStudentId_(studentId);
  if (!student) {
    return { success: false, error: "등록된 학생을 찾을 수 없습니다." };
  }

  const sheet = getDevicesSheet_();
  const existing = findDeviceRow_(studentId);

  if (existing && existing.status === "활성") {
    logSecurityEvent_(studentId, "기기등록", "거부", "이미 활성 기기 존재");
    return {
      success: false,
      error: "이미 이 학번으로 등록된 기기가 있습니다. 다른 기기로 바꾸려면 선생님께 문의해주세요."
    };
  }

  const token = generateDeviceToken_();
  const now = new Date();

  if (existing) {
    // 이전에 등록됐다가 관리자가 초기화한 상태 → 같은 행에 새 토큰으로 갱신
    sheet.getRange(existing.row, 3).setValue(token);
    sheet.getRange(existing.row, 4).setValue(now);
    sheet.getRange(existing.row, 5).setValue("활성");
  } else {
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1).setValue(student.studentId);
    sheet.getRange(newRow, 2).setValue(student.name);
    sheet.getRange(newRow, 3).setValue(token);
    sheet.getRange(newRow, 4).setValue(now);
    sheet.getRange(newRow, 5).setValue("활성");
  }

  logSecurityEvent_(studentId, "기기등록", "성공", "");

  return {
    success: true,
    studentId: student.studentId,
    name: student.name,
    deviceToken: token
  };
}

/**
 * 관리자 전용: 특정 학번의 기기 등록을 초기화(비활성화)한다.
 * Devices 시트를 직접 열지 않아도 관리자 페이지에서 바로 처리할 수 있게 하기 위함.
 * 행을 삭제하지 않고 "상태"만 "초기화됨"으로 바꿔서 이력을 남긴다.
 */
function handleAdminResetDevice_(request) {
  if (request.password !== ADMIN_PASSWORD) {
    return { success: false, error: "비밀번호가 올바르지 않습니다." };
  }

  const studentId = normalizeStudentId_(request.studentId);
  if (!studentId) {
    return { success: false, error: "학번을 입력해주세요." };
  }

  const existing = findDeviceRow_(studentId);
  if (!existing) {
    return { success: false, error: "이 학번으로 등록된 기기 정보를 찾을 수 없습니다." };
  }

  const sheet = getDevicesSheet_();
  sheet.getRange(existing.row, 5).setValue("초기화됨");

  logSecurityEvent_(studentId, "기기초기화(관리자)", "성공", "");

  return { success: true, studentId: studentId };
}

/**
 * 학생이 문의를 접수한다. 학번은 몰라도(입력 전 상태여도) 접수 가능하도록
 * 필수값으로 요구하지 않는다. 내용은 필수.
 */
function handleSubmitInquiry_(request) {
  const content = String(request.content || "").trim();
  if (!content) {
    return { success: false, error: "문의 내용을 입력해주세요." };
  }

  const studentId = normalizeStudentId_(request.studentId) || "(미확인)";

  const sheet = getInquiriesSheet_();
  if (!sheet) {
    return { success: false, error: "문의 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }

  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1).setValue(new Date());
  sheet.getRange(newRow, 2).setValue(studentId);
  sheet.getRange(newRow, 3).setValue(content);
  sheet.getRange(newRow, 4).setValue("대기");

  return { success: true };
}

/**
 * 관리자용 문의 목록 조회.
 */
function handleAdminGetInquiries_(request) {
  if (request.password !== ADMIN_PASSWORD) {
    return { success: false, error: "비밀번호가 올바르지 않습니다." };
  }

  const sheet = getInquiriesSheet_();
  if (!sheet) {
    return { success: true, rows: [] };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { success: true, rows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const rows = [];

  for (let i = 0; i < values.length; i++) {
    rows.push({
      rowIndex: i + 2,
      time: formatDateTime_(values[i][0]),
      studentId: values[i][1],
      content: values[i][2],
      status: values[i][3] || "대기",
      answer: values[i][4] || ""
    });
  }

  // 최근 문의가 위로 오도록 뒤집는다.
  rows.reverse();

  return { success: true, rows: rows };
}

/**
 * 관리자용: 특정 문의를 "완료" 상태로 변경.
 */
function handleAdminResolveInquiry_(request) {
  if (request.password !== ADMIN_PASSWORD) {
    return { success: false, error: "비밀번호가 올바르지 않습니다." };
  }

  const rowIndex = Number(request.rowIndex);
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const sheet = getInquiriesSheet_();
  if (!sheet) {
    return { success: false, error: "문의 시트를 찾을 수 없습니다." };
  }

  sheet.getRange(rowIndex, 4).setValue("완료");

  return { success: true };
}

/**
 * 관리자용: 특정 문의에 답변을 남긴다. 답변을 남기면 자동으로 "완료" 상태가 된다.
 */
function handleAdminReplyInquiry_(request) {
  if (request.password !== ADMIN_PASSWORD) {
    return { success: false, error: "비밀번호가 올바르지 않습니다." };
  }

  const rowIndex = Number(request.rowIndex);
  const answer = String(request.answer || "").trim();

  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: "잘못된 요청입니다." };
  }
  if (!answer) {
    return { success: false, error: "답변 내용을 입력해주세요." };
  }

  const sheet = getInquiriesSheet_();
  if (!sheet) {
    return { success: false, error: "문의 시트를 찾을 수 없습니다." };
  }

  sheet.getRange(rowIndex, 4).setValue("완료");
  sheet.getRange(rowIndex, 5).setValue(answer);

  return { success: true };
}

/**
 * 학생용: 본인 학번으로 보낸 문의와 답변 목록을 조회한다.
 * 관리자 비밀번호 없이도(학생이니까) 호출 가능하다.
 */
function handleGetMyInquiries_(request) {
  const studentId = normalizeStudentId_(request.studentId);
  if (!studentId) {
    return { success: false, error: "학번 정보가 없습니다." };
  }

  const sheet = getInquiriesSheet_();
  if (!sheet) {
    return { success: true, rows: [] };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { success: true, rows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const rows = [];

  for (let i = 0; i < values.length; i++) {
    const rowStudentId = normalizeStudentId_(values[i][1]);
    if (rowStudentId !== studentId) continue;

    rows.push({
      time: formatDateTime_(values[i][0]),
      content: values[i][2],
      status: values[i][3] || "대기",
      answer: values[i][4] || ""
    });
  }

  rows.reverse();

  return { success: true, rows: rows };
}

/**
 * 학번+토큰이 Devices 시트의 활성 등록 정보와 일치하는지 확인.
 */
function verifyDeviceToken_(studentId, deviceToken) {
  if (!deviceToken) {
    return { valid: false, reason: "기기 인증 정보가 없습니다." };
  }

  const record = findDeviceRow_(studentId);

  if (!record) {
    return { valid: false, reason: "등록된 출석 기기가 없습니다." };
  }
  if (record.status !== "활성") {
    return { valid: false, reason: "기기 등록이 비활성 상태입니다." };
  }
  if (record.token !== deviceToken) {
    return { valid: false, reason: "등록된 기기와 일치하지 않습니다." };
  }

  return { valid: true, reason: "" };
}

/**
 * Devices 시트에서 학번으로 등록 정보를 찾는다.
 * 못 찾으면 null, 찾으면 {row, token, status} 반환.
 */
function findDeviceRow_(studentId) {
  const sheet = getDevicesSheet_();
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const normalizedId = normalizeStudentId_(studentId);

  for (let i = 0; i < values.length; i++) {
    const rowId = normalizeStudentId_(values[i][0]);
    if (rowId === normalizedId) {
      return {
        row: i + 2,
        token: values[i][2],
        status: values[i][4]
      };
    }
  }

  return null;
}

/**
 * 추측 불가능한 긴 무작위 토큰 생성 (UUID 2개를 이어붙임).
 */
function generateDeviceToken_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

/**
 * SecurityLogs 시트에 기기 인증 시도 기록을 남긴다.
 * 이 함수 자체가 실패해도 본 기능(입실)에 영향 없도록 try/catch로 감싼다.
 */
function logSecurityEvent_(studentId, attemptType, result, reason) {
  try {
    const sheet = getSecurityLogsSheet_();
    if (!sheet) return;

    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1).setValue(new Date());
    sheet.getRange(newRow, 2).setValue(studentId);
    sheet.getRange(newRow, 3).setValue(attemptType);
    sheet.getRange(newRow, 4).setValue(result);
    sheet.getRange(newRow, 5).setValue(reason);
  } catch (err) {
    Logger.log("[SecurityLogs 기록 실패] " + err);
  }
}

/**
 * 오늘 이 학생의 부별(1부/2부/3부) 출석 상태를 전부 조회.
 * 또한 지금이 어느 부 시간대인지(currentPart)도 함께 반환한다.
 * (퇴실 개념이 없어져서, 각 부는 "출석 완료" 또는 "아직 안 함" 둘 중 하나)
 */
function handleGetAttendanceStatus_(request) {
  const studentId = normalizeStudentId_(request.studentId);

  if (!studentId) {
    return { success: false, error: "학번을 입력해주세요." };
  }

  const student = findStudentByStudentId_(studentId);
  if (!student) {
    return { success: false, error: "등록된 학생을 찾을 수 없습니다." };
  }

  const now = new Date();
  const todayStr = formatDate_(now);
  const nowTimeStr = formatTime_(now);
  const currentPart = getCurrentPartKey_(nowTimeStr);

  // 최적화: 부(部)마다 시트를 따로 뒤지지 않고, 오늘·이 학생 것만
  // Logs 시트에서 한 번에 훑어서 메모리에 담아둔다 (시트 호출 횟수 최소화 → 응답 속도 개선).
  const todayRecords = {}; // { "1부": {checkinTime: Date}, ... }
  const sheet = getLogsSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, LOG_COL.CHECKIN_TIME).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const rowDate = formatDate_(row[LOG_COL.DATE - 1]);
      if (rowDate !== todayStr) continue;

      const rowStudentId = normalizeStudentId_(row[LOG_COL.STUDENT_ID - 1]);
      if (rowStudentId !== studentId) continue;

      const part = row[LOG_COL.PART - 1];
      todayRecords[part] = { checkinTime: row[LOG_COL.CHECKIN_TIME - 1] };
    }
  }

  const parts = {};

  PART_ORDER.forEach(function (partKey) {
    const schedule = PART_SCHEDULE[partKey];
    const isOver = isPartOver_(partKey, nowTimeStr);
    const record = todayRecords[partKey];

    if (!record) {
      parts[partKey] = {
        state: PART_STATE.NOT_STARTED,
        schedule: schedule,
        isOver: isOver
      };
      return;
    }

    parts[partKey] = {
      state: PART_STATE.DONE,
      schedule: schedule,
      isOver: isOver,
      checkinTime: formatTime_(record.checkinTime)
    };
  });

  return {
    success: true,
    studentId: student.studentId,
    name: student.name,
    currentPart: currentPart,
    parts: parts
  };
}

/**
 * 특정 부(part)에 대한 입실 처리.
 * 반드시 request.part가 현재 진행 중인 부와 일치해야 한다.
 * 퇴실 개념이 없어졌으므로, 입실이 성공하는 즉시 출석이 확정되고
 * Logs에 "출석"으로 기록 + 외부 출석체크표까지 그 자리에서 동기화한다.
 */
function handleCheckin_(request) {
  const studentId = normalizeStudentId_(request.studentId);
  const part = request.part;

  if (!studentId) {
    return { success: false, error: "학번을 입력해주세요." };
  }
  if (!PART_SCHEDULE[part]) {
    return { success: false, error: "잘못된 부 정보입니다." };
  }

  const student = findStudentByStudentId_(studentId);
  if (!student) {
    return { success: false, error: "등록된 학생을 찾을 수 없습니다." };
  }

  // 기기 인증 검증 (대리출석 방지) — 등록된 기기가 아니면 여기서 차단.
  const deviceCheck = verifyDeviceToken_(studentId, request.deviceToken);
  if (!deviceCheck.valid) {
    logSecurityEvent_(studentId, "입실시도(" + part + ")", "거부", deviceCheck.reason);
    return { success: false, error: "기기 인증에 실패했습니다: " + deviceCheck.reason };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { success: false, error: "요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const now = new Date();
    const todayStr = formatDate_(now);
    const nowTimeStr = formatTime_(now);

    const currentPart = getCurrentPartKey_(nowTimeStr);
    if (currentPart !== part) {
      return { success: false, error: "지금은 " + part + " 입실 시간이 아닙니다." };
    }

    const sheet = getLogsSheet_();
    const existingRow = findTodayPartLogRow_(studentId, todayStr, part);

    if (existingRow) {
      return { success: false, error: "오늘 " + part + " 출석이 이미 완료되었습니다." };
    }

    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, LOG_COL.DATE).setValue(todayStr);
    sheet.getRange(newRow, LOG_COL.STUDENT_ID).setValue(student.studentId);
    sheet.getRange(newRow, LOG_COL.NAME).setValue(student.name);
    sheet.getRange(newRow, LOG_COL.PART).setValue(part);
    sheet.getRange(newRow, LOG_COL.CHECKIN_TIME).setValue(now);
    // 퇴실시간 / 체류시간(분) 열은 더 이상 사용하지 않으므로 비워둔다.
    sheet.getRange(newRow, LOG_COL.STATUS).setValue(ATTENDANCE_STATUS.PRESENT);

    logSecurityEvent_(studentId, "입실(" + part + ")", "성공", "");

    // 외부 출석체크표 동기화 (Logs 저장이 이미 끝난 뒤 시도 — 실패해도 위 출석 기록엔 영향 없음)
    syncAttendanceToExternalSheet_(student.studentId, now, part);

    return {
      success: true,
      studentId: student.studentId,
      name: student.name,
      part: part,
      checkinTime: formatTime_(now),
      status: ATTENDANCE_STATUS.PRESENT
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 관리자용 Logs 조회. 부(part) 정보를 포함해서 반환.
 */
function handleAdminGetLogs_(request) {
  if (request.password !== ADMIN_PASSWORD) {
    return { success: false, error: "비밀번호가 올바르지 않습니다." };
  }

  const targetDate = request.date ? String(request.date).trim() : formatDate_(new Date());

  const sheet = getLogsSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { success: true, date: targetDate, rows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  const rows = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowDate = formatDate_(row[LOG_COL.DATE - 1]);

    if (rowDate !== targetDate) continue;

    rows.push({
      date: rowDate,
      studentId: normalizeStudentId_(row[LOG_COL.STUDENT_ID - 1]),
      name: row[LOG_COL.NAME - 1],
      part: row[LOG_COL.PART - 1] || "",
      checkinTime: row[LOG_COL.CHECKIN_TIME - 1] ? formatTime_(row[LOG_COL.CHECKIN_TIME - 1]) : "",
      checkoutTime: row[LOG_COL.CHECKOUT_TIME - 1] ? formatTime_(row[LOG_COL.CHECKOUT_TIME - 1]) : "",
      stayMinutes: row[LOG_COL.STAY_MINUTES - 1] || "",
      status: row[LOG_COL.STATUS - 1] || "",
      note: row[LOG_COL.NOTE - 1] || ""
    });
  }

  return { success: true, date: targetDate, rows: rows };
}

function computeStayMinutes_(checkinDate, checkoutDate) {
  const checkin = new Date(checkinDate);
  const checkout = new Date(checkoutDate);
  const diffMs = checkout.getTime() - checkin.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  return diffMinutes < 0 ? 0 : diffMinutes;
}

/**
 * 현재 시각("HH:mm")을 기준으로 지금이 어느 부 시간대인지 반환.
 * 어느 부에도 속하지 않으면 null.
 */
function getCurrentPartKey_(nowTimeStr) {
  for (let i = 0; i < PART_ORDER.length; i++) {
    const key = PART_ORDER[i];
    const schedule = PART_SCHEDULE[key];
    if (nowTimeStr >= schedule.start && nowTimeStr < schedule.end) {
      return key;
    }
  }
  return null;
}

/**
 * 특정 부의 시간대가 이미 완전히 지났는지 여부.
 */
function isPartOver_(partKey, nowTimeStr) {
  const schedule = PART_SCHEDULE[partKey];
  return nowTimeStr >= schedule.end;
}

function normalizeStudentId_(rawStudentId) {
  if (rawStudentId === undefined || rawStudentId === null) return "";
  return String(rawStudentId).trim();
}

function findStudentByStudentId_(studentId) {
  const sheet = getStudentsSheet_();
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < values.length; i++) {
    const rowStudentId = normalizeStudentId_(values[i][0]);
    const rowName = values[i][1];

    if (rowStudentId === studentId) {
      return { studentId: rowStudentId, name: rowName };
    }
  }

  return null;
}

/**
 * 오늘 날짜 + 학번 + 특정 부(part)에 해당하는 Logs 시트의 행 번호를 찾는다.
 * 못 찾으면 null 반환.
 */
function findTodayPartLogRow_(studentId, todayStr, part) {
  const sheet = getLogsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // 날짜(A), 학번(B), 부(D) 열만 가져와서 검색
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = 0; i < values.length; i++) {
    const rowDate = formatDate_(values[i][0]);
    const rowStudentId = normalizeStudentId_(values[i][1]);
    const rowPart = values[i][3];

    if (rowDate === todayStr && rowStudentId === studentId && rowPart === part) {
      return i + 2;
    }
  }

  return null;
}

function formatDate_(date) {
  if (!date) return "";
  return Utilities.formatDate(new Date(date), TIME_ZONE, "yyyy-MM-dd");
}

function formatTime_(date) {
  if (!date) return "";
  return Utilities.formatDate(new Date(date), TIME_ZONE, "HH:mm");
}

function formatDateTime_(date) {
  if (!date) return "";
  return Utilities.formatDate(new Date(date), TIME_ZONE, "yyyy-MM-dd HH:mm");
}

// ===================================
// 외부 출석체크표 연동
// ===================================

/**
 * 외부 출석체크표에서 학번+날짜+부에 해당하는 셀을 찾는다.
 * 찾으면 {row, col} 반환, 못 찾으면 null.
 */
function findAttendanceCell_(sheet, studentId, dateObj, part) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // 1. 학번으로 학생 행 찾기
  let studentRow = null;
  const idColValues = sheet.getRange(
    ATTENDANCE_DATA_START_ROW, ATTENDANCE_STUDENT_ID_COL,
    lastRow - ATTENDANCE_DATA_START_ROW + 1, 1
  ).getValues();

  for (let i = 0; i < idColValues.length; i++) {
    const cellValue = String(idColValues[i][0]).trim();
    if (cellValue === String(studentId).trim()) {
      studentRow = ATTENDANCE_DATA_START_ROW + i;
      break;
    }
  }
  if (!studentRow) return null;

  // 2. 날짜(일) 찾기 - 날짜 행을 훑는다.
  const dayOfMonth = dateObj.getDate();
  const dateRowValues = sheet.getRange(
    ATTENDANCE_HEADER_DATE_ROW, ATTENDANCE_DATE_SEARCH_START_COL,
    1, lastCol - ATTENDANCE_DATE_SEARCH_START_COL + 1
  ).getValues()[0];

  let dateStartCol = null;
  for (let c = 0; c < dateRowValues.length; c++) {
    const value = dateRowValues[c];
    if (value !== "" && Number(value) === dayOfMonth) {
      dateStartCol = ATTENDANCE_DATE_SEARCH_START_COL + c;
      break;
    }
  }
  if (!dateStartCol) return null;

  // 3. 그 날짜 3칸(dateStartCol ~ dateStartCol+2) 안에서 부(部) 라벨 찾기
  const partRowValues = sheet.getRange(
    ATTENDANCE_HEADER_PART_ROW, dateStartCol, 1, 3
  ).getValues()[0];

  let targetCol = null;
  for (let c = 0; c < partRowValues.length; c++) {
    if (String(partRowValues[c]).trim() === part) {
      targetCol = dateStartCol + c;
      break;
    }
  }
  if (!targetCol) return null;

  return { row: studentRow, col: targetCol };
}

/**
 * 찾은 셀의 값("1" 등)은 그대로 두고 배경색만 노란색으로 바꾼다.
 * ONLY_MARK_REQUESTED_PART 정책에 따라, 신청 안 한(빈 칸) 부는 스킵할 수도 있다.
 */
function markAttendanceCell_(studentId, dateObj, part) {
  const externalSs = SpreadsheetApp.openById(ATTENDANCE_SHEET_ID);

  const sheetName = ATTENDANCE_MONTH_SHEET_MODE
    ? (dateObj.getMonth() + 1) + "월"
    : ATTENDANCE_SHEET_NAME;

  const sheet = externalSs.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log("[출석체크표 동기화 실패] 시트를 찾을 수 없음: " + sheetName);
    return;
  }

  const cell = findAttendanceCell_(sheet, studentId, dateObj, part);
  if (!cell) {
    Logger.log(
      "[출석체크표 동기화 실패] 셀을 찾을 수 없음 (studentId=" + studentId +
      ", date=" + formatDate_(dateObj) + ", part=" + part + ")"
    );
    return;
  }

  const range = sheet.getRange(cell.row, cell.col);
  const currentValue = range.getValue();

  if (currentValue === "" && ONLY_MARK_REQUESTED_PART) {
    Logger.log(
      "[출석체크표 동기화 스킵] 신청 안 한 부라 표시하지 않음 (studentId=" + studentId +
      ", date=" + formatDate_(dateObj) + ", part=" + part + ")"
    );
    return;
  }

  // 값은 절대 건드리지 않고, 배경색만 변경한다.
  range.setBackground(ATTENDANCE_COLOR);
  Logger.log(
    "[출석체크표 동기화 성공] studentId=" + studentId +
    ", date=" + formatDate_(dateObj) + ", part=" + part
  );
}

/**
 * 진입점. 이 함수 자체가 절대 예외를 던지지 않도록
 * 내부에서 try/catch로 감싼다. (외부 시트 오류가 학생 출석 처리에 영향을 주지 않게 하기 위함)
 */
function syncAttendanceToExternalSheet_(studentId, dateObj, part) {
  try {
    markAttendanceCell_(studentId, dateObj, part);
  } catch (err) {
    Logger.log("[출석체크표 동기화 오류] " + err);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: "출석 시스템 백엔드가 실행 중입니다. (GET은 테스트용입니다)"
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================================
// 테스트용 함수들
// ===================================

function testPing() {
  const result = handlePing_({ action: "ping" });
  Logger.log(JSON.stringify(result));
}

function testCheckStudent() {
  const foundResult = handleCheckStudent_({ action: "checkStudent", studentId: "20311" });
  Logger.log("존재하는 학번 테스트: " + JSON.stringify(foundResult));

  const notFoundResult = handleCheckStudent_({ action: "checkStudent", studentId: "99999" });
  Logger.log("존재하지 않는 학번 테스트: " + JSON.stringify(notFoundResult));
}

function testAdminGetLogs() {
  const wrongPassword = handleAdminGetLogs_({ action: "adminGetLogs", password: "wrong" });
  Logger.log("잘못된 비밀번호 테스트: " + JSON.stringify(wrongPassword));

  const correctPassword = handleAdminGetLogs_({ action: "adminGetLogs", password: ADMIN_PASSWORD });
  Logger.log("올바른 비밀번호 테스트 (오늘 로그): " + JSON.stringify(correctPassword));
}

/**
 * 시간대 판정 로직 검증. 실제 시계와 무관하게 임의의 "HH:mm"으로 테스트한다.
 */
function testCurrentPart() {
  const cases = [
    { time: "16:30", expected: null },
    { time: "17:00", expected: "1부" },
    { time: "17:30", expected: "1부" },
    { time: "17:59", expected: "1부" },
    { time: "18:00", expected: null },
    { time: "18:30", expected: null },
    { time: "19:00", expected: "2부" },
    { time: "20:00", expected: "2부" },
    { time: "20:19", expected: "2부" },
    { time: "20:20", expected: null },
    { time: "20:30", expected: "3부" },
    { time: "21:49", expected: "3부" },
    { time: "21:50", expected: null },
    { time: "22:30", expected: null }
  ];

  cases.forEach(function (c) {
    const result = getCurrentPartKey_(c.time);
    const ok = result === c.expected ? "OK" : "FAIL";
    Logger.log(c.time + " → " + result + " (" + ok + ", 기대값 " + c.expected + ")");
  });

  Logger.log("--- 실제 현재 시각 기준 ---");
  const nowStr = formatTime_(new Date());
  Logger.log("지금(" + nowStr + ") → " + getCurrentPartKey_(nowStr));
}

/**
 * 상태 조회 테스트: 오늘 20311 학번의 부별 상태 전체를 출력.
 */
function testGetAttendanceStatus() {
  const result = handleGetAttendanceStatus_({ action: "getAttendanceStatus", studentId: "20311" });
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 입실 테스트: 지금 시각 기준으로 진행 중인 부가 있어야 의미 있게 테스트된다.
 * 이제 입실 = 즉시 출석이므로, 성공 여부와 중복 방지만 확인하면 된다.
 * 진행 중인 부가 없으면(currentPart === null) "입실 시간이 아닙니다" 오류가 나는 게 정상이다.
 */
function testCheckin() {
  const nowStr = formatTime_(new Date());
  const currentPart = getCurrentPartKey_(nowStr);
  Logger.log("현재(" + nowStr + ") 진행 중인 부: " + currentPart);

  if (!currentPart) {
    Logger.log("지금은 어느 부 시간대도 아니라서 입실 테스트는 스킵합니다. 시간대 안에 다시 실행해보세요.");
    return;
  }

  const checkinResult = handleCheckin_({ action: "checkin", studentId: "20311", part: currentPart });
  Logger.log(currentPart + " 입실(즉시출석) 시도: " + JSON.stringify(checkinResult));

  const dupCheckin = handleCheckin_({ action: "checkin", studentId: "20311", part: currentPart });
  Logger.log(currentPart + " 중복 입실 시도: " + JSON.stringify(dupCheckin));
}

/**
 * 외부 출석체크표 연동 테스트.
 * studentId, date, part을 실제 출석체크표에 있는 값으로 바꿔서 실행해보세요.
 */
function testSyncAttendance() {
  const testDate = new Date("2026-09-01"); // 출석체크표에 실제 있는 날짜로 변경
  syncAttendanceToExternalSheet_("10101", testDate, "1부"); // 실제 학번으로 변경
}

/**
 * 기기 등록/인증 테스트.
 * 1) 처음 등록 → 성공, 토큰 발급
 * 2) 같은 학번으로 다시 등록 시도 → 거부 (이미 활성 기기 있음)
 * 3) 발급받은 토큰으로 검증 → 통과
 * 4) 엉뚱한 토큰으로 검증 → 실패
 */
function testDeviceRegistration() {
  const testStudentId = "20311"; // 실제 있는 학번으로 바꿔서 테스트

  const first = handleRegisterDevice_({ action: "registerDevice", studentId: testStudentId });
  Logger.log("1차 등록 시도: " + JSON.stringify(first));

  const second = handleRegisterDevice_({ action: "registerDevice", studentId: testStudentId });
  Logger.log("2차(중복) 등록 시도: " + JSON.stringify(second));

  if (first.success) {
    const validCheck = verifyDeviceToken_(testStudentId, first.deviceToken);
    Logger.log("올바른 토큰 검증: " + JSON.stringify(validCheck));
  }

  const invalidCheck = verifyDeviceToken_(testStudentId, "완전히엉뚱한토큰값");
  Logger.log("잘못된 토큰 검증: " + JSON.stringify(invalidCheck));
}

/**
 * 관리자 기기 초기화 테스트.
 */
function testAdminResetDevice() {
  const testStudentId = "20311";

  const wrongPw = handleAdminResetDevice_({ action: "adminResetDevice", password: "wrong", studentId: testStudentId });
  Logger.log("잘못된 비밀번호: " + JSON.stringify(wrongPw));

  const result = handleAdminResetDevice_({ action: "adminResetDevice", password: ADMIN_PASSWORD, studentId: testStudentId });
  Logger.log("정상 초기화: " + JSON.stringify(result));

  // 초기화 후에는 재등록이 가능해야 한다.
  const reRegister = handleRegisterDevice_({ action: "registerDevice", studentId: testStudentId });
  Logger.log("초기화 후 재등록 시도: " + JSON.stringify(reRegister));
}

/**
 * 문의 접수/조회/처리 테스트.
 */
function testInquiry() {
  const submitResult = handleSubmitInquiry_({ action: "submitInquiry", studentId: "20311", content: "테스트 문의입니다." });
  Logger.log("문의 접수: " + JSON.stringify(submitResult));

  const listResult = handleAdminGetInquiries_({ action: "adminGetInquiries", password: ADMIN_PASSWORD });
  Logger.log("문의 목록: " + JSON.stringify(listResult, null, 2));

  if (listResult.success && listResult.rows.length > 0) {
    const firstRowIndex = listResult.rows[0].rowIndex;

    const replyResult = handleAdminReplyInquiry_({
      action: "adminReplyInquiry",
      password: ADMIN_PASSWORD,
      rowIndex: firstRowIndex,
      answer: "확인했습니다. 조치했어요!"
    });
    Logger.log("답변 등록: " + JSON.stringify(replyResult));

    const myInquiries = handleGetMyInquiries_({ action: "getMyInquiries", studentId: "20311" });
    Logger.log("학생 본인 문의 조회: " + JSON.stringify(myInquiries, null, 2));
  }
}
