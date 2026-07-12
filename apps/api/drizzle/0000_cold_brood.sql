CREATE TABLE "pdf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"page_count" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
