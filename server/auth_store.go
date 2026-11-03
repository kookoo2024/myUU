package main

import (
	"context"
	"time"
)

type storedCredential struct {
	Salt       []byte
	Hash       []byte
	Iterations int
}

func (s *Store) HasAdminCredential(ctx context.Context) (bool, error) {
	var exists int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM auth_credentials WHERE id = 1)`,
	).Scan(&exists)
	return exists == 1, err
}

func (s *Store) GetAdminCredential(ctx context.Context) (storedCredential, error) {
	var credential storedCredential
	err := s.db.QueryRowContext(
		ctx,
		`SELECT password_salt, password_hash, iterations
		 FROM auth_credentials WHERE id = 1`,
	).Scan(&credential.Salt, &credential.Hash, &credential.Iterations)
	return credential, err
}

func (s *Store) SetAdminCredential(
	ctx context.Context,
	salt []byte,
	hash []byte,
	iterations int,
) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO auth_credentials(
			id, password_salt, password_hash, iterations, created_at, updated_at
		) VALUES(1, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			password_salt = excluded.password_salt,
			password_hash = excluded.password_hash,
			iterations = excluded.iterations,
			updated_at = excluded.updated_at`,
		salt,
		hash,
		iterations,
		now,
		now,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM teacher_sessions`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CreateTeacherSession(
	ctx context.Context,
	tokenHash string,
	expiresAt time.Time,
) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO teacher_sessions(token_hash, created_at, expires_at)
		 VALUES(?, ?, ?)`,
		tokenHash,
		now,
		expiresAt.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (s *Store) TeacherSessionValid(
	ctx context.Context,
	tokenHash string,
	now time.Time,
) (bool, error) {
	nowText := now.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(
		ctx,
		`DELETE FROM teacher_sessions WHERE expires_at <= ?`,
		nowText,
	); err != nil {
		return false, err
	}
	var exists int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT EXISTS(
			SELECT 1 FROM teacher_sessions
			WHERE token_hash = ? AND expires_at > ?
		)`,
		tokenHash,
		nowText,
	).Scan(&exists)
	return exists == 1, err
}

func (s *Store) DeleteTeacherSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(
		ctx,
		`DELETE FROM teacher_sessions WHERE token_hash = ?`,
		tokenHash,
	)
	return err
}
