package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

const (
	maxStoredQuestions = 500
	maxClassrooms      = 30
	maxStudents        = 80
	maxPracticeAnswers = 30
	maxPracticeHistory = 200
)

type Store struct {
	db      *sql.DB
	dataDir string
	dbPath  string
}

type Bootstrap struct {
	Classroom          json.RawMessage            `json:"classroom"`
	ClassroomDirectory json.RawMessage            `json:"classroomDirectory"`
	Questions          []json.RawMessage          `json:"questions"`
	PackDrafts         map[string]json.RawMessage `json:"packDrafts"`
	AppliedPack        string                     `json:"appliedPack"`
	HasData            bool                       `json:"hasData"`
}

type questionMeta struct {
	ID           string   `json:"id"`
	Subject      string   `json:"subject"`
	Topic        string   `json:"topic"`
	Difficulty   string   `json:"difficulty"`
	Prompt       string   `json:"prompt"`
	Options      []string `json:"options"`
	CorrectIndex int      `json:"correctIndex"`
}

type classroomMeta struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Students []json.RawMessage `json:"students"`
}

type classroomDirectoryMeta struct {
	Version       int             `json:"version"`
	ActiveClassID string          `json:"activeClassId"`
	Classrooms    []classroomMeta `json:"classrooms"`
}

type practiceAnswerMeta struct {
	QuestionID            string `json:"questionId"`
	Topic                 string `json:"topic"`
	SelectedOriginalIndex *int   `json:"selectedOriginalIndex"`
	Correct               bool   `json:"correct"`
	TimedOut              bool   `json:"timedOut"`
	ElapsedMs             int64  `json:"elapsedMs"`
}

type practiceAttemptMeta struct {
	ID             string               `json:"id"`
	ClassID        string               `json:"classId"`
	ClassName      string               `json:"className"`
	StudentID      string               `json:"studentId"`
	StudentNumber  int                  `json:"studentNumber"`
	StudentName    string               `json:"studentName"`
	Subject        string               `json:"subject"`
	PackTitle      string               `json:"packTitle"`
	Mode           string               `json:"mode"`
	QuestionCount  int                  `json:"questionCount"`
	CorrectCount   int                  `json:"correctCount"`
	Score          int                  `json:"score"`
	TotalElapsedMs int64                `json:"totalElapsedMs"`
	StartedAt      string               `json:"startedAt"`
	CompletedAt    string               `json:"completedAt"`
	Answers        []practiceAnswerMeta `json:"answers"`
}

func OpenStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "xyz.db")
	dsn := "file:" + filepath.ToSlash(dbPath) +
		"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{
		db:      db,
		dataDir: dataDir,
		dbPath:  dbPath,
	}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_position ON questions(position);

CREATE TABLE IF NOT EXISTS pack_drafts (
  subject TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  mode TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_practice_class_completed
  ON practice_attempts(class_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_completed
  ON practice_attempts(completed_at DESC);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teacher_sessions_expires
  ON teacher_sessions(expires_at);`

	_, err := s.db.Exec(schema)
	if err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	return nil
}

func (s *Store) Bootstrap(ctx context.Context) (Bootstrap, error) {
	result := Bootstrap{
		Questions:  []json.RawMessage{},
		PackDrafts: map[string]json.RawMessage{},
	}

	classroom, err := s.getClassroom(ctx)
	if err != nil {
		return result, err
	}
	directory, err := s.getClassroomDirectory(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	if len(directory) == 0 && len(classroom) > 0 {
		directory, err = wrapClassroomDirectory(classroom)
		if err != nil {
			return result, err
		}
	}
	if len(directory) > 0 {
		activeClassroom, activeErr := activeClassroomFromDirectory(directory)
		if activeErr != nil {
			return result, activeErr
		}
		result.ClassroomDirectory = directory
		result.Classroom = activeClassroom
	} else {
		result.Classroom = classroom
	}

	questions, err := s.getQuestions(ctx)
	if err != nil {
		return result, err
	}
	result.Questions = questions

	drafts, err := s.getPackDrafts(ctx)
	if err != nil {
		return result, err
	}
	result.PackDrafts = drafts

	appliedPack, err := s.getSetting(ctx, "applied_pack")
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	result.AppliedPack = appliedPack
	result.HasData =
		len(result.ClassroomDirectory) > 0 ||
			len(result.Classroom) > 0 ||
			len(result.Questions) > 0 ||
			len(result.PackDrafts) > 0 ||
			result.AppliedPack != ""

	return result, nil
}

func (s *Store) PracticeBootstrap(ctx context.Context) (Bootstrap, error) {
	result, err := s.Bootstrap(ctx)
	if err != nil {
		return result, err
	}
	subject := strings.TrimSpace(result.AppliedPack)
	if subject == "" {
		result.Questions = []json.RawMessage{}
		result.PackDrafts = map[string]json.RawMessage{}
		return result, nil
	}

	rawDraft, exists := result.PackDrafts[subject]
	if !exists {
		result.Questions = []json.RawMessage{}
		result.PackDrafts = map[string]json.RawMessage{}
		return result, nil
	}

	var draft struct {
		QuestionIDs []string `json:"questionIds"`
	}
	if err := json.Unmarshal(rawDraft, &draft); err != nil {
		return result, fmt.Errorf("解析当前题包失败: %w", err)
	}
	questionIDs := make(map[string]struct{}, len(draft.QuestionIDs))
	for _, id := range draft.QuestionIDs {
		questionIDs[strings.TrimSpace(id)] = struct{}{}
	}

	filtered := make([]json.RawMessage, 0, len(result.Questions))
	for _, raw := range result.Questions {
		var question questionMeta
		if err := json.Unmarshal(raw, &question); err != nil {
			continue
		}
		if _, wanted := questionIDs[question.ID]; wanted {
			filtered = append(filtered, raw)
		}
	}
	result.Questions = filtered
	result.PackDrafts = map[string]json.RawMessage{subject: rawDraft}
	return result, nil
}

func (s *Store) SaveClassroom(ctx context.Context, payload []byte) error {
	var classroom classroomMeta
	if err := json.Unmarshal(payload, &classroom); err != nil {
		return errors.New("班级数据不是有效的 JSON")
	}
	if strings.TrimSpace(classroom.ID) == "" || strings.TrimSpace(classroom.Name) == "" {
		return errors.New("班级 ID 和名称不能为空")
	}
	if len(classroom.Students) < 1 || len(classroom.Students) > maxStudents {
		return fmt.Errorf("班级人数必须在 1 到 %d 之间", maxStudents)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `DELETE FROM classrooms`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO classrooms(id, name, payload_json, updated_at) VALUES(?, ?, ?, ?)`,
		classroom.ID,
		strings.TrimSpace(classroom.Name),
		string(payload),
		now,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SaveClassroomDirectory(ctx context.Context, payload []byte) error {
	var directory classroomDirectoryMeta
	if err := json.Unmarshal(payload, &directory); err != nil {
		return errors.New("班级工作区不是有效的 JSON")
	}
	if directory.Version != 1 {
		return errors.New("不支持的班级工作区版本")
	}
	if len(directory.Classrooms) < 1 || len(directory.Classrooms) > maxClassrooms {
		return fmt.Errorf("班级数量必须在 1 到 %d 之间", maxClassrooms)
	}

	classroomIDs := make(map[string]struct{}, len(directory.Classrooms))
	activePayload := []byte(nil)
	for index, classroom := range directory.Classrooms {
		classroom.ID = strings.TrimSpace(classroom.ID)
		classroom.Name = strings.TrimSpace(classroom.Name)
		if classroom.ID == "" || classroom.Name == "" {
			return fmt.Errorf("第 %d 个班级的 ID 和名称不能为空", index+1)
		}
		if len(classroom.Students) < 1 || len(classroom.Students) > maxStudents {
			return fmt.Errorf(
				"第 %d 个班级的人数必须在 1 到 %d 之间",
				index+1,
				maxStudents,
			)
		}
		if _, exists := classroomIDs[classroom.ID]; exists {
			return fmt.Errorf("班级 ID 重复：%s", classroom.ID)
		}
		classroomIDs[classroom.ID] = struct{}{}

		if classroom.ID == directory.ActiveClassID {
			var err error
			activePayload, err = json.Marshal(classroom)
			if err != nil {
				return err
			}
		}
	}
	if activePayload == nil {
		return errors.New("当前班级不在班级列表中")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `DELETE FROM classrooms`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO classrooms(id, name, payload_json, updated_at) VALUES(?, ?, ?, ?)`,
		directory.ActiveClassID,
		activeClassroomName(directory),
		string(activePayload),
		now,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO app_settings(key, value, updated_at) VALUES('classroom_directory', ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		string(payload),
		now,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ReplaceQuestions(ctx context.Context, payload []byte) error {
	var questions []json.RawMessage
	if err := json.Unmarshal(payload, &questions); err != nil {
		return errors.New("题库数据必须是 JSON 数组")
	}
	if len(questions) > maxStoredQuestions {
		return fmt.Errorf("自建题最多 %d 道", maxStoredQuestions)
	}

	type normalizedQuestion struct {
		meta    questionMeta
		payload []byte
	}
	normalized := make([]normalizedQuestion, 0, len(questions))
	for index, raw := range questions {
		var question questionMeta
		if err := json.Unmarshal(raw, &question); err != nil {
			return fmt.Errorf("第 %d 道题不是有效 JSON", index+1)
		}
		if strings.TrimSpace(question.ID) == "" ||
			strings.TrimSpace(question.Subject) == "" ||
			strings.TrimSpace(question.Topic) == "" ||
			strings.TrimSpace(question.Prompt) == "" ||
			len(question.Options) != 4 ||
			question.CorrectIndex < 0 ||
			question.CorrectIndex > 3 {
			return fmt.Errorf("第 %d 道题字段不完整", index+1)
		}
		normalized = append(normalized, normalizedQuestion{meta: question, payload: raw})
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM questions`); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for position, question := range normalized {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO questions(
				id, subject, topic, difficulty, position, payload_json, created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			question.meta.ID,
			question.meta.Subject,
			question.meta.Topic,
			question.meta.Difficulty,
			position,
			string(question.payload),
			now,
			now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ReplacePackDrafts(ctx context.Context, payload []byte) error {
	var drafts map[string]json.RawMessage
	if err := json.Unmarshal(payload, &drafts); err != nil {
		return errors.New("题包草稿必须是 JSON 对象")
	}
	if len(drafts) > 3 {
		return errors.New("题包草稿数量异常")
	}
	for subject, raw := range drafts {
		if subject != "english" && subject != "math" && subject != "physics" {
			return fmt.Errorf("未知学科：%s", subject)
		}
		if !json.Valid(raw) {
			return fmt.Errorf("%s 题包草稿不是有效 JSON", subject)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM pack_drafts`); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for subject, raw := range drafts {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO pack_drafts(subject, payload_json, updated_at) VALUES(?, ?, ?)`,
			subject,
			string(raw),
			now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) SetAppliedPack(ctx context.Context, subject string) error {
	if subject == "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM app_settings WHERE key = 'applied_pack'`)
		return err
	}
	if subject != "english" && subject != "math" && subject != "physics" {
		return errors.New("未知学科")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO app_settings(key, value, updated_at) VALUES('applied_pack', ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		subject,
		now,
	)
	return err
}

func (s *Store) ApplyPack(ctx context.Context, subject string, draft json.RawMessage) error {
	if subject != "english" && subject != "math" && subject != "physics" {
		return errors.New("未知学科")
	}
	if len(draft) == 0 || !json.Valid(draft) {
		return errors.New("题包草稿不是有效 JSON")
	}
	var draftMeta struct {
		Subject string `json:"subject"`
	}
	if err := json.Unmarshal(draft, &draftMeta); err != nil || draftMeta.Subject != subject {
		return errors.New("题包草稿学科不匹配")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO pack_drafts(subject, payload_json, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(subject) DO UPDATE SET
		   payload_json = excluded.payload_json,
		   updated_at = excluded.updated_at`,
		subject,
		string(draft),
		now,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO app_settings(key, value, updated_at) VALUES('applied_pack', ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		subject,
		now,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SavePracticeAttempt(ctx context.Context, payload []byte) error {
	var attempt practiceAttemptMeta
	if err := json.Unmarshal(payload, &attempt); err != nil {
		return errors.New("练习记录不是有效的 JSON")
	}
	attempt.ID = strings.TrimSpace(attempt.ID)
	attempt.ClassID = strings.TrimSpace(attempt.ClassID)
	attempt.ClassName = strings.TrimSpace(attempt.ClassName)
	attempt.StudentID = strings.TrimSpace(attempt.StudentID)
	attempt.StudentName = strings.TrimSpace(attempt.StudentName)
	attempt.Subject = strings.TrimSpace(attempt.Subject)
	attempt.PackTitle = strings.TrimSpace(attempt.PackTitle)
	attempt.Mode = strings.TrimSpace(attempt.Mode)

	if attempt.ID == "" ||
		attempt.ClassID == "" ||
		attempt.ClassName == "" ||
		attempt.StudentID == "" ||
		attempt.StudentName == "" ||
		attempt.PackTitle == "" {
		return errors.New("练习记录缺少班级、学生或题包信息")
	}
	if attempt.StudentNumber < 1 || attempt.StudentNumber > maxStudents {
		return fmt.Errorf("学生学号必须在 1 到 %d 之间", maxStudents)
	}
	if attempt.Subject != "english" && attempt.Subject != "math" && attempt.Subject != "physics" {
		return errors.New("未知学科")
	}
	if attempt.Mode != "practice" && attempt.Mode != "test" {
		return errors.New("未知练习模式")
	}
	if attempt.QuestionCount < 1 || attempt.QuestionCount > maxPracticeAnswers {
		return fmt.Errorf("练习题数必须在 1 到 %d 之间", maxPracticeAnswers)
	}
	if len(attempt.Answers) != attempt.QuestionCount {
		return errors.New("答题记录数量与题数不一致")
	}

	computedCorrect := 0
	computedElapsed := int64(0)
	for index, answer := range attempt.Answers {
		answer.QuestionID = strings.TrimSpace(answer.QuestionID)
		answer.Topic = strings.TrimSpace(answer.Topic)
		if answer.QuestionID == "" || answer.Topic == "" {
			return fmt.Errorf("第 %d 条答题记录缺少题目信息", index+1)
		}
		if answer.SelectedOriginalIndex != nil &&
			(*answer.SelectedOriginalIndex < 0 || *answer.SelectedOriginalIndex > 3) {
			return fmt.Errorf("第 %d 条答题记录的选项序号不正确", index+1)
		}
		if answer.ElapsedMs < 0 || answer.ElapsedMs > 10*60*1000 {
			return fmt.Errorf("第 %d 条答题记录耗时异常", index+1)
		}
		if answer.Correct {
			computedCorrect++
		}
		computedElapsed += answer.ElapsedMs
		attempt.Answers[index] = answer
	}
	if attempt.CorrectCount != computedCorrect {
		return errors.New("正确题数与答题明细不一致")
	}
	expectedScore := computedCorrect * 100 / attempt.QuestionCount
	if attempt.Score != expectedScore {
		return errors.New("得分与答题明细不一致")
	}
	if attempt.TotalElapsedMs < 0 ||
		attempt.TotalElapsedMs > 24*60*60*1000 ||
		attempt.TotalElapsedMs < computedElapsed {
		return errors.New("练习总耗时异常")
	}

	startedAt, err := time.Parse(time.RFC3339Nano, attempt.StartedAt)
	if err != nil {
		return errors.New("练习开始时间格式不正确")
	}
	completedAt, err := time.Parse(time.RFC3339Nano, attempt.CompletedAt)
	if err != nil || completedAt.Before(startedAt) {
		return errors.New("练习完成时间格式不正确")
	}

	normalized, err := json.Marshal(attempt)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(
		ctx,
		`INSERT INTO practice_attempts(
			id, class_id, student_id, subject, mode, completed_at,
			question_count, correct_count, payload_json, created_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING`,
		attempt.ID,
		attempt.ClassID,
		attempt.StudentID,
		attempt.Subject,
		attempt.Mode,
		attempt.CompletedAt,
		attempt.QuestionCount,
		attempt.CorrectCount,
		string(normalized),
		now,
	)
	return err
}

func (s *Store) ListPracticeAttempts(
	ctx context.Context,
	classID string,
	limit int,
) ([]json.RawMessage, error) {
	if limit < 1 {
		limit = 80
	}
	if limit > maxPracticeHistory {
		limit = maxPracticeHistory
	}

	query := `SELECT payload_json FROM practice_attempts`
	args := make([]any, 0, 2)
	if strings.TrimSpace(classID) != "" {
		query += ` WHERE class_id = ?`
		args = append(args, strings.TrimSpace(classID))
	}
	query += ` ORDER BY completed_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	attempts := make([]json.RawMessage, 0)
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		attempts = append(attempts, json.RawMessage(payload))
	}
	return attempts, rows.Err()
}

func (s *Store) getClassroom(ctx context.Context) (json.RawMessage, error) {
	var payload string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT payload_json FROM classrooms ORDER BY updated_at DESC LIMIT 1`,
	).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func (s *Store) getClassroomDirectory(ctx context.Context) (json.RawMessage, error) {
	value, err := s.getSetting(ctx, "classroom_directory")
	if err != nil {
		return nil, err
	}
	return json.RawMessage(value), nil
}

func (s *Store) getQuestions(ctx context.Context) ([]json.RawMessage, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT payload_json FROM questions ORDER BY position ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questions := make([]json.RawMessage, 0)
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		questions = append(questions, json.RawMessage(payload))
	}
	return questions, rows.Err()
}

func (s *Store) getPackDrafts(ctx context.Context) (map[string]json.RawMessage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT subject, payload_json FROM pack_drafts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	drafts := map[string]json.RawMessage{}
	for rows.Next() {
		var subject string
		var payload string
		if err := rows.Scan(&subject, &payload); err != nil {
			return nil, err
		}
		drafts[subject] = json.RawMessage(payload)
	}
	return drafts, rows.Err()
}

func (s *Store) getSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT value FROM app_settings WHERE key = ?`,
		key,
	).Scan(&value)
	return value, err
}

func wrapClassroomDirectory(classroom json.RawMessage) (json.RawMessage, error) {
	var parsed classroomMeta
	if err := json.Unmarshal(classroom, &parsed); err != nil {
		return nil, err
	}
	return json.Marshal(classroomDirectoryMeta{
		Version:       1,
		ActiveClassID: parsed.ID,
		Classrooms:    []classroomMeta{parsed},
	})
}

func activeClassroomFromDirectory(directory json.RawMessage) (json.RawMessage, error) {
	var parsed classroomDirectoryMeta
	if err := json.Unmarshal(directory, &parsed); err != nil {
		return nil, err
	}
	for _, classroom := range parsed.Classrooms {
		if classroom.ID == parsed.ActiveClassID {
			return json.Marshal(classroom)
		}
	}
	return nil, errors.New("当前班级不在班级列表中")
}

func activeClassroomName(directory classroomDirectoryMeta) string {
	for _, classroom := range directory.Classrooms {
		if classroom.ID == directory.ActiveClassID {
			return classroom.Name
		}
	}
	return ""
}
