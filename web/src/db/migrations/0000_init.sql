CREATE TYPE "public"."activity_kind" AS ENUM('created', 'funded', 'withdrawn', 'paused', 'unpaused', 'root_updated', 'signer_updated', 'schedule_created', 'schedule_revoked', 'creator_transfer_initiated', 'creator_transferred');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('merkle', 'sign', 'vesting');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_nonces" (
	"nonce" varchar(128) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claimers" (
	"account" varchar(42) PRIMARY KEY NOT NULL,
	"first_claim_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_address" varchar(42) NOT NULL,
	"type" "project_type" NOT NULL,
	"account" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"claim_key" text NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_claim_log" UNIQUE("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creators" (
	"account" varchar(42) PRIMARY KEY NOT NULL,
	"first_project_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_stats" (
	"day" date PRIMARY KEY NOT NULL,
	"projects_created" integer DEFAULT 0 NOT NULL,
	"claims" integer DEFAULT 0 NOT NULL,
	"new_claimers" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merkle_entries" (
	"root" varchar(66) NOT NULL,
	"index" integer NOT NULL,
	"account" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"proof" jsonb NOT NULL,
	CONSTRAINT "merkle_entries_root_index_pk" PRIMARY KEY("root","index"),
	CONSTRAINT "uniq_merkle_root_account" UNIQUE("root","account")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merkle_trees" (
	"root" varchar(66) PRIMARY KEY NOT NULL,
	"total_entries" integer NOT NULL,
	"total_amount" numeric(78, 0) NOT NULL,
	"token_decimals" integer NOT NULL,
	"uploader" varchar(42) NOT NULL,
	"file_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_stats" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"total_projects" integer DEFAULT 0 NOT NULL,
	"total_merkle" integer DEFAULT 0 NOT NULL,
	"total_sign" integer DEFAULT 0 NOT NULL,
	"total_vesting" integer DEFAULT 0 NOT NULL,
	"total_creators" integer DEFAULT 0 NOT NULL,
	"total_claims" integer DEFAULT 0 NOT NULL,
	"total_claimers" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_txs" (
	"tx_hash" varchar(66) PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"from" varchar(42) NOT NULL,
	"event_count" integer NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_activities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_address" varchar(42) NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"actor" varchar(42),
	"amount" numeric(78, 0),
	"data" jsonb,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_activity_log" UNIQUE("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_claimers" (
	"project_address" varchar(42) NOT NULL,
	"account" varchar(42) NOT NULL,
	CONSTRAINT "project_claimers_project_address_account_pk" PRIMARY KEY("project_address","account")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stats" (
	"project_address" varchar(42) PRIMARY KEY NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	"claimer_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"type" "project_type" NOT NULL,
	"creator" varchar(42) NOT NULL,
	"pending_creator" varchar(42),
	"token_address" varchar(42) NOT NULL,
	"token_symbol" varchar(32),
	"token_name" varchar(120),
	"token_decimals" integer DEFAULT 18 NOT NULL,
	"total_funded" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_claimed" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_withdrawn" numeric(78, 0) DEFAULT '0' NOT NULL,
	"start_time" bigint,
	"end_time" bigint,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_since" bigint,
	"total_paused_duration" bigint DEFAULT 0 NOT NULL,
	"merkle_root" varchar(66),
	"signer_address" varchar(42),
	"name" varchar(120) NOT NULL,
	"description" text,
	"logo_url" varchar(300),
	"website" varchar(200),
	"twitter" varchar(80),
	"telegram" varchar(80),
	"created_tx" varchar(66) NOT NULL,
	"created_block" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_allocations" (
	"project_address" varchar(42) NOT NULL,
	"account" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"claimed" numeric(78, 0) DEFAULT '0' NOT NULL,
	"claim_nonce" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_allocations_project_address_account_pk" PRIMARY KEY("project_address","account")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_issuances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sign_issuances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_address" varchar(42) NOT NULL,
	"account" varchar(42) NOT NULL,
	"claim_id" varchar(66) NOT NULL,
	"nonce" integer NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"deadline" bigint NOT NULL,
	"signature" text NOT NULL,
	"used_tx" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_signers" (
	"project_address" varchar(42) PRIMARY KEY NOT NULL,
	"signer_address" varchar(42) NOT NULL,
	"encrypted_priv_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vesting_schedules" (
	"project_address" varchar(42) NOT NULL,
	"schedule_id" integer NOT NULL,
	"beneficiary" varchar(42) NOT NULL,
	"total_amount" numeric(78, 0) NOT NULL,
	"claimed" numeric(78, 0) DEFAULT '0' NOT NULL,
	"tge_time" bigint NOT NULL,
	"tge_bps" integer NOT NULL,
	"cliff_duration" bigint NOT NULL,
	"vesting_duration" bigint NOT NULL,
	"interval" bigint NOT NULL,
	"revocable" boolean NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_claimable_cap" numeric(78, 0) DEFAULT '0' NOT NULL,
	"created_tx" varchar(66) NOT NULL,
	CONSTRAINT "vesting_schedules_project_address_schedule_id_pk" PRIMARY KEY("project_address","schedule_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_project" ON "claims" USING btree ("project_address","claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_account" ON "claims" USING btree ("account","claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_project_key" ON "claims" USING btree ("project_address","claim_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_project" ON "project_activities" USING btree ("project_address","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_creator" ON "projects" USING btree ("creator");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_type" ON "projects" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_created_at" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_merkle_root" ON "projects" USING btree ("merkle_root");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sign_alloc_account" ON "sign_allocations" USING btree ("account");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sign_iss_claim" ON "sign_issuances" USING btree ("project_address","claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vesting_beneficiary" ON "vesting_schedules" USING btree ("beneficiary");