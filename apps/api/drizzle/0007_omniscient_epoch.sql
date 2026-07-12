-- slice 8: dev-only data wipe. Pre-auth rows have no owner and cannot satisfy
-- the NOT NULL + FK constraints below. Agreed destructive reset of local dev data.
DELETE FROM "quiz_attempt";--> statement-breakpoint
DELETE FROM "memo";--> statement-breakpoint
DELETE FROM "quiz_question";--> statement-breakpoint
DELETE FROM "pdf_page";--> statement-breakpoint
DELETE FROM "pdf";--> statement-breakpoint
ALTER TABLE "memo" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "memo" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pdf" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_question" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "quiz_question" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memo" ADD CONSTRAINT "memo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf" ADD CONSTRAINT "pdf_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdf_user_id_idx" ON "pdf" USING btree ("user_id");