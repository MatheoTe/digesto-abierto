CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ordinance_number" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"content" text NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" halfvec(1024),
	"embedding_model" text,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('es_unaccent', coalesce(heading_path, '') || ' ' || coalesce(label, '')), 'A') || setweight(to_tsvector('es_unaccent', content), 'B') || setweight(to_tsvector('es_unaccent', context), 'C')) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" halfvec(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_content_hash_model_pk" PRIMARY KEY("content_hash","model")
);
--> statement-breakpoint
CREATE TABLE "ordinances" (
	"number" integer PRIMARY KEY NOT NULL,
	"source_id" integer,
	"sanctioned_on" date,
	"promulgated_on" date,
	"published_on" date,
	"summary" text DEFAULT '' NOT NULL,
	"scope" text,
	"character" text,
	"in_force" boolean NOT NULL,
	"repealed_by" integer,
	"excluded_on" date,
	"descriptors" text[] DEFAULT '{}'::text[] NOT NULL,
	"relations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text_source" text,
	"text_url" text,
	"later_amendments" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"original_url" text,
	"pdf_url" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"rewritten_query" text,
	"answer" text,
	"answerable" boolean,
	"status" text NOT NULL,
	"error" text,
	"llm_provider" text NOT NULL,
	"llm_model" text,
	"embedding_model" text NOT NULL,
	"reranker" text,
	"timings" jsonb NOT NULL,
	"retrieval" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"cost_usd" numeric(12, 6),
	"total_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_ordinance_number_ordinances_number_fk" FOREIGN KEY ("ordinance_number") REFERENCES "public"."ordinances"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_ordinance_ordinal_key" ON "chunks" USING btree ("ordinance_number","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_embedding_model_idx" ON "chunks" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "ordinances_in_force_idx" ON "ordinances" USING btree ("in_force");--> statement-breakpoint
CREATE INDEX "traces_created_at_idx" ON "traces" USING btree ("created_at" DESC NULLS LAST);