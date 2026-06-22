CREATE TABLE "pdf_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pdf_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"extracted_text" text NOT NULL,
	"has_text" boolean NOT NULL,
	CONSTRAINT "pdf_page_pdf_id_page_number_unique" UNIQUE("pdf_id","page_number")
);
--> statement-breakpoint
ALTER TABLE "pdf_page" ADD CONSTRAINT "pdf_page_pdf_id_pdf_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."pdf"("id") ON DELETE cascade ON UPDATE no action;