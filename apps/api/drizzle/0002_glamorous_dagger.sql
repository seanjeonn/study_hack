CREATE TABLE "pdf_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pdf_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"text_layer_text" text DEFAULT '' NOT NULL,
	"char_count" integer NOT NULL,
	"has_text" boolean NOT NULL,
	"vision_used" boolean DEFAULT false NOT NULL,
	"vision_text" text,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdf_page" ADD CONSTRAINT "pdf_page_pdf_id_pdf_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."pdf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_page_pdf_id_page_number_idx" ON "pdf_page" USING btree ("pdf_id","page_number");