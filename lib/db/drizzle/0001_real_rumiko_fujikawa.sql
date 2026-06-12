CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `organizations` (`id`, `name`, `status`) VALUES (1, 'عرض تجريبي', 'active');
--> statement-breakpoint
DROP INDEX `customers_phone_unique`;--> statement-breakpoint
ALTER TABLE `customers` ADD `org_id` integer DEFAULT 1 NOT NULL REFERENCES organizations(id);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_id_phone_unique` ON `customers` (`org_id`,`phone`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`org_id` integer DEFAULT 1 NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`org_id`, `key`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_settings`("org_id", "key", "value") SELECT 1, "key", "value" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `accounts` ADD `org_id` integer DEFAULT 1 NOT NULL REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `org_id` integer REFERENCES organizations(id);--> statement-breakpoint
UPDATE `audit_log` SET `org_id` = 1 WHERE `org_id` IS NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `org_id` integer REFERENCES organizations(id);--> statement-breakpoint
UPDATE `users` SET `org_id` = 1 WHERE `org_id` IS NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `org_id` integer DEFAULT 1 NOT NULL REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `org_id` integer DEFAULT 1 NOT NULL REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `org_id` integer DEFAULT 1 NOT NULL REFERENCES organizations(id);
