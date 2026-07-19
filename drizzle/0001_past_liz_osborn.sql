CREATE INDEX `cases_account_idx` ON `cases` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `documents_case_idx` ON `documents` (`case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);