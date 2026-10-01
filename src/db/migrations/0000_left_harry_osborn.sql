CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"verify_channel_id" text,
	"verified_role_id" text,
	"unverified_role_id" text,
	"log_channel_id" text,
	"block_targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"panel_channel_id" text,
	"panel_message_id" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_targets_valid" CHECK ("guild_settings"."block_targets" <@ ARRAY['tor','vpn','proxy']::text[])
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ip_reputation_cache" (
	"ip_hash" "bytea" PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"public_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verifications" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"discord_username" text NOT NULL,
	"status" text NOT NULL,
	"email_enc" "bytea",
	"email_verified" boolean,
	"oauth_ip_enc" "bytea",
	"ip_enc" "bytea",
	"webrtc_ips_enc" "bytea",
	"webrtc_status" text,
	"ua_server" text,
	"ua_client" text,
	"risk_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"reject_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "verifications_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "verifications_status_valid" CHECK ("verifications"."status" IN ('oauth_done','rejected','verified'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verification_sessions" ADD CONSTRAINT "verification_sessions_guild_user_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."verifications"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_guild_created" ON "audit_logs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_sessions_expires" ON "verification_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_sessions_token_hash" ON "verification_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_sessions_public_id" ON "verification_sessions" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verifications_status_updated" ON "verifications" USING btree ("status","updated_at");